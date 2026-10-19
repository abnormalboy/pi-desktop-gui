import fs from 'node:fs/promises';
import type { Session } from '../shared/types';
import { readSessionFile, type Store } from './store';

/** Durable user state must survive reuse and explicitly requested empty-session cleanup. */
export function hasSessionData(session: Session): boolean {
  return Boolean(
    session.lastStatus !== 'idle' ||
    session.cwd ||
    session.unread ||
    session.title !== (session.projectId ? '新会话' : '新对话') ||
    session.model ||
    session.thinking !== undefined ||
    session.approvalMode !== undefined ||
    session.pinned ||
    session.draft ||
    session.attachments.length ||
    session.images?.length ||
    session.draftSnippets?.length ||
    session.stats?.tokens ||
    session.stats?.cost,
  );
}

/** Reuse only untouched desktop placeholders; never infer emptiness from a missing file. */
export function isReusableSession(session: Session): boolean {
  return !session.file && !hasSessionData(session);
}

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
  for (const session of store.state.sessions) {
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
