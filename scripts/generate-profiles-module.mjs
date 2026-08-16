// SPDX-License-Identifier: MIT

/**
 * Generates `packages/core/src/adapters/profiles.generated.ts` from
 * `examples/mapping_*.json`.
 *
 * The mappings are the canonical thing: they are data a user can read, edit,
 * save and pass on, and teaching the page a new issuer's export is one of these
 * files rather than a patch (D-41). But `packages/core` does no I/O and a
 * browser bundle cannot read a file off disk, so both surfaces reach them
 * through a module.
 *
 * They live in core rather than in either surface because the page and the MCP
 * server have to recognise a file identically or they have diverged, which is
 * the reason both call into core instead of doing this themselves.
 *
 * Copying invites drift, so `test/recognise.test.ts` regenerates this module
 * and fails if the checked-in copy differs. Edit the JSON, then re-run:
 *
 *   node scripts/generate-profiles-module.mjs
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);

/** Every mapping in `examples/`, in name order so the output is stable. */
function mappingFiles() {
  return readdirSync(fileURLToPath(new URL('examples/', ROOT)))
    .filter((f) => f.startsWith('mapping_') && f.endsWith('.json'))
    .sort();
}

export function render() {
  const mappings = mappingFiles().map((file) =>
    JSON.parse(readFileSync(new URL(`examples/${file}`, ROOT), 'utf8')),
  );

  return [
    '// SPDX-License-Identifier: MIT',
    '',
    '/**',
    ' * GENERATED FILE — do not edit.',
    ' *',
    ' * Produced from `examples/mapping_*.json` by',
    ' * `scripts/generate-profiles-module.mjs`. The JSON files are canonical;',
    ' * this module only makes them importable from a package that does no I/O.',
    ' * `test/recognise.test.ts` fails if the two fall out of step.',
    ' */',
    '',
    "import type { ColumnMapping } from './mapping.ts';",
    '',
    '/**',
    ' * The mappings the page offers and the recogniser scores. Those carrying a',
    ' * `match` block are recognised from an issuer export outright; the rest are',
    ' * shapes a file is scored against.',
    ' */',
    `export const SHIPPED_MAPPINGS: readonly ColumnMapping[] = ${JSON.stringify(mappings, null, 2)};`,
    '',
  ].join('\n');
}

const OUT = new URL('packages/core/src/adapters/profiles.generated.ts', ROOT);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, render());
  console.log(`wrote ${fileURLToPath(OUT)}`);
}
