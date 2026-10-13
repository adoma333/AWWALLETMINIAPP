import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, idem } from '../api';
import { useConfirm, withConfirm } from '../components/Confirm';
import Icon, { CoinIcon } from '../components/Icon';
import Success from '../components/Success';
import { useToast } from '../components/Toast';
import { AmountInput, AssetPicker, Avatar, Btn, Card, Field, Page, Row } from '../components/ui';
import { amt } from '../format';
import { errText, useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic, openTelegramLink } from '../telegram';

export default function Send({ path, query }) {
  if (path === '/send/user') return <Transfer query={query} />;
  if (path === '/send/contact' || query.pick) return <ContactPick query={query} />;
  return <SendHub />;
}

function SendHub() {
  const { t } = useI18n();
  const { config } = useApp();
  const f = config?.features || {};
  const [recent, setRecent] = useState([]);
  useEffect(() => { api.get('/api/contacts/recent').then((r) => setRecent(r.items)).catch(() => {}); }, []);
  const opts = [
    { icon: 'user', title: t('send_to_user'), sub: t('send_to_user_sub'), to: '/send/user', on: f.transfer !== false, hot: true },
    { icon: 'contacts', title: t('send_to_contact'), sub: t('send_to_contact_sub'), to: '/send/contact', on: f.transfer !== false || f.gifts !== false },
    { icon: 'arrowUp', title: t('send_external'), sub: t('send_external_sub'), to: '/withdraw', on: f.withdraw !== false },
    { icon: 'gift', title: t('send_gift'), sub: t('send_gift_sub'), to: '/gift/new', on: f.gifts !== false },
  ];
  return (
    <Page title={t('send_title')}>
      {recent.length > 0 && (
        <>
          <h2 className="h2">{t('recent_contacts')}</h2>
          <div className="people">
            {recent.map((u) => (
              <button key={u.id} type="button" className="person" onClick={() => go(`/send/user?to_id=${u.id}`)}>
                <Avatar src={u.photo} name={u.name} size={48} /><span>{u.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="option-list">
        {opts.filter((o) => o.on).map((o) => (
          <Card key={o.to} className="option" onClick={() => go(o.to)}>
            <span className="opt-ic"><Icon name={o.icon} /></span>
            <span className="nudge-text"><b>{o.title}{o.hot && <span className="mini-badge ok">{t('free')}</span>}</b><small>{o.sub}</small></span>
            <Icon name="chevron" size={18} className="flip-rtl" />
          </Card>
        ))}
      </div>
    </Page>
  );
}

function Transfer({ query }) {
  const { t } = useI18n();
  const { wallet, loadWallet } = useApp();
  const ask = useConfirm();
  const toast = useToast();
  const [to, setTo] = useState(query.to || '');
  const [rcpt, setRcpt] = useState(null);
  const [looking, setLooking] = useState(false);
  const [asset, setAsset] = useState(query.asset || 'USDT');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [pick, setPick] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const key = useRef(idem());
  const a = wallet?.assets?.find((x) => x.id === asset);

  useEffect(() => {
    if (query.to_id) api.get(`/api/users/lookup?q=${query.to_id}`).then((r) => setRcpt(r.user)).catch(() => {});
  }, [query.to_id]);
  useEffect(() => {
    if (query.to_id || to.trim().length < 3) { if (!query.to_id) setRcpt(null); return undefined; }
    setLooking(true);
    const id = setTimeout(() => api.get(`/api/users/lookup?q=${encodeURIComponent(to.trim())}`).then((r) => setRcpt(r.user))
      .catch(() => setRcpt(null)).finally(() => setLooking(false)), 350);
    return () => clearTimeout(id);
  }, [to, query.to_id]);

  const review = async () => {
    setBusy(true);
    try {
      setPreview(await api.post('/api/transfer/preview', { to_id: rcpt.id, asset, amount }));
    } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true);
    try {
      const r = await withConfirm(ask, t, (f) => api.post('/api/transfer', { to_id: rcpt.id, asset, amount, note, idem: key.current, ...f }),
        { title: `${amt(amount)} ${asset} → ${rcpt.name}` });
      if (r) { setDone(r); loadWallet(); }
    } catch (e) { toast(errText(t, e), 'error'); haptic.error(); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Page title="">
        <Success title={t('sent_success', { name: rcpt.name })} sub={`${amt(done.amount)} ${done.asset} · ${t('instant_free')}`}>
          <Btn className="wide" onClick={() => go('/', true)}>{t('done')}</Btn>
          <Btn kind="soft" className="wide" onClick={() => go(`/tx/${done.id}`)}>{t('details')}</Btn>
        </Success>
      </Page>
    );
  }
  return (
    <Page title={t('send_to_user')}>
      {!query.to_id && (
        <Field label={t('username_or_id')}>
          <div className="input-row"><span className="prefix">@</span><input value={to} onChange={(e) => setTo(e.target.value.replace(/^@/, ''))} placeholder="username" autoFocus dir="ltr" /></div>
        </Field>
      )}
      {looking && <p className="dim small">{t('loading')}</p>}
      {rcpt && (
        <Card className="person-card"><Avatar src={rcpt.photo} name={rcpt.name} size={44} /><span className="nudge-text"><b>{rcpt.name} {rcpt.verified && <Icon name="shield" size={14} />}</b><small>{rcpt.username ? `@${rcpt.username}` : t('user_found')}</small></span><span className="mini-badge ok">{t('instant_free')}</span></Card>
      )}
      {!rcpt && !looking && to.length >= 3 && !query.to_id && (
        <Card className="warn-card"><Icon name="info" /><span>{t('err_recipient_not_found')}</span>
          <button type="button" className="link-btn" onClick={() => go(`/gift/new?lock=username&username=${encodeURIComponent(to)}`)}>{t('send_as_gift')}</button></Card>
      )}
      {rcpt && (
        <>
          <button type="button" className="asset-select" onClick={() => setPick(true)}><CoinIcon asset={asset} size={28} /><b>{asset}</b><Icon name="chevronDown" size={18} /></button>
          <AmountInput value={amount} onChange={(v) => { setAmount(v); setPreview(null); }} asset={asset} max={a?.available} usdPrice={a?.usd} display={a?.display} />
          <Field label={t('add_note')}><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder={t('optional')} /></Field>
          {preview && (
            <div className="kv-box">
              <Row label={t('to_label')} value={preview.recipient.name} />
              <Row label={t('amount')} value={`${amt(preview.amount)} ${asset}`} strong />
              <Row label={t('fee')} value={Number(preview.fee) ? `${amt(preview.fee)} ${asset}` : t('free')} />
            </div>
          )}
          <Btn className="wide" loading={busy} disabled={!Number(amount) || Number(amount) > Number(a?.available || 0)}
            onClick={preview ? send : review}>{preview ? t('send_now') : t('review')}</Btn>
        </>
      )}
      <AssetPicker open={pick} onClose={() => setPick(false)} assets={wallet?.assets?.filter((x) => x.transfer)} onPick={(x) => { setAsset(x.id); setPreview(null); }} />
    </Page>
  );
}

function ContactPick({ query }) {
  const { t } = useI18n();
  const { config } = useApp();
  const toast = useToast();
  const [token, setToken] = useState(query.pick || null);
  const [res, setRes] = useState(null);
  const purpose = query.purpose || 'send';
  useEffect(() => {
    if (!token) return undefined;
    let stop = false;
    const poll = async () => {
      try {
        const r = await api.get(`/api/contacts/pick/${token}`);
        if (r.done) { setRes(r); haptic.success(); return; }
      } catch { /* keep polling */ }
      if (!stop) setTimeout(poll, 2000);
    };
    poll();
    return () => { stop = true; };
  }, [token]);
  const start = async () => {
    try {
      const r = await api.post('/api/contacts/pick', { purpose });
      setToken(r.token);
      openTelegramLink(`https://t.me/${r.bot || config?.bot}`);
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  const target = useMemo(() => {
    if (!res) return null;
    if (res.registered && purpose !== 'gift') return `/send/user?to_id=${res.id}`;
    return `/gift/new?lock=user&to_id=${res.id}&name=${encodeURIComponent(res.name || '')}`;
  }, [res, purpose]);
  return (
    <Page title={t('pick_contact_title')}>
      {!res && (
        <div className="center-block">
          <span className="big-ic"><Icon name="contacts" size={46} /></span>
          <p>{t('pick_contact_sub')}</p>
          <Btn className="wide" onClick={start}><Icon name="telegram" size={18} />{t('open_picker')}</Btn>
          {token && <p className="dim small pulse">{t('waiting_pick')}</p>}
        </div>
      )}
      {res && (
        <div className="center-block">
          <Avatar name={res.name} size={64} />
          <h2>{res.name}</h2>
          <p>{res.registered && purpose !== 'gift' ? t('picked_registered', { name: res.name }) : t('picked_not_registered', { name: res.name })}</p>
          <Btn className="wide" onClick={() => go(target, true)}>{t('continue')}</Btn>
        </div>
      )}
    </Page>
  );
}
