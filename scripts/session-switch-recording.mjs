/**
 * Temporary opt-in recorder, injected by the acceptance runner only. No app import,
 * extra IPC/subscription, continuous rAF, message text, drafts, or filesystem paths.
 * Timestamps belong to renderer performance.now; never subtract main timestamps.
 */
export function installSessionSwitchRecorder({ capacity = 12000 } = {}) {
  const events = [];
  const invocations = new Map();
  let active;
  let sequence = 0;
  let dropped = 0;
  const append = (phase, detail = {}, at = performance.now(), sample = active) => {
    const event = {
      seq: ++sequence,
      at,
      phase,
      ...(sample && { sampleIndex: sample.index, targetId: sample.targetId }),
      ...detail,
    };
    if (events.length < capacity) events.push(event);
    else dropped++;
  };
  const mark = (phase, detail, at) => append(phase, detail, at);
  const onCapture = () => {
    if (!active || active.captured) return;
    active.captured = true;
    mark('click.capture', { focused: document.hasFocus(), visibility: document.visibilityState });
  };
  const onFocus = () => mark('window.focus');
  const onBlur = () => mark('window.blur');
  const onVisibility = () => mark('document.visibility', { visibility: document.visibilityState });
  document.addEventListener('click', onCapture, true);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  let longTaskObserver;
  let longTasksSupported = false;
  const recordLongTasks = (entries) => {
    for (const entry of entries)
      // Delivery can be delayed: start/duration are the actual renderer-clock interval.
      append('longtask', { start: entry.startTime, duration: entry.duration }, performance.now(), null);
  };
  if (
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes?.includes('longtask')
  ) {
    longTaskObserver = new PerformanceObserver((list) => recordLongTasks(list.getEntries()));
    longTaskObserver.observe({ type: 'longtask', buffered: false });
    longTasksSupported = true;
  }
  window.__sessionSwitchRecorder = {
    arm(targetId, index) {
      active = { targetId, index, captured: false, draftStarted: false, draftEnded: false };
      mark('sample.arm', { warmup: index < 2 });
    },
    mark,
    finishSamples() {
      mark('samples.end');
      active = undefined;
    },
    invoke(targetId) {
      const invocationId = crypto.randomUUID();
      // Twelve fixture switches; keep late-settlement correlation independently of active.
      if (invocations.size < capacity)
        invocations.set(invocationId, active ? { index: active.index, targetId: active.targetId } : null);
      else dropped++;
      append('invoke.start', { invocationId, targetId });
      return invocationId;
    },
    settled(invocationId, outcome) {
      append(
        'invoke.settled',
        { invocationId, outcome },
        performance.now(),
        invocations.get(invocationId) ?? null,
      );
    },
    event(event) {
      const metadata = event.sessionSwitchRecording;
      const detail = metadata
        ? {
            eventSeq: metadata.eventSeq,
            invocationId: metadata.invocationId,
            saveId: metadata.saveId,
            source: metadata.source,
            snapshotSelectedId: metadata.snapshotSelectedId,
          }
        : {};
      const sample = metadata?.invocationId ? (invocations.get(metadata.invocationId) ?? null) : null;
      if (active) detail.observedDuringSampleIndex = active.index;
      if (event.type === 'state') {
        append(
          'state.receive',
          { ...detail, selectedId: event.state.selectedSessionId },
          performance.now(),
          sample,
        );
      } else if (event.type === 'runtime' || event.type === 'runtimePatch') {
        const runtime = event.type === 'runtime' ? event.runtime : event.patch;
        append(
          'runtime.receive',
          {
            ...detail,
            runtimeId: runtime.sessionId,
            messageCount: event.type === 'runtime' ? runtime.messages.length : runtime.messageCount,
            eventType: event.type,
            status: runtime.status,
          },
          performance.now(),
          sample,
        );
      }
    },
    reactEffect(selectedId, runtimeId, messageCount) {
      append('react.messages-effect', { selectedId, runtimeId, messageCount });
    },
    draftCheck(correct) {
      if (!active) return;
      if (!active.draftStarted) {
        active.draftStarted = true;
        mark('draft-check.start');
      }
      if (correct && !active.draftEnded) {
        active.draftEnded = true;
        mark('draft-check.end');
      }
    },
    snapshot() {
      if (longTaskObserver) recordLongTasks(longTaskObserver.takeRecords());
      return {
        version: 1,
        clock: 'renderer.performance.now',
        timeOrigin: performance.timeOrigin,
        capacity,
        dropped,
        longTasksSupported,
        note: 'target.raf is a callback boundary, not proof of paint. react.messages-effect is a passive effect observation, not an exact commit timestamp. Correlate clocks by IDs only',
        events: events.slice(),
      };
    },
  };
  mark('recorder.install', { focused: document.hasFocus(), visibility: document.visibilityState });
}
