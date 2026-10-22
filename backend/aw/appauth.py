"""Sign-in outside Telegram (web, Android, Windows, macOS).

* Telegram: the app asks for a one-time code and opens t.me/<bot>?start=login_<code>; the bot shows the device and asks
  the user to approve. The app polls with the code (which only it knows) and receives its own session.
* Device hand-off: apps that cannot run Google sign-in themselves (Google blocks embedded browsers) open
  <site>/#/signin?device=<code> in the system browser; once the user signs in there the code is approved the same way.
* Google: an ID token from Google Identity Services is verified with Google, then mapped to an account (linked from a
  Telegram account, or created when sign-up with Google is allowed).
Sessions are random bearer tokens; only their SHA-256 is stored. Money actions still require the PIN.
"""
import hashlib
import secrets

import httpx

from . import config, db, settings, users
from .money import AppError

SESSION_DAYS = 60
CODE_TTL = 300
GOOGLE_ID_BASE = 10 ** 13  # accounts created with Google get ids far above any Telegram user id


def _h(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


# ───────────── sessions ─────────────
def issue(user_id: int, device: str = "", ip: str | None = None) -> dict:
    tok = "zs_" + secrets.token_urlsafe(32)
    now = db.now()
    db.insert("app_sessions", {"token_hash": _h(tok), "user_id": user_id, "device": (device or "")[:80], "ip": ip,
                               "created_at": now, "last_seen": now, "expires_at": now + SESSION_DAYS * 86400})
    return {"token": tok, "expires_at": now + SESSION_DAYS * 86400}


def user_for(token: str) -> dict | None:
    if not token.startswith("zs_"):
        return None
    r = db.one("SELECT * FROM app_sessions WHERE token_hash=?", (_h(token),))
    if not r or r["revoked"] or r["expires_at"] < db.now():
        return None
    if db.now() - (r["last_seen"] or 0) > 300:
        db.x("UPDATE app_sessions SET last_seen=?, expires_at=? WHERE token_hash=?",
             (db.now(), db.now() + SESSION_DAYS * 86400, r["token_hash"]))  # sliding expiry
    u = users.get(r["user_id"])
    if u:
        u["_session"] = r["token_hash"][:16]
    return u


def revoke(token: str):
    db.x("UPDATE app_sessions SET revoked=1 WHERE token_hash=?", (_h(token),))


def list_sessions(user_id: int) -> list[dict]:
    return db.q("SELECT substr(token_hash,1,16) AS id, device, created_at, last_seen FROM app_sessions "
                "WHERE user_id=? AND revoked=0 AND expires_at>? ORDER BY last_seen DESC", (user_id, db.now()))


def revoke_id(user_id: int, sid: str):
    db.x("UPDATE app_sessions SET revoked=1 WHERE user_id=? AND substr(token_hash,1,16)=?", (user_id, sid[:16]))


# ───────────── one-time login codes (Telegram approval / device hand-off) ─────────────
def start(kind: str, device: str, ip: str | None) -> dict:
    if kind not in ("telegram", "device"):
        raise AppError("bad_request")
    code = secrets.token_urlsafe(18).replace("-", "x").replace("_", "y")  # Telegram start payloads allow [A-Za-z0-9_-]
    db.insert("login_codes", {"code_hash": _h(code), "kind": kind, "device": (device or "")[:80], "ip": ip, "status": "pending",
                              "created_at": db.now(), "expires_at": db.now() + CODE_TTL})
    out = {"code": code, "expires_in": CODE_TTL}
    if kind == "telegram" and config.BOT_USERNAME:
        out["url"] = f"https://t.me/{config.BOT_USERNAME}?start=login_{code}"
    if kind == "device":
        out["url"] = f"{config.WEBAPP_URL}/#/signin?device={code}"
    return out


def pending(code: str) -> dict | None:
    r = db.one("SELECT * FROM login_codes WHERE code_hash=?", (_h(code or ""),))
    if not r or r["status"] != "pending" or r["expires_at"] < db.now():
        return None
    return r


def approve(code: str, user_id: int) -> dict:
    r = pending(code)
    if not r:
        raise AppError("login_expired")
    db.x("UPDATE login_codes SET status='approved', user_id=? WHERE code_hash=? AND status='pending'", (user_id, r["code_hash"]))
    return {"ok": True, "device": r["device"]}


def deny(code: str):
    db.x("UPDATE login_codes SET status='denied' WHERE code_hash=? AND status='pending'", (_h(code or ""),))


def poll(code: str, ip: str | None) -> dict:
    """The app asks whether its code was approved; on approval it gets a session exactly once."""
    r = db.one("SELECT * FROM login_codes WHERE code_hash=?", (_h(code or ""),))
    if not r or r["expires_at"] < db.now() - 60:
        return {"status": "expired"}
    if r["status"] != "approved":
        return {"status": "expired" if r["expires_at"] < db.now() else r["status"]}
    if not db.x("UPDATE login_codes SET status='used' WHERE code_hash=? AND status='approved'", (r["code_hash"],)).rowcount:
        return {"status": "used"}
    u = users.must(r["user_id"])
    if u["status"] == "banned":
        raise AppError("account_banned", 403)
    return {"status": "approved", **issue(u["id"], r["device"], ip)}


# ───────────── Google ─────────────
def _google_claims(credential: str) -> dict:
    cid = (settings.get("auth").get("google_client_id") or "").strip()
    if not cid:
        raise AppError("feature_disabled")
    r = HTTP["get"]("https://oauth2.googleapis.com/tokeninfo", {"id_token": credential})
    if r.get("aud") != cid or r.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise AppError("google_invalid")
    if str(r.get("email_verified")).lower() != "true" or int(r.get("exp") or 0) < db.now():
        raise AppError("google_invalid")
    return r


def _get(url: str, params: dict) -> dict:
    res = httpx.get(url, params=params, timeout=10)
    if res.status_code != 200:
        raise AppError("google_invalid")
    return res.json()


HTTP = {"get": _get}  # replaced in tests


def google_login(credential: str, device: str, ip: str | None) -> dict:
    c = _google_claims(credential)
    link = db.one("SELECT user_id FROM identities WHERE provider='google' AND subject=?", (c["sub"],))
    created = False
    if link:
        uid = link["user_id"]
    else:
        if not settings.get("auth").get("google_signup", True):
            raise AppError("google_not_linked")
        with db.tx():
            uid = max(GOOGLE_ID_BASE, int(db.val("SELECT MAX(id) FROM users", (), 0) or 0)) + 1
            users.upsert_from_telegram({"id": uid, "first_name": (c.get("given_name") or c.get("name") or "")[:64],
                                        "last_name": (c.get("family_name") or "")[:64], "photo_url": c.get("picture"),
                                        "language_code": (c.get("locale") or "")[:2]}, ip=ip, platform="google")
            db.insert("identities", {"provider": "google", "subject": c["sub"], "user_id": uid, "email": c.get("email"), "created_at": db.now()})
            db.x("UPDATE users SET dm_ok=0 WHERE id=?", (uid,))  # no Telegram chat: notifications stay in the app
        created = True
    u = users.must(uid)
    if u["status"] == "banned":
        raise AppError("account_banned", 403)
    return {**issue(uid, device, ip), "created": created}


def link_google(user: dict, credential: str) -> dict:
    c = _google_claims(credential)
    other = db.one("SELECT user_id FROM identities WHERE provider='google' AND subject=?", (c["sub"],))
    if other and other["user_id"] != user["id"]:
        raise AppError("google_in_use")
    db.x("INSERT OR REPLACE INTO identities(provider, subject, user_id, email, created_at) VALUES('google',?,?,?,?)",
         (c["sub"], user["id"], c.get("email"), db.now()))
    return {"ok": True, "email": c.get("email")}


def identities(user_id: int) -> list[dict]:
    return db.q("SELECT provider, email, created_at FROM identities WHERE user_id=?", (user_id,))
