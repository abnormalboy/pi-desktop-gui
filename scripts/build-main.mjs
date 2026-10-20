import { build } from 'esbuild';
await build({
  entryPoints: ['electron/pi-bridge.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist-electron/pi-bridge.mjs',
  external: ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai/compat'],
});
await build({
  entryPoints: ['electron/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist-electron/main.cjs',
  external: ['electron'],
  sourcemap: true,
});
await build({
  entryPoints: ['electron/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist-electron/preload.cjs',
  external: ['electron'],
  sourcemap: true,
});
