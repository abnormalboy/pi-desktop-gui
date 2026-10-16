import test from 'node:test';
import assert from 'node:assert/strict';
import { installSessionSwitchProbe, summarizeSessionSwitchProbe } from '../scripts/session-switch-probe.mjs';

const renderer = {
  switchId: 'id',
  sessionId: 'a',
  clockDomain: 'renderer-performance',
  outcome: 'fulfilled',
  points: {
    clickCapture: 1000,
    invoke: 1002,
    legacyClickBubble: 1003,
    targetRuntimeEventReceived: 1015,
    targetMessagesEventReceived: 1016,
    targetDomObserved: 1020,
    rafCallback: 1030,
    invokeSettled: 1100,
  },
};
const main = {
  switchId: 'id',
  sessionId: 'a',
  clockDomain: 'main-performance',
  outcome: 'fulfilled',
  points: {
    ipcReceived: 100000,
    terminalGuardStarted: 100001,
    terminalGuardFinished: 100003,
    handlerStarted: 100004,
    connectEnqueued: 100005,
    connectStarted: 100055,
    backendStarted: 100056,
    backendFinished: 100076,
    saveAndStateStarted: 100077,
    saveAndStateFinished: 100090,
    handlerFinished: 100091,
  },
};
test('summary uses process-local intervals and allows DOM/rAF before invoke completion', () => {
  const result = summarizeSessionSwitchProbe(renderer, main);
  assert.equal(result.captureToTargetDomObservedMs, 20);
  assert.equal(result.captureToRafCallbackMs, 30);
  assert.equal(result.legacyBubbleToRafCallbackMs, 27);
  assert.equal(result.invokeToSettledMs, 98);
  assert.equal(result.queueWaitMs, 50);
  assert.equal(result.backendMs, 20);
  assert.equal(result.terminalGuardMs, 2);
  assert.equal(result.saveAndStateMs, 13);
  assert.equal(result.main.pointsMs.ipcReceived, 0);
  assert.equal(result.renderer.pointsMs.clickCapture, 0);
});
test('summary refuses mismatched IDs, clock domains and incomplete timing records', () => {
  for (const changed of [
    { switchId: 'previous' },
    { sessionId: 'b' },
    { clockDomain: 'renderer-performance' },
    { points: {} },
  ])
    assert.throws(() => summarizeSessionSwitchProbe(renderer, { ...main, ...changed }));
});

test('summary rejects reversed same-process intervals without ordering DOM against invoke settlement', () => {
  for (const [changedRenderer, changedMain] of [
    [{ ...renderer, points: { ...renderer.points, invoke: 999 } }, main],
    [{ ...renderer, points: { ...renderer.points, rafCallback: 1010 } }, main],
    [renderer, { ...main, points: { ...main.points, connectStarted: 100004 } }],
    [renderer, { ...main, points: { ...main.points, handlerStarted: 100002 } }],
    [renderer, { ...main, points: { ...main.points, handlerFinished: 100089 } }],
  ])
    assert.throws(() => summarizeSessionSwitchProbe(changedRenderer, changedMain), /Non-monotonic/);
  assert.equal(
    summarizeSessionSwitchProbe({ ...renderer, points: { ...renderer.points, invokeSettled: 1010 } }, main)
      .invokeToSettledMs,
    8,
  );
});

// Minimal renderer simulation checks cleanup/association, not real layout or paint timing.
test('probe lifecycle keeps bounded failure snapshots and cleans all observers', async (t) => {
  const names = ['window', 'document', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const descriptors = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  t.after(() => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const target = {},
    other = {};
  let listeners, thread, observer, subscriber, frames;
  const setup = () => {
    listeners = new Map();
    frames = new Map();
    thread = { textContent: 'SOURCE' };
    globalThis.window = {
      desktop: {
        onEvent(fn) {
          subscriber = fn;
          return () => {
            subscriber = undefined;
          };
        },
      },
    };
    globalThis.document = {
      querySelector(selector) {
        assert.equal(selector, '.thread');
        return thread;
      },
      addEventListener(type, fn, capture = false) {
        assert.equal(type, 'click');
        listeners.set(capture ? 'capture' : 'bubble', fn);
      },
      removeEventListener(type, fn, capture = false) {
        assert.equal(type, 'click');
        assert.equal(listeners.get(capture ? 'capture' : 'bubble'), fn);
        listeners.delete(capture ? 'capture' : 'bubble');
      },
    };
    globalThis.MutationObserver = class {
      constructor(fn) {
        this.fn = fn;
        this.connected = false;
        observer = this;
      }
      observe() {
        this.connected = true;
      }
      disconnect() {
        this.connected = false;
      }
    };
    globalThis.requestAnimationFrame = (fn) => {
      frames.set(1, fn);
      return 1;
    };
    globalThis.cancelAnimationFrame = (id) => frames.delete(id);
    installSessionSwitchProbe(
      { contains: (node) => node === target },
      { sessionId: 'target-session', marker: 'TARGET', timeoutMs: 30 },
    );
    return window.switchMeasurement;
  };
  const point = (phase, outcome, switchId = 'one') => {
    window.__sessionSwitchDiagnostic({
      sessionId: 'target-session',
      switchId,
      phase,
      at: performance.now(),
      outcome,
    });
  };
  const clickAndInvoke = () => {
    listeners.get('capture')({ target: other });
    assert.equal(window.switchMeasurementSnapshot.points.clickCapture, undefined);
    listeners.get('capture')({ target });
    point('invoke');
    listeners.get('bubble')({ target });
  };
  const clean = () => {
    assert.equal(listeners.size, 0);
    assert.equal(subscriber, undefined);
    assert.equal(observer.connected, false);
    assert.equal(window.__sessionSwitchDiagnostic, undefined);
    assert.equal(frames.size, 0);
  };
  for (const order of ['dom-first', 'settled-first']) {
    await t.test(order, async () => {
      const promise = setup();
      clickAndInvoke();
      if (order === 'settled-first') point('invokeSettled', 'fulfilled');
      subscriber({
        type: 'runtimePatch',
        switchId: 'different',
        patch: { sessionId: 'target-session', messages: ['TARGET'] },
      });
      subscriber({
        type: 'runtimePatch',
        switchId: 'one',
        patch: { sessionId: 'other-session', messages: ['TARGET'] },
      });
      assert.equal(window.switchMeasurementSnapshot.points.targetMessagesEventReceived, undefined);
      subscriber({
        type: 'runtimePatch',
        switchId: 'one',
        patch: { sessionId: 'target-session', messages: ['TARGET'] },
      });
      thread.textContent = 'TARGET';
      observer.fn();
      frames.get(1)();
      if (order === 'dom-first') point('invokeSettled', 'fulfilled');
      const result = await promise;
      assert.equal(result, window.switchMeasurementSnapshot);
      assert.equal(result.outcome, 'fulfilled');
      assert.equal(result.switchId, 'one');
      assert.ok(Number.isFinite(result.points.targetMessagesEventReceived));
      clean();
    });
  }
  await t.test('invoke rejection', async () => {
    const promise = setup();
    clickAndInvoke();
    point('invokeSettled', 'rejected');
    await assert.rejects(promise, /Session selection rejected/);
    assert.equal(window.switchMeasurementSnapshot.outcome, 'rejected');
    clean();
  });
  await t.test('timeout', async () => {
    const promise = setup();
    clickAndInvoke();
    await assert.rejects(promise, /probe timed out/);
    assert.equal(window.switchMeasurementSnapshot.switchId, 'one');
    assert.ok(Number.isFinite(window.switchMeasurementSnapshot.points.invoke));
    clean();
  });
  await t.test('duplicate invoke', async () => {
    const promise = setup();
    clickAndInvoke();
    point('invoke', undefined, 'two');
    await assert.rejects(promise, /More than one selection invocation/);
    assert.equal(window.switchMeasurementSnapshot.switchId, 'one');
    clean();
  });
});
