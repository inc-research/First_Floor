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
 *
 * **Fonts are embedded in the stylesheet, not linked.** A `<link>` to a font
 * host is a network call on every open, so the two faces are vendored in
 * `fonts/` and base64'd into `dist/styles.css` here. The same assertion is made
 * of the CSS as of the bundle: no `url()` that is not a `data:` URI.
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
    if (file === 'styles.css') continue; // Written below, with the faces in front of it.
    await copyFile(fileURLToPath(new URL(`public/${file}`, HERE)), `${DIST}${file}`);
  }

  const faces = await fontFaces();
  const css = faces.css + (await readFile(new URL('public/styles.css', HERE), 'utf8'));
  const linked = [...css.matchAll(/url\(\s*['"]?([^'")]+)/g)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith('data:'));
  if (linked.length > 0) {
    throw new Error(
      `Invariant 7 violated: the stylesheet fetches ${linked.join(', ')}. Fonts and images are ` +
        'embedded, because a page that promises nothing leaves the machine cannot ask a font host ' +
        'who is reading it.',
    );
  }
  await writeFile(`${DIST}styles.css`, css);

  const bytes = Buffer.byteLength(bundle);
  await writeFile(
    `${DIST}build-report.txt`,
    [
      `bundle bytes: ${bytes}`,
      `stylesheet bytes: ${Buffer.byteLength(css)} (of which fonts: ${faces.bytes} embedded)`,
      `fonts: ${faces.names.join(', ')}`,
      `network call sites: none (checked: ${FORBIDDEN.map(([n]) => n).join(', ')})`,
      `external stylesheet references: none`,
      `format: iife (works from file://)`,
      '',
    ].join('\n'),
  );

  console.log(`\n  ${(bytes / 1024).toFixed(0)} KB, no network call sites, loads from file://\n`);
  return result;
}

/**
 * `@font-face` blocks for everything in `fonts/`, with the woff2 inlined.
 *
 * The weight comes from the file name — `Arvo-700.woff2`, and
 * `Newsreader-200-800.woff2` for a variable face — so adding a weight is
 * dropping a file in, never editing this.
 */
async function fontFaces() {
  const dir = new URL('fonts/', HERE);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.woff2')).sort();
  const blocks = [];
  const names = [];
  let bytes = 0;

  for (const file of files) {
    const m = /^([A-Za-z]+)-(\d{3})(?:-(\d{3}))?\.woff2$/.exec(file);
    if (!m) throw new Error(`fonts/${file} is not named Family-Weight[-Weight].woff2`);
    const [, family, from, to] = m;
    const data = await readFile(new URL(file, dir));
    bytes += data.byteLength;
    names.push(`${family} ${to ? `${from}–${to}` : from}`);
    blocks.push(
      '@font-face {',
      `  font-family: '${family}';`,
      '  font-style: normal;',
      '  font-display: swap;',
      `  font-weight: ${to ? `${from} ${to}` : from};`,
      `  src: url(data:font/woff2;base64,${data.toString('base64')}) format('woff2');`,
      '}',
      '',
    );
  }

  return {
    css: ['/* Fonts embedded at build time. SIL OFL; see fonts/LICENSE-*.txt. */', '', ...blocks, '']
      .join('\n'),
    bytes,
    names,
  };
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
