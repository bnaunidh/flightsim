/**
 * Browser checks for world scale (the owner, 2026-10-04: "sizing for
 * everything is werid, houses are like 200 ft tall according to the game").
 *
 * On whatever map is loaded, in Free Flight:
 *   - the town records what it built; the median house ridge is a two-storey
 *     house's (6.5-9.5 m; it was 11.9 at v57)
 *   - put level with the ridge of the house nearest the middle of town, 40 m
 *     to its side, the panel's altitude line says the height over the
 *     ground in feet ("… ft up"), and that number is the aeroplane's AGL as
 *     hud.js rounds it — about the ridge, not the altimeter's hundreds
 *   - what is drawn over that house (walls + roof vertices) stops at its
 *     recorded ridge, or a chimney above it, and its collision box is the
 *     ridge + 0.5 m: mesh, record and box from one source
 *   - a roof pad's platform sits 2.6 m over its own building's solid top
 *     (pads.js builds both from `above`): a pad moves with its building
 *   - in the car and the airport tug, on the touch band and in a narrow
 *     window, the strip shows no height over the ground under TRIP
 *     (driveChecks)
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail). The aeroplane is put
 * back on the runway afterwards.
 */

async function load(path) {
  try {
    return await import(path);
  } catch (e) {
    return { __error: String((e && e.message) || e) };
  }
}

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

const rect = (e) => (e ? e.getBoundingClientRect() : null);
const fmtBox = (b) => (b ? `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}` : 'none');
const shown = (e) => !!e && getComputedStyle(e).display !== 'none' && rect(e).width > 0 && rect(e).height > 0;
const overlap = (a, b) => a && b && a.width > 0 && b.width > 0 ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0;

/*
 * What the altitude cell of an instrument strip says and where it sits, for
 * the band checks below. `root` holds a `.hud` (live or a copy); `ui` holds
 * the `.minimap` beside it.
 */
function readStrip(hud, ui, want) {
  const strip = hud.querySelector('.hud-left');
  const up = strip && strip.querySelector('.hud-up');
  const row = up && up.closest('.hud-row');
  const faults = [];
  if (!strip || !up || !row) return { faults: ['no strip / .hud-up / row'], detail: 'no strip' };
  const text = up.textContent;
  const mm = /^([\d,]+) ft up$/.exec(text);
  if (!shown(up)) faults.push(`"${text}" is not on screen (display ${getComputedStyle(up).display}, ${fmtBox(rect(up))})`);
  else if (!mm) faults.push(`says "${text}", not "N ft up"`);
  else if (Number(mm[1].replace(/,/g, '')) !== want) faults.push(`says "${text}", the panel's number is ${want}`);
  const word = row.querySelector('.hud-word');
  if (shown(word)) faults.push(`the sentence is on screen too ("${word.textContent}", ${fmtBox(rect(word))})`);
  const sb = rect(strip);
  const rb = rect(row);
  const ub = rect(up);
  if (ub.left < rb.left - 0.5 || ub.right > rb.right + 0.5 || ub.bottom > rb.bottom + 0.5) faults.push(`"${text}" at ${fmtBox(ub)} spills out of its cell ${fmtBox(rb)}`);
  // (The phone's 2x2 clips a long vertical speed's unit on purpose — main.css,
  // "rather than run into HEADING" — so only the line added here is held to
  // fitting its cell; every cell is held to staying inside the strip.)
  if (up.scrollWidth > row.clientWidth + 1) faults.push(`"${text}" needs ${up.scrollWidth} px in a ${row.clientWidth} px cell`);
  for (const q of strip.querySelectorAll('.hud-row')) {
    const qb = rect(q);
    if (qb.right > sb.right + 0.5 || qb.bottom > sb.bottom + 0.5) faults.push(`${q.querySelector('.hud-label').textContent} ${fmtBox(qb)} runs out of the strip ${fmtBox(sb)}`);
  }
  const top = hud.querySelector(':scope > .hud-top');
  const tb = rect(top);
  if (hud.classList.contains('is-touch') && tb && sb.bottom > tb.top + 0.5) faults.push(`the band ends at ${Math.round(sb.bottom)} and the objective starts at ${Math.round(tb.top)}`);
  const map = ui && ui.querySelector(':scope > .minimap');
  if (map && shown(map) && overlap(sb, rect(map)) > 0) faults.push(`the strip ${fmtBox(sb)} is on the minimap ${fmtBox(rect(map))}`);
  const tray = hud.querySelector('.hud-buttons');
  if (hud.classList.contains('is-touch') && tray && shown(tray) && overlap(sb, rect(tray)) > 0) faults.push(`the strip ${fmtBox(sb)} is under the buttons ${fmtBox(rect(tray))}`);
  return { faults, detail: `"${text}" ${fmtBox(ub)} in cell ${fmtBox(rb)}; strip ${fmtBox(sb)}; objective at ${tb ? Math.round(tb.top) : '-'}` };
}

/*
 * The strip under the game's own stylesheet at another width: an iframe of
 * that width holding a copy of the live strip, the objective slot, the
 * button tray and a minimap. Media queries read the iframe's own viewport,
 * so this is the phone's 2x2 and the narrow window's two columns as Chrome
 * really lays them out, without resizing anything. `read(hud, ui)` says
 * what to make of it (readStrip, readDriveStrip); `classes` go on the copy's
 * .hud beside is-touch (the vehicle's, while driving).
 */
async function stripAt(sim, width, touch, read, classes = []) {
  const f = document.createElement('iframe');
  f.setAttribute('width', String(width));
  f.setAttribute('height', '800');
  f.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:800px;border:0;opacity:0;pointer-events:none;z-index:-1`;
  document.body.appendChild(f);
  try {
    const d = f.contentDocument;
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => `<link rel="stylesheet" href="${l.href}">`).join('');
    d.open();
    const cls = ['hud', ...(touch ? ['is-touch'] : []), ...classes].join(' ');
    d.write(`<!doctype html><html${touch ? ' class="is-touch-device"' : ''}><head><meta charset="utf-8">${links}</head><body><div id="ui"><div class="${cls}"></div><div class="minimap"></div></div></body></html>`);
    d.close();
    const ui = d.getElementById('ui');
    const hud = ui.querySelector('.hud');
    for (const sel of ['.hud-left', '.hud-top', '.hud-buttons']) {
      const src = sim.hud.wrap.querySelector(`:scope > ${sel}`);
      if (src) hud.appendChild(src.cloneNode(true));
    }
    // Until the stylesheet has arrived: the strip is a positioned panel.
    for (let i = 0; i < 300 && d.defaultView.getComputedStyle(hud.querySelector('.hud-left')).position !== 'absolute'; i++) await wait(10);
    const applied = d.defaultView.getComputedStyle(hud.querySelector('.hud-left')).position === 'absolute';
    return { applied, width: d.documentElement.clientWidth, ...read(hud, ui) };
  } finally {
    f.remove();
  }
}

/*
 * The touch band (iPads, phones, touchscreen Chromebooks) and a window of
 * 760 px or narrower hide .hud-word, the sentence the height over the ground
 * was written in — so on those the owner's "200 ft house" was unchanged
 * (the v62 checker: a 696 px window, "just off the ground · 20 ft up" in the
 * DOM, display none, 0x0). Now .hud-up carries "20 ft up" there. With the
 * aeroplane still level with the roof:
 *   - this page in the touch layout for a moment (the classes main.js sets):
 *     "N ft up" on screen with the panel's number, inside its cell, the band
 *     above the objective and clear of the map and the buttons;
 *   - the stylesheet at 1024 (an iPad), 760 and 390 px (a phone: the 2x2)
 *     in the touch layout, and at 696 px as a narrow window — the same,
 *     plus no cell wider than its column.
 */
async function bandChecks(sim, r, HUD, ro, h) {
  const want = HUD.aboveGroundFt(Math.max(0, Math.min(ro.aglFt, ro.altFt)));
  const wrap = sim.hud.wrap;
  const html = document.documentElement;
  const had = [wrap.classList.contains('is-touch'), html.classList.contains('is-touch-device')];
  try {
    wrap.classList.add('is-touch');
    html.classList.add('is-touch-device');
    await wait(30);
    const live = readStrip(wrap, document.getElementById('ui'), want);
    r.ok('world-scale: in the touch band, beside the roof, the altitude cell says the height over the ground ("N ft up"), inside its cell, above the objective, clear of the map and the buttons', live.faults.length === 0, live.faults.join('; ') || `${live.detail} (${innerWidth}x${innerHeight}, ridge ${(h.ridge * 3.28084).toFixed(0)} ft)`);
  } finally {
    if (!had[0]) wrap.classList.remove('is-touch');
    if (!had[1]) html.classList.remove('is-touch-device');
  }
  const layouts = [[1024, true, 'an iPad'], [760, true, 'a small tablet'], [390, true, 'a phone (the 2x2)'], [696, false, 'a narrow window']];
  for (const [w, touch, what] of layouts) {
    let got;
    try {
      got = await stripAt(sim, w, touch, (hud, ui) => readStrip(hud, ui, Number(/([\d,]+) ft up/.exec(sim.hud.altUp.textContent)[1].replace(/,/g, ''))));
    } catch (e) {
      got = { applied: false, faults: [`threw: ${e && e.message}`], detail: '' };
    }
    r.ok(`world-scale: at ${w} px, ${what}, the strip says "N ft up" where the sentence is hidden, and no cell spills`, got.applied && got.faults.length === 0, got.applied ? (got.faults.join('; ') || got.detail) : `stylesheet did not apply in the frame (${got.faults.join('; ')})`);
  }
}

/*
 * A vehicle's strip: no height over the ground in it. .hud-up must be empty
 * AND off screen (the drive HUD empties it; the stylesheet hides it in a
 * vehicle — either alone would do, and both are held to), and in the touch
 * layout the band still ends above the objective.
 */
function readDriveStrip(hud, what) {
  const strip = hud.querySelector('.hud-left');
  const up = strip && strip.querySelector('.hud-up');
  const faults = [];
  if (!strip || !up) return { faults: [`${what}: no strip / .hud-up`], detail: 'no strip' };
  const text = up.textContent;
  if (text !== '') faults.push(`${what}: .hud-up says "${text}" under ${((up.closest('.hud-row') || strip).querySelector('.hud-label') || {}).textContent || '?'}`);
  if (shown(up)) faults.push(`${what}: .hud-up is on screen (display ${getComputedStyle(up).display}, ${fmtBox(rect(up))})`);
  const sb = rect(strip);
  const top = hud.querySelector(':scope > .hud-top');
  const tb = rect(top);
  if (hud.classList.contains('is-touch') && tb && sb.bottom > tb.top + 0.5) faults.push(`${what}: the band ends at ${Math.round(sb.bottom)} and the objective starts at ${Math.round(tb.top)}`);
  return { faults, detail: `.hud-up "${text}" (display ${getComputedStyle(up).display}); strip ${fmtBox(sb)}; objective at ${tb ? Math.round(tb.top) : '-'}` };
}

// The classes main.js and the drive HUD put on .hud while driving, for the copy of the strip.
const VEHICLE_CLASSES = ['is-vehicle', 'is-drive', 'is-drive-car', 'is-drive-boat', 'is-boat'];

/*
 * No height over the ground in the car or the tug.
 *
 * The v62 checker, a regression from e71df09: the touch band and the
 * narrow-window block show .hud-up, and nothing in the drive HUD
 * (ui/hud-drive.js) emptied or hid it — so on an iPad, a phone or a window
 * 760 px or narrower the car after a flight read TRIP 0.0 km with "1,200 ft
 * up" under it, and the tug "on the ground" (the HUD's first text): a third
 * line the cell has no room for, which grew the band from 60 to 71 px and
 * left it 3 px short of the objective. Kilometres travelled are not up
 * anything. Now DriveHud.enter() empties the line and both blocks hide it
 * in any vehicle (.is-vehicle). With a flight's "N ft up" freshly written,
 * in the car on a free drive and, where the ramp crew's plug-in has
 * registered it, the airport tug:
 *   - the live strip in the touch layout: .hud-up empty and off screen, the
 *     band above the objective;
 *   - the stylesheet at 1024 px (an iPad) and 696 px (a narrow window), in
 *     an iframe holding a copy of the strip with the vehicle's classes: the
 *     same.
 * Then back to free flight; the game the menu was on is put back (startDrive
 * sets it to the vehicle's).
 */
async function driveChecks(sim, r, say) {
  if (typeof sim.startDrive !== 'function') {
    r.ok('world-scale: in the car, on a touch layout and in a narrow window, the strip shows no height over the ground under TRIP', false, 'sim.startDrive is not a function');
    return;
  }
  const wasGame = sim.game;
  const before = sim.hud.altUp.textContent;
  const rides = [['car', 'the car (a free drive)', () => sim.startDrive('car', {})]];
  const SURF = await load('../../src/vehicles/surface.js');
  if (SURF.VEHICLES && SURF.VEHICLES.tug) {
    rides.push(['tug', 'the airport tug', () => {
      // As staff.js starts it: on this map, not "the tug's own map".
      if (sim.gameMap && sim.settings) sim.gameMap.tug = sim.settings.map;
      sim.startDrive('tug');
    }]);
  }
  try {
    for (const [kind, what, start] of rides) {
      say(`world-scale: no height line in ${what}`);
      start();
      sim.step(0.3);
      const v = sim.vehicle;
      const id = v && v.spec ? v.spec.id || v.spec.name || v.spec.kind : 'none';
      const faults = [];
      let detail = '';
      if (sim.mode !== 'drive' || !v) faults.push(`not driving ${kind} (mode ${sim.mode}, vehicle ${id})`);
      const wrap = sim.hud.wrap;
      const html = document.documentElement;
      const had = [wrap.classList.contains('is-touch'), html.classList.contains('is-touch-device')];
      try {
        wrap.classList.add('is-touch');
        html.classList.add('is-touch-device');
        await wait(30);
        const live = readDriveStrip(wrap, 'the touch band');
        faults.push(...live.faults);
        detail = live.detail;
      } finally {
        if (!had[0]) wrap.classList.remove('is-touch');
        if (!had[1]) html.classList.remove('is-touch-device');
      }
      const classes = VEHICLE_CLASSES.filter((c) => wrap.classList.contains(c));
      for (const [w, touch, where] of [[1024, true, 'an iPad'], [696, false, 'a narrow window']]) {
        let got;
        try {
          got = await stripAt(sim, w, touch, (hud) => readDriveStrip(hud, `at ${w} px, ${where}`), classes);
        } catch (e) {
          got = { applied: false, faults: [`at ${w} px: threw ${e && e.message}`] };
        }
        if (!got.applied) faults.push(`at ${w} px the stylesheet did not apply in the frame (${got.faults.join('; ')})`);
        else faults.push(...got.faults);
      }
      r.ok(`world-scale: in ${what}, on a touch layout and in a narrow window, the strip shows no height over the ground under TRIP (no "ft up" / "on the ground")`,
        faults.length === 0, faults.join('; ') || `${id} (.hud ${classes.join(' ')}); before the drive the line said "${before}"; ${detail}`);
    }
  } catch (e) {
    r.ok('world-scale: the drive checks ran to the end', false, (e && e.stack) || String(e));
  } finally {
    // Back to the aeroplane (startMode stops the drive, and the ramp crew's
    // plug-in ends its shift on it), on the game the menu was showing.
    await sim.startMode('free');
    for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
    sim.game = wasGame;
    try {
      if (sim.menus && sim.menus.setGame) sim.menus.setGame(wasGame);
    } catch (e) {
      /* the menu repaints itself */
    }
  }
}

export async function check(sim, r, say = () => {}) {
  say('world-scale: a house beside the aeroplane, and the altitude line');
  const THREE = await load('../../src/vendor/three.module.js');
  const T = await load('../../src/world/terrain.js');
  const HUD = await load('../../src/ui/hud.js');
  const MIS = await load('../../src/game/missions.js');
  for (const [k, m] of Object.entries({ THREE, T, HUD, MIS })) {
    if (m.__error) {
      r.ok(`world-scale: ${k} loads`, false, m.__error);
      return;
    }
  }
  if (sim.state !== 'flying' || sim.mode !== 'free') {
    await sim.startMode('free');
    for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
  }
  sim.scene.updateMatrixWorld(true);

  const f = sim.scenery && sim.scenery.town && sim.scenery.town.facts;
  const houses = f && f.sizes ? f.sizes.filter((z) => z.kind === 'house') : [];
  r.ok('world-scale: the town records what it built (eaves, ridge, footprint and box per house)', houses.length > 0, `${houses.length} houses on ${T.MAP.id}`);
  if (!houses.length) return;

  const ridges = houses.map((z) => z.ridge).sort((a, b) => a - b);
  const med = ridges[ridges.length >> 1];
  r.ok('world-scale: the median house ridge is a two-storey house\'s, 6.5-9.5 m (11.9 at v57)', med >= 6.5 && med <= 9.5, `${med.toFixed(1)} m over ${houses.length} houses`);
  const boxOk = houses.every((z) => Math.abs(z.top - z.ridge - 0.32) < 0.02);
  r.ok('world-scale: every house is solid to its drawn ridge and half a metre more (one source)', boxOk, boxOk ? 'all' : houses.filter((z) => Math.abs(z.top - z.ridge - 0.32) >= 0.02).slice(0, 3).map((z) => `${z.top.toFixed(2)} over ${z.ridge.toFixed(2)}`).join('; '));

  // The house nearest the middle of town.
  const cx = houses.reduce((s, z) => s + z.x, 0) / houses.length;
  const cz = houses.reduce((s, z) => s + z.z, 0) / houses.length;
  const h = houses.slice().sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))[0];

  // What is drawn over it: the top of every town wall/roof vertex inside its footprint (+0.6 m).
  {
    const v = new THREE.Vector3();
    const c = Math.cos(h.rot);
    const s = Math.sin(h.rot);
    let top = -Infinity;
    sim.scenery.group.traverse((o) => {
      if (!o.isMesh || !/^town-(house-walls|roofs)/.test(o.name)) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const dx = v.x - h.x;
        const dz = v.z - h.z;
        if (Math.abs(dx) > 14 || Math.abs(dz) > 14) continue;
        if (Math.abs(c * dx - s * dz) <= h.w / 2 + 0.6 && Math.abs(s * dx + c * dz) <= h.d / 2 + 0.6) top = Math.max(top, v.y);
      }
    });
    const drawn = top - h.ground;
    r.ok('world-scale: what is drawn over the house stops at its recorded ridge (or its chimney, 1.5 m above)', drawn >= h.ridge - 0.05 && drawn <= h.ridge + 1.6, `drawn to ${drawn.toFixed(2)} m, ridge ${h.ridge.toFixed(2)} m, eaves ${h.eaves.toFixed(2)} m`);
  }

  // Level with its ridge, 40 m to the side, flying along: the panel's line.
  const was = { pos: sim.aircraft.pos.clone(), hdg: sim.aircraft.readouts().headingDeg };
  sim.aircraft.reset({ pos: new THREE.Vector3(h.x + 40, 0, h.z + 25), headingDeg: 300, speed: 35, altAGL: h.ridge, engineOn: true });
  sim.step(0.1);
  const ro = sim.aircraft.readouts();
  const word = sim.hud && sim.hud.altWord ? sim.hud.altWord.textContent : '';
  const big = sim.hud && sim.hud.altValue ? sim.hud.altValue.textContent : '';
  const m = /([\d,]+) ft up/.exec(word);
  r.ok('world-scale: beside a roof the altitude line says the height over the ground in feet ("… ft up")', !!m, `panel: ${big} | ${word}`);
  if (m) {
    const ft = Number(m[1].replace(/,/g, ''));
    const want = HUD.aboveGroundFt(Math.max(0, Math.min(ro.aglFt, ro.altFt)));
    const ridgeFt = h.ridge * 3.28084;
    r.ok('world-scale: … and that number is the AGL as the panel rounds it, about the ridge (not the altimeter\'s hundreds)',
      ft === want && Math.abs(ft - ridgeFt) <= 15 && Number(big.replace(/,/g, '')) >= ft,
      `${ft} ft up; agl ${ro.aglFt.toFixed(0)} ft, ridge ${ridgeFt.toFixed(0)} ft, altimeter ${big} ft (town ${h.ground.toFixed(0)} m over the sea)`);
  }

  // The touch band and a narrow window, which hide the sentence: the height is on screen there too.
  if (m) await bandChecks(sim, r, HUD, ro, h);

  // A roof pad on this map: its platform 2.6 m over its own building's solid top.
  const pads = ((T.MAP.scenery && T.MAP.scenery.pads) || []).filter((p) => p.kind === 'roof');
  if (pads.length) {
    const bad = [];
    for (const p of pads) {
      const tops = T.OBSTACLES.filter((o) => o.what === `You flew into ${p.name}`).map((o) => o.y1);
      const pl = T.PLATFORMS.find((q) => q.name === p.name);
      if (!tops.length || !pl) bad.push(`${p.name}: ${tops.length ? '' : 'no building'} ${pl ? '' : 'no platform'}`);
      else if (Math.abs(pl.y - Math.max(...tops) - 2.6) > 0.05) bad.push(`${p.name}: platform ${(pl.y - Math.max(...tops)).toFixed(2)} m over its building`);
    }
    r.ok('world-scale: every roof pad\'s platform sits 2.6 m over its own building\'s solid top (one source, so a pad moves with its building)', bad.length === 0, bad.join('; ') || pads.map((p) => `${p.name} ${p.above ?? 30} m up`).join(', '));
  }

  // The car and the tug: no height over the ground under TRIP, on the layouts that show the line.
  await driveChecks(sim, r, say);

  // Back on the runway, as the other checks expect.
  if (MIS.RUNWAY_START) sim.aircraft.reset({ ...MIS.RUNWAY_START, engineOn: true });
  else sim.aircraft.reset({ pos: was.pos, headingDeg: was.hdg, engineOn: true });
  sim.step(0.05);
}
