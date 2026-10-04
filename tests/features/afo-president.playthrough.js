/**
 * The pilot bot for Air Force One's third seat: the President, on foot,
 * never touching a flight control. It plays the way a keyboard player does —
 * the arrow keys to turn, W to walk, E to wave, the number keys to answer the
 * Captain's card — through sim.key(), the same window key events a person's
 * keyboard makes, and it plans its own way round the furniture (a grid search
 * over the cabin's real obstacle list, src/game/roles/afo-president.js's
 * cabinObstacles()), so a cabin that cannot be walked fails here.
 *
 *   const { playthrough } = await import('./tests/features/afo-president.playthrough.js');
 *   const out = await playthrough(sim, 'afo-normal');
 *   const out2 = await playthrough(sim, 'afo-attack', { fail: true });
 *
 * `opts.fail` for 'afo-attack' is never walking to the secure room: the
 * Secret Service gives up and the mission fails with a plain reason.
 * 'afo-normal' has no fail path of its own — a ride-along, on purpose.
 *
 * @returns {Promise<{ ok, status, seconds, score, log, shots, why }>}
 */

/** A walkable grid over the cabin and an A* search on it; returns waypoints (local x/z). */
export function planner(Pres, WALK) {
  const C = Pres.CABIN;
  const obs = Pres.cabinObstacles();
  const r = WALK.radius + 0.04;
  const step = 0.1;
  const x0 = -C.halfW + r;
  const x1 = C.halfW - r;
  const z0 = C.z0 + r;
  const z1 = C.z1 - r;
  const nx = Math.floor((x1 - x0) / step) + 1;
  const nz = Math.floor((z1 - z0) / step) + 1;
  const freeAt = (x, z) => x >= x0 - 1e-6 && x <= x1 + 1e-6 && z >= z0 - 1e-6 && z <= z1 + 1e-6 && !obs.some((o) => x > o.x0 - r && x < o.x1 + r && z > o.z0 - r && z < o.z1 + r);
  const grid = new Uint8Array(nx * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) grid[k * nx + i] = freeAt(x0 + i * step, z0 + k * step) ? 1 : 0;
  const cell = (p) => [Math.max(0, Math.min(nx - 1, Math.round((p.x - x0) / step))), Math.max(0, Math.min(nz - 1, Math.round((p.z - z0) / step)))];
  const nearestFree = (i, k) => {
    if (grid[k * nx + i]) return [i, k];
    for (let d = 1; d < 30; d++) for (let a = -d; a <= d; a++) for (const [ii, kk] of [[i + a, k - d], [i + a, k + d], [i - d, k + a], [i + d, k + a]]) {
      if (ii >= 0 && kk >= 0 && ii < nx && kk < nz && grid[kk * nx + ii]) return [ii, kk];
    }
    return [i, k];
  };
  const lineFree = (a, b) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05);
    for (let j = 0; j <= n; j++) {
      const t = j / Math.max(1, n);
      if (!freeAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  };
  return function route(from, to) {
    const [si, sk] = nearestFree(...cell(from));
    const [gi, gk] = nearestFree(...cell(to));
    const N = nx * nz;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const open = [[0, si, sk]];
    g[sk * nx + si] = 0;
    const H = (i, k) => Math.hypot(i - gi, k - gk);
    while (open.length) {
      let bi = 0;
      for (let j = 1; j < open.length; j++) if (open[j][0] < open[bi][0]) bi = j;
      const [, i, k] = open.splice(bi, 1)[0];
      if (i === gi && k === gk) break;
      for (let di = -1; di <= 1; di++) for (let dk = -1; dk <= 1; dk++) {
        if (!di && !dk) continue;
        const a = i + di;
        const b = k + dk;
        if (a < 0 || b < 0 || a >= nx || b >= nz || !grid[b * nx + a]) continue;
        if (di && dk && (!grid[k * nx + a] || !grid[b * nx + i])) continue;
        const ng = g[k * nx + i] + (di && dk ? 1.4142 : 1);
        if (ng < g[b * nx + a]) {
          g[b * nx + a] = ng;
          came[b * nx + a] = k * nx + i;
          open.push([ng + H(a, b), a, b]);
        }
      }
    }
    if (came[gk * nx + gi] < 0 && !(gi === si && gk === sk)) return null;
    const path = [];
    for (let c = gk * nx + gi; c >= 0; c = came[c]) path.unshift({ x: x0 + (c % nx) * step, z: z0 + Math.floor(c / nx) * step });
    path.push({ x: to.x, z: to.z });
    // Corners only: drop every point the walker can see past.
    const out = [];
    let a = { x: from.x, z: from.z };
    let j = 0;
    while (j < path.length) {
      let far = j;
      for (let m = path.length - 1; m > j; m--) {
        if (lineFree(a, path[m])) {
          far = m;
          break;
        }
      }
      out.push(path[far]);
      a = path[far];
      j = far + 1;
    }
    return out;
  };
}

export async function playthrough(sim, missionId, { fail = false, shots = false, maxSeconds } = {}) {
  const Pres = await import('../../src/game/roles/afo-president.js');
  const { WALK } = await import('../../src/features/staff/walk.js');
  const UI = await import('../../src/features/events/ui.js');
  const cap = maxSeconds || 520;
  const route = planner(Pres, WALK);

  const realRender = sim.renderer.render.bind(sim.renderer);
  sim.renderer.render = () => {};
  const pics = [];
  const taken = new Set();
  const log = [];
  let T = 0;
  const say = (s) => log.push(`${T.toFixed(0)}s ${s}`);
  const shot = (name) => {
    if (!shots || taken.has(name)) return;
    taken.add(name);
    realRender(sim.scene, sim.camera);
    pics.push({ name, url: sim.renderer.domElement.toDataURL('image/jpeg', 0.75) });
  };

  const key = (action) => (sim.input.bindings[action] || [])[0];
  const K = { fwd: key('walkForward') || 'KeyW', left: key('footLookLeft') || 'ArrowLeft', right: key('footLookRight') || 'ArrowRight', wave: key('wave') || 'KeyE', c1: key('eventChoice1') || 'Digit8' };
  const held = Object.create(null);
  const set = (code, want) => {
    if (!!held[code] !== want) {
      sim.key(code, want);
      held[code] = want;
    }
  };
  const stopAll = () => {
    for (const c of Object.keys(held)) set(c, false);
  };

  let path = null;
  let pathFor = null;
  /** Turn with the arrow keys and walk with W, towards `target`. @returns {boolean} arrived */
  const walkTo = (target, radius) => {
    const w = Pres.walkerPos();
    if (Math.hypot(target.x - w.x, target.z - w.z) < radius) {
      stopAll();
      path = null;
      return true;
    }
    if (!path || pathFor !== target) {
      path = route(w, target);
      pathFor = target;
      if (!path) {
        say(`no route to ${JSON.stringify(target)} from ${w.x.toFixed(1)},${w.z.toFixed(1)}`);
        return false;
      }
    }
    while (path.length > 1 && Math.hypot(path[0].x - w.x, path[0].z - w.z) < 0.35) path.shift();
    const p = path[0];
    const dx = p.x - w.x;
    const dz = p.z - w.z;
    const want = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    const err = ((want - w.yaw + 540) % 360) - 180;
    set(K.left, err < -4);
    set(K.right, err > 4);
    set(K.fwd, Math.abs(err) < 30);
    return false;
  };

  const SPOT_FOR = {
    call: () => Pres.SPOTS.office,
    brief: () => Pres.SPOTS.conference,
    wave: () => Pres.SPOTS.window,
    cockpit: () => Pres.SPOTS.cockpit,
    approach: () => Pres.SPOTS.cockpit,
    secure: () => Pres.SPOTS.secureInside,
    orders: () => Pres.SPOTS.secureInside,
    defend: () => Pres.SPOTS.secureWindow,
    seat: () => Pres.SPOTS.seat,
  };
  const RADIUS = { call: 0.6, brief: 0.6, wave: 0.6, cockpit: 0.5, approach: 0.6, secure: 0.5, orders: 0.6, defend: 0.3, seat: 0.5 };

  let pressedWave = 0;
  let answeredAt = -9;
  let why = null;
  try {
    await sim.startMode('mission', { id: missionId, role: 'president' });
    say(`start ${missionId}/president`);
    let lastStepId = null;
    const dt = 1 / 30;
    while (T < cap) {
      sim.step(dt, dt);
      T += dt;
      const step = sim.runner.step;
      const stepId = step ? step.id : null;
      if (stepId !== lastStepId) {
        stopAll();
        path = null;
        say(`step ${stepId} (${sim.runner.status})`);
        lastStepId = stepId;
        shot(`${missionId}-president-${fail ? 'fail' : 'pass'}-${stepId}`);
      }
      if (sim.runner.status !== 'running') {
        say(`mission ${sim.runner.status}`);
        break;
      }
      if (fail && missionId === 'afo-attack') {
        stopAll(); // the deliberate fail: never go to the secure room
        continue;
      }
      // Answer the Captain's card the way a player would: the first answer's key.
      if (UI.choosing() && T - answeredAt > 1.5) {
        answeredAt = T;
        sim.key(K.c1, true);
        sim.key(K.c1, false);
        say('answered the card');
      }
      const spotFn = stepId && SPOT_FOR[stepId];
      if (spotFn) {
        const there = walkTo(spotFn(), RADIUS[stepId] || 0.6);
        if (there && stepId === 'wave' && T - pressedWave > 1) {
          pressedWave = T;
          sim.key(K.wave, true);
          sim.key(K.wave, false);
          say('waved');
        }
      } else {
        stopAll();
      }
    }
    stopAll();
    shot(`${missionId}-president-${fail ? 'fail' : 'pass'}-end`);
    why = sim.runner.failReason || (Pres.presidentInfo().failWhy) || null;
  } finally {
    sim.renderer.render = realRender;
    stopAll();
  }
  const status = sim.runner.status;
  return {
    ok: fail ? status === 'failed' : status === 'complete',
    missionId, roleId: 'president', fail, status, seconds: +T.toFixed(1),
    score: sim.runner.data ? sim.runner.data.score : null,
    why, log, shots: pics,
  };
}
