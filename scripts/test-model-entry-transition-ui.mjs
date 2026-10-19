import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLocalProvider, prepareRealPiFixture } from '../tests/support/local-provider.ts';

const provider = await createLocalProvider();
const f = await prepareRealPiFixture(provider.baseUrl, 'model-entry-transition-ui');
f.store.project(f.projectId).trusted = false;
await f.store.save();
const output = path.resolve('test-results/model-entry-transition');
await fs.mkdir(output, { recursive: true });
let app, page;
const errors = [],
  evidence = [];
const selected = () => page.evaluate(() => window.entryState.selectedSessionId);
const calls = () => app.evaluate(() => globalThis.entryProbe.calls);
const connectCalls = async () => (await calls()).filter((call) => call.method === 'connect');
const gate = (token, method, phase = 'after', id) =>
  app.evaluate(
    (_electron, config) => {
      const value = { ...config, used: false };
      value.ready = new Promise((resolve) => {
        value.enter = resolve;
      });
      value.wait = new Promise((resolve, reject) => {
        value.release = resolve;
        value.reject = reject;
      });
      globalThis.entryProbe.gates.push(value);
    },
    { token, method, phase, id },
  );
const entered = (token) =>
  app.evaluate(
    (_electron, token) => globalThis.entryProbe.gates.find((gate) => gate.token === token).ready,
    token,
  );
const release = (token, reject = false) =>
  app.evaluate(
    (_electron, { token, reject }) => {
      const value = globalThis.entryProbe.gates.find((gate) => gate.token === token);
      if (reject) value.reject(new Error('TEST_NAVIGATION_CANCELLED'));
      else value.release();
    },
    { token, reject },
  );
const capture = async (label) => {
  const state = await page.evaluate(() => {
    const id = window.entryState.selectedSessionId,
      button = document.querySelector('.model-pill');
    return {
      id,
      projectId: window.entryState.selectedProjectId,
      disabled: button.disabled,
      buttonLabel: button.textContent,
      open: button.getAttribute('aria-expanded'),
      runtime: window.entryRuntimes.get(id),
    };
  });
  evidence.push({ label, ...state, connectCalls: await connectCalls() });
};
try {
  app = await electron.launch({
    args: [path.resolve('.')],
    env: { ...process.env, PI_DESKTOP_DATA_DIR: f.dataDir, PI_OFFLINE: '1' },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('textbox', { name: '任务输入' }).waitFor();
  await page.evaluate(async () => {
    window.entryRuntimes = new Map();
    window.desktop.onEvent((event) => {
      if (event.type === 'state') window.entryState = event.state;
      const runtime = event.runtime ?? event.patch;
      if (runtime?.sessionId)
        window.entryRuntimes.set(runtime.sessionId, {
          ...window.entryRuntimes.get(runtime.sessionId),
          ...runtime,
        });
    });
    const { state, runtime } = await window.desktop.invoke('bootstrap');
    window.entryState = state;
    if (runtime.sessionId) window.entryRuntimes.set(runtime.sessionId, runtime);
  });
  await app.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('desktop:invoke');
    globalThis.entryProbe = { gates: [], calls: [], replies: [], wrongId: undefined };
    ipcMain.removeHandler('desktop:invoke');
    ipcMain.handle('desktop:invoke', async (event, method, args) => {
      globalThis.entryProbe.calls.push({ method, id: args?.[0] });
      const gate = globalThis.entryProbe.gates.find(
        (g) => !g.used && g.method === method && (!g.id || g.id === args[0]),
      );
      if (gate) gate.used = true;
      if (gate?.phase === 'before') {
        gate.enter();
        await gate.wait;
      }
      const result = await handler(event, method, args);
      if (gate?.phase === 'after') {
        gate.enter();
        await gate.wait;
      }
      globalThis.entryProbe.replies.push({ method, id: result?.id });
      return method === 'newSession' && globalThis.entryProbe.wrongId
        ? { ...result, id: globalThis.entryProbe.wrongId }
        : result;
    });
  });
  const button = page.getByRole('button', { name: '选择模型', exact: true });
  const newChat = () => page.getByRole('button', { name: /^新建对话/ }).click();
  const clickDisabled = async () => {
    await expect(button).toBeDisabled();
    const connectionButtons = page.locator('.run-meta').getByRole('button', { name: /连接|重连/ });
    for (const control of await connectionButtons.all()) await expect(control).toBeDisabled();
    const bounds = await button.boundingBox();
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect(page.getByRole('dialog', { name: '模型与推理级别' })).toHaveCount(0);
  };
  const connect = async (id) => {
    await expect(button).toBeEnabled();
    await button.click();
    await page.waitForFunction(
      (id) =>
        window.entryRuntimes.get(id)?.connected && window.entryRuntimes.get(id)?.model?.id === 'local-e2e',
      id,
    );
    await page.locator('.model-list [aria-current="true"]').waitFor();
    assert.equal(await selected(), id);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '模型与推理级别' })).toHaveCount(0);
  };
  const select = (id) => page.locator(`[data-session-id="${id}"] > button`).first().click();
  const nativeNewChat = () =>
    app.evaluate(({ Menu, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      Menu.getApplicationMenu()
        .getMenuItemById('file')
        .submenu.items.find((item) => item.label === '新建对话')
        .click({}, win, win.webContents);
    });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', '请先启用项目');
  await clickDisabled();
  assert.deepEqual(await connectCalls(), []);

  await gate('new-before', 'newSession', 'before');
  await newChat();
  await entered('new-before');
  await expect(button).toHaveText('会话切换中…');
  await clickDisabled();
  assert.equal(await selected(), f.sessionId);
  assert.deepEqual(await connectCalls(), []);
  await capture('old untrusted target: early mouse click is disabled');
  await release('new-before');
  await page.waitForFunction((old) => window.entryState.selectedSessionId !== old, f.sessionId);
  const a = await selected();
  await expect(button).toBeEnabled();
  assert.deepEqual(await connectCalls(), [], 'no deferred intent may connect after selection');
  await connect(a);
  assert.deepEqual(
    (await connectCalls()).map((call) => call.id),
    [a],
  );
  console.log(
    'PASS quick new from an untrusted project disables the old entry and requires a fresh explicit click',
  );

  // Keep the real closed-picker event callback to exercise a stale event after
  // B is ready. This must remain bound to A even after layout effects settle.
  await button.evaluate((element) => {
    const key = Object.keys(element).find((key) => key.startsWith('__reactProps$'));
    window.entryOldClick = element[key]?.onClick;
    if (typeof window.entryOldClick !== 'function') throw new Error('Missing real picker click callback');
  });
  await button.click();
  await page.getByRole('dialog', { name: '模型与推理级别' }).waitFor();
  await gate('new-after', 'newSession');
  await newChat();
  await entered('new-after');
  const b = await selected();
  assert.notEqual(b, a);
  await clickDisabled();
  await capture('new target selected but reply held: entry remains disabled');
  await page.screenshot({ path: path.join(output, 'transition-disabled.png') });
  assert.deepEqual(
    (await connectCalls()).map((call) => call.id),
    [a],
  );
  await release('new-after');
  await expect(button).toBeEnabled();
  assert.deepEqual(
    (await connectCalls()).map((call) => call.id),
    [a],
  );
  await page.evaluate(async () => {
    window.entryOldClick();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(page.getByRole('dialog', { name: '模型与推理级别' })).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  assert.deepEqual(
    (await connectCalls()).map((call) => call.id),
    [a],
    'the old click must neither open a picker for B nor connect a previous target',
  );
  await capture('stale A click after B settles cannot open or connect in the new context');
  await connect(b);
  console.log(
    'PASS a selected new target stays disabled until IPC completion; the old picker never carries forward',
  );

  await gate('cancel-new', 'newSession', 'before');
  await newChat();
  await entered('cancel-new');
  await clickDisabled();
  await release('cancel-new', true);
  await page.locator('.error-banner').filter({ hasText: 'TEST_NAVIGATION_CANCELLED' }).waitFor();
  await expect(button).toBeEnabled();
  assert.equal(await selected(), b);
  assert.equal((await connectCalls()).length, 2);
  await page.locator('.error-banner .icon-button').first().click();

  await gate('old-select', 'selectSession', 'after', f.sessionId);
  await select(f.sessionId);
  await entered('old-select');
  await clickDisabled();
  await select(b);
  await expect(button).toBeEnabled();
  await release('old-select');
  await expect(button).toBeEnabled();
  assert.equal(await selected(), b);
  assert.equal((await connectCalls()).length, 2);
  console.log(
    'PASS failed creation releases the lock, and a newer selection supersedes an old held reply without connecting',
  );

  await gate('select-a', 'selectSession', 'after', a);
  await select(a);
  await entered('select-a');
  await gate('select-project', 'selectSession', 'after', f.sessionId);
  await select(f.sessionId);
  await entered('select-project');
  await release('select-a');
  await clickDisabled();
  await expect(button).toHaveText('会话切换中…');
  await release('select-project');
  await expect(button).toHaveText('请先启用项目');
  await clickDisabled();
  assert.equal((await connectCalls()).length, 2);
  await select(b);
  await expect(button).toBeEnabled();
  console.log('PASS an older completion cannot unlock a newer pending or untrusted target');

  await app.evaluate((_electron, id) => {
    globalThis.entryProbe.wrongId = id;
  }, a);
  await newChat();
  await page.waitForFunction((old) => window.entryState.selectedSessionId !== old, b);
  await clickDisabled();
  await capture('wrong response target remains locked');
  assert.equal((await connectCalls()).length, 2);
  await app.evaluate(() => {
    globalThis.entryProbe.wrongId = undefined;
  });
  await select(b);
  await expect(button).toBeEnabled();
  assert.equal(await selected(), b);
  await capture('valid newer selection recovers from a wrong response target');
  console.log(
    'PASS wrong-target responses cannot enable or connect, and a valid new selection recovers without implicit requests',
  );

  await gate('menu-overrides-selection', 'selectSession', 'after', a);
  await select(a);
  await entered('menu-overrides-selection');
  await clickDisabled();
  await nativeNewChat();
  await page.waitForFunction((id) => window.entryState.selectedSessionId !== id, a);
  const menuTarget = await selected();
  await expect(button).toBeEnabled();
  await release('menu-overrides-selection');
  await expect(button).toBeEnabled();
  assert.equal(await selected(), menuTarget);
  assert.equal((await connectCalls()).length, 2);
  const input = page.getByRole('textbox', { name: '任务输入' });
  await input.fill('An explicit task could now be sent');
  await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeEnabled();
  await input.fill('');
  await capture('native File > New Chat supersedes the observed old target and survives its late reply');
  await page.screenshot({ path: path.join(output, 'external-menu-ready.png') });
  console.log('PASS native File > New Chat supersedes a held renderer selection without locking model/send');

  await select(b);
  await expect(button).toBeEnabled();
  await gate('delete-observed-selection', 'selectSession', 'after', menuTarget);
  await select(menuTarget);
  await entered('delete-observed-selection');
  const row = page.locator(`[data-session-id="${menuTarget}"]`);
  await row.getByRole('button', { name: /会话操作$/ }).click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page
    .getByRole('dialog', { name: /^删除会话/ })
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await page.waitForFunction(
    (id) => !window.entryState.sessions.some((session) => session.id === id),
    menuTarget,
  );
  const fallback = await selected();
  assert.notEqual(fallback, menuTarget);
  await expect(button).toBeEnabled();
  await release('delete-observed-selection');
  await expect(button).toBeEnabled();
  assert.equal(await selected(), fallback);
  assert.equal((await connectCalls()).length, 2);
  await capture('deleting the observed target selects a usable fallback despite the late response');
  console.log('PASS deleting an observed target keeps the confirmed fallback usable after its late reply');

  await nativeNewChat();
  await page.waitForFunction((id) => window.entryState.selectedSessionId !== id, fallback);
  const freshMenuTarget = await selected();
  await connect(freshMenuTarget);
  assert.deepEqual(
    (await connectCalls()).map((call) => call.id),
    [a, b, freshMenuTarget],
  );

  await gate('older-observed', 'selectSession', 'after', a);
  await select(a);
  await entered('older-observed');
  await gate('newer-unobserved', 'selectSession', 'before', b);
  await select(b);
  await entered('newer-unobserved');
  await nativeNewChat();
  await page.waitForFunction((id) => window.entryState.selectedSessionId !== id, a);
  await clickDisabled();
  await release('older-observed');
  await clickDisabled();
  assert.equal((await connectCalls()).length, 3);
  await release('newer-unobserved');
  await expect(button).toBeEnabled();
  assert.equal(await selected(), b);
  assert.equal((await connectCalls()).length, 3);
  await capture('external navigation and older completion cannot release a newer unobserved request');
  console.log(
    'PASS external navigation does not release a newer unobserved target; its own completion restores it',
  );

  assert.equal(provider.requests.length, 0, 'navigation/model discovery must not send a model prompt');
  assert.ok(!(await connectCalls()).some((call) => call.id === f.sessionId));
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, 'result.json'),
    JSON.stringify({ passed: true, evidence, calls: await calls(), rendererErrors: errors }, null, 2),
  );
} catch (error) {
  await capture('failure').catch(() => {});
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify({ evidence, calls: await calls().catch(() => []), rendererErrors: errors }, null, 2),
  );
  throw error;
} finally {
  await app?.close();
  await provider.close();
}
