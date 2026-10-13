"""Tiny in-process event bus: business modules emit facts, rewards/referral/notifications react.

Handlers run synchronously after the emitting transaction; a failing handler is logged and never breaks the caller.
"""
import logging
from collections import defaultdict

log = logging.getLogger("aw.events")
_handlers: dict[str, list] = defaultdict(list)


def on(name: str):
    def deco(fn):
        _handlers[name].append(fn)
        return fn

    return deco


def emit(name: str, user_id: int, **data):
    for fn in list(_handlers.get(name, [])) + list(_handlers.get("*", [])):
        try:
            fn(name, user_id, **data)
        except Exception:  # pragma: no cover - never break the caller
            log.exception("event handler %s failed for %s", getattr(fn, "__name__", fn), name)
