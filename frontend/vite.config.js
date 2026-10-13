import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  build: { chunkSizeWarningLimit: 900, target: 'es2019' },
});
