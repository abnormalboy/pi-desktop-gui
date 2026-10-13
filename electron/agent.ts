import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { PiRpc } from './rpc';
import { agentDirectory, detectEnvironment, resolvePi } from './environment';
import { Store, readSessionFile } from './store';
import { Workspace, attachmentPrompt } from './workspace';
import { Configuration } from './configuration';
import {
  busy,
  emptyRuntime,
  messageText,
  type Runtime,
  type Message,
  type RunStatus,
  type SendMode,
  type Session,
  type Model,
  type ImageAttachment,
  type TreeEntry,
  type MessageAction,
  type RuntimeNotification,
} from '../shared/types';
import { validateImages } from './images';

// Pi model records may contain provider headers. Keep only display metadata in IPC.
const displayModel = (model: any): Model | undefined =>
  model
    ? {
        id: model.id,
        provider: model.provider,
        name: model.name ?? model.id,
        reasoning: model.reasoning,
        contextWindow: model.contextWindow,
        input: model.input,
      }
    : undefined;

export const toolPatch = (result: any): string | undefined => {
  const patch = result?.details?.patch;
  return typeof patch === 'string' && patch ? patch.slice(0, 200000) : undefined;
};
export async function argumentHint(file: string) {
  if (!/\.md$/i.test(file)) return undefined;
  try {
    const handle = await fs.open(file, 'r');
    try {
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const head = buffer.subarray(0, bytesRead).toString('utf8');
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head)?.[1];
      const hint = front && /^argument-hint:\s*(.+)$/m.exec(front)?.[1].trim();
      return hint ? hint.replace(/^(['"])(.*)\1$/, '$2').slice(0, 200) : undefined;
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const redact = (s: string) =>
  s
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[已隐藏]')
    .replace(/\b(sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{15,})\b/g, '[已隐藏]')
    .replace(/((?:api[_-]?key|access_token|refresh_token|authorization)["'\s:=]+)[^\s,"'}]+/gi, '$1[已隐藏]');
export class AgentService extends EventEmitter {
  runtime: Runtime = emptyRuntime();
  private rpc?: PiRpc;
  private publishing?: NodeJS.Timeout;
  private operation = Promise.resolve();
  private stopRequested = false;
  private connecting = false;
  private shutdown = false;
  private fullOutput = '';
  private dialogTimers = new Map<string, NodeJS.Timeout>();
  private probe?: PiRpc;
  private probing = false;
  private stopEpoch = 0;
  private queuedImages: { text: string; images: ImageAttachment[] }[] = [];
  private notificationId = 0;
  constructor(
    readonly store: Store,
    readonly workspace: Workspace,
    private developmentRoot?: string,
    private bridgeSource = path.resolve('dist-electron/pi-bridge.mjs'),
  ) {
    super();
  }
  publish(immediate = false) {
    if (immediate) {
      if (this.publishing) clearTimeout(this.publishing);
      this.publishing = undefined;
      this.emit('runtime', structuredClone(this.runtime));
      return;
    }
    this.publishing ??= setTimeout(() => {
      this.publishing = undefined;
      this.emit('runtime', structuredClone(this.runtime));
    }, 40);
  }
  private save() {
    this.store
      .save()
      .then(() => this.emit('state', this.store.state))
      .catch((e) => {
        this.runtime.error = `本地保存失败：${errorText(e)}`;
        this.publish();
      });
  }
  private status(status: RunStatus) {
    this.runtime.status = status;
    if (this.runtime.sessionId) {
      const s = this.store.session(this.runtime.sessionId);
      s.lastStatus = status;
      s.updatedAt = Date.now();
      if (!busy(status)) s.unread = this.store.state.selectedSessionId !== s.id;
      this.save();
    }
    this.publish(true);
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.operation.then(action, action);
    this.operation = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private diagnostic(s: string) {
    this.runtime.diagnostic.push(redact(s).slice(-4000));
    this.runtime.diagnostic = this.runtime.diagnostic.slice(-100);
    this.publish();
  }
  private notify(text: string, level: RuntimeNotification['level'] = 'info') {
    const r = this.runtime;
    r.notices.push(text);
    r.notifications = [...(r.notifications ?? []), { id: ++this.notificationId, text, level }].slice(-5);
  }
  private clearDialogs() {
    for (const timer of this.dialogTimers.values()) clearTimeout(timer);
    this.dialogTimers.clear();
    this.runtime.dialogs = [];
  }
  private onEvent(record: any) {
    const r = this.runtime;
    switch (record.type) {
      case 'desktop_auth':
        r.auth = record.clear
          ? undefined
          : { message: record.message ?? '', url: record.url, code: record.code };
        break;
      case 'bash_execution_update': {
        const t = r.tools.find((t) => t.id === 'desktop-bash');
        if (t) t.output = (t.output + String(record.delta ?? '')).slice(-100000);
        break;
      }
      case 'agent_start':
        if (!this.stopRequested) this.status('running');
        break;
      case 'message_start':
        r.messages.push(record.message);
        break;
      case 'message_update': {
        let m = r.messages.at(-1);
        if (!m || m.role !== 'assistant') {
          m = { role: 'assistant', content: [], timestamp: Date.now() };
          r.messages.push(m);
        }
        if (typeof m.content === 'string') m.content = [{ type: 'text', text: m.content }];
        const e = record.assistantMessageEvent,
          i = e?.contentIndex ?? 0;
        if (!e) break;
        if (e.type === 'text_start') m.content[i] = { type: 'text', text: '' };
        if (e.type === 'text_delta') {
          m.content[i] ??= { type: 'text', text: '' };
          m.content[i].text = (m.content[i].text ?? '') + (e.delta ?? '');
        }
        if (e.type === 'text_end') m.content[i] = { type: 'text', text: e.content ?? '' };
        if (e.type === 'thinking_start') m.content[i] = { type: 'thinking', thinking: '' };
        if (e.type === 'thinking_delta') {
          m.content[i] ??= { type: 'thinking', thinking: '' };
          m.content[i].thinking = (m.content[i].thinking ?? '') + (e.delta ?? '');
        }
        if (e.type === 'thinking_end') m.content[i] = { type: 'thinking', thinking: e.content ?? '' };
        if (e.type === 'toolcall_start')
          m.content[i] = { type: 'toolCall', id: e.id, name: e.toolName, arguments: {}, partialJson: '' };
        if (e.type === 'toolcall_delta' && m.content[i]?.type === 'toolCall')
          m.content[i].partialJson = (String(m.content[i].partialJson ?? '') + (e.delta ?? '')).slice(
            -200000,
          );
        if (e.type === 'toolcall_end') m.content[i] = e.toolCall;
        break;
      }
      case 'message_end': {
        const last = r.messages.at(-1);
        if (last && last.role === record.message?.role) r.messages[r.messages.length - 1] = record.message;
        else r.messages.push(record.message);
        break;
      }
      case 'tool_execution_start':
        r.tools.push({
          id: record.toolCallId,
          name: record.toolName,
          args: record.args ?? {},
          status: 'running',
          output: '',
          startedAt: Date.now(),
        });
        break;
      case 'tool_execution_update': {
        const t = r.tools.find((t) => t.id === record.toolCallId);
        if (t)
          t.output = messageText(record.partialResult ?? { content: '' })
            .split('\n')
            .slice(-200)
            .join('\n');
        break;
      }
      case 'tool_execution_end': {
        const output = messageText(record.result ?? { content: '' });
        let t = r.tools.find((t) => t.id === record.toolCallId);
        if (!t) {
          t = {
            id: record.toolCallId,
            name: record.toolName,
            args: {},
            status: 'running',
            output: '',
            startedAt: Date.now(),
          };
          r.tools.push(t);
        }
        t.output = output.split('\n').slice(-200).join('\n');
        t.patch = toolPatch(record.result);
        t.status = record.isError ? 'error' : 'done';
        t.durationMs = record.durationMs ?? Date.now() - t.startedAt;
        this.fullOutput = (this.fullOutput + `\n\n[${t.name}] ${JSON.stringify(t.args)}\n${output}`).slice(
          -10 * 1024 * 1024,
        );
        break;
      }
      case 'queue_update':
        r.steering = record.steering ?? [];
        r.followUp = record.followUp ?? [];
        this.queuedImages = this.queuedImages.filter((q) => [...r.steering, ...r.followUp].includes(q.text));
        break;
      case 'compaction_start':
        if (!this.stopRequested) this.status('compacting');
        break;
      case 'compaction_end':
        if (record.errorMessage) this.notify(`上下文压缩失败：${record.errorMessage}`, 'warning');
        if (!this.stopRequested)
          this.status(record.reason === 'manual' && !record.willRetry ? 'idle' : 'running');
        break;
      case 'auto_retry_start':
        r.notices.push(`正在重试 ${record.attempt}/${record.maxAttempts}：${record.errorMessage ?? ''}`);
        r.retry = {
          attempt: record.attempt,
          maxAttempts: record.maxAttempts,
          delayMs: record.delayMs ?? 0,
          startedAt: Date.now(),
          error: record.errorMessage,
        };
        if (!this.stopRequested) this.status('retrying');
        break;
      case 'auto_retry_end':
        r.retry = undefined;
        if (!record.success) r.error = record.finalError;
        if (!this.stopRequested) this.status('running');
        break;
      case 'agent_settled': {
        r.retry = undefined;
        if (this.stopRequested) break;
        const last = r.messages.findLast((m) => m.role === 'assistant');
        const failed = last?.stopReason === 'error';
        r.error = failed ? last.errorMessage || '模型请求失败' : undefined;
        this.status(record.aborted ? 'stopped' : failed ? 'error' : 'completed');
        for (const t of r.tools)
          if (t.status === 'running') {
            t.status = 'error';
            t.output += '\n执行已结束但未收到工具结果';
          }
        void this.refresh().catch((e) => this.diagnostic(errorText(e)));
        break;
      }
      case 'session_info_changed':
        if (r.sessionId && record.name) {
          this.store.session(r.sessionId).title = String(record.name).slice(0, 120);
          this.save();
        }
        break;
      case 'thinking_level_changed':
        r.thinking = record.level;
        break;
      case 'extension_error':
        this.notify(`扩展错误：${record.error}`, 'error');
        break;
      case 'extension_ui_request':
        this.extension(record);
        break;
      // agent_end is deliberately not a terminal state: recovery and queued work may follow.
    }
    r.notices = r.notices.slice(-20);
    if (r.tools.length > 1000) r.tools = r.tools.slice(-1000);
    this.publish();
  }
  private extension(record: any) {
    const r = this.runtime;
    if (['select', 'confirm', 'input', 'editor'].includes(record.method)) {
      const expiresAt = record.timeout ? Date.now() + record.timeout : undefined;
      r.dialogs.push({ ...record, expiresAt });
      if (!this.stopRequested) this.status('waiting');
      if (record.timeout)
        this.dialogTimers.set(
          record.id,
          setTimeout(() => {
            r.dialogs = r.dialogs.filter((d) => d.id !== record.id);
            this.dialogTimers.delete(record.id);
            if (r.status === 'waiting') this.status(this.connecting ? 'starting' : 'running');
            this.publish(true);
          }, record.timeout),
        );
    } else if (record.method === 'notify')
      this.notify(
        String(record.message ?? ''),
        record.notifyType === 'error' ? 'error' : record.notifyType === 'warning' ? 'warning' : 'info',
      );
    else if (record.method === 'setStatus') {
      if (record.statusText) r.statuses[record.statusKey] = record.statusText;
      else delete r.statuses[record.statusKey];
    } else if (record.method === 'setWidget') {
      if (record.widgetLines) r.widgets[record.widgetKey] = record.widgetLines;
      else delete r.widgets[record.widgetKey];
      (r.widgetPlacements ??= {})[record.widgetKey] = record.widgetPlacement ?? 'aboveEditor';
    } else if (record.method === 'set_editor_text' && r.sessionId) {
      this.store.session(r.sessionId).draft = String(record.text ?? '');
      this.save();
    } else if (record.method === 'setTitle') r.title = String(record.title ?? 'Pi Desktop');
    else this.notify(`扩展界面能力 ${record.method} 暂不支持，请在终端使用该扩展。`, 'warning');
  }
  async respond(id: string, values: { value?: string; confirmed?: boolean; cancelled?: boolean }) {
    const d = this.runtime.dialogs.find((d) => d.id === id);
    if (!d || (d.expiresAt && Date.now() >= d.expiresAt)) throw new Error('这个问题已失效');
    if (d.method === 'select' && !values.cancelled && !d.options?.includes(values.value ?? ''))
      throw new Error('请选择有效选项');
    await this.rpc?.write({ type: 'extension_ui_response', id, ...values });
    const timer = this.dialogTimers.get(id);
    if (timer) clearTimeout(timer);
    this.dialogTimers.delete(id);
    this.runtime.dialogs = this.runtime.dialogs.filter((d) => d.id !== id);
    if (this.runtime.status === 'waiting' && !this.runtime.dialogs.length)
      this.status(this.connecting ? 'starting' : 'running');
    this.publish(true);
  }
  private async refresh() {
    const rpc = this.rpc;
    if (!rpc || rpc.closed) return;
    const state = await rpc.request('get_state');
    if (this.rpc !== rpc) return;
    this.runtime.model = displayModel(state.model);
    this.runtime.thinking = state.thinkingLevel;
    this.runtime.autoCompaction = state.autoCompactionEnabled;
    this.runtime.steeringMode = state.steeringMode;
    this.runtime.followUpMode = state.followUpMode;
    if (this.runtime.sessionId && state.sessionFile) {
      this.store.session(this.runtime.sessionId).file = state.sessionFile;
      this.save();
    }
    if (!busy(this.runtime.status)) {
      const messages = await rpc.request('get_messages');
      if (this.rpc === rpc) this.runtime.messages = messages.messages ?? [];
      try {
        const stats = await rpc.request('get_session_stats');
        if (this.rpc === rpc)
          this.runtime.stats = {
            tokens: stats.tokens?.total ?? stats.totalTokens,
            cost: stats.cost ?? stats.totalCost,
            contextPercent: stats.contextUsage?.percent,
            contextTokens: stats.contextUsage?.tokens,
            contextWindow: stats.contextUsage?.contextWindow,
          };
      } catch {}
    }
    this.publish();
  }
  connect(sessionId: string) {
    return this.exclusive(() => this.ensureConnected(sessionId));
  }
  private async ensureConnected(sessionId: string) {
    if (this.probing) throw new Error('正在测试模型连接，请稍候');
    const session = this.store.session(sessionId),
      project = session.projectId ? this.store.project(session.projectId) : undefined;
    const resuming = Boolean(session.file);
    if (project && !project.trusted) throw new Error('请先确认此项目可以由 Pi 读取、修改和执行命令');
    if (busy(this.runtime.status) && this.runtime.sessionId !== sessionId)
      throw new Error('另一个会话正在运行，请先停止或等待完成');
    if (this.rpc && !this.rpc.closed && this.runtime.sessionId === sessionId) return;
    if (this.rpc && !this.rpc.closed) {
      const result = session.file
        ? await this.rpc.request('switch_session', { sessionPath: session.file }, 120000)
        : await this.rpc.request('new_session', {}, 120000);
      if (result?.cancelled) throw new Error('Pi 扩展取消了会话切换，原会话保持不变');
      const old = this.rpc;
      this.rpc = undefined;
      await old.close();
    }
    this.clearDialogs();
    this.runtime = { ...emptyRuntime(), sessionId };
    this.queuedImages = [];
    this.stopRequested = false;
    this.connecting = true;
    this.fullOutput = '';
    this.status('starting');
    try {
      const environment = await detectEnvironment(this.store.state.settings, this.developmentRoot);
      if (!environment.supported) throw new Error(environment.errors.join('\n'));
      const resolved = await resolvePi(this.store.state.settings, this.developmentRoot);
      if (this.stopRequested) throw new Error('启动已取消');
      const rpc = new PiRpc();
      this.rpc = rpc;
      rpc.on('event', (e) => {
        if (this.rpc === rpc) this.onEvent(e);
      });
      rpc.on('diagnostic', (s) => {
        if (this.rpc === rpc) this.diagnostic(s);
      });
      rpc.on('protocolError', (e) => {
        if (this.rpc === rpc) {
          this.runtime.error = errorText(e);
          this.status('error');
          void rpc.killTree().catch(() => {});
        }
      });
      rpc.on('fault', (e) => {
        if (this.rpc === rpc) {
          this.runtime.error = errorText(e);
          this.runtime.connected = false;
          this.status('error');
        }
      });
      rpc.on('exit', () => {
        if (this.rpc !== rpc || this.shutdown) return;
        this.runtime.connected = false;
        this.clearDialogs();
        if (busy(this.runtime.status)) {
          this.runtime.error = 'Pi 进程已退出，历史保留，可重新连接。';
          this.status(this.stopRequested ? 'stopped' : 'interrupted');
        } else this.publish(true);
      });
      const args = [
        '--mode',
        'rpc',
        '--name',
        session.title,
        '--session-dir',
        path.join(this.store.dir, 'sessions'),
      ];
      if (session.file) args.push('--session', session.file);
      else args.push('--session-id', session.id);
      const bridge = path.join(this.store.dir, 'desktop-bridge.mjs');
      await fs.copyFile(this.bridgeSource, bridge);
      args.push('--extension', bridge);
      // Project trust is answered in Pi's own dialog; no implicit --approve flag.
      const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
      const shellEnv: NodeJS.ProcessEnv = {
        PI_CODING_AGENT_DIR: agentDirectory(this.store.state.settings),
        PI_TELEMETRY: '0',
      };
      // Pi searches PATH after conventional Git locations. Prefer the Git Bash we detected,
      // including installations on another drive, over Windows' legacy WSL bash launcher.
      if (environment.bash)
        shellEnv[pathKey] = path.dirname(environment.bash) + path.delimiter + (process.env[pathKey] ?? '');
      rpc.start(resolved.spec, await this.store.sessionDirectory(sessionId), args, shellEnv);
      this.runtime.cwd = await this.store.sessionDirectory(sessionId);
      const state = await rpc.request('get_state', {}, 120000);
      if (this.stopRequested) throw new Error('启动已取消');
      if (state.sessionFile) session.file = state.sessionFile;
      this.runtime.model = displayModel(state.model);
      this.runtime.thinking = state.thinkingLevel;
      this.runtime.messages = (await rpc.request('get_messages')).messages ?? [];
      const calls = new Map(
        this.runtime.messages
          .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
          .filter((b) => b.type === 'toolCall')
          .map((b) => [b.id, b]),
      );
      this.runtime.tools = this.runtime.messages
        .filter((m) => m.role === 'toolResult')
        .slice(-1000)
        .map((m) => ({
          id: m.toolCallId ?? '',
          name: m.toolName ?? 'tool',
          args: calls.get(m.toolCallId)?.arguments ?? {},
          status: m.isError ? 'error' : 'done',
          output: messageText(m).split('\n').slice(-200).join('\n'),
          startedAt: m.timestamp ?? 0,
          durationMs: typeof m.durationMs === 'number' ? m.durationMs : undefined,
          patch: toolPatch(m),
        }));
      this.fullOutput = this.runtime.messages
        .filter((m) => m.role === 'toolResult')
        .map((m) => `[${m.toolName ?? 'tool'}]\n${messageText(m)}`)
        .join('\n\n')
        .slice(-10 * 1024 * 1024);
      this.runtime.models = ((await rpc.request('get_available_models')).models ?? [])
        .map(displayModel)
        .filter(Boolean);
      const settings = this.store.state.settings;
      const wanted =
        session.model ?? (resuming ? undefined : { provider: settings.provider, id: settings.modelId });
      if (
        wanted?.provider &&
        wanted.id &&
        this.runtime.models.some((m) => m.provider === wanted.provider && m.id === wanted.id)
      ) {
        this.runtime.model = displayModel(
          await rpc.request('set_model', { provider: wanted.provider, modelId: wanted.id }),
        );
      }
      await this.loadThinkingLevels(rpc);
      const currentState = await rpc.request('get_state');
      this.runtime.model = displayModel(currentState.model);
      this.runtime.thinking = currentState.thinkingLevel;
      // New sessions use Pi's effective default (including project overrides).
      // Only an existing session's own choice should override it.
      const thinking = session.thinking;
      if (thinking && thinking !== this.runtime.thinking && this.runtime.thinkingLevels.includes(thinking)) {
        await rpc.request('set_thinking_level', { level: thinking });
        this.runtime.thinking = thinking;
      }
      this.runtime.connected = true;
      this.status('idle');
      await this.refreshCapabilities();
      session.model = this.runtime.model
        ? { provider: this.runtime.model.provider, id: this.runtime.model.id }
        : undefined;
      session.thinking = this.runtime.thinking;
      this.save();
    } catch (e) {
      this.runtime.error = errorText(e);
      this.status(this.stopRequested ? 'stopped' : 'error');
      const rpc = this.rpc;
      this.rpc = undefined;
      await rpc?.close();
      throw e;
    } finally {
      this.connecting = false;
    }
  }
  send(id: string, text: string, attachments: string[], mode: SendMode, images: ImageAttachment[] = []) {
    const epoch = this.stopEpoch;
    return this.exclusive(async () => {
      if (epoch !== this.stopEpoch) throw new Error('任务已取消，内容保留在草稿中');
      if (this.probing) throw new Error('正在测试模型连接，请稍候');
      validateImages(images);
      if (!text.trim() && !images.length) throw new Error('请输入任务内容或添加图片');
      const session = this.store.session(id),
        project = session.projectId ? this.store.project(session.projectId) : undefined;
      if (busy(this.runtime.status) && this.runtime.sessionId !== id)
        throw new Error('已有会话运行中，请先等待完成或停止');
      if (this.runtime.status === 'stopping') throw new Error('正在停止，请稍候');
      if (!project && attachments.length) throw new Error('引用本地文件需要在项目会话中进行');
      if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw new Error('消息超过 1 MiB，请缩短后发送');
      const prompt = project ? await attachmentPrompt(project, text, attachments) : text;
      await this.ensureConnected(id);
      const shellCommand = /^!!?\S/.test(text);
      if (!this.runtime.model && !text.startsWith('/') && !shellCommand)
        throw new Error('请选择一个可用模型');
      if (images.length && !this.runtime.model?.input?.includes('image'))
        throw new Error('当前模型未声明图片能力，请切换到支持图片的模型');
      const isActive = busy(this.runtime.status);
      if (isActive && images.length)
        validateImages([...this.queuedImages.flatMap((q) => q.images), ...images]);
      if (shellCommand && isActive) throw new Error('请等待当前任务完成后再执行命令');
      if (!isActive) {
        this.stopRequested = false;
        this.runtime.error = undefined;
        this.runtime.tools = [];
        this.runtime.startedAt = Date.now();
        this.status('starting');
        if (project) await this.workspace.capture(project);
      }
      if (this.stopRequested || epoch !== this.stopEpoch) throw new Error('任务已取消，内容保留在草稿中');
      try {
        let result: any;
        if (shellCommand) {
          if (images.length || attachments.length) throw new Error('终端命令不能附带附件');
          this.status('running');
          this.runtime.tools.push({
            id: 'desktop-bash',
            name: 'bash',
            args: { command: text.replace(/^!!?/, '') },
            status: 'running',
            output: '',
            startedAt: Date.now(),
          });
          const output = await this.rpc!.request(
            'bash',
            { command: text.replace(/^!!?/, ''), excludeFromContext: text.startsWith('!!') },
            3600000,
          );
          const tool = this.runtime.tools.find((t) => t.id === 'desktop-bash')!;
          tool.output = output.output;
          tool.status = output.exitCode === 0 ? 'done' : 'error';
          tool.durationMs = Date.now() - tool.startedAt;
          this.status(output.cancelled ? 'stopped' : output.exitCode === 0 ? 'completed' : 'error');
          await this.refresh();
        } else
          result = await this.rpc!.request(
            'prompt',
            {
              message: prompt,
              ...(isActive ? { streamingBehavior: mode } : {}),
              ...(images.length
                ? { images: images.map(({ data, mimeType }) => ({ type: 'image', data, mimeType })) }
                : {}),
            },
            text.startsWith('/') ? 600000 : 30000,
          );
        if (result?.disposition === 'queued' && images.length)
          this.queuedImages.push({ text: prompt, images: structuredClone(images) });
        if (result?.disposition === 'handled' && !this.stopRequested) {
          const state = await this.rpc!.request('get_state');
          if (!state.isStreaming && !state.isCompacting && !state.pendingMessageCount) this.status('idle');
        }
        if (session.draft === text) {
          session.draft = '';
          session.attachments = [];
          session.images = [];
        }
        if (session.title === '新会话' || session.title === '新对话') {
          session.title = text.trim().split('\n')[0].slice(0, 28) || images[0]?.name || '图片对话';
          void this.rpc!.request('set_session_name', { name: session.title }).catch(() => {});
        }
        session.updatedAt = Date.now();
        this.save();
      } catch (e) {
        this.runtime.error = errorText(e);
        if (!isActive && !this.stopRequested) this.status('error');
        throw e;
      }
    });
  }
  private async loadThinkingLevels(rpc: PiRpc) {
    const levels = await rpc.request('get_available_thinking_levels');
    this.runtime.thinkingLevels =
      levels.levels ?? levels.thinkingLevels ?? (Array.isArray(levels) ? levels : []);
  }
  setModel(id: string, provider: string, modelId: string) {
    return this.exclusive(async () => {
      const session = this.store.session(id);
      if (this.runtime.sessionId === id && busy(this.runtime.status))
        throw new Error('执行中不能切换模型，请等待本轮结束');
      const rpc = this.rpc;
      if (rpc && !rpc.closed && this.runtime.sessionId === id) {
        if (!this.runtime.models.some((m) => m.provider === provider && m.id === modelId))
          throw new Error('该模型当前不可用，请刷新模型列表');
        this.runtime.model = displayModel(await rpc.request('set_model', { provider, modelId }));
        await this.loadThinkingLevels(rpc);
        const state = await rpc.request('get_state');
        this.runtime.thinking = state.thinkingLevel;
        session.thinking = state.thinkingLevel;
      }
      session.model = { provider, id: modelId };
      this.store.state.settings.provider = provider;
      this.store.state.settings.modelId = modelId;
      this.save();
      this.publish(true);
    });
  }
  setThinking(id: string, level: string) {
    return this.exclusive(async () => {
      const session = this.store.session(id);
      if (this.runtime.sessionId === id && busy(this.runtime.status))
        throw new Error('执行中不能切换推理级别，请等待本轮结束');
      const rpc = this.rpc;
      if (rpc && !rpc.closed && this.runtime.sessionId === id) {
        if (!this.runtime.thinkingLevels.includes(level)) throw new Error('当前模型不支持这个推理级别');
        await rpc.request('set_thinking_level', { level });
        this.runtime.thinking = level;
      }
      const config = new Configuration(this.store);
      const document = await config.read(id, 'settings', false);
      const values = JSON.parse(document.text);
      values.defaultThinkingLevel = level;
      await config.save(id, 'settings', false, { ...document, text: JSON.stringify(values) });
      session.thinking = level;
      this.store.state.settings.thinking = level;
      this.save();
      this.publish(true);
    });
  }
  async abortRetry() {
    if (!this.rpc || this.rpc.closed || !this.runtime.retry) return;
    await this.rpc.request('abort_retry');
    this.runtime.retry = undefined;
    this.publish(true);
  }
  private async entryFor(rpc: PiRpc, role: string, timestamp: number) {
    const { entries = [], leafId } = await rpc.request('get_entries');
    const byId = new Map<string, any>(entries.map((e: any) => [e.id, e]));
    const branch: any[] = [];
    for (let e = byId.get(leafId); e; e = e.parentId ? byId.get(e.parentId) : undefined) branch.push(e);
    const index = branch.findIndex(
      (e) => e.type === 'message' && e.message?.role === role && e.message?.timestamp === timestamp,
    );
    if (index < 0) throw new Error('这条消息不在当前分支上，请在会话树中切换后再试');
    const userIndex =
      role === 'user' ? index : branch.findIndex((e, i) => i > index && e.message?.role === 'user');
    if (userIndex < 0) throw new Error('找不到这条回复对应的提问');
    return branch[userIndex];
  }
  async messageAction(id: string, action: MessageAction, role: string, timestamp: number) {
    if (action === 'fork') {
      const entry = await this.idleTask(id, (rpc) => this.entryFor(rpc, role, timestamp));
      return this.branch(id, 'fork', entry.id);
    }
    const restored = await this.idleTask(id, async (rpc) => {
      const entry = await this.entryFor(rpc, role, timestamp);
      const content = entry.message.content;
      const text = typeof content === 'string' ? content : messageText(entry.message);
      const images: ImageAttachment[] = (Array.isArray(content) ? content : [])
        .filter((b: any) => b.type === 'image' && typeof b.data === 'string')
        .map((b: any, i: number) => ({
          id: randomUUID(),
          name: `历史图片 ${i + 1}`,
          data: b.data,
          mimeType: b.mimeType,
        }));
      const result = await rpc.bridge('navigate', { entryId: entry.id, summarize: false, instructions: '' });
      if (result?.cancelled) throw new Error('Pi 扩展取消了这次操作');
      return { text, images };
    });
    const session = this.store.session(id);
    if (action === 'regenerate') return this.send(id, restored.text, [], 'steer', restored.images);
    const cut = restored.text.indexOf('\n\n<project_file path=');
    session.draft = cut >= 0 ? restored.text.slice(0, cut) : restored.text;
    session.attachments = [];
    session.images = restored.images;
    await this.store.save();
    this.emit('state', this.store.state);
  }
  async clearQueue() {
    if (!this.rpc || this.rpc.closed) return;
    const queuedImages = [...this.queuedImages];
    const result = await this.rpc.request('clear_queue');
    const returned = [...(result?.steering ?? []), ...(result?.followUp ?? [])];
    if (returned.length && this.runtime.sessionId) {
      const s = this.store.session(this.runtime.sessionId);
      const selectedId = this.store.state.selectedSessionId;
      const restored = [...returned];
      for (const q of queuedImages.filter((q) => returned.includes(q.text))) {
        try {
          validateImages([...(s.images ?? []), ...q.images]);
          s.images = [...(s.images ?? []), ...q.images];
        } catch {
          const recovered = this.store.createSession(s.projectId);
          if (!s.projectId) recovered.cwd = await this.store.sessionDirectory(s.id);
          recovered.title = '已恢复的图片消息';
          recovered.draft = q.text;
          recovered.images = q.images;
          const index = restored.indexOf(q.text);
          if (index >= 0) restored.splice(index, 1);
          this.runtime.notices.push('未发送的图片已保存在“已恢复的图片消息”中。');
        }
      }
      if (selectedId) this.store.selectSession(selectedId);
      s.draft = [s.draft, ...restored].filter(Boolean).join('\n\n');
      this.save();
    }
    this.runtime.steering = [];
    this.runtime.followUp = [];
    this.queuedImages = [];
    this.publish(true);
  }
  private async refreshCapabilities() {
    if (!this.rpc || this.rpc.closed) return;
    this.runtime.commands = await Promise.all(
      ((await this.rpc.request('get_commands')).commands ?? [])
        .filter((c: any) => c.name !== 'desktop-internal')
        .map(async (c: any) =>
          c.source === 'prompt' && c.sourceInfo?.path
            ? { ...c, argumentHint: await argumentHint(c.sourceInfo.path) }
            : c,
        ),
    );
    this.runtime.models = ((await this.rpc.request('get_available_models')).models ?? [])
      .map(displayModel)
      .filter(Boolean);
    this.runtime.autoRetry = (await this.rpc.bridge('options')).autoRetry;
    await this.refresh();
  }
  private idleTask<T>(id: string, action: (rpc: PiRpc) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      await this.ensureConnected(id);
      if (busy(this.runtime.status)) throw new Error('请先等待当前任务结束');
      this.stopRequested = false;
      this.runtime.error = undefined;
      this.status('starting');
      try {
        return await action(this.rpc!);
      } finally {
        this.clearDialogs();
        if (!this.stopRequested && this.runtime.connected) {
          this.status('idle');
          await this.refresh();
        }
      }
    });
  }
  tree(id: string): Promise<TreeEntry[]> {
    return this.idleTask(id, (rpc) => rpc.bridge('tree'));
  }
  branch(
    id: string,
    kind: 'fork' | 'clone' | 'navigate',
    entryId?: string,
    summarize = false,
    instructions = '',
  ) {
    return this.idleTask(id, async (rpc) => {
      const old = this.store.session(id);
      const cwd = await this.store.sessionDirectory(id);
      const forkMessage =
        kind === 'fork'
          ? (await rpc.request('get_entries')).entries?.find((e: any) => e.id === entryId)?.message
          : undefined;
      const result =
        kind === 'navigate'
          ? await rpc.bridge('navigate', { entryId, summarize, instructions })
          : await rpc.request(kind, kind === 'fork' ? { entryId } : {}, 600000);
      if (result?.cancelled) throw new Error('Pi 扩展取消了这次操作');
      if (kind !== 'navigate') {
        const state = await rpc.request('get_state');
        const next = this.store.createSession(old.projectId);
        next.file = state.sessionFile;
        if (!next.projectId) next.cwd = cwd;
        next.title = old.title + (kind === 'fork' ? ' · 分支' : ' · 副本');
        next.draft = result?.text ?? '';
        next.images = (Array.isArray(forkMessage?.content) ? forkMessage.content : [])
          .filter((b: any) => b.type === 'image')
          .map((b: any, i: number) => ({
            id: randomUUID(),
            name: `历史图片 ${i + 1}`,
            data: b.data,
            mimeType: b.mimeType,
          }));
        this.runtime.sessionId = next.id;
        await rpc.request('set_session_name', { name: next.title });
        await this.store.save();
        this.emit('state', this.store.state);
      }
      this.runtime.tools = [];
    });
  }
  compact(id: string, customInstructions: string) {
    return this.idleTask(id, async (rpc) => {
      this.status('compacting');
      return rpc.request('compact', { customInstructions }, 600000);
    });
  }
  option(id: string, key: string, value: boolean | string) {
    const command = {
      autoCompaction: 'set_auto_compaction',
      autoRetry: 'set_auto_retry',
      steeringMode: 'set_steering_mode',
      followUpMode: 'set_follow_up_mode',
    }[key];
    if (!command) throw new Error('未知 Pi 设置');
    if (key.endsWith('Mode') ? !['all', 'one-at-a-time'].includes(String(value)) : typeof value !== 'boolean')
      throw new Error('设置值无效');
    return this.idleTask(id, async (rpc) => {
      await rpc.request(command, key.endsWith('Mode') ? { mode: value } : { enabled: value });
      await this.refreshCapabilities();
    });
  }
  admin(id: string, method: string, params: unknown = {}) {
    return this.idleTask(id, async (rpc) => {
      const result = await rpc.bridge(method, params);
      if (['login', 'logout', 'reload', 'toggle_resource'].includes(method)) await this.refreshCapabilities();
      return result;
    });
  }
  async cancelLogin() {
    await this.rpc?.bridge('cancel_auth');
  }
  exportHtml(id: string, outputPath: string) {
    return this.idleTask(id, (rpc) => rpc.request('export_html', { outputPath }, 120000));
  }
  async rename(id: string, name: string) {
    if (this.runtime.sessionId === id && this.runtime.connected)
      await this.rpc!.request('set_session_name', { name });
  }
  async stop() {
    if (!busy(this.runtime.status)) return;
    this.stopEpoch++;
    this.stopRequested = true;
    this.runtime.stopStartedAt = Date.now();
    this.status('stopping');
    if (!this.rpc || this.rpc.closed) {
      this.status('stopped');
      return;
    }
    try {
      if (this.runtime.auth) await this.cancelLogin();
      for (const dialog of [...this.runtime.dialogs])
        await this.respond(dialog.id, { cancelled: true }).catch(() => {});
      await this.clearQueue();
      await this.rpc.request('abort_bash');
      await this.rpc.request('abort', {}, 60000);
      if (this.rpc && !this.rpc.closed) {
        const state = await this.rpc.request('get_state');
        if (state.isStreaming || state.isCompacting || state.pendingMessageCount)
          throw new Error('Pi 尚未停止，请重试或强制结束');
      }
      this.clearDialogs();
      this.status('stopped');
      await this.refresh();
    } catch (e) {
      this.runtime.error = `停止未完成：${errorText(e)}`;
      this.publish(true);
      throw e;
    }
  }
  async forceStop() {
    this.stopEpoch++;
    this.stopRequested = true;
    await this.rpc?.killTree();
    this.runtime.connected = false;
    this.clearDialogs();
    this.status('stopped');
  }
  async disconnect() {
    if (busy(this.runtime.status) || this.probing) throw new Error('请先等待当前任务或连接测试结束');
    const rpc = this.rpc;
    this.rpc = undefined;
    await rpc?.close();
    this.runtime.connected = false;
    this.publish(true);
  }
  async testConnection(sessionId: string) {
    if (busy(this.runtime.status) || this.probing) throw new Error('请先等待当前任务结束');
    const session = this.store.session(sessionId);
    const cwd = await this.store.sessionDirectory(session.id);
    const settings = this.store.state.settings;
    const model = this.runtime.model;
    const provider = settings.provider || model?.provider,
      modelId = settings.modelId || model?.id;
    if (!provider || !modelId) throw new Error('请先连接 Pi 并选择模型');
    this.probing = true;
    const probe = new PiRpc();
    this.probe = probe;
    const started = Date.now();
    let answer = '';
    let failure = '';
    let timer: NodeJS.Timeout | undefined;
    try {
      const resolved = await resolvePi(settings, this.developmentRoot);
      const settled = new Promise<void>((resolve, reject) => {
        probe.on('event', (e) => {
          if (e.type === 'message_end' && e.message?.role === 'assistant') {
            answer = messageText(e.message);
            if (e.message.stopReason === 'error') failure = e.message.errorMessage ?? '模型连接失败';
          }
          if (e.type === 'agent_settled') failure ? reject(new Error(failure)) : resolve();
        });
        probe.on('fault', reject);
        probe.on('exit', () => reject(new Error('连接测试进程已退出')));
      });
      settled.catch(() => {});
      probe.start(
        resolved.spec,
        cwd,
        [
          '--mode',
          'rpc',
          '--no-session',
          '--no-tools',
          '--no-extensions',
          '--no-mcp',
          '--no-skills',
          '--no-context-files',
          '--no-prompt-templates',
          '--no-approve',
          '--provider',
          provider,
          '--model',
          modelId,
        ],
        { PI_CODING_AGENT_DIR: agentDirectory(settings), PI_TELEMETRY: '0' },
      );
      timer = setTimeout(() => {
        failure = '模型连接测试超过 45 秒';
        void probe.killTree().catch(() => {});
      }, 45000);
      await probe.request('get_state');
      await probe.request('prompt', { message: 'Reply with only OK.' });
      await settled;
      return { elapsed: Date.now() - started, text: answer };
    } finally {
      if (timer) clearTimeout(timer);
      await probe.close();
      this.probe = undefined;
      this.probing = false;
    }
  }
  output() {
    return (
      'Pi Desktop 导出：当前会话已接收的工具结果（最多最近 10 MiB）。Pi 自身可能截断长输出，完整日志位置以工具结果为准。\n\n' +
      (this.fullOutput || this.runtime.tools.map((t) => `[${t.name}]\n${t.output}`).join('\n\n'))
    );
  }
  async history(id: string): Promise<Message[]> {
    const s = this.store.session(id);
    if (this.runtime.sessionId === id && this.runtime.messages.length) return this.runtime.messages;
    if (!s.file) return [];
    try {
      return (await readSessionFile(s.file)).messages;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }
  async dispose() {
    this.shutdown = true;
    this.clearDialogs();
    if (this.publishing) clearTimeout(this.publishing);
    await this.probe?.close();
    if (busy(this.runtime.status)) {
      await this.stop().catch(() => {});
    }
    await this.rpc?.close();
    await this.store.flush();
  }
}
