// SPDX-License-Identifier: MIT

import { append, el } from '../dom.ts';
import type { CollaredStructure } from '@first-floor/core';

export interface ManualHandlers {
  onDraft: (json: string) => void;
  onCancel: () => void;
}

export interface FactSheetInputs {
  levelToday: number;
  levelAtInception: number;
  coverPct: number;
  coverKind: 'buffer' | 'floor';
  capPct: number;
  periodEnd: string;
  netAssets: number;
  asOf: string;
}

/**
 * Rebuild a defined-outcome structure from what a fact sheet prints.
 *
 * A single-period buffer or floor is four contracts, and every one of them is
 * implied by figures the fact sheet already gives. The synthetic long call
 * struck near zero supplies the index exposure; the long put sets where cover
 * begins; a short put below it ends that cover for a buffer; the short call is
 * the cap.
 *
 * Strikes are set against the level at the *start* of the outcome period, which
 * is what the published percentages are measured from. Setting them against
 * today's level instead is the single most common way to get this wrong, and it
 * silently moves every figure in the report.
 */
export function structureFromFactSheet(f: FactSheetInputs): CollaredStructure {
  const inception = f.levelAtInception;
  const contracts = Math.max(1, Math.round(f.netAssets / (inception * 100)));

  const leg = (
    leg_id: string,
    right: 'call' | 'put',
    position: 'long' | 'short',
    strike: number,
    role: 'synthetic_long' | 'buffer_long' | 'buffer_short' | 'cap',
  ) => ({
    leg_id,
    underlying_id: 'REF',
    right,
    position,
    strike: Number(strike.toFixed(4)),
    expiry: f.periodEnd,
    contracts,
    multiplier: 100,
    role,
  });

  const legs = [
    leg('SYN', 'call', 'long', inception * 0.01, 'synthetic_long'),
    // For a buffer the cover starts at the inception level; for a floor the
    // fund absorbs the first slice and cover starts below it.
    leg(
      'COVER_L',
      'put',
      'long',
      f.coverKind === 'buffer' ? inception : inception * (1 - f.coverPct),
      'buffer_long',
    ),
    ...(f.coverKind === 'buffer'
      ? [leg('COVER_S', 'put', 'short', inception * (1 - f.coverPct), 'buffer_short')]
      : []),
    leg('CAP', 'call', 'short', inception * (1 + f.capPct), 'cap'),
  ];

  return {
    schema_version: '0.2.0',
    as_of: f.asOf,
    label: `Typed from a fact sheet — ${(f.coverPct * 100).toFixed(0)}% ${f.coverKind}, ${(f.capPct * 100).toFixed(2)}% cap`,
    reference_id: 'REF',
    underlyings: {
      REF: { level: f.levelToday, level_source: 'user_supplied', ratio_to_reference: 1 },
    },
    held_asset: { kind: 'none', weight: 0 },
    option_legs: legs,
    capital: { net_assets: f.netAssets },
    provenance: {
      source: 'fact_sheet',
      notes:
        'Rebuilt from published figures. Strikes are inferred from the level at the start of the ' +
        'outcome period, not read from a holdings file.',
    },
    advertised: {
      protection_pct: f.coverPct,
      protection_kind: f.coverKind,
      cap_pct: f.capPct,
      outcome_period_end: f.periodEnd,
      source: 'fact sheet, entered by hand',
    },
  };
}

export function manualView(h: ManualHandlers): HTMLElement {
  const root = el('div', {});
  const today = new Date().toISOString().slice(0, 10);

  append(root, [
    el('h2', {}, 'Numbers from a fact sheet'),
    el('p', { class: 'lede' },
      'Six figures are enough to rebuild a single-period buffer or floor. Everything the report ' +
      'shows is worked out from these; nothing is looked up.'),
  ]);

  const fields = {
    levelToday: numberField('Index level today', '109.61', 'Where the index the fund tracks is now.'),
    levelAtInception: numberField(
      'Index level when the outcome period began',
      '93.59',
      'The published buffer and cap are measured from this level, not from today’s. If the fund is ' +
      'part way through its period, the two differ and that difference is most of what this page shows.',
    ),
    coverPct: numberField('Downside cover, as a percentage', '15', 'The buffer or floor the fact sheet states.'),
    capPct: numberField('Cap, as a percentage', '15.82', 'The most the fund can gain over the period.'),
    netAssets: numberField('Fund net assets', '164111128', 'Used to size the contracts against the fund.'),
  };

  const coverKind = el('select', {},
    el('option', { value: 'buffer' }, 'Buffer — the first losses are absorbed, and below that they resume'),
    el('option', { value: 'floor' }, 'Floor — the first losses are taken, and below that they stop'),
  ) as HTMLSelectElement;

  const periodEnd = el('input', { type: 'date', value: '2027-03-19' }) as HTMLInputElement;
  const asOf = el('input', { type: 'date', value: today }) as HTMLInputElement;

  append(root, [
    fields.levelToday.node,
    fields.levelAtInception.node,
    wrap('Which kind of cover', coverKind,
      'A buffer and a floor sound alike and behave in opposite ways below the cover level.'),
    fields.coverPct.node,
    fields.capPct.node,
    wrap('Outcome period ends', periodEnd, 'The date every contract expires.'),
    fields.netAssets.node,
    wrap('Position dated', asOf, 'The date this description is true. It appears on every page of the report.'),
  ]);

  const problem = el('p', { class: 'small' });
  problem.style.color = 'var(--warn)';

  append(root, [
    problem,
    el('div', { class: 'row' },
      el('button', {
        class: 'primary',
        onclick: () => {
          const values = {
            levelToday: fields.levelToday.value(),
            levelAtInception: fields.levelAtInception.value(),
            coverPct: fields.coverPct.value() / 100,
            capPct: fields.capPct.value() / 100,
            netAssets: fields.netAssets.value(),
          };
          const bad = Object.entries(values).find(([, v]) => !Number.isFinite(v) || v <= 0);
          if (bad) {
            problem.textContent = `“${bad[0]}” needs a positive number before anything can be worked out.`;
            return;
          }
          problem.textContent = '';
          h.onDraft(
            JSON.stringify(
              structureFromFactSheet({
                ...values,
                coverKind: coverKind.value as 'buffer' | 'floor',
                periodEnd: periodEnd.value,
                asOf: asOf.value,
              }),
              null,
              2,
            ),
          );
        },
      }, 'Build the structure document'),
      el('button', { onclick: h.onCancel }, 'Back'),
    ),
    el('p', { class: 'small faint' },
      'The next step shows the contracts these figures imply, so you can check them before any ' +
      'number is worked out from them.'),
  ]);

  return root;
}

function numberField(label: string, placeholder: string, hint: string) {
  const input = el('input', { type: 'number', step: 'any', placeholder }) as HTMLInputElement;
  return { node: wrap(label, input, hint), value: () => Number(input.value) };
}

function wrap(label: string, input: HTMLElement, hint: string): HTMLElement {
  return el('div', { class: 'field' },
    el('label', {}, label),
    input,
    el('div', { class: 'hint' }, hint),
  );
}
