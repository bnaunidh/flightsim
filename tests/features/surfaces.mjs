/**
 * Node checks for the buildings / textures / reflections lane:
 * `node tests/features/surfaces.mjs`.
 *
 *   1. render/surfaces.js — the tier contract. Low's glass and metal carry
 *      the analytic sky (onBeforeCompile + a cache key), no normal map on
 *      metal and no roughness map on the tarmac; Medium and up carry none of
 *      that and lean on scene.environment (envMapIntensity >= 1 on glass).
 *   2. Wetness: rain soaks the field over ~30 s and it dries over minutes;
 *      a wet runway is darker, glossier (roughness ~0.3) and reflects more;
 *      dry again it is exactly what it was.
 *   3. The glint: strong at a clear sunset, none at noon, none at night,
 *      and cloud kills it; registered glass follows it.
 *   4. resetSurfaces() drops the registry (a rebuilt world starts clean).
 *   5. render/textures.js — the tier sizes: High/Ultra draw the runway, the
 *      apron, the facades and the cladding at twice the pixels; Low/Medium
 *      keep 512; changing tier drops the other size from the cache and the
 *      tier-free textures (normals) are shared. The night facade map exists
 *      for every variant and every new texture is in warmTextures.
 *   6. scenery.js addRooftopDetail — instanced, at most four meshes, more
 *      pieces as the tier rises, nothing on Low but AC units, every piece on
 *      a block or a tower roof (never below the eaves), bounded and culled.
 *   7. The world's wiring: the airport registers its runway and pavement as
 *      wet surfaces and its cladding as metal; the terminal's glass and the
 *      town's towers are glass; the block walls carry a night map and are
 *      in the town's nightMats.
 *
 * Exits non-zero on any failure.
 */

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.window = global.window || { addEventListener() {}, devicePixelRatio: 1 };

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const SF = await import(SRC + 'render/surfaces.js');
const TX = await import(SRC + 'render/textures.js');

let pass = 0;
const fails = [];
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail && !cond ? ` — ${detail}` : ''}`);
}

/** A weather stand-in with what surfaces.js reads. */
function weather({ rain = 0, cloud = 0.16, sunElev = 62, night = false } = {}) {
  return {
    cond: { rain, cloud },
    timeInfo: { sunElev },
    isNight: night,
    palette: () => ({ top: new THREE.Color(0x2f6fd0), horizon: new THREE.Color(0xbcd7f2), sun: new THREE.Color(0xfff4e0) }),
    sunDirection: (v) => v.set(0.3, Math.sin((sunElev * Math.PI) / 180), 0.3).normalize(),
  };
}

/* 1. the tier contract ---------------------------------------------- */
for (const tier of ['low', 'medium', 'high', 'ultra']) {
  SF.resetSurfaces(tier);
  ok(`surfaces: tier ${tier} is set`, SF.surfaceTier() === tier);
  ok(`surfaces: ${tier} ${tier === 'low' ? 'has no' : 'has an'} environment map`, SF.surfacesHaveEnvMap() === (tier !== 'low'));
  const g = SF.glassMaterial({});
  const m = SF.metalMaterial({ normalMap: TX.claddingNormal() });
  const w = SF.registerWetSurface(new THREE.MeshStandardMaterial({ roughness: 0.9 }), { puddles: TX.puddleRoughness() });
  if (tier === 'low') {
    ok('surfaces: Low glass carries the fake sky', typeof g.onBeforeCompile === 'function' && g.userData.fakeSky > 0 && /fakeSky/.test(g.customProgramCacheKey()));
    ok('surfaces: Low metal carries the fake sky, weaker, with its own program', m.userData.fakeSky > 0 && m.userData.fakeSky < g.userData.fakeSky && m.customProgramCacheKey() !== g.customProgramCacheKey());
    ok('surfaces: Low metal has no normal map', !m.normalMap);
    ok('surfaces: Low tarmac has no puddle map', !w.roughnessMap);
    ok('surfaces: Low tarmac keeps the stock shader (its pixels are the frame)', w.userData.fakeSky === undefined && w.onBeforeCompile === THREE.MeshStandardMaterial.prototype.onBeforeCompile);
    // The shader hook writes the uniforms and the sky term in.
    const shader = { uniforms: {}, fragmentShader: '#include <common>\nvoid main(){\n#include <opaque_fragment>\n}' };
    g.onBeforeCompile(shader);
    ok('surfaces: the fake-sky hook adds its uniforms and its code', shader.uniforms.uFakeZenith === SF.FAKE_SKY.uFakeZenith && /uFakeStrength/.test(shader.fragmentShader) && /outgoingLight \+= fakeRefl/.test(shader.fragmentShader) && shader.fragmentShader.indexOf('fakeRefl') < shader.fragmentShader.indexOf('#include <opaque_fragment>'));
  } else {
    ok(`surfaces: ${tier} glass has no fake sky and reflects the environment`, g.onBeforeCompile === THREE.MeshStandardMaterial.prototype.onBeforeCompile && g.userData.fakeSky === undefined && g.envMapIntensity >= 1);
    ok(`surfaces: ${tier} glass is glossy`, g.roughness <= 0.15 && g.metalness >= 0.5);
    ok(`surfaces: ${tier} metal carries its normal map`, m.normalMap === TX.claddingNormal());
    ok(`surfaces: ${tier} tarmac carries the puddle map`, w.roughnessMap === TX.puddleRoughness());
  }
  ok(`surfaces: ${tier} glass with opacity < 1 is transparent`, SF.glassMaterial({ opacity: 0.5 }).transparent === true && g.transparent === false);
}
ok('surfaces: High reflects a little harder than Medium, Ultra harder still', (() => {
  SF.resetSurfaces('medium'); const a = SF.glassMaterial({}).envMapIntensity;
  SF.resetSurfaces('high'); const b = SF.glassMaterial({}).envMapIntensity;
  SF.resetSurfaces('ultra'); const c = SF.glassMaterial({}).envMapIntensity;
  return a < b && b < c;
})());

/* 2. wetness --------------------------------------------------------- */
{
  SF.resetSurfaces('high');
  SF.setFieldWetness(0);
  const rw = SF.registerWetSurface(new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.02, color: 0x45484c }), { puddles: TX.puddleRoughness() });
  const base = { roughness: rw.roughness, metalness: rw.metalness, color: rw.color.getHex(), env: rw.envMapIntensity };
  const rain = weather({ rain: 1, cloud: 1 });
  for (let i = 0; i < 10; i++) SF.updateSurfaces(rain, 1);
  const w10 = SF.fieldWetness();
  ok('wet: ten seconds of rain soaks it about a third', w10 > 0.25 && w10 < 0.4, `${w10}`);
  for (let i = 0; i < 60; i++) SF.updateSurfaces(rain, 1);
  ok('wet: a minute of storm soaks it through', SF.fieldWetness() === 1);
  ok('wet: the wet runway is darker, glossier and reflects more', rw.roughness < 0.35 && rw.metalness > base.metalness && rw.envMapIntensity > base.env && rw.color.getHex() < base.color, `${rw.roughness} ${rw.metalness} ${rw.envMapIntensity}`);
  const half = weather({ rain: 0.55, cloud: 0.85 });
  for (let i = 0; i < 400; i++) SF.updateSurfaces(half, 1);
  ok('wet: it dries down to the rain that is falling, not past it', Math.abs(SF.fieldWetness() - 0.55) < 1e-6, `${SF.fieldWetness()}`);
  const dry = weather();
  for (let i = 0; i < 60; i++) SF.updateSurfaces(dry, 1);
  ok('wet: a minute of sun has not dried it (it takes minutes)', SF.fieldWetness() > 0.2 && SF.fieldWetness() < 0.55, `${SF.fieldWetness()}`);
  for (let i = 0; i < 400; i++) SF.updateSurfaces(dry, 1);
  ok('wet: dry again, the runway is exactly what it was', SF.fieldWetness() === 0 && rw.roughness === base.roughness && rw.metalness === base.metalness && rw.color.getHex() === base.color && rw.envMapIntensity === base.env);
  ok('wet: a bad dt neither soaks nor dries', (() => { SF.setFieldWetness(0.5); SF.updateSurfaces(rain, NaN); SF.updateSurfaces(rain, -1); return SF.fieldWetness() === 0.5; })());
  SF.setFieldWetness(0);
}

/* 3. the glint ------------------------------------------------------- */
{
  SF.resetSurfaces('high');
  const g = SF.glassMaterial({});
  const base = g.envMapIntensity;
  SF.updateSurfaces(weather({ sunElev: 62 }), 1 / 60);
  ok('glint: none at noon', SF.sunGlint() === 0 && g.envMapIntensity === base);
  SF.updateSurfaces(weather({ sunElev: 4.5 }), 1 / 60);
  const sunset = SF.sunGlint();
  ok('glint: a clear sunset glints', sunset > 0.7 && g.envMapIntensity > base * 1.5, `${sunset} ${g.envMapIntensity}`);
  SF.updateSurfaces(weather({ sunElev: 4.5, cloud: 1 }), 1 / 60);
  ok('glint: an overcast sunset does not', SF.sunGlint() < 0.15, `${SF.sunGlint()}`);
  SF.updateSurfaces(weather({ sunElev: -14, night: true }), 1 / 60);
  ok('glint: none at night', SF.sunGlint() === 0 && g.envMapIntensity === base);
  // A material made while the sun is low starts glinting, not a beat later.
  SF.updateSurfaces(weather({ sunElev: 4.5 }), 1 / 60);
  const late = SF.glassMaterial({});
  ok('glint: glass made at sunset is already glinting', late.envMapIntensity > late.userData.surface.envMapIntensity * 1.5);
  // Low: the shared uniforms follow the weather.
  SF.resetSurfaces('low');
  SF.updateSurfaces(weather({ sunElev: 4.5 }), 1);
  ok('glint: Low writes the glint and the sun into the shared uniforms', SF.FAKE_SKY.uFakeGlint.value > 0.7 && SF.FAKE_SKY.uFakeSunDir.value.y > 0 && SF.FAKE_SKY.uFakeSunDir.value.y < 0.2 && SF.FAKE_SKY.uFakeNight.value === 0);
  SF.updateSurfaces(weather({ sunElev: -14, night: true }), 1);
  ok('glint: Low knows it is night', SF.FAKE_SKY.uFakeNight.value === 1);
}

/* 4. the registry ---------------------------------------------------- */
{
  SF.resetSurfaces('high');
  SF.glassMaterial({});
  SF.metalMaterial({});
  SF.registerWetSurface(new THREE.MeshStandardMaterial());
  const c = SF.surfaceCounts();
  ok('registry: counts what was made', c.glass === 1 && c.metal === 1 && c.wet === 1, JSON.stringify(c));
  SF.resetSurfaces();
  const d = SF.surfaceCounts();
  ok('registry: resetSurfaces() empties it and keeps the tier', d.glass === 0 && d.metal === 0 && d.wet === 0 && SF.surfaceTier() === 'high');
}

/* 5. the texture tiers ----------------------------------------------- */
{
  TX.setTextureTier('low');
  const lowRunway = TX.runwayTexture();
  const lowAsphalt = TX.asphaltTexture();
  const lowBldg = TX.buildingTexture(0);
  const nrmLow = TX.asphaltNormal();
  ok('textures: Low draws at 1x', TX.texScale() === 1 && lowRunway.image.width === 512 && lowRunway.image.height === 1536 && lowAsphalt.image.width === 512 && lowBldg.image.width === 512);
  TX.setTextureTier('medium');
  ok('textures: Medium keeps Low\'s sizes (the same textures)', TX.texScale() === 1 && TX.runwayTexture() === lowRunway);
  TX.setTextureTier('high');
  const hiRunway = TX.runwayTexture();
  ok('textures: High draws the runway at 1024 x 3072', TX.texScale() === 2 && hiRunway !== lowRunway && hiRunway.image.width === 1024 && hiRunway.image.height === 3072);
  ok('textures: High draws the apron, the facades and the cladding at 1024', TX.asphaltTexture().image.width === 1024 && TX.buildingTexture(1).image.width === 1024 && TX.hangarTexture().image.width === 1024 && TX.roofTexture().image.width === 1024 && TX.buildingNightTexture(1).image.width === 1024);
  ok('textures: the tier-free maps are shared across tiers', TX.asphaltNormal() === nrmLow && TX.claddingNormal() === TX.claddingNormal() && TX.puddleRoughness().colorSpace !== THREE.SRGBColorSpace);
  TX.setTextureTier('ultra');
  ok('textures: Ultra is High\'s size', TX.texScale() === 2 && TX.runwayTexture() === hiRunway);
  TX.setTextureTier('low');
  const lowAgain = TX.runwayTexture();
  ok('textures: back on Low the High runway is dropped and a 512 one drawn', lowAgain !== hiRunway && lowAgain !== lowRunway && lowAgain.image.width === 512);
  ok('textures: junk keeps High', (() => { TX.setTextureTier('potato'); return TX.textureTier() === 'high' && TX.texScale() === 2; })());
  for (const v of [0, 1, 2, 3]) ok(`textures: night facade ${v} exists and is sRGB`, TX.buildingNightTexture(v).colorSpace === THREE.SRGBColorSpace);
  ok('textures: the runway keeps its anisotropy', TX.runwayTexture().anisotropy >= 8);
  ok('textures: the cladding normal is tangent space (linear)', TX.claddingNormal().colorSpace !== THREE.SRGBColorSpace);
  const warmed = [];
  await TX.warmTextures((p, label) => warmed.push(label));
  ok('textures: warmTextures paints the new ones', ['Puddles', 'Lit windows', 'Hangar cladding', 'Apron concrete'].every((l) => warmed.includes(l)), warmed.join(','));
}

/* 6. rooftop detail -------------------------------------------------- */
{
  const S = await import(SRC + 'world/scenery.js');
  const plan = [];
  // Six blocks and two towers on flat ground, each with its own frame.
  for (let i = 0; i < 6; i++) plan.push({ kind: 'block', s: { x: i * 40, y: 10, z: 0, rot: i * 0.7 }, w: 18 + i * 2, d: 14 + i, h: 12 + i * 3, q: (i * 0.37) % 1, q2: (i * 0.61) % 1 });
  for (let i = 0; i < 2; i++) plan.push({ kind: 'tower', s: { x: 300 + i * 60, y: 10, z: 50, rot: 0.3 }, w: 22, d: 22, h: 60 + i * 20, q: 0.4 + i * 0.3, q2: 0.2 });
  plan.push({ kind: 'house', s: { x: 500, y: 10, z: 0, rot: 0 }, w: 9, d: 8, h: 5, q: 0.1, q2: 0.1 });
  const top = (b) => b.s.y + b.h;
  const counts = {};
  const per = {};
  for (const tier of ['low', 'medium', 'high', 'ultra']) {
    SF.resetSurfaces(tier);
    const g = new THREE.Group();
    const r = S.addRooftopDetail(g, plan, { quality: tier, name: 'town', top });
    counts[tier] = r.ac + r.tanks + r.vents + r.masts;
    per[tier] = r;
    const meshes = [];
    g.traverse((o) => { if (o.isMesh) meshes.push(o); });
    ok(`rooftops: ${tier} draws in at most four instanced meshes (${meshes.length})`, meshes.length <= 4 && meshes.every((m) => m.isInstancedMesh && /^town-rooftop-/.test(m.name) && m.frustumCulled && m.boundingSphere && m.boundingSphere.radius > 0));
    // Every instance stands on a roof: at or over the eaves of some block or
    // tower, inside its footprint (plus the unit's own size).
    let off = 0;
    const m4 = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const m of meshes) {
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, m4);
        p.setFromMatrixPosition(m4);
        const on = plan.some((b) => {
          if (b.kind === 'house') return false;
          const T = top(b);
          const cr = Math.cos(b.s.rot), sr = Math.sin(b.s.rot);
          const dx = p.x - b.s.x, dz = p.z - b.s.z;
          const lx = cr * dx - sr * dz;
          const lz = sr * dx + cr * dz;
          return p.y >= T - 1e-6 && Math.abs(lx) <= b.w / 2 + 0.1 && Math.abs(lz) <= b.d / 2 + 0.1;
        });
        if (!on) off++;
      }
    }
    ok(`rooftops: ${tier} plants every piece on a block or tower roof`, off === 0, `${off} off`);
  }
  ok('rooftops: Low has AC units only', per.low.ac > 0 && per.low.tanks === 0 && per.low.vents === 0 && per.low.masts === 0);
  ok('rooftops: Medium adds tanks, vents and masts', per.medium.vents > 0 && per.medium.masts > 0);
  ok('rooftops: more with every tier', counts.low < counts.medium && counts.medium < counts.high && counts.high <= counts.ultra, JSON.stringify(counts));
  ok('rooftops: nothing on a house', (() => {
    const g = new THREE.Group();
    const r = S.addRooftopDetail(g, [plan[plan.length - 1]], { quality: 'ultra', name: 't', top });
    return r.ac + r.tanks + r.vents + r.masts === 0 && g.children.length === 0;
  })());
}

/* 7. the world's wiring ---------------------------------------------- */
{
  const T = await import(SRC + 'world/terrain.js');
  const M = await import(SRC + 'world/maps.js');
  const AP = await import(SRC + 'world/airport.js');
  const APR = await import(SRC + 'world/apron.js');
  const S = await import(SRC + 'world/scenery.js');
  const R = await import(SRC + 'world/roads.js');
  const def = M.getMap('kestrel');
  T.applyMap(def.id);
  if (R.layRoads) try { R.layRoads(); } catch { /* the roads are not what is tested */ }
  AP.refreshRunways();
  APR.refreshApronElevation();
  for (const tier of ['low', 'high']) {
    SF.resetSurfaces(tier);
    TX.setTextureTier(tier);
    const scene = new THREE.Scene();
    const ap = new AP.Airport(scene);
    const c1 = SF.surfaceCounts();
    ok(`wiring ${tier}: the airfield registers its runway, shoulders and pavement as wet surfaces`, c1.wet >= 3 && ap.runwayMat.userData.surface && ap.runwayMat.userData.surface.kind === 'wet', JSON.stringify(c1));
    ok(`wiring ${tier}: the runway's puddle map is ${tier === 'low' ? 'absent' : 'present'}`, !!ap.runwayMat.roughnessMap === (tier !== 'low'));
    if (tier !== 'low') {
      // The runway's UVs span its whole length: the square puddle tile has to
      // repeat along it, or every puddle is a streak 100+ m long.
      const pr = ap.runwayMat.roughnessMap;
      const rw = T.AIRPORT.runway;
      const along = rw.length / pr.repeat.y; // metres of runway per tile
      const across = (rw.halfWidth * 2) / pr.repeat.x;
      ok(`wiring ${tier}: the runway's puddles are not stretched down its length (tile ${across.toFixed(0)} x ${along.toFixed(0)} m)`, pr.repeat.y > 1 && along / across >= 1.5 && along / across <= 5, `${across.toFixed(1)} x ${along.toFixed(1)}`);
      ok(`wiring ${tier}: the runway's puddle copy shares the tile's image (no second canvas)`, pr.source === TX.puddleRoughness().source && pr !== TX.puddleRoughness());
    }
    ok(`wiring ${tier}: the hangars' cladding is reflective metal`, ap.mats.clad.userData.surface && ap.mats.clad.userData.surface.kind === 'metal' && (tier === 'low' ? !ap.mats.clad.normalMap : ap.mats.clad.normalMap === TX.claddingNormal()));
    ok(`wiring ${tier}: the tower cab is glass`, c1.glass >= 1);
    ok(`wiring ${tier}: the offices' windows light up with the field`, ap.mats.wall.emissiveMap && ap.mats.wall.emissiveIntensity === 0 && (ap.setLightsOn(true), ap.mats.wall.emissiveIntensity > 1) && (ap.setLightsOn(false), ap.mats.wall.emissiveIntensity === 0));
    const apr = new APR.Apron(scene, tier);
    ok(`wiring ${tier}: the terminal's curtain wall is glass with its night map`, apr.glassMat && apr.glassMat.userData.surface && apr.glassMat.userData.surface.kind === 'glass' && apr.glassMat.emissiveMap);
    ok(`wiring ${tier}: the terminal's offices carry a night map`, apr.mats.wall.emissiveMap && apr.mats.wall.emissiveIntensity === 0);
    const sc = new S.Scenery(scene, tier);
    const town = sc.town;
    const blockMats = [];
    sc.group.traverse((o) => { if (o.isMesh && /-block-walls$/.test(o.name)) blockMats.push(o.material); });
    ok(`wiring ${tier}: the town's block walls carry a night map and are in nightMats`, blockMats.length > 0 && blockMats.every((m) => m.emissiveMap && town.nightMats.includes(m)));
    ok(`wiring ${tier}: the town has rooftop detail`, town.rooftops && town.rooftops.ac > 0 && town.rooftops.meshes.length <= 4 && (tier !== 'low' || town.rooftops.meshes.length === 1));
    const c2 = SF.surfaceCounts();
    ok(`wiring ${tier}: the town's towers and roofs register glass and metal`, c2.glass >= c1.glass && c2.metal > c1.metal, JSON.stringify(c2));
  }
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  FAIL ' + f);
  process.exit(1);
}
