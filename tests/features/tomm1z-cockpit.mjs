/**
 * Node checks for the Tomm1z video pass, item 5 — THE A321 COCKPIT
 * (.claude/devtools/briefs/tomm1z-video.md, 6:51: "Look at what happened with
 * the cockpit. Oh, this is a bit broken." — the frame at 7:00 shows the panel
 * with a dark slab across the view).
 *
 *   node tests/features/tomm1z-cockpit.mjs
 *
 * The slab was the glareshield: its loft followed the sills' zig-zag and two
 * thirds of its faces pointed DOWN, so, drawn both-sided, the shelf was lit
 * as an underside — black, in a flight deck the fuselage already shades. Now
 * every face of the glareshield in every airliner deck points up
 * (aircraft/cockpit/flightdeck.js), and its leather is a dark grey, not coal
 * (aircraft/cockpit/kit.js GLARE_LEATHER).
 */
global.document = {
  createElement: () => ({
    getContext: () =>
      new Proxy(
        {
          measureText: (t) => ({ width: String(t).length * 6 }),
          roundRect: (x, y, w, h, r) => {
            if (!(r >= 0)) throw new RangeError(`Radius value ${r} is negative.`);
          },
        },
        { get: (o, k) => (k in o ? o[k] : () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) })), set: () => true }
      ),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const { getAircraft } = await import(SRC + 'aircraft/types.js');
const adapter = await import(SRC + 'aircraft/model-adapter.js');
const { schemeFor } = await import(SRC + 'aircraft/liveries.js');
const CP = await import(SRC + 'aircraft/cockpit.js');
const KIT = await import(SRC + 'aircraft/cockpit/kit.js');

const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail: String(detail) });

/** Of a geometry's faces: how many point up, down, sideways. */
function faces(g) {
  const n = g.attributes.normal;
  const idx = (i) => (g.index ? g.index.getX(i) : i);
  const count = g.index ? g.index.count : g.attributes.position.count;
  const f = { up: 0, down: 0, side: 0 };
  for (let i = 0; i < count; i += 3) {
    const ny = (n.getY(idx(i)) + n.getY(idx(i + 1)) + n.getY(idx(i + 2))) / 3;
    if (ny > 0.5) f.up++;
    else if (ny < -0.5) f.down++;
    else f.side++;
  }
  return f;
}

for (const id of ['a321', 'b747', 'meridian', 'q400', 'c17']) {
  const type = getAircraft(id);
  if (!type) {
    ok(`${id}: a type`, false, 'no such type');
    continue;
  }
  let glare = null;
  try {
    const model = adapter.createAircraftModel({ type, livery: schemeFor(type, 'house') });
    const cockpit = CP.createCockpit({ type, model });
    glare = cockpit.getObjectByName('glareshield');
  } catch (e) {
    ok(`${id}: the deck builds`, false, e && e.stack);
    continue;
  }
  ok(`${id}: the deck's glareshield is its own mesh (found by name)`, !!(glare && glare.geometry && glare.geometry.attributes.normal), glare ? 'no geometry' : 'not found (merged away)');
  if (!glare || !glare.geometry) continue;
  const f = faces(glare.geometry);
  ok(`${id}: the glareshield's shelf faces up, none of it down (two thirds faced down: a black slab across the view)`, f.up > 0 && f.down === 0 && f.side === 0, `${f.up} up, ${f.down} down, ${f.side} side`);
}

// Its leather, times its tint: a dark grey, never coal.
{
  const base = KIT.GLARE_LEATHER;
  ok('the glareshield leather base is exported (kit.js GLARE_LEATHER)', typeof base === 'string' && /^#[0-9a-f]{6}$/i.test(base), String(base));
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  for (const glare of ['#22272c', '#1f2022', '#111316']) {
    const m = KIT.cockpitMaterials({ glare }).glare;
    const albedo = typeof base === 'string' ? lum(new THREE.Color(base)) * lum(m.color) : 0;
    ok(`palette glare ${glare}: the glareshield's albedo (leather × tint) is a dark grey, 0.08-0.2 linear (it was 0.001: coal)`, albedo >= 0.08 && albedo <= 0.2, `tint lum ${lum(m.color).toFixed(3)}, albedo ${albedo.toFixed(4)}`);
  }
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
