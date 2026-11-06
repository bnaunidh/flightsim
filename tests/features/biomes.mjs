/**
 * THE BIOMES (owner: "and more biomes, and better trees etc in those biomes"):
 * worldmap/biomes.js, flora.js's species, biome-trees.js, the cards' pictures.
 *
 *   node tests/features/biomes.mjs
 *
 *   - each biome stands where it was asked for, and the hub's island is as it was
 *   - no hard edges: the weights and the cover never jump between near neighbours
 *   - real dunes and mesas in the Sands, and none where the ground must stay calm
 *   - each biome grows its own trees, inside the tier's count, clear of runways,
 *     lanes, towns and roads
 *   - the trees: a bill like Scenery's, one unit tall; every species its own picture
 *   - the first load has none of it; the shader's dune sum is biomes.js's
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const T = await import('../../src/world/terrain.js');
const PV = await import('../../src/world/worldmap/preview.js');
const M = await import('../../src/world/maps.js');
const LC = await import('../../src/world/worldmap/landcover.js');
const B = await import('../../src/world/worldmap/biomes.js');
const FL = await import('../../src/world/worldmap/flora.js');
const BT = await import('../../src/world/worldmap/biome-trees.js');
const TC = await import('../../src/world/worldmap/tree-cards.js');

let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};

PV.setDeparture('haven');
const def = PV.previewDef();
T.applyMap(def);
const D = PV.PREVIEW;
const isl = (name) => D.islands.find((i) => i.name === name);
const H = T.groundHeightAt;
const slopeAt = (x, z) => Math.hypot(H(x + 20, z) - H(x - 20, z), H(x, z + 20) - H(x, z - 20)) / 40;
const cover = LC.coverFor(T);

/** The land of an island, averaged: the cover and the biome weights. */
function survey(i) {
  const acc = new Float64Array(15);
  let n = 0;
  const r = i.radius * 1.2;
  for (let x = i.cx - r; x < i.cx + r; x += r / 16) {
    for (let z = i.cz - r; z < i.cz + r; z += r / 16) {
      const h = H(x, z);
      if (h < 1.5) continue;
      const c = cover(x, z, h, slopeAt(x, z));
      for (let k = 0; k < 15; k++) acc[k] += c[k];
      n++;
    }
  }
  return { sand: acc[0] / n, rock: acc[2] / n, farm: acc[3] / n, forest: acc[4] / n, scrub: acc[5] / n, wet: acc[6] / n, desert: acc[11] / n, savanna: acc[12] / n, jungle: acc[13] / n, autumn: acc[14] / n };
}

/* ---- where ---- */
const sm = survey(isl('Sandmere'));
ok('desert on the Southern Sands: Sandmere is sand, no farms, no forest', sm.desert > 0.9 && sm.sand > 0.85 && sm.farm < 0.02 && sm.forest < 0.02, JSON.stringify(sm));
const fr = survey(isl('Frigate Island'));
ok('jungle on the Sunstring: Frigate Island is mostly closed canopy', fr.jungle > 0.9 && fr.forest > 0.55, JSON.stringify(fr));
const mg = survey(isl('Mangrove Cay'));
const pc = survey(isl('Parrot Cay'));
ok('mangrove on the low flat tropical coasts', mg.wet > 0.2 && pc.wet > 0.2, `Mangrove Cay ${mg.wet.toFixed(2)}, Parrot Cay ${pc.wet.toFixed(2)}`);
const mr = survey(isl('Marram Point'));
const pa = survey(isl('Palm Atoll'));
ok('savanna round the desert and at Marram Point, little forest', mr.savanna > 0.8 && pa.savanna > 0.8 && mr.forest < 0.15, `Marram ${mr.savanna.toFixed(2)}, Palm Atoll ${pa.savanna.toFixed(2)}`);
const hv = survey(isl('Highfold Vale'));
const wr = survey(isl('Westreach'));
ok('autumn on part of Westreach, not all of it', hv.autumn > 0.9 && wr.autumn > 0.15 && wr.autumn < 0.5, `Highfold Vale ${hv.autumn.toFixed(2)}, Westreach ${wr.autumn.toFixed(2)}`);
const ei = survey(isl('Eider Island'));
ok('the north has real woods now, and still its heath', ei.forest > 0.2 && ei.scrub > 0.35, JSON.stringify(ei));
const hi = survey(isl('Haven Island'));
ok('the hub\'s island is in none of them', hi.desert + hi.savanna + hi.jungle + hi.autumn < 0.001, JSON.stringify(hi));
{
  const hp = T.groundHeightAt(-77600, -7000);
  const c = cover(-77600, -7000, hp, 0.2);
  ok('alpine: the high range is bare rock', hp > 1500 && c[2] > 0.8 && c[4] < 0.02, `${hp.toFixed(0)} m, rock ${c[2].toFixed(2)}, forest ${c[4].toFixed(2)}`);
}

/* ---- no hard edges ---- */
{
  let worstW = 0;
  let worstF = 0;
  let sum = 0;
  const a = new Float32Array(4);
  const b = new Float32Array(4);
  const c0 = new Float32Array(15);
  const c1 = new Float32Array(15);
  for (let x = -110000; x < 110000; x += 1700) {
    for (let z = -6000; z < 110000; z += 1700) {
      B.biomeAt(x, z, a);
      B.biomeAt(x + 200, z + 200, b);
      sum = Math.max(sum, a[0] + a[1] + a[2]);
      for (let k = 0; k < 4; k++) worstW = Math.max(worstW, Math.abs(a[k] - b[k]));
      LC.coverAt(x, z, 60, 0.04, false, c0);
      LC.coverAt(x + 200, z + 200, 60, 0.04, false, c1);
      worstF = Math.max(worstF, Math.abs(c0[4] - c1[4]), Math.abs(c0[3] - c1[3]));
    }
  }
  ok('no hard edges: over 280 m no biome weight moves by more than 0.25', worstW < 0.25, worstW.toFixed(3));
  ok('...and the biomes that share ground never add to more than 1', sum <= 1.0001, sum.toFixed(3));
}

/* ---- the desert's shape ---- */
{
  let dunes = 0;
  let tall = 0;
  let n = 0;
  const i = isl('Sandmere');
  for (let x = i.cx - 7000; x < i.cx + 7000; x += 120) {
    for (let z = i.cz - 6000; z < i.cz + 6000; z += 120) {
      const h = H(x, z);
      if (h < 6) continue;
      n++;
      if (h > 22) dunes++;
      if (h > 75) tall++;
    }
  }
  ok('real dunes and rock tables on Sandmere', dunes / n > 0.1 && tall / n > 0.03, `${(dunes / n * 100).toFixed(0)}% over 22 m, ${(tall / n * 100).toFixed(0)}% over 75 m`);
  let cut = 0;
  for (let x = -66000; x < -28000; x += 60) {
    for (let z = 66000; z < 92000; z += 60) if (H(x, z) > 70 && H(x + 300, z) < 40 && H(x - 300, z) > 70) cut++;
  }
  ok('walls down off the tables to the desert floor, and canyons through them', cut > 40, `${cut} rims`);
  const bad = [];
  for (const a of D.airports.filter((p) => p.z > 46000)) {
    for (let d = -a.length / 2 - 1500; d <= a.length / 2 + 1500; d += 200) if (T.calmAt(a.x + d, a.z) < 1) bad.push(`${a.code} ${d}`);
    if (Math.abs(T.heightAt(a.x, a.z) - a.elev) > 1.5) bad.push(`${a.code} at ${T.heightAt(a.x, a.z).toFixed(1)}`);
  }
  for (const r of D.roads) for (const p of r.path) if (p[1] > 46000 && T.calmAt(p[0], p[1]) < 1) bad.push(`road ${p[0]}, ${p[1]}`);
  ok('no dune on a runway, its overrun, or a road', bad.length === 0, bad.slice(0, 4).join('; '));
  ok('sculpt touches nothing north of the Sands, and no calm ground', B.sculpt(9, 0, 0, () => 0) === 9 && B.sculpt(9, -33000, 74000, () => 1) === 9);
  ok('the dunes are the World Map\'s alone', M.MAPS.every((m) => !m._sculpt) && def._sculpt === B.sculpt && def.sculpted === true);
}

/* ---- their trees ---- */
{
  const ctx = FL.floraContext(D);
  const count = (name) => {
    const i = isl(name);
    const out = {};
    let n = 0;
    for (let ix = Math.floor((i.cx - i.radius) / FL.CELL); ix <= Math.floor((i.cx + i.radius) / FL.CELL); ix++) {
      for (let iz = Math.floor((i.cz - i.radius) / FL.CELL); iz <= Math.floor((i.cz + i.radius) / FL.CELL); iz++) {
        const t = FL.placeCell(T, ctx, ix, iz, 400);
        if (!t) continue;
        ok.max = Math.max(ok.max || 0, t.length / 6);
        for (let k = 0; k < t.length; k += 6) {
          const s = FL.SPECIES[t[k + 5]];
          out[s] = (out[s] || 0) + 1;
          n++;
        }
      }
    }
    for (const k of Object.keys(out)) out[k] = +(out[k] / n).toFixed(2);
    return { n, ...out };
  };
  const j = count('Frigate Island');
  ok('jungle grows hardwoods', j.hardwood > 0.3 && !j.conifer, JSON.stringify(j));
  const d = count('Sandmere');
  ok('desert grows cactus and little else', d.cactus > 0.3 && !d.broadleaf && d.n < 3000, JSON.stringify(d));
  const s = count('Marram Point');
  ok('savanna grows flat-tops', s.acacia > 0.4, JSON.stringify(s));
  const m = count('Parrot Cay');
  ok('mangrove coasts grow mangroves', m.mangrove > 0.1, JSON.stringify(m));
  const a = count('Highfold Vale');
  ok('autumn woods turn', a.autumn > 0.25 && a.broadleaf < a.autumn, JSON.stringify(a));
  const c = count('Eider Island');
  ok('the north grows snow-loaded pines, and no palms', c.snowpine > 0.3 && !c.palm, JSON.stringify(c));
  const u = count('Highfold Range');
  ok('the range grows conifers, thinning out', u.conifer > 0.2 && u.n < 16000, JSON.stringify(u));
  ok('no cell over the tier\'s count', ok.max <= 400, `${ok.max} at most`);
  const t = FL.placeCell(T, ctx, Math.floor(-30000 / FL.CELL), Math.floor(70800 / FL.CELL), 400) || [];
  const hit = [];
  for (let k = 0; k < t.length; k += 6) if (Math.abs(t[k + 2] - 70800) < 400) hit.push(t[k]);
  ok('still clear of a runway\'s lanes in the desert', hit.length === 0, `${t.length / 6} trees`);
}

/* ---- the trees themselves ---- */
{
  const kinds = [6, 7, 8, 9, 10, 11];
  const stats = kinds.map((k) => {
    const g = BT.biomeTreeGeometry(k);
    g.computeBoundingBox();
    const out = { v: g.attributes.position.count, y: g.boundingBox.max.y, nan: [...g.attributes.position.array].some((n) => !Number.isFinite(n)), col: !!g.attributes.color };
    g.dispose();
    return out;
  });
  const outward = kinds.map((k) => {
    const g = BT.biomeTreeGeometry(k);
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const ix = g.index.array;
    let good = 0;
    for (let i = 0; i < ix.length; i += 3) {
      const [a, b, c] = [ix[i] * 3, ix[i + 1] * 3, ix[i + 2] * 3];
      const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (f[0] * (n[a] + n[b] + n[c]) + f[1] * (n[a + 1] + n[b + 1] + n[c + 1]) + f[2] * (n[a + 2] + n[b + 2] + n[c + 2]) > 0) good++;
    }
    g.dispose();
    return good / (ix.length / 3);
  });
  ok('their faces point outward (a tree wound inside out is culled to a shell)', outward.every((v) => v > 0.75), outward.map((v) => v.toFixed(2)).join(', '));
  ok('the new trees cost what Scenery\'s do (560 vertices at most), one unit tall, coloured', stats.every((s) => s.v <= 560 && s.y > 0.85 && s.y < 1.05 && !s.nan && s.col), stats.map((s) => s.v).join(', '));
  const geos = FL.SPECIES.map((_, k) => TC.cardGeometry(k));
  const seen = new Set();
  geos.forEach((g, k) => { if (FL.SPECIES[k] !== 'thorn') seen.add(`${g.attributes.uv.getX(0)},${g.attributes.uv.getY(0)}`); });
  ok('every species its own picture (the World Map plants no thorn)', seen.size === FL.SPECIES.length - 1, `${seen.size}`);
  const mg2 = TC.mergedCardGeometry();
  ok('one card geometry for them all: sixteen vertices, four quads', mg2.attributes.position.count === 16 && mg2.index.count === 24);
}

/* ---- the first load, and the shader ---- */
{
  const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n;]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const m of [...text.matchAll(IMPORT_RE)]) if (m[1].startsWith('.')) walk(resolve(dirname(file), m[1]));
  };
  walk(resolve(ROOT, 'src/main.js'));
  ok('none of it in the first load', ![...seen].some((f) => /biomes\.js|biome-trees\.js|flora\.js|tree-cards\.js$/.test(f)));
  const glsl = src('src/world/worldmap/world-terrain.js');
  const js = src('src/world/worldmap/biomes.js');
  const nums = (s) => (s.replace(/vec2/g, '').match(/\d+(\.\d+)?/g) || []).map(Number).join(',');
  const a = js.match(/dunePhase = \(x, z\) => \((.+)\) \/ 560;/);
  const b = glsl.match(/float da = \((.+)\) \/ 560\.0;/);
  ok('the shader\'s dunes are biomes.js\'s dunes, the same sum', !!a && !!b && nums(a[1]) === nums(b[1]), a && b ? `${nums(a[1])} / ${nums(b[1])}` : 'not found');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
