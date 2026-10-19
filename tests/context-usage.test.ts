import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sessionStats } from '../electron/pi/protocol';
import { cacheReadPercent, contextUsageLabel, sessionUsageRows } from '../src/lib/context-usage';
import { ContextMeter, SessionUsageDetails } from '../src/components/conversation/Usage';

const stats = sessionStats({
  tokens: { total: 450000, input: 100000, output: 50000, cacheRead: 250000, cacheWrite: 50000 },
  cost: 0.12,
  contextUsage: { tokens: 44120, contextWindow: 200000, percent: 22.06 },
})!;
const details = (value = stats) =>
  renderToStaticMarkup(React.createElement(SessionUsageDetails, { stats: value }));
const meter = (value = stats) =>
  renderToStaticMarkup(React.createElement(ContextMeter, { stats: value, open() {} }));

test('session stats preserve documented cumulative token categories independently of current context', () => {
  assert.deepEqual(stats, {
    tokens: 450000,
    inputTokens: 100000,
    outputTokens: 50000,
    cacheReadTokens: 250000,
    cacheWriteTokens: 50000,
    cost: 0.12,
    contextTokens: 44120,
    contextWindow: 200000,
    contextPercent: 22.06,
  });
  for (const field of ['total', 'input', 'output', 'cacheRead', 'cacheWrite']) {
    for (const invalid of ['12', -1, Infinity, NaN])
      assert.throws(() => sessionStats({ tokens: { [field]: invalid } }), /不兼容/, `${field}: ${invalid}`);
  }
});

test('footer and shared popover/session details label cumulative usage and exact context separately', () => {
  const footer = meter();
  assert.match(footer, /上下文 22% \(44\.1k \/ 200k\)/);
  assert.match(footer, /累计 450,000 tokens/);
  assert.match(footer, /当前上下文（估算）44,120 \/ 200,000 tokens \(22\.1%\)/);
  assert.match(footer, /估算 \$0\.12/);
  const full = details();
  for (const value of [
    '44,120 / 200,000 tokens (22.1%)',
    '155,880 tokens',
    '450,000 tokens',
    '100,000 tokens',
    '50,000 tokens',
    '250,000 tokens',
    '62.5%',
    '$0.1200',
  ])
    assert.ok(full.includes(value), value);
  for (const label of [
    '当前上下文（估算）',
    '会话累计',
    '累计输入（不含缓存）',
    '累计输出',
    '累计缓存读取',
    '累计缓存写入',
  ])
    assert.ok(full.includes(label), label);
  assert.match(full, /自动压缩可能提前触发/);
  assert.match(full, /不是请求命中率/);
});

test('cache share is based on all normalized input categories, excludes output, and needs complete data', () => {
  assert.equal(cacheReadPercent(stats), 62.5);
  assert.equal(cacheReadPercent({ ...stats, outputTokens: 999999999 }), 62.5);
  assert.equal(cacheReadPercent({ inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }), 0);
  assert.equal(cacheReadPercent({ inputTokens: 0, cacheReadTokens: 10, cacheWriteTokens: 0 }), 100);
  assert.equal(cacheReadPercent({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), undefined);
  for (const field of ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens'])
    assert.equal(cacheReadPercent({ ...stats, [field]: undefined }), undefined);
});

test('zero usage remains distinct from unavailable or post-compaction context', () => {
  const zero = sessionStats({
    tokens: { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    contextUsage: { tokens: 0, percent: 0, contextWindow: 200000 },
  })!;
  assert.equal(contextUsageLabel(zero), '0 / 200,000 tokens (0.0%)');
  assert.match(meter(zero), /累计 0 tokens/);
  assert.match(meter(zero), /估算 \$0\.0000/);
  assert.equal(sessionUsageRows(zero).find((row) => row.label === '缓存读取占输入')?.value, '未知');
  const compacted = sessionStats({
    tokens: { total: 450000 },
    contextUsage: { tokens: null, percent: null, contextWindow: 200000 },
  })!;
  assert.equal(contextUsageLabel(compacted), '未知 / 200,000 tokens');
  assert.match(meter(compacted), /上下文 未知 \/ 200k/);
  assert.doesNotMatch(meter(compacted), /width:|0%/);
  assert.equal(sessionUsageRows(compacted).find((row) => row.label === '窗口剩余')?.value, '未知 tokens');
  assert.match(details(compacted), /累计输入（不含缓存） <strong>未知 tokens/);
  assert.match(details(compacted), /估算费用 <strong>未知/);
  assert.match(meter({}), /累计 未知 tokens/);
  assert.doesNotMatch(meter({}), /累计 0|\$0/);
});

test('over-capacity context keeps the real estimate but bounds the meter and remaining capacity', () => {
  const overflow = { ...stats, contextTokens: 210000, contextPercent: 105 };
  assert.equal(contextUsageLabel(overflow), '210,000 / 200,000 tokens (105.0%)');
  assert.match(meter(overflow), /width:100%/);
  assert.equal(sessionUsageRows(overflow).find((row) => row.label === '窗口剩余')?.value, '0 tokens');
});
