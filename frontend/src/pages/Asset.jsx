import React, { useEffect, useState } from 'react';
import { api } from '../api';
import Icon, { CoinIcon, NetIcon } from '../components/Icon';
import TxRow from '../components/TxRow';
import { Empty, Page, Skeleton, Spark } from '../components/ui';
import { amt, fiat, pct, priceFmt } from '../format';
import { useI18n } from '../i18n';
import { go } from '../router';

export default function Asset({ id }) {
  const { t } = useI18n();
  const [a, setA] = useState(null);
  useEffect(() => { api.get(`/api/assets/${id}`).then(setA).catch(() => setA(false)); }, [id]);
  if (a === false) return <Page title={id}><Empty icon="alert" title={t('err_not_found')} /></Page>;
  const ch = Number(a?.change24h || 0);
  return (
    <Page title={a ? a.name : id}>
      <section className="asset-hero">
        <CoinIcon asset={id} size={56} />
        {a ? (
          <>
            <div className="ah-price" dir="ltr">{priceFmt(a.usd)} <span className={ch >= 0 ? 'up' : 'down'}>{pct(ch)}</span></div>
            <Spark points={a.chart} w={320} h={84} />
            <div className="ah-bal" dir="ltr"><b>{amt(Number(a.available) + Number(a.locked), a.display)} {id}</b><span>{fiat(a.value_usd)}</span></div>
            {Number(a.locked) > 0 && <small className="dim">{t('in_orders')}: {amt(a.locked)} {id}</small>}
          </>
        ) : <Skeleton h={120} />}
      </section>
      <div className="actions inline">
        <button type="button" className="act" onClick={() => go(`/deposit?asset=${id}`)}><span className="act-ic"><Icon name="arrowDown" /></span><span>{t('action_deposit')}</span></button>
        <button type="button" className="act" onClick={() => go(`/withdraw?asset=${id}`)}><span className="act-ic"><Icon name="arrowUp" /></span><span>{t('action_withdraw')}</span></button>
        <button type="button" className="act" onClick={() => go(`/send/user?asset=${id}`)}><span className="act-ic"><Icon name="send" /></span><span>{t('action_send')}</span></button>
        {a?.swap && <button type="button" className="act" onClick={() => go(`/swap?from=${id}`)}><span className="act-ic"><Icon name="swap" /></span><span>{t('action_swap')}</span></button>}
      </div>
      {a?.networks?.length > 0 && (
        <>
          <h2 className="h2">{t('networks_label')}</h2>
          <div className="chips">{a.networks.map((n) => <span key={n.network} className="chip"><NetIcon network={n.network} size={18} />{n.short}</span>)}</div>
        </>
      )}
      <h2 className="h2">{t('recent_activity')}</h2>
      {a?.txs?.length ? a.txs.map((tx) => <TxRow key={tx.id} tx={tx} />) : a && <Empty icon="history" title={t('no_activity')} />}
    </Page>
  );
}
