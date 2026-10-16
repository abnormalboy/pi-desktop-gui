import { SettingsForm } from '../SettingsForm';
import type { FeatureModel } from './usePiFeatures';
export function PreferencesTab({
  session,
  setNotice,
  setFormDirty,
  pending,
  operationReason,
  projectEnabled,
  reportError,
  run,
}: Pick<
  FeatureModel,
  | 'session'
  | 'setNotice'
  | 'setFormDirty'
  | 'pending'
  | 'operationReason'
  | 'projectEnabled'
  | 'reportError'
  | 'run'
>) {
  return (
    <>
      <h3>常用设置</h3>
      <SettingsForm
        session={session}
        disabled={pending}
        saveReason={operationReason}
        projectEnabled={projectEnabled}
        reportError={reportError}
        run={run}
        notify={setNotice}
        dirtyChange={setFormDirty}
      />
    </>
  );
}
