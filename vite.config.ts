import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    {
      name: 'development-csp',
      apply: 'serve',
      // Vite's React preamble is inline. Production retains the strict CSP from index.html.
      transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    },
  ],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
