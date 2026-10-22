import React from 'react';
import { useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic } from '../telegram';
import Icon from './Icon';

// Wallet · Trade · Z Pay (centre) · Rewards · Profile — as in the design sheets
const ITEMS = [
  { path: '/', icon: 'wallet', label: 'nav_home' },
  { path: '/trade', icon: 'chart', label: 'nav_trade', also: ['/swap', '/p2p', '/markets'] },
  { path: '/pay', icon: 'qr', label: 'nav_pay', center: true },
  { path: '/rewards', icon: 'gift', label: 'nav_rewards', feature: 'rewards' },
  { path: '/profile', icon: 'user', label: 'nav_profile' },
];

export default function BottomNav({ path }) {
  const { t } = useI18n();
  const { config } = useApp();
  const f = config?.features || {};
  return (
    <nav className="nav">
      <div className="nav-in">
        {ITEMS.filter((i) => !i.feature || f[i.feature] !== false).map((i) => {
          const on = path === i.path || (i.also || []).includes(path);
          return (
            <button key={i.path} type="button" className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}
              onClick={() => { haptic.select(); go(i.path, true); }}>
              {i.center ? <span className="zbtn"><Icon name="qr" size={24} stroke={2.2} /></span> : <Icon name={i.icon} size={24} stroke={on ? 2.2 : 1.8} />}
              <span style={i.center ? { marginTop: 2 } : undefined}>{t(i.label)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
