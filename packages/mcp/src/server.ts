#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * The First Floor MCP server.
 *
 * Runs locally over stdio and is never hosted (D-15). A hosted endpoint would
 * reintroduce the uptime obligation the whole design avoids, and would mean
 * holdings data leaving the machine it was read on. Local stdio has neither
 * problem: this process makes no network calls, keeps no state between calls,
 * writes no files and reports no telemetry.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  mapCsvTool,
  reportTool,
  summariseTool,
  sweepTool,
  validateDocumentTool,
  type ToolResult,
} from './tools.ts';

const server = new McpServer({ name: 'first-floor', version: '0.2.0' });

const wrap = (result: ToolResult) => ({
  content: [{ type: 'text' as const, text: result.text }],
  ...(result.isError ? { isError: true } : {}),
});

server.registerTool(
  'validate_document',
  {
    title: 'Validate a First Floor document',
    description:
      'Check a collared structure, a scenario or a reference composition against its JSON Schema. ' +
      'Reports what is wrong by field. Unknown schema versions are refused rather than guessed at.',
    inputSchema: {
      kind: z.enum(['collared_structure', 'scenario', 'reference_composition']),
      document: z.unknown(),
    },
  },
  (args) => wrap(validateDocumentTool(args as never)),
);

server.registerTool(
  'report',
  {
    title: 'Report on a collared structure',
    description:
      'The full v1 report as Markdown: classification, the advertised figure beside the computed ' +
      'one, the terminal floor, the beta-conditional table, mark-to-market across a volatility ' +
      'sweep, the gradual decline, positioning, reset cadence, upside capture, concentration and ' +
      'active share. Every figure carries the assumptions that produced it. Measurement, not ' +
      'forecast; no recommendations.',
    inputSchema: {
      structure: z.unknown().describe('A collared_structure document.'),
      scenario: z.unknown().optional().describe('A scenario document. Defaults are used when omitted.'),
      composition: z.unknown().optional().describe('An optional reference_composition, for active share.'),
      voice: z.enum(['plain', 'technical']).optional().describe('Defaults to plain.'),
    },
  },
  (args) => wrap(reportTool(args as never)),
);

server.registerTool(
  'sweep',
  {
    title: 'Sweep one assumption',
    description:
      'Vary beta_down, beta_up, vol_beta or the reference move and return a table. These four are ' +
      'inputs rather than measurements — nothing in a holdings file records them — which is why they ' +
      'are swept rather than estimated. The upside-capture grid is Monte Carlo and is not sweepable ' +
      'this way.',
    inputSchema: {
      structure: z.unknown(),
      scenario: z.unknown().optional(),
      parameter: z.enum(['beta_down', 'beta_up', 'vol_beta', 'reference_move']),
      values: z.array(z.number()).min(1),
      reference_move: z.number().optional().describe('Where the closed-form figures are quoted.'),
    },
  },
  (args) => wrap(sweepTool(args as never)),
);

server.registerTool(
  'map_holdings_csv',
  {
    title: 'Map a holdings CSV to a structure document',
    description:
      'Apply a column mapping to any holdings CSV. Called without a mapping it recognises the file ' +
      'against the shipped issuer profiles, the same way the page does. Called without a synthesis ' +
      'block it reports the accounts, option roots and row counts it found; called with one it ' +
      'returns a draft structure document. Underlying levels are never guessed at, because a ' +
      'holdings file does not record them.',
    inputSchema: {
      csv: z.string().describe('The file contents. Nothing is read from disk by this server.'),
      mapping: z
        .unknown()
        .optional()
        .describe('A column mapping document. Omit to have the file recognised from its own shape.'),
      filename: z
        .string()
        .optional()
        .describe('The file’s name as downloaded. Helps recognition; never required.'),
      synthesis: z
        .object({
          as_of: z.string().optional(),
          reference_id: z.string().optional(),
          levels: z.record(z.string(), z.number()).optional(),
          ratios: z.record(z.string(), z.number()).optional(),
          net_assets: z.number().optional(),
          account: z.string().nullable().optional(),
          label: z.string().optional(),
        })
        .optional(),
    },
  },
  (args) => wrap(mapCsvTool(args as never)),
);

server.registerTool(
  'summarise',
  {
    title: 'Which figures are available for this position',
    description:
      'Lists each metric as computed or not shown, with the reason. Useful for finding out what a ' +
      'partial holdings file supports before asking for the whole report.',
    inputSchema: { structure: z.unknown(), scenario: z.unknown().optional() },
  },
  (args) => wrap(summariseTool(args as never)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
