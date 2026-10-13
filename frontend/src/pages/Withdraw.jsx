import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, idem } from '../api';
import { useConfirm, withConfirm } from '../components/Confirm';
import Icon, { CoinIcon, NetIcon } from '../components/Icon';
import Success from '../components/Success';
import { useToast } from '../components/Toast';
import { AmountInput, AssetPicker, Btn, Card, Field, NetworkPicker, Page, Row, Sheet } from '../components/ui';
import { amt, shortAddr } from '../format';
import { errText, useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { readClipboard, scanQr } from '../telegram';
import { FAMILY_NETWORKS, detectFamily, parseScan } from '../util';

export default function Withdraw({ query }) {
  const { t } = useI18n();
  const { wallet, me, loadWallet } = useApp();
  const ask = useConfirm();
  const toast = useToast();
  const [asset, setAsset] = useState(query.asset || '');
  const [network, setNetwork] = useState(query.network || '');
  const [address, setAddress] = useState(query.address || '');
  const [memo, setMemo] = useState(query.memo || '');
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState(null);
  const [perr, setPerr] = useState('');
  const [sheet, setSheet] = useState('');
  const [book, setBook] = useState([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const key = useRef(idem());
  const a = wallet?.assets?.find((x) => x.id === asset);
  const fam = query.family || detectFamily(address);
  const nets = useMemo(() => (a?.networks || []).filter((n) => n.withdraw && (!fam || (FAMILY_NETWORKS[fam] || []).includes(n.network))), [a, fam]);
  const net = nets.find((n) => n.network === network);

  useEffect(() => { if (nets.length === 1 && !network) setNetwork(nets[0].network); }, [nets, network]);
  useEffect(() => { api.get('/api/addressbook').then((r) => setBook(r.items)).catch(() => {}); }, []);
  useEffect(() => {
    setPreview(null);
    setPerr('');
    if (!asset || !network || address.length < 20 || !Number(amount)) return undefined;
    const id = setTimeout(() => api.post('/api/withdraw/preview', { asset, network, address: address.trim(), amount, memo })
      .then(setPreview).catch((e) => setPerr(errText(t, e))), 450);
    return () => clearTimeout(id);
  }, [asset, network, address, amount, memo]); // eslint-disable-line react-hooks/exhaustive-deps

  const scan = async () => {
    const r = parseScan(await scanQr(t('recipient_address')));
    if (r?.address) { setAddress(r.address); if (r.memo) setMemo(r.memo); if (r.network) setNetwork(r.network); }
  };
  const submit = async () => {
    setBusy(true);
    try {
      const summary = `${amt(preview.receive)} ${asset} → ${shortAddr(preview.address)} (${net?.short})`;
      const r = await withConfirm(ask, t, (f) => api.post('/api/withdraw', { asset, network, address: address.trim(), memo, amount, idem: key.current, ...f }),
        { title: t('confirm_withdraw'), summary });
      if (r) { setDone(r); loadWallet(); }
    } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Page title="">
        <Success title={done.internal ? t('sent_success', { name: preview?.recipient?.name || '' }) : t('withdraw_submitted')}
          sub={done.status === 'review' ? t('withdraw_review_note') : `${amt(done.amount)} ${done.asset}`}>
          <Btn className="wide" onClick={() => go(`/tx/${done.id}`, true)}>{t('details')}</Btn>
          <Btn kind="soft" className="wide" onClick={() => go('/', true)}>{t('done')}</Btn>
        </Success>
      </Page>
    );
  }
  const hold = me.security_hold_until > Date.now() / 1000;
  return (
    <Page title={t('withdraw_title')}>
      {hold && <Card className="warn-card strong"><Icon name="lock" />{t('hold_active', { date: new Date(me.security_hold_until * 1000).toLocaleString() })}</Card>}
      <button type="button" className="asset-select" onClick={() => setSheet('asset')}>
        {asset ? <><CoinIcon asset={asset} size={28} /><b>{asset}</b></> : <b>{t('choose_asset')}</b>}<Icon name="chevronDown" size={18} />
      </button>
      {asset && (
        <button type="button" className="asset-select" onClick={() => setSheet('net')}>
          {net ? <><NetIcon network={net.network} size={24} /><b>{net.name}</b><small>{net.short}</small></> : <b>{t('choose_network')}</b>}<Icon name="chevronDown" size={18} />
        </button>
      )}
      <Field label={t('recipient_address')} right={
        <span className="field-actions">
          <button type="button" onClick={async () => setAddress((await readClipboard()).trim())}><Icon name="paste" size={16} />{t('paste')}</button>
          <button type="button" onClick={scan}><Icon name="scan" size={16} />{t('scan')}</button>
          {book.length > 0 && <button type="button" onClick={() => setSheet('book')}><Icon name="contacts" size={16} /></button>}
        </span>}>
        <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder="0x… / T… / UQ… / bc1…" dir="ltr" className="mono" />
      </Field>
      {network === 'ton' && me.ton_wallet && (
        <button type="button" className="link-btn" onClick={() => setAddress(me.ton_wallet.address)}><Icon name="wallet" size={14} /> {t('to_my_ton_wallet')} · {shortAddr(me.ton_wallet.address)}</button>
      )}
      {(network === 'ton' || net?.memo) && (
        <Field label={`${t('memo')} (${t('optional')})`} hint={t('memo_exchange_hint')}><input value={memo} onChange={(e) => setMemo(e.target.value)} dir="ltr" /></Field>
      )}
      {asset && <AmountInput value={amount} onChange={setAmount} asset={asset} max={a?.available} usdPrice={a?.usd} display={a?.display} />}
      {perr && <p className="field-err">{perr}</p>}
      {preview && (
        preview.internal ? <Card className="ok-card"><Icon name="bolt" />{t('internal_detected')}</Card> : (
          <div className="kv-box">
            <Row label={t('network_fee')} value={Number(preview.fee) ? `${amt(preview.fee)} ${asset}` : t('free')}>
              {preview.voucher && <span className="mini-badge ok">{t('fee_free_badge')}</span>}
            </Row>
            <Row label={t('you_receive')} value={`${amt(preview.receive)} ${asset}`} strong />
            <Row label={t('eta')} value={preview.eta} />
          </div>
        )
      )}
      <p className="hint"><Icon name="alert" size={14} /> {t('check_address_note')}</p>
      <Btn className="wide" loading={busy} disabled={!preview || hold} onClick={submit}>{t('confirm_withdraw')}</Btn>
      <AssetPicker open={sheet === 'asset'} onClose={() => setSheet('')} assets={wallet?.assets?.filter((x) => x.networks.some((n) => n.withdraw))}
        onPick={(x) => { setAsset(x.id); setNetwork(''); }} />
      <NetworkPicker open={sheet === 'net'} onClose={() => setSheet('')} networks={nets} kind="withdraw" onPick={(n) => setNetwork(n.network)} />
      <Sheet open={sheet === 'book'} onClose={() => setSheet('')} title={t('address_book')}>
        <div className="list">
          {book.filter((b) => !network || b.network === network).map((b) => (
            <button key={b.id} type="button" className="net-row" onClick={() => { setAddress(b.address); setNetwork(b.network); if (b.memo) setMemo(b.memo); setSheet(''); }}>
              <NetIcon network={b.network} size={28} /><span className="ar-main"><b>{b.label || shortAddr(b.address)}</b><small className="mono">{shortAddr(b.address, 10)}</small></span>
              {b.whitelisted ? <Icon name="shield" size={16} /> : null}
            </button>
          ))}
        </div>
      </Sheet>
    </Page>
  );
}
