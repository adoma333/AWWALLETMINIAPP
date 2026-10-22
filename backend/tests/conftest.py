import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
_TMP = tempfile.mkdtemp(prefix="aw-test-")
os.environ.update({
    "AW_TESTING": "1", "AW_DATA_DIR": _TMP, "AW_DB_PATH": f"{_TMP}/test.db", "AW_UPLOAD_DIR": f"{_TMP}/uploads",
    "AW_KEY_FILE": f"{_TMP}/keys/master.enc", "BOT_TOKEN": "123456:TEST", "BOT_USERNAME": "aw_test_bot",
    "WEBAPP_URL": "https://wallet.test", "WEBHOOK_SECRET": "whsecret", "SESSION_SECRET": "sess", "SECRETS_KEY": "secret-key",
    "ADMIN_IDS": "999", "ANTHROPIC_API_KEY": "",
})

from aw import catalog, config, db, keys, settings, tg  # noqa: E402

TEST_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

PRICES = {"USDT": "1", "USDC": "1", "BTC": "60000", "ETH": "3000", "TON": "5", "BNB": "600", "SOL": "150", "TRX": "0.25",
          "POL": "0.5", "AVAX": "30", "ARB": "0.8", "DAI": "1", "FDUSD": "1", "DOGE": "0.12", "XRP": "0.6", "LINK": "15",
          "UNI": "8", "CAKE": "2", "SHIB": "0.00002", "PEPE": "0.00001", "NOT": "0.008", "DOGS": "0.0005"}


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    for f in Path(_TMP).glob("test.db*"):
        f.unlink()
    db.reset_for_tests()
    settings.invalidate()
    keys._seed.cache_clear()
    from aw.chains import ton as _ton

    _ton._OURS.update(at=0.0, map={})
    keys.derive.cache_clear()
    if config.KEY_FILE.exists():
        config.KEY_FILE.unlink()
    keys.save_mnemonic(TEST_MNEMONIC)
    catalog.seed()
    set_prices()
    sent = []
    monkeypatch.setattr(tg, "call", lambda method, payload=None, timeout=15: sent.append((method, payload)) or {"ok": True, "result": {"id": "prep1", "username": "aw_test_bot"}})
    yield sent


def set_prices(overrides: dict | None = None):
    p = dict(PRICES, **(overrides or {}))
    with db.tx():
        for a, v in p.items():
            db.x("INSERT OR REPLACE INTO prices(asset, usd, change24h, sources, updated_at) VALUES(?,?,?,?,?)",
                 (a, v, "1.5", json.dumps({"binance": v, "okx": v}), db.now()))


def init_data(uid: int, username: str | None = None, first_name: str = "User", start_param: str | None = None, **extra) -> str:
    from aw.security import sign_init_data

    user = {"id": uid, "first_name": first_name, "language_code": extra.pop("lang", "en")}
    if username:
        user["username"] = username
    kw = {"start_param": start_param} if start_param else {}
    return sign_init_data(user, config.BOT_TOKEN, **kw)


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from aw.main import app

    with TestClient(app) as c:
        yield c


class Api:
    def __init__(self, client, uid, username=None, first_name="User", start_param=None, lang="en"):
        self.c = client
        self.uid = uid
        self.h = {"X-Init-Data": init_data(uid, username, first_name, start_param, lang=lang)}
        r = self.c.post("/api/auth", headers=self.h)
        assert r.status_code == 200, r.text
        self.me = r.json()["me"]

    def get(self, path, **kw):
        return self.c.get(path, headers=self.h, **kw)

    def post(self, path, json=None):
        return self.c.post(path, headers=self.h, json=json or {})

    def ok(self, method, path, json=None):
        r = getattr(self, method)(path, json) if method == "post" else self.get(path)
        assert r.status_code == 200, f"{path}: {r.status_code} {r.text}"
        return r.json()


@pytest.fixture
def api(client):
    def make(uid, **kw):
        return Api(client, uid, **kw)
    return make


def fund(uid: int, asset: str, amount: str):
    from aw import ledger

    with db.tx():
        ref = ledger.add_tx(uid, "adjust", asset, amount)
        ledger.credit(uid, asset, amount, "test_fund", ref)
