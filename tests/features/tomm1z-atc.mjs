/**
 * Node checks for the Tomm1z video pass, item 8 — ATC "REPORT YOUR
 * INTENTIONS" (.claude/devtools/briefs/tomm1z-video.md, 8:25: "How do I even
 * report? I don't know how I do that.").
 *
 *   node tests/features/tomm1z-atc.mjs
 *
 * game/atc-director.js: the first time the approach controller asks for
 * intentions, the HUD says how — the radio key by name (Z, F8) or RADIO on
 * the touch sheet — once a session, and not again on the next flight.
 */
import { load, ok, report } from './tomm1z-common.mjs';

await load('src/features/index.js');
const { AtcDirector, resetAtcHowSaid } = await load('src/game/atc-director.js');

function fakeSim({ touch = null } = {}) {
  const V = class {
    constructor(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    distanceTo(o) {
      return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z);
    }
  };
  const notes = [];
  const said = [];
  return {
    notes,
    said,
    touch,
    aircraftType: { id: 'skylark', callsign: 'Skylark one seven two' },
    aircraft: {
      crashed: false, engineOn: true, onGround: false, airborneTime: 6, heading: 90, agl: 300, vs: 2, altFt: 900,
      pos: new V(2000, 300, -1200), vel: new V(40, 0, 0), controls: { throttle: 0.8 }, gearDown: true,
      readouts: () => ({ heading: 90, iasKts: 80, altFt: 900, groundKts: 80 }),
      flapStep: () => 0,
    },
    weather: { windSpeedKts: 6, windDirDeg: 90, condition: 'clear', effectiveCondition: 'clear', isNight: false, cond: { rain: 0, turb: 0 } },
    hud: { notify: (t) => notes.push(t), setSubtitle() {} },
    speak: (t) => said.push(t),
    settings: { map: 'kestrel' },
  };
}

resetAtcHowSaid();
{
  const sim = fakeSim();
  const atc = new AtcDirector(sim);
  let threw = null;
  try {
    for (let i = 0; i < 60; i++) atc.update(0.1);
  } catch (e) {
    threw = e;
  }
  ok('the director runs on a stand-in sim', !threw, threw && threw.stack);
  const asked = sim.said.find((t) => /report your intentions/i.test(t));
  ok('airborne: "climb at your discretion and report your intentions"', !!asked, sim.said.join(' | '));
  const how = sim.notes.find((t) => /To report your intentions/i.test(t));
  ok('...and the HUD says HOW: the radio key by name', how && /press (F8|Z)/i.test(how) && /radio/i.test(how), sim.notes.join(' | '));
  ok('...naming Z or F8 (the atcRequest key), not a code', how && !/Key[A-Z]/.test(how), how);

  // The next flight: asked again, not told how again.
  const sim2 = fakeSim();
  const atc2 = new AtcDirector(sim2);
  for (let i = 0; i < 60; i++) atc2.update(0.1);
  ok('the next flight is asked again but not told how again (once a session)', sim2.said.some((t) => /report your intentions/i.test(t)) && !sim2.notes.some((t) => /To report/i.test(t)), sim2.notes.join(' | '));
}
{
  resetAtcHowSaid();
  const sim = fakeSim({ touch: {} });
  const atc = new AtcDirector(sim);
  for (let i = 0; i < 60; i++) atc.update(0.1);
  const how = sim.notes.find((t) => /To report your intentions/i.test(t));
  ok('on a touchscreen: "tap RADIO on the sheet"', how && /tap RADIO/i.test(how), how || sim.notes.join(' | '));
}

report();
