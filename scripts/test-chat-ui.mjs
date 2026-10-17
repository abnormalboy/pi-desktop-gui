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
const piPath = fixture.store.state.settings.piPath;
fixture.store.state.settings.piPath = path.join(fixture.dir, 'missing-pi.js');
const modelsPath = path.join(fixture.agentDir, 'models.json');
const modelConfig = JSON.parse(await fs.readFile(modelsPath, 'utf8'));
const baseModel = modelConfig.providers['local-e2e'].models[0];
const extraModels = Array.from({ length: 24 }, (_, i) => ({
  ...baseModel,
  id: `local-e2e-${i}`,
  name: `滚动测试模型 ${i}`,
}));
modelConfig.providers['local-e2e'].models.push(...extraModels);
await fs.writeFile(modelsPath, JSON.stringify(modelConfig));
await fixture.store.save();
const output = path.resolve('test-results');
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
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
  const picker = page.getByRole('dialog', { name: '模型与推理级别' });
  await picker.getByText(/^连接 Pi 失败：/).waitFor();
  assert.equal(await picker.locator('.spin').count(), 0);
  await page.evaluate((value) => window.desktop.invoke('saveSettings', { piPath: value }), piPath);
  await picker.getByRole('button', { name: '重新连接 Pi', exact: true }).click();
  await picker.getByText('正在连接 Pi 读取模型…', { exact: true }).waitFor();
  await picker
    .getByRole('option', { name: /local-e2e/ })
    .first()
    .waitFor({ timeout: 25000 });
  const search = picker.getByRole('textbox', { name: '搜索模型' });
  const lastModel = extraModels.at(-1);
  await search.fill(lastModel.id);
  await search.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  assert.equal(await picker.isVisible(), true, 'IME confirmation must keep the model picker open');
  assert.equal(
    JSON.parse(await fs.readFile(path.join(fixture.dataDir, 'state.json'), 'utf8')).settings.modelId,
    baseModel.id,
    'IME confirmation must not change the model',
  );
  await search.press('Enter');
  await picker.waitFor({ state: 'detached' });
  await waitForSaved((state) => state.settings.modelId === lastModel.id);
  await page.waitForFunction(
    (name) => document.querySelector('.model-pill > span')?.textContent === name,
    lastModel.name,
  );
  const currentModelVisible = () => {
    const list = document.querySelector('.model-list');
    const current = list?.querySelector('[aria-current="true"]');
    if (!list || !current) return false;
    const bounds = list.getBoundingClientRect(),
      selected = current.getBoundingClientRect();
    return selected.top >= bounds.top - 1 && selected.bottom <= bounds.bottom + 1;
  };
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.waitForFunction(currentModelVisible);
  await search.press('Escape');
  await picker.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.waitForFunction(currentModelVisible);
  await search.fill(baseModel.name);
  await search.press('Enter');
  await picker.waitFor({ state: 'detached' });
  await waitForSaved((state) => state.settings.modelId === baseModel.id);
  await page.locator('.run-meta .status.idle').waitFor({ timeout: 25000 });
  console.log('PASS model picker connection failure/retry, IME confirmation and reopen scroll');
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await picker.getByRole('button', { name: '连接设置', exact: true }).click();
  await page.getByRole('combobox', { name: '选择模型', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.querySelector('select[aria-label="选择模型"]')?.value === 'local-e2e::local-e2e',
  );
  await page.getByRole('button', { name: '测试模型连接', exact: true }).click();
  await page.locator('.test-result').filter({ hasText: 'OK' }).waitFor({ timeout: 25000 });
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  const input = page.getByRole('textbox', { name: '任务输入' });
  const first = (await waitForSaved((state) => !!state.sessions[0]?.id)).sessions[0];
  assert.equal(first.title, '新对话');
  const firstPrompt = '@普通消息：不打开工作区也能聊。';
  await input.fill(firstPrompt);
  assert.equal(await page.locator('.file-picker').count(), 0);
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await page.locator('.run-meta .status.completed').waitFor({ timeout: 25000 });
  await page.locator('.message').filter({ hasText: 'OK' }).waitFor();
  assert.ok(provider.requests.at(-1).tools?.length > 0);
  await waitForSaved((state) => !!state.sessions.find((s) => s.id === first.id)?.file);
  await input.fill('独立对话未发送草稿');
  await waitForSaved(
    (state) => state.sessions.find((s) => s.id === first.id)?.draft === '独立对话未发送草稿',
  );
  // Pi can choose its native default without a desktop model preference being saved.
  await page.evaluate(() => window.desktop.invoke('saveSettings', { provider: '', modelId: '' }));
  await waitForSaved((state) => !state.settings.modelId && !state.settings.provider);
  await page.keyboard.press(`${modifier}+n`);
  await page.waitForFunction(
    () => document.querySelectorAll('.standalone-sessions .session-row').length === 2,
  );
  assert.equal(await input.inputValue(), '');
  assert.equal(
    await page.locator('.readiness').count(),
    0,
    'a new chat with known available models must not repeat first-run model setup',
  );
  assert.equal(await page.locator('.model-pill > span').textContent(), 'Pi 默认模型');
  assert.equal(await page.locator('.model-pill > em').count(), 0);
  console.log('PASS new chat uses Pi defaults without stale model/thinking or repeated setup');
  await input.fill('第二条独立对话');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await page.locator('.run-meta .status.completed').waitFor({ timeout: 25000 });
  // A saved session file can precede the automatic title update. Select the same session
  // by its stable ID and also verify that its title caught up, without reusing a stale title.
  const firstRow = page.locator(`.standalone-sessions .session-row[data-session-id="${first.id}"]`);
  await firstRow.getByRole('button', { name: firstPrompt, exact: true }).waitFor();
  await firstRow.locator(':scope > button').first().click();
  await waitForSaved((state) => state.selectedSessionId === first.id);
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
  console.log('PASS fresh startup, model selection/probe, send, Ctrl/Cmd+N, separate histories and restart');

  await page.keyboard.press(`${modifier}+k`);
  const sessionSearch = page.getByRole('textbox', { name: '搜索项目和会话' });
  await sessionSearch.fill('第二条独立对话');
  await page.getByRole('option', { name: /第二条独立对话/ }).waitFor();
  await sessionSearch.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  assert.equal(await page.getByRole('dialog', { name: '快速切换' }).isVisible(), true);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(fixture.dataDir, 'state.json'), 'utf8')).selectedSessionId,
    first.id,
    'IME confirmation must not switch the selected session',
  );
  await page
    .locator('.search-results')
    .getByRole('option', { name: /第二条独立对话/ })
    .click();
  await page.getByRole('heading', { level: 1, name: '第二条独立对话' }).waitFor();
  // Restart clears the registry cache. Load real Pi models before the button-path
  // regression, which covers an already-configured app with known available models.
  await page.evaluate(async () => {
    const { state } = await window.desktop.invoke('bootstrap');
    await window.desktop.invoke('connect', state.selectedSessionId);
  });
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
  assert.equal(await page.locator('.readiness').count(), 0);
  assert.equal(await page.locator('.model-pill > span').textContent(), 'Pi 默认模型');
  await page.getByRole('textbox', { name: '任务输入' }).fill('从项目中直接新建独立对话');
  assert.equal(await page.getByRole('button', { name: '发送任务', exact: true }).isEnabled(), true);
  assert.equal(await page.locator('.project-row').count(), 1);
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await page.locator('.run-meta .status.completed').waitFor({ timeout: 25000 });
  await page.locator('.project-row').click();
  assert.equal(
    await page.locator('.trust-banner').count(),
    0,
    'expanding a project does not switch the current session',
  );
  if ((await page.locator('.project-row').getAttribute('aria-expanded')) !== 'true')
    await page.locator('.project-row').click();
  await page.locator('.project-group .session-row > button').first().click();
  await page.locator('.trust-banner').waitFor();
  assert.equal(await page.getByRole('button', { name: '发送任务', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '在 project 中新建会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.project-group .session-row').length === 2);
  assert.equal(await page.locator('.project-group .session-row').count(), 2);
  assert.equal(await page.locator('.standalone-sessions .session-row').count(), 3);
  console.log('PASS standalone search, global new chat from project, project creation and trust retained');

  const saved = await waitForSaved((state) =>
    state.sessions.some((session) => session.title === '第二条独立对话'),
  );
  const missingFileSession = saved.sessions.find((session) => session.title === '第二条独立对话');
  assert.ok(missingFileSession.file);
  const sessionFile = path.resolve(missingFileSession.file);
  const sessionDirectory = path.resolve(fixture.dataDir, 'sessions');
  assert.equal(path.dirname(sessionFile), sessionDirectory, 'only remove the isolated test session file');
  await fs.unlink(sessionFile);
  await page.getByRole('button', { name: `${missingFileSession.title} 会话操作`, exact: true }).click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page
    .getByRole('dialog', { name: `删除会话“${missingFileSession.title}”？` })
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await waitForSaved((state) => !state.sessions.some((session) => session.id === missingFileSession.id));
  await page
    .getByRole('button', { name: `${missingFileSession.title} 会话操作`, exact: true })
    .waitFor({ state: 'detached' });
  assert.equal(await page.locator('.standalone-sessions .session-row').count(), 2);
  console.log('PASS IME session search and deletion after the session file is missing');
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
          'model picker connection failure and retry',
          'model picker IME confirmation',
          'model picker current model visible after reopening',
          'plain @ text',
          'real Pi response with tools available',
          'Ctrl/Cmd+N',
          'new chat native defaults without stale model/thinking or repeated setup',
          'independent histories',
          'draft/history restart',
          'search',
          'session search IME confirmation',
          'delete session with missing history file',
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
