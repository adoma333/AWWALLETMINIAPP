import React, { useEffect, useRef, useState } from 'react';
import { loader } from '../loader';

/** A thin bar at the top that fills while something loads (trickles toward 90 %, completes, fades). */
export default function TopBar() {
  const [p, setP] = useState(0);
  const [on, setOn] = useState(false);
  const timer = useRef(null);
  const delay = useRef(null);
  const shown = useRef(false);
  useEffect(() => loader.subscribe((n) => {
    clearInterval(timer.current);
    if (n > 0) {
      // quick answers (most of them) never flash a bar; only a request slower than 450 ms shows progress
      if (!shown.current && !delay.current) {
        delay.current = setTimeout(() => {
          delay.current = null;
          shown.current = true;
          setOn(true);
          setP(12);
          timer.current = setInterval(() => setP((x) => (x < 90 ? x + (90 - x) * 0.12 : x)), 180);
        }, 450);
      } else if (shown.current) {
        timer.current = setInterval(() => setP((x) => (x < 90 ? x + (90 - x) * 0.12 : x)), 180);
      }
    } else {
      clearTimeout(delay.current);
      delay.current = null;
      if (!shown.current) return;
      shown.current = false;
      setP(100);
      timer.current = setTimeout(() => { setOn(false); setP(0); }, 260);
    }
  }), []);
  return <div className={`topbar ${on ? 'on' : ''}`} aria-hidden="true"><i style={{ width: `${p}%` }} /></div>;
}

/** Suspense fallback: keeps the bar running while a lazy page loads. */
export function PageLoading() {
  useEffect(() => { loader.start(); return () => loader.done(); }, []);
  return (
    <main className="page" aria-busy="true">
      <span className="sk" style={{ height: 48, width: '60%', margin: '0 auto', borderRadius: 14 }} />
      <span className="sk" style={{ height: 150, borderRadius: 22 }} />
      <span className="sk" style={{ height: 230, borderRadius: 22 }} />
    </main>
  );
}
