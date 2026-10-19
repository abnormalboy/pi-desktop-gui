import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as types from '../shared/types';
import { defaultSettings } from '../electron/store-state';
import { hideRecoveredErrors } from '../src/lib/conversation-layout';
import { readableError } from '../src/lib/format';
import type { Workbench } from '../src/hooks/useWorkbench';

// Execute the whole production hook with deterministic hook storage, effects, IPC,
// and timers. This checks its real render/closure logic, not Electron or DOM paint.
const { code } = transformSync(readFileSync('src/hooks/useWorkbench.ts', 'utf8'), {
  loader: 'ts',
  format: 'cjs',
});
function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const messages = (content: string): types.Message[] => [{ role: 'user', content }];
const session = (id: string, file: string | undefined = `${id}.jsonl`): types.Session => ({
  id,
  title: id,
  file,
  draft: '',
  attachments: [],
  updatedAt: 1,
  lastStatus: 'idle',
});
const noOp = () => {};
type Effect = { deps?: unknown[]; cleanup?: () => void; run?: () => void | (() => void) };
function harness(invoke: (method: string, id?: string) => Promise<unknown>) {
  const slots: any[] = [],
    effects = new Map<number, Effect>();
  let cursor = 0,
    dirty = false,
    mounted = true,
    updatesAfterUnmount = 0,
    timerId = 0;
  const timers = new Map<number, { run: () => void; delay: number; interval: boolean }>();
  const cleared: number[] = [];
  const state: types.AppState = {
    version: 1,
    projects: [],
    sessions: ['A', 'B', 'C'].map((id) => session(id)),
    settings: { ...defaultSettings },
    selectedSessionId: 'A',
  };
  const view = {
    state,
    runtime: types.emptyRuntime(),
    anyRunning: false,
    environment: { supported: false, authExists: false, modelsExist: false },
    storage: { writable: true } as types.StorageStatus,
    setEnvironment: noOp,
    update: undefined,
  };
  const changed = (before: unknown[] | undefined, after: unknown[] | undefined) =>
    !before || !after || before.length !== after.length || before.some((v, i) => !Object.is(v, after[i]));
  const useEffect = (run: Effect['run'], deps?: unknown[]) => {
    const index = cursor++,
      previous = effects.get(index);
    if (!previous || changed(previous.deps, deps)) effects.set(index, { ...previous, deps, run });
  };
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (value: any) => {
          if (!mounted) updatesAfterUnmount++;
          const next = typeof value === 'function' ? value(slots[index]) : value;
          if (!Object.is(next, slots[index])) {
            slots[index] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(factory: () => unknown, deps?: unknown[]) {
      const index = cursor++;
      if (!(index in slots) || changed(slots[index].deps, deps)) slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useEffect,
    useLayoutEffect: useEffect,
  };
  const draft = {
    draft: '',
    attachments: [],
    images: [],
    sendMode: 'steer',
    setSendMode: noOp,
    setFileQuery: noOp,
    setFileResults: noOp,
    setCommandIndex: noOp,
    setHideCommands: noOp,
    recall: { current: -1 },
    input: { current: null },
    commandList: { current: null },
    focusComposer: noOp,
    composeDraft: () => '',
    snippets: [],
  };
  const workspace = { checkpoints: [], setTab: noOp, inspectFile: noOp, openCheckpoint: noOp };
  const dependencies: Record<string, unknown> = {
    react: hooks,
    './useRuntime': { useRuntime: () => view },
    './useDraft': { useDraft: () => draft },
    './useWorkspace': { useWorkspace: () => workspace },
    './useShortcuts': { useShortcuts: noOp },
    './useFocusScope': { useFocusScope: noOp },
    '../lib/commands': { builtinCommands: [] },
    '../../shared/types': types,
    '../lib/format': { readableError },
    '../lib/conversation-layout': { hideRecoveredErrors },
    '../../shared/pi-version': { PI_SOURCE_URL: '' },
  };
  const require = (id: string) => {
    assert.ok(id in dependencies, `Unexpected hook dependency: ${id}`);
    return dependencies[id];
  };
  const timeout = (run: () => void, delay: number, interval = false) => {
    const id = ++timerId;
    timers.set(id, { run, delay, interval });
    return id;
  };
  const clear = (id: number) => {
    cleared.push(id);
    timers.delete(id);
  };
  const module = { exports: {} };
  const useWorkbench = new Function(
    'require',
    'module',
    'exports',
    'window',
    'localStorage',
    'document',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    `${code}; return module.exports.useWorkbench;`,
  )(
    require,
    module,
    module.exports,
    { desktop: { invoke, platform: 'linux' } },
    { getItem: () => null, setItem: noOp },
    { documentElement: { dataset: {}, style: { setProperty: noOp } }, activeElement: null },
    timeout,
    clear,
    (run: () => void, delay: number) => timeout(run, delay, true),
    clear,
  ) as () => Workbench;
  let result!: Workbench;
  function render() {
    cursor = 0;
    dirty = false;
    result = useWorkbench();
    return result;
  }
  function flush() {
    for (let n = 0; n < 30; n++) {
      if (dirty) render();
      const pending = [...effects.values()].filter((effect) => effect.run);
      if (!pending.length && !dirty) return result;
      for (const effect of pending) {
        const run = effect.run!;
        effect.run = undefined;
        effect.cleanup?.();
        effect.cleanup = run() || undefined;
      }
    }
    assert.fail('Hook did not settle');
  }
  async function settle() {
    for (let n = 0; n < 6; n++) {
      await Promise.resolve();
      flush();
    }
    return result;
  }
  function select(id: string, runtime = types.emptyRuntime()) {
    view.state = { ...view.state, selectedSessionId: id };
    view.runtime = runtime;
    return render();
  }
  render();
  flush();
  return {
    view,
    render,
    flush,
    settle,
    select,
    timers,
    cleared,
    get current() {
      return result;
    },
    get updatesAfterUnmount() {
      return updatesAfterUnmount;
    },
    unmount() {
      for (const effect of effects.values()) effect.cleanup?.();
      mounted = false;
    },
    fireTimers(delay: number) {
      for (const [id, timer] of [...timers])
        if (timer.delay === delay) {
          if (!timer.interval) timers.delete(id);
          timer.run();
        }
    },
  };
}

test('the first selected-ID render never displays the previous session history', async () => {
  const b = deferred<types.Message[]>();
  const f = harness((_method, id) => (id === 'B' ? b.promise : Promise.resolve(messages('A history'))));
  await f.settle();
  assert.deepEqual(f.current.messages, messages('A history'));
  const firstFrame = f.select('B');
  assert.deepEqual(firstFrame.messages, [], 'must be empty before selection effects run');
  f.flush();
  b.resolve(messages('B history'));
  await f.settle();
  assert.deepEqual(f.current.messages, messages('B history'));
  f.unmount();
});

test('starting, extension setup and failed cold runtimes retain history; live and connected-empty are authoritative', async () => {
  const f = harness(() => Promise.resolve(messages('saved history')));
  f.select('B');
  f.flush();
  await f.settle();
  for (const patch of [
    { status: 'starting' as const },
    { status: 'starting' as const, dialogs: [{ id: 'setup', title: 'Extension setup' }] },
    { status: 'error' as const },
  ]) {
    f.select('B', { ...types.emptyRuntime(), sessionId: 'B', ...patch } as types.Runtime);
    f.flush();
    assert.deepEqual(f.current.messages, messages('saved history'));
  }
  f.select('B', { ...types.emptyRuntime(), sessionId: 'B', messages: messages('live') });
  assert.deepEqual(f.current.messages, messages('live'));
  f.select('B', { ...types.emptyRuntime(), sessionId: 'B', connected: true });
  assert.deepEqual(f.current.messages, [], 'an authoritative empty transcript must not resurrect JSONL');
  f.unmount();
});

test('a history read resolving after connection cannot repopulate an empty live transcript', async () => {
  const history = deferred<types.Message[]>();
  const f = harness(() => history.promise);
  f.select('A', { ...types.emptyRuntime(), sessionId: 'A', connected: true });
  f.flush();
  history.resolve(messages('obsolete persisted history'));
  await f.settle();
  assert.deepEqual(f.current.messages, []);
  f.unmount();
});

for (const outcome of ['success', 'failure'] as const) {
  test(`B to C to B discards obsolete history ${outcome} and scroll timers`, async () => {
    const first = deferred<types.Message[]>(),
      c = deferred<types.Message[]>(),
      last = deferred<types.Message[]>();
    let reads = 0;
    const f = harness((_method, id) =>
      id === 'B' ? (++reads === 1 ? first : last).promise : id === 'C' ? c.promise : Promise.resolve([]),
    );
    f.select('B');
    f.flush();
    f.select('C');
    f.flush();
    f.select('B');
    f.flush();
    assert.equal([...f.timers.values()].filter((timer) => timer.delay === 80).length, 1);
    last.resolve(messages('latest B'));
    await f.settle();
    if (outcome === 'success') first.resolve(messages('obsolete B'));
    else first.reject(new Error('obsolete B history error'));
    c.resolve(messages('obsolete C'));
    await f.settle();
    assert.deepEqual(f.current.messages, messages('latest B'));
    assert.equal(f.current.error, '');
    f.unmount();
    assert.equal(f.timers.size, 0);
  });
}

test('only the current session restores its saved scroll position', async () => {
  const f = harness(() => Promise.resolve([]));
  f.view.state.sessions = f.view.state.sessions.map((s) => ({ ...s, scrollTop: s.id === 'B' ? 45 : 120 }));
  const positions: number[] = [];
  f.current.thread.current = {
    get scrollTop() {
      return 0;
    },
    set scrollTop(value: number) {
      positions.push(value);
    },
    scrollHeight: 1000,
  } as HTMLDivElement;
  f.select('B');
  f.flush();
  f.select('C');
  f.flush();
  await f.settle();
  positions.length = 0;
  f.fireTimers(80);
  assert.deepEqual(positions, [120]);
  f.unmount();
});

for (const outcome of ['success', 'failure'] as const) {
  test(`unmount cancels history ${outcome} and the 80ms scroll restoration`, async () => {
    const history = deferred<types.Message[]>();
    const f = harness(() => history.promise);
    f.unmount();
    if (outcome === 'success') history.resolve(messages('late'));
    else history.reject(new Error('late history error'));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(f.updatesAfterUnmount, 0);
    assert.equal(f.timers.size, 0);
  });
}

test('selectSession completion never writes history or closes a newer search', async () => {
  const old = deferred<types.Message[]>(),
    latest = deferred<types.Message[]>();
  const f = harness((method, id) =>
    method === 'readHistory' ? Promise.resolve(messages(`${id} JSONL`)) : (id === 'B' ? old : latest).promise,
  );
  const b = f.current.selectSession(session('B'));
  f.select('B');
  f.flush();
  const c = f.current.selectSession(session('C'));
  f.select('C');
  f.flush();
  latest.resolve(messages('C IPC'));
  await c;
  await f.settle();
  f.current.setSearchOpen(true);
  f.flush();
  old.resolve(messages('B IPC'));
  await b;
  await f.settle();
  assert.equal(f.current.searchOpen, true, 'obsolete completion cannot close a newly opened search');
  assert.deepEqual(f.current.messages, messages('C JSONL'));
  f.unmount();
});

test('reopening search during the current selection survives its eventual completion', async () => {
  const connection = deferred<types.Message[]>();
  const f = harness((method) => (method === 'readHistory' ? Promise.resolve([]) : connection.promise));
  f.current.setSearchOpen(true);
  f.flush();
  const selecting = f.current.selectSession(session('B'));
  f.flush();
  assert.equal(f.current.searchOpen, false, 'the choice consumes the search immediately');
  f.select('B');
  f.flush();
  f.current.setSearchOpen(true);
  f.flush();
  connection.resolve([]);
  await selecting;
  await f.settle();
  assert.equal(f.current.searchOpen, true, 'completion must not dismiss a later user-opened search');
  f.unmount();
});

test('B startup is pending on B, while A and C remain independently usable', async () => {
  const connection = deferred<types.Message[]>();
  const f = harness((method) => (method === 'readHistory' ? Promise.resolve([]) : connection.promise));
  const selecting = f.current.selectSession(session('B'));
  f.flush();
  assert.equal(f.current.pending, false, 'the click must not charge the previous A session');
  f.select('B');
  f.flush();
  assert.equal(f.current.pending, true);
  f.select('C');
  f.flush();
  assert.equal(f.current.pending, false);
  connection.resolve([]);
  await selecting;
  await f.settle();
  f.select('B');
  f.flush();
  assert.equal(f.current.pending, false);
  f.unmount();
});

test('overlapping selections of the same ID retain pending until both settle', async () => {
  const first = deferred<types.Message[]>(),
    second = deferred<types.Message[]>();
  let count = 0;
  const f = harness((method) =>
    method === 'readHistory' ? Promise.resolve([]) : (++count === 1 ? first : second).promise,
  );
  const one = f.current.selectSession(session('B'));
  f.select('B');
  f.flush();
  const two = f.current.selectSession(session('B'));
  f.flush();
  second.resolve([]);
  await two;
  await f.settle();
  assert.equal(f.current.pending, true);
  first.resolve([]);
  await one;
  await f.settle();
  assert.equal(f.current.pending, false);
  f.unmount();
});

test('current B selection failure belongs to B, never the click-time A closure', async () => {
  const connection = deferred<types.Message[]>();
  const f = harness((method) => (method === 'readHistory' ? Promise.resolve([]) : connection.promise));
  const selecting = f.current.selectSession(session('B'));
  f.select('B');
  f.flush();
  connection.reject(new Error('B cold start failed'));
  await selecting;
  await f.settle();
  assert.match(f.current.error, /B cold start failed/);
  assert.equal(f.current.pending, false);
  f.select('A');
  f.flush();
  assert.equal(f.current.error, '');
  f.unmount();
});

test('an obsolete B failure cannot overwrite the newer C failure or leak into A', async () => {
  const old = deferred<types.Message[]>(),
    latest = deferred<types.Message[]>();
  const f = harness((method, id) =>
    method === 'readHistory' ? Promise.resolve([]) : (id === 'B' ? old : latest).promise,
  );
  const b = f.current.selectSession(session('B'));
  f.select('B');
  f.flush();
  const c = f.current.selectSession(session('C'));
  f.select('C');
  f.flush();
  latest.reject(new Error('current C failure'));
  await c;
  await f.settle();
  old.reject(new Error('obsolete B failure'));
  await b;
  await f.settle();
  assert.equal(f.current.error, 'current C failure');
  f.select('B');
  f.flush();
  assert.equal(f.current.error, '');
  f.select('A');
  f.flush();
  assert.equal(f.current.error, '');
  f.unmount();
});

test('B to C to B ignores an old failure after newer success and clears the previous retry error', async () => {
  const old = deferred<types.Message[]>();
  let bCalls = 0;
  const f = harness((method, id) =>
    method === 'readHistory'
      ? Promise.resolve([])
      : id === 'B' && ++bCalls === 1
        ? old.promise
        : Promise.resolve([]),
  );
  const one = f.current.selectSession(session('B'));
  f.select('B');
  f.flush();
  f.current.setError('previous B failure');
  f.flush();
  const c = f.current.selectSession(session('C'));
  f.select('C');
  f.flush();
  await c;
  const two = f.current.selectSession(session('B'));
  f.select('B');
  f.flush();
  await two;
  await f.settle();
  old.reject(new Error('obsolete B selection failure'));
  await one;
  await f.settle();
  assert.equal(f.current.error, '');
  assert.equal(f.current.pending, false);
  f.select('A');
  f.flush();
  assert.equal(f.current.error, '');
  f.unmount();
});

test('same-ID callers sharing the backend connection still expose its real latest failure', async () => {
  const shared = deferred<types.Message[]>();
  const f = harness((method) => (method === 'readHistory' ? Promise.resolve([]) : shared.promise));
  const one = f.current.selectSession(session('B'));
  f.select('B');
  f.flush();
  const two = f.current.selectSession(session('B'));
  f.flush();
  shared.reject(new Error('shared connection failed'));
  await Promise.all([one, two]);
  await f.settle();
  assert.match(f.current.error, /shared connection failed/);
  assert.equal(f.current.pending, false);
  f.select('A');
  f.flush();
  assert.equal(f.current.error, '');
  f.unmount();
});

test('new-session intent invalidates an old selection failure without unlocking a separate action', async () => {
  const connection = deferred<types.Message[]>(),
    other = deferred();
  const f = harness((method) =>
    method === 'readHistory'
      ? Promise.resolve([])
      : method === 'newSession'
        ? Promise.resolve(session('new'))
        : connection.promise,
  );
  const selecting = f.current.selectSession(session('B'));
  f.select('B');
  f.flush();
  const working = f.current.action(() => other.promise);
  await f.current.createSession();
  connection.reject(new Error('obsolete B failure'));
  await selecting;
  await f.settle();
  assert.equal(f.current.error, '');
  assert.equal(f.current.pending, true);
  other.resolve();
  await working;
  await f.settle();
  assert.equal(f.current.pending, false);
  f.select('A');
  f.flush();
  assert.equal(f.current.error, '');
  f.unmount();
});

test('automatic model resolution respects readiness and does not retry a failed connection on rerender', async () => {
  const calls: string[] = [];
  const f = harness((method) => {
    calls.push(method);
    return method === 'connect'
      ? Promise.reject(new Error('initial connection failed'))
      : Promise.resolve([]);
  });
  f.view.state.sessions.push({ ...session('new'), file: undefined });
  f.select('new');
  f.flush();
  await f.settle();
  assert.equal(calls.includes('connect'), false, 'unsupported environment');
  f.view.environment = { supported: true, authExists: false, modelsExist: false };
  f.render();
  f.flush();
  await f.settle();
  assert.equal(calls.includes('connect'), false, 'no model or auth source');
  f.view.environment.modelsExist = true;
  f.view.storage.writable = false;
  f.render();
  f.flush();
  await f.settle();
  assert.equal(calls.includes('connect'), false, 'read-only storage');
  f.view.storage.writable = true;
  f.view.storage.recovery = {
    restarted: true,
    discardedProjects: 0,
    discardedSessions: 0,
    repairedSettings: 0,
  };
  f.render();
  f.flush();
  await f.settle();
  assert.equal(calls.includes('connect'), false, 'unresolved storage recovery');
  f.view.storage.recovery = undefined;
  f.render();
  f.flush();
  await f.settle();
  assert.match(f.current.error, /initial connection failed/);
  assert.equal(f.current.pending, false);
  f.select('A');
  f.flush();
  f.select('new');
  f.flush();
  await f.settle();
  assert.equal(calls.filter((method) => method === 'connect').length, 1);
  assert.equal(calls.includes('send'), false);
  f.unmount();
});

test('empty-session autoconnect is gated and not duplicated while selection is pending', async () => {
  const selection = deferred<types.Message[]>();
  const calls: string[] = [];
  const f = harness((method) => {
    calls.push(method);
    return method === 'selectSession' ? selection.promise : Promise.resolve([]);
  });
  f.view.state.sessions = f.view.state.sessions.map((s) => (s.id === 'B' ? { ...s, file: undefined } : s));
  f.view.environment = { supported: true, authExists: true, modelsExist: true };
  const selecting = f.current.selectSession(session('B', undefined));
  f.select('B');
  f.flush();
  assert.equal(calls.filter((method) => method === 'connect').length, 0);
  f.view.runtime = { ...types.emptyRuntime(), sessionId: 'B', connected: true };
  selection.resolve([]);
  await selecting;
  await f.settle();
  assert.equal(calls.filter((method) => method === 'connect').length, 0);
  // A genuinely new empty session still resolves Pi defaults once, before a prompt.
  f.view.state.sessions.push({ ...session('new'), file: undefined });
  f.select('new');
  f.flush();
  await f.settle();
  f.render();
  f.flush();
  await f.settle();
  assert.equal(calls.filter((method) => method === 'connect').length, 1);
  assert.equal(calls.includes('send'), false);
  f.unmount();
});
