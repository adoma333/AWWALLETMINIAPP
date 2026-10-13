"""Seed catalog: the 10 networks, their assets and token contracts. Everything is editable later in the admin panel.

Withdrawals default to `manual` (admin pays out) until the owner funds the hot wallet and switches a network to `auto`.
"""
from . import db

# id, name, short, kind/family, chain_id, native, confirmations, explorer tx, explorer addr, eta, color, memo_mode
NETWORKS = [
    ("tron", "TRON", "TRC20", "tron", None, "TRX", 19, "https://tronscan.org/#/transaction/{tx}", "https://tronscan.org/#/address/{addr}", "~1 min", "#FF060A", "none"),
    ("ton", "TON", "TON", "ton", None, "TON", 1, "https://tonviewer.com/transaction/{tx}", "https://tonviewer.com/{addr}", "~10 sec", "#0098EA", "required"),
    ("bsc", "BNB Smart Chain", "BEP20", "evm", 56, "BNB", 15, "https://bscscan.com/tx/{tx}", "https://bscscan.com/address/{addr}", "~1 min", "#F0B90B", "none"),
    ("eth", "Ethereum", "ERC20", "evm", 1, "ETH", 12, "https://etherscan.io/tx/{tx}", "https://etherscan.io/address/{addr}", "~3 min", "#627EEA", "none"),
    ("sol", "Solana", "SPL", "sol", None, "SOL", 1, "https://solscan.io/tx/{tx}", "https://solscan.io/account/{addr}", "~30 sec", "#14F195", "none"),
    ("polygon", "Polygon", "POL", "evm", 137, "POL", 64, "https://polygonscan.com/tx/{tx}", "https://polygonscan.com/address/{addr}", "~3 min", "#8247E5", "none"),
    ("arbitrum", "Arbitrum One", "ARB", "evm", 42161, "ETH", 20, "https://arbiscan.io/tx/{tx}", "https://arbiscan.io/address/{addr}", "~1 min", "#28A0F0", "none"),
    ("base", "Base", "BASE", "evm", 8453, "ETH", 20, "https://basescan.org/tx/{tx}", "https://basescan.org/address/{addr}", "~1 min", "#0052FF", "none"),
    ("btc", "Bitcoin", "BTC", "btc", None, "BTC", 2, "https://mempool.space/tx/{tx}", "https://mempool.space/address/{addr}", "~20 min", "#F7931A", "none"),
    ("avax", "Avalanche C-Chain", "AVAX C", "evm", 43114, "AVAX", 3, "https://snowtrace.io/tx/{tx}", "https://snowtrace.io/address/{addr}", "~30 sec", "#E84142", "none"),
]

FAMILY = {n[0]: n[3] for n in NETWORKS}
EVM_NETWORKS = [n[0] for n in NETWORKS if n[3] == "evm"]

# id, name, precision, display, stable, price symbol, coingecko id, color, sort
ASSETS = [
    ("USDT", "Tether USD", 6, 2, 1, "USDT", "tether", "#26A17B", 1),
    ("USDC", "USD Coin", 6, 2, 1, "USDC", "usd-coin", "#2775CA", 2),
    ("BTC", "Bitcoin", 8, 6, 0, "BTC", "bitcoin", "#F7931A", 3),
    ("ETH", "Ethereum", 8, 5, 0, "ETH", "ethereum", "#627EEA", 4),
    ("TON", "Toncoin", 8, 3, 0, "TON", "the-open-network", "#0098EA", 5),
    ("BNB", "BNB", 8, 4, 0, "BNB", "binancecoin", "#F0B90B", 6),
    ("SOL", "Solana", 8, 4, 0, "SOL", "solana", "#9945FF", 7),
    ("TRX", "TRON", 6, 2, 0, "TRX", "tron", "#FF060A", 8),
    ("POL", "Polygon", 8, 3, 0, "POL", "polygon-ecosystem-token", "#8247E5", 9),
    ("AVAX", "Avalanche", 8, 4, 0, "AVAX", "avalanche-2", "#E84142", 10),
    ("ARB", "Arbitrum", 8, 3, 0, "ARB", "arbitrum", "#28A0F0", 11),
    ("DAI", "Dai", 8, 2, 1, "DAI", "dai", "#F5AC37", 12),
    ("FDUSD", "First Digital USD", 8, 2, 1, "FDUSD", "first-digital-usd", "#00D395", 13),
    ("DOGE", "Dogecoin", 8, 2, 0, "DOGE", "dogecoin", "#C2A633", 14),
    ("XRP", "XRP", 6, 2, 0, "XRP", "ripple", "#23292F", 15),
    ("LINK", "Chainlink", 8, 3, 0, "LINK", "chainlink", "#2A5ADA", 16),
    ("UNI", "Uniswap", 8, 3, 0, "UNI", "uniswap", "#FF007A", 17),
    ("CAKE", "PancakeSwap", 8, 3, 0, "CAKE", "pancakeswap-token", "#1FC7D4", 18),
    ("SHIB", "Shiba Inu", 0, 0, 0, "SHIB", "shiba-inu", "#FFA409", 19),
    ("PEPE", "Pepe", 0, 0, 0, "PEPE", "pepe", "#4C9540", 20),
    ("NOT", "Notcoin", 4, 0, 0, "NOT", "notcoin", "#FFFFFF", 21),
    ("DOGS", "DOGS", 4, 0, 0, "DOGS", "dogs-2", "#FFFFFF", 22),
]

# asset, network, contract (None = native), decimals, min_deposit, min_withdraw, withdraw_fee
ASSET_NETWORKS = [
    # TRON
    ("TRX", "tron", None, 6, "1", "10", "1.5"),
    ("USDT", "tron", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", 6, "1", "10", "1.5"),
    # TON (shared address + memo)
    ("TON", "ton", None, 9, "0.1", "1", "0.05"),
    ("USDT", "ton", "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs", 6, "1", "5", "0.3"),
    ("NOT", "ton", "EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT", 9, "100", "500", "50"),
    ("DOGS", "ton", "EQCvxJy4eG8hyHBFsZ7eePxrRsUQSFE_jpptRAYBmcG_DOGS", 9, "100", "1000", "100"),
    # BNB Smart Chain
    ("BNB", "bsc", None, 18, "0.001", "0.01", "0.0005"),
    ("USDT", "bsc", "0x55d398326f99059fF775485246999027B3197955", 18, "1", "10", "0.3"),
    ("USDC", "bsc", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18, "1", "10", "0.3"),
    ("ETH", "bsc", "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", 18, "0.001", "0.005", "0.0002"),
    ("BTC", "bsc", "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", 18, "0.00002", "0.0002", "0.00001"),
    ("FDUSD", "bsc", "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409", 18, "1", "10", "0.3"),
    ("DOGE", "bsc", "0xbA2aE424d960c26247Dd6c32edC70B295c744C43", 8, "10", "50", "2"),
    ("XRP", "bsc", "0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE", 18, "2", "10", "0.5"),
    ("CAKE", "bsc", "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", 18, "0.5", "2", "0.2"),
    # Ethereum
    ("ETH", "eth", None, 18, "0.002", "0.01", "0.0012"),
    ("USDT", "eth", "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6, "5", "20", "4"),
    ("USDC", "eth", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6, "5", "20", "4"),
    ("DAI", "eth", "0x6B175474E89094C44Da98b954EedeAC495271d0F", 18, "5", "20", "4"),
    ("BTC", "eth", "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", 8, "0.0001", "0.0005", "0.00005"),
    ("LINK", "eth", "0x514910771AF9Ca656af840dff83E8264EcF986CA", 18, "0.5", "2", "0.3"),
    ("UNI", "eth", "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", 18, "0.5", "2", "0.5"),
    ("SHIB", "eth", "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", 18, "500000", "2000000", "400000"),
    ("PEPE", "eth", "0x6982508145454Ce325dDbE47a25d4ec3d2311933", 18, "500000", "2000000", "400000"),
    # Solana
    ("SOL", "sol", None, 9, "0.01", "0.05", "0.002"),
    ("USDT", "sol", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", 6, "1", "5", "1"),
    ("USDC", "sol", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 6, "1", "5", "1"),
    # Polygon
    ("POL", "polygon", None, 18, "1", "2", "0.1"),
    ("USDT", "polygon", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 6, "1", "5", "0.3"),
    ("USDC", "polygon", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", 6, "1", "5", "0.3"),
    ("ETH", "polygon", "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", 18, "0.001", "0.005", "0.0002"),
    # Arbitrum
    ("ETH", "arbitrum", None, 18, "0.0005", "0.002", "0.0002"),
    ("USDT", "arbitrum", "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6, "1", "5", "0.5"),
    ("USDC", "arbitrum", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6, "1", "5", "0.5"),
    ("ARB", "arbitrum", "0x912CE59144191C1204E64559FE8253a0e49E6548", 18, "1", "3", "0.5"),
    # Base
    ("ETH", "base", None, 18, "0.0005", "0.002", "0.0002"),
    ("USDC", "base", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6, "1", "5", "0.3"),
    # Bitcoin
    ("BTC", "btc", None, 8, "0.0001", "0.0005", "0.0002"),
    # Avalanche C-Chain
    ("AVAX", "avax", None, 18, "0.01", "0.1", "0.01"),
    ("USDT", "avax", "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", 6, "1", "5", "0.5"),
    ("USDC", "avax", "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", 6, "1", "5", "0.5"),
]

P2P_METHODS = [
    # id, name, type, color, fields, currencies
    ("bank", "Bank Transfer", "bank", "#4C6FFF", ["account_name", "bank_name", "account_number", "iban"], []),
    ("cash", "Cash in person", "cash", "#3DDC97", ["city", "note"], []),
    ("wise", "Wise", "ewallet", "#9FE870", ["account_name", "email"], ["USD", "EUR"]),
    ("revolut", "Revolut", "ewallet", "#0666EB", ["account_name", "revtag"], ["USD", "EUR"]),
    ("paypal", "PayPal", "ewallet", "#003087", ["email"], ["USD", "EUR"]),
    ("vodafone_cash", "Vodafone Cash", "mobile", "#E60000", ["account_name", "phone"], ["EGP"]),
    ("instapay", "InstaPay", "bank", "#5B2C83", ["account_name", "ipa_address"], ["EGP"]),
    ("stc_pay", "STC Pay", "mobile", "#4F008C", ["account_name", "phone"], ["SAR"]),
    ("baridimob", "BaridiMob", "bank", "#F5B800", ["account_name", "rip"], ["DZD"]),
    ("cib", "CIB / Edahabia", "card", "#0A6E3B", ["account_name", "card_number"], ["DZD"]),
    ("zaincash", "ZainCash", "mobile", "#E5007E", ["account_name", "phone"], ["IQD"]),
    ("papara", "Papara", "ewallet", "#000000", ["account_name", "papara_no"], ["TRY"]),
    ("sberbank", "Sberbank", "bank", "#21A038", ["account_name", "card_number"], ["RUB"]),
    ("tinkoff", "T-Bank", "bank", "#FFDD2D", ["account_name", "card_number"], ["RUB"]),
    ("monobank", "Monobank", "bank", "#000000", ["account_name", "card_number"], ["UAH"]),
    ("upi", "UPI", "mobile", "#097939", ["account_name", "upi_id"], ["INR"]),
    ("pix", "PIX", "bank", "#32BCAD", ["account_name", "pix_key"], ["BRL"]),
    ("kaspi", "Kaspi", "bank", "#F14635", ["account_name", "phone"], ["KZT"]),
]

DEFAULT_FEE_RULES = [
    # kind, scope, scope_id, pct, fixed, min, max, note
    ("swap", "global", None, "0.8", "0", "0", "0", "Default swap spread (%) — platform margin built into the rate"),
    ("transfer", "global", None, "0", "0", "0", "0", "Internal transfers are free"),
    ("gift", "global", None, "0", "0", "0", "0", "Gifts are free"),
    ("p2p_maker", "global", None, "0.1", "0", "0", "0", "P2P advertiser fee"),
    ("p2p_taker", "global", None, "0", "0", "0", "0", "P2P taker fee"),
    ("swap", "pair", "USDT/USDC", "0.1", "0", "0", "0", "Stable-to-stable pair: tight spread"),
    ("swap", "pair", "USDC/USDT", "0.1", "0", "0", "0", "Stable-to-stable pair: tight spread"),
    ("swap", "role", "merchant", "0.5", "0", "0", "0", "Verified merchants pay a lower spread"),
]

VIP_TIERS = [
    (0, "Standard", "0", "0", "1"),
    (1, "Silver", "10000", "10", "1.5"),
    (2, "Gold", "50000", "20", "2"),
    (3, "Platinum", "250000", "35", "3"),
    (4, "Diamond", "1000000", "50", "5"),
]


def seed(force: bool = False):
    """Insert catalog rows that don't exist yet (never overwrites admin edits)."""
    with db.tx():
        for i, (nid, name, short, kind, chain_id, native, conf, etx, eaddr, eta, color, memo) in enumerate(NETWORKS):
            db.insert("networks", {
                "id": nid, "name": name, "short": short, "kind": kind, "chain_id": chain_id, "native_asset": native,
                "confirmations": conf, "explorer_tx": etx, "explorer_addr": eaddr, "eta": eta, "color": color,
                "memo_mode": memo, "sort": i + 1, "withdraw_mode": "manual",
            }, or_ignore=True)
        for aid, name, prec, disp, stable, psym, cg, color, sort in ASSETS:
            db.insert("assets", {
                "id": aid, "name": name, "precision": max(prec, 0) if prec else 0, "display": disp, "is_stable": stable,
                "price_symbol": psym, "coingecko_id": cg, "color": color, "sort": sort,
                "p2p_enabled": 1 if aid in ("USDT", "USDC", "TON", "BTC", "ETH", "TRX", "BNB", "SOL") else 0,
            }, or_ignore=True)
        for i, (aid, nid, contract, dec, mind, minw, fee) in enumerate(ASSET_NETWORKS):
            db.insert("asset_networks", {
                "asset": aid, "network": nid, "contract": contract, "decimals": dec,
                "min_deposit": mind, "min_withdraw": minw, "withdraw_fee": fee, "sort": i,
            }, or_ignore=True)
        for i, (mid, name, typ, color, fields, curr) in enumerate(P2P_METHODS):
            db.insert("p2p_methods", {"id": mid, "name": name, "type": typ, "color": color, "fields": fields,
                                      "currencies": curr, "sort": i}, or_ignore=True)
        if force or not db.val("SELECT COUNT(*) FROM fee_rules"):
            for kind, scope, sid, pct, fixed, mn, mx, note in DEFAULT_FEE_RULES:
                db.insert("fee_rules", {"kind": kind, "scope": scope, "scope_id": sid, "pct": pct, "fixed": fixed,
                                        "min_fee": mn, "max_fee": mx, "note": note, "created_at": db.now()})
        for lvl, name, vol, disc, mult in VIP_TIERS:
            db.insert("vip_tiers", {"level": lvl, "name": name, "min_volume_usd": vol, "fee_discount_pct": disc,
                                    "limit_multiplier": mult}, or_ignore=True)


def network(nid: str) -> dict | None:
    r = db.one("SELECT * FROM networks WHERE id=?", (nid,))
    if r:
        r["config"] = db.jl(r.get("config"))
        r["badges"] = db.jl(r.get("badges"), [])
    return r


def asset(aid: str) -> dict | None:
    r = db.one("SELECT * FROM assets WHERE id=?", (aid,))
    if r:
        r["badges"] = db.jl(r.get("badges"), [])
        r["meta"] = db.jl(r.get("meta"))
    return r


def asset_network(aid: str, nid: str) -> dict | None:
    return db.one("SELECT * FROM asset_networks WHERE asset=? AND network=?", (aid, nid))


def by_contract(nid: str, contract: str | None) -> dict | None:
    if contract is None:
        return db.one("SELECT * FROM asset_networks WHERE network=? AND contract IS NULL", (nid,))
    rows = db.q("SELECT * FROM asset_networks WHERE network=? AND contract IS NOT NULL", (nid,))
    c = contract.lower() if nid in FAMILY and FAMILY.get(nid) == "evm" else contract
    for r in rows:
        rc = r["contract"].lower() if FAMILY.get(nid) == "evm" else r["contract"]
        if rc == c:
            return r
    return None


def family(nid: str) -> str:
    r = db.one("SELECT kind FROM networks WHERE id=?", (nid,))
    return r["kind"] if r else FAMILY.get(nid, "")
