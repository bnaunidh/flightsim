/**
 * Browser checks for the custom crashes, the crash marks on the minimap and
 * the wildfire as a natural disaster — the real game, the real flight
 * model, the real menus. tests/features/crashes.mjs has already run the
 * choreography, the marks and the API in node; this is what node cannot
 * see: that a crash in the game becomes the right kind, with its banner,
 * its crash cam and its mark; that the aeroplane on screen follows the
 * choreography; that the debrief says which crash it was; that a wildfire
 * can be summoned from the pause menu or armed before departure and put out
 * with water like any other; and that another player's crash or disaster,
 * handed in through happenings.js, lands here.
 *
 * Every import is dynamic, the same rule as the other feature checks.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  let cr;
  let ext;
  let hap;
  let dis;
  let wf;
  let T;
  let THREE;
  try {
    cr = await import('../../src/features/crashes.js');
    ext = await import('../../src/game/extensions.js');
    hap = await import('../../src/game/happenings.js');
    dis = await import('../../src/game/disasters.js');
    wf = await import('../../src/features/wildfire.js');
    T = await import('../../src/world/terrain.js');
    THREE = await import('../../src/vendor/three.module.js');
  } catch (err) {
    r.ok('crashes: the modules load', false, String(err && err.message));
    return;
  }
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const D = cr.crashDebug();
  const C = D.C;
  const heard = [];
  const off = hap.onHappening((e) => heard.push(e));
  /*
   * main.js brings the crash debrief up 2.2 s of REAL time after a crash.
   * These checks step the game faster or slower than that, and a debrief in
   * the middle of one stops the frame hooks, so it is cancelled after each
   * crash here and asked for by hand below.
   */
  const noDebrief = () => clearTimeout(sim._crashDebriefT);
  const free = (extra = {}) => sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, ...extra });

  /* ---- registered ---------------------------------------------------- */
  const status = ext.extStatus ? ext.extStatus() : [];
  for (const id of ['crashes', 'wildfire-disaster']) {
    const me = status.find((e) => e.id === id);
    r.ok(`crashes: the "${id}" feature is registered and live`, !!(me && me.live), JSON.stringify(me));
  }
  r.ok('crashes: Dev mode offers "Show me a crash"', (ext.extDevActions ? ext.extDevActions() : []).some((a) => a.label === 'Show me a crash'));

  /* ---- every kind, staged through the real CRASH event ----------------- */
  say('crashes: all six');
  for (const kind of ['cartwheel', 'bellyflop', 'splash', 'wingclip', 'noseplant', 'bonk']) {
    await free();
    sim.step(0.3);
    const marksBefore = C.marks.list.length;
    const heardBefore = heard.length;
    const got = cr.stageCrash(sim, kind);
    noDebrief();
    const c = C.crash;
    const title = c ? c.title : '';
    const banner = sim.hud.banner ? sim.hud.banner.textContent : '';
    r.ok(`crashes: ${kind} — a real crash of that kind`, got === kind && sim.aircraft.crashed && c && c.kind === kind, c ? `${c.kind}: ${c.reason}` : 'no crash recorded');
    r.ok(`crashes: ${kind} — the banner names it and tells the joke, over the reason`, banner.includes(title) && banner.includes(c.caption) && banner.includes(c.reason), banner.slice(0, 140));
    r.ok(`crashes: ${kind} — the crash cam takes the camera`, D.CAM.active);
    const ev = heard.slice(heardBefore).find((e) => e.type === 'crash');
    r.ok(`crashes: ${kind} — a happening goes out for multiplayer`, !!ev && ev.kind === kind && ev.map === T.MAP.id && Number.isFinite(ev.x), JSON.stringify(ev));
    r.ok(`crashes: ${kind} — a mark goes on the minimap`, C.marks.list.length >= Math.min(10, marksBefore) && C.newestMine && C.newestMine.kind === kind);
    const start = sim.aircraft.pos.clone();
    let camSeen = 0;
    let maxStep = 0;
    let prev = start.clone();
    let fleetModel = !!(sim.model && sim.model.userData && sim.model.userData.fleetBridge);
    let modelOff = 0;
    for (let i = 0; i < 26; i++) {
      sim.step(0.1);
      if (D.CAM.active) camSeen++;
      const p = sim.aircraft.pos;
      maxStep = Math.max(maxStep, p.distanceTo(prev));
      prev = p.clone();
      if (!fleetModel && C.script) modelOff = Math.max(modelOff, sim.model.position.distanceTo(C.script.pos));
    }
    const s = C.script;
    r.ok(`crashes: ${kind} — the choreography plays and finishes`, (!s && kind === 'splash' && fleetModel) || (s && s.done), s ? `t ${s.t.toFixed(2)}` : 'no script');
    r.ok(`crashes: ${kind} — the crash cam hands the camera back after about two seconds`, camSeen >= 18 && camSeen <= 23 && !D.CAM.active, `${camSeen} of 26 steps`);
    r.ok(`crashes: ${kind} — the aeroplane moves without jumping`, maxStep < 8 && [prev.x, prev.y, prev.z].every(Number.isFinite), `${maxStep.toFixed(2)} m in 0.1 s at most`);
    if (!fleetModel) r.ok(`crashes: ${kind} — the model on screen follows it`, modelOff < 1.5, `${modelOff.toFixed(2)} m`);
    if (kind === 'splash') r.ok('crashes: splash — ends afloat, not on the sea bed', prev.y > -3 && prev.y < 3, prev.y.toFixed(2));
    else r.ok(`crashes: ${kind} — ends on the ground, not in it`, prev.y > T.heightAt(prev.x, prev.z) - 1, `${(prev.y - T.heightAt(prev.x, prev.z)).toFixed(2)} m up`);
    if (kind === 'noseplant' || kind === 'bonk' || kind === 'cartwheel' || kind === 'wingclip') r.ok(`crashes: ${kind} — it sees stars`, C.fx && C.fx.starsOn);
    if (kind === 'bellyflop') r.ok('crashes: belly flop — leaves a skid mark', C.fx && C.fx.ribbonN > 4, `${C.fx && C.fx.ribbonN} points`);
    if (kind !== 'splash') r.ok(`crashes: ${kind} — a cartoon poof, not the fireball`, !sim.wreck.active && !sim.wreck.group.visible);
  }

  /* ---- a pause in the middle of the crash cam puts everything back -------- */
  {
    await free();
    sim.step(0.3);
    cr.stageCrash(sim, 'cartwheel');
    noDebrief();
    sim.step(0.4);
    const movedUp = sim.hud.banner.style.top === '15%';
    const labelOn = !!document.querySelector('.crash-cam-label') && document.querySelector('.crash-cam-label').style.display !== 'none';
    sim.pause();
    await new Promise((res) => setTimeout(res, 400));
    const label = document.querySelector('.crash-cam-label');
    r.ok('crashes: pausing in the middle of the crash cam puts the banner back and takes the label away',
      movedUp && labelOn && !D.CAM.active && (!label || label.style.display === 'none') && sim.hud.banner.style.top === '' && !document.body.classList.contains('crash-cam-on'),
      `moved up ${movedUp}, label was on ${labelOn}, cam ${D.CAM.active}, top "${sim.hud.banner.style.top}"`);
    sim.resume();
    sim.step(2.2);
  }

  /* ---- the debrief says which crash it was ------------------------------ */
  sim.showCrashDebrief(C.crash.reason);
  const dbTitle = document.querySelector('[data-screen="debrief"] [data-title]');
  const dbBody = document.querySelector('[data-screen="debrief"] [data-body]');
  r.ok('crashes: the debrief is titled with the crash, the joke over the reason', !!dbTitle && dbTitle.textContent === C.crash.title && dbBody.textContent.includes(C.crash.caption) && dbBody.textContent.includes(C.crash.reason),
    dbTitle ? `${dbTitle.textContent} / ${dbBody.textContent.slice(0, 120)}` : 'no debrief');

  /* ---- restart: everything put away, the chart clean ---------------------- */
  await sim.startMode(sim.mode || 'free', sim.modeOpts || {});
  sim.step(0.3);
  r.ok('crashes: a restart puts the crash away and gives the camera back', !C.script && !D.CAM.active && !(C.fx && C.fx.starsOn) && !sim.aircraft.crashed);
  // The owner (play-testing v52): old crash stars on the minimap after a new flight read as stale meteors — a new flight starts clean.
  r.ok('crashes: …and a new flight starts with a clean minimap (no old crash stars)', C.marks.list.length === 0, `${C.marks.list.length}`);

  /* ---- a real crash, flown into the ground -------------------------------- */
  say('crashes: a flown crash');
  await free();
  sim.step(0.3);
  {
    const ac = sim.aircraft;
    ac.reset({ pos: new THREE.Vector3(-1500, 0, 0), headingDeg: 90, speed: 60, altAGL: 120, engineOn: true });
    ac.controls.throttle = 0.8;
    sim.input.throttleTarget = 0.8;
    for (let i = 0; i < 40 && !ac.crashed; i++) {
      sim.override = { pitch: -0.55 };
      sim.step(0.3);
    }
    noDebrief();
    sim.override = null;
    r.ok('crashes: flying into the ground gives a custom crash', ac.crashed && C.crash && ['noseplant', 'bellyflop', 'cartwheel', 'splash', 'wingclip'].includes(C.crash.kind), C.crash ? `${C.crash.kind}: ${C.crash.reason}` : ac.crashReason);
    sim.step(2.5);
  }

  /* ---- the minimap draws them ------------------------------------------- */
  {
    const mm = sim.minimap;
    const m = C.newestMine;
    const ac = sim.aircraft;
    await free();
    sim.step(0.2);
    if (m && mm) {
      ac.pos.x = m.x + 400;
      ac.pos.z = m.z - 300;
      mm._acc = 1;
      mm.update(0.05, sim);
      r.ok('crashes: the minimap draws the crash marks near you', (C.lastDrawn || 0) >= 1, `${C.lastDrawn} drawn of ${C.marks.list.length}`);
    } else r.ok('crashes: there is a minimap and a mark to draw', false);
  }

  /* ---- a mayday is left alone ---------------------------------------------- */
  await free();
  sim.step(0.3);
  sim.bracing = true;
  const nBefore = C.stats.crashes;
  cr.stageCrash(sim, 'bellyflop');
  noDebrief();
  r.ok('crashes: a mayday that ends on the ground keeps its own ending (no joke, no crash cam)', C.stats.crashes === nBefore + 1 && C.crash.quiet && !C.script && !D.CAM.active);
  sim.bracing = false;
  sim.braceOwnsEnding = false;

  /* ---- somebody else's crash ---------------------------------------------- */
  await free();
  sim.step(0.3);
  const ac = sim.aircraft;
  const beforeRemote = C.stats.remote;
  const okRemote = hap.receiveHappening(sim, { type: 'crash', kind: 'cartwheel', vehicle: 'plane', x: ac.pos.x + 300, z: ac.pos.z, map: T.MAP.id }, { name: 'Brave Otter', colour: '#ff9f1c' });
  const remoteMark = C.marks.list[C.marks.list.length - 1];
  r.ok('crashes: another player\'s crash goes on the map in their colour', okRemote && C.stats.remote === beforeRemote + 1 && remoteMark && !remoteMark.mine && remoteMark.colour === '#ff9f1c');
  r.ok('crashes: …with their name in a toast', (sim.hud.toasts || []).some((t) => /Brave Otter: Cartwheel crash!/.test(t.node.textContent)));
  r.ok('crashes: junk from the network is refused', !hap.receiveHappening(sim, { type: 'crash', kind: 'kaboom', x: 0, z: 0 }) && !hap.receiveHappening(sim, { type: 'crash', kind: 'bonk', x: 'a', z: 0 }));
  r.ok('crashes: a crash on another map is not drawn on this one', !hap.receiveHappening(sim, { type: 'crash', kind: 'bonk', x: 0, z: 0, map: 'nowhere' }, {}));
  hap.receiveHappening(sim, { type: 'crash', kind: 'bonk', x: ac.pos.x, z: ac.pos.z + 800, map: T.MAP.id }, { name: '<b>x</b>', colour: 'red; background:url(x)' });
  const junkMark = C.marks.list[C.marks.list.length - 1];
  r.ok('crashes: a name or colour that is not a name or colour is cleaned, not shown', /^#[0-9a-f]{6}$/i.test(junkMark.colour) && !(sim.hud.toasts || []).some((t) => t.node.querySelector && t.node.querySelector('b')));

  /* ---- the wildfire, summoned from the pause menu ---------------------------- */
  say('crashes: the wildfire disaster');
  r.ok('wildfire: in the disasters list', dis.SELECTABLE_EVENTS.some((e) => e.id === 'wildfire') && !!dis.findEvent('wildfire'));
  const armBox = document.querySelector('[data-event="wildfire"]');
  r.ok('wildfire: the Free Flight setup can arm it', !!armBox, armBox ? armBox.closest('.fail-row').textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : 'no checkbox');
  await free({ windSpeedKts: 8, windDirDeg: 270 });
  sim.step(0.5);
  sim.pause();
  const btn = document.querySelector('[data-screen="pause"] [data-natural="wildfire"]');
  const fold = btn && btn.closest('[data-natural-fold]');
  r.ok('wildfire: the pause menu has a Wildfire button in Disasters', !!btn && fold && !fold.hidden, btn ? btn.textContent.replace(/\s+/g, ' ').trim() : 'none');
  r.ok('wildfire: its button wears a flame, not the weather cloud', !!btn && !!btn.querySelector('svg[data-wildfire-icon]') && btn.querySelectorAll('svg').length === 1);
  const heardFire = heard.length;
  if (btn) btn.click();
  let st = wf.fireStatus(sim);
  r.ok('wildfire: pressing it lights the wildfire feature\'s own fire, with water armed', st.live && st.burning > 0 && !!st.kind, `${st.burning} burning, ${st.kind}`);
  r.ok('wildfire: the button shows it is on', !!btn && btn.classList.contains('is-on') && /ON|s$/.test(btn.querySelector('.trigger-state').textContent), btn && btn.querySelector('.trigger-state') && btn.querySelector('.trigger-state').textContent);
  const fireEv = heard.slice(heardFire).find((e) => e.type === 'disaster' && e.id === 'wildfire');
  r.ok('wildfire: a happening goes out, at the fire, marked as summoned', !!fireEv && !fireEv.remote && fireEv.summoned === true && Number.isFinite(fireEv.x), JSON.stringify(fireEv));
  sim.resume();
  sim.step(6);
  r.ok('wildfire: still burning, still ON, after the usual disaster would have ended', wf.fireStatus(sim).burning > 0 && sim.activeEvents.wildfire === 3, `${wf.fireStatus(sim).burning} burning, ${sim.activeEvents.wildfire}`);

  // Fire-fighting still works: fill up and drop it on the flames, the way fire.browser.js does a mission.
  {
    const W = wf.wildfireDebug();
    W.tank.litres = W.tank.capacity;
    const t = wf.dropPoint();
    const before = wf.fireStatus(sim).burning;
    if (t) {
      const fill = W.fill || { x: t.x - 500, z: t.z };
      let dx = t.x - fill.x;
      let dz = t.z - fill.z;
      const L = Math.hypot(dx, dz) || 1;
      dx /= L;
      dz /= L;
      const s0 = { x: t.x - dx * 170, z: t.z - dz * 170 };
      let top = 0;
      for (let k = 0; k <= 10; k++) top = Math.max(top, T.heightAt(s0.x + dx * k * 30, s0.z + dz * k * 30));
      ac.reset({ pos: new THREE.Vector3(s0.x, 0, s0.z), headingDeg: (Math.atan2(dx, -dz) * 180) / Math.PI, speed: 50, altAGL: top + 45 - T.heightAt(s0.x, s0.z), engineOn: true, gearDown: false });
      ac.controls.throttle = 0.6;
      sim.input.throttleTarget = 0.6;
      sim.step(0.2);
      const down = new KeyboardEvent('keydown', { code: 'KeyX', bubbles: true, cancelable: true });
      document.body.dispatchEvent(down);
      document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyX', bubbles: true, cancelable: true }));
      sim.step(7);
      st = wf.fireStatus(sim);
      r.ok('wildfire: X drops the water and a drop on the flames puts some out', st.drops >= 1 && st.hits >= 1 && st.burning < before, `${before} → ${st.burning} burning, ${st.drops} drop, ${st.hits} hit`);
    } else r.ok('wildfire: there is somewhere to drop', false, 'no target');
  }
  sim.quitToMenu('main');
  r.ok('wildfire: nothing left burning after Free Flight', !wf.fireStatus(sim).live);

  /* ---- armed before departure ---------------------------------------------- */
  const heardArmed = heard.length;
  await free({ events: { wildfire: { afterMin: 0 } } });
  sim.step(3.5);
  st = wf.fireStatus(sim);
  r.ok('wildfire: armed on the setup screen, it starts on its own', st.live && st.burning > 0, `${st.burning} burning`);
  const armedEv = heard.slice(heardArmed).find((e) => e.type === 'disaster' && e.id === 'wildfire');
  r.ok('happenings: armed before departure counts as summoned', !!armedEv && armedEv.summoned === true, JSON.stringify(armedEv));
  const heardWorld = heard.length;
  sim.triggerNatural('fogBank');
  const worldEv = heard.slice(heardWorld).find((e) => e.type === 'disaster');
  r.ok('happenings: one the world did (the randomiser, a mission, the volcano) is not summoned', !!worldEv && worldEv.summoned === false, JSON.stringify(worldEv));
  sim.quitToMenu('main');

  /* ---- never in a mission ---------------------------------------------------- */
  try {
    const M = await import('../../src/game/missions.js');
    const plain = (M.MISSIONS || []).find((m) => m && m.id && !/fire|meteor|volcano|storm|tornado/i.test(m.id));
    if (plain) {
      await sim.startMode('mission', { id: plain.id });
      sim.step(0.3);
      sim.triggerNatural('wildfire');
      r.ok('wildfire: never in a mission — nothing is lit', !wf.fireStatus(sim).live, plain.id);
      sim.quitToMenu('main');
    }
  } catch (err) {
    r.ok('wildfire: the mission list loads', false, String(err && err.message));
  }

  /* ---- somebody else's disaster ------------------------------------------------ */
  await free();
  sim.step(0.3);
  const heardRemote = heard.length;
  const applied = hap.receiveHappening(sim, { type: 'disaster', id: 'tornado', x: ac.pos.x, z: ac.pos.z, map: T.MAP.id }, { name: 'Brave Otter', apply: true });
  const echo = heard.slice(heardRemote).find((e) => e.type === 'disaster');
  r.ok('happenings: another player\'s tornado is summoned here when asked to', applied && sim.activeEvents && sim.activeEvents.tornado > 0);
  r.ok('happenings: …and it says who summoned it', (sim.hud.toasts || []).some((t) => /Brave Otter summoned: Tornado!/.test(t.node.textContent)));
  r.ok('happenings: …and marked remote, so it is not sent back round the lobby', !!echo && echo.remote === true, JSON.stringify(echo));
  const W2 = wf.wildfireDebug();
  const spot = { x: ac.pos.x, z: ac.pos.z };
  // Somewhere that burns, so the fire has a real spot to be lit at.
  for (let rr = 200; rr < 6000; rr += 200) {
    const a = rr / 300;
    const x = ac.pos.x + Math.cos(a) * rr;
    const z = ac.pos.z + Math.sin(a) * rr;
    if (T.heightAt(x, z) > 8) {
      spot.x = x;
      spot.z = z;
      break;
    }
  }
  hap.receiveHappening(sim, { type: 'disaster', id: 'wildfire', x: spot.x, z: spot.z, map: T.MAP.id }, { name: 'Brave Otter', apply: true });
  const c2 = W2.grid && W2.grid.burning ? W2.grid.centroid({ x: 0, z: 0 }) : null;
  r.ok('happenings: another player\'s wildfire is lit where theirs is', !!c2 && Math.hypot(c2.x - spot.x, c2.z - spot.z) < 400, c2 ? `${Math.round(Math.hypot(c2.x - spot.x, c2.z - spot.z))} m from theirs` : 'not lit');
  r.ok('happenings: a disaster that is not in the list is refused', !hap.receiveHappening(sim, { type: 'disaster', id: 'eruption', x: 0, z: 0 }, { apply: true }));
  sim.quitToMenu('main');

  /* ---- what it costs ------------------------------------------------------------- */
  await free();
  sim.step(0.3);
  cr.stageCrash(sim, 'wingclip');
  noDebrief();
  const upd = ext.extensions().find((e) => e.id === 'crashes');
  const N = 60;
  const t0 = performance.now();
  for (let k = 0; k < N; k++) upd.update(sim, 1 / 60);
  const ms = (performance.now() - t0) / N;
  r.ok('crashes: a crash in progress costs the frame little', ms < 1.5, `${ms.toFixed(3)} ms a frame, ${C.fx ? C.fx.n : 0} puffs`);
  sim.quitToMenu('main');

  // Leave the minimap as it was found: these were test crashes.
  C.marks.clear();
  C.newestMine = null;
  off();
  sim.autoPauseOnHide = origAuto;
}
