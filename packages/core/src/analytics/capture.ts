// SPDX-License-Identifier: MIT

import { bs } from '../pricing/blackScholes.ts';
import { Mulberry32 } from '../pricing/prng.ts';
import { strikeForCallDelta } from '../pricing/strike.ts';
import { fsum } from '../pricing/sum.ts';
import { exposure } from './exposure.ts';
import type { PreparedStructure } from '../model/structure.ts';
import type { CaptureScenario } from '../schema/types.ts';

/** Below this many conditioned paths a cell returns null rather than a number. */
export const MIN_CONDITIONED_PATHS = 50;

/**
 * Round half to even — Python's `round()`, which is *not* `Math.round`.
 *
 * This exists for one line: `steps = max(1, round(horizon_days / tenor_days))`.
 * For the 14-day cell of the default grid that is `round(91/14)` = `round(6.5)`,
 * which Python gives as **6** and `Math.round` gives as **7**. Seven steps
 * instead of six re-strikes the overwrite an extra time and changes the cell
 * completely — and the failure presents as a wrong capture number, which
 * COMPUTATIONAL_SPEC.md §11 tells you to blame on the PRNG. It is not the PRNG.
 */
export function bankersRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export interface CaptureCell {
  capture: number | null;
  conditioned_paths: number;
}

export interface CaptureParams {
  tenorDays: number;
  delta: number;
  horizonDays: number;
  referenceMove: number;
  referenceVol: number;
  paths: number;
  seed: number;
  /** Defaults to the structure's own observed short-call spot notional. */
  overwrite?: number;
  band?: number;
}

/**
 * Upside capture — a Monte Carlo of the overwrite, calibrated to the
 * structure's own observed cap notional. Spec section 8.
 *
 * For each step of length `tenor_days`: strike the call at the target delta
 * from the *then-current* level, collect the premium, evolve the reference one
 * step, pay the call's intrinsic value.
 *
 *   ret = (S'/S − 1) + overwrite·[premium·e^(r·dt) − max(0, S' − K)] / S
 *
 * **Draw order is part of the specification.** For each time step, iterate
 * paths in ascending index and draw one normal each. Changing the loop nesting
 * changes every result.
 *
 * Capture is the mean position return divided by the mean reference return,
 * **conditioned** on paths finishing within `band` of `reference_move`.
 * Conditioning rather than taking a raw ratio is deliberate: a ratio of two
 * small numbers is unstable by construction as the denominator approaches zero,
 * and produces figures like "beta 2.40" that mean nothing.
 *
 * Two framings that must survive into the copy. Overwriting is not a permanent
 * haircut — it is a positive-carry trade with a truncated up-tail, and when the
 * call expires out of the money the position keeps the full move *plus* the
 * premium. And a constant-delta overwrite is not a directional view: strike
 * distance is an inverse proxy for the cost of downside skew, not a forecast.
 */
export function capture(s: PreparedStructure, p: CaptureParams): CaptureCell {
  const overwrite = p.overwrite ?? exposure(s).values.short_call_spot_notional ?? 0;
  const band = p.band ?? 0.02;
  const r = s.r;
  const q = s.doc.underlyings[s.referenceId]?.dividend_yield ?? 0;

  const steps = Math.max(1, bankersRound(p.horizonDays / p.tenorDays));
  const dt = p.horizonDays / steps / 365.0;
  const mu = Math.log(1.0 + p.referenceMove) / (p.horizonDays / 365.0);

  const rng = new Mulberry32(p.seed);
  const S = new Array<number>(p.paths).fill(1.0);
  const nav = new Array<number>(p.paths).fill(1.0);

  const drift = (mu - 0.5 * p.referenceVol * p.referenceVol) * dt;
  const diffusion = p.referenceVol * Math.sqrt(dt);

  for (let step = 0; step < steps; step++) {
    for (let i = 0; i < p.paths; i++) {
      const Si = S[i] as number;
      const K = strikeForCallDelta(Si, dt, r, q, p.referenceVol, p.delta);
      const premium = bs(Si, K, dt, r, q, p.referenceVol, 'call');
      const z = rng.nextNormal();
      const S2 = Si * Math.exp(drift + diffusion * z);
      const ret =
        S2 / Si - 1.0 + (overwrite * (premium * Math.exp(r * dt) - Math.max(0, S2 - K))) / Si;
      nav[i] = (nav[i] as number) * (1.0 + ret);
      S[i] = S2;
    }
  }

  const selected: number[] = [];
  for (let i = 0; i < p.paths; i++) {
    if (Math.abs((S[i] as number) - 1.0 - p.referenceMove) < band) selected.push(i);
  }
  if (selected.length < MIN_CONDITIONED_PATHS) {
    return { capture: null, conditioned_paths: selected.length };
  }

  const meanNav = fsum(selected.map((i) => (nav[i] as number) - 1.0)) / selected.length;
  const meanRef = fsum(selected.map((i) => (S[i] as number) - 1.0)) / selected.length;
  return { capture: meanNav / meanRef, conditioned_paths: selected.length };
}

/**
 * The capture grid, keyed as the vectors key it: `${tenor}d_${delta}`.
 *
 * **Preserve the counter-intuitive result**: shorter tenors forfeit *less* in a
 * trend, because each roll re-strikes from the new level. It is the single most
 * useful thing on the page for someone comparing structures, and it is the
 * opposite of what most readers expect.
 */
export function captureGrid(
  s: PreparedStructure,
  cap: CaptureScenario,
): Record<string, CaptureCell> {
  const tenors = cap.tenor_grid_days ?? [14, 30, 91];
  const deltas = cap.delta_grid ?? [0.3, 0.25, 0.2];
  const out: Record<string, CaptureCell> = {};
  for (const t of tenors) {
    for (const d of deltas) {
      out[`${t}d_${d.toFixed(2)}`] = capture(s, {
        tenorDays: t,
        delta: d,
        horizonDays: cap.horizon_days ?? 91,
        referenceMove: cap.reference_move ?? 0.152,
        referenceVol: cap.reference_vol ?? 0.16,
        paths: cap.paths ?? 20000,
        seed: cap.seed ?? 11,
        ...(cap.overwrite !== undefined ? { overwrite: cap.overwrite } : {}),
        ...(cap.band !== undefined ? { band: cap.band } : {}),
      });
    }
  }
  return out;
}

/**
 * What a capture shortfall *means* depends on the architecture, and reporting
 * one number across both without the label is a category error.
 *
 * - Basket and reference-tracking structures with rolling caps: a shortfall is
 *   realised and permanent. The calls settled in the money and the money is
 *   gone.
 * - Single-outcome-period structures: a mid-period shortfall is largely
 *   unrealised time value that mechanically reverses by expiry. A structure
 *   showing 52% capture today may be on track for 92% at expiry.
 */
export type CaptureRealisation = 'realised_and_permanent' | 'largely_unrealised_time_value';

export function captureRealisation(architecture: string, distinctCapExpiries: number): CaptureRealisation {
  const singleOutcomePeriod = architecture === 'synthetic' || distinctCapExpiries <= 1;
  return singleOutcomePeriod ? 'largely_unrealised_time_value' : 'realised_and_permanent';
}
