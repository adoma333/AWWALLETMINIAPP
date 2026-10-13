"""The ledger: the only module allowed to change balances.

Invariants (checked by tests and by `audit()`):
  • every change writes one `ledger` row (delta + balance_after) inside the same IMMEDIATE transaction;
  • available >= 0 and locked >= 0 at all times;
  • sum(ledger.delta) per (user, asset, bucket) == current balance.
"""
from decimal import Decimal

from . import db
from .money import ZERO, AppError, D, ref_id, s


def _row(user_id: int, asset: str) -> dict:
    r = db.one("SELECT available, locked FROM balances WHERE user_id=? AND asset=?", (user_id, asset))
    if r is None:
        db.x("INSERT OR IGNORE INTO balances(user_id, asset, available, locked, updated_at) VALUES(?,?,?,?,?)",
             (user_id, asset, "0", "0", db.now()))
        return {"available": "0", "locked": "0"}
    return r


def _apply(user_id: int, asset: str, bucket: str, delta: Decimal, kind: str, ref: str | None, note: str | None):
    if delta == 0:
        return
    with db.tx():
        row = _row(user_id, asset)
        new = D(row[bucket]) + delta
        if new < 0:
            raise AppError("insufficient_funds", asset=asset)
        db.x(f"UPDATE balances SET {bucket}=?, updated_at=? WHERE user_id=? AND asset=?", (s(new), db.now(), user_id, asset))
        db.x("INSERT INTO ledger(user_id, asset, bucket, delta, balance_after, kind, ref, note, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
             (user_id, asset, bucket, s(delta), s(new), kind, ref, note, db.now()))


def credit(user_id: int, asset: str, amount, kind: str, ref: str | None = None, note: str | None = None):
    a = D(amount)
    if a < 0:
        raise ValueError("credit must be positive")
    _apply(user_id, asset, "available", a, kind, ref, note)


def debit(user_id: int, asset: str, amount, kind: str, ref: str | None = None, note: str | None = None):
    a = D(amount)
    if a < 0:
        raise ValueError("debit must be positive")
    _apply(user_id, asset, "available", -a, kind, ref, note)


def lock(user_id: int, asset: str, amount, kind: str, ref: str | None = None):
    a = D(amount)
    with db.tx():
        _apply(user_id, asset, "available", -a, kind, ref, "lock")
        _apply(user_id, asset, "locked", a, kind, ref, "lock")


def unlock(user_id: int, asset: str, amount, kind: str, ref: str | None = None):
    a = D(amount)
    with db.tx():
        _apply(user_id, asset, "locked", -a, kind, ref, "unlock")
        _apply(user_id, asset, "available", a, kind, ref, "unlock")


def spend_locked(user_id: int, asset: str, amount, kind: str, ref: str | None = None, note: str | None = None):
    _apply(user_id, asset, "locked", -D(amount), kind, ref, note or "spend")


def move_locked_to(from_id: int, to_id: int, asset: str, amount, kind: str, ref: str | None = None):
    """Escrow release: locked funds of one user become available funds of another."""
    with db.tx():
        spend_locked(from_id, asset, amount, kind, ref)
        credit(to_id, asset, amount, kind, ref)


def available(user_id: int, asset: str) -> Decimal:
    r = db.one("SELECT available FROM balances WHERE user_id=? AND asset=?", (user_id, asset))
    return D(r["available"]) if r else ZERO


def balances(user_id: int) -> dict[str, dict]:
    return {r["asset"]: {"available": D(r["available"]), "locked": D(r["locked"])}
            for r in db.q("SELECT asset, available, locked FROM balances WHERE user_id=?", (user_id,))}


# ───────────── activity feed ─────────────
def add_tx(user_id: int, type_: str, asset: str, amount, status: str = "completed", **kw) -> str:
    tid = kw.pop("id", None) or ref_id("AW")
    data = {"id": tid, "user_id": user_id, "type": type_, "status": status, "asset": asset, "amount": s(amount),
            "created_at": db.now(), "updated_at": db.now()}
    for k in ("fee", "amount2"):
        if k in kw and kw[k] is not None:
            kw[k] = s(kw[k])
    if "usd_value" in kw and kw["usd_value"] is not None:
        kw["usd_value"] = s(kw["usd_value"])
    data.update({k: v for k, v in kw.items() if v is not None})
    db.insert("txs", data)
    return tid


def set_tx(tid: str, **kw):
    kw["updated_at"] = db.now()
    db.update("txs", {"id": tid}, kw)


def add_revenue(source: str, ref: str | None, user_id: int | None, asset: str, amount, usd):
    if D(amount) == 0 and D(usd) == 0:
        return
    db.insert("revenue", {"source": source, "ref": ref, "user_id": user_id, "asset": asset, "amount": s(amount),
                          "usd": s(usd), "created_at": db.now()})


def audit() -> list[dict]:
    """Return every (user, asset, bucket) whose balance disagrees with its journal. Empty list = healthy."""
    bad = []
    sums: dict = {}
    for r in db.q("SELECT user_id, asset, bucket, delta FROM ledger"):
        k = (r["user_id"], r["asset"], r["bucket"])
        sums[k] = sums.get(k, ZERO) + D(r["delta"])
    for b in db.q("SELECT user_id, asset, available, locked FROM balances"):
        for bucket in ("available", "locked"):
            want = sums.pop((b["user_id"], b["asset"], bucket), ZERO)
            have = D(b[bucket])
            if want != have or have < 0:
                bad.append({"user_id": b["user_id"], "asset": b["asset"], "bucket": bucket, "balance": s(have), "journal": s(want)})
    for (uid, asset, bucket), want in sums.items():
        if want != 0:
            bad.append({"user_id": uid, "asset": asset, "bucket": bucket, "balance": "0", "journal": s(want)})
    return bad


def liabilities() -> dict[str, Decimal]:
    """Total user funds per asset (available + locked) — what the platform owes."""
    out: dict[str, Decimal] = {}
    for r in db.q("SELECT asset, available, locked FROM balances"):
        out[r["asset"]] = out.get(r["asset"], ZERO) + D(r["available"]) + D(r["locked"])
    return out
