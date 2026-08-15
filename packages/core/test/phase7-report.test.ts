// SPDX-License-Identifier: MIT

/**
 * Phase 7b: the report object carries the v1 metric list, renders nothing, and
 * makes invariant 1 a property of the type rather than a rule to remember.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildReport, figures, type MetricKey } from '../src/report.ts';
import { validateReferenceComposition } from '../src/schema/validate.ts';
import { CASES, loadCase, read, TOL } from './helpers.ts';
import type { ReferenceComposition } from '../src/schema/types.ts';

const FRESH = validateReferenceComposition(
  read('examples/reference_composition_synthetic.json'),
);
assert.ok(FRESH.ok);
const composition = FRESH.document as ReferenceComposition;

/** Every metric in the frozen v1 list (D-27). */
const V1_METRICS: MetricKey[] = [
  'classification',
  'advertised_vs_computed',
  'terminal_floor',
  'beta_conditional_floor',
  'mark_to_market',
  'gradual_decline',
  'positioning',
  'reset_cadence',
  'capture',
  'concentration',
  'active_share',
];

describe('report assembly', () => {
  it('covers exactly the frozen v1 metric list', () => {
    const { prepared, scenario } = loadCase(CASES[0]!);
    const report = buildReport(prepared, scenario, { composition });
    assert.deepEqual(figures(report).map((f) => f.metric).sort(), [...V1_METRICS].sort());
  });

  it('agrees with the golden vectors it is assembled from', () => {
    const { prepared, scenario, vector } = loadCase(CASES[0]!);
    const report = buildReport(prepared, scenario, { composition });

    const floor = vector['terminal_floor'] as { value: number };
    assert.ok(Math.abs(report.terminal_floor.value!.value - floor.value) < TOL);

    const decline = vector['gradual_decline'] as { outcome: number };
    assert.ok(Math.abs(report.gradual_decline.value!.outcome - decline.outcome) < TOL);

    const beta = vector['terminal_by_beta'] as Record<string, Record<string, number>>;
    assert.ok(
      Math.abs(report.beta_conditional_floor.value!['1.20']!['-0.40']! - beta['1.20']!['-0.40']!) < TOL,
    );

    const cap = vector['capture_grid'] as Record<string, { capture: number }>;
    const cell = report.capture.value!.grid['30d_0.25']!.capture as number;
    assert.ok(Math.abs(cell - cap['30d_0.25']!.capture) / cap['30d_0.25']!.capture < 1e-12);
  });

  it('renders nothing — every value is data, no strings of prose', () => {
    const { prepared, scenario } = loadCase(CASES[0]!);
    const report = buildReport(prepared, scenario, { composition });
    // The only free text on the object is user-supplied or a provenance note.
    assert.equal(typeof report.terminal_floor.value!.value, 'number');
    assert.ok(!('sentence' in report.terminal_floor));
    assert.ok(!('html' in report.terminal_floor));
  });
});

describe('invariant 1: assumptions travel with numbers', () => {
  it('gives every figure at least its as-of date', () => {
    for (const c of CASES) {
      const { prepared, scenario } = loadCase(c);
      const report = buildReport(prepared, scenario, { composition });
      for (const f of figures(report)) {
        assert.ok(
          f.assumptions.some((a) => a.kind === 'as_of'),
          `${f.metric} carries no as-of date`,
        );
      }
    }
  });

  it('gives every downside figure its held-asset response', () => {
    // No function may return a downside figure stripped of its betas.
    const { prepared, scenario } = loadCase(CASES[0]!);
    const report = buildReport(prepared, scenario, { composition });

    assert.ok(
      report.terminal_floor.assumptions.some((a) => a.kind === 'held_asset_response'),
      'the floor is a beta-conditional figure and must say so',
    );
    assert.ok(
      report.beta_conditional_floor.assumptions.some((a) => a.kind === 'beta_swept'),
      'the beta table must state which betas it swept',
    );
  });

  it('never attaches a beta to the mark-to-market block', () => {
    // Erratum E-06: mtm is a beta = 1.0 figure by construction. Printing the
    // scenario's beta beside it would advertise an assumption it never used.
    const { prepared, scenario } = loadCase(CASES[0]!);
    const mtm = buildReport(prepared, scenario, { composition }).mark_to_market;
    assert.ok(mtm.assumptions.some((a) => a.kind === 'held_asset_response_fixed'));
    assert.ok(!mtm.assumptions.some((a) => a.kind === 'held_asset_response'));
    assert.ok(mtm.assumptions.some((a) => a.kind === 'vol_beta_swept'));
  });

  it('attaches the not-a-collectible-outcome caveat to the terminal floor', () => {
    // Mandatory per spec section 4. Where tranches expire across months there
    // is no date on which all of them pay.
    const { prepared, scenario } = loadCase(CASES[0]!);
    const report = buildReport(prepared, scenario, { composition });
    assert.ok(report.terminal_floor.assumptions.some((a) => a.kind === 'not_a_collectible_outcome'));
    assert.ok(
      report.gradual_decline.assumptions.some((a) => a.kind === 'single_path_not_a_distribution'),
    );
  });

  it('names the modelled legs on every figure that priced off the fallback', () => {
    // Example C prices all four legs off fallback_iv. Any figure touching them
    // must say which are modelled rather than marked.
    const { prepared, scenario } = loadCase(CASES[1]!);
    const report = buildReport(prepared, scenario);
    const line = report.mark_to_market.assumptions.find((a) => a.kind === 'modelled_vols');
    assert.ok(line, 'example C models every leg and the report must say so');
    assert.deepEqual(
      (line as { leg_ids: string[] }).leg_ids,
      ['SYN', 'BUF_L', 'BUF_S', 'CAP'],
    );
    assert.equal((line as { fallback_iv: number }).fallback_iv, 0.2);
  });

  it('states the simulation parameters behind every capture cell', () => {
    const { prepared, scenario } = loadCase(CASES[0]!);
    const report = buildReport(prepared, scenario, { composition });
    const sim = report.capture.assumptions.find((a) => a.kind === 'capture_simulation');
    assert.ok(sim);
    assert.equal((sim as { seed: number }).seed, 11);
    assert.equal((sim as { paths: number }).paths, 20000);
    assert.ok(Math.abs((sim as { overwrite: number }).overwrite - 0.9779176250619004) < 1e-15);
  });
});

describe('blocked figures state what is missing and what would fix it', () => {
  it('blocks active share when no composition is supplied', () => {
    const { prepared, scenario } = loadCase(CASES[0]!);
    const report = buildReport(prepared, scenario);
    assert.equal(report.active_share.value, null);
    assert.equal(report.active_share.blockers[0]!.code, 'no_reference_composition');
  });

  it('blocks concentration and capture on example C without inventing zeroes', () => {
    const { prepared, scenario } = loadCase(CASES[1]!);
    const report = buildReport(prepared, scenario);
    assert.equal(report.concentration.value, null);
    assert.ok(report.concentration.blockers.length > 0);
    // scenario_minimal.json requests no capture simulation.
    assert.equal(report.capture.value, null);
    assert.ok(report.capture.blockers.length > 0);
    assert.equal(report.gradual_decline.value, null);
  });

  it('gives every blocker a remedy, never a bare cause', () => {
    for (const c of CASES) {
      const { prepared, scenario } = loadCase(c);
      const report = buildReport(prepared, scenario);
      for (const f of figures(report)) {
        for (const b of f.blockers) {
          assert.ok(b.message.length > 0, `${f.metric}: blocker with no message`);
          assert.ok(b.remedy.length > 0, `${f.metric}: blocker ${b.code} has no remedy`);
        }
      }
    }
  });

  it('never returns a zero where a figure is unavailable', () => {
    const { prepared, scenario } = loadCase(CASES[1]!);
    const report = buildReport(prepared, scenario);
    for (const f of figures(report)) {
      if (f.value === null) assert.ok(f.blockers.length > 0, `${f.metric}: null with no blocker`);
      assert.notEqual(f.value, 0, `${f.metric}: 0 is not how absence is expressed`);
    }
  });
});

describe('advertised versus computed', () => {
  it('sets the fact sheet claim beside the computed floor', () => {
    const { prepared, scenario } = loadCase(CASES[0]!);
    const a = buildReport(prepared, scenario).advertised_vs_computed.value!;
    assert.equal(a.advertised_protection_pct, 0.1);
    assert.equal(a.advertised_protection_kind, 'floor');
    assert.ok(a.computed_floor! < -0.2, 'a 10% advertised floor against a -20.3% computed one');
    assert.equal(a.comparable, true);
  });

  it('refuses to call a buffer comparable to a computed floor', () => {
    // Example C advertises a 15% buffer against an inception level. Subtracting
    // that from a floor computed against today's level would be nonsense, so
    // the report says the two are not comparable rather than implying they are.
    const { prepared, scenario } = loadCase(CASES[1]!);
    const a = buildReport(prepared, scenario).advertised_vs_computed.value!;
    assert.equal(a.advertised_protection_kind, 'buffer');
    assert.equal(a.comparable, false);
  });
});

describe('the engine stays blind', () => {
  it('echoes subject without letting it reach any computation', () => {
    // D-02: subject is a fact about the input, never an input to arithmetic.
    const { prepared, scenario } = loadCase(CASES[0]!);
    const withSubject = buildReport(prepared, scenario, { composition });
    assert.equal(withSubject.subject!.ticker, 'EXAMPLE-A');

    const stripped = { ...prepared, doc: { ...prepared.doc } };
    delete (stripped.doc as { subject?: unknown }).subject;
    const without = buildReport(stripped, scenario, { composition });

    assert.equal(without.subject, null);
    assert.deepEqual(without.terminal_floor.value, withSubject.terminal_floor.value);
    assert.deepEqual(without.positioning.value, withSubject.positioning.value);
  });
});

describe('capture is labelled by architecture', () => {
  it('calls example A\'s rolling caps realised and permanent', () => {
    const { prepared, scenario } = loadCase(CASES[0]!);
    const report = buildReport(prepared, scenario, { composition });
    assert.equal(report.capture.value!.realisation, 'realised_and_permanent');
  });
});
