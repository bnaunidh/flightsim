/**
 * HELI PLAYTEST — the Skyhook, flown the way a first-timer and a sim fan fly it.
 *
 * Not "is the flight model right". This presses the keys a player presses —
 * holds Shift and lets go, holds it far too long, holds W for ten seconds
 * and then a lot longer, spins on E, banks on A at speed, brakes on S, mashes
 * keys, holds Ctrl all the way to the ground, presses P and F to see what
 * they do — and asserts the numbers that decide whether the helicopter is a
 * game or a trap. Each detail string says what it measured.
 *
 * Every player flies the same helicopter: the collective lever on Shift and
 * Ctrl, the cyclic on W A S D, the pedals on Q and E. The stability assist
 * (rotor-assist.js) is on by default at every difficulty and F switches it
 * off: let go of the lever and it holds the height, let go of the stick and
 * it levels out and stops over the ground, and Ctrl held to the ground is a
 * soft landing. There used to be a separate easy-mode flight computer (a
 * spring-centred lift command, no autopilot, the engine key refused in the
 * air); it is gone, and the first section checks nothing on screen still
 * calls the game what it called that mode.
 *
 * The traps this was written against, measured on earlier builds:
 *   - the lever held four seconds stayed at 100% and the machine climbed at
 *     12 m/s to 228 m — the old height hold refused to capture above 3 m/s;
 *   - W held 4 s put the nose through -87 degrees and over on its back;
 *   - E let go ran on 13-35 degrees past where it was let go;
 *   - P handed the machine to the aeroplane autopilot, which climbed it from
 *     13 m to 222 m;
 *   - the Kestrel start put the Follow camera on the next block's roof;
 *   - the tower's subtitle covered the helicopter card;
 *   - hovering beside a building or the carrier's island the Follow lens sat
 *     behind the wall, the machine hidden (H2; the camera block below);
 *   - F, the assist key, also lowered the aeroplane's flaps a notch ("Flaps
 *     10°" beside "Stability assist off"; a 40 m/s cruise 1.4 m/s slower at
 *     full flap), and G retracted the skids;
 *   - one I in the air was an instant, unrecoverable crash (collective zero
 *     inside a second, -9 m/s; a restart takes 1.8 s and never caught it
 *     from 40 m), and on a phone the STOP pad next to the camera pad did the
 *     same in one tap at 30 ft;
 *   - Shift and W together from the pad went nose first into it ("The
 *     propeller struck the ground" at 0.5 m, -17 degrees), because the stick
 *     was full forward before the skids were light;
 *   - W and A held together for 15 s sank the machine with the assist on,
 *     the hold's lever pinned at 100% and the disc 46 degrees off the
 *     vertical: 31 m lost from 80 m, a crash from 25 m.
 *
 * Run it on its own from the console (or from node, see the hand-over):
 *
 *   const s = window.__sim; s.renderer.render = () => {};
 *   const r = { checks: [], ok(n, p, d = '') { this.checks.push({ n, p: !!p, d: String(d) }); return !!p; } };
 *   await (await import('/tests/features/heli-playtest.browser.js')).check(s, r, console.log);
 *   console.table(r.checks);
 *
 * It drives the game through keyboard events on window and sim.step(). The
 * exceptions are the ones a player does from a menu — the difficulty, the
 * Heli button, Free Flight, a mission card — putting the machine back on the
 * pad between sections so one section's crash is reported once, and placing
 * it beside a building, a stack and the carrier's island for the camera.
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
  // Not flying keys, but keys a player presses to see what they do.
  I: ['KeyI', 'i'],
  P: ['KeyP', 'p'],
  F: ['KeyF', 'f'],
  // The aeroplane's flaps-up and gear keys, which mean nothing on skids.
  V: ['KeyV', 'v'],
  G: ['KeyG', 'g'],
};

export async function check(sim, r, say = () => {}) {
  // The autopilot's key, as bound: it moved from P to Y on 2026-10-23 (P at
  // the stand called the pushback too; src/flight/input.js MIGRATIONS), and
  // this check kept pressing P, so the autopilot never engaged. Asked of the
  // bindings, not hard-coded, so it follows them (as instruments.browser.js).
  const apCode = ((await import('../../src/flight/input.js')).codesFor('autopilot', sim) || [])[0] || 'KeyY';
  KEYS.AP = [apCode, apCode.replace(/^Key/, '').toLowerCase()];
  const apName = apCode.replace(/^Key/, '');
  const press = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { code: KEYS[k][0], key: KEYS[k][1], bubbles: true }));
  const release = (k) => window.dispatchEvent(new KeyboardEvent('keyup', { code: KEYS[k][0], key: KEYS[k][1], bubbles: true }));
  const allUp = () => {
    for (const k in KEYS) release(k);
  };
  const ac = () => sim.aircraft;
  const ro = () => ac().readouts();
  const tilt = () => Math.max(Math.abs(ro().pitch), Math.abs(ro().bank));
  // What the card says: metres of air under the skids.
  const skidH = () => {
    const R = ac().rotor;
    if (R && Number.isFinite(R.heightAbove)) return R.heightAbove;
    return ac().pos.y - Math.max(0, ac().pos.y - ac().agl) - 1.69;
  };
  const hud = () => sim.hud || {};
  const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const card = () => text(hud().heliState);
  const chip = () => text(hud().assistChip);
  // The toasts on screen right now (hud.notify; they live 2-5 s of game time).
  const toasts = () => [...document.querySelectorAll('.hud-toast')].map(text);
  const hdgDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
  // The lever that holds a hover, on the lever's own 0-1 travel.
  const hoverLever = () => {
    const R = ac().rotor || {};
    return Number.isFinite(R.hoverPoint) ? (R.hoverPoint - 0.18) / 0.82 : NaN;
  };
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
  const tapKey = (k) => {
    press(k);
    run(DT);
    release(k);
    run(DT);
  };

  const origRender = sim.renderer.render;
  sim.renderer.render = () => {};
  const origAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const origDiff = (sim.settings && sim.settings.difficulty) || 'normal';
  const origAssist = sim.settings ? sim.settings.heliAssist : undefined;
  const origSpeak = sim.speak;
  // Headless Chrome never resolves AudioContext.resume() without a real
  // gesture, and startMode() waits for it. Skip the unlock if nobody has made
  // one; a real session with sound already running is not touched.
  const origUnlocking = sim._unlocking;
  if (sim.audio && !sim.audio.started) sim._unlocking = true;
  const origTouch = sim.input ? sim.input.touch : null;

  let PADS = [];
  let T = null;
  let THREE = null;
  try {
    PADS = (await import('../../src/world/pads.js')).PADS;
    T = await import('../../src/world/terrain.js');
    THREE = await import('../../src/vendor/three.module.js');
  } catch (e) {
    /* reported below as failed checks, not a thrown suite */
  }

  /** Free Flight in the helicopter, as the menu does it, on a calm day. */
  const startHeli = async (difficulty = 'normal', extra = {}) => {
    allUp();
    if (typeof sim.applyDifficulty === 'function') sim.applyDifficulty(difficulty);
    if (sim.settings) sim.settings.heliAssist = true;
    if (typeof sim.switchGame === 'function') sim.switchGame('heli');
    await sim.startMode('free', {
      aircraft: 'harrier', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 250, ...extra,
    });
    allUp();
    run(1);
  };
  /**
   * Up to about `h` metres: hold Shift, and let go early enough that the
   * height hold's own stop lands near it, the way a player learns to.
   */
  const liftTo = (h) => {
    hold(['Shift'], 20, () => {
      const vs = Math.max(0, ac().vs);
      return skidH() + (vs * vs) / 6 + vs * 0.3 > h || ac().crashed;
    });
    run(5);
  };
  /** Q or E until the nose points at `h`. */
  const face = (h) => {
    for (let i = 0; i < 24; i++) {
      const e = ((h - ac().heading + 540) % 360) - 180;
      if (Math.abs(e) < 4) return;
      hold([e > 0 ? 'E' : 'Q'], Math.min(0.6, Math.abs(e) / 45));
      run(1);
    }
  };
  /** Each section starts flying, from the pad again if the last one ended badly. */
  const flyingAt = async (h, difficulty = 'normal') => {
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
    await startHeli('normal');
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
    r.ok(
      'Free Flight in the helicopter starts on a helipad',
      !!nearest && nd <= nearest.r && a0.onGround,
      nearest ? `${f1(nd)} m from ${nearest.name} (r ${nearest.r}), on the ground ${a0.onGround}` : 'no pads'
    );
    const objText = text(hud().objective);
    const said = heard.join(' | ');
    r.ok(
      'the panel and the tower use helicopter words',
      !/runway 0?9/i.test(objText) && /shift/i.test(objText) && /collective/i.test(objText) && !/taxi and hold|cleared for take-off/i.test(said),
      `panel "${objText.slice(0, 120)}" · tower "${said.slice(0, 110) || 'nothing'}"`
    );
    // The easy-mode flight computer is gone: nothing a player can read says so.
    const screenText = `${document.body.innerText} ${chip()} ${card()} ${text(hud().heliSay)}`;
    r.ok(
      'the stability assist is on by default, says so, and nothing on screen says "kid"',
      a0.hoverAssist !== false && /ASSIST ON/.test(chip()) && !/\bkids?\b/i.test(screenText),
      `assist ${a0.hoverAssist !== false}, chip "${chip()}", "kid" on screen ${/\bkids?\b/i.test(screenText)}`
    );
    // Nor "EASY MODE": the aeroplane's mode chip sat beside HEIGHT HOLD and
    // read as the old easy-mode computer. The assist chip is the one switch.
    const modeChipShown = !!(hud().modeChip && !hud().modeChip.hidden && hud().modeChip.getBoundingClientRect().width > 0);
    r.ok('the helicopter shows no EASY MODE / REAL MODE chip', !modeChipShown, `mode chip ${modeChipShown ? `shown: "${text(hud().modeChip)}"` : 'hidden'}`);
    const hOnPad = text(hud().heliH);
    r.ok('on the pad the height reads 0', hOnPad === '0' && Math.abs(skidH()) < 0.3, `card "${hOnPad}" ft, skids ${f1(skidH())} m`);
    /*
     * What the player SEES first. Measured on an earlier build, this same
     * calm start: parked on the Cottage Hospital roof nose 157.5, the Follow
     * camera stood 0.9 m over the next town block's roof and a ray from it to
     * the machine met that roof 2.4 m out — the first frame was a grey slab.
     */
    let seen = 'no camera';
    try {
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
     * And the card, while the tower talks. Measured at 1280 x 800: the
     * tower's subtitle (bottom 118 px, up to 720 px wide) was printed over the
     * lower half of the card for the first seconds of every flight.
     */
    const box = (el) => (el && el.getBoundingClientRect ? el.getBoundingClientRect() : null);
    const cardEl = hud().heliCard;
    const subEl = hud().subtitle;
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
    // Every panel the helicopter shows is on the screen.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const offs = [];
    for (const [name, el] of [['card', hud().heliCard], ['hover strip', hud().rotorPanel], ['chip', hud().assistChip]]) {
      const b = box(el);
      if (!el || el.hidden || !b || !b.width) continue;
      if (b.left < -1 || b.top < -1 || b.right > vw + 1 || b.bottom > vh + 1) offs.push(`${name} ${Math.round(b.left)},${Math.round(b.top)}-${Math.round(b.right)},${Math.round(b.bottom)}`);
    }
    // The lever's row: COLLECTIVE ran 26 px into its own bar.
    const bar = hud().throttleBar && hud().throttleBar.root;
    const lab = bar && bar.querySelector('.hud-bar-label');
    const trk = bar && bar.querySelector('.hud-bar-track');
    if (lab && trk && !bar.hidden) {
      const range = document.createRange();
      range.selectNodeContents(lab);
      const textRight = range.getBoundingClientRect().right;
      const trackLeft = trk.getBoundingClientRect().left;
      if (textRight > trackLeft + 0.5) offs.push(`"${text(lab)}" runs ${Math.round(textRight - trackLeft)} px into its bar`);
    }
    r.ok('the helicopter panels fit on the screen, and the lever row reads cleanly', offs.length === 0, offs.join('; ') || `all inside ${vw}x${vh}`);

    /* ============================================================= lift */
    say('heli playtest: Shift, then let go');
    const h0 = skidH();
    hold(['Shift'], 8, () => skidH() > 4);
    const hRel = skidH();
    const vsRel = ac().vs;
    let peak = hRel;
    run(6, () => {
      peak = Math.max(peak, skidH());
    });
    let lo = Infinity;
    let hi = -Infinity;
    run(8, () => {
      lo = Math.min(lo, skidH());
      hi = Math.max(hi, skidH());
    });
    // A stop at 3 m/s^2 from whatever it is doing, plus the lever's lag.
    const stopAllow = (vsRel * vsRel) / 6 + vsRel * 0.5 + 2;
    r.ok(
      'Shift lifts it off, and letting go stops the climb and holds that height',
      h0 < 0.5 && hRel > 3.5 && peak - hRel < stopAllow && hi - lo < 0.75 && Math.abs(ac().vs) < 0.3 && !ac().crashed,
      `let go at ${f1(hRel)} m climbing ${f1(vsRel)} m/s, stopped at ${f1(peak)} m (allowed ${f1(hRel + stopAllow)}), then ${f1(lo)}-${f1(hi)} m over 8 s, vs ${f1(ac().vs)}`
    );
    r.ok('the panel says it is hovering while it hovers', /HOVER|HOLD/.test(card()) && /HEIGHT HOLD/.test(chip()), `card "${card()}", chip "${chip()}"`);
    // The lever follows the hold: the gauge shows where the hover is.
    const thr = ac().controls.throttle;
    r.ok(
      'in the hover the lever has come to the hover mark by itself',
      Math.abs(thr - hoverLever()) < 0.05,
      `lever ${thr.toFixed(3)}, hover lever ${f1(hoverLever())}`
    );

    /* ============================================== Shift held far too long */
    say('heli playtest: Shift held four seconds');
    await flyingAt(10);
    run(2);
    hold(['Shift'], 4);
    const hTop = skidH();
    const vsTop = ac().vs;
    const leverTop = ac().controls.throttle;
    let peakTop = hTop;
    run(10, () => {
      peakTop = Math.max(peakTop, skidH());
    });
    // An earlier build: the lever stayed at 100% and it climbed at 12 m/s to 228 m.
    r.ok(
      'with the lever run right up, letting go still stops the climb and holds',
      leverTop > 0.85 && vsTop > 5 && peakTop - hTop < 20 && Math.abs(ac().vs) < 0.3 && Math.abs(ac().controls.throttle - hoverLever()) < 0.06,
      `lever ${Math.round(leverTop * 100)}% climbing ${f1(vsTop)} m/s at ${f1(hTop)} m; stopped ${f1(peakTop - hTop)} m higher, vs ${f1(ac().vs)} 10 s later, lever back to ${Math.round(ac().controls.throttle * 100)}%`
    );

    /* ============================================================= ctrl */
    say('heli playtest: Ctrl');
    await flyingAt(18);
    run(2);
    let vsAt15 = 0;
    let tc = 0;
    hold(['Ctrl'], 2, () => {
      tc += DT;
      if (tc <= 1.501) vsAt15 = Math.min(vsAt15, ac().vs);
    });
    r.ok('Ctrl starts it down within a second and a half', vsAt15 <= -1.5, `${f1(vsAt15)} m/s within 1.5 s`);
    run(5);
    r.ok(
      'letting go of Ctrl holds the height again, clear of the ground',
      Math.abs(ac().vs) < 0.3 && skidH() > 3 && !ac().crashed,
      `vs ${f1(ac().vs)} m/s 5 s after, ${f1(skidH())} m up`
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
    // The winch missions blow 9 to 20 kt. A hover that only holds in a calm
    // is a hover that fails the first rescue.
    say('heli playtest: hands off in fifteen knots');
    await startHeli('normal', { windSpeedKts: 15, windDirDeg: 300 });
    liftTo(15);
    run(10);
    const pw = ac().pos.clone();
    let driftW = 0;
    let dyW = 0;
    run(30, () => {
      driftW = Math.max(driftW, Math.hypot(ac().pos.x - pw.x, ac().pos.z - pw.z));
      dyW = Math.max(dyW, Math.abs(ac().pos.y - pw.y));
    });
    r.ok(
      'in 15 kt of wind, hands off for 30 s, it stays within 3 m and 1.5 m of height',
      driftW < 3 && dyW < 1.5 && !ac().crashed && !ac().onGround,
      `${f1(driftW)} m and ${f1(dyW)} m of height in 30 s, ${f1(ac().groundSpeed)} m/s over the ground at the end${ac().crashed ? ', CRASHED: ' + ac().crashReason : ''}`
    );

    /*
     * Shuffling over a spot in that wind, the way a winch run is flown: taps
     * of D. Each must move it the way it was tapped, and it must hold where
     * it stops. Before the hover hold took the spot, and while every tap
     * bled the learned wind lean away, the missions' own pilot could not keep
     * a winch circle on Gannet Stack (18 kt) for 500 s.
     */
    say('heli playtest: taps in fifteen knots');
    const pt0 = ac().pos.clone();
    const hRad = (ac().heading * Math.PI) / 180;
    const rx = Math.cos(hRad);
    const rz = Math.sin(hRad);
    let backMost = 0;
    for (let i = 0; i < 6; i++) {
      hold(['D'], 0.27);
      run(2.2, () => {
        backMost = Math.min(backMost, (ac().pos.x - pt0.x) * rx + (ac().pos.z - pt0.z) * rz);
      });
    }
    run(6);
    const movedD = (ac().pos.x - pt0.x) * rx + (ac().pos.z - pt0.z) * rz;
    const pStop = ac().pos.clone();
    let wander = 0;
    run(10, () => {
      wander = Math.max(wander, Math.hypot(ac().pos.x - pStop.x, ac().pos.z - pStop.z));
    });
    r.ok(
      'in 15 kt, six taps of D move it right, never back, and it holds where it stops',
      movedD > 1 && backMost > -0.5 && wander < 1 && ac().groundSpeed < 0.3 && !ac().crashed,
      `${f1(movedD)} m to the right, at most ${f1(-backMost)} m back; 6 s after the last tap, within ${f1(wander)} m for 10 s, ${f1(ac().groundSpeed)} m/s at the end`
    );

    /*
     * And straight into a stronger wind, tapping at once, the way a player
     * arrives over a deck and starts lining up: no four seconds hands off
     * first for the wind lean to be learned. Before the assist felt the wind
     * (rotor-assist.js windLean) every tap sagged back downwind by the same
     * few metres, and the missions' pilot sat 7 m off Night Deck's rig in
     * 20 kt for ten minutes, tapping towards it.
     */
    say('heli playtest: taps into twenty knots, straight away');
    await startHeli('normal', { windSpeedKts: 20, windDirDeg: 270 });
    liftTo(15);
    face(270);
    run(1.5);
    const pu0 = ac().pos.clone();
    for (let i = 0; i < 6; i++) {
      hold(['W'], 0.3);
      run(2);
    }
    run(4);
    // Upwind is west, -x.
    const upwind = pu0.x - ac().pos.x;
    r.ok(
      'in 20 kt, six taps of W into the wind straight after lifting move it upwind',
      upwind > 3 && !ac().crashed,
      `${f1(upwind)} m upwind after six 0.3 s taps, ${f1(ac().groundSpeed)} m/s at the end`
    );

    /* ======================================================== W, and on */
    /*
     * East from the Kestrel start: over the town and out to sea. W held
     * tilts the nose down to the envelope (15-30 degrees) and the height
     * hold keeps it at its height while it goes.
     */
    say('heli playtest: W for ten seconds, then a lot longer');
    await startHeli('normal');
    liftTo(45);
    face(90);
    run(3);
    const hdgW = ac().heading;
    const yW = ac().pos.y;
    let maxTiltW = 0;
    let dyWmax = 0;
    press('W');
    run(10, () => {
      maxTiltW = Math.max(maxTiltW, tilt());
      dyWmax = Math.max(dyWmax, Math.abs(ac().pos.y - yW));
    });
    const gs10 = ac().groundSpeed;
    // The cruise strip at this speed: its first row's label is the
    // helicopter's own word, and it must not run into the number beside it
    // (GROUNDSPEED did, on every cruise screenshot).
    {
      const sv = hud().speedValue;
      const row = sv && sv.parentElement && sv.parentElement.parentElement;
      const lab = row && row.querySelector('.hud-label');
      let clash = 'no cruise strip';
      if (lab && sv) {
        const range = document.createRange();
        range.selectNodeContents(lab);
        const lr = range.getBoundingClientRect();
        const vr = sv.getBoundingClientRect();
        const ox = Math.min(lr.right, vr.right) - Math.max(lr.left, vr.left);
        const oy = Math.min(lr.bottom, vr.bottom) - Math.max(lr.top, vr.top);
        clash = ox > 0.5 && oy > 0.5 ? `"${text(lab)}" overlaps "${text(sv)}" by ${Math.round(ox)}x${Math.round(oy)} px` : '';
        r.ok('in the cruise the speed row reads cleanly', !clash, clash || `"${text(lab)}" beside "${text(sv)}"`);
      } else r.ok('in the cruise the speed row reads cleanly', false, clash);
    }
    // Unmodified: -87 degrees, over on its back, heading 90 -> 270.
    r.ok(
      'holding W for 10 s flies forwards at its height, nose down no more than 32 degrees',
      maxTiltW <= 32 && gs10 > 25 && dyWmax < 6 && hdgDiff(ac().heading, hdgW) < 5 && !ac().crashed,
      `max tilt ${f1(maxTiltW)} deg, ${f1(gs10)} m/s at 10 s, height within ${f1(dyWmax)} m, heading moved ${f1(hdgDiff(ac().heading, hdgW))} deg`
    );
    run(35, () => {
      maxTiltW = Math.max(maxTiltW, tilt());
    });
    release('W');
    const top = ac().groundSpeed;
    r.ok(
      'held on, it tops out at a sensible 55 to 75 m/s',
      top > 55 && top < 75 && maxTiltW <= 32 && !ac().crashed,
      `${f1(top)} m/s after 45 s of W, max tilt ${f1(maxTiltW)} deg${ac().crashed ? ', CRASHED: ' + ac().crashReason : ''}`
    );
    let levelT = -1;
    let stopT = -1;
    let t = 0;
    const yLetGo = ac().pos.y;
    let dyCoast = 0;
    run(70, () => {
      t += DT;
      dyCoast = Math.max(dyCoast, Math.abs(ac().pos.y - yLetGo));
      if (levelT < 0 && tilt() < 5) levelT = t;
      if (stopT < 0 && ac().groundSpeed < 1.5 && tilt() < 5) stopT = t;
      return (stopT >= 0 && t > stopT + 1) || ac().crashed;
    });
    r.ok(
      'letting go levels it within 4 s and brings it to a hover, holding its height',
      levelT >= 0 && levelT <= 4 && stopT >= 0 && stopT <= 70 && dyCoast < 6 && !ac().crashed,
      `level after ${f1(levelT)} s, under 1.5 m/s after ${f1(stopT)} s from ${f1(top)} m/s, height within ${f1(dyCoast)} m${ac().crashed ? ', CRASHED: ' + ac().crashReason : ''}`
    );

    /* =========================================================== braking */
    say('heli playtest: S brakes');
    await startHeli('normal');
    liftTo(45);
    face(90);
    hold(['W'], 8);
    const gsB = ac().groundSpeed;
    hold(['S'], 4);
    run(1);
    r.ok(
      'S brakes hard: at least 15 m/s off in 4 s, and no crash',
      gsB - ac().groundSpeed >= 15 && !ac().crashed,
      `${f1(gsB)} -> ${f1(ac().groundSpeed)} m/s${ac().crashed ? ', CRASHED: ' + ac().crashReason : ''}`
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
    r.ok('E turns it right round on the spot in under 10 s', turned >= 360 && turnT <= 10, `${f1(turned)} deg in ${f1(turnT)} s`);
    // The airframe alone ran on 35 degrees; with the pedals a rate, about 10.
    r.ok('and it stops within 12 degrees of where E was let go', ranOn < 12, `ran on ${f1(ranOn)} deg`);

    /* ============================================================== bank */
    say('heli playtest: A at speed');
    await startHeli('normal');
    liftTo(45);
    face(90);
    hold(['W'], 6);
    let maxBank = 0;
    let turnedA = 0;
    let lastA = ac().heading;
    hold(['A'], 4, () => {
      maxBank = Math.max(maxBank, Math.abs(ro().bank));
      turnedA += ((ac().heading - lastA + 540) % 360) - 180;
      lastA = ac().heading;
    });
    run(3);
    const bank3 = ro().bank;
    r.ok(
      'A at speed banks and turns it, no further than 43 degrees, and let go it levels within 3 s',
      maxBank < 43 && turnedA < -20 && Math.abs(bank3) < 5 && !ac().crashed,
      `max bank ${f1(maxBank)} deg, turned ${f1(turnedA)} deg in 4 s, ${f1(bank3)} deg 3 s after letting go`
    );

    /*
     * And E at speed is a turn too, not a skid: the key hint says "Q and E
     * turn". Before, E held 6 s at 45 m/s turned the nose 28 degrees and the
     * flight path 1 — she flew on sideways.
     */
    say('heli playtest: E at speed');
    await startHeli('normal');
    liftTo(45);
    face(90);
    hold(['W'], 6);
    const track = () => (Math.atan2(ac().vel.x, -ac().vel.z) * 180) / Math.PI;
    const trk0 = track();
    const gsE = ac().groundSpeed;
    hold(['E'], 5);
    const trackE = ((track() - trk0 + 540) % 360) - 180;
    run(4);
    r.ok(
      'E at speed turns the flight path, not just the nose, and let go it levels',
      trackE > 15 && Math.abs(ro().bank) < 6 && !ac().crashed,
      `from ${f1(gsE)} m/s, E 5 s turned the track ${f1(trackE)} deg; bank ${f1(ro().bank)} deg 4 s after letting go`
    );

    /* ====================================================== W and A held */
    /*
     * The way a first-timer curves while moving: W, then W and A together,
     * held. Measured before the power margin (rotor-assist.js): from 25 m,
     * W 8 s then W+D 6 s then W+A 10 s ended "The propeller struck the
     * ground"; from 80 m, 31 m lost in 21 s with the hold's lever pinned at
     * 100% and the panel saying it held the height. The turn checks above
     * hold the keys 4 to 5 s and could not see it.
     */
    say('heli playtest: W and A held together for fifteen seconds');
    await startHeli('normal');
    liftTo(40);
    face(90);
    hold(['W'], 8);
    const yWA = ac().pos.y;
    let lostWA = 0;
    let bankWA = 0;
    let turnedWA = 0;
    let lastWA = ac().heading;
    // The trap itself: the collective pinned at the top while the machine
    // sinks. (The hold may use full lever for a moment climbing over ground
    // ahead; that is not it.)
    let pinnedWA = 0;
    hold(['W', 'A'], 15, () => {
      lostWA = Math.max(lostWA, yWA - ac().pos.y);
      bankWA = Math.max(bankWA, Math.abs(ro().bank));
      turnedWA += ((ac().heading - lastWA + 540) % 360) - 180;
      lastWA = ac().heading;
      const R = ac().rotor || {};
      if ((Number.isFinite(R.collective) ? R.collective : 0) >= 0.97 && ac().vs < -0.5) pinnedWA += DT;
    });
    r.ok(
      'W and A held together for 15 s at 40 m turns it and keeps its height: under 3 m lost, never sinking on a pinned lever, no crash',
      !ac().crashed && lostWA < 3 && pinnedWA < 0.5 && Math.abs(turnedWA) > 30 && bankWA > 15,
      `${ac().crashed ? 'CRASHED: ' + ac().crashReason + '; ' : ''}lost ${f1(lostWA)} m, ${f1(pinnedWA)} s sinking on a pinned lever, turned ${f1(turnedWA)} deg, bank up to ${f1(bankWA)} deg, ${f1(ac().groundSpeed)} m/s at the end`
    );

    /* ============================================ Shift and W together */
    /*
     * "Power and go" from the pad, the aeroplane player's first move.
     * Measured before the ground stop (rotor-assist.js): Shift and W held
     * together, "The propeller struck the ground" at 0.5 m, nose 17 degrees
     * down; W half a second after Shift the same; Shift and S, the tail.
     * v61's computer capped the tilt at 18 degrees and it lifted off.
     */
    say('heli playtest: Shift and W together from the pad');
    await startHeli('normal');
    let noseSW = 0;
    let topSW = 0;
    let gsSW = 0;
    const watchSW = () => {
      noseSW = Math.min(noseSW, ro().pitch);
      topSW = Math.max(topSW, skidH());
      gsSW = Math.max(gsSW, ac().groundSpeed);
    };
    // Shift and W for three seconds, then W on its own for three more: off
    // the pad and away, the way it is meant to go.
    hold(['Shift', 'W'], 3, watchSW);
    hold(['W'], 3, watchSW);
    run(1, watchSW);
    r.ok(
      'Shift and W together from the pad lift off without a strike and fly forward',
      !ac().crashed && topSW > 5 && gsSW > 12,
      `${ac().crashed ? 'CRASHED: ' + ac().crashReason + '; ' : ''}${f1(topSW)} m up, up to ${f1(gsSW)} m/s, nose at worst ${f1(noseSW)} deg`
    );
    await startHeli('normal');
    hold(['Shift'], 0.5);
    noseSW = 0;
    topSW = 0;
    gsSW = 0;
    hold(['Shift', 'W'], 2.5, watchSW);
    hold(['W'], 3, watchSW);
    run(1, watchSW);
    r.ok(
      'W half a second after Shift lifts off without a strike too',
      !ac().crashed && topSW > 5 && gsSW > 12,
      `${ac().crashed ? 'CRASHED: ' + ac().crashReason + '; ' : ''}${f1(topSW)} m up, up to ${f1(gsSW)} m/s, nose at worst ${f1(noseSW)} deg`
    );
    await startHeli('normal');
    hold(['Shift', 'S'], 3);
    run(2);
    r.ok('Shift and S together from the pad lift off without the tail striking', !ac().crashed && skidH() > 3, `${ac().crashed ? 'CRASHED: ' + ac().crashReason : `${f1(skidH())} m up`}`);

    /* ============================================================== mash */
    say('heli playtest: mashing the keys');
    const combos = [['W', 'A'], ['S', 'D'], ['W', 'S', 'A', 'D'], ['S', 'A', 'Q', 'Shift'], ['W', 'D', 'E'], ['A', 'E', 'Shift']];
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
      'no bunch of keys tips it past 48 degrees (the envelope’s 40 of bank and its stop) or crashes it',
      worst <= 48 && !crashedOn,
      `worst ${f1(worst)} deg on ${worstKeys}${crashedOn ? ' — CRASHED on ' + crashedOn : ''}`
    );

    /* =========================================================== landing */
    say('heli playtest: Ctrl all the way down');
    await startHeli('normal');
    liftTo(20);
    let lightSeen = false;
    let vsLastM = 0;
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
      if (h < 1 && !ac().onGround) vsLastM = Math.min(vsLastM, ac().vs);
      return ac().onGround || ac().crashed;
    });
    run(1);
    const td = ac().lastTouchdown;
    r.ok(
      'holding Ctrl lands it: no faster than 1.8 m/s in the last metre (the assist’s profile allows 1.7), touchdown under 200 ft/min',
      landed && !ac().crashed && vsLastM >= -1.8 && td && Math.abs(td.vsFpm) < 200,
      td
        ? `${f1(vsLastM)} m/s in the last metre, ${td.vsFpm} ft/min, ${td.quality}`
        : `no touchdown; crashed ${ac().crashed} ${ac().crashReason || ''}`
    );
    // Graded as a helicopter landing on an H: a 90 ft/min vertical touchdown
    // once scored 33/100 "not on the runway".
    r.ok(
      'the touchdown is scored as a landing on the H',
      !!td && !td.crashed && td.onRunway && td.score >= 80,
      td ? `${td.score}/100, on an H ${td.onRunway}, ${td.centreline} m from its middle` : 'no touchdown'
    );
    r.ok(
      'doing what it says, the landing light never goes red on the way down',
      lightSeen && !lightLog.some((s) => s.startsWith('red')),
      lightLog.join(' > ') || 'never lit'
    );
    run(3);
    r.ok(
      'and it stays down when Ctrl is let go, the lever at the bottom',
      ac().onGround && !ac().crashed && ac().controls.throttle < 0.05,
      `on the ground ${ac().onGround}, lever ${Math.round(ac().controls.throttle * 100)}%`
    );

    /* ============================================================== gate */
    /*
     * W and Ctrl together, flying at an H: "go there and come down". Measured
     * in the node harness before the guard: into the runway nose first at
     * 56 m/s. Over the runway, so whatever happens it happens over land.
     */
    say('heli playtest: W and Ctrl together');
    await startHeli('normal');
    {
      const RS = (await import('../../src/game/missions.js')).RUNWAY_START;
      const x = RS.pos.x - 300;
      const z = RS.pos.z;
      ac().reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: 90, altAGL: 30 + 1.7, engineOn: true });
      sim.input.throttleTarget = hoverLever();
      sim.input.out.throttle = sim.input.throttleTarget;
      sim.rig.setMode('chase');
      run(3);
    }
    press('W');
    run(3);
    let lowestG = Infinity;
    let gateWords = '';
    press('Ctrl');
    run(8, () => {
      if (!ac().onGround) lowestG = Math.min(lowestG, skidH());
      if (/SLOW DOWN/.test(card())) gateWords = `${card()}: ${text(hud().heliSay)}`;
      return ac().crashed;
    });
    const gsGate = ac().groundSpeed;
    release('W');
    hold(['S'], 3);
    const downGate = run(60, () => ac().onGround || ac().crashed);
    release('Ctrl');
    run(1);
    r.ok(
      'W and Ctrl together keep it off the ground at speed and say why; slowing down lands it',
      !ac().crashed && lowestG >= 2 && !!gateWords && downGate && ac().onGround,
      `lowest ${f1(lowestG)} m at up to ${f1(gsGate)} m/s, card "${gateWords}", then ${ac().crashed ? 'CRASHED: ' + ac().crashReason : ac().onGround ? 'landed' : 'not down'}`
    );

    /* ======================================================= from high */
    say('heli playtest: Ctrl from 150 m');
    await startHeli('normal');
    hold(['Shift'], 40, () => skidH() > 130 || ac().crashed);
    run(8);
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
      'Ctrl from 150 m lands inside 45 s, no faster than 9.5 m/s, and gently',
      downHigh && !ac().crashed && hHigh > 135 && tDown <= 45 && vsFast >= -9.5 && tdH && Math.abs(tdH.vsFpm) < 200,
      `from ${f1(hHigh)} m: ${f1(tDown)} s, fastest ${f1(vsFast)} m/s, ${tdH ? `${tdH.vsFpm} ft/min ${tdH.quality}` : ac().crashed ? 'CRASHED: ' + ac().crashReason : 'not down'}`
    );

    /*
     * Ctrl held at a deck's edge, in Night Deck's own 20 kt. Measured before:
     * the missions' pilot with the middle 3 m past Ironhead Foxtrot's edge
     * set her down on the deck-side skids, she tipped, "The propeller struck
     * the ground"; in the node harness a wing tip 0.1 m past the edge sank
     * her 16 m beside the deck until the drift put the tip under it. Now,
     * anywhere from on the edge to 4 m past it: no crash, and the card says
     * CAN'T LAND HERE when it holds her up.
     */
    say('heli playtest: Ctrl at a deck edge');
    const edgeRuns = [];
    if (typeof sim.startAnyMission === 'function' && THREE) {
      allUp();
      if (typeof sim.switchGame === 'function') sim.switchGame('heli');
      await sim.startAnyMission('nightdeck');
      run(1);
      const deckPads = (await import('../../src/world/pads.js')).PADS.filter((p) => /Foxtrot/.test(p.name));
      const deck = deckPads[0];
      const plat = deck && T.platformAt(deck.pos.x, deck.pos.z);
      for (const [past, hdg] of (plat ? [[0, 0], [1, 90], [2.5, 0], [4, 180]] : [])) {
        const x = plat.cx + plat.hw + past;
        const z = plat.cz;
        ac().reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: hdg, altAGL: plat.y + 20 - Math.min(0, T.heightAt(x, z)), engineOn: true });
        if (sim.input) {
          sim.input.throttleTarget = 0.4;
          if (sim.input.out) sim.input.out.throttle = 0.4;
        }
        run(5);
        let refused = false;
        hold(['Ctrl'], 30, () => {
          if (/CAN.T LAND/.test(card())) refused = true;
          return ac().crashed || ac().onGround;
        });
        run(2);
        edgeRuns.push({ past, crashed: ac().crashed ? ac().crashReason : '', onGround: ac().onGround, refused, onDeck: ac().onGround && !!T.platformAt(ac().pos.x, ac().pos.z) });
        if (ac().crashed) break;
      }
      if (typeof sim.quitToMenu === 'function') sim.quitToMenu();
    }
    r.ok(
      'Ctrl held at a deck edge in 20 kt never crashes: she lands on the deck or holds and says CAN’T LAND HERE',
      edgeRuns.length === 4 && edgeRuns.every((e) => !e.crashed && (e.onDeck || (!e.onGround && e.refused))),
      edgeRuns.map((e) => `${e.past} m past: ${e.crashed ? 'CRASHED ' + e.crashed : e.onDeck ? 'on the deck' : e.onGround ? 'down off the deck' : 'held'}${e.refused ? ' (card said so)' : ''}`).join('; ') || 'no deck found'
    );

    /* ===================================================== the engine key */
    say('heli playtest: I on the pad');
    await startHeli('normal');
    tapKey('I');
    run(1);
    const offCard = card();
    const offSay = text(hud().heliSay);
    tapKey('I');
    run(2);
    r.ok(
      'I on the pad stops the engine, the card says how to start it, and I starts it again',
      /ENGINE OFF/.test(offCard) && /\bI\b/.test(offSay) && ac().engineOn,
      `card "${offCard}" "${offSay}", engine ${ac().engineOn ? 'on' : 'off'} after the second I`
    );
    // The pad route (ui/touch.js → hudAction('starter')) on the ground: one
    // tap stops it, one tap starts it, the same as the key.
    run(1);
    sim.hudAction('starter');
    run(0.5);
    const padStopped = !ac().engineOn;
    sim.hudAction('starter');
    run(2.4);
    r.ok(
      'the engine pad on the ground: STOP stops it and START starts it again',
      padStopped && ac().engineOn,
      `engine ${padStopped ? 'off' : 'STILL ON'} after the tap, ${ac().engineOn ? 'on' : 'OFF'} 2.4 s after the second`
    );

    /*
     * In the air it asks twice. Measured on an earlier build at 40 m: one I
     * had the collective at zero inside a second and the machine at -9 m/s,
     * and I again did not save it (a restart takes 1.8 s; 0.3 s, 1 s and
     * 2 s later from 40 m, and 1 s later from 15 m, all ended "You came down
     * far too fast"). On a phone the STOP pad sits beside the camera pad,
     * and one tap at 30 ft was -18.7 m/s at the ground. Now: the key asks,
     * the pad is greyed out and says why, and the ground is as it was.
     */
    say('heli playtest: I in the air asks twice; the STOP pad is greyed out');
    await flyingAt(40);
    run(2);
    const yAsk = ac().pos.y;
    tapKey('I');
    const askToast = toasts().find((t) => /again/i.test(t)) || '';
    const onAfterOne = ac().engineOn;
    run(4); // the 3 s window lapses
    const heldHeight = Math.abs(ac().pos.y - yAsk) < 3;
    tapKey('I');
    const onAfterLapsed = ac().engineOn;
    run(0.5);
    tapKey('I'); // within 3 s of the last one: this is the second press
    run(0.3);
    const offAfterTwo = !ac().engineOn;
    r.ok(
      'I in the air asks first: one press leaves the engine running and says so, after 4 s a single press still does, and a second press within 3 s shuts it down',
      onAfterOne && /again/i.test(askToast) && heldHeight && onAfterLapsed && offAfterTwo && !ac().crashed,
      `engine ${onAfterOne ? 'on' : 'OFF'} after one I (toast "${askToast}"), ${heldHeight ? 'height held' : 'height NOT held'} through the lapse, ${onAfterLapsed ? 'on' : 'OFF'} after a press 4 s later, ${offAfterTwo ? 'off' : 'STILL ON'} after a second within 3 s`
    );
    // Back on the pad and up again (the machine above has no engine).
    await startHeli('normal');
    liftTo(40);
    run(2);
    const padStart = ac().engineOn && !ac().onGround;
    sim.hudAction('starter');
    const padToast = toasts().find((t) => /land/i.test(t)) || '';
    run(0.5);
    sim.hudAction('starter');
    run(0.5);
    // The pad's look: greyed out in the air. The real pad on a touch device
    // (heli-touch.playtest.mjs presses it with a finger); on a desktop run,
    // one made the same way, through the stylesheet.
    let enginePad = sim.touch && sim.touch.enginePad;
    let padProbe2 = null;
    if (!enginePad) {
      padProbe2 = document.createElement('button');
      padProbe2.className = 'touch-pad is-on is-off';
      padProbe2.textContent = 'STOP';
      document.body.appendChild(padProbe2);
      enginePad = padProbe2;
    }
    const padOpacity = parseFloat(getComputedStyle(enginePad).opacity);
    const padOff = enginePad.classList.contains('is-off');
    if (padProbe2) padProbe2.remove();
    r.ok(
      'the STOP pad in the air is greyed out, and two taps on it leave the engine running with a word about landing first',
      padStart && ac().engineOn && /land/i.test(padToast) && padOff && padOpacity < 0.7 && !ac().crashed,
      `engine ${ac().engineOn ? 'on' : 'OFF'} after two taps at ${f1(skidH())} m, toast "${padToast}", pad ${padOff ? 'is-off' : 'NOT is-off'} at opacity ${padOpacity}${padProbe2 ? ' (stylesheet probe)' : ''}`
    );

    /* ========================================================= autopilot */
    /*
     * P, as for the aeroplanes. Measured on an earlier build: the aeroplane
     * autopilot took a 13 m hover forward at 25 m/s and up at 4.5 m/s to
     * 222 m in 40 s. On a helicopter it holds what it has.
     */
    say(`heli playtest: ${apName} in the hover, then at speed`);
    await flyingAt(13);
    run(2);
    const pP = ac().pos.clone();
    tapKey('AP');
    const apCard = card();
    let farP = 0;
    let highP = 0;
    run(20, () => {
      farP = Math.max(farP, Math.hypot(ac().pos.x - pP.x, ac().pos.z - pP.z));
      highP = Math.max(highP, Math.abs(ac().pos.y - pP.y));
    });
    r.ok(
      `${apName} in the hover engages the autopilot, which holds the hover where it was`,
      !!(sim.autopilot && sim.autopilot.engaged) && /AUTOPILOT/.test(apCard) && farP < 3 && highP < 1.5 && !ac().crashed,
      `autopilot ${sim.autopilot && sim.autopilot.engaged ? 'engaged' : 'OFF'}, card "${apCard}", ${f1(farP)} m and ${f1(highP)} m of height in 20 s`
    );
    hold(['W'], 0.4);
    r.ok('moving the stick hands it straight back', !(sim.autopilot && sim.autopilot.engaged), `autopilot ${sim.autopilot && sim.autopilot.engaged ? 'still on' : 'off'}`);
    run(4);
    await startHeli('normal');
    liftTo(50);
    face(90);
    hold(['W'], 6);
    run(0.5);
    tapKey('AP');
    const yAp = ac().pos.y;
    const hAp = ac().heading;
    const gsAp = ac().groundSpeed;
    let dyAp = 0;
    let dhAp = 0;
    run(20, () => {
      dyAp = Math.max(dyAp, Math.abs(ac().pos.y - yAp));
      dhAp = Math.max(dhAp, hdgDiff(ac().heading, hAp));
    });
    r.ok(
      `${apName} at speed holds the height and the heading and keeps going`,
      !!(sim.autopilot && sim.autopilot.engaged) && dyAp < 6 && dhAp < 5 && ac().groundSpeed > 15 && !ac().crashed,
      `engaged at ${f1(gsAp)} m/s; 20 s: height within ${f1(dyAp)} m, heading within ${f1(dhAp)} deg, ${f1(ac().groundSpeed)} m/s, "${sim.autopilot && sim.autopilot.status(null)}"`
    );
    hold(['Shift'], 0.4);
    r.ok('and a hand on the lever takes it back too', !(sim.autopilot && sim.autopilot.engaged), `autopilot ${sim.autopilot && sim.autopilot.engaged ? 'still on' : 'off'}`);

    /* ======================================================== F: assist */
    say('heli playtest: F switches the assist off and on');
    await flyingAt(25);
    run(3);
    tapKey('F');
    const offChip = chip();
    const offCard2 = card();
    const assistWas = ac().hoverAssist;
    const toastsF1 = toasts();
    const flapsF1 = ac().flapStep();
    // The raw machine: a lever 6% over the hover climbs and goes on climbing.
    sim.input.throttleTarget = hoverLever() + 0.06;
    const yRaw = ac().pos.y;
    run(10);
    const climbedRaw = ac().pos.y - yRaw;
    r.ok(
      'F switches it off: the panel says so, and the lever is all yours',
      assistWas === false && /ASSIST OFF/.test(offChip) && /ASSIST OFF/.test(offCard2) && climbedRaw > 5 && sim.settings.heliAssist === false,
      `assist ${assistWas}, chip "${offChip}", card "${offCard2}", ${f1(climbedRaw)} m of climb in 10 s with the lever 6% over the hover`
    );
    tapKey('F');
    const toastsF2 = toasts();
    const flapsF2 = ac().flapStep();
    run(8);
    r.ok(
      'F again and it catches the height and holds it',
      ac().hoverAssist !== false && Math.abs(ac().vs) < 0.3 && /ASSIST ON|HEIGHT HOLD/.test(chip()) && !ac().crashed,
      `assist ${ac().hoverAssist}, vs ${f1(ac().vs)} m/s 8 s later, chip "${chip()}"`
    );
    /*
     * F is the aeroplane's flaps key too (input.js binds KeyF to flapsDown in
     * the 'plane' context and to heliAssist in 'heli'), and main.js read
     * codes, not contexts: measured, the two F taps above also showed "Flaps
     * 10° — more lift, more drag" and "Flaps 20°", flapStep() went 1 then 2
     * and stayed, and a 40 m/s cruise settled 1.4 m/s slower at full flap.
     * G retracted the skids, which made the next touchdown "You landed with
     * the wheels up". None of it, now: nothing moves and nothing is said.
     */
    const flapToasts = [...toastsF1, ...toastsF2].filter((t) => /flaps/i.test(t));
    tapKey('V');
    const toastsV = toasts();
    tapKey('G');
    const toastsG = toasts();
    const wingToasts = [...toastsV, ...toastsG].filter((t) => /flaps|landing gear/i.test(t));
    r.ok(
      'F, V and G move no flaps and no gear in the helicopter, and no flaps or gear toast appears',
      flapsF1 === 0 && flapsF2 === 0 && ac().flapStep() === 0 && ac().gearDown && flapToasts.length === 0 && wingToasts.length === 0,
      `flaps ${flapsF1} and ${flapsF2} after the two F, ${ac().flapStep()} after V, gear ${ac().gearDown ? 'down' : 'UP'} after G; flaps/gear toasts ${JSON.stringify([...flapToasts, ...wingToasts])}`
    );

    /* ============================================================ touch */
    /*
     * The touch lever. A thumb on the slider is a hand on the lever; lifted,
     * the hold takes over. Driven through the same state the on-screen
     * slider writes (ui/touch.js), so a desktop run checks it too.
     */
    say('heli playtest: the touch lever');
    await flyingAt(20);
    run(2);
    const touchState = { pitch: 0, roll: 0, yaw: 0, throttle: null, lever: null, brakes: false, stickHeld: false, rudderHeld: false, dragging: false };
    const hadTouch = !!sim.input.touch;
    if (!hadTouch) sim.input.touch = touchState;
    const ts = sim.input.touch;
    const yT = ac().pos.y;
    ts.dragging = true;
    ts.throttle = Math.min(1, hoverLever() + 0.25);
    run(3);
    // And the card talks about the lever, not about keys a tablet has not got.
    const wrapEl = hud().wrap;
    const wasTouch = !!(wrapEl && wrapEl.classList.contains('is-touch'));
    if (wrapEl) wrapEl.classList.add('is-touch');
    run(DT);
    const touchSay = text(hud().heliSay);
    // Nothing of the free-play extras on top of the hover strip or the card:
    // the Races button sat on the strip's WIND row and the smoke button on
    // the card's HOVERING, on an iPad and on a phone (measured at 1024 x 768
    // and 390 x 844). The smoke button places itself once a second.
    run(1.2);
    const boxOf = (sel) => {
      const e = document.querySelector(sel);
      if (!e || e.hidden) return null;
      const b = e.getBoundingClientRect();
      return b.width > 2 && b.height > 2 && getComputedStyle(e).display !== 'none' ? b : null;
    };
    // ...and not on each other: with the Races button moved to the left under
    // the map, the smoke button placed itself on top of it (an emulated
    // 1024 x 768 iPad, 2,400 px²), because the button is not in the HUD's
    // own tree and the chip only looked there.
    const overlapsOf = [];
    for (const [a, b] of [['.race-solobar', '.hud-rotor'], ['.race-solobar', '.hud-heli'], ['.fun-chip', '.hud-rotor'], ['.fun-chip', '.hud-heli'], ['.fun-chip', '.race-solobar']]) {
      const A = boxOf(a);
      const B = boxOf(b);
      if (!A || !B) continue;
      const ox = Math.min(A.right, B.right) - Math.max(A.left, B.left);
      const oy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
      if (ox > 2 && oy > 2) overlapsOf.push(`${a} over ${b} ${Math.round(ox)}x${Math.round(oy)}`);
    }
    r.ok(
      'on a touch screen the Races and smoke buttons stay off the hover strip, the card and each other',
      overlapsOf.length === 0,
      overlapsOf.join('; ') || `clear (${['.race-solobar', '.fun-chip', '.hud-rotor', '.hud-heli'].map((q) => `${q} ${boxOf(q) ? 'shown' : 'not shown'}`).join(', ')})`
    );
    if (wrapEl && !wasTouch) wrapEl.classList.remove('is-touch');
    run(DT);
    r.ok('on a touch screen the card says lever, not Shift', /lever/i.test(touchSay) && !/\b(Shift|Ctrl)\b/.test(touchSay), `"${touchSay}"`);
    // And none of the aeroplane's pads (BRAKES, GEAR, FLAPS): on a phone they
    // were three dead buttons beside the lever. The real pads on a touch
    // device; on a desktop run, one made the same way, through the stylesheet.
    let wingPads = sim.touch && sim.touch.layer ? [...sim.touch.layer.querySelectorAll('.touch-pad.is-wing')] : [];
    let padProbe = null;
    if (!wingPads.length && wrapEl) {
      padProbe = document.createElement('button');
      padProbe.className = 'touch-pad is-wing';
      padProbe.textContent = 'GEAR';
      wrapEl.appendChild(padProbe);
      wingPads = [padProbe];
    }
    const padsShown = wingPads.filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.textContent);
    if (padProbe) padProbe.remove();
    r.ok(
      'on a touch screen the helicopter shows no BRAKES, GEAR or FLAPS pad',
      wingPads.length > 0 && padsShown.length === 0 && !!wrapEl && wrapEl.classList.contains('is-rotor'),
      `${wingPads.length} aeroplane pads, shown: ${padsShown.join(', ') || 'none'}${padProbe ? ' (stylesheet probe)' : ''}`
    );
    const climbT = ac().pos.y - yT;
    ts.dragging = false;
    ts.throttle = null;
    run(8);
    r.ok(
      'a thumb on the touch lever climbs, and lifting it holds the height',
      climbT > 4 && Math.abs(ac().vs) < 0.3 && !ac().crashed,
      `${f1(climbT)} m in 3 s with the slider up, then vs ${f1(ac().vs)} m/s 8 s after letting go`
    );
    if (!hadTouch) sim.input.touch = origTouch;

    /* ================================================== the Follow camera */
    /*
     * H2. Hovering beside a building, a sea stack and the carrier's island,
     * the line from the machine to the Follow lens must be clear of every
     * box and the ground on every frame, the lens never inside a box, and it
     * must not jump (under 3.5 m in a 1/15 s step, about 50 m/s). Measured before the fix: 9 m off the
     * Cottage Hospital's wall and 12 m off CV-11 Resolute's island, the line
     * ran through the building on 150 of 150 frames.
     */
    say('heli playtest: the Follow camera beside things');
    const camSpots = [];
    const lineClear = (P, C) => {
      for (const o of T.OBSTACLES) {
        let t0 = 0;
        let t1 = 1;
        for (const [p, d, a, b] of [[P.x, C.x - P.x, o.x0, o.x1], [P.y, C.y - P.y, o.y0, o.y1], [P.z, C.z - P.z, o.z0, o.z1]]) {
          if (Math.abs(d) < 1e-9) {
            if (p < a || p > b) t0 = 2;
            continue;
          }
          let ta = (a - p) / d;
          let tb = (b - p) / d;
          if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
        }
        if (t0 <= t1 && t0 > 0.02) return `through ${o.what || 'a box'}`;
        if (C.x > o.x0 && C.x < o.x1 && C.z > o.z0 && C.z < o.z1 && C.y > o.y0 && C.y < o.y1) return `inside ${o.what || 'a box'}`;
      }
      for (let k = 1; k < 10; k++) {
        const tt = k / 10;
        if (T.heightAt(P.x + (C.x - P.x) * tt, P.z + (C.z - P.z) * tt) > P.y + (C.y - P.y) * tt) return 'through the ground';
      }
      return '';
    };
    const hoverBeside = (x, y, z, hdg) => {
      ac().reset({ pos: new THREE.Vector3(x, y, z), headingDeg: (hdg + 360) % 360, altAGL: y - T.heightAt(x, z), engineOn: true });
      sim.input.throttleTarget = hoverLever();
      sim.input.out.throttle = sim.input.throttleTarget;
      sim.rig.setMode('chase');
      run(DT * 2);
      let bad = 0;
      let firstBad = '';
      let jump = 0;
      let last = sim.camera.position.clone();
      let dist = 0;
      for (let i = 0; i < 75; i++) {
        run(DT);
        const why = lineClear({ x: ac().pos.x, y: ac().pos.y + 1, z: ac().pos.z }, sim.camera.position);
        if (why) {
          bad++;
          if (!firstBad) firstBad = why;
        }
        jump = Math.max(jump, sim.camera.position.distanceTo(last));
        last.copy(sim.camera.position);
        dist = sim.camera.position.distanceTo(ac().pos);
      }
      return { bad, firstBad, jump, dist, crashed: ac().crashed ? ac().crashReason : '' };
    };
    try {
      await startHeli('normal');
      const hosp = T.OBSTACLES.find((o) => /Hospital/.test(o.what || ''));
      if (hosp) {
        const x = hosp.x0 - 9;
        const z = (hosp.z0 + hosp.z1) / 2;
        camSpots.push({ where: 'beside the Cottage Hospital', ...hoverBeside(x, T.heightAt(x, z) + 7.7, z, 270) });
      }
      if (typeof sim.startAnyMission === 'function') {
        await sim.startAnyMission('stackrescue');
        run(1);
        // A sea point beside rock that stands over 100 m, near the climber.
        const tgt = sim.runner && sim.runner.activeTarget ? sim.runner.activeTarget() : null;
        const cx = tgt ? tgt.pos.x : ac().pos.x;
        const cz = tgt ? tgt.pos.z : ac().pos.z;
        let found = null;
        for (let rr = 20; rr < 900 && !found; rr += 15) {
          for (let a = 0; a < 360 && !found; a += 9) {
            const px = cx + Math.cos((a * Math.PI) / 180) * rr;
            const pz = cz + Math.sin((a * Math.PI) / 180) * rr;
            if (T.heightAt(px, pz) > 0) continue;
            let clear = true;
            for (let b = 0; b < 360 && clear; b += 30) for (const q of [4, 7]) if (T.heightAt(px + Math.cos((b * Math.PI) / 180) * q, pz + Math.sin((b * Math.PI) / 180) * q) > 30) clear = false;
            if (!clear) continue;
            for (let b = 0; b < 360 && !found; b += 15) {
              for (const q of [14, 18, 22]) {
                const qx = px + Math.cos((b * Math.PI) / 180) * q;
                const qz = pz + Math.sin((b * Math.PI) / 180) * q;
                if (T.heightAt(qx, qz) > 100) {
                  found = { px, pz, hdg: (Math.atan2(px - qx, -(pz - qz)) * 180) / Math.PI };
                  break;
                }
              }
            }
          }
        }
        if (found) camSpots.push({ where: 'beside a sea stack', ...hoverBeside(found.px, 60, found.pz, found.hdg) });
        else camSpots.push({ where: 'beside a sea stack', bad: 1, firstBad: 'no spot found', jump: 0, dist: 0, crashed: '' });
        await sim.startAnyMission('overboard');
        run(1);
        const isl = T.OBSTACLES.find((o) => /Resolute/.test(o.what || ''));
        if (isl && sim.carrier) camSpots.push({ where: 'beside the carrier’s island', ...hoverBeside(isl.x0 - 12, sim.carrier.deckY + 6.7, (isl.z0 + isl.z1) / 2, 270) });
        sim.quitToMenu();
      }
    } catch (e) {
      camSpots.push({ where: 'the camera spots', bad: 1, firstBad: `threw: ${e && e.message}`, jump: 0, dist: 0, crashed: '' });
    }
    r.ok(
      'hovering beside a building, a stack and the carrier, the Follow camera always sees the helicopter and never jumps',
      camSpots.length === 3 && camSpots.every((s) => s.bad === 0 && s.jump < 3.5 && !s.crashed),
      camSpots.map((s) => `${s.where}: ${s.bad ? `${s.bad} frames blocked (${s.firstBad})` : 'clear'}, lens ${f1(s.dist)} m, worst jump ${f1(s.jump)} m${s.crashed ? ', CRASHED: ' + s.crashed : ''}`).join('; ')
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
        // "Hold Shift to raise the collective until the skids come off the
        // pad. Let go a little way up — the assist holds that height."
        hold(['Shift'], 6, () => skidH() > 2.5);
        run(4);
      } else if (id === 'hold') {
        // "Hold it at about twenty feet over the pad... Let go of everything."
        // The HEIGHT light is green in the band; tap towards it if it is not.
        const hb = sim.hoverBox;
        const lo2 = hb ? hb.minAgl : 4;
        const hi2 = hb ? hb.maxAgl : 11;
        if (skidH() < lo2 + 0.5) hold(['Shift'], 0.4);
        else if (skidH() > hi2 - 0.5) hold(['Ctrl'], 0.4);
        run(7, () => stepId() !== 'hold');
      } else if (id === 'turn') {
        // "Turn right on the spot with E, until you are facing the sea."
        hold(['E'], 8, () => stepId() !== 'turn');
        run(1);
      } else if (id === 'down') {
        // "Hold Ctrl ... keep holding until the skids touch."
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

    /* ===================================================== every level */
    say('heli playtest: easy and realistic');
    for (const lv of ['easy', 'realistic']) {
      await startHeli(lv);
      const assistOn = ac().hoverAssist !== false && /ASSIST ON/.test(chip());
      liftTo(15);
      run(3);
      const pL = ac().pos.clone();
      let dL = 0;
      run(10, () => {
        dL = Math.max(dL, ac().pos.distanceTo(pL));
      });
      r.ok(
        `${lv}: the same helicopter, the assist on, and it hovers hands off`,
        assistOn && dL < 1.5 && !ac().crashed,
        `assist on ${assistOn}, moved ${f1(dL)} m in 10 s`
      );
    }
    // And with the assist off, realistic is the real lever: let go of Shift
    // after a climb and it goes on climbing.
    tapKey('F');
    hold(['Shift'], 2.5);
    run(3);
    r.ok('realistic with the assist off: the lever stays where you leave it', ac().hoverAssist === false && ac().vs > 4, `vs ${f1(ac().vs)} m/s 3 s after letting go of Shift`);
    tapKey('F');
    // The difficulty dial in Settings sets the assist's default: off for
    // realistic ("no help at all"), on again for normal and easy, and the
    // box on the same screen follows it.
    if (typeof sim.applySetting === 'function') {
      const box = () => {
        const b = document.querySelector('[data-set="heliAssist"]');
        return b ? b.checked : null;
      };
      const got = [];
      for (const lv of ['realistic', 'normal', 'easy']) {
        sim.applySetting('difficulty', lv);
        run(0.2);
        got.push({ lv, s: sim.settings.heliAssist, a: ac().hoverAssist !== false, box: box(), chip: chip() });
      }
      r.ok(
        'Settings: realistic sets the assist off by default, normal and easy on, and the box follows',
        got[0].s === false && !got[0].a && got[0].box !== true && /OFF/.test(got[0].chip)
          && got.slice(1).every((g) => g.s === true && g.a && g.box !== false && /ON|HOLD/.test(g.chip)),
        got.map((g) => `${g.lv}: setting ${g.s}, machine ${g.a}, box ${g.box}, chip "${g.chip}"`).join('; ')
      );
    }

    /* ============================================ and then an aeroplane */
    say('heli playtest: the aeroplane after it');
    await startHeli('normal');
    run(1);
    allUp();
    if (typeof sim.switchGame === 'function') sim.switchGame('flight');
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 0 });
    allUp();
    run(3);
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
    if (sim.input) sim.input.touch = origTouch;
    if (typeof sim.applyDifficulty === 'function') sim.applyDifficulty(origDiff);
    if (sim.settings) {
      if (origAssist === undefined) delete sim.settings.heliAssist;
      else sim.settings.heliAssist = origAssist;
      if (sim.aircraft) sim.aircraft.hoverAssist = sim.settings.heliAssist !== false;
    }
    sim.autoPauseOnHide = origAutoPause;
    sim.renderer.render = origRender;
    sim._unlocking = origUnlocking;
  }
  return r;
}

export default check;
