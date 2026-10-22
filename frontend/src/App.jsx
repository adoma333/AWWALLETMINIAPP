import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import BottomNav from './components/BottomNav';
import { ConfirmProvider } from './components/Confirm';
import Icon from './components/Icon';
import { useToast } from './components/Toast';
import { setFx, setLocale } from './format';
import { I18n, applyDir, detectLang, errText, loadLang, makeT } from './i18n';
import { go, match, useRoute } from './router';
import { AppCtx } from './store';
import { applyBrand } from './theme';
import { hideSplash, splashProgress } from './splash';
import { backButton, inTelegram, startParam, tg } from './telegram';
import Home from './pages/Home';
import Outside from './pages/Outside';

const Asset = lazy(() => import('./pages/Asset'));
const Deposit = lazy(() => import('./pages/Deposit'));
const Send = lazy(() => import('./pages/Send'));
const Withdraw = lazy(() => import('./pages/Withdraw'));
const Gift = lazy(() => import('./pages/Gift'));
const Swap = lazy(() => import('./pages/Swap'));
const History = lazy(() => import('./pages/History'));
const P2P = lazy(() => import('./pages/P2P'));
const Referral = lazy(() => import('./pages/Referral'));
const Rewards = lazy(() => import('./pages/Rewards'));
const Support = lazy(() => import('./pages/Support'));
const Profile = lazy(() => import('./pages/Profile'));
const Onboarding = lazy(() => import('./pages/Onboarding'));

const ROOTS = ['/', '/swap', '/p2p', '/rewards', '/profile'];

function routeFromStartParam(p) {
  if (!p) return null;
  if (p.startsWith('g_')) return `/gift/${p.slice(2)}`;
  if (p.startsWith('tx_')) return `/tx/${p.slice(3)}`;
  if (p.startsWith('p2p_')) return `/p2p/order/${p.slice(4)}`;
  if (p === 'deposit') return '/deposit';
  if (p === 'referral') return '/referral';
  return null;
}

function Router({ path, query }) {
  const m = (pat) => match(pat, path);
  let p;
  if (path === '/') return <Home />;
  if ((p = m('/asset/:id'))) return <Asset id={p.id} />;
  if (path === '/deposit') return <Deposit query={query} />;
  if (path.startsWith('/send')) return <Send path={path} query={query} />;
  if (path === '/withdraw') return <Withdraw query={query} />;
  if (path.startsWith('/gift')) return <Gift path={path} query={query} />;
  if (path === '/swap') return <Swap query={query} />;
  if (path === '/history' || path.startsWith('/tx/') || path.startsWith('/verify/')) return <History path={path} query={query} />;
  if (path.startsWith('/p2p')) return <P2P path={path} query={query} />;
  if (path === '/referral') return <Referral />;
  if (path === '/rewards') return <Rewards />;
  if (path.startsWith('/support')) return <Support path={path} />;
  if (path === '/profile' || path.startsWith('/settings') || path === '/fees' || path === '/notifications') return <Profile path={path} />;
  if (path === '/welcome') return <Onboarding />;
  return <Home />;
}

export default function App() {
  const toast = useToast();
  const { path, query } = useRoute();
  const [lang, setLangState] = useState('en');
  const [dict, setDict] = useState(null);
  const [config, setConfig] = useState(null);
  const [me, setMe] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [fatal, setFatal] = useState(null);
  const t = useMemo(() => makeT(dict || {}), [dict]);

  const switchLang = useCallback(async (code, persist = false) => {
    const d = await loadLang(code);
    setDict(d);
    setLangState(code);
    applyDir(code);
    setLocale(code);
    if (persist) {
      try { localStorage.setItem('aw_lang', code); } catch { /* */ }
      api.patch('/api/me', { lang: code }).catch(() => {});
    }
  }, []);

  const loadWallet = useCallback(async () => {
    try {
      const w = await api.get('/api/wallet');
      setWallet(w);
      setFx(w.fx);
    } catch (e) {
      if (e.code !== 'offline') toast(errText(t, e), 'error');
    }
  }, [t, toast]);

  const refresh = useCallback(async () => {
    const [m] = await Promise.all([api.get('/api/me').catch(() => null), loadWallet()]);
    if (m) setMe(m);
  }, [loadWallet]);

  useEffect(() => {
    (async () => {
      const first = detectLang();
      await switchLang(first);
      splashProgress(30);
      try {
        const cfg = await api.get('/api/config');
        setConfig(cfg);
        applyBrand(cfg.branding);
      } catch { /* shown below */ }
      splashProgress(55);
      if (!inTelegram) return;
      try {
        const res = await api.post('/api/auth');
        splashProgress(80);
        setMe(res.me);
        setFx(null, res.me.settings?.currency || 'USD');
        const l = detectLang(res.me.lang);
        if (l !== first) await switchLang(l);
        await loadWallet();
        hideSplash();
        const deep = routeFromStartParam(res.start_param || startParam);
        if (deep) go(deep, true);
        else if (res.created) go('/welcome', true);
      } catch (e) {
        setFatal(e);
        hideSplash();
      }
    })();
    const onVis = () => { if (document.visibilityState === 'visible') loadWallet(); };
    document.addEventListener('visibilitychange', onVis);
    const id = setInterval(() => { if (document.visibilityState === 'visible') loadWallet(); }, 30000);
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(id); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Telegram back button on every non-root screen
  useEffect(() => {
    const isRoot = ROOTS.includes(path);
    const onBack = () => history.back();
    return backButton(!isRoot, onBack);
  }, [path]);

  // new release → offer a reload
  const [update, setUpdate] = useState(false);
  useEffect(() => {
    const check = () => fetch('/version.json', { cache: 'no-store' }).then((r) => r.json())
      .then((v) => { if (v.v && typeof __BUILD_ID__ !== 'undefined' && v.v !== __BUILD_ID__) setUpdate(true); }).catch(() => {});
    const id = setInterval(check, 120000);
    return () => clearInterval(id);
  }, []);

  const ctx = useMemo(() => ({ config, me, wallet, icons: config?.icons || {}, refresh, loadWallet, toast, setMe, lang }),
    [config, me, wallet, refresh, loadWallet, toast, lang]);
  const i18n = useMemo(() => ({ lang, t, setLang: (c) => switchLang(c, true) }), [lang, t, switchLang]);

  if (!dict) return null; // the splash in index.html is still showing
  if (!inTelegram) { hideSplash(); return <I18n.Provider value={i18n}><AppCtx.Provider value={ctx}><Outside /></AppCtx.Provider></I18n.Provider>; }
  if (fatal) {
    return (
      <I18n.Provider value={i18n}>
        <main className="page center-screen">
          <Icon name={fatal.code === 'account_banned' ? 'lock' : 'wifiOff'} size={44} />
          <p>{errText(t, fatal)}</p>
          <button type="button" className="btn primary" onClick={() => location.reload()}>{t('retry')}</button>
        </main>
      </I18n.Provider>
    );
  }
  if (!me) return null;
  const showNav = ROOTS.includes(path);
  return (
    <I18n.Provider value={i18n}>
      <AppCtx.Provider value={ctx}>
        <ConfirmProvider>
          {config?.maintenance && <div className="banner warn"><Icon name="alert" size={16} />{config.maintenance_msg?.[lang] || config.maintenance_msg?.en || t('maintenance_title')}</div>}
          {update && <button type="button" className="banner ember" onClick={() => location.reload()}><Icon name="refresh" size={16} />{t('update_ready')} · <b>{t('update_now')}</b></button>}
          <div className={`app ${showNav ? 'with-nav' : ''}`}>
            <Suspense fallback={<div className="boot inline"><div className="boot-ring" /></div>}>
              <Router path={path} query={query} />
            </Suspense>
          </div>
          {showNav && <BottomNav path={path} />}
        </ConfirmProvider>
      </AppCtx.Provider>
    </I18n.Provider>
  );
}

export { tg };
