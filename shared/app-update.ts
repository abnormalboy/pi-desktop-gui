export type UpdateInstallation = 'nsis' | 'portable' | 'appimage' | 'deb' | 'mac' | 'development';
export interface UpdateInstallAttempt {
  currentVersion: string;
  targetVersion: string;
  startedAt: number;
  outcome: 'pending' | 'failed' | 'unconfirmed' | 'completed';
}
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
  lastInstall?: UpdateInstallAttempt;
}

export function updateInstallNotice(update: UpdateState) {
  const attempt = update.lastInstall;
  if (!attempt || !['failed', 'unconfirmed'].includes(attempt.outcome)) return undefined;
  if (compareAppVersions(update.currentVersion, attempt.targetVersion) >= 0) return undefined;
  const versions = `上次尝试更新到 v${attempt.targetVersion}，当前仍是 v${update.currentVersion}。`;
  return attempt.outcome === 'failed'
    ? `${versions}无法启动更新安装程序，或安装程序报告了错误。请重试或下载完整安装包。`
    : `${versions}尚未确认更新完成。如果安装程序仍在运行，请等待完成；否则可重试或下载完整安装包。`;
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
