// Drives the first-paint splash in index.html: the bar fills as boot steps finish, the status line follows,
// and the splash stays at least until the logo animation has played once (no flash on fast connections).
const el = () => document.getElementById('splash');
const T0 = performance.now();
const MIN_MS = 1250;

export function splashProgress(pct, status) {
  const s = el();
  if (!s) return;
  s.style.setProperty('--p', `${Math.max(8, Math.min(100, pct))}%`);
  const st = document.getElementById('splash-st');
  if (status && st) st.textContent = status;
}

export function hideSplash() {
  const s = el();
  if (!s || s.classList.contains('done') || s.dataset.hiding) return;
  s.dataset.hiding = '1';
  splashProgress(100);
  const wait = Math.max(220, MIN_MS - (performance.now() - T0));
  setTimeout(() => { s.classList.add('done'); setTimeout(() => s.remove(), 380); }, wait);
}
