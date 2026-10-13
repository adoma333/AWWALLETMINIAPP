import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/* ─────────── API ─────────── */
const KEY = 'aw_admin_session';

export function getSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return s && s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function setSession(s) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify({ ...s, exp: Date.now() + (s.expires_in || 0) * 1000 - 60000 }));
    else sessionStorage.removeItem(KEY);
  } catch { /* private mode: session lives in memory only */ }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(code, status, params) {
    super(code);
    this.code = code;
    this.status = status;
    this.params = params || {};
  }
}

export async function api(method, path, body) {
  const s = getSession();
  const res = await fetch('/api/admin' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: 'Bearer ' + s.token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const code = (data && data.error) || 'server_error';
    if (res.status === 401) onUnauthorized();
    throw new ApiError(code, res.status, data && data.params);
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const patch = (p, b) => api('PATCH', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);

export function qs(obj) {
  const p = Object.entries(obj).filter(([, v]) => v !== '' && v !== undefined && v !== null);
  return p.length ? '?' + p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
}

export function can(me, perm) {
  if (!me) return false;
  const p = me.perms || [];
  return p.includes('*') || p.includes(perm) || (perm === 'users_view' && p.includes('users'));
}

export const go = (path) => { window.location.hash = '#/' + path; };

/* ─────────── hooks ─────────── */
export function useLoad(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const reload = useCallback(() => {
    if (!path) return;
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    get(path).then(
      (data) => n === seq.current && setState({ data, error: null, loading: false }),
      (error) => n === seq.current && setState((s) => ({ data: s.data, error, loading: false })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(reload, [reload]);
  return { ...state, reload };
}

/* ─────────── toast ─────────── */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'err' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">{items.map((i) => <div key={i.id} className={'toast ' + i.kind}>{i.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}

/** Run an admin action with a toast + optional confirmation. Returns the result or undefined on failure. */
export function useAction() {
  const toast = useToast();
  return useCallback(async (fn, { ok = 'Done', confirm: q } = {}) => {
    if (q && !window.confirm(q)) return undefined;
    try {
      const r = await fn();
      if (ok) toast(ok);
      return r ?? true;
    } catch (e) {
      toast(errText(e), 'err');
      return undefined;
    }
  }, [toast]);
}

export function errText(e) {
  if (!e) return '';
  const code = e.code || e.message || 'error';
  const map = {
    forbidden: 'Your admin role does not allow this action.',
    bad_request: 'Invalid input — check the fields.',
    bad_state: 'This item changed state — refresh and try again.',
    not_found: 'Not found.',
    wallet_not_configured: 'The HD wallet is not initialised on the server yet (run the setup).',
    auth_invalid: 'Login link expired or already used. Send /admin to the bot again.',
    user_not_found: 'User not found.',
    server_error: 'Server error — see the logs.',
  };
  return map[code] || code.replace(/_/g, ' ');
}

/* ─────────── formatting ─────────── */
export const fmtDate = (ts) => (ts ? new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtAgo = (ts) => {
  if (!ts) return '—';
  const d = Math.floor(Date.now() / 1000 - ts);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};
export function usd(v) {
  const n = Number(v || 0);
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function num(v, max = 8) {
  const n = Number(v || 0);
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}
export const short = (s, n = 6) => (!s ? '—' : s.length > n * 2 + 3 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
export const userName = (r) => (r ? (r.username ? '@' + r.username : r.first_name || String(r.id || r.user_id || '')) : '—');

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* ─────────── UI primitives ─────────── */
export function Btn({ kind = 'ghost', small, children, busy, ...p }) {
  return (
    <button className={`btn ${kind}${small ? ' sm' : ''}`} disabled={busy || p.disabled} {...p}>
      {busy ? <span className="spin" /> : children}
    </button>
  );
}

/** A button that runs an async action and shows a spinner while it runs. */
export function ActBtn({ run, ok, confirm, onDone, children, ...p }) {
  const act = useAction();
  const [busy, setBusy] = useState(false);
  return (
    <Btn {...p} busy={busy} onClick={async () => {
      setBusy(true);
      const r = await act(run, { ok, confirm });
      setBusy(false);
      if (r !== undefined && onDone) onDone(r);
    }}>{children}</Btn>
  );
}

export function Card({ title, right, children, className = '' }) {
  return (
    <section className={'card ' + className}>
      {(title || right) && <header className="card-h"><h3>{title}</h3><div className="row gap">{right}</div></header>}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone, onClick }) {
  return (
    <div className={'stat' + (tone ? ' ' + tone : '') + (onClick ? ' click' : '')} onClick={onClick}>
      <div className="stat-l">{label}</div>
      <div className="stat-v">{value}</div>
      {sub && <div className="stat-s">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = '' }) {
  return <span className={'badge ' + tone}>{children}</span>;
}

const STATUS_TONE = {
  completed: 'ok', credited: 'ok', approved: 'ok', active: 'ok', online: 'ok', resolved: 'ok', done: 'ok', answered: 'ok', confirmed: 'ok',
  review: 'warn', stuck: 'danger', pending: 'warn', processing: 'info', broadcast: 'info', seen: 'info', waiting_admin: 'warn', appeal: 'danger',
  paid: 'info', new: 'warn', open: 'warn', no_owner: 'danger', below_min: 'warn', unrecognized: 'warn', disabled: 'warn',
  failed: 'danger', rejected: 'danger', cancelled: '', ignored: '', frozen: 'warn', banned: 'danger', blocked: 'danger', offline: '', closed: '',
};
export const Status = ({ s }) => <Badge tone={STATUS_TONE[s] || ''}>{String(s || '—').replace(/_/g, ' ')}</Badge>;

export function Tabs({ value, onChange, items }) {
  return (
    <div className="tabs">
      {items.map(([v, label, count]) => (
        <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}{count ? <i>{count}</i> : null}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, wide }) {
  return (
    <label className={'field' + (wide ? ' wide' : '')}>
      <span className="field-l">{label}</span>
      {children}
      {hint && <span className="field-h">{hint}</span>}
    </label>
  );
}

export function Input({ value, onChange, ...p }) {
  return <input className="inp" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...p} />;
}

export function Select({ value, onChange, options, ...p }) {
  return (
    <select className="inp" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...p}>
      {options.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>))}
    </select>
  );
}

export function Toggle({ on, onChange, disabled, label }) {
  return (
    <button type="button" className={'tg' + (on ? ' on' : '')} disabled={disabled} onClick={() => onChange(!on)} title={label}>
      <i />{label && <span>{label}</span>}
    </button>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <header><h3>{title}</h3><button className="x" onClick={onClose}>×</button></header>
        <div className="modal-b">{children}</div>
      </div>
    </div>
  );
}

export function Table({ cols, rows, empty = 'Nothing here', onRow, rowKey = (r, i) => r.id ?? i }) {
  if (!rows) return <div className="loading"><span className="spin" /></div>;
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr>{cols.map((c) => <th key={c[0]} className={c[2] || ''}>{c[0]}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} onClick={onRow ? () => onRow(r) : undefined} className={onRow ? 'click' : ''}>
              {cols.map((c) => <td key={c[0]} className={c[2] || ''} data-l={c[0]}>{c[1](r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Copy({ text, children }) {
  const toast = useToast();
  return (
    <span className="copy" title="Copy" onClick={(e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(text).then(() => toast('Copied'));
    }}>{children ?? text}</span>
  );
}

export function Loading({ error, reload }) {
  if (error) return <div className="empty err">{errText(error)} {reload && <Btn small onClick={reload}>Retry</Btn>}</div>;
  return <div className="loading"><span className="spin" /></div>;
}

/** Tiny dependency-free bar chart. */
export function Bars({ data, value, label, height = 120, fmt = (v) => v }) {
  const max = Math.max(1, ...data.map(value));
  return (
    <div className="bars" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="bar" title={`${label(d)}: ${fmt(value(d))}`}>
          <i style={{ height: `${(value(d) / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

/** JSON editor with validation — used for complex settings (lists of objects, reward specs…). */
export function JsonEdit({ value, onChange, rows = 8 }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(JSON.stringify(value, null, 2));
    }
  }, [value]);
  return (
    <textarea className={'inp mono' + (bad ? ' bad' : '')} rows={rows} value={text} spellCheck={false} onChange={(e) => {
      setText(e.target.value);
      try {
        const v = JSON.parse(e.target.value);
        setBad(false);
        last.current = v;
        onChange(v);
      } catch {
        setBad(true);
      }
    }} />
  );
}
