import test from 'node:test';
import assert from 'node:assert/strict';
import { installRetryDisplayFixture } from './support/retry-display-fixture.mjs';
import { applyRuntimePatch, emptyRuntime } from '../shared/types.ts';
import { groupConversation, hideRecoveredErrors } from '../src/lib/conversation-layout.ts';

const failure = (errorMessage, timestamp) => ({
  role: 'assistant',
  content: [],
  stopReason: 'error',
  errorMessage,
  timestamp,
});
const repeated = [
  { role: 'user', content: 'Repeated failures' },
  failure('Connection error.', 1),
  failure('Connection error.', 2),
  failure('Connection error.', 3),
];
const mixed = [
  { role: 'user', content: 'Mixed failures' },
  failure('Request timed out.', 10),
  failure('Connection error.', 11),
  failure('Latest failure.', 12),
];
const appended = [...mixed, failure('Newest failure.', 13)];

test('renderer fixture owns every injected scenario despite late real Pi events and reload', async (t) => {
  const previousFixture = globalThis.retryDisplayFixture;
  t.after(() => {
    globalThis.retryDisplayFixture = previousFixture;
  });
  const sessionId = 'retry-fixture';
  const live = {
    ...emptyRuntime(),
    sessionId,
    connected: true,
    status: 'completed',
    messages: [{ role: 'assistant', content: 'NORMAL_AFTER_FAILURE' }],
  };
  const livePatch = {
    ...live,
    messagesFrom: 0,
    messageCount: live.messages.length,
    toolsFrom: 0,
    toolCount: 0,
  };
  let renderer = live;
  const forwarded = [],
    calls = [];
  const webContents = {
    send(channel, event) {
      forwarded.push({ channel, event });
      if (channel !== 'desktop:event') return;
      if (event.type === 'runtime' && event.runtime.sessionId === sessionId) renderer = event.runtime;
      if (event.type === 'runtimePatch' && event.patch.sessionId === sessionId)
        renderer = applyRuntimePatch(renderer, event.patch);
      if (event.type === 'runtimeRemoved' && event.sessionId === sessionId) renderer = undefined;
    },
  };
  const ipcMain = {
    _invokeHandlers: new Map([
      [
        'desktop:invoke',
        async (_event, method, args) => {
          calls.push({ method, args });
          return method === 'bootstrap'
            ? { state: { selectedSessionId: sessionId }, runtime: live, storage: { writable: true } }
            : 'live result';
        },
      ],
    ]),
    removeHandler(name) {
      this._invokeHandlers.delete(name);
    },
    handle(name, handler) {
      this._invokeHandlers.set(name, handler);
    },
  };
  const installInMain = new Function(`return (${installRetryDisplayFixture.toString()})`)();
  installInMain({ ipcMain, BrowserWindow: { getAllWindows: () => [{ webContents }] } }, sessionId);
  const fixture = globalThis.retryDisplayFixture;
  const invoke = (method, ...args) => ipcMain._invokeHandlers.get('desktop:invoke')({}, method, args);

  // The real provider phase is untouched until a synthetic snapshot is explicitly published.
  webContents.send('desktop:event', {
    type: 'runtime',
    runtime: { ...live, status: 'retrying', messages: repeated },
  });
  assert.equal(renderer.status, 'retrying');
  webContents.send('desktop:event', { type: 'runtimePatch', patch: livePatch });
  assert.equal(
    renderer.status,
    'completed',
    'without fixture ownership the late production patch reproduces CI overwrite',
  );
  assert.deepEqual(renderer.messages, live.messages);
  assert.equal(fixture.ignoredEvents, 0);
  const scenarios = [
    {
      messages: repeated,
      status: 'retrying',
      retry: { attempt: 2, maxAttempts: 3, startedAt: 1, delayMs: 20, phase: 'requesting' },
      groups: 1,
    },
    { messages: repeated, status: 'error', groups: 1 },
    { messages: mixed, status: 'error', groups: 1 },
    { messages: appended, status: 'error', groups: 1 },
    {
      messages: [...appended, { role: 'user', content: 'New turn' }, failure('New turn failure.', 14)],
      status: 'error',
      groups: 1,
    },
    {
      messages: [...appended, { role: 'assistant', content: [], stopReason: 'aborted' }],
      status: 'stopped',
      groups: 1,
    },
    {
      messages: [...appended, { role: 'assistant', content: 'Recovered reply', stopReason: 'stop' }],
      status: 'completed',
      groups: 0,
    },
    {
      messages: [
        { role: 'user', content: 'Long failure sequence' },
        ...Array.from({ length: 90 }, (_, i) => failure(`Failure ${i}`, 100 + i)),
      ],
      status: 'error',
      groups: 1,
    },
  ];
  for (const { groups, ...scenario } of scenarios) {
    const runtime = { ...emptyRuntime(), sessionId, connected: true, ...scenario };
    fixture.publish(runtime);
    const events = [
      { type: 'runtimePatch', patch: livePatch },
      { type: 'runtime', runtime: live },
      { type: 'runtimeRemoved', sessionId },
    ];
    for (const event of events) {
      webContents.send('desktop:event', event);
      assert.equal(renderer, runtime, `late ${event.type} must not overwrite ${scenario.status} fixture`);
    }
    assert.equal(
      groupConversation(
        hideRecoveredErrors(renderer.messages),
        () => assert.fail('No tools in fixture'),
        [],
      ).filter((item) => item.kind === 'errors').length,
      groups,
    );
    const bootstrap = await invoke('bootstrap');
    assert.equal(bootstrap.runtime, runtime);
    assert.equal(bootstrap.state.selectedSessionId, sessionId);
    assert.equal(bootstrap.storage.writable, true);
    assert.equal(await invoke('readHistory', sessionId), runtime.messages);
  }
  assert.equal(fixture.ignoredEvents, scenarios.length * 3);
  await invoke('messageAction', sessionId, 'regenerate', 'assistant', 3);
  assert.deepEqual(fixture.actions, [[sessionId, 'regenerate', 'assistant', 3]]);
  assert.equal(
    calls.some((call) => call.method === 'messageAction'),
    false,
  );

  const other = { ...live, sessionId: 'other' };
  const unrelated = [
    ['desktop:event', { type: 'runtime', runtime: other }],
    [
      'desktop:event',
      { type: 'runtimePatch', patch: { ...livePatch, sessionId: other.sessionId, status: 'running' } },
    ],
    ['desktop:event', { type: 'runtimeRemoved', sessionId: other.sessionId }],
    ['desktop:event', { type: 'state', state: { selectedSessionId: sessionId } }],
    ['desktop:event', { type: 'storage', storage: { writable: true } }],
    ['other-channel', { type: 'runtime', runtime: live }],
  ];
  const count = forwarded.length;
  for (const [channel, event] of unrelated) webContents.send(channel, event);
  assert.equal(forwarded.length, count + unrelated.length);
  assert.equal(await invoke('readHistory', other.sessionId), 'live result');
  assert.equal(await invoke('messageAction', other.sessionId, 'regenerate', 'assistant', 4), 'live result');
  assert.equal(await invoke('saveView', sessionId, 0, []), 'live result');
  assert.throws(() => fixture.publish(other), /Unexpected fixture session/);
});
