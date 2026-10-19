import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  applyRuntimePatch,
  busy,
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
const noRuntime = emptyRuntime();
export function useRuntime(
  setError: (value: string) => void,
  setPrefs: Dispatch<SetStateAction<Settings | undefined>>,
) {
  const [state, setState] = useState<AppState>(),
    [runtimes, setRuntimes] = useState<Record<string, Runtime>>({}),
    [environment, setEnvironment] = useState<Environment>(),
    [update, setUpdate] = useState<UpdateState>(),
    [storage, setStorage] = useState<StorageStatus>({ writable: false });
  useEffect(() => {
    let alive = true;
    const unsubscribe = api.onEvent((event) => {
      if (!alive) return;
      if (event.type === 'state') setState(event.state);
      else if (event.type === 'storage') setStorage(event.storage);
      else if (event.type === 'update') setUpdate(event.update);
      else if (event.type === 'runtimeRemoved') {
        setRuntimes((previous) => {
          const next = { ...previous };
          delete next[event.sessionId];
          return next;
        });
      } else if (event.type === 'runtimePatch' && event.patch.sessionId) {
        const id = event.patch.sessionId;
        setRuntimes((previous) => ({
          ...previous,
          [id]: applyRuntimePatch(previous[id] ?? emptyRuntime(), event.patch),
        }));
      } else if (event.type === 'runtime' && event.runtime.sessionId) {
        const id = event.runtime.sessionId;
        setRuntimes((previous) => ({ ...previous, [id]: event.runtime }));
      }
    });
    api
      .invoke('bootstrap')
      .then((v) => {
        if (!alive) return;
        setState(v.state);
        if (v.runtime.sessionId) {
          const id = v.runtime.sessionId;
          setRuntimes((previous) => ({ ...previous, [id]: v.runtime }));
        }
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
  const runtime = (state?.selectedSessionId && runtimes[state.selectedSessionId]) || noRuntime;
  const anyRunning = Object.values(runtimes).some((item) => busy(item.status) || item.dialogs.length > 0);
  return { state, setState, runtime, anyRunning, environment, setEnvironment, storage, update };
}
