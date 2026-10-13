import React, { useEffect, useState } from 'react';
import { api } from '../api';
import Icon from '../components/Icon';
import { celebrate } from '../components/Success';
import { useToast } from '../components/Toast';
import { Avatar, Btn, Card, CopyField, Page, Skeleton } from '../components/ui';
import { fiat, timeAgo } from '../format';
import { errText, useI18n } from '../i18n';
import { useApp } from '../store';
import { haptic, shareUrl } from '../telegram';

export default function Referral() {
  const { t } = useI18n();
  const { loadWallet } = useApp();
  const toast = useToast();
  const [r, setR] = useState(null);
  const [board, setBoard] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/api/referral').then(setR).catch(() => {});
  useEffect(() => { load(); api.get('/api/referral/leaderboard').then((x) => setBoard(x.items)).catch(() => {}); }, []);
  if (!r) return <Page title={t('referral_title')}><Skeleton h={320} r={20} /></Page>;
  const tiers = [...(r.tiers || [])].sort((a, b) => a.min_friends - b.min_friends);
  const next = tiers.find((x) => x.min_friends > r.active);
  const claim = async () => {
    setBusy(true);
    try { await api.post('/api/referral/claim'); celebrate(); haptic.success(); load(); loadWallet(); } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Page title={t('referral_title')}>
      <section className="ref-hero">
        <div className="ref-pct">{r.pct}%</div>
        <h2>{t('referral_hero', { pct: r.pct })}</h2>
        <p>{t('referral_hero_sub', { days: r.duration_days, asset: r.payout_asset })}</p>
        {Number(r.level2_pct) > 0 && <small className="dim">{t('level2_note', { pct: r.level2_pct })}</small>}
      </section>
      <CopyField label={t('your_link')} value={r.link} />
      <Btn className="wide" onClick={() => shareUrl(r.link, t('invite_text'))}><Icon name="share" size={18} />{t('invite_friends')}</Btn>
      <div className="stat-grid">
        <div><b>{r.friends}</b><small>{t('friends')}</small></div>
        <div><b>{r.active}</b><small>{t('active_friends')}</small></div>
        <div><b dir="ltr">{fiat(r.earned_usd)}</b><small>{t('earned')}</small></div>
        <div className="claimable"><b dir="ltr">{fiat(r.pending_usd)}</b><small>{t('pending_reward')}</small>
          <Btn kind="soft" loading={busy} disabled={Number(r.pending_usd) < Number(r.min_claim_usd)} onClick={claim}>{t('claim')}</Btn></div>
      </div>
      {tiers.length > 1 && (
        <Card className="tiers">
          <b>{t('tiers_title')}</b>
          {tiers.map((x) => (
            <div key={x.min_friends} className={`tier ${Number(r.pct) === Number(x.level1_pct) ? 'on' : ''}`}><span>{t('tier_row', { n: x.min_friends })}</span><b>{x.level1_pct}%</b></div>
          ))}
          {next && <div className="progress"><span style={{ width: `${Math.min(100, (r.active / next.min_friends) * 100)}%` }} /><small>{r.active}/{next.min_friends} → {next.level1_pct}%</small></div>}
        </Card>
      )}
      <h2 className="h2">{t('how_it_works')}</h2>
      <ol className="steps">
        <li><span>1</span>{t('ref_step1')}</li>
        <li><span>2</span>{t('ref_step2', { uses: r.referee_bonus?.uses || 1 })}</li>
        <li><span>3</span>{t('ref_step3')}</li>
      </ol>
      {r.recent?.length > 0 && (
        <>
          <h2 className="h2">{t('friends')}</h2>
          {r.recent.map((f, i) => (
            <div key={i} className="friend-row"><Avatar src={f.photo} name={f.name} size={34} /><span className="ar-main"><b>{f.name}</b><small>{timeAgo(f.joined, t)}</small></span><b className="up" dir="ltr">+{fiat(f.earned_usd)}</b></div>
          ))}
        </>
      )}
      {board.length > 0 && (
        <>
          <h2 className="h2">{t('leaderboard')}</h2>
          {board.map((b, i) => (
            <div key={i} className="friend-row"><span className="rank">{i + 1}</span><Avatar src={b.photo} name={b.name} size={30} /><span className="ar-main"><b>{b.name}</b><small>{b.friends} {t('friends').toLowerCase()}</small></span><b dir="ltr">{fiat(b.earned_usd)}</b></div>
          ))}
        </>
      )}
    </Page>
  );
}
