import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { amt, fiat } from '../format';
import { useI18n } from '../i18n';
import { back } from '../router';
import { copyText, haptic } from '../telegram';
import Icon, { CoinIcon, NetIcon } from './Icon';

// Building blocks of the ZOHRA design sheets. Every screen is composed from these, so spacing, radii, weights and
// icons stay identical everywhere.

/** Screen with the sheet header: round back button, centred title, optional right slot. `root` hides the back button. */
export function Page({ title, children, right, className = '', onBack, root = false, bar, head = true }) {
  return (
    <main className={`page ${bar ? 'has-bar' : ''} ${className}`}>
      {head && title !== undefined && (
        <header className="head">
          <span className="side">
            {!root && (
              <button type="button" className="ic n sm" onClick={() => { haptic.tap(); onBack ? onBack() : back(); }} aria-label="back">
                <Icon name="back" size={20} className="flip-rtl" />
              </button>
            )}
          </span>
          <h1>{title}</h1>
          <span className="side">{right}</span>
        </header>
      )}
      {children}
      {bar && <div className="bar-bottom">{bar}</div>}
    </main>
  );
}

/** Big left-aligned title used on the root tabs (Trade, Z Pay, Rewards). */
export function RootHead({ title, right }) {
  return <div className="root-head"><span className="h">{title}</span>{right && <span className="row g6">{right}</span>}</div>;
}

export function HeadBtn({ icon, onClick, label, dot }) {
  return (
    <button type="button" className="ic n sm" onClick={() => { haptic.tap(); onClick?.(); }} aria-label={label || icon}>
      <Icon name={icon} size={19} />{dot && <i className="dot" />}
    </button>
  );
}

const KIND = { primary: 'p', secondary: 's', soft: 'f', p: 'p', s: 's', f: 'f', ghost: 'ghost', danger: 'danger', ok: 'okb', okb: 'okb' };
export function Btn({ kind = 'p', size, w, children, loading, className = '', icon, ...rest }) {
  return (
    <button type="button" {...rest} className={`btn ${KIND[kind] || kind} ${size || ''} ${w ? 'w' : ''} ${className}`} disabled={loading || rest.disabled}
      onClick={(e) => { haptic.tap(); rest.onClick?.(e); }}>
      {loading ? <span className="spin" /> : <>{icon && <Icon name={icon} size={size === 'sm' || size === 'xs' ? 16 : 18} />}{children}</>}
    </button>
  );
}

export function Card({ children, className = '', onClick, ...rest }) {
  const C = onClick ? 'button' : 'div';
  return <C type={onClick ? 'button' : undefined} className={`card ${className}`} onClick={onClick ? (e) => { haptic.tap(); onClick(e); } : undefined} {...rest}>{children}</C>;
}

export function KV({ k, children, mono, className = '' }) {
  return <div className="kv"><span>{k}</span><b className={`${mono ? 'mono' : ''} ${className}`}>{children}</b></div>;
}
export const Row = ({ label, value, mono, strong, children }) => <KV k={label} mono={mono}>{value}{children}</KV>;

/** One list row: leading icon / coin / avatar, title + subtitle, trailing content, optional chevron. */
export function Li({ icon, tone = '', coin, net, av, lead, title, sub, right, chev, onClick, className = '', subClass = '' }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C type={onClick ? 'button' : undefined} className={`li ${className}`} onClick={onClick ? () => { haptic.select(); onClick(); } : undefined}>
      {lead}
      {icon && <span className={`ic ${tone}`}><Icon name={icon} size={19} /></span>}
      {coin && <CoinIcon asset={coin} network={net} size={40} />}
      {av}
      <span className="grow"><span className="t ellipsis">{title}</span>{sub !== undefined && sub !== null && <small className={subClass}>{sub}</small>}</span>
      {right}
      {chev && <span className="chev"><Icon name="chev" size={18} /></span>}
    </C>
  );
}

export function Pill({ tone = '', icon, children, className = '' }) {
  return <span className={`pill ${tone} ${className}`}>{icon && <Icon name={icon} size={12} stroke={2.4} />}{children}</span>;
}
export const Badge = ({ children, tone = '', icon }) => <Pill tone={{ ok: 'g', mute: 'n', danger: 'r', warn: 'y', ember: '' }[tone] ?? tone} icon={icon}>{children}</Pill>;

export function Status({ status }) {
  const { t } = useI18n();
  const tone = { completed: 'g', claimed: 'g', approved: 'g', online: 'g', answered: 'g', paid: 'g', released: 'g', failed: 'r', rejected: 'r',
    cancelled: 'n', expired: 'n', refunded: 'n', closed: 'n', offline: 'n', appeal: 'r', pending: 'y', processing: 'y', review: 'y' }[status] || '';
  return <Pill tone={tone}>{t(`status_${status}`)}</Pill>;
}

export function Segmented({ value, onChange, options, variant = '' }) {
  return (
    <div className={`seg ${variant}`} role="tablist">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? 'on' : ''}
          onClick={() => { haptic.select(); onChange(v); }}>{label}</button>
      ))}
    </div>
  );
}

export function Chips({ value, onChange, options, tone = 'on' }) {
  return (
    <div className="chips">
      {options.map(([v, label, extra]) => (
        <button key={v} type="button" className={`chip ${value === v ? tone : ''}`} onClick={() => { haptic.select(); onChange(v); }}>{extra}{label}</button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} disabled={disabled} className={`toggle ${on ? 'on' : ''}`}
      onClick={() => { haptic.select(); onChange?.(!on); }}><i /></button>
  );
}
/** A list row with a switch at the end. */
export function Toggle({ checked, onChange, label, sub, icon, tone }) {
  return <Li icon={icon} tone={tone} title={label} sub={sub} className="sm" right={<Switch on={checked} onChange={onChange} />} />;
}

export function Field({ label, hint, error, children, right }) {
  return (
    <label className="field">
      {label && <span className="lbl"><span>{label}</span>{right}</span>}
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}
export function Input({ icon, right, className = '', ...p }) {
  return <div className={`input ${className}`}>{icon && <Icon name={icon} size={18} />}<input {...p} />{right}</div>;
}
export function SearchBox({ value, onChange, placeholder, right }) {
  return <div className="search"><Icon name="search" size={18} /><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />{right}</div>;
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
      <div className={`sheetm ${tall ? 'tall' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="grip" />
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', r = 12, style }) {
  return <span className="sk" style={{ height: h, width: w, borderRadius: r, ...style }} />;
}
/** Skeleton for a list of rows (coin / avatar + two lines + amount). */
export function SkeletonList({ rows = 4 }) {
  return (
    <div className="list">
      {Array.from({ length: rows }, (_, i) => (
        <div className="li" key={i}>
          <Skeleton w={40} h={40} r={20} />
          <span className="grow col g6"><Skeleton w={70} h={12} /><Skeleton w={110} h={10} /></span>
          <span className="col g6" style={{ alignItems: 'flex-end' }}><Skeleton w={60} h={12} /><Skeleton w={44} h={10} /></span>
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon = 'sparkle', title, sub, action }) {
  return (
    <div className="empty">
      <span className="ic"><Icon name={icon} size={30} /></span>
      {title && <b>{title}</b>}
      {sub && <p>{sub}</p>}
      {action}
    </div>
  );
}

export function useCopy() {
  const [ok, setOk] = useState(false);
  return [ok, async (v) => { if (await copyText(v)) { haptic.success(); setOk(true); setTimeout(() => setOk(false), 1600); } }];
}
export function CopyField({ value, label, mono = true }) {
  const { t } = useI18n();
  const [ok, copy] = useCopy();
  return (
    <button type="button" className="card col g8" onClick={() => copy(value)}>
      {label && <span className="dim small">{label}</span>}
      <span className={mono ? 'mono' : ''} style={{ fontSize: 14.5, lineHeight: 1.5 }} dir="ltr">{value}</span>
      <span className={`row g6 small b ${ok ? 'ok' : 'em'}`}><Icon name={ok ? 'check' : 'copy'} size={15} />{ok ? t('copied') : t('copy')}</span>
    </button>
  );
}

export function QR({ value, size = 232, logo }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(value || ' ', { width: size * 2, margin: 0, errorCorrectionLevel: 'H', color: { dark: '#000000', light: '#ffffff' } })
      .then(setSrc).catch(() => setSrc(''));
  }, [value, size]);
  return (
    <div className="qr" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="QR" /> : <Skeleton h="100%" />}
      {logo && <span className="lg">{logo}</span>}
    </div>
  );
}

export function Keypad({ onKey, dot = true, left, small }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', dot ? '.' : (left ? 'L' : ''), '0', 'del'];
  return (
    <div className={`keypad ${small ? 'sm' : ''}`} dir="ltr">
      {keys.map((k, i) => (k === '' ? <span key={i} /> : (
        <button key={i} type="button" aria-label={k === 'del' ? 'delete' : k} onClick={() => { haptic.select(); k === 'L' ? left?.onClick() : onKey(k); }}>
          {k === 'del' ? <Icon name="del" size={24} /> : k === 'L' ? left.node : k}
        </button>
      )))}
    </div>
  );
}

export function PinDots({ n = 6, filled, shake }) {
  return <div className={`pin ${shake ? 'shake' : ''}`}>{Array.from({ length: n }, (_, i) => <i key={i} className={i < filled ? 'on' : ''} />)}</div>;
}

/** Vertical progress timeline: steps = [{ title, sub, state: 'done'|'now'|'fail'|'' }] */
export function Timeline({ steps }) {
  return (
    <div className="tl">
      {steps.map((s, i) => (
        <div key={i} className={`st ${s.state || ''}`}>
          <span className="dot">{s.state === 'done' && <Icon name="check" size={13} stroke={3} />}{s.state === 'fail' && <Icon name="x" size={13} stroke={3} />}</span>
          <div><b className={s.state === 'now' ? 'em' : s.state ? '' : 'dim'}>{s.title}</b>{s.sub && <small>{s.sub}</small>}</div>
        </div>
      ))}
    </div>
  );
}

export function Ring({ pct, size = 120, stroke = 10, children }) {
  const id = useMemo(() => `rg${Math.random().toString(36).slice(2, 8)}`, []);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FF9A1A" /><stop offset="1" stopColor="#FF4D00" /></linearGradient></defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--s3)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={`url(#${id})`} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${c * Math.max(0, Math.min(1, pct))} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .6s' }} />
      </svg>
      {children && <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{children}</span>}
    </div>
  );
}

export function Spark({ points, w = 54, h = 24, up }) {
  if (!points || points.length < 2) return <span style={{ width: w }} />;
  const ys = points.map((p) => Number(Array.isArray(p) ? p[1] : p));
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const d = ys.map((y, i) => `${((i / (ys.length - 1)) * w).toFixed(1)},${(h - 3 - ((y - min) / (max - min || 1)) * (h - 6)).toFixed(1)}`).join(' L');
  const color = (up ?? ys[ys.length - 1] >= ys[0]) ? 'var(--ok)' : 'var(--bad)';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="spark" aria-hidden="true">
      <path d={`M${d}`} fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Area chart with the gradient fill, dashed last-price line and an interactive scrubber. */
export function AreaChart({ points, h = 160, format }) {
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const w = 390;
  if (!points || points.length < 2) return <div className="chart-box"><Skeleton h={h} r={0} /></div>;
  const ys = points.map((p) => Number(p[1]));
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const pts = ys.map((y, i) => [(i / (ys.length - 1)) * w, 10 + (1 - (y - min) / (max - min || 1)) * (h - 24)]);
  const d = `M${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L')}`;
  const last = pts[pts.length - 1];
  const up = ys[ys.length - 1] >= ys[0];
  const col = up ? '#FF8A00' : '#FF6B5E';
  const onMove = (e) => {
    const r = box.current.getBoundingClientRect();
    const x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(x * (points.length - 1)))));
  };
  return (
    <div className="chart-box" ref={box} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onTouchMove={onMove} onTouchEnd={() => setHover(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} height={h} preserveAspectRatio="none">
        <defs><linearGradient id="arfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={col} stopOpacity=".35" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
        <path d={`${d} L${w},${h} L0,${h} Z`} fill="url(#arfill)" />
        <path d={d} fill="none" stroke={col} strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <line x1="0" x2={w} y1={last[1]} y2={last[1]} stroke={col} strokeOpacity=".35" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        {hover === null && <circle cx={last[0] - 2} cy={last[1]} r="5" fill={col} stroke="#000" strokeWidth="3" />}
        {hover !== null && <><line x1={pts[hover][0]} x2={pts[hover][0]} y1="0" y2={h} stroke="var(--ash)" strokeOpacity=".5" vectorEffect="non-scaling-stroke" />
          <circle cx={pts[hover][0]} cy={pts[hover][1]} r="5" fill={col} stroke="#000" strokeWidth="3" /></>}
      </svg>
      {hover !== null && <span className="chart-tip" style={{ left: `${(pts[hover][0] / w) * 100}%` }}>{format ? format(points[hover]) : ys[hover]}</span>}
    </div>
  );
}

const GRADS = [['#FF9A1A', '#FF4D00'], ['#7B61FF', '#B06BFF'], ['#00B4D8', '#0077B6'], ['#FF6B9A', '#FF3D6E'], ['#3DDC97', '#14A86B'], ['#FFC24A', '#FF8A00']];
export function Avatar({ src, name, size = 40, seed }) {
  const [err, setErr] = useState(false);
  const letter = (name || '?').trim().charAt(0).toUpperCase();
  const k = String(seed ?? name ?? '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % GRADS.length;
  return (
    <span className="av" style={{ width: size, height: size, fontSize: size * 0.4, background: `linear-gradient(135deg,${GRADS[k][0]},${GRADS[k][1]})` }}>
      {src && !err ? <img src={src} alt="" onError={() => setErr(true)} /> : letter}
    </span>
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
export const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function AssetPicker({ open, onClose, assets, onPick, filter }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const list = (assets || []).filter((a) => (!filter || filter(a)) && (!q || `${a.id} ${a.name}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Sheet open={open} onClose={onClose} title={t('choose_asset')} tall>
      <SearchBox value={q} onChange={setQ} placeholder={t('search')} />
      <div className="list">
        {list.map((a) => (
          <Li key={a.id} coin={a.id} title={a.id} sub={a.name} onClick={() => { onPick(a); onClose(); }}
            right={Number(a.available) > 0 ? <span className="r"><b>{amt(a.available, a.display)}</b><small>{fiat(a.value_usd)}</small></span> : null} />
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
            <Li key={n.network} lead={<NetIcon network={n.network} size={36} />} title={n.name}
              sub={`${n.short} · ${n.eta}${kind === 'withdraw' ? ` · min ${n.min_withdraw}` : ''}`} className={off ? 'dim' : ''}
              onClick={off ? undefined : () => { onPick(n); onClose(); }} right={off ? <Pill tone="n">{t('unavailable')}</Pill> : null} />
          );
        })}
      </div>
    </Sheet>
  );
}

/** Amount entered with the big on-screen keypad (send, request, withdraw). */
export function useAmountKeys(initial = '', decimals = 8) {
  const [v, setV] = useState(initial);
  const press = (k) => setV((cur) => {
    if (k === 'del') return cur.slice(0, -1);
    if (k === '.') return cur.includes('.') ? cur : (cur || '0') + '.';
    if (cur === '0') return k;
    const [, frac = ''] = cur.split('.');
    if (cur.includes('.') && frac.length >= decimals) return cur;
    return (cur + k).slice(0, 18);
  });
  return [v, setV, press];
}
export function AmountView({ value, over }) {
  const s = value || '0';
  const [i, f] = s.split('.');
  return (
    <div className={`amount-big ${over ? 'over' : ''}`} dir="ltr">
      {Number(i || 0).toLocaleString('en')}{s.includes('.') ? <span>.{f}</span> : <span className="rest">.00</span>}
    </div>
  );
}

/** Legacy amount input (text field) used on forms where a keypad does not fit. */
export function AmountInput({ value, onChange, asset, max, usdPrice, display = 6, autoFocus }) {
  const { t } = useI18n();
  const clean = (v) => {
    let s = String(v).replace(',', '.').replace(/[^\d.]/g, '');
    const i = s.indexOf('.');
    if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
    return s.slice(0, 24);
  };
  const over = max !== undefined && Number(value || 0) > Number(max || 0);
  return (
    <div className="card pad12">
      <div className="row between small dim"><span>{t('amount')}</span>
        {max !== undefined && <button type="button" className="em b" onClick={() => { haptic.select(); onChange(String(max)); }}>{t('max')}</button>}</div>
      <div className="row between" style={{ marginTop: 4 }}>
        <input className={`mid ${over ? 'bad' : ''}`} style={{ background: 'none', border: 0, width: '100%', fontSize: 30 }} inputMode="decimal" placeholder="0"
          value={value} autoFocus={autoFocus} onChange={(e) => onChange(clean(e.target.value))} dir="ltr" />
        <span className="dim disp" style={{ fontSize: 16 }}>{asset}</span>
      </div>
      <div className="row between small dim" style={{ marginTop: 2 }}>
        <span>{usdPrice ? `≈ ${fiat(Number(value || 0) * Number(usdPrice))}` : ''}</span>
        {max !== undefined && <span>{t('available')} {amt(max, display)}</span>}
      </div>
    </div>
  );
}
