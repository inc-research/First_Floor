// SPDX-License-Identifier: MIT

/**
 * Phase 9d: the column mapper reads the worked file end to end, keeps accounts
 * apart, and falls through to manual entry rather than to an error.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { installDom, type FakeElement, type InstalledDom } from './dom-shim.ts';

const ROOT = new URL('../../../', import.meta.url);
const readText = (p: string): string => readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8');

let dom: InstalledDom;
let savedFileReader: PropertyDescriptor | undefined;
before(() => {
  dom = installDom();
  // The upload path reads the file through a FileReader. Stubbed synchronously
  // rather than avoided, because the file *name* only reaches recognition
  // through this handler and a test that bypassed it would not cover it.
  savedFileReader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
  Object.defineProperty(globalThis, 'FileReader', {
    value: class {
      onload: (() => void) | null = null;
      result: string | null = null;
      readAsText(file: { text: string }): void {
        this.result = file.text;
        this.onload?.();
      }
    },
    configurable: true,
    writable: true,
  });
});
after(() => {
  dom.uninstall();
  if (savedFileReader) Object.defineProperty(globalThis, 'FileReader', savedFileReader);
  else delete (globalThis as Record<string, unknown>)['FileReader'];
});

import { mapperView } from '../src/views/mapper.ts';
import { startView } from '../src/views/start.ts';
import { initialState } from '../src/state.ts';
import { validateStructure } from '@first-floor/core';

const noop = () => {};

/** Load the worked example file into a freshly rendered mapper. */
function openWithExample(handlers: Partial<Parameters<typeof mapperView>[0]> = {}) {
  const v = mapperView({
    onDraft: handlers.onDraft ?? noop,
    onManual: handlers.onManual ?? noop,
    onCancel: handlers.onCancel ?? noop,
  }) as unknown as FakeElement;
  v.findAll('button').find((b) => b.textContent.includes('worked example file'))!.click();
  return v;
}

const setNumber = (v: FakeElement, label: string, value: string): void => {
  const field = v.findByClass('field').find((f) => f.textContent.startsWith(label));
  assert.ok(field, `no field labelled "${label}"`);
  const input = field!.findAll('input')[0]!;
  input.value = value;
  input.dispatch('change');
};

/** Render a mapper and hand it a named file, the way the page is actually used. */
function openWithFile(text: string, name: string, handlers: Partial<Parameters<typeof mapperView>[0]> = {}) {
  const v = mapperView({
    onDraft: handlers.onDraft ?? noop,
    onManual: handlers.onManual ?? noop,
    onCancel: handlers.onCancel ?? noop,
  }) as unknown as FakeElement;
  const input = v.findAll('input').find((i) => i.getAttribute('type') === 'file')!;
  input.files = [{ name, text }];
  input.dispatch('change');
  return v;
}

const valueOf = (v: FakeElement, label: string): string => {
  const field = v.findByClass('field').find((f) => f.textContent.startsWith(label));
  assert.ok(field, `no field labelled "${label}"`);
  return field!.findAll('input')[0]!.value;
};

const pickIndex = (v: FakeElement, root: string): void => {
  const field = v.findByClass('field').find((f) => f.textContent.startsWith('Which one is the index'));
  assert.ok(field, 'no index picker');
  const s = field!.findAll('select')[0]!;
  s.value = root;
  s.dispatch('change');
};

describe('the start view offers the holdings path', () => {
  it('lists four ways in', () => {
    const v = startView(initialState(), {
      onDraft: noop, onManual: noop, onMapCsv: noop,
    }) as unknown as FakeElement;
    assert.equal(v.findByClass('card').length, 4);
    assert.match(v.textContent, /A holdings file/);
  });
});

describe('the column mapper', () => {
  it('detects a workable mapping and reports what it read', () => {
    // Chosen by result rather than by guessing from header names: whether a
    // mapping works is observable.
    const v = openWithExample();
    assert.match(v.textContent, /Option positions/);
    assert.match(v.textContent, /Rows it could not read/);
    // 11 options across both accounts, nothing unreadable.
    const rows = v.findAll('tr').map((r) => r.childNodes.map((c) => c.textContent));
    const options = rows.find((r) => r[0] === 'Option positions');
    const unreadable = rows.find((r) => r[0] === 'Rows it could not read');
    assert.equal(options?.[1], '11');
    assert.equal(unreadable?.[1], '0');
  });

  it('shows the contracts it found, so a mis-read is visible immediately', () => {
    const v = openWithExample();
    assert.match(v.textContent, /584/);
    assert.match(v.textContent, /2027-03-31/);
    assert.match(v.textContent, /long put/);
    assert.match(v.textContent, /short call/);
  });

  it('offers an account picker when the file mixes accounts', () => {
    const v = openWithExample();
    assert.match(v.textContent, /Which account/);
    assert.match(v.textContent, /would describe a portfolio nobody owns/);
    const options = v.findAll('option').map((o) => o.getAttribute('value'));
    assert.ok(options.includes('FUND-A'));
    assert.ok(options.includes('FUND-B'));
  });

  it('defaults the index to the larger-scaled root, not the first alphabetically', () => {
    // A real defect found by reading the rendered page. Roots sort to
    // ['PXY','REF'], so taking the first offered "PXY level today — the index
    // this structure is collared against", and anyone who typed 774.85 there
    // would have got a report that was wrong throughout and looked fine.
    const v = openWithExample();
    const refLevel = v.findByClass('field').find((f) => f.textContent.startsWith('REF level today'));
    assert.ok(refLevel, 'no REF level field');
    assert.match(refLevel!.textContent, /The index this structure is collared against/);

    const ratio = v.findByClass('field').find((f) => f.textContent.startsWith('PXY size relative to'));
    assert.ok(ratio, 'PXY should be the proxy, and asked for its ratio');
    assert.match(ratio!.textContent, /A tenth-scale proxy is 0\.1/);
  });

  it('lets the user override the guessed index and keeps that choice', () => {
    const v = openWithExample();
    pickIndex(v, 'PXY');
    assert.ok(
      v.findByClass('field').some((f) => f.textContent.startsWith('REF size relative to PXY')),
      'an explicit choice must stick',
    );
  });

  it('asks for the levels a holdings file does not record', () => {
    const v = openWithExample();
    assert.match(v.textContent, /PXY level today/);
    assert.match(v.textContent, /REF level today/);
    assert.match(v.textContent, /size relative to/);
    assert.match(v.textContent, /A strike of 5800 says nothing until it can be set against a level/);
  });

  it('refuses to build until the levels are given', () => {
    let handed: string | null = null;
    const v = openWithExample({ onDraft: (j) => { handed = j; } });
    v.findAll('button').find((b) => b.textContent.includes('Build the structure'))!.click();
    assert.equal(handed, null);
    assert.match(v.textContent, /Still need today’s price for/);
    assert.match(v.textContent, /records what is owned, not where the underlying is trading/);
  });

  it('builds a valid structure document once told the levels', () => {
    let handed: string | null = null;
    const v = openWithExample({ onDraft: (j) => { handed = j; } });
    pickIndex(v, 'REF');
    setNumber(v, 'PXY level today', '774.85');
    setNumber(v, 'REF level today', '7748.5');
    setNumber(v, 'PXY size relative to', '0.1');
    v.findAll('button').find((b) => b.textContent.includes('Build the structure'))!.click();

    assert.ok(handed, 'no document was produced');
    const result = validateStructure(JSON.parse(handed!));
    assert.ok(result.ok, `rejected: ${JSON.stringify(result.problems ?? [], null, 2)}`);
    // Both accounts together by default: eleven contracts.
    assert.equal(result.document.option_legs.length, 11);
    assert.equal(result.document.underlyings['PXY']!.ratio_to_reference, 0.1);
  });

  it('keeps the accounts apart when one is chosen', () => {
    let handed: string | null = null;
    const v = openWithExample({ onDraft: (j) => { handed = j; } });
    const picker = v.findAll('select').find((s) =>
      s.findAll('option').some((o) => o.getAttribute('value') === 'FUND-B'))!;
    picker.value = 'FUND-B';
    picker.dispatch('change');

    // FUND-B holds contracts on REF alone, so PXY is no longer asked about at
    // all -- neither a level nor a ratio -- and with one root there is no index
    // left to choose. This is the fix for demanding a level for every root in
    // a file that holds a whole fund complex.
    assert.ok(!v.textContent.includes('PXY level today'), 'PXY belongs to the other account');
    assert.ok(!v.textContent.includes('Which one is the index'), 'one root, nothing to pick');

    setNumber(v, 'REF level today', '109.61');

    // FUND-B's contracts carry no marks and it holds no shares or cash, so the
    // file cannot supply a fund size and the build is refused until one is
    // given. Previously this produced net_assets: 0 and a schema error two
    // screens later.
    v.findAll('button').find((b) => b.textContent.includes('Build the structure'))!.click();
    assert.equal(handed, null, 'a fund size of nothing must not build');
    assert.match(v.textContent, /Fund size has to be a positive number/);

    setNumber(v, 'Fund size', '164111128');
    v.findAll('button').find((b) => b.textContent.includes('Build the structure'))!.click();

    const doc = JSON.parse(handed!);
    assert.equal(doc.option_legs.length, 4, 'FUND-B holds four contracts');
    assert.equal(doc.held_asset.weight, 0);
    assert.equal(doc.capital.net_assets, 164111128);
    assert.deepEqual(Object.keys(doc.underlyings), ['REF'], 'PXY belongs to the other account');
  });

  it('lets the mapping be saved for next time', () => {
    const v = openWithExample();
    assert.ok(v.findAll('button').some((b) => b.textContent.includes('Save this mapping')));
    assert.match(v.textContent, /give it to anyone else using the same broker/);
  });

  it('falls through to typing the numbers when a file cannot be read', () => {
    // An unmapped file is a normal Tuesday, not the end of the road.
    let wentManual = false;
    const v = mapperView({
      onDraft: noop,
      onManual: () => { wentManual = true; },
      onCancel: noop,
    }) as unknown as FakeElement;

    // Drive a file with no options in it at all.
    const button = v.findAll('button').find((b) => b.textContent.includes('worked example'))!;
    button.click();
    const identifier = v.findByClass('field').find((f) => f.textContent.startsWith('Identifier'))!;
    const select = identifier.findAll('select')[0]!;
    select.value = '';
    select.dispatch('change');

    const fallbackButton = v.findAll('button').find((b) => b.textContent.includes('Type the numbers instead'));
    assert.ok(fallbackButton, 'no fallback to manual entry was offered');
    fallbackButton!.click();
    assert.equal(wentManual, true);
  });
});

describe('recognising an issuer’s own export', () => {
  const ISHARES = readText('examples/holdings_ishares_style.csv');
  const MULTI = readText('examples/holdings_multi_fund_style.csv');

  it('names what it recognised, and why', () => {
    const v = openWithFile(ISHARES, 'SYNB_holdings.csv');
    assert.match(v.textContent, /Recognised: iShares/);
    assert.match(v.textContent, /SYNB/, 'the ticker comes off the file name');
    assert.match(v.textContent, /3 contracts/);
    // The evidence is the point: a page that silently fills twelve dropdowns in
    // is asking to be trusted about something no longer on screen.
    assert.match(v.textContent, /expected column headers/);
    assert.match(v.textContent, /the file name follows/);
  });

  it('folds the column form away, one button from being back', () => {
    const v = openWithFile(ISHARES, 'SYNB_holdings.csv');
    assert.ok(!v.textContent.includes('Which column is which'), 'the form is answered already');
    const adjust = v.findAll('button').find((b) => b.textContent.includes('Adjust the mapping'));
    assert.ok(adjust, 'nothing is hidden for good');
    adjust!.click();
    assert.match(v.textContent, /Which column is which/);
    assert.match(v.textContent, /Option description/);
  });

  it('still asks for the level the file cannot record, and builds from it', () => {
    let handed: string | null = null;
    const v = openWithFile(ISHARES, 'SYNB_holdings.csv', { onDraft: (j) => { handed = j; } });
    assert.match(v.textContent, /REF level today/);
    setNumber(v, 'REF level today', '781.47');
    v.findAll('button').find((b) => b.textContent.includes('Build the structure'))!.click();

    const result = validateStructure(JSON.parse(handed!));
    assert.ok(result.ok, `rejected: ${JSON.stringify(result.problems ?? [], null, 2)}`);
    assert.equal(result.document.option_legs.length, 3);
    assert.equal(result.document.as_of, '2026-08-13', 'the date was read from the file');
  });

  it('says which expiry days it supplied rather than read', () => {
    // The file names a month and no day. A date that looks measured and is not
    // is exactly the quiet default the rest of this codebase refuses.
    const v = openWithFile(ISHARES, 'SYNB_holdings.csv');
    assert.match(v.textContent, /day assumed/);
    assert.match(v.textContent, /taken by convention rather than read/);
  });

  it('takes each fund’s stated size out of a family-wide file', () => {
    const v = openWithFile(MULTI, 'xyz_holdings.csv');
    assert.match(v.textContent, /3 accounts/);
    const picker = v.findAll('select').find((s) =>
      s.findAll('option').some((o) => o.getAttribute('value') === 'FUND-A'))!;
    picker.value = 'FUND-A';
    picker.dispatch('change');
    assert.equal(valueOf(v, 'Fund size'), '73216535');
    assert.match(v.textContent, /As the file states it/);
  });

  it('offers a filter once the list is too long to read', () => {
    // A family-wide file runs to a couple of hundred funds, and scrolling a
    // dropdown that long is a worse way to find one than typing its ticker.
    const [header, ...rows] = MULTI.trimEnd().split('\n');
    const many = [
      header,
      ...Array.from({ length: 15 }, (_, i) =>
        rows
          .filter((r) => r.includes('FUND-A'))
          .map((r) => r.replace('FUND-A', `FUND-${String(i).padStart(2, '0')}`))
          .join('\n')),
    ].join('\n');

    const v = openWithFile(many, 'many_holdings.csv');
    const filter = v.findByClass('field').find((f) => f.textContent.startsWith('Find an account'));
    assert.ok(filter, 'fifteen accounts and no way to search them');

    const box = filter!.findAll('input')[0]!;
    const picker = v.findAll('select').find((s) =>
      s.findAll('option').some((o) => o.getAttribute('value') === 'FUND-07'))!;
    box.value = 'FUND-1';
    box.dispatch('input');
    const left = picker.findAll('option').map((o) => o.getAttribute('value')).filter((x) => x !== '');
    assert.deepEqual(left, ['FUND-10', 'FUND-11', 'FUND-12', 'FUND-13', 'FUND-14']);
  });

  it('says nothing of the sort about a file no profile claims', () => {
    // The worked example is mapped by hand, and must keep behaving as it did.
    const v = openWithExample();
    assert.ok(!v.textContent.includes('Recognised:'));
    assert.match(v.textContent, /Which column is which/);
  });

  it('tells the reader where the file comes from and not to rename it', () => {
    const v = mapperView({ onDraft: noop, onManual: noop, onCancel: noop }) as unknown as FakeElement;
    assert.match(v.textContent, /issuer’s own fund page/);
    assert.match(v.textContent, /Do not rename it/);
  });
});
