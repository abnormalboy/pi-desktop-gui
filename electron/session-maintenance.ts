import fs from 'node:fs/promises';
import type { Session } from '../shared/types';
import { readSessionFile, type Store } from './store';
import { hasSessionData } from './session-lifecycle';
export { hasSessionData, isReusableSession } from './session-lifecycle';

/** File checks are only for explicit, confirmed cleanup; nothing is removed automatically. */
export async function isEmptySession(session: Session, activeSessionId?: string): Promise<boolean> {
  if (session.id === activeSessionId || hasSessionData(session)) return false;
  if (!session.file) return true;
  try {
    return (await fs.stat(session.file)).size === 0;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

export async function fillSessionUsage(store: Store) {
  let changed = false;
  for (const session of store.durableSessions()) {
    if (session.stats) continue;
    if (!session.file) session.stats = { tokens: 0, cost: 0 };
    else {
      try {
        session.stats = (await readSessionFile(session.file)).stats;
      } catch {
        continue;
      }
    }
    changed = true;
  }
  if (changed && store.storage.writable) await store.save();
}
