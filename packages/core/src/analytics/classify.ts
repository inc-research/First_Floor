// SPDX-License-Identifier: MIT

import { BLOCKERS, type Blocker } from '../diagnostics.ts';
import { fsumBy } from '../pricing/sum.ts';
import {
  longPuts,
  shortCalls,
  shortPuts,
  syntheticLongs,
  type PreparedStructure,
} from '../model/structure.ts';

export type Architecture = 'synthetic' | 'reference_tracking' | 'basket' | 'unclassified';
export type ProtectionKind = 'put_spread' | 'plain_put' | 'none';

/** Shaped to match the `classification` block of the golden vectors exactly. */
export interface Classification {
  architecture: Architecture;
  protection_kind: ProtectionKind;
  basis_live: boolean;
  protection_continues_below_lowest_strike: boolean;
  floor_tranches: number;
  cap_tranches: number;
  distinct_floor_expiries: number;
  distinct_cap_expiries: number;
  mean_floor_remaining_days: number | null;
  mean_cap_remaining_days: number | null;
  reset_asymmetry_ratio: number | null;
}

export interface ClassificationResult {
  values: Classification;
  blockers: Blocker[];
}

/**
 * Classification, derived from the legs themselves and never trusted from the
 * `role` hints on them. Spec section 2.
 *
 * Architecture precedence is `synthetic` first, then the held-asset kind or
 * constituent count. The spec lists the tests without stating an order, which
 * matters: example C classifies as `synthetic` even though its held asset
 * weight is zero, because a long call struck near zero is a stock substitute
 * and that fact dominates whatever the held asset is doing.
 *
 * `unclassified` is a legitimate output, not a failure.
 */
export function classify(s: PreparedStructure): ClassificationResult {
  const puts = longPuts(s);
  const calls = shortCalls(s);
  const nNames = s.doc.held_asset.constituents?.length ?? 0;

  let architecture: Architecture;
  if (syntheticLongs(s).length > 0) {
    architecture = 'synthetic';
  } else if (s.heldAssetKind === 'reference_tracking_fund' || (nNames > 0 && nNames <= 2)) {
    architecture = 'reference_tracking';
  } else if (s.heldAssetKind === 'basket' || nNames >= 3) {
    architecture = 'basket';
  } else {
    architecture = 'unclassified';
  }

  /**
   * A plain long put continues to pay indefinitely below its strike, whereas
   * below a put spread's lower strike there is no floor at all — losses resume
   * one-for-one on a shifted curve. This distinction changes the tail
   * completely and has to be surfaced, not buried in a footnote.
   */
  const protection_kind: ProtectionKind =
    shortPuts(s).length > 0 ? 'put_spread' : puts.length > 0 ? 'plain_put' : 'none';

  const meanDays = (legs: typeof puts): number | null =>
    legs.length > 0 ? (fsumBy(legs, (l) => l.T) / legs.length) * 365 : null;

  const floorLife = meanDays(puts);
  const capLife = meanDays(calls);

  /**
   * The structural fact from which most path behaviour follows. A fund whose
   * floor resets annually and whose cap resets fortnightly sits near 20 and
   * behaves very differently in a trend from one sitting near 1.
   *
   * Guarded on truthiness rather than null to match the oracle: a mean life of
   * exactly zero — every tranche expiring today — yields no ratio rather than a
   * division by zero.
   */
  const reset_asymmetry_ratio = floorLife && capLife ? floorLife / capLife : null;

  const blockers: Blocker[] = [];
  if (puts.length === 0) blockers.push(BLOCKERS.noLongPuts());
  if (calls.length === 0) blockers.push(BLOCKERS.noShortCalls());

  return {
    values: {
      architecture,
      protection_kind,
      basis_live: architecture === 'basket',
      protection_continues_below_lowest_strike: protection_kind === 'plain_put',
      floor_tranches: puts.length,
      cap_tranches: calls.length,
      distinct_floor_expiries: new Set(puts.map((l) => l.T)).size,
      distinct_cap_expiries: new Set(calls.map((l) => l.T)).size,
      mean_floor_remaining_days: floorLife,
      mean_cap_remaining_days: capLife,
      reset_asymmetry_ratio,
    },
    blockers,
  };
}
