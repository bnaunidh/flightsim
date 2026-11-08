/**
 * Browser checks for SIGNAL ZERO chapter 3, RANGE CONTROL, in the real game.
 * tests/features/story-ch03.mjs checks the graph, the places, the rules and
 * the medals in node; this is what node cannot see:
 *
 *   - Continue after chapter 2 starts chapter 3 at its briefing, and it opens
 *     in the air over the sea east of the Aurora Fjords in the Kestrel
 *     Courier at dusk, with the objective line, the arrow, the red-hatched
 *     range on the minimap and the radar head in the world;
 *   - a SCRIPTED PILOT (the chapter 1 robot's control law over sim.override)
 *     plays it start to finish (PASS): cruises the corridor through the voice
 *     and the shape, dives for the fjord past the radar head (File 03), runs
 *     the valley under the ridge band until RANGE CONTROL loses it, lands on
 *     runway 27 before the insulin clock runs out, and watches the apron
 *     cutscene to the debrief with a medal; the save moves on to chapter 4
 *     (its briefing if it has shipped, TO BE CONTINUED if not);
 *   - the one-minute guarantee: no two autosaves more than 75 s of play apart;
 *   - FAIL → RETRY FROM CHECKPOINT: the insulin clock run down — one kind
 *     line, nothing saved while failing, Retry back in the air in ≤ 3 s at
 *     the checkpoint's step and pose with the clock and cargo put back;
 *   - LEAVE AND CONTINUE from a mid-chapter checkpoint: the recap, then the
 *     same beat, step and pose, with the shape back on the wing;
 *   - the FLICKER PROBE on the title card, the shape on the wing at dusk and
 *     the apron cutscene (Reduce flashing on).
 *
 * It puts the player's own story save back afterwards.
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'story-ch03';

const KEY = 'islandsim.story.v1';

async function tick(ms = 40) {
  await new Promise((res) => setTimeout(res, ms));
}

async function waitFor(fn, tries = 200, ms = 40) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await tick(ms);
  }
  return !!fn();
}

/* ====================================================================== */
/* The pilot: chapter 1's control law, pointed at this chapter's targets   */
/* ====================================================================== */

async function flyChapter(sim, { THREE, Ch3, T, say, maxSeconds = 520, stopWhen = null }) {
  const ac = sim.aircraft;
  const ground = (x, z) => Math.max(0, T.heightAt(x, z));
  const K = Ch3.CHAPTER_3._state;
  const P = Ch3.PLACE;
  const out = { log: [], steps: [], cards: [], whos: [], cutscene: false, landed: false, crashed: false, crashReason: '', saveLog: [], lostT: null, maxAglLose: 0, fileAt: null, seconds: 0 };
  let T0 = 0;
  const log = (s) => out.log.push(`${T0.toFixed(0)}s ${s}`);
  const TAN3 = Math.tan((3 * Math.PI) / 180);
  // 09's final crosses the shelf's western hump (50-80 m, 1-1.5 km out): a 4.5° slope there, 3° on 27.
  const TAN09 = Math.tan((4.5 * Math.PI) / 180);
  const B = { hdg: ac.heading, alt: ac.pos.y, spd: 74, target: null, glide: false, flare: false, L: 270, td: new THREE.Vector3(), join: null, I: 0, Is: 0, Ix: 0, out: {}, maxBank: 26, maxSink: 8 };
  const compute = () => {
    const dt = 1 / 30;
    const o = B.out;
    let wantHdg = B.hdg;
    let wantY = B.alt;
    let ffVs = 0;
    if (B.glide) {
      const L = (B.L * Math.PI) / 180;
      const cross = (ac.pos.x - B.td.x) * Math.cos(L) + (ac.pos.z - B.td.z) * Math.sin(L);
      const along = (B.td.x - ac.pos.x) * Math.sin(L) - (B.td.z - ac.pos.z) * Math.cos(L);
      B.Ix = Math.max(-8, Math.min(8, B.Ix + cross * dt * 0.004));
      wantHdg = B.L - Math.max(-30, Math.min(30, cross * (along < 3000 ? 0.12 : 0.05) + B.Ix));
      const tan = B.rwy === 9 ? TAN09 : TAN3;
      wantY = B.td.y + Math.max(0, along) * tan;
      ffVs = -ac.groundSpeed * tan;
    } else if (B.target) {
      wantHdg = ((Math.atan2(B.target.x - ac.pos.x, -(B.target.z - ac.pos.z)) * 180) / Math.PI + 360) % 360;
    }
    const err = ((wantHdg - ac.heading + 540) % 360) - 180;
    const lim = B.glide && ac.agl < 150 ? 15 : B.maxBank;
    const wantBank = ac.onGround ? 0 : Math.max(-lim, Math.min(lim, err * 0.8));
    const bank = ac.bankAngleDeg();
    o.roll = Math.max(-0.7, Math.min(0.7, (wantBank - bank) * 0.055 - ac.omega.z * 0.55));
    let wantVs = Math.max(-B.maxSink, Math.min(7, (wantY - ac.pos.y) * 0.08 + ffVs));
    if (B.glide && ac.pos.y - B.td.y < 40) wantVs = Math.max(wantVs, -3.5);
    if (B.flare) wantVs = ac.pos.y - B.td.y > 2 ? -1.4 : -0.7;
    const floorY = ground(ac.pos.x, ac.pos.z);
    if (!B.glide && !ac.onGround && ac.pos.y - floorY < 70) wantVs = Math.max(wantVs, 3);
    B.I = Math.max(-0.4, Math.min(0.5, B.I + (wantVs - ac.vs) * dt * 0.03));
    o.pitch = ac.onGround ? 0 : Math.max(-0.6, Math.min(0.75, B.I + (wantVs - ac.vs) * 0.12 - ac.omega.x * 0.6 + (Math.abs(bank) / 25) * 0.06));
    B.Is = Math.max(-0.4, Math.min(0.5, B.Is + (B.spd - ac.ias) * dt * 0.01));
    o.throttle = B.flare && ac.agl < 8 ? 0 : ac.onGround ? 0 : Math.max(0, Math.min(1, 0.5 + (B.spd - ac.ias) * 0.05 + B.Is + wantVs * 0.02));
    o.yaw = ac.onGround ? Math.max(-1, Math.min(1, err * 0.08)) : Math.max(-0.5, Math.min(0.5, (ac.beta || 0) * 1.6));
    o.brakes = ac.onGround && ac.groundTime > 0.8 ? 1 : 0;
  };
  const CTRL = {};
  Object.defineProperty(CTRL, 'pitch', { enumerable: true, get() { compute(); return B.out.pitch; } });
  for (const k of ['roll', 'yaw', 'throttle', 'brakes']) Object.defineProperty(CTRL, k, { enumerable: true, get() { return B.out[k]; } });

  const planLanding = () => {
    // The chapter's own way home: 27 straight in from the fjord, or round over the sea onto 09.
    B.rwy = K.runway;
    const td = B.rwy === 27 ? P.touchdown : P.touchdown09;
    B.td.copy(td);
    B.L = B.rwy === 27 ? 270 : 90;
    B.join = B.rwy === 27 ? new THREE.Vector3(td.x + 5000, td.y + 300, td.z) : P.join09.clone();
    B.glide = false;
    B.flare = false;
    log(`landing planned: runway ${B.rwy}, join ${B.join.x.toFixed(0)},${B.join.z.toFixed(0)}`);
  };
  const flyLanding = () => {
    if (!B.glide) {
      // Round onto 09: a point north-west of the join first, so the turn onto the centreline is
      // made before the join and the glide starts lined up (it started 600 m off and 30° out before).
      if (B.rwy === 9 && !B.circuitDone) {
        const w1 = new THREE.Vector3(B.join.x - 1500, B.join.y, -900);
        const d1 = Math.hypot(w1.x - ac.pos.x, w1.z - ac.pos.z);
        if (d1 > 450) {
          B.target = w1;
          B.alt = B.join.y;
          B.spd = 68;
          B.maxBank = 22;
          return;
        }
        B.circuitDone = true;
      }
      B.target = B.join;
      B.alt = B.join.y;
      B.spd = 66;
      B.maxBank = 22;
      const d = Math.hypot(B.join.x - ac.pos.x, B.join.z - ac.pos.z);
      const err = Math.abs((((B.L - ac.heading) % 360) + 540) % 360 - 180);
      const east = B.rwy === 27 ? ac.pos.x : -ac.pos.x; // along the approach, positive = before the field
      const tdAlong = B.rwy === 27 ? B.td.x : -B.td.x;
      // Lined up, near the centreline, before the field: onto the glide.
      if ((d < 700 && err < 45 && Math.abs(ac.pos.z) < 300) || (east < (B.rwy === 27 ? B.join.x : -B.join.x) && east > tdAlong + 700 && err < 45 && Math.abs(ac.pos.z) < 300)) {
        B.glide = true;
        log(`on the glide, runway ${B.rwy}`);
      }
      return;
    }
    B.spd = 46;
    if (!ac.gearDown) sim.tap('KeyG');
    if (ac.flapStep && ac.flapStep() < 2 && ac.pos.y - B.td.y < 450) ac.setFlaps(ac.flapStep() + 1);
    if (!B.flare && ac.pos.y - B.td.y < Math.max(8, -ac.vs * 3) && !ac.onGround) {
      B.flare = true;
      log('flare');
    }
  };

  let lastStep = null;
  let lastCards = 0;
  const seenWho = new Set();
  const seenCards = new Set();
  sim.override = CTRL;
  try {
    while (T0 < maxSeconds) {
      sim.step(0.25, 1 / 30);
      T0 += 0.25;
      await Promise.resolve();
      if (T0 % 1 < 0.25) await tick(0);
      const st = sim.story.state;
      const cin = sim.story.cinema;
      for (const e of cin.log.slice(lastCards)) {
        if (e.kind === 'card' && !seenCards.has(e.main)) {
          seenCards.add(e.main);
          out.cards.push(e.main);
        }
        if (e.kind === 'line' && e.who && !seenWho.has(e.who)) {
          seenWho.add(e.who);
          out.whos.push(e.who);
        }
        if (e.kind === 'cutscene-end' && e.id === 'ch03-apron') out.cutscene = true;
      }
      lastCards = cin.log.length;
      out.saveLog = st.saveLog;
      const step = sim.runner.step;
      const stepId = step ? step.id : null;
      if (stepId !== lastStep) {
        log(`step ${stepId} (${sim.runner.def && sim.runner.def.id}) at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} ias ${ac.ias.toFixed(0)} clock ${K.clock.toFixed(0)} cargo ${K.cargo.toFixed(2)}`);
        if (stepId) out.steps.push(stepId);
        if (lastStep === 'land' && ac.onGround && !ac.crashed) out.landed = true;
        lastStep = stepId;
        if (stepId !== 'short-final' && stepId !== 'land') {
          B.join = null;
          B.glide = false;
          B.flare = false;
        }
      }
      if (ac.crashed) {
        out.crashed = true;
        out.crashReason = ac.crashReason;
        log(`CRASHED ${ac.crashReason}`);
        break;
      }
      if (stopWhen && stopWhen(st, stepId)) {
        log(`stopped: ${stepId}`);
        break;
      }
      if (st.phase === 'debrief' || sim.state === 'debrief') {
        log(`debrief (${st.phase})`);
        break;
      }
      if (!st.active) {
        log('story not active');
        break;
      }
      if (st.phase === 'cutscene') continue;
      if (K.lost && out.lostT == null) {
        out.lostT = T0;
        log(`lost it; lock ${K.lock.toFixed(2)} hidden ${K.hiddenT.toFixed(0)} s`);
      }
      if (K.fileFound && out.fileAt == null) out.fileAt = T0;
      const at = sim.runner.activeTarget();
      B.target = at ? at.pos : null;
      B.spd = 74;
      B.maxSink = 8;
      B.maxBank = 26;
      const def = sim.runner.def && sim.runner.def.id;
      if (def === 'story-ch03-corridor') {
        if (stepId === 'cruise' || stepId === 'voice') {
          // Level at the air start's height, straight at the arrow. Smooth: the cargo is watching.
          B.alt = P.start.y;
          B.maxBank = 18;
        } else if (stepId === 'shape') {
          // Hold the heading, but start letting down: the fjord is 4 km on and 850 m is a long way to lose.
          B.alt = 420;
          B.maxSink = 10;
          B.maxBank = 14;
        } else if (stepId === 'lose') {
          /*
           * Dive for the fjord over the sea first (nothing to hit), to 200 m;
           * then past the radar head on the north point (File 03) at a safe
           * 150 m over its ground, wings nearly level; then the arrow's
           * valley waypoints, low. The first robot dived at the radar with
           * 30° of bank and put a wing tip into the slope (2026-11-08).
           */
          out.maxAglLose = Math.max(out.maxAglLose, ac.agl || 0);
          const radar = new THREE.Vector3(P.radar.x, 0, P.radar.z);
          const dR = Math.hypot(radar.x - ac.pos.x, radar.z - ac.pos.z);
          const overSea = ac.pos.x > 2100;
          if (overSea && ac.pos.y > 230) {
            // A straight dive at the mouth from the cruise: 850 m to lose in 5 km.
            B.target = new THREE.Vector3(1900, 0, -200);
            B.alt = 150;
            B.maxSink = 22;
            B.spd = 88;
            B.maxBank = 18;
          } else if (!K.fileFound && ac.pos.x > P.radar.x - 120 && ac.pos.y < 460) {
            B.target = radar;
            B.alt = Math.min(ground(P.radar.x, P.radar.z) + 100, Ch3.CEIL_Y - 40);
            B.maxSink = 6;
            B.spd = 68;
            B.maxBank = 18;
          } else if (B.target) {
            // Under the ridge band, and never under 90 m over the ground.
            B.alt = Math.min(Ch3.CEIL_Y - 50, Math.max(B.target.y, ground(ac.pos.x, ac.pos.z) + 90));
            B.maxSink = 7;
            B.spd = 70;
            B.maxBank = 24;
          }
          if (dR < 150 && !K.fileFound) log('over the radar head');
        }
      } else if (def === 'story-ch03-home') {
        if (stepId === 'approach' || stepId === 'short-final' || stepId === 'land') {
          if (!B.join) planLanding();
          flyLanding();
          if (ac.onGround && ac.groundSpeed < 1.5 && ac.groundTime > 1) out.landed = true;
        }
      }
      if (T0 % 15 < 0.25) {
        const s = K.shape;
        log(`… ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} agl ${Math.round(ac.agl)} ias ${ac.ias.toFixed(0)} hdg ${ac.heading.toFixed(0)} step ${stepId} lock ${K.lock.toFixed(2)} hid ${K.hiddenT.toFixed(0)} clock ${K.clock.toFixed(0)} cargo ${K.cargo.toFixed(2)}${s && !s.gone ? ` shape ${s.state} ${Math.round(s.pos.distanceTo(ac.pos))} m` : ''}`);
      }
    }
  } finally {
    sim.override = null;
  }
  out.seconds = T0;
  return out;
}

/* ====================================================================== */
/* The checks                                                               */
/* ====================================================================== */

export async function check(sim, r, say = () => {}) {
  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch (e) {
    saved = null;
  }
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const realRender = sim.renderer.render.bind(sim.renderer);
  sim.renderer.render = () => {};
  const origReduce = sim.settings.reduceFlashing;
  // Chapters 2-4 are Dev-mode only until the demo is done: this check plays with the workbench open.
  const origDev = sim.prog ? sim.prog.devUnlocked : undefined;
  if (sim.prog) sim.prog.devUnlocked = true;
  let Dir;
  let Ch;
  let Ch3;
  let T;
  let THREE;
  let Save;
  let Script;
  try {
    Dir = await import('../../src/story/director.js');
    Ch = await import('../../src/story/chapters.js');
    Ch3 = await import('../../src/story/ch03-range-control.js');
    T = await import('../../src/world/terrain.js');
    THREE = await import('../../src/vendor/three.module.js');
    Save = await import('../../src/story/save.js');
    Script = await import('../../src/story/script.js');
  } catch (err) {
    r.ok('ch3: the modules load', false, String(err && err.message));
    return;
  }
  const menus = sim.menus;
  const S = () => sim.story.state;
  const K = Ch3.CHAPTER_3._state;
  const P = Ch3.PLACE;
  const ac = () => sim.aircraft;
  const stepId = () => (sim.runner.step ? sim.runner.step.id : null);
  const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  try {
    if (sim.applyDifficulty) sim.applyDifficulty('normal');
    sim.settings.reduceFlashing = true;
    try {
      localStorage.removeItem(KEY);
    } catch (e) {
      /* fine */
    }
    if (sim.state !== 'menu') sim.quitToMenu('main');
    // A player who has finished chapters 1 and 2, on Pilot: Continue is chapter 3.
    const data = Save.blank();
    Save.recordChapter(data, 'ch01-the-glint', { medal: 'silver', score: 80, time: 400 });
    Save.recordChapter(data, 'ch02-fire-line', { medal: 'bronze', score: 60, time: 420 });
    data.chapter = 'ch03-range-control';
    data.flags.knowsFlying = true;
    data.flags.firstSeen = Date.now() - 864e5;
    Save.save(data);
    Dir.reloadSave();

    /* ---- 1. continue → briefing → the air over the fjords ---------------- */
    say('ch3: continue into chapter 3');
    menus.show('story');
    const cont = menus.screens.story.querySelector('[data-story="continue"]');
    r.ok('ch3: after chapter 2 the hub offers Continue into chapter 3', !!cont && /Range Control|Chapter 3/.test(cont.textContent), cont && cont.textContent.replace(/\s+/g, ' ').trim());
    menus.screens.story.querySelector('[data-story="chapters"]').click();
    const tiles = [...menus.screens['story-chapters'].querySelectorAll('[data-tile]')];
    const shippedN = Ch.availableChapters().length;
    // Open: the chapters reached (1-3 with the pointer on 3); a shipped chapter past the pointer is locked until it is reached.
    r.ok('ch3: chapter select — chapters 1-3 open, the rest locked (shipped or not)', tiles.length === 13 && shippedN >= 3 && tiles.slice(0, 3).every((t) => !t.classList.contains('is-locked')) && tiles.slice(3).every((t) => t.classList.contains('is-locked')), `${shippedN} shipped, ${tiles.filter((t) => t.classList.contains('is-locked')).length} locked`);
    menus.show('story');
    menus.screens.story.querySelector('[data-story="continue"]').click();
    await waitFor(() => menus.current === 'story-briefing', 120);
    const brief = menus.screens['story-briefing'];
    const bullets = brief.querySelectorAll('[data-brief-bullets] li');
    r.ok('ch3: the briefing — Range Control, three bullets, a route picture, GO', menus.current === 'story-briefing' && /Range Control/.test(brief.textContent) && bullets.length === 3 && !!brief.querySelector('[data-go]'), brief.textContent.replace(/\s+/g, ' ').trim().slice(0, 140));
    brief.querySelector('[data-go]').click();
    const started = await waitFor(() => sim.state === 'flying' && sim.runner.def && sim.runner.def.id === 'story-ch03-corridor', 500, 50);
    for (let i = 0; i < 20; i++) sim.step(1 / 30);
    r.ok('ch3: it opens in the air east of the fjords, in the Courier, at dusk under cloud', started && sim.settings.map === 'fjord' && sim.aircraftType.id === 'courier' && sim.weather.time === 'sunset' && sim.weather.condition === 'cloudy' && !ac().onGround && dist2D(ac().pos, P.start) < 400 && ac().pos.y > 600,
      `${sim.state} ${sim.runner.def && sim.runner.def.id} ${sim.settings.map} ${sim.aircraftType && sim.aircraftType.id} ${sim.weather.time}/${sim.weather.condition} at ${Math.round(dist2D(ac().pos, P.start))} m, y ${Math.round(ac().pos.y)}`);
    r.ok('ch3: one objective line from the first second, the arrow on the corridor, the cargo and clock in the tracker', /Aurora/.test(sim.hud.objectiveText.textContent) && !!sim.runner.activeTarget() && K.clock > 200 && K.cargo === 1, sim.hud.objectiveText.textContent);
    r.ok('ch3: the radar head stands on the north point and the range is hatched on the minimap', !!sim.scene.getObjectByName('story:radar-head') && !!(sim.minimap && sim.minimap.underlay && sim.minimap.underlay.storyRange));
    r.ok('ch3: it saved at the air start', S().saveLog.length >= 1 && S().data.beat === 'story-ch03-corridor' && !!S().data.pose, JSON.stringify(S().saveLog));

    /* ---- 2. the robot plays it to the end ---------------------------------- */
    say('ch3: the robot plays it');
    const play = await flyChapter(sim, { THREE, Ch3, T, say, maxSeconds: 560 });
    await waitFor(() => menus.current === 'story-debrief', 150, 40);
    const trail = play.steps.join(' → ');
    r.ok('ch3 robot: the voice came, the shape joined, and it was lost under the ridges', play.steps.includes('voice') && play.steps.includes('shape') && play.steps.includes('lose') && play.lostT != null && K.lostAt != null, `${trail}; lost at ${play.lostT} s; ${play.log.filter((l) => /lost|shape|CRASH/.test(l)).slice(0, 4).join(' | ')}`);
    // The Low Road (≤ 500 ft the whole way through the fjord) is a player's style to earn; this pilot only has to get under the rim.
    r.ok('ch3 robot: it got under the ridge band in the fjord (the Low Road style is reported, not required)', K.lostAt != null && K.hiddenT >= 10, `max AGL in the lose step ${Math.round(K.maxAglLose)} m (Low Road ≤ ${Ch3.LOW_ROAD_AGL}: ${K.lowRoad}); hidden ${Math.round(K.hiddenT)} s`);
    r.ok('ch3 robot: File 03 at the radar head', K.fileFound && S().data.flags.files.includes('f03'), `file at ${play.fileAt} s`);
    r.ok('ch3 robot: landed on runway 27 with the insulin clock still running, and no crash', play.landed && !play.crashed && K.clock > 0 && K.landing != null, `${play.crashed ? `CRASHED ${play.crashReason}` : 'intact'}; clock ${Math.round(K.clock)} s; ${play.log.slice(-4).join(' | ')}`);
    r.ok('ch3 robot: the cargo arrived (above the fail line; this pilot dives hard)', K.cargo > 0.15, `${Math.round(K.cargo * 100)}%`);
    r.ok('ch3 robot: the title card came up in the cruise (RANGE CONTROL, thin bars)', play.cards.includes('RANGE CONTROL'), play.cards.join('|'));
    r.ok('ch3 robot: lines were spoken with portraits — Nadia, Mara, RANGE CONTROL, Aurora Approach, Lark', ['nadia', 'mara', 'range', 'aurora', 'lark'].every((w) => play.whos.includes(w)), play.whos.join(','));
    r.ok('ch3 robot: the apron cutscene played and ended', play.cutscene, JSON.stringify(sim.story.cinema.log.filter((e) => /cutscene/.test(e.kind)).map((e) => `${e.kind}:${e.id}:${e.how || ''}`)));
    r.ok('ch3 robot: the debrief, a medal and a score, with Next chapter / Replay / Story menu', menus.current === 'story-debrief' && !!menus.screens['story-debrief'].querySelector('.sz-medal') && /\/100/.test(menus.screens['story-debrief'].textContent), menus.current);
    const rec = S().data.chapters['ch03-range-control'];
    r.ok('ch3 robot: the save has chapter 3 done with its medal, and the pointer on chapter 4', !!(rec && rec.done && rec.medal) && S().data.chapter === 'ch04-low-water', JSON.stringify({ rec, ch: S().data.chapter }));
    const gaps = [];
    for (let i = 1; i < play.saveLog.length; i++) gaps.push(+(play.saveLog[i].t - play.saveLog[i - 1].t).toFixed(1));
    r.ok('ch3 robot: no two autosaves more than 75 s of play apart (the one-minute guarantee)', gaps.length >= 5 && Math.max(...gaps) <= 75, `gaps ${gaps.join(',')} s; ${play.saveLog.map((e) => e.id).join(',')}`);
    r.ok('ch3 robot: about seven minutes of play, as the tile says', play.seconds >= 180 && play.seconds <= 540, `${Math.round(play.seconds)} s`);
    r.ok('ch3 robot: Reduce flashing stayed on', sim.settings.reduceFlashing === true);
    menus.screens['story-debrief'].querySelector('[data-dact="next"]').click();
    await waitFor(() => menus.current === 'story-tbc' || menus.current === 'story-briefing', 120);
    const ch4 = Ch.chapterById('ch04-low-water');
    const nextScreen = menus.screens[menus.current];
    r.ok(ch4 && ch4.available ? 'ch3: Next chapter → chapter 4\'s briefing, Low Water' : 'ch3: Next chapter → TO BE CONTINUED, naming Low Water', (ch4 && ch4.available ? menus.current === 'story-briefing' : menus.current === 'story-tbc') && /Low Water/.test(nextScreen.textContent), `${menus.current}: ${nextScreen.textContent.replace(/\s+/g, ' ').trim().slice(0, 120)}`);
    if (menus.current === 'story-briefing') nextScreen.querySelector('[data-back]').click();
    await waitFor(() => !S().active, 50);
    r.ok('ch3: nothing of the chapter left in the world afterwards', !sim.scene.getObjectByName('story:radar-head') && !sim.scene.getObjectByName('story:shepherd') && !(sim.minimap && sim.minimap.underlay && sim.minimap.underlay.storyRange) && !S().active);

    /* ---- 3. fail (the insulin clock), retry from the checkpoint ------------ */
    say('ch3: fail — the insulin clock');
    await Dir.startChapter(Ch.chapterById('ch03-range-control'), { fresh: true, replay: true, skipBriefing: true });
    await waitFor(() => sim.state === 'flying' && sim.runner.def && sim.runner.def.id === 'story-ch03-corridor', 300, 40);
    // Fly to the corridor checkpoint, then run the clock down where you are.
    const toCp = await flyChapter(sim, { THREE, Ch3, T, say, maxSeconds: 160, stopWhen: (st) => !!(st.checkpoint && st.checkpoint.label === 'The corridor') });
    const cpA = Dir.D.checkpoint;
    const clockA = K.clock;
    r.ok('ch3 fail: reached the corridor checkpoint with the clock and the cargo in it', !!cpA && cpA.label === 'The corridor' && cpA.beatState && Number.isFinite(cpA.beatState.clock) && cpA.beatState.cargo > 0.5, JSON.stringify({ cp: cpA && cpA.label, state: cpA && cpA.beatState && { clock: Math.round(cpA.beatState.clock), cargo: cpA.beatState.cargo } }) + ` ${toCp.steps.join('>')}`);
    K.clock = 1.5;
    let failed = false;
    for (let t = 0; t < 30 && !failed; t += 0.5) {
      sim.step(0.5, 1 / 30);
      await Promise.resolve();
      failed = S().phase === 'failed';
    }
    await waitFor(() => menus.current === 'story-fail', 60);
    const failScr = menus.screens['story-fail'];
    const clockLine = Script.LINES['c3-fail-clock'].text;
    r.ok('ch3 fail: the clock runs out — one kind line, Retry / Restart / Quit', failed && menus.current === 'story-fail' && failScr.textContent.includes(clockLine.slice(0, 24)) && !!failScr.querySelector('[data-fact="retry"]'), failScr.textContent.replace(/\s+/g, ' ').trim().slice(0, 140));
    const savesA = S().saveLog.length;
    await tick(100);
    r.ok('ch3 fail: nothing saved while failing', S().saveLog.length === savesA);
    const t0 = performance.now();
    failScr.querySelector('[data-fact="retry"]').click();
    const back = await waitFor(() => sim.state === 'flying' && S().active && S().phase !== 'failed' && sim.runner.step, 150, 20);
    const took = (performance.now() - t0) / 1000;
    r.ok('ch3 retry: back in the air in ≤ 3 s at the checkpoint\'s step and pose, the clock and cargo put back', back && took <= 3 && sim.runner.def.id === 'story-ch03-corridor' && sim.runner.stepIndex === cpA.step && ac().pos.distanceTo(new THREE.Vector3(...cpA.pose.pos)) < 40 && Math.abs(K.clock - cpA.beatState.clock) < 2 && K.clock > 60,
      `${took.toFixed(2)} s; step ${sim.runner.stepIndex} (cp ${cpA.step}); ${Math.round(ac().pos.distanceTo(new THREE.Vector3(...cpA.pose.pos)))} m off; clock ${Math.round(K.clock)} (was ${Math.round(clockA)} at the fail, ${Math.round(cpA.beatState.clock)} saved)`);

    /* ---- 4. leave and continue with the shape on the wing ------------------ */
    say('ch3: leave and continue');
    const toShape = await flyChapter(sim, { THREE, Ch3, T, say, maxSeconds: 200, stopWhen: (st, sid) => sid === 'lose' && K.t - (K.loseAt ?? K.t) > 2 });
    const hadShape = !!(K.shape && !K.shape.gone);
    Dir.D.replay = false;
    Dir.saveCheckpoint('lose-test', 'The shape on your wing');
    const savedPose = S().data.pose;
    const savedState = S().data.beatState;
    sim.step(2, 1 / 30);
    sim.quitToMenu('main');
    menus.show('story');
    const cont2 = menus.screens.story.querySelector('[data-story="continue"]');
    r.ok('ch3 continue: the hub offers Continue at "The shape on your wing"', !!cont2 && /shape on your wing/.test(cont2.textContent) && hadShape && savedState && savedState.shape, (cont2 && cont2.textContent.replace(/\s+/g, ' ').trim()) + ` ${toShape.steps.join('>')}`);
    cont2.click();
    await waitFor(() => sim.state === 'flying' && S().active, 400, 40);
    for (let i = 0; i < 15; i++) sim.step(1 / 30);
    const cin = sim.story.cinema;
    r.ok('ch3 continue: "Previously on SIGNAL ZERO…", then the lose step within metres of the saved pose, the shape back beside you', cin.cardKind === 'recap' && sim.runner.def.id === 'story-ch03-corridor' && stepId() === 'lose' && ac().pos.distanceTo(new THREE.Vector3(...savedPose.pos)) < 40 && !!(K.shape && !K.shape.gone) && K.shape.pos.distanceTo(ac().pos) < 400,
      `${cin.cardKind} ${sim.runner.def && sim.runner.def.id} ${stepId()} ${Math.round(ac().pos.distanceTo(new THREE.Vector3(...savedPose.pos)))} m; shape ${K.shape && !K.shape.gone ? `${K.shape.state} ${Math.round(K.shape.pos.distanceTo(ac().pos))} m` : 'none'}`);
    sim.tap('KeyC');
    sim.step(0.5, 1 / 30);
    sim.tap('KeyC');
    sim.step(2.5, 1 / 30);

    /* ---- 5. the flicker probe ---------------------------------------------- */
    say('ch3: flicker probe');
    sim.quitToMenu('main');
    await Dir.startChapter(Ch.chapterById('ch03-range-control'), { fresh: true, replay: true, skipBriefing: true });
    await waitFor(() => sim.state === 'flying' && sim.runner.def && sim.runner.def.id === 'story-ch03-corridor', 300, 40);
    await flyChapter(sim, { THREE, Ch3, T, say, maxSeconds: 200, stopWhen: (st, sid) => sid === 'shape' && K.t - (K.shapeAt ?? K.t) > 10 });
    const C = await import('../../src/story/cinema.js');
    C.holdStill(true);
    sim.renderer.render = realRender;
    try {
      const Probe = await import('../flicker-probe.js');
      const FB = await import('./flicker.browser.js');
      sim.rig.initialised = false;
      const m1 = await Probe.measure(sim, { frames: 60, fps: 30, warm: 0, raycast: false });
      r.ok(`ch3 flicker: the shape on the wing at dusk flickers over under ${(FB.FLICKER_MAX * 100).toFixed(1)}% of the screen (Reduce flashing on)`, m1.meanLum.max > 0.01 && m1.percArea <= FB.FLICKER_MAX && m1.wcagWindow <= FB.WCAG_WINDOW_MAX, `perc ${(m1.percArea * 100).toFixed(2)}%, WCAG window ${(m1.wcagWindow * 100).toFixed(2)}%; ${m1.stepMs} ms a frame`);
      C.titleCard({ over: 'Chapter 3', main: 'RANGE CONTROL', sub: 'AURORA FJORDS · 17:50', dur: 4, bars: 'thin' });
      const m2 = await Probe.measure(sim, { frames: 45, fps: 30, warm: 0, raycast: false });
      r.ok('ch3 flicker: the title card leaves the picture under the line', m2.percArea <= FB.FLICKER_MAX && m2.wcagWindow <= FB.WCAG_WINDOW_MAX, `perc ${(m2.percArea * 100).toFixed(2)}%`);
      C.holdStill(false);
      const scene = Ch3.CHAPTER_3.finale(Dir.D.api);
      const m3 = await Probe.measure(sim, { frames: 120, fps: 30, warm: 0, raycast: false });
      r.ok('ch3 flicker: the apron cutscene flickers under the line (Reduce flashing on)', m3.meanLum.max > 0.01 && m3.percArea <= FB.FLICKER_MAX && m3.wcagWindow <= FB.WCAG_WINDOW_MAX, `perc ${(m3.percArea * 100).toFixed(2)}%, WCAG window ${(m3.wcagWindow * 100).toFixed(2)}%; ${m3.stepMs} ms a frame`);
      C.skip();
      await scene;
    } catch (e) {
      r.ok('ch3 flicker: the probe ran', false, String((e && e.stack) || e).slice(0, 300));
    } finally {
      sim.renderer.render = () => {};
    }
    sim.quitToMenu('main');
    r.ok('ch3: quitting leaves nothing of the chapter behind', !S().active && !sim.scene.getObjectByName('story:radar-head') && !sim.scene.getObjectByName('story:shepherd'));
  } catch (err) {
    r.ok('ch3: the check ran to the end', false, String((err && err.stack) || err).slice(0, 500));
  } finally {
    try {
      if (sim.state !== 'menu') sim.quitToMenu('main');
    } catch (e) {
      /* fine */
    }
    try {
      if (saved == null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, saved);
    } catch (e) {
      /* fine */
    }
    try {
      Dir.reloadSave();
    } catch (e) {
      /* fine */
    }
    sim.renderer.render = realRender;
    sim.settings.reduceFlashing = origReduce;
    if (sim.prog) sim.prog.devUnlocked = origDev;
    sim.autoPauseOnHide = origAuto;
  }
}
