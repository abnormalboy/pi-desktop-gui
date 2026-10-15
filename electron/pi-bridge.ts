// Loaded by Pi's extension loader, never by Electron. Responses use RPC UI notifications.
import {
  ModelRuntime,
  SettingsManager,
  DefaultPackageManager,
  getAgentDir,
} from '@earendil-works/pi-coding-agent';
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import fs from 'node:fs/promises';
import path from 'node:path';
import { toggleResourceSetting } from './resources-config';
import { DESKTOP_BRIDGE_COMMAND, DESKTOP_BRIDGE_PROTOCOL } from '../shared/pi-bridge';
import {
  APPROVAL_ALLOW,
  APPROVAL_ALWAYS,
  APPROVAL_DENY,
  APPROVAL_PREFIX,
  alwaysKey,
  decide,
  describe,
  type ApprovalMode,
} from '../shared/approval';

export default function desktopBridge(pi: ExtensionAPI) {
  let authAbort: AbortController | undefined;
  let approvalMode: ApprovalMode =
    (['auto', 'confirm', 'readonly'] as const).find((m) => m === process.env.PI_DESKTOP_APPROVAL) ?? 'auto';
  const alwaysAllowed = new Set<string>();
  pi.on('session_start', (_event, ctx) => {
    alwaysAllowed.clear();
    // Loaded explicitly before project/global extensions; marks the owner of subsequent UI events.
    ctx.ui.notify('__PI_DESKTOP__' + JSON.stringify({ type: 'desktop_session_start' }));
  });
  async function approve(toolName: string, input: unknown, ctx: ExtensionContext) {
    const verdict = decide(approvalMode, toolName);
    if (verdict === 'allow') return;
    if (verdict === 'deny')
      return {
        block: true as const,
        reason: `当前为只读模式，桌面端拒绝了 ${toolName}。请只读取和分析，不要修改文件或执行命令。`,
      };
    const request = describe(toolName, input);
    if (alwaysAllowed.has(alwaysKey(request))) return;
    const choice = await ctx.ui.select(APPROVAL_PREFIX + JSON.stringify(request), [
      APPROVAL_ALLOW,
      APPROVAL_ALWAYS,
      APPROVAL_DENY,
    ]);
    if (choice === APPROVAL_ALLOW) return;
    if (choice === APPROVAL_ALWAYS) {
      alwaysAllowed.add(alwaysKey(request));
      return;
    }
    const reason = choice?.startsWith(APPROVAL_DENY + '：')
      ? choice.slice(APPROVAL_DENY.length + 1).trim()
      : '';
    return {
      block: true as const,
      reason: `用户拒绝了这次 ${toolName} 调用${reason ? '，原因：' + reason : ''}。请按用户意见调整，不要重复同样的操作。`,
    };
  }
  pi.on('tool_call', (event, ctx) => approve(event.toolName, event.input, ctx));
  pi.on('user_bash', async (event, ctx) => {
    const blocked = await approve('bash', { command: event.command }, ctx);
    if (blocked)
      return { result: { output: blocked.reason, exitCode: 1, cancelled: false, truncated: false } };
  });
  async function models(ctx: ExtensionCommandContext) {
    const m = await ModelRuntime.create();
    for (const id of ctx.modelRegistry.getRegisteredProviderIds()) {
      const native = ctx.modelRegistry.getRegisteredNativeProvider(id);
      const config = ctx.modelRegistry.getRegisteredProviderConfig(id);
      if (native) m.registerNativeProvider(native);
      else if (config) m.registerProvider(id, config);
    }
    return m;
  }
  pi.registerCommand(DESKTOP_BRIDGE_COMMAND, {
    description: 'Pi Desktop internal bridge',
    handler: async (encoded, ctx) => {
      const emit = (value: object) => ctx.ui.notify('__PI_DESKTOP__' + JSON.stringify(value));
      let id = '';
      let replied = false;
      try {
        const request = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        id = request.id;
        const p = request.params ?? {};
        let data: unknown;
        switch (request.method) {
          case 'options':
            data = {
              protocolVersion: DESKTOP_BRIDGE_PROTOCOL,
              autoRetry: pi.getSettings().retry?.enabled !== false,
              approvalMode,
            };
            break;
          case 'approval_mode':
            if (!['auto', 'confirm', 'readonly'].includes(p.mode)) throw new Error('审批模式无效');
            approvalMode = p.mode;
            if (p.mode !== 'confirm') alwaysAllowed.clear();
            data = { approvalMode };
            break;
          case 'tree': {
            const active = new Set(ctx.sessionManager.getBranch().map((e) => e.id));
            const rows: unknown[] = [];
            const stack = ctx.sessionManager
              .getTree()
              .reverse()
              .map((node) => ({ node, depth: 0 }));
            while (stack.length) {
              const { node, depth } = stack.pop()!;
              const e: any = node.entry;
              const content = e.message?.content;
              const text =
                typeof content === 'string'
                  ? content
                  : (content ?? [])
                      .filter((b: any) => b.type === 'text')
                      .map((b: any) => b.text)
                      .join('\n');
              rows.push({
                id: e.id,
                parentId: e.parentId,
                type: e.type,
                role: e.message?.role,
                text: (text || e.summary || e.name || e.type).slice(0, 600),
                label: node.label,
                depth,
                active: active.has(e.id),
              });
              stack.push(...[...node.children].reverse().map((node) => ({ node, depth: depth + 1 })));
            }
            data = rows;
            break;
          }
          case 'navigate':
            data = await ctx.navigateTree(p.entryId, {
              summarize: p.summarize,
              customInstructions: p.instructions,
            });
            if (!(data as { cancelled: boolean }).cancelled)
              pi.appendEntry('desktop-navigation', { targetId: p.entryId });
            break;
          case 'set_label': {
            if (typeof p.entryId !== 'string') throw new Error('消息无效');
            const label = typeof p.label === 'string' ? p.label.trim().slice(0, 60) : '';
            pi.setLabel(p.entryId, label || undefined);
            data = { label };
            break;
          }
          case 'reload':
            emit({ type: 'desktop_result', id, data: { reloading: true } });
            replied = true;
            await ctx.reload();
            break;
          case 'providers': {
            const m = await models(ctx);
            data = m.getProviders().map((v) => ({
              id: v.id,
              name: v.name,
              configured: m.hasConfiguredAuth(v.id),
              oauth: !!v.auth.oauth,
              apiKey: !!v.auth.apiKey?.login,
            }));
            break;
          }
          case 'login': {
            if (authAbort) throw new Error('已有登录正在进行');
            authAbort = new AbortController();
            try {
              const m = await models(ctx);
              await m.login(p.provider, p.type, {
                signal: authAbort.signal,
                notify: (e) =>
                  emit({
                    type: 'desktop_auth',
                    ...('url' in e ? { url: e.url } : {}),
                    ...('verificationUri' in e ? { url: e.verificationUri, code: e.userCode } : {}),
                    message:
                      'message' in e
                        ? e.message
                        : 'instructions' in e
                          ? e.instructions
                          : '请在浏览器完成登录',
                  }),
                prompt: async (q) => {
                  const options = { signal: q.signal ?? authAbort?.signal };
                  const value =
                    q.type === 'select'
                      ? await ctx.ui.select(
                          q.message,
                          q.options.map((o) => o.id),
                          options,
                        )
                      : await ctx.ui.input(
                          (q.type === 'secret' ? '[密钥] ' : '') + q.message,
                          q.placeholder,
                          options,
                        );
                  if (value === undefined) {
                    authAbort?.abort();
                    throw new Error('登录已取消');
                  }
                  return value;
                },
              });
              await ctx.modelRegistry.refresh();
            } finally {
              authAbort = undefined;
              emit({ type: 'desktop_auth', clear: true });
            }
            break;
          }
          case 'cancel_auth':
            authAbort?.abort();
            break;
          case 'logout':
            await (await models(ctx)).logout(p.provider);
            await ctx.modelRegistry.refresh();
            break;
          case 'resources': {
            const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
              projectTrusted: ctx.isProjectTrusted(),
            });
            const pm = new DefaultPackageManager({
              cwd: ctx.cwd,
              agentDir: getAgentDir(),
              settingsManager: settings,
              builtinExtensions: ['llama.cpp', 'codemode', 'tool-search', 'mcp'],
            });
            const resolved = await pm.resolve(async () => 'skip');
            data = {
              resources: Object.entries(resolved).flatMap(([kind, items]) =>
                items.map((r: any) => ({ ...r, kind })),
              ),
              packages: pm.listConfiguredPackages(),
              tools: pi.getAllTools().map((t) => ({ name: t.name, description: t.description })),
              activeTools: pi.getActiveTools(),
            };
            break;
          }
          case 'toggle_resource': {
            const r = p.resource;
            if (!['extensions', 'skills', 'prompts', 'themes'].includes(r.kind))
              throw new Error('资源类型无效');
            if (r.metadata.scope === 'project' && !ctx.isProjectTrusted()) throw new Error('请先信任项目');
            const file = path.join(
              r.metadata.scope === 'project' ? path.join(ctx.cwd, '.pi') : getAgentDir(),
              'settings.json',
            );
            const raw = await fs.readFile(file, 'utf8').catch((e) => {
              if (e.code === 'ENOENT') return '{}';
              throw e;
            });
            const config = toggleResourceSetting(JSON.parse(raw), r, p.enabled);
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file + '.desktop-backup', raw, { mode: 0o600 });
            await fs.writeFile(file + '.desktop-tmp', JSON.stringify(config, null, 2) + '\n', {
              mode: 0o600,
            });
            await fs.rename(file + '.desktop-tmp', file);
            emit({ type: 'desktop_result', id, data: { reloading: true } });
            replied = true;
            await ctx.reload();
            break;
          }
          default:
            throw new Error('未知桌面操作');
        }
        if (!replied) emit({ type: 'desktop_result', id, data });
      } catch (error) {
        if (replied) throw error;
        emit({ type: 'desktop_result', id, error: error instanceof Error ? error.message : String(error) });
      }
    },
  });
}
