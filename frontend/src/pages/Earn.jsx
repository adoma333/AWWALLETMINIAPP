import React, { useEffect, useRef, useState } from 'react';
import { api, idem } from '../api';
import { useConfirm, withConfirm } from '../components/Confirm';
import Icon, { CoinIcon } from '../components/Icon';
import Success from '../components/Success';
import { AmountInput, Btn, Empty, Li, Page, Pill, Segmented, Sheet, Skeleton, SkeletonList } from '../components/ui';
import { amt, dateShort, fiat } from '../format';
import { errText, useI18n } from '../i18n';
import { useApp } from '../store';
import { haptic } from '../telegram';

/** Design sheet 05.1 — Earn: totals, flexible / locked products set by the admin, my positions, subscribe and redeem. */
export default function Earn({ query = {} }) {
  const { t } = useI18n();
  const { wallet, loadWallet, toast } = useApp();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('flex');
  const [open, setOpen] = useState(null);
  const load = () => api.get('/api/earn').then((d) => {
    setData(d);
    if (query.asset && !open) {
      const p = d.products.find((x) => x.asset === query.asset && !x.term_days) || d.products.find((x) => x.asset === query.asset);
      if (p) setOpen(p);
    }
  }).catch(() => setData(false));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (data === false) return <Page title={t('earn')}><Empty icon="alert" title={t('error_generic')} /></Page>;
  const pos = data?.positions || [];
  const products = (data?.products || []).filter((p) => (tab === 'flex' ? !p.term_days : p.term_days));
  const avg = pos.length ? pos.reduce((s, p) => s + Number(p.apy) * Number(p.amount), 0) / pos.reduce((s, p) => s + Number(p.amount), 0) : 0;
  return (
    <Page title={t('earn')}>
      <div className="card glow" style={{ padding: 18 }}>
        <span className="dim" style={{ fontSize: 13 }}>{t('total_in_earn')}</span>
        {data ? (
          <>
            <div className="row between" style={{ marginTop: 2 }}><span className="mid" dir="ltr">{fiat(data.total_usd)}</span>
              {Number(data.daily_usd) > 0 && <Pill tone="g">+{fiat(data.daily_usd)} {t('per_day')}</Pill>}</div>
            <div className="row" style={{ gap: 18, marginTop: 10, fontSize: 13 }}>
              <span><span className="dim">{t('earned')}</span> <b className="ok" dir="ltr">{fiat(data.earned_usd)}</b></span>
              {avg > 0 && <span><span className="dim">{t('avg_apy')}</span> <b>{avg.toFixed(1)}%</b></span>}
            </div>
          </>
        ) : <Skeleton h={34} w={160} />}
      </div>
      <Segmented value={tab} onChange={setTab} options={[['flex', t('flexible')], ['locked', t('locked')], ['mine', t('my_products')]]} />
      {!data ? <SkeletonList rows={4} /> : tab === 'mine' ? (
        pos.length ? (
          <div className="list">
            {pos.map((p) => {
              const locked = p.term_days && p.ends_at > Date.now() / 1000;
              return (
                <Li key={p.id} coin={p.asset} title={<span dir="ltr">{amt(p.amount)} {p.asset}</span>}
                  sub={locked ? t('locked_until', { date: dateShort(p.ends_at) }) : t('earned_x_daily', { earned: amt(p.earned), daily: amt(p.daily), asset: p.asset })}
                  right={<span className="row g8"><b className="ok disp" style={{ fontSize: 16 }}>{p.apy}%</b>
                    {!locked && <Btn kind="f" size="sm" onClick={async () => {
                      try { await api.post(`/api/earn/${p.id}/redeem`, {}); haptic.success(); toast(t('redeemed'), 'ok'); load(); loadWallet(); } catch (e) { toast(errText(t, e), 'error'); }
                    }}>{t('redeem')}</Btn>}</span>} />
              );
            })}
          </div>
        ) : <Empty icon="earn" title={t('no_positions')} sub={t('no_positions_sub')} action={<Btn size="sm" onClick={() => setTab('flex')}>{t('start_earning')}</Btn>} />
      ) : products.length ? (
        <div className="list">
          {products.map((p) => (
            <Li key={p.id} coin={p.asset} onClick={() => setOpen(p)}
              title={<span className="row g6">{p.asset}{p.hot && <Pill className="xs">🔥 {t('popular')}</Pill>}</span>}
              sub={p.term_days ? t('locked_n_days', { n: p.term_days }) : t('withdraw_anytime')}
              right={<span className="r"><b className="ok disp" style={{ fontSize: 18 }}>{p.apy}%</b><small>APY</small></span>} />
          ))}
        </div>
      ) : <Empty icon="calendar" title={t('no_products')} />}
      <div className="note"><Icon name="info" size={14} /><span>{t('earn_disclaimer')}</span></div>
      <Subscribe product={open} onClose={() => setOpen(null)} wallet={wallet} onDone={() => { load(); loadWallet(); }} />
    </Page>
  );
}

function Subscribe({ product: p, onClose, wallet, onDone }) {
  const { t } = useI18n();
  const { toast } = useApp();
  const ask = useConfirm();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const key = useRef(idem());
  useEffect(() => { setAmount(''); setDone(null); key.current = idem(); }, [p]);
  if (!p) return null;
  const a = wallet?.assets?.find((x) => x.id === p.asset);
  const yearly = Number(amount || 0) * Number(p.apy) / 100;
  const go = async () => {
    setBusy(true);
    try {
      const r = await withConfirm(ask, t, (f) => api.post('/api/earn/subscribe', { product: p.id, amount, idem: key.current, ...f }), {
        title: t('confirm_earn'), cta: t('start_earning'),
        head: <div className="col center g6"><CoinIcon asset={p.asset} size={52} /><span className="mid" dir="ltr">{amt(amount)} {p.asset}</span></div>,
        rows: [['APY', <b className="ok">{p.apy}%</b>], [t('term'), p.term_days ? t('locked_n_days', { n: p.term_days }) : t('flexible')],
          [t('est_daily'), `${amt(yearly / 365, 6)} ${p.asset}`]],
      });
      if (r) { haptic.success(); setDone(r); onDone(); }
    } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet open={Boolean(p)} onClose={onClose} title={done ? '' : `${p.asset} · ${p.apy}% APY`}>
      {done ? (
        <Success title={t('earning_started')} amount={<span dir="ltr">{amt(done.amount)} {done.asset}</span>} sub={t('first_interest_tomorrow')}
          actions={<Btn w onClick={onClose}>{t('done')}</Btn>} />
      ) : (
        <>
          <AmountInput value={amount} onChange={setAmount} asset={p.asset} max={a?.available || '0'} usdPrice={a?.usd} display={a?.display} />
          <div className="card tight">
            <div className="kv"><span>{t('term')}</span><b>{p.term_days ? t('locked_n_days', { n: p.term_days }) : t('withdraw_anytime')}</b></div>
            <div className="kv"><span>{t('est_daily')}</span><b className="ok" dir="ltr">+{amt(yearly / 365, 6)} {p.asset}</b></div>
            <div className="kv"><span>{t('est_year')}</span><b className="ok" dir="ltr">+{amt(yearly, 4)} {p.asset}</b></div>
            {Number(p.min) > 0 && <div className="kv"><span>{t('minimum')}</span><b dir="ltr">{amt(p.min)} {p.asset}</b></div>}
          </div>
          <Btn w loading={busy} disabled={!(Number(amount) >= Number(p.min || 0) && Number(amount) > 0) || Number(amount) > Number(a?.available || 0)} onClick={go}>{t('start_earning')}</Btn>
        </>
      )}
    </Sheet>
  );
}
