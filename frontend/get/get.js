import '@fontsource/chakra-petch/600.css';
import './get.css';
import { LANGS, dict } from './i18n';

// Download page: picks the right build for this device, links every platform, explains iPhone / macOS / Windows installs.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ua = navigator.userAgent;
const OS = /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iphone'
  : /Windows/i.test(ua) ? 'windows' : /Macintosh|Mac OS X/i.test(ua) ? 'mac' : 'web';

const MARK = '<svg viewBox="0 0 64 64" width="36" height="36" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF9A1A"/><stop offset="1" stop-color="#FF4D00"/></linearGradient></defs><rect width="64" height="64" rx="19.2" fill="url(#g)"/><path d="M17 15.5h30a3.5 3.5 0 0 1 0 7H17a3.5 3.5 0 0 1 0-7zM17 41.5h30a3.5 3.5 0 0 1 0 7H17a3.5 3.5 0 0 1 0-7z" fill="#160800"/><path d="M18 45C21 32 31 22.5 46.5 19 43.5 32 33.5 41.5 18 45z" fill="#fff"/></svg>';
const I = {
  android: '<path d="M17.6 9.48l1.84-3.18a.38.38 0 0 0-.66-.38l-1.86 3.22a11.4 11.4 0 0 0-9.84 0L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"/>',
  apple: '<path d="M16.37 12.6c-.02-2.43 1.99-3.6 2.08-3.66-1.13-1.66-2.9-1.89-3.53-1.91-1.5-.15-2.93.88-3.69.88-.77 0-1.94-.86-3.19-.84-1.64.02-3.15.95-4 2.42-1.7 2.96-.44 7.34 1.23 9.74.81 1.17 1.78 2.49 3.05 2.44 1.22-.05 1.69-.79 3.17-.79 1.48 0 1.9.79 3.19.77 1.32-.02 2.15-1.19 2.95-2.37.93-1.36 1.31-2.68 1.33-2.75-.03-.01-2.56-.98-2.59-3.93zM13.96 5.47c.67-.82 1.13-1.95 1-3.08-.97.04-2.14.65-2.84 1.46-.62.72-1.17 1.88-1.02 2.98 1.08.08 2.19-.55 2.86-1.36z"/>',
  windows: '<path d="M3 5.5l7.5-1v7H3v-6zm8.5-1.15L21 3v8.5h-9.5v-7.15zM3 12.5h7.5v7L3 18.5v-6zm8.5 0H21V21l-9.5-1.35V12.5z"/>',
  telegram: '<path d="M21.94 4.3l-3.17 14.96c-.24 1.06-.87 1.32-1.75.82l-4.83-3.56-2.33 2.24c-.26.26-.47.47-.97.47l.35-4.92 8.95-8.09c.39-.35-.08-.54-.6-.19L6.53 13.0 1.77 11.5c-1.03-.32-1.05-1.03.22-1.53L20.6 2.8c.86-.32 1.62.2 1.34 1.5z"/>',
  web: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.93 6h-2.95a15.7 15.7 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a8.2 8.2 0 0 1 0-4h3.38a16.5 16.5 0 0 0 0 4H4.26zm.81 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 0 1 5.07 16zm2.95-8H5.07a7.99 7.99 0 0 1 4.33-3.56A15.7 15.7 0 0 0 8.02 8zM12 19.96A14.1 14.1 0 0 1 10.09 16h3.82A14.1 14.1 0 0 1 12 19.96zM14.34 14H9.66a14.7 14.7 0 0 1 0-4h4.68a14.7 14.7 0 0 1 0 4zm.26 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14a16.5 16.5 0 0 0 0-4h3.38a8.2 8.2 0 0 1 0 4h-3.38z"/>',
  dl: '<path d="M12 3v11m0 0l-4.5-4.5M12 14l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  f1: '<path d="M12 2l8.66 5v10L12 22l-8.66-5V7L12 2zm0 2.3L5.34 8.15v7.7L12 19.7l6.66-3.85v-7.7L12 4.3zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/>',
  f2: '<path d="M7 7h11l-3-3 1.4-1.4L21.8 8l-5.4 5.4L15 12l3-3H7V7zm10 10H6l3 3-1.4 1.4L2.2 16l5.4-5.4L9 12l-3 3h11v2z"/>',
  f3: '<path d="M12 2l8 3v6c0 5-3.4 9.7-8 11-4.6-1.3-8-6-8-11V5l8-3zm-1 13.6l5.7-5.7-1.4-1.4L11 12.8l-2.3-2.3-1.4 1.4 3.7 3.7z"/>',
  f4: '<path d="M20 7h-2.2A3 3 0 0 0 12 4.4 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8h1a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1zM15 6a1 1 0 1 1 0 2h-2a2 2 0 0 1 2-2zM9 6a2 2 0 0 1 2 2H9a1 1 0 1 1 0-2zm-4 3h6v1H5V9zm2 3h4v7H7v-7zm6 7v-7h4v7h-4zm6-9h-6V9h6v1z"/>',
  f5: '<path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2zm4 6v2h2v-2H8zm4 0v2h2v-2h-2zm4 0v2h2v-2h-2z"/>',
  f6: '<path d="M12 1a5 5 0 0 1 5 5v3h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h1V6a5 5 0 0 1 5-5zm0 12a2 2 0 0 0-1 3.73V19h2v-2.27A2 2 0 0 0 12 13zm0-10a3 3 0 0 0-3 3v3h6V6a3 3 0 0 0-3-3z"/>',
};
const svg = (n, s = 24) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor" aria-hidden="true">${I[n]}</svg>`;
const mb = (b) => (b ? `${(b / 1048576).toFixed(b > 10485760 ? 0 : 1)} MB` : '');

let lang = (() => {
  try { const s = localStorage.getItem('aw_lang'); if (s && LANGS[s]) return s; } catch { /* */ }
  const n = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return LANGS[n] ? n : 'en';
})();
let rel = { files: {} };
let cfg = {};

function cards(t) {
  const f = rel.files || {};
  const tgUrl = cfg.bot ? `https://t.me/${cfg.bot}?startapp=web` : null;
  return [
    { id: 'android', icon: 'android', title: t.android, sub: f.android ? `${t.apk} · ${mb(f.android.size)}` : t.soon, href: f.android?.url },
    { id: 'iphone', icon: 'apple', title: t.iphone, sub: t.add_home, action: 'ios' },
    { id: 'windows', icon: 'windows', title: t.windows, sub: f.windows ? `${t.win64} · ${mb(f.windows.size)}` : t.soon, href: f.windows?.url, note: t.win_note },
    { id: 'mac', icon: 'apple', title: `${t.mac}`, sub: f.mac_arm ? `${t.apple_silicon} · ${mb(f.mac_arm.size)}` : t.soon, href: f.mac_arm?.url, note: t.mac_note,
      alt: f.mac_x64 ? { label: `${t.intel} · ${mb(f.mac_x64.size)}`, href: f.mac_x64.url } : null },
    { id: 'telegram', icon: 'telegram', title: t.telegram, sub: t.mini_app, href: tgUrl },
    { id: 'web', icon: 'web', title: t.web, sub: t.any_browser, href: '/' },
  ];
}

function render() {
  const t = dict(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = ['ar', 'fa'].includes(lang) ? 'rtl' : 'ltr';
  const list = cards(t);
  const mine = list.find((c) => c.id === OS) || list.find((c) => c.id === 'web');
  const features = [1, 2, 3, 4, 5, 6].map((i) => `<article class="feat"><span class="feat-ic">${svg('f' + i, 22)}</span><h3>${esc(t['f' + i + 't'])}</h3><p>${esc(t['f' + i + 'd'])}</p></article>`).join('');
  const card = (c) => {
    const inner = `<span class="dl-ic">${svg(c.icon, 26)}</span><span class="dl-txt"><b>${esc(c.title)}</b><small>${esc(c.sub)}</small></span>${c.href || c.action ? `<span class="dl-go">${svg('dl', 20)}</span>` : ''}`;
    const cls = `dl ${c.id === mine.id ? 'mine' : ''} ${!c.href && !c.action ? 'off' : ''}`;
    const main = c.action ? `<button type="button" class="${cls}" data-action="${c.action}">${inner}</button>`
      : c.href ? `<a class="${cls}" href="${esc(c.href)}" ${c.id === 'telegram' ? 'target="_blank" rel="noopener"' : ''}>${inner}</a>` : `<div class="${cls}">${inner}</div>`;
    const alt = c.alt ? `<a class="dl-alt" href="${esc(c.alt.href)}">${esc(c.alt.label)}</a>` : '';
    return `<div class="dl-wrap">${main}${alt}</div>`;
  };
  $('#get').innerHTML = `
    <header class="top">
      <a class="brand" href="/get/">${MARK}<span class="word"><b>ZOHRA</b><span>WALLET</span></span></a>
      <div class="top-r">
        <select id="lang" aria-label="Language">${Object.entries(LANGS).map(([c, n]) => `<option value="${c}" ${c === lang ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <a class="btn ghost" href="/">${esc(t.open_web)}</a>
      </div>
    </header>
    <main>
      <section class="hero">
        <div class="glow"></div>
        <h1>${esc(t.hero_title)}</h1>
        <p class="lead">${esc(t.hero_sub)}</p>
        <div class="hero-cta">${card({ ...mine, title: `${mine.title}`, sub: `${t.recommended} · ${mine.sub}` })}</div>
        ${rel.version ? `<p class="ver">${esc(t.version.replace('{v}', rel.version))}</p>` : ''}
      </section>
      <section class="grid">${list.map(card).join('')}</section>
      ${mine.note ? `<p class="note">${esc(mine.note)}</p>` : ''}
      <section class="feats">${features}</section>
    </main>
    <footer class="foot"><span>© ${new Date().getFullYear()} Zohra Wallet</span>
      ${cfg.terms_url ? `<a href="${esc(cfg.terms_url)}">${esc(t.terms)}</a>` : ''}${cfg.privacy_url ? `<a href="${esc(cfg.privacy_url)}">${esc(t.privacy)}</a>` : ''}</footer>
    <div class="sheet" id="ios" hidden><div class="sheet-card">
      <h2>${esc(t.ios_title)}</h2><ol><li>${esc(t.ios1)}</li><li>${esc(t.ios2)}</li><li>${esc(t.ios3)}</li></ol>
      <button type="button" class="btn primary" data-close>${esc(t.close)}</button></div></div>`;
  $('#lang').onchange = (e) => { lang = e.target.value; try { localStorage.setItem('aw_lang', lang); } catch { /* */ } render(); };
  document.querySelectorAll('[data-action="ios"]').forEach((b) => { b.onclick = () => { $('#ios').hidden = false; }; });
  $('#ios').onclick = (e) => { if (e.target.id === 'ios' || e.target.hasAttribute('data-close')) $('#ios').hidden = true; };
}

render();
Promise.allSettled([fetch('/api/releases/latest').then((r) => r.json()), fetch('/api/config').then((r) => r.json())]).then(([a, b]) => {
  if (a.status === 'fulfilled' && a.value) rel = a.value;
  if (b.status === 'fulfilled' && b.value) cfg = b.value;
  render();
});
