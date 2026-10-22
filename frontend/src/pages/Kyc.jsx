import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';
import { Badge, Btn, Empty, Field, Page, Skeleton } from '../components/ui';
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
  const { me, refresh } = useApp();
  const toast = useToast();
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

  if (!st) return <Page title={t('kyc_title')}><Skeleton h={220} /></Page>;
  if (st.level >= 2 || me.kyc_level >= 2) {
    const id = st.identity;
    return (
      <Page title={t('kyc_title')}>
        <section className="id-card">
          <Icon name="verified" size={34} weight="fill" />
          <b>{t('kyc_level_2')}</b>
          {id && <><span>{id.name}</span><small dir="ltr">{id.country}{id.expires ? ` · ${t('kyc_valid_until')} ${id.expires}` : ''}</small></>}
        </section>
        <p className="dim small center">{t('kyc_done_note')}</p>
      </Page>
    );
  }
  if (st.request?.status === 'pending' || step === 'done') {
    return <Page title={t('kyc_title')}><Empty icon="clock" title={t('kyc_pending')} sub={t('kyc_pending_sub')} /></Page>;
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
      <Page title={t('kyc_check_title')}>
        <div className="kyc-shots">
          {spec.sides.map((s) => <button key={s} type="button" onClick={() => setStep(s)}><img src={shots[s]} alt={t(s === 'front' ? 'scan_front' : 'scan_back')} /><span><Icon name="refresh" size={14} /></span></button>)}
        </div>
        {spec.mrz && (mrz?.valid
          ? <Badge tone="ok" icon="check">{t('kyc_mrz_ok')}</Badge>
          : <Badge tone="warn" icon="alert">{t('kyc_mrz_manual')}</Badge>)}
        <div className="form-list">
          {FIELDS.map((k) => (
            <Field key={k} label={t(`kyc_f_${k}`)}>
              <input value={fields[k] || ''} onChange={set(k)} type={k.endsWith('_date') ? 'date' : 'text'} dir="ltr"
                autoCapitalize="characters" autoComplete="off" spellCheck={false} />
            </Field>
          ))}
        </div>
        <p className="dim small">{t('kyc_privacy')}</p>
        <Btn className="wide" disabled={!ready} loading={busy} onClick={() => (st.require_selfie === false ? submit(null) : setStep('selfie'))}>
          {t(st.require_selfie === false ? 'submit' : 'kyc_next_selfie')}
        </Btn>
      </Page>
    );
  }

  const rejected = st.request?.status === 'rejected';
  return (
    <Page title={t('kyc_title')}>
      <section className="kyc-hero">
        <span className="kyc-hero-ic"><Icon name="idCard" size={34} /></span>
        <h2>{t('kyc_intro_title')}</h2>
        <p className="dim">{t('kyc_intro_sub')}</p>
      </section>
      {rejected && <div className="warn-card"><Icon name="alert" size={20} /><span>{t('kyc_rejected')}{st.request.note ? `: ${st.request.note}` : ''}</span></div>}
      <h2 className="h2">{t('kyc_doc_type')}</h2>
      <div className="option-list">
        {(st.doc_types || Object.keys(DOCS)).map((d) => (
          <button key={d} type="button" className={`option ${doc === d ? 'on' : ''}`} onClick={() => setDoc(d)}>
            <Icon name={DOCS[d].icon} size={22} /><span>{t(`doc_${d}`)}</span>{doc === d && <Icon name="check" size={18} />}
          </button>
        ))}
      </div>
      <ol className="kyc-steps">
        <li><Icon name="camera" size={18} />{t('kyc_step_scan')}</li>
        <li><Icon name="scan" size={18} />{t('kyc_step_read')}</li>
        <li><Icon name="face" size={18} />{t('kyc_step_selfie')}</li>
      </ol>
      <Btn className="wide" onClick={start}>{t('kyc_start')}</Btn>
    </Page>
  );
}
