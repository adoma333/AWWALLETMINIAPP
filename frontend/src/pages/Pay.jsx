import React from 'react';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';
import { Page } from '../components/ui';
import { useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic, scanQr } from '../telegram';
import { parseScan } from '../util';

// Z Pay: everything that moves money between people, in one place.
export default function Pay() {
  const { t } = useI18n();
  const { config } = useApp();
  const toast = useToast();
  const f = config?.features || {};
  const scan = async () => {
    const raw = await scanQr(t('scan'));
    if (raw === null) { toast(t('scan_unavailable')); return; }
    const r = parseScan(raw);
    if (!r) { toast(t('scan_unknown'), 'error'); return; }
    if (r.route) go(r.route);
    else go(`/withdraw?address=${encodeURIComponent(r.address)}${r.network ? `&network=${r.network}` : ''}${r.memo ? `&memo=${encodeURIComponent(r.memo)}` : ''}`);
  };
  const items = [
    { k: 'send', icon: 'send', title: t('pay_to_user'), sub: t('pay_to_user_sub'), to: '/send/user', on: f.transfer !== false },
    { k: 'receive', icon: 'arrowDown', title: t('pay_receive'), sub: t('pay_receive_sub'), to: '/deposit', on: f.deposit !== false },
    { k: 'gift', icon: 'gift', title: t('action_gift'), sub: t('pay_gift_sub'), to: '/gift', on: f.gifts !== false },
    { k: 'address', icon: 'arrowUp', title: t('pay_to_address'), sub: t('pay_to_address_sub'), to: '/withdraw', on: f.withdraw !== false },
    { k: 'scan', icon: 'scan', title: t('action_scan'), sub: t('pay_scan_sub'), run: scan, on: true },
    { k: 'contacts', icon: 'contacts', title: t('address_book'), sub: t('pay_contacts_sub'), to: '/settings/addressbook', on: true },
  ].filter((i) => i.on);
  return (
    <Page title={t('nav_pay')} root>
      <section className="pay-hero">
        <span className="pay-mark"><Icon name="bolt" size={26} weight="fill" /></span>
        <p className="dim">{t('pay_sub')}</p>
      </section>
      <div className="pay-grid">
        {items.map((i) => (
          <button key={i.k} type="button" className="pay-tile" onClick={() => { haptic.tap(); i.run ? i.run() : go(i.to); }}>
            <span className="pt-ic"><Icon name={i.icon} size={24} weight="bold" /></span>
            <b>{i.title}</b><small>{i.sub}</small>
          </button>
        ))}
      </div>
    </Page>
  );
}
