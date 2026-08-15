// SPDX-License-Identifier: MIT

/**
 * Shared fixtures and the vector-comparison harness.
 *
 * Comparison walks parsed values rather than text, because JSON key order and
 * float formatting differ between Python and JavaScript and a textual diff
 * would report differences that are not there.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { prepareStructure, type PreparedStructure } from '../src/model/structure.ts';
import { validateScenario, validateStructure } from '../src/schema/validate.ts';
import type { CollaredStructure, Scenario } from '../src/schema/types.ts';

const ROOT = new URL('../../../', import.meta.url);

export const read = (p: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8'));

/** COMPUTATIONAL_SPEC.md §11: classification, exposure, geometry, mark-to-market, decline. */
export const TOL = 1e-9;
/** §11 as amended by D-35: capture, where cross-runtime libm makes exactness unattainable. */
export const CAPTURE_TOL = 1e-12;

export interface Case {
  name: string;
  structure: string;
  scenario: string;
  vector: string;
}

export const CASES: Case[] = [
  {
    name: 'example A — laddered floor, basket held asset, proxy-ETF puts',
    structure: 'examples/example_a_laddered_floor.json',
    scenario: 'examples/example_scenario.json',
    vector: 'vectors/example_a.json',
  },
  {
    name: 'example C — defined-outcome buffer, hand typed, no marks',
    structure: 'examples/example_c_minimal_hand_typed.json',
    scenario: 'examples/scenario_minimal.json',
    vector: 'vectors/example_c.json',
  },
];

export interface LoadedCase {
  prepared: PreparedStructure;
  scenario: Scenario;
  vector: Record<string, unknown>;
  betaDown: number;
  betaUp: number;
  volBeta: number;
}

export function loadCase(c: Case): LoadedCase {
  const sv = validateStructure(read(c.structure));
  assert.ok(sv.ok, `${c.structure} failed validation`);
  const cv = validateScenario(read(c.scenario));
  assert.ok(cv.ok, `${c.scenario} failed validation`);

  const scenario = cv.document as Scenario;
  const prepared = prepareStructure(sv.document as CollaredStructure, scenario);

  return {
    prepared,
    scenario,
    vector: read(c.vector) as Record<string, unknown>,
    betaDown: prepared.response.beta_down,
    betaUp: prepared.response.beta_up,
    volBeta: scenario.vol_beta ?? 0.65,
  };
}

/** Compare a computed block against its vector, field by field, at `tol`. */
export function compareBlock(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  tol: number,
  label: string,
): void {
  assert.deepEqual(
    Object.keys(actual).sort(),
    Object.keys(expected).sort(),
    `${label}: field set differs from the vector`,
  );
  for (const key of Object.keys(expected)) {
    const e = expected[key];
    const a = actual[key];
    if (typeof e === 'number' && typeof a === 'number') {
      const diff = Math.abs(a - e);
      const scale = Math.max(1, Math.abs(e));
      assert.ok(
        diff <= tol * scale,
        `${label}.${key}: got ${a}, expected ${e} (diff ${diff.toExponential(3)})`,
      );
    } else {
      assert.deepEqual(a, e, `${label}.${key}`);
    }
  }
}
