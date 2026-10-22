"""TON Connect: link Telegram Wallet / Tonkeeper / MyTonWallet… and build ready-to-sign deposit transactions.

Deposits from a connected wallet go straight to the user's personal TON address (no memo needed).
Withdrawals can target the connected address in one tap (still PIN-protected server-side).
"""

from . import catalog, config, db, deposits, settings
from .addresses import normalize
from .chains import ton as ton_chain
from .money import AppError, amount_in, to_units


def manifest() -> dict:
    cfg = settings.get("ton_connect")
    return {"url": config.WEBAPP_URL, "name": cfg.get("manifest_name", "Zohra Wallet"),
            "iconUrl": f"{config.WEBAPP_URL}/icon-512.png",
            "termsOfUseUrl": settings.get("general").get("terms_url") or config.WEBAPP_URL,
            "privacyPolicyUrl": settings.get("general").get("privacy_url") or config.WEBAPP_URL}


def connect(user: dict, address: str, app: str | None = None) -> dict:
    if not settings.feature("ton_connect"):
        raise AppError("feature_disabled")
    addr = normalize("ton", address)
    db.x("INSERT INTO ton_wallets(user_id, address, app, connected_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET "
         "address=excluded.address, app=excluded.app, connected_at=excluded.connected_at", (user["id"], addr, (app or "")[:40], db.now()))
    return {"address": addr, "app": app}


def disconnect(user: dict):
    db.x("DELETE FROM ton_wallets WHERE user_id=?", (user["id"],))


def connected(user_id: int) -> dict | None:
    return db.one("SELECT address, app, connected_at FROM ton_wallets WHERE user_id=?", (user_id,))


def _comment_boc(text: str) -> str:
    from tonsdk.boc import Cell
    from tonsdk.utils import bytes_to_b64str

    c = Cell()
    c.bits.write_uint(0, 32)
    c.bits.write_string(text)
    return bytes_to_b64str(c.to_boc(False))


def deposit_message(user: dict, asset: str, amount, sender: str) -> dict:
    """A TON Connect `sendTransaction` message (to, amount in nanotons, payload) that deposits into Zohra Wallet."""
    an = catalog.asset_network(asset.upper(), "ton")
    a = catalog.asset(asset.upper())
    if not an or not a or not an["deposit_enabled"]:
        raise AppError("deposit_unavailable")
    info = deposits.get_address(user, "ton")
    amt = amount_in(amount, min(a["precision"], an["decimals"]))
    units = to_units(amt, an["decimals"])
    dest = info["address"]
    if not an["contract"]:
        return {"messages": [{"address": dest, "amount": str(units)}], "valid_until": db.now() + 300}
    from tonsdk.contract.token.ft import JettonWallet
    from tonsdk.utils import Address, bytes_to_b64str

    sender = normalize("ton", sender)
    jw = ton_chain.jetton_wallet(sender, an["contract"])
    body = JettonWallet().create_transfer_body(to_address=Address(dest), jetton_amount=units, forward_amount=1,
                                               response_address=Address(sender), query_id=db.now())
    return {"messages": [{"address": ton_chain.friendly(jw, True), "amount": str(ton_chain.JETTON_FWD_NANO),
                          "payload": bytes_to_b64str(body.to_boc(False))}], "valid_until": db.now() + 300}
