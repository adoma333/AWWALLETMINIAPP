"""Uploads (chat proofs, ticket screenshots, KYC, admin icons/banners). Content-type is decided by magic bytes, names are
random 128-bit capability ids, SVG is admin-only and scrubbed of scripts."""
import base64
import re
import secrets

from . import config
from .money import AppError

MAX_BYTES = 6 * 1024 * 1024
FOLDERS = {"chat", "tickets", "kyc", "icons", "banners", "brand"}


def _kind(b: bytes) -> str | None:
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if b[:3] == b"\xff\xd8\xff":
        return "jpg"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "webp"
    if b[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    head = b[:512].lstrip().lower()
    if head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in b[:2048].lower()):
        return "svg"
    if b[:4] == b"%PDF":
        return "pdf"
    return None


def save(data: str, folder: str, allow_svg: bool = False, allow_pdf: bool = False) -> str:
    if folder not in FOLDERS:
        raise AppError("bad_request")
    m = re.match(r"^data:[\w/+.-]+;base64,(.*)$", data or "", re.S)
    raw_b64 = m.group(1) if m else (data or "")
    try:
        raw = base64.b64decode(raw_b64, validate=False)
    except Exception:
        raise AppError("bad_file")
    return save_bytes(raw, folder, allow_svg, allow_pdf)


def save_bytes(raw: bytes, folder: str, allow_svg: bool = False, allow_pdf: bool = False) -> str:
    if folder not in FOLDERS:
        raise AppError("bad_request")
    if not raw or len(raw) > MAX_BYTES:
        raise AppError("file_too_large")
    kind = _kind(raw)
    if kind is None or (kind == "svg" and not allow_svg) or (kind == "pdf" and not allow_pdf):
        raise AppError("bad_file")
    if kind == "svg":
        txt = raw.decode("utf-8", "ignore")
        if re.search(r"<script|on\w+\s*=|javascript:|<foreignObject|<iframe", txt, re.I):
            raise AppError("bad_file")
    d = config.UPLOAD_DIR / folder
    d.mkdir(parents=True, exist_ok=True)
    name = f"{secrets.token_hex(16)}.{kind}"
    (d / name).write_bytes(raw)
    return f"{folder}/{name}"


def path_for(rel: str):
    if not re.fullmatch(r"[a-z]+/[0-9a-f]{32}\.(png|jpg|webp|gif|svg|pdf)", rel or ""):
        raise AppError("not_found", 404)
    p = config.UPLOAD_DIR / rel
    if not p.exists():
        raise AppError("not_found", 404)
    return p


MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp", "gif": "image/gif", "svg": "image/svg+xml", "pdf": "application/pdf"}


def url(rel: str | None) -> str | None:
    return f"/api/files/{rel}" if rel else None

