import {
  FolderOpen,
  X,
  GitBranch,
  CheckCircle2,
  LoaderCircle,
  Copy,
  Terminal,
  Files,
  GitCompareArrows,
  RefreshCw,
  ExternalLink,
  Download,
  Paperclip,
  Undo2,
} from 'lucide-react';
import { IconButton } from './IconButton';
import { FileTree } from './FileTree';
const api = window.desktop;
import type { Workbench } from '../hooks/useWorkbench';
import type { AppState } from '../../shared/types';

export function Inspector(
  props: Pick<
    Workbench,
    | 'runtime'
    | 'pending'
    | 'compact'
    | 'inspector'
    | 'setInspector'
    | 'tab'
    | 'setTab'
    | 'changeMode'
    | 'setChangeMode'
    | 'changes'
    | 'setChanges'
    | 'selectedFile'
    | 'setSelectedFile'
    | 'filePreview'
    | 'setFilePreview'
    | 'fileDiff'
    | 'setFileDiff'
    | 'split'
    | 'setSplit'
    | 'inspectorPanel'
    | 'project'
    | 'ownRunning'
    | 'diffLines'
    | 'attempt'
    | 'persistDraft'
    | 'focusComposer'
    | 'addAttachment'
    | 'copy'
    | 'revert'
    | 'inspectFile'
  > & { state: AppState },
) {
  const {
    runtime,
    pending,
    compact,
    inspector,
    setInspector,
    tab,
    setTab,
    changeMode,
    setChangeMode,
    changes,
    setChanges,
    selectedFile,
    setSelectedFile,
    filePreview,
    setFilePreview,
    fileDiff,
    setFileDiff,
    split,
    setSplit,
    inspectorPanel,
    project,
    ownRunning,
    diffLines,
    attempt,
    persistDraft,
    focusComposer,
    addAttachment,
    copy,
    revert,
    inspectFile,
  } = props;

  return (
    <>
      {inspector && (
        <button
          className="inspector-scrim"
          tabIndex={-1}
          aria-label="关闭工作区面板"
          onClick={() => setInspector(false)}
        />
      )}
      {inspector && (
        <aside
          ref={inspectorPanel}
          className="inspector"
          id="workspace-inspector"
          aria-label="工作区检查"
          role={compact ? 'dialog' : undefined}
          aria-modal={compact || undefined}
        >
          <div className="inspector-tabs">
            {(
              [
                ['changes', GitCompareArrows, '变更'],
                ['files', Files, '文件'],
                ['output', Terminal, '输出'],
              ] as const
            ).map(([key, Icon, label]) => (
              <button
                key={key}
                aria-pressed={tab === key}
                className={tab === key ? 'active' : ''}
                onClick={() => {
                  setTab(key);
                  setSelectedFile('');
                  setFilePreview(undefined);
                  setFileDiff(undefined);
                }}
              >
                <Icon size={15} />
                {label}
                {key === 'changes' && !!changes?.files.length && (
                  <span className="count">{changes.files.length}</span>
                )}
              </button>
            ))}
            <IconButton
              title="关闭面板"
              onClick={() => {
                setInspector(false);
                if (!compact) document.querySelector<HTMLButtonElement>('.workspace-toggle')?.focus();
              }}
            >
              <X size={14} />
            </IconButton>
          </div>
          {!project ? (
            <div className="inspector-empty">
              <FolderOpen size={28} />
              <p>
                打开项目后
                <br />
                在这里查看文件与变更
              </p>
            </div>
          ) : tab === 'changes' ? (
            <>
              <div className="change-controls">
                <select
                  aria-label="变更范围"
                  value={changeMode}
                  onChange={(e) => {
                    setChangeMode(e.target.value as 'all' | 'run');
                    setSelectedFile('');
                    setFileDiff(undefined);
                  }}
                >
                  <option value="all">全部未提交变更</option>
                  <option value="run">运行期间变更</option>
                </select>
                <IconButton
                  title="刷新变更"
                  onClick={() =>
                    void attempt(async () => {
                      setChanges(await api.invoke('changes', project.id, changeMode));
                      if (selectedFile) await inspectFile(selectedFile, 'changes');
                    })
                  }
                >
                  <RefreshCw size={14} />
                </IconButton>
                {changeMode === 'run' && changes?.baselineAvailable && !!changes.files.length && (
                  <button
                    className="revert-all"
                    disabled={ownRunning || pending}
                    title={ownRunning ? '执行中不能撤销' : '把本轮修改过的文件恢复到任务开始前'}
                    onClick={() => void revert(null)}
                  >
                    <Undo2 size={13} />
                    撤销本轮
                  </button>
                )}
              </div>
              {!changes ? (
                <div className="inspector-empty">
                  <LoaderCircle size={23} className="spin" />
                  <p>正在读取工作区状态…</p>
                </div>
              ) : !changes.git ? (
                <div className="inspector-empty">
                  <GitBranch size={27} />
                  <h3>当前目录没有 Git 仓库</h3>
                  <p>仍然可以与 Pi 对话和浏览文件。</p>
                </div>
              ) : changeMode === 'run' && !changes.baselineAvailable ? (
                <div className="inspector-empty">
                  <GitCompareArrows size={27} />
                  <h3>{changes.baselineInvalid ? 'Git 基线已变化' : '还没有运行基线'}</h3>
                  <p>
                    {changes.baselineInvalid
                      ? '分支或提交已改变，请查看全部未提交变更。'
                      : '发送第一条任务后，会记录运行开始时的文件内容。'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="change-list">
                    {changes.files.length === 0 ? (
                      <div className="clean-state">
                        <CheckCircle2 size={25} />
                        <h3>工作区干净</h3>
                        <p>文件有变化时，会显示在这里。</p>
                      </div>
                    ) : (
                      changes.files.map((f) => (
                        <button
                          key={f.path}
                          className={'change-row ' + (selectedFile === f.path ? 'active' : '')}
                          onClick={() => void inspectFile(f.path, 'changes')}
                        >
                          <span className={'change-symbol ' + f.status}>
                            {f.status === '新增' ? '+' : f.status === '删除' ? '−' : 'M'}
                          </span>
                          <span title={f.path}>
                            {f.path}
                            <small>
                              {f.existedBeforeRun ? '运行前已修改' : f.staged ? '已暂存' : f.status}
                            </small>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                  {changes.omitted.length > 0 && (
                    <details className="omitted">
                      <summary>{changes.omitted.length} 个文件未纳入运行基线</summary>
                      {changes.omitted.map((p) => (
                        <div key={p}>{p}</div>
                      ))}
                    </details>
                  )}
                  {changes.error && <p className="inline-error">{changes.error}</p>}
                </>
              )}
              {selectedFile && (
                <div className="file-preview">
                  <div className="preview-toolbar">
                    <strong title={selectedFile}>{selectedFile.split('/').at(-1)}</strong>
                    <button onClick={() => setSplit((v) => !v)}>{split ? '统一' : '对照'}</button>
                    <IconButton
                      title="在编辑器中打开或定位文件"
                      onClick={() => void attempt(() => api.invoke('openFile', project.id, selectedFile))}
                    >
                      <ExternalLink size={14} />
                    </IconButton>
                  </div>
                  {!fileDiff ? (
                    <p className="empty-small">加载差异…</p>
                  ) : fileDiff.unavailable ? (
                    <p className="empty-small">{fileDiff.unavailable}</p>
                  ) : split ? (
                    <div className="split-diff">
                      <pre>{fileDiff.before}</pre>
                      <pre>{fileDiff.after}</pre>
                    </div>
                  ) : (
                    <pre className="diff-lines">
                      {diffLines.map((l, i) => (
                        <div
                          key={i}
                          className={
                            l.startsWith('+')
                              ? 'added'
                              : l.startsWith('-')
                                ? 'removed'
                                : l.startsWith('@@')
                                  ? 'hunk'
                                  : ''
                          }
                        >
                          {l || ' '}
                        </div>
                      ))}
                    </pre>
                  )}
                  <div className="preview-foot">
                    <button onClick={() => void copy(selectedFile, '路径已复制')}>
                      <Copy size={12} />
                      路径
                    </button>
                    {changeMode === 'run' && changes?.files.some((f) => f.path === selectedFile) && (
                      <button
                        className="danger"
                        disabled={ownRunning || pending}
                        onClick={() => void revert([selectedFile])}
                      >
                        <Undo2 size={12} />
                        撤销此文件
                      </button>
                    )}
                    <button
                      onClick={() => {
                        persistDraft(`请检查 ${selectedFile} 的这处变更：`);
                        focusComposer();
                      }}
                    >
                      继续提问
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : tab === 'files' ? (
            <>
              <div className="file-tree-scroll">
                <FileTree project={project} onSelect={(p) => void inspectFile(p, 'files')} />
              </div>
              {selectedFile && (
                <div className="file-preview">
                  <div className="preview-toolbar">
                    <strong title={selectedFile}>{selectedFile.split('/').at(-1)}</strong>
                    <IconButton title="引用此文件" onClick={() => void addAttachment(selectedFile)}>
                      <Paperclip size={14} />
                    </IconButton>
                    <IconButton
                      title="在编辑器中打开或定位文件"
                      onClick={() => void attempt(() => api.invoke('openFile', project.id, selectedFile))}
                    >
                      <ExternalLink size={14} />
                    </IconButton>
                  </div>
                  {!filePreview ? (
                    <p className="empty-small">读取文件…</p>
                  ) : filePreview.binary ? (
                    <p className="empty-small">这是二进制文件，请在外部应用中打开。</p>
                  ) : (
                    <>
                      <pre className="source-preview">{filePreview.text}</pre>
                      {filePreview.truncated && <p className="empty-small">预览已截断，文件超过 1 MiB。</p>}
                    </>
                  )}
                  <div className="preview-foot">
                    <span>{filePreview && (filePreview.size / 1024).toFixed(1) + ' KiB'}</span>
                    <button onClick={() => void api.invoke('copy', selectedFile)}>
                      <Copy size={12} />
                      复制路径
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="output-header">
                <span>当前连接会话的工具输出</span>
                <IconButton
                  title="导出已接收的工具输出"
                  onClick={() => void attempt(() => api.invoke('exportOutput'))}
                >
                  <Download size={15} />
                </IconButton>
              </div>
              <div className="output-scroll">
                {runtime.tools.length ? (
                  runtime.tools.map((t) => (
                    <section key={t.id}>
                      <h4>
                        {t.name}
                        <span>{t.status === 'done' ? '完成' : t.status === 'error' ? '失败' : '运行中'}</span>
                      </h4>
                      <pre>{t.output || '等待输出…'}</pre>
                    </section>
                  ))
                ) : (
                  <div className="inspector-empty">
                    <Terminal size={27} />
                    <p>
                      执行命令后
                      <br />
                      在这里查看输出
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      )}
    </>
  );
}
