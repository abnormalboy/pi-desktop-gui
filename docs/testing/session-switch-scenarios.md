# Session-switch measurement coverage

## Scope and confirmed gaps

Issue [#9](https://github.com/yeyuProject/pi-desktop-gui/issues/9) needs separate observations for initial opening, warmed visits, different directories, large saved histories, and rapid navigation. Its [reporter supplement](https://github.com/yeyuProject/pi-desktop-gui/issues/9#issuecomment-6269208540) still describes v0.14.18 and retracts the earlier process-kill / zero-millisecond conjecture. It does not establish a v0.14.21 regression.

The previous runner measured ten retained same-project hot switches after two warmups. Its three first visits to other directories already checked correct history, cwd, independent processes, drafts, activity order, and no unintended prompt. It did not retain warmed cross-directory return timings, time a large-history switch, or time rapid A→B→A. Its cold-browsing measurement correctly stopped before connection, but the subsequent explicit connection was not separately timed. Initial application opening was also absent from its timing output.

There is a separate, verified v0.14.22 test-compatibility failure: opening the model menu now reads metadata through a disposable Pi reader and deliberately leaves the conversation disconnected. The old runner still waited for `connected` immediately after that click. The Windows session job in [run 39365126363](https://github.com/yeyuProject/pi-desktop-gui/actions/runs/39365126363/job/118440103960) timed out at that wait after its preceding hot-switch and exit/recovery checks passed; macOS also failed this old assumption. v0.14.23 corrects that assumption for the original cold-directory checks. This extended runner preserves its exact saved-history-byte, empty chat-command, no-chat-connection and detached-picker guarantees while adding the five scenario groups. It measures catalog loading and actual conversation connection separately and does not restore eager chat connection.

## Reproduce

```sh
npm ci
npm run build
node --test tests/session-switch-measurement.test.mjs tests/session-switch-budget.test.mjs
npm run test:session-ui
# Or, after creating the native unpacked package:
npm run test:session-ui -- --packaged
```

The runner uses the pinned, unmodified Pi CLI, isolated disposable app/agent directories, and a loopback-only deterministic model endpoint. No personal Pi configuration, credentials, or real model provider is used. A and B use two real local-provider model IDs, so a stale model cannot satisfy the final A gate.

The 500-message fixture begins with a real Pi-created session and uses Pi's `SessionManager.appendMessage` to append bounded, alternating user/assistant records. Both the app's saved-history reader and Pi's own context reader must find exactly 500 conversation messages. Pi's additional system records are preserved and reported separately. No runtime or history IPC handler is replaced. The resulting file must remain below 2 MiB. The renderer keeps its ordinary visible-message limit; this is not a claim that all 500 messages appear in the DOM at once.

## Five scenario groups

1. **First cold open.** Start a fresh Electron process with saved A selected and no conversation process connected. Record Node launch-to-first-window and launch-to-observed-ready intervals separately from renderer navigation-origin observations. Record observer installation and the initial public-state resync. Browsing must finish without connecting A. Then measure a real model-menu click to usable catalog, and a separate click on the selected conversation's `.run-meta` “重新连接” button to target readiness and rendered completion.
2. **Same-project hot return.** Explicitly warm A and B, alternate twelve times, retain the final ten samples, and retain the original 200 ms advisory next-rAF budget. Each target must retain its own PID, model, draft, activity timestamp and sidebar position.
3. **Cross-directory hot return.** Retain the four actual warmed directory transitions among project, standalone and other-project sessions. Preserve the original first-visit checks and separately record cold browsing, model-menu/catalog loading and actual connection for those three targets. An additional same-directory return is labelled accordingly rather than counted as cross-directory.
4. **Large history.** Measure the first browsing visit to the 500-conversation-message session without connecting it, its catalog opening, its explicit connection, and a subsequent hot return. Verify the real saved-history record count before and after connection, the expected model/cwd, distinct PID and unchanged browsing activity. Record the actual rendered-message-element count outside the timed interval.
5. **Rapid A→B→A.** Establish B, then activate A, B and A through their real sidebar handlers in one renderer task using `HTMLElement.click`. This deliberately removes pointer-travel and automation-roundtrip delay; it is labelled as such. Every activation has its own request ID and start timestamp. The first two are retained as `superseded`, with null unobserved metrics. Only the final A can complete, after a newer authoritative state revision and the correct A history, draft, model ownership and nonpending send/model gates agree. Recheck final A after queued animation-frame work and verify no prompt was sent.

## Clock and completion semantics

Every navigation/click elapsed value is computed with the same renderer's `performance.now`. The separate Node launch values never participate in renderer subtraction.

- `messageDomMs`: first observation of the target marker in `.thread`. This is a DOM observation, not a paint measurement or proof that the latest request completed. In same-ID rapid A→B→A, the first visible A may belong to the superseded first A; `messageDomScope` explicitly retains this limitation. Final readiness is measured separately by `selectionSettledMs`.
- `nextAnimationFrameMs`: the first requestAnimationFrame callback after that DOM observation. This is a frame-boundary observation, never proof of screen presentation.
- `authoritativeSelectionMs`: the target public-state ID, expected heading and sidebar selection agree. A browsing click additionally requires a state revision newer than its click baseline, including final A in A→B→A.
- `draftRestoredMs`: the exact nonempty target draft is present with authoritative selection.
- `sendGateReadyMs`: authoritative target selection with an enabled input, enabled Send, no pending spinner, and enabled model-menu trigger. This is an independent observation; it alone does not mean history/runtime completion.
- `runtimeReadyMs`: target-owned, connected, idle runtime with the exact expected model. A hot runtime already ready at activation is recorded as `0` with `runtimeAvailabilityAtStart: already-ready`; that does not describe a zero-cost connection. Unobserved readiness remains null.
- `modelCatalogReadyMs`: target-owned loaded, non-loading catalog with the expected enabled current option visible in the actual model menu. Conversation connection is separately asserted false. A temporary metadata-reader process is expected under v0.14.22.
- `selectionSettledMs`: all relevant target/history/draft/send/ownership gates agree, plus catalog readiness or runtime readiness when that phase requires it. For the explicit reconnect click, the real renderer action must have released its pending gate. Every gate is checked again on the resolving sample. A prior good preview cannot allow a later foreign or pending snapshot to resolve. After the first complete snapshot, collection continues until a subsequent animation frame rechecks completion. Any intervening regression is retained as a hard failure, even if the final target returns before resolution. This extra correctness observation does not change the recorded first-preview, next-rAF or first-settled times.

First-open observers attach after Playwright exposes the first window and its real document root. Initial navigation-origin observations are therefore **upper bounds**, with the installation time, document readiness, navigation metadata and already-visible-history flag recorded. The one initial `bootstrap` read seeds the test's public-state observer; its timestamps are labelled as a test resync, not the application's own bootstrap duration. These values do not prove exact app-launch-to-DOM latency. There is no repeated bootstrap polling during a switch and no new product instrumentation in the timed path.

Each sample carries scenario/phase/request ID, target session/project/title/marker/model, start mode, baseline revision, runtime-at-start and final ownership/readiness snapshot. Completion, timeout, cancellation and supersession retain explicit outcomes. Completed measurements remove their public-event/click listeners, mutation observer, timeout and pending animation frame; the runner also cancels collection if an action fails.

## Output and preserved correctness checks

- `test-results/session-ui-<platform>.json`: original ten hot samples and advisory budget, now with version/source/build identity and precise timing notes.
- `test-results/session-ui-cross-directory-<platform>.json`: cold directory browsing, separate catalog/connection phases and retained warmed returns.
- `test-results/session-ui-scenarios-<platform>.json`: all five scenario groups, explicit process-exit recovery, unrun cold paths, and post-exit activity baseline.
- Existing failure JSON and screenshot remain available. Resolved samples are saved before correctness assertions, so a failed latch retains its first mismatch/regression snapshot rather than only a final screenshot. Errors include partial collector outcomes where a measurement times out.

Identity includes the running app version and packaged flag, Electron/Chromium versions, checkout commit when available, any supplied build commit, worktree status/diff hash, and SHA-256 of the actual loaded unpackaged build files or packaged app archive. Runner/observer hashes are recorded too. Unknown identity is null; a dirty checkout is not represented as an exact clean-source build.

After each catalog phase, exact original history bytes must be unchanged, the picker must detach, and no new persistent chat connection or chat commands may appear. First-visit catalogs require zero commands and no `sessionSwitch` diagnostic. Exit recovery may retain its earlier command list/diagnostic, which must remain unchanged. These checks run outside the timed interval.

Correctness failures remain hard failures: history inconsistent with the displayed session title/sidebar, any regression after the final selection first satisfies its complete gates, wrong final target/model/runtime owner, pending or disabled completion gates, changed drafts/activity/order, wrong cwd/resources, shared/replaced hot PIDs, unintended prompts, unrelated-running-session banners, or renderer errors. The original process-exit isolation/recovery and first-send-without-preconnect checks remain. The first-send check waits for the new selected composer before filling; an unused transient placeholder need not have a sidebar row.

The existing ten-sample **200 ms target stays advisory** while intermittent overruns are investigated. This change adds coverage and honest attribution, without asserting a performance optimization or setting an unverified cold-start budget.

The process-exit scenario explicitly terminates A and verifies confirmed cleanup before recovery. It is not automatic process eviction. Automatic eviction and project-resource reload are reported as `not-run`; neither is inferred from warmed visits or explicit process termination.

## Validation record

2026-10-20, local Linux executor, Node 24.19.0:

- Exact serialized renderer helper/gate tests: 31 passed. They reject wrong public session/project, sidebar/title, foreign/missing history, runtime owner/cwd/model/readiness, wrong draft, missing/disabled input, pending actions, and disabled send/model options. Collector tests cover newer revision, rapid request attribution, rechecking later foreign frames, unsafe unlocked gates, initial-observation upper bounds/resync, explicit-invoke fulfillment, timeout and cancellation cleanup.
- Runner and helper syntax checks passed.
- A fixture-only real Pi run passed: all six seeded sessions completed through the local provider, the 500-conversation-message transcript retained 501 message records including Pi's system record (264,055 bytes in that fixture), and a real Pi connection resumed it with all 500 conversation messages and the expected model. These are fixture/correctness checks, not UI timings.
- Real Electron scenario timing is **not run locally**: this executor has no DISPLAY, Xvfb or supported display server. The installed Electron binary does not remove that blocker. Native or saved-environment UI acceptance remains required; no new five-scenario latency numbers are claimed here.

Historical v0.14.21 macOS observations such as approximately 26.6 ms DOM / 34.6 ms next-rAF / 700.3 ms selection completion describe distinct milestones. They are not new samples from this change and do not show that all readiness completed at the first fast content observation.

### First packaged macOS samples

The macOS job for [8e896e1, run 39368032913](https://github.com/yeyuProject/pi-desktop-gui/actions/runs/39368032913/job/118449251380) passed all five scenario groups and their ownership/correctness checks. The downloaded `acceptance-macos-latest` artifact matched GitHub's SHA-256 digest `d218e2c98171856043b2ceeddfac11892d595603c824ab6580341e37cb1ccf62`.

- Same-project hot target DOM: 16.6–46.2 ms; maximum next-rAF: 49.6 ms.
- Four hot cross-directory target DOM observations: 19.6–45.0 ms. Their runtime was already ready at activation.
- Three cold cross-directory target DOM observations: 43.0, 113.6 and 62.9 ms. Separate catalog phases took 626.9, 511.2 and 455.9 ms; explicit connection readiness took 1502.6, 1228.4 and 1295.8 ms.
- The 500-message history's cold DOM observation was 167.5 ms (next-rAF 190.4 ms), its hot DOM return 99.6 ms, and its separate explicit connection 1356.5 ms.
- Rapid A→B→A retained the first two activations as superseded. Final A had target DOM at 6.2 ms and all selection gates settled at 30.7 ms.
- First-open target DOM was observed at 1337.5 ms from renderer navigation and next-rAF at 1578.1 ms. The observer attached at 602.2 ms, with a test resync from 608.5 to 1225.3 ms: these first-open values are upper bounds, not exact first-paint latency. The separate Node-clock first-window value was 1985.0 ms.

These are samples from the first candidate, not a final-release benchmark or proof that cold readiness is fast. In particular, actual cold runtime startup remained above one second. Historical intermittent spikes, automatic eviction and resource reload remain unresolved or unmeasured as described above.


### Rapid-navigation attribution correction

The exact `2289234` development run [39370468095](https://github.com/yeyuProject/pi-desktop-gui/actions/runs/39370468095) and independent Linux UI acceptance passed. Its subsequent [main run 39371414755](https://github.com/yeyuProject/pi-desktop-gui/actions/runs/39371414755) failed only the macOS rapid A→B→A history latch; Windows, Linux and both upgrade jobs passed. No v0.14.24 release was created from that failed main run. The failure screenshot showed the correct final A, but the original failure JSON lacked the intermediate samples and could not establish its cause.

A targeted real Electron run on unchanged `2289234` reproduced the original collector failure. Relative to the last A click, the recorded sequence was:

- 6.9 ms: A content, A heading/sidebar, state revision 369; Send disabled.
- 11.0 ms: B content, B heading/sidebar, revision 370; Send still disabled. The old collector set its permanent foreign-history flag.
- 15.5 ms: A content, A heading/sidebar, revision 371; Send still disabled.
- Approximately 40 ms: final A satisfied every completion gate; no unsafe Send gate was observed. Both on-disk histories retained only their own marker.

The diagnostic recorded no B animation-frame observation, so it does not establish whether B was painted on screen. The navigation contract accepts increasing authoritative state snapshots while the latest transition remains locked; it does not promise to suppress each requested intermediate selection. The collector incorrectly attributed the first A preview to the last A request and then treated a coherent, locked B preview as content under A.

The correction is test-only. History is checked against each distinct requested session's actual displayed title/sidebar, independently of an incoming public-state event that React may not yet have committed. Final completion and unsafe-input checks remain separate hard gates. An obsolete click's microtask can no longer enable a newer request. No product selection, persistence, runtime or timeout behavior changes.

Deterministic validation uses the exact serialized production-test functions:

- Legitimate locked A₁→B→A₃ and microtask-ownership regressions both fail against the original collector and pass after the correction.
- Wrong B content under displayed A, wrong A content under intermediate displayed B, unsafe unlocked Send, model-only wrong-owner unlock while Send stays disabled/pending, and a coherent B return after final A first unlock all remain failures. The public-event-before-DOM case is explicitly covered.
- Removing the history, unsafe-Send, unsafe-model or final-regression guard in isolated mutation controls makes the corresponding tests fail with a nonzero exit. These controls are not changes to application code.
- The helper and unchanged 200 ms advisory-budget suite pass 41 tests. The complete local unit suite passes 520 tests with one Windows-only skip, and the build passes. Actual corrected Electron acceptance and the new exact-SHA full CI remain required before merge/release.

This resolves a measured test-attribution defect; it is not a performance optimization. Cold runtime costs and the earlier Windows EPERM save failure remain separately documented limitations.
