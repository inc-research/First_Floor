// SPDX-License-Identifier: MIT

/**
 * Phase 6 gate: the capture grid matches example A to 1e-12 relative, with the
 * uniform stream still exact.
 *
 * The tolerance is D-35 and erratum E-08, not a concession made when the test
 * failed: Box-Muller calls log and cos, Black-Scholes calls exp and erfc, and
 * V8's libm is not CPython's. `test/primitives.test.ts` holds the uniforms to
 * bit-exactness so a real PRNG defect still fails loudly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { bankersRound, capture, captureGrid, captureRealisation } from '../src/analytics/capture.ts';
import { classify } from '../src/analytics/classify.ts';
import { exposure } from '../src/analytics/exposure.ts';
import { CAPTURE_TOL, CASES, loadCase } from './helpers.ts';
import type { CaptureScenario } from '../src/schema/types.ts';

describe('banker\'s rounding', () => {
  it('rounds halves to even, as Python does and Math.round does not', () => {
    assert.equal(bankersRound(6.5), 6, 'Math.round would give 7 and break the 14-day cell');
    assert.equal(bankersRound(7.5), 8);
    assert.equal(bankersRound(0.5), 0);
    assert.equal(bankersRound(1.5), 2);
    assert.equal(bankersRound(2.5), 2);
    assert.equal(bankersRound(-0.5), 0, 'Python gives 0 here, not -0 and not -1');
    assert.equal(bankersRound(-1.5), -2);
    assert.equal(bankersRound(-2.5), -2);
  });

  it('agrees with Math.round everywhere that is not a tie', () => {
    // Compared with `===` rather than strictEqual, because Math.round returns
    // -0 for small negatives and this returns 0. They are the same number; only
    // Object.is separates them, and the value feeds an integer step count.
    for (let x = -20; x <= 20; x += 0.1) {
      if (Math.abs(x - Math.floor(x) - 0.5) < 1e-9) continue;
      assert.ok(bankersRound(x) === Math.round(x), `disagreed at ${x}`);
    }
  });

  it('gives the step counts the default grid depends on', () => {
    assert.equal(Math.max(1, bankersRound(91 / 14)), 6);
    assert.equal(Math.max(1, bankersRound(91 / 30)), 3);
    assert.equal(Math.max(1, bankersRound(91 / 91)), 1);
  });
});

describe('example A — capture grid', () => {
  it('reproduces all nine cells to 1e-12 relative', () => {
    const { prepared, scenario, vector } = loadCase(CASES[0]!);
    const actual = captureGrid(prepared, scenario.capture as CaptureScenario);
    const expected = vector['capture_grid'] as Record<string, { capture: number; conditioned_paths: number }>;

    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
    for (const key of Object.keys(expected)) {
      const a = actual[key]!;
      const e = expected[key]!;
      assert.equal(
        a.conditioned_paths,
        e.conditioned_paths,
        `${key}: conditioned path count must match exactly -- it is an integer off the uniform stream`,
      );
      const rel = Math.abs((a.capture as number) - e.capture) / Math.abs(e.capture);
      assert.ok(
        rel <= CAPTURE_TOL,
        `${key}: got ${a.capture}, expected ${e.capture} (rel ${rel.toExponential(3)})`,
      );
    }
  });

  it('defaults the overwrite to the structure\'s own short-call notional', () => {
    const { prepared, scenario } = loadCase(CASES[0]!);
    const own = exposure(prepared).values.short_call_spot_notional;
    const cap = scenario.capture as CaptureScenario;
    const implicit = capture(prepared, {
      tenorDays: 30, delta: 0.25, horizonDays: 91,
      referenceMove: 0.152, referenceVol: 0.16, paths: 20000, seed: 11,
    });
    const explicit = capture(prepared, {
      tenorDays: 30, delta: 0.25, horizonDays: 91,
      referenceMove: 0.152, referenceVol: 0.16, paths: 20000, seed: 11,
      overwrite: own,
    });
    assert.equal(implicit.capture, explicit.capture);
    assert.ok(Math.abs(own - 0.9779176250619004) < 1e-15, 'and it is 97.79% on this structure');
    assert.ok(cap.paths === 20000);
  });
});

describe('property: the counter-intuitive tenor result must survive', () => {
  it('forfeits less at shorter tenors, because each roll re-strikes from the new level', () => {
    // The single most useful thing on the page for someone comparing
    // structures, and the opposite of what most readers expect. If a
    // refactor ever inverts this, the page is teaching the wrong lesson.
    const { prepared, scenario, vector } = loadCase(CASES[0]!);
    const grid = captureGrid(prepared, scenario.capture as CaptureScenario);
    for (const delta of ['0.30', '0.25', '0.20']) {
      const short = grid[`14d_${delta}`]!.capture as number;
      const mid = grid[`30d_${delta}`]!.capture as number;
      const long = grid[`91d_${delta}`]!.capture as number;
      assert.ok(short > mid, `14d should beat 30d at delta ${delta}: ${short} vs ${mid}`);
      assert.ok(mid > long, `30d should beat 91d at delta ${delta}: ${mid} vs ${long}`);
    }
    assert.ok(vector['capture_grid'], 'and the vector agrees, checked above');
  });

  it('forfeits less at further-out strikes', () => {
    const { prepared, scenario } = loadCase(CASES[0]!);
    const grid = captureGrid(prepared, scenario.capture as CaptureScenario);
    for (const tenor of ['14d', '30d', '91d']) {
      const near = grid[`${tenor}_0.30`]!.capture as number;
      const far = grid[`${tenor}_0.20`]!.capture as number;
      assert.ok(far > near, `delta 0.20 should beat 0.30 at ${tenor}: ${far} vs ${near}`);
    }
  });

  it('is deterministic: the same seed gives the identical figure', () => {
    // Invariant 6. A figure that moves between runs is a bug.
    const { prepared } = loadCase(CASES[0]!);
    const params = {
      tenorDays: 30, delta: 0.25, horizonDays: 91,
      referenceMove: 0.152, referenceVol: 0.16, paths: 5000, seed: 11,
    };
    assert.equal(capture(prepared, params).capture, capture(prepared, params).capture);
  });

  it('moves when the seed moves, so the seed is actually being used', () => {
    const { prepared } = loadCase(CASES[0]!);
    const base = { tenorDays: 30, delta: 0.25, horizonDays: 91, referenceMove: 0.152, referenceVol: 0.16, paths: 5000 };
    assert.notEqual(
      capture(prepared, { ...base, seed: 11 }).capture,
      capture(prepared, { ...base, seed: 12 }).capture,
    );
  });
});

describe('conditioning', () => {
  it('returns null below 50 conditioned paths rather than an unstable ratio', () => {
    // Silence beats a caveated wrong number. A ratio of two small numbers is
    // unstable by construction as the denominator approaches zero.
    const { prepared } = loadCase(CASES[0]!);
    const cell = capture(prepared, {
      tenorDays: 30, delta: 0.25, horizonDays: 91,
      referenceMove: 0.152, referenceVol: 0.16, paths: 200, seed: 11,
      band: 0.0005,
    });
    assert.equal(cell.capture, null);
    assert.ok(cell.conditioned_paths < 50);
  });

  it('always reports the conditioned path count alongside the estimate', () => {
    const { prepared, scenario } = loadCase(CASES[0]!);
    const grid = captureGrid(prepared, scenario.capture as CaptureScenario);
    for (const [key, cell] of Object.entries(grid)) {
      assert.ok(cell.conditioned_paths > 0, `${key} reported no path count`);
      assert.equal(typeof cell.conditioned_paths, 'number');
    }
  });
});

describe('capture means different things by architecture', () => {
  it('labels example A\'s rolling caps as realised and permanent', () => {
    const { prepared } = loadCase(CASES[0]!);
    const cls = classify(prepared).values;
    assert.equal(
      captureRealisation(cls.architecture, cls.distinct_cap_expiries),
      'realised_and_permanent',
    );
  });

  it('labels example C\'s single outcome period as unrealised time value', () => {
    // A structure showing 52% capture today may be on track for 92% at expiry.
    // Reporting one capture number across both without this label is a category
    // error.
    const { prepared } = loadCase(CASES[1]!);
    const cls = classify(prepared).values;
    assert.equal(
      captureRealisation(cls.architecture, cls.distinct_cap_expiries),
      'largely_unrealised_time_value',
    );
  });
});
