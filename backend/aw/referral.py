"""Two-level referral programme: inviters earn a share of the platform revenue their friends generate.

Commission accrues on every fee event (swap spread, withdraw/transfer/P2P fees) for `duration_days` after the friend
joins; tier % grows with the number of active friends. Earnings accumulate and are claimed into the wallet (USDT).
"""
from decimal import Decimal

from . import db, events, ledger, settings, users
from .money import ZERO, AppError, D, q_down, s
from .notify import notify


def _tier_pct(referrer_id: int, cfg: dict) -> Decimal:
    active = active_friends(referrer_id)
    pct = D(cfg.get("level1_pct", "30"))
    for t in sorted(cfg.get("tiers", []), key=lambda x: int(x.get("min_friends", 0))):
        if active >= int(t.get("min_friends", 0)):
            pct = D(t.get("level1_pct", pct))
    return pct


def active_friends(uid: int) -> int:
    return db.val("SELECT COUNT(DISTINCT u.id) FROM users u JOIN txs t ON t.user_id=u.id WHERE u.referred_by=? "
                  "AND t.type IN ('deposit','swap','send','p2p_buy','p2p_sell')", (uid,), 0)


@events.on("fee")
def _on_fee(_name, user_id: int, source: str = "", ref: str | None = None, usd=0, **_):
    cfg = settings.get("referral")
    if not cfg.get("enabled") or D(usd) <= 0:
        return
    u = users.get(user_id)
    if not u or not u.get("referred_by"):
        return
    if (db.now() - (u.get("created_at") or 0)) > int(cfg.get("duration_days", 365)) * 86400:
        return
    l1 = u["referred_by"]
    c1 = D(usd) * _tier_pct(l1, cfg) / 100
    rows = [(l1, 1, c1)]
    if u.get("ref_level2") and D(cfg.get("level2_pct", "0")) > 0:
        rows.append((u["ref_level2"], 2, D(usd) * D(cfg["level2_pct"]) / 100))
    for rid, lvl, c in rows:
        if c > 0:
            db.insert("referral_earnings", {"referrer_id": rid, "referee_id": user_id, "level": lvl, "source": source, "ref": ref,
                                            "fee_usd": s(usd), "commission_usd": s(q_down(c, 8)), "created_at": db.now()})


@events.on("registered")
def _on_registered(_name, user_id: int, referrer: int | None = None, **_):
    if not referrer:
        return
    u = users.get(user_id)
    notify(referrer, "referral_joined", path="/referral", name=users.display_name(u) if u else "")
    cfg = settings.get("referral")
    bonus = cfg.get("referee_bonus")
    if bonus:
        from . import rewards

        rewards.grant(user_id, bonus, "referral_welcome")
    events.emit("referral", referrer, friend=user_id)


def pending_usd(uid: int) -> Decimal:
    return sum((D(r["commission_usd"]) for r in db.q("SELECT commission_usd FROM referral_earnings WHERE referrer_id=? AND claimed_at IS NULL", (uid,))), ZERO)


def claim(user: dict) -> dict:
    cfg = settings.get("referral")
    asset = cfg.get("payout_asset", "USDT")
    with db.tx():
        total = pending_usd(user["id"])
        amount = q_down(total, 6)
        if amount < D(cfg.get("min_claim_usd", "1")):
            raise AppError("referral_min_claim", min=cfg.get("min_claim_usd", "1"))
        db.x("UPDATE referral_earnings SET claimed_at=? WHERE referrer_id=? AND claimed_at IS NULL", (db.now(), user["id"]))
        txid = ledger.add_tx(user["id"], "referral", asset, amount, usd_value=amount)
        ledger.credit(user["id"], asset, amount, "referral", txid)
        # referral payouts are a platform expense: record it as negative revenue for honest P&L
        db.insert("revenue", {"source": "referral_payout", "ref": txid, "user_id": user["id"], "asset": asset,
                              "amount": s(-amount), "usd": s(-amount), "created_at": db.now()})
    notify(user["id"], "referral_earned", path="/referral", amount=s(amount))
    return {"id": txid, "amount": s(amount), "asset": asset}


def stats(user: dict) -> dict:
    cfg = settings.get("referral")
    uid = user["id"]
    friends = db.val("SELECT COUNT(*) FROM users WHERE referred_by=?", (uid,), 0)
    level2 = db.val("SELECT COUNT(*) FROM users WHERE ref_level2=?", (uid,), 0)
    total = sum((D(r["commission_usd"]) for r in db.q("SELECT commission_usd FROM referral_earnings WHERE referrer_id=?", (uid,))), ZERO)
    recent = db.q("SELECT u.id, u.first_name, u.username, u.photo_url, u.created_at, "
                  "(SELECT COALESCE(SUM(CAST(commission_usd AS REAL)),0) FROM referral_earnings e WHERE e.referrer_id=? AND e.referee_id=u.id) AS earned "
                  "FROM users u WHERE u.referred_by=? ORDER BY u.created_at DESC LIMIT 30", (uid, uid))
    from . import tg

    return {
        "code": user["ref_code"], "link": tg.startapp_link(f"ref_{user['ref_code']}"),
        "friends": friends, "active": active_friends(uid), "level2": level2,
        "earned_usd": s(q_down(total, 4)), "pending_usd": s(q_down(pending_usd(uid), 4)),
        "pct": s(_tier_pct(uid, cfg)), "level2_pct": cfg.get("level2_pct", "0"), "tiers": cfg.get("tiers", []),
        "min_claim_usd": cfg.get("min_claim_usd", "1"), "payout_asset": cfg.get("payout_asset", "USDT"),
        "duration_days": cfg.get("duration_days", 365), "enabled": cfg.get("enabled", True),
        "referee_bonus": cfg.get("referee_bonus"),
        "recent": [{"name": r["first_name"] or (("@" + r["username"]) if r["username"] else "—"), "photo": r["photo_url"],
                    "joined": r["created_at"], "earned_usd": f"{r['earned']:.4f}"} for r in recent],
    }


def leaderboard(limit: int = 20) -> list[dict]:
    since = db.now() - 30 * 86400
    rows = db.q("SELECT referrer_id, SUM(CAST(commission_usd AS REAL)) AS earned, COUNT(DISTINCT referee_id) AS friends "
                "FROM referral_earnings WHERE created_at>=? GROUP BY referrer_id ORDER BY earned DESC LIMIT ?", (since, limit))
    out = []
    for r in rows:
        u = users.get(r["referrer_id"])
        if u:
            name = u.get("first_name") or "—"
            out.append({"name": name[:1] + "•••" if len(name) > 1 else name, "photo": u.get("photo_url"),
                        "earned_usd": f"{r['earned']:.2f}", "friends": r["friends"]})
    return out
