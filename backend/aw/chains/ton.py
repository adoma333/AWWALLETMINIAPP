"""TON adapter — every user has a personal wallet (v4r2, derived from the master seed). No memo needed.

Deposits: each user address is scanned on toncenter v3 (TON + any jetton). Recently active addresses are scanned
every cycle, all others on a slow rotation. Funds are consolidated into the hot wallet by `sweep` (TON directly;
jettons after a small TON top-up for gas). The old shared-address + memo deposits are still recognised for users who
received a memo earlier. Withdrawals go out from the hot wallet; sends from one wallet are serialised (seqno).
"""
import base64
import hashlib
import threading
import time
from decimal import Decimal

from .. import config, db, keys
from .base import ChainError, event, http_get, http_post, state_get, state_set

JETTON_FWD_NANO = 50_000_000      # 0.05 TON attached to a jetton transfer (excess comes back)
FORWARD_TON = 1                   # 1 nanoton so the receiver gets a notification with the comment
SWEEP_GAS_NANO = 80_000_000       # TON sent to a user wallet so it can move its jettons to the hot wallet
SWEEP_MIN_TON_NANO = 120_000_000  # sweep native TON once a user wallet holds at least 0.12 TON
ROTATION = 25                     # addresses scanned per cycle on the slow pass
_SEND_LOCKS: dict[str, threading.Lock] = {}
_OURS = {"at": 0.0, "map": {}}


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


# ───────────────────────── our addresses ─────────────────────────
def ours(refresh: bool = False) -> dict[str, int]:
    """raw address → user_id for every personal TON wallet (cached for a minute, refreshed on a miss)."""
    if refresh or time.time() - _OURS["at"] > 60:
        m = {}
        for r in db.q("SELECT user_id, address FROM deposit_addresses WHERE family='ton' AND hd_index IS NOT NULL"):
            try:
                m[raw(r["address"])] = r["user_id"]
            except Exception:
                continue
        _OURS.update(at=time.time(), map=m)
    return _OURS["map"]


def owner_of(addr: str) -> int | None:
    try:
        r = raw(addr)
    except Exception:
        return None
    uid = ours().get(r)
    if uid is None and time.time() - _OURS["at"] > 1:  # an address created since the last refresh
        uid = ours(refresh=True).get(r)
    return uid


def _is_internal(src: str | None) -> bool:
    """Transfers between our own wallets (sweeps, gas top-ups) are never deposits."""
    if not src:
        return False
    try:
        r = raw(src)
    except Exception:
        return False
    return r == raw(treasury()) or r in ours()


def _pace():
    if not config.TESTING:
        time.sleep(0.12 if config.TONCENTER_KEY else 1.05)  # toncenter: 1 rps without a key, 10 rps with one


# ───────────────────────── deposits ─────────────────────────
def scan(net: dict) -> list[dict]:
    nid = net["id"]
    out = _scan_legacy(nid)
    from .base import all_addresses, watched

    hot = {r["address"] for r in watched("ton") if r.get("hd_index") is not None}
    every = [r["address"] for r in all_addresses("ton") if r.get("hd_index") is not None]
    if every:
        cur = int(state_get("ton:rot", 0)) % len(every)
        batch = every[cur:cur + ROTATION] + every[:max(0, cur + ROTATION - len(every))]
        state_set("ton:rot", (cur + ROTATION) % len(every))
        hot |= set(batch)
    for addr in hot:
        try:
            out += _scan_address(nid, addr)
        except ChainError as e:
            from .base import log

            log.warning("ton scan %s: %s", addr, e)
    return out


def _scan_address(nid: str, addr: str) -> list[dict]:
    out = []
    key = f"ton:lt:{raw(addr)}"
    last = int(state_get(key, 0))
    params = {"account": addr, "limit": 50, "sort": "desc"}
    if last:
        params["start_lt"] = last + 1
    txs = (v3("/transactions", params) or {}).get("transactions", [])
    _pace()
    top = last
    for tx in txs:
        top = max(top, int(tx.get("lt", 0)))
        out += parse_native(nid, tx, addr)
    jkey = f"ton:jlt:{raw(addr)}"
    jlast = int(state_get(jkey, 0))
    jp = {"owner_address": addr, "direction": "in", "limit": 50, "sort": "desc"}
    if jlast:
        jp["start_lt"] = jlast + 1
    jts = (v3("/jetton/transfers", jp) or {}).get("jetton_transfers", [])
    _pace()
    jtop = jlast
    for jt in jts:
        jtop = max(jtop, int(jt.get("transaction_lt", 0)))
        ev = parse_jetton(nid, jt, addr)
        if ev:
            out.append(ev)
    if top > last:
        state_set(key, top)
    if jtop > jlast:
        state_set(jkey, jtop)
    return out


def _scan_legacy(nid: str) -> list[dict]:
    """Deposits to the hot wallet carrying an old personal memo (users who were given a memo before)."""
    tre = treasury()
    out = []
    last_lt = int(state_get("ton:lt", 0))
    params = {"account": tre, "limit": 100, "sort": "desc"}
    if last_lt:
        params["start_lt"] = last_lt + 1
    txs = (v3("/transactions", params) or {}).get("transactions", [])
    _pace()
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
    _pace()
    max_j = last_j
    for jt in jts:
        max_j = max(max_j, int(jt.get("transaction_lt", 0)))
        ev = parse_jetton(nid, jt, tre)
        if ev:
            out.append(ev)
    if max_j > last_j:
        state_set("ton:jlt", max_j)
    return out


def parse_native(nid: str, tx: dict, addr: str) -> list[dict]:
    m = tx.get("in_msg") or {}
    if not m.get("source") or m.get("bounced") or _is_internal(m.get("source")):
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
    return [event(nid, tx["hash"], "ton", addr, value, None, memo=memo, confirmations=1, final=True, from_address=m.get("source"))]


def parse_jetton(nid: str, jt: dict, addr: str) -> dict | None:
    if jt.get("transaction_aborted") or _is_internal(jt.get("source")):
        return None
    amount = int(jt.get("amount") or 0)
    if amount <= 0:
        return None
    master = (jt.get("jetton_master") or "").lower()
    an = _jetton_by_master(master)
    contract = an["contract"] if an else master
    memo = comment_from_boc(jt.get("forward_payload"))
    return event(nid, jt["transaction_hash"], f"jetton:{master}", addr, amount, contract, memo=(memo or "").strip() or None,
                 confirmations=1, final=True, from_address=jt.get("source"))


def verify(net: dict, txid: str) -> list[dict]:
    """Look a pasted hash up: a transaction on one of our wallets, or a jetton transfer into one of them."""
    tre = treasury()
    res = v3("/transactions", {"hash": txid, "limit": 1}) or {}
    out = []
    for tx in res.get("transactions", []):
        acc = tx.get("account", "")
        if raw(acc) == raw(tre):
            out += parse_native(net["id"], tx, tre)
        elif owner_of(acc):
            out += parse_native(net["id"], tx, next(r["address"] for r in db.q(
                "SELECT address FROM deposit_addresses WHERE family='ton' AND hd_index IS NOT NULL") if raw(r["address"]) == raw(acc)))
    if not out:
        jres = v3("/jetton/transfers", {"transaction_hash": txid, "limit": 10}) or {}
        for jt in jres.get("jetton_transfers", []):
            dest = jt.get("destination") or ""
            target = tre if dest and raw(dest) == raw(tre) else None
            if not target and owner_of(dest):
                target = next(r["address"] for r in db.q("SELECT address FROM deposit_addresses WHERE family='ton' AND hd_index IS NOT NULL")
                              if raw(r["address"]) == raw(dest))
            if target:
                ev = parse_jetton(net["id"], jt, target)
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


def _lock(addr: str) -> threading.Lock:
    return _SEND_LOCKS.setdefault(raw(addr), threading.Lock())


def _wait_seqno(addr: str, old: int, timeout: float = 45) -> bool:
    """A wallet accepts one message per seqno: wait until the last one landed before signing the next."""
    if config.TESTING:
        return True
    end = time.time() + timeout
    while time.time() < end:
        time.sleep(3)
        try:
            if seqno(addr) > old:
                return True
        except ChainError:
            continue
    return False


def _transfer(priv: bytes, frm: str, to: str, amount: int, payload=None, send_mode: int = 3) -> int:
    """Sign and send one message from one of our wallets (serialised per wallet). Returns the seqno used."""
    wallet = keys.ton_wallet(priv)
    with _lock(frm):
        sq = seqno(frm)
        msg = wallet.create_transfer_message(to_addr=to, amount=amount, seqno=sq, payload=payload, send_mode=send_mode)["message"]
        _send_boc(msg)
        _wait_seqno(frm, sq)
    return sq


def send(net: dict, an: dict, to: str, amount_units: int, memo: str | None = None, ref: str | None = None) -> str:
    from tonsdk.contract.token.ft import JettonWallet
    from tonsdk.utils import Address

    priv = keys.derive("ton", keys.TREASURY_INDEX)[1]
    tre = treasury()
    if an.get("contract"):
        qid = query_id_for(ref or f"{to}:{amount_units}:{time.time()}")
        payload = (b"\x00\x00\x00\x00" + memo.encode()) if memo else None
        body = JettonWallet().create_transfer_body(to_address=Address(to), jetton_amount=amount_units, forward_amount=FORWARD_TON,
                                                   forward_payload=payload, response_address=Address(tre), query_id=qid)
        jw = jetton_wallet(tre, an["contract"])
        sq = _transfer(priv, tre, friendly(jw, True), JETTON_FWD_NANO, body)
        return f"seqno:{sq}:q:{qid}"
    sq = _transfer(priv, tre, to, amount_units, memo or None)
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
    """Move funds from personal wallets into the hot wallet: jettons first (after a TON top-up for gas), then TON.
    One action per address per run; an address with a recent action is skipped until its messages settle."""
    from tonsdk.contract.token.ft import JettonWallet
    from tonsdk.utils import Address

    from .. import prices
    from ..money import from_units

    tre = treasury()
    tre_priv = keys.derive("ton", keys.TREASURY_INDEX)[1]
    jettons = db.q("SELECT * FROM asset_networks WHERE network='ton' AND contract IS NOT NULL AND enabled=1")
    done = 0
    # only wallets that received deposits not yet consolidated (keeps API calls proportional to activity)
    rows = db.q("SELECT DISTINCT address FROM chain_deposits WHERE network='ton' AND status='credited' AND (note IS NULL OR note<>'swept')")
    for r in rows:
        addr = r["address"]
        if raw(addr) == raw(tre):
            continue
        busy = int(state_get(f"ton:sweep:{raw(addr)}", 0))
        if busy and time.time() - busy < 180:
            continue
        try:
            native = balance(net, addr, None)
            _pace()
            acted = False
            for an in jettons:
                units = balance(net, addr, an)
                _pace()
                if units <= 0:
                    continue
                usd = from_units(units, an["decimals"]) * prices.usd(an["asset"])
                if usd < min_usd:
                    continue
                if native < SWEEP_GAS_NANO // 2:  # not enough TON to pay for the jetton transfer → top it up first
                    _transfer(tre_priv, tre, friendly(addr, False), SWEEP_GAS_NANO)
                    db.insert("treasury_ops", {"network": "ton", "kind": "topup", "from_address": tre, "to_address": addr, "asset": "TON",
                                               "amount": str(from_units(SWEEP_GAS_NANO, 9)), "status": "sent", "created_at": db.now()})
                else:
                    priv = keys.key_for_address("ton", addr)
                    body = JettonWallet().create_transfer_body(to_address=Address(tre), jetton_amount=units, forward_amount=FORWARD_TON,
                                                               response_address=Address(tre), query_id=query_id_for(f"sweep:{addr}:{time.time()}"))
                    jw = jetton_wallet(addr, an["contract"])
                    _transfer(priv, addr, friendly(jw, True), JETTON_FWD_NANO, body)
                    db.insert("treasury_ops", {"network": "ton", "kind": "sweep_token", "from_address": addr, "to_address": tre,
                                               "asset": an["asset"], "amount": str(from_units(units, an["decimals"])), "status": "sent",
                                               "created_at": db.now()})
                    done += 1
                state_set(f"ton:sweep:{raw(addr)}", int(time.time()))
                acted = True
                break
            if acted:
                continue
            still_tokens = False
            for an in jettons:
                if balance(net, addr, an) > 0:
                    still_tokens = True
                    break
                _pace()
            if native >= SWEEP_MIN_TON_NANO and not still_tokens:
                priv = keys.key_for_address("ton", addr)
                _transfer(priv, addr, tre, 0, None, send_mode=128)  # 128 = carry the whole remaining balance
                db.insert("treasury_ops", {"network": "ton", "kind": "sweep_native", "from_address": addr, "to_address": tre, "asset": "TON",
                                           "amount": str(from_units(native, 9)), "status": "sent", "created_at": db.now()})
                state_set(f"ton:sweep:{raw(addr)}", int(time.time()))
                done += 1
            if not still_tokens and native < SWEEP_MIN_TON_NANO * 4:
                # wallet is empty (or dust only): its deposits are consolidated
                db.x("UPDATE chain_deposits SET note='swept' WHERE network='ton' AND address=? AND status='credited'", (addr,))
        except ChainError as e:
            from .base import log

            log.warning("ton sweep %s: %s", addr, e)
    return done


def ops_tick(net: dict):
    return None
