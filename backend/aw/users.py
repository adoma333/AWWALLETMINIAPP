"""Users: zero-input registration from Telegram identity, referral linking, profile, verification levels."""
import re
import time

from . import db, settings
from .money import AppError, ref_id
from .security import sha

SUPPORTED_LANGS = ["en", "ar", "ru", "tr", "fa", "fr", "es", "pt", "de", "id", "hi", "zh", "uk", "uz"]


def detect_lang(tg_lang: str | None) -> str:
    code = (tg_lang or "").lower().replace("_", "-")
    base = code.split("-")[0]
    if base in SUPPORTED_LANGS:
        return base
    if base in ("ur", "ps", "ku", "ckb"):
        return "ar" if base in ("ku", "ckb") else "fa"
    if base in ("be", "kk", "ky", "tg"):
        return "ru"
    if base in ("ms",):
        return "id"
    if base in ("az", "tk"):
        return "tr"
    return settings.get("general").get("default_lang", "en")


def _new_ref_code() -> str:
    for _ in range(20):
        code = ref_id("", 7)
        if not db.one("SELECT 1 FROM users WHERE ref_code=?", (code,)):
            return code
    return ref_id("", 10)


def get(uid: int) -> dict | None:
    u = db.one("SELECT * FROM users WHERE id=?", (uid,))
    if u:
        u["settings"] = db.jl(u.get("settings"))
        u["flags"] = db.jl(u.get("flags"))
    return u


def must(uid: int) -> dict:
    u = get(uid)
    if not u:
        raise AppError("user_not_found", 404)
    return u


def find(query: str) -> dict | None:
    """Find a user by @username, numeric Telegram id or referral code."""
    q = (query or "").strip()
    if not q:
        return None
    if q.startswith("@"):
        q = q[1:]
    if q.isdigit():
        u = get(int(q))
        if u:
            return u
    if re.fullmatch(r"[A-Za-z0-9_]{3,32}", q):
        r = db.one("SELECT id FROM users WHERE username=? COLLATE NOCASE", (q,))
        if r:
            return get(r["id"])
        r = db.one("SELECT id FROM users WHERE ref_code=?", (q.upper(),))
        if r:
            return get(r["id"])
    return None


def upsert_from_telegram(tg: dict, start_param: str | None = None, ip: str | None = None, platform: str | None = None) -> tuple[dict, bool]:
    """Create or refresh a user from verified Telegram data. Returns (user, created)."""
    uid = int(tg["id"])
    now = db.now()
    created = False
    fields = {
        "username": (tg.get("username") or None),
        "first_name": (tg.get("first_name") or "")[:64],
        "last_name": (tg.get("last_name") or "")[:64],
        "photo_url": (tg.get("photo_url") or None),
        "is_premium": 1 if tg.get("is_premium") else 0,
        "tg_lang": tg.get("language_code") or None,
        "last_seen": now,
    }
    if ip:
        fields["last_ip"] = sha(ip)[:32]
    with db.tx():
        existing = db.one("SELECT id, username, lang FROM users WHERE id=?", (uid,))
        if existing:
            # a username moves to whoever owns it now on Telegram
            if fields["username"]:
                db.x("UPDATE users SET username=NULL WHERE username=? COLLATE NOCASE AND id<>?", (fields["username"], uid))
            db.update("users", {"id": uid}, fields)
        else:
            created = True
            if fields["username"]:
                db.x("UPDATE users SET username=NULL WHERE username=? COLLATE NOCASE", (fields["username"],))
            referrer = _resolve_referrer(start_param, uid)
            db.insert("users", {
                "id": uid, **fields, "lang": detect_lang(fields["tg_lang"]), "ref_code": _new_ref_code(),
                "referred_by": referrer["id"] if referrer else None,
                "ref_level2": referrer["referred_by"] if referrer else None,
                "created_at": now, "settings": {}, "flags": {},
            })
        db.insert("login_events", {"user_id": uid, "ip": fields.get("last_ip"), "platform": platform, "created_at": now})
    user = get(uid)
    if created:
        from . import events

        events.emit("registered", uid, referrer=user.get("referred_by"))
    return user, created


def _resolve_referrer(start_param: str | None, uid: int) -> dict | None:
    if not start_param:
        return None
    code = start_param.strip()
    if code.lower().startswith("ref_"):
        code = code[4:]
    code = code.upper()
    if not re.fullmatch(r"[A-Z0-9]{5,12}", code):
        return None
    r = db.one("SELECT id, referred_by FROM users WHERE ref_code=?", (code,))
    if not r or r["id"] == uid:
        return None
    return r


def display_name(u: dict) -> str:
    n = " ".join(x for x in [u.get("first_name"), u.get("last_name")] if x).strip()
    return n or (("@" + u["username"]) if u.get("username") else f"User {u['id']}")


def public(u: dict) -> dict:
    """What another user is allowed to see."""
    return {"id": u["id"], "name": display_name(u), "username": u.get("username"), "photo": u.get("photo_url"),
            "verified": (u.get("kyc_level") or 0) >= 1, "premium": bool(u.get("is_premium")),
            "merchant": u.get("role") == "merchant"}


def ensure_active(u: dict):
    if u["status"] == "banned":
        raise AppError("account_banned", 403)
    if u["status"] == "frozen":
        raise AppError("account_frozen", 403)


def set_setting(uid: int, key: str, value):
    u = must(uid)
    st = u["settings"]
    st[key] = value
    db.update("users", {"id": uid}, {"settings": st})


def set_flag(uid: int, key: str, value):
    u = must(uid)
    fl = u["flags"]
    fl[key] = value
    db.update("users", {"id": uid}, {"flags": fl})


def verify_phone(uid: int, phone: str) -> dict:
    """Level-1 verification from a Telegram contact share (the bot checks the contact belongs to the sender)."""
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) < 7:
        raise AppError("bad_phone")
    h = sha("phone:" + digits)
    sec = settings.get("security")
    with db.tx():
        owner = db.one("SELECT id FROM users WHERE phone_hash=?", (h,))
        if owner and owner["id"] != uid and sec.get("max_accounts_per_phone", 1) <= 1:
            raise AppError("phone_used")
        masked = "+" + digits[:3] + "•" * max(0, len(digits) - 5) + digits[-2:]
        u = must(uid)
        db.update("users", {"id": uid}, {"phone_hash": h, "phone_masked": masked, "kyc_level": max(1, u["kyc_level"] or 0)})
    from . import events

    events.emit("phone", uid)
    return must(uid)


def account_age_hours(u: dict) -> float:
    return (time.time() - (u.get("created_at") or time.time())) / 3600
