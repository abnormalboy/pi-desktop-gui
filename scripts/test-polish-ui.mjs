import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { emptyRuntime } from '../shared/types.ts';
import { createLocalProvider, prepareRealPiFixture } from '../tests/support/local-provider.ts';

const provider = await createLocalProvider();
const f = await prepareRealPiFixture(provider.baseUrl, 'polish-ui');
// Seed protected records before launch; use only the fixture's isolated app-data directory.
const protectedFields = [
  { title: '自定义名称' },
  { draft: ' ' },
  { attachments: ['输入 文件.txt'] },
  { draftSnippets: [{ id: 'snippet', offset: 0, text: '长草稿' }] },
  { images: [{ id: 'image', name: 'pixel.png', mimeType: 'image/png', data: 'AA==' }] },
  { model: { provider: 'local-e2e', id: 'local-e2e' } },
  { thinking: 'off' },
  { approvalMode: 'confirm' },
  { pinned: true },
  { unread: true },
];
const protectedSessions = protectedFields.map((fields) => Object.assign(f.store.createSession(), fields));
await f.store.save();
const output = path.resolve('test-results/polish');
await fs.mkdir(output, { recursive: true });
let app, page;
try {
  app = await electron.launch({
    args: [path.resolve('.')],
    env: { ...process.env, PI_DESKTOP_DATA_DIR: f.dataDir, PI_OFFLINE: '1' },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.getByRole('textbox', { name: '任务输入' }).waitFor();
  const result = await page.evaluate(async () => {
    const api = window.desktop;
    const first = await api.invoke('newSession');
    const second = await api.invoke('newSession');
    await api.invoke('saveDraft', first.id, '保留草稿', [], [], []);
    const third = await api.invoke('newSession');
    const snap = await api.invoke('bootstrap');
    return { first, second, third, snap };
  });
  assert.equal(result.first.id, result.second.id);
  assert.notEqual(result.first.id, result.third.id);
  assert.equal(result.snap.state.sessions.find((s) => s.id === result.first.id).draft, '保留草稿');
  assert.equal(result.snap.runtime.connected, false);
  assert.equal(provider.requests.length, 0);
  const concurrent = await page.evaluate(async (projectId) => {
    const api = window.desktop;
    const [standalone, project] = await Promise.all([
      Promise.all(Array.from({ length: 8 }, () => api.invoke('newSession'))),
      Promise.all(Array.from({ length: 8 }, () => api.invoke('newSession', projectId))),
    ]);
    const original = (await api.invoke('bootstrap')).state.sessions.find((s) => s.id === standalone[0].id);
    // Autosave and another new-session request can overlap; contents must survive either ordering.
    await Promise.all([
      api.invoke('saveDraft', original.id, '并发草稿', ['输入 文件.txt'], [], []),
      api.invoke('newSession'),
    ]);
    return { standalone, project, state: (await api.invoke('bootstrap')).state };
  }, f.projectId);
  assert.equal(new Set(concurrent.standalone.map((s) => s.id)).size, 1);
  assert.equal(new Set(concurrent.project.map((s) => s.id)).size, 1);
  assert.notEqual(concurrent.project[0].id, concurrent.standalone[0].id);
  const savedConcurrent = concurrent.state.sessions.find((s) => s.id === concurrent.standalone[0].id);
  assert.equal(savedConcurrent.draft, '并发草稿');
  assert.deepEqual(savedConcurrent.attachments, ['输入 文件.txt']);
  for (let index = 0; index < protectedSessions.length; index++) {
    const saved = concurrent.state.sessions.find((s) => s.id === protectedSessions[index].id);
    assert.ok(saved);
    for (const [key, value] of Object.entries(protectedFields[index])) assert.deepEqual(saved[key], value);
  }
  const raceId = concurrent.state.sessions.find(
    (s) =>
      !s.file &&
      !s.draft &&
      !s.projectId &&
      s.title === '新对话' &&
      !s.model &&
      s.thinking === undefined &&
      s.approvalMode === undefined &&
      !s.pinned &&
      !s.unread &&
      !s.attachments.length &&
      !s.images?.length &&
      !s.draftSnippets?.length,
  )?.id;
  assert.ok(raceId, 'Need an untouched placeholder for cleanup confirmation race');
  await page.evaluate(() => {
    window.polishCleanup = window.desktop.invoke('cleanupEmptySessions');
  });
  const confirmation = page.getByRole('dialog', { name: /清理 .* 个空会话/ });
  await confirmation.waitFor();
  await page.evaluate(
    (id) => window.desktop.invoke('saveDraft', id, '确认期间到达的草稿', ['输入 文件.txt'], [], []),
    raceId,
  );
  await confirmation.getByRole('button', { name: '清理空会话', exact: true }).click();
  const removed = await page.evaluate(() => window.polishCleanup);
  assert.ok(removed > 0);
  const afterCleanup = await page.evaluate(async () => (await window.desktop.invoke('bootstrap')).state);
  assert.equal(afterCleanup.sessions.find((s) => s.id === raceId).draft, '确认期间到达的草稿');
  for (let index = 0; index < protectedSessions.length; index++) {
    const saved = afterCleanup.sessions.find((s) => s.id === protectedSessions[index].id);
    assert.ok(saved);
    for (const [key, value] of Object.entries(protectedFields[index])) assert.deepEqual(saved[key], value);
  }
  console.log('PASS confirmed cleanup rechecks an arriving draft and preserves every protected record');
  await page.evaluate((id) => window.desktop.invoke('selectSession', id), result.third.id);
  console.log(
    'PASS concurrent requests reuse one placeholder per scope and preserve autosaves and all protected metadata',
  );

  console.log('PASS real IPC reuses untouched placeholder, protects draft, and keeps Pi disconnected');

  const runtime = {
    ...emptyRuntime(),
    sessionId: result.third.id,
    status: 'completed',
    connected: true,
    messages: [
      { role: 'user', content: '第一轮', timestamp: 1000 },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'FIRST 中文思考' },
          { type: 'text', text: '中间说明' },
        ],
      },
      { role: 'toolResult', toolCallId: 'read', toolName: 'read', content: 'read output' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'SECOND_NEEDLE 完整保留' },
          { type: 'text', text: '最终结论' },
        ],
      },
      { role: 'user', content: '第二轮', timestamp: 2000 },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'THIRD 独立轮次' },
          { type: 'text', text: '第二轮结论' },
        ],
      },
    ],
    tools: [
      {
        id: 'read',
        name: 'read',
        args: { path: 'hello.txt' },
        status: 'done',
        output: '\x1b[32mread output\x1b[0m',
        startedAt: 1,
      },
    ],
  };
  await app.evaluate(({ ipcMain }, runtime) => {
    const handler = ipcMain._invokeHandlers.get('desktop:invoke');
    globalThis.polishRuntime = runtime;
    ipcMain.removeHandler('desktop:invoke');
    ipcMain.handle('desktop:invoke', async (event, method, args) => {
      if (method === 'readHistory') return globalThis.polishRuntime.messages;
      if (method === 'copy' && globalThis.polishFailCopy) throw new Error('Fixture clipboard unavailable');
      const value = await handler(event, method, args);
      return method === 'bootstrap' ? { ...value, runtime: globalThis.polishRuntime } : value;
    });
  }, runtime);
  await page.reload();
  await page.getByRole('textbox', { name: '任务输入' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.thinking').length === 2);
  assert.equal(await page.locator('.thinking[open]').count(), 0);
  await page.locator('.thinking summary').first().click();
  assert.equal(
    await page.locator('.thinking pre').first().textContent(),
    'FIRST 中文思考\n\nSECOND_NEEDLE 完整保留',
  );
  assert.ok(await page.getByText('最终结论', { exact: true }).isVisible());
  await page.getByRole('button', { name: '收起所有思考过程', exact: true }).click();
  assert.equal(await page.locator('.thinking[open]').count(), 0);
  await page.evaluate(() => window.dispatchEvent(new Event('pi:find')));
  await page.getByRole('textbox', { name: '查找当前会话' }).fill('SECOND_NEEDLE');
  await page.locator('.thinking .search-current').waitFor();
  assert.equal(await page.locator('.thinking .search-current').textContent(), 'SECOND_NEEDLE');
  assert.equal(await page.locator('.thinking[open]').count(), 1);
  await page.getByRole('button', { name: '关闭会话查找' }).click();
  console.log(
    'PASS one thinking region per turn, ordered content, collapsed history, batch collapse and search',
  );

  // Publish actual IPC runtime events to exercise the same mounted thinking block during streaming.
  const publish = async (patch) =>
    app.evaluate(({ BrowserWindow }, patch) => {
      Object.assign(globalThis.polishRuntime, patch);
      BrowserWindow.getAllWindows()[0].webContents.send('desktop:event', {
        type: 'runtime',
        runtime: globalThis.polishRuntime,
      });
    }, patch);
  await publish({ status: 'running' });
  await page.locator('.thinking summary').last().click();
  await page.waitForFunction(() => document.querySelectorAll('.thinking[open]').length === 1);
  const appended = structuredClone(runtime.messages);
  appended[appended.length - 1].content[0].thinking += '\nSTREAM_APPEND';
  await publish({ messages: appended });
  assert.equal(await page.locator('.thinking').count(), 2);
  assert.ok((await page.locator('.thinking pre').last().textContent()).includes('STREAM_APPEND'));
  await publish({ status: 'completed' });
  await page.waitForFunction(() => document.querySelectorAll('.thinking[open]').length === 0);
  const longTurn = [
    runtime.messages[0],
    ...Array.from({ length: 100 }, (_, i) => ({
      role: 'assistant',
      content: [{ type: 'thinking', thinking: `PAGE_${i}` }],
      timestamp: 10000 + i,
    })),
  ];
  await publish({ messages: longTurn });
  await page.waitForFunction(() => document.querySelectorAll('.thinking').length === 1);
  await page.locator('.thinking summary').click();
  assert.ok((await page.locator('.thinking pre').textContent()).startsWith('PAGE_0\n\nPAGE_1'));
  assert.ok((await page.locator('.thinking pre').textContent()).endsWith('PAGE_99'));
  await publish({ messages: runtime.messages });
  await page.waitForFunction(() => document.querySelectorAll('.thinking').length === 2);
  console.log(
    'PASS streaming append retains one region, completion collapses it, and pagination retains complete thinking',
  );

  await page.locator('.tool-card summary').click();
  const copy = page.getByRole('button', { name: '复制输出', exact: true });
  assert.equal(await copy.textContent(), '');
  await copy.click();
  await page.getByRole('status').filter({ hasText: '已复制' }).waitFor();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'read output');
  const font = await page
    .locator('.thinking pre')
    .first()
    .evaluate((el) => ({ size: getComputedStyle(el).fontSize, family: getComputedStyle(el).fontFamily }));
  assert.equal(font.size, '13px');
  assert.ok(!font.family.includes('Consolas'));
  assert.equal(
    await page
      .locator('.tool-body pre')
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
    '13px',
  );
  assert.equal(
    await page.locator('.sidebar-footer').getByRole('button', { name: '打开项目', exact: true }).count(),
    0,
  );
  const add = await page.getByRole('button', { name: '添加项目', exact: true }).boundingBox();
  const last = await page.locator('.project-actions .icon-button').last().boundingBox();
  assert.ok(Math.abs(add.x + add.width / 2 - last.x - last.width / 2) < 1);
  const sessionMenu = await page
    .locator(`[data-session-id="${result.third.id}"] > .icon-button`)
    .boundingBox();
  assert.ok(Math.abs(add.x + add.width / 2 - sessionMenu.x - sessionMenu.width / 2) < 1);
  await copy.evaluate((button) => button.focus());
  await page.keyboard.press('Enter');
  await page.getByRole('status').filter({ hasText: '已复制' }).waitFor();
  await app.evaluate(() => {
    globalThis.polishFailCopy = true;
  });
  await copy.click();
  await page.getByRole('status').filter({ hasText: '复制失败' }).waitFor();
  assert.equal(await copy.locator('.lucide-check').count(), 0);
  await app.evaluate(() => {
    globalThis.polishFailCopy = false;
  });
  await copy.click();
  await page.getByRole('status').filter({ hasText: '已复制' }).waitFor();
  await page.locator('.thinking summary').first().click();
  await page.locator('.thread').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: path.join(output, 'light.png') });
  await page.evaluate(async () => {
    const { state } = await window.desktop.invoke('bootstrap');
    await window.desktop.invoke('saveSettings', { ...state.settings, theme: 'dark' });
  });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: path.join(output, 'dark.png') });
  console.log('PASS clipboard feedback, readable fonts, project entry and alignment; light/dark screenshots');
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await app?.close();
  await provider.close();
}
