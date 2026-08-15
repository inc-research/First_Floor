// SPDX-License-Identifier: MIT

/**
 * Phase 9d: the column mapper reads the worked file end to end, keeps accounts
 * apart, and falls through to manual entry rather than to an error.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom, type FakeElement, type InstalledDom } from './dom-shim.ts';

let dom: InstalledDom;
before(() => {
  dom = installDom();
});
after(() => dom.uninstall());

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
    assert.match(v.textContent, /Nothing here is guessed at/);
  });

  it('refuses to build until the levels are given', () => {
    let handed: string | null = null;
    const v = openWithExample({ onDraft: (j) => { handed = j; } });
    v.findAll('button').find((b) => b.textContent.includes('Build the structure'))!.click();
    assert.equal(handed, null);
    assert.match(v.textContent, /Give a level for/);
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
    pickIndex(v, 'REF');
    setNumber(v, 'PXY level today', '774.85');
    setNumber(v, 'REF level today', '109.61');
    setNumber(v, 'PXY size relative to', '0.1');
    v.findAll('button').find((b) => b.textContent.includes('Build the structure'))!.click();

    const doc = JSON.parse(handed!);
    assert.equal(doc.option_legs.length, 4, 'FUND-B holds four contracts');
    assert.equal(doc.held_asset.weight, 0);
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
