import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, fileToDataUrl, idem } from '../api';
import { useConfirm, withConfirm } from '../components/Confirm';
import Icon, { CoinIcon } from '../components/Icon';
import { celebrate } from '../components/Success';
import { useToast } from '../components/Toast';
import { Avatar, Badge, Btn, Card, CopyField, Countdown, Empty, Field, Page, Row, Segmented, Sheet, Skeleton, Status, Toggle } from '../components/ui';
import { amt, mmss, num, timeAgo } from '../format';
import { errText, useI18n } from '../i18n';
import { go, match } from '../router';
import { useApp } from '../store';
import { confirmPopup, haptic } from '../telegram';

export default function P2P({ path, query }) {
  let m;
  if ((m = match('/p2p/ad/:id', path))) return <AdView id={m.id} />;
  if ((m = match('/p2p/order/:id', path))) return <OrderRoom id={m.id} />;
  if ((m = match('/p2p/profile/:id', path))) return <TraderProfile id={m.id} />;
  if (path === '/p2p/orders') return <MyOrders />;
  if (path === '/p2p/my-ads') return <MyAds />;
  if (path === '/p2p/new-ad') return <CreateAd />;
  if (path === '/p2p/methods') return <Methods query={query} />;
  return <Market />;
}

function useMeta(fiat) {
  const [meta, setMeta] = useState(null);
  useEffect(() => { api.get(`/api/p2p/meta?fiat=${fiat || ''}`).then(setMeta).catch(() => {}); }, [fiat]);
  return meta;
}

function defaultFiat(me) {
  const c = me?.settings?.currency;
  return c && c !== 'USD' ? c : (localStorage.getItem('aw_p2p_fiat') || 'USD');
}

function Market() {
  const { t } = useI18n();
  const { me } = useApp();
  const [side, setSide] = useState('buy');
  const [asset, setAsset] = useState('USDT');
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
  return (
    <main className="page p2p">
      <header className="p2p-top">
        <h1 className="page-title">{t('p2p_title')}</h1>
        <div className="top-icons">
          <button type="button" className="icon-btn" onClick={() => go('/p2p/orders')}><Icon name="receipt" /></button>
          <button type="button" className="icon-btn" onClick={() => go('/p2p/my-ads')}><Icon name="megaphone" /></button>
          <button type="button" className="icon-btn" onClick={() => go('/p2p/methods')}><Icon name="card" /></button>
        </div>
      </header>
      <Segmented value={side} onChange={setSide} options={[['buy', t('buy')], ['sell', t('sell')]]} />
      <div className="chips scroll">
        {(meta?.assets || ['USDT']).map((a) => <button key={a} type="button" className={`chip ${asset === a ? 'on' : ''}`} onClick={() => setAsset(a)}><CoinIcon asset={a} size={18} />{a}</button>)}
      </div>
      <div className="filter-row">
        <button type="button" className="filter-btn" onClick={() => setSheet('fiat')}>{fiat}<Icon name="chevronDown" size={14} /></button>
        <button type="button" className="filter-btn" onClick={() => setSheet('method')}>{method ? methodName(method) : t('all_methods')}<Icon name="chevronDown" size={14} /></button>
        <input className="filter-amount" inputMode="decimal" placeholder={`${t('amount')} ${fiat}`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
      </div>
      {mp && Number(mp) > 0 && <p className="dim small">{t('market_price', { price: `${num(mp, 4)} ${fiat}` })}</p>}
      {!items && [0, 1, 2].map((i) => <Skeleton key={i} h={130} r={18} style={{ marginBottom: 10 }} />)}
      {items?.length === 0 && <Empty icon="handshake" title={t('no_ads')} action={<Btn kind="soft" onClick={() => go('/p2p/new-ad')}>{t('post_ad')}</Btn>} />}
      {items?.map((ad) => (
        <Card key={ad.id} className="ad-card">
          <button type="button" className="ad-maker" onClick={() => go(`/p2p/profile/${ad.maker.id}`)}>
            <Avatar src={ad.maker.photo} name={ad.maker.name} size={30} />
            <b>{ad.maker.name}</b>
            {ad.maker.merchant && <Badge tone="ember" icon="crown">{t('merchant')}</Badge>}
            {ad.maker.verified && <Icon name="shield" size={14} className="ok-ic" />}
          </button>
          <div className="ad-stats dim small">{t('orders_n', { n: ad.maker.stats.orders_30d })}{ad.maker.stats.completion_pct != null && ` · ${t('completion_pct', { pct: ad.maker.stats.completion_pct })}`}</div>
          <div className="ad-body">
            <div><div className="ad-price" dir="ltr">{num(ad.price, 4)} <small>{fiat}</small></div>
              <div className="small dim">{t('limits')}: <span dir="ltr">{num(ad.min_fiat, 2)} – {num(ad.max_fiat, 2)} {fiat}</span></div>
              <div className="small dim">{t('available_amount')}: <span dir="ltr">{amt(ad.remaining)} {asset}</span></div></div>
            <Btn className={side === 'buy' ? '' : 'sell'} onClick={() => go(`/p2p/ad/${ad.id}`)}>{side === 'buy' ? t('buy') : t('sell')}</Btn>
          </div>
          <div className="chips">{ad.methods.map((m) => <span key={m} className="chip small">{methodName(m)}</span>)}<span className="chip small dim"><Icon name="clock" size={12} />{t('payment_window', { min: ad.window_min })}</span></div>
        </Card>
      ))}
      <Btn kind="soft" className="wide" onClick={() => go('/p2p/new-ad')}><Icon name="plus" size={18} />{t('post_ad')}</Btn>
      <Sheet open={sheet === 'fiat'} onClose={() => setSheet('')} title={t('fiat')}>
        <div className="grid-chips">{(meta?.fiats || []).map((f) => <button key={f} type="button" className={`chip ${f === fiat ? 'on' : ''}`} onClick={() => { setFiat(f); localStorage.setItem('aw_p2p_fiat', f); setSheet(''); }}>{f}</button>)}</div>
      </Sheet>
      <Sheet open={sheet === 'method'} onClose={() => setSheet('')} title={t('payment_methods')}>
        <div className="list">
          <button type="button" className="net-row" onClick={() => { setMethod(''); setSheet(''); }}><b>{t('all_methods')}</b></button>
          {(meta?.methods || []).map((m) => <button key={m.id} type="button" className="net-row" onClick={() => { setMethod(m.id); setSheet(''); }}><span className="pm-dot" style={{ background: m.color }} /><b>{m.name}</b></button>)}
        </div>
      </Sheet>
    </main>
  );
}

function AdView({ id }) {
  const { t } = useI18n();
  const toast = useToast();
  const [ad, setAd] = useState(null);
  const [fiatAmt, setFiatAmt] = useState('');
  const [method, setMethod] = useState('');
  const [umId, setUmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(idem());
  const meta = useMeta(ad?.fiat);
  useEffect(() => { api.get(`/api/p2p/ads/${id}`).then((a) => { setAd(a); if (a.methods.length === 1) setMethod(a.methods[0]); }).catch((e) => toast(errText(t, e), 'error')); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ad) return <Page title={t('order')}><Skeleton h={300} /></Page>;
  const iBuy = ad.side === 'sell';
  const cryptoAmt = Number(fiatAmt || 0) / Number(ad.price);
  const myMethods = (meta?.my_methods || []).filter((m) => m.method_id === method);
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
  return (
    <Page title={iBuy ? t('buy_asset', { asset: ad.asset }) : t('sell_asset', { asset: ad.asset })}>
      <Card className="ad-card flat">
        <button type="button" className="ad-maker" onClick={() => go(`/p2p/profile/${ad.maker.id}`)}><Avatar src={ad.maker.photo} name={ad.maker.name} size={34} /><b>{ad.maker.name}</b>{ad.maker.merchant && <Badge icon="crown">{t('merchant')}</Badge>}</button>
        <Row label={t('price')} value={`${num(ad.price, 4)} ${ad.fiat}`} strong />
        <Row label={t('limits')} value={`${num(ad.min_fiat, 2)} – ${num(ad.max_fiat, 2)} ${ad.fiat}`} />
        <Row label={t('available_amount')} value={`${amt(ad.remaining)} ${ad.asset}`} />
        <Row label={t('time_left')} value={t('payment_window', { min: ad.window_min })} />
      </Card>
      <Field label={iBuy ? t('i_will_pay') : t('i_will_receive')}>
        <div className="input-row"><input inputMode="decimal" value={fiatAmt} onChange={(e) => setFiatAmt(e.target.value.replace(/[^\d.]/g, ''))} placeholder={`${ad.min_fiat} – ${ad.max_fiat}`} dir="ltr" />
          <span className="suffix">{ad.fiat}</span><button type="button" className="link-btn" onClick={() => setFiatAmt(ad.max_fiat)}>{t('max')}</button></div>
      </Field>
      <p className="hint">{iBuy ? t('i_will_receive') : t('you_send')}: <b dir="ltr">{amt(cryptoAmt || 0)} {ad.asset}</b></p>
      <h2 className="h2">{t('payment_methods')}</h2>
      <div className="chips">{ad.methods.map((m) => <button key={m} type="button" className={`chip ${method === m ? 'on' : ''}`} onClick={() => setMethod(m)}>{methodName(m)}</button>)}</div>
      {!iBuy && method && (myMethods.length ? (
        <div className="chips">{myMethods.map((m) => <button key={m.id} type="button" className={`chip ${umId === m.id ? 'on' : ''}`} onClick={() => setUmId(m.id)}>{m.label || Object.values(m.data)[0]}</button>)}</div>
      ) : <Btn kind="soft" onClick={() => go(`/p2p/methods?add=${method}`)}><Icon name="plus" size={16} />{t('add_method')}</Btn>)}
      {ad.terms && <Card className="terms"><b>{t('seller_terms')}</b><p>{ad.terms}</p></Card>}
      <p className="hint"><Icon name="shield" size={14} /> {t('escrow_note')}</p>
      <Btn className="wide" loading={busy} disabled={!Number(fiatAmt) || !method} onClick={place}>{t('place_order')}</Btn>
    </Page>
  );
}

const REASONS = ['not_received', 'not_released', 'wrong_amount', 'other'];

function OrderRoom({ id }) {
  const { t } = useI18n();
  const { me, loadWallet } = useApp();
  const ask = useConfirm();
  const toast = useToast();
  const [o, setO] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [appealOpen, setAppealOpen] = useState(false);
  const [reason, setReason] = useState('not_received');
  const [details, setDetails] = useState('');
  const endRef = useRef(null);
  const lastId = useRef(0);
  const load = () => api.get(`/api/p2p/orders/${id}`).then(setO).catch(() => {});
  const loadMsgs = () => api.get(`/api/p2p/orders/${id}/messages?after=${lastId.current}`).then((r) => {
    if (r.items.length) { lastId.current = r.items[r.items.length - 1].id; setMsgs((x) => [...x, ...r.items]); setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50); }
  }).catch(() => {});
  useEffect(() => {
    load(); loadMsgs();
    const iv = setInterval(() => { load(); loadMsgs(); }, 5000);
    return () => clearInterval(iv);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (action, body = {}, needPin = false) => {
    setBusy(action);
    try {
      const call = (f = {}) => api.post(`/api/p2p/orders/${id}/${action}`, { ...body, ...f });
      const r = needPin ? await withConfirm(ask, t, call, { title: t('release'), summary: t('confirm_release_q') }) : await call();
      if (r) { setO(r); haptic.success(); if (action === 'release') { celebrate(); loadWallet(); } }
    } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(''); }
  };
  const send = async (file) => {
    if (!text.trim() && !file) return;
    try { await api.post(`/api/p2p/orders/${id}/messages`, { text, file }); setText(''); loadMsgs(); } catch (e) { toast(errText(t, e), 'error'); }
  };
  if (!o) return <Page title={t('order')}><Skeleton h={300} /></Page>;
  const buyer = o.role === 'buyer';
  const other = buyer ? o.seller : o.buyer;
  const sysText = { order_created: t('order'), buyer_paid: t('status_paid'), released: t('order_completed'), cancelled: t('status_cancelled'),
    expired: t('status_expired'), appeal_opened: t('status_appeal') };
  return (
    <Page title={`${buyer ? t('you_are_buyer') : t('you_are_seller')} ${o.asset}`} className="order-room">
      <section className={`order-head st-${o.status}`}>
        <Status status={o.status} />
        {o.status === 'pending' && <Countdown until={o.expires_at} onEnd={load} render={(l) => <b className="timer" dir="ltr">{mmss(l)}</b>} />}
        <div className="oh-amt" dir="ltr"><b>{num(o.fiat_amount, 2)} {o.fiat}</b><span>{amt(o.amount)} {o.asset} @ {num(o.price, 4)}</span></div>
        <small className="dim">#{o.id}</small>
      </section>
      <Card className="person-card" onClick={() => go(`/p2p/profile/${other.id}`)}><Avatar src={other.photo} name={other.name} size={36} /><span className="nudge-text"><b>{other.name}</b><small>{other.verified ? t('kyc_level_1') : ''}</small></span></Card>
      {(buyer || o.role === 'seller') && o.payment?.data && (
        <Card className="pay-card">
          <b>{buyer ? t('pay_seller', { amount: num(o.fiat_amount, 2), fiat: o.fiat }) : t('payment_details')}</b>
          <div className="pm-name">{o.payment.method}</div>
          {Object.entries(o.payment.data).map(([k, v]) => <CopyField key={k} label={t(`field_${k}`)} value={String(v)} />)}
        </Card>
      )}
      {o.terms && <Card className="terms"><b>{t('seller_terms')}</b><p>{o.terms}</p></Card>}
      <p className="hint"><Icon name="shield" size={14} /> {buyer ? t('escrow_note') : t('safety_tip')}</p>
      <div className="order-actions">
        {buyer && o.status === 'pending' && <Btn className="wide" loading={busy === 'paid'} onClick={async () => { if (await confirmPopup(t('confirm_paid_q'))) act('paid'); }}>{t('i_have_paid')}</Btn>}
        {!buyer && ['paid', 'appeal'].includes(o.status) && <Btn className="wide" loading={busy === 'release'} onClick={() => act('release', {}, true)}>{t('release')}</Btn>}
        {buyer && o.status === 'pending' && <Btn kind="ghost" className="wide" loading={busy === 'cancel'} onClick={async () => { if (await confirmPopup(t('cancel_order'))) act('cancel'); }}>{t('cancel_order')}</Btn>}
        {o.status === 'paid' && (Date.now() / 1000 >= o.appeal_after
          ? <Btn kind="ghost" className="wide" onClick={() => setAppealOpen(true)}><Icon name="flag" size={16} />{t('appeal')}</Btn>
          : <p className="dim small center">{t('appeal_wait', { min: Math.ceil((o.appeal_after - Date.now() / 1000) / 60) })}</p>)}
      </div>
      {o.dispute && <Card className="warn-card"><Icon name="flag" /><span>{t(`reason_${o.dispute.reason}`) || o.dispute.reason}{o.dispute.resolution ? ` — ${o.dispute.resolution}` : ''}</span></Card>}
      {o.status === 'completed' && !o.reviewed && (
        <Card className="review"><b>{t('leave_review')}</b><div className="row2">
          <Btn kind="soft" onClick={() => act('review', { positive: true })}>👍 {t('positive')}</Btn>
          <Btn kind="ghost" onClick={() => act('review', { positive: false })}>👎 {t('negative')}</Btn></div></Card>
      )}
      <section className="chat">
        {msgs.map((m) => (m.sender_id === 0
          ? <div key={m.id} className="msg sys">{sysText[m.text] || m.text}</div>
          : <div key={m.id} className={`msg ${m.sender_id === me.id ? 'me' : m.sender_id === -1 ? 'arb' : ''}`}>
            {m.sender_id === -1 && <b>⚖️ </b>}{m.text}{m.file && <a href={`/api/files/${m.file}`} target="_blank" rel="noreferrer"><img src={`/api/files/${m.file}`} alt="" /></a>}
            <small>{timeAgo(m.created_at, t)}</small></div>))}
        <div ref={endRef} />
      </section>
      {!['completed', 'cancelled', 'expired'].includes(o.status) && (
        <div className="chat-input">
          <label className="icon-btn"><Icon name="attach" /><input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) send(await fileToDataUrl(f)); }} /></label>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('chat_placeholder')} onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button type="button" className="icon-btn ember" onClick={() => send()}><Icon name="send" /></button>
        </div>
      )}
      <Sheet open={appealOpen} onClose={() => setAppealOpen(false)} title={t('appeal')}>
        <div className="list">{REASONS.map((r) => <label key={r} className="radio-row"><input type="radio" checked={reason === r} onChange={() => setReason(r)} />{t(`reason_${r}`)}</label>)}</div>
        <Field label={t('appeal_details')}><textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
        <Btn className="wide" loading={busy === 'appeal'} onClick={() => { setAppealOpen(false); act('appeal', { reason, details }); }}>{t('submit')}</Btn>
      </Sheet>
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
      {items?.length === 0 && <Empty icon="receipt" title={t('no_orders')} />}
      {items?.map((o) => (
        <Card key={o.id} className="order-item" onClick={() => go(`/p2p/order/${o.id}`)}>
          <div className="gi-top"><span className={`side ${o.role}`}>{o.role === 'buyer' ? t('buy') : t('sell')}</span><b dir="ltr">{amt(o.amount)} {o.asset}</b><Status status={o.status} /></div>
          <small className="dim" dir="ltr">{num(o.fiat_amount, 2)} {o.fiat} · {o.counterparty?.name} · {timeAgo(o.created_at, t)}</small>
        </Card>
      ))}
    </Page>
  );
}

function MyAds() {
  const { t } = useI18n();
  const toast = useToast();
  const { loadWallet } = useApp();
  const [items, setItems] = useState(null);
  const load = () => api.get('/api/p2p/my-ads').then((r) => setItems(r.items)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  const set = async (ad, status) => {
    try { await api.patch(`/api/p2p/ads/${ad.id}`, { status }); load(); if (status === 'closed') loadWallet(); } catch (e) { toast(errText(t, e), 'error'); }
  };
  return (
    <Page title={t('my_ads')} right={<button type="button" className="icon-btn" onClick={() => go('/p2p/new-ad')}><Icon name="plus" /></button>}>
      {items?.length === 0 && <Empty icon="megaphone" title={t('no_ads')} action={<Btn onClick={() => go('/p2p/new-ad')}>{t('post_ad')}</Btn>} />}
      {items?.map((ad) => (
        <Card key={ad.id} className="ad-card">
          <div className="gi-top"><span className={`side ${ad.side === 'sell' ? 'seller' : 'buyer'}`}>{ad.side === 'sell' ? t('sell') : t('buy')}</span><b>{ad.asset}/{ad.fiat}</b><Status status={ad.status} /></div>
          <Row label={t('price')} value={`${num(ad.price, 4)} ${ad.fiat}`} />
          <Row label={t('available_amount')} value={`${amt(ad.remaining)} / ${amt(ad.total)} ${ad.asset}`} />
          <div className="row2">
            {ad.status === 'online' && <Btn kind="soft" onClick={() => set(ad, 'offline')}>{t('go_offline')}</Btn>}
            {ad.status === 'offline' && <Btn kind="soft" onClick={() => set(ad, 'online')}>{t('go_online')}</Btn>}
            <Btn kind="ghost" onClick={async () => { if (await confirmPopup(t('close_ad'))) set(ad, 'closed'); }}>{t('close_ad')}</Btn>
          </div>
        </Card>
      ))}
    </Page>
  );
}

function CreateAd() {
  const { t } = useI18n();
  const { me, wallet, loadWallet } = useApp();
  const toast = useToast();
  const [fiat, setFiat] = useState(defaultFiat(me));
  const meta = useMeta(fiat);
  const [f, setF] = useState({ side: 'sell', asset: 'USDT', price_type: 'fixed', price: '', margin_pct: '0', total: '', min_fiat: '', max_fiat: '',
    methods: [], window_min: 15, terms: '', auto_reply: '', conditions: { min_kyc: 0, min_orders: 0, min_age_days: 0 } });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const mp = Number(meta?.market_price?.[f.asset] || 0);
  const bal = wallet?.assets?.find((a) => a.id === f.asset)?.available;
  if (meta && me.kyc_level < (meta.min_kyc_to_post || 0)) {
    return <Page title={t('post_ad')}><Empty icon="shield" title={t('kyc_to_post')} action={<Btn onClick={() => go('/settings/security')}>{t('verify_phone')}</Btn>} /></Page>;
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
    <Page title={t('post_ad')}>
      <Field label={t('ad_i_want')}><Segmented value={f.side} onChange={(v) => set('side', v)} options={[['sell', t('sell')], ['buy', t('buy')]]} /></Field>
      <div className="row2">
        <Field label="Coin"><select value={f.asset} onChange={(e) => set('asset', e.target.value)}>{(meta?.assets || []).map((a) => <option key={a}>{a}</option>)}</select></Field>
        <Field label={t('fiat')}><select value={fiat} onChange={(e) => setFiat(e.target.value)}>{(meta?.fiats || []).map((x) => <option key={x}>{x}</option>)}</select></Field>
      </div>
      {mp > 0 && <p className="dim small">{t('market_price', { price: `${num(mp, 4)} ${fiat}` })}</p>}
      <Field label={t('price_type')}><Segmented value={f.price_type} onChange={(v) => set('price_type', v)} options={[['fixed', t('fixed')], ['float', t('floating')]]} /></Field>
      {f.price_type === 'fixed'
        ? <Field label={`${t('price')} (${fiat})`}><input inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} placeholder={mp ? num(mp, 4) : ''} /></Field>
        : <Field label={t('margin_vs_market')} hint={mp ? `≈ ${num(mp * (1 + Number(f.margin_pct || 0) / 100), 4)} ${fiat}` : ''}><input inputMode="decimal" value={f.margin_pct} onChange={(e) => set('margin_pct', e.target.value)} /></Field>}
      <Field label={`${t('total_amount')} (${f.asset})`} hint={f.side === 'sell' && bal ? `${t('available')}: ${amt(bal)}` : ''}><input inputMode="decimal" value={f.total} onChange={(e) => set('total', e.target.value)} /></Field>
      <div className="row2">
        <Field label={`${t('min_limit')} (${fiat})`}><input inputMode="decimal" value={f.min_fiat} onChange={(e) => set('min_fiat', e.target.value)} /></Field>
        <Field label={`${t('max_limit')} (${fiat})`}><input inputMode="decimal" value={f.max_fiat} onChange={(e) => set('max_fiat', e.target.value)} /></Field>
      </div>
      <Field label={t('payment_methods')}>
        <div className="chips">{(meta?.methods || []).map((m) => (
          <button key={m.id} type="button" className={`chip ${f.methods.includes(m.id) ? 'on' : ''}`}
            onClick={() => set('methods', f.methods.includes(m.id) ? f.methods.filter((x) => x !== m.id) : [...f.methods, m.id].slice(0, 5))}>{m.name}</button>))}</div>
      </Field>
      <Field label={t('payment_window', { min: '' })}><div className="chips">{(meta?.windows || [15]).map((w) => <button key={w} type="button" className={`chip ${f.window_min === w ? 'on' : ''}`} onClick={() => set('window_min', w)}>{w} min</button>)}</div></Field>
      {meta?.allow_terms !== false && <Field label={t('seller_terms')}><textarea rows={3} value={f.terms} onChange={(e) => set('terms', e.target.value)} maxLength={800} /></Field>}
      <Field label={t('auto_reply')}><textarea rows={2} value={f.auto_reply} onChange={(e) => set('auto_reply', e.target.value)} maxLength={400} /></Field>
      <h2 className="h2">{t('counterparty_conditions')}</h2>
      <Toggle label={t('cond_kyc')} checked={f.conditions.min_kyc >= 1} onChange={(v) => set('conditions', { ...f.conditions, min_kyc: v ? 1 : 0 })} />
      <div className="row2">
        <Field label={t('cond_orders')}><input type="number" min="0" value={f.conditions.min_orders} onChange={(e) => set('conditions', { ...f.conditions, min_orders: e.target.value })} /></Field>
        <Field label={t('cond_age')}><input type="number" min="0" value={f.conditions.min_age_days} onChange={(e) => set('conditions', { ...f.conditions, min_age_days: e.target.value })} /></Field>
      </div>
      <p className="hint"><Icon name="lock" size={14} /> {t('escrow_note')}</p>
      <Btn className="wide" loading={busy} onClick={publish} disabled={!Number(f.total) || !f.methods.length}>{t('publish_ad')}</Btn>
    </Page>
  );
}

function Methods({ query }) {
  const { t } = useI18n();
  const toast = useToast();
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
    <Page title={t('my_methods')} right={<button type="button" className="icon-btn" onClick={() => setEdit({ method_id: meta?.methods?.[0]?.id, data: {}, label: '' })}><Icon name="plus" /></button>}>
      {items.length === 0 && !edit && <Empty icon="card" title={t('add_method')} />}
      {items.map((m) => (
        <Card key={m.id} className="pm-item">
          <b>{meta?.methods?.find((x) => x.id === m.method_id)?.name || m.method_id}</b>
          <small className="dim">{m.label || Object.values(m.data).join(' · ')}</small>
          <div className="row2"><Btn kind="soft" onClick={() => setEdit({ ...m })}><Icon name="edit" size={16} /></Btn>
            <Btn kind="ghost" onClick={async () => { await api.del(`/api/p2p/methods/${m.id}`); load(); }}><Icon name="trash" size={16} /></Btn></div>
        </Card>
      ))}
      <Sheet open={Boolean(edit)} onClose={() => setEdit(null)} title={t('add_method')} tall>
        {edit && (
          <>
            <Field label={t('payment_methods')}><select value={edit.method_id} onChange={(e) => setEdit({ ...edit, method_id: e.target.value, data: {} })}>
              {(meta?.methods || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            {(def?.fields || []).map((fld) => <Field key={fld} label={t(`field_${fld}`)}><input value={edit.data[fld] || ''} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, [fld]: e.target.value } })} /></Field>)}
            <Field label={t('label')}><input value={edit.label || ''} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder={t('optional')} /></Field>
            <Btn className="wide" onClick={save}>{t('save')}</Btn>
          </>
        )}
      </Sheet>
    </Page>
  );
}

function TraderProfile({ id }) {
  const { t } = useI18n();
  const [p, setP] = useState(null);
  useEffect(() => { api.get(`/api/p2p/profile/${id}`).then(setP).catch(() => {}); }, [id]);
  if (!p) return <Page title=""><Skeleton h={200} /></Page>;
  const s = p.stats;
  return (
    <Page title={p.name}>
      <div className="center-block"><Avatar src={p.photo} name={p.name} size={72} /><h2>{p.name}</h2>
        <div className="chips center">{p.merchant && <Badge icon="crown">{t('merchant')}</Badge>}{p.verified && <Badge tone="ok" icon="shield">{t('kyc_level_1')}</Badge>}</div></div>
      <div className="stat-grid">
        <div><b>{s.orders_30d}</b><small>{t('orders_n', { n: '' }).trim()} (30d)</small></div>
        <div><b>{s.completion_pct ?? '—'}%</b><small>{t('completion_pct', { pct: '' }).replace('%', '').trim()}</small></div>
        <div><b>{s.avg_release_sec ? `${Math.max(1, Math.round(s.avg_release_sec / 60))}m` : '—'}</b><small>{t('release')}</small></div>
        <div><b>{s.positive_pct ?? '—'}%</b><small>👍 {s.positive} · 👎 {s.negative}</small></div>
      </div>
    </Page>
  );
}
