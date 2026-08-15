// SPDX-License-Identifier: MIT

import type { Blocker, Figure, MetricKey, Report } from '@first-floor/core';
import { figures } from '@first-floor/core';

import { renderAssumption } from './assumptions.ts';
import { plainDeck } from './plain.ts';
import { technicalDeck } from './technical.ts';
import type { Deck, Voice } from './types.ts';

export function deckFor(voice: Voice): Deck {
  return voice === 'plain' ? plainDeck : technicalDeck;
}

const pct = (x: number, dp = 2): string => `${(x * 100).toFixed(dp)}%`;
const signedPct = (x: number, dp = 0): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(dp)}%`;

/**
 * Render a report to Markdown in one voice.
 *
 * Plain is the default. The two voices carry the same numbers and the same
 * caveats; only the vocabulary differs, and neither may drop an assumption line
 * (invariant 1, D-24).
 *
 * Rounding happens here, at the render boundary, never in the core. The core
 * returns full precision and the renderer decides.
 */
export function renderReport(report: Report, voice: Voice = 'plain'): string {
  const deck = deckFor(voice);
  const out: string[] = [];

  const title = report.label ?? 'Collared structure';
  out.push(`# ${title}`, '');
  out.push(
    voice === 'plain'
      ? `Everything below describes the position as it stood on **${report.as_of}**. It measures what the contracts on file do at stated index levels; it is not a forecast and not advice.`
      : `As of **${report.as_of}**. Conditional arithmetic on a dated position; measurement, not forecast.`,
    '',
  );

  if (report.subject) {
    const bits = [report.subject.ticker, report.subject.issuer].filter(Boolean).join(' · ');
    if (bits) {
      out.push(
        voice === 'plain'
          ? `You labelled this report *${bits}*. That label came from you and was not used in any calculation.`
          : `Subject (user-asserted, not an input): *${bits}*`,
        '',
      );
    }
  }

  for (const f of figures(report)) {
    out.push(...renderFigure(f, deck, voice, report));
  }

  return out.join('\n');
}

function renderFigure(
  f: Figure<unknown>,
  deck: Deck,
  voice: Voice,
  report: Report,
): string[] {
  const entry = deck[f.metric];
  const out: string[] = [`## ${entry.title}`, ''];

  if (f.value === null) {
    out.push(entry.whenAbsent ?? '', '');
    out.push(...f.blockers.map((b) => `- ${blockerLine(b, voice)}`));
    out.push('');
    return out;
  }

  const body = renderValue(f.metric, f.value, report, voice);
  if (body.length > 0) out.push(...body, '');

  out.push(entry.mechanism, '');
  out.push(
    voice === 'plain'
      ? `**What would make this different.** ${entry.whatWouldChangeIt}`
      : `**Sensitivity.** ${entry.whatWouldChangeIt}`,
    '',
  );

  if (f.assumptions.length > 0) {
    out.push(voice === 'plain' ? '**What this rests on**' : '**Assumptions**', '');
    out.push(...f.assumptions.map((a) => `- ${renderAssumption(a, voice)}`));
    out.push('');
  }

  if (f.blockers.length > 0) {
    out.push(voice === 'plain' ? '**Not shown here**' : '**Diagnostics**', '');
    out.push(...f.blockers.map((b) => `- ${blockerLine(b, voice)}`));
    out.push('');
  }

  return out;
}

function blockerLine(b: Blocker, voice: Voice): string {
  return voice === 'plain' ? `${b.message} ${b.remedy}` : `[${b.code}] ${b.message} ${b.remedy}`;
}

/** The figure itself. Everything here is formatting; no arithmetic. */
function renderValue(
  metric: MetricKey,
  value: unknown,
  report: Report,
  voice: Voice,
): string[] {
  switch (metric) {
    case 'terminal_floor': {
      const v = value as { value: number; at_reference_move: number; flat_below: boolean; flat_tolerance: number };
      return [
        `**${pct(v.value)}**, reached once the index is down ${pct(-v.at_reference_move, 1)} and ${
          v.flat_below ? 'level from there' : 'still falling below that'
        } (level to within ${(v.flat_tolerance * 10000).toFixed(0)} hundredths of a percent).`,
      ];
    }

    case 'beta_conditional_floor': {
      const table = value as Record<string, Record<string, number>>;
      const betas = Object.keys(table).sort();
      const moves = Object.keys(table[betas[0]!]!).sort();
      const head = voice === 'plain' ? 'Index move' : 'Reference move';
      return [
        `| ${head} | ${betas.map((b) => (voice === 'plain' ? `holdings fall ${b}×` : `β = ${b}`)).join(' | ')} |`,
        `|---|${betas.map(() => '---').join('|')}|`,
        ...moves.map(
          (m) => `| ${signedPct(Number(m))} | ${betas.map((b) => pct(table[b]![m]!)).join(' | ')} |`,
        ),
      ];
    }

    case 'mark_to_market': {
      const table = value as Record<string, Record<string, number>>;
      const vbs = Object.keys(table).sort();
      const moves = Object.keys(table[vbs[0]!]!).sort();
      const head = voice === 'plain' ? 'Index move' : 'Reference move';
      return [
        `| ${head} | ${vbs.map((v) => (voice === 'plain' ? `+${(Number(v) * 100).toFixed(0)} pts vol` : `vb = ${v}`)).join(' | ')} |`,
        `|---|${vbs.map(() => '---').join('|')}|`,
        ...moves.map(
          (m) => `| ${signedPct(Number(m))} | ${vbs.map((v) => pct(table[v]![m]!)).join(' | ')} |`,
        ),
      ];
    }

    case 'gradual_decline': {
      const v = value as { outcome: number };
      const floor = report.terminal_floor.value;
      const lines = [`**${pct(v.outcome)}**`];
      if (floor) {
        lines.push(
          '',
          voice === 'plain'
            ? `That is worse than the ${pct(floor.value)} the expiry arithmetic gives, and the gap between the two is the point of showing both.`
            : `Against a terminal floor of ${pct(floor.value)}; the divergence is the point.`,
        );
      }
      return lines;
    }

    case 'capture': {
      const v = value as { grid: Record<string, { capture: number | null; conditioned_paths: number }>; realisation: string };
      const keys = Object.keys(v.grid);
      const tenors = [...new Set(keys.map((k) => k.split('_')[0]!))];
      const deltas = [...new Set(keys.map((k) => k.split('_')[1]!))];
      const head = voice === 'plain' ? 'Renews every' : 'Cap tenor';
      const rows = [
        `| ${head} | ${deltas.map((d) => (voice === 'plain' ? `struck at ${d} delta` : `δ ${d}`)).join(' | ')} |`,
        `|---|${deltas.map(() => '---').join('|')}|`,
        ...tenors.map((t) => {
          const label = voice === 'plain' ? `${t.replace('d', '')} days` : t;
          const cells = deltas.map((d) => {
            const cell = v.grid[`${t}_${d}`];
            return cell?.capture === null || cell === undefined ? '—' : pct(cell.capture);
          });
          return `| ${label} | ${cells.join(' | ')} |`;
        }),
      ];
      rows.push(
        '',
        v.realisation === 'realised_and_permanent'
          ? voice === 'plain'
            ? 'These calls renew repeatedly, so anything given up is given up for good — the contracts settled and the money left.'
            : 'Rolling caps: a shortfall is realised and permanent.'
          : voice === 'plain'
            ? 'This runs to a single end date, so a shortfall part way through is largely value that returns of its own accord by the end. A figure of half today may be most of the way back by expiry.'
            : 'Single outcome period: a mid-period shortfall is largely unrealised time value that reverses mechanically by expiry.',
      );
      return rows;
    }

    case 'positioning': {
      const v = value as {
        put_spot_notional: number; short_call_spot_notional: number;
        gross_option_notional: number; option_book_value: number | null;
        delta_cancellation_ratio: number | null; lowest_attachment: number | null;
        net_delta: number; held_asset_weight: number;
      };
      const rows = [
        `- Puts cover **${pct(v.put_spot_notional)}** of the fund; calls sold cover **${pct(v.short_call_spot_notional)}**.`,
        `- Both sides together: **${pct(v.gross_option_notional)}** of the fund tracked${
          v.option_book_value !== null ? `, for contracts worth **${pct(v.option_book_value)}**` : ''
        }.`,
      ];
      if (v.delta_cancellation_ratio !== null) {
        rows.push(
          voice === 'plain'
            ? `- The puts are sized to offset holdings falling **${v.delta_cancellation_ratio.toFixed(3)}×** the index. That is the rate at which the floor comes out level.`
            : `- Λ = **${v.delta_cancellation_ratio.toFixed(6)}** — the held-asset beta at which the ladder neutralises equity delta below the lowest strike.`,
        );
      }
      if (v.lowest_attachment !== null) {
        rows.push(`- Lowest strike sits **${pct(-v.lowest_attachment, 1)}** below today's index level.`);
      }
      rows.push(`- Net delta **${v.net_delta.toFixed(4)}** against a held weight of ${pct(v.held_asset_weight)}.`);
      return rows;
    }

    case 'reset_cadence': {
      const v = value as { mean_floor_remaining_days: number | null; mean_cap_remaining_days: number | null; reset_asymmetry_ratio: number | null };
      const rows: string[] = [];
      if (v.mean_floor_remaining_days !== null) rows.push(`- Puts: **${v.mean_floor_remaining_days.toFixed(1)} days** left on average.`);
      if (v.mean_cap_remaining_days !== null) rows.push(`- Calls: **${v.mean_cap_remaining_days.toFixed(1)} days** left on average.`);
      if (v.reset_asymmetry_ratio !== null) {
        rows.push(
          voice === 'plain'
            ? `- The puts run **${v.reset_asymmetry_ratio.toFixed(1)}×** longer than the calls.`
            : `- Reset asymmetry ratio **${v.reset_asymmetry_ratio.toFixed(4)}**.`,
        );
      }
      return rows;
    }

    case 'concentration': {
      const v = value as { names: number; effective_n: number; top_weight: number; weights_sum_raw: number };
      return [
        `- **${v.names}** names, behaving like **${v.effective_n.toFixed(2)}** equally sized ones.`,
        `- Largest single holding: **${pct(v.top_weight)}**.`,
        `- Weights on file add to ${pct(v.weights_sum_raw)}${v.weights_sum_raw < 0.99 ? ' — a partial list' : ''}.`,
      ];
    }

    case 'active_share': {
      const v = value as { active_share: number; name_coverage: number; matched_names: number; reference_names: number; held_only: string[]; reference_only: string[] };
      return [
        `**${pct(v.active_share)}** different from the index list.`,
        '',
        `- Matched **${v.matched_names}** of **${v.reference_names}** index names (${pct(v.name_coverage)} coverage).`,
        ...(v.held_only.length > 0 ? [`- Held but not in the index: ${v.held_only.join(', ')}.`] : []),
        ...(v.reference_only.length > 0 ? [`- In the index but not held: ${v.reference_only.join(', ')}.`] : []),
      ];
    }

    case 'advertised_vs_computed': {
      const v = value as { advertised_protection_pct: number | null; advertised_protection_kind: string | null; computed_floor: number | null; comparable: boolean };
      const rows: string[] = [];
      if (v.advertised_protection_pct !== null) {
        rows.push(`- Published: **${pct(v.advertised_protection_pct, 0)}** ${v.advertised_protection_kind ?? ''}.`);
      }
      if (v.computed_floor !== null) rows.push(`- From the contracts on file: **${pct(v.computed_floor)}**.`);
      rows.push(
        v.comparable
          ? voice === 'plain'
            ? '- These two measure the same thing and can be read side by side.'
            : '- Comparable: both measured against today\'s reference level.'
          : voice === 'plain'
            ? '- These two measure different things. Subtracting one from the other would not mean anything.'
            : '- Not comparable: different reference points. Do not difference them.',
      );
      return rows;
    }

    case 'classification': {
      const v = value as { architecture: string; protection_kind: string; floor_tranches: number; cap_tranches: number; protection_continues_below_lowest_strike: boolean };
      return [
        `- Shape: **${v.architecture.replace(/_/g, ' ')}**, downside built from **${v.protection_kind.replace(/_/g, ' ')}**.`,
        `- **${v.floor_tranches}** put tranches against **${v.cap_tranches}** call tranches.`,
        v.protection_continues_below_lowest_strike
          ? voice === 'plain'
            ? '- Below the lowest strike the puts keep paying, however far the index falls.'
            : '- Plain long puts: payoff continues indefinitely below the lowest strike.'
          : voice === 'plain'
            ? '- Below the lowest strike the puts stop paying and falls are felt in full again.'
            : '- Put spread: no floor below the lower strike; losses resume one-for-one on a shifted curve.',
      ];
    }
  }
}
