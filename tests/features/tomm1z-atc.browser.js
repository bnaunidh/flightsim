/**
 * Browser check for the Tomm1z video pass, item 8 — ATC AND THE EJECTION
 * (.claude/devtools/briefs/tomm1z-video.md, 8:25 "How do I even report?",
 * 9:01 the escorts following the empty aeroplane, someone lining up after
 * "the sky is yours", 9:09 "the planes are float"), in the real game: the
 * first "report your intentions" names the radio key; a mayday closes the
 * field to departures (features/traffic.js); ejecting during the mayday
 * ends it — the escorts are gone, the tower sees the parachute, the field
 * stays closed; and the empty aeroplane comes down rather than floating.
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/tomm1z-atc.browser.js check "" 1
 */

export const id = 'tomm1z-atc';

const toasts = () => [...document.querySelectorAll('.hud-toast')].map((t) => t.textContent).join(' | ');

export async function check(sim, r, say = () => {}) {
  const ok = (name, pass, detail = '') => r.ok(`tomm1z-atc: ${name}`, !!pass, detail);
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  let speak = null;
  try {
    const A = await import('../../src/game/atc-director.js');
    const T = await import('../../src/features/traffic.js');
    A.resetAtcHowSaid();
    const said = [];
    speak = sim.speak;
    sim.speak = function (text, voice, ...rest) {
      said.push(String(text));
      return speak.call(this, text, voice, ...rest);
    };

    say('tomm1z-atc: the first report-your-intentions');
    await sim.startMode('free', { aircraft: 'skylark', airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    sim.aircraft.airborneTime = 0;
    for (let t = 0; t < 12 && !said.some((s) => /report your intentions/i.test(s)); t += 0.5) sim.step(0.5);
    ok('airborne: the approach asks for intentions', said.some((s) => /report your intentions/i.test(s)), said.slice(-3).join(' | '));
    ok('...and the HUD says how, naming the radio key', /To report your intentions: .*(press (F8|Z)|RADIO)/i.test(toasts()), toasts().slice(-220));

    say('tomm1z-atc: a mayday closes the field; an ejection ends the mayday');
    const ac = sim.aircraft;
    // Up high and clean, so the brace is on offer; declare it.
    ac.pos.y = Math.max(ac.pos.y, 900);
    sim.step(0.5);
    // Free Flight with nothing wrong asks twice ("Declare an emergency? Press it again to commit").
    sim.braceForImpact();
    sim.step(0.2);
    sim.braceForImpact();
    sim.step(0.5);
    ok('the mayday is declared (bracing)', sim.bracing === true, `bracing ${sim.bracing}`);
    sim.step(20);
    const st = T.trafficState ? T.trafficState() : null;
    const escorts = (sim.braceRescue || []).length;
    ok('twenty seconds in, two escorts are up with you', escorts === 2, `escorts ${escorts}`);
    ok('...and the field is closed to departures while the mayday is on (traffic: player.emergency)', !!(st && st.player && st.player.emergency === true), JSON.stringify(st && st.player));

    // Out of the aeroplane.
    const E = await import('../../src/features/eject.js');
    const before = said.length;
    let ejected = false;
    try {
      // ejectPilot(): the first call arms (crew out first), the second fires the seat.
      for (let i = 0; i < 3 && !(sim.walking && sim.walking.ejected); i++) {
        E.ejectPilot(sim);
        sim.step(0.4);
      }
      ejected = !!(sim.walking && sim.walking.ejected);
    } catch (e) {
      ejected = false;
    }
    ok('ejected (walking.ejected)', ejected && sim.walking && sim.walking.ejected, JSON.stringify(sim.walking));
    sim.step(1);
    ok('...the mayday sequence ends: no escorts left formating on an empty aeroplane', sim.bracing === false && (sim.braceRescue || []).length === 0, `bracing ${sim.bracing} escorts ${(sim.braceRescue || []).length}`);
    ok('...and the tower sees the parachute', said.slice(before).some((s) => /parachute/i.test(s)), said.slice(before).join(' | '));
    const y0 = ac.pos.y;
    sim.step(12);
    ok('the empty aeroplane comes down (does not float)', ac.pos.y < y0 - 30 || ac.crashed, `${y0.toFixed(0)} → ${ac.pos.y.toFixed(0)} m, crashed ${ac.crashed}`);
  } finally {
    if (speak) sim.speak = speak;
    sim.autoPauseOnHide = autoPause;
    try {
      sim.quitToMenu('main');
    } catch (e) {
      void e;
    }
  }
}
