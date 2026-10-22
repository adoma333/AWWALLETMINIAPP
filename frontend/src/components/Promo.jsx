import React, { useEffect, useRef, useState } from 'react';
import { go } from '../router';
import { haptic } from '../telegram';
import Icon from './Icon';

// Home promo banners (like the big wallets): one full-width card at a time, auto-advancing, swipeable, with dots.
// Every banner has its own fixed colours, so the text is equally readable in day and night mode.
export const PROMO_STYLES = {
  ember: { bg: 'linear-gradient(120deg,#FFB13D 0%,#FF7A00 55%,#FF5200 100%)', fg: '#1A0900' },
  green: { bg: 'linear-gradient(120deg,#22C58B 0%,#0E9F6E 60%,#087A55 100%)', fg: '#FFFFFF' },
  violet: { bg: 'linear-gradient(120deg,#F25C8B 0%,#B44CEB 60%,#7B4DF2 100%)', fg: '#FFFFFF' },
  blue: { bg: 'linear-gradient(120deg,#3A9BFF 0%,#2370E8 60%,#1A50C2 100%)', fg: '#FFFFFF' },
  dark: { bg: 'linear-gradient(120deg,#2B2622 0%,#1A1715 100%)', fg: '#FFFFFF' },
};

export default function Promo({ items }) {
  const box = useRef(null);
  const [i, setI] = useState(0);
  const hold = useRef(false);
  const n = items.length;
  useEffect(() => {
    if (n < 2) return undefined;
    const id = setInterval(() => {
      if (hold.current || document.visibilityState !== 'visible') return;
      const el = box.current;
      if (!el) return;
      const next = (Math.round(Math.abs(el.scrollLeft) / el.clientWidth) + 1) % n;
      const dir = getComputedStyle(el).direction === 'rtl' ? -1 : 1;
      el.scrollTo({ left: dir * next * el.clientWidth, behavior: 'smooth' });
    }, 4800);
    return () => clearInterval(id);
  }, [n]);
  if (!n) return null;
  const onScroll = () => {
    const el = box.current;
    if (el) setI(Math.round(Math.abs(el.scrollLeft) / el.clientWidth));
  };
  return (
    <div className="promo">
      <div className="promo-track" ref={box} onScroll={onScroll} onTouchStart={() => { hold.current = true; }}
        onTouchEnd={() => { setTimeout(() => { hold.current = false; }, 2500); }} onMouseEnter={() => { hold.current = true; }} onMouseLeave={() => { hold.current = false; }}>
        {items.map((s) => {
          const st = PROMO_STYLES[s.style] || PROMO_STYLES.dark;
          return (
            <button key={s.key} type="button" className="promo-card" onClick={() => { haptic.tap(); if (s.to) go(s.to); }}
              style={{ background: s.image ? `linear-gradient(90deg,rgba(0,0,0,.62),rgba(0,0,0,.15)),center/cover url(${s.image})` : st.bg, color: s.image ? '#fff' : st.fg }}>
              <span className="promo-txt">
                <b>{s.title}</b>
                {s.sub && <small>{s.sub}</small>}
                {s.cta && <span className="promo-cta">{s.cta}<Icon name="chev" size={14} className="flip-rtl" /></span>}
              </span>
              <span className="promo-art" aria-hidden="true">
                <span className="promo-ring" />
                <span className="promo-ic"><Icon name={s.icon} size={28} stroke={2} /></span>
              </span>
            </button>
          );
        })}
      </div>
      {n > 1 && <div className="promo-dots">{items.map((s, k) => <i key={s.key} className={k === i ? 'on' : ''} />)}</div>}
    </div>
  );
}
