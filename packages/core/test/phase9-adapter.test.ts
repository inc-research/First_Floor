// SPDX-License-Identifier: MIT

/**
 * Phase 9 gate: a holdings CSV maps to a valid structure document without code
 * changes, and a document rendered to a report and back produces identical
 * numbers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseCsv, parseNumber } from '../src/adapters/csv.ts';
import { parseOptionName } from '../src/adapters/optionNames.ts';
import { applyMapping, synthesiseStructure, type ColumnMapping } from '../src/adapters/mapping.ts';
import { validateStructure } from '../src/schema/validate.ts';
import { prepareStructure } from '../src/model/structure.ts';
import { buildReport, figures } from '../src/report.ts';
import { CASES, loadCase, read } from './helpers.ts';
import type { Scenario } from '../src/schema/types.ts';

const ROOT = new URL('../../../', import.meta.url);
const readText = (p: string): string => readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8');

const CSV = readText('examples/holdings_synthetic.csv');
const OCC_MAPPING = read('examples/mapping_occ_long_form.json') as ColumnMapping;
const SPACED_MAPPING = read('examples/mapping_spaced_description.json') as ColumnMapping;

describe('CSV reading', () => {
  it('finds the header row under a preamble', () => {
    const t = parseCsv(CSV);
    assert.equal(t.headers[0], 'Account');
    assert.ok(t.headers.includes('Market Value'));
    assert.equal(t.body.length, 18, 'fourteen rows in one account, four in the other');
  });

  it('handles quoted fields, embedded commas and CRLF', () => {
    const t = parseCsv('a,b\r\n"x,1","he said ""hi"""\r\n');
    assert.deepEqual(t.headers, ['a', 'b']);
    assert.deepEqual(t.body[0], ['x,1', 'he said "hi"']);
  });

  it('reads numbers wearing currency symbols and parentheses', () => {
    assert.equal(parseNumber('$1,234.50'), 1234.5);
    assert.equal(parseNumber('(500)'), -500);
    assert.equal(parseNumber('—'), null);
    assert.equal(parseNumber(''), null);
    assert.equal(parseNumber('12%'), 12);
  });
});

describe('option identifiers', () => {
  it('reads the OCC 21-character form, decimals included', () => {
    // 00584000 is 584, not 584000. Reading it as the latter puts every put a
    // thousandfold out of the money with no obvious symptom.
    const p = parseOptionName('PXY   270331P00584000', 'occ21');
    assert.deepEqual(p, { root: 'PXY', right: 'put', strike: 584, expiry: '2027-03-31' });
    assert.equal(parseOptionName('REF   270319C00000940', 'occ21')!.strike, 0.94);
  });

  it('reads a written description', () => {
    assert.deepEqual(parseOptionName('PXY Mar 31 2027 584.00 Put', 'spaced'), {
      root: 'PXY', right: 'put', strike: 584, expiry: '2027-03-31',
    });
    assert.deepEqual(parseOptionName('SPX 03/31/2027 584 C', 'spaced'), {
      root: 'SPX', right: 'call', strike: 584, expiry: '2027-03-31',
    });
  });

  it('reads a delimiter-separated form', () => {
    assert.deepEqual(parseOptionName('SPY-20270331-584-P', 'dashed'), {
      root: 'SPY', right: 'put', strike: 584, expiry: '2027-03-31',
    });
    assert.deepEqual(parseOptionName('SPY_2027-03-31_584_PUT', 'dashed'), {
      root: 'SPY', right: 'put', strike: 584, expiry: '2027-03-31',
    });
  });

  it('returns null rather than guessing at something it cannot read', () => {
    // A silently mis-parsed strike produces a report that looks entirely
    // reasonable and is entirely wrong, so nothing is inferred here.
    for (const junk of ['', 'AAPL', 'not an option', 'PXY 584 Put']) {
      assert.equal(parseOptionName(junk, 'occ21'), null);
      assert.equal(parseOptionName(junk, 'dashed'), null);
    }
  });

  it('agrees across two formats reading the same position', () => {
    // The same row, once through the OCC symbol and once through the written
    // description. Two mapping options, one answer.
    const a = parseOptionName('PXY   270331P00584000', 'occ21');
    const b = parseOptionName('PXY Mar 31 2027 584.00 Put', 'spaced');
    assert.deepEqual(a, b);
  });
});

describe('applying a mapping', () => {
  const mapped = applyMapping(CSV, OCC_MAPPING);

  it('classifies every row and leaves none unreadable', () => {
    assert.equal(mapped.counts.option, 11);
    assert.equal(mapped.counts.equity, 6);
    assert.equal(mapped.counts.cash, 1);
    assert.equal(mapped.counts.unreadable, 0);
  });

  it('separates the accounts a mixed file contains', () => {
    assert.deepEqual(mapped.accounts, ['FUND-A', 'FUND-B']);
    assert.deepEqual(mapped.roots, ['PXY', 'REF']);
  });

  it('takes direction from the sign and stores it in position', () => {
    // Contracts are always positive; direction lives in `position` (spec §0).
    // Three written calls in the first account, a written put and a written
    // call in the second.
    const shorts = mapped.rows.filter((r) => r.option?.position === 'short');
    assert.equal(shorts.length, 5);
    for (const r of shorts) assert.ok(r.option!.contracts > 0);
  });

  it('reads the same positions through a different column', () => {
    const viaDescription = applyMapping(CSV, SPACED_MAPPING);
    const occLegs = mapped.rows.filter((r) => r.option).map((r) => r.option!);
    const spacedLegs = viaDescription.rows.filter((r) => r.option).map((r) => r.option!);
    assert.equal(occLegs.length, spacedLegs.length);
    for (let i = 0; i < occLegs.length; i++) {
      assert.equal(occLegs[i]!.strike, spacedLegs[i]!.strike);
      assert.equal(occLegs[i]!.expiry, spacedLegs[i]!.expiry);
      assert.equal(occLegs[i]!.right, spacedLegs[i]!.right);
    }
  });

  it('reports rows it cannot read instead of dropping them silently', () => {
    const broken = CSV.replace('PXY   270331P00584000', 'GIBBERISH');
    const result = applyMapping(broken, OCC_MAPPING);
    assert.equal(result.counts.unreadable, 1);
    assert.match(result.rows.find((r) => r.kind === 'unreadable')!.note!, /Could not read an option/);
  });
});

describe('synthesising a structure document', () => {
  const mapped = applyMapping(CSV, OCC_MAPPING);
  const built = synthesiseStructure(mapped, {
    as_of: '2026-08-14',
    reference_id: 'REF',
    levels: { REF: 7748.5, PXY: 774.85 },
    ratios: { REF: 1, PXY: 0.1 },
    account: 'FUND-A',
    label: 'From a holdings CSV',
  });

  it('produces a document that validates without code changes', () => {
    // The Phase 9 gate, stated exactly as AGENT_BRIEF.md states it.
    const r = validateStructure(built.document);
    assert.ok(r.ok, `rejected: ${JSON.stringify(r.problems ?? [], null, 2)}`);
  });

  it('reaches a full report', () => {
    const scenario = read('examples/example_scenario.json') as Scenario;
    const report = buildReport(prepareStructure(built.document, scenario), scenario);
    for (const f of figures(report)) {
      if (f.value === null) assert.ok(f.blockers.length > 0, `${f.metric} is null with no blocker`);
    }
    assert.ok(report.terminal_floor.value);
    assert.equal(report.classification.value!.protection_kind, 'plain_put');
    assert.equal(report.classification.value!.floor_tranches, 4);
    assert.equal(report.classification.value!.cap_tranches, 3);
  });

  it('recovers the shape of example A from a file of the same positions', () => {
    // Not the identical document — NAV is summed rather than stated, so the
    // weights differ slightly — but the same seven contracts on the same two
    // underlyings, which is what the adapter actually claims to do.
    const { prepared: fromExample } = loadCase(CASES[0]!);
    const fromCsv = prepareStructure(built.document);
    assert.equal(fromCsv.legs.length, fromExample.legs.length);
    assert.deepEqual(
      fromCsv.legs.map((l) => [l.right, l.K, l.sign]).sort(),
      fromExample.legs.map((l) => [l.right, l.K, l.sign]).sort(),
    );
  });

  it('says what it inferred rather than presenting it as read', () => {
    assert.ok(built.notes.some((n) => /Fund size was taken as the sum/.test(n)));
  });

  it('keeps the accounts apart', () => {
    const b = synthesiseStructure(mapped, {
      as_of: '2026-08-14',
      reference_id: 'REF',
      levels: { REF: 109.61 },
      ratios: { REF: 1 },
      account: 'FUND-B',
    });
    assert.equal(b.document.option_legs.length, 4);
    assert.equal(b.document.held_asset.weight, 0);
    assert.ok(b.notes.some((n) => /came without a price/.test(n)));
  });

  it('flags a proxy underlying with no stated ratio, which is where units drift', () => {
    const b = synthesiseStructure(mapped, {
      as_of: '2026-08-14',
      reference_id: 'REF',
      levels: { REF: 7748.5, PXY: 774.85 },
      account: 'FUND-A',
    });
    assert.ok(b.notes.some((n) => /no stated size relative to REF/.test(n)));
  });
});

describe('property: round-trip stability', () => {
  const scenario = read('examples/example_scenario.json') as Scenario;

  const numbersOf = (doc: unknown): string => {
    const r = validateStructure(doc);
    assert.ok(r.ok);
    const report = buildReport(prepareStructure(r.document, scenario), scenario);
    return JSON.stringify(figures(report).map((f) => f.value));
  };

  it('gives identical numbers through a document, a report and back', () => {
    // The third property test from AGENT_BRIEF.md §6. This is what catches unit
    // drift between a proxy underlying and the reference: if a round trip ever
    // rescaled a strike, the two sides of this comparison would part company.
    for (const c of CASES) {
      const original = read(c.structure);
      const roundTripped = JSON.parse(JSON.stringify(original));
      assert.equal(numbersOf(roundTripped), numbersOf(original), `${c.name} drifted`);
    }
  });

  it('survives the CSV path, out to a document and back in', () => {
    const built = synthesiseStructure(applyMapping(CSV, OCC_MAPPING), {
      as_of: '2026-08-14',
      reference_id: 'REF',
      levels: { REF: 7748.5, PXY: 774.85 },
      ratios: { REF: 1, PXY: 0.1 },
      account: 'FUND-A',
    });
    const downloaded = JSON.stringify(built.document, null, 2);
    assert.equal(numbersOf(JSON.parse(downloaded)), numbersOf(built.document));
  });

  it('notices a proxy level put on the wrong axis, so the test has teeth', () => {
    // This is the unit drift that matters. Strikes and levels are both quoted
    // in the proxy's own units, so the arithmetic stays self-consistent as long
    // as they travel together — which is why deleting `ratio_to_reference`
    // alone changes nothing but display and classification. What breaks the
    // numbers is a level that has moved onto the index's scale while its
    // strikes stayed on the proxy's.
    const original = read(CASES[0]!.structure) as Record<string, Record<string, Record<string, unknown>>>;
    const damaged = JSON.parse(JSON.stringify(original));
    damaged['underlyings']['PXY']['level'] = 7748.5;
    assert.notEqual(numbersOf(damaged), numbersOf(original));
  });

  it('preserves every digit through JSON, which is what a download relies on', () => {
    // Figures carry full precision and the renderer rounds. A download that
    // shortened a double would give a different report on the way back in.
    const original = read(CASES[0]!.structure);
    const text = JSON.stringify(original);
    assert.deepEqual(JSON.parse(text), original);
    assert.equal(JSON.stringify(JSON.parse(text)), text);
  });
});
