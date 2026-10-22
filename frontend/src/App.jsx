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
import { applyPrices, streamPrices } from './live';
import { getToken, setToken } from './session';
import TopBar, { PageLoading } from './components/TopBar';
import { Btn, Countdown, Sheet, mmss } from './components/ui';
import { backButton, inTelegram, startParam, tg } from './telegram';
import Home from './pages/Home';
import Outside from './pages/Outside';

const Asset = lazy(() => import('./pages/Asset'));
const Deposit = lazy(() => import('./pages/Deposit'));
const Send = lazy(() => import('./pages/Send'));
const Withdraw = lazy(() => import('./pages/Withdraw'));
const Gift = lazy(() => import('./pages/Gift'));
const Trade = lazy(() => import('./pages/Trade'));
const AutoInvest = lazy(() => import('./pages/Trade').then((m) => ({ default: m.AutoInvest })));
const Pay = lazy(() => import('./pages/Pay'));
const History = lazy(() => import('./pages/History'));
const P2P = lazy(() => import('./pages/P2P'));
const Referral = lazy(() => import('./pages/Referral'));
const Rewards = lazy(() => import('./pages/Rewards'));
const Support = lazy(() => import('./pages/Support'));
const Profile = lazy(() => import('./pages/Profile'));
const Onboarding = lazy(() => import('./pages/Onboarding'));

const ROOTS = ['/', '/trade', '/pay', '/swap', '/p2p', '/rewards', '/profile'];

function routeFromStartParam(p) {
  if (!p) return null;
  if (p.startsWith('g_')) return `/gift/${p.slice(2)}`;
  if (p.startsWith('tx_')) return `/tx/${p.slice(3)}`;
  if (p.startsWith('p2p_')) return `/p2p/order/${p.slice(4)}`;
  if (p.startsWith('r_')) return `/request/${p.slice(2)}`;
  if (p.startsWith('u_')) return `/send/user?to=${encodeURIComponent(p.slice(2))}`;
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
  if (path === '/swap') return <Trade tab="swap" query={query} />;
  if (path === '/trade') return <Trade tab="markets" query={query} />;
  if (path === '/p2p') return <Trade tab="p2p" query={query} />;
  if (path === '/autoinvest') return <AutoInvest query={query} />;
  if (path === '/pay' || path.startsWith('/request') || path.startsWith('/split')) return <Pay path={path} query={query} />;
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

  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false);
  const loadWallet = useCallback(async () => {
    try {
      const w = await api.get('/api/wallet', { silent: true });
      setWallet(w);
      setFx(w.fx);
      setOffline(false);
      try { localStorage.setItem('zw_wallet', JSON.stringify({ ...w, cached_at: Date.now() })); } catch { /* quota */ }
    } catch (e) {
      if (e.code === 'offline') {
        setOffline(true);
        setWallet((cur) => cur || (() => { try { const c = JSON.parse(localStorage.getItem('zw_wallet') || 'null'); return c ? { ...c, cached: true } : null; } catch { return null; } })());
      } else toast(errText(t, e), 'error');
    }
  }, [t, toast]);
  useEffect(() => {
    const on = () => { setOffline(false); loadWallet(); };
    const off = () => setOffline(true);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    const id = setInterval(() => { if (offline) loadWallet(); }, 5000);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(id); };
  }, [offline, loadWallet]);

  const refresh = useCallback(async () => {
    const [m] = await Promise.all([api.get('/api/me').catch(() => null), loadWallet()]);
    if (m) setMe(m);
  }, [loadWallet]);

  // standalone apps (web / Android / desktop): a bearer session instead of Telegram initData
  const [signIn, setSignIn] = useState(!inTelegram && !getToken());
  const bootStandalone = useCallback(async (first) => {
    try {
      const m = await api.get('/api/me');
      setMe(m);
      setFx(null, m.settings?.currency || 'USD');
      const l = detectLang(m.lang);
      if (first && l !== first) await switchLang(l);
      setSignIn(false);
      await loadWallet();
    } catch (e) {
      if (e.status === 401 || e.status === 403) { setToken(''); setSignIn(true); } else setFatal(e);
    }
    hideSplash();
  }, [loadWallet, switchLang]);
  useEffect(() => {
    const out = () => { setToken(''); setMe(null); setWallet(null); setSignIn(true); };
    window.addEventListener('aw:signed-out', out);
    return () => window.removeEventListener('aw:signed-out', out);
  }, []);

  useEffect(() => {
    (async () => {
      const first = detectLang();
      await switchLang(first);
      splashProgress(30, makeT(await loadLang(first))('splash_connecting'));
      try {
        const cfg = await api.get('/api/config');
        setConfig(cfg);
        applyBrand(cfg.branding);
      } catch { /* shown below */ }
      splashProgress(55);
      if (!inTelegram) {
        if (getToken()) await bootStandalone(first);
        else hideSplash();
        return;
      }
      try {
        const res = await api.post('/api/auth');
        splashProgress(80, t('splash_wallet'));
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
    const stop = streamPrices((snap) => setWallet((w) => applyPrices(w, snap)));
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(id); stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // a limit was reached that identity verification raises → offer it once per session screen
  const [kycOffer, setKycOffer] = useState(false);
  useEffect(() => {
    const on = () => setKycOffer(true);
    window.addEventListener('aw:kyc-offer', on);
    return () => window.removeEventListener('aw:kyc-offer', on);
  }, []);

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

  const ctx = useMemo(() => ({ config, me, wallet, icons: config?.icons || {}, refresh, loadWallet, toast, setMe, lang, offline }),
    [config, me, wallet, refresh, loadWallet, toast, lang, offline]);
  const i18n = useMemo(() => ({ lang, t, setLang: (c) => switchLang(c, true) }), [lang, t, switchLang]);

  if (!dict) return null; // the splash in index.html is still showing
  if (!inTelegram && (signIn || path === '/signin')) {
    hideSplash();
    return <I18n.Provider value={i18n}><AppCtx.Provider value={ctx}><Outside onSignedIn={() => { go('/', true); bootStandalone(lang); }} /></AppCtx.Provider></I18n.Provider>;
  }
  if (fatal) {
    return (
      <I18n.Provider value={i18n}>
        <main className="state-screen">
          <div className="bgglow" />
          <span className="ic xl"><Icon name={fatal.code === 'account_banned' ? 'lock' : 'wifiOff'} size={42} stroke={1.6} /></span>
          <span className="h" style={{ fontSize: 22 }}>{t(fatal.code === 'account_banned' ? 'err_account_banned' : 'offline_title')}</span>
          <span className="dim">{errText(t, fatal)}</span>
          <Btn icon="refresh" onClick={() => location.reload()}>{t('retry')}</Btn>
        </main>
      </I18n.Provider>
    );
  }
  if (!me) return null;
  if (config?.maintenance && !me.is_admin) return <I18n.Provider value={i18n}><Maintenance config={config} lang={lang} t={t} /></I18n.Provider>;
  const showNav = ROOTS.includes(path);
  return (
    <I18n.Provider value={i18n}>
      <AppCtx.Provider value={ctx}>
        <ConfirmProvider>
          <TopBar />
          {offline && <div className="banner off"><Icon name="wifiOff" size={16} />{t('offline_reconnecting')}<span className="grow" /><Icon name="refresh" size={15} /></div>}
          {config?.maintenance && me.is_admin && <div className="banner em"><Icon name="tool" size={16} />{t('maintenance_admin')}</div>}
          {update && <button type="button" className="banner em" onClick={() => location.reload()}><Icon name="refresh" size={16} />{t('update_ready')} · <b>{t('update_now')}</b></button>}
          <div className={`app ${showNav ? 'with-nav' : ''}`}>
            <Suspense fallback={<PageLoading />}>
              <Router path={path} query={query} />
            </Suspense>
          </div>
          {showNav && <BottomNav path={path} />}
          <Sheet open={kycOffer && path !== '/settings/kyc'} onClose={() => setKycOffer(false)}>
            <div className="col center g8" style={{ textAlign: 'center', padding: '6px 6px 4px' }}>
              <span className="ic lg"><Icon name="idCard" size={30} /></span>
              <b className="disp" style={{ fontSize: 20 }}>{t('kyc_offer_title')}</b>
              <span className="dim">{t('kyc_offer_sub')}</span>
            </div>
            <Btn w onClick={() => { setKycOffer(false); go('/settings/kyc'); }}>{t('kyc_start')}</Btn>
            <Btn kind="ghost" w onClick={() => setKycOffer(false)}>{t('not_now')}</Btn>
          </Sheet>
        </ConfirmProvider>
      </AppCtx.Provider>
    </I18n.Provider>
  );
}

/** Maintenance (design sheet 01.7): friendly, funds-safe, countdown when an estimate is set. */
function Maintenance({ config, lang, t }) {
  const until = Number(config.maintenance_until || 0);
  const start = Number(sessionStorage.getItem('zw_mt0') || (sessionStorage.setItem('zw_mt0', String(Date.now() / 1000)), Date.now() / 1000));
  return (
    <main className="state-screen">
      <div className="bgglow" />
      <span className="ic xl"><Icon name="tool" size={42} stroke={1.6} /></span>
      <span className="h" style={{ fontSize: 24 }}>{t('maintenance_title')}</span>
      <span className="dim" style={{ fontSize: 14.5 }}>{config.maintenance_msg?.[lang] || config.maintenance_msg?.en || t('maintenance_sub')}</span>
      {until > Date.now() / 1000 && (
        <div className="card s2" style={{ width: '100%', marginTop: 6 }}>
          <Countdown until={until} onEnd={() => location.reload()} render={(left) => (
            <>
              <div className="row between" style={{ fontSize: 14 }}><span className="dim">{t('back_in_about')}</span><b className="disp em" style={{ fontSize: 22 }}>{mmss(left)}</b></div>
              <div className="prog" style={{ marginTop: 10 }}><i style={{ width: `${Math.max(4, Math.min(100, 100 - (left / Math.max(1, until - start)) * 100))}%` }} /></div>
            </>
          )} />
        </div>
      )}
      {config.channel_url && <a className="note" href={config.channel_url}><Icon name="mega" size={15} />{t('maintenance_channel')}</a>}
    </main>
  );
}

export { tg };
