"""Admin panel API — every control in one place. All writes are audited."""
import os
from decimal import Decimal

from fastapi import APIRouter, Body, Header, Request

from . import (admin_auth, catalog, config, db, deposits, files, fees, guard, keys, ledger, p2p, prices, referral, settings, support,
               tg, treasury, users, withdrawals)
from .money import AppError, D, s
from .notify import notify

router = APIRouter(prefix="/api/admin")


def _admin(authorization: str, perm: str) -> dict:
    tok = (authorization or "").replace("Bearer ", "").strip()
    return admin_auth.check(tok, perm)


def _ip(req: Request) -> str:
    return req.headers.get("x-real-ip") or (req.client.host if req.client else "")


# ───────────── auth ─────────────
@router.post("/login")
def login(body: dict = Body(...)):
    if body.get("token"):
        return admin_auth.exchange_login(body["token"])
    if body.get("init_data"):
        return admin_auth.login_with_init_data(body["init_data"])
    raise AppError("auth_required", 401)


@router.get("/me")
def me(authorization: str = Header(default="")):
    a = _admin(authorization, "view")
    u = users.get(a["id"])
    return {"id": a["id"], "role": a["role"], "name": users.display_name(u) if u else str(a["id"]),
            "perms": sorted(admin_auth.ROLES.get(a["role"], [])), "bot": config.BOT_USERNAME, "webapp": config.WEBAPP_URL}


# ───────────── dashboard ─────────────
def _sum_usd(sql: str, args=()) -> Decimal:
    return sum((D(r[0] if not isinstance(r, dict) else list(r.values())[0]) for r in db.q(sql, args)), Decimal(0))


@router.get("/dashboard")
def dashboard(authorization: str = Header(default="")):
    _admin(authorization, "view")
    now = db.now()
    d1, d7, d30 = now - 86400, now - 7 * 86400, now - 30 * 86400
    rev = {}
    for r in db.q("SELECT source, usd FROM revenue WHERE created_at>=?", (d30,)):
        rev[r["source"]] = rev.get(r["source"], Decimal(0)) + D(r["usd"])
    series = []
    for i in range(29, -1, -1):
        start = now - now % 86400 - i * 86400
        end = start + 86400
        series.append({
            "day": start,
            "revenue": float(_sum_usd("SELECT usd FROM revenue WHERE created_at>=? AND created_at<?", (start, end))),
            "users": db.val("SELECT COUNT(*) FROM users WHERE created_at>=? AND created_at<?", (start, end), 0),
            "volume": float(_sum_usd("SELECT volume_usd FROM swaps WHERE created_at>=? AND created_at<?", (start, end))),
            "deposits": float(_sum_usd("SELECT usd_value FROM txs WHERE type='deposit' AND status='completed' AND created_at>=? AND created_at<?", (start, end))),
        })
    sol = treasury.solvency()
    return {
        "users": {"total": db.val("SELECT COUNT(*) FROM users", (), 0), "new_24h": db.val("SELECT COUNT(*) FROM users WHERE created_at>=?", (d1,), 0),
                  "new_7d": db.val("SELECT COUNT(*) FROM users WHERE created_at>=?", (d7,), 0),
                  "active_24h": db.val("SELECT COUNT(*) FROM users WHERE last_seen>=?", (d1,), 0),
                  "verified": db.val("SELECT COUNT(*) FROM users WHERE kyc_level>=1", (), 0)},
        "volume_24h": {
            "deposits": s(_sum_usd("SELECT usd_value FROM txs WHERE type='deposit' AND status='completed' AND created_at>=?", (d1,)).quantize(Decimal("0.01"))),
            "withdrawals": s(_sum_usd("SELECT usd_value FROM txs WHERE type='withdraw' AND status='completed' AND created_at>=?", (d1,)).quantize(Decimal("0.01"))),
            "swaps": s(_sum_usd("SELECT volume_usd FROM swaps WHERE created_at>=?", (d1,)).quantize(Decimal("0.01"))),
            "transfers": s(_sum_usd("SELECT usd_value FROM txs WHERE type='send' AND created_at>=?", (d1,)).quantize(Decimal("0.01"))),
        },
        "revenue": {"today": s(_sum_usd("SELECT usd FROM revenue WHERE created_at>=?", (now - now % 86400,)).quantize(Decimal("0.01"))),
                    "d7": s(_sum_usd("SELECT usd FROM revenue WHERE created_at>=?", (d7,)).quantize(Decimal("0.01"))),
                    "d30": s(_sum_usd("SELECT usd FROM revenue WHERE created_at>=?", (d30,)).quantize(Decimal("0.01"))),
                    "by_source": {k: s(v.quantize(Decimal("0.01"))) for k, v in rev.items()}},
        "queues": {"withdraw_review": db.val("SELECT COUNT(*) FROM withdrawals WHERE status IN ('review','stuck')", (), 0),
                   "withdraw_manual": db.val("SELECT COUNT(*) FROM withdrawals w JOIN networks n ON n.id=w.network WHERE w.status='approved' AND n.withdraw_mode<>'auto'", (), 0),
                   "tickets": db.val("SELECT COUNT(*) FROM tickets WHERE status='waiting_admin'", (), 0),
                   "appeals": db.val("SELECT COUNT(*) FROM p2p_disputes WHERE status<>'resolved'", (), 0),
                   "deposits_attention": db.val("SELECT COUNT(*) FROM chain_deposits WHERE status IN ('no_owner','disabled','below_min')", (), 0),
                   "kyc": db.val("SELECT COUNT(*) FROM kyc_requests WHERE status='pending'", (), 0),
                   "forms": db.val("SELECT COUNT(*) FROM forms WHERE status='new'", (), 0),
                   "alerts": db.val("SELECT COUNT(*) FROM alerts WHERE seen=0", (), 0)},
        "solvency": {"liabilities_usd": sol["liabilities_usd"], "reserves_usd": sol["reserves_usd"], "updated_at": sol["updated_at"]},
        "series": series,
        "worker": {"heartbeat": int(db.val("SELECT value FROM scan_state WHERE key='worker:heartbeat'", (), 0) or 0)},
        "wallet_ready": keys.has_master(),
    }


# ───────────── users ─────────────
@router.get("/users")
def list_users(q: str = "", status: str = "", role: str = "", limit: int = 50, offset: int = 0, authorization: str = Header(default="")):
    _admin(authorization, "users_view")
    sql, args = "SELECT id, username, first_name, last_name, photo_url, lang, status, role, kyc_level, created_at, last_seen, risk_score FROM users WHERE 1=1", []
    if q:
        if q.lstrip("@").isdigit():
            sql += " AND id=?"
            args.append(int(q.lstrip("@")))
        else:
            sql += " AND (username LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR ref_code=?)"
            args += [f"%{q.lstrip('@')}%"] * 3 + [q.upper()]
    if status:
        sql += " AND status=?"
        args.append(status)
    if role:
        sql += " AND role=?"
        args.append(role)
    total = db.val(sql.replace("SELECT id, username, first_name, last_name, photo_url, lang, status, role, kyc_level, created_at, last_seen, risk_score", "SELECT COUNT(*)"), tuple(args), 0)
    rows = db.q(sql + " ORDER BY created_at DESC LIMIT ? OFFSET ?", (*args, max(1, min(limit, 200)), max(0, offset)))
    for r in rows:
        bals = ledger.balances(r["id"])
        r["balance_usd"] = s(sum(((v["available"] + v["locked"]) * prices.usd(a) for a, v in bals.items()), Decimal(0)).quantize(Decimal("0.01")))
    return {"total": total, "items": rows}


@router.get("/users/{uid}")
def user_detail(uid: int, authorization: str = Header(default="")):
    _admin(authorization, "users_view")
    u = users.must(uid)
    u.pop("pin_hash", None)
    u.pop("bio_token_hash", None)
    bals = {a: {"available": s(v["available"]), "locked": s(v["locked"]), "usd": s(((v["available"] + v["locked"]) * prices.usd(a)).quantize(Decimal("0.01")))}
            for a, v in ledger.balances(uid).items()}
    return {
        "user": u, "balances": bals, "vip": {k: (s(v) if isinstance(v, Decimal) else v) for k, v in fees.vip(u).items() if k != "next"},
        "limits": guard.usage(u),
        "txs": db.q("SELECT * FROM txs WHERE user_id=? ORDER BY created_at DESC LIMIT 100", (uid,)),
        "withdrawals": db.q("SELECT * FROM withdrawals WHERE user_id=? ORDER BY created_at DESC LIMIT 50", (uid,)),
        "addresses": db.q("SELECT family, address, memo, hd_index, created_at FROM deposit_addresses WHERE user_id=?", (uid,)),
        "referrals": {"count": db.val("SELECT COUNT(*) FROM users WHERE referred_by=?", (uid,), 0),
                      "referrer": u.get("referred_by"), "pending_usd": s(referral.pending_usd(uid))},
        "logins": db.q("SELECT * FROM login_events WHERE user_id=? ORDER BY id DESC LIMIT 20", (uid,)),
        "vouchers": db.q("SELECT * FROM vouchers WHERE user_id=? ORDER BY id DESC LIMIT 30", (uid,)),
        "tickets": db.q("SELECT * FROM tickets WHERE user_id=? ORDER BY id DESC LIMIT 20", (uid,)),
        "p2p": p2p.stats(uid), "ledger": db.q("SELECT * FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 100", (uid,)),
    }


@router.post("/users/{uid}/{action}")
def user_action(uid: int, action: str, request: Request, body: dict = Body(default={}), authorization: str = Header(default="")):
    perm = "finance" if action == "adjust" else "users"
    a = _admin(authorization, perm)
    users.must(uid)
    if action == "status":
        st = body.get("status")
        if st not in ("active", "frozen", "banned"):
            raise AppError("bad_request")
        db.update("users", {"id": uid}, {"status": st, "status_reason": (body.get("reason") or "")[:200]})
    elif action == "role":
        if body.get("role") not in ("user", "merchant", "vip", "partner"):
            raise AppError("bad_request")
        db.update("users", {"id": uid}, {"role": body["role"]})
    elif action == "kyc":
        db.update("users", {"id": uid}, {"kyc_level": max(0, min(2, int(body.get("level", 0))))})
    elif action == "risk":
        db.update("users", {"id": uid}, {"risk_score": max(0, min(100, int(body.get("score", 0))))})
    elif action == "vip":
        users.set_flag(uid, "vip_level", None if body.get("level") in (None, "") else int(body["level"]))
    elif action == "limits":
        users.set_flag(uid, "limits", {k: str(v) for k, v in (body.get("limits") or {}).items() if k in ("withdraw_daily", "withdraw_single", "transfer_daily", "p2p_daily")})
    elif action == "adjust":
        asset = (body.get("asset") or "").upper()
        amt = D(body.get("amount"))
        reason = (body.get("reason") or "").strip()
        if not catalog.asset(asset) or amt == 0 or not reason:
            raise AppError("bad_request")
        with db.tx():
            ref = ledger.add_tx(uid, "adjust", asset, abs(amt), meta={"reason": reason, "admin": a["id"], "sign": "+" if amt > 0 else "-"},
                                usd_value=prices.to_usd(asset, abs(amt)))
            (ledger.credit if amt > 0 else ledger.debit)(uid, asset, abs(amt), "admin_adjust", ref, reason[:200])
    elif action == "voucher":
        from . import rewards

        rewards.grant(uid, body.get("spec") or {}, f"admin:{a['id']}")
    elif action == "reset_pin":
        hold = db.now() + int(settings.get("security").get("hold_after_pin_reset_hours", 24)) * 3600
        db.update("users", {"id": uid}, {"pin_hash": None, "bio_token_hash": None, "pin_fails": 0, "pin_locked_until": 0,
                                         "security_hold_until": hold})
    elif action == "unhold":
        db.update("users", {"id": uid}, {"security_hold_until": 0, "pin_locked_until": 0})
    elif action == "message":
        text = (body.get("text") or "").strip()
        if not text:
            raise AppError("bad_request")
        tg.send(uid, text[:3500], [[tg.webapp_button("AW Wallet")]] if config.WEBAPP_URL else None, priority=2)
    else:
        raise AppError("not_found", 404)
    admin_auth.audit(a, f"user.{action}", str(uid), body, _ip(request))
    return {"ok": True, "user": {k: v for k, v in users.must(uid).items() if k not in ("pin_hash", "bio_token_hash")}}


# ───────────── withdrawals & deposits ─────────────
@router.get("/withdrawals")
def list_withdrawals(status: str = "", limit: int = 100, authorization: str = Header(default="")):
    _admin(authorization, "withdrawals")
    sql = "SELECT w.*, u.username, u.first_name, t.usd_value FROM withdrawals w LEFT JOIN users u ON u.id=w.user_id LEFT JOIN txs t ON t.id=w.id"
    args = []
    if status:
        sql += " WHERE w.status IN (" + ",".join("?" for _ in status.split(",")) + ")"
        args = status.split(",")
    rows = db.q(sql + " ORDER BY w.created_at DESC LIMIT ?", (*args, min(limit, 500)))
    for r in rows:
        r["risk"] = db.jl(r["risk"], [])
        net = catalog.network(r["network"])
        r["withdraw_mode"] = net["withdraw_mode"] if net else None
        r["explorer"] = net["explorer_tx"].replace("{tx}", r["txid"]) if net and r["txid"] and not r["txid"].startswith("seqno:") else None
    return {"items": rows}


@router.post("/withdrawals/{wid}/{action}")
def withdrawal_action(wid: str, action: str, request: Request, body: dict = Body(default={}), authorization: str = Header(default="")):
    a = _admin(authorization, "withdrawals")
    if action == "approve":
        res = withdrawals.approve(wid, a["id"])
    elif action == "reject":
        res = withdrawals.reject(wid, a["id"], body.get("reason", ""))
    elif action == "mark_paid":
        if not (body.get("txid") or "").strip():
            raise AppError("bad_request")
        res = withdrawals.mark_paid(wid, a["id"], body["txid"])
    elif action == "retry":  # admin confirmed on the explorer that nothing was sent
        n = db.x("UPDATE withdrawals SET status='approved', error=NULL, txid=NULL, updated_at=? WHERE id=? AND status='stuck'", (db.now(), wid)).rowcount
        if n != 1:
            raise AppError("bad_state")
        res = {"ok": True}
    else:
        raise AppError("not_found", 404)
    admin_auth.audit(a, f"withdraw.{action}", wid, body, _ip(request))
    return res


@router.get("/deposits")
def list_deposits(status: str = "", limit: int = 200, authorization: str = Header(default="")):
    _admin(authorization, "finance")
    return {"items": deposits.history_for_admin(status or None, min(limit, 1000))}


@router.post("/deposits/{did}/{action}")
def deposit_action(did: int, action: str, request: Request, body: dict = Body(default={}), authorization: str = Header(default="")):
    a = _admin(authorization, "finance")
    if action == "credit":
        row = db.one("SELECT * FROM chain_deposits WHERE id=?", (did,))
        if not row:
            raise AppError("not_found", 404)
        if body.get("asset"):
            db.update("chain_deposits", {"id": did}, {"asset": body["asset"].upper()})
        ok = deposits.credit(did, int(body["user_id"]) if body.get("user_id") else None, a["id"])
        res = {"ok": ok}
    elif action == "ignore":
        db.x("UPDATE chain_deposits SET status='ignored', note=? WHERE id=? AND status<>'credited'", ((body.get("note") or "")[:200], did))
        res = {"ok": True}
    else:
        raise AppError("not_found", 404)
    admin_auth.audit(a, f"deposit.{action}", str(did), body, _ip(request))
    return res


@router.post("/deposits-recheck")
def deposits_recheck(authorization: str = Header(default="")):
    _admin(authorization, "finance")
    return {"credited": deposits.recheck_unrecognized()}


# ───────────── catalog ─────────────
@router.get("/catalog")
def get_catalog(authorization: str = Header(default="")):
    _admin(authorization, "view")
    return {"assets": db.q("SELECT * FROM assets ORDER BY sort"), "networks": db.q("SELECT * FROM networks ORDER BY sort"),
            "asset_networks": db.q("SELECT * FROM asset_networks ORDER BY network, sort"),
            "prices": {r["asset"]: r for r in db.q("SELECT * FROM prices")}}


ASSET_FIELDS = {"name", "icon", "color", "precision", "display", "is_stable", "price_symbol", "coingecko_id", "enabled", "swap_enabled",
                "p2p_enabled", "transfer_enabled", "sort", "badges", "meta"}
NET_FIELDS = {"name", "short", "icon", "color", "enabled", "deposit_enabled", "withdraw_enabled", "withdraw_mode", "confirmations", "eta",
              "sort", "badges", "config", "explorer_tx", "explorer_addr"}
AN_FIELDS = {"contract", "decimals", "enabled", "deposit_enabled", "withdraw_enabled", "min_deposit", "min_withdraw", "max_withdraw",
             "withdraw_fee", "withdraw_fee_pct", "fee_mode", "sort", "meta"}


def _pick(body: dict, allowed: set) -> dict:
    out = {k: v for k, v in body.items() if k in allowed}
    if not out:
        raise AppError("bad_request")
    return out


@router.post("/assets")
def add_asset(request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    a = _admin(authorization, "catalog")
    aid = (body.get("id") or "").upper().strip()
    if not aid.isalnum() or len(aid) > 12 or catalog.asset(aid):
        raise AppError("bad_request")
    db.insert("assets", {"id": aid, "name": body.get("name") or aid, "precision": int(body.get("precision", 8)), "display": int(body.get("display", 4)),
                         "price_symbol": body.get("price_symbol") or aid, "coingecko_id": body.get("coingecko_id"), "color": body.get("color"),
                         "is_stable": bool(body.get("is_stable")), "sort": int(body.get("sort", 100))})
    admin_auth.audit(a, "asset.add", aid, body, _ip(request))
    return {"ok": True}


@router.patch("/assets/{aid}")
def edit_asset(aid: str, request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    a = _admin(authorization, "catalog")
    db.update("assets", {"id": aid.upper()}, _pick(body, ASSET_FIELDS))
    admin_auth.audit(a, "asset.edit", aid, body, _ip(request))
    return {"ok": True}


@router.patch("/networks/{nid}")
def edit_network(nid: str, request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    a = _admin(authorization, "catalog")
    data = _pick(body, NET_FIELDS)
    if "withdraw_mode" in data and data["withdraw_mode"] not in ("auto", "manual"):
        raise AppError("bad_request")
    if data.get("withdraw_mode") == "auto" and not keys.has_master():
        raise AppError("wallet_not_configured")
    db.update("networks", {"id": nid}, data)
    admin_auth.audit(a, "network.edit", nid, body, _ip(request))
    if data.get("enabled") or data.get("deposit_enabled"):
        deposits.recheck_unrecognized()
    return {"ok": True}


@router.post("/asset-networks")
def add_asset_network(request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    """List a token on a network (e.g. a new jetton / ERC-20). Waiting deposits of it are credited right away."""
    a = _admin(authorization, "catalog")
    asset, nid = (body.get("asset") or "").upper(), body.get("network")
    net = catalog.network(nid)
    if not catalog.asset(asset) or not net:
        raise AppError("bad_request")
    contract = (body.get("contract") or "").strip() or None
    if contract:
        from . import addresses

        contract = addresses.normalize(net["kind"], contract)
    db.insert("asset_networks", {"asset": asset, "network": nid, "contract": contract, "decimals": int(body.get("decimals", 18)),
                                 "min_deposit": str(body.get("min_deposit", "0")), "min_withdraw": str(body.get("min_withdraw", "0")),
                                 "withdraw_fee": str(body.get("withdraw_fee", "0")), "sort": 500})
    admin_auth.audit(a, "asset_network.add", f"{asset}:{nid}", body, _ip(request))
    return {"ok": True, "credited": deposits.recheck_unrecognized()}


@router.patch("/asset-networks/{asset}/{nid}")
def edit_asset_network(asset: str, nid: str, request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    a = _admin(authorization, "fees" if set(body) <= {"withdraw_fee", "withdraw_fee_pct", "fee_mode", "min_withdraw", "min_deposit", "max_withdraw"} else "catalog")
    db.update("asset_networks", {"asset": asset.upper(), "network": nid}, _pick(body, AN_FIELDS))
    admin_auth.audit(a, "asset_network.edit", f"{asset}:{nid}", body, _ip(request))
    return {"ok": True}


@router.delete("/asset-networks/{asset}/{nid}")
def del_asset_network(asset: str, nid: str, request: Request, authorization: str = Header(default="")):
    a = _admin(authorization, "catalog")
    db.x("DELETE FROM asset_networks WHERE asset=? AND network=?", (asset.upper(), nid))
    admin_auth.audit(a, "asset_network.delete", f"{asset}:{nid}", None, _ip(request))
    return {"ok": True}


# ───────────── fees ─────────────
@router.get("/fees")
def get_fees(authorization: str = Header(default="")):
    _admin(authorization, "view")
    return {"rules": db.q("SELECT * FROM fee_rules ORDER BY kind, scope"), "vip": db.q("SELECT * FROM vip_tiers ORDER BY level"),
            "promos": db.q("SELECT * FROM promos ORDER BY id DESC"),
            "withdraw": db.q("SELECT asset, network, withdraw_fee, withdraw_fee_pct, fee_mode, min_withdraw, min_deposit, max_withdraw FROM asset_networks ORDER BY network, sort"),
            "gas": {r["key"][7:]: r["value"] for r in db.q("SELECT key, value FROM scan_state WHERE key LIKE 'gasusd:%'")}}


RULE_FIELDS = {"kind", "scope", "scope_id", "pct", "fixed", "min_fee", "max_fee", "active", "starts_at", "ends_at", "note"}


@router.post("/fees/rules")
def add_rule(request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    a = _admin(authorization, "fees")
    data = _pick(body, RULE_FIELDS)
    if data.get("kind") not in ("swap", "withdraw", "transfer", "gift", "p2p_maker", "p2p_taker") or data.get("scope") not in fees.PRECEDENCE:
        raise AppError("bad_request")
    data["created_at"] = db.now()
    rid = db.insert("fee_rules", data)
    admin_auth.audit(a, "fee_rule.add", str(rid), body, _ip(request))
    return {"id": rid}


@router.patch("/fees/rules/{rid}")
def edit_rule(rid: int, request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    a = _admin(authorization, "fees")
    db.update("fee_rules", {"id": rid}, _pick(body, RULE_FIELDS))
    admin_auth.audit(a, "fee_rule.edit", str(rid), body, _ip(request))
    return {"ok": True}


@router.delete("/fees/rules/{rid}")
def del_rule(rid: int, request: Request, authorization: str = Header(default="")):
    a = _admin(authorization, "fees")
    db.x("DELETE FROM fee_rules WHERE id=?", (rid,))
    admin_auth.audit(a, "fee_rule.delete", str(rid), None, _ip(request))
    return {"ok": True}


@router.put("/fees/vip")
def put_vip(request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    a = _admin(authorization, "fees")
    tiers = body.get("tiers") or []
    with db.tx():
        db.x("DELETE FROM vip_tiers")
        for t in tiers:
            db.insert("vip_tiers", {"level": int(t["level"]), "name": str(t.get("name", ""))[:30], "min_volume_usd": str(t.get("min_volume_usd", "0")),
                                    "fee_discount_pct": str(t.get("fee_discount_pct", "0")), "limit_multiplier": str(t.get("limit_multiplier", "1"))})
    admin_auth.audit(a, "vip.update", None, body, _ip(request))
    return {"ok": True}


PROMO_FIELDS = {"name", "kinds", "assets", "discount_pct", "starts_at", "ends_at", "active", "banner"}


@router.post("/fees/promos")
def add_promo(request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    a = _admin(authorization, "fees")
    data = _pick(body, PROMO_FIELDS)
    data["created_at"] = db.now()
    pid = db.insert("promos", data)
    admin_auth.audit(a, "promo.add", str(pid), body, _ip(request))
    return {"id": pid}


@router.patch("/fees/promos/{pid}")
def edit_promo(pid: int, request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    a = _admin(authorization, "fees")
    db.update("promos", {"id": pid}, _pick(body, PROMO_FIELDS))
    admin_auth.audit(a, "promo.edit", str(pid), body, _ip(request))
    return {"ok": True}


@router.delete("/fees/promos/{pid}")
def del_promo(pid: int, request: Request, authorization: str = Header(default="")):
    a = _admin(authorization, "fees")
    db.x("DELETE FROM promos WHERE id=?", (pid,))
    admin_auth.audit(a, "promo.delete", str(pid), None, _ip(request))
    return {"ok": True}


# ───────────── settings, icons ─────────────
@router.get("/settings")
def get_settings(authorization: str = Header(default="")):
    _admin(authorization, "view")
    out = settings.all_settings()
    for k in [k for k in out if k not in settings.DEFAULTS]:
        out.pop(k)
    prov = out.get("swap", {}).get("providers", {})
    for p in prov.values():  # never echo secrets
        if p.get("api_key"):
            p["api_key"] = "•••" + p["api_key"][-4:]
    return {"settings": out, "defaults": settings.DEFAULTS}


@router.put("/settings/{section}")
def put_settings(section: str, request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    a = _admin(authorization, "settings")
    if section not in settings.DEFAULTS:
        raise AppError("bad_request")
    value = body.get("value")
    if not isinstance(value, dict):
        raise AppError("bad_request")
    if section == "swap":  # keep stored secrets when the panel sends the masked value back
        cur = settings.get("swap").get("providers", {})
        for k, p in (value.get("providers") or {}).items():
            if str(p.get("api_key", "")).startswith("•••"):
                p["api_key"] = cur.get(k, {}).get("api_key", "")
    settings.put(section, value)
    admin_auth.audit(a, "settings.update", section, {"keys": list(value)}, _ip(request))
    return {"ok": True}


@router.get("/icons")
def get_icons(authorization: str = Header(default="")):
    _admin(authorization, "view")
    return {"items": [{"key": r["key"], "url": files.url(r["path"]), "updated_at": r["updated_at"]} for r in db.q("SELECT * FROM icons ORDER BY key")]}


@router.post("/icons/{key}")
def set_icon(key: str, request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    """Upload a custom icon for an asset (asset:USDT), network (net:tron), UI icon (ui:send), badge, or method (pm:wise)."""
    a = _admin(authorization, "content")
    if not (2 <= len(key) <= 60) or not all(c.isalnum() or c in ":_-." for c in key):
        raise AppError("bad_request")
    path = files.save(body.get("data", ""), "icons", allow_svg=True)
    db.x("INSERT INTO icons(key, path, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET path=excluded.path, updated_at=excluded.updated_at",
         (key, path, db.now()))
    admin_auth.audit(a, "icon.set", key, None, _ip(request))
    return {"key": key, "url": files.url(path)}


@router.delete("/icons/{key}")
def del_icon(key: str, request: Request, authorization: str = Header(default="")):
    a = _admin(authorization, "content")
    db.x("DELETE FROM icons WHERE key=?", (key,))
    admin_auth.audit(a, "icon.delete", key, None, _ip(request))
    return {"ok": True}


@router.post("/upload")
def admin_upload(body: dict = Body(...), authorization: str = Header(default="")):
    _admin(authorization, "content")
    return {"url": files.url(files.save(body.get("data", ""), body.get("folder", "banners") if body.get("folder") in ("banners", "brand") else "banners", allow_svg=True))}


# ───────────── P2P ─────────────
@router.get("/p2p/disputes")
def p2p_disputes(status: str = "open", authorization: str = Header(default="")):
    _admin(authorization, "p2p")
    sql = "SELECT d.*, o.asset, o.amount, o.fiat, o.fiat_amount, o.buyer_id, o.seller_id, o.status AS order_status FROM p2p_disputes d JOIN p2p_orders o ON o.id=d.order_id"
    rows = db.q(sql + (" WHERE d.status<>'resolved'" if status == "open" else "") + " ORDER BY d.created_at DESC LIMIT 200")
    return {"items": rows}


@router.get("/p2p/orders")
def p2p_orders(status: str = "", authorization: str = Header(default="")):
    _admin(authorization, "p2p")
    q = "SELECT * FROM p2p_orders" + (" WHERE status=?" if status else "") + " ORDER BY created_at DESC LIMIT 300"
    return {"items": db.q(q, (status,) if status else ())}


@router.get("/p2p/orders/{oid}")
def p2p_order(oid: str, authorization: str = Header(default="")):
    _admin(authorization, "p2p")
    o = p2p.get_order(None, oid, admin=True)
    o["messages"] = p2p.messages(None, oid, 0, admin=True)
    o["dispute_full"] = db.one("SELECT * FROM p2p_disputes WHERE order_id=?", (oid,))
    o["buyer_stats"] = p2p.stats(o["buyer"]["id"]) if o.get("buyer") else None
    o["seller_stats"] = p2p.stats(o["seller"]["id"]) if o.get("seller") else None
    return o


@router.post("/p2p/orders/{oid}/{action}")
def p2p_order_action(oid: str, action: str, request: Request, body: dict = Body(default={}), authorization: str = Header(default="")):
    a = _admin(authorization, "p2p")
    if action == "resolve":
        res = p2p.resolve(oid, a["id"], body.get("winner", ""), body.get("note", ""))
    elif action == "message":
        text = (body.get("text") or "").strip()
        if not text:
            raise AppError("bad_request")
        db.insert("p2p_messages", {"order_id": oid, "sender_id": -1, "text": text[:1000], "created_at": db.now()})
        o = db.one("SELECT buyer_id, seller_id FROM p2p_orders WHERE id=?", (oid,))
        for uid in (o["buyer_id"], o["seller_id"]):
            notify(uid, "p2p_message", path=f"/p2p/order/{oid}", id=oid, text="⚖️ " + text[:200], in_app=False)
        res = {"ok": True}
    elif action == "summarize":
        res = {"summary": support.summarize_dispute(oid)}
    else:
        raise AppError("not_found", 404)
    admin_auth.audit(a, f"p2p.{action}", oid, body, _ip(request))
    return res


@router.get("/p2p/ads")
def p2p_ads(authorization: str = Header(default="")):
    _admin(authorization, "p2p")
    return {"items": db.q("SELECT a.*, u.username, u.first_name FROM p2p_ads a LEFT JOIN users u ON u.id=a.user_id WHERE a.status<>'closed' ORDER BY a.created_at DESC LIMIT 500")}


@router.post("/p2p/ads/{aid}/{action}")
def p2p_ad_action(aid: str, action: str, request: Request, authorization: str = Header(default="")):
    a = _admin(authorization, "p2p")
    if action not in ("block", "unblock"):
        raise AppError("not_found", 404)
    db.x("UPDATE p2p_ads SET status=? WHERE id=? AND status<>'closed'", ("blocked" if action == "block" else "offline", aid))
    admin_auth.audit(a, f"p2p_ad.{action}", aid, None, _ip(request))
    return {"ok": True}


@router.get("/p2p/methods")
def p2p_methods(authorization: str = Header(default="")):
    _admin(authorization, "view")
    return {"items": db.q("SELECT * FROM p2p_methods ORDER BY sort")}


@router.put("/p2p/methods/{mid}")
def p2p_method_put(mid: str, request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    a = _admin(authorization, "p2p")
    data = {"name": str(body.get("name") or mid)[:40], "type": body.get("type", "bank"), "icon": body.get("icon"), "color": body.get("color"),
            "fields": body.get("fields") or ["account_name", "account_number"], "currencies": body.get("currencies") or [],
            "enabled": bool(body.get("enabled", True)), "sort": int(body.get("sort", 100))}
    if db.one("SELECT 1 FROM p2p_methods WHERE id=?", (mid,)):
        db.update("p2p_methods", {"id": mid}, data)
    else:
        db.insert("p2p_methods", {"id": mid, **data})
    admin_auth.audit(a, "p2p_method.put", mid, body, _ip(request))
    return {"ok": True}


# ───────────── support, forms, KYC ─────────────
@router.get("/tickets")
def tickets(status: str = "", authorization: str = Header(default="")):
    _admin(authorization, "support")
    q = "SELECT t.*, u.username, u.first_name, u.photo_url FROM tickets t LEFT JOIN users u ON u.id=t.user_id"
    rows = db.q(q + (" WHERE t.status=?" if status else "") + " ORDER BY t.updated_at DESC LIMIT 300", (status,) if status else ())
    return {"items": rows}


@router.get("/tickets/{tid}")
def ticket(tid: int, authorization: str = Header(default="")):
    _admin(authorization, "support")
    t = support.ticket_thread(None, tid, admin=True)
    t["ai_chat"] = support.history({"id": t["user_id"]}, 40)
    return t


@router.post("/tickets/{tid}/reply")
def ticket_reply(tid: int, request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    a = _admin(authorization, "support")
    res = support.admin_reply(a["id"], tid, (body.get("text") or "").strip(), bool(body.get("close")))
    admin_auth.audit(a, "ticket.reply", str(tid), None, _ip(request))
    return res


@router.get("/forms")
def forms(kind: str = "", authorization: str = Header(default="")):
    _admin(authorization, "support")
    rows = db.q("SELECT * FROM forms" + (" WHERE kind=?" if kind else "") + " ORDER BY id DESC LIMIT 300", (kind,) if kind else ())
    for r in rows:
        r["data"] = db.jl(r["data"])
    return {"items": rows}


@router.post("/forms/{fid}")
def form_update(fid: int, body: dict = Body(...), authorization: str = Header(default="")):
    _admin(authorization, "support")
    db.update("forms", {"id": fid}, {"status": body.get("status", "done"), "admin_note": (body.get("note") or "")[:500]})
    return {"ok": True}


@router.get("/kyc")
def kyc_list(status: str = "pending", authorization: str = Header(default="")):
    _admin(authorization, "users")
    rows = db.q("SELECT k.*, u.username, u.first_name FROM kyc_requests k LEFT JOIN users u ON u.id=k.user_id WHERE k.status=? ORDER BY k.id DESC LIMIT 200", (status,))
    for r in rows:
        r["data"] = db.jl(r["data"])
        r["files"] = [files.url(p) for p in db.jl(r["files"], [])]
    return {"items": rows}


@router.post("/kyc/{kid}/{action}")
def kyc_action(kid: int, action: str, request: Request, body: dict = Body(default={}), authorization: str = Header(default="")):
    a = _admin(authorization, "users")
    r = db.one("SELECT * FROM kyc_requests WHERE id=?", (kid,))
    if not r or r["status"] != "pending" or action not in ("approve", "reject"):
        raise AppError("bad_state")
    db.update("kyc_requests", {"id": kid}, {"status": "approved" if action == "approve" else "rejected", "note": (body.get("note") or "")[:300],
                                            "reviewed_at": db.now(), "reviewer": a["id"]})
    if action == "approve":
        db.x("UPDATE users SET kyc_level=MAX(kyc_level, 2) WHERE id=?", (r["user_id"],))
        notify(r["user_id"], "kyc_approved", path="/settings/security")
    else:
        notify(r["user_id"], "kyc_rejected", path="/settings/security", reason=body.get("note", ""))
    admin_auth.audit(a, f"kyc.{action}", str(kid), body, _ip(request))
    return {"ok": True}


# ───────────── treasury & revenue ─────────────
@router.get("/treasury")
def get_treasury(authorization: str = Header(default="")):
    _admin(authorization, "finance")
    out = treasury.solvency()
    out["ops"] = db.q("SELECT * FROM treasury_ops ORDER BY id DESC LIMIT 100")
    out["networks"] = [{"id": n["id"], "withdraw_mode": n["withdraw_mode"], "config": {k: v for k, v in db.jl(n["config"]).items() if k != "rpc"},
                        "rpc": db.jl(n["config"]).get("rpc") or config.RPC.get(n["id"], "")}
                       for n in db.q("SELECT * FROM networks ORDER BY sort")]
    out["holdings"] = {r["key"][9:]: r["value"] for r in db.q("SELECT key, value FROM scan_state WHERE key LIKE 'holdings:%:%'")}
    return out


@router.post("/treasury/{action}")
def treasury_action(action: str, request: Request, body: dict = Body(default={}), authorization: str = Header(default="")):
    a = _admin(authorization, "finance")
    if action == "refresh":
        res = treasury.refresh_holdings()
    elif action == "sweep":
        res = {"started": treasury.sweep_now(body.get("network", ""))}
    else:
        raise AppError("not_found", 404)
    admin_auth.audit(a, f"treasury.{action}", body.get("network"), None, _ip(request))
    return res


@router.get("/revenue")
def revenue(days: int = 30, authorization: str = Header(default="")):
    _admin(authorization, "finance")
    since = db.now() - max(1, min(days, 365)) * 86400
    rows = db.q("SELECT source, asset, amount, usd, created_at FROM revenue WHERE created_at>=? ORDER BY created_at", (since,))
    by_day: dict = {}
    by_src: dict = {}
    for r in rows:
        day = r["created_at"] - r["created_at"] % 86400
        by_day.setdefault(day, {}).setdefault(r["source"], Decimal(0))
        by_day[day][r["source"]] += D(r["usd"])
        by_src[r["source"]] = by_src.get(r["source"], Decimal(0)) + D(r["usd"])
    return {"by_day": [{"day": d, **{k: float(v) for k, v in v.items()}} for d, v in sorted(by_day.items())],
            "by_source": {k: s(v.quantize(Decimal("0.01"))) for k, v in by_src.items()},
            "total": s(sum(by_src.values(), Decimal(0)).quantize(Decimal("0.01"))),
            "swaps": db.q("SELECT * FROM swaps WHERE created_at>=? ORDER BY created_at DESC LIMIT 200", (since,))}


# ───────────── broadcast ─────────────
@router.post("/broadcast")
def broadcast(request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    a = _admin(authorization, "content")
    text = (body.get("text") or "").strip()
    if not text:
        raise AppError("bad_request")
    seg = body.get("segment", "all")
    q, args = "SELECT id FROM users WHERE status='active' AND dm_ok=1", []
    if seg == "active7":
        q += " AND last_seen>=?"
        args.append(db.now() - 7 * 86400)
    elif seg == "funded":
        q += " AND id IN (SELECT DISTINCT user_id FROM balances WHERE CAST(available AS REAL)>0)"
    elif seg.startswith("lang:"):
        q += " AND lang=?"
        args.append(seg[5:])
    elif seg == "test":
        q += " AND id=?"
        args.append(a["id"])
    ids = [r["id"] for r in db.q(q, tuple(args))]
    bid = db.insert("broadcasts", {"text": text, "button": {"text": body.get("button_text"), "path": body.get("button_path", "")},
                                   "segment": seg, "status": "queued", "total": len(ids), "admin_id": a["id"], "created_at": db.now()})
    kb = [[tg.webapp_button(body["button_text"], body.get("button_path", ""))]] if body.get("button_text") and config.WEBAPP_URL else None
    with db.tx():
        for uid in ids:
            payload = {"chat_id": uid, "text": text[:4000], "parse_mode": "HTML", "link_preview_options": {"is_disabled": True}}
            if body.get("image"):
                payload = {"chat_id": uid, "photo": body["image"], "caption": text[:1000], "parse_mode": "HTML"}
            if kb:
                payload["reply_markup"] = {"inline_keyboard": kb}
            tg.queue("sendPhoto" if body.get("image") else "sendMessage", payload, priority=9, broadcast_id=bid)
    admin_auth.audit(a, "broadcast", str(bid), {"segment": seg, "total": len(ids)}, _ip(request))
    return {"id": bid, "total": len(ids)}


@router.get("/broadcasts")
def broadcasts(authorization: str = Header(default="")):
    _admin(authorization, "content")
    return {"items": db.q("SELECT * FROM broadcasts ORDER BY id DESC LIMIT 50")}


# ───────────── staff, audit, alerts, system ─────────────
@router.get("/admins")
def admins(authorization: str = Header(default="")):
    _admin(authorization, "view")
    rows = [{"user_id": i, "role": "owner", "name": None, "fixed": True} for i in config.OWNER_IDS]
    rows += db.q("SELECT * FROM admins ORDER BY created_at")
    for r in rows:
        u = users.get(r["user_id"])
        r["name"] = users.display_name(u) if u else r.get("name")
    return {"items": rows, "roles": list(admin_auth.ROLES)}


@router.post("/admins")
def add_admin(request: Request, body: dict = Body(...), authorization: str = Header(default="")):
    a = _admin(authorization, "*")
    role = body.get("role")
    if role not in ("admin", "finance", "support", "viewer"):
        raise AppError("bad_request")
    target = users.find(str(body.get("user", "")))
    uid = target["id"] if target else int(body.get("user_id") or 0)
    if not uid:
        raise AppError("user_not_found", 404)
    db.x("INSERT INTO admins(user_id, role, added_by, created_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role",
         (uid, role, a["id"], db.now()))
    admin_auth.audit(a, "admin.add", str(uid), body, _ip(request))
    return {"ok": True}


@router.delete("/admins/{uid}")
def del_admin(uid: int, request: Request, authorization: str = Header(default="")):
    a = _admin(authorization, "*")
    db.x("DELETE FROM admins WHERE user_id=?", (uid,))
    admin_auth.audit(a, "admin.remove", str(uid), None, _ip(request))
    return {"ok": True}


@router.get("/audit")
def audit_log(limit: int = 200, authorization: str = Header(default="")):
    _admin(authorization, "view")
    return {"items": db.q("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (min(limit, 1000),))}


@router.get("/alerts")
def alerts(authorization: str = Header(default="")):
    _admin(authorization, "view")
    return {"items": db.q("SELECT * FROM alerts ORDER BY id DESC LIMIT 200")}


@router.post("/alerts/seen")
def alerts_seen(authorization: str = Header(default="")):
    _admin(authorization, "view")
    db.x("UPDATE alerts SET seen=1 WHERE seen=0")
    return {"ok": True}


@router.get("/system")
def system(authorization: str = Header(default="")):
    _admin(authorization, "view")
    size = os.path.getsize(config.DB_PATH) if config.DB_PATH.exists() else 0
    return {
        "db_bytes": size, "wallet_ready": keys.has_master(), "ai": bool(config.ANTHROPIC_API_KEY), "bot": config.BOT_USERNAME,
        "webapp": config.WEBAPP_URL, "worker_heartbeat": int(db.val("SELECT value FROM scan_state WHERE key='worker:heartbeat'", (), 0) or 0),
        "outbox": {r["status"]: r["n"] for r in db.q("SELECT status, COUNT(*) AS n FROM outbox GROUP BY status")},
        "scan_state": db.q("SELECT key, value, updated_at FROM scan_state WHERE key NOT LIKE 'holdings:%' AND key NOT LIKE 'tron:ts:%' AND key NOT LIKE 'sol:sig:%' ORDER BY key LIMIT 200"),
        "prices_updated": db.val("SELECT MAX(updated_at) FROM prices", (), 0), "hot_addresses": treasury.hot_addresses(),
    }


@router.post("/system/ledger-audit")
def ledger_audit(authorization: str = Header(default="")):
    _admin(authorization, "finance")
    bad = ledger.audit()
    return {"ok": not bad, "mismatches": bad[:100]}
