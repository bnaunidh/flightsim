/**
 * World Map — the pin, in the game.
 *
 *   node .claude/devtools/briefs/one-check.mjs <url> ./tests/features/wm-pin.browser.js check "" 1
 *
 * `check(sim, r)`:
 *   - THE CARD: a control beside the fields, at least 44 px; it opens the map
 *   - THE MAP: a click drops the pin and another moves it; the arrow keys do
 *     too; the readout gives the nearest field, the distance, land or sea;
 *     every button is 44 px; Esc goes back and the pin stays; the worker is
 *     its own and the chart draws
 *   - THE START, aeroplane and helicopter: pins at sea, on land, on the
 *     highest ground and at the sea's edge start in the air, gear up, over
 *     the ground, nose on the goal, the ground under them drawn; 10 s
 *     hands-off nothing crashes
 *   - A FIELD: a pin by a field is that field's normal start
 *   - THE OBJECTIVE names the goal; the destination is set
 *   - RESTART comes back to the same pin; QUIT leaves it on the card; a
 *     flight with no pin is on the runway, with no goal left over
 *   - THE RING: the map shows the range and the Farlands in the chart's own
 *     colours and names them, the readout names the zone, a tap in the void
 *     comes back to land. From pins at every corner and deep in, a weak type,
 *     a helicopter and big jets: in the air under what they can hold, the
 *     ground drawn, a pin that moved says so, 10 s hands-off nothing hit,
 *     still flying speed, Restart the same start. The ring's files are not
 *     fetched before the map is opened or the World Map chosen.
 *   - TRIED TO BREAK: Fly here twice, a pin with no field picked, a field
 *     picked after a pin, Low quality, the quality changed after the pin
 *     and in flight, the loading screen, a quit during it
 * The quality, the map and the screen are put back afterwards.
 */
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const SEA = { x: 40000, z: -40000 };

function card(sim) {
  sim.menus.show('maps');
  return sim.menus.screens.maps.querySelector('[data-world-preview-card]');
}

async function openMap(sim, c) {
  c.querySelector('[data-wp-pinopen]').click();
  for (let i = 0; i < 200 && !sim.worldPreview.pinMap(); i++) await wait(25);
  return sim.worldPreview.pinMap();
}

/** Click the pin map at a world point. The test page's frames are frozen, so the sum is the map's own. */
function clickAt(map, x, z) {
  const cv = map.el.querySelector('canvas');
  const r = cv.getBoundingClientRect();
  const v = map.view;
  cv.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + v.W / 2 + (x - v.cx) * v.s, clientY: r.top + v.H / 2 + (z - v.cz) * v.s }));
}

async function flyPin(sim, pin, aircraft = 'skylark') {
  sim.menus.chosenAircraft = aircraft;
  sim.worldPreview.setPin(pin);
  await sim.worldPreview.flyToPin();
}

export async function check(sim, r) {
  const ok = (n, p, d = '') => r.ok(n, p, `${n}${d ? ` -- ${d}` : ''}`);
  const wp = sim.worldPreview;
  const T = await import('../../src/world/terrain.js');
  const Pin = await import('../../src/world/worldmap/pin.js');
  const P = await import('../../src/world/worldmap/preview.js');
  const quality0 = sim.settings.quality;
  const map0 = sim.settings.map;
  const load0 = sim.loading && sim.loading.enabled;

  /* ---- the card and the map ---- */
  const c = card(sim);
  const opener = c.querySelector('[data-wp-pinopen]');
  ok('card: the control is there, beside the fields', !!opener && !!c.querySelector('[data-wp-pick]'));
  ok('card: the five fields\' picker is unchanged', c.querySelectorAll('[data-wp-pick]').length === P.AIRPORTS.length, `${c.querySelectorAll('[data-wp-pick]').length}`);
  ok('card: the control is 44 px', opener.getBoundingClientRect().height >= 44, `${opener.getBoundingClientRect().height}`);
  const map = await openMap(sim, c);
  ok('map: opens', !!map && !!document.querySelector('[data-wp-pinmap]'));
  const big = [...map.el.querySelectorAll('button:not([hidden])')].every((b) => b.getBoundingClientRect().height >= 44 && b.getBoundingClientRect().width >= 44);
  ok('map: every button is 44 px', big);
  ok('map: Fly here waits for a pin', map.el.querySelector('[data-wpp-fly]').disabled);
  clickAt(map, SEA.x, SEA.z);
  const p1 = wp.pin();
  // Within a pixel or so: the map is the whole world now, and a mouse event lands on a whole pixel.
  const px1 = 2 / map.view.s;
  ok('map: a click drops the pin where it was clicked', !!p1 && Math.hypot(p1.x - SEA.x, p1.z - SEA.z) < px1, p1 && `${Math.round(p1.x)}, ${Math.round(p1.z)}`);
  clickAt(map, -30000, 30000);
  const p2 = wp.pin();
  ok('map: another click moves it', Math.hypot(p2.x + 30000, p2.z - 30000) < px1);
  ok('map: only one pin', map.el.querySelector('[data-wpp-clear]') && !map.el.querySelector('[data-wpp-clear]').hidden);
  const cv = map.el.querySelector('canvas');
  cv.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  ok('map: an arrow key moves it 1 km', Math.abs(wp.pin().x - p2.x - 1000) < 1);
  cv.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }));
  ok('map: Shift moves it further', Math.abs(wp.pin().z - p2.z - 8000) < 1);
  clickAt(map, SEA.x, SEA.z);
  for (let i = 0; i < 240 && wp.pin().h == null; i++) await wait(25);
  const said = map.el.querySelector('[data-wpp-title]').textContent + ' / ' + map.el.querySelector('[data-wpp-where]').textContent;
  ok('map: the readout gives the field, the distance and land or sea', /km from X[A-Z]{3}/.test(said) && /sea/i.test(said), said);
  for (let i = 0; i < 4; i++) { map.frame(performance.now() + i * 500); await wait(150); }
  ok('map: the chart comes from the worker', map.chart.stats.worker >= 1 || map.chart.inflight.size > 0, JSON.stringify(map.chart.stats));
  map.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('map: Esc goes back', !document.querySelector('[data-wp-pinmap]') && !wp.pinMap());
  ok('map: focus comes back to the card', document.activeElement === opener);
  const line = c.querySelector('[data-wp-pinline]');
  ok('card: the pin stays, and says where it is', !!wp.pin() && !line.hidden && /X[A-Z]{3}/.test(line.textContent), line.textContent);
  ok('card: no field is picked while a pin is down', !c.querySelector('[data-wp-pick][aria-checked="true"]'));
  c.querySelector('[data-wp-pick]').click();
  ok('card: picking a field takes the pin up', wp.pin() === null && !!c.querySelector('[data-wp-pick][aria-checked="true"]') && line.hidden);

  /* ---- the start ---- */
  let peak = { h: -1e9, x: 0, z: 0 };
  const box = P.seaBox();
  await flyPin(sim, SEA);
  for (let x = box.x0; x <= box.x1; x += 800) for (let z = box.z0; z <= box.z1; z += 800) {
    const h = T.heightAt(x, z);
    if (h > peak.h) peak = { h, x, z };
  }
  const isl = P.PREVIEW.islands[0];
  const spots = { sea: SEA, land: { x: isl.cx + 2600, z: isl.cz + 2600 }, 'highest ground': peak, 'sea\'s edge': Pin.clampPin(1e7, 1e7) };
  for (const [name, spot] of Object.entries(spots)) {
    for (const [who, id] of [['aeroplane', 'skylark'], ['helicopter', 'r44']]) {
      await flyPin(sim, spot, id);
      const ac = sim.aircraft;
      const pin = wp.pin();
      const g = T.heightAt(ac.pos.x, ac.pos.z);
      ok(`${name}, ${who}: flying, at the pin`, sim.state === 'flying' && Math.hypot(ac.pos.x - pin.x, ac.pos.z - pin.z) < 1, `${Math.round(ac.pos.x)}, ${Math.round(ac.pos.y)}, ${Math.round(ac.pos.z)}`);
      ok(`${name}, ${who}: in the air, over the ground and the sea`, !ac.onGround && ac.pos.y > Math.max(0, g) + 100, `${Math.round(ac.pos.y)} over ${Math.round(g)}`);
      ok(`${name}, ${who}: gear up`, ac.gearDown === false);
      ok(`${name}, ${who}: the ground under it is drawn`, wp.groundDrawn(ac.pos.x, ac.pos.z), JSON.stringify({ primed: wp.stats().primed, ms: Math.round(wp.stats().primeMs) }));
      const d = wp.destination();
      const off = d ? Math.abs(((ac.heading - P.headingTo(ac.pos.x, ac.pos.z, d.x, d.z) + 540) % 360) - 180) : 999;
      ok(`${name}, ${who}: nose on the goal`, off < 2, d && d.code);
      for (let i = 0; i < 300; i++) sim.step(1 / 60);
      ok(`${name}, ${who}: 5 s hands-off, still flying`, sim.state === 'flying' && !ac.crashed && ac.pos.y > Math.max(0, T.heightAt(ac.pos.x, ac.pos.z)));
      sim.quitToMenu();
    }
  }

  /* ---- the objective, restart, quit ---- */
  await flyPin(sim, SEA);
  const dest = wp.destination();
  const objective = [...document.querySelectorAll('[class*=objective]')].map((e) => e.textContent).join(' ');
  ok('objective: names the goal', !!dest && objective.includes(`DIRECT TO ${dest.code}`), objective.trim().slice(0, 90));
  for (let i = 0; i < 120; i++) sim.step(1 / 60);
  await sim.startMode(sim.mode, sim.modeOpts);
  ok('restart: back at the same pin', Math.hypot(sim.aircraft.pos.x - wp.pin().x, sim.aircraft.pos.z - wp.pin().z) < 1 && !sim.aircraft.onGround);
  ok('restart: the goal again', wp.destination() === dest);
  const debriefSays = () => {
    sim.menus.showDebrief({ title: 'x', kind: 'bad', body: '', actions: [{ label: 'Reset on the runway', onClick() {} }] });
    const t = sim.menus.screens.debrief.querySelector('[data-actions]').textContent;
    sim.menus.screens.debrief.hidden = true;
    return t;
  };
  ok('restart: the debrief\'s button says so', debriefSays() === 'Back to your pin', debriefSays());
  // A checkpoint resumed in the air: the pose wins, and Restart still knows the pin.
  const CP = await import('../../src/game/checkpoint.js');
  for (let i = 0; i < 300; i++) sim.step(1 / 60);
  const cp = CP.captureCheckpoint(sim);
  ok('checkpoint: a pin\'s flight keeps its pin', !!(cp && cp.opts && cp.opts.pin), cp ? JSON.stringify(cp.opts.pin) : 'no checkpoint');
  sim.clearCheckpoint();
  sim.quitToMenu();
  ok('quit: the pin is still on the card', !!wp.pin());
  /*
   * Take off with the pin down goes to the pin. It used to take the runway when the World Map was
   * already built, and the pin only after a reload (this check held the runway on purpose until the
   * owner's call, 2026-11-04). The screen's Free Flight setup comes along; a pin is airborne whatever it says.
   */
  const SETUP = { time: 'day', condition: 'clear', windSpeedKts: 6, windDirDeg: 80, aircraft: 'skylark', airborne: false, taxi: false, fuel: 1 };
  const pinWas = { x: wp.pin().x, z: wp.pin().z };
  ok('take off: the World Map is built', !!wp.built() && !sim.waitingMap);
  await sim.menus.hooks.startFree(SETUP);
  ok('take off: with the map built, to the pin', sim.state === 'flying' && !sim.aircraft.onGround && Math.hypot(sim.aircraft.pos.x - pinWas.x, sim.aircraft.pos.z - pinWas.z) < 1, `${Math.round(sim.aircraft.pos.x)}, ${Math.round(sim.aircraft.pos.z)}, ${sim.state}`);
  ok('take off: the flight names the pin, so Restart comes back', !!sim.modeOpts.pin && sim.modeOpts.airborne === true);
  ok('take off: the debrief says so', debriefSays() === 'Back to your pin', debriefSays());
  sim.quitToMenu();
  // A double tap is one flight.
  {
    let starts = 0;
    const startMode = sim.startMode;
    sim.startMode = function counted(...a) { starts++; return startMode.apply(this, a); };
    await Promise.all([sim.menus.hooks.startFree(SETUP), sim.menus.hooks.startFree(SETUP)]);
    sim.startMode = startMode;
    ok('take off: a double tap is one flight', starts === 1, `${starts}`);
    sim.quitToMenu();
  }
  // The screen's "Start at" has no say over a pin: a gate or a deck would have moved her off it.
  await sim.menus.hooks.startFree({ ...SETUP, startAt: 'carrier', aircraft: 'skylark' });
  ok('take off: a Start at choice does not beat the pin', Math.hypot(sim.aircraft.pos.x - pinWas.x, sim.aircraft.pos.z - pinWas.z) < 1 && !sim.modeOpts.startAt, `${Math.round(sim.aircraft.pos.x)}, ${Math.round(sim.aircraft.pos.z)} ${sim.modeOpts.startAt}`);
  sim.quitToMenu();
  // A pin by a field is that field's start, as Fly here makes it; and it must not come back round through this hook for ever.
  {
    const field = P.airportById(dest.id);
    wp.setPin({ x: field.x, z: field.z });
    await sim.menus.hooks.startFree(SETUP);
    ok('take off: a pin on a field is that field\'s start', sim.state === 'flying' && sim.aircraft.onGround && Math.hypot(sim.aircraft.pos.x - field.x, sim.aircraft.pos.z - field.z) < 2500, `${sim.state}, ${Math.round(sim.aircraft.pos.x)}, ${Math.round(sim.aircraft.pos.z)}`);
    sim.quitToMenu();
  }
  // Picking up the pin gives the runway back, on the same built map.
  wp.setPin(null);
  await sim.menus.hooks.startFree(SETUP);
  ok('no pin: a Free Flight is on the runway as ever', sim.aircraft.onGround && Math.hypot(sim.aircraft.pos.x - P.airportById(dest.id).x, sim.aircraft.pos.z - P.airportById(dest.id).z) < 2500);
  ok('no pin: no goal left over from the pin', wp.destination() === null);
  ok('no pin: the debrief is the runway\'s', debriefSays() === 'Reset on the runway');
  sim.modeOpts = { ...sim.modeOpts, pin: SEA, airborne: false };
  ok('no pin: on the ground with a pin in the options, still the runway\'s', debriefSays() === 'Reset on the runway');
  sim.quitToMenu();

  /* ---- the tower ---- */
  const heardNow = [];
  const speak = sim.speak;
  sim.speak = function heard(text, ...a) { heardNow.push(text); return speak.call(this, text, ...a); };
  await flyPin(sim, SEA, 'r44');
  await sim.startMode(sim.mode, sim.modeOpts);
  sim.speak = speak;
  ok('tower: nobody tells a flying helicopter to lift', !heardNow.some((t) => /Lift when you are ready/.test(t)), heardNow.join(' / ').slice(0, 120));
  sim.quitToMenu();
  const padSaid = [];
  sim.speak = function heard(text, ...a) { padSaid.push(text); return speak.call(this, text, ...a); };
  wp.setPin(null);
  await sim.menus.hooks.startFree({ time: 'day', condition: 'clear', windSpeedKts: 6, windDirDeg: 80, aircraft: 'r44', airborne: false, taxi: false, fuel: 1 });
  sim.speak = speak;
  ok('tower: on a pad it still does', padSaid.some((t) => /Lift when you are ready/.test(t)), padSaid.join(' / ').slice(0, 120));
  sim.quitToMenu();

  /* ---- the ring ---- */
  const Far = await import('../../src/world/worldmap/pin-far.js');
  const F = await import('../../src/world/worldmap/farlands.js');
  {
    const cc = card(sim);
    wp.setPin(null);
    const m = await openMap(sim, cc);
    ok('ring map: the chart is all of it', m.chart.box.size === F.CHART_HALF * 2, `${m.chart.box.size}`);
    const spy = m.el.querySelector('canvas').getContext('2d');
    const said2 = [];
    const ft = spy.fillText;
    spy.fillText = function t(text, ...a) { said2.push(text); return ft.call(this, text, ...a); };
    for (let i = 0; i < 30 && !m.chart.readyFor(m.view); i++) { m.frame(performance.now() + i * 400); await wait(150); }
    window.dispatchEvent(new Event('resize'));
    m.frame(performance.now() + 9000);
    await wait(100);
    m.frame(performance.now() + 9500);
    delete spy.fillText;
    ok('ring map: names the range and the Farlands', said2.includes('The Border Range') && said2.includes('The Farlands'), [...new Set(said2)].slice(-4).join(', '));
    const px = (x, z) => {
      const v = m.view;
      const d = spy.getImageData(Math.round((v.W / 2 + x * v.s) * v.dpr), Math.round((v.H / 2 + z * v.s) * v.dpr), 1, 1).data;
      return [...d].slice(0, 3);
    };
    const dark = (c) => c[0] < 14 && c[1] < 14 && c[2] < 18;
    ok('ring map: the void is the chart\'s black', dark(px(F.SEA_HALF + F.EDGE_D + 14000, 40000)), px(F.SEA_HALF + F.EDGE_D + 14000, 40000).join());
    ok('ring map: the Farlands are land on it', !dark(px(F.SEA_HALF + 90000, 10000)), px(F.SEA_HALF + 90000, 10000).join());
    ok('ring map: the range is land on it', !dark(px(F.SEA_HALF + 20000, 10000)), px(F.SEA_HALF + 20000, 10000).join());
    const where = () => m.el.querySelector('[data-wpp-where]').textContent;
    clickAt(m, F.SEA_HALF + 90000, 10000);
    ok('ring map: the readout names the Farlands', where() === 'The Farlands', where());
    clickAt(m, F.SEA_HALF + 20000, 10000);
    ok('ring map: and the range', where() === 'The Border Range', where());
    for (let i = 0; i < 240 && wp.pin().h == null; i++) await wait(25);
    ok('ring map: the worker knows the ring\'s ground', wp.pin().h > 100, `${wp.pin().h}`);
    clickAt(m, F.CHART_HALF - 2000, F.CHART_HALF - 2000);
    const back = wp.pin();
    ok('ring map: a tap in the void comes back to land', F.height(back.x, back.z) > -99 && F.wanderOf(back.x, back.z) < F.edgeAt(back.x, back.z), `${Math.round(back.x)}, ${Math.round(back.z)}`);
    ok('ring map: the pin is on the map', Math.abs(back.x) < F.CHART_HALF && !!m.el.querySelector('[data-wpp-fly]') && !m.el.querySelector('[data-wpp-fly]').disabled);
    m.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok('ring card: the card names the zone', /The Edge|The Farlands/.test(cc.querySelector('[data-wp-pinline]').textContent), cc.querySelector('[data-wp-pinline]').textContent);
    wp.setPin(null);
  }
  const ringPins = {
    'north-east corner': Far.clampFar(1e7, -1e7),
    'south-west corner': Far.clampFar(-1e7, 1e7),
    'deep in the Ribs': { x: F.SEA_HALF + 80000, z: 30000 },
    'deep in the Stacks': { x: -(F.SEA_HALF + 108000), z: -8000 },
    'the Border Range': { x: 20000, z: F.SEA_HALF + 22000 },
    'the land\'s end': Far.clampFar(1e7, 2000),
  };
  const hoist = [['Skylark', 'skylark'], ['helicopter', 'r44'], ['big helicopter', 'ch47'], ['A380', 'a380'], ['airliner', 'q400']];
  // Somewhere the Skylark has to go to a cut: found on the ground the game itself reads.
  await flyPin(sim, SEA);
  sim.quitToMenu();
  const cut = [];
  for (let x = -250000; x <= 250000 && !cut.length; x += 13000) {
    for (let z = -250000; z <= 250000 && !cut.length; z += 13000) {
      if (F.depthOf(x, z) < 8000) continue;
      const pin = Far.clampFar(x, z);
      const st = Far.farStart(T.heightAt, pin, Pin.goalFor(pin.x, pin.z), { stallMs: 25, ceilingM: 4267 });
      if (st.where === 'canyon' || st.where === 'pass') cut.push({ ...pin, kind: st.where });
    }
  }
  ok('ring: the Skylark has somewhere that sends it to a cut', cut.length > 0);
  if (cut[0]) ringPins[`a ${cut[0].kind}`] = cut[0];
  const says = [];
  const notify = sim.hud.notify;
  sim.hud.notify = function heard(text, ...a) { says.push(text); return notify.call(this, text, ...a); };
  for (const [name, pinAt] of Object.entries(ringPins)) {
    for (const [who, id] of hoist) {
      says.length = 0;
      await flyPin(sim, pinAt, id);
      const ac = sim.aircraft;
      const s = wp.lastStart();
      const tag = `${name}, ${who}`;
      ok(`${tag}: flying, gear up, in the air`, sim.state === 'flying' && !ac.onGround && ac.gearDown === false, `${Math.round(ac.pos.y)} m, moved ${Math.round(s.movedM / 1000)} km ${s.where || ''}`);
      ok(`${tag}: under what it can hold`, ac.pos.y <= s.limitM + 1);
      ok(`${tag}: the ground under it is drawn`, wp.groundDrawn(ac.pos.x, ac.pos.z));
      ok(`${tag}: a moved pin says so`, !s.where || says.some((t) => /Too high for/.test(t)), says.join(' / ').slice(0, 100));
      const y0 = ac.pos.y;
      let lowest = Infinity;
      for (let i = 0; i < 600 && !ac.crashed; i++) {
        sim.step(1 / 60);
        lowest = Math.min(lowest, ac.pos.y - T.heightAt(ac.pos.x, ac.pos.z));
      }
      ok(`${tag}: 10 s hands-off, nothing hit`, sim.state === 'flying' && !ac.crashed && lowest > 20, `${Math.round(lowest)} m clear, ${Math.round(y0)} to ${Math.round(ac.pos.y)} m`);
      const flew = { x: s.x, y: s.y, z: s.z, h: s.headingDeg };
      await sim.startMode(sim.mode, sim.modeOpts);
      const t = wp.lastStart();
      ok(`${tag}: Restart is the same start`, t.x === flew.x && t.z === flew.z && t.y === flew.y && t.headingDeg === flew.h && Math.hypot(sim.aircraft.pos.x - s.x, sim.aircraft.pos.z - s.z) < 1);
      sim.quitToMenu();
    }
  }
  sim.hud.notify = notify;

  /* ---- a field ---- */
  const hub = P.airportById('haven');
  await flyPin(sim, { x: hub.x + 200, z: hub.z + 100 });
  ok('field: a pin by a field is its normal start', sim.state === 'flying' && sim.aircraft.onGround && !(sim.modeOpts && sim.modeOpts.pin), `${Math.round(sim.aircraft.pos.x)}, ${Math.round(sim.aircraft.pos.z)}`);
  ok('field: no goal is invented', wp.destination() === null);
  sim.quitToMenu();

  /* ---- trying to break it ---- */
  let starts = 0;
  const startMode = sim.startMode;
  sim.startMode = function counted(...a) { starts++; return startMode.apply(this, a); };
  sim.menus.chosenAircraft = 'skylark';
  wp.setPin(SEA);
  const twice = [wp.flyToPin(), wp.flyToPin(), wp.flyToPin()];
  await Promise.all(twice);
  sim.startMode = startMode;
  ok('double tap: one flight', starts === 1, `${starts}`);
  sim.quitToMenu();
  // A big jet is not sent to a strip it cannot use.
  const gul = P.airportById('gull');
  await flyPin(sim, { x: gul.x + 3000, z: gul.z + 3000 }, 'a380');
  ok('a380: the goal takes it', wp.destination().length >= 2500, wp.destination().code);
  sim.quitToMenu();
  // The quality changed with a pin down, then in the flight.
  const perf0 = sim.settings.performanceMode;
  wp.setPin(spots.land);
  sim.menus.hooks.onSetting('quality', 'low');
  sim.menus.hooks.onSetting('performanceMode', true);
  await wait(300);
  await flyPin(sim, spots.land);
  ok('low + performance: starts at the pin, the ground drawn', sim.state === 'flying' && !sim.aircraft.onGround && wp.built().quality === 'low' && sim.settings.performanceMode === true && wp.groundDrawn(sim.aircraft.pos.x, sim.aircraft.pos.z), `${wp.stats().maxTiles} cap, ${wp.stats().primed} primed`);
  sim.quitToMenu();
  // The time cap: nothing loaded in time, so higher up.
  const normal = Pin.pinStart(T.heightAt, wp.pin(), wp.destination() || P.airportById('haven'), { stallMs: 25 }).y;
  const st = wp.stream();
  const prime = st.prime;
  st.prime = function nothing() { this.shown = new Set(); };
  await flyPin(sim, spots.land);
  st.prime = prime;
  ok('time cap: no ground in time starts higher, still at the pin', sim.state === 'flying' && sim.aircraft.pos.y >= normal + Pin.PIN.fallbackM - 1, `${Math.round(sim.aircraft.pos.y)} against ${Math.round(normal)}`);
  sim.quitToMenu();
  sim.menus.hooks.onSetting('performanceMode', !!perf0);
  sim.menus.hooks.onSetting('quality', quality0);
  await wait(300);
  await flyPin(sim, SEA);
  ok('quality: a pin dropped before the change still works', sim.state === 'flying' && wp.built().quality === quality0);
  sim.menus.hooks.onSetting('quality', quality0 === 'low' ? 'medium' : 'low');
  await wait(300);
  sim.menus.hooks.onSetting('quality', quality0);
  await wait(300);
  await sim.startMode(sim.mode, sim.modeOpts);
  ok('quality in flight: restart is still the pin', wp.built().quality === quality0 && Math.hypot(sim.aircraft.pos.x - wp.pin().x, sim.aircraft.pos.z - wp.pin().z) < 1);
  sim.quitToMenu();
  // Behind the real loading screen, and a quit while it is up.
  if (sim.loading) {
    sim.loading.enabled = true;
    wp.setPin(SEA);
    const going = wp.flyToPin();
    await wait(200);
    ok('loading: the screen is up before the flight', sim.loading.active && sim.state !== 'flying', `${sim.state}`);
    sim.quitToMenu();
    sim.loading.skip();
    await Promise.race([going, wait(20000)]);
    ok('loading: a quit under the screen leaves Fly here working', sim.state === 'flying' || sim.state === 'menu', sim.state);
    sim.loading.enabled = load0;
    if (sim.state === 'flying') sim.quitToMenu();
    await wait(600);
    ok('loading: the screen has gone', !sim.loading.active);
    await flyPin(sim, SEA);
    ok('loading: and it flies again after', sim.state === 'flying' && !sim.aircraft.onGround);
    sim.quitToMenu();
  }

  wp.setPin(null);
  if (sim.settings.map !== map0 && sim.menus.hooks.chooseMap) sim.menus.hooks.chooseMap(map0);
  await wait(300);
}
