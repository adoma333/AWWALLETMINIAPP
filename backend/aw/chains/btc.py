"""Bitcoin adapter — native SegWit (bc1q…) deposit addresses, UTXO accounting, BIP-143 signing, mempool.space API.

There is no sweeping: withdrawals spend user-deposit UTXOs directly (we hold every key), change returns to the hot
wallet. Every UTXO we own is tracked in `btc_utxos`, so coin selection never depends on a third-party balance.
"""
import hashlib
from decimal import Decimal

from .. import addresses, config, db, keys
from .base import ChainError, event, http_get, http_post, log, state_get, state_set

DUST = 546


def dsha(b: bytes) -> bytes:
    return hashlib.sha256(hashlib.sha256(b).digest()).digest()


def hash160(b: bytes) -> bytes:
    return hashlib.new("ripemd160", hashlib.sha256(b).digest()).digest()


def varint(n: int) -> bytes:
    if n < 0xFD:
        return bytes([n])
    if n <= 0xFFFF:
        return b"\xfd" + n.to_bytes(2, "little")
    if n <= 0xFFFFFFFF:
        return b"\xfe" + n.to_bytes(4, "little")
    return b"\xff" + n.to_bytes(8, "little")


def pubkey(priv: bytes) -> bytes:
    from coincurve import PrivateKey

    return PrivateKey(priv).public_key.format(compressed=True)


def p2wpkh_script(pub: bytes) -> bytes:
    return b"\x00\x14" + hash160(pub)


def sighash_bip143(ins: list[dict], outs: list[tuple[int, bytes]], i: int, version: int = 2, locktime: int = 0) -> bytes:
    """ins: [{txid, vout, value, pub, sequence}], outs: [(value, scriptPubKey)] — SIGHASH_ALL for P2WPKH input i."""
    prevouts = b"".join(bytes.fromhex(x["txid"])[::-1] + x["vout"].to_bytes(4, "little") for x in ins)
    seqs = b"".join(x.get("sequence", 0xFFFFFFFD).to_bytes(4, "little") for x in ins)
    outs_ser = b"".join(v.to_bytes(8, "little") + varint(len(s)) + s for v, s in outs)
    me = ins[i]
    script_code = b"\x19\x76\xa9\x14" + hash160(me["pub"]) + b"\x88\xac"
    pre = (version.to_bytes(4, "little") + dsha(prevouts) + dsha(seqs)
           + bytes.fromhex(me["txid"])[::-1] + me["vout"].to_bytes(4, "little")
           + script_code + int(me["value"]).to_bytes(8, "little") + me.get("sequence", 0xFFFFFFFD).to_bytes(4, "little")
           + dsha(outs_ser) + locktime.to_bytes(4, "little") + (1).to_bytes(4, "little"))
    return dsha(pre)


def build_signed(ins: list[dict], outs: list[tuple[int, bytes]], version: int = 2, locktime: int = 0) -> tuple[str, str]:
    """Returns (raw hex, txid). Each input dict also needs `priv`."""
    from coincurve import PrivateKey

    witnesses = []
    for i, x in enumerate(ins):
        digest = sighash_bip143(ins, outs, i, version, locktime)
        sig = PrivateKey(x["priv"]).sign(digest, hasher=None) + b"\x01"  # DER, low-S
        witnesses.append([sig, x["pub"]])
    body_in = varint(len(ins)) + b"".join(bytes.fromhex(x["txid"])[::-1] + x["vout"].to_bytes(4, "little") + b"\x00"
                                          + x.get("sequence", 0xFFFFFFFD).to_bytes(4, "little") for x in ins)
    body_out = varint(len(outs)) + b"".join(v.to_bytes(8, "little") + varint(len(s)) + s for v, s in outs)
    legacy = version.to_bytes(4, "little") + body_in + body_out + locktime.to_bytes(4, "little")
    wit = b"".join(varint(len(w)) + b"".join(varint(len(item)) + item for item in w) for w in witnesses)
    full = version.to_bytes(4, "little") + b"\x00\x01" + body_in + body_out + wit + locktime.to_bytes(4, "little")
    return full.hex(), dsha(legacy)[::-1].hex()


def out_vsize(script: bytes) -> int:
    return 8 + 1 + len(script)


def estimate_vsize(n_in: int, out_scripts: list[bytes]) -> int:
    return 11 + 68 * n_in + sum(out_vsize(s) for s in out_scripts)


# ───────────────────────── API ─────────────────────────
def api(path: str, params: dict | None = None):
    return http_get(config.BTC_API + path, params)


def tip() -> int:
    return int(http_get(config.BTC_API + "/blocks/tip/height"))


def fee_rate() -> int:
    try:
        r = api("/v1/fees/recommended")
        return max(2, int(r.get("halfHourFee") or r.get("hourFee") or 5))
    except ChainError:
        return 8


# ───────────────────────── deposits ─────────────────────────
def scan(net: dict) -> list[dict]:
    nid = net["id"]
    full = db.now() - int(state_get("btc:full", 0)) > 6 * 3600
    rows = db.q("SELECT address FROM deposit_addresses WHERE family='btc'" + ("" if full else " AND watch_until>?"),
                () if full else (db.now(),))
    if not rows:
        return []
    h = tip()
    out = []
    for r in rows:
        try:
            txs = api(f"/address/{r['address']}/txs")
        except ChainError as e:
            log.warning("btc scan %s: %s", r["address"], e)
            continue
        out += parse_txs(nid, r["address"], txs, h)
    if full:
        state_set("btc:full", db.now())
    return out


def parse_txs(nid: str, addr: str, txs: list, h: int) -> list[dict]:
    out = []
    treasury = keys.treasury("btc")
    for tx in txs or []:
        if any((vin.get("prevout") or {}).get("scriptpubkey_address") == treasury for vin in tx.get("vin", [])):
            continue  # our own withdrawal spending from the hot wallet
        st = tx.get("status") or {}
        conf = (h - st["block_height"] + 1) if st.get("confirmed") else 0
        for i, vout in enumerate(tx.get("vout", [])):
            if vout.get("scriptpubkey_address") == addr and int(vout.get("value", 0)) > 0:
                out.append(event(nid, tx["txid"], i, addr, int(vout["value"]), None, block=st.get("block_height"),
                                 confirmations=conf))
    return out


def verify(net: dict, txid: str) -> list[dict]:
    tx = api(f"/tx/{txid}")
    ours = {r["address"] for r in db.q("SELECT address FROM deposit_addresses WHERE family='btc'")}
    h = tip()
    out = []
    for a in {v.get("scriptpubkey_address") for v in tx.get("vout", [])} & ours:
        out += parse_txs(net["id"], a, [tx], h)
    return out


def on_credit(ev: dict):
    """Called by the deposit processor when a BTC output is credited: it becomes spendable inventory."""
    db.x("INSERT OR IGNORE INTO btc_utxos(txid, vout, address, value, status, height, created_at) VALUES(?,?,?,?,?,?,?)",
         (ev["txid"], int(ev["idx"]), ev["address"], int(ev["raw_amount"]), "unspent", ev.get("block"), db.now()))


# ───────────────────────── sending ─────────────────────────
def send(net: dict, an: dict, to: str, amount_units: int, memo: str | None = None, ref: str | None = None) -> str:
    to_script = addresses.btc_script(to)
    treasury = keys.treasury("btc")
    change_script = p2wpkh_script(pubkey(keys.derive("btc", keys.TREASURY_INDEX)[1]))
    rate = fee_rate()
    with db.tx():
        utxos = db.q("SELECT * FROM btc_utxos WHERE status='unspent' ORDER BY value DESC")
        chosen, total = [], 0
        for u in utxos:
            chosen.append(u)
            total += u["value"]
            fee = estimate_vsize(len(chosen), [to_script, change_script]) * rate
            if total >= amount_units + fee:
                break
        fee = estimate_vsize(len(chosen), [to_script, change_script]) * rate
        if total < amount_units + fee:
            raise ChainError("btc hot wallet: insufficient UTXOs")
        change = total - amount_units - fee
        outs = [(amount_units, to_script)]
        if change >= DUST:
            outs.append((change, change_script))
        for u in chosen:
            db.x("UPDATE btc_utxos SET status='reserved' WHERE txid=? AND vout=?", (u["txid"], u["vout"]))
    ins = []
    for u in chosen:
        priv = keys.key_for_address("btc", u["address"])
        ins.append({"txid": u["txid"], "vout": u["vout"], "value": u["value"], "priv": priv, "pub": pubkey(priv)})
    raw, txid = build_signed(ins, outs)
    try:
        res = http_post(config.BTC_API + "/tx", raw=raw, headers={"Content-Type": "text/plain"})
        if isinstance(res, str) and len(res.strip()) == 64:
            txid = res.strip()
    except Exception:
        with db.tx():
            for u in chosen:
                db.x("UPDATE btc_utxos SET status='unspent' WHERE txid=? AND vout=?", (u["txid"], u["vout"]))
        raise
    with db.tx():
        for u in chosen:
            db.x("UPDATE btc_utxos SET status='spent', spent_by=? WHERE txid=? AND vout=?", (txid, u["txid"], u["vout"]))
        if change >= DUST:
            db.x("INSERT OR IGNORE INTO btc_utxos(txid, vout, address, value, status, created_at) VALUES(?,?,?,?,?,?)",
                 (txid, 1, treasury, change, "unspent", db.now()))
    return txid


def status(net: dict, txid: str) -> tuple[str, int, int]:
    try:
        st = api(f"/tx/{txid}/status")
    except ChainError:
        return "pending", 0, 0
    if not st.get("confirmed"):
        return "pending", 0, 0
    conf = tip() - int(st["block_height"]) + 1
    return ("confirmed" if conf >= int(net.get("confirmations") or 2) else "pending"), conf, 0


def balance(net: dict, address: str, an: dict | None) -> int:
    if address == "*":
        return int(db.val("SELECT COALESCE(SUM(value),0) FROM btc_utxos WHERE status IN ('unspent','reserved')", (), 0))
    st = api(f"/address/{address}")
    cs = st.get("chain_stats", {})
    return int(cs.get("funded_txo_sum", 0)) - int(cs.get("spent_txo_sum", 0))


def sync_treasury_utxos() -> int:
    """Pick up coins the owner sends to the hot wallet (funding), confirmed only."""
    treasury = keys.treasury("btc")
    n = 0
    for u in api(f"/address/{treasury}/utxo") or []:
        if (u.get("status") or {}).get("confirmed"):
            n += db.x("INSERT OR IGNORE INTO btc_utxos(txid, vout, address, value, status, height, created_at) VALUES(?,?,?,?,?,?,?)",
                      (u["txid"], int(u["vout"]), treasury, int(u["value"]), "unspent", u["status"].get("block_height"), db.now())).rowcount
    return n


def sweep(net: dict, min_usd: Decimal) -> int:
    return 0  # not needed: UTXOs are spent directly


def ops_tick(net: dict):
    if db.now() - int(state_get("btc:utxo_sync", 0)) > 600:
        try:
            sync_treasury_utxos()
        except ChainError as e:
            log.warning("btc utxo sync: %s", e)
        state_set("btc:utxo_sync", db.now())
