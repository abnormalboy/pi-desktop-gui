import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { modelSwitchReady } from '../scripts/model-switch-readiness.mjs';

// Test the exact serializable predicate used by Playwright, with observable state/DOM only.
const source = readFileSync(new URL('../scripts/test-model-switch-ui.mjs', import.meta.url), 'utf8');
const startupPrefix = source.slice(
  source.indexOf('await observeModelSwitchState();'),
  source.indexOf("'setSessionThinking'"),
);
const startupCall = startupPrefix.match(/await page\.waitForFunction\(modelSwitchReady, (\{[\s\S]*?\})\);/);
assert.ok(startupCall, 'the startup gate must be awaited before the first thinking IPC');
const startup = runInNewContext(`(${startupCall[1]})`, {
  f: { sessionId: 'A', store: { session: () => ({ title: 'Conversation A' }) } },
});

function harness() {
  const runtime = {
    sessionId: 'A',
    status: 'idle',
    connected: true,
    model: { id: 'local-e2e' },
    thinking: 'low',
    thinkingLevels: ['off', 'low', 'high'],
  };
  const state = {
    selectedSessionId: 'A',
    settings: { modelId: 'local-e2e' },
    sessions: [{ id: 'A', model: { id: 'local-e2e' } }],
  };
  const ui = {
    title: 'Conversation A',
    selectedId: 'A',
    pending: false,
    input: { value: '', disabled: false },
    send: { disabled: true, querySelector: () => (ui.pending ? {} : null) },
    selector: { value: 'local-e2e::local-e2e', disabled: false },
  };
  const window = { modelSwitchState: state, modelSwitchRuntimes: new Map([['A', runtime]]) };
  const document = {
    querySelector(selector) {
      if (selector === '.workspace-title h1') return { textContent: ui.title };
      if (selector === 'textarea[aria-label="任务输入"]') return ui.input;
      if (selector === '.send-button') return ui.send;
      if (selector === 'select[aria-label="选择模型"]') return ui.selector;
      const match = /^\.session-row\[data-session-id="([^"]+)"\] > button$/.exec(selector);
      if (match) return { getAttribute: () => (ui.selectedId === match[1] ? 'page' : null) };
      throw new Error(`Unexpected selector: ${selector}`);
    },
  };
  const predicate = runInNewContext(`(${modelSwitchReady.toString()})`, { window, document });
  return {
    runtime,
    state,
    ui,
    window,
    ready(expected = startup) {
      const result = predicate(expected);
      assert.equal(typeof result, 'boolean', 'a Promise would falsely satisfy Playwright 1.64 polling');
      return result;
    },
  };
}

for (const [name, arrange] of [
  [
    'visible textbox while Pi is starting',
    ({ runtime }) => {
      runtime.status = 'starting';
    },
  ],
  [
    'disconnected runtime',
    ({ runtime }) => {
      runtime.connected = false;
    },
  ],
  [
    'model not loaded',
    ({ runtime }) => {
      delete runtime.model;
    },
  ],
  [
    'wrong model',
    ({ runtime }) => {
      runtime.model.id = 'local-next';
    },
  ],
  [
    'thinking levels not loaded',
    ({ runtime }) => {
      delete runtime.thinkingLevels;
    },
  ],
  [
    'empty thinking levels',
    ({ runtime }) => {
      runtime.thinkingLevels = [];
    },
  ],
  [
    'low thinking unsupported',
    ({ runtime }) => {
      runtime.thinkingLevels = ['off'];
    },
  ],
  [
    'pending startup action',
    ({ ui }) => {
      ui.pending = true;
    },
  ],
  [
    'wrong selected session',
    ({ state }) => {
      state.selectedSessionId = 'B';
    },
  ],
  [
    'runtime belongs to another session',
    ({ runtime }) => {
      runtime.sessionId = 'B';
    },
  ],
  [
    'old renderer title',
    ({ ui }) => {
      ui.title = 'Conversation B';
    },
  ],
  [
    'old sidebar selection',
    ({ ui }) => {
      ui.selectedId = 'B';
    },
  ],
  [
    'disabled textbox',
    ({ ui }) => {
      ui.input.disabled = true;
    },
  ],
  [
    'missing composer',
    ({ ui }) => {
      ui.input = null;
    },
  ],
  [
    'missing send button',
    ({ ui }) => {
      ui.send = null;
    },
  ],
  [
    'missing runtime subscription',
    ({ window }) => {
      delete window.modelSwitchRuntimes;
    },
  ],
]) {
  test(`startup readiness rejects ${name}`, () => {
    const h = harness();
    arrange(h);
    assert.equal(h.ready(), false);
  });
}

test('startup gate becomes true only after the real connection/model/capability handshake', () => {
  const h = harness();
  h.runtime.status = 'starting';
  h.runtime.connected = false;
  delete h.runtime.model;
  h.runtime.thinkingLevels = [];
  h.ui.pending = true;
  assert.equal(h.ready(), false);
  h.runtime.status = 'idle';
  h.runtime.connected = true;
  h.runtime.model = { id: 'local-e2e' };
  assert.equal(h.ready(), false, 'model and connection alone do not imply low support');
  h.runtime.thinkingLevels = ['off', 'low', 'high'];
  assert.equal(h.ready(), false, 'renderer startup action must settle too');
  h.ui.pending = false;
  assert.equal(h.ready(), true, 'an empty draft may keep Send disabled without blocking model setup');
});

test('next-task thinking capability takes precedence, including an empty unsupported list', () => {
  const h = harness();
  h.runtime.nextTask = { model: { id: 'local-next' }, thinkingLevels: [] };
  assert.equal(h.ready(), false);
  h.runtime.nextTask.thinkingLevels = ['high'];
  assert.equal(h.ready(), false);
  h.runtime.nextTask.thinkingLevels = ['low', 'high'];
  assert.equal(h.ready(), true);
  h.runtime.nextTask.thinking = 'high';
  const expected = { id: 'A', nextModelId: 'local-next', thinking: 'low', nextThinking: 'high' };
  assert.equal(h.ready(expected), true);
  h.runtime.thinking = 'high';
  assert.equal(h.ready(expected), false, 'deferred choice cannot replace current-task thinking');
});

test('enabled settings selector cannot stand in for acknowledged runtime and saved selection', () => {
  const h = harness();
  h.runtime.status = 'running';
  h.runtime.nextTask = { model: { id: 'local-next' }, thinking: 'high' };
  const expected = {
    id: 'A',
    status: 'running',
    modelId: 'local-e2e',
    nextModelId: 'local-next',
    nextThinking: 'high',
    savedModelId: 'local-next',
    selectorValue: 'local-e2e::local-next',
    readyToType: true,
  };
  assert.equal(h.ready(expected), false);
  h.ui.selector.value = 'local-e2e::local-next';
  assert.equal(h.ready(expected), false, 'DOM selection can precede its saved state');
  h.state.settings.modelId = 'local-next';
  assert.equal(h.ready(expected), false, 'global setting does not prove the session selection');
  h.state.sessions[0].model.id = 'local-next';
  assert.equal(h.ready(expected), true);
  h.ui.pending = true;
  assert.equal(h.ready(expected), false);
  h.ui.pending = false;
  h.runtime.nextTask.model.id = 'local-e2e';
  assert.equal(h.ready(expected), false);
});

test('wrong-target or lost draft and disabled Send remain failures', () => {
  const h = harness();
  const expected = { id: 'A', title: 'Conversation A', draft: 'B_AFTER_STOP', canSend: true };
  assert.equal(h.ready(expected), false);
  h.ui.input.value = 'B_AFTER_STOP';
  assert.equal(h.ready(expected), false, 'normal disabled button is never bypassed');
  h.ui.send.disabled = false;
  assert.equal(h.ready(expected), true);
  h.state.selectedSessionId = 'B';
  assert.equal(h.ready(expected), false);
});
