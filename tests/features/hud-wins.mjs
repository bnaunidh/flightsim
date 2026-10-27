/**
 * Node checks for the HUD quick wins (w7-hud): the touchdown card's grades
 * and personal bests (ui/touchdown.js), the state pills' rules (ui/pills.js),
 * the destination ribbon's arithmetic (ui/ribbon.js), the conditions words
 * and the HUD-mode cycle (ui/conditions.js), the mode key in the registry,
 * and the mission runner's destination(). Run from the repo root:
 *
 *   node tests/features/hud-wins.mjs
 *
 * The same things in a real page are tests/features/hud-wins.browser.js.
 */

import { readFileSync } from 'node:fs';

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
    classList: { add() {}, toggle() {}, remove() {}, contains: () => false },
    setAttribute() {},
    appendChild() {},
    insertBefore() {},
    addEventListener() {},
    querySelector: () => ({ textContent: '' }),
    children: [],
    dataset: {},
  }),
  body: { appendChild() {} },
};

const root = new URL('../../', import.meta.url);
const load = (p) => import(new URL(p, root).href);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
}

/* ---------------- 1. the touchdown card ---------------- */
const T = await load('src/ui/touchdown.js');
const grades = [119, 120, 239, 240, 399, 400, 599, 600, 1200].map((v) => `${v}:${T.landingGrade(-v).word}/${T.landingGrade(v).stars}`);
ok(
  'touchdown: Butter under 120, Smooth under 240, Firm under 400, Hard under 600, then Ouch — either sign, 3/2/1/0/0 stars',
  grades.join(' ') === '119:Butter/3 120:Smooth/2 239:Smooth/2 240:Firm/1 399:Firm/1 400:Hard/0 599:Hard/0 600:Ouch/0 1200:Ouch/0',
  grades.join(' ')
);
ok('touchdown: the grade carries the rounded rate', T.landingGrade(-84.6).rate === 85 && T.landingGrade('x').rate === 0, JSON.stringify(T.landingGrade(-84.6)));
ok('touchdown: three stars as text, lit then dim', T.starsHtml(2).split('is-lit').length === 3 && T.starsHtml(2).split('is-dim').length === 2 && T.starsHtml(0).split('is-dim').length === 4, T.starsHtml(2));

// A localStorage stand-in.
const mem = new Map();
const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
const b1 = T.noteBest('skylark', -140, store);
const b2 = T.noteBest('skylark', -85, store);
const b3 = T.noteBest('skylark', -300, store);
const b4 = T.noteBest('jet', -500, store);
ok('touchdown: the first landing in an aeroplane is its best (no previous)', b1.isNew && b1.previous === null && b1.best === 140, JSON.stringify(b1));
ok('touchdown: a smoother landing is a new best and remembers the old one', b2.isNew && b2.previous === 140 && b2.best === 85, JSON.stringify(b2));
ok('touchdown: a heavier landing is not, and the best stands', !b3.isNew && b3.previous === 85 && b3.best === 85, JSON.stringify(b3));
ok('touchdown: bests are per aeroplane', b4.isNew && b4.previous === null && T.loadBests(store).skylark.rate === 85 && T.loadBests(store).jet.rate === 500, JSON.stringify(T.loadBests(store)));
ok('touchdown: saved under islandsim.touchdowns.v1 with the grade and the date', (() => {
  const v = JSON.parse(mem.get('islandsim.touchdowns.v1'));
  return v.skylark.grade === 'butter' && /^\d{4}-\d{2}-\d{2}$/.test(v.skylark.date);
})(), mem.get('islandsim.touchdowns.v1'));
const broken = { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('full'); } };
const b5 = T.noteBest('skylark', -90, broken);
ok('touchdown: a storage that throws still gives the card its lines', b5.isNew && b5.best === 90 && Object.keys(T.loadBests(broken)).length === 0, JSON.stringify(b5));
ok('touchdown: the best line in words — first / new best / your best', (() => {
  const a = T.bestLine({ isNew: true, previous: null, best: 140 }, 'Skylark');
  const b = T.bestLine({ isNew: true, previous: 140, best: 85 }, 'Skylark');
  const c = T.bestLine({ isNew: false, previous: 85, best: 85 }, 'Skylark');
  return /first landing in the Skylark/.test(a) && /New personal best in the Skylark · was 140/.test(b) && /Your best in the Skylark: 85 ft\/min/.test(c);
})(), [T.bestLine({ isNew: true, previous: null, best: 140 }, 'Skylark'), T.bestLine({ isNew: false, previous: 85, best: 85 }, 'Skylark')].join(' | '));
const card = new T.TouchdownCard();
ok('touchdown: a crashed landing gets no card', card.show({ crashed: true, vsFpm: -900 }, { id: 'x' }, store) === null, '');

/* ---------------- 2. the state pills ---------------- */
const P = await load('src/ui/pills.js');
const keys = { power: 'Shift', services: 'P', gear: 'G' };
const ground = P.pillsFor({ onGround: true, parkingBrake: true, engineOn: true, gearPos: 1, aglFt: 0, speedKts: 0, vsFpm: 0, keys });
ok('pills: parking brake on, engine running — one amber pill that says how to release it', ground.length === 1 && ground[0].id === 'parking' && ground[0].level === 'warn' && ground[0].text === 'Parking brake on' && ground[0].how === 'Shift (power) releases it' && ground[0].action === 'releaseBrake', JSON.stringify(ground));
const cold = P.pillsFor({ onGround: true, parkingBrake: true, engineOn: false, gearPos: 1, keys });
ok('pills: parking brake with the engine off is information, not a warning', cold.length === 1 && cold[0].level === 'info', JSON.stringify(cold));
const touch = P.pillsFor({ onGround: true, parkingBrake: true, engineOn: true, gearPos: 1, touch: true, keys });
ok('pills: on a touchscreen the pill says "tap to release"', touch[0].how === 'tap to release', JSON.stringify(touch));
const push = P.pillsFor({ onGround: true, parkingBrake: true, pushing: true, engineOn: true, gearPos: 1, keys });
ok('pills: pushing back — the tug pill, and no parking-brake pill under it', push.length === 1 && push[0].id === 'pushback' && push[0].text === 'Pushing back' && /P stops/.test(push[0].how) && push[0].action === 'stopPush', JSON.stringify(push));
const gear = P.pillsFor({ onGround: false, parkingBrake: false, gearPos: 0, aglFt: 300, speedKts: 70, vsFpm: -400, keys });
ok('pills: gear up, low, slow and descending — the red pill, with the gear key', gear.length === 1 && gear[0].id === 'gear' && gear[0].level === 'bad' && gear[0].text === 'Gear up — low and slow?' && /G drops the gear/.test(gear[0].how) && gear[0].action === 'gear', JSON.stringify(gear));
const noGear = [
  P.pillsFor({ onGround: false, gearPos: 0, aglFt: 900, speedKts: 70, vsFpm: -400 }),
  P.pillsFor({ onGround: false, gearPos: 0, aglFt: 300, speedKts: 200, vsFpm: -400 }),
  P.pillsFor({ onGround: false, gearPos: 0, aglFt: 300, speedKts: 70, vsFpm: 300 }),
  P.pillsFor({ onGround: false, gearPos: 1, aglFt: 300, speedKts: 70, vsFpm: -400 }),
  P.pillsFor({ onGround: true, gearPos: 0, aglFt: 0, speedKts: 70, vsFpm: 0 }),
];
ok('pills: no gear pill when high, fast, climbing, gear down, or on the ground', noGear.every((l) => !l.some((p) => p.id === 'gear')), JSON.stringify(noGear.map((l) => l.map((p) => p.id))));
const busy = P.pillsFor({ onGround: false, parkingBrake: true, pushing: true, gearPos: 0, aglFt: 100, speedKts: 60, vsFpm: -300, keys });
ok('pills: worst first, and never more than two', busy.length <= P.MAX_PILLS && busy[0].id === 'gear' && P.MAX_PILLS === 2, JSON.stringify(busy.map((p) => `${p.id}:${p.level}`)));
ok('pills: nothing to say — an empty lane', P.pillsFor({ onGround: false, gearPos: 1, aglFt: 2000, speedKts: 100, vsFpm: 0 }).length === 0 && P.pillsFor().length === 0, '');

/* ---------------- 3. the destination ribbon ---------------- */
const R = await load('src/ui/ribbon.js');
const here = { x: 0, z: 0 };
const b = [R.bearingDeg(here, { x: 0, z: -100 }), R.bearingDeg(here, { x: 100, z: 0 }), R.bearingDeg(here, { x: 0, z: 100 }), R.bearingDeg(here, { x: -100, z: 0 })].map(Math.round);
ok('ribbon: bearings — north 0, east 90, south 180, west 270 (world x east, z south)', b.join() === '0,90,180,270', b.join());
ok('ribbon: relative bearing wraps to -180..180', R.relDeg(10, 350) === 20 && R.relDeg(350, 10) === -20 && R.relDeg(180, 0) === -180 || R.relDeg(180, 0) === 180, `${R.relDeg(10, 350)} ${R.relDeg(350, 10)} ${R.relDeg(180, 0)}`);
ok('ribbon: distance text — km past 1.2 km, tens of metres, fives inside 125 m', R.distText(4321) === '4.3 km' && R.distText(640) === '640 m' && R.distText(644) === '640 m' && R.distText(97) === '95 m', `${R.distText(4321)} ${R.distText(644)} ${R.distText(97)}`);
const m1 = R.markerOffset(20);
const m2 = R.markerOffset(150);
const m3 = R.markerOffset(-150);
ok('ribbon: the marker sits at 2.2 px a degree and clamps to the edge when the place is behind you', Math.abs(m1.px - 44) < 0.01 && !m1.behind && m2.behind && m3.behind && m2.px === -m3.px && m2.px > 0, JSON.stringify([m1, m2, m3]));
const rib = new R.DestRibbon();
ok('ribbon: a free flight has the heading tape (the compass) but no target marker or name', (() => {
  rib.update(90, here, null, null);
  return rib.shown === !!rib.el && !rib.hasTarget;
})(), '');
ok('ribbon: the heading box reads three digits, 360 for north', R.headingText(87.4) === '087' && R.headingText(0) === '360' && R.headingText(359.6) === '360' && R.headingText(-90) === '270', [87.4, 0, 359.6, -90].map(R.headingText).join(' '));
ok('ribbon: ticks every 5 degrees, longer every 10, labelled every 30', R.tickKind(5) === 'minor' && R.tickKind(10) === 'mid' && R.tickKind(30) === 'major' && R.tickKind(-30) === 'major' && R.tickKind(355) === 'minor', [5, 10, 30, -30, 355].map(R.tickKind).join(' '));

/* ---------------- 4. the conditions words and the HUD modes ---------------- */
const C = await load('src/ui/conditions.js');
const winds = [0, 1, 2, 7, 8, 14, 15, 23, 24, 40].map((k) => `${k}:${C.windWord(k)}`).join(' ');
ok('conditions: wind words — calm, light breeze, breezy, windy, gale', winds === '0:calm 1:calm 2:light breeze 7:light breeze 8:breezy 14:breezy 15:windy 23:windy 24:gale 40:gale', winds);
ok('conditions: "Midday · clear skies · light breeze"', C.conditionsWords({ timeLabel: 'Midday', condLabel: 'Clear', windKts: 4 }) === 'Midday · clear skies · light breeze' && C.conditionsWords({ timeLabel: 'Night', condLabel: 'Stormy', windKts: 26 }) === 'Night · storm · gale', C.conditionsWords({ timeLabel: 'Night', condLabel: 'Stormy', windKts: 26 }));
ok('conditions: the modes cycle clean → photo → full → clean, and an unknown mode starts from clean', C.nextDensity('clean') === 'photo' && C.nextDensity('photo') === 'full' && C.nextDensity('full') === 'clean' && C.nextDensity(undefined) === 'photo', '');
ok('conditions: every mode has its words', C.DENSITIES.every((d) => C.DENSITY_WORDS[d] && C.DENSITY_SHORT[d]), JSON.stringify(C.DENSITY_SHORT));

/* ---------------- 5. the key ---------------- */
await load('src/features/index.js');
const I = await load('src/flight/input.js');
const a = I.ACTIONS.hudMode;
ok('key: hudMode is in the registry, in the View group, in the plane, helicopter, boat and car', !!a && a.group === 'View' && ['plane', 'heli', 'boat', 'car'].every((c) => a.ctx.includes(c)), JSON.stringify(a));
ok('key: H is the controls card, so the mode takes a free key (Delete) that nobody else answers to', a.default.join() === 'Delete' && I.ACTIONS.help.default.join() === 'KeyH' && Object.entries(I.ACTIONS).filter(([id, x]) => id !== 'hudMode' && x.default.includes('Delete')).length === 0, a.default.join());
ok('key: no clash anywhere in the defaults', Object.keys(I.findConflicts(I.defaultBindings())).length === 0, JSON.stringify(I.findConflicts(I.defaultBindings())).slice(0, 200));
ok('key: the hint names it', I.keyName('hudMode') === 'Delete' && I.shortKey('Delete') === 'Delete', I.keyName('hudMode'));

/* ---------------- 6. the runner's destination ---------------- */
const RU = await load('src/game/runner.js');
const sim = { aircraft: {}, weather: {}, audio: {}, vehicle: null };
const run = new RU.MissionRunner(sim);
const A = { x: 1, z: 1 };
const B = { x: 900, z: -400 };
run.def = { steps: [{ target: () => A, targetLabel: 'Runway 09' }, { check: () => false }, { target: () => B, targetLabel: 'Mango Cay' }, { text: 'done' }] };
run.status = RU.STATUS.RUNNING;
const d = run.destination();
ok('runner: destination() is the last step that names a place', d && d.pos === B && d.label === 'Mango Cay', JSON.stringify(d));
run.status = RU.STATUS.COMPLETE;
ok('runner: and nothing once the mission is over', run.destination() === null, '');
run.status = RU.STATUS.RUNNING;
run.def = { steps: [{ target: () => { throw new Error('no ctx yet'); }, targetLabel: 'X' }, { target: () => A, targetLabel: 'A' }] };
ok('runner: a target that throws is skipped, not fatal', run.destination() && run.destination().label === 'A', '');

/* ---------------- 7. wired in ---------------- */
const hud = read('src/ui/hud.js');
const main = read('src/main.js');
const css = read('styles/main.css');
const menus = read('src/ui/menus.js');
ok('wired: the HUD builds the card, the pills, the ribbon and the chip', /new TouchdownCard\(\)/.test(hud) && /new PillLane\(/.test(hud) && /new DestRibbon\(\)/.test(hud) && /hud-wxchip/.test(hud) && /pillsFor\(\{/.test(hud) && /conditionsWords\(/.test(hud), '');
ok('wired: a landing shows the card, not the old banner', /this\.hud\.showTouchdown\(g, this\.aircraftType\)/.test(main) && !/perfect: \['Perfect landing!'/.test(main), '');
ok('wired: the mode key is read in the flying loop and the driving loop, and the undo actions exist', (main.match(/input\.pressed\('hudMode'\)/g) || []).length >= 2 && /case 'hudMode':/.test(main) && /case 'releaseBrake':/.test(main) && /case 'stopPush':/.test(main) && /cycleHudMode\(\)/.test(main), '');
ok('wired: the destination beacon is built, targeted from the runner and never doubled on the guidance beacon', /new Beacon\(this\.scene, \{ soft: true \}\)/.test(main) && /this\.runner\.destination\(\)/.test(main) && /covered/.test(main), '');
ok('wired: Settings → HUD density offers Photo', /<option value="photo">/.test(menus), '');
ok('wired: the stylesheet has the lane, the card, the tape, the chip and Photo', ['.hud-pills {', '.hud-touchdown {', '.hud-dest-tape {', '.hud-right.rs-chip .hud-wxchip', '.hud.is-photo .hud-left', 'html.hud-photo #ui .minimap'].every((s) => css.includes(s)), '');
ok('wired: the pills lane is one of the controls the radio line clears, and measures its own floor without itself', /'#ui \.hud-pills'/.test(hud) && /--bl-ctl/.test(hud) && /--bl-ctl/.test(css), '');

/* ---------------- 8. checker fixes (2026-10-24) ---------------- */
const held = new T.TouchdownCard();
held.show({ crashed: false, vsFpm: -150, score: 80 }, { id: 'held' }, store);
held.update(1, true);
const heldOff = held.el.style.display === 'none' && Math.abs(held.timer - 6.5) < 1e-9;
held.update(1, false);
ok('checker: the card is held, not dropped, while PULL UP has the lane — and comes back with its time', heldOff && held.el.style.display === '' && Math.abs(held.timer - 5.5) < 1e-9, `timer ${held.timer}`);
let calls = 0;
run.status = RU.STATUS.RUNNING;
run.def = { steps: [{ target: () => { calls++; return B; }, targetLabel: 'B' }] };
run.elapsed = 3;
run.destination();
run.destination();
const sameFrame = calls;
run.elapsed = 3.03;
run.destination();
ok('checker: destination() walks the steps once a frame, not once a caller', sameFrame === 1 && calls === 2, `calls ${sameFrame} then ${calls}`);
ok('checker: Photo is not where the next visit starts', /if \(this\.settings\.hudDensity === 'photo'\) this\.settings\.hudDensity = 'clean';/.test(main), '');
ok('checker: a pill stays a minimum time (no red flicker on a threshold), and goes at once when tapped', /MIN_SHOW_MS = 1500/.test(read('src/ui/pills.js')) && /mine\.at = -Infinity/.test(read('src/ui/pills.js')) && /this\.pills\.clear\(\)/.test(hud), '');
ok('checker: a phone keeps the touchdown card inside the centre lane, and the touch pills sit just over the controls', /\.hud-touchdown \{ min-width: 0;/.test(css) && /\.hud\.is-touch \.hud-pills \{ bottom: calc\(var\(--bl-ctl, 0px\) \+ 10px\); \}/.test(css), '');
ok('checker: Photo keeps a red pill (a warning)', /\.hud\.is-photo \.hud-pill:not\(\.is-bad\)/.test(css) && !/\.hud\.is-photo \.hud-pills,/.test(css), '');

/* ---------------- report ---------------- */
const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
