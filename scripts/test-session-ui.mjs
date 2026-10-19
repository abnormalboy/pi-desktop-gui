import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentService } from '../electron/agent.ts';
import { Workspace } from '../electron/workspace.ts';
import { createLocalProvider, prepareRealPiFixture } from '../tests/support/local-provider.ts';
import { reportSessionSwitchBudget } from './session-switch-budget.mjs';

process.env.PI_OFFLINE = '1';
const provider = await createLocalProvider();
const f = await prepareRealPiFixture(provider.baseUrl, 'session-ui');
// Trust only the generated fixture project. These are real Pi extensions,
// whose descriptions expose the child process's cwd rather than the app's intended cwd.
const settingsFile = path.join(f.agentDir, 'settings.json');
await fs.writeFile(
  settingsFile,
  JSON.stringify({
    ...JSON.parse(await fs.readFile(settingsFile, 'utf8')),
    defaultProjectTrust: 'always',
  }),
);
for (const [directory, command] of [
  [f.agentDir, 'session-ui-process-cwd'],
  [path.join(f.projectDir, '.pi'), 'session-ui-project-only'],
]) {
  await fs.mkdir(path.join(directory, 'extensions'), { recursive: true });
  await fs.writeFile(
    path.join(directory, 'extensions', 'session-ui-context.js'),
    `export default function(pi) {
      pi.registerCommand(${JSON.stringify(command)}, { description: process.cwd(), handler: async () => {} });
    }`,
  );
}
const seed = new AgentService(f.store, new Workspace(f.dataDir));
const a = f.store.session(f.sessionId),
  b = f.store.createSession(f.projectId),
  cross = f.store.createSession();
const crossCwd = await f.store.sessionDirectory(cross.id);
const wait = async (condition) => {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > 30000) throw new Error('Session UI fixture timed out');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};
try {
  for (const [session, marker] of [
    [a, 'SESSION_A_ONLY'],
    [b, 'SESSION_B_ONLY'],
    [cross, 'SESSION_CROSS_ONLY'],
  ]) {
    await seed.send(session.id, marker, [], 'steer');
    await wait(() => !seed.hasPendingWork);
  }
} finally {
  await seed.dispose();
}
a.title = '切换验收 A';
b.title = '切换验收 B';
cross.title = '独立对话切换验收';
a.draft = 'A 的草稿';
b.draft = 'B 的草稿';
cross.draft = '跨目录会话的草稿';
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
let app, page;
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
  await page.evaluate(() => {
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
try {
  await launch();
  const buildInfo = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
  }));
  assert.equal(buildInfo.version, JSON.parse(await fs.readFile('package.json', 'utf8')).version);
  if (packaged) assert.equal(buildInfo.packaged, true);
  await page.evaluate((id) => window.desktop.invoke('connect', id), a.id);
  await page.locator('.thread').getByText('SESSION_A_ONLY', { exact: true }).waitFor();
  const diagnostic = async () => JSON.parse(await page.evaluate(() => window.desktop.invoke('diagnostics')));
  const originalPid = (await diagnostic()).sessionSwitch.pid;
  const durations = [],
    backendDurations = [];
  for (let i = 0; i < 12; i++) {
    const target = i % 2 ? a : b,
      marker = i % 2 ? 'SESSION_A_ONLY' : 'SESSION_B_ONLY';
    await page.evaluate((marker) => {
      window.switchMeasurement = new Promise((resolve, reject) => {
        let started;
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error('Target messages did not appear'));
        }, 10000);
        const observer = new MutationObserver(() => {
          if (started === undefined || !document.querySelector('.thread')?.textContent.includes(marker))
            return;
          observer.disconnect();
          clearTimeout(timeout);
          requestAnimationFrame(() => resolve(performance.now() - started));
        });
        document.addEventListener(
          'click',
          () => {
            started = performance.now();
          },
          { once: true },
        );
        observer.observe(document.querySelector('.thread'), {
          subtree: true,
          childList: true,
          characterData: true,
        });
      });
    }, marker);
    await page.getByRole('button', { name: target.title, exact: true }).click();
    const elapsed = await page.evaluate(() => window.switchMeasurement);
    // Draft state is restored by a React effect after the target messages render.
    // Wait for correctness separately; keep click-to-message timing unchanged.
    await page.waitForFunction(
      (draft) => document.querySelector('textarea[aria-label="任务输入"]')?.value === draft,
      target.draft,
      { timeout: 5000 },
    );
    assert.equal(await page.getByRole('textbox', { name: '任务输入' }).inputValue(), target.draft);
    // Preview and draft can arrive before rebinding finishes. Keep readiness outside
    // the existing click-to-message sample, and never read the previous switch's diagnostics.
    await page.waitForFunction(
      async (id) => {
        const { runtime } = await window.desktop.invoke('bootstrap');
        return runtime.sessionId === id && runtime.connected && runtime.status === 'idle';
      },
      target.id,
      { timeout: 30000 },
    );
    const info = (await diagnostic()).sessionSwitch;
    assert.equal(info.mode, 'reuse');
    assert.equal(info.pid, originalPid);
    if (i >= 2) {
      durations.push(elapsed);
      backendDurations.push(info.elapsedMs);
    }
  }
  const measurement = {
    platform: process.platform,
    ...buildInfo,
    durations,
    backendDurations,
    maxMs: Math.max(...durations),
    budgetMs: 200,
  };
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile(
    `test-results/session-ui-${process.platform}.json`,
    JSON.stringify(measurement, null, 2),
  );
  console.log('Session click-to-message measurement:', JSON.stringify(measurement));
  reportSessionSwitchBudget(measurement);
  console.log('PASS ten UI switches retain PID and drafts');

  process.kill(originalPid);
  await page.waitForFunction(async () => {
    const { runtime } = await window.desktop.invoke('bootstrap');
    return !runtime.connected && runtime.crash?.cleanup === 'confirmed';
  });
  await page.getByRole('button', { name: b.title, exact: true }).click();
  await page.locator('.thread').getByText('SESSION_B_ONLY', { exact: true }).waitFor();
  // History can already be visible while a fresh Pi process is still starting.
  await page.waitForFunction(async (id) => {
    const { runtime } = await window.desktop.invoke('bootstrap');
    return runtime.sessionId === id && runtime.connected && runtime.status === 'idle';
  }, b.id);
  const restarted = (await diagnostic()).sessionSwitch;
  assert.equal(restarted.mode, 'restart');
  assert.notEqual(restarted.pid, originalPid);
  await page.waitForFunction(
    (draft) => document.querySelector('textarea[aria-label="任务输入"]')?.value === draft,
    b.draft,
    { timeout: 5000 },
  );
  assert.equal(await page.getByRole('textbox', { name: '任务输入' }).inputValue(), b.draft);
  console.log('PASS the first sidebar selection after an idle Pi exit reconnects and restores the target');

  const crossDirectory = [];
  const requestsBeforeSwitching = provider.requests.length;
  let previousPid = restarted.pid;
  for (const target of [cross, b, cross, b]) {
    const marker = target === cross ? 'SESSION_CROSS_ONLY' : 'SESSION_B_ONLY';
    await page.evaluate(
      ({ id, marker }) => {
        window.crossDirectoryMeasurement = new Promise((resolve, reject) => {
          let started, messageDomMs, messageRafMs, runtimeReadyMs, otherHistoryVisible;
          const click = () => {
            started = performance.now();
          };
          const cleanup = () => {
            clearTimeout(timeout);
            observer.disconnect();
            unsubscribe();
            document.removeEventListener('click', click, true);
          };
          const finish = () => {
            if (messageRafMs === undefined || runtimeReadyMs === undefined) return;
            cleanup();
            resolve({ messageDomMs, messageRafMs, runtimeReadyMs, otherHistoryVisible });
          };
          // Observe public runtime readiness directly, without bootstrap/diagnostics polling latency.
          const unsubscribe = window.desktop.onEvent((event) => {
            const runtime =
              event.type === 'runtime'
                ? event.runtime
                : event.type === 'runtimePatch'
                  ? event.patch
                  : undefined;
            if (
              started !== undefined &&
              runtimeReadyMs === undefined &&
              runtime?.sessionId === id &&
              runtime.connected &&
              runtime.status === 'idle'
            ) {
              runtimeReadyMs = performance.now() - started;
              finish();
            }
          });
          const observer = new MutationObserver(() => {
            const text = document.querySelector('.thread')?.textContent ?? '';
            if (started === undefined || messageDomMs !== undefined || !text.includes(marker)) return;
            messageDomMs = performance.now() - started;
            otherHistoryVisible = ['SESSION_A_ONLY', 'SESSION_B_ONLY', 'SESSION_CROSS_ONLY'].some(
              (other) => other !== marker && text.includes(other),
            );
            // This is DOM observation followed by the next rAF, not proof of screen presentation.
            requestAnimationFrame(() => {
              messageRafMs = performance.now() - started;
              finish();
            });
          });
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Cross-directory target history or runtime readiness timed out'));
          }, 30000);
          document.addEventListener('click', click, { once: true, capture: true });
          observer.observe(document.querySelector('.thread'), {
            subtree: true,
            childList: true,
            characterData: true,
          });
        });
      },
      { id: target.id, marker },
    );
    await page.getByRole('button', { name: target.title, exact: true }).click();
    const timing = await page.evaluate(() => window.crossDirectoryMeasurement);
    assert.ok(
      timing.messageDomMs < timing.runtimeReadyMs,
      'Target history must appear before cold Pi is ready',
    );
    assert.equal(timing.otherHistoryVisible, false, 'Preview must not contain another session history');
    await page.waitForFunction(
      (draft) => document.querySelector('textarea[aria-label="任务输入"]')?.value === draft,
      target.draft,
      { timeout: 5000 },
    );
    const { state, runtime } = await page.evaluate(() => window.desktop.invoke('bootstrap'));
    assert.equal(state.selectedSessionId, target.id);
    assert.equal(state.selectedProjectId, target.projectId);
    assert.equal(runtime.sessionId, target.id);
    assert.equal(runtime.connected, true);
    assert.equal(runtime.status, 'idle');
    await page.locator('.thread').getByText(marker, { exact: true }).waitFor();
    const cwd = target === cross ? crossCwd : f.projectDir;
    assert.equal(runtime.cwd, cwd);
    assert.equal(
      runtime.commands.find((item) => item.name === 'session-ui-process-cwd')?.description,
      await fs.realpath(cwd),
      'Pi must use the target process cwd',
    );
    assert.equal(
      runtime.commands.some((item) => item.name === 'session-ui-project-only'),
      target !== cross,
      'Project resources must not leak into the standalone session',
    );
    for (const session of [a, b, cross])
      assert.equal(state.sessions.find((item) => item.id === session.id).draft, session.draft);
    const info = (await diagnostic()).sessionSwitch;
    assert.equal(info.mode, 'restart');
    assert.notEqual(info.pid, previousPid);
    assert.equal(provider.requests.length, requestsBeforeSwitching, 'Switching must not send a model prompt');
    previousPid = info.pid;
    crossDirectory.push({ sessionId: target.id, ...timing, backendReadyMs: info.elapsedMs });
  }
  await fs.writeFile(
    `test-results/session-ui-cross-directory-${process.platform}.json`,
    JSON.stringify({ platform: process.platform, ...buildInfo, crossDirectory }, null, 2),
  );
  console.log(
    'Cross-directory click-to-DOM/next-rAF and runtime-ready measurements:',
    JSON.stringify(crossDirectory),
  );
  console.log(
    'PASS two cross-directory round trips preview target history before readiness and isolate cwd, project resources and drafts',
  );
  assert.equal(await page.evaluate(() => window.otherSessionBannerCount), 0);
  console.log('PASS idle switches and cold reconnection never show an unrelated running-session banner');

  assert.deepEqual(errors, []);
} catch (error) {
  if (page && !page.isClosed()) {
    await fs.mkdir('test-results', { recursive: true });
    await page.screenshot({ path: `test-results/session-ui-failure-${process.platform}.png` });
  }
  throw error;
} finally {
  await app
    ?.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript(
        `void window.desktop.onEvent(event => {
            if (event.type === 'appDialog') void window.desktop.invoke('respondAppDialog', event.dialog.id,
              event.dialog.message === 'Pi 仍在执行任务' ? 1 : event.dialog.cancelId);
          })`,
      );
    })
    .catch(() => {});
  await app?.close().catch(() => {});
  await provider.close();
}

// Reuse the same --packaged target for image and transcript checks in the native CI jobs.
await import('./test-image-input-ui.mjs');
await import('./test-transcript-ui.mjs');
