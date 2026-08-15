// SPDX-License-Identifier: MIT

/**
 * Generates `packages/web/src/examples.generated.ts` from `examples/*.json`.
 *
 * The page ships worked examples so someone can see what a report looks like
 * before deciding whether to type their own position in. They are synthetic
 * only (D-31): the repository carries no claim about any real product, and the
 * engine never learns one.
 *
 * Same arrangement as the schema module: the JSON files are canonical and a
 * test regenerates this one and fails if it has drifted. Re-run with
 *
 *   node scripts/generate-examples-module.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);

const DOCS = [
  ['exampleALadderedFloor', 'example_a_laddered_floor.json'],
  ['exampleCMinimalBuffer', 'example_c_minimal_hand_typed.json'],
  ['exampleScenario', 'example_scenario.json'],
  ['scenarioMinimal', 'scenario_minimal.json'],
  ['referenceComposition', 'reference_composition_synthetic.json'],
];

export function render() {
  const parts = [
    '// SPDX-License-Identifier: MIT',
    '',
    '/**',
    ' * GENERATED FILE — do not edit.',
    ' *',
    ' * Produced from `examples/*.json` by `scripts/generate-examples-module.mjs`.',
    ' * Synthetic structures only; the repository ships no real product (D-31).',
    ' */',
    '',
  ];
  for (const [name, file] of DOCS) {
    const json = JSON.parse(readFileSync(new URL(`examples/${file}`, ROOT), 'utf8'));
    parts.push(`export const ${name} = ${JSON.stringify(json, null, 2)} as const;`, '');
  }
  return parts.join('\n');
}

const OUT = new URL('packages/web/src/examples.generated.ts', ROOT);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, render());
  console.log(`wrote ${fileURLToPath(OUT)}`);
}
