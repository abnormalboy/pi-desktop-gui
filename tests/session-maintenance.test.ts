import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store, readSessionFile } from '../electron/store';
import { sessionUsage } from '../electron/pi/session-usage';
import { isEmptySession, fillSessionUsage } from '../electron/session-maintenance';
import { composeDraftText } from '../shared/draft';
import { argumentHint } from '../electron/agent';

const usage = { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, cost: { total: 0.25 } };
const sandbox = () => fs.mkdtemp(path.join(os.tmpdir(), 'pi-session-maintenance-'));

test('usage includes all paid branches, compaction and nested tools; unknown costs stay unknown', async () => {
  const dir = await sandbox();
  const records = [
    { type: 'session', cwd: dir },
    { type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: '问' } },
    { type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: '旧分支', usage } },
    { type: 'message', id: 'a2', parentId: 'u1', message: { role: 'assistant', content: '新分支', usage } },
    { type: 'message', id: 't', parentId: 'a2', message: { role: 'toolResult', content: '嵌套任务', usage } },
    { type: 'compaction', id: 'c', parentId: 't', usage },
    { type: 'branch_summary', id: 'b', parentId: 'c', usage },
    { type: 'usage', id: 'x', parentId: 'b', usage },
  ];
  const file = path.join(dir, 'history.jsonl');
  await fs.writeFile(file, records.map((record) => JSON.stringify(record)).join('\n'));
  const history = await readSessionFile(file);
  assert.equal(
    history.messages.some((message) => message.content === '旧分支'),
    false,
  );
  assert.deepEqual(history.stats, { tokens: 120, cost: 1.5 });
  assert.deepEqual(
    sessionUsage([{ type: 'message', message: { role: 'assistant', usage: { ...usage, cost: undefined } } }]),
    { tokens: 20, cost: undefined },
  );
  assert.deepEqual(sessionUsage([{ type: 'message', message: { role: 'assistant' } }]), {
    tokens: undefined,
    cost: undefined,
  });
});

test('empty-session cleanup protects active sessions, drafts, chips, images, attachments and existing history', async () => {
  const store = new Store(await sandbox());
  await store.load();
  const session = store.createSession();
  assert.equal(await isEmptySession(session), true);
  assert.equal(await isEmptySession(session, session.id), false);
  for (const fields of [
    { pinned: true },
    { draft: ' ' },
    { attachments: ['file.txt'] },
    { images: [{ id: 'image', name: 'image', data: 'AA==', mimeType: 'image/png' }] },
    { draftSnippets: [{ id: 'snippet', offset: 0, text: '保存的正文' }] },
  ])
    assert.equal(await isEmptySession({ ...session, ...fields }), false);
  const file = path.join(store.dir, 'history.jsonl');
  session.file = file;
  assert.equal(await isEmptySession(session), true);
  await fs.writeFile(file, '');
  assert.equal(await isEmptySession(session), true);
  await fs.writeFile(file, '{"type":"session"}');
  assert.equal(await isEmptySession(session), false);
});

test('draft chips, layout and usage survive restart without changing the session recency', async () => {
  const store = new Store(await sandbox());
  await store.load();
  const session = store.createSession();
  session.draft = '前后';
  session.draftSnippets = [{ id: 'snippet', offset: 1, text: '长文本' }];
  session.updatedAt = 100;
  store.state.settings.inspectorSplit = 55;
  await fillSessionUsage(store);
  assert.equal(session.updatedAt, 100);
  const reloaded = new Store(store.dir);
  await reloaded.load();
  const saved = reloaded.session(session.id);
  assert.equal(composeDraftText(saved.draft, saved.draftSnippets ?? []), '前长文本后');
  assert.equal(reloaded.state.settings.inspectorSplit, 55);
  assert.deepEqual(saved.stats, { tokens: 0, cost: 0 });
});

test('native template argument hints decode YAML quoting and ignore malformed frontmatter', async () => {
  const file = path.join(await sandbox(), 'prompt.md');
  await fs.writeFile(file, '---\nargument-hint: "<模块> \\"关注点\\""\n---\n$1');
  assert.equal(await argumentHint(file), '<模块> "关注点"');
  await fs.writeFile(file, '---\nargument-hint: [invalid\n---\n$1');
  assert.equal(await argumentHint(file), undefined);
});

test('placeholder reuse rejects every durable user choice and any history reference', async () => {
  const { isReusableSession } = await import('../electron/session-maintenance');
  const store = new Store(await sandbox());
  await store.load();
  const session = store.createSession();
  assert.equal(isReusableSession(session), true);
  for (const fields of [
    { title: '我的计划' },
    { file: '/missing/history.jsonl' },
    { cwd: '/project' },
    { draft: ' ' },
    { attachments: ['a'] },
    { pinned: true },
    { unread: true },
    { model: { provider: 'test', id: 'model' } },
    { thinking: 'off' },
    { approvalMode: 'auto' as const },
    { images: [{ id: 'i', name: 'i', data: 'AA==', mimeType: 'image/png' as const }] },
    { draftSnippets: [{ id: 's', offset: 0, text: 'draft' }] },
    { lastStatus: 'running' as const },
    { stats: { tokens: 1, cost: 0 } },
  ])
    assert.equal(isReusableSession({ ...session, ...fields }), false, JSON.stringify(fields));
  for (const fields of [
    { title: '我的计划' },
    { model: { provider: 'p', id: 'm' } },
    { thinking: 'off' },
    { approvalMode: 'auto' as const },
  ])
    assert.equal(await isEmptySession({ ...session, ...fields }), false);
});
