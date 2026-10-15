import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { AgentService } from '../electron/agent';
import { Workspace } from '../electron/workspace';
import { createLocalProvider, prepareRealPiFixture } from '../tests/support/local-provider';
import { busy } from '../shared/types';

process.env.PI_OFFLINE = '1';
const provider = await createLocalProvider();
const f = await prepareRealPiFixture(provider.baseUrl, 'model-errors');
const service = new AgentService(f.store, new Workspace(f.dataDir));
const settle = async () => {
  const start = Date.now();
  while (busy(service.runtime.status) || service.hasPendingWork) {
    if (Date.now() - start > 30000) throw new Error('Model error test timed out: ' + service.runtime.status);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
try {
  for (const [prompt, kind, count] of [
    ['E2E_401', 'auth', 1],
    ['E2E_429', 'busy', 1],
    ['E2E_429', 'busy', 2],
    ['E2E_429', 'busy', 3],
    ['E2E_QUOTA', 'quota', 1],
    ['E2E_OVERFLOW', 'context', 1],
    ['E2E_MODEL', 'model', 1],
  ] as const) {
    await service.send(f.sessionId, prompt, [], 'steer');
    await settle();
    assert.equal(service.runtime.status, 'error');
    assert.equal(service.runtime.errorKind, kind, service.runtime.error ?? 'Missing model error');
    assert.ok(!JSON.stringify(service.runtime).includes('sk-test12345678901234567890'));
    assert.equal(service.runtime.errorCount, count);
  }
  assert.equal(service.recentModelErrors.length, 5);
  assert.ok(service.recentModelErrors.every((item) => Object.keys(item).sort().join(',') === 'at,kind'));
  const counts = service.recentModelErrors.length;
  await service.send(f.sessionId, 'A successful request clears the error', [], 'steer');
  await settle();
  assert.equal(service.runtime.errorKind, undefined);
  assert.equal(service.recentModelErrors.length, counts);
  await service.send(f.sessionId, 'E2E_429', [], 'steer');
  await settle();
  assert.equal(service.runtime.errorCount, 1);
  console.log(
    'PASS real Pi provider classifications, consecutive failures, successful reset and five safe diagnostic entries',
  );

  await service.disconnect();
  const history = await service.history(f.sessionId);
  assert.ok(!JSON.stringify(history).includes('sk-test12345678901234567890'));
  const socket = http.createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as import('node:net').AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const modelFile = path.join(f.agentDir, 'models.json');
  const models = JSON.parse(await fs.readFile(modelFile, 'utf8'));
  models.providers['local-e2e'].baseUrl = `http://127.0.0.1:${port}/v1`;
  await fs.writeFile(modelFile, JSON.stringify(models));
  await service.send(f.sessionId, 'Connection refused test', [], 'steer');
  await settle();
  assert.equal(service.runtime.errorKind, 'network', service.runtime.error ?? 'Missing network error');
  console.log(
    'PASS real connection refusal is classified, and persisted history redacts provider credentials',
  );
} finally {
  await service.dispose();
  await provider.close();
}
