// SPDX-License-Identifier: MIT

/**
 * TypeScript types for the three documents in `schemas/`.
 *
 * Hand-written rather than generated, because the schemas carry documentation
 * that a generator would flatten and because there are only three of them. The
 * schemas remain the contract: when these types and a schema disagree, the
 * schema wins and this file is the defect.
 */

export type Right = 'call' | 'put';
export type Position = 'long' | 'short';

export type HeldAssetKind = 'none' | 'basket' | 'reference_tracking_fund' | 'single_name';

export type LegRole =
  | 'floor'
  | 'cap'
  | 'synthetic_long'
  | 'buffer_long'
  | 'buffer_short'
  | 'other';

export interface Underlying {
  level: number;
  level_source?: 'observed_close' | 'solved_from_options' | 'user_supplied';
  /** Multiply a reference level by this to get this underlying's level. */
  ratio_to_reference?: number;
  dividend_yield?: number;
  exercise_style?: 'european' | 'american';
  settlement?: 'cash' | 'physical';
  tracking_error_bps_annual?: number;
}

export interface Constituent {
  name: string;
  weight: number;
  sector?: string;
}

/**
 * The held asset's response to the reference.
 *
 * Never optional at the point of use and never defaulted implicitly: code that
 * wants unit-beta behaviour asks for it by name (invariant 2, D-08). This is the
 * single assumption the headline result turns on.
 */
export interface HeldAssetResponse {
  beta_down: number;
  beta_up: number;
  source: 'assumed' | 'user_supplied';
  idio_vol_annual?: number;
}

export interface HeldAsset {
  kind: HeldAssetKind;
  /** w_eq. Zero means there is no held asset; it is not encoded by omission. */
  weight: number;
  dividend_yield?: number;
  response?: HeldAssetResponse;
  constituents?: Constituent[];
}

export interface OptionLeg {
  leg_id: string;
  underlying_id: string;
  right: Right;
  /** Direction lives here and only here; `contracts` is always positive. */
  position: Position;
  /** Quoted in its own underlying's units, not the reference's. */
  strike: number;
  expiry: string;
  contracts: number;
  multiplier?: number;
  mark_per_unit?: number;
  implied_vol?: number;
  /** A display hint. Classification never trusts it. */
  role?: LegRole;
}

export interface Capital {
  net_assets: number;
  units_outstanding?: number;
  cash_weight?: number;
  expense_ratio?: number;
}

export interface CollaredStructure {
  schema_version: string;
  as_of: string;
  label?: string;
  currency?: string;
  reference_id: string;
  underlyings: Record<string, Underlying>;
  held_asset: HeldAsset;
  option_legs: OptionLeg[];
  capital: Capital;
  market?: { risk_free_rate?: number; day_count?: 'act/365' };
  provenance?: { source?: string; notes?: string };
  /** User-asserted. Never read by any computation. The engine is blind. */
  subject?: { ticker?: string; issuer?: string; note?: string };
  advertised?: {
    protection_pct?: number;
    protection_kind?: 'buffer' | 'floor' | 'none';
    cap_pct?: number;
    outcome_period_end?: string;
    source?: string;
  };
}

export interface DeclineScenario {
  total_move?: number;
  horizon_days?: number;
  include_call_overlay?: boolean;
  replacement?: {
    floor_strike_pct_of_spot?: number;
    floor_tenor_days?: number;
    floor_iv?: number;
  };
}

export interface CaptureScenario {
  tenor_grid_days?: number[];
  delta_grid?: number[];
  horizon_days?: number;
  reference_move?: number;
  reference_vol?: number;
  overwrite?: number;
  band?: number;
  paths?: number;
  seed?: number;
}

export interface Scenario {
  schema_version: string;
  label?: string;
  vol_beta?: number;
  fallback_iv?: number;
  held_asset_response?: Partial<HeldAssetResponse>;
  decline?: DeclineScenario;
  capture?: CaptureScenario;
  sweep?: {
    parameter: 'beta_down' | 'beta_up' | 'vol_beta' | 'reference_move';
    values: number[];
  };
}

export interface ReferenceComposition {
  schema_version: string;
  as_of: string;
  name?: string;
  /** Required by the schema: a composition's provenance caveat is not optional. */
  source_note: string;
  constituents: Constituent[];
}

export type DocumentKind = 'collared_structure' | 'scenario' | 'reference_composition';
