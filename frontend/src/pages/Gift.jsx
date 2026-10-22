import React, { useEffect, useRef, useState } from 'react';
import { api, idem } from '../api';
import { useConfirm, withConfirm } from '../components/Confirm';
import Icon, { CoinIcon } from '../components/Icon';
import Success, { celebrate } from '../components/Success';
import { useToast } from '../components/Toast';
import { AmountInput, AssetPicker, Avatar, Btn, Card, CopyField, Empty, Field, Page, Segmented, Status } from '../components/ui';
import { amt, inFuture } from '../format';
import { errText, useI18n } from '../i18n';
import { go, match } from '../router';
import { useApp } from '../store';
import { haptic, shareMessage, shareUrl } from '../telegram';

const THEMES = { classic: '🎁', birthday: '🎂', eid: '🌙', love: '💝', thanks: '🙏', ramadan: '🏮' };

export default function Gift({ path, query }) {
  if (path === '/gift/new') return <CreateGift query={query} />;
  if (path === '/gifts') return <MyGifts />;
  const m = match('/gift/:code', path);
  if (m) return <Claim code={m.code} />;
  return <CreateGift query={query} />;
}

function CreateGift({ query }) {
  const { t } = useI18n();
  const { wallet, loadWallet, me } = useApp();
  const ask = useConfirm();
  const toast = useToast();
  const [lock, setLock] = useState(query.lock || (query.to_id ? 'user' : 'open'));
  const [asset, setAsset] = useState(query.asset || 'USDT');
  const [amount, setAmount] = useState('');
  const [username, setUsername] = useState(query.username || '');
  const [password, setPassword] = useState('');
  const [shares, setShares] = useState(1);
  const [split, setSplit] = useState('equal');
  const [message, setMessage] = useState('');
  const [theme, setTheme] = useState('classic');
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gift, setGift] = useState(null);
  const key = useRef(idem());
  const a = wallet?.assets?.find((x) => x.id === asset);
  const create = async () => {
    setBusy(true);
    try {
      const body = { asset, amount, lock, message, theme, idem: key.current, shares: lock === 'open' ? shares : 1, split,
        recipient_id: query.to_id ? Number(query.to_id) : undefined, recipient_username: username, password };
      const g = await withConfirm(ask, t, (f) => api.post('/api/gifts', { ...body, ...f }), { title: `🎁 ${amt(amount)} ${asset}` });
      if (g) { setGift(g); loadWallet(); }
    } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };
  const sharePersonal = async () => {
    try {
      const r = await api.post(`/api/gifts/${gift.id}/share`);
      if (r.prepared_id && (await shareMessage(r.prepared_id))) { haptic.success(); return; }
      shareUrl(r.link, `🎁 ${me.name}: ${amt(gift.amount)} ${gift.asset}`);
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  if (gift) {
    return (
      <Page title="">
        <Success title={t('gift_created')} sub={`${THEMES[theme]} ${amt(gift.amount)} ${gift.asset}`}>
          {gift.lock === 'user' && <p className="dim small center">{t('gift_lock_note', { name: gift.recipient })}</p>}
          <Btn className="wide" onClick={sharePersonal}><Icon name="send" size={18} />{t('gift_share_personal')}</Btn>
          <CopyField value={gift.link} label={t('copy_link')} />
          <Btn kind="soft" className="wide" onClick={() => go('/gifts', true)}>{t('my_gifts')}</Btn>
        </Success>
      </Page>
    );
  }
  const locks = [
    ['user', 'lock_user', 'lock_user_sub', 'user'], ['username', 'lock_username', 'lock_username_sub', 'at'],
    ['password', 'lock_password', 'lock_password_sub', 'key'], ['open', 'lock_open', 'lock_open_sub', 'users'],
  ];
  return (
    <Page title={t('gift_title')} right={<button type="button" className="icon-btn" onClick={() => go('/gifts')}><Icon name="list" /></button>}>
      <div className={`gift-preview theme-${theme}`}><span className="gp-emoji">{THEMES[theme]}</span><b dir="ltr">{amount ? amt(amount) : '0'} {asset}</b><small>{message || t('gift_message_ph')}</small></div>
      <div className="themes">{Object.entries(THEMES).map(([k, e]) => <button key={k} type="button" className={theme === k ? 'on' : ''} onClick={() => setTheme(k)}>{e}<small>{t(`theme_${k}`)}</small></button>)}</div>
      <h2 className="h2">{t('gift_who')}</h2>
      <div className="lock-grid">
        {locks.map(([k, title, sub, ic]) => (
          <button key={k} type="button" className={`lock-opt ${lock === k ? 'on' : ''}`} onClick={() => { haptic.select(); setLock(k); }}>
            <Icon name={ic === 'at' ? 'user' : ic} size={20} /><b>{t(title)}</b><small>{t(sub)}</small>
          </button>
        ))}
      </div>
      {lock === 'user' && (query.to_id
        ? <Card className="person-card"><Avatar name={query.name} size={40} /><span className="nudge-text"><b>{query.name}</b><small>{t('lock_user_sub')}</small></span><Icon name="lock" size={18} /></Card>
        : <Btn kind="soft" className="wide" onClick={() => go('/send/contact?purpose=gift')}><Icon name="contacts" size={18} />{t('choose_recipient')}</Btn>)}
      {lock === 'username' && <Field label={t('lock_username')}><div className="input-row"><span className="prefix">@</span><input value={username} onChange={(e) => setUsername(e.target.value.replace(/^@/, ''))} dir="ltr" /></div></Field>}
      {lock === 'password' && <Field label={t('gift_password')}><input value={password} onChange={(e) => setPassword(e.target.value)} maxLength={40} /></Field>}
      {lock === 'open' && (
        <div className="row2">
          <Field label={t('shares')}><input type="number" min="1" max="200" value={shares} onChange={(e) => setShares(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} /></Field>
          {shares > 1 && <Field label=" "><Segmented value={split} onChange={setSplit} options={[['equal', t('split_equal')], ['random', t('split_random')]]} /></Field>}
        </div>
      )}
      <button type="button" className="asset-select" onClick={() => setPick(true)}><CoinIcon asset={asset} size={28} /><b>{asset}</b><Icon name="chevronDown" size={18} /></button>
      <AmountInput value={amount} onChange={setAmount} asset={asset} max={a?.available} usdPrice={a?.usd} display={a?.display} />
      <Field label={t('gift_message')}><input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={200} placeholder={t('gift_message_ph')} /></Field>
      <Btn className="wide" loading={busy} disabled={!Number(amount) || Number(amount) > Number(a?.available || 0) || (lock === 'user' && !query.to_id)} onClick={create}>
        <Icon name="gift" size={18} />{t('create_gift')}
      </Btn>
      <AssetPicker open={pick} onClose={() => setPick(false)} assets={wallet?.assets?.filter((x) => x.transfer)} onPick={(x) => setAsset(x.id)} />
    </Page>
  );
}

function Claim({ code }) {
  const { t } = useI18n();
  const { loadWallet } = useApp();
  const toast = useToast();
  const [g, setG] = useState(null);
  const [err, setErr] = useState(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => { api.get(`/api/gifts/view/${code}`).then(setG).catch(setErr); }, [code]);
  const claim = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/gifts/claim', { code, password: pw || undefined });
      setDone(r);
      celebrate();
      loadWallet();
    } catch (e) { haptic.error(); toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };
  if (err) return <Page title={t('gift_title')}><Empty icon="gift" title={errText(t, err)} /></Page>;
  if (!g) return <Page title={t('gift_title')}><div className="page-loading" /></Page>;
  if (done) {
    return (
      <Page title="">
        <Success title={t('claimed_success', { amount: amt(done.amount), asset: done.asset })} confetti={false}>
          <Btn className="wide" onClick={() => go('/', true)}>{t('done')}</Btn>
        </Success>
      </Page>
    );
  }
  return (
    <Page title={t('gift_title')}>
      <div className={`gift-open theme-${g.theme}`}>
        <span className="gp-emoji big">{THEMES[g.theme] || '🎁'}</span>
        {g.sender && <div className="go-from"><Avatar src={g.sender.photo} name={g.sender.name} size={36} /><b>{t('claim_title', { name: g.sender.name })}</b></div>}
        <div className="go-amount" dir="ltr"><CoinIcon asset={g.asset} size={30} />{amt(g.amount)} {g.asset}</div>
        {g.message && <p className="go-msg">“{g.message}”</p>}
        {g.shares > 1 && <small className="dim">{t('claimed_of', { n: g.claimed_shares, total: g.shares })}</small>}
        {g.status === 'active' && g.expires_at && <small className="dim">{t('expires_in', { when: inFuture(g.expires_at) })}</small>}
      </div>
      {g.claimed ? <Card className="ok-card"><Icon name="check" />{t('claimed_success', { amount: amt(g.claimed), asset: g.asset })}</Card>
        : g.can_claim ? (
          <>
            {g.lock === 'password' && <Field label={t('gift_password')}><input value={pw} onChange={(e) => setPw(e.target.value)} /></Field>}
            <Btn className="wide pulse-btn" loading={busy} onClick={claim}><Icon name="gift" size={18} />{t('claim_now')}</Btn>
          </>
        ) : <Card className="warn-card"><Icon name="lock" />{errText(t, { code: g.reason })}</Card>}
    </Page>
  );
}

function MyGifts() {
  const { t } = useI18n();
  const toast = useToast();
  const { loadWallet } = useApp();
  const [items, setItems] = useState(null);
  const load = () => api.get('/api/gifts').then((r) => setItems(r.items)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  return (
    <Page title={t('my_gifts')} right={<button type="button" className="icon-btn" onClick={() => go('/gift/new')}><Icon name="plus" /></button>}>
      {items?.length === 0 && <Empty icon="gift" title={t('send_gift_sub')} action={<Btn onClick={() => go('/gift/new')}>{t('create_gift')}</Btn>} />}
      {items?.map((g) => (
        <Card key={g.id} className="gift-item">
          <div className="gi-top"><CoinIcon asset={g.asset} size={30} /><b dir="ltr">{amt(g.amount)} {g.asset}</b><Status status={g.status} /></div>
          <small className="dim">{t(`lock_${g.lock}`)}{g.recipient ? ` · ${g.recipient}` : ''}{g.shares > 1 ? ` · ${t('claimed_of', { n: g.claimed_shares, total: g.shares })}` : ''}</small>
          {g.status === 'active' && (
            <div className="row2">
              <CopyField value={g.link} />
              <Btn kind="ghost" onClick={async () => { try { await api.post(`/api/gifts/${g.id}/cancel`); toast(t('status_refunded'), 'ok'); load(); loadWallet(); } catch (e) { toast(errText(t, e), 'error'); } }}>{t('cancel_gift')}</Btn>
            </div>
          )}
        </Card>
      ))}
    </Page>
  );
}
