import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import Icon, { CoinIcon, NetIcon } from '../components/Icon';
import { AmountInput, Btn, Empty, HeadBtn, Input, Li, Page, QR, SearchBox, Sheet, Skeleton, useCopy } from '../components/ui';
import { amt, fiat } from '../format';
import { errText, useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic, shareUrl } from '../telegram';

const netList = (ns) => ns.slice(0, 3).map((n) => n.short || n.name).join(' · ') + (ns.length > 3 ? ` +${ns.length - 3}` : '');

/** Address with the first and last 4 characters in ember — the part people actually compare. */
export function Addr({ value, size = 14.5 }) {
  if (!value) return null;
  const s = String(value);
  if (s.length < 14) return <span className="mono" style={{ fontSize: size }}>{s}</span>;
  return (
    <span className="mono" style={{ fontSize: size, lineHeight: 1.5 }} dir="ltr">
      <b className="em">{s.slice(0, 4)}</b>{s.slice(4, -4)}<b className="em">{s.slice(-4)}</b>
    </span>
  );
}

/** Design sheet 02.3 — Receive: network chips, QR with coin + network, highlighted address, copy / share, TON Connect. */
export default function Deposit({ query }) {
  const { t } = useI18n();
  const { wallet } = useApp();
  const [q, setQ] = useState('');
  const asset = query.asset;
  if (!asset) {
    const list = (wallet?.assets || []).filter((x) => x.networks.some((n) => n.deposit) && (!q || `${x.id} ${x.name}`.toLowerCase().includes(q.toLowerCase())));
    return (
      <Page title={t('receive_title')}>
        <SearchBox value={q} onChange={setQ} placeholder={t('search_coin')} />
        <div className="list">
          {list.map((x) => <Li key={x.id} coin={x.id} title={x.id} sub={`${x.name} · ${netList(x.networks.filter((n) => n.deposit))}`} chev
            onClick={() => go(`/deposit?asset=${x.id}`, true)} />)}
        </div>
      </Page>
    );
  }
  return <Receive asset={asset} initialNet={query.network} />;
}

function Receive({ asset, initialNet }) {
  const { t } = useI18n();
  const { wallet, config, toast } = useApp();
  const a = wallet?.assets?.find((x) => x.id === asset);
  const nets = useMemo(() => (a?.networks || []).filter((n) => n.deposit), [a]);
  const [network, setNetwork] = useState(initialNet || null);
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [checkOpen, setCheckOpen] = useState(false);
  const [ok, copy] = useCopy();
  const [tonOpen, setTonOpen] = useState(false);
  useEffect(() => { if (!network && nets.length) setNetwork(nets[0].network); }, [nets, network]);
  useEffect(() => {
    if (!network) return;
    setInfo(null); setErr('');
    api.post('/api/deposit/address', { network, asset }).then(setInfo).catch((e) => setErr(errText(t, e)));
  }, [asset, network]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = nets.find((x) => x.network === network);
  const share = () => info && shareUrl(info.address, `${asset} · ${n?.name || network}`);
  const evm = info?.same_address_networks?.length > 1
    ? info.same_address_networks.map((id) => config?.networks?.find((x) => x.id === id)?.short || id) : null;

  if (wallet && !a) return <Page title={t('receive_title')}><Empty icon="alert" title={t('err_not_found')} /></Page>;
  return (
    <Page title={t('receive_asset', { asset })} right={<HeadBtn icon="share" onClick={share} label={t('share')} />}>
      <div className="chips">
        {nets.map((x) => (
          <button key={x.network} type="button" className={`chip ${x.network === network ? 'oe' : ''}`} onClick={() => { haptic.select(); setNetwork(x.network); }}>
            <NetIcon network={x.network} size={18} />{x.short || x.name}
          </button>
        ))}
      </div>
      {err && <div className="warn r"><Icon name="alert" size={18} /><span>{err}</span></div>}
      <div style={{ marginTop: 6 }}>
        {info ? <QR value={info.address} size={232} logo={<CoinIcon asset={asset} network={network} size={40} />} />
          : !err && <div className="qr" style={{ width: 232, height: 232 }}><Skeleton h="100%" r={14} /></div>}
      </div>
      <div className="card col g8">
        <span className="dim" style={{ fontSize: 12.5 }}>{t('your_net_address', { network: n ? `${n.name}${n.short && n.short !== n.name ? ` (${n.short})` : ''}` : network })}</span>
        {info ? <Addr value={info.address} /> : <Skeleton h={20} />}
        <div className="row g8">
          <Btn kind="f" size="sm" className="grow" icon={ok ? 'check' : 'copy'} onClick={() => info && copy(info.address)}>{ok ? t('copied') : t('copy')}</Btn>
          <Btn kind="s" size="sm" className="grow" icon="share" onClick={share}>{t('share')}</Btn>
        </div>
      </div>
      {info && (
        <div className="note"><Icon name="info" size={16} />
          <span>{t('receive_note', { min: `${info.min_deposit || '0'} ${asset}`, eta: info.eta || n?.eta || '', n: info.confirmations })}</span>
        </div>
      )}
      {evm && <div className="note"><Icon name="layers" size={16} /><span>{t('same_address_evm', { list: evm.slice(0, 6).join(' · ') + (evm.length > 6 ? ` +${evm.length - 6}` : '') })}</span></div>}
      {info && <div className="warn"><Icon name="alert" size={17} /><span>{t('network_warning', { asset, network: n?.name || network })}</span></div>}

      {network === 'ton' && config?.features?.ton_connect !== false && (
        <button type="button" className="card row" style={{ background: 'linear-gradient(135deg,rgba(0,152,234,.16),transparent 70%),var(--s1)' }} onClick={() => setTonOpen(true)}>
          <span className="ic b"><Icon name="wallet" size={19} /></span>
          <span className="grow"><b style={{ fontSize: 14.5 }}>{t('ton_deposit_title')}</b><small className="dim" style={{ display: 'block', fontSize: 12.5 }}>{t('ton_deposit_sub')}</small></span>
          <span className="chev"><Icon name="chev" size={18} /></span>
        </button>
      )}
      <button type="button" className="card row" onClick={() => setCheckOpen(true)}>
        <span className="ic n"><Icon name="search" size={18} /></span>
        <span className="grow"><b style={{ fontSize: 14.5 }}>{t('check_tx_title')}</b><small className="dim" style={{ display: 'block', fontSize: 12.5 }}>{t('check_tx_sub')}</small></span>
        <span className="chev"><Icon name="chev" size={18} /></span>
      </button>
      <TonDeposit open={tonOpen} onClose={() => setTonOpen(false)} asset={asset} toast={toast} />
      <CheckTx open={checkOpen} onClose={() => setCheckOpen(false)} network={network} toast={toast} />
    </Page>
  );
}

function TonDeposit({ open, onClose, asset, toast }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title={t('ton_deposit_title')}>
      <AmountInput value={amount} onChange={setAmount} asset={asset} />
      <Btn w loading={busy} disabled={!Number(amount)} onClick={async () => {
        setBusy(true);
        try {
          const { depositFromTon } = await import('../tonconnect');
          if (await depositFromTon(asset, amount)) { haptic.success(); toast(t('deposit_sent'), 'ok'); setAmount(''); onClose(); }
        } catch (e) { if (e?.code) toast(errText(t, e), 'error'); } finally { setBusy(false); }
      }}>{t('connect_wallet')} · {t('action_deposit')}</Btn>
    </Sheet>
  );
}

function CheckTx({ open, onClose, network, toast }) {
  const { t } = useI18n();
  const { loadWallet } = useApp();
  const [hash, setHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  return (
    <Sheet open={open} onClose={onClose} title={t('check_tx_title')}>
      <span className="dim small center">{t('check_tx_sub')}</span>
      <Input value={hash} onChange={(e) => setHash(e.target.value)} placeholder={t('tx_hash')} dir="ltr" icon="link" />
      <Btn w loading={busy} disabled={hash.trim().length < 40} onClick={async () => {
        setBusy(true); setRes(null);
        try {
          const r = await api.post('/api/deposit/verify', { network, txid: hash.trim() });
          setRes(r);
          if (r.status === 'credited') { haptic.success(); loadWallet(); }
        } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
      }}>{t('check')}</Btn>
      {res && (
        <div className={`warn ${res.status === 'credited' ? 'g' : ''}`}>
          <Icon name={res.status === 'credited' ? 'checkCircle' : 'clock'} size={18} />
          <span><b>{t(`check_${res.status}`)}</b>{res.items?.map((i) => <span key={i.txid + i.amount} className="mono" style={{ display: 'block' }}>{amt(i.amount)} {i.asset} · {i.confirmations} conf.</span>)}</span>
        </div>
      )}
    </Sheet>
  );
}

export { fiat };
