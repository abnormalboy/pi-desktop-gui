import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLocalProvider, prepareRealPiFixture } from '../tests/support/local-provider.ts';

const provider = await createLocalProvider();
const fixture = await prepareRealPiFixture(provider.baseUrl, 'chat-ui');
fixture.store.state.projects = [];
fixture.store.state.sessions = [];
delete fixture.store.state.selectedProjectId;
delete fixture.store.state.selectedSessionId;
await fixture.store.save();
const output = path.resolve('test-results');
await fs.mkdir(output, { recursive: true });
const errors = [];
let app, page;
const launch = async () => {
  app = await electron.launch({
    executablePath: process.env.PI_DESKTOP_EXE,
    args: process.env.PI_DESKTOP_EXE ? [] : [path.resolve('.')],
    env: { ...process.env, PI_DESKTOP_DATA_DIR: fixture.dataDir, PI_OFFLINE: '1' },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.getByRole('textbox', { name: '任务输入' }).waitFor();
};
const waitForSaved = async (predicate) => {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const state = JSON.parse(await fs.readFile(path.join(fixture.dataDir, 'state.json'), 'utf8'));
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Conversation state was not saved');
};
try {
  await launch();
  await page.getByText('有什么想聊的？', { exact: true }).waitFor();
  assert.equal(await page.locator('.project-row').count(), 0);
  assert.equal(await page.locator('.standalone-sessions .session-row').count(), 1);
  assert.equal(await page.locator('.trust-banner, .workspace-toggle').count(), 0);
  assert.equal(await page.getByRole('textbox', { name: '任务输入' }).isEnabled(), true);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(output, 'standalone-empty.png'), animations: 'disabled' });

  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '连接 Pi', exact: true }).click();
  await page.getByRole('combobox', { name: '选择模型', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.querySelector('select[aria-label="选择模型"]')?.value === 'local-e2e::local-e2e',
  );
  await page.getByRole('button', { name: '测试模型连接', exact: true }).click();
  await page.locator('.test-result').filter({ hasText: 'OK' }).waitFor({ timeout: 25000 });
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  const input = page.getByRole('textbox', { name: '任务输入' });
  await input.fill('@普通消息：不打开工作区也能聊。');
  assert.equal(await page.locator('.file-picker').count(), 0);
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await page.locator('.run-meta .status.completed').waitFor({ timeout: 25000 });
  await page.locator('.message').filter({ hasText: 'OK' }).waitFor();
  assert.equal(provider.requests.at(-1).tools?.length ?? 0, 0);
  const first = (await waitForSaved((state) => !!state.sessions[0]?.file)).sessions[0];
  await input.fill('独立对话未发送草稿');
  await waitForSaved(
    (state) => state.sessions.find((s) => s.id === first.id)?.draft === '独立对话未发送草稿',
  );
  await page.keyboard.press('Control+n');
  await page.waitForFunction(
    () => document.querySelectorAll('.standalone-sessions .session-row').length === 2,
  );
  assert.equal(await input.inputValue(), '');
  await input.fill('第二条独立对话');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await page.locator('.run-meta .status.completed').waitFor({ timeout: 25000 });
  await page.locator('.standalone-sessions').getByRole('button', { name: first.title, exact: true }).click();
  await page.waitForFunction(() => document.querySelector('textarea')?.value === '独立对话未发送草稿');
  assert.equal(await page.locator('.message').filter({ hasText: '第二条独立对话' }).count(), 0);
  await page.screenshot({ path: path.join(output, 'standalone-conversation.png'), animations: 'disabled' });
  await app.close();
  app = undefined;
  await launch();
  await page.waitForFunction(() => document.querySelector('textarea')?.value === '独立对话未发送草稿');
  await page.locator('.message').filter({ hasText: 'OK' }).waitFor();
  assert.equal(await page.locator('.standalone-sessions .session-row').count(), 2);
  assert.equal(await page.locator('.project-row').count(), 0);
  console.log('PASS fresh startup, model selection/probe, send, Ctrl+N, separate histories and restart');

  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: '搜索项目和会话' }).fill('第二条独立对话');
  await page
    .locator('.search-results')
    .getByRole('button', { name: /第二条独立对话/ })
    .click();
  await page.getByRole('heading', { level: 1, name: '第二条独立对话' }).waitFor();
  // Native picker is supplied a temporary test project; no user folders or settings are touched.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, fixture.projectDir);
  await page.getByRole('button', { name: '打开项目', exact: true }).click();
  await page.locator('.trust-banner').waitFor();
  await page.getByRole('textbox', { name: '任务输入' }).fill('项目仍然需要启用');
  assert.equal(await page.getByRole('button', { name: '发送任务', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: /^新建对话/ }).click();
  await page.getByText('有什么想聊的？', { exact: true }).waitFor();
  assert.equal(await page.locator('.trust-banner, .workspace-toggle').count(), 0);
  await page.getByRole('textbox', { name: '任务输入' }).fill('从项目中直接新建独立对话');
  assert.equal(await page.getByRole('button', { name: '发送任务', exact: true }).isEnabled(), true);
  assert.equal(await page.locator('.project-row').count(), 1);
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await page.locator('.run-meta .status.completed').waitFor({ timeout: 25000 });
  await page.locator('.project-row').click();
  await page.locator('.trust-banner').waitFor();
  assert.equal(await page.getByRole('button', { name: '发送任务', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '在 project 中新建会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.project-group .session-row').length === 2);
  assert.equal(await page.locator('.project-group .session-row').count(), 2);
  assert.equal(await page.locator('.standalone-sessions .session-row').count(), 3);
  console.log('PASS standalone search, global new chat from project, project creation and trust retained');
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, 'chat-ui-result.json'),
    JSON.stringify(
      {
        result: 'PASS',
        fixture: fixture.dir,
        checks: [
          'zero-project startup',
          'model picker and connection probe',
          'plain @ text',
          'real Pi response without tools',
          'Ctrl+N',
          'independent histories',
          'draft/history restart',
          'search',
          'global new chat',
          'project new session',
          'project trust retained',
        ],
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'chat-ui-failure.png') });
  console.error('Renderer errors:', errors);
  throw error;
} finally {
  if (app) await app.close();
  await provider.close();
}
