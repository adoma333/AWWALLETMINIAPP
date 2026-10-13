import React, { useEffect, useState } from 'react';
import { api } from '../api';
import Icon from '../components/Icon';
import { celebrate } from '../components/Success';
import { useToast } from '../components/Toast';
import { Btn, Card, Empty, Skeleton } from '../components/ui';
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

export default function Rewards() {
  const { t } = useI18n();
  const { me } = useApp();
  const toast = useToast();
  const [r, setR] = useState(null);
  const [fees, setFees] = useState(null);
  const load = () => api.get('/api/rewards').then(setR).catch(() => {});
  useEffect(() => { load(); api.get('/api/fees').then(setFees).catch(() => {}); }, []);
  const checkin = async () => {
    try {
      const x = await api.post('/api/rewards/checkin');
      haptic.success();
      if (x.rewarded) celebrate();
      load();
    } catch (e) { toast(errText(t, e), 'error'); }
  };
  const claim = async (id) => {
    try { await api.post(`/api/rewards/missions/${id}/claim`); celebrate(); load(); } catch (e) { toast(errText(t, e), 'error'); }
  };
  if (!r) return <main className="page"><h1 className="page-title">{t('rewards_title')}</h1><Skeleton h={300} r={20} /></main>;
  const vip = fees?.vip;
  const ck = r.checkin;
  const streakPos = ck.streak % ck.every;
  return (
    <main className="page rewards">
      <h1 className="page-title">{t('rewards_title')}</h1>
      {vip && (
        <Card className="vip-card" onClick={() => go('/fees')}>
          <div className="vip-top"><Icon name="crown" /><b>{t('vip_level', { name: vip.name })}</b><span className="mini-badge ok">{t('vip_discount', { pct: vip.discount_pct })}</span></div>
          {vip.next && (
            <>
              <div className="progress"><span style={{ width: `${Math.min(100, (Number(vip.volume_30d) / Number(vip.next.min_volume_usd)) * 100)}%` }} /></div>
              <small className="dim">{t('vip_progress', { amount: fiat(Number(vip.next.min_volume_usd) - Number(vip.volume_30d)), tier: vip.next.name })}</small>
            </>
          )}
        </Card>
      )}
      {ck.enabled && (
        <Card className="checkin">
          <div className="ck-top"><b>{t('daily_checkin')}</b><span className="streak"><Icon name="fire" size={16} />{t('streak_days', { n: ck.streak })}</span></div>
          <div className="ck-days">{Array.from({ length: ck.every }).map((_, i) => <span key={i} className={i < (ck.today ? streakPos || ck.every : streakPos) ? 'on' : ''}>{i === ck.every - 1 ? <Icon name="gift" size={14} /> : i + 1}</span>)}</div>
          <small className="dim">{t('streak_info', { n: ck.every })}</small>
          <Btn className="wide" disabled={ck.today} onClick={checkin}>{ck.today ? t('checked_in') : t('checkin_now')}</Btn>
        </Card>
      )}
      {r.first_tx?.enabled && !r.first_tx.done && (
        <Card className="nudge"><span className="nudge-ic"><Icon name="sparkle" /></span><span className="nudge-text"><b>{t('first_tx_bonus')}</b><small>{voucherTitle(t, r.first_tx.reward)} · {kindsText(t, r.first_tx.reward?.kinds)}</small></span></Card>
      )}
      <h2 className="h2">{t('missions')}</h2>
      {r.missions.map((m) => (
        <Card key={m.id} className={`mission ${m.claimed ? 'done' : ''}`}>
          <div className="ms-top"><b>{m.title}</b>{m.claimed ? <span className="mini-badge ok">{t('claimed')}</span>
            : m.completed ? <Btn kind="soft" onClick={() => claim(m.id)}>{t('claim_reward')}</Btn> : <small>{m.progress}/{m.target}</small>}</div>
          <div className="progress"><span style={{ width: `${(m.progress / m.target) * 100}%` }} /></div>
          <small className="dim">🎁 {voucherTitle(t, m.reward)} · {kindsText(t, m.reward?.kinds)}</small>
        </Card>
      ))}
      <h2 className="h2">{t('my_vouchers')}</h2>
      {r.vouchers.length === 0 && <Empty icon="gift" title={t('no_vouchers')} />}
      <div className="vouchers">
        {r.vouchers.map((v) => (
          <div key={v.id} className="voucher"><b>{voucherTitle(t, v)}</b><small>{t('voucher_for', { kinds: kindsText(t, v.kinds) || t('all') })}</small>
            {v.expires_at && <small className="dim">{t('expires_on', { date: dateShort(v.expires_at) })}</small>}</div>
        ))}
      </div>
      {me && <Btn kind="ghost" className="wide" onClick={() => go('/referral')}><Icon name="users" size={18} />{t('invite_friends')}</Btn>}
    </main>
  );
}
