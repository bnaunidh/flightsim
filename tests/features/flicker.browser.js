/**
 * Browser checks for the flicker fix — the owner: "graphic errors that can
 * cause seziure" — measured on the real renderer with tests/flicker-probe.js:
 * two seconds of steady flight at 30 frames a second, every frame read back,
 * every pixel's brightness reversals counted.
 *
 *   1. The wiring: Reduce flashing on by default, in Settings → Graphics,
 *      switching it flips the effects' switch; the sea's layers carry their
 *      depth offsets and the terrain its sea cut.
 *   2. The worst places the probe found before the fix, flown again:
 *        the owner's screenshot   Kestrel, 27,700 ft, chase, diving   2.95%
 *        the worst of the sweep   the atoll, 27,000 ft, sunset         16.1%
 *        high and far             Kestrel, 45,000 ft, chase, diving    6.80%
 *        the cockpit              Kestrel, 27,000 ft, level            5.26%
 *      (the share of the screen flickering more than three times a second
 *      by the probe's perceptual measure, 0.05 of display brightness).
 *      Each must now stay under FLICKER_MAX of the screen, and the worst
 *      third-of-the-screen window under WCAG_WINDOW_MAX by the standard's
 *      own measure (0.10 of relative luminance).
 *   3. A lightning strike with Reduce flashing on changes no more than
 *      LIGHTNING_MAX of the screen by WCAG's 0.10 beyond what the same two
 *      seconds change without one.
 *   4. Last Flight Out's worst frames (src/features/scp-escape.js): the
 *      warhead going off 5.5 km from the aeroplane, seen from the air with
 *      the Site in view — measured like the lightning strike, against the
 *      same two seconds of the same night sky without it (the night sky over
 *      Nunatak measures 2.4% on its own, aurora and cloud, warhead or no
 *      warhead; the probe said so to the pixel): the dome and the column add
 *      under FLICKER_MAX of flicker, under WCAG_WINDOW_MAX of WCAG flashing
 *      and under LIGHTNING_MAX of full-screen swing. And the apron with every
 *      sector gone dark and the red lamps pulsing, under the places' own
 *      limits.
 *
 * WHY THESE NUMBERS. After the fix the four places measure 0.03-0.10% (the
 * cockpit about 0.2%): what is left is a ship's deck markings at 11 km and
 * the odd thin line shimmering as the world slides by. FLICKER_MAX = 0.5% is
 * five times that, for another GPU's rounding, and still six to thirty times
 * under what each place measured before. WCAG fails a flash that covers a
 * quarter of a 10-degree field (a third of the screen each way); the
 * windows measure under 1% after the fix and up to 54% before, so
 * WCAG_WINDOW_MAX = 2% leaves room and catches any return of the strobe.
 *
 * Leaves the player's map, the setting and the game on the menu as it found
 * them. `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const FLICKER_MAX = 0.005;
export const WCAG_WINDOW_MAX = 0.02;
export const LIGHTNING_MAX = 0.1;

async function load(path) {
  try {
    return await import(path);
  } catch (e) {
    return { __error: String((e && e.message) || e) };
  }
}

export const SPOTS = [
  { name: "the owner's screenshot: Kestrel, 27,700 ft, chase, diving", map: 'kestrel', altFt: 27700, view: 'chase', look: 'down', was: 0.0295 },
  { name: 'the atoll at sunset, 27,000 ft, chase, diving', map: 'atoll', altFt: 27000, view: 'chase', look: 'down', time: 'sunset', was: 0.1612 },
  { name: 'Kestrel, 45,000 ft, chase, diving', map: 'kestrel', altFt: 45000, view: 'chase', look: 'down', was: 0.068 },
  { name: 'the cockpit, Kestrel, 27,000 ft, level', map: 'kestrel', altFt: 27000, view: 'cockpit', look: 'level', was: 0.0526 },
];

export async function check(sim, r, say = () => {}) {
  say('flicker: loading');
  const P = await load('../flicker-probe.js');
  const FS = await load('../../src/render/flash-safety.js');
  const DL = await load('../../src/render/depth-layers.js');
  const T = await load('../../src/world/terrain.js');
  const mods = { P, FS, DL, T };
  const missing = Object.entries(mods).filter(([, m]) => !m || m.__error).map(([k, m]) => `${k}: ${m && m.__error}`);
  r.ok('flicker: its modules load', missing.length === 0, missing.join(' | '));
  if (missing.length) return r;

  const startMap = sim.settings.map;
  const startReduce = sim.settings.reduceFlashing;
  const pct = (x) => `${(x * 100).toFixed(2)}%`;
  try {
    /* ---- 1. wiring ---- */
    const html = document.documentElement.classList;
    r.ok('flicker: Reduce flashing is on by default and in force',
      sim.settings.reduceFlashing !== false && FS.FLASH.reduce === true && html.contains('reduce-flashing'),
      `setting ${sim.settings.reduceFlashing}, switch ${FS.FLASH.reduce}`);
    const box = sim.menus && sim.menus.screens && sim.menus.screens.settings
      ? sim.menus.screens.settings.querySelector('[data-panel="graphics"] [data-set="reduceFlashing"]')
      : document.querySelector('[data-panel="graphics"] [data-set="reduceFlashing"]');
    r.ok('flicker: Settings → Graphics has the Reduce flashing box', !!box && box.type === 'checkbox');
    sim.applySetting('reduceFlashing', false);
    const offOk = FS.FLASH.reduce === false && !html.contains('reduce-flashing');
    sim.applySetting('reduceFlashing', true);
    r.ok('flicker: switching it off and on again reaches the effects', offOk && FS.FLASH.reduce === true && html.contains('reduce-flashing'));

    const deep = DL.SEA_DEPTH.deep;
    const band = DL.SEA_DEPTH.band;
    const offset = (m, want) => !!m && m.polygonOffset === true && m.polygonOffsetUnits === want.polygonOffsetUnits && m.polygonOffsetFactor === want.polygonOffsetFactor;
    r.ok('flicker: the deep sea and the swell carry their depth offsets', !!sim.ocean && offset(sim.ocean.deepMat, deep) && offset(sim.ocean.swellMat, band));
    const named = (n) => {
      const out = [];
      sim.scene.traverse((o) => o.name === n && o.material && out.push(o.material));
      return out;
    };
    const bands = [...named('shallows'), ...named('surf'), ...named('reef')];
    r.ok('flicker: every shallows, surf and reef band sits behind the land', bands.length > 0 && bands.every((m) => offset(m, band)), `${bands.length} bands`);
    const chunks = sim.terrain ? sim.terrain.children.filter((c) => c.isMesh) : [];
    r.ok('flicker: every terrain chunk is cut at sea level', chunks.length > 0 && chunks.every((c) => c.onBeforeRender === T.seaCut), `${chunks.length} chunks`);

    /* ---- 2. the worst places ---- */
    for (const s of SPOTS) {
      say(`flicker: ${s.name}`);
      const m = await P.runScenario(sim, s, { frames: 60, fps: 30, raycast: false });
      r.ok(`flicker: ${s.name} — under ${pct(FLICKER_MAX)} of the screen flickers (was ${pct(s.was)})`, m.percArea <= FLICKER_MAX,
        `${pct(m.percArea)}, worst window ${pct(m.percWindow)}`);
      r.ok(`flicker: ${s.name} — WCAG flashing under ${pct(WCAG_WINDOW_MAX)} of any 10-degree field`, m.wcagWindow <= WCAG_WINDOW_MAX,
        `${pct(m.wcagWindow)} (area ${pct(m.wcagArea)})`);
    }

    /* ---- 3. a lightning strike ---- */
    say('flicker: a lightning strike');
    const storm = { map: 'kestrel', altFt: 5000, view: 'chase', look: 'level', time: 'sunset', condition: 'stormy', lightningAt: 99 };
    const calm = await P.runScenario(sim, storm, { frames: 45, fps: 30, raycast: false });
    const struck = await P.runScenario(sim, { ...storm, events: [{ at: 0.5, kind: 'lightning' }] }, { frames: 45, fps: 30, raycast: false });
    const extra = struck.swingArea - calm.swingArea;
    r.ok(`flicker: with Reduce flashing a lightning strike swings under ${pct(LIGHTNING_MAX)} of the screen by WCAG's 0.10`, extra <= LIGHTNING_MAX,
      `${pct(extra)} more than the same sky without one (${pct(struck.swingArea)} vs ${pct(calm.swingArea)})`);

    /* ---- 4. Last Flight Out's worst frames ---- */
    say('flicker: Last Flight Out, the warhead from the air');
    const Esc = await load('../../src/features/scp-escape.js');
    const THREE = await load('../../src/vendor/three.module.js');
    if (Esc.__error || THREE.__error) {
      r.ok('flicker: Last Flight Out loads', false, Esc.__error || THREE.__error);
    } else {
      sim.autoPauseOnHide = false;
      // The same place twice: 5.5 km out, turned to face the Site so the dome is in the picture, the chase view
      // behind, the aeroplane holding its velocity (the flight model set aside, as the places above are measured).
      const place = async () => {
        if (sim.state !== 'menu') sim.quitToMenu('main');
        await sim.startMode('mission', { id: 'last-flight', seed: 7 });
        const ac = sim.aircraft;
        const c = T.MAP.scp;
        const px = c.cx - 3900;
        const pz = c.cz + 3900;
        const hdg = (Math.atan2(c.cx - px, -(c.cz - pz)) * 180) / Math.PI;
        ac.reset({ pos: new THREE.Vector3(px, 0, pz), headingDeg: hdg, speed: 90, altAGL: 700, engineOn: true, gearDown: false });
        sim.rig.setMode('chase');
        sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0.7 };
        const own = Object.prototype.hasOwnProperty.call(ac, 'update') ? ac.update : null;
        ac.update = function steady(dt) { this.pos.addScaledVector(this.vel, dt); };
        sim._flickerRestore = () => { if (own) ac.update = own; else delete ac.update; sim._flickerRestore = null; };
        sim.step(1);
      };
      await place();
      const calmSky = await P.measure(sim, { frames: 60, fps: 30, raycast: false });
      sim._flickerRestore();
      await place();
      Esc.__escape.detonateIn(0.3);
      const blast = await P.measure(sim, { frames: 60, fps: 30, raycast: false });
      const st = Esc.escapeState();
      r.ok('flicker: Last Flight Out — the warhead went during the two seconds measured (the dome, the column)', !!(st && st.blast), st ? `blast ${!!st.blast}` : 'no run');
      const extraPerc = blast.percArea - calmSky.percArea;
      const extraWcag = blast.wcagWindow - calmSky.wcagWindow;
      const extraSwing = blast.swingArea - calmSky.swingArea;
      r.ok(`flicker: Last Flight Out — the warhead from 5.5 km adds under ${pct(FLICKER_MAX)} of flicker to the same night sky without it`, extraPerc <= FLICKER_MAX,
        `${pct(extraPerc)} more (${pct(blast.percArea)} vs ${pct(calmSky.percArea)} — the sky's own, aurora and cloud)`);
      r.ok(`flicker: Last Flight Out — the warhead adds under ${pct(WCAG_WINDOW_MAX)} of WCAG flashing in any 10-degree field`, extraWcag <= WCAG_WINDOW_MAX,
        `${pct(extraWcag)} more (${pct(blast.wcagWindow)} vs ${pct(calmSky.wcagWindow)})`);
      r.ok(`flicker: Last Flight Out — with Reduce flashing the dome swings under ${pct(LIGHTNING_MAX)} of the screen by WCAG's 0.10 (no full-screen white)`, extraSwing <= LIGHTNING_MAX,
        `${pct(extraSwing)} more (${pct(blast.swingArea)} vs ${pct(calmSky.swingArea)})`);
      sim._flickerRestore();
      sim.override = null;
      sim.quitToMenu('main');

      say('flicker: Last Flight Out, the dark apron');
      await sim.startMode('mission', { id: 'last-flight', seed: 7 });
      Esc.__escape.loseThrough(5);
      sim.rig.setMode('chase');
      sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 };
      sim.step(3);
      const apron = await P.measure(sim, { frames: 60, fps: 30, raycast: false });
      const st2 = Esc.escapeState();
      r.ok('flicker: Last Flight Out — every sector dark on the apron, the red lamps pulsing', !!st2 && st2.lost === 6 && st2.lamps.every((l) => l.lost), st2 ? `${st2.lost} lost` : 'no run');
      r.ok(`flicker: Last Flight Out — the dark apron: under ${pct(FLICKER_MAX)} of the screen flickers`, apron.percArea <= FLICKER_MAX, `${pct(apron.percArea)}, worst window ${pct(apron.percWindow)}`);
      r.ok(`flicker: Last Flight Out — the dark apron: WCAG flashing under ${pct(WCAG_WINDOW_MAX)} of any 10-degree field`, apron.wcagWindow <= WCAG_WINDOW_MAX, `${pct(apron.wcagWindow)} (area ${pct(apron.wcagArea)})`);
      sim.override = null;
      sim.quitToMenu('main');
    }
  } catch (e) {
    r.ok('flicker: the probe ran', false, String((e && e.stack) || e).slice(0, 400));
  } finally {
    if (sim._flickerRestore) sim._flickerRestore();
    sim.override = null;
    if (sim.settings.reduceFlashing !== startReduce) sim.applySetting('reduceFlashing', startReduce !== false);
    if (sim.state !== 'menu' && typeof sim.quitToMenu === 'function') sim.quitToMenu('main');
    if (startMap && sim.settings.map !== startMap) {
      const before = sim.scenery;
      sim.setMap(startMap);
      for (let i = 0; i < 600 && (sim.scenery === before || T.MAP.id !== startMap); i++) await new Promise((f) => setTimeout(f, 10));
    }
  }
  return r;
}
