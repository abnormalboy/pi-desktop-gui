import { app, BrowserWindow, dialog, ipcMain, shell, clipboard, Menu } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Store, readSessionFile } from './store';
import { AgentService, redact } from './agent';
import { Workspace, listDirectory, allFiles, previewFile, safePath } from './workspace';
import { detectEnvironment, resolvePi, agentDirectory } from './environment';
import { Configuration } from './configuration';
import { validateImages } from './images';
import { busy, emptyRuntime, type AppEvent, type ApiMap } from '../shared/types';

let window: BrowserWindow | undefined, store: Store, service: AgentService, workspace: Workspace;
let quitting = false;
if (process.env.PI_DESKTOP_DATA_DIR) app.setPath('userData', path.resolve(process.env.PI_DESKTOP_DATA_DIR));
const developmentRoot = app.isPackaged ? undefined : app.getAppPath();
const send = (event: AppEvent) => {
  if (window && !window.isDestroyed()) window.webContents.send('desktop:event', event);
};
const save = async () => {
  await store.save();
  send({ type: 'state', state: store.state });
};
function text(value: unknown, max = 1024 * 1024): asserts value is string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0'))
    throw new Error('输入格式无效');
}
function strings(value: unknown): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length > 1000 ||
    !value.every((v) => typeof v === 'string' && v.length < 4096 && !v.includes('\0'))
  )
    throw new Error('列表格式无效');
}
async function newSession(projectId?: string) {
  const s = store.createSession(projectId);
  await save();
  return s;
}
async function chooseFile(title: string, filters?: Electron.FileFilter[]) {
  const result = await dialog.showOpenDialog(window!, { title, properties: ['openFile'], filters });
  return result.canceled ? null : result.filePaths[0];
}
let diagnosticPreview = '';
const exec = promisify(execFile);
let terminalPid: number | undefined;
let updatingConfiguration = false;
function assertTerminalClosed() {
  if (terminalPid) {
    try {
      process.kill(terminalPid, 0);
    } catch {
      terminalPid = undefined;
      return;
    }
    throw new Error('当前会话已交给 Pi 终端，请关闭该终端后再使用桌面会话');
  }
}
async function exportSession(id: string, format: 'html' | 'jsonl') {
  if (!['html', 'jsonl'].includes(format)) throw new Error('导出格式无效');
  if (busy(service.runtime.status)) throw new Error('请先等待当前任务结束');
  await service.connect(id);
  const chosen = await dialog.showSaveDialog(window!, {
    title: '导出完整会话',
    defaultPath: 'pi-session.' + format,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (chosen.canceled || !chosen.filePath) return null;
  if (format === 'html') await service.exportHtml(id, chosen.filePath);
  else {
    const file = store.session(id).file;
    if (!file) throw new Error('会话尚未产生可导出的内容');
    if (path.resolve(file).toLowerCase() === path.resolve(chosen.filePath).toLowerCase())
      throw new Error('请选择不同于原会话文件的导出位置');
    await fs.copyFile(file, chosen.filePath);
  }
  return chosen.filePath;
}
async function diagnostics() {
  const environment = await detectEnvironment(store.state.settings, developmentRoot);
  diagnosticPreview = redact(
    JSON.stringify(
      {
        appVersion: app.getVersion(),
        platform: process.platform,
        environment,
        runtime: {
          status: service.runtime.status,
          connected: service.runtime.connected,
          error: service.runtime.error,
          diagnostic: service.runtime.diagnostic,
        },
      },
      null,
      2,
    ),
  );
  return diagnosticPreview;
}
async function saveText(title: string, contents: string, defaultName: string) {
  const picked = await dialog.showSaveDialog(window!, {
    title,
    defaultPath: defaultName,
    filters: [{ name: '文本', extensions: ['txt'] }],
  });
  if (picked.canceled || !picked.filePath) return null;
  await fs.writeFile(picked.filePath, contents, 'utf8');
  return picked.filePath;
}
const handlers: Record<keyof ApiMap, (...args: any[]) => any> = {
  bootstrap: async () => ({
    state: store.state,
    runtime: service.runtime,
    environment: await detectEnvironment(store.state.settings, developmentRoot),
    dataDir: store.dir,
  }),
  addProject: async () => {
    const chosen = await dialog.showOpenDialog(window!, {
      title: '添加本地项目',
      properties: ['openDirectory'],
    });
    if (chosen.canceled) return null;
    const folder = await fs.realpath(chosen.filePaths[0]);
    const existing = store.state.projects.find((p) => p.path.toLowerCase() === folder.toLowerCase());
    if (existing) {
      store.state.selectedProjectId = existing.id;
      store.state.selectedSessionId = store.state.sessions.find((s) => s.projectId === existing.id)?.id;
      await save();
      return existing;
    }
    const p = {
      id: randomUUID(),
      name: path.basename(folder),
      path: folder,
      trusted: false,
      createdAt: Date.now(),
    };
    store.state.projects.push(p);
    await newSession(p.id);
    return p;
  },
  renameProject: async (id, name) => {
    text(id, 100);
    text(name, 120);
    if (!name.trim()) return;
    store.project(id).name = name.trim();
    await save();
  },
  removeProject: async (id) => {
    text(id, 100);
    if (busy(service.runtime.status) && store.session(service.runtime.sessionId!).projectId === id)
      throw new Error('请先停止该项目的任务');
    const p = store.project(id);
    const result = await dialog.showMessageBox(window!, {
      type: 'question',
      message: `从列表移除 ${p.name}？`,
      detail: '磁盘项目和 Pi 会话文件将保留。',
      buttons: ['取消', '移除入口'],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response !== 1) return;
    if (store.state.sessions.some((s) => s.id === service.runtime.sessionId && s.projectId === id)) {
      await service.disconnect();
      service.runtime = emptyRuntime();
      service.publish(true);
    }
    store.state.projects = store.state.projects.filter((p) => p.id !== id);
    store.state.sessions = store.state.sessions.filter((s) => s.projectId !== id);
    if (store.state.selectedProjectId === id) {
      const next = store.state.sessions[0] ?? store.createSession();
      store.selectSession(next.id);
    }
    await save();
  },
  trustProject: async (id) => {
    text(id, 100);
    const p = store.project(id);
    if (p.trusted) return;
    const result = await dialog.showMessageBox(window!, {
      type: 'question',
      message: `启用项目 ${p.name}`,
      detail: `Pi 将使用当前用户权限读取、修改文件并执行命令。\n\n${p.path}`,
      buttons: ['取消', '信任并启用'],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response === 1) {
      p.trusted = true;
      await save();
    }
  },
  newSession: async (id) => {
    if (id !== undefined) text(id, 100);
    return newSession(id);
  },
  importSession: async (projectId) => {
    if (projectId !== undefined) text(projectId, 100);
    const p = projectId ? store.project(projectId) : undefined;
    const file = await chooseFile('导入 Pi 会话', [{ name: 'Pi 会话', extensions: ['jsonl'] }]);
    if (!file) return null;
    const data = await readSessionFile(file);
    const cwd = await fs.realpath(data.cwd);
    if (p && cwd.toLowerCase() !== p.path.toLowerCase())
      throw new Error('会话工作目录与当前项目不一致，请先添加对应项目');
    const existing = store.state.sessions.find((s) => s.file === file);
    if (existing) return existing;
    const s = await newSession(projectId);
    if (!p) s.cwd = cwd;
    s.file = file;
    s.title = data.name || path.basename(file, '.jsonl');
    await save();
    return s;
  },
  selectSession: async (id) => {
    text(id, 100);
    const s = store.session(id);
    if (service.runtime.connected && !busy(service.runtime.status) && service.runtime.sessionId !== id) {
      if (!s.projectId || store.project(s.projectId).trusted) await service.connect(id);
      else await service.disconnect();
    }
    store.selectSession(s.id);
    await save();
    return service.history(id);
  },
  renameSession: async (id, name) => {
    text(id, 100);
    text(name, 120);
    if (!name.trim()) return;
    store.session(id).title = name.trim();
    await service.rename(id, name.trim());
    await save();
  },
  saveDraft: async (id, draft, attachments, images) => {
    text(id, 100);
    text(draft);
    strings(attachments);
    const s = store.session(id);
    s.draft = draft;
    s.attachments = attachments;
    if (images !== undefined) {
      validateImages(images);
      s.images = images;
    }
    await save();
  },
  consumeDraft: async (id, expected) => {
    text(id, 100);
    text(expected);
    const s = store.session(id);
    if (s.draft === expected) {
      s.draft = '';
      s.attachments = [];
      s.images = [];
      await save();
    }
  },
  saveView: async (id, scrollTop, expanded) => {
    text(id, 100);
    strings(expanded);
    if (!Number.isFinite(scrollTop)) return;
    const s = store.session(id);
    s.scrollTop = Math.max(0, scrollTop);
    s.expandedTools = expanded.slice(-1000);
    await store.save();
  },
  readHistory: async (id) => {
    text(id, 100);
    return service.history(id);
  },
  detect: () => detectEnvironment(store.state.settings, developmentRoot),
  choosePath: async (kind) => {
    if (kind === 'agent') {
      const p = await dialog.showOpenDialog(window!, {
        title: '选择 Pi 配置目录',
        properties: ['openDirectory'],
      });
      return p.canceled ? null : p.filePaths[0];
    }
    if (!['pi', 'node', 'editor'].includes(kind)) throw new Error('无效路径类型');
    return chooseFile(
      kind === 'pi'
        ? '选择 Pi 入口 cli.js 或可执行文件'
        : kind === 'node'
          ? '选择 node.exe'
          : '选择代码编辑器可执行文件',
    );
  },
  saveSettings: async (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置格式无效');
    const engineKeys = ['piPath', 'nodePath', 'agentDir', 'provider', 'modelId', 'thinking'];
    if (
      Object.keys(value).some(
        (k) =>
          engineKeys.includes(k) && value[k] !== store.state.settings[k as keyof typeof store.state.settings],
      )
    ) {
      if (busy(service.runtime.status)) throw new Error('任务运行时不能更改运行环境或模型');
      await service.disconnect();
    }
    const next = { ...store.state.settings };
    for (const key of [
      'piPath',
      'nodePath',
      'agentDir',
      'editorPath',
      'provider',
      'modelId',
      'thinking',
    ] as const)
      if (key in value) {
        text(value[key], 4096);
        next[key] = value[key];
      }
    if (value.theme !== undefined) {
      if (!['light', 'dark', 'system'].includes(value.theme)) throw new Error('主题无效');
      next.theme = value.theme;
    }
    for (const [key, min, max] of [
      ['fontScale', 1, 2],
      ['sidebarWidth', 180, 360],
      ['inspectorWidth', 300, 720],
    ] as const)
      if (value[key] !== undefined) {
        if (!Number.isFinite(value[key])) throw new Error('尺寸无效');
        next[key] = Math.max(min, Math.min(max, value[key]));
      }
    if (typeof value.onboardingDone === 'boolean') next.onboardingDone = value.onboardingDone;
    store.state.settings = next;
    await save();
  },
  connect: async (id) => {
    text(id, 100);
    await service.connect(id);
  },
  testConnection: async (id) => {
    text(id, 100);
    return service.testConnection(id);
  },
  send: async (id, prompt, attachments, mode, images = []) => {
    text(id, 100);
    text(prompt);
    strings(attachments);
    if (mode !== 'steer' && mode !== 'followUp') throw new Error('发送模式无效');
    validateImages(images);
    await service.send(id, prompt, attachments, mode, images);
  },
  pickImages: async () => {
    const picked = await dialog.showOpenDialog(window!, {
      title: '添加图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    if (picked.canceled) return [];
    if (picked.filePaths.length > 8) throw new Error('最多选择 8 张图片');
    const images = await Promise.all(
      picked.filePaths.map(async (file) => {
        if ((await fs.stat(file)).size > 8 * 1024 * 1024) throw new Error('图片超过 8 MiB');
        const ext = path.extname(file).toLowerCase();
        return {
          id: randomUUID(),
          name: path.basename(file),
          mimeType: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/' + ext.slice(1),
          data: (await fs.readFile(file)).toString('base64'),
        };
      }),
    );
    validateImages(images);
    return images;
  },
  sessionTree: async (id) => {
    text(id, 100);
    return service.tree(id);
  },
  branchSession: async (id, kind, entryId, summarize, instructions) => {
    text(id, 100);
    if (!['fork', 'clone', 'navigate'].includes(kind)) throw new Error('会话操作无效');
    if (kind !== 'clone') text(entryId, 100);
    if (instructions !== undefined) text(instructions);
    await service.branch(id, kind, entryId, summarize === true, instructions);
  },
  compact: async (id, instructions) => {
    text(id, 100);
    text(instructions);
    return service.compact(id, instructions);
  },
  piOption: async (id, key, value) => {
    text(id, 100);
    text(key, 100);
    await service.option(id, key, value);
  },
  exportSession,
  shareSession: async (id) => {
    text(id, 100);
    await service.connect(id);
    const out = path.join(store.dir, 'share-preview.html');
    await service.exportHtml(id, out);
    const result = await dialog.showMessageBox(window!, {
      type: 'question',
      message: '分享完整会话到 GitHub Gist？',
      detail:
        '会上传全部对话、工具输出和附件内容。链接持有者均可访问。请先导出并检查内容；使用本机 gh 登录的账户。',
      buttons: ['取消', '上传并生成分享链接'],
      cancelId: 0,
      defaultId: 0,
    });
    if (result.response !== 1) return null;
    const { stdout } = await exec('gh', ['gist', 'create', out, '--desc', 'Pi Desktop session'], {
      windowsHide: true,
      timeout: 120000,
    });
    const url = stdout
      .trim()
      .split(/\r?\n/)
      .find((s) => /^https:\/\/gist\.github\.com\//.test(s));
    if (!url) throw new Error('Gist 未返回分享地址，请检查 gh 状态');
    clipboard.writeText(url);
    return url;
  },
  reloadPi: async (id) => {
    text(id, 100);
    await service.admin(id, 'reload');
  },
  resources: async (id) => {
    text(id, 100);
    return service.admin(id, 'resources');
  },
  toggleResource: async (id, resource, enabled) => {
    text(id, 100);
    if (typeof enabled !== 'boolean') throw new Error('启用状态无效');
    const catalog = await service.admin(id, 'resources');
    const found = catalog.resources.find((r: any) => r.path === resource?.path && r.kind === resource?.kind);
    if (!found) throw new Error('资源已变化，请刷新列表');
    await service.admin(id, 'toggle_resource', { resource: found, enabled });
  },
  packageAction: async (id, action, source, local) => {
    text(id, 100);
    text(source, 4096);
    if (!['install', 'remove', 'update'].includes(action)) throw new Error('包操作无效');
    if (action !== 'update' && (!source.trim() || source.startsWith('-')))
      throw new Error('请输入有效包来源');
    if (source.startsWith('-')) throw new Error('包来源不能是命令参数');
    const s = store.session(id);
    if (local && (!s.projectId || !store.project(s.projectId).trusted)) throw new Error('请先启用项目');
    await service.disconnect();
    const pi = await resolvePi(store.state.settings, developmentRoot);
    const args = [
      ...pi.spec.args,
      action,
      ...(action === 'update' ? ['--extensions'] : []),
      ...(source ? [source] : []),
      ...(local ? ['--local'] : []),
    ];
    await exec(pi.spec.command, args, {
      cwd: await store.sessionDirectory(id),
      windowsHide: true,
      timeout: 300000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDirectory(store.state.settings), PI_TELEMETRY: '0' },
    });
    await service.connect(id);
  },
  providers: async (id) => {
    text(id, 100);
    return service.admin(id, 'providers');
  },
  login: async (id, provider, type) => {
    text(id, 100);
    text(provider, 200);
    if (!['oauth', 'api_key'].includes(type)) throw new Error('登录方式无效');
    await service.admin(id, 'login', { provider, type });
  },
  logout: async (id, provider) => {
    text(id, 100);
    text(provider, 200);
    await service.admin(id, 'logout', { provider });
  },
  cancelLogin: () => service.cancelLogin(),
  configRead: async (id, kind, local) => {
    text(id, 100);
    return new Configuration(store).read(id, kind, local);
  },
  configSave: async (id, kind, local, document) => {
    text(id, 100);
    text(document?.text);
    text(document?.revision, 100);
    await service.disconnect();
    await new Configuration(store).save(id, kind, local, document);
    await service.connect(id);
  },
  revealSessionDirectory: async (id) => {
    text(id, 100);
    await shell.openPath(await store.sessionDirectory(id));
  },
  openPiTerminal: async (id) => {
    text(id, 100);
    await service.connect(id);
    await service.disconnect();
    const spec = (await resolvePi(store.state.settings, developmentRoot)).spec;
    const quote = (v: string) => "'" + v.replaceAll("'", "''") + "'";
    const s = store.session(id);
    const args = s.file
      ? ['--session', s.file]
      : ['--session-id', s.id, '--session-dir', path.join(store.dir, 'sessions')];
    const script = `Set-Location -LiteralPath ${quote(await store.sessionDirectory(id))}\n$env:PI_CODING_AGENT_DIR=${quote(agentDirectory(store.state.settings))}\n& ${[spec.command, ...spec.args, ...args].map(quote).join(' ')}\n`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const launch = `$p = Start-Process -FilePath powershell.exe -ArgumentList @('-NoLogo','-NoProfile','-EncodedCommand','${encoded}') -WindowStyle Normal -PassThru\n$p.Id`;
    const result = await exec(
      'powershell.exe',
      ['-NoProfile', '-EncodedCommand', Buffer.from(launch, 'utf16le').toString('base64')],
      { windowsHide: true },
    );
    terminalPid = Number(result.stdout.trim());
  },
  editDraft: async (id) => {
    text(id, 100);
    const s = store.session(id);
    const file = path.join(store.dir, 'draft-' + encodeURIComponent(id) + '.txt');
    await fs.writeFile(file, s.draft, 'utf8');
    const editor = store.state.settings.editorPath || 'notepad.exe';
    await new Promise<void>((resolve, reject) => {
      const child = spawn(editor, [file], { windowsHide: false, detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
    const result = await dialog.showMessageBox(window!, {
      type: 'info',
      message: '在外部编辑器中编辑草稿',
      detail: '编辑并保存文件后，点击“导入已保存内容”。',
      buttons: ['取消', '导入已保存内容'],
      defaultId: 1,
      cancelId: 0,
    });
    if (result.response !== 1) return;
    s.draft = await fs.readFile(file, 'utf8');
    await save();
  },
  stop: () => service.stop(),
  clearQueue: () => service.clearQueue(),
  forceStop: async () => {
    const result = await dialog.showMessageBox(window!, {
      type: 'warning',
      message: '强制结束当前 Pi 会话进程？',
      detail: '正在执行的命令将被终止。已写入的项目文件将保留。',
      buttons: ['继续等待', '强制结束'],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response !== 1) return false;
    await service.forceStop();
    return true;
  },
  respond: async (id, values) => {
    text(id, 200);
    if (!values || typeof values !== 'object') throw new Error('回复格式无效');
    if (values.value !== undefined) text(values.value);
    return service.respond(id, {
      value: values.value,
      confirmed: values.confirmed === true,
      cancelled: values.cancelled === true,
    });
  },
  files: async (id, dir) => {
    text(id, 100);
    text(dir, 4096);
    return listDirectory(store.project(id), dir);
  },
  searchFiles: async (id, query) => {
    text(id, 100);
    text(query, 1000);
    return (await allFiles(store.project(id)))
      .filter((p) => p.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 80);
  },
  preview: async (id, relative) => {
    text(id, 100);
    text(relative, 4096);
    return previewFile(store.project(id), relative);
  },
  changes: async (id, mode = 'all') => {
    text(id, 100);
    if (!['all', 'run'].includes(mode)) throw new Error('差异模式无效');
    return workspace.changes(store.project(id), mode);
  },
  diff: async (id, relative, mode) => {
    text(id, 100);
    text(relative, 4096);
    if (!['all', 'run'].includes(mode)) throw new Error('差异模式无效');
    return workspace.diff(store.project(id), relative, mode);
  },
  openFile: async (id, relative) => {
    text(id, 100);
    text(relative, 4096);
    const file = await safePath(store.project(id).path, relative);
    const editor = store.state.settings.editorPath;
    if (editor) {
      if (!path.isAbsolute(editor) || !/\.exe$/i.test(editor)) throw new Error('请选择编辑器的 .exe 文件');
      await new Promise<void>((resolve, reject) => {
        const p = spawn(editor, [file], { windowsHide: true, detached: true, stdio: 'ignore' });
        p.once('error', reject);
        p.once('spawn', () => {
          p.unref();
          resolve();
        });
      });
    } else shell.showItemInFolder(file);
  },
  openLink: async (url) => {
    text(url, 4096);
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('只能打开网页链接');
    await shell.openExternal(parsed.href);
  },
  copy: async (value) => {
    text(value, 10 * 1024 * 1024);
    clipboard.writeText(value);
  },
  exportOutput: () => saveText('保存工具输出', service.output(), 'pi-output.txt'),
  diagnostics: () => diagnostics(),
  exportDiagnostics: async () => {
    if (!diagnosticPreview) throw new Error('请先生成诊断预览');
    return saveText('保存已预览的诊断', diagnosticPreview, 'pi-diagnostics.txt');
  },
  revealData: async () => {
    await shell.openPath(store.dir);
  },
  quit: () => {
    window?.close();
  },
};

async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Pi Desktop',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    backgroundColor: '#f8f9f7',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.once('ready-to-show', () => window?.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  let closing = false;
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    void (async () => {
      try {
        if (busy(service.runtime.status)) {
          const result = await dialog.showMessageBox(window!, {
            type: 'question',
            message: 'Pi 仍在执行任务',
            detail: '停止并退出会清空后续队列，已写入文件将保留。',
            buttons: ['留在窗口', '停止并退出'],
            defaultId: 0,
            cancelId: 0,
          });
          if (result.response !== 1) return;
          try {
            await service.stop();
          } catch {
            await dialog.showMessageBox(window!, {
              type: 'error',
              message: '任务尚未停止，请先使用强制结束。',
            });
            return;
          }
        }
        quitting = true;
        await service.dispose();
        window?.destroy();
        app.quit();
      } finally {
        closing = false;
      }
    })();
  });
  const devUrl = process.env.PI_DESKTOP_DEV_URL;
  if (!app.isPackaged && devUrl === 'http://127.0.0.1:5173') await window.loadURL(devUrl);
  else await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      store = new Store(app.getPath('userData'));
      await store.load();
      if (!store.state.sessions.some((s) => s.id === store.state.selectedSessionId)) {
        const initial = store.state.sessions[0] ?? store.createSession();
        store.selectSession(initial.id);
        await store.save();
      }
      workspace = new Workspace(store.dir);
      await workspace.cleanup();
      service = new AgentService(store, workspace, developmentRoot, path.join(__dirname, 'pi-bridge.mjs'));
      service.on('runtime', (runtime) => send({ type: 'runtime', runtime }));
      service.on('state', (state) => send({ type: 'state', state }));
      ipcMain.handle('desktop:invoke', async (event, method: string, args: unknown[]) => {
        if (
          !window ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error('无效 IPC 来源');
        if (
          !Object.prototype.hasOwnProperty.call(handlers, method) ||
          !Array.isArray(args) ||
          args.length > 6
        )
          throw new Error('无效请求');
        try {
          const engineOperation = [
            'connect',
            'send',
            'selectSession',
            'sessionTree',
            'branchSession',
            'compact',
            'piOption',
            'exportSession',
            'shareSession',
            'reloadPi',
            'resources',
            'toggleResource',
            'packageAction',
            'providers',
            'login',
            'logout',
            'configSave',
            'openPiTerminal',
          ].includes(method);
          if (engineOperation) {
            if (updatingConfiguration) throw new Error('正在更新配置或资源包，请稍候');
            assertTerminalClosed();
          }
          const configOperation = ['configSave', 'packageAction'].includes(method);
          if (configOperation) updatingConfiguration = true;
          try {
            return await handlers[method as keyof ApiMap](...args);
          } finally {
            if (configOperation) updatingConfiguration = false;
          }
        } catch (e) {
          throw new Error(redact(e instanceof Error ? e.message : String(e)));
        }
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: '文件',
            submenu: [
              {
                label: '新建对话',
                accelerator: 'Ctrl+N',
                registerAccelerator: false,
                click: () => {
                  void newSession().catch((error) => dialog.showErrorBox('无法新建对话', String(error)));
                },
              },
              { type: 'separator' },
              { role: 'quit', label: '退出' },
            ],
          },
          {
            label: '编辑',
            submenu: [
              { role: 'undo', label: '撤销' },
              { role: 'redo', label: '重做' },
              { type: 'separator' },
              { role: 'cut', label: '剪切' },
              { role: 'copy', label: '复制' },
              { role: 'paste', label: '粘贴' },
              { role: 'selectAll', label: '全选' },
            ],
          },
          {
            label: '视图',
            submenu: [
              { role: 'resetZoom', label: '重置缩放' },
              { role: 'zoomIn', label: '放大' },
              { role: 'zoomOut', label: '缩小' },
              { role: 'togglefullscreen', label: '全屏' },
            ],
          },
        ]),
      );
      await createWindow();
    })
    .catch((error) => {
      dialog.showErrorBox('Pi Desktop 无法启动', String(error));
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (!quitting && window && !window.isDestroyed()) {
      event.preventDefault();
      window.close();
    }
  });
}
