"""Address validation / normalisation per chain family (checksums verified, never just regex)."""
from .money import AppError


def _evm(addr: str) -> str:
    from eth_utils import is_address, is_checksum_address, to_checksum_address

    a = addr.strip()
    if not is_address(a):
        raise AppError("bad_address")
    body = a[2:]
    if body != body.lower() and body != body.upper() and not is_checksum_address(a):
        raise AppError("bad_address_checksum")
    return to_checksum_address(a)


def _tron(addr: str) -> str:
    from bip_utils import Base58Decoder

    a = addr.strip()
    try:
        raw = Base58Decoder.CheckDecode(a)
    except Exception:
        raise AppError("bad_address")
    if len(raw) != 21 or raw[0] != 0x41:
        raise AppError("bad_address")
    return a


def _sol(addr: str) -> str:
    from bip_utils import Base58Decoder

    a = addr.strip()
    try:
        raw = Base58Decoder.Decode(a)
    except Exception:
        raise AppError("bad_address")
    if len(raw) != 32:
        raise AppError("bad_address")
    return a


def btc_script(addr: str) -> bytes:
    """scriptPubKey for any mainnet Bitcoin address type."""
    from bip_utils import Base58Decoder, SegwitBech32Decoder

    a = addr.strip()
    low = a.lower()
    if low.startswith("bc1"):
        try:
            ver, prog = SegwitBech32Decoder.Decode("bc", low)
        except Exception:
            raise AppError("bad_address")
        if ver == 0 and len(prog) in (20, 32):
            return bytes([0x00, len(prog)]) + prog
        if ver == 1 and len(prog) == 32:
            return bytes([0x51, 0x20]) + prog
        raise AppError("bad_address")
    try:
        raw = Base58Decoder.CheckDecode(a)
    except Exception:
        raise AppError("bad_address")
    if len(raw) != 21:
        raise AppError("bad_address")
    if raw[0] == 0x00:   # P2PKH
        return bytes([0x76, 0xA9, 0x14]) + raw[1:] + bytes([0x88, 0xAC])
    if raw[0] == 0x05:   # P2SH
        return bytes([0xA9, 0x14]) + raw[1:] + bytes([0x87])
    raise AppError("bad_address")


def _btc(addr: str) -> str:
    btc_script(addr)
    a = addr.strip()
    return a.lower() if a.lower().startswith("bc1") else a


def _ton(addr: str) -> str:
    from tonsdk.utils import Address

    a = addr.strip()
    try:
        parsed = Address(a)
    except Exception:
        raise AppError("bad_address")
    if parsed.wc not in (0, -1):
        raise AppError("bad_address")
    # keep the user's bounceable flag; normalise to url-safe user-friendly form
    bounceable = not a.startswith(("UQ", "0Q", "kQ")) if len(a) == 48 else True
    return parsed.to_string(True, True, bounceable)


VALIDATORS = {"evm": _evm, "tron": _tron, "sol": _sol, "btc": _btc, "ton": _ton}


def normalize(family: str, addr: str) -> str:
    if not isinstance(addr, str) or not addr.strip() or len(addr) > 128:
        raise AppError("bad_address")
    fn = VALIDATORS.get(family)
    if not fn:
        raise AppError("bad_network")
    return fn(addr)


def is_valid(family: str, addr: str) -> bool:
    try:
        normalize(family, addr)
        return True
    except AppError:
        return False


def same(family: str, a: str, b: str) -> bool:
    try:
        if family == "ton":
            from tonsdk.utils import Address

            return Address(a).to_string(False) == Address(b).to_string(False)
        return normalize(family, a).lower() == normalize(family, b).lower() if family == "evm" else normalize(family, a) == normalize(family, b)
    except AppError:
        return False
