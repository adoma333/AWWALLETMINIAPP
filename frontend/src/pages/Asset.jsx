import React, { useEffect, useState } from 'react';
import { api } from '../api';
import Icon, { CoinIcon, NetIcon } from '../components/Icon';
import TxRow from '../components/TxRow';
import { AreaChart, Btn, Empty, HeadBtn, Input, Page, Pill, Segmented, Sheet, Skeleton, Switch } from '../components/ui';
import { amt, fiat, fiatCompact, pct, priceFmt } from '../format';
import { errText, useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic } from '../telegram';

const RANGES = ['1H', '1D', '1W', '1M', '1Y', 'ALL'];

/** Design sheet 02.2 — Coin details: live price, chart ranges with scrubbing, holdings, actions, market data, price alerts. */
export default function Asset({ id }) {
  const { t } = useI18n();
  const { wallet, config, toast } = useApp();
  const [detail, setDetail] = useState(null);
  const [range, setRange] = useState('1D');
  const [points, setPoints] = useState(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const load = () => api.get(`/api/assets/${id}`).then(setDetail).catch(() => setDetail(false));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPoints(null);
    api.get(`/api/assets/${id}/chart?range=${range}`, { silent: true }).then((r) => setPoints(r.points)).catch(() => setPoints([]));
  }, [id, range]);
  if (detail === false) return <Page title={id}><Empty icon="alert" title={t('err_not_found')} /></Page>;

  const live = wallet?.assets?.find((x) => x.id === id);
  const a = detail && live ? { ...detail, ...live } : detail || live;
  const f = config?.features || {};
  const first = points?.length ? Number(points[0][1]) : null;
  const usd = Number(a?.usd || 0);
  const rangeCh = first ? ((usd - first) / first) * 100 : Number(a?.change24h || 0);
  const ch = range === '1D' || !first ? Number(a?.change24h || 0) : rangeCh;
  const delta = first ? usd - first : (usd * ch) / (100 + ch);
  const bal = Number(a?.available || 0) + Number(a?.locked || 0);
  const valueDelta = bal * delta;
  const m = a?.market || {};
  const alert = a?.alerts?.[0];
  const earn = (config?.earn_rates || {})[id];
  const fmtPt = (p) => `${priceFmt(p[1])} · ${new Date(p[0] * 1000).toLocaleString(undefined, range === '1H' || range === '1D' ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' })}`;

  return (
    <Page title={a?.name || id} right={<HeadBtn icon="bell" onClick={() => setAlertOpen(true)} label={t('price_alert')} dot={!!alert} />}>
      <div className="row">
        <CoinIcon asset={id} size={46} />
        {a ? (
          <span className="col">
            <span className="mid num" style={{ fontSize: 30 }} dir="ltr"><span key={a.usd} className={a.tick ? `tick-${a.tick}` : undefined}>{priceFmt(usd)}</span></span>
            <span className={`b ${ch >= 0 ? 'ok' : 'bad'}`} style={{ fontSize: 13.5 }} dir="ltr">{ch >= 0 ? '▲' : '▼'} {pct(ch)} · {fiat(Math.abs(delta))} {range === '1D' ? t('today') : range}</span>
          </span>
        ) : <span className="col g6"><Skeleton w={150} h={30} /><Skeleton w={120} h={14} /></span>}
      </div>

      <AreaChart points={points} h={160} format={fmtPt} />
      <Segmented value={range} onChange={(v) => { haptic.select(); setRange(v); }} options={RANGES.map((r) => [r, t(`range_${r}`)])} />

      <div className="card row between">
        <span className="col">
          <span className="dim" style={{ fontSize: 13 }}>{t('your_balance')}</span>
          <b className="disp" style={{ fontSize: 20 }} dir="ltr">{amt(bal, a?.display ?? 4)} {id}</b>
          <span className="dim" style={{ fontSize: 13 }} dir="ltr">{fiat(a?.value_usd || 0)}{bal > 0 && <> · <span className={valueDelta >= 0 ? 'ok' : 'bad'}>{valueDelta >= 0 ? '+' : '−'}{fiat(Math.abs(valueDelta))}</span></>}</span>
          {Number(a?.locked) - Number(a?.earning || 0) > 0 && <span className="dim xs">{t('in_orders')}: {amt(Number(a.locked) - Number(a.earning || 0))} {id}</span>}
          {Number(a?.earning) > 0 && <button type="button" className="ok xs b" style={{ textAlign: 'start' }} onClick={() => go('/earn')}>{t('in_earn')}: {amt(a.earning)} {id}</button>}
        </span>
        {earn && f.earn !== false && <button type="button" onClick={() => go(`/earn?asset=${id}`)}><Pill icon="percent">{t('earn_apy', { apy: earn })}</Pill></button>}
      </div>

      <div className="acts">
        {[['down', t('action_deposit'), `/deposit?asset=${id}`, 1, f.deposit !== false], ['send', t('action_send'), `/send?asset=${id}`, 0, true],
          ['swap', t('action_swap'), `/swap?from=${id}`, 0, a?.swap !== false && f.swap !== false], ['up', t('action_withdraw'), `/withdraw?asset=${id}`, 0, f.withdraw !== false]]
          .filter((x) => x[4]).map(([i, l, to, main]) => (
            <button key={i} type="button" className={`act sm ${main ? 'm' : ''}`} onClick={() => { haptic.tap(); go(to); }}>
              <span className="o"><Icon name={i} size={22} stroke={2.2} /></span>{l}
            </button>
          ))}
      </div>

      <div className="card tight">
        {m.market_cap_rank && <div className="kv"><span>{t('market_rank')}</span><b>#{m.market_cap_rank}</b></div>}
        {m.market_cap && <div className="kv"><span>{t('market_cap')}</span><b>{fiatCompact(m.market_cap)}</b></div>}
        {m.total_volume && <div className="kv"><span>{t('volume_24h')}</span><b>{fiatCompact(m.total_volume)}</b></div>}
        {m.high_24h && <div className="kv"><span>{t('high_24h')} · {t('low_24h')}</span><b dir="ltr">{priceFmt(m.high_24h)} · {priceFmt(m.low_24h)}</b></div>}
        {m.ath && <div className="kv"><span>{t('all_time_high')}</span><b dir="ltr">{priceFmt(m.ath)}</b></div>}
        <button type="button" className="kv" style={{ width: '100%' }} onClick={() => setAlertOpen(true)}>
          <span>{t('price_alert')}</span><b className="em">{alert ? t(alert.op === 'above' ? 'alert_above' : 'alert_below', { price: priceFmt(alert.price) }) : t('alert_set')}</b>
        </button>
      </div>

      {a?.networks?.length > 0 && (
        <>
          <div className="h2"><span>{t('networks_label')}</span></div>
          <div className="chips">{a.networks.map((n) => <span key={n.network} className="chip"><NetIcon network={n.network} size={18} />{n.short}</span>)}</div>
        </>
      )}

      <div className="h2"><span>{t('recent_activity')}</span><button type="button" onClick={() => go(`/history?asset=${id}`)}>{t('see_all')}</button></div>
      {detail?.txs?.length ? <div className="list">{detail.txs.map((tx) => <TxRow key={tx.id} tx={tx} />)}</div>
        : detail ? <Empty icon="history" title={t('no_activity')} /> : <Skeleton h={120} r={22} />}

      <AlertSheet open={alertOpen} onClose={() => setAlertOpen(false)} asset={id} price={usd} alerts={a?.alerts || []}
        onChange={() => { load(); toast(t('alert_saved'), 'ok'); }} onError={(e) => toast(errText(t, e), 'error')} />
    </Page>
  );
}

function AlertSheet({ open, onClose, asset, price, alerts, onChange, onError }) {
  const { t } = useI18n();
  const [target, setTarget] = useState('');
  const [repeat, setRepeat] = useState(false);
  useEffect(() => { if (open) setTarget(price ? String(Number((price * 1.05).toPrecision(4))) : ''); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = Number(target || 0);
  const op = n >= price ? 'above' : 'below';
  return (
    <Sheet open={open} onClose={onClose} title={t('price_alert')}>
      <span className="dim center small">{t('alert_now', { asset, price: priceFmt(price) })}</span>
      <div className="chips" style={{ justifyContent: 'center', margin: 0, padding: 0 }}>
        {[-10, -5, 5, 10, 20].map((p) => (
          <button key={p} type="button" className="chip s2" onClick={() => setTarget(String(Number((price * (1 + p / 100)).toPrecision(4))))}>{p > 0 ? '+' : ''}{p}%</button>
        ))}
      </div>
      <Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))} dir="ltr"
        icon="dollar" placeholder="0.00" right={<Pill tone={op === 'above' ? 'g' : 'r'}>{t(op === 'above' ? 'alert_when_above' : 'alert_when_below')}</Pill>} />
      <div className="list"><div className="li sm"><span className="grow">{t('alert_repeat')}</span><Switch on={repeat} onChange={setRepeat} /></div></div>
      <Btn w disabled={!(n > 0)} onClick={async () => {
        try { await api.post('/api/alerts', { asset, op, price: target, repeat }); onClose(); onChange(); } catch (e) { onError(e); }
      }}>{t('alert_create')}</Btn>
      {alerts.length > 0 && (
        <div className="list">
          {alerts.map((al) => (
            <div key={al.id} className="li sm">
              <span className="ic xs"><Icon name="bell" size={15} /></span>
              <span className="grow">{t(al.op === 'above' ? 'alert_above' : 'alert_below', { price: priceFmt(al.price) })}</span>
              <button type="button" className="ic xs r" onClick={async () => { await api.del(`/api/alerts/${al.id}`); onChange(); }}><Icon name="trash" size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
