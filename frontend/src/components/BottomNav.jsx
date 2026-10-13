import React from 'react';
import { useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic } from '../telegram';
import Icon from './Icon';

const ITEMS = [
  { path: '/', icon: 'wallet', label: 'nav_home' },
  { path: '/swap', icon: 'swap', label: 'nav_swap', feature: 'swap' },
  { path: '/p2p', icon: 'handshake', label: 'nav_p2p', feature: 'p2p' },
  { path: '/rewards', icon: 'gift', label: 'nav_rewards', feature: 'rewards' },
  { path: '/profile', icon: 'user', label: 'nav_profile' },
];

export default function BottomNav({ path }) {
  const { t } = useI18n();
  const { config } = useApp();
  const f = config?.features || {};
  return (
    <nav className="bottom-nav">
      {ITEMS.filter((i) => !i.feature || f[i.feature] !== false).map((i) => (
        <button key={i.path} type="button" className={`bn-item ${path === i.path ? 'on' : ''}`}
          onClick={() => { haptic.select(); go(i.path, true); }} aria-current={path === i.path ? 'page' : undefined}>
          <Icon name={i.icon} size={22} />
          <span>{t(i.label)}</span>
        </button>
      ))}
    </nav>
  );
}
