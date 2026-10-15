import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { serializePromptTemplate, validatePromptTemplate, type PromptTemplateInput } from '../shared/prompts';
import {
  readPromptTemplate,
  savePromptTemplate,
  deletePromptTemplate,
  promptEditable,
  type PromptTemplateContext,
} from '../electron/prompts';
import type { ResourceItem } from '../shared/types';

const input: PromptTemplateInput = {
  name: 'check-diff',
  description: '检查: "模块" #说明',
  argumentHint: '<模块名> [关注点]',
  body: 'Review $1 with $ARGUMENTS\n',
  scope: 'project',
};
function resource(file: string, scope = 'project'): ResourceItem {
  return {
    path: file,
    kind: 'prompts',
    enabled: true,
    metadata: { source: 'auto', origin: 'top-level', scope },
  };
}

test('template frontmatter uses standard YAML strings and native Pi placeholders', () => {
  const raw = serializePromptTemplate(input);
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)!;
  assert.deepEqual(yaml.load(match[1]), {
    description: input.description,
    'argument-hint': input.argumentHint,
  });
  assert.equal(match[2], input.body);
  for (const name of [
    '../escape',
    'name/path',
    'a\\b',
    '.',
    '.hidden',
    'con',
    'LPT1',
    'x:y',
    'with space',
    'with_underscore',
    'a'.repeat(81),
  ])
    assert.throws(() => validatePromptTemplate({ ...input, name }), Error, name);
  assert.throws(() => validatePromptTemplate({ ...input, scope: 'package' }));
  assert.throws(() => validatePromptTemplate({ ...input, description: 'x\ny' }));
  assert.throws(() => validatePromptTemplate({ ...input, body: '中'.repeat(400_000) }));
});

test('native template CRUD preserves unknown frontmatter, rejects stale edits and limits scope', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-prompts-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, 'project'),
    agentDir = path.join(dir, 'agent');
  await fs.mkdir(cwd);
  await fs.mkdir(agentDir);
  const context: PromptTemplateContext = { cwd, agentDir, resources: [] };
  const created = await savePromptTemplate(context, input);
  context.resources.push(resource(created.path));
  assert.equal(created.path, path.join(cwd, '.pi', 'prompts', 'check-diff.md'));
  assert.equal((await readPromptTemplate(context, created.path)).argumentHint, '<模块名> [关注点]');
  await assert.rejects(savePromptTemplate(context, input), /同名模板/);
  const raw = await fs.readFile(created.path, 'utf8');
  await fs.writeFile(created.path, raw.replace('description:', 'custom-field: keep-me\ndescription:'));
  await assert.rejects(savePromptTemplate(context, { ...input, body: 'changed' }, created), /外部修改/);
  await assert.rejects(deletePromptTemplate(context, created.path, created.revision), /外部修改/);
  const fresh = await readPromptTemplate(context, created.path);
  const updated = await savePromptTemplate(context, { ...input, body: 'Changed $2' }, fresh);
  assert.match(await fs.readFile(created.path, 'utf8'), /custom-field: keep-me/);
  assert.equal(updated.body, 'Changed $2');
  await assert.rejects(savePromptTemplate(context, { ...input, name: 'new-name' }, updated), /不能更改/);
  await assert.rejects(readPromptTemplate(context, path.join(dir, 'outside.md')), /只能编辑/);
  await assert.rejects(savePromptTemplate({ ...context, cwd: undefined }, input), /独立对话/);
  const global = await savePromptTemplate({ ...context, cwd: undefined }, { ...input, scope: 'global' });
  assert.equal(global.path, path.join(agentDir, 'prompts', 'check-diff.md'));
  const pkg = {
    ...context.resources[0],
    metadata: { source: 'npm:templates', scope: 'project', origin: 'package' },
  };
  await assert.rejects(readPromptTemplate({ ...context, resources: [pkg] }, updated.path), /只读/);
  assert.equal(await promptEditable({ ...context, resources: [pkg] }, pkg), false);
  assert.equal(await promptEditable(context, context.resources[0]), true);
  await deletePromptTemplate(context, updated.path, updated.revision);
  await assert.rejects(fs.stat(updated.path), { code: 'ENOENT' });
});

test('template writes reject symlinked scopes, directory escape and hard-linked files', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-prompt-links-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, 'project'),
    agentDir = path.join(dir, 'agent'),
    outside = path.join(dir, 'outside');
  await fs.mkdir(cwd);
  await fs.mkdir(agentDir);
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(cwd, '.pi'), 'junction');
  const context: PromptTemplateContext = { cwd, agentDir, resources: [] };
  await assert.rejects(savePromptTemplate(context, input), /指向项目外/);
  await fs.symlink(outside, path.join(agentDir, 'prompts'), 'junction');
  await assert.rejects(savePromptTemplate(context, { ...input, scope: 'global' }), /链接/);
  const safeAgent = path.join(dir, 'safe-agent');
  const safe: PromptTemplateContext = { cwd, agentDir: safeAgent, resources: [] };
  const created = await savePromptTemplate(safe, { ...input, scope: 'global' });
  safe.resources.push(resource(created.path, 'user'));
  await fs.link(created.path, path.join(dir, 'hard-linked.md'));
  await assert.rejects(readPromptTemplate(safe, created.path), /链接文件/);
});
