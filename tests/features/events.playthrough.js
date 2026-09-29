/**
 * The pilot bot: plays a hijack from the first card to the ending, on the
 * real game, the way a child who reads the cards would.
 *
 *   const { playthrough } = await import('./tests/features/events.playthrough.js');
 *   const out = await playthrough(window.__sim, 'event-hijack');       // the film mission
 *   await playthrough(window.__sim, 'event-hijack-real');              // the by-the-book one
 *   await playthrough(window.__sim, 'dev:film');                       // the Dev button, from the menu
 *   console.log(out.log.join('\n'));
 *
 * Not part of the self-test: it flies a whole mission (six to ten minutes of
 * game time, several minutes of a laptop's time with the renderer off). It
 * exists because events.browser.js puts the aeroplane where each step wants
 * it — which proves the story moves on, and says nothing about whether a
 * person following the story's own guidance can get to the end of it. This
 * does. It found that the film mission sent a jumbo to the runway 800 m too
 * high to land, and that nothing in either story said which way was down.
 *
 * What it does and does not do, so a pass means what it says:
 *   - it presses 7 when the card offers a squawk, and 8 (the first answer)
 *     three seconds after any question appears — keys, through the page,
 *     exactly as a keyboard would;
 *   - it turns where the story points: the arrow's target, his heading, the
 *     lead jet; it holds the height the story asks for (hijackInfo().wantAlt)
 *     or the lead jet's; it rocks the wings with the stick when the card says;
 *   - for the landing it flies a three-degree slope to the runway the story
 *     sent it to, puts the wheels and flaps down and flares — its own simple
 *     controller through sim.override, because the game's autopilot will not
 *     land (on purpose);
 *   - it never teleports and never calls the story's functions.
 *
 * @param {object} sim  window.__sim
 * @param {string} what a mission id, or 'dev:film' / 'dev:real'
 * @param {{ maxSeconds?: number, taxi?: boolean, shots?: boolean }} [opts]
 *        taxi: drive to the stand in the film version rather than stopping
 *        where it lands; shots: return a few canvas pictures as data URLs
 * @returns {Promise<{ ok: boolean, log: string[], status: string, phase: string, score: number, crashed: boolean, shots: object[] }>}
 */
export async function playthrough(sim, what, { maxSeconds = 1200, taxi = false, shots = false } = {}) {
  const THREE = await import('../../src/vendor/three.module.js');
  const FE = await import('../../src/features/flight-events.js');
  const UI = await import('../../src/features/events/ui.js');
  const { RUNWAY } = await import('../../src/world/airport.js');
  const { heightAt } = await import('../../src/world/terrain.js');
  const PH = await import('../../src/aircraft/physics.js');
  /*
   * How far the wheels hang below the aeroplane's middle: 5.9 m on a 747,
   * about 3 on the Meridian. The flare is judged on the wheels, not the
   * middle — judged on the middle, the Meridian began it with its wheels
   * 13 m up and floated 500 m past the aiming point on a 900 m strip.
   * (Sinking at 1.8 m/s from 9 m instead, the 747 arrived at over 900 ft a
   * minute and was a crash: 1.6 from 10 m, as it always was for the 747.)
   */
  const gearDrop = () => {
    const pts = PH.SPEC && PH.SPEC.gearPoints;
    return pts && pts.length ? Math.max(0.5, -pts.reduce((m, g) => Math.min(m, g.pos.y), 0)) : 2;
  };
  const { extStatus, extDevActions } = await import('../../src/game/extensions.js');
  const ac = sim.aircraft;
  const odds = { ...FE.ODDS };
  FE.ODDS.hijack = 0;
  FE.ODDS.breakin = 0;
  const realRender = sim.renderer.render.bind(sim.renderer);
  sim.renderer.render = () => {};
  const pics = [];
  const taken = new Set();
  const log = [];
  let T = 0;
  const say = (s) => log.push(`${T.toFixed(0)}s ${s}`);
  const pressKey = (code) => {
    const ev = new KeyboardEvent('keydown', { code, cancelable: true, bubbles: true });
    window.dispatchEvent(ev);
    window.dispatchEvent(new KeyboardEvent('keyup', { code, cancelable: true, bubbles: true }));
    return ev.defaultPrevented;
  };
  const shot = (name) => {
    if (!shots || taken.has(name)) return;
    taken.add(name);
    realRender(sim.scene, sim.camera);
    pics.push({ name, url: sim.renderer.domElement.toDataURL('image/jpeg', 0.72) });
  };
  const h = () => FE.hijackInfo();
  const [kind, ver] = what.split(':');
  const dev = kind === 'dev';

  try {
    if (dev) {
      // The Dev panel's own button, from the menu, as a tester would press it.
      sim.quitToMenu('main');
      const act = extDevActions().find((a) => a.label === (ver === 'real' ? 'Realistic hijack' : 'Trigger hijack event'));
      if (!act) throw new Error('no Dev hijack button');
      act.run(sim);
      for (let i = 0; i < 150 && h().phase === 'idle'; i++) await new Promise((r) => setTimeout(r, 100));
    } else {
      await sim.startMode('mission', { id: what });
    }
    say(`start ${sim.aircraftType.id} ${what} at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} ias ${ac.ias.toFixed(0)}`);

    /* ---- the controller, read by the game every frame through getters ---- */
    const TAN3 = Math.tan((3 * Math.PI) / 180);
    const B = { hdg: ac.heading, target: null, alt: ac.pos.y, spd: 75, glide: false, flare: false, L: 90, td: new THREE.Vector3(), I: 0.1, Is: 0, out: {}, rollCmd: null, taxi: null };
    const compute = () => {
      const dt = 1 / 30;
      const o = B.out;
      let wantHdg = B.hdg;
      let wantY = B.alt;
      let ffVs = 0;
      if (B.taxi && ac.onGround) {
        // Taxiing: steer for the stand. (This came after the glide branch,
        // which stays on after touchdown, so the bot "taxied" down the
        // centre line at 9 m/s and off the end of the runway into the ridge,
        // whatever the stand was.)
        wantHdg = ((Math.atan2(B.taxi.x - ac.pos.x, -(B.taxi.z - ac.pos.z)) * 180) / Math.PI + 360) % 360;
      } else if (B.glide) {
        const L = (B.L * Math.PI) / 180;
        const cross = (ac.pos.x - B.td.x) * Math.cos(L) + (ac.pos.z - B.td.z) * Math.sin(L);
        const along = (B.td.x - ac.pos.x) * Math.sin(L) - (B.td.z - ac.pos.z) * Math.cos(L);
        // A little integral as well: a crosswind otherwise holds it 20-30 m
        // off the centre line, which is off a 34 m runway.
        B.Ix = Math.max(-8, Math.min(8, (B.Ix || 0) + cross * dt * 0.004));
        wantHdg = B.L - Math.max(-30, Math.min(30, cross * (along < 3000 ? 0.12 : 0.05) + B.Ix));
        wantY = B.td.y + Math.max(0, along) * TAN3;
        ffVs = -ac.groundSpeed * TAN3;
      } else if (B.target) {
        wantHdg = ((Math.atan2(B.target.x - ac.pos.x, -(B.target.z - ac.pos.z)) * 180) / Math.PI + 360) % 360;
      }
      const err = ((wantHdg - ac.heading + 540) % 360) - 180;
      const lim = B.glide && ac.agl < 150 ? 15 : 25;
      const wantBank = ac.onGround ? 0 : Math.max(-lim, Math.min(lim, err * 0.8));
      const bank = ac.bankAngleDeg();
      o.roll = B.rollCmd != null ? B.rollCmd : Math.max(-0.7, Math.min(0.7, (wantBank - bank) * 0.055 - ac.omega.z * 0.55));
      let wantVs = Math.max(-9, Math.min(6, (wantY - ac.pos.y) * 0.08 + ffVs));
      // Close to the runway, never faster down than 3.5 m/s: coming off the
      // ridge a jumbo dived for the slope and met the runway at over 900 ft
      // a minute, which the undercarriage calls a crash.
      if (B.glide && ac.pos.y - gearDrop() - B.td.y < 40) wantVs = Math.max(wantVs, -3.5);
      if (B.flare) wantVs = ac.pos.y - gearDrop() - B.td.y > 2 ? -1.6 : -0.8;
      if (ac.agl < 60 && !B.glide && !ac.onGround) wantVs = Math.max(wantVs, 2);
      B.I = Math.max(-0.4, Math.min(0.5, B.I + (wantVs - ac.vs) * dt * 0.03));
      o.pitch = ac.onGround ? 0 : Math.max(-0.6, Math.min(0.75, B.I + (wantVs - ac.vs) * 0.12 - ac.omega.x * 0.6 + (Math.abs(bank) / 25) * 0.06));
      B.Is = Math.max(-0.4, Math.min(0.5, B.Is + (B.spd - ac.ias) * dt * 0.01));
      o.throttle = (B.flare && ac.agl < 8) || ac.onGround ? 0 : Math.max(0, Math.min(1, 0.45 + (B.spd - ac.ias) * 0.05 + B.Is + wantVs * 0.02));
      o.yaw = ac.onGround ? Math.max(-1, Math.min(1, err * 0.08)) : Math.max(-0.5, Math.min(0.5, (ac.beta || 0) * 1.6));
      o.brakes = ac.onGround && ac.groundTime > 1 ? 1 : 0;
      if (B.taxi && ac.onGround) {
        // Walking pace towards the stand, crawling through a turn, stopped
        // when there. It used to coast into turns at 7 m/s and a jumbo that
        // needed to turn round went 360 m off the end of the runway doing it.
        const d = Math.hypot(B.taxi.x - ac.pos.x, B.taxi.z - ac.pos.z);
        const want = d < 45 ? 0 : Math.abs(err) > 40 ? 3 : 8;
        o.throttle = want === 0 ? 0 : Math.max(0, Math.min(0.5, 0.1 + (want - ac.groundSpeed) * 0.08));
        o.brakes = want === 0 || ac.groundSpeed > want + 1 ? 1 : 0;
        o.yaw = Math.max(-1, Math.min(1, err * 0.05));
      }
    };
    const CTRL = {};
    Object.defineProperty(CTRL, 'pitch', { enumerable: true, get() { compute(); return B.out.pitch; } });
    for (const k of ['roll', 'yaw', 'throttle', 'brakes']) Object.defineProperty(CTRL, k, { enumerable: true, get() { return B.out[k]; } });
    sim.override = CTRL;

    let lastPhase = '';
    let lastStep = '';
    let lastCard = '';
    let answerAt = -1;
    let rockStage = 0;
    let rockT = 0;
    let engineOff = false;
    let down = false;
    const leadV = new THREE.Vector3();
    const v = new THREE.Vector3();
    while (T < maxSeconds) {
      sim.step(0.25, 1 / 30);
      T += 0.25;
      const info = h();
      const st = sim.runner.step ? sim.runner.step.id : '-';
      const ui = UI.uiState();
      if (info.phase !== lastPhase) {
        if (info.phase === 'taxi' && info.stand) say(`the stand is at ${info.stand.x.toFixed(0)},${info.stand.z.toFixed(0)}, ${Math.hypot(info.stand.x - ac.pos.x, info.stand.z - ac.pos.z).toFixed(0)} m away`);
        say(`phase ${info.phase} (step ${st}) at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} ias ${ac.ias.toFixed(0)} hdg ${ac.heading.toFixed(0)}${info.wantAlt != null ? ` (slope ${info.wantAlt.toFixed(0)})` : ''}`);
        lastPhase = info.phase;
      }
      if (st !== lastStep) { say(`step ${st}: ${sim.hud.objectiveText.textContent.slice(0, 120)}`); lastStep = st; }
      const cardKey = `${ui.who}|${ui.text}`;
      if (ui.card && cardKey !== lastCard) {
        say(`card [${ui.who}] ${ui.text.slice(0, 170)}${ui.choices.length ? ` {${ui.choices.join(' / ').slice(0, 200)}}` : ''}${ui.button ? ` <${ui.button}>` : ''}`);
        lastCard = cardKey;
        answerAt = T + 3;
      }
      if (ac.crashed) { say(`CRASHED: ${ac.crashReason} at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)}`); break; }
      if (!dev && sim.runner.status !== 'running') { say(`mission ${sim.runner.status}`); break; }
      if (T % 5 === 0 && ac.onGround && down && !info.done) {
        say(`rolling at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(1)} ${ac.groundSpeed.toFixed(1)} m/s hdg ${ac.heading.toFixed(0)} thr ${ac.controls.throttle.toFixed(2)} brk ${ac.controls.brakes.toFixed(1)}${B.taxi ? ' taxiing' : ''}`);
      }
      if (T % 10 === 0 && !ac.onGround) say(`at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} hdg ${ac.heading.toFixed(0)} ias ${ac.ias.toFixed(0)}${info.wantAlt != null ? ` slope ${info.wantAlt.toFixed(0)}` : ''}${info.onApproach ? ' on-approach' : ''}`);
      if (T % 5 === 0 && info.lead && (info.phase === 'follow' || info.phase === 'intercept')) {
        // Where the lead jet is in the picture, against half the field of view.
        const cam = sim.camera;
        cam.updateMatrixWorld();
        v.copy(info.lead).applyMatrix4(cam.matrixWorldInverse);
        say(`lead in view: ${((Math.atan2(v.y, -v.z) * 180) / Math.PI).toFixed(1)} deg up, ${((Math.atan2(v.x, -v.z) * 180) / Math.PI).toFixed(1)} deg right (half the view is ${(cam.fov / 2).toFixed(1)} tall)${v.z < 0 ? '' : ' BEHIND THE CAMERA'}; ${(info.lead.y - ac.pos.y).toFixed(0)} m above you`);
      }
      // The cards: 7 for a squawk button; 8, the first answer, for a question.
      if (ui.choices.length && T >= answerAt) { say(`press 8 -> ${pressKey('Digit8')}`); answerAt = T + 3; }
      if (ui.button && /squawk/i.test(ui.button) && !info.squawked && T >= answerAt) say(`press 7 -> ${pressKey('Digit7')}`);
      // Where to point, and how high.
      B.target = null;
      B.spd = 75;
      if (info.phase === 'orders' && info.version === 'real') {
        const m = /Heading (\d{3})/.exec(ui.guideLabel || '') || /heading (\d{3})/.exec(sim.hud.objectiveText.textContent || '');
        if (m && B.hdg !== Number(m[1])) { B.hdg = Number(m[1]); say(`fly heading ${m[1]}, as he says`); }
      } else if ((info.phase === 'intercept' || info.phase === 'follow') && info.lead) {
        // Along the leader's track (the arrow's point), or at it while it joins.
        B.target = leadV.copy(info.leadAim || info.lead);
        if (info.wantAlt != null) B.alt = info.lead.y - 12;
      } else if (info.phase === 'taxi' && info.stand && taxi) {
        if (!B.taxi) say(`the stand is at ${info.stand.x.toFixed(0)},${info.stand.z.toFixed(0)}, ${Math.hypot(info.stand.x - ac.pos.x, info.stand.z - ac.pos.z).toFixed(0)} m away; ${ac.groundSpeed.toFixed(1)} m/s`);
        B.taxi = info.stand;
        B.target = info.stand;
      } else if (info.guide && info.phase !== 'done') {
        B.target = info.guide;
      }
      if (info.phase !== 'taxi') B.taxi = null;
      if (info.wantAlt != null && !(info.phase === 'follow' && info.lead)) B.alt = info.wantAlt;
      // Rock the wings when the leader does.
      if (info.phase === 'intercept' && /rock your wings/i.test(ui.text) && rockStage === 0) { rockStage = 1; rockT = 0; say('rocking the wings'); shot('rock'); }
      if (rockStage === 1 || rockStage === 2) {
        rockT += 0.25;
        B.rollCmd = rockStage === 1 ? -0.7 : 0.7;
        if (rockStage === 1 && ac.bankAngleDeg() < -16) rockStage = 2;
        else if (rockStage === 2 && (ac.bankAngleDeg() > 14 || info.acked)) { rockStage = 3; B.rollCmd = null; say(`rocked; acknowledged ${info.acked}`); }
        if (rockT > 12) { rockStage = 3; B.rollCmd = null; say('gave up rocking'); }
      }
      if (info.phase === 'follow' && info.escortFormed) shot('follow');
      if (shots && !taken.has('shadow') && info.phase === 'orders' && info.version === 'film' && info.escortFormed) {
        sim.key('KeyB', true);
        sim.step(1, 1 / 30);
        shot('shadow');
        sim.key('KeyB', false);
      }
      if (/WHEELS DOWN/.test(ui.text) && !ac.gearDown) { sim.tap('KeyG'); say('gear down (G), answering the lead'); }
      // The landing: a three-degree slope to wherever the story sent it.
      const td = info.remote || RUNWAY.touchdown;
      const L = info.landHdg != null ? info.landHdg : RUNWAY.headingDeg ?? 90;
      const dTd = Math.hypot(ac.pos.x - td.x, ac.pos.z - td.z);
      const inbound = Math.abs(((ac.heading - L + 540) % 360) - 180) < 50;
      const landing = info.phase === 'approach' || info.phase === 'final' || info.onApproach;
      if (!B.glide && landing && dTd < 9000 && inbound && !ac.onGround) {
        B.glide = true;
        B.L = L;
        B.td.copy(td);
        /*
         * Clear of the ground on the way in. At Kestrel a ridge 46 m high
         * sits 450 m short of runway 09's threshold (x = -1,000, 32 m above
         * the runway), and a three-degree slope to the aiming point passes
         * 2 m over it measured at the aeroplane's middle; a 747's wheels
         * hang 5.9 m below that. The bot touched it in every run, at about
         * -1,080 m. (The game's PAPI is on that same slope.) A floor over the
         * ridge let go of it 100 m before the runway with the jumbo 20 m
         * high, and it dived and arrived at over 900 ft a minute. So the
         * bot does what a pilot does over an obstacle: moves its aiming
         * point down the runway, just far enough for a three-degree slope to
         * pass 10 m over everything on the way — about 210 m at Kestrel.
         */
        {
          const hx = Math.sin((L * Math.PI) / 180);
          const hz = -Math.cos((L * Math.PI) / 180);
          let shift = 0;
          for (let d = 100; d <= 4000; d += 50) {
            const g = heightAt(td.x - hx * d, td.z - hz * d);
            shift = Math.max(shift, (g + 10 - td.y) / TAN3 - d);
          }
          shift = Math.min(shift, 400);
          B.td.x += hx * shift;
          B.td.z += hz * shift;
          if (shift > 0) say(`aiming ${shift.toFixed(0)} m further down the runway, to clear the ground short of it`);
        }
        say(`on the slope for runway ${Math.round(L / 10)} at ${dTd.toFixed(0)} m, y ${ac.pos.y.toFixed(0)} (the slope is at ${(td.y + dTd * TAN3).toFixed(0)})`);
      }
      if (B.glide) {
        B.spd = dTd < 5000 ? 55 : 65;
        if (dTd < 7000 && !ac.gearDown) { sim.tap('KeyG'); say('gear down for landing'); }
        if (dTd < 6000 && ac.flapStep && ac.flapStep() < 2) ac.setFlaps(ac.flapStep() + 1);
        // Flare on height above the runway, not above whatever is under the
        // wheels: rising ground short of a threshold set it off early.
        if (!B.flare && ac.pos.y - gearDrop() - B.td.y < Math.max(10, -ac.vs * 3.5) && !ac.onGround) { B.flare = true; say(`flare ${dTd.toFixed(0)} m from the aiming point, ${ac.ias.toFixed(0)} m/s`); }
      }
      if (ac.onGround && !down && T > 5) {
        down = true;
        say(`on the ground at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)}: ${JSON.stringify(ac.lastTouchdown && { score: ac.lastTouchdown.score, onRunway: ac.lastTouchdown.onRunway })}`);
      }
      if (info.phase === 'stop' && !engineOff && ac.groundSpeed < 5) { engineOff = true; sim.tap('KeyI'); say(`engines off (I): running ${ac.engineOn}`); }
      if (info.phase === 'rush') shot('rush');
      if (info.phase === 'board' && sim.scene.children.some((o) => o.name && o.name.startsWith('person-') && o.visible)) shot('board');
      if (info.done) shot('done');
      if (info.done && (dev ? info.police === 0 : sim.runner.status !== 'running')) { say(`finished: ${dev ? 'the police have gone home' : sim.runner.status}`); break; }
    }
  } finally {
    sim.override = null;
    sim.renderer.render = realRender;
    FE.ODDS.hijack = odds.hijack;
    FE.ODDS.breakin = odds.breakin;
  }
  const info = h();
  const status = sim.runner.status;
  return {
    ok: !ac.crashed && info.phase === 'done' && (dev || status === 'complete'),
    what, seconds: T, status, phase: info.phase, score: info.score, stars: info.stars, onRemote: info.onRemote,
    crashed: ac.crashed, off: extStatus().filter((e) => !e.live).map((e) => e.id), log, shots: pics,
  };
}
