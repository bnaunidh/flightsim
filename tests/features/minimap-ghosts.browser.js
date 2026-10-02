/**
 * Browser checks for the owner's "I see a meteor icon on the minimap even
 * though there isn't one" — the real game, the real meteor mode, the real
 * minimap, in the real layout.
 *
 * What it was (src/features/meteor.js, placeReticle): a rock off the screen
 * gets an orange teardrop pinned to the screen's edge, pointing the way to
 * look. The pin bands kept the HUD's top and bottom clear, but the minimap
 * lives in a corner inside those bands — bottom-right on a desk, top-left
 * on a touch screen — so a rock behind you or out to the side was pinned
 * onto the chart itself. On v48 this check fails there, and on the stale
 * reticles the hidden panel kept after a session.
 *
 * And what LOOKED like one: the gold stars on the chart are the Star Hunt's
 * (fun.js), while the shower's panel sent you through "the gold stars" and
 * two of the meteor missions wore star glyphs in the list. Those are checked
 * too, so they cannot drift back.
 *
 * Every import is dynamic, the same rule as the other feature checks.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  let THREE;
  let MIS;
  let ext;
  try {
    THREE = await import('../../src/vendor/three.module.js');
    MIS = await import('../../src/game/missions.js');
    ext = await import('../../src/game/extensions.js');
  } catch (err) {
    r.ok('minimap ghosts: the modules load', false, String(err && err.message));
    return;
  }
  if (!sim.meteors) {
    r.ok('minimap ghosts: meteor mode is on the game', false, 'no sim.meteors');
    return;
  }
  const status = ext.extStatus ? ext.extStatus() : [];
  const me = status.find((e) => e.id === 'meteor');
  r.ok('minimap ghosts: the meteor feature is registered and live', !!(me && me.live), JSON.stringify(me));

  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const mm = sim.minimap;
  const mapWasOn = mm.visible;
  if (!mapWasOn && typeof mm.toggle === 'function') mm.toggle(true);
  const html = document.documentElement;
  const wasTouch = html.classList.contains('is-touch-device');

  const frames = (n) => {
    for (let i = 0; i < n; i++) sim.update(1 / 30);
  };
  const box = (el) => el.getBoundingClientRect();
  const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const fmt = (b) => `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`;
  const mapBox = () => box(mm.el);
  const rets = (cls = '.mt-ret') => [...document.querySelectorAll(`#meteor-ui ${cls}`)].filter((e) => e.style.display === 'block');
  const uiEl = () => document.getElementById('meteor-ui');
  const free = () => sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0 });
  const quit = () => {
    if (sim.state !== 'menu' && typeof sim.quitToMenu === 'function') sim.quitToMenu();
  };

  /** Painted things over the minimap that are not the minimap: should be nothing, ever. */
  const overMap = () => {
    const m = mapBox();
    if (!(m.width > 0)) return [];
    const out = [];
    for (const e of document.querySelectorAll('#ext-layer *, #ui *, .hud *')) {
      if (e === mm.el || mm.el.contains(e) || e.contains(mm.el)) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      let hidden = false;
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        if (p.hidden || p.style.display === 'none') {
          hidden = true;
          break;
        }
      }
      if (hidden) continue;
      const b = box(e);
      if (b.width < 2 || b.height < 2 || !hits(b, m)) continue;
      if (b.width >= innerWidth * 0.9 && b.height >= innerHeight * 0.9) continue;
      const painted = (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') || cs.backgroundImage !== 'none' || cs.borderTopWidth !== '0px' || (e.textContent || '').trim() || e.tagName === 'CANVAS';
      if (!painted) continue;
      out.push(`${e.tagName.toLowerCase()}.${String(e.className || '').slice(0, 40)} @${fmt(b)}`);
    }
    return out;
  };

  /**
   * A rock aimed at the aeroplane from `bearing` degrees off the nose and
   * `elev` degrees above it, `dist` metres out — off the screen, so the
   * dodger pins a reticle for it. spawn() puts a rock at target − dir·speed·T.
   */
  const rockAt = (bearing, elev, dist = 1500) => {
    const ac = sim.aircraft;
    const hdg = (ac.readouts().heading + bearing) * (Math.PI / 180);
    const el = elev * (Math.PI / 180);
    const u = new THREE.Vector3(Math.sin(hdg) * Math.cos(el), Math.sin(el), -Math.cos(hdg) * Math.cos(el));
    const dir = u.clone().negate();
    const az = (Math.atan2(dir.x, -dir.z) * 180) / Math.PI;
    const dive = (Math.asin(-dir.y) * 180) / Math.PI;
    const speed = 200;
    return sim.meteors.spawn({ target: ac.pos.clone(), az, dive, speed, T: dist / speed, radius: 4, size: 1.6, threat: true });
  };
  const airborne = () => {
    const ac = sim.aircraft;
    ac.reset({ pos: new THREE.Vector3(-600, 0, 4200), headingDeg: 90, speed: 60, altAGL: 1200, engineOn: true, gearDown: false });
    ac.controls.throttle = 0.7;
  };

  try {
    /* ---- 1. Rock Dodger on a desk: a rock low and to the right is pinned to the corner the minimap is in ---- */
    say('minimap ghosts: pinned reticles');
    html.classList.remove('is-touch-device');
    await sim.startMode('mission', { id: 'meteor-dodge' });
    airborne();
    frames(20); // half a second: the panel measures the screen twice a second
    const m1 = mapBox();
    r.ok('minimap ghosts: the minimap is on the screen during Rock Dodger', m1.width > 50 && mm.visible, fmt(m1));
    const rockA = rockAt(70, -25);
    frames(3);
    let pinned = rets('.mt-ret.is-edge');
    r.ok('minimap ghosts: a rock off the screen gets a pinned reticle', !!rockA && pinned.length >= 1, `${pinned.length} pinned, rock ${!!rockA}`);
    let onMap = pinned.map(box).filter((b) => hits(b, m1));
    r.ok('minimap ghosts: no pinned reticle sits on the minimap (desk layout, bottom-right)', onMap.length === 0, `map ${fmt(m1)}; reticles ${pinned.map((e) => fmt(box(e))).join(' | ')}`);
    const stray = overMap();
    r.ok('minimap ghosts: nothing of the meteor interface is drawn over the minimap', stray.filter((s) => /mt-/.test(s)).length === 0, stray.join(' ; ') || 'clear');

    /* ---- 2. The touch layout: the minimap is top-left, and a rock high and to the left was pinned onto it ---- */
    html.classList.add('is-touch-device');
    frames(20);
    const m2 = mapBox();
    const moved = m2.left < m1.left && m2.top < m1.top;
    r.ok('minimap ghosts: with the touch layout the minimap moves to the top-left', moved && m2.width > 50, `${fmt(m1)} -> ${fmt(m2)}`);
    const rockB = rockAt(-70, 25);
    frames(3);
    pinned = rets('.mt-ret.is-edge');
    onMap = pinned.map(box).filter((b) => hits(b, m2));
    r.ok('minimap ghosts: no pinned reticle sits on the minimap (touch layout, top-left)', !!rockB && pinned.length >= 1 && onMap.length === 0, `map ${fmt(m2)}; reticles ${pinned.map((e) => fmt(box(e))).join(' | ')}`);
    html.classList.remove('is-touch-device');
    frames(20);

    /* ---- 3. After every meteor mission, nothing is left: quit, fly free ---- */
    say('minimap ghosts: after the missions');
    for (const id of ['meteor-dodge', 'meteor-shower', 'meteor-town', 'meteor-photo']) {
      await sim.startMode('mission', { id });
      airborne();
      frames(30);
      if (id === 'meteor-dodge') rockAt(70, -25);
      if (id === 'meteor-shower') {
        sim.meteors.spawnLander(true);
        sim.meteors.spawnLander(false);
      }
      frames(30);
      const during = sim.meteors.active && sim.meteors.mode === id.slice(7);
      quit();
      await free();
      frames(5);
      const ui = uiEl();
      const shown = rets();
      r.ok(`minimap ghosts: after ${id} and a free flight, meteor mode is off and its panel gone`, during && !sim.meteors.active && sim.meteors.count() === 0 && (!ui || ui.hidden), `during ${during}, active ${sim.meteors.active}, count ${sim.meteors.count()}, hidden ${ui ? ui.hidden : 'no ui'}`);
      r.ok(`minimap ghosts: after ${id}, no reticle is left showing`, shown.length === 0, shown.map((e) => `${e.className} ${e.style.transform} "${e.textContent}"`).join(' | ') || 'none');
      const over = overMap();
      r.ok(`minimap ghosts: after ${id}, nothing is drawn over the minimap`, over.length === 0, over.join(' ; ') || 'clear');
    }

    /* ---- 4. A shower summoned in free flight (multiplayer's shared shower) that ends: rocks landed, craters made ---- */
    say('minimap ghosts: a summoned shower ending');
    await free();
    airborne();
    sim.meteors.begin({ mode: 'shower' });
    sim.meteors.spawnLander(true);
    sim.meteors.spawnLander(false);
    // Until one has come down and made its crater (a big one takes up to forty seconds).
    for (let i = 0; i < 40 && sim.meteors.stats.landed < 1; i++) frames(30);
    const landed = sim.meteors.stats.landed;
    const wasOn = sim.meteors.active && !!uiEl() && !uiEl().hidden;
    sim.meteors.end();
    frames(3);
    r.ok('minimap ghosts: a summoned shower ends cleanly — rocks gone, panel gone, nothing left over', wasOn && landed >= 1 && !sim.meteors.active && sim.meteors.count() === 0 && sim.meteors.meteors().length === 0 && uiEl().hidden && rets().length === 0, `was on ${wasOn}, landed ${landed}, active ${sim.meteors.active}, count ${sim.meteors.count()}, reticles ${rets().length}`);
    const over = overMap();
    r.ok('minimap ghosts: and nothing is drawn over the minimap after it', over.length === 0, over.join(' ; ') || 'clear');

    /* ---- 5. Look-alikes: no meteor mission wears a star glyph, and the shower does not call stardust "gold stars" ---- */
    const starGlyph = /[★☆✦✧✶✷✸✹✺✵✴✳⭐]/u;
    const ids = ['meteor-shower', 'meteor-dodge', 'meteor-town', 'meteor-photo'];
    const icons = ids.map((id) => (MIS.findMission(id) || {}).icon || '');
    r.ok('minimap ghosts: no meteor mission has a star for its icon (the minimap’s gold stars are the Star Hunt’s)', icons.length === 4 && icons.every((i) => i && !starGlyph.test(i)), icons.join(' '));
    const shower = MIS.findMission('meteor-shower');
    const stepText = shower && shower.steps ? shower.steps.map((s) => `${s.text || ''} ${s.hint || ''}`).join(' ') : '';
    await sim.startMode('mission', { id: 'meteor-shower' });
    airborne();
    frames(10);
    const panel = document.querySelector('#meteor-ui .mt-panel');
    const panelText = panel ? panel.textContent : '';
    r.ok('minimap ghosts: the shower says "stardust", never "gold stars" (which the chart’s stars are not)', !/gold stars/i.test(stepText) && !/gold stars/i.test(panelText) && /stardust/i.test(panelText), `${stepText.slice(0, 80)} || ${panelText.slice(0, 80)}`);
    quit();

    /* ---- 6. Multiplayer's stand-in crash cross is not pinned to the bezel for a crash past the rim ---- */
    try {
      const mpw = await import('../../src/features/mpworld.js');
      const { multiplayer } = await import('../../src/features/multiplayer.js');
      const W = mpw.worldDebug().W;
      const colour = '#ab12cd';
      W.marks.push({ x: 1e5, z: 1e5, colour, at: Date.now(), name: 'Far Away' });
      const strokes = [];
      const stub = new Proxy({}, {
        get: (t, k) => (k === 'strokeStyle' ? t.strokeStyle : () => {}),
        set: (t, k, v) => {
          if (k === 'strokeStyle') strokes.push(String(v));
          t[k] = v;
          return true;
        },
      });
      for (const fn of multiplayer.minimapExtras) {
        try {
          fn(stub, () => [10, 10, true], sim);
        } catch (e) {
          /* another feature's drawer */
        }
      }
      W.marks.length = 0;
      r.ok('minimap ghosts: multiplayer’s own crash cross is not drawn pinned to the rim for a crash off the chart', !strokes.includes(colour), `${strokes.filter((s) => s === colour).length} strokes in its colour`);
    } catch (err) {
      r.ok('minimap ghosts: multiplayer’s crash-cross drawer can be checked', false, String(err && err.message));
    }
  } finally {
    if (wasTouch) html.classList.add('is-touch-device');
    else html.classList.remove('is-touch-device');
    if (sim.meteors.active) sim.meteors.end();
    quit();
    if (!mapWasOn && typeof mm.toggle === 'function') mm.toggle(false);
    sim.autoPauseOnHide = origAuto;
  }
}
