/**
 * Node checks for the flicker fix and Reduce flashing. Run from anywhere:
 *
 *   node tests/features/flicker.mjs [--verbose]
 *
 * The owner: "graphic errors that can cause seziure". Two halves:
 *
 * THE FIX, for everybody (render/depth-layers.js, terrain.js SEA_CUT): the
 * sea's layers sit in depth behind the land and the deep layer behind the
 * translucent ones, with margins larger than the depth error they have to
 * beat; the terrain is cut at sea level while the camera is above it.
 *
 * REDUCE FLASHING (render/flash-safety.js), Settings → Graphics, on by
 * default. Every light the game blinks on purpose is driven through it, so
 * each is simulated here for ten seconds at 120 Hz, the way the game draws
 * it, and its own brightness counted the WCAG 2.3.1 way: a flash is a pair
 * of opposing changes of 0.10 or more. Switch on: never more than three in
 * any second, never brighter than its cap, no hard edges. Switch off: the
 * very same pattern each light had before, sample for sample — the setting
 * must be able to give back today's look.
 *
 * The browser half (flicker.browser.js) measures the screen itself with
 * tests/flicker-probe.js at the worst places found.
 *
 * Exits non-zero if anything fails.
 */

if (typeof globalThis.window === 'undefined') {
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  });
}
globalThis.document = globalThis.document || {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const root = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  return !!pass;
};

const FS = await imp('src/render/flash-safety.js');
const { SEA_DEPTH } = await imp('src/render/depth-layers.js');
const { DEFAULT_SETTINGS, loadSettings } = await imp('src/core/storage.js');
const THREE = await imp('src/vendor/three.module.js');
const T = await imp('src/world/terrain.js');
const { CameraRig } = await imp('src/flight/camera.js');
const { FLASH, CAPS } = FS;

/* -------------------------------------------------------------- setting -- */

ok('Reduce flashing is on by default', DEFAULT_SETTINGS.reduceFlashing === true);
localStorage.setItem('islandsim.settings.v1', JSON.stringify({ quality: 'high', muted: true }));
ok('a save from before the setting existed gets it on', loadSettings().reduceFlashing === true);
localStorage.setItem('islandsim.settings.v1', JSON.stringify({ reduceFlashing: false }));
ok('switched off, it stays off', loadSettings().reduceFlashing === false);
ok('setReduceFlashing(false) turns it off and (true) back on', FS.setReduceFlashing(false) === false && FLASH.reduce === false && FS.setReduceFlashing(true) === true && FLASH.reduce === true);

/* ------------------------------------------------------- the depth fix -- */

{
  const d = SEA_DEPTH.deep;
  const b = SEA_DEPTH.band;
  // The depth error at range is a step or two of the buffer (float32 vertex
  // maths near depth 1.0 is about one step): three is the least margin.
  ok('the deep sea is pushed back further than the bands, by at least three depth steps', d.polygonOffset && b.polygonOffset && d.polygonOffsetUnits - b.polygonOffsetUnits >= 3, `${d.polygonOffsetUnits} vs ${b.polygonOffsetUnits}`);
  ok('the bands are pushed back behind the land by at least three depth steps', b.polygonOffsetUnits >= 3, b.polygonOffsetUnits);
  ok('and the slope term keeps the order at a grazing angle', d.polygonOffsetFactor > b.polygonOffsetFactor && b.polygonOffsetFactor >= 0, `${d.polygonOffsetFactor} vs ${b.polygonOffsetFactor}`);
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 8400, 0);
  T.seaCut(null, null, cam);
  ok('above the sea, the terrain is cut at sea level', T.SEA_CUT.value === 0, T.SEA_CUT.value);
  cam.position.y = -2;
  T.seaCut(null, null, cam);
  ok('below it (nothing goes there today), nothing is cut', T.SEA_CUT.value < -1e6, T.SEA_CUT.value);
  cam.position.y = 3;
  T.seaCut(null, null, cam);
}

/* ------------------------------------------------------------- lights -- */

/** Flashes (WCAG: pairs of opposing changes of >= 0.1) in the worst second, and the hardest single step. */
function count(level, { secs = 10, hz = 120 } = {}) {
  const n = secs * hz;
  const at = [];
  let ext = level(0);
  let dir = 0;
  let peak = 0;
  let step = 0;
  let prev = ext;
  for (let i = 1; i <= n; i++) {
    const v = level(i / hz);
    peak = Math.max(peak, v);
    step = Math.max(step, Math.abs(v - prev));
    prev = v;
    if (dir >= 0) {
      if (v > ext) ext = v;
      else if (ext - v >= 0.1) {
        at.push(i / hz);
        dir = -1;
        ext = v;
      }
    }
    if (dir < 0) {
      if (v < ext) ext = v;
      else if (v - ext >= 0.1) {
        at.push(i / hz);
        dir = 1;
        ext = v;
      }
    }
  }
  // Transitions in the worst one-second window, halved: flashes.
  let worst = 0;
  for (let i = 0, j = 0; i < at.length; i++) {
    while (at[i] - at[j] >= 1) j++;
    worst = Math.max(worst, i - j + 1);
  }
  return { perSecond: worst / 2, peak, step };
}

/**
 * Every light the game blinks, as its code drives it, against the formula it
 * had before Reduce flashing existed.
 */
const T13 = (t) => ((t % 1.3) + 1.3) % 1.3;
const LIGHTS = [
  {
    name: 'aircraft strobes (model.js, civil-build.js)',
    now: (t) => FS.strobeLevel(t, 1.3, 0.06, 0.07),
    was: (t) => (T13(t) < 0.06 || (T13(t) > 0.13 && T13(t) < 0.19) ? 1 : 0),
  },
  {
    name: 'fleet-model strobes (model-adapter.js)',
    now: (t) => FS.strobeLevel(t, 1.4, 0.06, 0.1),
    was: (t) => {
      const c = t % 1.4;
      return c < 0.06 || (c > 0.16 && c < 0.22) ? 1 : 0;
    },
  },
  {
    name: 'helicopter beacon (blender-models.js)',
    now: (t) => FS.strobeLevel(t, 1.3, 0.07, 0.09),
    was: (t) => {
      const c = t % 1.3;
      return c < 0.07 || (c > 0.16 && c < 0.23) ? 1 : 0;
    },
  },
  {
    name: 'lifeboat blue beacons (blender-models.js)',
    now: (t) => FS.strobeLevel(t, 0.8, 0.064, 0.064),
    was: (t) => {
      const ph = (t * 1.25) % 1;
      return ph < 0.08 || (ph > 0.16 && ph < 0.24) ? 1 : 0;
    },
  },
  {
    name: 'helicopter mission strobe (missions-heli.js)',
    now: (t) => FS.strobeLevel(t, 1.15, 0.09),
    was: (t) => (t % 1.15 < 0.09 ? 1 : 0),
  },
  {
    name: 'airliner beacon (civil-build.js)',
    now: (t) => FS.blinkLevel(t, 1.1, 0.35 / 1.1),
    was: (t) => ((t % 1.1) < 0.35 ? 1 : 0),
  },
  {
    name: 'apron beacons (apron.js)',
    now: (t) => FS.blinkLevel(t, 1, 0.45),
    was: (t) => (t % 1 < 0.45 ? 1 : 0),
  },
  {
    name: 'drone beacon (afo-combat.js)',
    now: (t) => FS.blinkLevel(t, (Math.PI * 2) / 6, 0.5),
    was: (t) => (Math.sin(t * 6) > 0 ? 1 : 0),
  },
];

/** The police light bars, through the real function and two fake materials. */
let V = null;
try {
  V = await imp('src/features/events/vehicles.js');
} catch (e) {
  ok('the police lights module loads in node', false, e && e.message);
}

for (const L of LIGHTS) {
  FS.setReduceFlashing(false);
  let same = 0;
  let total = 0;
  // Sample between the edges: the old and new code compare with the same
  // operators, but 0.06 + 0.07 is not quite 0.13 in floating point.
  for (let i = 0; i < 6000; i++) {
    const t = (i + 0.5) / 1000;
    total++;
    if (L.now(t) === L.was(t)) same++;
  }
  ok(`${L.name}: switched off, exactly the old pattern`, same === total, `${same}/${total}`);
  FS.setReduceFlashing(true);
  const c = count(L.now);
  ok(`${L.name}: switched on, at most three flashes a second`, c.perSecond <= 3, `${c.perSecond}/s`);
  ok(`${L.name}: switched on, no hard edge (under 0.15 a frame at 60 fps)`, count(L.now, { hz: 60 }).step <= 0.15, count(L.now, { hz: 60 }).step.toFixed(3));
}
FS.setReduceFlashing(true);
for (const k of ['strobe']) {
  const c = count((t) => FS.strobeLevel(t));
  ok(`strobes switched on are no brighter than CAPS.${k} (${CAPS[k]})`, c.peak <= CAPS[k] + 1e-9, c.peak.toFixed(3));
}

if (V && V.flashPolice) {
  // The light bar writes two shared materials; give it stand-ins.
  const fake = () => ({ opacity: 0, emissiveIntensity: 0 });
  const M = { redGlow: fake(), blueGlow: fake(), red: fake(), blueLens: fake() };
  if (typeof V.__setPoliceMaterials === 'function') V.__setPoliceMaterials(M);
  const level = (key) => (t) => {
    V.flashPolice(t);
    return (M[key].opacity - 0.08) / 0.92;
  };
  if (typeof V.__setPoliceMaterials === 'function') {
    FS.setReduceFlashing(false);
    const before = count(level('redGlow'));
    ok('police lights switched off: as before, the red flickers more than three times a second', before.perSecond > 3, `${before.perSecond}/s`);
    FS.setReduceFlashing(true);
    for (const key of ['redGlow', 'blueGlow']) {
      const c = count(level(key));
      ok(`police lights switched on: the ${key === 'redGlow' ? 'red' : 'blue'} at most three flashes a second, soft and dimmer`, c.perSecond <= 3 && c.peak <= CAPS.strobe + 1e-9 && count(level(key), { hz: 60 }).step <= 0.15,
        `${c.perSecond}/s, peak ${c.peak.toFixed(2)}`);
    }
    V.__setPoliceMaterials(null);
  } else {
    ok('police lights: the test hook exists', false, 'vehicles.js __setPoliceMaterials');
  }
}

/* -------------------------------------------------------------- flashes -- */

{
  // A burst: sixty bangs (or hits) a second for three seconds.
  const tally = (on) => {
    FS.setReduceFlashing(on);
    const g = new FS.FlashGate();
    const at = [];
    for (let i = 0; i < 180; i++) if (g.allow(i / 60)) at.push(i / 60);
    let worst = 0;
    for (let i = 0, j = 0; i < at.length; i++) {
      while (at[i] - at[j] >= 1) j++;
      worst = Math.max(worst, i - j + 1);
    }
    return { worst, total: at.length };
  };
  const on = tally(true);
  ok('a burst of sixty a second: switched on, at most three flashes in any second', on.worst <= FS.MAX_FLASHES_PER_SECOND, `${on.worst} in the worst second`);
  ok('…and still about three a second, not none', on.total >= 8, `${on.total} in 3 s`);
  const off = tally(false);
  ok('switched off, every one flashes, as before', off.total === 180, off.total);
  FS.setReduceFlashing(true);
  ok(`a full-screen wash is at most SCREEN_MAX (${FS.SCREEN_MAX}) switched on`, FS.screenOpacity(0.85) <= FS.SCREEN_MAX && FS.screenOpacity(0.38) <= FS.SCREEN_MAX && FS.screenOpacity(0.1) === 0.1);
  // That much near-white over any scene, black included, moves it by under
  // 0.1 of relative luminance: not a flash at all by WCAG's own measure.
  const white = 0.83;
  ok('…which moves any scene, even black, by less than WCAG\'s 0.1', [0, 0.1, 0.2, 0.3].every((L) => FS.SCREEN_MAX * (white - L) < 0.1));
  ok('lightning switched on is a fraction of its strength', FS.dim(1, CAPS.lightning) <= 0.25);
  FS.setReduceFlashing(false);
  ok('switched off, a wash and a strike are untouched', FS.screenOpacity(0.85) === 0.85 && FS.dim(1, CAPS.lightning) === 1);
  FS.setReduceFlashing(true);
}

{
  // The explosions' one light: eight bangs in a second, each a flash that
  // dies away in a ninth of a second (explosions.js), through the smoother.
  const bangs = (t) => {
    let v = 0;
    for (let k = 0; k < 8; k++) {
      const s = t - 0.2 - k * 0.125;
      if (s >= 0) v = Math.max(v, Math.exp(-s * 9));
    }
    return v;
  };
  const through = (on) => {
    FS.setReduceFlashing(on);
    const sm = new FS.FlashSmoother();
    let last = 0;
    return (t) => {
      const dt = t - last;
      last = t;
      return sm.step(bangs(t), dt);
    };
  };
  const off = count(through(false), { secs: 3 });
  ok('eight bangs in a second, switched off: the light flashes with each, as before', off.perSecond > 3, `${off.perSecond}/s`);
  const on = count(through(true), { secs: 3 });
  ok('switched on, the light swells: at most three flashes a second', on.perSecond <= 3, `${on.perSecond}/s, peak ${on.peak.toFixed(2)}`);
  FS.setReduceFlashing(true);
}

/* ------------------------------------------------------- cockpit buzz -- */

{
  // The real camera rig in the cockpit, an aeroplane at cruise power that
  // does not move: how far does the eye wander?
  const ac = {
    pos: new THREE.Vector3(0, 800, 0),
    quat: new THREE.Quaternion(),
    vel: new THREE.Vector3(0, 0, -60),
    rpm: 0.75,
    buffet: 0,
    onGround: false,
    groundSpeed: 0,
    airspeed: 60,
    gLoad: 1,
    bankAngleDeg: () => 0,
  };
  const wander = (on) => {
    FS.setReduceFlashing(on);
    const cam = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 60000);
    const rig = new CameraRig(cam, ac);
    rig.setMode('cockpit');
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 240; i++) {
      rig.update(1 / 120, ac, null, null);
      lo = Math.min(lo, cam.position.y);
      hi = Math.max(hi, cam.position.y);
    }
    return hi - lo;
  };
  const off = wander(false);
  const on = wander(true);
  // A metre from the panel, 68 degrees over 713 px: a millimetre is 0.6 px.
  ok('the cockpit buzz switched off is what it was (centimetres)', off > 0.01, `${(off * 1000).toFixed(1)} mm`);
  ok('switched on, a tenth of it: under two millimetres, about a pixel', on <= off * CAPS.cockpitBuzz * 1.05 && on < 0.002, `${(on * 1000).toFixed(2)} mm`);

  // A jolt in the chase view (a hard landing, a bang): the shake alone is
  // the difference between the camera with the kick and without it. How
  // many times a second does it change direction?
  const jolt = (on) => {
    FS.setReduceFlashing(on);
    const track = (kick) => {
      const cam = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 60000);
      const rig = new CameraRig(cam, ac);
      rig.setMode('chase');
      const ys = [];
      for (let i = 0; i < 120; i++) {
        if (i === 12 && kick) rig.kick(1.3);
        rig.update(1 / 120, ac, null, null);
        ys.push(cam.position.y);
      }
      return ys;
    };
    const a = track(true);
    const b = track(false);
    const d = a.map((y, i) => y - b[i]);
    let turns = 0;
    let amp = 0;
    for (let i = 2; i < d.length; i++) {
      amp = Math.max(amp, Math.abs(d[i]));
      if (Math.sign(d[i] - d[i - 1]) !== Math.sign(d[i - 1] - d[i - 2]) && Math.abs(d[i - 1]) > 0.01) turns++;
    }
    return { hz: turns / 2, amp }; // over one second: two turns a cycle
  };
  const fast = jolt(false);
  const slow = jolt(true);
  ok('a jolt switched off: the shake it always had (several times a second)', fast.hz > 3, `${fast.hz} Hz, ${(fast.amp * 100).toFixed(0)} cm`);
  ok('switched on, the same jolt under three times a second', slow.hz <= 3 && slow.amp > 0.05, `${slow.hz} Hz, ${(slow.amp * 100).toFixed(0)} cm`);
  FS.setReduceFlashing(true);
}

/* -------------------------------------------------------------- report -- */

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  if (!r.pass || process.argv.includes('--verbose')) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
}
console.log(`\nflicker: ${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
