"""User + admin notifications: in-app feed row and a localized bot message (queued in the outbox)."""
import html

from . import config, db, tg
from .bot_texts import t


def user_lang(user_id: int) -> str:
    return db.val("SELECT lang FROM users WHERE id=?", (user_id,), "en")


def notify(user_id: int, key: str, path: str = "", button: str | None = "open", in_app: bool = True,
           buttons: list | None = None, priority: int = 5, **params):
    lang = user_lang(user_id)
    safe = {k: html.escape(str(v)) if isinstance(v, str) else v for k, v in params.items()}
    text = t(lang, key, **safe)
    if in_app:
        title = text.split("\n", 1)[0]
        body = text.split("\n", 1)[1] if "\n" in text else ""
        import re

        strip = lambda s: re.sub(r"<[^>]+>", "", s)  # noqa: E731
        db.insert("notifications", {"user_id": user_id, "kind": key, "title": strip(title)[:200], "body": strip(body)[:500],
                                    "ref": path, "created_at": db.now()})
    if user_id <= 0:
        return
    dm_ok = db.val("SELECT dm_ok FROM users WHERE id=?", (user_id,), 1)
    if not dm_ok:
        return
    flags = db.jl(db.val("SELECT flags FROM users WHERE id=?", (user_id,), None)) or {}
    if flags.get("anti_phishing"):
        text = f"🔐 <b>{html.escape(flags['anti_phishing'])}</b>\n{text}"
    kb = buttons
    if kb is None and button and config.WEBAPP_URL:
        kb = [[tg.webapp_button(t(lang, button), path)]]
    tg.send(user_id, text, kb, priority=priority)


def admin_alert(text: str, level: str = "info", kind: str = "system"):
    db.insert("alerts", {"level": level, "kind": kind, "text": text[:2000], "created_at": db.now()})
    from . import settings

    if not settings.get("notifications").get("admin_alerts", True):
        return
    icon = {"info": "ℹ️", "warn": "⚠️", "error": "🚨", "money": "💰"}.get(level, "ℹ️")
    targets = [config.ADMIN_CHANNEL_ID] if config.ADMIN_CHANNEL_ID else config.OWNER_IDS
    for chat in targets:
        tg.send(chat, f"{icon} {html.escape(text)}", priority=2)
