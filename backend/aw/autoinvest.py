"""Auto-invest (recurring buy): swap a fixed amount of one coin into another every day, week or month.

The plan is authorised once with PIN/biometrics when it is created. Each run takes a fresh firm quote from the
swap engine and executes it immediately, so the user always gets the same rate and fee rules as a manual swap.
A run that fails (balance too low, pair paused) is skipped and reported; three failures in a row pause the plan.
"""
import calendar
import time

from . import catalog, db, guard, prices, settings, swap, users
from .money import ZERO, AppError, D, amount_in, s

FREQS = ("daily", "weekly", "monthly")


def next_run(freq: str, after: int, hour: int = 10, weekday: int = 0, day: int = 1) -> int:
    """Next UTC run time strictly after `after`."""
    t = time.gmtime(after)
    base = calendar.timegm((t.tm_year, t.tm_mon, t.tm_mday, hour, 0, 0))
    if freq == "daily":
        return base if base > after else base + 86400
    if freq == "weekly":
        ahead = (weekday - t.tm_wday) % 7
        cand = base + ahead * 86400
        return cand if cand > after else cand + 7 * 86400
    y, m = t.tm_year, t.tm_mon
    for _ in range(3):
        d = min(day, calendar.monthrange(y, m)[1])
        cand = calendar.timegm((y, m, d, hour, 0, 0))
        if cand > after:
            return cand
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return after + 30 * 86400


def _out(r: dict) -> dict:
    return {"id": r["id"], "from": r["from_asset"], "to": r["to_asset"], "amount": r["amount"], "freq": r["freq"],
            "next_at": r["next_at"], "active": bool(r["active"]), "runs": r["runs"], "invested": r["invested"],
            "bought": r["bought"], "last_error": r["last_error"], "created_at": r["created_at"]}


def plans(user_id: int) -> list[dict]:
    return [_out(r) for r in db.q("SELECT * FROM autoinvest WHERE user_id=? AND deleted=0 ORDER BY created_at DESC", (user_id,))]


def create(user: dict, frm: str, to: str, amount, freq: str, pin: str | None = None, bio: str | None = None) -> dict:
    guard.feature("autoinvest")
    users.ensure_active(user)
    cfg = settings.get("autoinvest")
    if freq not in FREQS:
        raise AppError("bad_request")
    a, b = catalog.asset(frm), catalog.asset(to)
    if not a or not b or frm == to or not a["swap_enabled"] or not b["swap_enabled"]:
        raise AppError("asset_unavailable")
    amt = amount_in(amount, a["precision"])
    usd = prices.to_usd(frm, amt) or ZERO
    if usd < D(cfg.get("min_usd", "5")):
        raise AppError("amount_too_small", min_usd=cfg.get("min_usd", "5"))
    if db.val("SELECT COUNT(*) FROM autoinvest WHERE user_id=? AND deleted=0", (user["id"],), 0) >= int(cfg.get("max_plans", 10)):
        raise AppError("limit_reached")
    guard.confirm(user, "autoinvest", pin, bio, usd=usd)
    now = db.now()
    t = time.gmtime(now)
    pid = db.insert("autoinvest", {"user_id": user["id"], "from_asset": frm, "to_asset": to, "amount": s(amt), "freq": freq,
                                   "weekday": t.tm_wday, "day": t.tm_mday, "next_at": next_run(freq, now, weekday=t.tm_wday, day=t.tm_mday),
                                   "active": 1, "runs": 0, "fails": 0, "invested": "0", "bought": "0", "created_at": now})
    return _out(db.one("SELECT * FROM autoinvest WHERE id=?", (pid,)))


def update(user: dict, pid: int, active: bool | None = None, delete: bool = False) -> dict:
    r = db.one("SELECT * FROM autoinvest WHERE id=? AND user_id=? AND deleted=0", (pid, user["id"]))
    if not r:
        raise AppError("not_found", 404)
    if delete:
        db.update("autoinvest", {"id": pid}, {"deleted": 1, "active": 0})
        return {"ok": True}
    if active is not None:
        nxt = next_run(r["freq"], db.now(), weekday=r["weekday"], day=r["day"]) if active else r["next_at"]
        db.update("autoinvest", {"id": pid}, {"active": 1 if active else 0, "fails": 0, "next_at": nxt, "last_error": None})
    return _out(db.one("SELECT * FROM autoinvest WHERE id=?", (pid,)))


def run_due() -> int:
    """Worker job."""
    from .notify import notify

    n = 0
    for r in db.q("SELECT * FROM autoinvest WHERE active=1 AND deleted=0 AND next_at<=? LIMIT 200", (db.now(),)):
        nxt = next_run(r["freq"], db.now(), weekday=r["weekday"], day=r["day"])
        # claim the run first so two workers can never execute it twice
        if db.x("UPDATE autoinvest SET next_at=? WHERE id=? AND next_at=?", (nxt, r["id"], r["next_at"])).rowcount != 1:
            continue
        user = users.get(r["user_id"])
        try:
            if not user or user["status"] != "active":
                raise AppError("account_restricted")
            q = swap.quote(user, r["from_asset"], r["to_asset"], r["amount"])
            res = swap.execute(user, q["id"], idem=f"ai{r['id']}-{r['next_at']}")
            db.update("autoinvest", {"id": r["id"]}, {"runs": r["runs"] + 1, "fails": 0, "last_error": None, "last_run": db.now(),
                                                      "invested": s(D(r["invested"]) + D(res["amount_in"])),
                                                      "bought": s(D(r["bought"]) + D(res["amount_out"]))})
            notify(r["user_id"], "autoinvest_done", path=f"/tx/{res['id']}", amount=res["amount_out"], asset=r["to_asset"],
                   spent=res["amount_in"], from_asset=r["from_asset"], priority=7)
            n += 1
        except AppError as e:
            fails = r["fails"] + 1
            db.update("autoinvest", {"id": r["id"]}, {"fails": fails, "last_error": e.code, "active": 0 if fails >= 3 else 1})
            if user:
                notify(r["user_id"], "autoinvest_failed", path="/autoinvest", asset=r["to_asset"], from_asset=r["from_asset"])
    return n
