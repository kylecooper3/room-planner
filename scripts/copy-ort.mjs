// Copies the onnxruntime-web WASM runtime into public/ort so ML inference works offline
// (transformers.js otherwise fetches it from a CDN). Runs on postinstall.
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ort');
try {
  // Resolve the copy transformers.js itself depends on, so versions always match.
  const req = createRequire(join(root, 'node_modules', '@huggingface', 'transformers', 'package.json'));
  let dir = dirname(req.resolve('onnxruntime-web'));
  if (!existsSync(join(dir, 'ort-wasm-simd-threaded.wasm')) && existsSync(join(dir, 'dist'))) dir = join(dir, 'dist');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // Only the pair the WebGPU/WASM build that transformers.js imports actually loads (single-threaded, no COOP/COEP).
  const files = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];
  for (const f of files) cpSync(join(dir, f), join(out, f));
  console.log(`copy-ort: copied ${files.length} files to public/ort`);
} catch (e) {
  console.warn('copy-ort: skipped (' + e.message + '). ML features will fall back to non-ML paths offline.');
}
