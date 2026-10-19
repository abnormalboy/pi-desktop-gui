import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store';
import { AgentService } from '../electron/agent';
import { Workspace } from '../electron/workspace';
import { isOlderSession } from '../shared/usage';

async function fixture(t: TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-session-activity-'));
  const store = new Store(dir);
  await store.load();
  const older = store.createSession(),
    newer = store.createSession();
  older.cwd = newer.cwd = dir;
  older.updatedAt = 1;
  newer.updatedAt = 2;
  older.unread = newer.unread = false;
  Object.assign(store.state.settings, {
    agentDir: dir,
    nodePath: process.execPath,
    piPath: path.resolve('tests/support/fixture-pi.mjs'),
  });
  const service = new AgentService(store, new Workspace(dir));
  t.after(async () => {
    await service.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const recency = () => store.state.sessions.map(({ id, updatedAt, unread }) => ({ id, updatedAt, unread }));
  return { dir, store, service, older, newer, recency };
}

async function settled(service: AgentService) {
  const start = Date.now();
  while (service.hasPendingWork) {
    if (Date.now() - start > 5000) throw new Error('Fixture did not settle: ' + service.runtime.status);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('cold connect, reused switching and history reads preserve recency, older grouping and unread', async (t) => {
  const f = await fixture(t);
  const before = f.recency();
  for (const session of [f.older, f.newer, f.older]) {
    await f.service.connect(session.id);
    await f.service.history(session.id);
    assert.deepEqual(f.recency(), before);
    assert.equal(isOlderSession(f.older), true);
    assert.deepEqual(
      [...f.store.state.sessions].sort((a, b) => b.updatedAt - a.updatedAt).map((s) => s.id),
      [f.newer.id, f.older.id],
    );
  }
  assert.equal(f.service.lastSwitch?.mode, 'reuse');
  await f.service.disconnect();
  await f.service.connect(f.older.id);
  assert.equal(f.service.lastSwitch?.mode, 'restart');
  assert.deepEqual(f.recency(), before);
  await f.store.flush();
  const saved = new Store(f.dir);
  await saved.load();
  assert.equal(saved.session(f.older.id).updatedAt, 1);
  assert.equal(saved.session(f.older.id).unread, false);
});

test('tree, settings, admin queries and export do not create content activity', async (t) => {
  const f = await fixture(t);
  await f.service.connect(f.older.id);
  f.older.updatedAt = 1;
  f.older.unread = false;
  const before = f.recency();
  await f.service.tree(f.older.id);
  await f.service.option(f.older.id, 'autoRetry', true);
  await f.service.admin(f.older.id, 'providers');
  await f.service.exportHtml(f.older.id, path.join(f.dir, 'export.html'));
  assert.deepEqual(f.recency(), before);
});

test('cancelled and failed connection attempts preserve activity and unread', async (t) => {
  const f = await fixture(t);
  await f.service.connect(f.older.id);
  f.service.runtime.status = 'completed';
  f.older.updatedAt = 1;
  f.older.unread = false;
  const before = f.recency();
  await fs.writeFile(path.join(f.dir, 'control.json'), JSON.stringify({ cancelSwitch: true }));
  await assert.rejects(f.service.connect(f.newer.id), /取消了会话切换/);
  assert.deepEqual(f.recency(), before);
  await f.service.disconnect();
  await fs.writeFile(path.join(f.dir, 'control.json'), JSON.stringify({ exitOnStats: true }));
  await assert.rejects(f.service.connect(f.older.id), /Pi 在加载会话时已退出/);
  assert.deepEqual(f.recency(), before);
});

test('accepted messages and background completion still advance activity and mark unread', async (t) => {
  const f = await fixture(t);
  await f.service.connect(f.older.id);
  f.older.updatedAt = 1;
  await f.service.send(f.older.id, '/handled', [], 'steer');
  assert.ok(f.older.updatedAt > f.newer.updatedAt);
  f.older.unread = false;
  f.older.updatedAt = 1;
  await f.service.send(f.older.id, 'reply', [], 'steer');
  await settled(f.service);
  assert.equal(f.service.runtime.status, 'completed');
  assert.ok(f.older.updatedAt > f.newer.updatedAt);
  assert.equal(f.older.unread, true);
  f.store.selectSession(f.older.id);
  assert.equal(f.older.unread, false);
  f.store.selectSession(f.newer.id);
  for (const command of ['hold', 'crash']) {
    f.older.unread = false;
    f.older.updatedAt = 1;
    await f.service.send(f.older.id, command, [], 'steer');
    if (command === 'hold') await f.service.stop();
    await settled(f.service);
    assert.equal(f.service.runtime.status, command === 'hold' ? 'stopped' : 'interrupted');
    assert.ok(f.older.updatedAt > f.newer.updatedAt);
    assert.equal(f.older.unread, true);
  }
});

test('message, tool and run boundaries update activity without per-token persistence', async (t) => {
  const f = await fixture(t);
  await f.service.connect(f.older.id);
  const internal = f.service as unknown as { onEvent(record: unknown): void };
  f.service.runtime.status = 'running';
  for (const record of [
    { type: 'message_start', message: { role: 'assistant', content: [] } },
    { type: 'message_end', message: { role: 'assistant', content: 'answer' } },
    { type: 'tool_execution_start', toolCallId: 'tool', toolName: 'read' },
    { type: 'tool_execution_end', toolCallId: 'tool', result: { content: 'contents' } },
    { type: 'compaction_start' },
    { type: 'compaction_end', reason: 'manual' },
  ]) {
    f.older.updatedAt = 1;
    internal.onEvent(record);
    assert.ok(f.older.updatedAt > 1, record.type);
  }
  f.older.updatedAt = 1;
  f.service.runtime.status = 'running';
  const saves = t.mock.method(f.store, 'save');
  internal.onEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'next token' },
  });
  assert.equal(f.older.updatedAt, 1);
  assert.equal(saves.mock.callCount(), 0);
});
