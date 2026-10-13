"""TRON adapter (TRX + TRC-20, e.g. USDT) via TronGrid.

Deposits are read per address from TronGrid's confirmed (solidified) history — exact, keyed by transaction id.
Transactions are built by the node, signed locally (secp256k1, r||s||recid over sha256(raw_data)) and broadcast.
TRC-20 sweeps first top up the deposit address with TRX for energy.
"""
import hashlib
from decimal import Decimal

from .. import catalog, config, db, keys
from .base import ChainError, event, http_get, http_post, log, state_get, state_set

FEE_LIMIT_SUN = 100_000_000  # max 100 TRX burnt for a TRC-20 call


def _headers():
    h = {"Content-Type": "application/json"}
    if config.TRON_API_KEY:
        h["TRON-PRO-API-KEY"] = config.TRON_API_KEY
    return h


def api(path: str, body: dict | None = None, get: bool = False, params: dict | None = None):
    url = config.TRON_API + path
    res = http_get(url, params, _headers()) if get else http_post(url, body or {}, _headers())
    if isinstance(res, dict) and (res.get("Error") or res.get("code") in ("SIGERROR", "CONTRACT_VALIDATE_ERROR", "BANDWITH_ERROR")):
        raise ChainError(f"tron {path}: {res.get('Error') or res.get('message') or res.get('code')}")
    return res


def hex_to_b58(h: str) -> str:
    from bip_utils import Base58Encoder

    return Base58Encoder.CheckEncode(bytes.fromhex(h))


def b58_to_hex(a: str) -> str:
    from bip_utils import Base58Decoder

    return Base58Decoder.CheckDecode(a).hex()


def sign(priv: bytes, raw_data_hex: str) -> tuple[str, str]:
    from coincurve import PrivateKey

    digest = hashlib.sha256(bytes.fromhex(raw_data_hex)).digest()
    sig = PrivateKey(priv).sign_recoverable(digest, hasher=None)  # r(32) s(32) recid(1), low-s
    return digest.hex(), sig.hex()


# ───────────────────────── deposits ─────────────────────────
def scan(net: dict) -> list[dict]:
    nid = net["id"]
    full_key = "tron:full"
    full = db.now() - int(state_get(full_key, 0)) > 6 * 3600
    rows = db.q("SELECT address FROM deposit_addresses WHERE family='tron'" + ("" if full else " AND watch_until>?"),
                () if full else (db.now(),))
    out = []
    for r in rows:
        try:
            out += _scan_address(nid, r["address"])
        except ChainError as e:
            log.warning("tron scan %s: %s", r["address"], e)
    if full:
        state_set(full_key, db.now())
    return out


def _scan_address(nid: str, addr: str) -> list[dict]:
    key = f"tron:ts:{addr}"
    since = int(state_get(key, 0))
    events, newest = [], since
    data = api(f"/v1/accounts/{addr}/transactions/trc20", get=True,
               params={"only_confirmed": "true", "only_to": "true", "limit": 50, "min_timestamp": since}).get("data", [])
    for t in data:
        if t.get("to") != addr or t.get("type") not in (None, "Transfer"):
            continue
        ts = int(t.get("block_timestamp", 0))
        newest = max(newest, ts)
        contract = (t.get("token_info") or {}).get("address")
        events.append(event(nid, t["transaction_id"], f"trc20:{contract}", addr, int(t["value"]), contract,
                            confirmations=999, final=True, from_address=t.get("from"),
                            decimals=int((t.get("token_info") or {}).get("decimals", 6))))
    data = api(f"/v1/accounts/{addr}/transactions", get=True,
               params={"only_confirmed": "true", "only_to": "true", "limit": 50, "min_timestamp": since}).get("data", [])
    for t in data:
        ts = int(t.get("block_timestamp", 0))
        newest = max(newest, ts)
        if (t.get("ret") or [{}])[0].get("contractRet") not in (None, "SUCCESS"):
            continue
        for c in (t.get("raw_data") or {}).get("contract", []):
            if c.get("type") != "TransferContract":
                continue
            v = c["parameter"]["value"]
            if hex_to_b58(v["to_address"]) != addr:
                continue
            if hex_to_b58(v["owner_address"]) == keys.treasury("tron"):
                continue  # our own energy top-up, not a user deposit
            events.append(event(nid, t["txID"], "trx", addr, int(v["amount"]), None, confirmations=999, final=True,
                                from_address=hex_to_b58(v["owner_address"])))
    if newest > since:
        state_set(key, newest - 60_000)  # small overlap; deposits are idempotent
    return events


def verify(net: dict, txid: str) -> list[dict]:
    info = api("/walletsolidity/gettransactioninfobyid", {"value": txid})
    tx = api("/walletsolidity/gettransactionbyid", {"value": txid})
    if not info or not tx or not info.get("blockNumber"):
        return []
    ours = {r["address"] for r in db.q("SELECT address FROM deposit_addresses WHERE family='tron'")}
    out = []
    for c in (tx.get("raw_data") or {}).get("contract", []):
        v = c.get("parameter", {}).get("value", {})
        if c.get("type") == "TransferContract" and (tx.get("ret") or [{}])[0].get("contractRet") == "SUCCESS":
            to = hex_to_b58(v["to_address"])
            if to in ours and hex_to_b58(v["owner_address"]) != keys.treasury("tron"):
                out.append(event(net["id"], txid, "trx", to, int(v["amount"]), None, confirmations=999, final=True))
    if (info.get("receipt") or {}).get("result") == "SUCCESS":
        for lg in info.get("log", []):
            topics = lg.get("topics") or []
            if len(topics) == 3 and topics[0] == "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef":
                to = hex_to_b58("41" + topics[2][-40:])
                if to in ours:
                    contract = hex_to_b58("41" + lg["address"][-40:])
                    out.append(event(net["id"], txid, f"trc20:{contract}", to, int(lg["data"], 16), contract, confirmations=999, final=True))
    return out


# ───────────────────────── sending ─────────────────────────
def _broadcast(priv: bytes, tx: dict) -> str:
    if not tx or "raw_data_hex" not in tx:
        raise ChainError(f"tron build failed: {tx}")
    txid, sig = sign(priv, tx["raw_data_hex"])
    if tx.get("txID") and tx["txID"] != txid:
        raise ChainError("tron txID mismatch")
    tx["signature"] = [sig]
    res = api("/wallet/broadcasttransaction", tx)
    if not res.get("result"):
        raise ChainError(f"tron broadcast: {res.get('code')} {res.get('message')}")
    return txid


def _send_from(priv: bytes, frm: str, an: dict | None, to: str, units: int) -> str:
    if an and an.get("contract"):
        param = b58_to_hex(to)[2:].rjust(64, "0") + hex(units)[2:].rjust(64, "0")
        res = api("/wallet/triggersmartcontract", {"owner_address": frm, "contract_address": an["contract"],
                                                    "function_selector": "transfer(address,uint256)", "parameter": param,
                                                    "fee_limit": FEE_LIMIT_SUN, "call_value": 0, "visible": True})
        if not (res.get("result") or {}).get("result"):
            raise ChainError(f"tron trigger: {res}")
        return _broadcast(priv, res["transaction"])
    tx = api("/wallet/createtransaction", {"owner_address": frm, "to_address": to, "amount": units, "visible": True})
    return _broadcast(priv, tx)


def send(net: dict, an: dict, to: str, amount_units: int, memo: str | None = None, ref: str | None = None) -> str:
    frm, priv = keys.derive("tron", keys.TREASURY_INDEX)
    return _send_from(priv, frm, an, to, amount_units)


def status(net: dict, txid: str) -> tuple[str, int, int]:
    info = api("/walletsolidity/gettransactioninfobyid", {"value": txid})
    if not info or not info.get("blockNumber"):
        pend = api("/wallet/gettransactionbyid", {"value": txid})
        return ("pending" if pend else "dropped"), 0, 0
    fee = int(info.get("fee", 0))
    result = (info.get("receipt") or {}).get("result")
    if result not in (None, "SUCCESS"):
        return "failed", 0, fee
    return "confirmed", 19, fee


def balance(net: dict, address: str, an: dict | None) -> int:
    if an and an.get("contract"):
        param = b58_to_hex(address)[2:].rjust(64, "0")
        res = api("/wallet/triggerconstantcontract", {"owner_address": address, "contract_address": an["contract"],
                                                       "function_selector": "balanceOf(address)", "parameter": param, "visible": True})
        out = (res.get("constant_result") or ["0"])[0] or "0"
        return int(out, 16)
    acc = api("/wallet/getaccount", {"address": address, "visible": True})
    return int(acc.get("balance", 0)) if acc else 0


# ───────────────────────── sweeping ─────────────────────────
TOPUP_SUN = 30_000_000  # 30 TRX covers one USDT transfer to a fresh address (energy burn)


def sweep(net: dict, min_usd: Decimal) -> int:
    from .. import prices

    nid = net["id"]
    if db.one("SELECT 1 FROM treasury_ops WHERE network=? AND status IN ('pending','broadcast')", (nid,)):
        return 0
    treasury = keys.treasury("tron")
    for c in db.q("SELECT DISTINCT address FROM chain_deposits WHERE network=? AND status='credited' AND (note IS NULL OR note<>'swept')", (nid,)):
        addr = c["address"]
        for t in db.q("SELECT DISTINCT contract FROM chain_deposits WHERE network=? AND address=? AND status='credited' AND contract IS NOT NULL "
                      "AND (note IS NULL OR note<>'swept')", (nid, addr)):
            an = catalog.by_contract(nid, t["contract"])
            if not an:
                continue
            bal = balance(net, addr, an)
            if bal <= 0 or Decimal(bal).scaleb(-an["decimals"]) * prices.usd(an["asset"]) < min_usd:
                continue
            trx = balance(net, addr, None)
            if trx < TOPUP_SUN:
                return _op(net, "topup", treasury, addr, None, TOPUP_SUN - trx, "TRX")
            return _op(net, "sweep_token", addr, treasury, an, bal, an["asset"])
        trx = balance(net, addr, None)
        value = trx - 1_100_000  # keep ~1.1 TRX for bandwidth
        if value > 0 and Decimal(value).scaleb(-6) * prices.usd("TRX") >= min_usd:
            return _op(net, "sweep_native", addr, treasury, None, value, "TRX")
        db.x("UPDATE chain_deposits SET note='swept' WHERE network=? AND address=? AND status='credited'", (nid, addr))
    return 0


def _op(net: dict, kind: str, frm: str, to: str, an: dict | None, units: int, asset: str) -> int:
    op_id = db.insert("treasury_ops", {"network": net["id"], "kind": kind, "from_address": frm, "to_address": to, "asset": asset,
                                       "amount": str(units), "status": "pending", "created_at": db.now(), "updated_at": db.now()})
    try:
        txid = _send_from(keys.key_for_address("tron", frm), frm, an, to, units)
        db.update("treasury_ops", {"id": op_id}, {"txid": txid, "status": "broadcast", "updated_at": db.now()})
        return 1
    except Exception as e:
        db.update("treasury_ops", {"id": op_id}, {"status": "failed", "error": str(e)[:300], "updated_at": db.now()})
        return 0


def ops_tick(net: dict):
    for op in db.q("SELECT * FROM treasury_ops WHERE network=? AND status='broadcast'", (net["id"],)):
        try:
            st, _c, fee = status(net, op["txid"])
        except ChainError:
            continue
        if st != "pending":
            db.update("treasury_ops", {"id": op["id"]}, {"status": "confirmed" if st == "confirmed" else "failed", "fee": str(fee),
                                                         "updated_at": db.now()})
