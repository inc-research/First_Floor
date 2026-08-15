// SPDX-License-Identifier: MIT

/**
 * A CSV reader, to RFC 4180 with the concessions real files require.
 *
 * Holdings files are exported by spreadsheet software and by systems written
 * long before it, so this accepts CRLF or LF, quoted fields containing commas
 * and newlines, doubled quotes as escapes, a UTF-8 byte order mark, and ragged
 * rows. It does not accept a delimiter guess — that is a mapping option, so a
 * semicolon-separated European export is a saved setting rather than a bug
 * report (D-17).
 */

export interface CsvTable {
  /** Every row exactly as read, including anything above the header. */
  rows: string[][];
  /** Index of the row treated as headers. */
  headerRow: number;
  headers: string[];
  /** Rows below the header, padded to the header width. */
  body: string[][];
}

export interface CsvOptions {
  delimiter?: string;
  /** Index of the header row. Auto-detected when omitted. */
  headerRow?: number;
}

export function parseCsv(text: string, options: CsvOptions = {}): CsvTable {
  const delimiter = options.delimiter ?? ',';
  const rows = splitRows(stripBom(text), delimiter);
  const headerRow = options.headerRow ?? detectHeaderRow(rows);
  const headers = (rows[headerRow] ?? []).map((h) => h.trim());
  const body = rows
    .slice(headerRow + 1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const padded = r.slice(0, headers.length);
      while (padded.length < headers.length) padded.push('');
      return padded;
    });
  return { rows, headerRow, headers, body };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // Swallow; the \n that follows ends the row.
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Guess which row holds the headers.
 *
 * Issuer exports routinely carry a title, a date and a blank line before the
 * real header. The widest row in the first twenty that contains no number is a
 * reliable marker, because a header row is text all the way across and a data
 * row almost never is.
 */
function detectHeaderRow(rows: string[][]): number {
  let best = 0;
  let bestWidth = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] as string[];
    const cells = row.filter((c) => c.trim() !== '');
    if (cells.length < 2) continue;
    const numeric = cells.filter((c) => Number.isFinite(Number(c.replace(/[$,%\s]/g, ''))));
    if (numeric.length > 0) continue;
    if (cells.length > bestWidth) {
      bestWidth = cells.length;
      best = i;
    }
  }
  return best;
}

/** Parse a number that may carry currency symbols, thousands separators or parentheses. */
export function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '--') return null;
  const negative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[()$£€,\s]/g, '').replace(/%$/, '');
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}
