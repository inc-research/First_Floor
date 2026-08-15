// SPDX-License-Identifier: MIT

import {
  buildReport,
  prepareStructure,
  validateReferenceComposition,
  validateScenario,
  validateStructure,
  type CollaredStructure,
  type Problem,
  type ReferenceComposition,
  type Report,
  type Scenario,
} from '@first-floor/core';
import type { Voice } from '@first-floor/copy';

export type View = 'start' | 'manual' | 'review' | 'report' | 'limitations';

export interface SliderState {
  betaDown: number;
  betaUp: number;
  volBeta: number;
  referenceMove: number;
}

export interface AppState {
  view: View;
  voice: Voice;
  /** The document under review, as text, so the user can edit it freely. */
  draft: string;
  structure: CollaredStructure | null;
  scenario: Scenario;
  composition: ReferenceComposition | null;
  problems: Problem[];
  report: Report | null;
  sliders: SliderState;
}

export const DEFAULT_SCENARIO: Scenario = {
  schema_version: '0.2.0',
  vol_beta: 0.65,
  fallback_iv: 0.2,
  held_asset_response: { beta_down: 1.0, beta_up: 1.0, source: 'assumed' },
  decline: {
    total_move: -0.3,
    horizon_days: 365,
    include_call_overlay: false,
    replacement: { floor_strike_pct_of_spot: 0.9, floor_tenor_days: 365, floor_iv: 0.25 },
  },
  capture: {
    horizon_days: 91,
    reference_move: 0.152,
    reference_vol: 0.16,
    paths: 20000,
    seed: 11,
    tenor_grid_days: [14, 30, 91],
    delta_grid: [0.3, 0.25, 0.2],
  },
};

export function initialState(): AppState {
  return {
    view: 'start',
    voice: 'plain',
    draft: '',
    structure: null,
    scenario: structuredClone(DEFAULT_SCENARIO),
    composition: null,
    problems: [],
    report: null,
    sliders: { betaDown: 1.0, betaUp: 1.0, volBeta: 0.65, referenceMove: -0.2 },
  };
}

/**
 * Parse and validate the draft document. Never throws: a malformed paste is an
 * ordinary state of the review step, not an error condition, and the review
 * step exists precisely so that it surfaces here rather than downstream as a
 * plausible-looking wrong number (D-23).
 */
export function validateDraft(state: AppState): { structure: CollaredStructure | null; problems: Problem[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(state.draft);
  } catch (e) {
    return {
      structure: null,
      problems: [{ path: '', message: `That is not valid JSON: ${(e as Error).message}` }],
    };
  }
  const result = validateStructure(parsed);
  return result.ok
    ? { structure: result.document, problems: [] }
    : { structure: null, problems: result.problems };
}

/** Build the report for the current structure and scenario. */
export function computeReport(state: AppState): Report | null {
  if (!state.structure) return null;
  const scenario = withSliders(state);
  const prepared = prepareStructure(state.structure, scenario);
  return buildReport(prepared, scenario, { composition: state.composition });
}

/**
 * The scenario as the sliders currently set it.
 *
 * The sliders bind only to closed-form parameters (D-20). `reference_move` is
 * held separately because it is where figures are quoted, not a property of the
 * scenario document.
 */
export function withSliders(state: AppState): Scenario {
  return {
    ...state.scenario,
    vol_beta: state.sliders.volBeta,
    held_asset_response: {
      beta_down: state.sliders.betaDown,
      beta_up: state.sliders.betaUp,
      source: 'assumed',
    },
  };
}

export function loadScenario(text: string): Scenario | null {
  try {
    const r = validateScenario(JSON.parse(text));
    return r.ok ? r.document : null;
  } catch {
    return null;
  }
}

export function loadComposition(text: string): ReferenceComposition | null {
  try {
    const r = validateReferenceComposition(JSON.parse(text));
    return r.ok ? r.document : null;
  } catch {
    return null;
  }
}
