/**
 * Walking into the terminal, in the page, on the real keys:
 *
 *   node one-check.mjs 'http://127.0.0.1:PORT/?mute=1' ./tests/features/walk-in.browser.js check "" 1
 *
 *   - nothing of it is fetched until a walker comes near;
 *   - the build never takes a long step (no hitch), the doors slide, and from
 *     the forecourt W and Shift alone go: kerb door, hall, a security lane, up the
 *     escalator, gate, shop, lounge, down the stairs, along the corridor and out
 *     of an apron door, without once being put through a wall;
 *   - the windows are not painted: from a gate, the parked aeroplanes are there;
 *   - the boards list the flights on the stands;
 *   - the thumb-stick walks the same way;
 *   - quit and restart leave nothing behind: crash box, floor, folded triangles.
 */
export const id = 'walk-in';

async function load(path) {
  try {
    return await import(path);
  } catch (e) {
    return { __error: String((e && e.message) || e) };
  }
}

export async function check(sim, r, say = () => {}) {
  const OF = await load('../../src/features/onfoot.js');
  const PL = await load('../../src/features/terminal/plan.js');
  const WI = await load('../../src/features/walk-in.js');
  const TER = await load('../../src/world/terrain.js');
  const UI = await load('../../src/features/staff/ui.js');
  r.ok('walk-in: its modules load', !!(OF.onFoot && PL.planInterior && WI.WALK_IN !== undefined), [OF, PL, WI].map((m) => m.__error).filter(Boolean).join(' | '));
  if (!OF.onFoot) return r;
  if (!WI.WALK_IN) {
    r.ok('walk-in: switched off (WALK_IN)', true);
    return r;
  }
  const foot = OF.onFoot;
  const dt = 1 / 60;
  const run = (n) => {
    for (let i = 0; i < n; i++) sim.update(dt);
  };
  const up = () => {
    for (const c of ['KeyW', 'ShiftLeft']) sim.key(c, false);
  };

  say('walk-in: starting');
  up();
  // A hub or another map: window.__walkInMap = 'gateway' before the run.
  if (typeof window !== 'undefined' && window.__walkInMap) sim.setMap(window.__walkInMap);
  await sim.startMode('free', { aircraft: 'skylark', taxi: false });
  run(60);
  const fetchedAtStart = performance.getEntriesByType('resource').some((e) => /terminal\/interior\.js/.test(e.name));
  const st0 = sim.walkIn.state();
  r.ok('walk-in: nothing built in the seat', !st0.built && !st0.open, JSON.stringify(st0));
  if (!sim.walkIn.inside) r.ok('walk-in: no interior object until a walker comes near', true);
  r.ok('walk-in: fetched only when needed', !fetchedAtStart || st0.fetched, String(fetchedAtStart));
  sim.tap('KeyO');
  run(40);
  r.ok('walk-in: on foot', foot.active);
  const lay = sim.apron.lay;
  const P = PL.planInterior(lay);
  r.ok('walk-in: Kestrel can be walked into', !!P);
  if (!P) return r;
  const E = TER.AIRPORT.elev;
  const W = (u, b) => PL.toWorld(P, u, b);
  const d0 = P.land[0];
  const out = W(d0.u, P.D + 8);
  foot.place(out.x, out.z, 0);
  let longest = 0;
  for (let i = 0; i < 4000 && !sim.walkIn.state().built && !sim.walkIn.state().failed; i++) {
    const t0 = performance.now();
    sim.update(dt);
    longest = Math.max(longest, performance.now() - t0);
    if (i % 20 === 0) await new Promise((res) => setTimeout(res, 0));
  }
  run(5);
  const st1 = sim.walkIn.state();
  r.ok('walk-in: built on the way to the doors, and open', st1.built && st1.open, JSON.stringify(st1));
  if (!st1.open) return r;
  r.ok('walk-in: no build step is a hitch', st1.longestStep < 24, `longest step ${st1.longestStep.toFixed(1)} ms`);
  const inside = sim.walkIn.inside;
  r.ok('walk-in: it has people in it', st1.people >= 20, st1.people);

  /* ---- a walk ---- */
  let leak = 0;
  const walk = (u, b, label, tol = 0.9, secs = 120) => {
    const w = foot.walker;
    const t = W(u, b);
    sim.key('KeyW', true);
    sim.key('ShiftLeft', true);
    let best = 1e9;
    let stuck = 0;
    for (let i = 0; i < secs * 60; i++) {
      const dx = t.x - w.x;
      const dz = t.z - w.z;
      const d = Math.hypot(dx, dz);
      if (d < tol) {
        up();
        return true;
      }
      if (d < best - 0.05) {
        best = d;
        stuck = 0;
      } else if (++stuck > 240) break;
      foot.setCamera((Math.atan2(dx, -dz) * 180) / Math.PI, -6);
      sim.update(dt);
      // Inside a wall? The walker must never be in the crash box and out of the building's own plan.
      const q = PL.fromWorld(P, w.x, w.z);
      const ins = q.u > P.cu0 + 0.2 && q.u < P.cu1 - 0.2 && q.b > 0.3 && q.b < P.D - 0.3;
      if (ins && P.solids.some((s) => w.y - E + 1.2 > s.y0 && w.y - E + 0.1 < s.y1 && q.u > s.u0 + 0.05 && q.u < s.u1 - 0.05 && q.b > s.b0 + 0.05 && q.b < s.b1 - 0.05)) leak++;
    }
    up();
    r.ok(`walk-in: reached ${label}`, false, `stopped ${best.toFixed(1)} m short at ${(w.x | 0)},${w.y.toFixed(1)},${w.z | 0}: ${w.lastBlock}`);
    return false;
  };
  const yIs = (want, label) => r.ok(`walk-in: ${label}`, Math.abs(foot.walker.y - E - want) < 0.2, `y ${(foot.walker.y - E).toFixed(2)}`);

  say('walk-in: the kerb door');
  const door = sim.apron.doors && sim.apron.doors[d0.id];
  const ok1 = walk(d0.u, P.D + 2.4, 'the kerb door');
  run(50);
  r.ok('walk-in: the sliding doors open as you come', !!door && door.open > 0.5, door ? door.open.toFixed(2) : 'no door');
  if (!ok1) return r;
  walk(d0.u, P.D - 2.5, 'the hall');
  r.ok('walk-in: indoors now', sim.walkIn.state().indoors);
  yIs(PL.FLOOR, 'the hall floor');
  say('walk-in: security');
  const lane = P.sec.lanes[1].u + 2;
  walk(d0.u, P.B + 3.5, 'the front of the hall');
  walk(lane, P.B + 3.5, 'a security lane');
  walk(lane, P.B - 6.3, 'through security');
  const es = P.stairs[0];
  const bm = (es.b0 + es.b1) / 2;
  walk(es.u0 - 0.2, bm, 'the foot of the escalator');
  walk(es.uFoot + 3, bm, 'part way up');
  const mid = foot.walker.y - E;
  r.ok('walk-in: the stairs climb, without a jump', mid > 0.8 && mid < 3.2, mid.toFixed(2));
  walk(es.uFoot + PL.STAIR_LEN + 1.4, bm, 'the top');
  yIs(PL.UP + PL.FLOOR, 'the concourse floor');
  say('walk-in: upstairs');
  walk(es.uFoot + PL.STAIR_LEN + 1.4, P.walkB0 + 2.5, 'the walkway');
  const gate = P.gates[0];
  walk(gate.u, P.walkB0 + 1, `gate ${gate.number}`);
  const shop = P.shops.find((s) => s.kind === 'coffee');
  walk((shop.u0 + shop.u1) / 2, P.walkB0 + 2.5, 'the walkway at the coffee shop');
  walk((shop.u0 + shop.u1) / 2, shop.b0 + 0.8, 'inside the coffee shop');
  yIs(PL.UP + PL.FLOOR, 'still upstairs');
  // The solid bits of the room stop you.
  walk((shop.u0 + shop.u1) / 2, P.walkB0 + 2.5, 'back on the walkway');
  const L = P.lounge;
  walk(L.u0 - 2, (L.door.a + L.door.b) / 2, 'the lounge door');
  walk(L.u0 + 2.4, (L.door.a + L.door.b) / 2, 'inside the lounge');
  const walked = foot.walker.walked;
  r.ok('walk-in: a long way on foot, no teleports', walked > 100, walked.toFixed(0));

  /* ---- the view ---- */
  // Sat in front of the glass at a gate, what is out there is what is on the apron.
  const parked = (sim.apron.parked || []).filter((p) => p.stand);
  // (Low parks none: the apron is empty out there, as it is from the seat.)
  if (sim.qualityBuilt !== 'low') r.ok('walk-in: real aeroplanes stand outside the windows', parked.length >= 1 && sim.apron.group.visible !== false, parked.length);
  const curtain = sim.apron.group.getObjectByName('terminal-glass');
  r.ok('walk-in: the curtain wall is one-sided, so it is not between you and them', curtain && curtain.material.side === 0);

  /* ---- the boards ---- */
  const I = await import('../../src/features/terminal/interior.js');
  const rows = I.flightRows(sim, P, 600);
  const standNames = new Set(P.gates.map((g) => g.number));
  r.ok('walk-in: the boards list flights at the real gates', rows.length >= 1 && rows.every((q) => q.gate === '-' || standNames.has(q.gate)), JSON.stringify(rows.slice(0, 2)));
  r.ok('walk-in: the airlines are the parody ones', rows.every((q) => !/\b(delta|united|emirates|lufthansa|klm|air france)\b/i.test(q.flight)));

  /* ---- out by the apron ---- */
  say('walk-in: the way out');
  walk(L.u0 - 2, (L.door.a + L.door.b) / 2, 'out of the lounge');
  const gs = P.stairs[P.stairs.length - 1];
  const gb = (gs.b0 + gs.b1) / 2;
  walk(gs.uFoot + PL.STAIR_LEN + 1.6, P.walkB0 + 1.4, 'the walkway above the stair');
  walk(gs.uFoot + PL.STAIR_LEN + 1.6, gb, 'the top of the stair');
  walk(gs.uFoot - 0.3, gb, 'down the stair', 0.5);
  yIs(PL.FLOOR, 'the corridor level');
  const pass = P.passages[P.passages.length - 1];
  walk(pass.u, gb, 'the passage');
  walk(pass.u, 1.9, 'the corridor');
  const ad = P.air.slice().sort((a, b) => Math.abs(a.u - pass.u) - Math.abs(b.u - pass.u))[0];
  walk(ad.u, 1.9, 'the apron door, inside');
  walk(ad.u, -4, 'the apron', 0.9);
  r.ok('walk-in: out on the apron', !sim.walkIn.state().indoors && foot.walker.y - E < 0.3);
  r.ok('walk-in: never once inside a wall', leak === 0, leak);

  /* ---- the kerb furniture ---- */
  const kerb = sim.apron.lay && (await import('../../src/features/life/plan.js')).terminalSolids(lay).find((q) => q.kind === 'column');
  if (kerb) {
    foot.place(kerb.x, kerb.z + 4 * Math.sign(P.F.z(1) - P.F.z(0)), 0);
    const w = foot.walker;
    sim.key('KeyW', true);
    for (let i = 0; i < 180; i++) {
      const dx = kerb.x - w.x;
      const dz = kerb.z - w.z;
      foot.setCamera((Math.atan2(dx, -dz) * 180) / Math.PI, -6);
      sim.update(dt);
    }
    up();
    r.ok('walk-in: a walker does not go through the canopy columns', Math.hypot(kerb.x - w.x, kerb.z - w.z) > 0.5, `${Math.hypot(kerb.x - w.x, kerb.z - w.z).toFixed(2)} m, ${w.lastBlock}`);
  }

  /* ---- the thumb-stick ---- */
  if (UI && UI.touch) {
    const a = W(d0.u, P.D + 5);
    foot.place(a.x, a.z, 0);
    const b = W(d0.u, P.D - 3);
    foot.setCamera((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI, -6);
    UI.touch.y = 1;
    for (let i = 0; i < 240 && foot.walker && PL.fromWorld(P, foot.walker.x, foot.walker.z).b > P.D - 2; i++) sim.update(dt);
    UI.touch.y = 0;
    r.ok('walk-in: the thumb-stick walks in by the same door', PL.fromWorld(P, foot.walker.x, foot.walker.z).b < P.D - 0.5, PL.fromWorld(P, foot.walker.x, foot.walker.z).b.toFixed(1));
  }

  /* ---- what is left behind ---- */
  say('walk-in: leaving');
  const vc = sim.apron.group.getObjectByName('apron-structures');
  const cut = sim.apron.shellCut.vc[0];
  r.ok('walk-in: open, the walls are folded away', vc.geometry.attributes.position.getX(cut[0]) === 0 && vc.geometry.attributes.position.getZ(cut[0]) === 0);
  foot.end(sim);
  run(3);
  r.ok('walk-in: back in the seat, it is shut', !sim.walkIn.state().open && !sim.walkIn.state().indoors);
  r.ok('walk-in: the crash box is back', TER.OBSTACLES.every((o) => !o.walkIn));
  r.ok('walk-in: the walls are back', vc.geometry.attributes.position.getX(cut[0]) !== 0 || vc.geometry.attributes.position.getZ(cut[0]) !== 0);
  r.ok('walk-in: no stuck override', !foot.active);
  const beforeGroup = inside.group;
  await sim.startMode('free', { aircraft: 'skylark', taxi: false });
  run(30);
  const st3 = sim.walkIn.state();
  r.ok('walk-in: a restart starts shut', !st3.open);
  const inScene = [];
  sim.scene.traverse((o) => {
    if (o.name === 'terminal:inside' && o.visible) inScene.push(o);
  });
  r.ok('walk-in: nothing of it is drawn from the seat', inScene.length === 0 && (beforeGroup.visible === false));
  if (sim.quitToMenu) sim.quitToMenu();
  return r;
}
