import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import Icon, { CoinIcon, NetIcon } from '../components/Icon';
import TxRow from '../components/TxRow';
import { useToast } from '../components/Toast';
import { Btn, Card, CopyField, Empty, Page, Row, Segmented, Skeleton, Status } from '../components/ui';
import { amt, dateTime, fiat, shortAddr } from '../format';
import { errText, useI18n } from '../i18n';
import { match } from '../router';
import { useApp } from '../store';
import { openLink, shareUrl } from '../telegram';

const FILTERS = {
  all: '', in: 'deposit,receive,gift_in,gift_refund,referral,reward,p2p_buy', out: 'withdraw,send,gift_out,p2p_sell', swaps: 'swap', p2p: 'p2p_buy,p2p_sell',
};

export default function History({ path, query }) {
  const tx = match('/tx/:id', path);
  if (tx) return <TxDetail id={tx.id} />;
  const v = match('/verify/:id', path);
  if (v) return <VerifyReceipt id={v.id} sig={query.s} />;
  return <HistoryList />;
}

function HistoryList() {
  const { t } = useI18n();
  const [f, setF] = useState('all');
  const [items, setItems] = useState(null);
  const [more, setMore] = useState(true);
  const load = useCallback(async (reset) => {
    const before = reset ? 0 : items?.[items.length - 1]?.created_at || 0;
    const r = await api.get(`/api/txs?type=${FILTERS[f]}&before=${before}&limit=30`);
    setItems((x) => (reset ? r.items : [...(x || []), ...r.items]));
    setMore(r.items.length === 30);
  }, [f, items]);
  useEffect(() => { setItems(null); load(true); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Page title={t('history_title')}>
      <Segmented value={f} onChange={setF} options={[['all', t('all')], ['in', t('filter_in')], ['out', t('filter_out')], ['swaps', t('filter_swaps')], ['p2p', 'P2P']]} />
      {!items && [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={56} r={14} style={{ marginTop: 8 }} />)}
      {items?.length === 0 && <Empty icon="history" title={t('no_history')} />}
      {items?.map((x) => <TxRow key={x.id} tx={x} />)}
      {items?.length > 0 && more && <Btn kind="ghost" className="wide" onClick={() => load(false)}>{t('see_all')}</Btn>}
    </Page>
  );
}

function TxDetail({ id }) {
  const { t } = useI18n();
  const { config, loadWallet } = useApp();
  const toast = useToast();
  const [x, setX] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api.get(`/api/txs/${id}`).then(setX).catch(setErr);
  useEffect(() => {
    load();
    const iv = setInterval(() => { if (x && ['pending', 'processing'].includes(x.status)) load(); }, 10000);
    return () => clearInterval(iv);
  }, [id, x?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Page title={t('tx_details')}><Empty icon="alert" title={errText(t, err)} /></Page>;
  if (!x) return <Page title={t('tx_details')}><Skeleton h={260} r={20} /></Page>;
  const net = config?.networks?.find((n) => n.id === x.network);
  const incoming = ['deposit', 'receive', 'gift_in', 'gift_refund', 'referral', 'reward', 'p2p_buy'].includes(x.type);
  const steps = x.type === 'withdraw'
    ? ['review', 'approved', 'broadcast', 'completed']
    : x.type === 'deposit' ? ['pending', 'completed'] : null;
  const wst = x.withdrawal?.status || x.status;
  const idx = steps ? Math.max(0, steps.indexOf(wst === 'processing' ? 'broadcast' : wst)) : 0;
  return (
    <Page title={t('tx_details')}>
      <section className="tx-hero">
        <CoinIcon asset={x.type === 'swap' ? x.asset2 : x.asset} size={52} network={x.network} />
        <div className="txh-type">{t(`tx_${x.type}`)}</div>
        {x.type === 'swap'
          ? <div className="txh-amt" dir="ltr">−{amt(x.amount)} {x.asset} → <span className="up">+{amt(x.amount2)} {x.asset2}</span></div>
          : <div className={`txh-amt ${incoming ? 'up' : ''}`} dir="ltr">{incoming ? '+' : '−'}{amt(x.amount)} {x.asset}</div>}
        {x.usd_value && <small className="dim" dir="ltr">≈ {fiat(x.usd_value)}</small>}
        <Status status={x.withdrawal?.status === 'review' ? 'review' : x.status} />
      </section>
      {steps && !['failed', 'rejected', 'cancelled'].includes(x.status) && (
        <div className="timeline">{steps.map((s, i) => <div key={s} className={`tl-step ${i <= idx ? 'on' : ''}`}><span /><small>{t(`status_${s}`)}</small></div>)}</div>
      )}
      <div className="kv-box">
        <Row label={t('reference')} value={x.id} mono />
        <Row label={t('date')} value={dateTime(x.created_at)} />
        {x.counterparty_user && <Row label={incoming ? t('from_label') : t('to_label')} value={x.counterparty_user.name} />}
        {x.network && <Row label={t('network')} value={<span className="inline-net"><NetIcon network={x.network} size={16} />{net?.name || x.network}</span>} />}
        {x.address && <Row label={t('address')} value={shortAddr(x.address, 8)} mono />}
        {x.memo && <Row label={t('memo')} value={x.memo} mono />}
        {Number(x.fee) > 0 && <Row label={t('fee')} value={`${amt(x.fee)} ${x.fee_asset || x.asset}`} />}
        {x.meta?.rate && <Row label={t('rate')} value={`1 ${x.asset} = ${x.meta.rate} ${x.asset2}`} />}
        {x.meta?.note && <Row label={t('add_note')} value={x.meta.note} />}
        {x.meta?.fiat_amount && <Row label={t('fiat')} value={`${x.meta.fiat_amount} ${x.meta.fiat}`} />}
      </div>
      {x.txid && !String(x.txid).startsWith('bal:') && <CopyField label={t('tx_hash_label')} value={x.txid} />}
      {x.explorer && <Btn kind="soft" className="wide" onClick={() => openLink(x.explorer)}><Icon name="external" size={18} />{t('open_explorer')}</Btn>}
      {x.type === 'withdraw' && ['review', 'approved'].includes(x.withdrawal?.status) && (
        <Btn kind="ghost" className="wide" onClick={async () => { try { await api.post(`/api/withdraw/${x.id}/cancel`); loadWallet(); load(); } catch (e) { toast(errText(t, e), 'error'); } }}>{t('cancel_request')}</Btn>
      )}
      <Btn kind="ghost" className="wide" onClick={() => shareUrl(x.receipt, `ZOHRA WALLET · ${t(`tx_${x.type}`)} ${amt(x.amount)} ${x.asset}`)}><Icon name="receipt" size={18} />{t('share_receipt')}</Btn>
    </Page>
  );
}

function VerifyReceipt({ id, sig }) {
  const { t } = useI18n();
  const [r, setR] = useState(null);
  useEffect(() => { api.get(`/api/receipt/${id}?s=${encodeURIComponent(sig || '')}`).then(setR).catch(() => setR({ valid: false })); }, [id, sig]);
  if (!r) return <Page title={t('tx_details')}><Skeleton h={200} /></Page>;
  return (
    <Page title={t('tx_details')}>
      <Card className={r.valid ? 'ok-card' : 'warn-card strong'}><Icon name={r.valid ? 'shield' : 'alert'} />{r.valid ? t('receipt_valid') : t('receipt_invalid')}</Card>
      {r.valid && (
        <div className="kv-box">
          <Row label={t('reference')} value={r.id} mono />
          <Row label={t('details')} value={t(`tx_${r.type}`)} />
          <Row label={t('amount')} value={`${amt(r.amount)} ${r.asset}`} strong />
          <Row label={t('status')} value={t(`status_${r.status}`)} />
          <Row label={t('date')} value={dateTime(r.created_at)} />
          {r.txid && <Row label={t('tx_hash_label')} value={shortAddr(r.txid, 10)} mono />}
        </div>
      )}
    </Page>
  );
}
