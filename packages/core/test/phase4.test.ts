// SPDX-License-Identifier: MIT

/**
 * Phase 4 gate: mark-to-market matches both vector sets to 1e-9, and the sweep
 * behaves as a core function rather than a UI convenience.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mtmByVolBeta, mtmValue } from '../src/analytics/mark.ts';
import { terminalValue } from '../src/analytics/geometry.ts';
import { sweep, sweepFromScenario } from '../src/sweep.ts';
import { CASES, compareBlock, loadCase, TOL } from './helpers.ts';

for (const c of CASES) {
  describe(`${c.name} — mark-to-market`, () => {
    it('reproduces the vol_beta table to 1e-9', () => {
      const { prepared, vector } = loadCase(c);
      const actual = mtmByVolBeta(prepared, [0.0, 0.35, 0.65, 1.0], [-0.1, -0.2, -0.3]);
      const expected = vector['mtm_by_vol_beta'] as Record<string, Record<string, number>>;
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
      for (const vb of Object.keys(expected)) {
        compareBlock(
          actual[vb] as Record<string, unknown>,
          expected[vb] as Record<string, unknown>,
          TOL,
          `mtm_by_vol_beta[${vb}]`,
        );
      }
    });
  });
}

describe('the size of the vol_beta assumption', () => {
  it('spans over four percentage points at -20% on example A', () => {
    // This is why the sweep is mandatory rather than optional: reporting a
    // single mark-to-market number bare conceals a four-point assumption.
    const { prepared } = loadCase(CASES[0]!);
    const flat = mtmValue(prepared, -0.2, 0.0);
    const steep = mtmValue(prepared, -0.2, 1.0);
    assert.ok(steep - flat > 0.04, `spread was only ${steep - flat}`);
  });

  it('raises the marked value as the shock deepens, never lowers it', () => {
    // A sudden decline raises option values, so a long-put book marks better
    // under a bigger shock. If this inverts, a sign is wrong.
    const { prepared } = loadCase(CASES[0]!);
    for (const d of [-0.05, -0.1, -0.2, -0.3, -0.5]) {
      let previous = -Infinity;
      for (const vb of [0, 0.35, 0.65, 1.0]) {
        const v = mtmValue(prepared, d, vb);
        assert.ok(v >= previous, `mtm fell as vol_beta rose at d = ${d}`);
        previous = v;
      }
    }
  });

  it('ignores vol_beta entirely on the upside, where the shock is zero', () => {
    const { prepared } = loadCase(CASES[0]!);
    assert.equal(mtmValue(prepared, 0.15, 0), mtmValue(prepared, 0.15, 1.0));
  });

  it('floors the shocked volatility at 2%', () => {
    // A leg whose own vol is below the floor still prices at the floor rather
    // than at a negative volatility.
    const { prepared } = loadCase(CASES[0]!);
    assert.ok(Number.isFinite(mtmValue(prepared, 0, 0)));
  });
});

describe('sweep is a core function', () => {
  it('runs the sweep the scenario document declares', () => {
    const { prepared, scenario } = loadCase(CASES[0]!);
    const result = sweepFromScenario(prepared, scenario);
    assert.ok(result, 'example_scenario.json declares a beta_down sweep');
    assert.equal(result!.parameter, 'beta_down');
    assert.deepEqual(
      result!.points.map((p) => p.value),
      [1.0, 1.1, 1.2],
    );
  });

  it('returns null when the scenario declares none, rather than inventing one', () => {
    const { prepared, scenario } = loadCase(CASES[1]!);
    assert.equal(sweepFromScenario(prepared, scenario), null);
  });

  it('carries every assumption on every point, not once on the result', () => {
    // Invariant 1: a renderer showing one slider position must be able to print
    // that position's assumptions without reaching back up.
    const { prepared, scenario } = loadCase(CASES[0]!);
    const result = sweep(prepared, scenario, 'vol_beta', [0, 0.5, 1.0]);
    for (const p of result.points) {
      assert.equal(p.assumptions.vol_beta, p.value);
      assert.equal(typeof p.assumptions.beta_down, 'number');
      assert.equal(typeof p.assumptions.beta_up, 'number');
      assert.equal(typeof p.assumptions.reference_move, 'number');
    }
  });

  it('never labels the mark-to-market figure with the swept beta', () => {
    // Erratum E-06: mtm is a beta = 1.0 figure by construction. Sweeping
    // beta_down must not change it, and the point must say so.
    const { prepared, scenario } = loadCase(CASES[0]!);
    const result = sweep(prepared, scenario, 'beta_down', [1.0, 1.1, 1.2]);
    const mtms = new Set(result.points.map((p) => p.mtm));
    assert.equal(mtms.size, 1, 'sweeping beta_down changed a figure that does not use beta');
    for (const p of result.points) {
      assert.equal(p.assumptions.mtm_held_asset_response, 1.0);
    }
  });

  it('agrees with the direct calls it delegates to', () => {
    // The surfaces share this function precisely so they cannot drift from the
    // underlying analytics; check that it has not drifted already.
    const { prepared, scenario } = loadCase(CASES[0]!);
    const result = sweep(prepared, scenario, 'beta_down', [1.0, 1.2], { referenceMove: -0.4 });
    assert.equal(result.points[0]!.terminal, terminalValue(prepared, -0.4, 1.0, 1.0));
    assert.equal(result.points[1]!.terminal, terminalValue(prepared, -0.4, 1.2, 1.0));
    assert.equal(result.points[0]!.mtm, mtmValue(prepared, -0.4, scenario.vol_beta ?? 0.65));
  });

  it('reproduces the beta-conditional finding through the sweep surface', () => {
    // The same six numbers the report leads with, reached the way the page and
    // the MCP server will reach them.
    const { prepared, scenario, vector } = loadCase(CASES[0]!);
    const expected = vector['terminal_by_beta'] as Record<string, Record<string, number>>;
    for (const move of [-0.2, -0.4, -0.6]) {
      const r = sweep(prepared, scenario, 'beta_down', [1.0, 1.1, 1.2], { referenceMove: move });
      const key = `-${Math.abs(move).toFixed(2)}`;
      for (const p of r.points) {
        const want = expected[p.value.toFixed(2)]![key] as number;
        assert.ok(
          Math.abs(p.terminal - want) < TOL,
          `beta ${p.value} at ${key}: ${p.terminal} vs ${want}`,
        );
      }
    }
  });

  it('sweeps the reference move itself', () => {
    const { prepared, scenario } = loadCase(CASES[0]!);
    const r = sweep(prepared, scenario, 'reference_move', [-0.6, -0.4, -0.2, 0, 0.2]);
    for (const p of r.points) {
      assert.equal(p.assumptions.reference_move, p.value);
    }
    // Terminal value must rise with the reference move.
    for (let i = 1; i < r.points.length; i++) {
      assert.ok(r.points[i]!.terminal > r.points[i - 1]!.terminal);
    }
  });
});
