/**
 * Light inside the cockpit, through the day and at night.
 *
 * The room is lit by the same sky as the island; at night that left a cabin as
 * bright as the moonlit fields outside it. Under a roof it is not: the walls,
 * the headliner, the frames go dark, and what you see is the panel's own
 * lighting and the flood lights over the panel, the consoles and the pedestal
 * (warm white in a light aeroplane, an airliner and a helicopter; cooler
 * night-vision-friendly white in a fighter).
 *
 * No light objects (a light is a new shader for everything in the world and a
 * cost on every pixel): each surface's own colour is turned down (the sky
 * it cannot see), and the flood is emissive on the surfaces it falls on, the
 * ones in front of and beside the pilot at panel height and below. Changed only
 * when the light changes, eased (never a step a frame: flash-safe).
 */
import * as THREE from '../../vendor/three.module.js';

export const NIGHT = Object.freeze({
  /** How much of the sky a surface inside still sees at night (its colour's share). */
  roof: 0.5,
  /** At sunset. */
  roofDusk: 0.8,
  /** Flood on the surfaces it falls on (emissive intensity). */
  flood: 0.06,
  floodDusk: 0.02,
  tint: { light: 0xffe4c2, airliner: 0xffead0, heli: 0xffe4c2, jet: 0xdde8ff, racer: 0xffe4c2 },
});

const _b = new THREE.Box3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Does a flood light fall on `mesh`: its middle ahead of the seat, below the
 * glareshield, and the surface facing the pilot (the panel, the pedestal's
 * face) or low down (the consoles and the pedestal top). A glareshield's top
 * faces the sky, and at night stays dark.
 */
export function floodsOn(cp, mesh, E) {
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  _m.identity();
  for (let p = mesh; p && p !== cp; p = p.parent) {
    p.updateMatrix();
    _m.premultiply(p.matrix);
  }
  _b.copy(g.boundingBox).applyMatrix4(_m).getCenter(_c);
  if (!(_c.z < E.z - 0.2 && _c.y < E.y - 0.12)) return false;
  if (_c.y < E.y - 0.45) return true;
  return facing(g, _m) > 0;
}

const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
/** Mean normal (in the cockpit's frame) towards the pilot (+z) minus up (+y): > 0 faces the seat more than the sky. */
function facing(g, m) {
  const N = g.attributes.normal;
  if (!N) return 1;
  _nm.getNormalMatrix(m);
  let z = 0;
  let y = 0;
  const step = Math.max(1, Math.floor(N.count / 400));
  for (let i = 0; i < N.count; i += step) {
    _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
    z += Math.abs(_n.z);
    y += Math.abs(_n.y);
  }
  return z - y;
}

/**
 * Take over the room's fill (cockpit-dress's bounce light, `fill` = its
 * materials) and add the night to it. Returns { update(weather, fillK, dt), level, mats }.
 */
export function nightLight(cp, family, fill, extra = []) {
  const E = cp.userData.eye || new THREE.Vector3(-0.24, 0.46, 0.06);
  const tint = new THREE.Color(NIGHT.tint[family] || NIGHT.tint.light);
  const byMat = new Map();
  const panelFace = cp.userData.panelFace;
  cp.traverse((o) => {
    if (!o.isMesh || o.userData.display || o === panelFace) return;
    const m = o.material;
    if (!m || Array.isArray(m) || !m.isMeshStandardMaterial || m.transparent) return;
    if (m.userData.night === false) return;
    if (!byMat.has(m)) byMat.set(m, { yes: 0, no: 0 });
    const v = byMat.get(m);
    if (floodsOn(cp, o, E)) v.yes++;
    else v.no++;
  });
  for (const m of extra) if (!byMat.has(m)) byMat.set(m, { yes: 0, no: 1 });
  const fillSet = new Set(fill);
  const mats = [];
  for (const [m, v] of byMat) {
    // A material another cockpit already dimmed (one shared between rooms) is read as it was first found.
    const first = m.userData.nightBase || (m.userData.nightBase = { color: m.color.clone(), emissive: m.emissive.clone(), k: m.emissiveIntensity });
    const c = first.color.clone();
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    // The flood is the light's colour times what the surface reflects (lifted:
    // a black console under a lamp is still seen to be lit).
    const floodCol = tint.clone().multiplyScalar(Math.min(1, Math.max(0.3, lum * 3)));
    if (m.vertexColors || m.map) floodCol.copy(tint).multiplyScalar(0.45);
    // A lamp or a lit button keeps its own emissive: only the sky's share of its colour changes.
    const own = !fillSet.has(m) && first.emissive.r + first.emissive.g + first.emissive.b > 0.001;
    mats.push({
      m,
      own,
      color: c,
      emissive: fillSet.has(m) ? m.emissive.clone() : first.emissive.clone(),
      flood: v.yes > v.no,
      fill: fillSet.has(m),
      floodCol,
      baseIntensity: fillSet.has(m) ? m.emissiveIntensity : first.k,
    });
  }
  const st = { roof: 1, flood: 0, fillK: -1 };
  const want = { roof: 1, flood: 0 };
  const api = {
    mats,
    state: st,
    apply() {
      for (const x of mats) {
        x.m.color.copy(x.color).multiplyScalar(st.roof);
        if (x.own) continue;
        if (x.flood && st.flood > 0) {
          // Fill and flood share the emissive: blend the colour, sum the strength.
          const f = st.flood;
          const k = x.fill ? Math.max(0, st.fillK) : 0;
          x.m.emissive.copy(x.emissive).multiplyScalar(k).add(_tmp.copy(x.floodCol).multiplyScalar(f));
          x.m.emissiveIntensity = 1;
        } else if (x.fill) {
          x.m.emissive.copy(x.emissive);
          x.m.emissiveIntensity = Math.max(0, st.fillK);
        } else {
          x.m.emissive.copy(x.emissive);
          x.m.emissiveIntensity = x.baseIntensity;
        }
      }
    },
    /** `fillK`: the dress's bounce level for this weather. Eased over about a second. */
    update(weather, fillK, dt = 1) {
      const time = weather && weather.time;
      want.roof = time === 'night' ? NIGHT.roof : time === 'sunset' ? NIGHT.roofDusk : 1;
      want.flood = time === 'night' ? NIGHT.flood : time === 'sunset' ? NIGHT.floodDusk : 0;
      const k = st.fillK < 0 ? 1 : Math.min(1, dt * 2);
      const roof = st.roof + (want.roof - st.roof) * k;
      const flood = st.flood + (want.flood - st.flood) * k;
      const close = (a, b) => Math.abs(a - b) < 0.002;
      const settle = (a, b) => (close(a, b) ? b : a);
      const nr = settle(roof, want.roof);
      const nf = settle(flood, want.flood);
      if (nr === st.roof && nf === st.flood && Math.abs(fillK - st.fillK) < 0.004) return false;
      st.roof = nr;
      st.flood = nf;
      st.fillK = fillK;
      api.apply();
      return true;
    },
    /** Put every material back as it was found. */
    restore() {
      for (const x of mats) {
        x.m.color.copy(x.color);
        if (x.own) continue;
        x.m.emissive.copy(x.emissive);
        x.m.emissiveIntensity = x.baseIntensity;
      }
    },
  };
  return api;
}
const _tmp = new THREE.Color();
