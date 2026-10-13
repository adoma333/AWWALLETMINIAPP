"""Chain adapters by family. Every adapter exposes the same functions:
scan(net) · verify(net, txid) · send(net, an, to, units, memo, ref) · status(net, txid) · balance(net, addr, an)
· sweep(net, min_usd) · ops_tick(net)
"""
from .. import catalog
from . import btc, evm, sol, ton, tron

ADAPTERS = {"evm": evm, "tron": tron, "sol": sol, "btc": btc, "ton": ton}


def adapter(network_id: str):
    fam = catalog.family(network_id)
    if fam not in ADAPTERS:
        raise ValueError(f"no adapter for {network_id}")
    return ADAPTERS[fam]
