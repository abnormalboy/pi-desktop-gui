import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
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
