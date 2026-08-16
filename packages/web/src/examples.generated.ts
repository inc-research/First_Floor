// SPDX-License-Identifier: MIT

/**
 * GENERATED FILE — do not edit.
 *
 * Produced from `examples/*.json` by `scripts/generate-examples-module.mjs`.
 * Synthetic structures only; the repository ships no real product (D-31).
 */

export const exampleALadderedFloor = {
  "schema_version": "0.2.0",
  "as_of": "2026-08-14",
  "label": "Synthetic example A — laddered floor, basket held asset, proxy-ETF puts",
  "currency": "USD",
  "underlyings": {
    "REF": {
      "level": 7748.5,
      "level_source": "solved_from_options",
      "ratio_to_reference": 1,
      "dividend_yield": 0.012,
      "exercise_style": "european",
      "settlement": "cash"
    },
    "PXY": {
      "level": 774.85,
      "level_source": "observed_close",
      "ratio_to_reference": 0.1,
      "tracking_error_bps_annual": 4,
      "dividend_yield": 0.012,
      "exercise_style": "american",
      "settlement": "physical"
    }
  },
  "reference_id": "REF",
  "held_asset": {
    "kind": "basket",
    "weight": 0.981,
    "dividend_yield": 0.0104,
    "response": {
      "beta_down": 1,
      "beta_up": 1,
      "idio_vol_annual": 0.035,
      "source": "assumed"
    },
    "constituents": [
      {
        "weight": 0.082,
        "sector": "Information Technology",
        "name": "NAME-001"
      },
      {
        "weight": 0.071,
        "sector": "Information Technology",
        "name": "NAME-002"
      },
      {
        "weight": 0.055,
        "sector": "Communication Services",
        "name": "NAME-003"
      },
      {
        "weight": 0.041,
        "sector": "Consumer Discretionary",
        "name": "NAME-004"
      },
      {
        "weight": 0.038,
        "sector": "Financials",
        "name": "NAME-005"
      },
      {
        "weight": 0.713,
        "sector": "Various — 178 further names collapsed for this example",
        "name": "NAME-006"
      }
    ]
  },
  "option_legs": [
    {
      "leg_id": "P1",
      "underlying_id": "PXY",
      "right": "put",
      "position": "long",
      "strike": 584,
      "expiry": "2027-03-31",
      "contracts": 6835,
      "multiplier": 100,
      "mark_per_unit": 5.9,
      "role": "floor"
    },
    {
      "leg_id": "P2",
      "underlying_id": "PXY",
      "right": "put",
      "position": "long",
      "strike": 598,
      "expiry": "2026-09-30",
      "contracts": 6835,
      "multiplier": 100,
      "mark_per_unit": 0.51,
      "role": "floor"
    },
    {
      "leg_id": "P3",
      "underlying_id": "PXY",
      "right": "put",
      "position": "long",
      "strike": 615,
      "expiry": "2026-12-31",
      "contracts": 6835,
      "multiplier": 100,
      "mark_per_unit": 3.98,
      "role": "floor"
    },
    {
      "leg_id": "P4",
      "underlying_id": "PXY",
      "right": "put",
      "position": "long",
      "strike": 672,
      "expiry": "2027-06-30",
      "contracts": 6835,
      "multiplier": 100,
      "mark_per_unit": 18.01,
      "role": "floor"
    },
    {
      "leg_id": "C1",
      "underlying_id": "REF",
      "right": "call",
      "position": "short",
      "strike": 7725,
      "expiry": "2026-08-19",
      "contracts": 909,
      "multiplier": 100,
      "mark_per_unit": 78.4,
      "role": "cap"
    },
    {
      "leg_id": "C2",
      "underlying_id": "REF",
      "right": "call",
      "position": "short",
      "strike": 7800,
      "expiry": "2026-08-24",
      "contracts": 909,
      "multiplier": 100,
      "mark_per_unit": 42.15,
      "role": "cap"
    },
    {
      "leg_id": "C3",
      "underlying_id": "REF",
      "right": "call",
      "position": "short",
      "strike": 7875,
      "expiry": "2026-08-28",
      "contracts": 909,
      "multiplier": 100,
      "mark_per_unit": 21.6,
      "role": "cap"
    }
  ],
  "capital": {
    "net_assets": 2160730000,
    "units_outstanding": 62500000,
    "cash_weight": 0.016,
    "expense_ratio": 0.0089
  },
  "market": {
    "risk_free_rate": 0.042,
    "day_count": "act/365"
  },
  "provenance": {
    "source": "hypothetical",
    "notes": "Numbers are invented to exercise the schema. Not a description of any real product."
  },
  "subject": {
    "ticker": "EXAMPLE-A",
    "issuer": "Not a real product",
    "note": "Invented figures. Subject fields are user-asserted and never used in computation."
  },
  "advertised": {
    "protection_pct": 0.1,
    "protection_kind": "floor",
    "source": "hypothetical fact sheet"
  }
} as const;

export const exampleCMinimalBuffer = {
  "schema_version": "0.2.0",
  "as_of": "2026-08-14",
  "label": "Synthetic Example C — defined-outcome buffer, typed by hand from a fact sheet",
  "underlyings": {
    "REF": {
      "level": 109.61,
      "level_source": "observed_close",
      "ratio_to_reference": 1
    }
  },
  "reference_id": "REF",
  "held_asset": {
    "kind": "none",
    "weight": 0
  },
  "option_legs": [
    {
      "leg_id": "SYN",
      "underlying_id": "REF",
      "right": "call",
      "position": "long",
      "strike": 0.94,
      "expiry": "2027-03-19",
      "contracts": 16104,
      "role": "synthetic_long"
    },
    {
      "leg_id": "BUF_L",
      "underlying_id": "REF",
      "right": "put",
      "position": "long",
      "strike": 93.59,
      "expiry": "2027-03-19",
      "contracts": 16104,
      "role": "buffer_long"
    },
    {
      "leg_id": "BUF_S",
      "underlying_id": "REF",
      "right": "put",
      "position": "short",
      "strike": 79.55,
      "expiry": "2027-03-19",
      "contracts": 16104,
      "role": "buffer_short"
    },
    {
      "leg_id": "CAP",
      "underlying_id": "REF",
      "right": "call",
      "position": "short",
      "strike": 108.4,
      "expiry": "2027-03-19",
      "contracts": 16104,
      "role": "cap"
    }
  ],
  "capital": {
    "net_assets": 164111128,
    "units_outstanding": 1610400,
    "expense_ratio": 0.0085
  },
  "provenance": {
    "source": "fact_sheet",
    "notes": "Everything above came from four strikes, one expiry, one level and a NAV. No holdings file involved."
  },
  "advertised": {
    "protection_pct": 0.15,
    "protection_kind": "buffer",
    "cap_pct": 0.1582,
    "outcome_period_end": "2027-03-19",
    "source": "hypothetical fact sheet"
  }
} as const;

export const exampleScenario = {
  "schema_version": "0.2.0",
  "vol_beta": 0.65,
  "held_asset_response": {
    "beta_down": 1,
    "beta_up": 1
  },
  "decline": {
    "total_move": -0.3,
    "horizon_days": 365,
    "include_call_overlay": false,
    "replacement": {
      "floor_strike_pct_of_spot": 0.9,
      "floor_tenor_days": 365,
      "floor_iv": 0.25
    }
  },
  "capture": {
    "horizon_days": 91,
    "reference_move": 0.152,
    "reference_vol": 0.16,
    "paths": 20000,
    "seed": 11,
    "tenor_grid_days": [
      14,
      30,
      91
    ],
    "delta_grid": [
      0.3,
      0.25,
      0.2
    ]
  },
  "sweep": {
    "parameter": "beta_down",
    "values": [
      1,
      1.1,
      1.2
    ]
  }
} as const;

export const scenarioMinimal = {
  "schema_version": "0.2.0",
  "vol_beta": 0.65
} as const;

export const referenceComposition = {
  "schema_version": "0.2.0",
  "as_of": "2026-08-14",
  "name": "Synthetic reference composition for example A",
  "source_note": "Invented figures. Not the composition of any real index. Constructed to exercise active share in both directions: NAME-006 appears in the held asset but not here, and NAME-007 and NAME-008 appear here but not in the held asset. Both one-sided cases are counted and reported, never dropped silently.",
  "constituents": [
    {
      "name": "NAME-001",
      "weight": 0.071,
      "sector": "Information Technology"
    },
    {
      "name": "NAME-002",
      "weight": 0.064,
      "sector": "Information Technology"
    },
    {
      "name": "NAME-003",
      "weight": 0.049,
      "sector": "Communication Services"
    },
    {
      "name": "NAME-004",
      "weight": 0.038,
      "sector": "Consumer Discretionary"
    },
    {
      "name": "NAME-005",
      "weight": 0.045,
      "sector": "Financials"
    },
    {
      "name": "NAME-007",
      "weight": 0.033,
      "sector": "Health Care"
    },
    {
      "name": "NAME-008",
      "weight": 0.7,
      "sector": "Various — further names collapsed for this example"
    }
  ]
} as const;

export const exampleHoldingsCsv = "Synthetic Holdings Export\nGenerated for testing. Not a real product.\nAs of,2026-08-14\n\nAccount,Symbol,Description,Asset Class,Quantity,Price,Market Value,Sector\nFUND-A,PXY   270331P00584000,PXY Mar 31 2027 584.00 Put,Option,6835,5.90,4032650.00,\nFUND-A,PXY   260930P00598000,PXY Sep 30 2026 598.00 Put,Option,6835,0.51,348585.00,\nFUND-A,PXY   261231P00615000,PXY Dec 31 2026 615.00 Put,Option,6835,3.98,2720330.00,\nFUND-A,PXY   270630P00672000,PXY Jun 30 2027 672.00 Put,Option,6835,18.01,12309835.00,\nFUND-A,REF   260819C07725000,REF Aug 19 2026 7725.00 Call,Option,-909,78.40,-7126560.00,\nFUND-A,REF   260824C07800000,REF Aug 24 2026 7800.00 Call,Option,-909,42.15,-3831435.00,\nFUND-A,REF   260828C07875000,REF Aug 28 2026 7875.00 Call,Option,-909,21.60,-1963440.00,\nFUND-A,NAME-001,Constituent One,Equity,1000000,177.19,177190000.00,Information Technology\nFUND-A,NAME-002,Constituent Two,Equity,900000,170.48,153432000.00,Information Technology\nFUND-A,NAME-003,Constituent Three,Equity,800000,148.55,118840000.00,Communication Services\nFUND-A,NAME-004,Constituent Four,Equity,700000,126.60,88620000.00,Consumer Discretionary\nFUND-A,NAME-005,Constituent Five,Equity,600000,136.86,82116000.00,Financials\nFUND-A,NAME-006,Constituent Six,Equity,5000000,308.14,1540700000.00,Various\nFUND-A,CASH,Cash and equivalents,Cash,,,34571680.00,\nFUND-B,REF   270319C00000940,REF Mar 19 2027 0.94 Call,Option,16104,,,\nFUND-B,REF   270319P00093590,REF Mar 19 2027 93.59 Put,Option,16104,,,\nFUND-B,REF   270319P00079550,REF Mar 19 2027 79.55 Put,Option,-16104,,,\nFUND-B,REF   270319C00108400,REF Mar 19 2027 108.40 Call,Option,-16104,,,\n";
