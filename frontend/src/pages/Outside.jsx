import React from 'react';
import logo from '../assets/logo-wordmark.png';
import Icon from '../components/Icon';
import { QR } from '../components/ui';
import { LANGS, useI18n } from '../i18n';
import { useApp } from '../store';

// Opened in a normal browser: AW Wallet only works inside Telegram → QR code + deep link (like AW ROBOT).
export default function Outside() {
  const { t, lang, setLang } = useI18n();
  const { config } = useApp();
  const bot = config?.bot;
  const link = bot ? `https://t.me/${bot}?startapp=web` : 'https://t.me';
  return (
    <main className="outside">
      <div className="outside-top">
        <img src={logo} alt="AW WALLET" className="logo-wordmark" />
        <select className="lang-select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="language">
          {LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      </div>
      <section className="outside-body">
        <span className="pill"><Icon name="telegram" size={16} /> Telegram Mini App</span>
        <h1>{t('outside_title')}</h1>
        <p className="sub">{t('outside_sub')}</p>
        <div className="outside-qr">
          <QR value={link} size={208} logo={<Icon name="telegram" size={26} />} />
          <small>{t('scan_with_phone')}</small>
        </div>
        <a className="btn primary wide" href={link} rel="noopener">{t('open_in_telegram')}</a>
        <p className="mono dim">{link.replace('https://', '')}</p>
        <ul className="perks">
          <li><Icon name="globe" size={18} />{t('perk1')}</li>
          <li><Icon name="bolt" size={18} />{t('perk2')}</li>
          <li><Icon name="shield" size={18} />{t('perk3')}</li>
        </ul>
      </section>
    </main>
  );
}
