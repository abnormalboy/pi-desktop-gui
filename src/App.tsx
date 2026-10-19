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
import { StorageBanner } from './components/StorageBanner';
import { CrashCard } from './components/CrashCard';
import { useState } from 'react';
import { AboutUpdates, UpdateBadge, UpdateDialog } from './components/Updates';
import { ResizeHandle } from './components/ResizeHandle';
import { CheckpointDialog } from './components/CheckpointDialog';
export default function App() {
  const model = useWorkbench();
  const [updateOpen, setUpdateOpen] = useState(false);
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
  const updateBusy = model.anyRunning || model.pending;
  const installUpdate = async () => {
    if (model.selected && model.storage.writable)
      await window.desktop.invoke(
        'saveDraft',
        model.selected.id,
        model.draft,
        model.attachments,
        model.images,
        model.snippets,
      );
    await window.desktop.invoke('installUpdate');
  };
  const updatePanel = model.update && (
    <AboutUpdates
      update={model.update}
      busy={updateBusy}
      install={installUpdate}
      autoDownload={state.settings.autoDownloadUpdates}
      readOnly={!model.storage.writable}
      saveAutoDownload={async (value) => {
        await window.desktop.invoke('saveSettings', { autoDownloadUpdates: value });
        model.setPrefs((previous) => previous && { ...previous, autoDownloadUpdates: value });
      }}
    />
  );
  const saveWidth = (key: 'sidebarWidth' | 'inspectorWidth', width: number) => {
    model.setPrefs((previous) => previous && { ...previous, [key]: width });
    void model.attempt(() => window.desktop.invoke('saveSettings', { [key]: width }));
  };
  return (
    <div className="app-shell">
      <Sidebar
        {...model}
        state={state}
        updateBadge={<UpdateBadge update={model.update} open={() => setUpdateOpen(true)} />}
      />
      {model.sidebar && !compact && (
        <ResizeHandle
          label="项目侧栏宽度"
          variable="--sidebar-width"
          value={state.settings.sidebarWidth}
          min={180}
          max={360}
          defaultValue={240}
          direction={1}
          save={(width) => saveWidth('sidebarWidth', width)}
        />
      )}
      <main className="workspace">
        <StorageBanner
          storage={model.storage}
          openDirectory={() => void model.attempt(() => window.desktop.invoke('revealData'))}
        />
        <WorkspaceHeader {...model} />
        <div ref={columns} className={'workspace-columns' + (compact ? ' compact' : '')}>
          <Conversation
            {...model}
            state={state}
            recovery={
              model.ownRuntime && model.runtime.crash && model.selected ? (
                <CrashCard
                  key={model.runtime.crash.at}
                  crash={model.runtime.crash}
                  projectId={model.project?.id}
                  sessionId={model.selected.id}
                  disabled={model.pending || model.running || !model.storage.writable}
                  recover={(prompt) =>
                    model.action(() => window.desktop.invoke('recover', model.selected!.id, prompt))
                  }
                  inspect={() => {
                    model.setChangeMode('run');
                    model.setTab('changes');
                    model.setInspector(true);
                  }}
                  undo={() => model.revert(null)}
                  diagnostic={() => model.openSettings('diagnostic')}
                />
              ) : null
            }
          >
            <Composer {...model} state={state} />
          </Conversation>
          {model.inspector && !compact && (
            <ResizeHandle
              label="文件面板宽度"
              variable="--inspector-width"
              value={state.settings.inspectorWidth}
              min={300}
              max={720}
              defaultValue={380}
              direction={-1}
              save={(width) => saveWidth('inspectorWidth', width)}
            />
          )}
          <Inspector {...model} state={state} />
        </div>
      </main>
      <Toasts {...model} />
      <WorkbenchDialogs
        {...model}
        state={state}
        settings={<SettingsModal {...model} updatePanel={updatePanel} />}
      />
      {model.checkpointPreview && (
        <CheckpointDialog
          key={model.checkpointPreview.id + model.checkpointPreview.revision}
          preview={model.checkpointPreview}
          pending={model.pending}
          restoredCount={model.checkpointRestoredCount}
          onClose={model.closeCheckpoint}
          onConfirm={(paths, revision) => void model.confirmCheckpoint(paths, revision)}
          onReturnToMessage={() => void model.returnToCheckpointMessage()}
        />
      )}
      {updateOpen && model.update && (
        <UpdateDialog
          update={model.update}
          busy={updateBusy}
          install={installUpdate}
          close={() => setUpdateOpen(false)}
        />
      )}
    </div>
  );
}
