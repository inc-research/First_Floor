// SPDX-License-Identifier: CC-BY-4.0

import type { AssumptionLine } from '@first-floor/core';
import type { Voice } from './types.ts';

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const signedPct = (x: number): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;

/**
 * Render one assumption line in a given voice.
 *
 * **Assumption lines appear in both voices.** The temptation is to strip them
 * from plain mode because they are hard to phrase simply; that is exactly
 * backwards (D-24). A non-specialist needs to know that the frightening number
 * rests on a rate nobody measured rather more than a specialist does.
 */
export function renderAssumption(line: AssumptionLine, voice: Voice): string {
  const plain = voice === 'plain';

  switch (line.kind) {
    case 'as_of':
      return plain
        ? `Describes the position as it stood on ${line.date}.`
        : `as_of ${line.date}`;

    case 'held_asset_response':
      return plain
        ? `Assumes the holdings fall ${line.beta_down.toFixed(2)} times as far as the index and rise ${line.beta_up.toFixed(2)} times as far. This rate was ${line.source === 'assumed' ? 'assumed, not measured' : 'supplied by you'}.`
        : `β_down ${line.beta_down.toFixed(3)}, β_up ${line.beta_up.toFixed(3)} (source: ${line.source})`;

    case 'held_asset_response_fixed':
      return plain
        ? 'Assumes the holdings move exactly in step with the index. This figure does not vary that rate, so no rate is quoted for it.'
        : 'held-asset response fixed at 1.0; this block does not consult β_d';

    case 'vol_beta':
      return plain
        ? `Assumes option prices rise by ${(line.value * 100).toFixed(0)} points of volatility for every whole-number fall in the index.`
        : `vol_beta ${line.value.toFixed(2)}`;

    case 'vol_beta_swept':
      return plain
        ? `Shown across a range of assumptions about how much option prices rise as markets fall: ${line.values.map((v) => v.toFixed(2)).join(', ')}.`
        : `vol_beta swept over ${line.values.map((v) => v.toFixed(2)).join(', ')}`;

    case 'beta_swept':
      return plain
        ? `Shown across a range of rates at which the holdings might fall relative to the index: ${line.values.map((v) => v.toFixed(2)).join(', ')}. None of these is measured from the file.`
        : `β_down swept over ${line.values.map((v) => v.toFixed(2)).join(', ')} (input, not estimated)`;

    case 'reference_moves':
      return plain
        ? `Quoted at index moves of ${line.values.map(signedPct).join(', ')}.`
        : `reference moves ${line.values.map(signedPct).join(', ')}`;

    case 'decline_path':
      return plain
        ? `Follows one steady decline of ${pct(line.total_move)} over ${line.horizon_days} days, with the calls that were sold ${line.include_call_overlay ? 'included' : 'left out'}.`
        : `monotone path to ${pct(line.total_move)} over ${line.horizon_days}d; call overlay ${line.include_call_overlay ? 'included' : 'excluded'}`;

    case 'capture_simulation':
      return plain
        ? `Based on ${line.paths.toLocaleString('en')} simulated paths over ${line.horizon_days} days, keeping only those finishing within ${pct(line.band)} of a ${signedPct(line.reference_move)} move. Repeats exactly on the same starting number (${line.seed}).`
        : `${line.paths} paths, seed ${line.seed}, horizon ${line.horizon_days}d, σ_ref ${line.reference_vol.toFixed(2)}, conditioned within ±${pct(line.band)} of ${signedPct(line.reference_move)}, overwrite ${(line.overwrite * 100).toFixed(2)}%`;

    case 'modelled_vols':
      return plain
        ? `${line.leg_ids.join(', ')} came with no price, so their values are modelled at an assumed ${pct(line.fallback_iv)} rather than measured.`
        : `modelled at fallback_iv ${line.fallback_iv.toFixed(2)}: ${line.leg_ids.join(', ')}`;

    case 'composition_as_of':
      return plain
        ? `Compared against an index list dated ${line.date}, ${line.gap_days === 0 ? 'the same day' : `${Math.abs(line.gap_days)} days apart`}. Source: ${line.source_note}`
        : `composition as_of ${line.date} (gap ${line.gap_days}d). Source: ${line.source_note}`;

    case 'not_a_collectible_outcome':
      return plain
        ? 'The contracts expire on different dates, so there is no single day on which all of these payments arrive. Read this as arithmetic about a level, not as an amount to collect.'
        : 'Not a collectible outcome: tranches expire across several dates. Report alongside the gradual-decline figure.';

    case 'single_path_not_a_distribution':
      return plain
        ? 'One hand-built path, not an average across many.'
        : 'Single path, not a distribution.';

    case 'cross_sectional_not_behavioural':
      return plain
        ? 'Describes the list as it stands today. It says nothing about how the holdings have behaved or might behave.'
        : 'Cross-sectional statistic; no behavioural claim.';
  }
}
