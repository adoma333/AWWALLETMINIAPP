import React from 'react';
import { amt, timeAgo } from '../format';
import { useI18n } from '../i18n';
import { go } from '../router';
import Icon, { CoinIcon } from './Icon';
import { Status } from './ui';

const IN = new Set(['deposit', 'receive', 'gift_in', 'gift_refund', 'referral', 'reward', 'p2p_buy']);
const ICON = { deposit: 'arrowDown', withdraw: 'arrowUp', send: 'send', receive: 'arrowDown', swap: 'swap', p2p_buy: 'handshake',
  p2p_sell: 'handshake', gift_out: 'gift', gift_in: 'gift', gift_refund: 'refresh', referral: 'users', reward: 'star', adjust: 'edit' };

export default function TxRow({ tx }) {
  const { t } = useI18n();
  const incoming = IN.has(tx.type) || (tx.type === 'adjust' && tx.meta?.sign !== '-');
  const who = tx.counterparty_user?.name || tx.meta?.to || tx.meta?.from;
  return (
    <button type="button" className="tx-row" onClick={() => go(`/tx/${tx.id}`)}>
      <span className="tx-ic"><CoinIcon asset={tx.type === 'swap' ? tx.asset2 || tx.asset : tx.asset} size={38} /><span className={`tx-kind ${incoming ? 'in' : 'out'}`}><Icon name={ICON[tx.type] || 'coin'} size={12} /></span></span>
      <span className="ar-main">
        <b>{t(`tx_${tx.type}`)}{who ? <span className="dim"> · {who}</span> : null}</b>
        <small>{timeAgo(tx.created_at, t)} {tx.status !== 'completed' && <Status status={tx.status} />}</small>
      </span>
      <span className="ar-right" dir="ltr">
        {tx.type === 'swap' ? (
          <><b className="up">+{amt(tx.amount2)} {tx.asset2}</b><small>−{amt(tx.amount)} {tx.asset}</small></>
        ) : (
          <b className={incoming ? 'up' : ''}>{incoming ? '+' : '−'}{amt(tx.amount)} {tx.asset}</b>
        )}
      </span>
    </button>
  );
}
