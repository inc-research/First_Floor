// SPDX-License-Identifier: MIT

import {
  applyMapping,
  parseCsv,
  recogniseFormat,
  statedNetAssetsFor,
  synthesiseStructure,
  type ColumnMapping,
  type ExpiryDay,
  rootsFor,
  SHIPPED_MAPPINGS,
  type MappedFile,
  type OptionNameFormat,
  type Recognition,
} from '@first-floor/core';

import { append, clear, download, el, table } from '../dom.ts';
import { exampleHoldingsCsv } from '../examples.generated.ts';

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
  ['month_at', 'Month coded, strike after an @ — NOV26 SPY US P @ 712.8'],
  ['explicit_columns', 'The file already has right, strike and expiry in columns'],
];

const EXPIRY_DAYS: [ExpiryDay, string][] = [
  ['last_business_day', 'The last business day of that month'],
  ['third_friday', 'The third Friday — the listed monthly expiry'],
];

/** Where a holdings file comes from, and the one thing not to do to it. */
const SOURCING_NOTE =
  'Take the holdings file from the issuer’s own fund page — every one of them publishes a daily CSV ' +
  'of what the fund holds — and choose it here as it downloaded. Do not rename it: the name is part ' +
  'of how the format is recognised, and a renamed file falls back to mapping the columns by hand.';

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
  let filename = '';
  let mapping: ColumnMapping = blankMapping();
  let mapped: MappedFile | null = null;
  let recognised: Recognition | null = null;
  /** The column form is folded away once a file is recognised; nothing is hidden for good. */
  let showColumns = true;
  let account: string | null = null;
  let accountFilter = '';
  const levels: Record<string, number> = {};
  const ratios: Record<string, number> = {};
  let referenceId = '';
  let referenceChosenByUser = false;

  // Prefilled from the file, then left alone once the user has had an opinion.
  let navValue = '';
  let navEdited = false;
  let asOfValue = new Date().toISOString().slice(0, 10);
  let asOfEdited = false;

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
      filename = file.name;
      detect();
      refresh();
    };
    reader.readAsText(file);
  });

  append(root, [
    el('div', { class: 'field' },
      el('label', {}, 'Choose a CSV'),
      fileInput,
      el('div', { class: 'hint' }, 'Nothing is uploaded. There is no server to upload it to.'),
      el('div', { class: 'hint' }, SOURCING_NOTE),
    ),
    el('div', { class: 'row' },
      el('button', {
        onclick: () => {
          csv = exampleHoldingsCsv;
          filename = 'holdings_synthetic.csv';
          detect();
          refresh();
        },
      }, 'Use the worked example file'),
      el('button', { onclick: h.onCancel }, 'Back'),
    ),
  ]);

  // ---------------------------------------------------------------- mapping
  append(root, [columnsPanel, previewPanel, resultPanel]);

  /**
   * Recognise the file if one of the shipped profiles claims it; otherwise fall
   * back to scoring every mapping against it.
   *
   * The recognised path exists because the alternative — twelve dropdowns and a
   * header-row counter — is the step at which someone with a perfectly ordinary
   * issuer download gives up. It changes nothing about what happens next: the
   * mapping is filled in, shown, and editable, and the structure document is
   * still reviewed before a number is computed (D-23).
   */
  function detect(): void {
    recognised = null;
    account = null;
    accountFilter = '';
    referenceChosenByUser = false;
    navEdited = false;
    asOfEdited = false;

    try {
      recognised = recogniseFormat(
        { text: csv, ...(filename !== '' ? { filename } : {}) },
        SHIPPED_MAPPINGS,
      );
    } catch {
      // A profile that throws on this file is simply not the one.
      recognised = null;
    }

    if (recognised) {
      mapping = recognised.mapping;
      showColumns = false;
      if (recognised.hints.as_of !== undefined) asOfValue = recognised.hints.as_of;
      remap();
      return;
    }

    showColumns = true;
    autoDetect();
  }

  /**
   * Try each shipped mapping and keep the one that reads the most rows.
   *
   * Chosen by result rather than by guessing at the format from the header
   * names: whether a mapping works is observable, and a mapping that reads
   * nothing is obviously wrong in a way a heuristic about column titles is not.
   */
  function autoDetect(): void {
    let best: { mapping: ColumnMapping; score: number } | null = null;
    for (const candidate of SHIPPED_MAPPINGS) {
      try {
        const attempt = applyMapping(csv, candidate);
        const score = attempt.counts.option * 2 + attempt.counts.equity - attempt.counts.unreadable * 3;
        if (!best || score > best.score) {
          best = { mapping: structuredClone(candidate), score };
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
    if (!navEdited) navValue = prefilledNav(mapped, account);
  }

  /**
   * The fund size, taken from the file where the file says it.
   *
   * A stated figure beats a derived one: adding up the rows misses anything the
   * export leaves out, and a file that carries a net-assets column is telling
   * you the answer. Both are only ever a prefill — the field below is editable
   * and every notional in the report is divided by whatever is in it.
   */
  function prefilledNav(file: MappedFile, chosen: string | null): string {
    const stated = statedNetAssetsFor(file, chosen);
    if (stated !== null) return String(Number(stated.toFixed(2)));
    const derived = derivedNavOf(file, chosen);
    return derived > 0 ? String(Number(derived.toFixed(2))) : '';
  }

  function refresh(): void {
    clear(columnsPanel);
    clear(previewPanel);
    clear(resultPanel);
    if (csv === '') return;

    const headers = mapped?.table.headers ?? parseCsv(csv).headers;
    const columnOptions = (blank: string): [string, string][] =>
      [['', blank], ...headers.map((h2) => [h2, h2] as [string, string])];

    if (recognised && mapped) append(columnsPanel, [banner(recognised, mapped)]);

    // --- which column is which ---------------------------------------------
    // Folded away when the file was recognised: the answers are already right,
    // and twelve filled-in dropdowns between someone and the two questions that
    // still need them is the step this whole feature exists to remove. One
    // button away, never further.
    if (!showColumns) {
      append(columnsPanel, [
        el('div', { class: 'row' },
          el('button', { onclick: () => { showColumns = true; refresh(); } }, 'Adjust the mapping'),
        ),
      ]);
    } else {
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
        // Only where it changes an answer: a format naming a month and no day
        // has to get the day from somewhere, and which convention it uses is
        // the user's to state rather than ours to assume.
        mapping.option_name_format === 'month_at'
          ? el('div', { class: 'field' },
              el('label', {}, 'Which day of that month'),
              select(
                EXPIRY_DAYS.map(([v, l]) => [v, l]),
                mapping.expiry_day ?? 'third_friday',
                (v) => {
                  mapping.expiry_day = v as ExpiryDay;
                  remap();
                  refresh();
                },
              ),
              el('div', { class: 'hint' },
                'This file names the month a contract expires in but not the day. Whichever is picked ' +
                'here is a convention, not a reading — check it against the fund’s outcome-period dates.'),
            )
          : el('span', {}),
        mapping.option_name_format === 'explicit_columns'
          ? el('div', { class: 'field' },
              el('label', {}, 'Root taken from the description'),
              select(
                [['whole', 'The whole cell'], ['first', 'Its first word']],
                mapping.root_token ?? 'whole',
                (v) => {
                  mapping.root_token = v as 'whole' | 'first';
                  remap();
                  refresh();
                },
              ),
              el('div', { class: 'hint' },
                'A description reading “SPY PUT USD 10/30/2026” names its underlying first. Taken whole, ' +
                'every contract would come out on an underlying of its own.'),
            )
          : el('span', {}),
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
            columnOptions('— none —'),
            mapping.account_column ?? '',
            (v) => {
              if (v) mapping.account_column = v;
              else delete mapping.account_column;
              remap();
              refresh();
            },
          ),
        ),
        el('div', { class: 'field' },
          el('label', {}, 'Option description'),
          select(
            columnOptions('— the same column as the identifier —'),
            mapping.option_identifier ?? '',
            (v) => {
              if (v) mapping.option_identifier = v;
              else delete mapping.option_identifier;
              remap();
              refresh();
            },
          ),
          el('div', { class: 'hint' },
            'Where the contract itself is written, when that is a different column from the one naming ' +
            'a share. Some exports key shares on a ticker and describe the options in a name column.'),
        ),
      ]);

      for (const [key, label, hint] of FIELDS) {
        append(columnsPanel, [
          el('div', { class: 'field' },
            el('label', {}, label),
            select(
              columnOptions('— not in this file —'),
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
      return [o.root, `${o.position} ${o.right}`, String(o.strike),
        o.expiryInferred ? `${o.expiry} (day assumed)` : o.expiry,
        String(o.contracts), o.markPerUnit === null ? '—' : o.markPerUnit.toFixed(2)];
    });
    append(previewPanel, [
      el('h3', {}, 'The contracts it found'),
      table(['Root', 'Position', 'Strike', 'Expiry', 'Contracts', 'Price'], sample),
    ]);

    // Said here rather than only in the document, because this table is where
    // someone can still tell that a date is wrong.
    if (mapped.rows.some((r) => r.option?.expiryInferred)) {
      append(previewPanel, [
        el('p', { class: 'small' },
          'This file names the month each contract expires in, not the day, so the days above were ' +
          'taken by convention rather than read. Time to expiry sets every mark-to-market figure in ' +
          'the report — check them against the fund’s outcome-period dates.'),
      ]);
    }

    // Only the roots the chosen account actually uses. A fund complex's export
    // carries dozens across dozens of structures, and demanding a level for
    // every one of them buries the handful that matter.
    const file = mapped;
    const activeRoots = rootsFor(file, account);

    // --- account picker -----------------------------------------------------
    if (mapped.accounts.length > 1) {
      const accountSelect = el('select', {}) as HTMLSelectElement;
      const fillAccounts = (): void => {
        clear(accountSelect);
        const needle = accountFilter.trim().toLowerCase();
        const matching = file.accounts.filter((a) => a.toLowerCase().includes(needle));
        const options: [string, string][] = [
          ['', `— all of them together (${describe(file, null)}) —`],
          // Labelled with what each one holds, so an account with no
          // contracts in it is visible before it is chosen rather than
          // after it produces an empty document.
          ...matching.map((a) => [a, `${a} — ${describe(file, a)}`] as [string, string]),
        ];
        for (const [value, label] of options) {
          const option = el('option', { value }, label) as HTMLOptionElement;
          if (value === (account ?? '')) option.setAttribute('selected', 'selected');
          accountSelect.appendChild(option);
        }
        accountSelect.value = account ?? '';
      };
      fillAccounts();
      accountSelect.addEventListener('change', () => {
        account = accountSelect.value === '' ? null : accountSelect.value;
        remap();
        refresh();
      });

      // A file covering a whole family runs to a couple of hundred funds, and a
      // dropdown that long is a worse way to find one than typing its ticker.
      // Filtering redraws only the options, so the box keeps the caret.
      const filterField = file.accounts.length <= 12
        ? el('span', {})
        : (() => {
            const box = el('input', { type: 'text', placeholder: 'Filter by ticker' }) as HTMLInputElement;
            box.value = accountFilter;
            box.addEventListener('input', () => {
              accountFilter = box.value;
              fillAccounts();
            });
            return el('div', { class: 'field' }, el('label', {}, 'Find an account'), box);
          })();

      append(resultPanel, [
        el('h3', {}, 'Which account'),
        filterField,
        el('div', { class: 'field' },
          accountSelect,
          el('div', { class: 'hint' },
            `This file holds ${file.accounts.length} accounts. Mixing them would describe a portfolio ` +
            'nobody owns. Only accounts holding contracts can produce a report.'),
        ),
      ]);
    }

    // Nothing to build from. This happens when the chosen account holds shares
    // and cash but no contracts — an ordinary state for a fund complex's export
    // where the options sit under a different label from the holdings. Without
    // this guard the levels step renders nothing, the "still need a level"
    // check passes vacuously because there is nothing to check, and Build emits
    // a document with no legs and no underlyings that fails validation two
    // screens later with a message about JSON.
    if (activeRoots.length === 0) {
      append(resultPanel, [
        el('div', { class: 'blocked' },
          el('strong', {}, account === null
            ? 'No option positions were found anywhere in this file'
            : `No option positions in ${account}`),
          el('p', { class: 'small' },
            account === null
              ? 'The rows read as shares and cash only. Check the identifier and asset-class columns ' +
                'above — if the contracts are described in a column this mapping is not reading, ' +
                'nothing downstream can find them.'
              : `${account} holds shares and cash but no contracts. Pick an account that holds the ` +
                'options, or read all of them together, then split the file if it covers several funds.'),
        ),
      ]);
      return;
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

    const navInput = el('input', { type: 'number', step: 'any', value: navValue }) as HTMLInputElement;
    navInput.addEventListener('change', () => {
      navValue = navInput.value;
      navEdited = true;
    });
    append(resultPanel, [
      el('div', { class: 'field' },
        el('label', {}, 'Fund size'),
        navInput,
        el('div', { class: 'hint' },
          navValue === ''
            ? 'The values in this file sum to nothing, which happens when prices are quoted as a ' +
              'percentage of net assets rather than in currency, or when contracts carry no marks. ' +
              'It has to be typed: every notional in the report is divided by it.'
            : statedNetAssetsFor(file, account) !== null
              ? 'As the file states it. Override it if it is not the figure you mean — every notional ' +
                'in the report is divided by this.'
              : 'Added up from the values in this file. Override it if the file lists only part of the ' +
                'portfolio — every notional in the report is divided by this.'),
      ),
    ]);

    const asOf = el('input', { type: 'date', value: asOfValue }) as HTMLInputElement;
    asOf.addEventListener('change', () => {
      asOfValue = asOf.value;
      asOfEdited = true;
    });
    append(resultPanel, [
      el('div', { class: 'field' },
        el('label', {}, 'Position dated'),
        asOf,
        el('div', { class: 'hint' },
          asOfEdited || recognised?.hints.as_of === undefined
            ? 'The date this file describes. It appears on every page of the report.'
            : 'Read from the file. It appears on every page of the report.'),
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
            const nav = Number(navInput.value);
            if (!Number.isFinite(nav) || nav <= 0) {
              problem.textContent =
                'Fund size has to be a positive number. Every notional in the report is divided by ' +
                'it, so there is no sensible default and nothing is assumed.';
              return;
            }
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
            const built = synthesiseStructure(file, {
              as_of: asOf.value,
              net_assets: nav,
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

  /**
   * What was recognised, and why.
   *
   * The "why" is not decoration. A page that silently fills twelve dropdowns in
   * is asking to be trusted about something the user can no longer see; naming
   * the evidence — the headers it matched, the file name, what it read out of
   * the file — makes the claim checkable, and makes a wrong match obvious
   * before it becomes a plausible-looking report.
   */
  function banner(hit: Recognition, file: MappedFile): HTMLElement {
    const c = file.counts;
    const identity = [
      hit.hints.ticker,
      `${c.option} contract${c.option === 1 ? '' : 's'}`,
      c.equity > 0 ? `${c.equity} holding${c.equity === 1 ? '' : 's'}` : null,
      file.accounts.length > 1 ? `${file.accounts.length} funds in the file` : null,
      hit.hints.as_of !== undefined ? `dated ${hit.hints.as_of}` : null,
    ].filter((p): p is string => p !== null && p !== undefined && p !== '');

    return el('div', { class: 'recognised' },
      el('strong', {}, `Recognised: ${hit.mapping.name}`),
      el('p', { class: 'small' }, identity.join(' · ')),
      el('p', { class: 'small faint' }, `${hit.evidence.join('; ')}.`),
    );
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

/**
 * What the values in one account add up to.
 *
 * Zero means the file cannot supply a fund size — prices quoted as a percentage
 * of net assets, or contracts with no marks — and it has to be typed like the
 * levels are.
 */
function derivedNavOf(file: MappedFile, account: string | null): number {
  return file.rows
    .filter((r) => account === null || r.account === account)
    .reduce((total, r) => {
      if (r.holding) return total + r.holding.marketValue;
      if (r.cash) return total + r.cash.marketValue;
      if (r.option) {
        const sign = r.option.position === 'long' ? 1 : -1;
        return total + sign * r.option.contracts * r.option.multiplier * (r.option.markPerUnit ?? 0);
      }
      return total;
    }, 0);
}

/** What one account holds, for the picker's labels. */
function describe(file: MappedFile, account: string | null): string {
  const rows = file.rows.filter((r) => account === null || r.account === account);
  const options = rows.filter((r) => r.option).length;
  const holdings = rows.filter((r) => r.holding).length;
  const parts: string[] = [];
  parts.push(options === 0 ? 'no contracts' : `${options} contract${options === 1 ? '' : 's'}`);
  if (holdings > 0) parts.push(`${holdings} holding${holdings === 1 ? '' : 's'}`);
  return parts.join(', ');
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
