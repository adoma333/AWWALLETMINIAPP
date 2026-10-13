import React, { useMemo, useState } from 'react';
import logo from '../assets/logo-wordmark.png';
import { useConfirm } from '../components/Confirm';
import Icon, { CoinIcon } from '../components/Icon';
import { Avatar, Badge, Card, Skeleton } from '../components/ui';
import { amt, fiat, pct, priceFmt } from '../format';
import { useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic, scanQr } from '../telegram';
import { parseScan } from '../util';

function useHidden() {
  const [h, setH] = useState(() => { try { return localStorage.getItem('aw_hide') === '1'; } catch { return false; } });
  return [h, () => { const v = !h; setH(v); haptic.select(); try { localStorage.setItem('aw_hide', v ? '1' : '0'); } catch { /* */ } }];
}

export default function Home() {
  const { t, lang } = useI18n();
  const { me, wallet, config } = useApp();
  const ask = useConfirm();
  const [hidden, toggleHidden] = useHidden();
  const [hideSmall, setHideSmall] = useState(() => { try { return localStorage.getItem('aw_hide_small') === '1'; } catch { return false; } });
  const f = config?.features || {};

  const assets = useMemo(() => {
    const list = [...(wallet?.assets || [])];
    list.sort((a, b) => Number(b.value_usd) - Number(a.value_usd) || 0);
    return list.filter((a) => !hideSmall || Number(a.value_usd) >= 1 || ['USDT', 'TON', 'BTC'].includes(a.id));
  }, [wallet, hideSmall]);
  const total = Number(wallet?.total_usd || 0);
  const change = Number(wallet?.change24h_usd || 0);
  const changePct = total - change > 0 ? (change / (total - change)) * 100 : 0;
  const score = (me?.pin_set ? 1 : 0) + (me?.kyc_level >= 1 ? 1 : 0) + (me?.bio_enabled || me?.settings?.whitelist_only ? 1 : 0);

  const scan = async () => {
    const v = await scanQr('AW WALLET');
    const r = parseScan(v);
    if (!r) return;
    haptic.success();
    if (r.route) go(r.route);
    else go(`/withdraw?address=${encodeURIComponent(r.address)}${r.network ? `&network=${r.network}` : ''}${r.family ? `&family=${r.family}` : ''}${r.memo ? `&memo=${encodeURIComponent(r.memo)}` : ''}`);
  };

  const actions = [
    { k: 'deposit', icon: 'arrowDown', label: t('action_deposit'), to: '/deposit', on: f.deposit !== false },
    { k: 'send', icon: 'send', label: t('action_send'), to: '/send', on: f.transfer !== false || f.withdraw !== false },
    { k: 'swap', icon: 'swap', label: t('action_swap'), to: '/swap', on: f.swap !== false },
    { k: 'withdraw', icon: 'arrowUp', label: t('action_withdraw'), to: '/withdraw', on: f.withdraw !== false },
  ];
  const actions2 = [
    { k: 'gift', icon: 'gift', label: t('action_gift'), to: '/gift/new', on: f.gifts !== false },
    { k: 'p2p', icon: 'handshake', label: t('action_p2p'), to: '/p2p', on: f.p2p !== false },
    { k: 'scan', icon: 'scan', label: t('action_scan'), fn: scan, on: true },
    { k: 'history', icon: 'history', label: t('history'), to: '/history', on: true },
  ];

  return (
    <main className="page home">
      <header className="home-top">
        <button type="button" className="me-chip" onClick={() => go('/profile')}>
          <Avatar src={me.photo} name={me.name} size={36} />
          <span className="me-text"><b>{me.first_name || me.name}</b>{me.vip?.level > 0 ? <small className="vip">★ {t('vip_level', { name: me.vip.name })}</small> : <small>@{me.username || me.id}</small>}</span>
        </button>
        <img src={logo} alt="AW WALLET" className="home-logo" />
        <div className="top-icons">
          <button type="button" className="icon-btn" onClick={() => go('/support')} aria-label={t('support')}><Icon name="headset" /></button>
          <button type="button" className="icon-btn" onClick={() => go('/notifications')} aria-label={t('notifications')}>
            <Icon name="bell" />{me.unread > 0 && <span className="dot" />}
          </button>
        </div>
      </header>

      {config?.announcement && (config.announcement.text?.[lang] || config.announcement.text?.en) && (
        <div className={`announce ${config.announcement.level || 'info'}`}><Icon name="megaphone" size={16} />{config.announcement.text[lang] || config.announcement.text.en}</div>
      )}

      <section className="balance-card">
        <div className="bc-glow" />
        <button type="button" className="bc-label" onClick={toggleHidden}>{t('total_balance')} <Icon name={hidden ? 'eyeOff' : 'eye'} size={16} /></button>
        {wallet ? (
          <>
            <div className="bc-total" dir="ltr">{hidden ? '•••••' : fiat(total)}</div>
            <div className={`bc-change ${change >= 0 ? 'up' : 'down'}`} dir="ltr">
              {hidden ? '•••' : `${change >= 0 ? '+' : '−'}${fiat(Math.abs(change)).replace('−', '')} (${pct(changePct)})`} <span>{t('today_change')}</span>
            </div>
          </>
        ) : <><Skeleton h={40} w="60%" /><Skeleton h={14} w="35%" style={{ marginTop: 10 }} /></>}
        <div className="actions">
          {actions.filter((a) => a.on).map((a) => (
            <button key={a.k} type="button" className="act" onClick={() => { haptic.tap(); a.fn ? a.fn() : go(a.to); }}>
              <span className="act-ic"><Icon name={a.icon} size={22} /></span><span>{a.label}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="actions mini">
        {actions2.filter((a) => a.on).map((a) => (
          <button key={a.k} type="button" className="act" onClick={() => { haptic.tap(); a.fn ? a.fn() : go(a.to); }}>
            <span className="act-ic"><Icon name={a.icon} size={20} /></span><span>{a.label}</span>
          </button>
        ))}
      </div>

      {config?.badges?.length > 0 && (
        <div className="trust-row">
          {config.badges.map((b) => <Badge key={b.key} icon={b.icon} tone="soft">{b.text?.[lang] || b.text?.en}</Badge>)}
        </div>
      )}

      {(config?.banners || []).length > 0 && (
        <div className="banners">
          {config.banners.map((b) => (
            <button key={b.id} type="button" className="promo" style={b.image ? { backgroundImage: `url(${b.image})` } : undefined} onClick={() => b.link && go(b.link)}>
              <b>{b.title?.[lang] || b.title?.en}</b><span>{b.body?.[lang] || b.body?.en}</span>
            </button>
          ))}
        </div>
      )}

      {!me.pin_set && (
        <Card className="nudge" onClick={() => ask({ title: t('security_card_title') })}>
          <span className="nudge-ic"><Icon name="shield" /></span>
          <span className="nudge-text"><b>{t('security_card_title')}</b><small>{t('security_card_sub')}</small></span>
          <span className="nudge-cta">{t('protect_now')}</span>
        </Card>
      )}
      {me.pin_set && score < 3 && (
        <Card className="nudge slim" onClick={() => go('/settings/security')}>
          <span className="meter">{[0, 1, 2].map((i) => <i key={i} className={i < score ? 'on' : ''} />)}</span>
          <span className="nudge-text"><b>{t('security_score', { n: score })}</b></span>
          <Icon name="chevron" size={18} className="flip-rtl" />
        </Card>
      )}

      {wallet && total === 0 && (
        <Card className="empty-wallet">
          <b>{t('empty_wallet_title')}</b>
          <p>{t('empty_wallet_sub')}</p>
          <div className="row2">
            <button type="button" className="btn primary" onClick={() => go('/deposit')}>{t('action_deposit')}</button>
            {f.p2p !== false && <button type="button" className="btn soft" onClick={() => go('/p2p')}>{t('buy')} · P2P</button>}
          </div>
        </Card>
      )}

      <div className="section-head">
        <h2>{t('assets')}</h2>
        <label className="mini-check">
          <input type="checkbox" checked={hideSmall} onChange={(e) => { setHideSmall(e.target.checked); try { localStorage.setItem('aw_hide_small', e.target.checked ? '1' : '0'); } catch { /* */ } }} />
          {t('hide_small')}
        </label>
      </div>
      <div className="asset-list">
        {!wallet && [0, 1, 2, 3].map((i) => <Skeleton key={i} h={58} r={16} style={{ marginBottom: 8 }} />)}
        {assets.map((a) => {
          const ch = Number(a.change24h);
          const bal = Number(a.available) + Number(a.locked);
          return (
            <button key={a.id} type="button" className="asset-row" onClick={() => go(`/asset/${a.id}`)}>
              <CoinIcon asset={a.id} size={42} />
              <span className="ar-main">
                <b>{a.id}{a.badges?.map((b) => <span key={b} className="mini-badge">{b}</span>)}</b>
                <small dir="ltr">{priceFmt(a.usd)} <i className={ch >= 0 ? 'up' : 'down'}>{pct(ch)}</i></small>
              </span>
              <span className="ar-right" dir="ltr">
                <b>{hidden ? '•••' : amt(bal, a.display)}</b>
                <small>{hidden ? '•••' : fiat(a.value_usd)}</small>
              </span>
            </button>
          );
        })}
      </div>

      {f.referral !== false && (
        <Card className="invite" onClick={() => go('/referral')}>
          <span className="invite-ic"><Icon name="users" size={26} /></span>
          <span className="nudge-text"><b>{t('invite_banner_title')}</b><small>{t('invite_banner_sub', { pct: 30 })}</small></span>
          <Icon name="chevron" size={18} className="flip-rtl" />
        </Card>
      )}
    </main>
  );
}
