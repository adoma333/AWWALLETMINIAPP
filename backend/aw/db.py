"""AW Wallet — SQLite storage (WAL) with serialized money transactions.

Why SQLite: one file, zero ops, survives power loss (WAL + synchronous=FULL), and `BEGIN IMMEDIATE` gives every
money-moving transaction an exclusive write lock, so two requests can never spend the same balance.
Amounts are stored as decimal TEXT and handled with Python Decimal (never float).
"""
import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from . import config

_local = threading.local()
_init_lock = threading.Lock()
_initialized: set[str] = set()


def _path() -> str:
    return str(config.DB_PATH)


def conn() -> sqlite3.Connection:
    path = _path()
    c = getattr(_local, "conn", None)
    if c is not None and getattr(_local, "path", None) == path:
        return c
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(path, timeout=30, isolation_level=None, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=FULL")
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA busy_timeout=30000")
    _local.conn, _local.path, _local.depth = c, path, 0
    with _init_lock:
        if path not in _initialized:
            migrate(c)
            _initialized.add(path)
    return c


def reset_for_tests():
    c = getattr(_local, "conn", None)
    if c is not None:
        c.close()
    _local.conn = None
    _initialized.clear()


@contextmanager
def tx():
    """Exclusive write transaction. Nested calls join the outer transaction."""
    c = conn()
    depth = getattr(_local, "depth", 0)
    if depth:
        _local.depth = depth + 1
        try:
            yield c
        finally:
            _local.depth -= 1
        return
    c.execute("BEGIN IMMEDIATE")
    _local.depth = 1
    try:
        yield c
        c.execute("COMMIT")
    except BaseException:
        c.execute("ROLLBACK")
        raise
    finally:
        _local.depth = 0


def q(sql: str, params=()) -> list[dict]:
    return [dict(r) for r in conn().execute(sql, params).fetchall()]


def one(sql: str, params=()) -> dict | None:
    r = conn().execute(sql, params).fetchone()
    return dict(r) if r else None


def val(sql: str, params=(), default=None):
    r = conn().execute(sql, params).fetchone()
    return r[0] if r and r[0] is not None else default


def x(sql: str, params=()) -> sqlite3.Cursor:
    return conn().execute(sql, params)


def insert(table: str, data: dict, or_ignore: bool = False) -> int:
    cols = ",".join(data)
    marks = ",".join("?" for _ in data)
    verb = "INSERT OR IGNORE" if or_ignore else "INSERT"
    cur = conn().execute(f"{verb} INTO {table} ({cols}) VALUES ({marks})", tuple(_enc(v) for v in data.values()))
    return cur.lastrowid


def update(table: str, where: dict, data: dict) -> int:
    sets = ",".join(f"{k}=?" for k in data)
    cond = " AND ".join(f"{k}=?" for k in where)
    cur = conn().execute(f"UPDATE {table} SET {sets} WHERE {cond}",
                         tuple(_enc(v) for v in data.values()) + tuple(where.values()))
    return cur.rowcount


def _enc(v):
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    if isinstance(v, bool):
        return int(v)
    if v is not None and type(v).__name__ == "Decimal":
        return str(v)
    return v


def jl(v, default=None):
    """Decode a JSON column."""
    if v in (None, ""):
        return {} if default is None else default
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return {} if default is None else default


def now() -> int:
    return int(time.time())


# ───────────────────────────── schema ─────────────────────────────
SCHEMA = [
    # v1
    """
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER);

    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,               -- Telegram user id
        username TEXT, first_name TEXT, last_name TEXT, photo_url TEXT,
        lang TEXT, tg_lang TEXT, is_premium INTEGER DEFAULT 0, country TEXT,
        ref_code TEXT UNIQUE, referred_by INTEGER, ref_level2 INTEGER,
        status TEXT NOT NULL DEFAULT 'active',  -- active | frozen | banned
        status_reason TEXT,
        role TEXT NOT NULL DEFAULT 'user',      -- user | merchant | vip | partner
        kyc_level INTEGER NOT NULL DEFAULT 0,   -- 0 none · 1 phone · 2 identity
        phone_hash TEXT UNIQUE, phone_masked TEXT,
        pin_hash TEXT, pin_set_at INTEGER, pin_fails INTEGER DEFAULT 0, pin_locked_until INTEGER DEFAULT 0,
        bio_token_hash TEXT,
        security_hold_until INTEGER DEFAULT 0,  -- withdrawals blocked until (after PIN reset etc.)
        settings TEXT, flags TEXT,
        risk_score INTEGER DEFAULT 0,
        created_at INTEGER, last_seen INTEGER, last_ip TEXT,
        dm_ok INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS ix_users_username ON users(username COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS ix_users_ref ON users(referred_by);

    CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,          -- symbol, e.g. USDT
        name TEXT NOT NULL, icon TEXT, color TEXT,
        precision INTEGER NOT NULL DEFAULT 8,     -- internal decimals
        display INTEGER NOT NULL DEFAULT 4,       -- UI decimals
        is_stable INTEGER DEFAULT 0, price_symbol TEXT, coingecko_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1, swap_enabled INTEGER NOT NULL DEFAULT 1, p2p_enabled INTEGER NOT NULL DEFAULT 0,
        transfer_enabled INTEGER NOT NULL DEFAULT 1,
        sort INTEGER DEFAULT 100, badges TEXT, meta TEXT
    );

    CREATE TABLE IF NOT EXISTS networks (
        id TEXT PRIMARY KEY,          -- tron | ton | bsc | eth | sol | polygon | arbitrum | base | btc | avax
        name TEXT NOT NULL, short TEXT, kind TEXT NOT NULL, chain_id INTEGER, native_asset TEXT,
        icon TEXT, color TEXT,
        enabled INTEGER NOT NULL DEFAULT 1, deposit_enabled INTEGER NOT NULL DEFAULT 1, withdraw_enabled INTEGER NOT NULL DEFAULT 1,
        withdraw_mode TEXT NOT NULL DEFAULT 'manual',   -- auto | manual
        confirmations INTEGER NOT NULL DEFAULT 12,
        memo_mode TEXT NOT NULL DEFAULT 'none',          -- none | required (shared address + memo)
        explorer_tx TEXT, explorer_addr TEXT,
        eta TEXT, sort INTEGER DEFAULT 100, badges TEXT, config TEXT
    );

    CREATE TABLE IF NOT EXISTS asset_networks (
        asset TEXT NOT NULL, network TEXT NOT NULL,
        contract TEXT, decimals INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, deposit_enabled INTEGER NOT NULL DEFAULT 1, withdraw_enabled INTEGER NOT NULL DEFAULT 1,
        min_deposit TEXT DEFAULT '0', min_withdraw TEXT DEFAULT '0', max_withdraw TEXT DEFAULT '0',
        withdraw_fee TEXT DEFAULT '0', withdraw_fee_pct TEXT DEFAULT '0', fee_mode TEXT DEFAULT 'fixed', -- fixed | dynamic
        sort INTEGER DEFAULT 100, meta TEXT,
        PRIMARY KEY (asset, network)
    );
    CREATE INDEX IF NOT EXISTS ix_an_contract ON asset_networks(network, contract);

    CREATE TABLE IF NOT EXISTS balances (
        user_id INTEGER NOT NULL, asset TEXT NOT NULL,
        available TEXT NOT NULL DEFAULT '0', locked TEXT NOT NULL DEFAULT '0',
        updated_at INTEGER,
        PRIMARY KEY (user_id, asset)
    );

    -- append-only journal: every balance change has exactly one row
    CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL, asset TEXT NOT NULL,
        bucket TEXT NOT NULL DEFAULT 'available',   -- available | locked
        delta TEXT NOT NULL, balance_after TEXT NOT NULL,
        kind TEXT NOT NULL, ref TEXT, note TEXT, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_ledger_user ON ledger(user_id, id);
    CREATE INDEX IF NOT EXISTS ix_ledger_ref ON ledger(ref);

    -- the user-facing activity feed (one row per operation)
    CREATE TABLE IF NOT EXISTS txs (
        id TEXT PRIMARY KEY,                 -- public reference, e.g. AW7K2M9QX
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,                  -- deposit | withdraw | send | receive | swap | p2p_buy | p2p_sell | gift_out | gift_in | gift_refund | referral | reward | adjust | fee_refund
        status TEXT NOT NULL,                -- pending | processing | completed | failed | cancelled | rejected
        asset TEXT NOT NULL, amount TEXT NOT NULL,
        fee TEXT DEFAULT '0', fee_asset TEXT,
        asset2 TEXT, amount2 TEXT,           -- swap output / counter asset
        network TEXT, address TEXT, memo TEXT, txid TEXT,
        counterparty INTEGER, ref TEXT,
        usd_value TEXT, meta TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_txs_user ON txs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS ix_txs_ref ON txs(ref);
    CREATE INDEX IF NOT EXISTS ix_txs_type ON txs(type, created_at);

    CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, user_id INTEGER, result TEXT, created_at INTEGER);

    -- ── chain layer ──
    CREATE TABLE IF NOT EXISTS hd_index (family TEXT PRIMARY KEY, next_index INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS deposit_addresses (
        user_id INTEGER NOT NULL, family TEXT NOT NULL,   -- evm | tron | sol | btc | ton
        address TEXT NOT NULL, memo TEXT, hd_index INTEGER, created_at INTEGER,
        watch_until INTEGER DEFAULT 0,          -- scanned frequently until (user opened deposit screen / recent activity)
        PRIMARY KEY (user_id, family)
    );
    CREATE TABLE IF NOT EXISTS btc_utxos (
        txid TEXT NOT NULL, vout INTEGER NOT NULL, address TEXT NOT NULL, value INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'unspent',   -- unspent | reserved | spent
        spent_by TEXT, height INTEGER, created_at INTEGER,
        PRIMARY KEY (txid, vout)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dep_addr ON deposit_addresses(family, address, memo);

    CREATE TABLE IF NOT EXISTS chain_deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network TEXT NOT NULL, txid TEXT NOT NULL, idx TEXT NOT NULL DEFAULT '0',
        address TEXT, memo TEXT, from_address TEXT,
        asset TEXT, contract TEXT, amount TEXT NOT NULL, raw_amount TEXT,
        block INTEGER, confirmations INTEGER DEFAULT 0,
        status TEXT NOT NULL,      -- seen | credited | below_min | unrecognized | no_owner | disabled | ignored
        user_id INTEGER, tx_ref TEXT, source TEXT, note TEXT,
        created_at INTEGER, credited_at INTEGER,
        UNIQUE (network, txid, idx)
    );
    CREATE INDEX IF NOT EXISTS ix_cd_status ON chain_deposits(status);

    CREATE TABLE IF NOT EXISTS scan_state (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);

    -- exact native-balance accounting for EVM/TRON deposit addresses (see chains/README in docs)
    CREATE TABLE IF NOT EXISTS addr_state (
        network TEXT NOT NULL, address TEXT NOT NULL, asset TEXT NOT NULL,
        expected TEXT NOT NULL DEFAULT '0', pending INTEGER NOT NULL DEFAULT 0, updated_at INTEGER,
        PRIMARY KEY (network, address, asset)
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
        id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
        asset TEXT NOT NULL, network TEXT NOT NULL, address TEXT NOT NULL, memo TEXT,
        amount TEXT NOT NULL, fee TEXT NOT NULL, total TEXT NOT NULL,
        status TEXT NOT NULL,   -- review | approved | processing | broadcast | completed | failed | rejected | cancelled
        txid TEXT, risk TEXT, error TEXT, attempts INTEGER DEFAULT 0,
        reviewer INTEGER, review_note TEXT,
        created_at INTEGER, updated_at INTEGER, sent_at INTEGER, done_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_wd_status ON withdrawals(status);
    CREATE INDEX IF NOT EXISTS ix_wd_user ON withdrawals(user_id, created_at);

    CREATE TABLE IF NOT EXISTS treasury_ops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network TEXT NOT NULL, kind TEXT NOT NULL,       -- sweep | topup | withdraw | rebalance
        from_address TEXT, to_address TEXT, asset TEXT, amount TEXT,
        txid TEXT, status TEXT NOT NULL, fee TEXT, block INTEGER, ref TEXT, error TEXT,
        created_at INTEGER, updated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_tops_status ON treasury_ops(status);

    -- ── prices & swap ──
    CREATE TABLE IF NOT EXISTS prices (asset TEXT PRIMARY KEY, usd TEXT NOT NULL, change24h TEXT, sources TEXT, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS price_history (asset TEXT, ts INTEGER, usd TEXT, PRIMARY KEY (asset, ts));
    CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY, user_id INTEGER, from_asset TEXT, to_asset TEXT,
        amount_in TEXT, amount_out TEXT, rate TEXT, market_rate TEXT, spread_pct TEXT, fee TEXT, fee_asset TEXT,
        profit_usd TEXT, expires_at INTEGER, used INTEGER DEFAULT 0, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS swaps (
        id TEXT PRIMARY KEY, user_id INTEGER, from_asset TEXT, to_asset TEXT,
        amount_in TEXT, amount_out TEXT, rate TEXT, market_rate TEXT, spread_pct TEXT,
        fee TEXT, fee_asset TEXT, profit_usd TEXT, volume_usd TEXT, created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_swaps_user ON swaps(user_id, created_at);

    -- platform revenue journal (every fee/spread the platform earns)
    CREATE TABLE IF NOT EXISTS revenue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,        -- swap_spread | swap_fee | withdraw_fee | p2p_fee | gift_fee | transfer_fee
        ref TEXT, user_id INTEGER, asset TEXT, amount TEXT, usd TEXT, created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_rev_time ON revenue(created_at);

    -- ── fees ──
    CREATE TABLE IF NOT EXISTS fee_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,          -- swap | withdraw | transfer | gift | p2p_maker | p2p_taker | deposit
        scope TEXT NOT NULL,         -- global | asset | network | asset_network | pair | role | vip | user
        scope_id TEXT,
        pct TEXT, fixed TEXT, min_fee TEXT, max_fee TEXT,
        active INTEGER NOT NULL DEFAULT 1, starts_at INTEGER, ends_at INTEGER, note TEXT, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS vip_tiers (
        level INTEGER PRIMARY KEY, name TEXT, min_volume_usd TEXT NOT NULL,
        fee_discount_pct TEXT NOT NULL DEFAULT '0', limit_multiplier TEXT DEFAULT '1', perks TEXT
    );
    CREATE TABLE IF NOT EXISTS promos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, kinds TEXT, assets TEXT,
        discount_pct TEXT NOT NULL DEFAULT '100', starts_at INTEGER, ends_at INTEGER, active INTEGER DEFAULT 1,
        banner TEXT, created_at INTEGER
    );

    -- ── transfers & gifts ──
    CREATE TABLE IF NOT EXISTS gifts (
        id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL,
        sender_id INTEGER NOT NULL, asset TEXT NOT NULL, amount TEXT NOT NULL, fee TEXT DEFAULT '0',
        lock_type TEXT NOT NULL,         -- user | username | open | password
        recipient_id INTEGER, recipient_username TEXT, recipient_name TEXT, password_hash TEXT,
        shares INTEGER NOT NULL DEFAULT 1, claimed_shares INTEGER NOT NULL DEFAULT 0, split TEXT DEFAULT 'equal',
        remaining TEXT NOT NULL, message TEXT, theme TEXT,
        status TEXT NOT NULL,            -- active | claimed | refunded | expired | cancelled
        created_at INTEGER, expires_at INTEGER, done_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_gifts_sender ON gifts(sender_id);
    CREATE INDEX IF NOT EXISTS ix_gifts_recipient ON gifts(recipient_id);
    CREATE TABLE IF NOT EXISTS gift_claims (gift_id TEXT, user_id INTEGER, amount TEXT, created_at INTEGER, PRIMARY KEY (gift_id, user_id));
    CREATE TABLE IF NOT EXISTS contact_picks (
        token TEXT PRIMARY KEY, user_id INTEGER, purpose TEXT, picked_id INTEGER, picked_name TEXT, picked_username TEXT,
        created_at INTEGER, picked_at INTEGER
    );

    -- ── P2P ──
    CREATE TABLE IF NOT EXISTS p2p_methods (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'bank', icon TEXT, color TEXT,
        fields TEXT, currencies TEXT, countries TEXT, enabled INTEGER DEFAULT 1, sort INTEGER DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS p2p_user_methods (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, method_id TEXT NOT NULL,
        label TEXT, data TEXT NOT NULL, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS p2p_ads (
        id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
        side TEXT NOT NULL,              -- sell (advertiser sells crypto) | buy (advertiser buys crypto)
        asset TEXT NOT NULL, fiat TEXT NOT NULL,
        price_type TEXT NOT NULL DEFAULT 'fixed', price TEXT, margin_pct TEXT,
        total TEXT NOT NULL, remaining TEXT NOT NULL, min_fiat TEXT NOT NULL, max_fiat TEXT NOT NULL,
        methods TEXT NOT NULL, user_methods TEXT, window_min INTEGER NOT NULL DEFAULT 15,
        terms TEXT, auto_reply TEXT, conditions TEXT, fee_pct TEXT DEFAULT '0',
        status TEXT NOT NULL DEFAULT 'online',   -- online | offline | closed | blocked
        created_at INTEGER, updated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_ads_market ON p2p_ads(asset, fiat, side, status);
    CREATE TABLE IF NOT EXISTS p2p_orders (
        id TEXT PRIMARY KEY, ad_id TEXT NOT NULL, maker_id INTEGER NOT NULL, taker_id INTEGER NOT NULL,
        buyer_id INTEGER NOT NULL, seller_id INTEGER NOT NULL,
        asset TEXT NOT NULL, fiat TEXT NOT NULL, price TEXT NOT NULL, amount TEXT NOT NULL, fiat_amount TEXT NOT NULL,
        fee TEXT NOT NULL DEFAULT '0', fee_payer INTEGER, seller_fee TEXT DEFAULT '0', buyer_fee TEXT DEFAULT '0',
        method_id TEXT, payment TEXT,
        status TEXT NOT NULL,   -- pending | paid | completed | cancelled | appeal | expired
        expires_at INTEGER, paid_at INTEGER, done_at INTEGER, cancel_reason TEXT, created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_orders_status ON p2p_orders(status, expires_at);
    CREATE INDEX IF NOT EXISTS ix_orders_buyer ON p2p_orders(buyer_id);
    CREATE INDEX IF NOT EXISTS ix_orders_seller ON p2p_orders(seller_id);
    CREATE TABLE IF NOT EXISTS p2p_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, sender_id INTEGER NOT NULL,  -- 0 system, -1 arbiter
        text TEXT, file TEXT, created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_msgs_order ON p2p_messages(order_id, id);
    CREATE TABLE IF NOT EXISTS p2p_disputes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT UNIQUE NOT NULL, opened_by INTEGER NOT NULL,
        reason TEXT, details TEXT, status TEXT NOT NULL DEFAULT 'open',   -- open | review | resolved
        resolution TEXT, admin_id INTEGER, ai_summary TEXT, created_at INTEGER, resolved_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS p2p_reviews (
        order_id TEXT NOT NULL, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, positive INTEGER NOT NULL,
        comment TEXT, created_at INTEGER, PRIMARY KEY (order_id, from_id)
    );

    -- ── growth ──
    CREATE TABLE IF NOT EXISTS referral_earnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id INTEGER NOT NULL, referee_id INTEGER NOT NULL,
        level INTEGER NOT NULL, source TEXT, ref TEXT, fee_usd TEXT, commission_usd TEXT, created_at INTEGER,
        claimed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_refe_referrer ON referral_earnings(referrer_id);
    CREATE TABLE IF NOT EXISTS vouchers (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        kind TEXT NOT NULL,          -- fee_free | fee_discount | bonus
        kinds TEXT, value TEXT, uses_left INTEGER DEFAULT 1, source TEXT,
        expires_at INTEGER, created_at INTEGER, used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_vouchers_user ON vouchers(user_id);
    CREATE TABLE IF NOT EXISTS checkins (user_id INTEGER, day TEXT, PRIMARY KEY (user_id, day));
    CREATE TABLE IF NOT EXISTS user_missions (
        user_id INTEGER, mission TEXT, progress INTEGER DEFAULT 0, completed_at INTEGER, claimed_at INTEGER,
        PRIMARY KEY (user_id, mission)
    );
    CREATE TABLE IF NOT EXISTS achievements (user_id INTEGER, key TEXT, created_at INTEGER, PRIMARY KEY (user_id, key));

    -- ── support ──
    CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, subject TEXT, category TEXT,
        status TEXT NOT NULL DEFAULT 'open',   -- open | waiting_admin | answered | closed
        priority TEXT DEFAULT 'normal', ref TEXT, assigned INTEGER, rating INTEGER,
        created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS ticket_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, sender TEXT NOT NULL,   -- user | ai | admin | system
        sender_id INTEGER, text TEXT, file TEXT, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS ai_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
        created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_ai_user ON ai_messages(user_id, id);
    CREATE TABLE IF NOT EXISTS forms (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, kind TEXT NOT NULL, data TEXT, status TEXT DEFAULT 'new',
        admin_note TEXT, created_at INTEGER
    );

    -- ── user utilities ──
    CREATE TABLE IF NOT EXISTS address_book (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, network TEXT NOT NULL, address TEXT NOT NULL,
        memo TEXT, label TEXT, whitelisted INTEGER DEFAULT 0, created_at INTEGER, usable_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS ton_wallets (user_id INTEGER PRIMARY KEY, address TEXT NOT NULL, app TEXT, connected_at INTEGER);
    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT, title TEXT, body TEXT, ref TEXT,
        read INTEGER DEFAULT 0, created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, id);
    CREATE TABLE IF NOT EXISTS kyc_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, level INTEGER, data TEXT, files TEXT,
        status TEXT DEFAULT 'pending', note TEXT, created_at INTEGER, reviewed_at INTEGER, reviewer INTEGER
    );
    CREATE TABLE IF NOT EXISTS login_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, ip TEXT, ua TEXT, platform TEXT, created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_login_user ON login_events(user_id, id);

    -- ── admin ──
    CREATE TABLE IF NOT EXISTS admins (user_id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT, added_by INTEGER, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS admin_tokens (token_hash TEXT PRIMARY KEY, admin_id INTEGER, expires_at INTEGER, used INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, actor_id INTEGER, action TEXT NOT NULL, target TEXT,
        data TEXT, ip TEXT, created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_audit_time ON audit_log(created_at);
    CREATE TABLE IF NOT EXISTS broadcasts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, button TEXT, segment TEXT, status TEXT, sent INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0, total INTEGER DEFAULT 0, cursor INTEGER DEFAULT 0, admin_id INTEGER, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS icons (key TEXT PRIMARY KEY, path TEXT NOT NULL, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, method TEXT NOT NULL, payload TEXT NOT NULL, priority INTEGER DEFAULT 5,
        status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER DEFAULT 0, next_at INTEGER DEFAULT 0, error TEXT,
        broadcast_id INTEGER, created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_outbox_q ON outbox(status, priority, next_at);
    CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT, kind TEXT, text TEXT, seen INTEGER DEFAULT 0, created_at INTEGER
    );
    """,
]


def migrate(c: sqlite3.Connection):
    ver = c.execute("PRAGMA user_version").fetchone()[0]
    for i, script in enumerate(SCHEMA, start=1):
        if ver < i:
            c.executescript(script)
            c.execute(f"PRAGMA user_version={i}")


def backup(dest: str):
    """Consistent online copy (safe while the app is running)."""
    src = conn()
    out = sqlite3.connect(dest)
    try:
        src.backup(out)
    finally:
        out.close()
