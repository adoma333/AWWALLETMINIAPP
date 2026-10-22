import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, idem } from '../api';
import { useConfirm, withConfirm } from '../components/Confirm';
import Icon, { CoinIcon, NetIcon } from '../components/Icon';
import Success from '../components/Success';
import { AssetPicker, Btn, Input, Li, Page, Pill, Sheet } from '../components/ui';
import { amt, fiat, shortAddr } from '../format';
import { errText, useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic, readClipboard, scanQr } from '../telegram';
import { detectFamily, parseScan } from '../util';
import { Addr } from './Deposit';

/** Design sheet 02.8 — Withdraw: network detected from the address, first-time and scam-list checks, voucher fee, clear totals. */
export default function Withdraw({ query }) {
  const { t } = useI18n();
  const { wallet, me, config, loadWallet, toast } = useApp();
  const ask = useConfirm();
  const [asset, setAsset] = useState(query.asset || '');
  const [network, setNetwork] = useState(query.network || '');
  const [address, setAddress] = useState(query.address || '');
  const [memo, setMemo] = useState(query.memo || '');
  const [amount, setAmount] = useState(query.amount || '');
  const [preview, setPreview] = useState(null);
  const [perr, setPerr] = useState('');
  const [sheet, setSheet] = useState('');
  const [book, setBook] = useState([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const key = useRef(idem());
  const a = wallet?.assets?.find((x) => x.id === asset);
  const fam = detectFamily(address);
  const kindOf = (id) => config?.networks?.find((n) => n.id === id)?.kind;
  const nets = useMemo(() => (a?.networks || []).filter((n) => n.withdraw && (!fam || kindOf(n.network) === fam)), [a, fam, config]); // eslint-disable-line react-hooks/exhaustive-deps
  const net = nets.find((n) => n.network === network);

  useEffect(() => { if (!asset && wallet) { const best = [...wallet.assets].filter((x) => Number(x.available) > 0).sort((x, y) => Number(y.value_usd) - Number(x.value_usd))[0]; if (best) setAsset(best.id); } }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (nets.length && !nets.some((n) => n.network === network)) setNetwork(nets[0].network); }, [nets]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/api/addressbook').then((r) => setBook(r.items)).catch(() => {}); }, []);
  useEffect(() => {
    setPreview(null);
    setPerr('');
    if (!asset || !network || address.length < 20 || !Number(amount)) return undefined;
    const id = setTimeout(() => api.post('/api/withdraw/preview', { asset, network, address: address.trim(), amount, memo }, { silent: true })
      .then(setPreview).catch((e) => setPerr(errText(t, e))), 400);
    return () => clearTimeout(id);
  }, [asset, network, address, amount, memo]); // eslint-disable-line react-hooks/exhaustive-deps

  const scan = async () => {
    const r = parseScan(await scanQr(t('recipient_address')));
    if (r?.address) { setAddress(r.address); if (r.memo) setMemo(r.memo); if (r.network) setNetwork(r.network); }
  };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await withConfirm(ask, t, (f) => api.post('/api/withdraw', { asset, network, address: address.trim(), memo, amount, idem: key.current, ...f }), {
        head: (
          <div className="col center g6" style={{ padding: '4px 0 6px' }}>
            <CoinIcon asset={asset} network={network} size={56} />
            <span className="dim" style={{ fontSize: 13.5 }}>{t('you_are_withdrawing')}</span>
            <span className="mid" dir="ltr">{amt(preview.amount)} {asset}</span>
            <span className="dim small" dir="ltr">≈ {fiat(preview.usd)}</span>
          </div>
        ),
        rows: preview.internal
          ? [[t('to_label'), preview.recipient?.name], [t('fee'), <span className="ok">{t('free')}</span>]]
          : [[t('to_label'), <span className="mono">{shortAddr(preview.address, 8)}</span>], [t('network'), net?.name], [t('network_fee'), Number(preview.fee) ? `${amt(preview.fee)} ${asset}` : <span className="ok">{t('free')}</span>],
            [t('they_receive'), `${amt(preview.receive)} ${asset}`]],
        cta: t('withdraw_x', { amount: amt(preview.amount), asset }),
        title: t('confirm_withdraw'),
      });
      if (r) { setDone(r); loadWallet(); }
    } catch (e) { toast(errText(t, e), 'error'); haptic.error(); } finally { setBusy(false); }
  };

  if (done) {
    if (!done.internal) { go(`/tx/${done.id}`, true); return null; } // the processing screen follows the withdrawal live
    return (
      <Success title={t('sent')} amount={<span dir="ltr">{amt(done.amount)} {done.asset}</span>} sub={t('sent_to_now', { name: preview?.recipient?.name || '' })}
        actions={<Btn w onClick={() => go('/', true)}>{t('done')}</Btn>} />
    );
  }
  const hold = me.security_hold_until > Date.now() / 1000;
  const avail = Number(a?.available || 0);
  const over = Number(amount || 0) > avail;
  const voucher = preview?.voucher && Number(preview?.list_fee) > 0;

  return (
    <Page title={t('withdraw_title')} bar={<Btn w loading={busy} disabled={!preview || hold || over} onClick={submit}>{t('review_withdrawal')}</Btn>}>
      {hold && <div className="warn r"><Icon name="lock" size={18} /><span>{t('hold_active', { date: new Date(me.security_hold_until * 1000).toLocaleString() })}</span></div>}
      <button type="button" className="card row pad12" onClick={() => setSheet('asset')}>
        {asset ? <CoinIcon asset={asset} size={38} /> : <span className="ic n"><Icon name="coins" size={19} /></span>}
        <span className="grow"><b style={{ fontSize: 15 }}>{asset || t('choose_asset')}</b>{a && <small className="dim" style={{ display: 'block', fontSize: 12.5 }}>{t('available')} {amt(avail, a.display)}</small>}</span>
        <span className="chev"><Icon name="dd" size={18} /></span>
      </button>

      <div className="card col g8">
        <div className="row between"><span className="dim" style={{ fontSize: 12.5 }}>{t('to_address')}</span>
          <span className="row g6">
            <button type="button" className="ic xs n" onClick={async () => setAddress((await readClipboard()).trim())} aria-label={t('paste')}><Icon name="paste" size={15} /></button>
            <button type="button" className="ic xs n" onClick={scan} aria-label={t('scan')}><Icon name="scan" size={15} /></button>
            {book.length > 0 && <button type="button" className="ic xs n" onClick={() => setSheet('book')} aria-label={t('address_book')}><Icon name="contacts" size={15} /></button>}
          </span>
        </div>
        {address && fam ? <button type="button" style={{ textAlign: 'start' }} onClick={() => setAddress('')}><Addr value={address} size={14} /></button>
          : <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder="0x… · T… · UQ… · bc1…" dir="ltr" className="mono"
            style={{ background: 'none', border: 0, resize: 'none', color: 'var(--bone)', width: '100%' }} />}
        {address && (
          <div className="row g6 wrap">
            {fam && net && <Pill tone="b" icon="check">{nets.length === 1 ? t('network_detected', { name: net.name }) : t('network_selected', { name: net.name })}</Pill>}
            {address.length > 10 && !fam && <Pill tone="r" icon="alert">{t('address_unknown')}</Pill>}
            {preview && !preview.internal && preview.first_time && <Pill tone="y" icon="alert">{t('first_time_address')}</Pill>}
            {preview?.internal && <Pill tone="g" icon="bolt">{t('internal_detected_short')}</Pill>}
          </div>
        )}
        {fam && nets.length > 1 && (
          <div className="chips" style={{ margin: 0, padding: 0 }}>
            {nets.map((n) => <button key={n.network} type="button" className={`chip s2 ${n.network === network ? 'oe' : ''}`} onClick={() => setNetwork(n.network)}>
              <NetIcon network={n.network} size={16} />{n.short || n.name}</button>)}
          </div>
        )}
      </div>
      {network === 'ton' && me.ton_wallet && address !== me.ton_wallet.address && (
        <button type="button" className="note em" onClick={() => setAddress(me.ton_wallet.address)}><Icon name="wallet" size={15} />{t('to_my_ton_wallet')} · {shortAddr(me.ton_wallet.address)}</button>
      )}
      {(network === 'ton' || net?.memo) && <Input icon="tag" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={`${t('memo')} · ${t('optional')}`} dir="ltr" />}

      {asset && (
        <div className="card pad12">
          <div className="row between"><span className="dim" style={{ fontSize: 13 }}>{t('amount')}</span>
            <button type="button" className="em b" style={{ fontSize: 13 }} onClick={() => setAmount(String(avail))}>{t('max')}</button></div>
          <div className="row between" style={{ marginTop: 4 }}>
            <input className={`mid ${over ? 'bad' : ''}`} style={{ background: 'none', border: 0, fontSize: 32, width: '100%', color: over ? 'var(--bad)' : 'var(--bone)' }}
              inputMode="decimal" placeholder="0.00" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))} />
            <span className="dim disp" style={{ fontSize: 16 }}>{asset}</span>
          </div>
          <span className="dim small" dir="ltr">≈ {fiat(Number(amount || 0) * Number(a?.usd || 0))}{net ? ` · min ${net.min_withdraw}` : ''}</span>
        </div>
      )}
      {perr && <div className="warn r"><Icon name="alert" size={18} /><span>{perr}</span></div>}
      {preview && !preview.internal && (
        <div className="card tight">
          <div className="kv"><span>{t('network_fee')}</span><b>{voucher && <s className="dim">{amt(preview.list_fee)}</s>} {Number(preview.fee)
            ? `${amt(preview.fee)} ${asset}` : <span className="ok">{t('free')}{voucher ? ` · ${t('voucher')}` : ''}</span>}</b></div>
          <div className="kv"><span>{t('they_receive')}</span><b dir="ltr">{amt(preview.receive)} {asset}</b></div>
          <div className="kv"><span>{t('arrives_in')}</span><b>{preview.eta}</b></div>
        </div>
      )}
      <div className="warn"><Icon name="shield" size={18} /><span>{t('scam_checked_note')}</span></div>

      <AssetPicker open={sheet === 'asset'} onClose={() => setSheet('')} assets={wallet?.assets?.filter((x) => x.networks.some((n) => n.withdraw))}
        onPick={(x) => { setAsset(x.id); setNetwork(''); }} />
      <Sheet open={sheet === 'book'} onClose={() => setSheet('')} title={t('address_book')}>
        <div className="list">
          {book.map((b) => (
            <Li key={b.id} lead={<NetIcon network={b.network} size={34} />} title={b.label || shortAddr(b.address)} sub={shortAddr(b.address, 10)}
              right={b.whitelisted ? <Pill tone="g" icon="shieldok">{t('trusted')}</Pill> : null}
              onClick={() => { setAddress(b.address); setNetwork(b.network); if (b.memo) setMemo(b.memo); setSheet(''); }} />
          ))}
        </div>
      </Sheet>
    </Page>
  );
}
