import React, { useEffect, useState } from 'react';
import { api } from '../api';
import Icon from '../components/Icon';
import { Confetti } from '../components/Success';
import { Btn, Pill, RootHead, Skeleton, VipBadge, vipStyle } from '../components/ui';
import { dateShort, fiat } from '../format';
import { errText, useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic } from '../telegram';

export function voucherTitle(t, v) {
  const n = v.uses_left ?? v.uses ?? 1;
  return v.kind === 'fee_free' ? t('voucher_fee_free', { n }) : t('voucher_discount', { pct: v.value, n });
}
export const kindsText = (t, kinds) => (kinds || []).map((k) => t(`kind_${k}`)).join(', ');
const MISSION_ICON = { deposit: 'down', swap: 'swap', referral: 'users', transfer: 'send', p2p: 'p2p', gift: 'gift', withdraw: 'up', earn: 'percent', kyc: 'idCard', phone: 'phone' };
const MISSION_COLOR = { deposit: 'green', swap: 'ember', referral: 'violet', transfer: 'blue', p2p: 'teal', gift: 'pink', withdraw: 'indigo', earn: 'gold', kyc: 'blue', phone: 'teal' };

/** Rewards: daily streak, VIP tier, missions with progress, vouchers and invites — every card readable in day and night mode. */
export default function Rewards() {
  const { t } = useI18n();
  const { toast } = useApp();
  const [r, setR] = useState(() => api.cached('/api/rewards') || null);
  const [fees, setFees] = useState(() => api.cached('/api/fees') || null);
  const [ref, setRef] = useState(() => api.cached('/api/referral') || null);
  const [party, setParty] = useState(0);
  const load = () => api.get('/api/rewards').then(setR).catch(() => {});
  useEffect(() => {
    load();
    api.get('/api/fees', { silent: true }).then(setFees).catch(() => {});
    api.get('/api/referral', { silent: true }).then(setRef).catch(() => {});
  }, []);
  const checkin = async () => {
    try {
      const x = await api.post('/api/rewards/checkin');
      haptic.success();
      setParty((n) => n + 1);
      if (x.rewarded) toast(t('streak_reward'), 'ok');
      load();
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  const claim = async (id) => {
    try { await api.post(`/api/rewards/missions/${id}/claim`); haptic.success(); setParty((n) => n + 1); load(); } catch (e) { toast(errText(t, e), 'error'); }
  };
  const vip = fees?.vip;
  const missions = r ? [...r.missions].sort((a, b) => (a.claimed - b.claimed) || (b.completed - a.completed)) : [];
  const ready = missions.filter((m) => m.completed && !m.claimed).length;
  return (
    <main className="page stagger">
      {party > 0 && <Confetti key={party} />}
      <RootHead title={t('rewards_title')} right={vip && <VipBadge level={vip.level} name={`VIP ${vip.name}`} onClick={() => go('/fees')} />} />
      {!r ? <><Skeleton h={200} r={26} /><Skeleton h={110} r={22} /><Skeleton h={260} r={22} /></> : (
        <>
          {r.checkin.enabled && <Streak ck={r.checkin} onCheckin={checkin} t={t} />}

          {vip && (
            <button type="button" className="tier-card mini" style={{ background: vipStyle(vip.level).bg, color: vipStyle(vip.level).fg }} onClick={() => go('/fees')}>
              <div className="row between">
                <span className="row g10"><span className="tier-crown"><Icon name="crown" size={19} stroke={2.2} /></span>
                  <span className="col" style={{ alignItems: 'flex-start' }}><b style={{ fontSize: 17, fontWeight: 800 }}>VIP {vip.name}</b>
                    <small style={{ fontSize: 12.5, fontWeight: 600, opacity: .8 }}>{t('vip_discount', { pct: vip.discount_pct })}</small></span></span>
                <Icon name="chev" size={18} className="flip-rtl" />
              </div>
              {vip.next && (
                <div className="col g6" style={{ marginTop: 14 }}>
                  <div className="tier-prog"><i style={{ width: `${Math.max(3, Math.min(100, (Number(vip.volume_30d) / Number(vip.next.min_volume_usd)) * 100))}%` }} /></div>
                  <small style={{ fontSize: 12.5, fontWeight: 600, opacity: .85, textAlign: 'start' }}>{t('vip_progress', { amount: fiat(Number(vip.next.min_volume_usd) - Number(vip.volume_30d), 0), tier: vip.next.name })}</small>
                </div>
              )}
            </button>
          )}

          {r.first_tx?.enabled && !r.first_tx.done && (
            <div className="card row g12 bonus-card">
              <span className="sq-ic gold" style={{ width: 44, height: 44, borderRadius: 14 }}><Icon name="sparkle" size={22} /></span>
              <span className="grow"><b style={{ fontSize: 15.5, fontWeight: 700 }}>{t('first_tx_bonus')}</b>
                <small className="dim" style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{voucherTitle(t, r.first_tx.reward)} · {kindsText(t, r.first_tx.reward?.kinds)}</small></span>
            </div>
          )}

          <div className="h2"><span>{t('missions')}</span>{ready > 0 && <Pill tone="g">{t('n_ready', { n: ready })}</Pill>}</div>
          <div className="list">
            {missions.map((m) => {
              const pct = Math.min(100, (m.progress / m.target) * 100);
              return (
                <div key={m.id} className={`li mission ${m.claimed ? 'claimed' : ''}`}>
                  <span className={`sq-ic ${m.claimed ? 'gray' : MISSION_COLOR[m.event] || 'ember'}`} style={{ width: 40, height: 40, borderRadius: 12 }}>
                    <Icon name={m.claimed ? 'check' : MISSION_ICON[m.event] || 'target'} size={19} stroke={2.2} /></span>
                  <span className="grow">
                    <b style={{ fontSize: 15 }}>{m.title}</b>
                    <small className="row g4" style={{ fontWeight: 600 }}><Icon name="gift" size={13} className="em" />{voucherTitle(t, m.reward)}</small>
                    {!m.claimed && <div className="prog" style={{ marginTop: 8, height: 6 }}><i style={{ width: `${Math.max(pct, 2)}%` }} /></div>}
                  </span>
                  {m.claimed ? <Pill tone="n" icon="check">{t('claimed')}</Pill>
                    : m.completed ? <Btn size="xs" className="claim-btn" onClick={() => claim(m.id)}>{t('claim')}</Btn>
                      : <span className="mission-n" dir="ltr">{m.progress}<small>/{m.target}</small></span>}
                </div>
              );
            })}
          </div>

          <div className="h2"><span>{t('my_vouchers')}</span>{r.vouchers.length > 0 && <span className="dim" style={{ fontSize: 13, textTransform: 'none' }}>{r.vouchers.length}</span>}</div>
          {r.vouchers.length === 0 ? (
            <div className="card row g12"><span className="sq-ic gray" style={{ width: 40, height: 40, borderRadius: 12 }}><Icon name="ticket" size={19} /></span>
              <span className="grow dim" style={{ fontSize: 14, fontWeight: 500 }}>{t('no_vouchers')}</span></div>
          ) : (
            <div className="vouchers">
              {r.vouchers.map((v) => (
                <div key={v.id} className="ticket">
                  <span className="ticket-l"><Icon name="ticket" size={20} stroke={2.2} /></span>
                  <span className="ticket-r"><b>{voucherTitle(t, v)}</b>
                    <small>{kindsText(t, v.kinds) || t('all')}{v.expires_at ? ` · ${t('until_x', { date: dateShort(v.expires_at) })}` : ''}</small></span>
                </div>
              ))}
            </div>
          )}

          <button type="button" className="promo-card invite-card" onClick={() => go('/referral')}
            style={{ background: 'linear-gradient(120deg,#22C58B 0%,#0E9F6E 60%,#087A55 100%)', color: '#fff' }}>
            <span className="promo-txt"><b>{t('story_invite', { pct: ref?.pct || 30 })}</b>
              <small>{ref ? t('friends_earned', { n: ref.friends, amount: fiat(ref.earned_usd) }) : t('story_invite_sub')}</small>
              <span className="promo-cta">{t('invite_friends')}<Icon name="chev" size={14} className="flip-rtl" /></span></span>
            <span className="promo-art"><span className="promo-ring" /><span className="promo-ic"><Icon name="users" size={26} /></span></span>
          </button>
        </>
      )}
    </main>
  );
}

function Streak({ ck, onCheckin, t }) {
  const pos = ck.streak % ck.every;
  const filled = ck.today ? (pos || ck.every) : pos;
  return (
    <div className="streak-card">
      <div className="row between" style={{ position: 'relative', zIndex: 1 }}>
        <span className="col">
          <small style={{ fontSize: 13, fontWeight: 650, opacity: .8 }}>{t('daily_checkin')}</small>
          <b style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>{t('streak_days', { n: ck.streak })}</b>
        </span>
        <span className="flame"><Icon name="flame" size={30} stroke={2.2} /></span>
      </div>
      <div className="streak-days">
        {Array.from({ length: ck.every }, (_, i) => {
          const on = i < filled;
          const last = i === ck.every - 1;
          return (
            <span key={i} className={`sd ${on ? 'on' : ''} ${on && i === filled - 1 && ck.today ? 'now' : ''}`}>
              {last ? '🎁' : on ? <Icon name="check" size={15} stroke={3} /> : i + 1}
            </span>
          );
        })}
      </div>
      <button type="button" className="streak-btn" disabled={ck.today} onClick={onCheckin}>
        {ck.today ? <><Icon name="checkCircle" size={18} />{t('checked_in_back_tomorrow')}</> : <><Icon name="flame" size={18} />{t('checkin_plus_day')}</>}
      </button>
      <small style={{ display: 'block', textAlign: 'center', fontSize: 12.5, fontWeight: 600, opacity: .8, position: 'relative', zIndex: 1 }}>{t('streak_info', { n: ck.every })}</small>
    </div>
  );
}
