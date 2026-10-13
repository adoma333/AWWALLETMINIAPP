import { createContext, useContext } from 'react';
import en from './locales/en.json';
import { tgUser } from './telegram';

export const LANGS = [
  ['en', 'English'], ['ar', 'العربية'], ['ru', 'Русский'], ['tr', 'Türkçe'], ['fa', 'فارسی'], ['fr', 'Français'], ['es', 'Español'],
  ['pt', 'Português'], ['de', 'Deutsch'], ['id', 'Bahasa Indonesia'], ['hi', 'हिन्दी'], ['zh', '中文'], ['uk', 'Українська'], ['uz', "O'zbekcha"],
];
const SUPPORTED = new Set(LANGS.map(([c]) => c));
const RTL = new Set(['ar', 'fa']);
const loaders = import.meta.glob('./locales/*.json');
const cache = { en };

/** Pick the language without asking: saved choice → server profile → Telegram → device. */
export function detectLang(serverLang) {
  try {
    const saved = localStorage.getItem('aw_lang');
    if (saved && SUPPORTED.has(saved)) return saved;
  } catch { /* storage blocked */ }
  if (serverLang && SUPPORTED.has(serverLang)) return serverLang;
  const cands = [tgUser?.language_code, ...(navigator.languages || [navigator.language])];
  for (const c of cands) {
    const base = String(c || '').toLowerCase().split(/[-_]/)[0];
    if (SUPPORTED.has(base)) return base;
    if (['ur', 'ps'].includes(base)) return 'fa';
    if (['ku', 'ckb'].includes(base)) return 'ar';
    if (['be', 'kk', 'ky', 'tg'].includes(base)) return 'ru';
    if (['az', 'tk'].includes(base)) return 'tr';
    if (base === 'ms') return 'id';
  }
  return 'en';
}

export async function loadLang(code) {
  if (cache[code]) return cache[code];
  const fn = loaders[`./locales/${code}.json`];
  if (!fn) return en;
  const mod = await fn();
  cache[code] = mod.default || mod;
  return cache[code];
}

export function makeT(dict) {
  return (key, params) => {
    let s = dict[key] ?? en[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v ?? ''));
    return s;
  };
}

export function applyDir(code) {
  const html = document.documentElement;
  html.lang = code;
  html.dir = RTL.has(code) ? 'rtl' : 'ltr';
}

export const I18n = createContext({ lang: 'en', t: makeT(en), setLang: () => {} });
export const useI18n = () => useContext(I18n);

export function errText(t, e) {
  const code = e?.code || 'server_error';
  if (code === 'offline') return t('offline');
  const key = `err_${code}`;
  const s = t(key, e?.params || {});
  return s === key ? t('error_generic') : s;
}
