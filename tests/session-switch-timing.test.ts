import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentService } from '../electron/agent';
import { Store } from '../electron/store';
import { Workspace } from '../electron/workspace';
import type { PiRpc } from '../electron/rpc';

test('warm-switch phases attribute waiting without changing RPC order or carrying over cold metrics', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-switch-timing-'));
  const store = new Store(dir);
  await store.load();
  const a = store.createSession(),
    b = store.createSession();
  a.cwd = b.cwd = dir;
  b.file = path.join(dir, 'fixture-session.jsonl');
  Object.assign(store.state.settings, {
    agentDir: dir,
    nodePath: process.execPath,
    piPath: path.resolve('tests/support/fixture-pi.mjs'),
    provider: 'fixture',
    modelId: 'test',
  });
  const service = new AgentService(store, new Workspace(dir));
  t.after(async () => {
    t.mock.restoreAll();
    await service.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });
  await service.connect(a.id);
  assert.equal(service.lastSwitch?.phasesMs, undefined);
  const internals = service as unknown as { rpc: PiRpc; crashCleanup: Promise<void> };
  const rpc = internals.rpc;
  const request = rpc.request.bind(rpc);
  const flush = store.flush.bind(store);
  const order: string[] = [];
  // A logical clock makes phase attribution deterministic, without timing
  // thresholds or sleeps that could fail on a busy cross-platform CI runner.
  let clock = 0;
  t.mock.method(performance, 'now', () => ++clock);
  internals.crashCleanup = {
    then(resolve: () => void) {
      clock += 10;
      resolve();
    },
  } as Promise<void>;
  t.mock.method(store, 'flush', async () => {
    await flush();
    clock += 20;
  });
  t.mock.method(rpc, 'request', async (type: string, ...args: any[]) => {
    order.push(type);
    const result = await request(type, ...args);
    if (type === 'switch_session') clock += 30;
    if (type === 'get_state') clock += 40;
    return result;
  });
  await service.connect(b.id);
  const timing = service.lastSwitch!;
  assert.equal(timing.mode, 'reuse');
  assert.equal(timing.sessionId, b.id);
  assert.equal(timing.pid, rpc.child?.pid);
  assert.deepEqual(Object.keys(timing.phasesMs!), [
    'crashCleanup',
    'storeFlush',
    'prepare',
    'nativeSwitch',
    'resetAndEvents',
    'rebind',
  ]);
  assert.equal(timing.phasesMs!.crashCleanup, 11);
  assert.equal(timing.phasesMs!.storeFlush, 21);
  assert.equal(timing.phasesMs!.nativeSwitch, 31);
  assert.equal(timing.rebindPhasesMs!.getState, 41);
  const total = (values: Record<string, number>) =>
    Object.values(values).reduce((sum, value) => sum + value, 0);
  assert.equal(total(timing.phasesMs!) + 1, timing.elapsedMs);
  assert.equal(total(timing.rebindPhasesMs!) + 2, timing.phasesMs!.rebind);
  assert.deepEqual(order, [
    'switch_session',
    'get_state',
    'get_messages',
    'get_commands',
    'get_available_models',
    'get_commands',
    'prompt',
    'get_available_thinking_levels',
    'get_session_stats',
    'set_session_name',
  ]);
  await fs.writeFile(path.join(dir, 'control.json'), JSON.stringify({ cancelSwitch: true }));
  await assert.rejects(service.connect(a.id), /取消了会话切换/);
  assert.equal(service.lastSwitch, timing, 'cancelled switches must not publish successful timing');
  t.mock.restoreAll();
  internals.crashCleanup = Promise.resolve();
  await service.disconnect();
  await service.connect(a.id);
  assert.equal(service.lastSwitch?.mode, 'restart');
  assert.equal(service.lastSwitch?.sessionId, a.id);
  assert.equal(service.lastSwitch?.phasesMs, undefined);
  assert.equal(service.lastSwitch?.rebindPhasesMs, undefined);
});
