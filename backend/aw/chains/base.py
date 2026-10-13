"""Shared helpers for chain adapters: HTTP with retries, scan-state storage, the deposit event shape."""
import logging
import time

import httpx

from .. import db

log = logging.getLogger("aw.chains")


class ChainError(Exception):
    pass


def _retry(fn, tries: int = 3):
    last = None
    for i in range(tries):
        try:
            return fn()
        except (httpx.TransportError, httpx.HTTPStatusError) as e:
            last = e
            status = getattr(getattr(e, "response", None), "status_code", 0)
            if status and status < 500 and status != 429:
                break
            time.sleep(0.6 * (2 ** i))
    raise ChainError(str(last))


def http_get(url: str, params: dict | None = None, headers: dict | None = None, timeout: float = 20):
    def go():
        r = httpx.get(url, params=params, headers=headers or {}, timeout=timeout)
        r.raise_for_status()
        return r.json()

    return _retry(go)


def http_post(url: str, body=None, headers: dict | None = None, timeout: float = 25, raw: str | None = None):
    def go():
        if raw is not None:
            r = httpx.post(url, content=raw, headers=headers or {}, timeout=timeout)
        else:
            r = httpx.post(url, json=body, headers=headers or {}, timeout=timeout)
        r.raise_for_status()
        ct = r.headers.get("content-type", "")
        return r.json() if "json" in ct else r.text

    return _retry(go)


def state_get(key: str, default=None):
    v = db.val("SELECT value FROM scan_state WHERE key=?", (key,))
    return default if v is None else v


def state_set(key: str, value):
    db.x("INSERT INTO scan_state(key, value, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
         (key, str(value), db.now()))


def event(network: str, txid: str, idx, address: str, raw_amount: int, contract: str | None, *, block: int | None = None,
          confirmations: int = 0, memo: str | None = None, from_address: str | None = None, final: bool = False,
          decimals: int | None = None) -> dict:
    """A detected incoming transfer. `final=True` means the source already guarantees finality."""
    return {"network": network, "txid": txid, "idx": str(idx), "address": address, "raw_amount": int(raw_amount),
            "contract": contract, "block": block, "confirmations": confirmations, "memo": memo,
            "from_address": from_address, "final": final, "decimals": decimals}


def watched(family: str) -> list[dict]:
    """Addresses to scan this cycle: recently active ones every cycle, everyone else on the slow full pass."""
    now = db.now()
    return db.q("SELECT user_id, address, memo, hd_index FROM deposit_addresses WHERE family=? AND watch_until>?", (family, now))


def all_addresses(family: str) -> list[dict]:
    return db.q("SELECT user_id, address, memo, hd_index FROM deposit_addresses WHERE family=?", (family,))
