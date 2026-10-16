import type { DesktopApi } from './types';

/** Diagnostic-only, monotonic points in the main process. Never persist in Store. */
export interface SessionSwitchTrace {
  switchId: string;
  sessionId: string;
  clockDomain: 'main-performance';
  points: {
    ipcReceived: number;
    terminalGuardStarted?: number;
    terminalGuardFinished?: number;
    handlerStarted?: number;
    connectEnqueued?: number;
    connectStarted?: number;
    backendStarted?: number;
    backendFinished?: number;
    saveAndStateStarted?: number;
    saveAndStateFinished?: number;
    handlerFinished?: number;
  };
  outcome?: 'fulfilled' | 'rejected';
}
export function createSessionSwitchTrace(
  switchId: unknown,
  sessionId: string,
  ipcReceived: number,
): SessionSwitchTrace | undefined {
  if (switchId === undefined) return;
  if (
    typeof switchId !== 'string' ||
    switchId.length !== 36 ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(switchId)
  )
    throw new Error('无效会话切换诊断 ID');
  return { switchId, sessionId, clockDomain: 'main-performance', points: { ipcReceived } };
}
export interface RendererSwitchPoint {
  switchId: string;
  sessionId: string;
  phase: 'invoke' | 'invokeSettled';
  at: number;
  outcome?: 'fulfilled' | 'rejected';
}
/** No ID, observer, or extra IPC argument on the ordinary, uninstrumented path. */
export function selectSessionWithTrace(
  api: Pick<DesktopApi, 'invoke'>,
  sessionId: string,
  observe?: (point: RendererSwitchPoint) => void,
) {
  if (!observe) return api.invoke('selectSession', sessionId);
  const switchId = crypto.randomUUID();
  observe({ switchId, sessionId, phase: 'invoke', at: performance.now() });
  return api.invoke('selectSession', sessionId, switchId).then(
    (result) => {
      observe({ switchId, sessionId, phase: 'invokeSettled', at: performance.now(), outcome: 'fulfilled' });
      return result;
    },
    (error) => {
      observe({ switchId, sessionId, phase: 'invokeSettled', at: performance.now(), outcome: 'rejected' });
      throw error;
    },
  );
}
