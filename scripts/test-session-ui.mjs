import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentService } from '../electron/agent.ts';
import { Workspace } from '../electron/workspace.ts';
import { createLocalProvider, prepareRealPiFixture } from '../tests/support/local-provider.ts';
import { reportSessionSwitchBudget } from './session-switch-budget.mjs';

process.env.PI_OFFLINE = '1';
const provider = await createLocalProvider();
const f = await prepareRealPiFixture(provider.baseUrl, 'session-ui');
// All trust and extension changes are confined to this disposable fixture.
const settingsFile = path.join(f.agentDir, 'settings.json');
await fs.writeFile(
  settingsFile,
  JSON.stringify({
    ...JSON.parse(await fs.readFile(settingsFile, 'utf8')),
    defaultProjectTrust: 'always',
  }),
);
const otherProject = {
  id: randomUUID(),
  name: '另一个验收项目',
  path: path.join(f.dir, 'other-project'),
  trusted: true,
  createdAt: Date.now(),
};
f.store.state.projects.push(otherProject);
for (const [directory, command] of [
  [f.agentDir, 'session-ui-process-cwd'],
  [path.join(f.projectDir, '.pi'), 'session-ui-project-only'],
  [path.join(otherProject.path, '.pi'), 'session-ui-other-project-only'],
]) {
  await fs.mkdir(path.join(directory, 'extensions'), { recursive: true });
  await fs.writeFile(
    path.join(directory, 'extensions', 'session-ui-context.js'),
    `export default function(pi) {
      pi.registerCommand(${JSON.stringify(command)}, { description: process.cwd(), handler: async () => {} });
    }`,
  );
}
const a = f.store.session(f.sessionId),
  b = f.store.createSession(f.projectId),
  standalone = f.store.createSession(),
  coldProject = f.store.createSession(f.projectId),
  other = f.store.createSession(otherProject.id);
const fixtures = [
  { session: a, marker: 'SESSION_A_ONLY', command: 'session-ui-project-only' },
  { session: b, marker: 'SESSION_B_ONLY', command: 'session-ui-project-only' },
  { session: standalone, marker: 'SESSION_STANDALONE_ONLY' },
  { session: coldProject, marker: 'SESSION_COLD_PROJECT_ONLY', command: 'session-ui-project-only' },
  { session: other, marker: 'SESSION_OTHER_PROJECT_ONLY', command: 'session-ui-other-project-only' },
];
const seed = new AgentService(f.store, new Workspace(f.dataDir));
const wait = async (condition) => {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > 30000) throw new Error('Session UI fixture timed out');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};
try {
  for (const fixture of fixtures) {
    fixture.cwd = await f.store.sessionDirectory(fixture.session.id);
    await seed.send(fixture.session.id, fixture.marker, [], 'steer');
    await wait(() => !seed.hasPendingWork);
  }
} finally {
  await seed.dispose();
}
let originalActivity = {};
for (const [index, { session }] of fixtures.entries()) {
  session.title = `切换验收 ${index + 1}`;
  session.draft = `${session.title} 的未发送草稿`;
  // Distinct, recent activity makes accidental browsing-driven reordering observable.
  session.updatedAt = Date.now() - (fixtures.length - index) * 60 * 60 * 1000;
  originalActivity[session.id] = session.updatedAt;
}
f.store.selectSession(a.id);
await f.store.save();
const packaged = process.argv.includes('--packaged');
let executablePath = process.env.PI_DESKTOP_EXE;
if (packaged && !executablePath)
  executablePath =
    process.platform === 'win32'
      ? path.resolve('release/win-unpacked/Pi Desktop.exe')
      : path.resolve(
          `release/mac${process.arch === 'arm64' ? '-arm64' : ''}/Pi Desktop.app/Contents/MacOS/Pi Desktop`,
        );
let app, page, testError;
const errors = [];
const launch = async () => {
  app = await electron.launch({
    executablePath,
    args: executablePath ? [] : [path.resolve('.')],
    env: { ...process.env, PI_OFFLINE: '1', PI_DESKTOP_DATA_DIR: f.dataDir },
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('textbox', { name: '任务输入' }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    // Measure foreground latency even when the desktop gives another app focus during the test.
    window.webContents.setBackgroundThrottling(false);
    window.focus();
  });
  await page.bringToFront();
  await page.evaluate(async () => {
    // Scalar runtime fields (including commands) are complete in each public patch.
    // Keep one snapshot per session so background events cannot replace the target.
    window.sessionUiRuntimes = new Map();
    window.desktop.onEvent((event) => {
      if (event.type === 'state') window.sessionUiState = event.state;
      if (event.type === 'runtime' && event.runtime.sessionId)
        window.sessionUiRuntimes.set(event.runtime.sessionId, event.runtime);
      if (event.type === 'runtimePatch' && event.patch.sessionId)
        window.sessionUiRuntimes.set(event.patch.sessionId, event.patch);
      if (event.type === 'runtimeRemoved') window.sessionUiRuntimes.delete(event.sessionId);
    });
    // A single initial resync seeds the observer; never poll bootstrap during a switch.
    const { state, runtime } = await window.desktop.invoke('bootstrap');
    window.sessionUiState = state;
    if (runtime.sessionId) window.sessionUiRuntimes.set(runtime.sessionId, runtime);
    window.otherSessionBannerCount = 0;
    new MutationObserver(() => {
      if (
        [...document.querySelectorAll('.banner')].some((banner) =>
          banner.textContent.includes('另一个会话正在执行'),
        )
      )
        window.otherSessionBannerCount++;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
};
// Playwright 1.64 treats an async waitForFunction predicate's Promise as truthy.
// These predicates must stay synchronous and use the already-observed public state.
function selectionReady({ id, draft }) {
  const runtime = window.sessionUiRuntimes.get(id);
  const send = document.querySelector('button[aria-label="发送任务"]');
  return Boolean(
    window.sessionUiState?.selectedSessionId === id &&
    document.querySelector(`.session-row[data-session-id="${id}"] > button`)?.getAttribute('aria-current') ===
      'page' &&
    runtime?.connected &&
    runtime.status === 'idle' &&
    document.querySelector('textarea[aria-label="任务输入"]')?.value === draft &&
    draft &&
    send &&
    !send.disabled,
  );
}
const selectionSettled = (session) =>
  page.waitForFunction(selectionReady, { id: session.id, draft: session.draft }, { timeout: 30000 });
const diagnostic = async () => JSON.parse(await page.evaluate(() => window.desktop.invoke('diagnostics')));
const sidebarOrder = () =>
  page.locator('.sidebar .session-row').evaluateAll((rows) => rows.map((row) => row.dataset.sessionId));
let originalOrder;
const assertBrowsingUnchanged = async () => {
  const state = JSON.parse(await fs.readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
  assert.deepEqual(
    Object.fromEntries(state.sessions.map((session) => [session.id, session.updatedAt])),
    originalActivity,
    'Browsing and connecting must not change session activity timestamps',
  );
  assert.deepEqual(await sidebarOrder(), originalOrder, 'Browsing must not reorder sidebar sessions');
};
const measureSelection = async (fixture) => {
  const { session, marker } = fixture;
  await page.evaluate(
    ({ id, marker, draft, markers }) => {
      window.switchMeasurement = new Promise((resolve, reject) => {
        let started, messageDomMs, nextAnimationFrameMs, runtimeReadyMs, selectionSettledMs;
        let otherHistoryVisible = false,
          frame;
        const cleanup = () => {
          clearTimeout(timeout);
          cancelAnimationFrame(frame);
          observer.disconnect();
          unsubscribe();
          document.removeEventListener('click', click, true);
        };
        const sample = () => {
          if (started === undefined) return;
          const runtime = window.sessionUiRuntimes.get(id);
          if (runtimeReadyMs === undefined && runtime?.connected && runtime.status === 'idle')
            runtimeReadyMs = performance.now() - started;
          const text = document.querySelector('.thread')?.textContent ?? '';
          if (messageDomMs === undefined && text.includes(marker)) {
            messageDomMs = performance.now() - started;
            // A rAF callback is an observable frame boundary, not proof of screen presentation.
            requestAnimationFrame(() => {
              nextAnimationFrameMs = performance.now() - started;
            });
          }
          // Once the target preview appears, later wrong-history frames must not be forgotten.
          if (messageDomMs !== undefined)
            otherHistoryVisible ||= markers.some((other) => other !== marker && text.includes(other));
        };
        const pollFrame = () => {
          sample();
          const send = document.querySelector('button[aria-label="发送任务"]');
          const selected = document.querySelector(`.session-row[data-session-id="${id}"] > button`);
          if (
            selectionSettledMs === undefined &&
            window.sessionUiState?.selectedSessionId === id &&
            selected?.getAttribute('aria-current') === 'page' &&
            window.sessionUiRuntimes.get(id)?.connected &&
            window.sessionUiRuntimes.get(id)?.status === 'idle' &&
            document.querySelector('textarea[aria-label="任务输入"]')?.value === draft &&
            draft &&
            send &&
            !send.disabled
          )
            selectionSettledMs = performance.now() - started;
          if (
            nextAnimationFrameMs !== undefined &&
            runtimeReadyMs !== undefined &&
            selectionSettledMs !== undefined
          ) {
            cleanup();
            resolve({
              messageDomMs,
              nextAnimationFrameMs,
              runtimeReadyMs,
              selectionSettledMs,
              otherHistoryVisible,
              targetHistoryPresentAtSettlement:
                document.querySelector('.thread')?.textContent.includes(marker) ?? false,
              foreignHistoryAtSettlement: markers.some(
                (other) => other !== marker && document.querySelector('.thread')?.textContent.includes(other),
              ),
            });
          } else frame = requestAnimationFrame(pollFrame);
        };
        const click = (event) => {
          if (!event.target.closest(`.session-row[data-session-id="${id}"] > button`)) return;
          document.removeEventListener('click', click, true);
          started = performance.now();
          sample();
          frame = requestAnimationFrame(pollFrame);
        };
        const observer = new MutationObserver(sample);
        const unsubscribe = window.desktop.onEvent(sample);
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`Session ${id} history, runtime, draft or selection completion timed out`));
        }, 30000);
        document.addEventListener('click', click, true);
        observer.observe(document.querySelector('.thread'), {
          subtree: true,
          childList: true,
          characterData: true,
        });
      });
      // A failed Playwright click must not leave an unhandled renderer rejection before cleanup.
      void window.switchMeasurement.catch(() => {});
    },
    {
      id: session.id,
      marker,
      draft: session.draft,
      markers: fixtures.map((item) => item.marker),
    },
  );
  await page.locator(`.session-row[data-session-id="${session.id}"] > button`).first().click();
  const timing = await page.evaluate(() => window.switchMeasurement);
  assert.equal(timing.otherHistoryVisible, false, 'No foreign history may appear after the target preview');
  assert.equal(
    timing.targetHistoryPresentAtSettlement,
    true,
    'The target history must still be present at selection completion',
  );
  assert.equal(
    timing.foreignHistoryAtSettlement,
    false,
    'Completed selection must not contain another session history',
  );
  await selectionSettled(session);
  return timing;
};
const within = async (operation, ms, label) => {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const cleanupApp = async () => {
  if (!app) return;
  if (page && !page.isClosed())
    await within(
      page.evaluate(() => {
        // Cleanup only: handle future exit requests and a request already shown by a failed close.
        window.desktop.onEvent((event) => {
          if (event.type === 'appDialog' && event.dialog.message === 'Pi 仍在执行任务')
            void window.desktop.invoke('respondAppDialog', event.dialog.id, 1).catch(() => {});
        });
        const existing = [...document.querySelectorAll('[data-app-dialog] button')].find(
          (button) => button.textContent === '停止并退出',
        );
        existing?.click();
      }),
      3000,
      'Installing exit cleanup',
    ).catch((error) => console.warn(error.message));
  try {
    await within(app.close(), 15000, 'Electron cleanup');
  } catch (error) {
    // Never leave CI waiting indefinitely, or replace the original assertion with a cleanup failure.
    try {
      app.process().kill('SIGKILL');
    } catch {}
    return error;
  }
};
try {
  await launch();
  const buildInfo = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
  }));
  assert.equal(buildInfo.version, JSON.parse(await fs.readFile('package.json', 'utf8')).version);
  if (packaged) assert.equal(buildInfo.packaged, true);
  await page.evaluate((id) => window.desktop.invoke('connect', id), a.id);
  await selectionSettled(a);
  await page.locator('.thread').getByText('SESSION_A_ONLY', { exact: true }).waitFor();
  for (const header of await page.locator('.project-row').all())
    if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
  originalOrder = await sidebarOrder();
  assert.equal(originalOrder.length, fixtures.length);
  await assertBrowsingUnchanged();
  const originalPid = (await diagnostic()).sessionSwitch.pid;
  assert.ok(Number.isInteger(originalPid));
  const sessionPids = new Map([[a.id, originalPid]]);
  const hotSwitches = [];
  const requestsBeforeSwitching = provider.requests.length;
  for (let i = 0; i < 12; i++) {
    const target = fixtures[i % 2 ? 0 : 1];
    const timing = await measureSelection(target);
    // lastSwitch describes the process's last connection, not this hot UI switch.
    // Read it only after selection settles, and use it solely to check PID ownership.
    const info = (await diagnostic()).sessionSwitch;
    assert.equal(info.mode, 'restart');
    if (sessionPids.has(target.session.id)) assert.equal(info.pid, sessionPids.get(target.session.id));
    else sessionPids.set(target.session.id, info.pid);
    await assertBrowsingUnchanged();
    if (i >= 2) hotSwitches.push({ sessionId: target.session.id, ...timing });
  }
  const durations = hotSwitches.map((sample) => sample.nextAnimationFrameMs);
  const measurement = {
    platform: process.platform,
    ...buildInfo,
    durations,
    selectionSettledMs: hotSwitches.map((sample) => sample.selectionSettledMs),
    hotSwitches,
    activitySnapshot: { updatedAt: originalActivity, sidebarOrder: originalOrder },
    timingNotes: {
      durations: 'Click to target history DOM observation followed by the next rAF; not a paint measurement.',
      runtimeReadyMs:
        'Click to observed connected/idle state; an already-ready hot runtime is available at click time.',
      selectionSettledMs:
        'Click to observed target state, idle runtime, correct nonempty draft and enabled send button; includes renderer completion after selectSession IPC, not an IPC roundtrip measurement.',
    },
    maxMs: Math.max(...durations),
    budgetMs: 200,
  };
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile(
    `test-results/session-ui-${process.platform}.json`,
    JSON.stringify(measurement, null, 2),
  );
  console.log('Session click-to-DOM/next-rAF/readiness measurements:', JSON.stringify(measurement));
  reportSessionSwitchBudget(measurement);
  assert.notEqual(sessionPids.get(a.id), sessionPids.get(b.id));
  console.log("PASS ten hot UI switches retain each chat's process, draft, activity time and sidebar order");

  // A is selected after the even number of switches. Its exit must not disturb B.
  process.kill(originalPid);
  await page.waitForFunction((id) => {
    const runtime = window.sessionUiRuntimes.get(id);
    return runtime?.connected === false && runtime.crash?.cleanup === 'confirmed';
  }, a.id);
  // The unexpected process exit is genuine activity. Establish its persisted/rendered baseline;
  // subsequent browsing and reconnection must leave that new activity order unchanged.
  // Status and activity enqueue separate saves. The first interrupted disk snapshot may
  // still contain the old timestamp, while state events already expose the completed exit.
  await page.waitForFunction(
    (id) => window.sessionUiState.sessions.find((session) => session.id === id)?.lastStatus === 'interrupted',
    a.id,
  );
  originalActivity = await page.evaluate(() =>
    Object.fromEntries(window.sessionUiState.sessions.map((session) => [session.id, session.updatedAt])),
  );
  await wait(async () => {
    const state = JSON.parse(await fs.readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
    if (state.sessions.find((session) => session.id === a.id)?.lastStatus !== 'interrupted') return false;
    return (
      state.sessions.length === Object.keys(originalActivity).length &&
      state.sessions.every((session) => session.updatedAt === originalActivity[session.id])
    );
  });
  await page.waitForFunction(
    (id) => document.querySelector('.project-group .session-row')?.dataset.sessionId === id,
    a.id,
  );
  originalOrder = await sidebarOrder();
  assert.equal(await page.evaluate((id) => window.sessionUiRuntimes.get(id)?.connected, b.id), true);
  await measureSelection(fixtures[1]);
  assert.equal((await diagnostic()).sessionSwitch.pid, sessionPids.get(b.id));
  await assertBrowsingUnchanged();
  console.log('PASS an idle process exit in A leaves B connected to its original process');
  await measureSelection(fixtures[0]);
  const reconnectedPid = (await diagnostic()).sessionSwitch.pid;
  assert.notEqual(reconnectedPid, originalPid);
  assert.notEqual(reconnectedPid, sessionPids.get(b.id));
  sessionPids.set(a.id, reconnectedPid);
  await assertBrowsingUnchanged();
  console.log('PASS selecting the exited chat reconnects only that chat without changing activity order');

  const crossDirectory = [];
  // Every cold target has saved real Pi history but has never been visited in this app process.
  // This exercises all cross-cwd directions without confusing a hot independent process with a restart.
  for (const [fixture, transition] of [
    [fixtures[2], 'project-to-standalone'],
    [fixtures[3], 'standalone-to-project'],
    [fixtures[4], 'project-to-project'],
  ]) {
    const { session, marker, cwd, command } = fixture;
    assert.equal(
      await page.evaluate((id) => window.sessionUiRuntimes.get(id)?.connected ?? false, session.id),
      false,
      'The target must be cold before its first UI selection',
    );
    const timing = await measureSelection(fixture);
    assert.ok(
      timing.messageDomMs < timing.runtimeReadyMs,
      'Cold target history must appear before Pi is ready',
    );
    const { state, runtime } = await page.evaluate(
      (id) => ({
        state: window.sessionUiState,
        runtime: window.sessionUiRuntimes.get(id),
      }),
      session.id,
    );
    assert.equal(state.selectedSessionId, session.id);
    assert.equal(state.selectedProjectId, session.projectId);
    assert.equal(runtime.sessionId, session.id);
    assert.equal(runtime.cwd, cwd);
    assert.equal(
      runtime.commands.find((item) => item.name === 'session-ui-process-cwd')?.description,
      await fs.realpath(cwd),
      'The real Pi process must use the target cwd',
    );
    for (const projectCommand of ['session-ui-project-only', 'session-ui-other-project-only'])
      assert.equal(
        runtime.commands.some((item) => item.name === projectCommand),
        projectCommand === command,
      );
    for (const { session: expected } of fixtures)
      assert.equal(state.sessions.find((item) => item.id === expected.id).draft, expected.draft);
    await page.locator('.thread').getByText(marker, { exact: true }).waitFor();
    const info = (await diagnostic()).sessionSwitch;
    assert.equal(info.mode, 'restart');
    assert.ok(Number.isInteger(info.pid));
    assert.equal([...sessionPids.values()].includes(info.pid), false, 'Each session owns a separate process');
    sessionPids.set(session.id, info.pid);
    await assertBrowsingUnchanged();
    crossDirectory.push({ transition, sessionId: session.id, ...timing });
  }
  // Return to each warmed directory and check its original independent process remains in place.
  for (const fixture of [fixtures[2], fixtures[3], fixtures[4], fixtures[0], fixtures[1]]) {
    await measureSelection(fixture);
    assert.equal((await diagnostic()).sessionSwitch.pid, sessionPids.get(fixture.session.id));
    await assertBrowsingUnchanged();
  }
  assert.equal(
    provider.requests.length,
    requestsBeforeSwitching,
    'Browsing and reconnecting must not send a prompt',
  );
  await fs.writeFile(
    `test-results/session-ui-cross-directory-${process.platform}.json`,
    JSON.stringify(
      {
        platform: process.platform,
        ...buildInfo,
        crossDirectory,
        activitySnapshotAfterExit: { updatedAt: originalActivity, sidebarOrder: originalOrder },
      },
      null,
      2,
    ),
  );
  console.log(
    'Cross-directory click-to-DOM/next-rAF/readiness measurements:',
    JSON.stringify(crossDirectory),
  );
  console.log(
    'PASS cold cross-directory history previews and hot return visits preserve cwd, resources, drafts and activity order',
  );
  assert.equal(await page.evaluate(() => window.otherSessionBannerCount), 0);
  console.log('PASS idle switches and cold reconnection never show an unrelated running-session banner');

  assert.deepEqual(errors, []);
} catch (error) {
  testError = error;
  if (page && !page.isClosed()) {
    await (async () => {
      await fs.mkdir('test-results', { recursive: true });
      const renderer = await page.evaluate(() => ({
        selectedSessionId: window.sessionUiState?.selectedSessionId,
        activity: window.sessionUiState?.sessions.map(({ id, updatedAt, lastStatus }) => ({
          id,
          updatedAt,
          lastStatus,
        })),
      }));
      const persisted = JSON.parse(await fs.readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
      await fs.writeFile(
        `test-results/session-ui-failure-${process.platform}.json`,
        JSON.stringify(
          {
            error: String(error),
            expectedActivity: originalActivity,
            renderer,
            persistedActivity: persisted.sessions.map(({ id, updatedAt, lastStatus }) => ({
              id,
              updatedAt,
              lastStatus,
            })),
          },
          null,
          2,
        ),
      );
    })().catch(() => {});
    await fs
      .mkdir('test-results', { recursive: true })
      .then(() =>
        page.screenshot({ path: `test-results/session-ui-failure-${process.platform}.png`, timeout: 5000 }),
      )
      .catch(() => {});
  }
  throw error;
} finally {
  const cleanupError = await cleanupApp();
  await provider.close();
  if (cleanupError) {
    if (!testError) throw cleanupError;
    console.warn('Cleanup after the original failure:', cleanupError.message);
  }
}

// Reuse the same --packaged target for image and transcript checks in the native CI jobs.
await import('./test-image-input-ui.mjs');
await import('./test-transcript-ui.mjs');
