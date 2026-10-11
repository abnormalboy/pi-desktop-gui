import { app, BrowserWindow, dialog, ipcMain, shell, clipboard, Menu } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Store, readSessionFile } from './store';
import { AgentService, redact } from './agent';
import { Workspace, listDirectory, allFiles, previewFile, safePath } from './workspace';
import { detectEnvironment } from './environment';
import { busy, emptyRuntime, type AppEvent, type ApiMap, type Session } from '../shared/types';

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
async function newSession(projectId: string) {
  store.project(projectId);
  const s: Session = {
    id: randomUUID(),
    projectId,
    title: '新会话',
    draft: '',
    attachments: [],
    updatedAt: Date.now(),
    lastStatus: 'idle',
  };
  store.state.sessions.unshift(s);
  store.state.selectedProjectId = projectId;
  store.state.selectedSessionId = s.id;
  await save();
  return s;
}
async function chooseFile(title: string, filters?: Electron.FileFilter[]) {
  const result = await dialog.showOpenDialog(window!, { title, properties: ['openFile'], filters });
  return result.canceled ? null : result.filePaths[0];
}
let diagnosticPreview = '';
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
      store.state.selectedProjectId = store.state.projects[0]?.id;
      store.state.selectedSessionId = store.state.sessions.find(
        (s) => s.projectId === store.state.selectedProjectId,
      )?.id;
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
    text(id, 100);
    return newSession(id);
  },
  importSession: async (projectId) => {
    text(projectId, 100);
    const p = store.project(projectId);
    const file = await chooseFile('导入 Pi 会话', [{ name: 'Pi 会话', extensions: ['jsonl'] }]);
    if (!file) return null;
    const data = await readSessionFile(file);
    const cwd = await fs.realpath(data.cwd);
    if (cwd.toLowerCase() !== p.path.toLowerCase())
      throw new Error('会话工作目录与当前项目不一致，请先添加对应项目');
    const existing = store.state.sessions.find((s) => s.file === file);
    if (existing) return existing;
    const s = await newSession(projectId);
    s.file = file;
    s.title = data.name || path.basename(file, '.jsonl');
    await save();
    return s;
  },
  selectSession: async (id) => {
    text(id, 100);
    const s = store.session(id);
    if (service.runtime.connected && !busy(service.runtime.status) && service.runtime.sessionId !== id) {
      await service.connect(id);
    }
    store.state.selectedSessionId = id;
    store.state.selectedProjectId = s.projectId;
    s.unread = false;
    await save();
    return service.history(id);
  },
  renameSession: async (id, name) => {
    text(id, 100);
    text(name, 120);
    if (!name.trim()) return;
    store.session(id).title = name.trim();
    await save();
  },
  saveDraft: async (id, draft, attachments) => {
    text(id, 100);
    text(draft);
    strings(attachments);
    const s = store.session(id);
    s.draft = draft;
    s.attachments = attachments;
    await save();
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
  send: async (id, prompt, attachments, mode) => {
    text(id, 100);
    text(prompt);
    strings(attachments);
    if (mode !== 'steer' && mode !== 'followUp') throw new Error('发送模式无效');
    await service.send(id, prompt, attachments, mode);
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
      workspace = new Workspace(store.dir);
      await workspace.cleanup();
      service = new AgentService(store, workspace, developmentRoot);
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
          return await handlers[method as keyof ApiMap](...args);
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
                label: '新建会话',
                accelerator: 'Ctrl+N',
                click: () => {
                  if (store.state.selectedProjectId) void newSession(store.state.selectedProjectId);
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
