import React, { useEffect, useState } from 'react';
import { api } from '../api';
import Icon from '../components/Icon';
import { Confetti } from '../components/Success';
import { Avatar, Btn, Li, Page, Skeleton, useCopy } from '../components/ui';
import { fiat, timeAgo } from '../format';
import { errText, useI18n } from '../i18n';
import { useApp } from '../store';
import { haptic, shareUrl } from '../telegram';

/** Design sheet 04.7 — invite friends: lifetime share, link, stats, claim, next tier, leaderboard. */
export default function Referral() {
  const { t } = useI18n();
  const { loadWallet, toast } = useApp();
  const [r, setR] = useState(() => api.cached('/api/referral') || null);
  const [board, setBoard] = useState([]);
  const [busy, setBusy] = useState(false);
  const [party, setParty] = useState(false);
  const [ok, copy] = useCopy();
  const load = () => api.get('/api/referral').then(setR).catch(() => {});
  useEffect(() => { load(); api.get('/api/referral/leaderboard', { silent: true }).then((x) => setBoard(x.items)).catch(() => {}); }, []);
  if (!r) return <Page title={t('invite_friends')}><Skeleton h={180} r={22} /><Skeleton h={120} r={22} /></Page>;
  const tiers = [...(r.tiers || [])].sort((a, b) => a.min_friends - b.min_friends);
  const next = tiers.find((x) => x.min_friends > r.active);
  const canClaim = Number(r.pending_usd) >= Number(r.min_claim_usd) && Number(r.pending_usd) > 0;
  const claim = async () => {
    setBusy(true);
    try { await api.post('/api/referral/claim'); haptic.success(); setParty(true); load(); loadWallet(); } catch (e) { toast(errText(t, e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Page title={t('invite_friends')} bar={<Btn w icon="share" onClick={() => shareUrl(r.link, t('invite_text'))}>{t('invite_friends')}</Btn>}>
      {party && <Confetti />}
      <div className="card glow col center g4" style={{ padding: '20px 16px', textAlign: 'center' }}>
        <span className="disp" style={{ fontSize: 60, lineHeight: 1, background: 'var(--grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{r.pct}%</span>
        <b className="disp" style={{ fontSize: 18, fontWeight: 600 }}>{t('of_every_fee')}</b>
        <span className="dim" style={{ fontSize: 13 }}>{t('for_x_days', { days: r.duration_days })}{Number(r.level2_pct) > 0 && ` · ${t('plus_level2', { pct: r.level2_pct })}`}</span>
      </div>
      <button type="button" className="card row g8 pad12" onClick={() => copy(r.link)}>
        <span className="mono grow ellipsis" style={{ fontSize: 13 }} dir="ltr">{r.link.replace(/^https?:\/\//, '')}</span>
        <span className={`btn f sm ${ok ? 'ok' : ''}`} style={{ height: 34 }}><Icon name={ok ? 'check' : 'copy'} size={15} /></span>
      </button>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {[[r.friends, t('friends')], [r.active, t('active_friends')], [fiat(r.earned_usd), t('earned')]].map(([v, l]) => (
          <div key={l} className="card col center g4" style={{ padding: '12px 6px' }}><b className="disp" style={{ fontSize: 20 }} dir="ltr">{v}</b><small className="dim" style={{ fontSize: 12 }}>{l}</small></div>
        ))}
      </div>
      <div className="card row" style={{ background: 'var(--fill)' }}>
        <span className="grow"><small className="dim" style={{ fontSize: 12.5 }}>{t('ready_to_claim')}</small><b className="disp" style={{ display: 'block', fontSize: 20 }} dir="ltr">{fiat(r.pending_usd)} <small className="dim" style={{ fontSize: 13 }}>{r.payout_asset}</small></b></span>
        <Btn size="sm" loading={busy} disabled={!canClaim} onClick={claim}>{t('claim')}</Btn>
      </div>
      {next && (
        <div className="card col g8">
          <div className="row between" style={{ fontSize: 13.5 }}><b>{t('next_tier', { pct: next.level1_pct })}</b><span className="dim" dir="ltr">{r.active} / {next.min_friends} {t('active_short')}</span></div>
          <div className="prog"><i style={{ width: `${Math.min(100, (r.active / next.min_friends) * 100)}%` }} /></div>
        </div>
      )}
      <div className="h2"><span>{t('how_it_works')}</span></div>
      <div className="list">
        {[['share', t('ref_step1')], ['gift', t('ref_step2', { uses: r.referee_bonus?.uses || 1 })], ['coins', t('ref_step3')]].map(([i, s], k) => (
          <div key={k} className="li sm"><span className="ic"><Icon name={i} size={18} /></span><span className="grow" style={{ fontSize: 14, lineHeight: 1.45 }}>{s}</span></div>
        ))}
      </div>
      {r.recent?.length > 0 && (
        <>
          <div className="h2"><span>{t('friends')}</span></div>
          <div className="list">
            {r.recent.map((f, i) => <Li key={i} av={<Avatar src={f.photo} name={f.name} size={38} seed={f.name} />} title={f.name} sub={timeAgo(f.joined, t)}
              right={<b className="ok" dir="ltr">+{fiat(f.earned_usd)}</b>} />)}
          </div>
        </>
      )}
      {board.length > 0 && (
        <>
          <div className="h2"><span>{t('leaderboard')}</span></div>
          <div className="list">
            {board.map((b, i) => <Li key={i} lead={<b className={`disp ${i < 3 ? 'gold' : 'dim'}`} style={{ width: 22, textAlign: 'center' }}>{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</b>}
              av={<Avatar src={b.photo} name={b.name} size={34} seed={b.name} />} title={b.name} sub={t('n_friends', { n: b.friends })} right={<b dir="ltr">{fiat(b.earned_usd)}</b>} />)}
          </div>
        </>
      )}
    </Page>
  );
}
