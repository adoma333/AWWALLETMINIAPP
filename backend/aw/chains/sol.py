"""Solana adapter (SOL + SPL tokens such as USDT/USDC) — JSON-RPC + locally signed transactions (solders).

Deposits are found from finalized signatures of the owner and its associated token accounts; credits are computed from
the pre/post balances of the transaction (exact, keyed by signature + mint). Any SPL mint is detected (unknown ones
are recorded as `unrecognized`). SPL sweeps use the hot wallet as fee payer — no SOL top-ups are needed.
"""
import base64
import itertools
from decimal import Decimal

from .. import catalog, config, db, keys
from .base import ChainError, event, http_post, log, state_get, state_set

TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
SYSTEM_PROGRAM = "11111111111111111111111111111111"
MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
_ids = itertools.count(1)


def rpc(method: str, params: list):
    net = catalog.network("sol") or {}
    url = (net.get("config") or {}).get("rpc") or config.RPC["sol"]
    res = http_post(url, {"jsonrpc": "2.0", "id": next(_ids), "method": method, "params": params})
    if isinstance(res, dict) and res.get("error"):
        raise ChainError(f"sol {method}: {res['error']}")
    return res.get("result") if isinstance(res, dict) else None


def ata(owner: str, mint: str) -> str:
    from solders.pubkey import Pubkey

    pda, _ = Pubkey.find_program_address(
        [bytes(Pubkey.from_string(owner)), bytes(Pubkey.from_string(TOKEN_PROGRAM)), bytes(Pubkey.from_string(mint))],
        Pubkey.from_string(ATA_PROGRAM))
    return str(pda)


def _mints() -> list[str]:
    return [r["contract"] for r in db.q("SELECT contract FROM asset_networks WHERE network='sol' AND contract IS NOT NULL")]


# ───────────────────────── deposits ─────────────────────────
def parse_tx(nid: str, sig: str, tx: dict, owner: str) -> list[dict]:
    meta = tx.get("meta") or {}
    if meta.get("err") is not None:
        return []
    keys_ = [k["pubkey"] if isinstance(k, dict) else k for k in tx["transaction"]["message"]["accountKeys"]]
    out = []
    slot = tx.get("slot")
    if owner in keys_:
        i = keys_.index(owner)
        delta = meta["postBalances"][i] - meta["preBalances"][i]
        if delta > 0 and keys_[0] != keys.treasury("sol"):
            out.append(event(nid, sig, "sol", owner, delta, None, block=slot, confirmations=32, final=True, from_address=keys_[0]))
    pre = {(b["accountIndex"], b["mint"]): int(b["uiTokenAmount"]["amount"]) for b in meta.get("preTokenBalances") or []}
    for b in meta.get("postTokenBalances") or []:
        if b.get("owner") != owner:
            continue
        delta = int(b["uiTokenAmount"]["amount"]) - pre.get((b["accountIndex"], b["mint"]), 0)
        if delta > 0:
            out.append(event(nid, sig, f"spl:{b['mint']}", owner, delta, b["mint"], block=slot, confirmations=32, final=True,
                             decimals=int(b["uiTokenAmount"].get("decimals", 0))))
    return out


def _scan_account(nid: str, owner: str, account: str) -> list[dict]:
    key = f"sol:sig:{account}"
    until = state_get(key)
    opts = {"limit": 40, "commitment": "finalized"}
    if until:
        opts["until"] = until
    sigs = rpc("getSignaturesForAddress", [account, opts]) or []
    out = []
    for s in reversed(sigs):
        if s.get("err") is not None:
            continue
        tx = rpc("getTransaction", [s["signature"], {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0, "commitment": "finalized"}])
        if tx:
            out += parse_tx(nid, s["signature"], tx, owner)
    if sigs:
        state_set(key, sigs[0]["signature"])
    return out


def scan(net: dict) -> list[dict]:
    nid = net["id"]
    full = db.now() - int(state_get("sol:full", 0)) > 6 * 3600
    rows = db.q("SELECT address FROM deposit_addresses WHERE family='sol'" + ("" if full else " AND watch_until>?"),
                () if full else (db.now(),))
    out, seen = [], set()
    for r in rows:
        owner = r["address"]
        for acct in [owner] + [ata(owner, m) for m in _mints()]:
            try:
                for ev in _scan_account(nid, owner, acct):
                    k = (ev["txid"], ev["idx"])
                    if k not in seen:
                        seen.add(k)
                        out.append(ev)
            except ChainError as e:
                log.warning("sol scan %s: %s", acct, e)
    if full:
        state_set("sol:full", db.now())
    return out


def verify(net: dict, txid: str) -> list[dict]:
    tx = rpc("getTransaction", [txid, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0, "commitment": "finalized"}])
    if not tx:
        return []
    ours = {r["address"] for r in db.q("SELECT address FROM deposit_addresses WHERE family='sol'")}
    keys_ = [k["pubkey"] if isinstance(k, dict) else k for k in tx["transaction"]["message"]["accountKeys"]]
    owners = set(keys_) | {b.get("owner") for b in (tx.get("meta") or {}).get("postTokenBalances") or []}
    out = []
    for o in owners & ours:
        out += parse_tx(net["id"], txid, tx, o)
    return out


# ───────────────────────── sending ─────────────────────────
def _kp(priv: bytes):
    from solders.keypair import Keypair

    return Keypair.from_seed(priv)


def _ix_transfer_checked(src: str, mint: str, dst: str, owner: str, amount: int, decimals: int):
    from solders.instruction import AccountMeta, Instruction
    from solders.pubkey import Pubkey

    P = Pubkey.from_string
    return Instruction(P(TOKEN_PROGRAM), bytes([12]) + amount.to_bytes(8, "little") + bytes([decimals]),
                       [AccountMeta(P(src), False, True), AccountMeta(P(mint), False, False),
                        AccountMeta(P(dst), False, True), AccountMeta(P(owner), True, False)])


def _ix_create_ata(payer: str, owner: str, mint: str):
    from solders.instruction import AccountMeta, Instruction
    from solders.pubkey import Pubkey

    P = Pubkey.from_string
    return Instruction(P(ATA_PROGRAM), bytes([1]),  # CreateIdempotent
                       [AccountMeta(P(payer), True, True), AccountMeta(P(ata(owner, mint)), False, True),
                        AccountMeta(P(owner), False, False), AccountMeta(P(mint), False, False),
                        AccountMeta(P(SYSTEM_PROGRAM), False, False), AccountMeta(P(TOKEN_PROGRAM), False, False)])


def _ix_memo(text: str, signer: str):
    from solders.instruction import AccountMeta, Instruction
    from solders.pubkey import Pubkey

    return Instruction(Pubkey.from_string(MEMO_PROGRAM), text.encode()[:500], [AccountMeta(Pubkey.from_string(signer), True, False)])


def build_and_send(ixs: list, signers: list, payer) -> str:
    from solders.hash import Hash
    from solders.message import Message
    from solders.transaction import Transaction

    bh = rpc("getLatestBlockhash", [{"commitment": "finalized"}])["value"]["blockhash"]
    blockhash = Hash.from_string(bh)
    msg = Message.new_with_blockhash(ixs, payer.pubkey(), blockhash)
    tx = Transaction(signers, msg, blockhash)
    raw = base64.b64encode(bytes(tx)).decode()
    sig = rpc("sendTransaction", [raw, {"encoding": "base64", "preflightCommitment": "confirmed", "maxRetries": 5}])
    return sig or str(tx.signatures[0])


def build_transfer(priv: bytes, frm_owner: str, an: dict | None, to: str, units: int, memo: str | None = None, fee_payer_priv: bytes | None = None):
    """Returns (instructions, signers, payer) — split out for tests."""
    from solders.pubkey import Pubkey
    from solders.system_program import TransferParams, transfer

    owner_kp = _kp(priv)
    payer_kp = _kp(fee_payer_priv) if fee_payer_priv else owner_kp
    ixs = []
    if an and an.get("contract"):
        mint = an["contract"]
        ixs.append(_ix_create_ata(str(payer_kp.pubkey()), to, mint))
        ixs.append(_ix_transfer_checked(ata(frm_owner, mint), mint, ata(to, mint), frm_owner, units, int(an["decimals"])))
    else:
        ixs.append(transfer(TransferParams(from_pubkey=owner_kp.pubkey(), to_pubkey=Pubkey.from_string(to), lamports=units)))
    if memo:
        ixs.append(_ix_memo(memo, str(owner_kp.pubkey())))
    signers = [payer_kp] if payer_kp.pubkey() == owner_kp.pubkey() else [payer_kp, owner_kp]
    return ixs, signers, payer_kp


def send(net: dict, an: dict, to: str, amount_units: int, memo: str | None = None, ref: str | None = None) -> str:
    frm, priv = keys.derive("sol", keys.TREASURY_INDEX)
    ixs, signers, payer = build_transfer(priv, frm, an if an.get("contract") else None, to, amount_units, memo)
    return build_and_send(ixs, signers, payer)


def status(net: dict, txid: str) -> tuple[str, int, int]:
    res = rpc("getSignatureStatuses", [[txid], {"searchTransactionHistory": True}])
    st = ((res or {}).get("value") or [None])[0]
    if not st:
        return "pending", 0, 0
    if st.get("err"):
        return "failed", 0, 5000
    if st.get("confirmationStatus") == "finalized":
        return "confirmed", 32, 5000
    return "pending", int(st.get("confirmations") or 0), 0


def balance(net: dict, address: str, an: dict | None) -> int:
    if an and an.get("contract"):
        try:
            res = rpc("getTokenAccountBalance", [ata(address, an["contract"]), {"commitment": "finalized"}])
            return int(res["value"]["amount"])
        except (ChainError, KeyError, TypeError):
            return 0
    res = rpc("getBalance", [address, {"commitment": "finalized"}])
    return int((res or {}).get("value", 0))


def sweep(net: dict, min_usd: Decimal) -> int:
    from .. import prices

    nid = net["id"]
    if db.one("SELECT 1 FROM treasury_ops WHERE network=? AND status IN ('pending','broadcast')", (nid,)):
        return 0
    treasury, tpriv = keys.derive("sol", keys.TREASURY_INDEX)
    for c in db.q("SELECT DISTINCT address FROM chain_deposits WHERE network=? AND status='credited' AND (note IS NULL OR note<>'swept')", (nid,)):
        addr = c["address"]
        priv = keys.key_for_address("sol", addr)
        for t in db.q("SELECT DISTINCT contract FROM chain_deposits WHERE network=? AND address=? AND status='credited' AND contract IS NOT NULL "
                      "AND (note IS NULL OR note<>'swept')", (nid, addr)):
            an = catalog.by_contract(nid, t["contract"])
            if not an:
                continue
            bal = balance(net, addr, an)
            if bal > 0 and Decimal(bal).scaleb(-an["decimals"]) * prices.usd(an["asset"]) >= min_usd:
                ixs, signers, payer = build_transfer(priv, addr, an, treasury, bal, fee_payer_priv=tpriv)
                return _op(nid, "sweep_token", addr, treasury, an["asset"], bal, ixs, signers, payer)
        lam = balance(net, addr, None)
        value = lam - 5000
        if value > 0 and Decimal(value).scaleb(-9) * prices.usd("SOL") >= min_usd:
            ixs, signers, payer = build_transfer(priv, addr, None, treasury, value)
            return _op(nid, "sweep_native", addr, treasury, "SOL", value, ixs, signers, payer)
        db.x("UPDATE chain_deposits SET note='swept' WHERE network=? AND address=? AND status='credited'", (nid, addr))
    return 0


def _op(nid, kind, frm, to, asset, units, ixs, signers, payer) -> int:
    op_id = db.insert("treasury_ops", {"network": nid, "kind": kind, "from_address": frm, "to_address": to, "asset": asset,
                                       "amount": str(units), "status": "pending", "created_at": db.now(), "updated_at": db.now()})
    try:
        sig = build_and_send(ixs, signers, payer)
        db.update("treasury_ops", {"id": op_id}, {"txid": sig, "status": "broadcast", "updated_at": db.now()})
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
        if st == "pending" and db.now() - op["updated_at"] > 300:
            st = "failed"  # blockhash expired, never landed
        if st != "pending":
            db.update("treasury_ops", {"id": op["id"]}, {"status": "confirmed" if st == "confirmed" else "failed", "fee": str(fee),
                                                         "updated_at": db.now()})
