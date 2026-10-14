import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopApi, AppEvent } from '../shared/types';
const api: DesktopApi = {
  invoke: (method, ...args) => ipcRenderer.invoke('desktop:invoke', method, args),
  onEvent: (listener) => {
    const handler = (_event: unknown, value: AppEvent) => listener(value);
    ipcRenderer.on('desktop:event', handler);
    return () => ipcRenderer.removeListener('desktop:event', handler);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  platform: process.platform,
};
contextBridge.exposeInMainWorld('desktop', api);
