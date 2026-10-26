/**
 * Browser checks for the secret runway hitbox and the three-second rule
 * (src/game/landing-zone.js; the owner, 2026-10-16: "for things where u need
 * aland on runway just add a runway hitbox thats secret and if you land on
 * there for more than 3 seconds you land").
 *
 * Every landing here is a real one: the aeroplane is put a few metres over
 * the runway, long and fast, sinking gently, and the flight model's own
 * wheel contact makes the touchdown (and grades it). Then nobody touches the
 * brakes. The step must finish LANDING_RULE.hold seconds after the wheels
 * touch, with the aeroplane still rolling fast.
 *
 * The rule was three seconds when this was written; the owner then made it
 * none (2026-10-16, "you land you land": LANDING_RULE.hold = 0, and the node
 * suite landing-zone.mjs was changed with it). This check still asked for
 * three, so every landing that counted at once ("done 0.00 s later") read
 * as a failure. It now reads the rule: at once today, three seconds again
 * if the rule ever goes back — never before the wheels touch, never late.
 *
 *   - Story chapter 1, step 3 ("Land on the numbers and stop. Runway 09"),
 *     on Condor Rock: touch down long and fast, touch down (the rule's hold, at once today), done.
 *   - A normal mission landing (Island Circuit) and a delivery (Mango Cay
 *     Delivery, "Land on runway 09 and bring the aeroplane to a stop"), the
 *     same way.
 *   - Landed on the grass beside the runway, outside the box: never counts,
 *     however long it sits there.
 *   - The box is secret: nothing of it is in the scene, unless a developer
 *     asks the Dev panel for it.
 *
 * It puts the player's story save, achievements and progress back afterwards.
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'landing-zone';

const KEYS = ['islandsim.story.v1', 'islandsim.achievements.v1', 'islandsim.progress.v1'];

async function tick(ms = 40) {
  await new Promise((res) => setTimeout(res, ms));
}

export async function check(sim, r, say) {
  let THREE;
  let AP;
  let T;
  let LZ;
  let Dir;
  let Chapters;
  let Ext;
  try {
    THREE = await import('../../src/vendor/three.module.js');
    AP = await import('../../src/world/airport.js');
    T = await import('../../src/world/terrain.js');
    LZ = await import('../../src/game/landing-zone.js');
    Dir = await import('../../src/story/director.js');
    Chapters = await import('../../src/story/chapters.js');
    Ext = await import('../../src/game/extensions.js');
  } catch (err) {
    r.ok('landing zone: the modules load', false, String(err && err.message));
    return;
  }

  const saved = {};
  for (const k of KEYS) {
    try {
      saved[k] = localStorage.getItem(k);
    } catch (e) {
      saved[k] = null;
    }
  }
  const progSnap = sim.progress ? JSON.stringify(sim.progress) : null;
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const status = () => sim.runner.status;
  const stepId = () => (sim.runner.step ? sim.runner.step.id : null);
  const toStep = (id) => {
    for (let i = 0; i < 12 && stepId() !== id && status() === 'running'; i++) {
      sim.runner.skipStep();
      sim.step(0.1, 1 / 30);
    }
    return stepId() === id;
  };

  /**
   * A real touchdown at (x, z), `speed` m/s along `headingDeg`, then a
   * roll with the power off and no brakes, until the step in hand is over
   * (or `secs` after the wheels touched). `until` says when it is over.
   */
  const touchDownAndRoll = ({ x, z, headingDeg = 90, speed = 38, secs = 6, until }) => {
    const ac = sim.aircraft;
    ac.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg, speed, altAGL: 3.6, engineOn: true, gearDown: true });
    sim.override = { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 0 };
    const out = { tdAt: null, after: null, gs: null, td: null, x: null, crashed: false, stepAtTd: null };
    let t = 0;
    const dt = 1 / 30;
    try {
      for (let i = 0; i < 30 * (secs + 8); i++) {
        // A gentle sink until the wheels touch — 120-200 ft/min, the flare
        // done for it; the touchdown itself is the flight model's.
        if (!ac.onGround && out.tdAt == null) ac.vel.y = Math.max(-1.0, Math.min(ac.vel.y, -0.6));
        sim.step(dt, dt);
        t += dt;
        if (ac.crashed) {
          out.crashed = true;
          break;
        }
        if (out.tdAt == null && ac.onGround) {
          out.tdAt = t;
          out.td = ac.lastTouchdown;
          out.x = ac.pos.x;
          out.z = ac.pos.z;
          out.stepAtTd = stepId();
        }
        if (out.tdAt != null && until()) {
          out.after = t - out.tdAt;
          out.gs = ac.groundSpeed;
          break;
        }
        if (out.tdAt != null && t - out.tdAt > secs) break;
      }
    } finally {
      sim.override = null;
    }
    out.endGs = ac.groundSpeed;
    out.onGround = ac.onGround;
    return out;
  };
  const fmt = (o) => `touched ${o.tdAt == null ? 'never' : `at x ${o.x.toFixed(0)}, ${o.td ? `${o.td.vsFpm} fpm ${o.td.speedKts} kt` : ''}`}; `
    + `${o.after == null ? 'not done' : `done ${o.after.toFixed(2)} s later at ${o.gs.toFixed(1)} m/s`}${o.crashed ? ' CRASHED' : ''}`;
  // The rule's own hold (0 today: the moment the wheels touch in the box), a frame or a bounce's grace late at most.
  const HOLD = LZ.LANDING_RULE.hold;
  const holdWords = HOLD > 0 ? `${HOLD} s` : 'at once';
  const countsOnTime = (o) => !o.crashed && o.td && !o.td.crashed && o.after != null && o.after >= Math.max(0, HOLD - 0.1) && o.after <= HOLD + 0.4;

  try {
    /* ---- the box is secret ---------------------------------------------- */
    say('landing zone: secret');
    if (sim.state !== 'menu') sim.quitToMenu('main');
    await sim.startMode('mission', { id: 'circuit' });
    sim.step(0.3, 1 / 30);
    const drawnNow = () => {
      const out = [];
      sim.scene.traverse((o) => {
        if (/^landing-zone-/.test(o.name || '')) out.push(o.name);
      });
      // The feature's own world group (extensions.js names it) holds nothing either.
      const g = sim.scene.getObjectByName('ext:landing-zones');
      if (g && g.children.length) out.push(`ext:landing-zones has ${g.children.length}`);
      return out;
    };
    const drawn = drawnNow();
    r.ok('landing zone: the box is not drawn (nothing of it in the scene)', drawn.length === 0, drawn.join(', ') || 'nothing');
    {
      // Only a developer sees it: the Dev panel's "Landing hitboxes" draws one
      // wire frame per runway, and the second press takes them away again.
      const act = Ext.extDevActions().find((a) => a.ext === 'landing-zones');
      let on = [];
      let off = ['not run'];
      if (act) {
        act.run(sim);
        on = drawnNow().filter((n) => n !== 'landing-zone-debug');
        act.run(sim);
        off = drawnNow();
      }
      r.ok('landing zone: ...the Dev panel\'s "Landing hitboxes" shows one box per runway, and hides them again',
        !!act && on.length === LZ.runwayZones().length && off.length === 0, `${act ? '' : 'no dev action; '}on: ${on.join(', ')}; off: ${off.join(', ') || 'nothing'}`);
    }

    /* ---- a normal mission: Island Circuit ------------------------------- */
    say('landing zone: Island Circuit');
    const onLand = toStep('land');
    const RW = AP.RUNWAY;
    // Long: 450 m past the aiming point, two-thirds of the way down a 1,100 m runway. Fast: 38 m/s, 74 kt.
    const c = touchDownAndRoll({ x: RW.touchdown.x + 450, z: RW.cz + 4, until: () => status() !== 'running' });
    r.ok(`landing zone: Island Circuit — touched down long and fast, it completes ${HOLD > 0 ? `${holdWords} later` : 'at once'}, still rolling`,
      onLand && countsOnTime(c) && status() === 'complete' && c.gs > 15 && c.x > RW.touchdown.x + 300, fmt(c));
    r.ok('landing zone: ...and the landing was graded as always (the grade is the score, not the gate)', !!c.td && typeof c.td.score === 'number' && c.td.onRunway === true,
      c.td ? JSON.stringify({ score: c.td.score, onRunway: c.td.onRunway, quality: c.td.quality }) : 'no grade');
    sim.quitToMenu('missions');

    /* ---- off the runway: the grass beside it ---------------------------- */
    say('landing zone: the grass');
    await sim.startMode('mission', { id: 'circuit' });
    sim.step(0.3, 1 / 30);
    toStep('land');
    // South of the runway, past the box's 15 m of shoulder: 30 m beyond the paved edge, on the flattened pad.
    const gz = RW.cz + RW.halfWidth + 30;
    const gx = RW.touchdown.x + 150;
    const grassOk = !T.isOnAnyRunway(gx, gz, 15) && !LZ.inZone(new THREE.Vector3(gx, T.AIRPORT.elev + 1.5, gz));
    const g = touchDownAndRoll({ x: gx, z: gz, speed: 30, secs: 10, until: () => status() !== 'running' });
    // Then stopped there, brakes on, for a long time.
    sim.override = { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 1 };
    sim.step(8, 1 / 30);
    sim.override = null;
    const offBox = !LZ.inZone(sim.aircraft.pos);
    r.ok('landing zone: down on the grass beside the runway (outside the box) does not count, rolling or stopped',
      grassOk && g.tdAt != null && !g.crashed && status() === 'running' && stepId() === 'land' && offBox,
      `${fmt(g)}; then ${sim.aircraft.groundSpeed.toFixed(1)} m/s at ${sim.aircraft.pos.x.toFixed(0)},${sim.aircraft.pos.z.toFixed(0)}, in box ${!offBox}; step ${stepId()} ${status()}`);
    sim.quitToMenu('missions');

    /* ---- a delivery: Mango Cay Delivery's landing ----------------------- */
    say('landing zone: Mango Cay Delivery');
    await sim.startMode('mission', { id: 'delivery' });
    sim.step(0.3, 1 / 30);
    const dLand = toStep('land');
    const d = touchDownAndRoll({ x: AP.RUNWAY.touchdown.x + 400, z: AP.RUNWAY.cz - 5, speed: 40, until: () => status() !== 'running' });
    r.ok(`landing zone: the delivery ("bring the aeroplane to a stop") completes ${HOLD > 0 ? `${holdWords} after` : 'at'} a long, fast touchdown, no stop`,
      dLand && countsOnTime(d) && status() === 'complete' && d.gs > 15, fmt(d));
    sim.quitToMenu('missions');

    /* ---- Story chapter 1, step 3 ---------------------------------------- */
    say('landing zone: Story chapter 1, the landing');
    const ch1 = Chapters.CHAPTERS.find((c) => c.id === 'ch01-the-glint');
    // The landing beat, from its start, as a replay (the story's own pointer is left alone).
    const started = Dir.startChapter(ch1, { replay: true, resume: { beatIndex: 1, step: 0, exact: false } });
    let up = false;
    for (let i = 0; i < 300 && !up; i++) {
      await tick(40);
      up = sim.state === 'flying' && sim.runner.def && sim.runner.def.id === 'story-ch01-land' && sim.story.state.phase === 'playing';
    }
    await started;
    const sLand = up && toStep('land');
    const idx = sim.runner.stepIndex;
    const text = sim.runner.step ? sim.runner.step.text : '';
    const SR = AP.RUNWAY;
    const s = touchDownAndRoll({
      x: SR.touchdown.x + 420,
      z: SR.cz + 3,
      speed: 38,
      until: () => !(sim.runner.def && sim.runner.def.id === 'story-ch01-land' && status() === 'running' && stepId() === 'land'),
    });
    r.ok(`landing zone: Story ch1 step 3 ("Land on the numbers and stop. Runway 09") on Condor Rock — long, fast, ${HOLD > 0 ? `${holdWords} of roll` : 'the touchdown'}, done`,
      sLand && idx === 2 && /Runway 09/.test(text) && sim.settings.map === 'condor' && countsOnTime(s) && s.gs > 15,
      `${up ? '' : 'never started; '}step ${idx} "${text.slice(0, 40)}" on ${sim.settings.map}: ${fmt(s)}`);
    // The beat is over: the chapter goes on to its finale.
    for (let i = 0; i < 20; i++) {
      await tick(20);
      sim.step(0.1, 1 / 30);
    }
    r.ok('landing zone: ...and the chapter moves on (the hangar), not stuck waiting for a stop', ['cutscene', 'debrief'].includes(sim.story.state.phase) || sim.state === 'debrief',
      `${sim.story.state.phase} ${sim.state}`);
  } catch (err) {
    r.ok('landing zone: the checks ran to the end', false, String((err && err.stack) || err).slice(0, 300));
  } finally {
    sim.override = null;
    try {
      if (sim.state !== 'menu') sim.quitToMenu('main');
    } catch (e) {
      /* fine */
    }
    for (const k of KEYS) {
      try {
        if (saved[k] == null) localStorage.removeItem(k);
        else localStorage.setItem(k, saved[k]);
      } catch (e) {
        /* fine */
      }
    }
    try {
      Dir.reloadSave();
    } catch (e) {
      /* fine */
    }
    if (progSnap && sim.progress) {
      const p = JSON.parse(progSnap);
      for (const k of Object.keys(sim.progress)) if (!(k in p)) delete sim.progress[k];
      Object.assign(sim.progress, p);
    }
    sim.autoPauseOnHide = origAuto;
  }
}
