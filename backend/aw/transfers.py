"""Instant internal transfers between Zohra Wallet users (by @username, Telegram id, or a contact picked in Telegram)."""
from . import catalog, db, events, fees, guard, ledger, prices, settings, users
from .money import AppError, amount_in, s
from .notify import notify


def preview(sender: dict, recipient_query: str | int, asset: str, amount) -> dict:
    a = catalog.asset(asset)
    if not a or not a["enabled"] or not a["transfer_enabled"]:
        raise AppError("asset_unavailable")
    amt = amount_in(amount, a["precision"])
    rcpt = users.get(int(recipient_query)) if isinstance(recipient_query, int) else users.find(str(recipient_query))
    if not rcpt:
        raise AppError("recipient_not_found", 404)
    if rcpt["id"] == sender["id"]:
        raise AppError("self_transfer")
    fq = fees.quote("transfer", sender, asset, amt)
    fee = fq["fee"] or 0
    usd = prices.to_usd(asset, amt)
    cfg = settings.get("transfers")
    from decimal import Decimal

    if usd and usd < Decimal(str(cfg.get("min_usd", "0.01"))):
        raise AppError("amount_too_small")
    return {"recipient": users.public(rcpt), "asset": asset, "amount": s(amt), "fee": s(fee), "total": s(amt + fee),
            "usd": s(usd.quantize(Decimal("0.01"))) if usd else "0", "free": fq["free"], "voucher": fq["voucher"],
            "_rcpt": rcpt, "_amt": amt, "_fee": fee, "_fq": fq, "_usd": usd}


def send(sender: dict, recipient_query, asset: str, amount, note: str | None = None, idem: str | None = None,
         pin: str | None = None, bio: str | None = None) -> dict:
    guard.feature("transfer")
    users.ensure_active(sender)
    p = preview(sender, recipient_query, asset, amount)
    rcpt = p["_rcpt"]
    if rcpt["status"] == "banned":
        raise AppError("recipient_unavailable")
    guard.confirm(sender, "transfer", pin, bio, usd=p["_usd"])   # outside the money tx (PIN failures must persist)
    guard.check_limit(sender, "transfer", p["_usd"])
    note = (note or "").strip()[:140] or None
    with db.tx():
        seen = guard.idem_seen(sender["id"], idem)
        if seen:
            return seen
        ref = ledger.add_tx(sender["id"], "send", asset, p["_amt"], fee=p["_fee"], fee_asset=asset, counterparty=rcpt["id"],
                            usd_value=p["_usd"], meta={"note": note, "to": users.display_name(rcpt)} if note else {"to": users.display_name(rcpt)})
        ledger.debit(sender["id"], asset, p["_amt"] + p["_fee"], "transfer_out", ref)
        ledger.credit(rcpt["id"], asset, p["_amt"], "transfer_in", ref)
        ledger.add_tx(rcpt["id"], "receive", asset, p["_amt"], counterparty=sender["id"], ref=ref, usd_value=p["_usd"],
                      meta={"note": note, "from": users.display_name(sender)})
        db.update("txs", {"id": ref}, {"ref": ref})
        if p["_fee"] > 0:
            ledger.add_revenue("transfer_fee", ref, sender["id"], asset, p["_fee"], prices.to_usd(asset, p["_fee"]))
        if p["_fq"]["voucher"]:
            fees.consume_voucher(p["_fq"]["voucher"]["id"])
        result = {"id": ref, "amount": p["amount"], "asset": asset, "fee": p["fee"], "recipient": p["recipient"]}
        guard.idem_store(sender["id"], idem, result)
    notify(rcpt["id"], "received", path=f"/tx/{ref}", amount=p["amount"], asset=asset, name=users.display_name(sender))
    events.emit("transfer", sender["id"], ref=ref, usd=p["_usd"], to=rcpt["id"])
    if p["_fee"] > 0:
        events.emit("fee", sender["id"], source="transfer_fee", ref=ref, usd=prices.to_usd(asset, p["_fee"]))
    return result


def recent_contacts(user_id: int, limit: int = 12) -> list[dict]:
    rows = db.q("SELECT counterparty, MAX(created_at) AS t FROM txs WHERE user_id=? AND type IN ('send','receive') "
                "AND counterparty IS NOT NULL GROUP BY counterparty ORDER BY t DESC LIMIT ?", (user_id, limit))
    out = []
    for r in rows:
        u = users.get(r["counterparty"])
        if u:
            out.append(users.public(u))
    return out
