// SPDX-License-Identifier: MIT

/**
 * Recognise which shipped mapping a holdings file was written for.
 *
 * The tension here is with D-17, which refuses per-issuer adapters because
 * format drift then becomes a bug report against code somebody has to ship.
 * Nothing in this file is an adapter. It reads *signatures carried in the
 * mapping data* and picks one; `applyMapping` remains the single path a file
 * travels, and every mapping chosen here is shown to the user prefilled and
 * editable exactly as a hand-built one is (D-33, D-23).
 *
 * The consequence worth stating: supporting another issuer is a JSON file, and
 * a drifted export is an edit to that file. No branch is ever added here.
 */

import { parseCsv } from './csv.ts';
import { applyMapping, type ColumnMapping } from './mapping.ts';

export interface RecogniseInput {
  text: string;
  /** The file's name as downloaded. Helps, but is never required. */
  filename?: string;
}

export interface Recognition {
  /** The profile, with `header_row` set to where the header actually was. */
  mapping: ColumnMapping;
  /** 0 to 1. Above `RECOGNITION_THRESHOLD` the mapping is offered as recognised. */
  confidence: number;
  /** Why, in sentences the page can show. Recognition explains itself. */
  evidence: string[];
  hints: {
    /** Fund ticker, when the file name carries one. */
    ticker?: string;
    /** ISO date the file describes, when it states one. */
    as_of?: string;
  };
}

/**
 * Below this a file is not called recognised.
 *
 * Set by what a wrong answer costs. A missed recognition costs the user the
 * mapping form they would have filled in anyway; a confident wrong one prefills
 * twelve columns with plausible rubbish, and plausible rubbish is the failure
 * this whole codebase is arranged against.
 */
export const RECOGNITION_THRESHOLD = 0.8;

/** How many rows from the top to look through for a header. */
const HEADER_SCAN_ROWS = 25;

/**
 * Pick the best-matching profile, or null.
 *
 * Header cells decide it. The file name only ever adds confidence and supplies
 * the fund's ticker — a file recognised solely by its name would break the
 * moment someone saved it from their browser as `holdings (1).csv`, and a file
 * recognised by its headers survives being renamed, which is the more common
 * accident.
 */
export function recogniseFormat(
  input: RecogniseInput,
  profiles: readonly ColumnMapping[],
): Recognition | null {
  let best: Recognition | null = null;

  for (const profile of profiles) {
    const candidate = assess(input, profile);
    if (candidate === null) continue;
    if (best === null || candidate.confidence > best.confidence) best = candidate;
  }

  return best !== null && best.confidence >= RECOGNITION_THRESHOLD ? best : null;
}

function assess(input: RecogniseInput, profile: ColumnMapping): Recognition | null {
  const signature = profile.match;
  if (signature === undefined || signature.headers.length === 0) return null;

  const rows = parseCsv(input.text, {
    headerRow: 0,
    ...(profile.delimiter !== undefined ? { delimiter: profile.delimiter } : {}),
  }).rows;
  if (rows.length === 0) return null;

  // --- the header row, found rather than assumed -----------------------------
  // `detectHeaderRow` cannot be used here: a banner row padded to the same width
  // as the header beats it on width, and the whole point of a signature is that
  // it knows what the header says.
  const wanted = signature.headers.map(normalise);
  let headerRow = -1;
  let coverage = 0;
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i++) {
    const cells = new Set((rows[i] as string[]).map(normalise));
    const hits = wanted.filter((h) => cells.has(h)).length;
    const share = hits / wanted.length;
    if (share > coverage) {
      coverage = share;
      headerRow = i;
    }
  }
  if (headerRow === -1 || coverage < RECOGNITION_THRESHOLD) return null;

  const evidence = [
    `matched ${Math.round(coverage * wanted.length)} of ${wanted.length} expected column headers`,
  ];

  // Weights are shared out over whatever the signature actually claims, so a
  // profile that declares no file name is not punished for not having one.
  let score = coverage * 0.75;
  let total = 0.75;
  const hints: Recognition['hints'] = {};

  // --- the file name ---------------------------------------------------------
  if (signature.filename !== undefined) {
    total += 0.15;
    const m = input.filename === undefined
      ? null
      : new RegExp(signature.filename, 'i').exec(input.filename);
    if (m) {
      score += 0.15;
      evidence.push('the file name follows this issuer’s pattern');
      const ticker = m.groups?.['ticker'];
      if (ticker) hints.ticker = ticker.toUpperCase();
    }
  }

  // --- markers above the header ----------------------------------------------
  if (signature.preamble !== undefined && signature.preamble.length > 0) {
    total += 0.1;
    const above = rows.slice(0, headerRow).flat().map(normalise).join(' ');
    const found = signature.preamble.filter((p) => above.includes(normalise(p)));
    score += (found.length / signature.preamble.length) * 0.1;
    if (found.length > 0) evidence.push('the preamble above the columns is this issuer’s');
  }

  const mapping: ColumnMapping = { ...structuredClone(profile), header_row: headerRow };

  // --- does it actually read? -------------------------------------------------
  // Chosen by result as well as by appearance, the same standard the mapper's
  // own auto-detect holds itself to. A signature can match a file whose body is
  // something else entirely, and a mapping that reads nothing is obviously wrong
  // in a way a matching header row is not.
  let read;
  try {
    read = applyMapping(input.text, mapping);
  } catch {
    return null;
  }
  if (read.counts.option + read.counts.equity + read.counts.cash === 0) return null;
  if (read.counts.option > 0) {
    evidence.push(
      `read ${read.counts.option} contract${read.counts.option === 1 ? '' : 's'} out of it`,
    );
  }

  // --- the date the file describes -------------------------------------------
  const asOf = statedDate(rows.slice(0, headerRow)) ?? columnDate(read, mapping);
  if (asOf !== null) hints.as_of = asOf;

  return { mapping, confidence: score / total, evidence, hints };
}

/** Lower-case, letters and digits only, so `% of MarketValue` matches `% of Market Value`. */
function normalise(cell: string): string {
  return cell.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A date from a labelled preamble row: `Fund Holdings as of, "Aug 13, 2026"`. */
function statedDate(preamble: string[][]): string | null {
  for (const row of preamble) {
    if (!row.some((c) => /as of|holdings as of/i.test(c))) continue;
    for (const cell of row) {
      const iso = parseLooseDate(cell);
      if (iso !== null) return iso;
    }
  }
  return null;
}

function columnDate(
  read: { rows: { raw: Record<string, string> }[] },
  mapping: ColumnMapping,
): string | null {
  if (mapping.as_of_column === undefined) return null;
  for (const row of read.rows) {
    const iso = parseLooseDate(row.raw[mapping.as_of_column] ?? '');
    if (iso !== null) return iso;
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * ISO, `MM/DD/YYYY` or `Aug 13, 2026`, and nothing else.
 *
 * Deliberately not `new Date(text)`, whose willingness to find a date in almost
 * any string is the reason a holdings file dated 2026 can come out as today.
 */
export function parseLooseDate(raw: string): string | null {
  const text = raw.trim();
  if (text === '') return null;

  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(text);
  if (slash) {
    const year = Number(slash[3]) < 100 ? 2000 + Number(slash[3]) : Number(slash[3]);
    return `${year}-${pad(Number(slash[1]))}-${pad(Number(slash[2]))}`;
  }

  const named = /([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (named) {
    const month = MONTHS[(named[1] as string).slice(0, 3).toLowerCase()];
    if (month !== undefined) return `${named[3]}-${pad(month)}-${pad(Number(named[2]))}`;
  }

  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
