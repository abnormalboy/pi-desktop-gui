# Unused placeholder lifecycle

## Behavior and compatibility

New and startup chats begin as process-local placeholders. Only an untouched, marked placeholder in the same exact project or standalone scope is eligible for reuse. Leaving it hides its sidebar row, without removing its object or ID from the Store registry. The saved index and rotating backups omit it. Startup restores a valid persisted project scope and selects an existing durable chat in that scope or creates a new temporary placeholder.

A valid content or explicit session operation permanently promotes the original ID before its first asynchronous boundary. Whitespace, attachments, images, collapsed text snippets, rename, pin/unpin, model/thinking/approval choices, connecting, and task operations count. Explicit choices count even when they match the effective default. Clearing the content or a later failure/cancellation does not undo promotion. Promotion is saved before a Pi process or command may start; a rejected write stops those side effects.

Selecting/reading history, empty autosaves, layout saves and zero-usage initialization do not promote. A completed model-catalog read is also passive and does not create a chat log. If New is requested while an ID is actively reading its catalog, the existing busy-owner guard conservatively retains that original ID and creates another placeholder. There is no separate read-reservation manager.

Loaded historical blanks, imports, native branches/clones and recovered drafts remain durable. Nothing is automatically deleted, timed out or resurrected. Old empty entries can still be cleaned up explicitly in **Settings → 诊断与数据 → 清理空会话**. Confirmation and all rechecks remain in the backend, including a last field check after asynchronous file/agent checks.

## Persistence and state protocol

- `Store.save()` synchronously serializes its durable projection before joining the existing atomic-write queue. `state.json` and a rotated backup receive the same captured bytes.
- The numbered common main-process snapshot includes durable rows plus the currently selected transient. It hides unselected transients without modifying registry identity. Existing bootstrap/event/navigation revision ordering is unchanged.
- Late draft IPC locates and promotes its original ID without selecting it. Explicit deletion/project removal clears matching transient metadata; a stale request fails instead of recreating the ID.
- Search, usage totals and cleanup enumerate durable rows, so hidden placeholders cannot leak into search results, inflate totals or be deleted by cleanup.
- Acknowledged saves are the persistence boundary. An unacknowledged write, abrupt process kill or power loss is not promised to survive. ENOSPC preserves available content in memory, reports storage failure and rejects the save.

## Automated coverage

Run from a built checkout with the locked dependencies:

```sh
npm ci
npm run build
node --import tsx --test --test-timeout=120000 tests/placeholder-store.test.ts tests/placeholder-lifecycle.test.ts tests/placeholder-controls.test.ts
node --import tsx scripts/test-placeholder-lifecycle-ui.mjs
```

The real Electron regression is also part of `npm run test:ui`. On Linux, use the CI desktop dependencies and `xvfb-run -a -s "-screen 0 1920x1080x24" npm run test:ui`.

### Store and production-boundary unit tests

`placeholder-store.test.ts` covers same-scope/concurrent reuse, cross-scope separation, busy-owner protection, zero-data saves, current/rotated backups, restart, scope/selection normalization, protected fields, irreversible default-valued choices, synchronously queued snapshots, durable legacy producers, deletion safety and ENOSPC.

`placeholder-lifecycle.test.ts` extracts and executes the actual main handlers, snapshot function, IPC operation boundary, close callback and update-preparation callback. It covers delayed draft IPC, passive browsing/autosaves, exact pre-await promotion, external-editor cancellation/failure, default-valued setters, pending exclusive/read/preference work, passive catalog completion, busy catalog ownership, write failure before metadata process startup and normal/update persistence barriers. These are deterministic unit tests of production code, not a real Electron run.

`placeholder-controls.test.ts` exercises the production React controls, including an explicit click on the current model, current `off` thinking level and current `auto` approval mode. Merely opening a menu remains passive.

### Real Electron and real Pi regression

`test-placeholder-lifecycle-ui.mjs` launches the production Electron main, preload and React renderer. It uses the unmodified Pi CLI against a loopback-only deterministic provider with isolated app-data and Pi configuration directories. It exercises:

1. Real New/leave/reuse controls, unrelated saves, hidden rows, current index and backups
2. Settings-based legacy cleanup and a draft arriving during the actual confirmation
3. Delayed original-ID draft writes, whitespace and attachments/images/snippets added then cleared
4. Passive real Pi model metadata, followed by actual same-default model/thinking/approval clicks
5. Default-title rename, pin/unpin, an actual Pi task and restart persistence/scope
6. Explicit deletion followed by rejected late IPC and a fresh ID
7. A real main-process no-agent first-draft quit with the filesystem writer held
8. ENOSPC retaining the unsaved draft until the user explicitly approves discard

For the no-agent cases only, a temporary launcher holds `readHistory` before its production handler can construct an AgentService, and pauses/fails the actual Node filesystem write. Store, SessionAgents, close behavior, persistence responses and Electron IPC are not mocked. This controlled timing makes the no-agent boundary deterministic. Screenshots and evidence are written to `test-results/placeholder-lifecycle/`.

The existing production update preparation has its own held-write unit boundary test. `npm run test:update` remains the real Windows/Linux installer roundtrip check; the placeholder UI script does not claim to install an update.

## Validation record

The initial deterministic main close test failed before the global barrier: the actual close callback reached quit while the first-draft writer was held and no AgentService existed (28/29 lifecycle tests passed). It passed after the close fix. This is not an Electron reproduction by itself.

The development candidate incorporates main `22c0bc6ab7834bf7ae23977824f364860277f5c8` (v0.14.23). After the close-time snapshot regression below was fixed, its v0.14.24 build passed, aggregate unit tests passed with 513 successes and one Windows-specific skip, and the focused production-boundary lifecycle set passed 47 tests. Real Pi integration, the full feature suite and concurrent-session/settings checks passed on the preceding product tree.

The final close path first waits only for currently queued filesystem writes, then starts Agent cancellation before waiting for workspace reservations, drains already accepted main operations, and waits for the final Store queue. A first flush failure can keep usable services; a later disposal-time failure explicitly offers a copy-only window or confirmed discard. Tests cover the reader/dialog cancellation dependency and both late probe-start gaps. A probe also waits for an already-promoted session’s pending save: held writes prevent startup, acknowledged writes allow one actual protocol-fixture probe, and failed writes or cancellation allow none.

The first aggregate run exposed outdated durable-Store test doubles; a second run exposed extracted main-helper dependencies. The fixtures now exercise the current contracts, preserving their assertions, and the final aggregate run passed. Independent source review found no blocking lifecycle or shutdown issue.

### First exact-candidate checks and corrections

[Candidate 8e896e1](https://github.com/yeyuProject/pi-desktop-gui/commit/8e896e16104ecdecf03da077175636c800f3b70c) ran in [CI 39368032913](https://github.com/yeyuProject/pi-desktop-gui/actions/runs/39368032913). macOS packaged acceptance and Windows/Linux installer roundtrips passed. Linux stopped in the experience script because a new saved-draft wait referenced `standalone` before its declaration. That wait has been moved after creating and editing the intended standalone session; the drop-cancellation assertions remain intact.

Independent online Electron acceptance then reached the existing close-during-resize assertion and exposed a product regression: the new Store barriers yielded before the window snapshot was captured, so a deliberately late resize changed the saved size from 1420×880 to 1440×900. The close callback now captures the window write synchronously before those barriers and awaits that same write before destruction. It still waits for drafts and accepted operations. A deterministic regression failed before this change and passes afterward, holding both the draft writer and the captured window writer.

The recovery UI fixture intentionally causes a real disk write failure. It now verifies and explicitly confirms the new unsaved-content exit dialog before waiting for process exit, instead of assuming such a failed-save window closes without confirmation. Its existing disabled-input and rejected-send assertions are unchanged.

The online run passed the dedicated placeholder lifecycle, five-scenario session measurement, chat, image, transcript, scroll, polish, retry, real Pi integration, feature and concurrent-session checks. A workspace test needed a writable isolated trash location and a normal `0022` umask in that executor. These partial results do not replace a full final-candidate run: the experience regression above was a real failure, and the first Windows packaged job remained stalled after the first image-input checkpoint when this report was updated.

The image fixture now prints its failing stage and original error before screenshot/cleanup awaits, bounds those waits, and releases its own deliberately held image picker before closing. An assertion or cleanup timeout still fails the run; a forced process termination is failure cleanup, never a passing result. `--inject-pending-picker-failure` is a test-only negative control that must fail nonzero and log release of that fixture picker. These diagnostics do not establish the original Windows stall's cause.

This local shell has no desktop display/Xvfb. Final online acceptance and exact-commit platform CI remain required before merge and release.
