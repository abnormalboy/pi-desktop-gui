import type { DesktopApi } from '../shared/types';
declare global {
  const __APP_VERSION__: string;
  interface Window {
    desktop: DesktopApi;
  }
}
