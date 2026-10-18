import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareRealPiFixture } from '../tests/support/local-provider.ts';
import { createRetryProvider } from '../tests/support/retry-provider.ts';

process.env.PI_OFFLINE = '1';
const provider = await createRetryProvider();
const fixture = await prepareRealPiFixture(provider.baseUrl, 'retry-ui');
const settingsFile = path.join(fixture.agentDir, 'settings.json');
const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
await fs.writeFile(
  settingsFile,
  JSON.stringify({
    ...settings,
    retry: { enabled: true, maxRetries: 2, baseDelayMs: 40, provider: { maxRetries: 0, timeoutMs: 20000 } },
  }),
);
const output = path.resolve('output/playwright', `retry-ui-${process.platform}`);
await fs.mkdir(output, { recursive: true });
const errors = [];
let app, page;
const wait = async (check) => {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > 25000) throw new Error('Retry UI condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};
try {
  app = await electron.launch({
    executablePath: process.env.PI_DESKTOP_EXE,
    args: process.env.PI_DESKTOP_EXE ? [] : [path.resolve('.')],
    env: { ...process.env, PI_DESKTOP_DATA_DIR: fixture.dataDir, PI_OFFLINE: '1' },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(25000);
  page.on('pageerror', (error) => errors.push(error.message));
  const input = page.getByRole('textbox', { name: '任务输入' });
  await input.waitFor();
  const send = async (text) => {
    await input.fill(text);
    await page.getByRole('button', { name: '发送任务', exact: true }).click();
  };
  provider.reset('recover', true);
  await send('RETRY_RECOVER');
  await wait(() => provider.count === 2);
  await page
    .locator('.retry-banner')
    .getByText(/等待模型响应/)
    .waitFor();
  await page.locator('.retry-banner').getByRole('button', { name: '取消重试' }).waitFor();
  await page.screenshot({ path: path.join(output, 'requesting.png'), animations: 'disabled' });
  provider.release();
  await page.locator('.run-meta .completed').waitFor();
  await page.locator('.retry-banner').waitFor({ state: 'detached' });
  await page.locator('.message.assistant').getByText('RECOVERED', { exact: true }).waitFor();
  assert.equal(await page.locator('.runtime-notices').evaluate((node) => node.open), false);
  await page.locator('.runtime-notices summary').filter({ hasText: '历史运行记录' }).waitFor();
  await page.locator('.runtime-notices summary').click();
  assert.equal(await page.locator('.runtime-notices p').count(), 2);
  assert.equal(await page.locator('.runtime-notices p').filter({ hasText: '重试已恢复' }).count(), 2);
  assert.equal(await page.locator('.runtime-notices p').filter({ hasText: '继续执行' }).count(), 0);
  assert.equal(provider.count, 4);
  await page.screenshot({ path: path.join(output, 'recovered.png'), animations: 'disabled' });
  console.log('PASS retry banner persists while waiting; recovered records replace active wording');

  provider.reset('cancel-request');
  await send('RETRY_CANCEL_REQUEST');
  await wait(() => provider.count === 2);
  await page.locator('.retry-banner').getByRole('button', { name: '取消重试' }).click();
  await page.locator('.run-meta .stopped').waitFor();
  await page.locator('.retry-banner').waitFor({ state: 'detached' });
  await page.locator('.runtime-notices summary').click();
  await wait(() => provider.requests.at(-1).closed);
  assert.match(await page.locator('.runtime-notices p').last().innerText(), /^重试已取消/);
  assert.equal(provider.count, 2);
  await page.screenshot({ path: path.join(output, 'cancelled.png'), animations: 'disabled' });
  console.log('PASS cancel button stops an in-flight retry and closes the silent HTTP request');

  provider.reset('exhaust');
  await send('RETRY_EXHAUST');
  await page.locator('.run-meta .error').waitFor();
  await page.locator('.retry-banner').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.runtime-notices').evaluate((node) => node.open), false);
  await page.locator('.runtime-notices summary').click();
  assert.match(await page.locator('.runtime-notices p').last().innerText(), /^重试失败（2\/2）/);
  assert.equal(provider.count, 3);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        packaged: Boolean(process.env.PI_DESKTOP_EXE),
        checks: ['requesting banner', 'recovered history', 'cancel active request', 'exhaustion'],
        rendererErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log('PASS retry exhaustion displays its final outcome with no busy retry banner');
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await app?.close();
  await provider.close();
}
