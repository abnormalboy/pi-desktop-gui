import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store';
import type { AppState, Session } from '../shared/types';

async function fixture(t: TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-placeholder-store-'));
  const store = new Store(dir);
  await store.load();
  store.state.projects.push(
    { id: 'a', name: 'A', path: path.join(dir, 'a'), trusted: true, createdAt: 1 },
    { id: 'b', name: 'B', path: path.join(dir, 'b'), trusted: true, createdAt: 1 },
  );
  t.after(async () => {
    await store.flush().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  });
  const file = (name: string) => path.join(dir, name);
  const read = async (name = 'state.json'): Promise<AppState> =>
    JSON.parse(await fs.readFile(file(name), 'utf8'));
  return { dir, store, file, read };
}

function assertValidSelection(state: AppState) {
  if (state.selectedProjectId !== undefined)
    assert.ok(state.projects.some((project) => project.id === state.selectedProjectId));
  if (state.selectedSessionId !== undefined) {
    const selected = state.sessions.find((session) => session.id === state.selectedSessionId);
    assert.ok(selected, 'a projected selection must refer to an included session');
    assert.equal(state.selectedProjectId, selected.projectId);
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

test('unused placeholders survive in memory but never enter current, rotated backups or restart', async (t) => {
  const f = await fixture(t);
  const durable = f.store.createSession('a');
  durable.draft = 'keep this conversation';
  await f.store.save();
  const placeholders = new Set<string>();

  for (const scope of [undefined, 'a', 'b', undefined]) {
    const session = f.store.createPlaceholder(scope);
    placeholders.add(session.id);
    session.scrollTop = 123;
    session.expandedTools = ['view-only-tool'];
    session.images = [];
    session.draftSnippets = [];
    session.pinned = false;
    session.stats = { tokens: 0, cost: 0 };
    session.updatedAt++;
    f.store.state.settings.theme = 'dark';
    f.store.state.settings.sidebarWidth++;
    const older = new Date(Date.now() - 11 * 60 * 1000);
    await fs.utimes(f.file('state.backup-1.json'), older, older);
    await f.store.save();
    assert.equal(f.store.state.selectedSessionId, session.id, 'saving must not steal selection');
    assert.equal(f.store.isTransientSession(session.id), true);
    assert.ok(f.store.state.sessions.includes(session), 'saving must not prune the registry');
    f.store.selectSession(durable.id);
    await f.store.save();
  }

  const indexes = (await fs.readdir(f.dir)).filter((name) => /^state(?:\.backup-[123])?\.json$/.test(name));
  assert.equal(indexes.length, 4);
  for (const name of indexes) {
    const state = await f.read(name);
    assert.deepEqual(
      state.sessions.map((session) => session.id),
      [durable.id],
      name,
    );
    assertValidSelection(state);
    assert.ok(state.sessions.every((session) => !placeholders.has(session.id)));
  }
  const restarted = new Store(f.dir);
  await restarted.load();
  assert.deepEqual(
    restarted.state.sessions.map((session) => session.id),
    [durable.id],
  );
  assert.equal(restarted.isTransientSession(durable.id), false);
  const next = restarted.createPlaceholder();
  assert.equal(placeholders.has(next.id), false, 'placeholder identity is process-local');
});

test('same-scope requests reuse synchronously while scopes and unavailable owners stay distinct', async (t) => {
  const { store } = await fixture(t);
  const [first, second, third] = await Promise.all([
    Promise.resolve().then(() => store.createPlaceholder('a')),
    Promise.resolve().then(() => store.createPlaceholder('a')),
    Promise.resolve().then(() => store.createPlaceholder('a')),
  ]);
  assert.equal(first, second);
  assert.equal(second, third);
  const chat = store.createPlaceholder();
  const otherProject = store.createPlaceholder('b');
  assert.equal(new Set([first.id, chat.id, otherProject.id]).size, 3);
  assert.equal(store.createPlaceholder().id, chat.id);
  assert.equal(store.createPlaceholder('b').id, otherProject.id);
  const blocked = store.createPlaceholder('a', (id) => id === first.id);
  assert.notEqual(blocked.id, first.id);
  assert.equal(store.createPlaceholder('a', (id) => id === first.id).id, blocked.id);
  assert.equal(store.state.selectedSessionId, blocked.id);
  assert.equal(store.state.selectedProjectId, 'a');
  assert.equal(store.isTransientSession('missing'), false);
  assert.equal(store.isTransientSession(first.id), false);
  assert.ok([chat, otherProject, blocked].every((session) => store.isTransientSession(session.id)));
});

test('unavailable placeholder owners are promoted irreversibly before a replacement is selected', async (t) => {
  const f = await fixture(t);
  const original = f.store.createPlaceholder('a');
  const otherScope = f.store.createPlaceholder('b');
  const untouched = f.store.createPlaceholder();
  const replacement = f.store.createPlaceholder('a', (id) => id === original.id || id === otherScope.id);
  assert.notEqual(replacement.id, original.id);
  assert.equal(f.store.state.selectedSessionId, replacement.id);
  assert.equal(f.store.state.selectedProjectId, 'a');
  assert.equal(f.store.isTransientSession(original.id), false);
  assert.equal(f.store.isTransientSession(otherScope.id), false);
  assert.equal(f.store.isTransientSession(replacement.id), true);
  assert.equal(f.store.isTransientSession(untouched.id), true);
  assert.deepEqual(
    f.store
      .durableSessions()
      .map((session) => session.id)
      .sort(),
    [original.id, otherScope.id].sort(),
  );
  assert.equal(f.store.createPlaceholder('a', () => false).id, replacement.id);
  f.store.removeSessions([replacement.id]);
  const next = f.store.createPlaceholder('a', () => false);
  assert.notEqual(next.id, original.id, 'an unavailable owner must never become reusable again');
  assert.notEqual(next.id, replacement.id);
  assert.equal(f.store.isTransientSession(next.id), true);
  await f.store.save();
  const persisted = await f.read();
  assert.deepEqual(
    persisted.sessions.map((session) => session.id).sort(),
    [original.id, otherScope.id].sort(),
  );
  assert.equal(persisted.selectedSessionId, original.id);
  assertValidSelection(persisted);
  const restarted = new Store(f.dir);
  await restarted.load();
  assert.equal(restarted.session(original.id).draft, '');
  assert.equal(restarted.isTransientSession(original.id), false);
});

test('placeholder creation validates scope before reusing a matching registry entry', async (t) => {
  const { store } = await fixture(t);
  const existing = store.createPlaceholder('a');
  store.state.projects = store.state.projects.filter((project) => project.id !== 'a');
  const before = structuredClone(store.state);
  assert.throws(() => store.createPlaceholder('a'), /项目不存在/);
  assert.throws(() => store.createPlaceholder('missing'), /项目不存在/);
  assert.throws(() => store.createPlaceholder(''), /项目不存在/);
  assert.deepEqual(store.state, before);
  assert.equal(store.isTransientSession(existing.id), true);
});

test('durable projection chooses only a durable session in the omitted selection’s scope', async (t) => {
  const { store } = await fixture(t);
  const projectA = store.createSession('a');
  const projectB = store.createSession('b');
  const chat = store.createSession();
  for (const [scope, fallback] of [
    ['a', projectA],
    ['b', projectB],
    [undefined, chat],
  ] as const) {
    const placeholder = store.createPlaceholder(scope);
    store.state.selectedProjectId = scope === 'a' ? 'b' : 'a';
    const before = structuredClone(store.state);
    const persistent = store.persistentState();
    assert.equal(persistent.selectedSessionId, fallback.id);
    assert.equal(persistent.selectedProjectId, scope);
    assert.equal(
      persistent.sessions.some((session) => session.id === placeholder.id),
      false,
    );
    assertValidSelection(persistent);
    const visible = store.visibleState();
    assert.equal(visible.selectedSessionId, placeholder.id);
    assert.equal(visible.selectedProjectId, scope);
    assertValidSelection(visible);
    assert.deepEqual(store.state, before, 'projections cannot alter the live selection');
  }
});

test('omitting a placeholder without a same-scope fallback preserves only a valid project selection', async (t) => {
  const { store } = await fixture(t);
  store.createSession('b');
  store.createPlaceholder('a');
  const project = store.persistentState();
  assert.equal(project.selectedSessionId, undefined);
  assert.equal(project.selectedProjectId, 'a');
  assertValidSelection(project);
  store.createPlaceholder();
  const chat = store.persistentState();
  assert.equal(chat.selectedSessionId, undefined);
  assert.equal(chat.selectedProjectId, undefined);
  assertValidSelection(chat);
  store.state.selectedSessionId = 'missing';
  store.state.selectedProjectId = 'missing-project';
  for (const state of [store.persistentState(), store.visibleState()]) {
    assert.equal(state.selectedSessionId, undefined);
    assert.equal(state.selectedProjectId, undefined);
    assertValidSelection(state);
  }
});

test('visible snapshots retain only their selected placeholder without pruning live sessions', async (t) => {
  const { store } = await fixture(t);
  const durable = store.createSession('a');
  const project = store.createPlaceholder('a');
  const chat = store.createPlaceholder();
  const selected = store.createPlaceholder('b');
  const before = structuredClone(store.state);
  const visible = store.visibleState();
  assert.deepEqual(visible.sessions.map((session) => session.id).sort(), [durable.id, selected.id].sort());
  assert.equal(visible.selectedSessionId, selected.id);
  assertValidSelection(visible);
  const snapshot = structuredClone(store.state);
  snapshot.selectedSessionId = project.id;
  snapshot.selectedProjectId = 'b';
  const snapshotBefore = structuredClone(snapshot);
  const projected = store.visibleState(snapshot);
  assert.deepEqual(projected.sessions.map((session) => session.id).sort(), [durable.id, project.id].sort());
  assert.equal(projected.selectedProjectId, 'a');
  assertValidSelection(projected);
  assert.deepEqual(snapshot, snapshotBefore);
  assert.deepEqual(store.state, before);
  assert.ok([project, chat, selected].every((session) => store.isTransientSession(session.id)));
});

test('a delayed draft promotes its original hidden placeholder without stealing current selection', async (t) => {
  const f = await fixture(t);
  const old = f.store.createPlaceholder('a');
  const selected = f.store.createPlaceholder('b');
  old.draft = 'late editor update for the previous selection';
  const durable = f.store.durableSessions();
  assert.ok(durable.includes(old));
  assert.equal(f.store.isTransientSession(old.id), false);
  assert.equal(f.store.isTransientSession(selected.id), true);
  const visible = f.store.visibleState();
  assert.ok(visible.sessions.some((session) => session.id === old.id));
  assert.ok(visible.sessions.some((session) => session.id === selected.id));
  assert.equal(f.store.state.selectedSessionId, selected.id);
  assert.equal(f.store.state.selectedProjectId, 'b');
  await f.store.save();
  assert.equal((await f.read()).sessions.find((session) => session.id === old.id)?.draft, old.draft);
  assert.equal(f.store.state.selectedSessionId, selected.id);
  old.draft = '';
  await f.store.save();
  assert.ok((await f.read()).sessions.some((session) => session.id === old.id));
  assert.equal(f.store.createPlaceholder('a').id === old.id, false);
  const restarted = new Store(f.dir);
  await restarted.load();
  assert.equal(restarted.session(old.id).draft, '');
  assert.equal(restarted.isTransientSession(old.id), false);
});

test('every durable field independently promotes a marked placeholder and clearing it cannot demote', async (t) => {
  const f = await fixture(t);
  const fields: [string, Partial<Session>][] = [
    ['draft', { draft: 'user text' }],
    ['whitespace draft', { draft: ' ' }],
    ['attachment', { attachments: ['file.ts'] }],
    ['image', { images: [{ id: 'image', name: 'image.png', data: 'aGVsbG8=', mimeType: 'image/png' }] }],
    ['collapsed draft snippet', { draftSnippets: [{ id: 'snippet', text: 'pasted text', offset: 0 }] }],
    ['history file', { file: f.file('history.jsonl') }],
    ['working directory', { cwd: f.dir }],
    ['custom title', { title: 'An intentional title' }],
    ['empty custom title', { title: '' }],
    ['unread history', { unread: true }],
    ['pinned', { pinned: true }],
    ['model', { model: { provider: 'provider', id: 'model' } }],
    ['empty model choice', { model: { provider: '', id: '' } }],
    ['thinking', { thinking: 'off' }],
    ['empty thinking choice', { thinking: '' }],
    ['approval mode', { approvalMode: 'auto' }],
    ['confirm approval', { approvalMode: 'confirm' }],
    ['readonly approval', { approvalMode: 'readonly' }],
    ['tokens', { stats: { tokens: 1, cost: 0 } }],
    ['cost', { stats: { tokens: 0, cost: 0.01 } }],
    ...(
      [
        'starting',
        'running',
        'waiting',
        'retrying',
        'compacting',
        'stopping',
        'completed',
        'stopped',
        'error',
        'interrupted',
      ] as const
    ).map((lastStatus): [string, Partial<Session>] => [lastStatus, { lastStatus }]),
  ];
  const promoted: string[] = [];
  for (const [name, patch] of fields) {
    await t.test(name, () => {
      const session = f.store.createPlaceholder('a');
      const untouched = structuredClone(session);
      Object.assign(session, patch);
      assert.ok(
        f.store.persistentState().sessions.some((row) => row.id === session.id),
        name,
      );
      assert.equal(f.store.isTransientSession(session.id), false, name);
      for (const key of Object.keys(patch)) Reflect.deleteProperty(session, key);
      Object.assign(session, untouched);
      assert.ok(
        f.store.durableSessions().some((row) => row.id === session.id),
        `${name} was cleared`,
      );
      promoted.push(session.id);
    });
  }
  await f.store.save();
  const restarted = new Store(f.dir);
  await restarted.load();
  assert.deepEqual(restarted.state.sessions.map((session) => session.id).sort(), promoted.sort());
});

test('explicit promotion retains default-valued choices and cleared user content irrevocably', async (t) => {
  const f = await fixture(t);
  const defaultChoice = f.store.createPlaceholder('a');
  assert.equal(f.store.promoteSession(defaultChoice.id), defaultChoice);
  defaultChoice.title = '新会话';
  defaultChoice.pinned = false;
  defaultChoice.stats = { tokens: 0, cost: 0 };
  defaultChoice.approvalMode = 'auto';
  assert.equal(f.store.promoteSession(defaultChoice.id), defaultChoice);
  const cleared = f.store.createPlaceholder();
  f.store.promoteSession(cleared.id);
  cleared.draft = 'typed then cleared';
  cleared.attachments = ['removed.txt'];
  cleared.draft = '';
  cleared.attachments = [];
  assert.equal(f.store.isTransientSession(defaultChoice.id), false);
  assert.equal(f.store.isTransientSession(cleared.id), false);
  await f.store.save();
  const restarted = new Store(f.dir);
  await restarted.load();
  assert.equal(restarted.session(defaultChoice.id).title, '新会话');
  assert.equal(restarted.session(defaultChoice.id).pinned, false);
  assert.equal(restarted.session(cleared.id).draft, '');
  assert.notEqual(restarted.createPlaceholder('a').id, defaultChoice.id);
  assert.notEqual(restarted.createPlaceholder().id, cleared.id);
  assert.throws(() => f.store.promoteSession('missing'), /会话不存在/);
});

test('legacy blanks and ordinary createSession rows remain durable and are never reused as placeholders', async (t) => {
  const f = await fixture(t);
  const legacy = f.store.createPlaceholder('a');
  // Older versions persisted blank sessions without process-local lifecycle metadata.
  await fs.writeFile(f.file('state.json'), JSON.stringify(f.store.state));
  await f.store.load();
  assert.equal(f.store.isTransientSession(legacy.id), false, 'load must clear any old process-local marker');
  const placeholder = f.store.createPlaceholder('a');
  assert.notEqual(placeholder.id, legacy.id);
  const ordinary = f.store.createSession('a');
  const imported = f.store.createSession('b');
  imported.file = f.file('import.jsonl');
  const forked = f.store.createSession();
  forked.file = f.file('fork.jsonl');
  for (const session of [ordinary, imported, forked])
    assert.equal(f.store.isTransientSession(session.id), false);
  assert.equal(f.store.createPlaceholder('a').id, placeholder.id);
  await f.store.save();
  const expected = [legacy.id, ordinary.id, imported.id, forked.id].sort();
  assert.deepEqual((await f.read()).sessions.map((session) => session.id).sort(), expected);
  await fs.writeFile(f.file('state.json'), '{broken current index');
  const recovered = new Store(f.dir);
  await recovered.load();
  assert.ok(recovered.storage.recovery?.recoveredFrom);
  assert.deepEqual(recovered.state.sessions.map((session) => session.id).sort(), expected);
  assert.ok(recovered.state.sessions.every((session) => !recovered.isTransientSession(session.id)));
  assert.notEqual(recovered.createPlaceholder('a').id, legacy.id);
});

test('save captures projected bytes synchronously before promotion or later queued mutations', async (t) => {
  const f = await fixture(t);
  const placeholder = f.store.createPlaceholder('a');
  const entered = deferred(),
    release = deferred();
  const writes: string[] = [];
  const write = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
    if (String(args[0]) === f.file('state.json.tmp')) {
      writes.push(String(args[1]));
      if (writes.length === 1) {
        entered.resolve();
        await release.promise;
      }
    }
    return write(...args);
  });
  const first = f.store.save();
  f.store.promoteSession(placeholder.id);
  placeholder.draft = 'second snapshot';
  const second = f.store.save();
  placeholder.draft = 'a mutation after the second save was requested';
  try {
    await entered.promise;
    assert.deepEqual(JSON.parse(writes[0]).sessions, []);
    assert.equal(writes.length, 1, 'the second snapshot must remain queued behind the first writer');
    release.resolve();
    await Promise.all([first, second]);
    assert.equal(writes.length, 2);
    const persisted = JSON.parse(writes[1]) as AppState;
    assert.equal(persisted.sessions[0].id, placeholder.id);
    assert.equal(persisted.sessions[0].draft, 'second snapshot');
    assertValidSelection(persisted);
    assert.equal(await fs.readFile(f.file('state.json'), 'utf8'), writes[1]);
    assert.equal(await fs.readFile(f.file('state.backup-1.json'), 'utf8'), writes[0]);
    assert.equal(placeholder.draft, 'a mutation after the second save was requested');
  } finally {
    release.resolve();
    await Promise.allSettled([first, second]);
  }
});

test('explicit removal clears markers and stale references can never resurrect removed IDs', async (t) => {
  const f = await fixture(t);
  const durable = f.store.createSession('a');
  const removed = f.store.createPlaceholder('a');
  const kept = f.store.createPlaceholder('b');
  f.store.selectSession(removed.id);
  function* ids() {
    yield removed.id;
    yield durable.id;
    yield removed.id;
    yield 'missing';
  }
  f.store.removeSessions(ids());
  assert.equal(f.store.isTransientSession(removed.id), false);
  assert.equal(f.store.isTransientSession(kept.id), true);
  assert.throws(() => f.store.session(removed.id), /会话不存在/);
  assert.throws(() => f.store.promoteSession(removed.id), /会话不存在/);
  removed.draft = 'late update to a deleted object';
  durable.draft = 'another deleted object';
  for (const state of [f.store.visibleState(), f.store.persistentState()]) {
    assert.ok(state.sessions.every((session) => ![removed.id, durable.id].includes(session.id)));
    assertValidSelection(state);
  }
  await f.store.save();
  assert.equal((await f.read()).sessions.length, 0);
  const replacement = f.store.createPlaceholder('a');
  assert.notEqual(replacement.id, removed.id);
  assert.notEqual(replacement.id, durable.id);
  assert.ok(f.store.state.sessions.includes(kept));
});

test('ENOSPC rejects saves, keeps promoted data in memory and preserves the committed index', async (t) => {
  const f = await fixture(t);
  await f.store.save();
  const committed = await fs.readFile(f.file('state.json'), 'utf8');
  const committedBackup = await fs.readFile(f.file('state.backup-1.json'), 'utf8');
  const promoted = f.store.createPlaceholder('a');
  promoted.draft = 'must remain available after failed persistence';
  const events: boolean[] = [];
  f.store.on('storage', (storage) => events.push(storage.writable));
  const write = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
    if (String(args[0]) === f.file('state.json.tmp'))
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return write(...args);
  });
  await assert.rejects(f.store.save(), /ENOSPC/);
  assert.equal(f.store.storage.writable, false);
  assert.deepEqual(events, [false]);
  assert.equal(f.store.isTransientSession(promoted.id), false);
  assert.equal(f.store.session(promoted.id), promoted);
  assert.equal(promoted.draft, 'must remain available after failed persistence');
  assert.equal(f.store.state.selectedSessionId, promoted.id);
  assert.equal(await fs.readFile(f.file('state.json'), 'utf8'), committed);
  assert.equal(await fs.readFile(f.file('state.backup-1.json'), 'utf8'), committedBackup);
  await assert.rejects(f.store.save(), /发送与保存已暂停/);
  await assert.rejects(f.store.flush(), /发送与保存已暂停/);
  assert.ok(f.store.persistentState().sessions.some((session) => session.id === promoted.id));
});
