// SPDX-License-Identifier: MIT

import type { HeldAssetResponse } from '../schema/types.ts';
import type { PreparedStructure } from '../model/structure.ts';

/** Defaults for the floor scan. Spec section 4. */
export const FLOOR_SCAN_LO = -0.95;
export const FLOOR_SCAN_STEPS = 1901;
/** Flatness is approximate. 5bp, not 1e-6 — see `terminalFloor`. */
export const FLATNESS_TOLERANCE = 5e-4;

/**
 * Terminal value at expiry, as a return on today's NAV. Spec section 4.
 *
 *   terminal(d) = w_eq·(1 + β·d) + cash + Σ sign·units·intrinsic(S₀ᵢ(1+d), Kᵢ)/NAV − 1
 *
 * with β = β_down for d ≤ 0 and β_up above it.
 *
 * Note the accumulation: a plain left-to-right loop, deliberately *not* the
 * exact `fsum` used elsewhere in this package. The oracle accumulates this one
 * sequentially, and D-33's exact-summation rule is per function rather than
 * global — using `fsum` here would be as wrong as using a naive loop in
 * `exposure`. The golden vectors depend on both choices.
 */
export function terminalValue(
  s: PreparedStructure,
  drop: number,
  betaDown = 1.0,
  betaUp = 1.0,
): number {
  const b = drop <= 0 ? betaDown : betaUp;
  let val = s.wEq * (1.0 + b * drop) + s.cashWeight;
  for (const l of s.legs) {
    const S = l.S0 * (1.0 + drop);
    const intrinsic = Math.max(0, l.right === 'call' ? S - l.K : l.K - S);
    val += (l.sign * l.units * intrinsic) / s.nav;
  }
  return val - 1.0;
}

export interface TerminalFloor {
  value: number;
  at_reference_move: number;
  flat_below: boolean;
  flat_tolerance: number;
}

/**
 * Minimum terminal value over a grid of reference moves. Spec section 4.
 *
 * Two subtleties, both of which were defects in the oracle's first draft:
 *
 * Where the payoff is flat below the ladder the minimum is attained over an
 * *interval*, not at a point. Report the **shallowest** move that attains it —
 * the point at which further decline stops mattering. Reporting the grid edge
 * instead implies the floor only binds at −95%, which is wrong and confusing.
 *
 * And flatness is approximate. A ladder with Λ ≠ 1 leaves a residual slope
 * invisible at any single point but material over a deep decline, so flatness
 * is tested against 5bp and the tolerance is reported alongside the verdict. A
 * tolerance of 1e-6 declares nothing flat.
 *
 * The grid is built by the same arithmetic as the oracle's, not by an
 * equivalent-looking expression: `i * 0.0005` and `i * 0.95 / 1900` are not the
 * same double, and which grid points exist determines the reported attachment.
 *
 * **This figure is not a collectible outcome.** Where tranches expire on several
 * dates spanning months there is no calendar date on which all of them pay. It
 * must be reported alongside the gradual-decline figure, with that caveat.
 */
export function terminalFloor(
  s: PreparedStructure,
  betaDown = 1.0,
  lo = FLOOR_SCAN_LO,
  steps = FLOOR_SCAN_STEPS,
  tol = FLATNESS_TOLERANCE,
): TerminalFloor {
  let vmin = Infinity;
  const grid: number[] = new Array(steps);
  const vals: number[] = new Array(steps);
  for (let i = 0; i < steps; i++) {
    const d = lo + (i * -lo) / (steps - 1);
    const v = terminalValue(s, d, betaDown);
    grid[i] = d;
    vals[i] = v;
    if (v < vmin) vmin = v;
  }

  let shallowest = -Infinity;
  let attaining = 0;
  for (let i = 0; i < steps; i++) {
    if ((vals[i] as number) <= vmin + tol) {
      attaining++;
      const d = grid[i] as number;
      if (d > shallowest) shallowest = d;
    }
  }

  return {
    value: vmin,
    at_reference_move: shallowest,
    flat_below: attaining > 1,
    flat_tolerance: tol,
  };
}

/**
 * The β-conditional floor table — the project's central finding in six numbers.
 *
 * Below the lowest strike every long put is in the money, so the position's
 * slope with respect to the reference is `w_eq·β_d/S₀ − Σ units/NAV`, which is
 * zero **if and only if** β_d = Λ. The correct reading of Λ ≈ 1 is that the
 * ladder is sized to neutralise a beta-one held asset; whether the held asset
 * *is* beta-one is an assumption, not a fact.
 *
 * Where β_d exceeds Λ, a residual short exposure of `w_eq·(β_d − Λ)` survives
 * below the ladder and there is no floor at all — only a shallower slope.
 *
 * Above the cap the same term flips sign, so a high-beta held asset *adds* to
 * return in a strong rally. The honest framing is a risk transformation rather
 * than a hidden defect: better in rallies, worse in selloffs, and invisible in
 * a symmetric tracking-error statistic that averages the two.
 */
export function terminalByBeta(
  s: PreparedStructure,
  betas: readonly number[],
  drops: readonly number[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const b of betas) {
    const row: Record<string, number> = {};
    for (const d of drops) {
      row[formatDrop(d)] = terminalValue(s, d, b, b);
    }
    out[b.toFixed(2)] = row;
  }
  return out;
}

/** Python's `f"{d:+.2f}"`: always signed, two decimals. */
function formatDrop(d: number): string {
  return (d < 0 ? '-' : '+') + Math.abs(d).toFixed(2);
}

/**
 * The slope of terminal value with respect to the reference below the ladder,
 * per unit of reference move: `w_eq·(β_d − Λ)`, negative when β exceeds Λ.
 *
 * Exposed because it is what makes the β-conditional table legible — the table
 * shows the consequence, this shows the mechanism — and because the property
 * test that guards the whole result checks the two against each other.
 */
export function residualSlopeBelowLadder(
  s: PreparedStructure,
  lambda: number,
  betaDown: number,
): number {
  return s.wEq * (betaDown - lambda);
}

/** The scenario a geometry figure was computed under. Invariant 1. */
export interface GeometryAssumptions {
  held_asset_response: HeldAssetResponse;
}
