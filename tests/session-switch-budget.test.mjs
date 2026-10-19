import test from 'node:test';
import assert from 'node:assert/strict';
import { reportSessionSwitchBudget } from '../scripts/session-switch-budget.mjs';

const measurement = (maxMs) => ({
  durations: [...Array(9).fill(35.5), maxMs],
  selectionSettledMs: Array(10).fill(29.6),
  maxMs,
  budgetMs: 200,
});
const capture = () => {
  const messages = [],
    warnings = [];
  return { messages, warnings, log: (text) => messages.push(text), warn: (text) => warnings.push(text) };
};

test('session timing at or below 200 ms passes without a warning', () => {
  for (const maxMs of [46, 200]) {
    const output = capture();
    assert.equal(reportSessionSwitchBudget(measurement(maxMs), output), true);
    assert.equal(output.warnings.length, 0);
    assert.equal(output.messages.length, 1);
  }
});

test('over-budget timing stays visible as a warning and allows later functional checks', () => {
  const output = capture();
  const sample = measurement(296.7);
  const original = structuredClone(sample);
  assert.equal(reportSessionSwitchBudget(sample, output), false);
  assert.deepEqual(sample, original);
  assert.equal(output.messages.length, 0);
  assert.match(output.warnings[0], /^::warning title=Session-switch performance::/);
  assert.match(output.warnings[0], /exceeded 200 ms: 296.7 ms/);
  assert.match(output.warnings[0], /functional checks remain required/);
});

test('missing or invalid measurements still fail rather than becoming performance warnings', () => {
  for (const change of [
    { durations: [] },
    { selectionSettledMs: [] },
    { durations: [...Array(9).fill(40), NaN] },
    { selectionSettledMs: [...Array(9).fill(30), Infinity] },
    { durations: [...Array(9).fill(40), -1] },
    { maxMs: Infinity },
    { maxMs: 99 },
    { budgetMs: 300 },
  ]) {
    const output = capture();
    assert.throws(() => reportSessionSwitchBudget({ ...measurement(46), ...change }, output));
    assert.deepEqual(output.warnings, []);
  }
});
