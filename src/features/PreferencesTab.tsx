import { SettingsForm } from '../SettingsForm';
import type { FeatureModel } from './usePiFeatures';
export function PreferencesTab({
  session,
  setNotice,
  setFormDirty,
  disabled,
  run,
}: Pick<FeatureModel, 'session' | 'setNotice' | 'setFormDirty' | 'disabled' | 'run'>) {
  return (
    <>
      <h3>常用设置</h3>
      <SettingsForm
        session={session}
        disabled={disabled}
        run={run}
        notify={setNotice}
        dirtyChange={setFormDirty}
      />
    </>
  );
}
