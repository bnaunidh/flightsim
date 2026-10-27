/**
 * The Tom-ready QA pass (w16-tom) in the real game: the flight an A320
 * home-cockpit pilot on a Mac films, from Gateway International's gate.
 *
 *   - an A321neo asked to start at a gate on Gateway gets one (a parked
 *     traffic aeroplane in the way gives way), and the objective names P for
 *     the ground crew, not Y;
 *   - the radio call made as the flight starts is labelled GATEWAY GROUND;
 *   - parked into a breeze the speed word is "stopped";
 *   - the crew, the push, and after it the objective says to taxi;
 *   - on the roll, full brakes at idle stop it (it crept on at 2 m/s);
 *   - the coach names the A321's own lift-off speed, not the Skylark's 55;
 *   - the instant replay's bar has the bottom of the screen to itself.
 *
 *   node .claude/devtools/briefs/one-check.mjs <url> ./tests/features/tom-ready.browser.js check "" 1
 */

export const id = 'tom-ready';

export async function check(sim, r, say = () => {}) {
  const ok = (name, pass, detail = '') => r.ok(`tom-ready: ${name}`, !!pass, detail);
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const mapWas = sim.settings.map;
  try {
    say('tom-ready: Gateway, an A321 at the gate');
    if (sim.settings.map !== 'gateway') {
      sim.setMap('gateway');
      for (let i = 0; i < 100 && (sim._worldBuilding || sim.settings.map !== 'gateway'); i++) await new Promise((res) => setTimeout(res, 100));
      await new Promise((res) => setTimeout(res, 1500));
    }
    const said = [];
    const speak = sim.speak;
    const A = await import('../../src/audio/atc.js');
    sim.speak = function (text, voice, ...rest) {
      said.push({ text, label: A.voiceLabel(voice) });
      return speak.call(this, text, voice, ...rest);
    };
    try {
      await sim.startMode('free', { aircraft: 'a321', startAt: 'gate', time: 'day', condition: 'clear', windSpeedKts: 6, windDirDeg: 0 });
    } finally {
      sim.speak = speak;
    }
    const st = sim.spawns.state();
    ok('the A321 starts at a gate on Gateway, not on the runway', st.decided && st.decided.placed && st.decided.kind === 'stand', JSON.stringify({ decided: st.decided, madeRoom: st.madeRoom }));
    const obj = sim.hud.objectiveText.textContent;
    ok('the objective names P for the ground crew (Y is the autopilot)', /P calls the ground crew/.test(obj) && !/Y calls/.test(obj), obj);
    const call = said.find((s) => /Ground, you are on stand/.test(s.text));
    ok('the stand call goes out under GATEWAY GROUND', call && call.label === 'Gateway Ground', call ? `${call.label}: ${call.text}` : said.map((s) => s.label).join(', '));
    sim.step(1);
    const want = { easy: 'EASY MODE', normal: 'NORMAL MODE', realistic: 'REAL MODE' }[sim.settings.difficulty || 'normal'];
    ok('the HUD\'s mode chip names the difficulty chosen (Normal said EASY MODE)', sim.hud.modeChip.textContent === want, `${sim.settings.difficulty}: ${sim.hud.modeChip.textContent}`);
    ok('parked into a 6 kt breeze, the speed word is "stopped"', sim.hud.speedWord.textContent === 'stopped', sim.hud.speedWord.textContent);

    if (!sim.aircraft.engineOn) sim.tap('KeyI');
    for (let t = 0; t < 30 && !sim.aircraft.engineOn; t++) sim.step(1);
    sim.step(0.5);
    const coachAtGate = sim.hud.coach.style.display === 'none' ? '' : sim.hud.coach.textContent;
    ok('on the stand with the engines running, the coach does not say "full power"', sim.aircraft.engineOn && !/full power/i.test(coachAtGate), coachAtGate || '(no coach)');
    say('tom-ready: the crew and the push');
    const SV = (await import('../../src/features/airport-services.js')).__airportServices.S;
    sim.tap('KeyP');
    for (let t = 0; t < 120 && SV.state !== 'serviced'; t++) sim.step(1);
    sim.tap('KeyP');
    for (let t = 0; t < 200 && SV.state === 'pushback'; t++) sim.step(1);
    const after = sim.hud.objectiveText.textContent;
    ok('pushed back, and the objective says to taxi (not to call the crew again)', SV.state === 'pushed' && /taxi to runway/i.test(after) && !/ground crew/.test(after), `${SV.state}: ${after}`);

    say('tom-ready: brakes and the coach on the runway');
    await sim.startMode('free', { aircraft: 'a321', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    const ac = sim.aircraft;
    sim.step(0.5);
    ac.parkingBrake = false;
    ac.vel.set(0, 0, -12).applyQuaternion(ac.quat);
    sim.input.throttleTarget = 0;
    sim.key('Space', true);
    let stopped = null;
    for (let t = 0; t < 12; t += 0.5) {
      sim.step(0.5);
      if (stopped === null && ac.groundSpeed < 0.3) stopped = t;
    }
    sim.key('Space', false);
    ok('rolling at 12 m/s, idle, Space held: the A321 stops', stopped !== null && stopped < 8, `stopped after ${stopped} s, ${ac.groundSpeed.toFixed(2)} m/s`);
    ac.vel.set(0, 0, -15).applyQuaternion(ac.quat);
    sim.input.throttleTarget = 1;
    sim.step(1.2);
    const coach = (sim.hud.coach && sim.hud.coach.textContent) || '';
    ok('the coach names the A321\'s own lift-off speed, not 55', /lift off at 90 knots/.test(coach), coach);

    say('tom-ready: a crash and its replay');
    await sim.startMode('free', { aircraft: 'a321', airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0 });
    const B = await import('../../src/features/breakup.js');
    sim.override = { pitch: -1, roll: 0.3, yaw: 0 };
    for (let t = 0; t < 60 && !sim.aircraft.crashed; t += 0.25) sim.step(0.25);
    sim.override = null;
    clearTimeout(sim._crashDebriefT);
    sim.step(3);
    clearTimeout(sim._crashDebriefT);
    const started = B.startReplay(sim, false);
    sim.step(0.2);
    const sub = sim.hud.subtitle;
    const hidden = getComputedStyle(sub).visibility === 'hidden' && getComputedStyle(sim.hud.coach).visibility === 'hidden';
    ok('in the instant replay the radio subtitle and the coach step out from under its bar', started && document.documentElement.classList.contains('is-replaying') && hidden, `started ${started}, ${document.documentElement.className}`);
    B.endReplay(sim, false);
    ok('...and come back when it closes', !document.documentElement.classList.contains('is-replaying') && getComputedStyle(sub).visibility !== 'hidden');
  } catch (e) {
    ok('the check itself ran', false, String(e && (e.stack || e.message)).slice(0, 300));
  } finally {
    sim.override = null;
    sim.input.throttleTarget = 0;
    sim.autoPauseOnHide = autoPause;
    if (mapWas && mapWas !== 'gateway' && sim.setMap) {
      if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
      sim.setMap(mapWas);
    }
  }
}
