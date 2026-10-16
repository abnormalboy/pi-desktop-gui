import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const script = fs.readFileSync(new URL('../scripts/test-theme-ui.mjs', import.meta.url), 'utf8');
const start = script.indexOf('async function launch() {');
const end = script.indexOf('\nasync function checkTheme(', start);
assert.ok(start >= 0 && end > start);

test('every native appearance launch leaves color scheme to Electron, including restart and packaged mode', async () => {
  for (const executablePath of [undefined, '/fixture/Pi Desktop']) {
    const calls = [];
    const stop = new Error('Launch options captured without starting Electron');
    // Execute the actual launch function only as far as the public Playwright call.
    const launch = new Function(
      'electron',
      'path',
      'process',
      'dir',
      `let app, page; ${script.slice(start, end)}; return launch;`,
    )(
      {
        launch: async (options) => {
          calls.push(options);
          throw stop;
        },
      },
      path,
      { env: { PI_DESKTOP_EXE: executablePath } },
      '/isolated-theme-fixture',
    );
    for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(launch, (error) => error === stop);
    for (const options of calls) {
      assert.equal(options.colorScheme, null, 'Omitting this option silently emulates light');
      assert.equal(options.executablePath, executablePath);
      assert.deepEqual(options.args, executablePath ? [] : [path.resolve('.')]);
      assert.equal(options.env.PI_DESKTOP_DATA_DIR, '/isolated-theme-fixture');
      assert.equal(options.env.PI_OFFLINE, '1');
      assert.equal(Object.hasOwn(options, 'viewport'), false);
      assert.equal(Object.hasOwn(options, 'headless'), false);
    }
  }
});

test('native appearance still checks actual media against nativeTheme without per-page color emulation', () => {
  assert.equal((script.match(/electron\.launch\(/g) ?? []).length, 1);
  assert.doesNotMatch(script, /\.emulateMedia\(|setEmulatedMedia/);
  assert.match(
    script,
    /\(dark\) => matchMedia\('\(prefers-color-scheme: dark\)'\)\.matches === dark,\s*native\.dark/,
  );
  assert.match(script, /assert\.equal\(native\.source, source,/);
  assert.match(script, /assert\.equal\(native\.dark, source === 'dark'\)/);
});
