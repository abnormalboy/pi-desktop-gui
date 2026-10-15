import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { emptyRuntime } from '../shared/types.ts';
import { createLocalProvider, prepareRealPiFixture } from '../tests/support/local-provider.ts';

// All messages, images and commands are local fixtures. Command reruns are captured, never executed.
const provider = await createLocalProvider();
const fixture = await prepareRealPiFixture(provider.baseUrl, 'conversation-v014-ui');
for (const name of ['alpha.ts', 'beta.ts', 'gamma.ts'])
  await fs.writeFile(path.join(fixture.projectDir, name), 'line1\nline2\nline3\nline4\nline5\n');
const runtime = {
  ...emptyRuntime(),
  sessionId: fixture.sessionId,
  connected: true,
  status: 'completed',
  stats: { tokens: 12000, contextPercent: 80, contextTokens: 8000, contextWindow: 10000, cost: 0.02 },
  commands: [
    { name: 'check-diff', source: 'prompt', argumentHint: '<模块名> [关注点]', description: '检查模块' },
  ],
};
for (let index = 0; index < 500; index++)
  runtime.messages.push({
    role: index % 2 ? 'assistant' : 'user',
    content: `历史消息 ${index}`,
    timestamp: 1700000000000 + index,
  });
runtime.messages[9].content = 'EARLY_NEEDLE';
runtime.messages[11].content = [
  { type: 'thinking', thinking: 'HIDDEN_THINKING_NEEDLE' },
  { type: 'text', text: '想好了' },
];
runtime.messages[12].content =
  '提问\n\n<project_file path="alpha.ts" lines="3-4">\nREFERENCE_NEEDLE\n</project_file>';
runtime.messages.push({ role: 'user', content: '最后一轮检查', timestamp: 1700000100000 });
for (let index = 0; index < 5; index++) {
  const tool = {
    id: `read-${index}`,
    name: index % 2 ? 'grep' : 'read',
    args: { path: 'alpha.ts' },
    status: 'done',
    output:
      index === 3 ? 'GROUP_NEEDLE first\n' + 'output line\n'.repeat(250) + 'GROUP_NEEDLE last' : 'success',
    startedAt: 1,
    durationMs: 200,
  };
  runtime.tools.push({ ...tool, output: tool.output.split('\n').slice(-200).join('\n') });
  runtime.messages.push(
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: tool.id, name: tool.name, arguments: tool.args }],
    },
    { role: 'toolResult', toolCallId: tool.id, toolName: tool.name, content: tool.output },
  );
}
runtime.messages.push({
  role: 'assistant',
  content: '```ts\nconst value = "hello";\nconsole.log(value);\n```',
});
runtime.tools.push({
  id: 'shell',
  name: 'bash',
  args: { command: 'npm test' },
  status: 'done',
  output: '\x1b[32mPASS\x1b[0m\nprogress 1%\r\x1b[2Kprogress 100%',
  startedAt: 2,
  durationMs: 300,
});
const output = path.resolve('test-results', 'conversation-v014');
await fs.mkdir(output, { recursive: true });
let app, page;
const errors = [];
const waitSaved = async (predicate) => {
  for (let index = 0; index < 150; index++) {
    const state = JSON.parse(await fs.readFile(path.join(fixture.dataDir, 'state.json'), 'utf8'));
    if (predicate(state.sessions.find((item) => item.id === fixture.sessionId))) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Draft did not persist');
};
const waitSettings = async (key, expected) => {
  for (let index = 0; index < 150; index++) {
    const state = JSON.parse(await fs.readFile(path.join(fixture.dataDir, 'state.json'), 'utf8'));
    if (state.settings[key] === expected) {
      await page.waitForFunction(
        ({ label, expected }) =>
          document
            .querySelector(`[role="separator"][aria-label="${label}"]`)
            ?.getAttribute('aria-valuenow') === String(expected),
        { label: key === 'sidebarWidth' ? '项目侧栏宽度' : '文件面板宽度', expected },
      );
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`${key} did not persist as ${expected}`);
};
try {
  app = await electron.launch({
    args: [path.resolve('.')],
    env: { ...process.env, PI_DESKTOP_DATA_DIR: fixture.dataDir, PI_OFFLINE: '1' },
    timeout: 30000,
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('textbox', { name: '任务输入' }).waitFor();
  await app.evaluate(({ ipcMain }, runtime) => {
    globalThis.conversationCalls = [];
    const handler = ipcMain._invokeHandlers.get('desktop:invoke');
    ipcMain.removeHandler('desktop:invoke');
    ipcMain.handle('desktop:invoke', async (event, method, args) => {
      if (method === 'readHistory') return runtime.messages;
      if (['send', 'copy', 'copyImage', 'compact', 'branchSession'].includes(method)) {
        globalThis.conversationCalls.push({ method, args });
        return method === 'compact' ? { tokensBefore: 8000 } : undefined;
      }
      const result = await handler(event, method, args);
      return method === 'bootstrap' ? { ...result, runtime } : result;
    });
  }, runtime);
  await page.reload();
  await page.bringToFront();
  const input = page.getByRole('textbox', { name: '任务输入' });
  await input.waitFor();
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const leftSash = page.getByRole('separator', { name: '项目侧栏宽度' });
  await leftSash.waitFor();
  await leftSash.press('Home');
  await waitSettings('sidebarWidth', 240);
  await leftSash.evaluate((element) => {
    for (let count = 0; count < 3; count++)
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  await waitSettings('sidebarWidth', 270);
  await leftSash.press('Home');
  await waitSettings('sidebarWidth', 240);
  await leftSash.press('ArrowRight');
  await waitSettings('sidebarWidth', 250);
  let bounds = await leftSash.boundingBox();
  await page.mouse.move(bounds.x + 2, bounds.y + 200);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 32, bounds.y + 200, { steps: 8 });
  await page.mouse.up();
  await waitSettings('sidebarWidth', 280);
  await page.reload();
  await leftSash.waitFor();
  assert.equal(await leftSash.getAttribute('aria-valuenow'), '280');
  await leftSash.dblclick();
  await waitSettings('sidebarWidth', 240);
  await input.press(modifier + '+j');
  const rightSash = page.getByRole('separator', { name: '文件面板宽度' });
  await rightSash.waitFor();
  await rightSash.press('Home');
  await waitSettings('inspectorWidth', 380);
  await rightSash.press('ArrowLeft');
  await waitSettings('inspectorWidth', 390);
  bounds = await rightSash.boundingBox();
  await page.mouse.move(bounds.x + 2, bounds.y + 180);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 38, bounds.y + 180, { steps: 8 });
  await page.mouse.up();
  await waitSettings('inspectorWidth', 430);
  await page.reload();
  await input.waitFor();
  await input.press(modifier + '+j');
  await rightSash.waitFor();
  assert.equal(await rightSash.getAttribute('aria-valuenow'), '430');
  await rightSash.dblclick();
  await waitSettings('inspectorWidth', 380);
  await input.press('Alt+2');
  assert.ok(await page.locator('.inspector-tabs button.active').filter({ hasText: '文件' }).count());
  await input.press('Alt+3');
  assert.ok(await page.locator('.inspector-tabs button.active').filter({ hasText: '输出' }).count());
  await input.press('Alt+1');
  assert.ok(await page.locator('.inspector-tabs button.active').filter({ hasText: '变更' }).count());
  await input.press(modifier + '+j');
  await rightSash.waitFor({ state: 'detached' });
  console.log(
    'PASS both width separators drag, keyboard, reload persistence, double-click reset and panel shortcuts',
  );
  assert.equal(await page.locator('[data-message-index="9"]').count(), 0);
  await input.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  const find = page.getByRole('textbox', { name: '查找当前会话' });
  await find.fill('EARLY_NEEDLE');
  await page.locator('[data-message-index="9"].search-active').waitFor();
  assert.ok(await page.locator('[data-message-index="9"]').isVisible());
  await find.fill('HIDDEN_THINKING_NEEDLE');
  await page.locator('.thinking[open]').waitFor();
  await find.fill('REFERENCE_NEEDLE');
  await page.locator('.message-attachment[open]').waitFor();
  await find.fill('GROUP_NEEDLE');
  await page.locator('.tool-group[open] .tool-card[open]').waitFor();
  assert.match(await page.locator('.search-active .tool-body').textContent(), /GROUP_NEEDLE first/);
  await find.press('Enter');
  await page.waitForFunction(
    () => document.querySelector('.search-active .search-current')?.parentElement?.scrollTop > 0,
  );
  const searchTiming = await page.evaluate(async () => {
    const input = document.querySelector('[aria-label="查找当前会话"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const durations = [];
    let unrelatedMutations = 0;
    const history = document.querySelector('[data-message-index="100"]');
    const historyObserver = new MutationObserver((records) => {
      unrelatedMutations += records.length;
    });
    historyObserver.observe(history, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    for (let index = 0; index < 30; index++) {
      const needle = index % 2 ? 'EARLY_NEEDLE' : 'HIDDEN_THINKING_NEEDLE';
      const started = performance.now();
      await new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          if (!document.querySelector('.search-active')?.textContent.includes(needle)) return;
          observer.disconnect();
          resolve();
        });
        observer.observe(document.querySelector('.thread'), {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        set.call(input, needle);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      durations.push(performance.now() - started);
    }
    historyObserver.disconnect();
    durations.sort((a, b) => a - b);
    return { medianMs: durations[15], p95Ms: durations[28], unrelatedMutations };
  });
  console.log('Search/highlight UI performance', searchTiming);
  assert.equal(searchTiming.unrelatedMutations, 0);
  assert.ok(searchTiming.medianMs < 16, `Search/highlight median ${searchTiming.medianMs}ms exceeds 16ms`);
  await find.press('Escape');
  assert.equal(await find.count(), 0);
  console.log('PASS search across 500 messages, thinking, attachments and grouped tools');

  const groups = page.locator('.tool-group');
  assert.equal(await groups.count(), 1);
  assert.match(await groups.locator('summary').first().textContent(), /已探索 5 项/);
  assert.equal(await page.locator('.tool-rerun').count(), 1);
  await page.getByTitle('本地重跑（不发给模型）').click();
  await page.getByTitle('重跑并发给 Pi', { exact: true }).click();
  const reruns = await app.evaluate(() =>
    globalThis.conversationCalls.filter((call) => call.method === 'send'),
  );
  assert.equal(reruns.at(-2).args[1], '!!npm test');
  assert.equal(reruns.at(-1).args[1], '!npm test');
  await page.getByTitle(/^第 2 轮：/).click();
  await page.waitForFunction(
    () => document.querySelector('[data-message-index="2"]')?.getBoundingClientRect().top < 250,
  );
  console.log('PASS tool groups, turn navigation and both explicit command reruns');

  const code = page.locator('.code-block').last();
  assert.match(await code.locator('.code-header').textContent(), /ts · 2 行/);
  assert.equal(await code.locator('.syntax-keyword').count(), 1);
  await code.getByRole('button', { name: '自动换行' }).click();
  assert.equal(await code.getAttribute('class'), 'code-block code-wrap');
  await code.getByRole('button', { name: '复制代码' }).click();
  await code.getByText('已复制', { exact: true }).waitFor();
  const shell = page.locator('.tool-card').filter({ hasText: 'npm test' });
  await shell.locator('summary').click();
  await shell.locator('.ansi-green').waitFor();
  assert.match(await shell.locator('.ansi-output').textContent(), /PASS\nprogress 100%/);
  await shell.getByRole('button', { name: '复制输出', exact: true }).click();
  const copied = await app.evaluate(() =>
    globalThis.conversationCalls.filter((call) => call.method === 'copy').at(-1),
  );
  assert.equal(copied.args[0].includes('\x1b'), false);
  console.log('PASS code header, syntax, wrapping, copy feedback and clean ANSI output');

  await input.fill('@');
  await page.getByRole('option').nth(2).waitFor();
  const third = await page.locator('.file-picker [role="option"]').nth(2).innerText();
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('Tab');
  await page.locator('.attachments').getByRole('button', { name: third.trim(), exact: true }).waitFor();
  await input.fill('@alpha.ts:3-4');
  await page.locator('.file-picker [role="option"]').first().waitFor();
  await input.press('Enter');
  await page.getByRole('button', { name: 'alpha.ts#L3-L4', exact: true }).waitFor();
  while (await page.getByTitle(/^移除引用 /).count())
    await page
      .getByTitle(/^移除引用 /)
      .first()
      .click();
  await input.fill('before ');
  const pasted = Array.from({ length: 60 }, (_, index) => `log ${index}`).join('\n');
  await input.evaluate((element, text) => {
    element.setSelectionRange(element.value.length, element.value.length);
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, pasted);
  await page.getByRole('button', { name: /^粘贴片段 · 60 行/ }).waitFor();
  assert.equal(await input.inputValue(), 'before ');
  await input.focus();
  await page.keyboard.insertText(' after');
  await waitSaved(
    (session) => session.draftSnippets?.[0]?.text === pasted && session.draft === 'before  after',
  );
  await page.reload();
  await page.getByRole('button', { name: /^粘贴片段 · 60 行/ }).waitFor();
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  const sent = await app.evaluate(() =>
    globalThis.conversationCalls.filter((call) => call.method === 'send').at(-1),
  );
  assert.equal(sent.args[1], 'before ' + pasted + ' after');
  await page.getByRole('button', { name: /^粘贴片段 · 60 行/ }).click();
  await page.getByRole('button', { name: '展开到输入框' }).click();
  assert.equal(await input.inputValue(), 'before ' + pasted + ' after');
  const heightHandle = page.getByRole('separator', { name: '调整输入框高度' });
  await heightHandle.evaluate((element) => {
    for (let index = 0; index < 7; index++)
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  });
  await page.waitForFunction(
    () => document.querySelector('[aria-label="调整输入框高度"]')?.getAttribute('aria-valuenow') === '55',
  );
  const composerBounds = await page.evaluate(() => ({
    inputHeight: document.querySelector('[aria-label="任务输入"]').getBoundingClientRect().height,
    bottom: document.querySelector('.composer-bottom').getBoundingClientRect().bottom,
    viewport: innerHeight,
  }));
  assert.ok(
    composerBounds.inputHeight >= composerBounds.viewport * 0.5 &&
      composerBounds.bottom <= composerBounds.viewport,
    JSON.stringify(composerBounds),
  );
  await heightHandle.evaluate((element) => {
    for (let index = 0; index < 7; index++)
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  console.log('PASS @ keyboard choice/ranges and long paste persistence, ordering and expansion');

  await input.fill('');
  for (const bytes of [550 * 1024, 600 * 1024]) {
    await input.evaluate((element, bytes) => {
      const data = new DataTransfer();
      data.setData('text/plain', 'x'.repeat(bytes));
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, bytes);
    await waitSaved(
      (session) => (session.draftSnippets ?? []).reduce((sum, item) => sum + item.text.length, 0) >= bytes,
    );
  }
  await page.locator('.attachment-capacity.over').waitFor();
  assert.match(await page.locator('.attachment-capacity.over').textContent(), /占用最多：粘贴片段/);
  assert.equal(await page.getByRole('button', { name: '发送任务', exact: true }).isDisabled(), true);
  while (await page.getByTitle('移除粘贴片段', { exact: true }).count())
    await page.getByTitle('移除粘贴片段', { exact: true }).first().click();
  console.log('PASS capacity warning, largest attachment and 1 MiB send limit');

  await input.fill('/check-diff');
  await page.getByRole('textbox', { name: '模板参数：模块名' }).fill('src/hello world');
  await page.getByRole('textbox', { name: '模板参数：关注点' }).fill('errors');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  const template = await app.evaluate(() =>
    globalThis.conversationCalls.filter((call) => call.method === 'send').at(-1),
  );
  assert.equal(template.args[1], '/check-diff "src/hello world" errors');
  await page.locator('.context-meter.mid').click();
  await page.getByRole('button', { name: '立即压缩上下文' }).click();
  assert.equal(
    await app.evaluate(() => globalThis.conversationCalls.some((call) => call.method === 'compact')),
    true,
  );
  console.log('PASS template parameters and context warning action');

  const pixel =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XkAAAAASUVORK5CYII=';
  await page.evaluate(
    ({ id, pixel }) =>
      window.desktop.invoke(
        'saveDraft',
        id,
        '',
        [],
        [
          { id: 'pixel1', name: '第一张', mimeType: 'image/png', data: pixel },
          { id: 'pixel2', name: '第二张', mimeType: 'image/png', data: pixel },
        ],
        [],
      ),
    { id: fixture.sessionId, pixel },
  );
  await page.getByRole('button', { name: '查看图片 第一张' }).click();
  const lightbox = page.getByRole('dialog', { name: '图片查看器' });
  await lightbox.waitFor();
  await lightbox.getByRole('button', { name: '下一张图片' }).click();
  assert.match(await lightbox.textContent(), /第二张 · 2 \/ 2/);
  await lightbox.getByRole('button', { name: '放大图片' }).click();
  await lightbox.getByRole('button', { name: '复制图片', exact: true }).click();
  await lightbox.getByText('图片已复制').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await lightbox.count(), 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'conversation-v014.png'), animations: 'disabled' });
  console.log('PASS image lightbox zoom, navigation, clipboard IPC and Escape');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, 'failed.png'), animations: 'disabled' });
    console.error(
      await page
        .locator('.error-banner, .attachments, .file-picker, [aria-label="任务输入"]')
        .allTextContents(),
    );
  }
  throw error;
} finally {
  await app?.close();
  await provider.close();
}
