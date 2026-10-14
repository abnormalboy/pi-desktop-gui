import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
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
  PanelLeftClose,
  PanelLeftOpen,
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
  ImagePlus,
  Command,
  Pin,
  PinOff,
  History,
  TextSearch,
  Info,
  TriangleAlert,
  Gauge,
  Undo2,
} from 'lucide-react';
import { PiFeatures, builtinCommands } from './PiFeatures';
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
  type ImageAttachment,
  type MessageAction,
  type PiCommand,
  type PiSessionInfo,
  type SessionMatch,
} from '../shared/types';
declare global {
  const __APP_VERSION__: string;
  interface Window {
    desktop: DesktopApi;
  }
}
const api = window.desktop;
export const platform = {
  mac: api.platform === 'darwin',
  trash: api.platform === 'win32' ? '回收站' : '废纸篓',
  fileManager: api.platform === 'win32' ? '资源管理器' : api.platform === 'darwin' ? '访达' : '文件管理器',
};
export const modKey = platform.mac ? '⌘' : 'Ctrl';
export const shortcut = (key: string) => (platform.mac ? '⌘' + key : 'Ctrl+' + key);
const mod = (e: { ctrlKey: boolean; metaKey: boolean }) => (platform.mac ? e.metaKey : e.ctrlKey);
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
const commandOrder = ['desktop', 'prompt', 'skill', 'extension'];
const commandSourceNames: Record<string, string> = {
  desktop: '桌面命令',
  prompt: '提示词模板',
  skill: 'Skills',
  extension: '扩展命令',
};
const relativeTime = (value: number) => {
  const minutes = Math.round((Date.now() - value) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时前`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / 1440)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(value);
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
  expanded,
  controls,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button
      className={'icon-button ' + className}
      title={title}
      aria-label={title}
      aria-expanded={expanded}
      aria-controls={controls}
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
function useFocusScope(
  ref: RefObject<HTMLDivElement | HTMLElement | null>,
  active: boolean,
  close: () => void,
) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active || !ref.current) return;
    const old = document.activeElement as HTMLElement;
    const selector =
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary';
    ref.current.querySelector<HTMLElement>(selector)?.focus();
    const key = (e: KeyboardEvent) => {
      if ([...document.querySelectorAll('[role="dialog"]')].at(-1) !== ref.current) return;
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const items = [...ref.current!.querySelectorAll<HTMLElement>(selector)].filter(
          (e) => e.getClientRects().length,
        );
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && (i < 0 || i === items.length - 1)) {
          e.preventDefault();
          items[0].focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (old?.isConnected) old.focus();
    };
  }, [active, ref]);
}
export function Modal({
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
  useFocusScope(ref, true, close);
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
        img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />,
      }}
    >
      {text}
    </Markdown>
  );
}
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [loaded, setLoaded] = useState(false);
  if (src && /^data:image\/(png|jpeg|gif|webp);base64,/.test(src))
    return <img className="message-image" src={src} alt={alt || '图片'} />;
  if (src && /^https?:\/\//.test(src))
    return loaded ? (
      <img className="message-image" src={src} alt={alt || '图片'} />
    ) : (
      <button onClick={() => setLoaded(true)}>加载图片：{alt || src}</button>
    );
  return <span className="muted">[图片：{alt || '附件'}]</span>;
}
function MessageImages({ message }: { message: Message }) {
  return (
    <div className="message-images">
      {typeof message.content !== 'string' &&
        message.content
          .filter(
            (b) =>
              b.type === 'image' &&
              typeof b.data === 'string' &&
              ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(b.mimeType)),
          )
          .map((b, i) => (
            <button
              key={i}
              className="image-preview"
              onClick={(e) => e.currentTarget.classList.toggle('expanded-image')}
            >
              <img
                className="message-image"
                src={`data:${b.mimeType};base64,${b.data}`}
                alt={`附件图片 ${i + 1}`}
              />
            </button>
          ))}
    </div>
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
const patchLines = (patch: string) => {
  const all = patch.split('\n');
  const start = all.findIndex((l) => l.startsWith('@@'));
  return (start < 0 ? all : all.slice(start)).filter((l) => !l.startsWith('\\ No newline'));
};
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
  const shell = tool.name === 'bash' || tool.name === 'powershell';
  const exitCode = shell
    ? /(?:Command exited with code|exit code:?)\s*(-?\d+)/i.exec(tool.output)?.[1]
    : undefined;
  const lines = tool.patch ? patchLines(tool.patch) : [];
  const added = lines.filter((l) => l.startsWith('+')).length,
    removed = lines.filter((l) => l.startsWith('-')).length;
  const written =
    tool.name === 'write' && typeof tool.args.content === 'string'
      ? String(tool.args.content).split('\n').length
      : undefined;
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
          {tool.patch && (
            <span className="line-delta">
              <ins>+{added}</ins>
              <del>−{removed}</del>
            </span>
          )}
          {written !== undefined && tool.status === 'done' && !tool.patch && (
            <span className="line-delta">
              <ins>{written} 行</ins>
            </span>
          )}
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
              ? exitCode
                ? `退出码 ${exitCode}`
                : '失败'
              : `${((tool.durationMs ?? 0) / 1000).toFixed(1)}s`}
        </span>
        <ChevronDown size={13} />
      </summary>
      <div className="tool-body">
        {tool.patch ? (
          <pre className="diff-lines inline-diff">
            {lines.map((l, i) => (
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
        ) : (
          <>
            {Object.keys(tool.args).length > 0 && (
              <pre className="arguments">
                {shell ? String(tool.args.command ?? '') : JSON.stringify(tool.args, null, 2)}
              </pre>
            )}
            <pre>{tool.output || '等待输出…'}</pre>
          </>
        )}
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
const contextLabel = (n?: number) =>
  !n ? '' : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`;
function ModelPicker({
  runtime,
  fallback,
  locked,
  canConnect,
  connect,
  pick,
  setThinking,
  manage,
}: {
  runtime: Runtime;
  fallback: string;
  locked: boolean;
  canConnect: boolean;
  connect: () => void;
  pick: (key: string) => void;
  setThinking: (level: string) => void;
  manage: (target: 'providers' | 'settings') => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [index, setIndex] = useState(0);
  const panel = useRef<HTMLDivElement>(null),
    list = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useFocusScope(panel, open, close);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!panel.current?.parentElement?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, index]);
  const current = runtime.model ? `${runtime.model.provider}::${runtime.model.id}` : '';
  const q = query.trim().toLowerCase();
  const models = runtime.models.filter((m) => `${m.provider} ${m.name} ${m.id}`.toLowerCase().includes(q));
  const providers = [...new Set(models.map((m) => m.provider))];
  const choose = (key: string) => {
    if (key !== current) pick(key);
    close();
  };
  return (
    <div className="model-picker-anchor">
      <button
        className={'model-pill' + (open ? ' open' : '')}
        onClick={() => {
          setQuery('');
          setIndex(
            Math.max(
              0,
              runtime.models.findIndex((m) => `${m.provider}::${m.id}` === current),
            ),
          );
          setOpen((v) => !v);
          if (!open && canConnect && !runtime.connected) connect();
        }}
        title="选择模型"
        aria-label="选择模型"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>{runtime.model?.name || fallback || '选择模型'}</span>
        {runtime.thinking && runtime.thinking !== 'off' && <em>{runtime.thinking}</em>}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div ref={panel} className="model-picker" role="dialog" aria-label="模型与推理级别">
          <div className="model-search">
            <Search size={14} />
            <input
              aria-label="搜索模型"
              placeholder="搜索模型或供应商"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (models.length)
                    setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + models.length) % models.length);
                }
                if (e.key === 'Enter' && models[index] && !locked) {
                  e.preventDefault();
                  choose(`${models[index].provider}::${models[index].id}`);
                }
              }}
            />
          </div>
          <div className="model-list" role="listbox" aria-label="可用模型" ref={list}>
            {!runtime.models.length ? (
              <div className="model-empty">
                {runtime.status === 'starting' ? (
                  <>
                    <LoaderCircle size={16} className="spin" />
                    正在连接 Pi 读取模型…
                  </>
                ) : !runtime.connected ? (
                  <>
                    <p>
                      {runtime.error ? `连接 Pi 失败：${runtime.error}` : '尚未连接 Pi，连接后可读取模型。'}
                    </p>
                    <button disabled={!canConnect} onClick={connect}>
                      重新连接 Pi
                    </button>
                  </>
                ) : (
                  <>
                    <p>还没有可用模型。登录供应商或配置自定义模型后再试。</p>
                    <button onClick={() => manage('providers')}>管理供应商与登录</button>
                  </>
                )}
              </div>
            ) : !models.length ? (
              <p className="model-empty">没有匹配“{query}”的模型</p>
            ) : (
              providers.map((provider) => (
                <div key={provider} role="group" aria-label={provider}>
                  {providers.length > 1 || q ? <div className="model-group">{provider}</div> : null}
                  {models
                    .filter((m) => m.provider === provider)
                    .map((m) => {
                      const key = `${m.provider}::${m.id}`,
                        i = models.indexOf(m);
                      return (
                        <button
                          key={key}
                          role="option"
                          aria-selected={i === index}
                          aria-current={key === current || undefined}
                          disabled={locked}
                          onMouseEnter={() => setIndex(i)}
                          onClick={() => choose(key)}
                        >
                          <span className="model-name">
                            {m.name || m.id}
                            {m.name && m.name !== m.id && <small>{m.id}</small>}
                          </span>
                          <span className="model-tags">
                            {m.reasoning && <i>推理</i>}
                            {m.input?.includes('image') && <i>图片</i>}
                            {m.contextWindow ? <i>{contextLabel(m.contextWindow)}</i> : null}
                          </span>
                          {key === current ? <Check size={15} /> : <span className="check-space" />}
                        </button>
                      );
                    })}
                </div>
              ))
            )}
          </div>
          {runtime.thinkingLevels.length > 0 && (
            <div className="thinking-row">
              <span>推理级别</span>
              <div role="radiogroup" aria-label="推理级别">
                {runtime.thinkingLevels.map((level) => (
                  <button
                    key={level}
                    role="radio"
                    aria-checked={runtime.thinking === level}
                    disabled={locked}
                    onClick={() => level !== runtime.thinking && setThinking(level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="model-picker-foot">
            {locked ? <span>执行中，结束后可切换</span> : <span>切换后从下一条消息生效</span>}
            <button
              onClick={() => {
                close();
                manage('settings');
              }}
            >
              连接设置
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function ReplyMeta({ message }: { message: Message }) {
  const usage = message.usage as
    | { input?: number; output?: number; cacheRead?: number; totalTokens?: number; cost?: { total?: number } }
    | undefined;
  const model = String(message.responseModel ?? message.model ?? '');
  if (!usage?.totalTokens && !model) return null;
  const cost = usage?.cost?.total;
  return (
    <span
      className="reply-meta"
      title={[
        model && `模型：${message.provider ? message.provider + ' / ' : ''}${model}`,
        message.thinkingLevel && `推理：${String(message.thinkingLevel)}`,
        usage?.input !== undefined && `输入 ${usage.input.toLocaleString()} tokens`,
        usage?.cacheRead ? `缓存命中 ${usage.cacheRead.toLocaleString()}` : '',
        usage?.output !== undefined && `输出 ${usage.output.toLocaleString()} tokens`,
        cost ? `费用 $${cost.toFixed(4)}` : '',
      ]
        .filter(Boolean)
        .join('\n')}
    >
      {model && <span>{model}</span>}
      {!!usage?.totalTokens && <span>{usage.totalTokens.toLocaleString()} tokens</span>}
      {!!cost && <span>${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}</span>}
    </span>
  );
}
function ContextMeter({ stats, open }: { stats: NonNullable<Runtime['stats']>; open: () => void }) {
  const percent = stats.contextPercent;
  const level = percent === undefined ? '' : percent >= 85 ? 'high' : percent >= 60 ? 'mid' : '';
  return (
    <button
      className={'context-meter ' + level}
      onClick={open}
      title={
        (percent !== undefined && stats.contextTokens && stats.contextWindow
          ? `上下文 ${stats.contextTokens.toLocaleString()} / ${stats.contextWindow.toLocaleString()} tokens\n`
          : '') +
        `累计 ${stats.tokens?.toLocaleString() ?? 0} tokens` +
        (stats.cost ? ` · $${stats.cost.toFixed(4)}` : '') +
        '\n点击查看会话与上下文'
      }
    >
      {percent !== undefined && (
        <>
          <span className="meter" aria-hidden="true">
            <i style={{ width: Math.min(100, percent) + '%' }} />
          </span>
          <span>上下文 {Math.round(percent)}%</span>
        </>
      )}
      <span>{(stats.tokens ?? 0).toLocaleString()} tokens</span>
      {!!stats.cost && <span>${stats.cost < 0.01 ? stats.cost.toFixed(4) : stats.cost.toFixed(2)}</span>}
    </button>
  );
}
function QuickSwitch({
  state,
  query,
  setQuery,
  close,
  select,
  openFile,
}: {
  state: AppState;
  query: string;
  setQuery: (v: string) => void;
  close: () => void;
  select: (s: Session) => void;
  openFile: (file: string) => void;
}) {
  const [scope, setScope] = useState<'desktop' | 'pi'>('desktop'),
    [matches, setMatches] = useState<SessionMatch[]>([]),
    [external, setExternal] = useState<PiSessionInfo[] | undefined>(),
    [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const projectName = (id?: string) => state.projects.find((p) => p.id === id)?.name ?? '独立对话';
  useEffect(() => {
    if (scope !== 'desktop' || q.length < 2) {
      setMatches([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void api
        .invoke('searchSessions', q)
        .then((v) => alive && setMatches(v))
        .catch(() => {});
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, scope]);
  useEffect(() => {
    if (scope === 'pi' && !external)
      void api
        .invoke('piSessions')
        .then(setExternal)
        .catch(() => setExternal([]));
  }, [scope]);
  useEffect(() => setIndex(0), [q, scope]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const titleHits = state.sessions
    .filter((s) => (s.title + ' ' + projectName(s.projectId)).toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const contentHits = matches.filter((m) => !titleHits.some((s) => s.id === m.sessionId));
  const rows: {
    key: string;
    icon: ReactNode;
    title: string;
    meta: string;
    snippet?: string;
    run: () => void;
  }[] =
    scope === 'desktop'
      ? [
          ...titleHits.map((s) => ({
            key: s.id,
            icon: s.pinned ? <Pin size={15} /> : <MessageSquare size={15} />,
            title: s.title,
            meta: projectName(s.projectId) + ' · ' + relativeTime(s.updatedAt),
            run: () => select(s),
          })),
          ...contentHits.flatMap((m) => {
            const s = state.sessions.find((x) => x.id === m.sessionId);
            return s
              ? [
                  {
                    key: 'c' + s.id,
                    icon: <TextSearch size={15} />,
                    title: s.title,
                    meta: projectName(s.projectId) + ' · 内容匹配',
                    snippet: m.snippet,
                    run: () => select(s),
                  },
                ]
              : [];
          }),
        ]
      : (external ?? [])
          .filter((x) => `${x.name ?? ''} ${x.preview} ${x.cwd}`.toLowerCase().includes(q))
          .map((x) => ({
            key: x.file,
            icon: <History size={15} />,
            title: x.name || x.preview || '未命名会话',
            meta: x.cwd + ' · ' + relativeTime(x.updatedAt),
            snippet: x.name ? x.preview : undefined,
            run: () => openFile(x.file),
          }));
  return (
    <Modal title="快速切换" subtitle={`搜索会话标题与内容 · ${shortcut('K')}`} close={close}>
      <div className="modal-body quick-switch">
        <div className="search-input">
          <Search size={18} />
          <input
            autoFocus
            aria-label="搜索项目和会话"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (rows.length)
                  setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
              }
              if (e.key === 'Enter' && rows[index]) {
                e.preventDefault();
                rows[index].run();
              }
            }}
            placeholder={scope === 'desktop' ? '会话名称、项目或消息内容…' : '搜索 Pi 保存的历史会话…'}
          />
        </div>
        <div className="scope-tabs" role="tablist">
          <button role="tab" aria-selected={scope === 'desktop'} onClick={() => setScope('desktop')}>
            桌面会话
          </button>
          <button role="tab" aria-selected={scope === 'pi'} onClick={() => setScope('pi')}>
            Pi 历史会话
          </button>
        </div>
        <div className="search-results" role="listbox" aria-label="搜索结果" ref={list}>
          {scope === 'pi' && !external ? (
            <p className="empty-small">
              <LoaderCircle size={14} className="spin" /> 正在读取 Pi 会话目录…
            </p>
          ) : !rows.length ? (
            <p className="empty-small">
              {scope === 'pi'
                ? '没有未打开过的 Pi 会话。在终端里用 pi 创建的会话会出现在这里。'
                : q.length === 1
                  ? '输入至少两个字可搜索消息内容'
                  : '没有匹配的会话'}
            </p>
          ) : (
            rows.map((r, i) => (
              <button
                key={r.key}
                role="option"
                aria-selected={i === index}
                onMouseEnter={() => setIndex(i)}
                onClick={r.run}
              >
                {r.icon}
                <span>
                  {r.title}
                  <small>{r.meta}</small>
                  {r.snippet && <em>{r.snippet}</em>}
                </span>
                <ChevronRight size={15} />
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
function ExtensionPrompt({
  request,
  remaining,
  respond,
}: {
  request: ExtensionDialog;
  remaining: number;
  respond: (values: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}) {
  const [value, setValue] = useState(request.prefill ?? request.options?.[0] ?? '');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!request.expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [request.expiresAt]);
  const left = request.expiresAt ? Math.max(0, Math.ceil((request.expiresAt - now) / 1000)) : undefined;
  return (
    <Modal
      title={request.title || 'Pi 需要你的输入'}
      subtitle={
        (left !== undefined ? `${left} 秒后自动关闭` : '来自当前 Pi 会话') +
        (remaining > 0 ? ` · 之后还有 ${remaining} 个问题` : '')
      }
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
            type={request.title.startsWith('[密钥]') ? 'password' : 'text'}
            autoComplete="off"
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
const shortcutGroups: [string, [string[], string][]][] = [
  [
    '输入',
    [
      [['Enter'], '发送'],
      [['Shift', 'Enter'], '换行'],
      [['↑', '↓'], '输入框为空时翻看本会话发送过的提问'],
      [['/'], '命令菜单；Tab 补全'],
      [['@'], '引用项目文件；也可把文件拖进输入框'],
      [[modKey, 'V'], '粘贴图片'],
      [[modKey, 'G'], '在外部编辑器中编辑草稿'],
    ],
  ],
  [
    '运行',
    [
      [['Esc', 'Esc'], '执行中连按两次，停止全部并把队列恢复到草稿'],
      [['!命令'], '执行终端命令，输出加入上下文'],
      [['!!命令'], '执行终端命令，输出不进入上下文'],
    ],
  ],
  [
    '导航',
    [
      [[modKey, 'N'], '新建独立对话'],
      [[modKey, 'K'], '搜索会话标题与内容'],
      [[modKey, 'B'], '收起或展开侧栏'],
      [[modKey, ','], '打开设置'],
      [[modKey, '/'], '显示本页'],
      [['Esc'], '关闭弹窗或工作区面板'],
    ],
  ],
];
function ShortcutsHelp({ close }: { close: () => void }) {
  return (
    <Modal title="键盘快捷键" subtitle={`${shortcut('/')} 随时打开`} close={close}>
      <div className="modal-body shortcut-help">
        {shortcutGroups.map(([group, rows]) => (
          <section key={group}>
            <h3>{group}</h3>
            {rows.map(([keys, label]) => (
              <div key={label}>
                <span>
                  {keys.map((k, i) => (
                    <kbd key={i}>{k}</kbd>
                  ))}
                </span>
                <p>{label}</p>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
function ReadinessChecklist({
  environment,
  runtime,
  ownRuntime,
  savedModel,
  canConnect,
  checkEnvironment,
  connect,
  providers,
}: {
  environment?: Environment;
  runtime: Runtime;
  ownRuntime: boolean;
  savedModel: string;
  canConnect: boolean;
  checkEnvironment: () => void;
  connect: () => void;
  providers: () => void;
}) {
  if (!environment) return null;
  const connected = ownRuntime && runtime.connected;
  const piReady = environment.supported;
  const modelReady = connected ? Boolean(runtime.model) : Boolean(savedModel);
  if (piReady && modelReady) return null;
  const chooseModel = () => document.querySelector<HTMLButtonElement>('.model-pill')?.click();
  const steps: { done: boolean; title: string; detail: string; action?: [string, () => void] }[] = [
    {
      done: piReady,
      title: piReady ? `已找到 Pi ${environment.version ?? ''}` : '找到 Pi',
      detail: piReady
        ? environment.piPath
        : environment.version
          ? `检测到 Pi ${environment.version}，当前适配 1.1.0`
          : '未检测到 Pi，请安装或在设置中指定 cli.js',
      action: piReady ? undefined : ['检查运行环境', checkEnvironment],
    },
    {
      done: modelReady,
      title: modelReady ? `模型：${(connected && runtime.model?.name) || savedModel}` : '选择一个模型',
      detail: !piReady
        ? '找到 Pi 后读取可用模型'
        : !connected
          ? environment.authExists || environment.modelsExist
            ? '已发现凭据配置，连接后读取可用模型'
            : '还没有发现凭据；可先连接，再登录供应商'
          : runtime.models.length
            ? `共 ${runtime.models.length} 个可用模型`
            : '没有可用模型，登录供应商或添加自定义端点',
      action:
        modelReady || !piReady
          ? undefined
          : !connected
            ? ['连接并读取模型', connect]
            : runtime.models.length
              ? ['选择模型', chooseModel]
              : ['登录供应商', providers],
    },
  ];
  return (
    <div className="readiness" role="region" aria-label="开始前检查">
      <strong>开始前还差一步</strong>
      {steps.map((s, i) => (
        <div key={i} className={'readiness-step' + (s.done ? ' done' : '')}>
          {s.done ? <CheckCircle2 size={17} /> : <span className="step-number">{i + 1}</span>}
          <span>
            {s.title}
            <small title={s.detail}>{s.detail}</small>
          </span>
          {s.action && (
            <button disabled={s.action[1] === connect && !canConnect} onClick={s.action[1]}>
              {s.action[0]}
            </button>
          )}
        </div>
      ))}
    </div>
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
  const [images, setImages] = useState<ImageAttachment[]>([]),
    [featureTab, setFeatureTab] = useState(''),
    [commandIndex, setCommandIndex] = useState(0),
    [hideCommands, setHideCommands] = useState(false);
  const [sidebar, setSidebar] = useState(() => localStorage.getItem('pi.sidebar') !== 'hidden'),
    [compact, setCompact] = useState(false),
    [inspector, setInspector] = useState(false),
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
  const [seenNotification, setSeenNotification] = useState(Number.MAX_SAFE_INTEGER),
    [dismissed, setDismissed] = useState<number[]>([]),
    [, setTick] = useState(0);
  const [testResult, setTestResult] = useState(''),
    [diagnostic, setDiagnostic] = useState(''),
    [elapsed, setElapsed] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false),
    [stopArmed, setStopArmed] = useState(false),
    [dragging, setDragging] = useState(false);
  const recall = useRef(-1);
  const composerDraft = useRef({ draft, attachments, images });
  composerDraft.current = { draft, attachments, images };
  const thread = useRef<HTMLDivElement>(null),
    columns = useRef<HTMLDivElement>(null),
    inspectorPanel = useRef<HTMLElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    commandList = useRef<HTMLDivElement>(null),
    autoScroll = useRef(true),
    previewGeneration = useRef(0),
    selectedRef = useRef<string | undefined>(undefined),
    stateRef = useRef(state),
    runtimeRef = useRef(runtime);
  stateRef.current = state;
  runtimeRef.current = runtime;
  const selected = state?.sessions.find((s) => s.id === state.selectedSessionId),
    project = state?.projects.find((p) => p.id === state.selectedProjectId);
  const sessionEnabled = Boolean(selected && (!selected.projectId || project?.trusted));
  const ownRuntime = runtime.sessionId === selected?.id,
    running = busy(runtime.status),
    ownRunning = ownRuntime && running;
  const messages = ownRuntime ? runtime.messages : history;
  const lastAssistant = messages.findLast((m) => m.role === 'assistant');
  const actionsLocked = pending || running || !sessionEnabled;
  const visibleMessages = messages.slice(-messageLimit);
  const sentPrompts = messages
    .filter((m) => m.role === 'user')
    .map((m) => {
      const t = messageText(m),
        cut = t.indexOf('\n\n<project_file path=');
      return (cut < 0 ? t : t.slice(0, cut)).trim();
    })
    .filter((t, i, all) => t && t !== all[i - 1]);
  const commandMatch = /^(\/\/?)([^\s]*)$/.exec(draft);
  const commandQuery = commandMatch?.[2].toLowerCase();
  const piOnly = commandMatch?.[1] === '//';
  const allCommands: (PiCommand & { prefix: string })[] = [
    ...(piOnly ? [] : builtinCommands.map((c) => ({ ...c, prefix: '/' }))),
    ...runtime.commands.map((c) => ({
      ...c,
      prefix: piOnly || builtinCommands.some((b) => b.name === c.name) ? '//' : '/',
    })),
  ];
  const commandOptions =
    commandQuery !== undefined && !hideCommands
      ? allCommands
          .filter(
            (c) =>
              c.name.toLowerCase().includes(commandQuery) ||
              (commandQuery.length > 1 && (c.description ?? '').toLowerCase().includes(commandQuery)),
          )
          .sort(
            (a, b) =>
              commandOrder.indexOf(a.source) - commandOrder.indexOf(b.source) ||
              Number(!a.name.toLowerCase().startsWith(commandQuery)) -
                Number(!b.name.toLowerCase().startsWith(commandQuery)),
          )
          .slice(0, 40)
      : [];
  const typedCommand = /^(\/\/?)(\S+)\s/.exec(draft);
  const activeCommand =
    typedCommand && !commandOptions.length
      ? allCommands.find((c) => c.prefix === typedCommand[1] && c.name === typedCommand[2])
      : undefined;
  const completeCommand = (c: PiCommand & { prefix: string }) => {
    persistDraft(c.prefix + c.name + ' ');
    setHideCommands(true);
    input.current?.focus();
  };
  const patchLines = fileDiff?.patch.split('\n') ?? [];
  const diffLines = patchLines.slice(
    Math.max(
      0,
      patchLines.findIndex((line) => line.startsWith('@@')),
    ),
  );
  useFocusScope(inspectorPanel, inspector && compact, () => setInspector(false));
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
    localStorage.setItem('pi.sidebar', sidebar ? 'visible' : 'hidden');
    if (!sidebar && document.activeElement?.closest('.sidebar')) {
      document.querySelector<HTMLButtonElement>('[aria-controls="project-sidebar"]')?.focus();
    }
  }, [sidebar]);
  useEffect(() => {
    if (!columns.current) return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 900));
    observer.observe(columns.current);
    return () => observer.disconnect();
  }, [Boolean(state)]);
  useEffect(() => {
    const textarea = input.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = '0px';
      textarea.style.height = Math.min(textarea.scrollHeight, window.innerHeight * 0.2) + 'px';
    };
    resize();
    const observer = new ResizeObserver(resize);
    // Observe the container so wrapping changes also resize the input.
    observer.observe(textarea.parentElement!);
    return () => observer.disconnect();
  }, [draft, state?.settings.fontScale, Boolean(state)]);
  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.theme = state.settings.theme;
    document.documentElement.dataset.platform = api.platform;
    document.documentElement.style.setProperty('--font-scale', String(state.settings.fontScale));
    document.documentElement.style.setProperty('--sidebar-width', state.settings.sidebarWidth + 'px');
    document.documentElement.style.setProperty('--inspector-width', state.settings.inspectorWidth + 'px');
  }, [state?.settings]);
  useEffect(() => {
    if (!selected) return;
    setDraft(selected.draft);
    setAttachments(selected.attachments);
    setImages(selected.images ?? []);
  }, [
    selected?.id,
    selected?.draft,
    selected?.attachments.join('|'),
    selected?.images?.map((i) => i.id).join('|'),
  ]);
  useEffect(() => {
    document.title = runtime.title || 'Pi Desktop';
  }, [runtime.title]);
  useEffect(() => {
    if (!selected) return;
    selectedRef.current = selected.id;
    recall.current = -1;
    setHistory([]);
    setFileQuery(null);
    setFileResults([]);
    if (!selected.projectId) setInspector(false);
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
      if (
        mod(e) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'n' &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault();
        if (!e.repeat) void createSession();
      }
      if (mod(e) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (mod(e) && e.key === ',') {
        e.preventDefault();
        openSettings();
      }
      if (mod(e) && e.key.toLowerCase() === 'g' && selected && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        void action(() => api.invoke('editDraft', selected.id));
      }
      if (mod(e) && e.key.toLowerCase() === 'b' && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        setSidebar((v) => !v);
      }
      if (mod(e) && (e.key === '/' || e.code === 'Slash')) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [state, compact, inspector]);
  useEffect(() => {
    if (!stopArmed) return;
    const timer = setTimeout(() => setStopArmed(false), 2000);
    return () => clearTimeout(timer);
  }, [stopArmed]);
  useEffect(() => {
    if (!ownRunning) setStopArmed(false);
  }, [ownRunning]);
  useEffect(() => {
    if (!ownRunning || runtime.status === 'stopping') return;
    const key = (e: KeyboardEvent) => {
      if (
        e.key !== 'Escape' ||
        e.repeat ||
        e.defaultPrevented ||
        e.isComposing ||
        document.querySelector('[role="dialog"], .context-menu') ||
        inspector
      )
        return;
      e.preventDefault();
      if (stopArmed) {
        setStopArmed(false);
        void attempt(() => api.invoke('stop'));
      } else setStopArmed(true);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [ownRunning, runtime.status, stopArmed, inspector]);
  useEffect(() => {
    if (!inspector) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"]')) {
        setInspector(false);
        document.querySelector<HTMLButtonElement>('.workspace-toggle')?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [inspector]);
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
  useEffect(() => {
    if (!menuId) return;
    const outside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.context-menu') && !target.closest('[aria-expanded="true"]')) setMenuId('');
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuId('');
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [menuId]);
  useEffect(() => {
    commandList.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [commandIndex]);
  const toasts = (runtime.notifications ?? []).filter(
    (n) => n.id > seenNotification && !dismissed.includes(n.id),
  );
  useEffect(() => {
    const timers = toasts
      .filter((n) => n.level !== 'error')
      .map((n) =>
        setTimeout(() => setDismissed((v) => [...v, n.id].slice(-20)), n.level === 'warning' ? 9000 : 5000),
      );
    return () => timers.forEach(clearTimeout);
  }, [toasts.map((n) => n.id).join(',')]);
  useEffect(() => {
    setSeenNotification(Math.max(0, ...(runtime.notifications ?? []).map((n) => n.id)));
  }, [runtime.sessionId]);
  useEffect(() => {
    if (runtime.status !== 'retrying' || !runtime.retry) return;
    const timer = setInterval(() => setTick((v) => v + 1), 500);
    return () => clearInterval(timer);
  }, [runtime.status, runtime.retry?.startedAt]);
  const persistDraft = (value: string, files = attachments, pictures = images) => {
    if (!selected || stateRef.current?.selectedSessionId !== selected.id) return;
    composerDraft.current = { draft: value, attachments: files, images: pictures };
    setDraft(value);
    setAttachments(files);
    setImages(pictures);
    if (selected) void attempt(() => api.invoke('saveDraft', selected.id, value, files, pictures));
  };
  const mergeDraftAttachments = (id: string, files: string[], pictures: ImageAttachment[]) => {
    if (stateRef.current?.selectedSessionId !== id) return false;
    const latest = composerDraft.current;
    if (latest.images.length + pictures.length > 8) throw new Error('每条消息最多添加 8 张图片');
    persistDraft(
      latest.draft,
      [...new Set([...latest.attachments, ...files])],
      [...latest.images, ...pictures],
    );
    return true;
  };
  const onDraft = (value: string) => {
    recall.current = -1;
    persistDraft(value);
    setHideCommands(false);
    setCommandIndex(0);
    if (value === '/' && selected && !runtime.connected && !running)
      void attempt(() => api.invoke('connect', selected.id));
    const match = value.match(/(?:^|\s)@([^\s@]*)$/);
    setFileQuery(project && match ? match[1] : null);
  };
  const focusComposer = () => {
    if (compact && inspector) setInspector(false);
    requestAnimationFrame(() => input.current?.focus());
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
    focusComposer();
  }
  async function send() {
    if (!selected || (!draft.trim() && !images.length) || pending) return;
    setError('');
    setPending(true);
    const sent = draft;
    await attempt(async () => {
      if (await handleBuiltin(sent)) {
        await api.invoke('consumeDraft', selected.id, sent);
        setHideCommands(true);
      } else if (/^\/\/\S/.test(sent)) {
        await api.invoke('send', selected.id, sent.slice(1), attachments, sendMode, images);
        await api.invoke('consumeDraft', selected.id, sent);
      } else await api.invoke('send', selected.id, sent, attachments, sendMode, images);
    });
    setPending(false);
    autoScroll.current = true;
    input.current?.focus();
  }
  async function handleBuiltin(value: string) {
    const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(value.trim());
    if (!match || !selected || !builtinCommands.some((c) => c.name === match[1])) return false;
    if (images.length || attachments.length) throw new Error('桌面命令不能附带附件，请先移除附件');
    const [_, cmd, arg = ''] = match;
    if (['tree', 'fork'].includes(cmd)) setFeatureTab('tree');
    else if (cmd === 'new') await createSession(selected.projectId);
    else if (cmd === 'resume') setSearchOpen(true);
    else if (cmd === 'name') {
      if (arg) await api.invoke('renameSession', selected.id, arg);
      else setRename({ kind: 'session', id: selected.id, name: selected.title });
    } else if (cmd === 'clone') await api.invoke('branchSession', selected.id, 'clone');
    else if (cmd === 'compact') {
      const r = await api.invoke('compact', selected.id, arg);
      setNotice('压缩完成：' + r.tokensBefore + ' tokens');
    } else if (cmd === 'session') setFeatureTab('session');
    else if (cmd === 'settings' || cmd === 'scoped-models') setFeatureTab('settings');
    else if (cmd === 'login' || cmd === 'logout') setFeatureTab('providers');
    else if (cmd === 'config') setFeatureTab('resources');
    else if (cmd === 'mcp') {
      if (arg) {
        await api.invoke('send', selected.id, value, [], 'steer');
      } else setFeatureTab('mcp');
    } else if (cmd === 'reload') {
      await api.invoke('reloadPi', selected.id);
      setNotice('已重新加载');
    } else if (cmd === 'model' || cmd === 'thinking') openSettings('models');
    else if (cmd === 'copy') {
      await api.invoke(
        'copy',
        messageText(messages.findLast((m) => m.role === 'assistant') ?? { content: '' }),
      );
      setNotice('最后回复已复制');
    } else if (cmd === 'import') await api.invoke('importSession', selected.projectId);
    else if (cmd === 'export')
      await api.invoke('exportSession', selected.id, arg === 'jsonl' ? 'jsonl' : 'html');
    else if (cmd === 'share') {
      const url = await api.invoke('shareSession', selected.id);
      if (url) setNotice('链接已复制：' + url);
    } else if (cmd === 'terminal') await api.invoke('openPiTerminal', selected.id);
    else if (cmd === 'quit') await api.invoke('quit');
    else if (cmd === 'trust') {
      if (project) await api.invoke('trustProject', project.id);
    } else if (cmd === 'bug') openSettings('diagnostic');
    else if (cmd === 'hotkeys') setShortcutsOpen(true);
    else if (cmd === 'changelog')
      await api.invoke(
        'openLink',
        'https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/CHANGELOG.md',
      );
    else setFeatureTab('help');
    return true;
  }
  async function readImages(files: File[]): Promise<ImageAttachment[]> {
    if (files.length + images.length > 8) throw new Error('每条消息最多添加 8 张图片');
    return Promise.all(
      files.map(async (f) => {
        if (
          f.size > 8 * 1024 * 1024 ||
          !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(f.type)
        )
          throw new Error('支持 PNG、JPEG、WebP、GIF，单张不超过 8 MiB');
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',')[1]);
          r.onerror = reject;
          r.readAsDataURL(f);
        });
        return { id: crypto.randomUUID(), name: f.name || '粘贴的图片', mimeType: f.type, data };
      }),
    );
  }
  async function acceptImages(files: File[]) {
    if (!selected) return;
    await attempt(async () => {
      const next = await readImages(files);
      mergeDraftAttachments(selected.id, [], next);
    });
  }
  async function acceptDrop(files: File[]) {
    if (!selected) return;
    const pictures = files.filter((f) => f.type.startsWith('image/'));
    const others = files.filter((f) => !f.type.startsWith('image/'));
    const nextImages = pictures.length ? await attempt(() => readImages(pictures)) : [];
    let nextFiles: string[] = [];
    if (others.length) {
      if (!project) {
        setError('独立对话不能引用本地文件；打开项目后可拖入项目内的文本文件');
      } else {
        await attempt(async () => {
          const paths = others.map((f) => api.pathForFile(f)).filter(Boolean);
          const { accepted, rejected } = await api.invoke('referenceDropped', project.id, paths);
          if (stateRef.current?.selectedSessionId !== selected.id) return;
          nextFiles = accepted;
          if (accepted.length) setNotice(`已引用 ${accepted.length} 个文件`);
          if (rejected.length)
            setError(
              `${rejected.slice(0, 3).join('、')}${rejected.length > 3 ? ` 等 ${rejected.length} 个文件` : ''} 无法引用：只支持项目内 256 KiB 以内的文本文件`,
            );
        });
      }
    }
    if (stateRef.current?.selectedSessionId !== selected.id) return;
    if (nextImages?.length || nextFiles.length)
      await attempt(async () => mergeDraftAttachments(selected.id, nextFiles, nextImages ?? []));
    focusComposer();
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
  async function createSession(projectId?: string) {
    const session = await attempt(() => api.invoke('newSession', projectId));
    if (session) focusComposer();
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
    setError('');
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
    if (!selected) return;
    const [provider, modelId] = key.split('::');
    setPrefs((prev) => (prev ? { ...prev, provider, modelId } : prev));
    await action(() => api.invoke('setSessionModel', selected.id, provider, modelId));
  }
  async function setThinking(thinking: string) {
    if (!selected) return;
    setPrefs((prev) => (prev ? { ...prev, thinking } : prev));
    await action(() => api.invoke('setSessionThinking', selected.id, thinking));
  }
  async function copy(value: string, label = '已复制') {
    await attempt(() => api.invoke('copy', value));
    setNotice(label);
  }
  async function revert(only: string[] | null) {
    if (!project) return;
    await action(async () => {
      const reverted = await api.invoke('revertChanges', project.id, only);
      if (!reverted.length) return;
      setNotice(`已撤销 ${reverted.length} 个文件的修改`);
      setChanges(await api.invoke('changes', project.id, changeMode));
      setSelectedFile('');
      setFileDiff(undefined);
    });
  }
  async function messageAction(m: Message, kind: MessageAction) {
    if (!selected || !m.timestamp) return;
    await action(async () => {
      await api.invoke('messageAction', selected.id, kind, m.role as 'user' | 'assistant', m.timestamp!);
      if (kind === 'edit') {
        setNotice('已回到这条消息之前，修改后发送即可；原内容保留在会话树中');
        focusComposer();
      }
      if (kind === 'fork') setNotice('已从这条消息创建分支会话');
    });
    autoScroll.current = true;
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
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .find((b) => b.type === 'toolCall' && b.id === message.toolCallId);
    return {
      id: message.toolCallId ?? '',
      name: message.toolName ?? call?.name ?? 'tool',
      args: call?.arguments ?? {},
      status: message.isError ? 'error' : 'done',
      output: messageText(message).split('\n').slice(-200).join('\n'),
      startedAt: message.timestamp ?? 0,
      durationMs: typeof message.durationMs === 'number' ? message.durationMs : undefined,
      patch: typeof (message.details as any)?.patch === 'string' ? (message.details as any).patch : undefined,
    };
  };
  const renderSession = (s: Session) => (
    <div
      className={
        'session-row ' + (s.id === selected?.id ? 'active' : '') + (menuId === s.id ? ' menu-open' : '')
      }
      key={s.id}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuId(s.id);
      }}
    >
      <button
        title={s.title}
        aria-current={s.id === selected?.id ? 'page' : undefined}
        onClick={() => void selectSession(s)}
      >
        {s.pinned ? <Pin size={14} className="pin-icon" /> : <MessageSquare size={14} />}
        <span>{s.title}</span>
        {s.unread && <i className="unread" />}
        {s.id === runtime.sessionId && running && <LoaderCircle size={12} className="spin" />}
      </button>
      <IconButton
        title={`${s.title} 会话操作`}
        expanded={menuId === s.id}
        onClick={() => setMenuId(menuId === s.id ? '' : s.id)}
      >
        <MoreHorizontal size={14} />
      </IconButton>
      {menuId === s.id && (
        <div className="context-menu" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setMenuId('');
              void attempt(() => api.invoke('pinSession', s.id, !s.pinned));
            }}
          >
            {s.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            {s.pinned ? '取消置顶' : '置顶'}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setMenuId('');
              setRename({ kind: 'session', id: s.id, name: s.title });
            }}
          >
            <Pencil size={14} />
            重命名
          </button>
          <button
            role="menuitem"
            disabled={!s.file}
            onClick={() => {
              setMenuId('');
              void attempt(async () => {
                const file = await api.invoke('exportSession', s.id, 'html');
                if (file) setNotice('已导出到 ' + file);
              });
            }}
          >
            <Download size={14} />
            导出 HTML
          </button>
          <button
            role="menuitem"
            className="danger"
            onClick={() => {
              setMenuId('');
              void attempt(async () => {
                if (await api.invoke('deleteSession', s.id)) setNotice(`会话已移到${platform.trash}`);
              });
            }}
          >
            <Trash2 size={14} />
            删除
          </button>
        </div>
      )}
    </div>
  );
  const bySidebarOrder = (a: Session, b: Session) =>
    Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt;
  if (!state)
    return (
      <main className="loading-screen">
        <div className="brand-mark">π</div>
        <h2>Pi Desktop</h2>
        {error ? (
          <p className="inline-error">{error}</p>
        ) : (
          <p>
            <LoaderCircle size={15} className="spin" /> 正在准备 Pi…
          </p>
        )}
      </main>
    );
  return (
    <div className="app-shell">
      <aside
        className="sidebar"
        id="project-sidebar"
        aria-label="项目与会话"
        hidden={!sidebar}
        inert={inspector && compact}
      >
        <div className="brand">
          <span className="brand-mark">π</span>
          <div>Pi Desktop</div>
          <IconButton title={`搜索项目与会话 ${shortcut('K')}`} onClick={() => setSearchOpen(true)}>
            <Search size={17} />
          </IconButton>
        </div>
        <button className="new-session" onClick={() => void createSession()}>
          <Plus size={17} />
          新建对话<kbd>{shortcut('N')}</kbd>
        </button>
        <div className="project-list">
          <div className="section-heading">对话</div>
          <div className="session-list standalone-sessions" aria-label="独立对话">
            {state.sessions
              .filter((s) => !s.projectId)
              .sort(bySidebarOrder)
              .map(renderSession)}
            {!state.sessions.some((s) => !s.projectId) && (
              <p className="sidebar-empty">随时开始，无需打开项目。</p>
            )}
          </div>
          <div className="section-heading">
            项目
            <IconButton title="添加项目" onClick={addProject}>
              <Plus size={15} />
            </IconButton>
          </div>
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
              <div className="project-actions">
                <IconButton title={`在 ${p.name} 中新建会话`} onClick={() => void createSession(p.id)}>
                  <Plus size={15} />
                </IconButton>
                <IconButton
                  title={`${p.name} 项目操作`}
                  expanded={menuId === p.id}
                  onClick={() => setMenuId(menuId === p.id ? '' : p.id)}
                >
                  <MoreHorizontal size={15} />
                </IconButton>
              </div>
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
                    className="danger"
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
                    .sort(bySidebarOrder)
                    .map(renderSession)}
                </div>
              )}
            </div>
          ))}
          {!state.projects.length && <p className="sidebar-empty">需要处理本地文件时，打开项目。</p>}
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
            Pi Desktop <span>v{__APP_VERSION__}</span>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-header" inert={inspector && compact}>
          <IconButton
            title={`${sidebar ? '收起' : '展开'}项目侧栏 ${shortcut('B')}`}
            onClick={() => setSidebar((v) => !v)}
            expanded={sidebar}
            controls="project-sidebar"
          >
            {sidebar ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </IconButton>
          <div className="workspace-title">
            <h1 title={selected?.title}>{selected?.title || 'Pi Desktop'}</h1>
            <div className="breadcrumb" title={project?.path}>
              <span>{project?.name || '独立对话'}</span>
              {changes?.branch && (
                <span className="branch">
                  <GitBranch size={12} />
                  {changes.branch}
                </span>
              )}
            </div>
          </div>
          <div className="header-actions">
            <button
              aria-label="Pi 功能"
              disabled={!selected || (running && !ownRuntime)}
              onClick={() => setFeatureTab('session')}
            >
              <Command size={16} />
              <span>Pi 功能</span>
            </button>
            {project && (
              <button
                className={'workspace-toggle ' + (inspector ? 'active' : '')}
                aria-label={inspector ? '收起工作区面板' : '查看工作区变更'}
                aria-expanded={inspector}
                aria-controls="workspace-inspector"
                onClick={() => setInspector((v) => !v)}
                title="变更、文件与输出"
              >
                {inspector ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                <span>工作区</span>
                {!!changes?.files.length && <span className="count">{changes.files.length}</span>}
              </button>
            )}
          </div>
        </header>
        <div ref={columns} className={'workspace-columns' + (compact ? ' compact' : '')}>
          <section className="conversation" inert={inspector && compact}>
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
                  <div className="welcome-symbol" aria-hidden="true">
                    π
                  </div>
                  <h2>{project ? '想一起完成什么？' : '有什么想聊的？'}</h2>
                  <p>
                    {project ? '描述一个目标，或者从下面开始。' : '直接提问、整理思路，或一起打磨一个想法。'}
                  </p>
                  <ReadinessChecklist
                    environment={environment}
                    runtime={runtime}
                    ownRuntime={ownRuntime}
                    savedModel={selected?.model?.id || state.settings.modelId}
                    canConnect={sessionEnabled && !running && !pending}
                    checkEnvironment={() => openSettings('environment')}
                    connect={() => void connect()}
                    providers={() => setFeatureTab('providers')}
                  />
                  {!project ? (
                    <div className="suggestions">
                      {[
                        ['解释概念', '帮我解释一个概念：', '从直觉讲到细节，配上例子'],
                        ['整理思路', '帮我梳理一下这个想法：', '把零散的想法理成结构'],
                        ['一起写作', '和我一起打磨这段文字：', '改稿、润色或换个语气'],
                      ].map(([label, prompt, hint]) => (
                        <button
                          key={label}
                          aria-label={label}
                          onClick={() => {
                            persistDraft(prompt);
                            focusComposer();
                          }}
                        >
                          <span>{label}</span>
                          <small>{hint}</small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="suggestions">
                      {[
                        ['理解项目', '梳理这个项目的结构、运行方式和主要模块。', '结构、运行方式和主要模块'],
                        ['修复问题', '帮我定位并修复一个问题：', '描述现象，Pi 定位并修改'],
                        ['补充测试', '检查项目中缺少测试的关键逻辑，先给出建议。', '找出缺少测试的关键逻辑'],
                      ].map(([label, prompt, hint]) => (
                        <button
                          key={label}
                          aria-label={label}
                          onClick={() => {
                            persistDraft(prompt);
                            input.current?.focus();
                          }}
                        >
                          <span>{label}</span>
                          <small>{hint}</small>
                        </button>
                      ))}
                    </div>
                  )}
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
                    <div key={key}>
                      <ToolCard
                        tool={tool}
                        expanded={expanded.includes(tool.id)}
                        onToggle={(v) => toggleTool(tool.id, v)}
                        openFile={(p) => void inspectFile(p, 'files')}
                      />
                      <MessageImages message={m} />
                    </div>
                  );
                }
                if (m.role === 'bashExecution')
                  return (
                    <article className="message bash-message" key={key}>
                      <strong>
                        <Terminal size={14} /> {String(m.command ?? '')}
                      </strong>
                      <CodeBlock>{String(m.output ?? '')}</CodeBlock>
                      <small>
                        {m.excludeFromContext ? '输出不进入模型上下文' : '输出已加入模型上下文'} · 退出码{' '}
                        {String(m.exitCode ?? '')}
                      </small>
                    </article>
                  );
                if (m.role === 'custom' || m.role === 'branchSummary' || m.role === 'compactionSummary')
                  return (
                    <article className="message" key={key}>
                      <RichText text={messageText(m) || String(m.summary ?? '')} />
                    </article>
                  );
                if (m.role !== 'user' && m.role !== 'assistant') return null;
                const content = messageText(m);
                if (
                  m.role === 'assistant' &&
                  !content &&
                  !m.errorMessage &&
                  typeof m.content !== 'string' &&
                  !m.content.some(
                    (b) =>
                      (b.type === 'thinking' && b.thinking) ||
                      (ownRunning && typeof b.partialJson === 'string'),
                  )
                )
                  return null;
                return (
                  <article key={key} className={'message ' + m.role}>
                    <div className="message-heading">
                      {m.role === 'assistant' && (
                        <span className="avatar assistant" aria-hidden="true">
                          π
                        </span>
                      )}
                      <strong>{m.role === 'user' ? '你' : 'Pi'}</strong>
                      {m.timestamp && <time>{time(m.timestamp)}</time>}
                      {m.role === 'assistant' && <ReplyMeta message={m} />}
                      <span className="message-actions">
                        <IconButton title="复制消息" onClick={() => void copy(content, '消息已复制')}>
                          <Copy size={13} />
                        </IconButton>
                        {m.role === 'user' && m.timestamp && (
                          <>
                            <IconButton
                              title="编辑后重新发送"
                              disabled={actionsLocked}
                              onClick={() => void messageAction(m, 'edit')}
                            >
                              <Pencil size={13} />
                            </IconButton>
                            <IconButton
                              title="从这里分支到新会话"
                              disabled={actionsLocked}
                              onClick={() => void messageAction(m, 'fork')}
                            >
                              <GitBranch size={13} />
                            </IconButton>
                          </>
                        )}
                        {m.role === 'assistant' && m.timestamp && m === lastAssistant && (
                          <IconButton
                            title="重新生成这条回复"
                            disabled={actionsLocked}
                            onClick={() => void messageAction(m, 'regenerate')}
                          >
                            <RefreshCw size={13} />
                          </IconButton>
                        )}
                      </span>
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
                      <MessageImages message={m} />
                      {ownRunning &&
                        typeof m.content !== 'string' &&
                        m.content
                          .filter(
                            (b) =>
                              b.type === 'toolCall' &&
                              typeof b.partialJson === 'string' &&
                              !runtime.tools.some((t) => t.id === b.id),
                          )
                          .map((b) => (
                            <div className="tool-drafting" key={String(b.id)}>
                              <LoaderCircle size={13} className="spin" />
                              <strong>正在准备 {String(b.name ?? '工具')}</strong>
                              <code>{String(b.partialJson).slice(-160) || '…'}</code>
                            </div>
                          ))}
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
                  disabled={!selected}
                  onChange={(e) => onDraft(e.target.value)}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files).filter((f) =>
                      f.type.startsWith('image/'),
                    );
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
                            (i + (e.key === 'ArrowDown' ? 1 : -1) + commandOptions.length) %
                            commandOptions.length,
                        );
                        return;
                      }
                      if (
                        e.key === 'Tab' ||
                        (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing)
                      ) {
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
          </section>
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
      {(notice || toasts.length > 0) && (
        <div className="toast-stack" aria-live="polite">
          {toasts.map((n) => (
            <div className={'toast ' + n.level} role={n.level === 'error' ? 'alert' : 'status'} key={n.id}>
              {n.level === 'error' ? (
                <AlertCircle size={16} />
              ) : n.level === 'warning' ? (
                <TriangleAlert size={16} />
              ) : (
                <Info size={16} />
              )}
              <span>{n.text}</span>
              <IconButton title="关闭通知" onClick={() => setDismissed((v) => [...v, n.id].slice(-20))}>
                <X size={13} />
              </IconButton>
            </div>
          ))}
          {notice && (
            <div className="toast" role="status">
              <CheckCircle2 size={16} />
              <span>{notice}</span>
            </div>
          )}
        </div>
      )}
      {searchOpen && (
        <QuickSwitch
          state={state}
          query={searchQuery}
          setQuery={setSearchQuery}
          close={() => setSearchOpen(false)}
          select={(s) => void selectSession(s)}
          openFile={(file) =>
            void attempt(async () => {
              const s = await api.invoke('openPiSession', file);
              setSearchOpen(false);
              await selectSession(s);
            })
          }
        />
      )}
      {shortcutsOpen && <ShortcutsHelp close={() => setShortcutsOpen(false)} />}
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
                    <button disabled={!sessionEnabled || pending || running} onClick={connect}>
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
                  {!selected && <p className="environment-note">请先新建对话，再连接 Pi 获取模型列表。</p>}
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
                    onChange={(e) => void setThinking(e.target.value)}
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
                    <button
                      onClick={() => {
                        setSettingsOpen(false);
                        setFeatureTab('providers');
                      }}
                    >
                      管理供应商与登录
                    </button>
                    <CodeBlock>
                      {environment?.piPath && /\.m?js$/i.test(environment.piPath)
                        ? `& '${(environment.nodePath || 'node').replaceAll("'", "''")}' '${environment.piPath.replaceAll("'", "''")}'`
                        : 'pi'}
                    </CodeBlock>
                    <p>可在供应商管理中登录、保存 API Key 或编辑自定义模型。已有密钥不会回显。</p>
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
                    代码编辑器 <small>留空时在{platform.fileManager}中定位文件</small>
                  </label>
                  <div className="path-field">
                    <input
                      aria-label="代码编辑器"
                      value={prefs.editorPath}
                      onChange={(e) => setPrefs({ ...prefs, editorPath: e.target.value })}
                    />
                    <button onClick={() => void chooseSettingPath('editor')}>选择</button>
                  </div>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={prefs.notifyOnFinish}
                      onChange={(e) => {
                        const notifyOnFinish = e.target.checked;
                        setPrefs({ ...prefs, notifyOnFinish });
                        void attempt(() => api.invoke('saveSettings', { notifyOnFinish }));
                      }}
                    />
                    <span>
                      窗口在后台时发送系统通知
                      <small>任务完成、失败或 Pi 等待你回复时提醒，并闪烁任务栏图标</small>
                    </span>
                  </label>
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
      {featureTab && selected && (
        <PiFeatures
          session={selected}
          runtime={runtime}
          initialTab={featureTab}
          close={() => setFeatureTab('')}
        />
      )}
      {runtime.auth && (
        <div className="auth-banner" role="status">
          <strong>{runtime.auth.message}</strong>
          {runtime.auth.code && <code>{runtime.auth.code}</code>}
          {runtime.auth.url && (
            <button onClick={() => void attempt(() => api.invoke('openLink', runtime.auth!.url!))}>
              打开登录页面
            </button>
          )}
          <button onClick={() => void attempt(() => api.invoke('cancelLogin'))}>取消登录</button>
        </div>
      )}
      {runtime.dialogs[0] && (
        <ExtensionPrompt
          key={runtime.dialogs[0].id}
          request={runtime.dialogs[0]}
          remaining={runtime.dialogs.length - 1}
          respond={(v) => void attempt(() => api.invoke('respond', runtime.dialogs[0].id, v))}
        />
      )}
    </div>
  );
}
