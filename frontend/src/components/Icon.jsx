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
  Activity, ArrowDown, ArrowLeftRight, ArrowRight, ArrowUp, BadgeCheck, Banknote, Bell, BookOpen, BookUser, Bot, Calculator, Calendar, Camera, Car,
  ChartColumn, ChartLine, ChartPie, Check, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CircleHelp, ClipboardPaste, Clock, Cloud, Coins, Copy,
  CreditCard, Crown, Delete, DollarSign, Download, Ellipsis, ExternalLink, Eye, EyeOff, Fingerprint, Flag, Flame, Funnel, Gem, Gift, Globe, HandCoins,
  Handshake, Headset, Heart, History, Hourglass, House, IdCard, Image, Inbox, Info, Key, Landmark, Layers, LayoutGrid, LifeBuoy, Link, List, Lock, LogOut,
  Megaphone, MessageCircle, Mic, Minus, Moon, Package, Palette, Paperclip, Pencil, Percent, PiggyBank, Plus, Power, QrCode, Receipt, RefreshCw, Repeat,
  Rocket, ScanFace, ScanLine, Search, Send, Settings, Share, Shield, ShieldAlert, ShieldCheck, SlidersHorizontal, Smartphone, Sparkles, Split, Star,
  Store, Sun, Tag, Target, Ticket, Trash2, TrendingDown, TrendingUp, TriangleAlert, Trophy, User, UserPlus, Users, Volume2, VolumeX, Wallet, WifiOff, Wrench, X, Zap,
} from 'lucide-react';

// Telegram's paper plane (brand mark — not part of the icon font)
function TelegramGlyph({ size = 22, className = '', style }) {
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.94 4.3l-3.17 14.96c-.24 1.06-.87 1.32-1.75.82l-4.83-3.56-2.33 2.24c-.26.26-.47.47-.97.47l.35-4.92 8.95-8.09c.39-.35-.08-.54-.6-.19L6.53 13.0 1.77 11.5c-1.03-.32-1.05-1.03.22-1.53L20.6 2.8c.86-.32 1.62.2 1.34 1.5z" />
    </svg>
  );
}

// One icon family for every screen (Lucide: 24px grid, 2px rounded strokes — the line style of the design sheets).
// Any icon can still be replaced by an admin upload (key ui:<name>).
const ICONS = {
  home: House, analytics: ChartColumn, referral: UserPlus, rewards: Gift, plans: Gem, settings: Settings, star: Star, share: Share, copy: Copy,
  download: Download, bolt: Zap, zap: Zap, headset: Headset, bell: Bell, chart: ChartLine, shield: Shield, shieldok: ShieldCheck, cloud: Cloud,
  trophy: Trophy, gift: Gift, wallet: Wallet, globe: Globe, check: Check, checkCircle: CircleCheck, close: X, x: X, alert: TriangleAlert,
  wifiOff: WifiOff, refresh: RefreshCw, sound: Volume2, soundOff: VolumeX, image: Image, send: Send, sun: Sun, moon: Moon, eye: Eye, eyeOff: EyeOff,
  rocket: Rocket, diamond: Gem, crown: Crown, fire: Flame, flame: Flame, heart: Heart, chat: MessageCircle, calendar: Calendar, clock: Clock,
  target: Target, coin: Coins, coins: Coins, percent: Percent, sparkle: Sparkles, info: Info, question: CircleHelp, help: CircleHelp, book: BookOpen,
  calc: Calculator, history: History, grid: LayoutGrid, apps: LayoutGrid, layers: Layers, palette: Palette, phone: Smartphone, device: Smartphone,
  qr: QrCode, key: Key, lifebuoy: LifeBuoy, flag: Flag, list: List, trend: TrendingUp, trendDown: TrendingDown, link: Link, power: Power, lock: Lock, card: CreditCard, user: User,
  megaphone: Megaphone, mega: Megaphone, arrowDown: ArrowDown, down: ArrowDown, arrowUp: ArrowUp, up: ArrowUp, arrowRight: ArrowRight,
  swap: ArrowLeftRight, p2p: Handshake, plus: Plus, minus: Minus, scan: ScanLine, idCard: IdCard, camera: Camera, face: ScanFace, car: Car,
  verified: BadgeCheck, contacts: BookUser, users: Users, chevron: ChevronRight, chev: ChevronRight, chevronDown: ChevronDown, dd: ChevronDown,
  back: ChevronLeft, search: Search, filter: Funnel, paste: ClipboardPaste, external: ExternalLink, receipt: Receipt, handshake: Handshake,
  bank: Landmark, fingerprint: Fingerprint, finger: Fingerprint, trash: Trash2, edit: Pencil, more: Ellipsis, logout: LogOut, attach: Paperclip,
  paperclip: Paperclip, split: Split, dollar: DollarSign, tool: Wrench, sliders: SlidersHorizontal, repeat: Repeat, pie: ChartPie, inbox: Inbox, mic: Mic,
  shieldAlert: ShieldAlert, cash: Banknote, del: Delete, earn: PiggyBank, handCoins: HandCoins, activity: Activity, bot: Bot, ticket: Ticket, tag: Tag,
  hourglass: Hourglass, package: Package, store: Store, telegram: TelegramGlyph,
};

export default function Icon({ name, size = 22, className = '', style, weight, stroke }) {
  const { icons } = useApp();
  const custom = icons?.[`ui:${name}`];
  if (custom) return <img className={`ic-img ${className}`} src={custom} width={size} height={size} alt="" style={style} />;
  const C = ICONS[name] || Coins;
  // "bold" (primary actions) and "fill" (active tab) map to a slightly heavier stroke in the line family
  const sw = stroke || (weight === 'bold' || weight === 'fill' ? 2.3 : 2);
  return <C className={className || undefined} size={size} strokeWidth={sw} style={style} aria-hidden="true" />;
}

const COINS = { USDT: usdt, USDC: usdc, BTC: btc, ETH: eth, TON: ton, BNB: bnb, SOL: sol, TRX: trx, POL: pol, AVAX: avax, ARB: arb, DAI: dai,
  FDUSD: fdusd, DOGE: doge, XRP: xrp, LINK: link, UNI: uni, CAKE: cake, SHIB: shib, PEPE: pepe, NOT: notc, DOGS: dogs,
  OP: op, MNT: mnt, CRO: cro, S: sonic, XDAI: gnosis };
const NETS = { tron: trx, ton, bsc: bnb, eth, sol, polygon: pol, arbitrum: arb, base, btc, avax,
  optimism, linea, scroll, unichain, opbnb: bnb, mantle, gnosis, sonic, cronos };

function Fallback({ label, color }) {
  return <span className="coin-fb" style={color ? { background: color } : undefined}>{String(label || '?').slice(0, 3)}</span>;
}

/** Bundled logo first (instant, no request); an admin-uploaded logo overrides it; downloaded logos fill the gaps. */
function coinSrc(icons, auto, asset) {
  const server = icons?.[`asset:${asset}`];
  if (server && !(auto || []).includes(`asset:${asset}`)) return server;
  return COINS[asset] || server;
}

export function CoinIcon({ asset, size = 40, network }) {
  const { icons, config } = useApp();
  const src = coinSrc(icons, config?.icons_auto, asset);
  const nsrc = network ? icons?.[`net:${network}`] || NETS[network] : null;
  return (
    <span className="coin" style={{ width: size, height: size }}>
      {src ? <img src={src} alt={asset} decoding="async" /> : <Fallback label={asset} />}
      {nsrc && <img className="n" src={nsrc} alt={network} />}
    </span>
  );
}

export function NetIcon({ network, size = 22, className = '' }) {
  const { icons } = useApp();
  const src = icons?.[`net:${network}`] || NETS[network];
  return (
    <span className={`coin ${className}`} style={{ width: size, height: size }}>
      {src ? <img src={src} alt={network} decoding="async" /> : <Fallback label={network} />}
    </span>
  );
}
