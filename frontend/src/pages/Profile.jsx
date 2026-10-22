import React, { Suspense, lazy, useEffect, useState } from 'react';
import { api } from '../api';
import { useConfirm, withConfirm } from '../components/Confirm';
import Icon, { CoinIcon, NetIcon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { Avatar, Badge, Btn, Card, Empty, Field, Page, Row, Segmented, Sheet, Toggle } from '../components/ui';
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

function Item({ icon, label, value, onClick, danger }) {
  return (
    <button type="button" className={`menu-item ${danger ? 'danger' : ''}`} onClick={() => { haptic.select(); onClick?.(); }}>
      <span className="mi-ic"><Icon name={icon} size={20} /></span><span className="mi-label">{label}</span>
      {value !== undefined && <span className="mi-value">{value}</span>}<Icon name="chevron" size={16} className="flip-rtl dim" />
    </button>
  );
}

function Home() {
  const { t, lang, setLang } = useI18n();
  const { me, config, setMe, loadWallet } = useApp();
  const toast = useToast();
  const [sheet, setSheet] = useState('');
  const [theme, setTheme] = useState(getThemePref());
  const cur = me.settings?.currency || 'USD';
  const saveSetting = async (k, v) => {
    try { const m = await api.patch('/api/me', { settings: { [k]: v } }); setMe(m); } catch (e) { toast(errText(t, e), 'error'); }
  };
  const tonConnect = async () => {
    const tc = await import('../tonconnect');
    try {
      if (me.ton_wallet) { await tc.disconnectTon(); } else { await tc.connectTon(); }
      const m = await api.get('/api/me');
      setMe(m);
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  return (
    <main className="page profile">
      <section className="profile-head">
        <Avatar src={me.photo} name={me.name} size={72} />
        <h1>{me.name}</h1>
        <small className="dim">{me.username ? `@${me.username}` : `ID ${me.id}`}</small>
        <div className="chips center">
          <Badge tone={me.kyc_level ? 'ok' : 'mute'} icon="shield">{t(`kyc_level_${me.kyc_level}`)}</Badge>
          <Badge icon="crown">{t('vip_level', { name: me.vip?.name })}</Badge>
        </div>
      </section>
      <div className="menu">
        <Item icon="history" label={t('history')} onClick={() => go('/history')} />
        <Item icon="gift" label={t('my_gifts')} onClick={() => go('/gifts')} />
        <Item icon="users" label={t('referral_title')} onClick={() => go('/referral')} />
        <Item icon="percent" label={`${t('fees_title')} · ${t('vip_title')}`} onClick={() => go('/fees')} />
        <Item icon="target" label={t('limits_title')} onClick={() => go('/settings/limits')} />
      </div>
      <div className="menu">
        <Item icon="shield" label={t('security')} value={me.pin_set ? '' : '!'} onClick={() => go('/settings/security')} />
        <Item icon="contacts" label={t('address_book')} onClick={() => go('/settings/addressbook')} />
        {config?.features?.ton_connect !== false && <Item icon="wallet" label={t('ton_wallet')} value={me.ton_wallet ? shortAddr(me.ton_wallet.address, 4) : t('connect_wallet')} onClick={tonConnect} />}
      </div>
      <div className="menu">
        <Item icon="globe" label={t('language')} value={LANGS.find(([c]) => c === lang)?.[1]} onClick={() => setSheet('lang')} />
        <Item icon="coins" label={t('currency')} value={cur} onClick={() => setSheet('cur')} />
        <Item icon={theme === 'light' ? 'sun' : 'moon'} label={t('theme')} value={t(`theme_${theme}`)} onClick={() => setSheet('theme')} />
        <Item icon="bell" label={t('notifications')} value={me.unread || ''} onClick={() => go('/notifications')} />
      </div>
      <div className="menu">
        <Item icon="headset" label={t('support_title')} onClick={() => go('/support')} />
        <Item icon="sparkle" label={t('forms_title')} onClick={() => go('/support/forms')} />
        {config?.channel_url && <Item icon="megaphone" label={t('channel')} onClick={() => openTelegramLink(config.channel_url)} />}
        {config?.terms_url && <Item icon="book" label={t('terms')} onClick={() => openLink(config.terms_url)} />}
        {config?.privacy_url && <Item icon="lock" label={t('privacy')} onClick={() => openLink(config.privacy_url)} />}
        {me.is_admin && <Item icon="settings" label={t('admin_panel')} onClick={() => { location.href = '/admin/'; }} />}
      </div>
      <p className="version dim">ZOHRA WALLET · {t('version')} {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : ''}</p>
      <Sheet open={sheet === 'lang'} onClose={() => setSheet('')} title={t('language')} tall>
        <div className="list">{LANGS.filter(([c]) => !config?.languages || config.languages.includes(c)).map(([c, n]) => (
          <button key={c} type="button" className={`net-row ${c === lang ? 'on' : ''}`} onClick={() => { setLang(c); setSheet(''); }}><b>{n}</b>{c === lang && <Icon name="check" size={18} />}</button>))}</div>
      </Sheet>
      <Sheet open={sheet === 'cur'} onClose={() => setSheet('')} title={t('currency')}>
        <div className="grid-chips">{(config?.currencies || ['USD']).map((c) => (
          <button key={c} type="button" className={`chip ${c === cur ? 'on' : ''}`} onClick={async () => { setFx(null, c); await saveSetting('currency', c); loadWallet(); setSheet(''); }}>{c}</button>))}</div>
      </Sheet>
      <Sheet open={sheet === 'theme'} onClose={() => setSheet('')} title={t('theme')}>
        <Segmented value={theme} onChange={(v) => { setTheme(v); setThemePref(v); }} options={[['dark', t('theme_dark')], ['light', t('theme_light')], ['auto', t('theme_auto')]]} />
      </Sheet>
    </main>
  );
}

function Security() {
  const { t } = useI18n();
  const { me, setMe } = useApp();
  const ask = useConfirm();
  const toast = useToast();
  const [bio, setBio] = useState(false);
  const [activity, setActivity] = useState([]);
  const [pinSheet, setPinSheet] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  useEffect(() => { bioAvailable().then(setBio); api.get('/api/security/activity').then((r) => setActivity(r.logins)).catch(() => {}); }, []);
  const refreshMe = async () => setMe(await api.get('/api/me'));
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
      toast(t('pin_set_ok'), 'ok'); setPinSheet(false); setOldPin(''); setNewPin(''); refreshMe();
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  const setWl = async (v) => {
    try {
      const body = { settings: { whitelist_only: v } };
      const m = v ? await api.patch('/api/me', body) : await withConfirm(ask, t, (f) => api.patch('/api/me', { ...body, ...f }), { title: t('whitelist_only') });
      if (m) setMe(m);
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  return (
    <Page title={t('security')}>
      {me.security_hold_until > Date.now() / 1000 && <Card className="warn-card strong"><Icon name="lock" />{t('hold_active', { date: dateTime(me.security_hold_until) })}</Card>}
      <div className="menu">
        <Item icon="key" label={t('pin_code')} value={me.pin_set ? '••••••' : t('set_pin')} onClick={() => (me.pin_set ? setPinSheet(true) : ask({ title: t('set_pin') }).then(refreshMe))} />
        {bio && me.pin_set && <div className="menu-item"><span className="mi-ic"><Icon name="fingerprint" size={20} /></span><Toggle label={t('biometric')} checked={me.bio_enabled} onChange={toggleBio} /></div>}
        <Item icon="phone" label={t('phone_verification')} value={me.phone || t('verify_phone')} onClick={async () => {
          if (me.phone) return;
          const r = await api.post('/api/security/phone');
          toast(t('phone_verify_note'));
          openTelegramLink(`https://t.me/${r.bot}`);
        }} />
        <Item icon="user" label={t('verify_identity')} value={t(`kyc_level_${me.kyc_level}`)} onClick={() => go('/settings/kyc')} />
        <Item icon="phone" label={t('devices_title')} onClick={() => go('/settings/devices')} />
      </div>
      <div className="menu"><div className="menu-item"><span className="mi-ic"><Icon name="shield" size={20} /></span>
        <Toggle label={t('whitelist_only')} sub={t('whitelist_only_sub')} checked={me.settings?.whitelist_only} onChange={setWl} /></div></div>
      <h2 className="h2">{t('login_activity')}</h2>
      {activity.map((a, i) => <div key={i} className="friend-row"><Icon name="phone" size={18} /><span className="ar-main"><b>{a.platform || 'Telegram'}</b><small>{timeAgo(a.created_at, t)}</small></span></div>)}
      <Sheet open={pinSheet} onClose={() => setPinSheet(false)} title={t('change_pin')}>
        <Field label={t('current_pin')}><input inputMode="numeric" maxLength={6} type="password" value={oldPin} onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label={t('new_pin')} hint={t('pin_change_hold')}><input inputMode="numeric" maxLength={6} type="password" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} /></Field>
        <Btn className="wide" disabled={oldPin.length !== 6 || newPin.length !== 6} onClick={changePin}>{t('save')}</Btn>
      </Sheet>
    </Page>
  );
}

function AddressBook() {
  const { t } = useI18n();
  const { config } = useApp();
  const ask = useConfirm();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [f, setF] = useState(null);
  const load = () => api.get('/api/addressbook').then((r) => setItems(r.items)).catch(() => {});
  useEffect(() => { load(); }, []);
  const save = async () => {
    try {
      const call = (x = {}) => api.post('/api/addressbook', { ...f, ...x });
      const r = f.whitelisted ? await withConfirm(ask, t, call, { title: t('whitelist') }) : await call();
      if (r) { setF(null); load(); haptic.success(); }
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  return (
    <Page title={t('address_book')} right={<button type="button" className="icon-btn" onClick={() => setF({ network: 'tron', address: '', memo: '', label: '', whitelisted: true })}><Icon name="plus" /></button>}>
      {items.length === 0 && <Empty icon="contacts" title={t('add_address')} />}
      {items.map((a) => (
        <Card key={a.id} className="ab-item">
          <NetIcon network={a.network} size={28} />
          <span className="ar-main"><b>{a.label || a.network}</b><small className="mono">{shortAddr(a.address, 10)}</small></span>
          {a.whitelisted ? <Icon name="shield" size={16} className="ok-ic" /> : null}
          <button type="button" className="icon-btn" onClick={async () => { await api.del(`/api/addressbook/${a.id}`); load(); }}><Icon name="trash" size={18} /></button>
        </Card>
      ))}
      <Sheet open={Boolean(f)} onClose={() => setF(null)} title={t('add_address')} tall>
        {f && (
          <>
            <Field label={t('network')}><select value={f.network} onChange={(e) => setF({ ...f, network: e.target.value })}>{(config?.networks || []).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></Field>
            <Field label={t('address')}><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value.trim() })} dir="ltr" className="mono" /></Field>
            {f.network === 'ton' && <Field label={t('memo')}><input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></Field>}
            <Field label={t('label')}><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
            <Toggle label={t('whitelist')} checked={f.whitelisted} onChange={(v) => setF({ ...f, whitelisted: v })} />
            <Btn className="wide" onClick={save} disabled={f.address.length < 20}>{t('save')}</Btn>
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
  const bar = (used, lim) => <div className="progress"><span style={{ width: `${Math.min(100, (Number(used) / Number(lim || 1)) * 100)}%` }} /></div>;
  return (
    <Page title={t('limits_title')}>
      <Card><Row label={t('verification_level')} value={t(`kyc_level_${me.kyc_level}`)} strong /></Card>
      {l && [['withdraw', 'daily_withdraw'], ['transfer', 'daily_transfer'], ['p2p', 'daily_p2p']].map(([k, label]) => (
        <Card key={k} className="limit-card"><div className="ms-top"><b>{t(label)}</b><small>{t('used_of', { used: fiat(l[`${k}_used`]), limit: fiat(l[`${k}_daily`]) })}</small></div>{bar(l[`${k}_used`], l[`${k}_daily`])}</Card>
      ))}
      {me.kyc_level < 1 && <Btn className="wide" onClick={() => go('/settings/security')}>{t('verify_phone')}</Btn>}
    </Page>
  );
}

function Fees() {
  const { t } = useI18n();
  const [f, setF] = useState(null);
  useEffect(() => { api.get('/api/fees').then(setF).catch(() => {}); }, []);
  if (!f) return <Page title={t('fees_title')} />;
  return (
    <Page title={t('fees_title')}>
      <Card className="vip-card">
        <div className="vip-top"><Icon name="crown" /><b>{t('vip_level', { name: f.vip.name })}</b><span className="mini-badge ok">{t('vip_discount', { pct: f.vip.discount_pct })}</span></div>
        <div className="vip-tiers">{f.vip.tiers.map((x) => <div key={x.level} className={x.level === f.vip.level ? 'on' : ''}><b>{x.name}</b><small>≥ {fiat(x.min_volume_usd, 0)}</small><small>−{x.discount_pct}%</small></div>)}</div>
      </Card>
      <div className="kv-box">
        <Row label={t('send_to_user')} value={Number(f.transfer) ? `${f.transfer}%` : t('free')} />
        <Row label={t('gift_title')} value={Number(f.gift) ? `${f.gift}%` : t('free')} />
        <Row label={t('swap_title')} value={`${f.swap_pct}%`} />
        <Row label="P2P" value={`${f.p2p.maker_pct}% / ${f.p2p.taker_pct}%`} />
      </div>
      <h2 className="h2">{t('withdraw_title')}</h2>
      <div className="fee-table">
        {f.withdraw.map((w) => (
          <div key={`${w.asset}-${w.network}`} className="fee-row"><CoinIcon asset={w.asset} size={24} network={w.network} /><b>{w.asset}</b><small>{w.network}</small>
            <span dir="ltr">{Number(w.fee) ? `${amt(w.fee)}` : t('free')}{Number(w.pct) ? ` + ${w.pct}%` : ''}</span><small className="dim">min {w.min}</small></div>
        ))}
      </div>
    </Page>
  );
}

function GoogleLink({ onLinked }) {
  const { config } = useApp();
  const { t, lang } = useI18n();
  const toast = useToast();
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
  const toast = useToast();
  const [data, setData] = useState(null);
  const load = React.useCallback(() => api.get('/api/me/sessions').then(setData).catch(() => setData({ items: [], identities: [] })), []);
  useEffect(() => { load(); }, [load]);
  const google = data?.identities?.find((i) => i.provider === 'google');
  return (
    <Page title={t('devices_title')}>
      <h2 className="h2">{t('connected_accounts')}</h2>
      <div className="menu">
        <div className="menu-item"><span className="mi-ic"><Icon name="telegram" size={20} /></span><span className="mi-label">Telegram</span>
          <span className="mi-value">{inTelegram || data ? t('connected') : ''}</span></div>
        <div className="menu-item"><span className="mi-ic"><Icon name="globe" size={20} /></span><span className="mi-label">Google</span>
          <span className="mi-value">{google ? google.email : ''}</span></div>
      </div>
      {!google && data && <GoogleLink onLinked={load} />}
      <h2 className="h2">{t('signed_in_devices')}</h2>
      {data?.items?.length === 0 && <p className="dim small">{t('no_other_devices')}</p>}
      <div className="menu">
        {data?.items?.map((d) => (
          <div key={d.id} className="menu-item">
            <span className="mi-ic"><Icon name="phone" size={20} /></span>
            <span className="mi-label">{d.device || '—'}<small className="dim block">{d.id === data.current ? t('this_device') : timeAgo(d.last_seen, t)}</small></span>
            {d.id !== data.current && <button type="button" className="btn ghost small" onClick={async () => {
              await api.post(`/api/me/sessions/${d.id}/revoke`).catch(() => {}); toast(t('device_signed_out'), 'ok'); load();
            }}>{t('sign_out')}</button>}
          </div>
        ))}
      </div>
      {!inTelegram && (
        <Btn kind="danger" className="wide" onClick={async () => {
          await api.post('/api/logout').catch(() => {});
          setToken('');
          window.dispatchEvent(new Event('aw:signed-out'));
        }}>{t('sign_out')}</Btn>
      )}
    </Page>
  );
}

function Notifications() {
  const { t } = useI18n();
  const { setMe, me } = useApp();
  const [items, setItems] = useState(null);
  useEffect(() => {
    api.get('/api/notifications').then((r) => setItems(r.items)).catch(() => setItems([]));
    api.post('/api/notifications/read').then(() => setMe({ ...me, unread: 0 })).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Page title={t('notifications')}>
      {items?.length === 0 && <Empty icon="bell" title={t('no_notifications')} />}
      {items?.map((n) => (
        <button key={n.id} type="button" className={`notif ${n.read ? '' : 'unread'}`} onClick={() => n.ref && go(n.ref)}>
          <b>{n.title}</b>{n.body && <p>{n.body}</p>}<small>{timeAgo(n.created_at, t)}</small>
        </button>
      ))}
    </Page>
  );
}
