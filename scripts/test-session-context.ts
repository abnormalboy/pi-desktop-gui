import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLocalProvider, prepareRealPiFixture } from '../tests/support/local-provider';
import { AgentService } from '../electron/agent';
import { Workspace } from '../electron/workspace';
import { PiRpc } from '../electron/rpc';
import { resolvePi } from '../electron/environment';

process.env.PI_OFFLINE = '1';
const provider = await createLocalProvider();
const f = await prepareRealPiFixture(provider.baseUrl, 'session-context');
const settingsFile = path.join(f.agentDir, 'settings.json');
const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
const bPath = path.join(f.dir, 'project-b');
await fs.mkdir(path.join(bPath, '.pi', 'extensions'), { recursive: true });
await fs.writeFile(
  path.join(bPath, '.pi', 'extensions', 'context.js'),
  `
import path from 'node:path';
export default function(pi) {
  pi.registerCommand('cwd-' + path.basename(process.cwd()), { description: 'Context parity fixture', handler: async () => {} });
  pi.registerCommand('project-b-only', { description: 'Project B resource', handler: async () => {} });
}
`,
);
await fs.writeFile(
  path.join(bPath, '.pi', 'settings.json'),
  JSON.stringify({ compaction: { enabled: true } }),
);
await fs.writeFile(path.join(bPath, 'AGENTS.md'), 'PROJECT_B_CONTEXT_ONLY');
const bId = 'context-project-b';
f.store.state.projects.push({ id: bId, name: 'B', path: bPath, trusted: true, createdAt: Date.now() });
const b = f.store.createSession(bId);
const rpcOf = (service: AgentService) => (service as unknown as { rpc: PiRpc }).rpc;
const nativeStart = async (id: string) => {
  const session = f.store.session(id);
  const resolved = await resolvePi(f.store.state.settings);
  const rpc = new PiRpc();
  rpc.start(
    resolved.spec,
    await f.store.sessionDirectory(id),
    ['--mode', 'rpc', ...(session.file ? ['--session', session.file] : ['--session-id', id])],
    { PI_CODING_AGENT_DIR: f.agentDir, PI_TELEMETRY: '0' },
  );
  return rpc;
};
const inspect = async (rpc: PiRpc) => ({
  commands: (await rpc.request('get_commands')).commands.map((command) => command.name).sort(),
  state: await rpc.request('get_state'),
});
let service: AgentService | undefined;
let native: PiRpc | undefined;
try {
  for (const trust of ['always', 'never']) {
    // This preference belongs only to the generated test agent directory.
    await fs.writeFile(settingsFile, JSON.stringify({ ...settings, defaultProjectTrust: trust }));
    // Probe Pi's own defaults without a desktop trust override.
    native = await nativeStart(b.id);
    await native.request('prompt', { message: 'CONTEXT_B' });
    const cold = await inspect(native);
    b.file = cold.state.sessionFile;
    await native.close();
    native = await nativeStart(f.sessionId);
    await native.request('switch_session', { sessionPath: b.file });
    const reused = await inspect(native);
    if (trust === 'always') {
      assert.ok(cold.commands.includes('cwd-project-b'));
      assert.ok(reused.commands.includes('cwd-project'));
      assert.ok(cold.commands.includes('project-b-only') && reused.commands.includes('project-b-only'));
      assert.equal(cold.state.autoCompactionEnabled, reused.state.autoCompactionEnabled);
      assert.notDeepEqual(
        cold.commands,
        reused.commands,
        'a cwd-dependent extension differs from a cold start',
      );
      console.log(
        'PASS cross-directory parity probe: native switch leaves process.cwd at project A; desktop must restart across directories',
      );
    } else {
      assert.equal(cold.commands.includes('project-b-only'), false);
      assert.equal(reused.commands.includes('project-b-only'), false);
      assert.deepEqual(cold.commands, reused.commands, 'untrusted project resources remain excluded');
      console.log('PASS cold and reused native sessions exclude untrusted project resources');
    }
    await native.close();
    native = undefined;
  }
  service = new AgentService(f.store, new Workspace(f.dataDir));
  await service.connect(b.id);
  assert.ok((await inspect(rpcOf(service))).commands.includes('project-b-only'));
  await service.dispose();
  service = undefined;
  f.store.project(bId).trusted = false;
  service = new AgentService(f.store, new Workspace(f.dataDir));
  await assert.rejects(service.connect(b.id), /请先确认此项目/);
  assert.equal(service.runtime.connected, false);
  console.log('PASS explicit desktop project trust overrides Pi defaults; an untrusted project cannot start');
} finally {
  await native?.close();
  await service?.dispose();
  await provider.close();
}
