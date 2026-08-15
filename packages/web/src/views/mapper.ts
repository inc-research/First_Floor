// SPDX-License-Identifier: MIT

import {
  applyMapping,
  parseCsv,
  synthesiseStructure,
  type ColumnMapping,
  rootsFor,
  type MappedFile,
  type OptionNameFormat,
} from '@first-floor/core';

import { append, clear, download, el, table } from '../dom.ts';
import { exampleHoldingsCsv, shippedMappings } from '../examples.generated.ts';

export interface MapperHandlers {
  onDraft: (json: string) => void;
  onManual: () => void;
  onCancel: () => void;
}

const FIELDS: [keyof ColumnMapping['columns'], string, string][] = [
  ['identifier', 'Identifier', 'The ticker, OCC symbol or description an option is read from.'],
  ['asset_class', 'Asset class', 'Tells options from shares from cash.'],
  ['quantity', 'Quantity', 'Shares or contracts. A minus sign here becomes a written position.'],
  ['price', 'Price', 'Per share or per contract.'],
  ['market_value', 'Market value', 'Used for weights, and for the fund size when it is not given.'],
  ['name', 'Name', 'A readable name for held shares.'],
  ['sector', 'Sector', 'Optional; used only for display.'],
  ['position', 'Long / short', 'Where a file states direction in words rather than by sign.'],
  ['right', 'Call or put', 'Only for files that break options into their own columns.'],
  ['strike', 'Strike', 'Only for files that break options into their own columns.'],
  ['expiry', 'Expiry', 'Only for files that break options into their own columns.'],
  ['multiplier', 'Multiplier', 'Contract size. Assumed to be 100 when absent.'],
];

const FORMATS: [OptionNameFormat, string][] = [
  ['occ21', 'OCC 21-character symbol — SPY␣␣␣270331P00584000'],
  ['spaced', 'Written description — SPY Mar 31 2027 584 Put'],
  ['dashed', 'Delimiter separated — SPY-20270331-584-P'],
  ['explicit_columns', 'The file already has right, strike and expiry in columns'],
];

/**
 * The in-browser column mapper.
 *
 * One generic adapter and a mapping the user saves, never one adapter per
 * issuer (D-17). Formats drift, and each drift would otherwise arrive as a bug
 * report against code that somebody has to ship. Here it is a file the user
 * edits once and can send to the next person with the same broker.
 *
 * A file this cannot read falls through to typing the numbers by hand, not to
 * an error — being unable to parse someone's export is a normal Tuesday, and it
 * should not be the end of the road.
 */
export function mapperView(h: MapperHandlers): HTMLElement {
  const root = el('div', {});

  let csv = '';
  let mapping: ColumnMapping = blankMapping();
  let mapped: MappedFile | null = null;
  let account: string | null = null;
  const levels: Record<string, number> = {};
  const ratios: Record<string, number> = {};
  let referenceId = '';
  let referenceChosenByUser = false;

  const columnsPanel = el('div', {});
  const previewPanel = el('div', {});
  const resultPanel = el('div', {});

  append(root, [
    el('h2', {}, 'Read a holdings file'),
    el('p', { class: 'lede' },
      'Any CSV. Tell the page which column is which, once, and save that as a small file you can ' +
      'reuse or pass on. The file itself is read here in the browser and goes nowhere.'),
  ]);

  // ---------------------------------------------------------------- the file
  const fileInput = el('input', { type: 'file' }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      csv = String(reader.result ?? '');
      autoDetect();
      refresh();
    };
    reader.readAsText(file);
  });

  append(root, [
    el('div', { class: 'field' },
      el('label', {}, 'Choose a CSV'),
      fileInput,
      el('div', { class: 'hint' }, 'Nothing is uploaded. There is no server to upload it to.'),
    ),
    el('div', { class: 'row' },
      el('button', {
        onclick: () => {
          csv = exampleHoldingsCsv;
          autoDetect();
          refresh();
        },
      }, 'Use the worked example file'),
      el('button', { onclick: h.onCancel }, 'Back'),
    ),
  ]);

  // ---------------------------------------------------------------- mapping
  append(root, [columnsPanel, previewPanel, resultPanel]);

  /**
   * Try each shipped mapping and keep the one that reads the most rows.
   *
   * Chosen by result rather than by guessing at the format from the header
   * names: whether a mapping works is observable, and a mapping that reads
   * nothing is obviously wrong in a way a heuristic about column titles is not.
   */
  function autoDetect(): void {
    let best: { mapping: ColumnMapping; score: number } | null = null;
    for (const candidate of shippedMappings) {
      try {
        const attempt = applyMapping(csv, candidate as unknown as ColumnMapping);
        const score = attempt.counts.option * 2 + attempt.counts.equity - attempt.counts.unreadable * 3;
        if (!best || score > best.score) {
          best = { mapping: structuredClone(candidate) as unknown as ColumnMapping, score };
        }
      } catch {
        // A mapping that throws on this file is simply not the one.
      }
    }
    if (best && best.score > 0) mapping = best.mapping;
    else mapping.header_row = parseCsv(csv).headerRow;
    remap();
  }

  function remap(): void {
    try {
      mapped = applyMapping(csv, mapping);
    } catch {
      mapped = null;
      return;
    }
    if (!referenceChosenByUser || !mapped.roots.includes(referenceId)) {
      referenceId = guessReference(mapped, account);
    }
    if (account !== null && !mapped.accounts.includes(account)) account = null;
  }

  function refresh(): void {
    clear(columnsPanel);
    clear(previewPanel);
    clear(resultPanel);
    if (csv === '') return;

    const headers = mapped?.table.headers ?? parseCsv(csv).headers;

    // --- which column is which ---------------------------------------------
    append(columnsPanel, [
      el('h3', {}, 'Which column is which'),
      el('div', { class: 'field' },
        el('label', {}, 'How options are written'),
        select(
          FORMATS.map(([v, l]) => [v, l]),
          mapping.option_name_format,
          (v) => {
            mapping.option_name_format = v as OptionNameFormat;
            remap();
            refresh();
          },
        ),
      ),
      el('div', { class: 'field' },
        el('label', {}, 'Header row'),
        numberInput(String(mapping.header_row ?? 0), (v) => {
          mapping.header_row = Number(v);
          remap();
          refresh();
        }),
        el('div', { class: 'hint' }, 'Counting from nought. Issuer exports often carry a title first.'),
      ),
      el('div', { class: 'field' },
        el('label', {}, 'Account column'),
        select(
          [['', '— none —'], ...headers.map((h2) => [h2, h2] as [string, string])],
          mapping.account_column ?? '',
          (v) => {
            if (v) mapping.account_column = v;
            else delete mapping.account_column;
            remap();
            refresh();
          },
        ),
      ),
    ]);

    for (const [key, label, hint] of FIELDS) {
      append(columnsPanel, [
        el('div', { class: 'field' },
          el('label', {}, label),
          select(
            [['', '— not in this file —'], ...headers.map((h2) => [h2, h2] as [string, string])],
            mapping.columns[key] ?? '',
            (v) => {
              if (v) mapping.columns[key] = v;
              else delete mapping.columns[key];
              remap();
              refresh();
            },
          ),
          el('div', { class: 'hint' }, hint),
        ),
      ]);
    }

    if (!mapped) {
      append(previewPanel, [fallback('That mapping cannot read this file at all.')]);
      return;
    }

    // --- what it read -------------------------------------------------------
    const c = mapped.counts;
    append(previewPanel, [
      el('h3', {}, 'What that reads'),
      table(['', ''], [
        ['Option positions', String(c.option)],
        ['Holdings', String(c.equity)],
        ['Cash rows', String(c.cash)],
        ['Rows it could not read', String(c.unreadable)],
      ]),
    ]);

    if (c.option === 0) {
      append(previewPanel, [fallback('No option positions were found with this mapping.')]);
      return;
    }

    if (c.unreadable > 0) {
      append(previewPanel, [
        el('div', { class: 'blocked' },
          el('strong', {}, `${c.unreadable} rows were left out`),
          el('ul', {},
            ...mapped.rows.filter((r) => r.kind === 'unreadable').slice(0, 6)
              .map((r) => el('li', {}, r.note ?? 'Unreadable row.')),
          ),
          el('p', { class: 'small' }, 'Nothing was guessed at. Change the mapping above if these matter.'),
        ),
      ]);
    }

    const sample = mapped.rows.filter((r) => r.option).slice(0, 8).map((r) => {
      const o = r.option!;
      return [o.root, `${o.position} ${o.right}`, String(o.strike), o.expiry, String(o.contracts),
        o.markPerUnit === null ? '—' : o.markPerUnit.toFixed(2)];
    });
    append(previewPanel, [
      el('h3', {}, 'The contracts it found'),
      table(['Root', 'Position', 'Strike', 'Expiry', 'Contracts', 'Price'], sample),
    ]);

    // Only the roots the chosen account actually uses. A fund complex's export
    // carries dozens across dozens of structures, and demanding a level for
    // every one of them buries the handful that matter.
    const activeRoots = rootsFor(mapped, account);

    // --- account picker -----------------------------------------------------
    if (mapped.accounts.length > 1) {
      append(resultPanel, [
        el('h3', {}, 'Which account'),
        el('div', { class: 'field' },
          select(
            [['', '— all of them together —'], ...mapped.accounts.map((a) => [a, a] as [string, string])],
            account ?? '',
            (v) => {
              account = v === '' ? null : v;
              remap();
              refresh();
            },
          ),
          el('div', { class: 'hint' },
            'This file holds more than one account. Mixing them would describe a portfolio nobody owns.'),
        ),
      ]);
    }

    // --- levels -------------------------------------------------------------
    append(resultPanel, [
      el('h3', {}, 'What the underlyings are worth'),
      el('p', { class: 'small' },
        'Today’s price of each thing the contracts are written on — 6800 for an index, 630 for an ' +
        'ETF. A holdings file records what is owned, not where the underlying is trading, so this ' +
        'is the one thing that has to be typed. A strike of 5800 says nothing until it can be set ' +
        'against a level.'),
    ]);

    // Asked first, because every ratio below is quoted against it. The default
    // is simply the first root found, which is arbitrary — a file naming a
    // proxy before the index would otherwise invite the ratios to be entered
    // upside down.
    if (activeRoots.length > 1) {
      append(resultPanel, [
        el('div', { class: 'field' },
          el('label', {}, 'Which one is the index'),
          select(activeRoots.map((r) => [r, r] as [string, string]), referenceId, (v) => {
            referenceId = v;
            referenceChosenByUser = true;
            refresh();
          }),
          el('div', { class: 'hint' },
            'The one the structure is collared against. The other is a proxy, and its size relative ' +
            'to this is asked for below.'),
        ),
      ]);
    }

    for (const rootName of activeRoots) {
      append(resultPanel, [
        el('div', { class: 'field' },
          el('label', {}, `${rootName} level today`),
          numberInput(levels[rootName] === undefined ? '' : String(levels[rootName]), (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) levels[rootName] = n;
            else delete levels[rootName];
            refresh();
          }),
          el('div', { class: 'hint' },
            rootName === referenceId
              ? 'The index this structure is collared against.'
              : 'If this is a proxy, give its size relative to the index below.'),
        ),
        rootName === referenceId
          ? el('span', {})
          : el('div', { class: 'field' },
              el('label', {}, `${rootName} size relative to ${referenceId || 'the index'}`),
              numberInput(ratios[rootName] === undefined ? '' : String(ratios[rootName]), (v) => {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) ratios[rootName] = n;
                else delete ratios[rootName];
              }),
              el('div', { class: 'hint' },
                'A tenth-scale proxy is 0.1. Getting this wrong puts every strike ten times out.'),
            ),
      ]);
    }

    const asOf = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) }) as HTMLInputElement;
    append(resultPanel, [
      el('div', { class: 'field' },
        el('label', {}, 'Position dated'),
        asOf,
        el('div', { class: 'hint' }, 'The date this file describes. It appears on every page of the report.'),
      ),
    ]);

    const problem = el('p', { class: 'small' });
    problem.style.color = 'var(--warn)';

    append(resultPanel, [
      problem,
      el('div', { class: 'row' },
        el('button', {
          class: 'primary',
          onclick: () => {
            const missing = activeRoots.filter((r) => levels[r] === undefined);
            if (missing.length > 0) {
              problem.textContent =
                `Still need today’s price for ${missing.join(', ')} — the level each contract is ` +
                'written on, such as 6800 for an index or 630 for an ETF. A holdings file records ' +
                'what is owned, not where the underlying is trading, so a strike cannot be placed ' +
                'without it.';
              return;
            }
            problem.textContent = '';
            const built = synthesiseStructure(mapped!, {
              as_of: asOf.value,
              reference_id: referenceId,
              levels,
              ratios: { ...ratios, [referenceId]: 1 },
              account,
              label: `Mapped from a holdings file${account ? ` — ${account}` : ''}`,
            });
            h.onDraft(JSON.stringify(built.document, null, 2));
          },
        }, 'Build the structure document'),
        el('button', {
          onclick: () => download('column-mapping.json', JSON.stringify(mapping, null, 2)),
        }, 'Save this mapping'),
      ),
      el('p', { class: 'small faint' },
        'The saved mapping is a small file describing this export’s columns. Keep it for next quarter, ' +
        'or give it to anyone else using the same broker.'),
    ]);
  }

  function fallback(message: string): HTMLElement {
    return el('div', { class: 'blocked' },
      el('strong', {}, message),
      el('p', { class: 'small' },
        'Adjust the mapping above, or type the numbers from the fact sheet instead — six figures are ' +
        'enough for a single-period buffer or floor.'),
      el('button', { onclick: h.onManual }, 'Type the numbers instead'),
    );
  }

  return root;
}

/**
 * Which root is most likely the index everything else is quoted against.
 *
 * The root carrying the largest strikes. A proxy exists to be a fraction of the
 * index — a tenth-scale ETF has strikes a tenth the size — so the biggest
 * strikes belong to the thing the others are measured in.
 *
 * Taking the first root alphabetically, which is what this did first, invites
 * exactly the mistake the ratio field exists to prevent: a file listing PXY
 * before REF would offer "PXY level today — the index this structure is
 * collared against", and someone who typed 774.85 there would get a report that
 * was wrong throughout and looked fine. A default that is usually right is
 * worth more here than a default that is arbitrary, and the picker is directly
 * above either way.
 */
function guessReference(file: MappedFile, account: string | null): string {
  let best = file.roots[0] ?? '';
  let bestStrike = -Infinity;
  for (const root of file.roots) {
    const strikes = file.rows
      .filter((r) => r.option?.root === root && (account === null || r.account === account))
      .map((r) => r.option!.strike);
    if (strikes.length === 0) continue;
    // The largest strike, not the typical one. A file mixing two accounts holds
    // two structures on differently scaled underlyings, and a median over the
    // lot is dominated by whichever account has more rows rather than by which
    // underlying is the larger scale.
    const largest = Math.max(...strikes);
    if (largest > bestStrike) {
      bestStrike = largest;
      best = root;
    }
  }
  return best;
}

function blankMapping(): ColumnMapping {
  return {
    schema_version: '0.2.0',
    name: 'Untitled mapping',
    option_name_format: 'occ21',
    header_row: 0,
    columns: {},
  };
}

function select(
  options: [string, string][],
  current: string,
  onchange: (value: string) => void,
): HTMLElement {
  const node = el('select', {}) as HTMLSelectElement;
  for (const [value, label] of options) {
    const option = el('option', { value }, label) as HTMLOptionElement;
    if (value === current) option.setAttribute('selected', 'selected');
    node.appendChild(option);
  }
  node.value = current;
  node.addEventListener('change', () => onchange(node.value));
  return node;
}

function numberInput(value: string, oninput: (value: string) => void): HTMLElement {
  const node = el('input', { type: 'number', step: 'any', value }) as HTMLInputElement;
  node.addEventListener('change', () => oninput(node.value));
  return node;
}
