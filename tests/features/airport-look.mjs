/**
 * Node checks for wave 13's airport look and UI fixes:
 * `node tests/features/airport-look.mjs`.
 *
 *   - PARKING LOTS: a per-site flag in world data (maps.js `parking`), on
 *     every map; car parks only where it is true — none at the air bases,
 *     Nunatak (the FOB and the Site), the remote strips, the heliports or the
 *     seaplane bays — and every commercial airport that asks for one gets one.
 *   - MINIMAP SNOW: the chart's land comes from the map's own terrain palette:
 *     Nunatak's is snow (white / blue-grey), not green; its crags are grey;
 *     its frozen lake is pale ice; a temperate map is still green.
 *   - DAMAGE ICON SHAPE: every aircraft in the roster gets a damage diagram of
 *     its own family (flying wing, delta, swing wing, helicopter, tandem, or
 *     conventional), with all five zones drawn, in its own proportions.
 *
 *   - TAXI/RUNWAY MARKINGS: lead-on/off lines onto the runway centreline at
 *     every connector, fillets into the parallel taxiway, a hold at every
 *     runway entry (the crosswind runway's crossings too, both sides, with no
 *     centreline across the runway), double edge lines broken at the mouths,
 *     green centreline lights and green/yellow exit lights.
 *   - SIGNS: a mandatory sign at every runway entry, junction arrays, the
 *     airport's name in letters on the roof, lit at night.
 *   - TERMINAL: only some rooms lit at night (lounges up, shops down), a
 *     96 m repeat in 6 m bays; the jet bridges telescope (three sections,
 *     collars, cab with bellows, column, bogie) and still dock.
 * Exits non-zero on any failure.
 */

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: () => ({
      getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
      width: 0,
      height: 0,
      style: {},
    }),
    body: { appendChild() {} },
    head: { appendChild() {} },
  };
}
if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {}, devicePixelRatio: 1 };

const src = new URL('../../src/', import.meta.url).href;
const Terrain = await import(src + 'world/terrain.js');
const { MAPS } = await import(src + 'world/maps.js');
const LAY = await import(src + 'world/airport-layout.js');
// Imported while Kestrel (which has a crosswind runway) is the map: airport.js
// reads RUNWAY2 at import.
const AP = await import(src + 'world/airport.js');

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
}

/* ------------------------------------------------------------------ */
/* Parking lots                                                        */
/* ------------------------------------------------------------------ */
{
  const missing = MAPS.filter((m) => typeof m.parking !== 'boolean').map((m) => m.id);
  ok('parking: every map says whether its airfield has a car park (maps.js `parking`)', missing.length === 0, missing.join(', ') || `${MAPS.length} maps`);

  // Owner, Oct 25: none at military bases, the SCP site, small/remote strips,
  // heliports, seaplane bays, snowy outposts.
  const NONE = ['airbase', 'northwatch', 'nunatak', 'stacks', 'rigs', 'firewatch', 'carriergroup', 'sennen', 'skerries', 'longbank', 'harbour', 'lagoon', 'delta', 'archipelago'];
  const wrongFlag = NONE.filter((id) => (MAPS.find((m) => m.id === id) || {}).parking !== false);
  ok('parking: no car park flagged at the bases, Nunatak, the strips, heliports and seaplane bays', wrongFlag.length === 0, wrongFlag.join(', ') || NONE.length + ' sites');

  const built = [];
  const leaked = [];
  const lostCommercial = [];
  for (const m of MAPS) {
    Terrain.applyMap(m.id);
    const L = LAY.airportLayout();
    if (L.carPark) built.push(m.id);
    if (L.carPark && m.parking !== true) leaked.push(m.id);
    if (m.parking === true && L.shape !== 'none' && !L.carPark && !L.dropped.includes('car park')) lostCommercial.push(m.id);
    if (L.military && L.carPark) leaked.push(`${m.id} (military)`);
    if (L.parking !== (m.parking === true)) leaked.push(`${m.id} (layout.parking ${L.parking})`);
  }
  ok('parking: a car park is laid only where the map asks for one', leaked.length === 0, leaked.join(', ') || `built at ${built.join(', ')}`);
  ok('parking: every commercial airport that asks for a car park gets one', lostCommercial.length === 0, lostCommercial.join(', ') || `${built.length} airports`);
  // The car park is the template's size: a hub's bigger than a regional's.
  Terrain.applyMap('gateway');
  const hub = LAY.airportLayout().carPark;
  Terrain.applyMap('kestrel');
  const reg = LAY.airportLayout().carPark;
  const area = (c) => (c ? (c.rect.x1 - c.rect.x0) * (c.rect.z1 - c.rect.z0) : 0);
  ok('parking: sized to the airport (the hub\'s car park is bigger than a regional one\'s)', area(hub) > area(reg) && area(reg) > 0, `gateway ${Math.round(area(hub))} m2, kestrel ${Math.round(area(reg))} m2`);
  ok('parking: hasParking() reads the flag, and a map that does not say gets none', LAY.hasParking({ parking: true }) && !LAY.hasParking({}) && !LAY.hasParking({ parking: false }) && !LAY.hasParking(null));
}

/* ------------------------------------------------------------------ */
/* The minimap's land, from the map's palette                         */
/* ------------------------------------------------------------------ */
{
  const CP = await import(src + 'ui/chart-palette.js');
  const pal = (id) => (MAPS.find((m) => m.id === id) || {}).palette || {};
  const isGreen = ([r, g, b]) => g > r * 1.12 && g > b * 1.12;
  const isSnow = ([r, g, b]) => r > 175 && g > 180 && b > 190 && b >= r - 2 && Math.max(r, g, b) - Math.min(r, g, b) < 40;

  const N = CP.chartColours(pal('nunatak'));
  const flat = CP.landColour(40, 0, N, [0, 0, 0], 0.5);
  const lowBeach = CP.landColour(3, 0, N, [0, 0, 0], 0.5);
  const shaded = CP.landColour(40, -0.3, N, [0, 0, 0], 0.5);
  const crag = CP.landColour(220, 1.9, N, [0, 0, 0], 0.5);
  ok('minimap: Nunatak\'s plain is snow, not green', isSnow(flat) && !isGreen(flat), flat.map(Math.round).join(','));
  ok('minimap: ...right down to the shore (the snow line is under the sea there)', isSnow(lowBeach), lowBeach.map(Math.round).join(','));
  ok('minimap: snow in shadow goes blue-grey, not brown', shaded[2] >= shaded[0] && shaded[2] > 150 && !isGreen(shaded), shaded.map(Math.round).join(','));
  ok('minimap: the crags are grey rock', !isGreen(crag) && Math.max(...crag) - Math.min(...crag) < 45 && crag[0] < 190, crag.map(Math.round).join(','));

  Terrain.applyMap('nunatak');
  const ice = CP.iceShapes(Terrain.FLATS);
  const lake = (Terrain.FLATS || []).find((f) => f.kind === 'lake');
  ok('minimap: the frozen lake is ice on the chart', !!lake && CP.onIce(ice, (lake.x0 + lake.x1) / 2, (lake.z0 + lake.z1) / 2) && !CP.onIce(ice, lake.x0 + 2, lake.z0 + 2),
    lake ? `${ice.length} ice shapes; the lake's middle is ice, its rectangle's corner is not` : 'no lake');

  const K = CP.chartColours(pal('kestrel'));
  const kGrass = CP.landColour(40, 0, K, [0, 0, 0], 0.5);
  ok('minimap: a temperate map is still green', isGreen(kGrass), kGrass.map(Math.round).join(','));

  // Every map: the chart's grass is the terrain's grass tint, unless snow covers it.
  const bad = [];
  for (const m of MAPS) {
    const P = m.palette || {};
    const C = CP.chartColours(P);
    const c = CP.landColour(40, 0, C, [0, 0, 0], 0.5);
    const snowy = P.snow && 40 >= P.snow[1] + 45;
    if (snowy && !isSnow(c)) bad.push(`${m.id}: snowy but ${c.map(Math.round)}`);
    if (!snowy && P.grass) {
      const want = [74 * P.grass[0], 104 * P.grass[1], 62 * P.grass[2]];
      if (want.some((v, i) => Math.abs(Math.min(255, v) - c[i]) > 2)) bad.push(`${m.id}: ${c.map(Math.round)} not ${want.map(Math.round)}`);
    }
  }
  ok('minimap: every map\'s chart land is its terrain palette (desert sand, snow, green...)', bad.length === 0, bad.join('; ') || `${MAPS.length} maps`);
}

/* ------------------------------------------------------------------ */
/* The damage diagram, per aircraft                                    */
/* ------------------------------------------------------------------ */
{
  const { AIRCRAFT } = await import(src + 'aircraft/types.js');
  const D = await import(src + 'ui/damage-planform.js');
  const ZONES = ['leftWing', 'rightWing', 'nose', 'fuselage', 'tail'];
  const want = { nightjar: 'flyingWing', concorde: 'delta', b1b: 'swing', bell407: 'heli', h145: 'heli', r44: 'heli', aw139: 'heli', uh60: 'heli', ah64: 'heli', vh3d: 'heli', ch47: 'tandem', harrier: 'heli', a320: 'conventional', skylark: 'conventional', f22: 'conventional', c17: 'conventional' };
  const wrongKind = [];
  const broken = [];
  const shapes = new Map();
  /** The path data's points, as [x, y] in the 80 x 80 box. */
  const pts = (d) => (String(d).match(/-?\d+(\.\d+)?/g) || []).map(Number).reduce((a, v, i, arr) => (i % 2 ? a : a.concat([[v, arr[i + 1]]])), []);
  const box = (list) => {
    const xs = list.map((p) => p[0]);
    const ys = list.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  for (const t of AIRCRAFT) {
    const p = D.damagePlanform(t);
    shapes.set(t.id, p);
    if (want[t.id] && p.kind !== want[t.id]) wrongKind.push(`${t.id} is ${p.kind}, not ${want[t.id]}`);
    for (const z of ZONES) {
      const d = p.zones[z];
      if (!d || /NaN|Infinity/.test(d) || pts(d).length < 3) broken.push(`${t.id}.${z}`);
      else if (pts(d).some(([x, y]) => x < -0.5 || x > 80.5 || y < -0.5 || y > 80.5)) broken.push(`${t.id}.${z} outside the box`);
    }
    if (!(p.svg.match(/data-zone=/g) || []).length === 5) broken.push(`${t.id} svg`);
  }
  ok('damage: each aircraft is drawn as its own kind (B-2 flying wing, Concorde delta, B-1B swing wing, helicopters rotor + boom, the Chinook tandem)', wrongKind.length === 0, wrongKind.join('; ') || `${AIRCRAFT.length} types`);
  ok('damage: every type has all five zones, closed and inside the diagram', broken.length === 0, broken.slice(0, 8).join(', ') || 'all there');

  // Proportions: the B-2 is far wider than it is long; Concorde far longer
  // than it is wide; an airliner's tail is behind its nose.
  const ext = (id, zones = ZONES) => box(zones.flatMap((z) => pts(shapes.get(id).zones[z])));
  const b2 = ext('nightjar');
  const cc = ext('concorde');
  const a3 = shapes.get('a320');
  const noseY = box(pts(a3.zones.nose));
  const tailY = box(pts(a3.zones.tail));
  ok('damage: the B-2 diagram is a wing — more than twice as wide as it is long', (b2.x1 - b2.x0) > 2 * (b2.y1 - b2.y0), `${(b2.x1 - b2.x0).toFixed(0)} x ${(b2.y1 - b2.y0).toFixed(0)}`);
  ok('damage: Concorde is long and slim, a delta with no tailplane', (cc.y1 - cc.y0) > 2 * (cc.x1 - cc.x0) && box(pts(shapes.get('concorde').zones.tail)).x1 - box(pts(shapes.get('concorde').zones.tail)).x0 < (cc.x1 - cc.x0) * 0.2,
    `${(cc.x1 - cc.x0).toFixed(0)} x ${(cc.y1 - cc.y0).toFixed(0)}`);
  ok('damage: nose up, tail down, left wing on the left', noseY.y0 < tailY.y0 && box(pts(a3.zones.leftWing)).x1 <= 40.5 && box(pts(a3.zones.rightWing)).x0 >= 39.5);
  const heli = shapes.get('bell407');
  const ch = shapes.get('ch47');
  ok('damage: a helicopter has its rotor disc drawn round it (one main, one tail), the Chinook two', heli.rings.length === 2 && heli.rings.some((r) => !r.small) && ch.rings.length === 2 && ch.rings.every((r) => !r.small),
    `bell407 ${heli.rings.length}, ch47 ${ch.rings.length}`);
  const fallback = D.damagePlanform(null);
  ok('damage: with no type it is still a whole aeroplane', fallback.kind === 'conventional' && ZONES.every((z) => fallback.zones[z]));
}

/* ------------------------------------------------------------------ */
/* Taxi and runway markings, and the lights                            */
/* ------------------------------------------------------------------ */
{
  const MK = await import(src + 'world/airport-markings.js');
  const near = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
  const noLead = [];
  const noHold = [];
  const noFillet = [];
  const crossBad = [];
  const lightBad = [];
  const edgeBad = [];
  let crossings = 0;
  let maps = 0;
  for (const m of MAPS) {
    Terrain.applyMap(m.id);
    const L = LAY.airportLayout();
    if (!L.taxiway) continue;
    maps++;
    const F = L.frame;
    const M = MK.taxiMarkings(L);
    const rcz = L.runway.cz;
    for (const c of L.connectors.filter((x) => !x.onRunway)) {
      // Lead-on/off: both ways, starting on the connector's centreline at the
      // runway edge and ending ON the runway centreline, tangent to it.
      const leads = M.lines.filter((l) => l.kind === 'lead' && l.connector === c.id);
      const good = leads.filter((l) => {
        const a = l.pts[0];
        const b = l.pts[l.pts.length - 1];
        const b2 = l.pts[l.pts.length - 2];
        return near(a, [F.x(c.u), F.z(L.runway.halfWidth)], 0.05) && Math.abs(b[1] - rcz) < 0.05 && Math.abs(b2[1] - rcz) < Math.abs(b2[0] - b[0]) * 0.2;
      });
      if (good.length !== 2 || new Set(leads.map((l) => l.dir)).size !== 2) noLead.push(`${m.id} ${c.id}`);
      // A hold on every connector, across it, between the runway and the taxiway.
      const h = M.holds.find((x) => x.connector === c.id);
      const w = h ? (h.z - F.cz) * F.side : NaN;
      if (!h || !(w > L.runway.halfWidth + 10 && w < L.taxiway.w - L.taxiway.width / 2)) noHold.push(`${m.id} ${c.id}`);
      // Fillets into the parallel taxiway, wherever the taxiway carries on.
      const fill = M.lines.filter((l) => l.kind === 'fillet' && l.connector === c.id);
      const th = L.taxiway.width / 2;
      const room = [-1, 1].filter((s) => c.u + s * th >= L.taxiway.u0 + th + 2 && c.u + s * th <= L.taxiway.u1 - th - 2).length;
      if (fill.length !== room) noFillet.push(`${m.id} ${c.id} ${fill.length}/${room}`);
      // Exit lights: green and yellow by turns from the runway to the hold.
      const exit = M.lights.filter((l) => l.exit && Math.abs(l.x - F.x(c.u)) < L.runway.halfWidth + 1);
      const cols = new Set(exit.map((l) => l.hex));
      if (exit.length < 4 || cols.size !== 2) lightBad.push(`${m.id} ${c.id}: ${exit.length} exit lights`);
    }
    // Every crossing of the crosswind runway: a hold each side, and no
    // centreline paint or green light on the runway itself.
    for (const x of L.crossings || []) {
      crossings++;
      const hs = M.holds.filter((h) => h.crossing === x.id);
      if (hs.length !== x.holds.length || x.holds.length < 1) crossBad.push(`${m.id}: ${hs.length} holds`);
      for (const h of hs) {
        const u = h.x - F.cx;
        if (!(u < x.u0 || u > x.u1)) crossBad.push(`${m.id}: a hold on the runway`);
        // The runway is on the hold's dashed side: (nx) points at it.
        const toward = (x.u0 + x.u1) / 2 - u;
        if (Math.sign(toward) !== Math.sign(h.nx)) crossBad.push(`${m.id}: a hold facing the wrong way`);
      }
      const onRw = (px) => px - F.cx > x.u0 && px - F.cx < x.u1;
      const centreOn = M.lines.filter((l) => l.kind === 'centre' && !l.connector).some((l) => l.pts.some((p) => onRw(p[0])) || (l.pts[0][0] - F.cx < x.u0 && l.pts[1][0] - F.cx > x.u1));
      const lightOn = M.lights.some((l) => onRw(l.x) && Math.abs((l.z - F.cz) * F.side - L.taxiway.w) < 2);
      if (centreOn || lightOn) crossBad.push(`${m.id}: centreline ${centreOn ? 'painted' : ''} ${lightOn ? 'lit' : ''} across the runway`);
      if (!L.signs.some((sg) => sg.kind === 'mandatory' && sg.hold === x.id)) crossBad.push(`${m.id}: no runway sign at the crossing`);
    }
    // Taxiway centreline lights: green, about every 15 m along it.
    const green = M.lights.filter((l) => !l.exit && Math.abs((l.z - F.cz) * F.side - L.taxiway.w) < 0.1);
    const want = (L.taxiway.u1 - L.taxiway.u0) / 15;
    if (green.length < want * 0.6) lightBad.push(`${m.id}: ${green.length} centreline lights on ${Math.round(L.taxiway.u1 - L.taxiway.u0)} m`);
    if (!green.every((l) => l.hex === 0x1fff3e)) lightBad.push(`${m.id}: a centreline light not green`);
    // Edge lines: double, both sides, broken at each connector's mouth.
    const edges = M.lines.filter((l) => l.kind === 'edge' && !l.connector);
    const mouthPainted = L.connectors.some((c) => edges.some((l) => {
      const w = (l.pts[0][1] - F.cz) * F.side;
      const a = Math.min(l.pts[0][0], l.pts[1][0]) - F.cx;
      const b = Math.max(l.pts[0][0], l.pts[1][0]) - F.cx;
      return w < L.taxiway.w && a < c.u && b > c.u;
    }));
    if (edges.length < 4 || mouthPainted) edgeBad.push(`${m.id}: ${edges.length} edge lines${mouthPainted ? ', painted across a connector' : ''}`);
  }
  ok('markings: every connector has lead-on/lead-off lines curving onto the runway centreline both ways', noLead.length === 0, noLead.join(', ') || `${maps} airfields`);

  /*
   * Runway markings take precedence: no yellow painted over the threshold
   * bars, the numbers, the aiming blocks or the touchdown-zone bars. On the
   * strips every end connector met the runway beside its numbers and the
   * curve ran straight across "09"; at Gateway and the air bases A1 and A5
   * curved across the piano keys.
   */
  {
    const onWhite = [];
    let painted = 0;
    let leads = 0;
    let midBoth = 0;
    let mids = 0;
    for (const m of MAPS) {
      Terrain.applyMap(m.id);
      const L = LAY.airportLayout();
      if (!L.taxiway) continue;
      const F = L.frame;
      const white = MK.runwayWhite(L);
      const M = MK.taxiMarkings(L);
      for (const l of M.lines.filter((x) => x.kind === 'lead')) {
        leads++;
        if (l.pieces.length) painted++;
        for (const p of l.pieces) {
          for (let i = 1; i < p.length; i++) {
            const u = (p[i][0] + p[i - 1][0]) / 2 - F.cx;
            const w = ((p[i][1] + p[i - 1][1]) / 2 - F.cz) * F.side;
            if (MK.onWhite(white, u, w, 0.1)) {
              onWhite.push(`${m.id} ${l.connector}${l.dir > 0 ? '+' : '-'}`);
              break;
            }
          }
        }
      }
      // A connector in the middle third of the runway is clear of every end
      // marking: both its lead lines are painted, whole or nearly.
      for (const c of L.connectors.filter((x) => !x.onRunway && Math.abs(x.u) < L.runway.length / 6)) {
        mids++;
        const ls = M.lines.filter((x) => x.kind === 'lead' && x.connector === c.id);
        if (ls.length === 2 && ls.every((x) => x.pieces.length > 0)) midBoth++;
      }
    }
    ok('markings: no lead-on line is painted over the runway\'s own white markings (numbers, threshold, aiming, touchdown zone)', onWhite.length === 0 && painted > leads * 0.7, onWhite.slice(0, 6).join(', ') || `${painted} of ${leads} painted`);
    ok('markings: a mid-runway connector keeps both its lead-on lines', mids > 20 && midBoth === mids, `${midBoth} of ${mids}`);
  }
  ok('markings: a holding position on every connector, between the runway and the taxiway', noHold.length === 0, noHold.join(', '));
  ok('markings: the connectors curve into the parallel taxiway (fillets) wherever it carries on', noFillet.length === 0, noFillet.join(', '));
  ok('markings: every crossing of the crosswind runway has holds both sides, a runway sign, and no centreline across it', crossBad.length === 0 && crossings > 0, crossBad.join('; ') || `${crossings} crossings`);
  ok('lights: green centreline lights along the taxiway; green-and-yellow exit lights from the runway to each hold', lightBad.length === 0, lightBad.join('; '));
  ok('markings: double taxiway edge lines, broken where the connectors open off them', edgeBad.length === 0, edgeBad.join('; '));
}

/* ------------------------------------------------------------------ */
/* Signs                                                               */
/* ------------------------------------------------------------------ */
{
  const bad = [];
  let arrays = 0;
  for (const m of MAPS) {
    Terrain.applyMap(m.id);
    const L = LAY.airportLayout();
    for (const c of L.connectors.filter((x) => !x.onRunway)) {
      if (!L.signs.some((sg) => sg.kind === 'mandatory' && sg.entry === c.id)) bad.push(`${m.id} ${c.id}: no mandatory sign`);
    }
    for (const sg of L.signs.filter((x) => x.kind === 'array')) {
      arrays++;
      const kinds = sg.segments.map((x) => x.kind);
      if (!(kinds.includes('location') && kinds.includes('direction'))) bad.push(`${m.id}: an array without both panels`);
      const go = sg.segments.find((x) => x.kind === 'direction');
      // The arrow points the way the panel sits: left panel, left arrow.
      if (go.arrow === 'left' && kinds[0] !== 'direction') bad.push(`${m.id}: a left arrow on the right`);
      const z = AP.signSize(sg);
      if (!(z.w > AP.signSize({ kind: 'location', small: sg.small }).w)) bad.push(`${m.id}: an array no wider than one panel`);
    }
  }
  ok('signs: every runway entry has its red mandatory sign; junction arrays (location + direction, arrow on its own side) on the taxiway', bad.length === 0 && arrays > 20, bad.slice(0, 6).join('; ') || `${arrays} arrays`);
}

/* ------------------------------------------------------------------ */
/* The terminal's glass and the jet bridges                            */
/* ------------------------------------------------------------------ */
{
  const TL = await import(src + 'world/terminal-look.js');
  const f = TL.litFraction();
  const up = Array.from({ length: TL.BAYS }, (_, i) => TL.zoneFor(i, 1));
  const down = Array.from({ length: TL.BAYS }, (_, i) => TL.zoneFor(i, 0));
  const lit = (z) => z === 'lounge' || z === 'shop';
  ok('terminal: at night only SOME rooms are lit — between a quarter and a half of the glass', f >= 0.25 && f <= 0.5, `${Math.round(f * 100)}% of the bay-storeys`);
  ok('terminal: gate lounges upstairs, shops below, dark runs between them, and the same every night', up.filter((z) => z === 'lounge').length >= 5 && down.includes('shop') && up.includes('dark') && down.filter((z) => !lit(z)).length > down.length / 2 && TL.zoneFor(3, 1) === TL.zoneFor(3 + TL.BAYS, 1),
    `upstairs ${up.filter(lit).length}/${TL.BAYS} lit, downstairs ${down.filter(lit).length}/${TL.BAYS}`);
  ok('terminal: the glass repeats every 96 m, in 6 m bays on the fins\' lines, two storeys', TL.TILE_W_M === 96 && TL.BAY_M === 6 && TL.TILE_H_M === 2 * TL.STOREY_M);

  // Build Gateway's apron for real and look at the bridges and the name.
  const THREE = await import(src + 'vendor/three.module.js');
  const APR = await import(src + 'world/apron.js');
  Terrain.applyMap('gateway');
  AP.refreshRunways();
  APR.refreshApronElevation && APR.refreshApronElevation();
  Terrain.clearObstacles();
  const scene = new THREE.Scene();
  const ap = new AP.Airport(scene);
  const apr = new APR.Apron(scene, 'low');
  const parts = apr.bridgeParts ? apr.bridgeParts() : [];
  const names = parts.map((p) => p.name);
  ok('bridges: telescoping — three tunnel sections, the collars between them, a cab with bellows, the lift column and the bogie', ['bridge-tunnel-a', 'bridge-tunnel-b', 'bridge-tunnel-c', 'bridge-collar', 'bridge-cab', 'bridge-leg', 'bridge-bogie'].every((n) => names.includes(n)), names.join(', '));
  // Sections nest: A narrower than B narrower than C; C ends at the cab.
  const width = (mesh) => {
    mesh.geometry.computeBoundingBox();
    const b = mesh.geometry.boundingBox;
    return b.max.x - b.min.x;
  };
  ok('bridges: the sections get wider toward the cab, so they slide into one another', width(apr.bridgeTunnel) < width(apr.bridgeTunnelB) && width(apr.bridgeTunnelB) < width(apr.bridgeTunnelC));
  // Still docks: a visitor on a bridge stand brings its bridge out, and the sections stretch with it.
  const L = LAY.airportLayout();
  const st = L.stands.find((s) => s.bridge && !s.occupant && !s.parked);
  const br = st && apr.bridges.find((b) => b.st === st);
  let docked = 'no free bridge stand';
  if (br) {
    const m4 = new THREE.Matrix4();
    const len = () => {
      apr.bridgeTunnelC.getMatrixAt(br.slot, m4);
      const s = new THREE.Vector3();
      m4.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
      return s.z;
    };
    const w = { windDirDeg: 90, windSpeedKts: 5, isNight: false, cond: { cloud: 0 } };
    const before = len();
    apr.setVisitors([{ id: 'v', typeId: 'a320', x: st.x, z: st.z, headingDeg: st.headingDeg }]);
    for (let i = 0; i < 12 * 30; i++) apr.update(1 / 30, w);
    const out = br.ext;
    const after = len();
    apr.setVisitors([]);
    for (let i = 0; i < 12 * 30; i++) apr.update(1 / 30, w);
    docked = { out, back: br.ext, before: +before.toFixed(2), after: +after.toFixed(2) };
  }
  ok('bridges: still dock to an aeroplane on the stand and swing back, the tunnels telescoping out to it', docked.out > 0.99 && docked.back < 0.01 && docked.after !== docked.before, JSON.stringify(docked));
  ok('signs: the airport\'s name is in letters on the roof (not a board), lit at night', !!apr.nameLetters && apr.nameLetters.text === 'GATEWAY INTERNATIONAL' && !!apr.lettersMat && !!scene.getObjectByName('terminal-name-letters'),
    apr.nameLetters ? `${apr.nameLetters.w.toFixed(1)} x ${apr.nameLetters.h.toFixed(1)} m` : 'none');
  const night = { windDirDeg: 90, windSpeedKts: 5, isNight: true, cond: { cloud: 0 } };
  apr.update(1 / 30, night);
  ok('terminal: at night the glass and the letters light, and the halo behind the letters shows', apr.glassMat.emissiveIntensity > 0.5 && apr.lettersMat.emissiveIntensity > 1 && apr.lettersHalo.visible);
  ap.group.removeFromParent();
}

/* ------------------------------------------------------------------ */

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
