/**
 * Spireline, Nullspire's secret airline (aircraft/extra/spireline.js),
 * checked in node:
 *
 *   /opt/homebrew/bin/node tests/features/spireline.mjs
 *
 *   - not in LIVERIES until registered; nothing in the first load imports it
 *   - registered once: in LIVERIES, marked secret, in every airliner's
 *     picker list (liveriesFor), resolved by schemeFor, never in
 *     AIRLINE_LIVERIES (so no stand or ambient airliner wears it by chance)
 *   - its fin mark `spire` draws (fleet/extra/emblems.js), its wordmark is
 *     taught to the fleet pack
 *   - original: its name, callsign and registration are none of the other
 *     schemes'
 */
import { readFileSync } from 'node:fs';

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
};
global.window = global.window || { addEventListener() {} };

const SRC = new URL('../../src/', import.meta.url).href;
const Lv = await import(SRC + 'aircraft/liveries.js');
const Ty = await import(SRC + 'aircraft/types.js');
const Em = await import(SRC + 'fleet/extra/emblems.js');

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};

const before = Lv.LIVERIES.length;
ok('not in the paint list before it is registered', !Lv.LIVERIES.some((l) => l.id === 'spireline'));
{
  const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n;]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const seen = new Set();
  const walk = (url) => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    let text = '';
    try {
      text = readFileSync(url, 'utf8');
    } catch {
      return;
    }
    let m;
    while ((m = IMPORT_RE.exec(text))) if (m[1].startsWith('.')) walk(new URL(m[1], url));
  };
  walk(new URL('../../src/main.js', import.meta.url));
  ok('nothing in the first load imports it', ![...seen].some((k) => /extra\/spireline\.js$/.test(k)));
}

const S = await import(SRC + 'aircraft/extra/spireline.js');
const l = S.registerSpireline();
S.registerSpireline();
ok('registered once: one more scheme, the same again', Lv.LIVERIES.length === before + 1 && Lv.LIVERIES.includes(l) && S.spirelineRegistered());
ok('marked secret and special: never handed out at random', l.secret === true && l.special === true && !Lv.AIRLINE_LIVERIES.some((x) => x.id === 'spireline'));
{
  const a320 = Ty.getAircraft('a320');
  const b747 = Ty.getAircraft('b747');
  ok('in the picker for the airliners, and schemeFor resolves it', Lv.liveriesFor(a320).includes(l) && Lv.liveriesFor(b747).includes(l) && Lv.schemeFor(a320, 'spireline') === l && Lv.findLivery('spireline') === l);
  ok('its fleet is airliners the game flies', l.fleet.every((id) => Ty.AIRCRAFT.some((t) => t.id === id)), l.fleet.join(' '));
}
{
  // The fin mark: the pen draws into a 2D context; a stub counts the calls.
  let calls = 0;
  const g = new Proxy({ canvas: { width: 64, height: 64 } }, { get: (o, k) => (k in o ? o[k] : () => { calls++; }) });
  const drew = Em.drawEmblem(g, 'spire', 64, l.style.emblemInks);
  ok('its fin mark `spire` draws', drew === true && Em.EMBLEM_STYLES.includes('spire') && calls > 8, `${calls} canvas calls`);
  ok('the other marks are untouched', Em.EMBLEM_STYLES.includes('horizon') && Em.EMBLEM_STYLES.length === 21);
}
{
  const W = await import(SRC + 'fleet/extra/wordmarks.js');
  await new Promise((res) => setTimeout(res, 50));
  ok('its wordmark is taught to the fleet pack', W.WORDMARKS.spireline === S.SPIRELINE_WORDMARK && W.wordmarkFor(l) === S.SPIRELINE_WORDMARK);
}
{
  const others = Lv.LIVERIES.filter((x) => x !== l);
  ok('original: its name, callsign and registration are its own', !others.some((x) => x.name === l.name || x.callsign === l.callsign || x.reg === l.reg) && l.emblem === 'spire');
}

const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
