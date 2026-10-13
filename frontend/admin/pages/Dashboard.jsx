import { Bars, Card, fmtAgo, go, Loading, Stat, usd, useLoad } from '../lib.jsx';

export default function Dashboard() {
  const { data: d, error, reload } = useLoad('/dashboard');
  if (!d) return <Loading error={error} reload={reload} />;
  const q = d.queues;
  const hb = d.worker.heartbeat;
  const workerOk = hb && Date.now() / 1000 - hb < 180;
  const gap = Number(d.solvency.reserves_usd) - Number(d.solvency.liabilities_usd);

  return (
    <div className="stack">
      {!d.wallet_ready && (
        <div className="alert danger">The HD wallet is not initialised — deposits addresses cannot be issued. Run <code>aw-wallet init-wallet</code> on the server (setup.sh does this).</div>
      )}
      {!workerOk && <div className="alert warn">Background worker heartbeat is {hb ? fmtAgo(hb) : 'missing'} — deposits, withdrawals and prices are not being processed. Check <code>systemctl status aw-wallet-worker</code>.</div>}

      <div className="grid4">
        <Stat label="Users" value={d.users.total.toLocaleString()} sub={`+${d.users.new_24h} today · ${d.users.active_24h} active`} onClick={() => go('users')} />
        <Stat label="Revenue today" value={usd(d.revenue.today)} sub={`7d ${usd(d.revenue.d7)} · 30d ${usd(d.revenue.d30)}`} tone="ember" onClick={() => go('revenue')} />
        <Stat label="Deposits 24h" value={usd(d.volume_24h.deposits)} sub={`Withdrawals ${usd(d.volume_24h.withdrawals)}`} />
        <Stat label="Swaps 24h" value={usd(d.volume_24h.swaps)} sub={`Transfers ${usd(d.volume_24h.transfers)}`} />
      </div>

      <Card title="Needs attention">
        <div className="grid4">
          <Stat label="Withdrawals to review" value={q.withdraw_review} tone={q.withdraw_review ? 'warn' : ''} onClick={() => go('withdrawals')} />
          <Stat label="Manual payouts" value={q.withdraw_manual} tone={q.withdraw_manual ? 'warn' : ''} onClick={() => go('withdrawals')} />
          <Stat label="P2P appeals" value={q.appeals} tone={q.appeals ? 'danger' : ''} onClick={() => go('p2p')} />
          <Stat label="Support tickets" value={q.tickets} tone={q.tickets ? 'warn' : ''} onClick={() => go('support')} />
          <Stat label="Unassigned deposits" value={q.deposits_attention} tone={q.deposits_attention ? 'warn' : ''} onClick={() => go('deposits')} />
          <Stat label="KYC requests" value={q.kyc} onClick={() => go('kyc')} />
          <Stat label="New forms" value={q.forms} onClick={() => go('support')} />
          <Stat label="Alerts" value={q.alerts} tone={q.alerts ? 'danger' : ''} onClick={() => go('system')} />
        </div>
      </Card>

      <div className="grid2">
        <Card title="Revenue · 30 days">
          <Bars data={d.series} value={(x) => x.revenue} label={(x) => new Date(x.day * 1000).toLocaleDateString()} fmt={usd} />
          <div className="kv">
            {Object.entries(d.revenue.by_source).map(([k, v]) => <div key={k}><span>{k}</span><b>{usd(v)}</b></div>)}
          </div>
        </Card>
        <Card title="New users · 30 days">
          <Bars data={d.series} value={(x) => x.users} label={(x) => new Date(x.day * 1000).toLocaleDateString()} />
          <div className="kv">
            <div><span>Last 7 days</span><b>{d.users.new_7d}</b></div>
            <div><span>Phone verified</span><b>{d.users.verified}</b></div>
          </div>
        </Card>
        <Card title="Swap volume · 30 days">
          <Bars data={d.series} value={(x) => x.volume} label={(x) => new Date(x.day * 1000).toLocaleDateString()} fmt={usd} />
        </Card>
        <Card title="Solvency" right={<a href="#/treasury">Treasury →</a>}>
          <div className="kv big">
            <div><span>User liabilities</span><b>{usd(d.solvency.liabilities_usd)}</b></div>
            <div><span>On-chain reserves</span><b>{usd(d.solvency.reserves_usd)}</b></div>
            <div><span>Difference</span><b className={gap >= 0 ? 'up' : 'down'}>{usd(gap)}</b></div>
            <div><span>Updated</span><b>{fmtAgo(d.solvency.updated_at)}</b></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
