"""Security primitives: Telegram initData verification, PIN hashing, field encryption, sessions, rate limiting."""
import base64
import hashlib
import hmac
import json
import os
import threading
import time
from collections import defaultdict, deque
from urllib.parse import parse_qsl

from cryptography.fernet import Fernet, InvalidToken

from . import config
from .money import AppError


# ───────────── Telegram Mini App initData ─────────────
def verify_init_data(init_data: str, bot_token: str | None = None, max_age: int | None = None) -> dict:
    """Validate the HMAC signature Telegram puts on initData. Returns the parsed fields (user decoded)."""
    bot_token = bot_token if bot_token is not None else config.BOT_TOKEN
    max_age = config.INIT_DATA_MAX_AGE if max_age is None else max_age
    if not init_data or not bot_token:
        raise AppError("auth_required", 401)
    pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=False))
    received = pairs.pop("hash", "")
    if not received:
        raise AppError("auth_invalid", 401)
    check = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        raise AppError("auth_invalid", 401)
    try:
        auth_date = int(pairs.get("auth_date", "0"))
    except ValueError:
        raise AppError("auth_invalid", 401)
    if max_age and time.time() - auth_date > max_age:
        raise AppError("auth_expired", 401)
    out = dict(pairs)
    try:
        out["user"] = json.loads(pairs.get("user", "{}"))
    except ValueError:
        raise AppError("auth_invalid", 401)
    if not isinstance(out["user"], dict) or not isinstance(out["user"].get("id"), int):
        raise AppError("auth_invalid", 401)
    return out


def sign_init_data(user: dict, bot_token: str, auth_date: int | None = None, **extra) -> str:
    """Build a valid initData string (used by tests and the local dev login)."""
    from urllib.parse import urlencode

    fields = {"auth_date": str(auth_date or int(time.time())), "user": json.dumps(user, separators=(",", ":")), **extra}
    check = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


# ───────────── PIN ─────────────
def hash_pin(pin: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.scrypt(pin.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def check_pin(pin: str, stored: str | None) -> bool:
    if not stored or not stored.startswith("scrypt$"):
        return False
    _, salt_b64, dk_b64 = stored.split("$")
    salt = base64.b64decode(salt_b64)
    dk = hashlib.scrypt(pin.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return hmac.compare_digest(dk, base64.b64decode(dk_b64))


WEAK_PINS = {"000000", "111111", "222222", "333333", "444444", "555555", "666666", "777777", "888888", "999999",
             "123456", "654321", "123123", "112233", "121212", "012345", "098765", "456789", "987654"}


def validate_new_pin(pin: str):
    if not isinstance(pin, str) or len(pin) != 6 or not pin.isdigit():
        raise AppError("pin_format")
    if pin in WEAK_PINS:
        raise AppError("pin_weak")


def sha(v: str) -> str:
    return hashlib.sha256((config.SESSION_SECRET + "|" + v).encode()).hexdigest()


# ───────────── field encryption ─────────────
def _fernet() -> Fernet:
    raw = config.SECRETS_KEY or config.WEBHOOK_SECRET or ("test-key" if config.TESTING else "")
    if not raw:
        raise RuntimeError("SECRETS_KEY missing")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("aw-wallet|" + raw).encode()).digest()))


def seal(value: str) -> str:
    return "enc:" + _fernet().encrypt(value.encode()).decode() if value else ""


def unseal(value: str) -> str:
    if not value:
        return ""
    if not value.startswith("enc:"):
        return value
    try:
        return _fernet().decrypt(value[4:].encode()).decode()
    except InvalidToken:
        return ""


# ───────────── signed tokens (admin sessions, receipts, contact picks) ─────────────
def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_token(payload: dict, ttl: int, purpose: str) -> str:
    body = dict(payload, exp=int(time.time()) + ttl, pur=purpose)
    raw = _b64(json.dumps(body, separators=(",", ":")).encode())
    sig = _b64(hmac.new(config.SESSION_SECRET.encode() or b"dev", (purpose + "." + raw).encode(), hashlib.sha256).digest())
    return raw + "." + sig


def read_token(token: str, purpose: str) -> dict:
    try:
        raw, sig = token.split(".")
    except (ValueError, AttributeError):
        raise AppError("auth_invalid", 401)
    want = _b64(hmac.new(config.SESSION_SECRET.encode() or b"dev", (purpose + "." + raw).encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(want, sig):
        raise AppError("auth_invalid", 401)
    body = json.loads(_unb64(raw))
    if body.get("pur") != purpose or body.get("exp", 0) < time.time():
        raise AppError("auth_expired", 401)
    return body


def receipt_sig(tx_id: str, user_id: int, amount: str, asset: str) -> str:
    msg = f"{tx_id}|{user_id}|{amount}|{asset}".encode()
    return hmac.new((config.SESSION_SECRET or "dev").encode(), msg, hashlib.sha256).hexdigest()[:20]


# ───────────── rate limiting (in-process sliding window) ─────────────
class RateLimiter:
    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window: float = 60.0) -> bool:
        now = time.monotonic()
        with self._lock:
            dq = self._hits[key]
            while dq and now - dq[0] > window:
                dq.popleft()
            if len(dq) >= limit:
                return False
            dq.append(now)
            if len(self._hits) > 50000:  # bound memory
                for k in list(self._hits)[:10000]:
                    if not self._hits[k]:
                        del self._hits[k]
            return True

    def check(self, key: str, limit: int, window: float = 60.0):
        if not self.hit(key, limit, window):
            raise AppError("rate_limited", 429)


limiter = RateLimiter()
