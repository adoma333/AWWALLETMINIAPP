import threading
import time
from decimal import Decimal

import pytest

from aw import catalog, config, db, fees, guard, keys, ledger, security, users
from aw.money import AppError
from conftest import fund, init_data


def test_init_data_roundtrip_and_tamper():
    raw = init_data(42, "alice")
    data = security.verify_init_data(raw)
    assert data["user"]["id"] == 42
    with pytest.raises(AppError) as e:
        security.verify_init_data(raw.replace("alice", "mallory"))
    assert e.value.code == "auth_invalid"
    old = security.sign_init_data({"id": 1, "first_name": "x"}, config.BOT_TOKEN, auth_date=int(time.time()) - 10 ** 6)
    with pytest.raises(AppError) as e:
        security.verify_init_data(old)
    assert e.value.code == "auth_expired"
    with pytest.raises(AppError):
        security.verify_init_data(raw, bot_token="999:OTHER")


def test_pin_hashing_and_policy():
    h = security.hash_pin("482917")
    assert security.check_pin("482917", h) and not security.check_pin("482918", h)
    for bad in ("12345", "abcdef", "123456", "000000"):
        with pytest.raises(AppError):
            security.validate_new_pin(bad)


def test_pin_lockout_and_hold():
    u, _ = users.upsert_from_telegram({"id": 7, "first_name": "P"})
    guard.set_pin(u, "482917")
    u = users.get(7)
    for _ in range(4):
        with pytest.raises(AppError) as e:
            guard.verify_pin(u, "000001")
        assert e.value.code == "pin_wrong"
        u = users.get(7)
    with pytest.raises(AppError) as e:
        guard.verify_pin(u, "000001")
    assert e.value.code == "pin_locked"
    with pytest.raises(AppError) as e:
        guard.verify_pin(users.get(7), "482917")
    assert e.value.code == "pin_locked"
    db.update("users", {"id": 7}, {"pin_locked_until": 0})
    guard.set_pin(users.get(7), "593028", old_pin="482917")
    assert users.get(7)["security_hold_until"] > db.now()  # changing a PIN pauses withdrawals


def test_ledger_invariants_and_concurrency():
    users.upsert_from_telegram({"id": 1, "first_name": "A"})
    fund(1, "USDT", "100")
    with pytest.raises(AppError):
        ledger.debit(1, "USDT", "100.01", "x")
    ledger.lock(1, "USDT", "40", "x")
    assert ledger.available(1, "USDT") == Decimal("60")
    errors = []

    def spend():
        try:
            ledger.debit(1, "USDT", "1", "race")
        except AppError as e:
            errors.append(e.code)

    threads = [threading.Thread(target=spend) for _ in range(80)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert ledger.available(1, "USDT") == 0
    assert errors.count("insufficient_funds") == 20
    assert ledger.audit() == []


def test_fee_engine_precedence_vip_promo_voucher():
    u, _ = users.upsert_from_telegram({"id": 11, "first_name": "F"})
    base = fees.quote("swap", u, "BTC", pair="BTC/ETH")
    assert base["pct"] == Decimal("0.8")
    assert fees.quote("swap", u, "USDT", pair="USDT/USDC")["pct"] == Decimal("0.1")
    db.update("users", {"id": 11}, {"role": "merchant"})
    u = users.get(11)
    assert fees.quote("swap", u, "BTC", pair="BTC/ETH")["pct"] == Decimal("0.5")
    db.insert("fee_rules", {"kind": "swap", "scope": "user", "scope_id": "11", "pct": "0.2", "fixed": "0", "min_fee": "0", "max_fee": "0", "active": 1})
    assert fees.quote("swap", u, "BTC", pair="BTC/ETH")["pct"] == Decimal("0.2")
    users.set_flag(11, "vip_level", 2)  # Gold: 20 % off
    assert fees.quote("swap", users.get(11), "BTC", pair="BTC/ETH")["pct"] == Decimal("0.16")
    db.insert("promos", {"name": "free", "kinds": ["withdraw"], "assets": ["USDT"], "discount_pct": "100", "active": 1})
    q = fees.quote("withdraw", users.get(11), "USDT", "50", network="tron")
    assert q["fee"] == 0 and q["free"]
    db.x("UPDATE promos SET active=0")
    # vouchers
    from aw import rewards

    users.upsert_from_telegram({"id": 12, "first_name": "V"})
    u12 = users.get(12)
    q = fees.quote("withdraw", u12, "USDT", "50", network="bsc")
    assert q["fee"] == 0 and q["voucher"]  # welcome voucher (fee-free withdraw)
    fees.consume_voucher(q["voucher"]["id"])
    q = fees.quote("withdraw", u12, "USDT", "50", network="bsc")
    assert q["fee"] == Decimal("0.3") and not q["voucher"]
    rewards.grant(12, {"kind": "fee_discount", "value": "50", "kinds": ["withdraw"], "uses": 1, "days": 1}, "test", silent=True)
    assert fees.quote("withdraw", u12, "USDT", "50", network="bsc")["fee"] == Decimal("0.15")


def test_hd_derivation_is_stable_and_standard():
    # published test vectors for the "abandon … about" mnemonic (BIP-44 ETH, BIP-84 spec)
    assert keys.derive("evm", 0)[0] == "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"
    assert keys.derive("btc", 0)[0] == "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"
    assert keys.derive("tron", 0)[0].startswith("T")
    assert keys.derive("ton", 0)[0].startswith("UQ")
    a1 = keys.derive("sol", 1000)[0]
    assert a1 == keys.derive("sol", 1000)[0] and a1 != keys.derive("sol", 1001)[0]


def test_catalog_seeded():
    assert len(db.q("SELECT * FROM networks")) == len(catalog.NETWORKS)
    assert len(db.q("SELECT * FROM networks WHERE enabled=1")) == 10
    assert catalog.by_contract("bsc", "0x55d398326f99059ff775485246999027b3197955")["asset"] == "USDT"
    assert catalog.by_contract("tron", None)["asset"] == "TRX"
    assert catalog.family("arbitrum") == "evm"
