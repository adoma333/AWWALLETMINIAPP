"""TON adapter — one hot wallet (v4r2) + a personal numeric memo per user (exchange-style), toncenter v2/v3 APIs.

Deposits: incoming TON transfers with a text comment, and incoming jetton transfers (USDT, NOT, DOGS, any jetton)
whose forward payload carries the comment. The jetton master is verified by the indexer, so look-alike tokens land
as `unrecognized`. Deposits without/with an unknown memo are kept as `no_owner` for support to assign.
Withdrawals are signed locally (tonsdk) and sent with sendBoc. Jetton withdrawals carry a unique query_id so they
can be confirmed precisely.
"""
import base64
import hashlib
import time
from decimal import Decimal

from .. import config, db, keys
from .base import ChainError, event, http_get, http_post, state_get, state_set

JETTON_FWD_NANO = 50_000_000      # 0.05 TON attached to a jetton transfer (excess comes back)
FORWARD_TON = 1                   # 1 nanoton so the receiver gets a notification with the comment


def _h():
    return {"X-API-Key": config.TONCENTER_KEY} if config.TONCENTER_KEY else {}


def v3(path: str, params: dict | None = None):
    return http_get(config.TONCENTER_API + path, params, _h())


def v2_get(path: str, params: dict | None = None):
    res = http_get(config.TONCENTER_V2 + path, params, _h())
    if isinstance(res, dict) and res.get("ok") is False:
        raise ChainError(f"toncenter {path}: {res.get('error')}")
    return res.get("result") if isinstance(res, dict) else res


def raw(addr: str) -> str:
    from tonsdk.utils import Address

    return Address(addr).to_string(False).lower()


def friendly(addr: str, bounceable: bool = False) -> str:
    from tonsdk.utils import Address

    return Address(addr).to_string(True, True, bounceable)


def treasury() -> str:
    return keys.treasury("ton")


# ───────────────────────── comments ─────────────────────────
def _cell_bits_bytes(cell, skip_bits: int = 0) -> bytes:
    n = cell.bits.cursor
    bits = [cell.bits.get(i) for i in range(skip_bits, n)]
    out = bytearray()
    for i in range(0, len(bits) - len(bits) % 8, 8):
        v = 0
        for b in bits[i:i + 8]:
            v = (v << 1) | int(b)
        out.append(v)
    return bytes(out)


def _text_from(cell, skip_bits: int = 0) -> str | None:
    data = _cell_bits_bytes(cell, skip_bits)
    if len(data) < 4 or data[:4] != b"\x00\x00\x00\x00":
        return None
    chunks = [data[4:]]
    c = cell
    while c.refs:
        c = c.refs[0]
        chunks.append(_cell_bits_bytes(c))
    try:
        return b"".join(chunks).decode("utf-8", "ignore").strip("\x00").strip()
    except Exception:
        return None


def comment_from_boc(b64: str | None) -> str | None:
    """Text comment from a message body / jetton forward_payload (handles inline and Either-ref forms)."""
    if not b64:
        return None
    from tonsdk.boc import Cell

    try:
        cell = Cell.one_from_boc(base64.b64decode(b64))
    except Exception:
        return None
    bits = cell.bits.cursor
    if bits % 8 == 1:                                     # Either flag + inline payload (0) or flag only (1 → ref)
        if cell.bits.get(0) == 0:
            return _text_from(cell, 1)
        return _text_from(cell.refs[0]) if cell.refs else None
    t = _text_from(cell)
    if t is not None:
        return t
    if bits == 0 and cell.refs:
        return _text_from(cell.refs[0])
    return None


def _has_opcode(b64: str) -> bool:
    from tonsdk.boc import Cell

    try:
        cell = Cell.one_from_boc(base64.b64decode(b64))
    except Exception:
        return False
    return cell.bits.cursor >= 32 and _cell_bits_bytes(cell)[:4] != b"\x00\x00\x00\x00"


def new_memo() -> str:
    import secrets

    for _ in range(50):
        m = str(secrets.randbelow(900_000_000) + 100_000_000)
        if not db.one("SELECT 1 FROM deposit_addresses WHERE family='ton' AND memo=?", (m,)):
            return m
    raise ChainError("could not allocate memo")


def _jetton_by_master(master_raw: str) -> dict | None:
    for an in db.q("SELECT * FROM asset_networks WHERE network='ton' AND contract IS NOT NULL"):
        try:
            if raw(an["contract"]) == master_raw.lower():
                return an
        except Exception:
            continue
    return None


# ───────────────────────── deposits ─────────────────────────
def scan(net: dict) -> list[dict]:
    nid = net["id"]
    tre = treasury()
    out = []
    last_lt = int(state_get("ton:lt", 0))
    params = {"account": tre, "limit": 100, "sort": "desc"}
    if last_lt:
        params["start_lt"] = last_lt + 1
    txs = (v3("/transactions", params) or {}).get("transactions", [])
    max_lt = last_lt
    for tx in txs:
        max_lt = max(max_lt, int(tx.get("lt", 0)))
        out += parse_native(nid, tx, tre)
    if max_lt > last_lt:
        state_set("ton:lt", max_lt)
    last_j = int(state_get("ton:jlt", 0))
    jp = {"owner_address": tre, "direction": "in", "limit": 100, "sort": "desc"}
    if last_j:
        jp["start_lt"] = last_j + 1
    jts = (v3("/jetton/transfers", jp) or {}).get("jetton_transfers", [])
    max_j = last_j
    for jt in jts:
        max_j = max(max_j, int(jt.get("transaction_lt", 0)))
        ev = parse_jetton(nid, jt, tre)
        if ev:
            out.append(ev)
    if max_j > last_j:
        state_set("ton:jlt", max_j)
    return out


def parse_native(nid: str, tx: dict, tre: str) -> list[dict]:
    m = tx.get("in_msg") or {}
    if not m.get("source") or m.get("bounced"):
        return []
    desc = tx.get("description") or {}
    if desc.get("aborted"):
        return []
    value = int(m.get("value") or 0)
    if value <= 0:
        return []
    content = m.get("message_content") or {}
    dec = content.get("decoded") or {}
    comment = dec.get("comment") if dec.get("type") == "text_comment" else comment_from_boc(content.get("body"))
    if comment is None and content.get("body") and _has_opcode(content["body"]):
        return []  # jetton notification / excess etc. carry an opcode — not a plain TON deposit
    memo = (comment or "").strip() or None
    return [event(nid, tx["hash"], "ton", tre, value, None, memo=memo, confirmations=1, final=True, from_address=m.get("source"))]


def parse_jetton(nid: str, jt: dict, tre: str) -> dict | None:
    if jt.get("transaction_aborted"):
        return None
    amount = int(jt.get("amount") or 0)
    if amount <= 0:
        return None
    master = (jt.get("jetton_master") or "").lower()
    an = _jetton_by_master(master)
    contract = an["contract"] if an else master
    memo = comment_from_boc(jt.get("forward_payload"))
    return event(nid, jt["transaction_hash"], f"jetton:{master}", tre, amount, contract, memo=(memo or "").strip() or None,
                 confirmations=1, final=True, from_address=jt.get("source"))


def verify(net: dict, txid: str) -> list[dict]:
    tre = treasury()
    res = v3("/transactions", {"hash": txid, "limit": 1}) or {}
    out = []
    for tx in res.get("transactions", []):
        if raw(tx.get("account", tre)) == raw(tre):
            out += parse_native(net["id"], tx, tre)
    jres = v3("/jetton/transfers", {"owner_address": tre, "direction": "in", "limit": 50, "sort": "desc"}) or {}
    for jt in jres.get("jetton_transfers", []):
        if jt.get("transaction_hash") == txid:
            ev = parse_jetton(net["id"], jt, tre)
            if ev:
                out.append(ev)
    return out


# ───────────────────────── sending ─────────────────────────
def seqno(addr: str) -> int:
    info = v2_get("/getWalletInformation", {"address": addr}) or {}
    if info.get("account_state") in ("uninitialized", "uninit", None) and not info.get("seqno"):
        return 0
    return int(info.get("seqno") or 0)


def _send_boc(msg) -> None:
    from tonsdk.utils import bytes_to_b64str

    boc = bytes_to_b64str(msg.to_boc(False))
    res = http_post(config.TONCENTER_V2 + "/sendBoc", {"boc": boc}, _h())
    if isinstance(res, dict) and res.get("ok") is False:
        raise ChainError(f"ton sendBoc: {res.get('error')}")


def query_id_for(ref: str) -> int:
    return int.from_bytes(hashlib.sha256(ref.encode()).digest()[:8], "big") >> 1


def jetton_wallet(owner: str, master: str) -> str:
    res = v3("/jetton/wallets", {"owner_address": owner, "jetton_address": master, "limit": 1}) or {}
    ws = res.get("jetton_wallets") or []
    if not ws:
        raise ChainError("hot wallet has no jetton wallet for this token (fund it first)")
    return ws[0]["address"]


def send(net: dict, an: dict, to: str, amount_units: int, memo: str | None = None, ref: str | None = None) -> str:
    from tonsdk.contract.token.ft import JettonWallet
    from tonsdk.utils import Address

    priv = keys.derive("ton", keys.TREASURY_INDEX)[1]
    wallet = keys.ton_wallet(priv)
    tre = treasury()
    sq = seqno(tre)
    if an.get("contract"):
        qid = query_id_for(ref or f"{to}:{amount_units}:{time.time()}")
        payload = (b"\x00\x00\x00\x00" + memo.encode()) if memo else None
        body = JettonWallet().create_transfer_body(to_address=Address(to), jetton_amount=amount_units, forward_amount=FORWARD_TON,
                                                   forward_payload=payload, response_address=Address(tre), query_id=qid)
        jw = jetton_wallet(tre, an["contract"])
        msg = wallet.create_transfer_message(to_addr=friendly(jw, True), amount=JETTON_FWD_NANO, seqno=sq, payload=body)["message"]
        _send_boc(msg)
        return f"seqno:{sq}:q:{qid}"
    msg = wallet.create_transfer_message(to_addr=to, amount=amount_units, seqno=sq, payload=memo or None)["message"]
    _send_boc(msg)
    return f"seqno:{sq}:to:{raw(to)}:{amount_units}"


def status(net: dict, txid: str) -> tuple[str, int, int]:
    """Our txid is a tracking handle until the chain hash is known: seqno:<n>:q:<query_id> | seqno:<n>:to:<raw>:<amount>."""
    if not txid.startswith("seqno:"):
        return "confirmed", 1, 0
    parts = txid.split(":")
    sq = int(parts[1])
    if seqno(treasury()) <= sq:
        return "pending", 0, 0
    tre = treasury()
    if parts[2] == "q":
        res = v3("/jetton/transfers", {"owner_address": tre, "direction": "out", "limit": 50, "sort": "desc"}) or {}
        for jt in res.get("jetton_transfers", []):
            if str(jt.get("query_id")) == parts[3]:
                return ("failed" if jt.get("transaction_aborted") else "confirmed"), 1, 0
        return "pending", 0, 0
    return "confirmed", 1, 0


def resolve_hash(txid: str) -> str | None:
    """Best effort: find the real transaction hash for an explorer link."""
    if not txid.startswith("seqno:"):
        return txid
    parts = txid.split(":")
    tre = treasury()
    if parts[2] == "q":
        res = v3("/jetton/transfers", {"owner_address": tre, "direction": "out", "limit": 50, "sort": "desc"}) or {}
        for jt in res.get("jetton_transfers", []):
            if str(jt.get("query_id")) == parts[3]:
                return jt.get("transaction_hash")
        return None
    dest, amount = parts[3] + ":" + parts[4], parts[5]
    res = v3("/transactions", {"account": tre, "limit": 50, "sort": "desc"}) or {}
    for tx in res.get("transactions", []):
        for om in tx.get("out_msgs") or []:
            try:
                if raw(om.get("destination", "")) == dest and str(om.get("value")) == amount:
                    return tx.get("hash")
            except Exception:
                continue
    return None


def balance(net: dict, address: str, an: dict | None) -> int:
    if an and an.get("contract"):
        res = v3("/jetton/wallets", {"owner_address": address, "jetton_address": an["contract"], "limit": 1}) or {}
        ws = res.get("jetton_wallets") or []
        return int(ws[0]["balance"]) if ws else 0
    info = v2_get("/getAddressBalance", {"address": address})
    return int(info or 0)


def sweep(net: dict, min_usd: Decimal) -> int:
    return 0  # deposits land directly in the hot wallet


def ops_tick(net: dict):
    return None
