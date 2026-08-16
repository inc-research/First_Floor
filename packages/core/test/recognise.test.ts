// SPDX-License-Identifier: MIT

/**
 * Recognising an issuer's own export, and filling the mapping in from it.
 *
 * The fixtures are synthetic look-alikes (D-31): the same preamble, the same
 * header cells, the same option syntax, invented tickers and numbers. Real
 * issuer files are never committed, and `scripts/smoke-recognise.mjs` is what
 * runs the profiles against them on a machine that has them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { recogniseFormat, parseLooseDate } from '../src/adapters/recognise.ts';
import { SHIPPED_MAPPINGS } from '../src/adapters/profiles.generated.ts';
import { render as renderProfilesModule } from '../../../scripts/generate-profiles-module.mjs';
import { applyMapping, statedNetAssetsFor, synthesiseStructure, type ColumnMapping } from '../src/adapters/mapping.ts';
import { parseOptionName, resolveExpiryDay } from '../src/adapters/optionNames.ts';
import { validateStructure } from '../src/schema/validate.ts';
import { read } from './helpers.ts';

const ROOT = new URL('../../../', import.meta.url);
const readText = (p: string): string => readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8');

const PROFILES = [
  'mapping_ishares_holdings.json',
  'mapping_jpmorgan_holdings.json',
  'mapping_multi_fund_daily.json',
  'mapping_occ_long_form.json',
  'mapping_spaced_description.json',
  'mapping_explicit_columns.json',
].map((f) => read(`examples/${f}`) as ColumnMapping);

const ISHARES = readText('examples/holdings_ishares_style.csv');
const JPMORGAN = readText('examples/holdings_jpmorgan_style.csv');
const MULTI = readText('examples/holdings_multi_fund_style.csv');
const HAND_MAPPED = readText('examples/holdings_synthetic.csv');

describe('recognising a file', () => {
  it('names the profile an iShares-shaped export was written for', () => {
    const hit = recogniseFormat({ text: ISHARES, filename: 'SYNB_holdings.csv' }, PROFILES);
    assert.ok(hit, 'not recognised');
    assert.match(hit.mapping.name, /iShares/);
    assert.equal(hit.mapping.header_row, 9, 'the header sits under a nine-line preamble');
    assert.equal(hit.hints.ticker, 'SYNB', 'the ticker comes from the file name');
    assert.equal(hit.hints.as_of, '2026-08-13', 'the date comes from the preamble');
  });

  it('finds the header row itself, wherever the issuer put it', () => {
    // The banner row above a J.P. Morgan header is padded to the same width, so
    // the reader's own widest-row heuristic picks it and every column comes out
    // one row late. The signature knows what the header says, so it does not.
    const hit = recogniseFormat({ text: JPMORGAN, filename: 'JPMorgan-X-Holdings-08-14-2026.csv' }, PROFILES);
    assert.ok(hit, 'not recognised');
    assert.equal(hit.mapping.header_row, 7);
    assert.equal(hit.hints.as_of, '2026-08-14');
  });

  it('recognises a renamed file on its columns alone', () => {
    // Renaming is the likelier accident, so the file name may only ever add
    // confidence. All three fixtures are named nothing like an issuer's export.
    for (const [text, expected] of [
      [ISHARES, /iShares/],
      [JPMORGAN, /Morgan/],
      [MULTI, /fund family/],
    ] as [string, RegExp][]) {
      const hit = recogniseFormat({ text, filename: 'holdings (1).csv' }, PROFILES);
      assert.ok(hit, 'not recognised without its name');
      assert.match(hit.mapping.name, expected);
    }
  });

  it('recognises nothing in a file no profile claims', () => {
    // The hand-mapped worked example. A profile that fired here would prefill
    // twelve dropdowns with plausible rubbish, which is worse than asking.
    assert.equal(recogniseFormat({ text: HAND_MAPPED, filename: 'holdings_synthetic.csv' }, PROFILES), null);
    assert.equal(recogniseFormat({ text: 'a,b,c\n1,2,3\n' }, PROFILES), null);
    assert.equal(recogniseFormat({ text: '' }, PROFILES), null);
  });

  it('says why, in words the page can show', () => {
    const hit = recogniseFormat({ text: MULTI, filename: 'xyz_holdings.csv' }, PROFILES);
    assert.ok(hit);
    assert.ok(hit.evidence.length >= 2, 'a claim with no evidence is not checkable');
    assert.match(hit.evidence.join(' '), /column headers/);
    assert.ok(hit.confidence > 0 && hit.confidence <= 1);
  });
});

describe('what a recognised mapping reads', () => {
  it('reads an iShares-shaped export without a row left over', () => {
    const hit = recogniseFormat({ text: ISHARES, filename: 'SYNB_holdings.csv' }, PROFILES);
    const file = applyMapping(ISHARES, hit!.mapping);
    assert.equal(file.counts.unreadable, 0);
    assert.equal(file.counts.option, 3);
    assert.deepEqual(file.roots, ['REF'], 'options are described in Name, shares keyed on Ticker');
    const shorts = file.rows.filter((r) => r.option?.position === 'short');
    assert.equal(shorts.length, 2, 'a negative share count is a written position, not a negative one');
  });

  it('takes one underlying from a J.P. Morgan description, not one per contract', () => {
    const hit = recogniseFormat({ text: JPMORGAN }, PROFILES);
    const file = applyMapping(JPMORGAN, hit!.mapping);
    assert.equal(file.counts.unreadable, 0);
    assert.equal(file.counts.option, 3);
    // `root_token: first` on "REF PUT USD 10/30/2026". Left whole, this would
    // be three underlyings named after their own expiries.
    assert.deepEqual(file.roots, ['REF']);
    assert.equal(file.rows.filter((r) => r.holding && r.holding.marketValue > 0).length, 3);
  });

  it('keeps a share row out of the options when the file breaks options into columns', () => {
    // A right column is only a right where it holds one. `CURRENCIES` starts
    // with a c and is not a call; `DOMESTIC COMMON STOCK` is not an option at
    // all. Reading either as one turns ordinary rows into unreadable ones.
    const hit = recogniseFormat({ text: JPMORGAN }, PROFILES);
    const file = applyMapping(JPMORGAN, hit!.mapping);
    const cash = file.rows.filter((r) => r.cash);
    assert.equal(cash.length, 2, 'the money-market row and the currencies row');
    assert.equal(file.rows.filter((r) => r.option?.right === 'call').length, 1);
  });

  it('separates the funds in a family-wide file and takes each one’s stated size', () => {
    const hit = recogniseFormat({ text: MULTI, filename: 'xyz_holdings.csv' }, PROFILES);
    const file = applyMapping(MULTI, hit!.mapping);
    assert.deepEqual(file.accounts, ['FUND-A', 'FUND-B', 'FUND-C']);
    assert.equal(statedNetAssetsFor(file, 'FUND-A'), 73216535);
    assert.equal(statedNetAssetsFor(file, 'FUND-B'), 47667892.5);
    // Two funds disagree, so there is no single answer and none is invented.
    assert.equal(statedNetAssetsFor(file, null), null);
    assert.equal(hit!.hints.as_of, '2026-08-17');
  });

  it('reaches a document that validates, from the file and two typed numbers', () => {
    const hit = recogniseFormat({ text: ISHARES, filename: 'SYNB_holdings.csv' }, PROFILES);
    const file = applyMapping(ISHARES, hit!.mapping);
    const built = synthesiseStructure(file, {
      as_of: hit!.hints.as_of!,
      reference_id: 'REF',
      levels: { REF: 781.47 },
      ratios: { REF: 1 },
      net_assets: 71625261.53,
    });
    assert.equal(validateStructure(built.document).problems.length, 0);
    assert.equal(built.document.option_legs.length, 3);
    // An inferred expiry is never quiet.
    assert.ok(built.notes.some((n) => /not the day/.test(n)));
  });
});

describe('a month with no day in it', () => {
  it('reads the month, the root and the strike out of a month-coded description', () => {
    const parsed = parseOptionName('NOV26 REF US P @ 712.8', 'month_at', {
      expiryDay: 'last_business_day',
    });
    assert.deepEqual(parsed, {
      root: 'REF',
      right: 'put',
      strike: 712.8,
      expiry: '2026-11-30',
      expiry_inferred: true,
    });
  });

  it('does not read the month as the root, which `spaced` would', () => {
    assert.equal(parseOptionName('NOV26 REF US P @ 712.8', 'spaced'), null);
  });

  it('flags every day it supplies, because none of them was read', () => {
    for (const rule of ['last_business_day', 'third_friday'] as const) {
      const parsed = parseOptionName('JAN27 REF US C @ 798.98', 'month_at', { expiryDay: rule });
      assert.equal(parsed?.expiry_inferred, true);
    }
  });

  it('resolves both conventions off a calendar, not off a guess', () => {
    assert.equal(resolveExpiryDay(2027, 1, 'third_friday'), '2027-01-15');
    assert.equal(resolveExpiryDay(2026, 11, 'third_friday'), '2026-11-20');
    // 31 January 2027 is a Sunday; 28 November 2026 is a Saturday.
    assert.equal(resolveExpiryDay(2027, 1, 'last_business_day'), '2027-01-29');
    assert.equal(resolveExpiryDay(2026, 11, 'last_business_day'), '2026-11-30');
  });

  it('refuses a description it cannot place at all', () => {
    assert.equal(parseOptionName('REF US FLEX', 'month_at'), null);
    assert.equal(parseOptionName('NOV26 REF US @ 712.8', 'month_at'), null, 'no right');
    assert.equal(parseOptionName('NOV26 REF US P', 'month_at'), null, 'no strike');
  });
});

describe('reading a date out of a file', () => {
  it('takes the three forms issuers actually write', () => {
    assert.equal(parseLooseDate('2026-08-13'), '2026-08-13');
    assert.equal(parseLooseDate('As of Date: 08/14/2026'), '2026-08-14');
    assert.equal(parseLooseDate('Aug 13, 2026'), '2026-08-13');
  });

  it('returns null rather than today', () => {
    // `new Date(text)` would answer something for most of these, and a holdings
    // file silently dated today is a report about a position nobody holds.
    for (const text of ['', '—', 'Holdings', '13', 'Shares Outstanding']) {
      assert.equal(parseLooseDate(text), null, text);
    }
  });
});

describe('the shipped profiles', () => {
  it('are in step with examples/mapping_*.json', () => {
    const onDisk = readText('packages/core/src/adapters/profiles.generated.ts');
    assert.equal(
      onDisk,
      renderProfilesModule(),
      'profiles.generated.ts is stale; run `node scripts/generate-profiles-module.mjs`',
    );
  });

  it('reach both surfaces from one place', () => {
    // The page and the MCP server read a file identically or they have
    // diverged, and a copy in each is two things to drift.
    assert.equal(SHIPPED_MAPPINGS.length, PROFILES.length);
    assert.deepEqual(SHIPPED_MAPPINGS.map((m) => m.name).sort(), PROFILES.map((m) => m.name).sort());
  });

  it('every profile with a signature recognises its own fixture', () => {
    const withSignature = SHIPPED_MAPPINGS.filter((m) => m.match !== undefined);
    assert.equal(withSignature.length, 3, 'three issuer profiles carry a signature');
    for (const [text, name] of [[ISHARES, 'iShares'], [JPMORGAN, 'Morgan'], [MULTI, 'family']] as const) {
      const hit = recogniseFormat({ text }, SHIPPED_MAPPINGS);
      assert.ok(hit && hit.mapping.name.includes(name), `${name} profile does not claim its fixture`);
    }
  });
});

describe('mappings that were written before any of this', () => {
  it('still apply unchanged', () => {
    // The three original mappings carry no `match`, no `option_identifier` and
    // no `root_token`. Every one of those had to default to what the mapping
    // already meant, or a saved mapping someone kept would start reading their
    // file differently.
    const occ = read('examples/mapping_occ_long_form.json') as ColumnMapping;
    const file = applyMapping(HAND_MAPPED, occ);
    assert.equal(file.counts.option, 11);
    assert.equal(file.counts.equity, 6);
    assert.equal(file.counts.unreadable, 0);
    assert.deepEqual(file.accounts, ['FUND-A', 'FUND-B']);
    assert.ok(file.rows.every((r) => r.option === undefined || r.option.expiryInferred === false));
  });
});
