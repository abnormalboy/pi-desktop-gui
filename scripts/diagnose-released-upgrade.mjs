import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

// Historical diagnostic, never a replacement for the normal updater tests. Nothing is rebuilt.
// These are published production installers, so execution is deliberately restricted to hosted CI.
const repository = 'yeyuProject/pi-desktop-gui';
const branch = 'refs/heads/diagnose/released-upgrade-18-19';
const oldVersion = '0.14.18';
const nextVersion = '0.14.19';
const appId = 'io.yeyuproject.pi-desktop';
const nsisUuidNamespace = '50e065bc-3134-11e6-9bab-38c9862bdaf3';
const guid = 'd2008bbf-a83c-592b-a19d-b5234d5df873';
const uninstallDisplayNamePattern = '^Pi Desktop(?: [0-9]+\\.[0-9]+\\.[0-9]+)?$';
const downloadRoot = `https://github.com/${repository}/releases/download/`;
const assets = [
  {
    version: oldVersion,
    name: 'Pi-Desktop-0.14.18-win-x64-setup.exe',
    size: 122136956,
    sha256: '2c7eec8c3ecdd1225e16a68f056dcb2bd4c3a1e34561e5177103f2d4a843ec20',
  },
  {
    version: oldVersion,
    name: 'Pi-Desktop-0.14.18-win-x64-setup.exe.blockmap',
    size: 128884,
    sha256: '4a2385fd0493d0b03e2d2a4b2a11833b2842344012072cd5b9a2da7191221828',
  },
  {
    version: oldVersion,
    name: 'latest.yml',
    size: 371,
    sha256: '87f6ad314b9d567199ee9f164183e17eceaabfdad71b91b803240c6382e8178f',
  },
  {
    version: nextVersion,
    name: 'Pi-Desktop-0.14.19-win-x64-setup.exe',
    size: 122136498,
    sha256: '62a2767d84634f70fc2927d6c43a2c66aa8b2da677d4839103a60a0f28f8321c',
  },
  {
    version: nextVersion,
    name: 'Pi-Desktop-0.14.19-win-x64-setup.exe.blockmap',
    size: 128796,
    sha256: '48d4c8a899e12faf70acb803d9d6d638aab9e76736048959584732fee722430e',
  },
  {
    version: nextVersion,
    name: 'latest.yml',
    size: 371,
    sha256: 'c96227b82a959bac3776f19b5530ffe4c1831b45c67b8ee45ff7382cfcfb40b0',
  },
].map((asset) => ({ ...asset, url: `${downloadRoot}v${asset.version}/${asset.name}` }));
const releasedPayloads = {
  '0.14.18': {
    asarSha256: 'c1088733f2b1cae419c1dffe0e49f9b21a574da083338b55f5d8a7e2e519c7da',
    mainSourceSha256: 'a0ce6d4fbde8c129331206400690daa08a9781c1b4859b8da2c221e265e767d1',
  },
  '0.14.19': {
    asarSha256: '7eaf840d5fd8c8f083a5bb73d78e6423fabb90b2404c118585604e75c9cf644d',
    mainSourceSha256: 'd641cc338c697293efe75134d388f01c0628173624afee2c338c11107b9458aa',
  },
};
const executableVersionMatches = (actual, expected) => actual === expected || actual === expected + '.0';
const nextInstallerSha512 =
  'oiiSrzkslO2zkNo0UZdO0gF6RAS9CF5flyaMKJAK1BnHp17KpZl2DcJ73xX6/1N2nEFQ1ygZBZopnYTifH95xw==';
const exec = promisify(execFile);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (data, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(data).digest(encoding);
const hashFile = async (file, algorithm = 'sha256', encoding = 'hex') => {
  const digest = createHash(algorithm);
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest(encoding);
};
const quotePS = (value) => `'${String(value).replaceAll("'", "''")}'`;
const runPS = async (source, timeout = 30000) => {
  const { stdout } = await exec(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(`$ErrorActionPreference='Stop'; ${source}`, 'utf16le').toString('base64'),
    ],
    { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 },
  );
  return stdout.replace(/^\uFEFF/, '').trim();
};
const psJSON = async (source) => JSON.parse((await runPS(source)) || 'null');
const until = async (description, check, timeout = 180000) => {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = String(error);
    }
    await pause(500);
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `; last observation: ${lastError}` : ''}`,
  );
};
const productionPath = (version, name) => `/${repository}/releases/download/v${version}/${name}`;
const releasePath = `/${repository}/releases`;
const releaseApiPath = `/repos/${repository}/releases`;

// Only exact historical GitHub requests are redirected; all unrelated requests are denied.
function mappedPath(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') return undefined;
  if (
    url.hostname === 'github.com' &&
    [releasePath + '.atom', releasePath + '/latest'].includes(url.pathname)
  )
    return url.pathname;
  if (
    url.hostname === 'api.github.com' &&
    [releaseApiPath + '/latest', releaseApiPath + '/tags/v' + nextVersion].includes(url.pathname)
  )
    return url.pathname;
  if (
    url.hostname === 'github.com' &&
    assets.some((asset) => productionPath(asset.version, asset.name) === url.pathname)
  )
    return url.pathname;
  return undefined;
}
function parseRange(value, size) {
  if (value === undefined) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
  return { start, end };
}
function selectAutomaticMainProcess(processes, { oldPid, executable, restartAt, expectedPid }) {
  return processes.find(
    (item) =>
      Number.isInteger(item.pid) &&
      item.pid > 0 &&
      item.pid !== oldPid &&
      (expectedPid === undefined || item.pid === expectedPid) &&
      item.path?.toLowerCase() === executable.toLowerCase() &&
      typeof item.commandLine === 'string' &&
      /(?:^|\s)"?--updated"?(?=\s|$)/i.test(item.commandLine) &&
      !/(?:^|\s)"?--type(?:=|\s|$)/i.test(item.commandLine) &&
      Number.isInteger(item.windowHandle) &&
      item.windowHandle !== 0 &&
      item.windowVisible === true &&
      Date.parse(item.created) >= restartAt - 1000 &&
      processes.some(
        (child) =>
          child.pid !== item.pid &&
          child.parentPid === item.pid &&
          child.path?.toLowerCase() === executable.toLowerCase() &&
          typeof child.commandLine === 'string' &&
          /(?:^|\s)"?--type=renderer"?(?=\s|$)/i.test(child.commandLine) &&
          Date.parse(child.created) >= Date.parse(item.created),
      ),
  );
}
async function makeServer(files, log, notes) {
  const release = JSON.stringify({
    tag_name: `v${nextVersion}`,
    draft: false,
    prerelease: false,
    body: notes,
  });
  const atom = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Historical released baseline</title><entry><title>Pi Desktop v${nextVersion}</title><link href="https://github.com/${repository}/releases/tag/v${nextVersion}"/><content type="text">Historical released baseline</content></entry></feed>`;
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const entry = {
      at: new Date().toISOString(),
      method: req.method,
      path: pathname,
      range: req.headers.range,
    };
    log(entry);
    res.once('finish', () =>
      log({
        ...entry,
        completed: true,
        status: res.statusCode,
        contentLength: res.getHeader('Content-Length'),
      }),
    );
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405);
        res.end();
        return;
      }
      let body;
      if (pathname === releasePath + '.atom') {
        body = atom;
        res.setHeader('Content-Type', 'application/atom+xml');
      } else if (
        [
          releasePath + '/latest',
          releaseApiPath + '/latest',
          releaseApiPath + '/tags/v' + nextVersion,
        ].includes(pathname)
      ) {
        body = release;
        res.setHeader('Content-Type', 'application/json');
      }
      if (body !== undefined) {
        res.writeHead(200, { 'Content-Length': Buffer.byteLength(body) });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      const file = files.get(pathname);
      if (!file) {
        res.writeHead(404);
        res.end('unmapped historical asset');
        return;
      }
      const size = (await fs.stat(file)).size;
      const range = parseRange(req.headers.range, size);
      if (range === null) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        res.end();
        return;
      }
      const headers = {
        'Content-Length': range ? range.end - range.start + 1 : size,
        'Accept-Ranges': 'bytes',
      };
      if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
      res.writeHead(range ? 206 : 200, headers);
      entry.status = range ? 206 : 200;
      if (req.method === 'HEAD') res.end();
      else
        createReadStream(file, range ?? {})
          .on('error', (error) => res.destroy(error))
          .pipe(res);
    } catch (error) {
      log({ at: new Date().toISOString(), serverError: String(error), path: pathname });
      res.destroy(error);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}
async function verifyAsset(asset, file) {
  assert.equal((await fs.stat(file)).size, asset.size, `${asset.name} size`);
  assert.equal(await hashFile(file), asset.sha256, `${asset.name} SHA256`);
}

async function selfTest() {
  const selectorOptions = {
    oldPid: 100,
    executable: 'C:\\Pi\\Pi Desktop.exe',
    restartAt: Date.parse('2026-10-19T10:00:00Z'),
  };
  const visibleMain = {
    pid: 200,
    path: selectorOptions.executable,
    commandLine: '"C:\\Pi\\Pi Desktop.exe" --updated',
    created: '2026-10-19T10:00:02Z',
    windowHandle: 786818,
    windowVisible: true,
    windowTitle: '',
  };
  const renderer = {
    pid: 201,
    parentPid: visibleMain.pid,
    path: selectorOptions.executable,
    commandLine: '"C:\\Pi\\Pi Desktop.exe" --type=renderer',
    created: '2026-10-19T10:00:02.100Z',
  };
  assert.equal(
    selectAutomaticMainProcess([visibleMain, renderer], selectorOptions),
    visibleMain,
    'A visible custom-titlebar main window may have an empty native title',
  );
  for (const patch of [
    { windowVisible: false },
    { windowVisible: undefined },
    { windowHandle: 0 },
    { commandLine: visibleMain.commandLine + ' --type=renderer' },
    { commandLine: visibleMain.commandLine + ' --type=gpu-process' },
    { commandLine: visibleMain.commandLine + ' "--type=utility"' },
    { commandLine: undefined },
    { commandLine: '"C:\\Pi\\Pi Desktop.exe"' },
    { commandLine: '"C:\\Pi\\Pi Desktop.exe" --updated-fake' },
    { pid: selectorOptions.oldPid },
    { path: 'C:\\Other\\Pi Desktop.exe' },
    { created: '2026-10-19T09:59:58Z' },
  ])
    assert.equal(
      selectAutomaticMainProcess([{ ...visibleMain, ...patch }, renderer], selectorOptions),
      undefined,
    );
  assert.equal(
    selectAutomaticMainProcess([visibleMain, renderer], { ...selectorOptions, expectedPid: 201 }),
    undefined,
  );
  assert.equal(
    selectAutomaticMainProcess([visibleMain], selectorOptions),
    undefined,
    'A native error box without a renderer cannot count as normal app startup',
  );
  for (const patch of [
    { parentPid: 999 },
    { path: 'C:\\Other\\Pi Desktop.exe' },
    { commandLine: '"C:\\Pi\\Pi Desktop.exe" --type=gpu-process' },
    { created: '2026-10-19T10:00:01Z' },
  ])
    assert.equal(
      selectAutomaticMainProcess([visibleMain, { ...renderer, ...patch }], selectorOptions),
      undefined,
    );
  const { UUID } = await import('builder-util-runtime');
  assert.equal(
    UUID.v5(appId, UUID.parse(nsisUuidNamespace)),
    guid,
    'Production NSIS identity derives from the released appId',
  );
  const productName = new RegExp(uninstallDisplayNamePattern);
  for (const name of ['Pi Desktop', 'Pi Desktop 0.14.18', 'Pi Desktop 0.14.19'])
    assert.equal(productName.test(name), true);
  for (const name of [
    'Other Pi Desktop',
    'Pi Desktop Helper',
    'Pi Desktop 0x14x18',
    'Pi Desktop 0.14.18 Helper',
  ])
    assert.equal(productName.test(name), false);
  assert.equal(executableVersionMatches('0.14.18', oldVersion), true);
  assert.equal(executableVersionMatches('0.14.18.0', oldVersion), true);
  assert.equal(executableVersionMatches('0.14.18.1', oldVersion), false);
  assert.equal(mappedPath('https://github.com/' + repository + '/releases/latest'), releasePath + '/latest');
  assert.equal(mappedPath(assets[0].url + '?noCache=1'), productionPath(assets[0].version, assets[0].name));
  for (const bad of [
    'https://github.com/other/repo/releases/latest',
    'https://api.github.com/user',
    'http://github.com/' + repository + '/releases/latest',
    'https://github.com/' + repository + '/releases/download/v0.14.20/latest.yml',
    'https://github.com.evil.invalid/' + repository + '/releases/latest',
  ])
    assert.equal(mappedPath(bad), undefined);
  assert.deepEqual(parseRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseRange('bytes=8-', 10), { start: 8, end: 9 });
  assert.deepEqual(parseRange('bytes=8-99', 10), { start: 8, end: 9 });
  for (const bad of ['bytes=10-', 'bytes=5-1', 'bytes=0-1,5-6', 'bytes=-5'])
    assert.equal(parseRange(bad, 10), null);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'released-upgrade-self-test-'));
  const file = path.join(dir, 'fixture');
  const data = Buffer.from('0123456789');
  await fs.writeFile(file, data);
  const asset = { size: data.length, name: 'fixture', sha256: hash(data) };
  let server;
  try {
    await verifyAsset(asset, file);
    await assert.rejects(verifyAsset({ ...asset, sha256: '0'.repeat(64) }, file), /SHA256/);
    server = await makeServer(new Map([['/asset', file]]), () => {}, 'self test');
    const base = `http://127.0.0.1:${server.address().port}`;
    const full = await fetch(base + '/asset');
    assert.equal(full.status, 200);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), data);
    const range = await fetch(base + '/asset', { headers: { Range: 'bytes=2-5' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await range.text(), '2345');
    assert.equal((await fetch(base + '/asset', { headers: { Range: 'bytes=99-' } })).status, 416);
    assert.equal((await fetch(base + '/unmapped')).status, 404);
    const metadata = await (await fetch(base + releaseApiPath + '/latest')).json();
    assert.equal(metadata.tag_name, 'v0.14.19');
    assert.match(await (await fetch(base + releasePath + '.atom')).text(), /releases\/tag\/v0\.14\.19/);
    console.log(
      'PASS diagnostic visible-main selection, NSIS identity, bounded uninstall names, hash guard, URL allowlist, fixed metadata, full/range/error transport self-tests',
    );
  } finally {
    server?.closeAllConnections();
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function diagnose() {
  assert.equal(process.platform, 'win32', 'This diagnostic runs only on Windows');
  assert.equal(
    process.env.GITHUB_ACTIONS,
    'true',
    'Never run production-identity installers on a user device',
  );
  assert.equal(
    process.env.RUNNER_ENVIRONMENT,
    'github-hosted',
    'Only ephemeral GitHub-hosted runners are allowed',
  );
  assert.equal(process.env.RUNNER_OS, 'Windows');
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  assert.equal(process.env.GITHUB_REF, branch, 'Diagnostic branch only; never main or release tags');
  assert.equal(process.env.GITHUB_WORKFLOW, 'Diagnose released Windows upgrade');
  const { _electron: electron } = await import('playwright');
  const { extractFile, uncache } = await import('@electron/asar');
  const { load: yaml } = await import('js-yaml');
  const root = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP, 'pi-released-upgrade-'));
  const output = path.resolve('test-results/released-upgrade-18-19');
  await fs.mkdir(output, { recursive: true });
  const eventFile = path.join(output, 'events.jsonl');
  const pendingWrites = new Set();
  const record = (kind, value = {}) => {
    const entry = { at: new Date().toISOString(), kind, ...value };
    const write = fs.appendFile(eventFile, JSON.stringify(entry) + '\n');
    pendingWrites.add(write);
    void write.finally(() => pendingWrites.delete(write));
    return write;
  };
  const writeJSON = (name, value) => fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2));
  const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'pi-desktop-gui');
  const executable = path.join(installDir, 'Pi Desktop.exe');
  const userData = path.join(process.env.APPDATA, 'pi-desktop-gui');
  const updaterCache = path.join(process.env.LOCALAPPDATA, 'pi-desktop-gui-updater');
  const registry = `HKCU:\\Software\\${guid}`;
  const uninstallKey = `HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`;
  const files = new Map();
  let server, app, page, observer;
  let installedByDiagnostic = false;
  let syntheticStoreSeeded = false;
  let clickAt;
  const result = {
    baseline: 'not-run',
    from: oldVersion,
    to: nextVersion,
    productionIdentity: { appId, productName: 'Pi Desktop', guid, nsisUuidNamespace },
    installation: { installDir, executable, userData, updaterCache },
    scope:
      'Unmodified released Windows NSIS baseline, default production installation on ephemeral hosted CI only',
    limits: [
      'Loopback transport selects historical v0.14.19 instead of today’s latest release; app, updater, installers, install identity and shortcuts are unchanged.',
      'Success establishes one clean hosted-runner baseline; it does not identify the cause of issue #18 or exclude device-specific failures.',
      'Restart evidence requires a new automatic --updated main process with a visible native window and its exact-path renderer child, installed ASAR version and executable product version; the new app is never launched by this harness. This is not a functional renderer acceptance test.',
      'No mutex/path-conflict scenario is included; this baseline must be evaluated before adding controlled failure cases.',
      'Only the old application’s update transport is pinned to historical bytes. The unmodified new process may perform its normal live GitHub check after ten seconds; it is force-stopped during cleanup without an on-quit install.',
    ],
  };
  const snapshot = async (label) => {
    const data = await psJSON(`
      Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class PiWindowVisibility { [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr window); }';
      $install=${quotePS(installDir)};
      $entries=@(); foreach($base in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')) {
        if(Test-Path $base) { $entries+=@(Get-ChildItem $base | Get-ItemProperty | Where-Object { $_.PSChildName -eq ${quotePS(guid)} -or $_.DisplayName -match ${quotePS(uninstallDisplayNamePattern)} } | Select-Object PSChildName,DisplayName,DisplayVersion,InstallLocation,UninstallString,QuietUninstallString) }
      }
      $keys=@(); foreach($key in @(${quotePS(registry)},${quotePS(uninstallKey)})) {
        if(Test-Path $key) { $value=Get-ItemProperty $key; $keys+=@{ key=$key; installLocation=$value.InstallLocation; displayVersion=$value.DisplayVersion; uninstallString=$value.UninstallString } }
      }
      $shortcuts=@(); $shell=New-Object -ComObject WScript.Shell;
      foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonDesktopDirectory'),[Environment]::GetFolderPath('StartMenu'),[Environment]::GetFolderPath('CommonStartMenu'))) {
        foreach($candidate in @((Join-Path $folder 'Pi Desktop.lnk'),(Join-Path $folder 'Programs\\Pi Desktop.lnk'),(Join-Path $folder 'Programs\\Pi Desktop\\Pi Desktop.lnk'))) {
          if(Test-Path $candidate) { $link=$shell.CreateShortcut($candidate); $shortcuts+=@{ path=$candidate; target=$link.TargetPath; arguments=$link.Arguments; workingDirectory=$link.WorkingDirectory } }
        }
      }
      $processes=@(Get-CimInstance Win32_Process -Filter "Name='Pi Desktop.exe'" | ForEach-Object {
        $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue;
        $handle=if($p){$p.MainWindowHandle.ToInt64()}else{0};
        $visible=($handle -ne 0) -and [PiWindowVisibility]::IsWindowVisible([IntPtr]$handle);
        @{ pid=$_.ProcessId; parentPid=$_.ParentProcessId; path=$_.ExecutablePath; commandLine=$_.CommandLine; created=$_.CreationDate.ToUniversalTime().ToString('o'); windowHandle=$handle; windowVisible=$visible; windowTitle=if($p){$p.MainWindowTitle}else{''} }
      });
      @{ uninstallEntries=$entries; identityKeys=$keys; shortcuts=$shortcuts; processes=$processes; installed=(Test-Path ${quotePS(executable)}); userDataExists=(Test-Path ${quotePS(userData)}); cacheExists=(Test-Path ${quotePS(updaterCache)}) } | ConvertTo-Json -Depth 8 -Compress
    `);
    await writeJSON(`${label}-system.json`, data);
    return data;
  };
  const captureStoreSummary = async (label) => {
    if (!syntheticStoreSeeded) {
      await writeJSON(`${label}-store-summary.json`, {
        captured: false,
        reason: 'The diagnostic has not seeded its synthetic store.',
      });
      return;
    }
    const state = JSON.parse(await fs.readFile(path.join(userData, 'state.json'), 'utf8'));
    const synthetic = state.sessions?.find((item) => item.id === 'released-upgrade-baseline');
    const summary = {
      schemaVersion: state.version,
      appVersion: state.appVersion,
      session: synthetic
        ? {
            id: synthetic.id,
            title: synthetic.title,
            draft: synthetic.draft,
            approvalMode: synthetic.approvalMode,
          }
        : undefined,
      theme: state.settings?.theme,
    };
    await writeJSON(`${label}-store-summary.json`, summary);
    return summary;
  };
  const payload = async (label) => {
    const asar = path.join(installDir, 'resources/app.asar');
    // NSIS replaces this same path; ASAR caches headers by filename, not file identity.
    uncache(asar);
    const pkg = JSON.parse(extractFile(asar, 'package.json').toString());
    const source = extractFile(asar, 'dist-electron/main.cjs').toString();
    const silentCalls = [...source.matchAll(/.{0,120}quitAndInstall\(true, true\).{0,120}/g)].map(
      (match) => match[0],
    );
    const info = {
      package: { name: pkg.name, version: pkg.version, main: pkg.main },
      asarSha256: await hashFile(asar),
      executableSha256: await hashFile(executable),
      mainSourceSha256: hash(source),
      silentInstallCallExcerpts: silentCalls,
      containsFutureRepairMarker: /update-install-receipt|update-install\.json|recordInstallAttempt/.test(
        source,
      ),
      executableVersion: await psJSON(
        `$v=(Get-Item ${quotePS(executable)}).VersionInfo; @{fileVersion=$v.FileVersion; productVersion=$v.ProductVersion; productName=$v.ProductName} | ConvertTo-Json -Compress`,
      ),
      updateConfig: await fs.readFile(path.join(installDir, 'resources/app-update.yml'), 'utf8'),
    };
    await writeJSON(`${label}-payload.json`, info);
    return info;
  };
  try {
    const initial = await snapshot('00-before');
    assert.equal(initial.installed, false, 'Refusing to overwrite any pre-existing application');
    assert.equal(initial.userDataExists, false, 'Refusing to use any pre-existing production data');
    assert.equal(initial.cacheExists, false, 'Refusing to use any pre-existing updater cache');
    assert.deepEqual(initial.processes, [], 'Refusing to touch pre-existing application processes');
    assert.deepEqual(
      initial.uninstallEntries,
      [],
      'Refusing to replace an existing registered production install',
    );
    assert.deepEqual(initial.identityKeys, [], 'Refusing to overwrite existing production identity keys');
    assert.deepEqual(initial.shortcuts, [], 'Refusing to replace existing production shortcuts');
    for (const asset of assets) {
      const dir = path.join(root, 'assets', asset.version);
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, asset.name);
      const response = await fetch(asset.url, { signal: AbortSignal.timeout(180000) });
      assert.equal(response.ok, true, `Download ${asset.url}: ${response.status}`);
      await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
      await verifyAsset(asset, file);
      files.set(productionPath(asset.version, asset.name), file);
      await record('verified-release-asset', asset);
    }
    await writeJSON('verified-assets.json', assets);
    for (const version of [oldVersion, nextVersion]) {
      const manifest = yaml(await fs.readFile(files.get(productionPath(version, 'latest.yml')), 'utf8'));
      assert.equal(manifest.version, version);
      assert.equal(manifest.files.length, 1);
      assert.equal(manifest.files[0].url, `Pi-Desktop-${version}-win-x64-setup.exe`);
      const setup = files.get(productionPath(version, manifest.files[0].url));
      assert.equal(await hashFile(setup, 'sha512', 'base64'), manifest.files[0].sha512);
      assert.equal((await fs.stat(setup)).size, manifest.files[0].size);
      if (version === nextVersion) assert.equal(manifest.files[0].sha512, nextInstallerSha512);
      await fs.copyFile(
        files.get(productionPath(version, 'latest.yml')),
        path.join(output, `released-${version}-latest.yml`),
      );
    }
    const notes = await fs.readFile('docs/releases/v0.14.19.md', 'utf8');
    server = await makeServer(files, (entry) => void record('loopback-request', entry), notes);
    const base = `http://127.0.0.1:${server.address().port}`;

    // Start/stop traces retain installer exit status even when a failed process is too brief for polling.
    // The WMI filter includes only Pi's known executable/installer names, never unrelated commands.
    const traceFile = path.join(output, 'process-trace.jsonl');
    const ready = path.join(root, 'observer-ready');
    const stop = path.join(root, 'observer-stop');
    const watch = `
      $ErrorActionPreference='Stop'; $trace=${quotePS(traceFile)}; $stop=${quotePS(stop)};
      $filter="ProcessName='Pi Desktop.exe' OR ProcessName='installer.exe' OR ProcessName='Uninstall Pi Desktop.exe' OR ProcessName='Pi-Desktop-0.14.18-win-x64-setup.exe' OR ProcessName='Pi-Desktop-0.14.19-win-x64-setup.exe'";
      Register-CimIndicationEvent -Query ("SELECT * FROM Win32_ProcessStartTrace WHERE "+$filter) -SourceIdentifier 'PiStart' | Out-Null;
      Register-CimIndicationEvent -Query ("SELECT * FROM Win32_ProcessStopTrace WHERE "+$filter) -SourceIdentifier 'PiStop' | Out-Null;
      Set-Content -LiteralPath ${quotePS(ready)} -Value 'ready';
      try { while(!(Test-Path $stop)) {
        Wait-Event -Timeout 1 | Out-Null;
        foreach($event in @(Get-Event)) {
          if($event.SourceIdentifier -notin @('PiStart','PiStop')) { continue }
          $e=$event.SourceEventArgs.NewEvent;
          $item=@{ observedAt=[DateTime]::UtcNow.ToString('o'); kind=$event.SourceIdentifier; pid=$e.ProcessID; parentPid=$e.ParentProcessID; name=$e.ProcessName };
          if($event.SourceIdentifier -eq 'PiStart') {
            $p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$e.ProcessID) -ErrorAction SilentlyContinue;
            if($p) { $item.path=$p.ExecutablePath; $item.commandLine=$p.CommandLine }
          } else { $item.exitStatus=$e.ExitStatus }
          [IO.File]::AppendAllText($trace,($item | ConvertTo-Json -Compress)+[Environment]::NewLine);
          Remove-Event -EventIdentifier $event.EventIdentifier;
        }
      } } finally { Unregister-Event 'PiStart'; Unregister-Event 'PiStop' }
    `;
    observer = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(watch, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    observer.stdout.on('data', (chunk) => void record('process-observer-stdout', { text: chunk.toString() }));
    observer.stderr.on('data', (chunk) => void record('process-observer-stderr', { text: chunk.toString() }));
    observer.on('error', (error) => void record('process-observer-error', { error: String(error) }));
    await until('process observer readiness', async () => fs.stat(ready).catch(() => undefined), 30000);
    const oldInstaller = files.get(productionPath(oldVersion, `Pi-Desktop-${oldVersion}-win-x64-setup.exe`));
    installedByDiagnostic = true;
    await record('initial-installer-start', { executable: oldInstaller, args: ['/S'] });
    // No /D, identity, GUID, shortcut or application-data override: production defaults are intentional.
    const installed = await exec(oldInstaller, ['/S'], { windowsHide: true, timeout: 180000 });
    await record('initial-installer-exit', {
      exitCode: 0,
      stdout: installed.stdout,
      stderr: installed.stderr,
    });
    await until('old released executable', async () => fs.stat(executable).catch(() => undefined));
    const oldPayload = await payload('01-old');
    assert.equal(oldPayload.package.version, oldVersion);
    assert.equal(oldPayload.package.name, 'pi-desktop-gui');
    assert.equal(
      oldPayload.silentInstallCallExcerpts.length,
      1,
      'The real old-code silent update path must be present',
    );
    assert.equal(oldPayload.containsFutureRepairMarker, false);
    assert.equal(executableVersionMatches(oldPayload.executableVersion.productVersion, oldVersion), true);
    assert.equal(oldPayload.asarSha256, releasedPayloads[oldVersion].asarSha256);
    assert.equal(oldPayload.mainSourceSha256, releasedPayloads[oldVersion].mainSourceSha256);
    const beforeLaunch = await snapshot('01-installed-old');
    assert.ok(
      beforeLaunch.identityKeys.some(
        (key) => key.installLocation?.toLowerCase() === installDir.toLowerCase(),
      ),
      'Production registry install path',
    );
    assert.ok(
      beforeLaunch.uninstallEntries.some(
        (entry) => entry.PSChildName?.toLowerCase() === guid && entry.DisplayVersion === oldVersion,
      ),
      'Production GUID and old-version uninstall entry',
    );
    assert.ok(
      beforeLaunch.shortcuts.some((link) => link.target?.toLowerCase() === executable.toLowerCase()),
      'Production shortcut points at installed old executable',
    );
    assert.deepEqual(
      beforeLaunch.processes,
      [],
      'Silent initial install must not have started a competing instance',
    );

    // This is a small normal persisted index on a clean CI account, not a replacement updater/store.
    // No PI_DESKTOP_DATA_DIR, offline mode, fixture Pi binary, or userData redirection is used.
    const draft = 'Historical released upgrade diagnostic draft';
    await fs.mkdir(userData, { recursive: true });
    await fs.writeFile(
      path.join(userData, 'state.json'),
      JSON.stringify({
        version: 1,
        appVersion: oldVersion,
        projects: [],
        selectedSessionId: 'released-upgrade-baseline',
        sessions: [
          {
            id: 'released-upgrade-baseline',
            title: 'Released upgrade baseline',
            updatedAt: Date.now(),
            lastStatus: 'idle',
            draft,
            approvalMode: 'confirm',
          },
        ],
        settings: { onboardingDone: true, autoDownloadUpdates: true, theme: 'dark' },
      }),
    );
    syntheticStoreSeeded = true;
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (/^(PI_|ELECTRON_|PORTABLE_|APPIMAGE|NODE_OPTIONS|GH_TOKEN|GITHUB_TOKEN)/.test(key)) delete env[key];
    app = await electron.launch({ executablePath: executable, args: [], env, timeout: 60000 });
    const launcherPid = app.process().pid;
    app.process().stdout?.on('data', (chunk) => void record('old-app-stdout', { text: chunk.toString() }));
    app.process().stderr?.on('data', (chunk) => void record('old-app-stderr', { text: chunk.toString() }));
    app.process().on('exit', (code, signal) => void record('old-app-exit', { code, signal }));
    // Install transport hooks immediately, before the released app's ten-second startup check.
    const hooked = await app.evaluate(
      ({ app, session }, { base, exact }) => {
        globalThis.releasedUpgradeRequests = [];
        globalThis.releasedUpgradeLifecycle = [];
        for (const event of ['before-quit', 'will-quit', 'quit', 'second-instance'])
          app.on(event, () => globalThis.releasedUpgradeLifecycle.push({ event, at: Date.now() }));
        for (const [name, target] of [
          ['default', session.defaultSession],
          ['electron-updater', session.fromPartition('electron-updater', { cache: false })],
        ]) {
          target.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
            const url = new URL(details.url);
            const local = url.origin === base;
            const mapped = exact.find((item) => item.origin === url.origin && item.pathname === url.pathname);
            globalThis.releasedUpgradeRequests.push({
              at: Date.now(),
              session: name,
              url: details.url,
              redirected: !!mapped,
              canceled: !local && !mapped,
            });
            callback(
              local ? {} : mapped ? { redirectURL: base + url.pathname + url.search } : { cancel: true },
            );
          });
        }
        return {
          version: app.getVersion(),
          isPackaged: app.isPackaged,
          executable: app.getPath('exe'),
          userData: app.getPath('userData'),
          appPath: app.getAppPath(),
          pid: process.pid,
          hookAt: Date.now(),
          uptime: process.uptime(),
        };
      },
      {
        base,
        exact: [
          ...assets.map((asset) => ({
            origin: 'https://github.com',
            pathname: productionPath(asset.version, asset.name),
          })),
          { origin: 'https://github.com', pathname: releasePath + '.atom' },
          { origin: 'https://github.com', pathname: releasePath + '/latest' },
          { origin: 'https://api.github.com', pathname: releaseApiPath + '/latest' },
          { origin: 'https://api.github.com', pathname: releaseApiPath + '/tags/v' + nextVersion },
        ],
      },
    );
    await writeJSON('02-old-runtime.json', hooked);
    assert.equal(hooked.version, oldVersion);
    assert.equal(hooked.isPackaged, true);
    const oldPid = hooked.pid;
    await record('old-process-identity', { oldPid, launcherPid });
    assert.equal(hooked.userData.toLowerCase(), userData.toLowerCase());
    assert.equal(hooked.executable.toLowerCase(), executable.toLowerCase());
    assert.ok(hooked.uptime < 9, 'Network hooks must precede the released startup check');
    page = await app.firstWindow();
    page.setDefaultTimeout(60000);
    page.on('pageerror', (error) => void record('old-renderer-error', { error: String(error) }));
    page.on('console', (message) => {
      if (message.type() === 'error') void record('old-renderer-console-error', { text: message.text() });
    });
    await page.waitForFunction(() => !!window.desktop);
    await page.evaluate(() => {
      window.releasedUpgradeStates = [];
      window.desktop.onEvent((event) => {
        if (event.type === 'update') window.releasedUpgradeStates.push({ at: Date.now(), ...event.update });
      });
    });
    const bootstrap = await page.evaluate(() => window.desktop.invoke('bootstrap'));
    await writeJSON('02-old-bootstrap.json', {
      update: bootstrap.update,
      storage: bootstrap.storage,
      session: bootstrap.state.sessions.find((item) => item.id === 'released-upgrade-baseline'),
    });
    assert.equal(bootstrap.update.enabled, true);
    assert.equal(bootstrap.update.installation, 'nsis');
    await page.evaluate(() => window.desktop.invoke('checkUpdate'));
    await page.waitForFunction(
      async () => ['ready', 'error'].includes((await window.desktop.invoke('bootstrap')).update.state),
      undefined,
      { timeout: 180000 },
    );
    const readyState = await page.evaluate(() => window.desktop.invoke('bootstrap'));
    await writeJSON('03-ready-update.json', readyState.update);
    assert.equal(readyState.update.state, 'ready', readyState.update.error);
    assert.equal(readyState.update.version, nextVersion);
    // The updater must have cached the exact released installer, not merely emitted a ready event.
    const cachedInstaller = path.join(updaterCache, 'pending', `Pi-Desktop-${nextVersion}-win-x64-setup.exe`);
    const cachedSha = await hashFile(cachedInstaller);
    assert.equal(
      cachedSha,
      assets.find((asset) => asset.version === nextVersion && asset.name.endsWith('setup.exe')).sha256,
    );
    await writeJSON('03-cached-installer.json', {
      path: cachedInstaller,
      sha256: cachedSha,
      size: (await fs.stat(cachedInstaller)).size,
    });
    await page.getByRole('button', { name: `重启以更新到 v${nextVersion}`, exact: true }).click();
    await page.getByRole('button', { name: '立即重启', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, '03-ready-restart.png') });
    const unchanged = await payload('03-before-click');
    assert.equal(unchanged.asarSha256, oldPayload.asarSha256, 'No app payload mutation before update');
    assert.equal(
      unchanged.executableSha256,
      oldPayload.executableSha256,
      'No executable mutation before update',
    );
    await writeJSON('03-old-network.json', await app.evaluate(() => globalThis.releasedUpgradeRequests));
    await writeJSON('03-old-update-states.json', await page.evaluate(() => window.releasedUpgradeStates));
    clickAt = Date.now();
    await record('existing-restart-button-click', {
      oldPid,
      clickAt,
      note: 'No new executable will be launched by this harness after this point',
    });
    const close = app.waitForEvent('close', { timeout: 180000 });
    // A successful click can destroy its own renderer before Playwright receives the response.
    await page
      .getByRole('button', { name: '立即重启', exact: true })
      .click()
      .catch((error) => {
        if (!/closed|destroyed|Target page/i.test(String(error))) throw error;
        void record('click-renderer-closed', { error: String(error) });
      });
    await close;
    app = undefined;
    await record('old-application-closed', { oldPid });
    const observed = await until(
      'automatic released v0.14.19 restart with a visible main window',
      async () => {
        const state = await snapshot('04-latest-observation');
        const next = selectAutomaticMainProcess(state.processes, { oldPid, executable, restartAt: clickAt });
        if (!next) return false;
        const nextPayload = await payload('04-observed-new');
        const bootState = JSON.parse(await fs.readFile(path.join(userData, 'state.json'), 'utf8'));
        return bootState.appVersion === nextVersion &&
          nextPayload.package.version === nextVersion &&
          executableVersionMatches(nextPayload.executableVersion.productVersion, nextVersion) &&
          nextPayload.asarSha256 === releasedPayloads[nextVersion].asarSha256 &&
          nextPayload.mainSourceSha256 === releasedPayloads[nextVersion].mainSourceSha256
          ? {
              process: next,
              payload: nextPayload,
              system: state,
              storeAppVersion: bootState.appVersion,
              observedAt: new Date().toISOString(),
              millisecondsSinceProcessStart: Date.now() - Date.parse(next.created),
            }
          : false;
      },
      180000,
    );
    // Observe continued life, rather than accepting a transient process that exits immediately.
    // Keep this brief. Timestamps below separate first evidence from later observation.
    await pause(2000);
    const stable = await snapshot('05-restarted-stable');
    result.targetObservation = {
      first: observed.observedAt,
      stable: new Date().toISOString(),
      firstMillisecondsSinceProcessStart: observed.millisecondsSinceProcessStart,
      firstStoreAppVersion: observed.storeAppVersion,
      firstEvidenceBeforeTargetStartupCheck: observed.millisecondsSinceProcessStart < 10000,
      stableMillisecondsSinceProcessStart: Date.now() - Date.parse(observed.process.created),
      visibleWindowStableForAtLeastMilliseconds: 2000,
    };
    assert.ok(
      selectAutomaticMainProcess(stable.processes, {
        oldPid,
        executable,
        restartAt: clickAt,
        expectedPid: observed.process.pid,
      }),
      'Automatically restarted target stays open',
    );
    assert.ok(!stable.processes.some((item) => item.pid === oldPid), 'Old main process exited');
    assert.ok(
      stable.shortcuts.some((link) => link.target?.toLowerCase() === executable.toLowerCase()),
      'Production shortcut remains on updated path',
    );
    assert.ok(
      stable.uninstallEntries.some(
        (entry) => entry.PSChildName?.toLowerCase() === guid && entry.DisplayVersion === nextVersion,
      ),
      'Production GUID uninstall entry updated to target version',
    );
    assert.ok(
      stable.identityKeys.some(
        (key) =>
          key.key.toLowerCase() === registry.toLowerCase() &&
          key.installLocation?.toLowerCase() === installDir.toLowerCase(),
      ),
      'Production GUID preserves the installed target path',
    );
    const restored = JSON.parse(await fs.readFile(path.join(userData, 'state.json'), 'utf8'));
    assert.equal(restored.appVersion, nextVersion, 'New app actually opened the default store');
    assert.equal(restored.sessions.find((item) => item.id === 'released-upgrade-baseline')?.draft, draft);
    assert.equal(
      restored.sessions.find((item) => item.id === 'released-upgrade-baseline')?.approvalMode,
      'confirm',
    );
    await writeJSON('05-restored-state-summary.json', {
      appVersion: restored.appVersion,
      session: restored.sessions.find((item) => item.id === 'released-upgrade-baseline'),
      theme: restored.settings.theme,
    });
    // Capture only the automatically restarted Pi window, without attaching or relaunching it.
    await runPS(`
      Add-Type -AssemblyName System.Drawing;
      Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class PiWindowCapture { [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; } [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr d, uint flags); }';
      $rect=New-Object PiWindowCapture+RECT; $handle=[IntPtr]${observed.process.windowHandle};
      if([PiWindowCapture]::GetWindowRect($handle,[ref]$rect)) {
        $bitmap=New-Object System.Drawing.Bitmap ($rect.Right-$rect.Left),($rect.Bottom-$rect.Top);
        $graphics=[System.Drawing.Graphics]::FromImage($bitmap); $dc=$graphics.GetHdc();
        try { $captured=[PiWindowCapture]::PrintWindow($handle,$dc,2) } finally { $graphics.ReleaseHdc($dc) }
        if($captured) { $bitmap.Save(${quotePS(path.join(output, '05-automatic-target-window.png'))},[System.Drawing.Imaging.ImageFormat]::Png) }
        $graphics.Dispose(); $bitmap.Dispose();
      }
    `).catch((error) => record('target-window-capture-error', { error: String(error) }));
    result.baseline = 'passed';
    result.automaticRestart = observed.process;
    result.interpretation =
      'The real released v0.14.18 silent restart updater installed the exact v0.14.19 payload and automatically started its main process/window and default store on a clean hosted Windows runner. Issue #18 is not reproduced; its exact cause remains unknown.';
    console.log(
      'PASS actual released v0.14.18 -> v0.14.19 baseline: automatic main/window restart, exact payload, production identity, shortcuts and stored draft',
    );
  } catch (error) {
    result.baseline = clickAt ? 'failed-after-restart-click' : 'inconclusive-before-restart-click';
    result.error = String(error);
    result.stack = error.stack;
    result.interpretation =
      'Inspect the phase, request/process trace and installed payload evidence. A harness/transport failure is not proof of an updater defect.';
    if (app) {
      await writeJSON(
        'failure-old-network.json',
        await app.evaluate(() => globalThis.releasedUpgradeRequests).catch(() => []),
      );
      await writeJSON(
        'failure-old-lifecycle.json',
        await app.evaluate(() => globalThis.releasedUpgradeLifecycle).catch(() => []),
      );
    }
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(output, 'failure-old-window.png') }).catch(() => {});
    await snapshot('failure-system').catch((snapshotError) =>
      record('failure-snapshot-error', { error: String(snapshotError) }),
    );
    await payload('failure-installed').catch((payloadError) =>
      record('failure-payload-error', { error: String(payloadError) }),
    );
    await captureStoreSummary('failure').catch((storeError) =>
      record('failure-store-summary-error', { error: String(storeError) }),
    );
    throw error;
  } finally {
    // Freeze outcome/evidence before cleanup. Cleanup can never satisfy the restart assertions.
    await writeJSON('result.json', result);
    // Force termination during cleanup avoids triggering a second automatic on-quit install.
    // The measured path above remains the released UI's untouched graceful restart path.
    if (installedByDiagnostic) {
      // Only kill this diagnostic's exact installed executable; never generic Node/Electron processes.
      await runPS(
        `Get-CimInstance Win32_Process -Filter "Name='Pi Desktop.exe'" | Where-Object { $_.ExecutablePath -ieq ${quotePS(executable)} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ).catch((error) => record('cleanup-stop-error', { error: String(error) }));
      const uninstaller = path.join(installDir, 'Uninstall Pi Desktop.exe');
      if (await fs.stat(uninstaller).catch(() => undefined))
        await exec(uninstaller, ['/S'], { windowsHide: true, timeout: 120000 }).catch((error) =>
          record('cleanup-uninstall-error', { error: String(error) }),
        );
      // Files were absent at preflight and belong solely to this ephemeral diagnostic.
      await fs
        .rm(userData, { recursive: true, force: true })
        .catch((error) => record('cleanup-data-error', { error: String(error) }));
      await fs
        .rm(updaterCache, { recursive: true, force: true })
        .catch((error) => record('cleanup-cache-error', { error: String(error) }));
      await snapshot('99-cleanup').catch((error) =>
        record('cleanup-snapshot-error', { error: String(error) }),
      );
    }
    if (observer) {
      await fs.writeFile(path.join(root, 'observer-stop'), 'stop');
      await Promise.race([new Promise((resolve) => observer.once('exit', resolve)), pause(5000)]);
      if (observer.exitCode === null) observer.kill();
    }
    server?.closeAllConnections();
    if (server) await new Promise((resolve) => server.close(resolve));
    await Promise.allSettled([...pendingWrites]);
    console.log(`Historical released diagnostic evidence: ${output}`);
  }
}

if (process.argv.includes('--self-test')) await selfTest();
else await diagnose();
