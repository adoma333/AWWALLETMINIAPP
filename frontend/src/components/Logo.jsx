import React, { useId } from 'react';

/** ZOHRA mark: a "Z" whose diagonal is a petal (zahra — flower / Venus) on an ember squircle. Pure SVG, crisp at any size. */
export function ZMark({ size = 40, radius = 0.3, className = '', title = 'ZOHRA WALLET' }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label={title}>
      <defs>
        <linearGradient id={`zg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF9A1A" />
          <stop offset="1" stopColor="#FF4D00" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={64 * radius} fill={`url(#zg${id})`} />
      <path d="M17 15.5h30a3.5 3.5 0 0 1 0 7H17a3.5 3.5 0 0 1 0-7zM17 41.5h30a3.5 3.5 0 0 1 0 7H17a3.5 3.5 0 0 1 0-7z" fill="#160800" />
      <path d="M18 45C21 32 31 22.5 46.5 19 43.5 32 33.5 41.5 18 45z" fill="#fff" />
    </svg>
  );
}

/** "ZOHRA WALLET" wordmark set in the brand display face. */
export function Wordmark({ height = 20, short = false, className = '' }) {
  return (
    <span className={`wordmark ${className}`} style={{ fontSize: height }} dir="ltr">
      <b>{short ? 'Z' : 'ZOHRA'}</b><span>WALLET</span>
    </span>
  );
}

export default function Logo({ height = 20, mark = true, short = false, className = '' }) {
  return (
    <span className={`logo ${className}`} dir="ltr">
      {mark && <ZMark size={Math.round(height * 1.45)} />}
      <Wordmark height={height} short={short} />
    </span>
  );
}
