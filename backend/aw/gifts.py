"""Gifts / "send to anyone" links — including people who don't have Zohra Wallet yet.

Locks (who can claim):
  • user      — bound to one Telegram account id (picked from the native Telegram contact picker). A forwarded link is
                useless to anyone else: the claim is checked against the verified initData user id.
  • username  — bound to an @username (checked against the verified Telegram username at claim time).
  • password  — anyone with the link AND the secret word.
  • open      — first come, first served; with shares > 1 it becomes a group "red packet" (equal or lucky split).
The sender shares a personal message (Telegram shareMessage / prepared inline message) that opens the claim screen.
Unclaimed gifts are refunded automatically when they expire.
"""
import random
import secrets
from decimal import Decimal

from . import catalog, config, db, events, fees, guard, ledger, prices, settings, tg, users
from .bot_texts import t
from .money import ZERO, AppError, D, amount_in, q_down, ref_id, s
from .notify import notify
from .security import check_pin, hash_pin

_rng = random.SystemRandom()


def _code() -> str:
    return secrets.token_urlsafe(12).replace("-", "x").replace("_", "y")


def link(code: str) -> str:
    return tg.startapp_link(f"g_{code}")


def create(sender: dict, asset: str, amount, lock: str = "open", recipient_id: int | None = None,
           recipient_username: str | None = None, password: str | None = None, shares: int = 1, split: str = "equal",
           message: str | None = None, theme: str | None = None, pin: str | None = None, bio: str | None = None,
           idem: str | None = None) -> dict:
    guard.feature("gifts")
    users.ensure_active(sender)
    cfg = settings.get("gifts")
    a = catalog.asset(asset)
    if not a or not a["enabled"] or not a["transfer_enabled"]:
        raise AppError("asset_unavailable")
    amt = amount_in(amount, a["precision"])
    if lock not in ("user", "username", "password", "open"):
        raise AppError("bad_request")
    shares = max(1, min(int(shares or 1), int(cfg.get("max_shares", 200))))
    if lock != "open":
        shares = 1
    if split not in ("equal", "random"):
        split = "equal"
    rname = None
    if lock == "user":
        if not recipient_id:
            raise AppError("recipient_required")
        if int(recipient_id) == sender["id"]:
            raise AppError("self_transfer")
        pick = db.one("SELECT picked_name FROM contact_picks WHERE user_id=? AND picked_id=? ORDER BY picked_at DESC LIMIT 1",
                      (sender["id"], int(recipient_id)))
        ru = users.get(int(recipient_id))
        if not pick and not ru:
            raise AppError("recipient_not_found")
        rname = (pick or {}).get("picked_name") or (users.display_name(ru) if ru else None)
    if lock == "username":
        recipient_username = (recipient_username or "").strip().lstrip("@")
        if not recipient_username or len(recipient_username) < 4:
            raise AppError("recipient_required")
        rname = "@" + recipient_username
    if lock == "password":
        if not password or len(password) < 4:
            raise AppError("password_required")
    usd = prices.to_usd(asset, amt)
    if usd and usd < D(cfg.get("min_usd", "0.1")) * shares:
        raise AppError("amount_too_small")
    if q_down(amt / shares, a["precision"]) <= 0:
        raise AppError("amount_too_small")
    fq = fees.quote("gift", sender, asset, amt)
    fee = fq["fee"] or ZERO
    guard.confirm(sender, "gift", pin, bio, usd=usd)
    guard.check_limit(sender, "transfer", usd)
    with db.tx():
        seen = guard.idem_seen(sender["id"], idem)
        if seen:
            return seen
        gid = ref_id("GF", 10)
        code = _code()
        hours = int(cfg.get("expire_hours", 72))
        ledger.debit(sender["id"], asset, amt + fee, "gift_out", gid)
        db.insert("gifts", {
            "id": gid, "code": code, "sender_id": sender["id"], "asset": asset, "amount": s(amt), "fee": s(fee),
            "lock_type": lock, "recipient_id": int(recipient_id) if lock == "user" else None,
            "recipient_username": recipient_username.lower() if lock == "username" else None,
            "recipient_name": rname, "password_hash": hash_pin(password) if lock == "password" else None,
            "shares": shares, "split": split, "remaining": s(amt), "message": (message or "")[:200] or None,
            "theme": theme if theme in cfg.get("themes", []) else "classic", "status": "active",
            "created_at": db.now(), "expires_at": db.now() + hours * 3600,
        })
        ledger.add_tx(sender["id"], "gift_out", asset, amt, fee=fee, fee_asset=asset, ref=gid, usd_value=usd,
                      counterparty=int(recipient_id) if lock == "user" else None, meta={"lock": lock, "to": rname, "shares": shares})
        if fee > 0:
            ledger.add_revenue("gift_fee", gid, sender["id"], asset, fee, prices.to_usd(asset, fee))
        if fq["voucher"]:
            fees.consume_voucher(fq["voucher"]["id"])
        result = {"id": gid, "code": code, "link": link(code), "asset": asset, "amount": s(amt), "fee": s(fee),
                  "lock": lock, "recipient": rname, "shares": shares, "expires_at": db.now() + hours * 3600}
        guard.idem_store(sender["id"], idem, result)
    # an already-registered recipient also gets a direct bot message with a claim button
    if lock == "user":
        ru = users.get(int(recipient_id))
        if ru:
            lang = ru.get("lang") or "en"
            notify(ru["id"], "gift_received", path=f"/gift/{code}", button="gift_claim", name=users.display_name(sender),
                   amount=s(amt), asset=asset, message=(message or ""))
            _ = lang
    events.emit("gift", sender["id"], ref=gid, usd=usd)
    return result


def prepare_share(sender: dict, gift_id: str) -> dict:
    """Bot API 8.0 savePreparedInlineMessage → the Mini App calls Telegram.WebApp.shareMessage(id)."""
    g = db.one("SELECT * FROM gifts WHERE id=? AND sender_id=?", (gift_id, sender["id"]))
    if not g:
        raise AppError("gift_not_found", 404)
    lang = sender.get("lang") or "en"
    text = t(lang, "gift_received", name=users.display_name(sender), amount=g["amount"], asset=g["asset"], message=g["message"] or "")
    result = {
        "type": "article", "id": g["id"][:64], "title": f"🎁 {g['amount']} {g['asset']}",
        "input_message_content": {"message_text": text, "parse_mode": "HTML"},
        "reply_markup": {"inline_keyboard": [[{"text": "🎁 " + t(lang, "gift_claim"), "url": link(g["code"])}]]},
        "description": "Zohra Wallet",
    }
    res = tg.call("savePreparedInlineMessage", {"user_id": sender["id"], "result": result, "allow_user_chats": True,
                                                "allow_group_chats": g["lock_type"] == "open", "allow_bot_chats": False,
                                                "allow_channel_chats": g["lock_type"] == "open"})
    if not res.get("ok"):
        return {"prepared_id": None, "link": link(g["code"]), "text": text}
    return {"prepared_id": res["result"]["id"], "link": link(g["code"]), "text": text}


def view(code: str, viewer: dict | None = None) -> dict:
    g = db.one("SELECT * FROM gifts WHERE code=?", (code,))
    if not g:
        raise AppError("gift_not_found", 404)
    sender = users.get(g["sender_id"])
    out = {"id": g["id"], "asset": g["asset"], "amount": g["amount"], "message": g["message"], "theme": g["theme"],
           "lock": g["lock_type"], "status": g["status"], "shares": g["shares"], "claimed_shares": g["claimed_shares"],
           "expires_at": g["expires_at"], "sender": users.public(sender) if sender else None,
           "recipient": g["recipient_name"], "can_claim": False, "reason": None, "claimed": None}
    if viewer:
        mine = db.one("SELECT amount FROM gift_claims WHERE gift_id=? AND user_id=?", (g["id"], viewer["id"]))
        if mine:
            out["claimed"] = mine["amount"]
        try:
            _check_claim(g, viewer, password=None, check_password=False)
            out["can_claim"] = True
        except AppError as e:
            out["reason"] = e.code
        # group packets: who got what (visible to the sender and to anyone who already opened it)
        if g["shares"] > 1 and (viewer["id"] == g["sender_id"] or mine):
            rows = db.q("SELECT user_id, amount, created_at FROM gift_claims WHERE gift_id=? ORDER BY created_at", (g["id"],))
            top = max((D(r["amount"]) for r in rows), default=None)
            claims = []
            for r in rows:
                u = users.get(r["user_id"])
                claims.append({"id": r["user_id"], "name": users.display_name(u) if u else "—", "photo": (u or {}).get("photo_url"),
                               "amount": r["amount"], "at": r["created_at"], "me": r["user_id"] == viewer["id"],
                               "luckiest": g["split"] == "random" and len(rows) > 1 and D(r["amount"]) == top})
            out["claims"] = claims
            out["split"] = g["split"]
            if rows:
                out["took_sec"] = rows[-1]["created_at"] - g["created_at"]
    return out


def _check_claim(g: dict, user: dict, password: str | None, check_password: bool = True):
    if g["status"] != "active":
        raise AppError("gift_" + ("claimed" if g["status"] == "claimed" else "inactive"))
    if g["expires_at"] and g["expires_at"] < db.now():
        raise AppError("gift_expired")
    if user["id"] == g["sender_id"]:
        raise AppError("gift_own")
    if db.one("SELECT 1 FROM gift_claims WHERE gift_id=? AND user_id=?", (g["id"], user["id"])):
        raise AppError("gift_already_claimed")
    if g["lock_type"] == "user" and user["id"] != g["recipient_id"]:
        raise AppError("gift_not_for_you", 403)
    if g["lock_type"] == "username" and (user.get("username") or "").lower() != (g["recipient_username"] or ""):
        raise AppError("gift_not_for_you", 403)
    if g["lock_type"] == "password" and check_password and not check_pin(password or "", g["password_hash"]):
        raise AppError("gift_wrong_password", 403)


def claim(user: dict, code: str, password: str | None = None) -> dict:
    users.ensure_active(user)
    with db.tx():
        g = db.one("SELECT * FROM gifts WHERE code=?", (code,))
        if not g:
            raise AppError("gift_not_found", 404)
        _check_claim(g, user, password)
        prec = (catalog.asset(g["asset"]) or {}).get("precision", 8)
        remaining = D(g["remaining"])
        left = g["shares"] - g["claimed_shares"]
        if left <= 1:
            part = remaining
        elif g["split"] == "random":
            avg = remaining / left
            part = q_down(avg * Decimal(str(_rng.uniform(0.2, 1.8))), prec)
            part = max(Decimal(1).scaleb(-prec), min(part, remaining - Decimal(1).scaleb(-prec) * (left - 1)))
        else:
            part = q_down(remaining / left, prec)
        if part <= 0:
            raise AppError("gift_claimed")
        new_remaining = remaining - part
        claimed = g["claimed_shares"] + 1
        status = "claimed" if claimed >= g["shares"] or new_remaining <= 0 else "active"
        n = db.x("UPDATE gifts SET remaining=?, claimed_shares=?, status=?, done_at=? WHERE id=? AND claimed_shares=? AND status='active'",
                 (s(new_remaining), claimed, status, db.now() if status != "active" else None, g["id"], g["claimed_shares"])).rowcount
        if n != 1:
            raise AppError("gift_claimed")
        db.insert("gift_claims", {"gift_id": g["id"], "user_id": user["id"], "amount": s(part), "created_at": db.now()})
        ledger.credit(user["id"], g["asset"], part, "gift_in", g["id"])
        txid = ledger.add_tx(user["id"], "gift_in", g["asset"], part, counterparty=g["sender_id"], ref=g["id"],
                             usd_value=prices.to_usd(g["asset"], part), meta={"from": users.display_name(users.get(g["sender_id"]) or {"id": g["sender_id"]})})
        if status == "claimed":
            db.x("UPDATE txs SET status='completed' WHERE ref=? AND type='gift_out'", (g["id"],))
    notify(g["sender_id"], "gift_claimed_sender", path=f"/tx/{txid}", name=users.display_name(user), amount=s(part), asset=g["asset"])
    events.emit("gift_claimed", user["id"], ref=g["id"])
    return {"id": txid, "asset": g["asset"], "amount": s(part), "status": status}


def cancel(sender: dict, gift_id: str) -> dict:
    with db.tx():
        g = db.one("SELECT * FROM gifts WHERE id=? AND sender_id=?", (gift_id, sender["id"]))
        if not g:
            raise AppError("gift_not_found", 404)
        if g["status"] != "active":
            raise AppError("gift_inactive")
        _refund(g, "cancelled")
    return {"ok": True}


def _refund(g: dict, status: str):
    rem = D(g["remaining"])
    n = db.x("UPDATE gifts SET status=?, remaining='0', done_at=? WHERE id=? AND status='active'", (status, db.now(), g["id"])).rowcount
    if n != 1 or rem <= 0:
        return rem if n == 1 else ZERO
    ledger.credit(g["sender_id"], g["asset"], rem, "gift_refund", g["id"])
    ledger.add_tx(g["sender_id"], "gift_refund", g["asset"], rem, ref=g["id"])
    return rem


def expire_due() -> int:
    n = 0
    for g in db.q("SELECT * FROM gifts WHERE status='active' AND expires_at < ?", (db.now(),)):
        with db.tx():
            rem = _refund(g, "expired")
        if rem > 0:
            notify(g["sender_id"], "gift_refunded", path="/history", amount=s(rem), asset=g["asset"])
            n += 1
    return n


def mine(user_id: int) -> list[dict]:
    rows = db.q("SELECT * FROM gifts WHERE sender_id=? ORDER BY created_at DESC LIMIT 50", (user_id,))
    return [{"id": g["id"], "code": g["code"], "link": link(g["code"]), "asset": g["asset"], "amount": g["amount"],
             "remaining": g["remaining"], "lock": g["lock_type"], "theme": g["theme"], "recipient": g["recipient_name"], "status": g["status"],
             "shares": g["shares"], "claimed_shares": g["claimed_shares"], "created_at": g["created_at"],
             "expires_at": g["expires_at"]} for g in rows]


# ───────────── native contact picker (KeyboardButtonRequestUsers) ─────────────
def start_contact_pick(user: dict, purpose: str = "send") -> dict:
    req_id = _rng.randint(1, 2_000_000_000)
    db.insert("contact_picks", {"token": str(req_id), "user_id": user["id"], "purpose": purpose[:20], "created_at": db.now()})
    lang = user.get("lang") or "en"
    tg.queue("sendMessage", {
        "chat_id": user["id"], "text": t(lang, "pick_contact"),
        "reply_markup": {"keyboard": [[{"text": t(lang, "pick_contact_btn"), "request_users": {
            "request_id": req_id, "user_is_bot": False, "max_quantity": 1, "request_name": True, "request_username": True}}]],
            "resize_keyboard": True, "one_time_keyboard": True},
    }, priority=1)
    return {"token": str(req_id), "bot": config.BOT_USERNAME}


def on_users_shared(sender_id: int, request_id: int, shared: list[dict]) -> dict | None:
    pick = db.one("SELECT * FROM contact_picks WHERE token=? AND user_id=?", (str(request_id), sender_id))
    if not pick or not shared:
        return None
    u = shared[0]
    name = " ".join(x for x in [u.get("first_name"), u.get("last_name")] if x).strip() or (("@" + u["username"]) if u.get("username") else str(u["user_id"]))
    db.update("contact_picks", {"token": pick["token"]}, {"picked_id": u["user_id"], "picked_name": name[:64],
                                                          "picked_username": u.get("username"), "picked_at": db.now()})
    return {"id": u["user_id"], "name": name, "username": u.get("username"), "purpose": pick["purpose"]}


def contact_pick_status(user: dict, token: str) -> dict:
    p = db.one("SELECT * FROM contact_picks WHERE token=? AND user_id=?", (token, user["id"]))
    if not p:
        raise AppError("not_found", 404)
    if not p["picked_id"]:
        return {"done": False}
    ru = users.get(p["picked_id"])
    return {"done": True, "id": p["picked_id"], "name": p["picked_name"], "username": p["picked_username"],
            "registered": bool(ru), "user": users.public(ru) if ru else None}
