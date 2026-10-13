"""Admin authentication + role-based permissions.

Ways in: (1) open the admin panel from the bot inside Telegram (initData of an admin), or (2) send /admin to the bot and
use the one-time link (5 minutes, single use) from any browser. Both yield a 12-hour signed session token.
"""
import hashlib
import secrets

from . import config, db
from .money import AppError
from .security import make_token, read_token, verify_init_data

ROLES = {
    "owner": {"*"},
    "admin": {"view", "users", "finance", "withdrawals", "p2p", "support", "settings", "content", "catalog", "fees"},
    "finance": {"view", "finance", "withdrawals", "users_view"},
    "support": {"view", "support", "p2p", "users_view"},
    "viewer": {"view"},
}
SESSION_TTL = 12 * 3600


def role_of(user_id: int) -> str | None:
    if user_id in config.OWNER_IDS:
        return "owner"
    r = db.one("SELECT role FROM admins WHERE user_id=?", (user_id,))
    return r["role"] if r else None


def can(role: str, perm: str) -> bool:
    perms = ROLES.get(role, set())
    if "*" in perms or perm in perms:
        return True
    return perm == "users_view" and "users" in perms


def issue_login_link(admin_id: int) -> str:
    tok = secrets.token_urlsafe(24)
    db.insert("admin_tokens", {"token_hash": hashlib.sha256(tok.encode()).hexdigest(), "admin_id": admin_id, "expires_at": db.now() + 300})
    return f"{config.WEBAPP_URL}/admin/#login={tok}"


def exchange_login(tok: str) -> dict:
    h = hashlib.sha256((tok or "").encode()).hexdigest()
    with db.tx():
        r = db.one("SELECT * FROM admin_tokens WHERE token_hash=?", (h,))
        if not r or r["used"] or r["expires_at"] < db.now():
            raise AppError("auth_invalid", 401)
        db.x("UPDATE admin_tokens SET used=1 WHERE token_hash=?", (h,))
    return session_for(r["admin_id"])


def login_with_init_data(init_data: str) -> dict:
    data = verify_init_data(init_data)
    return session_for(int(data["user"]["id"]))


def session_for(admin_id: int) -> dict:
    role = role_of(admin_id)
    if not role:
        raise AppError("forbidden", 403)
    return {"token": make_token({"aid": admin_id, "role": role}, SESSION_TTL, "admin"), "role": role, "admin_id": admin_id,
            "expires_in": SESSION_TTL}


def check(token: str, perm: str) -> dict:
    body = read_token(token, "admin")
    role = role_of(int(body["aid"]))  # re-check: a removed admin loses access immediately
    if not role:
        raise AppError("forbidden", 403)
    if not can(role, perm):
        raise AppError("forbidden", 403)
    return {"id": int(body["aid"]), "role": role}


def audit(admin: dict, action: str, target: str | None = None, data=None, ip: str | None = None):
    db.insert("audit_log", {"actor": admin.get("role", "admin"), "actor_id": admin.get("id"), "action": action, "target": target,
                            "data": data if data is not None else None, "ip": ip, "created_at": db.now()})
