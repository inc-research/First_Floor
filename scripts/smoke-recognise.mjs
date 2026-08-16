// SPDX-License-Identifier: MIT

/**
 * Run format recognition over a folder of real issuer exports.
 *
 * Not part of `npm test`, and deliberately so. The repository ships synthetic
 * examples only (D-31), so the tests run against look-alike fixtures in
 * `examples/` and this script exists for the developer who has the real files
 * on disk and wants to know whether a profile still fits them.
 *
 *   node scripts/smoke-recognise.mjs [folder]
 *
 * Defaults to `template_input_csv_set/`, and says so and exits quietly when the
 * folder is not there.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyMapping,
  recogniseFormat,
  rootsFor,
  SHIPPED_MAPPINGS,
  statedNetAssetsFor,
} from '../packages/core/src/index.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const folder = process.argv[2] ?? join(ROOT, 'template_input_csv_set');

if (!existsSync(folder)) {
  console.log(`No ${folder} on this machine — nothing to smoke-test.`);
  process.exit(0);
}

const files = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
let recognised = 0;

for (const name of files) {
  const text = readFileSync(join(folder, name), 'utf8');
  const hit = recogniseFormat({ text, filename: name }, SHIPPED_MAPPINGS);
  console.log(`\n${name}`);
  if (!hit) {
    console.log('  not recognised');
    continue;
  }
  recognised++;
  const file = applyMapping(text, hit.mapping);
  const account = file.accounts.length === 1 ? file.accounts[0] : null;
  console.log(`  ${hit.mapping.name}  (confidence ${hit.confidence.toFixed(2)})`);
  console.log(`  header row ${hit.mapping.header_row}  ·  ${hit.evidence.join('; ')}`);
  if (hit.hints.ticker) console.log(`  ticker ${hit.hints.ticker}`);
  if (hit.hints.as_of) console.log(`  as of ${hit.hints.as_of}`);
  console.log(
    `  options ${file.counts.option}  holdings ${file.counts.equity}  cash ${file.counts.cash}  ` +
      `unreadable ${file.counts.unreadable}`,
  );
  console.log(`  accounts ${file.accounts.length}  roots ${rootsFor(file, account).join(', ') || '—'}`);
  const stated = statedNetAssetsFor(file, account);
  if (stated !== null) console.log(`  net assets stated: ${stated.toLocaleString('en-US')}`);
  const first = file.rows.find((r) => r.option);
  if (first) {
    const o = first.option;
    console.log(
      `  first contract: ${o.root} ${o.position} ${o.right} ${o.strike} ${o.expiry}` +
        `${o.expiryInferred ? ' (day inferred)' : ''} ×${o.contracts}`,
    );
  }
}

console.log(`\n${recognised} of ${files.length} recognised.`);
