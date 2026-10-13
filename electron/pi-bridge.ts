// Loaded by Pi's extension loader, never by Electron. Responses use RPC UI notifications.
import {
  ModelRuntime,
  SettingsManager,
  DefaultPackageManager,
  getAgentDir,
} from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import fs from 'node:fs/promises';
import path from 'node:path';
import { toggleResourceSetting } from './resources-config';

export default function desktopBridge(pi: ExtensionAPI) {
  let authAbort: AbortController | undefined;
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
  pi.registerCommand('desktop-internal', {
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
            data = { autoRetry: pi.getSettings().retry?.enabled !== false };
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
