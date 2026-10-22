"""Identity verification: ICAO 9303 MRZ parsing/validation, submission, review and private document storage.

The phone scans the document and reads its MRZ (machine-readable zone) with on-device OCR. The server never trusts that
reading: it re-parses the MRZ, recomputes every check digit, compares it with the fields the user confirmed, checks
expiry, age and whether the same document is already verified on another account, then either queues the request for
a human reviewer or (only when the owner enables it and nothing is flagged) approves it automatically.
Personal data is stored encrypted; document images are never served publicly (admins get short-lived signed links).
"""
import hashlib
import hmac
import json
import re
import time
from datetime import date

from . import config, db, files, settings, users
from .money import AppError
from .notify import admin_alert, notify
from .security import seal, unseal

WEIGHTS = (7, 3, 1)
DIGIT_FIX = str.maketrans({"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "G": "6", "B": "8", "T": "7"})
ALPHA_FIX = str.maketrans({"0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B"})


def check_digit(s: str) -> str:
    total = 0
    for i, ch in enumerate(s):
        if ch.isdigit():
            v = int(ch)
        elif "A" <= ch <= "Z":
            v = ord(ch) - 55
        else:
            v = 0  # '<'
        total += v * WEIGHTS[i % 3]
    return str(total % 10)


def _digits(s: str) -> str:
    return s.translate(DIGIT_FIX)


def _names(field: str) -> tuple[str, str]:
    sur, _, given = re.split(r"<{3,}", field)[0].partition("<<")  # anything after a long filler run is OCR noise
    clean = lambda x: re.sub(r"<+", " ", x.translate(ALPHA_FIX)).strip()  # noqa: E731
    return clean(sur), clean(given)


def _date(yymmdd: str, kind: str) -> str | None:
    if not re.fullmatch(r"\d{6}", yymmdd):
        return None
    yy, mm, dd = int(yymmdd[:2]), int(yymmdd[2:4]), int(yymmdd[4:])
    now = date.today().year % 100
    century = (1900 if yy > now else 2000) if kind == "birth" else (2000 if yy < 70 else 1900)
    try:
        return date(century + yy, mm, dd).isoformat()
    except ValueError:
        return None


def normalize(text: str) -> list[str]:
    lines = []
    for raw in (text or "").upper().replace("«", "<").splitlines():
        ln = re.sub(r"[^A-Z0-9<]", "", raw.replace(" ", ""))
        if len(ln) >= 28:
            lines.append(ln)
    return lines


def parse(text: str) -> dict:
    """Parse a TD1 (ID card, 3×30), TD2 (2×36) or TD3 (passport, 2×44) MRZ. Returns fields plus per-check validity."""
    lines = normalize(text)
    fmt = None
    if len(lines) >= 3 and all(len(x) == 30 for x in lines[-3:]):
        fmt, lines = "TD1", lines[-3:]
    elif len(lines) >= 2 and all(len(x) == 44 for x in lines[-2:]):
        fmt, lines = "TD3", lines[-2:]
    elif len(lines) >= 2 and all(len(x) == 36 for x in lines[-2:]):
        fmt, lines = "TD2", lines[-2:]
    if not fmt:
        return {"valid": False, "format": None, "error": "unrecognized"}
    if fmt == "TD1":
        l1, l2, l3 = lines
        num, num_cd, opt1 = l1[5:14], _digits(l1[14]), l1[15:30]
        if num_cd == "<" and opt1:  # long document numbers continue in the optional field
            ext = opt1.split("<")[0]
            num, num_cd = num + ext[:-1], _digits(ext[-1:])
        birth, birth_cd = _digits(l2[0:6]), _digits(l2[6])
        expiry, exp_cd = _digits(l2[8:14]), _digits(l2[14])
        composite = l1[5:30] + _digits(l2[0:7]) + _digits(l2[8:15]) + l2[18:29]
        comp_cd = _digits(l2[29])
        sur, given = _names(l3)
        out = {"doc_code": l1[0:2], "issuer": l1[2:5], "nationality": l2[15:18], "sex": l2[7], "optional": opt1.strip("<")}
    else:
        l1, l2 = lines
        num, num_cd = l2[0:9], _digits(l2[9])
        birth, birth_cd = _digits(l2[13:19]), _digits(l2[19])
        expiry, exp_cd = _digits(l2[21:27]), _digits(l2[27])
        end = 43 if fmt == "TD3" else 35
        composite = l2[0:10] + _digits(l2[13:20]) + _digits(l2[21:28]) + l2[28:end]
        comp_cd = _digits(l2[end])
        sur, given = _names(l1[5:])
        out = {"doc_code": l1[0:2], "issuer": l1[2:5], "nationality": l2[10:13], "sex": l2[20], "optional": l2[28:end].strip("<")}
        if fmt == "TD3":
            pn_cd = l2[42]
            out["personal_ok"] = pn_cd == "<" and not l2[28:42].strip("<") or check_digit(l2[28:42]) == _digits(pn_cd)
    checks = {"number": check_digit(num) == num_cd, "birth": check_digit(birth) == birth_cd, "expiry": check_digit(expiry) == exp_cd,
              "composite": check_digit(composite) == comp_cd}
    out.update({"format": fmt, "doc_number": num.replace("<", ""), "surname": sur, "given_names": given,
                "birth_date": _date(birth, "birth"), "expiry_date": _date(expiry, "expiry"), "checks": checks,
                "valid": all(checks.values()) and out.get("personal_ok", True) is not False, "lines": lines})
    out["issuer"] = out["issuer"].translate(ALPHA_FIX).replace("<", "")
    out["nationality"] = out["nationality"].translate(ALPHA_FIX).replace("<", "")
    out["sex"] = {"M": "M", "F": "F"}.get(out["sex"], "X")
    return out


def _norm(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def _secret() -> bytes:
    secret = config.SESSION_SECRET or ("test" if config.TESTING else "")
    if not secret:
        raise AppError("server_misconfigured", 500)  # never sign with a guessable key
    return secret.encode()


def doc_hash(issuer: str, number: str) -> str:
    return hmac.new(_secret(), f"{issuer}|{_norm(number)}".encode(), hashlib.sha256).hexdigest()


def age(birth_iso: str) -> int:
    b = date.fromisoformat(birth_iso)
    t = date.today()
    return t.year - b.year - ((t.month, t.day) < (b.month, b.day))


def assess(user_id: int, mrz: dict, fields: dict, has_selfie: bool) -> list[str]:
    """Reasons a human must look (empty = clean)."""
    cfg = settings.get("kyc")
    flags = []
    if not mrz.get("valid"):
        flags.append("mrz_invalid")
    else:
        if mrz.get("expiry_date") and mrz["expiry_date"] < date.today().isoformat():
            flags.append("document_expired")
        if mrz.get("birth_date") and age(mrz["birth_date"]) < int(cfg.get("min_age", 18)):
            flags.append("underage")
        for k in ("doc_number", "surname", "birth_date"):
            if fields.get(k) and _norm(fields[k]) != _norm(mrz.get(k) or ""):
                flags.append(f"edited_{k}")
        if (mrz.get("nationality") or mrz.get("issuer")) in set(cfg.get("blocked_countries") or []):
            flags.append("blocked_country")
        dup = db.one("SELECT user_id FROM kyc_requests WHERE doc_hash=? AND user_id<>? AND status IN ('approved','pending')",
                     (doc_hash(mrz.get("issuer", ""), mrz.get("doc_number", "")), user_id))
        if dup:
            flags.append("document_used_by_another_account")
    if cfg.get("require_selfie", True) and not has_selfie:
        flags.append("no_selfie")
    return flags


DOC_TYPES = ("passport", "id_card", "residence_permit", "driving_license")


def submit(user: dict, body: dict) -> dict:
    cfg = settings.get("kyc")
    if not cfg.get("enabled", True):
        raise AppError("feature_disabled")
    if db.one("SELECT 1 FROM kyc_requests WHERE user_id=? AND status='pending'", (user["id"],)):
        raise AppError("kyc_pending")
    if (user.get("kyc_level") or 0) >= 2:
        raise AppError("bad_state")
    doc_type = body.get("doc_type") if body.get("doc_type") in DOC_TYPES else "passport"
    imgs = body.get("files") or {}
    if not isinstance(imgs, dict) or not imgs.get("front"):
        raise AppError("bad_request")
    if doc_type != "passport" and not imgs.get("back") and cfg.get("require_back", True):
        raise AppError("bad_request")
    paths = {k: files.save(imgs[k], "kyc") for k in ("front", "back", "selfie") if imgs.get(k)}
    mrz = parse(str(body.get("mrz") or "")[:200])
    fields = {k: str(v)[:80] for k, v in (body.get("fields") or {}).items()
              if k in ("surname", "given_names", "doc_number", "nationality", "birth_date", "expiry_date", "sex", "country")}
    flags = assess(user["id"], mrz, fields, bool(paths.get("selfie")))
    record = {"doc_type": doc_type, "fields": fields, "mrz": {k: v for k, v in mrz.items() if k != "lines"},
              "mrz_lines": mrz.get("lines"), "flags": flags, "capture": (body.get("capture") or {}) if isinstance(body.get("capture"), dict) else {}}
    dh = doc_hash(mrz.get("issuer", ""), mrz.get("doc_number", "")) if mrz.get("valid") else None
    auto = bool(cfg.get("auto_approve")) and not flags
    kid = db.insert("kyc_requests", {"user_id": user["id"], "level": 2, "data": seal(json.dumps(record, default=str)), "files": paths,
                                     "doc_hash": dh, "flags": flags, "status": "approved" if auto else "pending", "created_at": db.now(),
                                     "reviewed_at": db.now() if auto else None})
    if auto:
        _approve(user["id"], record)
    else:
        admin_alert(f"Identity verification from {users.display_name(user)}" + (f" — flags: {', '.join(flags)}" if flags else " — MRZ valid"),
                    "warn" if flags else "info", "kyc")
    return {"id": kid, "status": "approved" if auto else "pending", "mrz_valid": bool(mrz.get("valid"))}


def _approve(user_id: int, record: dict):
    m, f = record.get("mrz") or {}, record.get("fields") or {}
    identity = {"name": " ".join(x for x in (m.get("given_names") or f.get("given_names"), m.get("surname") or f.get("surname")) if x),
                "country": m.get("nationality") or m.get("issuer") or f.get("country"), "doc_type": record.get("doc_type"),
                "expires": m.get("expiry_date") or f.get("expiry_date"), "verified_at": db.now()}
    u = db.one("SELECT flags FROM users WHERE id=?", (user_id,))
    uf = db.jl(u["flags"] if u else None)
    uf["identity"] = seal(json.dumps(identity))
    db.x("UPDATE users SET kyc_level=MAX(kyc_level, 2), flags=? WHERE id=?", (json.dumps(uf), user_id))
    notify(user_id, "kyc_approved", path="/settings/kyc")


def review(kid: int, action: str, reviewer: int, note: str = "") -> dict:
    r = db.one("SELECT * FROM kyc_requests WHERE id=?", (kid,))
    if not r or r["status"] != "pending" or action not in ("approve", "reject"):
        raise AppError("bad_state")
    db.update("kyc_requests", {"id": kid}, {"status": "approved" if action == "approve" else "rejected", "note": (note or "")[:300],
                                            "reviewed_at": db.now(), "reviewer": reviewer})
    if action == "approve":
        _approve(r["user_id"], record(r))
    else:
        notify(r["user_id"], "kyc_rejected", path="/settings/kyc", reason=note or "")
    return {"ok": True}


def record(r: dict) -> dict:
    raw = r.get("data") or ""
    try:
        return json.loads(unseal(raw)) if raw.startswith("enc:") else (db.jl(raw) or {})
    except (ValueError, TypeError):
        return {}


def identity(user: dict) -> dict | None:
    fl = user.get("flags")
    sealed = (db.jl(fl) if isinstance(fl, str) else (fl or {})).get("identity")
    if not sealed:
        return None
    try:
        d = json.loads(unseal(sealed))
    except (ValueError, TypeError):
        return None
    name = d.get("name") or ""
    d["name"] = " ".join(p[:1] + "•" * max(0, len(p) - 1) if i else p for i, p in enumerate(name.split()))  # first word only in clear
    return d


def status(user: dict) -> dict:
    r = db.one("SELECT status, note, created_at FROM kyc_requests WHERE user_id=? ORDER BY id DESC LIMIT 1", (user["id"],))
    cfg = settings.get("kyc")
    return {"level": user["kyc_level"], "request": r, "identity": identity(user) if (user.get("kyc_level") or 0) >= 2 else None,
            "doc_types": [d for d in DOC_TYPES if d in (cfg.get("doc_types") or DOC_TYPES)], "require_selfie": cfg.get("require_selfie", True)}


# ───────────── private document links (admins only) ─────────────
def signed_url(rel: str, ttl: int = 900) -> str:
    exp = int(time.time()) + ttl
    sig = hmac.new(_secret(), f"{rel}|{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    return f"/api/kyc-file/{rel.split('/', 1)[1]}?e={exp}&s={sig}"


def check_signed(name: str, exp: int, sig: str) -> str:
    rel = f"kyc/{name}"
    good = hmac.new(_secret(), f"{rel}|{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    if exp < time.time() or not hmac.compare_digest(good, sig or ""):
        raise AppError("not_found", 404)
    return rel
