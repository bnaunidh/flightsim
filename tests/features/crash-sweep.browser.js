/**
 * The crash sweep's findings (v64), held on the real game.
 *
 * tests/features/breakup.mjs and crashes.mjs hold the pure parts in node (the
 * spin rate of every choreography, what a knock, a landing and a tail strike
 * break, how a piece lies on a hillside and floats in the sea); this is what
 * only the running game shows:
 *
 *   1  SEIZURE SAFETY. Every kind of crash on every type of aeroplane, with
 *      Reduce flashing on (the default), the cartoon crashes (Comic effects
 *      ON) and the real ones (OFF, the default), on the real renderer under
 *      the flicker probe: under WCAG's line (25% of any 10-degree field) with
 *      a margin. `check` runs the worst few of each; `sweep` runs them all
 *      (96 scenes a mode, about forty minutes: `sweep(sim, r, say, {})`).
 *      Each type is crashed once first and not measured: the first crash in
 *      a page uploads its textures and builds its pools, and read 10-12
 *      points high.
 *   2  sea debris that is flown in at speed floats and sinks slowly, not
 *      "sunk" in a second.
 *   3  an aeroplane knocked out of the sky over land leaves a wreck where it
 *      came down (traffic retires its model at a metre).
 *   9  a crash right after a teleport does not start its replay at the old
 *      place.
 *   camera  with Reduce flashing the chase camera does not follow a wreck
 *      that is sliding away, and with it off it does, as it always did.
 *
 * `check(sim, r, say)`, as tests/features/index.js expects.
 */

/** WCAG 2.3.1's line: 25% of any 10-degree field. The worst scene measured is 19% (a cartoon F-22 hitting a wall); the number moves a few points with what ran before it. */
export const LIMIT = 0.25;
export const KINDS = ['cartwheel', 'wingclip', 'bonk', 'noseplant', 'bellyflop', 'splash'];
export const ALL_TYPES = ['skylark', 'courier', 'meridian', 'tempest', 'vanguard', 'osprey', 'nightjar', 'harrier', 'f22', 'f35b', 'fa18', 'massimo', 'a320', 'b747', 'a380', 'tpose'];
// The worst of each kind in the sweep, a small, a medium and a big one: what `check` measures.
const QUICK_TYPES = ['f22', 'massimo', 'a380', 'skylark', 'tpose'];

export async function check(sim, r, say = () => {}) {
  let bu;
  let cr;
  let T;
  let THREE;
  let A;
  let TY;
  let FS;
  try {
    bu = await import('../../src/features/breakup.js');
    cr = await import('../../src/features/crashes.js');
    T = await import('../../src/world/terrain.js');
    THREE = await import('../../src/vendor/three.module.js');
    A = await import('../../src/aircraft/model-adapter.js');
    TY = await import('../../src/aircraft/types.js');
    FS = await import('../../src/render/flash-safety.js');
  } catch (err) {
    r.ok('crash sweep: the modules load', false, String((err && err.message) || err));
    return;
  }
  const D = () => bu.breakupDebug();
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const reduceWas = sim.settings.reduceFlashing;
  const comicWas = sim.settings.comicEffects;
  const slowWas = sim.settings.crashSlowMo;
  const noDebrief = () => clearTimeout(sim._crashDebriefT);
  const free = (extra = {}) => sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, ...extra });
  const fly = async (id) => {
    await free({ aircraft: id });
    sim.step(0.3);
    if (!sim.aircraftType || sim.aircraftType.id !== id) throw new Error(`flying ${sim.aircraftType && sim.aircraftType.id}, not ${id}`);
  };
  /** A flat patch of dry land, searched for in rings round `from` (nine points 40 m apart, all over 4 m and within 2.5 m of each other), at least `minR` away. */
  const landNear = (from, minR = 150, maxR = 6000) => {
    const flat = (x, z) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const h = T.heightAt(x + i * 40, z + j * 40);
          if (!(h > 4) || T.platformAt(x + i * 40, z + j * 40)) return false;
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
      return hi - lo < 2.5;
    };
    for (let rr = minR; rr <= maxR; rr += 150) {
      const n = Math.max(8, Math.round(rr / 80));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = from.x + Math.cos(a) * rr;
        const z = from.z + Math.sin(a) * rr;
        if (flat(x, z)) return { x, z };
      }
    }
    return null;
  };
  try {
    sim.applySetting('reduceFlashing', true);
    sim.settings.crashSlowMo = true;

    /* ---- 2. sea debris flown in at speed ------------------------------------------------ */
    say('crash sweep: sea debris');
    {
      await fly('skylark');
      const ac = sim.aircraft;
      let spot = null;
      for (let rr = 0; rr <= 12000 && !spot; rr += 200) {
        const n = rr === 0 ? 1 : Math.max(8, Math.round(rr / 100));
        for (let i = 0; i < n && !spot; i++) {
          const a = (i / n) * Math.PI * 2;
          const x = ac.pos.x + Math.cos(a) * rr;
          const z = ac.pos.z + Math.sin(a) * rr;
          let ok = true;
          for (let d = 0; d <= 700 && ok; d += 100) if (T.heightAt(x + d, z) > -8 || T.platformAt(x + d, z)) ok = false;
          if (ok) spot = { x, z };
        }
      }
      if (!spot) {
        r.ok('crash sweep: open sea found for the dive', false, 'none within 12 km');
      } else {
        ac.reset({ pos: new THREE.Vector3(spot.x, 0, spot.z), headingDeg: 90, speed: 50, altAGL: 60, engineOn: true, gearDown: true });
        ac.quat.setFromEuler(new THREE.Euler((-30 * Math.PI) / 180, -Math.PI / 2, 0, 'YXZ'));
        ac.vel.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ac.quat).multiplyScalar(50));
        ac.pos.y = 60;
        sim.override = { pitch: -0.4, roll: 0, yaw: 0, throttle: 0 };
        for (let i = 0; i < 600 && !ac.crashed; i++) {
          sim.update(1 / 60);
          noDebrief();
        }
        sim.override = null;
        const S = D().S;
        const light = S.pieces.filter((p) => p.body.light);
        const sunkAt = {};
        let lightDeep = 0;
        for (let f = 0; f < 240; f++) {
          sim.update(1 / 30);
          noDebrief();
          for (const p of S.pieces) {
            if (p.body.sunk && sunkAt[p.zones.join('+')] == null) sunkAt[p.zones.join('+')] = +((f + 1) / 30).toFixed(1);
          }
          if (f === 179) lightDeep = light.filter((p) => p.body.pos.y < -2).length;
        }
        const earliest = Math.min(...Object.values(sunkAt), 99);
        r.ok('crash sweep: the dive into the sea broke it up and made light pieces and heavy ones', ac.crashed && S.pieces.length >= 4 && light.length >= 1, `${S.pieces.length} pieces, ${light.length} light`);
        r.ok('crash sweep: nothing is "sunk" in the first four seconds (they were all frozen under inside a second)', earliest > 4, `first under at ${earliest} s: ${JSON.stringify(sunkAt)}`);
        r.ok('crash sweep: the light pieces (tips, tailplanes, legs) are still afloat at six seconds', light.length >= 1 && lightDeep === 0 && light.every((p) => !p.body.sunk), `${light.length} light, ${lightDeep} under 2 m at 6 s`);
      }
    }

    /* ---- 3. a knocked aeroplane that comes down on land leaves a wreck ------------------------- */
    say('crash sweep: a wreck on land');
    {
      await fly('skylark');
      const type = TY.getAircraft('a320');
      const m = A.createAircraftModel({ type, landingLight: false });
      // Well clear of the runway and the water.
      const ac = sim.aircraft;
      const at = landNear(ac.pos);
      if (!at) {
        r.ok('crash sweep: a patch of land for a knocked airliner', false, 'none');
      } else {
        const g = T.heightAt(at.x, at.z);
        sim.scene.add(m);
        m.position.set(at.x, g + 1.2, at.z);
        m.updateMatrixWorld(true);
        // As breakup.js onSkyHit does for a knocked aeroplane: it is tracked first (trackNpc, which marks
        // userData.breakupNpc, the flag the "tidied away" hook looks for), then broken. Calling breakModel
        // alone, as this check used to, left the model unmarked, so it could never leave a wreck: the check
        // failed on every build since it was written, while the game's own path was fine.
        D().trackNpc({ pos: m.position, vel: new THREE.Vector3(10, -2, 0) }, m);
        D().breakModel(m, type, { world: m.position.clone().add(new THREE.Vector3(0, -1, 0)), normal: new THREE.Vector3(0, 1, 0), energy: 600, bodyVel: new THREE.Vector3(10, -2, 0), owner: 'npc' });
        sim.step(1);
        const before = D().S.stats.wrecksLanded;
        const piecesBefore = D().S.pieces.length;
        const firesBefore = D().S.fx.emitters.length;
        // What traffic.js retireCraft does with a knocked aeroplane that has come down: out of the scene.
        m.removeFromParent();
        const wreck = D().S.pieces.find((p) => p.zones.join('+') === 'wreck' && p.owner === 'npc');
        r.ok('crash sweep: an aeroplane knocked down over land and tidied away leaves a wreck behind (it left only what had been torn off)', !!wreck && D().S.stats.wrecksLanded === before + 1 && D().S.pieces.length === piecesBefore + 1, `${D().S.stats.wrecksLanded - before} wrecks, ${D().S.pieces.length - piecesBefore} more pieces`);
        if (wreck) {
          const burning = D().S.fx.emitters.length - firesBefore;
          sim.step(10);
          const gh = T.heightAt(wreck.body.pos.x, wreck.body.pos.z);
          r.ok('crash sweep: …it settles on the ground and stays', wreck.body.sleeping && wreck.body.pos.y > gh - 1.5 && wreck.body.pos.y < gh + 6 && !wreck.gone, `asleep ${wreck.body.sleeping}, ${(wreck.body.pos.y - gh).toFixed(2)} m over the ground`);
          r.ok('crash sweep: …and it burns for a while (a fire of its own)', burning >= 1, `${burning} more fires`);
        }
        m.userData.dispose && m.userData.dispose();
      }
    }

    /* ---- 9. a crash right after a teleport ---------------------------------------------------------- */
    say('crash sweep: the replay after a teleport');
    {
      await fly('a320');
      const ac = sim.aircraft;
      sim.step(2);
      // Put somewhere else that has land to crash on (a staged crash needs a spot of it): at least 600 m away.
      const there = landNear(ac.pos, 600, 8000);
      r.ok('crash sweep: dry land to be put down on', !!there, there ? `${Math.round(Math.hypot(there.x - ac.pos.x, there.z - ac.pos.z))} m off` : 'none');
      const far = new THREE.Vector3(there ? there.x : ac.pos.x + 800, 0, there ? there.z : ac.pos.z + 800);
      ac.reset({ pos: far, headingDeg: 90, speed: 60, altAGL: 40, engineOn: true, gearDown: true });
      for (let i = 0; i < 12; i++) {
        sim.update(1 / 60);
        noDebrief();
      }
      const staged = cr.stageCrash(sim, 'bellyflop');
      noDebrief();
      const pre = (D().S.rec && D().S.rec.pre) || [];
      const farOff = pre.filter((f) => f.pos.distanceTo(sim.aircraft.pos) > 500).length;
      r.ok('crash sweep: a crash right after the aeroplane is put somewhere else records no poses from where it was before (and keeps the ones since)', !!staged && !!D().S.rec && pre.length >= 3 && farOff === 0, `${staged ? 'crashed' : 'no crash staged'}; ${pre.length} poses kept, ${farOff} of them over 500 m from the wreck`);
    }

    /* ---- the chase camera and a sliding wreck --------------------------------------------------------- */
    say('crash sweep: the camera and a sliding wreck');
    for (const reduce of [true, false]) {
      sim.applySetting('reduceFlashing', reduce);
      sim.applySetting('comicEffects', false);
      await fly('f22');
      sim.rig.setMode('chase');
      sim.step(0.5);
      cr.stageCrash(sim, 'bellyflop');
      noDebrief();
      sim.rig.initialised = false;
      sim.step(1.2);
      const v1 = sim.rig.chaseVel.length();
      const wreckSpeed = sim.aircraft.vel.length();
      sim.step(0.8);
      const camSpeed = sim.rig.chaseVel.length();
      if (reduce) r.ok('crash sweep: with Reduce flashing the chase camera stops where it is for a sliding wreck, and does not drag along the grass after it', camSpeed < 4, `camera ${v1.toFixed(1)} then ${camSpeed.toFixed(1)} m/s, wreck ${wreckSpeed.toFixed(1)} m/s`);
      else r.ok('crash sweep: …with it off it follows the wreck as it always did', wreckSpeed < 3 || camSpeed > 4, `camera ${v1.toFixed(1)} then ${camSpeed.toFixed(1)} m/s, wreck ${wreckSpeed.toFixed(1)} m/s`);
    }
    sim.applySetting('reduceFlashing', true);

    /* ---- 1. the scenes under the flicker probe ---------------------------------------------------------- */
    say('crash sweep: the flicker probe');
    await sweep(sim, r, say, { types: QUICK_TYPES, kinds: KINDS, modes: [false, true] });
  } catch (err) {
    r.ok('crash sweep: the checks ran', false, String((err && err.stack) || err).slice(0, 300));
  } finally {
    noDebrief();
    sim.autoPauseOnHide = origAuto;
    if (sim.settings.reduceFlashing !== reduceWas) sim.applySetting('reduceFlashing', reduceWas !== false);
    if (sim.settings.comicEffects !== comicWas) sim.applySetting('comicEffects', comicWas === true);
    sim.settings.crashSlowMo = slowWas;
    void FS;
  }
}

/**
 * Every (type, kind, mode) in the lists, each under the flicker probe.
 * `modes` are Comic effects values (false: the real crash, the default; true: the cartoon).
 */
export async function sweep(sim, r, say = () => {}, { types = ALL_TYPES, kinds = KINDS, modes = [false, true], limit = LIMIT } = {}) {
  const cr = await import('../../src/features/crashes.js');
  const P = await import('../flicker-probe.js');
  const isStub = /^\(\)=>\{\}$/.test(String(sim.renderer.render).replace(/\s/g, ''));
  const real = (typeof window !== 'undefined' && window.__realRender) || (isStub ? null : sim.renderer.render);
  const stub = sim.renderer.render;
  const noDebrief = () => clearTimeout(sim._crashDebriefT);
  const reduceWas = sim.settings.reduceFlashing;
  const comicWas = sim.settings.comicEffects;
  const autoWas = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  try {
    if (real) sim.renderer.render = real;
    sim.applySetting('reduceFlashing', true);
    sim.settings.crashSlowMo = true;
    const start = async (id) => {
      await sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, aircraft: id });
      sim.step(0.3);
      sim.rig.setMode('chase');
      sim.step(0.5);
    };
    for (const comic of modes) {
      sim.applySetting('comicEffects', comic);
      for (const id of types) {
        // The first crash in a fresh page, and the first of each type, is thrown away (see the header).
        await start(id);
        cr.stageCrash(sim, 'bellyflop');
        noDebrief();
        await P.measure(sim, { frames: 30, fps: 30, warm: 0, raycast: false });
        noDebrief();
        for (const kind of kinds) {
          say(`crash sweep: ${id} ${kind} (${comic ? 'cartoon' : 'real'})`);
          await start(id);
          const staged = cr.stageCrash(sim, kind);
          noDebrief();
          if (!staged) {
            r.ok(`crash sweep: ${id} ${kind} can be staged`, false, 'stageCrash refused');
            continue;
          }
          // The cartoon has its own crash cam; the real crash is watched by the ordinary one, which is told it is a new flight.
          if (!comic) sim.rig.initialised = false;
          const m = await P.measure(sim, { frames: 90, fps: 30, warm: 0, raycast: false });
          noDebrief();
          const drawn = !!real && m.meanLum.max > 0.01;
          r.ok(`crash sweep: ${id} ${kind} (${comic ? 'cartoon, Comic effects on' : 'the real crash, Comic effects off'}) flashes over under ${(limit * 100).toFixed(0)}% of any 10-degree field (WCAG's line is 25%; Reduce flashing on)`,
            drawn && m.wcagWindow < limit, `${(m.wcagWindow * 100).toFixed(1)}% (area ${(m.wcagArea * 100).toFixed(2)}%)${drawn ? '' : ' NOT drawn'}`);
        }
      }
    }
  } finally {
    noDebrief();
    sim.renderer.render = stub;
    sim.autoPauseOnHide = autoWas;
    if (sim.settings.reduceFlashing !== reduceWas) sim.applySetting('reduceFlashing', reduceWas !== false);
    if (sim.settings.comicEffects !== comicWas) sim.applySetting('comicEffects', comicWas === true);
  }
}
