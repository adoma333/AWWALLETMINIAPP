import { useState } from 'react';
import {
  ActBtn, Badge, Btn, can, Card, Copy, Field, fmtAgo, fmtDate, go, Input, Loading, Modal, num, post, qs, Select, Stat, Status, Table, Tabs,
  usd, useLoad, userName,
} from '../lib.jsx';

export default function Users({ me, sub }) {
  return sub[0] ? <UserDetail me={me} uid={sub[0]} /> : <UserList />;
}

function UserList() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const { data, error, reload } = useLoad('/users' + qs({ q: search, status, limit: 50, offset: page * 50 }));
  return (
    <div className="stack">
      <div className="toolbar">
        <form className="row gap grow" onSubmit={(e) => { e.preventDefault(); setPage(0); setSearch(q.trim()); }}>
          <Input value={q} onChange={setQ} placeholder="Search @username, name, Telegram ID or referral code" />
          <Btn kind="primary" type="submit">Search</Btn>
        </form>
        <Select value={status} onChange={(v) => { setPage(0); setStatus(v); }} options={[['', 'All statuses'], 'active', 'frozen', 'banned']} />
      </div>
      {error && <Loading error={error} reload={reload} />}
      <Card title={data ? `${data.total.toLocaleString()} users` : 'Users'}>
        <Table rows={data?.items} onRow={(r) => go('users/' + r.id)} cols={[
          ['User', (r) => <div className="who">{r.photo_url ? <img src={r.photo_url} alt="" /> : <span className="ava">{(r.first_name || '?')[0]}</span>}
            <div><b>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</b><span className="dim small">{r.username ? '@' + r.username : r.id}</span></div></div>],
          ['Balance', (r) => usd(r.balance_usd), 'r'],
          ['Status', (r) => <Status s={r.status} />],
          ['Role', (r) => r.role],
          ['KYC', (r) => r.kyc_level],
          ['Risk', (r) => <span className={r.risk_score >= 50 ? 'down' : ''}>{r.risk_score}</span>],
          ['Lang', (r) => r.lang],
          ['Joined', (r) => fmtDate(r.created_at)],
          ['Seen', (r) => fmtAgo(r.last_seen)],
        ]} />
        {data && data.total > 50 && (
          <div className="pager">
            <Btn small disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</Btn>
            <span className="dim">{page * 50 + 1}–{Math.min(data.total, page * 50 + 50)} of {data.total}</span>
            <Btn small disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(page + 1)}>Next →</Btn>
          </div>
        )}
      </Card>
    </div>
  );
}

const KINDS = ['withdraw', 'swap', 'transfer', 'gift', 'p2p_taker', 'p2p_maker'];

function UserDetail({ me, uid }) {
  const { data: d, error, reload } = useLoad('/users/' + uid);
  const [tab, setTab] = useState('txs');
  const [modal, setModal] = useState(null);
  if (!d) return <Loading error={error} reload={reload} />;
  const u = d.user;
  const total = Object.values(d.balances).reduce((a, b) => a + Number(b.usd), 0);
  const act = (action, body) => post(`/users/${uid}/${action}`, body);
  const mayEdit = can(me, 'users');

  return (
    <div className="stack">
      <div className="row gap"><a href="#/users">← All users</a></div>
      <Card>
        <div className="profile">
          {u.photo_url ? <img src={u.photo_url} alt="" className="pic" /> : <span className="ava pic">{(u.first_name || '?')[0]}</span>}
          <div className="grow">
            <h2>{[u.first_name, u.last_name].filter(Boolean).join(' ') || userName(u)}</h2>
            <div className="row gap wrap">
              {u.username && <a href={`https://t.me/${u.username}`} target="_blank" rel="noreferrer">@{u.username}</a>}
              <Copy text={String(u.id)}>ID {u.id}</Copy>
              <Status s={u.status} /><Badge>{u.role}</Badge><Badge tone={u.kyc_level ? 'ok' : ''}>KYC {u.kyc_level}</Badge>
              {u.phone_masked && <Badge tone="ok">📱 {u.phone_masked}</Badge>}
              <Badge>{u.lang}</Badge>
              {d.vip?.name && <Badge tone="ember">VIP {d.vip.name}</Badge>}
              {u.security_hold_until > Date.now() / 1000 && <Badge tone="warn">Hold until {fmtDate(u.security_hold_until)}</Badge>}
            </div>
            <div className="dim small">Joined {fmtDate(u.created_at)} · last seen {fmtAgo(u.last_seen)} · ref code {u.ref_code}{u.status_reason ? ` · reason: ${u.status_reason}` : ''}</div>
          </div>
        </div>
        {mayEdit && (
          <div className="row gap wrap actions">
            <Btn onClick={() => setModal('message')}>✉ Message</Btn>
            <Btn onClick={() => setModal('status')}>Status</Btn>
            <Btn onClick={() => setModal('role')}>Role / KYC / risk</Btn>
            <Btn onClick={() => setModal('limits')}>Limits & VIP</Btn>
            <Btn onClick={() => setModal('voucher')}>🎟 Voucher</Btn>
            {can(me, 'finance') && <Btn onClick={() => setModal('adjust')}>± Adjust balance</Btn>}
            <ActBtn run={() => act('reset_pin')} confirm="Reset this user's PIN and biometrics? Withdrawals will be held for 24h." ok="PIN reset" onDone={reload}>Reset PIN</ActBtn>
            <ActBtn run={() => act('unhold')} ok="Hold lifted" onDone={reload}>Lift hold</ActBtn>
          </div>
        )}
      </Card>

      <div className="grid4">
        <Stat label="Total balance" value={usd(total)} />
        <Stat label="Referrals" value={d.referrals.count} sub={d.referrals.referrer ? `Invited by ${d.referrals.referrer}` : 'Organic'} />
        <Stat label="Referral pending" value={usd(d.referrals.pending_usd)} />
        <Stat label="P2P" value={`${d.p2p?.orders ?? 0} orders`} sub={d.p2p ? `${d.p2p.completion_pct ?? '—'}% completion (30d) · 👍 ${d.p2p.positive} 👎 ${d.p2p.negative}` : ''} />
      </div>

      <div className="grid2">
        <Card title="Balances">
          <Table rows={Object.entries(d.balances).map(([a, v]) => ({ a, ...v }))} rowKey={(r) => r.a} empty="No balances" cols={[
            ['Asset', (r) => <b>{r.a}</b>], ['Available', (r) => num(r.available), 'r'], ['Locked', (r) => num(r.locked), 'r'], ['USD', (r) => usd(r.usd), 'r'],
          ]} />
        </Card>
        <Card title="Limits used (24h, USD)">
          <div className="kv">
            <div><span>Withdrawals</span><b>{usd(d.limits.withdraw_used)} / {usd(d.limits.withdraw_daily)}</b></div>
            <div><span>Single withdrawal max</span><b>{usd(d.limits.withdraw_single)}</b></div>
            <div><span>Transfers & gifts</span><b>{usd(d.limits.transfer_used)} / {usd(d.limits.transfer_daily)}</b></div>
            <div><span>P2P</span><b>{usd(d.limits.p2p_used)} / {usd(d.limits.p2p_daily)}</b></div>
            <div><span>30-day volume (VIP)</span><b>{usd(d.vip?.volume_30d)}</b></div>
          </div>
        </Card>
      </div>

      <Tabs value={tab} onChange={setTab} items={[['txs', 'Transactions'], ['wd', 'Withdrawals'], ['addr', 'Deposit addresses'], ['ledger', 'Ledger'],
        ['vouchers', 'Vouchers'], ['tickets', 'Tickets'], ['logins', 'Logins']]} />
      <Card>
        {tab === 'txs' && <Table rows={d.txs} cols={[
          ['When', (r) => fmtDate(r.created_at)], ['Type', (r) => r.type], ['Amount', (r) => `${num(r.amount)} ${r.asset}`, 'r'],
          ['Fee', (r) => (Number(r.fee) ? num(r.fee) : '—'), 'r'], ['To / from', (r) => r.counterparty || r.network || '—'], ['Status', (r) => <Status s={r.status} />],
          ['Ref', (r) => <Copy text={r.id}>{r.id.slice(0, 10)}</Copy>],
        ]} />}
        {tab === 'wd' && <Table rows={d.withdrawals} cols={[
          ['When', (r) => fmtDate(r.created_at)], ['Amount', (r) => `${num(r.amount)} ${r.asset}`, 'r'], ['Network', (r) => r.network],
          ['Address', (r) => <Copy text={r.address}>{r.address.slice(0, 14)}…</Copy>], ['Status', (r) => <Status s={r.status} />],
        ]} />}
        {tab === 'addr' && <Table rows={d.addresses} rowKey={(r) => r.family} cols={[
          ['Family', (r) => r.family], ['Address', (r) => <Copy text={r.address} />], ['Memo', (r) => r.memo || '—'], ['HD index', (r) => r.hd_index],
        ]} />}
        {tab === 'ledger' && <Table rows={d.ledger} cols={[
          ['When', (r) => fmtDate(r.created_at)], ['Asset', (r) => r.asset], ['Bucket', (r) => r.bucket],
          ['Δ', (r) => <span className={Number(r.delta) < 0 ? 'down' : 'up'}>{num(r.delta)}</span>, 'r'], ['After', (r) => num(r.balance_after), 'r'],
          ['Kind', (r) => r.kind], ['Ref', (r) => r.ref || '—'], ['Note', (r) => r.note || ''],
        ]} />}
        {tab === 'vouchers' && <Table rows={d.vouchers} cols={[
          ['Kind', (r) => r.kind], ['Value', (r) => r.value || '—'], ['Uses left', (r) => r.uses_left], ['Expires', (r) => fmtDate(r.expires_at)], ['Source', (r) => r.source],
        ]} />}
        {tab === 'tickets' && <Table rows={d.tickets} onRow={(r) => go('support/ticket/' + r.id)} cols={[
          ['#', (r) => r.id], ['Subject', (r) => r.subject], ['Status', (r) => <Status s={r.status} />], ['Updated', (r) => fmtAgo(r.updated_at)],
        ]} />}
        {tab === 'logins' && <Table rows={d.logins} cols={[
          ['When', (r) => fmtDate(r.created_at)], ['Platform', (r) => r.platform || '—'], ['IP', (r) => r.ip || '—'], ['Agent', (r) => <span className="small">{(r.ua || '').slice(0, 80)}</span>],
        ]} />}
      </Card>

      {modal && <UserModal kind={modal} u={u} d={d} act={act} close={() => setModal(null)} done={() => { setModal(null); reload(); }} />}
    </div>
  );
}

function UserModal({ kind, u, d, act, close, done }) {
  const [f, setF] = useState(() => ({
    status: u.status, reason: u.status_reason || '', role: u.role, level: u.kyc_level, score: u.risk_score, text: '', asset: 'USDT', amount: '',
    vip: '', limits: {}, vkind: 'fee_free', vkinds: ['withdraw', 'swap'], uses: 3, days: 30, value: '50',
  }));
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const titles = { message: 'Send a message', status: 'Account status', role: 'Role, verification & risk', limits: 'Limits & VIP', voucher: 'Grant a voucher', adjust: 'Adjust balance' };
  return (
    <Modal title={titles[kind]} onClose={close}>
      {kind === 'message' && <>
        <Field label="Message (sent by the bot, HTML allowed)"><textarea className="inp" rows={5} value={f.text} onChange={(e) => set('text')(e.target.value)} /></Field>
        <ActBtn kind="primary" run={() => act('message', { text: f.text })} ok="Sent" onDone={done}>Send</ActBtn>
      </>}
      {kind === 'status' && <>
        <Field label="Status"><Select value={f.status} onChange={set('status')} options={[['active', 'Active'], ['frozen', 'Frozen (can log in, cannot move funds)'], ['banned', 'Banned']]} /></Field>
        <Field label="Reason (internal)"><Input value={f.reason} onChange={set('reason')} /></Field>
        <ActBtn kind="primary" run={() => act('status', { status: f.status, reason: f.reason })} ok="Saved" onDone={done}>Save</ActBtn>
      </>}
      {kind === 'role' && <>
        <div className="form2">
          <Field label="Role" hint="merchant/vip/partner roles can have their own fee rules"><Select value={f.role} onChange={set('role')} options={['user', 'merchant', 'vip', 'partner']} /></Field>
          <Field label="Verification level"><Select value={f.level} onChange={(v) => set('level')(Number(v))} options={[[0, '0 · Basic'], [1, '1 · Phone'], [2, '2 · Identity']]} /></Field>
          <Field label="Risk score (0–100)" hint="≥ 50 sends every withdrawal to review"><Input type="number" min="0" max="100" value={f.score} onChange={set('score')} /></Field>
        </div>
        <ActBtn kind="primary" ok="Saved" onDone={done} run={async () => {
          if (f.role !== u.role) await act('role', { role: f.role });
          if (Number(f.level) !== u.kyc_level) await act('kyc', { level: Number(f.level) });
          if (Number(f.score) !== u.risk_score) await act('risk', { score: Number(f.score) });
        }}>Save</ActBtn>
      </>}
      {kind === 'limits' && <>
        <p className="dim small">Override this user's USD limits (empty = use the defaults for their verification level). Current VIP: {d.vip?.name || 'none'}.</p>
        <div className="form2">
          {['withdraw_daily', 'withdraw_single', 'transfer_daily', 'p2p_daily'].map((k) => (
            <Field key={k} label={k.replace('_', ' ')}><Input type="number" value={f.limits[k] ?? ''} onChange={(v) => setF((x) => ({ ...x, limits: { ...x.limits, [k]: v } }))} /></Field>
          ))}
          <Field label="Force VIP level" hint="empty = automatic by 30-day volume"><Input type="number" value={f.vip} onChange={set('vip')} /></Field>
        </div>
        <ActBtn kind="primary" ok="Saved" onDone={done} run={async () => {
          await act('limits', { limits: Object.fromEntries(Object.entries(f.limits).filter(([, v]) => v !== '')) });
          await act('vip', { level: f.vip === '' ? null : Number(f.vip) });
        }}>Save</ActBtn>
      </>}
      {kind === 'voucher' && <>
        <div className="form2">
          <Field label="Type"><Select value={f.vkind} onChange={set('vkind')} options={[['fee_free', 'Fee-free'], ['fee_discount', 'Fee discount %']]} /></Field>
          {f.vkind === 'fee_discount' && <Field label="Discount %"><Input type="number" value={f.value} onChange={set('value')} /></Field>}
          <Field label="Uses"><Input type="number" value={f.uses} onChange={set('uses')} /></Field>
          <Field label="Valid days"><Input type="number" value={f.days} onChange={set('days')} /></Field>
        </div>
        <Field label="Applies to">
          <div className="row gap wrap">{KINDS.map((k) => (
            <label key={k} className="chk"><input type="checkbox" checked={f.vkinds.includes(k)} onChange={(e) => set('vkinds')(e.target.checked ? [...f.vkinds, k] : f.vkinds.filter((x) => x !== k))} />{k}</label>
          ))}</div>
        </Field>
        <ActBtn kind="primary" ok="Voucher granted" onDone={done} run={() => act('voucher', { spec: {
          kind: f.vkind, kinds: f.vkinds, uses: Number(f.uses), days: Number(f.days), ...(f.vkind === 'fee_discount' ? { value: String(f.value) } : {}),
        } })}>Grant</ActBtn>
      </>}
      {kind === 'adjust' && <>
        <div className="alert warn">Balance adjustments are written to the ledger and the audit log. Use a negative amount to debit.</div>
        <div className="form2">
          <Field label="Asset"><Input value={f.asset} onChange={(v) => set('asset')(v.toUpperCase())} /></Field>
          <Field label="Amount (+/-)"><Input value={f.amount} onChange={set('amount')} placeholder="e.g. 25 or -10" /></Field>
        </div>
        <Field label="Reason (required)"><Input value={f.reason} onChange={set('reason')} /></Field>
        <ActBtn kind="primary" ok="Balance adjusted" confirm={`Adjust ${f.amount} ${f.asset} for this user?`} onDone={done}
          run={() => act('adjust', { asset: f.asset, amount: f.amount, reason: f.reason })}>Apply</ActBtn>
      </>}
    </Modal>
  );
}
