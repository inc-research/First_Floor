// SPDX-License-Identifier: MIT

import {
  figures,
  prepareStructure,
  sweep,
  type AssumptionLine,
  type Blocker,
  type Figure,
  type MetricKey,
  type Report,
} from '@first-floor/core';
import { deckFor, renderAssumption, renderReport, type Voice } from '@first-floor/copy';

import { append, clear, copyText, download, el, table } from '../dom.ts';
import type { AppState } from '../state.ts';

export interface ReportHandlers {
  onSliders: (next: Partial<AppState['sliders']>) => void;
  onVoice: (voice: Voice) => void;
  onBack: () => void;
}

const pct = (x: number, dp = 2): string => `${(x * 100).toFixed(dp)}%`;
const signedPct = (x: number, dp = 0): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(dp)}%`;

export function reportView(state: AppState, h: ReportHandlers): HTMLElement {
  const report = state.report;
  const root = el('div', {});
  if (!report || !state.structure) {
    append(root, [el('p', {}, 'No position loaded yet.')]);
    return root;
  }

  const deck = deckFor(state.voice);

  // ---------------------------------------------------------------- controls
  const live = el('div', {});

  append(root, [
    el('div', { class: 'row' },
      voiceToggle(state.voice, h.onVoice),
      el('button', {
        onclick: () => copyText(renderReport(report, state.voice)),
      }, 'Copy report as Markdown'),
      el('button', {
        onclick: () => download('structure.json', JSON.stringify(state.structure, null, 2)),
      }, 'Download structure document'),
      el('button', { onclick: h.onBack }, 'Back to the position'),
    ),
    el('p', { class: 'small faint' },
      'There is no link to share, because nothing was uploaded. Download the document or copy the ' +
      'text instead.'),
    sliderPanel(state, h, live),
    live,
  ]);

  // ---------------------------------------------------------------- sections
  //
  // Every metric gets its own section, including the three the sliders drive.
  // The live block above is a readout at the current settings; it is not a
  // replacement for a section, because a figure without its mechanism and its
  // assumptions is exactly what this project exists not to print.
  for (const f of figures(report)) {
    append(root, [figureSection(f, deck, state.voice, report)]);
  }

  renderLive(state, live);
  return root;
}

/**
 * Sliders bind only to closed-form parameters (D-20), and recompute through
 * `sweep()` — a core function, not an event handler (D-19). The web page renders
 * the sweep as a slider and the MCP server returns the same call as a table; if
 * this logic lived here the two surfaces would already have diverged.
 *
 * The capture grid is Monte Carlo, is computed once per report, and is
 * deliberately not draggable.
 */
function sliderPanel(state: AppState, h: ReportHandlers, live: HTMLElement): HTMLElement {
  const panel = el('div', { class: 'controls' });
  const grid = el('div', { class: 'slider-grid' });

  const make = (
    key: keyof AppState['sliders'],
    label: string,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
  ): HTMLElement => {
    const readout = el('b', {}, format(state.sliders[key]));
    const input = el('input', {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(state.sliders[key]),
    }) as HTMLInputElement;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      readout.textContent = format(v);
      h.onSliders({ [key]: v });
      renderLive(state, live);
    });
    return el('div', { class: 'slider' }, el('label', {}, label, readout), input);
  };

  append(grid, [
    make('betaDown', 'Holdings fall, relative to the index', 0.5, 1.8, 0.01, (v) => `${v.toFixed(2)}×`),
    make('betaUp', 'Holdings rise, relative to the index', 0.5, 1.8, 0.01, (v) => `${v.toFixed(2)}×`),
    make('volBeta', 'Option prices rise per unit of fall', 0, 1.5, 0.05, (v) => `${(v * 100).toFixed(0)} pts`),
    make('referenceMove', 'Index move', -0.8, 0.4, 0.01, (v) => signedPct(v)),
  ]);

  append(panel, [
    grid,
    el('p', { class: 'small faint' },
      'These four are assumptions, not measurements — nothing in a holdings file records them. The ' +
      'figures below follow them as you drag. The upside-capture table further down does not: it is a ' +
      'simulation, worked out once for this position.'),
  ]);

  return panel;
}

/** The slider-driven block, recomputed on every input event. */
function renderLive(state: AppState, host: HTMLElement): void {
  clear(host);
  if (!state.structure || !state.report) return;

  const deck = deckFor(state.voice);
  const scenario = {
    ...state.scenario,
    vol_beta: state.sliders.volBeta,
    held_asset_response: {
      beta_down: state.sliders.betaDown,
      beta_up: state.sliders.betaUp,
      source: 'assumed' as const,
    },
  };
  const prepared = prepareStructure(state.structure, scenario);
  const result = sweep(prepared, scenario, 'beta_down', [state.sliders.betaDown], {
    referenceMove: state.sliders.referenceMove,
  });
  const point = result.points[0]!;

  append(host, [
    el('h2', {}, state.voice === 'plain' ? 'At the settings above' : 'At the current parameters'),
    el('div', { class: 'row' },
      figureTile(
        'At expiry',
        pct(point.terminal),
        `if the index ends ${signedPct(state.sliders.referenceMove)} and the holdings move ${state.sliders.betaDown.toFixed(2)}× that`,
      ),
      figureTile(
        'Marked today',
        pct(point.mtm),
        `part way there, with option prices ${(state.sliders.volBeta * 100).toFixed(0)} points higher`,
      ),
      figureTile(
        'Lowest at expiry',
        pct(point.floor.value),
        point.floor.flat_below
          ? `level from ${pct(-point.floor.at_reference_move, 1)} down`
          : 'still falling below that — no level floor',
      ),
    ),
    el('p', { class: 'small faint' },
      state.voice === 'plain'
        ? 'These three follow the sliders. Each one is explained in full further down, where the ' +
          'standard tables and the assumptions behind them sit.'
        : 'Closed-form figures at the current slider settings. Full sections, tables and assumption ' +
          'lines follow below.'),
    assumptionBlock(
      [
        { kind: 'as_of', date: state.report.as_of },
        {
          kind: 'held_asset_response',
          beta_down: state.sliders.betaDown,
          beta_up: state.sliders.betaUp,
          source: 'assumed',
        },
        { kind: 'vol_beta', value: state.sliders.volBeta },
        { kind: 'reference_moves', values: [state.sliders.referenceMove] },
        { kind: 'not_a_collectible_outcome' },
      ],
      state.voice,
    ),
  ]);
}

function figureTile(label: string, value: string, caption: string): HTMLElement {
  const tile = el('div', { class: 'panel' },
    el('div', { class: 'small faint' }, label),
    el('div', { class: 'headline' }, value),
    el('div', { class: 'small' }, caption),
  );
  tile.style.flex = '1 1 14rem';
  tile.style.minWidth = '13rem';
  return tile;
}

// ---------------------------------------------------------------- sections

function figureSection(
  f: Figure<unknown>,
  deck: ReturnType<typeof deckFor>,
  voice: Voice,
  report: Report,
): HTMLElement {
  const entry = deck[f.metric];
  const section = el('section', {}, el('h2', {}, entry.title));

  if (f.value === null) {
    append(section, [
      el('div', { class: 'blocked' },
        el('p', {}, entry.whenAbsent ?? ''),
        el('ul', {}, ...f.blockers.map((b) => el('li', {}, blockerText(b, voice)))),
      ),
    ]);
    return section;
  }

  append(section, valueBlock(f.metric, f.value, report, voice));
  append(section, [
    el('p', { class: 'mechanism' }, entry.mechanism),
    el('p', { class: 'change' },
      voice === 'plain' ? 'What would make this different. ' : 'Sensitivity. ',
      entry.whatWouldChangeIt),
  ]);
  if (f.assumptions.length > 0) append(section, [assumptionBlock(f.assumptions, voice)]);
  if (f.blockers.length > 0) {
    append(section, [
      el('div', { class: 'blocked' },
        el('strong', {}, voice === 'plain' ? 'Not shown here' : 'Diagnostics'),
        el('ul', {}, ...f.blockers.map((b) => el('li', {}, blockerText(b, voice)))),
      ),
    ]);
  }
  return section;
}

function blockerText(b: Blocker, voice: Voice): string {
  return voice === 'plain' ? `${b.message} ${b.remedy}` : `[${b.code}] ${b.message} ${b.remedy}`;
}

/**
 * Assumption lines render in both voices, always. The temptation is to drop
 * them from plain mode because they are awkward to phrase simply; that is
 * exactly backwards (D-24). A non-specialist needs to know the frightening
 * number rests on a rate nobody measured rather more than a specialist does.
 */
function assumptionBlock(lines: AssumptionLine[], voice: Voice): HTMLElement {
  return el('div', { class: 'assumptions' },
    el('h4', {}, voice === 'plain' ? 'What this rests on' : 'Assumptions'),
    el('ul', {}, ...lines.map((a) => el('li', {}, renderAssumption(a, voice)))),
  );
}

function valueBlock(metric: MetricKey, value: unknown, report: Report, voice: Voice): HTMLElement[] {
  switch (metric) {
    case 'classification': {
      const v = value as { architecture: string; protection_kind: string; floor_tranches: number; cap_tranches: number; protection_continues_below_lowest_strike: boolean };
      return [
        table(['', ''], [
          ['Shape', v.architecture.replace(/_/g, ' ')],
          ['Downside built from', v.protection_kind.replace(/_/g, ' ')],
          ['Put tranches', String(v.floor_tranches)],
          ['Call tranches', String(v.cap_tranches)],
        ]),
        el('p', { class: 'small' },
          v.protection_continues_below_lowest_strike
            ? 'Below the lowest strike the puts keep paying, however far the index falls.'
            : 'Below the lowest strike the puts stop paying and falls are felt in full again.'),
      ];
    }

    case 'advertised_vs_computed': {
      const v = value as { advertised_protection_pct: number | null; advertised_protection_kind: string | null; computed_floor: number | null; comparable: boolean };
      return [
        table(['', ''], [
          ['Published', v.advertised_protection_pct === null ? '—' : `${pct(v.advertised_protection_pct, 0)} ${v.advertised_protection_kind ?? ''}`],
          ['From the contracts on file', v.computed_floor === null ? '—' : pct(v.computed_floor)],
        ]),
        el('p', { class: 'small' },
          v.comparable
            ? 'These two measure the same thing and can be read side by side.'
            : 'These two measure different things. Subtracting one from the other would not mean anything.'),
      ];
    }

    case 'gradual_decline': {
      const v = value as { outcome: number };
      const floor = report.terminal_floor.value;
      return [
        el('div', { class: 'headline' }, pct(v.outcome)),
        floor
          ? el('p', { class: 'small' },
              `Against ${pct(floor.value)} from the expiry arithmetic. The gap between the two is the ` +
              'reason both are shown.')
          : el('span', {}),
      ];
    }

    case 'capture': {
      const v = value as { grid: Record<string, { capture: number | null }>; realisation: string };
      const keys = Object.keys(v.grid);
      const tenors = [...new Set(keys.map((k) => k.split('_')[0]!))];
      const deltas = [...new Set(keys.map((k) => k.split('_')[1]!))];
      return [
        table(
          [voice === 'plain' ? 'Renews every' : 'Cap tenor', ...deltas.map((d) => (voice === 'plain' ? `struck at ${d}` : `δ ${d}`))],
          tenors.map((t) => [
            voice === 'plain' ? `${t.replace('d', '')} days` : t,
            ...deltas.map((d) => {
              const cell = v.grid[`${t}_${d}`];
              return cell?.capture == null ? '—' : pct(cell.capture);
            }),
          ]),
        ),
        el('p', { class: 'small' },
          v.realisation === 'realised_and_permanent'
            ? 'These calls renew repeatedly, so anything given up is given up for good.'
            : 'This runs to a single end date, so a shortfall part way through is largely value that ' +
              'returns of its own accord by the end.'),
      ];
    }

    case 'positioning': {
      const v = value as { put_spot_notional: number; short_call_spot_notional: number; gross_option_notional: number; option_book_value: number | null; delta_cancellation_ratio: number | null; lowest_attachment: number | null; net_delta: number };
      const rows: string[][] = [
        ['Puts cover', pct(v.put_spot_notional)],
        ['Calls sold cover', pct(v.short_call_spot_notional)],
        ['Both sides tracked', pct(v.gross_option_notional)],
        ['Contracts worth', v.option_book_value === null ? '—' : pct(v.option_book_value)],
      ];
      if (v.delta_cancellation_ratio !== null) {
        rows.push([
          voice === 'plain' ? 'Puts sized to offset holdings falling' : 'Λ',
          `${v.delta_cancellation_ratio.toFixed(3)}×`,
        ]);
      }
      if (v.lowest_attachment !== null) rows.push(['Lowest strike, below today', pct(-v.lowest_attachment, 1)]);
      rows.push(['Net delta', v.net_delta.toFixed(4)]);
      return [table(['', ''], rows)];
    }

    case 'reset_cadence': {
      const v = value as { mean_floor_remaining_days: number | null; mean_cap_remaining_days: number | null; reset_asymmetry_ratio: number | null };
      return [table(['', ''], [
        ['Puts, average life left', v.mean_floor_remaining_days === null ? '—' : `${v.mean_floor_remaining_days.toFixed(1)}d`],
        ['Calls, average life left', v.mean_cap_remaining_days === null ? '—' : `${v.mean_cap_remaining_days.toFixed(1)}d`],
        ['Puts run longer by', v.reset_asymmetry_ratio === null ? '—' : `${v.reset_asymmetry_ratio.toFixed(1)}×`],
      ])];
    }

    case 'concentration': {
      const v = value as { names: number; effective_n: number; top_weight: number; weights_sum_raw: number };
      return [
        table(['', ''], [
          ['Names', String(v.names)],
          ['Behaves like', `${v.effective_n.toFixed(2)} equal holdings`],
          ['Largest holding', pct(v.top_weight)],
          ['Weights on file add to', pct(v.weights_sum_raw)],
        ]),
      ];
    }

    case 'active_share': {
      const v = value as { active_share: number; name_coverage: number; matched_names: number; reference_names: number; held_only: string[]; reference_only: string[] };
      return [
        el('div', { class: 'headline' }, pct(v.active_share)),
        table(['', ''], [
          ['Index names matched', `${v.matched_names} of ${v.reference_names} (${pct(v.name_coverage)})`],
          ['Held, not in the index', v.held_only.length ? v.held_only.join(', ') : 'none'],
          ['In the index, not held', v.reference_only.length ? v.reference_only.join(', ') : 'none'],
        ]),
      ];
    }

    // Slider-driven metrics are rendered by `renderLive`; these arms exist so
    // the switch stays exhaustive if the live set ever changes.
    case 'terminal_floor': {
      const v = value as { value: number; at_reference_move: number; flat_below: boolean };
      return [
        el('div', { class: 'headline' }, pct(v.value)),
        el('p', { class: 'small' },
          v.flat_below
            ? `Level once the index is down ${pct(-v.at_reference_move, 1)}.`
            : 'Still falling at the bottom of the range examined.'),
      ];
    }

    case 'beta_conditional_floor':
    case 'mark_to_market': {
      const t = value as Record<string, Record<string, number>>;
      const cols = Object.keys(t).sort();
      const rows = Object.keys(t[cols[0]!]!).sort();
      // Column headings carry their units. A bare "1.10" over a column of
      // percentages is the kind of label a reader has to be told how to read.
      const heading = (c: string): string => {
        if (metric === 'beta_conditional_floor') {
          return voice === 'plain' ? `holdings fall ${c}×` : `β = ${c}`;
        }
        return voice === 'plain' ? `+${(Number(c) * 100).toFixed(0)} pts vol` : `vol_beta ${c}`;
      };
      return [table(
        ['Index move', ...cols.map(heading)],
        rows.map((r) => [signedPct(Number(r)), ...cols.map((c) => pct(t[c]![r]!))]),
      )];
    }
  }
}

function voiceToggle(current: Voice, onVoice: (v: Voice) => void): HTMLElement {
  const button = (v: Voice, label: string) =>
    el('button', {
      'aria-pressed': String(current === v),
      onclick: () => onVoice(v),
    }, label);
  return el('div', { class: 'voice-toggle' },
    button('plain', 'Plain'),
    button('technical', 'Technical'),
  );
}
