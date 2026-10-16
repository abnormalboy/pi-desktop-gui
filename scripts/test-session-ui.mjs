import { _electron as electron } from 'playwright';
import { installSessionSwitchProbe, summarizeSessionSwitchProbe } from './session-switch-probe.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentService } from '../electron/agent.ts';
import { Workspace } from '../electron/workspace.ts';
import { createLocalProvider, prepareRealPiFixture } from '../tests/support/local-provider.ts';

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
let app, page, buildInfo;
const errors = [];
const modes = [];
const measurementContract = {
  schemaVersion: 2,
  ci: {
    commitSha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    runnerOs: process.env.RUNNER_OS,
    runnerArch: process.env.RUNNER_ARCH,
    imageOs: process.env.ImageOS,
    imageVersion: process.env.ImageVersion,
  },
  legacyMetric: 'document-bubble click to next requestAnimationFrame callback; not paint',
  targetMetric: 'captureToTargetDomObservedMs',
  budgetEnforcement:
    'legacy metric remains the hard 200ms gate; capture-to-DOM is additionally reported against 200ms',
  clockPolicy: 'Intervals are process-local and may overlap; never subtract renderer and main timestamps',
  samplingPolicy:
    'Diagnostics reads begin only after invoke settlement and target DOM/rAF observation; legacy endpoints remain, but added probes and this cadence differ from schema v1 and distributions are not evidence of improvement',
};
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
  buildInfo = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
  }));
  assert.equal(buildInfo.version, JSON.parse(await fs.readFile('package.json', 'utf8')).version);
  if (packaged) assert.equal(buildInfo.packaged, true);
  await page.evaluate((id) => window.desktop.invoke('connect', id), a.id);
  await page.locator('.thread').getByText('SESSION_A_ONLY', { exact: true }).waitFor();
  const diagnostic = async (scope) =>
    JSON.parse(await page.evaluate((scope) => window.desktop.invoke('diagnostics', scope), scope));
  const full = await diagnostic();
  assert.ok(full.environment && full.piCompatibility, 'default diagnostics retain environment detection');
  const originalPid = full.sessionSwitch.pid;
  const lightweight = await diagnostic('session-switch');
  assert.deepEqual(Object.keys(lightweight), ['sessionSwitch']);
  assert.deepEqual(lightweight.sessionSwitch, full.sessionSwitch);
  await assert.rejects(diagnostic('invalid'), /无效诊断范围/);
  for (const badId of ['not-a-uuid', {}, 'x'.repeat(1000)])
    await assert.rejects(
      page.evaluate(({ id, badId }) => window.desktop.invoke('selectSession', id, badId), {
        id: a.id,
        badId,
      }),
      /无效会话切换诊断 ID/,
    );
  const previewFile = path.join(f.dataDir, 'diagnostic-preview.txt');
  await app.evaluate(({ dialog }, file) => {
    const original = dialog.showSaveDialog;
    dialog.showSaveDialog = async () => {
      dialog.showSaveDialog = original;
      return { canceled: false, filePath: file };
    };
  }, previewFile);
  assert.equal(await page.evaluate(() => window.desktop.invoke('exportDiagnostics')), previewFile);
  assert.deepEqual(JSON.parse(await fs.readFile(previewFile, 'utf8')), full);
  // Retain legacy timing endpoints, with the same full/light observation order.
  // Extra probes and completion waiting mean overhead is not identical to schema v1.
  // Each mode retains two warmups and ten measured alternating switches.
  for (const diagnosticsScope of ['full', 'session-switch']) {
    await diagnostic(diagnosticsScope);
    const durations = [],
      backendDurations = [],
      samples = [];
    const mode = { diagnosticsScope, durations, backendDurations, samples, budgetMs: 200 };
    modes.push(mode);
    for (let i = 0; i < 12; i++) {
      const target = i % 2 ? a : b,
        marker = i % 2 ? 'SESSION_A_ONLY' : 'SESSION_B_ONLY';
      const targetButton = page.getByRole('button', { name: target.title, exact: true });
      await targetButton.evaluate(installSessionSwitchProbe, { sessionId: target.id, marker });
      await targetButton.click();
      const rendererTrace = await page.evaluate(() => window.switchMeasurement);
      const elapsed = rendererTrace.points.rafCallback - rendererTrace.points.legacyClickBubble;
      const sample = {
        iteration: i,
        warmup: i < 2,
        sessionId: target.id,
        switchId: rendererTrace.switchId,
        rendererTrace,
      };
      samples.push(sample);
      // Draft state is restored by a React effect after the target messages render.
      // Wait for correctness separately; keep click-to-message timing unchanged.
      await page.waitForFunction(
        (draft) => document.querySelector('textarea[aria-label="任务输入"]')?.value === draft,
        target.draft,
        { timeout: 5000 },
      );
      assert.equal(await page.getByRole('textbox', { name: '任务输入' }).inputValue(), target.draft);
      const readStarted = performance.now();
      let info,
        diagnosticReads = 0;
      // Messages can publish before rebind finishes. Do not pair this UI sample
      // with the previous switch, especially when the diagnostic read is cheap.
      await wait(async () => {
        diagnosticReads++;
        info = (await diagnostic(diagnosticsScope)).sessionSwitch;
        return info.sessionId === target.id && info.trace?.switchId === rendererTrace.switchId;
      });
      const diagnosticWaitMs = performance.now() - readStarted;
      sample.mainTrace = info.trace;
      const trace = summarizeSessionSwitchProbe(rendererTrace, info.trace);
      const { trace: _rawMainTrace, ...switchInfo } = info;
      Object.assign(sample, {
        uiMs: elapsed, // Schema v1 compatibility: legacy document-bubble to rAF callback.
        ...switchInfo,
        ...trace,
        captureToTargetDomWithin200Ms: trace.captureToTargetDomObservedMs <= 200,
        diagnosticWaitMs,
        diagnosticReads,
      });
      delete sample.rendererTrace;
      delete sample.mainTrace;
      assert.equal(trace.renderer.outcome, 'fulfilled');
      assert.equal(trace.main.outcome, 'fulfilled');
      assert.ok(Number.isFinite(trace.renderer.pointsMs.targetMessagesEventReceived));
      assert.ok(trace.renderer.pointsMs.invoke >= 0);
      assert.ok(trace.queueWaitMs >= 0);
      assert.ok(Math.abs(trace.backendMs - info.elapsedMs) <= 0.051);
      assert.equal(info.mode, 'reuse');
      assert.equal(info.pid, originalPid);
      if (i >= 2) {
        durations.push(elapsed);
        backendDurations.push(info.elapsedMs);
      }
    }
    mode.maxMs = Math.max(...durations);
  }
  const measurement = {
    ...measurementContract,
    platform: process.platform,
    ...buildInfo,
    modeOrder: modes.map((mode) => mode.diagnosticsScope),
    iterationsPerMode: 12,
    warmupsPerMode: 2,
    modes,
    maxMs: Math.max(...modes.map((mode) => mode.maxMs)),
    budgetMs: 200,
  };
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile(
    `test-results/session-ui-${process.platform}.json`,
    JSON.stringify(measurement, null, 2),
  );
  console.log('Session click-to-message measurement:', JSON.stringify(measurement));
  // Collect both modes before failing so a baseline outlier cannot hide the control.
  for (const mode of modes)
    for (const [index, elapsed] of mode.durations.entries())
      assert.ok(
        elapsed <= 200,
        `${mode.diagnosticsScope} legacy bubble-to-rAF switch ${index + 1} exceeded 200 ms: ${elapsed}`,
      );
  console.log(
    'PASS ten switches per mode retain PID and drafts; legacy bubble-to-rAF callbacks stay within 200 ms',
  );

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
  if (modes.length) {
    const failedProbe =
      page && !page.isClosed()
        ? await page.evaluate(() => window.switchMeasurementSnapshot).catch(() => undefined)
        : undefined;
    await fs.mkdir('test-results', { recursive: true });
    await fs.writeFile(
      `test-results/session-ui-partial-${process.platform}.json`,
      JSON.stringify(
        {
          ...measurementContract,
          platform: process.platform,
          ...buildInfo,
          complete: false,
          error: String(error),
          modes,
          failedProbe,
        },
        null,
        2,
      ),
    );
  }
  if (page && !page.isClosed()) {
    await fs.mkdir('test-results', { recursive: true });
    await page.screenshot({ path: `test-results/session-ui-failure-${process.platform}.png` });
  }
  throw error;
} finally {
  await app
    ?.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    })
    .catch(() => {});
  await app?.close().catch(() => {});
  await provider.close();
}
