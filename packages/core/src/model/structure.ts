// SPDX-License-Identifier: MIT

import { impliedVol, type IvBlocker } from '../pricing/impliedVol.ts';
import type { CollaredStructure, HeldAssetResponse, Right, Scenario } from '../schema/types.ts';

/** The oracle's default when a structure supplies no `market.risk_free_rate`. */
export const DEFAULT_RISK_FREE_RATE = 0.04;
/** The oracle's default contract multiplier. */
export const DEFAULT_MULTIPLIER = 100;
/**
 * The volatility used for a leg carrying neither a mark nor a stated implied
 * vol. Matches the constant hardcoded in `reference/oracle.py`, but here it is
 * a named default that a scenario can override and whose use is always recorded
 * — see `PreparedLeg.ivSource`.
 */
export const DEFAULT_FALLBACK_IV = 0.2;

const MS_PER_DAY = 86_400_000;

/**
 * Whole days between two ISO dates, act/365. Spec section 0.
 *
 * Parsed as UTC on purpose. `new Date('2026-08-14')` is already UTC-midnight,
 * but arithmetic on local-time Dates drifts by an hour across a DST boundary,
 * which silently turns a 229-day tenor into 228.9583 and moves every figure
 * that depends on it.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new RangeError(`unparseable date: ${fromIso} or ${toIso}`);
  }
  return (to - from) / MS_PER_DAY;
}

export type IvSource = 'stated' | 'inverted' | 'fallback';

export interface PreparedLeg {
  id: string;
  right: Right;
  /** +1 long, -1 short. Direction never rides on a sign in `contracts`. */
  sign: 1 | -1;
  /** Strike, in its own underlying's units. */
  K: number;
  /** Years to expiry, act/365. Zero for a leg expiring today. */
  T: number;
  /** contracts * multiplier. */
  units: number;
  /** This leg's underlying's spot level. */
  S0: number;
  q: number;
  ratio: number;
  underlyingId: string;
  mark: number | null;
  /** The volatility actually used, whatever its provenance. */
  iv: number;
  ivSource: IvSource;
  /** Non-null when the inversion produced a number that should not be trusted. */
  ivBlocker: IvBlocker | null;
}

export interface PreparedStructure {
  doc: CollaredStructure;
  asOf: string;
  referenceId: string;
  referenceLevel: number;
  nav: number;
  cashWeight: number;
  expenseRatio: number;
  /** w_eq. Zero means no held asset. */
  wEq: number;
  heldAssetKind: CollaredStructure['held_asset']['kind'];
  r: number;
  legs: PreparedLeg[];
  /** The response actually in force, and where it came from. Never implicit. */
  response: HeldAssetResponse;
  fallbackIv: number;
}

export function longPuts(s: PreparedStructure): PreparedLeg[] {
  return s.legs.filter((l) => l.right === 'put' && l.sign > 0);
}

export function shortPuts(s: PreparedStructure): PreparedLeg[] {
  return s.legs.filter((l) => l.right === 'put' && l.sign < 0);
}

export function shortCalls(s: PreparedStructure): PreparedLeg[] {
  return s.legs.filter((l) => l.right === 'call' && l.sign < 0);
}

/**
 * Long calls struck near zero. Spec section 2: such a call is a stock
 * substitute, not optionality — the convention is a strike near 1% of the
 * reference level, and its delta is e^(-qT), so the entire shortfall from 1.0
 * is forgone dividends rather than moneyness.
 */
export function syntheticLongs(s: PreparedStructure): PreparedLeg[] {
  return s.legs.filter(
    (l) => l.right === 'call' && l.sign > 0 && l.K < 0.05 * s.referenceLevel * l.ratio,
  );
}

/**
 * Resolve a structure document and a scenario into the form every analytic
 * reads, inverting implied volatilities on the way.
 *
 * The held-asset response is resolved here, once, and it is always present in
 * the result. There is no path from a structure document to a downside figure
 * that does not pass through an explicit `beta_down`, `beta_up` and `source`
 * (invariant 2, D-08). Where neither the scenario nor the structure states one,
 * the source is recorded as `assumed` rather than the value quietly becoming
 * 1.0 with no trace.
 */
export function prepareStructure(
  doc: CollaredStructure,
  scenario?: Scenario,
): PreparedStructure {
  const r = doc.market?.risk_free_rate ?? DEFAULT_RISK_FREE_RATE;
  const fallbackIv = scenario?.fallback_iv ?? DEFAULT_FALLBACK_IV;
  const reference = doc.underlyings[doc.reference_id];
  if (!reference) {
    throw new RangeError(
      `reference_id "${doc.reference_id}" is not a key of underlyings; validate the document first`,
    );
  }

  const legs: PreparedLeg[] = doc.option_legs.map((leg) => {
    const u = doc.underlyings[leg.underlying_id];
    if (!u) {
      throw new RangeError(
        `leg "${leg.leg_id}" names underlying "${leg.underlying_id}", which does not exist; validate the document first`,
      );
    }
    const T = daysBetween(doc.as_of, leg.expiry) / 365;
    const units = leg.contracts * (leg.multiplier ?? DEFAULT_MULTIPLIER);
    const q = u.dividend_yield ?? 0;
    const mark = leg.mark_per_unit ?? null;

    let iv: number;
    let ivSource: IvSource;
    let ivBlocker: IvBlocker | null = null;

    if (leg.implied_vol !== undefined) {
      iv = leg.implied_vol;
      ivSource = 'stated';
    } else if (mark !== null && T > 0) {
      const inverted = impliedVol(mark, u.level, leg.strike, T, r, q, leg.right);
      iv = inverted.sigma;
      ivSource = 'inverted';
      ivBlocker = inverted.blocker;
    } else {
      iv = fallbackIv;
      ivSource = 'fallback';
    }

    return {
      id: leg.leg_id,
      right: leg.right,
      sign: leg.position === 'long' ? 1 : -1,
      K: leg.strike,
      T,
      units,
      S0: u.level,
      q,
      ratio: u.ratio_to_reference ?? 1,
      underlyingId: leg.underlying_id,
      mark,
      iv,
      ivSource,
      ivBlocker,
    };
  });

  const fromScenario = scenario?.held_asset_response;
  const fromStructure = doc.held_asset.response;
  const response: HeldAssetResponse = {
    beta_down: fromScenario?.beta_down ?? fromStructure?.beta_down ?? 1.0,
    beta_up: fromScenario?.beta_up ?? fromStructure?.beta_up ?? 1.0,
    source: fromScenario?.source ?? fromStructure?.source ?? 'assumed',
  };

  return {
    doc,
    asOf: doc.as_of,
    referenceId: doc.reference_id,
    referenceLevel: reference.level,
    nav: doc.capital.net_assets,
    cashWeight: doc.capital.cash_weight ?? 0,
    expenseRatio: doc.capital.expense_ratio ?? 0,
    wEq: doc.held_asset.weight,
    heldAssetKind: doc.held_asset.kind,
    r,
    legs,
    response,
    fallbackIv,
  };
}
