import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, idem } from '../api';
import Icon, { CoinIcon } from '../components/Icon';
import Success from '../components/Success';
import { useToast } from '../components/Toast';
import { AssetPicker, Btn, Countdown, Page, Row } from '../components/ui';
import { amt, fiat, num } from '../format';
import { errText, useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic } from '../telegram';

export default function Swap({ query }) {
  const { t } = useI18n();
  const { wallet, loadWallet } = useApp();
  const toast = useToast();
  const [from, setFrom] = useState(query.from || 'USDT');
  const [to, setTo] = useState(query.to || (query.from === 'TON' ? 'USDT' : 'TON'));
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState(null);
  const [qerr, setQerr] = useState('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const key = useRef(idem());
  const assets = wallet?.assets?.filter((x) => x.swap) || [];
  const fa = assets.find((x) => x.id === from);
  const ta = assets.find((x) => x.id === to);

  const requote = useCallback(async () => {
    if (!Number(amount) || from === to) { setQuote(null); return; }
    try {
      const q = await api.post('/api/swap/quote', { from, to, amount });
      setQuote({ ...q, until: Date.now() / 1000 + q.expires_in });
      setQerr('');
    } catch (e) { setQuote(null); setQerr(errText(t, e)); }
  }, [amount, from, to, t]);

  useEffect(() => {
    setQuote(null);
    const id = setTimeout(requote, 450);
    return () => clearTimeout(id);
  }, [requote]);

  const flip = () => { haptic.select(); setFrom(to); setTo(from); setAmount(quote ? quote.amount_out : ''); };
  const exec = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/swap/execute', { quote_id: quote.id, idem: key.current });
      setDone(r);
      key.current = idem();
      loadWallet();
    } catch (e) {
      toast(errText(t, e), e.code === 'quote_expired' ? 'info' : 'error');
      if (e.code === 'quote_expired' || e.code === 'quote_used') requote();
    } finally { setBusy(false); }
  };
  if (done) {
    return (
      <Page>
        <Success title={t('swap_success')} sub={`${amt(done.amount_in)} ${done.from} → ${amt(done.amount_out)} ${done.to}`}>
          <Btn className="wide" onClick={() => { setDone(null); setAmount(''); setQuote(null); }}>{t('done')}</Btn>
          <Btn kind="soft" className="wide" onClick={() => go(`/tx/${done.id}`)}>{t('details')}</Btn>
        </Success>
      </Page>
    );
  }
  const over = Number(amount) > Number(fa?.available || 0);
  return (
    <main className="page swap">
      <h1 className="page-title">{t('swap_title')}</h1>
      <div className="swap-box">
        <div className="swap-side">
          <div className="ss-top"><span>{t('you_send')}</span>
            <button type="button" className="link-btn" onClick={() => setAmount(String(fa?.available || '0'))}>{t('available')}: {amt(fa?.available || 0, fa?.display)} · <b>{t('max')}</b></button></div>
          <div className="ss-main">
            <input inputMode="decimal" placeholder="0" value={amount} dir="ltr" className={over ? 'over' : ''}
              onChange={(e) => setAmount(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))} />
            <button type="button" className="coin-btn" onClick={() => setPick('from')}><CoinIcon asset={from} size={28} /><b>{from}</b><Icon name="chevronDown" size={16} /></button>
          </div>
          <small className="dim" dir="ltr">≈ {fiat(Number(amount || 0) * Number(fa?.usd || 0))}</small>
        </div>
        <button type="button" className="flip" onClick={flip} aria-label="flip"><Icon name="swap" size={20} /></button>
        <div className="swap-side">
          <div className="ss-top"><span>{t('you_receive')}</span><span className="dim">{t('balance')}: {amt(ta?.available || 0, ta?.display)}</span></div>
          <div className="ss-main">
            <div className={`out ${quote ? '' : 'dim'}`} dir="ltr">{quote ? amt(quote.amount_out, ta?.display) : '0'}</div>
            <button type="button" className="coin-btn" onClick={() => setPick('to')}><CoinIcon asset={to} size={28} /><b>{to}</b><Icon name="chevronDown" size={16} /></button>
          </div>
          <small className="dim" dir="ltr">≈ {fiat(Number(quote?.amount_out || 0) * Number(ta?.usd || 0))}</small>
        </div>
      </div>
      {qerr && <p className="field-err">{qerr}</p>}
      {quote && (
        <div className="kv-box">
          <Row label={t('rate')} value={`1 ${from} = ${num(quote.rate, 8)} ${to}`} />
          <Row label={t('fee')}>
            <span className="mini-badge ok">{quote.free ? t('free') : t('margin_included', { pct: num(quote.spread_pct, 2) })}</span>
          </Row>
          {quote.vip?.level > 0 && <Row label={t('vip_title')} value={`${quote.vip.name} · −${quote.vip.discount_pct}%`} />}
          {quote.voucher && <Row label={t('my_vouchers')} value={t('fee_free_badge')} />}
          <p className="hint"><Icon name="bolt" size={14} /> {t('no_network_fee')}</p>
          <Countdown until={quote.until} onEnd={requote} render={(left) => (
            <div className="quote-timer"><span style={{ width: `${(left / quote.expires_in) * 100}%` }} /><small>{t('rate_locked', { s: Math.ceil(left) })}</small></div>
          )} />
        </div>
      )}
      <Btn className="wide" loading={busy} disabled={!quote || over} onClick={exec}>{over ? t('err_insufficient_funds', { asset: from }) : t('swap_now')}</Btn>
      <AssetPicker open={pick === 'from'} onClose={() => setPick('')} assets={assets} onPick={(x) => { if (x.id === to) setTo(from); setFrom(x.id); }} />
      <AssetPicker open={pick === 'to'} onClose={() => setPick('')} assets={assets} onPick={(x) => { if (x.id === from) setFrom(to); setTo(x.id); }} />
    </main>
  );
}
