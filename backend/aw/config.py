"""AW Wallet — environment configuration (read once at import).

Every secret lives in backend/.env (chmod 600), written by deploy/install.sh. Nothing here is ever sent to the client.
"""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:  # pragma: no cover
    pass


def _list(name: str) -> list[int]:
    out = []
    for part in os.getenv(name, "").replace(" ", "").split(","):
        if part.lstrip("-").isdigit():
            out.append(int(part))
    return out


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("AW_DATA_DIR", str(BASE_DIR.parent / "data")))
DB_PATH = Path(os.getenv("AW_DB_PATH", str(DATA_DIR / "aw_wallet.db")))
UPLOAD_DIR = Path(os.getenv("AW_UPLOAD_DIR", str(DATA_DIR / "uploads")))
KEY_FILE = Path(os.getenv("AW_KEY_FILE", str(DATA_DIR / "keys" / "master.enc")))

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
BOT_USERNAME = os.getenv("BOT_USERNAME", "").lstrip("@")
WEBAPP_URL = os.getenv("WEBAPP_URL", "").rstrip("/")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")
OWNER_IDS = _list("ADMIN_IDS")  # super-admins from setup (cannot be removed from the panel)
ADMIN_CHANNEL_ID = os.getenv("ADMIN_CHANNEL_ID", "")  # optional: alerts channel/group
SESSION_SECRET = os.getenv("SESSION_SECRET", "") or WEBHOOK_SECRET
SECRETS_KEY = os.getenv("SECRETS_KEY", "")  # encrypts sensitive DB fields + the master seed file
INIT_DATA_MAX_AGE = int(os.getenv("INIT_DATA_MAX_AGE", "86400"))

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "claude-opus-5-5")

# Chain providers (all optional; public endpoints are used when empty)
RPC = {
    "eth": os.getenv("RPC_ETH", "https://ethereum-rpc.publicnode.com"),
    "bsc": os.getenv("RPC_BSC", "https://bsc-rpc.publicnode.com"),
    "polygon": os.getenv("RPC_POLYGON", "https://polygon-bor-rpc.publicnode.com"),
    "arbitrum": os.getenv("RPC_ARBITRUM", "https://arbitrum-one-rpc.publicnode.com"),
    "base": os.getenv("RPC_BASE", "https://base-rpc.publicnode.com"),
    "avax": os.getenv("RPC_AVAX", "https://avalanche-c-chain-rpc.publicnode.com"),
    "sol": os.getenv("RPC_SOL", "https://solana-rpc.publicnode.com"),
}
TRON_API = os.getenv("TRON_API", "https://api.trongrid.io").rstrip("/")
TRON_API_KEY = os.getenv("TRON_API_KEY", "")
TONCENTER_API = os.getenv("TONCENTER_API", "https://toncenter.com/api/v3").rstrip("/")
TONCENTER_V2 = os.getenv("TONCENTER_V2", "https://toncenter.com/api/v2").rstrip("/")
TONCENTER_KEY = os.getenv("TONCENTER_API_KEY", "")
BTC_API = os.getenv("BTC_API", "https://mempool.space/api").rstrip("/")

TESTING = os.getenv("AW_TESTING") == "1"
