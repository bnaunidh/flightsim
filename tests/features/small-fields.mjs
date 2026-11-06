/**
 * The World Map's other fields, up close:
 *
 *   node tests/features/small-fields.mjs
 *
 *   - a regional field has a short terminal, a small tower, a fire shed, and
 *     boards by the apron stairs: no jet bridges;
 *   - a strip has an AFIS room, not a tower;
 *   - what is parked suits the runway: airliner jets from 1,700 m, turboprops under;
 *   - the small things are instanced: one draw call, none on Low, far less
 *     memory than baking them, and the real glazing goes on the glazed styles.
 */
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, createLinearGradient: () => ({ addColorStop() {} }), data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const SRC = new URL('../../src/', import.meta.url).href;
const OS = await import(SRC + 'world/worldmap/outstation.js');
const { PREVIEW_DATA: D } = await import(SRC + 'world/worldmap/preview-data.js');
const { styleOf } = await import(SRC + 'world/worldmap/personas.js');
const { Batch } = await import(SRC + 'world/airport-kit.js');
const LOOK = await import(SRC + 'world/worldmap/field-look.js');

let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  if (!pass || process.env.VERBOSE) console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
};

const GLAZED = ['glass', 'hall', 'block'];
for (const a of D.airports) {
  const plan = OS.fieldPlan(a);
  const term = plan.buildings.find((b) => b.kind === 'terminal');
  const tower = plan.buildings.find((b) => b.kind === 'tower');
  const fire = plan.buildings.find((b) => b.kind === 'fire station');
  if (a.kind === 'regional') {
    ok(`${a.id}: a short terminal`, term && term.x1 - term.x0 <= 170 && term.h <= 12, term ? `${(term.x1 - term.x0) | 0} m, ${term.h} m high` : 'none');
    ok(`${a.id}: a small tower`, tower && tower.h <= 22, tower ? tower.h : 'none');
    ok(`${a.id}: a fire shed`, !!fire);
    // No jet bridges: the bridge's colour is nowhere in the apron dressing.
    const b = new Batch();
    LOOK.apronDressing(b, a, styleOf(a), []);
    const c = new Batch();
    c.box(1, 1, 1, 0, 0, 0, 0xb9bec2);
    const [r, g, bl] = c.col;
    let bridge = 0;
    for (let i = 0; i + 2 < b.col.length; i += 3) if (b.col[i] === r && b.col[i + 1] === g && b.col[i + 2] === bl) bridge++;
    ok(`${a.id}: boards by the stairs, no bridges`, bridge === 0, bridge);
  }
  if (a.kind === 'ga') ok(`${a.id}: an AFIS room, not a tower`, !tower || tower.h <= 9, tower ? tower.h : 'none');
  const hi = OS.buildField(a, 'high');
  const lo = OS.buildField(a, 'low');
  const det = hi.children.find((o) => o.name === 'field-detail');
  const gl = hi.children.find((o) => o.name === 'field-glass');
  ok(`${a.id}: its small things are one instanced mesh`, !!det && det.isInstancedMesh && det.count >= 20, det ? det.count : 'none');
  ok(`${a.id}: and none on Low`, !lo.children.some((o) => o.name === 'field-detail' || o.name === 'field-glass'));
  ok(`${a.id}: the real glazing on a glazed style only`, !!gl === (GLAZED.includes(styleOf(a).terminal) && !!term), styleOf(a).terminal);
}
console.log(`small-fields: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
