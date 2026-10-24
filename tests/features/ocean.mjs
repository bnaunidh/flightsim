/**
 * Node checks for the sea (render/ocean-material.js, world/water.js). Plain node:
 *
 *   node tests/features/ocean.mjs
 *
 *   1. The depth field: built over the map's chunks at the tier's texel,
 *      capped in size; deep water reads deep, the beach reads shallow, land
 *      reads 0, and a harbour basin carries no surf (the G channel).
 *   2. The shader contract: fog is three's own, the sea is drawn behind the
 *      land (SEA_DEPTH.deep), Low has no fine octave or foam taps, waves are
 *      in world metres (no UV tiling), and lightning is NOT added to the sea
 *      (the flash-safety contract: tests/features/flicker.browser.js).
 *   3. The sea stays cheap: the texture reads per pixel are counted.
 */
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const root = new URL('../../', import.meta.url);
const load = (p) => import(new URL(p, root).href);

let pass = 0;
const fails = [];
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail && !cond ? ` — ${detail}` : ''}`);
}

const T = await load('src/world/terrain.js');
const O = await load('src/render/ocean-material.js');
const DL = await load('src/render/depth-layers.js');

/* 1. the depth field ----------------------------------------------------- */
T.applyMap('kestrel');
{
  const field = O.buildDepthField('high');
  ok('depth field: built', !!field && field.n > 16, field && field.n);
  ok('depth field: High samples at about 60 m', field.texel >= 50 && field.texel <= 70, `${field.texel} m, ${field.n}²`);
  ok('depth field: covers every chunk', field.size >= 13000 && field.size < 20000, `${field.size} m`);
  const low = O.buildDepthField('low');
  ok('depth field: Low is coarser and smaller', low.n < field.n && low.texel > field.texel, `${low.n}² at ${low.texel} m`);
  ok('depth field: a run of texels is well under half a second of heightAt', field.n * field.n < 70000, `${field.n * field.n} samples`);
  // Open sea off Kestrel is 34 m deep; the island's centre is land.
  ok('depth field: open sea reads deep', O.depthAtField(field, 5000, 5000) > 30, O.depthAtField(field, 5000, 5000));
  ok('depth field: land reads 0', O.depthAtField(field, 0, 0) === 0, O.depthAtField(field, 0, 0));
  // Walk out from the island's centre to the coast and a little past it.
  let lo = 400;
  let hi = 4600;
  for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2;
    if (T.heightAt(m, 0) > 0) lo = m;
    else hi = m;
  }
  const r = (lo + hi) / 2;
  const near = O.depthAtField(field, r + 40, 0);
  const far = O.depthAtField(field, r + 400, 0);
  ok('depth field: it shallows toward the beach', near > 0 && near < far, `${near.toFixed(1)} m at 40 m off, ${far.toFixed(1)} m at 400 m`);
  // The G channel: 255 everywhere without a mask, the mask's value with one.
  const masked = O.buildDepthField('low', { foamWeight: (x, z) => (Math.hypot(x - 2000, z - 2000) < 1500 ? 0 : 1) });
  const g = (f, x, z) => {
    const u = (x - f.cx) * f.xform.z + 0.5;
    const v = (z - f.cz) * f.xform.z + 0.5;
    const i = Math.min(f.n - 1, Math.floor(u * f.n));
    const j = Math.min(f.n - 1, Math.floor(v * f.n));
    return f.data[(j * f.n + i) * 2 + 1];
  };
  ok('depth field: surf allowed everywhere without a mask', g(field, 5000, 5000) === 255);
  ok('depth field: the mask takes the surf out of a harbour', g(masked, 2000, 2000) === 0 && g(masked, 6000, -4000) === 255, `${g(masked, 2000, 2000)}, ${g(masked, 6000, -4000)}`);
  ok('depth field: two bytes a texel', field.data.length === field.n * field.n * 2);
}

/* 2. the shader contract ------------------------------------------------- */
{
  const { VERT, FRAG } = O.OCEAN_SHADERS;
  ok('shader: fog is three\'s own', VERT.includes('#include <fog_vertex>') && FRAG.includes('#include <fog_fragment>') && FRAG.includes('#include <fog_pars_fragment>'));
  ok('shader: colour space is the dome\'s', FRAG.includes('#include <colorspace_fragment>') && !FRAG.includes('tonemapping_fragment'));
  ok('shader: waves are in world metres, not UVs', FRAG.includes('vWorld.xz') && !FRAG.includes('vUv'));
  ok('shader: lightning is not added to the sea', !/uFlash/.test(FRAG));
  ok('shader: Low drops the fine octave and the foam taps', (FRAG.match(/#if WATER_DETAIL > 0/g) || []).length === 2);
  ok('shader: the depth field is read as depth and surf', FRAG.includes('texture2D(uDepthMap, duv).rg'));
  const taps = (FRAG.match(/texture2D\(/g) || []).length;
  ok('shader: at most six texture reads a pixel at High', taps <= 6, `${taps}`);
  ok('shader: fresnel, a glitter lobe and a depth shelf are all there', /pow\(1\.0 - NdV, 5\.0\)/.test(FRAG) && /a2 \/ \(PI \* dd \* dd\)/.test(FRAG) && /exp\(-depth/.test(FRAG));
  const deep = DL.SEA_DEPTH.deep;
  ok('the sea is pushed behind the land by its depth layer', deep.polygonOffset === true && deep.polygonOffsetUnits >= 8);
  const src = await (await import('node:fs/promises')).readFile(new URL('src/world/water.js', root), 'utf8');
  ok('water.js: the sea material carries SEA_DEPTH.deep', /createOceanMaterial/.test(src) && /\.\.\.SEA_DEPTH\.deep/.test(await (await import('node:fs/promises')).readFile(new URL('src/render/ocean-material.js', root), 'utf8')));
  ok('water.js: the old swell plane is gone, its name kept for the flicker check', !/new THREE\.PlaneGeometry\(SEA_SIZE, SEA_SIZE, 24, 24\), this\.swellMat/.test(src) && /this\.swellMat = this\.rippleMat/.test(src));
  ok('water.js: update() allocates no colours', !/update\(dt, weather\) \{[\s\S]*new THREE\.Color\(/.test(src.slice(src.indexOf('  update(dt, weather) {'))));
}

console.log(`\nocean: ${pass}/${pass + fails.length} passed`);
if (fails.length) {
  for (const f of fails) console.log('  FAIL ' + f);
  process.exit(1);
}
