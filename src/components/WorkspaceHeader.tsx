import {
  GitBranch,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Command,
} from 'lucide-react';
import { shortcut } from '../lib/platform';
import { IconButton } from './IconButton';
import type { Workbench } from '../hooks/useWorkbench';

export function WorkspaceHeader(
  props: Pick<
    Workbench,
    | 'setFeatureTab'
    | 'sidebar'
    | 'setSidebar'
    | 'compact'
    | 'inspector'
    | 'setInspector'
    | 'changes'
    | 'selected'
    | 'project'
    | 'ownRuntime'
    | 'running'
  >,
) {
  const {
    setFeatureTab,
    sidebar,
    setSidebar,
    compact,
    inspector,
    setInspector,
    changes,
    selected,
    project,
    ownRuntime,
    running,
  } = props;

  return (
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
  );
}
