/**
 * A floating origin for drawing, and only for drawing.
 *
 * The simulation keeps world coordinates in JavaScript numbers (float64), so
 * an aeroplane 250 km from the middle of the World Map preview flies exactly
 * as it does at the middle. The GPU does not: everything a shader works out
 * in world space — the shadow lookup, three's reflection vectors, the sea's
 * wave pattern, the terrain's cliff texture — is float32, and float32 at
 * 200 km is 1.6 cm a step. Three.js composes each mesh's matrix with the
 * camera's in float64, so the geometry itself never jitters; the world-space
 * sums in the shaders do, by a centimetre or three a frame, which is what
 * the shadows on a cockpit panel would show.
 *
 * So, for the length of one draw, the whole scene is moved so that the
 * camera is near (0, 0): `scene.position` is set to -O and the camera is
 * moved by -O, where O is the camera's position rounded to a SNAP grid. Every
 * relative quantity is unchanged — the view, the shadows (the sun and its
 * target are in the scene), the fog — and the world-space ones the shaders
 * compute are now small numbers. The two shaders that read world position
 * as a PATTERN (the sea's waves and depth field, the terrain's cliffs and
 * cloud shadows) add O back through RENDER_ORIGIN, so nothing they draw
 * moves when O does. Straight after the draw everything is put back, so the
 * game's own code, which runs between draws, never sees a moved world.
 *
 * Off unless a map asks for it (setRenderOrigin): on the nine maps and
 * anywhere within MIN_DIST of the middle of the preview, renderFrame draws
 * exactly what it always drew.
 */
import * as THREE from '../vendor/three.module.js';

/** The origin the shaders add back (metres, x and z). Shared by every material that reads it. */
export const RENDER_ORIGIN = { value: new THREE.Vector2(0, 0) };

/** The grid O is rounded to: it changes once every few kilometres, not every frame. */
export const SNAP = 4096;
/** Within this of the middle float32 is already under 2 mm: no shift at all. */
export const MIN_DIST = 24000;

let MODE = null;
const shift = { x: 0, z: 0, on: false };

/** Turn the floating origin on (a map that is big enough) or off (null). */
export function setRenderOrigin(opts) {
  MODE = opts ? { snap: opts.snap || SNAP, minDist: opts.minDist ?? MIN_DIST } : null;
  RENDER_ORIGIN.value.set(0, 0);
}

export function renderOriginOn() {
  return !!MODE;
}

/** Where the origin would be for a camera here (for the tests and the dev overlay). */
export function originFor(x, z) {
  if (!MODE || Math.hypot(x, z) < MODE.minDist) return { x: 0, z: 0 };
  return { x: Math.round(x / MODE.snap) * MODE.snap, z: Math.round(z / MODE.snap) * MODE.snap };
}

/** The shift in force during the draw now happening (0, 0 between draws). */
export function currentShift() {
  return { x: shift.on ? shift.x : 0, z: shift.on ? shift.z : 0 };
}

/**
 * Before the draw. Returns true if anything was moved (and endRender must
 * be called). `force` = {x, z} draws with that origin instead (the tests).
 */
export function beginRender(scene, camera, force = null) {
  if (!MODE && !force) return false;
  const o = force || originFor(camera.position.x, camera.position.z);
  if (!o.x && !o.z) return false;
  shift.x = o.x;
  shift.z = o.z;
  shift.on = true;
  scene.position.set(-o.x, 0, -o.z);
  camera.position.x -= o.x;
  camera.position.z -= o.z;
  camera.updateMatrixWorld();
  RENDER_ORIGIN.value.set(o.x, o.z);
  return true;
}

/** After the draw: everything back where the game left it. */
export function endRender(scene, camera) {
  if (!shift.on) return;
  scene.position.set(0, 0, 0);
  camera.position.x += shift.x;
  camera.position.z += shift.z;
  shift.on = false;
  shift.x = 0;
  shift.z = 0;
  RENDER_ORIGIN.value.set(0, 0);
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
}
