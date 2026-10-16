import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Configuration } from '../electron/configuration';
import { Store } from '../electron/store';

// Exercise the same persistence/apply method as the IPC handler with real files and synthetic errors.
async function fixture(t: test.TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-config-save-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  await store.load();
  store.state.settings.agentDir = path.join(dir, 'agent');
  const session = store.createSession();
  const config = new Configuration(store);
  await fs.mkdir(store.state.settings.agentDir);
  const file = path.join(store.state.settings.agentDir, 'settings.json');
  const original = '{"retry":{"enabled":true},"apiKey":"private-fixture-secret"}';
  await fs.writeFile(file, original);
  const document = await config.read(session.id, 'settings', false);
  const updated = JSON.parse(document.text);
  updated.retry.enabled = false;
  return { config, file, original, session, document: { ...document, text: JSON.stringify(updated) } };
}

test('configuration persists and backs up before applying, preserving masked secrets', async (t) => {
  const f = await fixture(t);
  const calls: string[] = [];
  const result = await f.config.saveAndApply(f.session.id, 'settings', false, f.document, {
    disconnect: async () => {
      calls.push('disconnect');
      assert.equal(await fs.readFile(f.file, 'utf8'), f.original);
    },
    connect: async (id) => {
      calls.push('connect');
      assert.equal(id, f.session.id);
      const saved = JSON.parse(await fs.readFile(f.file, 'utf8'));
      assert.equal(saved.retry.enabled, false);
      assert.equal(saved.apiKey, 'private-fixture-secret');
      assert.equal(await fs.readFile(f.file + '.desktop-backup', 'utf8'), f.original);
    },
  });
  assert.deepEqual(result, { applied: true });
  assert.deepEqual(calls, ['disconnect', 'connect']);
});

test('failed reconnect returns saved-but-not-applied and redacts the warning', async (t) => {
  const f = await fixture(t);
  const result = await f.config.saveAndApply(f.session.id, 'settings', false, f.document, {
    disconnect: async () => {},
    connect: async () => {
      throw new Error('Cannot connect: Authorization: Bearer private-token API_KEY="private-key"');
    },
  });
  assert.equal(result.applied, false);
  assert.match(result.warning!, /Cannot connect/);
  assert.ok(!JSON.stringify(result).includes('private-token'));
  assert.ok(!JSON.stringify(result).includes('private-key'));
  assert.ok(!JSON.stringify(result).includes('private-fixture-secret'));
  assert.equal(JSON.parse(await fs.readFile(f.file, 'utf8')).retry.enabled, false);
  assert.equal(await fs.readFile(f.file + '.desktop-backup', 'utf8'), f.original);
  const refreshed = await f.config.read(f.session.id, 'settings', false);
  assert.notEqual(refreshed.revision, f.document.revision);
  const next = { ...refreshed, text: JSON.stringify({ ...JSON.parse(refreshed.text), nextEdit: true }) };
  assert.deepEqual(
    await f.config.saveAndApply(f.session.id, 'settings', false, next, {
      disconnect: async () => {},
      connect: async () => {},
    }),
    { applied: true },
  );
  assert.equal(JSON.parse(await fs.readFile(f.file, 'utf8')).nextEdit, true);
});

test('save rejection remains a failure and does not reconnect or overwrite the original', async (t) => {
  const f = await fixture(t);
  let connected = false;
  await assert.rejects(
    f.config.saveAndApply(
      f.session.id,
      'settings',
      false,
      { ...f.document, revision: 'stale' },
      {
        disconnect: async () => {},
        connect: async () => {
          connected = true;
        },
      },
    ),
    /其他程序修改/,
  );
  assert.equal(connected, false);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.original);
});

test('disconnect failure remains a failure and cannot write or reconnect', async (t) => {
  const f = await fixture(t);
  let connected = false;
  await assert.rejects(
    f.config.saveAndApply(f.session.id, 'settings', false, f.document, {
      disconnect: async () => {
        throw new Error('cleanup incomplete');
      },
      connect: async () => {
        connected = true;
      },
    }),
    /cleanup incomplete/,
  );
  assert.equal(connected, false);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.original);
  await assert.rejects(fs.access(f.file + '.desktop-backup'), { code: 'ENOENT' });
});
