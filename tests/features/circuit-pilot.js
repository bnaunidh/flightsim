/**
 * A scripted pilot that flies one circuit — take-off, a left-hand pattern
 * round the field, a three-degree final and a landing to a stop on the same
 * runway — for any aeroplane on any map. The control law is the mission
 * pilot's (./mission-pilot.js): heading by bank, height by vertical speed,
 * speed by throttle; this adds the pattern and runs in node or the page.
 *
 *   const pilot = circuitPilot({ ac, runway, perf, gear, flaps, giant });
 *   while (!pilot.done) { Object.assign(controls, pilot.step(dt)); advance(dt); }
 *
 *   ac       the Aircraft (physics.js): pos, heading, ias, vs, agl, omega,
 *            bankAngleDeg(), onGround, groundSpeed, airborneTime, flapStep()
 *   runway   { x0, z0, headingDeg, length, elev }: the threshold the circuit
 *            starts and ends at (the 09 end), along `headingDeg`
 *   perf     performanceFor(id): stallClean / stallLanding in knots
 *   gear     (down) => void, flaps(step) => void: the page taps keys, node sets them
 *
 * It reads only what a player can see (where it is, how fast, how high) and
 * moves only the controls; it never touches the aeroplane's state. `phase`
 * and `log` say what it is doing, for the report.
 */
const KT = 1 / 1.94384;
const TAN3 = Math.tan((3 * Math.PI) / 180);

export function circuitPilot({ ac, runway, perf, gear = () => {}, flaps = () => {}, giant = false, heightAt = null }) {
  const h = (runway.headingDeg * Math.PI) / 180;
  const f = [Math.sin(h), -Math.cos(h)]; // along the runway
  const l = [-Math.cos(h), -Math.sin(h)]; // to its left
  const at = (a, c) => ({ x: runway.x0 + f[0] * a + l[0] * c, z: runway.z0 + f[1] * a + l[1] * c });
  const L = runway.length;
  const U = giant ? 1500 : 1000;
  const C = giant ? 2200 : 1600;
  const F = giant ? 4500 : 3500;
  const patternY = runway.elev + (giant ? 380 : 320);
  const vApp = Math.max(30, perf.stallLanding * KT * 1.3);
  const vRot = perf.stallLanding * KT * 1.25;
  const vCirc = Math.max(vApp * 1.3, perf.stallClean * KT * 1.35);
  const td = at(giant ? 320 : 200, 0);
  const legs = [
    { name: 'upwind', p: at(L + U, 0) },
    { name: 'crosswind', p: at(L + U, C) },
    { name: 'downwind', p: at(-F, C) },
    { name: 'base', p: at(-F, 0) },
  ];
  const S = { phase: 'roll', leg: 0, I: 0, Is: 0, Ix: 0, tookOff: false, touched: false, flare: false, t: 0, gearUp: false, log: [], out: { throttle: 1, pitch: 0, roll: 0, yaw: 0, brakes: 0 }, maxBank: 0, done: false, ok: false };
  const say = (s) => S.log.push(`${S.t.toFixed(0)}s ${s}`);
  const wrap = (d) => ((d + 540) % 360) - 180;
  const bearing = (p) => ((Math.atan2(p.x - ac.pos.x, -(p.z - ac.pos.z)) * 180) / Math.PI + 360) % 360;
  const ground = (x, z) => (heightAt ? Math.max(0, heightAt(x, z)) : runway.elev);

  /*
   * Once per frame. The page reads sim.override's fields more than once a
   * frame (the pitch getter calls this), so a second call while the
   * aeroplane has not moved returns the same controls rather than running
   * the integrators — and the clock — again.
   */
  let lastKey = null;
  function step(dt) {
    const key = `${ac.pos.x}|${ac.pos.y}|${ac.pos.z}|${ac.vel ? ac.vel.y : 0}`;
    if (key === lastKey) return S.out;
    lastKey = key;
    S.t += dt;
    const o = S.out;
    if (!S.tookOff && !ac.onGround && ac.airborneTime > 0.5) {
      S.tookOff = true;
      S.phase = 'climb';
      say(`airborne at ${(ac.ias / KT).toFixed(0)} kt`);
    }
    // Where along and across the runway the aeroplane is (from the threshold).
    const dx = ac.pos.x - runway.x0;
    const dz = ac.pos.z - runway.z0;
    const along = dx * f[0] + dz * f[1];
    const cross = dx * l[0] + dz * l[1]; // + left of the centreline

    let wantHdg = runway.headingDeg;
    let wantY = patternY;
    let ffVs = 0;
    let spd = vCirc;
    if (S.phase === 'roll' || S.phase === 'rollout') {
      wantHdg = runway.headingDeg + Math.max(-15, Math.min(15, cross * 0.6));
    } else if (S.phase === 'climb' || S.phase === 'pattern') {
      if (S.phase === 'climb' && ac.agl > 120) {
        S.phase = 'pattern';
        say('climbing out, into the pattern');
      }
      if (!S.gearUp && ac.agl > 30) {
        S.gearUp = true;
        gear(false);
      }
      if (S.phase === 'pattern' && ac.agl > 200 && ac.flapStep() > 1) flaps(1);
      const leg = legs[S.leg];
      if (S.phase === 'climb') wantHdg = runway.headingDeg + Math.max(-20, Math.min(20, cross * 0.05));
      else {
        wantHdg = bearing(leg.p);
        const d = Math.hypot(leg.p.x - ac.pos.x, leg.p.z - ac.pos.z);
        // Inside a turn's radius of the point it can only circle it: take the next leg.
        const radius = (ac.groundSpeed * ac.groundSpeed) / (9.81 * Math.tan((25 * Math.PI) / 180));
        if (d < Math.max(500, radius * 1.2 + 150)) {
          say(`${leg.name} done`);
          S.leg++;
          if (S.leg >= legs.length) {
            S.phase = 'final';
            say('on final');
          }
        }
      }
    } else if (S.phase === 'final' || S.phase === 'flare') {
      // Track the centreline (an integrator for the drift), down a three-degree path to the touchdown point.
      const toGo = (td.x - ac.pos.x) * f[0] + (td.z - ac.pos.z) * f[1];
      S.Ix = Math.max(-8, Math.min(8, S.Ix + cross * dt * 0.004));
      wantHdg = runway.headingDeg + Math.max(-30, Math.min(30, cross * (toGo < 3000 ? 0.12 : 0.05) + S.Ix));
      wantY = runway.elev + Math.max(0, toGo) * TAN3;
      ffVs = -ac.groundSpeed * TAN3;
      spd = vApp;
      if (!ac.gearDown) gear(true);
      if (toGo < 3500 && ac.flapStep() < 3) flaps(3);
      if (!S.flare && ac.pos.y - runway.elev < Math.max(10, -ac.vs * 3) + 0 && !ac.onGround) {
        S.flare = true;
        S.phase = 'flare';
        say(`flare at ${(ac.ias / KT).toFixed(0)} kt, ${toGo.toFixed(0)} m to the aiming point`);
      }
      if (ac.onGround && S.flare) {
        S.phase = 'rollout';
        S.touched = true;
        say(`touchdown at ${(ac.groundSpeed / KT).toFixed(0)} kt, ${along.toFixed(0)} m past the threshold`);
      }
    }

    const err = wrap(wantHdg - ac.heading);
    const lim = S.phase === 'final' && ac.agl < 150 ? 15 : S.phase === 'flare' ? 6 : 25;
    const wantBank = ac.onGround ? 0 : Math.max(-lim, Math.min(lim, err * 0.8));
    const bank = ac.bankAngleDeg();
    S.maxBank = Math.max(S.maxBank, Math.abs(bank));
    o.roll = Math.max(-0.7, Math.min(0.7, (wantBank - bank) * 0.055 - ac.omega.z * 0.55));
    let wantVs = Math.max(-8, Math.min(7, (wantY - ac.pos.y) * 0.08 + ffVs));
    if (S.phase === 'final' && ac.pos.y - runway.elev < 40) wantVs = Math.max(wantVs, -3.5);
    if (S.phase === 'flare') wantVs = ac.pos.y - runway.elev > 2.5 ? -1.4 : -0.7;
    if ((S.phase === 'climb' || S.phase === 'pattern') && ac.pos.y - ground(ac.pos.x, ac.pos.z) < 60) wantVs = Math.max(wantVs, 2.5);
    S.I = Math.max(-0.4, Math.min(0.5, S.I + (wantVs - ac.vs) * dt * 0.03));
    if (S.phase === 'roll') o.pitch = ac.ias > vRot ? 0.45 : 0;
    else if (ac.onGround) o.pitch = 0;
    else if (S.phase === 'climb') o.pitch = Math.max(-0.5, Math.min(0.6, (10 - ac.pitchAngleDeg()) * 0.05));
    else o.pitch = Math.max(-0.6, Math.min(0.75, S.I + (wantVs - ac.vs) * 0.12 - ac.omega.x * 0.6 + (Math.abs(bank) / 25) * 0.06));
    S.Is = Math.max(-0.4, Math.min(0.5, S.Is + (spd - ac.ias) * dt * 0.01));
    o.throttle = S.phase === 'roll' || S.phase === 'climb' ? 1
      : S.phase === 'rollout' ? 0
      : S.phase === 'flare' ? (ac.agl < 8 ? 0 : 0.2)
      : Math.max(0, Math.min(1, 0.45 + (spd - ac.ias) * 0.05 + S.Is + wantVs * 0.02));
    o.yaw = ac.onGround ? Math.max(-1, Math.min(1, err * 0.08)) : Math.max(-0.5, Math.min(0.5, (ac.beta || 0) * 1.6));
    o.brakes = S.phase === 'rollout' ? 1 : 0;
    if (S.phase === 'rollout' && ac.groundSpeed < 3 && !S.done) {
      S.done = true;
      S.ok = true;
      const dx2 = ac.pos.x - runway.x0;
      const dz2 = ac.pos.z - runway.z0;
      S.stopAlong = dx2 * f[0] + dz2 * f[1];
      S.stopCross = dx2 * l[0] + dz2 * l[1];
      say(`stopped ${S.stopAlong.toFixed(0)} m past the threshold, ${S.stopCross.toFixed(1)} m off the centreline`);
    }
    return o;
  }

  return {
    step,
    get phase() { return S.phase; },
    get done() { return S.done; },
    get ok() { return S.ok; },
    get log() { return S.log; },
    get state() { return S; },
    fail(why) {
      S.done = true;
      S.ok = false;
      say(why);
    },
  };
}
