import { useRuntime } from './useRuntime';
import { useDraft } from './useDraft';
import { useShortcuts } from './useShortcuts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { builtinCommands } from '../lib/commands';
import {
  busy,
  messageText,
  type Session,
  type Message,
  type Changes,
  type FileDiff,
  type FilePreview,
  type ToolActivity,
  type Settings,
  type ContentBlock,
  type MessageAction,
} from '../../shared/types';

import { readableError } from '../lib/format';
import { PI_SOURCE_URL } from '../../shared/pi-version';

import { useFocusScope } from './useFocusScope';
import { type MessageContext } from '../components/conversation/ChatMessage';
const api = window.desktop;
const noTools: ToolActivity[] = [];
export function useWorkbench() {
  const [history, setHistory] = useState<Message[]>([]);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [settingsOpen, setSettingsOpen] = useState(false),
    [settingsTab, setSettingsTab] = useState('environment'),
    [prefs, setPrefs] = useState<Settings>();
  const { state, runtime, environment, setEnvironment, storage, update } = useRuntime(setError, setPrefs);
  const [pending, setPending] = useState(false);
  const [featureTab, setFeatureTab] = useState('');
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
  const [expanded, setExpanded] = useState<string[]>([]),
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
    [dragging, setDragging] = useState(false);

  const thread = useRef<HTMLDivElement>(null),
    columns = useRef<HTMLDivElement>(null),
    inspectorPanel = useRef<HTMLElement>(null),
    autoScroll = useRef(true),
    previewGeneration = useRef(0),
    selectedRef = useRef<string | undefined>(undefined),
    stateRef = useRef(state),
    runtimeRef = useRef(runtime);
  stateRef.current = state;
  runtimeRef.current = runtime;
  const selected = state?.sessions.find((s) => s.id === state.selectedSessionId),
    project = state?.projects.find((p) => p.id === state.selectedProjectId);
  const sessionEnabled =
    storage.writable &&
    (!runtime.crash || runtime.crash.cleanup === 'confirmed') &&
    Boolean(selected && (!selected.projectId || project?.trusted));
  const ownRuntime = runtime.sessionId === selected?.id,
    running = busy(runtime.status),
    ownRunning = ownRuntime && running;
  const {
    draft,
    attachments,
    images,
    sendMode,
    setSendMode,
    fileQuery,
    setFileQuery,
    fileResults,
    setFileResults,
    commandIndex,
    setCommandIndex,
    setHideCommands,
    recall,
    input,
    commandList,
    commandOptions,
    activeCommand,
    completeCommand,
    persistDraft,
    onDraft,
    focusComposer,
    addAttachment,
    acceptImages,
    acceptDrop,
  } = useDraft({
    state,
    stateRef,
    selected,
    project,
    runtime,
    compact,
    inspector,
    setInspector,
    attempt,
    setError,
    setNotice,
  });
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
    if (!state) return;
    document.documentElement.dataset.theme = state.settings.theme;
    document.documentElement.dataset.platform = api.platform;
    document.documentElement.style.setProperty('--font-scale', String(state.settings.fontScale));
    document.documentElement.style.setProperty('--sidebar-width', state.settings.sidebarWidth + 'px');
    document.documentElement.style.setProperty('--inspector-width', state.settings.inspectorWidth + 'px');
  }, [state?.settings]);

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

  async function send() {
    if (!environment?.supported) {
      setError(environment?.errors.join('\n') || '正在检测 Pi 运行环境，请稍候');
      return;
    }
    if (!storage.writable) {
      setError(storage.problem ?? '本地数据不可写，请检查目录权限后重新启动');
      return;
    }
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
    else if (cmd === 'changelog') await api.invoke('openLink', PI_SOURCE_URL + '/CHANGELOG.md');
    else setFeatureTab('help');
    return true;
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
    void detect();
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
  const stopArmed = useShortcuts({
    state,
    selected,
    runtime,
    compact,
    inspector,
    ownRunning,
    createSession,
    openSettings,
    action,
    attempt,
    setSearchOpen,
    setSidebar,
    setShortcutsOpen,
    setInspector,
  });
  return {
    update,
    state,
    storage,
    runtime,
    environment,
    history,
    pending,
    setFeatureTab,
    compact,
    inspector,
    expanded,
    messageLimit,
    setMessageLimit,
    newContent,
    setNewContent,
    thread,
    input,
    autoScroll,
    selected,
    project,
    sessionEnabled,
    ownRuntime,
    running,
    messages,
    approvals,
    lastAssistant,
    visibleMessages,
    attempt,
    persistDraft,
    focusComposer,
    selectSession,
    openSettings,
    connect,
    inspectFile,
    toggleTool,
    messageContext,
    error,
    setError,
    setNotice,
    draft,
    attachments,
    sendMode,
    setSendMode,
    images,
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
    commandList,
    ownRunning,
    sentPrompts,
    commandOptions,
    activeCommand,
    completeCommand,
    onDraft,
    addAttachment,
    send,
    acceptImages,
    acceptDrop,
    setModel,
    setThinking,
    sidebar,
    setSearchOpen,
    setRename,
    menuId,
    setMenuId,
    addProject,
    createSession,
    setSidebar,
    setInspector,
    changes,
    tab,
    setTab,
    changeMode,
    setChangeMode,
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
    diffLines,
    copy,
    revert,
    notice,
    setDismissed,
    toasts,
    featureTab,
    searchOpen,
    searchQuery,
    setSearchQuery,
    rename,
    shortcutsOpen,
    prompts,
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    setSettingsTab,
    prefs,
    setPrefs,
    testResult,
    setTestResult,
    diagnostic,
    setDiagnostic,
    action,
    detect,
    saveSettings,
    chooseSettingPath,
    latest,
    columns,
  };
}
export type Workbench = ReturnType<typeof useWorkbench>;
