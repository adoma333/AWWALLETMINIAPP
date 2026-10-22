// On-device OCR of the MRZ strip (tesseract.js, self-hosted under /ocr). Nothing leaves the phone until the user submits.
import { mrzLines, parseMrz } from './mrz';

let workerP = null;

export function ocrWorker() {
  if (!workerP) {
    workerP = import('tesseract.js').then(async ({ createWorker, OEM, PSM }) => {
      const w = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: '/ocr/worker.min.js', corePath: '/ocr/', langPath: '/ocr', gzip: true, workerBlobURL: false, cacheMethod: 'write',
      });
      await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '0' });
      return w;
    }).catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

export async function stopOcr() {
  if (!workerP) return;
  const p = workerP;
  workerP = null;
  try { (await p).terminate(); } catch { /* already gone */ }
}

/** Prepare the bottom band of a document image for OCR: crop, upscale, grayscale, adaptive threshold. */
function mrzBand(src, fromY = 0.62) {
  const sw = src.width;
  const sh = src.height;
  const y0 = Math.floor(sh * fromY);
  const bh = sh - y0;
  const scale = Math.min(3, 1600 / sw);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = Math.round(bh * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, y0, sw, bh, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = v; sum += v; }
  const mean = sum / (d.length / 4);
  const thr = mean * 0.78;
  for (let i = 0; i < d.length; i += 4) { const v = d[i] < thr ? 0 : 255; d[i] = v; d[i + 1] = v; d[i + 2] = v; }
  g.putImageData(img, 0, 0);
  return c;
}

/** Read the MRZ from a captured document canvas. Tries two band heights; returns the best parse. */
export async function readMrz(canvas) {
  const w = await ocrWorker();
  let best = { valid: false, format: null };
  for (const from of [0.6, 0.45]) {
    const { data } = await w.recognize(mrzBand(canvas, from));
    const res = parseMrz(mrzLines(data.text));
    if (res.valid) return res;
    if (res.format && !best.format) best = res;
  }
  return best;
}
