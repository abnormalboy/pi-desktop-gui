import type { AppEvent, DesktopApi } from '../shared/types';
declare global {
  const __APP_VERSION__: string;
  interface Window {
    desktop: DesktopApi;
    /** Installed only by the explicit session-switch diagnostic runner. */
    __sessionSwitchRecorder?: {
      invoke(targetId: string): string;
      settled(invocationId: string, outcome: 'ok' | 'error'): void;
      event(event: AppEvent): void;
      reactEffect(selectedId: string | undefined, runtimeId: string | undefined, messageCount: number): void;
    };
  }
}
