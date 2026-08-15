// SPDX-License-Identifier: MIT

/**
 * Generates `packages/core/src/schema/schemas.generated.ts` from `schemas/*.json`.
 *
 * The canonical schemas are the JSON files: they are the published contract and
 * the thing a third-party reimplementation reads. But `packages/core` is
 * specified as pure functions with no I/O, and a browser bundle cannot read a
 * file off disk anyway, so the core needs them as a module.
 *
 * Copying invites drift, so `test/schema.test.ts` regenerates this module and
 * fails if the checked-in copy differs. Edit the JSON, then re-run:
 *
 *   node scripts/generate-schema-module.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);

const DOCS = [
  ['collaredStructureSchema', 'collared_structure.schema.json'],
  ['scenarioSchema', 'scenario.schema.json'],
  ['referenceCompositionSchema', 'reference_composition.schema.json'],
];

export function render() {
  const parts = [
    '// SPDX-License-Identifier: MIT',
    '',
    '/**',
    ' * GENERATED FILE — do not edit.',
    ' *',
    ' * Produced from `schemas/*.json` by `scripts/generate-schema-module.mjs`.',
    ' * The JSON files are the contract; this module only makes them importable',
    ' * from a package that does no I/O. `test/schema.test.ts` fails if the two',
    ' * fall out of step.',
    ' */',
    '',
  ];
  for (const [name, file] of DOCS) {
    const json = JSON.parse(readFileSync(new URL(`schemas/${file}`, ROOT), 'utf8'));
    parts.push(`export const ${name} = ${JSON.stringify(json, null, 2)} as const;`, '');
  }
  return parts.join('\n');
}

const OUT = new URL('packages/core/src/schema/schemas.generated.ts', ROOT);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, render());
  console.log(`wrote ${fileURLToPath(OUT)}`);
}
