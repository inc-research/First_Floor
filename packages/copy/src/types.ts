// SPDX-License-Identifier: MIT
// The prose in this package is licensed CC BY 4.0; see LICENSE-CONTENT.

import type { MetricKey } from '@first-floor/core';

/** Plain is the default (D-24). A specialist meeting plain language is mildly
 * annoyed; a non-specialist meeting `vol_beta 0.65` closes the tab. */
export type Voice = 'plain' | 'technical';

export interface CopyEntry {
  title: string;
  /**
   * How the number comes about. Mechanism, never a verdict.
   *
   * These cannot be generated. They are the highest-value content in the
   * project and are written with the same care as the arithmetic.
   */
  mechanism: string;
  /**
   * "What would make this different." More useful to a non-specialist than any
   * Greek, and required on every figure.
   */
  whatWouldChangeIt: string;
  /** Shown when the figure is blocked, before the blocker's own message. */
  whenAbsent?: string;
}

/**
 * Typed as a total record over `MetricKey`, so adding a metric to the v1 list
 * without writing copy for it fails to compile rather than rendering a blank.
 */
export type Deck = Record<MetricKey, CopyEntry>;
