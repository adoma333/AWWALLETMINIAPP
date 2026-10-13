"""Withdrawals: validation → risk engine → (auto | review) → broadcast → confirmation → done / refund.

Safety rules
  • Funds are locked when the request is made and only leave the ledger once the chain confirms.
  • Any ambiguous send error goes to manual review — never an automatic retry (prevents double payouts).
  • Sending to another AW user's deposit address becomes an instant, free internal transfer (no chain fee).
  • Network `withdraw_mode=manual` → admin pays out and records the txid ("mark as paid").
"""
import logging
from decimal import Decimal

from . import addresses, catalog, db, events, fees, guard, keys, ledger, prices, settings, users
from .chains import adapter
from .money import ZERO, AppError, D, amount_in, q_up, ref_id, s, to_units
from .notify import admin_alert, notify

log = logging.getLogger("aw.withdrawals")


def _internal_owner(fam: str, addr: str, memo: str | None) -> int | None:
    if fam == "ton":
        if not addresses.same("ton", addr, keys.treasury("ton")):
            return None
        m = "".join(ch for ch in (memo or "") if ch.isdigit())
        r = db.one("SELECT user_id FROM deposit_addresses WHERE family='ton' AND memo=?", (m,)) if m else None
        if not r:
            raise AppError("internal_memo_required")
        return r["user_id"]
    if addr.lower() == keys.treasury(fam).lower():
        raise AppError("bad_address_platform")
    r = db.one("SELECT user_id FROM deposit_addresses WHERE family=? AND lower(address)=lower(?)", (fam, addr))
    return r["user_id"] if r else None


def preview(user: dict, asset: str, network: str, address: str, amount, memo: str | None = None) -> dict:
    net = catalog.network(network)
    an = catalog.asset_network(asset, network)
    a = catalog.asset(asset)
    if not (net and an and a) or not (net["enabled"] and net["withdraw_enabled"] and an["enabled"] and an["withdraw_enabled"] and a["enabled"]):
        raise AppError("withdraw_unavailable")
    fam = net["kind"]
    addr = addresses.normalize(fam, address)
    prec = min(a["precision"], an["decimals"])
    amt = amount_in(amount, prec)
    internal_uid = _internal_owner(fam, addr, memo)
    if internal_uid == user["id"]:
        raise AppError("self_transfer")
    if internal_uid:
        return {"internal": True, "recipient": users.public(users.must(internal_uid)), "asset": asset, "network": network,
                "address": addr, "memo": memo, "amount": s(amt), "fee": "0", "receive": s(amt), "usd": s(prices.to_usd(asset, amt)),
                "_amt": amt, "_fee": ZERO, "_uid": internal_uid, "_fq": None, "_addr": addr}
    if amt < D(an["min_withdraw"]):
        raise AppError("amount_below_min", min=an["min_withdraw"])
    if D(an["max_withdraw"]) > 0 and amt > D(an["max_withdraw"]):
        raise AppError("amount_too_large", max=an["max_withdraw"])
    fq = fees.quote("withdraw", user, asset, amt, network=network)
    fee = q_up(fq["fee"] or ZERO, prec)
    receive = amt - fee
    if receive <= 0:
        raise AppError("amount_below_fee", fee=s(fee))
    return {"internal": False, "asset": asset, "network": network, "address": addr, "memo": memo or None, "amount": s(amt),
            "fee": s(fee), "receive": s(receive), "usd": s(prices.to_usd(asset, amt).quantize(Decimal("0.01"))),
            "eta": net.get("eta"), "free": fq["free"], "voucher": fq["voucher"], "vip": fq["vip"],
            "_amt": amt, "_fee": fee, "_fq": fq, "_addr": addr}


def _risk(user: dict, p: dict, net: dict) -> list[str]:
    cfg = settings.get("limits")
    usd = prices.to_usd(p["asset"], p["_amt"])
    reasons = []
    if net["withdraw_mode"] != "auto":
        reasons.append("manual_network")
    if usd > D(cfg.get("auto_approve_usd", 300)):
        reasons.append("amount_over_auto_limit")
    if cfg.get("first_withdraw_review") and not db.one("SELECT 1 FROM withdrawals WHERE user_id=? AND status='completed' LIMIT 1", (user["id"],)):
        reasons.append("first_withdrawal")
    used_before = db.one("SELECT 1 FROM withdrawals WHERE user_id=? AND address=? AND status='completed' LIMIT 1", (user["id"], p["_addr"]))
    if not used_before and usd > D(cfg.get("new_address_review_usd", 1000)):
        reasons.append("new_address_large")
    if (user.get("risk_score") or 0) >= 50:
        reasons.append("user_risk")
    today = db.now() - 86400
    auto_today = sum((D(r["usd_value"]) for r in db.q("SELECT t.usd_value FROM withdrawals w JOIN txs t ON t.id=w.id "
                                                         "WHERE w.created_at>=? AND w.reviewer IS NULL AND w.status IN ('approved','processing','broadcast','completed')",
                                                         (today,))), ZERO)
    if auto_today + usd > D(cfg.get("daily_auto_cap_usd", 20000)):
        reasons.append("platform_daily_cap")
    # funds that arrived very recently from P2P/gifts and leave immediately are a classic fraud pattern
    recent_in = db.one("SELECT 1 FROM txs WHERE user_id=? AND type IN ('p2p_buy','gift_in','receive') AND created_at>? LIMIT 1",
                       (user["id"], db.now() - 3600))
    if recent_in and usd > 200:
        reasons.append("fast_in_out")
    return reasons


def request(user: dict, asset: str, network: str, address: str, amount, memo: str | None = None, pin: str | None = None,
            bio: str | None = None, idem: str | None = None) -> dict:
    guard.feature("withdraw")
    users.ensure_active(user)
    now = db.now()
    if (user.get("security_hold_until") or 0) > now:
        raise AppError("security_hold", until=user["security_hold_until"])
    cfg = settings.get("limits")
    if cfg.get("require_phone_for_withdraw") and (user.get("kyc_level") or 0) < 1:
        raise AppError("phone_required")
    if users.account_age_hours(user) < float(cfg.get("min_account_age_hours_withdraw", 0)):
        raise AppError("account_too_new")
    p = preview(user, asset, network, address, amount, memo)
    usd = prices.to_usd(asset, p["_amt"])
    if (user.get("settings") or {}).get("whitelist_only") and not p["internal"]:
        ok = db.one("SELECT 1 FROM address_book WHERE user_id=? AND network=? AND address=? AND whitelisted=1 AND (usable_at IS NULL OR usable_at<=?)",
                    (user["id"], network, p["_addr"], now))
        if not ok:
            raise AppError("address_not_whitelisted")
    guard.confirm(user, "withdraw", pin, bio, usd=usd)
    if p["internal"]:
        guard.check_limit(user, "transfer", usd)
        return _internal(user, p, idem)
    guard.check_limit(user, "withdraw", usd)
    net = catalog.network(network)
    reasons = _risk(user, p, net)
    status = "review" if reasons else "approved"
    with db.tx():
        seen = guard.idem_seen(user["id"], idem)
        if seen:
            return seen
        wid = ref_id("WD", 10)
        ledger.lock(user["id"], asset, p["_amt"], "withdraw_lock", wid)
        db.insert("withdrawals", {"id": wid, "user_id": user["id"], "asset": asset, "network": network, "address": p["_addr"],
                                  "memo": p["memo"], "amount": s(p["_amt"] - p["_fee"]), "fee": s(p["_fee"]), "total": s(p["_amt"]),
                                  "status": status, "risk": reasons, "created_at": now, "updated_at": now})
        ledger.add_tx(user["id"], "withdraw", asset, p["_amt"] - p["_fee"], id=wid, status="pending", fee=p["_fee"], fee_asset=asset,
                      network=network, address=p["_addr"], memo=p["memo"], usd_value=usd, ref=wid)
        if p["_fq"] and p["_fq"].get("voucher"):
            fees.consume_voucher(p["_fq"]["voucher"]["id"])
        result = {"id": wid, "status": status, "amount": s(p["_amt"] - p["_fee"]), "fee": s(p["_fee"]), "asset": asset, "network": network}
        guard.idem_store(user["id"], idem, result)
    if status == "review":
        notify(user["id"], "withdraw_review", path=f"/tx/{wid}", amount=s(p["_amt"] - p["_fee"]), asset=asset)
        admin_alert(f"Withdrawal {wid} needs review: {s(p['_amt'])} {asset} ({network}) user {user['id']} — {', '.join(reasons)}", "warn", "withdraw")
    return result


def _internal(user: dict, p: dict, idem: str | None) -> dict:
    """Withdrawal to another AW user's deposit address → instant ledger transfer (no chain fee)."""
    with db.tx():
        seen = guard.idem_seen(user["id"], idem)
        if seen:
            return seen
        ref = ledger.add_tx(user["id"], "send", p["asset"], p["_amt"], counterparty=p["_uid"], network=p["network"], address=p["_addr"],
                            usd_value=prices.to_usd(p["asset"], p["_amt"]), meta={"internal_withdraw": True})
        ledger.debit(user["id"], p["asset"], p["_amt"], "transfer_out", ref)
        ledger.credit(p["_uid"], p["asset"], p["_amt"], "transfer_in", ref)
        ledger.add_tx(p["_uid"], "receive", p["asset"], p["_amt"], counterparty=user["id"], ref=ref, network=p["network"],
                      usd_value=prices.to_usd(p["asset"], p["_amt"]), meta={"from": users.display_name(user)})
        db.update("txs", {"id": ref}, {"ref": ref})
        result = {"id": ref, "status": "completed", "internal": True, "amount": s(p["_amt"]), "fee": "0", "asset": p["asset"]}
        guard.idem_store(user["id"], idem, result)
    notify(p["_uid"], "received", path=f"/tx/{ref}", amount=s(p["_amt"]), asset=p["asset"], name=users.display_name(user))
    events.emit("transfer", user["id"], ref=ref, usd=prices.to_usd(p["asset"], p["_amt"]))
    return result


def cancel(user: dict, wid: str) -> dict:
    with db.tx():
        w = db.one("SELECT * FROM withdrawals WHERE id=? AND user_id=?", (wid, user["id"]))
        if not w:
            raise AppError("not_found", 404)
        if w["status"] not in ("review", "approved"):
            raise AppError("cannot_cancel")
        _refund(w, "cancelled", None)
    return {"ok": True}


def _refund(w: dict, status: str, reason: str | None):
    n = db.x("UPDATE withdrawals SET status=?, error=COALESCE(?, error), updated_at=?, done_at=? WHERE id=? AND status NOT IN ('completed','rejected','cancelled','failed')",
             (status, reason, db.now(), db.now(), w["id"])).rowcount
    if n != 1:
        return False
    ledger.unlock(w["user_id"], w["asset"], D(w["total"]), "withdraw_refund", w["id"])
    ledger.set_tx(w["id"], status="rejected" if status == "rejected" else ("cancelled" if status == "cancelled" else "failed"))
    return True


# ───────────── admin ─────────────
def approve(wid: str, admin_id: int) -> dict:
    n = db.x("UPDATE withdrawals SET status='approved', reviewer=?, updated_at=? WHERE id=? AND status='review'", (admin_id, db.now(), wid)).rowcount
    if n != 1:
        raise AppError("bad_state")
    return {"ok": True}


def reject(wid: str, admin_id: int, reason: str = "") -> dict:
    with db.tx():
        w = db.one("SELECT * FROM withdrawals WHERE id=?", (wid,))
        if not w or w["status"] not in ("review", "approved", "stuck"):
            raise AppError("bad_state")
        db.x("UPDATE withdrawals SET reviewer=?, review_note=? WHERE id=?", (admin_id, reason[:300], wid))
        _refund(w, "rejected", reason[:300] or None)
    notify(w["user_id"], "withdraw_rejected", path=f"/tx/{wid}", amount=w["amount"], asset=w["asset"], reason=reason)
    return {"ok": True}


def mark_paid(wid: str, admin_id: int, txid: str) -> dict:
    """Manual payout recorded by the admin (manual networks, or after resolving a stuck send)."""
    with db.tx():
        w = db.one("SELECT * FROM withdrawals WHERE id=?", (wid,))
        if not w or w["status"] not in ("review", "approved", "stuck", "broadcast"):
            raise AppError("bad_state")
        db.x("UPDATE withdrawals SET txid=?, reviewer=?, updated_at=? WHERE id=?", (txid.strip()[:140], admin_id, db.now(), wid))
        _complete(dict(w, txid=txid.strip()[:140]))
    return {"ok": True}


def _complete(w: dict):
    n = db.x("UPDATE withdrawals SET status='completed', done_at=?, updated_at=? WHERE id=? AND status<>'completed'", (db.now(), db.now(), w["id"])).rowcount
    if n != 1:
        return
    ledger.spend_locked(w["user_id"], w["asset"], D(w["total"]), "withdraw", w["id"])
    ledger.set_tx(w["id"], status="completed", txid=w.get("txid"))
    fee = D(w["fee"])
    if fee > 0:
        ledger.add_revenue("withdraw_fee", w["id"], w["user_id"], w["asset"], fee, prices.to_usd(w["asset"], fee))
    net = catalog.network(w["network"])
    notify(w["user_id"], "withdraw_done", path=f"/tx/{w['id']}", amount=w["amount"], asset=w["asset"], network=net["name"] if net else w["network"])
    events.emit("withdraw", w["user_id"], ref=w["id"], usd=prices.to_usd(w["asset"], D(w["amount"])))
    if fee > 0:
        events.emit("fee", w["user_id"], source="withdraw_fee", ref=w["id"], usd=prices.to_usd(w["asset"], fee))


# ───────────── worker ─────────────
def process_approved(limit: int = 10) -> int:
    done = 0
    for w in db.q("SELECT * FROM withdrawals WHERE status='approved' ORDER BY created_at LIMIT ?", (limit,)):
        net = catalog.network(w["network"])
        an = catalog.asset_network(w["asset"], w["network"])
        if not net or not an:
            continue
        if net["withdraw_mode"] != "auto":
            continue  # waits for the admin to pay manually and mark as paid
        ad = adapter(w["network"])
        units = to_units(D(w["amount"]), an["decimals"])
        try:
            hot = ad.balance(net, keys.treasury(net["kind"]) if net["kind"] != "btc" else "*", an)
        except Exception as e:
            log.warning("hot balance check failed %s: %s", w["network"], e)
            continue
        if hot < units:
            db.update("withdrawals", {"id": w["id"]}, {"error": "insufficient_hot_wallet", "updated_at": db.now()})
            if not w.get("error"):
                admin_alert(f"Hot wallet on {w['network']} lacks {w['amount']} {w['asset']} for {w['id']} — top it up.", "error", "treasury")
            continue
        n = db.x("UPDATE withdrawals SET status='processing', attempts=attempts+1, updated_at=? WHERE id=? AND status='approved'",
                 (db.now(), w["id"])).rowcount
        if n != 1:
            continue
        try:
            txid = ad.send(net, an, w["address"], units, w.get("memo"), ref=w["id"])
        except Exception as e:
            log.exception("withdraw send failed %s", w["id"])
            db.update("withdrawals", {"id": w["id"]}, {"status": "stuck", "error": f"send_error: {str(e)[:250]}", "updated_at": db.now()})
            admin_alert(f"Withdrawal {w['id']} send error — check the explorer before retrying: {e}", "error", "withdraw")
            continue
        db.update("withdrawals", {"id": w["id"]}, {"status": "broadcast", "txid": txid, "sent_at": db.now(), "updated_at": db.now(), "error": None})
        ledger.set_tx(w["id"], status="processing", txid=txid)
        notify(w["user_id"], "withdraw_sent", path=f"/tx/{w['id']}", amount=w["amount"], asset=w["asset"], network=net["name"], address=w["address"])
        done += 1
    return done


def track_broadcast() -> int:
    done = 0
    for w in db.q("SELECT * FROM withdrawals WHERE status='broadcast'"):
        net = catalog.network(w["network"])
        try:
            st, conf, _fee = adapter(w["network"]).status(net, w["txid"])
        except Exception as e:
            log.warning("status %s: %s", w["id"], e)
            continue
        if st == "confirmed":
            if net["kind"] == "ton":
                try:
                    from .chains import ton

                    h = ton.resolve_hash(w["txid"])
                    if h:
                        w["txid"] = h
                        db.update("withdrawals", {"id": w["id"]}, {"txid": h})
                except Exception:
                    pass
            with db.tx():
                _complete(w)
            done += 1
        elif st == "failed":
            with db.tx():
                _refund(w, "failed", "chain_failed")
            notify(w["user_id"], "withdraw_rejected", path=f"/tx/{w['id']}", amount=w["amount"], asset=w["asset"], reason="")
            admin_alert(f"Withdrawal {w['id']} failed on-chain and was refunded.", "warn", "withdraw")
        elif st == "dropped" or (st == "pending" and db.now() - (w["sent_at"] or db.now()) > 6 * 3600):
            db.update("withdrawals", {"id": w["id"]}, {"status": "stuck", "error": f"not confirmed ({st})", "updated_at": db.now()})
            admin_alert(f"Withdrawal {w['id']} is not confirming ({st}). Check {w['txid']}.", "error", "withdraw")
    return done


def user_list(user_id: int, limit: int = 30) -> list[dict]:
    return db.q("SELECT id, asset, network, address, memo, amount, fee, status, txid, created_at FROM withdrawals WHERE user_id=? "
                "ORDER BY created_at DESC LIMIT ?", (user_id, limit))
