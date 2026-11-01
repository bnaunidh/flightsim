/**
 * REAL SCENERY: downloaded trees, airport buildings, houses, boats and
 * windmills (CC BY 4.0, credited in the Credits screen and
 * assets/models/LICENSES.md), baked small by tools/real-models/scenery.py.
 *
 * Each file is one root node named after its id with one child per PART
 * (bark, leaves, body, glass, wheel...), vertex-coloured, no images inside:
 * every texture of the source was sampled to one colour per triangle, so no
 * lettering, logo or insignia comes with it. The one exception is a tree's
 * leaves, whose alpha cut-out picture ships beside the file as a small WebP
 * (REAL_SCENERY's `leaf`; the part is the one whose material is alpha-tested).
 *
 * LOADING is lazy and never on the first visit: a file is fetched the first
 * time a world that uses it is built at Medium or better (Low keeps the
 * game's own, cheaper shapes), and never by the service worker's install
 * (sw.js keeps a copy once fetched). A file that cannot be had simply never
 * arrives and the game's own shape stays, as with the real aircraft.
 */
import * as THREE from '../vendor/three.module.js';
import { parseGLB } from '../vehicles/glb.js';
import { fetchRetry } from '../core/load-retry.js';
import { realModelsOn } from '../aircraft/real-models.js';
import { qualityRank } from '../aircraft/model-quality.js';

const SF = 'https://sketchfab.com/3d-models/';

/**
 * Every real scenery model, by id. `used` is what the Credits screen says it
 * stands for; tests/features/real-scenery.mjs holds the files to these.
 */
export const REAL_SCENERY = {
  'tree-palm': { file: 'tree-palm.glb', leaf: 'tree-palm-leaf.webp', title: 'Coconut Palm', author: 'evolveduk (@evolveduk)', url: SF + '26e787f2ff2e4c0fb004c3b0210805a3', used: 'Palm trees, close up' },
  'tree-pine': { file: 'tree-pine.glb', leaf: 'tree-pine-leaf.webp', title: 'Pine Tree', author: 'evolveduk (@evolveduk)', url: SF + 'd45218a3fab349e5b1de040f29e7b6f9', used: 'Pines and firs, close up' },
  'tree-birch': { file: 'tree-birch.glb', leaf: 'tree-birch-leaf.webp', title: 'Birch tree', author: 'evolveduk (@evolveduk)', url: SF + 'aa842dffd9654d33b8b91170ce83c172', used: 'Birches, close up' },
  'tree-oak': { file: 'tree-oak.glb', leaf: 'tree-oak-leaf.webp', title: 'Oak tree', author: 'massive-graphisme (@greg-l)', url: SF + '3dc59560f2d24345bdbe65c44636453b', used: 'Broadleaf trees, close up' },
  // The airport's fire station; the air base's guard post, watchtower and garage (one pack).
  firestation: { file: 'firestation.glb', title: 'Fire Station No. 1', author: 'CommonSpence (@commonspence)', url: SF + '87edf04deb28434993274d9f05070865', used: 'The airport fire station' },
  'base-outpost': { file: 'base-outpost.glb', title: 'GAME READY MILITARY BASE ASSET PACK', author: 'Oxygen3D (@oxygen3d)', url: SF + '47c0a32b43bf42abbb743458fbd95114', used: 'Air base: guard posts' },
  'base-watchtower': { file: 'base-watchtower.glb', title: 'GAME READY MILITARY BASE ASSET PACK', author: 'Oxygen3D (@oxygen3d)', url: SF + '47c0a32b43bf42abbb743458fbd95114', used: 'Air base: watchtowers' },
  house: { file: 'house.glb', title: 'House', author: 'SpatialNeglect (@jeandiz)', url: SF + 'e70c4aebc911429ba9a894b38146892c', used: 'Country houses in the villages and towns' },
  sailboat: { file: 'sailboat.glb', title: 'Sailboat', author: 'Sergei (@sergeif)', url: SF + '76d0b1e24be14d2f9a524bfce3001aeb', used: 'Yachts at sea and on the harbour moorings' },
  windmill: { file: 'windmill.glb', title: 'Vintage Wind Turbine - GameAsset - Free Download', author: 'DavidFalke (@davidfalke)', url: SF + '3e0ca3c6fdf14badbb5750220e6ca7ee', used: 'Wind pumps on the farmland' },
  'base-garage': { file: 'base-garage.glb', title: 'GAME READY MILITARY BASE ASSET PACK', author: 'Oxygen3D (@oxygen3d)', url: SF + '47c0a32b43bf42abbb743458fbd95114', used: 'Air base: vehicle garage' },
};

const templates = new Map(); // id -> { root, parts: Map(name -> mesh), extras }
const pending = new Map();
const failedAt = new Map();
let loader = null; // tests: (url, id) => ArrayBuffer
let imageLoader = null; // tests: (url) => image-like or null

/** Tests: read the files off disk instead of fetching them (images: optional). */
export function setRealSceneryLoader(fn, images = null) {
  loader = fn;
  imageLoader = images;
}

/** Real scenery wanted at all: the real-models switch (and its URL / memory guards), and not Low. */
export const realSceneryOn = () => realModelsOn() && qualityRank() >= 1;

export function realSceneryUrl(id, file = null) {
  const f = file || REAL_SCENERY[id].file;
  return new URL(`../../assets/models/real/scenery/${f}`, import.meta.url).href;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

async function fetchBuffer(url) {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** A leaf picture as a texture: fetched, decoded off the main thread, glTF's v-down kept. */
async function leafTexture(url) {
  let img = null;
  if (imageLoader) img = await imageLoader(url);
  else if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
    const res = await fetchRetry(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    img = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }
  if (!img) return null;
  const t = new THREE.Texture(img);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Fetch and parse one model (and its leaf picture), once. Resolves to the template or null; never rejects. */
export function loadRealScenery(id) {
  if (!REAL_SCENERY[id]) return Promise.resolve(null);
  if (templates.has(id)) return Promise.resolve(templates.get(id));
  // Nowhere to fetch from (node, a test without a loader): the game's own stays, quietly.
  if (!loader && !(typeof location !== 'undefined' && /^https?:$/.test(location.protocol || ''))) return Promise.resolve(null);
  if (pending.has(id)) return pending.get(id);
  const failed = failedAt.get(id);
  if (failed && now() - failed < 60000) return Promise.resolve(null);
  const p = (async () => {
    try {
      const buf = await (loader || fetchBuffer)(realSceneryUrl(id), id);
      const parsed = parseGLB(buf, { name: REAL_SCENERY[id].file, warn: () => {} });
      const root = parsed.scene.getObjectByName(id);
      if (!root) throw new Error(`${REAL_SCENERY[id].file} has no root node called ${id}`);
      root.removeFromParent();
      const parts = new Map();
      const jobs = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        const name = o.parent && o.parent !== root ? o.parent.name : o.name;
        parts.set(name, o);
        const src = o.material;
        const leaf = src && src.alphaTest > 0 ? REAL_SCENERY[id].leaf || null : null;
        const m = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: src && src.roughness != null ? src.roughness : 0.85,
          metalness: src && src.metalness != null ? src.metalness : 0,
          side: src && src.side === THREE.DoubleSide ? THREE.DoubleSide : THREE.FrontSide,
        });
        m.name = `real-scenery|${id}|${name}`;
        if (leaf || (src && src.alphaTest > 0)) {
          m.side = THREE.DoubleSide;
          m.alphaTest = src.alphaTest || 0.42;
          m.color.setRGB(0.36, 0.5, 0.26); // until (or unless) the picture arrives: a plain leaf green
          if (leaf) {
            jobs.push(
              leafTexture(realSceneryUrl(id, leaf)).then((t) => {
                if (!t) return;
                m.map = t;
                m.color.setRGB(1, 1, 1);
                m.needsUpdate = true;
              })
            );
          }
        }
        o.material = m;
      });
      await Promise.all(jobs);
      const t = { id, root, parts, extras: root.userData.extras || {}, triangles: parsed.stats.triangles };
      templates.set(id, t);
      return t;
    } catch (e) {
      failedAt.set(id, now());
      console.warn(`The real ${id} model could not be loaded; keeping the built-in one.`, e);
      return null;
    } finally {
      pending.delete(id);
    }
  })();
  pending.set(id, p);
  return p;
}

export const realSceneryTemplate = (id) => templates.get(id) || null;
export const realSceneryReady = (id) => templates.has(id);
export function realSceneryStatus() {
  return Object.fromEntries(Object.keys(REAL_SCENERY).map((k) => [k, templates.has(k) ? 'ready' : pending.has(k) ? 'loading' : failedAt.has(k) ? 'failed' : 'idle']));
}
