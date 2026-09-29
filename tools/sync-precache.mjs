/**
 * Keep sw.js's offline list in step with the files the game actually ships.
 *
 * PRECACHE is written by hand, and every new module has to be added to it or
 * the game half-works offline: the self-test's "every module the game loaded
 * is in the offline cache" check catches it, but only after the fact. Twelve
 * teams building the wishlist at once each reported the same chore, "the
 * integrator has to add my files to sw.js", which is how a list like that goes
 * stale. This finds every game module and model under src/ and assets/models/
 * that the list does not name and adds it, in one block, sorted.
 *
 *   node tools/sync-precache.mjs            # report what is missing
 *   node tools/sync-precache.mjs --write    # add it, and bump CACHE_VERSION
 *
 * It never removes anything: a file that is listed and gone fails loudly in
 * the service worker's install, which is the right place to find out.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SW = join(ROOT, 'sw.js');
const write = process.argv.includes('--write');

const src = readFileSync(SW, 'utf8');
const start = src.indexOf('const PRECACHE = [');
const end = src.indexOf('];', start);
if (start < 0 || end < 0) throw new Error('sw.js: could not find the PRECACHE array');
// Line by line, not one regex over the block: the comments in the list have
// apostrophes in them ("the game's"), and a quote-pair regex pairs across them.
const listed = new Set(
  src
    .slice(start, end)
    .split('\n')
    .map((l) => l.match(/^\s*'([^']+)',?\s*(\/\/.*)?$/))
    .filter(Boolean)
    .map((m) => m[1])
);

const found = [];
function walk(dir, keep) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep);
    else if (keep(name)) found.push(relative(ROOT, p).split('\\').join('/'));
  }
}
walk(join(ROOT, 'src'), (n) => n.endsWith('.js'));
walk(join(ROOT, 'assets', 'models'), (n) => n.endsWith('.glb'));

const missing = found.filter((f) => !listed.has(f)).sort();
if (!missing.length) {
  console.log(`sw.js lists all ${found.length} game files.`);
  process.exit(0);
}
console.log(`${missing.length} game file(s) missing from sw.js PRECACHE:`);
for (const f of missing) console.log(`  ${f}`);
if (!write) process.exit(1);

// Insert before the vendored three.js line, which is the end of the module list.
const anchor = src.indexOf("  'src/vendor/three.module.js',", start);
if (anchor < 0 || anchor > end) throw new Error('sw.js: could not find the three.module.js line to insert before');
const block =
  '  // Added by tools/sync-precache.mjs.\n' + missing.map((f) => `  '${f}',\n`).join('');
let out = src.slice(0, anchor) + block + src.slice(anchor);
out = out.replace(/const CACHE_VERSION = 'island-flight-v(\d+)';/, (_, n) => `const CACHE_VERSION = 'island-flight-v${Number(n) + 1}';`);
writeFileSync(SW, out);
console.log(`Added them and bumped CACHE_VERSION.`);
