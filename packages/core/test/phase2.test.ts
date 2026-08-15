// SPDX-License-Identifier: MIT

/**
 * Phase 2 gate: classification and exposure must reproduce both golden vector
 * sets.
 *
 * Tolerance is 1e-9, per COMPUTATIONAL_SPEC.md section 11. AGENT_BRIEF.md's
 * phase table says "exactly" for this phase, and that is not attainable:
 * `net_delta` routes through `bsDelta` and therefore `erfc`, and no JavaScript
 * runtime shares CPython's libm. Every other figure in these two blocks is pure
 * multiply-add over exactly-rounded sums and does come out bit-identical, which
 * the last test here asserts rather than assumes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/analytics/classify.ts';
import { exposure } from '../src/analytics/exposure.ts';
import { CASES, compareBlock, loadCase, TOL, type Case } from './helpers.ts';

for (const c of CASES) {
  describe(c.name, () => {
    it('reproduces the classification block to 1e-9', () => {
      const { prepared, vector } = loadCase(c);
      compareBlock(
        classify(prepared).values as unknown as Record<string, unknown>,
        vector['classification'] as Record<string, unknown>,
        TOL,
        'classification',
      );
    });

    it('reproduces the exposure block to 1e-9', () => {
      const { prepared, vector } = loadCase(c);
      compareBlock(
        exposure(prepared).values as unknown as Record<string, unknown>,
        vector['exposure'] as Record<string, unknown>,
        TOL,
        'exposure',
      );
    });

    it('reproduces every implied volatility to 1e-9', () => {
      const { prepared, vector } = loadCase(c);
      const expected = vector['implied_vols'] as Record<string, number | null>;
      for (const leg of prepared.legs) {
        const e = expected[leg.id];
        if (e === null) {
          // The oracle records null for a leg it could not invert, then prices
          // it off a hidden 0.2 anyway. This port carries the same number but
          // labels its provenance instead of losing it.
          assert.equal(leg.ivSource, 'fallback', `${leg.id} should be modelled, not marked`);
          assert.equal(leg.iv, prepared.fallbackIv);
        } else {
          assert.ok(
            Math.abs(leg.iv - (e as number)) <= TOL,
            `${leg.id}: got ${leg.iv}, expected ${e}`,
          );
        }
      }
    });
  });
}

describe('example A — the arithmetic that does not touch erfc', () => {
  it('is bit-identical to the vector, not merely within tolerance', () => {
    const { prepared, vector } = loadCase(CASES[0] as Case);
    const e = vector['exposure'] as Record<string, number>;
    const a = exposure(prepared).values;
    // Every one of these is a sum of products divided by NAV. Exact summation
    // makes them reproducible to the last bit across languages; if one of these
    // drifts, the fsum port is wrong, not the model.
    assert.equal(a.put_spot_notional, e['put_spot_notional']);
    assert.equal(a.insured_value, e['insured_value']);
    assert.equal(a.short_call_spot_notional, e['short_call_spot_notional']);
    assert.equal(a.gross_option_notional, e['gross_option_notional']);
    assert.equal(a.option_book_value, e['option_book_value']);
    assert.equal(a.weights_reconcile, e['weights_reconcile']);
    assert.equal(a.delta_cancellation_ratio, e['delta_cancellation_ratio']);
    assert.equal(a.average_attachment, e['average_attachment']);
    assert.equal(a.lowest_attachment, e['lowest_attachment']);
  });

  it('agrees on the reset asymmetry that drives path behaviour', () => {
    const { prepared, vector } = loadCase(CASES[0] as Case);
    const cls = classify(prepared).values;
    assert.equal(cls.mean_floor_remaining_days, 183.75);
    assert.equal(cls.reset_asymmetry_ratio, (vector['classification'] as Record<string, number>)['reset_asymmetry_ratio']);
  });
});

describe('example C — the paths example A does not exercise', () => {
  it('returns null with a stated blocker for the weights identity, never 0.0', () => {
    // This is the defect COMPUTATIONAL_SPEC.md section 11 says this example
    // exists to catch, and it was a real one in the oracle's first draft.
    const { prepared } = loadCase(CASES[1] as Case);
    const { values, blockers } = exposure(prepared);
    assert.equal(values.option_book_value, null);
    assert.equal(values.weights_reconcile, null);
    assert.notEqual(values.weights_reconcile, 0);
    assert.equal(values.weights_reconcile_blocked_by, 'one or more legs have no mark');
    const noMarks = blockers.find((b) => b.code === 'no_marks');
    assert.ok(noMarks, 'a blocker must say what is missing');
    assert.match(noMarks!.remedy, /mark_per_unit/, 'and what would fix it');
  });

  it('blocks Lambda because there is no held asset, rather than dividing by zero', () => {
    const { prepared } = loadCase(CASES[1] as Case);
    const { values, blockers } = exposure(prepared);
    assert.equal(values.delta_cancellation_ratio, null);
    assert.ok(blockers.some((b) => b.code === 'no_held_asset'));
    assert.ok(Number.isFinite(values.net_delta));
  });

  it('classifies a put spread as losing its floor below the lower strike', () => {
    const { prepared } = loadCase(CASES[1] as Case);
    const cls = classify(prepared).values;
    assert.equal(cls.protection_kind, 'put_spread');
    assert.equal(cls.protection_continues_below_lowest_strike, false);
    assert.equal(cls.architecture, 'synthetic');
    assert.equal(cls.reset_asymmetry_ratio, 1.0, 'single outcome period, no asymmetry');
  });

  it('names every leg it had to model rather than measure', () => {
    const { prepared } = loadCase(CASES[1] as Case);
    const modelled = exposure(prepared).blockers.find((b) => b.code === 'iv_modelled_not_marked');
    assert.ok(modelled, 'four unmarked legs must be reported, not silently defaulted');
    assert.deepEqual(modelled!.subjects, ['SYN', 'BUF_L', 'BUF_S', 'CAP']);
  });
});

describe('act/365 day count', () => {
  it('gives whole-day tenors across a DST boundary', () => {
    // 229, 47, 139 and 320 days on example A. A local-time Date subtraction
    // drifts by an hour here and turns 229 into 228.9583.
    const { prepared } = loadCase(CASES[0] as Case);
    for (const leg of prepared.legs) {
      const days = leg.T * 365;
      assert.equal(days, Math.round(days), `${leg.id} tenor ${days} is not a whole number of days`);
    }
  });
});
