import React, { useEffect, useRef, useState } from 'react';
import { api, fileToDataUrl } from '../api';
import Icon from '../components/Icon';
import { ZMark } from '../components/Logo';
import { Btn, Empty, Field, HeadBtn, Input, Li, Page, Segmented, Skeleton, Status } from '../components/ui';
import { timeAgo } from '../format';
import { errText, useI18n } from '../i18n';
import { back, go, match } from '../router';
import { useApp } from '../store';
import { haptic } from '../telegram';

export default function Support({ path, query = {} }) {
  const m = match('/support/ticket/:id', path);
  if (m) return <Ticket id={m.id} />;
  if (path === '/support/tickets') return <Tickets />;
  if (path === '/support/forms') return <Forms query={query} />;
  return <Chat query={query} />;
}

function Md({ text }) {
  // tiny safe renderer: paragraphs, numbered/bulleted lines, **bold**
  return (text || '').split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith('**') ? <b key={j} className="em">{p.slice(2, -2)}</b> : p));
    return <span key={i} style={{ display: 'block', paddingInlineStart: /^\s*([-•]|\d+\.)\s/.test(line) ? 6 : 0, minHeight: line ? undefined : 8 }}>{parts}</span>;
  });
}

const Speech = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

/** Design sheet 05.5 — Zohra AI: reads the account, answers with live context, escalates to a human. */
function Chat({ query }) {
  const { t, lang } = useI18n();
  const { config, toast } = useApp();
  const [items, setItems] = useState(null);
  const [sugg, setSugg] = useState([]);
  const [name, setName] = useState(config?.ai_name || 'Zohra AI');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const end = useRef(null);
  const rec = useRef(null);
  useEffect(() => {
    api.get('/api/ai/history').then((r) => { setItems(r.items); setSugg(r.suggestions || []); setName(r.name || name); }).catch(() => setItems([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (query.tx && items && !items.length) setText(t('ai_ask_about_tx', { id: query.tx })); }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 40); }, [items, busy]);
  const send = async (q) => {
    const msg = (q ?? text).trim();
    if (!msg || busy) return;
    setText('');
    setItems((x) => [...(x || []), { role: 'user', text: msg }]);
    setBusy(true);
    try {
      const r = await api.post('/api/ai/chat', { text: msg });
      setItems((x) => [...x, { role: 'assistant', text: r.reply, actions: r.actions }]);
      setSugg(r.suggestions || []);
      haptic.tap();
    } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };
  const mic = () => {
    if (!Speech) return;
    if (listening) { rec.current?.stop(); return; }
    const r = new Speech();
    r.lang = lang;
    r.interimResults = true;
    r.onresult = (e) => setText([...e.results].map((x) => x[0].transcript).join(''));
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    haptic.tap();
    r.start();
  };
  const chips = [...sugg.map((s) => [s.text, () => (s.key === 'new_method' ? go('/support/forms?kind=payment_method') : send(s.text))]),
    [t('talk_human'), () => send(t('talk_human')), true]];
  return (
    <main className="page" style={{ gap: 10, paddingBottom: 150 }}>
      <div className="row between" style={{ height: 44 }}>
        <button type="button" className="ic n sm" onClick={() => back()} aria-label="back"><Icon name="back" size={20} className="flip-rtl" /></button>
        <span className="row g8"><ZMark size={32} radius={0.5} />
          <span className="col" style={{ lineHeight: 1.2 }}><b className="disp" style={{ fontSize: 15, fontWeight: 600 }}>{name}</b><small className="ok" style={{ fontSize: 11.5 }}>● {t('online_247')}</small></span></span>
        <HeadBtn icon="headset" onClick={() => go('/support/tickets')} label={t('tickets')} />
      </div>
      <div className="col g8">
        <div className="msg ai"><Md text={t('ai_intro', { name })} /></div>
        {!items && <Skeleton h={60} r={20} w="70%" />}
        {items?.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'me' : 'ai'}`} style={{ animation: 'fadein .3s both' }}>
            {m.role === 'user' ? m.text : <Md text={m.text} />}
            {m.actions?.filter((a) => a.type === 'ticket').map((a) => (
              <button key={a.id} type="button" className="card s2 row g8" style={{ marginTop: 10, padding: '10px 12px', width: '100%' }} onClick={() => go(`/support/ticket/${a.id}`)}>
                <Icon name="headset" size={18} className="em" /><span className="grow" style={{ fontSize: 13.5 }}>{t('ticket_opened', { id: a.id })}</span><Icon name="chev" size={16} className="flip-rtl" /></button>
            ))}
            {m.actions?.filter((a) => a.type === 'open').map((a) => (
              <button key={a.path} type="button" className="btn f sm" style={{ marginTop: 10 }} onClick={() => go(a.path)}>{a.label || t('open')}</button>
            ))}
          </div>
        ))}
        {busy && <div className="msg ai typing"><i /><i /><i /></div>}
        <div ref={end} />
      </div>
      <div className="composer"><div className="composer-in">
        <div className="chips" style={{ margin: 0, padding: 0 }}>
          {chips.map(([l, fn, hum], i) => <button key={i} type="button" className={`chip ${i === 0 && !hum ? 'oe' : ''}`} onClick={fn}>{hum && <Icon name="headset" size={14} />}{l}</button>)}
        </div>
        <div className="row g8">
          <div className="search grow" style={{ height: 46 }}><input value={text} onChange={(e) => setText(e.target.value)} placeholder={listening ? t('listening') : t('ask_placeholder')} onKeyDown={(e) => e.key === 'Enter' && send()} /></div>
          {Speech && <button type="button" className={`ic ${listening ? '' : 'n'}`} style={{ width: 46, height: 46, flex: 'none' }} onClick={mic} aria-label={t('voice')}><Icon name="mic" size={19} className={listening ? 'breathe' : ''} /></button>}
          <button type="button" className="ic" style={{ width: 46, height: 46, flex: 'none', background: 'var(--grad)', color: 'var(--on-ember)' }} onClick={() => send()} disabled={busy} aria-label={t('send')}><Icon name="send" size={19} /></button>
        </div>
      </div></div>
    </main>
  );
}

function Tickets() {
  const { t } = useI18n();
  const { toast } = useApp();
  const [items, setItems] = useState(null);
  const [subject, setSubject] = useState('');
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => { api.get('/api/tickets').then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  const create = async () => {
    try { const r = await api.post('/api/tickets', { subject, text: msg }); go(`/support/ticket/${r.id}`, true); } catch (e) { toast(errText(t, e), 'error'); }
  };
  return (
    <Page title={t('tickets')} right={<HeadBtn icon={open ? 'x' : 'plus'} onClick={() => setOpen(!open)} label={t('new_ticket')} />}>
      {open && (
        <div className="card col g10">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('ticket_subject')} />
          <div className="input"><textarea rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t('ticket_message')} /></div>
          <Btn w disabled={!msg.trim()} onClick={create} icon="send">{t('send')}</Btn>
        </div>
      )}
      {!items && <Skeleton h={160} r={22} />}
      {items?.length === 0 && !open && <Empty icon="lifebuoy" title={t('no_tickets')} sub={t('no_tickets_sub')} action={<Btn size="sm" onClick={() => setOpen(true)}>{t('new_ticket')}</Btn>} />}
      {items?.length > 0 && (
        <div className="list">
          {items.map((x) => <Li key={x.id} icon="headset" tone="n" title={x.subject || `#${x.id}`} sub={`#${x.id} · ${timeAgo(x.updated_at, t)}`} right={<Status status={x.status} />} onClick={() => go(`/support/ticket/${x.id}`)} />)}
        </div>
      )}
      <Li icon="sparkle" title={t('forms_title')} sub={t('forms_sub')} chev onClick={() => go('/support/forms')} />
    </Page>
  );
}

function Ticket({ id }) {
  const { t } = useI18n();
  const { toast } = useApp();
  const [x, setX] = useState(null);
  const [text, setText] = useState('');
  const end = useRef(null);
  const load = () => api.get(`/api/tickets/${id}`, { silent: true }).then(setX).catch(() => {});
  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => clearInterval(iv); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [x?.messages?.length]);
  const send = async (file) => {
    if (!text.trim() && !file) return;
    try { await api.post(`/api/tickets/${id}/reply`, { text: file ? '' : text, file }); if (!file) setText(''); load(); } catch (e) { toast(errText(t, e), 'error'); }
  };
  if (!x) return <Page title={`#${id}`}><Skeleton h={200} r={22} /></Page>;
  return (
    <Page title={x.subject || `#${x.id}`} right={<Status status={x.status} />}>
      <div className="col g8" style={{ paddingBottom: 90 }}>
        {x.messages.map((m, i) => (
          m.sender === 'admin'
            ? <div key={i} className="msg" style={{ alignSelf: 'flex-start', background: 'rgba(61,220,151,.1)' }}><b className="ok" style={{ fontSize: 12.5 }}>🛟 {t('support_agent')}</b><br />{m.text}
              {m.file && <img src={`/api/files/${m.file}`} alt="" style={{ maxWidth: 180, borderRadius: 12, display: 'block', marginTop: 8 }} />}</div>
            : <div key={i} className={`msg ${m.sender === 'user' ? 'me' : 'ai'}`}>{m.text}
              {m.file && <img src={`/api/files/${m.file}`} alt="" style={{ maxWidth: 180, borderRadius: 12, display: 'block', marginTop: 8 }} />}</div>
        ))}
        {x.status === 'answered' && !x.rating && (
          <div className="card col center g8"><b style={{ fontSize: 14 }}>{t('rate_support')}</b>
            <div className="row g6">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" style={{ fontSize: 28, color: 'var(--gold)' }} onClick={async () => { await api.post(`/api/tickets/${id}/rate`, { rating: n }); haptic.success(); load(); }}>★</button>)}</div></div>
        )}
        <div ref={end} />
      </div>
      {x.status !== 'closed' && (
        <div className="composer"><div className="composer-in"><div className="row g8">
          <label className="ic n" style={{ width: 46, height: 46, flex: 'none', cursor: 'pointer' }} aria-label={t('attach')}><Icon name="paperclip" size={20} />
            <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) send(await fileToDataUrl(f)); }} /></label>
          <div className="search grow" style={{ height: 46 }}><input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('chat_placeholder')} onKeyDown={(e) => e.key === 'Enter' && send()} /></div>
          <button type="button" className="ic" style={{ width: 46, height: 46, flex: 'none', background: 'var(--grad)', color: 'var(--on-ember)' }} onClick={() => send()} aria-label={t('send')}><Icon name="send" size={19} /></button>
        </div></div></div>
      )}
    </Page>
  );
}

const FORMS = {
  payment_method: [['name', 'form_name'], ['country', 'form_country'], ['currency', 'form_currency'], ['link', 'form_link'], ['note', 'form_note']],
  listing: [['coin', 'form_coin'], ['network', 'network'], ['contract', 'form_contract'], ['link', 'form_link'], ['note', 'form_note']],
  feedback: [['topic', 'form_topic'], ['message', 'form_message']],
  report: [['topic', 'form_topic'], ['message', 'form_message'], ['ref', 'form_ref']],
};

function Forms({ query }) {
  const { t } = useI18n();
  const { toast } = useApp();
  const [kind, setKind] = useState(FORMS[query.kind] ? query.kind : 'payment_method');
  const [data, setData] = useState({});
  const [sent, setSent] = useState(false);
  const submit = async () => {
    try { await api.post('/api/forms', { kind, data }); setSent(true); haptic.success(); } catch (e) { toast(errText(t, e), 'error'); }
  };
  if (sent) return <Page title={t('forms_title')}><Empty icon="checkCircle" title={t('form_sent')} action={<Btn size="sm" onClick={() => { setSent(false); setData({}); }}>{t('done')}</Btn>} /></Page>;
  return (
    <Page title={t('forms_title')} bar={<Btn w onClick={submit} disabled={!Object.values(data).some((v) => String(v).trim())}>{t('submit')}</Btn>}>
      <Segmented value={kind} onChange={(k) => { setKind(k); setData({}); }} options={[['payment_method', t('form_kind_method')], ['listing', t('form_kind_coin')], ['feedback', t('form_kind_idea')], ['report', t('form_kind_bug')]]} />
      <div className="h2"><span>{t(`form_${kind}`)}</span></div>
      {FORMS[kind].map(([k, label]) => (
        <Field key={k} label={t(label)}>{k === 'message' || k === 'note'
          ? <textarea rows={4} value={data[k] || ''} onChange={(e) => setData({ ...data, [k]: e.target.value })} />
          : <input value={data[k] || ''} onChange={(e) => setData({ ...data, [k]: e.target.value })} />}</Field>
      ))}
    </Page>
  );
}
