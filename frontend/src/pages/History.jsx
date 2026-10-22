import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import Icon, { CoinIcon, NetIcon } from '../components/Icon';
import TxRow, { IN_TYPES } from '../components/TxRow';
import { Btn, Empty, HeadBtn, Page, Pill, SearchBox, Skeleton, SkeletonList, Status, Timeline, useCopy } from '../components/ui';
import { amt, dateTime, fiat, fiatCompact, shortAddr } from '../format';
import { errText, useI18n } from '../i18n';
import { go, match } from '../router';
import { useApp } from '../store';
import { openLink, shareUrl } from '../telegram';

const FILTERS = {
  all: '', in: 'deposit,receive,gift_in,gift_refund,referral,reward,p2p_buy,earn_interest', out: 'withdraw,send,gift_out,p2p_sell',
  swap: 'swap', p2p: 'p2p_buy,p2p_sell', gifts: 'gift_in,gift_out,gift_refund', earn: 'earn_in,earn_out,earn_interest',
};

export default function History({ path, query }) {
  const tx = match('/tx/:id', path);
  if (tx) return <TxDetail id={tx.id} />;
  const v = match('/verify/:id', path);
  if (v) return <VerifyReceipt id={v.id} sig={query.s} />;
  return <HistoryList query={query} />;
}

function dayLabel(ts, t, lang) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const y = new Date(Date.now() - 86400e3);
  if (d.toDateString() === today.toDateString()) return t('today_cap');
  if (d.toDateString() === y.toDateString()) return t('yesterday');
  return d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Design sheet 05.2 — Activity: monthly in/out chart, filter chips, search, rows grouped by day. */
function HistoryList({ query }) {
  const { t, lang } = useI18n();
  const [f, setF] = useState(FILTERS[query.type] !== undefined ? query.type : 'all');
  const [items, setItems] = useState(null);
  const [more, setMore] = useState(true);
  const [ins, setIns] = useState(null);
  const [sel, setSel] = useState(11);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState(false);
  const load = useCallback(async (reset) => {
    const before = reset ? 0 : items?.[items.length - 1]?.created_at || 0;
    const r = await api.get(`/api/txs?type=${FILTERS[f]}&asset=${query.asset || ''}&before=${before}&limit=30`);
    setItems((x) => (reset ? r.items : [...(x || []), ...r.items]));
    setMore(r.items.length === 30);
  }, [f, items, query.asset]);
  useEffect(() => { setItems(null); load(true).catch(() => setItems([])); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/api/insights', { silent: true }).then(setIns).catch(() => {}); }, []);
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out = [];
    for (const x of items || []) {
      if (s && !`${x.asset} ${x.asset2 || ''} ${x.type} ${x.meta?.note || ''} ${x.counterparty_user?.name || ''} ${x.id}`.toLowerCase().includes(s)) continue;
      const k = new Date(x.created_at * 1000).toDateString();
      if (!out.length || out[out.length - 1].k !== k) out.push({ k, label: dayLabel(x.created_at, t, lang), items: [] });
      out[out.length - 1].items.push(x);
    }
    return out;
  }, [items, q, t, lang]);
  const months = ins?.months || [];
  const max = Math.max(1, ...months.map((m) => Number(m.in) + Number(m.out)));
  const cur = months[sel];
  const mName = cur ? new Date(`${cur.month}-01T00:00:00`).toLocaleDateString(lang, { month: 'long' }) : '';
  return (
    <Page title={query.asset ? `${t('activity')} · ${query.asset}` : t('activity')} right={<HeadBtn icon={search ? 'x' : 'search'} onClick={() => { setSearch(!search); setQ(''); }} label={t('search')} />}>
      {search && <SearchBox value={q} onChange={setQ} placeholder={t('search_activity')} />}
      {months.length > 0 && (
        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="row between">
            <span className="col"><span className="dim" style={{ fontSize: 12.5 }}>{t('month_in_out', { month: mName })}</span>
              <b className="disp" style={{ fontSize: 19 }} dir="ltr"><span className="ok">+{fiatCompact(cur.in)}</span> · <span>−{fiatCompact(cur.out)}</span></b></span>
            <Pill tone="n" icon="pie">{t('insights')}</Pill>
          </div>
          <div className="row" style={{ alignItems: 'flex-end', gap: 6, height: 62, marginTop: 10 }} dir="ltr">
            {months.map((m, i) => {
              const h = ((Number(m.in) + Number(m.out)) / max) * 100;
              return <button key={m.month} type="button" aria-label={m.month} onClick={() => setSel(i)} style={{ flex: 1, height: `${Math.max(6, h)}%`, borderRadius: '5px 5px 2px 2px',
                background: i === sel ? 'var(--grad)' : 'var(--s3)', transition: 'height .5s cubic-bezier(.2,.8,.2,1), background .2s' }} />;
            })}
          </div>
          {Object.keys(ins.out_by_type || {}).length > 0 && sel === 11 && (
            <div className="row g6 wrap" style={{ marginTop: 10 }}>
              {Object.entries(ins.out_by_type).sort((a, b) => Number(b[1]) - Number(a[1])).map(([k, v]) => <span key={k} className="pill n">{t(`tx_${k}`)} · {fiat(v, 0)}</span>)}
            </div>
          )}
        </div>
      )}
      <div className="chips">
        {[['all', t('all')], ['in', t('received')], ['out', t('sent')], ['swap', t('filter_swaps')], ['p2p', 'P2P'], ['gifts', t('gifts')], ['earn', t('earn')]]
          .map(([k, l]) => <button key={k} type="button" className={`chip ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>{l}</button>)}
      </div>
      {!items && <SkeletonList rows={6} />}
      {items?.length === 0 && <Empty icon="history" title={t('no_history')} sub={t('no_history_sub')} action={<Btn size="sm" icon="down" onClick={() => go('/deposit')}>{t('action_deposit')}</Btn>} />}
      {groups.map((g) => (
        <React.Fragment key={g.k}>
          <div className="h2"><span>{g.label}</span></div>
          <div className="list">{g.items.map((x) => <TxRow key={x.id} tx={x} />)}</div>
        </React.Fragment>
      ))}
      {items?.length > 0 && more && !q && <Btn kind="f" w onClick={() => load(false)}>{t('load_more')}</Btn>}
    </Page>
  );
}

function CopyKV({ k, v, show, mono = true }) {
  const [ok, copy] = useCopy();
  return (
    <button type="button" className="kv" style={{ width: '100%' }} onClick={() => copy(v)}>
      <span>{k}</span><b className={`row g6 ${mono ? 'mono' : ''}`} dir="ltr">{show || v}<Icon name={ok ? 'check' : 'copy'} size={13} className={ok ? 'ok' : 'dim'} /></b>
    </button>
  );
}

const hm = (ts) => (ts ? new Date(ts * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '');

/** Design sheet 05.3 — transaction detail: live timeline, explorer, signed receipt, help. */
function TxDetail({ id }) {
  const { t } = useI18n();
  const { config, loadWallet, toast } = useApp();
  const [x, setX] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api.get(`/api/txs/${id}`, { silent: true }).then(setX).catch(setErr);
  const live = x && (['pending', 'processing'].includes(x.status) || ['review', 'approved', 'processing', 'broadcast'].includes(x.withdrawal?.status));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!live) return undefined;
    const iv = setInterval(() => { load(); }, 6000);
    return () => clearInterval(iv);
  }, [live, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (x && !live && x.type === 'withdraw') loadWallet(); }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Page title={t('tx_details')}><Empty icon="alert" title={errText(t, err)} /></Page>;
  if (!x) return <Page title={t('tx_details')}><Skeleton h={160} r={22} /><Skeleton h={220} r={22} /></Page>;
  const net = config?.networks?.find((n) => n.id === x.network);
  const incoming = IN_TYPES.has(x.type) || x.type === 'earn_out';
  const w = x.withdrawal;
  const failed = ['failed', 'rejected', 'cancelled'].includes(w?.status || x.status);
  const conf = x.meta?.confirmations;
  const need = x.meta?.required || net?.confirmations;
  let steps = null;
  if (x.type === 'withdraw' && w) {
    const ws = w.status;
    const order = ['review', 'approved', 'processing', 'broadcast', 'completed'];
    const at = order.indexOf(ws === 'stuck' ? 'broadcast' : ws);
    steps = [
      { title: t('step_requested'), sub: `${hm(w.created_at)} · ${t('pin_confirmed')}`, state: 'done' },
      { title: ws === 'review' ? t('step_in_review') : t('step_review_passed'), sub: ws === 'review' ? t('step_in_review_sub') : t(w.reviewed === 'manual' ? 'reviewed_manual' : 'reviewed_auto'),
        state: failed && at < 1 ? 'fail' : ws === 'review' ? 'now' : 'done' },
      { title: t('step_on_chain'), sub: ws === 'broadcast' && conf != null && need ? t('x_of_y_confirmations', { n: conf, total: need }) : w.sent_at ? hm(w.sent_at) : '',
        state: failed ? (at >= 2 ? 'fail' : '') : ['processing', 'broadcast', 'stuck'].includes(ws) ? 'now' : ws === 'completed' ? 'done' : '' },
      { title: t('status_completed'), sub: w.done_at ? hm(w.done_at) : '', state: ws === 'completed' ? 'done' : '' },
    ];
  } else if (x.type === 'deposit') {
    steps = [
      { title: t('step_seen_on_chain'), sub: hm(x.created_at), state: 'done' },
      { title: t('step_confirming'), sub: conf != null && need ? t('x_of_y_confirmations', { n: Math.min(conf, need), total: need }) : '', state: x.status === 'completed' ? 'done' : 'now' },
      { title: t('step_credited'), sub: x.status === 'completed' ? hm(x.updated_at) : '', state: x.status === 'completed' ? 'done' : '' },
    ];
  }
  const st = w?.status === 'review' ? 'review' : w?.status === 'broadcast' ? 'processing' : x.status;
  const title = x.type === 'send' && x.counterparty_user ? t('tx_sent_to', { name: x.counterparty_user.name })
    : x.type === 'receive' && x.counterparty_user ? t('tx_received_from', { name: x.counterparty_user.name }) : t(`tx_${x.type}`);
  const shareReceipt = () => shareUrl(x.receipt, `ZOHRA WALLET · ${t(`tx_${x.type}`)} ${amt(x.amount)} ${x.asset}`);
  return (
    <Page title={title} right={<HeadBtn icon="share" onClick={shareReceipt} label={t('share_receipt')} />}
      bar={<div className="row g10"><Btn kind="s" className="grow" icon="headset" onClick={() => go(`/support?tx=${x.id}`)}>{t('help')}</Btn>
        <Btn kind="s" className="grow" icon="share" onClick={shareReceipt}>{t('receipt')}</Btn></div>}>
      <div className="col center g4" style={{ padding: '6px 0' }}>
        <CoinIcon asset={x.type === 'swap' ? x.asset2 : x.asset} size={56} network={x.network} />
        {x.type === 'swap'
          ? <span className="mid" style={{ marginTop: 6, fontSize: 24 }} dir="ltr">{amt(x.amount)} {x.asset} → <span className="ok">{amt(x.amount2)} {x.asset2}</span></span>
          : <span className={`mid ${incoming ? 'ok' : ''}`} style={{ marginTop: 6 }} dir="ltr">{incoming ? '+' : '−'}{amt(x.amount)} {x.asset}</span>}
        <span className="dim" style={{ fontSize: 13 }} dir="ltr">{x.usd_value ? `≈ ${fiat(x.usd_value)} · ` : ''}{dateTime(x.created_at)}</span>
        <span style={{ marginTop: 4 }}>{st === 'processing' && conf != null && need
          ? <Pill tone="y" icon="clock">{t('confirming_x_of_y', { n: conf, total: need })}</Pill> : <Status status={st} />}</span>
      </div>
      {steps && <div className="card"><Timeline steps={steps} /></div>}
      {live && steps && <div className="prog indet" style={{ height: 4 }}><i /></div>}
      <div className="card tight">
        {x.counterparty_user && <div className="kv"><span>{incoming ? t('from_label') : t('to_label')}</span><b>{x.counterparty_user.name}</b></div>}
        {x.address && <CopyKV k={t('to_label')} v={x.address} show={shortAddr(x.address, 6)} />}
        {x.network && <div className="kv"><span>{t('network')}</span><b className="row g6"><NetIcon network={x.network} size={16} />{net?.name || x.network}</b></div>}
        {x.memo && <CopyKV k={t('memo')} v={x.memo} />}
        {x.type !== 'swap' && <div className="kv"><span>{t('fee')}</span><b className={Number(x.fee) > 0 ? '' : 'ok'} dir="ltr">{Number(x.fee) > 0 ? `${amt(x.fee)} ${x.fee_asset || x.asset}` : x.meta?.voucher ? `${t('free')} · ${t('voucher')}` : t('free')}</b></div>}
        {x.meta?.rate && <div className="kv"><span>{t('rate')}</span><b dir="ltr">1 {x.asset} = {amt(x.meta.rate, 8)} {x.asset2}</b></div>}
        {x.meta?.apy && <div className="kv"><span>APY</span><b className="ok">{x.meta.apy}%</b></div>}
        {x.meta?.note && <div className="kv"><span>{t('note')}</span><b>{x.meta.note}</b></div>}
        {x.meta?.fiat_amount && <div className="kv"><span>{t('fiat')}</span><b dir="ltr">{x.meta.fiat_amount} {x.meta.fiat}</b></div>}
        {x.txid && !String(x.txid).startsWith('bal:') && (x.explorer
          ? <button type="button" className="kv" style={{ width: '100%' }} onClick={() => openLink(x.explorer)}><span>{t('tx_hash_label')}</span><b className="em mono" dir="ltr">{shortAddr(x.txid, 6)} ↗</b></button>
          : <CopyKV k={t('tx_hash_label')} v={x.txid} show={shortAddr(x.txid, 6)} />)}
        <CopyKV k={t('reference')} v={x.id} />
      </div>
      {x.type === 'withdraw' && ['review', 'approved'].includes(w?.status) && (
        <Btn kind="danger" w onClick={async () => { try { await api.post(`/api/withdraw/${x.id}/cancel`); loadWallet(); load(); } catch (e) { toast(errText(t, e), 'error'); } }}>{t('cancel_withdrawal')}</Btn>
      )}
      {x.type === 'send' && x.counterparty_user && <Btn kind="f" w icon="repeat" onClick={() => go(`/send/user?to_id=${x.counterparty_user.id}&asset=${x.asset}&amount=${x.amount}`)}>{t('send_again')}</Btn>}
    </Page>
  );
}

function VerifyReceipt({ id, sig }) {
  const { t } = useI18n();
  const [r, setR] = useState(null);
  useEffect(() => { api.get(`/api/receipt/${id}?s=${encodeURIComponent(sig || '')}`).then(setR).catch(() => setR({ valid: false })); }, [id, sig]);
  if (!r) return <Page title={t('verified_receipt')}><Skeleton h={200} r={22} /></Page>;
  return (
    <Page title={t('verified_receipt')}>
      <div className="col center g8" style={{ padding: '10px 0' }}>
        <span className={`ic ${r.valid ? 'g' : 'r'}`} style={{ width: 72, height: 72, borderRadius: 26 }}><Icon name={r.valid ? 'shieldok' : 'alert'} size={34} /></span>
        <b className="disp" style={{ fontSize: 18 }}>{r.valid ? t('receipt_valid') : t('receipt_invalid')}</b>
      </div>
      {r.valid && (
        <div className="card tight">
          <div className="kv"><span>{t('reference')}</span><b className="mono">{r.id}</b></div>
          <div className="kv"><span>{t('details')}</span><b>{t(`tx_${r.type}`)}</b></div>
          <div className="kv"><span>{t('amount')}</span><b dir="ltr">{amt(r.amount)} {r.asset}</b></div>
          <div className="kv"><span>{t('status')}</span><b>{t(`status_${r.status}`)}</b></div>
          <div className="kv"><span>{t('date')}</span><b>{dateTime(r.created_at)}</b></div>
          {r.txid && <div className="kv"><span>{t('tx_hash_label')}</span><b className="mono" dir="ltr">{shortAddr(r.txid, 8)}</b></div>}
        </div>
      )}
    </Page>
  );
}
