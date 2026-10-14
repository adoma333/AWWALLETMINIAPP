import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { copyText, haptic } from '../telegram';
import { useI18n } from '../i18n';
import { back } from '../router';
import Icon, { CoinIcon, NetIcon } from './Icon';
import { amt, fiat } from '../format';

export function Page({ title, children, right, className = '', onBack }) {
  return (
    <main className={`page ${className}`}>
      {title !== undefined && (
        <header className="page-head">
          <button type="button" className="icon-btn" onClick={() => (onBack ? onBack() : back())} aria-label="back">
            <Icon name="chevron" className="flip-rtl rot180" />
          </button>
          <h1>{title}</h1>
          <div className="page-head-right">{right}</div>
        </header>
      )}
      {children}
    </main>
  );
}

export function Btn({ kind = 'primary', children, loading, className = '', ...rest }) {
  return (
    <button type="button" className={`btn ${kind} ${loading ? 'is-loading' : ''} ${className}`} disabled={loading || rest.disabled} {...rest}
      onClick={(e) => { haptic.tap(); rest.onClick?.(e); }}>
      {loading ? <span className="spinner" /> : children}
    </button>
  );
}

export function Card({ children, className = '', onClick, ...rest }) {
  const C = onClick ? 'button' : 'div';
  return <C type={onClick ? 'button' : undefined} className={`card ${onClick ? 'tap' : ''} ${className}`} onClick={onClick} {...rest}>{children}</C>;
}

export function Row({ label, value, mono, strong, children }) {
  return (
    <div className="kv">
      <span className="kv-k">{label}</span>
      <span className={`kv-v ${mono ? 'mono' : ''} ${strong ? 'strong' : ''}`}>{value}{children}</span>
    </div>
  );
}

export function Sheet({ open, onClose, title, children, tall }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-bg" onClick={onClose} role="presentation">
      <div className={`sheet ${tall ? 'tall' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sheet-grip" />
        {title && <h3 className="sheet-title">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', r = 10, style }) {
  return <span className="sk" style={{ height: h, width: w, borderRadius: r, ...style }} />;
}

export function Empty({ icon = 'sparkle', title, sub, action }) {
  return (
    <div className="empty">
      <span className="empty-ic"><Icon name={icon} size={30} /></span>
      {title && <b>{title}</b>}
      {sub && <p>{sub}</p>}
      {action}
    </div>
  );
}

export function CopyField({ value, label, mono = true, big }) {
  const { t } = useI18n();
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className={`copy-field ${big ? 'big' : ''}`} onClick={async () => {
      if (await copyText(value)) { haptic.success(); setOk(true); setTimeout(() => setOk(false), 1600); }
    }}>
      {label && <span className="cf-label">{label}</span>}
      <span className={`cf-value ${mono ? 'mono' : ''}`}>{value}</span>
      <span className={`cf-act ${ok ? 'ok' : ''}`}><Icon name={ok ? 'check' : 'copy'} size={18} />{ok ? t('copied') : t('copy')}</span>
    </button>
  );
}

export function QR({ value, size = 220, logo }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(value || ' ', { width: size * 2, margin: 1, errorCorrectionLevel: 'H', color: { dark: '#000000', light: '#ffffff' } })
      .then(setSrc).catch(() => setSrc(''));
  }, [value, size]);
  return (
    <div className="qr" style={{ width: size, height: size }}>
      {src && <img src={src} alt="QR" width={size} height={size} />}
      {logo && <span className="qr-logo">{logo}</span>}
    </div>
  );
}

export function Badge({ children, tone = 'ember', icon }) {
  return <span className={`badge ${tone}`}>{icon && <Icon name={icon} size={13} />}{children}</span>;
}

export function Status({ status }) {
  const { t } = useI18n();
  const tone = { completed: 'ok', claimed: 'ok', approved: 'ok', online: 'ok', answered: 'ok', failed: 'danger', rejected: 'danger',
    cancelled: 'mute', expired: 'mute', refunded: 'mute', closed: 'mute', offline: 'mute', appeal: 'danger' }[status] || 'ember';
  return <span className={`status-pill ${tone}`}>{t(`status_${status}`)}</span>;
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? 'on' : ''}
          onClick={() => { haptic.select(); onChange(v); }}>{label}</button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, sub }) {
  return (
    <label className="toggle-row">
      <span className="tr-text"><span>{label}</span>{sub && <small>{sub}</small>}</span>
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => { haptic.select(); onChange(e.target.checked); }} />
      <span className="toggle" aria-hidden="true" />
    </label>
  );
}

export function Field({ label, hint, error, children, right }) {
  return (
    <label className={`field ${error ? 'has-err' : ''}`}>
      {label && <span className="field-label">{label}{right && <span className="field-right">{right}</span>}</span>}
      {children}
      {error ? <span className="field-err">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/** Amount input with live fiat value, Max button and validation against the balance. */
export function AmountInput({ value, onChange, asset, max, usdPrice, display = 6, autoFocus }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const clean = (v) => {
    let s = String(v).replace(',', '.').replace(/[^\d.]/g, '');
    const i = s.indexOf('.');
    if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
    return s.slice(0, 24);
  };
  const over = max !== undefined && Number(value || 0) > Number(max || 0);
  return (
    <div className={`amount-box ${over ? 'over' : ''}`} onClick={() => ref.current?.focus()}>
      <div className="amount-line">
        <input ref={ref} inputMode="decimal" placeholder="0" value={value} autoFocus={autoFocus}
          onChange={(e) => onChange(clean(e.target.value))} dir="ltr" />
        <span className="amount-asset">{asset}</span>
      </div>
      <div className="amount-sub">
        <span>{usdPrice ? `≈ ${fiat(Number(value || 0) * Number(usdPrice))}` : ''}</span>
        {max !== undefined && (
          <button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); haptic.select(); onChange(String(max)); }}>
            {t('available')}: {amt(max, display)} · <b>{t('max')}</b>
          </button>
        )}
      </div>
    </div>
  );
}

export function AssetRow({ a, onClick, right, sub }) {
  return (
    <button type="button" className="asset-row" onClick={onClick}>
      <CoinIcon asset={a.id} size={40} />
      <span className="ar-main"><b>{a.id}</b><small>{sub ?? a.name}</small></span>
      <span className="ar-right">{right}</span>
    </button>
  );
}

export function AssetPicker({ open, onClose, assets, onPick, filter }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const list = (assets || []).filter((a) => (!filter || filter(a)) && (!q || `${a.id} ${a.name}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Sheet open={open} onClose={onClose} title={t('choose_asset')} tall>
      <div className="search"><Icon name="search" size={18} /><input placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="list">
        {list.map((a) => (
          <AssetRow key={a.id} a={a} onClick={() => { haptic.select(); onPick(a); onClose(); }}
            right={Number(a.available) > 0 ? <span className="mono">{amt(a.available, a.display)}</span> : null} />
        ))}
      </div>
    </Sheet>
  );
}

export function NetworkPicker({ open, onClose, networks, onPick, kind = 'deposit' }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={t('choose_network')}>
      <div className="list">
        {(networks || []).map((n) => {
          const off = kind === 'deposit' ? !n.deposit : !n.withdraw;
          return (
            <button key={n.network} type="button" className={`net-row ${off ? 'off' : ''}`} disabled={off}
              onClick={() => { haptic.select(); onPick(n); onClose(); }}>
              <NetIcon network={n.network} size={32} />
              <span className="ar-main"><b>{n.name}</b><small>{n.short} · {n.eta}{kind === 'withdraw' ? ` · min ${n.min_withdraw}` : ''}</small></span>
              {n.memo && <span className="badge mute">MEMO</span>}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

export function Countdown({ until, onEnd, render }) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 500);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, until - now);
  useEffect(() => { if (left <= 0) onEnd?.(); }, [left <= 0]); // eslint-disable-line react-hooks/exhaustive-deps
  return render ? render(left) : <span>{Math.ceil(left)}</span>;
}

export function Spark({ points, w = 120, h = 36, up }) {
  if (!points || points.length < 2) return null;
  const ys = points.map((p) => Number(p[1]));
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const d = ys.map((y, i) => `${(i / (ys.length - 1)) * w},${h - 2 - ((y - min) / (max - min || 1)) * (h - 4)}`).join(' L');
  const color = up ?? ys[ys.length - 1] >= ys[0] ? 'var(--ok)' : 'var(--danger)';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="spark" aria-hidden="true">
      <path d={`M${d}`} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Avatar({ src, name, size = 40 }) {
  const [err, setErr] = useState(false);
  const letter = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {src && !err ? <img src={src} alt="" width={size} height={size} onError={() => setErr(true)} /> : letter}
    </span>
  );
}
