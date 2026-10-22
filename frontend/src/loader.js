// Global "work in progress" counter that drives the thin top progress bar (API calls + lazy pages).
let pending = 0;
const subs = new Set();
const emit = () => subs.forEach((f) => f(pending));

export const loader = {
  start() { pending += 1; emit(); },
  done() { pending = Math.max(0, pending - 1); emit(); },
  subscribe(f) { subs.add(f); return () => subs.delete(f); },
};
