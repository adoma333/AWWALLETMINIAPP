import React, { useEffect, useState } from 'react';
import { api } from '../api';
import Icon from '../components/Icon';
import { ZMark } from '../components/Logo';
import { Avatar, Btn, Keypad, PinDots, Pill } from '../components/ui';
import { LANGS, errText, useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { bioAvailable, bioEnable, haptic } from '../telegram';

// Design sheet 01.3: zero-input welcome — name, photo and language come from Telegram, nothing to fill in.
export default function Onboarding() {
  const { t, lang } = useI18n();
  const { me, config } = useApp();
  const nets = config?.networks?.length || 0;
  const welcome = (me?.vouchers || []).find((v) => v.source === 'welcome');
  const langName = LANGS.find(([c]) => c === lang)?.[1] || lang;
  return (
    <main className="page has-bar" style={{ position: 'relative' }}>
      <div className="glow-bg" style={{ inset: '0 0 auto', height: 360, background: 'radial-gradient(70% 55% at 50% 20%,rgba(255,100,0,.2),transparent 70%)' }} />
      <div className="col center g12" style={{ paddingTop: 30, textAlign: 'center' }}>
        <div style={{ position: 'relative' }}>
          <Avatar src={me?.photo} name={me?.first_name || me?.name} size={96} />
          <span style={{ position: 'absolute', insetInlineEnd: -4, bottom: -4 }}><ZMark size={34} /></span>
        </div>
        <div className="h" style={{ fontSize: 27 }}>{t('welcome_name', { name: me?.first_name || me?.name || '' })} 👋</div>
        <div className="dim" style={{ fontSize: 14.5, maxWidth: 290 }}>{t('welcome_ready')}</div>
      </div>
      <div className="list">
        <div className="li"><span className="ic g"><Icon name="check" size={19} /></span>
          <span className="grow"><b>{t('welcome_account')}</b><small>{me?.username ? `@${me.username} · ` : ''}ID {String(me?.id || '').slice(0, 4)}…</small></span></div>
        <div className="li"><span className="ic g"><Icon name="globe" size={19} /></span>
          <span className="grow"><b>{t('welcome_lang', { lang: langName })}</b><small>{t('welcome_lang_sub')}</small></span><Pill tone="n">{lang.toUpperCase()}</Pill></div>
        <div className="li"><span className="ic g"><Icon name="wallet" size={19} /></span>
          <span className="grow"><b>{t('welcome_nets', { n: nets })}</b><small>{t('welcome_nets_sub')}</small></span></div>
        {welcome && <div className="li"><span className="ic"><Icon name="gift" size={19} /></span>
          <span className="grow"><b>{t('welcome_gift')}</b><small>{t('voucher_desc', { n: welcome.uses_left })}</small></span><Pill>{t('new')}</Pill></div>}
      </div>
      <div className="bar-bottom">
        {me?.pin_set ? <Btn w onClick={() => go('/', true)}>{t('get_started')}</Btn> : <>
          <Btn w onClick={() => go('/security/pin?next=/', true)}>{t('protect_wallet')}</Btn>
          <Btn kind="ghost" w onClick={() => go('/', true)}>{t('later')}</Btn>
        </>}
      </div>
    </main>
  );
}

const WEAK = new Set(['000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999', '123456', '654321',
  '123123', '112233', '121212', '012345', '098765', '456789', '987654']);
export const isWeakPin = (p) => WEAK.has(p) || /^(\d)\1{3,}/.test(p) || '0123456789012'.includes(p) || '9876543210987'.includes(p);

/** Design sheet 01.4: create a 6-digit PIN (weak PINs refused live), then offer Face ID / fingerprint. */
export function PinSetup({ query }) {
  const { t } = useI18n();
  const { refresh, toast } = useApp();
  const [step, setStep] = useState('create');
  const [first, setFirst] = useState('');
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [err, setErr] = useState('');
  const [bio, setBio] = useState(false);
  useEffect(() => { bioAvailable().then(setBio); }, []);
  const next = query?.next || '/settings/security';
  const weak = step === 'create' && pin.length === 6 && isWeakPin(pin);
  const bad = (m) => { setErr(m); setShake(true); haptic.error(); setTimeout(() => setShake(false), 450); setPin(''); };

  useEffect(() => {
    if (pin.length !== 6) return;
    if (step === 'create') {
      if (isWeakPin(pin)) { setTimeout(() => bad(t('err_pin_weak')), 300); return; }
      setTimeout(() => { setFirst(pin); setPin(''); setErr(''); setStep('repeat'); }, 250);
      return;
    }
    if (step === 'repeat') {
      if (pin !== first) { setStep('create'); bad(t('pin_mismatch')); return; }
      api.post('/api/security/pin', { new_pin: pin }).then(async () => {
        haptic.success();
        await refresh();
        if (bio) setStep('bio'); else { toast(t('pin_saved'), 'ok'); go(next, true); }
      }).catch((e) => { setStep('create'); bad(errText(t, e)); });
    }
  }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (step === 'bio') {
    return (
      <main className="page has-bar">
        <div className="col center g12" style={{ paddingTop: 70, textAlign: 'center' }}>
          <span className="ic xl"><Icon name="finger" size={42} stroke={1.8} /></span>
          <div className="h" style={{ fontSize: 22 }}>{t('bio_offer_title')}</div>
          <div className="dim" style={{ maxWidth: 290 }}>{t('bio_offer_sub')}</div>
        </div>
        <div className="bar-bottom">
          <Btn w onClick={async () => {
            const token = await bioEnable(t('biometric_reason'));
            if (token) {
              try { await api.post('/api/security/biometric', { enable: true, token, pin: first }); await refresh(); toast(t('bio_enabled'), 'ok'); } catch (e) { toast(errText(t, e), 'error'); }
            }
            go(next, true);
          }}>{t('bio_enable')}</Btn>
          <Btn kind="ghost" w onClick={() => go(next, true)}>{t('later')}</Btn>
        </div>
      </main>
    );
  }
  return (
    <main className="page" style={{ minHeight: '100vh' }}>
      <div className="col center g12" style={{ padding: '26px 12px 0', textAlign: 'center' }}>
        <span className="ic lg"><Icon name="lock" size={28} /></span>
        <div className="h" style={{ fontSize: 22 }}>{t(step === 'create' ? 'pin_create_title' : 'pin_repeat_title')}</div>
        <div className="dim" style={{ fontSize: 14 }}>{t('pin_create_sub')}</div>
        <div style={{ margin: '14px 0 6px' }}><PinDots filled={pin.length} shake={shake} /></div>
        <div style={{ minHeight: 24 }}>
          {err ? <span className="bad small">{err}</span>
            : step === 'create' && pin.length >= 4 && <Pill tone={weak ? 'r' : 'g'} icon={weak ? 'alert' : 'check'}>{t(weak ? 'pin_weak_live' : 'pin_strong_live')}</Pill>}
        </div>
      </div>
      <div style={{ marginTop: 'auto', padding: '0 18px 30px' }}>
        <Keypad dot={false} onKey={(k) => setPin((p) => (k === 'del' ? p.slice(0, -1) : p.length < 6 ? p + k : p))} />
      </div>
    </main>
  );
}
