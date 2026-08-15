// SPDX-License-Identifier: MIT

import { terminalFloor, terminalValue, type TerminalFloor } from './analytics/geometry.ts';
import { mtmValue } from './analytics/mark.ts';
import type { PreparedStructure } from './model/structure.ts';
import type { Scenario } from './schema/types.ts';

/**
 * The four closed-form parameters. Deliberately not extensible to the capture
 * grid: that is Monte Carlo, is computed once per report, and is not draggable
 * (D-20).
 */
export type SweepParameter = 'beta_down' | 'beta_up' | 'vol_beta' | 'reference_move';

/** The reference move the closed-form figures are quoted at when not swept. */
export const DEFAULT_REFERENCE_MOVE = -0.2;

/**
 * Every assumption in force at a point. Present on each point rather than once
 * on the result, because a renderer that shows a single slider position must be
 * able to print that position's assumptions without reaching back up (invariant
 * 1).
 */
export interface SweepAssumptions {
  beta_down: number;
  beta_up: number;
  vol_beta: number;
  reference_move: number;
  /**
   * Mark-to-market never consults beta. Carried explicitly so a renderer cannot
   * caption the mtm figure with the swept beta. See erratum E-06.
   */
  mtm_held_asset_response: 1.0;
}

export interface SweepPoint {
  /** The swept parameter's value at this point. */
  value: number;
  terminal: number;
  mtm: number;
  floor: TerminalFloor;
  assumptions: SweepAssumptions;
}

export interface SweepResult {
  parameter: SweepParameter;
  points: SweepPoint[];
}

export interface SweepOptions {
  /** Where the closed-form figures are quoted, unless `reference_move` is the swept parameter. */
  referenceMove?: number;
}

/**
 * Evaluate the closed-form figures across a range of one parameter.
 *
 * **A sweep is a core function, not a UI behaviour** (D-19). The web page
 * renders this as a slider and the MCP server returns it as a table; if the
 * logic lived in an event handler the two surfaces would have diverged the
 * first time either changed.
 *
 * Only the closed-form figures appear here. `vol_beta` in particular must be
 * swept and never reported bare — the spread between 0 and 1.0 at −20% is over
 * four percentage points on example A, which is the size of the assumption.
 */
export function sweep(
  structure: PreparedStructure,
  scenario: Scenario,
  parameter: SweepParameter,
  values: readonly number[],
  options: SweepOptions = {},
): SweepResult {
  const baseBetaDown = scenario.held_asset_response?.beta_down ?? structure.response.beta_down;
  const baseBetaUp = scenario.held_asset_response?.beta_up ?? structure.response.beta_up;
  const baseVolBeta = scenario.vol_beta ?? 0.65;
  const baseMove = options.referenceMove ?? DEFAULT_REFERENCE_MOVE;

  const points = values.map((v) => {
    const betaDown = parameter === 'beta_down' ? v : baseBetaDown;
    const betaUp = parameter === 'beta_up' ? v : baseBetaUp;
    const volBeta = parameter === 'vol_beta' ? v : baseVolBeta;
    const move = parameter === 'reference_move' ? v : baseMove;

    return {
      value: v,
      terminal: terminalValue(structure, move, betaDown, betaUp),
      mtm: mtmValue(structure, move, volBeta),
      floor: terminalFloor(structure, betaDown),
      assumptions: {
        beta_down: betaDown,
        beta_up: betaUp,
        vol_beta: volBeta,
        reference_move: move,
        mtm_held_asset_response: 1.0 as const,
      },
    };
  });

  return { parameter, points };
}

/** Run the sweep a scenario document declares, if it declares one. */
export function sweepFromScenario(
  structure: PreparedStructure,
  scenario: Scenario,
  options: SweepOptions = {},
): SweepResult | null {
  if (!scenario.sweep) return null;
  return sweep(structure, scenario, scenario.sweep.parameter, scenario.sweep.values, options);
}
