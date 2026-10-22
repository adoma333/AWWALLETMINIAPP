import React, { useMemo, useState } from 'react';
import Icon, { CoinIcon } from '../components/Icon';
import { Avatar, HeadBtn, Li, Pill, Sheet, Skeleton, SkeletonList, Spark, Switch } from '../components/ui';
import { amt, fiat, pct, timeAgo } from '../format';
import { useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic, scanQr } from '../telegram';
import { parseScan } from '../util';
import { api } from '../api';

function useHidden() {
  const [h, setH] = useState(() => { try { return localStorage.getItem('aw_hide') === '1'; } catch { return false; } });
  return [h, () => { const v = !h; setH(v); haptic.select(); try { localStorage.setItem('aw_hide', v ? '1' : '0'); } catch { /* */ } }];
}

/** $37,972.00 with the cents dimmed, like the design sheet. */
export function Money({ usd, hidden, size }) {
  if (hidden) return <span className="big" style={size ? { fontSize: size } : undefined}>•••••</span>;
  const s = fiat(usd);
  const m = s.match(/^(.*?)([.,]\d{2})(\D*)$/);
  return (
    <span className="big" dir="ltr" style={size ? { fontSize: size } : undefined}>
      {m ? <>{m[1]}<span className="cents">{m[2]}</span>{m[3]}</> : s}
    </span>
  );
}

const STORY_BG = ['linear-gradient(135deg,#2a1606,#4a2205)', 'linear-gradient(135deg,#0b2a1e,#0f3d2b)', 'linear-gradient(135deg,#2b0b16,#45102a)',
  'linear-gradient(135deg,#0b1a2e,#0f2d4a)'];

/** Design sheet 02.1 — Home: balance, four actions, stories, assets with mini charts. Skeleton (01.5) and offline (01.8) states included. */
export default function Home() {
  const { t, lang } = useI18n();
  const { me, wallet, config, offline, setMe } = useApp();
  const [hidden, toggleHidden] = useHidden();
  const [manage, setManage] = useState(false);
  const f = config?.features || {};
  const st = me?.settings || {};
  const hideSmall = st.hide_small ?? false;
  const shown = st.home_assets || null; // admin of their own home list: null = automatic

  const assets = useMemo(() => {
    const list = [...(wallet?.assets || [])];
    list.sort((a, b) => Number(b.value_usd) - Number(a.value_usd) || (a.sort ?? 0) - (b.sort ?? 0));
    return list.filter((a) => (shown ? shown.includes(a.id) : (Number(a.value_usd) > 0 || ['USDT', 'TON', 'BTC', 'ETH'].includes(a.id)))
      && (!hideSmall || Number(a.value_usd) >= 1 || Number(a.available) === 0 && !shown));
  }, [wallet, hideSmall, shown]);
  const total = Number(wallet?.total_usd || 0);
  const change = Number(wallet?.change24h_usd || 0);
  const changePct = total - change > 0 ? (change / (total - change)) * 100 : 0;

  const saveSettings = async (patch) => {
    const next = { ...st, ...patch };
    setMe({ ...me, settings: next });
    api.patch('/api/me', { settings: patch }).catch(() => {});
  };
  const scan = async () => {
    const raw = await scanQr(t('scan'));
    const r = parseScan(raw);
    if (!r) return;
    if (r.route) go(r.route);
    else go(`/withdraw?address=${encodeURIComponent(r.address)}${r.network ? `&network=${r.network}` : ''}${r.memo ? `&memo=${encodeURIComponent(r.memo)}` : ''}`);
  };

  const actions = [
    { k: 'deposit', icon: 'down', label: t('action_deposit'), to: '/deposit', on: f.deposit !== false, main: true },
    { k: 'send', icon: 'send', label: t('action_send'), to: '/send', on: f.transfer !== false || f.withdraw !== false },
    { k: 'swap', icon: 'swap', label: t('action_swap'), to: '/swap', on: f.swap !== false },
    f.p2p !== false ? { k: 'buy', icon: 'p2p', label: t('action_buy'), to: '/p2p?side=buy', on: true } : { k: 'withdraw', icon: 'up', label: t('action_withdraw'), to: '/withdraw', on: true },
  ].filter((a) => a.on);

  const stories = [
    ...(config?.banners || []).map((b) => ({ key: `b${b.id}`, icon: b.icon || 'sparkle', title: b.title?.[lang] || b.title?.en, sub: b.body?.[lang] || b.body?.en,
      to: b.link, image: b.image })),
    config?.earn_top && f.earn !== false && { key: 'earn', icon: 'percent', title: t('story_earn', { pct: config.earn_top.apy, asset: config.earn_top.asset }), sub: t('story_earn_sub'), to: '/earn' },
    f.referral !== false && { key: 'ref', icon: 'users', title: t('story_invite', { pct: config?.referral_pct || 30 }), sub: t('story_invite_sub'), to: '/referral' },
    f.gifts !== false && { key: 'gift', icon: 'gift', title: t('story_gift'), sub: t('story_gift_sub'), to: '/gift' },
    me?.kyc_level < 2 && f.kyc !== false && { key: 'kyc', icon: 'idCard', title: t('story_kyc'), sub: t('story_kyc_sub'), to: '/settings/kyc' },
  ].filter(Boolean);

  return (
    <main className="page">
      <header className="row between" style={{ paddingTop: 6 }}>
        <button type="button" className="row grow" style={{ textAlign: 'start' }} onClick={() => go('/profile')}>
          <Avatar src={me.photo} name={me.first_name || me.name} size={38} />
          <span className="col" style={{ minWidth: 0 }}>
            <b className="ellipsis" style={{ fontSize: 15 }}>{me.first_name || me.name}</b>
            {me.vip?.level > 0 ? <span className="badge-z"><Icon name="crown" size={11} stroke={2.4} /> VIP {String(me.vip.name).toUpperCase()}</span>
              : <span className="dim xs" dir="ltr">{me.username ? `@${me.username}` : t(`kyc_level_${me.kyc_level}`)}</span>}
          </span>
        </button>
        <div className="row g6">
          <HeadBtn icon="scan" onClick={scan} label={t('scan')} />
          <HeadBtn icon="bell" onClick={() => go('/notifications')} label={t('notifications')} dot={me.unread > 0} />
        </div>
      </header>

      {config?.announcement && (config.announcement.text?.[lang] || config.announcement.text?.en) && (
        <div className="warn"><Icon name="mega" size={17} /><span>{config.announcement.text[lang] || config.announcement.text.en}</span></div>
      )}

      <section className="balance">
        <div className="glow-bg" />
        <button type="button" className="row dim g6" style={{ fontSize: 14 }} onClick={toggleHidden}>
          {wallet?.cached ? t('total_cached', { time: timeAgo((wallet.cached_at || 0) / 1000, t) }) : t('total_balance')} <Icon name={hidden ? 'eyeOff' : 'eye'} size={15} />
        </button>
        {wallet ? <Money usd={total} hidden={hidden} /> : <Skeleton w={220} h={44} r={14} />}
        {wallet ? (
          !hidden && total > 0 && <Pill tone={change >= 0 ? 'g' : 'r'} className="lg" dir="ltr">{change >= 0 ? '▲' : '▼'} {fiat(Math.abs(change))} · {pct(changePct)} {t('today')}</Pill>
        ) : <Skeleton w={130} h={22} r={999} />}
      </section>

      <div className="acts" style={offline ? { opacity: 0.55 } : undefined}>
        {actions.map((a) => (
          <button key={a.k} type="button" className={`act ${a.main ? 'm' : ''}`} onClick={() => { haptic.tap(); go(a.to); }}>
            <span className="o"><Icon name={a.icon} size={24} stroke={2.2} /></span>{a.label}
          </button>
        ))}
      </div>

      {!me.pin_set && (
        <button type="button" className="card row g12" style={{ background: 'linear-gradient(135deg,rgba(255,138,0,.14),transparent 70%),var(--s1)' }} onClick={() => go('/security/pin?next=/')}>
          <span className="ic"><Icon name="shield" size={20} /></span>
          <span className="grow"><b style={{ fontSize: 14.5 }}>{t('security_card_title')}</b><small className="dim" style={{ display: 'block', fontSize: 12.5 }}>{t('security_card_sub')}</small></span>
          <span className="chev"><Icon name="chev" size={18} /></span>
        </button>
      )}

      {stories.length > 0 && (
        <div className="stories">
          {stories.map((s, i) => (
            <button key={s.key} type="button" className="story" onClick={() => s.to && go(s.to)}
              style={{ background: s.image ? `center/cover url(${s.image})` : STORY_BG[i % STORY_BG.length] }}>
              <Icon name={s.icon} size={20} /><span><b>{s.title}</b><small>{s.sub}</small></span>
            </button>
          ))}
        </div>
      )}

      <div className="h2"><span>{t('assets')}</span><button type="button" onClick={() => setManage(true)}><Icon name="sliders" size={13} />{t('manage')}</button></div>
      {!wallet ? <SkeletonList rows={5} /> : (
        <div className="list" style={offline ? { opacity: 0.55 } : undefined}>
          {assets.map((a) => {
            const ch = Number(a.change24h);
            const bal = Number(a.available) + Number(a.locked);
            return (
              <button key={a.id} type="button" className="li" onClick={() => go(`/asset/${a.id}`)}>
                <CoinIcon asset={a.id} size={40} />
                <span className="grow"><b>{a.id}</b><small>{a.name} <span className={ch >= 0 ? 'ok' : 'bad'} dir="ltr">{pct(ch)}</span></small></span>
                <Spark points={a.spark} w={54} h={24} up={ch >= 0} />
                <span className="r" style={{ minWidth: 86 }} dir="ltr">
                  <b>{hidden ? '•••' : amt(bal, a.display)}</b><small>{hidden ? '•••' : fiat(a.value_usd)}</small>
                </span>
              </button>
            );
          })}
          {assets.length === 0 && <Li icon="plus" title={t('add_coins')} onClick={() => setManage(true)} chev />}
        </div>
      )}
      {wallet && total === 0 && (
        <div className="card glow col center g8" style={{ textAlign: 'center', padding: 20 }}>
          <b className="disp" style={{ fontSize: 18 }}>{t('empty_wallet_title')}</b>
          <span className="dim small">{t('empty_wallet_sub')}</span>
          <div className="row g8" style={{ marginTop: 6 }}>
            <button type="button" className="btn p sm" onClick={() => go('/deposit')}>{t('action_deposit')}</button>
            {f.p2p !== false && <button type="button" className="btn s sm" onClick={() => go('/p2p?side=buy')}>{t('action_buy')} · P2P</button>}
          </div>
        </div>
      )}
      {offline && <div className="toast" style={{ position: 'fixed', bottom: 'calc(104px + var(--safe-b))', left: 16, right: 16, width: 'auto', margin: '0 auto' }}>
        <Icon name="shieldok" size={18} className="ok" /><span>{t('offline_safe')}</span></div>}

      <Sheet open={manage} onClose={() => setManage(false)} title={t('manage_assets')} tall>
        <div className="list"><Li icon="eyeOff" tone="n" title={t('hide_small')} sub={t('hide_small_sub')} className="sm" right={<Switch on={hideSmall} onChange={(v) => saveSettings({ hide_small: v })} />} /></div>
        <div className="h2"><span>{t('shown_on_home')}</span>{shown && <button type="button" onClick={() => saveSettings({ home_assets: null })}>{t('automatic')}</button>}</div>
        <div className="list">
          {(wallet?.assets || []).map((a) => {
            const on = shown ? shown.includes(a.id) : assets.some((x) => x.id === a.id);
            return <Li key={a.id} coin={a.id} title={a.id} sub={a.name} className="sm" right={<Switch on={on} onChange={(v) => {
              const base = shown || assets.map((x) => x.id);
              saveSettings({ home_assets: v ? [...new Set([...base, a.id])] : base.filter((x) => x !== a.id) });
            }} />} />;
          })}
        </div>
      </Sheet>
    </main>
  );
}
