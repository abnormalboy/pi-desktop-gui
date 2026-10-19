# Issue #18: restart-update result validation

Status: 2026-10-19 UTC. This report concerns a verified silent-result gap. The reporter's specific v0.14.18 to v0.14.19 failure remains under investigation; issue #18 must remain open.

## Reported behavior and confirmed scope

- [Issue #18](https://github.com/yeyuProject/pi-desktop-gui/issues/18) records the reporter's current-version screenshot, v0.14.18, and downloaded target, v0.14.19.
- The reporter confirmed clicking the update dialog's actual **立即重启** action. This was not merely opening the release notes.
- Whether the original window exited, whether a new process opened automatically, and which installation or shortcut was used are not yet confirmed for this report.
- The actual released v0.14.19 Windows setup was downloaded and checked against its GitHub SHA256 digest and the published latest.yml SHA512. Its embedded app.asar/package.json and renderer are v0.14.19. The v0.14.18/v0.14.19 embedded app-update.yml files are complete and have the same repository/cache configuration. This rules out a mislabeled v0.14.18 payload in the inspected setup; it does not prove installation worked on the reporter's machine.

## Verified defect

The released driver invokes `quitAndInstall(true, true)`. In electron-updater 6.8.9, NsisUpdater starts the installer detached and reports a successful launch before installation has completed. BaseUpdater then schedules application quit. The native driver does not observe the installer's exit status.

A regression using the production nativeUpdateDriver and real NsisUpdater, with isolated POSIX executable stand-ins that launch and then exit 2 or 23, demonstrates that the app quits and no updater error event is produced. Before this change there was no durable application-side attempt result to reconcile on the next startup. These controlled stand-ins prove the launch/result boundary; they do not reproduce a particular Windows installer failure or identify the reporter's cause.

## Narrow repair

[Candidate 529035856b9ae513d072fd49f00b6691296553d3](https://github.com/yeyuProject/pi-desktop-gui/commit/529035856b9ae513d072fd49f00b6691296553d3), based on facbfa945cf3e59374a0320e673a668785e4b499:

- On Windows NSIS, explicit restart requests visible one-click installation, preserving automatic force-run after installation. Normal on-quit installation is unchanged.
- One small receipt records only the source version, target version, timestamp and outcome. No executable paths, error details or logs are stored. Receipts older than seven days are deleted at the next startup; the file is not managed by an unrelated background task.
- The next startup compares the actual running version with the recorded target. An unchanged version is **unconfirmed**, not proof that an installer failed: installation could still be running or the user could have cancelled it. The UI says so and provides recheck/download actions.
- Native errors during installation use installation-stage wording rather than automatically blaming the network.
- An updater error arriving during the asynchronous receipt write cancels installation.
- Failed update preparation retains the existing workspace watcher. Its callback remains suppressed while quitting and resumes if preparation fails; normal application close still disposes it.

## Executed local checks

Environment: Linux, Node 24.19.0. These results do not replace Windows acceptance.

- `npm run build`: passed, including TypeScript, renderer and main-process bundles. Existing renderer chunk-size advisory remains.
- `npm test`: 348 tests, 347 passed, one platform-specific skip, zero failures.
- Targeted `tests/updater.test.ts` and `tests/update-attempt.test.ts`: 18 passed.
- Prettier checks and `git diff --check`: passed.
- Independent reviews covered native argument mapping, the receipt write race, minimal persistence, startup outcome wording and watcher recovery. No remaining review blocker was found.

## Candidate CI acceptance passed

[Full candidate CI 39236930947](https://github.com/yeyuProject/pi-desktop-gui/actions/runs/39236930947) completed successfully on exact candidate 529035856b9ae513d072fd49f00b6691296553d3. All five test jobs succeeded: three-platform build/unit/integration/features acceptance, Windows update roundtrip, and Linux update roundtrip. Package/release jobs were intentionally skipped for the development branch; no release was published by this run.

[Linux update-roundtrip job 118008155687](https://github.com/yeyuProject/pi-desktop-gui/actions/runs/39236930947/job/118008155687) passed (10:24:42–10:25:01 UTC). [Windows update-roundtrip job 118008155506](https://github.com/yeyuProject/pi-desktop-gui/actions/runs/39236930947/job/118008155506) passed: real receipt-write-failure recovery and watcher notification at 10:26:36 UTC; visible explicit restart automatically installed/reopened the target at 10:26:52; normal on-quit at 10:27:18; portable-to-installer at 10:27:45. The new completed-receipt assertions ran successfully. [Linux feature/UI job 118008155552](https://github.com/yeyuProject/pi-desktop-gui/actions/runs/39236930947/job/118008155552) explicitly passed the unchanged-version notice and target-installer download entry at 10:26:34 UTC.

New production-app update-roundtrip assertions, executed successfully on both Windows and Linux:

1. Use a selected real project and native workspace watcher in the packaged update fixture.
2. Make the receipt destination a directory so its atomic rename fails deterministically.
3. Click the real restart action, require the original version to remain active and installing to reset.
4. Clear earlier captured events, create a project file, and require a new workspaceChanged notification.
5. Remove the blocker, retry, and require automatic target-version startup with a reconciled completed receipt.

The existing Windows/Linux fixture uses freshly built 0.9.0 and 0.9.1 copies of current application code, an isolated package identity/GUID/data directory and disabled installer shortcuts. It verifies candidate behavior, data preservation and update mechanics. It is not a released v0.14.18-to-v0.14.19 test.

## Separate released-package baseline

An isolated diagnostic branch runs the untouched released v0.14.18 and v0.14.19 Windows NSIS installers, using the production identity, registry location and shortcuts on an empty ephemeral GitHub-hosted Windows runner. Only update transport is pinned to the historical v0.14.19 feed. The harness must never manually launch the target app after the restart click.

Acceptance requires a different automatically started main process with a visible window, installed ASAR and executable versions of v0.14.19, an updated registry/shortcut path and preserved draft/approval mode. Artifacts include pinned asset hashes, update/network states, process start/stop evidence and installed payload versions. A harness or transport error is inconclusive, not proof of an updater defect.

[First historical diagnostic run 39237584291](https://github.com/yeyuProject/pi-desktop-gui/actions/runs/39237584291), exact diagnostic-only SHA34157e55d985e032b618237650650e280daaba79, stopped before any restart click at a production-registry-path assertion. Its artifact classifies the result as inconclusive-before-restart-click. The pinned released v0.14.18 payload was installed and both shortcuts pointed to the expected executable. The harness used an incorrect hardcoded installer GUID and assumed an unversioned uninstall display name; both assumptions are now being corrected against the actual pinned NSIS headers and builder UUID calculation. This is a diagnostic harness failure, not evidence that the product upgrade failed. A corrected historical baseline remains pending.

Even a successful clean-runner baseline would not disprove the reporter's experience or close issue #18; device-specific installation, process, path or cancellation evidence would still be needed.
