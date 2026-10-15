import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { isWindows } from '../platform';

/** Pi 1.1.x native write/edit path semantics, verified against utils/paths.ts. */
export function normalizePiToolPath(cwd: string, value: string): string {
  let normalized = value.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
  if (normalized.startsWith('@')) normalized = normalized.slice(1);
  if (isWindows && normalized.startsWith('/') && !normalized.startsWith('//') && !normalized.includes('\\')) {
    const match = /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i.exec(normalized);
    if (match) normalized = `${match[1].toUpperCase()}:\\${match[2]?.replaceAll('/', '\\') ?? ''}`;
  }
  if (normalized === '~') normalized = os.homedir();
  else if (normalized.startsWith('~/') || (isWindows && normalized.startsWith('~\\')))
    normalized = path.join(os.homedir(), normalized.slice(2));
  if (normalized.startsWith('file://')) normalized = fileURLToPath(normalized);
  return path.resolve(cwd, normalized);
}
