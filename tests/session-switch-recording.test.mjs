import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import {
  armSessionSwitchMeasurement,
  armRecordedSessionSwitchMeasurement,
} from '../scripts/session-switch-measurement.mjs';
import { installSessionSwitchRecorder } from '../scripts/session-switch-recording.mjs';
import { causalBlockPlan, summarizeCausalBlock } from '../scripts/test-session-switch-causal.mjs';

function browser({ recording = false, capacity = 12000 } = {}) {
  let time = 0;
  let uuid = 0;
  const listeners = [];
  const frames = [];
  const observers = [];
  const timers = new Map();
  const thread = { textContent: 'old messages' };
  const document = {
    visibilityState: 'visible',
    hasFocus: () => true,
    querySelector: () => thread,
    addEventListener: (type, callback, options) => listeners.push({ type, callback, options }),
  };
  const window = { addEventListener: document.addEventListener };
  const context = vm.createContext({
    window,
    document,
    performance: { now: () => time, timeOrigin: 1000 },
    crypto: { randomUUID: () => `invocation-${++uuid}` },
    setTimeout: (callback) => {
      const id = timers.size + 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (callback) => frames.push(callback),
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.connected = false;
        observers.push(this);
      }
      observe() {
        this.connected = true;
      }
      disconnect() {
        this.connected = false;
      }
    },
  });
  const run = (fn, arg) => {
    context.argument = arg;
    return vm.runInContext(`(${fn.toString()})(argument)`, context);
  };
  if (recording) run(installSessionSwitchRecorder, { capacity });
  return {
    window,
    frames,
    timers,
    run,
    at(value) {
      time = value;
    },
    click(capture = false) {
      for (const entry of [...listeners]) {
        if (entry.type !== 'click' || (entry.options === true) !== capture) continue;
        entry.callback();
        if (entry.options?.once) listeners.splice(listeners.indexOf(entry), 1);
      }
    },
    mutate(text) {
      thread.textContent = text;
      for (const observer of observers) if (observer.connected) observer.callback();
    },
  };
}

for (const recording of [false, true]) {
  test(`${recording ? 'recorded' : 'default'} measurement resolves at the first target rAF before a late invoke`, async () => {
    const b = browser({ recording });
    b.run(
      recording ? armRecordedSessionSwitchMeasurement : armSessionSwitchMeasurement,
      recording ? { marker: 'TARGET', targetId: 'session-a', index: 0 } : 'TARGET',
    );
    b.mutate('TARGET before click');
    assert.equal(b.frames.length, 0);
    b.at(10);
    b.click(true);
    b.at(11);
    const id = b.window.__sessionSwitchRecorder?.invoke('session-a');
    b.at(12);
    b.click();
    b.at(20);
    b.mutate('TARGET');
    assert.equal(b.frames.length, 1);
    b.mutate('TARGET changed again');
    assert.equal(b.frames.length, 1);
    b.at(25);
    b.frames.shift()();
    assert.equal(await b.window.switchMeasurement, 13);
    assert.equal(b.frames.length, 0);
    assert.equal(b.timers.size, 0);
    if (recording) {
      const recorder = b.window.__sessionSwitchRecorder;
      assert.ok(!recorder.snapshot().events.some((event) => event.phase === 'invoke.settled'));
      b.at(90);
      recorder.settled(id, 'ok');
      const events = recorder.snapshot().events;
      assert.ok(
        events.find((event) => event.phase === 'target.raf').seq <
          events.find((event) => event.phase === 'invoke.settled').seq,
      );
      assert.equal(events.find((event) => event.phase === 'invoke.settled').at, 90);
    }
  });
}

test('late events retain invocation ownership after settlement and the next sample', () => {
  const b = browser({ recording: true });
  const recorder = b.window.__sessionSwitchRecorder;
  recorder.arm('session-a', 0);
  const a = recorder.invoke('session-a');
  recorder.settled(a, 'ok');
  recorder.arm('session-b', 1);
  const second = recorder.invoke('session-b');
  b.at(100);
  recorder.event({
    type: 'state',
    state: { selectedSessionId: 'session-a', secretDraft: 'MUST NOT RECORD' },
    sessionSwitchRecording: {
      eventSeq: 9,
      invocationId: a,
      source: 'store.save',
      saveId: 2,
      snapshotSelectedId: 'session-a',
    },
  });
  recorder.event({ type: 'state', state: { selectedSessionId: 'background' } });
  recorder.event({
    type: 'runtime',
    runtime: { sessionId: 'session-b', status: 'idle', messages: [{ text: 'MUST NOT RECORD' }] },
    sessionSwitchRecording: { eventSeq: 10, invocationId: second, source: 'agent' },
  });
  const events = recorder.snapshot().events;
  const late = events.find((event) => event.eventSeq === 9);
  assert.equal(late.sampleIndex, 0);
  assert.equal(late.targetId, 'session-a');
  assert.equal(late.observedDuringSampleIndex, 1);
  assert.equal(late.snapshotSelectedId, 'session-a');
  assert.equal(late.selectedId, 'session-a');
  const background = events.find((event) => event.selectedId === 'background');
  assert.equal(background.sampleIndex, undefined);
  assert.equal(background.targetId, undefined);
  assert.equal(background.observedDuringSampleIndex, 1);
  assert.equal(events.find((event) => event.eventSeq === 10).messageCount, 1);
  assert.ok(!JSON.stringify(events).includes('MUST NOT RECORD'));
  assert.ok(events.every((event, index) => index === 0 || event.seq > events[index - 1].seq));
});

test('bounded buffer explicitly reports overflow and retains order and late entries until capacity', () => {
  const b = browser({ recording: true, capacity: 5 });
  const recorder = b.window.__sessionSwitchRecorder;
  recorder.arm('session-a', 0);
  const id = recorder.invoke('session-a');
  recorder.mark('target.raf');
  recorder.settled(id, 'ok');
  recorder.mark('overflow');
  recorder.event({ type: 'state', state: { selectedSessionId: 'session-a' } });
  const snapshot = recorder.snapshot();
  assert.equal(snapshot.events.length, 5);
  assert.equal(snapshot.dropped, 2);
  assert.equal(snapshot.events.at(-1).phase, 'invoke.settled');
  assert.deepEqual(
    Array.from(snapshot.events, (event) => event.seq),
    [1, 2, 3, 4, 5],
  );
  assert.equal(b.frames.length, 0, 'Recorder must not create a continuous rAF loop');
  assert.equal(b.timers.size, 0, 'Recorder must not add timer/heartbeat scheduling');
});

test('draft polling records bounded start/end, never the draft', () => {
  const b = browser({ recording: true });
  const recorder = b.window.__sessionSwitchRecorder;
  recorder.arm('session-a', 0);
  for (const correct of [false, false, true, true]) recorder.draftCheck(correct);
  const phases = recorder.snapshot().events.map((event) => event.phase);
  assert.equal(phases.filter((phase) => phase === 'draft-check.start').length, 1);
  assert.equal(phases.filter((phase) => phase === 'draft-check.end').length, 1);
});

test('default probe source remains frozen to the original bubble→MO→one-rAF implementation', async () => {
  const frozen = createHash('sha256')
    .update(armSessionSwitchMeasurement.toString().replaceAll(/\s+/g, ' '))
    .digest('hex');
  assert.equal(frozen, 'f36231e1073f4dde7520dac838be9556df76dc8e61a9520c695c7355a95c2345');
  const source = await fs.readFile(new URL('../scripts/test-session-ui.mjs', import.meta.url), 'utf8');
  const loop = source.slice(
    source.indexOf('for (let i = 0; i < 12; i++)'),
    source.indexOf('  const measurement ='),
  );
  assert.equal(
    (loop.match(/await page\.evaluate\(/g) ?? []).length,
    2,
    'Arm and resolve only; no extra per-switch evaluation',
  );
  assert.equal(
    (loop.match(/await page\.waitForFunction\(/g) ?? []).length,
    1,
    'Original bounded draft correctness wait',
  );
  assert.equal(
    (loop.match(/await diagnostic\(\)/g) ?? []).length,
    1,
    'Exactly one full diagnostic per switch',
  );
  assert.ok(loop.indexOf('window.switchMeasurement') < loop.indexOf('await page.waitForFunction'));
  assert.ok(loop.indexOf('await page.waitForFunction') < loop.indexOf('await diagnostic()'));
  assert.ok(!/invokeSettled|setTimeout|sleep|bootstrap|flush/.test(loop));
  assert.match(source, /info\.mode, 'reuse'/);
  assert.match(source, /info\.pid, originalPid/);
  assert.match(source, /restarted\.mode, 'restart'/);
  assert.match(source, /restarted\.pid, originalPid/);
  assert.match(source, /runtime\.crash\?\.cleanup === 'confirmed'/);
});

test('fixed plans and summary retain warmup/over-budget/late samples without comparing clocks', () => {
  assert.deepEqual(causalBlockPlan('darwin'), ['A', 'B', 'B', 'A', 'A', 'B']);
  assert.deepEqual(causalBlockPlan('win32'), ['B']);
  assert.throws(() => causalBlockPlan('linux'));
  const result = summarizeCausalBlock({
    blockId: '01-B',
    recording: true,
    snapshotErrors: [],
    samples: [
      { index: 0, warmup: true, elapsedMs: 999, targetId: 'a' },
      { index: 2, warmup: false, elapsedMs: 619.8, targetId: 'a' },
    ],
    renderer: {
      dropped: 0,
      events: [
        { sampleIndex: 2, phase: 'click.bubble', at: 10 },
        { sampleIndex: 2, phase: 'target.mo', at: 610 },
        { sampleIndex: 2, phase: 'target.raf', at: 629.8 },
        { sampleIndex: 2, phase: 'invoke.start', at: 8, invocationId: 'i' },
        { sampleIndex: 2, phase: 'invoke.settled', at: 700 },
      ],
    },
    main: { dropped: 0, events: [{ at: -999999999 }] },
  });
  assert.equal(result.sampleCount, 2);
  assert.equal(result.formalCount, 1);
  assert.equal(result.aboveBudget, 1);
  assert.equal(result.maxMs, 619.8);
  assert.equal(result.phases[0].elapsedMs, 999);
  assert.equal(result.phases[1].bubbleToMoMs, 600);
  assert.equal(result.phases[1].invokeToSettledMs, 692);
  assert.equal(result.phases[1].rafToSettledMs, 70.20000000000005);
});

function completeRecordedBlock() {
  return {
    blockId: '02-B',
    recording: true,
    snapshotErrors: [],
    samples: [{ index: 1, warmup: true, targetId: 'b', elapsedMs: 20 }],
    main: {
      dropped: 0,
      observerErrors: 0,
      events: [
        { phase: 'ipc.select.received', at: 1000, invocationId: 'new-invoke', targetId: 'b' },
        { phase: 'connect.backend.start', at: 1001, invocationId: 'new-invoke' },
        { phase: 'connect.backend.end', at: 1002, invocationId: 'new-invoke' },
        {
          phase: 'event.send',
          at: 1003,
          invocationId: 'old-invoke',
          eventSeq: 2,
          selectedId: 'b',
          snapshotSelectedId: 'a',
        },
        { phase: 'event.send.end', at: 1004, invocationId: 'old-invoke', eventSeq: 2 },
        { phase: 'event.send', at: 1005, invocationId: 'new-invoke', eventSeq: 4, runtimeId: 'b' },
        { phase: 'event.send.end', at: 1006, invocationId: 'new-invoke', eventSeq: 4 },
        { phase: 'ipc.select.end', at: 1010, invocationId: 'new-invoke', outcome: 'ok' },
      ],
    },
    renderer: {
      dropped: 0,
      events: [
        {
          phase: 'state.receive',
          at: 9,
          selectedId: 'b',
          sampleIndex: 0,
          observedDuringSampleIndex: 1,
          eventSeq: 1,
        },
        { phase: 'click.capture', at: 10, sampleIndex: 1 },
        { phase: 'invoke.start', at: 11, sampleIndex: 1, invocationId: 'new-invoke' },
        { phase: 'click.bubble', at: 12, sampleIndex: 1 },
        {
          phase: 'state.receive',
          at: 15,
          selectedId: 'b',
          sampleIndex: 0,
          observedDuringSampleIndex: 1,
          invocationId: 'old-invoke',
          snapshotSelectedId: 'a',
          saveId: 7,
          eventSeq: 2,
        },
        {
          phase: 'runtime.receive',
          at: 16,
          runtimeId: 'b',
          messageCount: 2,
          sampleIndex: 1,
          observedDuringSampleIndex: 1,
          invocationId: 'new-invoke',
          eventSeq: 4,
        },
        {
          phase: 'state.receive',
          at: 25,
          selectedId: 'b',
          sampleIndex: 1,
          observedDuringSampleIndex: 1,
          invocationId: 'new-invoke',
          snapshotSelectedId: 'b',
          saveId: 8,
          eventSeq: 3,
        },
        { phase: 'target.mo', at: 27, sampleIndex: 1 },
        { phase: 'invoke.settled', at: 30, sampleIndex: 1, invocationId: 'new-invoke', outcome: 'ok' },
        { phase: 'target.raf', at: 32, sampleIndex: 1 },
        { phase: 'draft-check.start', at: 33, sampleIndex: 1 },
        { phase: 'draft-check.end', at: 34, sampleIndex: 1 },
        { phase: 'diagnostics.start', at: 35, sampleIndex: 1 },
        { phase: 'diagnostics.end', at: 36, sampleIndex: 1 },
      ],
    },
  };
}

test('observed target state can belong to an older save without rewriting its ownership', () => {
  const result = summarizeCausalBlock(completeRecordedBlock());
  assert.equal(result.observationValid, true);
  assert.deepEqual(result.phases[0].missingAssociations, []);
  assert.equal(result.phases[0].targetStateReceiptToMoMs, 12);
  assert.equal(result.phases[0].firstTargetStateReceipt.eventSeq, 2);
  assert.equal(result.phases[0].firstTargetStateReceipt.invocationId, 'old-invoke');
  assert.equal(result.phases[0].firstTargetStateReceipt.snapshotSelectedId, 'a');
  assert.equal(result.phases[0].firstTargetStateReceipt.selectedId, 'b');
});

test('first target state can come from main.selection before persistence without a save owner', () => {
  const block = completeRecordedBlock();
  const send = block.main.events.find((event) => event.phase === 'event.send' && event.eventSeq === 2);
  const end = block.main.events.find((event) => event.phase === 'event.send.end' && event.eventSeq === 2);
  const receipt = block.renderer.events.find(
    (event) => event.phase === 'state.receive' && event.eventSeq === 2,
  );
  for (const event of [send, end, receipt]) {
    event.invocationId = 'new-invoke';
    event.source = 'main.selection';
    delete event.saveId;
    delete event.snapshotSelectedId;
  }
  receipt.sampleIndex = 1;
  block.main.events.splice(-1, 0, {
    phase: 'store.write.end',
    at: 1009,
    invocationId: 'new-invoke',
    saveId: 8,
    source: 'main.save',
    snapshotSelectedId: 'b',
    outcome: 'ok',
  });
  const result = summarizeCausalBlock(block);
  assert.equal(result.observationValid, true);
  assert.deepEqual(result.phases[0].missingAssociations, []);
  assert.equal(result.phases[0].firstTargetStateReceipt.eventSeq, 2);
  assert.equal(result.phases[0].firstTargetStateReceipt.invocationId, 'new-invoke');
  assert.equal(result.phases[0].firstTargetStateReceipt.saveId, undefined);
  assert.equal(result.phases[0].firstTargetStateReceipt.snapshotSelectedId, undefined);
  assert.equal(result.phases[0].targetStateReceiptToMoMs, 12);
});

test('overflow and observer failure invalidate analysis without dropping the raw samples', () => {
  const block = completeRecordedBlock();
  assert.equal(summarizeCausalBlock(block).observationValid, true);
  for (const invalid of [
    { ...block, renderer: { ...block.renderer, dropped: 1 } },
    { ...block, main: { ...block.main, dropped: 1 } },
    { ...block, main: { ...block.main, observerErrors: 1 } },
    { ...block, snapshotErrors: ['snapshot failed'] },
  ]) {
    const summary = summarizeCausalBlock(invalid);
    assert.equal(summary.observationValid, false);
    assert.equal(summary.phases[0].elapsedMs, 20);
  }
});

test('zero drops cannot hide missing associations, duplicate invocations, or reordered boundaries', () => {
  const missingMain = completeRecordedBlock();
  missingMain.main.events = [];
  const missingRenderer = completeRecordedBlock();
  missingRenderer.renderer.events = [];
  const missingSend = completeRecordedBlock();
  missingSend.main.events = missingSend.main.events.filter((event) => event.eventSeq !== 2);
  const duplicate = completeRecordedBlock();
  duplicate.renderer.events.push({
    phase: 'invoke.start',
    at: 50,
    invocationId: 'new-invoke',
    sampleIndex: 2,
  });
  const reordered = completeRecordedBlock();
  reordered.renderer.events.find((event) => event.phase === 'target.raf').at = 26;
  for (const block of [missingMain, missingRenderer, missingSend, duplicate, reordered]) {
    const summary = summarizeCausalBlock(block);
    assert.equal(summary.observationValid, false);
    assert.equal(summary.phases[0].recordingValid, false);
    assert.ok(summary.phases[0].missingAssociations.length > 0);
    assert.equal(summary.phases[0].elapsedMs, 20);
  }
});

test('selected state after DOM and empty samples are invalid; late runtime remains valid evidence', () => {
  const lateState = completeRecordedBlock();
  lateState.renderer.events = lateState.renderer.events.filter((event) => event.eventSeq !== 3);
  lateState.renderer.events.find((event) => event.phase === 'state.receive' && event.eventSeq === 2).at = 100;
  const stateSummary = summarizeCausalBlock(lateState);
  assert.equal(stateSummary.observationValid, false);
  assert.ok(stateSummary.phases[0].missingAssociations.includes('target selected state before DOM'));

  const lateRuntime = completeRecordedBlock();
  lateRuntime.renderer.events.find((event) => event.phase === 'runtime.receive').at = 29;
  const runtimeSummary = summarizeCausalBlock(lateRuntime);
  assert.equal(runtimeSummary.observationValid, true);
  assert.equal(runtimeSummary.phases[0].runtimeReceiptBeforeMo, false);
  assert.equal(runtimeSummary.phases[0].targetRuntimeReceiptToMoMs, null);
  assert.equal(runtimeSummary.phases[0].moToRuntimeReceiptMs, 2);
  assert.equal(runtimeSummary.phases[0].mainBackendMs, 1);
  assert.equal(runtimeSummary.phases[0].mainIpcMs, 10);
  assert.equal(runtimeSummary.blockComplete, false);

  const empty = completeRecordedBlock();
  empty.samples = [];
  empty.renderer.events = [];
  empty.main.events = [];
  const emptySummary = summarizeCausalBlock(empty);
  assert.equal(emptySummary.observationValid, false);
  assert.equal(emptySummary.blockComplete, false);
});
