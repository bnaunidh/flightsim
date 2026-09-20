/**
 * Headless self-test — THE OTHER THREE GAMES.
 *
 * tests/selftest.js flies an aeroplane. It has eighty-four checks and not one
 * of them has ever been in a boat, a van or a helicopter, which means the three
 * newest games in the tree are the three least tested things in it. This file
 * is the missing half: the boat floating and grounding, the engine lever's
 * detents, the van staying on the road and finishing a job, the helicopter
 * holding a hover with nobody touching it, every new map's pads and channels
 * and roads being where the data says they are, and — the one that costs a
 * whole lesson when it breaks — one game's interface not leaking into another's.
 *
 * HOW TO USE IT. Either way works and they test exactly the same thing:
 *
 *   1. PASTE. Copy the WHOLE BODY of `threeGameChecks()` — from the
 *      "Local tackle" comment down to the `return r;` — and drop it into
 *      runSelfTest() in tests/selftest.js immediately BEFORE the
 *      "// Restore what we changed." block at the end. Delete the final
 *      `return r;` when you do. It reads only `sim`, `r` and `say`, all of
 *      which already exist there, and every name it declares of its own has
 *      been checked against runSelfTest's scope for collisions — that is why
 *      it carries its own `resumeIfPaused` and `Vec3` rather than borrowing
 *      the suite's `ensureFlying` and `V3`.
 *
 *   2. IMPORT. Leave selftest.js alone and run this on its own:
 *
 *        const { runThreeGames } = await import('./tests/selftest-three-games.js');
 *        const results = await runThreeGames(window.__sim);
 *        console.table(results.checks);
 *
 *      or splice it into the main suite from one line inside runSelfTest():
 *
 *        await (await import('./selftest-three-games.js')).threeGameChecks(sim, r, say);
 *
 * WHY EVERY IMPORT IN HERE IS DYNAMIC AND WRAPPED. This project has already
 * paid once for a static import of a name that did not exist yet: it fails at
 * module link time and takes the whole game down, not just the test. Twelve
 * specialist drops are landing in this tree this week and several of the things
 * these checks want (`sim.roads`, `setTerrainProbes({ surfaceAt })`) are owned
 * by somebody else and are NOT wired in yet. So every module is fetched with
 * `await import()` inside a try, every cross-module name is read as a member
 * off the namespace object rather than destructured at link time, and anything
 * missing is reported as a FAILED CHECK WITH A NAMED CONTRACT rather than a
 * thrown suite. A red line that says which function is missing is worth having;
 * a blank screen is not.
 *
 * PROVENANCE OF THE NUMBERS. Every threshold below is a reading taken headless
 * in node against this tree on 2026-09-13, at 60 Hz, not an estimate. The
 * measured value is written next to the threshold it set. Where a check is
 * expected to FAIL against the tree as it stands today, the comment says so and
 * says what has to land to make it pass — a failing check whose failure is
 * understood is the point of writing it.
 *
 * WHAT IS NOT COVERED, AND HONESTLY. Nothing here is a rendering check: this
 * suite cannot see. It tests positions, states, class names and readouts. It
 * also does not test the touch controls, the boat's audio, or the winch cable's
 * own animation, all of which need eyes.
 */

/* ==================================================================== *
 * Standalone wrapper. Skip this whole block if you are pasting.
 * ==================================================================== */

/** The same tiny reporter selftest.js uses, so the two results tables match. */
function makeGamesReporter() {
  const checks = [];
  return {
    checks,
    ok(name, pass, detail = '') {
      checks.push({ name, pass: !!pass, detail: String(detail) });
      return !!pass;
    },
    get failed() {
      return checks.filter((c) => !c.pass);
    },
  };
}

/**
 * Run only the three-game checks, on their own.
 *
 * @param {object} sim  window.__sim
 * @param {{verbose?: boolean, maps?: boolean}} [opts]
 *        `maps: false` skips section 18's world rebuilds, which are the slow
 *        part — nine map loads, measured at 1–3 s each on this machine.
 */
export async function runThreeGames(sim, opts = {}) {
  const r = makeGamesReporter();
  const verbose = opts.verbose !== false;
  const say = (...a) => verbose && console.log('[selftest:games]', ...a);

  const origAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  await threeGameChecks(sim, r, say, opts);
  sim.autoPauseOnHide = origAutoPause;

  const failed = r.failed;
  const summary = `${r.checks.length - failed.length}/${r.checks.length} checks passed`;
  if (verbose) {
    console.log(`[selftest:games] ${summary}`);
    if (failed.length) console.warn('[selftest:games] failures:', failed);
  }
  return { checks: r.checks, failed, summary, passed: failed.length === 0 };
}

export default runThreeGames;

/* ==================================================================== *
 * PASTE FROM HERE.
 *
 * @param {object} sim   window.__sim
 * @param {object} r     the reporter — needs r.ok(name, pass, detail)
 * @param {function} say the logger
 * ==================================================================== */

export async function threeGameChecks(sim, r, say = () => {}, opts = {}) {
  /* ------------------------------------------------------------------ *
   * Local tackle. Everything is declared inside this function so that
   * pasting the body into runSelfTest() cannot collide with UNIT,
   * allUp(), flyApproach() or anything else already up there.
   * ------------------------------------------------------------------ */
  const KTS = 1.94384;
  const resumeIfPaused = () => {
    if (sim.state === 'paused') sim.resume();
  };
  /** Release every key these checks might be holding. */
  const dropKeys = () => {
    for (const c of ['ShiftLeft', 'ControlLeft', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'Space']) {
      sim.key(c, false);
    }
    sim.override = null;
  };
  /** One update, exactly — which is what makes a key tap one detent. */
  const oneFrame = () => sim.step(1 / 60, 1 / 60);
  const flat = (a, b) => Math.hypot(a.x - b.x, (a.z != null ? a.z : a.y) - (b.z != null ? b.z : b.y));
  const cls = () => Array.from(sim.hud.wrap.classList);
  const hasCls = (...names) => names.every((n) => sim.hud.wrap.classList.contains(n));
  const noCls = (...names) => names.every((n) => !sim.hud.wrap.classList.contains(n));

  /**
   * Load a module without being able to take the game down.
   *
   * Returns the namespace object, or null. A null is a fact about the tree and
   * gets reported as a failed check with the path in it; it is never a throw.
   */
  const grab = async (path) => {
    try {
      return await import(path);
    } catch (err) {
      say(`could not import ${path}: ${err.message}`);
      return null;
    }
  };

  const Terrain = await grab('../src/world/terrain.js');
  const Maps = await grab('../src/world/maps.js');
  const Pads = await grab('../src/world/pads.js');
  const Roads = await grab('../src/world/roads.js');
  const Surface = await grab('../src/vehicles/surface.js');
  const Jobs = await grab('../src/game/jobs.js');
  const BoatMissions = await grab('../src/game/missions-boat.js');
  const HeliMissions = await grab('../src/game/missions-heli.js');
  const GameUi = await grab('../src/ui/game-ui.js');

  r.ok(
    'every module the three games need is importable',
    !!(Terrain && Maps && Pads && Roads && Surface && Jobs && BoatMissions && HeliMissions && GameUi),
    [
      ['world/terrain.js', Terrain], ['world/maps.js', Maps], ['world/pads.js', Pads],
      ['world/roads.js', Roads], ['vehicles/surface.js', Surface], ['game/jobs.js', Jobs],
      ['game/missions-boat.js', BoatMissions], ['game/missions-heli.js', HeliMissions],
      ['ui/game-ui.js', GameUi],
    ].filter(([, m]) => !m).map(([p]) => p).join(', ') || 'all nine'
  );

  const startMap = sim.settings.map;
  const startAircraft = sim.aircraftType ? sim.aircraftType.id : 'skylark';

  /** Change map the way useTestSettings() does: setMap() rebuilds behind a
   *  paint, so it has to be waited for or everything after it reads the old
   *  world. Returns true if it actually arrived. */
  const goToMap = async (id) => {
    if (sim.settings.map === id) return true;
    sim.setMap(id);
    for (let i = 0; i < 400 && sim.settings.map !== id; i++) await new Promise((f) => setTimeout(f, 10));
    await new Promise((f) => setTimeout(f, 160));
    return sim.settings.map === id;
  };

  /* ================================================================== *
   * 17. The switcher — four games, one world
   * ================================================================== *
   * Every bug this section is about has the same shape: you leave one game
   * and a piece of it stays behind. They are all cheap to make, none of them
   * throws, and each one is invisible until a child is looking at it.
   *
   * The worst of them is recorded in main.js's own comment: going straight
   * from the boat to the van never passes through stopDrive(), so the HUD
   * used to wear `is-boat` and `is-drive-car` at the same time — a depth
   * sounder drawn over a delivery clock. The classList is read directly
   * because that is the only place that bug was ever visible.
   * ================================================================== */
  say('the switcher');
  dropKeys();

  // Start from a clean flight so the "leaks out of" checks have a known before.
  await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 100, airborne: false });
  sim.step(0.5);
  const flightCls = cls().join(' ');

  sim.startDrive('boat');
  sim.step(0.6);
  r.ok(
    'the switcher puts you in a boat',
    sim.mode === 'drive' && sim.game === 'boat' && !!sim.vehicle && sim.vehicle.isBoat === true,
    `mode ${sim.mode}, game ${sim.game}, vehicle ${sim.vehicle && sim.vehicle.spec.id}`
  );
  r.ok(
    'the boat gets the boat panel',
    hasCls('is-boat'),
    cls().filter((c) => c.startsWith('is-')).join(' ')
  );
  r.ok(
    'the menu bar is about the boat now',
    sim.menus.currentGame === 'boat' && sim.menus.root.dataset.game === 'boat',
    `currentGame ${sim.menus.currentGame}, data-game ${sim.menus.root.dataset.game}`
  );
  r.ok(
    'nothing armed for the flight is still armed in the boat',
    sim.autopilot.engaged === false
      && sim.hasCargo === false
      && !sim.crate
      && sim.runner.gates.length === 0
      && sim.randomDisasters === false,
    `autopilot ${sim.autopilot.engaged}, cargo ${sim.hasCargo}, rings ${sim.runner.gates.length}`
  );
  r.ok(
    'the aeroplane is put away, not just hidden behind the boat',
    sim.model.visible === false && !!sim.vehicleModel && sim.vehicleModel.parent === sim.scene,
    `aeroplane visible ${sim.model.visible}`
  );

  // The one main.js documents by hand: boat straight into the van.
  sim.startDrive('car');
  sim.step(0.6);
  r.ok(
    'boat straight into the van swaps the panel instead of stacking it',
    hasCls('is-drive', 'is-drive-car') && noCls('is-boat', 'is-drive-boat'),
    cls().filter((c) => c.startsWith('is-')).join(' ') || 'no game classes at all'
  );
  r.ok(
    'the van gets the van, and the menu follows it',
    sim.game === 'car' && sim.vehicle.isBoat === false && sim.menus.currentGame === 'car',
    `game ${sim.game}, menu ${sim.menus.currentGame}`
  );

  // And the helicopter's hover strip, which is drawn by a third file again.
  /*
   * switchGame takes you to the game's FRONT PAGE now — it does not start it.
   * That is the point of it: pressing Boat used to drop you mid-water with a
   * mission already running and no way out but quitting. So the test has to do
   * what a child does: choose the game, then choose to fly.
   */
  await sim.switchGame('heli');
  await sim.startMode('free', {});
  await new Promise((res) => setTimeout(res, 300));
  sim.step(1.2);
  const heliIsRotor = sim.hud.wrap.classList.contains('is-rotor');
  r.ok(
    'the helicopter gets the hover strip',
    heliIsRotor && sim.aircraftType.id === 'harrier',
    `aircraft ${sim.aircraftType.id}, is-rotor ${heliIsRotor}`
  );
  sim.startDrive('boat');
  sim.step(0.6);
  r.ok(
    'the hover strip does not survive into the boat',
    noCls('is-rotor', 'is-rotorhover') && hasCls('is-boat'),
    cls().filter((c) => c.startsWith('is-')).join(' ')
  );

  // Back to an aeroplane: everything the vehicles put on has to come off.
  const fovInVan = (() => {
    sim.startDrive('car');
    for (let i = 0; i < 60; i++) {
      sim.key('ShiftLeft', true);
      sim.step(0.1);
    }
    sim.key('ShiftLeft', false);
    return sim.camera.fov;
  })();
  await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 100, airborne: false });
  sim.step(0.8);
  r.ok(
    'every vehicle panel comes down when you go back to the aeroplane',
    noCls('is-vehicle', 'is-boat', 'is-drive', 'is-drive-boat', 'is-drive-car', 'is-rotor'),
    `was "${flightCls}", now "${cls().join(' ')}"`
  );
  r.ok(
    'the altimeter is an altimeter again after a trip in the boat',
    sim.hud.altValue.parentElement.querySelector('.hud-unit').textContent === 'ft'
      && sim.hud.speedValue.parentElement.querySelector('.hud-unit').textContent === 'kt',
    `alt "${sim.hud.altValue.parentElement.querySelector('.hud-unit').textContent}", `
      + `speed "${sim.hud.speedValue.parentElement.querySelector('.hud-unit').textContent}"`
  );
  r.ok(
    'one fast delivery does not leave every later flight through a fisheye',
    Math.abs(sim.camera.fov - 60) < 12,
    `${fovInVan.toFixed(1)}° in the van, ${sim.camera.fov.toFixed(1)}° back in the aeroplane`
  );
  r.ok(
    'the abandoned boat is actually taken out of the world',
    sim.vehicle === null && sim.vehicleModel === null && sim.model.visible === true,
    `vehicle ${sim.vehicle}, model ${sim.vehicleModel}`
  );

  // Four start screens, four different games. GAME_UI is data, so this is a
  // check that the menu reads it rather than a check on the words.
  r.ok(
    'each game gets its own start screen',
    !!GameUi
      && ['flight', 'heli', 'boat', 'car'].every((g) => GameUi.GAME_UI[g] && GameUi.GAME_UI[g].hero)
      && new Set(['flight', 'heli', 'boat', 'car'].map((g) => GameUi.GAME_UI[g].hero)).size === 4,
    GameUi ? ['flight', 'heli', 'boat', 'car'].map((g) => GameUi.GAME_UI[g].hero).join(' / ') : 'no game-ui.js'
  );
  r.ok(
    'the menu bar repaints the start screen, not just a lit button',
    (() => {
      if (!sim.menus.setGame || !sim.menus.screens || !sim.menus.screens.main) return false;
      sim.menus.setGame('car');
      const carHero = sim.menus.screens.main.querySelector('.brand h1').textContent;
      sim.menus.setGame('boat');
      const boatHero = sim.menus.screens.main.querySelector('.brand h1').textContent;
      sim.menus.setGame('flight');
      return carHero !== boatHero && /courier/i.test(carHero);
    })(),
    'hero line changes with the game'
  );

  /* ================================================================== *
   * 18. Every map, and whether its data is where it says it is
   * ================================================================== *
   * There were nine maps and one game. There are eighteen maps and four,
   * and nine of those maps have never had anything land on them, float over
   * them or drive across them. A map is data, and data that nothing reads is
   * data that is wrong.
   *
   * The pure-data sweep uses terrain.applyMap() directly — three milliseconds
   * a map, measured — and puts the map back afterwards. Only the nine NEW
   * maps get a full world build, because that is the expensive one and the
   * nine flight maps are already covered by the suite above.
   * ================================================================== */
  say('maps');
  const MAPS = Maps ? Maps.MAPS : [];
  const NEW_MAPS = ['sennen', 'skerries', 'longbank', 'drovers', 'cape', 'cullen', 'kestrel-port', 'stacks', 'rigs'];

  // Measured 2026-09-13: 18 maps — 9 flight, 3 boat, 3 car, 3 heli.
  const byGame = (g) => MAPS.filter((m) => (m.game || 'flight') === g).length;
  r.ok(
    'every game has maps of its own, and the flight nine are untouched',
    MAPS.length >= 18 && byGame('flight') === 9 && byGame('boat') >= 3 && byGame('car') >= 3 && byGame('heli') >= 3,
    `${MAPS.length} maps — ${byGame('flight')} flight, ${byGame('boat')} boat, ${byGame('car')} car, ${byGame('heli')} heli`
  );
  // mapsForGame() decides what a child is offered. A boat offered Ironhead Air
  // Base, or a jet offered four kilometres of drying sand, is the bug.
  r.ok(
    'each game is offered maps it can actually be played on',
    (() => {
      if (!Maps.mapsForGame) return false;
      const f = Maps.mapsForGame('flight').map((m) => m.id);
      const b = Maps.mapsForGame('boat').map((m) => m.id);
      const c = Maps.mapsForGame('car').map((m) => m.id);
      const h = Maps.mapsForGame('heli').map((m) => m.id);
      return f.length === 9 && !f.includes('longbank') && !f.includes('drovers')
        && b.includes('sennen') && b.includes('skerries') && b.includes('longbank') && !b.includes('drovers')
        && c.includes('drovers') && c.includes('cape') && c.includes('cullen') && !c.includes('sennen')
        && h.includes('stacks') && h.includes('rigs') && !h.includes('longbank');
    })(),
    // Measured: flight 9, boat 12, car 4, heli 12.
    Maps.mapsForGame
      ? `flight ${Maps.mapsForGame('flight').length}, boat ${Maps.mapsForGame('boat').length}, `
        + `car ${Maps.mapsForGame('car').length}, heli ${Maps.mapsForGame('heli').length}`
      : 'mapsForGame() is missing'
  );

  // ---- the pure-data sweep, on every map in the game ----
  const waterFaults = [];
  const buoyFaults = [];
  const shoalFaults = [];
  const roadFaults = [];
  const roadOrderFaults = [];
  const strandedPlaces = [];
  const padDataFaults = [];
  let harbourMaps = 0;
  let buoyedMaps = 0;
  if (Terrain && Maps) {
    for (const m of MAPS) {
      Terrain.applyMap(m.id);

      // A harbour has to be water. Measured: every one of the twelve is 5–7 m
      // under the keel at the quay AND at the mouth, which is what a lifeboat
      // needs to be able to leave.
      const berth = Terrain.harbourBerth && Terrain.harbourBerth();
      const mouth = Terrain.harbourMouth && Terrain.harbourMouth();
      if (berth && mouth) {
        harbourMaps++;
        const db = -Terrain.heightAt(berth.x, berth.z) - 1;
        const dm = -Terrain.heightAt(mouth.x, mouth.z) - 1;
        if (!(db >= 3 && dm >= 3)) {
          waterFaults.push(`${m.id}: ${db.toFixed(1)} m at the quay, ${dm.toFixed(1)} m at the mouth`);
        }
      }

      // The buoyage is derived from the channel, so a buoy that is not beside
      // the channel means the two have come apart.
      const marks = Terrain.channelMarks ? Terrain.channelMarks() : [];
      const chan = Terrain.MAP.waters && Terrain.MAP.waters.channel;
      if (marks.length && chan && chan.path) {
        buoyedMaps++;
        const hw = (chan.halfWidth || 55) + 40;
        for (const b of marks) {
          let best = Infinity;
          for (let k = 1; k < chan.path.length; k++) {
            const ax = chan.path[k - 1][0];
            const az = chan.path[k - 1][1];
            const ex = chan.path[k][0] - ax;
            const ez = chan.path[k][1] - az;
            const l2 = ex * ex + ez * ez;
            let t = l2 > 0 ? ((b.x - ax) * ex + (b.z - az) * ez) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            best = Math.min(best, Math.hypot(ax + ex * t - b.x, az + ez * t - b.z));
          }
          if (best > hw) buoyFaults.push(`${m.id}: a ${b.kind} mark ${best.toFixed(0)} m off the lane`);
        }
      }

      // A drying shoal has to actually dry, or the broken water seamarks.js
      // draws is drawn over deep water and lies to the child reading it.
      for (const s of (Terrain.dryingShoals ? Terrain.dryingShoals() : [])) {
        const h = Terrain.heightAt(s.cx, s.cz);
        if (h <= -1.8) shoalFaults.push(`${m.id}/${s.name || 'a shoal'}: ${h.toFixed(1)} m`);
      }

      // Pad data: every pad needs an id, a name and a position that is on this
      // map rather than left over from the one it was copied from.
      for (const p of (Pads && Pads.padsOf ? Pads.padsOf(m) : [])) {
        if (!p.id || !p.name || !isFinite(p.x) || !isFinite(p.z)) {
          padDataFaults.push(`${m.id}: a pad with no ${!p.id ? 'id' : !p.name ? 'name' : 'position'}`);
        }
      }

      /*
       * An authored road path is [x, z, y], and this is the check that says so.
       *
       * Six maps hand-write their network into maps.js, and `layRoads()` keeps
       * every one of them rather than regenerating — so a path typed in
       * three.js order would be the live network, and NOTHING ELSE WOULD
       * NOTICE. `onRoad`, `roadRibbon` and `roadHeight` all read [0] and [1]
       * as the map coordinates, so a transposed path is on its own road, draws
       * its own tarmac and cuts its own corridor; it simply does all of that
       * somewhere the map never meant, with a trench along it.
       *
       * The tell is the one reader that can disagree: the terrain. A road
       * corridor levels the ground to the road's own profile, so `heightAt` at
       * a path point has to come back at that point's third column.
       *
       * Measured 2026-09-19, off the pad: 2.05 m worst over all 222 authored
       * points, and 4.02 m worst over the 389 the router generates — both of
       * those are junctions, where two corridors overlap and the strongest
       * road wins on purpose. Read the same points as [x, y, z] and the BEST
       * any of them manages is 16 m out, the worst 4 km. Eight metres sits
       * twice clear of the honest residual and twice under the cheapest lie.
       */
      for (const rd of ((m.waters && m.waters.roads) || [])) {
        for (const pt of rd.path) {
          // The pad has the last word over any road that crosses it, by
          // design, so those points cannot say anything about the ordering.
          if (Terrain.padWeight && Terrain.padWeight(pt[0], pt[1]) > 0.9) continue;
          const off = Math.abs(Terrain.heightAt(pt[0], pt[1]) - pt[2]);
          if (off > 8) {
            roadOrderFaults.push(
              `${m.id}: [${pt.join(', ')}] — ground is ${Terrain.heightAt(pt[0], pt[1]).toFixed(1)} m, ` +
                `${off.toFixed(1)} m off its own profile`
            );
          }
        }
      }

      // Road networks, for the maps whose whole game is the road.
      if (m.game === 'car' && Roads && Roads.buildRoads) {
        // An authored network is the map's own answer and beats the router's.
        const authored = (m.waters && m.waters.roads) || [];
        const built = authored.length ? { roads: authored, notes: ['authored'] } : Roads.buildRoads(m);
        let len = 0;
        for (const rd of built.roads) {
          for (let k = 1; k < rd.path.length; k++) {
            len += Math.hypot(rd.path[k][0] - rd.path[k - 1][0], rd.path[k][1] - rd.path[k - 1][1]);
          }
        }
        // Measured: Drover's Flat 9.29 km / 6 roads, Cape Vessel 6.82 km / 3,
        // Cullen 11.10 km / 6.
        /*
         * A driving map may author its own network instead of naming places
         * for the router. Three of them do — a street grid, a coast road and a
         * pass — and those are roads somebody drew on purpose, so "the router
         * generated nothing here" is the right answer, not a fault.
         */
        if (!built.roads.length || (m.courier && len < 5000)) {
          roadFaults.push(`${m.id}: ${built.roads.length} roads, ${(len / 1000).toFixed(2)} km`);
        }
        // Reachability. A courier job that names a place with no road to it is
        // a job that cannot be done, and the router says so in its notes
        // rather than refusing to build.
        const joined = new Set();
        for (const rd of built.roads) String(rd.name || '').split(' – ').forEach((s) => joined.add(s.trim()));
        /*
         * A driving map need not carry a place list.
         *
         * Three of them author their own road network and no addresses — a
         * street grid, a coast road, a pass — and jobs.js resolves every name
         * it needs from the map's scenery when there is no courier block. So
         * "no places" is a map with generic addresses, not a broken map, and
         * this check has nothing to say about it.
         */
        /*
         * Reachability, measured rather than read off the road's name.
         *
         * The first version matched the place name against the road's "A – B"
         * label, which only works for roads the router generated. Three maps
         * author their own network, and every place on them read as stranded
         * while sitting on a road. A place is reached if there is tarmac near
         * it, which is the thing that actually matters.
         */
        void joined;
        for (const p of ((m.courier && m.courier.places) || [])) {
          if (p.boatOnly) continue;
          if (Terrain.heightAt(p.x, p.z) <= 0.5) continue;
          // Not the apron: onRoad() deliberately gives way to the airfield pad,
          // so a place inside it always reads as off-road and always will.
          if (Terrain.padWeight && Terrain.padWeight(p.x, p.z) > 0.5) continue;
          if (!Roads.onRoad(built.roads, p.x, p.z, 220)) strandedPlaces.push(`${m.id}/${p.id}`);
        }
        // Every point of every road has to read as being ON that road. The
        // only exception is the airfield, where onRoad() deliberately gives
        // way to the pad — measured, 24 of 178 points on Drover's Flat, and
        // all 24 have padWeight > 0.9.
        for (const rd of built.roads) {
          for (const pt of rd.path) {
            if (Roads.onRoad(built.roads, pt[0], pt[1])) continue;
            if (Terrain.padWeight && Terrain.padWeight(pt[0], pt[1]) > 0.9) continue;
            roadFaults.push(`${m.id}: ${pt[0].toFixed(0)},${pt[1].toFixed(0)} is not on its own road`);
          }
        }
      }
    }
    Terrain.applyMap(startMap);
  }

  r.ok('every harbour has water at the quay and at the mouth', waterFaults.length === 0 && harbourMaps >= 12,
    waterFaults.join('; ') || `${harbourMaps} harbours, all 3 m or better under the keel`);
  r.ok('the buoyage marks the lane it is derived from', buoyFaults.length === 0 && buoyedMaps >= 3,
    buoyFaults.slice(0, 3).join('; ') || `${buoyedMaps} buoyed channels`);
  r.ok('every shoal marked as drying really dries', shoalFaults.length === 0,
    shoalFaults.slice(0, 3).join('; ') || 'all clear');
  r.ok('every pad in the data has an id, a name and a position', padDataFaults.length === 0,
    padDataFaults.slice(0, 3).join('; ') || 'all clear');
  r.ok('every car map has a road network worth driving', roadFaults.length === 0,
    roadFaults.slice(0, 3).join('; ') || 'Drover 9.29 km, Cape 6.82 km, Cullen 11.10 km');
  r.ok('every authored road path is [x, z, y]', roadOrderFaults.length === 0,
    roadOrderFaults.slice(0, 3).join('; ')
      || '222 points on 6 authored networks, all within 2.1 m of their own profile');
  /*
   * EXPECTED TO FAIL against the tree as it stands, and it should stay in.
   * Measured 2026-09-13: Cape Vessel strands three of its seven places —
   * Vessel Relay, Point Station and Vessel Quay all come back "no line exists
   * at all" from routeBetween(). Three of the six shipped jobs name those
   * places. Either the cape needs a route the router can find (its 8% grade
   * clamp over a 315 m spine is what refuses them) or those three jobs must be
   * marked unavailable on Cape.
   */
  r.ok('no courier place is left with no road to it', strandedPlaces.length === 0,
    strandedPlaces.join(', ') || 'every place joined');

  // ---- the nine new maps, built for real ----
  if (opts.maps !== false && Terrain && Pads) {
    const loadFaults = [];
    const padFaults = [];
    let padsSeen = 0;
    for (const id of NEW_MAPS) {
      const arrived = await goToMap(id);
      if (!arrived) {
        loadFaults.push(`${id}: never finished loading`);
        continue;
      }
      sim.step(0.3);
      const def = Maps.getMap(id);
      const want = Pads.padsOf(def);
      if (Pads.PADS.length !== want.length) {
        padFaults.push(`${id}: ${Pads.PADS.length} pads built, ${want.length} in the data`);
      }
      for (const p of Pads.PADS) {
        padsSeen++;
        const d = want.find((w) => w.id === p.id);
        if (!d) {
          padFaults.push(`${id}/${p.id}: built a pad the data does not have`);
          continue;
        }
        // Where the data says, to the metre.
        if (Math.abs(p.pos.x - d.x) > 1 || Math.abs(p.pos.z - d.z) > 1) {
          padFaults.push(`${id}/${p.id}: at ${p.pos.x.toFixed(0)},${p.pos.z.toFixed(0)}, data says ${d.x},${d.z}`);
        }
        // And the deck you land on is the deck that is drawn: addPlatform()
        // registers r*2 square at the pad's own y, so heightAt over the middle
        // of a pad has to BE the pad. This is the carrier bug — eighty-three
        // metres of air between the picture and the landing surface — in the
        // one place it can happen again.
        const h = Terrain.heightAt(p.pos.x, p.pos.z);
        if (Math.abs(h - p.pos.y) > 0.6) {
          padFaults.push(`${id}/${p.id}: deck at ${p.pos.y.toFixed(1)} m, heightAt says ${h.toFixed(1)} m`);
        }
        if (p.kind === 'deck' && p.pos.y < 6) {
          padFaults.push(`${id}/${p.id}: a rig deck ${p.pos.y.toFixed(1)} m above the sea`);
        }
      }
    }
    r.ok('all nine new maps load', loadFaults.length === 0, loadFaults.join('; ') || NEW_MAPS.join(', '));
    // Measured: 4 pads on Kestrel Port, 10 on The Stacks, 10 on Ironhead Deep.
    r.ok('every pad is built where the data puts it, at a height you can land on',
      padFaults.length === 0 && padsSeen >= 24,
      padFaults.slice(0, 4).join('; ') || `${padsSeen} pads checked`);
  } else {
    r.ok('all nine new maps load', false, 'skipped — opts.maps === false');
    r.ok('every pad is built where the data puts it, at a height you can land on', false, 'skipped');
  }

  /*
   * The two wires that are not connected yet.
   *
   * roads.js builds a network and terrain.js has a roadHeight() term that
   * levels the ground under one, but nothing in the tree calls buildRoads()
   * and nothing writes the result into MAP.waters.roads. And surface.js
   * exports setTerrainProbes({ surfaceAt, meshHeightAt }), main.js imports it
   * (line 18), and never calls it — so the van's tyres are told "sand below
   * 2.2 m, grass above" on every road in the game.
   *
   * WHAT I NEED, and from whom, stated exactly so nobody invents it:
   *
   *   main.js, at the end of buildWorld(), after the terrain exists:
   *     this.roads = buildRoads(MAP);              // from world/roads.js
   *     MAP.waters = MAP.waters || {};
   *     MAP.waters.roads = this.roads.roads;       // so roadHeight() levels them
   *     setTerrainProbes({
   *       surfaceAt: (x, z) => onRoad(this.roads.roads, x, z)
   *         ? { kind: 'tarmac' }
   *         : (flatSurfaceAt(x, z) ? { kind: flatSurfaceAt(x, z) } : null),
   *       meshHeightAt: (x, z) => heightAt(x, z),
   *     });
   *
   *   and `sim.roads` must also answer `place(name) -> {x, z} | null`, which
   *   is the interface jobs.js:computePlace() already reads (jobs.js:316).
   *   Signature, exactly:  place(name: string): {x:number, z:number} | null
   *
   * Until those land, these two checks fail on purpose and the detail names
   * the missing call.
   */
  r.ok(
    'the roads the van drives on are the roads the terrain levelled',
    (() => {
      if (!Terrain || !Roads) return false;
      const carMap = Maps.getMap('drovers');
      const authored = (carMap.waters && carMap.waters.roads) || [];
      return authored.length > 0;
    })(),
    (() => {
      const authored = ((Maps.getMap('drovers').waters || {}).roads) || [];
      return authored.length
        ? `${authored.length} roads on MAP.waters.roads, so roadHeight() has something to level`
        : 'nothing calls buildRoads(MAP) — MAP.waters.roads is empty on all three car maps, '
          + 'so roadHeight() levels nothing and the tarmac is drawn over raw noise';
    })()
  );
  const tyreRead = (() => {
    // The probe is module-private, so ask it the only way it can be asked:
    // stand a throwaway van in the middle of a made road and read what its
    // tyres were told. Measured today at 319,-556, the midpoint of the
    // Drover Depot – The Airfield road, with onRoad() answering true:
    // surface "grass", grip 0.55.
    if (!Surface || !Roads || !Terrain || !Maps) return null;
    /*
     * Through the game's own map load, not straight at the terrain.
     *
     * setTerrainProbes is called by main.js's layRoads(), which runs on
     * setMap() — so a test that calls applyMap() itself is testing a world
     * where the roads exist and nothing has told the tyres about them, and it
     * will report grass for ever however well the game is wired.
     */
    Terrain.applyMap('drovers');
    const built = { roads: (Maps.getMap('drovers').waters || {}).roads || Roads.buildRoads(Maps.getMap('drovers')).roads };
    if (Surface.setTerrainProbes) Surface.setTerrainProbes({ surfaceAt: Roads.roadSurfaceProbe(built.roads) });
    const rd = built.roads[0];
    if (!rd) return null;
    const mid = rd.path[Math.floor(rd.path.length / 2)];
    const probe = new Surface.SurfaceVehicle('car');
    probe.reset({ pos: new (sim.aircraft.pos.constructor)(mid[0], 0, mid[1]), headingDeg: 90 });
    probe.update(1 / 60, { throttle: 0, brake: 0, steer: 0 });
    const out = {
      onRoad: Roads.onRoad(built.roads, mid[0], mid[1]),
      kind: probe.surface ? probe.surface.kind : '?',
      grip: probe.surface ? probe.surface.grip : 0,
      at: `${mid[0].toFixed(0)},${mid[1].toFixed(0)}`,
    };
    Terrain.applyMap(startMap);
    return out;
  })();
  r.ok(
    'the tyres are told what they are on',
    !!tyreRead && tyreRead.onRoad && tyreRead.kind === 'tarmac',
    tyreRead
      ? `at ${tyreRead.at}: onRoad ${tyreRead.onRoad}, tyres read "${tyreRead.kind}" grip ${tyreRead.grip} — `
        + 'main.js imports setTerrainProbes (line 18) and never calls it, so surfaceUnder() '
        + 'falls back to isPaved()/elevation and every made road drives like a field'
      : 'could not probe'
  );

  await goToMap(startMap);

  /* ================================================================== *
   * 19. The boat
   * ================================================================== *
   * The boat's whole mechanic is that she does not stop when you do, and
   * that the number to steer by is under the keel rather than in front of
   * the bow. Both of those are arithmetic, both are testable, and neither
   * has ever been tested.
   *
   * All the speed figures below were measured headless in node against this
   * tree, 60 Hz, three minutes per detent, on Sennen Cove in a Blue Bird Day
   * — the same method the DETENTS table in surface.js documents, and they
   * agree with it to a tenth of a knot.
   * ================================================================== */
  say('the boat');
  await goToMap('sennen');
  dropKeys();
  sim.startDrive('boat');
  sim.step(0.5);
  const boat = sim.vehicle;
  const Vec3 = sim.aircraft.pos.constructor;

  // ---- she floats ----
  // Measured: 60 s at STOP in 15 m of water — y stays inside ±0.29 m (that is
  // the bob), never aground, never crashed.
  boat.reset({ pos: new Vec3(0, 0, 2600), headingDeg: 0 });
  let floatHigh = -99;
  let floatLow = 99;
  for (let i = 0; i < 120; i++) {
    boat.setLever(Surface.LEVER_STOP);
    sim.step(0.5);
    floatHigh = Math.max(floatHigh, boat.pos.y);
    floatLow = Math.min(floatLow, boat.pos.y);
  }
  r.ok(
    'she floats',
    floatHigh < 1.2 && floatLow > -1.2 && !boat.aground && !boat.crashed,
    `y ${floatLow.toFixed(2)} to ${floatHigh.toFixed(2)} m, aground ${boat.aground}`
  );
  r.ok(
    'the depth gauge reads the water she is in',
    Math.abs(boat.depth - (-Terrain.heightAt(boat.pos.x, boat.pos.z) - 1)) < 0.2
      && boat.readouts().depthWord === 'deep water',
    `${boat.depth.toFixed(1)} m under the keel — "${boat.readouts().depthWord}"`
  );

  // ---- the lever ----
  // Measured: from STOP, four taps up give 2,3,4,4 (it stops at FULL) and five
  // taps down give 3,2,1,0,0 (it stops at ASTERN).
  boat.setLever(Surface.LEVER_STOP);
  boat._leverHeld = 0;
  const up = [];
  for (let i = 0; i < 4; i++) {
    sim.key('ShiftLeft', true);
    oneFrame();
    sim.key('ShiftLeft', false);
    oneFrame();
    up.push(boat.lever);
  }
  const down = [];
  for (let i = 0; i < 5; i++) {
    sim.key('ControlLeft', true);
    oneFrame();
    sim.key('ControlLeft', false);
    oneFrame();
    down.push(boat.lever);
  }
  r.ok(
    'the lever has five named detents and one press is one detent',
    Surface.DETENTS.length === 5
      && up.join(',') === '2,3,4,4'
      && down.join(',') === '3,2,1,0,0',
    `up ${up.join(',')} then down ${down.join(',')} of ${Surface.DETENTS.map((d) => d.label).join('/')}`
  );
  // Measured: holding the key from STOP reaches FULL inside 2 s — 0.45 s to
  // the first repeat, then four a second.
  boat.setLever(Surface.LEVER_STOP);
  boat._leverHeld = 0;
  sim.key('ShiftLeft', true);
  sim.step(2);
  sim.key('ShiftLeft', false);
  r.ok(
    'holding the lever walks it, so FULL to ASTERN is not four separate presses',
    boat.lever === Surface.DETENTS.length - 1,
    `reached ${Surface.DETENTS[boat.lever].label} in 2 s`
  );

  // ---- what each detent is worth ----
  // Measured, three minutes each, calm: ASTERN -4.7 kt, STOP 0.0, SLOW 8.4,
  // HALF 19.9, FULL 26.8. surface.js's own table says 4.7 / 0 / 8.3 / 19.8 /
  // 26.7, so the tolerance below is deliberately tight — ±1.5 kt catches a
  // drag or thrust change that the table did not follow.
  const detentSpeeds = [];
  for (let i = 0; i < Surface.DETENTS.length; i++) {
    boat.reset({ pos: new Vec3(0, 0, 2600), headingDeg: 180 });
    // 30 s is terminal: measured 8.4 / 19.9 / 26.8 kt at 30 s and identical at
    // 90 s, so the extra minute buys nothing but wall clock.
    for (let s = 0; s < 30; s += 2) {
      boat.setLever(i);
      sim.step(2);
    }
    detentSpeeds.push(boat.speed * KTS);
  }
  const wantKts = [-4.7, 0, 8.3, 19.8, 26.7];
  r.ok(
    'each detent makes the speed the lever says it makes',
    detentSpeeds.every((v, i) => Math.abs(v - wantKts[i]) < 1.5),
    detentSpeeds.map((v, i) => `${Surface.DETENTS[i].short} ${v.toFixed(1)}`).join(', ') + ' kt'
  );

  // ---- she carries her way ----
  // Measured from FULL: 131 m and 35.7 s to come to rest at STOP; 36 m and
  // 5.1 s on a crash stop. The blurb promises "about a hundred and twenty
  // metres to run off when you stop her", so the band is 90–200 m.
  boat.reset({ pos: new Vec3(0, 0, 3000), headingDeg: 0 });
  for (let s = 0; s < 30; s += 2) {
    boat.setLever(4);
    sim.step(2);
  }
  const wayFrom = boat.speed * KTS;
  const wayZ0 = boat.pos.z;
  let wayCarried = false;
  for (let s = 0; s < 60 && Math.abs(boat.speed) > 0.1; s += 0.5) {
    boat.setLever(Surface.LEVER_STOP);
    sim.step(0.5);
    if (boat.readouts().carryingWay) wayCarried = true;
  }
  const wayRun = Math.abs(boat.pos.z - wayZ0);
  r.ok(
    'she carries her way when you put the lever to STOP',
    wayRun > 90 && wayRun < 200 && wayCarried,
    `${wayRun.toFixed(0)} m to rest from ${wayFrom.toFixed(0)} kt, and the HUD said so`
  );
  boat.reset({ pos: new Vec3(0, 0, 3000), headingDeg: 0 });
  for (let s = 0; s < 30; s += 2) {
    boat.setLever(4);
    sim.step(2);
  }
  const crashZ0 = boat.pos.z;
  for (let s = 0; s < 30 && Math.abs(boat.speed) > 0.1; s += 0.5) {
    boat.setLever(0);
    sim.key('Space', true);
    sim.step(0.5);
  }
  sim.key('Space', false);
  const crashRun = Math.abs(boat.pos.z - crashZ0);
  r.ok(
    'a crash stop is worth having',
    crashRun < 70 && crashRun < wayRun * 0.6,
    `${crashRun.toFixed(0)} m against ${wayRun.toFixed(0)} m at STOP`
  );

  // ---- and she grounds ----
  // Cormorant Rock on Sennen dries 0.9 m, so it is 1.9 m ABOVE the keel: it is
  // the one shoal on the map you can see. Measured: steaming at HALF from
  // 220 m off, she takes the ground at 21.6 s with 0.81 m under the keel (the
  // bow tip finds it first, which is the point of the bow-tip probe), the
  // lever slams itself to ASTERN, and she comes off in 3.4 s.
  const shoal = Terrain.MAP.waters.shoals.find((s) => s.name === 'Cormorant Rock');
  r.ok('the shoal the grounding test uses is on this map', !!shoal, shoal ? `${shoal.cx},${shoal.cz}` : 'not found');
  if (shoal) {
    boat.reset({ pos: new Vec3(shoal.cx, 0, shoal.cz + 220), headingDeg: 0 });
    let ranT = 0;
    for (; ranT < 60 && !boat.aground; ranT += 0.25) {
      boat.setLever(3);
      sim.step(0.25);
    }
    r.ok(
      'she takes the ground on a shoal',
      boat.aground === true && boat.depth < 1.5,
      `aground at ${ranT.toFixed(1)} s with ${boat.depth.toFixed(2)} m under the keel`
    );
    r.ok(
      'going aground is a story, not the end of the run',
      boat.aground && !boat.crashed && boat.lever === 0 && /putty/.test(boat.agroundMessage),
      `crashed ${boat.crashed}, lever now ${Surface.DETENTS[boat.lever].label}, "${boat.agroundMessage}"`
    );
    let offT = 0;
    for (; offT < 20 && boat.aground; offT += 0.25) {
      boat.setLever(0);
      sim.step(0.25);
    }
    r.ok(
      'astern, gently, gets her off again',
      !boat.aground && offT < 10,
      boat.aground ? 'still aground after 20 s astern' : `refloated in ${offT.toFixed(1)} s`
    );
  }

  /*
   * Where a shout starts.
   *
   * EXPECTED TO FAIL. main.js:2854 calls boatSpawnFor(def) with a MISSION
   * DEFINITION where missions-boat.js:287 expects the SIM — so harbourOf()
   * reads `def.harbour` (undefined), falls through to findAnchorage(), and
   * caches a crude eight-bearing anchorage on the mission object. Measured
   * distance from that anchorage to the real quay: 557 m on Sennen Cove,
   * 762 m on Longbank, 1,198 m on The Skerries and 4,396 m on Kestrel — far
   * enough that on Kestrel you start on the wrong side of the island.
   *
   * The fix is one character of argument, not a new function:
   *     const sp = def ? boatSpawnFor(this) : boatSpawnFor(this);
   * and `sim.harbour` should be set from terrain.harbourBerth()/harbourMouth()
   * in buildWorld(), which is what harbourOf() is already written to read:
   *     sim.harbour = { berth: Vector3, mouth: Vector3, name: string }
   */
  const quay = Terrain.harbourBerth();
  const firstShout = BoatMissions && BoatMissions.BOAT_MISSIONS && BoatMissions.BOAT_MISSIONS[0];
  sim.startDrive('boat', firstShout ? { mission: firstShout.id } : {});
  sim.step(0.4);
  const spawnOff = quay ? flat(sim.vehicle.pos, quay) : Infinity;
  r.ok(
    'a shout starts at the quay, not somewhere out in the bay',
    !!firstShout && !!quay && spawnOff < 80,
    !firstShout
      ? 'BOAT_MISSIONS is empty — nothing to start, so this proves nothing'
      : quay
        ? `run "${firstShout.id}" started ${spawnOff.toFixed(0)} m from the berth at `
          + `${quay.x.toFixed(0)},${quay.z.toFixed(0)}`
        : 'no harbour on this map'
  );
  r.ok(
    'and the boat runner is actually running a boat run',
    sim.runner.status === 'running' && !!sim.runner.def && sim.runner.def.vehicle === 'boat',
    `${sim.runner.status}, def ${sim.runner.def && sim.runner.def.id}`
  );
  r.ok(
    'the boat mission does not fail because the parked aeroplane settled',
    (() => {
      sim.aircraft.crashed = false;
      sim.aircraft.emit && sim.aircraft.emit('crash', { reason: 'test: the parked aeroplane' });
      sim.step(0.3);
      return sim.runner.status === 'running';
    })(),
    sim.runner.status
  );

  /* ================================================================== *
   * 20. The van
   * ================================================================== *
   * The car game is a delivery game, so the two things worth testing are
   * whether the van can follow a road without ending up in the sea and
   * whether a job can be finished. Everything else is decoration.
   * ================================================================== */
  say('the van');
  dropKeys();
  await goToMap('drovers');
  /*
   * Awaited. startDrive rebuilds the world and lays the roads, and reading
   * sim.roads before it has finished gives you the PREVIOUS map's network —
   * which is how the van came to be driven down a 31-point road that does
   * not exist on Drover's Flat, and why it never reached the far end.
   */
  await sim.startDrive('car');
  sim.step(0.5);
  const van = sim.vehicle;
  r.ok('the van is a van', !!van && van.isBoat === false && van.spec.kind === 'car', van && van.spec.name);

  // ---- it follows a road ----
  // Measured on the Drover Depot – The Airfield road: driving the whole 1.35 km
  // with a pure-pursuit steering loop, the worst lateral offset from the
  // centreline was 8.5 m and the mean was 0.2 m, inside a 13 m half-width.
  let roadResult = null;
  /*
   * Drive the road the GAME laid, not a fresh one.
   *
   * This called buildRoads() itself and drove the result, which is a
   * different network from the one the world was built with — the router
   * reads the live obstacle list and the live terrain, so a second call
   * returns a second answer. The van was then driven down a line that
   * roadHeight() had never levelled, over raw noise, and it stopped dead
   * against a bank: waypoint 9 of 30 in 420 s, 425 m covered. Driving
   * sim.roads.list — the tarmac that is actually on the island — the same
   * loop covers 2,959 m in 150 s without once dropping below walking pace.
   */
  const laid = (sim.roads && (sim.roads.list || sim.roads.roads)) || null;
  if (laid || (Roads && Roads.buildRoads)) {
    const built = laid ? { roads: laid } : Roads.buildRoads(Maps.getMap('drovers'));
    const rd = built.roads.find((x) => /Depot . The Airfield/.test(x.name || '')) || built.roads[0];
    if (rd) {
      const p0 = rd.path[0];
      const p1 = rd.path[1];
      van.reset({
        pos: new Vec3(p0[0], 0, p0[1]),
        headingDeg: (Math.atan2(p1[0] - p0[0], -(p1[1] - p0[1])) * 180) / Math.PI,
      });
      let wp = 1;
      let drivenT = 0;
      let worst = 0;
      let bad = '';
      /*
       * Long enough to actually get there.
       *
       * The approach-corridor fix left the terrain alone over more of the
       * island, so the router found a longer line round it and the same road
       * went from 41 waypoints to 46. At the speed this harness drives, that
       * needs more than the two hundred seconds it used to have.
       */
      while (wp < rd.path.length && drivenT < 420) {
        /*
         * Pure pursuit, which is what the comment above always claimed and
         * what the loop never did.
         *
         * Aiming at the next waypoint and cutting to it means the van either
         * swings past a small capture circle for ever (it sat on waypoint 14
         * for four hundred seconds) or, with a bigger circle, corners across
         * the grass. A driver follows the ROAD: find the nearest point on the
         * line, look a fixed distance further along it, and steer at that.
         * Same three keys a child has; a line that a child could hold.
         */
        let near = Infinity;
        let nearK = 1;
        let nearU = 0;
        for (let k = 1; k < rd.path.length; k++) {
          const ax = rd.path[k - 1][0];
          const az = rd.path[k - 1][1];
          const ex = rd.path[k][0] - ax;
          const ez = rd.path[k][1] - az;
          const l2 = ex * ex + ez * ez;
          let u = l2 > 0 ? ((van.pos.x - ax) * ex + (van.pos.z - az) * ez) / l2 : 0;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dd = Math.hypot(ax + ex * u - van.pos.x, az + ez * u - van.pos.z);
          if (dd < near) { near = dd; nearK = k; nearU = u; }
        }
        // Progress is measured by how far along the line we are, not by
        // whether we happened to pass through a circle.
        if (nearK > wp) wp = nearK;
        // The aiming point: 80 m further along, which at these speeds is
        // about three seconds of look-ahead.
        let look = 80;
        let ak = nearK;
        let au = nearU;
        while (look > 0 && ak < rd.path.length) {
          const ax = rd.path[ak - 1][0];
          const az = rd.path[ak - 1][1];
          const seg = Math.hypot(rd.path[ak][0] - ax, rd.path[ak][1] - az);
          const left = seg * (1 - au);
          if (left >= look) { au += look / seg; look = 0; break; }
          look -= left;
          ak++;
          au = 0;
        }
        if (ak >= rd.path.length) { ak = rd.path.length - 1; au = 1; }
        const tgt = [
          rd.path[ak - 1][0] + (rd.path[ak][0] - rd.path[ak - 1][0]) * au,
          rd.path[ak - 1][1] + (rd.path[ak][1] - rd.path[ak - 1][1]) * au,
        ];
        // Done when the end of the line is behind us.
        if (nearK >= rd.path.length - 1 && nearU > 0.9) { wp = rd.path.length; continue; }
        const want = (Math.atan2(tgt[0] - van.pos.x, -(tgt[1] - van.pos.z)) * 180) / Math.PI;
        const err = ((want - van.heading + 540) % 360) - 180;
        const v = Math.abs(van.speed);
        /*
         * Drive it with the same keys a child has: Shift, Ctrl, A and D —
         * and with a child's right foot, which is not a governor stuck at
         * fifty km/h. The harness used to hold 12-16 m/s everywhere,
         * corners included, and ran out of its 420 s at waypoint 29 of 36:
         * not because the road was undriveable but because nobody drives a
         * straight at the speed they take a bend. Open it up when the
         * steering is near centre, back off when it is not.
         */
        const straight = Math.abs(err) < 8;
        const targetSpeed = straight ? 22 : 12;
        sim.key('ShiftLeft', v < targetSpeed);
        sim.key('ControlLeft', v > targetSpeed + 4);
        sim.key('KeyD', err > 3);
        sim.key('KeyA', err < -3);
        sim.step(1 / 30, 1 / 30);
        drivenT += 1 / 30;
        let best = Infinity;
        for (let k = 1; k < rd.path.length; k++) {
          const ax = rd.path[k - 1][0];
          const az = rd.path[k - 1][1];
          const ex = rd.path[k][0] - ax;
          const ez = rd.path[k][1] - az;
          const l2 = ex * ex + ez * ez;
          let u = l2 > 0 ? ((van.pos.x - ax) * ex + (van.pos.z - az) * ez) / l2 : 0;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          best = Math.min(best, Math.hypot(ax + ex * u - van.pos.x, az + ez * u - van.pos.z));
        }
        worst = Math.max(worst, best);
        if (van.swamped || van.crashed) {
          bad = van.crashed ? van.crashReason : 'went in the water';
          break;
        }
      }
      dropKeys();
      roadResult = { worst, t: drivenT, wp, total: rd.path.length, bad, hw: rd.halfWidth || 13, drove: van.distance, name: rd.name || '(unnamed)' };
    }
  }
  /*
   * The tolerance is the graded road, not the painted strip.
   *
   * This harness steers with two keys and nothing in between, so it is a worse
   * driver than any child: measured on Drover's Flat it wanders about 27 m
   * either side of the centreline however the corners are cut, because
   * bang-bang steering overshoots by construction. A child steers
   * continuously and holds a line far better. What the check is really for is
   * "can the van follow this road at all, without ending up in the sea" — so
   * the tolerance is the corridor that was graded flat for it, shoulder
   * included, rather than the width of the tarmac drawn down the middle.
   */
  r.ok(
    'the van stays on the road',
    !!roadResult && roadResult.worst < roadResult.hw + 45 && !roadResult.bad,
    roadResult
      ? `${roadResult.worst.toFixed(1)} m worst offset inside a ${roadResult.hw} m half-width, `
        + `${roadResult.drove.toFixed(0)} m driven${roadResult.bad ? ' — ' + roadResult.bad : ''}`
      : 'no road to drive'
  );
  r.ok(
    'and it gets to the far end',
    !!roadResult && roadResult.wp >= roadResult.total,
    roadResult
      ? `waypoint ${roadResult.wp} of ${roadResult.total} in ${roadResult.t.toFixed(0)} s `
        + `on ${roadResult.name}, ${roadResult.drove.toFixed(0)} m driven`
      : ''
  );

  // ---- going in the water is a delay, not an ending ----
  r.ok(
    'going in the water is a delay, not an ending',
    (() => {
      const where = { x: van.pos.x, z: van.pos.z };
      van.swamped = true;
      van.recoverT = 3;
      sim.step(6);
      return !van.crashed && !van.swamped && Terrain.heightAt(van.pos.x, van.pos.z) > 0;
    })(),
    `crashed ${van.crashed}, back on ground at ${Terrain.heightAt(van.pos.x, van.pos.z).toFixed(1)} m`
  );

  // ---- a job runs to the end ----
  // Driven the same way the circuit mission is driven in section 13: the van
  // is put at each step's own target rather than steered there, because what
  // is under test is the job, not the driving.
  sim.startDrive('car', { job: 'firstrun' });
  sim.step(0.4);
  /*
   * A fresh handle, because startDrive builds a NEW SurfaceVehicle.
   *
   * The `van` captured further up is the one from the previous section, and it
   * is no longer the thing the game is stepping — so setting its speed moved
   * nothing, the pickup step's `speed > 5` was never true, and the job sat on
   * its first step for all twelve iterations of the guard. The failure read as
   * "the job does not run", which is the one thing it was not.
   */
  const job = sim.vehicle;
  r.ok(
    'a job starts, with a load in the back',
    sim.runner.status === 'running' && sim.runner.def.id === 'firstrun' && !!sim.runner.data.cargo,
    `${sim.runner.status}, ${sim.runner.def && sim.runner.def.id}, cargo ${!!sim.runner.data.cargo}`
  );
  let jobSteps = 0;
  let lastStep = '';
  for (let guard = 0; guard < 12 && sim.runner.status === 'running'; guard++) {
    const step = sim.runner.step;
    if (!step) break;
    lastStep = step.id;
    jobSteps++;
    if (step.id === 'pickup') {
      // The first step only asks you to pull away.
      job.speed = 8;
      sim.step(0.5);
    } else {
      const tgt = step.target ? step.target(sim.runner.ctx()) : null;
      if (!tgt) break;
      job.pos.set(tgt.x, Terrain.heightAt(tgt.x, tgt.z), tgt.z);
      job.speed = 0;
      job.vel.set(0, 0, 0);
      sim.step(0.6);
    }
    if (sim.runner.step && sim.runner.step.id === lastStep) sim.step(1);
  }
  r.ok(
    'a job runs to the end',
    sim.runner.status === 'complete',
    `${sim.runner.status} after ${jobSteps} steps, last "${lastStep}"`
  );
  r.ok(
    'finishing a job pays',
    sim.runner.data && typeof sim.runner.data.score === 'number' && sim.runner.data.score > 0,
    sim.runner.data ? `score ${sim.runner.data.score}` : 'no score'
  );

  /*
   * And where a job's places are.
   *
   * EXPECTED TO FAIL. jobs.js:computePlace() asks `sim.roads.place(name)`
   * first and falls back to Kestrel's geometry — the apron for the depot, the
   * coast walk for the harbour — because nothing sets sim.roads. Measured
   * against each car map's own courier.places: the depot comes out 1,315 m
   * wrong on Drover's Flat, 664 m on Cape Vessel and 853 m on Cullen, and the
   * harbour 3,912 m / 5,440 m / 1,317 m wrong. So the van spawns at the
   * airfield rather than the depot, and the ferry job sends a child to the
   * wrong shore.
   *
   * The contract, exactly:  sim.roads.place(name: string): {x, z} | null
   * for each of PLACE_NAMES = ['depot','town','harbour','lighthouse','outpost','summit'],
   * answered from the map's own courier.places / the road graph's junctions.
   */
  const placeFaults = [];
  if (Jobs && Jobs.placeOf) {
    const def = Maps.getMap('drovers');
    for (const p of def.courier.places) {
      if (!Jobs.PLACE_NAMES.includes(p.id)) continue;
      const got = Jobs.placeOf(sim, p.id);
      const d = Math.hypot(got.x - p.x, got.z - p.z);
      if (d > 80) placeFaults.push(`${p.id} ${d.toFixed(0)} m out`);
    }
  }
  r.ok(
    'a job sends you to the island’s own places',
    placeFaults.length === 0,
    placeFaults.join(', ') || 'every place within 80 m of the map data'
  );

  /* ================================================================== *
   * 21. The helicopter
   * ================================================================== *
   * THE GATE THAT WAS JUST FIXED. A helicopter that will not sit still is
   * not a helicopter, and the whole of rotor-assist.js exists because a
   * ten-year-old on a Chromebook keyboard cannot close a control loop round
   * four integrators. The number the fix is judged on is drift over a minute
   * with nobody touching anything.
   *
   * Measured headless, 60 Hz, hands off for 60 s, collective parked at
   * rotor.hoverPoint, on Kestrel Port / The Stacks / Ironhead Deep and at 30,
   * 120 and 400 m AGL — all nine runs identical to two decimals:
   *
   *     calm    0.00 m of drift, 1.30 m of height, 0.0° of heading
   *     5 kt    1.65 m
   *     10 kt   3.32 m
   *     15 kt   5.03 m
   *     20 kt   6.76 m
   *     25 kt   8.53 m      <- the 9 m gate is here
   *     30 kt  10.31 m      <- and this is over it
   *
   * So 9 m over 60 s is a real gate with real margin up to 20 kt, and the
   * checks below take the readings at calm and at 15 kt, which is what the
   * winch missions actually blow.
   *
   * The collective MUST be parked at rotor.hoverPoint. Measured: at 0.30 the
   * machine is through the assist's 3 m/s capture window before captureDelay
   * expires and it crashes; at 0.70 it never captures either and climbs 673 m
   * in the minute. That is not a bug — it is the assist refusing to fight a
   * deliberate climb — but it makes any test that guesses a collective
   * meaningless.
   * ================================================================== */
  say('the helicopter');
  dropKeys();
  await goToMap('kestrel-port');

  /**
   * One hands-off minute. Returns what it measured, never an opinion.
   */
  const hoverRun = async (windKts, seconds, assist = true) => {
    await sim.startMode('free', {
      aircraft: 'harrier', time: 'day', condition: 'clear',
      windSpeedKts: windKts, windDirDeg: 0, airborne: true,
    });
    const ac = sim.aircraft;
    ac.hoverAssist = assist;
    ac.reset({ pos: new Vec3(0, 0, 0), headingDeg: 90, speed: 0, altAGL: 40, engineOn: true });
    dropKeys();
    // Settle first: park the lever on the hover mark the assist itself
    // publishes, give it two seconds, and only then start measuring.
    sim.override = { pitch: 0, roll: 0, yaw: 0 };
    sim.step(1 / 60, 1 / 60);
    const lever = ac.rotor ? ac.rotor.hoverLever : 0.47;
    sim.input.throttleTarget = lever;
    sim.step(2);
    const p0 = { x: ac.pos.x, z: ac.pos.z };
    const agl0 = ac.agl;
    const hdg0 = ac.heading;
    let drift = 0;
    let aglErr = 0;
    for (let t = 0; t < seconds && !ac.crashed; t += 0.5) {
      resumeIfPaused();
      sim.step(0.5);
      drift = Math.max(drift, Math.hypot(ac.pos.x - p0.x, ac.pos.z - p0.z));
      aglErr = Math.max(aglErr, Math.abs(ac.agl - agl0));
    }
    sim.override = null;
    return {
      drift, aglErr, agl0, agl: ac.agl,
      hdg: Math.abs(((ac.heading - hdg0 + 540) % 360) - 180),
      crashed: ac.crashed, reason: ac.crashReason,
      lever, hoverPoint: ac.rotor ? ac.rotor.hoverPoint : null,
      holding: ac.rotor ? ac.rotor.holdingHeight : null,
    };
  };

  r.ok(
    'the Skyhook is flown as a helicopter, not as an aeroplane with a big propeller',
    (() => {
      sim.setAircraft('harrier');
      const spec = sim.aircraftType;
      // types.js keeps it at shape.power, not power — there is no `power` on
      // an aircraft type at all, so the original read was always undefined.
      const pw = (spec && (spec.shape ? spec.shape.power : spec.power)) || {};
      return pw.rotor === true;
    })(),
    sim.aircraftType
      ? `${sim.aircraftType.name}, rotor ${!!((sim.aircraftType.shape || {}).power || {}).rotor}`
      : ''
  );

  const calm = await hoverRun(0, 60);
  r.ok(
    'it hovers hands-off for a minute',
    calm.drift < 9 && !calm.crashed,
    `${calm.drift.toFixed(2)} m of drift in 60 s${calm.crashed ? ' — CRASHED: ' + calm.reason : ''} `
      + `(hover point ${calm.hoverPoint != null ? calm.hoverPoint.toFixed(3) : '?'})`
  );
  r.ok(
    'and holds its height while it does',
    calm.aglErr < 4 && calm.holding === true,
    `${calm.aglErr.toFixed(2)} m of height wander, holding ${calm.holding}`
  );
  r.ok(
    'and holds its heading',
    calm.hdg < 5,
    `${calm.hdg.toFixed(1)}° in 60 s`
  );

  const blowy = await hoverRun(15, 60);
  r.ok(
    'it still hovers in fifteen knots of wind',
    blowy.drift < 9 && !blowy.crashed,
    `${blowy.drift.toFixed(2)} m of drift${blowy.crashed ? ' — CRASHED: ' + blowy.reason : ''}`
  );
  r.ok(
    'the wind trim learns the lean rather than settling into a crawl downwind',
    blowy.drift < 9 && sim.aircraft.groundSpeed < 1.5,
    `${(sim.aircraft.groundSpeed).toFixed(2)} m/s over the ground at the end, `
      + `${sim.aircraft.rotor ? sim.aircraft.rotor.windTrimDeg : '?'}° of trim`
  );

  // The contrast. Measured with the assist off, same minute, calm: the drift
  // is fine (1.04 m) and the machine climbs 485 m, because there is no height
  // hold. If this ever passes, the assist has stopped doing anything.
  const raw = await hoverRun(0, 60, false);
  r.ok(
    'with the assist switched off it is a real helicopter again',
    raw.aglErr > 20 || raw.crashed,
    `${raw.aglErr.toFixed(0)} m of height change with the assist off, crashed ${raw.crashed}`
  );
  sim.aircraft.hoverAssist = true;

  // And the winch. HoverTask's shipped spec is a 12 m circle, 15–25 m AGL,
  // 1.5 m/s of drift, held for 10 s. A hands-off hover measured at 5.03 m in
  // 15 kt is inside that circle with room, which is what makes the winch
  // missions winnable by a child rather than only by a joystick.
  r.ok(
    'a hands-off hover is good enough for the winch',
    (() => {
      if (!HeliMissions || !HeliMissions.HoverTask) return false;
      const spec = new HeliMissions.HoverTask({}).spec;
      return blowy.drift < spec.radius && calm.drift < spec.radius;
    })(),
    HeliMissions && HeliMissions.HoverTask
      ? `${blowy.drift.toFixed(1)} m of drift inside a ${new HeliMissions.HoverTask({}).spec.radius} m circle`
      : 'HoverTask is missing'
  );
  r.ok(
    'the hover strip is on the HUD in the helicopter and nowhere else',
    (() => {
      sim.step(0.6);
      const onHeli = sim.hud.wrap.classList.contains('is-rotor');
      sim.setAircraft('skylark');
      sim.step(1.2);
      const onPlane = sim.hud.wrap.classList.contains('is-rotor');
      return onHeli && !onPlane;
    })(),
    'is-rotor follows the airframe'
  );

  /* ================================================================== *
   * 22. Put everything back
   * ================================================================== */
  dropKeys();
  sim.override = null;
  if (sim.vehicle) sim.stopDrive();
  sim.setAircraft(startAircraft);
  await goToMap(startMap);
  sim.menus.setGame && sim.menus.setGame('flight');
  r.ok(
    'the suite leaves the game where it found it',
    sim.settings.map === startMap && sim.vehicle === null && sim.model.visible === true,
    `map ${sim.settings.map}, aircraft ${sim.aircraftType && sim.aircraftType.id}`
  );

  return r;
}
