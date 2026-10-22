import { useState } from 'react';
import {
  ActBtn, Badge, Btn, can, Card, Copy, del, Field, fileToDataUrl, fmtAgo, fmtDate, Input, Loading, post, Select, Stat, Status, Table, useAction,
  useLoad,
} from '../lib.jsx';

export default function Ops({ tab, me }) {
  if (tab === 'icons') return <Icons me={me} />;
  if (tab === 'broadcast') return <Broadcast />;
  if (tab === 'admins') return <Admins me={me} />;
  if (tab === 'audit') return <Audit />;
  return <System me={me} />;
}

/* ─────────── icons & media ─────────── */
function Icons({ me }) {
  const { data, error, reload } = useLoad('/icons');
  const cat = useLoad('/catalog');
  const [key, setKey] = useState('');
  const act = useAction();
  const edit = can(me, 'content');
  const map = Object.fromEntries((data?.items || []).map((i) => [i.key, i]));
  const keys = [
    ...(cat.data?.assets || []).map((a) => 'asset:' + a.id),
    ...(cat.data?.networks || []).map((n) => 'net:' + n.id),
  ];
  const upload = async (k, file) => {
    if (!file || !k) return;
    if (await act(async () => post('/icons/' + encodeURIComponent(k), { data: await fileToDataUrl(file) }), { ok: 'Icon updated — users see it on next open' })) reload();
  };
  if (!data) return <Loading error={error} reload={reload} />;
  return (
    <div className="stack">
      <Card title="Upload a custom icon">
        <p className="dim small">PNG, JPG, WEBP or SVG up to 6 MB (square, 128×128 or larger). Keys: <code>asset:USDT</code> coin · <code>net:tron</code> network ·
          <code>pm:wise</code> payment method · <code>ui:send</code> app icon · <code>badge:instant</code> badge.</p>
        {edit && <div className="row gap wrap">
          <Input value={key} onChange={setKey} placeholder="key, e.g. asset:NOT" list="icon-keys" />
          <datalist id="icon-keys">{keys.map((k) => <option key={k} value={k} />)}</datalist>
          <label className={'btn primary' + (key ? '' : ' disabled')}>Choose file<input type="file" accept="image/*,.svg" hidden disabled={!key}
            onChange={(e) => { upload(key.trim(), e.target.files?.[0]); e.target.value = ''; }} /></label>
        </div>}
      </Card>
      <Card title="Coins & networks">
        <div className="icon-grid">
          {keys.map((k) => (
            <div key={k} className="icon-cell">
              {map[k] ? <img src={map[k].url} alt={k} /> : <span className="ph">default</span>}
              <span className="small">{k}</span>
              {edit && <div className="row gap">
                <label className="btn ghost sm">{map[k] ? 'Replace' : 'Upload'}<input type="file" accept="image/*,.svg" hidden onChange={(e) => { upload(k, e.target.files?.[0]); e.target.value = ''; }} /></label>
                {map[k] && <ActBtn small run={() => del('/icons/' + encodeURIComponent(k))} ok="Restored default" onDone={reload}>×</ActBtn>}
              </div>}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Other custom icons">
        <Table rows={data.items.filter((i) => !keys.includes(i.key))} rowKey={(r) => r.key} empty="None" cols={[
          ['Icon', (r) => <img src={r.url} alt="" className="thumb" />], ['Key', (r) => r.key], ['Updated', (r) => fmtAgo(r.updated_at)],
          ['', (r) => edit && <ActBtn small run={() => del('/icons/' + encodeURIComponent(r.key))} ok="Removed" onDone={reload}>Remove</ActBtn>],
        ]} />
      </Card>
    </div>
  );
}

/* ─────────── broadcast ─────────── */
const LANGS = ['en', 'ar', 'ru', 'tr', 'fa', 'fr', 'es', 'pt', 'de', 'id', 'hi', 'zh', 'uk', 'uz'];

function Broadcast() {
  const hist = useLoad('/broadcasts');
  const [f, setF] = useState({ text: '', segment: 'test', button_text: '', button_path: '', image: '' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const act = useAction();
  return (
    <div className="stack">
      <Card title="New broadcast">
        <p className="dim small">Messages are queued and sent by the worker within Telegram's rate limits (~25/s). Always send a <b>test</b> to yourself first.
          Supports Telegram HTML: &lt;b&gt;, &lt;i&gt;, &lt;a href&gt;.</p>
        <Field label="Message"><textarea className="inp" rows={6} value={f.text} onChange={(e) => set('text')(e.target.value)} /></Field>
        <div className="form2">
          <Field label="Audience"><Select value={f.segment} onChange={set('segment')} options={[['test', 'Test — only me'], ['all', 'All users'], ['active7', 'Active in last 7 days'],
            ['funded', 'Users with a balance'], ...LANGS.map((l) => ['lang:' + l, 'Language: ' + l])]} /></Field>
          <Field label="Image URL (optional)">
            <div className="row gap"><Input value={f.image} onChange={set('image')} />
              <label className="btn ghost sm">Upload<input type="file" accept="image/*" hidden onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const r = await act(async () => post('/upload', { data: await fileToDataUrl(file), folder: 'banners' }), { ok: 'Uploaded' });
                if (r?.url) set('image')(window.location.origin + r.url);
              }} /></label>
            </div>
          </Field>
          <Field label="Button text (opens the app)"><Input value={f.button_text} onChange={set('button_text')} placeholder="Open wallet" /></Field>
          <Field label="Button path" hint="e.g. /swap, /rewards, /p2p"><Input value={f.button_path} onChange={set('button_path')} /></Field>
        </div>
        <ActBtn kind="primary" disabled={!f.text.trim()} ok="Broadcast queued" onDone={hist.reload}
          confirm={f.segment === 'test' ? undefined : `Send this message to "${f.segment}"?`}
          run={() => post('/broadcast', f)}>{f.segment === 'test' ? 'Send test to me' : 'Send broadcast'}</ActBtn>
      </Card>
      <Card title="History" right={<Btn small onClick={hist.reload}>↻</Btn>}>
        <Table rows={hist.data?.items} cols={[
          ['When', (r) => fmtDate(r.created_at)], ['Audience', (r) => r.segment], ['Text', (r) => <span className="small">{(r.text || '').slice(0, 80)}</span>],
          ['Progress', (r) => `${r.sent}/${r.total}${r.failed ? ` · ${r.failed} failed` : ''}`], ['Status', (r) => <Status s={r.status} />],
        ]} />
      </Card>
    </div>
  );
}

/* ─────────── team ─────────── */
const ROLE_INFO = {
  owner: 'Everything (set in ADMIN_IDS on the server)',
  admin: 'Everything except managing the team',
  finance: 'Withdrawals, deposits, treasury, revenue, balance adjustments',
  support: 'Tickets, P2P appeals, read-only users',
  viewer: 'Read-only',
};

function Admins({ me }) {
  const { data, error, reload } = useLoad('/admins');
  const [f, setF] = useState({ user: '', role: 'support' });
  const owner = can(me, '*');
  if (!data) return <Loading error={error} reload={reload} />;
  return (
    <div className="stack">
      <Card title="Team">
        <Table rows={data.items} rowKey={(r) => r.user_id} cols={[
          ['Member', (r) => <a href={'#/users/' + r.user_id}>{r.name || r.user_id}</a>], ['Telegram ID', (r) => <Copy text={String(r.user_id)} />],
          ['Role', (r) => <Badge tone={r.role === 'owner' ? 'ember' : ''}>{r.role}</Badge>], ['Can', (r) => <span className="small dim">{ROLE_INFO[r.role]}</span>],
          ['Added', (r) => (r.fixed ? 'server config' : fmtDate(r.created_at))],
          ['', (r) => owner && !r.fixed && <ActBtn small kind="danger" run={() => del('/admins/' + r.user_id)} confirm="Remove this team member? Their access ends immediately." ok="Removed" onDone={reload}>Remove</ActBtn>],
        ]} />
      </Card>
      {owner && <Card title="Add a team member">
        <p className="dim small">The person must have opened the bot at least once. They sign in by sending /admin to the bot.</p>
        <div className="row gap wrap">
          <Input value={f.user} onChange={(v) => setF((x) => ({ ...x, user: v }))} placeholder="@username or Telegram ID" />
          <Select value={f.role} onChange={(v) => setF((x) => ({ ...x, role: v }))} options={['admin', 'finance', 'support', 'viewer']} />
          <ActBtn kind="primary" disabled={!f.user.trim()} ok="Added" onDone={() => { setF({ user: '', role: 'support' }); reload(); }}
            run={() => post('/admins', { user: f.user.trim(), user_id: /^\d+$/.test(f.user.trim()) ? Number(f.user.trim()) : undefined, role: f.role })}>Add</ActBtn>
        </div>
      </Card>}
    </div>
  );
}

/* ─────────── audit ─────────── */
function Audit() {
  const { data, error, reload } = useLoad('/audit?limit=500');
  const [q, setQ] = useState('');
  const rows = data?.items.filter((r) => !q || `${r.action} ${r.target} ${r.actor_id} ${r.data}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card title="Every admin action" right={<Input value={q} onChange={setQ} placeholder="Filter" />}>
      {error && <Loading error={error} reload={reload} />}
      <Table rows={rows} cols={[
        ['When', (r) => fmtDate(r.created_at)], ['Admin', (r) => <a href={'#/users/' + r.actor_id}>{r.actor_id}</a>], ['Role', (r) => r.actor],
        ['Action', (r) => <b>{r.action}</b>], ['Target', (r) => r.target || '—'], ['Details', (r) => <span className="small mono">{(r.data || '').slice(0, 140)}</span>], ['IP', (r) => r.ip || '—'],
      ]} />
    </Card>
  );
}

/* ─────────── system & alerts ─────────── */
function System({ me }) {
  const { data: s, error, reload } = useLoad('/system');
  const alerts = useLoad('/alerts');
  const [audit, setAudit] = useState(null);
  if (!s) return <Loading error={error} reload={reload} />;
  const hbOk = s.worker_heartbeat && Date.now() / 1000 - s.worker_heartbeat < 180;
  return (
    <div className="stack">
      <div className="grid4">
        <Stat label="Worker" value={hbOk ? 'running' : 'down'} sub={'heartbeat ' + fmtAgo(s.worker_heartbeat)} tone={hbOk ? 'ok' : 'danger'} />
        <Stat label="HD wallet" value={s.wallet_ready ? 'ready' : 'not set'} tone={s.wallet_ready ? 'ok' : 'danger'} />
        <Stat label="Zohra AI" value={s.ai ? 'Claude connected' : 'FAQ mode'} sub={s.ai ? '' : 'add ANTHROPIC_API_KEY in .env'} tone={s.ai ? 'ok' : 'warn'} />
        <Stat label="Database" value={(s.db_bytes / 1048576).toFixed(1) + ' MB'} sub={'prices ' + fmtAgo(s.prices_updated)} />
      </div>
      <div className="grid2">
        <Card title="Bot & app">
          <div className="kv">
            <div><span>Bot</span><b>{s.bot ? <a href={`https://t.me/${s.bot}`} target="_blank" rel="noreferrer">@{s.bot}</a> : '—'}</b></div>
            <div><span>Mini App URL</span><b>{s.webapp}</b></div>
            {Object.entries(s.outbox || {}).map(([k, v]) => <div key={k}><span>Bot queue · {k}</span><b>{v}</b></div>)}
          </div>
        </Card>
        <Card title="Ledger self-audit" right={can(me, 'finance') && <ActBtn small kind="primary" ok="" run={async () => setAudit(await post('/system/ledger-audit'))}>Run audit</ActBtn>}>
          <p className="dim small">Recomputes every balance from the append-only journal and compares it with stored balances.</p>
          {audit && (audit.ok ? <div className="alert ok">All balances match the journal ✓</div>
            : <div className="alert danger">{audit.mismatches.length} mismatch(es): <pre className="small">{JSON.stringify(audit.mismatches, null, 1)}</pre></div>)}
        </Card>
      </div>
      <Card title="Alerts" right={<ActBtn small run={() => post('/alerts/seen')} ok="Marked as read" onDone={alerts.reload}>Mark all read</ActBtn>}>
        <Table rows={alerts.data?.items} empty="No alerts" cols={[
          ['When', (r) => fmtDate(r.created_at)], ['Level', (r) => <Badge tone={r.level === 'critical' || r.level === 'error' ? 'danger' : r.level === 'warn' ? 'warn' : ''}>{r.level}</Badge>],
          ['Kind', (r) => r.kind], ['Message', (r) => <span className={r.seen ? 'dim' : ''}>{r.text}</span>],
        ]} />
      </Card>
      <Card title="Scanner state">
        <Table rows={s.scan_state} rowKey={(r) => r.key} cols={[['Key', (r) => <span className="mono small">{r.key}</span>], ['Value', (r) => <span className="mono small">{String(r.value).slice(0, 60)}</span>], ['Updated', (r) => fmtAgo(r.updated_at)]]} />
      </Card>
    </div>
  );
}
