import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentService } from '../electron/agent';
import { Store } from '../electron/store';
import { Workspace } from '../electron/workspace';
import { PiRpc } from '../electron/rpc';
import { messageText, type Runtime } from '../shared/types';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}
const rpcOf = (service: AgentService) => (service as unknown as { rpc?: PiRpc }).rpc;
const texts = (messages: AgentService['runtime']['messages']) => messages.map(messageText);
async function fixture(t: TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-transition-'));
  const store = new Store(path.join(dir, 'app'));
  await store.load();
  for (const id of ['a', 'b']) {
    const cwd = path.join(dir, id);
    await fs.mkdir(cwd);
    store.state.projects.push({ id, path: cwd, name: id, trusted: true, createdAt: 0 });
  }
  const a = store.createSession('a'),
    same = store.createSession('a'),
    other = store.createSession('b');
  for (const session of [a, same, other]) {
    session.file = path.join(dir, `${session.id}.jsonl`);
    await fs.writeFile(
      session.file,
      [
        { type: 'session', cwd: store.project(session.projectId!).path },
        { type: 'message', id: 'history', message: { role: 'user', content: session.id } },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n'),
    );
  }
  store.selectSession(a.id);
  Object.assign(store.state.settings, {
    agentDir: dir,
    nodePath: process.execPath,
    piPath: path.resolve('tests/support/fixture-pi.mjs'),
  });
  await store.save();
  const service = new AgentService(
    store,
    new Workspace(store.dir),
    undefined,
    path.resolve('tests/support/pi-extension.js'),
  );
  t.after(async () => {
    await service.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });
  await service.connect(a.id);
  return { dir, store, service, a, same, other };
}

for (const target of ['same', 'other'] as const) {
  test(`${target}-directory acceptance publishes target preview while rebind is gated`, async (t) => {
    const f = await fixture(t),
      session = f[target];
    const entered = deferred(),
      release = deferred();
    const request = PiRpc.prototype.request;
    let held = false,
      accepted = 0;
    t.mock.method(
      PiRpc.prototype,
      'request',
      async function (this: PiRpc, ...args: Parameters<typeof request>) {
        if (!held && f.service.runtime.sessionId === session.id && args[0] === 'get_state') {
          held = true;
          entered.resolve();
          await release.promise;
        }
        return request.apply(this, args);
      },
    );
    const start = t.mock.method(PiRpc.prototype, 'start');
    let completed = false;
    const connecting = f.service
      .connect(session.id, async () => {
        accepted++;
        f.store.selectSession(session.id);
        await f.store.save();
      })
      .then(() => {
        completed = true;
      });
    try {
      await entered.promise;
      assert.equal(accepted, 1);
      assert.equal(f.store.state.selectedSessionId, session.id);
      assert.equal(f.service.runtime.connected, false);
      assert.equal(f.service.runtime.model, undefined);
      assert.deepEqual(f.service.runtime.commands, []);
      assert.deepEqual(texts(f.service.runtime.messages), [session.id]);
      assert.deepEqual(texts(await f.service.history(session.id)), [session.id]);
      assert.equal(f.service.hasPendingWork, true);
      assert.equal(completed, false);
      await assert.rejects(f.service.disconnect(), /正在处理会话操作/);
      await assert.rejects(f.service.setModel(session.id, 'fixture', 'test'), /正在连接或切换/);
      if (target === 'other') assert.equal(start.mock.calls[0].arguments[1], f.store.project('b').path);
      else assert.equal(start.mock.callCount(), 0);
    } finally {
      release.resolve();
      await connecting;
    }
    assert.equal(accepted, 1);
    assert.equal(f.service.runtime.connected, true);
    assert.equal((f.service.runtime as Runtime).model?.id, 'test');
    assert.equal(f.service.hasPendingWork, false);
    assert.deepEqual(texts(f.service.runtime.messages), [session.id]);
  });
}

test('same-directory extension cancellation never accepts or replaces the old runtime', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.dir, 'control.json'), JSON.stringify({ cancelSwitch: true }));
  let accepted = 0;
  const rpc = rpcOf(f.service);
  await assert.rejects(
    f.service.connect(f.same.id, async () => {
      accepted++;
    }),
    /取消了会话切换/,
  );
  assert.equal(accepted, 0);
  assert.equal(f.store.state.selectedSessionId, f.a.id);
  assert.equal(f.service.runtime.sessionId, f.a.id);
  assert.deepEqual(texts(f.service.runtime.messages), [f.a.id]);
  assert.equal(rpcOf(f.service), rpc);
});

test('an acceptance error propagates without being mistaken for a reusable-Pi failure', async (t) => {
  const f = await fixture(t);
  const start = t.mock.method(PiRpc.prototype, 'start');
  let accepted = 0;
  await assert.rejects(
    f.service.connect(f.same.id, async () => {
      accepted++;
      f.store.selectSession(f.same.id);
      throw new Error('view delivery failed');
    }),
    /view delivery failed/,
  );
  assert.equal(accepted, 1);
  assert.equal(start.mock.callCount(), 0);
  assert.equal(rpcOf(f.service), undefined);
  assert.equal(f.service.runtime.status, 'error');
  assert.deepEqual(texts(await f.service.history(f.same.id)), [f.same.id]);
  await f.service.connect(f.same.id);
  assert.equal(f.service.runtime.connected, true, 'an explicit retry must complete a fresh rebind');
  assert.equal(f.service.runtime.sessionId, f.same.id);
});

test('a reuse fallback accepts only once and still reloads the correct target', async (t) => {
  const f = await fixture(t);
  const request = PiRpc.prototype.request;
  let failed = false,
    accepted = 0;
  t.mock.method(
    PiRpc.prototype,
    'request',
    async function (this: PiRpc, ...args: Parameters<typeof request>) {
      if (!failed && f.service.runtime.sessionId === f.same.id && args[0] === 'get_state') {
        failed = true;
        throw new Error('rebind fixture failure');
      }
      return request.apply(this, args);
    },
  );
  await f.service.connect(f.same.id, async () => {
    accepted++;
  });
  assert.equal(accepted, 1);
  assert.equal(f.service.lastSwitch?.mode, 'restart');
  assert.equal(f.service.runtime.sessionId, f.same.id);
  assert.deepEqual(texts(f.service.runtime.messages), [f.same.id]);
});

test('cold rebind failure preserves the accepted target preview and a visible error', async (t) => {
  const f = await fixture(t);
  const request = PiRpc.prototype.request;
  t.mock.method(
    PiRpc.prototype,
    'request',
    async function (this: PiRpc, ...args: Parameters<typeof request>) {
      if (f.service.runtime.sessionId === f.other.id && args[0] === 'get_state')
        throw new Error('cold fixture failure');
      return request.apply(this, args);
    },
  );
  let accepted = 0;
  await assert.rejects(
    f.service.connect(f.other.id, async () => {
      accepted++;
      f.store.selectSession(f.other.id);
    }),
    /cold fixture failure/,
  );
  assert.equal(accepted, 1);
  assert.equal(f.store.state.selectedSessionId, f.other.id);
  assert.equal(f.service.runtime.connected, false);
  assert.equal(f.service.runtime.status, 'error');
  assert.match(f.service.runtime.error!, /cold fixture failure/);
  assert.deepEqual(texts(await f.service.history(f.other.id)), [f.other.id]);
});

for (const target of ['same', 'other'] as const) {
  test(`stop during ${target}-directory acceptance cannot restart or complete the connection`, async (t) => {
    const f = await fixture(t),
      session = f[target];
    const entered = deferred(),
      release = deferred();
    const start = t.mock.method(PiRpc.prototype, 'start');
    const connecting = f.service.connect(session.id, async () => {
      entered.resolve();
      await release.promise;
    });
    try {
      await entered.promise;
      await f.service.stop();
      release.resolve();
      await assert.rejects(connecting, /会话切换已取消/);
      assert.equal(start.mock.callCount(), 0);
      assert.equal(f.service.runtime.connected, false);
      assert.deepEqual(texts(await f.service.history(session.id)), [session.id]);
      assert.equal(f.service.hasPendingWork, false);
    } finally {
      release.resolve();
      await connecting.catch(() => {});
    }
  });
}

test('untrusted, read-only and unsafe recovery guards run before acceptance', async (t) => {
  const f = await fixture(t);
  let accepted = 0;
  const accept = async () => {
    accepted++;
  };
  f.store.project('b').trusted = false;
  await assert.rejects(f.service.connect(f.other.id, accept), /请先确认此项目/);
  f.store.project('b').trusted = true;
  f.store.storage = { writable: false, problem: 'read-only test' };
  await assert.rejects(f.service.connect(f.other.id, accept), /read-only test/);
  f.store.storage = { writable: true };
  (f.service as unknown as { unsafeExit: boolean }).unsafeExit = true;
  await assert.rejects(f.service.connect(f.other.id, accept), /无法确认/);
  (f.service as unknown as { unsafeExit: boolean }).unsafeExit = false;
  assert.equal(accepted, 0);
  assert.equal(f.service.runtime.sessionId, f.a.id);
});

test('a local preview read error is not hidden and does not replace the old session', async (t) => {
  const f = await fixture(t),
    rpc = rpcOf(f.service);
  const read = fs.readFile;
  t.mock.method(fs, 'readFile', async (...args: Parameters<typeof read>) => {
    if (String(args[0]) === f.other.file)
      throw Object.assign(new Error('preview denied'), { code: 'EACCES' });
    return read(...args);
  });
  let accepted = 0;
  await assert.rejects(
    f.service.connect(f.other.id, async () => {
      accepted++;
    }),
    /preview denied/,
  );
  assert.equal(accepted, 0);
  assert.equal(f.service.runtime.sessionId, f.a.id);
  assert.equal(rpcOf(f.service), rpc);
});

test('a confirmed idle crash can reconnect and accept a different target with history', async (t) => {
  const f = await fixture(t);
  await rpcOf(f.service)!.close();
  await (f.service as unknown as { crashCleanup: Promise<void> }).crashCleanup;
  assert.equal(f.service.runtime.crash?.cleanup, 'confirmed');
  let accepted = 0;
  await f.service.connect(f.other.id, async () => {
    accepted++;
    assert.deepEqual(texts(f.service.runtime.messages), [f.other.id]);
  });
  assert.equal(accepted, 1);
  assert.equal(f.service.lastSwitch?.mode, 'restart');
  assert.equal(f.service.runtime.connected, true);
  assert.equal(f.service.runtime.crash, undefined);
});

test('connections without a selection callback keep the existing single transcript read', async (t) => {
  const f = await fixture(t);
  const read = fs.readFile;
  let transcriptReads = 0;
  t.mock.method(fs, 'readFile', async (...args: Parameters<typeof read>) => {
    if (String(args[0]) === f.other.file) transcriptReads++;
    return read(...args);
  });
  await f.service.connect(f.other.id);
  assert.equal(transcriptReads, 1, 'send/recover connections do not add the selection preview read');
});

test('deleting a target during native switch closes the accepted RPC without reviving the deleted session', async (t) => {
  const f = await fixture(t),
    original = rpcOf(f.service)!;
  const entered = deferred(),
    release = deferred();
  const request = PiRpc.prototype.request;
  t.mock.method(
    PiRpc.prototype,
    'request',
    async function (this: PiRpc, ...args: Parameters<typeof request>) {
      const result = await request.apply(this, args);
      if (args[0] === 'switch_session') {
        entered.resolve();
        await release.promise;
      }
      return result;
    },
  );
  const start = t.mock.method(PiRpc.prototype, 'start');
  const connecting = f.service.connect(f.same.id, async () => {
    f.store.selectSession(f.same.id);
  });
  try {
    await entered.promise;
    assert.equal(f.service.runtime.sessionId, f.a.id);
    f.store.state.sessions = f.store.state.sessions.filter((session) => session.id !== f.same.id);
    await fs.unlink(f.same.file!);
    release.resolve();
    await assert.rejects(connecting, /会话不存在/);
    assert.equal(start.mock.callCount(), 0);
    assert.equal(rpcOf(f.service), undefined);
    assert.equal(original.closed, true);
    assert.equal(f.service.runtime.sessionId, undefined);
    assert.equal(f.service.runtime.connected, false);
    assert.equal(f.service.runtime.status, 'error');
    assert.equal(f.store.state.selectedSessionId, f.a.id);
    assert.equal(
      f.store.state.sessions.some((session) => session.id === f.same.id),
      false,
    );
    await assert.rejects(fs.access(f.same.file!), { code: 'ENOENT' });
    await f.service.forceStop();
    assert.equal(f.service.runtime.status, 'stopped');
  } finally {
    release.resolve();
    await connecting.catch(() => {});
  }
});

test('deleting a cold target while the old process closes leaves a safe empty runtime', async (t) => {
  const f = await fixture(t),
    original = rpcOf(f.service)!;
  const entered = deferred(),
    release = deferred();
  const close = PiRpc.prototype.close;
  let held = false;
  t.mock.method(PiRpc.prototype, 'close', async function (this: PiRpc, ...args: Parameters<typeof close>) {
    await close.apply(this, args);
    if (this === original && !held) {
      held = true;
      entered.resolve();
      await release.promise;
    }
  });
  const start = t.mock.method(PiRpc.prototype, 'start');
  const connecting = f.service.connect(f.other.id, async () => {
    f.store.selectSession(f.other.id);
  });
  try {
    await entered.promise;
    assert.equal(f.service.runtime.sessionId, f.a.id);
    f.store.state.sessions = f.store.state.sessions.filter((session) => session.id !== f.other.id);
    await fs.unlink(f.other.file!);
    release.resolve();
    await assert.rejects(connecting, /会话不存在/);
    assert.equal(start.mock.callCount(), 0);
    assert.equal(rpcOf(f.service), undefined);
    assert.equal(original.closed, true);
    assert.equal(f.service.runtime.sessionId, undefined);
    assert.equal(f.service.runtime.connected, false);
    assert.equal(f.service.runtime.status, 'error');
    assert.equal(f.store.state.selectedSessionId, f.a.id);
    assert.equal(
      f.store.state.sessions.some((session) => session.id === f.other.id),
      false,
    );
    await assert.rejects(fs.access(f.other.file!), { code: 'ENOENT' });
    await f.service.forceStop();
    assert.equal(f.service.runtime.status, 'stopped');
  } finally {
    release.resolve();
    await connecting.catch(() => {});
  }
});
