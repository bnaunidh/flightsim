/**
 * Node checks for batch 6, the SCP Foundation models in "Last Flight Out"
 * (src/features/scp-models.js, wired from src/features/scp-escape.js; files
 * baked by tools/real-models/scp.py into assets/models/real/scp/).
 *
 *   node tests/features/scp-models.mjs
 *
 *   - the files: all ten there, small, no images, the credit inside, on the
 *     Credits screen and in LICENSES.md (with the SCP Wiki's CC BY-SA note);
 *     the rigs carry their clips, a walk with its own speed; every model is
 *     stood on the ground at its real size
 *   - lazy: nothing imports scp-models.js statically (scp-escape imports it
 *     when a run is built); the files are not in sw.js's precache
 *   - against the real mission, a fake C-17 and the files read off disk:
 *     the models arrive and are drawn; each SCP is unseen until its sector
 *     goes dark, then out, on the ground, on its own route; the reptile
 *     stays outside the fence and the rest inside; nobody is ever near one;
 *     by the time the breach reaches the strip the ones that walk are at the
 *     end of their routes; 096 never moves and sits; 173 does not move while
 *     it is on screen and does when it is not; the skinned feet are on the
 *     ground in the walk
 *   - the guards and the hazmat suits are posted clear of the queue, the
 *     real models once loaded; Low has fewer; the sealed cart wears the case
 *   - the gunship orbits the Site at its radius and height with the game's
 *     rotor, and leaves when the breach reaches the strip
 *   - THE RULES ARE THE SAME: a seeded run with the models and the same run
 *     without them board, lose sectors and end identically
 * Every check fails on the tree before this file (there is no scp-models.js).
 */
import { readFileSync, existsSync, statSync } from 'node:fs';

const made = [];
global.document = {
  createElement: (tag) => {
    const el = {
      tag, style: {}, children: [], classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } }, hidden: false, textContent: '', innerHTML: '',
      getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4), width: 10 }) }),
      width: 0, height: 0,
      appendChild(c) { this.children.push(c); return c; },
      querySelector() { return made[0] ? Object.assign(document.createElement('x'), { addEventListener() {} }) : null; },
      setAttribute() {}, addEventListener() {}, removeAttribute() {},
    };
    made.push(el);
    return el;
  },
  body: { appendChild() {} },
  head: { appendChild() {} },
  getElementById: () => null,
  documentElement: { classList: { toggle() {}, contains() { return false; } } },
};
const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.window = global.window || { addEventListener() {}, requestAnimationFrame: null };
global.performance = global.performance || { now: () => Date.now() };

const root = new URL('../../', import.meta.url);
const SRC = new URL('src/', root).href;
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const THREE = await import(SRC + 'vendor/three.module.js');
const T = await import(SRC + 'world/terrain.js');
const M = await import(SRC + 'world/maps.js');
const S = await import(SRC + 'world/scenery.js');
const F = await import(SRC + 'world/features.js');
const P = await import(SRC + 'world/pads.js');
const Airport = await import(SRC + 'world/airport.js');
const Ext = await import(SRC + 'game/extensions.js');
const Site = await import(SRC + 'features/scp-site.js');
await import(SRC + 'features/cargo-ramp.js');
const Esc = await import(SRC + 'features/scp-escape.js');
const Missions = await import(SRC + 'game/missions.js');
const RM = await import(SRC + 'aircraft/real-models.js');
const Q = await import(SRC + 'aircraft/model-quality.js');
const { parseGLB } = await import(SRC + 'vehicles/glb.js');
let SM = null;
try {
  SM = await import(SRC + 'features/scp-models.js');
} catch (e) {
  console.log(`FAIL  src/features/scp-models.js does not load — ${e.message}`);
  process.exit(1);
}

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  — ${detail}` : ''}`);
}
const disk = (url) => {
  const b = readFileSync(new URL(url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const tick = () => new Promise((r) => setTimeout(r, 0));

/* ---------------- 1. the files ---------------- */
function glbJson(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + len)));
}
const credits = read('src/ui/credits.js');
const licences = read('assets/models/LICENSES.md');
const IDS = ['scp-173', 'scp-096', 'scp-106', 'scp-682', 'scp-939', 'guard', 'hazmat', 'apache', 'crate-173', 'clipboard'];
ok('all ten batch-6 models are registered', IDS.every((id) => SM.SCP_MODELS[id]) && Object.keys(SM.SCP_MODELS).length === 10);
const REAL_SIZE = { 'scp-173': [1, 1.95, 2.15], 'scp-106': [1, 1.75, 1.95], guard: [1, 1.75, 1.9], hazmat: [1, 1.7, 1.9], 'scp-682': [2, 9.5, 10.5], apache: [0, 14.2, 15.0], clipboard: [2, 0.3, 0.34] };
for (const id of IDS) {
  const e = SM.SCP_MODELS[id];
  const p = `assets/models/real/scp/${e.file}`;
  const there = existsSync(new URL(p, root));
  ok(`${id}: the file is there and under 400 KB`, there && statSync(new URL(p, root)).size < 400 * 1024, there ? `${(statSync(new URL(p, root)).size / 1024).toFixed(0)} KB` : 'missing');
  if (!there) continue;
  const buf = readFileSync(new URL(p, root));
  const j = glbJson(buf);
  ok(`${id}: no images, textures or samplers ship`, !j.images && !j.textures && !j.samplers);
  const rootNode = j.nodes.find((n) => n.name === id);
  const x = rootNode && rootNode.extras;
  ok(`${id}: the credit is in the file (CC BY 4.0, and the SCP Wiki's CC BY-SA 3.0)`, !!x && x.credit.includes(e.url) && x.credit.includes(e.author) && /CC BY 4\.0/.test(x.credit) && /CC BY-SA 3\.0/.test(x.credit));
  ok(`${id}: on the Credits screen and in LICENSES.md`, credits.includes(e.url) && credits.includes(e.author) && licences.includes(e.url) && licences.includes(`real/scp/${e.file}`));
  ok(`${id}: under 11k triangles (the Chromebook budget the batch was picked to)`, x.triangles <= 11000, x.triangles);
  if (REAL_SIZE[id]) {
    const [axis, lo, hi] = REAL_SIZE[id];
    ok(`${id}: its real size (${['width', 'height', 'length'][axis]} ${lo}-${hi} m)`, x.size[axis] >= lo && x.size[axis] <= hi, x.size.join(' x '));
  }
  if (x.skin) {
    const clips = Object.keys(x.skin.clips);
    ok(`${id}: a skin (at most 64 joints) and its clips (${clips.join(', ')})`, x.skin.joints > 0 && x.skin.joints <= 64 && clips.length >= 1);
    if (x.skin.clips.walk) ok(`${id}: the walk carries its own speed (so the feet do not slide)`, x.skin.clips.walk.speed > 0.2 && x.skin.clips.walk.speed < 2.5, x.skin.clips.walk.speed);
  } else {
    let parsed = null;
    try { parsed = parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { warn: () => {} }); } catch (err) { parsed = null; }
    ok(`${id}: read by the game's own GLB reader, vertex-coloured`, !!parsed && !!parsed.scene.getObjectByName(id));
  }
}
ok('096 sits, head bowed (the teen rule) and 106 can rise out of the floor', (() => {
  const j96 = glbJson(readFileSync(new URL('assets/models/real/scp/scp-096.glb', root)));
  const j106 = glbJson(readFileSync(new URL('assets/models/real/scp/scp-106.glb', root)));
  return !!j96.nodes.find((n) => n.name === 'scp-096').extras.skin.clips.sit && !!j106.nodes.find((n) => n.name === 'scp-106').extras.skin.clips.rise;
})());
ok('096 shows no blood (no gore, the teen rule): none of its colours is a red well over its green and blue', (() => {
  const buf = readFileSync(new URL('assets/models/real/scp/scp-096.glb', root));
  const j = glbJson(buf);
  const jl = new DataView(buf.buffer, buf.byteOffset).getUint32(12, true);
  const bin = buf.subarray(28 + jl);
  const prim = j.meshes[0].primitives[0];
  const a = j.accessors[prim.attributes.COLOR_0];
  const v = j.bufferViews[a.bufferView];
  const st = v.byteStride || 3;
  const off = (v.byteOffset || 0) + (a.byteOffset || 0);
  let red = 0;
  for (let i = 0; i < a.count; i++) {
    const r = bin[off + i * st], g = bin[off + i * st + 1], b = bin[off + i * st + 2];
    if (r > 20 && r > 1.6 * Math.max(g, 1) && r > 1.6 * Math.max(b, 1)) red++;
  }
  return a.componentType === 5121 && red === 0;
})());
ok('the Credits screen says SCP Foundation content is CC BY-SA 3.0 next to the models', /SCP Foundation content[^<]*CC BY-SA 3\.0/.test(credits.slice(credits.indexOf('scp-models') > 0 ? credits.indexOf('SCP') : 0)) && /LICENSE/.test(read('LICENSE')) && /SCP FOUNDATION CONTENT/.test(read('LICENSE')));
ok('the README says where the batch-6 models are and when they load', /scp\.py/.test(read('tools/real-models/README.md')) && /Last Flight Out/.test(read('tools/real-models/README.md')));

/* ---------------- 2. lazy ---------------- */
{
  const esc = read('src/features/scp-escape.js');
  const idx = read('src/features/index.js');
  const main = read('src/main.js');
  const sw = read('sw.js');
  ok('scp-escape imports the models module only when a run is built (a dynamic import), nothing else imports it', /import\('\.\/scp-models\.js'\)/.test(esc) && !/^import .*scp-models/m.test(esc) && !/scp-models/.test(idx) && !/scp-models/.test(main));
  ok('the files are not in the precache (fetched when the mission is flown; the cache-first handler keeps them)', !/models\/real\/scp/.test(sw) && sw.includes("'src/features/scp-models.js'"));
}

/* ---------------- 3. the mission, with a fake C-17 ---------------- */
function buildAll(id, quality) {
  const m = M.getMap(id);
  T.applyMap(m);
  T.clearObstacles(); T.clearPlatforms(); P.clearPads();
  Airport.refreshRunways();
  const scene = new THREE.Scene();
  const sim = { scene, settings: { quality }, weather: { isNight: true, time: 'night', turbulenceScale: 1 }, state: 'menu' };
  new S.Scenery(scene, quality);
  new F.MapFeatures(scene, quality);
  Ext.extBuildWorld(sim, THREE);
  return sim;
}
const base = buildAll('nunatak', 'low');
const cfg = T.MAP.scp;
const Y = cfg.yard;
const def = Missions.findMission('last-flight');

function fakeSim(seed, quality = 'high') {
  Q.setModelQuality(quality);
  const sp = Esc.startPose();
  const ac = { pos: new THREE.Vector3(sp.x, T.heightAt(sp.x, sp.z), sp.z), heading: sp.headingDeg, groundSpeed: 0, onGround: true, groundTime: 5, airborneTime: 0, agl: 0, crashed: false, ias: 0, omega: new THREE.Vector3(), vel: new THREE.Vector3() };
  let t = 1;
  let target = 1;
  const cargo = { amount: () => t, get target() { return target; }, set(v) { t = target = v; }, open() { t = target = 1; }, close() { target = 0; t = 0; }, get isOpen() { return t > 0.97; }, get state() { return t > 0.5 ? 'open' : 'closed'; } };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 20000);
  camera.position.set(sp.x, 3000, sp.z + 4000);
  camera.lookAt(sp.x, 3000, sp.z + 8000); // looking away from everything
  camera.updateMatrixWorld();
  const sim = {
    ...base, scene: base.scene, settings: { quality }, camera, aircraft: ac, aircraftType: { id: 'c17', cargoRamp: true }, model: { userData: { cargo } }, hud: { notify() {} }, notify() {},
    speak() {}, audio: null, state: 'flying', modeOpts: { id: 'last-flight', seed }, runner: { def, status: 'running', stepIndex: 0 }, rig: { kick() {} },
    menus: { showDebrief() {} }, restart() {}, quitToMenu() {},
  };
  const ext = Ext.extensions().find((e) => e.id === 'scp-escape');
  const site = Ext.extensions().find((e) => e.id === 'scp-site');
  ext.install(sim);
  site.install(sim);
  site.startMode(sim, 'mission', { id: 'last-flight' });
  let elapsed = 0;
  const ctx = { sim, ac, data: {}, runner: { stepIndex: 0, elapsed: 0, stepElapsed: 0 }, get elapsed() { return elapsed; } };
  def.onStart(ctx);
  ext.startMode(sim, 'mission', { id: 'last-flight' });
  const run = (seconds, dt = 1 / 20, each = null) => {
    for (let x = 0; x < seconds; x += dt) {
      elapsed += dt;
      ext.update(sim, dt);
      site.update(sim, dt);
      camera.updateMatrixWorld();
      if (each && each() === true) return true;
    }
    return false;
  };
  return { sim, ac, cargo, ctx, ext, run, camera };
}

/** Run a seeded mission to `until` seconds, closing the ramp at `closeAt`; what it did, sampled. */
async function story(seed, until, closeAt, models) {
  RM.setRealModels(models);
  const f = fakeSim(seed, 'high');
  // The models module arrives by a dynamic import: let it, before the clock runs.
  f.run(0.05);
  for (let i = 0; i < 100 && !Esc.run().models; i++) await tick();
  const marks = [];
  let n = 0;
  f.run(until, 1 / 20, () => {
    const R = Esc.run();
    if (R.phase === 'boarding' && R.t >= closeAt) Esc.closeRamp(f.sim, 'key');
    if (++n % 40 === 0) marks.push(`${R.t.toFixed(1)}:${R.saved}/${R.cargo}/${R.lost}/${R.stripLost ? 1 : 0}/${R.phase}/${R.walkers.filter((w) => w.state === 'out').length}`);
    return false;
  });
  const st = Esc.escapeState();
  return { marks: marks.join(' '), end: `${st.saved} ${st.cargo} ${st.lost} ${st.stripLost} ${st.failReason}` };
}

SM.setScpModelLoader(disk);
// Without the models first (the switch off: nothing is fetched, nothing drawn).
const without = await story(4242, 175, 150, false);
{
  const R = Esc.run();
  const st = Esc.escapeState();
  ok('the real models switched off: no SCP is drawn, the posted figures are the game\'s own', !!R.models && st.models.scps.length === 0 && st.models.posts.every((p) => !p.real), JSON.stringify(st.models && st.models.status).slice(0, 80));
}
RM.setRealModels(true);
// Load the files (the director asks for them on its first frame; the reads are from disk here).
{
  const f = fakeSim(4242);
  f.run(0.1);
  for (let i = 0; i < 100 && !Esc.run().models; i++) await tick();
  for (const id of IDS) await SM.loadScpModel(id);
  ok('a run imports the models module and every file arrives', !!Esc.run().models && Object.values(SM.scpModelStatus()).every((s) => s === 'ready'), JSON.stringify(SM.scpModelStatus()));
}
const withModels = await story(4242, 175, 150, true);
ok('THE RULES ARE THE SAME: the same seeded run boards, loses its sectors and ends identically with the models and without', withModels.marks === without.marks && withModels.end === without.end, `${withModels.end} | ${without.end}`);

/* ---- the breach, drawn ---- */
{
  const f = fakeSim(9001, 'high');
  const R0 = Esc.run();
  f.run(0.2);
  for (let i = 0; i < 100 && !Esc.run().models; i++) await tick();
  const sched = R0.sched;
  const D = () => Esc.run().models.D;
  f.run(0.2);
  ok('every SCP is made, and none is seen before its sector goes dark', D().scps.length === 5 && D().scps.every((s) => !s.obj.visible), D().scps.map((s) => `${s.id}:${s.obj.visible}`).join(' '));
  const minDist = {};
  const offGround = [];
  const wrongSide = [];
  const seenOut = {};
  let s096 = null;
  const stand = new THREE.Vector3();
  const inYard = (x, z) => x > Y.x0 && x < Y.x1 && z > Y.z0 && z < Y.z1;
  const endAt = sched.stripLostAt + 1;
  f.run(endAt - Esc.run().t, 1 / 20, () => {
    const R = Esc.run();
    for (const s of D().scps) {
      if (!s.obj.visible && s.mode !== 'under') {
        if (R.t < sched.sectors[s.spec.sector].at - 0.1 && s.out) wrongSide.push(`${s.id} out early`);
        continue;
      }
      if (!s.out) continue;
      seenOut[s.id] = seenOut[s.id] || R.t;
      const p = s.obj.position;
      // (682, ten metres long on the open snow, lies along the slope: its middle at most a little under the ground there.)
      const gyy = T.heightAt(p.x, p.z);
      if (s.id === 'scp-682' ? !(p.y <= gyy + 0.05 && gyy - p.y < 0.8) : Math.abs(p.y - gyy) > 0.05) offGround.push(`${s.id} ${(p.y - gyy).toFixed(2)}`);
      const inside = inYard(p.x, p.z);
      if (s.id === 'scp-682' ? inside : !inside) wrongSide.push(`${s.id} at ${p.x.toFixed(0)},${p.z.toFixed(0)}`);
      for (const w of R.walkers) {
        if (w.state !== 'out' && w.state !== 'turned') continue;
        const d = Math.hypot(w.x - p.x, w.z - p.z);
        minDist[s.id] = Math.min(minDist[s.id] ?? Infinity, d);
      }
      if (s.id === 'scp-096') {
        if (!s096) s096 = stand.copy(p).clone();
        else if (s096.distanceTo(p) > 0.01) wrongSide.push('096 moved');
      }
    }
    return false;
  });
  const R = Esc.run();
  ok('each SCP came out when its own sector went dark (A 682, B 939, C 106, E 096, F 173)', SM.BREACH.every((b) => seenOut[b.id] != null && Math.abs(seenOut[b.id] - sched.sectors[b.sector].at) < 0.2),
    SM.BREACH.map((b) => `${b.id} ${seenOut[b.id] != null ? seenOut[b.id].toFixed(1) : '-'} / ${sched.sectors[b.sector].at}`).join(', '));
  ok('…every one stands on the ground, the reptile outside the fence and the rest inside; none came out early; 096 never moved', offGround.length === 0 && wrongSide.length === 0, [...offGround, ...wrongSide].slice(0, 5).join('; '));
  ok('…and nobody was ever near one (nobody is shown being caught: they stand still while anybody is close)', Object.values(minDist).every((d) => d > 12), Object.entries(minDist).map(([k, d]) => `${k} ${d.toFixed(0)} m`).join(', '));
  const byId = Object.fromEntries(D().scps.map((s) => [s.id, s]));
  ok('when the breach reached the strip, 939 and 173 were at the ends of their routes, 682 most of the way round', byId['scp-939'].s > byId['scp-939'].length - 2 && byId['scp-173'].s > byId['scp-173'].length - 2 && byId['scp-682'].s > byId['scp-682'].length * 0.75,
    ['scp-939', 'scp-173', 'scp-682', 'scp-106'].map((k) => `${k} ${byId[k].s.toFixed(0)}/${byId[k].length.toFixed(0)}`).join(', '));
  ok('…no faster than its own pace (no SCP skates across the yard)', (() => {
    const a = byId['scp-682'];
    return a.s <= SM.BREACH[0].pace * (R.t - sched.sectors[0].at) + 0.5;
  })());
  ok('096 sits (its clip), its back to the strip', byId['scp-096'].inst.clip === 'sit' && Math.abs(byId['scp-096'].obj.rotation.y - Math.PI / 2) < 1e-6);
  ok('the stripLost moment is the mission\'s own (the models moved nothing)', R.stripLost && Math.abs(R.stripLostAt - sched.stripLostAt) < 0.06);
}

/* ---- 173: looked at, it stands ---- */
{
  const f = fakeSim(5150, 'high');
  f.run(0.2);
  for (let i = 0; i < 100 && !Esc.run().models; i++) await tick();
  Esc.__escape.loseThrough(5);
  Esc.__escape.stripIn(40);
  f.run(0.5);
  const s = Esc.run().models.D.scps.find((x) => x.id === 'scp-173');
  // Look straight at it.
  f.camera.position.set(s.obj.position.x + 30, s.obj.position.y + 10, s.obj.position.z + 30);
  f.camera.lookAt(s.obj.position);
  f.camera.updateMatrixWorld();
  const a = s.s;
  f.run(10);
  const b = s.s;
  // And away.
  f.camera.lookAt(s.obj.position.x + 400, s.obj.position.y + 300, s.obj.position.z + 400);
  f.camera.updateMatrixWorld();
  f.run(10);
  const c = s.s;
  ok('173 does not move while it is on screen, and does when it is not', b === a && c > b + 2, `${a.toFixed(1)} → ${b.toFixed(1)} (watched) → ${c.toFixed(1)} (not)`);
}

/* ---- the skin: feet on the ground, bones sane ---- */
{
  const f = fakeSim(321, 'high');
  f.run(0.2);
  for (let i = 0; i < 100 && !Esc.run().models; i++) await tick();
  Esc.__escape.loseThrough(1);
  f.run(6);
  const s = Esc.run().models.D.scps.find((x) => x.id === 'scp-939');
  const mesh = s.inst.mesh;
  s.obj.updateMatrixWorld(true);
  mesh.skeleton.update();
  const v = new THREE.Vector3();
  let lo = Infinity;
  let finite = true;
  const pos = mesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 3) {
    v.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    if (!Number.isFinite(v.y)) finite = false;
    lo = Math.min(lo, v.y);
  }
  const gy = T.heightAt(s.obj.position.x, s.obj.position.z);
  ok('939 walking: its skinned feet are on the ground (not floating, not sunk) and every bone is finite', finite && Math.abs(lo - gy) < 0.12 && s.inst.clip === 'walk', `lowest ${(lo - gy).toFixed(3)} m, clip ${s.inst.clip}, rate ${s.inst.rate.toFixed(2)}`);
}

/* ---- the guards, the suits, the case, the cart ---- */
for (const q of ['low', 'high']) {
  const f = fakeSim(77, q);
  f.run(0.2);
  for (let i = 0; i < 100 && !Esc.run().models; i++) await tick();
  f.run(1);
  const st = Esc.escapeState().models;
  const want = SM.POSTED[q];
  const guards = st.posts.filter((p) => p.kind === 'guard');
  const suits = st.posts.filter((p) => p.kind === 'hazmat');
  ok(`${q}: ${want[0] + want[1]} guards and ${want[2]} hazmat suits posted, the real models now`, guards.length === want[0] + want[1] && suits.length === want[2] && st.posts.every((p) => p.real), st.posts.map((p) => `${p.kind}${p.real ? '' : '(own)'}`).join(' '));
  const geom = Site.rampOf(f.sim);
  const ax = geom.foot.x - geom.hinge.x;
  const az = geom.foot.z - geom.hinge.z;
  const L = Math.hypot(ax, az);
  const lateral = (p) => Math.abs(((p.x - geom.foot.x) * -az + (p.z - geom.foot.z) * ax) / L);
  ok(`${q}: every one at the ramp stands clear of the queue's line (over 4 m to the side of it)`, st.posts.filter((p) => Math.hypot(p.x - geom.foot.x, p.z - geom.foot.z) < 40).every((p) => lateral(p) > 4), st.posts.map((p) => lateral(p).toFixed(1)).join(' '));
}
{
  const f = fakeSim(12, 'high');
  f.run(0.2);
  for (let i = 0; i < 100 && !Esc.run().models; i++) await tick();
  let dressed = false;
  f.run(60, 1 / 20, () => {
    const R = Esc.run();
    for (const c of R.carts) if (c.state === 'out' && c.kind === 'sealed' && c.cartRef && c.cartRef.mesh.getObjectByName('lfo-case')) dressed = true;
    return dressed;
  });
  const kase = Esc.run().carts.map((c) => c.cartRef && c.cartRef.mesh.getObjectByName('lfo-case')).find(Boolean);
  ok('…the case at its own proportions (uniform scale, not squashed into the cart\'s box), standing on the ground', !!kase && Math.abs(kase.scale.x - kase.scale.y) < 1e-9 && Math.abs(kase.scale.z - kase.scale.y) < 1e-9 && Math.abs(kase.position.y + 0.475) < 1e-9,
    kase ? kase.scale.toArray().map((v) => v.toFixed(2)).join(' x ') : 'none');
  ok('the sealed cart carries the containment case (its own box hidden under it); the other carts keep their boxes', dressed && Esc.run().carts.filter((c) => c.state === 'out' && c.kind !== 'sealed' && c.cartRef).every((c) => !c.cartRef.mesh.getObjectByName('lfo-case')));
  const staff = Esc.run().pool.filter((p) => p.kind === 'sitestaff' && p.busy);
  ok('some of the Site staff carry a clipboard', staff.some((p) => p.p.getObjectByName('lfo-clipboard')), `${staff.length} staff out`);
}

/* ---- the gunship ---- */
{
  const f = fakeSim(66, 'high');
  f.run(0.2);
  for (let i = 0; i < 100 && !Esc.run().models; i++) await tick();
  f.run(20);
  const G = Esc.run().models.D.gunship;
  const p = G.obj.position;
  const r = Math.hypot(p.x - cfg.cx, p.z - cfg.cz);
  const agl = p.y - T.heightAt(cfg.cx, cfg.cz);
  ok('the gunship orbits the Site at its radius and height, banked into the turn, the game\'s rotor on its hub (its own hidden)', Math.abs(r - SM.ORBIT.r) < 1 && Math.abs(agl - SM.ORBIT.agl) < 1 && G.obj.rotation.z < -0.2 && !!G.rotor && !G.obj.getObjectByName('rotor').visible,
    `r ${r.toFixed(0)}, ${agl.toFixed(0)} m up, bank ${G.obj.rotation.z.toFixed(2)}, rotor ${!!G.rotor}`);
  // Its nose along its path: the next second's position is ahead of it.
  const a = p.clone();
  f.run(1);
  const vel = G.obj.position.clone().sub(a);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(G.obj.quaternion);
  ok('…flying nose first', vel.normalize().dot(fwd) > 0.9, vel.dot(fwd).toFixed(2));
  ok('…not solid, never firing: no obstacle, no sky body, no weapon in the module', !/addObstacleAt|registerBody|fire\(|missile/i.test(read('src/features/scp-models.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
  Esc.__escape.stripIn(0);
  f.run(30);
  const q = G.obj.position;
  ok('when the breach reaches the strip it leaves, to the south-west', G.leaving && q.x < a.x && Math.hypot(q.x - cfg.cx, q.z - cfg.cz) > SM.ORBIT.r + 300, `${q.x.toFixed(0)},${q.z.toFixed(0)}`);
}

/* ---- 106 sinks back through the floor (its rising clip, backwards), and rises again ---- */
{
  const f = fakeSim(9001, 'high');
  f.run(0.2);
  for (let i = 0; i < 100 && !Esc.run().models; i++) await tick();
  f.run(0.2);
  const R0 = Esc.run();
  const s = R0.models.D.scps.find((x) => x.id === 'scp-106');
  let sinks = 0;
  let wrong = '';
  let rises = 0;
  let was = '';
  f.run(R0.sched.stripLostAt - R0.t, 1 / 20, () => {
    if (s.mode === 'sink' && s.obj.visible && s.modeT > 0.1 && !(s.inst.clip === 'rise' && s.inst.rate < 0)) wrong = wrong || `${s.inst.clip} at rate ${s.inst.rate.toFixed(1)}`;
    if (s.mode !== was) {
      if (s.mode === 'sink') sinks++;
      if (s.mode === 'rise') rises++;
      was = s.mode;
    }
    return false;
  });
  ok('106 sinks into the yard with its own clip run backwards (not its idle), then rises again further on', sinks >= 1 && rises >= 2 && !wrong, `${sinks} sinks, ${rises} rises${wrong ? `, sank playing ${wrong}` : ''}`);
}

/* ---------------- 4. teardown ---------------- */
{
  const f = fakeSim(8, 'high');
  f.run(0.2);
  for (let i = 0; i < 100 && !Esc.run().models; i++) await tick();
  f.run(1);
  const D0 = Esc.run().models.D;
  const g = D0.group;
  // What the run made for itself (the gunship's rotor, each rig's bone texture) is freed; the shared models are not.
  const freed = new Set();
  const watch = (x, tag) => x && x.addEventListener('dispose', () => freed.add(tag));
  const disc = D0.gunship && D0.gunship.rotor && D0.gunship.rotor.disc;
  watch(disc && disc.geometry, 'disc');
  const rig = D0.scps.find((x) => x.inst);
  watch(rig && rig.inst.mesh.skeleton.boneTexture, 'bones');
  if (rig && !rig.inst.mesh.skeleton.boneTexture) { const sk = rig.inst.mesh.skeleton; const was = sk.dispose.bind(sk); sk.dispose = () => { freed.add('bones'); was(); }; }
  const shared = D0.scps.find((x) => !x.inst);
  watch(shared && shared.obj.children[0].geometry, 'shared');
  f.ext.stop(f.sim);
  ok('the run ends: the models leave the scene with it', !g.parent);
  ok('…the gunship\'s rotor and the rigs\' bones are freed (restarting leaks nothing), the shared models kept for the next run', freed.has('disc') && freed.has('bones') && !freed.has('shared'), [...freed].join(' '));
}

console.log(`\nscp-models: ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
