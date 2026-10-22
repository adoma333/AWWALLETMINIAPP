"""Earn: flexible and fixed-term savings products, fully controlled from the admin panel (settings section `earn`).

A subscription moves the principal from `available` to `locked` (the coins never leave the user's balance sheet)
and records an `earn_positions` row. Interest accrues once a day at the product's APY and is credited to
`available`; the cost is booked as negative revenue so the admin P&L stays honest. Flexible positions can be
redeemed any time; fixed-term positions are returned automatically at maturity.
"""
from decimal import Decimal

from . import catalog, db, events, guard, ledger, prices, settings, users
from .money import ZERO, AppError, D, amount_in, q_down, ref_id, s

DAY = 86400


def products() -> list[dict]:
    out = []
    for p in settings.get("earn").get("products") or []:
        a = catalog.asset(p.get("asset", ""))
        if not p.get("enabled", True) or not a or not a["enabled"]:
            continue
        out.append({"id": str(p["id"]), "asset": a["id"], "name": a["name"], "apy": str(p.get("apy", "0")),
                    "term_days": int(p.get("term_days") or 0), "min": str(p.get("min", "0")),
                    "max_user": str(p.get("max_user", "0")), "hot": bool(p.get("hot"))})
    return out


def product(pid: str) -> dict:
    p = next((x for x in products() if x["id"] == pid), None)
    if not p:
        raise AppError("product_unavailable", 404)
    return p


def top_rates() -> dict:
    """Best APY per asset (shown on the coin page and on the home story)."""
    best: dict[str, str] = {}
    for p in products():
        if D(p["apy"]) > D(best.get(p["asset"], "0")):
            best[p["asset"]] = p["apy"]
    return best


def _pos_out(r: dict) -> dict:
    return {"id": r["id"], "product": r["product_id"], "asset": r["asset"], "amount": r["principal"], "apy": r["apy"],
            "term_days": r["term_days"], "earned": r["earned"], "status": r["status"], "started_at": r["created_at"],
            "ends_at": r["ends_at"], "daily": s(q_down(D(r["principal"]) * D(r["apy"]) / 100 / 365, 8))}


def positions(user_id: int) -> list[dict]:
    return [_pos_out(r) for r in db.q("SELECT * FROM earn_positions WHERE user_id=? AND status='active' ORDER BY created_at DESC", (user_id,))]


def overview(user: dict) -> dict:
    pos = positions(user["id"])
    total = sum((prices.to_usd(p["asset"], D(p["amount"])) or ZERO for p in pos), ZERO)
    earned = sum((prices.to_usd(r["asset"], D(r["amount"])) or ZERO
                  for r in db.q("SELECT asset, amount FROM txs WHERE user_id=? AND type='earn_interest'", (user["id"],))), ZERO)
    daily = sum((prices.to_usd(p["asset"], D(p["daily"])) or ZERO for p in pos), ZERO)
    return {"products": products(), "positions": pos, "total_usd": s(total.quantize(Decimal("0.01"))),
            "earned_usd": s(earned.quantize(Decimal("0.01"))), "daily_usd": s(daily.quantize(Decimal("0.0001")))}


def subscribe(user: dict, pid: str, amount, pin: str | None = None, bio: str | None = None, idem: str | None = None) -> dict:
    guard.feature("earn")
    users.ensure_active(user)
    p = product(pid)
    a = catalog.asset(p["asset"])
    amt = amount_in(amount, a["precision"])
    if amt < D(p["min"]):
        raise AppError("amount_too_small", min=p["min"])
    held = sum((D(r["principal"]) for r in db.q("SELECT principal FROM earn_positions WHERE user_id=? AND product_id=? AND status='active'",
                                                   (user["id"], pid))), ZERO)
    if D(p["max_user"]) > 0 and held + amt > D(p["max_user"]):
        raise AppError("amount_too_large", max=p["max_user"])
    guard.confirm(user, "earn", pin, bio, usd=prices.to_usd(p["asset"], amt) or ZERO)
    with db.tx():
        seen = guard.idem_seen(user["id"], idem)
        if seen:
            return seen
        pos = ref_id("ER", 10)
        ledger.lock(user["id"], p["asset"], amt, "earn_in", pos)
        now = db.now()
        db.insert("earn_positions", {"id": pos, "user_id": user["id"], "product_id": pid, "asset": p["asset"], "principal": s(amt),
                                     "apy": p["apy"], "term_days": p["term_days"], "earned": "0", "status": "active",
                                     "created_at": now, "accrued_at": now, "ends_at": now + p["term_days"] * DAY if p["term_days"] else None})
        ledger.add_tx(user["id"], "earn_in", p["asset"], amt, ref=pos, usd_value=prices.to_usd(p["asset"], amt),
                      meta={"apy": p["apy"], "term_days": p["term_days"]})
        result = {"id": pos, "asset": p["asset"], "amount": s(amt), "apy": p["apy"]}
        guard.idem_store(user["id"], idem, result)
    events.emit("earn", user["id"], ref=pos, usd=prices.to_usd(p["asset"], amt))
    return result


def redeem(user: dict, pos_id: str, amount=None) -> dict:
    r = db.one("SELECT * FROM earn_positions WHERE id=? AND user_id=? AND status='active'", (pos_id, user["id"]))
    if not r:
        raise AppError("not_found", 404)
    if r["term_days"] and r["ends_at"] and r["ends_at"] > db.now():
        raise AppError("earn_locked_term", until=r["ends_at"])
    principal = D(r["principal"])
    amt = principal if amount in (None, "") else min(principal, amount_in(amount, (catalog.asset(r["asset"]) or {}).get("precision", 8)))
    _accrue_one(r)
    with db.tx():
        ledger.unlock(user["id"], r["asset"], amt, "earn_out", pos_id)
        left = principal - amt
        db.update("earn_positions", {"id": pos_id}, {"principal": s(left), "status": "active" if left > 0 else "redeemed"})
        ledger.add_tx(user["id"], "earn_out", r["asset"], amt, ref=pos_id, usd_value=prices.to_usd(r["asset"], amt))
    return {"id": pos_id, "asset": r["asset"], "amount": s(amt)}


def _accrue_one(r: dict) -> Decimal:
    """Credit whole days of interest since the last accrual. Idempotent per day (accrued_at only moves forward)."""
    now = db.now()
    end = min(now, r["ends_at"]) if r["ends_at"] else now
    days = (end - (r["accrued_at"] or r["created_at"])) // DAY
    if days <= 0:
        return ZERO
    a = catalog.asset(r["asset"])
    interest = q_down(D(r["principal"]) * D(r["apy"]) / 100 / 365 * days, a["precision"] if a else 8)
    with db.tx():
        n = db.x("UPDATE earn_positions SET accrued_at=?, earned=? WHERE id=? AND accrued_at=?",
                 ((r["accrued_at"] or r["created_at"]) + days * DAY, s(D(r["earned"]) + interest), r["id"], r["accrued_at"])).rowcount
        if n != 1 or interest <= 0:
            return ZERO
        ledger.credit(r["user_id"], r["asset"], interest, "earn_interest", r["id"])
        usd = prices.to_usd(r["asset"], interest) or ZERO
        ledger.add_tx(r["user_id"], "earn_interest", r["asset"], interest, ref=r["id"], usd_value=usd, meta={"apy": r["apy"], "days": days})
        ledger.add_revenue("earn_interest", r["id"], r["user_id"], r["asset"], -interest, -usd)
    return interest


def accrue_all() -> int:
    """Worker job: pay daily interest and return matured fixed-term positions."""
    n = 0
    for r in db.q("SELECT * FROM earn_positions WHERE status='active' AND accrued_at<=?", (db.now() - DAY,)):
        if _accrue_one(r) > 0:
            n += 1
    for r in db.q("SELECT * FROM earn_positions WHERE status='active' AND ends_at IS NOT NULL AND ends_at<=?", (db.now(),)):
        _accrue_one(db.one("SELECT * FROM earn_positions WHERE id=?", (r["id"],)))
        with db.tx():
            if db.x("UPDATE earn_positions SET status='matured' WHERE id=? AND status='active'", (r["id"],)).rowcount == 1:
                ledger.unlock(r["user_id"], r["asset"], D(r["principal"]), "earn_out", r["id"])
                ledger.add_tx(r["user_id"], "earn_out", r["asset"], D(r["principal"]), ref=r["id"],
                              usd_value=prices.to_usd(r["asset"], D(r["principal"])))
        from .notify import notify

        fresh = db.one("SELECT earned FROM earn_positions WHERE id=?", (r["id"],))
        notify(r["user_id"], "earn_matured", path="/earn", amount=r["principal"], asset=r["asset"], earned=fresh["earned"])
    return n


def earning_by_asset(user_id: int) -> dict[str, Decimal]:
    out: dict[str, Decimal] = {}
    for r in db.q("SELECT asset, principal FROM earn_positions WHERE user_id=? AND status='active'", (user_id,)):
        out[r["asset"]] = out.get(r["asset"], ZERO) + D(r["principal"])
    return out
