/**
 * Browser check for the heading tape and "NOW ENTERING" (src/ui/ribbon.js,
 * src/features/livemap/where.js):
 *
 *   node .claude/devtools/briefs/one-check.mjs <url> ./tests/features/where.browser.js check "" 1
 *
 *   - a free flight has the tape at the top centre: the heading box reads the
 *     heading, ticks every 5 degrees, the nearest airport marked when you
 *     face it; a DIRECT TO waypoint is marked magenta, with its name
 *   - flying onto Mango Cay puts NOW ENTERING / Mango Cay under the tape, over
 *     the objective — tape, banner, objective stacked, none overlapping —
 *     and it goes again after a few seconds
 *   - in the Photo HUD nothing is announced (and the tape is hidden)
 * Free Flight and the HUD mode are put back afterwards.
 */

export const id = 'where';

export async function check(sim, r, say) {
  say && say('where: the heading tape and NOW ENTERING');
  let R;
  try {
    R = await import('../../src/ui/ribbon.js');
  } catch (err) {
    r.ok('where: the modules load', false, String(err && err.message));
    return;
  }
  const wasAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const density = sim.hud.density;
  const run = (s) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) sim.step(1 / 60);
  };
  const q = (s) => document.querySelector(s);
  const shown = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const face = (deg) => {
    const ac = sim.aircraft;
    // Heading deg: yaw about +y, clockwise from north (-z).
    ac.quat.setFromAxisAngle({ x: 0, y: 1, z: 0 }, (-deg * Math.PI) / 180);
    if (ac.vel) {
      const v = Math.max(50, ac.vel.length());
      ac.vel.set(Math.sin((deg * Math.PI) / 180) * v, 0, -Math.cos((deg * Math.PI) / 180) * v);
    }
  };
  try {
    if (sim.hud.setDensity) sim.hud.setDensity('clean');
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
    if (sim.state === 'paused') sim.resume();
    run(0.5);
    const ac = sim.aircraft;
    const tape = q('#ui .hud-top .hud-dest');
    const box = tape && tape.querySelector('.hud-dest-hdg');
    const hdg = ac.readouts().heading;
    r.ok('where: a free flight has the heading tape at the top centre, the box reading the heading, a tick every 5°',
      shown(tape) && box && box.textContent === R.headingText(hdg) && tape.querySelectorAll('.hud-dest-tick').length >= 140 && !sim.hud.dest.hasTarget,
      `box "${box && box.textContent}" heading ${hdg.toFixed(1)}, ${tape ? tape.querySelectorAll('.hud-dest-tick').length : 0} ticks`);
    // Face the field: its marker is on the tape.
    const field = sim.liveMap.places().airports[0];
    const brg = ((Math.atan2(field.x - ac.pos.x, -(field.z - ac.pos.z)) * 180) / Math.PI + 360) % 360;
    face(brg);
    run(0.6);
    const apt = tape.querySelector('.hud-dest-sym.is-apt');
    r.ok('where: facing the nearest airport, its marker is on the tape, near the middle', shown(apt) && Math.abs(new DOMMatrix(getComputedStyle(apt).transform).m41) < 25,
      `marker ${shown(apt)} at ${apt && getComputedStyle(apt).transform}`);
    // A DIRECT TO: the target marker, magenta, and its name.
    const wp = { id: 'pin:t', name: 'PIN', kind: 'pin', x: ac.pos.x + 4000, z: ac.pos.z - 4000 };
    sim.liveMap.directTo(wp);
    run(0.3);
    const mark = tape.querySelector('.hud-dest-mark:not(.is-final)');
    const txt = tape.querySelector('.hud-dest-text').textContent;
    r.ok('where: a DIRECT TO waypoint is marked on the tape in magenta (NAV), with its name and distance', shown(mark) && mark.classList.contains('is-nav') && /PIN/.test(txt) && /km/.test(txt),
      `"${txt}" nav ${mark && mark.classList.contains('is-nav')}`);
    sim.liveMap.clearRoute();
    if (sim.autopilot.engaged) sim.toggleAutopilot(false);

    /* ---- NOW ENTERING ---- */
    const mango = sim.liveMap.places().islands.find((i) => /Mango/.test(i.name)) || sim.liveMap.places().islands[1];
    // Out to sea first (off every island), then onto it.
    ac.pos.set(mango.x - mango.r * 2.5, Math.max(ac.pos.y, 600), mango.z);
    face(90);
    run(1);
    ac.pos.set(mango.x - mango.r * 0.5, Math.max(ac.pos.y, 600), mango.z);
    run(3);
    // The banner opens with a half-second ease (CSS, on the wall clock).
    await new Promise((res) => setTimeout(res, 800));
    const ban = q('#ui .hud-top .loc-banner');
    const obj = q('#ui .hud-objective');
    const tb = tape.getBoundingClientRect();
    const bb = ban && ban.getBoundingClientRect();
    const ob = obj && obj.getBoundingClientRect();
    const said = sim.location.shown();
    r.ok(`where: flying onto ${mango.name}: NOW ENTERING / ${mango.name} under the tape, over the objective, none overlapping`,
      ban && ban.classList.contains('is-on') && /NOW ENTERING/.test(ban.textContent) && ban.textContent.includes(mango.name) && tb.bottom <= bb.top + 1 && (!shown(obj) || bb.bottom <= ob.top + 1),
      `"${ban && ban.textContent}" tape ${Math.round(tb.top)}-${Math.round(tb.bottom)}, banner ${bb && `${Math.round(bb.top)}-${Math.round(bb.bottom)}`}, objective top ${ob && Math.round(ob.top)}; shown ${JSON.stringify(said.map((s) => s.name))}`);
    run(6);
    r.ok('where: it goes again after a few seconds', ban && !ban.classList.contains('is-on'), ban && ban.className);

    /* ---- the Photo HUD ---- */
    if (sim.hud.setDensity) sim.hud.setDensity('photo');
    sim.location.watch().lastShown.clear();
    ac.pos.set(mango.x - mango.r * 2.5, Math.max(ac.pos.y, 600), mango.z);
    run(1);
    const before = sim.location.shown().length;
    ac.pos.set(mango.x - mango.r * 0.5, Math.max(ac.pos.y, 600), mango.z);
    run(3);
    r.ok('where: in the Photo HUD nothing is announced, and the tape is hidden', sim.location.shown().length === before && !shown(tape) && !(ban && shown(ban) && ban.classList.contains('is-on')),
      `announced ${sim.location.shown().length - before}, tape shown ${shown(tape)}`);
  } catch (err) {
    r.ok('where: the check ran to the end', false, String((err && err.stack) || err).slice(0, 400));
  } finally {
    if (sim.hud.setDensity) sim.hud.setDensity(density || 'clean');
    sim.autoPauseOnHide = wasAutoPause;
  }
}
