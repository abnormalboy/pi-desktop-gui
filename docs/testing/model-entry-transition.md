# Model entry during new-chat and selection transitions

The current completion contract and final validation are in [navigation completion protocol](navigation-completion-protocol.md). The report below and its earlier wrong-target lock control describe historical candidates; that control was replaced after actual main/store concurrency proved the same mismatch legal.

This report records `cff974c` and its original local validation. Independent review subsequently found an external-navigation lock regression despite that commit's green CI. [The external-selection follow-up](external-selection-transition.md) supersedes the lifecycle description below and adds native-menu/deletion coverage while retaining the popup-owner and wrong-target protections.

Branch `fix/chat-ui-model-readiness` continues after test commit `fb921ce`; its main ancestor remains `6cc2186`. The retry assertion fixes from `013966f8` and semantic target/readiness checks from `fb921ce` are retained. This follow-up changes product behavior for the ordinary-user race recorded in [the earlier investigation](chat-ui-model-readiness.md).

## Product behavior and scope

While a renderer new-chat or session selection request is in progress, the model entry is natively disabled and shows “会话切换中…”. It becomes available only after the latest IPC completes and the selected view matches that request's target ID. The old popup closes. An untrusted project shows “请先启用项目”; other disabled sessions remain disabled. The composer and explicit connection footer share the transition guard, so they cannot bypass it.

Each open popup belongs to a session ID and navigation generation. A mismatched popup is hidden during render, independently of effect cleanup. Connect, model and thinking callbacks check their captured session ID against the current selection and their captured generation against the current request ref. Starting navigation invalidates an old callback even before React renders again. An old completion cannot unlock a newer pending request. Failed/cancelled navigation releases its own lock; a malformed successful result pointing at a different selected ID stays locked until valid navigation recovers.

No navigation starts Pi. No early click is saved, retried or forwarded to another session. Once navigation completes, the user must explicitly click the model entry or connect action again. Existing trust, approval, crash and storage restrictions still apply. Existing background work and next-task model/thinking selection remain supported. No persistent data format, blank-chat reuse/cleanup rule, version, release file or main-process connection policy changes.

Product edits are limited to `useWorkbench.ts`, `Composer.tsx` and `ModelPicker.tsx`. English and Chinese README text explains the temporary disabled state and the fresh-click requirement. `test:chat-ui` now also runs the focused Electron regression so Linux CI covers it.

## Regression cases

The focused `scripts/test-model-entry-transition-ui.mjs` uses production Electron, real Pi, an isolated local provider and temporary app data. IPC probes delay real handlers or their replies; they never supply a fake successful model runtime. Native mouse clicks on disabled controls deliberately avoid Playwright's normal enabled-element waiting.

| Case                                                                        | Required result                                                                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Rapid new chat from an old untrusted project; new-session handler held      | Old selection is visibly disabled; no popup, connection or prompt. After release, only a fresh explicit click connects the new ID. |
| Old popup open; new ID selected while new-session reply is held             | Old popup disappears and target remains disabled until the reply completes; zero deferred connects.                                |
| Replay A's real closed-picker click callback after B is ready               | After two animation frames, no popup for B and no extra connection; fresh B click still connects B.                                |
| Creation rejected/cancelled before its handler                              | Error is visible, current selection survives, lock releases, no connection.                                                        |
| Select project, then select B before the old reply                          | Latest B becomes usable; the obsolete reply neither relocks B nor connects anything.                                               |
| Older A response completes while a newer project selection is still pending | Newer request remains disabled; once complete, the project's trust guard remains enforced.                                         |
| Successful new-session reply deliberately names the wrong target            | Entry stays disabled with no wrong connection; a valid newer selection restores usability.                                         |
| All navigation and model-discovery cases                                    | No prompt reaches the provider; no connection targets the untrusted project; no renderer errors.                                   |

The committed state JSON records stage names, selected IDs, runtime/model state, disabled/popup state and all connect IDs. [The screenshot](model-entry-transition/transition-disabled.png) shows the actual disabled entry and footer while the new target is selected but IPC remains held.

Hook regression tests execute the entire production hook with deterministic hooks/IPC. They cover IPC-before-view and view-before-IPC ordering, obsolete creation/selection completions, errors, old connect/model/thinking callbacks before render and after selection, external selection before effects, and a disabled target. Existing no-auto-connect and explicit cold-chat send/connect tests remain intact. A server-rendered component assertion checks native `disabled`, the explanatory title, `aria-expanded=false` and absence of a stale dialog/options.

## Validation evidence

Final command results and raw logs are kept in [model-entry-transition/](model-entry-transition/).

| Command/check                                                         | Result                                                                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                                       | Passed, including the restored final build after the negative control. Existing bundle-size advisory remains.                         |
| `umask 022; npm test`                                                 | 356 tests: 355 passed, one Windows-only test skipped, zero failures.                                                                  |
| Targeted hook and session-model UI tests                              | All 37 passed.                                                                                                                        |
| `npm run test:integration`                                            | Passed with actual Pi, including native session directory and legacy file continuation.                                               |
| `DISPLAY=:99 npm run test:chat-ui`                                    | Complete original chat scenarios plus focused transition scenarios passed.                                                            |
| Focused transition script after restoring the mutation                | Passed again with the exact final source and corrected diagnostic stage labels; [state evidence](model-entry-transition/result.json). |
| Model-switch UI                                                       | Passed, including next-task model/thinking, concurrent sessions, reload and independent stop.                                         |
| Approval UI                                                           | Passed, including pending approval reload, denial and read-only manual-command protection.                                            |
| Full retry UI                                                         | Passed. The four collection assertions from `013966f8` are unchanged.                                                                 |
| Modified-file Prettier, both script syntax checks, `git diff --check` | Passed.                                                                                                                               |

The first product candidate failed the new native-disabled assertion before the actual button attribute was added; [that initial log](model-entry-transition/unit-before-disabled-attribute.txt) is retained. The assertion was not loosened.

For a separate negative control, the synchronous popup-owner check was temporarily replaced by a non-owning open flag while leaving effect-based closing intact. Replaying A's real old click after B settled exposed a dialog in B: the focused test failed with expected count 0, actual count 1. The [raw failure](model-entry-transition/stale-popup-negative.txt) and [screenshot](model-entry-transition/stale-popup-negative.png) are preserved. The source was restored in `finally`, rebuilt, and the focused test passed. This establishes that merely closing in an effect does not satisfy the regression assertion.

Windows/macOS native UI and packaged-app checks require CI or their respective operating systems. Linux local results do not establish those outcomes. Full aggregate feature/UI, native theme, packaging and updater suites were not rerun for this renderer fix. The earlier full-green CI for `fb921ce` covers the test-only parent, not this product follow-up. No release, tag, main merge or issue closure is performed here.
