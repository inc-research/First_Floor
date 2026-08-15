// SPDX-License-Identifier: MIT

import { parseCsv, parseNumber, type CsvTable } from './csv.ts';
import { parseOptionName, type OptionNameFormat } from './optionNames.ts';
import type { CollaredStructure, Constituent, OptionLeg, Underlying } from '../schema/types.ts';

/**
 * A saved column mapping.
 *
 * The whole point of this file is that it is *data* the user can keep, reuse
 * and pass to someone else with the same broker (D-17). One generic adapter
 * plus a mapping beats one adapter per issuer, because formats drift and each
 * drift would otherwise become a bug report against code.
 */
export interface ColumnMapping {
  schema_version: string;
  name: string;
  delimiter?: string;
  header_row?: number;
  /** Column whose value separates one account from another, if the file mixes them. */
  account_column?: string;
  option_name_format: OptionNameFormat;
  columns: {
    /** Ticker, OCC identifier or description. */
    identifier?: string;
    /** Human-readable name, for held equities. */
    name?: string;
    /** Shares or contracts. May be signed. */
    quantity?: string;
    market_value?: string;
    price?: string;
    /** Used to tell options from shares from cash. */
    asset_class?: string;
    /** Present when the file already breaks options out into columns. */
    right?: string;
    strike?: string;
    expiry?: string;
    multiplier?: string;
    position?: string;
    sector?: string;
  };
  /** Values of the asset-class column that mean "this row is an option". */
  option_markers?: string[];
  /** Values that mean "this row is cash". */
  cash_markers?: string[];
}

export type RowKind = 'option' | 'equity' | 'cash' | 'unreadable';

/**
 * The option roots actually used by one account.
 *
 * A file holding a whole fund complex carries dozens of roots across dozens of
 * structures, and only the handful belonging to the structure under review need
 * an underlying level. Asking for the rest is asking for work that changes
 * nothing, and it hides the roots that do matter in a list nobody will read.
 */
export function rootsFor(file: MappedFile, account: string | null): string[] {
  return [
    ...new Set(
      file.rows
        .filter((r) => r.option && (account === null || r.account === account))
        .map((r) => r.option!.root),
    ),
  ].sort();
}

export interface MappedRow {
  kind: RowKind;
  account: string | null;
  raw: Record<string, string>;
  /** Why the row could not be read, when kind is `unreadable`. */
  note?: string;
  option?: {
    root: string;
    right: 'call' | 'put';
    strike: number;
    expiry: string;
    contracts: number;
    position: 'long' | 'short';
    multiplier: number;
    markPerUnit: number | null;
  };
  holding?: { name: string; marketValue: number; sector?: string };
  cash?: { marketValue: number };
}

export interface MappedFile {
  table: CsvTable;
  rows: MappedRow[];
  accounts: string[];
  /** Every distinct option root in the file, across all accounts. */
  roots: string[];
  counts: Record<RowKind, number>;
}

/** Apply a mapping to CSV text. Pure; reads nothing and fetches nothing. */
export function applyMapping(text: string, mapping: ColumnMapping): MappedFile {
  const table = parseCsv(text, {
    ...(mapping.delimiter !== undefined ? { delimiter: mapping.delimiter } : {}),
    ...(mapping.header_row !== undefined ? { headerRow: mapping.header_row } : {}),
  });

  const index = new Map(table.headers.map((h, i) => [h, i]));
  const get = (row: string[], column: string | undefined): string | undefined =>
    column === undefined ? undefined : row[index.get(column) ?? -1];

  const rows = table.body.map((row): MappedRow => {
    const raw = Object.fromEntries(table.headers.map((h, i) => [h, row[i] ?? '']));
    const account = get(row, mapping.account_column)?.trim() ?? null;
    const assetClass = (get(row, mapping.columns.asset_class) ?? '').trim().toLowerCase();
    const identifier = (get(row, mapping.columns.identifier) ?? '').trim();
    const quantity = parseNumber(get(row, mapping.columns.quantity));
    const marketValue = parseNumber(get(row, mapping.columns.market_value));

    const isCash = (mapping.cash_markers ?? ['cash', 'cash & equivalents', 'money market'])
      .some((m) => assetClass.includes(m.toLowerCase()) || identifier.toLowerCase() === m.toLowerCase());
    if (isCash) {
      return { kind: 'cash', account, raw, cash: { marketValue: marketValue ?? 0 } };
    }

    const optionMarkers = mapping.option_markers ?? ['option', 'call', 'put', 'derivative'];
    const looksLikeOption =
      mapping.columns.right !== undefined ||
      optionMarkers.some((m) => assetClass.includes(m.toLowerCase())) ||
      (mapping.option_name_format !== 'explicit_columns' &&
        parseOptionName(identifier, mapping.option_name_format) !== null);

    if (looksLikeOption) {
      const parsed = readOption(row, get, mapping, identifier, quantity);
      if (!parsed) {
        return { kind: 'unreadable', account, raw, note: `Could not read an option from "${identifier}".` };
      }
      const price = parseNumber(get(row, mapping.columns.price));
      const multiplier = parseNumber(get(row, mapping.columns.multiplier)) ?? 100;
      // A mark may be given per unit or as a market value for the whole leg.
      const markPerUnit =
        price ?? (marketValue !== null && quantity ? Math.abs(marketValue / (quantity * multiplier)) : null);
      return {
        kind: 'option',
        account,
        raw,
        option: { ...parsed, multiplier, markPerUnit },
      };
    }

    if (identifier === '' && marketValue === null) {
      return { kind: 'unreadable', account, raw, note: 'Row has neither an identifier nor a value.' };
    }

    return {
      kind: 'equity',
      account,
      raw,
      holding: {
        name: (get(row, mapping.columns.name) ?? identifier).trim(),
        marketValue: marketValue ?? 0,
        ...(get(row, mapping.columns.sector) ? { sector: (get(row, mapping.columns.sector) as string).trim() } : {}),
      },
    };
  });

  const counts: Record<RowKind, number> = { option: 0, equity: 0, cash: 0, unreadable: 0 };
  for (const r of rows) counts[r.kind]++;

  return {
    table,
    rows,
    accounts: [...new Set(rows.map((r) => r.account).filter((a): a is string => !!a))].sort(),
    roots: [...new Set(rows.filter((r) => r.option).map((r) => r.option!.root))].sort(),
    counts,
  };
}

function readOption(
  row: string[],
  get: (row: string[], column: string | undefined) => string | undefined,
  mapping: ColumnMapping,
  identifier: string,
  quantity: number | null,
): Omit<NonNullable<MappedRow['option']>, 'multiplier' | 'markPerUnit'> | null {
  let root: string;
  let right: 'call' | 'put';
  let strike: number;
  let expiry: string;

  if (mapping.option_name_format === 'explicit_columns') {
    const r = (get(row, mapping.columns.right) ?? '').trim().toLowerCase();
    const s = parseNumber(get(row, mapping.columns.strike));
    const e = (get(row, mapping.columns.expiry) ?? '').trim();
    if (s === null || e === '' || (r[0] !== 'c' && r[0] !== 'p')) return null;
    root = identifier.toUpperCase();
    right = r[0] === 'c' ? 'call' : 'put';
    strike = s;
    expiry = normaliseDate(e);
  } else {
    const parsed = parseOptionName(identifier, mapping.option_name_format);
    if (!parsed) return null;
    ({ root, right, strike, expiry } = parsed);
  }

  // Direction lives in `position`, never in a sign on contracts (spec §0). A
  // file that signs its quantities is read here and normalised immediately.
  const stated = (get(row, mapping.columns.position) ?? '').trim().toLowerCase();
  const position: 'long' | 'short' =
    stated.startsWith('s') || stated.startsWith('w') ? 'short' : stated.startsWith('l') ? 'long'
      : (quantity ?? 0) < 0 ? 'short' : 'long';

  const contracts = Math.abs(quantity ?? 0);
  if (contracts === 0) return null;

  return { root, right, strike, expiry, contracts, position };
}

function normaliseDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(raw);
  if (slash) {
    const year = Number(slash[3]) < 100 ? 2000 + Number(slash[3]) : Number(slash[3]);
    return `${year}-${String(slash[1]).padStart(2, '0')}-${String(slash[2]).padStart(2, '0')}`;
  }
  return raw;
}

export interface SynthesisInput {
  as_of: string;
  /** Level for each option root found in the file. */
  levels: Record<string, number>;
  /** Which root is the reference the structure is collared against. */
  reference_id: string;
  /** Multiply a reference level by this to get each underlying's level. */
  ratios?: Record<string, number>;
  /** Overrides the sum of market values when supplied. */
  net_assets?: number;
  account?: string | null;
  label?: string;
}

export interface SynthesisResult {
  document: CollaredStructure;
  /** What was inferred rather than read, for the review step to show. */
  notes: string[];
}

/**
 * Build a draft structure document from mapped rows.
 *
 * It is a *draft* on purpose. A holdings file records positions, not levels,
 * dividend yields or the risk-free rate, and inventing them would be exactly
 * the silent defaulting invariant 3 forbids. What comes out of here goes to the
 * review step, where the missing pieces are visible and editable before any
 * number is computed (D-23).
 */
export function synthesiseStructure(file: MappedFile, input: SynthesisInput): SynthesisResult {
  const notes: string[] = [];
  const rows = input.account
    ? file.rows.filter((r) => r.account === input.account)
    : file.rows;

  const optionRows = rows.filter((r) => r.option);
  const equityRows = rows.filter((r) => r.holding);
  const cashRows = rows.filter((r) => r.cash);

  const equityValue = equityRows.reduce((a, r) => a + (r.holding?.marketValue ?? 0), 0);
  const cashValue = cashRows.reduce((a, r) => a + (r.cash?.marketValue ?? 0), 0);
  const optionValue = optionRows.reduce((a, r) => {
    const o = r.option!;
    const sign = o.position === 'long' ? 1 : -1;
    return a + sign * o.contracts * o.multiplier * (o.markPerUnit ?? 0);
  }, 0);

  const netAssets = input.net_assets ?? equityValue + cashValue + optionValue;
  if (input.net_assets === undefined) {
    notes.push(
      'Fund size was taken as the sum of the values in the file. If the file lists only part of ' +
      'the portfolio, set it by hand — every notional in the report is divided by this.',
    );
  }

  // Only the roots this account actually uses. A fund complex's file carries
  // dozens, and an underlying nothing points at is noise in the document.
  const underlyings: Record<string, Underlying> = {};
  for (const root of rootsFor(file, input.account ?? null)) {
    const level = input.levels[root];
    if (level === undefined) continue;
    const ratio = input.ratios?.[root] ?? (root === input.reference_id ? 1 : undefined);
    underlyings[root] = {
      level,
      level_source: 'user_supplied',
      ...(ratio !== undefined ? { ratio_to_reference: ratio } : {}),
    };
    if (ratio === undefined) {
      notes.push(
        `${root} has no stated size relative to ${input.reference_id}. Set it in the document below — ` +
        'a contract on a tenth-scale proxy compared against the index itself puts every strike ten ' +
        'times out.',
      );
    }
  }

  const legs: OptionLeg[] = optionRows.map((r, i) => {
    const o = r.option!;
    return {
      leg_id: `L${i + 1}`,
      underlying_id: o.root,
      right: o.right,
      position: o.position,
      strike: o.strike,
      expiry: o.expiry,
      contracts: o.contracts,
      multiplier: o.multiplier,
      ...(o.markPerUnit !== null ? { mark_per_unit: o.markPerUnit } : {}),
    };
  });

  const constituents: Constituent[] = equityRows
    .filter((r) => (r.holding?.marketValue ?? 0) > 0)
    .map((r) => ({
      name: r.holding!.name,
      weight: netAssets > 0 ? r.holding!.marketValue / netAssets : 0,
      ...(r.holding!.sector ? { sector: r.holding!.sector } : {}),
    }));

  const unreadable = rows.filter((r) => r.kind === 'unreadable');
  if (unreadable.length > 0) {
    notes.push(
      `${unreadable.length} row${unreadable.length === 1 ? '' : 's'} could not be read and ${
        unreadable.length === 1 ? 'was' : 'were'
      } left out. Nothing was guessed at.`,
    );
  }
  if (optionRows.some((r) => r.option!.markPerUnit === null)) {
    notes.push(
      'Some contracts came without a price. Their values are modelled rather than measured, and the ' +
      'reconciliation against the fund’s size is left out rather than filled in.',
    );
  }

  return {
    document: {
      schema_version: '0.2.0',
      as_of: input.as_of,
      ...(input.label !== undefined ? { label: input.label } : {}),
      reference_id: input.reference_id,
      underlyings,
      held_asset: {
        kind: constituents.length === 0 ? 'none' : constituents.length <= 2 ? 'single_name' : 'basket',
        weight: netAssets > 0 ? equityValue / netAssets : 0,
        ...(constituents.length > 0 ? { constituents } : {}),
      },
      option_legs: legs,
      capital: {
        net_assets: netAssets,
        ...(netAssets > 0 ? { cash_weight: cashValue / netAssets } : {}),
      },
      provenance: {
        source: 'holdings_file',
        notes: `Mapped from a holdings CSV (${input.account ?? 'all accounts'}).`,
      },
    },
    notes,
  };
}
