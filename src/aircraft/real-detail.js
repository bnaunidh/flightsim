/**
 * REAL MODELS' SURFACE DETAIL: the ambient-occlusion, normal and roughness
 * maps a real model's file may carry (tools/real-models/detail.py), decoded
 * and laid under the game's own paint.
 *
 * The livery stays what it was -- the game's parody canvas on the `uv` the
 * paint makes at run time (fleet/extra/real-paint.js). These maps ride on UVs
 * of their own: `uv1` (the source's, for maps kept from it) and `uv2` (the
 * baked atlas), each texture told which with `texture.channel`, so the two
 * never meet. Nothing here can carry a livery: the files hold no colour maps.
 *
 * Imported only when a file has maps (real-models.js), never on Low: the
 * KTX2 transcoder (vendor/basis, ~580 KB) and the meshopt decoder are not
 * part of the first load.
 */
import * as THREE from '../vendor/three.module.js';
import { KTX2Loader } from '../vendor/addons/KTX2Loader.js';

let ktx2 = null;
let renderer = null;
const BASIS = new URL('../vendor/basis/', import.meta.url).href;

/** main.js: the renderer, whose GPU decides the format KTX2 transcodes to. */
export function setDetailRenderer(r) {
  renderer = r || null;
}

function loader() {
  if (!ktx2) {
    if (!renderer) throw new Error('no renderer yet');
    ktx2 = new KTX2Loader().setTranscoderPath(BASIS).setWorkerLimit(1).detectSupport(renderer);
  }
  return ktx2;
}

const KIND = { normal: 'normalMap', occlusion: 'aoMap', mr: 'roughnessMap' };
/** How much of the DIRECT (sun) light the AO map may take away where it is dark (0: three.js's own, ambient only). */
export const DIRECT_AO = 0.7;
/** The roughness map's middle value (a map kept from a source may sit elsewhere; ours sit here). */
const ROUGH_MID = 0.85;
/** geometry -> { aoMap, normalMap, roughnessMap, metalnessMap, aoStrength, normalScale } */
const detailOf = new WeakMap();

/**
 * Decode every map the template's materials point at and remember them by
 * geometry (Object3D.clone shares geometry, so every copy of the skin finds
 * them). Resolves to the number of meshes that got detail; never rejects.
 */
export async function decodeDetail(root, parsed) {
  const decoded = new Map(); // image -> Promise<CompressedTexture|null>
  const perChannel = new Map(); // `${image}:${channel}` -> texture
  const tex = async (ref) => {
    if (!decoded.has(ref.image)) {
      const img = parsed.image(ref.image);
      if (!img || !/ktx2/.test(img.mime)) decoded.set(ref.image, Promise.resolve(null));
      else {
        const copy = img.bytes.slice().buffer;
        decoded.set(ref.image, new Promise((res) => loader().parse(copy, (t) => res(t), () => res(null))));
      }
    }
    const t = await decoded.get(ref.image);
    if (!t) return null;
    const ch = ref.texCoord || 0;
    const key = `${ref.image}:${ch}`;
    if (!perChannel.has(key)) {
      // The same image on two UV sets (a channel each) is two textures sharing one upload's data.
      const u = [...perChannel.keys()].some((k) => k.startsWith(`${ref.image}:`)) ? t.clone() : t;
      u.channel = ch;
      u.colorSpace = THREE.NoColorSpace;
      const s = ref.sampler || {};
      const wrap = (w) => (w === 33071 ? THREE.ClampToEdgeWrapping : w === 33648 ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping);
      u.wrapS = wrap(s.wrapS);
      u.wrapT = wrap(s.wrapT);
      u.needsUpdate = true;
      perChannel.set(key, u);
    }
    return perChannel.get(key);
  };
  const jobs = [];
  root.traverse((o) => {
    const maps = o.isMesh && o.material && o.material.userData && o.material.userData.gltfMaps;
    if (!maps) return;
    jobs.push(
      (async () => {
        const d = {};
        for (const [kind, ref] of Object.entries(maps)) {
          const use = await tex(ref);
          if (!use) continue;
          d[KIND[kind]] = use;
          if (kind === 'mr') d.metalnessMap = use;
          if (kind === 'occlusion') d.aoStrength = ref.strength ?? 1;
          if (kind === 'normal') d.normalScale = ref.scale ?? 1;
        }
        if (Object.keys(d).length) detailOf.set(o.geometry, d);
      })(),
    );
  });
  try {
    await Promise.all(jobs);
  } catch (e) {
    console.warn('Real model detail maps could not be decoded; drawing without them.', e);
  }
  return jobs.length;
}

/** The detail decoded for this geometry, if any. */
export function detailFor(geometry) {
  return detailOf.get(geometry) || null;
}

const withCache = new WeakMap();
/**
 * `mat` with the detail laid under it: a clone (the role materials are shared
 * with the procedural model, whose meshes have no uv1/uv2), once per material
 * and set of maps.
 */
export function withDetail(mat, d) {
  if (!d || !mat || !mat.isMeshStandardMaterial) return mat;
  let per = withCache.get(mat);
  if (!per) withCache.set(mat, (per = new WeakMap()));
  let m = per.get(d);
  if (m) return m;
  m = mat.clone();
  m.name = `${mat.name}+detail`;
  if (d.aoMap) {
    m.aoMap = d.aoMap;
    m.aoMapIntensity = d.aoStrength ?? 1;
    // three.js lets an AO map shade only the AMBIENT light, and a sunny day here is nearly all
    // sun: the wing root, the pylons and the gear bays came out as bright as open skin. Most game
    // engines let AO take part of the direct light too; so does this, by DIRECT_AO.
    const before = mat.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      if (typeof before === 'function') before.call(m, sh, r);
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
#ifdef USE_AOMAP
  reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, ${DIRECT_AO.toFixed(2)});
  reflectedLight.directSpecular *= mix(1.0, ambientOcclusion, ${DIRECT_AO.toFixed(2)});
#endif`,
      );
    };
    const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
    m.customProgramCacheKey = () => `${key}|rm-ao-direct`;
  }
  if (d.normalMap) {
    m.normalMap = d.normalMap;
    // glTF normal maps with no tangents: three's derivative tangents run the other way in v (as GLTFLoader does).
    m.normalScale = new THREE.Vector2(d.normalScale ?? 1, -(d.normalScale ?? 1));
  }
  if (d.roughnessMap) {
    m.roughnessMap = d.roughnessMap;
    // the map sits around ROUGH_MID (detail.py surface_maps): the material's own roughness stays its average
    m.roughness = Math.min(1, mat.roughness / ROUGH_MID);
  }
  if (d.metalnessMap) m.metalnessMap = d.metalnessMap;
  // A paint map the skin sets later (relayer) is the livery's, on `uv`: unchanged.
  m.needsUpdate = true;
  per.set(d, m);
  return m;
}
