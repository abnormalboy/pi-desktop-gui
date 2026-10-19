import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { Platform } from 'electron-builder';
import electronUpdater from 'electron-updater';
import writeWindowsUpdateConfig from '../scripts/after-pack.mjs';
import { verifyUpdateMetadata } from '../scripts/verify-update-metadata.mjs';

test('Windows directory packages include the repository and native download cache configuration', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-packaged-update-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const resources = path.join(dir, 'resources');
  await fs.mkdir(resources);
  const appInfo = { channel: null, updaterCacheDirName: 'pi-desktop-gui-updater' };
  await writeWindowsUpdateConfig({
    electronPlatformName: 'win32',
    appOutDir: dir,
    arch: 1,
    packager: {
      platform: Platform.WINDOWS,
      config: project.build,
      platformSpecificBuildOptions: project.build.win,
      appInfo,
      info: { config: project.build, appInfo },
      expandMacro: (value) => value,
      getResourcesDir: () => resources,
    },
  });
  const native = new electronUpdater.NsisUpdater(null, {
    version: project.version,
    name: project.name,
    isPackaged: true,
    appUpdateConfigPath: path.join(resources, 'app-update.yml'),
    userDataPath: dir,
    baseCachePath: dir,
  });
  native.logger = null;
  const config = await native.configOnDisk.value;
  assert.equal(config.provider, 'github');
  assert.equal(config.owner, 'yeyuProject');
  assert.equal(config.repo, 'pi-desktop-gui');
  assert.equal(
    (await native.getOrCreateDownloadHelper()).cacheDir,
    path.join(dir, appInfo.updaterCacheDirName),
  );
});

test('release validation rejects wrong versions, damaged assets, missing blockmaps and wrong targets', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-update-manifest-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const url = 'Pi-Desktop-0.9.0-win-x64-setup.exe',
    bytes = Buffer.from('fixture installer');
  const entry = { url, size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') };
  const write = (files = [entry], version = '0.9.0', name = 'latest.yml') =>
    fs.writeFile(path.join(dir, name), yaml.dump({ version, files }));
  await fs.writeFile(path.join(dir, url), bytes);
  await fs.writeFile(path.join(dir, url + '.blockmap'), 'fixture');
  await write();
  assert.deepEqual(await verifyUpdateMetadata(dir, '0.9.0', ['latest.yml']), ['latest.yml']);
  await assert.rejects(verifyUpdateMetadata(dir, '0.9.1'), /expected version/);
  await fs.writeFile(path.join(dir, url), 'tampered installer');
  await assert.rejects(verifyUpdateMetadata(dir, '0.9.0'), /SHA-512 mismatch/);
  await fs.writeFile(path.join(dir, url), bytes);
  await fs.unlink(path.join(dir, url + '.blockmap'));
  await assert.rejects(verifyUpdateMetadata(dir, '0.9.0'), /ENOENT/);
  await fs.writeFile(path.join(dir, url + '.blockmap'), 'fixture');
  await write([{ ...entry, url: '../outside.exe' }]);
  await assert.rejects(verifyUpdateMetadata(dir, '0.9.0'), /release asset name/);
  await write();
  await write([entry], '0.9.0', 'latest-linux.yml');
  await assert.rejects(verifyUpdateMetadata(dir, '0.9.0'), /include the AppImage/);
});
