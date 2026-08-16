// SPDX-License-Identifier: MIT

import type { Right } from '../schema/types.ts';

/**
 * How an option's details are encoded in a holdings file.
 *
 * **These are mapping options, not code branches** (D-17). Writing one adapter
 * per issuer is a maintenance treadmill, because formats drift and every drift
 * becomes a bug report. A user picks the format once in the mapper, saves it,
 * and a new export from the same shop needs no code at all.
 */
export type OptionNameFormat =
  /** The 21-character OCC identifier: `SPY   270331P00584000`. */
  | 'occ21'
  /** Whitespace-separated: `SPY Mar 31 2027 584 Put`. */
  | 'spaced'
  /** Delimiter-separated: `SPY-20270331-584-P`. */
  | 'dashed'
  /** Month-coded, strike after an `@`: `NOV26 IVV US P @ 712.8`. */
  | 'month_at'
  /** The file already has right, strike and expiry in their own columns. */
  | 'explicit_columns';

/**
 * Which day of a month-precision expiry to take.
 *
 * Some descriptions name only a month. The day has to come from somewhere, and
 * the two conventions worth naming are the listed monthly expiry (third Friday)
 * and the end of an outcome period (last business day). Whichever is chosen is
 * an *inference*, and every parse that used one says so.
 */
export type ExpiryDay = 'last_business_day' | 'third_friday';

export interface OptionNameOptions {
  /** Used only by formats that carry a month without a day. */
  expiryDay?: ExpiryDay;
}

export interface ParsedOptionName {
  root: string;
  right: Right;
  strike: number;
  /** ISO date. */
  expiry: string;
  /**
   * True when the day of `expiry` was supplied by convention rather than read.
   * Carried all the way to the review step, because a date that looks measured
   * and is not is exactly the kind of quiet default invariant 3 forbids.
   */
  expiry_inferred?: boolean;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse an option identifier in a named format.
 *
 * Returns null rather than throwing or guessing. A row this cannot read is
 * reported to the user as unmapped, which is the honest outcome: a silently
 * mis-parsed strike produces a report that looks entirely reasonable and is
 * entirely wrong.
 */
export function parseOptionName(
  raw: string,
  format: OptionNameFormat,
  options: OptionNameOptions = {},
): ParsedOptionName | null {
  const text = raw.trim();
  if (text === '') return null;
  switch (format) {
    case 'occ21':
      return parseOcc21(text);
    case 'spaced':
      return parseSpaced(text);
    case 'dashed':
      return parseDashed(text);
    case 'month_at':
      return parseMonthAt(text, options.expiryDay ?? 'third_friday');
    case 'explicit_columns':
      return null;
  }
}

/**
 * The OCC 21-character identifier.
 *
 *   root, 6 characters, space padded   SPY␣␣␣
 *   expiry, YYMMDD                     270331
 *   right, C or P                      P
 *   strike × 1000, 8 digits            00584000
 *
 * The strike's implied three decimal places are the part worth being careful
 * about: `00584000` is 584, not 584000, and reading it as the latter puts every
 * put a thousandfold out of the money without any obvious symptom.
 */
function parseOcc21(text: string): ParsedOptionName | null {
  const compact = text.replace(/\s+/g, ' ');
  const m = /^([A-Za-z0-9.$^]{1,6})\s*(\d{6})([CP])(\d{8})$/.exec(compact.replace(/\s+/g, ''))
    ?? /^(.{6})(\d{6})([CP])(\d{8})$/.exec(text);
  if (!m) return null;
  const [, root, yymmdd, right, strike] = m as unknown as [string, string, string, string, string];
  const expiry = fromYyMmDd(yymmdd);
  if (!expiry) return null;
  return {
    root: root.trim().toUpperCase(),
    right: right === 'C' ? 'call' : 'put',
    strike: Number(strike) / 1000,
    expiry,
  };
}

/**
 * Whitespace-separated, e.g. `SPY Mar 31 2027 584 Put` or `SPX 03/31/2027 584 C`.
 *
 * Tolerant by token role rather than by position, because the ordering varies
 * between exports of the same broker's own software.
 */
function parseSpaced(text: string): ParsedOptionName | null {
  const tokens = text.split(/\s+/).filter((t) => t !== '');
  if (tokens.length < 3) return null;

  const right = findRight(tokens);
  if (!right) return null;

  const expiry = findDate(tokens);
  if (!expiry) return null;

  // The strike is the last bare number that is not part of the date.
  const used = new Set(expiry.tokens);
  let strike: number | null = null;
  for (const t of tokens) {
    if (used.has(t)) continue;
    const n = Number(t.replace(/[$,]/g, ''));
    if (Number.isFinite(n) && n > 0) strike = n;
  }
  if (strike === null) return null;

  return { root: (tokens[0] as string).toUpperCase(), right: right.right, strike, expiry: expiry.iso };
}

/** Delimiter-separated, e.g. `SPY-20270331-584-P` or `SPY_2027-03-31_584_PUT`. */
function parseDashed(text: string): ParsedOptionName | null {
  const parts = text.split(/[-_|/]/).filter((p) => p !== '');
  if (parts.length < 4) return null;

  const root = (parts[0] as string).toUpperCase();
  const right = findRight(parts);
  if (!right) return null;

  let expiry: string | null = null;
  for (const p of parts) {
    if (/^\d{8}$/.test(p)) {
      expiry = `${p.slice(0, 4)}-${p.slice(4, 6)}-${p.slice(6, 8)}`;
      break;
    }
    if (/^\d{6}$/.test(p)) {
      expiry = fromYyMmDd(p);
      break;
    }
  }
  // A rejoined ISO date, from `SPY_2027-03-31_584_PUT` split on its dashes.
  if (!expiry) {
    const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (iso) expiry = `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  if (!expiry) return null;

  let strike: number | null = null;
  for (const p of parts) {
    if (p === right.token) continue;
    const n = Number(p.replace(/[$,]/g, ''));
    if (Number.isFinite(n) && n > 0 && !/^\d{6,8}$/.test(p)) strike = n;
  }
  if (strike === null) return null;

  return { root, right: right.right, strike, expiry };
}

/**
 * Month-coded, strike after an `@`: `NOV26 IVV US P @ 712.8`.
 *
 * Unlike `spaced`, the root is not the first token — the month is — and the
 * description carries **no day**. That missing day is the whole reason this is
 * a separate format rather than a tolerance added to `spaced`: reading `NOV26`
 * as a root and inventing a date silently is precisely the failure mode the
 * other parsers are written to avoid, so the month is read, the day is supplied
 * by the stated convention, and the result is flagged as inferred.
 */
function parseMonthAt(text: string, expiryDay: ExpiryDay): ParsedOptionName | null {
  const tokens = text.split(/\s+/).filter((t) => t !== '');
  if (tokens.length < 4) return null;

  // The month token: three letters of a month name followed by a year.
  let monthIndex = -1;
  let month = 0;
  let year = 0;
  for (let i = 0; i < tokens.length; i++) {
    const m = /^([A-Za-z]{3})[- ]?(\d{2}|\d{4})$/.exec(tokens[i] as string);
    if (!m) continue;
    const n = MONTHS[(m[1] as string).toLowerCase()];
    if (n === undefined) continue;
    const yy = Number(m[2]);
    monthIndex = i;
    month = n;
    year = yy < 100 ? (yy < 70 ? 2000 + yy : 1900 + yy) : yy;
    break;
  }
  if (monthIndex === -1) return null;

  const root = tokens[monthIndex + 1];
  if (root === undefined || !/^[A-Za-z0-9.$^]{1,6}$/.test(root)) return null;

  const right = findRight(tokens.slice(monthIndex + 2));
  if (!right) return null;

  // After the `@` when there is one; otherwise the last bare positive number.
  const at = tokens.indexOf('@');
  const candidates = at === -1 ? tokens.slice(monthIndex + 2) : tokens.slice(at + 1);
  let strike: number | null = null;
  for (const t of candidates) {
    if (t === right.token) continue;
    const n = Number(t.replace(/[$,]/g, ''));
    if (Number.isFinite(n) && n > 0) strike = n;
  }
  if (strike === null) return null;

  return {
    root: root.toUpperCase(),
    right: right.right,
    strike,
    expiry: resolveExpiryDay(year, month, expiryDay),
    expiry_inferred: true,
  };
}

/**
 * Turn a month into a date under a named convention.
 *
 * `third_friday` is the listed monthly expiry. `last_business_day` is where a
 * defined-outcome period ends, which is what a FLEX series written for one
 * follows. Neither is derivable from the file; both are stated choices.
 */
export function resolveExpiryDay(year: number, month: number, rule: ExpiryDay): string {
  if (rule === 'third_friday') {
    const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    // 5 is Friday. Days to the first Friday, then two weeks on.
    const day = 1 + ((5 - firstDow + 7) % 7) + 14;
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  // Last calendar day, walked back off a weekend.
  const last = new Date(Date.UTC(year, month, 0));
  while (last.getUTCDay() === 0 || last.getUTCDay() === 6) {
    last.setUTCDate(last.getUTCDate() - 1);
  }
  return `${last.getUTCFullYear()}-${pad(last.getUTCMonth() + 1)}-${pad(last.getUTCDate())}`;
}

function findRight(tokens: string[]): { right: Right; token: string } | null {
  for (const t of tokens) {
    const lower = t.toLowerCase().replace(/[^a-z]/g, '');
    if (lower === 'c' || lower === 'call' || lower === 'calls') return { right: 'call', token: t };
    if (lower === 'p' || lower === 'put' || lower === 'puts') return { right: 'put', token: t };
  }
  return null;
}

function findDate(tokens: string[]): { iso: string; tokens: string[] } | null {
  // ISO, anywhere.
  for (const t of tokens) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (iso) return { iso: t, tokens: [t] };
  }
  // Slash-separated, month first.
  for (const t of tokens) {
    const s = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
    if (s) {
      const year = Number(s[3]) < 100 ? 2000 + Number(s[3]) : Number(s[3]);
      return { iso: `${year}-${pad(Number(s[1]))}-${pad(Number(s[2]))}`, tokens: [t] };
    }
  }
  // Month name, day, year as three tokens.
  for (let i = 0; i < tokens.length; i++) {
    const month = MONTHS[(tokens[i] as string).slice(0, 3).toLowerCase()];
    if (month === undefined) continue;
    const day = Number(tokens[i + 1]);
    const year = Number(tokens[i + 2]);
    if (!Number.isInteger(day) || !Number.isInteger(year)) continue;
    const full = year < 100 ? 2000 + year : year;
    return {
      iso: `${full}-${pad(month)}-${pad(day)}`,
      tokens: [tokens[i] as string, tokens[i + 1] as string, tokens[i + 2] as string],
    };
  }
  return null;
}

/**
 * OCC dates carry a two-digit year. Anything below 70 is this century — a
 * convention rather than a fact, but option expiries do not run to 2070.
 */
function fromYyMmDd(yymmdd: string): string | null {
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy < 70 ? 2000 + yy : 1900 + yy}-${pad(mm)}-${pad(dd)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
