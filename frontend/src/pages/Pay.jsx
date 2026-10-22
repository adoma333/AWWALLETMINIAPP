import React, { useEffect, useRef, useState } from 'react';
import { api, idem } from '../api';
import { useConfirm, withConfirm } from '../components/Confirm';
import Icon, { CoinIcon } from '../components/Icon';
import { ZMark } from '../components/Logo';
import Success from '../components/Success';
import { AmountView, AssetPicker, Avatar, Btn, Empty, HeadBtn, Input, Keypad, Li, Page, Pill, QR, RootHead, Segmented, Sheet, Skeleton, Switch, useAmountKeys, useCopy } from '../components/ui';
import { amt, fiat, timeAgo } from '../format';
import { errText, useI18n } from '../i18n';
import { go, match } from '../router';
import { useApp } from '../store';
import { haptic, scanQr, shareUrl } from '../telegram';
import { parseScan } from '../util';

export default function Pay({ path, query }) {
  let m;
  if (path === '/request' || path === '/request/new') return <RequestNew query={query} />;
  if ((m = match('/request/:code', path))) return <RequestView code={m.code} />;
  if (path === '/split' || path === '/split/new') return <SplitNew query={query} />;
  if ((m = match('/split/:id', path))) return <SplitView id={m.id} />;
  return <ZPay />;
}

export function payLink(config, me) {
  const who = me?.username || me?.id;
  return config?.bot ? `https://t.me/${config.bot}?startapp=u_${who}` : `${location.origin}/#/send/user?to=${who}`;
}
const pretty = (url) => url.replace(/^https?:\/\//, '');

async function scanAndGo(t, toast) {
  const raw = await scanQr(t('scan_to_pay'));
  if (!raw) return;
  const r = parseScan(raw);
  if (!r) { toast(t('scan_unknown'), 'error'); return; }
  haptic.success();
  if (r.route) go(r.route);
  else go(`/withdraw?address=${encodeURIComponent(r.address)}${r.network ? `&network=${r.network}` : ''}${r.memo ? `&memo=${encodeURIComponent(r.memo)}` : ''}`);
}

/** Design sheet 04.1 — Z Pay: personal QR and pay link, scan to pay, request / split / gift. */
function ZPay() {
  const { t } = useI18n();
  const { me, config, toast } = useApp();
  const f = config?.features || {};
  const [tab, setTab] = useState('receive');
  const [ok, copy] = useCopy();
  const [mine, setMine] = useState(() => api.cached('/api/requests') || null);
  useEffect(() => { api.get('/api/requests', { silent: true }).then(setMine).catch(() => setMine({ items: [], splits: [] })); }, []);
  const link = payLink(config, me);
  const share = () => shareUrl(link, t('pay_me_text', { name: me.first_name || me.name }));
  const acts = [
    f.pay_requests !== false && ['dollar', t('request'), () => go('/request'), true],
    f.pay_requests !== false && ['split', t('split_bill'), () => go('/split/new')],
    f.gifts !== false && ['gift', t('action_gift'), () => go('/gift')],
    ['scan', t('scan'), () => scanAndGo(t, toast)],
  ].filter(Boolean);
  const open = [...(mine?.items || []).filter((r) => r.status === 'open'), ...(mine?.splits || []).filter((s) => s.status === 'open')];
  return (
    <main className="page">
      <div className="glow-bg" style={{ top: 70 }} />
      <RootHead title="Z Pay" right={<HeadBtn icon="share" onClick={share} label={t('share')} />} />
      <Segmented value={tab} onChange={setTab} options={[['receive', t('receive')], ['scan', t('scan_to_pay')]]} />
      {tab === 'receive' ? (
        <div className="card col center g12" style={{ padding: '20px 16px 18px' }}>
          <div className="row g10">
            <Avatar src={me.photo} name={me.first_name || me.name} size={34} seed={me.id} />
            <span className="col"><b style={{ fontSize: 15 }}>{me.first_name || me.name}</b><span className="dim" style={{ fontSize: 12.5 }}>{t('scan_to_pay_me')}</span></span>
          </div>
          <QR value={link} size={212} logo={<ZMark size={40} />} />
          <button type="button" className="chip s2" style={{ fontSize: 14.5 }} onClick={() => copy(link)}>
            <Icon name="link" size={16} /><b dir="ltr" className="ellipsis" style={{ maxWidth: 220 }}>{pretty(link)}</b><span className={ok ? 'ok' : 'em'}><Icon name={ok ? 'check' : 'copy'} size={15} /></span>
          </button>
        </div>
      ) : (
        <button type="button" className="card col center g12" style={{ padding: '30px 16px' }} onClick={() => scanAndGo(t, toast)}>
          <span className="ic" style={{ width: 84, height: 84, borderRadius: 28 }}><Icon name="scan" size={40} /></span>
          <b className="disp" style={{ fontSize: 18 }}>{t('scan_to_pay')}</b>
          <span className="dim small center">{t('scan_to_pay_sub')}</span>
          <span className="btn p sm" style={{ marginTop: 4 }}><Icon name="scan" size={16} />{t('open_camera')}</span>
        </button>
      )}
      <div className="acts">
        {acts.map(([i, l, fn, m]) => (
          <button key={l} type="button" className={`act ${m ? 'm' : ''}`} onClick={() => { haptic.tap(); fn(); }}>
            <span className="o" style={{ width: 54, height: 54 }}><Icon name={i} size={22} stroke={2.2} /></span>{l}
          </button>
        ))}
      </div>
      {open.length > 0 && (
        <>
          <div className="h2"><span>{t('waiting_payment')}</span></div>
          <div className="list">
            {open.slice(0, 6).map((r) => (r.code ? (
              <Li key={r.code} icon="dollar" title={r.amount ? <span dir="ltr">{amt(r.amount)} {r.asset}</span> : t('any_amount')} sub={r.note || timeAgo(r.created_at, t)}
                right={<Pill tone="y">{t('status_open')}</Pill>} chev onClick={() => go(`/request/${r.code}`)} />
            ) : (
              <Li key={r.id} icon="split" title={r.title || t('split_bill')} sub={t('x_of_y_paid', { n: r.paid, total: r.count })}
                right={<span className="r" dir="ltr"><b>{amt(r.total)}</b><small>{r.asset}</small></span>} chev onClick={() => go(`/split/${r.id}`)} />
            )))}
          </div>
        </>
      )}
      <div className="list">
        <Li icon="send" title={t('pay_to_user')} sub={t('pay_to_user_sub')} chev onClick={() => go('/send')} />
        <Li icon="contacts" title={t('address_book')} sub={t('pay_contacts_sub')} chev onClick={() => go('/settings/addressbook')} />
      </div>
    </main>
  );
}

/** Design sheet 04.2 — request money: keypad amount, note, live preview of the shareable card. */
function RequestNew({ query }) {
  const { t } = useI18n();
  const { me, wallet, toast } = useApp();
  const [asset, setAsset] = useState(query.asset || 'USDT');
  const a = wallet?.assets?.find((x) => x.id === asset);
  const [amount, , press] = useAmountKeys(query.amount || '', Math.min(a?.display ?? 2, 6));
  const [note, setNote] = useState('');
  const [pick, setPick] = useState(false);
  const [req, setReq] = useState(null);
  const [busy, setBusy] = useState('');
  const ensure = async () => {
    if (req) return req;
    const r = await api.post('/api/requests', { asset, amount: amount || undefined, note });
    setReq(r);
    return r;
  };
  const run = async (kind) => {
    setBusy(kind);
    try {
      const r = await ensure();
      if (kind === 'share') shareUrl(r.link, `${t('x_requests', { name: me.first_name || me.name })} ${amount ? `${amt(amount)} ${asset}` : ''}${note ? ` · ${note}` : ''}`);
      else { const { copyText } = await import('../telegram'); if (await copyText(r.link)) { haptic.success(); toast(t('link_copied'), 'ok'); } }
    } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(''); }
  };
  return (
    <Page title={t('request')} bar={(
      <div className="row g10">
        <Btn kind="s" style={{ flex: '0 0 120px' }} icon="copy" loading={busy === 'copy'} onClick={() => run('copy')}>{t('link')}</Btn>
        <Btn className="grow" icon="send" loading={busy === 'share'} onClick={() => run('share')}>{t('send_to_chat')}</Btn>
      </div>
    )}>
      <div className="col center g6" style={{ padding: '6px 0 2px' }}>
        <AmountView value={amount} />
        <button type="button" className="chip s2" onClick={() => setPick(true)}><CoinIcon asset={asset} size={20} />{asset}<Icon name="dd" size={15} /></button>
        <span className="dim small" dir="ltr">{amount ? `≈ ${fiat(Number(amount) * Number(a?.usd || 0))}` : t('empty_any_amount')}</span>
      </div>
      <Input className="pill-in" icon="chat" value={note} onChange={(e) => { setNote(e.target.value); setReq(null); }} placeholder={t('request_for_ph')} maxLength={140} />
      <div className="h2"><span>{t('preview')}</span></div>
      <div className="col g10" style={{ borderRadius: 24, padding: 18, background: 'linear-gradient(160deg,#2a1406,var(--s1) 60%)' }}>
        <div className="row g8"><ZMark size={26} /><b className="disp" style={{ fontSize: 13, letterSpacing: '.1em' }}>ZOHRA PAY</b><Pill tone="n" className="ms-auto">{t('request')}</Pill></div>
        <div className="row g10"><Avatar src={me.photo} name={me.first_name || me.name} size={40} seed={me.id} />
          <span className="col"><b style={{ fontSize: 14.5 }}>{t('x_requests', { name: me.first_name || me.name })}</b><span className="mid" style={{ fontSize: 26 }} dir="ltr">{amount ? `${amt(amount)} ${asset}` : t('any_amount')}</span></span></div>
        {note && <span className="dim" style={{ fontSize: 13 }}>{note}</span>}
        <span className="btn p sm w" style={{ height: 44 }}>{t('pay_with_zohra')}</span>
      </div>
      <div className="note"><Icon name="info" size={15} /><span>{t('request_newcomers_note')}</span></div>
      <Keypad onKey={(k) => { press(k); setReq(null); }} small />
      <AssetPicker open={pick} onClose={() => setPick(false)} assets={wallet?.assets?.filter((x) => x.transfer)} onPick={(x) => { setAsset(x.id); setReq(null); }} />
    </Page>
  );
}

/** A request opened from a link: the payer pays in one tap; the owner sees status, QR and can cancel. */
function RequestView({ code }) {
  const { t } = useI18n();
  const { wallet, loadWallet, toast } = useApp();
  const ask = useConfirm();
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const key = useRef(idem());
  const load = () => api.get(`/api/requests/${code}`).then(setR).catch(setErr);
  useEffect(() => { load(); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Page title={t('request')}><Empty icon="alert" title={errText(t, err)} /></Page>;
  if (!r) return <Page title={t('request')}><Skeleton h={220} r={24} /></Page>;
  const a = wallet?.assets?.find((x) => x.id === r.asset);
  const value = r.amount || amount;
  const pay = async () => {
    setBusy(true);
    try {
      const res = await withConfirm(ask, t, (f) => api.post(`/api/requests/${code}/pay`, { amount: r.amount ? undefined : amount, idem: key.current, ...f }), {
        title: t('pay_request'), cta: t('pay_x', { amount: `${amt(value)} ${r.asset}` }),
        head: <div className="col center g6"><Avatar src={r.to?.photo} name={r.to?.name} size={56} seed={r.to?.id} /><span className="mid" dir="ltr">{amt(value)} {r.asset}</span></div>,
        rows: [[t('to_label'), r.to?.name], r.note && [t('note'), r.note], [t('fee'), <span className="ok">{t('free')}</span>]].filter(Boolean),
      });
      if (res) { haptic.success(); setDone(res); loadWallet(); }
    } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };
  if (done) {
    return <Success title={t('paid')} amount={<span dir="ltr">{amt(done.amount)} {r.asset}</span>} sub={t('sent_to_now', { name: r.to?.name })}
      actions={<><Btn w onClick={() => go('/', true)}>{t('done')}</Btn><Btn w kind="s" onClick={() => go(`/tx/${done.id}`)}>{t('receipt')}</Btn></>} />;
  }
  const closed = r.status !== 'open';
  return (
    <Page title={r.mine ? t('my_request') : t('pay_request')} right={r.mine && !closed ? <HeadBtn icon="share" onClick={() => shareUrl(r.link, r.note || '')} label={t('share')} /> : null}
      bar={!r.mine && !closed ? <Btn w loading={busy} disabled={!(Number(value) > 0) || Number(value) > Number(a?.available || 0)} onClick={pay}>
        {Number(value) > Number(a?.available || 0) ? t('err_insufficient_funds', { asset: r.asset }) : t('pay_x', { amount: `${amt(value || 0)} ${r.asset}` })}</Btn> : null}>
      <div className="card glow col center g8" style={{ padding: '22px 16px' }}>
        <Avatar src={r.to?.photo} name={r.to?.name} size={56} seed={r.to?.id} />
        <b style={{ fontSize: 15 }}>{r.mine ? t('you_request') : t('x_requests', { name: r.to?.name })}</b>
        {r.amount ? <span className="big" style={{ fontSize: 42 }} dir="ltr">{amt(r.amount)} <span className="cents">{r.asset}</span></span>
          : r.mine ? <span className="mid">{t('any_amount')}</span> : null}
        {r.note && <span className="dim" style={{ fontSize: 13.5 }}>“{r.note}”</span>}
        <Pill tone={{ open: 'y', paid: 'g' }[r.status] || 'n'} icon={r.status === 'paid' ? 'check' : 'clock'}>{t(`status_${r.status}`)}</Pill>
      </div>
      {!r.mine && !closed && !r.amount && (
        <div className="input"><CoinIcon asset={r.asset} size={22} /><input autoFocus inputMode="decimal" placeholder="0.00" value={amount} dir="ltr"
          onChange={(e) => setAmount(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))} /><span className="dim">{r.asset}</span></div>
      )}
      {!r.mine && !closed && <div className="note"><Icon name="shieldok" size={15} className="ok" /><span>{t('request_pay_note', { name: r.to?.name })}</span></div>}
      {r.mine && !closed && <div className="col center"><QR value={r.link} size={196} logo={<ZMark size={36} />} /></div>}
      {r.mine && r.status === 'paid' && r.payer && <Li av={<Avatar src={r.payer.photo} name={r.payer.name} size={40} seed={r.payer.id} />} title={r.payer.name} sub={t('paid_x_ago', { when: timeAgo(r.paid_at, t) })} chev={!!r.tx} onClick={r.tx ? () => go(`/tx/${r.tx}`) : undefined} />}
      {r.mine && !closed && <Btn kind="danger" w onClick={async () => { try { await api.post(`/api/requests/${code}/cancel`); load(); } catch (e) { toast(errText(t, e), 'error'); } }}>{t('cancel_request')}</Btn>}
    </Page>
  );
}

/** Design sheet 04.3 — split a bill: equal or custom shares, friends on Zohra get a bot message, others a link. */
function SplitNew({ query }) {
  const { t } = useI18n();
  const { me, wallet, toast } = useApp();
  const [title, setTitle] = useState(query.title || '');
  const [asset, setAsset] = useState('USDT');
  const [total, setTotal] = useState('');
  const [mode, setMode] = useState('equal');
  const [includeMe, setIncludeMe] = useState(true);
  const [recent, setRecent] = useState([]);
  const [people, setPeople] = useState([]);
  const [guest, setGuest] = useState('');
  const [pick, setPick] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/api/contacts/recent').then((r) => setRecent(r.items)).catch(() => {}); }, []);
  const n = people.length + (includeMe ? 1 : 0);
  const each = n ? Number(total || 0) / n : 0;
  const toggle = (u) => setPeople((p) => (p.some((x) => x.user_id === u.id) ? p.filter((x) => x.user_id !== u.id) : [...p, { user_id: u.id, name: u.name, photo: u.photo, amount: '' }]));
  const setAmt = (i, v) => setPeople((p) => p.map((x, j) => (j === i ? { ...x, amount: v.replace(/[^\d.]/g, '') } : x)));
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/splits', { asset, total, title, include_me: includeMe, mode,
        people: people.map((p) => ({ user_id: p.user_id, name: p.name, amount: mode === 'custom' ? p.amount : undefined })) });
      haptic.success();
      go(`/split/${r.id}`, true);
    } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Page title={t('split_bill')} right={n > 0 ? <Pill icon="users">{n}</Pill> : null}
      bar={<Btn w loading={busy} disabled={!(Number(total) > 0) || !people.length} onClick={create} icon="split">{t('split_send')}</Btn>}>
      <div className="card glow col g8" style={{ padding: 16 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('split_title_ph')} maxLength={80}
          style={{ background: 'none', border: 0, color: 'var(--ash)', fontSize: 13.5, textAlign: 'center' }} />
        <div className="row center g8">
          <input className="amt-in" style={{ textAlign: 'center', width: 180 }} inputMode="decimal" placeholder="0.00" value={total} dir="ltr"
            onChange={(e) => setTotal(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))} />
          <button type="button" className="coin-chip" onClick={() => setPick(true)}><CoinIcon asset={asset} size={22} />{asset}<Icon name="dd" size={14} /></button>
        </div>
        {mode === 'equal' && n > 0 && Number(total) > 0 && <span className="dim center small" dir="ltr">{t('x_each', { amount: `${amt(each, 2)} ${asset}` })}</span>}
      </div>
      <Segmented value={mode} onChange={setMode} options={[['equal', t('split_equal')], ['custom', t('split_custom')]]} />
      <div className="list">
        <Li av={<Avatar src={me.photo} name={me.first_name || me.name} size={40} seed={me.id} />} title={t('you')} sub={t('organizer')}
          right={<span className="row g8">{includeMe && mode === 'equal' && <b dir="ltr">{amt(each, 2)}</b>}<Switch on={includeMe} onChange={setIncludeMe} /></span>} />
        {people.map((p, i) => (
          <Li key={p.user_id || `g${i}`} av={<Avatar src={p.photo} name={p.name} size={40} seed={p.user_id || p.name} />} title={p.name}
            sub={p.user_id ? t('gets_bot_message') : t('gets_link')}
            right={<span className="row g8">{mode === 'custom'
              ? <input className="amt-in" style={{ fontSize: 16, width: 80, textAlign: 'end' }} inputMode="decimal" placeholder="0" value={p.amount} onChange={(e) => setAmt(i, e.target.value)} dir="ltr" />
              : <b dir="ltr">{amt(each, 2)}</b>}
              <button type="button" className="ic xs n" onClick={() => setPeople((x) => x.filter((_, j) => j !== i))} aria-label={t('delete')}><Icon name="x" size={14} /></button></span>} />
        ))}
        <Li icon="plus" title={t('add_people')} onClick={() => setAddOpen(true)} chev />
      </div>
      <div className="note"><Icon name="info" size={15} /><span>{t('split_note')}</span></div>
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={t('add_people')} tall>
        {recent.length > 0 && <div className="h2"><span>{t('recent')}</span></div>}
        <div className="list">
          {recent.map((u) => {
            const on = people.some((x) => x.user_id === u.id);
            return <Li key={u.id} av={<Avatar src={u.photo} name={u.name} size={40} seed={u.id} />} title={u.name} sub={u.username ? `@${u.username}` : ''}
              right={<span className={`ic xs ${on ? '' : 'n'}`}><Icon name={on ? 'check' : 'plus'} size={15} /></span>} onClick={() => toggle(u)} />;
          })}
        </div>
        <div className="h2"><span>{t('add_by_username')}</span></div>
        <div className="row g8">
          <Input className="grow" icon="user" value={guest} onChange={(e) => setGuest(e.target.value)} placeholder={t('username_or_name')} />
          <Btn size="sm" disabled={guest.trim().length < 2} onClick={async () => {
            const q = guest.trim();
            try {
              const { user } = await api.get(`/api/users/lookup?q=${encodeURIComponent(q)}`, { silent: true });
              if (user) { if (!people.some((x) => x.user_id === user.id)) toggle(user); } else setPeople((p) => [...p, { name: q.replace(/^@/, ''), amount: '' }]);
            } catch { setPeople((p) => [...p, { name: q.replace(/^@/, ''), amount: '' }]); }
            setGuest('');
          }}>{t('add')}</Btn>
        </div>
        <Btn w kind="f" onClick={() => setAddOpen(false)}>{t('done')}</Btn>
      </Sheet>
      <AssetPicker open={pick} onClose={() => setPick(false)} assets={wallet?.assets?.filter((x) => x.transfer)} onPick={(x) => setAsset(x.id)} />
    </Page>
  );
}

function SplitView({ id }) {
  const { t } = useI18n();
  const { me, toast } = useApp();
  const [sp, setSp] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/api/splits/${id}`).then(setSp).catch(() => setSp(false));
  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => clearInterval(iv); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (sp === false) return <Page title={t('split_bill')}><Empty icon="alert" title={t('err_not_found')} /></Page>;
  if (!sp) return <Page title={t('split_bill')}><Skeleton h={160} r={22} /></Page>;
  const owed = Number(sp.collected) + Number(sp.outstanding);
  const pending = sp.requests.filter((r) => r.status === 'open');
  const known = pending.filter((r) => r.payer);
  const names = pending.map((r) => r.payer?.name || r.payer_name || '—');
  return (
    <Page title={t('split_bill')} right={<Pill icon="users">{sp.people}</Pill>}
      bar={known.length ? <Btn w icon="bell" loading={busy} onClick={async () => {
        setBusy(true);
        try { const r = await api.post(`/api/splits/${id}/remind`); haptic.success(); toast(t('reminded_n', { n: r.sent }), 'ok'); } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
      }}>{t('remind_x', { names: names.slice(0, 2).join(' & ') + (names.length > 2 ? ` +${names.length - 2}` : '') })}</Btn> : null}>
      <div className="card glow col center g4" style={{ padding: 18 }}>
        <span className="dim" style={{ fontSize: 13 }}>{sp.title || t('split_bill')}</span>
        <span className="mid" dir="ltr">{amt(sp.total)} {sp.asset}</span>
        <span className="dim" style={{ fontSize: 13 }}>{sp.status === 'settled' ? t('everyone_paid') : t('created_x', { when: timeAgo(sp.created_at, t) })}</span>
      </div>
      <div className="list">
        <Li av={<Avatar src={me.photo} name={me.first_name || me.name} size={40} seed={me.id} />} title={t('you')} sub={t('paid_the_bill')} right={<Pill tone="g">{t('organizer')}</Pill>} />
        {sp.requests.map((r) => {
          const who = r.payer || { name: r.payer_name || t('guest') };
          const tone = { paid: 'g', open: who.id ? 'y' : 'n' }[r.status] || 'n';
          const label = r.status === 'paid' ? t('status_paid') : r.status === 'open' ? (who.id ? t('status_pending') : t('invited')) : t(`status_${r.status}`);
          return (
            <Li key={r.code} av={<Avatar src={who.photo} name={who.name} size={40} seed={who.id || who.name} />} title={who.name}
              sub={r.status === 'paid' ? t('paid_x_ago', { when: timeAgo(r.paid_at, t) }) : who.id ? t('request_sent') : t('share_link_hint')}
              right={<span className="r col" style={{ gap: 3, alignItems: 'flex-end' }}><b dir="ltr">{amt(r.amount)}</b><Pill tone={tone}>{label}</Pill></span>}
              onClick={r.status === 'open' && !who.id ? () => shareUrl(r.link, `${sp.title || t('split_bill')} · ${amt(r.amount)} ${sp.asset}`) : undefined} />
          );
        })}
      </div>
      <div className="row g10" style={{ alignItems: 'center' }}>
        <div className="prog grow"><i style={{ width: `${owed ? (Number(sp.collected) / owed) * 100 : 0}%` }} /></div>
        <span className="dim" style={{ fontSize: 12.5 }} dir="ltr">{t('x_of_y_collected', { x: amt(sp.collected), y: `${amt(owed)} ${sp.asset}` })}</span>
      </div>
    </Page>
  );
}
