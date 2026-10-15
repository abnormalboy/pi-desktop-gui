export type UpdateInstallation = 'nsis' | 'portable' | 'appimage' | 'deb' | 'mac' | 'development';
export interface UpdateState {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';
  currentVersion: string;
  installation: UpdateInstallation;
  mode: 'auto' | 'notify';
  enabled: boolean;
  disabledReason?: string;
  checkedAt?: number;
  version?: string;
  progress?: number;
  notes?: string;
  error?: string;
  installing: boolean;
}

export const RELEASES_URL = 'https://github.com/yeyuProject/pi-desktop-gui/releases';
export const LATEST_RELEASE_API = 'https://api.github.com/repos/yeyuProject/pi-desktop-gui/releases/latest';
export const installationLabels: Record<UpdateInstallation, string> = {
  nsis: 'Windows 安装版',
  portable: 'Windows 便携版',
  appimage: 'Linux AppImage',
  deb: 'Linux deb',
  mac: 'macOS',
  development: '开发环境',
};

/** The desktop release channel accepts stable x.y.z versions only. */
export function stableVersion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(value);
  if (!match || !match[1].split('.').every((part) => Number.isSafeInteger(Number(part)))) return undefined;
  return match[1];
}
export function compareAppVersions(left: string, right: string) {
  const a = stableVersion(left),
    b = stableVersion(right);
  if (!a || !b) throw new Error('应用版本号无效');
  const partsA = a.split('.').map(Number),
    partsB = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (partsA[i] !== partsB[i]) return Math.sign(partsA[i] - partsB[i]);
  return 0;
}
export function releaseUrl(version?: string) {
  const valid = stableVersion(version);
  return valid ? `${RELEASES_URL}/tag/v${valid}` : RELEASES_URL;
}
