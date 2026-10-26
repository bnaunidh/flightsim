/**
 * Wave 14, the branding lane, checked in node:
 *
 *   node tests/features/branding.mjs
 *
 * TYPOGRAPHY ("not the same font")
 *   - the twelve OFL faces are in assets/fonts/, real woff2 files, listed in
 *     FONTS.md, precached by sw.js with the module that loads them;
 *   - every airline (and Air Force One) names a bundled face for its
 *     titling; no face is worn by more than two airlines, and an airline
 *     styled after a freight or low-cost carrier never wears a serif;
 *   - the Credits screen credits every family under the OFL;
 *   - the titling decal is keyed by its face (so two airlines in two faces
 *     never share a texture), a registration is not, and in node — no fonts
 *     — a face is never claimed ready.
 *
 * LOGOS ("logo sucks")
 *   - every mark the liveries name is drawn by fleet/extra/emblems.js, with
 *     filled curves (Béziers or arcs, not bare polylines), inside the fin's
 *     safe square, and every airline's mark is a different drawing;
 *   - the fin mark stays on the fin: one each side, nowhere else on the
 *     aeroplane (no engine, belly or winglet marks).
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

import { readFileSync, existsSync, readdirSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const SRC = new URL('src/', ROOT).href;
const F = await import(SRC + 'render/airline-fonts.js');
const L = await import(SRC + 'aircraft/liveries.js');
const E = await import(SRC + 'fleet/extra/emblems.js');
const AT = await import(SRC + 'fleet/aircraft-textures.js');
const T = await import(SRC + 'aircraft/types.js');
const ADAPTER = await import(SRC + 'aircraft/model-adapter.js');
const { CREDITS_HTML } = await import(SRC + 'ui/credits.js');

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}
const read = (p) => readFileSync(new URL(p, ROOT));

/* ---------------------------------------------------------------- fonts -- */
{
  const files = readdirSync(new URL('assets/fonts/', ROOT)).filter((f) => f.endsWith('.woff2'));
  ok('assets/fonts: twelve families, fourteen faces, all woff2', files.length === 14 && F.AIRLINE_FONTS.length === 14, files.length);
  for (const f of F.AIRLINE_FONTS) {
    const p = `assets/fonts/${f.file}`;
    const there = existsSync(new URL(p, ROOT));
    const magic = there ? read(p).subarray(0, 4).toString('latin1') : '';
    ok(`${f.family} ${f.weight}${f.style === 'italic' ? ' italic' : ''}: the file is here and is a woff2`, there && magic === 'wOF2', magic);
  }
  const md = read('assets/fonts/FONTS.md').toString();
  ok('FONTS.md: says OFL and names every family', /Open Font License/.test(md) && F.AIRLINE_FONTS.every((f) => md.includes(f.family)));
  const sw = read('sw.js').toString();
  ok('sw.js precaches every face and the module that loads them', F.AIRLINE_FONTS.every((f) => sw.includes(`'assets/fonts/${f.file}'`)) && sw.includes("'src/render/airline-fonts.js'"));
  const families = [...new Set(F.AIRLINE_FONTS.map((f) => f.family))];
  ok('Credits: every family is credited, under the SIL Open Font License', families.every((fam) => CREDITS_HTML.includes(fam)) && /SIL OFL 1\.1/.test(CREDITS_HTML) && /Open Font License/.test(CREDITS_HTML));
  ok('Credits: no longer claims "no web fonts"', !/No web fonts are downloaded/.test(CREDITS_HTML));

  // Every airline, and the presidential paint, names a bundled face.
  const lettered = L.LIVERIES.filter((l) => !l.house);
  const bad = lettered.filter((l) => !(l.style && F.faceFor(l.style.titleFont)));
  ok('every airline names one of the bundled faces for its name', bad.length === 0, bad.map((l) => l.id).join(', '));
  const uses = new Map();
  for (const l of L.AIRLINE_LIVERIES) {
    const k = F.fontKey(l.style.titleFont);
    uses.set(k, (uses.get(k) || 0) + 1);
  }
  const most = Math.max(...uses.values());
  ok('no face is worn by more than two airlines (not the same font)', most <= 2, [...uses].map(([k, n]) => `${k}×${n}`).join(' '));
  ok('at least ten different faces across the airlines', uses.size >= 10, uses.size);
  const freight = ['nightfreight', 'dashfreight', 'flexship', 'parcelbrown', 'spit'];
  ok('freight and low-cost airlines are lettered in a sans, never a serif', freight.every((id) => !F.faceFor(L.findLivery(id).style.titleFont).serif));
  ok('the DHL-style freighter is the sporty italic; the Emirates-style is a serif; the night freighter is condensed',
    F.faceFor(L.findLivery('dashfreight').style.titleFont).style === 'italic' &&
      F.faceFor(L.findLivery('desertpearl').style.titleFont).serif &&
      F.faceFor(L.findLivery('nightfreight').style.titleFont).condensed);

  // The canvas font string and its fallbacks.
  ok('canvasFont: an italic face is lettered italic, with a fallback of its own kind', /^italic 700 40px "Lora", Georgia/.test(F.canvasFont({ family: 'Lora', weight: 600, style: 'italic' }, 40).replace(' 600 ', ' 700 ')) || /^italic 600 40px "Lora", Georgia/.test(F.canvasFont({ family: 'Lora', weight: 600, style: 'italic' }, 40)), F.canvasFont({ family: 'Lora', weight: 600, style: 'italic' }, 40));
  ok('canvasFont: a condensed face falls back to a narrow one', /"Oswald", "Arial Narrow"/.test(F.canvasFont({ family: 'Oswald', weight: 600 }, 20)));
  ok('fontStack: not one of ours keeps the old Helvetica stack', F.fontStack({ family: 'Comic Sans MS', weight: 400 }) === '"Helvetica Neue", Helvetica, Arial, sans-serif');
  ok('node: no font set, so no face is ever claimed ready, and nothing is queued', !F.fontReady({ family: 'Jost', weight: 600 }) && F.whenFontsLoaded(() => {}) === false);

  // The titling decal: keyed by its face; the registration is not.
  const a = AT.aircraftDecalTexture('SANDLINE', { color: '#7a5a30', weight: 600, spacing: 0.12, font: { family: 'Cinzel', weight: 700 } });
  const b = AT.aircraftDecalTexture('SANDLINE', { color: '#7a5a30', weight: 600, spacing: 0.12, font: { family: 'Jost', weight: 700 } });
  const c = AT.aircraftDecalTexture('SANDLINE', { color: '#7a5a30', weight: 600, spacing: 0.12 });
  ok('decals: the same words in two faces are two textures, and neither is the face-less one', a !== b && a !== c && b !== c && a.userData.font === 'Cinzel/700/normal');
  ok('decals: a face-less decal keeps the key it always had (no suffix)', /_600_0\.12$/.test(c.name), c.name);

  // On the aeroplane: an airliner's Titling carries its airline's face.
  for (const [typeId, liv, fam] of [['a320', 'bleuciel', 'Jost'], ['b777', 'desertpearl', 'Playfair Display'], ['b747', 'parcelbrown', 'Barlow Condensed']]) {
    const type = T.getAircraft(typeId);
    const m = ADAPTER.createAircraftModel({ type, livery: L.schemeFor(type, liv) });
    let title = null;
    m.traverse((o) => {
      if (o.isMesh && o.name === 'Titling') title = o;
    });
    ok(`${typeId} in ${liv}: the name is lettered in ${fam}`, !!title && String(title.material.map.userData.font || '').startsWith(fam + '/'), title ? title.material.map.name : 'no titling');
    if (m.userData.dispose) m.userData.dispose();
  }
}

/* ---------------------------------------------------------------- logos -- */
{
  const src = read('src/fleet/extra/emblems.js').toString();
  for (const id of L.EMBLEMS) ok(`emblems.js draws '${id}'`, E.EMBLEM_STYLES.includes(id));

  /*
   * Draw each mark into a recording context: every call is logged, with its
   * coordinates, so the shapes can be checked without a real canvas.
   */
  const record = (style, inks = ['#ffffff', '#cc0000', '#333333']) => {
    const calls = [];
    const pts = [];
    const S = 512;
    const g = new Proxy(
      {},
      {
        get(t, k) {
          if (k in t) return t[k];
          return (...args) => {
            calls.push(k);
            if (['moveTo', 'lineTo'].includes(k)) pts.push([args[0], args[1]]);
            if (k === 'quadraticCurveTo') pts.push([args[2], args[3]]);
            if (k === 'bezierCurveTo') pts.push([args[4], args[5]]);
            if (k === 'arc' || k === 'ellipse') pts.push([args[0], args[1]]);
          };
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      },
    );
    const drew = E.drawEmblem(g, style, S, inks);
    return { drew, calls, pts, S };
  };
  const sigs = new Map();
  for (const l of L.AIRLINE_LIVERIES) {
    const r = record(l.emblem);
    const curves = r.calls.filter((k) => k === 'bezierCurveTo' || k === 'quadraticCurveTo' || k === 'arc' || k === 'ellipse' || k === 'arcTo').length;
    const fills = r.calls.filter((k) => k === 'fill').length;
    ok(`${l.id} (${l.emblem}): a drawn mark of filled shapes with curves`, r.drew && fills >= 1 && curves >= 2, `${fills} fills, ${curves} curves`);
    // Inside the safe square: no anchor point further than 0.5 of the square from the centre on either axis.
    const outside = r.pts.filter(([x, y]) => Math.abs(x - r.S / 2) > r.S * 0.5 + 0.5 || Math.abs(y - r.S / 2) > r.S * 0.5 + 0.5);
    ok(`${l.id}: the mark stays on its square (nothing drawn off the fin's patch)`, outside.length === 0, outside.length);
    sigs.set(l.id, r.calls.join(','));
  }
  const distinct = new Set(L.AIRLINE_LIVERIES.map((l) => l.emblem));
  ok('every mark the airlines wear is a drawing of its own', [...distinct].every((e) => [...distinct].filter((f) => f !== e).every((f) => record(e).calls.join(',') !== record(f).calls.join(','))));
  ok('an unknown mark is refused (the caller draws its plain disc)', record('no-such-mark').drew === false);
  ok('no mark is a bare polyline any more: the file draws with Bézier curves throughout', (src.match(/\.C\(/g) || []).length >= 60);

  // Placement: on the fin only, one each side.
  for (const [typeId, liv] of [['a320', 'krd'], ['b787', 'risingcrane'], ['a350', 'pearlgulf'], ['b777', 'royalisles']]) {
    const type = T.getAircraft(typeId);
    const m = ADAPTER.createAircraftModel({ type, livery: L.schemeFor(type, liv) });
    const marks = [];
    m.traverse((o) => {
      if (o.isMesh && /emblem/i.test(o.name)) marks.push(o);
    });
    let onFin = marks.length === 2;
    for (const o of marks) {
      let n = o.parent;
      let fin = false;
      while (n) {
        if (/fin/i.test(n.name)) fin = true;
        n = n.parent;
      }
      onFin = onFin && fin;
    }
    ok(`${typeId} in ${liv}: the mark is on the fin, one each side, and nowhere else`, onFin, marks.map((o) => o.name + '<' + (o.parent && o.parent.name)).join(', '));
    if (m.userData.dispose) m.userData.dispose();
  }
}

/* -------------------------------------------- the mark on a real model's fin -- */
{
  const THREE = await import(SRC + 'vendor/three.module.js');
  const type = T.getAircraft('b777');
  const m = ADAPTER.createAircraftModel({ type, livery: L.schemeFor(type, 'desertpearl') });
  const ud = m.userData;
  let proc = null;
  m.traverse((o) => {
    if (!proc && o.isMesh && o.name === 'Tail emblem') proc = o;
  });
  ok('the fin mark is drawn from both faces (the right-hand quad used to face inwards and be culled)', !!proc && proc.material.side === THREE.DoubleSide);
  ok('an airliner hands real-models.js its fin mark (userData.finMark, not enumerable)', !!ud.finMark && typeof ud.finMark.fit === 'function' && !Object.keys(ud).includes('finMark'));
  // A stand-in real fin: a swept, tapered slab well aft and above the procedural one.
  const skin = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1, 1, 4, 4);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5;
    const ch = 9 - 6 * t;
    p.setXYZ(i, p.getX(i) * (0.8 - 0.5 * t), 5 + 9 * t, 30 + 8 * t + (p.getZ(i) + 0.5) * ch);
  }
  const fin = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  const wrap = new THREE.Group();
  wrap.name = 'fin';
  wrap.add(fin);
  skin.add(wrap);
  const mark = ud.finMark.fit(skin, [fin]);
  const box = mark ? new THREE.Box3().setFromObject(mark) : null;
  ok('real fin: the mark is laid on it — inside its height and chord, a few centimetres off its sides', !!box && box.min.y > 5.5 && box.max.y < 14 && box.min.z > 30 && box.max.z < 47 && box.max.x > 0.2 && box.max.x < 0.9 && Math.abs(box.min.x + box.max.x) < 1e-6,
    box ? `${box.min.toArray().map((v) => v.toFixed(2))} .. ${box.max.toArray().map((v) => v.toFixed(2))}` : 'no mark');
  ok('real fin: two quads, in the same material as the procedural mark', !!mark && mark.children.length === 2 && mark.children.every((q) => q.material === proc.material));
  const flat = new THREE.Group();
  ok('real fin: pieces that do not read as one fin give no mark', ud.finMark.fit(flat, []) === null);
  if (ud.dispose) ud.dispose();
  const src2 = read('src/aircraft/real-models.js').toString();
  ok('real-models.js lays the mark on the skin (it shows and hides with it)', /ud\.finMark\.fit\(skin, finPieces\)/.test(src2) && /skin\.add\(mark\)/.test(src2));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
