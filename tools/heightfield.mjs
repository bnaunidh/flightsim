/**
 * Export a map's height field, so it can be LOOKED AT.
 *
 * Every map bug this project has had was invisible in the data and obvious the
 * moment you flew over it: a fourteen-metre plateau quarried through an
 * island's middle, a lighthouse forty metres under water, a town with no
 * buildings in it, a fifteen-hundred-metre spike on an island that declares a
 * thirty-five-metre peak. All of them took twenty agents and several hours of
 * measurement to find, and all of them would have taken one look.
 *
 * So: this samples `heightAt` over a map into a plain grid, and writes it with
 * everything else worth seeing — the runway, the roads, the helipads, the
 * harbour, the shoals, the named places. tools/blender_terrain.py turns that
 * into a mesh you can orbit.
 *
 *   node tools/heightfield.mjs <mapId> [samples] > out.json
 *   node tools/heightfield.mjs --all <outDir>
 *
 * Deliberately plain JSON and no dependencies: the point is that it works in
 * five years with whatever is lying around, not that it is fast.
 */

// The texture layer wants a canvas; nothing here draws, so a stub will do.
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
};

const HERE = new URL('../src/', import.meta.url).href;
const T = await import(HERE + 'world/terrain.js');
const { MAPS } = await import(HERE + 'world/maps.js');
const P = await import(HERE + 'world/pads.js');
const R = await import(HERE + 'world/roads.js');
const THREE = await import(HERE + 'vendor/three.module.js');

/** The square the map actually occupies, from its own chunks. */
function boundsOf(map) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const c of map.chunks || []) {
    x0 = Math.min(x0, c.cx - c.size / 2);
    x1 = Math.max(x1, c.cx + c.size / 2);
    z0 = Math.min(z0, c.cz - c.size / 2);
    z1 = Math.max(z1, c.cz + c.size / 2);
  }
  if (!Number.isFinite(x0)) return { x0: -6000, x1: 6000, z0: -6000, z1: 6000 };
  // A little margin, so the coast is not flush with the edge of the picture.
  const m = Math.max(x1 - x0, z1 - z0) * 0.04;
  return { x0: x0 - m, x1: x1 + m, z0: z0 - m, z1: z1 + m };
}

export function sampleMap(mapId, n = 220) {
  const map = MAPS.find((m) => m.id === mapId);
  if (!map) throw new Error(`no map called "${mapId}" — try one of: ${MAPS.map((m) => m.id).join(' ')}`);

  T.applyMap(map);
  T.clearObstacles();
  T.clearPlatforms();
  P.clearPads();

  // Roads first: they cut the terrain, so a grid sampled before them is a lie.
  let roads = (map.waters && map.waters.roads) || [];
  if (map.courier && !roads.length) {
    roads = R.buildRoads(map).roads;
    map.waters = map.waters || {};
    map.waters.roads = roads;
    delete map.waters._ready;
    T.applyMap(map);
  }
  // Pads register platforms, which heightAt returns over — build them so the
  // decks appear in the grid rather than the hillside underneath.
  let pads = [];
  try {
    P.buildPads(new THREE.Group());
    pads = P.PADS.map((p) => ({ id: p.id, name: p.name, x: p.pos.x, y: p.pos.y, z: p.pos.z, r: p.r, role: p.role }));
  } catch (err) {
    pads = [];
  }

  const b = boundsOf(map);
  const h = new Array(n * n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < n; j++) {
    const z = b.z0 + ((b.z1 - b.z0) * j) / (n - 1);
    for (let i = 0; i < n; i++) {
      const x = b.x0 + ((b.x1 - b.x0) * i) / (n - 1);
      const y = T.heightAt(x, z);
      h[j * n + i] = Math.round(y * 10) / 10;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }

  const rw = map.airport && map.airport.runway;
  const elev = map.airport ? map.airport.elev : T.AIRPORT.elev;
  const berth = T.harbourBerth();
  const mouth = T.harbourMouth();

  return {
    id: map.id,
    name: map.name,
    game: map.game || 'flight',
    bounds: b,
    n,
    seaFloor: map.seaFloor,
    min: Math.round(lo * 10) / 10,
    max: Math.round(hi * 10) / 10,
    heights: h,
    runway: rw
      ? { cx: rw.cx, cz: rw.cz, length: rw.length, halfWidth: rw.halfWidth, elev, headingDeg: (map.airport.headingDeg ?? 90) }
      : null,
    roads: roads.map((r) => ({ name: r.name || '', halfWidth: r.halfWidth || 13, path: r.path })),
    pads,
    harbour: berth && mouth ? { berth: [berth.x, berth.z], mouth: [mouth.x, mouth.z] } : null,
    marks: T.channelMarks().map((k) => [Math.round(k.x), Math.round(k.z), k.kind]),
    shoals: T.dryingShoals(3).map((s) => ({ name: s.name || '', x: s.cx, z: s.cz, r: s.r, top: s.top })),
    places: ((map.courier && map.courier.places) || []).map((p) => ({ id: p.id, name: p.name, x: p.x, z: p.z })),
    islands: (map.islands || []).map((i) => ({ name: i.name, cx: i.cx, cz: i.cz, radius: i.radius, peak: i.peak })),
    scenery: {
      town: (map.scenery && map.scenery.town) || null,
      lighthouse: (map.scenery && map.scenery.lighthouse) || null,
      deliveryPad: (map.scenery && map.scenery.deliveryPad) || null,
    },
  };
}

/* ---- run from the command line ---- */
const argv = process.argv.slice(2);
if (argv.length) {
  const fs = await import('node:fs');
  if (argv[0] === '--all') {
    const dir = argv[1] || '.';
    fs.mkdirSync(dir, { recursive: true });
    for (const m of MAPS) {
      const out = sampleMap(m.id, Number(argv[2]) || 180);
      fs.writeFileSync(`${dir}/${m.id}.json`, JSON.stringify(out));
      process.stderr.write(`${m.id.padEnd(18)} ${out.n}x${out.n}  ${out.min} to ${out.max} m\n`);
    }
  } else {
    process.stdout.write(JSON.stringify(sampleMap(argv[0], Number(argv[1]) || 220)));
  }
}
