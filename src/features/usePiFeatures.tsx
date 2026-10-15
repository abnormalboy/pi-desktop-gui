import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  type ConfigDocument,
  type ConfigKind,
  type Runtime,
  type Session,
  type TreeEntry,
  type ResourceCatalog,
  type ProviderInfo,
} from '../../shared/types';
import { busy } from '../../shared/types';
import type { LocalUsageSummary } from '../../shared/usage';
const api = window.desktop;
export function usePiFeatures({
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
  const [usage, setUsage] = useState<LocalUsageSummary>();
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
    else {
      await api.invoke('connect', session.id);
      if (tab === 'session') setUsage(await api.invoke('usageSummary'));
    }
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
  return {
    session,
    runtime,
    usage,
    close,
    setNotice,
    instructions,
    setInstructions,
    disabled,
    run,
    exportFile,
    tree,
    setTree,
    filter,
    setFilter,
    treeMode,
    setTreeMode,
    labeling,
    setLabeling,
    summarize,
    setSummarize,
    refresh,
    catalog,
    source,
    setSource,
    local,
    setLocal,
    resourceQuery,
    setResourceQuery,
    kind,
    imageModel,
    setImageModel,
    reasoningModel,
    setReasoningModel,
    providers,
    provider,
    setProvider,
    providerQuery,
    setProviderQuery,
    document,
    providerId,
    setProviderId,
    baseUrl,
    setBaseUrl,
    apiType,
    setApiType,
    apiKey,
    setApiKey,
    modelIds,
    setModelIds,
    addJson,
    configEditor,
    setDocument,
    setDirty,
    serverName,
    setServerName,
    serverType,
    setServerType,
    serverTarget,
    setServerTarget,
    serverArgs,
    setServerArgs,
    setFormDirty,
    tab,
    setTab,
    pending,
    error,
    notice,
    setKind,
    dirty,
  };
}
export type FeatureModel = ReturnType<typeof usePiFeatures>;
