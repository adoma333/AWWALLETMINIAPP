"""Official coin names, logos and market data, synced once a day from CoinGecko's public API and cached locally.

* A logo is downloaded, checked by magic bytes and stored in uploads/icons; the app then serves it from our own server.
* A name follows the official one (e.g. a rebrand) only while the admin has not renamed the coin themselves.
* A logo the admin uploaded is never replaced.
Nothing here is shown to users as a source; the app only sees our own copies.
"""
import logging
import re

import httpx

from . import catalog, config, db, files

log = logging.getLogger("aw.coinmeta")
API = "https://api.coingecko.com/api/v3"
MAX_LOGO = 512 * 1024


def _get(url: str, params: dict | None = None):
    r = httpx.get(url, params=params, timeout=20, headers={"User-Agent": "zohra-wallet/1.0", "Accept": "application/json"})
    r.raise_for_status()
    return r.json()


def _download(url: str) -> bytes:
    with httpx.stream("GET", url, timeout=20, follow_redirects=True, headers={"User-Agent": "zohra-wallet/1.0"}) as r:
        r.raise_for_status()
        out = b""
        for chunk in r.iter_bytes():
            out += chunk
            if len(out) > MAX_LOGO:
                raise ValueError("logo too large")
        return out


HTTP = {"get": _get, "download": _download}
SEED_NAMES = {a[0]: a[1] for a in catalog.ASSETS}


def clean_name(name: str) -> str:
    return re.sub(r"\s*\((ex|formerly|prev\.?)[^)]*\)\s*", " ", name or "", flags=re.I).strip()


def sync() -> dict:
    rows = {r["coingecko_id"]: r for r in db.q("SELECT id, name, coingecko_id, meta FROM assets WHERE coingecko_id IS NOT NULL AND coingecko_id<>''")}
    if not rows:
        return {"updated": 0}
    data = HTTP["get"](f"{API}/coins/markets", {"vs_currency": "usd", "ids": ",".join(rows), "per_page": 250, "page": 1})
    renamed, logos = [], 0
    for d in data if isinstance(data, list) else []:
        r = rows.get(d.get("id"))
        if not r:
            continue
        aid = r["id"]
        meta = db.jl(r["meta"]) or {}
        official = clean_name(d.get("name"))
        name = r["name"]
        if official and official != name and name in (meta.get("official_name"), SEED_NAMES.get(aid)):
            name = official
            renamed.append(aid)
        meta["official_name"] = official or meta.get("official_name")
        meta["market"] = {k: str(d[k]) if isinstance(d.get(k), float) else d.get(k) for k in (
            "market_cap", "market_cap_rank", "total_volume", "high_24h", "low_24h", "ath", "ath_date", "circulating_supply",
            "total_supply", "max_supply", "price_change_percentage_24h")}
        meta["market"]["updated_at"] = db.now()
        img = d.get("image") or ""
        if img.startswith("https://"):
            try:
                logos += _logo(aid, img, meta)
            except Exception as e:  # a missing logo is never fatal
                log.warning("logo %s: %s", aid, e)
        db.x("UPDATE assets SET name=?, meta=? WHERE id=?", (name, db._enc(meta), aid))
    if renamed:
        log.info("official names updated: %s", ", ".join(renamed))
    return {"assets": len(rows), "renamed": renamed, "logos": logos}


def _logo(aid: str, url: str, meta: dict) -> int:
    key = f"asset:{aid}"
    cur = db.one("SELECT path FROM icons WHERE key=?", (key,))
    if cur and cur["path"] != meta.get("logo_path"):
        return 0  # the admin uploaded their own logo
    if cur and meta.get("logo_url") == url:
        return 0  # unchanged upstream
    path = files.save_bytes(HTTP["download"](url), "icons")  # png/jpg/webp only, verified by magic bytes
    db.x("INSERT INTO icons(key, path, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET path=excluded.path, "
         "updated_at=excluded.updated_at", (key, path, db.now()))
    meta.update({"logo_url": url, "logo_path": path})
    return 1


def backfill_daily(limit: int = 6) -> int:
    """Fill a year of daily prices for coins whose chart history is short (a few coins per run — the public API is rate-limited)."""
    import time as _t

    done = 0
    for r in db.q("SELECT id, coingecko_id FROM assets WHERE enabled=1 AND coingecko_id IS NOT NULL AND coingecko_id<>''"):
        have = db.val("SELECT COUNT(*) FROM price_daily WHERE asset=?", (r["id"],), 0)
        if have >= 300:
            continue
        data = HTTP["get"](f"{API}/coins/{r['coingecko_id']}/market_chart", {"vs_currency": "usd", "days": 365, "interval": "daily"})
        for ts, usd in (data or {}).get("prices", []):
            day = _t.strftime("%Y-%m-%d", _t.gmtime(int(ts) // 1000))
            db.x("INSERT OR IGNORE INTO price_daily(asset, day, usd) VALUES(?,?,?)", (r["id"], day, str(usd)))
        done += 1
        if done >= limit:
            break
        _t.sleep(0 if config.TESTING else 2.5)
    return done


def market(aid: str) -> dict:
    r = db.one("SELECT meta FROM assets WHERE id=?", (aid,))
    return (db.jl(r["meta"]) or {}).get("market") or {} if r else {}
