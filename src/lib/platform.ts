const api = window.desktop;

export const platform = {
  mac: api.platform === 'darwin',
  trash: api.platform === 'win32' ? '回收站' : '废纸篓',
  fileManager: api.platform === 'win32' ? '资源管理器' : api.platform === 'darwin' ? '访达' : '文件管理器',
};
export const modKey = platform.mac ? '⌘' : 'Ctrl';
export const shortcut = (key: string) => (platform.mac ? '⌘' + key : 'Ctrl+' + key);
export const mod = (e: { ctrlKey: boolean; metaKey: boolean }) => (platform.mac ? e.metaKey : e.ctrlKey);
