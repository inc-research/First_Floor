// SPDX-License-Identifier: MIT

/**
 * Phase 9c gate: the server speaks MCP over stdio, and every figure it returns
 * matches the one the page would show for the same documents.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
  buildReport,
  prepareStructure,
  validateScenario,
  validateStructure,
  type ColumnMapping,
  type Scenario,
} from '@first-floor/core';
import { renderReport } from '@first-floor/copy';

import { mapCsvTool, reportTool, summariseTool, sweepTool, validateDocumentTool } from '../src/tools.ts';

const ROOT = new URL('../../../', import.meta.url);
const readText = (p: string): string => readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8');
const readJson = (p: string): unknown => JSON.parse(readText(p));

const STRUCTURE = readJson('examples/example_a_laddered_floor.json');
const SCENARIO = readJson('examples/example_scenario.json');
const COMPOSITION = readJson('examples/reference_composition_synthetic.json');
const CSV = readText('examples/holdings_synthetic.csv');
const MAPPING = readJson('examples/mapping_occ_long_form.json') as ColumnMapping;

// ---------------------------------------------------------------- the tools

describe('the tools', () => {
  it('validates each of the three documents', () => {
    assert.equal(validateDocumentTool({ kind: 'collared_structure', document: STRUCTURE }).isError, undefined);
    assert.equal(validateDocumentTool({ kind: 'scenario', document: SCENARIO }).isError, undefined);
    assert.equal(
      validateDocumentTool({ kind: 'reference_composition', document: COMPOSITION }).isError,
      undefined,
    );
  });

  it('refuses an unknown schema version by field, not by exception', () => {
    const bad = { ...(STRUCTURE as object), schema_version: '9.0.0' };
    const r = validateDocumentTool({ kind: 'collared_structure', document: bad });
    assert.equal(r.isError, true);
    assert.match(r.text, /major/);
  });

  it('returns the same report the page renders, byte for byte', () => {
    // One implementation, every surface consuming it (D-13). If these ever
    // differ, the two surfaces have diverged.
    const s = validateStructure(STRUCTURE);
    const sc = validateScenario(SCENARIO);
    assert.ok(s.ok && sc.ok);
    const scenario = sc.document as Scenario;
    const direct = renderReport(
      buildReport(prepareStructure(s.document, scenario), scenario, { composition: null }),
      'plain',
    );
    const viaTool = reportTool({ structure: STRUCTURE, scenario: SCENARIO, voice: 'plain' });
    assert.equal(viaTool.text, direct);
  });

  it('renders both voices', () => {
    const plain = reportTool({ structure: STRUCTURE, scenario: SCENARIO, voice: 'plain' }).text;
    const technical = reportTool({ structure: STRUCTURE, scenario: SCENARIO, voice: 'technical' }).text;
    assert.notEqual(plain, technical);
    assert.match(technical, /Λ|delta cancellation/);
  });

  it('sweeps into a table carrying its assumptions', () => {
    const r = sweepTool({
      structure: STRUCTURE,
      scenario: SCENARIO,
      parameter: 'beta_down',
      values: [1.0, 1.1, 1.2],
      reference_move: -0.4,
    });
    assert.equal(r.isError, undefined);
    // The same three numbers the report leads with, at a −40% reference move.
    assert.match(r.text, /-20\.264%/);
    assert.match(r.text, /-24\.188%/);
    assert.match(r.text, /-28\.112%/);
    assert.match(r.text, /does not consult β_down/, 'the mtm caveat travels with the table');
  });

  it('describes a CSV before it will synthesise from one', () => {
    const survey = mapCsvTool({ csv: CSV, mapping: MAPPING });
    assert.match(survey.text, /11 options/);
    assert.match(survey.text, /Accounts: FUND-A, FUND-B/);
    assert.match(survey.text, /Option roots needing a level: PXY, REF/);
    assert.match(survey.text, /are not guessed at/);
  });

  it('synthesises a valid draft when told the levels', () => {
    const built = mapCsvTool({
      csv: CSV,
      mapping: MAPPING,
      synthesis: {
        as_of: '2026-08-14',
        reference_id: 'REF',
        levels: { REF: 7748.5, PXY: 774.85 },
        ratios: { REF: 1, PXY: 0.1 },
        account: 'FUND-A',
      },
    });
    assert.match(built.text, /Draft structure document \(valid\)/);
    assert.match(built.text, /What was inferred rather than read/);
  });

  it('recognises an issuer export with no mapping supplied', () => {
    // The page and this server have to read a file identically or they have
    // diverged, which is why both call the same recogniser in core (D-41).
    const r = mapCsvTool({
      csv: readText('examples/holdings_ishares_style.csv'),
      filename: 'SYNB_holdings.csv',
    });
    assert.match(r.text, /Recognised as: iShares/);
    assert.match(r.text, /expected column headers/);
    assert.match(r.text, /Ticker from the file name: SYNB/);
    assert.match(r.text, /The file is dated 2026-08-13/);
    assert.match(r.text, /3 options/);
    assert.match(r.text, /Option roots needing a level: REF/);
  });

  it('takes a stated fund size out of a family-wide file', () => {
    const r = mapCsvTool({
      csv: readText('examples/holdings_multi_fund_style.csv'),
      synthesis: { account: 'FUND-A' },
    });
    assert.match(r.text, /Accounts: FUND-A, FUND-B, FUND-C/);
    assert.match(r.text, /Net assets stated by the file: 73216535/);
  });

  it('asks for a mapping rather than guessing at an unrecognised file', () => {
    const r = mapCsvTool({ csv: 'a,b,c\n1,2,3\n' });
    assert.match(r.text, /matches none of the shipped issuer profiles/);
    assert.match(r.text, /nothing is guessed at/i);
  });

  it('summarises which figures a position supports', () => {
    const r = summariseTool({ structure: STRUCTURE, scenario: SCENARIO });
    assert.match(r.text, /terminal_floor: computed/);
    assert.match(r.text, /active_share: not shown/);
  });
});

// ---------------------------------------------------------------- the server

describe('the server over stdio', () => {
  let client: Client | null = null;

  after(async () => {
    await client?.close();
  });

  it('connects, lists its tools and answers a call', async () => {
    client = new Client({ name: 'first-floor-test', version: '0.2.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL('../src/server.ts', import.meta.url))],
        stderr: 'pipe',
      }),
    );

    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ['map_holdings_csv', 'report', 'summarise', 'sweep', 'validate_document'],
    );

    const result = await client.callTool({
      name: 'sweep',
      arguments: {
        structure: STRUCTURE,
        scenario: SCENARIO,
        parameter: 'beta_down',
        values: [1.0, 1.2],
        reference_move: -0.4,
      },
    });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    assert.match(text, /-20\.264%/);
    assert.match(text, /-28\.112%/);
  });

  it('reports an invalid document as an error rather than throwing', async () => {
    assert.ok(client);
    const result = await client!.callTool({
      name: 'validate_document',
      arguments: { kind: 'collared_structure', document: { schema_version: '0.2.0' } },
    });
    assert.equal(result.isError, true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    assert.match(text, /Not a valid collared structure/);
  });
});
