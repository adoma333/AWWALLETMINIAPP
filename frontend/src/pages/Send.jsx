import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, idem } from '../api';
import { useConfirm, withConfirm } from '../components/Confirm';
import Icon, { CoinIcon } from '../components/Icon';
import Success from '../components/Success';
import { AmountView, AssetPicker, Avatar, Btn, Empty, Input, Keypad, Li, Page, Pill, SearchBox, useAmountKeys } from '../components/ui';
import { amt, fiat } from '../format';
import { errText, useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic, openTelegramLink, scanQr } from '../telegram';
import { detectFamily, parseScan } from '../util';

export default function Send({ path, query }) {
  if (path === '/send/user') return <Transfer query={query} />;
  if (path === '/send/contact' || query.pick) return <ContactPick query={query} />;
  return <SendHub query={query} />;
}

/** Design sheet 02.4 — choose who: search (@username or any address), recents, Telegram contacts, other ways to pay. */
function SendHub({ query }) {
  const { t } = useI18n();
  const { config } = useApp();
  const f = config?.features || {};
  const [recent, setRecent] = useState(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState(undefined);
  useEffect(() => { api.get('/api/contacts/recent').then((r) => setRecent(r.items)).catch(() => setRecent([])); }, []);
  const fam = detectFamily(q.trim());
  useEffect(() => {
    const s = q.trim().replace(/^@/, '');
    if (fam || s.length < 3) { setFound(undefined); return undefined; }
    const id = setTimeout(() => api.get(`/api/users/lookup?q=${encodeURIComponent(s)}`, { silent: true })
      .then((r) => setFound(r.user)).catch(() => setFound(null)), 300);
    return () => clearTimeout(id);
  }, [q, fam]);
  const withAsset = query.asset ? `&asset=${query.asset}` : '';
  const scan = async () => {
    const r = parseScan(await scanQr(t('scan')));
    if (!r) return;
    if (r.route) go(r.route);
    else go(`/withdraw?address=${encodeURIComponent(r.address)}${r.network ? `&network=${r.network}` : ''}${withAsset}`);
  };
  const people = (recent || []).slice(0, 8);
  return (
    <Page title={t('send_title')}>
      <SearchBox value={q} onChange={setQ} placeholder={t('send_search_ph')}
        right={<button type="button" className="em" onClick={scan} aria-label={t('scan')}><Icon name="scan" size={18} /></button>} />

      {fam && (
        <div className="list"><Li icon="up" title={t('send_to_this_address')} sub={`${q.trim().slice(0, 8)}…${q.trim().slice(-6)}`} chev
          onClick={() => go(`/withdraw?address=${encodeURIComponent(q.trim())}${withAsset}`)} /></div>
      )}
      {found && (
        <div className="list"><Li av={<Avatar src={found.photo} name={found.name} />} title={found.name} sub={found.username ? `@${found.username}` : t('user_found')} chev
          right={found.verified ? <Pill tone="g" icon="shieldok">{t('verified')}</Pill> : null} onClick={() => go(`/send/user?to_id=${found.id}${withAsset}`)} /></div>
      )}
      {found === null && q.trim().length >= 3 && !fam && (
        <div className="warn"><Icon name="info" size={17} /><span>{t('err_recipient_not_found')} <button type="button" className="em b"
          onClick={() => go(`/gift/new?lock=username&username=${encodeURIComponent(q.trim().replace(/^@/, ''))}`)}>{t('send_as_gift')}</button></span></div>
      )}

      {people.length > 0 && !q && (
        <>
          <div className="h2"><span>{t('recent')}</span></div>
          <div className="row" style={{ gap: 14, padding: '4px 2px', overflowX: 'auto' }}>
            {people.map((u) => (
              <button key={u.id} type="button" className="col center g6" style={{ fontSize: 12, flex: 'none', width: 56 }} onClick={() => go(`/send/user?to_id=${u.id}${withAsset}`)}>
                <Avatar src={u.photo} name={u.name} size={52} /><span className="ellipsis" style={{ maxWidth: 56 }}>{u.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {!q && (
        <div className="list">
          {(f.transfer !== false || f.gifts !== false) && <Li icon="users" title={t('send_to_contact')} sub={t('send_to_contact_sub')} chev onClick={() => go('/send/contact')} />}
          {f.withdraw !== false && <Li icon="up" title={t('send_external')} sub={t('send_external_sub')} chev onClick={() => go(`/withdraw${query.asset ? `?asset=${query.asset}` : ''}`)} />}
          {f.gifts !== false && <Li icon="gift" title={t('send_gift')} sub={t('send_gift_sub')} chev onClick={() => go('/gift/new')} />}
          {f.split !== false && <Li icon="split" title={t('split_title')} sub={t('split_sub')} right={<Pill>{t('new')}</Pill>} onClick={() => go('/split/new')} />}
        </div>
      )}
      {!q && people.length > 0 && (
        <>
          <div className="h2"><span>{t('contacts_on_zohra')}</span></div>
          <div className="list">
            {people.slice(0, 5).map((u) => <Li key={u.id} av={<Avatar src={u.photo} name={u.name} />} title={u.name} sub={u.username ? `@${u.username}` : ''} chev
              onClick={() => go(`/send/user?to_id=${u.id}${withAsset}`)} />)}
          </div>
        </>
      )}
    </Page>
  );
}

const QUICK = [10, 50, 100];

/** Design sheets 02.5 – 02.7 — amount on a big keypad, clear confirmation, success with a verified receipt. */
function Transfer({ query }) {
  const { t } = useI18n();
  const { wallet, loadWallet, toast } = useApp();
  const ask = useConfirm();
  const [rcpt, setRcpt] = useState(null);
  const [asset, setAsset] = useState(query.asset || 'USDT');
  const [amount, setAmount, press] = useAmountKeys(query.amount || '');
  const [note, setNote] = useState(query.note || '');
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const key = useRef(idem());
  const a = wallet?.assets?.find((x) => x.id === asset);
  useEffect(() => {
    const q = query.to_id || query.to;
    if (q) api.get(`/api/users/lookup?q=${encodeURIComponent(q)}`).then((r) => setRcpt(r.user || false)).catch(() => setRcpt(false));
    else go('/send', true);
  }, [query.to_id, query.to]);
  const avail = Number(a?.available || 0);
  const usd = Number(a?.usd || 0);
  const over = Number(amount || 0) > avail;
  const dec = Math.min(a?.display ?? 6, 8);

  const submit = async () => {
    setBusy(true);
    try {
      const p = await api.post('/api/transfer/preview', { to_id: rcpt.id, asset, amount });
      const fee = Number(p.fee) ? `${amt(p.fee)} ${asset}` : t('free');
      const r = await withConfirm(ask, t, (f) => api.post('/api/transfer', { to_id: rcpt.id, asset, amount, note, idem: key.current, ...f }), {
        head: (
          <div className="col center g6" style={{ padding: '4px 0 6px' }}>
            <Avatar src={rcpt.photo} name={rcpt.name} size={56} />
            <span className="dim" style={{ fontSize: 13.5 }}>{t('you_are_sending')}</span>
            <span className="mid" dir="ltr">{amt(amount, dec)} {asset}</span>
            <span className="dim small" dir="ltr">≈ {fiat(Number(amount) * usd)}</span>
          </div>
        ),
        rows: [[t('to_label'), `${rcpt.name}${rcpt.username ? ` · @${rcpt.username}` : ''}`], [t('fee'), <span className={Number(p.fee) ? '' : 'ok'}>{fee}</span>],
          [t('arrives'), t('arrives_now')], ...(note ? [[t('note'), note]] : [])],
        cta: t('send_x', { amount: amt(amount, dec), asset }),
        title: `${amt(amount, dec)} ${asset} → ${rcpt.name}`,
      });
      if (r) { setDone({ ...r, fee }); loadWallet(); }
    } catch (e) { toast(errText(t, e), 'error'); haptic.error(); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Success title={t('sent')} amount={<span dir="ltr">{amt(done.amount, dec)} {done.asset}</span>} sub={t('sent_to_now', { name: rcpt.name })}
        rows={[[t('reference'), <span className="mono">{done.id}</span>], [t('fee'), <span className="ok">{done.fee}</span>],
          [t('status'), <span className="ok row g4"><Icon name="shieldok" size={14} />{t('verified_receipt')}</span>]]}
        actions={<>
          <div className="row g8"><Btn kind="s" className="grow" icon="share" onClick={() => go(`/tx/${done.id}`)}>{t('receipt')}</Btn>
            <Btn kind="s" className="grow" icon="repeat" onClick={() => { setDone(null); setAmount(''); key.current = idem(); }}>{t('send_again')}</Btn></div>
          <Btn w onClick={() => go('/', true)}>{t('done')}</Btn>
        </>} />
    );
  }
  if (rcpt === false) return <Page title={t('send_title')}><Empty icon="user" title={t('err_recipient_not_found')} /></Page>;
  return (
    <Page title={rcpt ? t('send_to_name', { name: rcpt.name.split(' ')[0] }) : t('send_title')}>
      {rcpt && (
        <div className="card row">
          <Avatar src={rcpt.photo} name={rcpt.name} size={44} />
          <span className="grow"><b style={{ fontSize: 15 }}>{rcpt.name}</b><small className="dim" style={{ display: 'block', fontSize: 12.5 }}>
            {rcpt.username ? `@${rcpt.username}` : ''}{rcpt.verified ? ` · ${t('verified')}` : ''}</small></span>
          {rcpt.verified && <Pill tone="g" icon="shieldok">{t('verified')}</Pill>}
        </div>
      )}
      <div className="col center g6" style={{ padding: '10px 0 2px' }}>
        <AmountView value={amount} over={over} />
        <button type="button" className="chip s2" onClick={() => setPick(true)}><CoinIcon asset={asset} size={20} />{asset}<Icon name="dd" size={16} /></button>
        <span className={`small ${over ? 'bad' : 'dim'}`} dir="ltr">≈ {fiat(Number(amount || 0) * usd)} · {t('available')} {amt(avail, dec)}</span>
      </div>
      <div className="chips" style={{ justifyContent: 'center', margin: 0, padding: 0 }}>
        {usd > 0 && QUICK.map((v) => (
          <button key={v} type="button" className="chip" onClick={() => setAmount(String(Number((v / usd).toFixed(dec))))}>{fiat(v, 0)}</button>
        ))}
        <button type="button" className="chip" onClick={() => setAmount(String(avail))}>{t('max')}</button>
      </div>
      <Input className="pill-in" icon="chat" value={note} onChange={(e) => setNote(e.target.value.slice(0, 140))} placeholder={t('add_note_ph')} />
      <div style={{ padding: '4px 12px 0' }}><Keypad onKey={press} small /></div>
      <Btn w loading={busy} disabled={!rcpt || !Number(amount) || over} onClick={submit}>{t('continue')}</Btn>
      <AssetPicker open={pick} onClose={() => setPick(false)} assets={wallet?.assets?.filter((x) => x.transfer)} onPick={(x) => setAsset(x.id)} />
    </Page>
  );
}

function ContactPick({ query }) {
  const { t } = useI18n();
  const { config, toast } = useApp();
  const [token, setToken] = useState(query.pick || null);
  const [res, setRes] = useState(null);
  const purpose = query.purpose || 'send';
  useEffect(() => {
    if (!token) return undefined;
    let stop = false;
    const poll = async () => {
      try {
        const r = await api.get(`/api/contacts/pick/${token}`, { silent: true });
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
    <Page title={t('pick_contact_title')} bar={res ? <Btn w onClick={() => go(target, true)}>{t('continue')}</Btn> : <Btn w icon="telegram" onClick={start}>{t('open_picker')}</Btn>}>
      <div className="col center g12" style={{ textAlign: 'center', paddingTop: 30 }}>
        {res ? <Avatar name={res.name} size={76} /> : <span className="ic xl"><Icon name="contacts" size={40} stroke={1.8} /></span>}
        <b className="disp" style={{ fontSize: 20 }}>{res ? res.name : t('pick_contact_title')}</b>
        <span className="dim">{res ? (res.registered && purpose !== 'gift' ? t('picked_registered', { name: res.name }) : t('picked_not_registered', { name: res.name })) : t('pick_contact_sub')}</span>
        {token && !res && <div className="prog indet" style={{ width: 160 }}><i /></div>}
        {token && !res && <span className="dim small">{t('waiting_pick')}</span>}
      </div>
    </Page>
  );
}
