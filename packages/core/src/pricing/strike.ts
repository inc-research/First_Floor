// SPDX-License-Identifier: MIT

import { normPpf } from './normal.ts';

/**
 * Strike at a target call delta. Spec section 1.6.
 *
 *   d1 = N^-1(delta * e^(qT))
 *   K  = S * exp[(r - q + sigma^2/2)T - d1*sigma*sqrt(T)]
 *
 * Used only inside the capture simulation, where the overwrite is re-struck at
 * a constant delta from the then-current level. A constant-delta overwrite is
 * not a directional view: strike distance is an inverse proxy for the cost of
 * downside skew, not a forecast.
 */
export function strikeForCallDelta(
  S: number,
  T: number,
  r: number,
  q: number,
  sigma: number,
  target: number,
): number {
  const clamped = Math.min(Math.max(target * Math.exp(q * T), 1e-9), 1 - 1e-9);
  const d1 = normPpf(clamped);
  return S * Math.exp((r - q + 0.5 * sigma * sigma) * T - d1 * sigma * Math.sqrt(T));
}
