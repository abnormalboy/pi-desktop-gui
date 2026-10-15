import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import type { WindowAction } from '../../shared/types';

interface MenuItem {
  label: string;
  action: WindowAction;
  shortcut?: string;
  separator?: boolean;
}

export const titleBarMenus: { label: string; key: string; items: MenuItem[] }[] = [
  {
    label: '文件',
    key: 'f',
    items: [
      { label: '新建对话', action: 'newSession', shortcut: 'Ctrl+N' },
      { label: '退出', action: 'close', shortcut: 'Alt+F4', separator: true },
    ],
  },
  {
    label: '编辑',
    key: 'e',
    items: [
      { label: '撤销', action: 'undo', shortcut: 'Ctrl+Z' },
      { label: '重做', action: 'redo', shortcut: 'Ctrl+Shift+Z' },
      { label: '剪切', action: 'cut', shortcut: 'Ctrl+X', separator: true },
      { label: '复制', action: 'copy', shortcut: 'Ctrl+C' },
      { label: '粘贴', action: 'paste', shortcut: 'Ctrl+V' },
      { label: '全选', action: 'selectAll', shortcut: 'Ctrl+A' },
    ],
  },
  {
    label: '视图',
    key: 'v',
    items: [
      { label: '重置缩放', action: 'resetZoom', shortcut: 'Ctrl+0' },
      { label: '放大', action: 'zoomIn', shortcut: 'Ctrl++' },
      { label: '缩小', action: 'zoomOut', shortcut: 'Ctrl+-' },
      { label: '全屏', action: 'toggleFullscreen', shortcut: 'F11', separator: true },
    ],
  },
];

interface TitleBarProps {
  title?: string;
  onError: (message: string) => void;
}

export function TitleBar(props: TitleBarProps) {
  // macOS keeps its native traffic lights and application menu.
  return window.desktop.platform === 'darwin' ? null : <DesktopTitleBar {...props} />;
}

function DesktopTitleBar({ title = 'Pi Desktop', onError }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [activeMenu, setActiveMenu] = useState(0);
  const root = useRef<HTMLElement>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndex = useRef(0);
  const restoreTarget = useRef<HTMLElement | null>(null);
  const selection = useRef<Range | null>(null);
  const inputSelection = useRef<{
    start: number;
    end: number;
    direction: 'forward' | 'backward' | 'none';
  } | null>(null);

  const rememberFocus = (target = document.activeElement) => {
    if (!(target instanceof HTMLElement) || root.current?.contains(target)) return;
    restoreTarget.current = target;
    const selected = window.getSelection();
    selection.current = selected?.rangeCount ? selected.getRangeAt(0).cloneRange() : null;
    inputSelection.current = null;
    if (
      (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) &&
      target.selectionStart !== null &&
      target.selectionEnd !== null
    ) {
      inputSelection.current = {
        start: target.selectionStart,
        end: target.selectionEnd,
        direction: target.selectionDirection ?? 'none',
      };
    }
  };

  const restoreFocus = () => {
    const target = restoreTarget.current;
    if (!target?.isConnected) return;
    target.focus({ preventScroll: true });
    if (
      inputSelection.current &&
      (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)
    ) {
      const { start, end, direction } = inputSelection.current;
      target.setSelectionRange(start, end, direction);
    } else if (selection.current?.commonAncestorContainer.isConnected) {
      const selected = window.getSelection();
      selected?.removeAllRanges();
      selected?.addRange(selection.current);
    }
  };

  const act = (action: WindowAction) => {
    setOpenMenu(null);
    // Chromium edit commands act on the focused element. Restore the editor and
    // selection before sending IPC, rather than editing the menu button itself.
    restoreFocus();
    void window.desktop.invoke('windowAction', action).catch((error: unknown) => {
      onError(error instanceof Error ? error.message : String(error));
    });
  };

  const open = (index: number, last = false) => {
    rememberFocus();
    focusIndex.current = last ? titleBarMenus[index].items.length - 1 : 0;
    setActiveMenu(index);
    setOpenMenu(index);
    if (openMenu === index) items.current[focusIndex.current]?.focus();
  };

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const unsubscribe = window.desktop.onEvent((event) => {
      if (event.type === 'windowState') {
        receivedEvent = true;
        setMaximized(event.maximized);
      }
    });
    void window.desktop
      .invoke('windowState')
      .then((state) => {
        if (active && !receivedEvent) setMaximized(state.maximized);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useLayoutEffect(() => {
    if (openMenu !== null) items.current[focusIndex.current]?.focus();
  }, [openMenu]);

  useEffect(() => {
    const dismiss = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const blur = () => setOpenMenu(null);
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('focusin', dismiss);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('focusin', dismiss);
      window.removeEventListener('blur', blur);
    };
  }, []);

  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || document.querySelector('[role="dialog"]')) return;
      const key = event.key.toLowerCase();
      const menu =
        event.altKey && !event.ctrlKey && !event.metaKey
          ? titleBarMenus.findIndex((menu) => menu.key === key)
          : -1;
      if (menu >= 0) {
        event.preventDefault();
        open(menu);
      } else if (
        event.key === 'F10' &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        if (root.current?.contains(document.activeElement)) {
          setOpenMenu(null);
          restoreFocus();
        } else {
          rememberFocus();
          triggers.current[activeMenu]?.focus();
        }
      } else {
        const action =
          event.key === 'F11' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
            ? 'toggleFullscreen'
            : event.ctrlKey && !event.altKey && !event.metaKey
              ? key === '0'
                ? 'resetZoom'
                : key === '+' || key === '='
                  ? 'zoomIn'
                  : key === '-'
                    ? 'zoomOut'
                    : null
              : null;
        if (action) {
          event.preventDefault();
          rememberFocus();
          act(action);
        }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  const triggerKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open(index, event.key === 'ArrowUp');
    } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? titleBarMenus.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + titleBarMenus.length) % titleBarMenus.length;
      setActiveMenu(next);
      if (openMenu !== null) open(next);
      else triggers.current[next]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpenMenu(null);
      restoreFocus();
    }
  };

  const menuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (openMenu === null) return;
    const count = titleBarMenus[openMenu].items.length;
    const current = items.current.findIndex((item) => item === document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? count - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
      items.current[next]?.focus();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      open((openMenu + (event.key === 'ArrowRight' ? 1 : -1) + titleBarMenus.length) % titleBarMenus.length);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      event.stopPropagation();
      setOpenMenu(null);
      triggers.current[openMenu]?.focus();
    }
  };

  return (
    <header
      ref={root}
      className="app-titlebar"
      aria-label="窗口标题栏"
      onPointerDownCapture={() => rememberFocus()}
      onFocusCapture={(event) => {
        if (event.relatedTarget instanceof HTMLElement) rememberFocus(event.relatedTarget);
      }}
    >
      <span className="titlebar-brand" aria-hidden="true">
        π
      </span>
      <div className="titlebar-menubar" role="menubar" aria-label="应用菜单">
        {titleBarMenus.map((menu, index) => (
          <div className="titlebar-menu" key={menu.key}>
            <button
              ref={(node) => {
                triggers.current[index] = node;
              }}
              id={`titlebar-${menu.key}`}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openMenu === index}
              aria-controls={openMenu === index ? `titlebar-menu-${menu.key}` : undefined}
              aria-keyshortcuts={`Alt+${menu.key.toUpperCase()}`}
              tabIndex={activeMenu === index ? 0 : -1}
              onFocus={() => setActiveMenu(index)}
              onClick={() => (openMenu === index ? setOpenMenu(null) : open(index))}
              onPointerEnter={() => {
                if (openMenu !== null && openMenu !== index) open(index);
              }}
              onKeyDown={(event) => triggerKey(event, index)}
            >
              {menu.label}
            </button>
            {openMenu === index && (
              <div
                id={`titlebar-menu-${menu.key}`}
                className="titlebar-dropdown"
                role="menu"
                aria-labelledby={`titlebar-${menu.key}`}
                onKeyDown={menuKey}
              >
                {menu.items.map((item, itemIndex) => (
                  <div key={item.action} role="none">
                    {item.separator && <div className="titlebar-menu-separator" role="separator" />}
                    <button
                      ref={(node) => {
                        items.current[itemIndex] = node;
                      }}
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      onClick={() => act(item.action)}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && <kbd>{item.shortcut}</kbd>}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="titlebar-drag-region" title={title}>
        <span>{title}</span>
      </div>
      <div className="titlebar-window-controls" aria-label="窗口控制">
        <button type="button" aria-label="最小化窗口" title="最小化" onClick={() => act('minimize')}>
          <Minus size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={maximized ? '还原窗口' : '最大化窗口'}
          title={maximized ? '还原' : '最大化'}
          onClick={() => act('toggleMaximize')}
        >
          {maximized ? <Copy size={13} aria-hidden="true" /> : <Square size={12} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="titlebar-close"
          aria-label="关闭窗口"
          title="关闭窗口"
          onClick={() => act('close')}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
