import { RefreshCw, GitBranch, Tag } from 'lucide-react';
const api = window.desktop;
import type { FeatureModel } from './usePiFeatures';
export function TreeTab({
  session,
  close,
  tree,
  setTree,
  filter,
  setFilter,
  treeMode,
  setTreeMode,
  labeling,
  setLabeling,
  instructions,
  setInstructions,
  summarize,
  setSummarize,
  disabled,
  idleDisabled,
  idleReason,
  run,
  refresh,
}: Pick<
  FeatureModel,
  | 'session'
  | 'close'
  | 'tree'
  | 'setTree'
  | 'filter'
  | 'setFilter'
  | 'treeMode'
  | 'setTreeMode'
  | 'labeling'
  | 'setLabeling'
  | 'instructions'
  | 'setInstructions'
  | 'summarize'
  | 'setSummarize'
  | 'disabled'
  | 'idleDisabled'
  | 'idleReason'
  | 'run'
  | 'refresh'
>) {
  return (
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
          <button key={id} role="radio" aria-checked={treeMode === id} onClick={() => setTreeMode(id)}>
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
                  disabled={idleDisabled}
                  title={idleReason}
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
                    disabled={disabled}
                    title="创建独立会话，原任务继续运行"
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
                <button disabled={disabled} onClick={() => setLabeling({ id: e.id, text: e.label ?? '' })}>
                  <Tag size={13} />
                  {e.label ? '修改标签' : '加标签'}
                </button>
              </div>
            </article>
          ))}
      </div>
      {!tree.length && <p className="settings-copy">发送消息后，会话记录将显示在这里。</p>}
    </>
  );
}
