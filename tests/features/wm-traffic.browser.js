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
    // A player picks the map on the menu and then Take off: the traffic (and the fleet's models) are in first.
    {
      const T0 = await Promise.race([wp.whenTraffic(), wait(30000).then(() => null)]);
      if (T0 && typeof T0.prewarm === 'function') await Promise.race([T0.prewarm(), wait(30000)]);
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
    {
      // "add more npc aircraft" must not cost the school iPads and Chromebooks anything: Low is what it was.
      const fl = Object.values(T.fleet).flat();
      const keys = new Set(fl.map((f) => f.key));
      const rare = new Set(Object.values(TP.CATS).flatMap((C) => C.rare || []));
      const rareIn = fl.filter((f) => rare.has(f.typeId)).map((f) => f.typeId);
      r.ok('wm-traffic: Low stays cheap — 8 flying, 2 full models, a fleet of at most 10 types and paints, none of the rare (biggest) types',
        TP.TIERS.low.n === TP.LOW_WAS.n && TP.TIERS.low.models === TP.LOW_WAS.models && TP.TIERS.low.fleet === TP.LOW_WAS.fleet && s0.n <= 8 && T.plan.n === 8
          && keys.size <= 10 && T.combos.length <= 10 && rareIn.length === 0 && T.proxy.instanceMatrix.count <= 16,
        `${s0.n} flying (cap ${T.plan.n}), fleet ${keys.size} types and paints (${[...new Set(fl.map((f) => f.typeId))].join(' ')}), ${T.combos.length} built ahead, rare: ${rareIn.join(' ') || 'none'}`);
    }
    run(5);
    const s1 = T.state();
    const moved = s1.list.filter((a) => {
      const b = s0.list.find((x) => x.id === a.id);
      return b && Math.hypot(a.x - b.x, a.z - b.z) > 100;
    }).length;
    const nan = s1.list.filter((c) => !Number.isFinite(c.x + c.y + c.z + c.hdg)).length;
    r.ok('wm-traffic: they move (5 s), no NaN', moved >= Math.min(s0.n, s1.n) - 1 && nan === 0, `${moved} of ${s1.n} moved, ${nan} NaN`);

    /* ---- the fields, towns and props out of reach: compiled already, not on the first one to come in reach ---- */
    {
      const pr = wp.props && wp.props();
      if (pr && pr.warmed) await Promise.race([pr.warmed, wait(20000)]);
      if (sim._worldWarm && sim._worldWarm.p) await Promise.race([sim._worldWarm.p, wait(10000)]);
      const props = sim.renderer.properties;
      const tally = (root) => {
        let n = 0;
        let c = 0;
        if (!root) return [0, 0];
        root.traverse((o) => {
          if (!(o.isMesh || o.isPoints) || !o.material) return;
          for (const m of [].concat(o.material)) {
            n++;
            try {
              if (props.get(m).currentProgram) c++;
            } catch (e) {
              /* none */
            }
          }
        });
        return [c, n];
      };
      const out = wp.outstations && wp.outstations();
      const hiddenFields = out ? out.fields.filter((f) => !f.visible) : [];
      let fc = 0;
      let fn = 0;
      for (const f of hiddenFields) {
        const [c, n] = tally(f);
        fc += c;
        fn += n;
      }
      const [pc, pn] = tally(pr && pr.group);
      r.ok('wm-traffic: the outstation fields out of reach and the scenery props are compiled before any comes in reach',
        hiddenFields.length > 0 && fn > 0 && fc === fn && pn > 0 && pc === pn && !!(pr && pr.warmed),
        `${hiddenFields.length} fields out of reach: ${fc} of ${fn} materials; props ${pc} of ${pn}, warmed ${!!(pr && pr.warmed)}`);
    }

    /* ---- their programs compiled in the background early in the flight, not at first sight ---- */
    {
      if (T._warmP) await Promise.race([T._warmP, wait(20000)]);
      const props = sim.renderer.properties;
      const progOf = (m) => {
        try {
          return !!props.get(m).currentProgram;
        } catch (e) {
          return false;
        }
      };
      let mats = 0;
      let ready = 0;
      for (const sl of T.models) {
        sl.model.traverse((o) => {
          if (!o.isMesh) return;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            mats++;
            if (progOf(m)) ready++;
          }
        });
      }
      const own = [T.proxy && T.proxy.material, T.lights && T.lights.material].filter(Boolean);
      const ownReady = own.filter(progOf).length;
      r.ok('wm-traffic: early in the flight every model\'s, the far shapes\' and the night lights\' programs are compiled (none waits for its first sight)',
        mats > 0 && ready === mats && own.length === 2 && ownReady === 2 && (T.stats.warmed || 0) >= 1,
        `${ready} of ${mats} model materials, ${ownReady} of ${own.length} far shape / lights, warmed ${T.stats.warmed || 0}`);
    }

    /* ---- no model built mid-flight at Low (a build is ~100 ms on a Chromebook) ---- */
    {
      const pw = typeof T.prewarmState === 'function' ? T.prewarmState() : null;
      const keys = new Set(Object.values(T.fleet).flat().map((f) => f.key));
      r.ok('wm-traffic: every type and paint the fleet flies has its model before the flight is under way', !!pw && pw.built === pw.combos && pw.combos >= Math.min(keys.size, 12),
        pw ? `${pw.built} of ${pw.combos} built (${keys.size} in the fleet), ${T.models.length} models kept` : 'no prewarm');
      // Each one in the sky brought 1 km in front of you in turn: its model, and nothing built for it.
      const cam = sim.camera.position;
      const live = T.plan.list.filter((c) => !c.gone);
      const saved = live.map((c) => [c.x, c.y, c.z]);
      const builds0 = T.stats.builds;
      let got = 0;
      const missed = [];
      for (const c of live) {
        for (const o of live) {
          o.x = cam.x + 60000;
          o.z = cam.z + 60000;
        }
        c.x = cam.x + 1000;
        c.y = cam.y;
        c.z = cam.z;
        T.lastBuild = -1e9;
        T._assign(false);
        if (c.data.slot && c.data.slot.key === c.data.key) got++;
        else missed.push(c.data.key);
      }
      live.forEach((c, i) => {
        [c.x, c.y, c.z] = saved[i];
      });
      T._assign(false);
      r.ok('wm-traffic: at Low each one that comes near gets an already-built model, none built mid-flight', got === live.length && T.stats.builds === builds0,
        `${got} of ${live.length} got their model; ${T.stats.builds - builds0} built mid-flight${missed.length ? '; missed ' + missed.join(', ') : ''}`);
    }

    /* ---- traffic that arrives after the flight is under way ---- */
    {
      // As if world-traffic.js had landed mid-flight (the flight started first): the fleet's models put
      // aside and start({ late: true }). With no loading screen up, the whole fleet at once was ~1 s frozen
      // on a Chromebook: the nearest few only (and the rest as they come near, as before the prewarm).
      // Behind a loading screen, the whole fleet as usual. Then everything put back.
      const aside = () => {
        for (const c of T.plan.list) {
          if (c.data && c.data.slot) {
            c.data.slot.owner = null;
            c.data.slot.model.visible = false;
            c.data.slot = null;
          }
        }
        return T.models.splice(0);
      };
      const stash = aside();
      let b0 = T.stats.builds;
      T.start({ late: true });
      const lateBuilt = T.stats.builds - b0;
      const lateFlag = !!T._late;
      for (const s of aside()) T._disposeSlot(s);
      const cover = document.createElement('div');
      cover.className = 'map-load';
      cover.style.cssText = 'opacity:0;pointer-events:none';
      document.body.appendChild(cover);
      b0 = T.stats.builds;
      T.start({ late: true });
      const coveredBuilt = T.stats.builds - b0;
      cover.remove();
      for (const s of aside()) T._disposeSlot(s);
      T.models.push(...stash);
      T.start();
      const src = await (await fetch(new URL('../../src/features/world-preview.js', import.meta.url))).text();
      r.ok('wm-traffic: traffic that lands mid-flight builds only the nearest few, not the whole fleet in one frame (behind a loading screen, all of it)',
        lateBuilt <= T.T.models && lateFlag && coveredBuilt === T.combos.length && !T._late && /S\.traffic\.start\(\{ late: true \}\)/.test(src) && T.models.length === stash.length,
        `${lateBuilt} built late in the open (the tier's ${T.T.models}), ${coveredBuilt} behind a loading screen (fleet ${T.combos.length}); ${stash.length} put back`);
    }

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
    r.ok('wm-traffic: one near you gets its full model; the rest are far shapes (one instanced draw)', !!placedNow && placedNow.model && s2.models <= (T.keep || TP.TIERS.low.models + 2) && T.proxy.isInstancedMesh,
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
    // At night: nav lights on each one in range (red left, green right, white tail) and a slow red beacon —
    // under 1 Hz and, with Reduce flashing on, a smooth swell (no on/off edge); none by day.
    {
      const FS = await import('../../src/render/flash-safety.js');
      const reduce0 = FS.FLASH.reduce;
      await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark', time: 'night', condition: 'clear' });
      if (sim.state === 'paused') sim.resume();
      run(1);
      // Two of them put in range: one 1.5 km off (its model), one 5 km off (a far shape).
      {
        const cam = sim.camera.position;
        const live = T.plan.list.filter((c) => !c.gone);
        [[1500, 0], [5000, 800]].forEach(([d, off], i) => {
          const c = live[i];
          if (!c) return;
          c.x = cam.x + d;
          c.z = cam.z + off;
          c.y = cam.y + 100;
        });
        T._assign(true);
        T._sync(1 / 60);
      }
      const st = T.state();
      const L = T.lights;
      const shown = st.lights || 0;
      const drawn = st.modelsDrawn + st.farDrawn;
      // Which side the red one is on: the first aircraft's lights, in its own frame (nose to -Z, right +X).
      let sides = 'none';
      if (L && shown >= 4) {
        const P = L.geometry.attributes.position;
        const C = L.geometry.attributes.color;
        const c0 = T.plan.list.filter((c) => !c.gone).find((c) => c.data.slot || Math.hypot(c.x - T.cam.x, c.y - T.cam.y, c.z - T.cam.z) < T.T.far);
        const right = { x: Math.cos(c0.hdg * Math.PI / 180), z: Math.sin(c0.hdg * Math.PI / 180) };
        const redSide = (P.getX(0) - c0.x) * right.x + (P.getZ(0) - c0.z) * right.z;
        const greenSide = (P.getX(1) - c0.x) * right.x + (P.getZ(1) - c0.z) * right.z;
        sides = `${C.getX(0) > 0.8 && C.getY(0) < 0.3 && redSide < 0 ? 'red left' : 'red WRONG'}, ${C.getY(1) > 0.8 && C.getX(1) < 0.3 && greenSide > 0 ? 'green right' : 'green WRONG'}`;
      }
      r.ok('wm-traffic: at night each one in range shows its nav lights and beacon (red left, green right, white tail)', !!L && drawn > 0 && shown === drawn * 4 && L.visible && sides === 'red left, green right',
        `${shown} lights for ${drawn} drawn, ${sides}`);
      // The beacon over 6 s at 60 fps, Reduce flashing on and then off.
      const beaconRun = () => {
        const v = [];
        for (let i = 0; i < 360; i++) {
          T.update(1 / 60);
          v.push(T.state().beacon);
        }
        let ups = 0;
        let step = 0;
        for (let i = 1; i < v.length; i++) {
          step = Math.max(step, Math.abs(v[i] - v[i - 1]));
          if (v[i] > 0.5 && v[i - 1] <= 0.5) ups++;
        }
        return { ups, step };
      };
      FS.setReduceFlashing(true);
      const on = beaconRun();
      FS.setReduceFlashing(false);
      const off = beaconRun();
      FS.setReduceFlashing(reduce0);
      r.ok('wm-traffic: the beacon is slow (under 1 Hz) and, with Reduce flashing on, a swell with no on/off edge', on.ups <= 6 && off.ups <= 6 && on.ups >= 3 && on.step < 0.08,
        `Reduce flashing on: ${on.ups} flashes in 6 s, biggest step a frame ${on.step.toFixed(3)}; off: ${off.ups} in 6 s`);
      await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark', time: 'day', condition: 'clear' });
      if (sim.state === 'paused') sim.resume();
      run(1);
      r.ok('wm-traffic: by day no lights are drawn', !L || (!L.visible && (T.state().lights || 0) === 0), `${T.state().lights} lights, visible ${L && L.visible}`);
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
      if (TH && st) {
        // The busier sky at High: a third more than the 24 it had, more types, and still only the tier's few full models drawn.
        run(5);
        const s5 = TH.state();
        const types = new Set(Object.values(TH.fleet).flat().map((f) => f.typeId));
        const kinds = new Set(s5.list.map((c) => c.cat));
        r.ok('wm-traffic: High is busier — 34 flying (24 before) of four kinds or more, a fleet of 8 types or more, at most the tier\'s 5 full models drawn, the update under 0.6 ms a frame',
          s5.n >= 32 && s5.n === TP.TIERS.high.n && kinds.size >= 4 && types.size >= 8 && s5.modelsDrawn <= TP.TIERS.high.models && s5.stats.mean < 0.6,
          `${s5.n} flying, ${kinds.size} kinds, fleet types: ${[...types].join(' ')}; ${s5.modelsDrawn} models drawn, ${s5.farDrawn} far shapes, update mean ${s5.stats.mean.toFixed(3)} ms (max ${s5.stats.msMax.toFixed(2)})`);
      }
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
