/**
 * The World Map fields' PAPI, rendered.
 *
 *   node .claude/devtools/briefs/one-check.mjs <url> ./tests/features/field-papi.browser.js check "" 1
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail):
 *   - each end of a paved World Map field (world/worldmap/outstation.js
 *     buildField), drawn on its own: from the approach side at 300 m out on
 *     a 3° slope and from 40 m, the four lenses are on screen (pixels lit),
 *     not hidden behind their own boxes
 *   - on 3°: white and red both show (two and two); at 4.5°: white only;
 *     at 1.5°: red only, the same reading as the home airport's PAPI
 *   - from behind the lights (the far side of the boxes) nothing shows
 * The field is built off-scene with its own renderer and thrown away; the
 * obstacles and decks it registered are taken back out.
 */
import * as THREE from '../../src/vendor/three.module.js';
import { buildField, setPapi } from '../../src/world/worldmap/outstation.js';
import { PREVIEW } from '../../src/world/worldmap/preview.js';
import { OBSTACLES, PLATFORMS } from '../../src/world/terrain.js';

const W = 256;

/** Lit lens pixels from `eye` (field-local metres) looking at the PAPI at (px, pz): { red, white }. */
function shoot(renderer, rt, scene, eye, px, pz) {
  const cam = new THREE.PerspectiveCamera(5, 1, 1, 5000);
  cam.position.set(eye.x, eye.y, eye.z);
  cam.lookAt(px, 0.85, pz - 9);
  cam.updateMatrixWorld();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  const buf = new Uint8Array(W * W * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, W, buf);
  renderer.setRenderTarget(null);
  let red = 0;
  let white = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const [R, G, B] = [buf[i], buf[i + 1], buf[i + 2]];
    if (R > 200 && G > 200 && B > 200) white++;
    else if (R > 180 && G < 90 && B < 90) red++;
  }
  return { red, white };
}

export async function check(sim, r) {
  const a = PREVIEW.airports.find((f) => f.surface !== 'grass' && f.surface !== 'gravel' && f.layout);
  const nObs = OBSTACLES.length;
  const nPlat = PLATFORMS.length;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = W;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  const rt = new THREE.WebGLRenderTarget(W, W);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  let g = null;
  try {
    g = buildField(a, 'low');
    g.position.set(0, 0, 0);
    g.updateMatrixWorld(true);
    scene.add(g);
    const P = g.userData.papi;
    r.ok('field PAPI: a paved World Map field has a PAPI', !!P, a && a.code);
    if (!P) return;
    const L = a.length;
    const hw = a.halfWidth;
    const pz = -hw - 15;
    for (const end of [-1, 1]) {
      const px = end * (L / 2 - 200);
      const tag = end < 0 ? '09 end' : '27 end';
      const at = (dist, deg) => ({ x: px + end * dist, y: dist * Math.tan((deg * Math.PI) / 180), z: 0 });
      const look = (eye) => {
        setPapi(P, a, { x: a.x + eye.x, y: a.elev + eye.y, z: a.z + eye.z });
        return shoot(renderer, rt, scene, eye, px, pz);
      };
      const on = look(at(300, 3));
      const near = look(at(40, 3));
      const high = look(at(300, 4.5));
      const low = look(at(300, 1.5));
      const behind = look({ x: px - end * 300, y: 300 * Math.tan(Math.PI / 60), z: 0 });
      const fmt = (o) => `${o.white}w/${o.red}r`;
      r.ok(`field PAPI: ${tag} lit from 300 m on 3° (two white, two red)`, on.white > 20 && on.red > 20, `${a.code} ${fmt(on)} whites ${P.whites.join(',')}`);
      r.ok(`field PAPI: ${tag} lit from 40 m`, near.white + near.red > 20, fmt(near));
      r.ok(`field PAPI: ${tag} all white when high (4.5°)`, high.white > 40 && high.red === 0, fmt(high));
      r.ok(`field PAPI: ${tag} all red when low (1.5°)`, low.red > 40 && low.white === 0, fmt(low));
      r.ok(`field PAPI: ${tag} faces the approach, not the runway behind it`, behind.white + behind.red === 0, fmt(behind));
    }
  } finally {
    if (g) {
      scene.remove(g);
      g.traverse((o) => {
        if (o.geometry && !(o.geometry.userData && o.geometry.userData.shared)) o.geometry.dispose();
      });
    }
    OBSTACLES.length = nObs;
    PLATFORMS.length = nPlat;
    rt.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
