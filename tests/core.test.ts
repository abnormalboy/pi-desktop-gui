import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LfJsonDecoder } from '../electron/rpc';
import { Store, readSessionFile } from '../electron/store';
import { Workspace, attachmentPrompt, previewFile, safePath } from '../electron/workspace';
import { AgentService, redact } from '../electron/agent';
import { busy, type Project } from '../shared/types';
const exec = promisify(execFile);
const root = path.resolve('work/tests');
// Fixtures live under this checkout; do not inherit its parent Git repository.
process.env.GIT_CEILING_DIRECTORIES = root;
async function sandbox() {
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, '用例 space-'));
}
const project = (p: string): Project => ({
  id: randomUUID(),
  name: '测试',
  path: p,
  trusted: true,
  createdAt: Date.now(),
});
async function git(p: string, ...args: string[]) {
  return exec('git', args, { cwd: p, windowsHide: true });
}
async function waitFor(condition: () => boolean, ms = 5000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error('Condition timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('LF decoder preserves split UTF-8, CRLF and Unicode separators; rejects malformed records', () => {
  const values: any[] = [],
    errors: Error[] = [];
  const decoder = new LfJsonDecoder(
    (v) => values.push(v),
    (e) => errors.push(e),
  );
  const bytes = Buffer.from(
    JSON.stringify({ type: 'message', text: '中文\u2028\u2029🙂' }) +
      '\r\n' +
      JSON.stringify({ type: 'second' }) +
      '\n',
  );
  for (let i = 0; i < bytes.length; i += 2) decoder.push(bytes.subarray(i, i + 2));
  assert.equal(values.length, 2);
  assert.equal(values[0].text, '中文\u2028\u2029🙂');
  assert.equal(errors.length, 0);
  decoder.push(Buffer.from('not json\n{"no_type":true}\n'));
  assert.equal(errors.length, 2);
});
test('store writes latest draft atomically and recovers interrupted session without replay', async () => {
  const dir = await sandbox(),
    store = new Store(dir);
  await store.load();
  const p = project(dir);
  store.state.projects = [p];
  store.state.sessions = [
    {
      id: randomUUID(),
      projectId: p.id,
      title: '会话',
      draft: '中文草稿',
      attachments: ['a.txt'],
      updatedAt: 1,
      lastStatus: 'running',
    },
  ];
  const first = store.save();
  store.state.sessions[0].draft = '最后草稿';
  await store.save();
  await first;
  const restored = new Store(dir);
  await restored.load();
  assert.equal(restored.state.sessions[0].draft, '最后草稿');
  assert.equal(restored.state.sessions[0].lastStatus, 'interrupted');
  await fs.writeFile(path.join(dir, 'state.json'), 'broken');
  await assert.rejects(new Store(dir).load(), /原文件已保留/);
  assert.equal(await fs.readFile(path.join(dir, 'state.json'), 'utf8'), 'broken');
});
test('JSONL history selects active branch and tolerates only a truncated final line', async () => {
  const dir = await sandbox(),
    file = path.join(dir, 'session.jsonl');
  const records = [
    { type: 'session', cwd: dir },
    { type: 'message', id: 'a', parentId: null, message: { role: 'user', content: 'A' } },
    { type: 'message', id: 'b', parentId: 'a', message: { role: 'assistant', content: 'old branch' } },
    { type: 'message', id: 'c', parentId: 'a', message: { role: 'assistant', content: 'new branch' } },
    { type: 'session_info', id: 'd', parentId: 'c', name: '会话' },
  ];
  await fs.writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n{"unfinished":');
  const parsed = await readSessionFile(file);
  assert.deepEqual(
    parsed.messages.map((m) => m.content),
    ['A', 'new branch'],
  );
  assert.equal(parsed.name, '会话');
  await fs.writeFile(file, '{"type":"session","cwd":"x"}\ninvalid\n');
  await assert.rejects(readSessionFile(file), /损坏/);
});
test('attachments reject traversal, sensitive files, binaries, oversize and deleted paths', async () => {
  const dir = await sandbox(),
    p = project(dir);
  await fs.writeFile(path.join(dir, '中文.txt'), 'hello 中文');
  await fs.writeFile(path.join(dir, '.env'), 'secret');
  await fs.writeFile(path.join(dir, 'binary.bin'), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(dir, 'large.txt'), 'x'.repeat(256 * 1024 + 1));
  assert.match(await attachmentPrompt(p, 'task', ['中文.txt']), /hello 中文/);
  await assert.rejects(attachmentPrompt(p, 'task', ['../outside']), /项目以外/);
  await assert.rejects(previewFile(p, '.env'), /凭据/);
  await assert.rejects(attachmentPrompt(p, 'task', ['binary.bin']), /文本/);
  await assert.rejects(attachmentPrompt(p, 'task', ['large.txt']), /256/);
  await assert.rejects(attachmentPrompt(p, 'task', ['deleted.txt']), /ENOENT/);
  const outside = await sandbox();
  await fs.writeFile(path.join(outside, 'secret.txt'), 'outside');
  await fs.symlink(outside, path.join(dir, 'junction'), 'junction');
  await assert.rejects(safePath(dir, 'junction/secret.txt'), /指向项目外/);
  await fs.writeFile(path.join(dir, 'big.txt'), 'x'.repeat(256 * 1024));
  await assert.rejects(attachmentPrompt(p, 'x'.repeat(800 * 1024), ['big.txt']), /总计/);
});
test('Git diff distinguishes preexisting edits, external edits, deleted and empty added files', async () => {
  const dir = await sandbox(),
    data = await sandbox(),
    p = project(dir);
  await git(dir, 'init');
  await fs.writeFile(path.join(dir, '已修改.txt'), 'original\n');
  await fs.writeFile(path.join(dir, 'delete.txt'), 'delete\n');
  await git(dir, 'add', '.');
  await git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  await fs.writeFile(path.join(dir, '已修改.txt'), 'before run\n');
  const ws = new Workspace(data);
  await ws.capture(p);
  await fs.writeFile(path.join(dir, '已修改.txt'), 'after run\n');
  await fs.unlink(path.join(dir, 'delete.txt'));
  await fs.writeFile(path.join(dir, 'empty.txt'), '');
  await fs.writeFile(path.join(dir, 'manual.txt'), 'external edit');
  const changes = await ws.changes(p, 'run');
  assert.equal(changes.files.length, 4);
  assert.equal(changes.files.find((f) => f.path === 'delete.txt')?.status, '删除');
  assert.equal(changes.files.find((f) => f.path === 'empty.txt')?.status, '新增');
  assert.equal(changes.files.find((f) => f.path === '已修改.txt')?.existedBeforeRun, true);
  assert.equal((await ws.diff(p, '已修改.txt', 'run')).before, 'before run\n');
  assert.equal((await ws.diff(p, '已修改.txt', 'all')).before, 'original\n');
  assert.equal((await new Workspace(data).changes(p, 'run')).baselineAvailable, true);
  await git(dir, 'checkout', '-b', 'other');
  assert.equal((await ws.changes(p, 'run')).baselineInvalid, true);
});
test('unborn repositories show additions and non-Git directories remain browsable', async () => {
  const dir = await sandbox(),
    p = project(dir),
    ws = new Workspace(await sandbox());
  await fs.writeFile(path.join(dir, 'file.txt'), 'first');
  assert.equal((await ws.changes(p)).git, false);
  await git(dir, 'init');
  assert.equal((await ws.changes(p)).files[0].status, '新增');
  assert.equal((await ws.diff(p, 'file.txt', 'all')).before, '');
});
test('real subprocess protocol lifecycle: settled, retry, cancellation, queue, extensions and crash', async () => {
  const dir = await sandbox(),
    data = await sandbox(),
    agentDir = await sandbox(),
    store = new Store(data);
  await store.load();
  const p = project(dir),
    id = randomUUID(),
    other = randomUUID();
  store.state.projects = [p];
  store.state.sessions = [id, other].map((id) => ({
    id,
    projectId: p.id,
    title: '新会话',
    draft: '',
    attachments: [],
    updatedAt: Date.now(),
    lastStatus: 'idle' as const,
  }));
  store.state.selectedSessionId = id;
  store.state.settings = {
    ...store.state.settings,
    piPath: path.resolve('tests/support/fixture-pi.mjs'),
    nodePath: process.execPath,
    agentDir,
  };
  const service = new AgentService(store, new Workspace(data));
  const statuses: string[] = [];
  service.on('runtime', (r) => statuses.push(r.status));
  try {
    await service.connect(id);
    assert.equal(service.runtime.connected, true);
    assert.ok(!JSON.stringify(service.runtime.model).includes('Authorization'));
    assert.ok(!JSON.stringify(service.runtime.models).includes('test-secret'));
    await service.send(id, '/handled', [], 'steer');
    assert.equal(service.runtime.status, 'idle');
    await service.send(id, 'retry', [], 'steer');
    await waitFor(() => service.runtime.status === 'retrying');
    assert.ok(busy(service.runtime.status));
    await waitFor(() => service.runtime.status === 'completed');
    assert.ok(statuses.includes('compacting'));
    await fs.writeFile(path.join(agentDir, 'control.json'), JSON.stringify({ cancelSwitch: true }));
    await assert.rejects(service.connect(other), /取消了会话切换/);
    assert.equal(service.runtime.sessionId, id);
    await service.send(id, 'hold', [], 'steer');
    await service.send(id, '补充要求', [], 'steer');
    await service.send(id, '后续任务', [], 'followUp');
    assert.deepEqual(service.runtime.steering, ['补充要求']);
    assert.deepEqual(service.runtime.followUp, ['后续任务']);
    await assert.rejects(service.send(other, '不应该发送', [], 'steer'), /已有会话/);
    await service.stop();
    assert.equal(service.runtime.status, 'stopped');
    assert.match(store.session(id).draft, /补充要求\n\n后续任务/);
    const commands = (await fs.readFile(path.join(agentDir, 'commands.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l).type);
    assert.ok(commands.indexOf('clear_queue') < commands.indexOf('abort'));
    for (const method of ['select', 'confirm', 'input', 'editor']) {
      await service.send(id, 'extension ' + method, [], 'steer');
      await waitFor(() => service.runtime.dialogs.length === 1);
      await service.respond(
        'question-1',
        method === 'select'
          ? { value: 'B' }
          : method === 'confirm'
            ? { confirmed: false }
            : { cancelled: true },
      );
      await waitFor(() => service.runtime.status === 'completed');
      assert.equal(service.runtime.dialogs.length, 0);
    }
    await service.send(id, 'extension input timeout', [], 'steer');
    await waitFor(() => service.runtime.status === 'completed');
    await assert.rejects(service.respond('question-1', { value: 'late' }), /已失效/);
    await service.send(id, 'crash', [], 'steer');
    await waitFor(() => service.runtime.status === 'interrupted');
    assert.equal(service.runtime.connected, false);
  } finally {
    await service.dispose();
  }
});
test('diagnostics redact common token formats', () => {
  const result = redact(
    'Authorization: Bearer abc123 api_key=secret123 sk-abcdefghijklmno ghp_abcdefghijklmno',
  );
  assert.ok(!result.includes('secret123'));
  assert.ok(!result.includes('sk-'));
  assert.ok(!result.includes('ghp_'));
  assert.ok(!result.includes('abc123'));
});
