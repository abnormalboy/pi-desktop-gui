# Authoritative external selection during a renderer transition

This is the historical `a4ae5b2` report. The observed-target rule below is superseded by [the completion snapshot protocol](navigation-completion-protocol.md): actual main/store execution can publish C/C and legitimately return B without ever publishing B. A result-ID mismatch is not a valid permanent-lock condition.

This corrects the regression in `cff974cbec3603fe633c2b332e741f891d48713e` on the same `fix/chat-ui-model-readiness` branch. Its green CI did not cover this interleaving. The earlier retry fixes (`013966f8`), semantic chat readiness (`fb921ce`) and popup ownership guards (`cff974c`) remain intact.

## Reproduction before the fix

Using the existing complete production-hook harness, start `selectSession(B)` with its IPC promise held; select/render B and flush effects; select/render C to represent native File → New Chat; then release B's successful reply. C remains selected, but `selectionChanging` is true and `sessionEnabled` is false. The [baseline failure](external-selection-transition/before.txt) is exactly `true !== false`. No product source was changed before recording it.

The old implementation treated a successful reply's target mismatch as an indefinitely incomplete navigation, even after that target had already been displayed and replaced by a later authoritative selection. Native menus are one of several routes that can update the selected session without calling this renderer hook.

## Minimal correction

`useWorkbench` records selected IDs observed within each request, resetting the observation at every newer hook request. `useRuntime` reports authoritative state selections before React updates, so B → C is retained even if React renders only C. The hook also observes its selected view, preserving the original deterministic harness behavior. No event schema, persistent state, main-process handler or navigation entry point changes.

A different selected session can supersede the old transition only when that same request actually observed its own target. The transition then invalidates the old request generation, allowing the current legitimate target to remain usable without waiting for the obsolete reply. A new-session target that becomes known only in the reply uses the same observed-history check. Same-ID blank reuse is recorded from its real state event, even when the selected ID does not change. Observations are discarded after completion, supersession or failure.

This is not a blanket mismatch unlock: a returned target never observed in that request stays locked; a newer request cannot inherit an older request's target history. Its own unobserved target remains protected despite external state updates and old replies. The existing native-disabled button, session/generation popup ownership and connect/model/thinking callback guards remain unchanged. No click is queued or forwarded, and no navigation starts Pi.

All selection sources share this rule. Source inspection covered notification clicks, native new-chat menus, imported/adopted sessions, existing/new project selection, project removal fallback, session deletion fallback and empty-session cleanup fallback. No per-entry exception is added. `Agent.restoreQueuedDrafts` creates a recovered-image session and synchronously restores the original selected ID before publishing; it is not observed as navigation. A session-list change with the selected ID unchanged cannot release an outstanding transition.

`docs/releases/v0.14.21.md` adds one accurate bullet about disabled transitions, popup/action ownership, legitimate external selection and on-demand connection. No version number or release action changes.

## Regression coverage

The full production-hook tests retain the independent review's exact render/flush reproduction and add:

- Deleting the observed B target, falling back to C, then receiving B's late reply. C stays enabled, B stays deleted and its stale model callback is rejected.
- A newer C request that has not observed C: an external A selection plus old B completion cannot unlock it; both C's target and IPC are still required.
- Coalesced authoritative events for known session selection, unknown new-session targets and same-ID blank reuse, followed by a legitimate external C selection.
- An unobserved successful creation target, which remains locked; unchanged selected state and background recovered sessions, which do not count as external navigation.
- All earlier wrong-target, obsolete-completion, before-render callback, storage restriction and no-auto-connect tests.

The real Electron/Pi script retains every previous transition scenario and adds actual native menu callbacks and sidebar deletion/confirmation. It holds real handlers/replies without simulating model success:

- A renderer selection reaches A; native File → New Chat selects C while A's reply is held. C's model entry and a nonempty draft's send button become enabled and stay enabled after the late reply; no connection is forwarded.
- The observed target is deleted through its real sidebar action and confirmation. The fallback remains usable after the old selection reply, with no resurrected session or implicit connection.
- A fresh explicit click connects the native-menu target to actual Pi.
- Native navigation and an older reply occur while a newer renderer target has not arrived. The entry remains disabled until that newer target and its own IPC finish.

Across these cases, provider prompt count is zero, the untrusted project receives no connection, and renderer errors are empty. [State and IPC evidence](external-selection-transition/result.json) and [the native-menu screenshot](external-selection-transition/external-menu-ready.png) are retained.

Notification clicks, import/adoption and project/cleanup fallback were audited through their shared authoritative-state path; their transition interleavings were not separately exercised through OS/UI controls. Windows/macOS native UI and packaged acceptance remain for CI/the corresponding systems. No local result is presented as that platform's acceptance.

## Validation

Command results are retained in [external-selection-transition/](external-selection-transition/). The initial focused UI run used the wrong accessible send-button name, `发送`; the [failure log](external-selection-transition/ui-before-locator.txt) records “element(s) not found” while the accessible tree showed `发送任务`. The locator was corrected to that existing exact name. The enabled assertion and timeout were retained.

| Check                                                               | Final result                                                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run build`                                                     | Passed; existing bundle-size advisory only.                                               |
| `umask 022; npm test`                                               | 364 tests: 363 passed, one Windows-only test skipped, zero failures.                      |
| Targeted complete hook and session-model component tests            | All 45 passed, including the exact independent-review regression.                         |
| `npm run test:integration`                                          | Passed with actual Pi.                                                                    |
| `DISPLAY=:99 npm run test:chat-ui`                                  | Complete original chat scenarios and all eight focused transition scenario groups passed. |
| Model-switch UI                                                     | Passed, including concurrent sessions, next-task settings, reload and independent stop.   |
| Approval UI                                                         | Passed, including pending approval resync, denial and read-only manual commands.          |
| Complete retry UI                                                   | Passed; `scripts/test-retry-ui.mjs` remains identical to `013966f8`.                      |
| Modified-source Prettier, focused script syntax, `git diff --check` | Passed.                                                                                   |

The recorded pre-fix hook failure and first UI locator failure are kept separately from successful final logs. Console trailing whitespace is trimmed in the archived text logs. Full aggregate feature/UI, native theme, packaging and updater suites were not locally rerun for this correction; Windows/macOS checks and fresh branch CI are not claimed as passed here.

The earlier synchronous-popup-owner negative control and its failure evidence remain in [the original report](model-entry-transition.md). The wrong-target negative and stale real click are also executed in the expanded UI script. No assertion is removed or weakened, and no failed command is repeatedly rerun without a relevant fix.
