import React from 'react';
import { useApp } from '../store';
import arb from '../assets/coins/arb.svg';
import avax from '../assets/coins/avax.svg';
import base from '../assets/coins/base.svg';
import bnb from '../assets/coins/bnb.svg';
import btc from '../assets/coins/btc.svg';
import cake from '../assets/coins/cake.svg';
import dai from '../assets/coins/dai.svg';
import doge from '../assets/coins/doge.svg';
import dogs from '../assets/coins/dogs.svg';
import eth from '../assets/coins/eth.svg';
import fdusd from '../assets/coins/fdusd.svg';
import link from '../assets/coins/link.svg';
import notc from '../assets/coins/not.svg';
import pepe from '../assets/coins/pepe.svg';
import pol from '../assets/coins/pol.svg';
import shib from '../assets/coins/shib.svg';
import sol from '../assets/coins/sol.svg';
import ton from '../assets/coins/ton.svg';
import trx from '../assets/coins/trx.svg';
import uni from '../assets/coins/uni.svg';
import usdc from '../assets/coins/usdc.svg';
import usdt from '../assets/coins/usdt.svg';
import xrp from '../assets/coins/xrp.svg';

// Line icons (24×24, stroke 1.8) shared by every screen. Admins can replace any of them (key ui:<name>).
const PATHS = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h5v-6h4v6h5V9.5" /></>,
  analytics: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>,
  referral: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><path d="M17 8v6" /><path d="M14 11h6" /></>,
  rewards: <><rect x="3.5" y="8" width="17" height="5" rx="1" /><path d="M5 13v7h14v-7" /><path d="M12 8v12" /><path d="M12 8c-1.5-3.5-5.5-3.5-5.5-1 0 1.5 2.5 1 5.5 1Z" /><path d="M12 8c1.5-3.5 5.5-3.5 5.5-1 0 1.5-2.5 1-5.5 1Z" /></>,
  plans: <><path d="M6 3h12l3 5-9 13L3 8Z" /><path d="M3 8h18" /><path d="M9 3 7.5 8 12 21l4.5-13L15 3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />,
  share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.4" /><path d="m8.2 13.2 7.6 4.4" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  download: <><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M4 20h16" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7Z" />,
  headset: <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="13.5" width="4" height="6.5" rx="1.6" /><rect x="17" y="13.5" width="4" height="6.5" rx="1.6" /><path d="M19 20a3.5 3.5 0 0 1-3.5 2H13" /></>,
  bell: <><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  chart: <><path d="M3 20h18" /><path d="m4 15 5-5 4 3 7-7" /><path d="M15 6h5v5" /></>,
  shield: <><path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6Z" /><path d="m9 12 2 2 4-4" /></>,
  cloud: <path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.5 4.3 4.3 0 0 0 7 18Z" />,
  trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0Z" /><path d="M8 6H5a3 3 0 0 0 3 4" /><path d="M16 6h3a3 3 0 0 1-3 4" /><path d="M12 13v4" /><path d="M8.5 20h7" /></>,
  gift: <><rect x="3.5" y="8" width="17" height="5" rx="1" /><path d="M5 13v7h14v-7" /><path d="M12 8v12" /><path d="M12 8c-1.5-3.5-5.5-3.5-5.5-1 0 1.5 2.5 1 5.5 1Z" /><path d="M12 8c1.5-3.5 5.5-3.5 5.5-1 0 1.5-2.5 1-5.5 1Z" /></>,
  wallet: <><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2h10" /><path d="M16 13.5h.01" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
  alert: <><path d="M12 3 2 20h20Z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>,
  wifiOff: <><path d="M2 8.8a15 15 0 0 1 4.2-2.6" /><path d="M10.7 5.1A15 15 0 0 1 22 8.8" /><path d="M5 12.6a10 10 0 0 1 5.2-2.5" /><path d="M16.8 11.1a10 10 0 0 1 2.2 1.5" /><path d="M8.5 16.4a5 5 0 0 1 7 0" /><path d="M12 20h.01" /><path d="m3 3 18 18" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  sound: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" /><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
  soundOff: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" /><path d="m16 9.5 5 5" /><path d="m21 9.5-5 5" /></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="m20.5 16-5-5-8.5 8.5" /></>,
  send: <><path d="M4 12 20 4l-4 16-4-6.5Z" /><path d="m12 13.5 8-9.5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M9.9 5.7A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4" /><path d="M6.3 7.3C3.9 9 2.5 12 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 4.4-1.1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="m3 3 18 18" /></>,
  rocket: <><path d="M12 15c-1.5-1.5-3-4-3-7 0-3 3-5.5 3-5.5s3 2.5 3 5.5c0 3-1.5 5.5-3 7Z" /><circle cx="12" cy="8" r="1.4" /><path d="M9.3 12.5 6 14.5l1 3.5 3-2M14.7 12.5l3.3 2-1 3.5-3-2" /><path d="M11 19.5 12 22l1-2.5" /></>,
  diamond: <><path d="M6 3h12l3 5-9 13L3 8Z" /><path d="M3 8h18" /></>,
  crown: <><path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 11H5Z" /><path d="M5 21h14" /></>,
  fire: <path d="M12 22c4 0 7-2.8 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2.5-2-4-3 2.5-5 6-5 8 0 4.2 3 7 7 7Z" />,
  heart: <path d="M12 20.5s-8-4.7-8-10.2A4.6 4.6 0 0 1 12 7.5a4.6 4.6 0 0 1 8 2.8c0 5.5-8 10.2-8 10.2Z" />,
  chat: <><path d="M4 5h16v11H9l-5 4Z" /><path d="M8 10h8M8 13h5" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
  coin: <><ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7" /><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></>,
  percent: <><path d="M19 5 5 19" /><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="17" r="2.5" /></>,
  sparkle: <><path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7Z" /><path d="M19 16.5c.2 1.4.9 2.1 2.3 2.3-1.4.2-2.1.9-2.3 2.3-.2-1.4-.9-2.1-2.3-2.3 1.4-.2 2.1-.9 2.3-2.3Z" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
  question: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4M12 16.8h.01" /></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5" /></>,
  calc: <><rect x="5" y="2.5" width="14" height="19" rx="2" /><path d="M8 6.5h8v3H8Z" /><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" /></>,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" /><path d="M3.5 4v4h4" /><path d="M12 8v4l3 2" /></>,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.8 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.3 17 3 12 3Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>,
  phone: <><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></>,
  qr: <><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="14" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="3.5" y="14" width="6.5" height="6.5" rx="1" /><path d="M14 14h2.5v2.5H14ZM18 18h2.5v2.5H18ZM14 18.5v2M18.5 14h2" /></>,
  telegram: <path d="M21 4 3 11.2l6 2.3 2.3 6.5 3.4-4.3 4.8 3.6Zm-11.4 9.4 9-7.2" />,
  key: <><circle cx="8" cy="15" r="4.5" /><path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2" /></>,
  lifebuoy: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" /><path d="m6 6 3.5 3.5M14.5 14.5 18 18M18 6l-3.5 3.5M9.5 14.5 6 18" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h12l-2 4 2 4H5" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></>,
  trend: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  link: <><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4L12 18.4" /></>,
  power: <><path d="M12 3v9" /><path d="M6.3 7.3a8 8 0 1 0 11.4 0" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  card: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M7 15h3" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>,
  megaphone: <><path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1Z" /><path d="M17 9a4 4 0 0 1 0 6" /></>,

  arrowDown: <><path d="M12 4v15" /><path d="m6 13 6 6 6-6" /></>,
  arrowUp: <><path d="M12 20V5" /><path d="m6 11 6-6 6 6" /></>,
  arrowRight: <><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></>,
  swap: <><path d="M7 4 3.5 7.5 7 11" /><path d="M3.5 7.5H17a3.5 3.5 0 0 1 3.5 3.5" /><path d="M17 20l3.5-3.5L17 13" /><path d="M20.5 16.5H7A3.5 3.5 0 0 1 3.5 13" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  minus: <path d="M5 12h14" />,
  scan: <><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" /><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" /><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" /><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><path d="M4 12h16" /></>,
  contacts: <><rect x="4" y="3" width="15" height="18" rx="2" /><circle cx="11.5" cy="10" r="2.6" /><path d="M7.5 16.5c.6-2 2.1-3 4-3s3.4 1 4 3" /><path d="M19 7h1.5M19 12h1.5M19 17h1.5" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19.5c.6-3.3 2.9-5.2 6-5.2s5.4 1.9 6 5.2" /><path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2" /><path d="M17.5 14.6c1.8.6 3 2.3 3.5 4.9" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  chevronDown: <path d="m5 9 7 7 7-7" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  filter: <><path d="M4 5h16l-6 7.5V19l-4 1.5v-8Z" /></>,
  paste: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 10h6M9 14h4" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M19 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5H10" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  handshake: <><path d="m3 11 4-4 5 2 3-2 6 4" /><path d="m21 11-4 5-4-1-2 2-3-1-5-5" /><path d="m9 15 2-2M12 16l2-2" /></>,
  bank: <><path d="M3 9.5 12 4l9 5.5" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20.5h18" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4M12 16.8h.01" /></>,
  fingerprint: <><path d="M6.5 8.5A6.5 6.5 0 0 1 18.5 12v1" /><path d="M5 13v-1a7 7 0 0 1 .4-2.3" /><path d="M9 20c1-1.8 1.5-4 1.5-6.5a1.5 1.5 0 0 1 3 0c0 1.2-.1 2.4-.4 3.5" /><path d="M12 21c.6-1 1-2 1.3-3.2" /><path d="M8.2 11.3A4 4 0 0 1 16 12.5c0 2.6-.4 5-1.4 7" /><path d="M6.5 17.5c.8-1.3 1.3-3 1.4-4.8" /></>,
  trash: <><path d="M4 7h16" /><path d="M9.5 7V4.5h5V7" /><path d="M6.5 7l1 13h9l1-13" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></>,
  more: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
  logout: <><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" /><path d="M10 8l-4 4 4 4" /><path d="M6 12h10" /></>,
  attach: <path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7" />,
  coins: <><circle cx="9" cy="9" r="5.5" /><path d="M14.5 6.5a5.5 5.5 0 1 1-8 8" /></>,
  zap: <path d="M13 2 4 14h7l-1 8 9-12h-7Z" />,
};

export default function Icon({ name, size = 22, className = '', style }) {
  const { icons } = useApp();
  const custom = icons?.[`ui:${name}`];
  if (custom) return <img className={`ic ic-img ${className}`} src={custom} width={size} height={size} alt="" style={style} />;
  return (
    <svg className={`ic ${className}`} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {PATHS[name] || PATHS.coin}
    </svg>
  );
}

const COINS = { USDT: usdt, USDC: usdc, BTC: btc, ETH: eth, TON: ton, BNB: bnb, SOL: sol, TRX: trx, POL: pol, AVAX: avax, ARB: arb, DAI: dai,
  FDUSD: fdusd, DOGE: doge, XRP: xrp, LINK: link, UNI: uni, CAKE: cake, SHIB: shib, PEPE: pepe, NOT: notc, DOGS: dogs };
const NETS = { tron: trx, ton, bsc: bnb, eth, sol, polygon: pol, arbitrum: arb, base, btc, avax };

function Fallback({ label, size, color }) {
  return (
    <span className="coin-fallback" style={{ width: size, height: size, background: color || 'var(--surface-3)', fontSize: size * 0.36 }}>
      {String(label || '?').slice(0, 3)}
    </span>
  );
}

export function CoinIcon({ asset, size = 36, network }) {
  const { icons } = useApp();
  const src = icons?.[`asset:${asset}`] || COINS[asset];
  return (
    <span className="coin" style={{ width: size, height: size }}>
      {src ? <img src={src} width={size} height={size} alt={asset} loading="lazy" /> : <Fallback label={asset} size={size} />}
      {network && <NetIcon network={network} size={Math.round(size * 0.42)} className="coin-net" />}
    </span>
  );
}

export function NetIcon({ network, size = 22, className = '' }) {
  const { icons } = useApp();
  const src = icons?.[`net:${network}`] || NETS[network];
  return src
    ? <img className={`net-ic ${className}`} src={src} width={size} height={size} alt={network} loading="lazy" />
    : <Fallback label={network} size={size} />;
}
