import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.ts';
import { PI_INSTALL_COMMAND } from '../shared/pi-version.ts';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-compatibility-ui-'));
const store = new Store(dir);
await store.load();
const session = store.createSession();
Object.assign(store.state.settings, {
  piPath: path.resolve('tests/support/versioned-pi.mjs'),
  nodePath: process.execPath,
  agentDir: dir,
  onboardingDone: true,
});
await store.save();
let app, page;
const errors = [];
try {
  for (const version of ['1.1.1', '1.2.0']) {
    await fs.writeFile(path.join(dir, 'fixture-version.txt'), version);
    app = await electron.launch({
      executablePath: process.env.PI_DESKTOP_EXE,
      args: process.env.PI_DESKTOP_EXE ? [] : [path.resolve('.')],
      env: { ...process.env, PI_DESKTOP_DATA_DIR: dir, PI_OFFLINE: '1' },
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (error) => errors.push(error.message));
    const input = page.getByRole('textbox', { name: '任务输入' });
    await input.waitFor();
    const notice = page.getByLabel('Pi 版本兼容性');
    await notice.waitFor();
    if (version === '1.1.1') {
      assert.match(await notice.innerText(), /兼容.*同一版本线/s);
      await page.evaluate((id) => window.desktop.invoke('connect', id), session.id);
      await input.fill('compatibility UI test');
      await page.getByRole('button', { name: '发送任务', exact: true }).click();
      await page.locator('.run-meta .completed').waitFor();
    } else {
      assert.match(await notice.innerText(), /尚未适配 Pi 1.2.0/);
      await input.fill('blocked by version policy');
      assert.equal(await page.getByRole('button', { name: '发送任务', exact: true }).isDisabled(), true);
      await assert.rejects(
        page.evaluate((id) => window.desktop.invoke('send', id, 'blocked', [], 'steer'), session.id),
        /尚未适配/,
      );
      await notice.getByRole('button', { name: '复制代码' }).click();
      assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), PI_INSTALL_COMMAND);
    }
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '运行环境', exact: true }).click();
    assert.match(
      await page.locator('.environment-status').innerText(),
      version === '1.1.1' ? /1\.1\.1 · 兼容/ : /1\.2\.0 · 过新/,
    );
    const diagnostic = await page.evaluate(() => window.desktop.invoke('diagnostics'));
    assert.match(
      diagnostic,
      version === '1.1.1' ? /"piCompatibility": "compatible"/ : /"piCompatibility": "tooNew"/,
    );
    console.log(`PASS ${version} welcome/settings, sending policy and diagnostic compatibility`);
    await app.close();
    app = undefined;
  }
  assert.deepEqual(errors, []);
} catch (error) {
  if (page && !page.isClosed()) {
    await fs.mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/compatibility-ui-failure.png' });
  }
  throw error;
} finally {
  if (app) await app.close();
  await fs.rm(dir, { recursive: true, force: true });
}
