"""Earn, auto-invest, payment requests and split bills."""
from decimal import Decimal

from aw import autoinvest, db, earn, ledger
from conftest import fund


def bal(uid, asset):
    return ledger.available(uid, asset)


def test_earn_subscribe_accrue_redeem(api):
    a = api(900)
    fund(900, "USDT", "1000")
    a.ok("post", "/api/security/pin", {"new_pin": "482917"})
    ov = a.ok("get", "/api/earn")
    assert any(p["id"] == "usdt-flex" for p in ov["products"])
    assert a.post("/api/earn/subscribe", {"product": "usdt-flex", "amount": "5", "pin": "482917"}).json()["error"] == "amount_too_small"
    pos = a.ok("post", "/api/earn/subscribe", {"product": "usdt-flex", "amount": "365", "pin": "482917", "idem": "e1"})
    again = a.ok("post", "/api/earn/subscribe", {"product": "usdt-flex", "amount": "365", "pin": "482917", "idem": "e1"})
    assert again["id"] == pos["id"] and bal(900, "USDT") == Decimal("635")
    w = a.ok("get", "/api/wallet")
    assert next(x for x in w["assets"] if x["id"] == "USDT")["earning"] == "365"
    # two days pass: 365 × 6 % / 365 × 2 = 0.12 USDT
    db.x("UPDATE earn_positions SET accrued_at=accrued_at-?, created_at=created_at-?", (2 * 86400 + 5, 2 * 86400 + 5))
    earn.accrue_all()
    earn.accrue_all()  # never paid twice for the same day
    assert bal(900, "USDT") == Decimal("635.12")
    assert a.ok("get", "/api/config")["earn_rates"]["USDT"] == "9"
    a.ok("post", f"/api/earn/{pos['id']}/redeem", {})
    assert bal(900, "USDT") == Decimal("1000.12")
    assert ledger.audit() == []


def test_earn_fixed_term_matures(api):
    a = api(901)
    fund(901, "USDT", "100")
    a.ok("post", "/api/security/pin", {"new_pin": "482917"})
    pos = a.ok("post", "/api/earn/subscribe", {"product": "usdt-30", "amount": "100", "pin": "482917"})
    assert a.post(f"/api/earn/{pos['id']}/redeem", {}).json()["error"] == "earn_locked_term"
    db.x("UPDATE earn_positions SET created_at=created_at-?, accrued_at=accrued_at-?, ends_at=?", (31 * 86400, 31 * 86400, db.now() - 1))
    earn.accrue_all()
    assert bal(901, "USDT") > Decimal("100.7")
    assert db.val("SELECT status FROM earn_positions WHERE id=?", (pos["id"],)) == "matured"
    assert ledger.audit() == []


def test_autoinvest_runs_and_pauses(api):
    a = api(910)
    fund(910, "USDT", "60")
    a.ok("post", "/api/security/pin", {"new_pin": "482917"})
    plan = a.ok("post", "/api/autoinvest", {"from": "USDT", "to": "BTC", "amount": "25", "freq": "weekly", "pin": "482917"})
    assert plan["next_at"] > db.now()
    db.x("UPDATE autoinvest SET next_at=?", (db.now() - 1,))
    assert autoinvest.run_due() == 1
    assert bal(910, "USDT") == Decimal("35") and bal(910, "BTC") > 0
    assert autoinvest.run_due() == 0  # next run is a week away
    for i in range(3):
        db.x("UPDATE autoinvest SET next_at=?, amount='500'", (db.now() - 100 - i,))
        autoinvest.run_due()
    items = a.ok("get", "/api/autoinvest")["items"]
    assert items[0]["active"] is False and items[0]["last_error"] == "insufficient_funds"
    assert autoinvest.next_run("monthly", 1706745600 + 3600 * 12, day=31) > 1706745600  # Feb has no 31st


def test_payment_request_paid_once(api):
    me = api(920, username="shop")
    payer = api(921, username="payer")
    fund(921, "USDT", "100")
    payer.ok("post", "/api/security/pin", {"new_pin": "482917"})
    req = me.ok("post", "/api/requests", {"asset": "USDT", "amount": "12.5", "note": "Coffee"})
    view = payer.ok("get", f"/api/requests/{req['code']}")
    assert view["to"]["username"] == "shop" and view["status"] == "open" and view["mine"] is False
    assert me.post(f"/api/requests/{req['code']}/pay", {}).json()["error"] == "self_transfer"
    payer.ok("post", f"/api/requests/{req['code']}/pay", {"pin": "482917"})
    assert bal(920, "USDT") == Decimal("12.5")
    assert payer.post(f"/api/requests/{req['code']}/pay", {"pin": "482917"}).json()["error"] == "request_closed"
    assert bal(921, "USDT") == Decimal("87.5")


def test_split_bill(api):
    host = api(930, username="host")
    f1 = api(931, username="friend1")
    f2 = api(932, username="friend2")
    for u in (931, 932):
        fund(u, "USDT", "50")
    f1.ok("post", "/api/security/pin", {"new_pin": "482917"})
    sp = host.ok("post", "/api/splits", {"asset": "USDT", "total": "90", "title": "Dinner", "people": [{"user_id": 931}, {"user_id": 932}]})
    assert len(sp["requests"]) == 2 and all(r["amount"] == "30" for r in sp["requests"])
    code = next(r["code"] for r in sp["requests"] if r["payer"] and r["payer"]["id"] == 932)
    assert f1.post(f"/api/requests/{code}/pay", {"pin": "482917"}).json()["error"] == "request_not_for_you"
    mine = next(r["code"] for r in sp["requests"] if r["payer"]["id"] == 931)
    f1.ok("post", f"/api/requests/{mine}/pay", {"pin": "482917"})
    sp = host.ok("get", f"/api/splits/{sp['id']}")
    assert sp["collected"] == "30" and sp["outstanding"] == "30" and sp["status"] == "open"
    assert f2.post(f"/api/splits/{sp['id']}", {}).status_code in (404, 405)


def test_price_alert_fires_once_while_price_hovers(api):
    from aw import prices

    a = api(940)
    a.ok("post", "/api/alerts", {"asset": "BTC", "op": "above", "price": "61000", "repeat": True})
    n = lambda: db.val("SELECT COUNT(*) FROM notifications WHERE user_id=940 AND kind='price_alert'", (), 0)  # noqa: E731
    for usd in ("61010", "60990", "61020", "60995", "61030"):  # ping-pong around the level
        db.x("UPDATE prices SET usd=? WHERE asset='BTC'", (usd,))
        prices.check_alerts()
    assert n() == 1
    # a real move back (>1 %) after the cooldown re-arms a repeating alert
    db.x("UPDATE price_alerts SET fired_at=fired_at-? WHERE user_id=940", (7 * 3600,))
    db.x("UPDATE prices SET usd='60000' WHERE asset='BTC'")
    prices.check_alerts()
    db.x("UPDATE prices SET usd='61500' WHERE asset='BTC'")
    prices.check_alerts()
    assert n() == 2
