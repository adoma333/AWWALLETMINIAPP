import { setColors, tg } from './telegram';

const COLORS = { dark: '#000000', light: '#f6f2ec' };

export function getThemePref() {
  try {
    const v = localStorage.getItem('aw_theme');
    if (['dark', 'light', 'auto'].includes(v)) return v;
  } catch { /* */ }
  return 'dark';
}

export function resolveTheme(pref = getThemePref()) {
  if (pref === 'dark' || pref === 'light') return pref;
  if (tg?.colorScheme) return tg.colorScheme === 'light' ? 'light' : 'dark';
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(pref = getThemePref()) {
  const theme = resolveTheme(pref);
  document.documentElement.dataset.theme = theme;
  setColors(COLORS[theme]);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[theme]);
  return theme;
}

export function setThemePref(pref) {
  try { localStorage.setItem('aw_theme', pref); } catch { /* */ }
  applyTheme(pref);
}

export function applyBrand(branding) {
  if (!branding) return;
  const el = document.documentElement;
  if (branding.ember) el.style.setProperty('--ember', branding.ember);
  if (branding.flame) el.style.setProperty('--flame', branding.flame);
}
