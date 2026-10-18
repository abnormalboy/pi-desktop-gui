import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLocalProvider, prepareRealPiFixture } from '../tests/support/local-provider.ts';

const provider = await createLocalProvider();
const f = await prepareRealPiFixture(provider.baseUrl, 'image-input-ui');
const output = path.resolve('output/playwright', `image-input-${process.platform}`);
await fs.mkdir(output, { recursive: true });
const large = path.join(f.projectDir, '大于256K.PNG');
const unknown = path.join(f.projectDir, 'image-payload');
const text = path.join(f.projectDir, '输入 文件.txt');
await fs.copyFile('build/icon-source-v2.png', large);
await fs.copyFile(large, unknown);
await fs.writeFile(path.join(f.projectDir, '.env'), 'PRIVATE_TEST_FILE');
let app, page;
const errors = [];
const executable =
  process.env.PI_DESKTOP_EXE ||
  (process.argv.includes('--packaged')
    ? path.resolve(
        process.platform === 'win32'
          ? 'release/win-unpacked/Pi Desktop.exe'
          : `release/mac${process.arch === 'arm64' ? '-arm64' : ''}/Pi Desktop.app/Contents/MacOS/Pi Desktop`,
      )
    : undefined);
const wait = async (condition) => {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > 25000) throw new Error('Image input condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};
const saved = () =>
  fs
    .readFile(path.join(f.dataDir, 'state.json'), 'utf8')
    .then(JSON.parse)
    .then((s) => s.sessions.find((s) => s.id === f.sessionId));
const imageCount = (count) => wait(async () => (await saved()).images?.length === count);
const transfer = async (files, type, event = 'drop') => {
  await page.evaluate(() => {
    document.querySelector('#image-input-files')?.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.hidden = true;
    input.id = 'image-input-files';
    document.body.append(input);
  });
  await page.locator('#image-input-files').setInputFiles(files);
  await page.evaluate(
    ({ type, event }) => {
      const dataTransfer = new DataTransfer();
      for (const file of document.querySelector('#image-input-files').files) {
        if (type !== null && !file.name.endsWith('.txt'))
          Object.defineProperty(file, 'type', { value: type });
        dataTransfer.items.add(file);
      }
      const target = document.querySelector(event === 'paste' ? '[aria-label="任务输入"]' : '.composer');
      target.dispatchEvent(
        event === 'paste'
          ? new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer })
          : new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
      );
    },
    { type, event },
  );
};
try {
  app = await electron.launch({
    executablePath: executable,
    args: executable ? [] : [path.resolve('.')],
    env: { ...process.env, PI_DESKTOP_DATA_DIR: f.dataDir, PI_OFFLINE: '1' },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(25000);
  page.on('pageerror', (error) => errors.push(error.message));
  const input = page.getByRole('textbox', { name: '任务输入' });
  await input.waitFor();
  await input.fill('保留原草稿');
  await transfer([large, text], '');
  await imageCount(1);
  assert.deepEqual((await saved()).attachments, ['输入 文件.txt']);
  await transfer([unknown], 'application/octet-stream');
  await imageCount(2);
  await transfer([large], '', 'paste');
  await imageCount(3);
  assert.ok((await saved()).images.every((image) => image.mimeType === 'image/png'));
  assert.equal(await page.locator('.error-banner').count(), 0);
  assert.equal(await input.inputValue(), '保留原草稿');
  console.log(
    'PASS large images with empty/generic MIME or no extension attach from drop and paste; mixed text remains a reference',
  );

  await input.fill('@大于256K');
  await page.getByRole('option', { name: /^大于256K\s*\.PNG$/ }).click();
  await imageCount(4);
  assert.equal(await input.inputValue(), '');
  assert.deepEqual((await saved()).attachments, ['输入 文件.txt']);
  console.log('PASS project image references become image attachments and avoid text-size limits');

  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, unknown);
  await page.getByRole('button', { name: '添加图片', exact: true }).click();
  await imageCount(5);
  assert.equal((await saved()).images.at(-1).mimeType, 'image/png');
  await assert.rejects(
    page.evaluate((id) => window.desktop.invoke('projectImage', id, '../outside.png'), f.projectId),
  );
  await assert.rejects(
    page.evaluate((id) => window.desktop.invoke('projectImage', id, '.env'), f.projectId),
    /凭据/,
  );
  const before = await saved();
  const broken = path.join(f.projectDir, 'broken.png');
  await fs.writeFile(broken, 'invalid image');
  await transfer([broken], '');
  await page.getByText('支持 PNG、JPEG、WebP、GIF，单张不超过 8 MiB', { exact: true }).waitFor();
  assert.deepEqual((await saved()).images, before.images);
  assert.equal(
    await page
      .locator('.error-banner')
      .getByText(/256 KiB/)
      .count(),
    0,
  );
  console.log(
    'PASS picker normalizes image MIME; malformed images get an image error; project reads keep path/credential restrictions',
  );
  await page.getByRole('button', { name: '关闭错误提示', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'attached.png'), animations: 'disabled' });

  const pendingDialog = app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = () =>
      new Promise((resolve) => {
        globalThis.finishImagePicker = resolve;
      });
  });
  await pendingDialog;
  await page.getByRole('button', { name: '添加图片', exact: true }).click();
  await input.fill('选择期间修改后的草稿');
  await page.getByRole('button', { name: '移除图片 image-payload', exact: true }).first().click();
  await imageCount(4);
  await app.evaluate(
    (_, file) => globalThis.finishImagePicker({ canceled: false, filePaths: [file] }),
    large,
  );
  await imageCount(5);
  assert.equal(await input.inputValue(), '选择期间修改后的草稿');
  assert.equal((await saved()).draft, '选择期间修改后的草稿');
  console.log('PASS delayed image selection preserves new draft text and intervening removals');

  await input.fill('IMAGE_INPUT_E2E');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await page.locator('.run-meta .completed').waitFor();
  const content = provider.requests.at(-1).messages.findLast((message) => message.role === 'user').content;
  const images = content.filter((item) => item.type === 'image_url');
  assert.equal(images.length, 5);
  assert.ok(images.every((image) => image.image_url.url.startsWith('data:image/png;base64,')));
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        packaged: Boolean(executable),
        imageBytes: (await fs.stat(large)).size,
        checks: [
          'drop empty MIME',
          'drop unknown extension',
          'paste empty MIME',
          'mixed text and image',
          'project reference',
          'native picker',
          'draft race',
          'real Pi image delivery',
        ],
        rendererErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log('PASS actual Pi receives all images as PNG image blocks through the local provider');
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  // These fixtures do not test quit confirmations; also clean up a failed assertion during startup.
  await page?.evaluate(() => window.desktop.invoke('stop')).catch(() => {});
  await app?.close().catch(() => {});
  await provider.close();
}
