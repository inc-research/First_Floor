// SPDX-License-Identifier: MIT

import { bs } from '../pricing/blackScholes.ts';
import { fsum } from '../pricing/sum.ts';
import { longPuts, type PreparedStructure } from '../model/structure.ts';
import type { DeclineScenario } from '../schema/types.ts';

export interface ReplacementPolicy {
  floor_strike_pct_of_spot: number;
  floor_tenor_days: number;
  floor_iv: number;
}

export const DEFAULT_REPLACEMENT: ReplacementPolicy = {
  floor_strike_pct_of_spot: 0.9,
  floor_tenor_days: 365,
  floor_iv: 0.25,
};

export interface GradualDecline {
  outcome: number;
  include_call_overlay: boolean;
  note: string;
}

/**
 * The gradual decline — the case the terminal floor hides. Spec section 7.
 *
 * A laddered floor performs worst not in a crash but in a slow grind, because
 * each tranche expires while the market is still falling and is replaced below
 * it. On example A, −30% over 365 days returns −22.31% against the same
 * structure's terminal floor of −20.30%, and that divergence is the point.
 *
 * The path is monotone:  S(t) = S₀·(1 + total_move)^(t / horizon_days)
 *
 * On each day, any floor tranche reaching expiry realises its intrinsic value
 * into cash and is replaced at `floor_strike_pct_of_spot × S(t)` with tenor
 * `floor_tenor_days`, funded from cash at `floor_iv`. Remaining live tranches
 * are marked at the horizon, and the pro-rated expense ratio comes off.
 *
 * **Two disclosures are mandatory on this figure**, which is why they are
 * fields on the result rather than prose someone might drop. A monotone path is
 * the *best* case for a call writer — no roll is ever assigned — so including
 * the call overlay flatters the result substantially; it is excluded by default
 * and the choice is reported either way. And this is one hand-built path, not a
 * distribution; the note says so.
 *
 * Replacement puts are priced at q = 0 rather than at the underlying's dividend
 * yield. That is a simplification in the oracle rather than a modelling claim
 * (erratum E-07).
 *
 * Accumulation follows the oracle exactly: sequential for the running equity
 * and cash balances, exact summation for the residual mark. See `geometry.ts`.
 */
export function gradualDecline(
  s: PreparedStructure,
  totalMove: number,
  horizonDays: number,
  replacement: Partial<ReplacementPolicy> = {},
  includeCalls = false,
): GradualDecline | null {
  const puts = longPuts(s);
  if (puts.length === 0) return null;

  const S0 = (puts[0] as { S0: number }).S0;
  const pct = replacement.floor_strike_pct_of_spot ?? DEFAULT_REPLACEMENT.floor_strike_pct_of_spot;
  const tenor = replacement.floor_tenor_days ?? DEFAULT_REPLACEMENT.floor_tenor_days;
  const riv = replacement.floor_iv ?? DEFAULT_REPLACEMENT.floor_iv;

  const live = puts.map((l) => ({ K: l.K, tDays: l.T * 365, units: l.units }));

  let eq = s.wEq;
  let cash = s.cashWeight;
  let S = S0;

  for (let day = 1; day <= horizonDays; day++) {
    const sNew = S0 * Math.pow(1.0 + totalMove, day / horizonDays);
    eq *= sNew / S;
    S = sNew;
    for (const p of live) {
      // Half-day window rather than equality: tranche lives are derived from
      // act/365 tenors and need not land exactly on an integer day.
      if (Math.abs(p.tDays - day) < 0.5) {
        cash += (p.units * Math.max(0, p.K - S)) / s.nav;
        p.K = pct * S;
        p.tDays = day + tenor;
        cash -= (p.units * bs(S, p.K, tenor / 365.0, s.r, 0.0, riv, 'put')) / s.nav;
      }
    }
  }

  const resid = fsum(
    live.map(
      (p) =>
        (p.units * bs(S, p.K, Math.max(0, p.tDays - horizonDays) / 365.0, s.r, 0.0, riv, 'put')) /
        s.nav,
    ),
  );

  const val = eq + cash + resid - (s.expenseRatio * horizonDays) / 365.0;

  return {
    outcome: val - 1.0,
    include_call_overlay: includeCalls,
    note: includeCalls ? 'monotone path' : 'monotone path; call overlay excluded',
  };
}

/** Run the decline a scenario document declares, if it declares one. */
export function gradualDeclineFromScenario(
  s: PreparedStructure,
  decline: DeclineScenario | undefined,
): GradualDecline | null {
  if (!decline) return null;
  return gradualDecline(
    s,
    decline.total_move ?? -0.3,
    decline.horizon_days ?? 365,
    decline.replacement ?? {},
    decline.include_call_overlay ?? false,
  );
}
