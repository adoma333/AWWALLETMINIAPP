"""Chain adapters: every signature we produce is verified independently; parsers are checked on real API shapes."""
import base64
import hashlib

import pytest

from aw import catalog, db, keys
from aw.chains import btc, evm, sol, ton, tron


# ───────────── EVM ─────────────
def test_evm_token_withdraw_is_signed_by_hot_wallet(monkeypatch):
    from eth_account import Account

    sent = {}

    def rpc(nid, method, params):
        if method == "eth_getTransactionCount":
            return "0x7"
        if method == "eth_estimateGas":
            return hex(52000)
        if method == "eth_getBlockByNumber":
            return {"baseFeePerGas": hex(20 * 10 ** 9)}
        if method == "eth_maxPriorityFeePerGas":
            return hex(10 ** 9)
        if method == "eth_sendRawTransaction":
            sent["raw"] = params[0]
            return "0x" + Account.recover_transaction(params[0]).lower()[2:].rjust(64, "0")
        raise AssertionError(method)

    monkeypatch.setattr(evm, "rpc", rpc)
    net = catalog.network("eth")
    an = catalog.asset_network("USDT", "eth")
    to = "0x000000000000000000000000000000000000dEaD"
    evm.send(net, an, to, 123_456_789)
    raw = sent["raw"]
    assert Account.recover_transaction(raw) == keys.treasury("evm")
    from eth_account._utils.legacy_transactions import Transaction  # noqa: F401  (import check only)
    from eth_account.typed_transactions import TypedTransaction

    from hexbytes import HexBytes

    tx = TypedTransaction.from_bytes(HexBytes(raw)).as_dict()
    to_field = tx["to"].hex() if isinstance(tx["to"], (bytes, bytearray)) else tx["to"]
    assert tx["chainId"] == 1 and to_field.lower().removeprefix("0x") == an["contract"].lower()[2:] and tx["nonce"] == 7
    data = tx["data"].hex() if isinstance(tx["data"], bytes) else tx["data"]
    data = data[2:] if data.startswith("0x") else data
    assert data[:8] == "a9059cbb" and data[32:72] == to.lower()[2:] and int(data[72:], 16) == 123_456_789
    assert tx["maxFeePerGas"] == 41 * 10 ** 9 and tx["gas"] == 65000


def test_evm_log_scan_parses_transfers(monkeypatch):
    from aw import users

    users.upsert_from_telegram({"id": 5, "first_name": "E"})
    from aw import deposits

    addr = deposits.get_address(users.get(5), "bsc")["address"]
    log = {"address": "0x55d398326f99059ff775485246999027b3197955", "blockNumber": hex(1990), "transactionHash": "0x" + "aa" * 32,
           "logIndex": "0x4", "data": hex(7 * 10 ** 18), "removed": False,
           "topics": [evm.TRANSFER_TOPIC, "0x" + "0" * 24 + "1" * 40, "0x" + "0" * 24 + addr.lower()[2:]]}
    monkeypatch.setattr(evm, "rpc", lambda nid, m, p: [log] if m == "eth_getLogs" else None)
    db.x("INSERT INTO scan_state(key, value) VALUES('evm:bsc:logs', '1980')")
    evs = evm._scan_logs("bsc", 2000)
    assert len(evs) == 1 and evs[0]["address"] == addr and evs[0]["raw_amount"] == 7 * 10 ** 18 and evs[0]["confirmations"] == 11


# ───────────── TRON ─────────────
def test_tron_signature_recovers_to_hot_wallet(monkeypatch):
    from coincurve import PublicKey

    raw_hex = "0a02" + "ab" * 40
    txid = hashlib.sha256(bytes.fromhex(raw_hex)).hexdigest()
    calls = []

    def api(path, body=None, get=False, params=None):
        calls.append((path, body))
        if path == "/wallet/triggersmartcontract":
            return {"result": {"result": True}, "transaction": {"txID": txid, "raw_data_hex": raw_hex, "raw_data": {}}}
        if path == "/wallet/broadcasttransaction":
            return {"result": True, "txid": txid}
        raise AssertionError(path)

    monkeypatch.setattr(tron, "api", api)
    an = catalog.asset_network("USDT", "tron")
    out = tron.send(catalog.network("tron"), an, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", 5_000_000)
    assert out == txid
    trig = calls[0][1]
    assert trig["owner_address"] == keys.treasury("tron") and trig["function_selector"] == "transfer(address,uint256)"
    assert int(trig["parameter"][64:], 16) == 5_000_000
    sig = bytes.fromhex(calls[1][1]["signature"][0])
    pub = PublicKey.from_signature_and_message(sig, bytes.fromhex(txid), hasher=None)
    from bip_utils import TrxAddrEncoder

    assert TrxAddrEncoder.EncodeKey(pub.format(compressed=False)) == keys.treasury("tron")


def test_tron_history_parsing_skips_own_topups(monkeypatch):
    addr = keys.derive("tron", 1000)[0]
    treasury_hex = tron.b58_to_hex(keys.treasury("tron"))
    stranger_hex = tron.b58_to_hex("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")
    trc20 = {"data": [{"transaction_id": "t1", "token_info": {"address": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "decimals": 6},
                       "block_timestamp": 1700000000000, "from": "TXYZ", "to": addr, "type": "Transfer", "value": "2500000"}]}
    trx = {"data": [
        {"txID": "n1", "block_timestamp": 1700000001000, "ret": [{"contractRet": "SUCCESS"}],
         "raw_data": {"contract": [{"type": "TransferContract", "parameter": {"value": {"amount": 3_000_000, "owner_address": stranger_hex, "to_address": tron.b58_to_hex(addr)}}}]}},
        {"txID": "n2", "block_timestamp": 1700000002000, "ret": [{"contractRet": "SUCCESS"}],
         "raw_data": {"contract": [{"type": "TransferContract", "parameter": {"value": {"amount": 30_000_000, "owner_address": treasury_hex, "to_address": tron.b58_to_hex(addr)}}}]}},
    ]}
    monkeypatch.setattr(tron, "api", lambda path, body=None, get=False, params=None: trc20 if "trc20" in path else trx)
    evs = tron._scan_address("tron", addr)
    assert [(e["txid"], e["raw_amount"]) for e in evs] == [("t1", 2_500_000), ("n1", 3_000_000)]


# ───────────── Bitcoin ─────────────
def test_btc_segwit_transaction_verifies_with_bitcointx():
    bitcointx = pytest.importorskip("bitcointx")
    import os

    import coincurve

    lib = [f for f in os.listdir(os.path.dirname(coincurve.__file__)) if f.startswith("_libsecp256k1")]
    if lib:  # reuse the libsecp256k1 that ships inside coincurve
        bitcointx.set_custom_secp256k1_path(os.path.join(os.path.dirname(coincurve.__file__), lib[0]))
    from bitcointx import select_chain_params
    from bitcointx.core import CTransaction
    from bitcointx.core.script import CScript
    from bitcointx.core.scripteval import SCRIPT_VERIFY_P2SH, SCRIPT_VERIFY_WITNESS, VerifyScript

    select_chain_params("bitcoin")
    ins = []
    for i, idx in enumerate((1000, 1001)):
        addr, priv = keys.derive("btc", idx)
        pub = btc.pubkey(priv)
        assert btc.p2wpkh_script(pub) == btc.addresses.btc_script(addr)
        ins.append({"txid": hashlib.sha256(bytes([i])).hexdigest(), "vout": i, "value": 50_000 + i, "priv": priv, "pub": pub})
    outs = [(60_000, btc.addresses.btc_script("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu")),
            (30_000, btc.addresses.btc_script("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")),
            (5_000, btc.addresses.btc_script("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"))]
    raw, txid = btc.build_signed(ins, outs)
    tx = CTransaction.deserialize(bytes.fromhex(raw))
    assert tx.GetTxid()[::-1].hex() == txid
    for i, x in enumerate(ins):
        script_pubkey = CScript(btc.p2wpkh_script(x["pub"]))
        VerifyScript(tx.vin[i].scriptSig, script_pubkey, tx, i, flags={SCRIPT_VERIFY_P2SH, SCRIPT_VERIFY_WITNESS},
                     amount=x["value"], witness=tx.wit.vtxinwit[i].scriptWitness)  # raises if any signature is wrong


def test_btc_address_scripts():
    assert btc.addresses.btc_script("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu")[:2] == b"\x00\x14"
    assert btc.addresses.btc_script("bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297")[:2] == b"\x51\x20"
    with pytest.raises(Exception):
        btc.addresses.btc_script("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv")


def test_btc_deposit_parsing():
    addr = keys.derive("btc", 1000)[0]
    txs = [{"txid": "f" * 64, "status": {"confirmed": True, "block_height": 800000},
            "vin": [{"prevout": {"scriptpubkey_address": "bc1qother"}}],
            "vout": [{"scriptpubkey_address": "bc1qelse", "value": 10}, {"scriptpubkey_address": addr, "value": 150000}]},
           {"txid": "e" * 64, "status": {"confirmed": False}, "vin": [], "vout": [{"scriptpubkey_address": addr, "value": 9999}]}]
    evs = btc.parse_txs("btc", addr, txs, 800001)
    assert [(e["idx"], e["raw_amount"], e["confirmations"]) for e in evs] == [("1", 150000, 2), ("0", 9999, 0)]


# ───────────── Solana ─────────────
def test_solana_spl_transfer_is_validly_signed():
    from solders.hash import Hash
    from solders.message import Message
    from solders.transaction import Transaction

    owner, opriv = keys.derive("sol", 1000)
    tre, tpriv = keys.derive("sol", 0)
    an = catalog.asset_network("USDT", "sol")
    ixs, signers, payer = sol.build_transfer(opriv, owner, an, tre, 1_500_000, fee_payer_priv=tpriv)
    bh = Hash.default()
    tx = Transaction(signers, Message.new_with_blockhash(ixs, payer.pubkey(), bh), bh)
    tx.verify()  # raises on a bad signature
    assert str(payer.pubkey()) == tre and len(tx.signatures) == 2
    tc = ixs[1]
    assert bytes(tc.data)[0] == 12 and int.from_bytes(bytes(tc.data)[1:9], "little") == 1_500_000 and bytes(tc.data)[9] == 6
    assert str(tc.accounts[0].pubkey) == sol.ata(owner, an["contract"]) and str(tc.accounts[2].pubkey) == sol.ata(tre, an["contract"])


def test_solana_deposit_parsing():
    owner = keys.derive("sol", 1000)[0]
    mint = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
    tx = {"slot": 5, "meta": {"err": None, "preBalances": [10, 0], "postBalances": [5, 2_000_000],
                              "preTokenBalances": [{"accountIndex": 3, "mint": mint, "owner": owner, "uiTokenAmount": {"amount": "100", "decimals": 6}}],
                              "postTokenBalances": [{"accountIndex": 3, "mint": mint, "owner": owner, "uiTokenAmount": {"amount": "7000100", "decimals": 6}}]},
          "transaction": {"message": {"accountKeys": [{"pubkey": "Sender1111111111111111111111111111111111111"}, {"pubkey": owner}]}}}
    evs = sol.parse_tx("sol", "sig1", tx, owner)
    assert sorted((e["idx"], e["raw_amount"]) for e in evs) == [("sol", 2_000_000), (f"spl:{mint}", 7_000_000)]


# ───────────── TON ─────────────
def _comment_cell(text: str, either: bool = False, as_ref: bool = False) -> str:
    from tonsdk.boc import Cell

    c = Cell()
    c.bits.write_uint(0, 32)
    c.bits.write_string(text)
    if as_ref:
        outer = Cell()
        outer.bits.write_bit(1)
        outer.refs.append(c)
        c = outer
    elif either:
        outer = Cell()
        outer.bits.write_bit(0)
        outer.write_cell(c)
        c = outer
    return base64.b64encode(c.to_boc(False)).decode()


def test_ton_comment_parsing_all_forms():
    assert ton.comment_from_boc(_comment_cell("123456789")) == "123456789"
    assert ton.comment_from_boc(_comment_cell("555", either=True)) == "555"
    assert ton.comment_from_boc(_comment_cell("777", as_ref=True)) == "777"
    assert ton.comment_from_boc("not-a-boc") is None


def test_ton_parsing_native_and_jetton():
    tre = keys.treasury("ton")
    tx = {"hash": "H1", "lt": "100", "description": {"aborted": False},
          "in_msg": {"source": "0:" + "11" * 32, "value": "2500000000", "bounced": False,
                     "message_content": {"decoded": {"type": "text_comment", "comment": " 123456789 "}}}}
    ev = ton.parse_native("ton", tx, tre)[0]
    assert ev["memo"] == "123456789" and ev["raw_amount"] == 2_500_000_000
    bounced = dict(tx, in_msg=dict(tx["in_msg"], bounced=True))
    assert ton.parse_native("ton", bounced, tre) == []
    usdt_raw = ton.raw("EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs")
    jt = {"transaction_hash": "J1", "transaction_lt": "200", "transaction_aborted": False, "amount": "15000000", "jetton_master": usdt_raw.upper(),
          "source": "0:" + "22" * 32, "forward_payload": _comment_cell("987654321", either=True)}
    ev = ton.parse_jetton("ton", jt, tre)
    assert ev["memo"] == "987654321" and ev["contract"] == "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs" and ev["raw_amount"] == 15_000_000


def test_ton_withdraw_message_builds(monkeypatch):
    sent = {}
    monkeypatch.setattr(ton, "seqno", lambda addr: 4)
    monkeypatch.setattr(ton, "_send_boc", lambda msg: sent.setdefault("boc", msg.to_boc(False)))
    monkeypatch.setattr(ton, "jetton_wallet", lambda owner, master: "0:" + "33" * 32)
    h = ton.send(catalog.network("ton"), catalog.asset_network("TON", "ton"), keys.derive("ton", 5)[0], 10 ** 9, "memo-1")
    assert h.startswith("seqno:4:to:") and sent["boc"]
    h2 = ton.send(catalog.network("ton"), catalog.asset_network("USDT", "ton"), keys.derive("ton", 5)[0], 5_000_000, None, ref="WDX")
    assert h2 == f"seqno:4:q:{ton.query_id_for('WDX')}"


def test_ton_connect_deposit_payload(monkeypatch):
    from aw import ton_connect, users

    u, _ = users.upsert_from_telegram({"id": 77, "first_name": "T"})
    msg = ton_connect.deposit_message(u, "TON", "1.5", keys.derive("ton", 5)[0])
    m = msg["messages"][0]
    assert m["amount"] == "1500000000" and ton.comment_from_boc(m["payload"]) == msg["memo"]
    monkeypatch.setattr(ton, "jetton_wallet", lambda owner, master: "0:" + "44" * 32)
    j = ton_connect.deposit_message(u, "USDT", "10", keys.derive("ton", 5)[0])
    assert j["messages"][0]["amount"] == str(ton.JETTON_FWD_NANO) and j["memo"] == msg["memo"]
