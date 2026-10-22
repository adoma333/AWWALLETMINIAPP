import { useState } from 'react';
import {
  ActBtn, Badge, Btn, can, Card, Copy, del, Field, fmtAgo, Input, JsonEdit, Loading, Modal, num, patch, post, Select, Table, Tabs, Toggle, useAction,
  useLoad, usd,
} from '../lib.jsx';

const jl = (v, d = {}) => {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || '') ?? d; } catch { return d; }
};

export default function Catalog({ me }) {
  const [tab, setTab] = useState('assets');
  const { data, error, reload } = useLoad('/catalog');
  if (!data) return <Loading error={error} reload={reload} />;
  const edit = can(me, 'catalog');
  return (
    <div className="stack">
      <Tabs value={tab} onChange={setTab} items={[['assets', 'Coins'], ['networks', 'Networks'], ['tokens', 'Tokens per network']]} />
      {tab === 'assets' && <Assets data={data} reload={reload} edit={edit} />}
      {tab === 'networks' && <Networks data={data} reload={reload} edit={edit} />}
      {tab === 'tokens' && <Tokens data={data} reload={reload} edit={edit} feesOnly={!edit && can(me, 'fees')} />}
    </div>
  );
}

function Flag({ row, field, path, reload, edit }) {
  const act = useAction();
  return <Toggle on={!!row[field]} disabled={!edit} onChange={async (v) => { if (await act(() => patch(path, { [field]: v ? 1 : 0 }), { ok: 'Saved' })) reload(); }} />;
}

/* ─────────── coins ─────────── */
function Assets({ data, reload, edit }) {
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  return (
    <Card title={`${data.assets.length} coins`} right={edit && <>
      <ActBtn small ok="Synced" onDone={reload} run={() => post('/coins/sync')}>Sync names &amp; logos</ActBtn>
      <Btn kind="primary" small onClick={() => setAdding(true)}>+ Add coin</Btn>
    </>}>
      <p className="dim small">Turn a coin off to hide it everywhere. Swap / P2P / transfer switches control each feature separately.
        Official names, logos and market data are refreshed daily (by each coin's CoinGecko id) and stored on your server. A coin you renamed, or a logo
        you uploaded under Icons &amp; media (key <code>asset:SYMBOL</code>), is never overwritten.</p>
      <Table rows={data.assets} rowKey={(r) => r.id} cols={[
        ['Coin', (r) => <b>{r.id} <span className="dim small">{r.name}</span></b>],
        ['Price', (r) => (data.prices[r.id] ? <>{usd(data.prices[r.id].usd)} <span className="dim small">{fmtAgo(data.prices[r.id].updated_at)}</span></> : <span className="down">no price</span>), 'r'],
        ['Enabled', (r) => <Flag row={r} field="enabled" path={'/assets/' + r.id} reload={reload} edit={edit} />],
        ['Swap', (r) => <Flag row={r} field="swap_enabled" path={'/assets/' + r.id} reload={reload} edit={edit} />],
        ['P2P', (r) => <Flag row={r} field="p2p_enabled" path={'/assets/' + r.id} reload={reload} edit={edit} />],
        ['Transfers', (r) => <Flag row={r} field="transfer_enabled" path={'/assets/' + r.id} reload={reload} edit={edit} />],
        ['Badges', (r) => jl(r.badges, []).map((b) => <Badge key={b} tone="ember">{b}</Badge>)],
        ['Networks', (r) => data.asset_networks.filter((x) => x.asset === r.id).length],
        ['', (r) => edit && <Btn small onClick={() => setOpen(r)}>Edit</Btn>],
      ]} />
      {open && <AssetModal a={open} close={() => setOpen(null)} done={() => { setOpen(null); reload(); }} />}
      {adding && <AddAsset close={() => setAdding(false)} done={() => { setAdding(false); reload(); }} />}
    </Card>
  );
}

function AssetModal({ a, close, done }) {
  const [f, setF] = useState({ name: a.name, color: a.color || '', display: a.display, sort: a.sort, coingecko_id: a.coingecko_id || '',
    price_symbol: a.price_symbol || '', badges: jl(a.badges, []).join(', '), is_stable: !!a.is_stable });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal title={`Edit ${a.id}`} onClose={close}>
      <div className="form2">
        <Field label="Name"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Brand colour"><Input value={f.color} onChange={set('color')} placeholder="#26A17B" /></Field>
        <Field label="Display decimals"><Input type="number" value={f.display} onChange={set('display')} /></Field>
        <Field label="Sort order"><Input type="number" value={f.sort} onChange={set('sort')} /></Field>
        <Field label="Price symbol (exchanges)" hint="e.g. TON → TONUSDT"><Input value={f.price_symbol} onChange={set('price_symbol')} /></Field>
        <Field label="CoinGecko id"><Input value={f.coingecko_id} onChange={set('coingecko_id')} /></Field>
      </div>
      <Field label="Badges (comma separated)" hint="Shown next to the coin in the wallet, e.g. no fees, instant, new"><Input value={f.badges} onChange={set('badges')} /></Field>
      <Toggle on={f.is_stable} onChange={set('is_stable')} label="Stablecoin (priced at $1 when sources fail)" />
      <ActBtn kind="primary" ok="Saved" onDone={done} run={() => patch('/assets/' + a.id, {
        ...f, display: Number(f.display), sort: Number(f.sort), is_stable: f.is_stable ? 1 : 0,
        badges: f.badges.split(',').map((x) => x.trim()).filter(Boolean),
      })}>Save</ActBtn>
    </Modal>
  );
}

function AddAsset({ close, done }) {
  const [f, setF] = useState({ id: '', name: '', precision: 8, display: 4, price_symbol: '', coingecko_id: '', is_stable: false });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal title="Add a coin" onClose={close}>
      <p className="dim small">After adding the coin, list it on one or more networks under “Tokens per network” (contract + decimals).</p>
      <div className="form2">
        <Field label="Symbol"><Input value={f.id} onChange={(v) => set('id')(v.toUpperCase())} placeholder="e.g. NOT" /></Field>
        <Field label="Name"><Input value={f.name} onChange={set('name')} placeholder="Notcoin" /></Field>
        <Field label="Internal decimals"><Input type="number" value={f.precision} onChange={set('precision')} /></Field>
        <Field label="Display decimals"><Input type="number" value={f.display} onChange={set('display')} /></Field>
        <Field label="Price symbol"><Input value={f.price_symbol} onChange={set('price_symbol')} placeholder="same as symbol" /></Field>
        <Field label="CoinGecko id"><Input value={f.coingecko_id} onChange={set('coingecko_id')} /></Field>
      </div>
      <Toggle on={f.is_stable} onChange={set('is_stable')} label="Stablecoin" />
      <ActBtn kind="primary" ok="Coin added" disabled={!f.id} onDone={done} run={() => post('/assets', f)}>Add coin</ActBtn>
    </Modal>
  );
}

/* ─────────── networks ─────────── */
function Networks({ data, reload, edit }) {
  const [open, setOpen] = useState(null);
  const [check, setCheck] = useState(null);
  return (
    <Card title="Networks">
      <p className="dim small"><b>Payout mode</b>: <i>manual</i> = every withdrawal waits for you to pay it and mark it paid; <i>auto</i> = the hot wallet signs and sends automatically
        (within the limits under Settings → limits). Fund the hot wallet (Treasury page) before switching to auto.</p>
      <Table rows={data.networks} rowKey={(r) => r.id} cols={[
        ['Network', (r) => <b>{r.name} <span className="dim small">{r.id}</span></b>],
        ['On', (r) => <Flag row={r} field="enabled" path={'/networks/' + r.id} reload={reload} edit={edit} />],
        ['Deposits', (r) => <Flag row={r} field="deposit_enabled" path={'/networks/' + r.id} reload={reload} edit={edit} />],
        ['Withdrawals', (r) => <Flag row={r} field="withdraw_enabled" path={'/networks/' + r.id} reload={reload} edit={edit} />],
        ['Payouts', (r) => <Badge tone={r.withdraw_mode === 'auto' ? 'ok' : 'warn'}>{r.withdraw_mode}</Badge>],
        ['Confirmations', (r) => r.confirmations, 'r'],
        ['ETA', (r) => r.eta || '—'],
        ['Auto sweep', (r) => (jl(r.config).auto_sweep ? 'on' : 'off')],
        ['', (r) => edit && <div className="row gap">
          {r.kind === 'evm' && <Btn small onClick={() => setCheck(r)}>Verify</Btn>}
          <Btn small onClick={() => setOpen(r)}>Edit</Btn>
        </div>],
      ]} />
      {open && <NetworkModal n={open} close={() => setOpen(null)} done={() => { setOpen(null); reload(); }} />}
      {check && <VerifyModal n={check} close={() => { setCheck(null); reload(); }} />}
    </Card>
  );
}

/** Reads the chain id and every token's symbol() / decimals() straight from the network's RPC. */
function VerifyModal({ n, close }) {
  const [res, setRes] = useState(null);
  const run = (fix) => post(`/networks/${n.id}/verify`, { fix }).then((r) => { setRes(r); return r; });
  return (
    <Modal title={`Verify ${n.name} on-chain`} onClose={close} wide>
      <p className="dim small">Checks that the RPC answers with chain id {n.chain_id} and that each listed contract really is that coin with the
        decimals you set. Do this, then a small test deposit and withdrawal, before you switch a network on.</p>
      <div className="row gap">
        <ActBtn kind="primary" ok="Checked" run={() => run(false)}>Run check</ActBtn>
        {res && res.tokens?.some((t) => t.chain_decimals != null && t.chain_decimals !== t.decimals) &&
          <ActBtn ok="Decimals fixed" run={() => run(true)}>Fix decimals from chain</ActBtn>}
      </div>
      {res && <>
        <p className="small" style={{ marginTop: 12 }}>
          <Badge tone={res.ok ? 'ok' : 'bad'}>{res.ok ? 'all good' : 'needs attention'}</Badge>{' '}
          RPC <code>{res.rpc}</code> · chain id {res.chain_id ?? '—'}
          {res.chain_id != null && res.chain_id !== res.expected_chain_id && <b className="bad"> (expected {res.expected_chain_id})</b>}
          {res.error && <span className="bad"> {res.error}</span>}
        </p>
        <Table rows={res.tokens} rowKey={(t) => t.contract} cols={[
          ['Coin', (t) => <b>{t.asset}</b>],
          ['Contract', (t) => <Copy text={t.contract}>{t.contract.slice(0, 8)}…{t.contract.slice(-4)}</Copy>],
          ['On-chain symbol', (t) => t.chain_symbol || <span className="dim">—</span>],
          ['Decimals (set / chain)', (t) => `${t.decimals} / ${t.chain_decimals ?? '—'}`],
          ['', (t) => <Badge tone={t.ok ? 'ok' : 'bad'}>{t.ok ? 'ok' : (t.error ? 'error' : 'mismatch')}</Badge>],
        ]} />
      </>}
    </Modal>
  );
}

function NetworkModal({ n, close, done }) {
  const cfg = jl(n.config);
  const [f, setF] = useState({ name: n.name, short: n.short || '', withdraw_mode: n.withdraw_mode, confirmations: n.confirmations, eta: n.eta || '',
    color: n.color || '', sort: n.sort, badges: jl(n.badges, []).join(', '), rpc: cfg.rpc || '', auto_sweep: !!cfg.auto_sweep,
    sweep_min_usd: cfg.sweep_min_usd ?? '10' });
  const [extra, setExtra] = useState(() => Object.fromEntries(Object.entries(cfg).filter(([k]) => !['rpc', 'auto_sweep', 'sweep_min_usd'].includes(k))));
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal title={`Edit ${n.name}`} onClose={close} wide>
      <div className="form2">
        <Field label="Name"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Short label"><Input value={f.short} onChange={set('short')} placeholder="TRC-20" /></Field>
        <Field label="Payout mode"><Select value={f.withdraw_mode} onChange={set('withdraw_mode')} options={[['manual', 'manual — I pay withdrawals'], ['auto', 'auto — hot wallet sends']]} /></Field>
        <Field label="Confirmations before credit"><Input type="number" value={f.confirmations} onChange={set('confirmations')} /></Field>
        <Field label="ETA text"><Input value={f.eta} onChange={set('eta')} placeholder="~1 min" /></Field>
        <Field label="Sort"><Input type="number" value={f.sort} onChange={set('sort')} /></Field>
        <Field label="Colour"><Input value={f.color} onChange={set('color')} /></Field>
        <Field label="Badges" hint="comma separated, e.g. instant, low fee"><Input value={f.badges} onChange={set('badges')} /></Field>
      </div>
      <Field label="RPC endpoint" hint="Leave empty to use the value from .env / the public default. Use a private RPC (Alchemy, QuickNode, Ankr…) in production." wide>
        <Input value={f.rpc} onChange={set('rpc')} placeholder="https://…" />
      </Field>
      <div className="row gap wrap">
        <Toggle on={f.auto_sweep} onChange={set('auto_sweep')} label="Auto-sweep deposits into the hot wallet" />
        <Field label="Sweep minimum (USD)"><Input type="number" value={f.sweep_min_usd} onChange={set('sweep_min_usd')} /></Field>
      </div>
      <Field label="Advanced config (JSON)"><JsonEdit value={extra} onChange={setExtra} rows={5} /></Field>
      <ActBtn kind="primary" ok="Saved" onDone={done} run={() => patch('/networks/' + n.id, {
        name: f.name, short: f.short, withdraw_mode: f.withdraw_mode, confirmations: Number(f.confirmations), eta: f.eta, color: f.color,
        sort: Number(f.sort), badges: f.badges.split(',').map((x) => x.trim()).filter(Boolean),
        config: { ...extra, ...(f.rpc.trim() ? { rpc: f.rpc.trim() } : {}), auto_sweep: f.auto_sweep, sweep_min_usd: String(f.sweep_min_usd) },
      })}>Save</ActBtn>
    </Modal>
  );
}

/* ─────────── tokens per network ─────────── */
function Tokens({ data, reload, edit, feesOnly }) {
  const [net, setNet] = useState('');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const rows = data.asset_networks.filter((r) => !net || r.network === net);
  return (
    <Card title="Tokens per network" right={<>
      <Select value={net} onChange={setNet} options={[['', 'All networks'], ...data.networks.map((n) => [n.id, n.name])]} />
      {edit && <Btn kind="primary" small onClick={() => setAdding(true)}>+ List token</Btn>}
    </>}>
      <p className="dim small">Each row is one coin on one network: contract, minimums and the withdrawal fee charged to users. Deposits of unknown tokens wait under Deposits → Unknown token and are credited automatically once you list the contract here.</p>
      <Table rows={rows} rowKey={(r) => r.asset + r.network} cols={[
        ['Coin', (r) => <b>{r.asset}</b>], ['Network', (r) => r.network],
        ['Contract', (r) => (r.contract ? <Copy text={r.contract}>{r.contract.slice(0, 8)}…{r.contract.slice(-4)}</Copy> : <span className="dim">native</span>)],
        ['On', (r) => <Flag row={r} field="enabled" path={`/asset-networks/${r.asset}/${r.network}`} reload={reload} edit={edit} />],
        ['Deposit', (r) => <Flag row={r} field="deposit_enabled" path={`/asset-networks/${r.asset}/${r.network}`} reload={reload} edit={edit} />],
        ['Withdraw', (r) => <Flag row={r} field="withdraw_enabled" path={`/asset-networks/${r.asset}/${r.network}`} reload={reload} edit={edit} />],
        ['Min dep.', (r) => num(r.min_deposit), 'r'], ['Min wd.', (r) => num(r.min_withdraw), 'r'],
        ['Wd. fee', (r) => (r.fee_mode === 'dynamic' ? <span title="network gas × markup">dynamic</span> : `${num(r.withdraw_fee)}${Number(r.withdraw_fee_pct) ? ` + ${r.withdraw_fee_pct}%` : ''}`), 'r'],
        ['', (r) => (edit || feesOnly) && <Btn small onClick={() => setOpen(r)}>Edit</Btn>],
      ]} />
      {open && <TokenModal t={open} feesOnly={feesOnly} close={() => setOpen(null)} done={() => { setOpen(null); reload(); }} />}
      {adding && <AddToken data={data} close={() => setAdding(false)} done={() => { setAdding(false); reload(); }} />}
    </Card>
  );
}

function TokenModal({ t, feesOnly, close, done }) {
  const [f, setF] = useState({ min_deposit: t.min_deposit, min_withdraw: t.min_withdraw, max_withdraw: t.max_withdraw, withdraw_fee: t.withdraw_fee,
    withdraw_fee_pct: t.withdraw_fee_pct, fee_mode: t.fee_mode || 'fixed', decimals: t.decimals, contract: t.contract || '', sort: t.sort });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const path = `/asset-networks/${t.asset}/${t.network}`;
  return (
    <Modal title={`${t.asset} on ${t.network}`} onClose={close}>
      <div className="form2">
        <Field label="Min deposit"><Input value={f.min_deposit} onChange={set('min_deposit')} /></Field>
        <Field label="Min withdrawal"><Input value={f.min_withdraw} onChange={set('min_withdraw')} /></Field>
        <Field label="Max withdrawal" hint="0 = no maximum"><Input value={f.max_withdraw} onChange={set('max_withdraw')} /></Field>
        <Field label="Fee mode"><Select value={f.fee_mode} onChange={set('fee_mode')} options={[['fixed', 'Fixed amount'], ['dynamic', 'Dynamic (live gas)']]} /></Field>
        <Field label="Fixed withdrawal fee" hint={`in ${t.asset}`}><Input value={f.withdraw_fee} onChange={set('withdraw_fee')} /></Field>
        <Field label="Extra fee %"><Input value={f.withdraw_fee_pct} onChange={set('withdraw_fee_pct')} /></Field>
        {!feesOnly && <Field label="Decimals"><Input type="number" value={f.decimals} onChange={set('decimals')} /></Field>}
        {!feesOnly && <Field label="Sort"><Input type="number" value={f.sort} onChange={set('sort')} /></Field>}
      </div>
      <div className="row gap wrap">
        <ActBtn kind="primary" ok="Saved" onDone={done} run={() => patch(path, feesOnly
          ? { min_deposit: f.min_deposit, min_withdraw: f.min_withdraw, max_withdraw: f.max_withdraw, withdraw_fee: f.withdraw_fee, withdraw_fee_pct: f.withdraw_fee_pct, fee_mode: f.fee_mode }
          : { ...f, decimals: Number(f.decimals), sort: Number(f.sort), contract: f.contract || null })}>Save</ActBtn>
        {!feesOnly && <ActBtn kind="danger" ok="Removed" confirm={`Remove ${t.asset} from ${t.network}? Balances are kept; deposits of it will stop being recognised.`}
          onDone={done} run={() => del(path)}>Remove from network</ActBtn>}
      </div>
    </Modal>
  );
}

function AddToken({ data, close, done }) {
  const [f, setF] = useState({ asset: data.assets[0]?.id, network: data.networks[0]?.id, contract: '', decimals: 18, min_deposit: '0', min_withdraw: '0', withdraw_fee: '0' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const presets = { tron: 6, ton: 9, sol: 6, btc: 8 };
  return (
    <Modal title="List a token on a network" onClose={close}>
      <div className="form2">
        <Field label="Coin"><Select value={f.asset} onChange={set('asset')} options={data.assets.map((a) => [a.id, a.id])} /></Field>
        <Field label="Network"><Select value={f.network} onChange={(v) => setF((x) => ({ ...x, network: v, decimals: presets[v] ?? x.decimals }))} options={data.networks.map((n) => [n.id, n.name])} /></Field>
      </div>
      <Field label="Contract / mint / jetton master" hint="Empty = the network's native coin"><Input value={f.contract} onChange={set('contract')} /></Field>
      <div className="form2">
        <Field label="Decimals" hint="Check the explorer — wrong decimals credit wrong amounts"><Input type="number" value={f.decimals} onChange={set('decimals')} /></Field>
        <Field label="Min deposit"><Input value={f.min_deposit} onChange={set('min_deposit')} /></Field>
        <Field label="Min withdrawal"><Input value={f.min_withdraw} onChange={set('min_withdraw')} /></Field>
        <Field label="Withdrawal fee"><Input value={f.withdraw_fee} onChange={set('withdraw_fee')} /></Field>
      </div>
      <ActBtn kind="primary" ok="Token listed" onDone={done} run={() => post('/asset-networks', { ...f, decimals: Number(f.decimals) })}>List token</ActBtn>
    </Modal>
  );
}
