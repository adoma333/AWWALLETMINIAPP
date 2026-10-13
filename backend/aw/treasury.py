"""Treasury: hot-wallet holdings, solvency (proof of reserves vs. user liabilities), sweeps and gas estimates."""
import logging
from decimal import Decimal

from . import catalog, db, keys, ledger, prices
from .chains import adapter, evm
from .chains.base import state_get, state_set
from .money import ZERO, D, from_units, s

log = logging.getLogger("aw.treasury")


def hot_addresses() -> dict:
    out = {}
    if not keys.has_master():
        return out
    for fam in ("evm", "tron", "sol", "btc", "ton"):
        try:
            out[fam] = keys.treasury(fam)
        except Exception as e:  # pragma: no cover
            out[fam] = f"error: {e}"
    return out


def refresh_holdings() -> dict:
    per_asset: dict[str, Decimal] = {}
    for net in db.q("SELECT * FROM networks WHERE enabled=1"):
        fam = net["kind"]
        try:
            addr = keys.treasury(fam) if fam != "btc" else "*"
        except Exception:
            continue
        for an in db.q("SELECT * FROM asset_networks WHERE network=? AND enabled=1", (net["id"],)):
            try:
                units = adapter(net["id"]).balance(dict(net, config=db.jl(net.get("config"))), addr, an)
            except Exception as e:
                log.info("holdings %s/%s: %s", net["id"], an["asset"], e)
                continue
            amt = from_units(units, an["decimals"])
            state_set(f"holdings:{net['id']}:{an['asset']}", s(amt))
            per_asset[an["asset"]] = per_asset.get(an["asset"], ZERO) + amt
    for a, v in per_asset.items():
        state_set(f"holdings:{a}", s(v))
    state_set("holdings:updated", db.now())
    return {k: s(v) for k, v in per_asset.items()}


def solvency() -> dict:
    liab = ledger.liabilities()
    for g in db.q("SELECT asset, remaining FROM gifts WHERE status='active'"):
        liab[g["asset"]] = liab.get(g["asset"], ZERO) + D(g["remaining"])
    unswept: dict[str, Decimal] = {}
    for r in db.q("SELECT asset, amount FROM chain_deposits WHERE status='credited' AND (note IS NULL OR note<>'swept') AND network NOT IN ('ton','btc')"):
        if r["asset"]:
            unswept[r["asset"]] = unswept.get(r["asset"], ZERO) + D(r["amount"])
    rows = []
    assets = sorted(set(liab) | {r["asset"] for r in db.q("SELECT asset FROM asset_networks")})
    tot_l = tot_h = ZERO
    for a in assets:
        hot = D(state_get(f"holdings:{a}", "0"))
        l = liab.get(a, ZERO)
        u = unswept.get(a, ZERO)
        p = prices.usd(a)
        tot_l += l * p
        tot_h += (hot + u) * p
        if l == 0 and hot == 0 and u == 0:
            continue
        cov = ((hot + u) / l * 100) if l > 0 else Decimal(100)
        rows.append({"asset": a, "liabilities": s(l), "hot": s(hot), "unswept": s(u), "coverage_pct": s(cov.quantize(Decimal("0.1"))),
                     "usd_gap": s(((hot + u - l) * p).quantize(Decimal("0.01")))})
    return {"rows": rows, "liabilities_usd": s(tot_l.quantize(Decimal("0.01"))), "reserves_usd": s(tot_h.quantize(Decimal("0.01"))),
            "updated_at": int(state_get("holdings:updated", 0)), "hot_addresses": hot_addresses()}


def run_sweeps():
    for net in db.q("SELECT * FROM networks WHERE enabled=1"):
        cfg = db.jl(net.get("config"))
        n = dict(net, config=cfg)
        ad = adapter(net["id"])
        try:
            ad.ops_tick(n)
            if cfg.get("auto_sweep"):
                ad.sweep(n, D(cfg.get("sweep_min_usd", "10")))
        except Exception as e:
            log.warning("sweep %s: %s", net["id"], e)


def sweep_now(network_id: str) -> int:
    net = catalog.network(network_id)
    return adapter(network_id).sweep(net, D(net["config"].get("sweep_min_usd", "1")))


def refresh_gas():
    """Network cost estimates in USD, used by `dynamic` withdrawal fees."""
    for net in db.q("SELECT * FROM networks WHERE enabled=1 AND kind='evm'"):
        try:
            n = dict(net, config=db.jl(net.get("config")))
            native_price = prices.usd(net["native_asset"])
            for an in db.q("SELECT * FROM asset_networks WHERE network=?", (net["id"],)):
                wei = evm.gas_cost_wei(n, bool(an["contract"]))
                state_set(f"gasusd:{net['id']}:{an['asset']}", s(Decimal(wei).scaleb(-18) * native_price))
        except Exception as e:
            log.info("gas %s: %s", net["id"], e)
