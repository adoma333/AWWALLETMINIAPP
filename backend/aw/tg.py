"""Telegram Bot API client + durable outbox (messages survive restarts and are retried with backoff)."""
import json
import logging
import time

import httpx

from . import config, db

log = logging.getLogger("aw.tg")
API = "https://api.telegram.org"


def call(method: str, payload: dict | None = None, timeout: float = 15) -> dict:
    if not config.BOT_TOKEN:
        return {"ok": False, "description": "no bot token"}
    try:
        r = httpx.post(f"{API}/bot{config.BOT_TOKEN}/{method}", json=payload or {}, timeout=timeout)
        return r.json()
    except Exception as e:  # network problems are reported, never raised
        return {"ok": False, "description": str(e)}


def queue(method: str, payload: dict, priority: int = 5, broadcast_id: int | None = None):
    db.insert("outbox", {"method": method, "payload": payload, "priority": priority, "broadcast_id": broadcast_id,
                         "created_at": db.now(), "next_at": 0})


def send(chat_id: int | str, text: str, buttons: list | None = None, priority: int = 5, **extra):
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "link_preview_options": {"is_disabled": True}, **extra}
    if buttons:
        payload["reply_markup"] = {"inline_keyboard": buttons}
    queue("sendMessage", payload, priority)


def flush(max_items: int = 25) -> int:
    """Deliver queued messages (called by the worker ~every second). Respects Telegram's ~30 msg/s limit."""
    now = db.now()
    rows = db.q("SELECT * FROM outbox WHERE status='queued' AND next_at<=? ORDER BY priority, id LIMIT ?", (now, max_items))
    sent = 0
    for r in rows:
        payload = json.loads(r["payload"])
        res = call(r["method"], payload)
        if res.get("ok"):
            db.x("UPDATE outbox SET status='sent', attempts=attempts+1 WHERE id=?", (r["id"],))
            if r["broadcast_id"]:
                db.x("UPDATE broadcasts SET sent=sent+1 WHERE id=?", (r["broadcast_id"],))
            sent += 1
        else:
            code = res.get("error_code")
            desc = str(res.get("description", ""))[:300]
            retry_after = (res.get("parameters") or {}).get("retry_after")
            permanent = code in (400, 403) and not retry_after
            if code == 403 and payload.get("chat_id"):
                db.x("UPDATE users SET dm_ok=0 WHERE id=?", (payload["chat_id"],))
            attempts = r["attempts"] + 1
            if permanent or attempts >= 6:
                db.x("UPDATE outbox SET status='failed', attempts=?, error=? WHERE id=?", (attempts, desc, r["id"]))
                if r["broadcast_id"]:
                    db.x("UPDATE broadcasts SET failed=failed+1 WHERE id=?", (r["broadcast_id"],))
            else:
                delay = int(retry_after or min(600, 5 * 2 ** attempts))
                db.x("UPDATE outbox SET attempts=?, next_at=?, error=? WHERE id=?", (attempts, now + delay, desc, r["id"]))
                if retry_after:
                    time.sleep(min(float(retry_after), 5))
                    break
        time.sleep(0.035)
    db.x("DELETE FROM outbox WHERE status='sent' AND created_at < ?", (now - 3 * 86400,))
    return sent


def webapp_button(text: str, path: str = "") -> dict:
    url = config.WEBAPP_URL + (("/#" + path) if path else "")
    return {"text": text, "web_app": {"url": url}}


def startapp_link(param: str = "") -> str:
    if not config.BOT_USERNAME:
        return config.WEBAPP_URL
    return f"https://t.me/{config.BOT_USERNAME}?startapp={param}" if param else f"https://t.me/{config.BOT_USERNAME}"
