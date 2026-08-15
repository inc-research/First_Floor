// SPDX-License-Identifier: MIT

/**
 * Phase 7c gate: every metric renders in both voices, every figure carries its
 * assumptions, and plain mode contains no banned words.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildReport,
  figures,
  prepareStructure,
  validateReferenceComposition,
  validateScenario,
  validateStructure,
  type CollaredStructure,
  type MetricKey,
  type ReferenceComposition,
  type Scenario,
} from '@first-floor/core';

import { plainDeck } from '../src/plain.ts';
import { technicalDeck } from '../src/technical.ts';
import { renderAssumption } from '../src/assumptions.ts';
import { renderReport } from '../src/render.ts';
import { BANNED_IN_PLAIN, formatFindings, lintDeep, lintText } from '../src/lint.ts';
import type { Voice } from '../src/types.ts';

const ROOT = new URL('../../../', import.meta.url);
const read = (p: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8'));

function load(structurePath: string, scenarioPath: string, withComposition: boolean) {
  const sv = validateStructure(read(structurePath));
  assert.ok(sv.ok);
  const cv = validateScenario(read(scenarioPath));
  assert.ok(cv.ok);
  const prepared = prepareStructure(sv.document as CollaredStructure, cv.document as Scenario);
  let composition: ReferenceComposition | null = null;
  if (withComposition) {
    const rc = validateReferenceComposition(read('examples/reference_composition_synthetic.json'));
    assert.ok(rc.ok);
    composition = rc.document as ReferenceComposition;
  }
  return buildReport(prepared, cv.document as Scenario, { composition });
}

const reportA = load(
  'examples/example_a_laddered_floor.json',
  'examples/example_scenario.json',
  true,
);
const reportC = load(
  'examples/example_c_minimal_hand_typed.json',
  'examples/scenario_minimal.json',
  false,
);

const VOICES: Voice[] = ['plain', 'technical'];

describe('the plain deck avoids the words that turn measurement into promise', () => {
  it('contains no banned words anywhere', () => {
    const findings = lintDeep(plainDeck, 'plainDeck');
    assert.equal(findings.length, 0, `\n${formatFindings(findings)}`);
  });

  it('lints assumption lines in plain voice too', () => {
    // The temptation is to strip assumption lines from plain mode because they
    // are hard to phrase simply. That is exactly backwards, so they are linted
    // like everything else.
    const lines = collectAssumptionLines('plain');
    const findings = lines.flatMap((l, i) => lintText(`assumption[${i}]`, l));
    assert.equal(findings.length, 0, `\n${formatFindings(findings)}`);
  });

  it('lints the whole rendered plain report, not just the deck', () => {
    for (const [name, report] of [['A', reportA], ['C', reportC]] as const) {
      const findings = lintText(`report ${name}`, renderReport(report, 'plain'));
      assert.equal(findings.length, 0, `\n${formatFindings(findings)}`);
    }
  });

  it('actually catches banned words, so the lint is not vacuous', () => {
    assert.equal(lintText('t', 'you are protected below −10%').length, 1);
    assert.equal(lintText('t', 'this will fall').length, 1);
    assert.equal(lintText('t', 'it ensures a floor').length, 1);
    assert.equal(lintText('t', 'a guaranteed outcome').length, 1);
    // Word boundaries: these are innocent.
    assert.equal(lintText('t', 'a willing buyer met safety standards').length, 0);
    assert.equal(lintText('t', 'protection_kind is a field name').length, 0);
  });

  it('bans exactly the eight words D-25 names', () => {
    assert.deepEqual([...BANNED_IN_PLAIN].sort(), [
      'ensures', 'guarantee', 'guaranteed', 'protect', 'protected', 'safe', 'should', 'will',
    ]);
  });
});

describe('both decks cover every metric', () => {
  const metrics = figures(reportA).map((f) => f.metric);

  it('has a hand-written entry for each metric in both voices', () => {
    for (const deck of [plainDeck, technicalDeck]) {
      for (const m of metrics) {
        const entry = deck[m];
        assert.ok(entry, `no entry for ${m}`);
        assert.ok(entry.title.length > 0, `${m}: no title`);
        assert.ok(entry.mechanism.length > 40, `${m}: mechanism too thin to explain anything`);
        assert.ok(entry.whatWouldChangeIt.length > 20, `${m}: no "what would make this different"`);
      }
    }
  });

  it('explains mechanism rather than delivering a verdict', () => {
    // A weak proxy for a judgement call, but it catches the obvious regression:
    // plain entries should read as descriptions of what happens.
    for (const m of Object.keys(plainDeck) as MetricKey[]) {
      const text = plainDeck[m].mechanism;
      assert.ok(!/^you (are|have|get)\b/i.test(text), `${m}: opens with a verdict about the reader`);
    }
  });

  it('keeps the two voices genuinely different', () => {
    for (const m of Object.keys(plainDeck) as MetricKey[]) {
      assert.notEqual(plainDeck[m].mechanism, technicalDeck[m].mechanism, `${m} is not translated`);
    }
  });
});

describe('rendering', () => {
  for (const voice of VOICES) {
    it(`renders every section of example A in ${voice}`, () => {
      const md = renderReport(reportA, voice);
      for (const f of figures(reportA)) {
        assert.ok(
          md.includes(deckTitle(voice, f.metric)),
          `${voice}: section "${f.metric}" missing`,
        );
      }
      assert.ok(md.includes(reportA.as_of), 'every page carries its as-of date');
    });

    it(`renders example C in ${voice} without inventing the figures it lacks`, () => {
      const md = renderReport(reportC, voice);
      assert.ok(md.length > 500);
      assert.ok(!md.includes('undefined'), 'a missing figure must not render as undefined');
      assert.ok(!md.includes('NaN'));
      assert.ok(!md.includes('null'));
    });
  }

  it('prints the assumptions beside the figures in both voices', () => {
    for (const voice of VOICES) {
      const md = renderReport(reportA, voice);
      assert.ok(md.includes('11'), 'the capture seed appears');
      assert.ok(
        /β_down|holdings fall/.test(md),
        `${voice}: the held-asset response is never stated`,
      );
    }
  });

  it('never captions mark-to-market with a beta it did not use', () => {
    // Erratum E-06. The figure fixes the held-asset response at 1.0, so a
    // renderer stating the scenario's beta beside it would be advertising an
    // assumption the number never consumed.
    const mtm = reportA.mark_to_market;
    const rendered = mtm.assumptions.map((a) => renderAssumption(a, 'plain')).join(' ');
    assert.match(rendered, /exactly in step/);
    assert.ok(!/times as far/.test(rendered), 'a swept beta leaked into the mtm caption');
  });

  it('states the blocker and its remedy where a figure is absent', () => {
    const md = renderReport(reportC, 'plain');
    assert.match(md, /No index composition was supplied/);
    assert.match(md, /reference_composition/, 'and says what would unblock it');
  });

  it('rounds only at the render boundary', () => {
    // The core returns full precision; the renderer decides. -20.2957% becomes
    // -20.30%, and the underlying value is untouched.
    assert.equal(reportA.terminal_floor.value!.value, -0.2029568749913223);
    assert.match(renderReport(reportA, 'plain'), /-20\.30%/);
  });

  it('carries the capture realisation label, which is a category error to omit', () => {
    assert.match(renderReport(reportA, 'plain'), /given up for good/);
    assert.match(renderReport(reportA, 'technical'), /realised and permanent/);
  });

  it('preserves the counter-intuitive tenor lesson in the prose', () => {
    assert.match(plainDeck.capture.whatWouldChangeIt, /Shorter renewal periods keep more/);
    assert.match(technicalDeck.capture.whatWouldChangeIt, /Shorter tenors forfeit less/);
  });

  it('says the terminal floor is not collectible, in both voices', () => {
    for (const voice of VOICES) {
      const md = renderReport(reportA, voice);
      assert.ok(
        /no single day|not a collectible outcome/i.test(md),
        `${voice}: the mandatory caveat is missing`,
      );
    }
  });
});

function deckTitle(voice: Voice, metric: MetricKey): string {
  return (voice === 'plain' ? plainDeck : technicalDeck)[metric].title;
}

function collectAssumptionLines(voice: Voice): string[] {
  const lines: string[] = [];
  for (const report of [reportA, reportC]) {
    for (const f of figures(report)) {
      for (const a of f.assumptions) lines.push(renderAssumption(a, voice));
    }
  }
  return lines;
}
