/**
 * FIRST LOAD, in the page (the Chromebook pass): the player's path, where the
 * features and the offline copy come AFTER the menu. Run with the page opened
 * as `?lazyfeatures=1&mute=1`, so a driven browser takes that path:
 *
 *   node one-check.mjs 'http://127.0.0.1:PORT/?lazyfeatures=1&mute=1' ./tests/features/first-load.browser.js check "" 1
 *
 *   - the game took the player's path and featuresReady resolved;
 *   - the bundle installed late: dozens of features, the World Map preview and
 *     the live map among them, each with its group in the standing menu world,
 *     and the loading screen's wrapper is the outermost startMode;
 *   - the service worker is NOT registered on the menu; installOffline()
 *     registers it, once;
 *   - a start asked for before the features are in waits for them and then
 *     starts, and a start with them in starts as before;
 *   - the late features' programs are compiled on the menu (warmLateFeatures);
 *   - the .glb parse waits for the flight to end (offFlight), and a helicopter
 *     whose Blender model came after its stand-in is rebuilt at the next start.
 */
export const id = 'first-load';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000, every = 50) => {
  const t = performance.now();
  while (performance.now() - t < ms) {
    try {
      if (fn()) return true;
    } catch (e) {
      /* keep waiting */
    }
    await sleep(every);
  }
  return false;
};

export async function check(sim, r) {
  r.ok('first-load: the page took the player\'s path (?lazyfeatures=1)', sim.playerPath === true, `playerPath=${sim.playerPath}`);
  const t0 = performance.now();
  const landed = await Promise.race([sim.featuresReady.then(() => true), sleep(60000).then(() => false)]);
  r.ok('first-load: featuresReady resolved', landed && sim._featuresIn === true, `${Math.round(performance.now() - t0)} ms`);

  const Ext = await import('../../src/game/extensions.js');
  const installed = Ext.extInstalled();
  r.ok('first-load: dozens of features installed after the menu', installed.length >= 50, `${installed.length} installed`);
  r.ok('first-load: the World Map preview and the live map are in', !!sim.worldPreview && !!sim.liveMap);
  const lateGroups = (sim.worldGroups || []).filter((g) => g && typeof g.name === 'string' && g.name.startsWith('ext:'));
  r.ok('first-load: the late features have their groups in the standing menu world', lateGroups.length >= 10, `${lateGroups.length} ext: groups`);
  r.ok('first-load: the loading screen wraps startMode outermost', sim.startMode && sim.startMode.name === 'startModeWithLoadingScreen', sim.startMode && sim.startMode.name);
  r.ok('first-load: the Blender vehicles and the fonts were asked for after the bundle', (await import('../../src/vehicles/blender-models.js')).blenderModelStatus().car !== undefined);

  // Their programs: warmed on the menu (warmLateFeatures), as the boot's warm did on the suites' path, so a
  // feature object outside the menu's view does not compile on its first frame in the flight.
  const warmed = await Promise.race([(sim._lateWarm || Promise.resolve(null)).then(() => true), sleep(60000).then(() => false)]);
  let mats = 0;
  let withProg = 0;
  const P = sim.renderer.properties;
  for (const g of lateGroups) {
    g.traverseVisible((o) => {
      if (!(o.isMesh || o.isSprite || o.isPoints || o.isLine)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        mats++;
        if (P.get(m).currentProgram) withProg++;
      }
    });
  }
  r.ok('first-load: the late features\' programs are compiled on the menu', warmed && sim.lateWarmGroups >= 10 && mats > 0 && withProg / mats >= 0.95, `${sim.lateWarmGroups} groups warmed, ${withProg}/${mats} visible materials have a program`);

  // The offline copy: not at boot. On a fast machine the idle callback may already have fired by the time this
  // check runs -- but only after the features and the binaries were in, never at boot.
  const why = sim.offlineInstalledWhy || null;
  // (A starved test machine can take over 30 s to settle, so 'menu-idle' may already have fired too.)
  const deferredWhy = why == null || why === 'menu-idle' || why === 'first-flight' || (why === 'idle' && sim.binariesInAt != null && sim.offlineInstalledAt >= sim.binariesInAt);
  r.ok('first-load: the service worker was not registered at boot', why !== 'boot' && deferredWhy, `why=${why} at=${sim.offlineInstalledAt && Math.round(sim.offlineInstalledAt)} binaries=${sim.binariesInAt && Math.round(sim.binariesInAt)}`);
  const at = sim.installOffline('test');
  const again = sim.installOffline('test-again');
  r.ok('first-load: installOffline registers once and says when', typeof at === 'number' && again === at);
  const reg = await until(() => false, 0) || (await (async () => { for (let i = 0; i < 60; i++) { const g = await navigator.serviceWorker.getRegistration(); if (g) return g; await sleep(100); } return null; })());
  r.ok('first-load: the registration appears', !!reg);

  // The gate: a start asked for before the features are in waits, then starts.
  sim._featuresIn = false;
  let release;
  sim.featuresReady = new Promise((res) => { release = res; });
  const p = sim.startMode('free', { loadingScreen: false });
  await sleep(250);
  r.ok('first-load: a start before the features are in holds on the menu', sim.state === 'menu', `state=${sim.state}`);
  sim._featuresIn = true;
  release();
  await p;
  const flew = await until(() => sim.state === 'flying', 15000, 100);
  r.ok('first-load: ...and starts once they are', flew, `state=${sim.state}`);
  if (sim.quitToMenu) sim.quitToMenu();
  await until(() => sim.state === 'menu', 15000, 100);
  r.ok('first-load: back on the menu', sim.state === 'menu');

  // The .glb parse waits for the flight to end (offFlight), so it is never a hitch in the air.
  const fake = { state: 'flying' };
  let opened = false;
  const gate = Object.getPrototypeOf(sim).offFlight.call(fake).then(() => { opened = true; });
  await sleep(800);
  const heldInFlight = !opened;
  fake.state = 'paused';
  await Promise.race([gate, sleep(2000)]);
  r.ok('first-load: offFlight holds while flying and opens on a pause or the menu', heldInFlight && opened, `held ${heldInFlight}, opened ${opened}`);

  // A helicopter whose Blender model arrived after its stand-in was built is rebuilt at the next start.
  const BM = await import('../../src/vehicles/blender-models.js');
  await (sim._binariesLoading || Promise.resolve());
  if (BM.blenderModelStatus().heli === 'ready') {
    BM.setBlenderModels(false);
    sim.aircraftType = null;
    sim.setAircraft('harrier');
    const standIn = !sim.model.userData.blenderModel;
    BM.setBlenderModels(true);
    await sim.startMode('free', { aircraft: 'harrier', loadingScreen: false });
    await until(() => sim.state === 'flying', 15000, 100);
    r.ok('first-load: the next start swaps the stand-in helicopter for the Blender one', standIn && !!sim.model.userData.blenderModel, `stand-in ${standIn}, now blender ${!!sim.model.userData.blenderModel}`);
    if (sim.quitToMenu) sim.quitToMenu();
    await until(() => sim.state === 'menu', 15000, 100);
    sim.setAircraft('skylark');
  } else {
    r.ok('first-load: the Blender helicopter loaded (for the stand-in check)', false, JSON.stringify(BM.blenderModelStatus()));
  }
}
