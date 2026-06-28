import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Copies Tesseract.js WASM core files and the worker script into the
 * extension's dist directory so they are served from the extension origin.
 * Runs after bundle output is written. Missing files emit a warning rather
 * than failing the build — the gate suite does not require these at build time.
 */
function copyTesseractAssets(): Plugin {
  return {
    name: 'copy-tesseract-assets',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist/tesseract');
      mkdirSync(outDir, { recursive: true });
      mkdirSync(resolve(outDir, 'lang'), { recursive: true });

      const workerSrc = resolve(__dirname, 'node_modules/tesseract.js/dist/worker.min.js');
      if (existsSync(workerSrc)) {
        copyFileSync(workerSrc, resolve(outDir, 'worker.min.js'));
      } else {
        console.warn('[copy-tesseract-assets] worker.min.js not found — skipping');
      }

      // pnpm hoists tesseract.js-core into the workspace virtual store.
      const coreCandidates = [
        resolve(__dirname, 'node_modules/tesseract.js-core'),
        resolve(
          __dirname,
          '../../../node_modules/.pnpm/tesseract.js-core@7.0.0/node_modules/tesseract.js-core',
        ),
      ];
      const coreDir = coreCandidates.find(existsSync);

      if (coreDir !== undefined) {
        const coreFiles = [
          'tesseract-core.wasm.js',
          'tesseract-core-simd.wasm.js',
          'tesseract-core-simd.wasm',
          'tesseract-core-lstm.wasm.js',
          'tesseract-core-lstm.wasm',
          'tesseract-core-simd-lstm.wasm.js',
          'tesseract-core-simd-lstm.wasm',
        ];
        for (const file of coreFiles) {
          const src = resolve(coreDir, file);
          if (existsSync(src)) copyFileSync(src, resolve(outDir, file));
        }
      } else {
        console.warn('[copy-tesseract-assets] tesseract.js-core not found — skipping WASM copy');
      }

      // eng.traineddata must be placed manually at public/tesseract/lang/eng.traineddata
      // before building for production. The file (~10 MB) is not bundled automatically.
      const langSrc = resolve(__dirname, 'public/tesseract/lang/eng.traineddata');
      if (existsSync(langSrc)) {
        copyFileSync(langSrc, resolve(outDir, 'lang/eng.traineddata'));
      } else {
        console.warn(
          '[copy-tesseract-assets] eng.traineddata not found at public/tesseract/lang/ — OCR will not function at runtime',
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), crx({ manifest }), copyTesseractAssets()],
  build: {
    rollupOptions: {
      input: {
        'offscreen/ocr-host': resolve(__dirname, 'src/offscreen/ocr-host.html'),
      },
    },
  },
});
