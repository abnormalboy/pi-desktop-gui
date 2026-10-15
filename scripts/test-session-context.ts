import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLocalProvider, prepareRealPiFixture } from '../tests/support/local-provider';
import { AgentService } from '../electron/agent';
import { Workspace } from '../electron/workspace';
import type { PiRpc } from '../electron/rpc';
import { busy } from '../shared/types';

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
const settled = async (service: AgentService) => {
  const start = Date.now();
  while (busy(service.runtime.status)) {
    if (Date.now() - start > 20000) throw new Error('Context probe did not settle');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const inspect = async (rpc: PiRpc) => ({
  commands: (await rpc.request('get_commands')).commands.map((command) => command.name).sort(),
  state: await rpc.request('get_state'),
});
let service: AgentService | undefined;
try {
  for (const trust of ['always', 'never']) {
    // This preference belongs only to the generated test agent directory.
    await fs.writeFile(settingsFile, JSON.stringify({ ...settings, defaultProjectTrust: trust }));
    service = new AgentService(f.store, new Workspace(f.dataDir));
    await service.connect(b.id);
    await service.send(b.id, 'CONTEXT_B', [], 'steer');
    await settled(service);
    const cold = await inspect(rpcOf(service));
    await service.disconnect();
    await service.connect(f.sessionId);
    const rpc = rpcOf(service);
    await rpc.request('switch_session', { sessionPath: b.file });
    const reused = await inspect(rpc);
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
    await service.dispose();
    service = undefined;
  }
} finally {
  await service?.dispose();
  await provider.close();
}
