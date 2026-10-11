import { build, Platform } from 'electron-builder';
// Level 5 keeps rebuilds practical without changing application contents.
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ??= '5';
await build({ targets: Platform.WINDOWS.createTarget('portable') });
