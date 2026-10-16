import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Store } from '../electron/store';
import { AgentService } from '../electron/agent';
import {
  SessionSwitchRecorder,
  sessionSwitchRecording,
  type SaveRecording,
} from '../electron/session-switch-recording';
import type { AppEvent } from '../shared/types';

const exec = promisify(execFile);
const mode = process.env.PI_MAIN_RECORDER_TEST_MODE;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function fixture(t: TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-main-recorder-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  await store.load();
  const a = store.createSession();
  const b = store.createSession();
  store.selectSession(a.id);
  await store.save();
  return { dir, store, a, b };
}

if (!mode) {
  test('main recorder caps memory and reports dropped records and observer failures', () => {
    let tick = 0;
    const recorder = new SessionSwitchRecorder(2, () => ++tick);
    recorder.record('one');
    recorder.record('two');
    recorder.record('three');
    const snapshot = recorder.snapshot();
    assert.deepEqual(
      snapshot.events.map((e) => e.at),
      [1, 2],
    );
    assert.equal(snapshot.dropped, 1);
    snapshot.events[0].phase = 'mutated export';
    assert.equal(recorder.snapshot().events[0].phase, 'one');
    const brokenClock = new SessionSwitchRecorder(2, () => {
      throw new Error('observer only');
    });
    assert.doesNotThrow(() => brokenClock.record('ignored'));
    assert.equal(brokenClock.snapshot().observerErrors, 1);
  });

  test('immutable save context survives overlapping invocations and late current-state emission', async () => {
    const recorder = new SessionSwitchRecorder();
    const late = deferred();
    let captured!: SaveRecording;
    const a = recorder.invoke('click-a', 'a', async () => {
      captured = recorder.beginSave('agent.save', 'a')!;
      recorder.finishInvocation('ok');
      await late.promise;
      recorder.saved('store.write.end', captured, { selectedId: 'b' });
      recorder.record('background.after.completed.invocation');
    });
    recorder.invoke('click-b', 'b', () => {
      assert.equal(Object.isFrozen(captured), true);
      recorder.saved('store.late.callback', captured, { selectedId: 'b' });
      const background = new SessionSwitchRecorder().beginSave('store.save', 'a')!;
      recorder.saved('store.unattributed.callback', background, { selectedId: 'b' });
      recorder.finishInvocation('ok');
    });
    late.resolve();
    await a;
    const events = recorder.snapshot().events;
    for (const phase of ['store.write.end', 'store.late.callback']) {
      const row = events.find((e) => e.phase === phase)!;
      assert.equal(row.invocationId, 'click-a');
      assert.equal(row.targetId, 'a');
      assert.equal(row.snapshotSelectedId, 'a');
      assert.equal(row.selectedId, 'b');
    }
    for (const phase of ['store.unattributed.callback', 'background.after.completed.invocation'])
      assert.equal(events.find((e) => e.phase === phase)?.invocationId, undefined);
  });

  test('recorder invocation returns the original promise and propagates original action errors', () => {
    const recorder = new SessionSwitchRecorder();
    const original = Promise.resolve(5);
    assert.equal(
      recorder.invoke('click', 'target', () => original),
      original,
    );
    const error = new Error('application failure');
    assert.throws(
      () =>
        recorder.invoke('click', 'target', () => {
          throw error;
        }),
      (e) => e === error,
    );
  });

  for (const enabled of [false, true]) {
    test(`Store and AgentService recorder integration in isolated ${enabled ? 'enabled' : 'disabled'} process`, async () => {
      const { stdout, stderr } = await exec(
        process.execPath,
        ['--import', 'tsx', '--test', '--test-reporter=tap', fileURLToPath(import.meta.url)],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_TEST_CONTEXT: undefined,
            PI_SESSION_SWITCH_RECORD: enabled ? '1' : '0',
            PI_MAIN_RECORDER_TEST_MODE: enabled ? 'enabled' : 'disabled',
          },
          timeout: 30000,
        },
      );
      assert.match(stdout, /# fail 0/);
      assert.equal(stderr, '');
    });
  }
} else if (mode === 'disabled') {
  test('disabled recorder adds no global, event metadata, timers, or save-promise wrappers', async (t) => {
    assert.equal(sessionSwitchRecording, undefined);
    assert.equal((globalThis as any).__sessionSwitchRecording, undefined);
    const { store, a } = await fixture(t);
    const timer = t.mock.method(globalThis, 'setTimeout');
    const promise = store.save();
    assert.equal(promise, store.flush());
    await promise;
    const service = new AgentService(store, {} as never);
    let eventArgs: unknown[] = [];
    service.on('state', (...args) => {
      eventArgs = args;
    });
    assert.equal((service as any).save(), undefined);
    await store.flush();
    assert.equal(eventArgs.length, 1);
    assert.equal(eventArgs[0], store.state);
    const event: AppEvent = { type: 'state', state: store.state };
    assert.deepEqual(Object.keys(event), ['type', 'state']);
    assert.equal(store.state.selectedSessionId, a.id);
    assert.equal(timer.mock.callCount(), 0);
  });
} else {
  test('delayed actual state-file write stays outside completed backend and reveals queue and mutable-state emission', async (t) => {
    const recorder = sessionSwitchRecording!;
    const { store, a, b, dir } = await fixture(t);
    a.draft = 'private text must never enter a record';
    await store.flush();
    let clock = 0;
    t.mock.method(recorder as any, 'now', () => clock);
    const start = recorder.snapshot().events.length;
    const originalWrite = fs.writeFile;
    const writing = deferred(),
      release = deferred(),
      enqueued = deferred();
    let intercepted = false;
    t.after(() => release.resolve());
    t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
      if (String(args[0]) === path.join(dir, 'state.json.tmp') && !intercepted) {
        intercepted = true;
        writing.resolve();
        await release.promise;
      }
      return originalWrite(...args);
    });
    const service = new AgentService(store, {} as never);
    service.runtime.sessionId = b.id;
    (service as any).rpc = { closed: false };
    t.mock.method(service as any, 'syncApprovalMode', async () => {
      // A real fire-and-forget save after ensureConnected's pre-existing flush.
      (service as any).save();
      await writing.promise;
      clock = 44;
    });
    service.on('state', (state, captured: SaveRecording) => {
      recorder.event({ type: 'state', state }, captured);
    });
    const switching = recorder.invoke('click-b', b.id, async () => {
      await service.connect(b.id);
      store.selectSession(b.id);
      const saving = store.save('main.save');
      assert.equal(saving, store.flush(), 'Store still returns the original serialized write promise');
      const captured = recorder.saveFor(saving);
      enqueued.resolve();
      await saving;
      recorder.event({ type: 'state', state: store.state }, captured);
      recorder.finishInvocation('ok');
    });
    await enqueued.promise;
    const pending = recorder.snapshot().events.slice(start);
    assert.equal(pending.filter((e) => e.phase === 'store.write.end').length, 0);
    assert.equal(pending.find((e) => e.phase === 'connect.backend.end')?.at, 44);
    clock = 644;
    release.resolve();
    await switching;
    const events = recorder.snapshot().events.slice(start);
    const saves = events.filter((e) => e.phase === 'store.enqueue');
    const first = saves.find((e) => e.source === 'agent.save')!;
    const second = saves.find((e) => e.source === 'main.save')!;
    assert.notEqual(first.saveId, second.saveId);
    assert.equal(first.snapshotSelectedId, a.id);
    assert.equal(second.snapshotSelectedId, b.id);
    const phase = (name: string, saveId?: number) =>
      events.find((e) => e.phase === name && (saveId === undefined || e.saveId === saveId))!;
    assert.equal(phase('connect.backend.end').at - phase('connect.backend.start').at, 44);
    assert.equal(phase('store.write.start', second.saveId).at - second.at, 600);
    assert.equal(
      phase('store.replace.end', first.saveId).at - phase('store.replace.start', first.saveId).at,
      644,
    );
    const emissions = events.filter((e) => e.phase === 'event.send');
    assert.deepEqual(
      emissions.map((e) => [e.saveId, e.snapshotSelectedId, e.selectedId]),
      [
        [first.saveId, a.id, b.id],
        [second.saveId, b.id, b.id],
      ],
    );
    assert.equal(
      emissions.every((e) => e.invocationId === 'click-b'),
      true,
    );
    assert.equal(new Set(emissions.map((e) => e.eventSeq)).size, emissions.length);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'state.json'), 'utf8')).selectedSessionId, b.id);
    const exported = JSON.stringify(events);
    assert.equal(exported.includes(dir), false);
    assert.equal(exported.includes(a.draft), false);
  });

  test('failed writes retain persistence error semantics and emit a failure observation', async (t) => {
    const recorder = sessionSwitchRecording!;
    const { store, dir } = await fixture(t);
    const saved = await fs.readFile(path.join(dir, 'state.json'), 'utf8');
    const start = recorder.snapshot().events.length;
    const original = fs.writeFile;
    t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
      if (String(args[0]) === path.join(dir, 'state.json.tmp'))
        throw Object.assign(new Error('full'), { code: 'ENOSPC' });
      return original(...args);
    });
    const promise = store.save();
    assert.equal(promise, store.flush());
    await assert.rejects(promise, /ENOSPC/);
    assert.equal(store.storage.writable, false);
    assert.equal(await fs.readFile(path.join(dir, 'state.json'), 'utf8'), saved);
    assert.equal(
      recorder
        .snapshot()
        .events.slice(start)
        .find((e) => e.phase === 'store.write.end')?.outcome,
      'error',
    );
  });

  test('rename retry observation identifies state writes without changing retry timing', async (t) => {
    const { store, dir } = await fixture(t);
    const recorder = sessionSwitchRecording!;
    const start = recorder.snapshot().events.length;
    const original = fs.rename;
    let attempts = 0;
    t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
      if (String(args[0]) === path.join(dir, 'state.json.tmp') && attempts++ === 0)
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return original(...args);
    });
    await store.save();
    const rows = recorder.snapshot().events.slice(start);
    assert.equal(rows.find((e) => e.phase === 'store.replace.retry')?.fileKind, 'state');
    assert.equal(rows.find((e) => e.phase === 'store.replace.retry')?.attempt, 0);
    assert.equal(rows.find((e) => e.phase === 'store.replace.end' && e.fileKind === 'state')?.attempt, 1);
  });
}
