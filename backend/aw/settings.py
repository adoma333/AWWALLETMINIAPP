"""Admin-controlled settings: defaults here, overrides stored in the `settings` table (deep-merged)."""
import copy
import json
import threading
import time

from . import db

T = lambda **kw: kw  # noqa: E731  (multilingual text helper: T(en=..., ar=...))

DEFAULTS: dict = {
    "general": {
        "app_name": "ZOHRA WALLET",
        "maintenance": False,
        "maintenance_msg": T(en="We are upgrading Zohra Wallet. Your funds are safe.", ar="نقوم بتحديث Zohra Wallet. أموالك في أمان."),
        "support_username": "",
        "channel_url": "",
        "terms_url": "",
        "privacy_url": "",
        "default_lang": "en",
        "languages": ["en", "ar", "ru", "tr", "fa", "fr", "es", "pt", "de", "id", "hi", "zh", "uk", "uz"],
        "display_currencies": ["USD", "EUR", "RUB", "TRY", "SAR", "AED", "EGP", "DZD", "MAD", "IQD", "INR", "IDR", "UAH", "BRL"],
        "features": {
            "deposit": True, "withdraw": True, "transfer": True, "swap": True, "gifts": True, "p2p": True,
            "ai": True, "referral": True, "rewards": True, "ton_connect": True, "kyc": True,
        },
        # home-screen trust badges (fully editable: text per language, icon key, colour)
        "badges": [],    # optional home badges: [{key, enabled, icon, text{en, ar, …}}] — managed in the admin panel
        "banners": [],   # [{id, image, title{}, body{}, link, enabled, until}]
        "announcement": None,  # {text{}, level, until}
    },
    "limits": {
        # per verification level, values in USD
        "levels": {
            "0": {"withdraw_daily": 2000, "withdraw_single": 1000, "transfer_daily": 5000, "p2p_daily": 500},
            "1": {"withdraw_daily": 20000, "withdraw_single": 10000, "transfer_daily": 50000, "p2p_daily": 10000},
            "2": {"withdraw_daily": 250000, "withdraw_single": 100000, "transfer_daily": 500000, "p2p_daily": 100000},
        },
        "auto_approve_usd": 300,          # auto withdrawals up to this value (when network mode is auto)
        "first_withdraw_review": True,    # a user's first withdrawal always goes to manual review
        "new_address_review_usd": 1000,   # first withdrawal to a new address above this → review
        "daily_auto_cap_usd": 20000,      # platform-wide auto-withdrawal cap per day (circuit breaker)
        "require_phone_for_withdraw": False,
        "require_phone_for_p2p": True,
        "min_account_age_hours_withdraw": 0,
    },
    # Identity verification — only asked for when a user reaches the limits of levels 0/1 above
    "kyc": {
        "enabled": True,
        "doc_types": ["passport", "id_card", "residence_permit", "driving_license"],
        "require_selfie": True,
        "require_back": True,             # ID cards: the back side carries the MRZ
        "auto_approve": False,            # approve automatically when the MRZ is valid and nothing is flagged
        "min_age": 18,
        "blocked_countries": [],          # ISO 3166 alpha-3 codes as printed in the MRZ, e.g. ["PRK"]
    },
    "security": {
        "pin_required": ["withdraw", "transfer", "gift", "p2p_release", "address_book", "export"],
        "transfer_pin_threshold_usd": 0,   # 0 = always ask for PIN on internal transfers
        "pin_max_fails": 5,
        "pin_lock_minutes": 30,
        "hold_after_pin_reset_hours": 24,
        "address_whitelist_hold_hours": 0,
        "max_accounts_per_phone": 1,
        "rate_limit_per_minute": 90,
        "block_vpn_countries": [],
    },
    "swap": {
        "spread_pct": "0.8",             # platform margin baked into the rate
        "fee_pct": "0",                  # optional explicit fee on top (shown separately)
        "quote_ttl_sec": 20,
        "min_usd": "1",
        "max_usd": "50000",
        "daily_user_usd": "200000",
        "price_max_age_sec": 180,
        "max_source_deviation_pct": "2.5",   # halt pair when sources disagree more than this
        "sources": ["binance", "okx", "bybit", "kucoin", "coingecko"],
        "refresh_sec": 15,                    # live price refresh (the slow aggregator source is polled every 2 min)
        "price_mode": "best_for_platform",    # median | best_for_platform | best_for_user
        "inventory_guard": True,              # block swaps that would exceed hot-wallet inventory
        "max_net_exposure_usd": {},           # {asset: usd} optional caps
    },
    "transfers": {
        "fee_pct": "0", "fee_fixed_usd": "0",
        "min_usd": "0.01",
        "allow_by_username": True, "allow_by_id": True,
        "badge": "",
    },
    "gifts": {
        "enabled": True, "fee_pct": "0", "min_usd": "0.1", "max_shares": 200, "expire_hours": 72,
        "themes": ["classic", "birthday", "eid", "love", "thanks", "ramadan"],
    },
    "p2p": {
        "fiats": ["USD", "EUR", "SAR", "AED", "EGP", "DZD", "MAD", "IQD", "TRY", "RUB", "UAH", "INR", "IDR", "NGN", "PKR", "BRL", "KZT", "UZS"],
        "assets": ["USDT", "USDC", "TON", "BTC", "ETH", "TRX", "BNB", "SOL"],
        "maker_fee_pct": "0.1", "taker_fee_pct": "0",
        "payment_windows": [15, 30, 45, 60],
        "min_kyc_to_post": 1,
        "allow_terms": True,
        "max_open_orders": 5,
        "cancel_limit_per_day": 3,
        "cancel_ban_hours": 24,
        "appeal_after_min": 10,
        "auto_release_hours": 0,          # 0 = never auto release (seller must confirm)
        "merchant_min_orders": 30, "merchant_min_completion_pct": 90,
        "price_guard_pct": "0",           # 0 = free pricing; e.g. "20" keeps ads within ±20% of market
    },
    "referral": {
        "enabled": True,
        "level1_pct": "30", "level2_pct": "5",      # share of platform revenue from referees
        "tiers": [{"min_friends": 0, "level1_pct": "30"}, {"min_friends": 10, "level1_pct": "35"}, {"min_friends": 50, "level1_pct": "40"}],
        "duration_days": 365,
        "payout_asset": "USDT",
        "min_claim_usd": "1",
        "referee_bonus": {"kind": "fee_free", "kinds": ["withdraw", "swap"], "uses": 3, "days": 30},
        "referrer_bonus_on_first_deposit_usd": "0",
    },
    "rewards": {
        "enabled": True,
        "checkin": {"enabled": True, "streak_days": 7, "reward": {"kind": "fee_free", "kinds": ["swap"], "uses": 1, "days": 7}},
        "first_tx": {"enabled": True, "reward": {"kind": "fee_free", "kinds": ["withdraw", "swap", "p2p_taker"], "uses": 1, "days": 30}},
        "welcome": {"enabled": True, "reward": {"kind": "fee_free", "kinds": ["withdraw"], "uses": 1, "days": 14}},
        "missions": [
            {"id": "first_deposit", "event": "deposit", "target": 1, "reward": {"kind": "fee_free", "kinds": ["withdraw"], "uses": 1, "days": 30},
             "title": T(en="Make your first deposit", ar="قم بأول إيداع")},
            {"id": "first_swap", "event": "swap", "target": 1, "reward": {"kind": "fee_free", "kinds": ["swap"], "uses": 2, "days": 30},
             "title": T(en="Make your first swap", ar="قم بأول تحويل عملات")},
            {"id": "invite_3", "event": "referral", "target": 3, "reward": {"kind": "fee_free", "kinds": ["withdraw", "swap"], "uses": 5, "days": 60},
             "title": T(en="Invite 3 friends", ar="ادعُ 3 أصدقاء")},
            {"id": "verify_phone", "event": "phone", "target": 1, "reward": {"kind": "fee_discount", "value": "50", "kinds": ["swap"], "uses": 3, "days": 30},
             "title": T(en="Verify your phone", ar="وثّق رقم هاتفك")},
            {"id": "send_gift", "event": "gift", "target": 1, "reward": {"kind": "fee_free", "kinds": ["transfer", "gift"], "uses": 3, "days": 30},
             "title": T(en="Send your first gift", ar="أرسل أول هدية")},
        ],
    },
    "ai": {
        "enabled": True,
        "name": "Zohra AI",
        "provider": "auto",          # auto (Claude first) | claude | gemini — the other one takes over on failure
        "model": "",                 # Claude model; empty = AI_MODEL from .env
        "effort": "medium",
        "gemini_model": "gemini-flash-latest",
        "anthropic_api_key": "",     # stored encrypted; empty = ANTHROPIC_API_KEY from .env
        "gemini_api_key": "",        # stored encrypted (Google AI Studio key); empty = GEMINI_API_KEY from .env
        "daily_messages": 60,
        "extra_instructions": "",
        "known_issues": [],          # [{title{}, answer{}}] surfaced as instant suggestions
        "suggestions": [
            {"key": "deposit_missing", "text": T(en="My deposit hasn't arrived", ar="إيداعي لم يصل")},
            {"key": "withdraw_status", "text": T(en="Where is my withdrawal?", ar="أين وصل سحبي؟")},
            {"key": "fees", "text": T(en="What are the fees?", ar="ما هي الرسوم؟")},
            {"key": "swap_how", "text": T(en="How do I swap coins?", ar="كيف أحوّل بين العملات؟")},
            {"key": "p2p_how", "text": T(en="How does P2P work?", ar="كيف يعمل P2P؟")},
            {"key": "new_method", "text": T(en="Suggest a payment method", ar="اقتراح طريقة دفع جديدة")},
            {"key": "human", "text": T(en="Talk to a human", ar="التحدث مع موظف")},
        ],
    },
    # Telegram bot profile — pushed to Telegram automatically (setMyName / setMyDescription / setMyShortDescription)
    "bot": {
        "name": "Zohra Wallet",
        "short_description": T(
            en="Your crypto wallet inside Telegram — send, swap, buy and gift on every major network.",
            ar="محفظتك الرقمية داخل تيليجرام — أرسل وبدّل واشترِ وأهدِ العملات على كل الشبكات الكبرى.",
            ru="Криптокошелёк в Telegram — отправляйте, обменивайте, покупайте и дарите на всех крупных сетях.",
            tr="Telegram içindeki kripto cüzdanınız — tüm büyük ağlarda gönderin, takas edin, alın ve hediye edin.",
            fa="کیف پول رمزارز شما در تلگرام — ارسال، تبدیل، خرید و هدیه در همه شبکه‌های بزرگ.",
            fr="Votre portefeuille crypto dans Telegram — envoyez, échangez, achetez et offrez sur tous les grands réseaux.",
            es="Tu billetera cripto en Telegram: envía, intercambia, compra y regala en todas las grandes redes.",
        ),
        "description": T(
            en="ZOHRA WALLET — the crypto wallet that lives in Telegram.\n\n• Send money to any contact as easily as a message\n• Swap and buy coins at sharp rates\n• P2P with escrow protection\n• Gifts and red packets\n• PIN, biometrics and 24/7 monitoring\n\nTap Start to open your wallet.",
            ar="ZOHRA WALLET — المحفظة الرقمية التي تعيش داخل تيليجرام.\n\n• أرسل الأموال لأي جهة اتصال بسهولة الرسالة\n• بدّل واشترِ العملات بأفضل الأسعار\n• تداول P2P بحماية الضمان\n• هدايا وظروف حمراء\n• رمز سري وبصمة ومراقبة على مدار الساعة\n\nاضغط «ابدأ» لفتح محفظتك.",
        ),
    },
    "branding": {
        "ember": "#FF8A00", "flame": "#FF5A00",
        "logo_url": "", "icon_url": "",
        "welcome_text": T(en="Your money. Every network. One tap.", ar="أموالك. كل الشبكات. بلمسة واحدة."),
    },
    "ton_connect": {"enabled": True, "manifest_name": "Zohra Wallet"},
    "notifications": {"admin_alerts": True, "large_deposit_usd": 5000, "large_withdraw_usd": 5000},
}

_cache: dict = {}
_cache_at = 0.0
_lock = threading.Lock()
TTL = 5.0


def _deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _load() -> dict:
    global _cache, _cache_at
    with _lock:
        if time.time() - _cache_at < TTL and _cache:
            return _cache
        stored = {r["key"]: db.jl(r["value"]) for r in db.q("SELECT key, value FROM settings")}
        merged = {k: _deep_merge(v, stored.get(k, {})) for k, v in DEFAULTS.items()}
        for k, v in stored.items():
            if k not in merged:
                merged[k] = v
        _cache, _cache_at = merged, time.time()
        return merged


def get(section: str) -> dict:
    return copy.deepcopy(_load().get(section, {}))


def all_settings() -> dict:
    return copy.deepcopy(_load())


def put(section: str, value: dict):
    """Replace the stored override for a section (value is merged over defaults on read)."""
    db.x("INSERT INTO settings(key, value, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
         (section, json.dumps(value, ensure_ascii=False), db.now()))
    invalidate()


def patch(section: str, value: dict):
    cur = db.one("SELECT value FROM settings WHERE key=?", (section,))
    merged = _deep_merge(db.jl(cur["value"]) if cur else {}, value)
    put(section, merged)


def invalidate():
    global _cache_at
    _cache_at = 0


def feature(name: str) -> bool:
    return bool(get("general").get("features", {}).get(name, False))


def raw(key: str, default=None):
    r = db.one("SELECT value FROM settings WHERE key=?", (key,))
    return db.jl(r["value"], default) if r else default


def set_raw(key: str, value):
    put(key, value)
