/**
 * Node checks for the instruments team — run with plain node from the repo:
 *
 *   node tests/features/instruments.mjs
 *
 * No browser, no framework. A small fake DOM (enough for the minimap's canvas
 * and the warning panel's divs) is installed before anything is imported,
 * because terrain.js paints its textures at import time.
 *
 * What is covered:
 *
 *   1. The warning RULES (src/features/warnings-rules.js), with made-up
 *      readings: every alert fires in its own condition, a whole normal
 *      circuit — ground roll, lift-off, climb, level, turns, approach, flare,
 *      touchdown — lights nothing and gives the six height callouts in order,
 *      nothing flight-related fires on the ground, the helicopter only gets
 *      what applies to it, hysteresis and acknowledging stop the nagging, and
 *      TCAS reads traffic the way the contract says it may arrive.
 *   2. The look-ahead the map and the panel share (src/ui/minimap.js): rising
 *      ground counts and the sea and the runway do not; the bounding-box
 *      reject takes no samples at all; going astern the boat looks astern.
 *   3. The Minimap itself, drawn into a recording canvas in a flight, a boat
 *      trip, a car job and the helicopter on the real maps, without an error,
 *      with the objective found in the boat and the van, a bad traffic entry
 *      survived, and the chart never asked for pixels it does not have.
 *   4. The feature glue (src/features/warnings.js) against a mock game: it
 *      plays what the rules decide, owns the gear horn and hands it back,
 *      speaks only when the player chose the speech voice, takes R, and gives
 *      the horn back if it ever throws.
 */

/* ------------------------------------------------------------------ */
/* A fake DOM, installed before any import                              */
/* ------------------------------------------------------------------ */

class FakeClassList {
  constructor() {
    this.s = new Set();
  }
  add(...c) {
    c.forEach((x) => this.s.add(x));
  }
  remove(...c) {
    c.forEach((x) => this.s.delete(x));
  }
  toggle(c, on) {
    const want = on === undefined ? !this.s.has(c) : !!on;
    if (want) this.s.add(c);
    else this.s.delete(c);
    return want;
  }
  contains(c) {
    return this.s.has(c);
  }
}

function fakeCtx(owner) {
  const rec = (owner.rec = { texts: [], blits: [], ops: 0 });
  const target = {
    canvas: owner,
    measureText: (t) => ({ width: String(t).length * 5 }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(4), width: w, height: h }),
    fillText: (t, x, y) => rec.texts.push({ t: String(t), x, y }),
    drawImage: (img, ...a) => rec.blits.push({ w: img && img.width, h: img && img.height, a }),
  };
  return new Proxy(target, {
    get(o, k) {
      if (k in o) return o[k];
      return () => {
        rec.ops++;
        return { addColorStop() {}, data: new Uint8ClampedArray(4) };
      };
    },
    set(o, k, v) {
      o[k] = v;
      return true;
    },
  });
}

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.style = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.hidden = false;
    this.textContent = '';
    this.innerHTML = '';
    this.width = 0;
    this.height = 0;
    this.clientWidth = 190;
    this.listeners = {};
    this.attrs = {};
  }
  appendChild(c) {
    this.children.push(c);
    c.parentNode = this;
    return c;
  }
  addEventListener(t, f) {
    (this.listeners[t] = this.listeners[t] || []).push(f);
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  getContext() {
    return this._ctx || (this._ctx = fakeCtx(this));
  }
  get className() {
    return [...this.classList.s].join(' ');
  }
  set className(v) {
    this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean));
  }
}

globalThis.document = {
  createElement: (t) => new FakeEl(t),
  body: new FakeEl('body'),
  head: new FakeEl('head'),
  documentElement: new FakeEl('html'),
  getElementById: () => null,
};

/* ------------------------------------------------------------------ */
/* Reporting                                                            */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  return !!pass;
}

const root = new URL('../../', import.meta.url);
const R = await import(new URL('src/features/warnings-rules.js', root));
const MM = await import(new URL('src/ui/minimap.js', root));
const T = await import(new URL('src/world/terrain.js', root));
const P = await import(new URL('src/aircraft/physics.js', root));
const PADS = await import(new URL('src/world/pads.js', root));

/* ------------------------------------------------------------------ */
/* 1. The rules                                                         */
/* ------------------------------------------------------------------ */

function reading(o = {}) {
  return {
    kind: 'plane',
    category: 'light',
    inhibit: false,
    airborne: true,
    crashed: false,
    aglFt: 2000,
    altFt: 2050,
    vsFpm: 0,
    iasKt: 95,
    bankDeg: 0,
    gearDown: true,
    flapStep: 0,
    throttle: 0.6,
    needsFlaps: false,
    stallLandingKt: 40,
    vneKt: 159,
    stallWarn: false,
    fuelFrac: 0.8,
    engineOn: true,
    engineStarting: false,
    engineFailed: false,
    engineStopReason: null,
    engineRough: false,
    fuelLeak: false,
    fire: false,
    fireOut: false,
    apOffEvent: false,
    terrainS: Infinity,
    windshearF: 0,
    tcasLevel: 0,
    tcasSense: null,
    speedKt: 0,
    shoalS: Infinity,
    aground: false,
    ...o,
  };
}

/** Run the engine through `seconds` of the same reading; what came on, what played. */
function hold(E, r, seconds, dt = 1 / 30) {
  const on = new Set();
  const plays = [];
  for (let t = 0; t < seconds; t += dt) {
    R.evaluate(E, r, dt);
    for (const ev of E.events) if (ev.type === 'on') on.add(ev.id);
    if (E.play) plays.push(E.play);
  }
  return { on, plays, lit: new Set(R.ORDER.filter((id) => E.alerts[id].on)) };
}

function fires(name, r, id, seconds = 3) {
  const E = R.createEngine();
  const h = hold(E, r, seconds);
  return ok(`rules: ${name}`, h.lit.has(id) || h.on.has(id), `lit: ${[...h.lit].join(', ') || 'nothing'}`);
}
function silent(name, r, ids, seconds = 3) {
  const E = R.createEngine();
  const h = hold(E, r, seconds);
  const bad = ids ? ids.filter((id) => h.on.has(id)) : [...h.on];
  return ok(`rules: ${name}`, bad.length === 0, bad.join(', ') || 'clear');
}

// ---- A normal circuit, frame by frame -------------------------------
function circuit(profile) {
  const E = R.createEngine();
  const dt = 1 / 30;
  const on = [];
  const callouts = [];
  const step = (r) => {
    R.evaluate(E, r, dt);
    for (const ev of E.events) if (ev.type === 'on') on.push(ev.id);
    if (E.play && E.play.sound === 'radioAltitude') callouts.push(E.play.arg);
  };
  const p = profile;
  let alt = p.elev;
  // Ground roll to rotation.
  for (let t = 0; t < 20; t += dt) step(reading({ ...p.base, airborne: false, aglFt: 0, altFt: alt, iasKt: (t / 20) * p.vr, throttle: 1 }));
  // Climb to 1,000 ft at the climb rate, full power, gear coming up.
  let agl = 0;
  while (agl < 1000) {
    agl += (p.climb / 60) * dt;
    step(reading({ ...p.base, aglFt: agl, altFt: p.elev + agl, vsFpm: p.climb, iasKt: p.vy, throttle: 1, gearDown: agl < 300 || !p.retract }));
  }
  // Level, then a turn each way at the circuit bank.
  for (let t = 0; t < 30; t += dt) step(reading({ ...p.base, aglFt: 1000, altFt: p.elev + 1000, iasKt: p.cruise, gearDown: !p.retract }));
  for (let t = 0; t < 60; t += dt) {
    const bank = t < 30 ? p.bank : -p.bank;
    step(reading({ ...p.base, aglFt: 1000, altFt: p.elev + 1000, iasKt: p.cruise, bankDeg: bank, gearDown: !p.retract }));
  }
  // Approach: gear down, flap, descending at the approach rate, flare, touchdown.
  agl = 1000;
  while (agl > 0) {
    let vs = -p.descent;
    if (agl < 30) vs = -180;
    if (agl < 10) vs = -60;
    agl = Math.max(0, agl + (vs / 60) * dt);
    step(
      reading({
        ...p.base,
        aglFt: agl,
        altFt: p.elev + agl,
        vsFpm: vs,
        iasKt: p.vapp,
        gearDown: true,
        flapStep: p.flaps,
        throttle: agl < 20 ? 0 : 0.35,
        airborne: agl > 0,
      })
    );
  }
  // Roll-out.
  for (let t = 0; t < 15; t += dt) step(reading({ ...p.base, airborne: false, aglFt: 0, altFt: p.elev, iasKt: Math.max(0, p.vapp - t * 5), throttle: 0 }));
  return { on, callouts };
}

{
  const trainer = circuit({
    elev: 46,
    base: { category: 'light', needsFlaps: false, stallLandingKt: 40, vneKt: 159 },
    vr: 56,
    vy: 70,
    climb: 650,
    cruise: 100,
    bank: 30,
    descent: 650,
    vapp: 68,
    flaps: 2,
    retract: false,
  });
  ok('rules: a normal circuit in the trainer lights nothing', trainer.on.length === 0, trainer.on.join(', ') || 'clear');
  ok('rules: callouts 100 50 40 30 20 10 on landing, once each, in order', trainer.callouts.join(' ') === '100 50 40 30 20 10', trainer.callouts.join(' '));
  {
    // A flare that floats: through 25 ft the descent is arrested to almost
    // nothing, and twenty is crossed at 20 ft/min. Still said, once.
    const E = R.createEngine();
    const dt = 1 / 30;
    const said = [];
    let agl = 300;
    while (agl > 0) {
      const vs = agl > 25 ? -500 : agl > 18 ? -20 : -120;
      agl = Math.max(0, agl + (vs / 60) * dt);
      R.evaluate(E, reading({ aglFt: agl, altFt: 46 + agl, vsFpm: vs, iasKt: 62, gearDown: true, flapStep: 2, throttle: 0.1, airborne: agl > 0 }), dt);
      if (E.play && E.play.sound === 'radioAltitude') said.push(E.play.arg);
    }
    ok('rules: a floating flare still gets "twenty" — crossed at 20 ft/min', said.join(' ') === '100 50 40 30 20 10', said.join(' '));
    // Climbing away through the marks (a go-around over rising ground) says nothing.
    const E2 = R.createEngine();
    const up = [];
    R.evaluate(E2, reading({ aglFt: 300, vsFpm: 800 }), dt);
    for (let a = 120; a > 0; a -= 2) {
      R.evaluate(E2, reading({ aglFt: a, vsFpm: 800 }), dt);
      if (E2.play && E2.play.sound === 'radioAltitude') up.push(E2.play.arg);
    }
    ok('rules: climbing hard, the ground coming up under you is not a landing callout', up.length === 0, up.join(' ') || 'none');
  }

  const airliner = circuit({
    elev: 46,
    base: { category: 'airliner', needsFlaps: true, stallLandingKt: 72, vneKt: 327 },
    vr: 130,
    vy: 160,
    climb: 1800,
    cruise: 200,
    bank: 25,
    descent: 800,
    vapp: 135,
    flaps: 3,
    retract: true,
  });
  ok('rules: a normal circuit in the airliner (gear up, flaps) lights nothing', airliner.on.length === 0, airliner.on.join(', ') || 'clear');
}

// ---- Every alert, in its own condition ------------------------------
fires('SINK RATE at 1,000 ft coming down at 3,000 ft/min', reading({ aglFt: 1000, vsFpm: -3000 }), 'sinkrate');
silent('no SINK RATE at 1,000 ft coming down at 2,000 ft/min', reading({ aglFt: 1000, vsFpm: -2000 }), ['sinkrate', 'pullup']);
fires('PULL UP at 500 ft coming down at 3,500 ft/min', reading({ aglFt: 500, vsFpm: -3500 }), 'pullup');
{
  const E = R.createEngine();
  const h = hold(E, reading({ aglFt: 500, vsFpm: -3500 }), 3);
  ok('rules: PULL UP replaces SINK RATE, it does not stack on it', h.lit.has('pullup') && !h.lit.has('sinkrate'), [...h.lit].join(', '));
}
fires('TERRAIN AHEAD with high ground 25 s away', reading({ terrainS: 25 }), 'terrainAhead');
fires('TERRAIN with high ground 10 s away', reading({ terrainS: 10 }), 'terrain');
{
  const E = R.createEngine();
  const h = hold(E, reading({ terrainS: 10 }), 5);
  ok('rules: TERRAIN ignored for three seconds becomes PULL UP', h.lit.has('pullup'), [...h.lit].join(', '));
}
{
  // Take off, climb to 400 ft, then sink 100 ft with the power on.
  const E = R.createEngine();
  const dt = 1 / 30;
  for (let t = 0; t < 3; t += dt) R.evaluate(E, reading({ airborne: false, aglFt: 0, altFt: 46, iasKt: 50, throttle: 1 }), dt);
  let agl = 0;
  while (agl < 400) {
    agl += (600 / 60) * dt;
    R.evaluate(E, reading({ aglFt: agl, altFt: 46 + agl, vsFpm: 600, iasKt: 65, throttle: 1 }), dt);
  }
  const lit = new Set();
  for (let t = 0; t < 12; t += dt) {
    agl -= (600 / 60) * dt;
    R.evaluate(E, reading({ aglFt: agl, altFt: 46 + agl, vsFpm: -600, iasKt: 75, throttle: 1 }), dt);
    for (const id of R.ORDER) if (E.alerts[id].on) lit.add(id);
  }
  ok("rules: DON'T SINK losing height after take-off", lit.has('dontsink'), [...lit].join(', ') || 'nothing');
}
fires('GEAR NOT DOWN: low, power back, descending, wheels up', reading({ aglFt: 400, vsFpm: -500, throttle: 0.2, gearDown: false }), 'gear');
fires('GEAR NOT DOWN: landing flap with the wheels up', reading({ aglFt: 1200, flapStep: 2, gearDown: false }), 'gear');
fires('GEAR NOT DOWN: GPWS too-low-gear (400 ft, descending, slow)', reading({ aglFt: 400, vsFpm: -700, throttle: 0.6, iasKt: 80, gearDown: false }), 'gear');
silent('no GEAR at 400 ft climbing away with power', reading({ aglFt: 400, vsFpm: 800, throttle: 1, gearDown: false }), ['gear']);
fires('TOO LOW FLAPS in the airliner at 200 ft, no flap', reading({ category: 'airliner', needsFlaps: true, stallLandingKt: 72, aglFt: 200, vsFpm: -700, iasKt: 125, flapStep: 0 }), 'flaps');
silent('no TOO LOW FLAPS in the trainer, which lands fine without', reading({ aglFt: 200, vsFpm: -700, iasKt: 65, flapStep: 0 }), ['flaps']);
fires('BANK ANGLE: trainer at 50 degrees', reading({ bankDeg: 50 }), 'bankangle');
fires('BANK ANGLE: airliner at 38 degrees', reading({ category: 'airliner', bankDeg: -38 }), 'bankangle');
silent('no BANK ANGLE: trainer at 40 degrees', reading({ bankDeg: 40 }), ['bankangle']);
silent('no BANK ANGLE: fighter rolling at 2,000 ft', reading({ category: 'military', bankDeg: 120 }), ['bankangle']);
fires('BANK ANGLE: fighter at 65 degrees at 500 ft', reading({ category: 'military', aglFt: 500, bankDeg: 65 }), 'bankangle');
fires('WINDSHEAR: F-factor 0.2 at 800 ft', reading({ aglFt: 800, windshearF: 0.2 }), 'windshear');
silent('no WINDSHEAR above 1,500 ft', reading({ aglFt: 2500, windshearF: 0.3 }), ['windshear']);
fires('STALL when the warner sounds', reading({ stallWarn: true }), 'stall');
fires('OVERSPEED above Vne', reading({ iasKt: 170 }), 'overspeed');
{
  const E = R.createEngine();
  hold(E, reading({ iasKt: 170 }), 2);
  const mid = hold(E, reading({ iasKt: 157 }), 3).lit.has('overspeed');
  const low = hold(E, reading({ iasKt: 150 }), 3).lit.has('overspeed');
  ok('rules: OVERSPEED has hysteresis (on at Vne, off below 97%)', mid && !low, `157 kt: ${mid}, 150 kt: ${low}`);
}
{
  const E = R.createEngine();
  const h = hold(E, reading({ fire: true }), 1);
  ok('rules: ENGINE FIRE lights and rings the fire bell', h.lit.has('engineFire') && h.plays.some((p) => p.sound === 'fireBell'), h.plays.map((p) => p.sound).join(', '));
}
fires('ENGINE FAIL when a failure stops the engine', reading({ engineOn: false, engineFailed: true, engineStopReason: 'failure' }), 'engineFail');
fires('ENGINE FAIL when it runs out of fuel', reading({ engineOn: false, engineStopReason: 'fuel' }), 'engineFail');
fires('ENGINE OFF (a caution) when you shut it down yourself', reading({ engineOn: false, engineStopReason: 'shutdown' }), 'engineOff');
silent('nothing about the engine when a glider mission starts with it off', reading({ engineOn: false, engineStopReason: null }), ['engineFail', 'engineOff']);
fires('ENGINE ROUGH', reading({ engineRough: true }), 'engineRough');
fires('LOW FUEL under 12%', reading({ fuelFrac: 0.1 }), 'lowFuel');
fires('FUEL LEAK', reading({ fuelLeak: true }), 'fuelLeak');
{
  const E = R.createEngine();
  const a = hold(E, reading({ apOffEvent: true }), 1 / 30);
  const b = hold(E, reading({}), 1);
  const c = hold(E, reading({}), 5);
  ok(
    'rules: AUTOPILOT OFF wails once, stays lit five seconds, then goes out',
    (a.lit.has('apOff') || b.lit.has('apOff')) && b.plays.concat(a.plays).some((p) => p.sound === 'autopilotOff') && !c.lit.has('apOff'),
    `then: ${[...c.lit].join(', ') || 'clear'}`
  );
}
fires('TCAS TRAFFIC', reading({ tcasLevel: 1 }), 'tcasTA');
{
  const E = R.createEngine();
  const h = hold(E, reading({ tcasLevel: 2, tcasSense: 'descend' }), 1);
  ok('rules: TCAS resolution says which way — DESCEND', h.lit.has('tcasRA') && E.tcasSense === 'descend' && h.plays.some((p) => p.arg === 'descend'), E.tcasSense);
  const after = hold(E, reading({ tcasLevel: 0 }), 4);
  ok('rules: CLEAR OF CONFLICT when it is over', !after.lit.has('tcasRA') && after.plays.some((p) => p.sound === 'tcasClear'), after.plays.map((p) => p.sound).join(', '));
}
fires('boat: SHALLOW WATER 20 s ahead', reading({ kind: 'boat', airborne: false, speedKt: 5, shoalS: 20 }), 'shoal');
// AGROUND is said three times already — main.js beeps, hud-boat.js captions
// it, the chart flashes — so the panel does not say it a fourth time, and a
// boat stuck on the bottom is not also "shallow water ahead".
silent('boat: aground is not the panel\'s to say', reading({ kind: 'boat', airborne: false, aground: true, speedKt: 2, shoalS: 3 }));
ok('boat: there is no AGROUND alert to double the others', !('aground' in R.DEFS), '');

// ---- Not on the ground, not in a boat -------------------------------
{
  const everything = {
    aglFt: 0,
    vsFpm: -4000,
    bankDeg: 70,
    gearDown: false,
    flapStep: 3,
    throttle: 0,
    stallWarn: true,
    iasKt: 200,
    fuelFrac: 0.05,
    engineRough: true,
    fuelLeak: true,
    fire: true,
    terrainS: 5,
    windshearF: 0.5,
    tcasLevel: 2,
    tcasSense: 'climb',
    apOffEvent: true,
  };
  silent('nothing at all fires on the ground', reading({ ...everything, airborne: false }));
  silent('no aircraft alert fires in the boat', reading({ ...everything, kind: 'boat', airborne: false }), R.ORDER.filter((id) => id !== 'shoal'));
  silent('nothing fires in the van', reading({ ...everything, kind: 'car', airborne: false }));
}

// ---- The helicopter -------------------------------------------------
silent(
  'helicopter: no stall, gear, flaps, windshear or don\'t-sink even when their conditions are true',
  reading({ kind: 'heli', category: 'helicopter', aglFt: 400, stallWarn: true, gearDown: false, flapStep: 3, throttle: 0.1, vsFpm: -100, windshearF: 0.4, needsFlaps: true }),
  ['stall', 'gear', 'flaps', 'windshear', 'dontsink']
);
silent('helicopter: 2,000 ft/min at 300 ft is a helicopter descent, not SINK RATE', reading({ kind: 'heli', category: 'helicopter', aglFt: 300, vsFpm: -2000 }), ['sinkrate', 'pullup']);
fires('helicopter: SINK RATE at 300 ft coming down at 2,600 ft/min', reading({ kind: 'heli', category: 'helicopter', aglFt: 300, vsFpm: -2600 }), 'sinkrate');
fires('helicopter: BANK ANGLE past 50 degrees', reading({ kind: 'heli', category: 'helicopter', bankDeg: 55 }), 'bankangle');

// ---- Never nag -------------------------------------------------------
{
  const E = R.createEngine();
  const dt = 1 / 30;
  let ons = 0;
  let plays = 0;
  for (let t = 0; t < 10; t += dt) {
    // Wobbling between 40 and 52 degrees, every three seconds: across the
    // on-limit (45) over and over, never back under the off-limit (38).
    const bank = 46 + 6 * Math.sin(t * 2);
    R.evaluate(E, reading({ bankDeg: bank }), dt);
    for (const ev of E.events) if (ev.type === 'on' && ev.id === 'bankangle') ons++;
    if (E.play && E.play.id === 'bankangle') plays++;
  }
  ok('rules: a bank wobbling across 45 degrees is one warning, not a stream', ons === 1 && plays <= 3, `${ons} on, ${plays} sounds in 10 s`);
  let brief = 0;
  const E2 = R.createEngine();
  for (let t = 0; t < 10; t += dt) {
    R.evaluate(E2, reading({ bankDeg: 44 + 3 * Math.sin(t * 20) }), dt); // flicks past 45 for a tenth of a second
    for (const ev of E2.events) if (ev.type === 'on') brief++;
  }
  ok('rules: a flick past the limit for a tenth of a second is nothing', brief === 0, `${brief} on`);
  R.acknowledge(E);
  let after = 0;
  for (let t = 0; t < 10; t += dt) {
    R.evaluate(E, reading({ bankDeg: 50 }), dt);
    if (E.play && E.play.id === 'bankangle') after++;
  }
  ok('rules: acknowledged — lit, but silent', E.alerts.bankangle.on && after === 0, `${after} sounds after R`);
  hold(E, reading({ bankDeg: 0 }), 2);
  const back = hold(E, reading({ bankDeg: 50 }), 2);
  ok('rules: back within the re-arm time it lights again without sounding', back.lit.has('bankangle') && back.plays.length === 0, `${back.plays.length} sounds`);
}
{
  const E = R.createEngine();
  const h = hold(E, reading({ aglFt: 500, vsFpm: -3500, bankDeg: 60 }), 0.8);
  ok('rules: the most urgent sound goes first (PULL UP before BANK ANGLE)', h.plays.length && h.plays[0].id === 'pullup', h.plays.map((p) => p.id).join(', '));
}
{
  const E = R.createEngine();
  const h = hold(E, reading({ aglFt: 500, vsFpm: -3500, inhibit: true }), 2);
  ok('rules: during a declared emergency the lights work and the sounds stay out of its way', h.lit.has('pullup') && h.plays.length === 0, `${h.plays.length} sounds`);
}
{
  const E = R.createEngine();
  hold(E, reading({ aglFt: 500, vsFpm: -3500, fuelFrac: 0.1 }), 2);
  ok('rules: master WARNING and master CAUTION say which', R.master(E, 'warning') && R.master(E, 'caution'), '');
  ok('rules: PULL UP is the command in the middle of the screen', R.command(E) === 'pullup', R.command(E));
  R.acknowledge(E);
  ok('rules: acknowledging puts both master lights out', !R.master(E, 'warning') && !R.master(E, 'caution'), '');
}

{
  // Ground proximity says one thing at a time.
  const E = R.createEngine();
  let most = 0;
  const dt = 1 / 30;
  for (let t = 0; t < 6; t += dt) {
    R.evaluate(E, reading({ aglFt: 500, vsFpm: t < 1 ? -2000 : -3600, terrainS: t < 2 ? 25 : 10 }), dt);
    const gp = ['pullup', 'terrain', 'terrainAhead', 'sinkrate'].filter((id) => E.alerts[id].on).length;
    most = Math.max(most, gp);
  }
  ok('rules: never more than one ground-proximity message lit at once', most === 1, `${most} at once`);
  // Terrain that stays in the way keeps PULL UP up; it does not cycle.
  const E2 = R.createEngine();
  let flips = 0;
  let was = false;
  for (let t = 0; t < 15; t += dt) {
    R.evaluate(E2, reading({ aglFt: 900, terrainS: 8 }), dt);
    if (E2.alerts.pullup.on !== was) {
      flips++;
      was = E2.alerts.pullup.on;
    }
  }
  ok('rules: TERRAIN that stays in the way is PULL UP until it is not', was && flips === 1, `${flips} changes`);
}

// ---- TCAS geometry ---------------------------------------------------
function tcas(own, entries, frames = 3, dt = 1 / 30) {
  const mem = new Map();
  const out = R.createTcasOut();
  for (let i = 0; i < frames; i++) {
    for (const e of entries || []) {
      if (e && e.v) {
        e.pos.x += e.v.x * dt;
        e.pos.y += e.v.y * dt;
        e.pos.z += e.v.z * dt;
      }
    }
    R.tcasAssess(own, entries, mem, dt, i * dt, out);
  }
  return out;
}
const own = (o = {}) => ({ x: 0, y: 600, z: 0, vx: 55, vy: 0, vz: 0, airborne: true, aglFt: 2000, canRA: true, ...o });
const intruder = (o = {}) => ({ id: 'x', typeId: 'skylark', pos: { x: 1800, y: 600, z: 0 }, v: { x: -55, y: 0, z: 0 }, heading: 270, speed: 55, alt: 600, onGround: false, phase: 'cruise', ...o });
{
  let o = tcas(own(), [intruder()]);
  ok('tcas: head-on at 1.8 km, same height → resolution advisory', o.level === 2, `level ${o.level} sense ${o.sense}`);
  o = tcas(own({ aglFt: 800 }), [intruder()]);
  ok('tcas: the same below 1,000 ft is only a traffic advisory', o.level === 1, `level ${o.level}`);
  o = tcas(own({ aglFt: 300 }), [intruder()]);
  ok('tcas: below 400 ft, in the circuit with everyone else, nothing at all', o.level === 0, `level ${o.level}`);
  o = tcas(own({ y: 600 }), [intruder({ pos: { x: 1800, y: 540, z: 0 } })]);
  ok('tcas: traffic 200 ft below → CLIMB', o.level === 2 && o.sense === 'climb', `${o.level} ${o.sense}`);
  o = tcas(own({ y: 600, aglFt: 3000 }), [intruder({ pos: { x: 1800, y: 660, z: 0 } })]);
  ok('tcas: traffic 200 ft above, high up → DESCEND', o.level === 2 && o.sense === 'descend', `${o.level} ${o.sense}`);
  o = tcas(own({ y: 600, aglFt: 1200 }), [intruder({ pos: { x: 1800, y: 660, z: 0 } })]);
  ok('tcas: never DESCEND below 1,500 ft — it stays an advisory', o.level === 1, `${o.level} ${o.sense}`);
  o = tcas(own(), [intruder({ phase: undefined })]);
  ok('tcas: an escort without a phase (the mayday formation) is not traffic', o.level === 0, `level ${o.level}`);
  o = tcas(own(), [intruder({ onGround: true })]);
  ok('tcas: aircraft on the ground are not traffic', o.level === 0, `level ${o.level}`);
  o = tcas(own({ canRA: false }), [intruder()]);
  ok('tcas: the helicopter gets advisories, never commands', o.level === 1, `level ${o.level}`);
  o = tcas(own(), [intruder({ pos: { x: -600, y: 600, z: 0 }, v: { x: -55, y: 0, z: 0 } })]);
  ok('tcas: one going away is nothing', o.level === 0, `level ${o.level}`);
  o = tcas(own(), [intruder({ pos: { x: 1800, y: 600, z: 3000 } })]);
  ok('tcas: one passing three kilometres to the side is nothing', o.level === 0, `level ${o.level}`);
  o = tcas(own(), [null, { pos: null }, { pos: { x: NaN, y: 0, z: 0 }, phase: 'x' }, intruder()]);
  ok('tcas: survives rubbish in sim.traffic', o.level === 2, `level ${o.level}`);
  o = tcas(own(), null);
  ok('tcas: no sim.traffic at all is fine', o.level === 0, `level ${o.level}`);
  {
    // A feed that builds new entry objects every frame (nothing in the
    // contract says it may not): the level is still found for the aircraft,
    // by its id, from a brand-new object — which is what the minimap holds a
    // frame later.
    const mem = new Map();
    const out = R.createTcasOut();
    let x = 1800;
    for (let i = 0; i < 4; i++) {
      x -= 55 / 30;
      R.tcasAssess(own(), [intruder({ pos: { x, y: 600, z: 0 } })], mem, 1 / 30, i / 30, out);
    }
    const fresh = intruder({ pos: { x, y: 600, z: 0 } });
    ok('tcas: the level of an aircraft is found by its id, not the entry object', R.tcasLevelOf(out, fresh) === 2, `level ${R.tcasLevelOf(out, fresh)}`);
  }
}

/* ------------------------------------------------------------------ */
/* 2. The shared look-ahead                                             */
/* ------------------------------------------------------------------ */
{
  let samples = 0;
  const hill = (x, z) => {
    samples++;
    const d2 = (x - 3000) ** 2 + z ** 2;
    return -30 + 230 * Math.exp(-d2 / (600 * 600));
  };
  const p = { x: 0, y: 150, z: 0, vx: 60, vy: 0, vz: 0, headingDeg: 90 };
  const s1 = MM.terrainConflict(p, { heightAt: hill, horizon: 60, maxTerrain: 250 });
  ok('look-ahead: level at 150 m towards a 200 m hill finds it', Number.isFinite(s1) && s1 > 20 && s1 < 60, `${s1} s`);
  const s2 = MM.terrainConflict({ ...p, vx: -60, vy: -3 }, { heightAt: hill, horizon: 30, maxTerrain: 250 });
  ok('look-ahead: descending over open sea is not TERRAIN (the old map said it was)', s2 === Infinity, `${s2}`);
  const s3 = MM.terrainConflict(p, { heightAt: hill, horizon: 60, maxTerrain: 250, exclude: (x) => x > 2000 });
  ok('look-ahead: an excluded airfield is not a hill', s3 === Infinity, `${s3}`);
  samples = 0;
  const s4 = MM.terrainConflict({ ...p, y: 900 }, { heightAt: hill, horizon: 30, maxTerrain: 250 });
  ok('look-ahead: above the highest ground on the map it takes no samples at all', s4 === Infinity && samples === 0, `${samples} samples`);
  {
    // The F-35B hovering beside a hill at 3 m/s: a helicopter's look-ahead
    // (none below 8 m/s), not an aeroplane's projected forward at 20.
    T.applyMap('kestrel');
    P.applyAircraft('skylark');
    let hx = 0;
    let hz = 0;
    let hh = -Infinity;
    for (let x = -9000; x <= 9000; x += 250) for (let z = -9000; z <= 9000; z += 250) if (T.heightAt(x, z) > hh) [hx, hz, hh] = [x, z, T.heightAt(x, z)];
    // 500 m off the summit on its lowest side, 40 m below the top, facing it.
    let best = null;
    for (let a = 0; a < 360; a += 15) {
      const x0 = hx - Math.sin((a * Math.PI) / 180) * 500;
      const z0 = hz + Math.cos((a * Math.PI) / 180) * 500;
      const g0 = T.heightAt(x0, z0);
      if (!best || g0 < best.g0) best = { x0, z0, g0, a };
    }
    const jy = Math.max(best.g0 + 20, hh - 40);
    const hd = (best.a * Math.PI) / 180;
    const jet = (o) => ({ pos: { x: best.x0, y: jy, z: best.z0 }, vel: { x: Math.sin(hd) * 3, y: 0, z: -Math.cos(hd) * 3 }, heading: best.a, groundSpeed: 3, ias: 3, agl: jy - best.g0, onGround: false, crashed: false, gearDown: true, flapStep: () => 0, ...o });
    const wing = MM.aircraftLookahead(jet({}), false);
    const fans = MM.aircraftLookahead(jet({ jetBorne: true }), false);
    ok('look-ahead: a jet hovering on its fans beside a hill is not TERRAIN (ac.jetBorne)', Number.isFinite(wing) && fans === Infinity, `on the wing ${wing} s, on the fans ${fans}`);
  }
  const shallow = (x) => (x > 200 ? 0.2 : 8);
  ok('shoal: steaming at shallows finds them', Number.isFinite(MM.shoalConflict({ x: 0, z: 0, headingDeg: 90, speed: 4 }, { depthUnderKeel: shallow })), '');
  ok('shoal: going astern away from them is clear', MM.shoalConflict({ x: 0, z: 0, headingDeg: 90, speed: -2 }, { depthUnderKeel: shallow }) === Infinity, '');
}
{
  T.applyMap('kestrel');
  const onCentre = MM.runwayProximity(-1550, 0, 90);
  const offCentre = MM.runwayProximity(-1550, 900, 90);
  const across = MM.runwayProximity(-1550, 0, 0);
  ok('look-ahead: the floor shrinks on the extended centreline near the runway', onCentre < 0.25 && offCentre === 1 && across === 1, `${onCentre.toFixed(2)} / ${offCentre} / ${across}`);
  ok('look-ahead: the runway and its graded ramp are landing ground', MM.onLandingGround(0, 0) && MM.onLandingGround(-800, 0) && !MM.onLandingGround(-4000, 3000), '');
  // A 3.6-degree approach to Kestrel 09 is clear all the way down.
  let worst = Infinity;
  const tan = Math.tan((3.6 * Math.PI) / 180);
  for (let x = -5200; x < -700; x += 100) {
    const y = 14 + (-350 - x) * tan;
    const s = MM.aircraftTerrainAhead({ x, y, z: 0, vx: 35, vy: -35 * tan, vz: 0, headingDeg: 90 }, false);
    worst = Math.min(worst, s);
  }
  ok('look-ahead: a 3.6-degree approach to Kestrel 09 is never TERRAIN', worst === Infinity, `${worst}`);
  // ...and so, now, is the PAPI's own three degrees. This used to assert the
  // opposite: a 44 m ridge 500 m short of the touchdown stood 3.6 m into the
  // three-degree path, and the look-ahead was right to find it. terrain.js
  // now holds the ground 12 m under that path (approachCeiling), so the same
  // approach must be quiet. That the look-ahead finds a real hill is the
  // synthetic 200 m hill check above.
  let seen = Infinity;
  const tan3 = Math.tan((3 * Math.PI) / 180);
  for (let x = -3000; x < -700; x += 50) {
    const y = 14 + (-350 - x) * tan3;
    seen = Math.min(seen, MM.aircraftTerrainAhead({ x, y, z: 0, vx: 35, vy: -35 * tan3, vz: 0, headingDeg: 90 }, false));
  }
  ok('look-ahead: the PAPI\'s 3.0-degree approach to Kestrel 09 is never TERRAIN (the ridge is gone)', seen === Infinity, `${seen}`);
  ok('look-ahead: the terrain ceiling bounds every map', (() => {
    let bad = null;
    for (const id of ['kestrel', 'fjord', 'ember', 'skerries', 'desertrun', 'firewatch', 'ravencrag']) {
      T.applyMap(id);
      const top = MM.terrainCeiling();
      for (const isl of T.ISLANDS) {
        for (let i = 0; i <= 40; i++) {
          for (let j = 0; j <= 40; j++) {
            const x = isl.cx - isl.radius * 1.45 + (i / 40) * isl.radius * 2.9;
            const z = isl.cz - isl.radius * 1.45 + (j / 40) * isl.radius * 2.9;
            if (T.heightAt(x, z) > top) bad = `${id} ${T.heightAt(x, z).toFixed(0)} > ${top.toFixed(0)}`;
          }
        }
      }
    }
    T.applyMap('kestrel');
    return !bad;
  })(), '');
}

/* ------------------------------------------------------------------ */
/* 3. The minimap, drawn                                                */
/* ------------------------------------------------------------------ */
{
  const V = (x, y, z) => ({ x, y, z });
  const mapRoot = new FakeEl('div');
  const mm = new MM.Minimap(mapRoot);
  mm.toggle(true);
  const canvas = mm.canvas;
  const frames = (sim, n = 40) => {
    for (let i = 0; i < n; i++) mm.update(1 / 30, sim);
  };
  const aircraft = (o = {}) => ({
    pos: V(-3000, 400, 0),
    vel: V(55, 0, 0),
    heading: 90,
    groundSpeed: 55,
    ias: 55,
    agl: 400,
    onGround: false,
    crashed: false,
    gearDown: true,
    flapStep: () => 0,
    ...o,
  });

  // Flight, on Kestrel, with traffic including rubbish.
  T.applyMap('kestrel');
  P.applyAircraft('skylark');
  const flight = {
    state: 'flying',
    mode: 'free',
    aircraft: aircraft(),
    activeTarget: { pos: V(6000, 0, 4000), label: 'Next ring' },
    traffic: [null, { pos: null }, { pos: V(NaN, 0, 0) }, { id: 't1', pos: V(-2500, 420, 200), heading: 270, onGround: false, phase: 'cruise' }, { pos: V(-100, 14, 30), onGround: true }],
    warnings: { trafficLevel: (e) => (e && e.id === 't1' ? 1 : 0), drillTraffic: [] },
  };
  frames(flight);
  ok('minimap: draws in flight without an error', mm._errors === 0 && mm.mode === 'flight', `mode ${mm.mode}, errors ${mm._errors}`);
  const texts = () => canvas.rec.texts.map((t) => t.t);
  ok('minimap: says how much map it is showing ("6 km across")', texts().some((t) => /km across/.test(t)), '');
  ok('minimap: an off-screen objective gets a distance on the rim', texts().some((t) => /km$/.test(t)), texts().slice(-6).join(' | '));
  ok('minimap: other aircraft are labelled with their height difference', texts().some((t) => /ft$/.test(t) || t === 'same height'), '');
  // Far off the edge of the chart: the blit must stay inside the chart image.
  canvas.rec.blits.length = 0;
  flight.aircraft.pos.x = 30000;
  frames(flight, 3);
  const outside = canvas.rec.blits.filter((b) => b.a[0] < 0 || b.a[1] < 0 || b.a[0] + b.a[2] > b.w + 1e-6 || b.a[1] + b.a[3] > b.h + 1e-6);
  ok('minimap: never asks the chart for pixels it does not have', outside.length === 0 && mm._errors === 0, `${outside.length} bad blits of ${canvas.rec.blits.length}`);
  flight.aircraft.pos.x = -3000;

  // A normal approach: no red ring (the old map was red for the last 25 s).
  let red = 0;
  const tan = Math.tan((3.6 * Math.PI) / 180);
  for (let x = -5200; x < -600; x += 30) {
    const y = 14 + (-350 - x) * tan;
    flight.aircraft = aircraft({ pos: V(x, y, 0), vel: V(35, -35 * tan, 0), agl: y - Math.max(0, T.heightAt(x, 0)), ias: 35, flapStep: () => 2 });
    flight.activeTarget = null;
    mm._lookT = 1; // look every frame for the test
    frames(flight, 1);
    mm._acc = 1;
    if (mm.warn.style.display !== 'none') red++;
  }
  ok('minimap: no TERRAIN ring on a normal approach to Kestrel 09', red === 0, `${red} frames red`);

  // The car: a job's destination, and a stale flight target ignored.
  T.applyMap('drovers');
  const runnerTarget = { pos: V(1450, 65, 850), label: 'the town' };
  const car = {
    state: 'flying',
    mode: 'drive',
    vehicle: { pos: V(950, 79, -210), heading: 155, speed: -3, spec: { kind: 'car' } },
    runner: { status: 'running', def: { id: 'firstrun' }, activeTarget: () => runnerTarget },
    activeTarget: { pos: V(-9000, 0, 0), label: 'OLD RING' },
    roads: null,
    traffic: [],
  };
  canvas.rec.texts.length = 0;
  frames(car);
  ok('minimap: draws in the van without an error', mm._errors === 0 && mm.mode === 'car', `mode ${mm.mode}, errors ${mm._errors}`);
  ok('minimap: the van shows the JOB\'s destination, not the last flight\'s', mm.targetOf(car) === runnerTarget && texts().some((t) => /THE TOWN/.test(t)) && !texts().some((t) => /OLD RING/i.test(t)), texts().filter((t) => /km/.test(t)).slice(-3).join(' | '));

  // Free driving: a place you found has its name on the map, one still to find
  // is a question mark (jobs.js calls setLabels; it did not exist).
  const ir = {
    foundCount: 2,
    places: [
      { name: 'depot', label: 'the depot', pos: V(950, 0, -210), found: true },
      { name: 'town', label: 'the town', pos: V(1200, 0, -100), found: true },
      { name: 'harbour', label: 'the harbour', pos: V(700, 0, -400), found: false },
    ],
    labels() {
      return this.places.filter((p) => p.found).map((p) => ({ x: p.pos.x, z: p.pos.z, text: p.label }));
    },
  };
  canvas.rec.texts.length = 0;
  frames({ ...car, islandRoads: ir, runner: { status: 'idle', def: null, activeTarget: () => null }, activeTarget: null }, 3);
  ok('minimap: a place found on a free drive is written on the map', texts().includes('the town'), texts().slice(-6).join(' | '));
  ok('minimap: a place still to find is a question mark', texts().includes('?'), '');
  ok('minimap: setLabels, which jobs.js calls, exists', typeof mm.setLabels === 'function', '');
  {
    // The "?" hides the place: a courier address on the same spot as a place
    // not found yet does not print its name beside its own question mark.
    // The nearest address that is not the depot's own, and on the 4 km map.
    const cp = (T.MAP.courier && T.MAP.courier.places) || [];
    let nearest = null;
    const away = (p) => Math.hypot(p.x - 950, p.z + 210);
    for (const p of cp) if (!p.boatOnly && away(p) > 300 && away(p) < 1800 && (!nearest || away(p) < away(nearest))) nearest = p;
    const hidden = {
      foundCount: 1,
      places: [
        { name: 'depot', label: 'the depot', pos: V(950, 0, -210), found: true },
        { name: 'summit', label: 'the summit relay', pos: V(nearest.x + 40, 0, nearest.z), found: false },
      ],
      labels() {
        return [];
      },
    };
    const freeDrive = { ...car, islandRoads: hidden, runner: { status: 'idle', def: null, activeTarget: () => null }, activeTarget: null };
    canvas.rec.texts.length = 0;
    mm.rangeIndex.car = 2; // 4 km, so the address is on the map
    frames(freeDrive, 3);
    ok('minimap: on a free drive a place not found yet shows its "?", not its name', nearest && texts().includes('?') && !texts().includes(nearest.name), `${nearest && nearest.name}: ${texts().slice(-8).join(' | ')}`);
    ok('minimap: the footer points at somewhere new, not "DEPOT 0.0 km"', texts().some((t) => /^SOMEWHERE NEW\s+\d/.test(t)) && !texts().some((t) => /DEPOT\s+0\.0/.test(t)), texts().filter((t) => /km|DEPOT/.test(t)).join(' | '));
    hidden.places[1].found = true;
    canvas.rec.texts.length = 0;
    frames(freeDrive, 3);
    ok('minimap: everything found, standing in the depot: "AT THE DEPOT"', texts().includes('AT THE DEPOT'), texts().filter((t) => /DEPOT|km/.test(t)).join(' | '));
    // Off the map, the next place gets an arrow on the rim.
    hidden.places[1].found = false;
    hidden.places[1].pos = V(950 + 9000, 0, -210);
    canvas.rec.texts.length = 0;
    frames(freeDrive, 3);
    ok('minimap: the next place to find, off the map, has an arrow on the rim', texts().some((t) => /^\? \d/.test(t)), texts().slice(-6).join(' | '));
    mm.rangeIndex.car = 1;
  }

  // The boat.
  T.applyMap('sennen');
  const boat = {
    state: 'flying',
    mode: 'drive',
    vehicle: { pos: V(66, 0, -159), heading: 195, speed: 2, spec: { kind: 'boat', draught: 1 }, aground: false },
    runner: { status: 'running', def: { id: 'boat-patrol' }, activeTarget: () => ({ pos: V(0, 0, 91), label: 'Casualty' }) },
    traffic: [],
  };
  canvas.rec.texts.length = 0;
  frames(boat, 60);
  ok('minimap: draws in the boat without an error', mm._errors === 0 && mm.mode === 'boat' && mm.chart && mm.chart.kind === 'bathy', `mode ${mm.mode}, errors ${mm._errors}`);
  ok('minimap: the boat shows the casualty and the depth under the keel', texts().some((t) => /Casualty/.test(t)) && texts().some((t) => /UNDER KEEL|AGROUND/.test(t)), '');

  // The helicopter.
  T.applyMap('kestrel-port');
  if (PADS.padsOf) {
    /* pads are laid by the world build; an empty list is fine for drawing */
  }
  P.applyAircraft('harrier');
  const heli = { ...flight, aircraft: aircraft({ pos: V(0, 120, 0), vel: V(10, 0, 0), groundSpeed: 10 }), activeTarget: null, traffic: [] };
  frames(heli);
  ok('minimap: draws in the helicopter without an error', mm._errors === 0 && mm.mode === 'heli', `mode ${mm.mode}, errors ${mm._errors}`);
  P.applyAircraft('skylark');
  T.applyMap('kestrel');

  // The van gets its own sharper window, the aeroplane the whole map.
  T.applyMap('drovers');
  frames(car, 60);
  ok('minimap: the van\'s map is a 12 km window (23 m a pixel), not the whole island (56 m)', mm.chart && mm.chart.extent === 12000 && mm.chart.kind === 'relief', `extent ${mm.chart && mm.chart.extent}`);
  T.applyMap('kestrel');
  P.applyAircraft('skylark');
  const plain = { ...flight, aircraft: aircraft(), activeTarget: null, traffic: [] };
  // Close in, the aeroplane gets the sharp window too; zoomed out, the whole map.
  //
  // Frames until the window is finished, not a fixed 120. Chart.slice stops
  // after 3 ms (two rows at the least), so how many frames a 512-row chart
  // takes is the machine's speed: 120 frames was enough on this Mac idle,
  // failed twice in forty runs with the load average at 30-47, and failed
  // every time with performance.now slowed 3x — which is a Chromebook. The
  // cap is 2000 because the slowest possible build is 256 frames.
  mm.rangeIndex.flight = 1; // 6 km
  let windowFrames = 0;
  do {
    frames(plain, 1);
    windowFrames++;
  } while (!(mm.windows.relief && mm.windows.relief.cur && mm.windows.relief.cur.done) && windowFrames < 2000);
  frames(plain, 1);
  ok('minimap: at 6 km the aeroplane gets the sharp 12 km window (23 m a pixel)', mm.chart && mm.chart.extent === 12000 && mm.chart.done, `extent ${mm.chart && mm.chart.extent}, done ${mm.chart && mm.chart.done}, built in ${windowFrames} frames`);
  mm.rangeIndex.flight = 3; // 24 km
  frames(plain, 80);
  ok('minimap: zoomed out to 24 km the aeroplane gets the whole island', mm.chart && mm.chart.extent > 20000, `extent ${mm.chart && mm.chart.extent}`);
  mm.rangeIndex.flight = 1;
  // A new flight somewhere the window does not reach: rebuilt there at once,
  // not behind a chart of the other end of the island.
  frames({ ...plain, aircraft: aircraft({ pos: V(9000, 500, 7000) }) }, 1);
  ok('minimap: a window that does not cover you is replaced, not kept', mm.windows.relief.cur.cx === 9000 && mm.windows.relief.cur.cz === 7000, `window at ${mm.windows.relief.cur.cx}, ${mm.windows.relief.cur.cz}`);

  // Building a chart stops when its time is up: on a slow machine, fewer rows.
  {
    const real = globalThis.performance;
    let tick = 0;
    Object.defineProperty(globalThis, 'performance', { value: { now: () => (tick += 1) }, configurable: true, writable: true });
    T.applyMap('fjord');
    mm.rangeIndex.flight = 3;
    mm._acc = 1;
    mm.update(1 / 30, plain);
    const rows = mm.chart ? mm.chart.row : -1;
    Object.defineProperty(globalThis, 'performance', { value: real, configurable: true, writable: true });
    ok('minimap: building the chart stops when its 3 ms are up (1 ms a row here)', rows >= 2 && rows <= 5, `${rows} rows in one frame`);
    mm.rangeIndex.flight = 1;
    T.applyMap('kestrel');
  }

  // Behind the menus and the debrief it is not on screen at all.
  frames({ ...plain, state: 'menu' }, 2);
  const onMenu = mm.el.style.display;
  frames({ ...plain, state: 'debrief' }, 2);
  const onDebrief = mm.el.style.display;
  frames({ ...plain, state: 'paused' }, 2);
  const onPause = mm.el.style.display;
  frames(plain, 2);
  ok('minimap: not on the menus or over a debrief, back for the flight and the pause menu', onMenu === 'none' && onDebrief === 'none' && onPause === '' && mm.el.style.display === '' && mm.visible, `menu "${onMenu}", debrief "${onDebrief}", paused "${onPause}", flying "${mm.el.style.display}"`);

  // A drive's debrief: main.js stops calling update() when a job ends, so the
  // map has to notice for itself.
  {
    const job = { ...plain, state: 'flying' };
    frames(job, 2);
    const up = mm.el.style.display;
    job.state = 'debrief';
    await new Promise((f) => setTimeout(f, 320));
    ok('minimap: a job\'s debrief takes the map off the screen without a frame to say so', up === '' && mm.el.style.display === 'none', `before "${up}", after "${mm.el.style.display}"`);
    frames(plain, 2);
  }

  // An escort in sim.traffic with no heading points the way it is going.
  const esc = { pos: V(-2800, 420, 100) };
  const withEscort = { ...plain, traffic: [esc] };
  frames(withEscort, 1);
  esc.pos.x += 30;
  esc.pos.z += 30;
  frames(withEscort, 1);
  ok('minimap: traffic with no heading is drawn pointing the way it moves', Math.abs(mm.trafficHeading(esc) - 135) < 1, `${mm.trafficHeading(esc).toFixed(1)} degrees`);
  // Home: with nothing to aim at and the runway off the map, an arrow to it —
  // and none with any part of the runway on the map.
  canvas.rec.texts.length = 0;
  frames({ ...flight, aircraft: aircraft({ pos: V(-9000, 500, 0) }), activeTarget: null }, 3);
  const far = texts().some((t) => /^airfield/.test(t));
  canvas.rec.texts.length = 0;
  frames({ ...flight, aircraft: aircraft({ pos: V(-2500, 500, 0) }), activeTarget: null }, 3);
  const near = texts().some((t) => /^airfield/.test(t));
  ok('minimap: "which way home" — an airfield arrow only when the runway is off the map', far && !near, `far ${far}, near ${near}`);

  // Shown small (an iPad draws it at 118 px): the text grows to compensate.
  mm.el.clientWidth = 118;
  mm._measureT = 5;
  frames(flight, 2);
  ok('minimap: text is scaled up when the map is drawn small', mm.textScale > 1.5, `x${mm.textScale.toFixed(2)}`);
  mm.el.clientWidth = 190;
}

/* ------------------------------------------------------------------ */
/* 4. The feature glue, against a mock game                             */
/* ------------------------------------------------------------------ */
{
  const EXT = await import(new URL('src/game/extensions.js', root));
  await import(new URL('src/features/warnings.js', root));
  const ext = EXT.extensions().find((e) => e.id === 'warnings');
  ok('glue: the feature registers itself', !!ext, '');
  if (ext) {
    const calls = [];
    const alerts = {
      claimed: false,
      claim() {
        this.claimed = true;
        calls.push('claim');
      },
      release() {
        this.claimed = false;
        calls.push('release');
      },
      setGearWarning(on) {
        calls.push(`gear:${on}`);
      },
    };
    for (const name of Object.keys(R.SOUND_SECONDS).concat(['masterCaution', 'masterWarning'])) {
      alerts[name] = (...a) => calls.push(`sound:${name}:${a[0] ?? ''}`);
    }
    const spoken = [];
    const listeners = {};
    const ac = {
      pos: { x: -3000, y: 300, z: 0, clone() { return { ...this }; } },
      vel: { x: 55, y: 0, z: 0 },
      heading: 90,
      agl: 300,
      vs: 0,
      ias: 55,
      airspeed: 55,
      groundSpeed: 55,
      alpha: 0.02,
      flaps: 0,
      onGround: false,
      crashed: false,
      gearDown: true,
      controls: { throttle: 0.6 },
      failures: { engine: false, roughEngine: false, fuelLeak: false, icing: false },
      engineOn: true,
      starting: 0,
      bankAngleDeg: () => 0,
      flapStep: () => 0,
      fuelFraction: () => 0.8,
      on(evt, fn) {
        (listeners[evt] = listeners[evt] || []).push(fn);
      },
    };
    const sim = {
      state: 'flying',
      mode: 'free',
      aircraft: ac,
      audio: { available: true, alerts, radio: { mode: 'radio' } },
      settings: { muted: false, soundOn: { alerts: true } },
      input: { bindings: { gear: ['KeyG'], flapsDown: ['KeyF'], starter: ['KeyI'] }, pressed: () => false },
      hud: { hidden: false },
      speak: (t) => spoken.push(t),
      traffic: [],
      weather: { shearHeadwind: 0, downdraft: 0, windDirDeg: 90 },
    };
    T.applyMap('kestrel');
    P.applyAircraft('skylark');
    ext.install(sim);
    ext.startMode(sim, 'free', {});
    const tick = (n, f) => {
      for (let i = 0; i < n; i++) {
        if (f) f(i);
        ext.update(sim, 1 / 30);
      }
    };
    tick(30);
    ok('glue: level flight — nothing lit, nothing played', sim.warnings.active().length === 0 && !calls.some((c) => c.startsWith('sound:')), sim.warnings.active().join(', '));
    ok('glue: takes the gear horn and terrain beep from alerts.js while flying', alerts.claimed, calls.join(' '));
    // A dive to 500 ft at 3,500 ft/min.
    ac.agl = 152;
    ac.pos.y = 152;
    ac.vs = -3500 / 196.85;
    tick(30);
    ok('glue: PULL UP lit and the whoop played', sim.warnings.isActive('pullup') && calls.includes('sound:gpwsWarning:'), calls.filter((c) => c.startsWith('sound')).join(' '));
    ok('glue: default voice setting — no speech', spoken.length === 0, spoken.join(' | '));
    const panel = globalThis.document.body.children.find((c) => c.id === 'ext-layer');
    const findText = (el, re) => (el ? re.test(el.textContent || '') || el.children.some((c) => findText(c, re)) : false);
    ok('glue: the panel says PULL UP in words', findText(panel, /PULL UP/), '');
    // R acknowledges and is consumed.
    const consumed = ext.key(sim, 'KeyR', true, { repeat: false });
    const before = calls.length;
    tick(60);
    ok('glue: R is taken, and silences it', consumed === true && sim.warnings.engine.alerts.pullup.acked && !calls.slice(before).some((c) => c.startsWith('sound:gpwsWarning')), calls.slice(before).join(' '));
    // Speech, only when chosen.
    ac.vs = 0;
    tick(60);
    sim.audio.radio.mode = 'speech';
    ac.vs = -3500 / 196.85;
    tick(30);
    ok('glue: with the speech voice chosen, it says "Pull up" through sim.speak', spoken.includes('Pull up'), spoken.join(' | '));
    sim.audio.radio.mode = 'radio';
    ac.vs = 0;
    ac.agl = 300;
    ac.pos.y = 300;
    tick(60);
    // The gear horn, driven from the rules.
    ac.gearDown = false;
    ac.controls.throttle = 0.2;
    ac.vs = -500 / 196.85;
    ac.agl = 120;
    ac.pos.y = 120;
    tick(45);
    ok('glue: GEAR NOT DOWN sounds the gear horn', sim.warnings.isActive('gear') && calls.includes('gear:true'), '');
    ac.gearDown = true;
    ac.vs = 0;
    tick(60);
    const WN = (await import(new URL('src/features/warnings.js', root))).__warnings;
    // Over a deck the radio altitude is to the deck: 30 m above the sea is
    // 10 m above a carrier deck 20 m up.
    T.addPlatform(ac.pos.x, ac.pos.z, 300, 300, 20, 'test deck');
    ac.agl = 30 + 34;
    ac.pos.y = 30;
    tick(2);
    const raFt = WN.W.r.aglFt;
    T.clearPlatforms();
    ok('glue: over a deck the radio altitude is to the deck, not the sea', Math.abs(raFt - 10 * 3.28084) < 1, `${raFt.toFixed(1)} ft`);
    ac.agl = 300;
    ac.pos.y = 300;
    tick(10);
    // A bird strike sets the engine on fire.
    sim.activeEvents = { birdStrike: 8 };
    const beforeBird = calls.length;
    tick(10);
    ok('glue: a bird strike starts an engine fire and rings the bell', sim.warnings.fire && sim.warnings.isActive('engineFire') && calls.slice(beforeBird).includes('sound:fireBell:'), calls.slice(beforeBird).join(' '));
    // A lightning strike: the panel goes dark and quiet with the instruments.
    sim.instrumentBlackout = 2;
    const beforeDark = calls.length;
    tick(30);
    const layerRoot = globalThis.document.body.children.find((c) => c.id === 'ext-layer');
    const wx = layerRoot && layerRoot.children.find((c) => c.className === 'wx');
    const darkSounds = calls.slice(beforeDark).filter((c) => c.startsWith('sound:')).length;
    ok('glue: with the instruments out the panel is dark and silent', wx && wx.hidden && darkSounds === 0, `hidden ${wx && wx.hidden}, ${darkSounds} sounds`);
    sim.instrumentBlackout = 0;
    tick(30);
    ok('glue: ...and back, still lit, when they return', wx && !wx.hidden && sim.warnings.isActive('engineFire'), `hidden ${wx && wx.hidden}`);
    sim.activeEvents = {};
    sim.warnings.acknowledge();
    tick(120);
    // Stop hands everything back.
    ext.stop(sim, 'menu');
    ok('glue: going back to the menu hands the horns back to alerts.js', !alerts.claimed && calls.includes('release'), '');
    // The boat.
    sim.mode = 'drive';
    sim.vehicle = { pos: { x: 66, y: 0, z: -159 }, heading: 195, speed: 3, spec: { kind: 'boat', draught: 1 }, aground: false };
    ext.startMode(sim, 'drive', {});
    tick(30);
    const shoalNow = sim.warnings.shoalAheadS;
    ok('glue: the boat looks ahead for shallow water', Number.isFinite(shoalNow) && sim.warnings.isActive('shoal'), `shallows ${shoalNow} s ahead`);
    ok('glue: the boat gets no aircraft alerts', sim.warnings.active().every((id) => id === 'shoal'), sim.warnings.active().join(', ') || 'clear');
    ok('glue: R is taken in the boat as well', ext.key(sim, 'KeyR', true, {}) === true, '');
    sim.vehicle.spec.kind = 'car';
    ok('glue: R is left alone in the van', ext.key(sim, 'KeyR', true, {}) === false, '');
    // A throw hands the horns back before the plug-in layer switches it off.
    sim.mode = 'free';
    ext.startMode(sim, 'free', {});
    tick(2);
    ac.bankAngleDeg = () => {
      throw new Error('boom');
    };
    let threw = false;
    try {
      ext.update(sim, 1 / 30);
    } catch (e) {
      threw = true;
    }
    ok('glue: if it ever throws, it gives the gear horn back first', threw && !alerts.claimed, '');
    ac.bankAngleDeg = () => 0;
    // Someone else bound R: not taken from them, and it does not silence
    // anything either (it used to acknowledge first and ask second).
    ext.startMode(sim, 'free', {});
    tick(2);
    ac.agl = 152;
    ac.pos.y = 152;
    ac.vs = -3500 / 196.85;
    tick(30);
    sim.input.bindings.lookBehind = ['KeyR'];
    const keptR = ext.key(sim, 'KeyR', true, {}) === false;
    ok('glue: a player who bound R to something keeps it — and it silences nothing', keptR && sim.warnings.isActive('pullup') && !sim.warnings.engine.alerts.pullup.acked, `returned ${!keptR}, acked ${sim.warnings.engine.alerts.pullup.acked}`);
    delete sim.input.bindings.lookBehind;
    ac.vs = 0;
    ac.agl = 300;
    ac.pos.y = 300;
    tick(60);

    /* ---- the autopilot: only a drop-out the pilot did not choose ---- */
    const TAKEOVER = 0.25;
    const ap = {
      engaged: false,
      handedBack: null,
      playerTookOver: (i) => Math.abs(i.pitch) > TAKEOVER || Math.abs(i.roll) > TAKEOVER || Math.abs(i.yaw) > TAKEOVER,
    };
    sim.autopilot = ap;
    sim.input.out = { pitch: 0, roll: 0, yaw: 0, throttle: 0.6 };
    const apCase = (name, how, wantOff) => {
      ext.startMode(sim, 'free', {});
      ap.engaged = true;
      ap.handedBack = null;
      tick(10);
      const before = calls.length;
      how();
      tick(20);
      const wailed = calls.slice(before).includes('sound:autopilotOff:');
      const lit = sim.warnings.isActive('apOff') || sim.warnings.engine.alerts.apOff.until > sim.warnings.engine.t;
      ok(`glue: autopilot — ${name}`, wantOff ? wailed && lit : !wailed && !lit, `wail ${wailed}, lit ${lit}`);
      sim.input.out.pitch = 0;
    };
    apCase('taking over with the stick is not AUTOPILOT OFF', () => {
      sim.input.out.pitch = 0.6; // main.js saw this too, and let go
      ap.engaged = false;
    }, false);
    apCase('the approach handing the landing back is not AUTOPILOT OFF', () => {
      ap.handedBack = 'Runway ahead — landing is yours';
      tick(1);
      ap.handedBack = null; // main.js clears it and disengages, next frame
      ap.engaged = false;
    }, false);
    apCase('a hand-back set and acted on in one frame is known by main.js\'s words for it', () => {
      sim.hud = { hidden: false, toasts: [{ node: { textContent: 'Autopilot off — you have control' }, life: 2.4 }, { node: { textContent: 'Established on the approach — landing is yours' }, life: 4 }] };
      ap.engaged = false;
    }, false);
    sim.hud = { hidden: false };
    apCase('a drop-out nobody chose IS AUTOPILOT OFF', () => {
      ap.engaged = false;
    }, true);
    {
      // The lightning strike: dark and silent while the instruments are out,
      // then told the moment they come back.
      ext.startMode(sim, 'free', {});
      ap.engaged = true;
      tick(10);
      const before = calls.length;
      sim.instrumentBlackout = 3;
      ap.engaged = false;
      tick(40);
      const whileDark = calls.slice(before).includes('sound:autopilotOff:');
      sim.instrumentBlackout = 0;
      tick(20);
      const after = calls.slice(before).includes('sound:autopilotOff:') && sim.warnings.isActive('apOff');
      ok('glue: autopilot — dropped out by a lightning strike, told when the instruments come back', !whileDark && after, `while dark ${whileDark}, after ${after}`);
    }
    delete sim.autopilot;

    /* ---- words for the device in your hands ---- */
    const layer = globalThis.document.body.children.find((c) => c.id === 'ext-layer');
    const rowsText = () => {
      const out = [];
      const walk = (el) => {
        if (!el) return;
        if (el.className && /wx-row/.test(el.className) && !el.hidden) out.push(el.children.map((c) => c.textContent).join(' — '));
        el.children.forEach(walk);
      };
      walk(layer);
      return out.join(' | ');
    };
    const gearRow = () => {
      ext.startMode(sim, 'free', {});
      ac.gearDown = false;
      ac.controls.throttle = 0.2;
      ac.vs = -500 / 196.85;
      ac.agl = 120;
      ac.pos.y = 120;
      tick(45);
      sim.warnings.startFire();
      tick(3);
      const t = rowsText();
      ac.gearDown = true;
      ac.vs = 0;
      ac.agl = 300;
      ac.pos.y = 300;
      ac.controls.throttle = 0.6;
      sim.warnings.acknowledge();
      tick(120);
      return t;
    };
    const keyWords = gearRow();
    ok('glue: on a keyboard the hints name the keys (press G, Press R)', /press G/.test(keyWords) && /Press R to pull the fire handle/.test(keyWords), keyWords);
    globalThis.document.documentElement.classList.add('is-touch-device');
    const touchWords = gearRow();
    globalThis.document.documentElement.classList.remove('is-touch-device');
    ok('glue: on a touch screen they name the pads (tap GEAR, Tap the red light)', /tap GEAR/.test(touchWords) && /Tap the red light to pull the fire handle/.test(touchWords) && !/press/i.test(touchWords), touchWords);

    /* ---- nothing said twice ---- */
    {
      ext.startMode(sim, 'free', {});
      const toast = { node: { textContent: 'Low fuel — head back to the airfield' }, life: 6 };
      sim.hud = { hidden: false, toasts: [toast], stallWarn: { style: { display: 'none' } } };
      ac.fuelFraction = () => 0.08;
      tick(30);
      const ui = WN.W.ui;
      const litUnder = sim.warnings.isActive('lowFuel');
      const rowUnder = /LOW FUEL/.test(rowsText());
      const lampUnder = ui.cautLamp.classList.contains('is-lit');
      sim.hud.toasts.length = 0; // the toast's six seconds are up
      tick(3);
      const rowAfter = /LOW FUEL/.test(rowsText());
      const lampAfter = ui.cautLamp.classList.contains('is-lit');
      ok(
        'glue: LOW FUEL — no row or lamp while the game\'s own toast says it; the row once the toast has gone',
        litUnder && !rowUnder && !lampUnder && rowAfter && lampAfter,
        `under the toast: row ${rowUnder}, lamp ${lampUnder}; after: row ${rowAfter}, lamp ${lampAfter}`
      );
      ac.fuelFraction = () => 0.8;
      tick(90);
      // STALL beside the HUD's own STALL slab.
      sim.hud.stallWarn.style.display = '';
      ac.alpha = 0.28;
      ac.airspeed = 30;
      tick(20);
      const stallUnder = sim.warnings.isActive('stall') && !/STALL/.test(rowsText());
      sim.hud.stallWarn.style.display = 'none';
      tick(2);
      const stallAlone = /STALL/.test(rowsText());
      ok('glue: STALL — no row beside the HUD\'s STALL slab; a row when the slab is not up', stallUnder && stallAlone, `under the slab ${stallUnder}, alone ${stallAlone}`);
      ac.alpha = 0.02;
      ac.airspeed = 55;
      sim.warnings.acknowledge();
      tick(60);
      sim.hud = { hidden: false };
    }

    /* ---- the F-35B hover ---- */
    ext.startMode(sim, 'free', {});
    ac.alpha = 0.4;
    ac.airspeed = 12;
    ac.jetBorne = true;
    tick(30);
    const hoverStall = sim.warnings.isActive('stall');
    ac.jetBorne = false;
    tick(30);
    const wingStall = sim.warnings.isActive('stall');
    ok('glue: no STALL while the jet holds itself up (ac.jetBorne, the F-35B hover)', !hoverStall && wingStall, `hovering ${hoverStall}, on the wing ${wingStall}`);
    ac.alpha = 0.02;
    ac.airspeed = 55;
    tick(60);

    /* ---- which types are told about flaps ---- */
    const flapsFor = (id) => {
      P.applyAircraft(id);
      return WN.info().needsFlaps;
    };
    const fl = { skylark: flapsFor('skylark'), meridian: flapsFor('meridian'), tempest: flapsFor('tempest'), vanguard: flapsFor('vanguard'), nightjar: flapsFor('nightjar'), harrier: flapsFor('harrier') };
    P.applyAircraft('skylark');
    ok(
      'glue: TOO LOW — FLAPS for the airliner and the heavy twin, not the trainer, the fighters or the helicopter',
      fl.meridian && fl.tempest && !fl.skylark && !fl.vanguard && !fl.nightjar && !fl.harrier,
      JSON.stringify(fl)
    );

    /* ---- the drill aircraft goes out of the GPU as well as the scene ---- */
    {
      const disposed = [];
      const part = { geometry: { dispose: () => disposed.push('geo') }, material: { dispose: () => disposed.push('mat') } };
      const scene = { remove(m) { m.parent = null; } };
      const model = { parent: scene, userData: {}, traverse: (f) => [model, part].forEach(f) };
      WN.W.drill.push({ id: 'd', pos: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, life: 10, model });
      WN.resetAll(sim);
      ok('glue: the TCAS drill aircraft is disposed, not only removed', disposed.includes('geo') && disposed.includes('mat') && model.parent === null && WN.W.drill.length === 0, disposed.join(', '));
    }
  }
}

/* ------------------------------------------------------------------ */
/* 5. alerts.js                                                         */
/* ------------------------------------------------------------------ */
{
  const AL = await import(new URL('src/audio/alerts.js', root));
  const P2 = await import(new URL('src/aircraft/physics.js', root));
  const wing = (o = {}) => ({ onGround: false, crashed: false, airspeed: 30, agl: 300, gearDown: true, flaps: 0, alpha: 0.26, failures: {}, ...o });
  P2.applyAircraft('skylark');
  ok('alerts: stall warner uses the aircraft\'s own stalling angle (trainer 0.29 rad)', AL.stallWarning(wing({ alpha: 0.26 })) && !AL.stallWarning(wing({ alpha: 0.2 })), '');
  P2.applyAircraft('vanguard');
  ok('alerts: ...so the fighter (0.45 rad) is not warned twelve degrees early', !AL.stallWarning(wing({ alpha: 0.26 })) && AL.stallWarning(wing({ alpha: 0.42 })), '');
  P2.applyAircraft('skylark');
  ok('alerts: flap brings the warning earlier, as it brings the stall earlier', AL.stallWarning(wing({ alpha: 0.21, flaps: 1 })) && !AL.stallWarning(wing({ alpha: 0.21 })), '');
  P2.applyAircraft('harrier');
  ok('alerts: no stall horn in the helicopter, whatever its "alpha"', !AL.stallWarning(wing({ alpha: 1.4 })), '');
  P2.applyAircraft('skylark');
  ok('alerts: quiet in the last three metres of a landing', !AL.stallWarning(wing({ alpha: 0.28, agl: 2 })), '');
  ok('alerts: hysteresis — once on, it stays on a little past the threshold', AL.stallWarning(wing({ alpha: 0.225 }), true) && !AL.stallWarning(wing({ alpha: 0.225 }), false), '');

  // With a pretend mixer: every sound exists and none throws; claim/release.
  const made = [];
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ connect() {}, start() {}, stop() {}, gain: param(), frequency: param(), Q: param(), detune: param(), type: '' });
  const ctx = { currentTime: 10, createOscillator: () => (made.push('osc'), node()), createGain: () => node(), createBiquadFilter: () => node() };
  const mixer = { ctx, bus: () => node(), tone() {}, noiseBurst() { made.push('noise'); } };
  const A = new AL.Alerts(mixer);
  A.build();
  let threw = null;
  for (const name of ['gpwsWarning', 'gpwsCaution', 'bankAngle', 'windshear', 'fireBell', 'masterWarning', 'masterCaution', 'caution', 'thud', 'tcasTraffic', 'tcasResolution', 'tcasClear', 'radioAltitude', 'autopilotOff']) {
    try {
      if (typeof A[name] !== 'function') throw new Error(`${name} missing`);
      A[name](name === 'radioAltitude' ? 50 : name === 'tcasResolution' ? 'climb' : undefined);
    } catch (e) {
      threw = e.message;
    }
  }
  ok('alerts: every warning sound exists and plays', !threw && made.length > 20, threw || `${made.length} nodes`);
  const before = made.length;
  A.masterCaution();
  A.caution();
  ok('alerts: the caution chime is not doubled when two things ask at once', made.length === before, '');
  A.overspeedSilenced = true;
  const n0 = made.length;
  A.overspeed();
  ok('alerts: R silences the overspeed clacker', made.length === n0, '');
  A.overspeedSilenced = false;
  A.claim();
  A.release();
  ok('alerts: release() hands the horns back', !A.claimed && !A.overspeedSilenced, '');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
