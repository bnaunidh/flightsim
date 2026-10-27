/**
 * Node checks for the owner's four calls of 2026-10-26 (w17, "fix these
 * things"), before an aviation YouTuber films the game on a Mac:
 *
 *   1. THE RADIO KEY ON A MAC. A MacBook's F8 is Play/Pause unless fn is held,
 *      so on a Mac the radio is named "fn F8", and it has a plain letter too,
 *      Z, on every keyboard ("F8 or Z", "fn F8 or Z"). Every letter already
 *      means something in the cockpit; Z's other owner is the Meteor zapper,
 *      which listens only while a zap mode runs, and then Z zaps and the
 *      radio is F8. A set of keys saved before this gets Z added once, unless
 *      the player had put something else on Z.
 *   2. AN A380 GATE AT GATEWAY. The clearance test was a square of half a
 *      span (plus 5 m) round the aeroplane's middle; for an A380 that reached
 *      the floodlight masts at the back of the apron, ahead of its nose, on
 *      every free heavy gate. A stand start is now tested with the
 *      aeroplane's own plan, nose to tail by wingtip to wingtip, 5 m round
 *      it. The A380, the BelugaXL and the 747 get a gate; nothing they are
 *      parked on or beside (masts, the terminal, the neighbours on their
 *      stands) is inside their outline. The A321, A320 and 737 still do.
 *   3. SMALL SCREENS. While a warning or a card with answers does not fit,
 *      the minimap steps aside (the logic is in ui/hud-stack.js, the layout
 *      in styles/main.css; the real thing at real sizes is owner-calls.browser.js).
 *   4. BUTTER. The touchdown card says Butter under 120 ft/min and the
 *      achievement wanted under 60; now both are BUTTER_FPM (120), the
 *      description says so, and an achievement already earned stays earned.
 *
 *   node tests/features/owner-calls.mjs
 *
 * OC_ROOT=<another checkout>/ runs the same checks against that tree (the
 * base fails 1, 2 and 4; that is how they were written).
 */

import { readFileSync } from 'node:fs';

globalThis.document = globalThis.document || {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const root = process.env.OC_ROOT ? new URL(`file://${process.env.OC_ROOT.replace(/\/?$/, '/')}`) : new URL('../../', import.meta.url);
const load = (p) => import(new URL(p, root).href);
const text = (p) => readFileSync(new URL(p, root), 'utf8');

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
}
const tryRun = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name}: ran`, false, String(e && (e.stack || e.message)).slice(0, 300));
  }
};

/* ---------------- 2 first (it builds the real Gateway, which wants the stub document) ---------------- */

await tryRun('gate', async () => {
  const THREE = await load('src/vendor/three.module.js');
  const TR = await load('src/world/terrain.js');
  const AP = await load('src/world/airport.js');
  const APR = await load('src/world/apron.js');
  const AL = await load('src/world/airport-layout.js');
  const PD = await load('src/world/pads.js');
  const TYPES = await load('src/aircraft/types.js');
  const SP = await load('src/world/spawns.js');
  TR.applyMap('gateway');
  AP.refreshRunways();
  APR.refreshApronElevation();
  TR.clearObstacles();
  TR.clearPlatforms();
  new AP.Airport({ add() {} });
  new APR.Apron({ add() {} }, 'high');
  PD.buildPads(new THREE.Group());
  const lay = AL.airportLayout();
  const D2R = Math.PI / 180;

  /** An aeroplane's outline from above: nose to tail by wingtip to wingtip, `pad` metres round it. */
  const outline = (x, z, headingDeg, size, pad = 0) => {
    const h = headingDeg * D2R;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const rx = -fz;
    const rz = fx;
    const a0 = -size.tail - pad;
    const a1 = -size.nose + pad;
    const b = size.span / 2 + pad;
    return [[a0, -b], [a1, -b], [a1, b], [a0, b]].map(([a, c]) => ({ x: x + fx * a + rx * c, z: z + fz * a + rz * c }));
  };
  const box = (o) => [{ x: o.x0, z: o.z0 }, { x: o.x1, z: o.z0 }, { x: o.x1, z: o.z1 }, { x: o.x0, z: o.z1 }];
  /** Do two convex polygons overlap (separating axes)? */
  const overlap = (P, Q) => {
    for (const poly of [P, Q]) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const nx = q.z - p.z;
        const nz = p.x - q.x;
        const proj = (R) => R.map((v) => v.x * nx + v.z * nz);
        const a = proj(P);
        const c = proj(Q);
        if (Math.max(...a) < Math.min(...c) || Math.max(...c) < Math.min(...a)) return false;
      }
    }
    return true;
  };
  /** Smallest gap between two polygons' corners and edges, roughly (corner-to-polygon distance). */
  const gap = (P, Q) => {
    const segD = (v, p, q) => {
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const t = Math.max(0, Math.min(1, ((v.x - p.x) * dx + (v.z - p.z) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(v.x - (p.x + t * dx), v.z - (p.z + t * dz));
    };
    let best = Infinity;
    for (const [A, B] of [[P, Q], [Q, P]]) for (const v of A) for (let i = 0; i < B.length; i++) best = Math.min(best, segD(v, B[i], B[(i + 1) % B.length]));
    return best;
  };

  const heavies = ['a380', 'belugaxl', 'b747'];
  for (const id of heavies) {
    const type = TYPES.getAircraft(id);
    const r = SP.resolveSpawn('gateway', 'airliner', { type, choice: 'gate', ctx: { layout: lay, traffic: [] } });
    const st = r.standId ? lay.stands.find((s) => s.id === r.standId) : null;
    ok(`gate: at Gateway the ${id} asked for a gate gets a real one, not the runway`, r.kind === 'stand' && !r.fallback && st && st.bridge, `${r.kind} ${r.label} ${r.why} ${(r.tried || []).map((t) => `${t.label}: ${t.why}`).join(' | ')}`);
    if (!st) continue;
    const size = SP.sizeOf(type);
    const me = outline(r.x, r.z, r.headingDeg, size);
    // Nothing solid inside its outline (or within 5 m of it) at its height.
    const y = TR.heightAt(r.x, r.z);
    const solid = TR.OBSTACLES.filter((o) => !(o.y1 <= y + 0.5) && o.y0 < y + 25 && overlap(outline(r.x, r.z, r.headingDeg, size, 5), box(o)));
    ok(`gate: the ${id} on ${r.label} has no mast, building or other obstacle inside its outline + 5 m`, solid.length === 0, solid.map((o) => o.what).join(', ') || 'clear');
    // The airport's own aeroplanes on the stands either side: not touched, and a real gap between wingtips.
    const near = lay.stands.filter((s) => s !== st && (s.occupant || s.parked) && Math.abs(s.noseX - st.noseX) < 120);
    const bad = [];
    let minGap = Infinity;
    for (const s of near) {
      const oid = typeof s.occupant === 'string' ? s.occupant : (s.parked && s.parked.info && s.parked.info.typeId) || null;
      if (!oid) continue;
      const os = SP.sizeOf(TYPES.getAircraft(oid));
      const p = SP.noseInPoint(s.noseX, s.noseZ, s.headingDeg, os.nose);
      const them = outline(p.x, p.z, s.headingDeg, os);
      const g = gap(me, them);
      minGap = Math.min(minGap, g);
      if (overlap(me, them) || g < 3) bad.push(`${s.id} ${oid} ${g.toFixed(1)} m`);
    }
    ok(`gate: the ${id} clears the airport's own aeroplanes beside it by 3 m or more`, bad.length === 0, bad.join(', ') || `nearest ${Number.isFinite(minGap) ? minGap.toFixed(1) : '—'} m`);
    // It fits its own stand: the nose on the line, the tail inside the stand's depth.
    const noseTip = { x: r.x + Math.sin(r.headingDeg * D2R) * -size.nose, z: r.z - Math.cos(r.headingDeg * D2R) * -size.nose };
    const toLine = Math.hypot(noseTip.x - st.noseX, noseTip.z - st.noseZ);
    ok(`gate: the ${id}'s nose stops ${AL.NOSE_STOP} m short of the line and its tail is inside the stand`, Math.abs(toLine - AL.NOSE_STOP) < 0.5 && size.length <= st.depth + 0.01 && size.span <= st.maxSpan, `nose ${toLine.toFixed(2)} m, length ${size.length.toFixed(1)} of ${st.depth}, span ${size.span} of ${st.maxSpan}`);
  }
  // What the A380 was refused for: a mast 10 m beyond its nose line is not in its way; one at its wingtip is.
  const a380 = SP.sizeOf(TYPES.getAircraft('a380'));
  if (typeof SP.footprintOf === 'function') {
    const pt = { x: 0, z: 0, headingDeg: 0, kind: 'stand', span: a380.span, nose: a380.nose, tail: a380.tail };
    const fp = SP.footprintOf(pt);
    const ahead = { x0: 42, x1: 43, z0: a380.nose - 12, z1: a380.nose - 11 }; // ahead of the nose, out at the wingtip's line
    const wing = { x0: a380.span / 2 + 2, x1: a380.span / 2 + 3, z0: -1, z1: 1 }; // 2 m off the wingtip
    ok('gate: the plan test lets a mast stand ahead of the nose and stops one at the wingtip', !SP.footprintHits(fp, ahead) && SP.footprintHits(fp, wing));
  } else ok('gate: the plan test lets a mast stand ahead of the nose and stops one at the wingtip', false, 'no footprintOf in world/spawns.js');
  // The wave-16 gate starts are untouched.
  for (const id of ['a321', 'a320', 'b737']) {
    const r = SP.resolveSpawn('gateway', 'airliner', { type: TYPES.getAircraft(id), choice: 'gate', ctx: { layout: lay, traffic: [] } });
    ok(`gate: the ${id} still starts at a Gateway gate`, r.kind === 'stand' && !r.fallback, `${r.kind} ${r.label}`);
  }
  // The stand the A380 gets is one the apron itself would park an A380 on.
  ok('gate: the apron parks its own A380 on a heavy gate of the same size (the plan the player now gets)', lay.stands.some((s) => s.occupant === 'a380' && s.size === 'heavy' && s.bridge));
});

/* ---------------- 4. butter ---------------- */

await tryRun('butter', async () => {
  const TD = await load('src/ui/touchdown.js');
  const R = await load('src/features/achievements/rules.js');
  const D = await load('src/features/achievements/data.js');
  const Store = await load('src/features/achievements/store.js');
  const cardSays = TD.landingGrade(-100).word;
  const s = Store.blank();
  const got = R.applyEvent(s, 'touchdown', { vsFpm: -100 });
  ok('butter: a 100 ft/min landing the card calls Butter unlocks the Butter achievement', cardSays === 'Butter' && got.includes('butter-landing'), `card "${cardSays}", unlocked [${got.join(',')}]`);
  const s2 = Store.blank();
  const at = R.applyEvent(s2, 'touchdown', { vsFpm: -120 });
  ok('butter: at 120 the card says Smooth, and the achievement does not unlock', TD.landingGrade(-120).word !== 'Butter' && !at.includes('butter-landing'), `${TD.landingGrade(-120).word}`);
  // Every rate either agrees or disagrees — check them all, 0 to 300.
  const disagree = [];
  for (let v = 0; v <= 300; v += 0.5) {
    const card = TD.landingGrade(-v).id === 'butter';
    const ach = R.applyEvent(Store.blank(), 'touchdown', { vsFpm: -v }).includes('butter-landing');
    if (card !== ach) disagree.push(v);
  }
  ok('butter: the card and the achievement agree at every rate from 0 to 300 ft/min', disagree.length === 0, disagree.length ? `${disagree[0]}..${disagree[disagree.length - 1]} (${disagree.length})` : 'all agree');
  const a = D.ACHIEVEMENTS.find((x) => x.id === 'butter-landing');
  const butter = TD.GRADES.find((g) => g.id === 'butter');
  ok('butter: the description names the card\'s number (120), not 60', a && butter && a.how.includes(`${butter.max} ft/min`) && !/\b60\b/.test(a.how), a && a.how);
  ok('butter: the card\'s Butter band is the one shared number', TD.BUTTER_FPM === 120 && butter.max === TD.BUTTER_FPM, `${TD.BUTTER_FPM} ${butter && butter.max}`);
  // A Butter earned under the old rule is still earned: saved, loaded, and a hard landing later.
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const old = Store.blank();
  old.unlocked['butter-landing'] = '2026-09-01T10:00:00.000Z';
  Store.save(old, storage);
  const back = Store.load(storage);
  const again = R.applyEvent(back, 'touchdown', { vsFpm: -450 });
  const soft = R.applyEvent(back, 'touchdown', { vsFpm: -80 });
  ok('butter: one already earned stays earned, with its date, and is not announced twice', back.unlocked['butter-landing'] === '2026-09-01T10:00:00.000Z' && !again.includes('butter-landing') && !soft.includes('butter-landing'), JSON.stringify(back.unlocked));
});

/* ---------------- 3. small screens (the source; the layout itself is the browser check) ---------------- */

await tryRun('minimap', async () => {
  const js = text('src/ui/hud-stack.js');
  const css = text('styles/main.css');
  ok('minimap: the stack steps the minimap aside while warnings or answers do not fit', /yieldMap\(on\)/.test(js) && /hud-map-yield/.test(js) && /c\.prio < 1 \|\| c\.keep/.test(js));
  ok('minimap: it fades (opacity, then hidden) and the column takes its room; a touch column is never lowered over the controls', /html\.hud-map-yield #ui > \.minimap \{[^}]*opacity: 0[^}]*visibility: hidden/.test(css) && /\.hud\.has-minimap\.rs-yield:not\(\.is-touch\) \{ --rs-bottom: 68px; \}/.test(css));
  ok('minimap: a landscape phone moves the column into the map\'s corner, above the stick', /@media \(max-height: 460px\) \{\s*\.hud\.is-touch\.rs-yield/.test(css));
  // Only where it gains room: an upright phone keeps its map.
  ok('minimap: it only steps aside where that gives the column room', /_noGain/.test(js));
});

/* ---------------- 1. the radio key ---------------- */

await tryRun('radio', async () => {
  await load('src/features/index.js');
  const I = await load('src/flight/input.js');
  const PS = await load('src/features/pilot-systems.js');
  const A = I.ACTIONS.atcRequest;
  ok('radio: F8 first, then a plain letter, Z (Insert kept for a full keyboard)', A && A.default[0] === 'F8' && A.default.includes('KeyZ') && A.default.includes('Insert'), A && A.default.join());
  const letters = (A ? A.default : []).filter((c) => /^Key[A-Z]$/.test(c));
  // Who else answers to that letter in the cockpit, the helicopter included?
  const others = [];
  for (const id in I.ACTIONS) {
    if (id === 'atcRequest') continue;
    const a = I.ACTIONS[id];
    if (!a.ctx.some((c) => c === 'plane' || c === 'heli')) continue;
    if (a.default.some((c) => letters.includes(c))) others.push(id);
  }
  ok('radio: in the aeroplane and the helicopter the letter is shared only with the Meteor zapper (it only listens in a zap mode)', letters.length === 1 && others.join() === 'zap', `${letters.join()} also: ${others.join(', ') || 'nobody'}`);
  const clashes = I.findConflicts(I.defaultBindings());
  ok('radio: no default key clashes (Settings shows no clash on the radio)', !clashes.atcRequest && Object.keys(clashes).length === 0, JSON.stringify(clashes).slice(0, 200));

  I.setMacKeyboard(false);
  ok('radio: off a Mac the hint reads "F8 or Z"', typeof PS.radioKeyName === 'function' && PS.radioKeyName(null) === 'F8 or Z', typeof PS.radioKeyName === 'function' ? PS.radioKeyName(null) : 'no radioKeyName');
  I.setMacKeyboard(true);
  ok('radio: on a Mac it reads "fn F8 or Z", and the key lists say fn F8', typeof PS.radioKeyName === 'function' && PS.radioKeyName(null) === 'fn F8 or Z' && I.keyLabel('F8') === 'fn F8' && I.shortKey('F8') === 'fn F8' && I.keyName('atcRequest') === 'fn F8',
    `${typeof PS.radioKeyName === 'function' ? PS.radioKeyName(null) : '—'} / ${I.keyLabel('F8')} / ${I.keyName('atcRequest')}`);
  ok('radio: on a Mac the H card and Settings name it the same way', /fn F8/.test(I.keyLabel('F8')));
  I.setMacKeyboard(null);

  // Saved keys from before: Z is added once; a player's own Z elsewhere is kept, and then the radio goes without.
  const v2 = { ...I.defaultBindings(), atcRequest: ['Insert', 'F8'], zap: ['KeyZ'], _v: 2 };
  const m1 = I.migrateSaved(v2);
  ok('radio: a set saved before (Insert, F8) becomes F8, Z, Insert', m1.bindings.atcRequest && m1.bindings.atcRequest.join() === 'F8,KeyZ,Insert' && m1.moved.includes('atcRequest'), m1.bindings.atcRequest);
  const mine = { ...I.defaultBindings(), atcRequest: ['Insert', 'F8'], smoke: ['KeyZ'], zap: ['KeyX'], _v: 2 };
  const m2 = I.migrateSaved(mine);
  ok('radio: if the player had put smoke on Z, the radio does not take Z from it', m2.bindings.atcRequest && !m2.bindings.atcRequest.includes('KeyZ') && m2.bindings.atcRequest.includes('F8') && m2.bindings.smoke.join() === 'KeyZ', `${m2.bindings.atcRequest} / smoke ${m2.bindings.smoke}`);
  const changed = { ...I.defaultBindings(), atcRequest: ['F7'], _v: 2 };
  ok('radio: a radio key the player chose is kept exactly', I.migrateSaved(changed).bindings.atcRequest.join() === 'F7');

  // The key itself, in the cockpit: Z opens the radio; in a zap mode Z is the zapper's.
  const savedDoc = globalThis.document;
  delete globalThis.document; // the card's DOM is the browser check's; here only the decision
  try {
    const sim = { state: 'flying', mode: 'free', aircraft: { pos: { x: 0, y: 100, z: 0 } }, aircraftType: null, input: { bindings: I.defaultBindings() } };
    const took = PS.handleKey(sim, 'KeyZ', true, { repeat: false });
    PS.handleKey(sim, 'KeyZ', false, { repeat: false });
    sim.meteors = { zapping: true };
    const zapMode = PS.handleKey(sim, 'KeyZ', true, { repeat: false });
    const f8 = PS.handleKey(sim, 'F8', true, { repeat: false });
    ok('radio: in the cockpit Z is the radio\'s; in a zap mode it is left to the zapper and F8 still works', took === true && zapMode === false && f8 === true, `Z ${took}, Z zapping ${zapMode}, F8 ${f8}`);
    ok('radio: in a zap mode the hint leaves Z out (it zaps then) and still names F8', /^F8\b/.test(PS.radioKeyName(sim)) && !/\bZ\b/.test(PS.radioKeyName(sim)), PS.radioKeyName(sim));
  } finally {
    globalThis.document = savedDoc;
  }

  // Typing never presses it: both key paths ignore text fields (and the extensions' now contenteditable too).
  const ext = text('src/game/extensions.js');
  const inp = text('src/flight/input.js');
  ok('radio: a key typed into a text field or an editable box never reaches the radio', /INPUT\|SELECT\|TEXTAREA\)\$\/\.test\(t\.tagName\) \|\| t\.isContentEditable/.test(ext) && /isContentEditable/.test(inp));
  // A touch screen keeps its own button.
  const touch = text('src/ui/touch.js');
  ok('radio: the touch sheet still has its RADIO (ATC) button', /'RADIO \(ATC\)', 'atcRequest'/.test(touch));
});

/* ---------------- report ---------------- */

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
