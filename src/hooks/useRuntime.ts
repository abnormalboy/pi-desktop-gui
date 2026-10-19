import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
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
  const [snapshot, setSnapshot] = useState<{ state: AppState; revision: number }>(),
    [runtimes, setRuntimes] = useState<Record<string, Runtime>>({}),
    [environment, setEnvironment] = useState<Environment>(),
    [update, setUpdate] = useState<UpdateState>(),
    [storage, setStorage] = useState<StorageStatus>({ writable: false });
  const receivedState = useRef<{ state?: AppState; revision: number }>({ revision: 0 });
  const receiveState = (state: AppState, revision: number) => {
    if (!Number.isSafeInteger(revision) || revision <= receivedState.current.revision) return;
    const next = { state, revision };
    receivedState.current = next;
    setSnapshot(next);
  };
  useEffect(() => {
    let alive = true;
    const unsubscribe = api.onEvent((event) => {
      if (!alive) return;
      if (event.type === 'state') receiveState(event.state, event.revision);
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
        receiveState(v.state, v.revision);
        if (v.runtime.sessionId) {
          const id = v.runtime.sessionId;
          setRuntimes((previous) => ({ ...previous, [id]: v.runtime }));
        }
        setEnvironment(v.environment);
        setPrefs((previous) => previous ?? receivedState.current.state?.settings ?? v.state.settings);
        setStorage(v.storage);
        setUpdate(v.update);
      })
      .catch((e) => setError(readableError(e)));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  const state = snapshot?.state;
  const runtime = (state?.selectedSessionId && runtimes[state.selectedSessionId]) || noRuntime;
  const anyRunning = Object.values(runtimes).some((item) => busy(item.status) || item.dialogs.length > 0);
  return {
    state,
    stateRevision: snapshot?.revision ?? 0,
    receivedState,
    receiveState,
    runtime,
    anyRunning,
    environment,
    setEnvironment,
    storage,
    update,
  };
}
