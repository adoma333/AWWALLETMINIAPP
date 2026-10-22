import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import Icon from '../components/Icon';
import Logo, { ZMark } from '../components/Logo';
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
      <main className="state-screen">
        <div className="bgglow" />
        <span className="success-ring"><Icon name="check" size={46} stroke={3} /></span>
        <span className="h" style={{ fontSize: 24 }}>{t('device_approved')}</span>
        <span className="dim">{t('device_approved_sub')}</span>
      </main>
    );
  }

  const tgLink = bot ? `https://t.me/${bot}?startapp=web` : '';
  const browser = !shell && !deviceCode;
  return (
    <main className="outside">
      <div className="bgglow" />
      <div className="row between">
        <Logo height={18} />
        <label className="pill n lg" style={{ position: 'relative' }}>
          <Icon name="globe" size={13} /> {lang.toUpperCase()}
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="language"
            style={{ position: 'absolute', inset: 0, opacity: 0 }}>{LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
        </label>
      </div>

      <div className="col center g8" style={{ marginTop: 10, textAlign: 'center' }}>
        <div className="h" style={{ fontSize: 28 }}>{t(deviceCode ? 'approve_device_title' : browser ? 'outside_title' : 'signin_title')}</div>
        <div className="dim" style={{ fontSize: 14.5, maxWidth: 300 }}>
          {deviceCode ? (device?.pending ? t('approve_device_sub', { device: device.device }) : device ? t('signin_expired') : '…') : t(browser ? 'outside_sub' : 'signin_sub')}
        </div>
      </div>

      {deviceCode && getToken() && device?.pending && !wait ? (
        <div className="col g12">
          <div className="warn"><Icon name="alert" size={18} /><span>{t('approve_device_warn')}</span></div>
          <Btn w onClick={async () => {
            try { await api.post('/api/login/approve', { code: deviceCode }); setDevice({ pending: false, approved: true }); } catch (e) { setErr(errText(t, e)); }
          }}>{t('approve_device_btn')}</Btn>
        </div>
      ) : wait ? (
        <div className="col center g12">
          {wait.kind === 'telegram' && !shell && <><QR value={wait.url} size={210} logo={<span className="ic" style={{ background: '#2AABEE', color: '#fff', width: 40, height: 40 }}><Icon name="telegram" size={22} /></span>} /><span className="dim small">{t('signin_qr_hint')}</span></>}
          <div className="prog indet" style={{ width: 170 }}><i /></div>
          <span className="dim" style={{ textAlign: 'center' }}>{t(wait.kind === 'telegram' ? 'signin_wait_tg' : 'signin_wait_browser')}</span>
          <div className="row g8">
            <Btn kind="s" size="sm" icon={wait.kind === 'telegram' ? 'telegram' : 'external'} onClick={() => openOutside(wait.url)}>{t(wait.kind === 'telegram' ? 'open_in_telegram' : 'signin_open_browser')}</Btn>
            <Btn kind="ghost" size="sm" onClick={() => setWait(null)}>{t('cancel')}</Btn>
          </div>
        </div>
      ) : (
        <>
          {browser && tgLink && <QR value={tgLink} size={210} logo={<ZMark size={40} />} />}
          <div className="col g12">
            {browser && tgLink && <Btn w icon="telegram" onClick={() => openOutside(tgLink)}>{t('open_in_telegram')}</Btn>}
            {bot && <Btn w kind={browser ? 's' : 'p'} className={browser ? '' : 'tg-btn'} icon="telegram" onClick={() => start('telegram')}>{t(browser ? 'signin_in_browser' : 'signin_telegram')}</Btn>}
            {google && !shell && <GoogleButton clientId={google} onCredential={onGoogle} />}
            {google && shell && <Btn w kind="s" icon="globe" onClick={() => start('device')}>{t('signin_google')}</Btn>}
          </div>
        </>
      )}
      {err && <div className="warn r"><Icon name="alert" size={18} /><span>{err}</span></div>}

      {!deviceCode && !wait && (
        <div className="list">
          {[['bolt', t('perk_send')], ['globe', t('perk1')], ['shield', t('perk3')]].map(([i, x]) => (
            <div key={i} className="li"><span className="ic"><Icon name={i} size={19} /></span><span className="grow" style={{ fontSize: 14.5 }}>{x}</span></div>
          ))}
        </div>
      )}
    </main>
  );
}
