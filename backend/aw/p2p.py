"""P2P marketplace with escrow — the model used by the large exchanges.

Ads
  • sell ad: the advertiser sells crypto; the full amount (+ maker fee reserve) is locked in escrow when posting.
  • buy ad: the advertiser buys crypto; the seller (taker) locks crypto when opening an order.
  • fixed price or floating (market ± margin), per-order fiat limits, payment methods, payment window,
    optional terms + auto-reply, and counter-party conditions set by the advertiser (verification level,
    completed orders, account age) — all switchable by the admin.
Orders: pending → paid (buyer clicked "I have paid") → completed (seller released, PIN required)
        pending → cancelled/expired (escrow returns)        paid → appeal → resolved by an arbiter
Fees are taken in crypto from escrow (seller side) or from what the buyer receives, per maker/taker rule.
"""
from decimal import Decimal

from . import catalog, db, events, fees, guard, ledger, prices, settings, users
from .money import ZERO, AppError, D, amount_in, q_down, q_up, ref_id, s
from .notify import admin_alert, notify
from .security import seal, unseal

FIAT_Q = Decimal("0.01")


def _cfg() -> dict:
    return settings.get("p2p")


def fiat_rate(fiat: str) -> Decimal:
    from .prices import fx

    r = fx().get(fiat.upper())
    return D(r) if r else ZERO


def market_price(asset: str, fiat: str) -> Decimal:
    """Reference price of 1 asset in fiat (oracle USD × FX)."""
    rate = Decimal(1) if fiat.upper() == "USD" else fiat_rate(fiat)
    return prices.usd(asset) * rate


def ad_price(ad: dict) -> Decimal:
    if ad["price_type"] == "float":
        return (market_price(ad["asset"], ad["fiat"]) * (1 + D(ad["margin_pct"]) / 100)).quantize(Decimal("0.0001"))
    return D(ad["price"])


# ───────────────────────── payment methods ─────────────────────────
def methods(fiat: str | None = None) -> list[dict]:
    out = []
    for m in db.q("SELECT * FROM p2p_methods WHERE enabled=1 ORDER BY sort"):
        cur = db.jl(m["currencies"], [])
        if fiat and cur and fiat.upper() not in cur:
            continue
        out.append({"id": m["id"], "name": m["name"], "type": m["type"], "icon": m["icon"], "color": m["color"],
                    "fields": db.jl(m["fields"], []), "currencies": cur})
    return out


def my_methods(user_id: int, reveal: bool = True) -> list[dict]:
    out = []
    for r in db.q("SELECT * FROM p2p_user_methods WHERE user_id=? ORDER BY id DESC", (user_id,)):
        data = db.jl(unseal(r["data"])) if reveal else {}
        out.append({"id": r["id"], "method_id": r["method_id"], "label": r["label"], "data": data})
    return out


def save_method(user: dict, method_id: str, data: dict, label: str | None = None, mid: int | None = None) -> dict:
    m = db.one("SELECT * FROM p2p_methods WHERE id=? AND enabled=1", (method_id,))
    if not m:
        raise AppError("method_unavailable")
    fields = db.jl(m["fields"], [])
    clean = {k: str(v)[:120] for k, v in (data or {}).items() if k in fields and str(v).strip()}
    if not clean:
        raise AppError("method_details_required")
    payload = seal(db._enc(clean))
    if mid:
        n = db.x("UPDATE p2p_user_methods SET data=?, label=?, method_id=? WHERE id=? AND user_id=?", (payload, label, method_id, mid, user["id"])).rowcount
        if n != 1:
            raise AppError("not_found", 404)
        return {"id": mid}
    if db.val("SELECT COUNT(*) FROM p2p_user_methods WHERE user_id=?", (user["id"],), 0) >= 20:
        raise AppError("too_many")
    return {"id": db.insert("p2p_user_methods", {"user_id": user["id"], "method_id": method_id, "label": (label or "")[:40],
                                                  "data": payload, "created_at": db.now()})}


def delete_method(user: dict, mid: int):
    db.x("DELETE FROM p2p_user_methods WHERE id=? AND user_id=?", (mid, user["id"]))


# ───────────────────────── merchant stats ─────────────────────────
def stats(uid: int) -> dict:
    since = db.now() - 30 * 86400
    done = db.val("SELECT COUNT(*) FROM p2p_orders WHERE (buyer_id=? OR seller_id=?) AND status='completed'", (uid, uid), 0)
    done30 = db.val("SELECT COUNT(*) FROM p2p_orders WHERE (buyer_id=? OR seller_id=?) AND status='completed' AND done_at>=?", (uid, uid, since), 0)
    total30 = db.val("SELECT COUNT(*) FROM p2p_orders WHERE (buyer_id=? OR seller_id=?) AND created_at>=? AND status IN ('completed','cancelled','expired')",
                     (uid, uid, since), 0)
    rel = db.q("SELECT done_at - paid_at AS t FROM p2p_orders WHERE seller_id=? AND status='completed' AND paid_at IS NOT NULL ORDER BY done_at DESC LIMIT 50", (uid,))
    avg_release = int(sum(r["t"] for r in rel) / len(rel)) if rel else None
    pos = db.val("SELECT COUNT(*) FROM p2p_reviews WHERE to_id=? AND positive=1", (uid,), 0)
    neg = db.val("SELECT COUNT(*) FROM p2p_reviews WHERE to_id=? AND positive=0", (uid,), 0)
    return {"orders": done, "orders_30d": done30, "completion_pct": round(done30 / total30 * 100, 1) if total30 else None,
            "avg_release_sec": avg_release, "positive": pos, "negative": neg,
            "positive_pct": round(pos / (pos + neg) * 100, 1) if pos + neg else None}


def profile(uid: int) -> dict:
    u = users.must(uid)
    out = users.public(u)
    out.update({"stats": stats(uid), "joined": u["created_at"], "kyc_level": u["kyc_level"]})
    return out


# ───────────────────────── ads ─────────────────────────
def _check_conditions(ad: dict, taker: dict):
    c = db.jl(ad.get("conditions"))
    if not c:
        return
    if int(c.get("min_kyc", 0)) > (taker.get("kyc_level") or 0):
        raise AppError("p2p_condition_kyc")
    if int(c.get("min_orders", 0)) > stats(taker["id"])["orders"]:
        raise AppError("p2p_condition_orders", n=c.get("min_orders"))
    if int(c.get("min_age_days", 0)) * 86400 > db.now() - (taker.get("created_at") or db.now()):
        raise AppError("p2p_condition_age", n=c.get("min_age_days"))


def create_ad(user: dict, data: dict) -> dict:
    guard.feature("p2p")
    users.ensure_active(user)
    cfg = _cfg()
    if (user.get("kyc_level") or 0) < int(cfg.get("min_kyc_to_post", 1)):
        raise AppError("p2p_kyc_required")
    side = data.get("side")
    asset = (data.get("asset") or "").upper()
    fiat = (data.get("fiat") or "").upper()
    if side not in ("buy", "sell") or asset not in cfg.get("assets", []) or fiat not in cfg.get("fiats", []):
        raise AppError("bad_request")
    a = catalog.asset(asset)
    if not a or not a["enabled"] or not a["p2p_enabled"]:
        raise AppError("asset_unavailable")
    total = amount_in(data.get("total"), a["precision"])
    price_type = data.get("price_type", "fixed")
    market = market_price(asset, fiat)
    band = D(cfg.get("price_guard_pct", "0"))  # 0 = sellers set any price they like (admin can add a band)
    if price_type == "float":
        margin = D(data.get("margin_pct", "0"))
        if band > 0 and abs(margin) > band:
            raise AppError("p2p_price_out_of_range")
        price = None
    else:
        price_type = "fixed"
        price = D(data.get("price"))
        if price <= 0:
            raise AppError("bad_price")
        if band > 0 and market > 0 and abs(price / market - 1) * 100 > band:
            raise AppError("p2p_price_out_of_range")
        margin = None
    mn, mx = D(data.get("min_fiat")), D(data.get("max_fiat"))
    if mn <= 0 or mx < mn:
        raise AppError("bad_limits")
    meths = [m for m in (data.get("methods") or []) if db.one("SELECT 1 FROM p2p_methods WHERE id=? AND enabled=1", (m,))][:5]
    if not meths:
        raise AppError("method_required")
    user_methods = []
    if side == "sell":  # the advertiser receives fiat → their payment details are required for each method
        mine = {m["method_id"]: m["id"] for m in my_methods(user["id"], reveal=False)}
        for m in meths:
            if m not in mine:
                raise AppError("method_details_required", method=m)
            user_methods.append(mine[m])
    window = int(data.get("window_min") or 15)
    if window not in cfg.get("payment_windows", [15, 30, 45, 60]):
        window = 15
    terms = (data.get("terms") or "").strip()[:800] if cfg.get("allow_terms", True) else ""
    auto_reply = (data.get("auto_reply") or "").strip()[:400]
    cond = data.get("conditions") or {}
    conditions = {k: int(cond[k]) for k in ("min_kyc", "min_orders", "min_age_days") if str(cond.get(k, "")).isdigit()}
    fee_pct = fees.quote("p2p_maker", user, asset, use_voucher=False)["pct"]
    with db.tx():
        aid = ref_id("AD", 8)
        if side == "sell":
            ledger.lock(user["id"], asset, total + q_up(total * fee_pct / 100, a["precision"]), "p2p_ad_lock", aid)
        db.insert("p2p_ads", {"id": aid, "user_id": user["id"], "side": side, "asset": asset, "fiat": fiat, "price_type": price_type,
                              "price": s(price) if price is not None else None, "margin_pct": s(margin) if margin is not None else None,
                              "total": s(total), "remaining": s(total), "min_fiat": s(mn), "max_fiat": s(mx), "methods": meths,
                              "user_methods": user_methods, "window_min": window, "terms": terms or None, "auto_reply": auto_reply or None,
                              "conditions": conditions, "fee_pct": s(fee_pct), "status": "online", "created_at": db.now(), "updated_at": db.now()})
    return get_ad(aid)


def _ad_reserve(ad: dict, amount: Decimal) -> Decimal:
    prec = catalog.asset(ad["asset"])["precision"]
    return amount + q_up(amount * D(ad.get("fee_pct") or 0) / 100, prec)


def set_ad_status(user: dict, aid: str, status: str) -> dict:
    if status not in ("online", "offline", "closed"):
        raise AppError("bad_request")
    with db.tx():
        ad = db.one("SELECT * FROM p2p_ads WHERE id=? AND user_id=?", (aid, user["id"]))
        if not ad or ad["status"] in ("closed",):
            raise AppError("not_found", 404)
        if ad["status"] == "blocked" and status == "online":
            raise AppError("p2p_ad_blocked")
        if status == "closed":
            if db.one("SELECT 1 FROM p2p_orders WHERE ad_id=? AND status IN ('pending','paid','appeal')", (aid,)):
                raise AppError("p2p_open_orders")
            if ad["side"] == "sell" and D(ad["remaining"]) > 0:
                ledger.unlock(user["id"], ad["asset"], _ad_reserve(ad, D(ad["remaining"])), "p2p_ad_unlock", aid)
            db.update("p2p_ads", {"id": aid}, {"status": "closed", "remaining": "0", "updated_at": db.now()})
        else:
            db.update("p2p_ads", {"id": aid}, {"status": status, "updated_at": db.now()})
    return get_ad(aid)


def get_ad(aid: str, viewer: dict | None = None) -> dict:
    ad = db.one("SELECT * FROM p2p_ads WHERE id=?", (aid,))
    if not ad:
        raise AppError("not_found", 404)
    return _ad_out(ad)


def _ad_out(ad: dict) -> dict:
    maker = users.get(ad["user_id"])
    price = ad_price(ad)
    remaining = D(ad["remaining"])
    max_fiat = min(D(ad["max_fiat"]), (remaining * price).quantize(FIAT_Q))
    return {"id": ad["id"], "side": ad["side"], "asset": ad["asset"], "fiat": ad["fiat"], "price": s(price), "price_type": ad["price_type"],
            "margin_pct": ad["margin_pct"], "total": ad["total"], "remaining": ad["remaining"], "min_fiat": ad["min_fiat"],
            "max_fiat": s(max_fiat), "methods": db.jl(ad["methods"], []), "window_min": ad["window_min"], "terms": ad["terms"],
            "conditions": db.jl(ad["conditions"]), "status": ad["status"], "created_at": ad["created_at"],
            "maker": dict(users.public(maker), stats=stats(maker["id"])) if maker else None}


def market(asset: str, fiat: str, side: str, method: str | None = None, amount_fiat=None, viewer: dict | None = None,
           merchants_only: bool = False, limit: int = 50) -> list[dict]:
    """side = what the viewer wants to do: 'buy' shows sell ads (cheapest first), 'sell' shows buy ads (highest first)."""
    ad_side = "sell" if side == "buy" else "buy"
    rows = db.q("SELECT a.* FROM p2p_ads a JOIN users u ON u.id=a.user_id WHERE a.asset=? AND a.fiat=? AND a.side=? AND a.status='online' "
                "AND u.status='active' AND CAST(a.remaining AS REAL) > 0", (asset.upper(), fiat.upper(), ad_side))
    out = []
    amt = D(amount_fiat) if amount_fiat not in (None, "") else None
    for ad in rows:
        if viewer and ad["user_id"] == viewer["id"]:
            continue
        if method and method not in db.jl(ad["methods"], []):
            continue
        o = _ad_out(ad)
        if D(o["max_fiat"]) < D(o["min_fiat"]):
            continue
        if amt is not None and not (D(o["min_fiat"]) <= amt <= D(o["max_fiat"])):
            continue
        if merchants_only and not (o["maker"] or {}).get("merchant"):
            continue
        out.append(o)
    out.sort(key=lambda o: D(o["price"]), reverse=(ad_side == "buy"))
    return out[:limit]


def my_ads(user_id: int) -> list[dict]:
    return [_ad_out(a) for a in db.q("SELECT * FROM p2p_ads WHERE user_id=? AND status<>'closed' ORDER BY created_at DESC", (user_id,))]


# ───────────────────────── orders ─────────────────────────
def _sys(order_id: str, text: str):
    db.insert("p2p_messages", {"order_id": order_id, "sender_id": 0, "text": text, "created_at": db.now()})


def create_order(taker: dict, aid: str, fiat_amount, method_id: str | None = None, user_method_id: int | None = None,
                 idem: str | None = None) -> dict:
    guard.feature("p2p")
    users.ensure_active(taker)
    cfg = _cfg()
    if cfg.get("require_phone_for_p2p") and (taker.get("kyc_level") or 0) < 1:
        raise AppError("phone_required")
    ban = (taker.get("flags") or {}).get("p2p_ban_until", 0)
    if ban and ban > db.now():
        raise AppError("p2p_banned", until=ban)
    open_n = db.val("SELECT COUNT(*) FROM p2p_orders WHERE (buyer_id=? OR seller_id=?) AND status IN ('pending','paid','appeal')",
                    (taker["id"], taker["id"]), 0)
    if open_n >= int(cfg.get("max_open_orders", 5)):
        raise AppError("p2p_too_many_orders")
    fiat_amount = D(fiat_amount).quantize(FIAT_Q)
    with db.tx():
        seen = guard.idem_seen(taker["id"], idem)
        if seen:
            return seen
        ad = db.one("SELECT * FROM p2p_ads WHERE id=?", (aid,))
        if not ad or ad["status"] != "online":
            raise AppError("p2p_ad_unavailable")
        if ad["user_id"] == taker["id"]:
            raise AppError("p2p_own_ad")
        _check_conditions(ad, taker)
        a = catalog.asset(ad["asset"])
        price = ad_price(ad)
        if fiat_amount < D(ad["min_fiat"]) or fiat_amount > D(ad["max_fiat"]):
            raise AppError("p2p_amount_out_of_limits")
        amount = q_down(fiat_amount / price, a["precision"])
        if amount <= 0 or amount > D(ad["remaining"]):
            raise AppError("p2p_amount_out_of_limits")
        meths = db.jl(ad["methods"], [])
        method_id = method_id if method_id in meths else (meths[0] if len(meths) == 1 else None)
        if not method_id:
            raise AppError("method_required")
        maker = users.must(ad["user_id"])
        if ad["side"] == "sell":
            seller, buyer = maker, taker
            ums = db.jl(ad["user_methods"], [])
            pm = next((m for m in my_methods(maker["id"]) if m["method_id"] == method_id and m["id"] in ums), None)
        else:
            seller, buyer = taker, maker
            pm = next((m for m in my_methods(taker["id"]) if m["id"] == user_method_id and m["method_id"] == method_id), None) if user_method_id \
                else next((m for m in my_methods(taker["id"]) if m["method_id"] == method_id), None)
        if not pm:
            raise AppError("method_details_required", method=method_id)
        usd = prices.to_usd(ad["asset"], amount)
        guard.check_limit(taker, "p2p", usd)
        maker_fee = q_down(amount * D(ad.get("fee_pct") or 0) / 100, a["precision"])  # rounds down: never exceeds the ad reserve
        tq = fees.quote("p2p_taker", taker, ad["asset"], amount)
        taker_fee = q_up(tq["fee"] or ZERO, a["precision"])
        seller_fee = maker_fee if maker["id"] == seller["id"] else taker_fee
        buyer_fee = maker_fee if maker["id"] == buyer["id"] else taker_fee
        oid = ref_id("P2", 9)
        if ad["side"] == "sell":
            # escrow comes from the ad's locked pool (amount + maker fee reserve already locked)
            pass
        else:
            ledger.lock(seller["id"], ad["asset"], amount + seller_fee, "p2p_escrow", oid)
        db.x("UPDATE p2p_ads SET remaining=?, updated_at=? WHERE id=?", (s(D(ad["remaining"]) - amount), db.now(), aid))
        method = db.one("SELECT name FROM p2p_methods WHERE id=?", (method_id,))
        db.insert("p2p_orders", {
            "id": oid, "ad_id": aid, "maker_id": maker["id"], "taker_id": taker["id"], "buyer_id": buyer["id"], "seller_id": seller["id"],
            "asset": ad["asset"], "fiat": ad["fiat"], "price": s(price), "amount": s(amount), "fiat_amount": s(fiat_amount),
            "fee": s(maker_fee + taker_fee), "seller_fee": s(seller_fee), "buyer_fee": s(buyer_fee), "method_id": method_id,
            "payment": seal(db._enc({"method": method["name"] if method else method_id, "label": pm["label"], "data": pm["data"]})),
            "status": "pending", "expires_at": db.now() + int(ad["window_min"]) * 60, "created_at": db.now(),
        })
        _sys(oid, "order_created")
        if ad["auto_reply"]:
            db.insert("p2p_messages", {"order_id": oid, "sender_id": maker["id"], "text": ad["auto_reply"], "created_at": db.now()})
        if tq.get("voucher"):
            fees.consume_voucher(tq["voucher"]["id"])
        result = {"id": oid}
        guard.idem_store(taker["id"], idem, result)
    notify(maker["id"], "p2p_new_order", path=f"/p2p/order/{oid}", id=oid, amount=s(amount), asset=ad["asset"], fiat_amount=s(fiat_amount), fiat=ad["fiat"])
    return get_order(taker, oid)


def _order(oid: str, user: dict | None, admin: bool = False) -> dict:
    o = db.one("SELECT * FROM p2p_orders WHERE id=?", (oid,))
    if not o:
        raise AppError("not_found", 404)
    if not admin and user and user["id"] not in (o["buyer_id"], o["seller_id"]):
        raise AppError("not_found", 404)
    return o


def get_order(user: dict | None, oid: str, admin: bool = False) -> dict:
    o = _order(oid, user, admin)
    me = user["id"] if user else None
    buyer, seller = users.get(o["buyer_id"]), users.get(o["seller_id"])
    ad = db.one("SELECT terms, window_min FROM p2p_ads WHERE id=?", (o["ad_id"],)) or {}
    pay = db.jl(unseal(o["payment"])) if o["payment"] else {}
    # payment details are shown to the buyer (who must pay) and to the seller (own details) and arbiters
    disp = db.one("SELECT * FROM p2p_disputes WHERE order_id=?", (oid,))
    return {
        "id": o["id"], "ad_id": o["ad_id"], "asset": o["asset"], "fiat": o["fiat"], "price": o["price"], "amount": o["amount"],
        "fiat_amount": o["fiat_amount"], "status": o["status"], "expires_at": o["expires_at"], "paid_at": o["paid_at"],
        "done_at": o["done_at"], "created_at": o["created_at"], "cancel_reason": o["cancel_reason"],
        "role": "buyer" if me == o["buyer_id"] else ("seller" if me == o["seller_id"] else "arbiter"),
        "buyer": users.public(buyer) if buyer else None, "seller": users.public(seller) if seller else None,
        "payment": pay, "terms": ad.get("terms"), "receive": s(D(o["amount"]) - D(o["buyer_fee"] or 0)),
        "seller_fee": o["seller_fee"], "buyer_fee": o["buyer_fee"],
        "appeal_after": (o["paid_at"] or 0) + int(_cfg().get("appeal_after_min", 10)) * 60 if o["paid_at"] else None,
        "dispute": {"status": disp["status"], "reason": disp["reason"], "resolution": disp["resolution"], "opened_by": disp["opened_by"]} if disp else None,
        "reviewed": bool(me and db.one("SELECT 1 FROM p2p_reviews WHERE order_id=? AND from_id=?", (oid, me))),
    }


def mark_paid(user: dict, oid: str) -> dict:
    with db.tx():
        o = _order(oid, user)
        if user["id"] != o["buyer_id"]:
            raise AppError("forbidden", 403)
        n = db.x("UPDATE p2p_orders SET status='paid', paid_at=? WHERE id=? AND status='pending' AND expires_at>?", (db.now(), oid, db.now())).rowcount
        if n != 1:
            raise AppError("bad_state")
        _sys(oid, "buyer_paid")
    notify(o["seller_id"], "p2p_paid", path=f"/p2p/order/{oid}", id=oid, fiat_amount=o["fiat_amount"], fiat=o["fiat"], priority=1)
    return get_order(user, oid)


def release(user: dict, oid: str, pin: str | None = None, bio: str | None = None) -> dict:
    o = _order(oid, user)
    if user["id"] != o["seller_id"]:
        raise AppError("forbidden", 403)
    guard.confirm(user, "p2p_release", pin, bio)
    with db.tx():
        o = _order(oid, user)
        if o["status"] not in ("paid", "pending", "appeal"):
            raise AppError("bad_state")
        _complete(o)
        _sys(oid, "released")
    _after_complete(o)
    return get_order(user, oid)


def _complete(o: dict):
    n = db.x("UPDATE p2p_orders SET status='completed', done_at=? WHERE id=? AND status IN ('pending','paid','appeal')", (db.now(), o["id"])).rowcount
    if n != 1:
        raise AppError("bad_state")
    amount, sf, bf = D(o["amount"]), D(o["seller_fee"] or 0), D(o["buyer_fee"] or 0)
    ledger.spend_locked(o["seller_id"], o["asset"], amount + sf, "p2p_release", o["id"])
    ledger.credit(o["buyer_id"], o["asset"], amount - bf, "p2p_receive", o["id"])
    usd = prices.to_usd(o["asset"], amount)
    ledger.add_tx(o["seller_id"], "p2p_sell", o["asset"], amount, fee=sf, fee_asset=o["asset"], counterparty=o["buyer_id"], ref=o["id"],
                  usd_value=usd, meta={"fiat": o["fiat"], "fiat_amount": o["fiat_amount"], "price": o["price"]})
    ledger.add_tx(o["buyer_id"], "p2p_buy", o["asset"], amount - bf, fee=bf, fee_asset=o["asset"], counterparty=o["seller_id"], ref=o["id"],
                  usd_value=usd, meta={"fiat": o["fiat"], "fiat_amount": o["fiat_amount"], "price": o["price"]})
    if sf + bf > 0:
        ledger.add_revenue("p2p_fee", o["id"], o["maker_id"], o["asset"], sf + bf, prices.to_usd(o["asset"], sf + bf))


def _after_complete(o: dict):
    notify(o["buyer_id"], "p2p_released", path=f"/p2p/order/{o['id']}", id=o["id"], amount=s(D(o["amount"]) - D(o["buyer_fee"] or 0)), asset=o["asset"])
    notify(o["seller_id"], "p2p_completed_seller", path=f"/p2p/order/{o['id']}", id=o["id"], amount=o["amount"], asset=o["asset"])
    usd = prices.to_usd(o["asset"], D(o["amount"]))
    for uid in (o["buyer_id"], o["seller_id"]):
        events.emit("p2p_completed", uid, ref=o["id"], usd=usd)
    fee_usd = prices.to_usd(o["asset"], D(o["seller_fee"] or 0) + D(o["buyer_fee"] or 0))
    if fee_usd > 0:
        events.emit("fee", o["maker_id"], source="p2p_fee", ref=o["id"], usd=fee_usd)


def _return_escrow(o: dict):
    """Cancelled/expired order: crypto goes back to the ad pool (sell ad) or to the taker-seller."""
    ad = db.one("SELECT * FROM p2p_ads WHERE id=?", (o["ad_id"],))
    amount = D(o["amount"])
    if ad and ad["side"] == "sell":
        if ad["status"] == "closed":
            ledger.unlock(o["seller_id"], o["asset"], amount + D(o["seller_fee"] or 0), "p2p_escrow_return", o["id"])
        else:
            db.x("UPDATE p2p_ads SET remaining=?, updated_at=? WHERE id=?", (s(D(ad["remaining"]) + amount), db.now(), ad["id"]))
    else:
        ledger.unlock(o["seller_id"], o["asset"], amount + D(o["seller_fee"] or 0), "p2p_escrow_return", o["id"])
        if ad and ad["status"] != "closed":
            db.x("UPDATE p2p_ads SET remaining=?, updated_at=? WHERE id=?", (s(D(ad["remaining"]) + amount), db.now(), ad["id"]))


def cancel(user: dict, oid: str, reason: str = "") -> dict:
    with db.tx():
        o = _order(oid, user)
        if user["id"] != o["buyer_id"]:
            raise AppError("p2p_only_buyer_cancels", 403)
        n = db.x("UPDATE p2p_orders SET status='cancelled', done_at=?, cancel_reason=? WHERE id=? AND status='pending'",
                 (db.now(), (reason or "buyer")[:120], oid)).rowcount
        if n != 1:
            raise AppError("bad_state")
        _return_escrow(o)
        _sys(oid, "cancelled")
        _count_cancel(user["id"])
    notify(o["seller_id"], "p2p_cancelled", path=f"/p2p/order/{oid}", id=oid, reason="")
    return get_order(user, oid)


def _count_cancel(uid: int):
    cfg = _cfg()
    since = db.now() - 86400
    n = db.val("SELECT COUNT(*) FROM p2p_orders WHERE buyer_id=? AND status IN ('cancelled','expired') AND done_at>=?", (uid, since), 0)
    if n >= int(cfg.get("cancel_limit_per_day", 3)):
        users.set_flag(uid, "p2p_ban_until", db.now() + int(cfg.get("cancel_ban_hours", 24)) * 3600)


def expire_due() -> int:
    n = 0
    for o in db.q("SELECT * FROM p2p_orders WHERE status='pending' AND expires_at<?", (db.now(),)):
        with db.tx():
            k = db.x("UPDATE p2p_orders SET status='expired', done_at=?, cancel_reason='timeout' WHERE id=? AND status='pending'", (db.now(), o["id"])).rowcount
            if k != 1:
                continue
            _return_escrow(o)
            _sys(o["id"], "expired")
            _count_cancel(o["buyer_id"])
        for uid in (o["buyer_id"], o["seller_id"]):
            notify(uid, "p2p_cancelled", path=f"/p2p/order/{o['id']}", id=o["id"], reason="⏰")
        n += 1
    # reminder 5 minutes before expiry
    for o in db.q("SELECT * FROM p2p_orders WHERE status='pending' AND expires_at BETWEEN ? AND ?", (db.now() + 240, db.now() + 300)):
        notify(o["buyer_id"], "p2p_expiring", path=f"/p2p/order/{o['id']}", id=o["id"], min=5, in_app=False)
    return n


def appeal(user: dict, oid: str, reason: str, details: str = "") -> dict:
    cfg = _cfg()
    with db.tx():
        o = _order(oid, user)
        if o["status"] != "paid":
            raise AppError("bad_state")
        if db.now() < (o["paid_at"] or 0) + int(cfg.get("appeal_after_min", 10)) * 60:
            raise AppError("p2p_appeal_too_early")
        db.x("UPDATE p2p_orders SET status='appeal' WHERE id=? AND status='paid'", (oid,))
        db.insert("p2p_disputes", {"order_id": oid, "opened_by": user["id"], "reason": (reason or "")[:60], "details": (details or "")[:1000],
                                   "status": "open", "created_at": db.now()})
        _sys(oid, "appeal_opened")
    for uid in (o["buyer_id"], o["seller_id"]):
        notify(uid, "p2p_appeal", path=f"/p2p/order/{oid}", id=oid)
    admin_alert(f"P2P appeal opened on {oid} ({o['amount']} {o['asset']} / {o['fiat_amount']} {o['fiat']}): {reason}", "warn", "p2p")
    try:
        from . import support

        support.summarize_dispute(oid)
    except Exception:
        pass
    return get_order(user, oid)


def resolve(oid: str, admin_id: int, winner: str, note: str = "") -> dict:
    """Arbiter decision: winner='buyer' releases the crypto to the buyer, 'seller' returns it to the seller."""
    with db.tx():
        o = db.one("SELECT * FROM p2p_orders WHERE id=?", (oid,))
        if not o or o["status"] not in ("appeal", "paid", "pending"):
            raise AppError("bad_state")
        if winner == "buyer":
            _complete(o)
        elif winner == "seller":
            n = db.x("UPDATE p2p_orders SET status='cancelled', done_at=?, cancel_reason='arbitration' WHERE id=? AND status IN ('appeal','paid','pending')",
                     (db.now(), oid)).rowcount
            if n != 1:
                raise AppError("bad_state")
            _return_escrow(o)
        else:
            raise AppError("bad_request")
        db.x("UPDATE p2p_disputes SET status='resolved', resolution=?, admin_id=?, resolved_at=? WHERE order_id=?",
             (f"{winner}: {note}"[:500], admin_id, db.now(), oid))
        db.insert("p2p_messages", {"order_id": oid, "sender_id": -1, "text": f"⚖️ {winner.upper()} — {note}"[:500], "created_at": db.now()})
    if winner == "buyer":
        _after_complete(o)
    for uid in (o["buyer_id"], o["seller_id"]):
        notify(uid, "p2p_resolved", path=f"/p2p/order/{oid}", id=oid, result=("✅ " if (winner == "buyer") == (uid == o["buyer_id"]) else "❌ ") + (note or winner))
    return {"ok": True}


# ───────────────────────── chat ─────────────────────────
def messages(user: dict | None, oid: str, after: int = 0, admin: bool = False) -> list[dict]:
    _order(oid, user, admin)
    return db.q("SELECT id, sender_id, text, file, created_at FROM p2p_messages WHERE order_id=? AND id>? ORDER BY id LIMIT 300", (oid, after))


def send_message(user: dict, oid: str, text: str | None, file: str | None = None) -> dict:
    o = _order(oid, user)
    text = (text or "").strip()[:1000]
    if not text and not file:
        raise AppError("bad_request")
    if o["status"] in ("completed", "cancelled", "expired") and db.now() - (o["done_at"] or 0) > 86400:
        raise AppError("p2p_chat_closed")
    mid = db.insert("p2p_messages", {"order_id": oid, "sender_id": user["id"], "text": text or None, "file": file, "created_at": db.now()})
    other = o["seller_id"] if user["id"] == o["buyer_id"] else o["buyer_id"]
    last = db.val("SELECT MAX(created_at) FROM p2p_messages WHERE order_id=? AND sender_id=? AND id<?", (oid, user["id"], mid), 0)
    if db.now() - (last or 0) > 60:  # don't spam the bot chat on every message
        notify(other, "p2p_message", path=f"/p2p/order/{oid}", id=oid, text=(text or "📎")[:200], in_app=False)
    return {"id": mid}


def review(user: dict, oid: str, positive: bool, comment: str = "") -> dict:
    o = _order(oid, user)
    if o["status"] != "completed":
        raise AppError("bad_state")
    other = o["seller_id"] if user["id"] == o["buyer_id"] else o["buyer_id"]
    db.x("INSERT OR REPLACE INTO p2p_reviews(order_id, from_id, to_id, positive, comment, created_at) VALUES(?,?,?,?,?,?)",
         (oid, user["id"], other, 1 if positive else 0, (comment or "")[:300], db.now()))
    return {"ok": True}


def my_orders(user_id: int, status: str | None = None) -> list[dict]:
    q = "SELECT * FROM p2p_orders WHERE (buyer_id=? OR seller_id=?)"
    args: list = [user_id, user_id]
    if status == "active":
        q += " AND status IN ('pending','paid','appeal')"
    q += " ORDER BY created_at DESC LIMIT 100"
    out = []
    for o in db.q(q, tuple(args)):
        other = users.get(o["seller_id"] if o["buyer_id"] == user_id else o["buyer_id"])
        out.append({"id": o["id"], "role": "buyer" if o["buyer_id"] == user_id else "seller", "asset": o["asset"], "fiat": o["fiat"],
                    "amount": o["amount"], "fiat_amount": o["fiat_amount"], "price": o["price"], "status": o["status"],
                    "created_at": o["created_at"], "expires_at": o["expires_at"], "counterparty": users.public(other) if other else None})
    return out
