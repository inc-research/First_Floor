// SPDX-License-Identifier: MIT

/**
 * GENERATED FILE — do not edit.
 *
 * Produced from `examples/mapping_*.json` by
 * `scripts/generate-profiles-module.mjs`. The JSON files are canonical;
 * this module only makes them importable from a package that does no I/O.
 * `test/recognise.test.ts` fails if the two fall out of step.
 */

import type { ColumnMapping } from './mapping.ts';

/**
 * The mappings the page offers and the recogniser scores. Those carrying a
 * `match` block are recognised from an issuer export outright; the rest are
 * shapes a file is scored against.
 */
export const SHIPPED_MAPPINGS: readonly ColumnMapping[] = [
  {
    "schema_version": "0.2.0",
    "name": "A file that already breaks options into their own columns",
    "option_name_format": "explicit_columns",
    "columns": {
      "identifier": "Underlying",
      "asset_class": "Type",
      "right": "Call/Put",
      "strike": "Strike",
      "expiry": "Expiration",
      "position": "Side",
      "quantity": "Contracts",
      "multiplier": "Multiplier",
      "price": "Mark",
      "market_value": "Value"
    },
    "option_markers": [
      "option"
    ],
    "cash_markers": [
      "cash"
    ]
  },
  {
    "schema_version": "0.2.0",
    "name": "iShares fund holdings export",
    "header_row": 9,
    "option_name_format": "month_at",
    "expiry_day": "last_business_day",
    "option_identifier": "Name",
    "match": {
      "filename": "^(?<ticker>[A-Za-z0-9]{2,6})_holdings\\.csv$",
      "headers": [
        "Ticker",
        "Name",
        "Type",
        "Sector",
        "Asset Class",
        "Market Value",
        "Weight (%)",
        "Notional Value",
        "Shares",
        "Price",
        "Exchange",
        "Currency"
      ],
      "preamble": [
        "Fund Holdings as of",
        "Shares Outstanding",
        "Inception Date"
      ]
    },
    "columns": {
      "identifier": "Ticker",
      "name": "Name",
      "asset_class": "Asset Class",
      "quantity": "Shares",
      "price": "Price",
      "market_value": "Market Value",
      "sector": "Sector"
    },
    "option_markers": [
      "option",
      "derivative"
    ],
    "cash_markers": [
      "cash",
      "money market"
    ]
  },
  {
    "schema_version": "0.2.0",
    "name": "J.P. Morgan ETF holdings export",
    "option_name_format": "explicit_columns",
    "root_token": "first",
    "option_identifier": "Security Description",
    "match": {
      "filename": "^JPMorgan-.*Holdings.*\\.csv$",
      "headers": [
        "Ticker",
        "Security Description",
        "Security Type",
        "Method",
        "Shares/Par",
        "Market Value (USD)",
        "Country",
        "Currency",
        "Sector",
        "Industry",
        "Coupon",
        "Maturity Date",
        "Contract Size",
        "Strike Price",
        "% of Net Assets"
      ]
    },
    "columns": {
      "identifier": "Ticker",
      "name": "Security Description",
      "asset_class": "Security Type",
      "quantity": "Shares/Par",
      "market_value": "Market Value (USD)",
      "sector": "Sector",
      "right": "Security Type",
      "strike": "Strike Price",
      "expiry": "Maturity Date",
      "multiplier": "Contract Size"
    },
    "option_markers": [
      "option"
    ],
    "cash_markers": [
      "money market",
      "currencies"
    ]
  },
  {
    "schema_version": "0.2.0",
    "name": "Daily holdings file covering a whole fund family",
    "header_row": 0,
    "option_name_format": "spaced",
    "account_column": "Account",
    "option_identifier": "SecurityName",
    "net_assets_column": "NetAssets",
    "as_of_column": "Date",
    "match": {
      "filename": "_holdings\\.csv$",
      "headers": [
        "Date",
        "Account",
        "StockTicker",
        "CUSIP",
        "SecurityName",
        "Shares",
        "Price",
        "MarketValue",
        "Weightings",
        "NetAssets",
        "SharesOutstanding",
        "CreationUnits",
        "MoneyMarketFlag"
      ]
    },
    "columns": {
      "identifier": "StockTicker",
      "name": "SecurityName",
      "asset_class": "MoneyMarketFlag",
      "quantity": "Shares",
      "price": "Price",
      "market_value": "MarketValue"
    },
    "option_markers": [],
    "cash_markers": [
      "y"
    ]
  },
  {
    "schema_version": "0.2.0",
    "name": "Long-form holdings with OCC identifiers",
    "header_row": 4,
    "account_column": "Account",
    "option_name_format": "occ21",
    "columns": {
      "identifier": "Symbol",
      "name": "Description",
      "asset_class": "Asset Class",
      "quantity": "Quantity",
      "price": "Price",
      "market_value": "Market Value",
      "sector": "Sector"
    },
    "option_markers": [
      "option"
    ],
    "cash_markers": [
      "cash"
    ]
  },
  {
    "schema_version": "0.2.0",
    "name": "Same file, reading the written description instead of the OCC symbol",
    "header_row": 4,
    "account_column": "Account",
    "option_name_format": "spaced",
    "columns": {
      "identifier": "Description",
      "name": "Description",
      "asset_class": "Asset Class",
      "quantity": "Quantity",
      "price": "Price",
      "market_value": "Market Value",
      "sector": "Sector"
    },
    "option_markers": [
      "option"
    ],
    "cash_markers": [
      "cash"
    ]
  }
];
