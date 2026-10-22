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
import cro from '../assets/coins/cro.svg';
import cronos from '../assets/coins/cronos.svg';
import gnosis from '../assets/coins/gnosis.svg';
import linea from '../assets/coins/linea.svg';
import mantle from '../assets/coins/mantle.svg';
import mnt from '../assets/coins/mnt.svg';
import op from '../assets/coins/op.svg';
import optimism from '../assets/coins/optimism.svg';
import scroll from '../assets/coins/scroll.svg';
import sonic from '../assets/coins/sonic.svg';
import unichain from '../assets/coins/unichain.svg';

import {
  AddressBook, Camera, Car, IdentificationCard, SealCheck, UserFocus, ArrowClockwise, ArrowDown, ArrowRight, ArrowSquareOut, ArrowUp, ArrowsLeftRight, Bank, Bell, BookOpen, Calculator, CalendarBlank,
  CaretDown, CaretRight, ChartBar, ChartLineUp, ChatCircleText, Check, ClipboardText, ClockCountdown, ClockCounterClockwise, Cloud, Coin, Coins,
  Copy, CreditCard, Crown, DeviceMobile, Diamond, DotsThree, DownloadSimple, Export, Eye, EyeSlash, Fingerprint, Fire, Flag, Funnel, GearSix, Gift,
  Globe, Handshake, Headset, Heart, House, Image, Info, Key, Lifebuoy, Lightning, Link, List, LockSimple, MagnifyingGlass, Megaphone, Minus, Moon,
  Palette, Paperclip, PaperPlaneTilt, PencilSimple, Percent, Plus, Power, QrCode, Question, Receipt, Rocket, Scan, ShieldCheck, SignOut, Sparkle,
  SpeakerHigh, SpeakerSlash, SquaresFour, Stack, Star, Sun, Target, TelegramLogo, Trash, TrendUp, Trophy, User, UserPlus, Users, Wallet, Warning,
  WifiSlash, X,
} from '@phosphor-icons/react';

// One professional icon family (Phosphor) for every screen: same grid, same optical weight.
// Lists use "regular", primary actions "bold"; any icon can still be replaced by an admin upload (key ui:<name>).
const ICONS = {
  home: House, analytics: ChartBar, referral: UserPlus, rewards: Gift, plans: Diamond, settings: GearSix, star: Star, share: Export, copy: Copy,
  download: DownloadSimple, bolt: Lightning, zap: Lightning, headset: Headset, bell: Bell, chart: ChartLineUp, shield: ShieldCheck, cloud: Cloud,
  trophy: Trophy, gift: Gift, wallet: Wallet, globe: Globe, check: Check, close: X, alert: Warning, wifiOff: WifiSlash, refresh: ArrowClockwise,
  sound: SpeakerHigh, soundOff: SpeakerSlash, image: Image, send: PaperPlaneTilt, sun: Sun, moon: Moon, eye: Eye, eyeOff: EyeSlash, rocket: Rocket,
  diamond: Diamond, crown: Crown, fire: Fire, heart: Heart, chat: ChatCircleText, calendar: CalendarBlank, clock: ClockCountdown, target: Target,
  coin: Coin, coins: Coins, percent: Percent, sparkle: Sparkle, info: Info, question: Question, help: Question, book: BookOpen, calc: Calculator,
  history: ClockCounterClockwise, grid: SquaresFour, layers: Stack, palette: Palette, phone: DeviceMobile, qr: QrCode, telegram: TelegramLogo,
  key: Key, lifebuoy: Lifebuoy, flag: Flag, list: List, trend: TrendUp, link: Link, power: Power, lock: LockSimple, card: CreditCard, user: User,
  megaphone: Megaphone, arrowDown: ArrowDown, arrowUp: ArrowUp, arrowRight: ArrowRight, swap: ArrowsLeftRight, plus: Plus, minus: Minus,
  scan: Scan, idCard: IdentificationCard, camera: Camera, face: UserFocus, car: Car, verified: SealCheck, contacts: AddressBook, users: Users, chevron: CaretRight, chevronDown: CaretDown, search: MagnifyingGlass, filter: Funnel,
  paste: ClipboardText, external: ArrowSquareOut, receipt: Receipt, handshake: Handshake, bank: Bank, fingerprint: Fingerprint, trash: Trash,
  edit: PencilSimple, more: DotsThree, logout: SignOut, attach: Paperclip,
};

export default function Icon({ name, size = 22, className = '', style, weight = 'regular' }) {
  const { icons } = useApp();
  const custom = icons?.[`ui:${name}`];
  if (custom) return <img className={`ic ic-img ${className}`} src={custom} width={size} height={size} alt="" style={style} />;
  const C = ICONS[name] || Coin;
  return <C className={`ic ${className}`} size={size} weight={weight} style={style} aria-hidden="true" />;
}

const COINS = { USDT: usdt, USDC: usdc, BTC: btc, ETH: eth, TON: ton, BNB: bnb, SOL: sol, TRX: trx, POL: pol, AVAX: avax, ARB: arb, DAI: dai,
  FDUSD: fdusd, DOGE: doge, XRP: xrp, LINK: link, UNI: uni, CAKE: cake, SHIB: shib, PEPE: pepe, NOT: notc, DOGS: dogs,
  OP: op, MNT: mnt, CRO: cro, S: sonic, XDAI: gnosis };
const NETS = { tron: trx, ton, bsc: bnb, eth, sol, polygon: pol, arbitrum: arb, base, btc, avax,
  optimism, linea, scroll, unichain, opbnb: bnb, mantle, gnosis, sonic, cronos };

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
