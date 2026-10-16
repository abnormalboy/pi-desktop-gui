// Isolated renderer regressions: real React controls with deterministic, delayed IPC.
// No Pi process, credentials, provider requests, or user configuration are touched.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import http from 'node:http';
import path from 'node:path';

const bundle = await build({
  stdin: {
    contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { PiFeatures } from './src/PiFeatures';
      import { emptyRuntime } from './shared/types';
      const root = createRoot(document.getElementById('root'));
      let generation = 0;
      function Harness({ initial }) {
        const [props, setProps] = useState(initial);
        window.updateFeature = (patch) => setProps((previous) => ({ ...previous, ...patch }));
        return <PiFeatures {...props} />;
      }
      window.idleRuntime = { ...emptyRuntime(), sessionId: 'settings-test', connected: true };
      window.mountFeature = (overrides = {}) => {
        const initial = {
          session: { id: 'settings-test', projectId: 'project', title: '设置测试', draft: '', attachments: [], updatedAt: 1, lastStatus: 'idle' },
          runtime: window.idleRuntime,
          initialTab: 'settings', close: () => {}, projectEnabled: true,
          storage: { writable: true },
          environment: { supported: true, compatibility: 'verified', version: '1.1.0', piPath: '/pi', agentDir: '/agent', authExists: false, modelsExist: false, errors: [] },
          ...overrides,
        };
        root.render(<Harness key={++generation} initial={initial} />);
      };
    `,
    resolveDir: path.resolve('.'),
    loader: 'tsx',
    sourcefile: 'pi-settings-regression.tsx',
  },
  bundle: true,
  write: false,
  outdir: 'unused',
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' },
});
if (process.argv.includes('--bundle-only')) {
  console.log('PASS Pi settings browser regression bundle');
  process.exit(0);
}
const js = bundle.outputFiles.find((file) => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
const server = http.createServer((request, response) => {
  if (request.url === '/test.js') {
    response.setHeader('content-type', 'text/javascript');
    response.end(js);
  } else if (request.url === '/test.css') {
    response.setHeader('content-type', 'text/css');
    response.end(css);
  } else {
    response.setHeader('content-type', 'text/html');
    response.end(
      '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/test.css"><div id="root"></div><script src="/test.js"></script>',
    );
  }
});
let browser;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.PI_DESKTOP_BROWSER || undefined });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const mock = (window.mock = {
      calls: [],
      holds: [],
      waiting: [],
      failScope: false,
      failReads: [],
      failSave: false,
      result: { applied: true },
      documents: {
        'settings:false': { retry: { enabled: true }, untouched: 'preserve me' },
        'settings:true': { retry: { enabled: false }, projectOnly: true },
        'models:false': { providers: {} },
        'mcp:false': { mcpServers: { demo: { command: 'demo', enabled: true } } },
      },
      release(key) {
        const index = this.waiting.findIndex((entry) => entry.key === key);
        if (index < 0) throw new Error('No pending IPC: ' + key);
        this.waiting.splice(index, 1)[0].resolve();
      },
    });
    window.desktop = {
      platform: 'linux',
      invoke: async (method, ...args) => {
        mock.calls.push({ method, args });
        const key =
          method + (method === 'configRead' || method === 'configSave' ? ':' + args[1] + ':' + args[2] : '');
        const value =
          method === 'configRead'
            ? {
                text: JSON.stringify(mock.documents[args[1] + ':' + args[2]] ?? {}),
                path: (args[2] ? '/project/.pi/' : '/agent/') + args[1] + '.json',
                revision: 'revision',
              }
            : undefined;
        if (mock.holds.includes(key)) {
          await new Promise((resolve) => mock.waiting.push({ key, resolve }));
        }
        if (method === 'configRead') {
          if (mock.failScope && args[2]) throw new Error('项目配置读取失败');
          if (mock.failReads.includes(key)) throw new Error('配置重新读取失败');
          return value;
        }
        if (method === 'configSave') {
          if (mock.failSave) throw new Error('写入失败');
          mock.documents[args[1] + ':' + args[2]] = JSON.parse(args[3].text);
          return mock.result;
        }
        if (method === 'providers')
          return [
            { id: 'key-only', name: 'API Key provider', configured: false, oauth: false, apiKey: true },
            { id: 'oauth-only', name: 'OAuth provider', configured: false, oauth: true, apiKey: false },
          ];
        if (method === 'resources') return { resources: [], tools: [], activeTools: [], packages: [] };
        if (method === 'sessionTree') return [];
        if (method === 'usageSummary') {
          const period = { tokens: 0, cost: 0, missingTokens: 0, missingCost: 0, projects: [] };
          return { today: period, week: period, all: period };
        }
      },
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => Boolean(window.mountFeature));
  const mount = (props = {}) => page.evaluate((props) => window.mountFeature(props), props);
  const modal = page.getByRole('dialog', { name: 'Pi 功能' });
  const json = modal.getByRole('textbox', { name: 'Pi 配置 JSON' });
  const nav = (name) => modal.locator('nav').getByRole('button', { name, exact: true });
  const readyJson = async () => {
    await json.waitFor();
    await page.waitForFunction(() => {
      const field = document.querySelector('[aria-label="Pi 配置 JSON"]');
      return field && !field.disabled;
    });
  };
  await mount();
  await readyJson();
  const original = await json.inputValue();
  await nav('完整 Pi 设置').click();
  assert.equal(await json.inputValue(), original);
  assert.equal(await json.isEnabled(), true);
  await json.fill('{"retry":{"enabled":false},"untouched":"preserve me"}');
  assert.equal(await nav('常用设置').isDisabled(), true);
  await page.evaluate(() => {
    window.mock.holds = ['configSave:settings:false'];
  });
  await modal.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.waitForFunction(() => window.mock.waiting.length === 1);
  assert.equal(await json.isDisabled(), true);
  assert.equal(await nav('常用设置').isDisabled(), true);
  await page.evaluate(() => {
    window.mock.holds = [];
    window.mock.release('configSave:settings:false');
  });
  await modal.getByText('已保存并重新连接 Pi。原配置已备份。', { exact: true }).waitFor();
  assert.equal(await nav('常用设置').isEnabled(), true);
  console.log(
    'PASS same-tab click preserves document; save locks edits/navigation and unlocks after completion',
  );

  await page.evaluate(() =>
    window.mountFeature({ initialTab: 'prefs', runtime: { ...window.idleRuntime, status: 'running' } }),
  );
  const retry = modal.getByRole('checkbox', { name: '临时错误自动重试' });
  await retry.waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="临时错误自动重试"]').disabled);
  await retry.check();
  const formSave = modal.getByRole('button', { name: '保存并重新加载', exact: true });
  assert.equal(await formSave.isDisabled(), true);
  await modal.getByText(/等待任务完成或停止后再保存/).waitFor();
  await page.evaluate(() => window.updateFeature({ runtime: window.idleRuntime }));
  await formSave.click();
  await modal.getByText('设置已保存，Pi 已重新加载。原文件已备份。', { exact: true }).waitFor();
  const saved = await page.evaluate(() => window.mock.documents['settings:false']);
  assert.equal(saved.retry.enabled, true);
  assert.equal(saved.untouched, 'preserve me');
  console.log('PASS running tasks allow local edits, prevent apply, and re-enable saves on idle');

  await page.evaluate(() => {
    window.mock.result = { applied: false, warning: '请检查 Pi 入口' };
    window.mountFeature({ environment: { supported: false } });
  });
  await readyJson();
  await modal.getByText(/运行环境.*重新检测/).waitFor();
  await json.fill('{"offline":true}');
  await modal.getByRole('button', { name: '保存并应用', exact: true }).click();
  await modal.getByText(/配置已保存.*尚未应用到 Pi.*请检查 Pi 入口/).waitFor();
  assert.equal(await nav('常用设置').isEnabled(), true);
  console.log('PASS missing Pi permits offline configuration and accurately reports saved-but-not-applied');

  await page.evaluate(() => {
    window.mock.holds = ['configRead:settings:false'];
    window.mountFeature();
  });
  await page.waitForFunction(() =>
    window.mock.waiting.some((entry) => entry.key === 'configRead:settings:false'),
  );
  assert.equal(await modal.getByRole('combobox', { name: '配置范围' }).isDisabled(), true);
  assert.equal(await nav('MCP 服务器').isEnabled(), true);
  await nav('MCP 服务器').click();
  await readyJson();
  assert.match(await json.inputValue(), /mcpServers/);
  await page.evaluate(() => {
    window.mock.holds = [];
    window.mock.release('configRead:settings:false');
  });
  await page.waitForTimeout(50);
  assert.match(await json.inputValue(), /mcpServers/);
  console.log(
    'PASS delayed old-tab reads cannot overwrite the current document; scope locked until read completes',
  );

  await mount();
  await readyJson();
  const personal = await json.inputValue();
  await page.evaluate(() => {
    window.mock.failScope = true;
  });
  await modal.getByRole('combobox', { name: '配置范围' }).selectOption('project');
  await modal.getByRole('alert').filter({ hasText: '项目配置读取失败' }).waitFor();
  assert.equal(await modal.getByRole('combobox', { name: '配置范围' }).inputValue(), 'user');
  assert.equal(await json.inputValue(), personal);
  await page.evaluate(() => {
    window.mock.holds = ['configRead:settings:false'];
  });
  await modal.getByRole('button', { name: '重试读取', exact: true }).click();
  await page.waitForFunction(() =>
    window.mock.waiting.some((entry) => entry.key === 'configRead:settings:false'),
  );
  assert.equal(await json.isDisabled(), true);
  assert.equal(await modal.getByRole('combobox', { name: '配置范围' }).isDisabled(), true);
  await page.evaluate(() => {
    window.mock.holds = [];
    window.mock.release('configRead:settings:false');
    window.mock.failScope = false;
  });
  await readyJson();
  await modal.getByRole('combobox', { name: '配置范围' }).selectOption('project');
  await page.waitForFunction(() => document.querySelector('[aria-label="配置范围"]').value === 'project');
  assert.match(await json.inputValue(), /projectOnly/);
  console.log(
    'PASS failed scope read preserves both scope and document; successful retry changes them together',
  );

  await page.evaluate(() => {
    window.mock.holds = ['providers'];
    window.mountFeature({ initialTab: 'providers' });
  });
  await page.waitForFunction(() => window.mock.waiting.some((entry) => entry.key === 'providers'));
  await readyJson();
  assert.equal(await nav('常用设置').isEnabled(), true);
  await page.evaluate(() => {
    window.mock.holds = [];
    window.mock.release('providers');
  });
  await modal.getByRole('combobox', { name: '登录供应商' }).selectOption('key-only');
  assert.equal(await modal.getByRole('button', { name: '浏览器登录', exact: true }).isDisabled(), true);
  assert.match(
    await modal.getByRole('button', { name: '浏览器登录', exact: true }).getAttribute('title'),
    /不支持/,
  );
  assert.equal(await modal.getByRole('button', { name: '设置 API Key', exact: true }).isEnabled(), true);
  await json.fill('{"providers":{},"unsavedProviderEdit":true}');
  await modal.getByRole('button', { name: '设置 API Key', exact: true }).click();
  await modal.getByText('凭据已保存', { exact: true }).waitFor();
  assert.match(await json.inputValue(), /unsavedProviderEdit/);
  assert.equal(await nav('常用设置').isDisabled(), true);
  await modal.getByRole('button', { name: '放弃修改并重新读取', exact: true }).click();
  await readyJson();
  await nav('命令与快捷键').click();
  await modal.getByText(/终端主题.*尚未在桌面实现/).waitFor();
  console.log(
    'PASS slow provider lookup leaves local config usable; provider prerequisites and unsupported terminal UI explained',
  );
  for (const [initialTab, label] of [
    ['settings', '完整 Pi 设置'],
    ['providers', '供应商与登录'],
    ['mcp', 'MCP 服务器'],
  ]) {
    await mount({ initialTab });
    await readyJson();
    const before = await json.inputValue();
    await nav(label).click();
    assert.equal(await json.inputValue(), before);
    assert.equal(await json.isEnabled(), true);
  }
  console.log('PASS repeated active settings, providers and MCP tabs retain their documents');

  await mount();
  await readyJson();
  await json.fill('{"savedAfterRetry":true}');
  await page.evaluate(() => {
    window.mock.failSave = true;
  });
  await modal.getByRole('button', { name: '保存并应用', exact: true }).click();
  await modal.getByRole('alert').filter({ hasText: '写入失败' }).waitFor();
  assert.match(await json.inputValue(), /savedAfterRetry/);
  assert.equal(await nav('常用设置').isDisabled(), true);
  await page.evaluate(() => {
    window.mock.failSave = false;
    window.mock.failReads = ['configRead:settings:false'];
  });
  await modal.getByRole('button', { name: '保存并应用', exact: true }).click();
  await modal.getByText(/配置已保存.*尚未应用到 Pi/).waitFor();
  await modal.getByRole('alert').filter({ hasText: '配置重新读取失败' }).waitFor();
  assert.equal(await json.isDisabled(), true);
  assert.equal(await modal.getByRole('button', { name: '保存并应用', exact: true }).isDisabled(), true);
  assert.equal(await nav('常用设置').isEnabled(), true);
  await page.evaluate(() => {
    window.mock.failReads = [];
  });
  await modal.getByRole('button', { name: '重试读取', exact: true }).click();
  await readyJson();
  assert.match(await json.inputValue(), /savedAfterRetry/);
  console.log(
    'PASS write failure keeps edits; post-save read failure keeps saved notice and prevents stale-revision resave',
  );

  await page.evaluate(() => {
    window.mock.documents['settings:false'] = { retry: { enabled: true }, untouched: 'preserve me' };
    window.mock.result = { applied: true };
  });
  await mount({ initialTab: 'prefs' });
  await retry.waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="临时错误自动重试"]').disabled);
  const projectScope = modal.getByRole('radio', { name: '仅当前项目', exact: true });
  const personalScope = modal.getByRole('radio', { name: '个人（所有项目）', exact: true });
  await page.evaluate(() => {
    window.mock.failScope = true;
  });
  await projectScope.click();
  await modal.getByRole('alert').filter({ hasText: '项目配置读取失败' }).waitFor();
  assert.equal(await personalScope.getAttribute('aria-checked'), 'true');
  assert.equal(await retry.isChecked(), true);
  await page.evaluate(() => {
    window.mock.failScope = false;
    window.mock.holds = ['configRead:settings:true'];
  });
  await projectScope.click();
  await page.waitForFunction(() =>
    window.mock.waiting.some((entry) => entry.key === 'configRead:settings:true'),
  );
  assert.equal(await retry.isDisabled(), true);
  assert.equal(await nav('MCP 服务器').isEnabled(), true);
  await nav('MCP 服务器').click();
  await readyJson();
  await page.evaluate(() => {
    window.mock.holds = [];
    window.mock.failScope = true;
    window.mock.release('configRead:settings:true');
  });
  await page.waitForTimeout(50);
  assert.match(await json.inputValue(), /mcpServers/);
  assert.equal(await modal.getByRole('alert').count(), 0);
  console.log(
    'PASS common-settings failed scope remains personal; late errors after navigation cannot affect the new page',
  );

  await page.evaluate(() => {
    window.mock.failScope = false;
  });
  await mount({ initialTab: 'prefs' });
  await retry.waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="临时错误自动重试"]').disabled);
  await projectScope.click();
  await page.waitForFunction(
    () => document.querySelector('[role="radio"][aria-checked="true"]').textContent === '仅当前项目',
  );
  assert.equal(await retry.isChecked(), false);
  await retry.check();
  await page.evaluate(() => {
    window.mock.failReads = ['configRead:settings:true'];
  });
  await formSave.click();
  await modal.getByText('设置已保存，Pi 已重新加载。原文件已备份。', { exact: true }).waitFor();
  await modal.getByRole('alert').filter({ hasText: '配置重新读取失败' }).waitFor();
  assert.equal(await retry.isDisabled(), true);
  assert.equal(await formSave.isDisabled(), true);
  assert.equal(await nav('MCP 服务器').isEnabled(), true);
  await page.evaluate(() => {
    window.mock.failReads = [];
  });
  await modal.getByRole('button', { name: '重新读取设置', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="临时错误自动重试"]').disabled);
  assert.equal(await retry.isChecked(), true);
  assert.equal(await projectScope.getAttribute('aria-checked'), 'true');
  console.log('PASS common-settings save/read failure preserves saved status, scope and safe retry');

  for (const props of [
    { storage: { writable: false } },
    { runtime: { ...(await page.evaluate(() => window.idleRuntime)), crash: { cleanup: 'unconfirmed' } } },
  ]) {
    await mount(props);
    await readyJson();
    await json.fill('{"safeLocalEdit":true}');
    assert.equal(await modal.getByRole('button', { name: '保存并应用', exact: true }).isDisabled(), true);
  }
  await mount({ initialTab: 'providers', projectEnabled: false });
  await readyJson();
  assert.equal(await modal.getByRole('button', { name: '设置 API Key', exact: true }).isDisabled(), true);
  await mount({ projectEnabled: false });
  await readyJson();
  assert.equal(await modal.locator('option[value="project"]').isDisabled(), true);
  await json.fill('{"personalOfflineEdit":true}');
  assert.equal(await modal.getByRole('button', { name: '保存并应用', exact: true }).isEnabled(), true);
  console.log(
    'PASS storage and process recovery still block saving; untrusted projects cannot use project configuration or engine actions',
  );
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
