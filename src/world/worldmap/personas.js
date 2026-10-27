/**
 * World Map — Preview: which of our own maps' airports each field is.
 *
 * Owner, Oct 26: "make the airports unique and not a horrible copy paste of
 * the others… use some of the maps we already have". Every field used to be
 * the same stamp: one white box of a terminal, one grey tower, grey sheds.
 * Now each field IS one of the hand-made maps' airports, brought into the
 * world and suited to its region — Gateway International as the capital's
 * hub, Ironhead Air Base on the southern sands with the carrier group
 * offshore, Northwatch at the far cold outpost, Nunatak's ice strip on a
 * northern skerry, Coral Lagoon and the atoll's strip in the tropics, Condor
 * Rock under the mainland's mountains — and takes from that map:
 *
 *   its NAME (the radio answers as it: "Gateway Tower"); a field keeps the
 *     World Map's own name only where the map's would clash (Haven, the
 *     preview's home, is built as Kestrel's field and keeps its name);
 *   its BUILDINGS' look: what the walls, roofs, glass and hangars are made
 *     of, the shape of the terminal, the tower and the hangars (STYLES);
 *   its LANDMARKS: what stands on or near that map's field — the air base's
 *     hardened shelters, Northwatch's radomes, the grain silos of Harrier
 *     Flats, Cutter Bay's dock cranes, the lighthouses of Sennen and the
 *     Skerries, the Sable cays' huts and daymark,
 *     Gateway's second concourse and multi-storey car park, Ember's water
 *     tower, Nunatak's fuel bladders, the atoll's palms.
 *
 * Runway numbers, approach lights, the PAPI, gate starts, the ground crew and
 * the traffic stay the game's own (airport.js and apron.js build the field
 * you start from; outstation.js draws the others to the same plan), so every
 * field still works like every other.
 *
 * WHERE THE LANDMARKS GO is MEASURED, not guessed: tools/worldmap/
 * preview-layout.mjs runs placeExtras() on the level site after the airport
 * layout is final (clear of every runway, taxiway, apron, building, the
 * helipad and the road), and placeLandmarks() on the real ground near the
 * field (a headland for a lighthouse, the shore for the cranes), and writes
 * the numbers into preview-data.js. The game only draws them.
 *
 * Pure: no THREE, no DOM. Node-safe.
 */

/** How each kind of field is built. Colours are sRGB hex. */
export const STYLES = Object.freeze({
  // Kestrel's own field: white render, a band of glass, a terracotta roof, a concrete tower.
  kestrel: { terminal: 'glass', roof: 'flat', tower: 'concrete', hangar: 'arch', wall: 0xece6da, roofCol: 0xa4553a, glass: 0x3b5466, hangarCol: 0xc6cacd, towerCol: 0xe9e5dc, trim: 0x2d3640 },
  // Gateway International: a long glazed hall under a pale wave roof, a tall slender tower.
  gateway: { terminal: 'hall', roof: 'wave', tower: 'slender', hangar: 'arch', wall: 0xd9dde0, roofCol: 0xb9c0c6, glass: 0x2f4a60, hangarCol: 0xd7dadc, towerCol: 0xf0f0ec, trim: 0x23303c },
  // Ironhead: desert tan concrete, flat roofs, a square ops tower, hardened shelters.
  military: { terminal: 'block', roof: 'flat', tower: 'square', hangar: 'shelter', wall: 0xb3a286, roofCol: 0x8c826e, glass: 0x45545c, hangarCol: 0x9e9682, towerCol: 0xbfb398, trim: 0x4d5a3e },
  // Northwatch: grey-green steel, snow on the roofs, radomes.
  arcticMilitary: { terminal: 'block', roof: 'flat', tower: 'square', hangar: 'quonset', wall: 0x7d8a86, roofCol: 0xf2f5f7, glass: 0x3c4c58, hangarCol: 0x6f7c78, towerCol: 0x8d9894, trim: 0x2f3a36, snow: true },
  // Nunatak: red insulated modules on stilts, like a polar station.
  polar: { terminal: 'modules', roof: 'flat', tower: 'lattice', hangar: 'quonset', wall: 0xc2412f, roofCol: 0xf2f5f7, glass: 0x34444f, hangarCol: 0xd3d6d8, towerCol: 0xe25a2a, trim: 0x1f262c, snow: true },
  // Sennen Cove, the Skerries: grey granite under dark slate, a squat stone tower.
  stone: { terminal: 'cottage', roof: 'gable', tower: 'club', hangar: 'shed', wall: 0x9a9890, roofCol: 0x3d4248, glass: 0x4a5e6c, hangarCol: 0x7f8488, towerCol: 0xb5b2a8, trim: 0x2b2f33 },
  // The Cape, the Skerries' crofts: white-harled walls, black roofs.
  harled: { terminal: 'cottage', roof: 'gable', tower: 'club', hangar: 'shed', wall: 0xf1efe8, roofCol: 0x2c3034, glass: 0x4d6474, hangarCol: 0x9aa0a4, towerCol: 0xf1efe8, trim: 0x1d2226 },
  // Harrier Flats, Brackwater: a farm field — red barns, a timber clubhouse.
  farm: { terminal: 'cottage', roof: 'gable', tower: 'club', hangar: 'barn', wall: 0xc9b48e, roofCol: 0x5a4a3a, glass: 0x50606a, hangarCol: 0x9c3a2c, towerCol: 0xd8ccb2, trim: 0x3a2e24 },
  // Cutter Bay, Longbank: brick sheds and a brick terminal by the docks.
  port: { terminal: 'block', roof: 'sawtooth', tower: 'concrete', hangar: 'shed', wall: 0x9a5a44, roofCol: 0x55595c, glass: 0x4b6676, hangarCol: 0x8a9298, towerCol: 0xd2cdc2, trim: 0x2a2f33 },
  // Longbank's sands: weathered sand-render and pale roofs.
  dune: { terminal: 'glass', roof: 'flat', tower: 'concrete', hangar: 'arch', wall: 0xdccba6, roofCol: 0xb0a48a, glass: 0x5b7c8c, hangarCol: 0xcfc6b4, towerCol: 0xe6dcc6, trim: 0x3b3a34 },
  // Condor Rock under the mountains: a stone-footed timber chalet, steep dark roofs.
  chalet: { terminal: 'chalet', roof: 'steep', tower: 'club', hangar: 'shed', wall: 0x7b5a3c, roofCol: 0x2e3236, glass: 0x4a5c68, hangarCol: 0x6b6f72, towerCol: 0x8a8f92, trim: 0x2a2420 },
  // Coral Lagoon and the atoll: white walls, open sides, deep palm-thatch roofs.
  tropical: { terminal: 'pavilion', roof: 'thatch', tower: 'club', hangar: 'shed', wall: 0xf4efe2, roofCol: 0xa88a52, glass: 0x5fa0a8, hangarCol: 0xd8d2c0, towerCol: 0xf4efe2, trim: 0x2f6f73 },
  // Ember Isle: black basalt walls, rust-red tin roofs.
  volcanic: { terminal: 'cottage', roof: 'gable', tower: 'concrete', hangar: 'shed', wall: 0x3d3a38, roofCol: 0x8e3b24, glass: 0x4c5c66, hangarCol: 0x5a5552, towerCol: 0x6a6460, trim: 0x1b1a19 },
  // The Sable Archipelago's cays: pastel clapboard and tin roofs.
  cay: { terminal: 'cottage', roof: 'gable', tower: 'club', hangar: 'shed', wall: 0x8cc9c2, roofCol: 0xaeb3b6, glass: 0x3f6670, hangarCol: 0xe3d7b8, towerCol: 0xf1d9a8, trim: 0x2b4f57 },
  // Brackwater Delta: tarred timber on stilts, reed-grey roofs.
  stilt: { terminal: 'stilts', roof: 'gable', tower: 'club', hangar: 'barn', wall: 0x5c4a38, roofCol: 0x6f6a58, glass: 0x4e5c5e, hangarCol: 0x4f5a4a, towerCol: 0x6a5a48, trim: 0x2a221a },
});

/*
 * The fields, by World Map id. `from` is the map whose airport this is; `name`
 * what the field is called (the radio's word is its first). Cold maps in the
 * north, tropical ones in the south, the mountain fields on the mainland, the
 * air base on the sands with the carrier group offshore, small strips small.
 */
export const PERSONAS = Object.freeze({
  haven: { from: 'kestrel', name: 'Haven International', style: 'kestrel', extras: ['concourse'], landmarks: ['lighthouse'] },
  gull: { from: 'sennen', name: 'Sennen Cove Strip', style: 'stone', extras: ['boathouse'], landmarks: ['lighthouse'] },
  tern: { from: 'meadow', name: 'Harrier Flats Field', style: 'farm', extras: ['silos', 'barn'], landmarks: [] },
  marram: { from: 'longbank', name: 'Longbank Regional', style: 'dune', extras: ['beacon'], landmarks: ['daymark'] },
  farhold: { from: 'harbour', name: 'Cutter Bay International', style: 'port', extras: ['warehouses', 'multistorey'], landmarks: ['cranes'] },
  aldermere: { from: 'gateway', name: 'Gateway International', style: 'gateway', extras: ['concourse', 'multistorey', 'cargo'], landmarks: [] },
  highfold: { from: 'condor', name: 'Condor Rock Regional', style: 'chalet', extras: ['mast', 'rescue'], landmarks: [] },
  saltmarsh: { from: 'delta', name: 'Brackwater Strip', style: 'stilt', extras: ['boardwalk'], landmarks: [] },
  frigate: { from: 'lagoon', name: 'Coral Lagoon Regional', style: 'tropical', extras: ['palms', 'cabanas'], landmarks: [] },
  mangrove: { from: 'atoll', name: 'Atoll Strip', style: 'tropical', extras: ['palms'], landmarks: [] },
  conch: { from: 'ember', name: 'Ember Isle Field', style: 'volcanic', extras: ['watertower'], landmarks: [] },
  eider: { from: 'skerries', name: 'Skerries Regional', style: 'harled', extras: ['boathouse'], landmarks: ['lighthouse'] },
  petrel: { from: 'nunatak', name: 'Nunatak Ice Strip', style: 'polar', extras: ['bladders', 'radome'], landmarks: [] },
  sandmere: { from: 'airbase', name: 'Ironhead Air Base', style: 'military', extras: ['shelters', 'blastwalls', 'radar'], landmarks: ['escorts'] },
  dune: { from: 'archipelago', name: 'Sable Archipelago Strip', style: 'cay', extras: ['huts', 'palms'], landmarks: ['daymark'] },
  farwatch: { from: 'northwatch', name: 'Northwatch Air Station', style: 'arcticMilitary', extras: ['radome', 'radome', 'shelters'], landmarks: [] },
});

export function personaFor(id) {
  return PERSONAS[id] || null;
}

/** The style a field is drawn in (Kestrel's for anything without a persona). */
export function styleOf(a) {
  const p = a && (a.persona || PERSONAS[a.id]);
  const k = p && (p.style || (PERSONAS[p] && PERSONAS[p].style));
  return STYLES[k] || STYLES.kestrel;
}

/**
 * Footprints of the extras, metres (w along the runway, d across it), the
 * height, and how close to the terminal they like to stand (`near`: 0 next
 * to it, 1 anywhere on the site).
 */
export const EXTRA_SIZES = Object.freeze({
  concourse: { w: 220, d: 40, h: 16, near: 0 },
  multistorey: { w: 90, d: 60, h: 18, near: 0.2 },
  cargo: { w: 160, d: 70, h: 18, near: 0.6 },
  shelters: { w: 48, d: 40, h: 12, near: 0.8, count: 4 },
  blastwalls: { w: 70, d: 4, h: 5, near: 0.8, count: 4 },
  radar: { w: 14, d: 14, h: 26, near: 1 },
  radome: { w: 24, d: 24, h: 26, near: 1 },
  silos: { w: 30, d: 12, h: 20, near: 0.6 },
  barn: { w: 36, d: 22, h: 12, near: 0.6 },
  warehouses: { w: 140, d: 50, h: 14, near: 0.7 },
  mast: { w: 10, d: 10, h: 62, near: 1 },
  rescue: { w: 40, d: 30, h: 12, near: 0.5 },
  boardwalk: { w: 60, d: 8, h: 2, near: 0.3 },
  palms: { w: 36, d: 24, h: 14, near: 0.2, count: 6 },
  cabanas: { w: 18, d: 14, h: 6, near: 0.3, count: 3 },
  watertower: { w: 14, d: 14, h: 24, near: 0.7 },
  bladders: { w: 40, d: 24, h: 3, near: 0.6 },
  boathouse: { w: 24, d: 14, h: 8, near: 0.6 },
  beacon: { w: 8, d: 8, h: 24, near: 1 },
  huts: { w: 12, d: 10, h: 5, near: 0.4, count: 3 },
});

/* ------------------------------------------------------------------ */
/* Placement (the tool runs these; the game only reads the numbers)    */
/* ------------------------------------------------------------------ */

/** Gap to any building; to paving, half the widest wingspan (an A380's 80 m) so no wingtip on a taxiway or stand can reach an extra. */
const GAP = 14;
const PAVE_GAP = 45;

function overlaps(a, b, m = 0) {
  return a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;
}

/**
 * Free spots on the field's level site for its extras, in the field's own
 * frame (x along the runway from its centre, z across, north negative), the
 * same frame as `a.layout`. `blocked` is extra world rectangles to keep off
 * (the helipad, the road). Deterministic.
 */
export function placeExtras(a, persona, blocked = []) {
  const lay = a.layout || {};
  const site = a.site;
  const S = { x0: site.x0 - a.x + 60, x1: site.x1 - a.x - 60, z0: site.z0 - a.z + 50, z1: site.z1 - a.z - 30 };
  const taken = [];
  const add = (r, gap = GAP) => taken.push({ ...r, gap });
  for (const p of lay.pavement || []) add(p, PAVE_GAP);
  for (const k of ['terminal', 'tower', 'fire', 'fuel', 'carPark']) if (lay[k]) add(lay[k]);
  for (const h of lay.hangars || []) add(h);
  if (lay.windsock) add({ x0: lay.windsock.x - 10, x1: lay.windsock.x + 10, z0: lay.windsock.z - 10, z1: lay.windsock.z + 10 });
  // The runway and its strip (and the PAPI and the edge lights beside it).
  add({ x0: -a.length / 2 - 600, x1: a.length / 2 + 600, z0: -a.halfWidth - 90, z1: a.halfWidth + 140 });
  for (const b of blocked) add({ x0: b.x0 - a.x, x1: b.x1 - a.x, z0: b.z0 - a.z, z1: b.z1 - a.z });
  const t = lay.terminal || lay.tower || { x0: -40, x1: 40, z0: S.z0, z1: S.z0 + 40 };
  const tc = { x: (t.x0 + t.x1) / 2, z: (t.z0 + t.z1) / 2 };
  const out = [];
  const step = 10;
  for (const kind of persona.extras || []) {
    const sz = EXTRA_SIZES[kind];
    if (!sz) continue;
    const n = sz.count || 1;
    for (let k = 0; k < n; k++) {
      let best = null;
      let bestScore = Infinity;
      for (let x = S.x0 + sz.w / 2; x <= S.x1 - sz.w / 2; x += step) {
        for (let z = S.z0 + sz.d / 2; z <= S.z1 - sz.d / 2; z += step) {
          const r = { x0: x - sz.w / 2, x1: x + sz.w / 2, z0: z - sz.d / 2, z1: z + sz.d / 2 };
          let hit = false;
          for (const q of taken) if (overlaps(r, q, q.gap)) { hit = true; break; }
          if (hit) continue;
          // Near the terminal for the ones that belong there; spread out (but tidy) for the rest.
          const d = Math.hypot(x - tc.x, z - tc.z);
          const score = sz.near < 0.5 ? d : Math.abs(d - 250 - sz.near * 400) + (k ? Math.hypot(x - (out[out.length - 1] || { x }).x, 0) * 0.01 : 0);
          if (score < bestScore) { bestScore = score; best = r; }
        }
      }
      if (!best) continue;
      taken.push({ ...best, gap: GAP });
      out.push({ kind, x0: Math.round(best.x0), x1: Math.round(best.x1), z0: Math.round(best.z0), z1: Math.round(best.z1), h: sz.h, x: Math.round((best.x0 + best.x1) / 2), z: Math.round((best.z0 + best.z1) / 2) });
    }
  }
  return out;
}

/**
 * Landmarks near the field on the real ground: a lighthouse or a daymark on
 * the nearest headland, dock cranes on the nearest shore, the carrier
 * group's escorts. World coordinates, with the ground height (`y`).
 * `heightAt` is terrain.js's; `carrier` the field's berth.
 */
export function placeLandmarks(a, persona, heightAt, carrier = null) {
  const out = [];
  const coast = (minR, maxR, wantH) => {
    // Ring search outward from the field: dry ground (2..wantH m) with the sea within 60 m seaward.
    let best = null;
    for (let r = minR; r <= maxR && !best; r += 150) {
      for (let i = 0; i < 48; i++) {
        const ang = (i / 48) * Math.PI * 2;
        const x = a.x + Math.cos(ang) * r;
        const z = a.z + Math.sin(ang) * r;
        const h = heightAt(x, z);
        if (h < 2 || h > wantH) continue;
        const ox = Math.cos(ang);
        const oz = Math.sin(ang);
        if (heightAt(x + ox * 60, z + oz * 60) > -1) continue;
        // Not in the runway's approach lanes.
        if (Math.abs(z - a.z) < 700 && Math.abs(x - a.x) < a.length / 2 + 7000) continue;
        best = { x: Math.round(x), z: Math.round(z), y: Math.round(h * 10) / 10, faceDeg: Math.round(((Math.atan2(ox, -oz) * 180) / Math.PI + 360) % 360) };
        break;
      }
    }
    return best;
  };
  for (const kind of persona.landmarks || []) {
    if (kind === 'lighthouse' || kind === 'daymark') {
      const p = coast(1200, 7000, 40);
      if (p) out.push({ kind, ...p, h: kind === 'lighthouse' ? 30 : 18 });
    } else if (kind === 'cranes') {
      const p = coast(900, 6000, 8);
      if (p) out.push({ kind, ...p, h: 46, count: 3 });
    } else if (kind === 'escorts' && carrier) {
      // Two escorts on the carrier's beam, a frigate's length of sea between them and the deck.
      for (const [dx, dz] of [[-900, -1200], [900, 600]]) {
        const x = carrier.x + dx;
        const z = carrier.z + dz;
        if (heightAt(x, z) < -12 && heightAt(x, z - 80) < -12 && heightAt(x, z + 80) < -12) out.push({ kind: 'escort', x, z, y: 0, h: 30, faceDeg: 0 });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Telling them apart                                                  */
/* ------------------------------------------------------------------ */

/**
 * What a field looks like, as one string: the layout's shape (every paved
 * piece and building, by kind and size), the style it is built in, and its
 * extras and landmarks by kind and size. Two fields with the same string
 * would look alike; the test wants none.
 */
export function lookSignature(a) {
  const lay = a.layout || {};
  const r = (q) => (q ? `${q.x1 - q.x0}x${q.z1 - q.z0}@${q.x0},${q.z0}` : '-');
  const st = styleOf(a);
  const parts = [
    lay.cls,
    (lay.pavement || []).map((p) => `${p.kind}:${r(p)}`).join(';'),
    `T${r(lay.terminal)}`, `W${r(lay.tower)}`, (lay.hangars || []).map(r).join(';'),
    `S:${st.terminal}/${st.roof}/${st.tower}/${st.hangar}/${st.wall}/${st.roofCol}/${st.hangarCol}`,
    (a.extras || []).map((e) => `${e.kind}:${r(e)}`).join(';'),
    (a.landmarks || []).map((e) => `${e.kind}`).join(';'),
    a.surface || 'tarmac',
  ];
  return parts.join('|');
}

/** A short hash of lookSignature (FNV-1a). */
export function lookHash(a) {
  let h = 0x811c9dc5;
  const s = lookSignature(a);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
