import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionSwitchTrace,
  selectSessionWithTrace,
  type RendererSwitchPoint,
} from '../shared/session-switch-trace';
import type { DesktopApi } from '../shared/types';

const id = '11111111-2222-4333-8444-555555555555';
test('switch trace metadata accepts only a bounded identifier and creates independent main points', () => {
  assert.equal(createSessionSwitchTrace(undefined, 'target', 10), undefined);
  for (const value of ['', 'x'.repeat(1000), {}, [], 1, null, { switchId: id, points: {} }])
    assert.throws(() => createSessionSwitchTrace(value, 'target', 10), /无效/);
  const a = createSessionSwitchTrace(id, 'target', 10)!;
  const b = createSessionSwitchTrace(id, 'target', 20)!;
  a.points.connectEnqueued = 11;
  assert.deepEqual(b.points, { ipcReceived: 20 });
});

test('ordinary selection retains the original call and promise without diagnostic metadata', async () => {
  const calls: unknown[][] = [],
    original = Promise.resolve([]);
  const api = {
    invoke: (...args: unknown[]) => {
      calls.push(args);
      return original;
    },
  } as DesktopApi;
  assert.equal(selectSessionWithTrace(api, 'a'), original);
  assert.deepEqual(calls, [['selectSession', 'a']]);
  await original;
});

test('concurrent traced selections keep unique IDs and report their own fulfilled/rejected completion', async () => {
  const points: RendererSwitchPoint[] = [],
    calls: unknown[][] = [];
  let resolveA!: (value: never[]) => void, rejectB!: (error: Error) => void;
  const pending = [
    new Promise<never[]>((resolve) => {
      resolveA = resolve;
    }),
    new Promise<never[]>((_, reject) => {
      rejectB = reject;
    }),
  ];
  const api = {
    invoke: (...args: unknown[]) => {
      calls.push(args);
      return pending[calls.length - 1];
    },
  } as DesktopApi;
  const a = selectSessionWithTrace(api, 'a', (point) => points.push(point));
  const b = selectSessionWithTrace(api, 'b', (point) => points.push(point));
  assert.equal(points.length, 2);
  assert.notEqual(points[0].switchId, points[1].switchId);
  assert.equal(calls[0][2], points[0].switchId);
  assert.equal(calls[1][2], points[1].switchId);
  const failure = new Error('cancelled');
  rejectB(failure);
  await assert.rejects(b, (actual) => actual === failure);
  resolveA([]);
  assert.deepEqual(await a, []);
  assert.deepEqual(
    points.map(({ sessionId, phase, outcome }) => [sessionId, phase, outcome]),
    [
      ['a', 'invoke', undefined],
      ['b', 'invoke', undefined],
      ['b', 'invokeSettled', 'rejected'],
      ['a', 'invokeSettled', 'fulfilled'],
    ],
  );
  assert.equal(points[2].switchId, points[1].switchId);
  assert.equal(points[3].switchId, points[0].switchId);
});
