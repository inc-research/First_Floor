// SPDX-License-Identifier: MIT

/**
 * Phase 7a: concentration against the vectors, active share against properties.
 *
 * Active share has no golden vector by decision (O-05, in favour of D-14: the
 * oracle is retired once the port passes, not extended). It is a conventional
 * statistic with checkable algebraic properties, which tests better than a
 * frozen number would.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_COMPOSITION_GAP_DAYS, activeShare, concentration } from '../src/analytics/sleeve.ts';
import { validateReferenceComposition } from '../src/schema/validate.ts';
import { CASES, compareBlock, loadCase, read, TOL } from './helpers.ts';
import type { ReferenceComposition } from '../src/schema/types.ts';

function composition(path: string): ReferenceComposition {
  const r = validateReferenceComposition(read(path));
  assert.ok(r.ok, `${path} failed validation`);
  return r.document;
}

const FRESH = 'examples/reference_composition_synthetic.json';
const STALE = 'examples/reference_composition_stale.json';

describe('concentration', () => {
  it('reproduces example A to 1e-9', () => {
    const { prepared, vector } = loadCase(CASES[0]!);
    compareBlock(
      concentration(prepared) as unknown as Record<string, unknown>,
      vector['concentration'] as Record<string, unknown>,
      TOL,
      'concentration',
    );
  });

  it('is null for example C, which holds no constituents', () => {
    // Not 0. A zero HHI would read as perfectly diversified, which is the
    // opposite of the truth for a structure holding no assets at all.
    const { prepared, vector } = loadCase(CASES[1]!);
    assert.equal(concentration(prepared), null);
    assert.equal(vector['concentration'], null);
  });

  it('reports effective N as the reciprocal of HHI', () => {
    const { prepared } = loadCase(CASES[0]!);
    const c = concentration(prepared)!;
    assert.ok(Math.abs(c.effective_n - 1 / c.hhi) < 1e-15);
    // Six names but an effective 1.9, because one of them is 71.3%.
    assert.ok(c.effective_n < 2 && c.names === 6);
  });

  it('surfaces a partial list through weights_sum_raw', () => {
    // A holdings file listing the top 40 of 200 names sums to well under 1.
    // The statistic is still computed on normalised weights, but the raw sum is
    // the honest signal that the list is partial.
    const { prepared } = loadCase(CASES[0]!);
    assert.equal(concentration(prepared)!.weights_sum_raw, 1.0);
  });
});

describe('active share', () => {
  it('is omitted entirely when no composition is supplied', () => {
    // D-10: index membership is not knowable from a holdings file, so the
    // section is omitted rather than estimated.
    const { prepared } = loadCase(CASES[0]!);
    const r = activeShare(prepared, null);
    assert.equal(r.values, null);
    assert.equal(r.blockers[0]!.code, 'no_reference_composition');
    assert.match(r.blockers[0]!.remedy, /reference_composition/);
  });

  it('computes against the synthetic composition', () => {
    const { prepared } = loadCase(CASES[0]!);
    const r = activeShare(prepared, composition(FRESH));
    assert.ok(r.values);
    const v = r.values!;
    assert.ok(v.active_share > 0 && v.active_share <= 1);
    assert.equal(v.held_names, 6);
    assert.equal(v.reference_names, 7);
    assert.equal(v.matched_names, 5);
    assert.ok(Math.abs(v.name_coverage - 5 / 7) < 1e-15);
  });

  it('counts one-sided names on both sides rather than dropping them', () => {
    // NAME-006 is held but not in the reference; NAME-007 and NAME-008 are in
    // the reference but not held. Quietly discarding either would understate
    // the very difference the statistic exists to measure.
    const { prepared } = loadCase(CASES[0]!);
    const v = activeShare(prepared, composition(FRESH)).values!;
    assert.deepEqual(v.held_only, ['NAME-006']);
    assert.deepEqual(v.reference_only, ['NAME-007', 'NAME-008']);
  });

  it('carries the provenance caveat on the figure itself', () => {
    // A composition sourced from a tracking fund's published holdings is that
    // fund's holdings, not the index. The renderer cannot print the number
    // without this, because it travels with it.
    const { prepared } = loadCase(CASES[0]!);
    const v = activeShare(prepared, composition(FRESH)).values!;
    assert.ok(v.source_note.length > 0);
    assert.equal(v.composition_as_of, '2026-08-14');
    assert.equal(v.composition_gap_days, 0);
  });

  it('blocks on a stale composition rather than joining quietly', () => {
    const { prepared } = loadCase(CASES[0]!);
    const r = activeShare(prepared, composition(STALE));
    assert.equal(r.values, null);
    assert.equal(r.blockers[0]!.code, 'composition_stale');
    assert.match(r.blockers[0]!.message, /221 days/, 'and it states the gap');
    assert.ok(221 > MAX_COMPOSITION_GAP_DAYS);
  });

  it('blocks when the held asset has no constituents', () => {
    const { prepared } = loadCase(CASES[1]!);
    const r = activeShare(prepared, composition(FRESH));
    assert.equal(r.values, null);
    assert.equal(r.blockers[0]!.code, 'no_constituents');
  });
});

describe('property: active share behaves like active share', () => {
  const { prepared } = loadCase(CASES[0]!);
  const held = prepared.doc.held_asset.constituents!;

  const asComposition = (constituents: { name: string; weight: number }[]): ReferenceComposition => ({
    schema_version: '0.2.0',
    as_of: prepared.asOf,
    source_note: 'constructed in a property test',
    constituents,
  });

  it('is zero against an identical composition', () => {
    const v = activeShare(prepared, asComposition(held.map((c) => ({ ...c })))).values!;
    assert.ok(Math.abs(v.active_share) < 1e-15, `got ${v.active_share}`);
    assert.equal(v.name_coverage, 1);
  });

  it('is invariant under relabelling the order of names', () => {
    const shuffled = [...held].reverse().map((c) => ({ ...c }));
    const a = activeShare(prepared, asComposition(held.map((c) => ({ ...c })))).values!;
    const b = activeShare(prepared, asComposition(shuffled)).values!;
    assert.equal(a.active_share, b.active_share);
  });

  it('is invariant to a uniform rescaling of either side', () => {
    // Both sides are normalised before differencing, so doubling every index
    // weight must not move the answer.
    const base = activeShare(prepared, asComposition(held.map((c) => ({ ...c })))).values!;
    const scaled = activeShare(
      prepared,
      asComposition(held.map((c) => ({ name: c.name, weight: c.weight * 7.5 }))),
    ).values!;
    assert.ok(Math.abs(base.active_share - scaled.active_share) < 1e-15);
  });

  it('is 1 against a composition sharing no names', () => {
    const disjoint = held.map((c, i) => ({ name: `OTHER-${i}`, weight: c.weight }));
    const v = activeShare(prepared, asComposition(disjoint)).values!;
    assert.ok(Math.abs(v.active_share - 1) < 1e-12, `got ${v.active_share}`);
    assert.equal(v.matched_names, 0);
    assert.equal(v.name_coverage, 0);
  });

  it('stays within [0, 1] across randomised compositions', () => {
    for (let trial = 0; trial < 200; trial++) {
      const constituents = held.map((c, i) => ({
        name: trial % 3 === 0 ? `X-${i}` : c.name,
        weight: ((trial * 7 + i * 13) % 100) + 1,
      }));
      const v = activeShare(prepared, asComposition(constituents)).values!;
      assert.ok(
        v.active_share >= -1e-15 && v.active_share <= 1 + 1e-15,
        `trial ${trial} gave ${v.active_share}`,
      );
    }
  });

  it('ranks the largest active weights by magnitude, sign preserved', () => {
    const v = activeShare(prepared, composition(FRESH)).values!;
    for (let i = 1; i < v.largest_active_weights.length; i++) {
      assert.ok(
        Math.abs(v.largest_active_weights[i]!.active_weight) <=
          Math.abs(v.largest_active_weights[i - 1]!.active_weight),
      );
    }
    // NAME-006 is held at 71.3% and absent from the index: the biggest bet.
    assert.equal(v.largest_active_weights[0]!.name, 'NAME-006');
    assert.ok(v.largest_active_weights[0]!.active_weight > 0);
  });
});
