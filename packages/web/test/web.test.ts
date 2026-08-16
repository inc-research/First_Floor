// SPDX-License-Identifier: MIT

/**
 * Phase 8 gate, the parts that need no browser: the fact-sheet path produces a
 * valid document, the state layer refuses bad input rather than carrying it
 * forward, and the built bundle contains no way for anything to leave the
 * machine.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildReport,
  prepareStructure,
  validateStructure,
  type Scenario,
} from '@first-floor/core';

import { structureFromFactSheet, type FactSheetInputs } from '../src/views/manual.ts';
import { DEFAULT_SCENARIO } from '../src/state.ts';
import { exampleALadderedFloor, exampleCMinimalBuffer } from '../src/examples.generated.ts';
import { render as renderExamplesModule } from '../../../scripts/generate-examples-module.mjs';

const ROOT = new URL('../../../', import.meta.url);
const readText = (p: string): string => readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8');

const FACT_SHEET: FactSheetInputs = {
  levelToday: 109.61,
  levelAtInception: 93.59,
  coverPct: 0.15,
  coverKind: 'buffer',
  capPct: 0.1582,
  periodEnd: '2027-03-19',
  netAssets: 164_111_128,
  asOf: '2026-08-14',
};

describe('the fact-sheet path', () => {
  it('produces a document that validates', () => {
    const r = validateStructure(structureFromFactSheet(FACT_SHEET));
    assert.ok(r.ok, `rejected: ${JSON.stringify(r.problems ?? [], null, 2)}`);
  });

  it('rebuilds the shape of the hand-typed example from six published numbers', () => {
    // Not the identical document — contract counts and strikes are inferred —
    // but the same four contracts in the same places, which is the claim the
    // input path actually makes.
    const built = structureFromFactSheet(FACT_SHEET);
    const legs = Object.fromEntries(built.option_legs.map((l) => [l.role, l]));

    assert.equal(built.option_legs.length, 4);
    assert.ok(Math.abs(legs['buffer_long']!.strike - 93.59) < 1e-9, 'cover starts at the inception level');
    assert.ok(Math.abs(legs['buffer_short']!.strike - 93.59 * 0.85) < 1e-6, 'and ends 15% below it');
    assert.ok(Math.abs(legs['synthetic_long']!.strike - 0.9359) < 1e-9, 'index exposure from a near-zero strike');
    assert.ok(legs['cap']!.strike > 93.59, 'the cap sits above the inception level');
  });

  it('measures cover from the inception level, not from today', () => {
    // The single most common way to get this wrong. Against today's 109.61 the
    // buffer would start 17% higher and every figure downstream would move.
    const built = structureFromFactSheet(FACT_SHEET);
    const coverLong = built.option_legs.find((l) => l.role === 'buffer_long')!;
    assert.notEqual(coverLong.strike, FACT_SHEET.levelToday);
    assert.equal(coverLong.strike, FACT_SHEET.levelAtInception);
  });

  it('places a floor below the inception level and writes no short put', () => {
    // A buffer absorbs the first losses and stops; a floor takes them and then
    // stops. They sound alike and behave oppositely, so they build differently.
    const floor = structureFromFactSheet({ ...FACT_SHEET, coverKind: 'floor' });
    assert.equal(floor.option_legs.length, 3, 'no short put closes the cover');
    const coverLong = floor.option_legs.find((l) => l.role === 'buffer_long')!;
    assert.ok(Math.abs(coverLong.strike - 93.59 * 0.85) < 1e-6);
  });

  it('reaches a full report without further input', () => {
    const doc = structureFromFactSheet(FACT_SHEET);
    const scenario = DEFAULT_SCENARIO as Scenario;
    const report = buildReport(prepareStructure(doc, scenario), scenario);
    assert.ok(report.terminal_floor.value, 'a floor is computable from six typed numbers');
    assert.equal(report.classification.value!.protection_kind, 'put_spread');
    assert.equal(report.advertised_vs_computed.value!.advertised_protection_pct, 0.15);
    // No held asset and no marks, so these stay blocked rather than invented.
    assert.equal(report.concentration.value, null);
    assert.equal(report.positioning.value!.weights_reconcile, null);
  });
});

describe('the bundled examples', () => {
  it('are in step with examples/*.json', () => {
    const onDisk = readText('packages/web/src/examples.generated.ts');
    assert.equal(
      onDisk,
      renderExamplesModule(),
      'examples.generated.ts is stale; run `node scripts/generate-examples-module.mjs`',
    );
  });

  it('validate and reach a report, so the worked-example path cannot ship broken', () => {
    for (const doc of [exampleALadderedFloor, exampleCMinimalBuffer]) {
      const r = validateStructure(JSON.parse(JSON.stringify(doc)));
      assert.ok(r.ok);
      const scenario = DEFAULT_SCENARIO as Scenario;
      const report = buildReport(prepareStructure(r.document, scenario), scenario);
      assert.ok(report.as_of.length === 10);
    }
  });

  it('carry no claim about a real product', () => {
    // D-31: the repository ships synthetic examples only.
    const a = exampleALadderedFloor as { subject?: { issuer?: string }; provenance?: { source?: string } };
    assert.equal(a.provenance?.source, 'hypothetical');
    assert.match(String(a.subject?.issuer), /not a real product/i);
  });
});

describe('the built bundle', () => {
  // dist/ is a build artefact and is not committed, so say so plainly rather
  // than failing with a bare ENOENT on a fresh clone.
  let bundle: string;
  try {
    bundle = readText('packages/web/dist/app.js');
  } catch {
    throw new Error(
      'packages/web/dist/app.js is missing. Run `npm run build -w @first-floor/web` first — ' +
        'these assertions check the built artefact, not the source.',
    );
  }

  it('contains no way for anything to leave the machine', () => {
    // Invariant 7, checked on the artefact rather than the intention. build.mjs
    // fails the build on these too; this is the belt to that pair of braces.
    for (const pattern of [
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\b/,
      /\bEventSource\b/,
      /\bsendBeacon\b/,
      /\bimport\s*\(/,
    ]) {
      assert.ok(!pattern.test(bundle), `bundle contains ${pattern}`);
    }
  });

  it('is an IIFE, so it runs from a folder as well as a server', () => {
    assert.ok(!/^\s*(import|export)\s/m.test(bundle), 'ESM would be blocked over file://');
  });

  it('ships the disclaimer and the limitations copy', () => {
    assert.match(bundle, /not investment advice/i);
    assert.match(bundle, /is an input, not a measurement/i);
  });
});

describe('the built stylesheet', () => {
  let css: string;
  try {
    css = readText('packages/web/dist/styles.css');
  } catch {
    throw new Error(
      'packages/web/dist/styles.css is missing. Run `npm run build -w @first-floor/web` first — ' +
        'the faces are embedded at build time, so the source stylesheet has none of them in it.',
    );
  }

  it('carries both faces itself rather than fetching them', () => {
    // A <link> to a font host would be a network call on every open, and would
    // tell that host who is reading a page whose whole premise is that nobody
    // is told anything (D-22).
    assert.match(css, /@font-face[^}]*font-family:\s*'Arvo'/);
    assert.match(css, /@font-face[^}]*font-family:\s*'Newsreader'/);
    const external = [...css.matchAll(/url\(\s*['"]?([^'")]+)/g)]
      .map((m) => m[1]!)
      .filter((u) => !u.startsWith('data:'));
    assert.deepEqual(external, [], 'the stylesheet must fetch nothing');
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(css));
  });

  it('keeps the form fields monospaced', () => {
    // The one exception to the two house faces: a strike and a level are
    // numbers being checked digit by digit.
    assert.match(css, /--font-mono:\s*ui-monospace/);
    assert.match(css, /input\[type='text'\][^}]*var\(--font-mono\)/);
  });

  it('routes every family through a token, so there is one place to change it', () => {
    for (const token of ['--font-title', '--font-body', '--font-mono']) {
      assert.match(css, new RegExp(`${token}:`), `${token} is not defined`);
    }
    assert.ok(!/ui-sans-serif/.test(css), 'a stray system stack means a rule was missed');
  });
});
