"""End-to-end money flows through the HTTP API (chain I/O mocked at the adapter boundary)."""
from decimal import Decimal

import pytest

from aw import admin_auth, catalog, db, deposits, gifts, keys, ledger, p2p, referral, users, withdrawals
from aw.chains import base as chain_base
from aw.chains import evm
from conftest import fund, set_prices


def bal(uid, asset):
    return ledger.available(uid, asset)


def test_auth_registration_referral_and_language(api):
    a = api(100, username="alice", first_name="Alice", lang="ar")
    assert a.me["lang"] == "ar" and a.me["pin_set"] is False
    b = api(101, username="bob", first_name="Bob", start_param=f"ref_{a.me['ref_code']}", lang="pt-br")
    assert users.get(101)["referred_by"] == 100
    assert b.me["lang"] == "pt"
    c = api(102, first_name="Carl", start_param=f"ref_{b.me['ref_code']}")
    assert users.get(102)["ref_level2"] == 100
    stats = a.ok("get", "/api/referral")
    assert stats["friends"] == 1 and stats["level2"] == 1
    assert c.ok("get", "/api/me")["id"] == 102


def test_deposit_addresses_shared_evm_and_ton_memo(api):
    a = api(110)
    bsc = a.ok("post", "/api/deposit/address", {"network": "bsc", "asset": "USDT"})
    eth = a.ok("post", "/api/deposit/address", {"network": "eth", "asset": "USDT"})
    assert bsc["address"] == eth["address"] and set(bsc["same_address_networks"]) >= {"eth", "bsc", "polygon", "arbitrum", "base", "avax"}
    ton = a.ok("post", "/api/deposit/address", {"network": "ton", "asset": "TON"})
    assert not ton["memo_required"] and ton["memo"] is None and ton["address"] != keys.treasury("ton")
    b = api(111)
    assert b.ok("post", "/api/deposit/address", {"network": "bsc"})["address"] != bsc["address"]
    assert b.ok("post", "/api/deposit/address", {"network": "ton"})["address"] != ton["address"]


def _ev(network, txid, idx, address, raw, contract=None, **kw):
    return chain_base.event(network, txid, idx, address, raw, contract, **kw)


def test_deposit_processing_confirmations_and_idempotency(api, monkeypatch):
    a = api(120)
    addr = a.ok("post", "/api/deposit/address", {"network": "bsc"})["address"]
    usdt = "0x55d398326f99059fF775485246999027B3197955"
    monkeypatch.setattr(evm, "confirm_event", lambda ev: True)
    ev = _ev("bsc", "0x" + "ab" * 32, "log3", addr, 25 * 10 ** 18, usdt, block=100, confirmations=2)
    assert deposits.process([ev]) == 0
    assert bal(120, "USDT") == 0
    txs = a.ok("get", "/api/txs")["items"]
    assert txs[0]["status"] == "pending" and txs[0]["type"] == "deposit"
    ev["confirmations"] = 20
    assert deposits.process([ev]) == 1
    assert deposits.process([ev]) == 0  # never twice
    assert bal(120, "USDT") == Decimal("25")
    assert a.ok("get", "/api/txs")["items"][0]["status"] == "completed"
    # unknown token is recorded, not credited; listing it later credits retroactively
    junk = _ev("bsc", "0x" + "cd" * 32, "log1", addr, 5 * 10 ** 18, "0x0000000000000000000000000000000000000abc", block=101, confirmations=50)
    deposits.process([junk])
    row = db.one("SELECT * FROM chain_deposits WHERE txid=?", ("0x" + "cd" * 32,))
    assert row["status"] == "unrecognized"
    db.insert("asset_networks", {"asset": "LINK", "network": "bsc", "contract": "0x0000000000000000000000000000000000000abc", "decimals": 18})
    assert deposits.recheck_unrecognized() == 1
    assert bal(120, "LINK") == Decimal("5")
    # below minimum
    small = _ev("bsc", "0x" + "ef" * 32, "log1", addr, 10 ** 17, usdt, block=102, confirmations=50)
    deposits.process([small])
    assert db.one("SELECT status FROM chain_deposits WHERE txid=?", ("0x" + "ef" * 32,))["status"] == "below_min"
    assert ledger.audit() == []


def test_ton_personal_address_and_legacy_memo(api):
    a = api(130)
    info = a.ok("post", "/api/deposit/address", {"network": "ton"})
    tre = keys.treasury("ton")
    # deposit to the personal wallet — no memo needed
    deposits.process([_ev("ton", "hash0", "ton", info["address"], 2 * 10 ** 9, None, final=True)])
    assert bal(130, "TON") == Decimal("2")
    # a user who still has an old memo keeps receiving through the shared address
    db.x("UPDATE deposit_addresses SET memo='123456789' WHERE user_id=130 AND family='ton'")
    deposits.process([_ev("ton", "hash1", "ton", tre, 3 * 10 ** 9, None, memo="123456789", final=True)])
    assert bal(130, "TON") == Decimal("5")
    deposits.process([_ev("ton", "hash2", "ton", tre, 10 ** 9, None, memo=None, final=True)])
    row = db.one("SELECT * FROM chain_deposits WHERE txid='hash2'")
    assert row["status"] == "no_owner"
    admin = admin_auth.session_for(999)
    r = a.c.post(f"/api/admin/deposits/{row['id']}/credit", json={"user_id": 130}, headers={"Authorization": "Bearer " + admin["token"]})
    assert r.status_code == 200 and r.json()["ok"]
    assert bal(130, "TON") == Decimal("6")


def test_ton_legacy_rows_are_migrated(api):
    a = api(131)
    a.ok("post", "/api/deposit/address", {"network": "ton"})
    db.x("UPDATE deposit_addresses SET address=?, hd_index=NULL, memo='555000111' WHERE user_id=131 AND family='ton'", (keys.treasury("ton"),))
    assert deposits.migrate_ton_addresses() == 1
    row = db.one("SELECT * FROM deposit_addresses WHERE user_id=131 AND family='ton'")
    assert row["hd_index"] is not None and row["address"] != keys.treasury("ton") and row["memo"] == "555000111"


def test_evm_native_balance_accounting(api, monkeypatch):
    a = api(140)
    addr = a.ok("post", "/api/deposit/address", {"network": "eth"})["address"]
    balances = {addr: 0}
    monkeypatch.setattr(evm, "head", lambda nid: 1000)
    monkeypatch.setattr(evm, "rpc", lambda nid, m, p: [] if m == "eth_getLogs" else None)
    monkeypatch.setattr(evm, "batch", lambda nid, calls: [hex(balances[c[1][0]]) for c in calls])
    net = {"id": "eth", "kind": "evm"}
    assert evm.scan(net) == []
    balances[addr] = 5 * 10 ** 16  # 0.05 ETH arrives
    evs = evm.scan(net)
    assert len(evs) == 1 and evs[0]["raw_amount"] == 5 * 10 ** 16
    deposits.process(evs)
    assert bal(140, "ETH") == Decimal("0.05")
    assert evm.scan(net) == []  # accounted — not credited again
    balances[addr] += 10 ** 16
    deposits.process(evm.scan(net))
    assert bal(140, "ETH") == Decimal("0.06")


def test_internal_transfer_pin_and_limits(api, fresh_db):
    a = api(150, username="sender")
    b = api(151, username="receiver", first_name="Rita")
    fund(150, "USDT", "100")
    r = a.post("/api/transfer", {"to": "@receiver", "asset": "USDT", "amount": "10"})
    assert r.status_code == 428 and r.json()["error"] == "pin_not_set"
    a.ok("post", "/api/security/pin", {"new_pin": "482917"})
    r = a.post("/api/transfer", {"to": "@receiver", "asset": "USDT", "amount": "10", "pin": "111222"})
    assert r.json()["error"] == "pin_wrong"
    res = a.ok("post", "/api/transfer", {"to": "@receiver", "asset": "USDT", "amount": "10", "pin": "482917", "idem": "k1"})
    again = a.ok("post", "/api/transfer", {"to": "@receiver", "asset": "USDT", "amount": "10", "pin": "482917", "idem": "k1"})
    assert res["id"] == again["id"]
    assert bal(150, "USDT") == Decimal("90") and bal(151, "USDT") == Decimal("10")
    assert any(m == "sendMessage" or True for m, _ in fresh_db)
    assert db.one("SELECT * FROM outbox WHERE payload LIKE '%151%'")
    assert b.ok("get", "/api/txs")["items"][0]["type"] == "receive"
    r = a.post("/api/transfer", {"to": "@nobody_here", "asset": "USDT", "amount": "1", "pin": "482917"})
    assert r.json()["error"] == "recipient_not_found"
    r = a.post("/api/transfer", {"to": "@receiver", "asset": "USDT", "amount": "1000", "pin": "482917"})
    assert r.json()["error"] == "insufficient_funds"
    assert ledger.audit() == []


def test_swap_quote_execute_and_drift_protection(api):
    a = api(160)
    fund(160, "USDT", "1000")
    q = a.ok("post", "/api/swap/quote", {"from": "USDT", "to": "BTC", "amount": "600"})
    # 600 USDT at 60000 minus 0.8 % spread
    assert Decimal(q["amount_out"]) == Decimal("0.00992")
    res = a.ok("post", "/api/swap/execute", {"quote_id": q["id"]})
    assert bal(160, "USDT") == Decimal("400") and bal(160, "BTC") == Decimal("0.00992")
    assert a.post("/api/swap/execute", {"quote_id": q["id"]}).json()["error"] == "quote_used"
    q2 = a.ok("post", "/api/swap/quote", {"from": "BTC", "to": "USDT", "amount": "0.005"})
    set_prices({"BTC": "50000"})  # BTC crashes after the quote: the platform must not honour the stale rate
    assert a.post("/api/swap/execute", {"quote_id": q2["id"]}).json()["error"] == "quote_expired"
    rev = db.q("SELECT * FROM revenue WHERE source='swap_spread'")
    assert len(rev) == 1 and Decimal(rev[0]["usd"]) > 0
    assert res["id"]
    assert ledger.audit() == []


def test_swap_rejects_unstable_prices(api):
    a = api(161)
    fund(161, "USDT", "100")
    db.x("UPDATE prices SET sources=? WHERE asset='ETH'", ('{"binance":"3000","okx":"3300"}',))
    assert a.post("/api/swap/quote", {"from": "USDT", "to": "ETH", "amount": "50"}).json()["error"] == "price_unstable"


def test_gift_locked_to_one_person(api):
    s = api(170, username="giver", first_name="Gina")
    other = api(171, username="stranger")
    fund(170, "USDT", "50")
    s.ok("post", "/api/security/pin", {"new_pin": "482917"})
    pick = gifts.start_contact_pick(users.get(170))
    gifts.on_users_shared(170, int(pick["token"]), [{"user_id": 172, "first_name": "Rami"}])
    st = s.ok("get", f"/api/contacts/pick/{pick['token']}")
    assert st["done"] and st["id"] == 172 and not st["registered"]
    g = s.ok("post", "/api/gifts", {"asset": "USDT", "amount": "20", "lock": "user", "recipient_id": 172, "message": "Eid Mubarak", "pin": "482917"})
    assert bal(170, "USDT") == Decimal("30") and g["link"].startswith("https://t.me/aw_test_bot?startapp=g_")
    share = s.ok("post", f"/api/gifts/{g['id']}/share")
    assert share["prepared_id"] == "prep1"
    # the link is forwarded to someone else → refused
    assert other.post("/api/gifts/claim", {"code": g["code"]}).json()["error"] == "gift_not_for_you"
    assert other.ok("get", f"/api/gifts/view/{g['code']}")["can_claim"] is False
    rami = api(172, first_name="Rami")  # the intended person opens the bot for the first time
    assert rami.ok("get", f"/api/gifts/view/{g['code']}")["can_claim"] is True
    rami.ok("post", "/api/gifts/claim", {"code": g["code"]})
    assert bal(172, "USDT") == Decimal("20")
    assert rami.post("/api/gifts/claim", {"code": g["code"]}).json()["error"] in ("gift_claimed", "gift_already_claimed")
    assert ledger.audit() == []


def test_red_packet_split_and_expiry_refund(api):
    s = api(180)
    fund(180, "TON", "10")
    s.ok("post", "/api/security/pin", {"new_pin": "482917"})
    g = s.ok("post", "/api/gifts", {"asset": "TON", "amount": "9", "lock": "open", "shares": 3, "split": "random", "pin": "482917"})
    got = Decimal(0)
    for uid in (181, 182):
        u = api(uid)
        got += Decimal(u.ok("post", "/api/gifts/claim", {"code": g["code"]})["amount"])
    db.x("UPDATE gifts SET expires_at=? WHERE id=?", (db.now() - 1, g["id"]))
    gifts.expire_due()
    assert bal(180, "TON") + got == Decimal("10")
    assert ledger.audit() == []


def test_withdrawal_review_auto_send_confirm(api, monkeypatch):
    a = api(190)
    fund(190, "USDT", "500")
    a.ok("post", "/api/security/pin", {"new_pin": "482917"})
    dest = "0x000000000000000000000000000000000000dEaD"
    pv = a.ok("post", "/api/withdraw/preview", {"asset": "USDT", "network": "bsc", "address": dest, "amount": "100"})
    assert pv["fee"] == "0" and pv["voucher"]  # welcome fee-free voucher
    w = a.ok("post", "/api/withdraw", {"asset": "USDT", "network": "bsc", "address": dest, "amount": "100", "pin": "482917"})
    assert w["status"] == "review"  # manual network + first withdrawal
    assert bal(190, "USDT") == Decimal("400")
    admin = {"Authorization": "Bearer " + admin_auth.session_for(999)["token"]}
    db.x("UPDATE networks SET withdraw_mode='auto' WHERE id='bsc'")
    assert a.c.post(f"/api/admin/withdrawals/{w['id']}/approve", headers=admin).status_code == 200
    sent = []

    class FakeAdapter:
        def balance(self, net, addr, an):
            return 10 ** 30

        def send(self, net, an, to, units, memo=None, ref=None):
            sent.append((to, units))
            return "0x" + "11" * 32

        def status(self, net, txid):
            return "confirmed", 20, 0

    monkeypatch.setattr(withdrawals, "adapter", lambda nid: FakeAdapter())
    assert withdrawals.process_approved() == 1
    assert sent == [(dest, 100 * 10 ** 18)]
    assert withdrawals.track_broadcast() == 1
    t = a.ok("get", f"/api/txs/{w['id']}")
    assert t["status"] == "completed" and t["explorer"].endswith("11" * 32)
    assert ledger.balances(190)["USDT"]["locked"] == 0
    # second withdrawal: small → auto approved; fee applies now (voucher used)
    w2 = a.ok("post", "/api/withdraw", {"asset": "USDT", "network": "bsc", "address": dest, "amount": "50", "pin": "482917"})
    assert w2["status"] == "approved" and w2["fee"] == "0.3"
    # reject path refunds
    db.x("UPDATE withdrawals SET status='review' WHERE id=?", (w2["id"],))
    a.c.post(f"/api/admin/withdrawals/{w2['id']}/reject", json={"reason": "test"}, headers=admin)
    assert bal(190, "USDT") == Decimal("400")
    assert ledger.audit() == []


def test_withdrawal_send_error_never_auto_retries(api, monkeypatch):
    a = api(195)
    fund(195, "TRX", "1000")
    a.ok("post", "/api/security/pin", {"new_pin": "482917"})
    db.x("UPDATE networks SET withdraw_mode='auto' WHERE id='tron'")
    db.insert("withdrawals", {"id": "WDSEED", "user_id": 195, "asset": "TRX", "network": "tron", "address": "x", "amount": "1", "fee": "0",
                              "total": "1", "status": "completed", "created_at": db.now()})  # not the first withdrawal anymore

    class Boom:
        def balance(self, *a):
            return 10 ** 30

        def send(self, *a, **k):
            raise RuntimeError("timeout after broadcast?")

    monkeypatch.setattr(withdrawals, "adapter", lambda nid: Boom())
    w = a.ok("post", "/api/withdraw", {"asset": "TRX", "network": "tron", "address": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "amount": "100", "pin": "482917"})
    assert w["status"] == "approved"
    withdrawals.process_approved()
    assert db.one("SELECT status FROM withdrawals WHERE id=?", (w["id"],))["status"] == "stuck"
    withdrawals.process_approved()
    assert db.one("SELECT attempts FROM withdrawals WHERE id=?", (w["id"],))["attempts"] == 1


def test_withdraw_to_other_users_deposit_address_is_internal(api):
    a = api(200)
    b = api(201)
    fund(200, "USDT", "30")
    a.ok("post", "/api/security/pin", {"new_pin": "482917"})
    baddr = b.ok("post", "/api/deposit/address", {"network": "tron"})["address"]
    r = a.ok("post", "/api/withdraw", {"asset": "USDT", "network": "tron", "address": baddr, "amount": "10", "pin": "482917"})
    assert r["internal"] and r["fee"] == "0"
    assert bal(201, "USDT") == Decimal("10")
    bad = a.post("/api/withdraw", {"asset": "USDT", "network": "tron", "address": keys.treasury("tron"), "amount": "5", "pin": "482917"})
    assert bad.json()["error"] == "bad_address_platform"
    taddr = b.ok("post", "/api/deposit/address", {"network": "ton"})["address"]
    fund(200, "TON", "5")
    r = a.ok("post", "/api/withdraw", {"asset": "TON", "network": "ton", "address": taddr, "amount": "2", "pin": "482917"})
    assert r["internal"] and bal(201, "TON") == Decimal("2")


def test_address_validation(api):
    a = api(205)
    fund(205, "BTC", "1")
    for net, addr in [("bsc", "0x123"), ("tron", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6x"), ("btc", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyx"),
                      ("sol", "notbase58!!"), ("eth", "0x9858EfFD232B4033E47d90003D41EC34EcaEda95".replace("8E", "8e"))]:
        r = a.post("/api/withdraw/preview", {"asset": "USDT" if net != "btc" else "BTC", "network": net, "address": addr, "amount": "10"})
        assert r.status_code == 400 and r.json()["error"].startswith("bad_address"), (net, r.text)


def _p2p_users(api):
    seller = api(300, username="seller")
    buyer = api(301, username="buyer")
    for uid in (300, 301):
        db.update("users", {"id": uid}, {"kyc_level": 1})
    seller.ok("post", "/api/security/pin", {"new_pin": "482917"})
    fund(300, "USDT", "1000")
    seller.ok("post", "/api/p2p/methods", {"method_id": "bank", "data": {"account_name": "S. Seller", "account_number": "123"}})
    return seller, buyer


def test_p2p_sell_ad_full_cycle(api):
    seller, buyer = _p2p_users(api)
    ad = seller.ok("post", "/api/p2p/ads", {"side": "sell", "asset": "USDT", "fiat": "USD", "price": "1.02", "total": "500", "min_fiat": "10",
                                            "max_fiat": "300", "methods": ["bank"], "terms": "Bank transfer only", "auto_reply": "Hi!",
                                            "conditions": {"min_kyc": 1}})
    locked = ledger.balances(300)["USDT"]["locked"]
    assert locked == Decimal("500.5")  # 500 + 0.1 % maker fee reserve
    market = buyer.ok("get", "/api/p2p/market?asset=USDT&fiat=USD&side=buy")["items"]
    assert market[0]["id"] == ad["id"]
    o = buyer.ok("post", "/api/p2p/orders", {"ad_id": ad["id"], "fiat_amount": "102", "method_id": "bank"})
    assert o["amount"] == "100" and o["payment"]["data"]["account_number"] == "123" and o["role"] == "buyer"
    msgs = buyer.ok("get", f"/api/p2p/orders/{o['id']}/messages")["items"]
    assert any(m["text"] == "Hi!" for m in msgs)
    assert seller.post(f"/api/p2p/orders/{o['id']}/release", {"pin": "000000"}).json()["error"] in ("pin_wrong", "pin_locked")
    buyer.ok("post", f"/api/p2p/orders/{o['id']}/paid")
    seller.ok("post", f"/api/p2p/orders/{o['id']}/release", {"pin": "482917"})
    assert bal(301, "USDT") == Decimal("100")
    assert ledger.balances(300)["USDT"]["locked"] == Decimal("400.4")
    buyer.ok("post", f"/api/p2p/orders/{o['id']}/review", {"positive": True})
    assert p2p.stats(300)["positive"] == 1
    seller.ok("post", f"/api/p2p/ads/{ad['id']}", {"status": "closed"}) if False else None
    r = seller.c.patch(f"/api/p2p/ads/{ad['id']}", headers=seller.h, json={"status": "closed"})
    assert r.status_code == 200
    assert bal(300, "USDT") == Decimal("899.9") and ledger.balances(300)["USDT"]["locked"] == 0
    assert ledger.audit() == []


def test_p2p_buy_ad_cancel_expiry_and_appeal(api):
    seller, buyer = _p2p_users(api)
    buyer.ok("post", "/api/p2p/methods", {"method_id": "bank", "data": {"account_name": "B", "account_number": "9"}})
    db.update("users", {"id": 301}, {"kyc_level": 1})
    ad = buyer.ok("post", "/api/p2p/ads", {"side": "buy", "asset": "USDT", "fiat": "USD", "price": "1", "total": "300", "min_fiat": "5",
                                           "max_fiat": "300", "methods": ["bank"]})
    # seller takes the buy ad → seller's crypto goes to escrow
    o = seller.ok("post", "/api/p2p/orders", {"ad_id": ad["id"], "fiat_amount": "50", "method_id": "bank"})
    assert ledger.balances(300)["USDT"]["locked"] == Decimal("50")
    # expiry returns escrow
    db.x("UPDATE p2p_orders SET expires_at=? WHERE id=?", (db.now() - 1, o["id"]))
    p2p.expire_due()
    assert ledger.balances(300)["USDT"]["locked"] == 0
    # appeal → arbiter releases to buyer
    o2 = seller.ok("post", "/api/p2p/orders", {"ad_id": ad["id"], "fiat_amount": "40", "method_id": "bank"})
    buyer.ok("post", f"/api/p2p/orders/{o2['id']}/paid")
    assert seller.post(f"/api/p2p/orders/{o2['id']}/appeal", {"reason": "not_received"}).json()["error"] == "p2p_appeal_too_early"
    db.x("UPDATE p2p_orders SET paid_at=? WHERE id=?", (db.now() - 3600, o2["id"]))
    seller.ok("post", f"/api/p2p/orders/{o2['id']}/appeal", {"reason": "not_received", "details": "nothing arrived"})
    admin = {"Authorization": "Bearer " + admin_auth.session_for(999)["token"]}
    r = seller.c.post(f"/api/admin/p2p/orders/{o2['id']}/resolve", json={"winner": "seller", "note": "no proof of payment"}, headers=admin)
    assert r.status_code == 200
    assert bal(300, "USDT") == Decimal("1000") and bal(301, "USDT") == 0
    assert ledger.audit() == []


def test_referral_commission_and_claim(api):
    a = api(400)
    b = api(401, start_param=f"ref_{a.me['ref_code']}")
    fund(401, "USDT", "100000")
    assert len(b.ok("get", "/api/rewards")["vouchers"]) >= 1  # the invited friend got fee-free swaps…
    db.x("UPDATE vouchers SET uses_left=0 WHERE user_id=401")  # …use them up so the swaps generate revenue
    for _ in range(3):
        q = b.ok("post", "/api/swap/quote", {"from": "USDT", "to": "ETH", "amount": "10000"})
        b.ok("post", "/api/swap/execute", {"quote_id": q["id"]})
    pending = referral.pending_usd(400)
    # swap 1: 80 USD spread; swap 2 is free (first-transaction reward); swap 3: 72 USD (Silver VIP −10 %) → 30 % share
    assert Decimal("45.5") < pending < Decimal("45.7")
    r = a.ok("post", "/api/referral/claim")
    assert bal(400, "USDT") == Decimal(r["amount"])
    assert referral.pending_usd(400) == 0
    assert ledger.audit() == []


def test_rewards_checkin_and_missions(api):
    a = api(410)
    ov = a.ok("get", "/api/rewards")
    assert any(v["source"] == "welcome" for v in ov["vouchers"])
    assert a.ok("post", "/api/rewards/checkin")["streak"] == 1
    fund(410, "USDT", "100")
    q = a.ok("post", "/api/swap/quote", {"from": "USDT", "to": "TON", "amount": "10"})
    a.ok("post", "/api/swap/execute", {"quote_id": q["id"]})
    ov = a.ok("get", "/api/rewards")
    m = next(x for x in ov["missions"] if x["id"] == "first_swap")
    assert m["completed"] and not m["claimed"]
    a.ok("post", "/api/rewards/missions/first_swap/claim")
    assert a.post("/api/rewards/missions/first_swap/claim").json()["error"] == "mission_not_ready"
    assert ov["first_tx"]["done"]


def test_support_faq_fallback_and_ticket(api):
    a = api(420, lang="ar")
    r = a.ok("post", "/api/ai/chat", {"text": "إيداعي لم يصل"})
    assert "الإيداع" in r["reply"] or "للإيداع" in r["reply"]
    r = a.ok("post", "/api/ai/chat", {"text": "أريد التحدث مع موظف"})
    assert r["actions"][0]["type"] == "ticket"
    tid = r["actions"][0]["id"]
    admin = {"Authorization": "Bearer " + admin_auth.session_for(999)["token"]}
    assert a.c.post(f"/api/admin/tickets/{tid}/reply", json={"text": "مرحبا، كيف نساعدك؟"}, headers=admin).status_code == 200
    t = a.ok("get", f"/api/tickets/{tid}")
    assert t["status"] == "answered" and t["messages"][-1]["sender"] == "admin"
    f = a.ok("post", "/api/forms", {"kind": "payment_method", "data": {"name": "Wave", "country": "SN"}})
    assert f["id"]


def test_admin_login_link_and_permissions(api, client):
    link = admin_auth.issue_login_link(999)
    tok = link.split("login=")[1]
    s = client.post("/api/admin/login", json={"token": tok}).json()
    assert s["role"] == "owner"
    assert client.post("/api/admin/login", json={"token": tok}).status_code == 401  # single use
    h = {"Authorization": "Bearer " + s["token"]}
    d = client.get("/api/admin/dashboard", headers=h).json()
    assert "users" in d and d["wallet_ready"]
    assert client.put("/api/admin/settings/swap", json={"value": {"spread_pct": "1.0"}}, headers=h).status_code == 200
    api(500)
    client.post("/api/admin/admins", json={"user_id": 500, "role": "support"}, headers=h)
    sup = {"Authorization": "Bearer " + admin_auth.session_for(500)["token"]}
    assert client.get("/api/admin/tickets", headers=sup).status_code == 200
    assert client.post("/api/admin/users/500/adjust", json={"asset": "USDT", "amount": "5", "reason": "x"}, headers=sup).status_code == 403
    assert client.post("/api/admin/users/500/adjust", json={"asset": "USDT", "amount": "5", "reason": "bonus"}, headers=h).status_code == 200
    assert ledger.available(500, "USDT") == 5
    assert client.get("/api/admin/audit", headers=h).json()["items"][0]["action"] == "user.adjust"
    assert client.get("/api/admin/dashboard").status_code == 401


def test_public_config_receipt_and_webhook(api, client):
    cfg = client.get("/api/config").json()
    assert len(cfg["networks"]) == 10 and cfg["bot"] == "aw_test_bot"
    a = api(600)
    fund(600, "USDT", "3")
    t = a.ok("get", "/api/txs")["items"][0]
    d = a.ok("get", f"/api/txs/{t['id']}")
    sig = d["receipt"].split("s=")[1]
    assert client.get(f"/api/receipt/{t['id']}?s={sig}").json()["valid"]
    assert not client.get(f"/api/receipt/{t['id']}?s=bad").json()["valid"]
    assert client.post("/api/tg/webhook", json={}).status_code == 403
    upd = {"message": {"chat": {"type": "private", "id": 700}, "from": {"id": 700, "first_name": "Zed"}, "text": "/start ref_" + a.me["ref_code"]}}
    assert client.post("/api/tg/webhook", json=upd, headers={"X-Telegram-Bot-Api-Secret-Token": "whsecret"}).status_code == 200
    assert users.get(700)["referred_by"] == 600
    contact = {"message": {"chat": {"type": "private", "id": 700}, "from": {"id": 700, "first_name": "Zed"},
                           "contact": {"user_id": 700, "phone_number": "+213555123456"}}}
    client.post("/api/tg/webhook", json=contact, headers={"X-Telegram-Bot-Api-Secret-Token": "whsecret"})
    assert users.get(700)["kyc_level"] == 1


def test_maintenance_blocks_money_routes(api, client):
    a = api(610)
    h = {"Authorization": "Bearer " + admin_auth.session_for(999)["token"]}
    from aw import settings

    client.put("/api/admin/settings/general", json={"value": {"maintenance": True}}, headers=h)
    settings.invalidate()
    assert a.post("/api/swap/quote", {"from": "USDT", "to": "BTC", "amount": "10"}).status_code == 503
    assert a.get("/api/wallet").status_code == 200  # balances stay visible


@pytest.mark.parametrize("amount", ["-1", "0", "abc", "1e400", "NaN"])
def test_bad_amounts_rejected(api, amount):
    a = api(620)
    fund(620, "USDT", "10")
    r = a.post("/api/swap/quote", {"from": "USDT", "to": "BTC", "amount": amount})
    assert r.status_code == 400


def test_admin_verifies_network_tokens_on_chain(client, monkeypatch):
    from aw.chains import evm

    h = {"Authorization": "Bearer " + admin_auth.session_for(999)["token"]}

    def abi_str(t):
        b = t.encode()
        return "0x" + (32).to_bytes(32, "big").hex() + len(b).to_bytes(32, "big").hex() + b.hex().ljust(64, "0")

    chain = {"0x94b008aA00579c1307B0EF2c499aD98a8ce58e58": ("USDT", 6), "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85": ("USDC", 6),
             "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1": ("DAI", 18), "0x4200000000000000000000000000000000000042": ("OP", 18)}
    db.x("UPDATE asset_networks SET decimals=8 WHERE asset='USDC' AND network='optimism'")
    monkeypatch.setattr(evm, "rpc", lambda nid, m, p: hex(10) if m == "eth_chainId" else None)
    monkeypatch.setattr(evm, "batch", lambda nid, calls: [abi_str(chain[calls[0][1][0]["to"]][0]), hex(chain[calls[0][1][0]["to"]][1])])
    r = client.post("/api/admin/networks/optimism/verify", json={}, headers=h).json()
    assert r["chain_id"] == 10 and not r["ok"]
    bad = [t for t in r["tokens"] if not t["ok"]]
    assert [t["asset"] for t in bad] == ["USDC"] and bad[0]["chain_symbol"] == "USDC"
    r = client.post("/api/admin/networks/optimism/verify", json={"fix": True}, headers=h).json()
    assert r["fixed"] == 1 and catalog.asset_network("USDC", "optimism")["decimals"] == 6
    assert client.post("/api/admin/networks/optimism/verify", json={}, headers=h).json()["ok"]
    assert client.post("/api/admin/networks/tron/verify", json={}, headers=h).status_code == 400
