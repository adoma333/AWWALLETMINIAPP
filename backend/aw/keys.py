"""Master seed management and HD derivation.

  • One BIP-39 mnemonic (24 words) generated at install time, shown once to the owner for offline backup.
  • Stored encrypted (Fernet, key = SECRETS_KEY from .env) in data/keys/master.enc (chmod 600). The DB never
    contains private keys or the seed; neither file alone is enough to steal funds.
  • Index 0 of every family is the platform hot wallet (treasury + gas tank). Users get fresh indexes from 1000.
  • Paths are the industry standard ones, so the seed can be imported into any wallet for recovery:
      evm  m/44'/60'/0'/0/i   (same address on ETH, BSC, Polygon, Arbitrum, Base, Avalanche)
      tron m/44'/195'/0'/0/i
      sol  m/44'/501'/i'/0'   (Phantom compatible)
      btc  m/84'/0'/0'/0/i    (native SegWit bc1q…)
      ton  m/44'/607'/0'      (single hot wallet v4r2; users are told apart by memo)
"""
import os
import threading
from functools import lru_cache

from . import config, db
from .money import AppError

_lock = threading.Lock()
TREASURY_INDEX = 0
USER_INDEX_START = 1000


def _fernet():
    from .security import _fernet as f

    return f()


def generate_mnemonic() -> str:
    from bip_utils import Bip39MnemonicGenerator, Bip39WordsNum

    return str(Bip39MnemonicGenerator().FromWordsNumber(Bip39WordsNum.WORDS_NUM_24))


def validate_mnemonic(m: str) -> bool:
    from bip_utils import Bip39MnemonicValidator

    try:
        return Bip39MnemonicValidator().IsValid(" ".join(m.split()))
    except Exception:
        return False


def save_mnemonic(mnemonic: str, path=None):
    path = path or config.KEY_FILE
    mnemonic = " ".join(mnemonic.strip().split())
    if not validate_mnemonic(mnemonic):
        raise ValueError("invalid mnemonic")
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "wb") as f:
        f.write(_fernet().encrypt(mnemonic.encode()))
    os.chmod(tmp, 0o600)
    tmp.replace(path)
    _seed.cache_clear()


def has_master() -> bool:
    return config.KEY_FILE.exists()


@lru_cache(maxsize=1)
def _seed() -> bytes:
    from bip_utils import Bip39SeedGenerator

    if not config.KEY_FILE.exists():
        raise AppError("wallet_not_configured", 503)
    mnemonic = _fernet().decrypt(config.KEY_FILE.read_bytes()).decode()
    return Bip39SeedGenerator(mnemonic).Generate()


def _bip44(coin, account: int, index: int):
    from bip_utils import Bip44, Bip44Changes

    return Bip44.FromSeed(_seed(), coin).Purpose().Coin().Account(account).Change(Bip44Changes.CHAIN_EXT).AddressIndex(index)


@lru_cache(maxsize=4096)
def derive(family: str, index: int) -> tuple[str, bytes]:
    """(address, private key bytes). Private keys never leave this process."""
    from bip_utils import Bip32Slip10Ed25519, Bip44, Bip44Changes, Bip44Coins, Bip84, Bip84Coins

    if family == "evm":
        k = _bip44(Bip44Coins.ETHEREUM, 0, index)
        return k.PublicKey().ToAddress(), k.PrivateKey().Raw().ToBytes()
    if family == "tron":
        k = _bip44(Bip44Coins.TRON, 0, index)
        return k.PublicKey().ToAddress(), k.PrivateKey().Raw().ToBytes()
    if family == "sol":
        k = Bip44.FromSeed(_seed(), Bip44Coins.SOLANA).Purpose().Coin().Account(index).Change(Bip44Changes.CHAIN_EXT)
        return k.PublicKey().ToAddress(), k.PrivateKey().Raw().ToBytes()
    if family == "btc":
        k = Bip84.FromSeed(_seed(), Bip84Coins.BITCOIN).Purpose().Coin().Account(0).Change(Bip44Changes.CHAIN_EXT).AddressIndex(index)
        return k.PublicKey().ToAddress(), k.PrivateKey().Raw().ToBytes()
    if family == "ton":
        k = Bip32Slip10Ed25519.FromSeed(_seed()).DerivePath(f"m/44'/607'/{index}'")
        priv = k.PrivateKey().Raw().ToBytes()
        return ton_wallet(priv).address.to_string(True, True, False), priv
    raise ValueError(f"unknown family {family}")


def ton_wallet(priv32: bytes):
    import nacl.signing
    from tonsdk.contract.wallet import WalletV4ContractR2

    sk = nacl.signing.SigningKey(priv32)
    pub = bytes(sk.verify_key)
    return WalletV4ContractR2(public_key=pub, private_key=bytes(sk) + pub, wc=0)


def treasury(family: str) -> str:
    return derive(family, TREASURY_INDEX)[0]


def next_index(family: str) -> int:
    with db.tx():
        r = db.one("SELECT next_index FROM hd_index WHERE family=?", (family,))
        idx = r["next_index"] if r else USER_INDEX_START
        db.x("INSERT INTO hd_index(family, next_index) VALUES(?,?) ON CONFLICT(family) DO UPDATE SET next_index=excluded.next_index",
             (family, idx + 1))
        return idx


def key_for_address(family: str, address: str) -> bytes:
    """Private key of one of our addresses (treasury or a user deposit address)."""
    if address == treasury(family):
        return derive(family, TREASURY_INDEX)[1]
    r = db.one("SELECT hd_index FROM deposit_addresses WHERE family=? AND address=?", (family, address))
    if not r or r["hd_index"] is None:
        raise AppError("unknown_address")
    addr, priv = derive(family, r["hd_index"])
    if addr != address:  # paranoia: the stored index must re-derive to the same address
        raise RuntimeError("derivation mismatch")
    return priv
