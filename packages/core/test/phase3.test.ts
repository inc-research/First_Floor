// SPDX-License-Identifier: MIT

/**
 * Phase 3 gate: terminal value, the floor scan and the β-conditional table match
 * both golden vector sets to 1e-9, and the two property tests from
 * AGENT_BRIEF.md §6 pass.
 *
 * The property tests matter more than the vectors, because they hold for
 * structures nobody has written down yet.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FLATNESS_TOLERANCE,
  residualSlopeBelowLadder,
  terminalByBeta,
  terminalFloor,
  terminalValue,
} from '../src/analytics/geometry.ts';
import { exposure } from '../src/analytics/exposure.ts';
import { CASES, compareBlock, loadCase, TOL } from './helpers.ts';

for (const c of CASES) {
  describe(`${c.name} — geometry`, () => {
    it('reproduces the terminal floor to 1e-9', () => {
      const { prepared, vector, betaDown } = loadCase(c);
      compareBlock(
        terminalFloor(prepared, betaDown) as unknown as Record<string, unknown>,
        vector['terminal_floor'] as Record<string, unknown>,
        TOL,
        'terminal_floor',
      );
    });

    it('reproduces the beta-conditional table to 1e-9', () => {
      const { prepared, vector } = loadCase(c);
      const actual = terminalByBeta(prepared, [1.0, 1.1, 1.2], [-0.2, -0.4, -0.6]);
      const expected = vector['terminal_by_beta'] as Record<string, Record<string, number>>;
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
      for (const beta of Object.keys(expected)) {
        compareBlock(
          actual[beta] as Record<string, unknown>,
          expected[beta] as Record<string, unknown>,
          TOL,
          `terminal_by_beta[${beta}]`,
        );
      }
    });
  });
}

describe('example A — the floor scan subtleties', () => {
  it('reports the shallowest attaining move, not the grid edge', () => {
    // -24.6%, the point at which further decline stops mattering. Reporting
    // -95% would imply the floor only binds at the bottom of the scan.
    const { prepared, betaDown } = loadCase(CASES[0]!);
    const floor = terminalFloor(prepared, betaDown);
    assert.equal(floor.at_reference_move, -0.246);
    assert.ok(floor.flat_below);
    assert.equal(floor.flat_tolerance, FLATNESS_TOLERANCE);
    assert.ok(Math.abs(floor.value - -0.2029568749913223) < 1e-15);
  });

  it('reports a useless attachment at a 1e-6 tolerance, which is why 5bp is the rule', () => {
    // The defect in the oracle's first draft. Λ = 0.9994 rather than exactly 1
    // leaves a residual slope of w_eq·(1 − Λ) ≈ 5.7e-4 per unit of reference
    // move. Over one grid step of 5e-4 that is only ~2.9e-7 of value, so a
    // handful of adjacent points near the bottom still fall inside 1e-6 and the
    // scan does technically report `flat_below`. What it gets wrong is *where*:
    // the attachment migrates to the grid edge, saying the floor binds at −95%
    // when it actually binds at −24.6%.
    const { prepared, betaDown } = loadCase(CASES[0]!);
    const strict = terminalFloor(prepared, betaDown, -0.95, 1901, 1e-6);
    assert.ok(strict.at_reference_move < -0.9, `got ${strict.at_reference_move}, expected the grid edge`);

    // Widening the tolerance walks the reported attachment back to the truth.
    const attachments = [1e-6, 1e-5, 1e-4, 5e-4].map(
      (tol) => terminalFloor(prepared, betaDown, -0.95, 1901, tol).at_reference_move,
    );
    for (let i = 1; i < attachments.length; i++) {
      assert.ok(
        (attachments[i] as number) > (attachments[i - 1] as number),
        `attachment should shallow as tolerance widens: ${attachments.join(' -> ')}`,
      );
    }
    assert.equal(attachments.at(-1), -0.246, 'and 5bp lands on the real attachment');
  });
});

describe('example C — a put spread has no floor below its lower strike', () => {
  it('is not flat, and bottoms out at the scan edge for the right reason', () => {
    const { prepared, betaDown } = loadCase(CASES[1]!);
    const floor = terminalFloor(prepared, betaDown);
    assert.equal(floor.flat_below, false);
    assert.equal(floor.at_reference_move, -0.95);
    assert.ok(Math.abs(floor.value - -0.8176721008218284) < 1e-15);
  });

  it('is beta-insensitive, because it holds no assets to have a beta', () => {
    const { prepared } = loadCase(CASES[1]!);
    const t = terminalByBeta(prepared, [1.0, 1.2, 2.0], [-0.2, -0.6]);
    assert.deepEqual(t['1.00'], t['1.20']);
    assert.deepEqual(t['1.00'], t['2.00']);
  });
});

describe('property: the floor is flat if and only if beta equals Lambda', () => {
  it('is flat to 5bp at beta = Lambda', () => {
    const { prepared } = loadCase(CASES[0]!);
    const lambda = exposure(prepared).values.delta_cancellation_ratio;
    assert.ok(lambda !== null, 'example A has long puts and a held asset');

    // Below the lowest attachment (-24.63%), where every put is in the money.
    const values: number[] = [];
    for (let d = -0.3; d >= -0.9; d -= 0.02) {
      values.push(terminalValue(prepared, d, lambda as number, lambda as number));
    }
    const spread = Math.max(...values) - Math.min(...values);
    assert.ok(spread <= 5e-4, `spread ${spread} exceeds 5bp at beta = Lambda`);
  });

  it('declines monotonically at w_eq·(beta − Lambda) when beta exceeds Lambda', () => {
    const { prepared } = loadCase(CASES[0]!);
    const lambda = exposure(prepared).values.delta_cancellation_ratio as number;
    const beta = lambda + 0.1;
    const expectedSlope = residualSlopeBelowLadder(prepared, lambda, beta);

    // Positive w_eq times a positive (beta − Lambda) is a positive number, and
    // the position loses that much per unit of *further* decline: the slope of
    // value against the reference move is negative of it only in sign
    // convention, so compare magnitudes against successive differences.
    let previous = terminalValue(prepared, -0.3, beta, beta);
    for (let d = -0.32; d >= -0.9; d -= 0.02) {
      const current = terminalValue(prepared, d, beta, beta);
      assert.ok(current < previous, `not monotone at d = ${d.toFixed(2)}`);
      const slope = (current - previous) / -0.02;
      assert.ok(
        Math.abs(Math.abs(slope) - expectedSlope) < 1e-6,
        `slope ${slope} at d = ${d.toFixed(2)} does not match w_eq·(beta − Lambda) = ${expectedSlope}`,
      );
      previous = current;
    }
  });

  it('holds the same way above the cap, with the sign flipped', () => {
    // A high-beta held asset adds to return in a strong rally. This is the half
    // of the result that makes it a risk transformation rather than a defect,
    // and a symmetric tracking-error statistic averages it away.
    const { prepared } = loadCase(CASES[0]!);
    const atOne = terminalValue(prepared, 0.4, 1.0, 1.0);
    const atHigh = terminalValue(prepared, 0.4, 1.0, 1.2);
    assert.ok(atHigh > atOne, 'a higher up-beta must help in a rally');
  });
});

describe('property: terminal value is the sum of its parts', () => {
  it('equals held asset plus cash plus every leg, at every sampled level', () => {
    // Catches sign errors, multiplier errors and underlying-unit confusion —
    // the three most likely defects in the ingest path.
    for (const c of CASES) {
      const { prepared } = loadCase(c);
      for (const beta of [0.8, 1.0, 1.3]) {
        for (let d = -0.9; d <= 0.6; d += 0.05) {
          const b = d <= 0 ? beta : beta;
          let parts = prepared.wEq * (1 + b * d) + prepared.cashWeight - 1;
          for (const l of prepared.legs) {
            const S = l.S0 * (1 + d);
            const intrinsic = Math.max(0, l.right === 'call' ? S - l.K : l.K - S);
            parts += (l.sign * l.units * intrinsic) / prepared.nav;
          }
          const whole = terminalValue(prepared, d, beta, beta);
          assert.ok(
            Math.abs(whole - parts) < 1e-12,
            `${c.name} at d = ${d.toFixed(2)}, beta ${beta}: ${whole} vs ${parts}`,
          );
        }
      }
    }
  });

  it('puts every strike on the reference axis via its own underlying', () => {
    // Example A holds puts on a tenth-scale proxy and calls on the reference
    // itself. If the port compared a 584 strike against a 7748 level, the puts
    // would never be in the money and the floor would vanish.
    const { prepared } = loadCase(CASES[0]!);
    const proxyPuts = prepared.legs.filter((l) => l.right === 'put');
    assert.ok(proxyPuts.every((l) => l.ratio === 0.1), 'puts sit on the tenth-scale proxy');
    const deep = terminalValue(prepared, -0.5, 1.0, 1.0);
    assert.ok(deep > -0.25, `a -50% move should be floored near -20%, got ${deep}`);
  });
});
