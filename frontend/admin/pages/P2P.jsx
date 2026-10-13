import { useState } from 'react';
import {
  ActBtn, Badge, Btn, Card, Field, fmtAgo, fmtDate, go, Input, Loading, Modal, num, post, put, qs, Select, Status, Table, Tabs, Toggle, useLoad,
  userName,
} from '../lib.jsx';

export default function P2P({ sub }) {
  if (sub[0] === 'order' && sub[1]) return <Order oid={sub[1]} />;
  return <P2PLists />;
}

function P2PLists() {
  const [tab, setTab] = useState('disputes');
  return (
    <div className="stack">
      <Tabs value={tab} onChange={setTab} items={[['disputes', 'Appeals'], ['orders', 'Orders'], ['ads', 'Ads'], ['methods', 'Payment methods']]} />
      {tab === 'disputes' && <Disputes />}
      {tab === 'orders' && <Orders />}
      {tab === 'ads' && <Ads />}
      {tab === 'methods' && <Methods />}
    </div>
  );
}

function Disputes() {
  const [st, setSt] = useState('open');
  const { data, error, reload } = useLoad('/p2p/disputes' + qs({ status: st }));
  return (
    <Card right={<Tabs value={st} onChange={setSt} items={[['open', 'Open'], ['all', 'All']]} />}>
      {error && <Loading error={error} reload={reload} />}
      <Table rows={data?.items} onRow={(r) => go('p2p/order/' + r.order_id)} empty="No open appeals 🎉" cols={[
        ['Opened', (r) => fmtAgo(r.created_at)], ['Order', (r) => r.order_id], ['Amount', (r) => `${num(r.amount)} ${r.asset}`, 'r'],
        ['Fiat', (r) => `${num(r.fiat_amount, 2)} ${r.fiat}`, 'r'], ['Reason', (r) => r.reason], ['By', (r) => (r.opened_by === r.buyer_id ? 'buyer' : 'seller')],
        ['Status', (r) => <Status s={r.status} />],
      ]} />
    </Card>
  );
}

function Orders() {
  const [st, setSt] = useState('');
  const { data, error, reload } = useLoad('/p2p/orders' + qs({ status: st }));
  return (
    <Card right={<Select value={st} onChange={setSt} options={[['', 'All statuses'], 'pending', 'paid', 'appeal', 'completed', 'cancelled', 'expired']} />}>
      {error && <Loading error={error} reload={reload} />}
      <Table rows={data?.items} onRow={(r) => go('p2p/order/' + r.id)} cols={[
        ['Created', (r) => fmtDate(r.created_at)], ['Order', (r) => r.id], ['Amount', (r) => `${num(r.amount)} ${r.asset}`, 'r'],
        ['Fiat', (r) => `${num(r.fiat_amount, 2)} ${r.fiat}`, 'r'], ['Price', (r) => num(r.price, 4), 'r'],
        ['Buyer', (r) => r.buyer_id], ['Seller', (r) => r.seller_id], ['Status', (r) => <Status s={r.status} />],
      ]} />
    </Card>
  );
}

function Ads() {
  const { data, error, reload } = useLoad('/p2p/ads');
  return (
    <Card title="Live ads">
      {error && <Loading error={error} reload={reload} />}
      <Table rows={data?.items} cols={[
        ['Advertiser', (r) => <a href={'#/users/' + r.user_id}>{userName({ ...r, id: r.user_id })}</a>], ['Side', (r) => r.side],
        ['Coin', (r) => r.asset], ['Fiat', (r) => r.fiat], ['Price', (r) => (r.price_type === 'floating' ? `market ${Number(r.margin_pct) >= 0 ? '+' : ''}${r.margin_pct}%` : num(r.price, 4)), 'r'],
        ['Available', (r) => num(r.remaining), 'r'], ['Limits', (r) => `${num(r.min_fiat, 2)}–${num(r.max_fiat, 2)}`],
        ['Status', (r) => <Status s={r.status} />],
        ['', (r) => (r.status === 'blocked'
          ? <ActBtn small run={() => post(`/p2p/ads/${r.id}/unblock`)} ok="Unblocked" onDone={reload}>Unblock</ActBtn>
          : <ActBtn small kind="danger" run={() => post(`/p2p/ads/${r.id}/block`)} ok="Blocked" confirm="Block this ad?" onDone={reload}>Block</ActBtn>)],
      ]} />
    </Card>
  );
}

const FIELD_OPTS = ['account_name', 'bank_name', 'account_number', 'iban', 'email', 'phone', 'card_number', 'city', 'note', 'revtag', 'ipa_address', 'rip',
  'papara_no', 'upi_id', 'pix_key'];

function Methods() {
  const { data, error, reload } = useLoad('/p2p/methods');
  const [open, setOpen] = useState(null);
  return (
    <Card title="Payment methods" right={<Btn kind="primary" small onClick={() => setOpen({ id: '', name: '', type: 'bank', fields: ['account_name', 'account_number'], currencies: [], enabled: true, sort: 100, _new: true })}>+ Add method</Btn>}>
      <p className="dim small">Users suggest new methods through AW AI → “Suggest a payment method”; you'll find them under Support → Forms. Icons: key <code>pm:METHOD_ID</code> under Icons &amp; media.</p>
      {error && <Loading error={error} reload={reload} />}
      <Table rows={data?.items} onRow={setOpen} cols={[
        ['Method', (r) => <b>{r.name} <span className="dim small">{r.id}</span></b>], ['Type', (r) => r.type],
        ['Currencies', (r) => <span className="small">{(typeof r.currencies === 'string' ? JSON.parse(r.currencies || '[]') : r.currencies || []).join(', ') || 'all'}</span>],
        ['Enabled', (r) => (r.enabled ? <Badge tone="ok">on</Badge> : <Badge>off</Badge>)],
      ]} />
      {open && <MethodModal m={open} close={() => setOpen(null)} done={() => { setOpen(null); reload(); }} />}
    </Card>
  );
}

function MethodModal({ m, close, done }) {
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v || '[]') : v || []);
  const [f, setF] = useState({ ...m, fields: parse(m.fields), currencies: parse(m.currencies).join(', '), enabled: !!m.enabled });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal title={m._new ? 'New payment method' : m.name} onClose={close}>
      <div className="form2">
        {m._new && <Field label="ID" hint="lowercase, e.g. wise"><Input value={f.id} onChange={(v) => set('id')(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))} /></Field>}
        <Field label="Name"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Type"><Select value={f.type} onChange={set('type')} options={['bank', 'wallet', 'card', 'cash', 'other']} /></Field>
        <Field label="Colour"><Input value={f.color || ''} onChange={set('color')} /></Field>
        <Field label="Sort"><Input type="number" value={f.sort} onChange={set('sort')} /></Field>
      </div>
      <Field label="Currencies (comma separated, empty = all)"><Input value={f.currencies} onChange={set('currencies')} /></Field>
      <Field label="Fields the seller fills in">
        <div className="row gap wrap">{FIELD_OPTS.map((k) => (
          <label key={k} className="chk"><input type="checkbox" checked={f.fields.includes(k)} onChange={(e) => set('fields')(e.target.checked ? [...f.fields, k] : f.fields.filter((x) => x !== k))} />{k}</label>
        ))}</div>
      </Field>
      <Toggle on={f.enabled} onChange={set('enabled')} label="Enabled" />
      <ActBtn kind="primary" ok="Saved" disabled={!f.id || !f.name} onDone={done} run={() => put('/p2p/methods/' + f.id, {
        name: f.name, type: f.type, color: f.color, icon: f.icon, fields: f.fields, enabled: f.enabled, sort: Number(f.sort),
        currencies: f.currencies.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
      })}>Save</ActBtn>
    </Modal>
  );
}

/* ─────────── one order: chat, evidence, arbitration ─────────── */
function Order({ oid }) {
  const { data: o, error, reload } = useLoad('/p2p/orders/' + oid);
  const [text, setText] = useState('');
  const [summary, setSummary] = useState('');
  const [note, setNote] = useState('');
  if (!o) return <Loading error={error} reload={reload} />;
  const open = ['appeal', 'paid', 'pending'].includes(o.status);
  const person = (p, st) => p && (
    <div className="kv">
      <div><span>User</span><b><a href={'#/users/' + p.id}>{p.name || userName(p)}</a></b></div>
      {st && <>
        <div><span>Completed orders</span><b>{st.orders}</b></div>
        <div><span>30d completion</span><b>{st.completion_pct ?? '—'}%</b></div>
        <div><span>Reviews</span><b>👍 {st.positive} · 👎 {st.negative}</b></div>
      </>}
    </div>
  );
  return (
    <div className="stack">
      <a href="#/p2p">← P2P</a>
      <Card title={`Order ${o.id}`} right={<Status s={o.status} />}>
        <div className="kv">
          <div><span>Crypto</span><b>{num(o.amount)} {o.asset}</b></div>
          <div><span>Fiat</span><b>{num(o.fiat_amount, 2)} {o.fiat} @ {num(o.price, 4)}</b></div>
          <div><span>Created</span><b>{fmtDate(o.created_at)}</b></div>
          <div><span>Marked paid</span><b>{fmtDate(o.paid_at)}</b></div>
          <div><span>Payment window ends</span><b>{fmtDate(o.expires_at)}</b></div>
          {o.cancel_reason && <div><span>Cancel reason</span><b>{o.cancel_reason}</b></div>}
          <div><span>Payment details</span><b>{Object.entries(o.payment || {}).map(([k, v]) => <div key={k} className="small">{k}: {String(v)}</div>)}</b></div>
          {o.terms && <div><span>Ad terms</span><b className="small">{o.terms}</b></div>}
        </div>
      </Card>
      <div className="grid2">
        <Card title="Buyer">{person(o.buyer, o.buyer_stats)}</Card>
        <Card title="Seller">{person(o.seller, o.seller_stats)}</Card>
      </div>
      {o.dispute_full && (
        <Card title="Appeal" right={<Status s={o.dispute_full.status} />}>
          <div className="kv">
            <div><span>Opened by</span><b>{o.dispute_full.opened_by === o.buyer?.id ? 'buyer' : 'seller'}</b></div>
            <div><span>Reason</span><b>{o.dispute_full.reason}</b></div>
            {o.dispute_full.details && <div><span>Details</span><b>{o.dispute_full.details}</b></div>}
            {o.dispute_full.resolution && <div><span>Resolution</span><b>{o.dispute_full.resolution}</b></div>}
          </div>
        </Card>
      )}
      <Card title="Order chat" right={<ActBtn small run={async () => setSummary((await post(`/p2p/orders/${oid}/summarize`)).summary)} ok="">✨ AI summary</ActBtn>}>
        {summary && <div className="alert info pre">{summary}</div>}
        <div className="chat">
          {(o.messages || []).map((m) => (
            <div key={m.id} className={'msg ' + (m.sender_id === o.buyer?.id ? 'b' : m.sender_id === o.seller?.id ? 's' : 'sys')}>
              <span className="dim small">{m.sender_id === o.buyer?.id ? 'Buyer' : m.sender_id === o.seller?.id ? 'Seller' : m.sender_id === -1 ? 'Arbiter' : 'System'} · {fmtDate(m.created_at)}</span>
              {m.text && <div>{m.text}</div>}
              {m.file && <a href={'/api/files/' + m.file} target="_blank" rel="noreferrer"><img src={'/api/files/' + m.file} alt="proof" className="proof" /></a>}
            </div>
          ))}
        </div>
        <div className="row gap">
          <Input value={text} onChange={setText} placeholder="Message both parties as the arbiter" />
          <ActBtn disabled={!text.trim()} run={() => post(`/p2p/orders/${oid}/message`, { text })} ok="Sent" onDone={() => { setText(''); reload(); }}>Send</ActBtn>
        </div>
      </Card>
      {open && (
        <Card title="Decision">
          <p className="dim small">Release to the buyer only when the seller's account clearly received the money (bank screenshot / statement). Return to the seller when the buyer did not pay or paid the wrong amount.</p>
          <Field label="Decision note (sent to both)"><Input value={note} onChange={setNote} /></Field>
          <div className="row gap wrap">
            <ActBtn kind="primary" run={() => post(`/p2p/orders/${oid}/resolve`, { winner: 'buyer', note })} confirm="Release the crypto to the BUYER?" ok="Released to buyer" onDone={reload}>Release to buyer</ActBtn>
            <ActBtn kind="danger" run={() => post(`/p2p/orders/${oid}/resolve`, { winner: 'seller', note })} confirm="Return the crypto to the SELLER and cancel the order?" ok="Returned to seller" onDone={reload}>Return to seller</ActBtn>
          </div>
        </Card>
      )}
    </div>
  );
}
