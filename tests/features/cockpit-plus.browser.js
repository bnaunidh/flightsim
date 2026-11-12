/**
 * features/cockpit-plus in the real game (tests/features/cockpit-plus.mjs holds
 * every room headless). What only a page can show:
 *
 *   - nothing is fetched or added until the player sits in a cockpit; then the
 *     pilot, the bezels and the night arrive, once per room (and again after
 *     remountCockpit())
 *   - the pilot is drawn (a draw of its own on the real renderer) and his hands
 *     stay on the controls when the game's own input moves them
 *   - at night the cabin is darker than by day and the flood is on; back to
 *     day, every colour as it was
 *   - High and Low, no console error
 */
export async function check(sim, r, say = () => {}) {
  const THREE = await import('../../src/vendor/three.module.js');
  const { relMatrix } = await import('../../src/features/cockpit-plus/pilot.js');
  const errors = [];
  const origError = console.error;
  console.error = (...a) => {
    errors.push(a.map(String).join(' ').slice(0, 200));
    origError.apply(console, a);
  };
  const qWas = sim.settings.quality;
  // The self-test may stub the renderer out; the draw count needs the real one.
  const stub = sim.renderer.render;
  const isStub = /^\(\)=>\{\}$/.test(String(stub).replace(/\s/g, ''));
  const real = (typeof window !== 'undefined' && window.__realRender) || (isStub ? null : stub);
  if (real) sim.renderer.render = real;
  const settle = async () => {
    sim.step(0.3);
    await import('../../src/features/cockpit-plus/index.js');
    for (let i = 0; i < 10 && !(sim.cockpit.userData.plus && sim.cockpit.userData.plus.night); i++) {
      await new Promise((res) => setTimeout(res, 50));
      sim.step(0.1);
    }
    return sim.cockpit.userData.plus;
  };
  try {
    for (const [q, ids] of [['high', ['skylark', 'a320', 'f22', 'h145']], ['low', ['skylark', 'f35b', 'uh60']]]) {
      sim.applySetting('quality', q);
      for (const id of ids) {
        const tag = `${id} (${q})`;
        say(`cockpit plus: ${tag}`);
        await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90, airborne: true, aircraft: id });
        sim.step(0.2);
        r.ok(`cockpit plus: ${tag}: nothing added before you sit in it`, !sim.cockpit.userData.plus);
        sim.rig.setMode('cockpit');
        const made = await settle();
        r.ok(`cockpit plus: ${tag}: the pilot, bezels and night arrive in the seat`, !!made && !!made.pilot && !!made.night, made ? `${made.draws} draws` : 'none');
        if (!made || !made.pilot) continue;
        // Drawn: the renderer's draw count with the pilot shown and hidden.
        const info = sim.renderer.info;
        const draw = () => {
          info.autoReset = false;
          info.reset();
          sim.renderer.render(sim.scene, sim.camera);
          const n = info.render.calls;
          info.autoReset = true;
          return n;
        };
        const withPilot = draw();
        made.pilot.mesh.visible = false;
        const without = draw();
        made.pilot.mesh.visible = true;
        r.ok(`cockpit plus: ${tag}: the pilot is drawn, one draw`, withPilot - without === 1, `${without} -> ${withPilot}`);
        sim.override = { roll: 0.8, pitch: 0.5, yaw: 0.6, throttle: 0.2 };
        sim.step(1);
        const cp = sim.cockpit;
        let worst = 0;
        const m = new THREE.Matrix4();
        const v = new THREE.Vector3();
        for (const h of made.pilot.hands) {
          if (h.g.multi) continue;
          v.copy(h.g.c).applyMatrix4(relMatrix(cp, h.g.o, m));
          worst = Math.max(worst, v.distanceTo(h.hb.position));
        }
        sim.override = null;
        r.ok(`cockpit plus: ${tag}: the hands stay on the controls the game moved`, made.pilot.hands.length > 0 && worst < 1e-3, `${made.pilot.hands.length} hands, ${worst.toExponential(1)} m`);
        if (q === 'high') {
          const x = made.night.mats.find((k) => !k.own && k.color.r > 0.05);
          sim.weather.time = 'night';
          sim.step(3);
          const dark = x && x.m.color.r < x.color.r * 0.7;
          const flood = made.night.mats.some((k) => k.flood && !k.own && k.m.emissiveIntensity > 0 && k.m.emissive.r > 0);
          sim.weather.time = 'day';
          sim.step(4);
          const back = made.night.mats.every((k) => k.m.color.equals(k.color));
          r.ok(`cockpit plus: ${tag}: dark at night under the flood, as it was by day`, !!dark && flood && back, `dark ${dark} flood ${flood} back ${back}`);
          if (id === 'skylark') {
            sim.remountCockpit();
            const again = await settle();
            r.ok('cockpit plus: a cockpit built again in flight gets its pilot again', !!again && !!again.pilot && sim.cockpit.userData.remounted > 0);
          }
        }
        sim.rig.setMode('chase');
        sim.quitToMenu('main');
      }
    }
    const mine = errors.filter((e) => /cockpit|pilot|bezel/i.test(e));
    r.ok('cockpit plus: no console error', mine.length === 0, mine.slice(0, 3).join(' | '));
  } catch (e) {
    r.ok('cockpit plus: the checks ran', false, String((e && e.stack) || e).slice(0, 400));
  } finally {
    console.error = origError;
    sim.renderer.render = stub;
    sim.override = null;
    sim.applySetting('quality', qWas);
    if (sim.state !== 'menu') sim.quitToMenu('main');
  }
}
