import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { attachmentInfo, attachmentPrompt, safePath } from '../electron/workspace';
import { parseAttachmentSpec, normalizeAttachmentSpec } from '../shared/attachments';
import { alignHunk, hunkPrompt, inlineDiff, parseDiffHunks } from '../shared/diff';
import { createAgentRules, projectRules } from '../electron/project-rules';
import type { Project } from '../shared/types';

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-workspace-v014-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return {
    root,
    project: {
      id: randomUUID(),
      path: root,
      name: 'workspace',
      trusted: true,
      createdAt: Date.now(),
    } satisfies Project,
  };
}

test('attachment ranges normalize both syntaxes and reject invalid or reversed line numbers', () => {
  assert.deepEqual(parseAttachmentSpec('src/a.ts#L10-L40'), { path: 'src/a.ts', startLine: 10, endLine: 40 });
  assert.equal(normalizeAttachmentSpec('src/a.ts:15'), 'src/a.ts#L15-L15');
  assert.equal(normalizeAttachmentSpec('dir/file:name.ts:1-4'), 'dir/file:name.ts#L1-L4');
  assert.deepEqual(parseAttachmentSpec('src/a.ts'), { path: 'src/a.ts' });
  for (const spec of ['a#L0-L1', 'a:4-2', 'a#L9007199254740992', 'a#Lx-L3', 'a#L1-L', 'a\0.ts'])
    assert.throws(() => parseAttachmentSpec(spec));
});

test('a project root alias resolves local files without allowing traversal or links outside the real root', async (t) => {
  const { project, root } = await fixture(t);
  const real = path.join(root, 'actual'),
    outside = path.join(root, 'outside'),
    alias = path.join(root, 'alias');
  await fs.mkdir(real);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(real, 'file.ts'), 'local file\n');
  await fs.writeFile(path.join(real, 'AGENTS.md'), '# local rules\n');
  await fs.writeFile(path.join(outside, 'secret.txt'), 'outside');
  try {
    await fs.symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await fs.symlink(outside, path.join(real, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('symlink creation requires privileges');
      return;
    }
    throw error;
  }
  const linked = { ...project, path: alias };
  assert.match(await attachmentPrompt(linked, 'read', ['file.ts#L1-L1']), /local file/);
  assert.equal((await projectRules(linked))?.relativePath, 'AGENTS.md');
  await assert.rejects(safePath(alias, '../outside/secret.txt'), /项目以外/);
  await assert.rejects(safePath(alias, 'escape/secret.txt'), /项目外/);
});

test('attachment slices allow a large source, clamp the end, and report exact selected content bytes', async (t) => {
  const { project, root } = await fixture(t);
  await fs.writeFile(
    path.join(root, 'large.ts'),
    Array.from({ length: 12000 }, (_, i) => `line ${i + 1}: ${'x'.repeat(130)}`).join('\r\n'),
  );
  await assert.rejects(attachmentPrompt(project, '', ['large.ts']), /指定行范围/);
  const prompt = await attachmentPrompt(project, 'review', ['large.ts:10-30']);
  assert.match(prompt, /path="large.ts" lines="10-30"/);
  assert.match(prompt, /line 10:/);
  assert.match(prompt, /line 30:/);
  assert.doesNotMatch(prompt, /line 31:/);
  const info = await attachmentInfo(project, ['large.ts#L10-L30']);
  assert.equal(info[0].lines, 21);
  assert.equal(info[0].bytes, Buffer.byteLength(prompt.split('>\n')[1].split('\n</project_file>')[0]));
  assert.match(await attachmentPrompt(project, '', ['large.ts#L11999-L20000']), /lines="11999-12000"/);
  await assert.rejects(attachmentPrompt(project, '', ['large.ts#L12001-L13000']), /超出文件范围/);
  await assert.rejects(attachmentPrompt(project, '', ['large.ts#L1-L5000']), /片段超过 256 KiB/);
});

test('ranged attachments retain credential, binary, traversal, file-size and combined-size checks', async (t) => {
  const { project, root } = await fixture(t);
  await fs.writeFile(path.join(root, '.env'), 'secret=value');
  await fs.writeFile(path.join(root, 'binary'), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(root, 'huge.txt'), 'x'.repeat(5 * 1024 * 1024 + 1));
  await fs.writeFile(path.join(root, 'small.txt'), 'content');
  await assert.rejects(attachmentPrompt(project, '', ['.env:1']), /凭据/);
  await assert.rejects(attachmentPrompt(project, '', ['binary:1']), /二进制/);
  await assert.rejects(attachmentPrompt(project, '', ['../outside:1']), /项目以外/);
  await assert.rejects(attachmentPrompt(project, '', ['huge.txt:1']), /超过 5 MiB/);
  await assert.rejects(
    attachmentPrompt(project, 'x'.repeat(1024 * 1024 - 1), ['small.txt']),
    /总计超过 1 MiB/,
  );
});

test('hunk parsing aligns inserted lines and highlights only changed words', () => {
  const patch =
    '@@ -2,2 +2,3 @@\n-const count = oldValue;\n+const count = newValue;\n+const extra = 1;\n return count;\n';
  const [hunk] = parseDiffHunks(patch),
    rows = alignHunk(hunk);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].left?.line, 2);
  assert.equal(rows[0].right?.line, 2);
  assert.equal(rows[1].left, undefined);
  assert.equal(rows[1].right?.line, 3);
  assert.equal(rows[2].left?.line, 3);
  assert.deepEqual(hunkPrompt('src/a.ts', hunk), {
    attachment: 'src/a.ts#L2-L4',
    text: '请看 src/a.ts 第 2–4 行的改动：',
  });
  const [before, after] = inlineDiff('const value = oldName;', 'const value = newName;');
  assert.equal(
    before
      .filter((part) => part.changed)
      .map((part) => part.text)
      .join(''),
    'oldName',
  );
  assert.equal(
    after
      .filter((part) => part.changed)
      .map((part) => part.text)
      .join(''),
    'newName',
  );
  const deletion = hunkPrompt('a.ts', parseDiffHunks('@@ -1,1 +0,0 @@\n-gone')[0]);
  assert.equal(deletion.attachment, undefined);
  assert.match(deletion.text, /```diff\n@@ -1,1 \+0,0 @@\n-gone\n```/);
});

test('project rules detect the Pi alternative, derive declared scripts and never overwrite existing rules', async (t) => {
  const { project, root } = await fixture(t);
  assert.equal(await projectRules(project), undefined);
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { build: 'vite build', test: 'node --test', 'bad\nname': 'no' } }),
  );
  const created = await createAgentRules(project);
  assert.equal(created.relativePath, 'AGENTS.md');
  const content = await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(content, /npm run build/);
  assert.match(content, /npm run test/);
  assert.doesNotMatch(content, /bad\nname/);
  await assert.rejects(createAgentRules(project), /已经存在/);
  assert.equal(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8'), content);
  await fs.rm(path.join(root, 'AGENTS.md'));
  await fs.mkdir(path.join(root, '.pi'));
  await fs.writeFile(path.join(root, '.pi', 'SYSTEM.md'), 'custom rules');
  assert.equal((await projectRules(project))?.relativePath, '.pi/SYSTEM.md');
  await assert.rejects(createAgentRules(project), /已经存在/);
});
