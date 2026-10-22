import { loader } from './loader';
import { initData } from './telegram';

export class ApiError extends Error {
  constructor(code, status, params = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.params = params;
  }
}

async function request(method, path, body, silent = false) {
  if (!silent) loader.start();
  try {
    return await send(method, path, body);
  } finally {
    if (!silent) loader.done();
  }
}

async function send(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Init-Data': initData, 'X-Tg-Platform': window.Telegram?.WebApp?.platform || 'web' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('offline', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(data?.error || 'server_error', res.status, data?.params || {});
  return data;
}

export const api = {
  get: (p, opts) => request('GET', p, undefined, opts?.silent),
  post: (p, b = {}) => request('POST', p, b),
  patch: (p, b = {}) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};

export const idem = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function fileToDataUrl(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('no file'));
    if (!file.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
