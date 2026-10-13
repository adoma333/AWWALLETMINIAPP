import { useState } from 'react';
import {
  ActBtn, Badge, Bars, Btn, Card, Copy, Field, fmtAgo, fmtDate, Input, Loading, Modal, num, post, qs, Stat, Status, Table, Tabs, usd,
  useLoad, userName,
} from '../lib.jsx';

export default function Money({ tab }) {
  if (tab === 'withdrawals') return <Withdrawals />;
  if (tab === 'deposits') return <Deposits />;
  if (tab === 'treasury') return <Treasury />;
  return <Revenue />;
}

/* ─────────── withdrawals ─────────── */
const WD_TABS = [['review,stuck', 'Needs review'], ['approved', 'Approved / manual'], ['processing,broadcast', 'Sending'], ['completed', 'Completed'],
  ['rejected,failed,cancelled', 'Rejected / failed'], ['', 'All']];

function Withdrawals() {
  const [st, setSt] = useState('review,stuck');
  const { data, error, reload } = useLoad('/withdrawals' + qs({ status: st }));
  const [open, setOpen] = useState(null);
  return (
    <div className="stack">
      <div className="alert info">Networks in <b>manual</b> mode never send automatically: pay from your own wallet, then press <b>Mark paid</b> with the transaction hash.
        Switch a network to <b>auto</b> under Coins &amp; networks once its hot wallet is funded.</div>
      <Tabs value={st} onChange={setSt} items={WD_TABS} />
      {error && <Loading error={error} reload={reload} />}
      <Card right={<Btn small onClick={reload}>↻ Refresh</Btn>}>
        <Table rows={data?.items} onRow={setOpen} cols={[
          ['Created', (r) => fmtDate(r.created_at)],
          ['User', (r) => <a href={'#/users/' + r.user_id} onClick={(e) => e.stopPropagation()}>{userName({ ...r, id: r.user_id })}</a>],
          ['Amount', (r) => <b>{num(r.amount)} {r.asset}</b>, 'r'],
          ['USD', (r) => usd(r.usd_value), 'r'],
          ['Network', (r) => <>{r.network} <Badge tone={r.withdraw_mode === 'auto' ? 'ok' : ''}>{r.withdraw_mode}</Badge></>],
          ['Address', (r) => <Copy text={r.address}>{r.address.slice(0, 10)}…{r.address.slice(-6)}</Copy>],
          ['Risk', (r) => (r.risk?.length ? <span className="down small">{r.risk.join(', ')}</span> : <span className="dim">—</span>)],
          ['Status', (r) => <Status s={r.status} />],
        ]} />
      </Card>
      {open && <WithdrawalModal w={open} close={() => setOpen(null)} done={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function WithdrawalModal({ w, close, done }) {
  const [reason, setReason] = useState('');
  const [txid, setTxid] = useState('');
  const act = (a, b) => post(`/withdrawals/${w.id}/${a}`, b);
  const open = !['completed', 'rejected', 'failed', 'cancelled'].includes(w.status);
  return (
    <Modal title={`Withdrawal ${w.id}`} onClose={close} wide>
      <div className="kv">
        <div><span>User</span><b><a href={'#/users/' + w.user_id}>{userName({ ...w, id: w.user_id })}</a></b></div>
        <div><span>Amount sent</span><b>{num(w.amount)} {w.asset}</b></div>
        <div><span>Fee</span><b>{num(w.fee)} {w.asset}</b></div>
        <div><span>Debited</span><b>{num(w.total)} {w.asset}</b></div>
        <div><span>Network</span><b>{w.network} ({w.withdraw_mode})</b></div>
        <div><span>Address</span><b><Copy text={w.address} /></b></div>
        {w.memo && <div><span>Memo</span><b><Copy text={w.memo} /></b></div>}
        <div><span>Status</span><b><Status s={w.status} /></b></div>
        {w.txid && <div><span>Tx</span><b>{w.explorer ? <a href={w.explorer} target="_blank" rel="noreferrer">{w.txid.slice(0, 24)}…</a> : w.txid}</b></div>}
        {w.error && <div><span>Error</span><b className="down">{w.error}</b></div>}
        {!!w.risk?.length && <div><span>Risk flags</span><b className="down">{w.risk.join(', ')}</b></div>}
        <div><span>Attempts</span><b>{w.attempts}</b></div>
      </div>
      {w.status === 'stuck' && (
        <div className="alert danger">Stuck = the send result was ambiguous. Check the hot wallet on the explorer first. If the coins left, use <b>Mark paid</b> with the hash;
          if nothing was sent, use <b>Retry</b>.</div>
      )}
      {open && (
        <div className="stack">
          {w.status === 'review' && <div className="row gap wrap">
            <ActBtn kind="primary" run={() => act('approve')} ok="Approved" onDone={done}>✓ Approve</ActBtn>
          </div>}
          {w.status === 'stuck' && <ActBtn run={() => act('retry')} ok="Queued again" confirm="Only retry if you verified nothing was sent. Continue?" onDone={done}>↻ Retry send</ActBtn>}
          {['review', 'approved', 'stuck', 'processing', 'broadcast'].includes(w.status) && (
            <div className="row gap">
              <Input value={txid} onChange={setTxid} placeholder="Transaction hash of your manual payout" />
              <ActBtn run={() => act('mark_paid', { txid })} ok="Marked as paid" disabled={!txid.trim()} onDone={done}>Mark paid</ActBtn>
            </div>
          )}
          {['review', 'approved', 'stuck'].includes(w.status) && (
            <div className="row gap">
              <Input value={reason} onChange={setReason} placeholder="Reason shown to the user" />
              <ActBtn kind="danger" run={() => act('reject', { reason })} ok="Rejected & refunded" confirm="Reject and refund this withdrawal?" onDone={done}>Reject & refund</ActBtn>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ─────────── deposits ─────────── */
const DEP_TABS = [['no_owner', 'No owner'], ['unrecognized', 'Unknown token'], ['below_min', 'Below min'], ['disabled', 'Disabled coin'], ['seen', 'Confirming'],
  ['credited', 'Credited'], ['ignored', 'Ignored'], ['', 'All']];

function Deposits() {
  const [st, setSt] = useState('no_owner');
  const { data, error, reload } = useLoad('/deposits' + qs({ status: st }));
  const [open, setOpen] = useState(null);
  return (
    <div className="stack">
      <div className="toolbar">
        <Tabs value={st} onChange={setSt} items={DEP_TABS} />
        <ActBtn run={() => post('/deposits-recheck')} ok="Rechecked" onDone={reload}>↻ Re-match unknown tokens</ActBtn>
      </div>
      {error && <Loading error={error} reload={reload} />}
      <Card>
        <Table rows={data?.items} onRow={setOpen} cols={[
          ['Seen', (r) => fmtDate(r.created_at)], ['Network', (r) => r.network], ['Asset', (r) => r.asset || <span className="dim">{(r.contract || '?').slice(0, 10)}</span>],
          ['Amount', (r) => num(r.amount), 'r'], ['To', (r) => <Copy text={r.address || ''}>{(r.address || '').slice(0, 10)}…</Copy>], ['Memo', (r) => r.memo || '—'],
          ['User', (r) => (r.user_id ? <a href={'#/users/' + r.user_id} onClick={(e) => e.stopPropagation()}>{r.user_id}</a> : '—')],
          ['Conf.', (r) => r.confirmations], ['Status', (r) => <Status s={r.status} />],
        ]} />
      </Card>
      {open && <DepositModal d={open} close={() => setOpen(null)} done={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function DepositModal({ d, close, done }) {
  const [uid, setUid] = useState(d.user_id || '');
  const [asset, setAsset] = useState(d.asset || '');
  const [note, setNote] = useState('');
  return (
    <Modal title={`Deposit #${d.id}`} onClose={close}>
      <div className="kv">
        <div><span>Network</span><b>{d.network}</b></div>
        <div><span>Tx</span><b><Copy text={d.txid}>{d.txid.slice(0, 26)}…</Copy></b></div>
        <div><span>From</span><b>{d.from_address ? <Copy text={d.from_address} /> : '—'}</b></div>
        <div><span>To</span><b>{d.address ? <Copy text={d.address} /> : '—'}</b></div>
        {d.contract && <div><span>Token contract</span><b><Copy text={d.contract} /></b></div>}
        <div><span>Amount</span><b>{num(d.amount)} {d.asset || '(unknown token)'}</b></div>
        <div><span>Status</span><b><Status s={d.status} /></b></div>
        {d.note && <div><span>Note</span><b>{d.note}</b></div>}
      </div>
      {d.status !== 'credited' && d.status !== 'seen' && (
        <div className="stack">
          {d.status === 'unrecognized' && <div className="alert info">To accept this token for everyone, add it under Coins &amp; networks → Tokens with this contract — waiting deposits are credited automatically.</div>}
          <div className="form2">
            <Field label="Credit to user ID"><Input value={uid} onChange={setUid} /></Field>
            <Field label="Asset"><Input value={asset} onChange={(v) => setAsset(v.toUpperCase())} /></Field>
          </div>
          <ActBtn kind="primary" disabled={!uid || !asset} run={() => post(`/deposits/${d.id}/credit`, { user_id: uid, asset })} ok="Credited"
            confirm={`Credit ${d.amount} ${asset} to user ${uid}?`} onDone={done}>Credit deposit</ActBtn>
          <div className="row gap">
            <Input value={note} onChange={setNote} placeholder="Note (why ignored)" />
            <ActBtn run={() => post(`/deposits/${d.id}/ignore`, { note })} ok="Ignored" onDone={done}>Ignore</ActBtn>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ─────────── treasury ─────────── */
function Treasury() {
  const { data: t, error, reload } = useLoad('/treasury');
  if (!t) return <Loading error={error} reload={reload} />;
  const gap = Number(t.reserves_usd) - Number(t.liabilities_usd);
  return (
    <div className="stack">
      <div className="grid4">
        <Stat label="User liabilities" value={usd(t.liabilities_usd)} />
        <Stat label="Reserves (hot + unswept)" value={usd(t.reserves_usd)} />
        <Stat label="Difference" value={usd(gap)} tone={gap >= 0 ? 'ok' : 'danger'} />
        <Stat label="Balances checked" value={fmtAgo(t.updated_at)} />
      </div>
      <Card title="Coverage by asset" right={<ActBtn small run={() => post('/treasury/refresh')} ok="Balances refreshed" onDone={reload}>↻ Read on-chain balances</ActBtn>}>
        <Table rows={t.rows} rowKey={(r) => r.asset} cols={[
          ['Asset', (r) => <b>{r.asset}</b>], ['Owed to users', (r) => num(r.liabilities), 'r'], ['Hot wallet', (r) => num(r.hot), 'r'],
          ['Unswept deposits', (r) => num(r.unswept), 'r'], ['Coverage', (r) => <span className={Number(r.coverage_pct) < 100 ? 'down' : 'up'}>{r.coverage_pct}%</span>, 'r'],
          ['Gap USD', (r) => <span className={Number(r.usd_gap) < 0 ? 'down' : ''}>{usd(r.usd_gap)}</span>, 'r'],
        ]} />
      </Card>
      <div className="grid2">
        <Card title="Hot wallets (treasury, HD index 0)">
          <p className="dim small">Fund these addresses with the native coin of each network (gas) and with tokens for payouts. EVM is one address for all 7 EVM networks.</p>
          <div className="kv">
            {Object.entries(t.hot_addresses || {}).map(([fam, a]) => <div key={fam}><span>{fam.toUpperCase()}</span><b><Copy text={a} /></b></div>)}
          </div>
        </Card>
        <Card title="Networks">
          <Table rows={t.networks} cols={[
            ['Network', (r) => <b>{r.id}</b>], ['Payouts', (r) => <Badge tone={r.withdraw_mode === 'auto' ? 'ok' : 'warn'}>{r.withdraw_mode}</Badge>],
            ['Auto sweep', (r) => (r.config.auto_sweep ? 'on' : 'off')], ['RPC', (r) => <span className="small dim">{r.rpc ? r.rpc.replace(/(api[-_]?key=)[^&]+/i, '$1•••') : 'default'}</span>],
            ['', (r) => <ActBtn small run={() => post('/treasury/sweep', { network: r.id })} ok="Sweep started" confirm={`Sweep user deposit addresses on ${r.id} into the hot wallet now?`}>Sweep now</ActBtn>],
          ]} />
        </Card>
      </div>
      <Card title="Treasury operations">
        <Table rows={t.ops} cols={[
          ['When', (r) => fmtDate(r.created_at)], ['Network', (r) => r.network], ['Kind', (r) => r.kind], ['Amount', (r) => `${num(r.amount)} ${r.asset || ''}`, 'r'],
          ['From', (r) => <Copy text={r.from_address || ''}>{(r.from_address || '').slice(0, 10)}</Copy>], ['Tx', (r) => (r.txid ? <Copy text={r.txid}>{r.txid.slice(0, 12)}…</Copy> : '—')],
          ['Status', (r) => <Status s={r.status} />], ['Error', (r) => <span className="down small">{r.error || ''}</span>],
        ]} />
      </Card>
    </div>
  );
}

/* ─────────── revenue ─────────── */
function Revenue() {
  const [days, setDays] = useState(30);
  const { data: r, error, reload } = useLoad('/revenue' + qs({ days }));
  if (!r) return <Loading error={error} reload={reload} />;
  const total = (d) => Object.entries(d).filter(([k]) => k !== 'day').reduce((a, [, v]) => a + v, 0);
  return (
    <div className="stack">
      <Tabs value={days} onChange={setDays} items={[[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']]} />
      <div className="grid4">
        <Stat label="Total revenue" value={usd(r.total)} tone="ember" />
        {Object.entries(r.by_source).map(([k, v]) => <Stat key={k} label={k} value={usd(v)} />)}
      </div>
      <Card title="Daily revenue">
        <Bars data={r.by_day} value={total} label={(d) => new Date(d.day * 1000).toLocaleDateString()} fmt={usd} height={160} />
      </Card>
      <Card title="Recent swaps">
        <Table rows={r.swaps} cols={[
          ['When', (s) => fmtDate(s.created_at)], ['User', (s) => <a href={'#/users/' + s.user_id}>{s.user_id}</a>],
          ['Sold', (s) => `${num(s.amount_in)} ${s.from_asset}`, 'r'], ['Bought', (s) => `${num(s.amount_out)} ${s.to_asset}`, 'r'],
          ['Volume', (s) => usd(s.volume_usd), 'r'], ['Spread', (s) => `${s.spread_pct}%`, 'r'], ['Profit', (s) => usd(s.profit_usd), 'r'],
        ]} />
      </Card>
    </div>
  );
}

