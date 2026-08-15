// SPDX-License-Identifier: MIT

/**
 * First Floor core — pure functions for collared-structure analytics.
 *
 * No I/O, no network, no DOM. Every surface (the static page, the MCP server)
 * consumes this package; there is one implementation and it is this one (D-13).
 *
 * Implemented through Phase 2 of AGENT_BRIEF.md's build order: schema types and
 * validators, pricing primitives, classification and exposure. Payoff geometry,
 * mark-to-market, gradual decline, capture and report assembly are Phases 3
 * onward and are not here yet.
 */

// Phase 0 — the contract.
export type {
  Capital,
  CollaredStructure,
  Constituent,
  DocumentKind,
  HeldAsset,
  HeldAssetKind,
  HeldAssetResponse,
  LegRole,
  OptionLeg,
  Position,
  ReferenceComposition,
  Right,
  Scenario,
  Underlying,
} from './schema/types.ts';

export {
  SUPPORTED_SCHEMA_VERSION,
  checkSchemaVersion,
  checkStructureReferences,
  validateDocument,
  validateReferenceComposition,
  validateScenario,
  validateStructure,
  type Problem,
  type ValidationResult,
} from './schema/validate.ts';

// Phase 1 — pricing primitives.
export { erf, erfc, normCdf, normPpf } from './pricing/normal.ts';
export { bs, bsDelta } from './pricing/blackScholes.ts';
export {
  IV_ITERATIONS,
  IV_LOWER_BOUND,
  IV_UPPER_BOUND,
  impliedVol,
  type ImpliedVolResult,
  type IvBlocker,
} from './pricing/impliedVol.ts';
export { strikeForCallDelta } from './pricing/strike.ts';
export { Mulberry32 } from './pricing/prng.ts';
export { fsum, fsumBy } from './pricing/sum.ts';

// The prepared model every analytic reads.
export {
  DEFAULT_FALLBACK_IV,
  DEFAULT_MULTIPLIER,
  DEFAULT_RISK_FREE_RATE,
  daysBetween,
  longPuts,
  prepareStructure,
  shortCalls,
  shortPuts,
  syntheticLongs,
  type IvSource,
  type PreparedLeg,
  type PreparedStructure,
} from './model/structure.ts';

// Phase 2 — classification and exposure.
export {
  classify,
  type Architecture,
  type Classification,
  type ClassificationResult,
  type ProtectionKind,
} from './analytics/classify.ts';
export { exposure, type Exposure, type ExposureResult } from './analytics/exposure.ts';

// The blocker model behind invariant 3.
export {
  BLOCKERS,
  blocked,
  explain,
  isMeasured,
  measured,
  type Blocker,
  type BlockerCode,
  type Measured,
} from './diagnostics.ts';
