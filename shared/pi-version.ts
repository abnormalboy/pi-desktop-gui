// The tested runtime and the supported protocol line are deliberately separate.
export const VERIFIED = '1.1.0';
export const COMPATIBLE = '1.1';
export const PI_INSTALL_COMMAND = `npm install -g --ignore-scripts @earendil-works/pi-coding-agent@${COMPATIBLE}`;
export const PI_SOURCE_URL = `https://github.com/earendil-works/pi/blob/v${VERIFIED}/packages/coding-agent`;
export type PiCompatibility = 'verified' | 'compatible' | 'tooOld' | 'tooNew' | 'unknown';
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\w.-]+))?(?:\+([\w.-]+))?$/;

export function classifyPiVersion(version: string | undefined): PiCompatibility {
  const parsed = version && versionPattern.exec(version);
  if (!parsed || !parsed.slice(1, 4).every((part) => Number.isSafeInteger(Number(part)))) return 'unknown';
  const [major, minor] = parsed.slice(1, 3).map(Number);
  const [supportedMajor, supportedMinor] = COMPATIBLE.split('.').map(Number);
  if (major < supportedMajor || (major === supportedMajor && minor < supportedMinor)) return 'tooOld';
  if (major > supportedMajor || (major === supportedMajor && minor > supportedMinor)) return 'tooNew';
  return version === VERIFIED ? 'verified' : 'compatible';
}

export const compatibilityLabels: Record<PiCompatibility, string> = {
  verified: '已验证',
  compatible: '兼容',
  tooOld: '过旧',
  tooNew: '过新',
  unknown: '未知',
};
export function compatibilityMessage(
  version: string | undefined,
  compatibility = classifyPiVersion(version),
) {
  if (compatibility === 'verified') return '';
  if (compatibility === 'compatible')
    return `Pi ${version}${version?.includes('-') ? '（预发布版）' : ''} 与已验证的 ${VERIFIED} 属于同一版本线，可正常使用；如遇问题请在诊断中附上版本号。`;
  if (compatibility === 'tooOld') return `Pi ${version} 版本过旧，请升级到 ${COMPATIBLE} 系列。`;
  if (compatibility === 'tooNew')
    return `此版本 Pi Desktop 尚未适配 Pi ${version}，请更新 Pi Desktop，或安装 ${COMPATIBLE} 系列。`;
  return `未检测到可识别的 Pi 版本，请检查入口或安装 ${COMPATIBLE} 系列。`;
}
