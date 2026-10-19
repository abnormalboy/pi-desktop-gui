# Retry UI collection assertions: controlled Electron regression

## Baseline and CI evidence

Branch `fix/retry-ui-array-assertions` starts at main `6cc2186a16e708f58a9fe9c07bc175d9884e724e`, the unpublished v0.14.21 candidate. The earlier five-issue branch is untouched. The implementation patch changes four assertions in `scripts/test-retry-ui.mjs`; there are no product, fixture helper, version, workflow or timeout changes.

[Diagnostic CI 39238411494, Linux job 118013030962](https://github.com/yeyuProject/pi-desktop-gui/actions/runs/39238411494/job/118013030962) failed at line 220: the single-element text assertion resolved to both `Newest failure.` and `New turn failure.` and raised strict mode violation. The preceding scenario intentionally renders those two errors. A following fixture publication is asynchronous with respect to renderer consumption; completion in the main process does not establish the next DOM state. The full decoded CI job log is retained at `/tmp/pi-retry-array-proof/ci-job.txt`; its [exact failure excerpt](retry-ui-array-assertions/ci-excerpt.txt) is committed.

## Actual Electron reproduction and controls

The temporary probe runs the complete real-Pi retry test, then intercepts only the existing deterministic fixture's cancelled-scenario publication. It holds that one event while leaving the previous real DOM intact. It records queued/delivered main-process events, renderer receives, DOM text arrays and assertion outcomes. No product code or assertion-selector filtering is introduced. The [probe patch](retry-ui-array-assertions/probe.patch) applies to the candidate test; its `RETRY_ARRAY_PROBE=red|array|drop|extra|wrong` modes explicitly select the original scalar or candidate array assertion.

| Mode                      | DOM before assertion                   | Delivered next state                                                         | Observed result                                                                                                                                                |
| ------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original scalar (`red`)   | `[Newest failure., New turn failure.]` | Held until the original assertion fails; then released                       | Immediate strict mode failure, before release. The same application subsequently renders `[Newest failure.]`. The full failure/release observation takes 36ms. |
| Candidate array (`array`) | Same two-element old DOM               | Original cancelled runtime released after a 200ms diagnostic transport delay | Assertion waits and passes with exactly `[Newest failure.]`; observed elapsed time 354ms. The complete test then passes through recovery, paging and reload.   |
| Dropped event (`drop`)    | Same two-element old DOM               | Nothing delivered                                                            | Fails at the array assertion: the old second error remains.                                                                                                    |
| Extra error (`extra`)     | Same two-element old DOM               | `[Newest failure., Extra failure.]` in a separate user turn                  | Fails at the array assertion: an extra element cannot be accepted.                                                                                             |
| Wrong text (`wrong`)      | Same two-element old DOM               | `[Wrong failure.]`                                                           | Fails at the array assertion: matching cardinality cannot hide incorrect content.                                                                              |

The three negative controls use a shorter 1-second diagnostic assertion bound. The committed test retains its existing 5-second expect timeout; no retries or sleeps are added. The 200ms release delay exists only in the probe. Every probe checks the two-element precondition before attempting the assertion. Mode JSON files preserve full receive/send observations and failure messages; [positive](retry-ui-array-assertions/array.png), [extra-error](retry-ui-array-assertions/extra.png) and [wrong-text](retry-ui-array-assertions/wrong.png) screenshots capture actual Electron output. The red screenshot is intentionally not presented as the old DOM: after recording its failure, the probe releases the event to establish that the product converges without a product fix.

## Adjacent assertion audit

- All three singleton expectations on the `inlineErrors` collection now use a one-item array: the mixed error, appended error and cancelled scenario. This retains exact text and enforces exactly one element, while allowing a previous multi-element DOM to transition.
- The recovered reply expectation similarly uses `[/Recovered reply/]` on the assistant collection. Its original regex remains unchanged and cardinality remains exactly one.
- Search-active locators and the single history summary retain their existing unique-element contract. History expand/collapse and paging already wait on explicit counts or new summary/index values. The real-provider phase's one-time count/text reads follow completed/stopped or detached-element conditions; those assertions remain intact. Action payload reads follow the existing explicit action-count wait.
- No `.first()`, text filter, partial-content substitution, weaker expected value, timeout increase or retry was used to obtain a pass.

## Validation

- Build/typecheck on the latest main baseline: passed (existing bundle warning only).
- `node --check scripts/test-retry-ui.mjs` and Prettier check: passed.
- Original scalar controlled reproduction: failed as expected with strict mode violation.
- Candidate controlled delayed publication: passed, including the complete retry script.
- Drop/extra/wrong negative controls: all failed as expected at the intended array assertion (exit 1).
- Uninstrumented `DISPLAY=:99 node --import tsx scripts/test-retry-ui.mjs`: passed end to end. This includes actual Pi recovery, cancellation, exhaustion and following runs, plus deterministic mixed/grouped failures, search, terminal actions, paging and reload.

Logs and JSON for every result are in [retry-ui-array-assertions/](retry-ui-array-assertions/). Only the relevant retry UI test and its controls were run; unrelated diagnostic/UI suites were not rerun. Temporary probe scripts are removed from the executable test directories. Branch CI is independent of these local results and remains to be checked after push.
