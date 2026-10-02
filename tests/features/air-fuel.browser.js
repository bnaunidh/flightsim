/**
 * Browser checks for "start in the sky with 80% fuel", through the real door:
 * startMode() places the aeroplane and the gauge shows what it got.
 * tests/features/air-fuel.mjs has every mission's start fuel and its fuel
 * budget in node; this is what node cannot see:
 *
 *   - airborne missions (four types, on the suite's own map so nothing is
 *     rebuilt) start at AIRBORNE_START_FUEL, and the panel says 80%;
 *   - runway starts still get full tanks;
 *   - Try again starts the way the first go did — not topped up to full,
 *     and not left with what the failed go had burnt down to;
 *   - nothing in a mission tops the tank up while you fly it (realistic fuel
 *     on: 30 s takes exactly one per cent), and Back to runway is a runway
 *     start, so full tanks, as it always was;
 *   - Running on Fumes (campaign-b, not on the board) still flies on the nine
 *     litres its own onStart gives it;
 *   - Free Flight in the air keeps its own picker: full by default, what you
 *     chose when you chose.
 *
 * Puts the realistic-fuel switch back and leaves the game on the menu.
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  let M;
  let CB;
  try {
    M = await import('../../src/game/missions.js');
    CB = await import('../../src/game/campaign-b.js');
  } catch (err) {
    r.ok('air-fuel: the mission modules load', false, String(err && err.message));
    return;
  }
  const AIR = M.AIRBORNE_START_FUEL;
  const pct = () => sim.aircraft.fuelFraction();
  const near = (a, b, tol = 0.002) => Math.abs(a - b) <= tol;
  const show = (f) => `${(f * 100).toFixed(1)}%`;
  const settle = async (fn, ms = 4000) => {
    for (let i = 0; i < ms / 20 && !fn(); i++) await new Promise((f) => setTimeout(f, 20));
  };
  const realistic0 = sim.settings.realisticFuel;
  const added = [];
  try {
    // Airborne missions, four aeroplanes, all on Kestrel (or no map of their own).
    for (const id of ['storm', 'tail', 'goofy-gulls', 'fire-spot']) {
      await sim.startMode('mission', { id });
      const ac = sim.aircraft;
      r.ok(`air-fuel: ${id} (${sim.aircraftType.id}) starts in the air with ${Math.round(AIR * 100)}% fuel`,
        !ac.onGround && near(pct(), AIR), `${show(pct())}, ${Math.round(ac.agl)} m up`);
    }
    // The gauge reads it — no pop-up, the panel is how you find out.
    {
      sim.step(0.2, 1 / 30);
      const snap = sim.snapshot();
      const bar = sim.hud && sim.hud.fuelBar && sim.hud.fuelBar.val;
      r.ok('air-fuel: the fuel gauge shows 80% at an airborne start', snap.fuelPct === 80 && (!bar || bar.textContent === '80%'),
        `${snap.fuelPct}%${bar ? `, panel "${bar.textContent}"` : ''}`);
    }

    // Runway starts: full tanks, as always.
    for (const id of ['circuit', 'event-breakin']) {
      await sim.startMode('mission', { id });
      r.ok(`air-fuel: ${id} starts on the runway with full tanks`, sim.aircraft.onGround && pct() === 1, show(pct()));
    }

    // Try again: the same start as the first go.
    await sim.startMode('mission', { id: 'storm' });
    sim.aircraft.fuel *= 0.3;
    const burnt = pct();
    sim.restart();
    await settle(() => sim.state === 'flying' && near(pct(), AIR));
    r.ok('air-fuel: Try again starts the way the first go did (not full, not what was left)', near(pct(), AIR) && !sim.aircraft.onGround,
      `${show(burnt)} before, ${show(pct())} after`);

    // While you fly it, nothing tops it up: realistic fuel, 30 s = 1%.
    sim.aircraft.realisticFuel = true;
    sim.step(30, 1 / 30);
    r.ok('air-fuel: the mission keeps the fuel you have — 30 s on realistic fuel is 1% gone, nothing tops it up',
      sim.state === 'flying' && near(pct(), AIR - 0.01, 0.0015), show(pct()));
    sim.aircraft.realisticFuel = !!realistic0;
    // Back to runway is a runway start.
    sim.returnToAirport();
    r.ok('air-fuel: Back to runway puts you on the runway with full tanks, as before', sim.aircraft.onGround && pct() === 1, show(pct()));

    // Running on Fumes keeps its own scripted fuel. It is not on the board,
    // so it is put there for this and taken off again.
    const lowFuel = CB.CAMPAIGN_PART_B.find((m) => m.id === 'low-fuel');
    if (lowFuel && !M.findMission('low-fuel')) {
      M.MISSIONS.push(lowFuel);
      added.push(lowFuel);
      await sim.startMode('mission', { id: 'low-fuel' });
      r.ok('air-fuel: Running on Fumes still starts on its own 9 litres', !sim.aircraft.onGround && Math.abs(sim.aircraft.fuel - 9) < 0.01,
        `${sim.aircraft.fuel.toFixed(2)} L`);
    }

    // Free Flight in the air: its own picker, untouched.
    await sim.startMode('free', { airborne: true });
    r.ok('air-fuel: Free Flight in the air with no fuel chosen is still full', !sim.aircraft.onGround && pct() === 1, show(pct()));
    await sim.startMode('free', { airborne: true, fuel: 0.5 });
    r.ok('air-fuel: Free Flight in the air gets what the picker says', !sim.aircraft.onGround && near(pct(), 0.5), show(pct()));
  } catch (err) {
    r.ok('air-fuel: the checks ran to the end', false, String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
  } finally {
    for (const m of added) {
      const i = M.MISSIONS.indexOf(m);
      if (i >= 0) M.MISSIONS.splice(i, 1);
    }
    sim.settings.realisticFuel = realistic0;
    sim.aircraft.realisticFuel = !!realistic0;
    if (sim.state !== 'menu' && typeof sim.quitToMenu === 'function') sim.quitToMenu('main');
  }
}
