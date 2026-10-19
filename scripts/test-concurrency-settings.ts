import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { SessionAgents } from '../electron/session-agents';
import { Workspace } from '../electron/workspace';
import { Configuration } from '../electron/configuration';
import { APPROVAL_ALLOW } from '../shared/approval';
import { busy } from '../shared/types';
import { prepareRealPiFixture } from '../tests/support/local-provider';

process.env.PI_OFFLINE = '1';
let releaseStream!: () => void;
const streamGate = new Promise<void>((resolve) => {
  releaseStream = resolve;
});
const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const lastUser = body.messages.findLastIndex((message: any) => message.role === 'user');
  const content = body.messages[lastUser]?.content;
  const prompt =
    typeof content === 'string' ? content : (content ?? []).map((item: any) => item.text ?? '').join('');
  const turn = body.messages.slice(lastUser + 1).filter((message: any) => message.role === 'tool').length;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (delta: object, finish_reason: string | null = null) =>
    res.write(
      `data: ${JSON.stringify({
        id: 'concurrency-settings',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`,
    );
  if (prompt.includes('SNAPSHOT_STREAM')) {
    send({ role: 'assistant', content: '已产生的流式内容 <snapshot>' });
    await streamGate;
    if (res.destroyed) return;
    send({ content: '仅在导出后产生的内容' });
    send({}, 'stop');
  } else if (prompt.startsWith('APPROVAL_') && turn < 2) {
    send({
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id: `write-${prompt}-${turn}`,
          type: 'function',
          function: {
            name: 'write',
            arguments: JSON.stringify({
              path: `${prompt}-${turn}.txt`,
              content: `approved ${prompt} ${turn}`,
            }),
          },
        },
      ],
    });
    send({}, 'tool_calls');
  } else {
    send({ role: 'assistant', content: '完成' });
    send({}, 'stop');
  }
  res.end('data: [DONE]\n\n');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address() as import('node:net').AddressInfo;
const f = await prepareRealPiFixture(`http://127.0.0.1:${address.port}/v1`, 'concurrency-settings');
const agents = new SessionAgents(f.store, new Workspace(f.dataDir));
const a = agents.get(f.sessionId);
const second = f.store.createSession(f.projectId);
const b = agents.get(second.id);
const config = new Configuration(f.store);
const exists = (file: string) =>
  fs.stat(path.join(f.projectDir, file)).then(
    () => true,
    () => false,
  );
async function until(condition: () => boolean) {
  const deadline = Date.now() + 30000;
  while (!condition()) {
    assert.ok(
      Date.now() < deadline,
      JSON.stringify({ a: a.runtime.status, b: b.runtime.status, ae: a.runtime.error, be: b.runtime.error }),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
try {
  await Promise.all([a.connect(f.sessionId), b.connect(second.id)]);
  await Promise.all([a.setApprovalMode(f.sessionId, 'confirm'), b.setApprovalMode(second.id, 'confirm')]);
  await Promise.all([
    a.send(f.sessionId, 'APPROVAL_A', [], 'steer'),
    b.send(second.id, 'APPROVAL_B', [], 'steer'),
  ]);
  await until(() => a.runtime.dialogs.length === 1 && b.runtime.dialogs.length === 1);
  assert.notEqual(a.lastSwitch?.pid, b.lastSwitch?.pid);
  const aPid = a.lastSwitch?.pid,
    bPid = b.lastSwitch?.pid;
  const approvalA = a.runtime.dialogs[0],
    approvalB = b.runtime.dialogs[0];
  assert.equal(approvalA.approval?.path, 'APPROVAL_A-0.txt');
  assert.equal(approvalB.approval?.path, 'APPROVAL_B-0.txt');
  await a.setApprovalMode(f.sessionId, 'readonly');
  assert.equal(a.runtime.dialogs[0].id, approvalA.id);
  assert.equal(b.runtime.approvalMode, 'confirm');

  // Reads and a historical fork must not replace the source process or its pending approval.
  const tree = await a.tree(f.sessionId);
  const firstUser = tree.find((entry) => entry.role === 'user')!;
  await Promise.all([a.admin(f.sessionId, 'resources'), a.admin(f.sessionId, 'providers')]);
  await a.branch(f.sessionId, 'fork', firstUser.id);
  const fork = f.store.session(f.store.state.selectedSessionId!);
  assert.notEqual(fork.id, f.sessionId);
  assert.equal(fork.draft, 'APPROVAL_A');
  assert.equal(a.runtime.sessionId, f.sessionId);
  assert.equal(a.lastSwitch?.pid, aPid);
  assert.equal(a.runtime.dialogs[0].id, approvalA.id);
  console.log(
    'PASS real Pi reads and historical forks remain available during two independent pending approvals',
  );

  const skill = path.join(f.agentDir, 'deferred-skill', 'SKILL.md');
  await fs.mkdir(path.dirname(skill));
  await fs.writeFile(
    skill,
    '---\nname: deferred-skill\ndescription: Deferred loading test\n---\nReport test state.\n',
  );
  const document = await config.read(f.sessionId, 'settings', false);
  const values = JSON.parse(document.text);
  values.skills = [skill];
  const saved = await config.saveAndApply(
    f.sessionId,
    'settings',
    false,
    { ...document, text: JSON.stringify(values) },
    () => agents.reloadConfiguration(f.sessionId, false),
  );
  assert.deepEqual(saved, { applied: false, deferred: true });
  assert.equal(a.lastSwitch?.pid, aPid);
  assert.equal(b.lastSwitch?.pid, bPid);
  assert.equal(a.runtime.dialogs[0].id, approvalA.id);

  // Saving an environment path affects a new process, while the existing task remains answerable.
  f.store.state.settings.nodePath = path.join(f.dir, 'missing-node.exe');
  await f.store.save();
  const third = f.store.createSession(f.projectId);
  await assert.rejects(agents.get(third.id).connect(third.id), /Node.js/);
  assert.equal(a.runtime.status, 'waiting');
  assert.equal(b.runtime.status, 'waiting');
  f.store.state.settings.nodePath = process.execPath;
  await f.store.save();

  await b.respond(approvalB.id, { value: APPROVAL_ALLOW });
  await until(() => b.runtime.dialogs[0]?.approval?.path === 'APPROVAL_B-1.txt');
  assert.equal(a.runtime.dialogs[0].id, approvalA.id);
  assert.equal(await exists('APPROVAL_A-0.txt'), false);
  await a.respond(approvalA.id, { value: APPROVAL_ALLOW });
  await until(() => !agents.active(f.sessionId));
  assert.equal(await exists('APPROVAL_A-0.txt'), true, 'an existing approval remains the user decision');
  assert.equal(
    await exists('APPROVAL_A-1.txt'),
    false,
    'the subsequent tool follows the newly selected readonly mode',
  );
  assert.equal(a.runtime.approvalMode, 'readonly');
  assert.notEqual(a.lastSwitch?.pid, aPid);
  assert.equal(b.lastSwitch?.pid, bPid);
  assert.equal(b.runtime.status, 'waiting');
  const resources = await a.admin(f.sessionId, 'resources');
  assert.ok(
    resources.resources.some((item: any) => item.kind === 'skills' && path.resolve(item.path) === skill),
  );
  await b.respond(b.runtime.dialogs[0].id, { value: APPROVAL_ALLOW });
  await until(() => !agents.active(second.id));
  assert.equal(await exists('APPROVAL_B-1.txt'), true);
  assert.notEqual(b.lastSwitch?.pid, bPid);
  console.log(
    'PASS real Pi approval changes affect later tools, preserve existing approvals and load saved Skills only after each session settles',
  );
  console.log('PASS new processes use the saved Node path; existing processes and approvals remain usable');

  await a.send(f.sessionId, 'SNAPSHOT_STREAM', [], 'steer');
  await until(() =>
    a.runtime.messages.some((message) => JSON.stringify(message.content).includes('已产生的流式内容')),
  );
  const jsonl = await a.captureExport(f.sessionId, 'jsonl', path.join(f.dataDir, 'snapshot.jsonl'));
  const temporary = path.join(f.dataDir, 'snapshot.html');
  const html = await a.captureExport(f.sessionId, 'html', temporary);
  assert.ok(busy(a.runtime.status));
  releaseStream();
  await until(() => !agents.active(f.sessionId));
  assert.match(jsonl.toString(), /已产生的流式内容/);
  assert.doesNotMatch(jsonl.toString(), /仅在导出后产生的内容/);
  assert.match(html.toString(), /已产生的流式内容 &lt;snapshot&gt;/);
  assert.doesNotMatch(html.toString(), /仅在导出后产生的内容/);
  assert.ok(
    a.runtime.messages.some((message) => JSON.stringify(message.content).includes('仅在导出后产生的内容')),
  );
  console.log(
    'PASS real Pi JSONL/HTML exports include the captured streaming content and exclude later output; the original task continues',
  );
} finally {
  releaseStream();
  await agents.dispose();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
