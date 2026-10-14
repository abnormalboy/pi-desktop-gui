import { useEffect, useState } from 'react';
import { RefreshCw, GitBranch, Copy, Download, Share2, Terminal, FolderOpen, Plus, Tag } from 'lucide-react';
import type {
  ConfigDocument,
  ConfigKind,
  Runtime,
  Session,
  TreeEntry,
  ResourceCatalog,
  ProviderInfo,
} from '../shared/types';
import { busy } from '../shared/types';
import { Modal, shortcut } from './App';
import { SettingsForm } from './SettingsForm';
const api = window.desktop;
export const builtinCommands = [
  ['new', '新建当前范围的对话'],
  ['resume', '搜索和恢复历史'],
  ['name', '重命名会话'],
  ['session', '会话信息与上下文'],
  ['tree', '查看会话树'],
  ['fork', '从历史消息分支'],
  ['clone', '克隆当前分支'],
  ['compact', '压缩上下文，可附加要求'],
  ['import', '导入 Pi JSONL'],
  ['copy', '复制最后回复'],
  ['export', '导出 HTML 或 JSONL'],
  ['share', '分享会话'],
  ['settings', 'Pi 设置'],
  ['model', '选择模型'],
  ['thinking', '选择推理级别'],
  ['scoped-models', '设置模型范围'],
  ['login', '登录或配置凭据'],
  ['logout', '管理登录凭据'],
  ['mcp', '管理 MCP 服务器'],
  ['reload', '重新加载配置与扩展'],
  ['config', '管理 Skills、扩展与模板'],
  ['hotkeys', '快捷键'],
  ['help', '命令与快捷键'],
  ['trust', '启用项目'],
  ['changelog', '查看 Pi 更新记录'],
  ['bug', '诊断信息'],
  ['terminal', '在 Pi 原生终端继续'],
  ['quit', '退出 Pi Desktop'],
].map(([name, description]) => ({ name, description, source: 'desktop' }));

export function PiFeatures({
  session,
  runtime,
  initialTab,
  close,
}: {
  session: Session;
  runtime: Runtime;
  initialTab: string;
  close: () => void;
}) {
  const [tab, setTab] = useState(initialTab),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [tree, setTree] = useState<TreeEntry[]>([]),
    [filter, setFilter] = useState(''),
    [treeMode, setTreeMode] = useState<'conversation' | 'user' | 'labeled' | 'all'>('conversation'),
    [labeling, setLabeling] = useState<{ id: string; text: string }>(),
    [instructions, setInstructions] = useState(''),
    [summarize, setSummarize] = useState(false);
  const [catalog, setCatalog] = useState<ResourceCatalog>(),
    [source, setSource] = useState(''),
    [local, setLocal] = useState(false);
  const [resourceQuery, setResourceQuery] = useState('');
  const [imageModel, setImageModel] = useState(false),
    [reasoningModel, setReasoningModel] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]),
    [provider, setProvider] = useState(''),
    [providerQuery, setProviderQuery] = useState('');
  const [kind, setKind] = useState<ConfigKind>(
      initialTab === 'mcp' ? 'mcp' : initialTab === 'providers' ? 'models' : 'settings',
    ),
    [document, setDocument] = useState<ConfigDocument>(),
    [jsonDirty, setDirty] = useState(false),
    [formDirty, setFormDirty] = useState(false);
  const dirty = jsonDirty || formDirty;
  const [providerId, setProviderId] = useState(''),
    [baseUrl, setBaseUrl] = useState(''),
    [apiType, setApiType] = useState('openai-completions'),
    [apiKey, setApiKey] = useState(''),
    [modelIds, setModelIds] = useState('');
  const [serverName, setServerName] = useState(''),
    [serverType, setServerType] = useState('http'),
    [serverTarget, setServerTarget] = useState(''),
    [serverArgs, setServerArgs] = useState('[]');
  const disabled = pending || busy(runtime.status);
  const run = async (fn: () => Promise<void>) => {
    setPending(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(
        String(e instanceof Error ? e.message : e).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          '',
        ),
      );
    } finally {
      setPending(false);
    }
  };
  const read = async (k = kind, scope = local) => {
    setDocument(await api.invoke('configRead', session.id, k, scope));
    setDirty(false);
  };
  const refresh = async () => {
    if (tab === 'tree') setTree(await api.invoke('sessionTree', session.id));
    else if (tab === 'resources') setCatalog(await api.invoke('resources', session.id));
    else if (tab === 'providers') {
      await read('models', false);
      setProviders(await api.invoke('providers', session.id));
    } else if (tab === 'mcp') await read('mcp');
    else if (tab === 'settings') await read();
    else if (tab === 'prefs') return;
    else await api.invoke('connect', session.id);
  };
  useEffect(() => {
    void run(refresh);
  }, [tab, session.id]);
  const exportFile = (format: 'html' | 'jsonl') =>
    run(async () => {
      const file = await api.invoke('exportSession', session.id, format);
      if (file) setNotice('已导出：' + file);
    });
  const addJson = (key: string, id: string, value: unknown) => {
    if (!document || !id.trim() || ['__proto__', 'constructor', 'prototype'].includes(id))
      throw new Error('请输入有效名称');
    const config = JSON.parse(document.text);
    if (config[key]?.[id]) throw new Error('名称已存在，请在配置中编辑，或使用新名称');
    config[key] = { ...config[key], [id]: value };
    setDocument({ ...document, text: JSON.stringify(config, null, 2) });
    setDirty(true);
  };
  const configEditor = (k: ConfigKind) => (
    <div className="config-editor">
      <div className="button-row">
        {session.projectId && k !== 'models' && (
          <label>
            范围{' '}
            <select
              aria-label="配置范围"
              value={local ? 'project' : 'user'}
              disabled={disabled || dirty}
              onChange={(e) => {
                const scope = e.target.value === 'project';
                setLocal(scope);
                void run(() => read(k, scope));
              }}
            >
              <option value="user">个人</option>
              <option value="project">当前项目</option>
            </select>
          </label>
        )}
        <button disabled={disabled || dirty} onClick={() => void run(() => read(k))}>
          <RefreshCw size={14} />
          重新读取
        </button>
        <button
          disabled={disabled || !dirty || !document}
          className="primary"
          onClick={() =>
            void run(async () => {
              await api.invoke('configSave', session.id, k, local, document!);
              await read(k);
              setApiKey('');
              setNotice('已保存并重新连接 Pi。原配置已备份。');
            })
          }
        >
          保存并应用
        </button>
      </div>
      <p className="settings-copy">
        {document?.path}
        <br />
        已有密钥显示为占位符，保存时保留原值。修改前会保留备份；配置变动会重新连接 Pi。
      </p>
      <textarea
        className="json-editor"
        aria-label="Pi 配置 JSON"
        spellCheck={false}
        value={document?.text ?? ''}
        disabled={disabled || !document}
        onChange={(e) => {
          setDocument((d) => (d ? { ...d, text: e.target.value } : d));
          setDirty(true);
        }}
      />
      {dirty && <p className="environment-note">配置尚未保存。请保存后切换页面；关闭窗口将放弃本次编辑。</p>}
    </div>
  );
  return (
    <Modal wide title="Pi 功能" subtitle="会话、工具与个人配置" close={close}>
      <div className="settings-layout feature-layout">
        <nav>
          {[
            ['session', '会话与上下文'],
            ['tree', '会话树与分支'],
            ['resources', 'Skills 与扩展'],
            ['mcp', 'MCP 服务器'],
            ['providers', '供应商与登录'],
            ['prefs', '常用设置'],
            ['settings', '完整 Pi 设置'],
            ['help', '命令与快捷键'],
          ].map(([id, title]) => (
            <button
              key={id}
              className={tab === id ? 'active' : ''}
              disabled={dirty || pending}
              onClick={() => {
                setLocal(false);
                setDocument(undefined);
                setKind(id === 'mcp' ? 'mcp' : id === 'providers' ? 'models' : 'settings');
                setTab(id);
              }}
            >
              {title}
            </button>
          ))}
        </nav>
        <div className="settings-content feature-content">
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <p className="feature-notice" role="status">
              {notice}
            </p>
          )}
          {tab === 'session' && (
            <>
              <h3>当前会话</h3>
              <p>{session.title}</p>
              <p className="settings-copy">{runtime.cwd || session.cwd || '连接后显示工作目录'}</p>
              <div className="button-row">
                <button
                  onClick={() =>
                    void run(async () => {
                      await api.invoke('revealSessionDirectory', session.id);
                    })
                  }
                >
                  <FolderOpen size={14} />
                  打开工作目录
                </button>
                <button
                  disabled={disabled}
                  onClick={() =>
                    void run(async () => {
                      await api.invoke('branchSession', session.id, 'clone');
                      close();
                    })
                  }
                >
                  <Copy size={14} />
                  克隆会话
                </button>
              </div>
              <div className="feature-stats">
                <span>
                  累计用量 <strong>{runtime.stats?.tokens?.toLocaleString() ?? '—'} tokens</strong>
                </span>
                <span>
                  累计费用 <strong>${runtime.stats?.cost?.toFixed(4) ?? '—'}</strong>
                </span>
                <span>
                  上下文占用 <strong>{runtime.stats?.contextPercent?.toFixed(1) ?? '—'}%</strong>
                </span>
              </div>
              <h3>上下文与队列</h3>
              {[
                ['autoCompaction', '自动压缩上下文'],
                ['autoRetry', '临时错误自动重试'],
              ].map(([key, label]) => (
                <label className="option-row" key={key}>
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    aria-label={label}
                    checked={Boolean(runtime[key as 'autoCompaction'])}
                    disabled={disabled}
                    onChange={(e) =>
                      void run(async () => {
                        await api.invoke('piOption', session.id, key as 'autoCompaction', e.target.checked);
                      })
                    }
                  />
                </label>
              ))}
              {[
                ['steeringMode', '补充指令发送方式'],
                ['followUpMode', '后续消息发送方式'],
              ].map(([key, label]) => (
                <label className="option-row" key={key}>
                  {label}
                  <select
                    aria-label={label}
                    disabled={disabled}
                    value={runtime[key as 'steeringMode'] || 'one-at-a-time'}
                    onChange={(e) =>
                      void run(async () => {
                        await api.invoke('piOption', session.id, key as 'steeringMode', e.target.value);
                      })
                    }
                  >
                    <option value="one-at-a-time">逐条发送</option>
                    <option value="all">一起发送</option>
                  </select>
                </label>
              ))}
              <label className="field-label">压缩要求（可选）</label>
              <textarea
                className="input"
                aria-label="压缩要求"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="例如：保留文件修改和待办事项"
              />
              <button
                disabled={disabled}
                onClick={() =>
                  void run(async () => {
                    const result = await api.invoke('compact', session.id, instructions);
                    setNotice(`压缩完成，原上下文 ${result.tokensBefore} tokens。\n${result.summary}`);
                  })
                }
              >
                立即压缩
              </button>
              <h3>导出与分享</h3>
              <div className="button-row">
                <button disabled={disabled} onClick={() => void exportFile('html')}>
                  <Download size={14} />
                  导出 HTML
                </button>
                <button disabled={disabled} onClick={() => void exportFile('jsonl')}>
                  导出 JSONL
                </button>
                <button
                  disabled={disabled}
                  onClick={() =>
                    void run(async () => {
                      const url = await api.invoke('shareSession', session.id);
                      if (url) setNotice('分享链接已复制：' + url);
                    })
                  }
                >
                  <Share2 size={14} />
                  分享会话
                </button>
              </div>
              <p className="settings-copy">
                分享会生成 GitHub Gist 链接；上传前会再次确认。建议先导出检查完整内容。
              </p>
              <h3>Pi 原生终端</h3>
              <p className="settings-copy">
                依赖终端自定义界面的扩展、终端主题和渲染设置，可在同一会话的原生终端使用。关闭终端后回到桌面重新连接。
              </p>
              <button
                disabled={disabled}
                onClick={() =>
                  void run(async () => {
                    await api.invoke('openPiTerminal', session.id);
                    close();
                  })
                }
              >
                <Terminal size={14} />在 Pi 终端继续
              </button>
            </>
          )}
          {tab === 'tree' && (
            <>
              <div className="settings-heading">
                <h3>会话树与分支</h3>
                <button disabled={disabled} onClick={() => void run(refresh)}>
                  <RefreshCw size={14} />
                  刷新
                </button>
              </div>
              <input
                className="input"
                aria-label="搜索会话树"
                placeholder="搜索消息"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className="segmented" role="radiogroup" aria-label="会话树筛选">
                {(
                  [
                    ['conversation', '对话'],
                    ['user', '只看提问'],
                    ['labeled', '有标签'],
                    ['all', '全部记录'],
                  ] as const
                ).map(([id, title]) => (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={treeMode === id}
                    onClick={() => setTreeMode(id)}
                  >
                    {title}
                    {id === 'labeled' && tree.some((e) => e.label) && (
                      <span className="count">{tree.filter((e) => e.label).length}</span>
                    )}
                  </button>
                ))}
              </div>
              <label className="option-row">
                切换时总结离开的分支
                <input type="checkbox" checked={summarize} onChange={(e) => setSummarize(e.target.checked)} />
              </label>
              {summarize && (
                <input
                  className="input"
                  aria-label="分支总结要求"
                  placeholder="总结要求（可选）"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              )}
              <div className="session-tree">
                {tree
                  .filter(
                    (e) =>
                      (treeMode === 'all' ||
                        (treeMode === 'labeled'
                          ? !!e.label
                          : treeMode === 'user'
                            ? e.role === 'user'
                            : ['user', 'assistant'].includes(e.role ?? '') || e.type === 'branch_summary')) &&
                      (e.text + ' ' + (e.label ?? '')).toLowerCase().includes(filter.toLowerCase()),
                  )
                  .map((e) => (
                    <article
                      key={e.id}
                      className={(e.active ? 'active ' : '') + (e.role ?? e.type)}
                      style={{ marginLeft: Math.min(e.depth, 8) * 8 }}
                    >
                      <small>
                        {{ user: '提问', assistant: '回复', toolResult: '工具结果' }[e.role ?? ''] ??
                          ({ branch_summary: '分支总结', compaction: '压缩摘要' }[e.type] || e.type)}
                        {e.active ? ' · 当前分支' : ''}
                        {e.label && (
                          <mark className="entry-label">
                            <Tag size={11} />
                            {e.label}
                          </mark>
                        )}
                      </small>
                      <p>{e.text}</p>
                      {labeling?.id === e.id && (
                        <form
                          className="label-form"
                          onSubmit={(ev) => {
                            ev.preventDefault();
                            void run(async () => {
                              await api.invoke('setEntryLabel', session.id, e.id, labeling.text);
                              setLabeling(undefined);
                              setTree(await api.invoke('sessionTree', session.id));
                            });
                          }}
                        >
                          <input
                            className="input"
                            autoFocus
                            aria-label="标签名称"
                            maxLength={60}
                            placeholder="例如：可用方案、回滚点（留空清除）"
                            value={labeling.text}
                            onChange={(ev) => setLabeling({ id: e.id, text: ev.target.value })}
                            onKeyDown={(ev) => {
                              if (ev.key === 'Escape') {
                                ev.preventDefault();
                                ev.stopPropagation();
                                setLabeling(undefined);
                              }
                            }}
                          />
                          <button type="submit" className="primary" disabled={disabled}>
                            保存
                          </button>
                          <button type="button" onClick={() => setLabeling(undefined)}>
                            取消
                          </button>
                        </form>
                      )}
                      <div className="button-row">
                        <button
                          disabled={disabled}
                          onClick={() =>
                            void run(async () => {
                              await api.invoke(
                                'branchSession',
                                session.id,
                                'navigate',
                                e.id,
                                summarize,
                                instructions,
                              );
                              setTree(await api.invoke('sessionTree', session.id));
                            })
                          }
                        >
                          切换到这里
                        </button>
                        {e.role === 'user' && (
                          <button
                            disabled={disabled || !e.active}
                            title={e.active ? '' : '先切换到所在分支'}
                            onClick={() =>
                              void run(async () => {
                                await api.invoke('branchSession', session.id, 'fork', e.id);
                                close();
                              })
                            }
                          >
                            <GitBranch size={13} />
                            从这里分支
                          </button>
                        )}
                        <button
                          disabled={disabled}
                          onClick={() => setLabeling({ id: e.id, text: e.label ?? '' })}
                        >
                          <Tag size={13} />
                          {e.label ? '修改标签' : '加标签'}
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              {!tree.length && <p className="settings-copy">发送消息后，会话记录将显示在这里。</p>}
            </>
          )}
          {tab === 'resources' && (
            <>
              <div className="settings-heading">
                <h3>Skills、扩展与提示词模板</h3>
                <button disabled={disabled} onClick={() => void run(refresh)}>
                  <RefreshCw size={14} />
                  刷新
                </button>
              </div>
              <input
                className="input"
                aria-label="筛选资源"
                placeholder="按名称、路径或类型筛选"
                value={resourceQuery}
                onChange={(e) => setResourceQuery(e.target.value)}
              />
              <div className="resource-list">
                {catalog?.resources
                  .filter((r) => (r.kind + r.path).toLowerCase().includes(resourceQuery.toLowerCase()))
                  .map((r) => (
                    <label className="resource-row" key={r.kind + r.path}>
                      <input
                        type="checkbox"
                        aria-label={'启用 ' + r.path}
                        checked={r.enabled}
                        disabled={disabled}
                        onChange={(e) =>
                          void run(async () => {
                            await api.invoke('toggleResource', session.id, r, e.target.checked);
                            await refresh();
                          })
                        }
                      />
                      <span>
                        <strong>
                          {r.kind === 'skills' && r.path.endsWith('SKILL.md')
                            ? r.path.split(/[\\/]/).at(-2)
                            : r.path.split(/[\\/]/).at(-1)}
                        </strong>
                        <small>
                          {r.kind} · {r.metadata.scope}
                        </small>
                        <code>{r.path}</code>
                      </span>
                    </label>
                  ))}
              </div>
              {!catalog?.resources.length && (
                <p className="settings-copy">
                  尚未发现额外资源。可以安装 npm / Git 包，也可以填写本机资源目录。
                </p>
              )}
              <h3>安装与管理资源包</h3>
              <input
                className="input"
                aria-label="资源包来源"
                placeholder="npm:包名、git:仓库地址或本机完整路径"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
              {session.projectId && (
                <label className="option-row">
                  仅安装到当前项目
                  <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />
                </label>
              )}
              <div className="button-row">
                <button
                  disabled={disabled || !source.trim()}
                  onClick={() =>
                    void run(async () => {
                      await api.invoke('packageAction', session.id, 'install', source, local);
                      setSource('');
                      await refresh();
                    })
                  }
                >
                  <Plus size={14} />
                  安装
                </button>
                <button
                  disabled={disabled}
                  onClick={() =>
                    void run(async () => {
                      await api.invoke('packageAction', session.id, 'update', '', false);
                      await refresh();
                    })
                  }
                >
                  更新资源包
                </button>
                <button
                  disabled={disabled}
                  onClick={() =>
                    void run(async () => {
                      await api.invoke('reloadPi', session.id);
                      await refresh();
                    })
                  }
                >
                  重新加载
                </button>
              </div>
              {catalog?.packages.map((p) => (
                <div className="option-row" key={p.scope + p.source}>
                  <span>
                    {p.source}
                    <small> · {p.scope}</small>
                  </span>
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void run(async () => {
                        await api.invoke(
                          'packageAction',
                          session.id,
                          'remove',
                          p.source,
                          p.scope === 'project',
                        );
                        await refresh();
                      })
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
              <details>
                <summary>当前工具（{catalog?.tools.length ?? 0}）</summary>
                {catalog?.tools.map((t) => (
                  <p key={t.name}>
                    <strong>{t.name}</strong>
                    <small> {catalog.activeTools.includes(t.name) ? '已启用' : '按需调用'}</small>
                    <br />
                    {t.description.slice(0, 160)}
                  </p>
                ))}
              </details>
            </>
          )}
          {tab === 'providers' && (
            <>
              <h3>登录与凭据</h3>
              <input
                className="input"
                aria-label="筛选供应商"
                placeholder="筛选供应商"
                value={providerQuery}
                onChange={(e) => setProviderQuery(e.target.value)}
              />
              <select
                className="input"
                aria-label="登录供应商"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="">选择供应商</option>
                {providers
                  .filter((p) => (p.name + p.id).toLowerCase().includes(providerQuery.toLowerCase()))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.configured ? '· 已配置' : ''}
                    </option>
                  ))}
              </select>
              <div className="button-row">
                <button
                  disabled={disabled || !providers.find((p) => p.id === provider)?.oauth}
                  onClick={() =>
                    void run(async () => {
                      await api.invoke('login', session.id, provider, 'oauth');
                      await refresh();
                      setNotice('登录成功');
                    })
                  }
                >
                  浏览器登录
                </button>
                <button
                  disabled={disabled || !providers.find((p) => p.id === provider)?.apiKey}
                  onClick={() =>
                    void run(async () => {
                      await api.invoke('login', session.id, provider, 'api_key');
                      await refresh();
                      setNotice('凭据已保存');
                    })
                  }
                >
                  设置 API Key
                </button>
                <button
                  disabled={disabled || !provider}
                  onClick={() =>
                    void run(async () => {
                      await api.invoke('logout', session.id, provider);
                      await refresh();
                      setNotice('已移除登录凭据；环境变量和 models.json 中的配置仍独立生效。');
                    })
                  }
                >
                  退出登录
                </button>
              </div>
              <details>
                <summary>添加自定义供应商</summary>
                <label className="field-label">供应商标识</label>
                <input
                  className="input"
                  aria-label="新供应商标识"
                  value={providerId}
                  onChange={(e) => setProviderId(e.target.value)}
                />
                <label className="field-label">接口地址</label>
                <input
                  className="input"
                  aria-label="供应商接口地址"
                  placeholder="https://example.com/v1"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
                <label className="field-label">API 类型</label>
                <select
                  className="input"
                  aria-label="API 类型"
                  value={apiType}
                  onChange={(e) => setApiType(e.target.value)}
                >
                  <option>openai-completions</option>
                  <option>openai-responses</option>
                  <option>anthropic-messages</option>
                  <option>google-generative-ai</option>
                </select>
                <label className="field-label">API Key 或环境变量名</label>
                <input
                  type="password"
                  autoComplete="off"
                  className="input"
                  aria-label="新供应商密钥"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <label className="field-label">模型 ID（每行一个）</label>
                <textarea
                  className="input"
                  aria-label="新供应商模型"
                  value={modelIds}
                  onChange={(e) => setModelIds(e.target.value)}
                />
                <label className="option-row">
                  这些模型支持图片
                  <input
                    type="checkbox"
                    checked={imageModel}
                    onChange={(e) => setImageModel(e.target.checked)}
                  />
                </label>
                <label className="option-row">
                  这些模型支持推理级别
                  <input
                    type="checkbox"
                    checked={reasoningModel}
                    onChange={(e) => setReasoningModel(e.target.checked)}
                  />
                </label>
                <button
                  disabled={disabled || !document}
                  onClick={() =>
                    void run(async () => {
                      if (!/^https?:\/\//.test(baseUrl) || !modelIds.trim())
                        throw new Error('请填写接口地址和模型');
                      addJson('providers', providerId, {
                        baseUrl,
                        api: apiType,
                        ...(apiKey ? { apiKey } : {}),
                        models: modelIds
                          .split(/\r?\n/)
                          .map((id) => id.trim())
                          .filter(Boolean)
                          .map((id) => ({
                            id,
                            input: imageModel ? ['text', 'image'] : ['text'],
                            reasoning: reasoningModel,
                            contextWindow: 128000,
                            maxTokens: 16384,
                          })),
                      });
                      setNotice('已加入下方配置，请核对模型能力与上下文大小后保存。');
                    })
                  }
                >
                  添加到配置
                </button>
              </details>
              <h3>供应商配置</h3>
              {configEditor('models')}
            </>
          )}
          {tab === 'mcp' && (
            <>
              <div className="mcp-status">
                <strong>最近的连接状态</strong>
                {runtime.notices.slice(-5).map((n, i) => (
                  <pre key={i}>{n}</pre>
                ))}
              </div>
              <div className="mcp-servers">
                {(() => {
                  try {
                    return Object.entries(JSON.parse(document?.text ?? '{}').mcpServers ?? {}).map(
                      ([name, value]) => {
                        const v = value as any;
                        const change = (update: object) => {
                          const json = JSON.parse(document!.text);
                          json.mcpServers[name] = { ...v, ...update };
                          setDocument({ ...document!, text: JSON.stringify(json, null, 2) });
                          setDirty(true);
                        };
                        return (
                          <div className="mcp-server" key={name}>
                            <strong>{name}</strong>
                            <small>{v.url || v.command || '项目覆盖配置'}</small>
                            <label>
                              启用{' '}
                              <input
                                aria-label={'启用 MCP ' + name}
                                type="checkbox"
                                checked={v.enabled !== false}
                                disabled={disabled}
                                onChange={(e) => change({ enabled: e.target.checked })}
                              />
                            </label>
                            <label>
                              工具暴露{' '}
                              <select
                                aria-label={'MCP 工具暴露 ' + name}
                                disabled={disabled}
                                value={v.exposure ?? 'codemode'}
                                onChange={(e) => change({ exposure: e.target.value })}
                              >
                                <option value="codemode">代码模式</option>
                                <option value="direct">直接提供</option>
                                <option value="deferred">按需发现</option>
                                <option value="hidden">隐藏</option>
                              </select>
                            </label>
                          </div>
                        );
                      },
                    );
                  } catch {
                    return null;
                  }
                })()}
              </div>
              <h3>MCP 服务器</h3>
              <div className="button-row">
                <button
                  disabled={disabled}
                  onClick={() =>
                    void run(async () => {
                      await api.invoke('send', session.id, '/mcp', [], 'steer');
                    })
                  }
                >
                  查看连接状态
                </button>
                <button
                  disabled={disabled}
                  onClick={() =>
                    void run(async () => {
                      await api.invoke('reloadPi', session.id);
                      setNotice('已重新加载 MCP');
                    })
                  }
                >
                  重新连接
                </button>
              </div>
              <details>
                <summary>添加服务器</summary>
                <label className="field-label">服务器名称</label>
                <input
                  className="input"
                  aria-label="MCP 名称"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                />
                <select
                  className="input"
                  aria-label="MCP 传输"
                  value={serverType}
                  onChange={(e) => setServerType(e.target.value)}
                >
                  <option value="http">HTTP</option>
                  <option value="stdio">本地 stdio</option>
                </select>
                <input
                  className="input"
                  aria-label="MCP 地址或程序"
                  placeholder={serverType === 'http' ? 'https://example.com/mcp' : '程序路径，例如 npx'}
                  value={serverTarget}
                  onChange={(e) => setServerTarget(e.target.value)}
                />
                {serverType === 'stdio' && (
                  <input
                    className="input"
                    aria-label="MCP 参数"
                    placeholder='["-y", "包名"]'
                    value={serverArgs}
                    onChange={(e) => setServerArgs(e.target.value)}
                  />
                )}
                <button
                  disabled={disabled || !document}
                  onClick={() =>
                    void run(async () => {
                      if (!/^[\w-]+$/.test(serverName) || !serverTarget) throw new Error('请输入名称和地址');
                      const args = JSON.parse(serverArgs);
                      if (!Array.isArray(args) || !args.every((v) => typeof v === 'string'))
                        throw new Error('参数必须是字符串数组');
                      addJson(
                        'mcpServers',
                        serverName,
                        serverType === 'http'
                          ? { url: serverTarget, enabled: true }
                          : { command: serverTarget, args, enabled: true },
                      );
                    })
                  }
                >
                  添加到配置
                </button>
              </details>
              <p className="settings-copy">
                在配置中设置 enabled、exposure、toolExposure、env 和 headers。保存后自动应用。
              </p>
              {configEditor('mcp')}
              <label className="field-label">服务器名称（用于登录、退出或重连）</label>
              <input
                className="input"
                aria-label="操作 MCP 服务器"
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
              />
              <div className="button-row">
                {[
                  ['login', '登录'],
                  ['logout', '退出登录'],
                  ['reconnect', '重新连接'],
                ].map(([cmd, label]) => (
                  <button
                    key={cmd}
                    disabled={disabled || !/^[\w-]+$/.test(serverName)}
                    onClick={() =>
                      void run(async () => {
                        await api.invoke('send', session.id, `/mcp ${cmd} ${serverName}`, [], 'steer');
                        setNotice('MCP 操作已完成，请查看会话中的状态。');
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          {tab === 'prefs' && (
            <>
              <h3>常用设置</h3>
              <SettingsForm
                session={session}
                disabled={disabled}
                run={run}
                notify={setNotice}
                dirtyChange={setFormDirty}
              />
            </>
          )}
          {tab === 'settings' && (
            <>
              <h3>完整 Pi 配置</h3>
              <p className="settings-copy">
                可编辑 Pi settings.json 的全部选项，包括
                defaultTools、enabledModels、模型默认值、压缩阈值、重试策略、资源路径和
                shellPath。终端显示设置在原生 Pi 终端生效。
              </p>
              {configEditor('settings')}
            </>
          )}
          {tab === 'help' && (
            <>
              <h3>快捷键</h3>
              <p>
                Enter 发送 · Shift+Enter 换行 · ↑↓ 翻看发送过的提问 · Esc 连按两次停止 · {shortcut('N')}{' '}
                新建独立对话 ·{shortcut('K')} 搜索历史 · {shortcut(',')} 设置 · {shortcut('G')} 外部编辑器 ·{' '}
                {shortcut('/')} 全部快捷键 · / 命令菜单 · @ 项目文件（也可拖入）
              </p>
              <p>
                <code>!命令</code> 执行并将输出加入上下文；<code>!!命令</code>{' '}
                执行并保留记录，输出不进入模型上下文。
              </p>
              <h3>桌面命令</h3>
              {builtinCommands.map((c) => (
                <p key={c.name}>
                  <code>/{c.name}</code> {c.description}
                </p>
              ))}
              <h3>已加载的 Pi 命令</h3>
              {runtime.commands.map((c) => (
                <p key={c.name}>
                  <code>/{c.name}</code> {c.description} <small>· {c.source}</small>
                </p>
              ))}
            </>
          )}
        </div>
      </div>
      <footer>
        <span className="settings-footer-note">
          {pending ? '正在处理…' : dirty ? '有尚未保存的配置' : '配置保存在本机'}
        </span>
        <button onClick={close}>关闭</button>
      </footer>
    </Modal>
  );
}
