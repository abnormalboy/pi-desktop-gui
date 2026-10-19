# Navigation completion confirms authoritative state

This replaces the observed-ID heuristic from `a4ae5b2988aff190dad7fdf978cab3bf3aa38c60` on `fix/chat-ui-model-readiness`. Main remains the unpublished `6cc2186` ancestor. The retry assertions from `013966f8`, semantic chat tests from `fb921ce` and popup/action ownership from `cff974c` are preserved.

## Contract and invariants

`newSession` returns the created/reused Session; `selectSession` returns history. Neither result promises that the returned/requested session is still selected when the reply arrives. The complete observed-ID collection and expected-target readiness condition are removed.

- Main's existing state sender, bootstrap and a lightweight read-only `navigationState` confirmation share one process-local revision counter. Each snapshot is cloned synchronously when numbered. The counter is not persisted. Runtime patches and other event families do not receive extra cloning.
- After the latest renderer navigation succeeds or fails, the hook requests one confirmation snapshot. This call does not detect the environment, touch disk, connect Pi or poll. Existing Session/Message[] return shapes and the preload API remain unchanged.
- `useRuntime` accepts only strictly newer revisions, including bootstrap and confirmations. It stores state and revision in one React state value. A late event or bootstrap cannot replace a newer accepted snapshot; settings initialization uses the accepted state and preserves an already edited settings draft.
- The model/send transition stays disabled until the operation and its confirmation finish and that snapshot, or a newer authoritative revision, commits. A reply being settled is insufficient. External C may therefore wait for the outstanding renderer operation; it cannot remain locked merely because the operation returned B.
- Both sides of the confirmation await check the renderer request generation. An old operation/confirmation cannot release a newer request or commit its snapshot. A newer received event supersedes an older confirmation even within the current request.
- Popup ownership still checks session ID and request generation during render. Connect/model/thinking callbacks also compare their captured ID with the latest received authoritative selection before React commits it. No stale click is forwarded, no task is resent and ordinary navigation never connects Pi. Trust, storage, crash and approval restrictions remain intact.
- A confirmation transport failure leaves an explicit “无法确认当前会话，请重新选择会话” error and a disabled entry. Fresh navigation can recover; there is no automatic retry. An operation failure/cancellation with a valid confirmation releases only its own transition and retains the current authoritative selection and other guards.

All native menu, notification, import/project and deletion/cleanup fallback selections use the existing central state sender. No entry-specific exception is added. The synchronous temporary create/restore during recovered-image handling does not publish an intermediate selection and cannot invent navigation. Blank reuse and user-data cleanup behavior are unchanged.

The README demo's mock receives the new snapshot metadata/getter so it continues to implement the renderer contract. `v0.14.21.md` documents the user behavior without changing the version.

## Actual main/store and production hooks

The [baseline failure](navigation-completion-protocol/before.txt) executes production `newSession`, `save`, actual Store and `isReusableSession`, plus the complete hook. Holding only the first save promise permits native creation of C; both broadcasts name C, while the original invocation returns B. The old hook fails `true !== false` after all publication-order assertions passed. The real B/C/B variant passed, demonstrating why a seen-target fix covered only part of normal concurrency.

The committed `tests/support/main-navigation.ts` extracts the current main functions/handlers through the TypeScript AST and fails if their shape changes. It now also executes the actual state sender, snapshot generator and confirmation handler. Store persistence/reuse and SessionAgents history remain real; only save/reply delivery and the renderer commit are gated. Tests cover C/C/B, B/C/B, a newer hook request, older confirmations after newer state, a held confirmation after a newer request starts, failure/cancellation, immutable snapshots, no confirmation writes, withheld DOM commits and old model actions before commit.

`tests/runtime-state-revisions.test.ts` executes production `useRuntime` to verify old event/equal revision rejection, late bootstrap rejection, older confirmation rejection and atomic state/revision commit.

The earlier fake wrong-returned-ID permanent-lock control was withdrawn because it classified the proven C/C/B success as an error. It is replaced by the real scheduling regressions above and a genuine confirmation-failure negative. The DOM-not-ready assertion is retained with a withheld authoritative snapshot commit, rather than an expected returned ID.

## Actual Electron transport and first unlock

The focused UI uses actual Electron/main/Store/Pi with temporary data and a local provider. A gate wraps only this fixture's first state-file write; native File → New Chat changes the selected store while that save is blocked. The original reply is held until both actual state messages are sent. The renderer runs a deliberate two-second CPU loop while these normal IPC messages queue. B/C/B uses a held real reply after B was published. No onEvent callback is reordered.

A prototype with renderer-local receipt numbers was rejected after its real trace showed main sending C/C/B but the renderer processing C → invoke B → unlock C → the second C. The ID happened to be correct; channel-wide FIFO was not established. [That trace](navigation-completion-protocol/local-revision-counterexample.json) explains why the final implementation uses a main confirmation sequence.

For final verification, temporary read-only logging recorded state ingress into useRuntime, observers on the original invoke promises (returning those same promises), and the first unlock in a layout effect after DOM commit. The [exact logging patch](navigation-completion-protocol/confirmation-probe.patch) does not send/reorder events, await an observer or mutate product state. It was removed in `finally`, followed by a restored build and the full uninstrumented checks. The permanent test also records main sends, raw event receipt and the first enabled DOM selection.

| Recorded final case | Creation result | Confirmation   | First unlock                                                         |
| ------------------- | --------------- | -------------- | -------------------------------------------------------------------- |
| C/C/B with CPU busy | B               | C, revision 45 | committed=received=45; hook ID=DOM ID=C; native model button enabled |
| B/C/B               | B               | C, revision 48 | committed=received=48; hook ID=DOM ID=C; native model button enabled |

[The full confirmation trace](navigation-completion-protocol/confirmation-probe.json) and [actual UI screenshot](navigation-completion-protocol/authoritative-c.png) retain the UUIDs and timestamps. The original state/invoke ordering may vary; correctness depends on revision/commit rules, not that ordering. Throughout the UI cases, provider prompt count is zero, the untrusted project has no connection, three connections come only from explicit clicks and renderer errors are empty.

The focused script retains rapid creation/selection, stale real-click replay, pending supersession, cancellation, old reply protection, trust, native menu and sidebar deletion/confirmation. It additionally rejects a real confirmation call before its handler, checks visible failure/disabled controls, then recovers through fresh navigation.

## Validation and limits

Command logs are retained in [navigation-completion-protocol/](navigation-completion-protocol/). Archived console trailing whitespace is trimmed. Two probe-support failures are retained separately: unsupported dynamic import in Electron's evaluator (replaced with its builtin module accessor), and a captured footer locator disappearing as a connected footer changed. The latter now checks the same zero-enabled-connection-controls condition in one live DOM query; model-disabled, IPC counts and timeouts remain unchanged.

Windows/macOS native and packaged UI, full aggregate feature UI, updater/package suites and the complete README demo video are not locally rerun for this correction. Notification/import/project/cleanup fallback interleavings share the audited state path; their native controls were not separately exercised. No main merge, tag, release, version bump or issue closure is performed here.
