"""Price oracle: aggregates public tickers from several exchanges + CoinGecko, and FX rates for display.

Each source is optional; a price is usable when at least one fresh source agrees. Deviation between sources beyond
`max_source_deviation_pct` halts swaps for that asset (protects against a single broken feed).
"""
import logging
import statistics
import time
from decimal import Decimal

import httpx

from . import db, settings
from .money import ZERO, AppError, D, s

log = logging.getLogger("aw.prices")
STABLE_ONE = {"USDT"}  # quote currency of every source
HTTP = {"get": lambda url, params=None: httpx.get(url, params=params, timeout=12, headers={"User-Agent": "aw-wallet/1.0"}).json()}


def _symbols() -> dict[str, str]:
    return {a["id"]: (a.get("price_symbol") or a["id"]) for a in db.q("SELECT id, price_symbol FROM assets WHERE enabled=1")}


def _binance(syms: dict) -> dict:
    data = HTTP["get"]("https://api.binance.com/api/v3/ticker/24hr")
    m = {d["symbol"]: d for d in data if isinstance(d, dict)}
    out = {}
    for aid, sym in syms.items():
        d = m.get(f"{sym}USDT")
        if d and D(d.get("lastPrice")) > 0:
            out[aid] = (D(d["lastPrice"]), D(d.get("priceChangePercent")))
    return out


def _okx(syms: dict) -> dict:
    data = HTTP["get"]("https://www.okx.com/api/v5/market/tickers", {"instType": "SPOT"}).get("data", [])
    m = {d["instId"]: d for d in data}
    out = {}
    for aid, sym in syms.items():
        d = m.get(f"{sym}-USDT")
        if d and D(d.get("last")) > 0:
            op = D(d.get("open24h"))
            out[aid] = (D(d["last"]), ((D(d["last"]) - op) / op * 100) if op > 0 else ZERO)
    return out


def _bybit(syms: dict) -> dict:
    data = HTTP["get"]("https://api.bybit.com/v5/market/tickers", {"category": "spot"}).get("result", {}).get("list", [])
    m = {d["symbol"]: d for d in data}
    out = {}
    for aid, sym in syms.items():
        d = m.get(f"{sym}USDT")
        if d and D(d.get("lastPrice")) > 0:
            out[aid] = (D(d["lastPrice"]), D(d.get("price24hPcnt")) * 100)
    return out


def _kucoin(syms: dict) -> dict:
    data = HTTP["get"]("https://api.kucoin.com/api/v1/market/allTickers").get("data", {}).get("ticker", [])
    m = {d["symbol"]: d for d in data}
    out = {}
    for aid, sym in syms.items():
        d = m.get(f"{sym}-USDT")
        if d and D(d.get("last")) > 0:
            out[aid] = (D(d["last"]), D(d.get("changeRate")) * 100)
    return out


def _coingecko(syms: dict) -> dict:
    ids = {a["coingecko_id"]: a["id"] for a in db.q("SELECT id, coingecko_id FROM assets WHERE enabled=1 AND coingecko_id IS NOT NULL")}
    if not ids:
        return {}
    data = HTTP["get"]("https://api.coingecko.com/api/v3/simple/price",
                       {"ids": ",".join(ids), "vs_currencies": "usd", "include_24hr_change": "true"})
    usdt = D(data.get("tether", {}).get("usd"), "1") or Decimal(1)
    out = {}
    for cg, aid in ids.items():
        d = data.get(cg)
        if d and d.get("usd"):
            out[aid] = (D(d["usd"]) / usdt, D(d.get("usd_24h_change")))  # convert to USDT terms
    return out


SOURCES = {"binance": _binance, "okx": _okx, "bybit": _bybit, "kucoin": _kucoin, "coingecko": _coingecko}
MIN_INTERVAL = {"coingecko": 120}  # the public aggregator API is rate-limited; its last answer is reused in between
_CACHE: dict[str, tuple[float, dict]] = {}


def _fetch(name: str, fn, syms: dict) -> dict:
    hit = _CACHE.get(name)
    if hit and time.time() - hit[0] < MIN_INTERVAL.get(name, 0):
        return hit[1]
    res = fn(syms)
    _CACHE[name] = (time.time(), res)
    return res


def refresh() -> dict:
    cfg = settings.get("swap")
    syms = _symbols()
    per_asset: dict[str, dict] = {}
    for name in cfg.get("sources", list(SOURCES)):
        fn = SOURCES.get(name)
        if not fn:
            continue
        try:
            for aid, (price, ch) in _fetch(name, fn, syms).items():
                per_asset.setdefault(aid, {})[name] = (price, ch)
        except Exception as e:  # one source down is normal
            log.warning("price source %s failed: %s", name, e)
    now = db.now()
    with db.tx():
        for aid in syms:
            if aid in STABLE_ONE:
                db.x("INSERT INTO prices(asset, usd, change24h, sources, updated_at) VALUES(?,?,?,?,?) "
                     "ON CONFLICT(asset) DO UPDATE SET usd=excluded.usd, change24h=excluded.change24h, sources=excluded.sources, updated_at=excluded.updated_at",
                     (aid, "1", "0", '{"peg":"1"}', now))
                continue
            src = per_asset.get(aid)
            if not src:
                continue
            vals = [p for p, _ in src.values()]
            mid = statistics.median(vals)
            change = statistics.median([c for _, c in src.values()])
            db.x("INSERT INTO prices(asset, usd, change24h, sources, updated_at) VALUES(?,?,?,?,?) "
                 "ON CONFLICT(asset) DO UPDATE SET usd=excluded.usd, change24h=excluded.change24h, sources=excluded.sources, updated_at=excluded.updated_at",
                 (aid, s(mid), s(change.quantize(Decimal("0.01"))), db._enc({k: s(p) for k, (p, _) in src.items()}), now))
            bucket = now - now % 900  # 15-minute candles for sparklines
            db.x("INSERT OR REPLACE INTO price_history(asset, ts, usd) VALUES(?,?,?)", (aid, bucket, s(mid)))
        db.x("DELETE FROM price_history WHERE ts < ?", (now - 8 * 86400,))
    return {k: len(v) for k, v in per_asset.items()}


def refresh_fx():
    try:
        data = HTTP["get"]("https://open.er-api.com/v6/latest/USD")
        rates = data.get("rates") or {}
        if rates:
            settings.set_raw("fx", {"rates": {k: str(v) for k, v in rates.items()}, "updated_at": db.now()})
    except Exception as e:
        log.warning("fx refresh failed: %s", e)


def fx() -> dict:
    v = settings.raw("fx", {}) or {}
    return v.get("rates", {"USD": "1"})


def row(asset: str) -> dict | None:
    r = db.one("SELECT * FROM prices WHERE asset=?", (asset,))
    if r:
        r["sources"] = db.jl(r["sources"])
    return r


def usd(asset: str, strict: bool = False) -> Decimal:
    """Mid USD(T) price. strict=True raises when the price is missing/stale (used for swaps)."""
    r = row(asset)
    if not r:
        if strict:
            raise AppError("price_unavailable", asset=asset)
        return ZERO
    if strict:
        max_age = int(settings.get("swap").get("price_max_age_sec", 180))
        if time.time() - (r["updated_at"] or 0) > max_age:
            raise AppError("price_unavailable", asset=asset)
    return D(r["usd"])


def side_price(asset: str, side: str) -> Decimal:
    """Price used when the platform buys (`buy`: user sells asset to us) or sells (`sell`) an asset.

    best_for_platform: we buy at the lowest source price and sell at the highest — never worse than any feed.
    """
    r = row(asset)
    if asset in STABLE_ONE:
        return Decimal(1)
    if not r:
        raise AppError("price_unavailable", asset=asset)
    cfg = settings.get("swap")
    max_age = int(cfg.get("price_max_age_sec", 180))
    if time.time() - (r["updated_at"] or 0) > max_age:
        raise AppError("price_unavailable", asset=asset)
    vals = [D(v) for v in r["sources"].values() if D(v) > 0] or [D(r["usd"])]
    mid = statistics.median(vals)
    dev = (max(vals) - min(vals)) / mid * 100 if mid > 0 else ZERO
    if dev > D(cfg.get("max_source_deviation_pct", "2.5")):
        raise AppError("price_unstable", asset=asset)
    mode = cfg.get("price_mode", "best_for_platform")
    if mode == "median":
        return mid
    if mode == "best_for_user":
        return max(vals) if side == "buy" else min(vals)
    return min(vals) if side == "buy" else max(vals)


def to_usd(asset: str, amount) -> Decimal:
    return D(amount) * usd(asset)


def snapshot() -> dict:
    """Public live ticker: {asset: [usd, change24h]} plus the time of the newest price."""
    rows = db.q("SELECT p.asset, p.usd, p.change24h, p.updated_at FROM prices p JOIN assets a ON a.id=p.asset WHERE a.enabled=1")
    return {"p": {r["asset"]: [r["usd"], r["change24h"]] for r in rows}, "at": max((r["updated_at"] or 0 for r in rows), default=0)}


def history(asset: str, hours: int = 24) -> list:
    since = db.now() - hours * 3600
    return [[r["ts"], r["usd"]] for r in db.q("SELECT ts, usd FROM price_history WHERE asset=? AND ts>=? ORDER BY ts", (asset, since))]
