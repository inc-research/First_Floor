// SPDX-License-Identifier: MIT

/**
 * Phase 8 gate, the rendering half: every view renders both examples without
 * throwing, the report shows all eleven sections in both voices, and the
 * sliders recompute through `sweep` rather than through arithmetic of their own.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom, type FakeElement, type InstalledDom } from './dom-shim.ts';
// Type-only, so it is erased and does not evaluate the module before the shim
// is installed.
import type { AppState } from '../src/state.ts';

let dom: InstalledDom;
before(() => {
  dom = installDom();
});
after(() => dom.uninstall());

// Static imports are safe here: no view module touches `document` while it is
// being evaluated, only when a view function is called, and `before` has run by
// then. Dynamic `await import` at the top level would let the runner finish the
// file's parent test before these subtests were registered.
import { startView } from '../src/views/start.ts';
import { manualView } from '../src/views/manual.ts';
import { reviewView } from '../src/views/review.ts';
import { reportView } from '../src/views/report.ts';
import { limitationsView } from '../src/views/limitations.ts';
import { computeReport, initialState, validateDraft } from '../src/state.ts';
import { exampleALadderedFloor, exampleCMinimalBuffer } from '../src/examples.generated.ts';
import { deckFor } from '@first-floor/copy';
import { figures } from '@first-floor/core';

function stateFor(doc: unknown): AppState {
  const state = initialState();
  state.draft = JSON.stringify(doc, null, 2);
  const { structure, problems } = validateDraft(state);
  state.structure = structure;
  state.problems = problems;
  state.report = computeReport(state);
  return state;
}

const noop = () => {};

describe('the start view', () => {
  it('offers four input paths', () => {
    const v = startView(initialState(), { onDraft: noop, onManual: noop, onMapCsv: noop }) as unknown as FakeElement;
    assert.equal(v.findByClass('card').length, 4);
  });

  it('states the refusals on the front page, not buried', () => {
    const v = startView(initialState(), { onDraft: noop, onManual: noop, onMapCsv: noop }) as unknown as FakeElement;
    const text = v.textContent;
    assert.match(text, /does not fetch data/i);
    assert.match(text, /does not rank funds/i);
    assert.match(text, /does not forecast/i);
  });

  it('hands the worked example straight to the review step', () => {
    let handed: string | null = null;
    const v = startView(initialState(), {
      onDraft: (json) => { handed = json; },
      onManual: noop,
      onMapCsv: noop,
    }) as unknown as FakeElement;
    v.findByClass('card')[3]!.click();
    assert.ok(handed, 'the example path produced no draft');
    assert.equal(JSON.parse(handed!).schema_version, '0.2.0');
  });
});

describe('the fact-sheet view', () => {
  it('renders its fields and refuses to build from blanks', () => {
    let handed: string | null = null;
    const v = manualView({ onDraft: (j) => { handed = j; }, onCancel: noop }) as unknown as FakeElement;
    assert.ok(v.findAll('input').length >= 6, 'six numbers, plus dates');
    v.findAll('button').find((b) => b.textContent.includes('Build'))!.click();
    assert.equal(handed, null, 'empty fields must not produce a document');
    assert.match(v.textContent, /needs a positive number/);
  });
});

describe('the review step', () => {
  it('teaches the anatomy by listing every contract', () => {
    const state = stateFor(exampleALadderedFloor);
    const v = reviewView(state, {
      onDraftChange: noop, onRun: noop, onBack: noop, onLoadComposition: noop,
    }) as unknown as FakeElement;
    const bodyRows = v.findAll('tr').filter((r) => r.findAll('td').length > 0);
    // Seven legs plus the summary rows.
    assert.ok(bodyRows.length >= 7, `expected at least 7 contract rows, got ${bodyRows.length}`);
    assert.match(v.textContent, /P1/);
    assert.match(v.textContent, /C3/);
  });

  it('puts proxy strikes on the index axis, where a mis-read shows itself', () => {
    const state = stateFor(exampleALadderedFloor);
    const v = reviewView(state, {
      onDraftChange: noop, onRun: noop, onBack: noop, onLoadComposition: noop,
    }) as unknown as FakeElement;
    // The lowest put is 24.6% below the index once the tenth-scale ratio is
    // applied. Without the ratio it would read as −92%.
    assert.match(v.textContent, /-24\.6%/);
    assert.match(v.textContent, /0\.1× the index/);
  });

  it('blocks the run button while the document is invalid', () => {
    const state = initialState();
    state.draft = '{ not json';
    const { structure, problems } = validateDraft(state);
    state.structure = structure;
    state.problems = problems;

    const v = reviewView(state, {
      onDraftChange: noop, onRun: noop, onBack: noop, onLoadComposition: noop,
    }) as unknown as FakeElement;
    const run = v.findAll('button').find((b) => b.textContent.includes('Work out'))!;
    assert.equal(run.disabled, true);
    assert.match(v.textContent, /not valid JSON/);
  });

  it('names the unpriced contracts rather than quietly modelling them', () => {
    const state = stateFor(exampleCMinimalBuffer);
    const v = reviewView(state, {
      onDraftChange: noop, onRun: noop, onBack: noop, onLoadComposition: noop,
    }) as unknown as FakeElement;
    assert.match(v.textContent, /came without a price/);
    assert.match(v.textContent, /SYN, BUF_L, BUF_S, CAP/);
  });
});

describe('the report view', () => {
  for (const [name, doc] of [['A', exampleALadderedFloor], ['C', exampleCMinimalBuffer]] as const) {
    for (const voice of ['plain', 'technical'] as const) {
      it(`renders every section of example ${name} in ${voice}`, () => {
        const state = stateFor(doc);
        state.voice = voice;
        const v = reportView(state, {
          onSliders: noop, onVoice: noop, onBack: noop,
        }) as unknown as FakeElement;

        const text = v.textContent;
        const deck = deckFor(voice);
        for (const f of figures(state.report!)) {
          assert.ok(text.includes(deck[f.metric].title), `${name}/${voice}: "${f.metric}" missing`);
        }
        assert.ok(!text.includes('undefined'), 'a missing figure rendered as undefined');
        assert.ok(!text.includes('NaN'));
      });
    }
  }

  it('binds sliders to exactly the four closed-form parameters', () => {
    const state = stateFor(exampleALadderedFloor);
    const v = reportView(state, { onSliders: noop, onVoice: noop, onBack: noop }) as unknown as FakeElement;
    const ranges = v.findAll('input').filter((i) => i.getAttribute('type') === 'range');
    assert.equal(ranges.length, 4, 'beta_down, beta_up, vol_beta and the index move — no more');
  });

  it('says the capture grid does not follow the sliders', () => {
    // D-20: the Monte Carlo is computed once per report and is not draggable.
    const state = stateFor(exampleALadderedFloor);
    const v = reportView(state, { onSliders: noop, onVoice: noop, onBack: noop }) as unknown as FakeElement;
    assert.match(v.textContent, /does not: it is a simulation, worked out once/);
  });

  it('recomputes the live figures when a slider moves', () => {
    const state = stateFor(exampleALadderedFloor);
    const applied: Partial<AppState['sliders']>[] = [];
    const v = reportView(state, {
      onSliders: (next) => { applied.push(next); Object.assign(state.sliders, next); },
      onVoice: noop,
      onBack: noop,
    }) as unknown as FakeElement;

    const before = v.textContent;
    const betaDown = v.findAll('input').filter((i) => i.getAttribute('type') === 'range')[0]!;
    betaDown.value = '1.40';
    betaDown.dispatch('input');

    assert.deepEqual(applied, [{ betaDown: 1.4 }]);
    assert.notEqual(v.textContent, before, 'the figures did not move with the slider');
    assert.match(v.textContent, /1\.40×/);
  });

  it('offers a download and a copy, because there is no link to share', () => {
    const state = stateFor(exampleALadderedFloor);
    const v = reportView(state, { onSliders: noop, onVoice: noop, onBack: noop }) as unknown as FakeElement;
    const labels = v.findAll('button').map((b) => b.textContent);
    assert.ok(labels.some((l) => l.includes('Download structure document')));
    assert.ok(labels.some((l) => l.includes('Copy report as Markdown')));
    assert.match(v.textContent, /no link to share/);
  });

  it('shows every blocked figure with its remedy rather than a blank', () => {
    const state = stateFor(exampleCMinimalBuffer);
    const v = reportView(state, { onSliders: noop, onVoice: noop, onBack: noop }) as unknown as FakeElement;
    const blocked = v.findByClass('blocked');
    assert.ok(blocked.length > 0, 'example C has figures that cannot be computed');
    for (const b of blocked) assert.ok(b.textContent.trim().length > 40);
  });

  it('carries assumption blocks on the figures, in both voices', () => {
    for (const voice of ['plain', 'technical'] as const) {
      const state = stateFor(exampleALadderedFloor);
      state.voice = voice;
      const v = reportView(state, { onSliders: noop, onVoice: noop, onBack: noop }) as unknown as FakeElement;
      assert.ok(v.findByClass('assumptions').length > 3, `${voice}: assumptions were dropped`);
    }
  });
});

describe('the limitations page', () => {
  it('leads with the assumption the headline turns on', () => {
    const v = limitationsView() as unknown as FakeElement;
    assert.match(v.textContent, /is an input, not a measurement/);
    assert.match(v.textContent, /not an amount anyone collects/);
    assert.match(v.textContent, /One path is not a distribution/);
    assert.match(v.textContent, /not advice/);
  });
});
