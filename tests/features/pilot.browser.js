/**
 * Browser checks for the walking pilot in single player, in the real game:
 * "if someone hits you with anything, a plane etc, you get pushed to the
 * ground, WASTED showing on your screen (ragdoll physics)" — the owner.
 *
 *   THE VAN        Out on the apron at Kestrel, stood in the follow-me van's
 *                  path: it knocks you down — a ragdoll on the ground, WASTED
 *                  with "Hit by the follow-me van." under it — you get up
 *                  beside where you lay, and walk again.
 *   THE AIRLINER   An A320 (or the biggest thing that can use the field)
 *                  taxiing out, you stood ahead of it on its way: down.
 *   YOUR OWN PLANE out with the power on, and in her way as she rolls: down
 *                  (tests/features/aircrew.browser.js does the rest of her).
 *   THE SWITCH     "Runaway plane & WASTED" off: the van still knocks you
 *                  over, with no WASTED screen; on again after.
 *   THE BODY       never under the ground, settled, and drawn: the person's
 *                  joints where the ragdoll's points are.
 *
 *   const { check } = await import('./tests/features/pilot.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p: !!p, d }); } };
 *   await check(window.__sim, r, console.log); console.table(r.checks);
 */

async function load(path) {
  try {
    return await import(path);
  } catch (e) {
    return { __error: String((e && e.message) || e) };
  }
}

export async function check(sim, r, say = () => {}) {
  say('pilot: loading');
  const OF = await load('../../src/features/onfoot.js');
  const KDm = await load('../../src/features/knockdown.js');
  const WSm = await load('../../src/features/wasted.js');
  const RWm = await load('../../src/features/runaway.js');
  const TF = await load('../../src/features/traffic.js');
  const WK = await load('../../src/features/staff/walk.js');
  const EXT = await load('../../src/game/extensions.js');
  const okLoad = !!(OF && OF.onFoot && KDm && KDm.knockdown && WSm && WSm.wasted && RWm && RWm.runaway && TF && TF.spawnTraffic && WK && WK.floorAt && EXT && EXT.extStatus);
  r.ok('pilot: its modules load', okLoad, okLoad ? '' : [OF, KDm, WSm, RWm, TF, WK, EXT].map((m) => m && m.__error).filter(Boolean).join(' | '));
  if (!okLoad) return r;
  r.ok('pilot: knockdown is registered and live', EXT.extStatus().some((e) => e.id === 'knockdown' && e.live));
  const foot = OF.onFoot;
  const KD = KDm.knockdown;
  const WS = WSm.wasted;
  const dt = 1 / 60;
  const run = (secs, each) => {
    const n = Math.round(secs / dt);
    for (let i = 0; i < n; i++) {
      sim.update(dt);
      if (each && each(i * dt) === true) return true;
    }
    return false;
  };
  sim.autoPauseOnHide = false;
  const wasSwitch = sim.settings.runawayPlane;
  sim.settings.runawayPlane = true;

  /** Watch a knock from start to getting up: the lowest the body lay, how far it sank, and the figure against the points. */
  const watchFall = (secs = 12) => {
    const o = { lay: 9, sink: 0, drawErr: 0, word: false, grey: false, upAt: null, t: 0 };
    run(secs, (t) => {
      o.word = o.word || WS.wordShown;
      o.grey = o.grey || WS.grey;
      if (KD.down) {
        const rd = KD.ragdoll;
        o.lay = Math.min(o.lay, rd.height());
        o.sink = Math.max(o.sink, rd.maxSink);
        // The figure drawn where the points are: the person's knees and head, read back off the model.
        const m = foot.model;
        if (m && m.userData.rig) {
          m.updateMatrixWorld(true);
          const rig = m.userData.rig;
          const kp = rig.legs[0].knee.getWorldPosition(m.position.clone());
          const want = rd.point(kp && rig.legs[0].side < 0 ? 11 : 12);
          o.drawErr = Math.max(o.drawErr, Math.hypot(kp.x - want.x, kp.y - want.y, kp.z - want.z));
        }
      } else if (o.upAt === null && KD.gotUp) o.upAt = t;
      o.t = t;
      return !KD.down && !WS.active && t > 0.5;
    });
    return o;
  };

  /* ================================================================ */
  say('pilot: the follow-me van');
  await sim.startMode('free', { aircraft: 'skylark', taxi: false, time: 'day', condition: 'clear', windSpeedKts: 0, traffic: false });
  if (sim.state === 'paused' && sim.resume) sim.resume();
  run(1);
  sim.tap('KeyO');
  run(0.5);
  r.ok('pilot: out of the Skylark, on foot', foot.active);
  const ap = sim.apron;
  const fm = ap && ap.followMe;
  if (!fm || !fm.path) {
    r.ok('pilot: the follow-me van knocks you down', true, 'skipped: no follow-me van on this airfield');
  } else {
    const p = { x: 0, z: 0, yaw: 0 };
    fm.path.sample(fm.d + 16, p);
    foot.place(p.x, p.z, 0);
    const k0 = KD.count;
    const w0 = WS.count;
    run(8, () => KD.down);
    const hit = KD.down && KD.count === k0 + 1 && KD.cause === 'van';
    r.ok('pilot: stood in the follow-me van’s path, it knocks you down', hit, `${KD.cause} "${KD.words}" at ${KD.last ? KD.last.speedKt : '?'} kt`);
    r.ok('pilot: ...WASTED on your screen, with what hit you underneath', WS.count === w0 + 1 && WS.active && WS.words === 'Hit by the follow-me van.', WS.words);
    r.ok('pilot: ...and you cannot walk while you are down', !!(foot.control && foot.control.locked));
    const f = watchFall();
    r.ok('pilot: ...a ragdoll: flat on the ground, never in it, the figure drawn where the body is', f.lay < 0.5 && f.sink < 0.005 && f.drawErr < 0.06,
      `lay ${f.lay.toFixed(2)} m high, sank ${(f.sink * 1000).toFixed(1)} mm, figure ${(f.drawErr * 100).toFixed(1)} cm off`);
    r.ok('pilot: ...WASTED went grey, said its word and cleared', f.word && f.grey && !WS.active);
    const w = foot.walker;
    const pel = KD.ragdoll.pelvis;
    r.ok('pilot: ...and you get up beside where you lay, free to walk', KD.gotUp && !(foot.control && foot.control.locked) && Math.hypot(w.x - pel.x, w.z - pel.z) < 15,
      `up after ${f.upAt === null ? '?' : f.upAt.toFixed(1)} s, ${Math.hypot(w.x - pel.x, w.z - pel.z).toFixed(1)} m from the body`);
    const x0 = w.x;
    const z0 = w.z;
    sim.key('KeyW', true);
    run(1.2);
    sim.key('KeyW', false);
    run(0.2);
    r.ok('pilot: ...and walk again', Math.hypot(w.x - x0, w.z - z0) > 1, `${Math.hypot(w.x - x0, w.z - z0).toFixed(1)} m in 1.2 s`);

    /* -------- the switch -------- */
    say('pilot: the pause switch off');
    sim.settings.runawayPlane = false;
    run(2.5); // the moment's grace after getting up
    fm.path.sample(fm.d + 16, p);
    foot.place(p.x, p.z, 0);
    const k1 = KD.count;
    const w1 = WS.count;
    run(8, () => KD.down);
    r.ok('pilot: the switch off — the van still knocks you down, but no WASTED screen', KD.down && KD.count === k1 + 1 && WS.count === w1 && !WS.active && !WS.grey);
    const f2 = watchFall();
    r.ok('pilot: the switch off — up again once the body has settled', KD.gotUp && !KD.down && f2.lay < 0.5);
    sim.settings.runawayPlane = true;
  }

  /* ================================================================ */
  say('pilot: a taxiing airliner');
  {
    TF.clearTraffic(sim);
    let dep = TF.spawnTraffic(sim, 'depart', 'a320');
    if (!dep.ok) dep = TF.spawnTraffic(sim, 'depart', 'meridian');
    if (!dep.ok) dep = TF.spawnTraffic(sim, 'depart');
    const list = () => (Array.isArray(sim.traffic) ? sim.traffic : []);
    let t = null;
    run(90, () => {
      t = list().find((c) => c && c.onGround && c.speed > 3 && c.typeId);
      return !!t;
    });
    if (!dep.ok || !t) {
      r.ok('pilot: a taxiing airliner knocks you down', false, dep.ok ? 'nothing taxied within 90 s' : dep.why);
    } else {
      const k2 = KD.count;
      let hit = false;
      // Ahead of it on its way; it turns at junctions, so stand ahead again until it reaches you.
      for (let tries = 0; tries < 8 && !hit; tries++) {
        if (!(t.onGround && t.speed > 2)) {
          run(10, () => t.onGround && t.speed > 2);
        }
        const h = (t.heading * Math.PI) / 180;
        foot.place(t.pos.x + Math.sin(h) * 22, t.pos.z - Math.cos(h) * 22, t.heading + 180);
        hit = run(6, () => KD.down);
      }
      r.ok('pilot: an aeroplane taxiing out knocks you down when you stand in its way', hit && KD.count === k2 + 1 && KD.cause === 'traffic' && /taxiing/.test(KD.words), `${t.typeId}: "${KD.words}"`);
      watchFall();
    }
    TF.clearTraffic(sim);
  }

  /* ================================================================ */
  say('pilot: your own plane');
  {
    await sim.startMode('free', { aircraft: 'skylark', taxi: false, time: 'day', condition: 'clear', windSpeedKts: 0, traffic: false });
    if (sim.state === 'paused' && sim.resume) sim.resume();
    run(0.5);
    sim.key('Space', true);
    sim.input.throttleTarget = 0.35;
    run(2.5);
    sim.tap('KeyO');
    run(0.1);
    sim.key('Space', false);
    sim.tap('KeyO');
    run(0.3);
    const loose = RWm.runaway.active && foot.active;
    run(2);
    const ac = sim.aircraft;
    const hh = (ac.heading * Math.PI) / 180;
    foot.place(ac.pos.x + Math.sin(hh) * 25, ac.pos.z - Math.cos(hh) * 25, ac.heading + 180);
    const k3 = KD.count;
    run(10, () => KD.down);
    r.ok('pilot: your own runaway plane runs you down (one of the movers now, not a rule of its own)', loose && KD.count === k3 + 1 && KD.cause === 'plane' && /own plane/.test(KD.words), `"${KD.words}"`);
    watchFall();
    sim.tap('Enter');
    for (let i = 0; i < 40 && (foot.active || RWm.runaway.active); i++) await new Promise((res) => setTimeout(res, 50));
    run(0.3);
  }

  sim.settings.runawayPlane = wasSwitch;
  return r;
}
