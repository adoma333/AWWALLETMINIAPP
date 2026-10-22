// Live prices over server-sent events. The wallet's fiat values are recomputed in place, so balances move with the market
// without refetching anything. The browser reconnects on its own; the stream pauses while the app is hidden.

export function applyPrices(w, snap) {
  if (!w || !snap?.p) return w;
  let total = 0;
  let change = 0;
  let touched = false;
  const assets = w.assets.map((a) => {
    const p = snap.p[a.id];
    if (!p || (p[0] === a.usd && p[1] === a.change24h)) {
      const v = Number(a.value_usd) || 0;
      total += v;
      const ch = Number(a.change24h) || 0;
      if (v > 0 && ch > -100) change += v - v / (1 + ch / 100);
      return a;
    }
    touched = true;
    const qty = (Number(a.available) || 0) + (Number(a.locked) || 0);
    const v = Math.round(qty * Number(p[0]) * 100) / 100;
    const ch = Number(p[1]) || 0;
    total += v;
    if (v > 0 && ch > -100) change += v - v / (1 + ch / 100);
    return { ...a, usd: p[0], change24h: p[1], value_usd: v.toFixed(2), tick: Number(p[0]) > Number(a.usd) ? 'up' : 'down' };
  });
  if (!touched) return w;
  return { ...w, assets, total_usd: total.toFixed(2), change24h_usd: change.toFixed(2), updated_at: snap.at };
}

export function streamPrices(onSnap) {
  if (typeof EventSource === 'undefined') return () => {};
  let es = null;
  const open = () => {
    if (es || document.visibilityState !== 'visible') return;
    es = new EventSource('/api/prices/stream');
    es.onmessage = (e) => { try { onSnap(JSON.parse(e.data)); } catch { /* ignore a bad frame */ } };
  };
  const close = () => { if (es) { es.close(); es = null; } };
  const onVis = () => (document.visibilityState === 'visible' ? open() : close());
  document.addEventListener('visibilitychange', onVis);
  open();
  return () => { document.removeEventListener('visibilitychange', onVis); close(); };
}
