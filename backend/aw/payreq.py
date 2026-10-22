"""Z Pay: payment requests ("pay me" links / QR codes) and split bills.

A request belongs to the person who gets paid. It can be for a fixed amount or let the payer choose. Paying is an
ordinary internal transfer (same PIN, limits and fees), tagged with the request so both sides see it settled.
A split bill is a group of requests: one per friend, each sent as a bot message to people already on Zohra Wallet,
or shared as a link with anyone else.
"""
import secrets
from decimal import Decimal

from . import catalog, db, guard, settings, tg, transfers, users
from .money import AppError, D, amount_in, q_down, s
from .notify import notify


def _code() -> str:
    return secrets.token_urlsafe(9).replace("-", "x").replace("_", "y")


def link(code: str) -> str:
    return tg.startapp_link(f"r_{code}")


def _out(r: dict, viewer_id: int | None = None) -> dict:
    owner = users.get(r["user_id"])
    payer = users.get(r["payer_id"]) if r["payer_id"] else None
    return {"code": r["code"], "asset": r["asset"], "amount": r["amount"], "note": r["note"], "status": r["status"],
            "link": link(r["code"]), "created_at": r["created_at"], "expires_at": r["expires_at"], "paid_at": r["paid_at"],
            "tx": r["tx_id"] if viewer_id in (r["user_id"], r["payer_id"]) else None, "split": r["split_id"],
            "to": users.public(owner) if owner else None, "payer": users.public(payer) if payer else None,
            "payer_name": r["payer_name"], "mine": viewer_id == r["user_id"]}


def _expire():
    db.x("UPDATE pay_requests SET status='expired' WHERE status='open' AND expires_at<?", (db.now(),))


def create(user: dict, asset: str, amount=None, note: str | None = None, split_id: str | None = None,
           payer_id: int | None = None, payer_name: str | None = None) -> dict:
    guard.feature("pay_requests")
    users.ensure_active(user)
    a = catalog.asset(asset)
    if not a or not a["enabled"] or not a["transfer_enabled"]:
        raise AppError("asset_unavailable")
    amt = s(amount_in(amount, a["precision"])) if amount not in (None, "", "0") else None
    code = _code()
    days = int(settings.get("requests").get("expire_days", 30))
    db.insert("pay_requests", {"code": code, "user_id": user["id"], "asset": asset, "amount": amt, "note": (note or "").strip()[:140] or None,
                               "status": "open", "split_id": split_id, "payer_id": payer_id, "payer_name": payer_name,
                               "created_at": db.now(), "expires_at": db.now() + days * 86400})
    return _out(db.one("SELECT * FROM pay_requests WHERE code=?", (code,)), user["id"])


def view(code: str, viewer: dict | None) -> dict:
    _expire()
    r = db.one("SELECT * FROM pay_requests WHERE code=?", (code,))
    if not r:
        raise AppError("not_found", 404)
    return _out(r, viewer["id"] if viewer else None)


def mine(user_id: int) -> list[dict]:
    _expire()
    return [_out(r, user_id) for r in db.q("SELECT * FROM pay_requests WHERE user_id=? AND split_id IS NULL ORDER BY created_at DESC LIMIT 50", (user_id,))]


def pay(payer: dict, code: str, amount=None, pin: str | None = None, bio: str | None = None, idem: str | None = None) -> dict:
    _expire()
    r = db.one("SELECT * FROM pay_requests WHERE code=?", (code,))
    if not r:
        raise AppError("not_found", 404)
    if r["status"] != "open":
        raise AppError("request_closed", state=r["status"])
    if r["user_id"] == payer["id"]:
        raise AppError("self_transfer")
    if r["payer_id"] and r["payer_id"] != payer["id"]:
        raise AppError("request_not_for_you")
    amt = r["amount"] or amount
    if not amt:
        raise AppError("bad_amount")
    # claim the request before moving money so a double tap can never pay twice
    if db.x("UPDATE pay_requests SET status='paying' WHERE code=? AND status='open'", (code,)).rowcount != 1:
        raise AppError("request_closed")
    try:
        res = transfers.send(payer, r["user_id"], r["asset"], amt, note=r["note"], idem=idem, pin=pin, bio=bio)
    except Exception:
        db.x("UPDATE pay_requests SET status='open' WHERE code=? AND status='paying'", (code,))
        raise
    db.update("pay_requests", {"code": code}, {"status": "paid", "payer_id": payer["id"], "tx_id": res["id"], "paid_at": db.now(),
                                                "amount": r["amount"] or res["amount"]})
    notify(r["user_id"], "request_paid", path=f"/request/{code}", name=users.display_name(payer), amount=res["amount"], asset=r["asset"])
    if r["split_id"]:
        _split_check(r["split_id"])
    return {**res, "code": code}


def cancel(user: dict, code: str) -> dict:
    n = db.x("UPDATE pay_requests SET status='cancelled' WHERE code=? AND user_id=? AND status='open'", (code, user["id"])).rowcount
    if not n:
        raise AppError("request_closed")
    return {"ok": True}


# ---------------- split bills ----------------

def split_create(user: dict, asset: str, total, title: str, people: list, include_me: bool = True, mode: str = "equal") -> dict:
    """`people`: [{"user_id"?: int, "name"?: str, "amount"?: str}] — known users get a bot message, others a share link."""
    guard.feature("pay_requests")
    users.ensure_active(user)
    a = catalog.asset(asset)
    if not a or not a["enabled"] or not a["transfer_enabled"]:
        raise AppError("asset_unavailable")
    tot = amount_in(total, a["precision"])
    people = [p for p in (people or []) if isinstance(p, dict)][: int(settings.get("requests").get("max_split", 20))]
    if not people:
        raise AppError("bad_request")
    n = len(people) + (1 if include_me else 0)
    if mode == "custom":
        shares = [amount_in(p.get("amount"), a["precision"]) for p in people]
        if sum(shares, Decimal(0)) > tot:
            raise AppError("bad_amount")
    else:
        each = q_down(tot / n, a["precision"])
        if each <= 0:
            raise AppError("amount_too_small")
        shares = [each] * len(people)
    sid = "SP" + secrets.token_hex(5).upper()
    db.insert("splits", {"id": sid, "user_id": user["id"], "title": (title or "").strip()[:80] or None, "asset": asset, "total": s(tot),
                         "people": n, "status": "open", "created_at": db.now()})
    for p, share in zip(people, shares):
        uid = int(p["user_id"]) if p.get("user_id") else None
        if uid == user["id"]:
            continue
        ru = users.get(uid) if uid else None
        req = create(user, asset, share, note=title, split_id=sid, payer_id=ru["id"] if ru else None,
                     payer_name=(users.display_name(ru) if ru else (p.get("name") or "").strip()[:40] or None))
        if ru:
            notify(ru["id"], "split_request", path=f"/request/{req['code']}", button="pay_now", name=users.display_name(user),
                   amount=s(share), asset=asset, title=f" · {title}" if title else "")
    return split_view(user, sid)


def split_view(user: dict, sid: str) -> dict:
    sp = db.one("SELECT * FROM splits WHERE id=?", (sid,))
    if not sp or sp["user_id"] != user["id"]:
        raise AppError("not_found", 404)
    reqs = [_out(r, user["id"]) for r in db.q("SELECT * FROM pay_requests WHERE split_id=? ORDER BY created_at", (sid,))]
    paid = sum((D(r["amount"]) for r in reqs if r["status"] == "paid"), Decimal(0))
    owed = sum((D(r["amount"]) for r in reqs if r["status"] in ("open", "paying")), Decimal(0))
    return {"id": sid, "title": sp["title"], "asset": sp["asset"], "total": sp["total"], "people": sp["people"], "status": sp["status"],
            "created_at": sp["created_at"], "collected": s(paid), "outstanding": s(owed), "requests": reqs}


def splits(user_id: int) -> list[dict]:
    out = []
    for sp in db.q("SELECT * FROM splits WHERE user_id=? ORDER BY created_at DESC LIMIT 30", (user_id,)):
        reqs = db.q("SELECT status FROM pay_requests WHERE split_id=?", (sp["id"],))
        out.append({"id": sp["id"], "title": sp["title"], "asset": sp["asset"], "total": sp["total"], "status": sp["status"],
                    "paid": sum(1 for r in reqs if r["status"] == "paid"), "count": len(reqs), "created_at": sp["created_at"]})
    return out


def _split_check(sid: str):
    left = db.val("SELECT COUNT(*) FROM pay_requests WHERE split_id=? AND status IN ('open','paying')", (sid,), 0)
    if not left:
        db.update("splits", {"id": sid}, {"status": "settled"})
        sp = db.one("SELECT * FROM splits WHERE id=?", (sid,))
        notify(sp["user_id"], "split_settled", path=f"/split/{sid}", title=sp["title"] or sp["asset"], amount=sp["total"], asset=sp["asset"])


def remind(user: dict, sid: str) -> dict:
    split_view(user, sid)
    n = 0
    for r in db.q("SELECT * FROM pay_requests WHERE split_id=? AND status='open' AND payer_id IS NOT NULL", (sid,)):
        notify(r["payer_id"], "split_request", path=f"/request/{r['code']}", button="pay_now", name=users.display_name(user),
               amount=r["amount"], asset=r["asset"], title=f" · {r['note']}" if r["note"] else "")
        n += 1
    return {"sent": n}
