import React, { useEffect, useRef, useState } from 'react';
import { loader } from '../loader';

/** A thin bar at the top that fills while something loads (trickles toward 90 %, completes, fades). */
export default function TopBar() {
  const [p, setP] = useState(0);
  const [on, setOn] = useState(false);
  const timer = useRef(null);
  useEffect(() => loader.subscribe((n) => {
    clearInterval(timer.current);
    if (n > 0) {
      setOn(true);
      setP((x) => (x > 0 && x < 90 ? x : 12));
      timer.current = setInterval(() => setP((x) => (x < 90 ? x + (90 - x) * 0.12 : x)), 180);
    } else {
      setP(100);
      timer.current = setTimeout(() => { setOn(false); setP(0); }, 260);
    }
  }), []);
  return <div className={`topbar ${on ? 'on' : ''}`} aria-hidden="true"><i style={{ width: `${p}%` }} /></div>;
}

/** Suspense fallback: keeps the bar running while a lazy page loads. */
export function PageLoading() {
  useEffect(() => { loader.start(); return () => loader.done(); }, []);
  return <div className="page-loading" />;
}
