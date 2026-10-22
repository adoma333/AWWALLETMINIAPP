"""Decimal helpers. Every amount in the system is a Decimal; floats are rejected at the API boundary."""
import secrets
import string
from decimal import ROUND_DOWN, ROUND_UP, Decimal, InvalidOperation, getcontext

getcontext().prec = 50

ZERO = Decimal(0)


class AppError(Exception):
    """A user-facing error. `code` is translated by the client (err_<code>)."""

    def __init__(self, code: str, status: int = 400, **params):
        super().__init__(code)
        self.code = code
        self.status = status
        self.params = params


def D(v, default=None) -> Decimal:
    if isinstance(v, Decimal):
        return v
    if v is None or v == "":
        if default is not None:
            return Decimal(default)
        return ZERO
    if isinstance(v, float):
        v = repr(v)
    try:
        d = Decimal(str(v).strip())
    except (InvalidOperation, ValueError):
        raise AppError("bad_amount")
    if not d.is_finite():
        raise AppError("bad_amount")
    return d


def amount_in(v, precision: int = 8) -> Decimal:
    """Parse a user-supplied positive amount and validate its precision."""
    d = D(v)
    if d <= 0:
        raise AppError("bad_amount")
    if -d.as_tuple().exponent > precision:
        d = d.quantize(Decimal(1).scaleb(-precision), rounding=ROUND_DOWN)
        if d <= 0:
            raise AppError("bad_amount")
    if d > Decimal("1e15"):
        raise AppError("bad_amount")
    return d


def q_down(d: Decimal, places: int) -> Decimal:
    return D(d).quantize(Decimal(1).scaleb(-places), rounding=ROUND_DOWN)


def q_up(d: Decimal, places: int) -> Decimal:
    return D(d).quantize(Decimal(1).scaleb(-places), rounding=ROUND_UP)


def s(d) -> str:
    """Canonical string for storage/JSON: no exponent, no trailing zeros."""
    d = D(d)
    if d == 0:
        return "0"
    out = format(d.normalize(), "f")
    return out


def to_units(d: Decimal, decimals: int) -> int:
    return int(q_down(D(d), decimals).scaleb(decimals))


def from_units(n: int | str, decimals: int) -> Decimal:
    return Decimal(int(n)).scaleb(-decimals)


_ALPH = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # no 0/O/1/I


def ref_id(prefix: str = "ZW", n: int = 9) -> str:
    return prefix + "".join(secrets.choice(_ALPH) for _ in range(n))


def token(n: int = 24) -> str:
    alph = string.ascii_letters + string.digits
    return "".join(secrets.choice(alph) for _ in range(n))
