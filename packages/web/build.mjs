// SPDX-License-Identifier: MIT

/**
 * Builds the static page into `dist/`.
 *
 * Two choices here are not stylistic.
 *
 * **IIFE, not ESM.** The page has to work when someone downloads it and opens
 * it from their own disk. Browsers refuse ES module imports over `file://`, so
 * an ESM bundle would load from a server and silently fail from a folder — the
 * exact case a tool whose whole premise is "nothing leaves the machine" needs
 * to support.
 *
 * **The bundle is asserted to contain no network call sites.** Invariant 7 is
 * testable rather than aspirational, and this is where it gets tested. If a
 * dependency ever pulls in a fetch, the build fails rather than the promise.
 */

import { build } from 'esbuild';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const HERE = new URL('./', import.meta.url);
const DIST = fileURLToPath(new URL('dist/', HERE));

/**
 * Call sites that would let something leave the machine, plus dynamic import,
 * which could pull code in after load. Matched on the built bundle.
 */
const FORBIDDEN = [
  ['fetch(', /\bfetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['EventSource', /\bEventSource\b/],
  ['sendBeacon', /\bsendBeacon\b/],
  ['navigator.geolocation', /\bgeolocation\b/],
  ['dynamic import()', /\bimport\s*\(/],
  ['importScripts', /\bimportScripts\b/],
];

async function main() {
  await mkdir(DIST, { recursive: true });

  const result = await build({
    entryPoints: [fileURLToPath(new URL('src/main.ts', HERE))],
    bundle: true,
    format: 'iife',
    target: ['es2022'],
    platform: 'browser',
    outfile: `${DIST}app.js`,
    minify: process.env['FF_DEV'] !== '1',
    sourcemap: false,
    legalComments: 'inline',
    metafile: true,
    logLevel: 'info',
  });

  const bundle = await readFile(`${DIST}app.js`, 'utf8');
  const violations = FORBIDDEN.filter(([, pattern]) => pattern.test(bundle)).map(([name]) => name);
  if (violations.length > 0) {
    throw new Error(
      `Invariant 7 violated: the bundle contains ${violations.join(', ')}. ` +
        'Nothing may leave the machine, and no code may be loaded after page load.',
    );
  }

  for (const file of await readdir(new URL('public/', HERE))) {
    await copyFile(fileURLToPath(new URL(`public/${file}`, HERE)), `${DIST}${file}`);
  }

  const bytes = Buffer.byteLength(bundle);
  await writeFile(
    `${DIST}build-report.txt`,
    [
      `bundle bytes: ${bytes}`,
      `network call sites: none (checked: ${FORBIDDEN.map(([n]) => n).join(', ')})`,
      `format: iife (works from file://)`,
      '',
    ].join('\n'),
  );

  console.log(`\n  ${(bytes / 1024).toFixed(0)} KB, no network call sites, loads from file://\n`);
  return result;
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
