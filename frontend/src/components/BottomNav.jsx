import React from 'react';
import { useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic } from '../telegram';
import Icon from './Icon';

// Wallet · Trade · Z Pay (centre) · Rewards · Profile
const ITEMS = [
  { path: '/', icon: 'wallet', label: 'nav_home' },
  { path: '/trade', icon: 'chart', label: 'nav_trade', also: ['/swap', '/p2p'] },
  { path: '/pay', icon: 'bolt', label: 'nav_pay', center: true },
  { path: '/rewards', icon: 'gift', label: 'nav_rewards', feature: 'rewards' },
  { path: '/profile', icon: 'user', label: 'nav_profile' },
];

export default function BottomNav({ path }) {
  const { t } = useI18n();
  const { config } = useApp();
  const f = config?.features || {};
  return (
    <nav className="bottom-nav">
      {ITEMS.filter((i) => !i.feature || f[i.feature] !== false).map((i) => {
        const on = path === i.path || (i.also || []).includes(path);
        return (
          <button key={i.path} type="button" className={`bn-item ${on ? 'on' : ''} ${i.center ? 'center' : ''}`}
            onClick={() => { haptic.select(); go(i.path, true); }} aria-current={on ? 'page' : undefined}>
            {i.center ? <span className="bn-fab"><Icon name={i.icon} size={26} weight="fill" /></span>
              : <Icon name={i.icon} size={24} weight={on ? 'fill' : 'regular'} />}
            <span>{t(i.label)}</span>
          </button>
        );
      })}
    </nav>
  );
}
