import React, { useEffect, useState } from 'react';
import { api } from '../api';
import Icon from '../components/Icon';
import { Confetti } from '../components/Success';
import { Btn, Empty, Li, Pill, RootHead, Skeleton } from '../components/ui';
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
const MISSION_ICON = { deposit: 'down', swap: 'swap', referral: 'users', transfer: 'send', p2p: 'p2p', gift: 'gift', withdraw: 'up', earn: 'percent', kyc: 'idCard' };

/** Design sheet 04.8 — Rewards: VIP badge, daily streak, missions with progress, vouchers, invite card. */
export default function Rewards() {
  const { t } = useI18n();
  const { toast } = useApp();
  const [r, setR] = useState(null);
  const [fees, setFees] = useState(null);
  const [ref, setRef] = useState(null);
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
      if (x.rewarded) setParty((n) => n + 1);
      load();
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  const claim = async (id) => {
    try { await api.post(`/api/rewards/missions/${id}/claim`); haptic.success(); setParty((n) => n + 1); load(); } catch (e) { toast(errText(t, e), 'error'); }
  };
  const vip = fees?.vip;
  return (
    <main className="page">
      {party > 0 && <Confetti key={party} />}
      <RootHead title={t('rewards_title')} right={vip && <button type="button" onClick={() => go('/fees')}><Pill tone="y" icon="crown">VIP {vip.name}</Pill></button>} />
      {!r ? <><Skeleton h={170} r={22} /><Skeleton h={220} r={22} /></> : (
        <>
          {r.checkin.enabled && <Streak ck={r.checkin} onCheckin={checkin} t={t} />}
          {vip?.next && (
            <button type="button" className="card col g8" onClick={() => go('/fees')}>
              <div className="row between" style={{ fontSize: 13.5 }}><b className="row g6"><Icon name="crown" size={16} className="gold" />{t('vip_next', { tier: vip.next.name })}</b>
                <span className="dim">{t('vip_discount', { pct: vip.discount_pct })}</span></div>
              <div className="prog"><i style={{ width: `${Math.min(100, (Number(vip.volume_30d) / Number(vip.next.min_volume_usd)) * 100)}%` }} /></div>
              <small className="dim" style={{ fontSize: 12.5 }}>{t('vip_progress', { amount: fiat(Number(vip.next.min_volume_usd) - Number(vip.volume_30d)), tier: vip.next.name })}</small>
            </button>
          )}
          {r.first_tx?.enabled && !r.first_tx.done && (
            <div className="card row g12" style={{ background: 'linear-gradient(135deg,rgba(255,138,0,.14),transparent 70%),var(--s1)' }}>
              <span className="ic"><Icon name="sparkle" size={19} /></span>
              <span className="grow"><b style={{ fontSize: 14.5 }}>{t('first_tx_bonus')}</b><small className="dim" style={{ display: 'block', fontSize: 12.5 }}>{voucherTitle(t, r.first_tx.reward)} · {kindsText(t, r.first_tx.reward?.kinds)}</small></span>
            </div>
          )}
          <div className="h2"><span>{t('missions')}</span></div>
          <div className="list">
            {r.missions.map((m) => (
              <div key={m.id} className="li" style={m.claimed ? { opacity: 0.55 } : undefined}>
                <span className={`ic ${m.claimed ? 'g' : ''}`}><Icon name={m.claimed ? 'check' : MISSION_ICON[m.event] || 'target'} size={18} /></span>
                <span className="grow"><b style={{ fontSize: 14 }}>{m.title}</b>
                  <small>🎁 {voucherTitle(t, m.reward)}</small>
                  {!m.claimed && <div className="prog" style={{ marginTop: 7, height: 5 }}><i style={{ width: `${Math.min(100, (m.progress / m.target) * 100)}%` }} /></div>}</span>
                {m.claimed ? <Pill tone="g">{t('claimed')}</Pill> : m.completed ? <Btn size="sm" onClick={() => claim(m.id)}>{t('claim')}</Btn>
                  : <span className="dim" style={{ fontSize: 13 }} dir="ltr">{m.progress}/{m.target}</span>}
              </div>
            ))}
          </div>
          <div className="h2"><span>{t('my_vouchers')}</span></div>
          {r.vouchers.length === 0 ? <div className="note"><Icon name="ticket" size={15} /><span>{t('no_vouchers')}</span></div> : (
            <div className="row g8 wrap">
              {r.vouchers.map((v) => (
                <div key={v.id} className="voucher" style={{ minWidth: 150 }}><b>{voucherTitle(t, v)}</b>
                  <small style={{ display: 'block' }}>{kindsText(t, v.kinds) || t('all')}{v.expires_at ? ` · ${t('until_x', { date: dateShort(v.expires_at) })}` : ''}</small></div>
              ))}
            </div>
          )}
          <button type="button" className="card glow row g12" onClick={() => go('/referral')}>
            <span className="ic"><Icon name="users" size={19} /></span>
            <span className="grow"><b style={{ fontSize: 14.5 }}>{t('story_invite', { pct: ref?.pct || 30 })}</b>
              <small className="dim" style={{ display: 'block', fontSize: 12.5 }}>{ref ? t('friends_earned', { n: ref.friends, amount: fiat(ref.earned_usd) }) : t('story_invite_sub')}</small></span>
            <span className="chev"><Icon name="chev" size={18} /></span>
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
    <div className="card col g12">
      <div className="row between"><b style={{ fontSize: 15 }}>{t('daily_checkin')}</b>
        <span className="em row g4" style={{ fontWeight: 600, fontSize: 14 }}><Icon name="flame" size={16} />{t('streak_days', { n: ck.streak })}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ck.every},1fr)`, gap: 6 }}>
        {Array.from({ length: ck.every }, (_, i) => {
          const on = i < filled;
          const last = i === ck.every - 1;
          return (
            <span key={i} style={{ aspectRatio: '1', borderRadius: '50%', display: 'grid', placeItems: 'center', font: '600 13px var(--f-body)',
              background: on ? 'var(--grad)' : 'var(--s2)', color: on ? 'var(--on-ember)' : 'var(--ash)', transition: 'background .4s', animation: on && i === filled - 1 && ck.today ? 'spop .45s both' : undefined }}>
              {last ? '🎁' : on ? <Icon name="check" size={14} stroke={3} /> : i + 1}
            </span>
          );
        })}
      </div>
      <Btn w disabled={ck.today} onClick={onCheckin} style={{ height: 46 }}>{ck.today ? t('checked_in_back_tomorrow') : t('checkin_plus_day')}</Btn>
      <small className="dim center" style={{ fontSize: 12 }}>{t('streak_info', { n: ck.every })}</small>
    </div>
  );
}
