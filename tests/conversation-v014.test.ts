import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parseAnsi, stripAnsi } from '../shared/ansi';
import { composeDraftText, moveSnippetOffsets, shouldCollapsePaste, textBytes } from '../shared/draft';
import { groupConversation, conversationTurns } from '../src/lib/conversation-layout';
import { searchSession, limitForMessage } from '../src/lib/session-search';
import { parseArgumentHint, parsePromptArguments, formatPromptArguments } from '../src/lib/prompt-arguments';
import { tokenizeCode } from '../src/lib/code-tokens';
import { splitUserContent } from '../src/lib/message-content';
import type { Message, ToolActivity } from '../shared/types';
import { parseCommandArgs } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/prompt-templates.js';

test('ANSI removes terminal commands, handles progress overwrite and retains only safe style tokens', () => {
  assert.deepEqual(parseAnsi('\x1b[1;32mPASS\x1b[0m'), [{ text: 'PASS', color: 'green', bold: true }]);
  assert.equal(
    stripAnsi('progress 10%\r\x1b[2Kprogress 100%\n\x1b]0;unsafe title\x07done\x1b[1G'),
    'progress 100%\ndone',
  );
  assert.equal(stripAnsi('abc\rZ'), 'Zbc');
  assert.equal(stripAnsi('\x1b]8;;https://example.test\x1b\\text\x1b]8;;\x1b\\'), 'text');
  assert.equal(stripAnsi('\x1b[38;2;255;0;0mtext\x1b[0m'), 'text');
  assert.equal(stripAnsi('<script>alert(1)</script>'), '<script>alert(1)</script>');
  assert.equal(stripAnsi('ok\x1b['), 'ok');
});

test('collapsed pastes preserve insertion order and offsets across normal text editing', () => {
  const snippets = [
    { id: 'a', text: 'FIRST\n', offset: 2 },
    { id: 'b', text: 'SECOND\n', offset: 2 },
    { id: 'c', text: 'END', offset: 4 },
  ];
  assert.equal(composeDraftText('ABCD', snippets), 'ABFIRST\nSECOND\nCDEND');
  const changed = moveSnippetOffsets('ABCD', 'XXABCD', snippets);
  assert.deepEqual(
    changed.map((item) => item.offset),
    [4, 4, 6],
  );
  assert.equal(composeDraftText('XXABCD', changed), 'XXABFIRST\nSECOND\nCDEND');
  assert.equal(
    composeDraftText('ABtailCD', moveSnippetOffsets('ABCD', 'ABtailCD', snippets)),
    'ABFIRST\nSECOND\ntailCDEND',
  );
  assert.equal(shouldCollapsePaste(Array.from({ length: 60 }, (_, i) => String(i)).join('\n'), ''), true);
  assert.equal(shouldCollapsePaste('x'.repeat(5000), '/review '), false);
  assert.equal(textBytes('中'), 3);
  assert.equal(
    textBytes(composeDraftText('', [{ id: 'large', offset: 0, text: 'x'.repeat(1024 * 1024 + 1) }])),
    1024 * 1024 + 1,
  );
});

test('prompt parameter serialization round-trips the actual Pi 1.1 parser', () => {
  const values = ['src/a.ts', 'two words', 'a"b\'c', 'C:\\folder\\file', '你好\n继续'];
  const serialized = formatPromptArguments(values);
  assert.deepEqual(parsePromptArguments(serialized), values);
  assert.deepEqual(parseCommandArgs(serialized), values);
  assert.deepEqual(parseArgumentHint('<目标文件> [关注点]'), [
    { label: '目标文件', required: true },
    { label: '关注点', required: false },
  ]);
  assert.throws(() => formatPromptArguments(['', 'second']), /按顺序/);
});

test('search covers early pages, thinking, reference ranges and tool arguments/output', () => {
  const messages: Message[] = Array.from({ length: 200 }, (_, index) => ({
    role: 'user',
    content: `message ${index}`,
  }));
  messages[9].content = 'needle early';
  messages[10] = { role: 'assistant', content: [{ type: 'thinking', thinking: 'hidden needle' }] };
  messages[11].content =
    'question\n\n<project_file path="src/file.ts" lines="10-40">\nneedle file\n</project_file>';
  messages[12] = {
    role: 'assistant',
    content: [{ type: 'toolCall', id: 't', name: 'read', arguments: { path: 'needle.ts' } }],
  };
  messages[13] = {
    role: 'toolResult',
    toolCallId: 't',
    toolName: 'read',
    content: '\x1b[31mneedle failure\x1b[0m',
  };
  const matches = searchSession(messages, [], 'NEEDLE');
  assert.equal(matches.length, 5);
  assert.deepEqual(
    matches.map((match) => match.section),
    ['text', 'thinking', 'attachment', 'tool', 'tool'],
  );
  assert.equal(matches[0].messageIndex, 9);
  assert.equal(limitForMessage(200, 9, 80), 240);
  assert.equal(splitUserContent(String(messages[11].content)).files[0].lines, '10-40');
  assert.equal(searchSession(messages, [], '').length, 0);
});

const tool = (id: string, name = 'read', status: ToolActivity['status'] = 'done'): ToolActivity => ({
  id,
  name,
  status,
  args: { path: id + '.ts' },
  output: 'done',
  startedAt: 0,
});
test('only consecutive completed read-only tools group; writes, commands, failures and expanded tools stay visible', () => {
  const tools = [
    tool('1'),
    tool('2', 'grep'),
    tool('3'),
    tool('4', 'write'),
    tool('5'),
    tool('6', 'bash'),
    tool('7', 'read', 'error'),
    tool('8', 'read', 'running'),
  ];
  const messages: Message[] = tools.flatMap((item) => [
    { role: 'assistant', content: [{ type: 'toolCall', id: item.id, name: item.name }] },
    { role: 'toolResult', content: item.output, toolCallId: item.id },
  ]);
  const lookup = (message: Message) => tools.find((item) => item.id === message.toolCallId)!;
  const grouped = groupConversation(messages, lookup, []);
  assert.equal(grouped[0].kind, 'group');
  assert.equal(grouped.filter((item) => item.kind === 'group').length, 1);
  assert.equal(grouped.length, 6);
  assert.equal(groupConversation(messages, lookup, ['2']).filter((item) => item.kind === 'group').length, 0);
  const turns = conversationTurns(
    [{ role: 'user', content: 'first' }, ...messages, { role: 'user', content: 'second' }],
    lookup,
  );
  assert.equal(turns[0].modified, true);
  assert.equal(turns[0].failed, true);
  assert.equal(turns[1].index, messages.length + 1);
});

test('code tokenizer preserves exact text while adding lightweight semantic classes', () => {
  for (const language of [
    'typescript',
    'json',
    'bash',
    'powershell',
    'python',
    'rust',
    'go',
    'html',
    'css',
    'diff',
    'markdown',
  ]) {
    const source = 'const name = "hello"; // note\nreturn 42;';
    assert.equal(
      tokenizeCode(source, language)
        .map((token) => token.text)
        .join(''),
      source,
    );
  }
  assert.equal(tokenizeCode('const x = 1;', 'ts')[0].kind, 'keyword');
});

test('500-message search stays below the 16 ms budget', () => {
  const messages: Message[] = Array.from({ length: 500 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `module ${index}\n${'read source and explain behavior '.repeat(30)}\nneedle ${index}`,
  }));
  const durations: number[] = [];
  for (let i = 0; i < 70; i++) {
    const start = performance.now();
    assert.equal(searchSession(messages, [], 'needle').length, 500);
    if (i >= 10) durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  const p95 = durations[Math.floor(durations.length * 0.95)];
  console.log(`500-message search median=${durations[30].toFixed(2)} ms p95=${p95.toFixed(2)} ms`);
  assert.ok(p95 < 16, `search p95 ${p95.toFixed(2)}ms exceeds 16ms`);
});
