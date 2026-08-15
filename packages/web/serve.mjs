// SPDX-License-Identifier: MIT

/**
 * A static file server for `dist/`, for looking at the page during development.
 *
 * It is not part of the product. The built page is three files that work from a
 * folder over `file://`, and there is deliberately nothing to deploy: no
 * backend, no API, no uptime obligation (§2 of the brief, D-22). This exists
 * because a browser's developer tools are easier to use over http.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('dist/', import.meta.url));
const PORT = Number(process.env['PORT'] ?? 8173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  const requested = (req.url ?? '/').split('?')[0] ?? '/';
  const relative = normalize(requested === '/' ? 'index.html' : requested.slice(1));
  if (relative.startsWith('..')) {
    res.writeHead(403).end('no');
    return;
  }
  try {
    const body = await readFile(join(DIST, relative));
    res.writeHead(200, {
      'content-type': TYPES[extname(relative)] ?? 'application/octet-stream',
      // The page makes no network calls; this makes that the browser's rule too.
      'content-security-policy':
        "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self'; img-src data:; connect-src 'none'",
    }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => {
  console.log(`  http://localhost:${PORT}  (serving ${DIST})`);
  console.log('  dist/index.html also opens directly from the filesystem.\n');
});
