import React, { useEffect, useRef, useState } from 'react';
import { api, fileToDataUrl } from '../api';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';
import { Btn, Card, Empty, Field, Page, Segmented, Status } from '../components/ui';
import { timeAgo } from '../format';
import { errText, useI18n } from '../i18n';
import { go, match } from '../router';
import { useApp } from '../store';
import { haptic } from '../telegram';
import { ZMark } from '../components/Logo';

export default function Support({ path }) {
  const m = match('/support/ticket/:id', path);
  if (m) return <Ticket id={m.id} />;
  if (path === '/support/tickets') return <Tickets />;
  if (path === '/support/forms') return <Forms />;
  return <Chat />;
}

function Md({ text }) {
  // tiny safe renderer: paragraphs, numbered/bulleted lines, **bold**
  return (text || '').split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith('**') ? <b key={j}>{p.slice(2, -2)}</b> : p));
    return <p key={i} className={/^\s*([-•]|\d+\.)\s/.test(line) ? 'li' : ''}>{parts}</p>;
  });
}

function Chat() {
  const { t } = useI18n();
  const { config } = useApp();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [sugg, setSugg] = useState([]);
  const [name, setName] = useState(config?.ai_name || 'Zohra AI');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => {
    api.get('/api/ai/history').then((r) => { setItems(r.items); setSugg(r.suggestions); setName(r.name); }).catch(() => {});
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [items, busy]);
  const send = async (q) => {
    const msg = (q ?? text).trim();
    if (!msg || busy) return;
    setText('');
    setItems((x) => [...x, { role: 'user', text: msg }]);
    setBusy(true);
    try {
      const r = await api.post('/api/ai/chat', { text: msg });
      setItems((x) => [...x, { role: 'assistant', text: r.reply, actions: r.actions }]);
      setSugg(r.suggestions);
      haptic.tap();
    } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Page title={t('support_title')} className="support" right={<button type="button" className="icon-btn" onClick={() => go('/support/tickets')}><Icon name="list" /></button>}>
      <div className="ai-head"><ZMark size={42} radius={0.5} /><div><b>{name}</b><small className="ok-dot">online · 24/7</small></div></div>
      <section className="chat ai">
        <div className="msg bot"><Md text={t('ai_intro', { name })} /></div>
        {items.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'me' : 'bot'}`}>
            {m.role === 'user' ? m.text : <Md text={m.text} />}
            {m.actions?.filter((a) => a.type === 'ticket').map((a) => (
              <button key={a.id} type="button" className="link-btn" onClick={() => go(`/support/ticket/${a.id}`)}>{t('ticket_opened', { id: a.id })}</button>
            ))}
          </div>
        ))}
        {busy && <div className="msg bot typing"><span /><span /><span /></div>}
        <div ref={end} />
      </section>
      <div className="sugg">
        {sugg.map((s, i) => (
          <button key={i} type="button" className="chip" onClick={() => {
            if (s.key === 'new_method') go('/support/forms?kind=payment_method');
            else send(s.text);
          }}>{s.text}</button>
        ))}
        <button type="button" className="chip ember" onClick={() => send(t('talk_human'))}><Icon name="headset" size={14} />{t('talk_human')}</button>
      </div>
      <div className="chat-input">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('ask_placeholder')} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button type="button" className="icon-btn ember" onClick={() => send()} disabled={busy}><Icon name="send" /></button>
      </div>
      <div className="support-links">
        <button type="button" onClick={() => go('/support/forms')}><Icon name="sparkle" size={16} />{t('forms_title')}</button>
        <button type="button" onClick={async () => { await api.del('/api/ai/history'); setItems([]); }}><Icon name="trash" size={16} />{t('clear_chat')}</button>
      </div>
    </Page>
  );
}

function Tickets() {
  const { t } = useI18n();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [subject, setSubject] = useState('');
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => { api.get('/api/tickets').then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  const create = async () => {
    try { const r = await api.post('/api/tickets', { subject, text: msg }); go(`/support/ticket/${r.id}`, true); } catch (e) { toast(errText(t, e), 'error'); }
  };
  return (
    <Page title={t('tickets')} right={<button type="button" className="icon-btn" onClick={() => setOpen(!open)}><Icon name="plus" /></button>}>
      {open && (
        <Card>
          <Field label={t('ticket_subject')}><input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label={t('ticket_message')}><textarea rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} /></Field>
          <Btn className="wide" disabled={!msg.trim()} onClick={create}>{t('send')}</Btn>
        </Card>
      )}
      {items?.length === 0 && !open && <Empty icon="lifebuoy" title={t('new_ticket')} action={<Btn onClick={() => setOpen(true)}>{t('new_ticket')}</Btn>} />}
      {items?.map((x) => (
        <Card key={x.id} className="order-item" onClick={() => go(`/support/ticket/${x.id}`)}>
          <div className="gi-top"><b>#{x.id} {x.subject}</b><Status status={x.status} /></div>
          <small className="dim">{timeAgo(x.updated_at, t)}</small>
        </Card>
      ))}
    </Page>
  );
}

function Ticket({ id }) {
  const { t } = useI18n();
  const toast = useToast();
  const [x, setX] = useState(null);
  const [text, setText] = useState('');
  const load = () => api.get(`/api/tickets/${id}`).then(setX).catch(() => {});
  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => clearInterval(iv); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (file) => {
    if (!text.trim() && !file) return;
    try { await api.post(`/api/tickets/${id}/reply`, { text, file }); setText(''); load(); } catch (e) { toast(errText(t, e), 'error'); }
  };
  if (!x) return <Page title={`#${id}`} />;
  return (
    <Page title={`#${x.id} ${x.subject || ''}`} className="support">
      <Status status={x.status} />
      <section className="chat">
        {x.messages.map((m, i) => (
          <div key={i} className={`msg ${m.sender === 'user' ? 'me' : m.sender === 'admin' ? 'arb' : 'bot'}`}>
            {m.sender === 'admin' && <b>🛟 </b>}{m.text}{m.file && <img src={`/api/files/${m.file}`} alt="" />}<small>{timeAgo(m.created_at, t)}</small>
          </div>
        ))}
      </section>
      {x.status === 'answered' && !x.rating && (
        <div className="rate">{t('rate_support')} {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={async () => { await api.post(`/api/tickets/${id}/rate`, { rating: n }); load(); }}>★</button>)}</div>
      )}
      <div className="chat-input">
        <label className="icon-btn"><Icon name="attach" /><input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) send(await fileToDataUrl(f)); }} /></label>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('chat_placeholder')} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button type="button" className="icon-btn ember" onClick={() => send()}><Icon name="send" /></button>
      </div>
    </Page>
  );
}

const FORMS = {
  payment_method: [['name', 'form_name'], ['country', 'form_country'], ['currency', 'form_currency'], ['link', 'form_link'], ['note', 'form_note']],
  listing: [['coin', 'form_coin'], ['network', 'network'], ['contract', 'form_contract'], ['link', 'form_link'], ['note', 'form_note']],
  feedback: [['topic', 'form_topic'], ['message', 'form_message']],
  report: [['topic', 'form_topic'], ['message', 'form_message'], ['ref', 'form_ref']],
};

function Forms() {
  const { t } = useI18n();
  const toast = useToast();
  const initial = new URLSearchParams(location.hash.split('?')[1] || '').get('kind') || 'payment_method';
  const [kind, setKind] = useState(FORMS[initial] ? initial : 'payment_method');
  const [data, setData] = useState({});
  const [sent, setSent] = useState(false);
  const submit = async () => {
    try { await api.post('/api/forms', { kind, data }); setSent(true); haptic.success(); } catch (e) { toast(errText(t, e), 'error'); }
  };
  if (sent) return <Page title={t('forms_title')}><Empty icon="check" title={t('form_sent')} action={<Btn onClick={() => { setSent(false); setData({}); }}>{t('done')}</Btn>} /></Page>;
  return (
    <Page title={t('forms_title')}>
      <Segmented value={kind} onChange={(k) => { setKind(k); setData({}); }} options={[['payment_method', '💳'], ['listing', '🪙'], ['feedback', '💬'], ['report', '🐞']]} />
      <h2 className="h2">{t(`form_${kind}`)}</h2>
      {FORMS[kind].map(([k, label]) => (
        <Field key={k} label={t(label)}>{k === 'message' || k === 'note'
          ? <textarea rows={4} value={data[k] || ''} onChange={(e) => setData({ ...data, [k]: e.target.value })} />
          : <input value={data[k] || ''} onChange={(e) => setData({ ...data, [k]: e.target.value })} />}</Field>
      ))}
      <Btn className="wide" onClick={submit} disabled={!Object.values(data).some((v) => String(v).trim())}>{t('submit')}</Btn>
    </Page>
  );
}
