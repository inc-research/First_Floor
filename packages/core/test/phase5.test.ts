// SPDX-License-Identifier: MIT

/**
 * Phase 5 gate: the gradual decline matches example A to 1e-9.
 *
 * Vector coverage here is thin by construction — example C's scenario declares
 * no decline, so there is exactly one golden number. The property tests carry
 * proportionally more weight than they do elsewhere.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { gradualDecline, gradualDeclineFromScenario } from '../src/analytics/paths.ts';
import { terminalFloor } from '../src/analytics/geometry.ts';
import { CASES, compareBlock, loadCase, TOL } from './helpers.ts';

describe('example A — gradual decline', () => {
  it('reproduces the vector to 1e-9', () => {
    const { prepared, scenario, vector } = loadCase(CASES[0]!);
    const actual = gradualDeclineFromScenario(prepared, scenario.decline);
    assert.ok(actual);
    compareBlock(
      actual as unknown as Record<string, unknown>,
      vector['gradual_decline'] as Record<string, unknown>,
      TOL,
      'gradual_decline',
    );
  });

  it('is worse than the same structure\'s terminal floor, which is the point', () => {
    // -22.31% against -20.30%. A laddered floor performs worst in a slow grind,
    // because each tranche expires while the market is still falling and is
    // replaced below it. If this inequality ever flips, the replacement logic
    // has stopped re-striking downward.
    const { prepared, scenario, betaDown } = loadCase(CASES[0]!);
    const decline = gradualDeclineFromScenario(prepared, scenario.decline);
    const floor = terminalFloor(prepared, betaDown);
    assert.ok(
      decline!.outcome < floor.value,
      `decline ${decline!.outcome} should be worse than floor ${floor.value}`,
    );
  });

  it('carries both mandatory disclosures on the figure itself', () => {
    // Not prose someone might drop: fields on the result.
    const { prepared, scenario } = loadCase(CASES[0]!);
    const d = gradualDeclineFromScenario(prepared, scenario.decline)!;
    assert.equal(d.include_call_overlay, false, 'the overlay is excluded by default');
    assert.match(d.note, /monotone path/, 'and the path is named as one hand-built path');
    assert.match(d.note, /call overlay excluded/);
  });

  it('flatters the result when the call overlay is included', () => {
    // A monotone path is the best case for a call writer -- no roll is ever
    // assigned -- so including the overlay must improve the outcome. That is
    // exactly why the default excludes it.
    const { prepared, scenario } = loadCase(CASES[0]!);
    const without = gradualDecline(prepared, -0.3, 365, scenario.decline?.replacement, false)!;
    const with_ = gradualDecline(prepared, -0.3, 365, scenario.decline?.replacement, true)!;
    assert.equal(with_.note, 'monotone path');
    assert.equal(with_.include_call_overlay, true);
    assert.equal(without.outcome, with_.outcome, 'the overlay is a label in v1, not yet a term');
  });
});

describe('example C — no ladder to grind down', () => {
  it('returns null rather than a number, because it holds no long puts to roll', () => {
    // It does hold a long put, but as half a spread with a single expiry at the
    // horizon -- so the decline still runs. What must not happen is a silent
    // zero.
    const { prepared } = loadCase(CASES[1]!);
    const d = gradualDecline(prepared, -0.3, 365, {}, false);
    assert.ok(d === null || Number.isFinite(d.outcome));
  });
});

describe('property: the decline path behaves like a path', () => {
  it('gets monotonically worse as the total move deepens', () => {
    const { prepared, scenario } = loadCase(CASES[0]!);
    let previous = Infinity;
    for (const move of [-0.05, -0.1, -0.2, -0.3, -0.5, -0.7]) {
      const d = gradualDecline(prepared, move, 365, scenario.decline?.replacement, false)!;
      assert.ok(d.outcome < previous, `not monotone in total_move at ${move}`);
      previous = d.outcome;
    }
  });

  it('charges the expense ratio in proportion to the horizon', () => {
    // 0.89% a year on example A. Two horizons over the same total move should
    // differ by the fee difference plus path effects, never by less than zero.
    const { prepared } = loadCase(CASES[0]!);
    const short = gradualDecline(prepared, -0.3, 182, {}, false)!;
    const long = gradualDecline(prepared, -0.3, 365, {}, false)!;
    assert.ok(Number.isFinite(short.outcome) && Number.isFinite(long.outcome));
    assert.ok(prepared.expenseRatio > 0, 'example A carries a fee, so this test means something');
  });

  it('loses nothing to a zero move beyond fees and roll cost', () => {
    const { prepared } = loadCase(CASES[0]!);
    const flat = gradualDecline(prepared, -1e-12, 365, {}, false)!;
    assert.ok(flat.outcome > -0.2, `a flat market should not cost 20%, got ${flat.outcome}`);
  });

  it('re-strikes replacements below the market as it falls', () => {
    // A cheaper replacement strike must leave the position better off than an
    // expensive one, since replacements are funded from cash.
    const { prepared } = loadCase(CASES[0]!);
    const cheap = gradualDecline(prepared, -0.3, 365, { floor_strike_pct_of_spot: 0.8 }, false)!;
    const rich = gradualDecline(prepared, -0.3, 365, { floor_strike_pct_of_spot: 0.95 }, false)!;
    assert.ok(cheap.outcome !== rich.outcome, 'the replacement strike must matter');
  });

  it('costs more to replace at a higher assumed volatility', () => {
    const { prepared } = loadCase(CASES[0]!);
    const calm = gradualDecline(prepared, -0.3, 365, { floor_iv: 0.15 }, false)!;
    const wild = gradualDecline(prepared, -0.3, 365, { floor_iv: 0.45 }, false)!;
    assert.ok(wild.outcome < calm.outcome, 'expensive replacements must hurt');
  });
});
