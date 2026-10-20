import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PiRpc } from '../electron/rpc';
import { WindowsProcessNotFoundError, terminateProcessTree } from '../electron/platform';
import { AgentService } from '../electron/agent';

// Inject only the timeout and OS termination result. The exit evidence still comes from
// a real child process and PiRpc's production exit listener, on every test platform.
async function runningRpc(t: TestContext) {
  const rpc = new PiRpc();
  const ready = once(rpc, 'event');
  rpc.start(
    {
      command: process.execPath,
      args: [
        '-e',
        "process.stdin.resume();setInterval(()=>{},1000);console.log(JSON.stringify({type:'ready'}))",
      ],
    },
    process.cwd(),
    [],
  );
  await ready;
  t.after(async () => {
    t.mock.restoreAll();
    await rpc.killTree();
  });
  // Go directly to the force-close boundary instead of sleeping for two seconds.
  t.mock.method(rpc as any, 'waitExit', async () => {});
  return rpc;
}

async function exitRoot(rpc: PiRpc) {
  const exited = once(rpc, 'exit');
  rpc.child!.kill();
  await exited;
}

function missingRoot(rpc: PiRpc) {
  return new WindowsProcessNotFoundError(
    rpc.child!.pid!,
    Object.assign(new Error('not found'), { code: 128 }),
  );
}

test('graceful close accepts a missing-PID race only after the child actually exits', async (t) => {
  const rpc = await runningRpc(t);
  const error = missingRoot(rpc);
  let confirmationAtExit: Promise<boolean> | undefined;
  rpc.once('exit', () => {
    confirmationAtExit = rpc.treeTerminationConfirmed();
  });
  t.mock.method(rpc as any, 'terminateTree', async () => {
    await exitRoot(rpc);
    throw error;
  });
  await rpc.close();
  assert.equal(rpc.closed, true);
  assert.equal(await confirmationAtExit, false, 'a root exit cannot confirm descendant termination');
  assert.equal(await rpc.treeTerminationConfirmed(), false);
});

test('graceful close waits for child exit when the missing-PID result arrives first', async (t) => {
  const rpc = await runningRpc(t);
  const waitExit = (PiRpc.prototype as any).waitExit;
  t.mock.method(rpc as any, 'waitExit', (ms: number) =>
    ms === 2000 ? Promise.resolve() : waitExit.call(rpc, ms),
  );
  t.mock.method(rpc as any, 'terminateTree', async () => {
    setTimeout(() => rpc.child!.kill(), 20);
    throw missingRoot(rpc);
  });
  await rpc.close();
  assert.equal(rpc.closed, true);
  assert.equal(await rpc.treeTerminationConfirmed(), false);
});

test('graceful close rejects a missing-PID error while the child is still alive', async (t) => {
  const rpc = await runningRpc(t);
  const error = missingRoot(rpc);
  t.mock.method(rpc as any, 'terminateTree', async () => {
    throw error;
  });
  await assert.rejects(rpc.close(), (actual) => actual === error);
  assert.equal(rpc.closed, false);
  assert.equal(await rpc.treeTerminationConfirmed(), false);
});

for (const code of [5, 128, 255, 'EPERM']) {
  test(`graceful close does not suppress an unclassified termination failure (${code}) after exit`, async (t) => {
    const rpc = await runningRpc(t);
    const error = Object.assign(new Error('termination failed'), { code });
    t.mock.method(rpc as any, 'terminateTree', async () => {
      await exitRoot(rpc);
      throw error;
    });
    await assert.rejects(rpc.close(), (actual) => actual === error);
    assert.equal(await rpc.treeTerminationConfirmed(), false);
  });
}

test('graceful close rejects a missing-PID error for a different child even after exit', async (t) => {
  const rpc = await runningRpc(t);
  const error = new WindowsProcessNotFoundError(rpc.child!.pid! + 1, new Error('different process'));
  t.mock.method(rpc as any, 'terminateTree', async () => {
    await exitRoot(rpc);
    throw error;
  });
  await assert.rejects(rpc.close(), (actual) => actual === error);
  assert.equal(await rpc.treeTerminationConfirmed(), false);
});

test('force-stop still rejects a missing root and never confirms the process tree', async (t) => {
  const rpc = await runningRpc(t);
  const error = missingRoot(rpc);
  t.mock.method(rpc as any, 'terminateTree', async () => {
    await exitRoot(rpc);
    throw error;
  });
  await assert.rejects(rpc.killTree(), (actual) => actual === error);
  assert.equal(await rpc.treeTerminationConfirmed(), false);
});

test('a tolerated close race keeps recovery blocked when a tool was running', async (t) => {
  const rpc = await runningRpc(t);
  const session = { id: 'close-race', draft: '' };
  const service = new AgentService(
    {
      state: { selectedSessionId: session.id },
      session: () => session,
      isTransientSession: () => false,
      promoteSession: () => session,
      save: async () => {},
    } as never,
    {} as never,
  );
  service.runtime.sessionId = session.id;
  service.runtime.tools.push({
    id: 'orphan',
    name: 'bash',
    args: { command: 'long-running-tool' },
    status: 'running',
    output: '',
    startedAt: Date.now(),
  });
  const internals = service as unknown as {
    rpc: PiRpc;
    installRpcHandlers: (rpc: PiRpc) => void;
    crashCleanup: Promise<void>;
  };
  internals.rpc = rpc;
  internals.installRpcHandlers(rpc);
  t.mock.method(rpc as any, 'terminateTree', async () => {
    await exitRoot(rpc);
    throw missingRoot(rpc);
  });
  await rpc.close();
  await internals.crashCleanup;
  assert.equal(service.runtime.crash?.cleanup, 'unconfirmed');
  assert.throws(() => service.assertCommandsStopped(), /无法确认/);
  await assert.rejects(service.connect(session.id), /无法确认/);
  await assert.rejects(service.recover(session.id), /无法确认/);
});

test(
  'Windows taskkill reports a missing exited PID without claiming tree termination',
  {
    skip: process.platform !== 'win32',
  },
  async (t) => {
    const rpc = await runningRpc(t);
    await exitRoot(rpc);
    await assert.rejects(
      terminateProcessTree(rpc.child!.pid!),
      (error) => error instanceof WindowsProcessNotFoundError && error.pid === rpc.child!.pid,
    );
  },
);
