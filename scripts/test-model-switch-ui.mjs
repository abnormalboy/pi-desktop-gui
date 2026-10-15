import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { prepareRealPiFixture } from '../tests/support/local-provider.ts';

process.env.PI_OFFLINE = '1';
const requests = [];
let releaseResponse;
const responseGate = new Promise((resolve) => {
  releaseResponse = resolve;
});
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  requests.push(body);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (delta, finish_reason = null) =>
    res.write(
      `data: ${JSON.stringify({
        id: 'model-switch',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`,
    );
  send({ role: 'assistant', content: requests.length === 1 ? 'CURRENT_RESPONSE_A' : 'NEXT_RESPONSE_B' });
  if (requests.length === 1) {
    await responseGate;
    if (res.destroyed) return;
    send({
      tool_calls: [
        {
          index: 0,
          id: 'read-after-model-switch',
          type: 'function',
          function: { name: 'read', arguments: JSON.stringify({ path: '输入 文件.txt' }) },
        },
      ],
    });
    send({}, 'tool_calls');
  } else send({}, 'stop');
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const f = await prepareRealPiFixture(`http://127.0.0.1:${server.address().port}/v1`, 'model-switch-ui');
const modelFile = path.join(f.agentDir, 'models.json');
const models = JSON.parse(await fs.readFile(modelFile, 'utf8'));
models.providers['local-e2e'].models.push({
  ...models.providers['local-e2e'].models[0],
  id: 'local-next',
  name: '下一请求模型',
});
await fs.writeFile(modelFile, JSON.stringify(models));
if (process.argv[2]) f.store.state.settings.piPath = path.resolve(process.argv[2]);
const other = f.store.createSession(f.projectId);
other.title = '查看其他会话';
f.store.selectSession(f.sessionId);
await f.store.save();
let app, page;
const errors = [];
try {
  app = await electron.launch({
    executablePath: process.env.PI_DESKTOP_EXE,
    args: process.env.PI_DESKTOP_EXE ? [] : [path.resolve('.')],
    env: { ...process.env, PI_OFFLINE: '1', PI_DESKTOP_DATA_DIR: f.dataDir },
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('textbox', { name: '任务输入' }).waitFor();
  await page.evaluate(
    (id) => window.desktop.invoke('send', id, 'MODEL_SWITCH_DURING_RESPONSE', [], 'steer'),
    f.sessionId,
  );
  await page.getByText('CURRENT_RESPONSE_A', { exact: true }).waitFor();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  const nextModel = page.getByRole('option', { name: /下一请求模型/ });
  assert.equal(await nextModel.isEnabled(), true);
  assert.equal(await page.getByRole('radio', { name: 'off', exact: true }).isDisabled(), true);
  await nextModel.click();
  await page.waitForFunction(async () => {
    const { runtime } = await window.desktop.invoke('bootstrap');
    return runtime.model?.id === 'local-next' && runtime.status === 'running';
  });
  assert.equal(requests.length, 1, 'changing selection must not interrupt or restart the current request');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型连接', exact: true }).click();
  const selector = page.getByRole('combobox', { name: '选择模型' });
  assert.equal(await selector.isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: '保存设置', exact: true }).isDisabled(), true);
  await selector.selectOption('local-e2e::local-e2e');
  await page.waitForFunction(() => !document.querySelector('select[aria-label="选择模型"]')?.disabled);
  await selector.selectOption('local-e2e::local-next');
  await page.waitForFunction(() => !document.querySelector('select[aria-label="选择模型"]')?.disabled);
  await assert.rejects(
    page.evaluate(
      (id) => window.desktop.invoke('setSessionModel', id, 'local-e2e', 'missing-model'),
      f.sessionId,
    ),
    /不可用/,
  );
  const current = await page.evaluate(() => window.desktop.invoke('bootstrap'));
  assert.equal(current.runtime.model.id, 'local-next');
  assert.equal(current.runtime.status, 'running');
  assert.equal(current.state.settings.modelId, 'local-next');
  assert.equal(current.state.sessions.find((s) => s.id === f.sessionId).model.id, 'local-next');
  await page.locator('footer').getByRole('button', { name: '关闭', exact: true }).click();

  await page.getByRole('button', { name: other.title, exact: true }).click();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  assert.equal(await page.getByRole('option', { name: /下一请求模型/ }).isDisabled(), true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '查看任务', exact: true }).click();

  releaseResponse();
  await page.locator('.run-meta .completed').waitFor();
  assert.deepEqual(
    requests.map((request) => request.model),
    ['local-e2e', 'local-next'],
  );
  const result = await page.evaluate(() => window.desktop.invoke('bootstrap'));
  assert.equal(result.runtime.status, 'completed', result.runtime.error);
  const replies = result.runtime.messages.filter((message) => message.role === 'assistant');
  assert.deepEqual(
    replies.map((message) => message.model),
    ['local-e2e', 'local-next'],
  );
  await fs.writeFile(path.join(f.agentDir, 'confirm-switch'), '');
  await page.getByRole('button', { name: other.title, exact: true }).click();
  await page.waitForFunction(async () => {
    const { runtime } = await window.desktop.invoke('bootstrap');
    return runtime.status === 'waiting' && runtime.dialogs.some((dialog) => dialog.title === '切换确认');
  });
  // The confirmation owns focus; inspect the underlying picker's lock without answering it.
  await page.evaluate(() => document.querySelector('.model-pill').click());
  assert.equal(await page.getByRole('option', { name: /下一请求模型/ }).isDisabled(), true);
  await assert.rejects(
    page.evaluate(
      (id) => window.desktop.invoke('setSessionModel', id, 'local-e2e', 'local-e2e'),
      f.sessionId,
    ),
    /连接或切换会话/,
  );
  const confirmation = (await page.evaluate(() => window.desktop.invoke('bootstrap'))).runtime.dialogs.find(
    (dialog) => dialog.title === '切换确认',
  );
  await page.evaluate((id) => window.desktop.invoke('respond', id, { confirmed: false }), confirmation.id);
  await page.waitForFunction(async () => {
    const { runtime } = await window.desktop.invoke('bootstrap');
    return runtime.status === 'completed';
  });
  assert.equal(
    (await page.evaluate(() => window.desktop.invoke('bootstrap'))).runtime.model.id,
    'local-next',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS real Pi model switching through composer and settings preserves the current response and uses the new model after tool execution',
  );
  console.log(
    'PASS invalid selection preserves the model; runtime settings and another session remain protected',
  );
  console.log('PASS a session switch awaiting extension confirmation keeps model selection locked');
} finally {
  releaseResponse();
  if (page && !page.isClosed()) await page.evaluate(() => window.desktop.invoke('stop')).catch(() => {});
  await app
    ?.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    })
    .catch(() => {});
  await app?.close().catch(() => {});
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
