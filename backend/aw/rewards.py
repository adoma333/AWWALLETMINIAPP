"""Rewards: fee-free vouchers, first-transaction bonus, welcome gift, daily check-in streaks and missions.

All rewards are fee vouchers (never free money), so the platform's cost is bounded and predictable. Everything is
configured in settings.rewards from the admin panel.
"""
from datetime import date, datetime, timedelta, timezone

from . import db, events, settings
from .money import AppError
from .notify import notify


def _title(spec: dict, lang: str = "en") -> str:
    kinds = ", ".join(spec.get("kinds") or [])
    if spec.get("kind") == "fee_free":
        return f"{spec.get('uses', 1)}× fee-free ({kinds})"
    if spec.get("kind") == "fee_discount":
        return f"{spec.get('uses', 1)}× {spec.get('value', '0')}% off fees ({kinds})"
    return spec.get("kind", "reward")


def grant(user_id: int, spec: dict, source: str, silent: bool = False) -> int | None:
    if not spec or spec.get("kind") not in ("fee_free", "fee_discount"):
        return None
    days = int(spec.get("days") or 30)
    vid = db.insert("vouchers", {
        "user_id": user_id, "kind": spec["kind"], "kinds": spec.get("kinds") or [], "value": str(spec.get("value", "100")),
        "uses_left": int(spec.get("uses") or 1), "source": source, "expires_at": db.now() + days * 86400, "created_at": db.now(),
    })
    if not silent:
        notify(user_id, "reward", path="/rewards", title=_title(spec))
    return vid


def _achieve(user_id: int, key: str) -> bool:
    """True the first time only (atomic)."""
    return db.x("INSERT OR IGNORE INTO achievements(user_id, key, created_at) VALUES(?,?,?)", (user_id, key, db.now())).rowcount == 1


@events.on("registered")
def _welcome(_n, user_id: int, **_):
    cfg = settings.get("rewards")
    if cfg.get("enabled") and cfg.get("welcome", {}).get("enabled") and _achieve(user_id, "welcome"):
        grant(user_id, cfg["welcome"]["reward"], "welcome", silent=True)


@events.on("*")
def _missions(name: str, user_id: int, **data):
    cfg = settings.get("rewards")
    if not cfg.get("enabled"):
        return
    if name in ("deposit", "swap", "transfer", "p2p_completed") and cfg.get("first_tx", {}).get("enabled"):
        if _achieve(user_id, "first_tx"):
            grant(user_id, cfg["first_tx"]["reward"], "first_tx")
    for m in cfg.get("missions", []):
        if m.get("event") != name or m.get("enabled") is False:
            continue
        row = db.one("SELECT * FROM user_missions WHERE user_id=? AND mission=?", (user_id, m["id"]))
        if row and row["completed_at"]:
            continue
        progress = (row["progress"] if row else 0) + 1
        done = progress >= int(m.get("target", 1))
        db.x("INSERT INTO user_missions(user_id, mission, progress, completed_at) VALUES(?,?,?,?) "
             "ON CONFLICT(user_id, mission) DO UPDATE SET progress=excluded.progress, completed_at=excluded.completed_at",
             (user_id, m["id"], progress, db.now() if done else None))


def claim_mission(user: dict, mission_id: str) -> dict:
    cfg = settings.get("rewards")
    m = next((x for x in cfg.get("missions", []) if x["id"] == mission_id), None)
    if not m:
        raise AppError("not_found", 404)
    with db.tx():
        n = db.x("UPDATE user_missions SET claimed_at=? WHERE user_id=? AND mission=? AND completed_at IS NOT NULL AND claimed_at IS NULL",
                 (db.now(), user["id"], mission_id)).rowcount
        if n != 1:
            raise AppError("mission_not_ready")
        grant(user["id"], m["reward"], f"mission:{mission_id}", silent=True)
    return {"ok": True}


def _today() -> date:
    return datetime.now(timezone.utc).date()


def streak(user_id: int) -> int:
    days = {r["day"] for r in db.q("SELECT day FROM checkins WHERE user_id=? ORDER BY day DESC LIMIT 400", (user_id,))}
    d = _today()
    if d.isoformat() not in days:
        d -= timedelta(days=1)
    n = 0
    while d.isoformat() in days:
        n += 1
        d -= timedelta(days=1)
    return n


def checkin(user: dict) -> dict:
    cfg = settings.get("rewards").get("checkin", {})
    if not cfg.get("enabled"):
        raise AppError("feature_disabled")
    today = _today().isoformat()
    inserted = db.x("INSERT OR IGNORE INTO checkins(user_id, day) VALUES(?,?)", (user["id"], today)).rowcount == 1
    st = streak(user["id"])
    rewarded = False
    every = int(cfg.get("streak_days", 7))
    if inserted and every and st % every == 0:
        grant(user["id"], cfg.get("reward"), f"streak:{today}")
        rewarded = True
    return {"streak": st, "today": True, "rewarded": rewarded, "every": every}


def overview(user: dict) -> dict:
    cfg = settings.get("rewards")
    lang = user.get("lang") or "en"
    ms = {r["mission"]: r for r in db.q("SELECT * FROM user_missions WHERE user_id=?", (user["id"],))}
    missions = []
    for m in cfg.get("missions", []):
        if m.get("enabled") is False:
            continue
        r = ms.get(m["id"]) or {}
        title = m.get("title", {})
        missions.append({"id": m["id"], "title": title.get(lang) or title.get("en") or m["id"], "target": int(m.get("target", 1)),
                         "progress": min(r.get("progress", 0), int(m.get("target", 1))), "completed": bool(r.get("completed_at")),
                         "claimed": bool(r.get("claimed_at")), "reward": m.get("reward"), "event": m.get("event")})
    vouchers = db.q("SELECT id, kind, kinds, value, uses_left, source, expires_at, created_at FROM vouchers WHERE user_id=? "
                    "AND uses_left>0 AND (expires_at IS NULL OR expires_at>?) ORDER BY expires_at", (user["id"], db.now()))
    for v in vouchers:
        v["kinds"] = db.jl(v["kinds"], [])
    today_done = bool(db.one("SELECT 1 FROM checkins WHERE user_id=? AND day=?", (user["id"], _today().isoformat())))
    ck = cfg.get("checkin", {})
    return {"enabled": cfg.get("enabled", True), "missions": missions, "vouchers": vouchers,
            "checkin": {"enabled": ck.get("enabled", False), "streak": streak(user["id"]), "today": today_done,
                        "every": int(ck.get("streak_days", 7)), "reward": ck.get("reward")},
            "first_tx": {"enabled": cfg.get("first_tx", {}).get("enabled", False), "reward": cfg.get("first_tx", {}).get("reward"),
                         "done": bool(db.one("SELECT 1 FROM achievements WHERE user_id=? AND key='first_tx'", (user["id"],)))}}
