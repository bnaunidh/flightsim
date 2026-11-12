/**
 * Node checks for the ATC controller (src/game/atc-controller.js) and its
 * wiring (src/features/atc-plus.js, pilot-systems.js, airspace.js, traffic.js).
 *
 *   node tests/features/atc-plus.mjs
 *
 * 1. THE MENU BY PHASE: clearance on the ground, climbs / direct / following
 *    en route, the ILS / visual / go-around near the field, MAYDAY and
 *    PAN-PAN in the air, cancel once one is declared.
 * 2. INSTRUCTIONS: a clearance with a squawk to read back, a climb, hold
 *    short with traffic on final then line up and wait, the hand-offs
 *    tower → departure → (zone gone) centre, approach → tower inbound.
 * 3. COMPLIANCE: nothing inside the grace period or inside the tolerance;
 *    one gentle word ("check altitude, maintain 5,000") when you stay off.
 * 4. SEQUENCING: number two behind the AI arrival on final, number three
 *    behind two, the landing clearance released when they are down.
 * 5. EMERGENCY: priority, the traffic told (fx.emergency), the landing
 *    clearance given at once, no reminders or advisories while it lasts.
 * 6. A SCRIPTED FLIGHT: an ILS flown on the controller's own vectors from 30
 *    km out, reading every instruction back, to established and handed to
 *    the tower — and a score at the end.
 * 7. THE WIRING: the feature is loaded on demand (not in main.js's static
 *    graph), the traffic holds for the player's emergency.
 */
import { readFileSync } from 'node:fs';

const C = await import('../../src/game/atc-controller.js');
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};

const FT = 3.28084;
const field = { name: 'Kestrel', x: -350, z: 0, elev: 0, crs: 90, rw: 'zero nine' };
function snap(o = {}) {
  return {
    t: 0, cs: 'Island 123', field, wind: 'wind 0 9 0 at 5', onGround: false, onRunway: false, nearRunway: false, lined: false,
    gs: 60, airborneTime: 100, x: -20000, z: 0, altFt: 3000, aglFt: 3000, hdg: 90, kts: 150, vsFpm: 0, cls: 'jet',
    zone: { name: 'KESTREL APPROACH', freq: '119.20' }, dest: null, runwayBusy: false, crashed: false, traffic: [], ...o,
  };
}
const ids = (m) => m.map((r) => r.id);
const texts = (ev) => ev.filter((e) => e.text).map((e) => e.text).join(' | ');
/** Step the controller n seconds at 4 Hz with a snapshot maker; returns every event. */
function run(ctl, secs, mk) {
  const out = [];
  for (let t = 0; t < secs; t += 0.25) out.push(...ctl.step(0.25, typeof mk === 'function' ? mk(t) : mk));
  return out;
}

/* ---------------- 1. the menu by phase ---------------- */
{
  const ctl = new C.AtcController();
  const g = ids(ctl.menu(snap({ onGround: true, gs: 0, altFt: 0, aglFt: 0, x: -400, z: 120 })));
  ok('menu: on the ground, a clearance (and no flying requests)', g.includes('clearance') && !g.includes('climb') && !g.includes('mayday'), g.join());
  const er = ids(ctl.menu(snap({ x: -60000, altFt: 6000, aglFt: 6000, zone: null })));
  ok('menu: en route, climb / descend / direct / following / position / MAYDAY / PAN-PAN, no go-around', ['climb', 'descend', 'direct', 'following', 'position', 'mayday', 'panpan'].every((k) => er.includes(k)) && !er.includes('goaround') && !er.includes('clearance'), er.join());
  const fin = ids(ctl.menu(snap({ x: -3000, altFt: 900, aglFt: 900 })));
  ok('menu: on a low final, the ILS, a visual approach and go-around', ['ils', 'visual', 'goaround'].every((k) => fin.includes(k)), fin.join());
  const lowAlt = ctl.menu(snap({ x: -60000, altFt: 1800, aglFt: 1800, zone: null }));
  ok('menu: no descent offered below 1,500 ft above the field', !ids(lowAlt).includes('descend') && lowAlt.find((r) => r.id === 'climb').sub === 'to 4,000', lowAlt.map((r) => `${r.id}:${r.sub}`).join());
  ctl.request('mayday', snap());
  const em = ids(ctl.menu(snap()));
  ok('menu: once declared, cancel instead of MAYDAY / PAN-PAN', em.includes('cancel') && !em.includes('mayday') && !em.includes('panpan'), em.join());
}

/* ---------------- 2. instructions ---------------- */
{
  const ctl = new C.AtcController({ seed: 7 });
  const s0 = snap({ onGround: true, gs: 0, altFt: 0, aglFt: 0, x: -400, z: 150, cls: 'jet', dest: 'Haven' });
  const r = ctl.request('clearance', s0);
  const sq = ctl.st.squawk;
  ok('clearance: IFR for a jet, from Delivery, with a four-digit squawk of 0-7 (not an emergency code)', /Kestrel Delivery, cleared to Haven via the Kestrel One departure/.test(r.events[0].text) && r.events[0].voice === 'delivery' && /^[0-7]{4}$/.test(sq) && !['7500', '7600', '7700'].includes(sq), r.events[0].text);
  ok('clearance: the pilot\'s words and one instruction waiting for a readback', /request IFR clearance/.test(r.you) && ctl.pending().length === 1, r.you);
  const rb = ctl.readback(s0);
  ok('clearance: the readback carries the squawk and the callsign, and Delivery says "readback correct"', rb.count === 1 && rb.you.includes(sq) && /Island 123$/.test(rb.you) && /readback correct/.test(texts(rb.events)) && ctl.pending().length === 0, rb.you);
  const vfr = new C.AtcController({ seed: 3 });
  const v = vfr.request('clearance', snap({ onGround: true, gs: 0, cls: 'light' }));
  ok('clearance: VFR for a light aeroplane, a ceiling until clear of the zone', /VFR departure approved/.test(v.events[0].text) && /at or below 2,000/.test(v.events[0].text), v.events[0].text);

  const c2 = new C.AtcController();
  const cl = c2.request('climb', snap({ altFt: 3200 }));
  ok('climb: "climb and maintain 5,000", a target and a pending readback', /climb and maintain 5,000/.test(cl.events[0].text) && c2.st.tg.alt.v === 5000 && c2.pending().length === 1, cl.events[0].text);

  // Hold short with an AI arrival on final, then line up and wait once it is down.
  const c3 = new C.AtcController();
  const g = { onGround: true, gs: 0, altFt: 0, aglFt: 0, x: -500, z: 60, nearRunway: true };
  c3.heard('Island 123, Kestrel Ground, runway zero nine. Taxi to the holding point and hold short.', snap(g));
  ok('hold short: the taxi answer\'s "hold short" is an instruction to read back', c3.st.holdShort && c3.pending()[0].kind === 'holdShort');
  const arr = { id: 't1', cs: 'Kanal 47', type: 'Meridian 220', x: -4000, z: 0, altFt: 1200, hdg: 90, vsFpm: -700, kts: 140, phase: 'approach', onGround: false };
  const e1 = run(c3, 4, snap({ ...g, traffic: [arr] }));
  ok('hold short: at the holding point with an arrival on final, the tower says hold short, traffic on final, and why', /hold short runway zero nine, traffic on final, Kanal 47, a Meridian 220/.test(texts(e1)) && c3.st.holdShort, texts(e1));
  const inc = run(c3, 2, snap({ ...g, onRunway: true, traffic: [arr] }));
  ok('hold short: onto the runway anyway with the arrival on final: "stop, hold position", gently, once', /stop, hold position/.test(texts(inc)) && c3.reminders === 1, texts(inc));
  const e2 = run(c3, 8, snap({ ...g, traffic: [] }));
  ok('hold short: the arrival down, "line up and wait" (and the director\'s automatic clearance held)', /line up and wait/.test(texts(e2)) && e2.some((e) => e.fx && e.fx.block && e.fx.block.includes('clearance')), texts(e2));
  const e3 = run(c3, 10, snap({ ...g, onRunway: true, lined: true, nearRunway: false }));
  ok('line up: lined up and stopped, the tower clears you for take-off', /cleared for take-off/.test(texts(e3)), texts(e3));

  // The hand-offs.
  const c4 = new C.AtcController();
  c4.request('clearance', snap({ onGround: true, gs: 0, altFt: 0, aglFt: 0, x: -400, z: 150 }));
  c4.readback(snap());
  run(c4, 2, snap({ onGround: true, onRunway: true, lined: true, gs: 30, altFt: 0, aglFt: 0, x: -300 }));
  const dep = run(c4, 25, (t) => snap({ airborneTime: t, altFt: 300 + t * 40, aglFt: 300 + t * 40, x: 0 + t * 80 }));
  ok('hand-off: soon after take-off the tower says contact Kestrel Departure, its frequency, good day', /contact Kestrel Departure, 1\d\d\.\d\d\. Good day/.test(texts(dep)) && dep.find((e) => e.text).voice === 'tower', texts(dep).slice(0, 160));
  ok('hand-off: then departure, radar contact, report your intentions', /Kestrel Departure, radar contact, climb and maintain 8,000\. Report your intentions/.test(texts(dep)) && c4.st.unit === 'departure', `${c4.st.unit}: ${texts(dep).slice(-120)}`);
  ok('hand-off: the IFR climb comes with it (4,000 cleared, 8,000 now) and the director\'s own "radar contact" is held', c4.st.tg.alt.v === 8000 && dep.some((e) => e.fx && e.fx.block && e.fx.block.includes('airborne')), texts(dep).slice(-140));
  const vfr2 = new C.AtcController();
  run(vfr2, 2, snap({ onGround: true, onRunway: true, lined: true, gs: 30, altFt: 0, aglFt: 0, x: -300 }));
  const circ = run(vfr2, 60, (t) => snap({ airborneTime: t, altFt: Math.min(1000, 100 + t * 30), aglFt: Math.min(1000, 100 + t * 30), x: -300 + t * 40, z: 0 }));
  ok('hand-off: a VFR circuit (no clearance) stays with the tower', !/contact/.test(texts(circ)) && vfr2.st.unit === 'tower', texts(circ));
  const c5 = new C.AtcController();
  run(c5, 1, snap({ x: -30000, altFt: 4000, aglFt: 4000 }));
  const inb = run(c5, 3, snap({ x: -6000, altFt: 2000, aglFt: 2000 }));
  ok('hand-off: inbound into the tower\'s airspace, approach says contact Kestrel Tower', /contact Kestrel Tower, 11\d\.\d\d/.test(texts(inb)) && c5.st.unit === 'tower', texts(inb));
  const c6 = new C.AtcController();
  run(c6, 1, snap({ x: -30000, altFt: 6000, aglFt: 6000 }));
  run(c6, 8, snap({ x: -40000, altFt: 6000, aglFt: 6000, zone: null }));
  ok('hand-off: out of every zone, on Island Centre (airspace.js says the words)', c6.st.unit === 'centre' && c6.current(snap({ zone: null })).freq === '127.85', c6.st.unit);
  const heard = c6.heard('Island 123, leaving Kestrel airspace, frequency change approved, contact Island Centre, 127.85. Good day.', snap({ zone: null }));
  ok('hand-off: the airspace\'s "contact Island Centre" is an instruction to read back', heard && heard.kind === 'contact' && /Island Centre, 127.85/.test(heard.rb), heard && heard.rb);
}

/* ---------------- 3. compliance ---------------- */
{
  const ctl = new C.AtcController();
  ctl.request('climb', snap({ altFt: 3200 }));
  ctl.readback(snap());
  const early = run(ctl, 20, snap({ altFt: 3200 }));
  ok('compliance: nothing inside the grace period', !/check altitude/.test(texts(early)), texts(early));
  const going = run(ctl, 40, (t) => snap({ altFt: Math.min(5000, 3200 + t * 60) }));
  ok('compliance: climbing to it, then level at it, never a word', !/check/.test(texts(going)), texts(going));
  const off = run(ctl, 30, snap({ altFt: 5600 }));
  ok('compliance: 600 ft above it for a while: "check altitude, maintain 5,000", once', (texts(off).match(/check altitude, maintain 5,000/g) || []).length === 1 && ctl.reminders === 1, texts(off));
  const h = new C.AtcController();
  h.setHdg(270, h.issue('vector', 'Heading 270', 'Heading 270', { hdg: 270 }));
  const hd = run(h, 40, snap({ hdg: 200 }));
  ok('compliance: a heading flown 70° off: "check heading, fly heading 270"', /check heading, fly heading 270/.test(texts(hd)), texts(hd));
  const hk = new C.AtcController();
  hk.setHdg(270, hk.issue('vector', 'Heading 270', 'Heading 270', { hdg: 270 }));
  ok('compliance: within 20° of it, nothing', !/check/.test(texts(run(hk, 60, snap({ hdg: 255 })))));
}

/* ---------------- 4. sequencing ---------------- */
{
  const ctl = new C.AtcController();
  const a1 = { id: 'a1', cs: 'Kanal 47', type: 'Meridian 220', x: -4000, z: 100, altFt: 1300, hdg: 90, vsFpm: -700, kts: 140, phase: 'approach', onGround: false };
  const a2 = { id: 'a2', cs: 'Royal Isles 12', type: 'Courier', x: -8000, z: -100, altFt: 2400, hdg: 90, vsFpm: -600, kts: 120, phase: 'approach', onGround: false };
  const me = (o) => snap({ x: -15000, altFt: 3000, aglFt: 3000, hdg: 90, kts: 150, ...o });
  ctl.st.unit = 'approach';
  ctl.st.approach = { kind: 'visual', stage: 'established', t: 0 };
  const e = run(ctl, 2, me({ traffic: [a1, a2] }));
  ok('sequencing: two arrivals ahead: number three, follow the nearer one (the Courier)', /number three, follow the Courier on final, Royal Isles 12/.test(texts(e)) && e.some((x) => x.fx && x.fx.block && x.fx.block.includes('final')), texts(e));
  const e2 = run(ctl, 6, me({ traffic: [a1, { ...a2, onGround: true, phase: 'rollout' }] }));
  ok('sequencing: the Courier down, number two behind the Meridian', /number two, follow the Meridian 220 on final, Kanal 47/.test(texts(e2)), texts(e2));
  const e3 = run(ctl, 3, me({ traffic: [{ ...a1, onGround: true, phase: 'rollout' }] }));
  ok('sequencing: both down, the director\'s landing clearance is released', e3.some((x) => x.fx && x.fx.unblock && x.fx.unblock.includes('final')) && !ctl.st.seq);
  const behind = new C.AtcController();
  behind.st.unit = 'tower';
  behind.st.approach = { kind: 'visual', stage: 'established', t: 0 };
  ok('sequencing: an arrival BEHIND you is not followed', !/number/.test(texts(run(behind, 3, me({ x: -5000, traffic: [{ ...a2, x: -12000 }] })))));
  const fast = new C.AtcController();
  fast.st.unit = 'tower';
  fast.st.approach = { kind: 'visual', stage: 'established', t: 0 };
  run(fast, 1, me({ x: -7000, kts: 190, traffic: [a1] }));
  const sp = run(fast, 8, me({ x: -7000, kts: 190, traffic: [a1] }));
  ok('sequencing: closing on it fast in a jet: "reduce speed to 140 knots, traffic ahead"', /reduce speed to 140 knots/.test(texts(sp)) && fast.st.tg.kts.v === 140, texts(sp));
}

/* ---------------- 5. emergency ---------------- */
{
  const ctl = new C.AtcController();
  ctl.request('climb', snap({ altFt: 3200 }));
  const r = ctl.request('mayday', snap({ x: -12000 }));
  const ev = r.events[0];
  ok('mayday: acknowledged, priority, the runway cleared, emergency services standing by, cleared to land', /MAYDAY acknowledged.*you have priority.*runway is yours.*Emergency services are standing by.*cleared to land/.test(ev.text) && ev.urgency === 1, ev.text);
  ok('mayday: the traffic is told (fx.emergency), the scene raised, the automatic landing call held', ev.fx.emergency === 'mayday' && ev.fx.scene === 'raise' && ev.fx.block.includes('final'));
  ok('mayday: the climb is cancelled: no targets to fly', !ctl.st.tg.alt && !ctl.st.tg.hdg);
  const quiet = run(ctl, 60, snap({ x: -12000, altFt: 6000, traffic: [{ id: 'x', cs: 'Spit 20', type: 'Courier', x: -11000, z: 500, altFt: 6200, hdg: 0, vsFpm: 0, kts: 120, phase: 'route', onGround: false }] }));
  ok('mayday: while it lasts, no traffic advisories and no reminders', !/traffic,|check/.test(texts(quiet)), texts(quiet));
  ok('mayday: on the menu, cancel', ids(ctl.menu(snap())).includes('cancel'));
  const down = run(ctl, 8, snap({ onGround: true, gs: 0, altFt: 0, aglFt: 0, x: 200 }));
  ok('mayday: down and stopped: "emergency services are with you", and the emergency ends', /emergency services are with you/.test(texts(down)) && down.some((e) => e.fx && e.fx.emergency === null) && !ctl.st.emergency, texts(down));
  const pan = new C.AtcController().request('panpan', snap());
  ok('pan-pan: priority, direct to the field, emergency services alerted', /PAN-PAN acknowledged.*priority.*Proceed direct Kestrel.*emergency services have been alerted/.test(pan.events[0].text) && pan.events[0].fx.emergency === 'panpan', pan.events[0].text);
  const cx = new C.AtcController();
  cx.request('panpan', snap());
  const c = cx.request('cancel', snap());
  ok('cancel: "emergency cancelled", the traffic resumes', /emergency cancelled/.test(c.events[0].text) && c.events[0].fx.emergency === null && !cx.st.emergency);
}

/* ---------------- 6. advisories ---------------- */
{
  const ctl = new C.AtcController();
  ctl.st.unit = 'approach';
  const t = { id: 'q', cs: 'Kanal 47', type: 'Meridian 220', x: -20000 + 3000, z: 0 - 3000 * 0.2, altFt: 4000, hdg: 270, vsFpm: -900, kts: 200, phase: 'route', onGround: false };
  // Heading north (0): east of us is three o'clock.
  const e = run(ctl, 2, snap({ hdg: 0, traffic: [{ ...t, x: -20000 + 5000, z: 0 }] }));
  ok('advisory: traffic, three o\'clock, 3 miles, its callsign and type, 1,000 feet above, descending', /traffic, three o'clock, 3 miles, Kanal 47, a Meridian 220, 1,000 feet above, descending/.test(texts(e)), texts(e));
  ok('advisory: information, not an instruction — nothing waits for a readback, and the window shows it', ctl.pending().length === 0 && /Traffic three o'clock/.test(ctl.current(snap()).now));
  const again = run(ctl, 30, snap({ hdg: 0, traffic: [{ ...t, x: -20000 + 5000, z: 0 }] }));
  ok('advisory: not repeated for the same aeroplane a moment later', !/traffic,/.test(texts(again).replace(/please read back/g, '')), texts(again));
  ok('advisory: clock positions', C.clockOf(0, 0, 0, 0, -100) === 'twelve' && C.clockOf(0, 0, 0, 100, 0) === 'three' && C.clockOf(0, 0, 90, 0, -100) === 'nine' && C.clockOf(0, 0, 0, 100, -173) === 'one');
}

/* ---------------- 7. a scripted flight: the ILS on vectors ---------------- */
{
  const ctl = new C.AtcController({ seed: 11 });
  const p = { x: -32000, z: 9000, altFt: 6000, hdg: 135, kts: 160 };
  let t = 0;
  const mk = () => snap({ ...p, aglFt: p.altFt, t, airborneTime: 200 + t, vsFpm: 0 });
  const log = [];
  const r = ctl.request('ils', mk());
  log.push(...r.events.map((e) => e.text));
  ctl.readback(mk());
  let established = false;
  let reminders = 0;
  for (; t < 900 && !established; t += 0.25) {
    const tg = ctl.st.tg;
    // Fly what we were told: turn 3°/s to the heading, 1,500 ft/min to the altitude; established, the localiser.
    let want = tg.hdg ? tg.hdg.v : tg.direct ? C.bearing(p.x, p.z, tg.direct.x, tg.direct.z) : p.hdg;
    const ap = ctl.st.approach;
    const cr = C.frameOf(mk()).cross;
    if (ap && (ap.stage === 'established' || (ap.stage === 'intercept' && Math.abs(cr) < 1200))) want = 90 - Math.max(-30, Math.min(30, cr / 30));
    const dh = C.angDiff(want, p.hdg);
    p.hdg = (p.hdg + Math.max(-0.75, Math.min(0.75, dh)) + 360) % 360;
    if (tg.alt) p.altFt += Math.max(-6.25, Math.min(6.25, tg.alt.v - p.altFt));
    const v = p.kts / 1.94384;
    p.x += Math.sin((p.hdg * Math.PI) / 180) * v * 0.25;
    p.z -= Math.cos((p.hdg * Math.PI) / 180) * v * 0.25;
    const ev = ctl.step(0.25, mk());
    for (const e of ev) if (e.text) log.push(e.text);
    if (ev.some((e) => e.instr)) ctl.readback(mk());
    reminders = ctl.reminders;
    if (ctl.st.unit === 'tower' && ctl.st.approach && ctl.st.approach.stage === 'established') established = true;
  }
  const all = log.join(' | ');
  if (process.argv.includes('--ils')) console.log(log.join('\n'));
  ok('ILS: vectors first — fly heading, descend and maintain 3,000, vectors ILS approach runway zero nine', /fly heading \d{3}, descend and maintain 3,000, vectors ILS approach runway zero nine/.test(all), log[0]);
  ok('ILS: then the intercept — turn heading, maintain 2,000 until established on the localiser, cleared ILS approach', /turn (left|right) heading \d{3}, maintain 2,000 until established on the localiser, cleared ILS approach runway zero nine/.test(all), all.slice(0, 400));
  ok('ILS: flown as told, established and handed to the tower', established && /established on the localiser\. Contact Kestrel Tower/.test(all), `${Math.round(t)} s; ${all.slice(-200)}`);
  ok('ILS: flying the instructions draws no reminders', reminders === 0, `${reminders} reminders`);
  const fr = C.frameOf(mk());
  ok('ILS: established on the centreline, on the approach side, lined up', Math.abs(fr.cross) < 350 && fr.along > 3000 && Math.abs(C.angDiff(p.hdg, 90)) < 30, `along ${Math.round(fr.along)} cross ${Math.round(fr.cross)} hdg ${Math.round(p.hdg)}`);
  ctl.heard('Island 123, cleared to land runway zero nine, wind 0 9 0 at 5.', mk());
  ctl.readback(mk());
  run(ctl, 6, snap({ onGround: true, gs: 0, altFt: 0, aglFt: 0, x: 0 }));
  const sc = ctl.score();
  ok('score: every instruction read back on time and flown: 100%', sc.pct === 100 && sc.instructions >= 4 && sc.missed === 0, JSON.stringify(sc));
  const lazy = new C.AtcController();
  lazy.request('climb', snap({ altFt: 3200 }));
  run(lazy, 40, snap({ altFt: 3200 }));
  ok('score: an instruction never read back is chased once ("please read back"), then missed', lazy.score().missed === 1 && lazy.instr[0].chased, JSON.stringify(lazy.score()));
}

/* ---------------- 8. the wiring ---------------- */
{
  const ps = read('src/features/pilot-systems.js');
  ok('wiring: pilot-systems loads the feature on demand (a dynamic import), never statically', /import\('\.\/atc-plus\.js'\)/.test(ps) && !/^import .*atc-plus/m.test(ps));
  const ap = read('src/features/atc-plus.js');
  ok('wiring: the feature says through the director (subtitles, voice) and lists every extra request as a touch button', /\.say\(/.test(ap) && /data-atcx/.test(ap) && /data-readback/.test(ap));
  const tr = read('src/features/traffic.js');
  ok('wiring: the AI traffic holds for the player\'s declared emergency', /sim\.atcEmergency/.test(tr));
  const as = read('src/features/livemap/airspace.js');
  ok('wiring: leaving a zone names Island Centre when the controller is in', /atcPlus/.test(as));
  const vo = read('src/audio/atc.js');
  ok('wiring: Delivery, Departure and Island Centre have voices and subtitle labels', /delivery:/.test(vo) && /centre:/.test(vo) && /Delivery`/.test(vo) && /Island Centre/.test(vo));
  const words = C.PLUS_REQUESTS.map((r) => `${r.label} ${r.words}`).join(' ');
  ok('wording: no real airline in the controller', !/\b(United|Delta|American|Lufthansa|Emirates|Qantas|KLM|Ryanair|Southwest|British Airways)\b/.test(read('src/game/atc-controller.js') + words));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
