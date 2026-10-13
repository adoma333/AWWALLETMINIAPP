import React, { useEffect } from 'react';
import Icon from './Icon';
import { haptic } from '../telegram';

export async function celebrate() {
  try {
    const confetti = (await import('canvas-confetti')).default;
    confetti({ particleCount: 90, spread: 70, origin: { y: 0.35 }, colors: ['#FF8A00', '#FF5A00', '#F5EFE8', '#3DDC97'] });
  } catch { /* optional */ }
}

export default function Success({ title, sub, children, confetti = true }) {
  useEffect(() => { haptic.success(); if (confetti) celebrate(); }, [confetti]);
  return (
    <div className="success">
      <span className="success-ring"><Icon name="check" size={44} /></span>
      <h2>{title}</h2>
      {sub && <p>{sub}</p>}
      <div className="success-actions">{children}</div>
    </div>
  );
}
