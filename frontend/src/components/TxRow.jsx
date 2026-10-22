import React from 'react';
import { amt, timeAgo } from '../format';
import { useI18n } from '../i18n';
import { go } from '../router';
import Icon, { CoinIcon } from './Icon';
import { Pill } from './ui';

export const IN_TYPES = new Set(['deposit', 'receive', 'gift_in', 'gift_refund', 'referral', 'reward', 'p2p_buy', 'earn_interest', 'earn_redeem', 'request_in']);
const KIND_ICON = { deposit: 'down', withdraw: 'up', send: 'send', receive: 'down', swap: 'swap', p2p_buy: 'p2p', p2p_sell: 'p2p', gift_out: 'gift',
  gift_in: 'gift', gift_refund: 'refresh', referral: 'users', reward: 'star', adjust: 'edit', earn_subscribe: 'earn', earn_redeem: 'earn', earn_interest: 'percent' };
const PENDING = { pending: 'y', processing: 'y', review: 'y', failed: 'r', rejected: 'r', cancelled: 'n', expired: 'n' };

/** One activity row: coin with a small action badge, title + time/detail, signed amount (sheet 05 "Activity"). */
export default function TxRow({ tx }) {
  const { t } = useI18n();
  const incoming = IN_TYPES.has(tx.type) || (tx.type === 'adjust' && tx.meta?.sign !== '-');
  const who = tx.counterparty_user?.name || tx.meta?.to_name || tx.meta?.from_name;
  const title = who && (tx.type === 'send' || tx.type === 'receive') ? t(tx.type === 'send' ? 'tx_sent_to' : 'tx_received_from', { name: who }) : t(`tx_${tx.type}`);
  const detail = [timeAgo(tx.created_at, t), tx.type === 'swap' ? `${tx.asset} → ${tx.asset2}` : tx.meta?.note || tx.network_name || tx.network?.toUpperCase()]
    .filter(Boolean).join(' · ');
  return (
    <button type="button" className="li" onClick={() => go(`/tx/${tx.id}`)}>
      <span style={{ position: 'relative', flex: 'none' }}>
        <CoinIcon asset={tx.type === 'swap' ? tx.asset2 || tx.asset : tx.asset} size={40} />
        <span style={{ position: 'absolute', insetInlineEnd: -4, bottom: -3, width: 18, height: 18, borderRadius: '50%', background: 'var(--s2)', display: 'grid',
          placeItems: 'center', color: 'var(--ember)', boxShadow: '0 0 0 2px var(--s1)' }}><Icon name={KIND_ICON[tx.type] || 'coins'} size={11} stroke={2.6} /></span>
      </span>
      <span className="grow"><b className="ellipsis">{title}</b><small className="ellipsis">{detail}</small></span>
      <span className="r col" style={{ alignItems: 'flex-end', gap: 3 }} dir="ltr">
        {tx.type === 'swap'
          ? <b className="ok">+{amt(tx.amount2)} {tx.asset2}</b>
          : <b className={incoming ? 'ok' : ''}>{incoming ? '+' : '−'}{amt(tx.amount)} {tx.asset}</b>}
        {tx.status !== 'completed' && PENDING[tx.status] && <Pill tone={PENDING[tx.status]} className="xs">{t(`status_${tx.status}`)}</Pill>}
      </span>
    </button>
  );
}
