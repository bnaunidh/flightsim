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

/** Every triangle of the built model, in the aircraft's own frame. */
export function trianglesOf(id) {
  const config = aircraftDefinitions.find((c) => c.id === id);
  if (!config) throw new Error(`no aircraft "${id}" — try: ${aircraftDefinitions.map((c) => c.id).join(' ')}`);
  const built = buildAircraft(config, {});
  const root = built.group || built.object || built;
  root.updateMatrixWorld(true);

  const tris = [];
  let meshes = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const pos = g.attributes && g.attributes.position;
    if (!pos) return;
    meshes++;
    const idx = g.index ? g.index.array : null;
    const n = idx ? idx.length : pos.count;
    const v = new THREE.Vector3();
    const take = (k) => {
      v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
      return [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000, Math.round(v.z * 1000) / 1000];
    };
    for (let i = 0; i + 2 < n; i += 3) {
      const a = idx ? idx[i] : i;
      const b = idx ? idx[i + 1] : i + 1;
      const c = idx ? idx[i + 2] : i + 2;
      tris.push([take(a), take(b), take(c)]);
    }
  });
  return { id, name: config.name || id, meshes, tris };
}

const args = process.argv.slice(2);
if (args[0] === '--all') {
  const dir = args[1] || '.';
  mkdirSync(dir, { recursive: true });
  for (const c of aircraftDefinitions) {
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
  console.log(aircraftDefinitions.map((c) => c.id).join(' '));
}
