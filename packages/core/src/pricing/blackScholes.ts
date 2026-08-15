// SPDX-License-Identifier: MIT

import { normCdf } from './normal.ts';

export type Right = 'call' | 'put';

/**
 * Black-Scholes with a continuous dividend yield. Spec section 1.3.
 *
 * When `T <= 0` or `sigma <= 0` this returns intrinsic value rather than NaN.
 * A structure holding an expiring leg is a normal case, not an error — these
 * ladders routinely carry a tranche with days to run.
 */
export function bs(
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  sigma: number,
  right: Right,
): number {
  if (T <= 0 || sigma <= 0) {
    return Math.max(0, right === 'call' ? S - K : K - S);
  }
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / v;
  const d2 = d1 - v;
  if (right === 'call') {
    return S * Math.exp(-q * T) * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  }
  return K * Math.exp(-r * T) * normCdf(-d2) - S * Math.exp(-q * T) * normCdf(-d1);
}

/**
 * Black-Scholes delta. Spec section 1.4.
 *
 * At `T <= 0` delta is +/-1 in the money and 0 otherwise. Note this is the
 * oracle's convention exactly: at-the-money at expiry counts as out of the
 * money, because the comparison is strict.
 */
export function bsDelta(
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  sigma: number,
  right: Right,
): number {
  if (T <= 0 || sigma <= 0) {
    const itm = right === 'call' ? S > K : S < K;
    if (!itm) return 0;
    return right === 'call' ? 1 : -1;
  }
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / v;
  return Math.exp(-q * T) * (right === 'call' ? normCdf(d1) : normCdf(d1) - 1);
}
