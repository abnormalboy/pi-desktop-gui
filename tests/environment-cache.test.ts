import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultSettings } from '../electron/store';
import { detectEnvironment, preparePi } from '../electron/environment';

test('startup shares environment probes and refreshes after executable, configuration, or explicit checks', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-environment-cache-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cli = path.join(directory, 'cli.mjs');
  const countFile = path.join(directory, 'versions.txt');
  const source = (version: string) => `import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(countFile)}, 'probe\\n');
console.log(${JSON.stringify(version)});`;
  await fs.writeFile(cli, source('1.1.0'));
  const settings = { ...defaultSettings, piPath: cli, nodePath: process.execPath, agentDir: directory };
  const count = async () => (await fs.readFile(countFile, 'utf8')).trim().split('\n').length;

  await Promise.all([preparePi(settings), preparePi(settings)]);
  assert.equal(await count(), 1, 'concurrent startup requests share one Pi version check');
  await preparePi(settings);
  assert.equal(await count(), 1);

  await fs.writeFile(path.join(directory, 'settings.json'), '{}');
  await Promise.all(Array.from({ length: 4 }, () => preparePi(settings)));
  assert.equal(await count(), 2, 'changed Pi settings invalidate the prepared environment');
  await detectEnvironment(settings);
  assert.equal(await count(), 3, 'the explicit environment action always rechecks');
  await preparePi(settings);
  assert.equal(await count(), 3, 'the explicit check refreshes the startup cache');

  await fs.writeFile(cli, source('unrecognized-entry'));
  await assert.rejects(preparePi(settings), /未检测到可识别的 Pi 版本/);
  assert.equal(await count(), 4, 'replacing the executable invalidates its cached version');
  await assert.rejects(preparePi(settings), /未检测到可识别的 Pi 版本/);
  assert.equal(await count(), 5, 'failed checks are never cached');
});

test('startup rechecks the runtime behind the official Pi CLI wrapper', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-environment-wrapper-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bundle = path.join(directory, 'dist', 'bundle');
  await fs.mkdir(bundle, { recursive: true });
  await fs.writeFile(path.join(directory, 'package.json'), '{"type":"module","version":"1.1.0"}');
  const cli = path.join(bundle, 'cli.js');
  const runtime = path.join(bundle, 'cli-runtime.js');
  await fs.writeFile(cli, "import './cli-runtime.js';");
  await fs.writeFile(runtime, "console.log('1.1.0');");
  const settings = { ...defaultSettings, piPath: cli, nodePath: process.execPath, agentDir: directory };
  assert.equal((await preparePi(settings)).environment.version, '1.1.0');
  await fs.writeFile(runtime, "console.log('unrecognized-runtime');");
  await assert.rejects(preparePi(settings), /未检测到可识别的 Pi 版本/);
});
