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
  let selectionObserver: ((id: string | undefined) => void) | undefined;
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
    './useRuntime': {
      useRuntime(_setError: unknown, _setPrefs: unknown, observe: typeof selectionObserver) {
        selectionObserver = observe;
        return view;
      },
    },
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
    draft,
    render,
    flush,
    settle,
    select,
    emitSelection(id: string) {
      selectionObserver?.(id);
      view.state = { ...view.state, selectedSessionId: id };
    },
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

test('B selection is pending on B, while A and C remain independently usable', async () => {
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
  connection.reject(new Error('B selection failed'));
  await selecting;
  await f.settle();
  assert.match(f.current.error, /B selection failed/);
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

test('same-ID callers still expose the latest selection failure', async () => {
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

for (const empty of [false, true]) {
  test(`opening and revisiting a ${empty ? 'new empty' : 'saved'} chat never automatically connects`, async () => {
    const calls: string[] = [];
    const f = harness((method) => {
      calls.push(method);
      return Promise.resolve([]);
    });
    f.view.environment = { supported: true, authExists: true, modelsExist: true };
    if (empty)
      f.view.state.sessions = f.view.state.sessions.map((s) =>
        s.id === 'B' ? { ...s, file: undefined } : s,
      );
    const selecting = f.current.selectSession(session('B'));
    f.select('B');
    f.flush();
    await selecting;
    await f.settle();
    f.select('C');
    f.flush();
    f.select('B');
    f.flush();
    await f.settle();
    assert.equal(f.current.pending, false);
    assert.equal(f.current.ownRunning, false);
    assert.equal(calls.includes('connect'), false);
    assert.equal(calls.includes('send'), false);
    f.unmount();
  });
}

test('an explicit connection still reads Pi models without sending a task', async () => {
  const calls: { method: string; id?: string }[] = [];
  const f = harness((method, id) => {
    calls.push({ method, id });
    return Promise.resolve([]);
  });
  f.select('B');
  f.flush();
  await f.current.connect();
  await f.settle();
  assert.deepEqual(
    calls.filter((call) => call.method === 'connect'),
    [{ method: 'connect', id: 'B' }],
  );
  assert.equal(
    calls.some((call) => call.method === 'send'),
    false,
  );
  assert.equal(f.current.pending, false);
  f.unmount();
});

test('the first prompt is sent to the selected cold chat without a separate eager connection', async () => {
  const calls: { method: string; id?: string }[] = [];
  const f = harness((method, id) => {
    calls.push({ method, id });
    return Promise.resolve([]);
  });
  f.view.environment = { supported: true, authExists: true, modelsExist: true };
  f.draft.composeDraft = () => 'First task in B';
  f.select('B');
  f.flush();
  await f.current.send();
  await f.settle();
  assert.deepEqual(
    calls.filter((call) => call.method === 'send'),
    [{ method: 'send', id: 'B' }],
  );
  assert.equal(
    calls.some((call) => call.method === 'connect'),
    false,
  );
  assert.equal(f.current.pending, false);
  f.unmount();
});

test('selection transition protects the old view and waits for both IPC and target selection', async () => {
  const selecting = deferred<types.Message[]>();
  const calls: string[] = [];
  const f = harness((method) => {
    calls.push(method);
    return method === 'selectSession' ? selecting.promise : Promise.resolve([]);
  });
  const operation = f.current.selectSession(session('B'));
  f.flush();
  assert.equal(f.current.selectionChanging, true);
  assert.equal(f.current.selected?.id, 'A');
  selecting.resolve([]);
  await operation;
  await f.settle();
  assert.equal(f.current.selectionChanging, true, 'an IPC result alone is not a committed target view');
  f.select('B');
  f.flush();
  assert.equal(f.current.selectionChanging, false);
  assert.ok(!calls.includes('connect'));
  f.unmount();
});

test('obsolete creation completion cannot unlock a newer transition or restore an old target', async () => {
  const first = deferred<types.Session>(),
    second = deferred<types.Session>();
  let count = 0;
  const f = harness((method) =>
    method === 'newSession' ? (++count === 1 ? first.promise : second.promise) : Promise.resolve([]),
  );
  const a = f.current.createSession();
  f.flush();
  const b = f.current.createSession();
  f.flush();
  first.resolve(session('B'));
  await a;
  await f.settle();
  f.select('B');
  f.flush();
  assert.equal(f.current.selectionChanging, true);
  second.resolve(session('C'));
  await b;
  await f.settle();
  assert.equal(f.current.selectionChanging, true);
  f.select('C');
  f.flush();
  assert.equal(f.current.selectionChanging, false);
  assert.equal(f.current.selected?.id, 'C');
  f.unmount();
});

test('a new selection cancels the old transition owner and failures release the model entry', async () => {
  const old = deferred<types.Message[]>(),
    latest = deferred<types.Message[]>();
  const f = harness((method, id) =>
    method === 'selectSession' ? (id === 'B' ? old.promise : latest.promise) : Promise.resolve([]),
  );
  const b = f.current.selectSession(session('B'));
  f.select('B');
  f.flush();
  const c = f.current.selectSession(session('C'));
  f.select('C');
  f.flush();
  old.resolve([]);
  await b;
  await f.settle();
  assert.equal(f.current.selectionChanging, true);
  latest.reject(new Error('selection rejected'));
  await c;
  await f.settle();
  assert.equal(f.current.selectionChanging, false);
  assert.match(f.current.error, /selection rejected/);
  f.unmount();
});

test('failed new chat releases the transition without connecting or changing selection', async () => {
  const f = harness((method) =>
    method === 'newSession' ? Promise.reject(new Error('creation cancelled')) : Promise.resolve([]),
  );
  await f.current.createSession();
  await f.settle();
  assert.equal(f.current.selectionChanging, false);
  assert.equal(f.current.selected?.id, 'A');
  assert.match(f.current.error, /creation cancelled/);
  f.unmount();
});

test('a native-menu selection supersedes an in-flight renderer selection before its late success reply', async () => {
  const selecting = deferred<types.Message[]>();
  const calls: { method: string; id?: string }[] = [];
  const f = harness((method, id) => {
    calls.push({ method, id });
    return method === 'selectSession' ? selecting.promise : Promise.resolve([]);
  });
  const operation = f.current.selectSession(session('B'));
  f.select('B');
  f.flush();
  f.select('C'); // Native File > New Chat broadcasts a new selected ID outside this hook.
  f.flush();
  selecting.resolve([]);
  await operation;
  await f.settle();
  assert.equal(f.current.selected?.id, 'C');
  assert.equal(f.current.selectionChanging, false);
  assert.equal(f.current.sessionEnabled, true);
  assert.deepEqual(
    calls.filter((call) => call.method === 'connect'),
    [],
  );
  await f.current.connect();
  await f.settle();
  assert.deepEqual(
    calls.filter((call) => call.method === 'connect'),
    [{ method: 'connect', id: 'C' }],
  );
  f.unmount();
});

test('deleting the observed selection releases its transition for the surviving fallback chat', async () => {
  const selecting = deferred<types.Message[]>();
  const calls: string[] = [];
  const f = harness((method) => {
    calls.push(method);
    return method === 'selectSession' ? selecting.promise : Promise.resolve([]);
  });
  const operation = f.current.selectSession(session('B'));
  f.select('B');
  f.flush();
  const oldModel = f.current.setModel;
  f.view.state.sessions = f.view.state.sessions.filter((s) => s.id !== 'B');
  f.select('C');
  f.flush();
  selecting.resolve([]);
  await operation;
  await f.settle();
  assert.equal(f.current.selected?.id, 'C');
  assert.equal(f.current.selectionChanging, false);
  assert.equal(f.current.sessionEnabled, true);
  await oldModel('provider::model');
  assert.ok(!calls.includes('setSessionModel'));
  assert.ok(!calls.includes('connect'));
  assert.ok(!f.view.state.sessions.some((s) => s.id === 'B'));
  f.unmount();
});

test('external selection and an old completion cannot release a newer unobserved hook target', async () => {
  const old = deferred<types.Message[]>(),
    latest = deferred<types.Message[]>();
  const calls: string[] = [];
  const f = harness((method, id) => {
    calls.push(method);
    return method === 'selectSession' ? (id === 'B' ? old.promise : latest.promise) : Promise.resolve([]);
  });
  const b = f.current.selectSession(session('B'));
  f.select('B');
  f.flush();
  const c = f.current.selectSession(session('C'));
  f.flush();
  f.select('A');
  f.flush();
  assert.equal(f.current.selectionChanging, true);
  old.resolve([]);
  await b;
  await f.settle();
  assert.equal(f.current.selectionChanging, true);
  await f.current.connect();
  assert.ok(!calls.includes('connect'));
  f.select('C');
  f.flush();
  assert.equal(f.current.selectionChanging, true, 'the latest IPC must still complete');
  latest.resolve([]);
  await c;
  await f.settle();
  assert.equal(f.current.selectionChanging, false);
  assert.equal(f.current.selected?.id, 'C');
  f.unmount();
});

for (const kind of ['selection', 'creation', 'blank reuse'] as const) {
  test(`authoritative ${kind} and external selection events survive a coalesced React render`, async () => {
    const response = deferred<unknown>();
    const calls: string[] = [];
    const f = harness((method) => {
      calls.push(method);
      return ['selectSession', 'newSession'].includes(method) ? response.promise : Promise.resolve([]);
    });
    const target = kind === 'blank reuse' ? 'A' : 'B';
    const operation =
      kind === 'selection' ? f.current.selectSession(session(target)) : f.current.createSession();
    f.flush();
    // useRuntime sees both authoritative events before React renders just C.
    f.emitSelection(target);
    f.emitSelection('C');
    f.render();
    f.flush();
    response.resolve(kind === 'selection' ? [] : session(target));
    await operation;
    await f.settle();
    assert.equal(f.current.selected?.id, 'C');
    assert.equal(f.current.selectionChanging, false);
    assert.equal(f.current.sessionEnabled, true);
    assert.ok(!calls.includes('connect'));
    f.unmount();
  });
}

test('an unobserved creation response target stays locked despite a different authoritative selection', async () => {
  const response = deferred<types.Session>();
  const calls: string[] = [];
  const f = harness((method) => {
    calls.push(method);
    return method === 'newSession' ? response.promise : Promise.resolve([]);
  });
  const creating = f.current.createSession();
  f.flush();
  f.emitSelection('C');
  f.render();
  f.flush();
  response.resolve(session('B'));
  await creating;
  await f.settle();
  assert.equal(f.current.selected?.id, 'C');
  assert.equal(f.current.selectionChanging, true);
  assert.equal(f.current.sessionEnabled, false);
  await f.current.connect();
  assert.ok(!calls.includes('connect'));
  f.unmount();
});

test('unchanged selected state and recovered background sessions are not external navigation', async () => {
  const response = deferred<types.Message[]>();
  const f = harness((method) => (method === 'selectSession' ? response.promise : Promise.resolve([])));
  const operation = f.current.selectSession(session('B'));
  f.select('B');
  f.flush();
  f.view.state.sessions = [...f.view.state.sessions, session('recovered-image')];
  f.emitSelection('B');
  f.render();
  f.flush();
  assert.equal(f.current.selected?.id, 'B');
  assert.equal(f.current.selectionChanging, true);
  response.resolve([]);
  await operation;
  await f.settle();
  assert.equal(f.current.selectionChanging, false);
  f.unmount();
});

test('an old connect callback cannot connect after navigation starts, even before the next render', async () => {
  const next = deferred<types.Session>();
  const calls: string[] = [];
  const f = harness((method) => {
    calls.push(method);
    return method === 'newSession' ? next.promise : Promise.resolve([]);
  });
  const oldConnect = f.current.connect;
  const changing = f.current.createSession();
  await oldConnect();
  assert.ok(!calls.includes('connect'));
  f.flush();
  await f.current.connect();
  assert.ok(!calls.includes('connect'));
  next.resolve(session('B'));
  await changing;
  f.select('B');
  f.flush();
  await f.current.connect();
  await f.settle();
  assert.equal(calls.filter((call) => call === 'connect').length, 1);
  f.unmount();
});

test('model and thinking callbacks belong to their original session and navigation request', async () => {
  const next = deferred<types.Session>();
  const calls: { method: string; id?: string }[] = [];
  const f = harness((method, id) => {
    calls.push({ method, id });
    return method === 'newSession' ? next.promise : Promise.resolve([]);
  });
  const oldModel = f.current.setModel,
    oldThinking = f.current.setThinking;
  const changing = f.current.createSession();
  await oldModel('provider::model');
  await oldThinking('high');
  f.flush();
  next.resolve(session('B'));
  await changing;
  f.select('B');
  f.flush();
  await oldModel('provider::model');
  await oldThinking('high');
  assert.deepEqual(
    calls.filter((call) => call.method.startsWith('setSession')),
    [],
  );
  await f.current.setModel('provider::model');
  await f.settle();
  await f.current.setThinking('high');
  await f.settle();
  assert.deepEqual(
    calls.filter((call) => call.method.startsWith('setSession')),
    [
      { method: 'setSessionModel', id: 'B' },
      { method: 'setSessionThinking', id: 'B' },
    ],
  );
  f.unmount();
});

test('an external selection change invalidates every old model action without relying on popup cleanup', async () => {
  const calls: { method: string; id?: string }[] = [];
  const f = harness((method, id) => {
    calls.push({ method, id });
    return Promise.resolve([]);
  });
  const previous = f.current;
  f.select('B');
  // Deliberately do not flush effects, including any selection cleanup.
  await previous.connect();
  await previous.setModel('provider::model');
  await previous.setThinking('high');
  assert.deepEqual(
    calls.filter((call) => ['connect', 'setSessionModel', 'setSessionThinking'].includes(call.method)),
    [],
  );
  f.view.storage.writable = false;
  f.select('B');
  await f.current.connect();
  await f.current.setModel('provider::model');
  await f.current.setThinking('high');
  assert.deepEqual(
    calls.filter((call) => ['connect', 'setSessionModel', 'setSessionThinking'].includes(call.method)),
    [],
    'a disabled target must reject model actions as well as connections',
  );
  f.unmount();
});
