import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateUsage, isOlderSession } from '../shared/usage';

test('usage aggregates whole sessions by local calendar windows and project without hiding missing data', () => {
  const now = new Date(2026, 9, 15, 12).getTime();
  const sessions = [
    { projectId: 'a', updatedAt: new Date(2026, 9, 15, 0).getTime(), stats: { tokens: 100, cost: 1 } },
    { projectId: 'b', updatedAt: new Date(2026, 9, 14, 23, 59).getTime(), stats: { tokens: 200, cost: 2 } },
    { projectId: 'a', updatedAt: new Date(2026, 9, 9, 0).getTime(), stats: { tokens: 300, cost: 3 } },
    { updatedAt: new Date(2026, 9, 8, 23, 59).getTime(), stats: { tokens: 400, cost: 4 } },
    { projectId: 'a', updatedAt: now },
    { projectId: 'b', updatedAt: now, stats: { tokens: 0, cost: 0 } },
    { projectId: 'b', updatedAt: now, stats: { tokens: Infinity, cost: -1 } },
  ];
  const result = aggregateUsage(
    sessions,
    [
      { id: 'a', name: '项目 A' },
      { id: 'b', name: '项目 B' },
    ],
    now,
  );
  assert.equal(result.today.tokens, 100);
  assert.equal(result.today.cost, 1);
  assert.equal(result.today.sessions, 4);
  assert.equal(result.today.missingTokens, 2);
  assert.equal(result.today.missingCost, 2);
  assert.equal(result.week.tokens, 600);
  assert.equal(result.week.cost, 6);
  assert.equal(result.all.tokens, 1000);
  assert.equal(result.all.cost, 10);
  assert.equal(result.all.projects.find((group) => group.projectId === 'a')?.costShare, 0.4);
  assert.equal(result.all.projects.find((group) => !group.projectId)?.name, '独立对话');
  assert.deepEqual(aggregateUsage([], [], now).all.projects, []);
});

test('older session folding never hides pinned sessions or sessions exactly seven days old', () => {
  const now = 2_000_000_000_000;
  const boundary = now - 7 * 24 * 60 * 60 * 1000;
  assert.equal(isOlderSession({ updatedAt: boundary }, now), false);
  assert.equal(isOlderSession({ updatedAt: boundary - 1 }, now), true);
  assert.equal(isOlderSession({ updatedAt: boundary - 1, pinned: true }, now), false);
});
