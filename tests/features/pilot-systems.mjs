/**
 * Node checks for the pilot's switches (src/aircraft/systems.js,
 * src/features/pilot-systems.js): lights, the speedbrake / spoiler lever,
 * the thrust reversers, the ATC request menu.
 *
 *   node tests/features/pilot-systems.mjs
 *
 * 1. THE RULES, pure: the light presets cycle and resolve over the automatic
 *    logic; the spoiler lever's three detents in the air, arming on the
 *    ground, by hand on the roll, stowed by power; the reversers on the
 *    ground only; the radio's suggestion and answers.
 * 2. THE FLIGHT MODEL: a 737 rolling at 60 m/s stops sooner with MAX reverse
 *    than with idle power, sooner again with the ground spoilers up; the
 *    speedbrake in the air costs speed; the armed ground spoilers come up on
 *    a landing roll by themselves and stow when power goes in; the readouts
 *    carry the levers; a reset puts every switch back.
 * 3. THE GAME: the four actions are in the registry with free keys and a
 *    touch row each; the pills say what the levers are doing and undo them
 *    through actions the feature owns; the touch sheets carry the buttons;
 *    main.js asks the features before the default branch.
 */

if (typeof globalThis.window === 'undefined') {
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  });
}
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  return !!pass;
};

const THREE = await imp('src/vendor/three.module.js');
const SYS = await imp('src/aircraft/systems.js');
const { Weather } = await imp('src/world/weather.js');
const T = await imp('src/world/terrain.js');
const P = await imp('src/aircraft/physics.js');
const TY = await imp('src/aircraft/types.js');

/* ---------------- 1. the rules ---------------- */

{
  const L = SYS.defaultLights();
  ok('lights: a fresh set is every lamp on auto', SYS.lightPresetOf(L).id === 'auto' && SYS.LAMP_KINDS.every((k) => L[k] === 'auto'));
  const seen = [];
  let cur = L;
  for (let i = 0; i < SYS.LIGHT_PRESETS.length + 1; i++) {
    const p = SYS.nextLightPreset(cur);
    seen.push(p.id);
    cur = { ...p.set };
  }
  ok('lights: the key cycles auto → nav+beacon → taxi → all on → all off → auto', seen.join() === 'apron,taxi,all,off,auto,apron', seen.join());
  ok('lights: a hand-set mix is no preset, and the next press goes back to auto', SYS.lightPresetOf({ nav: 'on', beacon: 'auto', strobe: 'off', landing: 'auto', taxi: 'auto' }) === null && SYS.nextLightPreset({ nav: 'on' }).id === 'auto');
  ok('lights: one lamp\'s switch cycles auto → on → off → auto', SYS.nextSwitch('auto') === 'on' && SYS.nextSwitch('on') === 'off' && SYS.nextSwitch('off') === 'auto');
  const auto = { nav: 1, beacon: 1, strobe: 0, landing: 0, taxi: 1 };
  const a = SYS.resolveLamps(SYS.defaultLights(), auto);
  ok('lights: on auto the lamps are what the automatic logic wants', a.nav === 1 && a.strobe === 0 && a.taxi === 1 && a.landing === 0, JSON.stringify(a));
  const b = SYS.resolveLamps({ nav: 'off', beacon: 'auto', strobe: 'on', landing: 'on', taxi: 'auto' }, auto);
  ok('lights: ON lights a lamp the logic would not, OFF puts one out the logic would light; the landing beam wins over the taxi light', b.nav === 0 && b.strobe === 1 && b.landing === 1 && b.taxi === 0 && b.beacon === 1, JSON.stringify(b));
  const c = SYS.resolveLamps({ nav: 'on', beacon: 'on', strobe: 'on', landing: 'on', taxi: 'on' }, auto, { crashed: true });
  ok('lights: a wreck has no lights whatever the switches say', Object.values(c).every((v) => v === 0));
}
{
  const air = (lever) => SYS.spoilerPress({ onGround: false, groundSpeed: 80, lever, armed: true });
  ok('spoilers: in the air the lever steps in → ½ → FULL → in', air(0).lever === 0.5 && air(0.5).lever === 1 && air(1).lever === 0 && /FULL/.test(air(0.5).note));
  const slow = SYS.spoilerPress({ onGround: true, groundSpeed: 0, lever: 0, armed: true });
  ok('spoilers: on the ground, stopped, a press disarms the ground spoilers (and arms them again)', slow.armed === false && slow.lever === 0 && slow.kind === 'warn' && SYS.spoilerPress({ onGround: true, groundSpeed: 3, lever: 0, armed: false }).armed === true);
  const roll = SYS.spoilerPress({ onGround: true, groundSpeed: 40, lever: 0, armed: true });
  ok('spoilers: rolling fast on the ground a press puts them up by hand, and the next takes them down', roll.lever === 1 && roll.armed === true && SYS.spoilerPress({ onGround: true, groundSpeed: 40, lever: 1, armed: true }).lever === 0);
  const t1 = SYS.spoilerTarget({ onGround: true, groundSpeed: 40, throttle: 0.1, lever: 0, armed: true });
  const t2 = SYS.spoilerTarget({ onGround: true, groundSpeed: 40, throttle: 0.1, lever: 0, armed: false });
  const t3 = SYS.spoilerTarget({ onGround: true, groundSpeed: 40, throttle: 0.9, lever: 1, armed: true });
  const t4 = SYS.spoilerTarget({ onGround: false, groundSpeed: 90, throttle: 0.9, lever: 0.5, armed: true });
  ok('spoilers: armed, they come up on a landing roll with the power at idle; disarmed they do not', t1.target === 1 && t2.target === 0);
  ok('spoilers: power on the ground stows the lever; in the air the lever stays where it is put', t3.target === 0 && t3.stow === true && t4.target === 0.5 && t4.stow === false);
  ok('spoilers: a rotor has none, a wing does', SYS.hasSpoilers({ rotor: true }) === false && SYS.hasSpoilers({ class: 'Airliner' }) === true);
  // The real roster entries (sim.aircraftType is one of these): a helicopter's rotor is shape.power.rotor, not .rotor.
  const has = (id) => SYS.hasSpoilers(TY.getAircraft(id));
  ok('spoilers: the airliners and the fast jets have them; the 172, the racers, Concorde and every helicopter do not', ['b737', 'a320', 'q400', 'c17', 'f22', 'a10'].every(has) && !['skylark', 'courier', 'massimo', 'concorde', 'harrier', 'uh60', 'ch47'].some(has), ['skylark', 'concorde', 'harrier'].map((id) => `${id}:${has(id)}`).join());
}
{
  const g = (reverse) => SYS.reversePress({ onGround: true, reverse, hasReversers: true });
  ok('reversers: on the ground the lever steps stowed → idle → MAX → stowed', g(0).reverse === 0.5 && g(0.5).reverse === 1 && g(1).reverse === 0 && /MAX/.test(g(0.5).note));
  const airRev = SYS.reversePress({ onGround: false, reverse: 0, hasReversers: true });
  ok('reversers: locked out in the air, with a word', airRev.refused && airRev.reverse === 0 && /land first/.test(airRev.note));
  ok('reversers: an aeroplane without them says so', SYS.reversePress({ onGround: true, reverse: 0, hasReversers: false }).refused);
  ok('reversers: idle reverse asks a little power, MAX about 70%, and never full', SYS.reverseDemand({ onGround: true, throttle: 0, reverse: 0.5 }).power > 0.1 && SYS.reverseDemand({ onGround: true, throttle: 0, reverse: 1 }).power === 0.7);
  ok('reversers: airborne, or with the power lever forward, they stow', SYS.reverseDemand({ onGround: false, throttle: 0, reverse: 1 }).stow && SYS.reverseDemand({ onGround: true, throttle: 0.5, reverse: 1 }).stow && !SYS.reverseDemand({ onGround: true, throttle: 0.1, reverse: 1 }).stow);
  const rv = (id) => SYS.hasReversers(TY.getAircraft(id));
  ok('reversers: the airliners and heavies have them (the Q400 its props\' reverse pitch, Concorde too); the light aeroplanes, the fighters and the helicopters do not', ['b737', 'a380', 'q400', 'concorde', 'c17', 'meridian'].every(rv) && !['skylark', 'courier', 'tempest', 'massimo', 'f22', 'a10', 'b1b', 'harrier', 'uh60'].some(rv) && !SYS.hasReversers({ rotor: true }));
  ok('reversers and spoilers: the flight spec carries the same answer (types.js specFor), for the physics', TY.specFor('b737').reversers === true && TY.specFor('b737').spoilers === true && TY.specFor('skylark').reversers === false && TY.specFor('skylark').spoilers === false && TY.specFor('harrier').reversers === false);
  const stopped = SYS.reversePress({ onGround: true, reverse: 0, hasReversers: true, groundSpeed: 0.2 });
  ok('reversers: stopped, the lever will not come out (reverse is for the landing roll)', stopped.refused && stopped.reverse === 0, stopped.note);
  ok('reversers: the roll over (forward speed below 1 m/s, or going backwards), they stow; the reversed thrust fades out below about 15 kt', SYS.reverseDemand({ onGround: true, throttle: 0, reverse: 1, forwardSpeed: 0.5 }).stow && SYS.reverseDemand({ onGround: true, throttle: 0, reverse: 1, forwardSpeed: -3 }).stow && SYS.reverseShare(40) === 1 && SYS.reverseShare(4) === 0.5 && SYS.reverseShare(-2) === 0);
}
{
  ok('radio: the menu offers pushback, taxi, take-off and landing', SYS.ATC_REQUESTS.map((r) => r.id).join() === 'pushback,taxi,takeoff,landing');
  ok('radio: it suggests what fits — pushback on a stand, taxi on the ground, take-off on the runway, landing in the air',
    SYS.suggestedRequest({ onGround: true, onStand: true }) === 'pushback' && SYS.suggestedRequest({ onGround: true }) === 'taxi'
    && SYS.suggestedRequest({ onGround: true, onRunway: true }) === 'takeoff' && SYS.suggestedRequest({ onGround: false }) === 'landing');
  const ctx = { callsign: 'Meridian four two zero', field: 'Kestrel', runway: 'zero nine', wind: 'wind zero nine zero at 8' };
  const push = SYS.atcAnswer('pushback', { ...ctx, onGround: true, onStand: true, side: 'left' });
  ok('radio: pushback on a stand is approved by Ground, facing the way the tug is set', push.ok && push.voice === 'ground' && /push back approved, face left/.test(push.text) && /Meridian four two zero/.test(push.text), push.text);
  ok('radio: pushback off a stand is refused', !SYS.atcAnswer('pushback', { ...ctx, onGround: true, onStand: false }).ok);
  const taxi = SYS.atcAnswer('taxi', { ...ctx, onGround: true });
  ok('radio: taxi is the Ground call the game already makes at engine start, and stands in for it', taxi.ok && taxi.mark === 'start' && /runway zero nine, wind zero nine zero at 8/.test(taxi.text), taxi.text);
  const to = SYS.atcAnswer('takeoff', { ...ctx, onGround: true, onRunway: true, lined: true });
  ok('radio: take-off lined up on the runway is the clearance line', to.ok && to.mark === 'clearance' && /cleared for take-off/.test(to.text), to.text);
  ok('radio: take-off off the runway → hold short; on it but across it → line up and wait', /hold short/.test(SYS.atcAnswer('takeoff', { ...ctx, onGround: true }).text) && /line up/.test(SYS.atcAnswer('takeoff', { ...ctx, onGround: true, onRunway: true, lined: false }).text));
  const land = SYS.atcAnswer('landing', { ...ctx, onGround: false });
  ok('radio: landing in the air is the cleared-to-land line, and marks the automatic one as said', land.ok && land.mark === 'final' && /cleared to land runway zero nine/.test(land.text));
  ok('radio: landing on the ground is refused politely', !SYS.atcAnswer('landing', { ...ctx, onGround: true }).ok);
  const real = /\b(KLM|Delta|United|Speedbird|Emirates)\b/;
  ok('radio: no answer names a real airline', ['pushback', 'taxi', 'takeoff', 'landing'].every((r) => !real.test(SYS.atcAnswer(r, { ...ctx, onGround: true, onStand: true, onRunway: true, lined: true }).text)));
}

/* ---------------- 2. the flight model ---------------- */

T.applyMap('kestrel');
const weather = new Weather();
weather.load({ time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
const STEP = 1 / 120;

/** A 737 on the Kestrel runway, rolling east at `speed` m/s, engine running; drive it with `each(ac)` per step for `seconds`. */
function roll(speed, seconds, each) {
  P.applyAircraft('b737');
  const ac = new P.Aircraft();
  ac.mode = 'normal';
  ac.reset({ pos: new THREE.Vector3(-400, 0, 0), headingDeg: 90, speed, altAGL: null, engineOn: true, gearDown: true, fuel: 0.6 });
  ac.parkingBrake = false;
  for (let t = 0; t < seconds; t += STEP) {
    each(ac, t);
    ac.update(STEP, weather);
  }
  return ac;
}
{
  const idle = roll(60, 12, (ac) => { ac.controls.throttle = 0; ac.spoilersArmed = false; });
  const rev = roll(60, 12, (ac) => { ac.controls.throttle = 0; ac.spoilersArmed = false; ac.reverse = 1; });
  const revSp = roll(60, 12, (ac) => { ac.controls.throttle = 0; ac.spoilersArmed = true; ac.reverse = 1; });
  ok('a 737 rolling at 60 m/s with idle power is still rolling after 12 s; with MAX reverse it is much slower', idle.groundSpeed > 20 && rev.groundSpeed < idle.groundSpeed * 0.75, `idle ${idle.groundSpeed.toFixed(1)} m/s, MAX reverse ${rev.groundSpeed.toFixed(1)} m/s`);
  ok('…and with the ground spoilers up as well, slower again (or stopped)', revSp.groundSpeed <= rev.groundSpeed + 0.01, `reverse+spoilers ${revSp.groundSpeed.toFixed(1)} m/s`);
  ok('MAX reverse spools the engine up though the throttle is closed', rev.rpm > idle.rpm + 0.2, `rpm ${rev.rpm.toFixed(2)} vs idle ${idle.rpm.toFixed(2)}`);
  ok('the reverser lever stays pulled while the aeroplane rolls on the ground', rev.reverse === 1 && !rev.crashed);
  const armed = roll(60, 2, (ac) => { ac.controls.throttle = 0; });
  ok('armed ground spoilers come up by themselves on a landing roll with the power at idle', armed.spoilerPos > 0.9, `pos ${armed.spoilerPos.toFixed(2)}`);
  const stowed = roll(60, 2, (ac, t) => { ac.controls.throttle = t < 1 ? 0 : 1; ac.speedbrake = t < 1 ? 1 : ac.speedbrake; });
  ok('power on the ground stows the lever and brings the spoilers down', stowed.speedbrake === 0 && stowed.spoilerPos < 0.5, `lever ${stowed.speedbrake}, pos ${stowed.spoilerPos.toFixed(2)}`);
  const pushed = roll(30, 1.5, (ac, t) => { ac.controls.throttle = t < 0.5 ? 0 : 0.8; ac.reverse = t < 0.5 ? 1 : ac.reverse; });
  ok('the power lever pushed forward stows the reversers', pushed.reverse === 0);
}
{
  /** A 737 level at 5000 ft, 120 m/s, power as set, for `seconds` (the 172 has no speedbrake). */
  const fly = (seconds, each, id = 'b737') => {
    P.applyAircraft(id);
    const ac = new P.Aircraft();
    ac.mode = 'normal';
    ac.reset({ pos: new THREE.Vector3(-9000, 0, 6000), headingDeg: 90, speed: id === 'skylark' ? 60 : 120, altAGL: 5000, engineOn: true, gearDown: false, fuel: 0.8 });
    for (let t = 0; t < seconds; t += STEP) {
      each(ac, t);
      ac.update(STEP, weather);
    }
    return ac;
  };
  const clean = fly(8, (ac) => { ac.controls.throttle = 0.5; });
  const braked = fly(8, (ac) => { ac.controls.throttle = 0.5; ac.speedbrake = 1; });
  ok('the speedbrake out in the air costs airspeed at the same power', braked.airspeed < clean.airspeed - 2 && braked.spoilerPos > 0.9, `clean ${clean.airspeed.toFixed(1)} m/s, FULL speedbrake ${braked.airspeed.toFixed(1)} m/s`);
  const airRev = fly(2, (ac) => { ac.controls.throttle = 0.5; ac.reverse = 1; });
  ok('the reversers set in the air stow themselves at once', airRev.reverse === 0);
  const sky = fly(4, (ac) => { ac.controls.throttle = 0.5; ac.speedbrake = 1; }, 'skylark');
  ok('the 172 has no speedbrake: the lever set by hand stays in and nothing stands up', sky.speedbrake === 0 && sky.spoilerPos === 0, `lever ${sky.speedbrake}, pos ${sky.spoilerPos}`);
  const r = braked.readouts();
  ok('the readouts carry the levers and the lights for the pills and the sheets', r.speedbrake === 1 && r.spoilerPos > 0.9 && r.spoilersArmed === true && r.reverse === 0 && r.lights && r.lights.nav === 'auto');
  braked.lights.strobe = 'off';
  braked.spoilersArmed = false;
  braked.reset({ pos: new THREE.Vector3(-400, 0, 0), headingDeg: 90, speed: 0, altAGL: null, engineOn: false, gearDown: true, fuel: 1 });
  ok('a reset puts every switch back: lights auto, lever in, spoilers armed, reversers stowed', braked.lights.strobe === 'auto' && braked.speedbrake === 0 && braked.spoilersArmed === true && braked.reverse === 0 && braked.spoilerPos === 0);
}
{
  P.applyAircraft('harrier');
  const h = new P.Aircraft();
  h.reset({ pos: new THREE.Vector3(-400, 0, 0), headingDeg: 90, speed: 0, altAGL: null, engineOn: true, gearDown: true, fuel: 1 });
  h.speedbrake = 1;
  h.reverse = 1;
  for (let t = 0; t < 2; t += STEP) h.update(STEP, weather);
  ok('a helicopter ignores the levers: no spoiler drag, no reverse thrust', h.spoilerPos <= 1 && !h.crashed && h.groundSpeed < 1, `gs ${h.groundSpeed.toFixed(2)}`);
  ok('…and the reverser lever does not spool the rotor up with the collective down', h.reverse === 0 && h.rpm < 0.25 && h.spoilerPos === 0, `rpm ${h.rpm.toFixed(2)}, reverse ${h.reverse}`);
}
{
  // MAX reverse held to the end of the roll: it slows the 737 to a stop and
  // stows — it never drives it backwards down the runway.
  const fwd = new THREE.Vector3();
  let minFwd = Infinity;
  const held = roll(60, 45, (ac) => {
    ac.controls.throttle = 0;
    ac.spoilersArmed = false;
    if (ac.reverse === 0 && ac.groundSpeed > 5) ac.reverse = 1;
    fwd.set(0, 0, -1).applyQuaternion(ac.quat);
    minFwd = Math.min(minFwd, ac.vel.dot(fwd));
  });
  ok('MAX reverse held to a stop never pushes the aeroplane backwards, and the reversers stow themselves at the end of the roll', minFwd > -0.3 && held.reverse === 0 && held.groundSpeed < 3 && !held.crashed, `slowest along the nose ${minFwd.toFixed(2)} m/s, now ${held.groundSpeed.toFixed(2)} m/s, lever ${held.reverse}`);
}

/* ---------------- 3. the game ---------------- */

await imp('src/features/index.js');
const I = await imp('src/flight/input.js');
const F = await imp('src/features/pilot-systems.js');
const C = await imp('src/ui/touch-coverage.js');
const PL = await imp('src/ui/pills.js');
{
  // w17: the radio is F8 first, then Z (shared by design with the Meteor zapper), then Insert.
  const want = { lights: 'PageUp', spoilers: 'PageDown', reversers: 'End', atcRequest: 'F8' };
  const bad = Object.entries(want).filter(([id, key]) => !I.ACTIONS[id] || I.ACTIONS[id].default[0] !== key);
  ok('the four actions are in the registry with the navigation keys (every letter and digit was taken)', bad.length === 0, bad.map(([id]) => id).join(', ') || Object.keys(want).join(', '));
  ok('the radio has F8, the letter Z and Insert', I.ACTIONS.atcRequest.default.join() === 'F8,KeyZ,Insert', I.ACTIONS.atcRequest.default.join());
  ok('lights and the radio work in the helicopter too; the levers are the aeroplane\'s', I.ACTIONS.lights.ctx.includes('heli') && I.ACTIONS.atcRequest.ctx.includes('heli') && I.ACTIONS.spoilers.ctx.join() === 'plane' && I.ACTIONS.reversers.ctx.join() === 'plane');
  const clashes = I.findConflicts(I.defaultBindings());
  const mine = Object.keys(clashes).filter((k) => k in want);
  ok('none of the four clashes with another action\'s default', mine.length === 0, JSON.stringify(mine.map((k) => clashes[k])).slice(0, 200));
  const gaps = C.coverageGaps(I.ACTIONS);
  ok('every one of them has a touch row, on a sheet', Object.keys(want).every((id) => C.TOUCH_COVERAGE[id] && C.TOUCH_COVERAGE[id].via === 'sheet') && !gaps.missing.some((id) => id in want));
  const touch = read('src/ui/touch.js');
  ok('ui/touch.js builds the buttons: LIGHTS, RADIO and SPEEDBRAKE on SYSTEMS, REVERSERS and SPOILERS on GROUND', /'LIGHTS: AUTO', 'lights'/.test(touch) && /'RADIO \(ATC\)', 'atcRequest'/.test(touch) && /'SPEEDBRAKE', 'spoilers'/.test(touch) && /'REVERSERS', 'reversers'/.test(touch) && /'SPOILERS: ARMED', 'spoilers'/.test(touch));
  const main = read('src/main.js');
  ok('main.js asks the features before the default branch (extHudAction) and merges their touch state (extTouchState)', /if \(extHudAction\(this, a\)\) break;/.test(main) && /\.\.\.extTouchState\(this\)/.test(main));
}
{
  const keys = { spoilers: 'PageDown', reversers: 'End', lights: 'PageUp' };
  const rev = PL.pillsFor({ onGround: true, speedKts: 60, reverse: 1, keys });
  ok('pills: MAX reverse on the roll is an info pill that stows them', rev.length === 1 && rev[0].id === 'reverse' && rev[0].level === 'info' && /MAX reverse/.test(rev[0].text) && rev[0].action === 'reverseStow' && /End/.test(rev[0].how), JSON.stringify(rev));
  const slow = PL.pillsFor({ onGround: true, speedKts: 5, reverse: 0.5, keys });
  ok('pills: reverse still pulled almost stopped turns amber (stow them before the apron)', slow[0] && slow[0].level === 'warn' && /Idle reverse/.test(slow[0].text));
  const sb = PL.pillsFor({ onGround: false, speedbrake: 0.5, gearPos: 0, aglFt: 5000, speedKts: 200, vsFpm: 0, keys });
  ok('pills: the speedbrake out in the air', sb.length === 1 && sb[0].id === 'speedbrake' && /½/.test(sb[0].text) && sb[0].action === 'speedbrakeIn');
  const gs = PL.pillsFor({ onGround: true, spoilerPos: 1, speedKts: 50, keys });
  ok('pills: ground spoilers up', gs.length === 1 && gs[0].id === 'groundSpoilers' && gs[0].action === 'spoilersDown');
  const arm = PL.pillsFor({ onGround: false, spoilersArmed: false, gearPos: 1, aglFt: 1500, speedKts: 140, vsFpm: -500, keys });
  ok('pills: gear down on the approach with the spoilers disarmed is an amber pill that arms them', arm.length === 1 && arm[0].id === 'spoilersArm' && arm[0].level === 'warn' && arm[0].action === 'spoilersArm');
  ok('pills: armed, or high, or gear up, there is no such pill', PL.pillsFor({ onGround: false, spoilersArmed: true, gearPos: 1, aglFt: 1500, speedKts: 140, vsFpm: 0 }).length === 0 && PL.pillsFor({ onGround: false, spoilersArmed: false, gearPos: 1, aglFt: 5000, speedKts: 140, vsFpm: 0 }).length === 0);
  const li = PL.pillsFor({ onGround: true, lightsPreset: 'ALL OFF', keys });
  ok('pills: lights off auto say which preset, and take them back to auto', li.length === 1 && li[0].id === 'lights' && /ALL OFF/.test(li[0].text) && li[0].action === 'lightsAuto' && /PageUp/.test(li[0].how));
  ok('pills: on auto there is no lights pill', PL.pillsFor({ onGround: true, lightsPreset: null }).length === 0);
  const busy = PL.pillsFor({ onGround: true, parkingBrake: true, engineOn: true, reverse: 1, speedKts: 0, lightsPreset: 'TAXI', keys });
  ok('pills: still never more than two, worst first', busy.length === PL.MAX_PILLS && busy[0].level !== 'info', busy.map((p) => `${p.id}:${p.level}`).join());
  const touch = PL.pillsFor({ onGround: true, speedKts: 60, reverse: 1, touch: true });
  ok('pills: on a touch screen the hint is the tap', /tap to stow/.test(touch[0].how));
}
{
  // The feature's own actions, on a stand-in game.
  const ac = { lights: SYS.defaultLights(), speedbrake: 1, spoilersArmed: false, reverse: 1 };
  const notes = [];
  const sim = { aircraft: ac, hud: { notify: (t) => notes.push(t) }, state: 'flying' };
  ok('hudAction: speedbrakeIn, spoilersArm, reverseStow and lightsAuto do what they say, and say so', F.hudAction(sim, 'speedbrakeIn') && ac.speedbrake === 0 && F.hudAction(sim, 'spoilersArm') && ac.spoilersArmed === true && F.hudAction(sim, 'reverseStow') && ac.reverse === 0 && notes.length === 3, notes.join(' | '));
  ac.lights.nav = 'off';
  ok('hudAction: lightsAuto puts every lamp back on auto; an action that is not ours is left alone', F.hudAction(sim, 'lightsAuto') && ac.lights.nav === 'auto' && F.hudAction(sim, 'parkingBrake') === false);
  const st = F.touchState({ aircraft: ac, aircraftType: TY.getAircraft('b737') });
  ok('touchState: the sheets get the preset, the levers and whether there are reversers', st.lights === 'AUTO' && st.lightsAuto === true && st.speedbrake === 0 && st.spoilersArmed === true && st.reverse === 0 && st.hasReversers === true && st.hasSpoilers === true && st.radioOpen === false, JSON.stringify(st));
  ok('touchState: a helicopter has no reversers to offer', F.touchState({ aircraft: ac, aircraftType: { rotor: true } }).hasReversers === false);
  const heliSt = F.touchState({ aircraft: ac, aircraftType: TY.getAircraft('uh60') });
  const skySt = F.touchState({ aircraft: ac, aircraftType: TY.getAircraft('skylark') });
  ok('touchState: the real helicopter and the 172 offer neither reversers nor spoilers (the sheets hide those buttons)', heliSt.hasReversers === false && heliSt.hasSpoilers === false && skySt.hasReversers === false && skySt.hasSpoilers === false);
  const keyNotes = [];
  const heli = { aircraft: { ...ac, onGround: true, reverse: 0, speedbrake: 0, groundSpeed: 0 }, aircraftType: TY.getAircraft('uh60'), state: 'flying', mode: 'free', hud: { notify: (t) => keyNotes.push(t) } };
  const endTaken = F.handleKey(heli, 'End', true) || F.handleKey(heli, 'PageDown', true);
  ok('in a real helicopter the reverser and spoiler keys are not the feature\'s (left for the helicopter\'s own controls)', endTaken !== true && heli.aircraft.reverse === 0 && heli.aircraft.speedbrake === 0, `taken ${endTaken}; ${keyNotes.join(' | ')}`);
  ok('the controller answers after a short pause, not in the same breath', F.REPLY_DELAY >= 1 && F.REPLY_DELAY <= 2.5);
}

/* ---------------- report ---------------- */
let fails = 0;
for (const r of results) {
  if (!r.pass) fails++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
