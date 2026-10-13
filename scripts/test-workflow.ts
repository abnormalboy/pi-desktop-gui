import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLocalProvider, prepareRealPiFixture } from '../tests/support/local-provider';
import { AgentService } from '../electron/agent';
import { Workspace } from '../electron/workspace';
import { listPiSessions, searchSessionContents } from '../electron/history';
import { messageText, busy } from '../shared/types';
process.env.PI_OFFLINE = '1';
const provider = await createLocalProvider();
const f = await prepareRealPiFixture(provider.baseUrl, 'workflow');
const models = JSON.parse(await fs.readFile(path.join(f.agentDir, 'models.json'), 'utf8'));
models.providers['local-e2e'].models.push({
  ...models.providers['local-e2e'].models[0],
  id: 'local-e2e-reasoning',
  name: '本地推理模型',
  reasoning: true,
});
await fs.writeFile(path.join(f.agentDir, 'models.json'), JSON.stringify(models));
const s = new AgentService(f.store, new Workspace(f.dataDir));
async function until(fn: () => boolean) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > 20000) throw new Error('Timeout ' + s.runtime.status + ' ' + s.runtime.error);
    await new Promise((r) => setTimeout(r, 40));
  }
}
const userTexts = () => s.runtime.messages.filter((m) => m.role === 'user').map((m) => messageText(m));
try {
  await s.connect(f.sessionId);
  const initialModel = s.runtime.model!.id;
  const initialThinking = s.runtime.thinking;
  await s.send(f.sessionId, 'WORKFLOW_FIRST', [], 'steer');
  await until(() => !busy(s.runtime.status));
  await s.send(f.sessionId, 'WORKFLOW_SECOND', [], 'steer');
  await until(() => !busy(s.runtime.status));
  assert.deepEqual(userTexts(), ['WORKFLOW_FIRST', 'WORKFLOW_SECOND']);

  const alternate = f.store.createSession(f.projectId);
  await s.setModel(alternate.id, 'local-e2e', 'local-e2e-reasoning');
  await s.connect(alternate.id);
  const alternateThinking = s.runtime.thinkingLevels.find((level) => level !== initialThinking)!;
  await s.setThinking(alternate.id, alternateThinking);
  await s.connect(f.sessionId);
  assert.equal(s.runtime.model?.id, initialModel, 'default model must be remembered by the session');
  assert.equal(s.runtime.thinking, initialThinking);

  await s.disconnect();
  delete f.store.session(f.sessionId).model;
  delete f.store.session(f.sessionId).thinking;
  await f.store.save();
  await s.connect(f.sessionId);
  assert.equal(s.runtime.model?.id, initialModel, 'existing Pi history must retain its model');
  assert.equal(s.runtime.thinking, initialThinking);
  const fresh = f.store.createSession(f.projectId);
  await s.connect(fresh.id);
  assert.equal(s.runtime.model?.id, 'local-e2e-reasoning', 'new sessions use the latest default');
  assert.equal(s.runtime.thinking, alternateThinking);
  await s.connect(f.sessionId);
  console.log('PASS default session choices, existing history and new-session defaults stay separate');

  const preferences = () =>
    structuredClone({
      model: f.store.session(f.sessionId).model,
      thinking: f.store.session(f.sessionId).thinking,
      settings: f.store.state.settings,
    });
  const beforeRejectedSwitch = preferences();
  await assert.rejects(s.setModel(f.sessionId, 'local-e2e', 'missing-model'), /模型当前不可用/);
  await assert.rejects(s.setThinking(f.sessionId, 'unsupported-level'), /不支持这个推理级别/);
  assert.deepEqual(preferences(), beforeRejectedSwitch);
  const rpc = (s as any).rpc;
  const request = rpc.request.bind(rpc);
  rpc.request = (type: string, ...args: any[]) =>
    type === 'set_model' || type === 'set_thinking_level'
      ? Promise.reject(new Error('TEST_SWITCH_REJECTED'))
      : request(type, ...args);
  try {
    await assert.rejects(s.setModel(f.sessionId, 'local-e2e', 'local-e2e-reasoning'), /TEST_SWITCH_REJECTED/);
    await assert.rejects(s.setThinking(f.sessionId, s.runtime.thinkingLevels[0]), /TEST_SWITCH_REJECTED/);
  } finally {
    rpc.request = request;
  }
  assert.deepEqual(preferences(), beforeRejectedSwitch);
  await f.store.save();
  const persisted = JSON.parse(await fs.readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
  assert.deepEqual(persisted.settings, beforeRejectedSwitch.settings);
  assert.deepEqual(
    persisted.sessions.find((session: { id: string }) => session.id === f.sessionId).model,
    beforeRejectedSwitch.model,
  );
  console.log('PASS rejected model/thinking changes leave saved preferences unchanged');

  const rpcBefore = (s as any).rpc;
  await s.setModel(f.sessionId, 'local-e2e', 'local-e2e-reasoning');
  assert.equal((s as any).rpc, rpcBefore, 'model switch must not restart Pi');
  assert.equal(s.runtime.model?.id, 'local-e2e-reasoning');
  assert.ok(s.runtime.thinkingLevels.length > 1);
  const level = s.runtime.thinkingLevels.find((l) => l !== s.runtime.thinking)!;
  await s.setThinking(f.sessionId, level);
  assert.equal(s.runtime.thinking, level);
  assert.deepEqual(f.store.session(f.sessionId).model, { provider: 'local-e2e', id: 'local-e2e-reasoning' });
  assert.equal(f.store.session(f.sessionId).thinking, level);
  await s.send(f.sessionId, 'WORKFLOW_AFTER_SWITCH', [], 'steer');
  await until(() => !busy(s.runtime.status));
  assert.equal(provider.requests.at(-1).model, 'local-e2e-reasoning');
  await s.disconnect();
  await s.connect(f.sessionId);
  assert.equal(s.runtime.model?.id, 'local-e2e-reasoning', 'per-session model restored on reconnect');
  assert.equal(s.runtime.thinking, level);
  console.log('PASS live model and thinking switch without restart, remembered per session');

  const last = s.runtime.messages.findLast((m) => m.role === 'assistant')!;
  const requestsBefore = provider.requests.length;
  await s.messageAction(f.sessionId, 'regenerate', 'assistant', last.timestamp!);
  await until(() => !busy(s.runtime.status));
  assert.equal(provider.requests.length, requestsBefore + 1);
  assert.deepEqual(userTexts(), ['WORKFLOW_FIRST', 'WORKFLOW_SECOND', 'WORKFLOW_AFTER_SWITCH']);
  console.log('PASS regenerate replaces the last reply on a new branch');

  const second = s.runtime.messages.find((m) => messageText(m) === 'WORKFLOW_SECOND')!;
  await s.messageAction(f.sessionId, 'edit', 'user', second.timestamp!);
  assert.equal(f.store.session(f.sessionId).draft, 'WORKFLOW_SECOND');
  assert.deepEqual(userTexts(), ['WORKFLOW_FIRST']);
  await s.send(f.sessionId, 'WORKFLOW_EDITED', [], 'steer');
  await until(() => !busy(s.runtime.status));
  assert.deepEqual(userTexts(), ['WORKFLOW_FIRST', 'WORKFLOW_EDITED']);
  const tree = await s.tree(f.sessionId);
  assert.ok(
    tree.some((e) => e.text.includes('WORKFLOW_SECOND') && !e.active),
    'original kept in tree',
  );
  console.log('PASS edit-and-resend rewinds to before the message and keeps the old branch');

  const original = f.sessionId;
  const first = s.runtime.messages.find((m) => messageText(m) === 'WORKFLOW_FIRST')!;
  await s.messageAction(original, 'fork', 'user', first.timestamp!);
  const forked = s.runtime.sessionId!;
  assert.notEqual(forked, original);
  assert.equal(f.store.session(forked).draft, 'WORKFLOW_FIRST');
  assert.notEqual(f.store.session(forked).file, f.store.session(original).file);
  console.log('PASS fork from a message creates a new session and keeps the original');

  const matches = await searchSessionContents(f.store.state.sessions, 'workflow_edited');
  assert.ok(matches.some((m) => m.sessionId === original && m.snippet.includes('WORKFLOW_EDITED')));
  const roots = [path.join(f.dataDir, 'sessions')];
  const known = new Set<string>();
  const listed = await listPiSessions(roots, known);
  assert.ok(listed.some((x) => x.preview.includes('WORKFLOW_FIRST')));
  const hidden = await listPiSessions(
    roots,
    new Set(f.store.state.sessions.filter((x) => x.file).map((x) => path.resolve(x.file!).toLowerCase())),
  );
  assert.equal(hidden.length, 0, 'sessions already in the app are not listed again');
  console.log('PASS content search and Pi session discovery');

  s.runtime.notifications = [];
  (s as any).extension({
    type: 'extension_ui_request',
    id: 'n1',
    method: 'notify',
    message: 'warn me',
    notifyType: 'warning',
  });
  (s as any).onEvent({ type: 'extension_error', extensionPath: 'x', event: 'e', error: 'boom' });
  assert.deepEqual(
    s.runtime.notifications!.map((n) => n.level),
    ['warning', 'error'],
  );
  console.log('PASS notification levels reach the UI');
} finally {
  await s.dispose().catch(() => {});
  await provider.close();
}
