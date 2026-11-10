import { defineConfig } from 'vitest/config';
import { defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // onnxruntime-web's "extern wasm" build: loads its runtime only from wasmPaths (public/ort, see src/photo/ml.ts), so the
  // bundler does not emit a second 27 MB copy of the same wasm.
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
  plugins: [
    react(),
    // Precaches the app shell (incl. the ONNX wasm runtime) so the built app works offline after first load.
    // Model weights are cached separately by transformers.js in the Cache API.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: { name: 'Room Planner', short_name: 'Room Planner', display: 'standalone', theme_color: '#f4a261', icons: [] },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,wasm,png,svg,ico}'],
        maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
