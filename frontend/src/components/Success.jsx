import React, { useEffect, useMemo } from 'react';
import { haptic } from '../telegram';
import Icon from './Icon';

const COLORS = ['#FF8A00', '#3DDC97', '#FFC24A', '#FF5A00', '#F5EFE8'];

/** Confetti pieces falling once (pure CSS, no canvas). */
export function Confetti({ n = 28, round }) {
  const bits = useMemo(() => Array.from({ length: n }, (_, i) => ({
    left: Math.random() * 100, top: Math.random() * 20, w: 6 + Math.random() * 6, h: round ? 0 : 3 + Math.random() * 4, d: Math.random() * 0.5,
    y: 180 + Math.random() * 260, r: Math.random() * 360, c: COLORS[i % COLORS.length],
  })), [n, round]);
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <i key={i} style={{ left: `${b.left}%`, top: `${80 + b.top}px`, width: b.w, height: b.h || b.w, borderRadius: round ? '50%' : 2, background: b.c,
          animationDelay: `${b.d}s`, '--y': `${b.y}px`, '--r': `${b.r}deg` }} />
      ))}
    </div>
  );
}

export async function celebrate() { haptic.success(); }

/** Full success screen from the design sheet: ring, title, amount, receipt rows, actions at the bottom. */
export default function Success({ title, amount, sub, rows, children, actions, confetti = true }) {
  useEffect(() => { haptic.success(); }, []);
  return (
    <main className="page has-bar" style={{ position: 'relative' }}>
      <div className="glow-bg" style={{ inset: '0 0 auto', height: 320, background: 'radial-gradient(60% 55% at 50% 30%,rgba(61,220,151,.18),transparent 70%)' }} />
      {confetti && <Confetti />}
      <div className="col center g8" style={{ padding: '48px 20px 0', position: 'relative' }}>
        <span className="success-ring"><Icon name="check" size={46} stroke={3} /></span>
        <span className="h" style={{ fontSize: 24, marginTop: 10 }}>{title}</span>
        {amount && <span className="mid">{amount}</span>}
        {sub && <span className="dim" style={{ fontSize: 14 }}>{sub}</span>}
      </div>
      {rows?.length > 0 && <div className="card tight" style={{ marginTop: 18 }}>{rows.map(([k, v], i) => <div key={i} className="kv"><span>{k}</span><b>{v}</b></div>)}</div>}
      {children}
      {actions && <div className="bar-bottom">{actions}</div>}
    </main>
  );
}
