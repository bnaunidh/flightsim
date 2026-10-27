/**
 * Heights next to traffic on the minimap (wave 18; the owner's screenshot: "-200 ft"
 * beside an aeroplane that was on the ground), in node:
 *
 *   node tests/features/minimap-heights.mjs
 *
 *   - an aeroplane on the ground gets NO height, whether it says it is on the
 *     ground or not (a parked or taxiing body that does not report it was drawn as
 *     flying, "-200 ft" below you as you climbed out);
 *   - one in the air gets its height against yours, the same point on both, to
 *     the hundred feet, with a real minus sign; level is "same height";
 *   - on a deck or a roof pad the deck is the ground; at sea, the sea's surface
 *     (never the sea floor);
 *   - nothing on the road or the water (you in a van or a boat);
 *   - the minimap draws with these (no other height maths left in drawTraffic).
 */

import { readFileSync } from 'node:fs';

global.document = {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }), width: 0, height: 0, style: {} }),
  body: { appendChild() {} },
  head: { appendChild() {} },
  documentElement: { classList: { toggle() {}, contains() { return false; } } },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const SRC = new URL('../../src/', import.meta.url).href;
const TR = await import(SRC + 'world/terrain.js');
const MM = await import(SRC + 'ui/minimap.js');

let passed = 0;
const failed = [];
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed.push(name);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  (${detail})` : ''}`);
}

TR.applyMap('kestrel');
const elev = TR.AIRPORT.elev;
const ground = (x, z) => MM.surfaceUnder(x, z);
const me = (y) => ({ x: 0, y, z: 0, kind: 'aeroplane' });
const ft = (m) => m / 3.28084;

// A parked airliner on Kestrel's apron, its middle 5 m above the paving, that does not say it is on the ground.
const parked = { pos: { x: -80, y: TR.heightAt(-80, -150) + 5, z: -150 }, onGround: false };
const climbing = me(TR.heightAt(-80, -150) + 5 + ft(200));
ok('a parked aeroplane that does not report it is on the ground: no height beside it (it showed "−200 ft" as you climbed out)', MM.heightTag(parked, climbing, ground) === null, String(MM.heightTag(parked, climbing, ground)));
ok('…and the map draws it as a dot on the ground', MM.onGroundForMap(parked, ground));
ok('one that says it is on the ground: no height either', MM.heightTag({ pos: { x: 0, y: elev + 3, z: -95 }, onGround: true }, climbing, ground) === null);

const air = { pos: { x: 500, y: elev + 300, z: 0 }, onGround: false };
ok('in the air, 200 ft below you: "−200 ft"', MM.heightTag(air, me(elev + 300 + ft(200)), ground) === '−200 ft', MM.heightTag(air, me(elev + 300 + ft(200)), ground));
ok('in the air, 1,500 ft above you: "+1,500 ft"', MM.heightTag(air, me(elev + 300 - ft(1500)), ground) === '+1,500 ft', MM.heightTag(air, me(elev + 300 - ft(1500)), ground));
ok('level with you: "same height"', MM.heightTag(air, me(elev + 300 + 5), ground) === 'same height');
ok('a body just off the ground on take-off (within 10 m) is still a dot; at 15 m it flies', MM.onGroundForMap({ pos: { x: 0, y: TR.heightAt(0, 0) + 8, z: 0 } }, ground) && !MM.onGroundForMap({ pos: { x: 0, y: Math.max(0, TR.heightAt(0, 0)) + 15, z: 0 } }, ground));
// At sea the surface is 0, never the floor 34 m down: a helicopter hovering 20 m over the water is flying.
const seaX = 6000;
const seaZ = 6000;
ok('over the sea the ground is the water, not the sea floor', TR.heightAt(seaX, seaZ) < 0 && MM.surfaceUnder(seaX, seaZ) === 0 && !MM.onGroundForMap({ pos: { x: seaX, y: 20, z: seaZ } }, ground), `${TR.heightAt(seaX, seaZ).toFixed(1)}`);
ok('in the van or the boat: no heights', MM.heightTag(air, { x: 0, y: 0, z: 0, kind: 'boat' }, ground) === null && MM.heightTag(air, { x: 0, y: 0, z: 0, kind: 'car' }, ground) === null);
ok('nonsense is nothing', MM.heightTag({ pos: { x: 0, y: NaN, z: 0 } }, climbing, ground) === null && MM.heightTag(null, climbing, ground) === null);

const src = readFileSync(new URL('../../src/ui/minimap.js', import.meta.url), 'utf8');
const draw = src.slice(src.indexOf('  drawTraffic(g) {'), src.indexOf('  trafficHeading(e) {'));
ok('the minimap draws with these: onGroundForMap for the dot, heightTag for the words, no height maths of its own', /onGroundForMap\(e\)/.test(draw) && /heightTag\(e, craft\)/.test(draw) && !/3\.28084/.test(draw));

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length) {
  console.log(failed.map((f) => `  FAILED: ${f}`).join('\n'));
  process.exit(1);
}
process.exit(0);
