/**
 * Node checks for the moving sea (src/world/sea-state.js) and the carrier
 * under way (src/world/carrier-underway.js). Plain node:
 *
 *   node tests/features/carrier-waves.mjs
 *
 *   1. The swell: the CPU's waveAt is the shader's formula (the GLSL is
 *      evaluated here, term for term, against it); its slopes are its
 *      derivative; the weather sets the sea state; the tiers.
 *   2. The shore: no swell at the beach, little in a harbour.
 *   3. The shader patch still fits the stock sea shader, and Low stays cheap.
 *   4. The track: on every map it is deep water clear of land and of the
 *      approach lanes, or the ship holds station; the same every time.
 *   5. The deck's frame: a parked aeroplane is carried without drift, through
 *      a turn; the landing surface turns and tilts with the ship; joining
 *      and leaving the frame conserve the speed over the sea.
 *   6. A landing on the moving deck: closing speed, and the wire catches.
 *   7. None of it is in the first load.
 */
import { readFileSync } from 'node:fs';

const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.document = {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }), width: 0, height: 0, style: {} }),
  body: { appendChild() {} },
};
const root = new URL('../../', import.meta.url);
const load = (p) => import(new URL(p, root).href);

let pass = 0;
const fails = [];
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const THREE = await load('src/vendor/three.module.js');
const T = await load('src/world/terrain.js');
const M = await load('src/world/maps.js');
const O = await load('src/render/ocean-material.js');
const SEA = await load('src/world/sea-state.js');
const UW = await load('src/world/carrier-underway.js');
const B = await load('src/world/carrier-berth.js');
const DK = await load('src/features/carrier/deck.js');
const GEAR = await load('src/features/carrier/gear.js');
const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* 1. the swell ----------------------------------------------------------- */
T.applyMap('kestrel');
const field = O.buildDepthField('high');
{
  const sea = SEA.createSea('high', 'kestrel', field);
  SEA.setSeaState(sea, 0.8);
  sea.t = 37.25;
  /*
   * The shader's sum, written out from its own source: for each swell
   * th = dot(k, p) − ω·t + φ, height += a·sin(th), slope += a·cos(th)·k, all
   * times the shore factor. The GLSL is checked to still say exactly that.
   */
  const patched = SEA.patchShaders(O.OCEAN_SHADERS.VERT, O.OCEAN_SHADERS.FRAG);
  const v = patched ? patched.vert : '';
  ok('swell: the vertex shader is the formula checked here',
    /f = min\(f, min\(min\(texture2D\(uSwellDepth, uv \+ e\.xy\)/.test(v) && /float th = dot\(uSw\[i\]\.xy, p\) - uSw\[i\]\.z \* uSwellT \+ uSw\[i\]\.w;/.test(v)
    && /o\.z \+= a \* sin\(th\);/.test(v) && /o\.xy \+= a \* cos\(th\) \* uSw\[i\]\.xy;/.test(v)
    && /return vec4\(o \* shore, shore\);/.test(v) && /wp\.y \+= sw\.z;/.test(v)
    && v.includes(`smoothstep(${SEA.SHORE[0].toFixed(1)}, ${SEA.SHORE[1].toFixed(1)}, depth) * mix(${SEA.HARBOUR.toFixed(2)}, 1.0, mix(1.0, f.g, inside))`));
  const f32 = Math.fround;
  const glsl = (x, z) => {
    // In single precision, as the GPU does it, near the eye (no distance fade).
    let h = 0;
    for (const c of sea.comps) {
      const th = f32(f32(f32(f32(c.kx) * f32(x)) + f32(f32(c.kz) * f32(z))) - f32(f32(c.omega) * f32(sea.t)) + f32(c.phase));
      h = f32(h + f32(f32(c.amp) * f32(Math.sin(th))));
    }
    return h * SEA.shoreFactor(sea, x, z);
  };
  let worst = 0;
  let big = 0;
  for (let i = 0; i < 4000; i++) {
    const x = -9000 + ((i * 7919) % 18000);
    const z = -9000 + ((i * 104729) % 18000);
    if (T.heightAt(x, z) > -20) continue;
    const a = SEA.waveHeightAt(sea, x, z);
    worst = Math.max(worst, Math.abs(a - glsl(x, z)));
    big = Math.max(big, Math.abs(a));
  }
  ok('swell: waveHeightAt is the shader\'s sum (single precision, to 2 mm)', worst < 0.002 && big > 0.8, `${(worst * 1000).toFixed(2)} mm apart at worst, waves to ${big.toFixed(2)} m`);
  // Slopes are the derivative.
  let slopeErr = 0;
  const w = {};
  for (let i = 0; i < 200; i++) {
    const x = 5000 + i * 13.7;
    const z = 4000 - i * 9.1;
    SEA.waveAt(sea, x, z, w);
    const e = 0.01;
    const sx = (SEA.waveHeightAt(sea, x + e, z) - SEA.waveHeightAt(sea, x - e, z)) / (2 * e);
    const sz = (SEA.waveHeightAt(sea, x, z + e) - SEA.waveHeightAt(sea, x, z - e)) / (2 * e);
    slopeErr = Math.max(slopeErr, Math.abs(sx - w.sx), Math.abs(sz - w.sz));
  }
  ok('swell: the slopes are the height\'s own derivative', slopeErr < 1e-4, slopeErr.toExponential(2));
  // It moves, and at the speed deep water moves it.
  const c0 = sea.comps[0];
  const speed = c0.omega / Math.hypot(c0.kx, c0.kz);
  ok('swell: each wave travels at its deep-water speed', Math.abs(speed - Math.sqrt((9.81 * c0.len) / (2 * Math.PI))) < 1e-6, `${c0.len} m wave at ${speed.toFixed(1)} m/s`);
  const h0 = SEA.waveHeightAt(sea, 6000, 6000, 10);
  const h1 = SEA.waveHeightAt(sea, 6000, 6000, 13);
  ok('swell: the sea moves', Math.abs(h1 - h0) > 0.05, `${h0.toFixed(2)} → ${h1.toFixed(2)} m in 3 s`);

  // Weather.
  const clear = SEA.seaStateFor({ windSpeedKts: 4, cond: { turb: 0.05 } });
  const breeze = SEA.seaStateFor({ windSpeedKts: 14, cond: { turb: 0.3 } });
  const storm = SEA.seaStateFor({ windSpeedKts: 26, cond: { turb: 1 } });
  ok('weather: the sea state rises with the wind and the turbulence', clear < 0.2 && breeze > clear + 0.15 && storm > breeze + 0.25 && storm <= 1, `${clear.toFixed(2)} clear, ${breeze.toFixed(2)} breezy, ${storm.toFixed(2)} storm`);
  const hs = (s) => SEA.setSeaState(sea, s).hs;
  ok('weather: calm is a quarter of a metre, a storm two and a half', hs(clear) < 0.45 && hs(storm) > 1.6 && hs(storm) < 2.8, `${hs(clear).toFixed(2)} m, ${hs(storm).toFixed(2)} m`);
  const longShare = (s) => {
    SEA.setSeaState(sea, s);
    const long = sea.comps.filter((c) => c.len >= 120).reduce((a, c) => a + c.amp * c.amp, 0);
    return long / sea.comps.reduce((a, c) => a + c.amp * c.amp, 0);
  };
  ok('weather: a rough sea is longer as well as higher', longShare(storm) > longShare(clear) + 0.2, `${(longShare(clear) * 100).toFixed(0)}% → ${(longShare(storm) * 100).toFixed(0)}% of the energy in the long swells`);
  SEA.setSeaState(sea, 1);
  let steep = 0;
  for (const c of sea.comps) steep += c.amp * Math.hypot(c.kx, c.kz);
  ok('weather: never steep enough to break or to throw the horizon about', steep < 0.2 && sea.peak < 2.6, `slope ${steep.toFixed(3)} at most, ${sea.peak.toFixed(2)} m at most`);
  // It eases.
  SEA.setSeaState(sea, clear);
  SEA.tickSea(sea, 1 / 60, { windSpeedKts: 26, cond: { turb: 1 } });
  const jump = sea.s - clear;
  for (let i = 0; i < 60 * 40; i++) SEA.tickSea(sea, 1 / 60, { windSpeedKts: 26, cond: { turb: 1 } });
  ok('weather: the sea builds over seconds, never in a frame', jump < 0.01 && sea.s > storm - 0.03, `${jump.toFixed(4)} in one frame, ${sea.s.toFixed(2)} after 40 s`);

  // Tiers.
  const n = (q) => SEA.createSea(q, 'kestrel').comps.length;
  const verts = (q) => SEA.seaGeometry(q).userData.side ** 2;
  ok('tiers: 2 swells on Low, 4 on Medium, 6 on High and Ultra', n('low') === 2 && n('medium') === 4 && n('high') === 6 && n('ultra') === 6);
  ok('tiers: a small grid on Low, growing with the tier', verts('low') < 7000 && verts('medium') < 20000 && verts('high') < 40000 && verts('ultra') < 80000 && verts('low') < verts('medium') && verts('medium') < verts('high'), `${verts('low')} / ${verts('medium')} / ${verts('high')} / ${verts('ultra')} vertices`);
  for (const q of ['low', 'medium', 'high', 'ultra']) {
    const g = SEA.GRID[q];
    const xs = SEA.axis(g);
    const whole = Number.isInteger(SEA.FOLLOW / g.d);
    const reach = Math.abs(xs[0] + 28000) < 1e-6 && Math.abs(xs[xs.length - 1] - 28000) < 1e-6;
    const s = SEA.createSea(q, 'kestrel');
    const fine = s.comps.every((c) => g.d <= c.len / 3.3 && c.geoR > 150 && c.geoR < 1100);
    ok(`tiers: ${q} — the follow step is whole cells, the plane reaches the old edge, every swell has 3 points a wave`, whole && reach && fine, `${g.d} m cells, swells drawn to ${s.comps.map((c) => Math.round(c.geoR)).join('/')} m`);
  }
  const a = SEA.createSea('high', 'kestrel').comps[0];
  const b = SEA.createSea('high', 'kestrel').comps[0];
  const other = SEA.createSea('high', 'atoll').comps[0];
  ok('the same map has the same swell for everyone; another map another', a.kx === b.kx && a.phase === b.phase && other.kx !== a.kx);
}

/* 2. the shore ----------------------------------------------------------- */
{
  const sea = SEA.createSea('high', 'kestrel', field);
  SEA.setSeaState(sea, 1);
  const isl = T.ISLANDS[0];
  let worst = 0;
  let off = 0;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    let lo = isl.radius * 0.2;
    let hi = isl.radius * 1.9;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      if (T.heightAt(isl.cx + Math.cos(a) * m, isl.cz + Math.sin(a) * m) > 0) lo = m;
      else hi = m;
    }
    for (let t = 0; t < 30; t++) {
      worst = Math.max(worst, Math.abs(SEA.waveHeightAt(sea, isl.cx + Math.cos(a) * hi, isl.cz + Math.sin(a) * hi, t * 0.9)));
      off = Math.max(off, Math.abs(SEA.waveHeightAt(sea, isl.cx + Math.cos(a) * (hi + 900), isl.cz + Math.sin(a) * (hi + 900), t * 0.9)));
    }
  }
  ok('shore: the swell is under 15 cm at the waterline in a full storm, all round the island', worst < 0.15, `${worst.toFixed(3)} m at the shore, ${off.toFixed(2)} m 900 m off it`);
  // The depth field read as the GPU's bilinear tap reads it: exact at a texel centre.
  const i = 40;
  const j = 77;
  const x = field.cx - field.size / 2 + (i + 0.5) * (field.size / field.n);
  const z = field.cz - field.size / 2 + (j + 0.5) * (field.size / field.n);
  const tap = SEA.fieldAt(field, x, z);
  ok('shore: the depth field is read at the texel the shader reads', Math.abs(tap[0] - (field.data[(j * field.n + i) * 2] / 255) * 40) < 1e-9);
  // A harbour's basin keeps a fifth of it.
  const masked = { ...field, data: field.data.slice() };
  for (let k = 1; k < masked.data.length; k += 2) masked.data[k] = 0;
  const hsea = SEA.createSea('high', 'kestrel', masked);
  ok('shore: a harbour basin keeps about a tenth of the swell', Math.abs(SEA.shoreFactor(hsea, 6000, 6000) - SEA.HARBOUR) < 0.01, SEA.shoreFactor(hsea, 6000, 6000).toFixed(2));
}

/* 2b. a map with no depth field: one that follows the eye ----------------- */
{
  // An island 1.5 km across at the origin, a shelving beach, deep water beyond.
  let calls = 0;
  const height = (x, z) => {
    calls++;
    return clamp((750 - Math.hypot(x, z)) * 0.06, -40, 60);
  };
  const sea = SEA.createSea('low', 'worldmap', null);
  SEA.setSeaState(sea, 1);
  ok('local: with no field at all the sea is simply open sea', SEA.shoreFactor(sea, 800, 0) === 1);
  sea.field = SEA.localField('low', 300, 200, height);
  const f0 = sea.field;
  ok('local: 64 x 64 soundings round the eye, on a lattice of whole texels', f0.n === 64 && f0.data.length === 64 * 64 * 2 && f0.cx % f0.texel === 0 && f0.cz % f0.texel === 0 && calls === 4096, `${f0.size} m square at ${f0.texel} m`);
  ok('local: the beach is found, and the swell is gone at it', SEA.shoreFactor(sea, 750, 0) < 0.05 && SEA.shoreFactor(sea, 0, 760) < 0.05 && SEA.shoreFactor(sea, 2400, 0) > 0.95, `${SEA.shoreFactor(sea, 750, 0).toFixed(2)} at the shore, ${SEA.shoreFactor(sea, 2400, 0).toFixed(2)} offshore`);
  ok('local: off its edge is open sea', SEA.shoreFactor(sea, 300 + f0.size, 200) === 1);
  // Fly east at 120 m/s: the field is re-taken a few rows a frame, the eye is never out of it, and nothing shifts at the swap.
  let worstFrame = 0;
  let swaps = 0;
  let uncovered = 0;
  let shift = 0;
  let x = 300;
  for (let i = 0; i < 60 * 120; i++) {
    x += 2;
    const before = sea.field;
    const probe = SEA.shoreFactor(sea, x - 600, 150);
    calls = 0;
    SEA.followLocal(sea, x, 200, height);
    worstFrame = Math.max(worstFrame, calls);
    if (sea.field !== before) {
      swaps++;
      const overlap = Math.abs(x - 600 - before.cx) < before.size / 2 - 2 * before.texel && Math.abs(x - 600 - sea.field.cx) < sea.field.size / 2 - 2 * before.texel;
      if (overlap) shift = Math.max(shift, Math.abs(SEA.shoreFactor(sea, x - 600, 150) - probe));
    }
    if (Math.max(Math.abs(x - sea.field.cx), Math.abs(200 - sea.field.cz)) > sea.field.size / 2 - 1100) uncovered++;
  }
  ok('local: followed for 14 km, the eye always has 1,100 m of field round it', uncovered === 0 && swaps >= 3, `${swaps} new fields`);
  ok('local: a new field costs a few rows a frame, never a whole one', worstFrame <= 2 * 64, `${worstFrame} soundings in the worst frame`);
  ok('local: and the swell does not shift when it is swapped in', shift < 1e-9, shift.toExponential(1));
  calls = 0;
  SEA.followLocal(sea, 90000, 90000, height);
  ok('local: a jump to somewhere else is sounded at once', calls === 4096 && Math.abs(sea.field.cx - 90000) < sea.field.texel);
}

/* 3. the shader patch ---------------------------------------------------- */
{
  const p = SEA.patchShaders(O.OCEAN_SHADERS.VERT, O.OCEAN_SHADERS.FRAG);
  ok('shader: the swell still fits the stock sea shader', !!p);
  const stockTaps = (O.OCEAN_SHADERS.FRAG.match(/texture2D\(/g) || []).length;
  const taps = (p.frag.match(/texture2D\(/g) || []).length;
  ok('shader: not one more texture read a pixel', taps === stockTaps, `${taps} against ${stockTaps}`);
  ok('shader: Low gets its slope from the vertices — no per-pixel wave sum', /#if WATER_DETAIL > 0\s+vec2 s = vec2\(0\.0\);[\s\S]*?#else[\s\S]*?return vSwell\.xy \*/.test(p.frag));
  // Flash safety: stripes thinner than a pixel flicker, so the shading fades by the wave's size against the eye's height.
  ok('shader: the swell is shaded only as far as a wave is wider than a pixel from the eye\'s height', /float eye = max\(abs\(cameraPosition\.y\), 3\.0\);/.test(p.frag) && /float r2 = uSa\[i\]\.z \* eye;/.test(p.frag) && /smoothstep\(r2 \* 0\.15, r2, d2\)/.test(p.frag));
  ok('shader: lightning is still not added to the sea', !/uFlash/.test(p.frag));
  ok('shader: a shader that has changed shape is left alone', SEA.patchShaders('void main() {}', O.OCEAN_SHADERS.FRAG) === null);
  // And on a stand-in ocean: the plane, the uniforms, the question.
  const mat = O.createOceanMaterial('low', field);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10, 2, 2), mat);
  const ocean = { quality: 'low', deepMat: mat, deep: mesh, depthField: field, t: 0, update(dt) { this.t += dt; this.deepMat.uniforms.uTime.value = this.t; } };
  const sea = SEA.attach(ocean, 'kestrel');
  ocean.update(0.5, { windSpeedKts: 20, cond: { turb: 0.6 } });
  ok('attach: the ocean gets its grid, its swells and its clock', !!sea && mat.defines.SWELL_N === 2 && mesh.geometry.attributes.position.count === SEA.seaGeometry('low').userData.side ** 2 && sea.t === 0.5 && mat.uniforms.uSw.value.length === 2);
  ok('attach: terrain.swellAt answers with that sea', T.swellAt(7000, 7000) === SEA.waveHeightAt(sea, 7000, 7000) && T.swellAt(7000, 7000) !== 0);
  ocean.follow({ x: 1234, z: -5678 });
  ok('attach: the plane follows in whole cells', mesh.position.x === 1200 && mesh.position.z === -5700);
}

/* 4. the track ----------------------------------------------------------- */
{
  const ids = (Array.isArray(M.MAPS) ? M.MAPS : Object.values(M.MAPS)).map((m) => m.id);
  let tracks = 0;
  let bad = [];
  const holds = [];
  for (const id of ids) {
    T.applyMap(id);
    const berth = B.chooseBerth({ map: T.MAP, airport: T.AIRPORT, heightAt: T.heightAt });
    const t = UW.planTrack(berth);
    if (!t) {
      holds.push(id);
      continue;
    }
    tracks++;
    const lanes = B.runwayLanes(T.AIRPORT);
    const again = UW.planTrack(berth);
    if (again.leg !== t.leg || again.side !== t.side || again.radius !== t.radius) bad.push(`${id}: not the same twice`);
    // Every 40 m round it: the hull's corners over deep water, the centreline out of every lane, the pose continuous.
    const pose = {};
    let prev = null;
    for (let s = 0; s <= t.length; s += 40) {
      UW.poseAt(t, s, pose);
      const h = pose.headingDeg * D2R;
      for (const [fx, fz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) {
        const x = pose.x + fx * 180 * Math.cos(h) - fz * 750 * Math.sin(h);
        const z = pose.z + fx * 180 * Math.sin(h) + fz * 750 * Math.cos(h);
        if (!(T.groundHeightAt(x, z) < B.BERTH.minDepth)) bad.push(`${id}: ${T.groundHeightAt(x, z).toFixed(0)} m at s=${s}`);
      }
      if (B.laneIntrusion(lanes, pose.x, pose.z) > 0) bad.push(`${id}: in an approach lane at s=${s}`);
      if (prev) {
        const step = Math.hypot(pose.x - prev.x, pose.z - prev.z);
        const dh = Math.abs(((pose.headingDeg - prev.h + 540) % 360) - 180);
        if (step > 40.5 || step < 39 || dh > 2) bad.push(`${id}: jumps at s=${s} (${step.toFixed(1)} m, ${dh.toFixed(1)} deg)`);
      }
      prev = { x: pose.x, z: pose.z, h: pose.headingDeg };
    }
    // It starts at the berth, pointing north.
    UW.poseAt(t, t.start, pose);
    if (Math.hypot(pose.x - berth.x, pose.z - berth.z) > 1e-6 || pose.headingDeg !== 0) bad.push(`${id}: does not start at the berth`);
    bad = bad.slice(0, 6);
  }
  ok('track: on every map with room, the whole racetrack is deep water clear of land and the approach lanes', bad.length === 0, bad.join('; '));
  ok('track: most maps have room for one; the rest hold station', tracks >= 20 && tracks + holds.length === ids.length, `${tracks} of ${ids.length} steam; holding station: ${holds.join(', ') || 'none'}`);
  const t = UW.makeTrack(0, 0, 4000, 1500, 1);
  const lap = t.length / (UW.UNDERWAY.speedKts * 0.514444) / 60;
  ok('track: 14 knots, and a lap is most of an hour', UW.UNDERWAY.speedKts >= 10 && UW.UNDERWAY.speedKts <= 20 && lap > 20, `${lap.toFixed(0)} min for a 4 km leg`);
  const rate = ((UW.UNDERWAY.speedKts * 0.514444) / 1500) / D2R;
  ok('track: the turn is gentle (under half a degree a second)', rate < 0.5, `${rate.toFixed(2)} deg/s`);
}

/* 5. the deck's frame ---------------------------------------------------- */
T.applyMap('kestrel');
T.clearPlatforms();
T.OBSTACLES.length = 0;
const berth = B.chooseBerth({ map: T.MAP, airport: T.AIRPORT, heightAt: T.heightAt });
const dims = { halfWidth: 180, halfLength: 750, deckY: 104, wireFrom: 200, island: { x: 122, z: 115, width: 67, depth: 145 } };
function makeShip() {
  T.clearPlatforms();
  T.OBSTACLES.length = 0;
  const carrier = { name: 'CV-11 Resolute', pos: { x: berth.x, z: berth.z }, headingDeg: 0, deckY: 104, group: new THREE.Group(), wires: { z0: berth.z + 200, z1: berth.z + 560 } };
  T.addPlatform(berth.x, berth.z, 360, 1500, 104, carrier.name, { along: true });
  T.addObstacleAt(berth.x + 122, berth.z + 115, 67, 145, 104, 160, `You flew into ${carrier.name}`);
  UW.install(carrier, dims);
  return carrier;
}
const jet = (x, y, z, vx = 0, vz = 0) => ({ pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(vx, 0, vz), quat: new THREE.Quaternion(), crashed: false });
const localOf = (c, p) => {
  const h = c.headingDeg * D2R;
  const dx = p.x - c.pos.x;
  const dz = p.z - c.pos.z;
  return { x: dx * Math.cos(h) + dz * Math.sin(h), z: -dx * Math.sin(h) + dz * Math.cos(h) };
};
{
  const c = makeShip();
  ok('ship: she has a track on Kestrel, and starts at her berth pointing north', !!c.way.track && c.pos.x === berth.x && c.pos.z === berth.z && c.headingDeg === 0);
  ok('ship: the island became boxes that can turn', c.way.island.length === 5 && T.OBSTACLES.length === 5 && !!T.obstacleAt(berth.x + 122, 130, berth.z + 115) && !!T.obstacleAt(berth.x + 122, 130, berth.z + 115 + 70) && !T.obstacleAt(berth.x + 122, 130, berth.z + 115 + 80) && !T.obstacleAt(berth.x, 130, berth.z));
  // A parked jet, a walker's worth of frames: an hour and a half, round the whole track and more.
  const ac = jet(berth.x + 55, 105.6, berth.z - 600);
  const sim = { aircraft: ac };
  c.sail(1 / 60, sim);
  const l0 = localOf(c, ac.pos);
  let worst = 0;
  let turned = 0;
  let onDeck = true;
  const fwd0 = new THREE.Vector3(0, 0, -1).applyQuaternion(ac.quat);
  for (let i = 0; i < 60 * 90; i++) {
    for (let k = 0; k < 4; k++) c.sail(0.25, sim);
    const l = localOf(c, ac.pos);
    worst = Math.max(worst, Math.hypot(l.x - l0.x, l.z - l0.z));
    turned = Math.max(turned, Math.abs(((c.headingDeg + 180) % 360) - 180));
    if (!T.platformAt(ac.pos.x, ac.pos.z)) onDeck = false;
  }
  ok('frame: a parked jet rides the deck for ninety minutes, round both turns, without drifting', worst < 0.01 && onDeck && turned > 170, `${(worst * 1000).toFixed(3)} mm at worst`);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ac.quat);
  const hdg = (Math.atan2(fwd.x, -fwd.z) / D2R + 360) % 360;
  ok('frame: it turns with the ship', Math.abs((((hdg - c.headingDeg + 540) % 360) - 180)) < 0.01 && fwd0.z === -1, `jet ${hdg.toFixed(2)}, ship ${c.headingDeg.toFixed(2)}`);
  ok('frame: its speed stays the deck\'s — nil — and the air gets the ship\'s', ac.vel.length() < 1e-9 && ac.ride && Math.abs(Math.hypot(ac.ride.x, ac.ride.z) - 7.2) < 0.6, `${ac.ride ? Math.hypot(ac.ride.x, ac.ride.z).toFixed(2) : '?'} m/s over the deck`);
}
{
  // In a turn: the surface is the turned box; the island's boxes are where the island is; a wreck stops her.
  const c = makeShip();
  const w = c.way;
  w.s = w.track.leg + w.track.turn * 0.25; // heading 45 or 315
  c.sail(1 / 60, {});
  const h = c.headingDeg * D2R;
  const at = (lx, lz) => ({ x: c.pos.x + lx * Math.cos(h) - lz * Math.sin(h), z: c.pos.z + lx * Math.sin(h) + lz * Math.cos(h) });
  const inside = [[0, 0], [170, 740], [-170, -740], [170, -740], [-170, 740]].every(([x, z]) => !!T.platformAt(at(x, z).x, at(x, z).z));
  const outside = [[190, 0], [-190, 0], [0, 760], [0, -760], [185, 755]].every(([x, z]) => !T.platformAt(at(x, z).x, at(x, z).z));
  ok('deck: turned 45 degrees, the landing surface is the ship\'s own rectangle', Math.abs(Math.abs(((c.headingDeg + 180) % 360) - 180) - 45) < 1 && inside && outside, `heading ${c.headingDeg.toFixed(1)}`);
  const isl = at(122, 115);
  const islEnd = at(122, 115 + 60);
  const clear = at(0, 115);
  ok('deck: the island is solid along its length, and the deck beside it is not', !!T.obstacleAt(isl.x, 130, isl.z) && !!T.obstacleAt(islEnd.x, 130, islEnd.z) && !T.obstacleAt(clear.x, 130, clear.z));
  // Tilt and heave: the height under a point is the plane the picture is drawn on.
  w.heave = 0.4;
  w.roll = 0.3 * D2R;
  w.pitch = -0.1 * D2R;
  const ride0 = UW.UNDERWAY.response;
  c.sail(0, {});
  c.group.updateMatrixWorld(true);
  let worst = 0;
  for (const [lx, lz] of [[0, 0], [150, 0], [-150, 300], [60, -700], [-170, 740]]) {
    const world = new THREE.Vector3(lx, 104, lz).applyMatrix4(c.group.matrixWorld);
    worst = Math.max(worst, Math.abs(T.heightAt(world.x, world.z) - world.y));
  }
  ok('deck: the surface the wheels meet is the tilted, heaving deck that is drawn (to 2 cm)', worst < 0.02 && UW.UNDERWAY.response === ride0, `${(worst * 100).toFixed(2)} cm`);
  const mid = new THREE.Vector3(0, 104, 0).applyMatrix4(c.group.matrixWorld);
  ok('deck: she tilts about the middle of the deck, so nothing parked slides', Math.hypot(mid.x - c.pos.x, mid.z - c.pos.z) < 1e-6 && Math.abs(mid.y - 104.4) < 1e-6);
  const before = { x: c.pos.x, z: c.pos.z };
  c.sail(1, { aircraft: { ...jet(0, 0, 0), crashed: true } });
  ok('ship: she stops for a wreck', c.pos.x === before.x && c.pos.z === before.z && w.frozen);
  c.sail(1, { aircraft: jet(0, 0, 0) });
  ok('ship: and steams on afterwards', Math.hypot(c.pos.x - before.x, c.pos.z - before.z) > 6);
}
{
  // Joining and leaving the frame: the speed over the sea is conserved.
  const c = makeShip();
  const sim = { aircraft: jet(berth.x + 20, 300, berth.z + 1200, 0, -70) };
  const ac = sim.aircraft;
  const fly = (n, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) {
      c.sail(dt, sim);
      ac.pos.x += ac.vel.x * dt;
      ac.pos.z += ac.vel.z * dt;
    }
  };
  fly(60);
  ok('frame: high over the ship is not on it', !ac._onShip && !ac.ride && ac.vel.z === -70);
  ac.pos.y = 104 + 20;
  const world = () => {
    const d = ac._onShip ? c.deckVelAt(ac.pos.x, ac.pos.z) : { x: 0, z: 0 };
    return Math.hypot(ac.vel.x + d.x, ac.vel.z + d.z);
  };
  let joined = null;
  let left = null;
  let w0 = world();
  let worstStep = 0;
  for (let i = 0; i < 60 * 40; i++) {
    const was = !!ac._onShip;
    fly(1);
    const w1 = world();
    worstStep = Math.max(worstStep, Math.abs(w1 - w0));
    w0 = w1;
    if (!was && ac._onShip) joined = Math.hypot(ac.vel.x, ac.vel.z);
    if (was && !ac._onShip) left = Math.hypot(ac.vel.x, ac.vel.z);
  }
  ok('frame: crossing the ramp low, the jet joins the deck\'s frame at its closing speed', joined != null && Math.abs(joined - (70 - 7.2)) < 0.3, joined == null ? 'never joined' : `${joined.toFixed(2)} m/s against the deck, 70 over the sea`);
  ok('frame: off the bow it leaves again with its speed over the sea back', left != null && Math.abs(left - 70) < 0.05 && !ac.ride, left == null ? 'never left' : `${left.toFixed(2)} m/s`);
  ok('frame: the speed over the sea never steps', worstStep < 1e-6, worstStep.toExponential(2));
  // A jet put on the deck by a reset is at rest on the deck, not sliding aft at the ship's speed.
  const placed = jet(c.pos.x + 55, 105.6, c.pos.z - 600);
  c.sail(1 / 60, { aircraft: placed });
  ok('frame: a jet placed on the deck starts at rest on it', placed._onShip === c && placed.vel.length() === 0);
}

{
  // A flight saved on the deck and resumed later: the ship is put back under the jet.
  let c = makeShip();
  const ac = jet(berth.x + 55, 105.6, berth.z - 600);
  const sim = { aircraft: ac, carrier: c, saveCheckpoint: () => ({ saved: true }) };
  for (let i = 0; i < 60 * 300; i++) c.sail(1 / 60, sim);
  const cp = sim.saveCheckpoint();
  const saved = ac.pos.clone();
  const savedS = c.way.s;
  for (let i = 0; i < 600; i++) c.sail(1 / 60, sim);
  ok('resume: the checkpoint still works, and the ship\'s place is kept beside it', cp && cp.saved === true && !!localStorage.getItem('islandsim.carrierWay.v1') && Math.hypot(saved.x - berth.x, saved.z - berth.z) > 1500);
  // Another day: the world is rebuilt (the ship at her berth) and the jet is put back where it was.
  c = makeShip();
  const back = jet(saved.x, saved.y, saved.z);
  const sim2 = { aircraft: back, carrier: c, saveCheckpoint: () => null };
  ok('resume: without this the saved place would be in mid-air over the sea', !T.platformAt(saved.x, saved.z));
  c.sail(1 / 60, sim2);
  const l = localOf(c, back.pos);
  ok('resume: a flight saved on the deck is resumed on the deck', Math.abs(c.way.s - savedS) < 8 && !!T.platformAt(back.pos.x, back.pos.z) && back._onShip === c && back.vel.length() === 0 && Math.abs(l.x - 55) < 0.2 && Math.abs(l.z + 600) < 0.2, `${l.x.toFixed(2)}, ${l.z.toFixed(2)} on the deck (was 55, -600)`);
  // And a flight that starts anywhere else leaves the ship alone.
  c = makeShip();
  c.sail(1 / 60, { aircraft: jet(0, 50, 0), carrier: c });
  ok('resume: any other start leaves the ship at her berth', Math.hypot(c.pos.x - berth.x, c.pos.z - berth.z) < 1);
  localStorage.removeItem('islandsim.carrierWay.v1');
}

/* 6. a landing on the moving deck ---------------------------------------- */
{
  const c = makeShip();
  const sim = { aircraft: null };
  c.sail(1 / 60, sim);
  // An approach down the angled deck's glideslope at 125 kt over the sea, the hook 1.6 m under the jet.
  const frame = () => DK.frameFor({ pos: c.pos, headingDeg: c.headingDeg, deckY: 104, halfWidth: 180, halfDepth: 750 }, 5);
  let f = frame();
  const lh = f.landingHeadingDeg * D2R;
  const v = 125 / 1.94384;
  const start = DK.atStation(f, f.touchdownS - 900, 0);
  const ac = jet(start.x, 104 + Math.tan(3.5 * D2R) * 900 + 1.6, start.z, Math.sin(lh) * v, -Math.cos(lh) * v);
  sim.aircraft = ac;
  // The ship's own speed down the landing axis is what the jet has to make up.
  const closing0 = v - 7.2 * Math.cos(9 * D2R);
  let caught = null;
  let prevS = null;
  let touched = false;
  let latMax = 0;
  for (let i = 0; i < 60 * 30 && !caught; i++) {
    c.sail(1 / 60, sim);
    f = frame();
    // Fly the ball: hold the hook on the glideslope the lens shows, and the centreline the deck shows.
    const g = DK.glide(f, ac.pos.x, ac.pos.y - 1.6, ac.pos.z);
    const want = 104 + Math.max(0, g.pathH) + 1.6;
    if (!touched) ac.pos.y += (want - ac.pos.y) * 0.2;
    const onDeck = T.platformAt(ac.pos.x, ac.pos.z);
    if (onDeck && ac.pos.y - 1.6 <= onDeck.y + 0.05) {
      touched = true;
      ac.pos.y = onDeck.y + 1.6;
    }
    const rel = Math.hypot(ac.vel.x, ac.vel.z);
    const st = DK.station(f, ac.pos.x, ac.pos.z);
    // Steer out the ship's sideways walk across the angled deck (she steams along her own axis, not the landing one).
    const R = DK.dirWorld(f, f.R.x, f.R.z);
    ac.pos.x -= R.x * st.lat * 0.05;
    ac.pos.z -= R.z * st.lat * 0.05;
    latMax = Math.max(latMax, Math.abs(st.lat));
    if (prevS != null && touched) {
      for (const w of DK.wires(f)) if (prevS < w.s && st.s >= w.s && Math.abs(st.lat) < w.halfSpan) caught = { wire: w.n, v0: rel, inFrame: ac._onShip === c };
    }
    prevS = st.s;
    ac.pos.x += ac.vel.x / 60;
    ac.pos.z += ac.vel.z / 60;
  }
  ok('landing: flown down the ball onto the moving deck, the hook crosses a wire', !!caught && caught.inFrame, caught ? `the ${caught.wire}-wire` : 'no wire');
  ok('landing: the speed the wire takes is the closing speed, not the speed over the sea', !!caught && Math.abs(caught.v0 - closing0) < 0.6 && caught.v0 < v - 6, caught ? `${(caught.v0 * 1.94384).toFixed(1)} kt against the deck, ${(v * 1.94384).toFixed(0)} kt over the sea` : '');
  if (caught) {
    const plan = GEAR.planArrest(caught.v0);
    const stop = GEAR.arrestAt(plan.v0, plan.A, 60);
    ok('landing: and the run-out stops on the deck', stop.stopped && stop.s > 30 && stop.s < 130, `${stop.s.toFixed(0)} m`);
    // The run-out, held along the deck while the ship steams: the jet ends where the wire leaves it, on the ship.
    const A = { start: { x: ac.pos.x, z: ac.pos.z }, dir: { x: ac.vel.x / caught.v0, z: ac.vel.z / caught.v0 } };
    sim.carrierOps = { state: { f: { ...f }, arrest: A, hookNow: null, cat: null }, deck: DK };
    const s0 = DK.station(f, A.start.x, A.start.z);
    const ship0 = { x: c.pos.x, z: c.pos.z };
    for (let i = 0; i < 60 * 20; i++) {
      c.sail(1 / 60, sim);
      const r = GEAR.arrestAt(plan.v0, plan.A, Math.min((i + 1) / 60, 60));
      ac.pos.x = A.start.x + A.dir.x * r.s;
      ac.pos.z = A.start.z + A.dir.z * r.s;
      ac.vel.x = A.dir.x * r.v;
      ac.vel.z = A.dir.z * r.v;
    }
    const s1 = DK.station(frame(), ac.pos.x, ac.pos.z);
    const went = Math.hypot(c.pos.x - ship0.x, c.pos.z - ship0.z);
    ok('landing: the wire\'s run-out is measured along the deck while she steams', Math.abs(Math.hypot(s1.s - s0.s, s1.lat - s0.lat) - stop.s) < 0.05 && Math.abs(s1.lat - s0.lat) < 3 && went > 130 && !!T.platformAt(ac.pos.x, ac.pos.z), `${Math.hypot(s1.s - s0.s, s1.lat - s0.lat).toFixed(2)} m across the deck (planned ${stop.s.toFixed(2)}), ${(s1.lat - s0.lat).toFixed(1)} m of it sideways as the angled deck walks away; the ship ${went.toFixed(0)} m on`);
    const fr = sim.carrierOps.state.f;
    ok('landing: carrier ops\' frame is kept on the ship', Math.abs(fr.cx - c.pos.x) < 1e-9 && Math.abs(fr.cz - c.pos.z) < 1e-9 && fr.headingDeg === c.headingDeg);
  }
}

/* 7. the first load ------------------------------------------------------ */
{
  const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n;]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const seen = new Set();
  const walk = (url) => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    let text = '';
    try {
      text = readFileSync(url, 'utf8');
    } catch {
      return;
    }
    let m;
    while ((m = IMPORT_RE.exec(text))) if (m[1].startsWith('.')) walk(new URL(m[1], url));
  };
  walk(new URL('src/main.js', root));
  const mine = [...seen].filter((k) => /\/(sea-state|carrier-underway)\.js$/.test(k));
  ok('first load: the swell and the ship\'s engine are loaded on demand, not in main.js\'s static graph', mine.length === 0, mine.join(' '));
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  ok('offline: both are in the service worker\'s list', sw.includes("'src/world/sea-state.js'") && sw.includes("'src/world/carrier-underway.js'"));
}

console.log(`\ncarrier-waves: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  FAIL ' + f);
  process.exit(1);
}
