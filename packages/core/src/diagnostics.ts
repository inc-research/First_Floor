// SPDX-License-Identifier: MIT

/**
 * The blocker model behind invariant 3 and D-16: silence beats a caveated wrong
 * number.
 *
 * When an input is missing or a diagnostic fails, the affected metric does not
 * render. It reports what is missing and what the user could supply. Nothing in
 * this file substitutes a default and proceeds quietly.
 *
 * The pattern is the oracle's `weights_reconcile` returning `null` with a
 * stated blocker rather than `0.0` — a real defect in the oracle's first draft,
 * caught by the Type C example.
 */

export type BlockerCode =
  | 'no_marks'
  | 'no_long_puts'
  | 'no_held_asset'
  | 'no_short_calls'
  | 'no_constituents'
  | 'iv_at_bisection_bound'
  | 'iv_below_underflow_floor'
  | 'iv_modelled_not_marked'
  | 'reference_level_residual'
  | 'too_few_conditioned_paths'
  | 'composition_stale'
  | 'no_reference_composition';

export interface Blocker {
  code: BlockerCode;
  /** What is missing, in the report's own voice. */
  message: string;
  /** What the user could supply to unblock it. Required: a blocker with no remedy is a dead end. */
  remedy: string;
  /** Leg ids or constituent names the blocker attaches to, when it is specific. */
  subjects?: string[];
}

/** A quantity that is either measured or explicitly absent, never silently defaulted. */
export type Measured<T> =
  | { value: T; blockers: readonly [] }
  | { value: null; blockers: readonly [Blocker, ...Blocker[]] };

export function measured<T>(value: T): Measured<T> {
  return { value, blockers: [] };
}

export function blocked<T>(first: Blocker, ...rest: Blocker[]): Measured<T> {
  return { value: null, blockers: [first, ...rest] };
}

export function isMeasured<T>(m: Measured<T>): m is { value: T; blockers: readonly [] } {
  return m.value !== null;
}

/**
 * The single sentence a renderer prints in place of the figure. Deliberately
 * states the remedy too — "what would make this different" is more useful to a
 * non-specialist than any Greek.
 */
export function explain(blockers: readonly Blocker[]): string {
  return blockers.map((b) => `${b.message} ${b.remedy}`).join(' ');
}

export const BLOCKERS = {
  noMarks: (legIds: string[]): Blocker => ({
    code: 'no_marks',
    message:
      legIds.length === 1
        ? `Leg ${legIds[0]} has no price, so the option book cannot be valued.`
        : `${legIds.length} legs have no price, so the option book cannot be valued.`,
    remedy: 'Supply mark_per_unit on every leg to see how the weights reconcile.',
    subjects: legIds,
  }),
  noLongPuts: (): Blocker => ({
    code: 'no_long_puts',
    message: 'This structure holds no long puts, so there is no ladder to measure.',
    remedy: 'The floor, attachment and delta cancellation figures apply only to structures that own puts.',
  }),
  noHeldAsset: (): Blocker => ({
    code: 'no_held_asset',
    message: 'This structure holds no underlying assets, only options.',
    remedy:
      'Concentration and the delta cancellation ratio describe a held portfolio; supply held_asset.weight and constituents if there is one.',
  }),
  noShortCalls: (): Blocker => ({
    code: 'no_short_calls',
    message: 'This structure writes no calls, so there is no cap to measure.',
    remedy: 'Reset asymmetry compares floor life against cap life and needs both.',
  }),
  noConstituents: (): Blocker => ({
    code: 'no_constituents',
    message: 'No constituent list was supplied for the held asset.',
    remedy: 'Add held_asset.constituents with name and weight to see concentration.',
  }),
  ivAtBound: (legIds: string[]): Blocker => ({
    code: 'iv_at_bisection_bound',
    message: `The implied volatility for ${legIds.join(', ')} landed on the edge of the search range, which means the price could not be inverted.`,
    remedy: 'Check the mark, or supply implied_vol directly for that leg.',
    subjects: legIds,
  }),
  ivUnderflow: (legIds: string[]): Blocker => ({
    code: 'iv_below_underflow_floor',
    message: `The price for ${legIds.join(', ')} is at or below what this contract is worth at the lowest volatility in the search range, so any answer would be arbitrary.`,
    remedy: 'Check the mark — a zero or stale price produces a plausible-looking number that means nothing.',
    subjects: legIds,
  }),
  ivModelled: (legIds: string[]): Blocker => ({
    code: 'iv_modelled_not_marked',
    message: `${legIds.join(', ')} carry neither a price nor a stated volatility, so their values are modelled rather than measured.`,
    remedy: 'Supply mark_per_unit or implied_vol to replace the assumption with an observation.',
    subjects: legIds,
  }),
  compositionStale: (gapDays: number): Blocker => ({
    code: 'composition_stale',
    message: `The reference composition is dated ${gapDays} days before this position.`,
    remedy: 'Supply a composition from the same date to compare the two holdings.',
  }),
  noReferenceComposition: (): Blocker => ({
    code: 'no_reference_composition',
    message: 'No reference composition was supplied.',
    remedy:
      'Active share compares the held names against the index; supply a reference_composition document to see it.',
  }),
} as const;
