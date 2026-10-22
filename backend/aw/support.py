"""Zohra AI — the in-app support assistant, tickets with human hand-off, forms, and dispute summaries.

The assistant runs on Claude with read-only tools scoped to the asking user (balances, transactions, deposit info,
on-chain tx checker, withdrawal status, fees, P2P orders) plus `create_ticket` to escalate to a human. It can never
move money. Without an API key, a deterministic FAQ engine answers the common questions and offers escalation.
"""
import json
import logging
import re

from . import catalog, config, db, deposits, fees, guard, ledger, p2p, settings, users
from .money import AppError, s
from .notify import admin_alert, notify

log = logging.getLogger("aw.support")

SYSTEM = """You are {name}, the support assistant inside ZOHRA WALLET — a custodial multi-network crypto wallet that runs as a Telegram Mini App.

What ZOHRA WALLET offers: deposits and withdrawals on TRON (TRC20), TON, BNB Smart Chain (BEP20), Ethereum (ERC20), Solana, Polygon, Arbitrum One, Base, Bitcoin and Avalanche C-Chain; one deposit address shared by all EVM networks; TON deposits use the hot-wallet address plus the user's personal numeric memo (a deposit without the right memo cannot be matched automatically and must be assigned by staff); instant free internal transfers by @username or Telegram contact; gift links that can be locked to one person; instant swaps at a firm quoted rate (the platform margin is built into the rate); a P2P marketplace with escrow, payment windows and appeals; referral commissions; fee-free reward vouchers; VIP fee tiers by 30-day volume; a 6-digit PIN for sensitive actions; phone verification for higher limits; TON Connect.

How you work:
- Use the tools to look at this user's real data before answering anything about their money. Never guess balances, statuses or fees.
- For "my deposit hasn't arrived": ask for (or find) the network and transaction hash, then call check_deposit_tx. Explain confirmations, minimum deposit, wrong network, and missing TON memo cases precisely.
- You cannot move funds, reverse transactions, change limits or unlock accounts. When staff action is needed (missing memo, wrong network, stuck withdrawal, account restriction, P2P dispute, bug), call create_ticket with a precise summary, then tell the user a human will reply here and in the bot chat.
- Never ask for or accept a PIN, seed phrase, private key or verification code. If a user shares one, tell them to change it.
- Be warm, short and concrete. Use numbered steps for instructions. Reply in the user's language: {lang_name}.
{extra}"""

LANG_NAMES = {"en": "English", "ar": "Arabic", "ru": "Russian", "tr": "Turkish", "fa": "Persian", "fr": "French", "es": "Spanish",
              "pt": "Portuguese", "de": "German", "id": "Indonesian", "hi": "Hindi", "zh": "Chinese (Simplified)", "uk": "Ukrainian", "uz": "Uzbek"}

TOOLS = [
    {"name": "get_account_overview", "description": "The user's balances, verification level, limits, VIP tier and security status.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "get_recent_transactions", "description": "The user's latest activity (deposits, withdrawals, transfers, swaps, P2P, gifts).",
     "input_schema": {"type": "object", "properties": {"type": {"type": "string", "description": "Optional filter: deposit, withdraw, send, receive, swap, p2p_buy, p2p_sell, gift_out, gift_in"},
                                                       "limit": {"type": "integer"}}, "additionalProperties": False}},
    {"name": "get_transaction", "description": "One transaction by its AW reference (e.g. AW7K2M9QX or WD...).",
     "input_schema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"], "additionalProperties": False}},
    {"name": "get_deposit_info", "description": "Deposit address/memo, minimum deposit and confirmations for an asset on a network.",
     "input_schema": {"type": "object", "properties": {"network": {"type": "string", "description": "tron, ton, bsc, eth, sol, polygon, arbitrum, base, btc, avax"},
                                                       "asset": {"type": "string"}}, "required": ["network"], "additionalProperties": False}},
    {"name": "check_deposit_tx", "description": "Look up a transaction hash on-chain and credit it if it is a valid deposit to this user.",
     "input_schema": {"type": "object", "properties": {"network": {"type": "string"}, "txid": {"type": "string"}}, "required": ["network", "txid"], "additionalProperties": False}},
    {"name": "get_fee_schedule", "description": "Current fees for this user: withdrawal fees per asset/network, swap spread, transfer, P2P, VIP discounts.",
     "input_schema": {"type": "object", "properties": {"asset": {"type": "string"}}, "additionalProperties": False}},
    {"name": "get_p2p_orders", "description": "The user's P2P orders (active and recent) or one order by id.",
     "input_schema": {"type": "object", "properties": {"id": {"type": "string"}}, "additionalProperties": False}},
    {"name": "get_known_issues", "description": "Known incidents / network maintenance announced by the team.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "create_ticket", "description": "Escalate to a human agent. Use when staff action is required or the user asks for a human.",
     "input_schema": {"type": "object", "properties": {"subject": {"type": "string"}, "summary": {"type": "string"},
                                                       "category": {"type": "string", "enum": ["deposit", "withdrawal", "p2p", "account", "swap", "bug", "other"]},
                                                       "priority": {"type": "string", "enum": ["low", "normal", "high"]}},
                      "required": ["subject", "summary", "category"], "additionalProperties": False}},
]


def _tool(user: dict, name: str, args: dict) -> dict:
    uid = user["id"]
    if name == "get_account_overview":
        bals = {a: {"available": s(v["available"]), "locked": s(v["locked"])} for a, v in ledger.balances(uid).items() if v["available"] or v["locked"]}
        tier = fees.vip(user)
        return {"balances": bals, "kyc_level": user["kyc_level"], "phone_verified": bool(user.get("phone_hash")),
                "status": user["status"], "pin_set": bool(user.get("pin_hash")), "security_hold_until": user.get("security_hold_until") or 0,
                "limits": guard.usage(user), "vip": {"level": tier["level"], "name": tier["name"], "discount_pct": s(tier["discount_pct"])}}
    if name == "get_recent_transactions":
        lim = max(1, min(int(args.get("limit") or 10), 25))
        q, p = "SELECT id,type,status,asset,amount,fee,asset2,amount2,network,txid,created_at FROM txs WHERE user_id=?", [uid]
        if args.get("type"):
            q += " AND type=?"
            p.append(args["type"])
        return {"items": db.q(q + " ORDER BY created_at DESC LIMIT ?", (*p, lim))}
    if name == "get_transaction":
        t = db.one("SELECT * FROM txs WHERE id=? AND user_id=?", (args.get("id", "").upper(), uid))
        if not t:
            return {"error": "not found"}
        w = db.one("SELECT status, risk, error, txid FROM withdrawals WHERE id=?", (t["id"],))
        t["withdrawal"] = w
        t["meta"] = db.jl(t.get("meta"))
        return t
    if name == "get_deposit_info":
        net = catalog.network(args.get("network", ""))
        if not net:
            return {"error": "unknown network"}
        info = deposits.get_address(user, net["id"])
        an = catalog.asset_network((args.get("asset") or net["native_asset"]).upper(), net["id"])
        info.update({"confirmations": net["confirmations"], "deposit_enabled": bool(net["deposit_enabled"]),
                     "min_deposit": an["min_deposit"] if an else None, "token_contract": an["contract"] if an else None})
        return info
    if name == "check_deposit_tx":
        try:
            return deposits.verify_tx(user, args.get("network", ""), args.get("txid", ""))
        except AppError as e:
            return {"error": e.code}
    if name == "get_fee_schedule":
        sch = fees.schedule_for_user(user)
        if args.get("asset"):
            sch["withdraw"] = [w for w in sch["withdraw"] if w["asset"] == args["asset"].upper()]
        else:
            sch["withdraw"] = sch["withdraw"][:25]
        return sch
    if name == "get_p2p_orders":
        if args.get("id"):
            try:
                return p2p.get_order(user, args["id"].upper())
            except AppError as e:
                return {"error": e.code}
        return {"orders": p2p.my_orders(uid)[:10]}
    if name == "get_known_issues":
        return {"issues": settings.get("ai").get("known_issues", []), "announcement": settings.get("general").get("announcement")}
    if name == "create_ticket":
        tid = open_ticket(user, args.get("subject", "Support"), args.get("summary", ""), args.get("category", "other"),
                          args.get("priority", "normal"), sender="ai")
        return {"ticket_id": tid, "status": "waiting_admin"}
    return {"error": "unknown tool"}


def _client():
    import anthropic

    return anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY, max_retries=2, timeout=90)


def chat(user: dict, text: str) -> dict:
    guard.feature("ai")
    text = (text or "").strip()[:2000]
    if not text:
        raise AppError("bad_request")
    cfg = settings.get("ai")
    today = db.now() - 86400
    if db.val("SELECT COUNT(*) FROM ai_messages WHERE user_id=? AND role='user' AND created_at>?", (user["id"], today), 0) >= int(cfg.get("daily_messages", 60)):
        raise AppError("ai_daily_limit")
    db.insert("ai_messages", {"user_id": user["id"], "role": "user", "content": json.dumps(text), "created_at": db.now()})
    if not config.ANTHROPIC_API_KEY:
        reply, actions = _faq(user, text)
    else:
        try:
            reply, actions = _claude(user, cfg)
        except Exception as e:
            log.warning("AI failed: %s", e)
            reply, actions = _faq(user, text)
    db.insert("ai_messages", {"user_id": user["id"], "role": "assistant", "content": json.dumps(reply), "created_at": db.now()})
    return {"reply": reply, "actions": actions, "suggestions": suggestions(user)}


def _history(user_id: int, limit: int = 16) -> list[dict]:
    rows = db.q("SELECT role, content FROM ai_messages WHERE user_id=? ORDER BY id DESC LIMIT ?", (user_id, limit))[::-1]
    msgs = []
    for r in rows:
        content = json.loads(r["content"])
        if msgs and msgs[-1]["role"] == r["role"]:
            msgs[-1]["content"] += "\n" + content
        else:
            msgs.append({"role": r["role"], "content": content})
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    return msgs


def _claude(user: dict, cfg: dict) -> tuple[str, list]:
    client = _client()
    lang = user.get("lang") or "en"
    system = SYSTEM.format(name=cfg.get("name", "Zohra AI"), lang_name=LANG_NAMES.get(lang, "English"),
                           extra=("\nTeam instructions:\n" + cfg["extra_instructions"]) if cfg.get("extra_instructions") else "")
    messages = _history(user["id"])
    actions: list = []
    model = cfg.get("model") or config.AI_MODEL
    for _ in range(6):
        resp = client.beta.messages.create(
            model=model,
            max_tokens=4000,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            tools=TOOLS,
            messages=messages,
            output_config={"effort": cfg.get("effort", "medium")},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        if resp.stop_reason == "refusal":
            return _faq(user, messages[-1]["content"] if isinstance(messages[-1]["content"], str) else "")
        if resp.stop_reason != "tool_use":
            text = "\n".join(b.text for b in resp.content if b.type == "text").strip()
            return text or "…", actions
        messages.append({"role": "assistant", "content": resp.content})
        results = []
        for b in resp.content:
            if b.type != "tool_use":
                continue
            try:
                out = _tool(user, b.name, dict(b.input or {}))
                if b.name == "create_ticket":
                    actions.append({"type": "ticket", "id": out.get("ticket_id")})
                if b.name == "check_deposit_tx":
                    actions.append({"type": "deposit_check", "status": out.get("status")})
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": json.dumps(out, default=str)[:12000]})
            except Exception as e:
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": f"error: {e}", "is_error": True})
        messages.append({"role": "user", "content": results})
    return "…", actions


# ───────────── deterministic fallback (no API key / outage) ─────────────
FAQ = {
    "deposit": {"en": "To deposit: open Deposit → choose the coin → choose the network → copy the address (and memo for TON). Deposits are credited after the network confirmations shown on that screen. If yours hasn't arrived, paste the transaction hash in Deposit → “Check my transaction”.",
                "ar": "للإيداع: افتح «إيداع» ← اختر العملة ← اختر الشبكة ← انسخ العنوان (والمذكرة Memo لشبكة TON). يُضاف الإيداع بعد عدد التأكيدات الظاهر في الصفحة. إن لم يصل، الصق رمز المعاملة (Hash) في «إيداع» ← «تحقق من معاملتي»."},
    "withdraw": {"en": "Withdrawals are usually sent within minutes. Large or first withdrawals get a short security review. You can follow the status in History; each withdrawal shows its blockchain link once sent.",
                 "ar": "تُرسل عمليات السحب عادة خلال دقائق. السحوبات الكبيرة أو الأولى تمر بمراجعة أمنية قصيرة. تابع الحالة من «السجل»؛ ويظهر رابط المعاملة على الشبكة فور الإرسال."},
    "fees": {"en": "Internal transfers and gifts are free. Swaps include a small margin in the rate. Withdrawal fees cover the network cost and are shown before you confirm. VIP tiers and reward vouchers reduce fees.",
             "ar": "التحويلات الداخلية والهدايا مجانية. يتضمن سعر التبديل هامشًا صغيرًا. رسوم السحب تغطي تكلفة الشبكة وتظهر قبل التأكيد. مستويات VIP وقسائم المكافآت تخفّض الرسوم."},
    "swap": {"en": "Open Swap, pick the two coins and the amount. You get a firm rate for a few seconds — confirm before it refreshes. There's no slippage and no network fee.",
             "ar": "افتح «تبديل» واختر العملتين والمبلغ. تحصل على سعر ثابت لثوانٍ — أكّد قبل تحديثه. لا يوجد انزلاق سعري ولا رسوم شبكة."},
    "p2p": {"en": "In P2P you trade with other users. The seller's crypto is held in escrow until they confirm receiving your payment. Never release crypto before the money is in your account, and keep all communication in the order chat.",
            "ar": "في P2P تتداول مع مستخدمين آخرين. تُحجز عملة البائع في الضمان حتى يؤكد استلام دفعتك. لا تحرّر العملة قبل وصول المال إلى حسابك، وأبقِ كل التواصل في محادثة الطلب."},
    "human": {"en": "I've opened a ticket for our team. A human agent will reply here and in the bot chat.",
              "ar": "فتحت طلبًا لفريق الدعم. سيرد عليك موظف هنا وفي محادثة البوت."},
    "default": {"en": "I can help with deposits, withdrawals, swaps, P2P, fees and your account. Choose a suggestion below or describe the problem — or ask to talk to a human.",
                "ar": "يمكنني مساعدتك في الإيداع والسحب والتبديل وP2P والرسوم وحسابك. اختر اقتراحًا بالأسفل أو صف المشكلة — أو اطلب التحدث مع موظف."},
}
KEYWORDS = [
    ("human", r"human|agent|operator|موظف|بشري|شخص حقيقي|оператор|человек|insan|temsilci"),
    ("deposit", r"deposit|arriv|receive|إيداع|ايداع|وصل|пополн|депозит|yatır"),
    ("withdraw", r"withdraw|سحب|вывод|çek"),
    ("fees", r"fee|commission|رسوم|عمولة|комисс|ücret"),
    ("swap", r"swap|convert|exchange|تبديل|تحويل عملة|обмен|takas"),
    ("p2p", r"p2p|escrow|buyer|seller|بائع|مشتري|ضمان"),
]


def _faq(user: dict, text: str) -> tuple[str, list]:
    lang = user.get("lang") or "en"
    key = "default"
    for k, pat in KEYWORDS:
        if re.search(pat, text or "", re.I):
            key = k
            break
    actions = []
    if key == "human":
        tid = open_ticket(user, "Support request", text, "other", "normal", sender="user")
        actions.append({"type": "ticket", "id": tid})
    for ki in settings.get("ai").get("known_issues", []):
        title = (ki.get("title") or {}).get(lang) or (ki.get("title") or {}).get("en") or ""
        if title and title.lower() in (text or "").lower():
            return (ki.get("answer") or {}).get(lang) or (ki.get("answer") or {}).get("en") or "", actions
    t = FAQ[key]
    return t.get(lang) or t["en"], actions


def suggestions(user: dict) -> list[dict]:
    lang = user.get("lang") or "en"
    out = []
    pending = db.one("SELECT id, type, asset, amount FROM txs WHERE user_id=? AND status IN ('pending','processing') ORDER BY created_at DESC LIMIT 1", (user["id"],))
    if pending:
        out.append({"key": "pending_tx", "text": f"{pending['type']} {pending['amount']} {pending['asset']} — {pending['id']}?"})
    for s_ in settings.get("ai").get("suggestions", []):
        t = s_.get("text") or {}
        out.append({"key": s_.get("key"), "text": t.get(lang) or t.get("en") or s_.get("key")})
    for ki in settings.get("ai").get("known_issues", [])[:3]:
        t = ki.get("title") or {}
        out.append({"key": "issue", "text": t.get(lang) or t.get("en")})
    return [x for x in out if x.get("text")][:10]


def history(user: dict, limit: int = 60) -> list[dict]:
    rows = db.q("SELECT role, content, created_at FROM ai_messages WHERE user_id=? ORDER BY id DESC LIMIT ?", (user["id"], limit))[::-1]
    return [{"role": r["role"], "text": json.loads(r["content"]), "at": r["created_at"]} for r in rows]


def clear(user: dict):
    db.x("DELETE FROM ai_messages WHERE user_id=?", (user["id"],))


# ───────────── tickets ─────────────
def open_ticket(user: dict, subject: str, text: str, category: str = "other", priority: str = "normal", sender: str = "user", ref: str | None = None) -> int:
    existing = db.one("SELECT id FROM tickets WHERE user_id=? AND status IN ('open','waiting_admin') AND category=? ORDER BY id DESC LIMIT 1",
                      (user["id"], category))
    if existing:
        tid = existing["id"]
    else:
        tid = db.insert("tickets", {"user_id": user["id"], "subject": (subject or "Support")[:120], "category": category[:20],
                                    "status": "waiting_admin", "priority": priority if priority in ("low", "normal", "high") else "normal",
                                    "ref": ref, "created_at": db.now(), "updated_at": db.now()})
        admin_alert(f"New support ticket #{tid} ({category}, {priority}) from {users.display_name(user)}: {subject}", "info", "support")
    db.insert("ticket_messages", {"ticket_id": tid, "sender": sender, "sender_id": user["id"] if sender == "user" else None,
                                  "text": (text or "")[:4000], "created_at": db.now()})
    db.x("UPDATE tickets SET status='waiting_admin', updated_at=? WHERE id=?", (db.now(), tid))
    return tid


def user_tickets(user: dict) -> list[dict]:
    return db.q("SELECT * FROM tickets WHERE user_id=? ORDER BY updated_at DESC LIMIT 30", (user["id"],))


def ticket_thread(user: dict | None, tid: int, admin: bool = False) -> dict:
    t = db.one("SELECT * FROM tickets WHERE id=?", (tid,))
    if not t or (not admin and t["user_id"] != user["id"]):
        raise AppError("not_found", 404)
    t["messages"] = db.q("SELECT sender, text, file, created_at FROM ticket_messages WHERE ticket_id=? ORDER BY id", (tid,))
    return t


def user_reply(user: dict, tid: int, text: str, file: str | None = None) -> dict:
    t = ticket_thread(user, tid)
    if t["status"] == "closed":
        db.x("UPDATE tickets SET status='waiting_admin' WHERE id=?", (tid,))
    db.insert("ticket_messages", {"ticket_id": tid, "sender": "user", "sender_id": user["id"], "text": (text or "")[:4000], "file": file,
                                  "created_at": db.now()})
    db.x("UPDATE tickets SET status='waiting_admin', updated_at=? WHERE id=?", (db.now(), tid))
    return {"ok": True}


def admin_reply(admin_id: int, tid: int, text: str, close: bool = False) -> dict:
    t = db.one("SELECT * FROM tickets WHERE id=?", (tid,))
    if not t:
        raise AppError("not_found", 404)
    db.insert("ticket_messages", {"ticket_id": tid, "sender": "admin", "sender_id": admin_id, "text": text[:4000], "created_at": db.now()})
    db.x("UPDATE tickets SET status=?, assigned=COALESCE(assigned, ?), updated_at=? WHERE id=?", ("closed" if close else "answered", admin_id, db.now(), tid))
    notify(t["user_id"], "ticket_reply", path=f"/support/ticket/{tid}", id=tid, text=text[:600])
    return {"ok": True}


def rate_ticket(user: dict, tid: int, rating: int):
    db.x("UPDATE tickets SET rating=? WHERE id=? AND user_id=?", (max(1, min(5, int(rating))), tid, user["id"]))


# ───────────── forms (suggest a payment method, listing request, feedback, report) ─────────────
FORM_KINDS = {"payment_method": ["name", "country", "currency", "link", "note"], "listing": ["coin", "network", "contract", "link", "note"],
              "feedback": ["topic", "message"], "report": ["topic", "message", "ref"], "kyc": ["full_name", "country", "document"]}


def submit_form(user: dict, kind: str, data: dict) -> dict:
    if kind not in FORM_KINDS:
        raise AppError("bad_request")
    clean = {k: str(data.get(k, ""))[:500] for k in FORM_KINDS[kind] if str(data.get(k, "")).strip()}
    if not clean:
        raise AppError("bad_request")
    fid = db.insert("forms", {"user_id": user["id"], "kind": kind, "data": clean, "created_at": db.now()})
    admin_alert(f"New form ({kind}) #{fid} from {users.display_name(user)}", "info", "forms")
    return {"id": fid}


# ───────────── dispute assistant for arbiters ─────────────
def summarize_dispute(order_id: str) -> str | None:
    if not config.ANTHROPIC_API_KEY:
        return None
    o = db.one("SELECT * FROM p2p_orders WHERE id=?", (order_id,))
    if not o:
        return None
    msgs = db.q("SELECT sender_id, text, file, created_at FROM p2p_messages WHERE order_id=? ORDER BY id", (order_id,))
    d = db.one("SELECT * FROM p2p_disputes WHERE order_id=?", (order_id,))
    role = {o["buyer_id"]: "BUYER", o["seller_id"]: "SELLER", 0: "SYSTEM", -1: "ARBITER"}
    transcript = "\n".join(f"[{m['created_at']}] {role.get(m['sender_id'], '?')}: {m['text'] or ''}{' [attachment]' if m['file'] else ''}" for m in msgs)
    prompt = (f"P2P order {order_id}: buyer pays {o['fiat_amount']} {o['fiat']} for {o['amount']} {o['asset']}. "
              f"Created {o['created_at']}, marked paid at {o['paid_at']}. Appeal by {'BUYER' if d and d['opened_by'] == o['buyer_id'] else 'SELLER'}: "
              f"{(d or {}).get('reason')} — {(d or {}).get('details')}\n\nChat transcript:\n{transcript}\n\n"
              "Write a neutral brief for the human arbiter: timeline, each side's claims, evidence present or missing, red flags, "
              "and what proof to request from each party. Do not decide the case.")
    try:
        resp = _client().beta.messages.create(model=settings.get("ai").get("model") or config.AI_MODEL, max_tokens=3000,
                                              messages=[{"role": "user", "content": prompt}], output_config={"effort": "medium"},
                                              betas=["server-side-fallback-2026-07-01"], fallbacks="default")
        if resp.stop_reason == "refusal":
            return None
        text = "\n".join(b.text for b in resp.content if b.type == "text").strip()
    except Exception as e:
        log.warning("dispute summary failed: %s", e)
        return None
    db.x("UPDATE p2p_disputes SET ai_summary=? WHERE order_id=?", (text[:6000], order_id))
    return text

