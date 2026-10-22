"""Telegram webhook handler: /start (referrals & deep links), native contact picker results, phone verification,
admin login links. Everything else happens inside the Mini App."""
import logging

from . import admin_auth, config, db, gifts, tg, users
from .bot_texts import t
from .money import AppError

log = logging.getLogger("aw.bot")


def _open_kb(lang: str, path: str = "") -> dict:
    return {"inline_keyboard": [[tg.webapp_button("🚀 " + t(lang, "open"), path)]]}


def _send(chat_id: int, text: str, markup: dict | None = None):
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "link_preview_options": {"is_disabled": True}}
    if markup:
        payload["reply_markup"] = markup
    tg.queue("sendMessage", payload, priority=1)


def handle(update: dict):
    try:
        if "message" in update:
            _message(update["message"])
        elif "my_chat_member" in update:
            m = update["my_chat_member"]
            if m.get("chat", {}).get("type") == "private":
                blocked = m.get("new_chat_member", {}).get("status") == "kicked"
                db.x("UPDATE users SET dm_ok=? WHERE id=?", (0 if blocked else 1, m["from"]["id"]))
    except AppError as e:
        log.info("bot handled error: %s", e.code)
    except Exception:
        log.exception("bot update failed")


def _message(msg: dict):
    chat = msg.get("chat", {})
    frm = msg.get("from") or {}
    if chat.get("type") != "private" or frm.get("is_bot"):
        return
    uid = frm["id"]
    text = (msg.get("text") or "").strip()
    if text.startswith("/start"):
        payload = text.split(maxsplit=1)[1] if " " in text else ""
        user, _created = users.upsert_from_telegram(frm, start_param=payload if payload.startswith("ref_") else None)
        db.x("UPDATE users SET dm_ok=1 WHERE id=?", (uid,))
        lang = user.get("lang") or "en"
        path = ""
        if payload.startswith("g_"):
            path = f"/gift/{payload[2:]}"
        _send(uid, t(lang, "welcome", name=_esc(users.display_name(user))), _open_kb(lang, path))
        return
    user = users.get(uid)
    if not user:
        user, _ = users.upsert_from_telegram(frm)
    lang = user.get("lang") or "en"
    if msg.get("users_shared"):
        sh = msg["users_shared"]
        picked = gifts.on_users_shared(uid, int(sh.get("request_id", 0)), sh.get("users") or [])
        if picked:
            _send(uid, t(lang, "pick_contact_done", name=_esc(picked["name"])), {"remove_keyboard": True})
            _send(uid, "👇", {"inline_keyboard": [[tg.webapp_button("➡️ " + t(lang, "continue"), f"/send?pick={sh.get('request_id')}")]]})
        return
    if msg.get("contact"):
        c = msg["contact"]
        if int(c.get("user_id") or 0) != uid:
            _send(uid, t(lang, "phone_bad"), {"remove_keyboard": True})
            return
        try:
            users.verify_phone(uid, c.get("phone_number", ""))
            _send(uid, t(lang, "phone_ok"), {"remove_keyboard": True})
            _send(uid, "👇", _open_kb(lang, "/settings/security"))
        except AppError as e:
            _send(uid, t(lang, "phone_used" if e.code == "phone_used" else "phone_bad"), {"remove_keyboard": True})
        return
    if text in ("/phone", "/verify"):
        ask_phone(uid, lang)
        return
    if text.startswith("/admin"):
        if not admin_auth.role_of(uid):
            _send(uid, t(lang, "not_admin"))
            return
        link = admin_auth.issue_login_link(uid)
        _send(uid, t(lang, "admin_login"), {"inline_keyboard": [[{"text": "🛠 " + t(lang, "admin_open"), "url": link}],
                                                                 [{"text": "📱 Telegram", "web_app": {"url": f"{config.WEBAPP_URL}/admin/"}}]]})
        return
    _send(uid, t(lang, "help"), _open_kb(lang))


def ask_phone(uid: int, lang: str):
    _send(uid, t(lang, "phone_prompt"), {"keyboard": [[{"text": t(lang, "phone_btn"), "request_contact": True}]],
                                         "resize_keyboard": True, "one_time_keyboard": True})


def _esc(s: str) -> str:
    import html

    return html.escape(s or "")


def sync_profile(force: bool = False) -> bool:
    """Push the bot name / descriptions (per language) to Telegram — only when they changed, Telegram rate-limits these calls."""
    import hashlib
    import json

    from . import settings
    from .chains.base import state_get, state_set

    b = settings.get("bot")
    langs = ["en", "ar", "ru", "tr", "fa", "fr", "es", "pt", "de", "id", "hi", "zh", "uk", "uz"]
    digest = hashlib.sha256(json.dumps(b, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    if not force and state_get("bot:profile", "") == digest:
        return False
    pick = lambda d, lang: (d or {}).get(lang) or ""  # noqa: E731
    for lang in langs:
        lc = {} if lang == "en" else {"language_code": lang}
        desc, short = pick(b.get("description"), lang), pick(b.get("short_description"), lang)
        if lang == "en" or desc:
            tg.call("setMyDescription", {"description": desc[:512], **lc})
        if lang == "en" or short:
            tg.call("setMyShortDescription", {"short_description": short[:120], **lc})
    tg.call("setMyName", {"name": (b.get("name") or "Zohra Wallet")[:64]})
    state_set("bot:profile", digest)
    return True


def setup_webhook() -> dict:
    """Register webhook, commands and the menu button (called at startup)."""
    if not config.BOT_TOKEN or not config.WEBAPP_URL:
        return {"ok": False}
    res = tg.call("setWebhook", {"url": f"{config.WEBAPP_URL}/api/tg/webhook", "secret_token": config.WEBHOOK_SECRET,
                                 "allowed_updates": ["message", "my_chat_member"], "drop_pending_updates": False})
    tg.call("setChatMenuButton", {"menu_button": {"type": "web_app", "text": "Zohra Wallet", "web_app": {"url": config.WEBAPP_URL}}})
    for lang in ["en", "ar", "ru", "tr", "fa", "fr", "es", "pt", "de", "id", "hi", "zh", "uk", "uz"]:
        cmds = [{"command": "start", "description": t(lang, "open")}, {"command": "phone", "description": t(lang, "phone_btn").replace("📱 ", "")}]
        payload = {"commands": cmds}
        if lang != "en":
            payload["language_code"] = lang
        tg.call("setMyCommands", payload)
    sync_profile()
    me = tg.call("getMe")
    if me.get("ok") and not config.BOT_USERNAME:
        config.BOT_USERNAME = me["result"]["username"]
    return res
