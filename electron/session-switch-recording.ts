import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppEvent, SessionSwitchEventRecording } from '../shared/types';

/** Temporary passive recorder. Times are local to the main process, never renderer times. */
export interface MainSwitchRecord {
  at: number;
  phase: string;
  invocationId?: string;
  targetId?: string;
  saveId?: number;
  source?: string;
  snapshotSelectedId?: string;
  selectedId?: string;
  runtimeId?: string;
  eventSeq?: number;
  contentsLength?: number;
  outcome?: 'ok' | 'error';
  mode?: 'reuse' | 'restart';
  fileKind?: 'state' | 'backup' | 'upgrade';
  attempt?: number;
}
type Details = Omit<MainSwitchRecord, 'at' | 'phase'>;
export type SaveRecording = Readonly<
  Pick<Details, 'invocationId' | 'targetId' | 'saveId' | 'source' | 'snapshotSelectedId'>
>;
interface Invocation {
  readonly invocationId: string;
  readonly targetId?: string;
  active: boolean;
}

export class SessionSwitchRecorder {
  private readonly events: MainSwitchRecord[] = [];
  private dropped = 0;
  private observerErrors = 0;
  private nextSave = 0;
  private nextEvent = 0;
  private nextInvocation = 0;
  private readonly context = new AsyncLocalStorage<Invocation>();
  private readonly saves = new WeakMap<Promise<void>, SaveRecording>();
  constructor(
    readonly capacity = 12000,
    private readonly now: () => number = () => performance.now(),
  ) {}
  private current(): Details {
    const context = this.context.getStore();
    return context?.active
      ? { invocationId: context.invocationId, targetId: context.targetId }
      : { invocationId: undefined, targetId: undefined };
  }
  record(phase: string, details?: Details) {
    try {
      if (this.events.length >= this.capacity) {
        this.dropped++;
        return;
      }
      this.events.push({ at: this.now(), phase, ...this.current(), ...details });
    } catch {
      // An observer must not turn a successful application operation into a failure.
      this.observerErrors++;
    }
  }
  invoke<T>(invocationId: unknown, targetId: unknown, action: () => T): T {
    const context: Invocation = {
      invocationId:
        typeof invocationId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(invocationId)
          ? invocationId
          : `main-${++this.nextInvocation}`,
      targetId: typeof targetId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(targetId) ? targetId : undefined,
      active: true,
    };
    // Return the original operation, without adding a settlement microtask.
    return this.context.run(context, () => {
      this.record('ipc.select.received');
      return action();
    });
  }
  finishInvocation(outcome: 'ok' | 'error') {
    this.record('ipc.select.end', { outcome });
    const context = this.context.getStore();
    if (context) context.active = false;
  }
  beginSave(source: string, snapshotSelectedId?: string): SaveRecording | undefined {
    try {
      return Object.freeze({ ...this.current(), saveId: ++this.nextSave, source, snapshotSelectedId });
    } catch {
      this.observerErrors++;
    }
  }
  saved(phase: string, save?: SaveRecording, details?: Details) {
    if (save) this.record(phase, { ...save, ...details });
  }
  associateSave(promise: Promise<void>, save?: SaveRecording) {
    if (save) this.saves.set(promise, save);
  }
  saveFor(promise: Promise<void>) {
    return this.saves.get(promise);
  }
  event(event: AppEvent, origin?: SaveRecording | string): SessionSwitchEventRecording | undefined {
    if (!['state', 'runtime', 'runtimePatch'].includes(event.type)) return;
    try {
      const source = typeof origin === 'string' ? origin : (origin?.source ?? `main.${event.type}`);
      const captured = typeof origin === 'object' ? origin : this.current();
      const metadata: SessionSwitchEventRecording = {
        eventSeq: ++this.nextEvent,
        invocationId: captured.invocationId,
        saveId: 'saveId' in captured ? captured.saveId : undefined,
        source,
        snapshotSelectedId: 'snapshotSelectedId' in captured ? captured.snapshotSelectedId : undefined,
      };
      this.record('event.send', {
        ...captured,
        ...metadata,
        selectedId: event.type === 'state' ? event.state.selectedSessionId : undefined,
        runtimeId:
          event.type === 'runtime'
            ? event.runtime.sessionId
            : event.type === 'runtimePatch'
              ? event.patch.sessionId
              : undefined,
      });
      event.sessionSwitchRecording = metadata;
      return metadata;
    } catch {
      this.observerErrors++;
    }
  }
  snapshot() {
    return {
      version: 1 as const,
      clock: 'main.performance.now' as const,
      enabled: true as const,
      capacity: this.capacity,
      dropped: this.dropped,
      observerErrors: this.observerErrors,
      events: this.events.map((event) => ({ ...event })),
    };
  }
}

// No recorder, timer, buffer, context, or promise-map allocation in the default path.
export const sessionSwitchRecording =
  process.env.PI_SESSION_SWITCH_RECORD === '1' ? new SessionSwitchRecorder() : undefined;
if (sessionSwitchRecording) {
  // Test runner reads this through Electron app.evaluate once at the end of a sample block.
  // No public IPC endpoint and no per-event disk or console output.
  (
    globalThis as typeof globalThis & {
      __sessionSwitchRecording?: Pick<SessionSwitchRecorder, 'snapshot'>;
    }
  ).__sessionSwitchRecording = { snapshot: () => sessionSwitchRecording.snapshot() };
}
