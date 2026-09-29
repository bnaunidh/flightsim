/**
 * The maps, checked in the running game.
 *
 * tests/features/maps.mjs measures every map in node, which is where most of
 * this belongs: the terrain is a function and the scenery is plain objects.
 * What node cannot tell you is whether the world the GAME builds — through
 * setMap(), the menus, the airport, the plug-in layer — is the one the data
 * describes. So this loads each of the three new maps for real and asks the
 * live objects:
 *
 *   - the map arrived and the terrain is the one asked for
 *   - the aeroplane is standing on the runway at field elevation, not in a
 *     hill and not in the air, and is not crashed half a second later
 *   - the scenery has what the map is about: Gateway's bridge, towers and
 *     airport estate, Northwatch's base and hover pads, Condor's gulls — and
 *     every map's lighthouse stands on land and its town has streets
 *   - the retired-map fallback, on the real settings: a saved 'lax' is put
 *     right to 'gateway', saved, and the menu says so — then the player's
 *     real setting is put back exactly as it was
 *
 * Then it puts the map the player was on back.
 *
 * @param {object} sim   window.__sim
 * @param {object} r     reporter: r.ok(name, pass, detail)
 * @param {function} say logger
 */
export async function check(sim, r, say = () => {}) {
  const grab = async (p) => {
    try {
      return await import(p);
    } catch (err) {
      say(`could not import ${p}: ${err.message}`);
      return null;
    }
  };
  const Terrain = await grab('../../src/world/terrain.js');
  const Maps = await grab('../../src/world/maps.js');
  const Retired = await grab('../../src/features/maps-retired.js');
  r.ok('maps: the map modules import', !!(Terrain && Maps && Retired));
  if (!Terrain || !Maps || !Retired) return;

  const wait = (ms) => new Promise((f) => setTimeout(f, ms));
  const startMap = sim.settings.map;

  /** setMap() rebuilds behind a paint; wait for the new scenery to exist. */
  const goTo = async (id) => {
    if (Terrain.MAP.id === id && sim.settings.map === id) return true;
    const before = sim.scenery;
    sim.setMap(id);
    for (let i = 0; i < 500 && (sim.scenery === before || Terrain.MAP.id !== id); i++) await wait(10);
    await wait(60);
    return Terrain.MAP.id === id && sim.scenery !== before;
  };

  /* ---- the retired-map fallback, on the live settings ---- */
  {
    const saved = sim.settings.map;
    const seen = [];
    const realSync = sim.menus.syncMap.bind(sim.menus);
    sim.menus.syncMap = (id) => { seen.push(id); realSync(id); };
    sim.settings.map = 'lax';
    let did = null;
    try {
      did = Retired.settleSavedMap(sim);
    } finally {
      sim.menus.syncMap = realSync;
    }
    let reread = null;
    try {
      reread = JSON.parse(localStorage.getItem('islandsim.settings.v1') || '{}').map;
    } catch (e) {
      reread = null;
    }
    r.ok('maps: a saved retired map is rewritten to its replacement and saved',
      !!did && did.to === 'gateway' && sim.settings.map === 'gateway' && reread === 'gateway' && seen[0] === 'gateway',
      `settings.map ${sim.settings.map}, stored ${reread}, menu told ${seen.join(',') || 'nothing'}`);
    // Put the player's own setting back exactly as it was.
    sim.settings.map = saved;
    try {
      const { saveSettings } = await import('../../src/core/storage.js');
      saveSettings(sim.settings);
    } catch (e) {
      /* the reread above already showed storage works */
    }
    sim.menus.syncMap(saved);
  }

  /* ---- the three new maps, built for real ---- */
  for (const id of ['gateway', 'northwatch', 'condor']) {
    const arrived = await goTo(id);
    r.ok(`maps: ${id} loads`, arrived, arrived ? '' : `still on ${Terrain.MAP.id}`);
    if (!arrived) continue;
    sim.step(0.5);
    const ac = sim.aircraft;
    const elev = Terrain.AIRPORT.elev;
    const onRwy = Terrain.isOnRunway(ac.pos.x, ac.pos.z);
    r.ok(`maps: ${id} puts the aeroplane on its runway at field elevation`,
      onRwy && Math.abs(Terrain.heightAt(ac.pos.x, ac.pos.z) - elev) < 0.3 && !ac.crashed,
      `at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)}, ground ${Terrain.heightAt(ac.pos.x, ac.pos.z).toFixed(1)} m, field ${elev} m${ac.crashed ? ', CRASHED' : ''}`);
    const sc = sim.scenery;
    const lh = sc && sc.lighthouseAt;
    r.ok(`maps: ${id}'s lighthouse stands on land`, !!lh && Terrain.heightAt(lh.x, lh.z) >= 2,
      lh ? `${Terrain.heightAt(lh.x, lh.z).toFixed(0)} m` : 'no lighthouse');
    // The town the game built is laid along streets, not scattered.
    r.ok(`maps: ${id}'s town is built along streets`, !!(sc.town && sc.town.houses + sc.town.blocks > 0 && sc.town.streets > 0),
      sc.town ? `${sc.town.houses} houses, ${sc.town.blocks} blocks, ${sc.town.streets} streets` : 'no town');
    if (id === 'gateway') {
      const b = sim.features && sim.features.bridge;
      r.ok('maps: Gateway has its bridge, and room under it', !!b && b.clearance >= 45, b ? `${b.mainSpan.toFixed(0)} m span, ${b.clearance.toFixed(1)} m under the deck` : 'no bridge');
      r.ok('maps: Gateway\'s city has towers', !!(sc.town && sc.town.towers >= 12), sc.town ? `${sc.town.towers} towers, tallest ${Math.round(sc.town.tallest)} m` : '');
      r.ok('maps: Gateway\'s runway is jumbo-length', Terrain.AIRPORT.runway.length >= 3500, `${Terrain.AIRPORT.runway.length} m`);
      const e = sc.estate;
      r.ok('maps: Gateway has warehouses, car parks and hotels', !!(e && e.sheds >= 5 && e.parks >= 2 && e.hotels >= 1),
        e ? `${e.sheds} sheds, ${e.parks} car parks, ${e.cars} cars, ${e.hotels} hotels` : 'none');
    }
    if (id === 'northwatch') {
      const Pads = await grab('../../src/world/pads.js');
      const hov = Pads ? Pads.PADS.filter((p) => String(p.id).startsWith('hover')) : [];
      r.ok('maps: Northwatch has its base and two level hover pads',
        !!(sc.base && sc.base.parkSpots.length) && hov.length === 2 && hov.every((p) => Math.abs(p.pos.y - elev) < 0.3),
        hov.map((p) => `${p.id} ${p.pos.y.toFixed(1)}`).join(', '));
    }
    if (id === 'condor') {
      const f = sim.features && sim.features.flocks;
      r.ok('maps: Condor Rock has its gulls', !!(f && f.length && f[0].n >= 12), f && f.length ? `${f[0].n}` : 'none');
    }
  }
  /* ---- and back to where the player was ---- */
  const back = await goTo(startMap);
  r.ok('maps: the player\'s own map is put back', back || Terrain.MAP.id === Maps.resolveMapId(startMap), `${Terrain.MAP.id}`);
}

export default check;
