// SPDX-License-Identifier: MIT

/**
 * The tool implementations, kept apart from the transport so they can be tested
 * without one.
 *
 * Everything here is a thin call into `@first-floor/core` and `@first-floor/copy`.
 * There is deliberately no arithmetic in this package: one implementation, and
 * every surface consumes it (D-13). If a figure here disagreed with the web
 * page, the two surfaces would already have diverged.
 */

import {
  applyMapping,
  buildReport,
  figures,
  prepareStructure,
  recogniseFormat,
  SHIPPED_MAPPINGS,
  statedNetAssetsFor,
  synthesiseStructure,
  sweep,
  validateReferenceComposition,
  validateScenario,
  validateStructure,
  type ColumnMapping,
  type DocumentKind,
  type ReferenceComposition,
  type Scenario,
  type SweepParameter,
  type SynthesisInput,
} from '@first-floor/core';
import { renderReport, type Voice } from '@first-floor/copy';

export interface ToolResult {
  text: string;
  isError?: boolean;
}

const ok = (text: string): ToolResult => ({ text });
const fail = (text: string): ToolResult => ({ text, isError: true });

/** Validate any of the three documents and say precisely what is wrong. */
export function validateDocumentTool(args: { kind: DocumentKind; document: unknown }): ToolResult {
  const validators = {
    collared_structure: validateStructure,
    scenario: validateScenario,
    reference_composition: validateReferenceComposition,
  } as const;
  const validate = validators[args.kind];
  if (!validate) return fail(`Unknown document kind "${args.kind}".`);

  const result = validate(args.document as never);
  if (result.ok) return ok(`Valid ${args.kind.replace(/_/g, ' ')}.`);
  return fail(
    [`Not a valid ${args.kind.replace(/_/g, ' ')}:`, ...result.problems.map((p) => `  - ${p.message}`)].join('\n'),
  );
}

export interface ReportArgs {
  structure: unknown;
  scenario?: unknown;
  composition?: unknown;
  voice?: Voice;
}

/** The full report, rendered as Markdown in either voice. */
export function reportTool(args: ReportArgs): ToolResult {
  const s = validateStructure(args.structure);
  if (!s.ok) return fail(problems('structure', s.problems));

  const scenarioDoc = args.scenario ?? { schema_version: '0.2.0' };
  const sc = validateScenario(scenarioDoc);
  if (!sc.ok) return fail(problems('scenario', sc.problems));

  let composition: ReferenceComposition | null = null;
  if (args.composition) {
    const rc = validateReferenceComposition(args.composition);
    if (!rc.ok) return fail(problems('reference composition', rc.problems));
    composition = rc.document;
  }

  const scenario = sc.document as Scenario;
  const report = buildReport(prepareStructure(s.document, scenario), scenario, { composition });
  return ok(renderReport(report, args.voice ?? 'plain'));
}

export interface SweepArgs {
  structure: unknown;
  scenario?: unknown;
  parameter: SweepParameter;
  values: number[];
  reference_move?: number;
}

/**
 * A sweep, returned as a table.
 *
 * The same `sweep()` the web page renders as a slider (D-19). Rendering differs
 * between the surfaces; the arithmetic cannot.
 */
export function sweepTool(args: SweepArgs): ToolResult {
  const s = validateStructure(args.structure);
  if (!s.ok) return fail(problems('structure', s.problems));

  const sc = validateScenario(args.scenario ?? { schema_version: '0.2.0' });
  if (!sc.ok) return fail(problems('scenario', sc.problems));

  const scenario = sc.document as Scenario;
  const prepared = prepareStructure(s.document, scenario);
  const result = sweep(prepared, scenario, args.parameter, args.values, {
    ...(args.reference_move !== undefined ? { referenceMove: args.reference_move } : {}),
  });

  const pct = (x: number) => `${(x * 100).toFixed(3)}%`;
  const lines = [
    `Sweeping \`${result.parameter}\`, quoted at a reference move of ` +
      `${pct(result.points[0]?.assumptions.reference_move ?? 0)}.`,
    '',
    `| ${result.parameter} | terminal | mark-to-market | floor | floor attaches at |`,
    '|---|---|---|---|---|',
    ...result.points.map(
      (p) =>
        `| ${p.value} | ${pct(p.terminal)} | ${pct(p.mtm)} | ${pct(p.floor.value)} | ` +
        `${p.floor.flat_below ? pct(p.floor.at_reference_move) : 'no level floor'} |`,
    ),
    '',
    'Assumptions at each point:',
    ...result.points.map(
      (p) =>
        `- ${args.parameter} = ${p.value}: β_down ${p.assumptions.beta_down}, β_up ${p.assumptions.beta_up}, ` +
        `vol_beta ${p.assumptions.vol_beta}. Mark-to-market fixes the held-asset response at 1.0 and ` +
        'does not consult β_down.',
    ),
  ];
  return ok(lines.join('\n'));
}

export interface MapCsvArgs {
  csv: string;
  /** Omit to have a shipped issuer profile recognised from the file itself. */
  mapping?: ColumnMapping;
  /** The file's name as downloaded. Helps recognition; never required. */
  filename?: string;
  synthesis?: Partial<SynthesisInput>;
}

/**
 * Apply a column mapping to a holdings CSV.
 *
 * Without a `synthesis` block this reports what the mapping found — accounts,
 * roots, row counts — which is the step someone needs before they can say which
 * account to use and what the underlyings are worth. With one, it returns a
 * draft structure document.
 *
 * Without a `mapping` it recognises the file against the shipped issuer
 * profiles, the same way the page does. The two surfaces read a file
 * identically or they have diverged, which is the whole reason both of them
 * call into core rather than doing this themselves.
 */
export function mapCsvTool(args: MapCsvArgs): ToolResult {
  let mapping = args.mapping;
  let recognised: string[] = [];

  if (!mapping) {
    const hit = recogniseFormat(
      { text: args.csv, ...(args.filename !== undefined ? { filename: args.filename } : {}) },
      SHIPPED_MAPPINGS,
    );
    if (!hit) {
      return fail(
        'No mapping was given and this file matches none of the shipped issuer profiles. Supply a ' +
          '`mapping` describing its columns — nothing is guessed at, because a mapping that reads ' +
          'the wrong column produces a report that looks entirely reasonable and is wrong.',
      );
    }
    mapping = hit.mapping;
    recognised = [
      `Recognised as: ${hit.mapping.name} (${hit.evidence.join('; ')}).`,
      ...(hit.hints.ticker !== undefined ? [`Ticker from the file name: ${hit.hints.ticker}.`] : []),
      ...(hit.hints.as_of !== undefined ? [`The file is dated ${hit.hints.as_of}.`] : []),
      '',
    ];
  }

  let mapped;
  try {
    mapped = applyMapping(args.csv, mapping);
  } catch (e) {
    return fail(`Could not read that CSV with this mapping: ${(e as Error).message}`);
  }

  if (!args.synthesis?.as_of || !args.synthesis.reference_id || !args.synthesis.levels) {
    const unreadable = mapped.rows.filter((r) => r.kind === 'unreadable');
    const stated = statedNetAssetsFor(mapped, args.synthesis?.account ?? null);
    return ok(
      [
        ...recognised,
        `Read ${mapped.table.body.length} rows: ${mapped.counts.option} options, ` +
          `${mapped.counts.equity} holdings, ${mapped.counts.cash} cash, ` +
          `${mapped.counts.unreadable} unreadable.`,
        mapped.accounts.length > 0 ? `Accounts: ${mapped.accounts.join(', ')}` : 'No account column mapped.',
        `Option roots needing a level: ${mapped.roots.join(', ') || 'none'}`,
        ...(stated !== null ? [`Net assets stated by the file: ${stated}`] : []),
        '',
        'Call again with `synthesis` supplying `as_of`, `reference_id` and a `levels` entry for each ' +
          'root to get a draft structure document. Levels are not in a holdings file and are not ' +
          'guessed at.',
        ...(unreadable.length > 0
          ? ['', 'Rows that could not be read:', ...unreadable.slice(0, 10).map((r) => `  - ${r.note}`)]
          : []),
      ].join('\n'),
    );
  }

  const built = synthesiseStructure(mapped, args.synthesis as SynthesisInput);
  const check = validateStructure(built.document);
  return ok(
    [
      ...recognised,
      check.ok
        ? 'Draft structure document (valid):'
        : `Draft structure document — NOT yet valid:\n${check.problems.map((p) => `  - ${p.message}`).join('\n')}`,
      '',
      JSON.stringify(built.document, null, 2),
      ...(built.notes.length > 0 ? ['', 'What was inferred rather than read:', ...built.notes.map((n) => `- ${n}`)] : []),
    ].join('\n'),
  );
}

/** A compact summary of which figures came back and which were blocked. */
export function summariseTool(args: ReportArgs): ToolResult {
  const s = validateStructure(args.structure);
  if (!s.ok) return fail(problems('structure', s.problems));
  const sc = validateScenario(args.scenario ?? { schema_version: '0.2.0' });
  if (!sc.ok) return fail(problems('scenario', sc.problems));

  const scenario = sc.document as Scenario;
  const report = buildReport(prepareStructure(s.document, scenario), scenario);
  const lines = figures(report).map((f) =>
    f.value === null
      ? `- ${f.metric}: not shown — ${f.blockers.map((b) => b.message).join(' ')}`
      : `- ${f.metric}: computed`,
  );
  return ok([`Report for a position dated ${report.as_of}:`, ...lines].join('\n'));
}

function problems(what: string, list: { message: string }[]): string {
  return [`The ${what} is not valid:`, ...list.map((p) => `  - ${p.message}`)].join('\n');
}
