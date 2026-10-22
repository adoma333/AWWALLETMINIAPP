import { setColors, tg } from './telegram';

const COLORS = { dark: '#000000', light: '#f2f2f7' };

export function getThemePref() {
  try {
    const v = localStorage.getItem('aw_theme');
    if (['dark', 'light', 'auto'].includes(v)) return v;
  } catch { /* */ }
  return 'auto'; // follow Telegram's day / night mode, like the Telegram apps themselves
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

let watching = false;
/** In "auto" the app follows Telegram live when the user switches day / night mode. */
export function watchTheme() {
  if (watching) return;
  watching = true;
  try { tg?.onEvent?.('themeChanged', () => { if (getThemePref() === 'auto') applyTheme('auto'); }); } catch { /* old client */ }
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (getThemePref() === 'auto') applyTheme('auto'); });
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
