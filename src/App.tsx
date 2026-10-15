import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Square,
  Plus,
  FolderOpen,
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
  Info,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { PiFeatures, builtinCommands } from './PiFeatures';
import {
  busy,
  emptyRuntime,
  messageText,
  type AppState,
  type Runtime,
  type Environment,
  type Session,
  type Message,
  type Changes,
  type FileDiff,
  type FilePreview,
  type ToolActivity,
  type Settings,
  type ContentBlock,
  applyRuntimePatch,
  type ImageAttachment,
  type MessageAction,
  type PiCommand,
} from '../shared/types';
import { platform, modKey, shortcut, mod } from './lib/platform';
import { readableError } from './lib/format';
import { commandOrder, commandSourceNames } from './lib/commands';
import { IconButton } from './components/IconButton';
import { Badge } from './components/Badge';
import { useFocusScope } from './hooks/useFocusScope';
import { Modal } from './components/Modal';
import { CodeBlock } from './components/conversation/Markdown';
import { patchLines, ToolCard } from './components/conversation/ToolCard';
import { FileTree } from './components/FileTree';
import { ModelPicker } from './components/ModelPicker';
import { ContextMeter } from './components/conversation/Usage';
import { QuickSwitch } from './components/QuickSwitch';
import { ApprovalSwitch, ApprovalCard } from './components/Approval';
import { type MessageContext, ChatMessage } from './components/conversation/ChatMessage';
import { ExtensionPrompt } from './components/ExtensionPrompt';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { ReadinessChecklist } from './components/ReadinessChecklist';
const api = window.desktop;
const noTools: ToolActivity[] = [];
// Parsing Markdown dominates render time in long sessions; only re-parse when the text changes.
// One row per message. Rows whose message object is unchanged skip rendering entirely, so a
// streaming reply re-renders only itself instead of the whole conversation.

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
  const approvals = runtime.dialogs.filter((d) => d.approval);
  const prompts = runtime.dialogs.filter((d) => !d.approval);
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
      else if (event.type === 'runtimePatch')
        setRuntime((previous) => applyRuntimePatch(previous, event.patch));
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
  // Handlers read the latest closures through a ref so their identity, and the memoized rows
  // that receive them, stay stable across renders.
  const latest = useRef({ toggleTool, inspectFile, copy, messageAction });
  latest.current = { toggleTool, inspectFile, copy, messageAction };
  const stableHandlers = useMemo(
    () => ({
      toggleTool: (id: string, open: boolean) => latest.current.toggleTool(id, open),
      openFile: (p: string) => void latest.current.inspectFile(p, 'files'),
      copy: (text: string) => void latest.current.copy(text, '消息已复制'),
      act: (m: Message, kind: MessageAction) => void latest.current.messageAction(m, kind),
    }),
    [],
  );
  const liveTools = ownRuntime ? runtime.tools : noTools;
  const liveToolIdKey = JSON.stringify(liveTools.map((t) => t.id));
  const liveToolIds = useMemo(() => new Set<string>(JSON.parse(liveToolIdKey)), [liveToolIdKey]);
  // Tool cards look up live activity first; keep the lookup stable while runtime.tools is unchanged.
  const toolLookup = useMemo(() => {
    const byId = new Map(liveTools.map((t) => [t.id, t]));
    const calls = new Map<string, ContentBlock>();
    for (const m of messages)
      if (Array.isArray(m.content))
        for (const b of m.content) if (b.type === 'toolCall' && b.id) calls.set(String(b.id), b);
    const cache = new WeakMap<Message, ToolActivity>();
    return (message: Message): ToolActivity => {
      const observed = byId.get(message.toolCallId ?? '');
      if (observed) return observed;
      let t = cache.get(message);
      if (!t) {
        const call = calls.get(message.toolCallId ?? '');
        t = {
          id: message.toolCallId ?? '',
          name: message.toolName ?? call?.name ?? 'tool',
          args: call?.arguments ?? {},
          status: message.isError ? 'error' : 'done',
          output: messageText(message).split('\n').slice(-200).join('\n'),
          startedAt: message.timestamp ?? 0,
          durationMs: typeof message.durationMs === 'number' ? message.durationMs : undefined,
          patch:
            typeof (message.details as any)?.patch === 'string' ? (message.details as any).patch : undefined,
        };
        cache.set(message, t);
      }
      return t;
    };
  }, [liveTools, messages]);
  const messageContext: MessageContext = useMemo(
    () => ({
      running: ownRunning,
      locked: actionsLocked,
      expanded,
      liveToolIds,
      toolFor: toolLookup,
      ...stableHandlers,
    }),
    [ownRunning, actionsLocked, expanded, liveToolIds, toolLookup, stableHandlers],
  );
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
              {visibleMessages.map((m, i) => (
                <ChatMessage
                  key={`${selected?.id}-${i + messages.length - visibleMessages.length}`}
                  m={m}
                  last={m === lastAssistant}
                  ctx={messageContext}
                />
              ))}
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
              {ownRuntime &&
                approvals.map((d, i) => (
                  <ApprovalCard
                    key={d.id}
                    dialog={d}
                    first={i === 0}
                    respond={(value) => void attempt(() => api.invoke('respond', d.id, { value }))}
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
      {prompts[0] && (
        <ExtensionPrompt
          key={prompts[0].id}
          request={prompts[0]}
          remaining={prompts.length - 1}
          respond={(v) => void attempt(() => api.invoke('respond', prompts[0].id, v))}
        />
      )}
    </div>
  );
}
