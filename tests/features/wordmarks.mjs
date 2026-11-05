/**
 * The airlines' names and the game's type, checked in node:
 *
 *   node tests/features/wordmarks.mjs
 *
 * The owner: "now make sure FONTS ARE GOOD", then "come on, you cant even fix
 * the FONTS????". tests/features/wordmarks.browser.js does what needs real
 * faces and real meshes; this holds the rules that need neither:
 *   - every airline has a wordmark of its own: its spec differs from every
 *     other's, it has one written idea, it says the airline's name;
 *   - every ink in it is a colour the scheme already wears;
 *   - no airline's name is a triangle or any real airline's device;
 *   - on every type an airline flies, the name sits behind the first door, over
 *     the window row, above where the near wing or a nacelle rises to from a
 *     chase camera (it may run back over the wing root, as a real title does),
 *     clear of door windows and handles (a freighter's doors are plugged), and
 *     no longer than a share of the body;
 *   - the UI has one type system: bundled faces through --font and --mono,
 *     font-display: swap, 'Courier New' nowhere;
 *   - no canvas text in the game asks for a bare system face.
 */
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url);
const SRC = new URL('src/', ROOT).href;
const T = await import(SRC + 'aircraft/types.js');
const L = await import(SRC + 'aircraft/liveries.js');
const A = await import(SRC + 'aircraft/model-adapter.js');
const W = await import(SRC + 'fleet/extra/wordmarks.js');
const S = await import(SRC + 'fleet/extra/title-slot.js');
const ART = await import(SRC + 'fleet/extra/livery-art.js');

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  if (!pass || process.env.VERBOSE) console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}

/* ---- every airline, its own drawing ---- */
const air = L.AIRLINE_LIVERIES;
const ids = [...air.map((l) => l.id), 'potus'];
ok('every airline (and Air Force One) has a wordmark', ids.every((id) => W.WORDMARKS[id]), ids.filter((id) => !W.WORDMARKS[id]).join());
const shape = (id) => {
  const w = W.WORDMARKS[id];
  const l = L.findLivery(id);
  return JSON.stringify([l.style.titleFont, w.rows.map((r) => [r.cap, r.track, r.align, r.justify, r.runs.map((u) => [u.shape, u.hollow, u.ink, u.f && u.f.family])]), w.skew, w.bold, !!w.mark, !!w.deco, !!w.under]);
};
const seen = new Map();
for (const id of ids) {
  const k = shape(id);
  ok(`${id}: a wordmark spec no other airline has`, !seen.has(k), seen.get(k));
  seen.set(k, id);
}
for (const id of ids) {
  const w = W.WORDMARKS[id];
  const l = L.findLivery(id);
  const words = (l.titling || l.title).toUpperCase().replace(/[^A-Z]/g, '');
  ok(`${id}: says the airline's name`, w.reads.toUpperCase().replace(/[^A-Z]/g, '') === words, w.reads);
  ok(`${id}: has one written idea`, typeof w.idea === 'string' && w.idea.length > 12);
  ok(`${id}: is more than one font at one tracking: an idea drawn or a lockup`, !!(w.deco || w.under || w.mark || w.rows.length > 1 || w.rows[0].runs.length > 1 || id === 'potus'));
  // Every ink is one of the scheme's own colours.
  const own = JSON.stringify([l, ART.artFor(l)]).toLowerCase();
  const tail = l.tail != null ? `#${Number(l.tail).toString(16).padStart(6, '0')}` : '';
  const foreign = w.inks.filter((c) => !own.includes(c.toLowerCase()) && c !== tail);
  ok(`${id}: every ink is the scheme's own`, foreign.length === 0, foreign.join());
  if (w.mark) ok(`${id}: the mark beside the name is the airline's own`, !!l.emblem);
}
ok('riverdelta: no triangle in the name (the mark was redrawn to get away from one)', !/delta\b.*shape|triangle/.test(W.WORDMARKS.riverdelta.idea));

/* ---- the place on the aeroplane ---- */
const windowTop = (rp) => {
  const rows = (rp.windows || []).filter((r) => r.deck !== 'upper').sort((a, b) => a.y - b.y);
  return rows.length ? rows[0].y + rows[0].ht / 2 : -Infinity; // a freighter's row is plugged: none here
};
const bad = { door: [], wing: [], engine: [], win: [], long: [], gone: [], doors: [] };
let cases = 0;
const classes = new Set();
for (const l of [...air, L.findLivery('potus')]) {
  for (const id of l.id === 'potus' ? ['b747'] : l.fleet) {
    if (id === 'meridian') continue;
    const type = T.getAircraft(id);
    const m = A.createAircraftModel({ type, livery: L.schemeFor(type, l.id) });
    const rp = m.userData.realPaint;
    const c = m.userData.config;
    const f = m.userData.fuselage;
    const d = rp && rp.decals.find((x) => x.title);
    const tag = `${id}/${l.id}`;
    cases++;
    classes.add(id);
    if (!d || !(d.w > 0.5 && d.h > 0.2)) {
      bad.gone.push(tag);
      if (m.userData.dispose) m.userData.dispose();
      continue;
    }
    const [z0, z1, y0, y1] = [d.z - d.w / 2, d.z + d.w / 2, d.y - d.h / 2, d.y + d.h / 2];
    const zone = d.zone;
    const aft = id === 'q400';
    const firstDoor = aft ? null : zone.zA;
    if (firstDoor != null && z0 < zone.zA - 0.01) bad.door.push(tag);
    const eng = c.titleEngines || c.engines || [];
    if (c.wing) {
      // Past the wing root is fine, as a real title is, so long as the near wing, seen from a chase
      // camera a little above, has not risen to the foot of the letters by the end of the name.
      const w = c.wing;
      for (let t = 0; t <= 1 && !aft; t += 0.02) {
        const z = Math.min(w.rootZ, d.zone.root) + w.sweep * t;
        const top = w.rootY + w.dihedral * t + 0.5 * w.thickness * (1 - t) + (w.rootX + w.span * t) * S.CHASE_RISE;
        if (z < z1 && top > y0) {
          bad.wing.push(`${tag} ${top.toFixed(2)}>${y0.toFixed(2)} at ${z.toFixed(1)}`);
          break;
        }
      }
      if (aft && z0 < w.rootZ + w.rootChord) bad.wing.push(tag);
    }
    for (const e of eng) {
      const front = e.z - e.length / 2;
      const rise = (e.kind === 'prop' ? e.y + e.propRadius : e.y + e.radius) + Math.abs(e.x) * S.CHASE_RISE;
      if (rise > y0 && z1 > front && z0 < e.z + e.length / 2) bad.engine.push(`${tag} ${e.id}`);
    }
    if (y0 < windowTop(rp) - 0.01) bad.win.push(tag);
    if (d.w > S.MAX_SHARE * (f.tail - f.nose) + 0.01) bad.long.push(tag);
    for (const door of (ART.artFor(l) || {}).freighter ? [] : rp.doors || []) {
      if (door.deck === 'upper') continue;
      const over = z0 < door.z + door.w / 2 && z1 > door.z - door.w / 2;
      // Only a door's top frame may tuck under the letters: its window and handle stay clear.
      if (over && y0 < door.y + door.h / 2 - S.DOOR_TUCK * (f.top - f.bottom) - 0.01) bad.doors.push(`${tag} ${door.id}`);
    }
    if (m.userData.dispose) m.userData.dispose();
  }
}
ok(`every airline on every type: ${cases} names on ${classes.size} types, each has a place`, bad.gone.length === 0, bad.gone.join());
ok('the name starts behind the first door', bad.door.length === 0, bad.door.slice(0, 6).join());
ok('the near wing does not rise to the name from a chase camera (a turboprop\'s goes behind it)', bad.wing.length === 0, bad.wing.slice(0, 6).join());
ok('no nacelle or propeller rises over the name', bad.engine.length === 0, bad.engine.slice(0, 6).join());
ok('the name is over the window row', bad.win.length === 0, bad.win.slice(0, 6).join());
ok('no door\'s window or handle under the name', bad.doors.length === 0, bad.doors.slice(0, 6).join());
ok(`the name is never more than ${S.MAX_SHARE * 100}% of the body: an A380 wears no banner`, bad.long.length === 0, bad.long.slice(0, 6).join());
for (const id of ['a320', 'b777', 'a380', 'b747', 'q400']) ok(`the classes are all there: ${id}`, classes.has(id));

/* ---- the one type system ---- */
const css = readFileSync(new URL('styles/main.css', ROOT), 'utf8');
const html = readFileSync(new URL('index.html', ROOT), 'utf8');
ok('--font starts with a bundled face', /--font:\s*'Jost'/.test(css));
ok('--mono starts with a bundled face', /--mono:\s*'Barlow Condensed'/.test(css));
const faces = css.match(/@font-face\s*\{[^}]*\}/g) || [];
ok('three @font-face rules, all swap, all in assets/fonts', faces.length === 3 && faces.every((f) => /font-display:\s*swap/.test(f) && /assets\/fonts\//.test(f)), faces.length);
ok('the numbers are tabular', /font-variant-numeric:\s*tabular-nums/.test(css));
ok('the menu faces are preloaded, so it paints in them', /rel="preload"[^>]*jost-600/.test(html) && /rel="preload"[^>]*jost-700/.test(html));

const walk = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'vendor') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.html')) out.push(p);
  }
  return out;
};
const root = new URL('.', ROOT).pathname;
const files = [...walk(join(root, 'src')), join(root, 'styles/main.css'), join(root, 'index.html')];
const courier = files.filter((p) => /Courier New/.test(readFileSync(p, 'utf8')));
ok("'Courier New' is gone from the game", courier.length === 0, courier.join());
const canvasBare = [];
for (const p of files) {
  if (p.endsWith('airline-fonts.js')) continue;
  const lines = readFileSync(p, 'utf8').split('\n');
  lines.forEach((t, i) => {
    if (/\.font\s*=/.test(t) && /px (sans-serif|monospace|Arial|system-ui|"Helvetica|ui-monospace)/.test(t)) canvasBare.push(`${p.split('/src/')[1]}:${i + 1}`);
  });
}
ok('no canvas text asks for a bare system face', canvasBare.length === 0, canvasBare.slice(0, 5).join());

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
