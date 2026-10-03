import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  'img-src * data: blob:',
  'media-src * blob:',
  'connect-src *',
  "worker-src 'self' blob:",
].join('; ');

// Strict CSP for packaged builds only (Vite's dev server needs inline scripts).
const cspPlugin = {
  name: 'relay-csp',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
  ],
};

export default defineConfig({
  base: './',
  plugins: [react(), cspPlugin],
  server: { port: 5173, strictPort: true },
  optimizeDeps: {
    // The crypto WASM module must be loaded from its own package, not pre-bundled.
    exclude: ['@matrix-org/matrix-sdk-crypto-wasm'],
  },
  build: { target: 'esnext', outDir: 'dist', chunkSizeWarningLimit: 4000 },
});
