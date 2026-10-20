// These functions are serialized into the renderer by the acceptance runner.
// Keep them self-contained: all elapsed values use that renderer's performance clock.
export function sessionSelectionSnapshot({
  id,
  projectId,
  cwd,
  title,
  draft,
  marker,
  markers,
  modelId,
  requireConnection,
  requireModels = false,
}) {
  const state = window.sessionUiState;
  const runtime = window.sessionUiRuntimes?.get(id);
  const input = document.querySelector('textarea[aria-label="任务输入"]');
  const send = document.querySelector('button[aria-label="发送任务"]');
  const model = document.querySelector('button[aria-label="选择模型"]');
  const currentOption = document.querySelector('.model-picker [role="option"][aria-current="true"]');
  const optionId = currentOption?.querySelector('.model-name small')?.textContent;
  const text = document.querySelector('.thread')?.textContent ?? '';
  const targetHistoryPresent = text.includes(marker);
  const foreignHistoryPresent = markers.some((other) => other !== marker && text.includes(other));
  const displayedSelection = Boolean(
    document.querySelector('.workspace-title h1')?.textContent === title &&
    document.querySelector(`.session-row[data-session-id="${id}"] > button`)?.getAttribute('aria-current') ===
      'page',
  );
  const authoritativeSelection = Boolean(
    state?.selectedSessionId === id && state?.selectedProjectId === projectId && displayedSelection,
  );
  const runtimeOwned = !runtime || runtime.sessionId === id;
  const runtimeCwdMatches = !runtime || runtime.cwd === cwd;
  const runtimeReady = Boolean(
    runtime?.sessionId === id &&
    runtime.cwd === cwd &&
    runtime.connected &&
    runtime.status === 'idle' &&
    runtime.model?.id === modelId,
  );
  const modelCatalogReady = Boolean(
    runtime?.sessionId === id &&
    runtime.cwd === cwd &&
    runtime.modelsLoaded &&
    !runtime.modelsLoading &&
    runtime.model?.id === modelId &&
    runtime.models?.some((item) => item.id === modelId && item.provider === runtime.model.provider) &&
    currentOption &&
    !currentOption.disabled &&
    (optionId === modelId ||
      (!optionId && currentOption.querySelector('.model-name')?.textContent === runtime.model.name)),
  );
  const draftRestored = Boolean(input && input.value === draft && draft.trim());
  const sendPending = Boolean(send?.querySelector('.spin'));
  const sendEnabled = Boolean(send && !send.disabled);
  const modelEnabled = Boolean(model && !model.disabled);
  const sendGateReady = Boolean(input && !input.disabled && sendEnabled && !sendPending && modelEnabled);
  return {
    selectedSessionId: state?.selectedSessionId ?? null,
    selectedProjectId: state?.selectedProjectId ?? null,
    revision: window.sessionUiRevision ?? 0,
    displayedSelection,
    authoritativeSelection,
    targetHistoryPresent,
    foreignHistoryPresent,
    draftRestored,
    sendEnabled,
    sendPending,
    modelEnabled,
    sendGateReady,
    runtimeOwned,
    runtimeCwdMatches,
    runtimeReady,
    modelCatalogReady,
    runtime: runtime
      ? {
          sessionId: runtime.sessionId ?? null,
          connected: runtime.connected,
          status: runtime.status,
          modelId: runtime.model?.id ?? null,
          modelsLoaded: runtime.modelsLoaded ?? false,
          modelsLoading: runtime.modelsLoading ?? false,
          cwd: runtime.cwd ?? null,
        }
      : null,
    complete: Boolean(
      authoritativeSelection &&
      targetHistoryPresent &&
      !foreignHistoryPresent &&
      draftRestored &&
      sendGateReady &&
      runtimeOwned &&
      runtimeCwdMatches &&
      (!requireModels || modelCatalogReady) &&
      (!requireConnection || runtimeReady),
    ),
  };
}

export function sessionSelectionReady(expected) {
  return window.sessionUiSnapshot(expected).complete;
}

// Observe one click, the initial navigation, or an ordered rapid-click sequence.
// Earlier rapid requests remain attributed as superseded, never as completed switches.
export function observeSessionSelections({ requests, startMode = 'click', timeoutMs = 30000 }) {
  window.cancelSessionSwitchMeasurement?.();
  const installedAtMs = performance.now();
  const historyOwners = [...new Map(requests.map(({ expected }) => [expected.id, expected])).values()];
  const outcomes = [];
  let active,
    nextRequest = 0,
    frame,
    timeout,
    disposed = false;
  let resolveMeasurement, rejectMeasurement;
  const measurement = new Promise((resolve, reject) => {
    resolveMeasurement = resolve;
    rejectMeasurement = reject;
  });
  // A failed Playwright action must not create an unhandled renderer rejection.
  void measurement.catch(() => {});
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timeout);
    cancelAnimationFrame(frame);
    observer.disconnect();
    unsubscribe();
    document.removeEventListener('click', click, true);
    window.cancelSessionSwitchMeasurement = undefined;
  };
  const result = (outcome) => ({
    requestId: active.spec.requestId,
    scenario: active.spec.scenario,
    phase: active.spec.phase ?? 'browse',
    activation:
      startMode === 'navigation'
        ? 'initial navigation; no click'
        : (active.spec.activation ?? 'Playwright pointer click'),
    sessionId: active.spec.expected.id,
    targetTitle: active.spec.expected.title,
    expectedModelId: active.spec.expected.modelId,
    targetHistoryMarker: active.spec.expected.marker,
    requireConnection: active.spec.expected.requireConnection,
    requireModels: active.spec.expected.requireModels ?? false,
    targetProjectId: active.spec.projectId ?? null,
    targetCwd: active.spec.expected.cwd,
    fromSessionId: active.initial.selectedSessionId,
    fromProjectId: active.initial.selectedProjectId,
    startMode,
    clock: 'renderer performance.now',
    startAtMs: active.started,
    observerInstalledAtMs: installedAtMs,
    targetHistoryAlreadyPresentAtStart: active.initial.targetHistoryPresent,
    runtimeAvailabilityAtStart: active.initial.runtimeReady ? 'already-ready' : 'not-ready',
    runtimeAtStart: active.initial.runtime,
    baselineRevision: active.initial.revision,
    messageDomMs: active.messageDomMs ?? null,
    messageDomScope: 'first target preview after activation; not final request completion',
    nextAnimationFrameMs: active.nextAnimationFrameMs ?? null,
    authoritativeSelectionMs: active.authoritativeSelectionMs ?? null,
    draftRestoredMs: active.draftRestoredMs ?? null,
    sendGateReadyMs: active.sendGateReadyMs ?? null,
    runtimeReadyMs: active.runtimeReadyMs ?? null,
    modelCatalogReadyMs: active.modelCatalogReadyMs ?? null,
    actionCompletedMs: active.actionCompletedMs ?? null,
    selectionSettledMs: active.selectionSettledMs ?? null,
    otherHistoryVisible: active.otherHistoryVisible,
    firstHistoryMismatch: active.firstHistoryMismatch ?? null,
    unsafeSendGateObserved: active.unsafeSendGateObserved,
    unsafeModelGateObserved: active.unsafeModelGateObserved,
    selectionRegressed: active.selectionRegressed,
    firstSelectionRegression: active.firstSelectionRegression ?? null,
    observationMs: performance.now() - active.started,
    outcome,
    settlement: window.sessionUiSnapshot(active.spec.expected),
  });
  const finish = () => {
    outcomes.push(result('completed'));
    cleanup();
    resolveMeasurement(outcomes);
  };
  const sample = (isFrame = false) => {
    if (!active || disposed || !active.eligible) return;
    const snapshot = window.sessionUiSnapshot(active.spec.expected);
    const elapsed = performance.now() - active.started;
    // A target-ID state event newer than the click's baseline is necessary for
    // browsing completion, even when rapid A→B→A ends on its original ID.
    const revisionConfirmed =
      startMode !== 'click' ||
      active.spec.phase === 'explicit-model-open' ||
      snapshot.revision > active.initial.revision;
    if (active.runtimeReadyMs === undefined && snapshot.runtimeReady) active.runtimeReadyMs = elapsed;
    if (active.spec.expected.requireModels && snapshot.modelCatalogReady)
      active.modelCatalogReadyMs ??= elapsed;
    const actionCompletionAtMs = window.sessionUiActionCompletions?.get(active.spec.requestId);
    if (actionCompletionAtMs !== undefined) active.actionCompletedMs = actionCompletionAtMs - active.started;
    const actionCompleted = startMode !== 'explicit-ipc' || active.actionCompletedMs !== undefined;
    if (active.messageDomMs === undefined && snapshot.targetHistoryPresent) {
      active.messageDomMs = elapsed;
      active.historyFramePending = true;
    }
    // In A→B→A the first A preview may belong to the superseded first request.
    // Coherent, locked B content is then a legitimate intermediate selection,
    // not foreign content under A. Judge history against the displayed owner.
    // Public state can arrive before React commits, so it is not the DOM owner.
    for (const owner of historyOwners) {
      const displayed = owner.id === active.spec.expected.id ? snapshot : window.sessionUiSnapshot(owner);
      if (displayed.displayedSelection && displayed.foreignHistoryPresent) {
        active.otherHistoryVisible = true;
        active.firstHistoryMismatch ??= {
          elapsedMs: elapsed,
          displayedSessionId: owner.id,
          snapshot: displayed,
        };
      }
    }
    if (snapshot.sendPending) active.sawPending = true;
    const wrongActionOwner =
      !snapshot.authoritativeSelection ||
      !snapshot.draftRestored ||
      !snapshot.runtimeOwned ||
      !snapshot.runtimeCwdMatches ||
      (snapshot.runtime?.connected && snapshot.runtime.modelId !== active.spec.expected.modelId);
    if (
      (isFrame || active.sawPending) &&
      snapshot.selectedSessionId !== null &&
      snapshot.sendEnabled &&
      !snapshot.sendPending &&
      wrongActionOwner
    )
      active.unsafeSendGateObserved = true;
    if (
      (isFrame || active.sawPending) &&
      snapshot.selectedSessionId !== null &&
      snapshot.modelEnabled &&
      wrongActionOwner
    )
      active.unsafeModelGateObserved = true;
    if (revisionConfirmed && snapshot.authoritativeSelection) {
      active.authoritativeSelectionMs ??= elapsed;
      if (snapshot.draftRestored) active.draftRestoredMs ??= elapsed;
      if (snapshot.sendGateReady) active.sendGateReadyMs ??= elapsed;
    }
    const previouslySettled = active.selectionSettledMs !== undefined;
    if (previouslySettled && !snapshot.complete) {
      active.selectionRegressed = true;
      active.firstSelectionRegression ??= { elapsedMs: elapsed, snapshot };
    }
    if (revisionConfirmed && actionCompleted && snapshot.complete) active.selectionSettledMs ??= elapsed;
    // Recheck all gates on the resolving sample. Earlier correct history or
    // readiness must never allow later foreign content or a pending action.
    if (
      nextRequest === requests.length &&
      active.nextAnimationFrameMs !== undefined &&
      previouslySettled &&
      isFrame &&
      revisionConfirmed &&
      actionCompleted &&
      snapshot.complete
    )
      finish();
  };
  const pollFrame = () => {
    if (active?.historyFramePending) {
      // This is the next rAF after DOM observation, never a screen-paint claim.
      active.nextAnimationFrameMs = performance.now() - active.started;
      active.historyFramePending = false;
    }
    sample(true);
    if (!disposed) frame = requestAnimationFrame(pollFrame);
  };
  const begin = (spec) => {
    if (active) outcomes.push(result('superseded'));
    const initial = window.sessionUiSnapshot(spec.expected);
    const request = {
      spec,
      initial,
      started: startMode === 'navigation' ? 0 : performance.now(),
      eligible: startMode !== 'click',
      runtimeReadyMs: initial.runtimeReady && startMode !== 'navigation' ? 0 : undefined,
      otherHistoryVisible: false,
      unsafeSendGateObserved: false,
      unsafeModelGateObserved: false,
      selectionRegressed: false,
    };
    active = request;
    nextRequest++;
    // Do not interpret the old DOM in the click capture phase as completed UI.
    queueMicrotask(() => {
      if (!disposed && active === request) request.eligible = true;
    });
    if (startMode !== 'click') sample();
  };
  const click = (event) => {
    const spec = requests[nextRequest];
    if (spec && event.target.closest(spec.triggerSelector)) begin(spec);
  };
  const observer = new MutationObserver(() => sample());
  const unsubscribe = window.desktop.onEvent(() => sample());
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  document.addEventListener('click', click, true);
  timeout = setTimeout(() => {
    const partial = active ? result('timed-out') : null;
    cleanup();
    rejectMeasurement(new Error(`Session measurement timed out: ${JSON.stringify({ outcomes, partial })}`));
  }, timeoutMs);
  window.cancelSessionSwitchMeasurement = (reason = 'Session measurement cancelled') => {
    cleanup();
    rejectMeasurement(new Error(reason));
  };
  window.switchMeasurement = measurement;
  if (startMode !== 'click') begin(requests[0]);
  frame = requestAnimationFrame(pollFrame);
}
