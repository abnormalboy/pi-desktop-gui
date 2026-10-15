import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Runs renderer interaction coverage without an Electron display or real user data.
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to use a system Chromium installation.
const systemChromium = process.platform === 'linux' ? '/usr/bin/chromium' : undefined;
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (systemChromium &&
  (await fs.access(systemChromium).then(
    () => true,
    () => false,
  ))
    ? systemChromium
    : undefined);
const bundle = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { TitleBar } from './src/components/TitleBar';
      import { AppDialogs } from './src/components/AppDialogs';
      import './src/styles/base.css';
      import './src/styles/shell.css';
      import './src/styles/dialogs.css';
      import './src/styles/titlebar.css';
      createRoot(document.getElementById('root')).render(
        <div className="desktop-shell">
          <TitleBar title="标题栏回归测试" onError={(message) => window.testErrors.push(message)} />
          <div className="app-shell">
            <aside className="sidebar">侧栏</aside>
            <main className="workspace">
              <textarea aria-label="测试编辑器" defaultValue="hello world" />
              <button type="button">工作区按钮</button>
            </main>
          </div>
          <AppDialogs />
        </div>
      );
    `,
    loader: 'tsx',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  outfile: 'titlebar-test.js',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = bundle.outputFiles.find((file) => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css')).text;
const browser = await chromium.launch({ executablePath, headless: true });
const output = path.resolve('test-results', 'titlebar');
await fs.mkdir(output, { recursive: true });
let page;
const errors = [];
try {
  const launch = async (platform) => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<html><head></head><body><div id="root"></div></body></html>');
    await page.evaluate((platform) => {
      window.testErrors = [];
      window.calls = [];
      window.listeners = new Set();
      window.dialogFailure = false;
      window.emit = (event) => {
        for (const listener of window.listeners) listener(event);
      };
      window.desktop = {
        platform,
        invoke: async (method, ...args) => {
          const active = document.activeElement;
          window.calls.push({
            method,
            args,
            active: active?.getAttribute('aria-label'),
            start: active?.selectionStart,
            end: active?.selectionEnd,
          });
          if (method === 'windowState') return { maximized: false };
          if (method === 'respondAppDialog' && window.dialogFailure) throw new Error('测试响应失败');
        },
        onEvent: (callback) => {
          window.listeners.add(callback);
          return () => window.listeners.delete(callback);
        },
      };
      document.documentElement.dataset.theme = 'light';
    }, platform);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    await page.getByRole('textbox', { name: '测试编辑器' }).waitFor();
    return page;
  };
  page = await launch('win32');
  const menubar = page.getByRole('menubar', { name: '应用菜单' });
  const file = menubar.getByRole('menuitem', { name: '文件', exact: true });
  const edit = menubar.getByRole('menuitem', { name: '编辑', exact: true });
  const view = menubar.getByRole('menuitem', { name: '视图', exact: true });
  const editor = page.getByRole('textbox', { name: '测试编辑器' });
  const menu = page.getByRole('menu');
  const lastAction = () =>
    page.evaluate(() => window.calls.filter((call) => call.method === 'windowAction').at(-1));

  await file.click();
  assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['新建对话Ctrl+N', '退出Alt+F4']);
  await page.keyboard.press('Escape');
  assert.equal(await menu.count(), 0);
  assert.equal(await file.evaluate((element) => element === document.activeElement), true);
  await file.click();
  await page.getByRole('button', { name: '工作区按钮' }).click();
  assert.equal(await menu.count(), 0);
  await file.click();
  await file.click();
  assert.equal(await menu.count(), 0);
  console.log('PASS menu dismissal, outside click and repeated toggle');

  await editor.focus();
  await page.keyboard.press('F10');
  assert.equal(await file.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await edit.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(
    await menu
      .getByRole('menuitem', { name: '撤销' })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press('End');
  assert.equal(
    await menu
      .getByRole('menuitem', { name: '全选' })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press('ArrowDown');
  assert.equal(
    await menu
      .getByRole('menuitem', { name: '撤销' })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press('ArrowRight');
  assert.equal(await view.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  assert.equal((await lastAction()).args[0], 'resetZoom');
  assert.equal(await editor.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('Alt+e');
  assert.equal(await edit.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Tab');
  assert.equal(await menu.count(), 0);
  assert.equal(
    await page
      .getByRole('button', { name: '最小化窗口' })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  console.log('PASS F10/Alt access, arrows, wrapping, Home/End, Enter and Tab');

  // Edit commands must target the editor and retain its selected text after clicking menus.
  await editor.evaluate((element) => {
    element.focus();
    element.setSelectionRange(2, 8);
  });
  await edit.click();
  await menu.getByRole('menuitem', { name: '复制' }).click();
  assert.deepEqual(await lastAction(), {
    method: 'windowAction',
    args: ['copy'],
    active: '测试编辑器',
    start: 2,
    end: 8,
  });
  for (const [label, action] of [
    ['撤销', 'undo'],
    ['重做', 'redo'],
    ['剪切', 'cut'],
    ['粘贴', 'paste'],
    ['全选', 'selectAll'],
  ]) {
    await edit.click();
    await menu.getByRole('menuitem', { name: label }).click();
    assert.equal((await lastAction()).args[0], action);
  }
  await file.click();
  await menu.getByRole('menuitem', { name: '新建对话' }).click();
  assert.equal((await lastAction()).args[0], 'newSession');
  console.log('PASS all File/Edit commands and editor selection restoration');

  for (const [label, action] of [
    ['最小化窗口', 'minimize'],
    ['最大化窗口', 'toggleMaximize'],
    ['关闭窗口', 'close'],
  ]) {
    await page.getByRole('button', { name: label }).click();
    assert.equal((await lastAction()).args[0], action);
  }
  await page.evaluate(() => window.emit({ type: 'windowState', maximized: true }));
  await page.getByRole('button', { name: '还原窗口' }).waitFor();
  await page.evaluate(() => window.emit({ type: 'windowState', maximized: false }));
  await page.getByRole('button', { name: '最大化窗口' }).waitFor();
  for (const [key, action] of [
    ['Control+0', 'resetZoom'],
    ['Control+=', 'zoomIn'],
    ['Control+-', 'zoomOut'],
    ['F11', 'toggleFullscreen'],
  ]) {
    await editor.press(key);
    assert.equal((await lastAction()).args[0], action);
  }
  console.log('PASS window actions/state events and retained zoom/fullscreen shortcuts');

  const color = async (selector) =>
    page.locator(selector).evaluate((element) => getComputedStyle(element).backgroundColor);
  for (const theme of ['light', 'dark', 'system']) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await view.click();
    assert.equal(await color('.app-titlebar'), theme === 'light' ? 'rgb(245, 247, 246)' : 'rgb(20, 27, 24)');
    assert.equal(
      await color('.titlebar-dropdown'),
      theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(25, 33, 30)',
    );
    await page.screenshot({ path: path.join(output, `menu-${theme}.png`) });
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => document.documentElement.style.setProperty('--font-scale', '2'));
  await page.setViewportSize({ width: 1024, height: 768 });
  await file.click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(
    await page
      .locator('.app-shell')
      .evaluate((element) => Math.round(element.getBoundingClientRect().bottom)),
    768,
  );
  assert.equal(
    await page
      .locator('.app-titlebar')
      .evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-app-region')),
    'drag',
  );
  assert.equal(
    await menubar.evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-app-region')),
    'no-drag',
  );
  await page.keyboard.press('Escape');
  console.log('PASS light/dark/system menus, drag regions and 200% layout');

  await page.evaluate(() => {
    document.documentElement.style.setProperty('--font-scale', '1');
    window.emit({
      type: 'appDialog',
      dialog: {
        id: 'confirm-1',
        message: '退出前确认',
        detail: '会话正在运行。\n是否退出？',
        buttons: ['取消', '退出'],
        cancelId: 0,
      },
    });
    window.emit({
      type: 'appDialog',
      dialog: { id: 'confirm-2', message: '第二个确认', detail: '', buttons: ['停止', '保留'], cancelId: 1 },
    });
  });
  const dialog = page.getByRole('dialog', { name: '退出前确认' });
  await dialog.waitFor();
  const beforeDialogShortcut = await lastAction();
  await page.keyboard.press('Alt+f');
  await page.keyboard.press('F11');
  assert.equal(await menu.count(), 0);
  assert.deepEqual(await lastAction(), beforeDialogShortcut);
  assert.equal(await color('.modal'), 'rgb(25, 33, 30)');
  await page.screenshot({ path: path.join(output, 'dialog-dark.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: '第二个确认' }).waitFor();
  assert.deepEqual(
    await page.evaluate(() =>
      window.calls.filter((call) => call.method === 'respondAppDialog').map((call) => call.args),
    ),
    [['confirm-1', 0]],
  );
  await page.evaluate(() => {
    window.dialogFailure = true;
  });
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '测试响应失败' }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 1);
  await page.evaluate(() => {
    window.dialogFailure = false;
  });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(
    await page.evaluate(() =>
      window.calls.filter((call) => call.method === 'respondAppDialog').map((call) => call.args),
    ),
    [
      ['confirm-1', 0],
      ['confirm-2', 0],
      ['confirm-2', 1],
    ],
  );
  assert.deepEqual(await page.evaluate(() => window.testErrors), []);
  console.log('PASS themed dialog queue, cancellation and retry after a failed response');

  const mac = await launch('darwin');
  assert.equal(await mac.locator('.app-titlebar').count(), 0);
  await mac.getByRole('textbox').press('F11');
  assert.deepEqual(
    await mac.evaluate(() =>
      window.calls.filter((call) => call.method === 'windowAction' || call.method === 'windowState'),
    ),
    [],
  );
  await mac.close();
  assert.deepEqual(errors, []);
  console.log('PASS macOS retains native chrome with no duplicate renderer menus');
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await browser.close();
}
