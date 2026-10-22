"""Instant swap engine.

The user gets a firm quote (valid `quote_ttl_sec`) priced from the aggregated oracle; the platform's spread is
built into the rate (resolved by the fee engine: pair/role/VIP/promo/voucher aware). Execution is an atomic ledger
move — no network fees, no slippage for the user. If the market moved against the platform by more than half the
spread since the quote, the user is asked to refresh (protects against stale-quote arbitrage).
Profit = value in − value out at mid prices, recorded in `revenue` and shared with referrers.
"""
from decimal import Decimal

from . import catalog, db, events, fees, guard, ledger, prices, settings
from .money import ZERO, AppError, D, amount_in, q_down, q_up, ref_id, s


def _assets(frm: str, to: str):
    if frm == to:
        raise AppError("same_asset")
    a, b = catalog.asset(frm), catalog.asset(to)
    for x in (a, b):
        if not x or not x["enabled"] or not x["swap_enabled"]:
            raise AppError("asset_unavailable")
    return a, b


def _rates(user: dict, frm: str, to: str):
    p_from = prices.side_price(frm, "buy")    # platform buys `frm` from the user
    p_to = prices.side_price(to, "sell")      # platform sells `to` to the user
    if p_from <= 0 or p_to <= 0:
        raise AppError("price_unavailable")
    market = p_from / p_to
    fq = fees.quote("swap", user, frm, pair=f"{frm}/{to}")
    spread = fq["pct"]
    extra_fee_pct = D(settings.get("swap").get("fee_pct", "0"))
    rate = market * (1 - spread / 100)
    return market, rate, spread, extra_fee_pct, fq


def quote(user: dict, frm: str, to: str, amount=None, amount_out=None) -> dict:
    guard.feature("swap")
    a, b = _assets(frm, to)
    cfg = settings.get("swap")
    market, rate, spread, fee_pct, fq = _rates(user, frm, to)
    if amount_out not in (None, ""):
        want = amount_in(amount_out, b["precision"])
        amt = q_up(want / (rate * (1 - fee_pct / 100)), a["precision"])
    else:
        amt = amount_in(amount, a["precision"])
    gross_out = amt * rate
    fee = q_down(gross_out * fee_pct / 100, b["precision"])
    out = q_down(gross_out - fee, b["precision"])
    if out <= 0:
        raise AppError("amount_too_small")
    usd_in = amt * prices.usd(frm)
    if usd_in < D(cfg.get("min_usd", "1")):
        raise AppError("amount_too_small", min_usd=cfg.get("min_usd", "1"))
    if usd_in > D(cfg.get("max_usd", "50000")):
        raise AppError("amount_too_large", max_usd=cfg.get("max_usd", "50000"))
    profit = usd_in - out * prices.usd(to)
    qid = ref_id("Q", 12)
    ttl = int(cfg.get("quote_ttl_sec", 20))
    db.insert("quotes", {"id": qid, "user_id": user["id"], "from_asset": frm, "to_asset": to, "amount_in": s(amt),
                         "amount_out": s(out), "rate": s(rate), "market_rate": s(market), "spread_pct": s(spread),
                         "fee": s(fee), "fee_asset": to, "profit_usd": s(profit), "expires_at": db.now() + ttl,
                         "created_at": db.now()})
    return {
        "id": qid, "from": frm, "to": to, "amount_in": s(amt), "amount_out": s(out),
        "rate": s(q_down(rate, 12)), "inverse": s(q_down(1 / rate, 12)) if rate > 0 else "0",
        "fee": s(fee), "spread_pct": s(spread.quantize(Decimal("0.0001"))), "expires_in": ttl,
        "usd": s(usd_in.quantize(Decimal("0.01"))), "vip": fq["vip"], "promo": fq["promo"], "voucher": fq["voucher"],
        "free": spread == 0 and fee == 0, "sources": _sources(frm, to),
    }


def _sources(*assets) -> int:
    """How many independent price sources agreed on this rate (shown to the user, never by name)."""
    n = []
    for a in assets:
        r = db.one("SELECT sources FROM prices WHERE asset=?", (a,))
        n.append(len(db.jl(r["sources"], {}) or {}) if r else 0)
    return min(n) if n else 0


def _daily_usd(user_id: int) -> Decimal:
    since = db.now() - 86400
    return sum((D(r["volume_usd"]) for r in db.q("SELECT volume_usd FROM swaps WHERE user_id=? AND created_at>=?", (user_id, since))), ZERO)


def _exposure_ok(asset: str, add: Decimal):
    caps = settings.get("swap").get("max_net_exposure_usd") or {}
    cap = caps.get(asset)
    if cap in (None, "", 0, "0"):
        return
    holdings = D(db.val("SELECT value FROM scan_state WHERE key=?", (f"holdings:{asset}",), "0"))
    owed = ledger.liabilities().get(asset, ZERO) + add
    if (owed - holdings) * prices.usd(asset) > D(cap):
        raise AppError("liquidity_limited", asset=asset)


def execute(user: dict, quote_id: str, idem: str | None = None) -> dict:
    guard.feature("swap")
    from . import users

    users.ensure_active(user)
    q = db.one("SELECT * FROM quotes WHERE id=?", (quote_id,))
    if not q or q["user_id"] != user["id"]:
        raise AppError("quote_not_found", 404)
    seen = guard.idem_seen(user["id"], idem)
    if seen:
        return seen
    if q["used"]:
        raise AppError("quote_used")
    if q["expires_at"] < db.now():
        raise AppError("quote_expired")
    frm, to = q["from_asset"], q["to_asset"]
    amt_in, amt_out = D(q["amount_in"]), D(q["amount_out"])
    # re-check the market: refuse if it moved against the platform by more than half the spread
    market_now, _, _, _, fq = _rates(user, frm, to)
    tolerance = max(D(q["spread_pct"]) / 2, Decimal("0.05")) / 100
    if market_now < D(q["market_rate"]) * (1 - tolerance):
        raise AppError("quote_expired")
    cfg = settings.get("swap")
    usd_in = amt_in * prices.usd(frm)
    if _daily_usd(user["id"]) + usd_in > D(cfg.get("daily_user_usd", "200000")):
        raise AppError("limit_daily")
    if cfg.get("inventory_guard"):
        _exposure_ok(to, amt_out)
    with db.tx():
        seen = guard.idem_seen(user["id"], idem)
        if seen:
            return seen
        n = db.x("UPDATE quotes SET used=1 WHERE id=? AND used=0", (quote_id,)).rowcount
        if n != 1:
            raise AppError("quote_used")
        sid = ref_id("SW", 10)
        txid = ledger.add_tx(user["id"], "swap", frm, amt_in, asset2=to, amount2=amt_out, fee=D(q["fee"]), fee_asset=to,
                             usd_value=usd_in, ref=sid, meta={"rate": q["rate"], "spread_pct": q["spread_pct"]})
        ledger.debit(user["id"], frm, amt_in, "swap_out", txid)
        ledger.credit(user["id"], to, amt_out, "swap_in", txid)
        profit = D(q["profit_usd"])
        db.insert("swaps", {"id": sid, "user_id": user["id"], "from_asset": frm, "to_asset": to, "amount_in": s(amt_in),
                            "amount_out": s(amt_out), "rate": q["rate"], "market_rate": q["market_rate"],
                            "spread_pct": q["spread_pct"], "fee": q["fee"], "fee_asset": to, "profit_usd": s(profit),
                            "volume_usd": s(usd_in), "created_at": db.now()})
        if profit > 0:
            ledger.add_revenue("swap_spread", txid, user["id"], "USD", profit, profit)
        if fq.get("voucher"):
            fees.consume_voucher(fq["voucher"]["id"])
        result = {"id": txid, "from": frm, "to": to, "amount_in": s(amt_in), "amount_out": s(amt_out), "rate": q["rate"]}
        guard.idem_store(user["id"], idem, result)
    events.emit("swap", user["id"], ref=txid, usd=usd_in)
    if profit > 0:
        events.emit("fee", user["id"], source="swap_spread", ref=txid, usd=profit)
    return result


def pairs() -> list[dict]:
    rows = db.q("SELECT a.id, a.name, a.display, a.precision, p.usd, p.change24h FROM assets a LEFT JOIN prices p ON p.asset=a.id "
                "WHERE a.enabled=1 AND a.swap_enabled=1 ORDER BY a.sort")
    return [{"asset": r["id"], "name": r["name"], "precision": r["precision"], "display": r["display"],
             "usd": r["usd"] or "0", "change24h": r["change24h"] or "0"} for r in rows]
