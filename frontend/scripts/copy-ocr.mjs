// Copies the OCR engine (tesseract.js worker + WebAssembly core + English model) into public/ocr so the identity
// scanner runs entirely from our own server — nothing is fetched from a third-party CDN at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'public', 'ocr');
const nm = path.join(root, 'node_modules');
const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];
fs.mkdirSync(out, { recursive: true });
for (const [from, to] of files) {
  const src = path.join(nm, from);
  if (!fs.existsSync(src)) { if (!from.includes('relaxedsimd')) console.warn('ocr: missing', from); continue; }
  const dst = path.join(out, to);
  if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
}
