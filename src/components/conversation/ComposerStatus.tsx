import { AlertCircle, RefreshCw, X, Link2 } from 'lucide-react';
import { IconButton } from '../IconButton';
import { Badge } from '../Badge';
import { ModelErrorCard } from '../ModelErrorCard';
import { ContextMeter } from './Usage';
import { modKey, shortcut } from '../../lib/platform';
import type { ComposerProps } from '../Composer';
import type { ModelErrorAction } from '../../../shared/errors';
const api = window.desktop;
export function ComposerFeedback(
  props: ComposerProps & { handleModelError: (action: ModelErrorAction) => Promise<void> },
) {
  const {
    error,
    ownRuntime,
    runtime,
    setError,
    attempt,
    running,
    pending,
    storage,
    handleModelError,
    selected,
    setNotice,
  } = props;
  return (
    <>
      {error && !(ownRuntime && runtime.errorKind && error === runtime.error) && (
        <div className="error-banner" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <IconButton title="关闭错误提示" onClick={() => setError('')}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      {ownRuntime && runtime.status === 'retrying' && runtime.retry && (
        <div className="retry-banner" role="status">
          <RefreshCw size={14} className="spin" />
          <span>
            第 {runtime.retry.attempt}/{runtime.retry.maxAttempts} 次重试
            {runtime.retry.delayMs > 0 &&
              Date.now() < runtime.retry.startedAt + runtime.retry.delayMs &&
              `，${Math.ceil((runtime.retry.startedAt + runtime.retry.delayMs - Date.now()) / 1000)} 秒后开始`}
            {runtime.retry.error && <small>{runtime.retry.error}</small>}
          </span>
          <button onClick={() => void attempt(() => api.invoke('abortRetry'))}>取消重试</button>
        </div>
      )}
      {ownRuntime && runtime.error && runtime.errorKind ? (
        <ModelErrorCard
          error={runtime.error}
          kind={runtime.errorKind}
          count={runtime.errorCount}
          disabled={running || pending || !storage.writable}
          autoCompaction={runtime.autoCompaction}
          act={(action) => attempt(() => handleModelError(action))}
          enableCompaction={() => attempt(() => api.invoke('piOption', selected!.id, 'autoCompaction', true))}
          copy={async (text) => {
            await api.invoke('copy', text);
            setNotice('错误详情已复制');
          }}
        />
      ) : (
        ownRuntime &&
        runtime.error &&
        runtime.error !== error && (
          <div className="error-banner">
            <AlertCircle size={16} />
            <span>{runtime.error}</span>
          </div>
        )
      )}
      {ownRuntime && (runtime.steering.length > 0 || runtime.followUp.length > 0) && (
        <div className="queue">
          <div>
            <span>待处理</span>
            <button onClick={() => void attempt(() => api.invoke('clearQueue'))}>清空并恢复草稿</button>
          </div>
          {runtime.steering.map((q, i) => (
            <p key={'s' + i}>
              <span>补充</span>
              {q.slice(0, 180)}
            </p>
          ))}
          {runtime.followUp.map((q, i) => (
            <p key={'f' + i}>
              <span>接下来</span>
              {q.slice(0, 180)}
            </p>
          ))}
        </div>
      )}
      {ownRuntime &&
        Object.entries(runtime.widgets)
          .filter(([key]) => runtime.widgetPlacements?.[key] !== 'belowEditor')
          .map(([key, lines]) => (
            <div className="extension-widget" key={key}>
              {lines.join('\n')}
            </div>
          ))}
      {ownRuntime && Object.keys(runtime.statuses).length > 0 && (
        <div className="extension-status">{Object.values(runtime.statuses).join(' · ')}</div>
      )}
    </>
  );
}
export function ComposerFooter(props: ComposerProps) {
  const {
    ownRuntime,
    runtime,
    ownRunning,
    elapsed,
    connect,
    pending,
    sessionEnabled,
    running,
    attempt,
    stopArmed,
    project,
    setFeatureTab,
    selected,
    setShortcutsOpen,
  } = props;
  return (
    <>
      {ownRuntime &&
        Object.entries(runtime.widgets)
          .filter(([key]) => runtime.widgetPlacements?.[key] === 'belowEditor')
          .map(([key, lines]) => (
            <div className="extension-widget" key={key}>
              {lines.join('\n')}
            </div>
          ))}
      <div className="composer-bottom">
        <div className="run-meta" role="status" aria-live="polite">
          {ownRuntime ? (
            <>
              <Badge status={runtime.status} />
              {ownRunning && (
                <span className="elapsed" aria-hidden="true">
                  {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
                </span>
              )}
              {!runtime.connected && !ownRunning && (
                <button onClick={connect} disabled={pending || !sessionEnabled || running}>
                  <Link2 size={12} />
                  重新连接
                </button>
              )}
            </>
          ) : (
            <button onClick={connect} disabled={!sessionEnabled || pending || running}>
              <Link2 size={12} />
              连接 Pi
            </button>
          )}
        </div>
        {runtime.status === 'stopping' &&
        runtime.stopStartedAt &&
        Date.now() - runtime.stopStartedAt > 15000 ? (
          <button className="danger-link" onClick={() => void attempt(() => api.invoke('forceStop'))}>
            强制结束
          </button>
        ) : stopArmed ? (
          <span className="composer-footnote stop-armed" role="status">
            再按一次 <kbd>Esc</kbd> 停止全部
          </span>
        ) : (
          <span
            className="composer-footnote"
            title={
              project
                ? `Enter 发送 · Shift+Enter 换行 · ↑ 上一条提问 · ${shortcut('/')} 快捷键。Pi 会直接修改项目文件。`
                : `Enter 发送 · Shift+Enter 换行 · ↑ 上一条提问 · ${shortcut('/')} 快捷键。独立对话支持 Pi 工具，工作目录可在 Pi 功能中打开。`
            }
          >
            {ownRuntime && runtime.stats?.tokens ? (
              <ContextMeter
                stats={runtime.stats}
                open={() => setFeatureTab('session')}
                disabled={running || pending || !sessionEnabled}
                compact={() => selected && void attempt(() => api.invoke('compact', selected.id, ''))}
                branch={() =>
                  selected && void attempt(() => api.invoke('branchSession', selected.id, 'clone'))
                }
              />
            ) : (
              <button className="shortcut-link" onClick={() => setShortcutsOpen(true)}>
                Shift + Enter 换行 · <kbd>{modKey}</kbd>
                <kbd>/</kbd> 快捷键
              </button>
            )}
          </span>
        )}
      </div>
    </>
  );
}
