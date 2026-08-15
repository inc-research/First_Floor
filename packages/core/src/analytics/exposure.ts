// SPDX-License-Identifier: MIT

import { BLOCKERS, type Blocker } from '../diagnostics.ts';
import { bsDelta } from '../pricing/blackScholes.ts';
import { fsum, fsumBy } from '../pricing/sum.ts';
import { longPuts, shortCalls, type PreparedStructure } from '../model/structure.ts';

/** Shaped to match the `exposure` block of the golden vectors exactly. */
export interface Exposure {
  held_asset_weight: number;
  cash_weight: number;
  put_spot_notional: number;
  insured_value: number;
  short_call_spot_notional: number;
  gross_option_notional: number;
  option_book_value: number | null;
  weights_reconcile: number | null;
  weights_reconcile_blocked_by: string | null;
  delta_cancellation_ratio: number | null;
  average_attachment: number | null;
  lowest_attachment: number | null;
  net_delta: number;
}

export interface ExposureResult {
  values: Exposure;
  blockers: Blocker[];
}

/**
 * Notional accounting, Lambda, attachment and net delta. Spec section 3.
 *
 * Market value is nearly useless for these structures; notional is everything.
 * A ladder worth 0.3% of capital can control twice capital in tracked exposure
 * — on example A, gross notional is 196% of capital against an option book
 * worth 0.3%. That is offsetting rather than leverage: the legs face opposite
 * directions and the calls are covered by the held asset. What it creates is
 * basis, not gearing.
 */
export function exposure(s: PreparedStructure): ExposureResult {
  const nav = s.nav;
  const puts = longPuts(s);
  const calls = shortCalls(s);
  const blockers: Blocker[] = [];

  const put_spot_notional = fsumBy(puts, (l) => l.units * l.S0) / nav;
  const insured_value = fsumBy(puts, (l) => l.units * l.K) / nav;
  const short_call_spot_notional = fsumBy(calls, (l) => l.units * l.S0) / nav;
  const gross_option_notional = fsumBy(s.legs, (l) => l.units * l.S0) / nav;

  /**
   * Weights reconciliation. If any leg lacks a mark this identity is not
   * computable, so it returns null with a stated blocker.
   *
   * Returning 0.0 here is a defect, and it was one in the oracle's first draft
   * — caught by the Type C example, which has no marks at all. This is the
   * pattern invariant 3 and D-16 name.
   */
  const unmarked = s.legs.filter((l) => l.mark === null);
  const haveMarks = unmarked.length === 0;
  const option_book_value = haveMarks
    ? fsumBy(s.legs, (l) => l.sign * l.units * (l.mark as number)) / nav
    : null;
  if (!haveMarks) blockers.push(BLOCKERS.noMarks(unmarked.map((l) => l.id)));

  /**
   * Delta cancellation ratio. The quantity on which the headline result turns,
   * evaluated in the puts' own underlying units.
   *
   * Lambda is the held-asset beta at which the ladder exactly neutralises the
   * equity delta below the lowest strike. The correct reading of Lambda ~ 1 is
   * that the ladder is sized to neutralise a beta-one held asset — whether the
   * held asset actually is beta-one is an assumption, not a fact.
   */
  let delta_cancellation_ratio: number | null = null;
  let average_attachment: number | null = null;
  let lowest_attachment: number | null = null;

  if (puts.length > 0) {
    const S0 = (puts[0] as { S0: number }).S0;
    if (s.wEq > 0) {
      delta_cancellation_ratio = (fsumBy(puts, (l) => l.units) / nav) * (S0 / s.wEq);
    }
    /**
     * Average attachment is *not* a floor — compute the floor, never infer it.
     * On example A the two nearly coincide, but only because put spot notional
     * approximately equalling w_eq was a design choice.
     */
    average_attachment = fsumBy(puts, (l) => l.K) / puts.length / S0 - 1;
    lowest_attachment = Math.min(...puts.map((l) => l.K)) / S0 - 1;
  } else {
    blockers.push(BLOCKERS.noLongPuts());
  }

  if (s.wEq <= 0) blockers.push(BLOCKERS.noHeldAsset());

  /**
   * Net delta: w_eq plus the notional-weighted delta of every leg.
   *
   * Legs with no mark and no stated volatility are priced off the fallback, so
   * this figure is part measurement and part assumption wherever that happens.
   * The oracle applies the same constant silently; here the legs concerned are
   * named, so a report can say which.
   */
  const modelled = s.legs.filter((l) => l.ivSource === 'fallback');
  if (modelled.length > 0) blockers.push(BLOCKERS.ivModelled(modelled.map((l) => l.id)));

  const atBound = s.legs.filter((l) => l.ivBlocker === 'at_lower_bound' || l.ivBlocker === 'at_upper_bound');
  if (atBound.length > 0) blockers.push(BLOCKERS.ivAtBound(atBound.map((l) => l.id)));

  const underflow = s.legs.filter((l) => l.ivBlocker === 'price_below_underflow_floor');
  if (underflow.length > 0) blockers.push(BLOCKERS.ivUnderflow(underflow.map((l) => l.id)));

  const net_delta =
    s.wEq * 1.0 +
    fsum(
      s.legs.map(
        (l) => (l.sign * l.units * bsDelta(l.S0, l.K, l.T, s.r, l.q, l.iv, l.right) * l.S0) / nav,
      ),
    );

  return {
    values: {
      held_asset_weight: s.wEq,
      cash_weight: s.cashWeight,
      put_spot_notional,
      insured_value,
      short_call_spot_notional,
      gross_option_notional,
      option_book_value,
      weights_reconcile:
        option_book_value === null ? null : s.wEq + option_book_value + s.cashWeight,
      weights_reconcile_blocked_by: haveMarks ? null : 'one or more legs have no mark',
      delta_cancellation_ratio,
      average_attachment,
      lowest_attachment,
      net_delta,
    },
    blockers,
  };
}
