import React, { useMemo, useState } from 'react';
import Icon, { CoinIcon } from '../components/Icon';
import { Page, Segmented, Skeleton } from '../components/ui';
import { pct, priceFmt } from '../format';
import { useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic } from '../telegram';

// Trade hub: live markets for every listed coin, plus the two ways to trade — instant swap and P2P with escrow.
export default function Trade() {
  const { t } = useI18n();
  const { wallet, config } = useApp();
  const f = config?.features || {};
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('top');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = (wallet?.assets || []).filter((a) => Number(a.usd) > 0 && (!s || a.id.toLowerCase().includes(s) || (a.name || '').toLowerCase().includes(s)));
    if (sort === 'gainers') return [...rows].sort((a, b) => Number(b.change24h) - Number(a.change24h));
    if (sort === 'losers') return [...rows].sort((a, b) => Number(a.change24h) - Number(b.change24h));
    return rows;
  }, [wallet, q, sort]);
  return (
    <Page title={t('nav_trade')} root>
      <div className="trade-cards">
        {f.swap !== false && (
          <button type="button" className="trade-card" onClick={() => { haptic.tap(); go('/swap'); }}>
            <span className="tc-ic"><Icon name="swap" size={24} weight="bold" /></span>
            <b>{t('action_swap')}</b><small>{t('trade_swap_sub')}</small>
          </button>
        )}
        {f.p2p !== false && (
          <button type="button" className="trade-card" onClick={() => { haptic.tap(); go('/p2p'); }}>
            <span className="tc-ic"><Icon name="handshake" size={24} weight="bold" /></span>
            <b>{t('action_p2p')}</b><small>{t('trade_p2p_sub')}</small>
          </button>
        )}
      </div>
      <div className="section-head"><h2>{t('markets')}</h2></div>
      <div className="search-box"><Icon name="search" size={18} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} /></div>
      <Segmented value={sort} onChange={setSort} options={[['top', t('markets_all')], ['gainers', t('markets_gainers')], ['losers', t('markets_losers')]]} />
      <div className="asset-list market-list">
        {!wallet && [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={58} r={16} style={{ marginBottom: 8 }} />)}
        {list.map((a) => {
          const ch = Number(a.change24h);
          return (
            <button key={a.id} type="button" className="asset-row" onClick={() => go(`/asset/${a.id}`)}>
              <CoinIcon asset={a.id} size={40} />
              <span className="ar-main"><b>{a.id}</b><small>{a.name}</small></span>
              <span className="ar-right" dir="ltr">
                <b><span key={a.usd} className={a.tick ? `tick-${a.tick}` : undefined}>{priceFmt(a.usd)}</span></b>
                <small className={`chg ${ch >= 0 ? 'up' : 'down'}`}>{pct(ch)}</small>
              </span>
            </button>
          );
        })}
      </div>
    </Page>
  );
}
