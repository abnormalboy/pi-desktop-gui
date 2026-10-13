import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppState, Message, Session, Settings } from '../shared/types';

export const defaultSettings: Settings = {
  piPath: '',
  nodePath: '',
  agentDir: '',
  editorPath: '',
  provider: '',
  modelId: '',
  thinking: '',
  theme: 'system',
  fontScale: 1,
  sidebarWidth: 240,
  inspectorWidth: 380,
  onboardingDone: false,
  notifyOnFinish: true,
};
export class Store {
  state: AppState = { version: 1, projects: [], sessions: [], settings: { ...defaultSettings } };
  private writing = Promise.resolve();
  constructor(readonly dir: string) {}
  async load() {
    await fs.mkdir(this.dir, { recursive: true });
    try {
      const data = JSON.parse(await fs.readFile(path.join(this.dir, 'state.json'), 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.projects) || !Array.isArray(data.sessions))
        throw new Error('本地索引格式不受支持');
      this.state = { ...data, settings: { ...defaultSettings, ...data.settings } };
      for (const s of this.state.sessions) {
        s.attachments ??= [];
        s.draft ??= '';
        if (['running', 'starting', 'waiting', 'stopping', 'retrying', 'compacting'].includes(s.lastStatus))
          s.lastStatus = 'interrupted';
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(`无法读取本地索引。原文件已保留：${String(error)}`);
    }
  }
  save() {
    const contents = JSON.stringify(this.state, null, 2);
    const write = async () => {
      const temporary = path.join(this.dir, 'state.json.tmp');
      await fs.writeFile(temporary, contents, { mode: 0o600 });
      for (let attempt = 0; ; attempt++) {
        try {
          await fs.rename(temporary, path.join(this.dir, 'state.json'));
          return;
        } catch (e) {
          if (attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        }
      }
    };
    this.writing = this.writing.catch(() => {}).then(write);
    return this.writing;
  }
  flush() {
    return this.writing;
  }
  createSession(projectId?: string) {
    if (projectId !== undefined) this.project(projectId);
    const session: Session = {
      id: randomUUID(),
      projectId,
      title: projectId ? '新会话' : '新对话',
      draft: '',
      attachments: [],
      updatedAt: Date.now(),
      lastStatus: 'idle',
    };
    this.state.sessions.unshift(session);
    this.selectSession(session.id);
    return session;
  }
  selectSession(id: string) {
    const session = this.session(id);
    this.state.selectedSessionId = id;
    this.state.selectedProjectId = session.projectId;
    session.unread = false;
  }
  async sessionDirectory(id: string) {
    const session = this.session(id);
    if (session.projectId) return this.project(session.projectId).path;
    if (session.cwd) return session.cwd;
    const directory = path.join(this.dir, 'chats', 'chat-' + encodeURIComponent(id));
    await fs.mkdir(directory, { recursive: true });
    return directory;
  }
  project(id: string) {
    const p = this.state.projects.find((p) => p.id === id);
    if (!p) throw new Error('项目不存在');
    return p;
  }
  session(id: string) {
    const s = this.state.sessions.find((s) => s.id === id);
    if (!s) throw new Error('会话不存在');
    return s;
  }
}

export async function readSessionFile(
  file: string,
): Promise<{ cwd: string; name?: string; messages: Message[] }> {
  const stat = await fs.stat(file);
  if (stat.size > 64 * 1024 * 1024) throw new Error('会话文件超过 64 MiB，请在 Pi 中压缩或导出后再导入');
  const raw = await fs.readFile(file, 'utf8');
  const entries: any[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      entries.push(JSON.parse(lines[i]));
    } catch {
      if (i < lines.length - 1) throw new Error('会话文件包含损坏的 JSON 记录');
    }
  }
  const header = entries.find((e) => e.type === 'session');
  if (!header || typeof header.cwd !== 'string') throw new Error('不是有效的 Pi 会话文件');
  const byId = new Map(entries.filter((e) => e.id && e.type !== 'session').map((e) => [e.id, e]));
  let cursor = entries.findLast((e) => e.id && e.type !== 'session');
  const branch: any[] = [],
    seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    branch.push(cursor);
    cursor = byId.get(cursor.parentId);
  }
  branch.reverse();
  return {
    cwd: header.cwd,
    name: entries.findLast((e) => e.type === 'session_info')?.name,
    messages: branch.filter((e) => e.type === 'message' && e.message).map((e) => e.message),
  };
}
