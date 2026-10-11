import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUp,
  Square,
  Plus,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Settings2,
  Search,
  X,
  FileText,
  GitBranch,
  Check,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  Copy,
  PanelRightClose,
  PanelRightOpen,
  Terminal,
  Files,
  GitCompareArrows,
  RefreshCw,
  ExternalLink,
  Download,
  MoreHorizontal,
  MessageSquare,
  Paperclip,
  ArrowDown,
  Sun,
  Moon,
  Monitor,
  Pencil,
  Trash2,
  Import,
  CircleHelp,
  Link2,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  busy,
  emptyRuntime,
  messageText,
  type AppState,
  type DesktopApi,
  type Runtime,
  type Environment,
  type Project,
  type Session,
  type Message,
  type Changes,
  type FileDiff,
  type FilePreview,
  type FileItem,
  type ToolActivity,
  type Settings,
  type ExtensionDialog,
} from '../shared/types';
declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
const api = window.desktop;
const statusNames: Record<string, string> = {
  idle: '就绪',
  starting: '启动中',
  running: '执行中',
  waiting: '等待你的回复',
  retrying: '正在重试',
  compacting: '整理上下文',
  stopping: '停止中',
  completed: '本轮已结束',
  stopped: '已停止',
  error: '执行失败',
  interrupted: '已中断',
};
const time = (value: number) =>
  new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(value);
const readableError = (e: unknown) =>
  String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
function IconButton({
  title,
  onClick,
  children,
  disabled = false,
  className = '',
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={'icon-button ' + className}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={'status ' + status}>
      {busy(status) ? (
        <LoaderCircle className={status === 'waiting' ? '' : 'spin'} size={13} />
      ) : status === 'error' || status === 'interrupted' ? (
        <AlertCircle size={13} />
      ) : (
        <span className="status-dot" />
      )}
      {statusNames[status] || status}
    </span>
  );
}
function Modal({
  title,
  subtitle,
  close,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const focus = ref.current?.querySelector<HTMLElement>('input,button,select,textarea');
    focus?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
      if (e.key === 'Tab') {
        const items = [
          ...ref.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]',
          ),
        ].filter((e) => e.offsetParent !== null);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && i === items.length - 1) {
          e.preventDefault();
          items[0].focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      old?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        className={'modal ' + (wide ? 'wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton title="关闭" onClick={close}>
            <X size={19} />
          </IconButton>
        </header>
        {children}
      </div>
    </div>
  );
}
function CodeBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className="code-block">
      <button
        className="code-copy"
        aria-label="复制代码"
        onClick={() => void api.invoke('copy', ref.current?.innerText ?? '')}
      >
        <Copy size={13} />
        复制
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}
function RichText({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ href, children }) => (
          <button
            className="inline-link"
            onClick={() => href && void api.invoke('openLink', href).catch(() => {})}
          >
            {children}
          </button>
        ),
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        img: ({ alt }) => <span className="muted">[图片：{alt || '附件'}]</span>,
      }}
    >
      {text}
    </Markdown>
  );
}
function UserMessage({ text }: { text: string }) {
  const start = text.indexOf('\n\n<project_file path=');
  if (start < 0) return <RichText text={text} />;
  const blocks = [
    ...text
      .slice(start)
      .matchAll(/\n\n<project_file path=("(?:[^"\\]|\\.)*")>\n([\s\S]*?)\n<\/project_file>/g),
  ];
  if (!blocks.length || blocks.map((b) => b[0]).join('') !== text.slice(start))
    return <RichText text={text} />;
  try {
    return (
      <>
        <RichText text={text.slice(0, start)} />
        {blocks.map((b, i) => (
          <details className="message-attachment" key={i}>
            <summary>
              <FileText size={13} />
              {JSON.parse(b[1])}
              <span>查看引用内容</span>
            </summary>
            <pre>{b[2]}</pre>
          </details>
        ))}
      </>
    );
  } catch {
    return <RichText text={text} />;
  }
}
function ToolCard({
  tool,
  expanded,
  onToggle,
  openFile,
}: {
  tool: ToolActivity;
  expanded: boolean;
  onToggle: (v: boolean) => void;
  openFile: (p: string) => void;
}) {
  const target = String(tool.args.path ?? tool.args.file_path ?? tool.args.command ?? '');
  return (
    <details
      className={'tool-card ' + tool.status}
      open={expanded || tool.status === 'error'}
      onToggle={(e) => onToggle(e.currentTarget.open)}
    >
      <summary>
        <span className="tool-icon">
          {tool.name === 'bash' || tool.name === 'powershell' ? (
            <Terminal size={15} />
          ) : (
            <FileText size={15} />
          )}
        </span>
        <span className="tool-description">
          <strong>
            {(
              {
                read: '读取文件',
                write: '写入文件',
                edit: '修改文件',
                bash: '执行命令',
                powershell: '执行命令',
              } as Record<string, string>
            )[tool.name] || tool.name}
          </strong>
          {target && <code title={target}>{target}</code>}
        </span>
        <span className="tool-result">
          {tool.status === 'running' ? (
            <LoaderCircle size={14} className="spin" />
          ) : tool.status === 'error' ? (
            <AlertCircle size={14} />
          ) : (
            <Check size={14} />
          )}{' '}
          {tool.status === 'running'
            ? '运行中'
            : tool.status === 'error'
              ? '失败'
              : `${((tool.durationMs ?? 0) / 1000).toFixed(1)}s`}
        </span>
        <ChevronDown size={13} />
      </summary>
      <div className="tool-body">
        {Object.keys(tool.args).length > 0 && (
          <pre className="arguments">{JSON.stringify(tool.args, null, 2)}</pre>
        )}
        <pre>{tool.output || '等待输出…'}</pre>
        <div className="tool-actions">
          {Boolean(tool.args.path) && (
            <button onClick={() => openFile(String(tool.args.path))}>
              <FileText size={13} />
              查看文件
            </button>
          )}
          <button onClick={() => void api.invoke('copy', tool.output)}>
            <Copy size={13} />
            复制输出
          </button>
        </div>
      </div>
    </details>
  );
}
function FileTree({
  project,
  directory = '',
  depth = 0,
  onSelect,
}: {
  project: Project;
  directory?: string;
  depth?: number;
  onSelect: (name: string) => void;
}) {
  const [items, setItems] = useState<FileItem[]>([]),
    [open, setOpen] = useState<string[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api
      .invoke('files', project.id, directory)
      .then((v) => {
        if (alive) {
          setItems(v);
          setError('');
        }
      })
      .catch((e) => alive && setError(readableError(e)));
    return () => {
      alive = false;
    };
  }, [project.id, directory]);
  return (
    <div className="file-tree">
      {error && <p className="inline-error">{error}</p>}
      {!items.length && !error && <p className="empty-small">{depth ? '空文件夹' : '没有可显示的文件'}</p>}
      {items.map((item) => (
        <div key={item.path}>
          <button
            className="file-row"
            style={{ paddingLeft: 12 + depth * 14 }}
            onClick={() =>
              item.directory
                ? setOpen((v) =>
                    v.includes(item.path) ? v.filter((x) => x !== item.path) : [...v, item.path],
                  )
                : onSelect(item.path)
            }
          >
            {item.directory ? (
              <>
                <ChevronRight size={12} className={open.includes(item.path) ? 'rotated' : ''} />
                <Folder size={14} />
              </>
            ) : (
              <>
                <span className="tree-indent" />
                <FileText size={14} />
              </>
            )}
            <span>{item.name}</span>
          </button>
          {item.directory && open.includes(item.path) && (
            <FileTree project={project} directory={item.path} depth={depth + 1} onSelect={onSelect} />
          )}
        </div>
      ))}
    </div>
  );
}
function ExtensionPrompt({
  request,
  respond,
}: {
  request: ExtensionDialog;
  respond: (values: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}) {
  const [value, setValue] = useState(request.prefill ?? request.options?.[0] ?? '');
  return (
    <Modal
      title={request.title || 'Pi 需要你的输入'}
      subtitle={request.expiresAt ? '此请求有时间限制，过期后会自动关闭' : '来自当前 Pi 会话'}
      close={() => respond({ cancelled: true })}
    >
      <div className="modal-body">
        {request.message && <p>{request.message}</p>}
        {request.method === 'select' && (
          <div className="choice-list">
            {request.options?.map((o) => (
              <label key={o}>
                <input type="radio" checked={value === o} onChange={() => setValue(o)} />
                {o}
              </label>
            ))}
          </div>
        )}
        {request.method === 'input' && (
          <input
            className="input"
            aria-label="回复内容"
            value={value}
            placeholder={request.placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        {request.method === 'editor' && (
          <textarea
            className="input"
            rows={8}
            aria-label="回复内容"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </div>
      <footer>
        <button onClick={() => respond({ cancelled: true })}>取消</button>
        {request.method === 'confirm' ? (
          <>
            <button onClick={() => respond({ confirmed: false })}>否</button>
            <button className="primary" onClick={() => respond({ confirmed: true })}>
              确认
            </button>
          </>
        ) : (
          <button className="primary" onClick={() => respond({ value })}>
            提交回复
          </button>
        )}
      </footer>
    </Modal>
  );
}

export default function App() {
  const [state, setState] = useState<AppState>(),
    [runtime, setRuntime] = useState<Runtime>(emptyRuntime),
    [environment, setEnvironment] = useState<Environment>(),
    [history, setHistory] = useState<Message[]>([]);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [settingsOpen, setSettingsOpen] = useState(false),
    [settingsTab, setSettingsTab] = useState('environment'),
    [prefs, setPrefs] = useState<Settings>();
  const [pending, setPending] = useState(false),
    [draft, setDraft] = useState(''),
    [attachments, setAttachments] = useState<string[]>([]),
    [sendMode, setSendMode] = useState<'steer' | 'followUp'>('steer');
  const [inspector, setInspector] = useState(true),
    [tab, setTab] = useState<'changes' | 'files' | 'output'>('changes'),
    [changeMode, setChangeMode] = useState<'all' | 'run'>('all'),
    [changes, setChanges] = useState<Changes>(),
    [selectedFile, setSelectedFile] = useState(''),
    [filePreview, setFilePreview] = useState<FilePreview>(),
    [fileDiff, setFileDiff] = useState<FileDiff>(),
    [split, setSplit] = useState(false);
  const [fileQuery, setFileQuery] = useState<string | null>(null),
    [fileResults, setFileResults] = useState<string[]>([]),
    [expanded, setExpanded] = useState<string[]>([]),
    [messageLimit, setMessageLimit] = useState(80),
    [newContent, setNewContent] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false),
    [searchQuery, setSearchQuery] = useState(''),
    [rename, setRename] = useState<{ kind: 'project' | 'session'; id: string; name: string }>(),
    [menuId, setMenuId] = useState('');
  const [testResult, setTestResult] = useState(''),
    [diagnostic, setDiagnostic] = useState(''),
    [elapsed, setElapsed] = useState(0);
  const thread = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    autoScroll = useRef(true),
    previewGeneration = useRef(0),
    selectedRef = useRef<string | undefined>(undefined),
    stateRef = useRef(state),
    runtimeRef = useRef(runtime);
  stateRef.current = state;
  runtimeRef.current = runtime;
  const selected = state?.sessions.find((s) => s.id === state.selectedSessionId),
    project = state?.projects.find((p) => p.id === state.selectedProjectId);
  const ownRuntime = runtime.sessionId === selected?.id,
    running = busy(runtime.status),
    ownRunning = ownRuntime && running;
  const messages = ownRuntime ? runtime.messages : history;
  const visibleMessages = messages.slice(-messageLimit);
  async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      setError(readableError(e));
      return undefined;
    }
  }
  async function action(fn: () => Promise<unknown>) {
    setPending(true);
    await attempt(fn);
    setPending(false);
  }
  useEffect(() => {
    let alive = true;
    const unsubscribe = api.onEvent((event) => {
      if (!alive) return;
      if (event.type === 'state') setState(event.state);
      else setRuntime(event.runtime);
    });
    api
      .invoke('bootstrap')
      .then((v) => {
        if (!alive) return;
        setState(v.state);
        setRuntime(v.runtime);
        setEnvironment(v.environment);
        setPrefs(v.state.settings);
      })
      .catch((e) => setError(readableError(e)));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    const resize = () => {
      if (window.innerWidth < 1200) setInspector(false);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.theme = state.settings.theme;
    document.documentElement.style.setProperty('--font-scale', String(state.settings.fontScale));
    document.documentElement.style.setProperty('--sidebar-width', state.settings.sidebarWidth + 'px');
    document.documentElement.style.setProperty('--inspector-width', state.settings.inspectorWidth + 'px');
  }, [state?.settings]);
  useEffect(() => {
    if (!selected) return;
    setDraft(selected.draft);
    setAttachments(selected.attachments);
  }, [selected?.id, selected?.draft, selected?.attachments.join('|')]);
  useEffect(() => {
    if (!selected) return;
    selectedRef.current = selected.id;
    setSelectedFile('');
    setFilePreview(undefined);
    setFileDiff(undefined);
    setMessageLimit(80);
    setExpanded(selected.expandedTools ?? []);
    autoScroll.current = !(selected.scrollTop && selected.scrollTop > 0);
    api
      .invoke('readHistory', selected.id)
      .then((m) => {
        if (selectedRef.current === selected.id) setHistory(m);
      })
      .catch((e) => setError(readableError(e)));
    setTimeout(() => {
      if (thread.current) thread.current.scrollTop = selected.scrollTop ?? thread.current.scrollHeight;
    }, 80);
  }, [selected?.id]);
  useEffect(() => {
    if (!thread.current) return;
    if (autoScroll.current) {
      thread.current.scrollTop = thread.current.scrollHeight;
      setNewContent(false);
    } else setNewContent(true);
  }, [messages, runtime.tools]);
  useEffect(() => {
    const timer = setInterval(
      () => setElapsed(runtime.startedAt ? Math.floor((Date.now() - runtime.startedAt) / 1000) : 0),
      1000,
    );
    return () => clearInterval(timer);
  }, [runtime.startedAt]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        openSettings();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [state]);
  useEffect(() => {
    if (!project) {
      setChanges(undefined);
      return;
    }
    let alive = true,
      busyPoll = false;
    const load = async () => {
      if (busyPoll) return;
      busyPoll = true;
      try {
        const v = await api.invoke('changes', project.id, changeMode);
        if (alive) setChanges(v);
      } catch (e) {
        if (alive) setError(readableError(e));
      } finally {
        busyPoll = false;
      }
    };
    void load();
    const timer = setInterval(load, ownRunning ? 2500 : 7000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project?.id, changeMode, ownRunning, runtime.status]);
  useEffect(() => {
    if (!project || fileQuery === null) return;
    let alive = true;
    const timer = setTimeout(() => {
      api
        .invoke('searchFiles', project.id, fileQuery)
        .then((v) => alive && setFileResults(v))
        .catch((e) => setError(readableError(e)));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project?.id, fileQuery]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 3500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  const persistDraft = (value: string, files = attachments) => {
    setDraft(value);
    setAttachments(files);
    if (selected) void attempt(() => api.invoke('saveDraft', selected.id, value, files));
  };
  const onDraft = (value: string) => {
    persistDraft(value);
    const match = value.match(/(?:^|\s)@([^\s@]*)$/);
    setFileQuery(match ? match[1] : null);
  };
  async function addAttachment(name: string) {
    if (!project) return;
    const f = await attempt(() => api.invoke('preview', project.id, name));
    if (!f) return;
    if (f.binary || f.size > 256 * 1024) {
      setError('只能引用不超过 256 KiB 的文本文件');
      return;
    }
    const next = [...new Set([...attachments, name])];
    persistDraft(draft.replace(/(^|\s)@[^\s@]*$/, '$1'), next);
    setFileQuery(null);
    input.current?.focus();
  }
  async function send() {
    if (!selected || !draft.trim() || pending) return;
    setError('');
    setPending(true);
    const sent = draft;
    await attempt(() => api.invoke('send', selected.id, sent, attachments, sendMode));
    setPending(false);
    autoScroll.current = true;
    input.current?.focus();
  }
  async function addProject() {
    await action(async () => {
      const p = await api.invoke('addProject');
      if (p) setNotice('项目已添加');
    });
  }
  async function selectSession(s: Session) {
    await attempt(async () => {
      const m = await api.invoke('selectSession', s.id);
      setHistory(m);
    });
    setSearchOpen(false);
  }
  async function createSession() {
    if (project) await attempt(() => api.invoke('newSession', project.id));
    else await addProject();
  }
  function openSettings(tabName = 'environment') {
    setPrefs(stateRef.current?.settings);
    setSettingsTab(tabName);
    setSettingsOpen(true);
  }
  async function detect() {
    const e = await attempt(() => api.invoke('detect'));
    if (e) setEnvironment(e);
  }
  async function saveSettings() {
    if (!prefs) return;
    await action(async () => {
      await api.invoke('saveSettings', prefs);
      await detect();
      setNotice('设置已保存');
    });
  }
  async function connect() {
    if (!selected) return;
    await action(() => api.invoke('connect', selected.id));
  }
  async function chooseSettingPath(kind: 'pi' | 'node' | 'agent' | 'editor') {
    const p = await attempt(() => api.invoke('choosePath', kind));
    if (p)
      setPrefs((prev) =>
        prev
          ? {
              ...prev,
              [({ pi: 'piPath', node: 'nodePath', agent: 'agentDir', editor: 'editorPath' } as const)[kind]]:
                p,
            }
          : prev,
      );
  }
  async function setModel(key: string) {
    const [provider, modelId] = key.split('::');
    setPrefs((prev) => (prev ? { ...prev, provider, modelId, thinking: '' } : prev));
    await action(async () => {
      await api.invoke('saveSettings', { provider, modelId, thinking: '' });
      if (selected) await api.invoke('connect', selected.id);
    });
  }
  async function inspectFile(name: string, mode: typeof tab = tab) {
    if (!project) return;
    const token = ++previewGeneration.current;
    const relative = name.replaceAll('\\', '/').replace(project.path.replaceAll('\\', '/') + '/', '');
    setInspector(true);
    setSelectedFile(relative);
    setTab(mode);
    setFileDiff(undefined);
    setFilePreview(undefined);
    if (mode === 'changes') {
      const diff = await attempt(() => api.invoke('diff', project.id, relative, changeMode));
      if (token === previewGeneration.current && diff) setFileDiff(diff);
    } else {
      const preview = await attempt(() => api.invoke('preview', project.id, relative));
      if (token === previewGeneration.current && preview) setFilePreview(preview);
    }
  }
  const toggleTool = (id: string, open: boolean) => {
    setExpanded((v) => {
      const next = open ? [...new Set([...v, id])] : v.filter((x) => x !== id);
      if (selected) void api.invoke('saveView', selected.id, thread.current?.scrollTop ?? 0, next);
      return next;
    });
  };
  const toolFor = (message: Message): ToolActivity => {
    const observed = ownRuntime && runtime.tools.find((t) => t.id === message.toolCallId);
    if (observed) return observed;
    const call = messages
      .flatMap((m) => (typeof m.content === 'string' ? [] : m.content))
      .find((b) => b.type === 'toolCall' && b.id === message.toolCallId);
    return {
      id: message.toolCallId ?? '',
      name: message.toolName ?? call?.name ?? 'tool',
      args: call?.arguments ?? {},
      status: message.isError ? 'error' : 'done',
      output: messageText(message).split('\n').slice(-200).join('\n'),
      startedAt: message.timestamp ?? 0,
      durationMs: typeof message.durationMs === 'number' ? message.durationMs : undefined,
    };
  };
  if (!state)
    return (
      <main className="loading-screen">
        <div className="brand-mark">π</div>
        <h2>Pi Desktop</h2>
        {error ? (
          <p className="inline-error">{error}</p>
        ) : (
          <p>
            <LoaderCircle size={15} className="spin" /> 正在准备工作区…
          </p>
        )}
      </main>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">π</span>
          <div>
            Pi Desktop<small>本地编程工作区</small>
          </div>
          <IconButton title="搜索项目与会话 Ctrl+K" onClick={() => setSearchOpen(true)}>
            <Search size={17} />
          </IconButton>
        </div>
        <button className="new-session" onClick={createSession}>
          <Plus size={17} />
          新建会话<span>Ctrl N</span>
        </button>
        <div className="section-heading">
          项目
          <IconButton title="添加项目" onClick={addProject}>
            <Plus size={15} />
          </IconButton>
        </div>
        <div className="project-list">
          {state.projects.map((p) => (
            <div className={'project-group ' + (p.id === project?.id ? 'selected' : '')} key={p.id}>
              <button
                className="project-row"
                onClick={() => {
                  const s = state.sessions.find((s) => s.projectId === p.id);
                  if (s) void selectSession(s);
                  else void attempt(() => api.invoke('newSession', p.id));
                }}
              >
                <FolderOpen size={16} />
                <span title={p.path}>{p.name}</span>
                <ChevronDown size={13} />
              </button>
              <IconButton title={`${p.name} 项目操作`} onClick={() => setMenuId(menuId === p.id ? '' : p.id)}>
                <MoreHorizontal size={15} />
              </IconButton>
              {menuId === p.id && (
                <div className="context-menu">
                  <button
                    onClick={() => {
                      setRename({ kind: 'project', id: p.id, name: p.name });
                      setMenuId('');
                    }}
                  >
                    <Pencil size={14} />
                    重命名
                  </button>
                  <button
                    onClick={() => {
                      void attempt(() => api.invoke('importSession', p.id));
                      setMenuId('');
                    }}
                  >
                    <Import size={14} />
                    导入 Pi 会话
                  </button>
                  <button
                    onClick={() => {
                      void attempt(() => api.invoke('removeProject', p.id));
                      setMenuId('');
                    }}
                  >
                    <Trash2 size={14} />
                    移除项目入口
                  </button>
                </div>
              )}
              {p.id === project?.id && (
                <div className="session-list">
                  {state.sessions
                    .filter((s) => s.projectId === p.id)
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .map((s) => (
                      <div className={'session-row ' + (s.id === selected?.id ? 'active' : '')} key={s.id}>
                        <button onClick={() => void selectSession(s)}>
                          <MessageSquare size={14} />
                          <span>{s.title}</span>
                          {s.unread && <i className="unread" />}
                          {s.id === runtime.sessionId && running && (
                            <LoaderCircle size={12} className="spin" />
                          )}
                        </button>
                        <IconButton
                          title={`重命名 ${s.title}`}
                          onClick={() => setRename({ kind: 'session', id: s.id, name: s.title })}
                        >
                          <Pencil size={12} />
                        </IconButton>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
          {!state.projects.length && (
            <p className="sidebar-empty">
              打开一个文件夹
              <br />
              让想法从这里开始。
            </p>
          )}
        </div>
        <div className="sidebar-footer">
          <button onClick={addProject}>
            <FolderOpen size={16} />
            打开项目
          </button>
          <button onClick={() => openSettings()}>
            <Settings2 size={16} />
            设置
            <span className={'connection-dot ' + (environment?.supported ? 'ready' : '')} />
          </button>
          <div className="sidebar-version">
            Pi Desktop <span>v0.1.0</span>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <div className="breadcrumb">
            <Folder size={15} />
            <span title={project?.path}>{project?.name || '工作区'}</span>
            {changes?.branch && (
              <>
                <span className="slash">/</span>
                <GitBranch size={13} />
                <span className="branch">{changes.branch}</span>
              </>
            )}
          </div>
          <div className="header-actions">
            <button className="model-pill" onClick={() => openSettings('models')} title="选择模型">
              <span className="model-icon" />
              {runtime.model?.name || state.settings.modelId || '连接 Pi'}
              <ChevronDown size={12} />
            </button>
            <IconButton
              title={inspector ? '收起文件面板' : '展开文件面板'}
              onClick={() => setInspector((v) => !v)}
            >
              {inspector ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </IconButton>
          </div>
        </header>
        <div className="workspace-columns">
          <section className="conversation">
            <div className="conversation-header">
              <div>
                <h1>{selected?.title || '开始你的下一次构建'}</h1>
                {project && <span className="subtle">{project.path}</span>}
              </div>
              {ownRuntime && (
                <div className="run-meta">
                  <Badge status={runtime.status} />
                  {ownRunning && (
                    <span className="elapsed">
                      {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
                    </span>
                  )}
                </div>
              )}
            </div>
            {running && !ownRuntime && (
              <div className="banner">
                <LoaderCircle size={15} className="spin" />
                另一个会话正在执行
                <button
                  onClick={() => {
                    const s = state.sessions.find((s) => s.id === runtime.sessionId);
                    if (s) void selectSession(s);
                  }}
                >
                  查看任务
                </button>
              </div>
            )}
            {project && !project.trusted && (
              <div className="trust-banner">
                <CircleHelp size={19} />
                <div>
                  <strong>在这个项目中启用 Pi</strong>
                  <p>Pi 可以读取、修改项目文件并执行本机命令。</p>
                </div>
                <button onClick={() => void attempt(() => api.invoke('trustProject', project.id))}>
                  启用项目
                </button>
              </div>
            )}
            <div
              className="thread"
              ref={thread}
              onScroll={() => {
                const el = thread.current;
                if (!el) return;
                autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
                if (autoScroll.current) setNewContent(false);
              }}
              onMouseLeave={() => {
                if (selected && thread.current)
                  void api.invoke('saveView', selected.id, thread.current.scrollTop, expanded);
              }}
            >
              {!messages.length && (
                <div className="welcome">
                  <div className="welcome-symbol">
                    π<span />
                  </div>
                  <span className="eyebrow">你的项目，你的工作方式</span>
                  <h2>{project ? '想一起完成什么？' : '从一个想法，到下一次提交。'}</h2>
                  <p>
                    {project
                      ? '描述目标，交给 Pi 推进。你随时可以查看过程、补充要求和检查变更。'
                      : '连接本地 Pi，在一个清晰的工作区里对话、修改代码与检查结果。'}
                  </p>
                  {!project ? (
                    <div className="welcome-actions">
                      <button className="primary" onClick={addProject}>
                        <FolderOpen size={17} />
                        打开项目
                      </button>
                      <button onClick={() => openSettings()}>
                        <Settings2 size={16} />
                        配置 Pi
                      </button>
                    </div>
                  ) : (
                    <div className="suggestions">
                      {[
                        ['理解项目', '梳理这个项目的结构、运行方式和主要模块。'],
                        ['修复问题', '帮我定位并修复一个问题：'],
                        ['补充测试', '检查项目中缺少测试的关键逻辑，先给出建议。'],
                      ].map(([label, prompt]) => (
                        <button
                          key={label}
                          onClick={() => {
                            persistDraft(prompt);
                            input.current?.focus();
                          }}
                        >
                          <span>{label}</span>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="welcome-note">
                    <span className="status-dot" />
                    代码保留在本地 · 模型使用你的 Pi 配置
                  </div>
                </div>
              )}
              {messages.length > messageLimit && (
                <button className="load-history" onClick={() => setMessageLimit((v) => v + 80)}>
                  加载更早的 {Math.min(80, messages.length - messageLimit)} 条消息
                </button>
              )}
              {visibleMessages.map((m, i) => {
                const key = `${selected?.id}-${i + messages.length - visibleMessages.length}`;
                if (m.role === 'toolResult') {
                  const tool = toolFor(m);
                  return (
                    <ToolCard
                      key={key}
                      tool={tool}
                      expanded={expanded.includes(tool.id)}
                      onToggle={(v) => toggleTool(tool.id, v)}
                      openFile={(p) => void inspectFile(p, 'files')}
                    />
                  );
                }
                if (m.role !== 'user' && m.role !== 'assistant') return null;
                const content = messageText(m);
                if (
                  m.role === 'assistant' &&
                  !content &&
                  !m.errorMessage &&
                  typeof m.content !== 'string' &&
                  !m.content.some((b) => b.type === 'thinking' && b.thinking)
                )
                  return null;
                return (
                  <article key={key} className={'message ' + m.role}>
                    <div className="message-heading">
                      <span className={'avatar ' + m.role}>{m.role === 'user' ? '你' : 'π'}</span>
                      <strong>{m.role === 'user' ? '你' : 'Pi'}</strong>
                      {m.timestamp && <time>{time(m.timestamp)}</time>}
                      <IconButton title="复制消息" onClick={() => void api.invoke('copy', content)}>
                        <Copy size={13} />
                      </IconButton>
                    </div>
                    <div className="message-content">
                      {typeof m.content !== 'string' &&
                        m.content
                          .filter((b) => b.type === 'thinking' && b.thinking)
                          .map((b, index) => (
                            <details className="thinking" key={index}>
                              <summary>思考过程</summary>
                              <pre>{b.thinking}</pre>
                            </details>
                          ))}
                      {content ? (
                        m.role === 'user' ? (
                          <UserMessage text={content} />
                        ) : (
                          <RichText text={content} />
                        )
                      ) : m.role === 'assistant' && ownRunning ? (
                        <span className="stream-cursor" />
                      ) : null}
                      {m.errorMessage && <p className="inline-error">{m.errorMessage}</p>}
                    </div>
                  </article>
                );
              })}
              {ownRuntime &&
                runtime.tools
                  .filter((t) => !messages.some((m) => m.role === 'toolResult' && m.toolCallId === t.id))
                  .map((tool) => (
                    <ToolCard
                      key={tool.id}
                      tool={tool}
                      expanded={expanded.includes(tool.id)}
                      onToggle={(v) => toggleTool(tool.id, v)}
                      openFile={(p) => void inspectFile(p, 'files')}
                    />
                  ))}
              {ownRuntime && runtime.notices.length > 0 && (
                <details className="runtime-notices">
                  <summary>运行记录 · {runtime.notices.length}</summary>
                  {runtime.notices.map((n, i) => (
                    <p key={i}>{n}</p>
                  ))}
                </details>
              )}
            </div>
            {newContent && (
              <button
                className="new-content"
                onClick={() => {
                  autoScroll.current = true;
                  thread.current?.scrollTo({ top: thread.current.scrollHeight });
                  setNewContent(false);
                }}
              >
                <ArrowDown size={14} />
                新内容
              </button>
            )}
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
                    <button onClick={() => void attempt(() => api.invoke('clearQueue'))}>
                      清空并恢复草稿
                    </button>
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
                Object.values(runtime.widgets).map((lines, i) => (
                  <div className="extension-widget" key={i}>
                    {lines.join('\n')}
                  </div>
                ))}
              {ownRuntime && Object.keys(runtime.statuses).length > 0 && (
                <div className="extension-status">{Object.values(runtime.statuses).join(' · ')}</div>
              )}
              <div className={'composer ' + (!selected ? 'disabled' : '')}>
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
                  placeholder={project ? '描述你想完成的任务，@ 引用文件…' : '先打开一个项目…'}
                  value={draft}
                  disabled={!selected}
                  onChange={(e) => onDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setFileQuery(null);
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (fileQuery !== null && fileResults[0]) void addAttachment(fileResults[0]);
                      else void send();
                    }
                  }}
                />
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
                      title="引用文件"
                      onClick={() => {
                        setFileQuery('');
                        input.current?.focus();
                      }}
                      disabled={!project}
                    >
                      <Paperclip size={17} />
                    </IconButton>
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
                        Enter 发送 <span>·</span> Shift Enter 换行
                      </span>
                    )}
                  </div>
                  <div>
                    {ownRunning && (
                      <button
                        className="stop-button"
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
                        !draft.trim() ||
                        !selected ||
                        pending ||
                        !project?.trusted ||
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
              <div className="composer-bottom">
                <span>
                  {ownRuntime && runtime.connected ? (
                    <>
                      <span className="connection-dot ready" />
                      Pi 已连接{runtime.thinking && ' · ' + runtime.thinking}
                    </>
                  ) : (
                    <button onClick={connect} disabled={!selected || !project?.trusted || pending}>
                      <Link2 size={12} />
                      连接 Pi
                    </button>
                  )}
                </span>
                {runtime.status === 'stopping' &&
                runtime.stopStartedAt &&
                Date.now() - runtime.stopStartedAt > 15000 ? (
                  <button className="danger-link" onClick={() => void attempt(() => api.invoke('forceStop'))}>
                    强制结束
                  </button>
                ) : (
                  <span>
                    {ownRuntime && runtime.stats?.tokens
                      ? `${runtime.stats.tokens.toLocaleString()} tokens`
                      : '文件变更会直接写入工作区'}
                  </span>
                )}
              </div>
            </div>
          </section>
          {inspector && (
            <aside className="inspector">
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
                <IconButton title="关闭面板" onClick={() => setInspector(false)}>
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
                          {fileDiff.patch.split('\n').map((l, i) => (
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
                              {(i < 5 && l.startsWith('--- ')
                                ? '--- 原内容'
                                : i < 5 && l.startsWith('+++ ')
                                  ? '+++ 当前内容'
                                  : l) || ' '}
                            </div>
                          ))}
                        </pre>
                      )}
                      <div className="preview-foot">
                        <button onClick={() => void api.invoke('copy', selectedFile)}>
                          <Copy size={12} />
                          路径
                        </button>
                        <button
                          onClick={() => {
                            persistDraft(`请检查 ${selectedFile} 的这处变更：`);
                            input.current?.focus();
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
                          {filePreview.truncated && (
                            <p className="empty-small">预览已截断，文件超过 1 MiB。</p>
                          )}
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
                            <span>
                              {t.status === 'done' ? '完成' : t.status === 'error' ? '失败' : '运行中'}
                            </span>
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
        </div>
      </main>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={16} />
          {notice}
        </div>
      )}
      {searchOpen && (
        <Modal title="快速切换" subtitle="搜索项目和会话 · Ctrl K" close={() => setSearchOpen(false)}>
          <div className="modal-body">
            <div className="search-input">
              <Search size={18} />
              <input
                autoFocus
                aria-label="搜索项目和会话"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="输入项目或会话名称…"
              />
            </div>
            <div className="search-results">
              {state.sessions
                .filter((s) =>
                  (s.title + ' ' + state.projects.find((p) => p.id === s.projectId)?.name)
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()),
                )
                .map((s) => (
                  <button key={s.id} onClick={() => void selectSession(s)}>
                    <MessageSquare size={16} />
                    <span>
                      {s.title}
                      <small>{state.projects.find((p) => p.id === s.projectId)?.name}</small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
            </div>
          </div>
        </Modal>
      )}
      {rename && (
        <Modal
          title={rename.kind === 'project' ? '重命名项目' : '重命名会话'}
          close={() => setRename(undefined)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void attempt(async () => {
                await api.invoke(
                  rename.kind === 'project' ? 'renameProject' : 'renameSession',
                  rename.id,
                  rename.name,
                );
                setRename(undefined);
              });
            }}
          >
            <div className="modal-body">
              <input
                className="input"
                aria-label="新名称"
                maxLength={120}
                value={rename.name}
                onChange={(e) => setRename({ ...rename, name: e.target.value })}
              />
            </div>
            <footer>
              <button type="button" onClick={() => setRename(undefined)}>
                取消
              </button>
              <button className="primary" type="submit">
                保存
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {settingsOpen && prefs && (
        <Modal
          wide
          title="设置"
          subtitle="连接你的 Pi，保留你的工作方式。"
          close={() => setSettingsOpen(false)}
        >
          <div className="settings-layout">
            <nav>
              {[
                ['environment', '运行环境', Terminal],
                ['models', '模型连接', Link2],
                ['appearance', '外观与编辑器', Monitor],
                ['diagnostic', '诊断', CircleHelp],
              ].map(([key, label, Icon]) => (
                <button
                  key={String(key)}
                  className={settingsTab === key ? 'active' : ''}
                  onClick={() => setSettingsTab(String(key))}
                >
                  {typeof Icon !== 'string' && <Icon size={16} />}
                  <span>{String(label)}</span>
                </button>
              ))}
            </nav>
            <div className="settings-content">
              {error && (
                <div className="error-banner" role="alert">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                  <IconButton title="关闭设置错误" onClick={() => setError('')}>
                    <X size={14} />
                  </IconButton>
                </div>
              )}
              {settingsTab === 'environment' && (
                <>
                  <div className="settings-heading">
                    <h3>本机运行环境</h3>
                    <button disabled={pending} onClick={() => void action(detect)}>
                      <RefreshCw size={14} />
                      重新检测
                    </button>
                  </div>
                  <div className="environment-status">
                    <div>
                      <span>Pi 版本</span>
                      <strong>{environment?.version || '未检测到'}</strong>
                      {environment?.supported ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    </div>
                    <div>
                      <span>Git</span>
                      <strong>{environment?.git ? '已找到' : '未找到'}</strong>
                    </div>
                    <div>
                      <span>Git Bash</span>
                      <strong>{environment?.bash ? '已找到' : '未找到'}</strong>
                    </div>
                  </div>
                  {environment?.errors.map((e) => (
                    <p className="environment-note" key={e}>
                      {e}
                    </p>
                  ))}
                  <label className="field-label">
                    Pi 入口 <small>留空自动检测，支持 cli.js 与官方可执行文件</small>
                  </label>
                  <div className="path-field">
                    <input
                      aria-label="Pi 入口"
                      value={prefs.piPath}
                      placeholder={environment?.piPath || '自动检测'}
                      onChange={(e) => setPrefs({ ...prefs, piPath: e.target.value })}
                    />
                    <button onClick={() => void chooseSettingPath('pi')}>选择</button>
                  </div>
                  <label className="field-label">
                    Node.js 入口 <small>用于启动 JavaScript 版 Pi</small>
                  </label>
                  <div className="path-field">
                    <input
                      aria-label="Node.js 入口"
                      value={prefs.nodePath}
                      placeholder={environment?.nodePath || '自动检测'}
                      onChange={(e) => setPrefs({ ...prefs, nodePath: e.target.value })}
                    />
                    <button onClick={() => void chooseSettingPath('node')}>选择</button>
                  </div>
                  <label className="field-label">
                    Pi 配置目录 <small>复用已有模型、凭据和扩展</small>
                  </label>
                  <div className="path-field">
                    <input
                      aria-label="Pi 配置目录"
                      value={prefs.agentDir}
                      placeholder={environment?.agentDir}
                      onChange={(e) => setPrefs({ ...prefs, agentDir: e.target.value })}
                    />
                    <button onClick={() => void chooseSettingPath('agent')}>选择</button>
                  </div>
                  <details className="setup-guide">
                    <summary>还没有安装 Pi？</summary>
                    <p>在终端安装固定版本，再回到这里重新检测：</p>
                    <CodeBlock>
                      npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.1.0
                    </CodeBlock>
                    <button
                      className="text-button"
                      onClick={() => void api.invoke('openLink', 'https://pi.dev/docs/latest')}
                    >
                      查看官方安装说明 <ExternalLink size={13} />
                    </button>
                  </details>
                </>
              )}
              {settingsTab === 'models' && (
                <>
                  <div className="settings-heading">
                    <h3>模型与凭据</h3>
                    <button disabled={!selected || !project?.trusted || pending || running} onClick={connect}>
                      <Link2 size={14} />
                      连接 Pi
                    </button>
                  </div>
                  <p className="settings-copy">使用 Pi 已保存的凭据。模型请求直接发往你配置的服务商。</p>
                  <div className="credential-status">
                    <span className={'connection-dot ' + (environment?.authExists ? 'ready' : '')} />
                    {environment?.authExists
                      ? '已发现凭据配置，连接状态以实际请求为准'
                      : '尚未发现 Pi 凭据文件；也可以使用环境变量配置'}
                  </div>
                  {!selected && (
                    <p className="environment-note">请先打开一个项目，再连接 Pi 获取模型列表。</p>
                  )}
                  <label className="field-label">当前模型</label>
                  <select
                    className="input"
                    aria-label="选择模型"
                    disabled={running || pending || !runtime.models.length}
                    value={runtime.model ? `${runtime.model.provider}::${runtime.model.id}` : ''}
                    onChange={(e) => void setModel(e.target.value)}
                  >
                    <option value="" disabled>
                      {runtime.models.length ? '选择模型' : '连接 Pi 后读取可用模型'}
                    </option>
                    {runtime.models.map((m) => (
                      <option key={m.provider + '::' + m.id} value={m.provider + '::' + m.id}>
                        {m.provider} / {m.name || m.id}
                      </option>
                    ))}
                  </select>
                  <label className="field-label">推理级别</label>
                  <select
                    className="input"
                    aria-label="推理级别"
                    disabled={!runtime.thinkingLevels.length || running || pending}
                    value={runtime.thinking || ''}
                    onChange={(e) =>
                      void action(async () => {
                        const thinking = e.target.value;
                        setPrefs((prev) => (prev ? { ...prev, thinking } : prev));
                        await api.invoke('saveSettings', { thinking });
                        if (selected) await api.invoke('connect', selected.id);
                      })
                    }
                  >
                    {runtime.thinkingLevels.length ? (
                      runtime.thinkingLevels.map((v) => <option key={v}>{v}</option>)
                    ) : (
                      <option>当前模型未提供可选级别</option>
                    )}
                  </select>
                  <div className="connection-test">
                    <button
                      disabled={!runtime.model || pending || running || !selected}
                      onClick={() =>
                        void action(async () => {
                          setTestResult('正在连接…');
                          try {
                            const r = await api.invoke('testConnection', selected!.id);
                            setTestResult(`连接成功 · ${r.elapsed} ms · ${r.text.slice(0, 100)}`);
                          } catch (e) {
                            setTestResult('连接失败：' + readableError(e));
                          }
                        })
                      }
                    >
                      <RefreshCw size={15} />
                      测试模型连接
                    </button>
                    <small>将发送一次简短请求，可能产生模型费用。</small>
                  </div>
                  {testResult && <p className="test-result">{testResult}</p>}
                  <details className="setup-guide" open={!environment?.authExists}>
                    <summary>登录或配置模型</summary>
                    <p>在终端启动 Pi，输入 /login 完成登录，再回到本窗口重新连接。</p>
                    <CodeBlock>
                      {environment?.piPath && /\.m?js$/i.test(environment.piPath)
                        ? `& '${(environment.nodePath || 'node').replaceAll("'", "''")}' '${environment.piPath.replaceAll("'", "''")}'`
                        : 'pi'}
                    </CodeBlock>
                    <p>自定义接口可使用 Pi 配置目录中的 models.json。此界面不会复制或显示 API Key。</p>
                    <button
                      className="text-button"
                      onClick={() =>
                        void api.invoke(
                          'openLink',
                          'https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/providers.md',
                        )
                      }
                    >
                      查看凭据配置说明 <ExternalLink size={13} />
                    </button>
                  </details>
                </>
              )}
              {settingsTab === 'appearance' && (
                <>
                  <h3>界面外观</h3>
                  <label className="field-label">主题</label>
                  <div className="theme-options">
                    {(
                      [
                        ['light', '浅色', Sun],
                        ['dark', '深色', Moon],
                        ['system', '跟随系统', Monitor],
                      ] as const
                    ).map(([key, label, Icon]) => (
                      <button
                        className={prefs.theme === key ? 'active' : ''}
                        key={key}
                        onClick={() => {
                          setPrefs({ ...prefs, theme: key });
                          void attempt(() => api.invoke('saveSettings', { theme: key }));
                        }}
                      >
                        <Icon size={23} />
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="field-label">
                    字号比例 <span>{Math.round(prefs.fontScale * 100)}%</span>
                  </label>
                  <input
                    type="range"
                    aria-label="字号比例"
                    min="1"
                    max="2"
                    step="0.1"
                    value={prefs.fontScale}
                    onChange={(e) => {
                      const fontScale = Number(e.target.value);
                      setPrefs({ ...prefs, fontScale });
                      void api.invoke('saveSettings', { fontScale });
                    }}
                  />
                  <label className="field-label">
                    项目侧栏宽度 <span>{prefs.sidebarWidth} px</span>
                  </label>
                  <input
                    type="range"
                    aria-label="侧栏宽度"
                    min="180"
                    max="360"
                    step="10"
                    value={prefs.sidebarWidth}
                    onChange={(e) => {
                      const sidebarWidth = Number(e.target.value);
                      setPrefs({ ...prefs, sidebarWidth });
                      void api.invoke('saveSettings', { sidebarWidth });
                    }}
                  />
                  <label className="field-label">
                    文件面板宽度 <span>{prefs.inspectorWidth} px</span>
                  </label>
                  <input
                    type="range"
                    aria-label="面板宽度"
                    min="300"
                    max="720"
                    step="10"
                    value={prefs.inspectorWidth}
                    onChange={(e) => {
                      const inspectorWidth = Number(e.target.value);
                      setPrefs({ ...prefs, inspectorWidth });
                      void api.invoke('saveSettings', { inspectorWidth });
                    }}
                  />
                  <label className="field-label">
                    代码编辑器 <small>留空时在资源管理器中定位文件</small>
                  </label>
                  <div className="path-field">
                    <input
                      aria-label="代码编辑器"
                      value={prefs.editorPath}
                      onChange={(e) => setPrefs({ ...prefs, editorPath: e.target.value })}
                    />
                    <button onClick={() => void chooseSettingPath('editor')}>选择</button>
                  </div>
                </>
              )}
              {settingsTab === 'diagnostic' && (
                <>
                  <h3>诊断与本地数据</h3>
                  <p className="settings-copy">
                    诊断仅包含环境路径、状态和已过滤的错误，不包含对话正文。导出前请检查下方内容。
                  </p>
                  <div className="button-row">
                    <button
                      onClick={() => void attempt(async () => setDiagnostic(await api.invoke('diagnostics')))}
                    >
                      <RefreshCw size={14} />
                      生成预览
                    </button>
                    <button
                      disabled={!diagnostic}
                      onClick={() => void attempt(() => api.invoke('exportDiagnostics'))}
                    >
                      <Download size={14} />
                      导出诊断
                    </button>
                  </div>
                  {diagnostic && <pre className="diagnostic-preview">{diagnostic}</pre>}
                  <button
                    className="text-button"
                    onClick={() => void attempt(() => api.invoke('revealData'))}
                  >
                    <FolderOpen size={15} />
                    打开应用数据目录
                  </button>
                  <p className="settings-copy">
                    运行差异基线保留 7 天，总计不超过 200 MiB。清理基线不影响项目与 Pi 会话文件。
                  </p>
                </>
              )}
            </div>
          </div>
          <footer>
            <span className="settings-footer-note">
              {running ? '任务执行中，运行环境和模型暂不可修改' : '设置保存在本机'}
            </span>
            <button onClick={() => setSettingsOpen(false)}>关闭</button>
            <button className="primary" disabled={pending || running} onClick={saveSettings}>
              {pending ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}保存设置
            </button>
          </footer>
        </Modal>
      )}
      {runtime.dialogs[0] && (
        <ExtensionPrompt
          key={runtime.dialogs[0].id}
          request={runtime.dialogs[0]}
          respond={(v) => void attempt(() => api.invoke('respond', runtime.dialogs[0].id, v))}
        />
      )}
    </div>
  );
}
