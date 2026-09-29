/**
 * KID PLAYTEST — the Skyhook, flown the way a ten-year-old flies it.
 *
 * Not "is the flight model right". This presses the keys a child presses —
 * holds Shift and lets go, holds W for ten seconds and then a lot longer,
 * spins on E, leans on D at speed, mashes four keys at once, holds W and Ctrl
 * together at an H, holds Ctrl all the way to the ground — and asserts the
 * numbers that decide whether the helicopter is a toy or a trap. Each detail
 * string says what it measured; the unmodified build's number is in the
 * comment above the check, so a red line says how far off it is.
 *
 * The unmodified build (0db28ca), easy, hover assist on, measured:
 *   - Free Flight put it on runway 09: "Take off from runway 09", tower "Taxi
 *     and hold". The panel said HOVER ASSIST the whole time.
 *   - Shift held 4 s ran the collective to 100% and it STAYED there: climbed
 *     at 12 m/s to 228 m; the height hold refuses to capture above 3 m/s.
 *   - Ctrl, 90% -> 3% of lever over 2 s: vertical speed unchanged (12.6 m/s).
 *   - W held 4 s: nose to -87 degrees, heading 90 -> 270, into the ground at
 *     18 m/s: "You came down far too fast". A held 4 s: 61 degrees of bank.
 *
 * And the review of the first kid build (54b893e) found, and this checks:
 *   - the Kestrel start put the Follow camera on the next block's roof, so
 *     the first frame was a grey slab with no helicopter in it;
 *   - the tower's subtitle covered the lower half of the helicopter card;
 *   - I in the air stopped the engine (a crash 2.5 s later), and P handed
 *     the machine to the aeroplane autopilot, which climbed it to 222 m;
 *   - the landing light went red, then amber, on a landing the child was
 *     flying exactly as told, which then graded "perfect";
 *   - controls.throttle read the lift command (50% in a hover), not a lever;
 *   - realistic mode no longer flipped but W still reached -43.5 degrees,
 *     stayed at -34 when let go, and A reached 56 degrees of bank;
 *   - on hills of 8.8-11.2 degrees Ctrl hovered saying CAN'T LAND HERE,
 *     with nothing on the card about turning round, which lands.
 *
 * And the review of the second kid build (30a4007) found, and this checks:
 *   - beside a 64-degree cliff on Kestrel, Ctrl parked it 6-11 m up with
 *     "Turn with Q or E" on the card, and Q or E then swung the tail or the
 *     nose into the rock: 9 of 12 tries crashed (measured again here before
 *     the fix, the review's own three spots);
 *   - on slopes over about 15 degrees no heading lands, and the card still
 *     said to turn;
 *   - HOLDING HEIGHT on the card over a 400-500 ft/min descent, with W held
 *     off the hospital roof;
 *   - Ctrl from high up came down at 3 m/s all the way: 94 s from 270 m.
 * And, with the turn fixed, a wider cliff probe here found Q, D and Ctrl
 * held together at a 63-degree face slid the right wing tip into the rock.
 * And a wider one again (node harness, 300 runs at 75 cliff spots in four
 * winds) found 58 crashes on that build, tail or propeller first, sliding
 * or backing into the rock with Ctrl held or keys mashed; three of those
 * spots are the "whole sequence" check below.
 *
 * Run it on its own from the console (or from node, see the hand-over):
 *
 *   const s = window.__sim; s.renderer.render = () => {};
 *   const r = { checks: [], ok(n, p, d = '') { this.checks.push({ n, p: !!p, d: String(d) }); return !!p; } };
 *   await (await import('/tests/features/heli-playtest.browser.js')).check(s, r, console.log);
 *   console.table(r.checks);
 *
 * It drives the game ONLY through keyboard events on window and sim.step().
 * The exceptions are the ones a child does from a menu — the difficulty, the
 * Heli button, Free Flight, the First Light card — putting the machine
 * back on the pad between sections so one section's crash is reported once,
 * not again by every section after it, and putting it 6 m over one hillside
 * for the hill check. About 400 s of game time.
 */

const KEYS = {
  Shift: ['ShiftLeft', 'Shift'],
  Ctrl: ['ControlLeft', 'Control'],
  W: ['KeyW', 'w'],
  A: ['KeyA', 'a'],
  S: ['KeyS', 's'],
  D: ['KeyD', 'd'],
  Q: ['KeyQ', 'q'],
  E: ['KeyE', 'e'],
  // Not flying keys, but keys a child presses to see what they do.
  I: ['KeyI', 'i'],
  P: ['KeyP', 'p'],
};

export async function check(sim, r, say = () => {}) {
  const press = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { code: KEYS[k][0], key: KEYS[k][1], bubbles: true }));
  const release = (k) => window.dispatchEvent(new KeyboardEvent('keyup', { code: KEYS[k][0], key: KEYS[k][1], bubbles: true }));
  const allUp = () => {
    for (const k in KEYS) release(k);
  };
  const ac = () => sim.aircraft;
  const ro = () => ac().readouts();
  const tilt = () => Math.max(Math.abs(ro().pitch), Math.abs(ro().bank));
  // What the card says: metres of air under the skids. The unmodified build
  // has no such number, so it falls back to the same sum.
  const skidH = () => {
    const R = ac().rotor;
    if (R && Number.isFinite(R.heightAbove)) return R.heightAbove;
    return ac().pos.y - Math.max(0, ac().pos.y - ac().agl) - 1.69;
  };
  const hud = () => sim.hud || {};
  const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const card = () => text(hud().heliState);
  const hdgDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
  const DT = 1 / 15;
  /** Advance `secs` of game time, calling `each` between frames; true stops it. */
  const run = (secs, each) => {
    const n = Math.max(1, Math.round(secs / DT));
    for (let i = 0; i < n; i++) {
      if (sim.state === 'paused' && typeof sim.resume === 'function') sim.resume();
      sim.step(DT);
      if (each && each() === true) return true;
    }
    return false;
  };
  const hold = (keys, secs, each) => {
    for (const k of keys) press(k);
    const out = run(secs, each);
    for (const k of keys) release(k);
    return out;
  };

  const origRender = sim.renderer.render;
  sim.renderer.render = () => {};
  const origAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const origDiff = (sim.settings && sim.settings.difficulty) || 'normal';
  const origSpeak = sim.speak;
  // Headless Chrome never resolves AudioContext.resume() without a real
  // gesture, and startMode() waits for it. Skip the unlock if nobody has made
  // one; a real session with sound already running is not touched.
  const origUnlocking = sim._unlocking;
  if (sim.audio && !sim.audio.started) sim._unlocking = true;

  let PADS = [];
  try {
    PADS = (await import('../../src/world/pads.js')).PADS;
  } catch (e) {
    /* reported below as a failed check, not a thrown suite */
  }

  /** Free Flight in the helicopter, as the menu does it, on a calm day. */
  const startHeli = async (difficulty = 'easy', extra = {}) => {
    allUp();
    if (typeof sim.applyDifficulty === 'function') sim.applyDifficulty(difficulty);
    if (typeof sim.switchGame === 'function') sim.switchGame('heli');
    await sim.startMode('free', {
      aircraft: 'harrier', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 250, ...extra,
    });
    allUp();
    run(1);
  };
  /** Up to about `h` metres by holding Shift and letting go, then settle. */
  const liftTo = (h) => {
    hold(['Shift'], 15, () => skidH() > h - 2 || ac().crashed);
    run(4);
  };
  /**
   * Q or E until the nose points at `h`, the way a child lines it up. The
   * two sections that fly a long way both fly EAST from the start pad: the
   * Free Flight start on Kestrel is the Cottage Hospital roof, in the town,
   * with the hills to the south — and flying at hills or rooftops is what
   * the ground-ahead brake and the landing guard are for, not what these
   * two checks are measuring. Measured 2026-09-25 flying south instead: W
   * held 45 s topped out at 32.5 m/s braking for the hills, and W+Ctrl let
   * go over the town hovered at 39 m saying CAN'T LAND HERE.
   */
  const face = (h) => {
    for (let i = 0; i < 24; i++) {
      const e = ((h - ac().heading + 540) % 360) - 180;
      if (Math.abs(e) < 4) return;
      hold([e > 0 ? 'E' : 'Q'], Math.min(0.6, Math.abs(e) / 50));
      run(1);
    }
  };
  /** Each section starts flying, from the pad again if the last one ended badly. */
  const flyingAt = async (h, difficulty = 'easy') => {
    if (ac().crashed || ac().onGround || skidH() < h - 8 || skidH() > h + 25 || ac().groundSpeed > 3) {
      await startHeli(difficulty);
      liftTo(h);
    }
  };

  try {
    /* ============================================================ start */
    say('heli playtest: the start');
    const heard = [];
    sim.speak = function (t, ...rest) {
      heard.push(String(t));
      return origSpeak.call(this, t, ...rest);
    };
    await startHeli('easy');
    run(2);
    sim.speak = origSpeak;
    const a0 = ac();
    let nearest = null;
    let nd = Infinity;
    for (const p of PADS) {
      const d = Math.hypot(p.pos.x - a0.pos.x, p.pos.z - a0.pos.z);
      if (d < nd) {
        nd = d;
        nearest = p;
      }
    }
    // Unmodified: on the numbers of runway 09.
    r.ok(
      'Free Flight in the helicopter starts on a helipad',
      !!nearest && nd <= nearest.r && a0.onGround,
      nearest ? `${f1(nd)} m from ${nearest.name} (r ${nearest.r}), on the ground ${a0.onGround}` : 'no pads'
    );
    const objText = text(hud().objective);
    const said = heard.join(' | ');
    // Unmodified: "Take off from runway 09" and "Taxi and hold".
    r.ok(
      'the panel and the tower use helicopter words',
      !/runway 0?9/i.test(objText) && /shift/i.test(objText) && !/taxi and hold|cleared for take-off/i.test(said),
      `panel "${objText.slice(0, 110)}" · tower "${said.slice(0, 110) || 'nothing'}"`
    );
    // Unmodified: HOVER ASSIST, whatever was happening.
    const chip = text(hud().assistChip);
    r.ok(
      'easy is kid mode, and the panel says so',
      !!(a0.rotor && a0.rotor.kid) && /KID/.test(chip),
      `rotor.kid ${a0.rotor && a0.rotor.kid}, chip "${chip}"`
    );
    const hOnPad = text(hud().heliH);
    // Measured before the fix: 5 ft sitting on the pad (the machine's centre).
    r.ok('on the pad the height reads 0', hOnPad === '0' && Math.abs(skidH()) < 0.3, `card "${hOnPad}" ft, skids ${f1(skidH())} m`);
    /*
     * What the child SEES first. Measured on the first kid build (54b893e),
     * this same calm start: parked on the Cottage Hospital roof nose 157.5,
     * the Follow camera stood 0.9 m over the next town block's roof and a
     * ray from it to the machine met that roof 2.4 m out — the first frame
     * was a grey slab. Rays to the machine's centre and to its mast top,
     * against everything drawn except the machine itself.
     */
    let seen = 'no camera';
    try {
      const THREE = await import('../../src/vendor/three.module.js');
      const inModel = (o) => {
        for (; o; o = o.parent) if (o === sim.model) return true;
        return false;
      };
      const cam = sim.camera.position.clone();
      const hitsTo = [];
      for (const up of [0, 1.6]) {
        const p = new THREE.Vector3(0, up, 0).applyQuaternion(a0.quat).add(a0.pos);
        const dir = p.clone().sub(cam);
        const dist = dir.length();
        const rc = new THREE.Raycaster(cam, dir.normalize(), 0.05, Math.max(0.1, dist - 1.5));
        rc.camera = sim.camera;
        const hit = rc
          .intersectObjects(sim.scene.children, true)
          .find((h) => h.object.visible !== false && !inModel(h.object) && !h.object.isSprite && !h.object.isPoints && !h.object.isLine);
        hitsTo.push(hit ? `${up ? 'mast' : 'centre'} hidden ${f1(hit.distance)} m out` : `${up ? 'mast' : 'centre'} clear`);
      }
      seen = `${hitsTo.join(', ')}; camera ${f1(cam.distanceTo(a0.pos))} m away, nose ${Math.round(a0.heading)}`;
    } catch (e) {
      seen = `ray test threw: ${e && e.message}`;
    }
    r.ok('from the start the Follow camera can see the helicopter', /centre clear, mast clear/.test(seen), seen);
    /*
     * And the card, while the tower talks. Measured on the first kid build
     * at 1280 x 800: the tower's subtitle (bottom 118 px, up to 720 px wide)
     * was printed over the lower half of the card — the SHIFT / HOLD / CTRL
     * row and the landing light — for the first seconds of every flight.
     */
    const box = (el) => (el && el.getBoundingClientRect ? el.getBoundingClientRect() : null);
    const cardEl = hud().heliCard;
    const subEl = hud().subtitle;
    // The tower's start call may have finished by now; put its own words
    // back up for the measurement.
    if (subEl && subEl.style.display === 'none' && heard.length && typeof hud().setSubtitle === 'function') {
      hud().setSubtitle(heard[heard.length - 1], 'Tower', 4);
    }
    const cb = box(cardEl);
    const sb = box(subEl);
    const subOn = !!(subEl && subEl.style.display !== 'none' && sb && sb.width > 0);
    const over = cb && sb ? Math.max(0, Math.min(cb.right, sb.right) - Math.max(cb.left, sb.left)) * Math.max(0, Math.min(cb.bottom, sb.bottom) - Math.max(cb.top, sb.top)) : 0;
    r.ok(
      'the tower’s subtitle does not cover the helicopter card',
      !!cb && cb.width > 0 && !cardEl.hidden && subOn && over === 0,
      cb
        ? `card ${Math.round(cb.left)},${Math.round(cb.top)} ${Math.round(cb.width)}x${Math.round(cb.height)}; subtitle ${subOn ? `${Math.round(sb.left)},${Math.round(sb.top)} ${Math.round(sb.width)}x${Math.round(sb.height)}` : 'not showing'}; ${Math.round(over)} px² overlap`
        : 'no helicopter card'
    );

    /* ============================================================= lift */
    say('heli playtest: Shift, then let go');
    const h0 = skidH();
    hold(['Shift'], 4);
    const vs4 = ac().vs;
    // Unmodified: 12 m/s and still accelerating.
    r.ok('holding Shift climbs at 3.5 to 5.5 m/s', vs4 >= 3.5 && vs4 <= 5.5 && h0 < 0.5, `${f1(vs4)} m/s after 4 s, from ${f1(h0)} m`);
    const hRel = skidH();
    run(4);
    const hStop = skidH();
    let lo = Infinity;
    let hi = -Infinity;
    run(8, () => {
      lo = Math.min(lo, skidH());
      hi = Math.max(hi, skidH());
    });
    // Unmodified: the lever stayed at 100% and it climbed to 228 m.
    r.ok(
      'letting go of Shift stops the climb and holds that height',
      hStop - hRel < 6 && hi - lo < 0.75 && Math.abs(ac().vs) < 0.3,
      `let go at ${f1(hRel)} m, stopped at ${f1(hStop)} m, then ${f1(lo)}-${f1(hi)} m over 8 s, vs ${f1(ac().vs)}`
    );
    r.ok('the panel says it is hovering while it hovers', /HOVER|HOLD/.test(card()), `card "${card()}"`);
    /*
     * sim.aircraft.controls.throttle keeps its meaning — the lever — for
     * anybody else reading it. On the first kid build it was the lift
     * command, so a steady hover read 50%; the lever that holds the same
     * hover in realistic mode reads (hoverPoint - idle) / (1 - idle).
     */
    const Rh = ac().rotor || {};
    const thr = ac().controls.throttle;
    const hoverLever = Number.isFinite(Rh.hoverPoint) ? (Rh.hoverPoint - 0.18) / 0.82 : NaN;
    r.ok(
      'in the hover, controls.throttle reads the lever that holds it',
      Math.abs(thr - hoverLever) < 0.05,
      `controls.throttle ${thr.toFixed(3)}, hover lever ${Number.isFinite(hoverLever) ? hoverLever.toFixed(3) : 'unknown'}`
    );

    /* ============================================================= ctrl */
    say('heli playtest: Ctrl');
    await flyingAt(18);
    run(2);
    let vsAt1 = 0;
    let vsLow = 0;
    let tc = 0;
    hold(['Ctrl'], 3, () => {
      tc += DT;
      if (tc <= 1.001) vsAt1 = Math.min(vsAt1, ac().vs);
      vsLow = Math.min(vsLow, ac().vs);
    });
    // Unmodified: no change at all for 1.5 s, then it fell at 21 m/s.
    r.ok(
      'Ctrl comes down within a second, and no faster than 3.5 m/s',
      vsAt1 <= -2 && vsLow >= -3.5,
      `${f1(vsAt1)} m/s within 1 s, fastest ${f1(vsLow)} m/s over 3 s`
    );
    run(3);
    r.ok('letting go of Ctrl holds the height again', Math.abs(ac().vs) < 0.3, `vs ${f1(ac().vs)} m/s 3 s after`);

    /* ================================================== I and P, in the air */
    /*
     * The two keys a child presses to find out what they do. Measured on the
     * first kid build: I in a 23.7 m hover stopped the engine and 2.5 s later
     * it hit the ground at 17.4 m/s, "You came down far too fast"; P engaged
     * the aeroplane autopilot, which flew it forward at 25 m/s and up at
     * 4.5 m/s from 13 m to 222 m in 40 s with the card saying GOING UP.
     */
    say('heli playtest: I and P in the air');
    await flyingAt(18);
    run(2);
    const yI = ac().pos.y;
    const tapKey = (k) => {
      press(k);
      run(DT);
      release(k);
      run(DT);
    };
    tapKey('I');
    const cardI = card();
    let lowI = 0;
    run(5, () => {
      lowI = Math.min(lowI, ac().pos.y - yI);
    });
    r.ok(
      'I in the air does not stop the engine, and the card says why',
      ac().engineOn && !ac().crashed && lowI > -1 && /ENGINE/.test(cardI),
      `engine ${ac().engineOn ? 'on' : 'OFF'}, lowest ${f1(lowI)} m in 5 s, card "${cardI}"${ac().crashed ? ', CRASHED: ' + ac().crashReason : ''}`
    );
    await flyingAt(13);
    run(2);
    const pP = ac().pos.clone();
    tapKey('P');
    const toastP = ((hud().toasts || []).slice(-1)[0] || {}).node;
    const toastPText = toastP ? text(toastP) : '';
    let farP = 0;
    let highP = 0;
    run(20, () => {
      farP = Math.max(farP, Math.hypot(ac().pos.x - pP.x, ac().pos.z - pP.z));
      highP = Math.max(highP, Math.abs(ac().pos.y - pP.y));
    });
    r.ok(
      'P in the air leaves it hovering where it was, and says so',
      !(sim.autopilot && sim.autopilot.engaged) && farP < 3 && highP < 1.5 && !ac().crashed,
      `autopilot ${sim.autopilot && sim.autopilot.engaged ? 'ENGAGED' : 'off'}, ${f1(farP)} m and ${f1(highP)} m of height in 20 s; toast "${toastPText.slice(0, 90)}"`
    );

    /* ========================================================= hands off */
    say('heli playtest: hands off');
    await flyingAt(15);
    run(3);
    const p0 = ac().pos.clone();
    const hd0 = ac().heading;
    let drift = 0;
    let dy = 0;
    run(20, () => {
      drift = Math.max(drift, Math.hypot(ac().pos.x - p0.x, ac().pos.z - p0.z));
      dy = Math.max(dy, Math.abs(ac().pos.y - p0.y));
    });
    r.ok(
      'hands off for 20 s it stays within 2 m, 1 m of height and 3 degrees',
      drift < 2 && dy < 1 && hdgDiff(ac().heading, hd0) < 3 && !ac().crashed,
      `${f1(drift)} m, ${f1(dy)} m of height, ${f1(hdgDiff(ac().heading, hd0))} deg`
    );

    /* ================================================ hands off, windy */
    // The winch missions blow 9 to 20 kt. A hover that only holds in a calm
    // is a hover that fails the first rescue.
    say('heli playtest: hands off in fifteen knots');
    await startHeli('easy', { windSpeedKts: 15, windDirDeg: 300 });
    liftTo(15);
    run(10);
    const pw = ac().pos.clone();
    let driftW = 0;
    let dyW = 0;
    run(30, () => {
      driftW = Math.max(driftW, Math.hypot(ac().pos.x - pw.x, ac().pos.z - pw.z));
      dyW = Math.max(dyW, Math.abs(ac().pos.y - pw.y));
    });
    // Height as well as place: the unmodified build held its place to 0.3 m
    // here while the stuck lever took it straight up.
    r.ok(
      'in 15 kt of wind, hands off for 30 s, it stays within 3 m and 1.5 m of height',
      driftW < 3 && dyW < 1.5 && !ac().crashed && !ac().onGround,
      `${f1(driftW)} m and ${f1(dyW)} m of height in 30 s, ${f1(ac().groundSpeed)} m/s over the ground at the end${ac().crashed ? ', CRASHED: ' + ac().crashReason : ''}`
    );

    /* =============================================== W off the roof */
    /*
     * W off the hospital roof the way the start faces, as the review of
     * 30a4007 flew it: 92.2 m to 78.2 m in 10 s, following the hillside
     * down, with HOLDING HEIGHT on the card and "down 380-520 ft/min" under
     * it. The card may hold a height over the ground; it must not say it is
     * holding still while the V/S row says otherwise.
     */
    say('heli playtest: W off the roof, card against V/S');
    await startHeli('easy');
    liftTo(18);
    let liesW = 0;
    let lieAt = '';
    let followSeen = false;
    let vsMostW = 0;
    hold(['W'], 10, () => {
      const vsFpm = ac().vs * 196.85;
      if (Math.abs(vsFpm) > Math.abs(vsMostW)) vsMostW = vsFpm;
      if (/FOLLOWING/.test(card())) followSeen = true;
      if (/HOLDING HEIGHT|HOVERING/.test(card()) && Math.abs(vsFpm) > 300) {
        liesW++;
        if (!lieAt) lieAt = `"${card()}" at ${Math.round(vsFpm)} ft/min`;
      }
    });
    r.ok(
      'with W held off the roof, the card never says HOLDING HEIGHT over a 300 ft/min climb or descent',
      liesW === 0 && !ac().crashed,
      `${liesW} frames${lieAt ? ', first ' + lieAt : ''}; most ${Math.round(vsMostW)} ft/min; FOLLOWING THE GROUND ${followSeen ? 'shown' : 'not needed'}`
    );

    /* ======================================================== W, and on */
    say('heli playtest: W for ten seconds, then a lot longer');
    await startHeli('easy');
    liftTo(30);
    face(90);
    run(3);
    const hdgW = ac().heading;
    let maxTiltW = 0;
    press('W');
    run(10, () => {
      maxTiltW = Math.max(maxTiltW, tilt());
    });
    const gs10 = ac().groundSpeed;
    // Unmodified: -87 degrees, over on its back, heading 90 -> 270.
    r.ok(
      'holding W for 10 s flies forwards, tilted no more than 20 degrees',
      maxTiltW <= 20 && gs10 > 15 && hdgDiff(ac().heading, hdgW) < 5 && !ac().crashed,
      `max tilt ${f1(maxTiltW)} deg, ${f1(gs10)} m/s at 10 s, heading moved ${f1(hdgDiff(ac().heading, hdgW))} deg`
    );
    run(35, () => {
      maxTiltW = Math.max(maxTiltW, tilt());
    });
    release('W');
    const top = ac().groundSpeed;
    r.ok(
      'held on, it tops out at a sensible 50 to 66 m/s',
      top > 50 && top < 66 && maxTiltW <= 20 && !ac().crashed,
      `${f1(top)} m/s after 45 s of W, max tilt ${f1(maxTiltW)} deg, card "${card().slice(0, 40)}"${ac().crashed ? ', CRASHED: ' + ac().crashReason : ''}`
    );
    let stopT = -1;
    let t = 0;
    run(25, () => {
      t += DT;
      if (stopT < 0 && ac().groundSpeed < 1.5 && tilt() < 5) stopT = t;
      return stopT >= 0 && t > stopT + 1;
    });
    // Unmodified: letting go did not level it.
    r.ok(
      'letting go levels it and brings it to a hover within 20 s',
      stopT >= 0 && stopT <= 20 && !ac().crashed,
      stopT >= 0 ? `level and under 1.5 m/s ${f1(stopT)} s after letting go of W at ${f1(top)} m/s` : `still ${f1(ac().groundSpeed)} m/s and ${f1(tilt())} deg`
    );

    /* ============================================================== turn */
    say('heli playtest: a full turn on E');
    await flyingAt(25);
    let turned = 0;
    let lastH = ac().heading;
    let turnT = 0;
    hold(['E'], 12, () => {
      const h = ac().heading;
      turned += ((h - lastH + 540) % 360) - 180;
      lastH = h;
      turnT += DT;
      return turned >= 360;
    });
    const hLetGo = ac().heading;
    let ranOn = 0;
    run(3, () => {
      ranOn = Math.max(ranOn, hdgDiff(ac().heading, hLetGo));
    });
    r.ok('E turns it right round in under 10 s', turned >= 360 && turnT <= 10, `${f1(turned)} deg in ${f1(turnT)} s`);
    // Measured before the yaw brake was wired in: 13.0 degrees.
    r.ok('and it stops within 10 degrees of where E was let go', ranOn < 10, `ran on ${f1(ranOn)} deg`);

    /* ============================================================= steer */
    say('heli playtest: W and D together');
    await flyingAt(35);
    press('W');
    run(8);
    let steered = 0;
    let lastS = ac().heading;
    let maxTiltS = 0;
    press('D');
    run(10, () => {
      const h = ac().heading;
      steered += ((h - lastS + 540) % 360) - 180;
      lastS = h;
      maxTiltS = Math.max(maxTiltS, tilt());
    });
    release('D');
    release('W');
    r.ok(
      'W and D together steer it round like a car',
      steered >= 90 && maxTiltS <= 20 && !ac().crashed,
      `${f1(steered)} deg of turn in 10 s, max tilt ${f1(maxTiltS)} deg`
    );
    run(10);

    /* ============================================================== mash */
    say('heli playtest: mashing the keys');
    const combos = [['W', 'A'], ['S', 'D'], ['W', 'S', 'A', 'D'], ['S', 'A', 'Q', 'Shift'], ['W', 'D', 'E', 'Ctrl'], ['S', 'Ctrl']];
    let worst = 0;
    let worstKeys = '';
    let crashedOn = '';
    for (const c of combos) {
      await flyingAt(30);
      let m = 0;
      hold(c, 5, () => {
        m = Math.max(m, tilt());
      });
      run(3, () => {
        m = Math.max(m, tilt());
      });
      if (m > worst) {
        worst = m;
        worstKeys = c.join('+');
      }
      if (ac().crashed && !crashedOn) crashedOn = `${c.join('+')}: ${ac().crashReason}`;
    }
    // Unmodified: one key (W) flipped it.
    r.ok(
      'no bunch of keys tips it past 20 degrees or crashes it',
      worst <= 20 && !crashedOn,
      `worst ${f1(worst)} deg on ${worstKeys}${crashedOn ? ' — CRASHED on ' + crashedOn : ''}`
    );

    /* =========================================================== landing */
    say('heli playtest: Ctrl all the way down');
    await startHeli('easy');
    liftTo(20);
    let lightSeen = false;
    let vsHigh = 0;
    let vsLastM = 0;
    // Every colour the light showed on the way down, with where it changed.
    const lightLog = [];
    let lightWas = '';
    const landed = hold(['Ctrl'], 40, () => {
      const h = skidH();
      const L = hud().heliLand;
      if (L && !L.hidden) {
        lightSeen = true;
        const col = L.classList.contains('is-bad') ? 'red' : L.classList.contains('is-warn') ? 'amber' : 'green';
        if (col !== lightWas) {
          lightWas = col;
          lightLog.push(`${col} at ${f1(h * 3.28084)} ft "${text(hud().heliLandText)}"`);
        }
      }
      if (h > 8) vsHigh = Math.min(vsHigh, ac().vs);
      if (h < 1 && !ac().onGround) vsLastM = Math.min(vsLastM, ac().vs);
      return ac().onGround || ac().crashed;
    });
    run(1);
    const td = ac().lastTouchdown;
    // Unmodified: "You came down far too fast".
    // From 20 m: 3.4 m/s at the top since Ctrl comes down faster from high
    // up (see descendHigh in rotor-assist.js), 3 m/s from 15 m.
    r.ok(
      'holding Ctrl lands it: 3 to 4 m/s up high, under 1 m/s in the last metre, touchdown under 150 ft/min',
      landed && !ac().crashed && vsHigh <= -2.5 && vsHigh >= -4 && vsLastM >= -1 && td && Math.abs(td.vsFpm) < 150,
      td
        ? `${f1(vsHigh)} m/s up high, ${f1(vsLastM)} m/s in the last metre, ${td.vsFpm} ft/min, ${td.quality}`
        : `no touchdown; crashed ${ac().crashed} ${ac().crashReason || ''}`
    );
    // Graded as a helicopter landing on an H: before the first kid build a
    // 90 ft/min vertical touchdown scored 33/100 "not on the runway".
    r.ok(
      'the touchdown is scored as a landing on the H',
      !!td && !td.crashed && td.onRunway && td.score >= 80,
      td ? `${td.score}/100, on an H ${td.onRunway}, ${td.centreline} m from its middle` : 'no touchdown'
    );
    r.ok('the landing light came on for the landing', lightSeen, `seen ${lightSeen}`);
    // Measured on the first kid build, this same landing: red "too fast,
    // keep holding Ctrl" from 19 ft to 16 ft, amber to 9 ft, and then an
    // 86 ft/min touchdown graded "perfect". The child was doing exactly what
    // the light said.
    r.ok(
      'doing what it says, the landing light stays green all the way down',
      lightSeen && lightLog.every((s) => s.startsWith('green')),
      lightLog.join(' > ') || 'never lit'
    );
    run(3);
    r.ok('and it stays down when Ctrl is let go', ac().onGround && !ac().crashed, `on the ground ${ac().onGround}`);

    /* ============================================================== gate */
    say('heli playtest: W and Ctrl together, flying at an H');
    await startHeli('easy');
    liftTo(30);
    face(90);
    run(3);
    press('W');
    run(6);
    let lowest = Infinity;
    let gateWords = '';
    press('Ctrl');
    run(20, () => {
      if (!ac().onGround) lowest = Math.min(lowest, skidH());
      if (/LET GO/.test(card())) gateWords = card();
      return ac().crashed;
    });
    release('W');
    const downAfter = run(30, () => ac().onGround || ac().crashed);
    release('Ctrl');
    run(1);
    // Measured before the gate was wired in: into the grass at 39.5 m/s.
    r.ok(
      'W and Ctrl together hold it off the ground, and letting go of W lands it',
      !ac().crashed && lowest >= 2 && downAfter && ac().onGround,
      `lowest ${f1(lowest)} m with W held, then ${ac().crashed ? 'CRASHED: ' + ac().crashReason : ac().onGround ? 'landed' : 'not down'}; card "${gateWords}"`
    );

    /* ============================================================== hill */
    /*
     * Ctrl over a hill with the nose pointing up it. The review of the first
     * kid build found spots of 8.8-11.2 degrees on Kestrel where Ctrl held
     * for 40 s hovered saying CAN'T LAND HERE. It is geometry — the nose
     * would touch before the skids — and turning round lands, so the card
     * has to say that, and doing what it says has to work. The spot is bare
     * grass east of the airfield, 9.8 degrees when this was written; the
     * detail string says if the map has changed under it.
     */
    say('heli playtest: Ctrl over a hill, nose up the slope');
    await startHeli('easy');
    try {
      const T = await import('../../src/world/terrain.js');
      const HX = 2120.1;
      const HZ = -32.6;
      const e = 3;
      const gx = (T.heightAt(HX + e, HZ) - T.heightAt(HX - e, HZ)) / (2 * e);
      const gz = (T.heightAt(HX, HZ + e) - T.heightAt(HX, HZ - e)) / (2 * e);
      const hillDeg = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
      // Heading h points along (sin h, 0, -cos h): the uphill heading.
      const upHdg = ((Math.atan2(gx, -gz) * 180) / Math.PI + 360) % 360;
      // Put it 6 m over the hill, nose up it — the one move here that is not
      // a key, like putting it back on the pad between sections.
      ac().reset({ pos: { x: HX, y: 0, z: HZ }, headingDeg: upHdg, speed: 0, altAGL: 6, engineOn: true });
      allUp();
      run(2);
      press('Ctrl');
      let hillCard = '';
      let hillSay = '';
      run(12, () => {
        if (/TOO STEEP/.test(card())) {
          hillCard = card();
          hillSay = text(hud().heliSay);
        }
        return ac().onGround || ac().crashed;
      });
      const refused = !ac().onGround && !ac().crashed;
      const heldAt = skidH();
      /*
       * What the card says: turn with E, or with Q — whichever it names —
       * with Ctrl still down, and it stops turning where it can land. The
       * first repair's card said "Q or E" and the child picked; 30a4007's
       * playtest held E for 168 degrees and then let go.
       */
      const key = /turn with E/i.test(hillSay) ? 'E' : /turn with Q/i.test(hillSay) ? 'Q' : /Q or E/.test(hillSay) ? 'E' : null;
      const h0 = ac().heading;
      let landed = false;
      if (key) {
        press(key);
        landed = run(20, () => ac().onGround || ac().crashed);
        release(key);
      }
      const turned = hdgDiff(ac().heading, h0);
      // The card says keep holding both: it has to land with the key still
      // down. Measured before the room-to-turn climb stood down at a heading
      // that lands, it stopped turning and hovered until the key came up.
      const whileHeld = landed;
      if (!landed) landed = run(10, () => ac().onGround || ac().crashed);
      release('Ctrl');
      run(3);
      const td = ac().lastTouchdown;
      const fpm = td ? Math.abs(td.vsFpm) : NaN;
      r.ok(
        'on a hill too steep to land nose-first, the card says which way to turn, and doing it lands it',
        hillDeg > 8 && hillDeg < 12 && refused && /TOO STEEP THIS WAY/.test(hillCard) && /turn with [EQ]\b/i.test(hillSay)
          && landed && whileHeld && ac().onGround && !ac().crashed && fpm < 150,
        `hill ${f1(hillDeg)} deg; nose up it: ${refused ? `held at ${f1(heldAt)} m` : 'did not hold off'}, card "${hillCard}" "${hillSay}"; `
          + `${key ? `held ${key} with Ctrl, turned ${f1(turned)} deg` : 'no key named'}, then ${ac().crashed ? 'CRASHED: ' + ac().crashReason : landed ? `landed at ${f1(fpm)} ft/min ${whileHeld ? 'with the key still held' : 'only once the key was let go'}` : 'not down'}`
      );
    } catch (e) {
      r.ok('on a hill too steep to land nose-first, the card says which way to turn, and doing it lands it', false, (e && e.message) || String(e));
    }

    /* ============================================================= cliff */
    /*
     * Beside a cliff. The review of 30a4007 parked it with Ctrl beside three
     * 63-65 degree rock faces on Kestrel — (1128, 942) nose 161, (770, 1481)
     * nose 256, (-1660, -1166) nose 4 — where the card said "Turn with Q or
     * E", and Q or E then crashed it 7 times in 9. Measured here on 30a4007
     * before the fix, the same spots, E+Ctrl / E / Q / E from an 8 m hover:
     * 9 of 12 crashed, tail or propeller, in 0.9-4.5 s. No way round lands
     * on 64 degrees, so the card must say that; and a child who turns anyway
     * must not be killed for it.
     */
    say('heli playtest: beside a cliff, then Q and E');
    await startHeli('easy');
    try {
      const cliffs = [
        [1128.4, 942.2, 161, 'E+Ctrl, then Q'],
        [-1660, -1166, 4, 'E from an 8 m hover'],
      ];
      const got = [];
      let cliffWords = '';
      let cliffOk = true;
      let spinOk = true;
      for (const [cx, cz, ch, how] of cliffs) {
        ac().reset({ pos: { x: cx, y: 0, z: cz }, headingDeg: ch, speed: 0, altAGL: 14, engineOn: true });
        allUp();
        run(3);
        press('Ctrl');
        if (how === 'E from an 8 m hover') {
          run(30, () => skidH() < 8.5 || ac().crashed);
          release('Ctrl');
          run(2);
        } else {
          run(20, () => ac().crashed);
        }
        const c0 = card();
        const s0 = text(hud().heliSay);
        if (!cliffWords) cliffWords = `"${c0}" "${s0}"`;
        const saysSteep = /TOO STEEP HERE/.test(c0) && !/turn with/i.test(s0);
        let turned = 0;
        let prev = ac().heading;
        const spin = (k, secs) => {
          press(k);
          run(secs, () => {
            let d = ac().heading - prev;
            if (d > 180) d -= 360;
            if (d < -180) d += 360;
            turned += Math.abs(d);
            prev = ac().heading;
            return ac().crashed;
          });
          release(k);
        };
        spin('E', 10);
        if (how === 'E+Ctrl, then Q') {
          release('Ctrl');
          run(1);
          spin('Q', 10);
        }
        release('Ctrl');
        run(1);
        cliffOk = cliffOk && saysSteep;
        spinOk = spinOk && !ac().crashed && turned > 180;
        got.push(`(${cx}, ${cz}) ${how}: card "${c0}"; turned ${f1(turned)} deg, ${ac().crashed ? 'CRASHED: ' + ac().crashReason : `fine, ${f1(skidH())} m up`}`);
        if (ac().crashed) await startHeli('easy');
      }
      r.ok('beside a cliff where no way round lands, the card says so and does not say turn', cliffOk, `${cliffWords}; ${got.join('; ')}`);
      r.ok('beside a cliff, Q and E turn it without swinging anything into the rock', spinOk, got.join('; '));
    } catch (e) {
      r.ok('beside a cliff, Q and E turn it without swinging anything into the rock', false, (e && e.message) || String(e));
    }

    /* ============================================== cliff, keys together */
    /*
     * Beside a cliff, keys together. With the turn guarded, a wider probe
     * (15 spots of 27-68 degrees on Kestrel, seed 99) found one more way in:
     * Q, D and Ctrl held together at (1863, -1534), 63 degrees, sliding the
     * machine sideways at the rock while it turned and came down — "The
     * right wing tip hit the ground". Here: at that spot and the review's
     * three, parked at the card, nose turned so D slides it uphill at the
     * rock, then Q+D with Ctrl held for 8 s, then W+A+E with Ctrl held for
     * 8 s. Nothing may touch, and it may not tilt past 20 degrees.
     */
    say('heli playtest: beside a cliff, keys together');
    await startHeli('easy');
    try {
      const T = await import('../../src/world/terrain.js');
      const spots = [
        [1862.87, -1533.54],
        [1128.4, 942.2],
        [770, 1481],
        [-1660, -1166],
      ];
      const got = [];
      let allOk = true;
      for (const [cx, cz] of spots) {
        const e = 3;
        const gx = (T.heightAt(cx + e, cz) - T.heightAt(cx - e, cz)) / (2 * e);
        const gz = (T.heightAt(cx, cz + e) - T.heightAt(cx, cz - e)) / (2 * e);
        const upHdg = ((Math.atan2(gx, -gz) * 180) / Math.PI + 360) % 360;
        const slopeDeg = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
        // D slides it right: with the uphill 90 degrees to the right of the
        // nose, right is at the rock.
        ac().reset({ pos: { x: cx, y: 0, z: cz }, headingDeg: (upHdg + 270) % 360, speed: 0, altAGL: 14, engineOn: true });
        allUp();
        run(3);
        press('Ctrl');
        run(15, () => ac().crashed);
        let worst = 0;
        let lowest = Infinity;
        const watch = () => {
          worst = Math.max(worst, tilt());
          lowest = Math.min(lowest, skidH());
          return ac().crashed;
        };
        const cards = new Set();
        hold(['Q', 'D'], 8, () => {
          cards.add(card());
          return watch();
        });
        if (!ac().crashed) hold(['W', 'A', 'E'], 8, () => {
          cards.add(card());
          return watch();
        });
        release('Ctrl');
        run(2, watch);
        const ok = !ac().crashed && worst <= 20;
        allOk = allOk && ok;
        got.push(
          `(${cx}, ${cz}) ${f1(slopeDeg)} deg: ${ac().crashed ? 'CRASHED: ' + ac().crashReason : `fine, worst tilt ${f1(worst)} deg, lowest ${f1(lowest)} m`}; cards ${[...cards].filter(Boolean).join(' / ')}`
        );
        if (ac().crashed) await startHeli('easy');
      }
      r.ok('beside a cliff, Q+D and W+A+E with Ctrl held put nothing into the rock and tilt it no more than 20 degrees', allOk, got.join('; '));
    } catch (e) {
      r.ok('beside a cliff, Q+D and W+A+E with Ctrl held put nothing into the rock and tilt it no more than 20 degrees', false, (e && e.message) || String(e));
    }

    /* ======================================= cliff, a child who stays there */
    /*
     * The whole cliff sequence at three spots where b1d130b crashed. A wider
     * sweep than any before (node harness, 5 seeds x 15 spots of 25-72
     * degrees on Kestrel x 4 winds: 58 of 300 runs crashed on b1d130b, 0 on
     * this build) found the machine sliding tail-first into the rock with
     * Ctrl held: Q+D+Ctrl spiralled it backwards at the face while it came
     * down, and S+Ctrl backed it in. At each: Ctrl to the card, then E with
     * Ctrl, Q, D, A, Q+D+Ctrl, S+Ctrl, A+E and W+Ctrl, in a calm. b1d130b in
     * the harness, this sequence in a calm: "The tail struck the ground" at
     * all three — (-988, 1133) and (1565, -1964) on Q+D+Ctrl, (974, 1732)
     * on S+Ctrl. This build: none, worst tilt 18.0, 29-63 m up at the end.
     * Nothing may touch or tilt past 20 degrees.
     */
    say('heli playtest: beside a cliff, the whole sequence');
    await startHeli('easy');
    try {
      const spots = [
        [-988.388, 1132.917, 312],
        [974.398, 1731.834, 183],
        [1564.745, -1964.16, 276],
      ];
      const got = [];
      let allOk = true;
      for (const [cx, cz, ch] of spots) {
        ac().reset({ pos: { x: cx, y: 0, z: cz }, headingDeg: ch, speed: 0, altAGL: 14, engineOn: true });
        allUp();
        run(3);
        let worst = 0;
        let crashedOn = '';
        const step = (name, keys, secs, rel = true) => {
          if (ac().crashed) return;
          for (const k of keys) press(k);
          run(secs, () => {
            worst = Math.max(worst, tilt());
            if (ac().crashed && !crashedOn) crashedOn = name;
            return ac().crashed;
          });
          if (rel) for (const k of keys) release(k);
        };
        step('Ctrl', ['Ctrl'], 20, false);
        const parked = card();
        step('E+Ctrl', ['E'], 8);
        release('Ctrl');
        step('Q', ['Q'], 8);
        step('D', ['D'], 4);
        step('A', ['A'], 4);
        step('Q+D+Ctrl', ['Q', 'D', 'Ctrl'], 6);
        step('S+Ctrl', ['S', 'Ctrl'], 5);
        step('A+E', ['A', 'E'], 5);
        step('W+Ctrl', ['W', 'Ctrl'], 5);
        allUp();
        const ok = !ac().crashed && worst <= 20;
        allOk = allOk && ok;
        got.push(
          `(${cx}, ${cz}): parked "${parked}", ${ac().crashed ? `CRASHED on ${crashedOn}: ${ac().crashReason}` : `fine, worst tilt ${f1(worst)} deg, ${f1(skidH())} m up`}`
        );
        if (ac().crashed) await startHeli('easy');
      }
      r.ok('beside a cliff, the whole sequence of keys puts nothing into the rock', allOk, got.join('; '));
    } catch (e) {
      r.ok('beside a cliff, the whole sequence of keys puts nothing into the rock', false, (e && e.message) || String(e));
    }

    /* ======================================================= from high */
    /*
     * Ctrl from high up. The review of 30a4007: Shift 60 s to 270 m, then
     * Ctrl took 94 s to land, 3 m/s the whole way. It comes down faster high
     * up now and still slows to the same gentle touchdown.
     */
    say('heli playtest: Ctrl from 150 m');
    await startHeli('easy');
    hold(['Shift'], 40, () => skidH() > 148 || ac().crashed);
    run(4);
    const hHigh = skidH();
    let tDown = 0;
    let vsFast = 0;
    const downHigh = hold(['Ctrl'], 80, () => {
      tDown += DT;
      vsFast = Math.min(vsFast, ac().vs);
      return ac().onGround || ac().crashed;
    });
    run(1);
    const tdH = ac().lastTouchdown;
    r.ok(
      'Ctrl from 150 m lands inside 40 s, no faster than 8 m/s, and gently',
      downHigh && !ac().crashed && hHigh > 140 && tDown <= 40 && vsFast >= -8 && tdH && Math.abs(tdH.vsFpm) < 150,
      `from ${f1(hHigh)} m: ${f1(tDown)} s, fastest ${f1(vsFast)} m/s, ${tdH ? `${tdH.vsFpm} ft/min ${tdH.quality}` : ac().crashed ? 'CRASHED: ' + ac().crashReason : 'not down'}`
    );

    /* ===================================================== first mission */
    say('heli playtest: First Light, start to finish');
    allUp();
    if (typeof sim.switchGame === 'function') sim.switchGame('heli');
    if (typeof sim.startAnyMission === 'function') await sim.startAnyMission('firstlight');
    else await sim.startMode('mission', { id: 'firstlight' });
    allUp();
    const stepId = () => (sim.runner && sim.runner.step ? sim.runner.step.id : null);
    const running = () => sim.runner && sim.runner.status === 'running';
    const log = [];
    let guard = 0;
    while (running() && guard++ < 40 && !ac().crashed) {
      const id = stepId();
      log.push(id);
      if (id === 'lift') {
        // "Hold Shift to lift off the pad. Let go when you are a little way up."
        hold(['Shift'], 6, () => skidH() > 3);
        run(3);
      } else if (id === 'hold') {
        // "Hold it at about twenty feet over the pad... Let go of everything."
        // The HEIGHT light is green in the band; tap towards it if it is not.
        const box = sim.hoverBox;
        const lo2 = box ? box.minAgl : 4;
        const hi2 = box ? box.maxAgl : 11;
        if (skidH() < lo2 + 0.5) hold(['Shift'], 0.5);
        else if (skidH() > hi2 - 0.5) hold(['Ctrl'], 0.5);
        run(7, () => stepId() !== 'hold');
      } else if (id === 'turn') {
        // "Turn right on the spot with E, until you are facing the sea."
        hold(['E'], 8, () => stepId() !== 'turn');
        run(1);
      } else if (id === 'down') {
        // "Come back down onto the H... hold Ctrl."
        hold(['Ctrl'], 40, () => ac().onGround || !running());
        run(4, () => !running());
      } else {
        run(1);
      }
    }
    r.ok(
      'First Light can be flown start to finish by doing what it says',
      sim.runner && sim.runner.status === 'complete',
      `status ${sim.runner && sim.runner.status}, steps ${log.join(' > ')}${ac().crashed ? ' — CRASHED: ' + ac().crashReason : ''}`
    );

    /* ======================================================== normal too */
    await startHeli('normal');
    r.ok('normal difficulty (the default setting) is kid mode too', !!(ac().rotor && ac().rotor.kid), `rotor.kid ${ac().rotor && ac().rotor.kid}`);

    /* ========================================================= realistic */
    say('heli playtest: realistic mode');
    await startHeli('realistic');
    hold(['Shift'], 4);
    run(3);
    const vsFull = ac().vs;
    let vsCut = vsFull;
    hold(['Ctrl'], 1.5, () => {
      vsCut = ac().vs;
    });
    // Unmodified: 90% -> 3% of lever over 2 s with no change at all.
    r.ok(
      'realistic: lowering the lever from full slows the climb within 1.5 s',
      vsFull - vsCut >= 1.5,
      `vs ${f1(vsFull)} -> ${f1(vsCut)} m/s after 1.5 s of Ctrl from a full-lever climb`
    );
    r.ok('realistic: the lever is still a lever', !(ac().rotor && ac().rotor.kid) && vsFull > 6, `rotor.kid ${ac().rotor && ac().rotor.kid}, ${f1(vsFull)} m/s with Shift let go`);
    const realHover = async () => {
      await startHeli('realistic');
      // Up on the lever and back to a hover, the way a pilot would: Shift,
      // then Ctrl until the climb stops. The height hold takes it from there.
      hold(['Shift'], 2.2);
      run(1);
      hold(['Ctrl'], 1.2);
      run(4);
    };
    await realHover();
    const hdgR = ac().heading;
    let minPitch = 0;
    hold(['W'], 4, () => {
      minPitch = Math.min(minPitch, ro().pitch);
    });
    const pitchLetGo = ro().pitch;
    run(3);
    const pitch3 = ro().pitch;
    // Unmodified: -87 degrees and over on its back, heading 90 -> 270. The
    // first kid build: -43.5 peak, and let go it stayed at -34 and ran on to
    // 55 m/s.
    r.ok(
      'realistic: W held 4 s stays under 35 degrees, and let go it comes back under 20',
      minPitch > -35 && Math.abs(pitch3) < 20 && hdgDiff(ac().heading, hdgR) < 10 && !ac().crashed,
      `nose down to ${f1(minPitch)} deg, ${f1(pitchLetGo)} when W was let go, ${f1(pitch3)} 3 s later; heading moved ${f1(hdgDiff(ac().heading, hdgR))} deg`
    );
    /*
     * The same four seconds of W from the review of 30a4007's hover: full
     * lever to a steady climb, Ctrl for 2 s, then taps on the vertical speed
     * until it sits still — which leaves the lever near 90%, the height hold
     * taking off the rest. From there it came back to -14 and then sat at
     * -24.8 degrees at 51 m/s for a minute: the aeroplane's trim assist had
     * wound its trim to the stop, holding the nose down (see envTrimBleed in
     * rotor-assist.js).
     *
     * CORRECTION, measured 2026-09-26: the review's recipe leaves the lever
     * at 91% only in its weather (Free Flight's default, 4 kt from 090). In
     * this playtest's calm the same 300 taps leave it at 48%, and this check
     * read "lever 48%" and measured nothing new. So the lever is put there:
     * the pilot's hover, then Shift until it reads 90%. Measured that way on
     * b1d130b: W 4 s peaks at -31.4, -12.9 three seconds after letting go,
     * and -15.2 at 46 m/s a minute later, the lever at 90%.
     */
    await realHover();
    hold(['Shift'], 3, () => ac().controls.throttle >= 0.9 || ac().crashed);
    const leverHi = ac().controls.throttle;
    let minPitchHi = 0;
    hold(['W'], 4, () => {
      minPitchHi = Math.min(minPitchHi, ro().pitch);
    });
    run(3);
    const pitchHi3 = ro().pitch;
    let worstAfter = 0;
    run(27, () => {
      worstAfter = Math.max(worstAfter, Math.abs(ro().pitch));
    });
    r.ok(
      'realistic, lever high: W held 4 s stays under 35 degrees, and let go it comes back under 20 and stays there',
      leverHi >= 0.85 && minPitchHi > -35 && Math.abs(pitchHi3) < 20 && worstAfter < 20 && !ac().crashed,
      `lever ${Math.round(leverHi * 100)}%: nose down to ${f1(minPitchHi)} deg, ${f1(pitchHi3)} 3 s after letting go, worst ${f1(worstAfter)} over the next 27 s at ${f1(ac().groundSpeed)} m/s${ac().crashed ? ', CRASHED: ' + ac().crashReason : ''}`
    );
    await realHover();
    let maxBank = 0;
    hold(['A'], 4, () => {
      maxBank = Math.max(maxBank, Math.abs(ro().bank));
    });
    run(3);
    const bank3 = ro().bank;
    // Unmodified: 61 degrees of bank. The first kid build: 56.
    r.ok(
      'realistic: A held 4 s stays under 45 degrees of bank, and let go it comes back under 30',
      maxBank < 45 && Math.abs(bank3) < 30 && !ac().crashed,
      `max bank ${f1(maxBank)} deg, ${f1(bank3)} 3 s after letting go`
    );

    /* ============================================ and then an aeroplane */
    say('heli playtest: the aeroplane after it');
    await startHeli('easy');
    run(1);
    allUp();
    if (typeof sim.switchGame === 'function') sim.switchGame('flight');
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 0 });
    allUp();
    run(3);
    // Measured before the lift command gave the lever back: 50% and rolling.
    r.ok(
      'after the helicopter, the Skylark sits on the runway at 0% throttle',
      ac().controls.throttle < 0.02 && ac().groundSpeed < 0.5,
      `throttle ${Math.round(ac().controls.throttle * 100)}%, ${f1(ac().groundSpeed)} m/s`
    );
  } catch (e) {
    r.ok('heli playtest ran without throwing', false, (e && e.stack) || String(e));
  } finally {
    allUp();
    sim.speak = origSpeak;
    if (typeof sim.applyDifficulty === 'function') sim.applyDifficulty(origDiff);
    sim.autoPauseOnHide = origAutoPause;
    sim.renderer.render = origRender;
    sim._unlocking = origUnlocking;
  }
  return r;
}

export default check;
