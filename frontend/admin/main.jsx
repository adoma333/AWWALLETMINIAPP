import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './admin.css';

import { Component, lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Logo from '../src/components/Logo';
import { Btn, can, errText, getSession, Loading, post, setSession, setUnauthorizedHandler, ToastHost, useLoad } from './lib.jsx';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));
const Money = lazy(() => import('./pages/Money.jsx'));
const Catalog = lazy(() => import('./pages/Catalog.jsx'));
const Fees = lazy(() => import('./pages/Fees.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const P2P = lazy(() => import('./pages/P2P.jsx'));
const Support = lazy(() => import('./pages/Support.jsx'));
const Ops = lazy(() => import('./pages/Ops.jsx'));

// [route, label, icon, permission, component, extra props]
const NAV = [
  ['dashboard', 'Dashboard', '◉', 'view', Dashboard],
  ['users', 'Users', '☺', 'users_view', Users],
  ['withdrawals', 'Withdrawals', '↑', 'withdrawals', Money, { tab: 'withdrawals' }],
  ['deposits', 'Deposits', '↓', 'finance', Money, { tab: 'deposits' }],
  ['treasury', 'Treasury', '⛁', 'finance', Money, { tab: 'treasury' }],
  ['revenue', 'Revenue', '$', 'finance', Money, { tab: 'revenue' }],
  ['p2p', 'P2P & disputes', '⇄', 'p2p', P2P],
  ['support', 'Support', '✉', 'support', Support],
  ['kyc', 'Verification', '✓', 'users', Support, { tab: 'kyc' }],
  ['catalog', 'Coins & networks', '◈', 'view', Catalog],
  ['fees', 'Fees & VIP', '%', 'view', Fees],
  ['settings', 'Settings', '⚙', 'view', Settings],
  ['icons', 'Icons & media', '▣', 'view', Ops, { tab: 'icons' }],
  ['broadcast', 'Broadcast', '📣', 'content', Ops, { tab: 'broadcast' }],
  ['admins', 'Team', '♛', 'view', Ops, { tab: 'admins' }],
  ['apps', 'Apps & downloads', '⬇', 'settings', Ops, { tab: 'apps' }],
  ['audit', 'Audit log', '≡', 'view', Ops, { tab: 'audit' }],
  ['system', 'System', '⌘', 'view', Ops, { tab: 'system' }],
];

class Boundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return <div className="empty err">This page crashed: {String(this.state.err.message || this.state.err)} <button className="btn sm" onClick={() => this.setState({ err: null })}>Retry</button></div>;
  }
}

function useHash() {
  const [h, setH] = useState(() => window.location.hash);
  useEffect(() => {
    const f = () => setH(window.location.hash);
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

function Login({ error }) {
  return (
    <div className="login">
      <span className="login-logo"><Logo height={22} /></span>
      <h1>Admin panel</h1>
      {error && <div className="empty err">{errText(error)}</div>}
      <ol>
        <li>Open the bot in Telegram and send <b>/admin</b>.</li>
        <li>Tap the one-time login button (valid 5 minutes) — or open the panel inside Telegram.</li>
      </ol>
      <p className="dim small">Only Telegram accounts listed in ADMIN_IDS or added under “Team” can sign in. Sessions last 12 hours.</p>
    </div>
  );
}

function App() {
  const hash = useHash();
  const [session, setS] = useState(getSession);
  const [loginErr, setLoginErr] = useState(null);
  const [booting, setBooting] = useState(!getSession());
  const [menu, setMenu] = useState(false);

  const logout = useCallback(() => { setSession(null); setS(null); }, []);
  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  // sign in: one-time link (#login=…) → Telegram initData → stored session
  useEffect(() => {
    const m = window.location.hash.match(/login=([\w-]+)/);
    const tgData = window.Telegram?.WebApp?.initData;
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
    const attempt = m ? post('/login', { token: m[1] }) : tgData && !getSession() ? post('/login', { init_data: tgData }) : null;
    if (m) window.history.replaceState(null, '', window.location.pathname + '#/dashboard');
    if (!attempt) { setBooting(false); return; }
    attempt.then((s) => { setSession(s); setS(getSession()); }, setLoginErr).finally(() => setBooting(false));
  }, []);

  const me = useLoad(session ? '/me' : null, [session?.token]);

  if (booting) return <Loading />;
  if (!session) return <Login error={loginErr} />;
  if (!me.data) return <Loading error={me.error} reload={me.reload} />;

  const parts = hash.replace(/^#\/?/, '').split('/');
  const route = parts[0] || 'dashboard';
  const nav = NAV.filter((n) => can(me.data, n[3]));
  const cur = nav.find((n) => n[0] === route) || nav[0];
  const Page = cur[4];

  return (
    <div className="shell">
      <aside className={'side' + (menu ? ' open' : '')}>
        <div className="side-logo"><Logo height={14} /><span>ADMIN</span></div>
        <nav>
          {nav.map((n) => (
            <a key={n[0]} href={'#/' + n[0]} className={n[0] === cur[0] ? 'on' : ''} onClick={() => setMenu(false)}>
              <i>{n[2]}</i>{n[1]}
            </a>
          ))}
        </nav>
        <div className="side-me">
          <div><b>{me.data.name}</b><span className="dim small">{me.data.role}</span></div>
          <Btn small onClick={logout}>Sign out</Btn>
        </div>
      </aside>
      {menu && <div className="side-bg" onClick={() => setMenu(false)} />}
      <main className="main">
        <div className="topbar">
          <button className="burger" onClick={() => setMenu(true)}>☰</button>
          <h2>{cur[1]}</h2>
        </div>
        <Boundary key={hash}>
          <Suspense fallback={<Loading />}>
            <Page key={cur[0]} me={me.data} sub={parts.slice(1)} {...(cur[5] || {})} />
          </Suspense>
        </Boundary>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<ToastHost><App /></ToastHost>);
