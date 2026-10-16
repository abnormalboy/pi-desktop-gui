# Temporary session-switch investigation

This development branch investigates the 619.8 ms macOS outlier in main run
[38891997344](https://github.com/yeyuProject/pi-desktop-gui/actions/runs/38891997344).
That run used commit `9fafd77de26200ba59abfb0ed94e59afea3c1d2d`. Its legacy
bubble-click-to-requestAnimationFrame-callback measurement was 619.8 ms while
the separately reported backend operation was 44.6 ms. It did not record a
common call identifier or selected-state delivery. The difference is not a
measurement of React rendering or IPC latency.

The source baseline for this experiment is main
`f424091846431c82eec936e74c8607e189ed66d5`, including the concurrent resource
settings changes. This branch does not change the product's persistence or
session-switch scheduling and is not intended for release or wholesale merge.

## Questions and competing explanations

1. Did a save queued during rebind delay the first state event containing the
   target selectedSessionId? Runtime messages alone cannot display the target
   until selection agrees. A save callback emits the current mutable state,
   which can differ from its saved snapshot.
2. Did selection wait in the IPC guard, agent operation queue, backend work,
   state serialization/write queue, or synchronous event sending?
3. Once target runtime and selected state reached the renderer, was the delay
   before DOM observation or the next rAF callback? The existing messages effect
   is observed only as an effect boundary, not a React render-duration profile.
4. Does passive instrumentation materially change the observed cadence or
   outlier distribution? The older diagnostic branch waited for invoke settled
   before continuing; this experiment must not repeat that extra wait.

## Predetermined sampling plan

One packaged build; macOS six fresh fixture/process blocks in the fixed order
A, B, B, A, A, B. A leaves the recorder off, B enables bounded passive recording.
Each block has the original two warmups plus ten scored switches. This yields
30 scored samples per arm. Windows runs one B block to check compatibility.

Both arms retain the original ordering: click, target DOM observation, one rAF
callback, bounded target-draft correctness check, one full diagnostics call,
then the next iteration. Late invoke completion is recorded but never becomes
an added prerequisite. The original idle-exit/reconnect and functional checks
remain required. Warmups, all over-budget values, failures, partial buffers,
and provenance are saved. The target remains 200 ms; current main's explicit
advisory performance policy is retained.

The run is not repeated to obtain green results. At the fixed limit, an absence
of outliers means "not reproduced", not "fixed". An overflow or incomplete
association invalidates the relevant observation. If anomalies occur only with
the recorder disabled, report the limitation instead of asserting a causal
stage from a different sample. Further collection requires a discriminating
reason, not an unplanned increase until the result looks favorable.

## Timing and perturbation limits

All interval subtraction stays inside one process's monotonic clock. Event and
call identifiers pair records across processes; they do not align clocks.
The main send-call return is not renderer receipt. A rAF callback is not proof
that pixels were painted. Loop gaps and long tasks may expose scheduling
problems but cannot alone distinguish CPU contention, suspension, GC, or
background throttling.

Recorders are explicit opt-in and bounded, with no per-event file writes,
console output, extra diagnostics polling, or extra runtime subscriptions.
Only scalar identifiers/counts/times are recorded; message contents, drafts,
resource paths and credentials are excluded. Instrumentation still has cost,
which is why the recorder-off arm uses the same build and original cadence.

No historical spike is considered explained merely because a synthetic delay
can reproduce a similar shape. A deterministic delayed-write test validates a
measurement boundary and a mechanism; attribution needs an associated real
slow sample or separately justified reproducible product defect. Any eventual
persistence change needs failure, exit/flush, cancellation, rapid-selection and
session-isolation coverage before consideration for main.

## Running the bounded experiment

After the ordinary build, tests and platform directory package, run
`npm run test:session-switch-causal -- --packaged` on macOS or Windows. The
existing CI adds that one step only for pushes to
`refs/heads/test/session-switch-causal`; ordinary main, pull-request and release
flows are unchanged. Each block writes a separate JSON file and the runner
updates a summary after each block under `test-results/session-switch-causal/`.
The acceptance artifact already uploads this directory, including failures.

The Node fixture-seeding process keeps recording disabled in both arms. Only
the launched Electron app enables it in B. Snapshot export is outside the
timed loop. An event's owning invocation/save can be older than the sample
during which it is received: choose the first target selected-state receipt
after the current click by renderer time and selectedId, then trace eventSeq
back to its original save. Never rewrite that save's snapshot provenance.
