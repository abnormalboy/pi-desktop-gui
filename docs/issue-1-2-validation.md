# Issues #1 and #2: validation notes

## Confirmed causes and scope

- #1: The renderer applied `settings.theme` to CSS only. `electron/main.ts` did not set `nativeTheme.themeSource`; Windows/Linux retained the native frame and menu, and business confirmations used `dialog.showMessageBox`.
- #2: Re-selecting the active configuration tab cleared its loaded document without changing the tab, so its loading effect never ran again. Editing and save controls then stayed disabled. A shared pending/running gate also disabled unrelated local editing while Pi was connecting, and `configSave` reported a reconnect error after the file had already been saved.

## Changes

- Windows/Linux get themed File/Edit/View menus and window controls. macOS keeps its native traffic lights and application menu. Native theme selection is synchronized at startup, on setting changes, and with system appearance.
- Business confirmations render in the existing modal UI; Escape, backdrop dismissal, and close cancel. Main-process request IDs validate answers, ignore duplicate replies, and cancel on renderer reload/crash. Hidden/minimized windows are shown for confirmations. Before the renderer subscribes, or after a renderer crash, a native fallback remains available.
- Existing session deletion still uses the system trash for session files; this change does not permanently delete them or alter restore behavior.
- Pi configuration loading, local editing, and engine operations have separate availability rules. Unsupported/CLI-only behavior and unmet prerequisites are explained. Configuration scope/document responses are versioned to prevent stale reads overwriting a newer scope or edit. Saving reports disk persistence separately from applying/reconnecting Pi.

## Checks

- `npm run build`: TypeScript and production build passed. Existing bundle-size warning remains.
- `npm test`: 112/112 unit tests passed on the final implementation.
- `npm run test:integration`: passed with the real Pi RPC/local provider fixture.
- `npm run test:features`: passed (feature, management, workflow, session-context, model-errors, coding, approval, recovery, checkpoint suites).
- `npm run test:desktop-chrome`: new renderer regression suites for titlebar/menu/dialog behavior and settings state races. Wired into Linux CI.
- Full Electron and Chromium UI execution was blocked locally by the container rejecting Unix sockets (`Operation not permitted`). No bypass was attempted. Renderer tests and native window dragging, minimize/maximize/restore, macOS hidden-window quit, and Windows titlebar behavior therefore still need CI/real-desktop validation. A Chromium renderer pass does not substitute for native Windows/macOS checks.

No release, merge, deployment, or issue closure is part of this change.
