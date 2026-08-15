// SPDX-License-Identifier: MIT

import { bs } from '../pricing/blackScholes.ts';
import type { PreparedStructure } from '../model/structure.ts';

/** The floor under a shocked volatility. Spec section 6. */
export const MIN_SHOCKED_VOL = 0.02;

/**
 * Mark-to-market under a volatility shock. Spec section 6.
 *
 *   σ_shocked(leg) = max(0.02, σ_leg + vol_beta · max(0, −d))
 *   mtm(d) = w_eq·(1 + d) + cash + Σ sign·units·BS(S₀ᵢ(1+d), Kᵢ, Tᵢ, σ_shocked)/NAV − 1
 *
 * The terminal payoff understates the near-term picture because a sudden
 * decline raises option values. This is the figure that shows it.
 *
 * **Note what the first term does not contain.** The held asset moves
 * `w_eq·(1 + d)`, not `w_eq·(1 + β_d·d)`: this is a β = 1.0 figure by
 * construction and never consults the scenario's `beta_down`. That is
 * intentional — the vol shock is about option value, not held-asset response —
 * but under invariant 1 a renderer must label the block *"held-asset response
 * fixed at 1.0"* rather than printing a beta the number never used. See
 * erratum E-06.
 *
 * Base volatilities come from the legs' own marks, not from a modelled surface.
 * Where a leg supplies neither a mark nor a stated vol its `ivSource` is
 * `fallback`, and the report must say so.
 *
 * Accumulates in a plain loop, matching the oracle. See `geometry.ts`.
 */
export function mtmValue(s: PreparedStructure, drop: number, volBeta: number): number {
  let val = s.wEq * (1.0 + drop) + s.cashWeight;
  for (const l of s.legs) {
    const S = l.S0 * (1.0 + drop);
    const sigma = Math.max(MIN_SHOCKED_VOL, l.iv + volBeta * Math.max(0, -drop));
    val += (l.sign * l.units * bs(S, l.K, l.T, s.r, l.q, sigma, l.right)) / s.nav;
  }
  return val - 1.0;
}

/**
 * The vol_beta table.
 *
 * `vol_beta` is volatility points added per unit of reference drawdown; 0.65
 * means +13 points at −20%. It is a reduced form and its virtue is legibility.
 * **It must be swept and never reported bare** — on example A the spread
 * between vb = 0 and vb = 1.0 at −20% is over four percentage points, which is
 * the size of the assumption and the reason the sweep is mandatory rather than
 * optional.
 */
export function mtmByVolBeta(
  s: PreparedStructure,
  volBetas: readonly number[],
  drops: readonly number[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const v of volBetas) {
    const row: Record<string, number> = {};
    for (const d of drops) {
      row[(d < 0 ? '-' : '+') + Math.abs(d).toFixed(2)] = mtmValue(s, d, v);
    }
    out[v.toFixed(2)] = row;
  }
  return out;
}
