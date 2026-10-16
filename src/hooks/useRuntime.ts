import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  applyRuntimePatch,
  emptyRuntime,
  type AppState,
  type Runtime,
  type Environment,
  type Settings,
  type StorageStatus,
} from '../../shared/types';
import { readableError } from '../lib/format';
import type { UpdateState } from '../../shared/app-update';
const api = window.desktop;
export function useRuntime(
  setError: (value: string) => void,
  setPrefs: Dispatch<SetStateAction<Settings | undefined>>,
) {
  const [state, setState] = useState<AppState>(),
    [runtime, setRuntime] = useState<Runtime>(emptyRuntime),
    [environment, setEnvironment] = useState<Environment>(),
    [update, setUpdate] = useState<UpdateState>(),
    [storage, setStorage] = useState<StorageStatus>({ writable: false });
  useEffect(() => {
    let alive = true;
    const unsubscribe = api.onEvent((event) => {
      if (!alive) return;
      window.__sessionSwitchRecorder?.event(event);
      if (event.type === 'state') setState(event.state);
      else if (event.type === 'storage') setStorage(event.storage);
      else if (event.type === 'update') setUpdate(event.update);
      else if (event.type === 'runtimePatch')
        setRuntime((previous) => applyRuntimePatch(previous, event.patch));
      else if (event.type === 'runtime') setRuntime(event.runtime);
    });
    api
      .invoke('bootstrap')
      .then((v) => {
        if (!alive) return;
        setState(v.state);
        setRuntime(v.runtime);
        setEnvironment(v.environment);
        setPrefs(v.state.settings);
        setStorage(v.storage);
        setUpdate(v.update);
      })
      .catch((e) => setError(readableError(e)));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return { state, setState, runtime, environment, setEnvironment, storage, update };
}
