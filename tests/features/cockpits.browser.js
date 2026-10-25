/**
 * The cockpits in the real game (tests/features/cockpits.mjs holds them to
 * their exteriors headless, in far more detail). What only a page can show:
 *
 *   - each family's cockpit is built on the model the game actually draws
 *     (the pack's jets and airliners, the Blender helicopter) and not the
 *     generic fallback, with no console error;
 *   - in the cockpit view its screens show what the flight model says this
 *     second (speed, height, heading), and they keep repainting;
 *   - the exterior's tinted canopy is fitted to vanish from inside (jets);
 *   - the sun's shadow map comes in round the eye in the cockpit view and
 *     goes back out in the follow view;
 *   - a finger can look round in the cockpit view and nowhere else.
 */
const KTS = 1.94384;
const FT = 3.28084;
// One of each room, and the types added after v67 (their decks are cut
// from their own noses; the Black Hawk flies on glass; the A-10 and the B-1B
// on centre sticks).
const IDS = ['fa18', 'f22', 'nightjar', 'a320', 'b747', 'harrier', 'skylark', 'b777', 'q400', 'c17', 'b1b', 'a10', 'uh60', 'ah64'];
const FAMILY = { fa18: 'jet', f22: 'jet', nightjar: 'jet', a320: 'airliner', b747: 'airliner', harrier: 'heli', skylark: 'light', b777: 'airliner', q400: 'airliner', c17: 'airliner', b1b: 'airliner', a10: 'jet', uh60: 'heli', ah64: 'heli' };

export async function check(sim, r, say) {
  const calm = { time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90, airborne: true };
  const errors = [];
  const origError = console.error;
  console.error = (...a) => {
    errors.push(a.map(String).join(' ').slice(0, 200));
    origError.apply(console, a);
  };
  const realistic = !!(sim.settings && sim.settings.realisticCockpit);
  try {
    for (const id of IDS) {
      try {
        say(`cockpits: ${id}`);
        await sim.startMode('free', { ...calm, aircraft: id });
        sim.rig.setMode('cockpit');
        sim.step(1.0);
        const cp = sim.cockpit;
        const ud = cp.userData;
        r.ok(`cockpits: ${id} is built by the ${FAMILY[id]} builder in the game`, String(ud.builder).startsWith(`${FAMILY[id]}:`), ud.builder);
        r.ok(`cockpits: ${id} shows in the cockpit view`, cp.visible === true);
        if (ud.displays && ud.displays.length) {
          const before = ud.displays.map((d) => d.paints);
          sim.step(0.5);
          r.ok(`cockpits: ${id}'s screens keep repainting in flight`, ud.displays.every((d, i) => d.paints > before[i]), ud.displays.map((d, i) => d.paints - before[i]).join(','));
          const shown = ud.bus.data.shown || {};
          const flight = Object.values(shown).filter((v) => v && typeof v === 'object' && 'ias' in v);
          const ias = (sim.aircraft.ias || 0) * KTS;
          const alt = (sim.aircraft.alt || 0) * FT;
          if (flight.length) {
            r.ok(`cockpits: ${id}'s screens show this flight's speed and height`, flight.every((v) => Math.abs(v.ias - ias) < 8 && Math.abs(v.alt - alt) < 60), JSON.stringify(flight.map((v) => [v.ias, v.alt])) + ` vs ${ias.toFixed(0)} kt ${alt.toFixed(0)} ft`);
          } else {
            // The helicopter's one screen is its map: it flies on round dials
            // (gauges.js), whose smoothed readings are what the needles show.
            const sm = ud.panel && ud.panel.smooth;
            r.ok(`cockpits: ${id}'s dials show this flight's speed and height`, !!sm && Math.abs(sm.ias - ias) < 8 && Math.abs(sm.alt - alt) < 60, sm ? `${sm.ias.toFixed(0)} kt ${sm.alt.toFixed(0)} ft vs ${ias.toFixed(0)} kt ${alt.toFixed(0)} ft` : 'no dials');
          }
        }
        {
          // The moving parts are skinned batches (kit.js batchMovers): with
          // the stick held over, each piece is drawn where its part now is.
          sim.override = { roll: 0.7, pitch: 0.3, yaw: 0.5 };
          sim.step(0.5);
          sim.override = null;
          cp.updateMatrixWorld(true);
          let parts = 0;
          let worst = 0;
          const a = new cp.position.constructor();
          const b = new cp.position.constructor();
          cp.traverse((o) => {
            if (!o.isSkinnedMesh || !o.userData.parts) return;
            o.skeleton.update();
            for (const p of o.userData.parts) {
              parts++;
              const g = p.mesh.geometry;
              a.fromBufferAttribute(g.attributes.position, g.index ? g.index.getX(0) : 0).applyMatrix4(p.mesh.matrixWorld);
              b.fromBufferAttribute(o.geometry.attributes.position, p.start);
              o.applyBoneTransform(p.start, b).applyMatrix4(o.matrixWorld);
              worst = Math.max(worst, a.distanceTo(b));
            }
          });
          r.ok(`cockpits: ${id}'s sticks, levers and pedals are drawn where the pilot has moved them`, parts > 0 && worst < 1e-4, `${parts} parts, worst ${worst.toExponential(1)} m`);
        }
        if (FAMILY[id] === 'jet') {
          let n = 0;
          sim.model.traverse((o) => { if (o.isMesh && o.userData.seeThrough) n++; });
          r.ok(`cockpits: ${id}'s exterior glass is fitted to vanish from inside`, n > 0, `${n}`);
        }
        if (sim.sky && sim.sky.sun && sim.sky.sun.shadow && sim.renderer.shadowMap.enabled) {
          sim.step(0.1);
          const inR = sim.sky.sun.shadow.camera.right;
          sim.rig.setMode('chase');
          sim.step(0.1);
          const outR = sim.sky.sun.shadow.camera.right;
          r.ok(`cockpits: ${id}: the sun's shadows come in round the eye in the cockpit and go back out after`, inR <= 20 && outR >= 100, `${inR} / ${outR}`);
          r.ok(`cockpits: ${id}: a finger looks round only in the cockpit view`, sim.input.touchLook === false);
          sim.rig.setMode('cockpit');
          sim.step(0.1);
          r.ok(`cockpits: ${id}: ...and does in it`, sim.input.touchLook === true);
        }
      } catch (e) {
        r.ok(`cockpits: ${id} ran`, false, String(e && e.stack).slice(0, 300));
      }
    }
    // The guidance rails glow through hills in the follow view; from the seat
    // the panel and the frames hide them (they ran across the screens).
    if (sim.navGuide && sim.navGuide.left) {
      sim.rig.setMode('cockpit');
      sim.step(0.1);
      const seatDepth = sim.navGuide.left.mat.depthTest && sim.navGuide.right.mat.depthTest;
      sim.rig.setMode('chase');
      sim.step(0.1);
      const chaseDepth = sim.navGuide.left.mat.depthTest || sim.navGuide.right.mat.depthTest;
      r.ok('cockpits: the guidance rails are hidden by the cockpit from the seat, and glow over everything outside it', seatDepth === true && chaseDepth === false, `seat ${seatDepth} / chase ${chaseDepth}`);
    }
    const mine = errors.filter((e) => /cockpit|display|flightdeck|deck-skin|kit\.js|jet\.js|heli\.js/i.test(e));
    r.ok('cockpits: no console error from the cockpits', mine.length === 0, mine.slice(0, 3).join(' | '));
  } finally {
    console.error = origError;
    if (sim.applySetting) sim.applySetting('realisticCockpit', realistic);
    sim.rig.setMode('chase');
  }
}
