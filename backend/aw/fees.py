"""Fee engine — how large wallets/exchanges price their services, fully controlled from the admin panel.

Resolution for a fee kind (swap | withdraw | transfer | gift | p2p_maker | p2p_taker):
  1. base rule: the most specific active fee_rule wins
       user  >  role  >  pair  >  asset_network  >  network  >  asset  >  global
     (withdraw also starts from the per asset/network fee table — the network cost the user pays)
  2. VIP discount: 30-day volume puts the user on a tier (Standard → Diamond) with a % discount
  3. promotions: time-boxed campaigns (e.g. "zero fees on USDT this weekend") — discount up to 100 %
  4. vouchers: the user's best personal reward (fee-free / % off) is applied automatically and consumed
     only when the operation succeeds.
Fixed fees in fee_rules are expressed in USD and converted at the live price; withdraw fees in the asset table are in
asset units. Every fee earned is written to `revenue` (and drives referral commissions).
"""
import time
from decimal import Decimal

from . import db, prices
from .money import ZERO, D, q_up, s

PRECEDENCE = ["user", "role", "pair", "asset_network", "network", "asset", "global"]


def _active(r: dict, now: int) -> bool:
    return bool(r["active"]) and (not r["starts_at"] or r["starts_at"] <= now) and (not r["ends_at"] or r["ends_at"] > now)


def rule_for(kind: str, user: dict | None = None, asset: str | None = None, network: str | None = None,
             pair: str | None = None) -> dict | None:
    now = int(time.time())
    rules = [r for r in db.q("SELECT * FROM fee_rules WHERE kind=?", (kind,)) if _active(r, now)]
    keys = {
        "user": str(user["id"]) if user else None,
        "role": user.get("role") if user else None,
        "pair": pair,
        "asset_network": f"{asset}:{network}" if asset and network else None,
        "network": network,
        "asset": asset,
        "global": None,
    }
    for scope in PRECEDENCE:
        want = keys[scope]
        if scope != "global" and not want:
            continue
        for r in rules:
            if r["scope"] == scope and (scope == "global" or (r["scope_id"] or "") == want):
                return r
    return None


def volume_30d(user_id: int) -> Decimal:
    since = db.now() - 30 * 86400
    v = ZERO
    for r in db.q("SELECT volume_usd FROM swaps WHERE user_id=? AND created_at>=?", (user_id, since)):
        v += D(r["volume_usd"])
    for r in db.q("SELECT asset, amount FROM p2p_orders WHERE (buyer_id=? OR seller_id=?) AND status='completed' AND done_at>=?",
                  (user_id, user_id, since)):
        v += prices.to_usd(r["asset"], r["amount"])
    return v


def vip(user: dict) -> dict:
    tiers = db.q("SELECT * FROM vip_tiers ORDER BY level")
    forced = (user.get("flags") or {}).get("vip_level") if isinstance(user.get("flags"), dict) else None
    vol = volume_30d(user["id"])
    cur = tiers[0] if tiers else {"level": 0, "name": "Standard", "fee_discount_pct": "0", "limit_multiplier": "1", "min_volume_usd": "0"}
    for t in tiers:
        if vol >= D(t["min_volume_usd"]):
            cur = t
    if forced is not None:
        cur = next((t for t in tiers if t["level"] == int(forced)), cur)
    nxt = next((t for t in tiers if t["level"] == cur["level"] + 1), None)
    return {"level": cur["level"], "name": cur["name"], "discount_pct": D(cur["fee_discount_pct"]),
            "limit_multiplier": D(cur.get("limit_multiplier") or 1), "volume_30d": vol,
            "next": ({"level": nxt["level"], "name": nxt["name"], "min_volume_usd": D(nxt["min_volume_usd"]),
                      "discount_pct": D(nxt["fee_discount_pct"])} if nxt else None)}


def promo_discount(kind: str, asset: str | None) -> tuple[Decimal, dict | None]:
    now = int(time.time())
    best, best_p = ZERO, None
    for p in db.q("SELECT * FROM promos WHERE active=1"):
        if p["starts_at"] and p["starts_at"] > now or p["ends_at"] and p["ends_at"] <= now:
            continue
        kinds = db.jl(p["kinds"], [])
        assets = db.jl(p["assets"], [])
        if kinds and kind not in kinds:
            continue
        if assets and asset not in assets:
            continue
        d = D(p["discount_pct"])
        if d > best:
            best, best_p = d, p
    return min(best, Decimal(100)), best_p


def best_voucher(user_id: int, kind: str) -> dict | None:
    now = db.now()
    best, best_v = ZERO, None
    for v in db.q("SELECT * FROM vouchers WHERE user_id=? AND uses_left>0 AND (expires_at IS NULL OR expires_at>?) AND kind IN ('fee_free','fee_discount')",
                  (user_id, now)):
        kinds = db.jl(v["kinds"], [])
        if kinds and kind not in kinds:
            continue
        d = Decimal(100) if v["kind"] == "fee_free" else D(v["value"])
        if d > best:
            best, best_v = d, dict(v, discount_pct=d)
    return best_v


def consume_voucher(voucher_id: int | None):
    if not voucher_id:
        return
    with db.tx():
        db.x("UPDATE vouchers SET uses_left=uses_left-1, used_at=? WHERE id=? AND uses_left>0", (db.now(), voucher_id))


def quote(kind: str, user: dict, asset: str, amount=None, network: str | None = None, pair: str | None = None,
          use_voucher: bool = True) -> dict:
    """Effective fee for one operation. Returns pct (after discounts), fee (asset units, when amount given) and why."""
    amount = D(amount) if amount is not None else None
    base_pct, base_fixed_asset, min_fee, max_fee, rule = ZERO, ZERO, ZERO, ZERO, None
    price = prices.usd(asset) if asset else ZERO

    if kind == "withdraw":
        an = db.one("SELECT * FROM asset_networks WHERE asset=? AND network=?", (asset, network))
        if an:
            base_fixed_asset = D(an["withdraw_fee"])
            base_pct = D(an["withdraw_fee_pct"])
            if an.get("fee_mode") == "dynamic":
                est = D(db.val("SELECT value FROM scan_state WHERE key=?", (f"gasusd:{network}:{asset}",), "0"))
                if est > 0 and price > 0:
                    base_fixed_asset = max(base_fixed_asset, q_up(est * Decimal("1.2") / price, 8))
        rule = rule_for("withdraw", user, asset, network, pair)
        if rule and rule["scope"] in ("user", "role"):  # personal/role overrides replace the table
            base_pct = D(rule["pct"])
            if D(rule["fixed"]) > 0 and price > 0:
                base_fixed_asset = D(rule["fixed"]) / price
    else:
        rule = rule_for(kind, user, asset, network, pair)
        if rule:
            base_pct = D(rule["pct"])
            if D(rule["fixed"]) > 0 and price > 0:
                base_fixed_asset = D(rule["fixed"]) / price
            if D(rule["min_fee"]) > 0 and price > 0:
                min_fee = D(rule["min_fee"]) / price
            if D(rule["max_fee"]) > 0 and price > 0:
                max_fee = D(rule["max_fee"]) / price

    tier = vip(user)
    discount = tier["discount_pct"]
    promo_d, promo = promo_discount(kind, asset)
    voucher = best_voucher(user["id"], kind) if use_voucher else None
    voucher_d = voucher["discount_pct"] if voucher else ZERO
    # discounts stack multiplicatively; a 100 % promo or voucher makes it free
    mult = (1 - discount / 100) * (1 - promo_d / 100) * (1 - voucher_d / 100)
    mult = max(ZERO, mult)
    pct = base_pct * mult
    fee = None
    if amount is not None:
        raw = amount * base_pct / 100 + base_fixed_asset
        if min_fee > 0:
            raw = max(raw, min_fee)
        if max_fee > 0:
            raw = min(raw, max_fee)
        fee = raw * mult
    # don't burn a voucher when it doesn't change anything
    if voucher and (base_pct == 0 and base_fixed_asset == 0):
        voucher = None
    return {
        "kind": kind, "pct": pct, "base_pct": base_pct, "fixed": base_fixed_asset * mult, "fee": fee,
        "vip": {"level": tier["level"], "name": tier["name"], "discount_pct": s(discount)},
        "promo": {"id": promo["id"], "name": promo["name"], "discount_pct": s(promo_d)} if promo else None,
        "voucher": {"id": voucher["id"], "discount_pct": s(voucher_d), "kind": voucher["kind"]} if voucher else None,
        "free": mult == 0 or (base_pct == 0 and base_fixed_asset == 0),
        "rule_id": rule["id"] if rule else None,
    }


def schedule_for_user(user: dict) -> dict:
    """Public fee table (shown in the app's "Fees" page)."""
    out = {"vip": None, "withdraw": [], "swap_pct": None, "transfer": None, "gift": None, "p2p": None}
    tier = vip(user)
    out["vip"] = {"level": tier["level"], "name": tier["name"], "discount_pct": s(tier["discount_pct"]),
                  "volume_30d": s(tier["volume_30d"].quantize(Decimal("0.01"))),
                  "next": {k: s(v) if isinstance(v, Decimal) else v for k, v in tier["next"].items()} if tier["next"] else None,
                  "tiers": [{"level": t["level"], "name": t["name"], "min_volume_usd": t["min_volume_usd"],
                             "discount_pct": t["fee_discount_pct"]} for t in db.q("SELECT * FROM vip_tiers ORDER BY level")]}
    out["swap_pct"] = s(quote("swap", user, "USDT", use_voucher=False)["pct"])
    out["transfer"] = s(quote("transfer", user, "USDT", use_voucher=False)["pct"])
    out["gift"] = s(quote("gift", user, "USDT", use_voucher=False)["pct"])
    out["p2p"] = {"maker_pct": s(quote("p2p_maker", user, "USDT", use_voucher=False)["pct"]),
                  "taker_pct": s(quote("p2p_taker", user, "USDT", use_voucher=False)["pct"])}
    for an in db.q("SELECT an.* FROM asset_networks an JOIN networks n ON n.id=an.network JOIN assets a ON a.id=an.asset "
                   "WHERE an.enabled=1 AND n.enabled=1 AND a.enabled=1 ORDER BY a.sort, n.sort"):
        q = quote("withdraw", user, an["asset"], amount=D(an["min_withdraw"]) or Decimal(1), network=an["network"], use_voucher=False)
        out["withdraw"].append({"asset": an["asset"], "network": an["network"], "fee": s(q["fixed"]), "pct": s(q["pct"]),
                                "min": an["min_withdraw"], "min_deposit": an["min_deposit"]})
    return out
