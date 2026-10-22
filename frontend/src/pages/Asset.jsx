import React, { useEffect, useState } from 'react';
import { api } from '../api';
import Icon, { CoinIcon, NetIcon } from '../components/Icon';
import TxRow from '../components/TxRow';
import { Empty, Page, Skeleton, Spark } from '../components/ui';
import { amt, fiat, fiatCompact, pct, priceFmt } from '../format';
import { useI18n } from '../i18n';
import { useApp } from '../store';
import { go } from '../router';

export default function Asset({ id }) {
  const { t } = useI18n();
  const { wallet } = useApp();
  const [detail, setA] = useState(null);
  useEffect(() => { api.get(`/api/assets/${id}`).then(setA).catch(() => setA(false)); }, [id]);
  if (detail === false) return <Page title={id}><Empty icon="alert" title={t('err_not_found')} /></Page>;
  const live = wallet?.assets?.find((x) => x.id === id);
  const a = detail && live ? { ...detail, usd: live.usd, change24h: live.change24h, value_usd: live.value_usd, tick: live.tick } : detail;
  const ch = Number(a?.change24h || 0);
  return (
    <Page title={a ? a.name : id}>
      <section className="asset-hero">
        <CoinIcon asset={id} size={56} />
        {a ? (
          <>
            <div className="ah-price" dir="ltr"><span key={a.usd} className={a.tick ? `tick-${a.tick}` : undefined}>{priceFmt(a.usd)}</span> <span className={ch >= 0 ? 'up' : 'down'}>{pct(ch)}</span></div>
            <Spark points={a.chart} w={320} h={84} />
            <div className="ah-bal" dir="ltr"><b>{amt(Number(a.available) + Number(a.locked), a.display)} {id}</b><span>{fiat(a.value_usd)}</span></div>
            {Number(a.locked) > 0 && <small className="dim">{t('in_orders')}: {amt(a.locked)} {id}</small>}
          </>
        ) : <Skeleton h={120} />}
      </section>
      <div className="actions inline">
        <button type="button" className="act" onClick={() => go(`/deposit?asset=${id}`)}><span className="act-ic"><Icon name="arrowDown" size={22} weight="bold" /></span><span>{t('action_deposit')}</span></button>
        <button type="button" className="act" onClick={() => go(`/withdraw?asset=${id}`)}><span className="act-ic"><Icon name="arrowUp" size={22} weight="bold" /></span><span>{t('action_withdraw')}</span></button>
        <button type="button" className="act" onClick={() => go(`/send/user?asset=${id}`)}><span className="act-ic"><Icon name="send" size={22} weight="bold" /></span><span>{t('action_send')}</span></button>
        {a?.swap && <button type="button" className="act" onClick={() => go(`/swap?from=${id}`)}><span className="act-ic"><Icon name="swap" size={22} weight="bold" /></span><span>{t('action_swap')}</span></button>}
      </div>
      {a?.networks?.length > 0 && (
        <>
          <h2 className="h2">{t('networks_label')}</h2>
          <div className="chips">{a.networks.map((n) => <span key={n.network} className="chip"><NetIcon network={n.network} size={18} />{n.short}</span>)}</div>
        </>
      )}
      {a?.market?.market_cap && <MarketStats m={a.market} />}
      <h2 className="h2">{t('recent_activity')}</h2>
      {a?.txs?.length ? a.txs.map((tx) => <TxRow key={tx.id} tx={tx} />) : a && <Empty icon="history" title={t('no_activity')} />}
    </Page>
  );
}

const compact = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
};

function MarketStats({ m }) {
  const { t } = useI18n();
  const rows = [
    ['market_rank', m.market_cap_rank ? `#${m.market_cap_rank}` : '—'],
    ['market_cap', fiatCompact(m.market_cap)],
    ['volume_24h', fiatCompact(m.total_volume)],
    ['high_24h', m.high_24h ? priceFmt(m.high_24h) : '—'],
    ['low_24h', m.low_24h ? priceFmt(m.low_24h) : '—'],
    ['all_time_high', m.ath ? priceFmt(m.ath) : '—'],
    ['circulating_supply', compact(m.circulating_supply)],
  ];
  return (
    <>
      <h2 className="h2">{t('market_stats')}</h2>
      <div className="stats-grid">
        {rows.map(([k, v]) => <div key={k} className="stat-cell"><small>{t(k)}</small><b dir="ltr">{v}</b></div>)}
      </div>
    </>
  );
}
