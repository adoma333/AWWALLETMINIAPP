import { useState } from 'react';
import {
  ActBtn, Badge, Btn, can, Card, del, Field, fmtDate, Input, Loading, Modal, num, patch, post, put, Select, Table, Toggle, useAction, useLoad, usd,
} from '../lib.jsx';

const KINDS = ['swap', 'withdraw', 'transfer', 'gift', 'p2p_maker', 'p2p_taker'];
const SCOPES = [
  ['global', 'Everyone', ''], ['asset', 'Coin', 'USDT'], ['network', 'Network', 'tron'], ['asset_network', 'Coin on network', 'USDT:tron'],
  ['pair', 'Swap pair', 'TON/USDT'], ['role', 'User role', 'merchant'], ['user', 'One user', 'Telegram ID'],
];
const jl = (v, d) => { try { return typeof v === 'string' ? JSON.parse(v) : v ?? d; } catch { return d; } };
const toTs = (s) => (s ? Math.floor(new Date(s).getTime() / 1000) : null);
const fromTs = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 16) : '');

export default function Fees({ me }) {
  const { data, error, reload } = useLoad('/fees');
  const [rule, setRule] = useState(null);
  const [promo, setPromo] = useState(null);
  const act = useAction();
  if (!data) return <Loading error={error} reload={reload} />;
  const edit = can(me, 'fees');

  return (
    <div className="stack">
      <div className="alert info">
        How a fee is chosen: the most specific active rule wins — <b>one user → role → swap pair → coin on network → network → coin → everyone</b>.
        Then the user's VIP discount, active promotions and fee-free vouchers are applied. The swap <b>spread</b> (rate margin) is set under Settings → swap.
      </div>

      <Card title="Fee rules" right={edit && <Btn kind="primary" small onClick={() => setRule({ kind: 'swap', scope: 'global', scope_id: '', pct: '0', fixed: '0', min_fee: '', max_fee: '', active: 1, note: '' })}>+ New rule</Btn>}>
        <Table rows={data.rules} empty="No fee rules — built-in defaults apply" cols={[
          ['Operation', (r) => <b>{r.kind}</b>],
          ['Applies to', (r) => <>{SCOPES.find((s) => s[0] === r.scope)?.[1] || r.scope} {r.scope_id && <Badge>{r.scope_id}</Badge>}</>],
          ['%', (r) => (r.pct ? `${r.pct}%` : '—'), 'r'], ['Fixed (USD)', (r) => (Number(r.fixed) ? usd(r.fixed) : '—'), 'r'],
          ['Min / max', (r) => `${r.min_fee ? usd(r.min_fee) : '—'} / ${r.max_fee ? usd(r.max_fee) : '—'}`, 'r'],
          ['Window', (r) => (r.starts_at || r.ends_at ? `${fmtDate(r.starts_at)} → ${fmtDate(r.ends_at)}` : 'always')],
          ['Active', (r) => <Toggle on={!!r.active} disabled={!edit} onChange={async (v) => (await act(() => patch('/fees/rules/' + r.id, { active: v ? 1 : 0 }), { ok: 'Saved' })) && reload()} />],
          ['Note', (r) => <span className="dim small">{r.note}</span>],
          ['', (r) => edit && <Btn small onClick={() => setRule(r)}>Edit</Btn>],
        ]} />
      </Card>

      <Vip tiers={data.vip} reload={reload} edit={edit} />

      <Card title="Promotions" right={edit && <Btn kind="primary" small onClick={() => setPromo({ name: '', kinds: [], assets: [], discount_pct: '100', active: 1 })}>+ New promotion</Btn>}>
        <p className="dim small">A promotion discounts fees for everyone during a window — e.g. “Zero swap fees this weekend”. 100% = free.</p>
        <Table rows={data.promos} empty="No promotions" cols={[
          ['Name', (r) => <b>{r.name}</b>], ['Discount', (r) => `${r.discount_pct}%`],
          ['Operations', (r) => (jl(r.kinds, []).join(', ') || 'all')], ['Coins', (r) => (jl(r.assets, []).join(', ') || 'all')],
          ['Window', (r) => `${fmtDate(r.starts_at)} → ${fmtDate(r.ends_at)}`],
          ['Active', (r) => <Toggle on={!!r.active} disabled={!edit} onChange={async (v) => (await act(() => patch('/fees/promos/' + r.id, { active: v ? 1 : 0 }), { ok: 'Saved' })) && reload()} />],
          ['', (r) => edit && <Btn small onClick={() => setPromo(r)}>Edit</Btn>],
        ]} />
      </Card>

      <Card title="Withdrawal fees" right={<a href="#/catalog">Edit under Coins & networks → Tokens →</a>}>
        <Table rows={data.withdraw} rowKey={(r) => r.asset + r.network} cols={[
          ['Coin', (r) => <b>{r.asset}</b>], ['Network', (r) => r.network],
          ['Fee', (r) => (r.fee_mode === 'dynamic' ? 'dynamic (live gas)' : `${num(r.withdraw_fee)} ${r.asset}`), 'r'],
          ['+%', (r) => (Number(r.withdraw_fee_pct) ? r.withdraw_fee_pct + '%' : '—'), 'r'],
          ['Network cost now', (r) => (data.gas[r.network] ? usd(data.gas[r.network]) : '—'), 'r'],
          ['Min withdrawal', (r) => num(r.min_withdraw), 'r'],
        ]} />
      </Card>

      {rule && <RuleModal r={rule} close={() => setRule(null)} done={() => { setRule(null); reload(); }} />}
      {promo && <PromoModal p={promo} close={() => setPromo(null)} done={() => { setPromo(null); reload(); }} />}
    </div>
  );
}

function RuleModal({ r, close, done }) {
  const [f, setF] = useState({ ...r, starts: fromTs(r.starts_at), ends: fromTs(r.ends_at) });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const scope = SCOPES.find((s) => s[0] === f.scope);
  const body = {
    kind: f.kind, scope: f.scope, scope_id: f.scope === 'global' ? null : (f.scope_id || '').trim(), pct: String(f.pct || '0'), fixed: String(f.fixed || '0'),
    min_fee: f.min_fee === '' || f.min_fee == null ? null : String(f.min_fee), max_fee: f.max_fee === '' || f.max_fee == null ? null : String(f.max_fee),
    active: f.active ? 1 : 0, starts_at: toTs(f.starts), ends_at: toTs(f.ends), note: f.note || '',
  };
  return (
    <Modal title={r.id ? 'Edit fee rule' : 'New fee rule'} onClose={close}>
      <div className="form2">
        <Field label="Operation"><Select value={f.kind} onChange={set('kind')} options={KINDS} /></Field>
        <Field label="Applies to"><Select value={f.scope} onChange={set('scope')} options={SCOPES.map((s) => [s[0], s[1]])} /></Field>
        {f.scope !== 'global' && <Field label="Which one" hint={`e.g. ${scope?.[2]}`}><Input value={f.scope_id} onChange={set('scope_id')} /></Field>}
        <Field label="Percentage %"><Input value={f.pct} onChange={set('pct')} /></Field>
        <Field label="Fixed part (USD)"><Input value={f.fixed} onChange={set('fixed')} /></Field>
        <Field label="Minimum fee (USD)"><Input value={f.min_fee ?? ''} onChange={set('min_fee')} /></Field>
        <Field label="Maximum fee (USD)"><Input value={f.max_fee ?? ''} onChange={set('max_fee')} /></Field>
        <Field label="Starts (optional)"><Input type="datetime-local" value={f.starts} onChange={set('starts')} /></Field>
        <Field label="Ends (optional)"><Input type="datetime-local" value={f.ends} onChange={set('ends')} /></Field>
      </div>
      <Field label="Note"><Input value={f.note} onChange={set('note')} /></Field>
      <div className="row gap">
        <ActBtn kind="primary" ok="Saved" onDone={done} run={() => (r.id ? patch('/fees/rules/' + r.id, body) : post('/fees/rules', body))}>Save</ActBtn>
        {r.id && <ActBtn kind="danger" ok="Deleted" confirm="Delete this rule?" onDone={done} run={() => del('/fees/rules/' + r.id)}>Delete</ActBtn>}
      </div>
    </Modal>
  );
}

function PromoModal({ p, close, done }) {
  const [f, setF] = useState({ ...p, kinds: jl(p.kinds, []), assets: jl(p.assets, []).join(', '), starts: fromTs(p.starts_at), ends: fromTs(p.ends_at) });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const body = { name: f.name, kinds: f.kinds, assets: f.assets.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean), discount_pct: String(f.discount_pct),
    starts_at: toTs(f.starts), ends_at: toTs(f.ends), active: f.active ? 1 : 0 };
  return (
    <Modal title={p.id ? 'Edit promotion' : 'New promotion'} onClose={close}>
      <div className="form2">
        <Field label="Name"><Input value={f.name} onChange={set('name')} placeholder="Weekend zero fees" /></Field>
        <Field label="Discount %" hint="100 = free"><Input value={f.discount_pct} onChange={set('discount_pct')} /></Field>
        <Field label="Starts"><Input type="datetime-local" value={f.starts} onChange={set('starts')} /></Field>
        <Field label="Ends"><Input type="datetime-local" value={f.ends} onChange={set('ends')} /></Field>
      </div>
      <Field label="Operations (none = all)">
        <div className="row gap wrap">{KINDS.map((k) => (
          <label key={k} className="chk"><input type="checkbox" checked={f.kinds.includes(k)} onChange={(e) => set('kinds')(e.target.checked ? [...f.kinds, k] : f.kinds.filter((x) => x !== k))} />{k}</label>
        ))}</div>
      </Field>
      <Field label="Coins (comma separated, empty = all)"><Input value={f.assets} onChange={set('assets')} /></Field>
      <div className="row gap">
        <ActBtn kind="primary" ok="Saved" onDone={done} run={() => (p.id ? patch('/fees/promos/' + p.id, body) : post('/fees/promos', body))}>Save</ActBtn>
        {p.id && <ActBtn kind="danger" ok="Deleted" confirm="Delete this promotion?" onDone={done} run={() => del('/fees/promos/' + p.id)}>Delete</ActBtn>}
      </div>
    </Modal>
  );
}

function Vip({ tiers, reload, edit }) {
  const [rows, setRows] = useState(() => tiers.map((t) => ({ ...t })));
  const set = (i, k) => (v) => setRows((x) => x.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Card title="VIP levels" right={edit && <>
      <Btn small onClick={() => setRows((x) => [...x, { level: x.length, name: '', min_volume_usd: '0', fee_discount_pct: '0', limit_multiplier: '1' }])}>+ Level</Btn>
      <ActBtn small kind="primary" ok="VIP levels saved" onDone={reload} run={() => put('/fees/vip', { tiers: rows })}>Save levels</ActBtn>
    </>}>
      <p className="dim small">Users climb automatically by their 30-day volume (swaps + P2P). You can force a level per user from the user page.</p>
      <Table rows={rows} rowKey={(r, i) => i} cols={[
        ['Level', (r) => r.level],
        ['Name', (r) => <Input value={r.name} disabled={!edit} onChange={set(rows.indexOf(r), 'name')} />],
        ['30-day volume ≥ (USD)', (r) => <Input value={r.min_volume_usd} disabled={!edit} onChange={set(rows.indexOf(r), 'min_volume_usd')} />],
        ['Fee discount %', (r) => <Input value={r.fee_discount_pct} disabled={!edit} onChange={set(rows.indexOf(r), 'fee_discount_pct')} />],
        ['Limit ×', (r) => <Input value={r.limit_multiplier} disabled={!edit} onChange={set(rows.indexOf(r), 'limit_multiplier')} />],
        ['', (r) => edit && rows.length > 1 && <Btn small onClick={() => setRows((x) => x.filter((y) => y !== r).map((y, i) => ({ ...y, level: i })))}>×</Btn>],
      ]} />
    </Card>
  );
}
