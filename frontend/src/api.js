import { useCallback, useEffect, useState } from 'react';
import { loader } from './loader';
import { getToken } from './session';
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
      headers: { 'Content-Type': 'application/json', 'X-Tg-Platform': window.Telegram?.WebApp?.platform || 'web',
        ...(initData ? { 'X-Init-Data': initData } : getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('offline', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    // a limit that identity verification would raise → the app offers verification (see App.jsx)
    if (res.status === 401 && data?.error === 'session_expired') window.dispatchEvent(new Event('aw:signed-out'));
    if (data?.params?.kyc === 'True') window.dispatchEvent(new CustomEvent('aw:kyc-offer', { detail: data.params }));
    throw new ApiError(data?.error || 'server_error', res.status, data?.params || {});
  }
  return data;
}

// Last good answer of every GET: screens render from it instantly and refresh quietly in the background.
const cache = new Map();
const inflight = new Map();
function getCached(p, silent) {
  if (inflight.has(p)) return inflight.get(p);
  const pr = request('GET', p, undefined, silent).then((d) => { cache.set(p, d); return d; }).finally(() => inflight.delete(p));
  inflight.set(p, pr);
  return pr;
}

export const api = {
  get: (p, opts) => getCached(p, opts?.silent || cache.has(p)),
  cached: (p) => cache.get(p),
  put: (p, d) => cache.set(p, d),
  forget: (prefix) => { for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k); },
  prefetch: (paths) => paths.forEach((p) => { if (!cache.has(p)) getCached(p, true).catch(() => {}); }),
  post: (p, b = {}) => { const r = request('POST', p, b); r.then(() => invalidate(p)).catch(() => {}); return r; },
  patch: (p, b = {}) => { const r = request('PATCH', p, b); r.then(() => invalidate(p)).catch(() => {}); return r; },
  del: (p) => { const r = request('DELETE', p); r.then(() => invalidate(p)).catch(() => {}); return r; },
};

// after a change, cached reads of the same area are dropped (e.g. POST /api/alerts → GET /api/alerts, /api/assets/…)
function invalidate(p) {
  const area = p.split('?')[0].split('/').slice(0, 3).join('/');
  for (const k of cache.keys()) if (k.startsWith(area) || k.startsWith('/api/txs') || k.startsWith('/api/notifications')) cache.delete(k);
}

/** Data for a screen: cached value right away (no spinner), fresh value as soon as it arrives. */
export function useApi(path, { silent = false } = {}) {
  const [data, setData] = useState(() => (path ? cache.get(path) : undefined));
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    if (!path) return Promise.resolve();
    return getCached(path, silent || cache.has(path)).then((d) => { setData(d); setError(null); return d; }).catch((e) => { setError(e); if (!cache.has(path)) setData(false); });
  }, [path, silent]);
  useEffect(() => { setData(path ? cache.get(path) : undefined); load(); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, load, setData, error];
}

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
