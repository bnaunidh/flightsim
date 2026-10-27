/**
 * Node checks for the height fog (wave 19, item 4). Run from anywhere:
 *
 *   node tests/features/fog.mjs [--verbose]
 *
 *   1. INSTALLED IN THREE'S OWN FOG. installHeightFog() rewrites the fog
 *      chunks (the vertex shader works out each fragment's height over the
 *      eye; the fragment shader adds the layer to FogExp2), and puts ONE
 *      uniform object in UniformsLib.fog and every ShaderLib entry that fogs
 *      — still the same object after three clones a material's uniforms, so
 *      setting it once sets every material's.
 *   2. THE MATHS. The shader's closed form for the layer's optical depth
 *      (eye height h0 to fragment height h1, a·e^(−h/H)) is the integral, to
 *      a fraction of a percent, looking level, up, down, from in and above
 *      the layer; heightFogDepth (the sky's and the clouds' veil) is the
 *      same number; the height over the eye from the view matrix is right
 *      for a camera turned any way.
 *   3. THE LOOK. A fog bank is thick at the bottom and thin at the top: the
 *      sea 3 km away is lost from 30 m up and plain from 600 m; off, it
 *      changes nothing.
 */
import * as THREE from '../../src/vendor/three.module.js';

const verbose = process.argv.includes('--verbose');
const root = new URL('../../', import.meta.url);
const load = (p) => import(new URL(p, root).href);
const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
  if (verbose || !pass) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const HF = await load('src/render/height-fog.js');
HF.installHeightFog();

/* -------------------------------------------------------------- 1. installed -- */
{
  const C = THREE.ShaderChunk;
  ok('installed: the fog chunks carry the layer (vertex: height over the eye; fragment: the layer on FogExp2)',
    /vFogRelY\s*=\s*dot\(\s*viewMatrix\[\s*1\s*\]\.xyz/.test(C.fog_vertex) && /heightFog/.test(C.fog_fragment) && /uniform vec4 heightFog/.test(C.fog_pars_fragment) && /fogDensity \* fogDensity/.test(C.fog_fragment));
  const libs = Object.entries(THREE.ShaderLib).filter(([, s]) => s.uniforms && 'fogDensity' in s.uniforms);
  const shared = libs.every(([, s]) => s.uniforms.heightFog && s.uniforms.heightFog.value === HF.HEIGHT_FOG);
  ok('installed: every built-in material that fogs has the layer\'s uniform', libs.length >= 8 && shared, `${libs.length} shader libs`);
  const cl = THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms);
  const merged = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { foo: { value: 1 } }]);
  ok('installed: still ONE object after three clones a material\'s uniforms (so one write sets them all)', cl.heightFog.value === HF.HEIGHT_FOG && merged.heightFog.value === HF.HEIGHT_FOG);
  HF.setHeightFog(0, 150, 10);
  ok('installed: off is off (a = 0)', HF.HEIGHT_FOG.x === 0);
  // Checker: built at Low (after a High boot) the shaders skip the layer; the CPU veils still read a.
  HF.setHeightFog(0.002, 150, 10, false);
  const lowOff = HF.HEIGHT_FOG.w === 0 && HF.HEIGHT_FOG.x === 0.002 && !HF.heightFogInShaders() && /heightFog\.x \* heightFog\.w > 0\.0/.test(C.fog_fragment);
  HF.setHeightFog(0.002, 150, 10);
  ok('installed: at Low the shaders skip the layer (w = 0) while its strength stays for the sky\'s veil; back on above Low', lowOff && HF.HEIGHT_FOG.w === 1 && HF.heightFogInShaders());
  HF.setHeightFog(0, 150, 10);
}

/* -------------------------------------------------------------- 2. the maths -- */
// The shader's closed form, in JS, line for line.
function shaderOD(a, invH, eyeY, relY, depth) {
  const h0 = Math.max(eyeY, -50);
  const h1 = Math.max(eyeY + relY, -50);
  const e0 = Math.exp(-invH * h0);
  const e1 = Math.exp(-invH * h1);
  const dh = h1 - h0;
  const avg = Math.abs(dh) > 0.5 ? (e0 - e1) / (invH * dh) : e0;
  return a * depth * avg;
}
function numericOD(a, invH, eyeY, relY, dist, n = 4000) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const h = Math.max(-50, eyeY + relY * ((i + 0.5) / n));
    s += a * Math.exp(-invH * h);
  }
  return (s / n) * dist;
}
{
  const errs = [];
  for (const eye of [5, 60, 300, 1500]) {
    for (const ang of [-60, -10, 0, 5, 30, 85]) {
      // Down to the ground at most: no fragment is under the sea.
      const sn = Math.sin((ang * Math.PI) / 180);
      const dist = sn < 0 ? Math.min(4000, eye / -sn) : 4000;
      const relY = sn * dist;
      const a = 0.001;
      const invH = 1 / 120;
      const sh = shaderOD(a, invH, eye, relY, dist);
      const nu = numericOD(a, invH, eye, relY, dist);
      const hf = HF.heightFogDepth(a, invH, eye, Math.sin((ang * Math.PI) / 180), dist);
      if (Math.abs(sh - nu) > 0.005 * nu + 1e-9 || Math.abs(hf - nu) > 0.005 * nu + 1e-9) errs.push(`eye ${eye} m at ${ang}°: shader ${sh.toFixed(4)}, veil ${hf.toFixed(4)}, integral ${nu.toFixed(4)}`);
    }
  }
  ok('maths: the shader\'s closed form and the veil are the layer\'s integral (level, up, down; in it and above it)', errs.length === 0, errs.slice(0, 3).join('; ') || '24 rays within 0.5%');
  // Height over the eye from the view matrix, for a camera turned every which way.
  const cam = new THREE.PerspectiveCamera();
  const bad = [];
  for (let i = 0; i < 40; i++) {
    cam.position.set(Math.sin(i) * 500, 200 + i * 10, Math.cos(i * 1.3) * 400);
    cam.rotation.set(Math.sin(i * 0.7) * 1.4, i * 0.9, Math.cos(i * 0.4) * 0.5);
    cam.updateMatrixWorld(true);
    const V = cam.matrixWorldInverse;
    const p = new THREE.Vector3(Math.cos(i) * 900, Math.sin(i * 2) * 300, i * 37 - 500);
    const mv = p.clone().applyMatrix4(V);
    const e = V.elements; // column-major: viewMatrix[1] is e[4], e[5], e[6]
    const relY = e[4] * mv.x + e[5] * mv.y + e[6] * mv.z;
    if (Math.abs(relY - (p.y - cam.position.y)) > 1e-6 * 1000) bad.push(`${relY.toFixed(3)} vs ${(p.y - cam.position.y).toFixed(3)}`);
  }
  ok('maths: the fragment\'s height over the eye from the view matrix is right for any camera', bad.length === 0, bad.slice(0, 2).join('; ') || '40 cameras');
}

/* --------------------------------------------------------------- 3. the look -- */
{
  const WX = await load('src/world/wx.js');
  const f = WX.fogFor(WX.PHASES.mist.visM, WX.PHASES.mist.mist, WX.PHASES.mist.mistH);
  const trans = (eye) => {
    // The sea 3 km away, from `eye` metres up: the layer and the even part together.
    const dist = Math.hypot(3000, eye);
    const od = shaderOD(f.hfA, 1 / f.hfH, eye, -eye, 3000) + (f.fog * dist) ** 2;
    return Math.exp(-od);
  };
  const low = trans(30);
  const high = trans(600);
  ok('look: a mist bank is thick at the bottom and thin at the top (the sea 3 km off: lost from 30 m, four times clearer from 600 m)', low < 0.12 && high > 0.35 && high > low * 4, `seen ${(low * 100).toFixed(0)}% from 30 m, ${(high * 100).toFixed(0)}% from 600 m`);
  ok('look: the fog banks vary across the ground (a few km across), so you fly in and out of them', (() => {
    let lo = 1;
    let hi = 0;
    for (let x = 0; x < 40000; x += 500) {
      const b = WX.bankAt(x, 1234, 99);
      lo = Math.min(lo, b);
      hi = Math.max(hi, b);
    }
    return hi - lo > 0.35;
  })());
}

const failed = results.filter((r) => !r.pass);
console.log(`\nfog: ${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
