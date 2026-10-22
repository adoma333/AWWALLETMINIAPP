// Session for the standalone apps (web / Android / Windows / macOS). Inside Telegram the signed initData is used instead.
const KEY = 'zw_session';

export function getToken() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}
export function setToken(t) {
  try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* private mode */ }
}

/** Our own app shells add "ZohraApp/<platform>" to the user agent and expose window.ZohraApp. */
export const shell = (navigator.userAgent.match(/ZohraApp\/(\w+)/) || [])[1] || '';

/** Open a link outside the app: Telegram deep links, the system browser for Google sign-in, explorers… */
export function openOutside(url) {
  if (window.ZohraApp?.openExternal) { window.ZohraApp.openExternal(url); return; }
  const w = window.open(url, '_blank', 'noopener');
  if (!w) location.href = url;
}

export function deviceName() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const app = shell ? `${shell} app` : (/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser');
  return `${app} · ${os}`;
}

let gisP = null;
/** Google Identity Services, loaded only when the sign-in page needs it. */
export function loadGoogle() {
  if (!gisP) {
    gisP = new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) { resolve(window.google); return; }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve(window.google);
      s.onerror = () => { gisP = null; reject(new Error('gis')); };
      document.head.appendChild(s);
    });
  }
  return gisP;
}
