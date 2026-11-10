"""Ed25519 signature verification (RFC 8032), pure Python.

BI-DE1E6485. The updater must check the portal's signed toolchain manifest
before it downloads or runs anything (design 2026-10-07 §5.1, AC-AUTHENTIC).
The Python standard library has no Ed25519, and the updater adds no pip
dependency, so this module verifies signatures itself. It verifies only; it
never handles a private key.

The check is strict and cofactorless, like OpenSSL, which signs the manifest
on the portal: a non-canonical point or an S at or above the group order is
rejected. Speed is not a concern: one verification per run.

`public_key_from_spki` and `device_id` mirror deriveDeviceId in
apps/web/lib/federation/instance-identity.ts: the device id is
`did_` + sha256(SPKI DER of the public key).
"""

from __future__ import annotations

import hashlib
from typing import Optional, Tuple

_P = 2**255 - 19
_L = 2**252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_SQRT_M1 = pow(2, (_P - 1) // 4, _P)

# DER prefix of an Ed25519 SubjectPublicKeyInfo: SEQUENCE { SEQUENCE { OID
# 1.3.101.112 }, BIT STRING (0 unused bits) } followed by the 32 key bytes.
_SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")

Point = Tuple[int, int, int, int]


def _recover_x(y: int, sign: int) -> Optional[int]:
    if y >= _P:
        return None
    x2 = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P) % _P
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P != 0:
        x = x * _SQRT_M1 % _P
    if (x * x - x2) % _P != 0:
        return None
    if (x & 1) != sign:
        x = _P - x
    return x


def _add(p: Point, q: Point) -> Point:
    a = (p[1] - p[0]) * (q[1] - q[0]) % _P
    b = (p[1] + p[0]) * (q[1] + q[0]) % _P
    c = 2 * p[3] * q[3] * _D % _P
    d = 2 * p[2] * q[2] % _P
    e, f, g, h = b - a, d - c, d + c, b + a
    return (e * f % _P, g * h % _P, f * g % _P, e * h % _P)


def _multiply(scalar: int, point: Point) -> Point:
    result: Point = (0, 1, 1, 0)
    while scalar > 0:
        if scalar & 1:
            result = _add(result, point)
        point = _add(point, point)
        scalar >>= 1
    return result


def _equal(p: Point, q: Point) -> bool:
    return (p[0] * q[2] - q[0] * p[2]) % _P == 0 and (p[1] * q[2] - q[1] * p[2]) % _P == 0


def _decode(data: bytes) -> Optional[Point]:
    if len(data) != 32:
        return None
    y = int.from_bytes(data, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = _recover_x(y, sign)
    if x is None:
        return None
    return (x, y, 1, x * y % _P)


def _encode(point: Point) -> bytes:
    z_inverse = pow(point[2], _P - 2, _P)
    x = point[0] * z_inverse % _P
    y = point[1] * z_inverse % _P
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


_BASE_Y = 4 * pow(5, _P - 2, _P) % _P
_BASE_X = _recover_x(_BASE_Y, 0)
assert _BASE_X is not None
BASE: Point = (_BASE_X, _BASE_Y, 1, _BASE_X * _BASE_Y % _P)
GROUP_ORDER = _L


def verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    """True only when `signature` is a valid Ed25519 signature of `message`."""
    if len(public_key) != 32 or len(signature) != 64:
        return False
    a = _decode(public_key)
    r = _decode(signature[:32])
    if a is None or r is None:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= _L:
        return False
    k = int.from_bytes(hashlib.sha512(signature[:32] + public_key + message).digest(), "little") % _L
    return _equal(_multiply(s, BASE), _add(r, _multiply(k, a)))


def public_key_from_spki(der: bytes) -> Optional[bytes]:
    """The raw 32-byte key of an Ed25519 SPKI DER, or None for anything else."""
    if len(der) != len(_SPKI_PREFIX) + 32 or not der.startswith(_SPKI_PREFIX):
        return None
    return der[len(_SPKI_PREFIX):]


def device_id(spki_der: bytes) -> str:
    """`did_<sha256 hex>` of the SPKI DER, as the portal derives it."""
    return "did_" + hashlib.sha256(spki_der).hexdigest()
