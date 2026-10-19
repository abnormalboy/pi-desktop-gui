import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as ts from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';
import { transformSync } from 'esbuild';
import { emptyRuntime, type Message } from '../shared/types';

// Run the actual hook's asynchronous handlers/effects with deterministic promise gates.
// Rendering and IPC transport remain the responsibility of the Electron UI suite.
const api = new API();
const config = path.resolve('tsconfig.json');
let source: ts.SourceFile, draftSource: ts.SourceFile;
try {
  const snapshot = api.updateSnapshot({ openProjects: [config] });
  const program = snapshot.getProject(config)?.program;
  const workbench = program?.getSourceFile(path.resolve('src/hooks/useWorkbench.ts'));
  const draft = program?.getSourceFile(path.resolve('src/hooks/useDraft.ts'));
  assert.ok(workbench && draft);
  source = workbench;
  draftSource = draft;
  snapshot.dispose();
} finally {
  api.close();
}
function body(file: ts.SourceFile, name: string) {
  const matches = file.statements.filter(ts.isFunctionDeclaration).filter((node) => node.name?.text === name);
  assert.equal(matches.length, 1);
  assert.ok(matches[0].body);
  return matches[0].body;
}
const hook = body(source, 'useWorkbench');
function handler(name: string) {
  const matches = hook.statements.filter(ts.isFunctionDeclaration).filter((node) => node.name?.text === name);
  assert.equal(matches.length, 1);
  return matches[0].getText(source);
}
function effect(needle: string) {
  const matches = hook.statements
    .filter(ts.isExpressionStatement)
    .map((node) => node.expression)
    .filter(ts.isCallExpression)
    .filter(
      (node) => node.expression.getText(source) === 'useEffect' && node.getText(source).includes(needle),
    );
  assert.equal(matches.length, 1);
  return matches[0].arguments[0].getText(source);
}
function compile(text: string) {
  const { code } = transformSync(text, { loader: 'ts', format: 'cjs' });
  return new Function(`${code}; return create;`)();
}
const create = compile(`const create = (invoke) => {
  const api = { invoke }, stateRef = { current: { selectedSessionId: 'A' } }, selectionRequest = { current: 0 };
  let pending = 0;
  const errors = [], histories = [];
  const setPendingOperations = update => { pending = update(pending); };
  const setPending = value => { pending = value ? 1 : 0; };
  const setError = error => errors.push(error), readableError = error => String(error);
  const setHistory = messages => histories.push(messages), setSearchOpen = () => {}, focusComposer = () => {};
  ${handler('attempt')}
  ${handler('action')}
  ${handler('selectSession')}
  ${handler('createSession')}
  return { selectSession, createSession, action, stateRef, errors, histories, pending: () => pending };
};`);
function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('late selection IPC histories never replace the selected-ID history effect', async () => {
  const b = deferred<Message[]>(),
    c = deferred<Message[]>();
  const f = create((_method: string, id: string) => (id === 'B' ? b : c).promise);
  const first = f.selectSession({ id: 'B' }),
    second = f.selectSession({ id: 'C' });
  f.stateRef.current.selectedSessionId = 'C';
  c.resolve([{ role: 'user', content: 'C' }]);
  await second;
  b.resolve([{ role: 'user', content: 'B' }]);
  await first;
  assert.deepEqual(f.histories, [], 'selection IPC responses are not an independent history writer');
});

test('overlapping selection requests keep actions pending until every connection settles', async () => {
  const b = deferred<Message[]>(),
    c = deferred<Message[]>();
  const f = create((_method: string, id: string) => (id === 'B' ? b : c).promise);
  const first = f.selectSession({ id: 'B' }),
    second = f.selectSession({ id: 'C' });
  assert.equal(f.pending(), 2);
  f.stateRef.current.selectedSessionId = 'C';
  c.resolve([]);
  await second;
  assert.equal(f.pending(), 1, 'the older in-flight connection must keep actions locked');
  b.resolve([]);
  await first;
  assert.equal(f.pending(), 0);
});

test('late B errors are not shown on newer C, but current failures and cancellations remain visible', async () => {
  const b = deferred(),
    c = deferred();
  const f = create((_method: string, id: string) => (id === 'B' ? b : c).promise);
  const first = f.selectSession({ id: 'B' }),
    second = f.selectSession({ id: 'C' });
  f.stateRef.current.selectedSessionId = 'C';
  c.reject(new Error('C cold start failed'));
  await second;
  b.reject(new Error('B stale failure'));
  await first;
  assert.equal(f.pending(), 0);
  assert.deepEqual(f.errors, ['Error: C cold start failed']);
  const canceled = create(() => Promise.reject(new Error('switch canceled')));
  await canceled.selectSession({ id: 'B' });
  assert.deepEqual(canceled.errors, ['Error: switch canceled']);
});

test('new-session intent invalidates old selection failures and nested actions do not unlock early', async () => {
  const b = deferred(),
    other = deferred();
  const f = create((method: string) =>
    method === 'selectSession' ? b.promise : Promise.resolve({ id: 'new' }),
  );
  const selecting = f.selectSession({ id: 'B' });
  const working = f.action(() => other.promise);
  await f.createSession();
  b.reject(new Error('stale B'));
  await selecting;
  assert.equal(f.pending(), 1);
  assert.deepEqual(f.errors, []);
  other.reject(new Error('current action'));
  await working;
  assert.equal(f.pending(), 0);
  assert.deepEqual(f.errors, ['Error: current action']);
});

const createHistory = compile(`const create = (invoke) => {
  const api = { invoke }, selectedRef = { current: undefined }, recall = { current: 0 }, autoScroll = { current: false }, thread = { current: null };
  const histories = [], errors = [];
  const setHistory = value => histories.push(value), setError = value => errors.push(value), readableError = error => String(error);
  const setFileQuery = () => {}, setFileResults = () => {}, setInspector = () => {}, setMessageLimit = () => {}, setExpanded = () => {}, setTimeout = () => {}, clearTimeout = () => {};
  let cleanup;
  const run = selected => { cleanup?.(); cleanup = (${effect("'readHistory'")})(); };
  return { run, histories, errors };
};`);
for (const outcome of ['success', 'failure'] as const) {
  test(`an obsolete readHistory ${outcome} cannot overwrite the new session`, async () => {
    const b = deferred<Message[]>(),
      c = deferred<Message[]>();
    const f = createHistory((_method: string, id: string) => (id === 'B' ? b : c).promise);
    f.run({ id: 'B' });
    f.run({ id: 'C' });
    c.resolve([{ role: 'user', content: 'C' }]);
    await c.promise;
    if (outcome === 'success') b.resolve([{ role: 'user', content: 'B' }]);
    else b.reject(new Error('obsolete history read'));
    await b.promise.catch(() => {});
    await Promise.resolve();
    assert.deepEqual(f.histories, [[], [], [{ role: 'user', content: 'C' }]]);
    assert.deepEqual(f.errors, []);
  });
}

const initialize = compile(`const create = args => {
  const { selected, environment, state, runtime, sessionEnabled, storage, pending, running, ownRuntime, initializedSessions, api, action } = args;
  return (${effect("api.invoke('connect', selected.id)")})();
};`);
test('automatic initial model resolution remains gated and runs once without a prompt', async () => {
  const calls: string[][] = [];
  const args = {
    selected: { id: 'new' },
    environment: { supported: true, modelsExist: true },
    state: { settings: {} },
    runtime: emptyRuntime(),
    sessionEnabled: true,
    storage: { writable: true },
    pending: false,
    running: false,
    ownRuntime: false,
    initializedSessions: { current: new Set<string>() },
    api: {
      invoke: async (...call: string[]) => {
        calls.push(call);
      },
    },
    action: (fn: () => Promise<void>) => fn(),
  };
  for (const blocked of [
    { pending: true },
    { running: true },
    { sessionEnabled: false },
    { selected: { id: 'new', file: 'history.jsonl' } },
    { storage: { recovery: {} } },
  ])
    initialize({ ...args, ...blocked });
  assert.deepEqual(calls, []);
  initialize(args);
  initialize(args);
  assert.deepEqual(calls, [['connect', 'new']]);
});

const draft = body(draftSource, 'useDraft');
const commands = draft.statements
  .filter(ts.isVariableStatement)
  .flatMap((node) => [...node.declarationList.declarations])
  .filter((node) => node.name.getText(draftSource) === 'allCommands');
assert.equal(commands.length, 1);
assert.ok(commands[0].initializer);
const commandOptions = compile(`const create = (runtime, selected) => {
  const builtinCommands = [], piOnly = false;
  return ${commands[0].initializer.getText(draftSource)};
};`);
test('project commands are unavailable for another session or while the target is not ready', () => {
  const runtime = {
    ...emptyRuntime(),
    sessionId: 'B',
    connected: true,
    commands: [{ name: 'project-b', source: 'extension' }],
  };
  assert.deepEqual(commandOptions(runtime, { id: 'C' }), []);
  assert.deepEqual(commandOptions({ ...runtime, connected: false }, { id: 'B' }), []);
  assert.equal(commandOptions(runtime, { id: 'B' })[0].name, 'project-b');
});

for (const outcome of ['success', 'failure'] as const) {
  test(`returning B to C to B does not revive the first B history ${outcome}`, async () => {
    const first = deferred<Message[]>(),
      c = deferred<Message[]>(),
      latest = deferred<Message[]>();
    let bReads = 0;
    const f = createHistory((_method: string, id: string) =>
      id === 'C' ? c.promise : (++bReads === 1 ? first : latest).promise,
    );
    f.run({ id: 'B' });
    f.run({ id: 'C' });
    f.run({ id: 'B' });
    latest.resolve([{ role: 'user', content: 'latest B' }]);
    await latest.promise;
    if (outcome === 'success') first.resolve([{ role: 'user', content: 'obsolete B' }]);
    else first.reject(new Error('obsolete B error'));
    c.resolve([{ role: 'user', content: 'obsolete C' }]);
    await first.promise.catch(() => {});
    await Promise.resolve();
    assert.deepEqual(f.histories, [[], [], [], [{ role: 'user', content: 'latest B' }]]);
    assert.deepEqual(f.errors, []);
  });
}
