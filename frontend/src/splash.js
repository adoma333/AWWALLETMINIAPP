// Drives the first-paint splash in index.html: a thin bar that fills as boot steps finish, then fades out.
const el = () => document.getElementById('splash');

export function splashProgress(pct) {
  const s = el();
  if (s) s.style.setProperty('--p', `${Math.max(8, Math.min(100, pct))}%`);
}

export function hideSplash() {
  const s = el();
  if (!s || s.classList.contains('done')) return;
  splashProgress(100);
  setTimeout(() => { s.classList.add('done'); setTimeout(() => s.remove(), 300); }, 220);
}
