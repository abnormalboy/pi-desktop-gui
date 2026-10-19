import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentService } from '../electron/agent';
import { Workspace } from '../electron/workspace';
import { prepareRealPiFixture } from '../tests/support/local-provider';
import { createRetryProvider } from '../tests/support/retry-provider';

process.env.PI_OFFLINE = '1';
const provider = await createRetryProvider();
const f = await prepareRealPiFixture(provider.baseUrl, 'retry');
if (process.env.PI_DESKTOP_TEST_PI) {
  f.store.state.settings.piPath = path.resolve(process.env.PI_DESKTOP_TEST_PI);
  await f.store.save();
}
const file = path.join(f.agentDir, 'settings.json');
const original = JSON.parse(await fs.readFile(file, 'utf8'));
const settings = (delay: number, timeoutMs = 1500) =>
  fs.writeFile(
    file,
    JSON.stringify({
      ...original,
      retry: { enabled: true, maxRetries: 2, baseDelayMs: delay, provider: { maxRetries: 0, timeoutMs } },
    }),
  );
await settings(30);
const service = new AgentService(f.store, new Workspace(f.dataDir));
const until = async (condition: () => boolean) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > 20000)
      throw new Error(
        JSON.stringify({
          count: provider.count,
          status: service.runtime.status,
          error: service.runtime.error,
        }),
      );
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const settled = () => until(() => !service.hasPendingWork);
const send = (text: string) => service.send(f.sessionId, text, [], 'steer');
try {
  provider.reset('recover', true);
  await service.connect(f.sessionId);
  await send('RETRY_RECOVER');
  await until(() => provider.count === 2);
  assert.equal(service.runtime.status, 'retrying', 'agent_start must not hide an active retry');
  assert.equal(service.runtime.retry?.phase, 'requesting');
  assert.ok(service.runtime.retry?.requestedAt);
  provider.release();
  await settled();
  assert.equal(service.runtime.status, 'completed');
  assert.equal(provider.count, 4);
  assert.equal(service.runtime.tools.length, 1, 'recovery must not execute a finished tool twice');
  assert.equal(service.runtime.tools[0].status, 'done');
  assert.equal(service.runtime.retry, undefined);
  assert.equal(service.runtime.notices.filter((n) => n.startsWith('重试已恢复')).length, 2);
  assert.ok(!service.runtime.notices.some((n) => /^(正在重试|等待重试)/.test(n)));
  console.log('PASS real Pi retries remain visible until recovery and continue the tool chain once');

  provider.reset('success', true);
  await send('NORMAL_AFTER_RETRY');
  await until(() => provider.count === 1);
  assert.equal(service.runtime.status, 'running');
  assert.equal(service.runtime.notices.length, 0, 'a new run must not inherit recovered retry records');
  provider.release();
  await settled();
  assert.equal(service.runtime.status, 'completed');
  assert.equal(service.runtime.notices.length, 0);
  console.log('PASS a later normal run has no stale retry records while running or after completion');

  provider.reset('exhaust');
  await send('RETRY_EXHAUST');
  await settled();
  assert.equal(service.runtime.status, 'error');
  assert.equal(provider.count, 3);
  assert.equal(service.runtime.retry, undefined);
  assert.equal(service.runtime.notices.length, 1);
  assert.equal(service.runtime.notices.filter((n) => n.startsWith('重试失败')).length, 1);
  assert.match(service.runtime.notices.at(-1)!, /2\/2/);
  console.log('PASS exhausted retry attempts update one record and settle as an error');

  for (const phase of ['delay', 'requesting'] as const) {
    await service.disconnect();
    await settings(phase === 'delay' ? 1200 : 30, 15000);
    await service.connect(f.sessionId);
    provider.reset(phase === 'delay' ? 'cancel-delay' : 'cancel-request');
    await send('RETRY_CANCEL');
    await until(() => service.runtime.retry?.phase === phase && (phase === 'delay' || provider.count === 2));
    await service.abortRetry();
    await settled();
    assert.equal(provider.count, phase === 'delay' ? 1 : 2);
    assert.equal(service.runtime.status, 'stopped');
    assert.equal(service.runtime.retry, undefined);
    assert.equal(service.runtime.error, undefined);
    assert.match(service.runtime.notices.at(-1)!, /^重试已取消/);
    await until(() => provider.requests.at(-1)!.closed);
    console.log(`PASS cancelling a retry during ${phase} stops the run and closes its request`);
  }

  await service.disconnect();
  await settings(30);
  await service.connect(f.sessionId);
  provider.reset('timeout');
  const started = Date.now();
  await send('RETRY_TIMEOUT');
  await settled();
  assert.equal(service.runtime.status, 'completed');
  assert.ok(Date.now() - started >= 1000, 'the silent request must reach its configured timeout');
  assert.equal(provider.count, 2);
  assert.equal(service.runtime.retry, undefined);
  assert.match(service.runtime.notices.at(-1)!, /^重试已恢复/);
  console.log('PASS a silent HTTP response times out and recovers with the configured Pi timeout');
} finally {
  await service.dispose();
  await provider.close();
}
