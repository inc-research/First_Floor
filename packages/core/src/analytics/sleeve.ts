// SPDX-License-Identifier: MIT

import { BLOCKERS, type Blocker } from '../diagnostics.ts';
import { fsum, fsumBy } from '../pricing/sum.ts';
import { daysBetween, type PreparedStructure } from '../model/structure.ts';
import type { Constituent, ReferenceComposition } from '../schema/types.ts';

/** Spec section 10: a composition older than this blocks active share. */
export const MAX_COMPOSITION_GAP_DAYS = 90;

/** Shaped to match the `concentration` block of the golden vectors exactly. */
export interface Concentration {
  names: number;
  hhi: number;
  effective_n: number;
  top_weight: number;
  /** The raw sum before normalising. A value far from 1 says the list is partial. */
  weights_sum_raw: number;
}

/**
 * Concentration, from the held asset alone. Spec section 9.
 *
 *   HHI = Σ wᵢ²  (weights normalised to sum to 1)
 *   effective N = 1 / HHI
 *
 * Returns null rather than a zero when there are no constituents — a structure
 * with no held asset has no concentration, and 0 would read as "perfectly
 * diversified", which is the opposite of the truth.
 *
 * These are cross-sectional statistics about today's composition. They are not
 * a claim about how the held asset has behaved or will behave.
 */
export function concentration(s: PreparedStructure): Concentration | null {
  const cons = s.doc.held_asset.constituents ?? [];
  if (cons.length === 0) return null;

  const tot = fsumBy(cons, (c) => c.weight);
  const ws = cons.map((c) => c.weight / tot);
  const hhi = fsum(ws.map((w) => w * w));

  return {
    names: cons.length,
    hhi,
    effective_n: 1.0 / hhi,
    top_weight: Math.max(...ws),
    weights_sum_raw: tot,
  };
}

export interface ActiveShare {
  active_share: number;
  /** Matched names divided by reference names. */
  name_coverage: number;
  matched_names: number;
  reference_names: number;
  held_names: number;
  /** Held but absent from the reference. Counted and reported, never dropped. */
  held_only: string[];
  /** In the reference but not held. Counted and reported, never dropped. */
  reference_only: string[];
  /** Largest absolute active weights, most significant first. */
  largest_active_weights: { name: string; active_weight: number }[];
  composition_as_of: string;
  composition_gap_days: number;
  /**
   * The provenance caveat, carried on the figure so a renderer cannot print the
   * number without it. A composition sourced from a tracking fund's published
   * holdings is that fund's holdings, not the index.
   */
  source_note: string;
}

export interface ActiveShareResult {
  values: ActiveShare | null;
  blockers: Blocker[];
}

/**
 * Active share against a user-supplied reference composition. Spec section 9.
 *
 *   active weight(name) = w_held(name) − w_ref(name)
 *   active share        = ½ · Σ |active weight|
 *   name coverage       = matched names / reference names
 *
 * Omitted entirely when no composition is supplied (D-10) — index membership
 * and weight differences are not knowable from a holdings file, and estimating
 * them would be inventing data.
 *
 * Names present on one side only are counted and reported, never dropped
 * silently: a held name absent from the index carries a full active weight, and
 * quietly discarding it would understate the difference the statistic exists to
 * measure.
 *
 * Both sides are normalised before differencing. A holdings file listing the
 * top 40 names of a 200-name sleeve sums to well under 1, and differencing raw
 * weights against a full index would report an active share driven entirely by
 * the truncation. `weights_sum_raw` on the concentration block is the honest
 * signal that this happened.
 */
export function activeShare(
  s: PreparedStructure,
  composition: ReferenceComposition | null,
): ActiveShareResult {
  if (!composition) {
    return { values: null, blockers: [BLOCKERS.noReferenceComposition()] };
  }

  const held = s.doc.held_asset.constituents ?? [];
  if (held.length === 0) {
    return { values: null, blockers: [BLOCKERS.noConstituents()] };
  }

  const gapDays = daysBetween(composition.as_of, s.asOf);
  if (Math.abs(gapDays) > MAX_COMPOSITION_GAP_DAYS) {
    return { values: null, blockers: [BLOCKERS.compositionStale(Math.round(gapDays))] };
  }

  const heldW = normalise(held);
  const refW = normalise(composition.constituents);

  const names = new Set([...heldW.keys(), ...refW.keys()]);
  const active: { name: string; active_weight: number }[] = [];
  const heldOnly: string[] = [];
  const referenceOnly: string[] = [];
  let matched = 0;

  for (const name of names) {
    const h = heldW.get(name);
    const r = refW.get(name);
    if (h !== undefined && r !== undefined) matched++;
    else if (h !== undefined) heldOnly.push(name);
    else referenceOnly.push(name);
    active.push({ name, active_weight: (h ?? 0) - (r ?? 0) });
  }

  const share = 0.5 * fsum(active.map((a) => Math.abs(a.active_weight)));

  return {
    values: {
      active_share: share,
      name_coverage: refW.size === 0 ? 0 : matched / refW.size,
      matched_names: matched,
      reference_names: refW.size,
      held_names: heldW.size,
      held_only: heldOnly.sort(),
      reference_only: referenceOnly.sort(),
      largest_active_weights: [...active]
        .sort((a, b) => Math.abs(b.active_weight) - Math.abs(a.active_weight))
        .slice(0, 10),
      composition_as_of: composition.as_of,
      composition_gap_days: Math.round(gapDays),
      source_note: composition.source_note,
    },
    blockers: [],
  };
}

/** Weights normalised to sum to 1, keyed by name. Duplicate names are summed. */
function normalise(constituents: readonly Constituent[]): Map<string, number> {
  const raw = new Map<string, number>();
  for (const c of constituents) {
    raw.set(c.name, (raw.get(c.name) ?? 0) + c.weight);
  }
  const total = fsum([...raw.values()]);
  if (total === 0) return raw;
  const out = new Map<string, number>();
  for (const [name, w] of raw) out.set(name, w / total);
  return out;
}
