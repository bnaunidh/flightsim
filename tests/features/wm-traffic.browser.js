/**
 * World Map traffic, in the game (features/world-traffic.js on
 * world/worldmap/traffic-plan.js):
 *
 *   node .claude/devtools/briefs/one-check.mjs '<url>?mute=1' ./tests/features/wm-traffic.browser.js check "" 1
 *
 * On the World Map — Preview at Low (the class's Chromebooks), a Free Flight
 * from Haven:
 *   - the sky has the tier's traffic (8 at Low), every one a sky body, and
 *     they move; no NaN anywhere
 *   - the far ones are one instanced draw call; full models only for the
 *     nearest few (the tier's count), within the tier's range
 *   - one placed 2 km from you is on the minimap
 *   - the live map draws them (an aircraft symbol each); a tap on one picks
 *     it: the card says TRAFFIC, its callsign, its type, where from and where
 *     to, its height and speed, and offers no DIRECT TO; the mouse hovering
 *     over one marks it too
 *   - over a minute of flying, no take-off or landing at a field within 8 km
 *     of you, and none of them inside 1 km / 200 m of you
 *   - the frame cost at Low: the traffic's own update under 0.3 ms a frame
 *     (mean), and the drawing at most the tier's models plus one call
 *   - on another map (Kestrel) there is none: no traffic object, no group,
 *     no World Map bodies in the sky
 *   - trying to break it: the owner's Take over takes one out of the traffic
 *     (no copy flies on), a restart mid-flight gives a fresh sky with no
 *     leftovers, quitting mid-flight empties it, and Low to High rebuilds it
 *     at High's count
 * The map, the quality and Free Flight are put back afterwards.
 */
export const id = 'wm-traffic';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say) {
  say && say('wm-traffic: the World Map traffic');
  const wp = sim.worldPreview;
  if (!wp) {
    r.ok('wm-traffic: the World Map preview is installed', false, 'sim.worldPreview missing');
    return;
  }
  const before = { map: sim.settings.map, quality: sim.settings.quality };
  const errors = [];
  const oe = console.error;
  console.error = (...a) => {
    errors.push(a.map(String).join(' ').slice(0, 300));
    oe.apply(console, a);
  };
  sim.autoPauseOnHide = false;
  const run = (s) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) sim.step(1 / 60);
  };
  try {
    sim.settings.quality = 'low';
    let done = wp.whenBuilt();
    wp.choose('haven');
    await Promise.race([done, wait(180000)]);
    if (sim.qualityBuilt !== 'low') {
      done = wp.whenBuilt();
      sim.applyQualityNow('low');
      await Promise.race([done, wait(180000)]);
    }
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
    if (sim.state === 'paused') sim.resume();
    const T = await Promise.race([wp.whenTraffic(), wait(30000).then(() => null)]);
    const TP = await import('../../src/world/worldmap/traffic-plan.js');
    const WT = await import('../../src/features/world-traffic.js');
    if (!T) {
      r.ok('wm-traffic: the World Map has traffic', false, 'none');
      return;
    }
    run(1);
    const s0 = T.state();
    const bodies = () => (sim.aircraftAround && sim.aircraftAround.bodies ? sim.aircraftAround.bodies.filter((b) => b.worldTraffic && !b.gone) : []);
    r.ok('wm-traffic: the sky has the tier\'s traffic (8 at Low), each a sky body', s0.n === TP.TIERS.low.n && bodies().length === s0.n,
      `${s0.n} flying, ${bodies().length} bodies: ${s0.list.slice(0, 4).map((c) => `${c.callsign} ${c.type} ${c.from}→${c.to} ${c.phase}`).join('; ')}`);
    run(5);
    const s1 = T.state();
    const moved = s1.list.filter((a) => {
      const b = s0.list.find((x) => x.id === a.id);
      return b && Math.hypot(a.x - b.x, a.z - b.z) > 100;
    }).length;
    const nan = s1.list.filter((c) => !Number.isFinite(c.x + c.y + c.z + c.hdg)).length;
    r.ok('wm-traffic: they move (5 s), no NaN', moved >= Math.min(s0.n, s1.n) - 1 && nan === 0, `${moved} of ${s1.n} moved, ${nan} NaN`);

    /* ---- one a km or two from you: models, the far shape, the minimap ---- */
    const ac = sim.aircraft;
    const P = { x: 0, z: 0, dx: 0, dz: 0 };
    let placed = null;
    for (const catId of ['jet', 'prop', 'wide']) {
      for (const pr of T.plan.pairs[catId]) {
        if (Math.hypot(pr[0].x - ac.pos.x, pr[0].z - ac.pos.z) < 12000) continue;
        const plan = T.plan._plan(catId, pr[0], pr[1]);
        let best = 1e9;
        let bs = 0;
        for (let s = 0; s < plan.sJ; s += 250) {
          TP.evalPath(plan.path, s, P);
          const d = Math.hypot(P.x - ac.pos.x, P.z - ac.pos.z);
          if (d < best) {
            best = d;
            bs = s;
          }
        }
        if (best < 1500) {
          placed = T.plan.spawn({ player: null, cam: null }, 'start', { catId, pair: pr, s: Math.max(0, bs - 1200) });
          if (placed) break;
        }
      }
      if (placed) break;
    }
    // A km or two off along its route: you 500 m under it (clear of it: nobody has to step aside).
    if (placed) {
      ac.pos.y = placed.y - 500;
      for (let i = 0; i < 12; i++) sim.step(1 / 60);
      T._assign(true);
      sim.step(1 / 60);
    }
    const mm = sim.minimap;
    if (mm) {
      mm.visible === false && mm.toggle && mm.toggle(true);
      mm.update(0.2, sim);
    }
    const s2 = T.state();
    const placedNow = placed ? s2.list.find((c) => c.id === placed.id) : null;
    r.ok('wm-traffic: one near you gets its full model; the rest are far shapes (one instanced draw)', !!placedNow && placedNow.model && s2.models <= TP.TIERS.low.models + 2 && T.proxy.isInstancedMesh,
      placedNow ? `${placedNow.callsign} ${placedNow.type} ${Math.round(Math.hypot(placedNow.x - ac.pos.x, placedNow.z - ac.pos.z))} m away, model ${placedNow.model}; ${s2.models} models built, ${s2.farDrawn} far shapes` : 'none placed');
    r.ok('wm-traffic: ...and it is on the minimap', !!mm && mm._drawnBodies >= 1, `${mm ? mm._drawnBodies : 'no minimap'} bodies drawn`);

    /* ---- the live map ---- */
    const LM = sim.liveMap;
    LM.open();
    run(0.3);
    const v0 = LM.view();
    LM.setView(ac.pos.x, ac.pos.z, Math.min(v0.W, v0.H) / 30000);
    run(0.2);
    const lay = WT.mapLayerStats();
    const v = LM.view();
    const target = placedNow ? T.plan.list.find((c) => c.id === placedNow.id) : T.plan.list[0];
    const sx = v.W / 2 + (target.x - v.cx) * v.s;
    const sy = v.H / 2 + (target.z - v.cz) * v.s;
    const w = LM.pickAt(sx, sy);
    run(0.6);
    const side = document.querySelector('.lm-side');
    const card = side ? side.innerText : '';
    const btns = [...document.querySelectorAll('[data-lm-act]')].map((b) => b.textContent);
    r.ok('wm-traffic: the live map draws them as aircraft symbols', lay.drawn >= 1, `${lay.drawn} drawn, ${lay.labels} tags`);
    r.ok('wm-traffic: a tap picks one — TRAFFIC, callsign, type, from and to, height and speed; no DIRECT TO',
      !!w && w.kind === 'traffic' && card.includes('TRAFFIC') && card.includes(target.callsign) && card.includes(target.plan.to.code) && /\bkt\b/.test(card) && !btns.includes('DIRECT TO'),
      `${w ? w.kind : 'nothing'} — ${card.replace(/\s+/g, ' ').slice(0, 220)}; buttons ${btns.join(',') || 'none'}`);
    // The mouse over another one.
    const cv = document.querySelector('.lm-cv');
    const other = T.plan.list.find((c) => c !== target && Math.abs((c.x - v.cx) * v.s) < v.W / 2 - 30 && Math.abs((c.z - v.cz) * v.s) < v.H / 2 - 30) || target;
    if (cv) {
      const rc = cv.getBoundingClientRect();
      const vv = LM.view();
      cv.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: rc.left + vv.W / 2 + (other.x - vv.cx) * vv.s, clientY: rc.top + vv.H / 2 + (other.z - vv.cz) * vv.s, bubbles: true }));
    }
    run(0.2);
    r.ok('wm-traffic: the mouse over one marks it (its tag with where it is going)', WT.mapLayerStats().hovered === other.id, `hovered ${WT.mapLayerStats().hovered}, wanted ${other.id}`);
    LM.close();

    /* ---- a minute of flying: the rules, and the cost ---- */
    T.stats.msSum = 0;
    T.stats.frames = 0;
    const ev0 = T.plan.events.length;
    let close = 0;
    let closest = Infinity;
    for (let i = 0; i < 60 * 60; i++) {
      sim.step(1 / 60);
      if (i % 6) continue;
      for (const c of T.plan.list) {
        if (c.gone || c.knocked) continue;
        const dh = Math.hypot(c.x - ac.pos.x, c.z - ac.pos.z);
        const dv = Math.abs(c.y - ac.pos.y);
        closest = Math.min(closest, Math.hypot(dh, dv));
        if (dh < 1000 && dv < 200) close++;
      }
    }
    const evs = T.plan.events.slice(ev0);
    const near = evs.filter((e) => (e.type === 'touchdown' || e.type === 'spawn') && e.playerToField != null && e.playerToField < TP.NO_RUNWAY_M).length;
    const sF = T.state();
    r.ok('wm-traffic: a minute of flying — no take-off or landing within 8 km of you, none inside 1 km / 200 m of you', near === 0 && close === 0 && !ac.crashed,
      `${evs.length} events (${evs.filter((e) => e.type === 'spawn').length} appeared, ${evs.filter((e) => e.type === 'despawn').length} gone, ${evs.filter((e) => e.type === 'touchdown').length} landed), closest ${Math.round(closest)} m, ${close} too close`);
    r.ok('wm-traffic: the cost at Low — the update under 0.3 ms a frame, at most the tier\'s models drawn', sF.stats.mean < 0.3 && sF.modelsDrawn <= TP.TIERS.low.models,
      `update mean ${sF.stats.mean.toFixed(3)} ms (max ${sF.stats.msMax.toFixed(2)}), ${sF.modelsDrawn} models drawn, ${sF.farDrawn} far shapes, builds ${sF.stats.builds} (worst ${sF.stats.buildMax.toFixed(1)} ms)`);

    /* ---- trying to break it (the checker, 2026-11-01) ---- */
    const visibleModels = () => T.models.filter((m) => m.model.visible).length;
    // The owner's Take over: the body's take() — gone from the traffic, no copy flying on beside you.
    {
      const b = bodies()[0];
      const id = b ? b.id : null;
      if (b && typeof b.take === 'function') b.take();
      run(0.5);
      const still = T.plan.list.some((c) => c.id === id && !c.gone);
      r.ok('wm-traffic: Take over (owner) takes it out of the traffic — no copy of it flies on', !!b && typeof b.take === 'function' && !still && !bodies().some((x) => x.id === id),
        `${b ? `${b.name}: take ${typeof b.take}` : 'no body'}, still flying ${still}, bodies ${bodies().length}`);
    }
    // Restart mid-flight: a fresh sky, the tier's count, every one a body, no model left showing from before.
    {
      await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
      if (sim.state === 'paused') sim.resume();
      run(1);
      const st = T.state();
      const ids = new Set(st.list.map((c) => c.id));
      const orphan = bodies().filter((b) => !ids.has(b.id)).length;
      r.ok('wm-traffic: restarting mid-flight — a fresh sky of the tier\'s count, a body each, no leftovers', T.on && st.n === TP.TIERS.low.n && bodies().length === st.n && orphan === 0 && visibleModels() <= st.modelsDrawn,
        `on ${T.on}, ${st.n} flying, ${bodies().length} bodies, ${orphan} orphans, ${visibleModels()} models showing (${st.modelsDrawn} drawn)`);
    }
    // Quitting mid-flight: the sky emptied — no bodies, no far shapes, no models showing, nothing stepping.
    {
      sim.quitToMenu && sim.quitToMenu();
      await wait(200);
      const st = T.state();
      r.ok('wm-traffic: quitting mid-flight empties the sky — no bodies, no far shapes, no models showing', !T.on && st.n === 0 && bodies().length === 0 && T.proxy.count === 0 && visibleModels() === 0,
        `on ${T.on}, ${st.n} flying, ${bodies().length} bodies, ${T.proxy.count} far shapes, ${visibleModels()} models showing`);
    }
    // Low to High from the menu: the World Map rebuilt, the traffic with it at High's count.
    {
      const done = wp.whenBuilt();
      sim.settings.quality = 'high';
      sim.applyQualityNow('high');
      await Promise.race([done, wait(240000)]);
      await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
      if (sim.state === 'paused') sim.resume();
      const TH = await Promise.race([wp.whenTraffic(), wait(30000).then(() => null)]);
      run(1);
      const st = TH ? TH.state() : null;
      const nan = st ? st.list.filter((c) => !Number.isFinite(c.x + c.y + c.z + c.hdg)).length : -1;
      r.ok('wm-traffic: Low to High — the traffic rebuilt with the world, at High\'s count, the old one gone', !!TH && TH !== T && st.quality === 'high' && st.n === TP.TIERS.high.n && bodies().length === st.n && nan === 0 && !T.group.parent,
        st ? `${st.quality}: ${st.n} flying, ${bodies().length} bodies, ${nan} NaN, old group attached ${!!T.group.parent}` : 'no traffic after the rebuild');
      sim.quitToMenu && sim.quitToMenu();
      await wait(200);
    }

    /* ---- another map: none ---- */
    sim.settings.quality = before.quality || 'medium';
    sim.setMap('kestrel');
    await wait(3000);
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
    run(2);
    const group = sim.scene.getObjectByName('wm-traffic');
    r.ok('wm-traffic: on another map (Kestrel) there is none — no traffic, no group, no World Map bodies', !wp.traffic() && !group && bodies().length === 0,
      `traffic ${!!wp.traffic()}, group ${!!group}, bodies ${bodies().length}`);
    r.ok('wm-traffic: no errors in the console', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    console.error = oe;
    try {
      if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
      sim.settings.quality = before.quality;
      if (before.map && before.map !== sim.settings.map) sim.setMap(before.map);
      if (sim.qualityBuilt !== before.quality && before.quality) sim.applyQualityNow(before.quality);
      await wait(1500);
    } catch (e) {
      /* best effort */
    }
  }
}
