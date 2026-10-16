import type { RendererSwitchPoint } from '../shared/session-switch-trace';
import type { DesktopApi } from '../shared/types';
declare global {
  const __APP_VERSION__: string;
  interface Window {
    desktop: DesktopApi;
    /** Opt-in acceptance probe; absent during ordinary use. */
    __sessionSwitchDiagnostic?: (point: RendererSwitchPoint) => void;
  }
}
