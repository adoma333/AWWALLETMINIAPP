import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import Icon, { CoinIcon, NetIcon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { AmountInput, AssetRow, Btn, Card, CopyField, Field, Page, QR, Row, Skeleton } from '../components/ui';
import { amt } from '../format';
import { errText, useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic, shareUrl } from '../telegram';

// "TRC20 · BEP20 · ERC20 +3" — reads better than a count and needs no plural forms
const netList = (ns) => ns.slice(0, 3).map((n) => n.short || n.name).join(' · ') + (ns.length > 3 ? ` +${ns.length - 3}` : '');

export default function Deposit({ query }) {
  const { t } = useI18n();
  const { wallet, config } = useApp();
  const toast = useToast();
  const asset = query.asset;
  const a = wallet?.assets?.find((x) => x.id === asset);
  const nets = useMemo(() => (a?.networks || []).filter((n) => n.deposit), [a]);
  const network = query.network || (nets.length === 1 ? nets[0].network : null);

  if (!asset) {
    const list = (wallet?.assets || []).filter((x) => x.networks.some((n) => n.deposit));
    return (
      <Page title={t('deposit_title')}>
        <p className="lead">{t('choose_asset')}</p>
        <div className="list">{list.map((x) => <AssetRow key={x.id} a={x} sub={netList(x.networks.filter((n) => n.deposit))} onClick={() => go(`/deposit?asset=${x.id}`, true)} right={<Icon name="chevron" size={18} className="flip-rtl" />} />)}</div>
      </Page>
    );
  }
  if (!network) {
    return (
      <Page title={`${t('deposit_title')} ${asset}`}>
        <p className="lead">{t('choose_network')}</p>
        <div className="list">
          {nets.map((n) => (
            <button key={n.network} type="button" className="net-row" onClick={() => { haptic.select(); go(`/deposit?asset=${asset}&network=${n.network}`, true); }}>
              <NetIcon network={n.network} size={34} />
              <span className="ar-main"><b>{n.name}</b><small>{n.short} · {n.eta} · min {n.min_deposit} {asset}</small></span>
              {n.memo && <span className="badge mute">MEMO</span>}
            </button>
          ))}
        </div>
      </Page>
    );
  }
  return <DepositAddress asset={asset} network={network} a={a} config={config} toast={toast} />;
}

function DepositAddress({ asset, network, a, config, toast }) {
  const { t } = useI18n();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.post('/api/deposit/address', { network, asset }).then(setInfo).catch((e) => setErr(errText(t, e)));
  }, [asset, network]); // eslint-disable-line react-hooks/exhaustive-deps
  const netName = info?.network_name || network;
  const evmList = info?.same_address_networks?.length > 1
    ? info.same_address_networks.map((n) => config?.networks?.find((x) => x.id === n)?.short || n).join(' · ') : null;
  return (
    <Page title={`${t('deposit_title')} ${asset}`}>
      <div className="dep-head"><CoinIcon asset={asset} size={30} network={network} /><b>{asset}</b><span className="chip"><NetIcon network={network} size={16} />{netName}</span></div>
      {err && <Card className="warn-card"><Icon name="alert" />{err}</Card>}
      {!info && !err && <Skeleton h={300} r={20} />}
      {info && (
        <>
          <div className="qr-wrap"><QR value={info.address} size={210} logo={<CoinIcon asset={asset} size={34} />} /></div>
          <CopyField label={t('your_address', { asset })} value={info.address} big />
          {info.memo && (
            <>
              <CopyField label={t('memo_label')} value={info.memo} big />
              <Card className="warn-card strong"><Icon name="alert" /><span>{t('memo_warning')}</span></Card>
            </>
          )}
          <Card className="warn-card"><Icon name="info" /><span>{t('network_warning', { asset, network: netName })}</span></Card>
          {evmList && <p className="hint"><Icon name="layers" size={14} /> {t('same_address_evm', { list: evmList })}</p>}
          <div className="kv-box">
            <Row label={t('min_deposit')} value={`${info.min_deposit || '0'} ${asset}`} />
            <Row label={t('confirmations_needed')} value={t('confirmations_n', { n: info.confirmations })} />
            <Row label={t('arrives_in')} value={info.eta} />
            {info.contract && <Row label="Contract" value={`${info.contract.slice(0, 8)}…${info.contract.slice(-6)}`} mono />}
          </div>
          <Btn kind="soft" className="wide" onClick={() => shareUrl(info.address, `${asset} (${netName})${info.memo ? ` · MEMO ${info.memo}` : ''}`)}><Icon name="share" size={18} />{t('share_address')}</Btn>
          {network === 'ton' && config?.features?.ton_connect !== false && <TonDeposit asset={asset} a={a} toast={toast} />}
          <CheckTx network={network} toast={toast} />
        </>
      )}
    </Page>
  );
}

function TonDeposit({ asset, toast }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const { depositFromTon } = await import('../tonconnect');
      if (await depositFromTon(asset, amount)) { haptic.success(); toast(t('deposit_sent'), 'ok'); setAmount(''); }
    } catch (e) {
      if (e?.code) toast(errText(t, e), 'error');
    } finally { setBusy(false); }
  };
  return (
    <Card className="ton-card">
      <div className="tc-head"><Icon name="wallet" /><b>{t('deposit_with_wallet')}</b></div>
      <AmountInput value={amount} onChange={setAmount} asset={asset} />
      <Btn className="wide" loading={busy} disabled={!Number(amount)} onClick={send}>{t('connect_wallet')} · {t('action_deposit')}</Btn>
    </Card>
  );
}

function CheckTx({ network, toast }) {
  const { t } = useI18n();
  const { loadWallet } = useApp();
  const [hash, setHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const check = async () => {
    setBusy(true);
    setRes(null);
    try {
      const r = await api.post('/api/deposit/verify', { network, txid: hash.trim() });
      setRes(r);
      if (r.status === 'credited') { haptic.success(); loadWallet(); }
    } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };
  return (
    <section className="check-tx">
      <h2 className="h2">{t('check_tx_title')}</h2>
      <p className="dim small">{t('check_tx_sub')}</p>
      <Field label={t('tx_hash')}>
        <div className="input-row"><input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="0x… / hash" dir="ltr" /><Btn kind="soft" loading={busy} disabled={hash.trim().length < 40} onClick={check}>{t('check')}</Btn></div>
      </Field>
      {res && (
        <Card className={`check-res ${res.status}`}>
          <b>{t(`check_${res.status}`)}</b>
          {res.items?.map((i) => <div key={i.txid + i.amount} className="mono small">{amt(i.amount)} {i.asset} · {i.confirmations} conf.</div>)}
        </Card>
      )}
    </section>
  );
}
