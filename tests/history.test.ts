import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { listPiSessions, searchSessionContents } from '../electron/history';
import type { Session } from '../shared/types';

async function sandbox() {
  const root = path.resolve('work/tests');
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, 'history-'));
}

test('content search matches decoded Windows paths and quoted text', async () => {
  const dir = await sandbox();
  const file = path.join(dir, 'search.jsonl');
  const text = 'Open C:\\sample\\report.txt and find "quoted value"';
  await fs.writeFile(
    file,
    JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n',
  );
  const session: Session = {
    id: 'search-session',
    title: 'Search',
    file,
    draft: '',
    attachments: [],
    updatedAt: 0,
    lastStatus: 'idle',
  };
  for (const query of ['c:\\sample\\report.txt', '"quoted value"']) {
    const matches = await searchSessionContents([session], query);
    assert.equal(matches.length, 1, query);
    assert.equal(matches[0].sessionId, session.id);
    assert.ok(matches[0].snippet.toLowerCase().includes(query));
  }
  assert.deepEqual(await searchSessionContents([session], 'not present'), []);
});

test('Pi history keeps complete image records and sessions without a text preview', async () => {
  const dir = await sandbox();
  const data = (await fs.readFile(path.resolve('docs/assets/features-v0.2.0.png'))).toString('base64');
  assert.ok(data.length > 64 * 1024);
  const image = { type: 'image', mimeType: 'image/png', data };
  for (const [name, content] of [
    ['with-text', [{ type: 'text', text: 'Find this screenshot' }, image]],
    ['image-only', [image]],
  ] as const) {
    await fs.writeFile(
      path.join(dir, name + '.jsonl'),
      [
        { type: 'session', version: 3, id: name, cwd: dir },
        { type: 'message', message: { role: 'user', content } },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n',
    );
  }
  await fs.writeFile(
    path.join(dir, 'empty.jsonl'),
    JSON.stringify({ type: 'session', version: 3, id: 'empty', cwd: dir }) + '\n',
  );
  const sessions = await listPiSessions([dir], new Set());
  assert.equal(sessions.length, 2);
  assert.equal(
    sessions.find((session) => path.basename(session.file) === 'with-text.jsonl')?.preview,
    'Find this screenshot',
  );
  assert.equal(sessions.find((session) => path.basename(session.file) === 'image-only.jsonl')?.preview, '');
  const known = new Set(sessions.map((session) => path.resolve(session.file).toLowerCase()));
  assert.deepEqual(await listPiSessions([dir], known), []);
});
