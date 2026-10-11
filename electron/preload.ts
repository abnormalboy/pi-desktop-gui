import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, AppEvent } from '../shared/types';
const api: DesktopApi = {
  invoke: (method, ...args) => ipcRenderer.invoke('desktop:invoke', method, args),
  onEvent: (listener) => {
    const handler = (_event: unknown, value: AppEvent) => listener(value);
    ipcRenderer.on('desktop:event', handler);
    return () => ipcRenderer.removeListener('desktop:event', handler);
  },
};
contextBridge.exposeInMainWorld('desktop', api);
