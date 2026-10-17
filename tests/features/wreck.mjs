/**
 * The real crash's fireball and splash (src/game/wreck.js), in plain node:
 *
 *   node tests/features/wreck.mjs
 *
 * Seizure safety, from the crash sweep: with Comic effects off (the default) a
 * fighter that ditched in the sea measured 24-32% of a 10-degree field flashing
 * over WCAG's line (25%), and with the wreck's group hidden 0.2%: the splash's
 * three bright rings (26, 41, 56 m/s, set off 0.55 s apart) cross the same sea
 * inside half a second, each a band that comes and goes. With Reduce flashing
 * on there is one ring; with it off all three, as they always were.
 * tests/features/crash-sweep.browser.js holds the result on the real renderer.
 */

globalThis.document = {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }), width: 0, height: 0, style: {} }),
  body: { appendChild() {} },
  documentElement: { classList: { toggle() {} } },
  addEventListener() {},
};
globalThis.window = globalThis;

const root = new URL('../../src/', import.meta.url);
const THREE = await import(new URL('vendor/three.module.js', root));
const { Wreck } = await import(new URL('game/wreck.js', root));
const { FLASH } = await import(new URL('render/flash-safety.js', root));

let pass = 0;
const failed = [];
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else failed.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}

/** Frames of a ditching at 60 m/s: how many rings are lit at once, at most, and how many ever. */
function ditch(reduce) {
  FLASH.reduce = reduce;
  const w = new Wreck({ add() {} });
  w.start(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -4, -60), true);
  let most = 0;
  const ever = new Set();
  let ringFrames = 0;
  for (let f = 0; f < 150; f++) {
    w.update(1 / 30);
    const lit = w.rings.filter((r) => r.mesh.visible && r.mesh.material.opacity > 0.03);
    most = Math.max(most, lit.length);
    lit.forEach((r) => ever.add(r));
    if (lit.length) ringFrames++;
  }
  return { most, ever: ever.size, ringFrames, rings: w.rings.length };
}

const was = FLASH.reduce;
const on = ditch(true);
const off = ditch(false);
FLASH.reduce = was;
ok('wreck: the splash has three rings (it always did)', on.rings === 3 && off.rings === 3);
ok('wreck: with Reduce flashing on, a ditching shows ONE ring (three crossing the same sea inside half a second were six flashes)', on.ever === 1 && on.most === 1, `${on.ever} ever lit, ${on.most} at once`);
ok('wreck: …and the ring is still there to see (it spreads for over a second)', on.ringFrames >= 30, `${on.ringFrames} frames`);
ok('wreck: with it off all three are as they were, two or three at once', off.ever === 3 && off.most >= 2, `${off.ever} ever lit, ${off.most} at once`);

console.log(`\n${pass} passed, ${failed.length} failed`);
if (failed.length) {
  console.log(failed.map((f) => `  FAILED: ${f}`).join('\n'));
  process.exit(1);
}
process.exit(0);
