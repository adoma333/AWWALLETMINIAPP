import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, idem } from '../api';
import Icon, { CoinIcon } from '../components/Icon';
import Success from '../components/Success';
import { useConfirm, withConfirm } from '../components/Confirm';
import { AssetPicker, Btn, Countdown, Empty, HeadBtn, Li, Page, Pill, Ring, RootHead, Segmented, SkeletonList, Spark, Switch } from '../components/ui';
import { amt, fiat, fiatCompact, num, pct, priceFmt } from '../format';
import { errText, useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic } from '../telegram';
import { P2PMarket } from './P2P';

const TABS = { markets: '/trade', swap: '/swap', p2p: '/p2p' };

/** Design sheet 03 — Trade hub: Markets · Swap · P2P under one header, like the sheet. */
export default function Trade({ tab = 'markets', query = {} }) {
  const { t } = useI18n();
  const { config } = useApp();
  const f = config?.features || {};
  const tabs = [['markets', t('markets')], f.swap !== false && ['swap', t('action_swap')], f.p2p !== false && ['p2p', 'P2P']].filter(Boolean);
  const [search, setSearch] = useState(false);
  const right = {
    markets: <HeadBtn icon="search" onClick={() => setSearch(true)} label={t('search')} />,
    swap: <><HeadBtn icon="repeat" onClick={() => go('/autoinvest')} label={t('autoinvest')} /><HeadBtn icon="history" onClick={() => go('/history?type=swap')} label={t('history')} /></>,
    p2p: <><HeadBtn icon="inbox" onClick={() => go('/p2p/orders')} label={t('my_orders')} /><HeadBtn icon="plus" onClick={() => go('/p2p/new-ad')} label={t('post_ad')} /></>,
  }[tab];
  return (
    <main className="page">
      <RootHead title={t('nav_trade')} right={right} />
      <Segmented variant="e" value={tab} onChange={(v) => go(TABS[v], true)} options={tabs} />
      {tab === 'markets' && <Markets search={search} setSearch={setSearch} />}
      {tab === 'swap' && <SwapBox query={query} />}
      {tab === 'p2p' && <P2PMarket query={query} />}
    </main>
  );
}

function Markets({ search, setSearch }) {
  const { t } = useI18n();
  const { wallet, me } = useApp();
  const watch = me?.settings?.watchlist || [];
  const [cat, setCat] = useState(watch.length ? 'watch' : 'top');
  const [q, setQ] = useState('');
  const [sum, setSum] = useState(() => api.cached('/api/markets/summary') || null);
  useEffect(() => { api.get('/api/markets/summary', { silent: true }).then(setSum).catch(() => {}); }, []);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    let rows = (wallet?.assets || []).filter((a) => Number(a.usd) > 0 && (!s || `${a.id} ${a.name}`.toLowerCase().includes(s)));
    if (cat === 'watch' && !s) rows = rows.filter((a) => watch.includes(a.id));
    if (cat === 'ton') rows = rows.filter((a) => a.networks?.some((n) => n.network === 'ton'));
    if (cat === 'top') rows = [...rows].sort((a, b) => Number(b.cap || 0) - Number(a.cap || 0));
    if (cat === 'gainers') rows = [...rows].sort((a, b) => Number(b.change24h) - Number(a.change24h));
    if (cat === 'losers') rows = [...rows].sort((a, b) => Number(a.change24h) - Number(b.change24h));
    return rows;
  }, [wallet, q, cat, watch]);
  const up = Number(sum?.change24h || 0) >= 0;
  return (
    <>
      {search && (
        <div className="search"><Icon name="search" size={18} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search_coin')} />
          <button type="button" onClick={() => { setQ(''); setSearch(false); }} aria-label={t('close')}><Icon name="x" size={18} /></button></div>
      )}
      <div className="chips">
        {[['watch', `★ ${t('watchlist')}`], ['top', t('markets_top')], ['gainers', t('markets_gainers')], ['losers', t('markets_losers')], ['ton', t('markets_ton')]]
          .map(([k, l]) => <button key={k} type="button" className={`chip ${cat === k ? 'on' : ''}`} onClick={() => { haptic.select(); setCat(k); }}>{l}</button>)}
      </div>
      {sum && Number(sum.cap_usd) > 0 && (
        <div className={`card row g12 mkt-banner ${up ? '' : 'down'}`}>
          <span className={`ic ${up ? 'g' : 'r'}`}><Icon name={up ? 'trend' : 'trendDown'} size={19} /></span>
          <span className="grow"><b style={{ fontSize: 14 }}>{t(up ? 'market_up' : 'market_down')}</b>
            <small className="dim" style={{ display: 'block', fontSize: 12.5 }} dir="ltr">{t('total_cap')} {fiatCompact(sum.cap_usd)} · {pct(sum.change24h)}</small></span>
          <Spark points={sum.spark} w={70} h={28} up={up} />
        </div>
      )}
      {!wallet ? <SkeletonList rows={6} /> : list.length === 0 ? (
        <Empty icon="star" title={t('watchlist_empty')} sub={t('watchlist_empty_sub')} />
      ) : (
        <div className="list">
          {list.map((a) => {
            const ch = Number(a.change24h);
            return (
              <button key={a.id} type="button" className="li" onClick={() => go(`/asset/${a.id}`)}>
                <CoinIcon asset={a.id} size={38} />
                <span className="grow"><b>{a.id}</b><small>{a.name}</small></span>
                <Spark points={a.spark} price={a.usd} w={58} h={24} up={ch >= 0} />
                <span className="r" style={{ minWidth: 84 }} dir="ltr">
                  <b><span key={a.usd} className={a.tick ? `tick-${a.tick}` : undefined}>{priceFmt(a.usd)}</span></b>
                  <small className={ch >= 0 ? 'ok' : 'bad'} style={{ fontWeight: 600 }}>{pct(ch)}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Firm-rate swap: rate locked for the quote lifetime with a draining bar, live re-quote, no network fee, no slippage. */
function SwapBox({ query }) {
  const { t } = useI18n();
  const { wallet, loadWallet, toast } = useApp();
  const [from, setFrom] = useState(query.from || 'USDT');
  const [to, setTo] = useState(query.to || (query.from === 'TON' ? 'USDT' : 'TON'));
  const [amount, setAmount] = useState(query.amount || '');
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [qerr, setQerr] = useState('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const key = useRef(idem());
  const assets = wallet?.assets?.filter((x) => x.swap) || [];
  const fa = assets.find((x) => x.id === from);
  const ta = assets.find((x) => x.id === to);

  const requote = useCallback(async () => {
    if (!Number(amount) || from === to) { setQuote(null); return; }
    setQuoting(true);
    try {
      const q = await api.post('/api/swap/quote', { from, to, amount }, { silent: true });
      setQuote({ ...q, until: Date.now() / 1000 + q.expires_in });
      setQerr('');
    } catch (e) { setQuote(null); setQerr(errText(t, e)); } finally { setQuoting(false); }
  }, [amount, from, to, t]);
  useEffect(() => {
    setQuote(null);
    const id = setTimeout(requote, 450);
    return () => clearTimeout(id);
  }, [requote]);

  const flip = () => { haptic.select(); setFrom(to); setTo(from); setAmount(quote ? quote.amount_out : ''); };
  const exec = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/swap/execute', { quote_id: quote.id, idem: key.current });
      haptic.success();
      setDone(r);
      key.current = idem();
      loadWallet();
    } catch (e) {
      toast(errText(t, e), e.code === 'quote_expired' ? 'info' : 'error');
      if (e.code === 'quote_expired' || e.code === 'quote_used') requote();
    } finally { setBusy(false); }
  };
  if (done) {
    return (
      <Success confetti title={t('swap_success')} amount={<span dir="ltr">+{amt(done.amount_out, ta?.display)} {done.to}</span>}
        sub={<span dir="ltr">{amt(done.amount_in)} {done.from} → {amt(done.amount_out)} {done.to}</span>}
        rows={[[t('rate'), <span dir="ltr">1 {done.from} = {num(done.rate, 8)} {done.to}</span>], [t('network_fee'), <span className="ok">{t('none')}</span>]]}
        actions={<><Btn w onClick={() => { setDone(null); setAmount(''); setQuote(null); }}>{t('done')}</Btn>
          <Btn w kind="s" onClick={() => go(`/tx/${done.id}`)}>{t('details')}</Btn></>} />
    );
  }
  const over = Number(amount) > Number(fa?.available || 0);
  const searching = quoting && !quote && Number(amount) > 0;
  const inv = quote ? 1 / Number(quote.rate) : 0;
  return (
    <>
      <div style={{ position: 'relative' }} className="col g6">
        <div className="card">
          <div className="row between dim" style={{ fontSize: 13 }}><span>{t('you_pay')}</span>
            <button type="button" onClick={() => { haptic.select(); setAmount(String(fa?.available || '0')); }}>{t('balance')} {amt(fa?.available || 0, fa?.display)} · <b className="em">{t('max')}</b></button></div>
          <div className="row between g8" style={{ marginTop: 6 }}>
            <input className={`amt-in ${over ? 'bad' : ''}`} inputMode="decimal" placeholder="0" value={amount} dir="ltr"
              onChange={(e) => setAmount(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))} />
            <button type="button" className="coin-chip" onClick={() => setPick('from')}><CoinIcon asset={from} size={24} />{from}<Icon name="dd" size={16} /></button>
          </div>
          <div className="dim" style={{ fontSize: 13, marginTop: 2 }} dir="ltr">≈ {fiat(Number(amount || 0) * Number(fa?.usd || 0))}</div>
        </div>
        <button type="button" className="swap-flip" onClick={flip} aria-label={t('flip')}><Icon name="swap" size={20} stroke={2.4} /></button>
        <div className="card">
          <div className="row between dim" style={{ fontSize: 13 }}><span>{t('you_get')}</span><span>{t('balance')} {amt(ta?.available || 0, ta?.display)}</span></div>
          <div className="row between g8" style={{ marginTop: 6 }}>
            <span className={`mid ${quote ? '' : 'dim'}`} style={{ fontSize: 34 }} dir="ltr">{quote ? amt(quote.amount_out, ta?.display) : '0'}</span>
            <button type="button" className="coin-chip" onClick={() => setPick('to')}><CoinIcon asset={to} size={24} />{to}<Icon name="dd" size={16} /></button>
          </div>
          <div className="dim" style={{ fontSize: 13, marginTop: 2 }} dir="ltr">≈ {fiat(Number(quote?.amount_out || 0) * Number(ta?.usd || 0))}</div>
        </div>
      </div>

      {searching && (
        <div className="card col center g12" style={{ padding: '22px 16px' }}>
          <div style={{ position: 'relative' }}>
            <Ring pct={0.38} size={96} stroke={7} />
            <span className="breathe" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <span className="row" style={{ gap: 0 }}><CoinIcon asset={from} size={32} /><span style={{ marginInlineStart: -10 }}><CoinIcon asset={to} size={32} /></span></span>
            </span>
          </div>
          <b className="disp" style={{ fontSize: 16 }}>{t('finding_best_price')}</b>
          <span className="dim small center">{t('prices_rejected_note')}</span>
        </div>
      )}
      {qerr && <div className="warn r"><Icon name="alert" size={18} /><span>{qerr}</span></div>}
      {quote && (
        <>
          <div className="card tight">
            <div className="kv"><span>{t('rate')}</span><b dir="ltr">1 {to} = {num(inv, inv > 100 ? 2 : 6)} {from}</b></div>
            {quote.sources > 1 && <div className="kv"><span>{t('best_price_from')}</span><b className="row g6">{t('n_sources', { n: quote.sources })} <Pill tone="g">{t('best')}</Pill></b></div>}
            <div className="kv"><span>{t('fee_slippage')}</span><b className="ok">{quote.free ? t('free') : t('none')}</b></div>
            {quote.vip?.level > 0 && <div className="kv"><span>VIP</span><b>{quote.vip.name} · −{quote.vip.discount_pct}%</b></div>}
            {quote.voucher && <div className="kv"><span>{t('voucher')}</span><b className="ok">{t('fee_free_badge')}</b></div>}
          </div>
          <Countdown until={quote.until} onEnd={requote} render={(left) => (
            <div className="row g10" style={{ alignItems: 'center' }}>
              <div className="prog grow" style={{ height: 5 }}><i style={{ width: `${(left / quote.expires_in) * 100}%` }} /></div>
              <span className="em row g4" style={{ fontSize: 12.5, fontWeight: 600 }}><Icon name="lock" size={12} />{t('rate_locked', { s: Math.ceil(left) })}</span>
            </div>
          )} />
        </>
      )}
      <button type="button" className="card row g12" onClick={() => go(`/autoinvest?to=${to === 'USDT' ? 'BTC' : to}`)}>
        <span className="ic"><Icon name="repeat" size={19} /></span>
        <span className="grow"><b style={{ fontSize: 14.5 }}>{t('autoinvest')}</b><small className="dim" style={{ display: 'block', fontSize: 12.5 }}>{t('autoinvest_sub')}</small></span>
        <span className="chev"><Icon name="chev" size={18} /></span>
      </button>
      <div style={{ height: 70 }} />
      <div className="bar-bottom nav-gap">
        <Btn w loading={busy} disabled={!quote || over} onClick={exec}>{over ? t('err_insufficient_funds', { asset: from }) : t('swap_now')}</Btn>
      </div>
      <AssetPicker open={pick === 'from'} onClose={() => setPick('')} assets={assets} onPick={(x) => { if (x.id === to) setTo(from); setFrom(x.id); }} />
      <AssetPicker open={pick === 'to'} onClose={() => setPick('')} assets={assets} onPick={(x) => { if (x.id === from) setFrom(to); setTo(x.id); }} />
    </>
  );
}

const FREQ = ['daily', 'weekly', 'monthly'];
const PER_YEAR = { daily: 365, weekly: 52, monthly: 12 };

/** Design sheet 03.4 — Auto-invest (recurring buy) + price alerts. */
export function AutoInvest({ query = {} }) {
  const { t } = useI18n();
  const { wallet, toast } = useApp();
  const [to, setTo] = useState(query.to || 'BTC');
  const [from, setFrom] = useState('USDT');
  const [usd, setUsd] = useState('25');
  const [custom, setCustom] = useState(false);
  const [freq, setFreq] = useState('weekly');
  const [plans, setPlans] = useState(() => api.cached('/api/autoinvest')?.items || null);
  const [alerts, setAlerts] = useState([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const ask = useConfirm();
  const load = () => {
    api.get('/api/autoinvest').then((r) => setPlans(r.items)).catch(() => setPlans([]));
    api.get('/api/alerts').then((r) => setAlerts(r.items)).catch(() => {});
  };
  useEffect(load, []);
  const fa = wallet?.assets?.find((x) => x.id === from);
  const amount = fa && Number(fa.usd) > 0 ? String(Number((Number(usd || 0) / Number(fa.usd)).toFixed(fa.precision > 6 ? 6 : fa.precision))) : usd;
  const next = new Date(Date.now() + { daily: 86400e3, weekly: 7 * 86400e3, monthly: 30 * 86400e3 }[freq]);
  const start = async () => {
    setBusy(true);
    try {
      const r = await withConfirm(ask, t, (f) => api.post('/api/autoinvest', { from, to, amount, freq, ...f }), {
        title: t('autoinvest'), cta: t('start_autoinvest'),
        head: <div className="col center g6"><CoinIcon asset={to} size={52} /><b className="disp" style={{ fontSize: 20 }}>{t('every_x', { amount: fiat(usd), freq: t(`unit_${freq}`) })}</b></div>,
        rows: [[t('buy'), to], [t('pay_with'), from], [t('frequency'), t(`freq_${freq}`)]],
      });
      if (r) { haptic.success(); toast(t('autoinvest_started'), 'ok'); load(); }
    } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };
  const swappable = wallet?.assets?.filter((x) => x.swap) || [];
  return (
    <Page title={t('autoinvest')} bar={<Btn w loading={busy} disabled={!(Number(usd) > 0)} onClick={start}>{t('start_autoinvest')}</Btn>}>
      <button type="button" className="card glow col center g6" style={{ padding: '20px 16px' }} onClick={() => setPick('to')}>
        <CoinIcon asset={to} size={52} />
        <b className="disp" style={{ fontSize: 22 }}>{t('every_x', { amount: fiat(usd || 0), freq: t(`unit_${freq}`) })}</b>
        <span className="dim" style={{ fontSize: 13.5 }}>{t('buy_x_with_y', { to, from })} · <span className="em">{t('change')}</span></span>
      </button>
      <div className="h2"><span>{t('amount')}</span></div>
      <div className="chips">
        {['10', '25', '50', '100'].map((x) => <button key={x} type="button" className={`chip ${!custom && usd === x ? 'oe' : ''}`} onClick={() => { setCustom(false); setUsd(x); }}>{fiat(x, 0)}</button>)}
        <button type="button" className={`chip ${custom ? 'oe' : ''}`} onClick={() => setCustom(true)}>{t('custom')}</button>
      </div>
      {custom && <div className="input"><Icon name="dollar" size={18} /><input autoFocus inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ''))} dir="ltr" /></div>}
      <div className="h2"><span>{t('frequency')}</span></div>
      <Segmented value={freq} onChange={setFreq} options={FREQ.map((x) => [x, t(`freq_${x}`)])} />
      <div className="card tight">
        <div className="kv"><span>{t('next_buy')}</span><b>{next.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</b></div>
        <div className="kv"><span>{t('projected_year')}</span><b className="ok">{t('x_invested', { amount: fiat(Number(usd || 0) * PER_YEAR[freq], 0) })}</b></div>
        <div className="kv"><span>{t('pay_with')}</span><button type="button" className="b em" onClick={() => setPick('from')}>{from} · {amt(fa?.available || 0, fa?.display)}</button></div>
      </div>

      {plans?.length > 0 && (
        <>
          <div className="h2"><span>{t('my_plans')}</span></div>
          <div className="list">
            {plans.map((p) => (
              <Li key={p.id} coin={p.to} title={`${amt(p.amount)} ${p.from} · ${t(`freq_${p.freq}`)}`}
                sub={p.last_error ? <span className="bad">{errText(t, { code: p.last_error })}</span> : p.runs ? t('plan_progress', { n: p.runs, amount: amt(p.bought), asset: p.to }) : t('next_buy_on', { date: new Date(p.next_at * 1000).toLocaleDateString() })}
                right={<span className="row g8"><Switch on={p.active} onChange={async (v) => { await api.patch(`/api/autoinvest/${p.id}`, { active: v }); load(); }} />
                  <button type="button" className="ic xs n" aria-label={t('delete')} onClick={async () => { await api.patch(`/api/autoinvest/${p.id}`, { delete: true }); load(); }}><Icon name="trash" size={15} /></button></span>} />
            ))}
          </div>
        </>
      )}

      <div className="h2"><span>{t('price_alerts')}</span><button type="button" onClick={() => go(`/asset/${to}`)}>+ {t('add')}</button></div>
      {alerts.length ? (
        <div className="list">
          {alerts.map((al) => (
            <Li key={al.id} coin={al.asset} title={t(al.op === 'above' ? 'alert_x_above' : 'alert_x_below', { asset: al.asset, price: priceFmt(al.price) })}
              sub={al.repeat ? t('alert_repeat') : t('alert_once')}
              right={<button type="button" className="ic xs r" aria-label={t('delete')} onClick={async () => { await api.del(`/api/alerts/${al.id}`); load(); }}><Icon name="trash" size={15} /></button>} />
          ))}
        </div>
      ) : <div className="note"><Icon name="bell" size={16} /><span>{t('alerts_empty')}</span></div>}

      <AssetPicker open={pick === 'to'} onClose={() => setPick('')} assets={swappable.filter((x) => x.id !== from)} onPick={(x) => setTo(x.id)} />
      <AssetPicker open={pick === 'from'} onClose={() => setPick('')} assets={swappable.filter((x) => x.id !== to)} onPick={(x) => setFrom(x.id)} />
    </Page>
  );
}
