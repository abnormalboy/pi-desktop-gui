import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyRuntime, type Environment, type Model, type Runtime, type Session } from '../shared/types';
import { sessionModelState } from '../src/lib/session-model';
import type { ComposerProps } from '../src/components/Composer';

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { desktop: { platform: 'darwin' } },
});
const { ReadinessChecklist } = await import('../src/components/ReadinessChecklist');
const { ModelPicker } = await import('../src/components/ModelPicker');
const { ComposerFooter } = await import('../src/components/conversation/ComposerStatus');
const session: Session = {
  id: 'new-chat',
  title: '新对话',
  draft: '',
  attachments: [],
  updatedAt: 1,
  lastStatus: 'idle',
};
const first: Model = { provider: 'first', id: 'same-id', name: '模型 A' };
const previous: Model = { provider: 'second', id: 'same-id', name: '上一会话模型' };
const runtime: Runtime = {
  ...emptyRuntime(),
  sessionId: 'previous-chat',
  connected: true,
  model: previous,
  models: [first, previous],
  thinking: 'high',
  thinkingLevels: ['off', 'high'],
};
const noPreference = { provider: '', modelId: '' };
const environment: Environment = {
  piPath: '/pi',
  supported: true,
  compatibility: 'verified',
  version: '1.1.0',
  agentDir: '/agent',
  authExists: true,
  modelsExist: true,
  errors: [],
};
const checklist = (selection: ReturnType<typeof sessionModelState>, ownRuntime = false, env = environment) =>
  renderToStaticMarkup(
    React.createElement(ReadinessChecklist, {
      environment: env,
      runtime: selection.runtime,
      ownRuntime,
      modelLabel: selection.label,
      canConnect: true,
      checkEnvironment() {},
      connect() {},
      providers() {},
    }),
  );
const picker = (selection: ReturnType<typeof sessionModelState>) =>
  renderToStaticMarkup(
    React.createElement(ModelPicker, {
      runtime: selection.runtime,
      fallback: selection.label,
      locked: false,
      thinkingLocked: false,
      canConnect: true,
      connect() {},
      pick() {},
      setThinking() {},
      manage() {},
      open: false,
      setOpen() {},
    }),
  );

test('a new chat with available Pi models has no first-run setup and displays Pi defaults, not another session', () => {
  const selection = sessionModelState(runtime, session, noPreference);
  assert.equal(checklist(selection), '');
  assert.match(picker(selection), /Pi 默认模型/);
  assert.doesNotMatch(picker(selection), /上一会话模型|high/);
  assert.equal(selection.runtime.connected, false);
  assert.deepEqual(selection.runtime.thinkingLevels, []);
  assert.equal(runtime.model, previous);
  assert.equal(runtime.thinking, 'high');
});

test('the selected session model wins over desktop defaults and the cached model from another provider', () => {
  const target = { ...session, model: { provider: first.provider, id: first.id }, thinking: 'low' };
  const selection = sessionModelState(runtime, target, { provider: previous.provider, modelId: previous.id });
  assert.equal(selection.runtime.model, first);
  assert.equal(selection.runtime.thinking, 'low');
  assert.match(picker(selection), /模型 A/);
  assert.doesNotMatch(picker(selection), /上一会话模型|high/);
  assert.equal(checklist(selection), '');
});

test('a saved desktop choice is shown before connection even when its metadata has not been loaded', () => {
  const selection = sessionModelState(emptyRuntime(), session, { provider: 'saved', modelId: 'saved-model' });
  assert.match(picker(selection), /saved-model/);
  assert.equal(checklist(selection), '');
});

test('the current live model and thinking take precedence over saved preferences', () => {
  const live = { ...runtime, sessionId: session.id };
  const selection = sessionModelState(live, { ...session, model: first }, noPreference);
  assert.equal(selection.runtime, live);
  assert.match(picker(selection), /上一会话模型/);
  assert.match(picker(selection), /high/);
  assert.equal(checklist(selection, true), '');
});

test('actual missing models after connection still require selection despite cached choices', () => {
  const selection = sessionModelState(
    { ...runtime, sessionId: session.id, model: undefined },
    { ...session, model: first },
    noPreference,
  );
  assert.match(checklist(selection, true), /选择一个模型/);
  assert.match(checklist(selection, true), /共 2 个可用模型/);
});

test('fresh installation and missing Pi retain actionable setup instructions', () => {
  const fresh = sessionModelState(emptyRuntime(), session, noPreference);
  assert.match(checklist(fresh), /选择一个模型/);
  assert.match(checklist(fresh), /连接并读取模型/);
  const configured = sessionModelState(runtime, session, noPreference);
  assert.match(
    checklist(configured, false, {
      ...environment,
      supported: false,
      compatibility: 'unknown',
      version: undefined,
    }),
    /检查运行环境/,
  );
});

test('connection progress is shown without a task timer; real task startup retains its timer', () => {
  const footer = (runtime: Runtime) =>
    renderToStaticMarkup(
      React.createElement(ComposerFooter, {
        runtime,
        ownRuntime: true,
        ownRunning: true,
        elapsed: 0,
        selected: session,
        pending: true,
        sessionEnabled: true,
        running: true,
      } as ComposerProps),
    );
  const connecting = footer({ ...emptyRuntime(), sessionId: session.id, status: 'starting' });
  assert.match(connecting, /正在连接 Pi/);
  assert.doesNotMatch(connecting, /class="elapsed"|0:00/);
  const starting = footer({
    ...emptyRuntime(),
    sessionId: session.id,
    connected: true,
    status: 'starting',
    startedAt: 1,
  });
  assert.match(starting, /启动中/);
  assert.match(starting, /class="elapsed"/);
  assert.doesNotMatch(starting, /正在连接 Pi/);
});
