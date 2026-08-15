// SPDX-License-Identifier: MIT

/**
 * The copy decks.
 *
 * The report is a data structure; two renderers consume it. Same numbers, same
 * caveats, different vocabulary. Plain is the default (D-24).
 *
 * Prose in `plain.ts`, `technical.ts` and `assumptions.ts` is CC BY 4.0 — those
 * explanations are the project's actual contribution and are meant to be
 * quotable and translatable. The surrounding code is MIT.
 */

export { plainDeck } from './plain.ts';
export { technicalDeck } from './technical.ts';
export { renderAssumption } from './assumptions.ts';
export { deckFor, renderReport } from './render.ts';
export {
  BANNED_IN_PLAIN,
  formatFindings,
  lintDeep,
  lintText,
  type LintFinding,
} from './lint.ts';
export type { CopyEntry, Deck, Voice } from './types.ts';
