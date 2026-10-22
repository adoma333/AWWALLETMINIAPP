// The first-paint splash in index.html: the mark assembles itself and pulses until the wallet is ready, then the app
// fades in under it. It stays at least until the assembly animation finished (no flicker on fast connections).
const el = () => document.getElementById('splash');
const T0 = performance.now();
const MIN_MS = 650;

export function splashProgress() { /* kept for callers; the splash shows no progress bar any more */ }

export function hideSplash() {
  const s = el();
  if (!s || s.classList.contains('done') || s.dataset.hiding) return;
  s.dataset.hiding = '1';
  const wait = Math.max(0, MIN_MS - (performance.now() - T0));
  setTimeout(() => { s.classList.add('done'); setTimeout(() => s.remove(), 360); }, wait);
}
