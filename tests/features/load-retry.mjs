/**
 * LOAD RELIABILITY (core/load-retry.js, index.html's bootstrap), from the
 * repo root:  node tests/features/load-retry.mjs
 *
 *   - retrying(): a loader that fails once succeeds on the second try after
 *     the back-off; one that always fails rejects after RETRIES + 1 tries;
 *     shouldRetry can stop it;
 *   - fetchRetry(): a network error or a 5xx / 408 / 429 is asked again once,
 *     a 404 is final at once, the last Response comes back when the retries
 *     are spent;
 *   - index.html imports the game through a retrying bootstrap (no bare
 *     <script type="module" src="src/main.js">), with a one-line message and
 *     a Reload button; main.js fatal() has the same button; the button is a
 *     touch target (56 px); the service worker precaches the module;
 *   - the asset loaders (the real models, the Blender vehicles, the World
 *     Map's props, the vehicle preload) fetch through fetchRetry; the
 *     feature bundle's import retries.
 * Every check here fails on v75.8.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');
let passed = 0, failed = 0;
const ok = (name, pass, detail = '') => { if (pass) passed++; else failed++; console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`); };

const LR = await import(new URL('../../src/core/load-retry.js', import.meta.url).href);
const noWait = async () => {};

ok('load retry: one retry, 600 ms back-off', LR.RETRIES === 1 && LR.RETRY_BACKOFF_MS === 600, `${LR.RETRIES} / ${LR.RETRY_BACKOFF_MS}`);

{
  let calls = 0;
  const waits = [];
  const v = await LR.retrying(async () => { calls++; if (calls === 1) throw new Error('dropped'); return 'module'; }, { wait: async (ms) => { waits.push(ms); } });
  ok('load retry: a loader that fails once succeeds on the second try, after the back-off', v === 'module' && calls === 2 && waits.length === 1 && waits[0] === LR.RETRY_BACKOFF_MS, `${calls} calls, waits ${waits}`);
}
{
  let calls = 0;
  let err = null;
  const told = [];
  try { await LR.retrying(async () => { calls++; throw new Error(`fail ${calls}`); }, { wait: noWait, onRetry: (e, n) => told.push(n) }); } catch (e) { err = e; }
  ok('load retry: a loader that always fails rejects after RETRIES + 1 tries, and onRetry was told', !!err && err.message === 'fail 2' && calls === 2 && told.join() === '1');
}
{
  let calls = 0;
  let err = null;
  try { await LR.retrying(async () => { calls++; const e = new Error('missing'); e.final = true; throw e; }, { wait: noWait, shouldRetry: (e) => !e.final }); } catch (e) { err = e; }
  ok('load retry: shouldRetry can stop a retry (a missing file)', !!err && calls === 1);
}
{
  let n = 0;
  const fake = async () => { n++; if (n === 1) throw new TypeError('Failed to fetch'); return { ok: true, status: 200, n }; };
  const res = await LR.fetchRetry('x.glb', undefined, { fetch: fake, wait: noWait });
  ok('load retry: fetchRetry asks again after a network error', res.ok && n === 2, `${n} fetches`);
}
{
  let n = 0;
  const fake = async () => { n++; return { ok: false, status: 503 }; };
  const res = await LR.fetchRetry('x.glb', undefined, { fetch: fake, wait: noWait });
  ok('load retry: ...and after a 503, handing the last answer back when both failed', res.status === 503 && n === 2, `${n} fetches, status ${res.status}`);
}
{
  let n = 0;
  const fake = async () => { n++; return { ok: false, status: 404 }; };
  const res = await LR.fetchRetry('x.glb', undefined, { fetch: fake, wait: noWait });
  ok('load retry: a 404 is final: no second request', res.status === 404 && n === 1, `${n} fetches`);
}
ok('load retry: 408, 429 and 5xx are worth a retry; 200, 304, 403 and 404 are not', [408, 429, 500, 502, 503].every(LR.retryableStatus) && ![200, 304, 403, 404].some(LR.retryableStatus));

/* ---- the page ---- */
const html = src('index.html');
ok('load retry: index.html imports the game through the retrying bootstrap, not a bare module tag', !/<script type="module" src="src\/main\.js">/.test(html) && /window\.__bootLoad = bootLoad/.test(html) && /import\('\.\/src\/main\.js'\)/.test(html));
ok('load retry: the bootstrap retries once after a back-off', /var RETRIES = 1;/.test(html) && /var BACKOFF_MS = 600;/.test(html) && /setTimeout\(r, backoff \* state\.attempts\)/.test(html));
ok('load retry: the failure screen is one calm line and a Reload button', /class="fatal-line">[^<]{10,120}<\/p>/.test(html) && /data-fatal-reload>Reload<\/button>/.test(html) && /__reloadPage/.test(html));
const main = src('src/main.js');
ok('load retry: main.js fatal() has the same Reload button', /data-fatal-reload>Reload<\/button>/.test(main) && /querySelector\('\[data-fatal-reload\]'\)/.test(main));
const css = src('styles/main.css');
const btn = /\.fatal-reload \{([^}]*)\}/.exec(css);
ok('load retry: the Reload button is a touch target: 56 px tall, full width, 18 px text', !!btn && /min-height: 56px/.test(btn[1]) && /width: 100%/.test(btn[1]) && /font-size: 18px/.test(btn[1]));
const sw = src('sw.js');
ok('load retry: the service worker precaches core/load-retry.js', /'src\/core\/load-retry\.js'/.test(sw));
ok('load retry: the real models and the Blender vehicles fetch through fetchRetry', /fetchRetry\(url\)/.test(src('src/aircraft/real-models.js')) && /fetchRetry\(url\)/.test(src('src/vehicles/blender-models.js')));
ok('load retry: the World Map props and the vehicle preload too', /fetchRetry\(new URL/.test(src('src/features/world-preview.js')) && /load: \(url\) =>\s*fetchRetry\(url\)/.test(main));
ok('load retry: the feature bundle import retries once', /retrying\(\(\) => import\('\.\/features\/index\.js'\)/.test(main));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
