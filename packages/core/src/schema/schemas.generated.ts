// SPDX-License-Identifier: MIT

/**
 * GENERATED FILE — do not edit.
 *
 * Produced from `schemas/*.json` by `scripts/generate-schema-module.mjs`.
 * The JSON files are the contract; this module only makes them importable
 * from a package that does no I/O. `test/schema.test.ts` fails if the two
 * fall out of step.
 */

export const collaredStructureSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://first-floor.dev/schemas/0.2/collared_structure.schema.json",
  "title": "Collared structure",
  "description": "A normalized description of a collared equity structure as it stands on its as-of date. Describes today only: nothing forward-looking belongs here. Forward assumptions live in a scenario document (invariant 4, D-06). No field is required to identify a real product; `subject` and `advertised` are optional, user-asserted, and never enter a computation (D-02).",
  "type": "object",
  "required": [
    "schema_version",
    "as_of",
    "underlyings",
    "reference_id",
    "held_asset",
    "option_legs",
    "capital"
  ],
  "additionalProperties": false,
  "properties": {
    "schema_version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "Semantic version of this schema. Well-formedness only is checked here; compatibility is enforced by the reader so it can emit a useful message (invariant 5, D-21). Below 1.0 the MINOR component is the compatibility axis: a 0.2.x reader refuses 0.3.x.",
      "examples": [
        "0.2.0"
      ]
    },
    "as_of": {
      "$ref": "#/$defs/date",
      "description": "The date the position was true. Every report carries it in the header."
    },
    "label": {
      "type": "string",
      "description": "Free text for the user's own benefit. Never used in computation."
    },
    "currency": {
      "type": "string",
      "pattern": "^[A-Z]{3}$",
      "description": "ISO 4217 code. Reporting only; the engine is single-currency and does no conversion."
    },
    "reference_id": {
      "type": "string",
      "description": "Key into `underlyings` naming the index the structure is collared against. Every attachment and reference move is quoted against this underlying's level."
    },
    "underlyings": {
      "type": "object",
      "description": "Keyed dictionary; legs point at entries by key (D-07). Making this a dictionary rather than a field on each leg turns proxy-versus-reference basis into a declared fact rather than an accident.",
      "minProperties": 1,
      "additionalProperties": {
        "$ref": "#/$defs/underlying"
      }
    },
    "held_asset": {
      "$ref": "#/$defs/held_asset",
      "description": "Required. A structure with no held asset is encoded as `weight: 0` with `kind: \"none\"`, not by omitting this object."
    },
    "option_legs": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/option_leg"
      }
    },
    "capital": {
      "type": "object",
      "required": [
        "net_assets"
      ],
      "additionalProperties": false,
      "properties": {
        "net_assets": {
          "type": "number",
          "exclusiveMinimum": 0,
          "description": "NAV. Every notional in the report is divided by this."
        },
        "units_outstanding": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "cash_weight": {
          "type": "number",
          "default": 0,
          "description": "Cash as a fraction of NAV. Enters the weights reconciliation identity."
        },
        "expense_ratio": {
          "type": "number",
          "minimum": 0,
          "default": 0,
          "description": "Annual, as a fraction. Pro-rated in the gradual-decline path."
        }
      }
    },
    "market": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "risk_free_rate": {
          "type": "number",
          "default": 0.04,
          "description": "Continuous rate used for discounting and for implied-vol inversion. Defaults to 0.04 when absent, matching the oracle."
        },
        "day_count": {
          "type": "string",
          "enum": [
            "act/365"
          ],
          "default": "act/365",
          "description": "Time is act/365 from as_of to expiry. A leg expiring today has T = 0 and is worth its intrinsic value."
        }
      }
    },
    "provenance": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "source": {
          "type": "string",
          "enum": [
            "holdings_file",
            "fact_sheet",
            "hypothetical",
            "manual_entry"
          ]
        },
        "notes": {
          "type": "string"
        }
      }
    },
    "subject": {
      "type": "object",
      "description": "What the user asserts this document describes. Optional, user-supplied, and never read by any computation. The engine is blind (D-02).",
      "additionalProperties": false,
      "properties": {
        "ticker": {
          "type": "string"
        },
        "issuer": {
          "type": "string"
        },
        "note": {
          "type": "string"
        }
      }
    },
    "advertised": {
      "type": "object",
      "description": "What a fact sheet claims, recorded so the report can set it beside the computed figure. A claim about the document's subject, not an input to arithmetic.",
      "additionalProperties": false,
      "properties": {
        "protection_pct": {
          "type": "number",
          "minimum": 0
        },
        "protection_kind": {
          "type": "string",
          "enum": [
            "buffer",
            "floor",
            "none"
          ]
        },
        "cap_pct": {
          "type": "number"
        },
        "outcome_period_end": {
          "$ref": "#/$defs/date"
        },
        "source": {
          "type": "string"
        }
      }
    }
  },
  "$defs": {
    "date": {
      "type": "string",
      "format": "date",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "underlying": {
      "type": "object",
      "required": [
        "level"
      ],
      "additionalProperties": false,
      "properties": {
        "level": {
          "type": "number",
          "exclusiveMinimum": 0,
          "description": "Spot level in this underlying's own units. Strikes on legs pointing here are quoted in the same units."
        },
        "level_source": {
          "type": "string",
          "enum": [
            "observed_close",
            "solved_from_options",
            "user_supplied"
          ],
          "description": "Where the level came from. `solved_from_options` is gated by a residual diagnostic (spec section 10): above 5 index points the report requires a user-supplied level instead."
        },
        "ratio_to_reference": {
          "type": "number",
          "exclusiveMinimum": 0,
          "default": 1,
          "description": "Multiply a reference level by this to get this underlying's level. A tenth-scale proxy ETF is 0.1. Never compare a strike to the reference level without passing through it (spec section 0)."
        },
        "dividend_yield": {
          "type": "number",
          "default": 0,
          "description": "Continuous yield q, used in Black-Scholes and in delta."
        },
        "exercise_style": {
          "type": "string",
          "enum": [
            "european",
            "american"
          ]
        },
        "settlement": {
          "type": "string",
          "enum": [
            "cash",
            "physical"
          ]
        },
        "tracking_error_bps_annual": {
          "type": "number",
          "minimum": 0,
          "description": "Reporting only. Surfaces proxy basis; enters no computation in v1."
        }
      }
    },
    "held_asset": {
      "type": "object",
      "required": [
        "kind",
        "weight"
      ],
      "additionalProperties": false,
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "none",
            "basket",
            "reference_tracking_fund",
            "single_name"
          ],
          "description": "A hint that feeds classification alongside the constituent count. Architecture is derived, never trusted from this field alone."
        },
        "weight": {
          "type": "number",
          "minimum": 0,
          "description": "w_eq, the held asset as a fraction of NAV. Zero means there is no held asset, which blocks Lambda, concentration and active share (spec section 10)."
        },
        "dividend_yield": {
          "type": "number",
          "default": 0
        },
        "response": {
          "$ref": "#/$defs/held_asset_response",
          "description": "The held asset's response to the reference. Explicit object, never an implicit 1.0 (invariant 2, D-08). This is the assumption the headline result turns on."
        },
        "constituents": {
          "type": "array",
          "description": "Name, weight and sector only (D-11). Sufficient for concentration and a sector view; resist adding fields until a computation demands one.",
          "items": {
            "type": "object",
            "required": [
              "name",
              "weight"
            ],
            "additionalProperties": false,
            "properties": {
              "name": {
                "type": "string"
              },
              "weight": {
                "type": "number",
                "minimum": 0
              },
              "sector": {
                "type": "string"
              }
            }
          }
        }
      }
    },
    "held_asset_response": {
      "type": "object",
      "required": [
        "beta_down",
        "beta_up",
        "source"
      ],
      "additionalProperties": false,
      "properties": {
        "beta_down": {
          "type": "number",
          "description": "Held-asset move per unit of reference move when the reference falls. The floor is flat if and only if this equals Lambda."
        },
        "beta_up": {
          "type": "number",
          "description": "The same when the reference rises. Above the cap the sign of the residual term flips, so a high-beta held asset adds to return in a rally."
        },
        "source": {
          "type": "string",
          "enum": [
            "assumed",
            "user_supplied"
          ],
          "description": "Beta is an input, never an estimate (D-09). There is no `estimated` value here by design."
        },
        "idio_vol_annual": {
          "type": "number",
          "minimum": 0,
          "description": "Reporting only; enters no v1 computation."
        }
      }
    },
    "option_leg": {
      "type": "object",
      "required": [
        "leg_id",
        "underlying_id",
        "right",
        "position",
        "strike",
        "expiry",
        "contracts"
      ],
      "additionalProperties": false,
      "properties": {
        "leg_id": {
          "type": "string"
        },
        "underlying_id": {
          "type": "string",
          "description": "Key into `underlyings`. The reader rejects a leg naming an underlying that is not present."
        },
        "right": {
          "type": "string",
          "enum": [
            "call",
            "put"
          ]
        },
        "position": {
          "type": "string",
          "enum": [
            "long",
            "short"
          ],
          "description": "Direction lives here and only here. Never a sign on `contracts` (spec section 0)."
        },
        "strike": {
          "type": "number",
          "exclusiveMinimum": 0,
          "description": "Quoted in its own underlying's units, not the reference's."
        },
        "expiry": {
          "$ref": "#/$defs/date"
        },
        "contracts": {
          "type": "number",
          "exclusiveMinimum": 0,
          "description": "Always positive. A leg's units is contracts times multiplier."
        },
        "multiplier": {
          "type": "number",
          "exclusiveMinimum": 0,
          "default": 100
        },
        "mark_per_unit": {
          "type": "number",
          "minimum": 0,
          "description": "Price per unit. Absent on any leg, the weights reconciliation is not computable and returns null with a stated blocker rather than 0.0 (invariant 3, D-16)."
        },
        "implied_vol": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 5,
          "description": "Used directly when present. Otherwise inverted from `mark_per_unit` by bisection; where neither is present the scenario's fallback_iv is used and the leg is recorded as modelled rather than marked."
        },
        "role": {
          "type": "string",
          "enum": [
            "floor",
            "cap",
            "synthetic_long",
            "buffer_long",
            "buffer_short",
            "other"
          ],
          "description": "A user or adapter hint for display. Classification is derived from the legs themselves and never trusts this field (spec section 2)."
        }
      }
    }
  }
} as const;

export const scenarioSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://first-floor.dev/schemas/0.2/scenario.schema.json",
  "title": "Scenario",
  "description": "The forward-looking assumptions a report is computed under. Kept separate from the structure document so that a position never contains a claim about the future and a scenario can be swept without touching the position (D-06, invariant 4). Every figure the core returns carries the scenario that produced it (invariant 1).",
  "type": "object",
  "required": [
    "schema_version"
  ],
  "additionalProperties": false,
  "properties": {
    "schema_version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "examples": [
        "0.2.0"
      ]
    },
    "label": {
      "type": "string"
    },
    "vol_beta": {
      "type": "number",
      "minimum": 0,
      "default": 0.65,
      "description": "Volatility points added per unit of reference drawdown: 0.65 means +13 points at -20%. A reduced form whose virtue is legibility. It must be swept and never reported bare — the spread between 0 and 1.0 is over four percentage points at -20% on example A."
    },
    "fallback_iv": {
      "type": "number",
      "exclusiveMinimum": 0,
      "maximum": 5,
      "default": 0.2,
      "description": "Volatility for legs supplying neither a mark nor an implied vol. Using it is recorded: the report must be able to say which legs are marked and which are modelled. Defaults to 0.2, which is the constant the oracle applies."
    },
    "held_asset_response": {
      "type": "object",
      "additionalProperties": false,
      "description": "Overrides the structure's own held-asset response. Present by name, never by implicit default (invariant 2).",
      "properties": {
        "beta_down": {
          "type": "number"
        },
        "beta_up": {
          "type": "number"
        },
        "source": {
          "type": "string",
          "enum": [
            "assumed",
            "user_supplied"
          ]
        }
      }
    },
    "decline": {
      "type": "object",
      "additionalProperties": false,
      "description": "The gradual-decline path. A laddered floor performs worst not in a crash but in a slow grind, because each tranche expires while the market is still falling and is replaced below it. This is one hand-built path, not a distribution.",
      "properties": {
        "total_move": {
          "type": "number",
          "exclusiveMinimum": -1,
          "maximum": 0,
          "default": -0.3,
          "description": "Total reference move over the horizon, as a fraction."
        },
        "horizon_days": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "default": 365
        },
        "include_call_overlay": {
          "type": "boolean",
          "default": false,
          "description": "A monotone path is the best case for a call writer — no roll is ever assigned — so including the overlay flatters the result substantially. Excluded by default, and the choice is reported either way."
        },
        "replacement": {
          "type": "object",
          "additionalProperties": false,
          "description": "How an expiring floor tranche is replaced. Lives here rather than on the structure because it describes a forward assumption (D-12).",
          "properties": {
            "floor_strike_pct_of_spot": {
              "type": "number",
              "exclusiveMinimum": 0,
              "default": 0.9
            },
            "floor_tenor_days": {
              "type": "integer",
              "exclusiveMinimum": 0,
              "default": 365
            },
            "floor_iv": {
              "type": "number",
              "exclusiveMinimum": 0,
              "maximum": 5,
              "default": 0.25
            }
          }
        }
      }
    },
    "capture": {
      "type": "object",
      "additionalProperties": false,
      "description": "The upside-capture Monte Carlo. Computed once per report and not draggable (D-20).",
      "properties": {
        "tenor_grid_days": {
          "type": "array",
          "items": {
            "type": "integer",
            "exclusiveMinimum": 0
          },
          "default": [
            14,
            30,
            91
          ],
          "description": "Shorter tenors forfeit less in a trend, because each roll re-strikes from the new level. This is the opposite of what most readers expect and the grid exists to show it."
        },
        "delta_grid": {
          "type": "array",
          "items": {
            "type": "number",
            "exclusiveMinimum": 0,
            "exclusiveMaximum": 1
          },
          "default": [
            0.3,
            0.25,
            0.2
          ]
        },
        "horizon_days": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "default": 91
        },
        "reference_move": {
          "type": "number",
          "exclusiveMinimum": -1,
          "default": 0.152
        },
        "reference_vol": {
          "type": "number",
          "exclusiveMinimum": 0,
          "default": 0.16
        },
        "overwrite": {
          "type": "number",
          "minimum": 0,
          "description": "Overwritten notional as a fraction of NAV. Defaults to the structure's own observed short-call spot notional."
        },
        "band": {
          "type": "number",
          "exclusiveMinimum": 0,
          "default": 0.02,
          "description": "Capture is conditioned on paths finishing within this band of reference_move. Conditioning rather than taking a raw ratio: a ratio of two small numbers is unstable by construction as the denominator approaches zero. Below 50 conditioned paths the cell returns null."
        },
        "paths": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "default": 20000
        },
        "seed": {
          "type": "integer",
          "minimum": 0,
          "default": 11,
          "description": "Every Monte Carlo takes a seed and uses mulberry32 with the specified draw order. A figure that moves between runs is a bug (invariant 6, D-18)."
        }
      }
    },
    "sweep": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "parameter",
        "values"
      ],
      "description": "A sweep is a core function, not a UI behaviour (D-19). The web page renders the result as a slider; the MCP server returns it as a table.",
      "properties": {
        "parameter": {
          "type": "string",
          "enum": [
            "beta_down",
            "beta_up",
            "vol_beta",
            "reference_move"
          ],
          "description": "Closed-form parameters only. The capture Monte Carlo is not sweepable this way (D-20)."
        },
        "values": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "number"
          }
        }
      }
    }
  }
} as const;

export const referenceCompositionSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://first-floor.dev/schemas/0.2/reference_composition.schema.json",
  "title": "Reference composition",
  "description": "The reference index's constituent weights, supplied by the user. Optional; when absent the active-share section is omitted entirely rather than estimated (D-10). Index membership and weight differences are not knowable from a holdings file, and nothing here is hosted, bundled or updated.",
  "type": "object",
  "required": [
    "schema_version",
    "as_of",
    "source_note",
    "constituents"
  ],
  "additionalProperties": false,
  "properties": {
    "schema_version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "examples": [
        "0.2.0"
      ]
    },
    "as_of": {
      "type": "string",
      "format": "date",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
      "description": "Compared against the structure's as_of. A gap over 90 days blocks active share, with the gap stated, rather than joining quietly (spec section 10)."
    },
    "name": {
      "type": "string",
      "description": "Free text for the user's own benefit. Never used in computation."
    },
    "source_note": {
      "type": "string",
      "minLength": 1,
      "description": "Required, because one honesty requirement attaches to every composition file: a composition sourced from a tracking fund's published holdings is that fund's holdings, not the index. Saying so is not optional, so the field is not optional."
    },
    "constituents": {
      "type": "array",
      "minItems": 1,
      "description": "Names present on one side only are counted and reported, never dropped silently.",
      "items": {
        "type": "object",
        "required": [
          "name",
          "weight"
        ],
        "additionalProperties": false,
        "properties": {
          "name": {
            "type": "string",
            "description": "Matched against held-asset constituent names. Name coverage is reported alongside active share."
          },
          "weight": {
            "type": "number",
            "minimum": 0
          },
          "sector": {
            "type": "string"
          }
        }
      }
    }
  }
} as const;
