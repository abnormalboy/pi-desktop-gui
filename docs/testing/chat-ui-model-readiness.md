# Chat UI: model clicks across selection boundaries

## Candidate and failure evidence

Branch `fix/chat-ui-model-readiness` starts at `013966f8b7e290bdd8c5d31dd0c3c01e6332fba3` (main ancestor `6cc2186a16e708f58a9fe9c07bc175d9884e724e`, unpublished v0.14.21 candidate). The four retry collection-assertion changes remain byte-for-byte intact and the complete retry UI script is executed again. Product code and versions are unchanged.

[CI 39240824438, Linux job 118020920242](https://github.com/yeyuProject/pi-desktop-gui/actions/runs/39240824438/job/118020920242) timed out in `expectSelectedModel` at line 102, called from line 402. The preceding missing-file deletion case passed at 10:57:08.595; model-label polling timed out at 10:57:33.664 and renderer errors were empty. The [failure excerpt](chat-ui-model-readiness/ci-excerpt.txt) is preserved; the complete decoded job log is at `/tmp/pi-chat-boundary-proof/ci-job.txt` in the task environment.

The connected artifact tool supplied metadata for Linux artifact 12180624585, but the execution environment's download tunnel returned HTTP 403. No original CI screenshot download is claimed. The coordinator separately verified its screenshot: new standalone chat, disconnected Pi, 选择模型, and a picker saying 尚未连接 Pi and 请等待当前操作完成. The artifact has no chat runtime/state JSON; the earlier desktop-layout ui-result.json is not chat evidence. The original CI cannot retrospectively tell us the clicked session ID or actual pending flag.

## Actual Electron causal reproduction

The [race probe](chat-ui-model-readiness/race-probe.patch), applied to candidate 013966f8, holds only the final newSession IPC before its real handler executes. All UI and connection behavior is production code, using real Pi and isolated local fixtures. A read-only diagnostic inspects committed Composer/ModelPicker props through React's fiber to obtain actual pending/canConnect flags; this internal inspection is confined to the temporary probe, not the committed test's readiness predicate.

The [recorded states](chat-ui-model-readiness/new-session-race.json) show:

| Stage                                            | Selected scope             | pending                | sessionEnabled / canConnect | Picker and connection                                               |
| ------------------------------------------------ | -------------------------- | ---------------------- | --------------------------- | ------------------------------------------------------------------- |
| Before/while newSession is held                  | Old untrusted project      | false                  | false / false               | Closed, no model                                                    |
| User clicks 选择模型 while held                  | Same old untrusted project | false                  | false / false               | Opens; no connect IPC                                               |
| Real newSession is released and new view settles | New standalone ID          | false                  | true / true                 | Still open, no model, no connect IPC                                |
| After a bounded 1-second observation             | Same new standalone ID     | false                  | true / true                 | Same disconnected UI and misleading waiting footer                  |
| User explicitly clicks 重新连接 Pi               | Same new standalone ID     | false after completion | true / true                 | Actual Pi connects, correct base model loads; normal test continues |

The [local screenshot](chat-ui-model-readiness/new-session-race.png) reproduces the coordinator's described CI appearance. The [explicit reconnect record](chat-ui-model-readiness/new-session-recovery.json) establishes that the actual connection and model initialization work for the correct new session. No prompt is sent by initialization.

This does **not** establish that the original CI had pending=false: its telemetry is missing. It does establish a real, reproducible cause matching the visible failure, and disproves treating the footer text as proof of pending. `modelLocked` is also true when the model list is empty. ModelPicker starts connecting only on an opening click whose current canConnect is true; it has no later effect that forwards an earlier, blocked click to a newly selected session.

An ordinary user can enter the same early-click state under a slow main-process turn. This is not unique to the test fixture. The original click is nevertheless on an untrusted old context, so silently forwarding it to a future session would change the connection/trust policy. There is an explicit working reconnect action once the new session is ready. The verified CI defect is that its helper assumed a new-session button click had already committed the new target, and checked selection/runtime only after waiting for a model label.

The early-click interaction gap and ambiguous empty-model footer remain product UX limitations. A separate minimal UX change could close the old picker on selection changes or distinguish empty models from pending in the footer. This test repair does not implement either or queue a connect intent across session IDs. No correct-target, ready-state model click failed in these experiments.

## Unified test preconditions and audit

A single synchronous `chatViewReady` predicate reads subscribed state and the current DOM; it performs no bootstrap polling, connection, resend or other state mutation. Before model clicks it requires the intended ID/scope, project consistency/trust, matching active sidebar row and header, restored draft when specified, writable storage, no send-button pending spinner, and no busy/configuration/crash guard for that target. Disconnected cold sessions are allowed: requiring connected here would defeat on-demand Pi behavior.

`newStandalone` establishes the distinct standalone target for the scenarios that deliberately leave an already-used/drafted chat or a project. The existing blank-session reuse policy is not changed. `expectSelectedModel` requires the explicit target ID, checks view readiness **before** opening, and retains the original real model, connected runtime, checked picker item and model label assertions afterward. It additionally asserts the selected ID equals the intended target. Original 25-second model and 30-second selection bounds are unchanged; no fixed sleep is added.

| Script boundary                                        | Audit/change                                                                                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Initial unavailable Pi, retry, IME and model switching | Existing intentional failure/retry and real model checks retained. Their locators belong to the current application instance.                                                                                            |
| Ctrl/Cmd+N after a used chat                           | Wait for a different standalone target and empty draft, then open its model picker and verify its native default; zero prompt assertion retained.                                                                        |
| Switch to first saved chat; restart                    | Verify the exact ID/draft and no pending before continuing. Post-restart actions use fresh-page locators.                                                                                                                |
| Session search then add project                        | Verify the intended search result ID before creating the project.                                                                                                                                                        |
| Untrusted project                                      | Existing send/trust assertions retained; an added real UI negative case opens its picker and verifies reconnect is disabled, trust remains visible and no connection error is produced.                                  |
| Global new chat from a project                         | Establish the new standalone ID before model loading; existing output/readiness/default-model checks retained.                                                                                                           |
| Select project session; create another project session | Check exact selected ID, expected project ID, then a different ID within that same project. Original row counts retained.                                                                                                |
| Delete a different session with missing history        | Verify the selected project session remains selected after removal; deletion of an inactive record is not a readiness signal for a future new chat.                                                                      |
| New chat after deletion                                | Establish standalone target before model click; this is the failed CI boundary.                                                                                                                                          |
| New B while A streams                                  | Readiness is scoped to B, so A may continue running. Existing held-response, no-prompt, independent model and targeted-stop assertions remain.                                                                           |
| Future failures                                        | A bounded chat-ui-failure-state.json records expected/observed IDs, project/trust, DOM pending indicator, connection/model and model-check stage. No settings, credentials, transcript or full runtime dump is included. |

A development run caught a new negative-case locator that still referenced the page from before the script's real application restart. It failed with Target page closed; the case now creates its picker locator from the current page. The [failure log](chat-ui-model-readiness/chat-locator-before.txt) is retained; no timeout or assertion was relaxed.

## Controlled positive and negative checks

The [guard probe](chat-ui-model-readiness/guard-probe.patch) applies to the candidate test. It gates real newSession and selectSession replies; it does not simulate a model result.

- **Positive new-session gate:** while the old untrusted project is selected, readiness is false, the picker remains closed and connect-call count is zero. After release, exactly the new ID is explicitly connected and the base model is verified.
- **Positive selection gate:** the target cold standalone is already selected, but its selectSession reply is held. Actual pending=true, send spinner=true and canConnect=false. The model helper remains before its click. After release it connects the intended ID and verifies the base model. The script then returns to A and completes its original independent-streaming scenario.
- **Wrong-target negative:** the probe deliberately keeps the old untrusted selection after newSession returns. The view predicate times out before a model click, with zero connect IPCs. It cannot pass on an unrelated model label or another session.
- **Pending negative:** selectSession remains unresolved for the correct target. The predicate times out before a model click; there is no connect call for that target. A prior valid connection to A is recorded separately. These two negative controls use a shorter 1-second diagnostic precondition bound and intentionally exit 1 with EXPECTED_NEGATIVE after verifying the rejected outcome. The committed bounds remain unchanged.

[State JSON and logs](chat-ui-model-readiness/) include the actual pending/project/runtime/DOM states and IPC traces for these checks. Temporary probe executables are removed from scripts before delivery. No product instrumentation is committed.

## Final validation

- Full uninstrumented chat UI: passed, including original model failure/retry, IME, native default, search, deletion, trust, concurrent streaming and targeted-stop checks plus the new semantic preconditions and untrusted-picker negative.
- Full retry UI: passed, including real Pi recovery/cancellation/exhaustion and all deterministic grouping/search/paging/terminal/reload cases. The four assertions from 013966f8 remain unchanged.
- Controlled old-context reproduction, explicit reconnect recovery, new/selection positive gates, wrong-target and pending negative gates: completed as described; their outcomes are preserved separately from normal test results.
- Node syntax check, modified-file Prettier and source diff checks: passed. Product code is byte-for-byte unchanged; no unrelated diagnostic or full feature-suite rerun is claimed. Fresh branch CI remains separate from these local results.
