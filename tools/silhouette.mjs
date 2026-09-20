/** Export correction: includes every instance and respects hidden ancestors.
 * Before: one passenger window/tyre per batch; after: all placed instances.
 * Exact per-aircraft counts are in ../../verification/measurements.json.
 * This is geometry inspection, not a device frame-rate measurement. */
/**
 * Look at an aeroplane.
 *
 * Same argument as tools/heightfield.mjs. "The B-2 still doesn't look scary"
 * was said three times over two days and answered three times with vertex
 * counts and clearance measurements, because measuring is what a headless
 * harness can do and nobody could see the thing. A silhouette is cheap: build
 * the model, take every triangle, project it flat. tools/planview.py draws it.
 *
 *   node tools/silhouette.mjs <id> > out.json
 *   node tools/silhouette.mjs --all <outDir>
 *
 * Ids are the fleet's own: skylark, courier, meridian, tempest, vanguard,
 * osprey, nightjar, harrier, ...
 */
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
};

import { writeFileSync, mkdirSync } from 'node:fs';

const HERE = new URL('../src/', import.meta.url).href;
const THREE = await import(HERE + 'vendor/three.module.js');
const { aircraftDefinitions } = await import(HERE + 'fleet/aircraft-fleet.js');
const { buildAircraft } = await import(HERE + 'fleet/aircraft-core.js');
/*
 * The adapter, not the pack.
 *
 * Only three of the aeroplanes are drawn by src/fleet — the adapter's
 * PACK_DRAWS_BETTER list — and everything else comes from
 * src/aircraft/model.js. Asking the pack for a Skylark gets you a Skylark
 * the game never shows, which is exactly the trap that made the Nightjar
 * take two days: the shape being measured was not the shape being drawn.
 * So this goes through the same call main.js makes.
 */
const { createAircraftModel } = await import(HERE + 'aircraft/model-adapter.js');
const { AIRCRAFT, getAircraft } = await import(HERE + 'aircraft/types.js');

/** Every triangle of the built model, in the aircraft's own frame. */
export function trianglesOf(id) {
  const type = AIRCRAFT.find((t) => t.id === id);
  const config = aircraftDefinitions.find((c) => c.id === id);
  if (!type && !config) {
    throw new Error(`no aircraft "${id}" — try: ${AIRCRAFT.map((t) => t.id).join(' ')}`);
  }
  const built = type ? createAircraftModel({ type: getAircraft(id) }) : buildAircraft(config, {});
  const root = built.group || built.object || built.root || built;
  root.updateMatrixWorld(true);

  const tris = [];
  let meshes = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    /*
     * Not the invisible ones. The Harrier carries an 8.4 m square decal at
     * y=0 for its downwash, transparent and at zero opacity until it hovers,
     * and drawn flat it filled the whole plan view with a black slab — the
     * aeroplane looked broken and was not. A silhouette is what you can see.
     */
    for (let parent = o; parent; parent = parent.parent) if (!parent.visible) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (mat && mat.transparent && mat.opacity <= 0.02) return;
    const g = o.geometry;
    const pos = g.attributes && g.attributes.position;
    if (!pos) return;
    meshes++;
    const idx = g.index ? g.index.array : null;
    const n = idx ? idx.length : pos.count;
    const v = new THREE.Vector3();
    const transform = new THREE.Matrix4();
    const instance = new THREE.Matrix4();
    const take = (k) => {
      v.fromBufferAttribute(pos, k).applyMatrix4(transform);
      return [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000, Math.round(v.z * 1000) / 1000];
    };
    for (let copy = 0; copy < (o.isInstancedMesh ? o.count : 1); copy++) {
      if (o.isInstancedMesh) {
        o.getMatrixAt(copy, instance);
        transform.multiplyMatrices(o.matrixWorld, instance);
      } else transform.copy(o.matrixWorld);
    for (let i = 0; i + 2 < n; i += 3) {
      const a = idx ? idx[i] : i;
      const b = idx ? idx[i + 1] : i + 1;
      const c = idx ? idx[i + 2] : i + 2;
      tris.push([take(a), take(b), take(c)]);
    }
    }
  });
  return { id, name: (type && type.name) || (config && config.name) || id, meshes, tris };
}

const args = process.argv.slice(2);
if (args[0] === '--all') {
  const dir = args[1] || '.';
  mkdirSync(dir, { recursive: true });
  const ids = [...new Set([...AIRCRAFT.map((t) => t.id), ...aircraftDefinitions.map((c) => c.id)])];
  for (const aircraftId of ids) {
    const c = { id: aircraftId };
    try {
      const out = trianglesOf(c.id);
      writeFileSync(`${dir}/${c.id}.json`, JSON.stringify(out));
      console.log(`${c.id.padEnd(12)} ${String(out.meshes).padStart(3)} meshes ${String(out.tris.length).padStart(5)} triangles`);
    } catch (err) {
      console.log(`${c.id.padEnd(12)} FAILED ${err.message}`);
    }
  }
} else if (args[0]) {
  console.log(JSON.stringify(trianglesOf(args[0])));
} else {
  console.log([...new Set([...AIRCRAFT.map((t) => t.id), ...aircraftDefinitions.map((c) => c.id)])].join(' '));
}
