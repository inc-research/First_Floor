// SPDX-License-Identifier: MIT

import { classify, type Classification } from './analytics/classify.ts';
import { exposure, type Exposure } from './analytics/exposure.ts';
import {
  terminalByBeta,
  terminalFloor,
  type TerminalFloor,
} from './analytics/geometry.ts';
import { mtmByVolBeta } from './analytics/mark.ts';
import { gradualDeclineFromScenario, type GradualDecline } from './analytics/paths.ts';
import {
  captureGrid,
  captureRealisation,
  type CaptureCell,
  type CaptureRealisation,
} from './analytics/capture.ts';
import { activeShare, concentration, type ActiveShare, type Concentration } from './analytics/sleeve.ts';
import type { Blocker } from './diagnostics.ts';
import type { PreparedStructure } from './model/structure.ts';
import type { ReferenceComposition, Scenario } from './schema/types.ts';

/**
 * Every metric in the v1 report. The list is frozen (D-27); anything else is v2.
 *
 * Exhaustive by design: the copy decks are typed as `Record<MetricKey, ...>`, so
 * adding a metric without writing copy for it fails to compile rather than
 * rendering a blank.
 */
export type MetricKey =
  | 'classification'
  | 'advertised_vs_computed'
  | 'terminal_floor'
  | 'beta_conditional_floor'
  | 'mark_to_market'
  | 'gradual_decline'
  | 'positioning'
  | 'reset_cadence'
  | 'capture'
  | 'concentration'
  | 'active_share';

/**
 * An assumption a figure actually consumed.
 *
 * Structured rather than pre-rendered, because both voices print the same line
 * differently and neither may omit it. Invariant 1: no function may return a
 * downside figure stripped of its `vol_beta` and its held-asset betas, and the
 * report layer may not print a figure whose assumptions it cannot also print.
 */
export type AssumptionLine =
  | { kind: 'as_of'; date: string }
  | { kind: 'held_asset_response'; beta_down: number; beta_up: number; source: string }
  /** Mark-to-market never consults beta. Erratum E-06. */
  | { kind: 'held_asset_response_fixed'; value: 1.0 }
  | { kind: 'vol_beta'; value: number }
  | { kind: 'vol_beta_swept'; values: number[] }
  | { kind: 'beta_swept'; values: number[] }
  | { kind: 'reference_moves'; values: number[] }
  | {
      kind: 'decline_path';
      total_move: number;
      horizon_days: number;
      include_call_overlay: boolean;
    }
  | {
      kind: 'capture_simulation';
      paths: number;
      seed: number;
      reference_move: number;
      reference_vol: number;
      horizon_days: number;
      band: number;
      overwrite: number;
    }
  | { kind: 'modelled_vols'; leg_ids: string[]; fallback_iv: number }
  | { kind: 'composition_as_of'; date: string; gap_days: number; source_note: string }
  | { kind: 'not_a_collectible_outcome' }
  | { kind: 'single_path_not_a_distribution' }
  | { kind: 'cross_sectional_not_behavioural' };

/**
 * A value or an explicit absence, with the assumptions that produced it.
 *
 * The shape is the enforcement mechanism. A renderer holding a `Figure` cannot
 * reach the number without also holding its assumption lines, so invariant 1 is
 * a property of the type rather than a rule someone has to remember.
 */
export interface Figure<T> {
  metric: MetricKey;
  value: T | null;
  blockers: Blocker[];
  assumptions: AssumptionLine[];
}

function figure<T>(
  metric: MetricKey,
  value: T | null,
  assumptions: AssumptionLine[],
  blockers: Blocker[] = [],
): Figure<T> {
  return { metric, value, blockers, assumptions };
}

export interface AdvertisedVsComputed {
  advertised_protection_pct: number | null;
  advertised_protection_kind: string | null;
  computed_floor: number | null;
  computed_lowest_attachment: number | null;
  /** True when the fact sheet's headline and the computed floor describe the same thing. */
  comparable: boolean;
}

export interface CaptureSection {
  grid: Record<string, CaptureCell>;
  realisation: CaptureRealisation;
}

export interface ResetCadence {
  mean_floor_remaining_days: number | null;
  mean_cap_remaining_days: number | null;
  reset_asymmetry_ratio: number | null;
  distinct_floor_expiries: number;
  distinct_cap_expiries: number;
}

export interface Report {
  as_of: string;
  schema_version: string;
  /** Echoed for the user's own labelling. Never entered any computation (D-02). */
  subject: { ticker?: string; issuer?: string; note?: string } | null;
  label: string | null;
  classification: Figure<Classification>;
  advertised_vs_computed: Figure<AdvertisedVsComputed>;
  terminal_floor: Figure<TerminalFloor>;
  beta_conditional_floor: Figure<Record<string, Record<string, number>>>;
  mark_to_market: Figure<Record<string, Record<string, number>>>;
  gradual_decline: Figure<GradualDecline>;
  positioning: Figure<Exposure>;
  reset_cadence: Figure<ResetCadence>;
  capture: Figure<CaptureSection>;
  concentration: Figure<Concentration>;
  active_share: Figure<ActiveShare>;
}

export interface ReportOptions {
  composition?: ReferenceComposition | null;
  betaGrid?: number[];
  terminalMoves?: number[];
  volBetaGrid?: number[];
  mtmMoves?: number[];
}

const DEFAULT_BETA_GRID = [1.0, 1.1, 1.2];
const DEFAULT_TERMINAL_MOVES = [-0.2, -0.4, -0.6];
const DEFAULT_VOL_BETA_GRID = [0.0, 0.35, 0.65, 1.0];
const DEFAULT_MTM_MOVES = [-0.1, -0.2, -0.3];

/**
 * Assemble the report. **Renders nothing.**
 *
 * Two renderers consume this object, `technical` and `plain`, with the same
 * numbers and the same caveats in different vocabulary. Keeping assembly and
 * rendering apart is what lets the MCP server and the web page agree by
 * construction rather than by discipline.
 */
export function buildReport(
  s: PreparedStructure,
  scenario: Scenario,
  options: ReportOptions = {},
): Report {
  const asOf: AssumptionLine = { kind: 'as_of', date: s.asOf };
  const response: AssumptionLine = {
    kind: 'held_asset_response',
    beta_down: s.response.beta_down,
    beta_up: s.response.beta_up,
    source: s.response.source,
  };

  const modelled = s.legs.filter((l) => l.ivSource === 'fallback');
  const modelledLine: AssumptionLine[] =
    modelled.length > 0
      ? [{ kind: 'modelled_vols', leg_ids: modelled.map((l) => l.id), fallback_iv: s.fallbackIv }]
      : [];

  const cls = classify(s);
  const exp = exposure(s);
  const volBeta = scenario.vol_beta ?? 0.65;

  const betaGrid = options.betaGrid ?? DEFAULT_BETA_GRID;
  const terminalMoves = options.terminalMoves ?? DEFAULT_TERMINAL_MOVES;
  const volBetaGrid = options.volBetaGrid ?? DEFAULT_VOL_BETA_GRID;
  const mtmMoves = options.mtmMoves ?? DEFAULT_MTM_MOVES;

  const hasPuts = cls.values.floor_tranches > 0;

  // --- terminal floor ------------------------------------------------------
  // Reported with its caveat attached, always. Where tranches expire on several
  // dates spanning months there is no calendar date on which all of them pay,
  // so this is not a collectible outcome and must sit beside the decline figure.
  const floorAssumptions: AssumptionLine[] = [
    asOf,
    response,
    { kind: 'not_a_collectible_outcome' },
    ...modelledLine,
  ];
  const floorFigure = hasPuts
    ? figure('terminal_floor', terminalFloor(s, s.response.beta_down), floorAssumptions)
    : figure<TerminalFloor>('terminal_floor', null, floorAssumptions, cls.blockers.filter((b) => b.code === 'no_long_puts'));

  // --- capture -------------------------------------------------------------
  const capScenario = scenario.capture;
  const captureAssumptions: AssumptionLine[] = [asOf];
  let captureFigure: Figure<CaptureSection>;
  if (capScenario) {
    const overwrite = capScenario.overwrite ?? exp.values.short_call_spot_notional;
    captureAssumptions.push({
      kind: 'capture_simulation',
      paths: capScenario.paths ?? 20000,
      seed: capScenario.seed ?? 11,
      reference_move: capScenario.reference_move ?? 0.152,
      reference_vol: capScenario.reference_vol ?? 0.16,
      horizon_days: capScenario.horizon_days ?? 91,
      band: capScenario.band ?? 0.02,
      overwrite,
    });
    captureFigure = figure('capture', {
      grid: captureGrid(s, capScenario),
      realisation: captureRealisation(cls.values.architecture, cls.values.distinct_cap_expiries),
    }, captureAssumptions);
  } else {
    captureFigure = figure<CaptureSection>('capture', null, captureAssumptions, [
      {
        code: 'no_short_calls',
        message: 'No capture simulation was requested.',
        remedy: 'Add a capture block to the scenario to see what the written calls give up in a rally.',
      },
    ]);
  }

  // --- sleeve --------------------------------------------------------------
  const conc = concentration(s);
  const share = activeShare(s, options.composition ?? null);

  return {
    as_of: s.asOf,
    schema_version: s.doc.schema_version,
    subject: s.doc.subject ?? null,
    label: s.doc.label ?? null,

    classification: figure('classification', cls.values, [asOf]),

    advertised_vs_computed: figure(
      'advertised_vs_computed',
      advertisedVsComputed(s, floorFigure.value, exp.values),
      [asOf, response, { kind: 'not_a_collectible_outcome' }],
    ),

    terminal_floor: floorFigure,

    beta_conditional_floor: figure(
      'beta_conditional_floor',
      terminalByBeta(s, betaGrid, terminalMoves),
      [asOf, { kind: 'beta_swept', values: betaGrid }, { kind: 'reference_moves', values: terminalMoves }, ...modelledLine],
    ),

    mark_to_market: figure(
      'mark_to_market',
      mtmByVolBeta(s, volBetaGrid, mtmMoves),
      [
        asOf,
        // Not `response`: this figure never consults beta. Erratum E-06.
        { kind: 'held_asset_response_fixed', value: 1.0 },
        { kind: 'vol_beta_swept', values: volBetaGrid },
        { kind: 'reference_moves', values: mtmMoves },
        ...modelledLine,
      ],
    ),

    gradual_decline: (() => {
      const d = scenario.decline;
      const lines: AssumptionLine[] = [asOf, { kind: 'single_path_not_a_distribution' }];
      if (d) {
        lines.push({
          kind: 'decline_path',
          total_move: d.total_move ?? -0.3,
          horizon_days: d.horizon_days ?? 365,
          include_call_overlay: d.include_call_overlay ?? false,
        });
      }
      const value = gradualDeclineFromScenario(s, d);
      return figure(
        'gradual_decline',
        value,
        lines,
        value === null && !d
          ? [
              {
                code: 'no_long_puts',
                message: 'No gradual decline was requested.',
                remedy: 'Add a decline block to the scenario to see the slow-grind case the terminal floor hides.',
              },
            ]
          : value === null
            ? cls.blockers.filter((b) => b.code === 'no_long_puts')
            : [],
      );
    })(),

    positioning: figure('positioning', exp.values, [asOf, ...modelledLine], exp.blockers),

    reset_cadence: figure('reset_cadence', {
      mean_floor_remaining_days: cls.values.mean_floor_remaining_days,
      mean_cap_remaining_days: cls.values.mean_cap_remaining_days,
      reset_asymmetry_ratio: cls.values.reset_asymmetry_ratio,
      distinct_floor_expiries: cls.values.distinct_floor_expiries,
      distinct_cap_expiries: cls.values.distinct_cap_expiries,
    }, [asOf]),

    capture: captureFigure,

    concentration: figure(
      'concentration',
      conc,
      [asOf, { kind: 'cross_sectional_not_behavioural' }],
      conc === null
        ? [
            {
              code: 'no_constituents',
              message: 'No constituent list was supplied for the held asset.',
              remedy: 'Add held_asset.constituents with name and weight to see concentration.',
            },
          ]
        : [],
    ),

    active_share: figure(
      'active_share',
      share.values,
      share.values
        ? [
            asOf,
            {
              kind: 'composition_as_of',
              date: share.values.composition_as_of,
              gap_days: share.values.composition_gap_days,
              source_note: share.values.source_note,
            },
            { kind: 'cross_sectional_not_behavioural' },
          ]
        : [asOf],
      share.blockers,
    ),
  };
}

/**
 * The fact sheet's headline beside the computed one.
 *
 * `comparable` is false whenever the two describe different things — a buffer
 * quoted against an inception level is not the same claim as a floor computed
 * against today's, and setting them side by side without saying so invites the
 * reader to subtract one from the other.
 */
function advertisedVsComputed(
  s: PreparedStructure,
  floor: TerminalFloor | null,
  exp: Exposure,
): AdvertisedVsComputed {
  const ad = s.doc.advertised;
  return {
    advertised_protection_pct: ad?.protection_pct ?? null,
    advertised_protection_kind: ad?.protection_kind ?? null,
    computed_floor: floor?.value ?? null,
    computed_lowest_attachment: exp.lowest_attachment,
    comparable: ad?.protection_kind === 'floor' && floor !== null,
  };
}

/** Every figure on a report, for renderers and lints that must cover them all. */
export function figures(report: Report): Figure<unknown>[] {
  return [
    report.classification,
    report.advertised_vs_computed,
    report.terminal_floor,
    report.beta_conditional_floor,
    report.mark_to_market,
    report.gradual_decline,
    report.positioning,
    report.reset_cadence,
    report.capture,
    report.concentration,
    report.active_share,
  ];
}
