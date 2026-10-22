import { useState } from 'react';
import { ActBtn, Badge, Card, fmtAgo, fmtDate, go, Input, Loading, post, qs, Select, Status, Table, Tabs, Toggle, useLoad, userName } from '../lib.jsx';

export default function Support({ sub, tab: fixed }) {
  const [tab, setTab] = useState(fixed || 'tickets');
  if (sub[0] === 'ticket' && sub[1]) return <Ticket tid={sub[1]} />;
  if (fixed === 'kyc') return <Kyc />;
  return (
    <div className="stack">
      <Tabs value={tab} onChange={setTab} items={[['tickets', 'Tickets'], ['forms', 'Forms & suggestions']]} />
      {tab === 'tickets' ? <Tickets /> : <Forms />}
    </div>
  );
}

function Tickets() {
  const [st, setSt] = useState('waiting_admin');
  const { data, error, reload } = useLoad('/tickets' + qs({ status: st }));
  return (
    <Card right={<Select value={st} onChange={setSt} options={[['waiting_admin', 'Waiting for us'], ['open', 'Open (AI)'], ['answered', 'Answered'], ['closed', 'Closed'], ['', 'All']]} />}>
      {error && <Loading error={error} reload={reload} />}
      <Table rows={data?.items} onRow={(r) => go('support/ticket/' + r.id)} empty="Inbox zero 🎉" cols={[
        ['#', (r) => r.id], ['User', (r) => userName({ ...r, id: r.user_id })], ['Subject', (r) => <b>{r.subject}</b>], ['Category', (r) => r.category || '—'],
        ['Priority', (r) => (r.priority === 'high' ? <Badge tone="danger">high</Badge> : r.priority)], ['Status', (r) => <Status s={r.status} />], ['Updated', (r) => fmtAgo(r.updated_at)],
      ]} />
    </Card>
  );
}

function Ticket({ tid }) {
  const { data: t, error, reload } = useLoad('/tickets/' + tid);
  const [text, setText] = useState('');
  const [close, setClose] = useState(false);
  const [showAi, setShowAi] = useState(false);
  if (!t) return <Loading error={error} reload={reload} />;
  return (
    <div className="stack">
      <a href="#/support">← Support</a>
      <Card title={`#${t.id} · ${t.subject || 'Request'}`} right={<><Status s={t.status} /><a href={'#/users/' + t.user_id}>Open user →</a></>}>
        <div className="dim small">Opened {fmtDate(t.created_at)}{t.ref ? ` · reference ${t.ref}` : ''}{t.rating ? ` · rated ${t.rating}/5` : ''}</div>
        <div className="chat">
          {t.messages.map((m, i) => (
            <div key={i} className={'msg ' + (m.sender === 'user' ? 'b' : m.sender === 'admin' ? 's' : 'sys')}>
              <span className="dim small">{m.sender} · {fmtDate(m.created_at)}</span>
              {m.text && <div className="pre">{m.text}</div>}
              {m.file && <a href={'/api/files/' + m.file} target="_blank" rel="noreferrer"><img src={'/api/files/' + m.file} alt="attachment" className="proof" /></a>}
            </div>
          ))}
        </div>
        <textarea className="inp" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply — delivered in the app and in the bot chat" />
        <div className="row gap">
          <Toggle on={close} onChange={setClose} label="Close after reply" />
          <ActBtn kind="primary" disabled={!text.trim()} run={() => post(`/tickets/${tid}/reply`, { text, close })} ok="Reply sent" onDone={() => { setText(''); reload(); }}>Send reply</ActBtn>
        </div>
      </Card>
      <Card title="Conversation with Zohra AI before escalation" right={<Toggle on={showAi} onChange={setShowAi} label="Show" />}>
        {showAi && <div className="chat">
          {(t.ai_chat || []).map((m, i) => (
            <div key={i} className={'msg ' + (m.role === 'user' ? 'b' : 'sys')}>
              <span className="dim small">{m.role} · {fmtDate(m.at)}</span><div className="pre">{typeof m.text === 'string' ? m.text : (Array.isArray(m.text) ? m.text.map((b) => b.text || '').join('\n') : JSON.stringify(m.text))}</div>
            </div>
          ))}
        </div>}
      </Card>
    </div>
  );
}

const FORM_KINDS = [['', 'All'], ['payment_method', 'Payment methods'], ['listing', 'Coin listings'], ['feedback', 'Feedback'], ['report', 'Problem reports']];

function Forms() {
  const [kind, setKind] = useState('');
  const { data, error, reload } = useLoad('/forms' + qs({ kind }));
  const [note, setNote] = useState({});
  return (
    <Card right={<Select value={kind} onChange={setKind} options={FORM_KINDS} />}>
      {error && <Loading error={error} reload={reload} />}
      <Table rows={data?.items} empty="No submissions" cols={[
        ['When', (r) => fmtDate(r.created_at)], ['Kind', (r) => r.kind], ['User', (r) => (r.user_id ? <a href={'#/users/' + r.user_id}>{r.user_id}</a> : '—')],
        ['Content', (r) => <div className="small">{Object.entries(r.data || {}).map(([k, v]) => <div key={k}><span className="dim">{k}:</span> {String(v)}</div>)}</div>],
        ['Status', (r) => <Status s={r.status} />],
        ['Note', (r) => <Input value={note[r.id] ?? r.admin_note ?? ''} onChange={(v) => setNote((x) => ({ ...x, [r.id]: v }))} />],
        ['', (r) => <div className="row gap">
          <ActBtn small run={() => post('/forms/' + r.id, { status: 'done', note: note[r.id] ?? r.admin_note ?? '' })} ok="Marked done" onDone={reload}>Done</ActBtn>
          <ActBtn small run={() => post('/forms/' + r.id, { status: 'rejected', note: note[r.id] ?? r.admin_note ?? '' })} ok="Rejected" onDone={reload}>Reject</ActBtn>
        </div>],
      ]} />
    </Card>
  );
}

const FLAG_TEXT = {
  mrz_invalid: 'MRZ check digits do not match — data may be mistyped or the document altered',
  document_expired: 'Document has expired', underage: 'Under the minimum age', blocked_country: 'Country is on the blocked list',
  document_used_by_another_account: 'The same document is already used by another account',
  no_selfie: 'No selfie', edited_doc_number: 'User changed the document number read from the MRZ',
  edited_surname: 'User changed the surname read from the MRZ', edited_birth_date: 'User changed the birth date read from the MRZ',
};
const KYC_ROWS = [['surname', 'Surname'], ['given_names', 'Given names'], ['doc_number', 'Document no.'], ['nationality', 'Nationality'],
  ['birth_date', 'Birth date'], ['expiry_date', 'Expiry'], ['sex', 'Sex']];

function Kyc() {
  const [st, setSt] = useState('pending');
  const { data, error, reload } = useLoad('/kyc' + qs({ status: st }));
  const [note, setNote] = useState({});
  return (
    <div className="stack">
      <Tabs value={st} onChange={setSt} items={[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']]} />
      <p className="dim small">Document images open through private links that expire after 15 minutes. Each view is recorded in the audit log.</p>
      {error && <Loading error={error} reload={reload} />}
      {data && !data.items.length && <div className="empty">Nothing to review</div>}
      {data?.items.map((k) => {
        const d = k.data || {};
        const m = d.mrz || {};
        const f = d.fields || {};
        return (
          <Card key={k.id} title={<>{[m.given_names, m.surname].filter(Boolean).join(' ') || d.full_name || userName({ ...k, id: k.user_id })}
            <span className="dim small"> #{k.id} · {(d.doc_type || '').replace(/_/g, ' ')}</span></>}
            right={<a href={'#/users/' + k.user_id}>User {k.user_id} →</a>}>
            <div className="row gap wrap">
              {m.format ? <Badge tone={m.valid ? 'ok' : 'bad'}>{m.valid ? `MRZ ${m.format} valid` : 'MRZ invalid'}</Badge> : <Badge tone="warn">no MRZ</Badge>}
              {(k.flags || []).length === 0 && <Badge tone="ok">no flags</Badge>}
              {(k.flags || []).map((x) => <Badge key={x} tone="bad">{FLAG_TEXT[x] || x}</Badge>)}
            </div>
            {d.mrz ? (
              <table className="tbl small" style={{ marginTop: 10 }}>
                <thead><tr><th /><th>Read from MRZ</th><th>Confirmed by user</th></tr></thead>
                <tbody>{KYC_ROWS.map(([key, label]) => {
                  const a = m[key] || ''; const b = f[key] || '';
                  const diff = b && a && a.replace(/\W/g, '').toUpperCase() !== b.replace(/\W/g, '').toUpperCase();
                  return <tr key={key}><td className="dim">{label}</td><td><code>{a || '—'}</code></td><td className={diff ? 'bad' : ''}>{b || '—'}</td></tr>;
                })}</tbody>
              </table>
            ) : (
              <div className="kv">{Object.entries(d).map(([a, b]) => <div key={a}><span>{a.replace(/_/g, ' ')}</span><b>{String(b)}</b></div>)}</div>
            )}
            {d.mrz_lines && <pre className="mrz">{d.mrz_lines.join('\n')}</pre>}
            <div className="kv"><div><span>Submitted</span><b>{fmtDate(k.created_at)}</b></div>
              <div><span>Account age</span><b>{k.user_created ? fmtAgo(k.user_created) : '—'}</b></div>
              <div><span>Read automatically</span><b>{d.capture?.mrz_auto ? 'yes (camera)' : 'no (typed)'}</b></div></div>
            <div className="row gap wrap">{Object.entries(k.files || {}).map(([side, url]) => (
              <a key={side} href={url} target="_blank" rel="noreferrer" className="doc-wrap"><img src={url} alt={side} className="doc" /><span>{side}</span></a>
            ))}</div>
            {k.status === 'pending' && <div className="row gap">
              <Input value={note[k.id] || ''} onChange={(v) => setNote((x) => ({ ...x, [k.id]: v }))} placeholder="Note (shown to the user if rejected)" />
              <ActBtn kind="primary" run={() => post(`/kyc/${k.id}/approve`, { note: note[k.id] || '' })} ok="Approved" onDone={reload}>Approve</ActBtn>
              <ActBtn kind="danger" run={() => post(`/kyc/${k.id}/reject`, { note: note[k.id] || '' })} ok="Rejected" onDone={reload}>Reject</ActBtn>
            </div>}
            {k.note && <div className="dim small">Note: {k.note}</div>}
          </Card>
        );
      })}
    </div>
  );
}
