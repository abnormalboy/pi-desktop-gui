import { useEffect, useRef, useState, type RefObject, type Dispatch, type SetStateAction } from 'react';
import {
  busy,
  type AppState,
  type Runtime,
  type Session,
  type Project,
  type ImageAttachment,
  type PiCommand,
} from '../../shared/types';
import { builtinCommands } from '../lib/commands';
import { commandOrder } from '../lib/commands';
import { readableError } from '../lib/format';
const api = window.desktop;
interface DraftOptions {
  state: AppState | undefined;
  stateRef: RefObject<AppState | undefined>;
  selected: Session | undefined;
  project: Project | undefined;
  runtime: Runtime;
  compact: boolean;
  inspector: boolean;
  setInspector: Dispatch<SetStateAction<boolean>>;
  attempt: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
}
export function useDraft({
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
}: DraftOptions) {
  const running = busy(runtime.status);
  const [draft, setDraft] = useState(''),
    [attachments, setAttachments] = useState<string[]>([]),
    [sendMode, setSendMode] = useState<'steer' | 'followUp'>('steer');
  const [images, setImages] = useState<ImageAttachment[]>([]),
    [commandIndex, setCommandIndex] = useState(0),
    [hideCommands, setHideCommands] = useState(false);
  const [fileQuery, setFileQuery] = useState<string | null>(null),
    [fileResults, setFileResults] = useState<string[]>([]);
  const recall = useRef(-1);
  const composerDraft = useRef({ draft, attachments, images });
  const input = useRef<HTMLTextAreaElement>(null),
    commandList = useRef<HTMLDivElement>(null);
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
  composerDraft.current = { draft, attachments, images };
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
    commandList.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [commandIndex]);
  return {
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
    hideCommands,
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
  };
}
