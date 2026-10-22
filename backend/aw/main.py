"""Zohra Wallet API (FastAPI). Users authenticate with Telegram initData on every request (header X-Init-Data)."""
import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from decimal import Decimal

from fastapi import Body, Depends, FastAPI, Header, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from . import (admin_api, admin_auth, bot, catalog, coinmeta, config, db, deposits, fees, files, gifts, guard, ledger, p2p, prices, referral,
               rewards, settings, support, swap, transfers, ton_connect, users, withdrawals)
from .money import AppError, D, s
from .security import limiter, receipt_sig, verify_init_data

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("aw.api")

@asynccontextmanager
async def lifespan(_app):
    db.conn()
    catalog.seed()
    deposits.migrate_ton_addresses()  # personal TON wallets for users who had a memo
    try:
        bot.setup_webhook()
    except Exception as e:  # pragma: no cover
        log.warning("webhook setup failed: %s", e)
    yield


app = FastAPI(title="Zohra Wallet", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.exception_handler(AppError)
def _app_error(_req: Request, e: AppError):
    return JSONResponse({"error": e.code, "params": {k: str(v) for k, v in e.params.items()}}, status_code=e.status)


@app.exception_handler(Exception)
def _any_error(_req: Request, e: Exception):
    log.exception("unhandled error")
    return JSONResponse({"error": "server_error"}, status_code=500)


@app.middleware("http")
async def _headers(request: Request, call_next):
    t0 = time.time()
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Cache-Control"] = resp.headers.get("Cache-Control", "no-store")
    resp.headers["X-Response-Time"] = f"{(time.time() - t0) * 1000:.0f}ms"
    return resp


def client_ip(request: Request) -> str:
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "")


# ───────────────────────── auth ─────────────────────────
def current_user(request: Request, x_init_data: str = Header(default="")) -> dict:
    data = verify_init_data(x_init_data)
    tgu = data["user"]
    limiter.check(f"u:{tgu['id']}", int(settings.get("security").get("rate_limit_per_minute", 90)))
    u = users.get(int(tgu["id"]))
    if not u:
        u, _ = users.upsert_from_telegram(tgu, start_param=data.get("start_param"), ip=client_ip(request))
    elif db.now() - (u.get("last_seen") or 0) > 300:
        db.x("UPDATE users SET last_seen=?, photo_url=COALESCE(?, photo_url), username=? WHERE id=?",
             (db.now(), tgu.get("photo_url"), tgu.get("username"), u["id"]))
    if u["status"] == "banned":
        raise AppError("account_banned", 403)
    return u


def money_user(u: dict = Depends(current_user)) -> dict:
    if settings.get("general").get("maintenance"):
        raise AppError("maintenance", 503)
    users.ensure_active(u)
    return u


# ───────────────────────── public ─────────────────────────
@app.get("/api/health")
def health():
    return {"ok": True, "time": db.now(), "db": bool(db.val("SELECT 1"))}


@app.get("/api/config")
def public_config():
    g = settings.get("general")
    br = settings.get("branding")
    return {
        "app_name": g["app_name"], "bot": config.BOT_USERNAME, "webapp": config.WEBAPP_URL, "maintenance": g["maintenance"],
        "maintenance_msg": g["maintenance_msg"], "languages": g["languages"], "default_lang": g["default_lang"],
        "currencies": g["display_currencies"], "features": g["features"], "badges": [b for b in g["badges"] if b.get("enabled")],
        "banners": [b for b in g.get("banners", []) if b.get("enabled", True) and (not b.get("until") or b["until"] > db.now())],
        "announcement": g.get("announcement"), "support_username": g.get("support_username"), "channel_url": g.get("channel_url"),
        "terms_url": g.get("terms_url"), "privacy_url": g.get("privacy_url"),
        "branding": br, "icons": icons_map(), "ai_name": settings.get("ai").get("name", "Zohra AI"),
        "networks": [_net_out(n) for n in db.q("SELECT * FROM networks WHERE enabled=1 ORDER BY sort")],
        "tonconnect_manifest": f"{config.WEBAPP_URL}/tonconnect-manifest.json",
    }


def icons_map() -> dict:
    return {r["key"]: files.url(r["path"]) for r in db.q("SELECT key, path FROM icons")}


def _net_out(n: dict) -> dict:
    return {"id": n["id"], "name": n["name"], "short": n["short"], "kind": n["kind"], "color": n["color"], "eta": n["eta"],
            "confirmations": n["confirmations"], "deposit": bool(n["deposit_enabled"]), "withdraw": bool(n["withdraw_enabled"]),
            "explorer_tx": n["explorer_tx"], "explorer_addr": n["explorer_addr"], "memo": n["memo_mode"] == "required",
            "badges": db.jl(n.get("badges"), [])}


@app.get("/tonconnect-manifest.json")
def tc_manifest():
    return JSONResponse(ton_connect.manifest(), headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300"})


@app.get("/api/files/{folder}/{name}")
def get_file(folder: str, name: str):
    p = files.path_for(f"{folder}/{name}")
    ext = name.rsplit(".", 1)[-1]
    return FileResponse(p, media_type=files.MIME.get(ext, "application/octet-stream"),
                        headers={"Cache-Control": "public, max-age=86400", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'"})


@app.get("/api/receipt/{tx_id}")
def public_receipt(tx_id: str, request: Request, sig: str = Query("", alias="s")):
    """Anyone can verify an AW receipt: the signature binds id, user, amount and asset."""
    limiter.check(f"ip:{client_ip(request)}:receipt", 30)
    t = db.one("SELECT * FROM txs WHERE id=?", (tx_id.upper(),))
    if not t or receipt_sig(t["id"], t["user_id"], t["amount"], t["asset"]) != sig:
        return {"valid": False}
    return {"valid": True, "id": t["id"], "type": t["type"], "status": t["status"], "asset": t["asset"], "amount": t["amount"],
            "network": t["network"], "txid": t["txid"], "created_at": t["created_at"]}


@app.post("/api/tg/webhook")
def tg_webhook(update: dict = Body(...), x_telegram_bot_api_secret_token: str = Header(default="")):
    import hmac

    if not config.WEBHOOK_SECRET or not hmac.compare_digest(x_telegram_bot_api_secret_token or "", config.WEBHOOK_SECRET):
        raise AppError("forbidden", 403)
    bot.handle(update)
    return {"ok": True}


# ───────────────────────── me & wallet ─────────────────────────
def _me(u: dict) -> dict:
    tier = fees.vip(u)
    return {
        "id": u["id"], "name": users.display_name(u), "first_name": u["first_name"], "username": u["username"], "photo": u["photo_url"],
        "premium": bool(u["is_premium"]), "lang": u["lang"], "ref_code": u["ref_code"], "role": u["role"], "kyc_level": u["kyc_level"],
        "phone": u["phone_masked"], "status": u["status"], "pin_set": bool(u["pin_hash"]), "bio_enabled": bool(u["bio_token_hash"]),
        "security_hold_until": u["security_hold_until"] or 0, "settings": u["settings"], "created_at": u["created_at"],
        "vip": {"level": tier["level"], "name": tier["name"], "discount_pct": s(tier["discount_pct"])},
        "is_admin": bool(admin_auth.role_of(u["id"])),
        "unread": db.val("SELECT COUNT(*) FROM notifications WHERE user_id=? AND read=0", (u["id"],), 0),
        "ton_wallet": ton_connect.connected(u["id"]),
    }


@app.post("/api/auth")
def auth(request: Request, x_init_data: str = Header(default="")):
    data = verify_init_data(x_init_data)
    limiter.check(f"auth:{data['user']['id']}", 30)
    u, created = users.upsert_from_telegram(data["user"], start_param=data.get("start_param"), ip=client_ip(request),
                                            platform=request.headers.get("x-tg-platform"))
    if u["status"] == "banned":
        raise AppError("account_banned", 403)
    return {"me": _me(u), "created": created, "start_param": data.get("start_param")}


@app.get("/api/me")
def me(u: dict = Depends(current_user)):
    return _me(u)


ALLOWED_SETTINGS = {"currency", "theme", "hide_balance", "notify", "whitelist_only", "hide_small", "home_assets", "haptics"}


@app.patch("/api/me")
def update_me(body: dict = Body(...), u: dict = Depends(current_user)):
    if "lang" in body and body["lang"] in users.SUPPORTED_LANGS:
        db.update("users", {"id": u["id"]}, {"lang": body["lang"]})
    st = dict(u["settings"])
    for k, v in (body.get("settings") or {}).items():
        if k in ALLOWED_SETTINGS:
            if k == "whitelist_only" and not v and st.get("whitelist_only"):
                guard.confirm(u, "address_book", body.get("pin"), body.get("bio"))
            st[k] = v
    db.update("users", {"id": u["id"]}, {"settings": st})
    return _me(users.must(u["id"]))


def _assets_out(u: dict) -> list[dict]:
    bals = ledger.balances(u["id"])
    pr = {r["asset"]: r for r in db.q("SELECT * FROM prices")}
    nets: dict[str, list] = {}
    for an in db.q("SELECT an.*, n.name AS net_name, n.short AS net_short, n.enabled AS net_on, n.deposit_enabled AS net_dep, "
                   "n.withdraw_enabled AS net_wd, n.memo_mode, n.eta, n.confirmations FROM asset_networks an JOIN networks n ON n.id=an.network "
                   "WHERE an.enabled=1 AND n.enabled=1 ORDER BY n.sort"):
        nets.setdefault(an["asset"], []).append({
            "network": an["network"], "name": an["net_name"], "short": an["net_short"], "contract": an["contract"],
            "deposit": bool(an["deposit_enabled"] and an["net_dep"]), "withdraw": bool(an["withdraw_enabled"] and an["net_wd"]),
            "min_deposit": an["min_deposit"], "min_withdraw": an["min_withdraw"], "memo": an["memo_mode"] == "required",
            "eta": an["eta"], "confirmations": an["confirmations"]})
    out = []
    for a in db.q("SELECT * FROM assets WHERE enabled=1 ORDER BY sort"):
        b = bals.get(a["id"], {"available": Decimal(0), "locked": Decimal(0)})
        p = pr.get(a["id"]) or {}
        usd = D(p.get("usd") or 0)
        out.append({"id": a["id"], "name": a["name"], "color": a["color"], "precision": a["precision"], "display": a["display"],
                    "stable": bool(a["is_stable"]), "available": s(b["available"]), "locked": s(b["locked"]), "usd": s(usd),
                    "change24h": p.get("change24h") or "0", "value_usd": s(((b["available"] + b["locked"]) * usd).quantize(Decimal("0.01"))),
                    "swap": bool(a["swap_enabled"]), "transfer": bool(a["transfer_enabled"]), "p2p": bool(a["p2p_enabled"]),
                    "badges": db.jl(a.get("badges"), []), "networks": nets.get(a["id"], [])})
    return out


@app.get("/api/wallet")
def wallet(u: dict = Depends(current_user)):
    assets = _assets_out(u)
    total = sum((D(a["value_usd"]) for a in assets), Decimal(0))
    change = Decimal(0)
    for a in assets:
        v = D(a["value_usd"])
        ch = D(a["change24h"])
        if v > 0 and ch > -100:
            change += v - v / (1 + ch / 100)
    return {"assets": assets, "total_usd": s(total.quantize(Decimal("0.01"))), "change24h_usd": s(change.quantize(Decimal("0.01"))),
            "fx": prices.fx(), "updated_at": db.val("SELECT MAX(updated_at) FROM prices", (), 0)}


# ───────────────────────── live prices ─────────────────────────
_STREAMS = {"n": 0}
MAX_STREAMS = 3000


@app.get("/api/prices")
def prices_now():
    return prices.snapshot()


@app.get("/api/prices/stream")
async def prices_stream(request: Request):
    """Server-sent events: the full ticker on connect, then every refresh. Closes after 30 min (the browser reconnects)."""
    if _STREAMS["n"] >= MAX_STREAMS:
        raise AppError("busy", 503)

    async def gen():
        _STREAMS["n"] += 1
        try:
            last, quiet, until = -1, 0, time.time() + 1800
            yield "retry: 5000\n\n"
            while time.time() < until and not await request.is_disconnected():
                snap = prices.snapshot()
                if snap["at"] != last:
                    last, quiet = snap["at"], 0
                    yield f"data: {json.dumps(snap, separators=(',', ':'))}\n\n"
                else:
                    quiet += 1
                    if quiet % 8 == 0:
                        yield ": ping\n\n"
                await asyncio.sleep(2)
        finally:
            _STREAMS["n"] -= 1

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


@app.get("/api/assets/{asset}")
def asset_detail(asset: str, u: dict = Depends(current_user)):
    a = next((x for x in _assets_out(u) if x["id"] == asset.upper()), None)
    if not a:
        raise AppError("not_found", 404)
    a["chart"] = prices.history(asset.upper(), 24 * 7)
    a["market"] = coinmeta.market(asset.upper())
    a["txs"] = db.q("SELECT id,type,status,asset,amount,fee,asset2,amount2,network,counterparty,created_at FROM txs WHERE user_id=? "
                    "AND (asset=? OR asset2=?) ORDER BY created_at DESC LIMIT 20", (u["id"], asset.upper(), asset.upper()))
    return a


# ───────────────────────── deposit ─────────────────────────
@app.post("/api/deposit/address")
def deposit_address(body: dict = Body(...), u: dict = Depends(money_user)):
    guard.feature("deposit")
    nid = body.get("network", "")
    asset = (body.get("asset") or "").upper()
    an = catalog.asset_network(asset, nid) if asset else None
    if asset and (not an or not an["deposit_enabled"]):
        raise AppError("deposit_unavailable")
    info = deposits.get_address(u, nid)
    net = catalog.network(nid)
    info.update({"confirmations": net["confirmations"], "eta": net["eta"], "min_deposit": an["min_deposit"] if an else None,
                 "contract": an["contract"] if an else None, "network_name": net["name"],
                 "ton_wallet": ton_connect.connected(u["id"]) if net["kind"] == "ton" else None})
    return info


@app.post("/api/deposit/verify")
def deposit_verify(body: dict = Body(...), u: dict = Depends(money_user)):
    limiter.check(f"verify:{u['id']}", 10)
    return deposits.verify_tx(u, body.get("network", ""), body.get("txid", ""))


# ───────────────────────── withdraw ─────────────────────────
def _clean(d: dict) -> dict:
    return {k: v for k, v in d.items() if not k.startswith("_")}


@app.post("/api/withdraw/preview")
def withdraw_preview(body: dict = Body(...), u: dict = Depends(money_user)):
    return _clean(withdrawals.preview(u, (body.get("asset") or "").upper(), body.get("network", ""), body.get("address", ""),
                                      body.get("amount"), body.get("memo")))


@app.post("/api/withdraw")
def withdraw(body: dict = Body(...), u: dict = Depends(money_user)):
    guard.feature("withdraw")
    return withdrawals.request(u, (body.get("asset") or "").upper(), body.get("network", ""), body.get("address", ""), body.get("amount"),
                               body.get("memo"), body.get("pin"), body.get("bio"), body.get("idem"))


@app.post("/api/withdraw/{wid}/cancel")
def withdraw_cancel(wid: str, u: dict = Depends(money_user)):
    return withdrawals.cancel(u, wid)


@app.get("/api/withdrawals")
def my_withdrawals(u: dict = Depends(current_user)):
    return {"items": withdrawals.user_list(u["id"])}


# ───────────────────────── transfers ─────────────────────────
@app.get("/api/users/lookup")
def lookup(q: str = "", u: dict = Depends(current_user)):
    limiter.check(f"lookup:{u['id']}", 30)
    r = users.find(q)
    if not r or r["id"] == u["id"] or r["status"] == "banned":
        return {"user": None}
    return {"user": users.public(r)}


@app.post("/api/transfer/preview")
def transfer_preview(body: dict = Body(...), u: dict = Depends(money_user)):
    rid = body.get("to_id")
    p = transfers.preview(u, int(rid) if rid else body.get("to", ""), (body.get("asset") or "").upper(), body.get("amount"))
    return _clean(p)


@app.post("/api/transfer")
def transfer(body: dict = Body(...), u: dict = Depends(money_user)):
    rid = body.get("to_id")
    return transfers.send(u, int(rid) if rid else body.get("to", ""), (body.get("asset") or "").upper(), body.get("amount"),
                          body.get("note"), body.get("idem"), body.get("pin"), body.get("bio"))


@app.get("/api/contacts/recent")
def recent_contacts(u: dict = Depends(current_user)):
    return {"items": transfers.recent_contacts(u["id"])}


@app.post("/api/contacts/pick")
def contact_pick(body: dict = Body(default={}), u: dict = Depends(current_user)):
    limiter.check(f"pick:{u['id']}", 10)
    return gifts.start_contact_pick(u, body.get("purpose", "send"))


@app.get("/api/contacts/pick/{token}")
def contact_pick_status(token: str, u: dict = Depends(current_user)):
    return gifts.contact_pick_status(u, token)


# ───────────────────────── gifts ─────────────────────────
@app.post("/api/gifts")
def gift_create(body: dict = Body(...), u: dict = Depends(money_user)):
    return gifts.create(u, (body.get("asset") or "").upper(), body.get("amount"), body.get("lock", "open"), body.get("recipient_id"),
                        body.get("recipient_username"), body.get("password"), body.get("shares", 1), body.get("split", "equal"),
                        body.get("message"), body.get("theme"), body.get("pin"), body.get("bio"), body.get("idem"))


@app.post("/api/gifts/{gid}/share")
def gift_share(gid: str, u: dict = Depends(current_user)):
    return gifts.prepare_share(u, gid)


@app.get("/api/gifts")
def gift_list(u: dict = Depends(current_user)):
    return {"items": gifts.mine(u["id"])}


@app.get("/api/gifts/view/{code}")
def gift_view(code: str, u: dict = Depends(current_user)):
    return gifts.view(code, u)


@app.post("/api/gifts/claim")
def gift_claim(body: dict = Body(...), u: dict = Depends(money_user)):
    limiter.check(f"claim:{u['id']}", 20)
    return gifts.claim(u, body.get("code", ""), body.get("password"))


@app.post("/api/gifts/{gid}/cancel")
def gift_cancel(gid: str, u: dict = Depends(money_user)):
    return gifts.cancel(u, gid)


# ───────────────────────── swap ─────────────────────────
@app.get("/api/swap/pairs")
def swap_pairs(u: dict = Depends(current_user)):
    return {"assets": swap.pairs(), "spread_pct": s(fees.quote("swap", u, "USDT", use_voucher=False)["pct"])}


@app.post("/api/swap/quote")
def swap_quote(body: dict = Body(...), u: dict = Depends(money_user)):
    limiter.check(f"quote:{u['id']}", 60)
    return swap.quote(u, (body.get("from") or "").upper(), (body.get("to") or "").upper(), body.get("amount"), body.get("amount_out"))


@app.post("/api/swap/execute")
def swap_execute(body: dict = Body(...), u: dict = Depends(money_user)):
    return swap.execute(u, body.get("quote_id", ""), body.get("idem"))


# ───────────────────────── history ─────────────────────────
@app.get("/api/txs")
def txs(type: str = "", asset: str = "", before: int = 0, limit: int = 30, u: dict = Depends(current_user)):
    q, p = "SELECT * FROM txs WHERE user_id=?", [u["id"]]
    if type:
        types = type.split(",")
        q += f" AND type IN ({','.join('?' for _ in types)})"
        p += types
    if asset:
        q += " AND (asset=? OR asset2=?)"
        p += [asset.upper(), asset.upper()]
    if before:
        q += " AND created_at<?"
        p.append(before)
    rows = db.q(q + " ORDER BY created_at DESC LIMIT ?", (*p, max(1, min(limit, 100))))
    return {"items": [_tx_out(t, u) for t in rows]}


def _tx_out(t: dict, u: dict) -> dict:
    t = dict(t)
    t["meta"] = db.jl(t.get("meta"))
    if t.get("counterparty"):
        cp = users.get(t["counterparty"])
        t["counterparty_user"] = users.public(cp) if cp else None
    return t


@app.get("/api/txs/{tid}")
def tx_detail(tid: str, u: dict = Depends(current_user)):
    t = db.one("SELECT * FROM txs WHERE id=? AND user_id=?", (tid.upper(), u["id"]))
    if not t:
        raise AppError("not_found", 404)
    out = _tx_out(t, u)
    if t["type"] == "withdraw":
        w = db.one("SELECT status, risk, error, txid FROM withdrawals WHERE id=?", (t["id"],))
        out["withdrawal"] = {"status": w["status"], "txid": w["txid"]} if w else None
    if t["network"]:
        net = catalog.network(t["network"])
        if net and t["txid"] and not str(t["txid"]).startswith(("bal:", "seqno:")):
            out["explorer"] = net["explorer_tx"].replace("{tx}", t["txid"])
    out["receipt"] = f"{config.WEBAPP_URL}/#/verify/{t['id']}?s={receipt_sig(t['id'], t['user_id'], t['amount'], t['asset'])}"
    return out


# ───────────────────────── fees, limits ─────────────────────────
@app.get("/api/fees")
def fee_schedule(u: dict = Depends(current_user)):
    return fees.schedule_for_user(u)


@app.get("/api/limits")
def limits(u: dict = Depends(current_user)):
    return guard.usage(u)


# ───────────────────────── security ─────────────────────────
@app.post("/api/security/pin")
def set_pin(body: dict = Body(...), u: dict = Depends(current_user)):
    limiter.check(f"pin:{u['id']}", 10)
    had = bool(u.get("pin_hash"))
    guard.set_pin(u, str(body.get("new_pin", "")), body.get("old_pin"))
    if had:
        from .notify import notify

        notify(u["id"], "pin_changed", path="/settings/security", hours=settings.get("security").get("hold_after_pin_reset_hours", 24))
    return _me(users.must(u["id"]))


@app.post("/api/security/pin/verify")
def verify_pin(body: dict = Body(...), u: dict = Depends(current_user)):
    limiter.check(f"pinv:{u['id']}", 20)
    guard.verify_pin(u, str(body.get("pin", "")))
    return {"ok": True}


@app.post("/api/security/biometric")
def biometric(body: dict = Body(...), u: dict = Depends(current_user)):
    if body.get("enable"):
        guard.verify_pin(u, str(body.get("pin", "")))
        guard.enable_biometric(u, body.get("token", ""))
    else:
        db.update("users", {"id": u["id"]}, {"bio_token_hash": None})
    return _me(users.must(u["id"]))


@app.post("/api/security/phone")
def request_phone(u: dict = Depends(current_user)):
    bot.ask_phone(u["id"], u.get("lang") or "en")
    return {"ok": True, "bot": config.BOT_USERNAME}


@app.get("/api/security/activity")
def activity(u: dict = Depends(current_user)):
    return {"logins": db.q("SELECT platform, created_at FROM login_events WHERE user_id=? ORDER BY id DESC LIMIT 20", (u["id"],))}


# ───────────────────────── address book ─────────────────────────
@app.get("/api/addressbook")
def ab_list(u: dict = Depends(current_user)):
    return {"items": db.q("SELECT * FROM address_book WHERE user_id=? ORDER BY id DESC", (u["id"],))}


@app.post("/api/addressbook")
def ab_add(body: dict = Body(...), u: dict = Depends(current_user)):
    from . import addresses

    net = catalog.network(body.get("network", ""))
    if not net:
        raise AppError("bad_network")
    addr = addresses.normalize(net["kind"], body.get("address", ""))
    if db.val("SELECT COUNT(*) FROM address_book WHERE user_id=?", (u["id"],), 0) >= 100:
        raise AppError("too_many")
    wl = bool(body.get("whitelisted"))
    if wl:
        guard.confirm(u, "address_book", body.get("pin"), body.get("bio"))
    hold = int(settings.get("security").get("address_whitelist_hold_hours", 0)) * 3600
    aid = db.insert("address_book", {"user_id": u["id"], "network": net["id"], "address": addr, "memo": (body.get("memo") or None),
                                     "label": (body.get("label") or "")[:40], "whitelisted": wl, "created_at": db.now(),
                                     "usable_at": db.now() + hold if wl else None})
    return {"id": aid}


@app.delete("/api/addressbook/{aid}")
def ab_delete(aid: int, u: dict = Depends(current_user)):
    db.x("DELETE FROM address_book WHERE id=? AND user_id=?", (aid, u["id"]))
    return {"ok": True}


# ───────────────────────── TON Connect ─────────────────────────
@app.post("/api/ton/connect")
def ton_connect_save(body: dict = Body(...), u: dict = Depends(current_user)):
    return ton_connect.connect(u, body.get("address", ""), body.get("app"))


@app.delete("/api/ton/connect")
def ton_connect_remove(u: dict = Depends(current_user)):
    ton_connect.disconnect(u)
    return {"ok": True}


@app.post("/api/ton/deposit")
def ton_deposit(body: dict = Body(...), u: dict = Depends(money_user)):
    guard.feature("deposit")
    return ton_connect.deposit_message(u, body.get("asset", "TON"), body.get("amount"), body.get("sender", ""))


# ───────────────────────── referral & rewards ─────────────────────────
@app.get("/api/referral")
def referral_stats(u: dict = Depends(current_user)):
    return referral.stats(u)


@app.post("/api/referral/claim")
def referral_claim(u: dict = Depends(money_user)):
    return referral.claim(u)


@app.get("/api/referral/leaderboard")
def referral_board(u: dict = Depends(current_user)):
    return {"items": referral.leaderboard()}


@app.get("/api/rewards")
def rewards_overview(u: dict = Depends(current_user)):
    return rewards.overview(u)


@app.post("/api/rewards/checkin")
def rewards_checkin(u: dict = Depends(current_user)):
    return rewards.checkin(u)


@app.post("/api/rewards/missions/{mid}/claim")
def rewards_claim(mid: str, u: dict = Depends(current_user)):
    return rewards.claim_mission(u, mid)


# ───────────────────────── P2P ─────────────────────────
@app.get("/api/p2p/meta")
def p2p_meta(fiat: str = "", u: dict = Depends(current_user)):
    cfg = settings.get("p2p")
    return {"fiats": cfg["fiats"], "assets": cfg["assets"], "windows": cfg["payment_windows"], "methods": p2p.methods(fiat or None),
            "my_methods": p2p.my_methods(u["id"]), "allow_terms": cfg.get("allow_terms", True),
            "min_kyc_to_post": cfg.get("min_kyc_to_post", 1), "price_guard_pct": cfg.get("price_guard_pct"),
            "market_price": {a: s(p2p.market_price(a, fiat).quantize(Decimal("0.0001"))) for a in cfg["assets"]} if fiat else {}}


@app.get("/api/p2p/market")
def p2p_market(asset: str, fiat: str, side: str = "buy", method: str = "", amount: str = "", merchants: int = 0, u: dict = Depends(current_user)):
    guard.feature("p2p")
    return {"items": p2p.market(asset, fiat, side, method or None, amount or None, u, bool(merchants)),
            "market_price": s(p2p.market_price(asset.upper(), fiat.upper()).quantize(Decimal("0.0001")))}


@app.get("/api/p2p/ads/{aid}")
def p2p_ad(aid: str, u: dict = Depends(current_user)):
    return p2p.get_ad(aid, u)


@app.post("/api/p2p/ads")
def p2p_ad_create(body: dict = Body(...), u: dict = Depends(money_user)):
    return p2p.create_ad(u, body)


@app.patch("/api/p2p/ads/{aid}")
def p2p_ad_status(aid: str, body: dict = Body(...), u: dict = Depends(money_user)):
    return p2p.set_ad_status(u, aid, body.get("status", ""))


@app.get("/api/p2p/my-ads")
def p2p_my_ads(u: dict = Depends(current_user)):
    return {"items": p2p.my_ads(u["id"])}


@app.get("/api/p2p/methods")
def p2p_my_methods(u: dict = Depends(current_user)):
    return {"items": p2p.my_methods(u["id"])}


@app.post("/api/p2p/methods")
def p2p_save_method(body: dict = Body(...), u: dict = Depends(current_user)):
    return p2p.save_method(u, body.get("method_id", ""), body.get("data") or {}, body.get("label"), body.get("id"))


@app.delete("/api/p2p/methods/{mid}")
def p2p_del_method(mid: int, u: dict = Depends(current_user)):
    p2p.delete_method(u, mid)
    return {"ok": True}


@app.post("/api/p2p/orders")
def p2p_order_create(body: dict = Body(...), u: dict = Depends(money_user)):
    return p2p.create_order(u, body.get("ad_id", ""), body.get("fiat_amount"), body.get("method_id"), body.get("user_method_id"), body.get("idem"))


@app.get("/api/p2p/orders")
def p2p_orders(status: str = "", u: dict = Depends(current_user)):
    return {"items": p2p.my_orders(u["id"], status or None)}


@app.get("/api/p2p/orders/{oid}")
def p2p_order(oid: str, u: dict = Depends(current_user)):
    return p2p.get_order(u, oid)


@app.post("/api/p2p/orders/{oid}/{action}")
def p2p_order_action(oid: str, action: str, body: dict = Body(default={}), u: dict = Depends(money_user)):
    if action == "paid":
        return p2p.mark_paid(u, oid)
    if action == "release":
        return p2p.release(u, oid, body.get("pin"), body.get("bio"))
    if action == "cancel":
        return p2p.cancel(u, oid, body.get("reason", ""))
    if action == "appeal":
        return p2p.appeal(u, oid, body.get("reason", ""), body.get("details", ""))
    if action == "review":
        return p2p.review(u, oid, bool(body.get("positive")), body.get("comment", ""))
    raise AppError("not_found", 404)


@app.get("/api/p2p/orders/{oid}/messages")
def p2p_messages(oid: str, after: int = 0, u: dict = Depends(current_user)):
    return {"items": p2p.messages(u, oid, after)}


@app.post("/api/p2p/orders/{oid}/messages")
def p2p_send(oid: str, body: dict = Body(...), u: dict = Depends(current_user)):
    limiter.check(f"chat:{u['id']}", 40)
    f = files.save(body["file"], "chat") if body.get("file") else None
    return p2p.send_message(u, oid, body.get("text"), f)


@app.get("/api/p2p/profile/{uid}")
def p2p_profile(uid: int, u: dict = Depends(current_user)):
    return p2p.profile(uid)


# ───────────────────────── support ─────────────────────────
@app.post("/api/ai/chat")
def ai_chat(body: dict = Body(...), u: dict = Depends(current_user)):
    limiter.check(f"ai:{u['id']}", 12)
    return support.chat(u, body.get("text", ""))


@app.get("/api/ai/history")
def ai_history(u: dict = Depends(current_user)):
    return {"items": support.history(u), "suggestions": support.suggestions(u), "name": settings.get("ai").get("name", "Zohra AI"),
            "ai": support.available()}


@app.delete("/api/ai/history")
def ai_clear(u: dict = Depends(current_user)):
    support.clear(u)
    return {"ok": True}


@app.get("/api/tickets")
def tickets(u: dict = Depends(current_user)):
    return {"items": support.user_tickets(u)}


@app.post("/api/tickets")
def ticket_new(body: dict = Body(...), u: dict = Depends(current_user)):
    limiter.check(f"ticket:{u['id']}", 6)
    tid = support.open_ticket(u, body.get("subject", "Support"), body.get("text", ""), body.get("category", "other"))
    if body.get("file"):
        db.x("UPDATE ticket_messages SET file=? WHERE id=(SELECT MAX(id) FROM ticket_messages WHERE ticket_id=?)", (files.save(body["file"], "tickets"), tid))
    return {"id": tid}


@app.get("/api/tickets/{tid}")
def ticket(tid: int, u: dict = Depends(current_user)):
    return support.ticket_thread(u, tid)


@app.post("/api/tickets/{tid}/reply")
def ticket_reply(tid: int, body: dict = Body(...), u: dict = Depends(current_user)):
    f = files.save(body["file"], "tickets") if body.get("file") else None
    return support.user_reply(u, tid, body.get("text", ""), f)


@app.post("/api/tickets/{tid}/rate")
def ticket_rate(tid: int, body: dict = Body(...), u: dict = Depends(current_user)):
    support.rate_ticket(u, tid, body.get("rating", 5))
    return {"ok": True}


@app.post("/api/forms")
def form_submit(body: dict = Body(...), u: dict = Depends(current_user)):
    limiter.check(f"form:{u['id']}", 6)
    return support.submit_form(u, body.get("kind", ""), body.get("data") or {})


@app.post("/api/kyc")
def kyc_submit(body: dict = Body(...), u: dict = Depends(current_user)):
    guard.feature("kyc")
    if db.one("SELECT 1 FROM kyc_requests WHERE user_id=? AND status='pending'", (u["id"],)):
        raise AppError("kyc_pending")
    paths = [files.save(f, "kyc", allow_pdf=True) for f in (body.get("files") or [])[:4]]
    if not paths:
        raise AppError("bad_request")
    data = {k: str(v)[:120] for k, v in (body.get("data") or {}).items() if k in ("full_name", "country", "doc_type", "doc_number", "birth_date")}
    db.insert("kyc_requests", {"user_id": u["id"], "level": 2, "data": data, "files": paths, "created_at": db.now()})
    from .notify import admin_alert

    admin_alert(f"New identity verification request from {users.display_name(u)}", "info", "kyc")
    return {"ok": True}


@app.get("/api/kyc")
def kyc_status(u: dict = Depends(current_user)):
    r = db.one("SELECT status, note, created_at FROM kyc_requests WHERE user_id=? ORDER BY id DESC LIMIT 1", (u["id"],))
    return {"level": u["kyc_level"], "request": r}


# ───────────────────────── notifications ─────────────────────────
@app.get("/api/notifications")
def notifications(u: dict = Depends(current_user)):
    return {"items": db.q("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50", (u["id"],))}


@app.post("/api/notifications/read")
def notifications_read(u: dict = Depends(current_user)):
    db.x("UPDATE notifications SET read=1 WHERE user_id=? AND read=0", (u["id"],))
    return {"ok": True}


@app.post("/api/upload")
def upload(body: dict = Body(...), u: dict = Depends(current_user)):
    limiter.check(f"upload:{u['id']}", 20)
    folder = body.get("folder", "chat")
    if folder not in ("chat", "tickets"):
        raise AppError("bad_request")
    return {"path": files.save(body.get("data", ""), folder)}


app.include_router(admin_api.router)
