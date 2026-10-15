import { RefreshCw, Plus, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { PromptTemplateInput, PromptTemplateDocument } from '../../shared/prompts';
import '../styles/management.css';
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
  setFormDirty,
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
  | 'setFormDirty'
>) {
  const [template, setTemplate] = useState<PromptTemplateInput>();
  const [original, setOriginal] = useState<PromptTemplateDocument>();
  const [deleting, setDeleting] = useState<PromptTemplateDocument>();
  const edit = (value: PromptTemplateInput, document?: PromptTemplateDocument) => {
    setTemplate(value);
    setOriginal(document);
    setDeleting(undefined);
    setFormDirty(true);
  };
  const closeEditor = () => {
    setTemplate(undefined);
    setOriginal(undefined);
    setFormDirty(false);
  };
  return (
    <>
      <div className="settings-heading">
        <h3>Skills、扩展与提示词模板</h3>
        <button disabled={disabled || !!template} onClick={() => void run(refresh)}>
          <RefreshCw size={14} />
          刷新
        </button>
      </div>
      <button
        disabled={disabled || !!template}
        onClick={() =>
          edit({
            name: '',
            description: '',
            argumentHint: '',
            body: '',
            scope: session.projectId ? 'project' : 'global',
          })
        }
      >
        <Plus size={14} />
        新建提示词模板
      </button>
      {template && (
        <form
          className="prompt-editor"
          aria-label="提示词模板编辑器"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const saved = await api.invoke('promptSave', session.id, template, original);
              setOriginal(saved);
              await refresh();
              closeEditor();
            });
          }}
        >
          <h3>{original ? '编辑提示词模板' : '新建提示词模板'}</h3>
          <label>
            模板命令名
            <input
              className="input"
              aria-label="模板命令名"
              value={template.name}
              disabled={disabled || !!original}
              placeholder="例如 check-diff"
              maxLength={80}
              onChange={(e) => setTemplate({ ...template, name: e.target.value })}
            />
          </label>
          <label>
            简短说明
            <input
              className="input"
              aria-label="模板说明"
              value={template.description}
              disabled={disabled}
              maxLength={500}
              onChange={(e) => setTemplate({ ...template, description: e.target.value })}
            />
          </label>
          <label>
            参数提示（可选）
            <input
              className="input"
              aria-label="模板参数提示"
              value={template.argumentHint}
              disabled={disabled}
              placeholder="<目标文件> [关注点]"
              maxLength={200}
              onChange={(e) => setTemplate({ ...template, argumentHint: e.target.value })}
            />
          </label>
          <label>
            作用范围
            <select
              aria-label="模板作用范围"
              value={template.scope}
              disabled={disabled || !!original}
              onChange={(e) => setTemplate({ ...template, scope: e.target.value as 'global' | 'project' })}
            >
              <option value="global">个人全局</option>
              {session.projectId && <option value="project">仅当前项目</option>}
            </select>
          </label>
          <label>
            模板正文
            <textarea
              className="input"
              aria-label="模板正文"
              value={template.body}
              disabled={disabled}
              rows={9}
              onChange={(e) => setTemplate({ ...template, body: e.target.value })}
            />
          </label>
          <p className="settings-copy">
            使用 $1、$2 表示按顺序填写的参数，$ARGUMENTS 表示全部参数。保存为 Pi 原生 .md 模板。
          </p>
          {original && <p className="settings-copy">{original.path}</p>}
          <div className="button-row">
            <button
              type="submit"
              className="primary"
              disabled={disabled || !template.name || !template.body.trim()}
            >
              保存模板
            </button>
            <button type="button" disabled={disabled} onClick={closeEditor}>
              取消编辑
            </button>
          </div>
        </form>
      )}
      {deleting && (
        <div className="prompt-delete" role="alert">
          <p>删除提示词模板 /{deleting.name}？此操作会删除本机模板文件。</p>
          <code>{deleting.path}</code>
          <div className="button-row">
            <button
              className="danger"
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  await api.invoke('promptDelete', session.id, deleting.path, deleting.revision);
                  setDeleting(undefined);
                  await refresh();
                })
              }
            >
              删除模板
            </button>
            <button disabled={disabled} onClick={() => setDeleting(undefined)}>
              保留模板
            </button>
          </div>
        </div>
      )}
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
            <div className="resource-row" key={r.kind + r.path}>
              <input
                type="checkbox"
                aria-label={'启用 ' + r.path}
                checked={r.enabled}
                disabled={disabled || !!template}
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
              {r.kind === 'prompts' &&
                (r.promptEditable ? (
                  <div className="resource-actions">
                    <button
                      disabled={disabled || !!template}
                      aria-label={`编辑模板 ${r.path.split(/[\\/]/).at(-1)}`}
                      onClick={() =>
                        void run(async () => {
                          const document = await api.invoke('promptRead', session.id, r.path);
                          edit(document, document);
                        })
                      }
                    >
                      <Pencil size={13} />
                      编辑
                    </button>
                    <button
                      disabled={disabled || !!template}
                      aria-label={`删除模板 ${r.path.split(/[\\/]/).at(-1)}`}
                      onClick={() =>
                        void run(async () => {
                          setDeleting(await api.invoke('promptRead', session.id, r.path));
                        })
                      }
                    >
                      <Trash2 size={13} />
                      删除
                    </button>
                  </div>
                ) : (
                  <small className="resource-readonly">只读</small>
                ))}
            </div>
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
