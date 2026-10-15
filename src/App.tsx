import { useWorkbench } from './hooks/useWorkbench';
import { LoaderCircle } from 'lucide-react';
import { Conversation } from './components/Conversation';
import { Sidebar } from './components/Sidebar';
import { WorkspaceHeader } from './components/WorkspaceHeader';
import { Inspector } from './components/Inspector';
import { Toasts } from './components/Toasts';
import { WorkbenchDialogs } from './components/WorkbenchDialogs';
import { Composer } from './components/Composer';
import { SettingsModal } from './components/SettingsModal';
export default function App() {
  const model = useWorkbench();
  const { state, compact, columns, error } = model;
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
      <Sidebar {...model} state={state} />
      <main className="workspace">
        <WorkspaceHeader {...model} />
        <div ref={columns} className={'workspace-columns' + (compact ? ' compact' : '')}>
          <Conversation {...model} state={state}>
            <Composer {...model} state={state} />
          </Conversation>
          <Inspector {...model} state={state} />
        </div>
      </main>
      <Toasts {...model} />
      <WorkbenchDialogs {...model} state={state} settings={<SettingsModal {...model} />} />
    </div>
  );
}
