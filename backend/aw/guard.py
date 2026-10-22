"""Authorisation guards for money-moving actions: PIN / biometric confirmation, limits, kill-switches, idempotency."""
import json
from decimal import Decimal

from . import db, fees, settings
from .money import ZERO, AppError, D
from .security import check_pin, hash_pin, sha, validate_new_pin


# ───────────── feature switches ─────────────
def feature(name: str):
    g = settings.get("general")
    if g.get("maintenance"):
        raise AppError("maintenance", 503)
    if not g.get("features", {}).get(name, False):
        raise AppError("feature_disabled", 403, feature=name)


# ───────────── PIN & biometrics ─────────────
def set_pin(user: dict, new_pin: str, old_pin: str | None = None, reset: bool = False):
    validate_new_pin(new_pin)
    if user.get("pin_hash") and not reset:
        verify_pin(user, old_pin or "")
    hold = 0
    if user.get("pin_hash"):  # changing/resetting an existing PIN → temporary withdrawal hold (anti account-takeover)
        hold = db.now() + int(settings.get("security").get("hold_after_pin_reset_hours", 24)) * 3600
    data = {"pin_hash": hash_pin(new_pin), "pin_set_at": db.now(), "pin_fails": 0, "pin_locked_until": 0}
    if hold:
        data["security_hold_until"] = max(hold, user.get("security_hold_until") or 0)
    if reset:
        data["bio_token_hash"] = None
    db.update("users", {"id": user["id"]}, data)


def verify_pin(user: dict, pin: str):
    sec = settings.get("security")
    now = db.now()
    if (user.get("pin_locked_until") or 0) > now:
        raise AppError("pin_locked", 423, until=user["pin_locked_until"])
    if not user.get("pin_hash"):
        raise AppError("pin_not_set", 428)
    if check_pin(str(pin or ""), user["pin_hash"]):
        if user.get("pin_fails"):
            db.update("users", {"id": user["id"]}, {"pin_fails": 0})
        return True
    fails = (user.get("pin_fails") or 0) + 1
    data = {"pin_fails": fails}
    max_f = int(sec.get("pin_max_fails", 5))
    if fails >= max_f:
        data["pin_locked_until"] = now + int(sec.get("pin_lock_minutes", 30)) * 60
        data["pin_fails"] = 0
    db.update("users", {"id": user["id"]}, data)
    if fails >= max_f:
        raise AppError("pin_locked", 423, until=data["pin_locked_until"])
    raise AppError("pin_wrong", 403, left=max_f - fails)


def enable_biometric(user: dict, token: str):
    if not token or len(token) < 32:
        raise AppError("bad_request")
    db.update("users", {"id": user["id"]}, {"bio_token_hash": sha("bio:" + token)})


def confirm(user: dict, action: str, pin: str | None = None, bio: str | None = None, usd: Decimal = ZERO):
    """Require the user's second factor for an action when the security policy says so."""
    sec = settings.get("security")
    required = action in sec.get("pin_required", [])
    if action == "transfer":
        thr = D(sec.get("transfer_pin_threshold_usd", 0))
        required = required and (thr <= 0 or usd >= thr)
    if not required:
        return
    if bio and user.get("bio_token_hash") and sha("bio:" + bio) == user["bio_token_hash"]:
        return
    if not user.get("pin_hash"):
        raise AppError("pin_not_set", 428)
    verify_pin(user, pin or "")


# ───────────── limits ─────────────
def _used_usd(user_id: int, types: tuple, hours: int = 24) -> Decimal:
    since = db.now() - hours * 3600
    marks = ",".join("?" for _ in types)
    total = ZERO
    for r in db.q(f"SELECT usd_value FROM txs WHERE user_id=? AND type IN ({marks}) AND created_at>=? "
                  "AND status NOT IN ('failed','rejected','cancelled')", (user_id, *types, since)):
        total += D(r["usd_value"])
    return total


def limits_for(user: dict) -> dict:
    cfg = settings.get("limits")
    lvl = str(min(int(user.get("kyc_level") or 0), 2))
    base = cfg["levels"].get(lvl) or cfg["levels"]["0"]
    mult = fees.vip(user)["limit_multiplier"]
    custom = (user.get("flags") or {}).get("limits") or {}
    out = {k: D(custom.get(k, v)) * (mult if k not in custom else 1) for k, v in base.items()}
    return out


def _kyc_can_raise(user: dict) -> bool:
    """True when identity verification would give this user a higher limit (the app then offers it)."""
    return (user.get("kyc_level") or 0) < 2 and bool(settings.get("kyc").get("enabled", True))


def check_limit(user: dict, kind: str, usd: Decimal):
    lim = limits_for(user)
    if kind == "withdraw":
        if usd > lim["withdraw_single"]:
            raise AppError("limit_single", max_usd=str(lim["withdraw_single"]), kyc=_kyc_can_raise(user))
        if _used_usd(user["id"], ("withdraw",)) + usd > lim["withdraw_daily"]:
            raise AppError("limit_daily", max_usd=str(lim["withdraw_daily"]), kyc=_kyc_can_raise(user))
    elif kind == "transfer":
        if _used_usd(user["id"], ("send", "gift_out")) + usd > lim["transfer_daily"]:
            raise AppError("limit_daily", max_usd=str(lim["transfer_daily"]), kyc=_kyc_can_raise(user))
    elif kind == "p2p":
        if _used_usd(user["id"], ("p2p_buy", "p2p_sell")) + usd > lim["p2p_daily"]:
            raise AppError("limit_daily", max_usd=str(lim["p2p_daily"]), kyc=_kyc_can_raise(user))


def usage(user: dict) -> dict:
    lim = limits_for(user)
    return {
        "withdraw_daily": str(lim["withdraw_daily"]), "withdraw_used": str(_used_usd(user["id"], ("withdraw",)).quantize(Decimal("0.01"))),
        "withdraw_single": str(lim["withdraw_single"]),
        "transfer_daily": str(lim["transfer_daily"]), "transfer_used": str(_used_usd(user["id"], ("send", "gift_out")).quantize(Decimal("0.01"))),
        "p2p_daily": str(lim["p2p_daily"]), "p2p_used": str(_used_usd(user["id"], ("p2p_buy", "p2p_sell")).quantize(Decimal("0.01"))),
    }


# ───────────── idempotency (call inside the money transaction) ─────────────
def idem_seen(user_id: int, key: str | None):
    if not key:
        return None
    r = db.one("SELECT result FROM idempotency WHERE key=? AND user_id=?", (key[:80], user_id))
    return json.loads(r["result"]) if r else None


def idem_store(user_id: int, key: str | None, result: dict):
    if key:
        db.x("INSERT OR IGNORE INTO idempotency(key, user_id, result, created_at) VALUES(?,?,?,?)",
             (key[:80], user_id, json.dumps(result, default=str), db.now()))
