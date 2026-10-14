import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { PiSessionInfo, Session, SessionMatch } from '../shared/types';
import { pathKey } from './platform';

const HEAD_BYTES = 64 * 1024;
const SEARCH_LIMIT = 16 * 1024 * 1024;

async function jsonlFiles(root: string, depth = 2): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isFile() && e.name.endsWith('.jsonl')) found.push(full);
    else if (e.isDirectory() && depth > 0) found.push(...(await jsonlFiles(full, depth - 1)));
  }
  return found;
}

const textOf = (content: unknown) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((b) => b?.type === 'text')
          .map((b) => String(b.text ?? ''))
          .join('\n')
      : '';

async function head(file: string) {
  const input = createReadStream(file, { encoding: 'utf8' });
  const reader = createInterface({ input, crlfDelay: Infinity });
  const lines: string[] = [];
  let bytes = 0;
  try {
    for await (const line of reader) {
      lines.push(line);
      bytes += Buffer.byteLength(line, 'utf8') + 1;
      // Finish the JSONL record even when an image takes it beyond the preview budget.
      if (bytes >= HEAD_BYTES) break;
    }
    return lines;
  } finally {
    reader.close();
    input.destroy();
  }
}

export async function listPiSessions(roots: string[], known: Set<string>): Promise<PiSessionInfo[]> {
  const files = [...new Set((await Promise.all(roots.map((r) => jsonlFiles(r)))).flat())];
  const result: PiSessionInfo[] = [];
  for (const file of files) {
    if (known.has(pathKey(file))) continue;
    try {
      const stat = await fs.stat(file);
      const lines = await head(file);
      const header = JSON.parse(lines[0]);
      if (header?.type !== 'session' || typeof header.cwd !== 'string') continue;
      let name: string | undefined,
        preview = '',
        hasUserMessage = false;
      for (const line of lines.slice(1)) {
        try {
          const e = JSON.parse(line);
          if (e.type === 'session_info' && e.name) name = String(e.name);
          if (e.type === 'message' && e.message?.role === 'user') {
            hasUserMessage = true;
            if (!preview) preview = textOf(e.message.content).replace(/\s+/g, ' ').slice(0, 120);
          }
        } catch {}
      }
      if (!hasUserMessage && !name) continue;
      result.push({ file, name, cwd: header.cwd, preview, updatedAt: stat.mtimeMs });
    } catch {}
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200);
}

export async function searchSessionContents(sessions: Session[], query: string): Promise<SessionMatch[]> {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const matches: SessionMatch[] = [];
  for (const s of sessions) {
    if (!s.file) continue;
    try {
      if ((await fs.stat(s.file)).size > SEARCH_LIMIT) continue;
      const raw = await fs.readFile(s.file, 'utf8');
      for (const line of raw.split('\n')) {
        let text = '';
        try {
          const e = JSON.parse(line);
          if (e.type === 'message' && ['user', 'assistant'].includes(e.message?.role))
            text = textOf(e.message.content);
        } catch {}
        const at = text.toLowerCase().indexOf(needle);
        if (at < 0) continue;
        const start = Math.max(0, at - 30);
        matches.push({
          sessionId: s.id,
          snippet:
            (start ? '…' : '') +
            text
              .slice(start, at + needle.length + 60)
              .replace(/\s+/g, ' ')
              .trim(),
        });
        break;
      }
    } catch {}
    if (matches.length >= 30) break;
  }
  return matches;
}
