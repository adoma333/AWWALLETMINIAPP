import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { errText, useI18n } from '../i18n';
import { useApp } from '../store';
import { bioAuth, haptic } from '../telegram';
import Icon from './Icon';
import { Sheet } from './ui';

// Second-factor confirmation for money actions: biometrics when enabled, otherwise the 6-digit PIN.
// If the user has no PIN yet, they create one here first (zero dead-ends).
const Ctx = createContext(null);
export const useConfirm = () => useContext(Ctx);

function PinPad({ value, onChange, onBio }) {
  const press = (d) => { haptic.select(); if (value.length < 6) onChange(value + d); };
  return (
    <div className="pinpad">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => <button key={d} type="button" onClick={() => press(String(d))}>{d}</button>)}
      <button type="button" className="pp-alt" onClick={onBio} disabled={!onBio} aria-label="biometric">{onBio ? <Icon name="fingerprint" /> : null}</button>
      <button type="button" onClick={() => press('0')}>0</button>
      <button type="button" className="pp-alt" onClick={() => { haptic.select(); onChange(value.slice(0, -1)); }} aria-label="delete">⌫</button>
    </div>
  );
}

function Dots({ n, shake }) {
  return <div className={`pin-dots ${shake ? 'shake' : ''}`}>{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className={i < n ? 'on' : ''} />)}</div>;
}

export function ConfirmProvider({ children }) {
  const { t } = useI18n();
  const { me, refresh } = useApp();
  const [state, setState] = useState(null); // {title, summary, resolve, mode: 'enter'|'create'|'repeat'}
  const [pin, setPin] = useState('');
  const [first, setFirst] = useState('');
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(false);
  const busy = useRef(false);

  const ask = useCallback(async ({ title, summary } = {}) => {
    if (me?.bio_enabled) {
      const token = await bioAuth(t('biometric_reason'));
      if (token) return { bio: token };
    }
    return new Promise((resolve) => {
      setPin(''); setFirst(''); setErr('');
      setState({ title, summary, resolve, mode: me?.pin_set ? 'enter' : 'create' });
    });
  }, [me, t]);

  const finish = (v) => { state?.resolve(v); setState(null); };
  const fail = (msg) => { setErr(msg); setShake(true); haptic.error(); setTimeout(() => setShake(false), 450); setPin(''); };

  useEffect(() => {
    if (!state || pin.length !== 6 || busy.current) return;
    (async () => {
      if (state.mode === 'enter') return finish({ pin });
      if (state.mode === 'create') { setFirst(pin); setPin(''); setErr(''); setState({ ...state, mode: 'repeat' }); return undefined; }
      if (pin !== first) { setState({ ...state, mode: 'create' }); return fail(t('pin_mismatch')); }
      busy.current = true;
      try {
        await api.post('/api/security/pin', { new_pin: pin });
        haptic.success();
        await refresh?.();
        finish({ pin });
      } catch (e) {
        setState({ ...state, mode: 'create' });
        fail(errText(t, e));
      } finally {
        busy.current = false;
      }
      return undefined;
    })();
  }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps

  const heading = !state ? '' : state.mode === 'enter' ? t('enter_pin') : state.mode === 'create' ? t('new_pin') : t('confirm_pin');
  return (
    <Ctx.Provider value={ask}>
      {children}
      <Sheet open={Boolean(state)} onClose={() => finish(null)}>
        <div className="confirm">
          {state?.title && <div className="confirm-title">{state.title}</div>}
          {state?.summary && <div className="confirm-summary">{state.summary}</div>}
          <div className="confirm-head"><Icon name="lock" size={18} /> {heading}</div>
          <Dots n={pin.length} shake={shake} />
          <div className="confirm-err">{err}</div>
          <PinPad value={pin} onChange={setPin}
            onBio={me?.bio_enabled ? async () => { const tok = await bioAuth(t('biometric_reason')); if (tok) finish({ bio: tok }); } : null} />
        </div>
      </Sheet>
    </Ctx.Provider>
  );
}

/** Run an API call that needs a PIN; re-prompts on a wrong PIN, surfaces other errors. */
export async function withConfirm(ask, t, call, opts) {
  for (;;) {
    const f = await ask(opts);
    if (!f) return null;
    try {
      return await call(f);
    } catch (e) {
      if (e.code === 'pin_wrong') { haptic.error(); opts = { ...opts, summary: errText(t, e) }; continue; } // eslint-disable-line no-param-reassign
      throw e;
    }
  }
}
