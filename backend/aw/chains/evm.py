"""EVM adapter — Ethereum, BNB Smart Chain, Polygon, Arbitrum, Base, Avalanche, OP Mainnet, Linea, Scroll, Unichain, opBNB,
Mantle, Gnosis, Sonic and Cronos (one address for all).

Deposits
  • Tokens: eth_getLogs for ERC-20 Transfer events whose `to` is any of our addresses — catches EVERY token (unknown
    contracts are recorded as `unrecognized` so the admin can list them and credit retroactively). Logs are re-checked
    against the receipt at credit time (re-org safe).
  • Native coin: exact balance accounting. For each deposit address we keep `expected` = what the balance must be from
    our own operations (gas top-ups in, sweeps out incl. fees). Confirmed balance − expected = new user deposits.
Withdrawals are signed locally (eth-account) from the hot wallet (index 0) and broadcast via JSON-RPC.
Sweeps consolidate deposit addresses into the hot wallet, topping up gas first for token sweeps.
"""
import itertools
from decimal import Decimal

from .. import catalog, config, db, keys
from ..money import D
from .base import ChainError, event, http_post, log, state_get, state_set

TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
LOG_RANGE = {"eth": 400, "bsc": 1500, "polygon": 1500, "arbitrum": 4000, "base": 1500, "avax": 1500, "optimism": 1500,
             "linea": 1000, "scroll": 1000, "unichain": 3000, "opbnb": 3000, "mantle": 1500, "gnosis": 1000,
             "sonic": 2000, "cronos": 1000}
# OP-stack chains charge an extra L1 data fee on top of gas × price (read from the GasPriceOracle predeploy)
OP_STACK = {"base", "optimism", "unichain", "opbnb", "mantle"}
GAS_ORACLE = "0x420000000000000000000000000000000000000F"
ADDR_CHUNK = 60
_ids = itertools.count(1)


def rpc_url(nid: str) -> str:
    net = catalog.network(nid) or {}
    return (net.get("config") or {}).get("rpc") or config.RPC.get(nid, "")


def rpc(nid: str, method: str, params: list):
    res = http_post(rpc_url(nid), {"jsonrpc": "2.0", "id": next(_ids), "method": method, "params": params})
    if isinstance(res, dict) and res.get("error"):
        raise ChainError(f"{nid} {method}: {res['error']}")
    return res.get("result") if isinstance(res, dict) else None


def batch(nid: str, calls: list[tuple[str, list]]) -> list:
    if not calls:
        return []
    body = [{"jsonrpc": "2.0", "id": i, "method": m, "params": p} for i, (m, p) in enumerate(calls)]
    res = http_post(rpc_url(nid), body)
    if not isinstance(res, list):
        raise ChainError(f"{nid} batch failed")
    by_id = {r.get("id"): r for r in res}
    out = []
    for i in range(len(calls)):
        r = by_id.get(i) or {}
        out.append(None if r.get("error") else r.get("result"))
    return out


def _hex(n: int) -> str:
    return hex(int(n))


def _pad(addr: str) -> str:
    return "0x" + "0" * 24 + addr.lower()[2:]


def _unpad(topic: str) -> str:
    from eth_utils import to_checksum_address

    return to_checksum_address("0x" + topic[-40:])


def head(nid: str) -> int:
    return int(rpc(nid, "eth_blockNumber", []), 16)


def confirmations_needed(nid: str) -> int:
    return int((catalog.network(nid) or {}).get("confirmations") or 12)


# ───────────────────────── deposits ─────────────────────────
def scan(net: dict) -> list[dict]:
    nid = net["id"]
    out = []
    tip = head(nid)
    out += _scan_logs(nid, tip)
    out += _scan_native(nid, tip)
    return out


def _scan_logs(nid: str, tip: int) -> list[dict]:
    addrs = [r["address"] for r in db.q("SELECT address FROM deposit_addresses WHERE family='evm'")]
    if not addrs:
        state_set(f"evm:{nid}:logs", tip)
        return []
    last = int(state_get(f"evm:{nid}:logs", tip - 30))
    start = last + 1
    if start > tip:
        return []
    end = min(tip, start + LOG_RANGE.get(nid, 1000) - 1)
    events = []
    for i in range(0, len(addrs), ADDR_CHUNK):
        chunk = [_pad(a) for a in addrs[i:i + ADDR_CHUNK]]
        logs = rpc(nid, "eth_getLogs", [{"fromBlock": _hex(start), "toBlock": _hex(end), "topics": [TRANSFER_TOPIC, None, chunk]}]) or []
        for lg in logs:
            if len(lg.get("topics", [])) != 3 or lg.get("removed"):
                continue  # ERC-721 has 4 topics; ignore NFTs
            try:
                amount = int(lg.get("data") or "0x0", 16)
            except ValueError:
                continue
            if amount <= 0:
                continue
            blk = int(lg["blockNumber"], 16)
            events.append(event(nid, lg["transactionHash"], f"log{int(lg['logIndex'], 16)}", _unpad(lg["topics"][2]), amount,
                                lg["address"], block=blk, confirmations=tip - blk + 1, from_address=_unpad(lg["topics"][1])))
    state_set(f"evm:{nid}:logs", end)
    return events


def _addr_state(nid: str, address: str) -> dict:
    r = db.one("SELECT * FROM addr_state WHERE network=? AND address=? AND asset='native'", (nid, address))
    if not r:
        db.x("INSERT OR IGNORE INTO addr_state(network, address, asset, expected, pending, updated_at) VALUES(?,?,?,?,?,?)",
             (nid, address, "native", "0", 0, db.now()))
        return {"expected": "0", "pending": 0}
    return r


def _scan_native(nid: str, tip: int) -> list[dict]:
    conf = confirmations_needed(nid)
    blk = max(0, tip - conf + 1)
    full_key = f"evm:{nid}:native_full"
    full = db.now() - int(state_get(full_key, 0)) > 6 * 3600
    rows = db.q("SELECT address FROM deposit_addresses WHERE family='evm'" + ("" if full else " AND watch_until>?"),
                () if full else (db.now(),))
    addrs = [r["address"] for r in rows]
    events = []
    for i in range(0, len(addrs), 50):
        chunk = addrs[i:i + 50]
        bals = batch(nid, [("eth_getBalance", [a, _hex(blk)]) for a in chunk])
        for a, b in zip(chunk, bals):
            if b is None:
                continue
            st = _addr_state(nid, a)
            if st["pending"]:
                continue
            bal, exp = int(b, 16), int(D(st["expected"]))
            if bal > exp:
                events.append(event(nid, f"bal:{a.lower()}:{blk}:{exp}", "native", a, bal - exp, None, block=blk,
                                    confirmations=conf, final=True) | {"balance_after": bal})
            elif bal < exp:
                log.warning("evm %s %s balance below expected (%s < %s) — resyncing", nid, a, bal, exp)
                db.x("UPDATE addr_state SET expected=?, updated_at=? WHERE network=? AND address=? AND asset='native'",
                     (str(bal), db.now(), nid, a))
    if full:
        state_set(full_key, db.now())
    return events


def confirm_event(ev: dict) -> bool:
    """Re-validate a log-based deposit against its receipt right before crediting (re-org protection)."""
    if ev["idx"] == "native":
        return True
    rc = rpc(ev["network"], "eth_getTransactionReceipt", [ev["txid"]])
    if not rc or rc.get("status") != "0x1":
        return False
    want = int(ev["idx"][3:]) if ev["idx"].startswith("log") else None
    for lg in rc.get("logs", []):
        if int(lg["logIndex"], 16) == want and lg["topics"] and lg["topics"][0] == TRANSFER_TOPIC:
            return _unpad(lg["topics"][2]).lower() == ev["address"].lower() and int(lg["data"], 16) == ev["raw_amount"]
    return False


def verify(net: dict, txid: str) -> list[dict]:
    """User-submitted hash: find transfers to our addresses inside that transaction."""
    nid = net["id"]
    tx = rpc(nid, "eth_getTransactionByHash", [txid])
    rc = rpc(nid, "eth_getTransactionReceipt", [txid])
    if not tx or not rc:
        return []
    tip = head(nid)
    conf = tip - int(rc["blockNumber"], 16) + 1
    ours = {r["address"].lower(): r["address"] for r in db.q("SELECT address FROM deposit_addresses WHERE family='evm'")}
    out = []
    if rc.get("status") != "0x1":
        return []
    for lg in rc.get("logs", []):
        if len(lg.get("topics", [])) == 3 and lg["topics"][0] == TRANSFER_TOPIC:
            to = _unpad(lg["topics"][2])
            if to.lower() in ours:
                out.append(event(nid, txid, f"log{int(lg['logIndex'], 16)}", to, int(lg["data"], 16), lg["address"],
                                 block=int(rc["blockNumber"], 16), confirmations=conf, from_address=_unpad(lg["topics"][1])))
    # direct native transfer: handled by balance accounting (scanner); mark the address hot so it's picked up now
    if tx.get("to") and tx["to"].lower() in ours and int(tx.get("value", "0x0"), 16) > 0:
        db.x("UPDATE deposit_addresses SET watch_until=? WHERE family='evm' AND lower(address)=?", (db.now() + 86400, tx["to"].lower()))
    return out


# ───────────────────────── sending ─────────────────────────
def _fees(nid: str) -> dict:
    if nid == "bsc":
        gp = int(rpc(nid, "eth_gasPrice", []), 16)
        return {"gasPrice": max(gp, 100_000_000)}
    blk = rpc(nid, "eth_getBlockByNumber", ["latest", False]) or {}
    base = int(blk.get("baseFeePerGas", "0x0"), 16)
    try:
        prio = int(rpc(nid, "eth_maxPriorityFeePerGas", []), 16)
    except ChainError:
        prio = 1_500_000_000 if nid == "eth" else 10_000_000
    if nid == "eth":
        prio = max(prio, 500_000_000)
    return {"maxFeePerGas": 2 * base + prio, "maxPriorityFeePerGas": prio}


def _sign_send(nid: str, priv: bytes, frm: str, to: str, value: int, data: bytes, gas: int | None = None, nonce: int | None = None) -> str:
    from eth_account import Account

    chain_id = int((catalog.network(nid) or {}).get("chain_id"))
    if nonce is None:
        nonce = int(rpc(nid, "eth_getTransactionCount", [frm, "pending"]), 16)
    tx = {"chainId": chain_id, "nonce": nonce, "to": to, "value": value, "data": data}
    if gas is None:
        est = rpc(nid, "eth_estimateGas", [{"from": frm, "to": to, "value": _hex(value), "data": "0x" + data.hex()}])
        gas = max(21000, int(int(est, 16) * 1.25))
    tx["gas"] = gas
    tx.update(_fees(nid))
    signed = Account.sign_transaction(tx, priv)
    raw = signed.raw_transaction
    txh = rpc(nid, "eth_sendRawTransaction", ["0x" + raw.hex()])
    return txh or "0x" + signed.hash.hex()


def transfer_data(to: str, amount: int) -> bytes:
    return bytes.fromhex("a9059cbb") + bytes.fromhex(to.lower()[2:].rjust(64, "0")) + amount.to_bytes(32, "big")


def send(net: dict, an: dict, to: str, amount_units: int, memo: str | None = None, ref: str | None = None) -> str:
    nid = net["id"]
    frm, priv = keys.derive("evm", keys.TREASURY_INDEX)
    if an.get("contract"):
        return _sign_send(nid, priv, frm, an["contract"], 0, transfer_data(to, amount_units))
    return _sign_send(nid, priv, frm, to, amount_units, b"", gas=None)


def status(net: dict, txid: str) -> tuple[str, int, int]:
    """(pending|confirmed|failed|dropped, confirmations, fee in wei)."""
    nid = net["id"]
    rc = rpc(nid, "eth_getTransactionReceipt", [txid])
    if not rc:
        tx = rpc(nid, "eth_getTransactionByHash", [txid])
        return ("pending" if tx else "dropped"), 0, 0
    fee = int(rc.get("gasUsed", "0x0"), 16) * int(rc.get("effectiveGasPrice", "0x0"), 16)
    fee += int(rc.get("l1Fee") or "0x0", 16)
    if rc.get("status") != "0x1":
        return "failed", 0, fee
    conf = head(nid) - int(rc["blockNumber"], 16) + 1
    return ("confirmed" if conf >= confirmations_needed(nid) else "pending"), conf, fee


def balance(net: dict, address: str, an: dict | None) -> int:
    nid = net["id"]
    if an and an.get("contract"):
        data = "0x70a08231" + address.lower()[2:].rjust(64, "0")
        return int(rpc(nid, "eth_call", [{"to": an["contract"], "data": data}, "latest"]) or "0x0", 16)
    return int(rpc(nid, "eth_getBalance", [address, "latest"]), 16)


def l1_fee_wei(nid: str, token: bool) -> int:
    """Upper estimate of the OP-stack L1 data fee for one of our transfers (0 elsewhere)."""
    if nid not in OP_STACK:
        return 0
    size = 180 if token else 120  # a signed EIP-1559 transfer is ~110 bytes, a token transfer ~180
    data = ("0x49948e0e" + "20".rjust(64, "0") + hex(size)[2:].rjust(64, "0")
            + ("ff" * size).ljust(((size + 31) // 32) * 64, "0"))
    try:
        return int(rpc(nid, "eth_call", [{"to": GAS_ORACLE, "data": data}, "latest"]) or "0x0", 16) * 3 // 2
    except (ChainError, ValueError):
        return 0


def gas_cost_wei(net: dict, token: bool) -> int:
    f = _fees(net["id"])
    price = f.get("gasPrice") or f.get("maxFeePerGas")
    return price * (65000 if token else 21000) + l1_fee_wei(net["id"], token)


# ───────────────────────── sweeping ─────────────────────────
def sweep(net: dict, min_usd: Decimal) -> int:
    """Plan and execute one consolidation step per address (state kept in treasury_ops + addr_state)."""
    from .. import prices

    nid = net["id"]
    treasury = keys.treasury("evm")
    native_an = catalog.by_contract(nid, None)
    started = 0
    if db.one("SELECT 1 FROM treasury_ops WHERE network=? AND status IN ('pending','broadcast')", (nid,)):
        return 0  # one consolidation flow at a time per network keeps nonces simple
    candidates = db.q("SELECT DISTINCT address FROM chain_deposits WHERE network=? AND status='credited' AND "
                      "(note IS NULL OR note<>'swept')", (nid,))
    for c in candidates:
        addr = c["address"]
        if addr.lower() == treasury.lower():
            continue
        st = _addr_state(nid, addr)
        if st["pending"]:
            continue
        tokens = db.q("SELECT DISTINCT contract FROM chain_deposits WHERE network=? AND address=? AND status='credited' "
                      "AND contract IS NOT NULL AND (note IS NULL OR note<>'swept')", (nid, addr))
        for t in tokens:
            an = catalog.by_contract(nid, t["contract"])
            if not an:
                continue
            bal = balance(net, addr, an)
            usd = Decimal(bal).scaleb(-an["decimals"]) * prices.usd(an["asset"])
            if bal <= 0 or usd < min_usd:
                continue
            need = gas_cost_wei(net, True) * 13 // 10
            have = balance(net, addr, None)
            if have < need:
                _op(nid, "topup", treasury, addr, native_an["asset"], need - have, ref=addr)
                started += 1
                return started  # wait for the top-up before the token transfer
            _op(nid, "sweep_token", addr, treasury, an["asset"], bal, contract=an["contract"], ref=addr)
            return started + 1
        # native sweep (whatever is left beyond gas)
        bal = balance(net, addr, None)
        cost = gas_cost_wei(net, False) * 12 // 10
        if native_an and bal > cost:
            value = bal - cost
            usd = Decimal(value).scaleb(-18) * prices.usd(native_an["asset"])
            if usd >= min_usd:
                _op(nid, "sweep_native", addr, treasury, native_an["asset"], value, ref=addr)
                return started + 1
        db.x("UPDATE chain_deposits SET note='swept' WHERE network=? AND address=? AND status='credited'", (nid, addr))
    return started


def _op(nid: str, kind: str, frm: str, to: str, asset: str, units: int, contract: str | None = None, ref: str | None = None):
    """Create, sign and broadcast one treasury operation."""
    op_id = db.insert("treasury_ops", {"network": nid, "kind": kind, "from_address": frm, "to_address": to, "asset": asset,
                                       "amount": str(units), "status": "pending", "ref": ref, "created_at": db.now(), "updated_at": db.now()})
    dep_addr = to if kind == "topup" else frm
    db.x("UPDATE addr_state SET pending=1 WHERE network=? AND address=? AND asset='native'", (nid, dep_addr))
    try:
        priv = keys.key_for_address("evm", frm)
        if contract:
            txh = _sign_send(nid, priv, frm, contract, 0, transfer_data(to, units))
        else:
            gas = 21000
            txh = _sign_send(nid, priv, frm, to, units, b"", gas=gas)
        db.update("treasury_ops", {"id": op_id}, {"txid": txh, "status": "broadcast", "updated_at": db.now()})
    except Exception as e:
        db.update("treasury_ops", {"id": op_id}, {"status": "failed", "error": str(e)[:300], "updated_at": db.now()})
        db.x("UPDATE addr_state SET pending=0 WHERE network=? AND address=? AND asset='native'", (nid, dep_addr))
        log.warning("evm op %s failed: %s", kind, e)


def ops_tick(net: dict):
    """Follow broadcast treasury ops; on confirmation update the native expected-balance of the deposit address."""
    nid = net["id"]
    for op in db.q("SELECT * FROM treasury_ops WHERE network=? AND status='broadcast'", (nid,)):
        try:
            st, _conf, fee = status(net, op["txid"])
        except ChainError:
            continue
        if st == "pending":
            continue
        with db.tx():
            dep_addr = op["to_address"] if op["kind"] == "topup" else op["from_address"]
            cur = int(D((_addr_state(nid, dep_addr))["expected"]))
            if op["kind"] == "topup" and st == "confirmed":
                cur += int(op["amount"])
            elif op["kind"] in ("sweep_native", "sweep_token"):
                cur -= fee  # gas is always paid by the sending deposit address
                if st == "confirmed" and op["kind"] == "sweep_native":
                    cur -= int(op["amount"])
            db.x("UPDATE addr_state SET expected=?, pending=0, updated_at=? WHERE network=? AND address=? AND asset='native'",
                 (str(max(cur, 0)), db.now(), nid, dep_addr))
            db.update("treasury_ops", {"id": op["id"]}, {"status": "confirmed" if st == "confirmed" else "failed",
                                                         "fee": str(fee), "updated_at": db.now()})
