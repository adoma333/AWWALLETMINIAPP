import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// a build id baked into the bundle + version.json → open apps detect new releases and reload
const BUILD_ID = Date.now().toString(36);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'aw-version',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ v: BUILD_ID }) });
      },
    },
  ],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { proxy: { '/api': 'http://127.0.0.1:8000', '/tonconnect-manifest.json': 'http://127.0.0.1:8000' } },
  build: {
    chunkSizeWarningLimit: 900,
    target: 'es2019',
    // the admin panel is a second page of the same build → served at /admin/
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin/index.html') } },
  },
});
