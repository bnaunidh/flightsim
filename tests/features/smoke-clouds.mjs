/**
 * Node checks for the smoke cloud and the smoke tank. Plain node:
 *
 *   node tests/features/smoke-clouds.mjs
 *
 *   1. The tank: about 20 s of smoke from full, it stops by itself when it
 *      runs dry, it fills in about 30 s and only while NOT smoking, and a
 *      nearly-empty tank will not start (no one-frame stutter).
 *   2. A puff's life: it grows three to six times, softens in and thins out
 *      smoothly (no step), lasts about a minute, and is gone by 90 s; a loop
 *      flown for 16 s is still most of its smoke 30 s after it ends and
 *      nothing at all by 90 s.
 *   3. It travels with the wind: the wind's push is added up once, so puffs
 *      already in the air keep their course if the wind later changes, and a
 *      puff is born exactly at the tail.
 *   4. The pool: a pilot who smokes every time the tank lets them, as fast
 *      as a jet, for five minutes, never has a puff that is still in the
 *      air taken over by a new one (no pop).
 *   5. What goes to the card: only the changed slots while frames are drawing;
 *      when nothing is drawing (hidden tab, stubbed renderer) the whole pool is
 *      owed, never a few last ranges that would leave the rest of the cloud
 *      missing when drawing starts again.
 *   6. The picture: one draw call, one pooled buffer, no dither or hash, the
 *      numbers in the shader are the numbers here; the sky lights it like the
 *      clouds (dimmer at night).
 *   7. The plug-in still registers, with its hooks.
 *
 * The same things in the real renderer — the circle still there at 30 s and
 * gone by 90, the chip's bar, the frame cost — are in smoke-clouds.browser.js.
 */

// fx.js paints the cloud sprite on first use; give it a canvas that accepts anything.
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const root = new URL('../../src/', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

const THREE = await imp('vendor/three.module.js');
const S = await imp('features/fun/smoke.js');
const FX = await imp('features/fun/fx.js');
const fs = await import('node:fs');

let passed = 0;
let failed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ---- 1. the tank ------------------------------------------------------ */
{
  const t = new S.SmokeTank();
  ok('tank: it starts full', t.level === 1 && t.canStart());
  let secs = 0;
  let r = null;
  while (r !== 'empty' && secs < 60) {
    r = t.update(1 / 60, true);
    secs += 1 / 60;
  }
  ok('tank: smoking from full empties it in about 20 s', r === 'empty' && near(secs, 20, 0.1), `${secs.toFixed(2)} s`);
  ok('tank: …and says "empty" so the smoke turns itself off', t.empty && t.level === 0);
  ok('tank: an empty tank will not start', !t.canStart());
  let fill = 0;
  for (; fill < 3000 && t.level < 1; fill++) t.update(1 / 60, false);
  ok('tank: not smoking, it fills in about 30 s', near(fill / 60, 30, 0.2), `${(fill / 60).toFixed(2)} s`);
  ok('tank: …and stops at full', t.level === 1 && t.update(5, false) === null && t.level === 1);

  // Filling only happens while NOT smoking; smoking only drains.
  const u = new S.SmokeTank();
  u.level = 0.5;
  for (let i = 0; i < 300; i++) u.update(1 / 60, true);
  ok('tank: while smoke comes out it only goes down (5 s of 20)', near(u.level, 0.25, 0.01), u.level.toFixed(3));
  const l1 = u.level;
  for (let i = 0; i < 300; i++) u.update(1 / 60, false);
  ok('tank: while it does not, it only goes up', u.level > l1);

  // Hysteresis: a tank at 3% will not let you press T and stutter.
  const v = new S.SmokeTank();
  v.level = 0.03;
  ok('tank: nearly empty will not start', !v.canStart());
  for (let i = 0; i < 60 * 3; i++) v.update(1 / 60, false);
  ok('tank: …but will once it has filled a little (about 3 s)', v.canStart() && v.level < 0.2, v.level.toFixed(3));

  // Odd frames: a stalled frame, a zero frame, a negative one.
  const w = new S.SmokeTank();
  w.update(0, true);
  w.update(-1, true);
  w.update(NaN, true);
  ok('tank: a zero, negative or broken frame changes nothing', w.level === 1);
  w.update(1000, true);
  ok('tank: one enormous frame cannot take it below empty', w.level === 0);

  // A pilot who toggles on whenever the tank allows: the long-run share of time smoking.
  const x = new S.SmokeTank();
  let on = true;
  let smoked = 0;
  const N = 60 * 60 * 10;
  for (let i = 0; i < N; i++) {
    if (!on && x.canStart() && i % 600 === 0) on = true;
    if (x.update(1 / 60, on) === 'empty') on = false;
    if (on) smoked++;
  }
  ok('tank: flown greedily for ten minutes it smokes well under half the time ("every so often")', smoked / N < 0.45 && smoked / N > 0.3, `${((smoked / N) * 100).toFixed(0)}%`);
}

/* ---- 2. a puff's life, and the cloud it makes --------------------------- */
{
  const seeds = [0, 0.13, 0.5, 0.77, 0.999];
  const growth = seeds.map((s) => FX.puffScale(FX.puffLife(s), s));
  ok('puff: it ends 3 to 6 times the size it started', growth.every((g) => g >= 3 - 1e-9 && g <= 6 + 1e-9) && Math.max(...growth) > 5 && Math.min(...growth) < 4, growth.map((g) => g.toFixed(2)).join(' '));
  ok('puff: it starts at its own size', seeds.every((s) => FX.puffScale(0, s) === 1));
  let mono = true;
  for (const s of seeds) {
    let prev = 0;
    for (let a = 0; a <= FX.puffLife(s); a += 0.25) {
      const g = FX.puffScale(a, s);
      if (g + 1e-12 < prev) mono = false;
      prev = g;
    }
  }
  ok('puff: it only ever grows', mono);
  ok('puff: it lasts a minute or more, and never past 90 s', FX.SMOKE.lifeMin >= 45 && FX.SMOKE.lifeMax <= 90 && FX.SMOKE_LIFE === FX.SMOKE.lifeMax, `${FX.SMOKE.lifeMin}-${FX.SMOKE.lifeMax} s`);

  // The fade has no step in it: the most it changes from one frame (1/60 s) to the next is small.
  let worst = 0;
  let gone = true;
  let hold = true;
  for (const s of seeds) {
    let prev = FX.puffFade(0, s);
    for (let a = 1 / 60; a < FX.puffLife(s) + 1; a += 1 / 60) {
      const f = FX.puffFade(a, s);
      worst = Math.max(worst, Math.abs(f - prev));
      prev = f;
    }
    gone = gone && FX.puffFade(FX.puffLife(s), s) === 0 && FX.puffFade(90, s) === 0;
    hold = hold && FX.puffFade(5, s) === 1 && FX.puffFade(FX.puffLife(s) * FX.SMOKE.thinFrom, s) > 0.99;
  }
  ok('puff: its fade has no step in it (no pop at birth or at the end)', worst < 0.035, `largest change in one frame: ${worst.toFixed(4)}`);
  ok('puff: …it is whole for the first part of its life and gone, exactly, at the end', gone && hold);
  ok('puff: nothing before it is born', FX.puffFade(-1, 0.5) === 0 && FX.puffFade(NaN, 0.5) === 0);

  // A loop flown for 16 s at 80 m/s, smoke on the whole time. The wind is irrelevant to how much there is.
  const tr = new FX.SmokeTrail();
  const at = new THREE.Vector3();
  const dt = 1 / 60;
  const R = 200;
  const V = 80;
  let t = 0;
  const loopSecs = 16;
  for (; t < loopSecs; t += dt) {
    const a = (V / R) * t;
    at.set(0, 400 - R * Math.cos(a) + R, -R * Math.sin(a));
    tr.emit(dt, t, at, [1, 1, 1]);
    tr.update(t, 500, null, null);
  }
  tr.cut();
  const end = t;
  const peak = tr.body(end);
  const at30 = tr.body(end + 30);
  const at60 = tr.body(end + 60);
  const at90 = tr.body(end + 90);
  ok('cloud: a loop leaves a lot of smoke', tr.liveCount(end) > 500, `${tr.liveCount(end)} puffs`);
  ok('cloud: 30 s after the loop it is still most of what it was (the shape is still there)', at30 > peak * 0.7, `${((at30 / peak) * 100).toFixed(0)}% of it`);
  ok('cloud: 60 s after it is thinning', at60 < at30 * 0.6 && at60 > 0, `${((at60 / peak) * 100).toFixed(0)}%`);
  ok('cloud: 90 s after the loop it is gone', at90 === 0 && tr.liveCount(end + 90) === 0, `${at90}`);
  let falling = true;
  let prev = peak;
  for (let s = 0; s <= 100; s += 1) {
    const b = tr.body(end + s);
    if (s > 30 && b > prev + 1e-6) falling = false;
    if (s > 30) prev = b;
  }
  ok('cloud: after the first half-minute it only ever thins (smoothly, never back up)', falling);
  // …and in one second the amount of smoke never jumps by more than a few percent.
  let jump = 0;
  for (let s = 0; s < 100; s += 0.5) jump = Math.max(jump, Math.abs(tr.body(end + s + 0.5) - tr.body(end + s)) / peak);
  ok('cloud: it wears off gradually — at most a few percent in half a second', jump < 0.06, `${(jump * 100).toFixed(1)}%`);
  tr.dispose();
}

/* ---- 3. the wind -------------------------------------------------------- */
{
  const tr = new FX.SmokeTrail();
  const at = new THREE.Vector3(100, 300, -50);
  const dt = 1 / 30;
  let t = 0;
  tr.update(t, 500, null, { x: 6, z: -2 });
  // 10 s of wind, then a puff laid at the tail.
  for (let i = 0; i < 300; i++) {
    t += dt;
    tr.update(t, 500, null, { x: 6, z: -2 });
  }
  ok('wind: its push is added up over time (10 s of 6, -2 m/s)', near(tr.drift.x, 60, 0.01) && near(tr.drift.z, -20, 0.01), `${tr.drift.x.toFixed(2)}, ${tr.drift.z.toFixed(2)}`);
  // Hold still for a moment first: puffs are laid by distance, with a few a second even at rest.
  let i = -1;
  let driftThen = null;
  let bornAt = null;
  for (let k = 0; k < 10; k++) {
    t += dt;
    const was = tr.next;
    const d0 = [tr.drift.x, tr.drift.z];
    tr.emit(dt, t, at, [1, 0, 0]);
    if (tr.next !== was) {
      i = (tr.next + tr.max - 1) % tr.max;
      driftThen = d0;
      bornAt = t;
    }
    tr.update(t, 500, null, { x: 6, z: -2 });
  }
  const tOld = t;
  const born = [tr.aPos.getX(i) + driftThen[0], tr.aPos.getY(i) + tr.drift.y, tr.aPos.getZ(i) + driftThen[1]];
  ok('wind: a puff is born exactly at the tail, not where the wind has carried the world to', i >= 0 && near(tr.aBirth.getX(i), bornAt, 1e-3) && near(born[0], 100, 1e-3) && near(born[1], 300, 1e-3) && near(born[2], -50, 1e-3), born.map((v) => v.toFixed(2)).join(', '));
  // 20 s later in a wind that has changed completely.
  for (let k = 0; k < 600; k++) {
    t += dt;
    tr.update(t, 500, null, { x: 0, z: 5 });
  }
  // It was carried (6, -2) m/s until the wind changed and then (0, 5): where it is now is where it was plus what each wind gave it since.
  const now = [tr.aPos.getX(i) + tr.drift.x, tr.aPos.getZ(i) + tr.drift.z];
  const gave = [tr.drift.x - driftThen[0], tr.drift.z - driftThen[1]];
  ok('wind: a puff in the air keeps what the old wind gave it when the wind changes', near(gave[0], 6 * (tOld - bornAt + dt), 0.01) && near(gave[1], -2 * (tOld - bornAt + dt) + 5 * 20, 0.05) && near(now[0], 100 + gave[0], 1e-3), `${gave[0].toFixed(2)}, ${gave[1].toFixed(2)}`);
  tr.clear();
  ok('wind: clearing puts the world back', tr.drift.lengthSq() === 0 && tr.liveCount(t) === 0 && tr.hi === 0);
  // A paused game, then a long gap: no jump.
  tr.update(1000, 500, null, { x: 10, z: 0 });
  tr.update(2000, 500, null, { x: 10, z: 0 });
  ok('wind: a long gap between frames moves it at most a quarter-second of wind', tr.drift.x <= 2.5 + 1e-9, tr.drift.x.toFixed(2));
  tr.dispose();
}

/* ---- 4. the pool -------------------------------------------------------- */
{
  // The greediest pilot there can be: smoke every time the tank will let them, in a jet, for five minutes.
  const tr = new FX.SmokeTrail();
  const tank = new S.SmokeTank();
  const at = new THREE.Vector3();
  const dt = 1 / 60;
  let t = 0;
  let on = true;
  let stolen = 0;
  let laid = 0;
  const speed = 250;
  const orig = tr.aBirth.setX.bind(tr.aBirth);
  tr.aBirth.setX = (i, v) => {
    const age = t - tr.aBirth.getX(i);
    if (age >= 0 && age < FX.puffLife(tr.aSeed.getX(i)) && v > -1e5) stolen++;
    if (v > -1e5) laid++;
    orig(i, v);
  };
  for (let n = 0; n < 60 * 300; n++) {
    t += dt;
    at.set(speed * t, 500, 0);
    if (!on && tank.canStart() && n % 120 === 0) on = true;
    if (on) tr.emit(dt, t, at, [1, 1, 1]);
    else tr.cut();
    if (tank.update(dt, on) === 'empty') {
      on = false;
      tr.cut();
    }
    tr.update(t, 500, null, null);
  }
  ok('pool: five minutes of greedy smoking in a jet lays a great many puffs', laid > 4000, `${laid} puffs`);
  ok('pool: …and not one that was still in the air was taken over by a new one', stolen === 0, `${stolen} stolen, pool ${tr.max}`);

  // A slow pilot (a hover) lays far fewer.
  const hov = new FX.SmokeTrail();
  const here = new THREE.Vector3(0, 100, 0);
  for (let n = 0; n < 60 * 10; n++) hov.emit(dt, n * dt, here, [1, 1, 1]);
  ok('pool: a hovering helicopter does not pile up a ball (about a third of the rate)', hov.liveCount(10) < 10 * FX.SMOKE.rate * 0.4, `${hov.liveCount(10)} puffs in 10 s`);
  // A very slow frame cannot dump a hundred.
  const slow = new FX.SmokeTrail();
  slow.emit(5, 5, new THREE.Vector3(500, 100, 0), [1, 1, 1]);
  slow.emit(5, 10, new THREE.Vector3(1000, 100, 0), [1, 1, 1]);
  ok('pool: one very slow frame lays at most a burst', slow.liveCount(10) <= FX.SMOKE.burst * 2, `${slow.liveCount(10)}`);
  // A fast jet is laid thicker per puff (so the ribbon is as dense as a slow one) — it carries a weight above 1.
  let weight = 0;
  for (let i = 0; i < tr.max; i++) weight = Math.max(weight, tr.aCol.getW(i));
  ok('pool: puffs a long way apart are laid thicker (to 3x), and a slow one thinner', weight > 2 && weight <= 3 + 1e-6, weight.toFixed(2));
  tr.dispose();
  hov.dispose();
  slow.dispose();
}

/* ---- 5. what goes to the card -------------------------------------------- */
{
  const tr = new FX.SmokeTrail();
  const at = new THREE.Vector3();
  const dt = 1 / 60;
  let t = 0;
  const fly = (frames, drawing) => {
    for (let n = 0; n < frames; n++) {
      t += dt;
      at.set(t * 80, 300, 0);
      tr.emit(dt, t, at, [1, 1, 1]);
      tr.update(t, 500, null, null);
      if (drawing) {
        // What the renderer does as it draws the points: it sends what is owed (the ranges, or all of it), then says so.
        tr.points.onBeforeRender();
        tr.aPos.clearUpdateRanges();
        tr.aBirth.clearUpdateRanges();
        tr.aCol.clearUpdateRanges();
      }
    }
  };
  ok('card: it starts owing the whole pool (nothing is on the card yet)', tr.full);
  fly(1, true);
  ok('card: …and the first frame that draws it clears that', !tr.full);
  fly(120, false);
  fly(1, true);
  fly(1, false);
  ok('card: while frames draw, only the slots that changed are waiting (a few small ranges)', !tr.full && tr.aPos.updateRanges.length > 0 && tr.aPos.updateRanges.length <= 4, `${tr.aPos.updateRanges.length} ranges`);
  // A paused or hidden page keeps simulating without drawing: the ranges would pile up.
  fly(600, false);
  ok('card: with nothing drawing, the whole pool is owed — and no stray ranges are kept that would stand in for it', tr.full && tr.aPos.updateRanges.length === 0 && tr.aBirth.updateRanges.length === 0 && tr.aCol.updateRanges.length === 0, `full ${tr.full}, ${tr.aPos.updateRanges.length} ranges`);
  const owed = tr.aPos.version;
  fly(30, false);
  ok('card: …and it stays owed however long that goes on', tr.full && tr.aPos.updateRanges.length === 0 && tr.aPos.version > owed);
  fly(1, true);
  ok('card: the first frame that draws again clears the debt', !tr.full);
  fly(10, true);
  fly(2, false);
  ok('card: …and it is back to sending only what changed', !tr.full && tr.aPos.updateRanges.length > 0 && tr.aPos.updateRanges.length <= 4, `${tr.aPos.updateRanges.length} ranges`);
  tr.clear();
  ok('card: a clear() owes the whole pool again', tr.full);
  tr.dispose();
}

/* ---- 6. the picture ----------------------------------------------------- */
{
  const tr = new FX.SmokeTrail();
  const m = tr.mat;
  ok('picture: one draw call — one Points object, one material', tr.points.isPoints && !Array.isArray(tr.points.material) && tr.points.material === m);
  ok('picture: …one pooled buffer that is the size of the pool and never grows', tr.aPos.array.length === FX.SMOKE.pool * 3 && tr.aBirth.array.length === FX.SMOKE.pool && tr.aCol.array.length === FX.SMOKE.pool * 4);
  ok('picture: smooth alpha only — no dithering, no hashed or tested transparency', m.transparent === true && !m.dithering && !m.alphaHash && !m.alphaTest && !m.alphaToCoverage);
  const frag = m.fragmentShader;
  const vert = m.vertexShader;
  ok('picture: nothing in the shader is screen-space noise or a hash', !/gl_FragCoord|dither|hash|interleaved|bayer/i.test(frag + vert));
  ok('picture: …it fogs with distance and fades near the lens', /vFog/.test(frag) && /fogColor/.test(frag) && /nearFade/.test(vert) && m.fog === true);
  ok('picture: …and the numbers in the shader are the numbers here', vert.includes(`mix(${FX.SMOKE.lifeMin}.0, ${FX.SMOKE.lifeMax}.0, aSeed)`) && vert.includes(`mix(${FX.SMOKE.growMin}.0, ${FX.SMOKE.growMax}.0`) && vert.includes(`${FX.SMOKE.alpha} * aCol.a`));
  ok('picture: a puff that is not in the air is clipped away, not drawn as a speck', /gl_Position = vec4\(3\.0, 3\.0, 3\.0, 1\.0\)/.test(vert));
  ok('picture: it is drawn over the clouds, depth-tested and not written', tr.points.renderOrder > 5 && m.depthWrite === false && m.depthTest !== false);
  tr.dispose();

  // Lit like the clouds.
  const lum = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  const day = S.smokeLight('day', 0);
  const set = S.smokeLight('sunset', 0, { sun: [0, 0, 0], amb: [0, 0, 0] });
  const night = S.smokeLight('night', 0, { sun: [0, 0, 0], amb: [0, 0, 0] });
  ok('light: the top is brighter than the underside', lum(day.sun) > lum(day.amb));
  ok('light: night is a good deal dimmer than day, and sunset in between', lum(night.sun) < lum(day.sun) * 0.45 && lum(night.sun) < lum(set.sun) && lum(set.sun) < lum(day.sun), `${lum(day.sun).toFixed(2)} / ${lum(set.sun).toFixed(2)} / ${lum(night.sun).toFixed(2)}`);
  ok('light: sunset is warm and night is blue', set.sun[0] > set.sun[2] && night.sun[2] > night.sun[0]);
  const over = S.smokeLight('day', 1, { sun: [0, 0, 0], amb: [0, 0, 0] });
  ok('light: under a heavy overcast the sun is mostly gone (the top barely brighter than the underside)', lum(over.sun) - lum(over.amb) < (lum(day.sun) - lum(day.amb)) * 0.55);
  ok('light: an unknown time or a bad cover still gives a colour', S.smokeLight('dusk', NaN).sun.every((v) => v > 0));
}

/* ---- 7. the plug-in ------------------------------------------------------ */
{
  const ext = await imp('game/extensions.js');
  let err = null;
  try {
    await imp('features/fun.js');
  } catch (e) {
    err = e;
  }
  ok('plug-in: features/fun.js loads without a page', !err, err && err.message);
  const reg = ext.extensions().find((e) => e.id === 'fun');
  ok('plug-in: it registers as "fun" with its hooks', !!reg && ['install', 'buildWorld', 'startMode', 'stop', 'update', 'key'].every((h) => typeof reg[h] === 'function'));
  const src = fs.readFileSync(new URL('features/fun.js', root), 'utf8');
  ok('plug-in: the tank is wired in (drains while puffing, resets for a new flight)', /tank\.update\(dt, puffing\)/.test(src) && /tank\.reset\(\)/.test(src) && /tank\.canStart\(\)/.test(src));
  ok('plug-in: no new key — the same one action, T', (src.match(/registerActions\(/g) || []).length === 1 && /smoke:\s*\{[^}]*default: \['KeyT'\]/.test(src));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
