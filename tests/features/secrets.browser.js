/**
 * Secret planes, played in the real game: walk up to the shed on Kestrel, hold
 * E at the door, the plane is found and yours for good, the Hangar stops
 * hiding it, you take it, and it flies. Then the tornado-proof Storm Petrel,
 * Air Force One for 80+ on Under Attack (and not for less), and the on-foot
 * Reset and rides: get out, Reset is offered, get in anything and it is gone.
 *
 * `check(sim, r, say)`, r.ok(name, pass, detail) per assertion.
 */

const near = (a, b, m) => Math.hypot(a.x - b.x, a.z - b.z) < m;

export async function check(sim, r, say = () => {}) {
  const { onFoot, getOut } = await import('../../src/features/onfoot.js');
  const Interact = await import('../../src/features/interact.js');
  const Rides = await import('../../src/features/rides.js');
  const { getAircraft, baseTypeId } = await import('../../src/aircraft/types.js');
  const Prog = await import('../../src/game/progression.js');
  const origRender = sim.renderer.render;
  const auto = sim.autoPauseOnHide;
  sim.renderer.render = () => {};
  sim.autoPauseOnHide = false;
  const S = sim.secrets;
  const step = (secs) => {
    for (let i = 0; i < Math.round(secs * 15); i++) sim.step(1 / 15);
  };
  const owned = (id) => Prog.isUnlocked(sim.prog, id);
  try {
    r.ok('secrets: the API is in', !!S && typeof S.state === 'function');
    S.forget();
    if (sim.applySettings) sim.applySettings({ map: 'kestrel' });
    sim.settings.map = 'kestrel';
    await sim.startMode('free', { aircraft: 'skylark' });
    step(0.5);
    const st = S.state();
    r.ok('secrets: Kestrel has its two hiding places, both sited', st.map === 'kestrel' && st.hideouts.length === 2 && st.unsited.length === 0, JSON.stringify(st.hideouts.map((h) => h.id)));

    /* The Hangar hides what you have not found. */
    sim.menus.syncFleetLocks && sim.menus.syncFleetLocks();
    const card = sim.menus.screens.free.querySelector('[data-aircraft="speedster"]');
    r.ok('secrets: an unfound plane is a silhouette with a hint, not its name', !card || card.classList.contains('is-secret'), card ? card.textContent.trim().slice(0, 80) : 'no card');
    r.ok('secrets: and it cannot be flown yet', !owned('speedster'));

    /* On foot to the shed, E at the door. */
    say('secrets: the shed');
    const ac = sim.aircraft;
    const shed = st.hideouts.find((h) => h.plane === 'speedster');
    ac.reset({ pos: new (await import('../../src/vendor/three.module.js')).Vector3(shed.door.x, 0, shed.door.z + 14), headingDeg: 0, speed: 0, engineOn: false, fuel: 1 });
    step(1);
    r.ok('secrets: stopped on the ground you can get out', getOut(sim) !== false && onFoot.active, `active ${onFoot.active}`);
    step(1);
    r.ok('secrets: out of an aeroplane, Reset is on offer', Rides.resetAvailable(sim));
    const w = onFoot.walker;
    w.x = shed.door.x;
    w.z = shed.door.z + 2;
    step(0.3);
    const look = 0; // facing north, at the door a couple of metres ahead
    const f1 = Interact.frame(sim, w, look, 0.1, true);
    r.ok('secrets: the door is a candidate on the one E prompt', !!f1 && /secret-door/.test(f1.id), f1 ? `${f1.id}: ${f1.label}` : 'nothing in reach');
    r.ok('secrets: the prompt reads as a tap on a touch screen', /^Tap here/.test(Interact.promptHtml(sim, true)), Interact.promptHtml(sim, true));
    for (let i = 0; i < 16; i++) Interact.frame(sim, w, look, 0.1, true);
    step(5);
    const opened = S.state().hideouts.find((h) => h.id === shed.id);
    r.ok('secrets: holding E opens the shed', opened.open > 0.5, `open ${opened.open}`);
    const h = S.hideout(shed.id);
    const p = h.planeWorld();
    w.x = p.x;
    w.z = p.z + 3;
    step(3);
    r.ok('secrets: walking in finds the plane', S.state().hideouts.find((x) => x.id === shed.id).found, JSON.stringify(S.state().found));
    step(5);
    r.ok('secrets: it is in your Hangar for good', owned('speedster'));
    sim.menus.syncFleetLocks && sim.menus.syncFleetLocks();
    r.ok('secrets: the card has its name back', !card || (!card.classList.contains('is-secret') && /Speedster/.test(card.textContent)), card ? card.textContent.trim().slice(0, 60) : 'no card');

    /* Take it: a ride, where it stands. */
    say('secrets: taking the ride');
    const rides = Rides.ridesState(sim);
    r.ok('secrets: Reset and rides report state', !!rides, JSON.stringify(rides).slice(0, 160));
    await sim.startMode('free', { aircraft: 'speedster' });
    step(1);
    r.ok('secrets: the Speedster flies as itself, drawn as a Skylark', sim.aircraftType.id === 'speedster' && baseTypeId('speedster') === 'skylark' && !!sim.model, sim.aircraftType.id);
    r.ok('secrets: getting back in anything takes Reset away', !Rides.resetAvailable(sim));
    sim.quitToMenu('main');

    /* The Storm Petrel. */
    r.ok('secrets: the Storm Petrel is tornado-proof', getAircraft('stormpetrel').stormProof === true && getAircraft('stormpetrel').name === 'Storm Petrel');

    /* Air Force One: 80 or more on Under Attack, not less. */
    say('secrets: Air Force One');
    await sim.startMode('mission', { id: 'afo-attack' });
    step(0.3);
    r.ok('secrets: Air Force One is not yours yet', !owned('af1'));
    const finish = (score) => sim.onMissionComplete({ id: 'afo-attack', name: 'Under Attack', score, time: 300, landing: null });
    finish(79);
    r.ok('secrets: 79 on Under Attack does not unlock it', !owned('af1'));
    await sim.startMode('mission', { id: 'afo-attack' });
    step(0.3);
    finish(85);
    r.ok('secrets: 85 does, for good', owned('af1'));
    const shown = sim.menus.screens.debrief.textContent;
    r.ok('secrets: and the debrief says so', /AIR FORCE ONE UNLOCKED/.test(shown), shown.slice(0, 120));
    sim.quitToMenu('main');
    await sim.startMode('free', { aircraft: 'af1' });
    step(1);
    r.ok('secrets: Air Force One flies in Free Flight, a 747 at heart', sim.aircraftType.id === 'af1' && baseTypeId('af1') === 'b747', sim.aircraftType.id);
  } catch (e) {
    r.ok('secrets: the check ran without throwing', false, String(e && (e.stack || e.message)).slice(0, 600));
  } finally {
    sim.renderer.render = origRender;
    sim.autoPauseOnHide = auto;
    try {
      S.forget();
      sim.quitToMenu('main');
    } catch (e) {
      /* the menu is where the next check starts */
    }
  }
}

export default check;
