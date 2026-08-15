"""First Floor — primitives vector emitter.

Emits `vectors/primitives.json`, the fixture behind the Phase 1 gate. Every
value is produced by importing `oracle.py`, never by reimplementing it, so this
file cannot drift from the oracle it is meant to pin down.

Three groups:

  1. The pricing primitives themselves, over grids chosen to include the cases
     that break naive implementations: T = 0, sigma = 0, deep out-of-the-money
     legs, and the tails of the normal where a rational approximation is worst.

  2. The mulberry32 stream. Cross-language PRNG agreement is unforgiving and the
     brief warns that Phase 6 fails here first, so the streams are emitted at
     several seeds - including seed 11, which the capture simulation uses - and
     must match byte for byte, not to a tolerance.

  3. Raw math.erfc / exp / log / cos samples. These are NOT a specification of
     what TypeScript must produce. They exist to MEASURE how far apart CPython's
     libm and V8's are, because COMPUTATIONAL_SPEC.md section 11 requires the
     capture grid to match "exactly" and neither runtime rounds these functions
     correctly. If the measured disagreement is non-zero, the exactness claim in
     section 11 needs amending to a stated relative tolerance - a decision worth
     taking on evidence in Phase 1 rather than on hope in Phase 6.

Determinism note: floats are serialized by repr, which is the shortest string
that round-trips. Python and JavaScript both parse such strings back to the
identical double, so this file is an exact fixture, not an approximate one.

Usage:  python3 reference/emit_primitives.py > vectors/primitives.json
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from oracle import (  # noqa: E402
    Mulberry32,
    bs,
    bs_delta,
    implied_vol,
    norm_cdf,
    norm_ppf,
    strike_for_call_delta,
)

# ------------------------------------------------------------------ grids

# Wide enough to exercise both tails, where Acklam's approximation and any
# erfc rational approximation are least accurate.
CDF_X = [-40.0, -12.0, -8.0, -6.0, -4.0, -3.0, -2.5, -2.0, -1.5, -1.0, -0.5,
         -0.25, -0.125, -1e-8, 0.0, 1e-8, 0.125, 0.25, 0.5, 1.0, 1.5, 2.0,
         2.5, 3.0, 4.0, 6.0, 8.0, 12.0, 40.0]

# Straddles Acklam's two branch points at p = 0.02425 and 1 - 0.02425.
PPF_P = [1e-12, 1e-9, 1e-6, 1e-4, 0.001, 0.01, 0.02424, 0.02425, 0.02426,
         0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.95, 0.97574, 0.97575,
         0.97576, 0.99, 0.999, 1 - 1e-4, 1 - 1e-6, 1 - 1e-9]

# (S, K, T, r, q, sigma, right). Includes the degenerate cases the spec calls
# out: T <= 0 and sigma <= 0 return intrinsic value and must not return NaN,
# because a structure holding an expiring leg is a normal case, not an error.
BS_CASES = [
    (100.0, 100.0, 1.0, 0.04, 0.0, 0.20, "call"),
    (100.0, 100.0, 1.0, 0.04, 0.0, 0.20, "put"),
    (100.0, 100.0, 0.0, 0.04, 0.0, 0.20, "call"),
    (100.0, 100.0, 0.0, 0.04, 0.0, 0.20, "put"),
    (100.0, 90.0, 0.0, 0.04, 0.0, 0.20, "call"),
    (100.0, 110.0, 0.0, 0.04, 0.0, 0.20, "put"),
    (100.0, 100.0, -0.5, 0.04, 0.0, 0.20, "call"),
    (100.0, 100.0, 1.0, 0.04, 0.0, 0.0, "call"),
    (100.0, 100.0, 1.0, 0.04, 0.0, -0.1, "put"),
    (100.0, 250.0, 0.25, 0.04, 0.0, 0.15, "call"),
    (100.0, 10.0, 0.25, 0.04, 0.0, 0.15, "put"),
    (100.0, 100.0, 1e-6, 0.04, 0.0, 0.20, "call"),
    (100.0, 100.0, 5.0, 0.04, 0.03, 0.60, "call"),
    (100.0, 100.0, 5.0, 0.04, 0.03, 0.60, "put"),
    (0.5, 0.4, 2.0, 0.02, 0.01, 0.35, "call"),
    (7748.5, 7725.0, 5 / 365.0, 0.042, 0.012, 0.1777450759057692, "call"),
    (7748.5, 7800.0, 10 / 365.0, 0.042, 0.012, 0.121065199641366, "call"),
    (774.85, 584.0, 229 / 365.0, 0.042, 0.012, 0.2806395675162684, "put"),
    (774.85, 672.0, 320 / 365.0, 0.042, 0.012, 0.22630056351528283, "put"),
    (109.61, 93.59, 217 / 365.0, 0.04, 0.0, 0.2, "put"),
    (109.61, 0.94, 217 / 365.0, 0.04, 0.0, 0.2, "call"),
]

# (price, S, K, T, r, q, right). The middle seven reproduce example A's own
# ladder and must agree with the implied_vols block of vectors/example_a.json.
#
# The last four are pathologies, and two of them behave differently from what
# section 10 assumes:
#
#   price = 1e-09  -> 0.3548, a genuine root. Small price, ordinary vol.
#   price = 95.00  -> 3.9028, a genuine root just inside the upper bound.
#   price = 0.00   -> 0.0566, and this one is a trap. Black-Scholes underflows
#                    to exactly 0.0 for this leg at any sigma below about 0.11,
#                    so every such sigma is a root and bisection returns the
#                    midpoint of the underflow region. The section 10 diagnostic
#                    (sigma <= 1e-3 or >= 4.99) does NOT catch it: a leg with a
#                    zero or stale mark is handed back a plausible-looking 5.7%
#                    vol. That is precisely the caveated wrong number invariant 3
#                    forbids. The TypeScript port needs an additional guard -
#                    reject an inversion whose price is at or below the value at
#                    the lower bound - and section 10 needs the extra row.
#   price = 99.50  -> 5.0 exactly, the true upper-bound case section 10 describes.
IV_CASES = [
    (10.4506, 100.0, 100.0, 1.0, 0.04, 0.0, "call"),
    (5.9, 774.85, 584.0, 229 / 365.0, 0.042, 0.012, "put"),
    (0.51, 774.85, 598.0, 47 / 365.0, 0.042, 0.012, "put"),
    (3.98, 774.85, 615.0, 139 / 365.0, 0.042, 0.012, "put"),
    (18.01, 774.85, 672.0, 320 / 365.0, 0.042, 0.012, "put"),
    (78.4, 7748.5, 7725.0, 5 / 365.0, 0.042, 0.012, "call"),
    (42.15, 7748.5, 7800.0, 10 / 365.0, 0.042, 0.012, "call"),
    (21.6, 7748.5, 7875.0, 14 / 365.0, 0.042, 0.012, "call"),
    (1e-9, 100.0, 200.0, 0.1, 0.04, 0.0, "call"),
    (95.0, 100.0, 100.0, 1.0, 0.04, 0.0, "call"),
    (0.0, 100.0, 200.0, 0.1, 0.04, 0.0, "call"),
    (99.5, 100.0, 100.0, 1.0, 0.04, 0.0, "call"),
]

# (S, T, r, q, sigma, target_delta)
DELTA_STRIKE_CASES = [
    (1.0, 14 / 365.0, 0.042, 0.012, 0.16, 0.30),
    (1.0, 14 / 365.0, 0.042, 0.012, 0.16, 0.25),
    (1.0, 14 / 365.0, 0.042, 0.012, 0.16, 0.20),
    (1.0, 30 / 365.0, 0.042, 0.012, 0.16, 0.30),
    (1.0, 91 / 365.0, 0.042, 0.012, 0.16, 0.20),
    (1.0, 91 / 365.0, 0.042, 0.012, 0.16, 1e-9),
    (1.0, 91 / 365.0, 0.042, 0.012, 0.16, 0.9999999),
    (1.2345, 0.5, 0.03, 0.0, 0.28, 0.35),
]

PRNG_SEEDS = [0, 1, 11, 42, 2147483647, 4294967295]
PRNG_DRAWS = 1000

# Sampled where the transcendentals are actually called: erfc over the range
# norm_cdf feeds it, log/exp over the range Black-Scholes and the GBM step
# produce, cos over a full Box-Muller period.
TRANSCENDENTAL_X = [i / 16.0 - 8.0 for i in range(257)]


def main() -> None:
    out = {
        "_note": (
            "Phase 1 gate fixture, emitted by reference/emit_primitives.py. "
            "Primitives match to 1e-10; the mulberry32 streams must match byte "
            "for byte. The transcendentals block is a measurement of "
            "cross-runtime libm agreement, not a specification - see the "
            "module docstring."
        ),
        "python_version": sys.version.split()[0],
        "norm_cdf": [{"x": x, "y": norm_cdf(x)} for x in CDF_X],
        "norm_ppf": [{"p": p, "y": norm_ppf(p)} for p in PPF_P],
        "black_scholes": [
            {
                "S": S, "K": K, "T": T, "r": r, "q": q, "sigma": sg, "right": w,
                "price": bs(S, K, T, r, q, sg, w),
                "delta": bs_delta(S, K, T, r, q, sg, w),
            }
            for (S, K, T, r, q, sg, w) in BS_CASES
        ],
        "implied_vol": [
            {
                "price": p, "S": S, "K": K, "T": T, "r": r, "q": q, "right": w,
                "sigma": implied_vol(p, S, K, T, r, q, w),
            }
            for (p, S, K, T, r, q, w) in IV_CASES
        ],
        "strike_for_call_delta": [
            {
                "S": S, "T": T, "r": r, "q": q, "sigma": sg, "target": d,
                "K": strike_for_call_delta(S, T, r, q, sg, d),
            }
            for (S, T, r, q, sg, d) in DELTA_STRIKE_CASES
        ],
        "mulberry32": [
            {
                "seed": seed,
                "draws": PRNG_DRAWS,
                "uniforms": _uniforms(seed, PRNG_DRAWS),
                "normals": _normals(seed, PRNG_DRAWS // 2),
            }
            for seed in PRNG_SEEDS
        ],
        "transcendentals": {
            "_note": (
                "Measurement only. Report the max relative deviation the "
                "TypeScript runtime shows against these; a non-zero result "
                "means the section 11 'capture matches exactly' gate needs "
                "restating as a tolerance."
            ),
            "x": TRANSCENDENTAL_X,
            "erfc": [math.erfc(x) for x in TRANSCENDENTAL_X],
            "exp": [math.exp(x) for x in TRANSCENDENTAL_X],
            "log": [math.log(x) for x in TRANSCENDENTAL_X if x > 0],
            "log_x": [x for x in TRANSCENDENTAL_X if x > 0],
            "cos": [math.cos(2.0 * math.pi * (x + 8.0) / 16.0) for x in TRANSCENDENTAL_X],
        },
    }
    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")


def _uniforms(seed: int, n: int) -> list:
    rng = Mulberry32(seed)
    return [rng.next_uniform() for _ in range(n)]


def _normals(seed: int, n: int) -> list:
    """Box-Muller consumes exactly two uniforms per normal and discards the
    sine branch. Draw order is part of the specification."""
    rng = Mulberry32(seed)
    return [rng.next_normal() for _ in range(n)]


if __name__ == "__main__":
    main()
