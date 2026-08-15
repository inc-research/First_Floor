// SPDX-License-Identifier: MIT

/**
 * Normal CDF and quantile.
 *
 * COMPUTATIONAL_SPEC.md section 1.1 defines `N(x) = 0.5 * erfc(-x/sqrt(2))` and
 * requires 1e-12 absolute accuracy. JavaScript has no `erfc`, so this module
 * provides one.
 *
 * It deliberately does not port a rational minimax approximation. Those carry
 * thirty-odd magic constants that cannot be checked by reading them, and a
 * single mistyped digit produces an error small enough to look like an
 * approximation limit and large enough to matter. The two methods here need one
 * constant between them — 1/sqrt(pi) — and their accuracy is measured against
 * CPython's `math.erfc` in the test suite rather than asserted:
 *
 *   worst absolute error in erfc      5.0e-16
 *   worst absolute error in normCdf   3.3e-16   (spec requires 1e-12)
 *
 * Bit-identity with CPython is roughly 59% and is not attainable by any
 * implementation that is not a copy of the same libm. That matters only for
 * COMPUTATIONAL_SPEC.md section 11's requirement that the capture grid match
 * "exactly"; see `vectors/primitives.json` and the transcendentals note there.
 */

const ONE_OVER_SQRT_PI = 0.5641895835477562869480794515607725858441;
const TWO_OVER_SQRT_PI = 1.1283791670955125738961589031215451716768;
const SQRT2 = Math.SQRT2;
const TINY = 1e-300;

/**
 * Crossover between the series and the continued fraction. Chosen by measuring
 * both across [-30, 30]: 1.0 minimises the worst absolute error in `normCdf`.
 */
const CF_CROSSOVER = 1.0;

/**
 * erf by its confluent series:
 *
 *   erf(x) = (2x/sqrt(pi)) * e^(-x^2) * sum_{n>=0} (2x^2)^n / (1*3*5*...*(2n+1))
 *
 * Every term is positive, so unlike the alternating Maclaurin series there is
 * no cancellation. Used for |x| below the crossover, where erfc is O(1) and
 * `1 - erf` therefore loses nothing that matters.
 */
function erfSeries(x: number): number {
  const x2 = x * x;
  let term = 1;
  let total = 1;
  for (let n = 1; n < 500; n++) {
    term *= (2 * x2) / (2 * n + 1);
    total += term;
    if (term <= total * 1e-18) break;
  }
  return TWO_OVER_SQRT_PI * x * Math.exp(-x2) * total;
}

/**
 * erfc by its continued fraction, evaluated with modified Lentz:
 *
 *   erfc(x) = (e^(-x^2)/sqrt(pi)) / (x + (1/2)/(x + 1/(x + (3/2)/(x + ...))))
 *
 * so b_j = x throughout, a_1 = 1 and a_j = (j-1)/2. Used for |x| at or above
 * the crossover, where it converges quickly and keeps full relative accuracy
 * deep into the tail — which `1 - erf` cannot do once erf approaches 1.
 */
function erfcContinuedFraction(x: number): number {
  let f = TINY;
  let C = f;
  let D = 0;
  for (let j = 1; j <= 400; j++) {
    const a = j === 1 ? 1 : 0.5 * (j - 1);
    D = x + a * D;
    if (D === 0) D = TINY;
    C = x + a / C;
    if (C === 0) C = TINY;
    D = 1 / D;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-18) break;
  }
  return ONE_OVER_SQRT_PI * Math.exp(-x * x) * f;
}

/** Complementary error function. */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return x;
  if (x === Infinity) return 0;
  if (x === -Infinity) return 2;

  const ax = Math.abs(x);
  let v: number;
  if (ax < CF_CROSSOVER) {
    v = 1 - erfSeries(ax);
  } else if (ax > 27.25) {
    // erfc underflows to zero beyond here in double precision.
    v = 0;
  } else {
    v = erfcContinuedFraction(ax);
  }
  return x >= 0 ? v : 2 - v;
}

/** Error function, for completeness and for testing `erfc`'s small-|x| branch. */
export function erf(x: number): number {
  if (Number.isNaN(x)) return x;
  if (x === Infinity) return 1;
  if (x === -Infinity) return -1;
  const ax = Math.abs(x);
  const v = ax < CF_CROSSOVER ? erfSeries(ax) : 1 - erfcContinuedFraction(ax);
  return x >= 0 ? v : -v;
}

/** Standard normal CDF. Spec section 1.1. */
export function normCdf(x: number): number {
  return 0.5 * erfc(-x / SQRT2);
}

/**
 * Standard normal quantile — Acklam's rational approximation, absolute error
 * below 1.15e-9. Spec section 1.2. Needed only for delta-targeted strike
 * selection inside the capture simulation.
 *
 * These constants are a direct transcription of `norm_ppf` in
 * `reference/oracle.py` and are pinned by `vectors/primitives.json`, which
 * samples both branch points at p = 0.02425 and p = 1 - 0.02425.
 */
const A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
  1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
] as const;
const B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
  6.680131188771972e1, -1.328068155288572e1,
] as const;
const C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
  -2.549732539343734, 4.374664141464968, 2.938163982698783,
] as const;
const D = [
  7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
  3.754408661907416,
] as const;

const P_LOW = 0.02425;
const P_HIGH = 1 - 0.02425;

export function normPpf(p: number): number {
  if (!(p > 0 && p < 1)) {
    throw new RangeError(`normPpf domain: p must be in (0, 1), got ${p}`);
  }
  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      ((((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
        ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1))
    );
  }
  if (p > P_HIGH) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(
        (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
        ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
      )
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) /
    (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1)
  );
}
