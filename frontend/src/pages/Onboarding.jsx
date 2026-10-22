import React, { useState } from 'react';
import { ZMark } from '../components/Logo';
import Icon from '../components/Icon';
import { NetIcon } from '../components/Icon';
import { Avatar } from '../components/ui';
import { useI18n } from '../i18n';
import { go } from '../router';
import { useApp } from '../store';
import { haptic } from '../telegram';

const NETS = ['tron', 'ton', 'bsc', 'eth', 'sol', 'polygon', 'arbitrum', 'base', 'btc', 'avax'];

// Three short value slides (no forms): identity is already known from Telegram.
export default function Onboarding() {
  const { t } = useI18n();
  const { me } = useApp();
  const [i, setI] = useState(0);
  const slides = [
    { title: t('ob1_title'), sub: t('ob1_sub'), art: <div className="ob-nets">{NETS.map((n, k) => <span key={n} style={{ '--k': k }}><NetIcon network={n} size={38} /></span>)}</div> },
    { title: t('ob2_title'), sub: t('ob2_sub'), art: <div className="ob-art"><Icon name="send" size={64} /></div> },
    { title: t('ob3_title'), sub: t('ob3_sub'), art: <div className="ob-art"><Icon name="shield" size={64} /></div> },
  ];
  const s = slides[i];
  const next = () => { haptic.tap(); if (i < slides.length - 1) setI(i + 1); else go('/', true); };
  return (
    <main className="onboarding">
      <div className="ob-who">
        <ZMark size={36} />
        <Avatar src={me?.photo} name={me?.name} size={44} />
        <b>{t('welcome_title', { name: me?.first_name || me?.name || '' })}</b>
      </div>
      <div className="ob-slide" key={i}>
        {s.art}
        <h1>{s.title}</h1>
        <p>{s.sub}</p>
      </div>
      <div className="ob-dots">{slides.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
      <div className="ob-actions">
        <button type="button" className="btn primary wide" onClick={next}>{i < slides.length - 1 ? t('next') : t('get_started')}</button>
        {i < slides.length - 1 && <button type="button" className="btn ghost" onClick={() => go('/', true)}>{t('skip')}</button>}
      </div>
    </main>
  );
}
