import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Never ship source maps to production: they let anyone reconstruct the
  // original TS (endpoint names, secret-handling paths, admin guards) from
  // the shipped bundle. Vite's default for prod build is already false, but
  // we pin it explicitly so a future preset change can't regress F-15.
  build: { sourcemap: false },
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': {
        target: 'ws://localhost:3002',
        ws: true,
        rewrite: (path) => path.replace(/^\/ws/, ''),
      },
    },
  },
});
