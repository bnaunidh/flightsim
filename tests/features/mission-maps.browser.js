/**
 * Browser checks for "use different maps for different missions" (the owner,
 * 2026-10-02): the missions are spread over the game's islands where the
 * story fits — fire on forested maps, carrier ops on the carrier maps,
 * mountain rescues on mountain maps, city jobs on town maps — and every one
 * of them is still a mission somebody can finish.
 *
 *   1. The table: each moved mission pins the island it was given, and the
 *      missions now use many more of the thirty maps than before.
 *   2. Every moved mission STARTS on its island: the game loads that map,
 *      the aircraft (or the boat) is where the mission put it, above the
 *      ground, not crashed, with the runner running.
 *   3. Scripted pilots finish two of the moved flight missions here, on
 *      the real game (tests/features/mission-pilot.js) — the rest are flown
 *      by tests/features/mission-maps.playthrough.js, which is long.
 *
 * Every import is dynamic, the same rule as the other feature checks.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

/** Mission → the island it was moved to (and why, in a word). */
export const MOVED = {
  carrierqual: 'northwatch', // carrier ops: the air station with the carrier offshore
  tail: 'fjord', // hide in the fjords' cloud
  deadstick: 'meadow', // fields everywhere for an engine-out glide
  chaser: 'drovers', // tornado country: open farmland
  'meteor-shower': 'ember', // falling stars over the volcano
  'meteor-dodge': 'atoll', // open sky over the reef chain
  'meteor-photo': 'condor', // the observatory's cliffs
  'fire-spot': 'condor', // Egg Rock's grass
  'fire-night': 'fjord', // boreal woods above Aurora town
  'event-hijack': 'gateway', // a jumbo's airport, a long remote runway
  'event-hijack-real': 'gateway',
  'afo-normal': 'gateway',
  'afo-attack': 'airbase', // the military field
  lastlight: 'ravencrag', // mountain rescue
  oncall: 'meridian', // city calls
  overboard: 'carriergroup', // a man in the water among the ships
  'in-the-gale': 'stormcoast', // a gale off the storm coast
  'night-shout': 'harbour', // Cutter Bay's marked channel at night
  'man-overboard': 'lagoon', // a calm lagoon for a first search
};

export async function check(sim, r, say) {
  let MIS;
  let Terrain;
  let Pilot;
  try {
    MIS = await import('../../src/game/missions.js');
    Terrain = await import('../../src/world/terrain.js');
    Pilot = await import('./mission-pilot.js');
  } catch (err) {
    r.ok('mission maps: the modules load', false, String(err && err.message));
    return;
  }
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const noDebrief = () => clearTimeout(sim._crashDebriefT);
  const quit = () => {
    if (sim.state !== 'menu' && typeof sim.quitToMenu === 'function') sim.quitToMenu();
  };
  const wait = (ms) => new Promise((f) => setTimeout(f, ms));

  try {
    /* ---- 1. the table ---- */
    say('mission maps: the table');
    const wrong = [];
    for (const [id, map] of Object.entries(MOVED)) {
      const m = MIS.findMission(id);
      if (!m || m.map !== map) wrong.push(`${id}: ${m ? m.map : 'missing'} (wanted ${map})`);
    }
    r.ok('mission maps: every moved mission pins the island it was given', wrong.length === 0, wrong.join('; ') || `${Object.keys(MOVED).length} missions`);
    const used = new Set(MIS.MISSIONS.map((m) => m.map).filter(Boolean));
    r.ok('mission maps: the missions now live on at least eighteen of the thirty islands (eleven before)', used.size >= 18, `${used.size}: ${[...used].sort().join(', ')}`);
    const onKestrel = MIS.MISSIONS.filter((m) => m.map === 'kestrel' || m.map === 'kestrel-port').length;
    r.ok('mission maps: fewer than half the missions are on Kestrel (it was thirty-five of sixty)', onKestrel < MIS.MISSIONS.length / 2, `${onKestrel} of ${MIS.MISSIONS.length}`);
    const forest = ['fire-night', 'fire-bigburn', 'fire-ridge', 'fire-lineone'].map((id) => MIS.findMission(id)).filter(Boolean);
    r.ok('mission maps: the forest fires are on forested maps', forest.every((m) => ['fjord', 'meadow', 'firewatch'].includes(m.map)), forest.map((m) => `${m.id}:${m.map}`).join(', '));
    const carrierOnes = ['carrierqual', 'overboard'].map((id) => MIS.findMission(id)).filter(Boolean);
    r.ok('mission maps: the carrier jobs are on the maps with a carrier', carrierOnes.every((m) => ['northwatch', 'carriergroup'].includes(m.map)), carrierOnes.map((m) => `${m.id}:${m.map}`).join(', '));
    r.ok('mission maps: the mountain rescue is on the mountain map, the city calls in the city', MIS.findMission('lastlight').map === 'ravencrag' && MIS.findMission('oncall').map === 'meridian');

    /* ---- 2. every moved mission starts on its island ---- */
    say('mission maps: every moved mission starts');
    for (const [id, map] of Object.entries(MOVED)) {
      const m = MIS.findMission(id);
      if (!m) continue;
      try {
        if (m.roles) await sim.startMode('mission', { id, role: m.roles[0].id });
        else await sim.startAnyMission(id);
        // A boat or car job starts through startDrive, which rebuilds the world behind a paint.
        for (let i = 0; i < 300 && Terrain.MAP.id !== map; i++) await wait(10);
        for (let i = 0; i < 45; i++) {
          sim.step(1 / 30, 1 / 30);
          noDebrief();
        }
        const boat = sim.mode === 'drive' && sim.vehicle;
        const who = boat ? sim.vehicle : sim.aircraft;
        const g = Math.max(0, Terrain.heightAt(who.pos.x, who.pos.z));
        const above = boat ? who.pos.y >= -1 : who.pos.y >= g - 0.5;
        const crashed = boat ? !!who.crashed || !!who.aground : !!who.crashed;
        const running = sim.runner && sim.runner.status === 'running';
        r.ok(`mission maps: ${id} starts on ${map}, above the ground, not crashed, running`,
          Terrain.MAP.id === map && above && !crashed && running,
          `map ${Terrain.MAP.id}; at ${who.pos.x.toFixed(0)},${who.pos.z.toFixed(0)} y ${who.pos.y.toFixed(1)} (ground ${g.toFixed(1)}); crashed ${crashed}; runner ${sim.runner && sim.runner.status}${sim.aircraft && sim.aircraft.crashReason ? ' — ' + sim.aircraft.crashReason : ''}`);
      } catch (err) {
        r.ok(`mission maps: ${id} starts on ${map}`, false, String(err && err.message).slice(0, 200));
      }
      quit();
    }

    /* ---- 3. two of them flown to the end by the scripted pilot ---- */
    for (const id of ['deadstick', 'meteor-photo']) {
      say(`mission maps: the pilot flies ${id}`);
      const out = await Pilot.flyMission(sim, id, { say });
      r.ok(`mission maps: the scripted pilot finishes ${id} on ${MOVED[id]} without help`, out.ok && out.assisted.length === 0 && out.map === MOVED[id],
        `${out.status} in ${out.seconds.toFixed(0)} s on ${out.map}${out.crashed ? ', CRASHED: ' + out.crashReason : ''}; steps ${out.steps.join('>')}; ${out.log.slice(-3).join(' | ')}`);
      quit();
    }
  } finally {
    noDebrief();
    quit();
    sim.autoPauseOnHide = origAuto;
  }
}

export default check;
