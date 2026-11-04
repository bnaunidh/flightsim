/**
 * The plane, the Free Flight screen and the map, again after a reload.
 *
 *   node .claude/devtools/briefs/one-check.mjs '<url>/?mute=1' ./tests/features/remember-last.browser.js check "" 1
 *
 * The owner, 2026-11-03: "make the game remeber the plane u choose, the free
 * flight settings u chose and map u chose from last time".
 *
 * The game under test is a second copy in an iframe of this page: it shares
 * this page's localStorage, and this page's test goes on running when that
 * copy is really reloaded (contentWindow.location.reload()). Every check of a
 * "reload" here is a real boot from what was saved.
 *
 *   THE PLANE     remembered as it is picked, with no flight; a helicopter
 *                 picked on the Rotors page comes back there; locked, hidden
 *                 and unknown ones fall back
 *   FREE FLIGHT   every control comes back; an old save, unknown ids and
 *                 nonsense in it do not throw and do not blank a control
 *   THE MAP       per game; a borrowed map is never saved as yours, whatever
 *                 is saved during the mission; a reload during the mission;
 *                 a map that no longer exists
 *   THE WORLD MAP remembered, shown on the card and in the menu, NOT built at
 *                 boot (nothing of the ring fetched); Take off builds it, with
 *                 the setup that was on the screen; the field and the pin
 *   BROKEN SAVES  not JSON at all; a pin that is not numbers
 * localStorage is put back afterwards.
 */
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const SETTINGS = 'islandsim.settings.v1';

function makeGame(url) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:800px;z-index:9999;border:0;background:#000';
  f.src = url;
  document.body.appendChild(f);
  return f;
}

/** A settled game in the frame: its features in, its own frame loop stopped (the tests own the clock). */
async function ready(f) {
  for (let i = 0; i < 1600; i++) {
    const w = f.contentWindow;
    const sim = w && w.__sim;
    if (sim && sim.menus && sim.state === 'menu' && sim._featuresIn && sim.worldPreview) {
      w.requestAnimationFrame = () => 0;
      await wait(150);
      return { w, sim };
    }
    await wait(50);
  }
  throw new Error('the game in the frame never came to its menu');
}

async function reload(f) {
  const was = f.contentWindow.__sim;
  f.contentWindow.location.reload();
  for (let i = 0; i < 400 && f.contentWindow && f.contentWindow.__sim === was; i++) await wait(25);
  return ready(f);
}

/** A module of the game in the frame: from a script of the frame's own, or it is this page's copy. */
function load(w, path) {
  return new Promise((res, rej) => {
    const key = `__rl${Math.random().toString(36).slice(2)}`;
    w[key] = { res, rej };
    const sc = w.document.createElement('script');
    sc.textContent = `import(${JSON.stringify(new URL(path, w.location.href).href)}).then(window.${key}.res, window.${key}.rej)`;
    w.document.head.appendChild(sc);
    sc.remove();
  });
}

const saved = () => JSON.parse(localStorage.getItem(SETTINGS) || '{}');
function editSave(fn) {
  const s = saved();
  fn(s);
  localStorage.setItem(SETTINGS, JSON.stringify(s));
}

/** A control on the Free Flight screen, changed the way a person changes it. */
function set(sim, sel, value) {
  const el = sim.menus.screens.free.querySelector(sel);
  if (el.type === 'checkbox') el.checked = value;
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el;
}

async function takeOff(sim) {
  sim.menus.screens.free.querySelector('[data-fly]').click();
  for (let i = 0; i < 2400 && sim.state !== 'flying'; i++) await wait(50);
  return sim.state === 'flying';
}

export async function check(topSim, r) {
  const ok = (n, p, d = '') => r.ok(n, p, `${n}${d ? ` -- ${d}` : ''}`);
  const snapshot = {};
  for (let i = 0; i < localStorage.length; i++) snapshot[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
  const errors = [];
  const f = makeGame(location.href);
  const watch = () => {
    f.contentWindow.addEventListener('error', (e) => errors.push(e.message));
    f.contentWindow.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  };
  try {
    localStorage.removeItem(SETTINGS);
    localStorage.removeItem('islandsim.worldpreview.v1');
    let { w, sim } = await ready(f);
    ({ w, sim } = await reload(f));
    watch();
    const Prog = await load(w, 'src/game/progression.js');
    const { AIRCRAFT } = await load(w, 'src/aircraft/types.js');
    const { HIDDEN_AIRCRAFT } = await load(w, 'src/core/edition.js');
    const rotor = (a) => !!(a.shape && a.shape.power && a.shape.power.rotor);
    const free = (fn) => AIRCRAFT.find((a) => fn(a) && Prog.isUnlocked(sim.prog, a.id));

    /* ---- the plane ---- */
    const plane = free((a) => !rotor(a) && a.id !== 'skylark') || AIRCRAFT[0];
    sim.menus.show('free');
    sim.menus.screens.free.querySelector(`[data-aircraft="${plane.id}"]`).click();
    ok('plane: picking one writes it down at once, with no flight', saved().aircraft === plane.id, `${saved().aircraft}`);
    ({ w, sim } = await reload(f));
    watch();
    ok('plane: it is the choice after a reload', sim.menus.chosenAircraft === plane.id, sim.menus.chosenAircraft);
    ok('plane: its card is lit', !!sim.menus.screens.free.querySelector(`[data-aircraft="${plane.id}"].is-on`));
    ok('plane: the summary names it', sim.menus.screens.free.querySelector('[data-summary]').textContent.includes(plane.name));
    const heli = free((a) => rotor(a) && a.id !== 'harrier');
    if (heli) {
      sim.switchGame('heli');
      sim.menus.pickFreeAircraft(heli.id);
      ({ w, sim } = await reload(f));
      watch();
      ok('helicopter: the aeroplane game keeps its aeroplane', sim.menus.chosenAircraft === plane.id, sim.menus.chosenAircraft);
      sim.switchGame('heli');
      ok('helicopter: the Rotors page has the helicopter you picked', sim.menus.chosenAircraft === heli.id, sim.menus.chosenAircraft);
      sim.switchGame('flight');
      ok('helicopter: and back, the aeroplane you picked', sim.menus.chosenAircraft === plane.id, sim.menus.chosenAircraft);
    }
    const locked = AIRCRAFT.find((a) => !Prog.isUnlocked(sim.prog, a.id));
    for (const [what, id] of [['a locked plane', locked && locked.id], ['a hidden plane', [...HIDDEN_AIRCRAFT][0]], ['a plane that is gone', 'no-such-plane'], ['not a plane at all', 7]]) {
      if (id == null) continue;
      editSave((s) => { s.aircraft = id; });
      ({ w, sim } = await reload(f));
      watch();
      ok(`plane: ${what} falls back to the trainer`, sim.menus.chosenAircraft === 'skylark', sim.menus.chosenAircraft);
    }

    /* ---- the Free Flight screen ---- */
    sim.menus.show('free');
    const scr = () => sim.menus.screens.free;
    const failId = scr().querySelector('[data-fail]').dataset.fail;
    const eventId = scr().querySelector('[data-event]').dataset.event;
    set(sim, '[data-fuel]', 35);
    set(sim, '[data-wind]', 22);
    set(sim, '[data-dir]', 140);
    const time = scr().querySelector('[data-time]');
    const cond = scr().querySelector('[data-cond]');
    const timeV = [...time.options].map((o) => o.value).find((v) => v !== time.value);
    const condV = [...cond.options].map((o) => o.value).find((v) => v !== 'random' && v !== cond.value);
    set(sim, '[data-time]', timeV);
    set(sim, '[data-cond]', condV);
    set(sim, '[data-hour]', 17);
    set(sim, `[data-fail="${failId}"]`, true);
    set(sim, `[data-fail-delay="${failId}"]`, 9);
    const amount = scr().querySelector('[data-fail-amount]');
    const amountId = amount && amount.dataset.failAmount;
    if (amountId) {
      set(sim, `[data-fail="${amountId}"]`, true);
      set(sim, `[data-fail-amount="${amountId}"]`, 7);
    }
    set(sim, `[data-event="${eventId}"]`, true);
    set(sim, `[data-event-delay="${eventId}"]`, 11);
    set(sim, '[data-event="tornado"]', true);
    set(sim, '[data-ef]', 3);
    set(sim, '[data-random-disasters]', true);
    if (scr().querySelector('[data-practice-targets]')) set(sim, '[data-practice-targets]', true);
    scr().querySelector('[data-start="air"]').click();
    const want = JSON.stringify(sim.menus.readFree());
    ({ w, sim } = await reload(f));
    watch();
    const got = sim.menus.readFree();
    ok('free: everything on the screen comes back', JSON.stringify(got) === want, JSON.stringify(got).slice(0, 300));
    ok('free: an armed row shows its sliders', !scr().querySelector(`[data-fail="${failId}"]`).closest('[data-fail-row]').querySelector('.fail-sliders').hidden);
    ok('free: the delay says so', /9 min/.test(scr().querySelector(`[data-fail-delay-val="${failId}"]`).textContent));
    ok('free: the start is lit', !!scr().querySelector('[data-start="air"].is-on'));
    ok('free: the summary follows', /35%|min of fuel/.test(scr().querySelector('[data-summary]').textContent) || /fuel/.test(scr().querySelector('[data-summary]').textContent));
    sim.menus.syncSettings(sim.settings);
    ok('free: a change in Settings does not put the sky back', JSON.stringify(sim.menus.readFree()) === want);
    // Take off, and the setup is the same after that flight's reload too.
    ok('free: Take off flies it', await takeOff(sim));
    sim.quitToMenu('main');
    ({ w, sim } = await reload(f));
    watch();
    ok('free: and after that flight, still the same', JSON.stringify(sim.menus.readFree()) === want);

    // A save from another version.
    editSave((s) => {
      s.freeSetup = { fuel: 'lots', time: 'teatime', condition: 'frogs', windSpeedKts: 'NaN', windDirDeg: null, tornadoEF: 'x', failures: { nosuchfailure: { afterMin: 3 }, [failId]: { afterMin: 'soon', amountMin: {} } }, events: { nosuchevent: { afterMin: 1 }, [eventId]: true } };
    });
    ({ w, sim } = await reload(f));
    watch();
    const odd = sim.menus.readFree();
    ok('old save: nonsense leaves the controls with real values', Number.isFinite(odd.fuel) && odd.fuel > 0 && !!odd.time && !!odd.condition && Number.isFinite(odd.windSpeedKts) && Number.isFinite(odd.windDirDeg), JSON.stringify(odd).slice(0, 200));
    ok('old save: ids that are gone are ignored', !('nosuchfailure' in odd.failures) && !('nosuchevent' in odd.events));
    ok('old save: an id still here is ticked', failId in odd.failures && eventId in odd.events);
    editSave((s) => { s.freeSetup = 'not an object'; });
    ({ w, sim } = await reload(f));
    watch();
    ok('old save: a setup that is not one is skipped', Number.isFinite(sim.menus.readFree().fuel));
    editSave((s) => { delete s.freeSetup; });

    /* ---- the map ---- */
    const flying = sim.menus.screens.maps.querySelectorAll('[data-choose-map]');
    const ids = [...flying].map((b) => b.dataset.chooseMap);
    const myMap = ids.find((id) => id !== 'kestrel');
    sim.menus.hooks.chooseMap(myMap);
    await wait(400);
    ({ w, sim } = await reload(f));
    watch();
    let T = await load(w, 'src/world/terrain.js');
    ok('map: the flight game\'s map comes back', sim.settings.map === myMap && T.MAP.id === myMap, `${sim.settings.map} / ${T.MAP.id}`);
    ok('map: the menu says it', sim.menus.screens.maps.querySelector(`[data-map-card="${myMap}"]`).classList.contains('is-current'));
    sim.switchGame('boat');
    const { boatMaps } = await load(w, 'src/world/maps.js');
    // Not the first: that is the one the boat falls back on when it remembers nothing.
    const boatMap = boatMaps().map((m) => m.id).filter((id) => id !== myMap).pop();
    sim.menus.hooks.chooseMap(boatMap);
    await wait(400);
    ({ w, sim } = await reload(f));
    watch();
    T = await load(w, 'src/world/terrain.js');
    ok('map: per game: the boat\'s choice is not the aeroplane\'s', sim.settings.map === myMap && T.MAP.id === myMap, sim.settings.map);
    ok('map: per game: the boat keeps its own', sim.mapForGame('boat') === boatMap, sim.mapForGame('boat'));
    sim.switchGame('boat');
    ok('map: the boat\'s front page says the boat\'s map', sim.menus.screens.maps.querySelector(`[data-map-card="${boatMap}"]`).classList.contains('is-current'));
    sim.switchGame('flight');
    await wait(100);
    ok('map: back in the aeroplane, your map', sim.settings.map === myMap, sim.settings.map);

    // A mission borrows a map; something saves mid-flight; the tab closes.
    const { MISSIONS } = await load(w, 'src/game/missions.js');
    const borrow = MISSIONS.find((m) => m.map && m.map !== myMap);
    if (borrow) {
      await sim.startMode('mission', { id: borrow.id });
      ok('borrow: the mission is on its own map', sim.settings.map === borrow.map, sim.settings.map);
      sim.menus.hooks.onSetting && sim.menus.hooks.onSetting('subtitles', true);
      sim.saveCheckpoint && sim.saveCheckpoint();
      w.localStorage.setItem(SETTINGS, w.JSON.stringify(sim.settings));
      ({ w, sim } = await reload(f));
      watch();
      T = await load(w, 'src/world/terrain.js');
      ok('borrow: a reload during the mission boots your map, not the mission\'s', sim.settings.map === myMap && T.MAP.id === myMap, `${sim.settings.map}`);
    }
    sim.clearCheckpoint && sim.clearCheckpoint();

    // A map that has gone.
    editSave((s) => { s.gameMap = { flight: 'no-such-map', boat: 'no-such-map', car: 9 }; s.map = 'no-such-map'; });
    ({ w, sim } = await reload(f));
    watch();
    T = await load(w, 'src/world/terrain.js');
    ok('gone: a saved map that no longer exists boots the default', T.MAP.id === 'kestrel' && sim.settings.map === 'kestrel', `${T.MAP.id} / ${sim.settings.map}`);
    ok('gone: the boat does not go there either', sim.mapForGame('boat') !== 'no-such-map', sim.mapForGame('boat'));
    editSave((s) => { s.gameMap = 'junk'; s.map = 12; });
    ({ w, sim } = await reload(f));
    watch();
    T = await load(w, 'src/world/terrain.js');
    ok('gone: a map memory that is junk boots the default', T.MAP.id === 'kestrel');

    /* ---- the World Map ---- */
    const wp0 = sim.worldPreview;
    const P = await load(w, 'src/world/worldmap/preview.js');
    const field = P.AIRPORTS[3];
    sim.menus.show('maps');
    let c = sim.menus.screens.maps.querySelector('[data-world-preview-card]');
    c.querySelector(`[data-wp-pick="${field.id}"]`).click();
    const built = wp0.whenBuilt();
    c.querySelector('[data-wp-fly]').click();
    await Promise.race([built, wait(60000)]);
    ok('world: chosen', wp0.active() && !!wp0.built());
    ({ w, sim } = await reload(f));
    watch();
    T = await load(w, 'src/world/terrain.js');
    const fetched = (re) => w.performance.getEntriesByType('resource').filter((e) => re.test(e.name)).length;
    ok('world: a reload boots the normal menu world', T.MAP.id === 'kestrel' && sim.settings.map === 'kestrel', T.MAP.id);
    ok('world: nothing of it is built', !sim.worldPreview.active() && !sim.worldPreview.built() && !sim.worldPreview.stream());
    ok('world: nothing of the ring is fetched', fetched(/farlands/) === 0, `${fetched(/farlands/)}`);
    c = sim.menus.screens.maps.querySelector('[data-world-preview-card]');
    sim.menus.show('maps');
    const cur = c.querySelector('[data-wp-current]');
    ok('world: the card says it is your map', !cur.hidden && c.classList.contains('is-current'), cur.textContent);
    ok('world: no other card says so', !sim.menus.screens.maps.querySelector('[data-map-card].is-current'));
    ok('world: the field is still picked', c.querySelector(`[data-wp-pick="${field.id}"]`).getAttribute('aria-checked') === 'true');
    const fetched2 = fetched(/worldmap\/stream-worker|terrain-worker/);
    ok('world: no worker of its own started', fetched2 === 0, `${fetched2}`);
    const name = sim.menus.root.querySelector('[data-map-name]').textContent;
    const blurb = sim.menus.root.querySelector('[data-map-blurb]');
    ok('world: the menu says the World Map', /World Map/.test(name), name);
    ok('world: and from which field', !blurb || blurb.textContent.includes(field.code), blurb && blurb.textContent);
    sim.switchGame('boat');
    sim.switchGame('flight');
    await wait(100);
    ok('world: a trip to another game keeps it waiting, still unbuilt', sim.waitingMap === 'world-preview' && !sim.worldPreview.built() && /World Map/.test(sim.menus.root.querySelector('[data-map-name]').textContent));
    // Fly: built now, with the setup that was on the screen.
    sim.menus.show('free');
    set(sim, '[data-fuel]', 44);
    set(sim, '[data-wind]', 17);
    const flewWith = sim.menus.readFree();
    let starts = 0;
    const startMode = sim.startMode;
    sim.startMode = function counted(...a) { starts++; return startMode.apply(this, a); };
    sim.menus.screens.free.querySelector('[data-fly]').click();
    ok('world: Take off builds it and flies', await takeOff(sim));
    sim.startMode = startMode;
    ok('world: a double tap is one flight', starts === 1, `${starts}`);
    T = await load(w, 'src/world/terrain.js');
    ok('world: on the World Map, from the field', T.MAP.id === 'world-preview' && sim.worldPreview.built() && sim.worldPreview.built().id === field.id, `${T.MAP.id} ${sim.worldPreview.built() && sim.worldPreview.built().id}`);
    ok('world: the flight is the setup on the screen', Math.round(sim.modeOpts.fuel * 100) === 44, `${sim.modeOpts.fuel}`);
    ok('world: the screen was not left with the map\'s weather', sim.menus.readFree().windSpeedKts === flewWith.windSpeedKts && sim.modeOpts.windSpeedKts === flewWith.windSpeedKts, `${sim.menus.readFree().windSpeedKts}`);
    sim.quitToMenu('main');

    // The pin.
    sim.worldPreview.setPin({ x: 41000, z: -39000 });
    ({ w, sim } = await reload(f));
    watch();
    ok('pin: on the card after a reload', !!sim.worldPreview.pin() && Math.hypot(sim.worldPreview.pin().x - 41000, sim.worldPreview.pin().z + 39000) < 1, JSON.stringify(sim.worldPreview.pin()));
    c = sim.menus.screens.maps.querySelector('[data-world-preview-card]');
    ok('pin: the card says so', !c.querySelector('[data-wp-pinline]').hidden && /XF|X[A-Z]{3}/.test(c.querySelector('[data-wp-pinline]').textContent), c.querySelector('[data-wp-pinline]').textContent);
    ok('pin: still nothing built', !sim.worldPreview.built());
    ok('pin: Take off goes to it', await takeOff(sim));
    const p = sim.worldPreview.pin();
    ok('pin: flying at the pin', Math.hypot(sim.aircraft.pos.x - p.x, sim.aircraft.pos.z - p.z) < 1 && !sim.aircraft.onGround, `${Math.round(sim.aircraft.pos.x)}, ${Math.round(sim.aircraft.pos.z)}`);
    sim.quitToMenu('main');
    // A pin in the Farlands, and the tab closed in the flight.
    sim.worldPreview.setPin({ x: 204000, z: 10000 });
    sim.menus.chosenAircraft = 'skylark';
    await sim.worldPreview.flyToPin();
    for (let i = 0; i < 60; i++) sim.step(1 / 60);
    const was = { x: sim.aircraft.pos.x, y: sim.aircraft.pos.y, z: sim.aircraft.pos.z };
    ok('reload in flight: the flight is at the pin', Math.hypot(was.x - 204000, was.z - 10000) < 20000 && sim.state === 'flying', `${Math.round(was.x)}, ${Math.round(was.z)}`);
    sim.saveCheckpoint();
    ({ w, sim } = await reload(f));
    watch();
    c = sim.menus.screens.maps.querySelector('[data-world-preview-card]');
    ok('reload in flight: the card names the zone with nothing of the ring fetched', /The Farlands/.test(c.querySelector('[data-wp-pinline]').textContent) && fetched(/farlands/) === 0, c.querySelector('[data-wp-pinline]').textContent);
    await sim.resumeCheckpoint();
    T = await load(w, 'src/world/terrain.js');
    ok('reload in flight: Resume puts it back, on the World Map', sim.state === 'flying' && T.MAP.id === 'world-preview' && Math.hypot(sim.aircraft.pos.x - was.x, sim.aircraft.pos.z - was.z) < 5, `${T.MAP.id}, ${sim.state}, ${Math.round(sim.aircraft.pos.x)}`);
    sim.clearCheckpoint();
    sim.quitToMenu('main');
    ({ w, sim } = await reload(f));
    watch();
    sim.worldPreview.setPin(null);
    ({ w, sim } = await reload(f));
    watch();
    ok('pin: Remove pin is remembered too', sim.worldPreview.pin() === null);
    editSave((s) => { s.worldPin = { x: 'here', z: null }; });
    ({ w, sim } = await reload(f));
    watch();
    ok('pin: a pin that is not numbers is no pin', sim.worldPreview.pin() === null);
    sim.menus.hooks.chooseMap('kestrel');
    await wait(400);
    ({ w, sim } = await reload(f));
    watch();
    T = await load(w, 'src/world/terrain.js');
    ok('world: choosing another map ends it', T.MAP.id === 'kestrel' && !sim.waitingMap);

    // A player's save from before this version: settings.map names the World Map, no memory beside it.
    editSave((s) => { s.map = 'world-preview'; delete s.gameMap; });
    ({ w, sim } = await reload(f));
    watch();
    T = await load(w, 'src/world/terrain.js');
    ok('old save: the World Map is remembered and not built', T.MAP.id === 'kestrel' && sim.waitingMap === 'world-preview' && !sim.worldPreview.built());

    /* ---- broken saves ---- */
    localStorage.setItem(SETTINGS, '{not json');
    ({ w, sim } = await reload(f));
    watch();
    T = await load(w, 'src/world/terrain.js');
    ok('broken: a save that is not JSON boots the defaults', T.MAP.id === 'kestrel' && sim.menus.chosenAircraft === 'skylark');
    ok('nothing threw', errors.length === 0, errors.slice(0, 3).join(' / '));
  } finally {
    f.remove();
    for (let i = localStorage.length - 1; i >= 0; i--) localStorage.removeItem(localStorage.key(i));
    for (const [k, v] of Object.entries(snapshot)) localStorage.setItem(k, v);
  }
}
