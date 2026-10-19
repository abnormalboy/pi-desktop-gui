import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLocalProvider, prepareRealPiFixture } from '../tests/support/local-provider';
import { AgentService } from '../electron/agent';
import { Workspace } from '../electron/workspace';
import { Configuration } from '../electron/configuration';
import { messageText, busy } from '../shared/types';
process.env.PI_OFFLINE = '1';
const provider = await createLocalProvider();
const f = await prepareRealPiFixture(provider.baseUrl, 'features');
const s = new AgentService(f.store, new Workspace(f.dataDir));
const config = new Configuration(f.store);
const png = (await fs.readFile(path.resolve('build/icon.png'))).toString('base64');
async function until(fn: () => boolean) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > 20000) throw new Error('Timeout ' + s.runtime.status + ' ' + s.runtime.error);
    await new Promise((r) => setTimeout(r, 40));
  }
}
try {
  await s.connect(f.sessionId);
  await s.send(f.sessionId, 'IMAGE_E2E', [], 'steer', [
    { id: 'image', name: 'image.png', data: png, mimeType: 'image/png' },
  ]);
  await until(() => !busy(s.runtime.status));
  assert.equal(s.runtime.status, 'completed', s.runtime.error ?? '');
  assert.ok(
    provider.requests
      .at(-1)
      .messages.some(
        (m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === 'image_url'),
      ),
  );
  assert.ok(
    s.runtime.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'image')),
  );
  console.log('PASS real Pi image delivery and history');
  await s.send(f.sessionId, 'SECOND_MESSAGE', [], 'steer');
  await until(() => !busy(s.runtime.status));
  const tree = await s.tree(f.sessionId);
  const user = tree.find((e) => e.role === 'user')!;
  assert.ok(user);
  const original = f.store.session(f.sessionId).file;
  await s.branch(f.sessionId, 'clone');
  const cloned = f.store.state.selectedSessionId!;
  assert.notEqual(cloned, f.sessionId);
  assert.notEqual(f.store.session(cloned).file, original);
  assert.equal(s.runtime.sessionId, f.sessionId, 'clone must leave the source process untouched');
  await s.connect(cloned);
  assert.ok(s.runtime.messages.some((m) => messageText(m).includes('SECOND_MESSAGE')));
  await s.connect(f.sessionId);
  await s.branch(f.sessionId, 'fork', user.id);
  const forked = f.store.state.selectedSessionId!;
  assert.notEqual(forked, cloned);
  assert.equal(s.runtime.sessionId, f.sessionId, 'fork must leave the source process untouched');
  assert.equal(f.store.session(forked).draft, 'IMAGE_E2E');
  assert.equal(f.store.session(forked).images?.length, 1);
  assert.equal(f.store.session(f.sessionId).file, original);
  await s.connect(f.sessionId);
  const assistant = tree.find((e) => e.role === 'assistant')!;
  await s.branch(f.sessionId, 'navigate', assistant.id);
  assert.ok(!s.runtime.messages.some((m) => messageText(m).includes('SECOND_MESSAGE')));
  await s.send(f.sessionId, 'BRANCHED_MESSAGE', [], 'steer');
  await until(() => !busy(s.runtime.status));
  const branches = await s.tree(f.sessionId);
  assert.ok(branches.some((e) => e.text.includes('SECOND_MESSAGE') && !e.active));
  assert.ok(branches.some((e) => e.text.includes('BRANCHED_MESSAGE') && e.active));
  console.log('PASS real tree navigation, fork and clone preserve original branches');
  await s.option(f.sessionId, 'autoCompaction', true);
  assert.equal(s.runtime.autoCompaction, true);
  await s.option(f.sessionId, 'autoRetry', true);
  assert.equal(s.runtime.autoRetry, true);
  await s.option(f.sessionId, 'steeringMode', 'all');
  assert.equal(s.runtime.steeringMode, 'all');
  await s.option(f.sessionId, 'followUpMode', 'all');
  assert.equal(s.runtime.followUpMode, 'all');
  await s.send(f.sessionId, '!printf DESKTOP_BASH_TEST', [], 'steer');
  assert.ok(
    s.runtime.messages.some(
      (m) => m.role === 'bashExecution' && String(m.output).includes('DESKTOP_BASH_TEST'),
    ),
  );
  await s.send(f.sessionId, '!!printf DESKTOP_EXCLUDED', [], 'steer');
  assert.ok(s.runtime.messages.some((m) => m.role === 'bashExecution' && m.excludeFromContext === true));
  console.log('PASS native settings and direct shell with context inclusion/exclusion');
  const providers = await s.admin(f.sessionId, 'providers');
  assert.ok(providers.some((p: any) => p.id === 'openai' && p.apiKey));
  const login = s.admin(f.sessionId, 'login', { provider: 'openai', type: 'api_key' });
  await until(() => s.runtime.dialogs.length > 0);
  assert.ok(s.runtime.dialogs[0].title.startsWith('[密钥]'));
  await s.respond(s.runtime.dialogs[0].id, { value: 'local-test-credential' });
  await login;
  const authFile = path.join(f.agentDir, 'auth.json');
  assert.ok(JSON.parse(await fs.readFile(authFile, 'utf8')).openai);
  assert.ok(!JSON.stringify(s.runtime).includes('local-test-credential'));
  await s.admin(f.sessionId, 'logout', { provider: 'openai' });
  assert.ok(!JSON.parse(await fs.readFile(authFile, 'utf8')).openai);
  console.log('PASS native API key login/logout without credential exposure');
  const resources = await s.admin(f.sessionId, 'resources');
  const extension = resources.resources.find((r: any) => r.path.endsWith('gui-e2e.js'));
  assert.ok(extension);
  await s.admin(f.sessionId, 'toggle_resource', { resource: extension, enabled: false });
  assert.ok(!s.runtime.commands.some((c) => c.name === 'gui-select'));
  await s.admin(f.sessionId, 'toggle_resource', { resource: extension, enabled: true });
  assert.ok(s.runtime.commands.some((c) => c.name === 'gui-select'));
  console.log('PASS actual extension disable/re-enable and reload');
  await s.exportHtml(f.sessionId, path.join(f.dir, 'session.html'));
  assert.match(await fs.readFile(path.join(f.dir, 'session.html'), 'utf8'), /<!DOCTYPE html>/i);
  const settings = await config.read(f.sessionId, 'settings', false);
  const value = JSON.parse(settings.text);
  value.compaction = { enabled: false, keepRecentTokens: 1, reserveTokens: 1024 };
  await s.disconnect();
  await config.save(f.sessionId, 'settings', false, { ...settings, text: JSON.stringify(value) });
  await s.connect(f.sessionId);
  await s.send(f.sessionId, 'LONG_MESSAGE ' + '保留上下文记录。'.repeat(2000), [], 'steer');
  await until(() => !busy(s.runtime.status));
  const result = await s.compact(f.sessionId, '保留重要内容');
  assert.ok(result.summary);
  assert.ok(result.tokensBefore > 0);
  assert.ok(
    s.runtime.messages.some((m) => messageText(m).includes('BRANCHED_MESSAGE')),
    'compaction must preserve the complete visible conversation',
  );
  await s.send(f.sessionId, 'AFTER_COMPACTION_FINAL_SUMMARY', [], 'steer');
  await until(() => !s.hasPendingWork);
  assert.equal(messageText(s.runtime.messages.findLast((m) => m.role === 'assistant')!), 'OK');
  assert.ok(s.runtime.messages.some((m) => messageText(m).includes('BRANCHED_MESSAGE')));
  console.log('PASS real HTML export and model-backed manual compaction');
  const chat = f.store.createSession();
  await s.connect(chat.id);
  await s.send(chat.id, '!printf STANDALONE_TOOLS', [], 'steer');
  assert.ok(s.runtime.messages.some((m) => String(m.output).includes('STANDALONE_TOOLS')));
  assert.ok(s.runtime.commands.some((c) => c.name === 'gui-select'));
  const cmd = s.send(chat.id, '/gui-select', [], 'steer');
  await until(() => s.runtime.dialogs.length > 0);
  await s.respond(s.runtime.dialogs[0].id, { value: 'A' });
  await cmd;
  console.log('PASS standalone shell tools and extension dialogs');
  await s.send(chat.id, 'E2E_SLOW', [], 'steer');
  await until(() => s.runtime.status === 'running');
  await s.send(chat.id, 'QUEUED_IMAGE', [], 'followUp', [
    { id: 'queued-image', name: 'image.png', data: png, mimeType: 'image/png' },
  ]);
  await s.stop();
  assert.equal(f.store.session(chat.id).images?.[0]?.id, 'queued-image');
  assert.match(f.store.session(chat.id).draft, /QUEUED_IMAGE/);
  console.log('PASS stop restores queued image with its text');
  console.log('Features integration PASS:', f.dir);
} finally {
  await s.dispose();
  await provider.close();
}
