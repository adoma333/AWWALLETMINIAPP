import React, { useEffect, useRef, useState } from 'react';
import { api, idem } from '../api';
import { useConfirm, withConfirm } from '../components/Confirm';
import Icon, { CoinIcon } from '../components/Icon';
import Success, { Confetti } from '../components/Success';
import { AmountInput, AssetPicker, Avatar, Btn, CopyField, Empty, HeadBtn, Input, Li, Page, Pill, Segmented, Skeleton, Status } from '../components/ui';
import { amt, inFuture, timeAgo } from '../format';
import { errText, useI18n } from '../i18n';
import { go, match } from '../router';
import { useApp } from '../store';
import { haptic, shareMessage, shareUrl } from '../telegram';

export const THEMES = {
  classic: ['🎁', 'rgba(255,138,0,.35)'], birthday: ['🎂', 'rgba(255,61,110,.35)'], ramadan: ['🌙', 'rgba(123,97,255,.35)'],
  eid: ['🕌', 'rgba(61,220,151,.3)'], love: ['💝', 'rgba(255,61,110,.4)'], thanks: ['🙏', 'rgba(255,194,74,.32)'],
};
const themeBg = (k) => `radial-gradient(100% 100% at 50% 0%,${(THEMES[k] || THEMES.classic)[1]},transparent 65%),var(--s1)`;

export default function Gift({ path, query }) {
  if (path === '/gifts') return <MyGifts />;
  const m = match('/gift/:code', path);
  if (m && m.code !== 'new') return <Claim code={m.code} />;
  return <CreateGift query={query} />;
}

/** Design sheet 04.4 — create a gift: themed card preview, who can open it, one-person lock or red packet. */
function CreateGift({ query }) {
  const { t } = useI18n();
  const { wallet, loadWallet, me, toast } = useApp();
  const ask = useConfirm();
  const [lock, setLock] = useState(query.lock || (query.to_id ? 'user' : 'open'));
  const [asset, setAsset] = useState(query.asset || 'USDT');
  const [amount, setAmount] = useState('');
  const [username, setUsername] = useState(query.username || '');
  const [password, setPassword] = useState('');
  const [shares, setShares] = useState(query.packet ? 10 : 1);
  const [split, setSplit] = useState('random');
  const [message, setMessage] = useState('');
  const [theme, setTheme] = useState(query.theme || 'classic');
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gift, setGift] = useState(null);
  const key = useRef(idem());
  const a = wallet?.assets?.find((x) => x.id === asset);
  const packet = lock === 'packet';
  const realLock = packet ? 'open' : lock;
  const n = packet ? Math.max(2, shares) : 1;
  const create = async () => {
    setBusy(true);
    try {
      const body = { asset, amount, lock: realLock, message, theme, idem: key.current, shares: realLock === 'open' ? n : 1, split,
        recipient_id: query.to_id ? Number(query.to_id) : undefined, recipient_username: username, password };
      const g = await withConfirm(ask, t, (f) => api.post('/api/gifts', { ...body, ...f }), {
        title: t('confirm_gift'), cta: t('create_gift'),
        head: <div className="col center g6"><span style={{ fontSize: 46 }}>{THEMES[theme][0]}</span><span className="mid" dir="ltr">{amt(amount)} {asset}</span></div>,
        rows: [[t('gift_who'), t(`lock_${lock}`)], packet && [t('shares'), `${n} · ${t(split === 'random' ? 'split_random' : 'split_equal')}`],
          query.name && [t('to_label'), query.name]].filter(Boolean),
      });
      if (g) { haptic.success(); setGift(g); loadWallet(); }
    } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };
  const sharePersonal = async () => {
    try {
      const r = await api.post(`/api/gifts/${gift.id}/share`);
      if (r.prepared_id && (await shareMessage(r.prepared_id))) { haptic.success(); return; }
      shareUrl(r.link, `${THEMES[theme][0]} ${me.first_name || me.name}: ${amt(gift.amount)} ${gift.asset}`);
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  if (gift) {
    return (
      <Success title={t('gift_created')} amount={<span dir="ltr">{THEMES[theme][0]} {amt(gift.amount)} {gift.asset}</span>}
        sub={gift.lock === 'user' ? t('gift_lock_note', { name: gift.recipient }) : packet ? t('packet_ready', { n: gift.shares }) : t('gift_ready_sub')}
        actions={<><Btn w icon="send" onClick={sharePersonal}>{gift.recipient ? t('send_to_x', { name: gift.recipient }) : t('gift_share_personal')}</Btn>
          <Btn w kind="s" onClick={() => go('/gifts', true)}>{t('my_gifts')}</Btn></>}>
        <CopyField value={gift.link} label={t('copy_link')} />
      </Success>
    );
  }
  const locks = [['user', 'user'], ['packet', 'users'], ['password', 'key'], ['open', 'link']];
  const over = Number(amount) > Number(a?.available || 0);
  const ready = Number(amount) > 0 && !over && (lock !== 'user' || query.to_id) && (lock !== 'password' || password.length >= 4) && (lock !== 'username' || username.length >= 4);
  const cta = lock === 'user' && query.name ? t('create_send_to', { name: query.name }) : packet ? t('create_packet') : t('create_gift');
  return (
    <Page title={t('gift_title')} right={<HeadBtn icon="history" onClick={() => go('/gifts')} label={t('my_gifts')} />}
      bar={<Btn w icon="gift" loading={busy} disabled={!ready} onClick={create}>{cta}</Btn>}>
      <div className="col center g4" style={{ borderRadius: 24, padding: '20px 16px', textAlign: 'center', background: themeBg(theme), transition: 'background .4s' }}>
        <span key={theme} className="emoji-xl" style={{ fontSize: 54, lineHeight: 1.1, animation: 'spop .45s cubic-bezier(.2,1.4,.4,1) both' }}>{packet ? '🧧' : THEMES[theme][0]}</span>
        <span className="mid" dir="ltr">{amount ? amt(amount) : '0'} {asset}</span>
        <span className="dim" style={{ fontSize: 13.5 }}>{message ? `“${message}”` : t('gift_message_ph')}</span>
        {packet && <span className="dim xs">{t('packet_preview', { n, kind: t(split === 'random' ? 'split_random' : 'split_equal') })}</span>}
      </div>
      <div className="row g8" style={{ overflowX: 'auto', paddingBottom: 2 }}>
        {Object.entries(THEMES).map(([k, [e]]) => (
          <button key={k} type="button" className={`theme-tile ${theme === k ? 'on' : ''}`} onClick={() => { haptic.select(); setTheme(k); }}>{e}<small>{t(`theme_${k}`)}</small></button>
        ))}
      </div>
      <div className="h2"><span>{t('gift_who')}</span></div>
      <div className="grid2">
        {locks.map(([k, ic]) => (
          <button key={k} type="button" className={`opt-tile ${lock === k ? 'on' : ''}`} onClick={() => { haptic.select(); setLock(k); if (k === 'packet' && shares < 2) setShares(10); }}>
            <Icon name={ic} size={19} /><b>{k === 'user' && query.name ? t('only_x', { name: query.name.split(' ')[0] }) : t(`lock_${k}`)}</b><small>{t(`lock_${k}_sub`)}</small>
          </button>
        ))}
      </div>
      {lock === 'user' && (query.to_id
        ? <div className="note ok"><Icon name="shieldok" size={15} /><span>{t('forward_safe_note', { name: query.name })}</span></div>
        : <Btn kind="f" w icon="contacts" onClick={() => go('/send/contact?purpose=gift')}>{t('choose_recipient')}</Btn>)}
      {lock === 'password' && <Input icon="key" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={40} placeholder={t('gift_password')} />}
      {lock === 'username' && <Input icon="user" value={username} onChange={(e) => setUsername(e.target.value.replace(/^@/, ''))} placeholder="@username" dir="ltr" />}
      {packet && (
        <div className="card col g10">
          <div className="row between"><span className="dim" style={{ fontSize: 13 }}>{t('shares')}</span>
            <span className="row g8">
              <button type="button" className="ic xs n" onClick={() => setShares((s) => Math.max(2, s - 1))} aria-label="−"><Icon name="minus" size={15} /></button>
              <b className="disp" style={{ fontSize: 18, minWidth: 30, textAlign: 'center' }}>{n}</b>
              <button type="button" className="ic xs n" onClick={() => setShares((s) => Math.min(200, s + 1))} aria-label="+"><Icon name="plus" size={15} /></button>
            </span></div>
          <Segmented value={split} onChange={setSplit} options={[['random', `🎲 ${t('split_random')}`], ['equal', t('split_equal')]]} />
        </div>
      )}
      <button type="button" className="card row g12 pad12" onClick={() => setPick(true)}>
        <CoinIcon asset={asset} size={34} /><span className="grow"><b>{asset}</b><small className="dim" style={{ display: 'block', fontSize: 12.5 }}>{t('available')} {amt(a?.available || 0, a?.display)}</small></span>
        <span className="chev"><Icon name="dd" size={18} /></span>
      </button>
      <AmountInput value={amount} onChange={setAmount} asset={asset} max={a?.available} usdPrice={a?.usd} display={a?.display} />
      <Input icon="chat" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={200} placeholder={t('gift_message_ph')} />
      <AssetPicker open={pick} onClose={() => setPick(false)} assets={wallet?.assets?.filter((x) => x.transfer)} onPick={(x) => setAsset(x.id)} />
    </Page>
  );
}

/** Design sheets 04.5 / 04.6 — recipient view (opens from the personal Telegram message) and red packet results. */
function Claim({ code }) {
  const { t } = useI18n();
  const { loadWallet, toast } = useApp();
  const [g, setG] = useState(null);
  const [err, setErr] = useState(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [party, setParty] = useState(false);
  const load = () => api.get(`/api/gifts/view/${code}`).then(setG).catch(setErr);
  useEffect(() => { load(); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  const claim = async () => {
    setBusy(true);
    try {
      await api.post('/api/gifts/claim', { code, password: pw || undefined });
      haptic.success();
      setParty(true);
      loadWallet();
      load();
    } catch (e) { haptic.error(); toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };
  if (err) return <Page title={t('gift_title')}><Empty icon="gift" title={errText(t, err)} /></Page>;
  if (!g) return <Page title={t('gift_title')}><Skeleton h={300} r={24} /></Page>;
  const emoji = g.shares > 1 ? '🧧' : (THEMES[g.theme] || THEMES.classic)[0];

  if (g.claims && (g.claimed || g.claims.length)) {
    const mine = g.claims.find((c) => c.me);
    return (
      <Page title={t('red_packet')} bar={g.sender && mine ? (
        <div className="row g10">
          <Btn kind="s" className="grow" onClick={() => go(`/send/user?to_id=${g.sender.id}&note=${encodeURIComponent('🙏')}`)}>{t('say_thanks')} 🙏</Btn>
          <Btn className="grow" icon="gift" onClick={() => go(`/gift/new?lock=packet&packet=1&theme=${g.theme}`)}>{t('send_one_back')}</Btn>
        </div>
      ) : null}>
        {party && <Confetti />}
        <div className="col center g4" style={{ borderRadius: 24, padding: 18, textAlign: 'center', background: 'linear-gradient(160deg,#5a0f12,#2a0a0a)' }}>
          <span style={{ fontSize: 44 }}>🧧</span>
          <b style={{ fontSize: 15 }}>{g.message || t('packet_from', { name: g.sender?.name || '' })}</b>
          {mine ? <span className="mid" style={{ color: '#FFC24A' }} dir="ltr">{t('you_got_x', { amount: `${amt(mine.amount)} ${g.asset}` })}</span>
            : <span className="mid" style={{ color: '#FFC24A' }} dir="ltr">{amt(g.amount)} {g.asset}</span>}
          <span style={{ fontSize: 12.5, color: '#f3c7c7' }}>{t('packet_stats', { n: g.claimed_shares, total: g.shares, amount: `${amt(g.amount)} ${g.asset}` })}
            {g.took_sec && g.claimed_shares === g.shares ? ` · ${t('in_x_min', { n: Math.max(1, Math.round(g.took_sec / 60)) })}` : ''}</span>
        </div>
        <div className="list">
          {[...g.claims].sort((x, y) => Number(y.amount) - Number(x.amount)).map((c) => (
            <Li key={c.id} av={<Avatar src={c.photo} name={c.name} size={38} seed={c.id} />} title={c.me ? t('you') : c.name}
              sub={c.luckiest ? <span className="gold">👑 {t('luckiest')}</span> : timeAgo(c.at, t)}
              right={<span className="r"><b dir="ltr">{amt(c.amount)} {g.asset}</b></span>} />
          ))}
        </div>
      </Page>
    );
  }
  return (
    <main className="page" style={{ position: 'relative', minHeight: '100vh' }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(80% 50% at 50% 30%,${(THEMES[g.theme] || THEMES.classic)[1]},transparent 70%)`, pointerEvents: 'none' }} />
      {(party || g.can_claim) && <Confetti n={party ? 40 : 18} round />}
      <div className="col center g12" style={{ position: 'relative', paddingTop: 50, textAlign: 'center' }}>
        <span className="breathe" style={{ fontSize: 96, lineHeight: 1, filter: 'drop-shadow(0 16px 30px rgba(255,61,110,.5))' }}>{emoji}</span>
        {g.sender && <div className="row g8"><Avatar src={g.sender.photo} name={g.sender.name} size={30} seed={g.sender.id} /><b style={{ fontSize: 15 }}>{t('claim_title', { name: g.sender.name })}</b></div>}
        <span className="big" style={{ fontSize: 48 }} dir="ltr">{amt(g.claimed || g.amount)} {g.asset}</span>
        {g.message && <span style={{ fontSize: 15, fontStyle: 'italic' }}>“{g.message}”</span>}
        {g.lock === 'user' && g.recipient && <Pill tone="g" icon="lock">{t('only_for_x', { name: g.recipient })}</Pill>}
        {g.shares > 1 && <Pill icon="users">{t('claimed_of', { n: g.claimed_shares, total: g.shares })}</Pill>}
        {g.status === 'active' && g.expires_at && <span className="dim xs">{t('expires_in', { when: inFuture(g.expires_at) })}</span>}
      </div>
      <div className="bar-bottom">
        {g.claimed ? (
          <><div className="warn g"><Icon name="checkCircle" size={18} /><span>{t('claimed_success', { amount: amt(g.claimed), asset: g.asset })}</span></div>
            <Btn w onClick={() => go('/', true)}>{t('open_wallet')}</Btn></>
        ) : g.can_claim ? (
          <>
            {g.lock === 'password' && <Input icon="key" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('gift_password')} />}
            <Btn w loading={busy} onClick={claim}>{g.shares > 1 ? t('open_packet') : t('open_gift')}</Btn>
            <span className="dim center xs">{t('new_wallet_auto')}</span>
          </>
        ) : <div className="warn r"><Icon name="lock" size={18} /><span>{errText(t, { code: g.reason })}</span></div>}
      </div>
    </main>
  );
}

function MyGifts() {
  const { t } = useI18n();
  const { loadWallet, toast } = useApp();
  const [items, setItems] = useState(null);
  const [f, setF] = useState('active');
  const load = () => api.get('/api/gifts').then((r) => setItems(r.items)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  const list = (items || []).filter((g) => (f === 'active' ? g.status === 'active' : g.status !== 'active'));
  return (
    <Page title={t('my_gifts')} right={<HeadBtn icon="plus" onClick={() => go('/gift/new')} label={t('create_gift')} />}>
      <Segmented value={f} onChange={setF} options={[['active', t('status_active')], ['done', t('history')]]} />
      {!items && <Skeleton h={160} r={22} />}
      {items && list.length === 0 && <Empty icon="gift" title={t('no_gifts')} sub={t('send_gift_sub')} action={<Btn size="sm" icon="gift" onClick={() => go('/gift/new')}>{t('create_gift')}</Btn>} />}
      {list.map((g) => (
        <div key={g.id} className="card col g8">
          <div className="row g10">
            <span style={{ fontSize: 28 }}>{g.shares > 1 ? '🧧' : (THEMES[g.theme] || THEMES.classic)[0]}</span>
            <span className="grow"><b dir="ltr">{amt(g.amount)} {g.asset}</b><small className="dim" style={{ display: 'block', fontSize: 12.5 }}>
              {t(`lock_${g.shares > 1 ? 'packet' : g.lock}`)}{g.recipient ? ` · ${g.recipient}` : ''}{g.shares > 1 ? ` · ${t('claimed_of', { n: g.claimed_shares, total: g.shares })}` : ''}</small></span>
            <Status status={g.status} />
          </div>
          {g.shares > 1 && <div className="prog"><i style={{ width: `${(g.claimed_shares / g.shares) * 100}%` }} /></div>}
          <div className="row g8">
            {g.code && <Btn kind="f" size="sm" className="grow" onClick={() => go(`/gift/${g.code}`)}>{t('details')}</Btn>}
            {g.status === 'active' && <Btn kind="s" size="sm" className="grow" icon="share" onClick={() => shareUrl(g.link, '🎁')}>{t('share')}</Btn>}
            {g.status === 'active' && <Btn kind="danger" size="sm" onClick={async () => {
              try { await api.post(`/api/gifts/${g.id}/cancel`); toast(t('status_refunded'), 'ok'); load(); loadWallet(); } catch (e) { toast(errText(t, e), 'error'); }
            }}>{t('cancel_gift')}</Btn>}
          </div>
        </div>
      ))}
    </Page>
  );
}
