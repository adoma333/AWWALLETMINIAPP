"""App releases: Android, Windows and macOS builds made by GitHub Actions are uploaded here and served from /dl/.

The workflow authenticates with the release key (derived from the server secrets, shown to the owner in the admin
panel). The Android signing key is created on the first build and stored here encrypted, so every later APK is signed
with the same key and installs as an update.
"""
import hashlib
import hmac
import json
import os
import re
from pathlib import Path

from . import config, db
from .money import AppError
from .notify import admin_alert
from .security import seal, unseal

DIR = Path(os.getenv("AW_RELEASES_DIR", str(config.DATA_DIR.parent / "releases")))  # public files only (nginx serves /dl/)
FILES = {"zohra-wallet.apk": "android", "zohra-wallet-windows.zip": "windows", "zohra-wallet-mac-arm64.zip": "mac_arm",
         "zohra-wallet-mac-x64.zip": "mac_x64"}
MAX_BYTES = 400 * 1024 * 1024


def release_key() -> str:
    return "zr_" + hmac.new((config.SESSION_SECRET or "zohra").encode(), b"releases", hashlib.sha256).hexdigest()[:40]


def check_key(key: str):
    if not key or not hmac.compare_digest(key, release_key()):
        raise AppError("unauthorized", 401)


def _manifest_path():
    return DIR / "latest.json"


def latest() -> dict:
    try:
        return json.loads(_manifest_path().read_text())
    except (OSError, ValueError):
        return {"version": None, "files": {}}


async def upload(name: str, stream) -> dict:
    if name not in FILES:
        raise AppError("bad_request")
    DIR.mkdir(parents=True, exist_ok=True)
    tmp = DIR / (name + ".part")
    size, h = 0, hashlib.sha256()
    with open(tmp, "wb") as f:
        async for chunk in stream:
            size += len(chunk)
            if size > MAX_BYTES:
                f.close()
                tmp.unlink(missing_ok=True)
                raise AppError("file_too_large")
            h.update(chunk)
            f.write(chunk)
    if size == 0:
        tmp.unlink(missing_ok=True)
        raise AppError("bad_request")
    tmp.replace(DIR / name)
    return {"name": name, "size": size, "sha256": h.hexdigest()}


def publish(version: str, notes: str = "") -> dict:
    if not re.fullmatch(r"\d{1,3}\.\d{1,3}\.\d{1,4}", version or ""):
        raise AppError("bad_request")
    m = latest()
    files = m.get("files") or {}
    for name, key in FILES.items():
        p = DIR / name
        if p.exists() and p.stat().st_mtime > (m.get("published_ts") or 0) - 1:
            sha = hashlib.sha256(p.read_bytes()).hexdigest() if p.stat().st_size < 50 * 1024 * 1024 else None
            files[key] = {"url": f"/dl/{name}?v={version}", "size": p.stat().st_size, "version": version, "sha256": sha}
    m.update({"version": version, "notes": (notes or "")[:2000], "files": files, "published_at": db.now(), "published_ts": db.now()})
    _manifest_path().write_text(json.dumps(m, indent=2))
    links = "\n".join(f"• {k}: {config.WEBAPP_URL}{v['url']}" for k, v in files.items() if v.get("version") == version)
    admin_alert(f"📦 Zohra Wallet {version} is published\n{links}\nDownload page: {config.WEBAPP_URL}/get/", "info", "release")
    return m


# ───────────── Android signing key (kept server-side, encrypted) ─────────────
def keystore() -> dict | None:
    from .chains.base import state_get

    raw = state_get("release:keystore", "")
    if not raw:
        return None
    return json.loads(unseal(raw))


def store_keystore(b64: str, password: str):
    from .chains.base import state_set

    if keystore():
        raise AppError("bad_state")  # never replace a signing key: Android would refuse the next update
    if not re.fullmatch(r"[A-Za-z0-9+/=\s]{100,20000}", b64 or "") or not re.fullmatch(r"[A-Za-z0-9]{16,64}", password or ""):
        raise AppError("bad_request")
    state_set("release:keystore", seal(json.dumps({"b64": re.sub(r"\s", "", b64), "password": password})))
