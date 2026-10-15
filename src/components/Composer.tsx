import {
  ArrowUp,
  Square,
  Search,
  X,
  FileText,
  AlertCircle,
  LoaderCircle,
  RefreshCw,
  Paperclip,
  Link2,
  ImagePlus,
} from 'lucide-react';
import { modKey, shortcut, mod } from '../lib/platform';
import { commandSourceNames } from '../lib/commands';
import { IconButton } from './IconButton';
import { Badge } from './Badge';
import { ModelPicker } from './ModelPicker';
import { ContextMeter } from './conversation/Usage';
import { ApprovalSwitch } from './Approval';
const api = window.desktop;
import type { Workbench } from '../hooks/useWorkbench';
import type { AppState } from '../../shared/types';

export function Composer(
  props: Pick<
    Workbench,
    | 'state'
    | 'storage'
    | 'environment'
    | 'runtime'
    | 'error'
    | 'setError'
    | 'setNotice'
    | 'pending'
    | 'draft'
    | 'attachments'
    | 'sendMode'
    | 'setSendMode'
    | 'images'
    | 'setFeatureTab'
    | 'commandIndex'
    | 'setCommandIndex'
    | 'setHideCommands'
    | 'fileQuery'
    | 'setFileQuery'
    | 'fileResults'
    | 'elapsed'
    | 'setShortcutsOpen'
    | 'stopArmed'
    | 'dragging'
    | 'setDragging'
    | 'recall'
    | 'input'
    | 'commandList'
    | 'selected'
    | 'project'
    | 'sessionEnabled'
    | 'ownRuntime'
    | 'running'
    | 'ownRunning'
    | 'sentPrompts'
    | 'commandOptions'
    | 'activeCommand'
    | 'completeCommand'
    | 'attempt'
    | 'persistDraft'
    | 'onDraft'
    | 'addAttachment'
    | 'send'
    | 'acceptImages'
    | 'acceptDrop'
    | 'openSettings'
    | 'connect'
    | 'setModel'
    | 'setThinking'
    | 'inspectFile'
  > & { state: AppState },
) {
  const {
    state,
    storage,
    environment,
    runtime,
    error,
    setError,
    setNotice,
    pending,
    draft,
    attachments,
    sendMode,
    setSendMode,
    images,
    setFeatureTab,
    commandIndex,
    setCommandIndex,
    setHideCommands,
    fileQuery,
    setFileQuery,
    fileResults,
    elapsed,
    setShortcutsOpen,
    stopArmed,
    dragging,
    setDragging,
    recall,
    input,
    commandList,
    selected,
    project,
    sessionEnabled,
    ownRuntime,
    running,
    ownRunning,
    sentPrompts,
    commandOptions,
    activeCommand,
    completeCommand,
    attempt,
    persistDraft,
    onDraft,
    addAttachment,
    send,
    acceptImages,
    acceptDrop,
    openSettings,
    connect,
    setModel,
    setThinking,
    inspectFile,
  } = props;

  return (
    <div className="composer-wrap">
      {error && (
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
      {ownRuntime && runtime.error && runtime.error !== error && (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{runtime.error}</span>
        </div>
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
      <div
        className={'composer ' + (!selected ? 'disabled' : '') + (dragging ? ' dragging' : '')}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (selected) void acceptDrop(Array.from(e.dataTransfer.files));
        }}
      >
        {dragging && (
          <div className="drop-hint" aria-hidden="true">
            {project ? '松开以添加图片或引用项目文件' : '松开以添加图片'}
          </div>
        )}
        {!!images.length && (
          <div className="image-attachments">
            {images.map((img) => (
              <div key={img.id}>
                <img src={`data:${img.mimeType};base64,${img.data}`} alt={img.name} />
                <button
                  aria-label={'移除图片 ' + img.name}
                  onClick={() =>
                    persistDraft(
                      draft,
                      attachments,
                      images.filter((i) => i.id !== img.id),
                    )
                  }
                >
                  ×
                </button>
                <small>{img.name}</small>
              </div>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((a) => (
              <span key={a}>
                <FileText size={13} />
                <button title="预览引用文件" onClick={() => void inspectFile(a, 'files')}>
                  {a}
                </button>
                <IconButton
                  title={`移除引用 ${a}`}
                  onClick={() =>
                    persistDraft(
                      draft,
                      attachments.filter((v) => v !== a),
                    )
                  }
                >
                  <X size={12} />
                </IconButton>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={input}
          aria-label="任务输入"
          placeholder={project ? '描述你想完成的任务，@ 引用文件…' : '给 Pi 发消息…'}
          value={draft}
          disabled={!selected || !storage.writable}
          onChange={(e) => onDraft(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
            if (files.length) {
              e.preventDefault();
              void acceptImages(files);
            }
          }}
          onKeyDown={(e) => {
            if (commandOptions.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setCommandIndex(
                  (i) =>
                    (i + (e.key === 'ArrowDown' ? 1 : -1) + commandOptions.length) % commandOptions.length,
                );
                return;
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing)) {
                const picked = commandOptions[commandIndex];
                const exact = picked && draft === picked.prefix + picked.name;
                if (e.key === 'Tab' || !exact || picked.argumentHint) {
                  e.preventDefault();
                  if (picked) completeCommand(picked);
                  return;
                }
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setHideCommands(true);
                return;
              }
            }
            if (e.key === 'Escape' && fileQuery !== null) {
              e.preventDefault();
              setFileQuery(null);
            }
            if (
              (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
              !e.shiftKey &&
              !e.altKey &&
              !mod(e) &&
              !e.nativeEvent.isComposing &&
              fileQuery === null &&
              sentPrompts.length &&
              (draft === '' || (recall.current >= 0 && draft === sentPrompts.at(-1 - recall.current)))
            ) {
              const next = recall.current + (e.key === 'ArrowUp' ? 1 : -1);
              if (next >= sentPrompts.length || next < -1) return;
              e.preventDefault();
              const value = next < 0 ? '' : sentPrompts.at(-1 - next)!;
              persistDraft(value);
              recall.current = next;
              setHideCommands(true);
              requestAnimationFrame(() => {
                input.current?.setSelectionRange(value.length, value.length);
              });
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (fileQuery !== null && fileResults[0]) void addAttachment(fileResults[0]);
              else void send();
            }
          }}
        />
        {!!commandOptions.length && (
          <div className="command-picker" role="listbox" aria-label="Pi 命令" ref={commandList}>
            {commandOptions.map((c, i) => (
              <div key={c.prefix + c.name} role="presentation">
                {(i === 0 || commandOptions[i - 1].source !== c.source) && (
                  <div className="command-group">{commandSourceNames[c.source] ?? c.source}</div>
                )}
                <button
                  role="option"
                  aria-selected={commandIndex === i}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setCommandIndex(i)}
                  onClick={() => completeCommand(c)}
                >
                  <code>
                    {c.prefix}
                    {c.name}
                  </code>
                  {c.argumentHint && <em>{c.argumentHint}</em>}
                  <span>{c.description || c.source}</span>
                  {c.sourceInfo?.scope === 'project' && <i>项目</i>}
                </button>
              </div>
            ))}
            <small>
              ↑↓ 选择 · Tab / Enter 补全 · 与桌面命令同名的 Pi 命令用 <code>//</code> 调用
            </small>
          </div>
        )}
        {activeCommand && (activeCommand.argumentHint || activeCommand.description) && (
          <div className="command-hint" aria-live="polite">
            <code>
              {activeCommand.prefix}
              {activeCommand.name}
            </code>
            {activeCommand.argumentHint && <em>{activeCommand.argumentHint}</em>}
            <span>{activeCommand.description}</span>
          </div>
        )}
        {fileQuery !== null && (
          <div className="file-picker">
            <div className="file-picker-header">
              <Search size={13} />
              引用项目文件
              <IconButton title="关闭文件选择" onClick={() => setFileQuery(null)}>
                <X size={13} />
              </IconButton>
            </div>
            {fileResults.length ? (
              fileResults.map((f) => (
                <button key={f} onClick={() => void addAttachment(f)}>
                  <FileText size={14} />
                  {f}
                </button>
              ))
            ) : (
              <p>没有匹配的文本文件</p>
            )}
          </div>
        )}
        <div className="composer-toolbar">
          <div>
            <IconButton
              title="添加图片"
              disabled={!selected}
              onClick={() =>
                void attempt(async () => {
                  const picked = await api.invoke('pickImages');
                  if (picked.length) persistDraft(draft, attachments, [...images, ...picked]);
                })
              }
            >
              <ImagePlus size={17} />
            </IconButton>
            {project && (
              <IconButton
                title="引用文件"
                onClick={() => {
                  setFileQuery('');
                  input.current?.focus();
                }}
                disabled={!project}
              >
                <Paperclip size={17} />
              </IconButton>
            )}
            <ApprovalSwitch
              mode={(ownRuntime && runtime.approvalMode) || selected?.approvalMode || 'auto'}
              disabled={!selected || !sessionEnabled}
              change={(mode) =>
                selected &&
                void attempt(async () => {
                  await api.invoke('setApprovalMode', selected.id, mode);
                  setNotice(
                    running
                      ? '审批模式会在本轮结束后生效'
                      : mode === 'auto'
                        ? 'Pi 将直接修改文件和执行命令'
                        : mode === 'confirm'
                          ? '修改文件和执行命令前会先询问你'
                          : '只读：Pi 只能读取和分析，不能修改或执行',
                  );
                })
              }
            />
            <ModelPicker
              runtime={ownRuntime ? runtime : { ...runtime, connected: false }}
              fallback={state.settings.modelId}
              locked={running || pending}
              canConnect={sessionEnabled && !running && !pending}
              connect={() => void connect()}
              pick={(key) => void setModel(key)}
              setThinking={(level) => void setThinking(level)}
              manage={(target) =>
                target === 'providers' ? setFeatureTab('providers') : openSettings('models')
              }
            />
          </div>
          <div>
            {ownRunning ? (
              <select
                aria-label="运行中发送方式"
                value={sendMode}
                onChange={(e) => setSendMode(e.target.value as typeof sendMode)}
              >
                <option value="steer">立即补充</option>
                <option value="followUp">完成后执行</option>
              </select>
            ) : (
              <span className="composer-hint">
                <kbd>↵</kbd> 发送
              </span>
            )}
            {ownRunning && (
              <button
                className={'stop-button' + (stopArmed ? ' armed' : '')}
                title="停止全部（连按两次 Esc）"
                onClick={() => void attempt(() => api.invoke('stop'))}
                disabled={runtime.status === 'stopping'}
              >
                <Square size={12} fill="currentColor" />
                {runtime.status === 'stopping' ? '停止中' : '停止全部'}
              </button>
            )}
            <button
              className="send-button"
              aria-label="发送任务"
              title="发送任务"
              disabled={
                (!draft.trim() && !images.length) ||
                !selected ||
                pending ||
                !sessionEnabled ||
                !environment?.supported ||
                (running && !ownRuntime) ||
                runtime.status === 'stopping'
              }
              onClick={() => void send()}
            >
              {pending ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={19} />}
            </button>
          </div>
        </div>
      </div>
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
              <ContextMeter stats={runtime.stats} open={() => setFeatureTab('session')} />
            ) : (
              <button className="shortcut-link" onClick={() => setShortcutsOpen(true)}>
                Shift + Enter 换行 · <kbd>{modKey}</kbd>
                <kbd>/</kbd> 快捷键
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
