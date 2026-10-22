import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import Icon from '../components/Icon';
import { Btn, Empty, Field, Li, Page, Pill, Skeleton } from '../components/ui';
import { errText, useI18n } from '../i18n';
import { ocrWorker, readMrz, stopOcr } from '../kyc/ocr';
import Scanner from '../kyc/Scanner';
import { useApp } from '../store';

// Identity verification: the camera finds the document, captures it when it is sharp and still, reads the MRZ on the
// phone and fills the form; the user checks the data, takes a selfie and submits. The server re-validates everything.

const DOCS = { passport: { icon: 'idCard', sides: ['front'], mrz: 'front', shape: 'passport' },
  id_card: { icon: 'idCard', sides: ['front', 'back'], mrz: 'back', shape: 'card' },
  residence_permit: { icon: 'idCard', sides: ['front', 'back'], mrz: 'back', shape: 'card' },
  driving_license: { icon: 'car', sides: ['front', 'back'], mrz: null, shape: 'card' } };
const FIELDS = ['surname', 'given_names', 'doc_number', 'nationality', 'birth_date', 'expiry_date'];

export default function Kyc() {
  const { t } = useI18n();
  const { me, refresh, toast } = useApp();
  const [st, setSt] = useState(null);
  const [step, setStep] = useState('intro');
  const [doc, setDoc] = useState('passport');
  const [shots, setShots] = useState({});
  const [mrz, setMrz] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const tries = useRef(0);
  const started = useRef(0);

  useEffect(() => { api.get('/api/kyc').then(setSt).catch(() => setSt({ level: me.kyc_level })); }, [me.kyc_level]);
  useEffect(() => () => { stopOcr(); }, []);

  const spec = DOCS[doc];
  const start = () => { setShots({}); setMrz(null); setFields({}); ocrWorker().catch(() => {}); setStep(spec.sides[0]); };

  // called by the scanner with each auto-captured frame of the MRZ side: accept when the MRZ checks out,
  // otherwise keep scanning; after ~12 s (or on a manual shot) accept the picture and let the user type the data
  const analyse = useCallback(async (canvas) => {
    if (!tries.current) started.current = performance.now();
    tries.current += 1;
    let res = null;
    try { res = await readMrz(canvas); } catch { return true; }
    if (res?.valid) {
      setMrz(res);
      setFields(Object.fromEntries(FIELDS.map((k) => [k, res[k] || ''])));
      return true;
    }
    return performance.now() - started.current > 12000;
  }, []);

  const captured = (side) => (dataUrl) => {
    setShots((x) => ({ ...x, [side]: dataUrl }));
    tries.current = 0;
    const next = spec.sides[spec.sides.indexOf(side) + 1];
    setStep(next || 'review');
  };

  const submit = async (selfie) => {
    setBusy(true);
    try {
      const body = { doc_type: doc, fields, files: { ...shots, selfie }, mrz: mrz?.lines?.join('\n') || '',
        capture: { mrz_auto: !!mrz?.valid, ua: navigator.userAgent.slice(0, 120) } };
      const r = await api.post('/api/kyc', body);
      setSt({ ...st, request: { status: r.status } });
      if (r.status === 'approved') refresh();
      setStep('done');
    } catch (e) {
      toast(errText(t, e), 'error');
      setStep('review');
    } finally {
      setBusy(false);
    }
  };

  if (!st) return <Page title={t('kyc_title')}><Skeleton h={220} r={22} /></Page>;
  if (st.level >= 2 || me.kyc_level >= 2) {
    const id = st.identity;
    return (
      <Page title={t('kyc_title')}>
        <div className="card glow col center g8" style={{ padding: '26px 16px', textAlign: 'center' }}>
          <span className="ic g" style={{ width: 72, height: 72, borderRadius: 26 }}><Icon name="shieldok" size={36} /></span>
          <b className="disp" style={{ fontSize: 20 }}>{t('kyc_level_2')}</b>
          {id && <><span style={{ fontSize: 15 }}>{id.name}</span><small className="dim" dir="ltr">{id.country}{id.expires ? ` · ${t('kyc_valid_until')} ${id.expires}` : ''}</small></>}
        </div>
        <div className="note"><Icon name="lock" size={15} /><span>{t('kyc_done_note')}</span></div>
      </Page>
    );
  }
  if (st.request?.status === 'pending' || step === 'done') {
    return (
      <Page title={t('kyc_title')}>
        <div className="col center g12" style={{ padding: '40px 8px', textAlign: 'center' }}>
          <span className="ic" style={{ width: 84, height: 84, borderRadius: 30 }}><Icon name="clock" size={40} className="breathe" /></span>
          <b className="disp" style={{ fontSize: 20 }}>{t('kyc_pending')}</b>
          <span className="dim small">{t('kyc_pending_sub')}</span>
          <div className="prog indet" style={{ width: 160 }}><i /></div>
        </div>
      </Page>
    );
  }

  if (spec.sides.includes(step)) {
    const mrzSide = spec.mrz === step;
    return (
      <Scanner key={step} mode={spec.shape} title={t(step === 'front' ? 'scan_front' : 'scan_back')}
        hint={t(mrzSide ? 'scan_hint_mrz' : 'scan_hint_doc')} analyse={mrzSide ? analyse : null}
        onCapture={captured(step)} onClose={() => setStep('intro')} />
    );
  }
  if (step === 'selfie') {
    return <Scanner key="selfie" mode="face" facing="user" title={t('scan_selfie')} hint={t('scan_hint_face')}
      onCapture={(d) => submit(d)} onClose={() => setStep('review')} />;
  }

  if (step === 'review') {
    const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));
    const ready = fields.surname && fields.doc_number && fields.birth_date;
    return (
      <Page title={t('kyc_check_title')} bar={<Btn w disabled={!ready} loading={busy} onClick={() => (st.require_selfie === false ? submit(null) : setStep('selfie'))}>
        {t(st.require_selfie === false ? 'submit' : 'kyc_next_selfie')}</Btn>}>
        <div className="kyc-shots">
          {spec.sides.map((s) => <button key={s} type="button" onClick={() => setStep(s)}><img src={shots[s]} alt={t(s === 'front' ? 'scan_front' : 'scan_back')} /><span><Icon name="refresh" size={14} /></span></button>)}
        </div>
        {spec.mrz && (mrz?.valid
          ? <div className="warn g"><Icon name="checkCircle" size={17} /><span>{t('kyc_mrz_ok')}</span></div>
          : <div className="warn"><Icon name="alert" size={17} /><span>{t('kyc_mrz_manual')}</span></div>)}
        {FIELDS.map((k) => (
          <Field key={k} label={t(`kyc_f_${k}`)}>
            <input value={fields[k] || ''} onChange={set(k)} type={k.endsWith('_date') ? 'date' : 'text'} dir="ltr"
              autoCapitalize="characters" autoComplete="off" spellCheck={false} />
          </Field>
        ))}
        <div className="note"><Icon name="lock" size={15} /><span>{t('kyc_privacy')}</span></div>
      </Page>
    );
  }

  const rejected = st.request?.status === 'rejected';
  return (
    <Page title={t('kyc_title')} bar={<Btn w icon="camera" onClick={start}>{t('kyc_start')}</Btn>}>
      <div className="card glow col center g8" style={{ padding: '22px 16px', textAlign: 'center' }}>
        <span className="ic" style={{ width: 72, height: 72, borderRadius: 26 }}><Icon name="idCard" size={34} /></span>
        <b className="disp" style={{ fontSize: 19 }}>{t('kyc_intro_title')}</b>
        <span className="dim small">{t('kyc_intro_sub')}</span>
        <span className="row g6"><Pill tone="g" icon="clock">{t('kyc_two_min')}</Pill><Pill tone="n" icon="lock">{t('kyc_encrypted')}</Pill></span>
      </div>
      {rejected && <div className="warn r"><Icon name="alert" size={18} /><span>{t('kyc_rejected')}{st.request.note ? `: ${st.request.note}` : ''}</span></div>}
      <div className="h2"><span>{t('kyc_doc_type')}</span></div>
      <div className="list">
        {(st.doc_types || Object.keys(DOCS)).map((d) => (
          <Li key={d} icon={DOCS[d].icon} tone={doc === d ? '' : 'n'} title={t(`doc_${d}`)} sub={DOCS[d].sides.length > 1 ? t('kyc_both_sides') : t('kyc_photo_page')}
            right={doc === d ? <Icon name="checkCircle" size={20} className="em" /> : null} onClick={() => setDoc(d)} />
        ))}
      </div>
      <div className="h2"><span>{t('how_it_works')}</span></div>
      <div className="card">
        <div className="tl">
          {[['kyc_step_scan', 'kyc_step_scan_sub'], ['kyc_step_read', 'kyc_step_read_sub'], ['kyc_step_selfie', 'kyc_step_selfie_sub']].map(([a, b], i) => (
            <div key={a} className={`st ${i === 0 ? 'now' : ''}`}><span className="dot" /><div><b className={i === 0 ? 'em' : ''}>{t(a)}</b><small>{t(b)}</small></div></div>
          ))}
        </div>
      </div>
    </Page>
  );
}
