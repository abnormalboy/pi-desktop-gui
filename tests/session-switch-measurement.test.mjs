import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  observeSessionSelections,
  sessionSelectionReady,
  sessionSelectionSnapshot,
} from '../scripts/session-switch-measurement.mjs';

const expected = (id = 'A', requireConnection = true) => ({
  id,
  projectId: `project-${id}`,
  cwd: `/project-${id}`,
  title: `Conversation ${id}`,
  draft: `Draft ${id}`,
  marker: `HISTORY_${id}`,
  markers: ['HISTORY_A', 'HISTORY_B'],
  modelId: `model-${id}`,
  requireConnection,
});

// Execute the exact serialized renderer functions, including real gate logic.
function harness({ now = 100 } = {}) {
  let clock = now;
  const frames = new Map(),
    timers = new Map(),
    clicks = new Set(),
    events = new Set(),
    microtasks = [];
  let handle = 0;
  const observers = [];
  const ui = {
    id: 'A',
    title: 'Conversation A',
    text: 'HISTORY_A',
    pending: false,
    pickerOpen: false,
    optionId: 'model-A',
    optionDisabled: false,
    input: { value: 'Draft A', disabled: false },
    send: { disabled: false, querySelector: () => (ui.pending ? {} : null) },
    model: { disabled: false },
  };
  const runtimes = new Map(
    ['A', 'B'].map((id) => [
      id,
      {
        sessionId: id,
        connected: true,
        status: 'idle',
        model: { id: `model-${id}`, provider: 'local', name: `Model ${id}` },
        cwd: `/project-${id}`,
        modelsLoaded: true,
        modelsLoading: false,
        models: [{ id: `model-${id}`, provider: 'local' }],
      },
    ]),
  );
  const window = {
    sessionUiState: { selectedSessionId: 'A', selectedProjectId: 'project-A' },
    sessionUiRevision: 1,
    sessionUiRuntimes: runtimes,
    desktop: {
      onEvent(callback) {
        events.add(callback);
        return () => events.delete(callback);
      },
    },
  };
  const document = {
    documentElement: {},
    querySelector(selector) {
      if (selector === '.workspace-title h1') return { textContent: ui.title };
      if (selector === '.thread') return { textContent: ui.text };
      if (selector === 'textarea[aria-label="任务输入"]') return ui.input;
      if (selector === 'button[aria-label="发送任务"]') return ui.send;
      if (selector === 'button[aria-label="选择模型"]') return ui.model;
      if (selector === '.model-picker [role="option"][aria-current="true"]')
        return ui.pickerOpen
          ? {
              disabled: ui.optionDisabled,
              querySelector: (name) => ({
                textContent: name === '.model-name small' ? ui.optionId : 'Model A',
              }),
            }
          : null;
      const match = /^\.session-row\[data-session-id="([^"]+)"\] > button$/.exec(selector);
      if (match) return { getAttribute: () => (ui.id === match[1] ? 'page' : null) };
      throw new Error(`Unexpected selector: ${selector}`);
    },
    addEventListener(type, callback) {
      assert.equal(type, 'click');
      clicks.add(callback);
    },
    removeEventListener(type, callback) {
      assert.equal(type, 'click');
      clicks.delete(callback);
    },
  };
  const context = {
    window,
    document,
    performance: { now: () => clock },
    queueMicrotask: (callback) => microtasks.push(callback),
    requestAnimationFrame(callback) {
      const id = ++handle;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout(callback) {
      const id = ++handle;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.active = false;
        observers.push(this);
      }
      observe() {
        this.active = true;
      }
      disconnect() {
        this.active = false;
      }
    },
  };
  window.sessionUiSnapshot = runInNewContext(`(${sessionSelectionSnapshot.toString()})`, context);
  const ready = runInNewContext(`(${sessionSelectionReady.toString()})`, context);
  const observe = runInNewContext(`(${observeSessionSelections.toString()})`, context);
  const h = {
    window,
    ui,
    runtimes,
    snapshot: (spec = expected()) => window.sessionUiSnapshot(spec),
    ready(spec = expected()) {
      const result = ready(spec);
      assert.equal(typeof result, 'boolean');
      return result;
    },
    arm(ids = ['A'], extra = {}) {
      observe({
        requests: ids.map((id, index) => ({
          requestId: `request-${index + 1}`,
          scenario: 'test',
          projectId: `project-${id}`,
          triggerSelector: `.session-row[data-session-id="${id}"] > button`,
          expected: expected(id),
        })),
        ...extra,
      });
      return window.switchMeasurement;
    },
    click(id) {
      const selector = `.session-row[data-session-id="${id}"] > button`;
      for (const callback of [...clicks])
        callback({ target: { closest: (candidate) => candidate === selector } });
    },
    flush() {
      while (microtasks.length) microtasks.shift()();
    },
    select(id, { revision = window.sessionUiRevision + 1, pending = false } = {}) {
      window.sessionUiState.selectedSessionId = id;
      window.sessionUiState.selectedProjectId = `project-${id}`;
      window.sessionUiRevision = revision;
      Object.assign(ui, {
        id,
        title: `Conversation ${id}`,
        text: `HISTORY_${id}`,
        pending,
        optionId: `model-${id}`,
      });
      ui.input.value = `Draft ${id}`;
    },
    mutation() {
      for (const observer of observers) if (observer.active) observer.callback();
    },
    frame(ms = 16) {
      clock += ms;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(clock);
    },
    timeout() {
      for (const callback of [...timers.values()]) callback();
    },
    assertClean() {
      assert.equal(frames.size, 0, 'all animation frames must be cancelled');
      assert.equal(timers.size, 0, 'all timeouts must be cleared');
      assert.equal(clicks.size, 0, 'click listener must be removed');
      assert.equal(events.size, 0, 'public event listener must be removed');
      assert.ok(
        observers.every((observer) => !observer.active),
        'DOM observer must be disconnected',
      );
    },
  };
  return h;
}

test('the runner uses the tested serializable observer and synchronous gate', () => {
  const source = readFileSync(new URL('../scripts/test-session-ui.mjs', import.meta.url), 'utf8');
  assert.match(source, /page\.evaluate\(observeSessionSelections, \{ requests, startMode \}\)/);
  assert.match(source, /page\.waitForFunction\(sessionSelectionReady, expectedSelection/);
  for (const scenario of [
    'firstColdOpen',
    'sameProjectHotReturn',
    'crossDirectoryHotReturn',
    'largeHistory',
    'rapidABA',
  ])
    assert.match(source, new RegExp(`${scenario}:`));
});

test('complete target history, ownership, draft and nonpending gates return a boolean', () => {
  const h = harness();
  assert.equal(h.ready(), true);
  assert.equal(h.snapshot().runtimeReady, true);
});

for (const [name, change] of [
  [
    'wrong public selected session',
    (h) => {
      h.window.sessionUiState.selectedSessionId = 'B';
    },
  ],
  [
    'wrong public project',
    (h) => {
      h.window.sessionUiState.selectedProjectId = 'project-B';
    },
  ],
  [
    'stale sidebar',
    (h) => {
      h.ui.id = 'B';
    },
  ],
  [
    'stale heading',
    (h) => {
      h.ui.title = 'Conversation B';
    },
  ],
  [
    'wrong target history',
    (h) => {
      h.ui.text = 'HISTORY_B';
    },
  ],
  [
    'mixed foreign history',
    (h) => {
      h.ui.text = 'HISTORY_A HISTORY_B';
    },
  ],
  [
    'missing history',
    (h) => {
      h.ui.text = '';
    },
  ],
  [
    'wrong runtime owner under target key',
    (h) => {
      h.runtimes.get('A').sessionId = 'B';
    },
  ],
  [
    'wrong runtime cwd',
    (h) => {
      h.runtimes.get('A').cwd = '/project-B';
    },
  ],
  [
    'disconnected target runtime',
    (h) => {
      h.runtimes.get('A').connected = false;
    },
  ],
  [
    'starting target runtime',
    (h) => {
      h.runtimes.get('A').status = 'starting';
    },
  ],
  [
    'wrong model',
    (h) => {
      h.runtimes.get('A').model.id = 'model-B';
    },
  ],
  [
    'missing model',
    (h) => {
      delete h.runtimes.get('A').model;
    },
  ],
  [
    'wrong draft',
    (h) => {
      h.ui.input.value = 'Draft B';
    },
  ],
  [
    'missing textbox',
    (h) => {
      h.ui.input = null;
    },
  ],
  [
    'disabled textbox',
    (h) => {
      h.ui.input.disabled = true;
    },
  ],
  [
    'pending selection even if send is enabled',
    (h) => {
      h.ui.pending = true;
    },
  ],
  [
    'disabled send',
    (h) => {
      h.ui.send.disabled = true;
    },
  ],
  [
    'disabled model gate',
    (h) => {
      h.ui.model.disabled = true;
    },
  ],
])
  test(`${name} never counts as completed selection`, () => {
    const h = harness();
    change(h);
    assert.equal(h.ready(), false);
  });

test('cold browsing can finish without starting Pi; explicit connection cannot', () => {
  const h = harness();
  h.runtimes.delete('A');
  assert.equal(h.ready(expected('A', false)), true);
  assert.equal(h.ready(expected('A', true)), false);
  assert.equal(h.snapshot(expected('A', false)).runtime, null);
});

test('model opening requires actual loaded target catalog and enabled current option without chat connection', () => {
  const h = harness();
  h.runtimes.get('A').connected = false;
  const spec = { ...expected('A', false), requireModels: true };
  assert.equal(h.ready(spec), false, 'a closed menu is not loaded-menu completion');
  h.ui.pickerOpen = true;
  assert.equal(h.ready(spec), true);
  for (const change of [
    () => {
      h.runtimes.get('A').modelsLoading = true;
    },
    () => {
      h.runtimes.get('A').modelsLoaded = false;
    },
    () => {
      h.runtimes.get('A').models = [];
    },
    () => {
      h.ui.optionId = 'model-B';
    },
    () => {
      h.ui.optionDisabled = true;
    },
  ]) {
    const fresh = harness();
    fresh.runtimes.get('A').connected = false;
    fresh.ui.pickerOpen = true;
    // Keep each failure independent by restoring the complete fixture afterward.
    const runtime = h.runtimes.get('A');
    Object.assign(runtime, fresh.runtimes.get('A'));
    Object.assign(h.ui, { pickerOpen: true, optionId: 'model-A', optionDisabled: false });
    change();
    assert.equal(h.ready(spec), false);
  }
});

test('collector needs a post-click revision and current complete gates, then cleans up', async () => {
  const h = harness();
  const promise = h.arm();
  let resolved = false;
  void promise.then(() => {
    resolved = true;
  });
  h.click('A');
  h.flush();
  h.frame();
  h.frame();
  await Promise.resolve();
  assert.equal(resolved, false, 'original A must not satisfy the new A request');
  h.select('A', { pending: true });
  h.mutation();
  h.frame();
  await Promise.resolve();
  assert.equal(resolved, false, 'a pending request must not finish');
  h.ui.pending = false;
  h.mutation();
  const [sample] = await promise;
  assert.equal(sample.outcome, 'completed');
  assert.equal(sample.settlement.complete, true);
  assert.equal(sample.runtimeAvailabilityAtStart, 'already-ready');
  assert.equal(sample.runtimeReadyMs, 0, 'zero describes already-ready, not startup duration');
  assert.ok(sample.settlement.revision > sample.baselineRevision);
  h.assertClean();
});

test('rapid A→B→A keeps request IDs and supersedes earlier clicks, even on the same final ID', async () => {
  const h = harness();
  h.select('B');
  const promise = h.arm(['A', 'B', 'A']);
  h.click('A');
  h.click('B');
  h.click('A');
  h.flush();
  h.select('B', { pending: true });
  h.mutation();
  h.frame();
  h.select('A', { pending: true });
  h.mutation();
  h.frame();
  h.ui.pending = false;
  h.mutation();
  const samples = await promise;
  assert.deepEqual(
    Array.from(samples, (sample) => sample.requestId),
    ['request-1', 'request-2', 'request-3'],
  );
  assert.deepEqual(
    Array.from(samples, (sample) => sample.outcome),
    ['superseded', 'superseded', 'completed'],
  );
  assert.equal(samples[0].selectionSettledMs, null);
  assert.equal(samples[1].selectionSettledMs, null);
  assert.equal(samples[2].settlement.selectedSessionId, 'A');
  assert.equal(samples[2].settlement.runtime.modelId, 'model-A');
  h.assertClean();
});

test('a later foreign frame cannot resolve an earlier correct-history observation', async () => {
  const h = harness();
  h.select('B');
  const promise = h.arm();
  let resolved = false;
  void promise.then(() => {
    resolved = true;
  });
  h.click('A');
  h.flush();
  h.select('A');
  h.mutation();
  h.ui.text = 'HISTORY_B';
  h.mutation();
  h.frame();
  await Promise.resolve();
  assert.equal(resolved, false);
  h.ui.text = 'HISTORY_A';
  h.mutation();
  const [sample] = await promise;
  assert.equal(sample.otherHistoryVisible, true, 'runner must fail even if foreign history later disappears');
  h.assertClean();
});

test('unsafe post-click send gate is retained for the runner to reject', async () => {
  const h = harness();
  h.select('B');
  const promise = h.arm();
  h.click('A');
  h.flush();
  h.frame();
  h.select('A');
  h.mutation();
  h.frame();
  const [sample] = await promise;
  assert.equal(sample.unsafeSendGateObserved, true);
  h.assertClean();
});

test('initial cold-open uses navigation origin and records late observer installation as an upper bound', async () => {
  const h = harness({ now: 120 });
  h.runtimes.delete('A');
  const promise = h.arm(['A'], {
    startMode: 'navigation',
    requests: [{ requestId: 'initial', scenario: 'first-cold-open', expected: expected('A', false) }],
  });
  h.frame();
  const [sample] = await promise;
  assert.equal(sample.startAtMs, 0);
  assert.equal(sample.observerInstalledAtMs, 120);
  assert.equal(sample.messageDomMs, 120);
  assert.equal(sample.nextAnimationFrameMs, 136);
  assert.equal(sample.targetHistoryAlreadyPresentAtStart, true);
  assert.equal(sample.runtimeReadyMs, null);
  h.assertClean();
});

test('initial observer resync does not misclassify unknown public state as an unsafe UI gate', async () => {
  const h = harness();
  h.runtimes.delete('A');
  delete h.window.sessionUiState;
  const promise = h.arm(['A'], {
    startMode: 'navigation',
    requests: [{ requestId: 'initial', scenario: 'first-cold-open', expected: expected('A', false) }],
  });
  h.frame();
  h.window.sessionUiState = { selectedSessionId: 'A', selectedProjectId: 'project-A' };
  h.mutation();
  const [sample] = await promise;
  assert.equal(sample.unsafeSendGateObserved, false);
  h.assertClean();
});

test('explicit connect has its own renderer IPC start and must await that action fulfillment', async () => {
  const h = harness();
  h.runtimes.get('A').connected = false;
  h.window.sessionUiActionCompletions = new Map();
  const promise = h.arm(['A'], {
    startMode: 'explicit-ipc',
    requests: [{ requestId: 'connect-A', scenario: 'test', phase: 'explicit-connect', expected: expected() }],
  });
  let resolved = false;
  void promise.then(() => {
    resolved = true;
  });
  h.runtimes.get('A').connected = true;
  h.mutation();
  h.frame();
  await Promise.resolve();
  assert.equal(resolved, false, 'runtime readiness alone does not fulfill the invoke');
  h.window.sessionUiActionCompletions.set('connect-A', 121);
  h.frame();
  const [sample] = await promise;
  assert.equal(sample.startAtMs, 100);
  assert.equal(sample.actionCompletedMs, 21);
  assert.equal(sample.startMode, 'explicit-ipc');
  assert.equal(sample.runtimeAvailabilityAtStart, 'not-ready');
  h.assertClean();
});

test('timeout and cancellation remove every observer, listener, timer and frame', async () => {
  for (const cancel of [false, true]) {
    const h = harness();
    const promise = h.arm();
    if (cancel) h.window.cancelSessionSwitchMeasurement();
    else h.timeout();
    await assert.rejects(promise, cancel ? /cancelled/ : /timed out/);
    h.assertClean();
  }
});
