// SPDX-License-Identifier: MIT

import { bs, type Right } from './blackScholes.ts';

export const IV_LOWER_BOUND = 1e-4;
export const IV_UPPER_BOUND = 5.0;
export const IV_ITERATIONS = 200;

/** Why an inverted volatility should not be trusted. `null` means it should. */
export type IvBlocker =
  | 'at_lower_bound'
  | 'at_upper_bound'
  | 'price_below_underflow_floor';

export interface ImpliedVolResult {
  /** Always populated — the raw bisection result, for vector comparison. */
  sigma: number;
  /** Non-null when the figure is not a measurement. Blocks the leg's mark-to-market. */
  blocker: IvBlocker | null;
}

/**
 * Implied volatility by bisection on sigma in [1e-4, 5.0], 200 iterations.
 * Spec section 1.5.
 *
 * Bisection rather than Newton is deliberate and the spec is emphatic about it:
 * Black-Scholes is monotone in sigma so bisection cannot fail to converge,
 * whereas Newton's vega denominator vanishes for deep out-of-the-money legs and
 * produces spurious solutions.
 *
 * The returned `sigma` is exactly what `reference/oracle.py` returns, so it can
 * be compared against the golden vectors without special-casing. `blocker`
 * carries the judgement the oracle does not make.
 */
export function impliedVol(
  price: number,
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  right: Right,
): ImpliedVolResult {
  let lo = IV_LOWER_BOUND;
  let hi = IV_UPPER_BOUND;
  for (let i = 0; i < IV_ITERATIONS; i++) {
    const mid = 0.5 * (lo + hi);
    if (bs(S, K, T, r, q, mid, right) > price) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  const sigma = 0.5 * (lo + hi);
  return { sigma, blocker: classify(sigma, price, S, K, T, r, q, right) };
}

function classify(
  sigma: number,
  price: number,
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  right: Right,
): IvBlocker | null {
  // The two conditions COMPUTATIONAL_SPEC.md section 10 names.
  if (sigma <= 1e-3) return 'at_lower_bound';
  if (sigma >= 4.99) return 'at_upper_bound';

  // A third the spec does not name, found while building vectors/primitives.json.
  //
  // Black-Scholes underflows to exactly 0.0 for a sufficiently far out-of-the-
  // money leg at low volatility. When that happens every sigma below the
  // underflow threshold is a root, and bisection returns the midpoint of the
  // underflow region: a zero mark on a 200-strike call with spot 100 yields a
  // confident-looking 5.66% volatility that neither section 10 condition
  // catches. That is precisely the caveated wrong number invariant 3 forbids,
  // so a price at or below the value at the lower bound is a blocker.
  if (price <= bs(S, K, T, r, q, IV_LOWER_BOUND, right)) {
    return 'price_below_underflow_floor';
  }
  return null;
}
