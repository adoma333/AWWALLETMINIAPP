import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, fileToDataUrl, idem } from '../api';
import { useConfirm, withConfirm } from '../components/Confirm';
import Icon, { CoinIcon } from '../components/Icon';
import { Confetti } from '../components/Success';
import { Avatar, Btn, Countdown, Empty, Field, HeadBtn, Li, Page, Pill, Segmented, Sheet, Skeleton, Status, Switch, Timeline, useCopy } from '../components/ui';
import { amt, mmss, num, timeAgo } from '../format';
import { errText, useI18n } from '../i18n';
import { go, match } from '../router';
import { useApp } from '../store';
import { confirmPopup, haptic } from '../telegram';

export default function P2P({ path, query }) {
  let m;
  if ((m = match('/p2p/ad/:id', path))) return <AdView id={m.id} />;
  if ((m = match('/p2p/order/:id/chat', path))) return <OrderChat id={m.id} />;
  if ((m = match('/p2p/order/:id', path))) return <OrderRoom id={m.id} />;
  if ((m = match('/p2p/profile/:id', path))) return <TraderProfile id={m.id} />;
  if (path === '/p2p/orders') return <MyOrders />;
  if (path === '/p2p/my-ads') return <MyAds />;
  if (path === '/p2p/new-ad') return <CreateAd />;
  if (path === '/p2p/methods') return <Methods query={query} />;
  return null; // the market itself lives in the Trade tab
}

function useMeta(fiat) {
  const [meta, setMeta] = useState(null);
  useEffect(() => { api.get(`/api/p2p/meta?fiat=${fiat || ''}`).then(setMeta).catch(() => {}); }, [fiat]);
  return meta;
}

function defaultFiat(me) {
  const c = me?.settings?.currency;
  try { return c && c !== 'USD' ? c : (localStorage.getItem('aw_p2p_fiat') || 'USD'); } catch { return c || 'USD'; }
}

const releaseMin = (s) => (s?.avg_release_sec ? Math.max(1, Math.round(s.avg_release_sec / 60)) : null);

/** Design sheet 03.5 — P2P market: buy/sell, coin and currency pickers, method chips, merchant cards. */
export function P2PMarket({ query = {} }) {
  const { t } = useI18n();
  const { me } = useApp();
  const [side, setSide] = useState(query.side === 'sell' ? 'sell' : 'buy');
  const [asset, setAsset] = useState(query.asset || 'USDT');
  const [fiat, setFiat] = useState(defaultFiat(me));
  const [method, setMethod] = useState('');
  const [amount, setAmount] = useState('');
  const [items, setItems] = useState(null);
  const [mp, setMp] = useState('');
  const [sheet, setSheet] = useState('');
  const meta = useMeta(fiat);
  useEffect(() => {
    setItems(null);
    const id = setTimeout(() => api.get(`/api/p2p/market?asset=${asset}&fiat=${fiat}&side=${side}&method=${method}&amount=${amount}`)
      .then((r) => { setItems(r.items); setMp(r.market_price); }).catch(() => setItems([])), 250);
    return () => clearTimeout(id);
  }, [asset, fiat, side, method, amount]);
  const methodName = (id) => meta?.methods?.find((m) => m.id === id)?.name || id;
  const buy = side === 'buy';
  return (
    <>
      <div className="row g8">
        <div className="seg" style={{ flex: '0 0 150px' }}>
          {[['buy', t('buy')], ['sell', t('sell')]].map(([k, l]) => (
            <button key={k} type="button" className={side === k ? `on ${k}` : ''} onClick={() => { haptic.select(); setSide(k); }}>{l}</button>
          ))}
        </div>
        <button type="button" className="chip" onClick={() => setSheet('asset')}><CoinIcon asset={asset} size={18} />{asset}<Icon name="dd" size={14} /></button>
        <button type="button" className="chip" onClick={() => setSheet('fiat')}>{fiat}<Icon name="dd" size={14} /></button>
      </div>
      <div className="chips">
        <button type="button" className={`chip ${!method ? 'on' : ''}`} onClick={() => setMethod('')}>{t('all_methods')}</button>
        {(meta?.methods || []).slice(0, 8).map((m) => <button key={m.id} type="button" className={`chip ${method === m.id ? 'on' : ''}`} onClick={() => setMethod(m.id)}>{m.name}</button>)}
      </div>
      <div className="input"><Icon name="coins" size={18} /><input inputMode="decimal" placeholder={t('amount_in', { fiat })} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} dir="ltr" />
        {mp && Number(mp) > 0 && <Pill tone="g">{t('market_x', { price: num(mp, 4) })}</Pill>}</div>
      {!items && [0, 1, 2].map((i) => <Skeleton key={i} h={118} r={22} />)}
      {items?.length === 0 && <Empty icon="p2p" title={t('no_ads')} sub={t('no_ads_sub')} action={<Btn kind="f" size="sm" icon="plus" onClick={() => go('/p2p/new-ad')}>{t('post_ad')}</Btn>} />}
      {items?.map((ad) => {
        const st = ad.maker.stats || {};
        const rm = releaseMin(st);
        return (
          <div key={ad.id} className="card ad-card">
            <button type="button" className="row g8" style={{ width: '100%' }} onClick={() => go(`/p2p/profile/${ad.maker.id}`)}>
              <Avatar src={ad.maker.photo} name={ad.maker.name} size={30} seed={ad.maker.id} />
              <b style={{ fontSize: 14.5 }} className="ellipsis">{ad.maker.name}</b>
              {ad.maker.merchant && <Pill tone="y" icon="shieldok">{t('merchant')}</Pill>}
              {rm && <span className="dim row g4" style={{ marginInlineStart: 'auto', fontSize: 12 }}><Icon name="clock" size={12} />~{rm} {t('min_short')}</span>}
            </button>
            <div className="row between" style={{ marginTop: 8, alignItems: 'flex-end' }}>
              <span className="col">
                <span className="price-big" dir="ltr">{num(ad.price, 4)} <small className="dim" style={{ font: '500 13px var(--f-body)' }}>{fiat}</small></span>
                <small className="dim" style={{ fontSize: 12 }}>{t('orders_n', { n: st.orders_30d || 0 })}{st.completion_pct != null && ` · ${st.completion_pct}%`}</small>
                <small className="dim" style={{ fontSize: 12 }} dir="ltr">{t('limit')} {num(ad.min_fiat, 0)} – {num(ad.max_fiat, 0)} {fiat}</small>
              </span>
              <Btn size="sm" kind={buy ? 'buy' : 'sell'} onClick={() => go(`/p2p/ad/${ad.id}`)}>{buy ? t('buy') : t('sell')}</Btn>
            </div>
            <div className="row g6 wrap" style={{ marginTop: 8 }}>
              {ad.methods.map((m) => <span key={m} className="pill n">{methodName(m)}</span>)}
            </div>
          </div>
        );
      })}
      <div className="row g8">
        <Btn kind="f" size="sm" className="grow" icon="megaphone" onClick={() => go('/p2p/my-ads')}>{t('my_ads')}</Btn>
        <Btn kind="f" size="sm" className="grow" icon="card" onClick={() => go('/p2p/methods')}>{t('my_methods')}</Btn>
      </div>
      <Sheet open={sheet === 'fiat'} onClose={() => setSheet('')} title={t('fiat')}>
        <div className="chips wrap" style={{ flexWrap: 'wrap' }}>{(meta?.fiats || []).map((f) => (
          <button key={f} type="button" className={`chip ${f === fiat ? 'oe' : ''}`} onClick={() => { setFiat(f); try { localStorage.setItem('aw_p2p_fiat', f); } catch { /* */ } setSheet(''); }}>{f}</button>))}</div>
      </Sheet>
      <Sheet open={sheet === 'asset'} onClose={() => setSheet('')} title={t('choose_asset')}>
        <div className="list">{(meta?.assets || ['USDT']).map((a) => <Li key={a} coin={a} title={a} onClick={() => { setAsset(a); setSheet(''); }} right={a === asset ? <Icon name="check" size={18} className="em" /> : null} />)}</div>
      </Sheet>
    </>
  );
}

function AdView({ id }) {
  const { t } = useI18n();
  const { toast } = useApp();
  const [ad, setAd] = useState(null);
  const [fiatAmt, setFiatAmt] = useState('');
  const [method, setMethod] = useState('');
  const [umId, setUmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(idem());
  const meta = useMeta(ad?.fiat);
  useEffect(() => { api.get(`/api/p2p/ads/${id}`).then((a) => { setAd(a); if (a.methods.length === 1) setMethod(a.methods[0]); }).catch((e) => toast(errText(t, e), 'error')); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ad) return <Page title={t('order')}><Skeleton h={300} r={22} /></Page>;
  const iBuy = ad.side === 'sell';
  const cryptoAmt = Number(fiatAmt || 0) / Number(ad.price);
  const myMethods = (meta?.my_methods || []).filter((m) => m.method_id === method);
  const out = Number(fiatAmt) > 0 && (Number(fiatAmt) < Number(ad.min_fiat) || Number(fiatAmt) > Number(ad.max_fiat));
  const place = async () => {
    setBusy(true);
    try {
      const o = await api.post('/api/p2p/orders', { ad_id: ad.id, fiat_amount: fiatAmt, method_id: method, user_method_id: umId, idem: key.current });
      haptic.success();
      go(`/p2p/order/${o.id}`, true);
    } catch (e) {
      toast(errText(t, e), 'error');
      if (e.code === 'method_details_required') go(`/p2p/methods?add=${method}`);
    } finally { setBusy(false); }
  };
  const methodName = (mid) => meta?.methods?.find((m) => m.id === mid)?.name || mid;
  const st = ad.maker.stats || {};
  return (
    <Page title={iBuy ? t('buy_asset', { asset: ad.asset }) : t('sell_asset', { asset: ad.asset })}
      bar={<Btn w loading={busy} kind={iBuy ? 'buy' : 'sell'} disabled={!Number(fiatAmt) || !method || out} onClick={place}>{iBuy ? t('buy_asset', { asset: ad.asset }) : t('sell_asset', { asset: ad.asset })}</Btn>}>
      <button type="button" className="card row g12" onClick={() => go(`/p2p/profile/${ad.maker.id}`)}>
        <Avatar src={ad.maker.photo} name={ad.maker.name} size={42} seed={ad.maker.id} />
        <span className="grow"><b className="row g6" style={{ fontSize: 15 }}>{ad.maker.name}{ad.maker.merchant && <Pill tone="y" icon="shieldok">{t('merchant')}</Pill>}</b>
          <small className="dim" style={{ fontSize: 12.5 }}>{t('orders_n', { n: st.orders_30d || 0 })}{st.completion_pct != null && ` · ${st.completion_pct}%`}{releaseMin(st) && ` · ~${releaseMin(st)} ${t('min_short')}`}</small></span>
        <span className="chev"><Icon name="chev" size={18} /></span>
      </button>
      <div className="card pad12">
        <div className="row between dim" style={{ fontSize: 13 }}><span>{iBuy ? t('i_will_pay') : t('i_will_receive')}</span>
          <button type="button" className="em b" onClick={() => setFiatAmt(String(ad.max_fiat))}>{t('max')}</button></div>
        <div className="row between g8" style={{ marginTop: 4 }}>
          <input className={`amt-in ${out ? 'bad' : ''}`} inputMode="decimal" value={fiatAmt} onChange={(e) => setFiatAmt(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" dir="ltr" />
          <span className="disp dim" style={{ fontSize: 16 }}>{ad.fiat}</span>
        </div>
        <div className="row between dim small" dir="ltr"><span>= {amt(cryptoAmt || 0)} {ad.asset}</span><span>{num(ad.min_fiat, 0)} – {num(ad.max_fiat, 0)}</span></div>
      </div>
      <div className="card tight">
        <div className="kv"><span>{t('price')}</span><b dir="ltr">{num(ad.price, 4)} {ad.fiat}</b></div>
        <div className="kv"><span>{t('available_amount')}</span><b dir="ltr">{amt(ad.remaining)} {ad.asset}</b></div>
        <div className="kv"><span>{t('pay_within')}</span><b>{ad.window_min} {t('min_short')}</b></div>
      </div>
      <div className="h2"><span>{t('payment_methods')}</span></div>
      <div className="chips">{ad.methods.map((m) => <button key={m} type="button" className={`chip ${method === m ? 'oe' : ''}`} onClick={() => setMethod(m)}>{methodName(m)}</button>)}</div>
      {!iBuy && method && (myMethods.length ? (
        <div className="chips">{myMethods.map((m) => <button key={m.id} type="button" className={`chip s2 ${umId === m.id ? 'oe' : ''}`} onClick={() => setUmId(m.id)}>{m.label || Object.values(m.data)[0]}</button>)}</div>
      ) : <Btn kind="f" size="sm" icon="plus" onClick={() => go(`/p2p/methods?add=${method}`)}>{t('add_method')}</Btn>)}
      {ad.terms && <div className="card"><b style={{ fontSize: 13.5 }}>{t('seller_terms')}</b><p className="dim small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{ad.terms}</p></div>}
      <div className="warn g"><Icon name="shieldok" size={17} /><span>{t('escrow_note')}</span></div>
    </Page>
  );
}

const REASONS = ['not_received', 'not_released', 'wrong_amount', 'other'];
const DONE = ['completed', 'cancelled', 'expired'];

function useOrder(id) {
  const [o, setO] = useState(null);
  const load = () => api.get(`/api/p2p/orders/${id}`).then(setO).catch(() => {});
  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return [o, setO, load];
}

function CopyKV({ k, v, mono }) {
  const [ok, copy] = useCopy();
  return (
    <button type="button" className="kv" style={{ width: '100%' }} onClick={() => copy(String(v))}>
      <span>{k}</span><b className={`row g6 ${mono ? 'mono' : ''}`} dir="ltr">{v}<Icon name={ok ? 'check' : 'copy'} size={13} className={ok ? 'ok' : 'dim'} /></b>
    </button>
  );
}

/** Design sheet 03.6 — P2P order: escrow steps, payment timer, payment details, guarded actions. */
function OrderRoom({ id }) {
  const { t } = useI18n();
  const { loadWallet, toast } = useApp();
  const ask = useConfirm();
  const [o, setO, load] = useOrder(id);
  const [busy, setBusy] = useState('');
  const [appealOpen, setAppealOpen] = useState(false);
  const [reason, setReason] = useState('not_received');
  const [details, setDetails] = useState('');
  const [party, setParty] = useState(false);
  const act = async (action, body = {}, needPin = false) => {
    setBusy(action);
    try {
      const call = (f = {}) => api.post(`/api/p2p/orders/${id}/${action}`, { ...body, ...f });
      const r = needPin ? await withConfirm(ask, t, call, { title: t('release'), summary: t('confirm_release_q'), cta: t('release') }) : await call();
      if (r) { setO(r); haptic.success(); if (action === 'release') { setParty(true); loadWallet(); } }
    } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(''); }
  };
  if (!o) return <Page title={t('order')}><Skeleton h={160} r={22} /><Skeleton h={180} r={22} /></Page>;
  const buyer = o.role === 'buyer';
  const other = buyer ? o.seller : o.buyer;
  const s = o.status;
  const steps = [
    { title: t('escrow_locked', { asset: o.asset }), sub: t('escrow_locked_sub'), state: 'done' },
    { title: buyer ? t('step_transfer') : t('step_wait_payment'), sub: buyer ? t('step_transfer_sub') : t('step_wait_payment_sub'),
      state: s === 'pending' ? 'now' : ['paid', 'appeal', 'completed'].includes(s) ? 'done' : 'fail' },
    { title: buyer ? t('step_seller_releases', { asset: o.asset }) : t('step_you_release', { asset: o.asset }), sub: t('step_release_sub'),
      state: s === 'completed' ? 'done' : ['paid', 'appeal'].includes(s) ? 'now' : '' },
  ];
  const bar = !DONE.includes(s) && (
    <div className="row g10">
      {buyer && s === 'pending' && <Btn kind="s" style={{ flex: '0 0 110px' }} loading={busy === 'cancel'} onClick={async () => { if (await confirmPopup(t('cancel_order_q'))) act('cancel'); }}>{t('cancel')}</Btn>}
      {buyer && s === 'pending' && <Btn className="grow" loading={busy === 'paid'} onClick={async () => { if (await confirmPopup(t('confirm_paid_q'))) act('paid'); }}>{t('i_have_paid')}</Btn>}
      {!buyer && ['paid', 'appeal'].includes(s) && <Btn className="grow" kind="okb" loading={busy === 'release'} onClick={() => act('release', {}, true)}>{t('release_x', { amount: amt(o.amount), asset: o.asset })}</Btn>}
      {s === 'paid' && Date.now() / 1000 >= o.appeal_after && <Btn kind="danger" style={buyer ? { flex: 1 } : { flex: '0 0 110px' }} onClick={() => setAppealOpen(true)}>{t('appeal')}</Btn>}
      {!buyer && s === 'pending' && <Btn kind="s" w onClick={() => go(`/p2p/order/${id}/chat`)} icon="chat">{t('open_chat')}</Btn>}
    </div>
  );
  return (
    <Page title={`${buyer ? t('buy') : t('sell')} ${o.asset}`} bar={bar} right={<HeadBtn icon="chat" onClick={() => go(`/p2p/order/${id}/chat`)} label={t('chat')} dot={o.unread > 0} />}>
      {party && <Confetti />}
      <div className="card glow col center g4" style={{ padding: 18 }}>
        {s === 'pending' ? (
          <>
            <span className="dim" style={{ fontSize: 13 }}>{buyer ? t('pay_seller_within') : t('buyer_pays_within')}</span>
            <Countdown until={o.expires_at} onEnd={load} render={(l) => <span className="disp em" style={{ fontSize: 34 }} dir="ltr">{mmss(l)}</span>} />
          </>
        ) : <Status status={s} />}
        <span className="mid" style={{ fontSize: 22 }} dir="ltr">{num(o.fiat_amount, 2)} {o.fiat}</span>
        <span className="dim" style={{ fontSize: 13 }} dir="ltr">{t('for_x_at', { amount: `${amt(o.amount)} ${o.asset}`, price: num(o.price, 4) })}</span>
      </div>
      <div className="card"><Timeline steps={steps} /></div>
      {o.payment?.data && (
        <div className="card tight">
          <div className="kv"><span>{t('method')}</span><b className="em">{o.payment.method}</b></div>
          {Object.entries(o.payment.data).map(([k, v]) => <CopyKV key={k} k={t(`field_${k}`)} v={String(v)} mono={/iban|account|number|card/.test(k)} />)}
          <CopyKV k={t('amount')} v={num(o.fiat_amount, 2)} />
        </div>
      )}
      <button type="button" className="card row g12" onClick={() => go(`/p2p/profile/${other.id}`)}>
        <Avatar src={other.photo} name={other.name} size={36} seed={other.id} />
        <span className="grow"><b style={{ fontSize: 14.5 }}>{other.name}</b><small className="dim" style={{ display: 'block', fontSize: 12.5 }}>{buyer ? t('seller') : t('buyer')} · #{o.id}</small></span>
        <span className="chev"><Icon name="chev" size={18} /></span>
      </button>
      {buyer && s === 'pending' && <div className="warn"><Icon name="alert" size={17} /><span>{t('p2p_note_warning')}</span></div>}
      {!buyer && s === 'paid' && <div className="warn"><Icon name="alert" size={17} /><span>{t('safety_tip')}</span></div>}
      {s === 'paid' && Date.now() / 1000 < o.appeal_after && <div className="note center"><Icon name="clock" size={15} />{t('appeal_wait', { min: Math.ceil((o.appeal_after - Date.now() / 1000) / 60) })}</div>}
      {o.dispute && <div className="warn r"><Icon name="flag" size={17} /><span>{t(`reason_${o.dispute.reason}`)}{o.dispute.resolution ? ` — ${o.dispute.resolution}` : ''}</span></div>}
      {s === 'completed' && !o.reviewed && (
        <div className="card col g10"><b style={{ fontSize: 14.5 }}>{t('leave_review')}</b>
          <div className="row g8"><Btn kind="f" className="grow" onClick={() => act('review', { positive: true })}>👍 {t('positive')}</Btn>
            <Btn kind="s" className="grow" onClick={() => act('review', { positive: false })}>👎 {t('negative')}</Btn></div></div>
      )}
      <Sheet open={appealOpen} onClose={() => setAppealOpen(false)} title={t('appeal')}>
        <span className="dim small center">{t('appeal_sub')}</span>
        <div className="col g8">{REASONS.map((r) => <button key={r} type="button" className={`opt-tile ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}><b style={{ margin: 0 }}>{t(`reason_${r}`)}</b></button>)}</div>
        <Field label={t('appeal_details')}><textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
        <Btn w kind="danger" loading={busy === 'appeal'} onClick={() => { setAppealOpen(false); act('appeal', { reason, details }); }}>{t('open_appeal')}</Btn>
      </Sheet>
    </Page>
  );
}

/** Design sheet 03.7 — order chat with proof upload; the arbiter's messages are highlighted. */
function OrderChat({ id }) {
  const { t } = useI18n();
  const { me, toast } = useApp();
  const [o] = useOrder(id);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  const lastId = useRef(0);
  const loadMsgs = () => api.get(`/api/p2p/orders/${id}/messages?after=${lastId.current}`, { silent: true }).then((r) => {
    if (r.items.length) { lastId.current = r.items[r.items.length - 1].id; setMsgs((x) => [...x, ...r.items]); setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 60); }
  }).catch(() => {});
  useEffect(() => {
    loadMsgs();
    const iv = setInterval(loadMsgs, 3000);
    return () => clearInterval(iv);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (file) => {
    if (!text.trim() && !file) return;
    setSending(true);
    try { await api.post(`/api/p2p/orders/${id}/messages`, { text: file ? '' : text, file }); if (!file) setText(''); haptic.tap(); loadMsgs(); } catch (e) { toast(errText(t, e), 'error'); } finally { setSending(false); }
  };
  const other = o ? (o.role === 'buyer' ? o.seller : o.buyer) : null;
  const sysText = { order_created: t('sys_order_created', { amount: o ? `${amt(o.amount)} ${o.asset}` : '' }), buyer_paid: t('sys_buyer_paid'), released: t('order_completed'),
    cancelled: t('status_cancelled'), expired: t('status_expired'), appeal_opened: t('sys_appeal_opened') };
  const arbiter = msgs.some((m) => m.sender_id === -1) || o?.status === 'appeal';
  const open = o && !DONE.includes(o.status);
  return (
    <Page title={other?.name || t('chat')} right={o?.status === 'appeal' ? <Pill tone="r">{t('appeal')}</Pill> : null}>
      {arbiter && <div className="warn g"><Icon name="shieldok" size={17} /><span>{t('arbiter_joined')}</span></div>}
      <div className="col g8" style={{ paddingBottom: 90 }}>
        {msgs.map((m) => (m.sender_id === 0
          ? <div key={m.id} className="msg sys">{sysText[m.text] || m.text} · {timeAgo(m.created_at, t)}</div>
          : m.sender_id === -1
            ? <div key={m.id} className="msg" style={{ alignSelf: 'center', background: 'rgba(61,220,151,.1)', maxWidth: '92%' }}><b className="ok" style={{ fontSize: 12.5 }}>⚖️ {t('arbiter')}</b><br />{m.text}</div>
            : <div key={m.id} className={`msg ${m.sender_id === me.id ? 'me' : 'ai'}`}>
              {m.text}
              {m.file && <a href={`/api/files/${m.file}`} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: m.text ? 8 : 0 }}>
                <img src={`/api/files/${m.file}`} alt="" style={{ maxWidth: 180, borderRadius: 12, display: 'block' }} /></a>}
            </div>))}
        {msgs.length === 0 && <Empty icon="chat" title={t('chat_empty')} sub={t('chat_empty_sub')} />}
        <div ref={endRef} />
      </div>
      {open && (
        <div className="composer"><div className="composer-in"><div className="row g8">
          <label className="ic n" style={{ width: 46, height: 46, flex: 'none', cursor: 'pointer' }} aria-label={t('attach')}>
            <Icon name="paperclip" size={20} /><input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) send(await fileToDataUrl(f)); }} />
          </label>
          <div className="search grow" style={{ height: 46 }}><input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('chat_placeholder')} onKeyDown={(e) => e.key === 'Enter' && send()} /></div>
          <button type="button" className="ic" style={{ width: 46, height: 46, flex: 'none', background: 'var(--grad)', color: 'var(--on-ember)' }} disabled={sending} onClick={() => send()} aria-label={t('send')}>
            <Icon name="send" size={19} /></button>
        </div></div></div>
      )}
    </Page>
  );
}

function MyOrders() {
  const { t } = useI18n();
  const [f, setF] = useState('active');
  const [items, setItems] = useState(null);
  useEffect(() => { setItems(null); api.get(`/api/p2p/orders?status=${f === 'active' ? 'active' : ''}`).then((r) => setItems(r.items)).catch(() => setItems([])); }, [f]);
  return (
    <Page title={t('my_orders')}>
      <Segmented value={f} onChange={setF} options={[['active', t('status_active')], ['all', t('all')]]} />
      {!items && <Skeleton h={180} r={22} />}
      {items?.length === 0 && <Empty icon="inbox" title={t('no_orders')} action={<Btn kind="f" size="sm" onClick={() => go('/p2p', true)}>{t('go_market')}</Btn>} />}
      {items?.length > 0 && (
        <div className="list">
          {items.map((o) => (
            <Li key={o.id} lead={<span className={`ic ${o.role === 'buyer' ? 'g' : 'r'}`}><Icon name={o.role === 'buyer' ? 'down' : 'up'} size={19} /></span>}
              title={<span dir="ltr">{o.role === 'buyer' ? t('buy') : t('sell')} {amt(o.amount)} {o.asset}</span>}
              sub={<span dir="ltr">{num(o.fiat_amount, 2)} {o.fiat} · {o.counterparty?.name} · {timeAgo(o.created_at, t)}</span>}
              right={<Status status={o.status} />} onClick={() => go(`/p2p/order/${o.id}`)} />
          ))}
        </div>
      )}
    </Page>
  );
}

function MyAds() {
  const { t } = useI18n();
  const { loadWallet, toast } = useApp();
  const [items, setItems] = useState(null);
  const load = () => api.get('/api/p2p/my-ads').then((r) => setItems(r.items)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  const set = async (ad, status) => {
    try { await api.patch(`/api/p2p/ads/${ad.id}`, { status }); load(); if (status === 'closed') loadWallet(); } catch (e) { toast(errText(t, e), 'error'); }
  };
  return (
    <Page title={t('my_ads')} right={<HeadBtn icon="plus" onClick={() => go('/p2p/new-ad')} label={t('post_ad')} />}>
      {!items && <Skeleton h={160} r={22} />}
      {items?.length === 0 && <Empty icon="megaphone" title={t('no_my_ads')} sub={t('no_my_ads_sub')} action={<Btn size="sm" onClick={() => go('/p2p/new-ad')}>{t('post_ad')}</Btn>} />}
      {items?.map((ad) => (
        <div key={ad.id} className="card col g8">
          <div className="row g8">
            <Pill tone={ad.side === 'sell' ? 'r' : 'g'}>{ad.side === 'sell' ? t('sell') : t('buy')}</Pill>
            <CoinIcon asset={ad.asset} size={22} /><b>{ad.asset}/{ad.fiat}</b>
            <span style={{ marginInlineStart: 'auto' }}><Switch on={ad.status === 'online'} disabled={ad.status === 'closed'} onChange={(v) => set(ad, v ? 'online' : 'offline')} /></span>
          </div>
          <div className="kv"><span>{t('price')}</span><b dir="ltr">{num(ad.price, 4)} {ad.fiat}</b></div>
          <div className="kv"><span>{t('available_amount')}</span><b dir="ltr">{amt(ad.remaining)} / {amt(ad.total)} {ad.asset}</b></div>
          <div className="prog"><i style={{ width: `${Math.min(100, (1 - Number(ad.remaining) / Number(ad.total || 1)) * 100)}%` }} /></div>
          {ad.status !== 'closed' && <Btn kind="danger" size="sm" onClick={async () => { if (await confirmPopup(t('close_ad_q'))) set(ad, 'closed'); }}>{t('close_ad')}</Btn>}
        </div>
      ))}
    </Page>
  );
}

/** Design sheet 03.8 — post an ad: fixed or floating price (free choice), limits, methods, counterparty conditions. */
function CreateAd() {
  const { t } = useI18n();
  const { me, wallet, loadWallet, toast } = useApp();
  const [fiat, setFiat] = useState(defaultFiat(me));
  const meta = useMeta(fiat);
  const [f, setF] = useState({ side: 'sell', asset: 'USDT', price_type: 'float', price: '', margin_pct: '0.5', total: '', min_fiat: '', max_fiat: '',
    methods: [], window_min: 15, terms: '', auto_reply: '', conditions: { min_kyc: 0, min_orders: 0, min_age_days: 0 } });
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const cond = (k, v) => set('conditions', { ...f.conditions, [k]: v });
  const mp = Number(meta?.market_price?.[f.asset] || 0);
  const bal = wallet?.assets?.find((a) => a.id === f.asset)?.available;
  const eff = f.price_type === 'fixed' ? Number(f.price || 0) : mp * (1 + Number(f.margin_pct || 0) / 100);
  if (meta && me.kyc_level < (meta.min_kyc_to_post || 0)) {
    return <Page title={t('post_ad')}><Empty icon="idCard" title={t('kyc_to_post')} sub={t('kyc_to_post_sub')} action={<Btn size="sm" onClick={() => go('/settings/kyc')}>{t('verify_now')}</Btn>} /></Page>;
  }
  const publish = async () => {
    setBusy(true);
    try {
      await api.post('/api/p2p/ads', { ...f, fiat });
      haptic.success();
      loadWallet();
      go('/p2p/my-ads', true);
    } catch (e) { toast(errText(t, e), 'error'); if (e.code === 'method_details_required') go(`/p2p/methods?add=${e.params.method}`); } finally { setBusy(false); }
  };
  return (
    <Page title={t('new_ad')} bar={<Btn w loading={busy} onClick={publish} disabled={!Number(f.total) || !f.methods.length || !(eff > 0)}>{t('publish_ad')}</Btn>}>
      <Segmented value={f.side} onChange={(v) => set('side', v)} options={[['sell', t('i_want_sell')], ['buy', t('i_want_buy')]]} />
      <div className="row g8">
        <button type="button" className="input grow" onClick={() => setSheet('asset')}><CoinIcon asset={f.asset} size={22} /><b style={{ color: 'var(--bone)' }}>{f.asset}</b><Icon name="dd" size={16} /></button>
        <button type="button" className="input grow" onClick={() => setSheet('fiat')}><b style={{ color: 'var(--bone)' }}>{fiat}</b><Icon name="dd" size={16} /></button>
      </div>
      <div className="card pad12">
        <div className="row between"><span className="dim" style={{ fontSize: 13 }}>{t('price')} · {f.price_type === 'fixed' ? t('fixed') : t('floating')}</span>
          {mp > 0 && <Pill tone="g">{t('market_x', { price: num(mp, 4) })}</Pill>}</div>
        <div className="row between g8" style={{ marginTop: 6 }}>
          {f.price_type === 'fixed'
            ? <input className="amt-in" style={{ fontSize: 26 }} inputMode="decimal" value={f.price} placeholder={mp ? num(mp, 4) : '0'} onChange={(e) => set('price', e.target.value.replace(/[^\d.]/g, ''))} dir="ltr" />
            : <span className="row g4" dir="ltr"><input className="amt-in" style={{ fontSize: 26, width: 110 }} inputMode="decimal" value={f.margin_pct} onChange={(e) => set('margin_pct', e.target.value.replace(/[^\d.-]/g, ''))} /><span className="mid" style={{ fontSize: 22 }}>%</span></span>}
          {eff > 0 && <span className="disp" style={{ fontSize: 18 }} dir="ltr">= {num(eff, 4)}</span>}
        </div>
        <div className="row g6" style={{ marginTop: 8 }}>
          {[['float', t('floating')], ['fixed', t('fixed')]].map(([k, l]) => <button key={k} type="button" className={`chip s2 ${f.price_type === k ? 'oe' : ''}`} onClick={() => set('price_type', k)}>{l}</button>)}
        </div>
        <span className="dim xs">{t('price_free_note')}</span>
      </div>
      <div className="row g8">
        <div className="card grow pad12"><small className="dim" style={{ fontSize: 12 }}>{t('total_amount')} · {f.asset}</small>
          <input className="amt-in" style={{ fontSize: 17 }} inputMode="decimal" value={f.total} onChange={(e) => set('total', e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" dir="ltr" />
          {f.side === 'sell' && bal && <button type="button" className="em xs b" onClick={() => set('total', String(bal))}>{t('max')} {amt(bal)}</button>}</div>
        <div className="card grow pad12"><small className="dim" style={{ fontSize: 12 }}>{t('per_order')} · {fiat}</small>
          <span className="row g4" dir="ltr"><input className="amt-in" style={{ fontSize: 17 }} inputMode="decimal" value={f.min_fiat} onChange={(e) => set('min_fiat', e.target.value.replace(/[^\d.]/g, ''))} placeholder="min" />
            <span className="dim">–</span><input className="amt-in" style={{ fontSize: 17 }} inputMode="decimal" value={f.max_fiat} onChange={(e) => set('max_fiat', e.target.value.replace(/[^\d.]/g, ''))} placeholder="max" /></span></div>
      </div>
      <div className="h2"><span>{t('payment_methods')}</span></div>
      <div className="chips" style={{ flexWrap: 'wrap' }}>
        {(meta?.methods || []).map((m) => (
          <button key={m.id} type="button" className={`chip ${f.methods.includes(m.id) ? 'oe' : ''}`}
            onClick={() => set('methods', f.methods.includes(m.id) ? f.methods.filter((x) => x !== m.id) : [...f.methods, m.id].slice(0, 5))}>{m.name}</button>))}
      </div>
      <div className="h2"><span>{t('pay_within')}</span></div>
      <div className="chips">{(meta?.windows || [15]).map((w) => <button key={w} type="button" className={`chip ${f.window_min === w ? 'oe' : ''}`} onClick={() => set('window_min', w)}>{w} {t('min_short')}</button>)}</div>
      <div className="h2"><span>{t('who_can_trade')}</span></div>
      <div className="list">
        <Li className="sm" title={t('cond_kyc')} right={<Switch on={f.conditions.min_kyc >= 1} onChange={(v) => cond('min_kyc', v ? 1 : 0)} />} />
        <Li className="sm" title={t('cond_orders_n', { n: 10 })} right={<Switch on={Number(f.conditions.min_orders) >= 10} onChange={(v) => cond('min_orders', v ? 10 : 0)} />} />
        <Li className="sm" title={t('cond_age_n', { n: 30 })} right={<Switch on={Number(f.conditions.min_age_days) >= 30} onChange={(v) => cond('min_age_days', v ? 30 : 0)} />} />
      </div>
      {meta?.allow_terms !== false && <Field label={t('seller_terms')}><textarea rows={3} value={f.terms} onChange={(e) => set('terms', e.target.value)} maxLength={800} placeholder={t('optional')} /></Field>}
      <Field label={t('auto_reply')}><textarea rows={2} value={f.auto_reply} onChange={(e) => set('auto_reply', e.target.value)} maxLength={400} placeholder={t('optional')} /></Field>
      <div className="warn g"><Icon name="lock" size={17} /><span>{t('escrow_note')}</span></div>
      <Sheet open={sheet === 'fiat'} onClose={() => setSheet('')} title={t('fiat')}>
        <div className="chips" style={{ flexWrap: 'wrap' }}>{(meta?.fiats || []).map((x) => <button key={x} type="button" className={`chip ${x === fiat ? 'oe' : ''}`} onClick={() => { setFiat(x); setSheet(''); }}>{x}</button>)}</div>
      </Sheet>
      <Sheet open={sheet === 'asset'} onClose={() => setSheet('')} title={t('choose_asset')}>
        <div className="list">{(meta?.assets || []).map((a) => <Li key={a} coin={a} title={a} onClick={() => { set('asset', a); setSheet(''); }} />)}</div>
      </Sheet>
    </Page>
  );
}

function Methods({ query }) {
  const { t } = useI18n();
  const { toast } = useApp();
  const meta = useMeta('');
  const [items, setItems] = useState([]);
  const [edit, setEdit] = useState(query.add ? { method_id: query.add, data: {}, label: '' } : null);
  const load = () => api.get('/api/p2p/methods').then((r) => setItems(r.items)).catch(() => {});
  useEffect(() => { load(); }, []);
  const def = useMemo(() => meta?.methods?.find((m) => m.id === edit?.method_id), [meta, edit]);
  const save = async () => {
    try { await api.post('/api/p2p/methods', edit); haptic.success(); setEdit(null); load(); if (query.add) history.back(); } catch (e) { toast(errText(t, e), 'error'); }
  };
  return (
    <Page title={t('my_methods')} right={<HeadBtn icon="plus" onClick={() => setEdit({ method_id: meta?.methods?.[0]?.id, data: {}, label: '' })} label={t('add_method')} />}>
      {items.length === 0 && !edit && <Empty icon="card" title={t('no_methods')} sub={t('no_methods_sub')} action={<Btn size="sm" icon="plus" onClick={() => setEdit({ method_id: meta?.methods?.[0]?.id, data: {}, label: '' })}>{t('add_method')}</Btn>} />}
      {items.length > 0 && (
        <div className="list">
          {items.map((m) => (
            <Li key={m.id} icon="card" tone="n" title={meta?.methods?.find((x) => x.id === m.method_id)?.name || m.method_id} sub={m.label || Object.values(m.data).join(' · ')}
              right={<span className="row g6"><button type="button" className="ic xs n" onClick={() => setEdit({ ...m })} aria-label={t('edit')}><Icon name="edit" size={15} /></button>
                <button type="button" className="ic xs r" onClick={async () => { await api.del(`/api/p2p/methods/${m.id}`); load(); }} aria-label={t('delete')}><Icon name="trash" size={15} /></button></span>} />
          ))}
        </div>
      )}
      <Sheet open={Boolean(edit)} onClose={() => setEdit(null)} title={t('add_method')} tall>
        {edit && (
          <>
            <Field label={t('payment_methods')}><select value={edit.method_id} onChange={(e) => setEdit({ ...edit, method_id: e.target.value, data: {} })}>
              {(meta?.methods || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            {(def?.fields || []).map((fld) => <Field key={fld} label={t(`field_${fld}`)}><input value={edit.data[fld] || ''} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, [fld]: e.target.value } })} /></Field>)}
            <Field label={t('label')}><input value={edit.label || ''} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder={t('optional')} /></Field>
            <Btn w onClick={save}>{t('save')}</Btn>
          </>
        )}
      </Sheet>
    </Page>
  );
}

function TraderProfile({ id }) {
  const { t } = useI18n();
  const [p, setP] = useState(null);
  useEffect(() => { api.get(`/api/p2p/profile/${id}`).then(setP).catch(() => setP(false)); }, [id]);
  if (p === false) return <Page title=""><Empty icon="alert" title={t('err_not_found')} /></Page>;
  if (!p) return <Page title=""><Skeleton h={200} r={22} /></Page>;
  const s = p.stats;
  return (
    <Page title={t('trader')}>
      <div className="col center g8" style={{ padding: '6px 0 4px' }}>
        <Avatar src={p.photo} name={p.name} size={76} seed={p.id} />
        <b className="disp" style={{ fontSize: 22 }}>{p.name}</b>
        <div className="row g6">{p.merchant && <Pill tone="y" icon="shieldok">{t('merchant')}</Pill>}{p.verified && <Pill tone="g" icon="check">{t('verified')}</Pill>}</div>
      </div>
      <div className="grid2">
        {[[s.orders_30d, t('orders_30d')], [s.completion_pct != null ? `${s.completion_pct}%` : '—', t('completion')],
          [releaseMin(s) ? `~${releaseMin(s)} ${t('min_short')}` : '—', t('avg_release')], [s.positive_pct != null ? `${s.positive_pct}%` : '—', `👍 ${s.positive} · 👎 ${s.negative}`]].map(([v, l]) => (
          <div key={l} className="card col g4"><b className="disp" style={{ fontSize: 22 }}>{v}</b><small className="dim" style={{ fontSize: 12.5 }}>{l}</small></div>
        ))}
      </div>
    </Page>
  );
}
