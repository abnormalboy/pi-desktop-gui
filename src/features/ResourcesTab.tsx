import { RefreshCw, Plus } from 'lucide-react';
const api = window.desktop;
import type { FeatureModel } from './usePiFeatures';
export function ResourcesTab({
  session,
  filter,
  catalog,
  source,
  setSource,
  local,
  setLocal,
  resourceQuery,
  setResourceQuery,
  kind,
  disabled,
  run,
  refresh,
}: Pick<
  FeatureModel,
  | 'session'
  | 'filter'
  | 'catalog'
  | 'source'
  | 'setSource'
  | 'local'
  | 'setLocal'
  | 'resourceQuery'
  | 'setResourceQuery'
  | 'kind'
  | 'disabled'
  | 'run'
  | 'refresh'
>) {
  return (
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
        <p className="settings-copy">尚未发现额外资源。可以安装 npm / Git 包，也可以填写本机资源目录。</p>
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
                await api.invoke('packageAction', session.id, 'remove', p.source, p.scope === 'project');
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
  );
}
