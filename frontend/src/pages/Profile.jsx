import React, { Suspense, lazy, useEffect, useState } from 'react';
import { api } from '../api';
import { useConfirm, withConfirm } from '../components/Confirm';
import Icon, { CoinIcon, NetIcon } from '../components/Icon';
import { Avatar, Btn, Empty, Field, HeadBtn, Input, Li, Page, Pill, Ring, Segmented, Sheet, Skeleton, Switch } from '../components/ui';
import { amt, dateTime, fiat, setFx, shortAddr, timeAgo } from '../format';
import { LANGS, errText, useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { bioAvailable, bioClear, bioEnable, haptic, inTelegram, openLink, openTelegramLink } from '../telegram';
import { getThemePref, setThemePref } from '../theme';
import { loadGoogle, setToken, shell } from '../session';

const KycPage = lazy(() => import('./Kyc'));

export default function Profile({ path }) {
  if (path === '/settings/security') return <Security />;
  if (path === '/settings/addressbook') return <AddressBook />;
  if (path === '/settings/limits') return <Limits />;
  if (path === '/settings/kyc') return <Suspense fallback={null}><KycPage /></Suspense>;
  if (path === '/fees') return <Fees />;
  if (path === '/notifications') return <Notifications />;
  if (path === '/settings/devices') return <Devices />;
  return <Home />;
}

const PLATFORM = { ios: 'iPhone', android: 'Android', tdesktop: 'Desktop', macos: 'Mac', web: 'Web', weba: 'Web', webk: 'Web', unigram: 'Windows' };
const platformName = (p) => PLATFORM[String(p || '').toLowerCase()] || p || 'Telegram';

const Row = ({ icon, tone = '', label, value, onClick, danger }) => (
  <Li icon={icon} tone={danger ? 'r' : tone} title={<span style={{ fontSize: 15 }} className={danger ? 'bad' : ''}>{label}</span>}
    right={value !== undefined && value !== null && value !== '' ? <span className="dim" style={{ fontSize: 13.5 }}>{value}</span> : null} chev={!!onClick} onClick={onClick} className="sm" />
);

function securityScore(me) {
  const items = [me.pin_set, me.bio_enabled, me.settings?.whitelist_only, Boolean(me.anti_phishing), Boolean(me.phone) || me.kyc_level >= 1];
  return { n: items.filter(Boolean).length, total: items.length };
}

/** Design sheet 05.6 — Profile: avatar, verification and VIP badges, next VIP progress, grouped settings. */
function Home() {
  const { t, lang, setLang } = useI18n();
  const { me, config, setMe, loadWallet, toast } = useApp();
  const [sheet, setSheet] = useState('');
  const [theme, setTheme] = useState(getThemePref());
  const [fees, setFees] = useState(null);
  const [lim, setLim] = useState(null);
  useEffect(() => {
    api.get('/api/fees', { silent: true }).then(setFees).catch(() => {});
    api.get('/api/limits', { silent: true }).then(setLim).catch(() => {});
  }, []);
  const cur = me.settings?.currency || 'USD';
  const sc = securityScore(me);
  const saveSetting = async (k, v) => {
    try { const m = await api.patch('/api/me', { settings: { [k]: v } }); setMe(m); } catch (e) { toast(errText(t, e), 'error'); }
  };
  const tonConnect = async () => {
    const tc = await import('../tonconnect');
    try {
      if (me.ton_wallet) { await tc.disconnectTon(); } else { await tc.connectTon(); }
      setMe(await api.get('/api/me'));
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  const vip = fees?.vip;
  return (
    <main className="page">
      <div className="col center g6" style={{ padding: '8px 0 2px' }}>
        <Avatar src={me.photo} name={me.first_name || me.name} size={76} seed={me.id} />
        <b className="disp" style={{ fontSize: 22 }}>{me.first_name || me.name}</b>
        <span className="dim xs" dir="ltr">{me.username ? `@${me.username}` : `ID ${me.id}`}</span>
        <span className="row g6">
          <button type="button" onClick={() => go('/settings/kyc')}><Pill tone={me.kyc_level ? 'g' : 'n'} icon={me.kyc_level ? 'shieldok' : 'idCard'}>{me.kyc_level ? t('verified') : t('not_verified')}</Pill></button>
          {me.vip && <button type="button" onClick={() => go('/fees')}><Pill tone="y" icon="crown">VIP {me.vip.name}</Pill></button>}
        </span>
      </div>
      {vip?.next && (
        <button type="button" className="card col g8" style={{ padding: '14px 16px' }} onClick={() => go('/fees')}>
          <div className="row between" style={{ fontSize: 13.5 }}><b>{t('vip_in_volume', { tier: vip.next.name, amount: fiat(Number(vip.next.min_volume_usd) - Number(vip.volume_30d), 0) })}</b>
            <span className="em">−{vip.next.discount_pct}% {t('fees_short')}</span></div>
          <div className="prog"><i style={{ width: `${Math.min(100, (Number(vip.volume_30d) / Number(vip.next.min_volume_usd)) * 100)}%` }} /></div>
        </button>
      )}
      <div className="list">
        <Row icon="shield" label={t('security_centre')} value={<Pill tone={sc.n >= 4 ? 'g' : sc.n >= 2 ? 'y' : 'r'}>{t(sc.n >= 4 ? 'sec_strong' : sc.n >= 2 ? 'sec_medium' : 'sec_weak')}</Pill>} onClick={() => go('/settings/security')} />
        <Row icon="sliders" label={t('limits_title')} value={lim ? `${fiat(lim.withdraw_daily, 0)} / ${t('day')}` : ''} onClick={() => go('/settings/limits')} />
        <Row icon="percent" label={t('fees_vip')} onClick={() => go('/fees')} />
        <Row icon="wallet" label={t('address_book')} onClick={() => go('/settings/addressbook')} />
        <Row icon="history" label={t('activity')} onClick={() => go('/history')} />
        {config?.features?.earn !== false && <Row icon="earn" label={t('earn')} onClick={() => go('/earn')} />}
        <Row icon="gift" label={t('my_gifts')} onClick={() => go('/gifts')} />
        <Row icon="users" label={t('invite_friends')} onClick={() => go('/referral')} />
      </div>
      <div className="list">
        <Row icon="globe" tone="n" label={t('language')} value={LANGS.find(([c]) => c === lang)?.[1]} onClick={() => setSheet('lang')} />
        <Row icon="dollar" tone="n" label={t('currency')} value={cur} onClick={() => setSheet('cur')} />
        <Row icon={theme === 'light' ? 'sun' : 'moon'} tone="n" label={t('appearance')} value={t(`theme_${theme}`)} onClick={() => setSheet('theme')} />
        <Row icon="bell" tone="n" label={t('notifications')} value={me.unread || ''} onClick={() => go('/notifications')} />
        {config?.features?.ton_connect !== false && <Row icon="wallet" tone="n" label={t('ton_wallet')} value={me.ton_wallet ? `${shortAddr(me.ton_wallet.address, 4)} ✓` : t('connect_wallet')} onClick={tonConnect} />}
        <Row icon="device" tone="n" label={t('devices_title')} onClick={() => go('/settings/devices')} />
      </div>
      <div className="list">
        <Row icon="bot" tone="n" label={config?.ai_name || 'Zohra AI'} value={t('online_247')} onClick={() => go('/support')} />
        <Row icon="headset" tone="n" label={t('support_title')} onClick={() => go('/support/tickets')} />
        {config?.channel_url && <Row icon="mega" tone="n" label={t('channel')} onClick={() => openTelegramLink(config.channel_url)} />}
        {config?.terms_url && <Row icon="book" tone="n" label={t('terms')} onClick={() => openLink(config.terms_url)} />}
        {config?.privacy_url && <Row icon="lock" tone="n" label={t('privacy')} onClick={() => openLink(config.privacy_url)} />}
        {me.is_admin && <Row icon="settings" tone="n" label={t('admin_panel')} onClick={() => { location.href = '/admin/'; }} />}
      </div>
      <p className="dim center xs" style={{ padding: '4px 0 8px' }}>ZOHRA WALLET · {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : ''}</p>
      <Sheet open={sheet === 'lang'} onClose={() => setSheet('')} title={t('language')} tall>
        <div className="list">{LANGS.filter(([c]) => !config?.languages || config.languages.includes(c)).map(([c, n]) => (
          <Li key={c} title={n} className="sm" onClick={() => { setLang(c); setSheet(''); }} right={c === lang ? <Icon name="check" size={18} className="em" /> : null} />))}</div>
      </Sheet>
      <Sheet open={sheet === 'cur'} onClose={() => setSheet('')} title={t('currency')}>
        <div className="chips" style={{ flexWrap: 'wrap' }}>{(config?.currencies || ['USD']).map((c) => (
          <button key={c} type="button" className={`chip ${c === cur ? 'oe' : ''}`} onClick={async () => { setFx(null, c); await saveSetting('currency', c); loadWallet(); setSheet(''); }}>{c}</button>))}</div>
      </Sheet>
      <Sheet open={sheet === 'theme'} onClose={() => setSheet('')} title={t('appearance')}>
        <Segmented value={theme} onChange={(v) => { setTheme(v); setThemePref(v); }} options={[['dark', t('theme_dark')], ['light', t('theme_light')], ['auto', t('theme_auto')]]} />
      </Sheet>
    </main>
  );
}

/** Design sheet 05.7 — security centre: score ring, PIN / biometrics / whitelist / anti-phishing / phone, sessions. */
function Security() {
  const { t } = useI18n();
  const { me, setMe, toast } = useApp();
  const ask = useConfirm();
  const [bio, setBio] = useState(false);
  const [sessions, setSessions] = useState(null);
  const [activity, setActivity] = useState([]);
  const [sheet, setSheet] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [code, setCode] = useState('');
  const loadSessions = () => api.get('/api/me/sessions', { silent: true }).then(setSessions).catch(() => setSessions({ items: [] }));
  useEffect(() => {
    bioAvailable().then(setBio);
    api.get('/api/security/activity', { silent: true }).then((r) => setActivity(r.logins)).catch(() => {});
    loadSessions();
  }, []);
  const refreshMe = async () => setMe(await api.get('/api/me'));
  const sc = securityScore(me);
  const toggleBio = async (on) => {
    try {
      if (on) {
        const token = await bioEnable(t('biometric_reason'));
        if (!token) return;
        const f = await ask({ title: t('biometric') });
        if (!f?.pin) return;
        await api.post('/api/security/biometric', { enable: true, token, pin: f.pin });
      } else {
        await bioClear();
        await api.post('/api/security/biometric', { enable: false });
      }
      await refreshMe();
      haptic.success();
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  const changePin = async () => {
    try {
      await api.post('/api/security/pin', { old_pin: oldPin, new_pin: newPin });
      toast(t('pin_set_ok'), 'ok'); setSheet(''); setOldPin(''); setNewPin(''); refreshMe();
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  const setWl = async (v) => {
    try {
      const body = { settings: { whitelist_only: v } };
      const m = v ? await api.patch('/api/me', body) : await withConfirm(ask, t, (f) => api.patch('/api/me', { ...body, ...f }), { title: t('whitelist_only') });
      if (m) { setMe(m); haptic.success(); }
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  const saveCode = async (value) => {
    try {
      const m = await withConfirm(ask, t, (f) => api.post('/api/security/anti-phishing', { code: value, ...f }), { title: t('anti_phishing') });
      if (m) { setMe(m); setSheet(''); setCode(''); haptic.success(); toast(t('saved'), 'ok'); }
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  const verifyPhone = async () => {
    if (me.phone) return;
    const r = await api.post('/api/security/phone');
    toast(t('phone_verify_note'));
    openTelegramLink(`https://t.me/${r.bot}`);
  };
  const next = !me.pin_set ? ['set_pin', () => go('/security/pin?next=/settings/security')] : !me.anti_phishing ? ['anti_phishing', () => setSheet('code')]
    : !me.settings?.whitelist_only ? ['whitelist_only', () => setWl(true)] : !(me.phone || me.kyc_level) ? ['phone_verification', verifyPhone] : null;
  const State = ({ on, label }) => <span className={on ? 'ok' : 'em'} style={{ fontSize: 13, fontWeight: 600 }}>{label || (on ? t('on') : t('set_up'))}</span>;
  return (
    <Page title={t('security')}>
      {me.security_hold_until > Date.now() / 1000 && <div className="warn r"><Icon name="lock" size={18} /><span>{t('hold_active', { date: dateTime(me.security_hold_until) })}</span></div>}
      <div className="card row g16" style={{ padding: 16 }}>
        <Ring pct={sc.n / sc.total} size={96} stroke={9}><span className="disp" style={{ fontSize: 24 }} dir="ltr">{sc.n}/{sc.total}</span></Ring>
        <span className="grow">
          <b className="disp" style={{ fontSize: 17, fontWeight: 600 }}>{t(sc.n >= 4 ? 'sec_strong_title' : sc.n >= 2 ? 'sec_medium_title' : 'sec_weak_title')}</b>
          <small className="dim" style={{ display: 'block', fontSize: 13, marginTop: 2 }}>{next ? t('sec_next_hint', { item: t(next[0]) }) : t('sec_all_done')}</small>
          {next && <Btn kind="f" size="sm" style={{ height: 32, marginTop: 8 }} onClick={next[1]}>{t('finish_setup')}</Btn>}
        </span>
      </div>
      <div className="list">
        <Li icon="lock" tone={me.pin_set ? 'g' : ''} className="sm" title={t('pin_code')} right={<State on={me.pin_set} label={me.pin_set ? t('change') : t('set_up')} />}
          onClick={() => (me.pin_set ? setSheet('pin') : go('/security/pin?next=/settings/security'))} />
        {bio && me.pin_set && <Li icon="finger" tone={me.bio_enabled ? 'g' : ''} className="sm" title={t('biometric')} right={<Switch on={me.bio_enabled} onChange={toggleBio} />} />}
        <Li icon="shieldok" tone={me.settings?.whitelist_only ? 'g' : ''} className="sm" title={t('whitelist_only')} sub={t('whitelist_only_sub')} right={<Switch on={me.settings?.whitelist_only} onChange={setWl} />} />
        <Li icon="key" tone={me.anti_phishing ? 'g' : ''} className="sm" title={t('anti_phishing')} sub={t('anti_phishing_sub')}
          right={<State on={Boolean(me.anti_phishing)} label={me.anti_phishing || t('set_up')} />} onClick={() => setSheet('code')} />
        <Li icon="phone" tone={me.phone ? 'g' : ''} className="sm" title={t('phone_verification')} right={<State on={Boolean(me.phone)} label={me.phone || t('verify')} />} onClick={verifyPhone} />
        <Li icon="idCard" tone={me.kyc_level >= 2 ? 'g' : ''} className="sm" title={t('verify_identity')} right={<span className="dim" style={{ fontSize: 13 }}>{t(`kyc_level_${me.kyc_level}`)}</span>} chev onClick={() => go('/settings/kyc')} />
      </div>
      <div className="h2"><span>{t('active_sessions')}</span>{sessions?.items?.some((d) => d.id !== sessions.current) && <button type="button" onClick={async () => {
        for (const d of sessions.items.filter((x) => x.id !== sessions.current)) await api.post(`/api/me/sessions/${d.id}/revoke`).catch(() => {});
        haptic.success(); toast(t('device_signed_out'), 'ok'); loadSessions();
      }}>{t('end_others')}</button>}</div>
      <div className="list">
        <Li icon="device" tone="n" className="sm" title={inTelegram ? `Telegram · ${platformName(window.Telegram?.WebApp?.platform)}` : t('this_device')} sub={t('now')} right={<Pill tone="g">{t('this_device')}</Pill>} />
        {(sessions?.items || []).filter((d) => d.id !== sessions.current).map((d) => (
          <Li key={d.id} icon="device" tone="n" className="sm" title={d.device || '—'} sub={timeAgo(d.last_seen, t)}
            right={<button type="button" onClick={async () => { await api.post(`/api/me/sessions/${d.id}/revoke`).catch(() => {}); toast(t('device_signed_out'), 'ok'); loadSessions(); }}><Pill tone="r">{t('end')}</Pill></button>} />
        ))}
      </div>
      {activity.length > 0 && (
        <>
          <div className="h2"><span>{t('login_activity')}</span></div>
          <div className="list">{activity.slice(0, 6).map((a, i) => <Li key={i} icon="activity" tone="n" className="sm" title={`Telegram · ${platformName(a.platform)}`} sub={dateTime(a.created_at)} />)}</div>
        </>
      )}
      <Sheet open={sheet === 'pin'} onClose={() => setSheet('')} title={t('change_pin')}>
        <Field label={t('current_pin')}><input inputMode="numeric" maxLength={6} type="password" value={oldPin} onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label={t('new_pin')} hint={t('pin_change_hold')}><input inputMode="numeric" maxLength={6} type="password" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} /></Field>
        <Btn w disabled={oldPin.length !== 6 || newPin.length !== 6} onClick={changePin}>{t('save')}</Btn>
      </Sheet>
      <Sheet open={sheet === 'code'} onClose={() => setSheet('')} title={t('anti_phishing')}>
        <span className="dim small center">{t('anti_phishing_explain')}</span>
        <div className="card s2" style={{ fontSize: 13.5, lineHeight: 1.5 }}>🔐 <b>{code || t('your_code')}</b><br />{t('anti_phishing_example')}</div>
        <Input icon="key" value={code} onChange={(e) => setCode(e.target.value.replace(/[<>&]/g, '').slice(0, 20))} placeholder={t('anti_phishing_ph')} />
        <Btn w disabled={code.trim().length < 3} onClick={() => saveCode(code.trim())}>{t('save')}</Btn>
        {me.anti_phishing && <Btn w kind="danger" onClick={() => saveCode('')}>{t('remove')}</Btn>}
      </Sheet>
    </Page>
  );
}

function AddressBook() {
  const { t } = useI18n();
  const { config, toast } = useApp();
  const ask = useConfirm();
  const [items, setItems] = useState(null);
  const [f, setF] = useState(null);
  const load = () => api.get('/api/addressbook').then((r) => setItems(r.items)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  const save = async () => {
    try {
      const call = (x = {}) => api.post('/api/addressbook', { ...f, ...x });
      const r = f.whitelisted ? await withConfirm(ask, t, call, { title: t('trusted_address') }) : await call();
      if (r) { setF(null); load(); haptic.success(); }
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  const add = () => setF({ network: 'tron', address: '', memo: '', label: '', whitelisted: true });
  return (
    <Page title={t('address_book')} right={<HeadBtn icon="plus" onClick={add} label={t('add_address')} />}>
      {!items && <Skeleton h={160} r={22} />}
      {items?.length === 0 && <Empty icon="contacts" title={t('no_addresses')} sub={t('no_addresses_sub')} action={<Btn size="sm" icon="plus" onClick={add}>{t('add_address')}</Btn>} />}
      {items?.length > 0 && (
        <div className="list">
          {items.map((x) => (
            <Li key={x.id} lead={<NetIcon network={x.network} size={36} />} title={x.label || config?.networks?.find((n) => n.id === x.network)?.name || x.network}
              sub={<span className="mono" dir="ltr">{shortAddr(x.address, 8)}</span>}
              right={<span className="row g6">{x.whitelisted ? <Pill tone="g" icon="shieldok">{t('trusted')}</Pill> : null}
                <button type="button" className="ic xs r" aria-label={t('delete')} onClick={async () => { await api.del(`/api/addressbook/${x.id}`); load(); }}><Icon name="trash" size={15} /></button></span>}
              onClick={() => go(`/withdraw?address=${encodeURIComponent(x.address)}&network=${x.network}${x.memo ? `&memo=${encodeURIComponent(x.memo)}` : ''}`)} />
          ))}
        </div>
      )}
      <div className="note"><Icon name="shieldok" size={15} /><span>{t('trusted_note')}</span></div>
      <Sheet open={Boolean(f)} onClose={() => setF(null)} title={t('add_address')} tall>
        {f && (
          <>
            <Field label={t('network')}><select value={f.network} onChange={(e) => setF({ ...f, network: e.target.value })}>{(config?.networks || []).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></Field>
            <Field label={t('address')}><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value.trim() })} dir="ltr" className="mono" /></Field>
            {(f.network === 'ton' || config?.networks?.find((n) => n.id === f.network)?.memo) && <Field label={t('memo')}><input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder={t('optional')} /></Field>}
            <Field label={t('label')}><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder={t('label_ph')} /></Field>
            <div className="list"><Li className="sm" icon="shieldok" tone="g" title={t('trusted_address')} sub={t('trusted_address_sub')} right={<Switch on={f.whitelisted} onChange={(v) => setF({ ...f, whitelisted: v })} />} /></div>
            <Btn w onClick={save} disabled={f.address.length < 20}>{t('save')}</Btn>
          </>
        )}
      </Sheet>
    </Page>
  );
}

function Limits() {
  const { t } = useI18n();
  const { me } = useApp();
  const [l, setL] = useState(null);
  useEffect(() => { api.get('/api/limits').then(setL).catch(() => {}); }, []);
  return (
    <Page title={t('limits_title')}>
      <div className="card row g12">
        <span className={`ic ${me.kyc_level ? 'g' : 'n'}`}><Icon name={me.kyc_level ? 'shieldok' : 'idCard'} size={19} /></span>
        <span className="grow"><small className="dim" style={{ fontSize: 12.5 }}>{t('verification_level')}</small><b style={{ display: 'block', fontSize: 15 }}>{t(`kyc_level_${me.kyc_level}`)}</b></span>
        {me.kyc_level < 2 && <Btn size="sm" kind="f" onClick={() => go('/settings/kyc')}>{t('raise_limits')}</Btn>}
      </div>
      {!l && <Skeleton h={220} r={22} />}
      {l && [['withdraw', 'daily_withdraw', 'up'], ['transfer', 'daily_transfer', 'send'], ['p2p', 'daily_p2p', 'p2p']].map(([k, label, ic]) => {
        const used = Number(l[`${k}_used`] || 0);
        const lim = Number(l[`${k}_daily`] || 0);
        return (
          <div key={k} className="card col g8">
            <div className="row between"><b className="row g8" style={{ fontSize: 14.5 }}><Icon name={ic} size={17} className="em" />{t(label)}</b>
              <span className="dim" style={{ fontSize: 13 }} dir="ltr">{fiat(used, 0)} / {fiat(lim, 0)}</span></div>
            <div className="prog"><i style={{ width: `${Math.min(100, (used / (lim || 1)) * 100)}%` }} /></div>
            <small className="dim" style={{ fontSize: 12 }}>{t('left_today', { amount: fiat(Math.max(0, lim - used), 0) })}</small>
          </div>
        );
      })}
    </Page>
  );
}

function Fees() {
  const { t } = useI18n();
  const [f, setF] = useState(null);
  useEffect(() => { api.get('/api/fees').then(setF).catch(() => {}); }, []);
  if (!f) return <Page title={t('fees_vip')}><Skeleton h={200} r={22} /></Page>;
  const v = f.vip;
  return (
    <Page title={t('fees_vip')}>
      <div className="card glow col g10">
        <div className="row between"><b className="row g6 disp" style={{ fontSize: 18 }}><Icon name="crown" size={18} className="gold" />VIP {v.name}</b><Pill tone="g">−{v.discount_pct}%</Pill></div>
        {v.next && <><div className="prog"><i style={{ width: `${Math.min(100, (Number(v.volume_30d) / Number(v.next.min_volume_usd)) * 100)}%` }} /></div>
          <small className="dim" style={{ fontSize: 12.5 }}>{t('vip_progress', { amount: fiat(Number(v.next.min_volume_usd) - Number(v.volume_30d)), tier: v.next.name })}</small></>}
        <div className="row g6" style={{ overflowX: 'auto' }}>
          {v.tiers.map((x) => (
            <div key={x.level} className={`opt-tile ${x.level === v.level ? 'on' : ''}`} style={{ minWidth: 92, textAlign: 'center', padding: '10px 8px' }}>
              <b style={{ margin: 0 }}>{x.name}</b><small style={{ display: 'block' }}>≥ {fiat(x.min_volume_usd, 0)}</small><small className="ok" style={{ display: 'block' }}>−{x.discount_pct}%</small>
            </div>
          ))}
        </div>
      </div>
      <div className="card tight">
        <div className="kv"><span>{t('send_to_user')}</span><b className={Number(f.transfer) ? '' : 'ok'}>{Number(f.transfer) ? `${f.transfer}%` : t('free')}</b></div>
        <div className="kv"><span>{t('gift_title')}</span><b className={Number(f.gift) ? '' : 'ok'}>{Number(f.gift) ? `${f.gift}%` : t('free')}</b></div>
        <div className="kv"><span>{t('action_swap')}</span><b>{t('included_in_rate')}</b></div>
        <div className="kv"><span>P2P</span><b dir="ltr">{f.p2p.maker_pct}% / {f.p2p.taker_pct}%</b></div>
      </div>
      <div className="h2"><span>{t('withdraw_fees')}</span></div>
      <div className="list">
        {f.withdraw.map((w) => (
          <Li key={`${w.asset}-${w.network}`} lead={<CoinIcon asset={w.asset} size={34} network={w.network} />} className="sm" title={w.asset} sub={w.network_name || w.network}
            right={<span className="r" dir="ltr"><b className={Number(w.fee) || Number(w.pct) ? '' : 'ok'}>{Number(w.fee) ? amt(w.fee) : t('free')}{Number(w.pct) ? ` + ${w.pct}%` : ''}</b><small>min {w.min}</small></span>} />
        ))}
      </div>
    </Page>
  );
}

function GoogleLink({ onLinked }) {
  const { config, toast } = useApp();
  const { t, lang } = useI18n();
  const box = React.useRef(null);
  const cid = config?.auth?.google_client_id;
  useEffect(() => {
    if (!cid || inTelegram || shell) return undefined;
    let off = false;
    loadGoogle().then((g) => {
      if (off || !box.current) return;
      g.accounts.id.initialize({ client_id: cid, ux_mode: 'popup', callback: async (r) => {
        try { await api.post('/api/me/link/google', { credential: r.credential }); toast(t('google_linked'), 'ok'); onLinked(); } catch (e) { toast(errText(t, e), 'error'); }
      } });
      g.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: lang });
    }).catch(() => {});
    return () => { off = true; };
  }, [cid, lang, onLinked, t, toast]);
  if (!cid) return null;
  if (inTelegram || shell) return <p className="dim small">{t('link_google_hint')}</p>;
  return <div ref={box} className="gis-btn" />;
}

function Devices() {
  const { t } = useI18n();
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const load = React.useCallback(() => api.get('/api/me/sessions').then(setData).catch(() => setData({ items: [], identities: [] })), []);
  useEffect(() => { load(); }, [load]);
  const google = data?.identities?.find((i) => i.provider === 'google');
  return (
    <Page title={t('devices_title')}>
      <div className="h2"><span>{t('connected_accounts')}</span></div>
      <div className="list">
        <Li icon="telegram" tone="b" className="sm" title="Telegram" right={<Pill tone="g" icon="check">{t('connected')}</Pill>} />
        <Li icon="globe" tone="n" className="sm" title="Google" right={google ? <span className="dim" style={{ fontSize: 13 }}>{google.email}</span> : null} />
      </div>
      {!google && data && <GoogleLink onLinked={load} />}
      <div className="h2"><span>{t('signed_in_devices')}</span></div>
      {data?.items?.length === 0 && <div className="note"><Icon name="device" size={15} /><span>{t('no_other_devices')}</span></div>}
      {data?.items?.length > 0 && (
        <div className="list">
          {data.items.map((d) => (
            <Li key={d.id} icon="device" tone="n" className="sm" title={d.device || '—'} sub={d.id === data.current ? t('this_device') : timeAgo(d.last_seen, t)}
              right={d.id !== data.current ? <button type="button" onClick={async () => { await api.post(`/api/me/sessions/${d.id}/revoke`).catch(() => {}); toast(t('device_signed_out'), 'ok'); load(); }}>
                <Pill tone="r">{t('sign_out')}</Pill></button> : <Pill tone="g">{t('this_device')}</Pill>} />
          ))}
        </div>
      )}
      {!inTelegram && (
        <Btn kind="danger" w onClick={async () => {
          await api.post('/api/logout').catch(() => {});
          setToken('');
          window.dispatchEvent(new Event('aw:signed-out'));
        }}>{t('sign_out')}</Btn>
      )}
    </Page>
  );
}

const N_CAT = {
  money: /^(deposit|received|withdraw|gift|request|split|earn|autoinvest|referral_earned|reward|price_alert)/,
  p2p: /^p2p_/, security: /^(pin_|kyc_|login|new_device|security)/,
};
const N_ICON = [[/^deposit|^received|^request_paid/, 'down', 'g'], [/^withdraw/, 'up', ''], [/^p2p/, 'p2p', ''], [/^gift|^split/, 'gift', ''],
  [/^pin|^kyc|^login|^security/, 'shield', 'r'], [/^earn|^autoinvest/, 'percent', 'b'], [/^price_alert/, 'bell', 'y'], [/^referral|^reward/, 'star', 'y'], [/^ticket/, 'headset', 'n']];
const nIcon = (k) => N_ICON.find(([re]) => re.test(k || '')) || ['mega', 'n'];
const ago = (ts) => {
  const s = Math.max(1, Date.now() / 1000 - ts);
  return s < 3600 ? `${Math.ceil(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};

/** Design sheet 05.4 — notifications grouped by category, unread dots, tap to open, read all. */
function Notifications() {
  const { t } = useI18n();
  const { setMe, me } = useApp();
  const [items, setItems] = useState(null);
  const [cat, setCat] = useState('all');
  useEffect(() => { api.get('/api/notifications').then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  const readAll = async () => {
    await api.post('/api/notifications/read', {}).catch(() => {});
    setItems((x) => (x || []).map((n) => ({ ...n, read: 1 })));
    setMe({ ...me, unread: 0 });
    haptic.success();
  };
  const open = (n) => {
    if (!n.read) {
      api.post('/api/notifications/read', { id: n.id }).catch(() => {});
      setMe({ ...me, unread: Math.max(0, (me.unread || 1) - 1) });
    }
    if (n.ref) go(n.ref);
  };
  const catOf = (k) => Object.entries(N_CAT).find(([, re]) => re.test(k || ''))?.[0] || 'news';
  const list = (items || []).filter((n) => cat === 'all' || catOf(n.kind) === cat);
  const unread = (items || []).some((n) => !n.read);
  return (
    <Page title={t('notifications')} right={unread ? <button type="button" className="em" style={{ fontSize: 13, fontWeight: 600 }} onClick={readAll}>{t('read_all')}</button> : null}>
      <div className="chips">
        {[['all', t('all')], ['money', t('n_money')], ['p2p', 'P2P'], ['security', t('security')], ['news', t('n_news')]]
          .map(([k, l]) => <button key={k} type="button" className={`chip ${cat === k ? 'on' : ''}`} onClick={() => setCat(k)}>{l}</button>)}
      </div>
      {!items && <Skeleton h={300} r={22} />}
      {items && list.length === 0 && <Empty icon="bell" title={t('no_notifications')} sub={t('no_notifications_sub')} />}
      {list.length > 0 && (
        <div className="list">
          {list.map((n) => {
            const [, ic, tone] = nIcon(n.kind);
            return (
              <button key={n.id} type="button" className="li" style={{ alignItems: 'flex-start' }} onClick={() => open(n)}>
                <span className={`ic ${tone}`}><Icon name={ic} size={18} /></span>
                <span className="grow"><b style={{ fontSize: 14.5 }}>{n.title}</b>{n.body && <small style={{ lineHeight: 1.4 }}>{n.body}</small>}</span>
                <span className="col" style={{ alignItems: 'flex-end', gap: 6 }}><small className="dim" style={{ fontSize: 11.5 }}>{ago(n.created_at)}</small>
                  {!n.read && <i style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--flame)' }} />}</span>
              </button>
            );
          })}
        </div>
      )}
    </Page>
  );
}
