import {
  Plus,
  FolderOpen,
  ChevronDown,
  Settings2,
  Search,
  LoaderCircle,
  Download,
  MoreHorizontal,
  MessageSquare,
  Pencil,
  Trash2,
  Import,
  Pin,
  PinOff,
} from 'lucide-react';
import { type Session } from '../../shared/types';
import { platform, shortcut } from '../lib/platform';
import { IconButton } from './IconButton';
const api = window.desktop;
import type { Workbench } from '../hooks/useWorkbench';
import type { ReactNode } from 'react';
import type { AppState } from '../../shared/types';

export function Sidebar(
  props: Pick<
    Workbench,
    | 'state'
    | 'runtime'
    | 'environment'
    | 'setNotice'
    | 'sidebar'
    | 'compact'
    | 'inspector'
    | 'setSearchOpen'
    | 'setRename'
    | 'menuId'
    | 'setMenuId'
    | 'selected'
    | 'project'
    | 'running'
    | 'attempt'
    | 'addProject'
    | 'selectSession'
    | 'createSession'
    | 'openSettings'
  > & { state: AppState; updateBadge: ReactNode },
) {
  const {
    state,
    runtime,
    environment,
    setNotice,
    sidebar,
    compact,
    inspector,
    setSearchOpen,
    setRename,
    menuId,
    setMenuId,
    selected,
    project,
    running,
    attempt,
    addProject,
    selectSession,
    createSession,
    openSettings,
  } = props;
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
  return (
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
        {props.updateBadge}
      </div>
    </aside>
  );
}
