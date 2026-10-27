/**
 * Measure every fixed-wing type's take-off run in the game's own flight
 * model, the way a careful pilot flies it: full power from a standstill on
 * Gateway's runway (no wind, sea-level-ish), the nose held level until the
 * type's rotate speed (ui/speed-bands.js), then a gentle pull (0.3) until it
 * is airborne and stays airborne. The ground covered to lift-off, metres.
 *
 *   /opt/homebrew/bin/node tools/takeoff-runs.mjs           prints the table
 *   /opt/homebrew/bin/node tools/takeoff-runs.mjs --write   rewrites src/aircraft/takeoff-runs.js's TABLE
 *
 * tests/features/world-preview.mjs measures them again and fails when the
 * table has drifted more than 15% from the flight model.
 */
import { readFileSync, writeFileSync } from 'node:fs';

globalThis.document = globalThis.document || { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }), width: 0, height: 0, style: {} }), body: { appendChild() {} } };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis.window || { addEventListener() {} };

const SRC = new URL('../src/', import.meta.url).href;

/** The run of one type, metres, or null if it never lifted off in 90 s. */
export async function measureRuns(ids = null) {
  const THREE = await import(SRC + 'vendor/three.module.js');
  const TER = await import(SRC + 'world/terrain.js');
  const P = await import(SRC + 'aircraft/physics.js');
  const T = await import(SRC + 'aircraft/types.js');
  const SB = await import(SRC + 'ui/speed-bands.js');
  const { Weather } = await import(SRC + 'world/weather.js');
  const prevMap = TER.MAP && TER.MAP.id;
  TER.applyMap('gateway');
  const w = new Weather();
  w.load({ time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
  const r = TER.AIRPORT.runway;
  const out = {};
  for (const t of T.AIRCRAFT) {
    if (ids && !ids.includes(t.id)) continue;
    if (t.class === 'Helicopter' || !t.aero || !t.aero.thrustMax) continue;
    P.applyAircraft(t.id);
    const B = SB.speedBands(T.performanceFor(t.id));
    const a = new P.Aircraft();
    const x0 = r.cx - r.length / 2 + 80;
    a.reset({ pos: new THREE.Vector3(x0, 0, r.cz), headingDeg: 90, speed: 0, altAGL: null, engineOn: true, fuel: 1 });
    a.controls.throttle = 1;
    let lift = null;
    let run = null;
    for (let i = 0; i < 120 * 90; i++) {
      a.controls.pitch = a.readouts().iasKts > B.rotate ? 0.3 : 0;
      a.controls.brakes = 0;
      a.update(1 / 120, w);
      if (a.crashed) break;
      if (!a.onGround) {
        if (lift == null) lift = a.pos.x - x0;
        if (a.pos.x - x0 - lift > 300) {
          run = lift;
          break;
        }
      } else lift = null;
    }
    out[t.id] = run == null ? null : Math.round(run / 10) * 10;
  }
  P.applyAircraft(T.AIRCRAFT[0].id);
  if (prevMap) TER.applyMap(prevMap);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runs = await measureRuns();
  console.log(runs);
  if (process.argv.includes('--write')) {
    const p = new URL('../src/aircraft/takeoff-runs.js', import.meta.url);
    const s = readFileSync(p, 'utf8');
    const body = Object.entries(runs).filter(([, v]) => v != null).map(([k, v]) => `  ${/^[a-z_][a-z0-9_]*$/i.test(k) ? k : JSON.stringify(k)}: ${v},`).join('\n');
    const next = s.replace(/(\/\* TABLE \*\/\nexport const TAKEOFF_RUN_M = Object\.freeze\(\{\n)[\s\S]*?(\}\);)/, `$1${body}\n$2`);
    writeFileSync(p, next);
    console.log('wrote', p.pathname);
  }
}
