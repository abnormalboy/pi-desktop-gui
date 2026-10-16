import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionSwitchProvenance } from './session-switch-provenance.mjs';

/** Predetermined order: no retries, extra switches, sleeps, or adaptive stopping. */
export function causalBlockPlan(platform) {
  if (platform === 'darwin') return ['A', 'B', 'B', 'A', 'A', 'B'];
  if (platform === 'win32') return ['B'];
  throw new Error('The causal experiment is scoped to macOS and Windows');
}

export function summarizeCausalBlock(block) {
  const events = block.renderer?.events ?? [];
  const formal = block.samples.filter((sample) => !sample.warmup);
  const summary = {
    blockId: block.blockId,
    recording: block.recording,
    error: block.error ?? null,
    snapshotErrors: block.snapshotErrors,
    provenance: block.provenance,
    blockComplete:
      block.samples.length === 12 &&
      new Set(block.samples.map((sample) => sample.index)).size === 12 &&
      block.samples.every(
        (sample) => sample.index >= 0 && sample.index < 12 && sample.warmup === sample.index < 2,
      ),
    observationValid:
      block.samples.length > 0 &&
      !block.error &&
      !block.snapshotErrors?.length &&
      (!block.recording ||
        Boolean(
          block.renderer &&
          block.main &&
          block.renderer.dropped === 0 &&
          block.main.dropped === 0 &&
          block.main.observerErrors === 0,
        )),
    sampleCount: block.samples.length,
    formalCount: formal.length,
    aboveBudget: formal.filter((sample) => sample.elapsedMs > 200).length,
    maxMs: formal.length ? Math.max(...formal.map((sample) => sample.elapsedMs)) : null,
    rendererDropped: block.renderer?.dropped ?? null,
    mainDropped: block.main?.dropped ?? null,
    mainObserverErrors: block.main?.observerErrors ?? null,
    phases: block.samples.map((sample) => {
      const own = events.filter((event) => event.sampleIndex === sample.index);
      const first = (phase, predicate = () => true) =>
        own.find((event) => event.phase === phase && predicate(event));
      const delta = (end, start) => (end && start ? end.at - start.at : null);
      const capture = first('click.capture');
      const bubble = first('click.bubble');
      const invoke = first('invoke.start');
      const settled = first('invoke.settled');
      // Visibility can be caused by an old save emitting CURRENT selected state.
      // Keep its original ownership and choose the first receipt observed after this click.
      const receipts = events.filter(
        (event) => event.observedDuringSampleIndex === sample.index && capture && event.at >= capture.at,
      );
      const state = receipts.find(
        (event) => event.phase === 'state.receive' && event.selectedId === sample.targetId,
      );
      const runtime = receipts.find(
        (event) =>
          event.phase === 'runtime.receive' && event.runtimeId === sample.targetId && event.messageCount > 0,
      );
      const mo = first('target.mo');
      const raf = first('target.raf');
      const main = (block.main?.events ?? []).filter(
        (event) => invoke?.invocationId && event.invocationId === invoke.invocationId,
      );
      const mainFirst = (phase) => main.find((event) => event.phase === phase);
      const missing = [];
      const ordered = (items, reason) => {
        if (
          items.some((item) => !item || !Number.isFinite(item.at)) ||
          items.some((item, index) => index > 0 && item.at < items[index - 1].at)
        )
          missing.push(reason);
      };
      if (block.recording) {
        const id = invoke?.invocationId;
        if (
          !id ||
          events.filter((event) => event.phase === 'invoke.start' && event.invocationId === id).length !==
            1 ||
          own.filter((event) => event.phase === 'invoke.start').length !== 1
        )
          missing.push('unique invocation');
        ordered([capture, invoke, bubble, mo, raf], 'renderer click/invoke/MO/rAF boundaries');
        ordered([invoke, settled], 'renderer invocation settlement');
        if (settled?.outcome !== 'ok' || settled?.invocationId !== id)
          missing.push('renderer invocation success');
        ordered([capture, state, mo], 'target selected state before DOM');
        ordered(
          [
            raf,
            first('draft-check.start'),
            first('draft-check.end'),
            first('diagnostics.start'),
            first('diagnostics.end'),
          ],
          'renderer draft/diagnostics boundaries',
        );
        const received = mainFirst('ipc.select.received');
        const completed = mainFirst('ipc.select.end');
        ordered(
          [received, mainFirst('connect.backend.start'), mainFirst('connect.backend.end'), completed],
          'main IPC/backend boundaries',
        );
        if (
          completed?.outcome !== 'ok' ||
          received?.targetId !== sample.targetId ||
          main.filter((event) => event.phase === 'ipc.select.received').length !== 1 ||
          main.filter((event) => event.phase === 'ipc.select.end').length !== 1
        )
          missing.push('main invocation success/target');
        for (const [kind, receipt] of [
          ['state', state],
          ['runtime', runtime],
        ]) {
          const sends = (block.main?.events ?? []).filter(
            (event) => event.phase === 'event.send' && receipt && event.eventSeq === receipt.eventSeq,
          );
          const send = sends[0];
          const end = (block.main?.events ?? []).find(
            (event) => event.phase === 'event.send.end' && receipt && event.eventSeq === receipt.eventSeq,
          );
          if (
            !receipt ||
            !Number.isInteger(receipt.eventSeq) ||
            sends.length !== 1 ||
            send?.invocationId !== receipt.invocationId ||
            (kind === 'state' ? send?.selectedId : send?.runtimeId) !== sample.targetId
          )
            missing.push(`target ${kind} receipt/send association`);
          ordered([send, end], `main ${kind} send boundaries`);
        }
      }
      return {
        ...sample,
        recordingValid: block.recording ? missing.length === 0 : null,
        missingAssociations: missing,
        invocationId: invoke?.invocationId,
        firstTargetStateReceipt: state
          ? {
              eventSeq: state.eventSeq,
              invocationId: state.invocationId,
              saveId: state.saveId,
              snapshotSelectedId: state.snapshotSelectedId,
              selectedId: state.selectedId,
              at: state.at,
            }
          : null,
        firstTargetRuntimeReceipt: runtime
          ? { eventSeq: runtime.eventSeq, invocationId: runtime.invocationId, at: runtime.at }
          : null,
        captureToInvokeMs: delta(invoke, capture),
        bubbleToMoMs: delta(mo, bubble),
        moToRafMs: delta(raf, mo),
        targetStateReceiptToMoMs: delta(mo, state),
        runtimeReceiptBeforeMo: runtime && mo ? runtime.at <= mo.at : null,
        targetRuntimeReceiptToMoMs: runtime && mo && runtime.at <= mo.at ? delta(mo, runtime) : null,
        moToRuntimeReceiptMs: runtime && mo && runtime.at > mo.at ? delta(runtime, mo) : null,
        mainBackendMs: delta(mainFirst('connect.backend.end'), mainFirst('connect.backend.start')),
        mainIpcMs: delta(mainFirst('ipc.select.end'), mainFirst('ipc.select.received')),
        mainTerminalMs: delta(mainFirst('ipc.terminal.end'), mainFirst('ipc.terminal.start')),
        mainStoreFlushMs: delta(mainFirst('connect.storeFlush.end'), mainFirst('connect.storeFlush.start')),
        mainExclusiveWaitMs: delta(
          mainFirst('connect.exclusive.start'),
          mainFirst('connect.exclusive.enqueue'),
        ),
        invokeToSettledMs: delta(settled, invoke),
        rafToSettledMs: delta(settled, raf),
        rafToDraftReadyMs: delta(first('draft-check.end'), raf),
        diagnosticsMs: delta(first('diagnostics.end'), first('diagnostics.start')),
      };
    }),
  };
  if (block.recording && summary.phases.some((sample) => !sample.recordingValid))
    summary.observationValid = false;
  return summary;
}

export async function runCausalBlocks() {
  const order = causalBlockPlan(process.platform);
  const directory = 'test-results/session-switch-causal';
  await fs.mkdir(directory, { recursive: true });
  const summary = {
    version: 1,
    platform: process.platform,
    architecture: process.arch,
    order,
    budgetMs: 200,
    provenance: sessionSwitchProvenance(),
    sameBuildAcrossBlocks: true,
    note: 'A=recorder off, B=passive recorder on. Each block is a new process and fixture with 2 warmup + 10 formal switches. All differences are same-clock; rAF is not proof of paint.',
    blocks: [],
  };
  let failed = false;
  for (const [index, mode] of order.entries()) {
    const blockId = `${String(index + 1).padStart(2, '0')}-${mode}`;
    const args = ['--import', 'tsx', 'scripts/test-session-ui.mjs', `--session-switch-block=${blockId}`];
    if (process.argv.includes('--packaged')) args.push('--packaged');
    if (mode === 'B') args.push('--record-session-switch');
    const artifact = `${directory}/${blockId}-${process.platform}.json`;
    await fs.rm(artifact, { force: true });
    const status = await new Promise((resolve) => {
      const child = spawn(process.execPath, args, {
        stdio: 'inherit',
        env: {
          ...process.env,
          PI_SESSION_SWITCH_RECORD: '0',
          PI_SESSION_SWITCH_BLOCK_ORDER: order.join('-'),
          PI_SESSION_SWITCH_BLOCK_POSITION: String(index + 1),
        },
      });
      child.once('error', () => resolve({ exitCode: null, launchFailed: true }));
      child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
    });
    let entry;
    try {
      const block = JSON.parse(await fs.readFile(artifact, 'utf8'));
      entry = { ...summarizeCausalBlock(block), ...status, artifact };
      assert.ok(entry.blockComplete, 'Every block must retain twelve unique original sample indices');
      assert.equal(block.samples.length, 12, 'Every block must retain all twelve samples');
      assert.equal(block.samples.filter((sample) => !sample.warmup).length, 10);
      assert.equal(block.recording, mode === 'B');
      assert.ok(!block.error && !block.snapshotErrors.length, 'Block failed or lost diagnostics');
      if (mode === 'B')
        assert.ok(entry.observationValid, 'Recording unavailable, incomplete, or lost events');
    } catch {
      failed = true;
      entry ??= { blockId, ...status, artifact, incomplete: true };
      entry.incomplete = true;
    }
    if (status.exitCode !== 0) failed = true;
    summary.blocks.push(entry);
    // Persist after each block so later failures cannot discard earlier observations.
    await fs.writeFile(`${directory}/summary-${process.platform}.json`, JSON.stringify(summary, null, 2));
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await runCausalBlocks();
}
