import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentService } from '../electron/agent.ts';
import { Workspace } from '../electron/workspace.ts';
import { createLocalProvider, prepareRealPiFixture } from '../tests/support/local-provider.ts';
import { reportSessionSwitchBudget } from './session-switch-budget.mjs';
import {
  armSessionSwitchMeasurement,
  armRecordedSessionSwitchMeasurement,
} from './session-switch-measurement.mjs';
import { installSessionSwitchRecorder } from './session-switch-recording.mjs';
import { sessionSwitchProvenance } from './session-switch-provenance.mjs';

const recording = process.argv.includes('--record-session-switch');
const blockId = process.argv.find((arg) => arg.startsWith('--session-switch-block='))?.split('=')[1];
if (blockId && !/^[a-zA-Z0-9-]+$/.test(blockId)) throw new Error('Invalid diagnostic block ID');
const causalOutput = recording || blockId;
const samples = [];
let blockError;
let blockMeasurement;
let buildInfo;
const outputName = blockId || 'standalone-B';

process.env.PI_OFFLINE = '1';
const provider = await createLocalProvider();
const f = await prepareRealPiFixture(provider.baseUrl, 'session-ui');
const seed = new AgentService(f.store, new Workspace(f.dataDir));
const a = f.store.session(f.sessionId),
  b = f.store.createSession(f.projectId);
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
  ]) {
    await seed.send(session.id, marker, [], 'steer');
    await wait(() => !seed.hasPendingWork);
  }
} finally {
  await seed.dispose();
}
a.title = '切换验收 A';
b.title = '切换验收 B';
a.draft = 'A 的草稿';
b.draft = 'B 的草稿';
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
    env: {
      ...process.env,
      PI_OFFLINE: '1',
      PI_DESKTOP_DATA_DIR: f.dataDir,
      ...(causalOutput ? { PI_SESSION_SWITCH_RECORD: recording ? '1' : '0' } : {}),
    },
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('textbox', { name: '任务输入' }).waitFor();
  if (recording) await page.evaluate(installSessionSwitchRecorder, {});
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
  buildInfo = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
  }));
  assert.equal(buildInfo.version, JSON.parse(await fs.readFile('package.json', 'utf8')).version);
  if (packaged) assert.equal(buildInfo.packaged, true);
  await page.evaluate((id) => window.desktop.invoke('connect', id), a.id);
  await page.locator('.thread').getByText('SESSION_A_ONLY', { exact: true }).waitFor();
  const diagnostic = recording
    ? async () =>
        JSON.parse(
          await page.evaluate(async () => {
            window.__sessionSwitchRecorder.mark('diagnostics.start');
            try {
              return await window.desktop.invoke('diagnostics');
            } finally {
              window.__sessionSwitchRecorder.mark('diagnostics.end');
            }
          }),
        )
    : async () => JSON.parse(await page.evaluate(() => window.desktop.invoke('diagnostics')));
  const originalPid = (await diagnostic()).sessionSwitch.pid;
  const durations = [],
    backendDurations = [];
  for (let i = 0; i < 12; i++) {
    const target = i % 2 ? a : b,
      marker = i % 2 ? 'SESSION_A_ONLY' : 'SESSION_B_ONLY';
    await page.evaluate(
      recording ? armRecordedSessionSwitchMeasurement : armSessionSwitchMeasurement,
      recording ? { marker, targetId: target.id, index: i } : marker,
    );
    await page.getByRole('button', { name: target.title, exact: true }).click();
    const elapsed = await page.evaluate(() => window.switchMeasurement);
    const sample = causalOutput
      ? { index: i, warmup: i < 2, targetId: target.id, elapsedMs: elapsed }
      : undefined;
    if (sample) samples.push(sample);
    // Draft state is restored by a React effect after the target messages render.
    // Wait for correctness separately; keep click-to-message timing unchanged.
    await page.waitForFunction(
      recording
        ? (draft) => {
            const correct = document.querySelector('textarea[aria-label="任务输入"]')?.value === draft;
            window.__sessionSwitchRecorder.draftCheck(correct);
            return correct;
          }
        : (draft) => document.querySelector('textarea[aria-label="任务输入"]')?.value === draft,
      target.draft,
      { timeout: 5000 },
    );
    assert.equal(await page.getByRole('textbox', { name: '任务输入' }).inputValue(), target.draft);
    if (sample) sample.draftCorrect = true;
    const info = (await diagnostic()).sessionSwitch;
    if (sample) sample.diagnosticBackendMs = info.elapsedMs;
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
  blockMeasurement = measurement;
  if (recording) await page.evaluate(() => window.__sessionSwitchRecorder.finishSamples());
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
  assert.equal(await page.evaluate(() => window.otherSessionBannerCount), 0);
  console.log('PASS idle switches and cold reconnection never show an unrelated running-session banner');

  assert.deepEqual(errors, []);
} catch (error) {
  blockError = error instanceof Error && error.name === 'AssertionError' ? 'AssertionError' : 'Error';
  if (page && !page.isClosed()) {
    await fs
      .mkdir('test-results', { recursive: true })
      .then(() =>
        page.screenshot({
          path: causalOutput
            ? `test-results/session-switch-causal-failure-${outputName}-${process.platform}.png`
            : `test-results/session-ui-failure-${process.platform}.png`,
        }),
      )
      .catch(() => {});
  }
  throw error;
} finally {
  try {
    // Export only at block end, including failed/partial blocks and callbacks after the last rAF.
    if (causalOutput) {
      const failures = [];
      const renderer =
        recording && page && !page.isClosed()
          ? await page
              .evaluate(() => window.__sessionSwitchRecorder?.snapshot())
              .catch(() => {
                failures.push('renderer snapshot failed');
                return null;
              })
          : null;
      const main =
        recording && app
          ? await app
              .evaluate(() => globalThis.__sessionSwitchRecording?.snapshot())
              .catch(() => {
                failures.push('main snapshot failed');
                return null;
              })
          : null;
      if (recording && (!renderer || !main))
        failures.push('Recording requested but a recorder was unavailable');
      if (renderer?.dropped) failures.push('Renderer recorder overflow');
      if (main?.dropped) failures.push('Main recorder overflow');
      if (main?.observerErrors) failures.push('Main recorder observer failure');
      await fs.mkdir('test-results/session-switch-causal', { recursive: true });
      await fs.writeFile(
        `test-results/session-switch-causal/${outputName}-${process.platform}.json`,
        JSON.stringify(
          {
            version: 1,
            blockId: outputName,
            recording,
            platform: process.platform,
            architecture: process.arch,
            provenance: sessionSwitchProvenance(buildInfo),
            samples,
            measurement: blockMeasurement,
            error: blockError,
            snapshotErrors: failures,
            renderer,
            main,
          },
          null,
          2,
        ),
      );
      if (failures.length && !blockError) process.exitCode = 1;
    }
  } catch {
    process.exitCode = 1;
    console.error(
      'Session-switch diagnostic export failed; preserving the original test failure and cleaning up.',
    );
  } finally {
    await app
      ?.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      })
      .catch(() => {});
    await app?.close().catch(() => {});
    await provider.close().catch(() => {
      process.exitCode = 1;
    });
  }
}
