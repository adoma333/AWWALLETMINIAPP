"""Deposit addresses + the generic deposit processor shared by every chain adapter.

Crediting is idempotent: each on-chain transfer is one row in chain_deposits keyed by (network, txid, idx) and moves
seen → credited exactly once inside an IMMEDIATE transaction.
"""
import json
import logging
import re

from . import catalog, db, events, keys, ledger, prices, settings
from .chains import adapter, btc as btc_chain, evm as evm_chain, ton as ton_chain
from .money import AppError, D, from_units, q_down, s
from .notify import admin_alert, notify

log = logging.getLogger("aw.deposits")
WATCH_SECONDS = 7 * 86400


def get_address(user: dict, network_id: str) -> dict:
    net = catalog.network(network_id)
    if not net or not net["enabled"]:
        raise AppError("network_unavailable")
    fam = net["kind"]
    with db.tx():
        r = db.one("SELECT * FROM deposit_addresses WHERE user_id=? AND family=?", (user["id"], fam))
        if not r:
            idx = keys.next_index(fam)
            addr, memo = keys.derive(fam, idx)[0], None
            db.insert("deposit_addresses", {"user_id": user["id"], "family": fam, "address": addr, "memo": memo,
                                            "hd_index": idx, "created_at": db.now(), "watch_until": db.now() + WATCH_SECONDS})
            r = db.one("SELECT * FROM deposit_addresses WHERE user_id=? AND family=?", (user["id"], fam))
        else:
            db.x("UPDATE deposit_addresses SET watch_until=? WHERE user_id=? AND family=?", (db.now() + WATCH_SECONDS, user["id"], fam))
    shared = [n["id"] for n in db.q("SELECT id FROM networks WHERE kind=? AND enabled=1 ORDER BY sort", (fam,))]
    if fam == "ton" and r["hd_index"] is None:  # an old memo-style row that was not migrated yet
        migrate_ton_addresses()
        r = db.one("SELECT * FROM deposit_addresses WHERE user_id=? AND family=?", (user["id"], fam))
    return {"network": network_id, "family": fam, "address": r["address"], "memo": None, "memo_required": False,
            "same_address_networks": shared if fam == "evm" else [network_id]}


def migrate_ton_addresses() -> int:
    """Give every user who had the old shared TON address + memo a personal TON wallet.
    The old memo is kept so deposits still sent with it are credited to the same user."""
    if not keys.has_master():
        return 0
    n = 0
    for r in db.q("SELECT user_id FROM deposit_addresses WHERE family='ton' AND hd_index IS NULL"):
        idx = keys.next_index("ton")
        addr = keys.derive("ton", idx)[0]
        n += db.x("UPDATE deposit_addresses SET address=?, hd_index=?, watch_until=? WHERE family='ton' AND user_id=? AND hd_index IS NULL",
                  (addr, idx, db.now() + WATCH_SECONDS, r["user_id"])).rowcount
    db.x("UPDATE networks SET memo_mode='none' WHERE id='ton' AND memo_mode<>'none'")
    return n


def _owner(ev: dict, fam: str) -> int | None:
    if fam == "ton":
        uid = ton_chain.owner_of(ev["address"])
        if uid:
            return uid
        memo = re.sub(r"\D", "", ev.get("memo") or "")  # old-style deposit to the shared address with a memo
        if not memo:
            return None
        r = db.one("SELECT user_id FROM deposit_addresses WHERE family='ton' AND memo=?", (memo,))
    elif fam == "evm":
        r = db.one("SELECT user_id FROM deposit_addresses WHERE family='evm' AND lower(address)=lower(?)", (ev["address"],))
    else:
        r = db.one("SELECT user_id FROM deposit_addresses WHERE family=? AND address=?", (fam, ev["address"]))
    return r["user_id"] if r else None


def process(events_: list[dict]) -> int:
    credited = 0
    for ev in events_:
        try:
            if _process_one(ev):
                credited += 1
        except Exception:
            log.exception("deposit processing failed for %s/%s", ev.get("network"), ev.get("txid"))
    return credited


def _process_one(ev: dict) -> bool:
    nid = ev["network"]
    net = catalog.network(nid)
    fam = net["kind"]
    an = catalog.by_contract(nid, ev["contract"]) if ev["contract"] else catalog.by_contract(nid, None)
    decimals = an["decimals"] if an else (ev.get("decimals") or 0)
    asset = an["asset"] if an else None
    a = catalog.asset(asset) if asset else None
    amount = q_down(from_units(ev["raw_amount"], decimals), a["precision"]) if a else from_units(ev["raw_amount"], decimals)
    uid = _owner(ev, fam)
    need = int(net["confirmations"] or 1)
    confirmed = ev.get("final") or int(ev.get("confirmations") or 0) >= need

    with db.tx():
        row = db.one("SELECT * FROM chain_deposits WHERE network=? AND txid=? AND idx=?", (nid, ev["txid"], ev["idx"]))
        if row and row["status"] in ("credited", "ignored"):
            return False
        if not row:
            status = "seen"
            if uid is None:
                status = "no_owner"
            elif not an:
                status = "unrecognized"
            elif not (net["deposit_enabled"] and an["deposit_enabled"] and an["enabled"] and a and a["enabled"]):
                status = "disabled"
            elif amount < D(an["min_deposit"]):
                status = "below_min"
            db.insert("chain_deposits", {
                "network": nid, "txid": ev["txid"], "idx": ev["idx"], "address": ev["address"], "memo": ev.get("memo"),
                "from_address": ev.get("from_address"), "asset": asset, "contract": ev["contract"], "amount": s(amount),
                "raw_amount": str(ev["raw_amount"]), "block": ev.get("block"), "confirmations": ev.get("confirmations") or 0,
                "status": status, "user_id": uid, "source": "scan", "created_at": db.now(),
            })
            if "balance_after" in ev:  # native balance accounting: this amount is now accounted for
                db.x("UPDATE addr_state SET expected=?, updated_at=? WHERE network=? AND address=? AND asset='native'",
                     (str(ev["balance_after"]), db.now(), nid, ev["address"]))
            row = db.one("SELECT * FROM chain_deposits WHERE network=? AND txid=? AND idx=?", (nid, ev["txid"], ev["idx"]))
            if status == "seen" and not confirmed:
                ref = ledger.add_tx(uid, "deposit", asset, amount, status="pending", network=nid, txid=ev["txid"],
                                    address=ev["address"], usd_value=prices.to_usd(asset, amount), meta={"confirmations": ev.get("confirmations"), "required": need})
                db.update("chain_deposits", {"id": row["id"]}, {"tx_ref": ref})
                pending_notice = True
            else:
                pending_notice = False
            if status == "below_min":
                notify(uid, "deposit_below_min", path="/history", amount=s(amount), asset=asset, network=net["name"], min=an["min_deposit"])
            if status == "no_owner":  # e.g. TON deposit without/with a wrong memo — support must assign it
                admin_alert(f"Deposit needs attention ({status}): {s(amount)} {asset or ev['contract']} on {nid} tx {ev['txid']}", "warn", "deposit")
        else:
            db.update("chain_deposits", {"id": row["id"]}, {"confirmations": ev.get("confirmations") or 0})
            if row.get("tx_ref"):  # keep the live counter on the activity screen moving
                db.x("UPDATE txs SET meta=?, updated_at=? WHERE id=? AND status='pending'",
                     (json.dumps({"confirmations": ev.get("confirmations") or 0, "required": need}), db.now(), row["tx_ref"]))
            pending_notice = False
        if row["status"] != "seen" or not confirmed:
            if pending_notice:
                notify(uid, "deposit_pending", path="/history", amount=s(amount), asset=asset, network=net["name"], conf=need)
            return False
    if fam == "evm" and not ev.get("final"):
        try:
            if not evm_chain.confirm_event(ev):
                db.update("chain_deposits", {"id": row["id"]}, {"status": "ignored", "note": "receipt mismatch / re-org"})
                if row.get("tx_ref"):
                    ledger.set_tx(row["tx_ref"], status="failed")
                return False
        except Exception as e:  # RPC hiccup: try again next cycle
            log.warning("confirm_event failed: %s", e)
            return False
    return credit(row["id"])


def credit(deposit_id: int, user_override: int | None = None, admin_id: int | None = None) -> bool:
    with db.tx():
        row = db.one("SELECT * FROM chain_deposits WHERE id=?", (deposit_id,))
        if not row or row["status"] == "credited":
            return False
        uid = user_override or row["user_id"]
        if not uid or not row["asset"]:
            raise AppError("deposit_unassignable")
        amount = D(row["amount"])
        n = db.x("UPDATE chain_deposits SET status='credited', user_id=?, credited_at=?, note=COALESCE(note, ?) WHERE id=? AND status<>'credited'",
                 (uid, db.now(), f"admin:{admin_id}" if admin_id else None, deposit_id)).rowcount
        if n != 1:
            return False
        usd = prices.to_usd(row["asset"], amount)
        if row["tx_ref"] and db.one("SELECT 1 FROM txs WHERE id=? AND user_id=?", (row["tx_ref"], uid)):
            ref = row["tx_ref"]
            ledger.set_tx(ref, status="completed", usd_value=s(usd))
        else:
            ref = ledger.add_tx(uid, "deposit", row["asset"], amount, network=row["network"], txid=row["txid"],
                                address=row["address"], usd_value=usd)
            db.update("chain_deposits", {"id": deposit_id}, {"tx_ref": ref})
        ledger.credit(uid, row["asset"], amount, "deposit", ref)
    if row["network"] == "btc":
        btc_chain.on_credit({"txid": row["txid"], "idx": row["idx"], "address": row["address"], "raw_amount": row["raw_amount"], "block": row["block"]})
    net = catalog.network(row["network"])
    notify(uid, "deposit_credited", path=f"/tx/{ref}", amount=s(amount), asset=row["asset"], network=net["name"] if net else row["network"])
    events.emit("deposit", uid, ref=ref, usd=usd, asset=row["asset"])
    if usd >= D(settings.get("notifications").get("large_deposit_usd", 5000)):
        admin_alert(f"Large deposit: {s(amount)} {row['asset']} (~${usd:.0f}) on {row['network']} by user {uid}", "money", "deposit")
    return True


TXID_RE = {
    "evm": r"0x[0-9a-fA-F]{64}", "tron": r"[0-9a-fA-F]{64}", "btc": r"[0-9a-fA-F]{64}",
    "sol": r"[1-9A-HJ-NP-Za-km-z]{64,90}", "ton": r"[A-Za-z0-9+/=_\-]{43,64}",
}


def verify_tx(user: dict, network_id: str, txid: str) -> dict:
    """Transaction checker: the user pastes a hash; we look it up on-chain and credit anything that's theirs."""
    net = catalog.network(network_id)
    if not net:
        raise AppError("network_unavailable")
    txid = (txid or "").strip()
    if not re.fullmatch(TXID_RE[net["kind"]], txid):
        raise AppError("bad_txid")
    existing = db.q("SELECT * FROM chain_deposits WHERE network=? AND txid=?", (network_id, txid))
    if any(r["status"] == "credited" for r in existing):
        mine = [r for r in existing if r["user_id"] == user["id"]]
        return {"status": "credited" if mine else "not_yours", "items": [_public(r) for r in mine]}
    try:
        evs = adapter(network_id).verify(net, txid)
    except Exception as e:
        log.warning("verify %s %s: %s", network_id, txid, e)
        raise AppError("chain_unavailable", 503)
    process(evs)
    rows = db.q("SELECT * FROM chain_deposits WHERE network=? AND txid=?", (network_id, txid))
    mine = [r for r in rows if r["user_id"] == user["id"]]
    if not rows:
        # EVM native: the scanner credits it (address is now watched); tell the user it's being checked
        return {"status": "not_found" if net["kind"] != "evm" else "checking", "items": []}
    if not mine:
        return {"status": "not_yours", "items": []}
    st = "credited" if all(r["status"] == "credited" for r in mine) else mine[0]["status"]
    return {"status": st, "items": [_public(r) for r in mine]}


def _public(r: dict) -> dict:
    return {"asset": r["asset"], "amount": r["amount"], "status": r["status"], "confirmations": r["confirmations"],
            "network": r["network"], "txid": r["txid"]}


def scan_network(network_id: str) -> int:
    net = catalog.network(network_id)
    if not net or not net["enabled"] or not net["deposit_enabled"]:
        return 0
    if not db.one("SELECT 1 FROM deposit_addresses WHERE family=? LIMIT 1", (net["kind"],)):
        return 0
    evs = adapter(network_id).scan(net)
    n = process(evs)
    # pending ones: re-evaluate confirmations next pass (log events are re-reported only once, so re-check by receipt)
    if net["kind"] == "evm":
        _recheck_pending_evm(net)
    return n


def _recheck_pending_evm(net: dict):
    rows = db.q("SELECT * FROM chain_deposits WHERE network=? AND status='seen'", (net["id"],))
    if not rows:
        return
    tip = evm_chain.head(net["id"])
    for r in rows:
        if not r["block"]:
            continue
        conf = tip - r["block"] + 1
        ev = {"network": net["id"], "txid": r["txid"], "idx": r["idx"], "address": r["address"], "raw_amount": int(r["raw_amount"]),
              "contract": r["contract"], "block": r["block"], "confirmations": conf, "memo": r["memo"], "final": False}
        _process_one(ev)


def recheck_unrecognized() -> int:
    """After the admin lists a new token (or enables a network), credit what was waiting."""
    n = 0
    for r in db.q("SELECT * FROM chain_deposits WHERE status IN ('unrecognized','disabled')"):
        an = catalog.by_contract(r["network"], r["contract"]) if r["contract"] else catalog.by_contract(r["network"], None)
        if not an or not r["user_id"]:
            continue
        a = catalog.asset(an["asset"])
        amount = q_down(from_units(int(r["raw_amount"]), an["decimals"]), a["precision"])
        db.update("chain_deposits", {"id": r["id"]}, {"asset": an["asset"], "amount": s(amount), "status": "seen"})
        if credit(r["id"]):
            n += 1
    return n


def history_for_admin(status: str | None = None, limit: int = 200) -> list[dict]:
    if status:
        return db.q("SELECT * FROM chain_deposits WHERE status=? ORDER BY id DESC LIMIT ?", (status, limit))
    return db.q("SELECT * FROM chain_deposits ORDER BY id DESC LIMIT ?", (limit,))

