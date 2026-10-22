import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import Icon from '../components/Icon';
import Logo from '../components/Logo';
import { Btn, QR } from '../components/ui';
import { LANGS, errText, useI18n } from '../i18n';
import { useRoute } from '../router';
import { deviceName, getToken, loadGoogle, openOutside, setToken, shell } from '../session';
import { useApp } from '../store';

// Sign-in for the standalone apps (web, Android, Windows, macOS). Inside Telegram this page is never shown.
//  • Telegram: a one-time code is approved in the bot chat with one tap; this page polls and receives its session.
//  • Google: Google Identity Services in a real browser. App shells (where Google blocks sign-in) hand off to the
//    system browser with a device code, which the browser approves after signing in.
//  • #/signin?device=<code> is that hand-off page: it approves the waiting app (signing in first if needed).

function usePoll(code, onDone) {
  useEffect(() => {
    if (!code) return undefined;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      try {
        const r = await api.post('/api/login/poll', { code });
        if (r.status === 'approved') { onDone(r); return; }
        if (r.status !== 'pending') { onDone(null, r.status); return; }
      } catch { /* offline: keep trying */ }
      setTimeout(tick, 2000);
    };
    const id = setTimeout(tick, 1500);
    return () => { alive = false; clearTimeout(id); };
  }, [code, onDone]);
}

function GoogleButton({ clientId, onCredential }) {
  const box = useRef(null);
  const { lang } = useI18n();
  useEffect(() => {
    let off = false;
    loadGoogle().then((g) => {
      if (off || !box.current) return;
      g.accounts.id.initialize({ client_id: clientId, callback: (r) => onCredential(r.credential), ux_mode: 'popup', use_fedcm_for_prompt: true });
      g.accounts.id.renderButton(box.current, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 300, locale: lang });
    }).catch(() => {});
    return () => { off = true; };
  }, [clientId, onCredential, lang]);
  return <div ref={box} className="gis-btn" />;
}

export default function Outside({ onSignedIn }) {
  const { t, lang, setLang } = useI18n();
  const { config } = useApp();
  const { query } = useRoute();
  const deviceCode = query.device || '';
  const [wait, setWait] = useState(null); // { code, url, kind }
  const [err, setErr] = useState('');
  const [device, setDevice] = useState(null);
  const google = config?.auth?.google_client_id;
  const bot = config?.bot;

  useEffect(() => {
    if (deviceCode) api.get(`/api/login/device?code=${encodeURIComponent(deviceCode)}`).then(setDevice).catch(() => setDevice({ pending: false }));
  }, [deviceCode]);

  const [, setSigned] = useState(0);
  const finish = useCallback((session) => {
    setToken(session.token);
    // on the hand-off page the user still has to confirm the waiting device explicitly (never automatic)
    if (deviceCode) setSigned((n) => n + 1);
    else onSignedIn?.();
  }, [deviceCode, onSignedIn]);

  const polled = useCallback((r, status) => {
    setWait(null);
    if (r) finish(r);
    else setErr(t(status === 'denied' ? 'signin_denied' : 'signin_expired'));
  }, [finish, t]);
  usePoll(wait?.code, polled);

  const start = async (kind) => {
    setErr('');
    try {
      const r = await api.post('/api/login/start', { kind, device: deviceName() });
      setWait({ ...r, kind });
      openOutside(r.url);
    } catch (e) { setErr(errText(t, e)); }
  };

  const onGoogle = useCallback(async (credential) => {
    setErr('');
    try { finish(await api.post('/api/login/google', { credential, device: deviceName() })); } catch (e) { setErr(errText(t, e)); }
  }, [deviceCode, finish, t]);

  if (device?.approved) {
    return (
      <main className="outside"><section className="outside-body center-screen">
        <span className="kyc-hero-ic"><Icon name="check" size={34} /></span>
        <h1>{t('device_approved')}</h1><p className="sub">{t('device_approved_sub')}</p>
      </section></main>
    );
  }

  return (
    <main className="outside">
      <div className="outside-top">
        <Logo height={20} />
        <select className="lang-select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="language">
          {LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      </div>
      <section className="outside-body">
        <h1>{t(deviceCode ? 'approve_device_title' : 'signin_title')}</h1>
        <p className="sub">{deviceCode ? (device?.pending ? t('approve_device_sub', { device: device.device }) : device ? t('signin_expired') : '…') : t('signin_sub')}</p>

        {deviceCode && getToken() && device?.pending && !wait ? (
          <div className="signin-actions">
            <div className="warn-card"><Icon name="alert" size={18} /><span>{t('approve_device_warn')}</span></div>
            <Btn className="wide" onClick={async () => {
              try { await api.post('/api/login/approve', { code: deviceCode }); setDevice({ pending: false, approved: true }); } catch (e) { setErr(errText(t, e)); }
            }}>{t('approve_device_btn')}</Btn>
          </div>
        ) : wait ? (
          <div className="signin-wait">
            {wait.kind === 'telegram' && !shell && <div className="outside-qr"><QR value={wait.url} size={196} logo={<Icon name="telegram" size={24} />} /><small>{t('signin_qr_hint')}</small></div>}
            <div className="fill-bar indeterminate"><i /></div>
            <p>{t(wait.kind === 'telegram' ? 'signin_wait_tg' : 'signin_wait_browser')}</p>
            <div className="row gap center">
              <Btn kind="ghost" onClick={() => openOutside(wait.url)}>{t(wait.kind === 'telegram' ? 'open_in_telegram' : 'signin_open_browser')}</Btn>
              <Btn kind="ghost" onClick={() => setWait(null)}>{t('cancel')}</Btn>
            </div>
          </div>
        ) : (
          <div className="signin-actions">
            {bot && <Btn className="wide tg-btn" onClick={() => start('telegram')}><Icon name="telegram" size={20} weight="fill" /> {t('signin_telegram')}</Btn>}
            {google && !shell && <GoogleButton clientId={google} onCredential={onGoogle} />}
            {google && shell && <Btn kind="secondary" className="wide" onClick={() => start('device')}><Icon name="globe" size={20} /> {t('signin_google')}</Btn>}
          </div>
        )}
        {err && <p className="err-text">{err}</p>}
        {!deviceCode && bot && !wait && (
          <a className="dim small" href={`https://t.me/${bot}?startapp=web`} onClick={(e) => { e.preventDefault(); openOutside(`https://t.me/${bot}?startapp=web`); }}>
            {t('signin_or_telegram_app')}
          </a>
        )}
        <ul className="perks">
          <li><Icon name="globe" size={18} />{t('perk1')}</li>
          <li><Icon name="bolt" size={18} />{t('perk2')}</li>
          <li><Icon name="shield" size={18} />{t('perk3')}</li>
        </ul>
      </section>
    </main>
  );
}
