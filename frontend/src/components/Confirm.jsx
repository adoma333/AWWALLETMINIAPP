import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { errText, useI18n } from '../i18n';
import { useApp } from '../store';
import { bioAuth, haptic } from '../telegram';
import Icon from './Icon';
import { Btn, Keypad, PinDots, Sheet } from './ui';

// Confirmation for money actions (design sheet "Confirm"): a clear summary first, then biometrics or the 6-digit PIN.
// ask({ title, summary, head, rows, cta }) → { pin } | { bio } | null. Without a PIN yet, the user creates one here.
const Ctx = createContext(null);
export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }) {
  const { t } = useI18n();
  const { me, refresh } = useApp();
  const [state, setState] = useState(null); // { ...opts, resolve, mode: 'review'|'enter'|'create'|'repeat' }
  const [pin, setPin] = useState('');
  const [first, setFirst] = useState('');
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(false);
  const busy = useRef(false);
  const bio = Boolean(me?.bio_enabled);

  const pinMode = useCallback(() => (me?.pin_set ? 'enter' : 'create'), [me]);
  const ask = useCallback((opts = {}) => new Promise((resolve) => {
    setPin(''); setFirst(''); setErr('');
    setState({ ...opts, resolve, mode: opts.rows || opts.head ? 'review' : pinMode() });
  }), [pinMode]);

  // the summary already showed everything and asked for no PIN yet; biometrics first when the user enabled them
  useEffect(() => {
    if (state?.mode === 'enter' && bio && !state.bioTried) {
      setState((s) => ({ ...s, bioTried: true }));
      bioAuth(t('biometric_reason')).then((tok) => { if (tok) finish({ bio: tok }); });
    }
  }, [state?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const press = (k) => setPin((p) => (k === 'del' ? p.slice(0, -1) : p.length < 6 ? p + k : p));
  const heading = !state ? '' : state.mode === 'enter' ? t('enter_pin') : state.mode === 'create' ? t('new_pin') : t('confirm_pin');

  return (
    <Ctx.Provider value={ask}>
      {children}
      <Sheet open={Boolean(state)} onClose={() => finish(null)}>
        {state?.mode === 'review' ? (
          <>
            {state.head}
            {state.rows?.length > 0 && <div className="card s2 tight">{state.rows.map(([k, v], i) => <div key={i} className="kv"><span>{k}</span><b>{v}</b></div>)}</div>}
            {bio && (
              <div className="col center g8" style={{ padding: '8px 0 2px' }}>
                <span className="ic lg"><Icon name="finger" size={32} /></span>
                <span className="dim small">{t('confirm_with_bio')}</span>
              </div>
            )}
            <Btn w onClick={async () => {
              if (bio) { const tok = await bioAuth(t('biometric_reason')); if (tok) { finish({ bio: tok }); return; } }
              setState((s) => ({ ...s, mode: pinMode(), bioTried: true }));
            }}>{state.cta || t('confirm')}</Btn>
            {bio && <Btn kind="ghost" w onClick={() => setState((s) => ({ ...s, mode: pinMode(), bioTried: true }))}>{t('use_pin')}</Btn>}
          </>
        ) : state && (
          <div className="col center g12" style={{ paddingTop: 6 }}>
            <span className="ic lg"><Icon name="lock" size={28} /></span>
            <b className="disp" style={{ fontSize: 20 }}>{heading}</b>
            {state.title && <span className="dim small">{state.title}</span>}
            {state.summary && <span className="small" style={{ textAlign: 'center' }}>{state.summary}</span>}
            <PinDots filled={pin.length} shake={shake} />
            <span className="bad small" style={{ minHeight: 18 }}>{err}</span>
            <div style={{ width: '100%', padding: '0 12px' }}>
              <Keypad dot={false} onKey={press} small
                left={state.mode === 'enter' && bio ? { node: <Icon name="finger" size={26} className="em" />, onClick: async () => {
                  const tok = await bioAuth(t('biometric_reason')); if (tok) finish({ bio: tok });
                } } : null} />
            </div>
          </div>
        )}
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
      if (e.code === 'pin_wrong') { haptic.error(); opts = { title: opts?.title, summary: errText(t, e) }; continue; } // eslint-disable-line no-param-reassign
      throw e;
    }
  }
}
