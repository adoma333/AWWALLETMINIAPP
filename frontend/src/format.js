// Locale-aware number/money formatting. Amounts arrive as decimal strings (never floats from the server).
let LOCALE = 'en';
let FX = { USD: '1' };
let CUR = 'USD';
const SYMBOL = { USD: '$', EUR: '€', RUB: '₽', TRY: '₺', SAR: 'SAR ', AED: 'AED ', EGP: 'E£', DZD: 'DA ', MAD: 'MAD ', IQD: 'IQD ', INR: '₹', IDR: 'Rp ', UAH: '₴', BRL: 'R$' };

export function setLocale(lang) {
  LOCALE = { ar: 'ar-u-nu-latn', fa: 'fa-u-nu-latn', zh: 'zh-CN', hi: 'hi-u-nu-latn' }[lang] || lang;
}
export function setFx(rates, currency) {
  if (rates) FX = rates;
  if (currency) CUR = currency;
}
export const currency = () => CUR;

export function num(v, maxFrac = 8, minFrac = 0) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac }).format(n);
}

/** Crypto amount: smart precision (more decimals for tiny values). */
export function amt(v, display = 6) {
  const n = Math.abs(Number(v || 0));
  let frac = display;
  if (n > 0 && n < 1) frac = Math.max(display, Math.min(8, 2 - Math.floor(Math.log10(n)) + 2));
  if (n >= 1000) frac = Math.min(frac, 2);
  return num(v, frac);
}

/** Value in the user's display currency (input in USD). */
export function fiat(usd, digits = 2) {
  const rate = Number(FX[CUR] || 1);
  const v = Number(usd || 0) * rate;
  const sym = SYMBOL[CUR] ?? `${CUR} `;
  const s = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(v));
  return `${v < 0 ? '−' : ''}${sym}${s}`;
}

export function priceFmt(usd) {
  const n = Number(usd || 0);
  if (n === 0) return fiat(0);
  if (n < 0.01) return fiat(n, Math.min(8, 2 - Math.floor(Math.log10(n)) + 2));
  return fiat(n, n < 10 ? 4 : 2);
}

export function pct(v, signed = true) {
  const n = Number(v || 0);
  const s = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(Math.abs(n));
  return `${signed ? (n > 0 ? '+' : n < 0 ? '−' : '') : ''}${s}%`;
}

export function shortAddr(a, n = 6) {
  if (!a) return '';
  return a.length > n * 2 + 3 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}

export function dateTime(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts * 1000));
}

export function dateShort(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' }).format(new Date(ts * 1000));
}

export function timeAgo(ts, t) {
  const d = Date.now() / 1000 - ts;
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  if (d < 60) return rtf.format(-Math.round(d), 'second');
  if (d < 3600) return rtf.format(-Math.round(d / 60), 'minute');
  if (d < 86400) return rtf.format(-Math.round(d / 3600), 'hour');
  if (d < 86400 * 7) return rtf.format(-Math.round(d / 86400), 'day');
  return dateShort(ts) || (t && t('date'));
}

export function inFuture(ts) {
  const d = ts - Date.now() / 1000;
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  if (d < 3600) return rtf.format(Math.max(1, Math.round(d / 60)), 'minute');
  if (d < 86400) return rtf.format(Math.round(d / 3600), 'hour');
  return rtf.format(Math.round(d / 86400), 'day');
}

export function mmss(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
