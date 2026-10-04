/**
 * The pilot bot for Air Force One: plays either mission, from either seat,
 * to a pass or — deliberately — to a fail, on the real game.
 *
 *   const { playthrough } = await import('./tests/features/afo.playthrough.js');
 *   const out = await playthrough(sim, 'afo-normal', 'captain');
 *   const out2 = await playthrough(sim, 'afo-attack', 'escort', { fail: true });
 *
 * Model: tests/features/events.playthrough.js. It is simpler than that bot
 * because these two missions ask less of a pilot — no cards, no ICAO wing
 * rock, no interphone — so ONE generic controller flies every step of both
 * seats of both missions: it reads sim.runner.activeTarget() (the same
 * point the on-screen arrow points at — including its own look-ahead to the
 * next step while the current one names nowhere, e.g. "take off") and steers
 * heading, height and speed at it; a step named 'land' switches it onto a
 * three-degree glide to the runway; a step named 'taxi' switches it to a
 * walking-pace taxi at the target. It never calls a story's own functions —
 * it reads sim.runner, castActor() and afoInfo(), the same things a step's
 * own check() reads, and presses real keys (sim.key / sim.tap) for the gun
 * and the flares.
 *
 * `opts.fail`, per mission x seat, is the ONE thing this file decides is
 * worth two different flights rather than one:
 *   - afo-normal / captain:  fail = dive into the sea on departure (the
 *     generic crash path every mission already fails on).
 *   - afo-normal / escort:   fail = the same dive, once the fighter is up
 *     (its "crowd the airliner" chase never closed inside any cap; the
 *     too-close failIf itself is proved by placement in afo.browser.js).
 *   - afo-attack / captain:  fail = never touch the flares. The escort's
 *     gun stops some missiles, but never the wave's first two, head-on.
 *   - afo-attack / escort:   fail = never fire the gun. The NPC captain's own
 *     four flares run out and the drones keep coming.
 *
 * @returns {Promise<{ ok, status, seconds, score, log, shots }>}
 */
export async function playthrough(sim, missionId, roleId, { fail = false, shots = false, maxSeconds } = {}) {
  const THREE = await import('../../src/vendor/three.module.js');
  const AfoFeat = await import('../../src/features/events/afo.js');
  const Cast = await import('../../src/game/roles/cast.js');
  const { RUNWAY } = await import('../../src/world/airport.js');
  const PH = await import('../../src/aircraft/physics.js');
  const { heightAt } = await import('../../src/world/terrain.js');

  const ac = sim.aircraft;
  // The flare is judged on the wheels, not the middle (events.playthrough.js's
  // own gearDrop(), same reasoning, same number for the 747: judged on the
  // middle it flared late enough to arrive at over 900 ft a minute — a crash).
  const gearDrop = () => {
    const pts = PH.SPEC && PH.SPEC.gearPoints;
    return pts && pts.length ? Math.max(0.5, -pts.reduce((m, g) => Math.min(m, g.pos.y), 0)) : 2;
  };
  const realRender = sim.renderer.render.bind(sim.renderer);
  sim.renderer.render = () => {};
  const pics = [];
  const taken = new Set();
  const log = [];
  let T = 0;
  const say = (s) => log.push(`${T.toFixed(0)}s ${s}`);
  const shot = (name) => {
    if (!shots || taken.has(name)) return;
    taken.add(name);
    realRender(sim.scene, sim.camera);
    pics.push({ name, url: sim.renderer.domElement.toDataURL('image/jpeg', 0.75) });
  };

  const isCaptain = roleId === 'captain';
  // The escort seats wait on Air Force One's own schedule before their own
  // landing even starts (measured, tests/features/afo-lead.mjs): normal,
  // he reaches 'final' — 'peel' — at ≈ 324 s and stops at ≈ 467 s, and you
  // land right behind him; attack, 'final' comes ≈ 175-250 s after the
  // drones are down (≈ 378 s if that takes until 130 s).
  const defaultMax = missionId === 'afo-normal' ? (isCaptain ? 700 : 560) : (isCaptain ? 520 : 600);
  const cap = maxSeconds || (fail ? Math.min(defaultMax, 170) : defaultMax);

  /* ---- the controller: generic heading/height/speed, taxi, and a glide-slope landing ---- */
  const TAN3 = Math.tan((3 * Math.PI) / 180);
  const B = { hdg: ac.heading, alt: ac.pos.y, spd: 75, glide: false, flare: false, diving: false, tookOff: false, L: 90, td: new THREE.Vector3(), taxi: null, I: 0, Is: 0, out: {} };
  const compute = () => {
    const dt = 1 / 30;
    const o = B.out;
    // Once airborne, for good: tells the ground logic below "rolling for
    // take-off" (full power, wheels down, rotate near flying speed) from
    // "down again" (brakes, stop) — onGround alone cannot tell those apart,
    // and a mission that starts ON the runway (afo-normal, either seat) sees
    // both in one flight, unlike the hijacks this controller was modelled on.
    if (ac.airborneTime > 0.3) B.tookOff = true;
    const rolling = ac.onGround && !B.tookOff;
    let wantHdg = B.hdg;
    let wantY = B.alt;
    let ffVs = 0;
    if (rolling) {
      // Track the runway centreline, not the eventual cruise point — real
      // rudder authority on the roll, not a hard turn at flying speed.
      wantHdg = B.hdg;
    } else if (B.taxi && ac.onGround) {
      wantHdg = ((Math.atan2(B.taxi.x - ac.pos.x, -(B.taxi.z - ac.pos.z)) * 180) / Math.PI + 360) % 360;
    } else if (B.glide) {
      const L = (B.L * Math.PI) / 180;
      const cross = (ac.pos.x - B.td.x) * Math.cos(L) + (ac.pos.z - B.td.z) * Math.sin(L);
      const along = (B.td.x - ac.pos.x) * Math.sin(L) - (B.td.z - ac.pos.z) * Math.cos(L);
      /*
       * The precise localiser law below only makes sense once the aircraft
       * is genuinely on the approach side of the field (`along` positive —
       * remaining distance to the threshold, measured along the RUNWAY's
       * own heading) and roughly on the extended centreline. afo-normal's
       * own cruise leg ends on the departure heading, thousands of metres
       * out on the WRONG side (`along` strongly negative) until "turn back
       * towards the field" has actually happened — engaging this law there
       * reads a negative `along`, and `Math.max(0, along)` collapsed
       * straight to the runway's ground-level y: the dive this bot flew
       * into the sea with. Until `along` says the aircraft is honestly on
       * final, fall back to the same plain pursuit of the point every other
       * step already uses, with a 3-degree slope on the DIRECT distance —
       * always sensible, never negative — standing in for the localiser's
       * own slope. (afo-attack's return leg starts already on the right
       * side, `along` positive from the first frame, so it gets the precise
       * law immediately — this is not a loss of precision there.)
       */
      /*
       * ...and only from the approach end. Coming back from the cruise point
       * the field lies BETWEEN you and that end (afo-normal's cruise leg is
       * out on the departure side), and Gateway's 3.8 km runway put the bot
       * over it, westbound, low, before the localiser law asked for a
       * 180-degree turn onto final at 130 m — "You came down far too fast".
       * So from the wrong side it flies out to a fix 8 km out on the extended
       * centre line first, at the slope's own height there, and turns in
       * from there — a real circuit, the way the escort NPC lands too.
       */
      const aligned = Math.abs(((ac.heading - B.L + 540) % 360) - 180) < 40;
      // Far too high to make it from here (Ironhead's "home" leg arrives
      // 800 m above a field at 300 m): go round, out to the fix and back.
      if (B.onFinal && along < 3000 && ac.pos.y - (B.td.y + Math.max(0, along) * TAN3) > 150) {
        B.onFinal = false;
        B.fix = null;
        say('going around');
      }
      if (along > 300 && Math.abs(cross) < 3000 && (B.onFinal || ((aligned || along > 8000) && ac.pos.y - (B.td.y + along * TAN3) < 150))) B.onFinal = true;
      else if (!B.onFinal) {
        const fx = B.td.x - Math.sin(L) * 8500;
        const fz = B.td.z + Math.cos(L) * 8500;
        B.fix = B.fix || { x: fx, z: fz };
      }
      if (B.onFinal) {
        B.Ix = Math.max(-8, Math.min(8, (B.Ix || 0) + cross * dt * 0.004));
        wantHdg = B.L - Math.max(-30, Math.min(30, cross * (along < 3000 ? 0.12 : 0.05) + B.Ix));
        wantY = B.td.y + along * TAN3;
        ffVs = -ac.groundSpeed * TAN3;
        // Ironhead's 09 has a ridge 1.2-1.7 km short of the touchdown that
        // comes within 12 m of the three-degree slope: a jumbo exactly on it
        // with a few degrees of bank put a wingtip into it. Over high ground,
        // fly the slope a little high.
        if (along > 600) {
          let hi = -Infinity;
          for (let k = 0; k <= 1500; k += 150) hi = Math.max(hi, heightAt(ac.pos.x + Math.sin(L) * k, ac.pos.z - Math.cos(L) * k));
          wantY = Math.max(wantY, hi + 40);
        }
      } else if (B.fix) {
        wantHdg = ((Math.atan2(B.fix.x - ac.pos.x, -(B.fix.z - ac.pos.z)) * 180) / Math.PI + 360) % 360;
        wantY = B.td.y + 8500 * TAN3;
      } else if (B.target) {
        wantHdg = ((Math.atan2(B.target.x - ac.pos.x, -(B.target.z - ac.pos.z)) * 180) / Math.PI + 360) % 360;
        wantY = B.td.y + Math.hypot(ac.pos.x - B.target.x, ac.pos.z - B.target.z) * TAN3;
      }
    } else if (B.flare && ac.onGround && B.tookOff) {
      // Down: straight along the runway while it slows, never round towards
      // the touchdown marker it has just rolled past (the escort did that at
      // 40 knots and taxied into Gateway's terminal).
      wantHdg = B.L;
    } else if (B.target) {
      wantHdg = ((Math.atan2(B.target.x - ac.pos.x, -(B.target.z - ac.pos.z)) * 180) / Math.PI + 360) % 360;
    }
    const err = ((wantHdg - ac.heading + 540) % 360) - 180;
    /*
     * The distance-based slope above does not know it is also mid-turn: a
     * wingtip strike happened three times running (216 s, 184 s, 182 s)
     * each time near the same point in afo-normal's own big loop back
     * towards the field, each a fresh bank-limit tweak later — because none
     * of them touched the real cause, which is altitude, not bank. Asking
     * for both a big heading correction AND a low, close-in altitude at the
     * same time is what let a transient bank happen low enough to matter;
     * capping how low that slope may ask while still well off heading
     * means it is not banked AND low at once in the first place, which the
     * bank-limit ramp and the wingtip margin override below, both reactive,
     * were trying to catch after the fact instead.
     */
    if (B.glide && Math.abs(err) > 45) wantY = Math.max(wantY, 200);
    // Ramped down to near wings-level close to the ground, not a flat 15
    // degrees — afo-normal's own final is flown by plain pursuit of a fixed
    // point the whole way in (see the B.glide branch above), which keeps
    // asking for a correction right down to the flare. Below 150 m it
    // decays in a straight line to 3 degrees at 0 m AGL; a touchdown a
    // little off the centreline is fine — the step's own check only asks
    // for onGround, slow, for a couple of seconds — a wingtip strike is not.
    const lim = ac.agl < 150 ? Math.max(3, (ac.agl / 150) * 22 + 3) : 25;
    let wantBank = ac.onGround ? 0 : Math.max(-lim, Math.min(lim, err * 0.8));
    const bank = ac.bankAngleDeg();
    /*
     * The ramp above lowers the COMMANDED limit, but roll only follows it at
     * a damped rate (the o.roll law just below) — a bank built up well above
     * 150 m AGL (unrestricted there) does not unwind instantly the moment
     * the ramp starts to bite, and a 747 that enters that last 150 m still
     * banked rolled the rest of the way out too slowly: a wingtip (half the
     * 64 m span out, dropping by span/2 * sin(bank) under the fuselage)
     * touched down before the gear did, at both 216 s and, after the ramp
     * above, again at 184 s. This is the actual safety net: it reads the
     * REAL current bank, not the commanded one, and once the wingtip's own
     * estimated clearance gets tight, it overrides wantBank straight
     * towards zero regardless of where the heading law wants to go —
     * arriving late and off the centreline beats arriving sideways.
     */
    if (!ac.onGround) {
      const wingMargin = ac.agl - 35 * Math.sin((Math.abs(bank) * Math.PI) / 180);
      if (wingMargin < 15) wantBank *= Math.max(0, wingMargin / 15);
    }
    o.roll = Math.max(-0.7, Math.min(0.7, (wantBank - bank) * 0.055 - ac.omega.z * 0.55));
    // A 6 m/s climb cap suits the 747 captain seat; the escort's own fighter
    // can climb far faster, and capped the same it took over 200 s just to
    // reach the leader's 1250 m wing slot — long past the leader's own
    // scripted turn at 65 s and the start of his landing approach at 125 s
    // (afo-lead.js), so "hold station" meant chasing him already partway
    // through a landing vector pattern rather than a steady cruise.
    const vsMax = isCaptain ? 6 : 25;
    let wantVs = Math.max(-9, Math.min(vsMax, (wantY - ac.pos.y) * 0.08 + ffVs));
    if (B.glide && ac.pos.y - gearDrop() - B.td.y < 40) wantVs = Math.max(wantVs, -3.5);
    if (B.flare) wantVs = ac.pos.y - gearDrop() - B.td.y > 2 ? -1.6 : -0.8;
    // Ground-shy by default — except the deliberate dive-into-the-sea fail
    // path (afo-normal/captain's own fail proof, below), which needs this
    // bot to do the one thing it otherwise refuses to.
    if (ac.agl < 60 && !B.glide && !B.diving && !ac.onGround) wantVs = Math.max(wantVs, 2);
    // Wheels down until flying speed, then rotate (`rolling`, above) — the
    // self-test's own take-off recipe (tests/selftest.js), not the
    // glide/cruise pitch law, which would hold the nose level at zero knots
    // forever. The integral must not wind up DURING the roll, either: pitch
    // ignores B.I entirely until airborne (the `rolling` ternary just
    // below), but wantVs - vs (0 on the ground) kept accumulating into it
    // regardless — harmless at the old 6 m/s climb cap, but raising the
    // escort's to 25 (see vsMax above) let it saturate before rotation ever
    // started, and the moment `rolling` turned false the full climb demand
    // landed on the tail as a slammed-in nose-up: a tail strike at 10 s,
    // before the escort even finished lifting off.
    if (!rolling) B.I = Math.max(-0.4, Math.min(0.5, B.I + (wantVs - ac.vs) * dt * 0.03));
    // The escort's fighter takes off the way its own hint says (afo-lead.js
    // sets take-off flap): hands off the stick until it is well clear of the
    // runway — any real pull on the roll strikes its tail, and a nudge as the
    // wheels lift can set it back down at 145 knots, which the game counts
    // as a landing far too fast. The 747 captain rotates as before.
    const handsOff = !isCaptain && (rolling || ac.agl < 6);
    /*
     * The 747 is flown on its ATTITUDE: a pitch angle asked of the vertical
     * speed error, then the elevator on the pitch error, damped. The plain
     * vertical-speed law below (the escort's) porpoised the jumbo on final
     * with the gear and the flaps out — nose -12 to +7 degrees every four
     * seconds, ±9 m/s — until a trough met the ground: "You came down far
     * too fast" on Gateway's approach. A big jet is held on attitude, not
     * chased with the stick.
     */
    let capPitch = 0;
    if (isCaptain && !rolling && !ac.onGround) {
      B.Ip = Math.max(-4, Math.min(8, (B.Ip ?? 2) + (wantVs - ac.vs) * dt * 0.25));
      const wantPitch = Math.max(-8, Math.min(14, B.Ip + (wantVs - ac.vs) * 0.9));
      capPitch = Math.max(-0.6, Math.min(0.75, (wantPitch - ac.pitchAngleDeg()) * 0.07 - ac.omega.x * 2.2 + (Math.abs(bank) / 25) * 0.06));
    }
    o.pitch = handsOff ? 0
      : rolling ? (ac.ias > B.spd * 0.72 ? 0.5 : 0)
      : ac.onGround ? 0
      : isCaptain ? capPitch
      : Math.max(-0.6, Math.min(0.75, B.I + (wantVs - ac.vs) * 0.12 - ac.omega.x * 0.6 + (Math.abs(bank) / 25) * 0.06));
    B.Is = Math.max(-0.4, Math.min(0.5, B.Is + (B.spd - ac.ias) * dt * 0.01));
    o.throttle = (B.flare && ac.agl < 8) ? 0
      : rolling ? 1
      : ac.onGround ? 0
      : Math.max(0, Math.min(1, 0.45 + (B.spd - ac.ias) * 0.05 + B.Is + wantVs * 0.02));
    o.yaw = ac.onGround ? Math.max(-1, Math.min(1, err * 0.08)) : Math.max(-0.5, Math.min(0.5, (ac.beta || 0) * 1.6));
    o.brakes = rolling ? 0 : ac.onGround && ac.groundTime > 1 ? 1 : 0;
    if (B.taxi && ac.onGround) {
      const d = Math.hypot(B.taxi.x - ac.pos.x, B.taxi.z - ac.pos.z);
      // Stop inside the step's own 60 m: a 747 driven nose-first right onto a
      // stand that faces the terminal puts its nose and a wingtip into the
      // building before its middle gets there (Gateway, v55).
      const want = d < 55 ? 0 : Math.abs(err) > 40 ? 3 : 8;
      o.throttle = want === 0 ? 0 : Math.max(0, Math.min(0.5, 0.1 + (want - ac.groundSpeed) * 0.08));
      o.brakes = want === 0 || ac.groundSpeed > want + 1 ? 1 : 0;
      o.yaw = Math.max(-1, Math.min(1, err * 0.05));
    }
  };
  const CTRL = {};
  Object.defineProperty(CTRL, 'pitch', { enumerable: true, get() { compute(); return B.out.pitch; } });
  for (const k of ['roll', 'yaw', 'throttle', 'brakes']) Object.defineProperty(CTRL, k, { enumerable: true, get() { return B.out[k]; } });
  sim.override = CTRL;

  const fireCode = (sim.input.bindings.afoFire || [])[0] || 'Digit3';
  const flareCode = (sim.input.bindings.afoFlare || [])[0] || 'Digit4';
  let firing = false;
  let flareCd = 0;
  let flareUp = null;
  let evadeT = 0;

  try {
    await sim.startMode('mission', { id: missionId, role: roleId });
    say(`start ${sim.aircraftType.id} ${missionId}/${roleId} at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)}`);
    B.hdg = ac.heading;
    B.alt = ac.pos.y;
    B.spd = isCaptain ? 75 : 95;

    // Deliberate dive, afo-normal captain's own fail path: nothing else on
    // this mission can fail it, so a real crash is the honest proof.
    // The escort's seat too: its own "crowd him" fail (the chase below) never
    // closed inside any cap — it only ever "failed" because the take-off
    // struck the tail at 10 s — and afo.browser.js proves the too-close rule
    // by placement; so the escort proves its fail path the same way.
    let diveArmed = fail && missionId === 'afo-normal';

    let lastStepId = null;
    while (T < cap) {
      sim.step(0.25, 1 / 30);
      T += 0.25;
      if (flareUp != null && T >= flareUp) {
        sim.key(flareCode, false);
        flareUp = null;
      }
      const step = sim.runner.step;
      const stepId = step ? step.id : null;
      if (stepId !== lastStepId) {
        say(`step ${stepId} (${sim.runner.status}) at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} ias ${ac.ias.toFixed(0)}`);
        lastStepId = stepId;
        shot(`${missionId}-${roleId}-${fail ? 'fail' : 'pass'}-${stepId}`);
      }
      if (ac.crashed) { say(`CRASHED: ${ac.crashReason}`); break; }
      if (sim.runner.status !== 'running') { say(`mission ${sim.runner.status}`); break; }

      // Where to steer: the same point the on-screen arrow points at,
      // including the runner's own look-ahead while the current step names
      // nowhere ("take off", "evade").
      const at = sim.runner.activeTarget();
      B.target = at ? at.pos : null;
      /*
       * Only a step that names the runway AS ITS OWN target ('approach',
       * 'land', 'home') means "heading down now" — not one the runner's own
       * look-ahead merely echoes it onto because the CURRENT step names
       * nowhere. afo-attack's 'evade' has no target of its own, so this
       * used to read isRunwayTarget true there too (look-ahead to 'home')
       * and started the captain descending, throttled back to approach
       * speed and gear down, over open water, miles from any missile —
       * directly inside the evasive phase the mission's own brief says
       * should stay level ("Keep the wings level") until Guardian has it
       * clear. `stepHasOwnTarget` is that half of the fix, below — but
       * 'depart'/'scramble' ALSO have no target of their own, and their
       * look-ahead (to 'cruise'/'join') is not a false echo: it is the only
       * altitude telling either of them to climb at all, the first version
       * of this fix froze B.alt on EVERY no-target step and the escort
       * circled at 25 m AGL for the full 420 s cap, 'scramble' never seeing
       * agl > 100. `rawIsRunway` below is the narrower, correct test: only
       * a look-ahead that happens to land on the RUNWAY while this step
       * owns no target of its own is left alone; anything else looked-ahead
       * still updates B.alt exactly as it always did.
       */
      const stepHasOwnTarget = !!(step && typeof step.target === 'function');
      // The runway threshold itself, however the step named it. Snapping
      // the cruise altitude straight down to its ground-level y here
      // commanded an immediate dive for the ground; a 3-degree slope on the
      // DIRECT distance to it instead is always sensible (large and high
      // far out, low close in), whatever the aircraft's heading. compute()'s
      // own B.glide branch refines this to the precise runway-aligned slope
      // once `along` says the aircraft is honestly on the approach side —
      // see the comment there for why afo-normal's own "turn back towards
      // the field" cannot assume that from the first frame, the way
      // afo-attack's already-aligned return leg can.
      const rawIsRunway = !!(B.target && Math.abs(B.target.x - RUNWAY.touchdown.x) < 1 && Math.abs(B.target.z - RUNWAY.touchdown.z) < 1);
      const isRunwayTarget = stepHasOwnTarget && rawIsRunway;
      if (B.target && !B.taxi) {
        if (isRunwayTarget) {
          B.alt = RUNWAY.touchdown.y + Math.hypot(ac.pos.x - B.target.x, ac.pos.z - B.target.z) * TAN3;
        } else if (!rawIsRunway) {
          // Any OTHER target, own or looked-ahead — a cruise waypoint, a
          // wing slot — is exactly what climbing out of 'depart'/'scramble'
          // (neither names a target of its own) to the right altitude
          // needs: the look-ahead to 'cruise'/'join' is how those steps'
          // check() ever sees agl > 100 at all. Only the one case above
          // (rawIsRunway but not this step's own target) is left alone.
          B.alt = B.target.y;
        }
      }

      if (diveArmed && ac.airborneTime > 6) {
        diveArmed = false;
        say('diving into the sea on purpose (fail path)');
      }
      if (fail && missionId === 'afo-normal' && ac.airborneTime > (isCaptain ? 6 : 12)) {
        B.target = null;
        B.alt = -200; // well under the sea: the controller dives for it and never pulls up.
        B.spd = 90;
        B.diving = true; // overrides this bot's own ground-shy safety climb — see compute().
      }

      // afo-normal / escort fail: close on the airliner itself, not its slot.
      let escortFailClose = false;
      if (fail && missionId === 'afo-normal' && !isCaptain && stepId === 'hold') {
        const air = Cast.castActor('airliner');
        if (air) { B.target = air.pos; escortFailClose = true; }
      }

      // Hold station on a MOVING slot: aim a little ahead of it along the
      // leader's own track and match his speed, the way the game's own
      // NpcFlyer._followTargets() does it (src/game/roles/npc-flyer.js) — a
      // bare point-chase settles into an orbit around a moving target
      // instead of holding station on it, which is why "hold" never
      // satisfied its own 55%-in-the-box check. Only once already joined:
      // 'join' itself is closing a long way from a standing start (a
      // scramble from the ground) and wants full speed, not matched to the
      // leader's cruise +/- 12 — capping it there during 'join' too (an
      // earlier version of this fix did) turned a catch-up that should take
      // well under a minute into one that still had not closed by 220s. Not
      // for the deliberate fail above either, which wants the raw, unled
      // chase onto the airliner itself.
      if (!escortFailClose && stepId === 'hold' && B.target) {
        const air = Cast.castActor('airliner');
        if (air) {
          const lh = ((Number.isFinite(air.heading) ? air.heading : ac.heading) * Math.PI) / 180;
          // Modest relative to the slot's own 30 m "back" offset (afo-lead.js's
          // wingSlot()) — large enough to settle on the point instead of
          // orbiting it, not so large it aims the escort past the leader himself.
          const lookahead = 60;
          const aimX = B.target.x + Math.sin(lh) * lookahead;
          const aimZ = B.target.z - Math.cos(lh) * lookahead;
          B.hdg = ((Math.atan2(aimX - ac.pos.x, -(aimZ - ac.pos.z)) * 180) / Math.PI + 360) % 360;
          const h = (ac.heading * Math.PI) / 180;
          const along = (B.target.x - ac.pos.x) * Math.sin(h) - (B.target.z - ac.pos.z) * Math.cos(h);
          const lsp = air.vel ? Math.hypot(air.vel.x, air.vel.z) : air.speed || B.spd;
          B.spd = Math.max(50, Math.min(160, lsp + Math.max(-12, Math.min(12, along * 0.06))));
          B.target = null; // steer by B.hdg above, not a direct bearing to the raw (unled) slot.
        }
      }

      // Landing switch: on for as long as the target is the runway itself —
      // compute()'s own B.glide branch decides, every frame, whether that
      // means the precise runway-aligned slope or the same safe
      // direct-distance one computed above (see the comments on both). No
      // one-time gate here any more: there is no distance or heading that
      // makes engaging either of those two unsafe.
      const wasGliding = B.glide;
      B.glide = isRunwayTarget && !ac.onGround;
      if (B.glide && !wasGliding) {
        // The field's actual runway heading, not whatever heading the
        // aircraft happens to be on at this instant — both AFO missions
        // always land at the one home field (map: 'kestrel').
        B.L = RUNWAY.headingDeg ?? 90;
        B.td.copy(at.pos);
        say(`landing switch armed, ${Math.hypot(ac.pos.x - B.td.x, ac.pos.z - B.td.z).toFixed(0)} m out`);
      }
      if (B.glide) {
        B.spd = 65;
        // Configure for landing only once close enough that doing so this
        // early would not just be a very long, very slow final: matches
        // events.playthrough.js's own thresholds.
        const dTd = Math.hypot(ac.pos.x - B.td.x, ac.pos.z - B.td.z);
        if (dTd < 7000 && !ac.gearDown) sim.tap('KeyG');
        if (dTd < 6000 && ac.flapStep && ac.flapStep() < 2) ac.setFlaps(ac.flapStep() + 1);
        if (!B.flare && ac.pos.y - gearDrop() - B.td.y < Math.max(10, -ac.vs * 3.5) && !ac.onGround) { B.flare = true; say('flare'); }
      }
      if (stepId === 'taxi') {
        B.taxi = at ? at.pos : null;
      } else {
        B.taxi = null;
      }

      // The attack mission's own tools. afoInfo() is the CAPTAIN-seat
      // feature's own state — always zero from the escort seat, where the
      // drones are read back through castInfo() instead (afo-lead.js's own
      // steps do exactly this split; see afo.browser.js for the same rule).
      if (missionId === 'afo-attack') {
        if (isCaptain) {
          const info = AfoFeat.afoInfo();
          // A little weave while evading, purely cosmetic — the flares are
          // the real defence (see this file's header).
          if (stepId === 'evade') {
            evadeT += 0.25;
            if (!B.glide) B.hdg = ac.heading + Math.sin(evadeT * 0.3) * 20;
          }
          flareCd = Math.max(0, flareCd - 0.25);
          // Flares when the missile is CLOSE (the game's own "MISSILE CLOSE"
          // call, inside 1.1 km): dropped at the launch they burn out first.
          if (!fail && info.missilesInbound > 0 && info.nearestMissile != null && info.nearestMissile < 1000 && flareCd <= 0) {
            // Held for a moment, the way a finger presses it: afo.js reads the
            // flare key as held-this-frame, and sim.tap() goes down and up
            // inside one step — every "flare" this bot ever dropped was none.
            sim.key(flareCode, true);
            flareUp = T + 0.2;
            flareCd = 2;
            say('flare');
          }
          if (info.failWhy) shot(`${missionId}-${roleId}-${fail ? 'fail' : 'pass'}-missile-hit`);
        } else {
          const info = Cast.castInfo();
          const wantFire = !fail && (stepId === 'join' || stepId === 'warning' || stepId === 'defend') && info.dronesAlive > 0;
          if (wantFire !== firing) { sim.key(fireCode, wantFire); firing = wantFire; }
        }
      }

      if (T % 20 < 0.25) say(`… at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} ias ${ac.ias.toFixed(0)} hdg ${ac.heading.toFixed(0)}`);
    }
    if (firing) sim.key(fireCode, false);
    shot(`${missionId}-${roleId}-${fail ? 'fail' : 'pass'}-end`);
  } finally {
    sim.override = null;
    sim.renderer.render = realRender;
    if (firing) sim.key(fireCode, false);
  }
  const status = sim.runner.status;
  return {
    ok: fail ? status === 'failed' : status === 'complete',
    missionId, roleId, fail, status, seconds: T,
    score: sim.runner.data ? sim.runner.data.score : null,
    crashed: ac.crashed, crashReason: ac.crashReason,
    log, shots: pics,
  };
}
