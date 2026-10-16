/** Runs in the renderer via locator.evaluate; all points use that renderer's clock. */
export function installSessionSwitchProbe(button, { sessionId, marker, timeoutMs = 10000 }) {
  if (window.__sessionSwitchDiagnostic) throw new Error('A session switch probe is already installed');
  window.switchMeasurement = new Promise((resolve, reject) => {
    const points = {};
    const snapshot = { sessionId, clockDomain: 'renderer-performance', points };
    window.switchMeasurementSnapshot = snapshot;
    let switchId, outcome, frame;
    const cleanup = () => {
      clearTimeout(timeout);
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      unsubscribe();
      document.removeEventListener('click', capture, true);
      document.removeEventListener('click', bubble);
      if (window.__sessionSwitchDiagnostic === observe) delete window.__sessionSwitchDiagnostic;
    };
    const finish = () => {
      // DOM observation and the next rAF callback may precede invoke completion.
      if (points.rafCallback === undefined || points.invokeSettled === undefined) return;
      cleanup();
      snapshot.outcome = outcome;
      resolve(snapshot);
    };
    const capture = (event) => {
      if (points.clickCapture === undefined && button.contains(event.target))
        points.clickCapture = performance.now();
    };
    const bubble = (event) => {
      if (points.legacyClickBubble === undefined && button.contains(event.target))
        points.legacyClickBubble = performance.now();
    };
    const observe = (point) => {
      if (point.sessionId !== sessionId || points.clickCapture === undefined) return;
      if (point.phase === 'invoke') {
        if (switchId) {
          cleanup();
          reject(new Error('More than one selection invocation matched this click'));
          return;
        }
        switchId = point.switchId;
        snapshot.switchId = switchId;
      }
      if (point.switchId !== switchId) return;
      points[point.phase] = point.at;
      if (point.phase === 'invokeSettled') {
        outcome = point.outcome;
        snapshot.outcome = outcome;
        if (outcome === 'rejected') {
          cleanup();
          reject(new Error('Session selection rejected: ' + JSON.stringify(snapshot)));
          return;
        }
      }
      finish();
    };
    const unsubscribe = window.desktop.onEvent((event) => {
      if (
        event.type !== 'runtimePatch' ||
        !switchId ||
        event.switchId !== switchId ||
        event.patch.sessionId !== sessionId
      )
        return;
      points.targetRuntimeEventReceived ??= performance.now();
      if (JSON.stringify(event.patch.messages).includes(marker))
        points.targetMessagesEventReceived ??= performance.now();
    });
    const observer = new MutationObserver(() => {
      if (
        points.clickCapture === undefined ||
        points.targetDomObserved !== undefined ||
        !document.querySelector('.thread')?.textContent.includes(marker)
      )
        return;
      points.targetDomObserved = performance.now();
      observer.disconnect();
      frame = requestAnimationFrame(() => {
        points.rafCallback = performance.now();
        finish();
      });
    });
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Session switch probe timed out: ' + JSON.stringify({ switchId, sessionId, points })));
    }, timeoutMs);
    document.addEventListener('click', capture, true);
    document.addEventListener('click', bubble);
    observer.observe(document.querySelector('.thread'), {
      subtree: true,
      childList: true,
      characterData: true,
    });
    window.__sessionSwitchDiagnostic = observe;
  });
  // Clicking can itself take time; retain the rejection for the later awaited read.
  void window.switchMeasurement.catch(() => {});
}

/** Never subtract timestamps from different processes. Intervals may overlap. */
export function summarizeSessionSwitchProbe(renderer, main) {
  if (renderer.switchId !== main.switchId || renderer.sessionId !== main.sessionId)
    throw new Error('Session switch trace identity mismatch');
  if (renderer.clockDomain !== 'renderer-performance' || main.clockDomain !== 'main-performance')
    throw new Error('Unexpected session switch clock domain');
  const r = renderer.points,
    m = main.points;
  for (const [points, required] of [
    [r, ['clickCapture', 'legacyClickBubble', 'invoke', 'invokeSettled', 'targetDomObserved', 'rafCallback']],
    [
      m,
      [
        'ipcReceived',
        'terminalGuardStarted',
        'terminalGuardFinished',
        'handlerStarted',
        'connectEnqueued',
        'connectStarted',
        'backendStarted',
        'backendFinished',
        'saveAndStateStarted',
        'saveAndStateFinished',
        'handlerFinished',
      ],
    ],
  ])
    if (required.some((name) => !Number.isFinite(points[name])))
      throw new Error('Incomplete session switch timing points');
  // Only enforce causal order within one clock; DOM/rAF and invoke settlement can overlap.
  const ordered = (points, names) =>
    names.every((name, index) => index === 0 || points[names[index - 1]] <= points[name]);
  if (
    !ordered(r, ['clickCapture', 'invoke', 'invokeSettled']) ||
    !ordered(r, ['clickCapture', 'legacyClickBubble', 'rafCallback']) ||
    !ordered(r, ['clickCapture', 'targetDomObserved', 'rafCallback']) ||
    !ordered(m, [
      'ipcReceived',
      'terminalGuardStarted',
      'terminalGuardFinished',
      'handlerStarted',
      'connectEnqueued',
      'connectStarted',
      'backendStarted',
      'backendFinished',
      'saveAndStateStarted',
      'saveAndStateFinished',
      'handlerFinished',
    ])
  )
    throw new Error('Non-monotonic session switch timing points');
  const relative = (points, origin) =>
    Object.fromEntries(Object.entries(points).map(([name, at]) => [name, at - origin]));
  return {
    switchId: main.switchId,
    renderer: {
      clockDomain: renderer.clockDomain,
      relativeTo: 'clickCapture',
      pointsMs: relative(r, r.clickCapture),
      outcome: renderer.outcome,
    },
    main: {
      clockDomain: main.clockDomain,
      relativeTo: 'ipcReceived',
      pointsMs: relative(m, m.ipcReceived),
      outcome: main.outcome,
    },
    captureToTargetDomObservedMs: r.targetDomObserved - r.clickCapture,
    captureToRafCallbackMs: r.rafCallback - r.clickCapture,
    legacyBubbleToRafCallbackMs: r.rafCallback - r.legacyClickBubble,
    invokeToSettledMs: r.invokeSettled - r.invoke,
    queueWaitMs: m.connectStarted - m.connectEnqueued,
    backendMs: m.backendFinished - m.backendStarted,
    terminalGuardMs: m.terminalGuardFinished - m.terminalGuardStarted,
    saveAndStateMs: m.saveAndStateFinished - m.saveAndStateStarted,
  };
}
