"""Background worker (systemd: aw-wallet-worker). Independent loops in threads so a slow chain never blocks others:
  outbox (bot messages) · prices/FX · one scanner per network · withdrawals · expiries · sweeps/holdings/gas · heartbeat.
"""
import logging
import signal
import threading
import time

from . import catalog, db, deposits, gifts, keys, p2p, prices, tg, treasury, withdrawals
from .chains.base import state_set

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("aw.worker")
STOP = threading.Event()

SCAN_EVERY = {"evm": 30, "tron": 30, "sol": 30, "btc": 120, "ton": 15}


def loop(name: str, every: float, fn, initial_delay: float = 0):
    def run():
        if initial_delay:
            STOP.wait(initial_delay)
        while not STOP.is_set():
            t0 = time.time()
            try:
                fn()
            except Exception:
                log.exception("%s failed", name)
            STOP.wait(max(0.2, every - (time.time() - t0)))

    th = threading.Thread(target=run, name=name, daemon=True)
    th.start()
    return th


def _scan(nid: str):
    def go():
        if not keys.has_master():
            return
        net = catalog.network(nid)
        if not net or not net["enabled"]:
            return
        n = deposits.scan_network(nid)
        if n:
            log.info("%s: credited %d deposits", nid, n)
        state_set(f"scan:{nid}:at", db.now())
    return go


def _withdrawals():
    if not keys.has_master():
        return
    withdrawals.process_approved()
    withdrawals.track_broadcast()


def _expiries():
    gifts.expire_due()
    p2p.expire_due()


def _treasury_fast():
    if keys.has_master():
        treasury.run_sweeps()
        treasury.refresh_gas()


def _holdings():
    if keys.has_master():
        treasury.refresh_holdings()


def _fx():
    prices.refresh_fx()


def _heartbeat():
    state_set("worker:heartbeat", db.now())


def main():
    db.conn()
    catalog.seed()
    deposits.migrate_ton_addresses()  # personal TON wallets for users who had a memo
    signal.signal(signal.SIGTERM, lambda *_: STOP.set())
    signal.signal(signal.SIGINT, lambda *_: STOP.set())
    loop("outbox", 1, tg.flush)
    loop("prices", 60, prices.refresh)
    loop("fx", 3600, _fx)
    loop("withdrawals", 20, _withdrawals, 5)
    loop("expiries", 30, _expiries, 10)
    loop("treasury", 300, _treasury_fast, 60)
    loop("holdings", 600, _holdings, 30)
    loop("heartbeat", 30, _heartbeat)
    for net in db.q("SELECT id, kind FROM networks"):
        loop(f"scan-{net['id']}", SCAN_EVERY.get(net["kind"], 60), _scan(net["id"]), 3)
    log.info("Zohra Wallet worker started")
    while not STOP.is_set():
        STOP.wait(1)
    log.info("worker stopping")


if __name__ == "__main__":
    main()
