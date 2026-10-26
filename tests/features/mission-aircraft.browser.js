/**
 * Missions fly fitting aircraft, in the real game (the owner, 2026-10-25;
 * src/game/mission-aircraft.js; node side tests/features/mission-aircraft.mjs):
 *
 *   - every flight and helicopter mission card says "Recommended aircraft: …",
 *     the boat's and the car's say nothing of the kind
 *   - starting a mission puts you in its recommended type whatever you flew
 *     last (an A380 picked on the Free Flight screen does not fly Man
 *     Overboard), or in the one you picked when the mission takes it (the
 *     UH-60 for Man Overboard)
 *   - Night Medevac is on the helicopter's board, in the H145
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */
export async function check(sim, r, say = () => {}) {
  let MA;
  let M;
  let TY;
  try {
    MA = await import('../../src/game/mission-aircraft.js');
    M = await import('../../src/game/missions.js');
    TY = await import('../../src/aircraft/types.js');
  } catch (err) {
    r.ok('mission aircraft: the modules load', false, String(err && err.message));
    return;
  }
  const nameOf = (id) => (TY.AIRCRAFT.find((a) => a.id === id) || {}).name;
  const chosenWas = sim.menus.chosenAircraft;
  const autoWas = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  try {
    say('mission aircraft: the cards');
    const board = sim.menus.screens && sim.menus.screens.missions;
    const wrong = [];
    for (const m of M.MISSIONS) {
      const card = board && board.querySelector(`[data-mission="${m.id}"]`);
      if (!card) continue;
      const line = card.querySelector('.mission-craft');
      const flies = ['flight', 'heli'].includes(M.gameOf(m));
      const want = MA.recommendedLine(m, nameOf);
      if (flies && (!line || line.textContent.replace(/\s+/g, ' ').trim() !== want)) wrong.push(`${m.id}: ${line ? line.textContent.trim() : 'no line'}`);
      if (!flies && line) wrong.push(`${m.id} (${M.gameOf(m)}) has one`);
    }
    r.ok('every flight and helicopter mission card says "Recommended aircraft: …" (and no boat or car job does)', !!board && wrong.length === 0, wrong.slice(0, 4).join('; '));

    say('mission aircraft: starting missions');
    const flown = async (id, chosen) => {
      sim.menus.chosenAircraft = chosen;
      await sim.startAnyMission(id);
      const got = sim.aircraftType && sim.aircraftType.id;
      if (sim.quitToMenu) sim.quitToMenu('main');
      return got;
    };
    const cases = [
      ['overboard', 'a380', 'aw139', 'Man Overboard in the AW139 (an A380 picked on the Free Flight screen does not count)'],
      ['overboard', 'uh60', 'uh60', '…in the UH-60 when that is the one picked (the mission takes it)'],
      ['medevac', 'skylark', 'h145', 'Night Medevac in the H145, the air ambulance'],
      ['classd-transfer', 'skylark', 'c17', 'the Class-D transfer in the C-17'],
      ['chaser', 'f22', 'tempest', 'Storm Chaser in the Tempest research aeroplane'],
      ['circuit', 'a380', 'skylark', 'the Island Circuit in the trainer it is written for'],
      ['afo-normal', 'skylark', 'b747', 'Air Force One in the 747'],
    ];
    for (const [id, chosen, want, label] of cases) {
      const got = await flown(id, chosen);
      r.ok(`mission aircraft: ${label}`, got === want, `${id}: ${got}`);
    }
    // The loading screen names the aircraft before the flight starts (features/loading-screens.js planMode): the
    // one startMode will put you in, the UH-60 when that is the one picked, not the AW139 the mission recommends.
    if (sim.loading && sim.loading.planMode) {
      const said = [];
      for (const [id, chosen, want] of [['overboard', 'uh60', 'uh60'], ['overboard', 'a380', 'aw139'], ['lastlight', 'aw139', 'aw139'], ['classd-transfer', 'skylark', 'c17']]) {
        sim.menus.chosenAircraft = chosen;
        const plan = sim.loading.planMode('mission', { id });
        if (!plan || plan.vehicle !== nameOf(want)) said.push(`${id} with ${chosen} picked: says ${plan && plan.vehicle}, flies ${nameOf(want)}`);
      }
      r.ok('mission aircraft: the loading screen names the aircraft the mission is really flown in', said.length === 0, said.join('; '));
    }
    r.ok('mission aircraft: Night Medevac is on the helicopter\'s board', M.missionsFor('heli').some((m) => m.id === 'medevac') && !M.missionsFor('flight').some((m) => m.id === 'medevac'));
  } catch (err) {
    r.ok('mission aircraft: the check ran', false, String((err && err.stack) || err).slice(0, 300));
  } finally {
    sim.menus.chosenAircraft = chosenWas;
    sim.autoPauseOnHide = autoWas;
  }
}
