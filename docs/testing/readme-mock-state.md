# README screenshot mock state contract

The Linux CI for `e3dbec57` stopped in `readme-screenshots.mjs` waiting for the chat title. Its independent `window.desktop` mock returned bootstrap state without a revision and had no `navigationState`. Production `useRuntime` correctly rejected that unnumbered state. Later Linux chat/navigation/features/retry/theme steps were not reached by that run.

The only existing script changed here is `scripts/readme-screenshots.mjs`: bootstrap and completion snapshots share a positive increasing counter and use `structuredClone`. The renderer, timeout values, selectors and product behavior are unchanged. Existing published README assets are not overwritten.

`tests/readme-mock-state.test.mjs` executes the actual standalone initializers from both README scripts without starting their servers. It checks safe integer revisions, monotonic interleaved bootstrap/completion reads and nested snapshot independence. Before the fix, all three screenshot scenarios failed the initial revision assertion while the demo passed. After the fix all four pass. The production runtime's old-state rejection tests are also run unchanged.

## Migration audit

Repository searches covered `window.desktop`/`desktop` assignments, `bootstrap` definitions and interception, `onEvent`, `desktop:event`, and `type: 'state'` publication. Generated files, dependencies and archived historical test patches were excluded. The producer inventory is retained in [audit.txt](readme-mock-state/audit.txt).

| Source                                                                             | Result                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readme-screenshots.mjs`                                                           | The sole missed full-renderer mock; fixed here. Light, dark and approval instances have the new contract tests and actual screenshots.                                                                                    |
| `readme-demo.mjs`                                                                  | Already supplies numbered cloned bootstrap/completion snapshots and numbers state events. Its initializer passes the same contract test unchanged.                                                                        |
| `electron/main.ts` and preload                                                     | Real bootstrap, completion getter and central state sender use the same revision generator. Preload forwards the result/event unchanged. No changes here.                                                                 |
| Runtime overrides in scroll, conversation, polish, update, perf and retry fixtures | Delegate bootstrap to the original main handler, then spread the result to override runtime/update. State and revision survive; `navigationState` delegates unchanged.                                                    |
| Pi-settings browser fixture                                                        | Mounts `PiFeatures` directly with supplied props, not App/useRuntime. Config-document revision strings are a separate contract.                                                                                           |
| Workbench/runtime hook harnesses                                                   | Workbench supplies mocked useRuntime state/receipt metadata and a numbered confirmation; runtime tests explicitly supply numbered state/bootstraps, including intentionally old revisions.                                |
| SSR/platform mocks                                                                 | Render individual components and do not bootstrap App/useRuntime.                                                                                                                                                         |
| Retry fixture unit's unnumbered state                                              | Deliberately tests verbatim forwarding with an incomplete state payload. It is not delivered to production useRuntime. Other direct event injections are runtime/patch/update/storage/dialog events, not state snapshots. |
| `test-management.ts` `desktop` object                                              | An MCP server configuration name, not a window.desktop mock.                                                                                                                                                              |

No other executable full-renderer state producer was missing the new fields. No unrelated fixture or production consumer was changed.

## Actual screenshot verification

The built real UI was rendered by the original screenshot script for all three scenarios. The title wait, workspace/file interaction, preview-toolbar wait, existing 800ms settling wait and page-error assertion all completed unchanged. Visual inspection confirmed the actual light/dark workspace and approval card; each PNG is 2880×1800.

- [Light workspace](readme-mock-state/workspace-light.png)
- [Dark workspace](readme-mock-state/workspace-dark.png)
- [Approval](readme-mock-state/approval.png)

Local Playwright's downloaded Chromium was absent, so an external untracked Node preload selected the already installed `/usr/bin/chromium` (154.0.8037.57) for `chromium.launch`. It changes only the executable path; no page, IPC, wait or assertion is intercepted. [The preload](readme-mock-state/system-chromium-preload.mjs) and [generation log](readme-mock-state/screenshots.txt) are retained. The command was:

```sh
node --import /tmp/pi-readme-system-chromium.mjs scripts/readme-screenshots.mjs test-results/readme-mock-protocol-fix
```

Contract tests, unchanged production revision tests, build, script syntax, Prettier and diff checks passed; logs are in [readme-mock-state/](readme-mock-state/). Fresh CI remains separate. These Linux browser renders with mocked Windows controls are not Windows/macOS native acceptance. No merge, version change, tag, release or issue closure is performed.
