/**
 * KID PLAYTEST — the boat.
 *
 * Not a unit test. A ten-year-old on a school keyboard, written down: take the
 * Kestrel Launch out in First Shout, hold go for ten seconds, steer a full
 * turn, let go of everything, then play the whole shout following nothing but
 * the arrow and the words on the screen. Every check is a number that means
 * "this is fun and not broken", and each one says what it measured.
 *
 * It drives the game through KEYS — W, S, Shift, Ctrl, A, D, the arrows and
 * Space — the way a child does, never by calling setLever() or writing
 * positions, except to put her back at the berth between sessions (and once,
 * in P32, thirty metres off the jetty).
 *
 * HOW TO RUN IT, in the browser, on the game page:
 *
 *   const s = window.__sim;
 *   window.__realRender = s.renderer.render.bind(s.renderer); // before stubbing
 *   s.renderer.render = () => {};
 *   const t = await import('/tests/features/boat-playtest.browser.js');
 *   const r = t.reporter();
 *   await t.check(s, r, console.log);
 *   r.checks.filter(c => !c.pass)
 *
 * and, for every boat mission played start to finish by the same kid:
 *
 *   await t.playAllBoatMissions(s, r, console.log);
 *
 * The sea-colour check needs a real frame; it uses window.__realRender if
 * the page stubbed the renderer, and says so rather than guessing if not.
 */

const KEY_NAMES = {
  ShiftLeft: 'Shift',
  ControlLeft: 'Control',
  KeyA: 'a',
  KeyD: 'd',
  KeyW: 'w',
  KeyS: 's',
  Space: ' ',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
};
const ALL_KEYS = Object.keys(KEY_NAMES);
const KTS = 1.94384;

/** The same tiny reporter the other suites use. */
export function reporter() {
  const checks = [];
  return {
    checks,
    ok(name, pass, detail = '') {
      checks.push({ name, pass: !!pass, detail: String(detail) });
      return !!pass;
    },
    get failed() {
      return checks.filter((c) => !c.pass);
    },
  };
}

function down(code) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key: KEY_NAMES[code] || code, bubbles: true }));
}
function up(code) {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, key: KEY_NAMES[code] || code, bubbles: true }));
}
function letGo() {
  for (const k of ALL_KEYS) up(k);
}
/** One frame at a time, so held keys and edges behave as they do at 60 Hz. */
function frames(sim, n) {
  for (let i = 0; i < n; i++) sim.update(1 / 60);
}
function seconds(sim, s) {
  frames(sim, Math.round(s * 60));
}
function tap(sim, code) {
  down(code);
  frames(sim, 2);
  up(code);
  frames(sim, 4);
}
function visible(e) {
  if (!e || !e.isConnected) return false;
  for (let q = e; q && q !== document.body; q = q.parentElement) {
    const cs = getComputedStyle(q);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
  }
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function flat(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
function bearing(from, to) {
  return ((Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI + 360) % 360;
}
function rel(h, brg) {
  return ((brg - h + 540) % 360) - 180;
}

/** What the arrow on the screen says, if there is one a child can see. */
function screenArrow(sim) {
  const a = sim.hud.wrap.querySelector('.hud-boatarrow');
  if (a && visible(a) && a.dataset.rel !== undefined) return { rel: +a.dataset.rel, el: a };
  const w = sim.hud.waypoint;
  if (w && visible(w)) return { rel: null, el: w, stale: true };
  return null;
}

function hudDepthText(sim) {
  const e = sim.hud.wrap.querySelector('.hud-boatpanel .hud-row.is-depth .hud-value');
  return e ? e.textContent : null;
}

/*
 * Her hull and her deck edge: what "the keel" and "the deck" are measured on.
 *
 * The pack launch's are the meshes called chinedPlaningHull and nonskidDeck.
 * A model that says where its deck edge is (`userData.hullFit`, the Blender
 * launch) is measured at those points — the cockpit sole corners and the
 * motor-well lip, the lowest places the sea would come aboard — with its
 * keel on the part called `hull`. Only then the biggest mesh, as a guess:
 * on the Blender launch that guess was a stern-ladder fitting 0.19 m above
 * the water, which read as both a keel out of the sea and a deck awash.
 */
function boatMeshes(model) {
  let hull = null;
  let deck = null;
  let biggest = null;
  let size = 0;
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === 'chinedPlaningHull') hull = o;
    if (o.name === 'nonskidDeck') deck = o;
    const g = o.geometry;
    if (g && !g.boundingBox) g.computeBoundingBox();
    const s = g && g.boundingBox ? g.boundingBox.getSize(new o.position.constructor()).length() : 0;
    if (s > size && !o.isInstancedMesh) {
      size = s;
      biggest = o;
    }
  });
  const fit = model.userData.hullFit;
  const part = model.userData.parts && model.userData.parts.hull;
  if (!hull && !deck && fit && fit.deck && part) return { hull: part, deck: part, deckPoints: fit.deck };
  return { hull: hull || biggest, deck: deck || hull || biggest, deckPoints: null };
}

/** The lowest point of her deck edge, in world metres (the sea is 0). */
function deckLowY(model, parts, box, p) {
  if (!parts.deckPoints) return box.setFromObject(parts.deck).min.y;
  let low = Infinity;
  const d = parts.deckPoints;
  for (let i = 0; i + 2 < d.length; i += 3) low = Math.min(low, p.set(d[i], d[i + 1], d[i + 2]).applyMatrix4(model.matrixWorld).y);
  return low;
}

/** Start First Shout fresh, the way the menu does, and settle one frame. */
async function freshShout(sim, id = 'first-shout') {
  letGo();
  const p = sim.startAnyMission(id);
  if (p && typeof p.then === 'function') await p;
  frames(sim, 1);
  return sim.vehicle;
}

export async function check(sim, r, say = () => {}) {
  const THREE = await import('../../src/vendor/three.module.js');
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const realRender = window.__realRender || sim.__realRender || null;
  try {
    await session(sim, r, say, THREE, realRender);
  } finally {
    letGo();
    sim.autoPauseOnHide = autoPause;
  }
  return r;
}

async function session(sim, r, say, THREE, realRender) {
  say('boat playtest: First Shout, from the berth');
  // Every fresh start is a new vehicle object, so `v` is re-read each time.
  let v = await freshShout(sim);
  const Terrain = await import('../../src/world/terrain.js');
  const berth = Terrain.harbourBerth();
  const mouth = Terrain.harbourMouth();

  /* ---- P1: pointing at the way out ---- */
  const offMouth = mouth ? Math.abs(rel(v.heading, bearing(v.pos, mouth))) : 999;
  r.ok(
    'P1 she starts at the berth, pointing at the way out',
    !!berth && flat(v.pos, berth) < 80 && offMouth < 20,
    `${berth ? flat(v.pos, berth).toFixed(0) : '?'} m from the berth, mouth ${offMouth.toFixed(0)} deg off the bow`
  );

  /* ---- P2: the camera has her in the first frame ---- */
  const model = sim.vehicleModel;
  model.updateMatrixWorld(true);
  sim.camera.updateMatrixWorld(true);
  const hullPt = model.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0));
  const ndc = hullPt.clone().project(sim.camera);
  const camDist = sim.camera.position.distanceTo(v.pos);
  /*
   * And not under the radio. The Coastguard's first call is on the screen
   * at this moment, across the bottom of the picture; how much of the
   * launch's on-screen box does it cover? (The hull's bounding box, all
   * eight corners projected, against the subtitle's rectangle.)
   */
  const sub = sim.hud.wrap.querySelector('.hud-subtitle');
  let underSub = 0;
  let hullBox = '';
  {
    const canvas = sim.renderer.domElement.getBoundingClientRect();
    const bb = new THREE.Box3().setFromObject(boatMeshes(model).hull);
    let x0 = 1e9;
    let x1 = -1e9;
    let y0 = 1e9;
    let y1 = -1e9;
    const c = new THREE.Vector3();
    for (let k = 0; k < 8; k++) {
      c.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).project(sim.camera);
      const px = canvas.left + ((c.x + 1) / 2) * canvas.width;
      const py = canvas.top + ((1 - c.y) / 2) * canvas.height;
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    hullBox = `hull ${Math.round(y0)}-${Math.round(y1)} px down`;
    if (sub && visible(sub)) {
      const s = sub.getBoundingClientRect();
      const ox = Math.max(0, Math.min(x1, s.right) - Math.max(x0, s.left));
      const oy = Math.max(0, Math.min(y1, s.bottom) - Math.max(y0, s.top));
      underSub = (ox * oy) / Math.max(1, (x1 - x0) * (y1 - y0));
      hullBox += `, subtitle ${Math.round(s.top)}-${Math.round(s.bottom)} px`;
    } else hullBox += ', no subtitle up';
  }
  r.ok(
    'P2 the camera has the boat in the picture from the first frame, clear of the radio',
    Math.abs(ndc.x) < 0.6 && ndc.y > -0.95 && ndc.y < 0.25 && ndc.z < 1 && camDist < 30 && underSub < 0.15,
    `boat at screen ${ndc.x.toFixed(2)},${ndc.y.toFixed(2)}, camera ${camDist.toFixed(0)} m off; ${hullBox}; ` +
      `${Math.round(underSub * 100)}% of her covered by the subtitle`
  );

  /* ---- P3: afloat at a believable waterline, over 5 s at the berth ---- */
  const hullParts = boatMeshes(model);
  const { hull } = hullParts;
  let keelLow = 99;
  let keelHigh = -99;
  let deckLow = 99;
  const box = new THREE.Box3();
  const pt = new THREE.Vector3();
  for (let i = 0; i < 50; i++) {
    frames(sim, 6);
    model.updateMatrixWorld(true);
    box.setFromObject(hull);
    keelLow = Math.min(keelLow, box.min.y);
    keelHigh = Math.max(keelHigh, box.min.y);
    deckLow = Math.min(deckLow, deckLowY(model, hullParts, box, pt));
  }
  r.ok(
    'P3 she floats at a believable waterline',
    keelLow > -0.95 && keelHigh < -0.15 && deckLow > 0.12,
    `keel ${keelLow.toFixed(2)}..${keelHigh.toFixed(2)} m, lowest deck edge ${deckLow.toFixed(2)} m (sea is 0)`
  );

  /* ---- P4: nothing painted over the water she is in ---- */
  const ray = new THREE.Raycaster(new THREE.Vector3(v.pos.x, 40, v.pos.z), new THREE.Vector3(0, -1, 0));
  const oceanHits = sim.ocean ? ray.intersectObject(sim.ocean.group, true) : [];
  const sheets = oceanHits.filter((h) => {
    if (h.point.y < 0.15 || !h.object.visible) return false;
    const col = h.object.geometry.attributes.color;
    if (!col || col.itemSize < 4 || !h.face) return true;
    const a = Math.max(col.getW(h.face.a), col.getW(h.face.b), col.getW(h.face.c));
    return a > 0.05;
  });
  r.ok(
    'P4 no surf or shallows sheet is drawn over the berth',
    sheets.length === 0,
    sheets.length ? `${sheets.length} sheet(s) at y ${sheets.map((h) => h.point.y.toFixed(2)).join(', ')}` : 'clear water'
  );

  /* ---- P5: only boat things on the HUD ---- */
  const wrap = sim.hud.wrap;
  const planeWords = [];
  for (const e of wrap.querySelectorAll('.hud-chip, .hud-bar-label, .hud-keyhint')) {
    if (visible(e)) planeWords.push(e.textContent.trim().slice(0, 18));
  }
  const panel = wrap.querySelector('.hud-boatpanel');
  const lever = wrap.querySelectorAll('.hud-lever-detent');
  r.ok(
    'P5 only boat things on the HUD',
    planeWords.length === 0 && visible(panel) && lever.length === 5,
    planeWords.length ? `aeroplane rows showing: ${planeWords.join(' | ')}` : 'depth, speed and the lever only'
  );

  /* ---- P6: an arrow a child can follow ---- */
  const tgt = sim.runner.activeTarget();
  const arrow = screenArrow(sim);
  const trueRel = tgt ? rel(v.heading, bearing(v.pos, tgt.pos)) : null;
  // And nothing drawn over it: the first toasts of a shout open right there.
  let covered = '';
  if (arrow && arrow.el) {
    const ar = arrow.el.getBoundingClientRect();
    for (const tEl of wrap.querySelectorAll('.hud-toast, .hud-subtitle, .hud-aground')) {
      if (!visible(tEl)) continue;
      const tr = tEl.getBoundingClientRect();
      if (tr.left < ar.right && tr.right > ar.left && tr.top < ar.bottom && tr.bottom > ar.top) covered = tEl.textContent.slice(0, 40);
    }
  }
  r.ok(
    'P6 an arrow on the screen points the way to go',
    !!arrow && arrow.rel !== null && tgt && Math.abs(arrow.rel - trueRel) < 45 && !covered,
    !arrow
      ? 'no arrow on the screen — the step text says "the arrow at the top of the screen points at them"'
      : arrow.stale
        ? 'only the aeroplane waypoint arrow, which the boat never updates'
        : `arrow ${arrow.rel} deg, target ${trueRel.toFixed(0)} deg off the bow` + (covered ? `; COVERED by "${covered}"` : ', nothing over it')
  );

  /* ---- P24: the wind box says the shout's weather ---- */
  // First Shout's own sky is 7 kt from 240. The box is hud.js's and only the
  // flight loop wrote it, so in the boat it showed whatever the menu left.
  frames(sim, 15);
  const windBox = wrap.querySelector('.hud-winddetail');
  const w0 = sim.weather;
  const wantWind = `${Math.round(w0.windSpeedKts)} kt from ${String(Math.round(w0.windDirDeg)).padStart(3, '0')}°`;
  r.ok(
    'P24 the wind box tells the truth in the boat',
    !!windBox && visible(windBox) && windBox.textContent.trim() === wantWind && Math.round(w0.windSpeedKts) === 7,
    `box "${windBox ? windBox.textContent.trim() : 'none'}", weather ${wantWind}`
  );

  /* ---- P25: the radio says who is talking ---- */
  const who = wrap.querySelector('.hud-subtitle-who');
  const whoText = who ? who.textContent.trim() : '';
  r.ok(
    'P25 the first radio call is the Coastguard, not an airport tower',
    /coastguard/i.test(whoText),
    `subtitle credited to "${whoText || 'nobody'}"`
  );

  /* ---- P30: what was said comes off the screen again ---- */
  /*
   * A kid reads the opening call and the "Tap Shift" notice, then looks at
   * the boat for a bit. Fifteen seconds in, still at the berth, both should
   * be gone: the notice is an 8-second toast and the call a few seconds of
   * subtitle.
   */
  {
    const firstCall = sim.hud.wrap.querySelector('.hud-subtitle-text');
    const callText = firstCall ? firstCall.textContent : '';
    seconds(sim, 15 - sim.vehicle.t);
    const sub = wrap.querySelector('.hud-subtitle');
    const callUp = !!sub && visible(sub) && firstCall && firstCall.textContent === callText && !!callText;
    const stale = [...wrap.querySelectorAll('.hud-toast')].filter((tEl) => visible(tEl) && !tEl.classList.contains('is-out') && /to go faster/.test(tEl.textContent));
    r.ok(
      'P30 fifteen seconds in, the opening call and the first notice have gone',
      !callUp && stale.length === 0,
      `opening call still up: ${callUp}; "to go faster" notice still up: ${stale.length > 0}; ` +
        `${[...wrap.querySelectorAll('.hud-toast')].filter(visible).length} toast(s) on screen at ${sim.vehicle.t.toFixed(0)} s`
    );
  }

  /* ---- P7-P10: hold go for ten seconds ---- */
  const startPos = v.pos.clone();
  const depthsSeen = new Set();
  let pMin = 9;
  let pMax = -9;
  let bMin = 9;
  let bMax = -9;
  const e = new THREE.Euler();
  down('ShiftLeft');
  for (let i = 0; i < 20; i++) {
    for (let k = 0; k < 30; k++) {
      frames(sim, 1);
      e.setFromQuaternion(model.quaternion, 'YXZ');
      if (i >= 6) {
        pMin = Math.min(pMin, e.x);
        pMax = Math.max(pMax, e.x);
        bMin = Math.min(bMin, e.z);
        bMax = Math.max(bMax, e.z);
      }
    }
    depthsSeen.add(hudDepthText(sim));
  }
  const gone = flat(v.pos, startPos);
  r.ok(
    'P7 holding go for ten seconds gets her going',
    v.lever === 4 && v.speed * KTS > 20 && gone > 80 && !v.aground && !v.crashed,
    `lever ${v.lever}, ${(v.speed * KTS).toFixed(1)} kt, ${gone.toFixed(0)} m, aground ${v.aground}, crashed ${v.crashed}`
  );
  r.ok(
    'P8 the depth sounder is alive while she moves',
    depthsSeen.size >= 3,
    `HUD depth read ${[...depthsSeen].join(' / ')}`
  );
  const pitchPP = (pMax - pMin) * 57.3;
  const rollPP = (bMax - bMin) * 57.3;
  r.ok(
    'P9 she pitches and rolls on the swell, gently',
    pitchPP > 0.6 && rollPP > 0.6 && pitchPP < 12 && rollPP < 12,
    `pitch ${pitchPP.toFixed(1)} deg, roll ${rollPP.toFixed(1)} deg peak to peak over 7 s at Full`
  );
  let wakeN = 0;
  let bowOn = false;
  if (model.userData.wake) wakeN = model.userData.wake.count;
  if (model.userData.bowWave) {
    const bw = model.userData.bowWave;
    bowOn = bw.visible && bw.material.opacity > 0.2;
  }
  if (model.userData.wakeMat) {
    wakeN = model.userData.wakeMat.opacity > 0.2 ? 50 : 0;
    bowOn = wakeN > 0;
  }
  r.ok('P10 she leaves a wake and throws a bow wave', wakeN > 10 && bowOn, `${wakeN} wake patches, bow wave ${bowOn}`);

  /* ---- P11: a full turn ---- */
  let turned = 0;
  let last = v.heading;
  let t = 0;
  let x0 = 1e9;
  let x1 = -1e9;
  let z0 = 1e9;
  let z1 = -1e9;
  let bankMax = 0;
  let touched = false;
  down('KeyD');
  while (turned < 360 && t < 40) {
    frames(sim, 1);
    t += 1 / 60;
    let d = v.heading - last;
    if (d < -180) d += 360;
    if (d > 180) d -= 360;
    turned += d;
    last = v.heading;
    x0 = Math.min(x0, v.pos.x);
    x1 = Math.max(x1, v.pos.x);
    z0 = Math.min(z0, v.pos.z);
    z1 = Math.max(z1, v.pos.z);
    e.setFromQuaternion(model.quaternion, 'YXZ');
    bankMax = Math.max(bankMax, Math.abs(e.z));
    if (v.aground || v.crashed) touched = true;
  }
  up('KeyD');
  const diam = Math.max(x1 - x0, z1 - z0);
  r.ok(
    'P11 a full turn at Full comes round cleanly inside the harbour',
    turned >= 360 && t < 20 && !touched && diam > 30 && diam < 90 && bankMax * 57.3 > 4 && bankMax * 57.3 < 16,
    `360 deg in ${t.toFixed(1)} s, ${diam.toFixed(0)} m across, leaning ${(bankMax * 57.3).toFixed(0)} deg, touched ${touched}`
  );

  /* ---- P12: let go of everything ---- */
  up('ShiftLeft');
  letGo();
  const h0 = v.heading;
  frames(sim, 60);
  const h1 = v.heading;
  seconds(sim, 4);
  const drift = Math.abs(rel(h1, v.heading));
  r.ok(
    'P12 let go of everything and she settles on a straight course',
    drift < 4 && !v.crashed,
    `heading ${h0.toFixed(0)} -> ${h1.toFixed(0)} in the first second, then ${drift.toFixed(1)} deg in 4 s; lever ${v.lever}`
  );

  /* ---- P13: pull the lever back and she carries her way ---- */
  const fromKts = v.speed * KTS;
  const wayFrom = v.pos.clone();
  tap(sim, 'ControlLeft');
  tap(sim, 'ControlLeft');
  tap(sim, 'ControlLeft');
  const leverAfterTaps = v.lever;
  let saidWay = false;
  let wt = 0;
  while (Math.abs(v.speed) > 0.3 && wt < 60) {
    frames(sim, 30);
    wt += 0.5;
    const w = wrap.querySelector('.hud-boatpanel .hud-row:not(.is-depth) .hud-word');
    if (w && /carrying/.test(w.textContent)) saidWay = true;
  }
  const carried = flat(v.pos, wayFrom);
  r.ok(
    'P13 three taps of Ctrl take her to STOP, and she carries her way',
    leverAfterTaps === 1 && carried > 60 && carried < 220 && saidWay && !v.aground,
    `lever ${leverAfterTaps} after 3 taps from ${fromKts.toFixed(0)} kt; ran on ${carried.toFixed(0)} m in ${wt.toFixed(1)} s; HUD said so: ${saidWay}; aground ${v.aground}`
  );

  /* ---- P14: turns slower when slow ---- */
  const rateAt = (lever) => {
    // From the berth, lever set with keys, then a 3 s hard turn.
    tapTo(sim, v, lever);
    seconds(sim, 8);
    const hA = v.heading;
    down('KeyA');
    seconds(sim, 2);
    up('KeyA');
    let d = hA - v.heading;
    if (d < 0) d += 360;
    return d / 2;
  };
  v = await freshShout(sim);
  const slowRate = rateAt(2);
  v = await freshShout(sim);
  const fullRate = rateAt(4);
  r.ok(
    'P14 she turns slower when she is going slowly',
    slowRate < fullRate * 0.85 && slowRate > 5,
    `${slowRate.toFixed(0)} deg/s at Slow against ${fullRate.toFixed(0)} deg/s at Full`
  );

  /* ---- P15: the lever, by taps and by holds ---- */
  v = await freshShout(sim);
  const taps = [];
  for (let i = 0; i < 4; i++) {
    tap(sim, 'ShiftLeft');
    taps.push(v.lever);
  }
  for (let i = 0; i < 5; i++) {
    tap(sim, 'ControlLeft');
    taps.push(v.lever);
  }
  down('ShiftLeft');
  seconds(sim, 2);
  const heldTo = v.lever;
  r.ok(
    'P15 one tap is one step and holding walks the lever',
    taps.join(',') === '2,3,4,4,3,2,1,0,0' && heldTo === 4,
    `taps ${taps.join(',')}; holding Shift 2 s from ASTERN reached ${heldTo}`
  );

  /* ---- P16: Ctrl works even with Shift still held ---- */
  down('ControlLeft');
  seconds(sim, 1.5);
  const withBoth = v.lever;
  up('ControlLeft');
  up('ShiftLeft');
  frames(sim, 2);
  r.ok(
    'P16 Ctrl steps her down even when Shift is still held',
    withBoth <= 2,
    `lever ${withBoth} after holding Ctrl for 1.5 s with Shift never let go`
  );

  /* ---- P31: the arrow keys drive her too ---- */
  /*
   * Plenty of kids never find Shift and Ctrl: they press the arrows. Up and
   * Down are on the lever already; Left and Right have to steer.
   */
  {
    v = await freshShout(sim);
    tap(sim, 'ArrowUp');
    tap(sim, 'ArrowUp');
    const upLever = v.lever;
    seconds(sim, 6);
    const turnFor = (code) => {
      const h0 = v.heading;
      down(code);
      seconds(sim, 3);
      up(code);
      return rel(h0, v.heading);
    };
    const right = turnFor('ArrowRight');
    seconds(sim, 1);
    const left = turnFor('ArrowLeft');
    r.ok(
      'P31 the arrow keys work: Up is faster, Left and Right steer',
      upLever === 3 && right > 25 && left < -25 && !v.aground,
      `lever ${upLever} after two taps of Up; 3 s of Right turned her ${right.toFixed(0)} deg, 3 s of Left ${left.toFixed(0)} deg`
    );
  }

  /* ---- P33: W and S, the keys every game has taught them ---- */
  /*
   * A ten-year-old who has played anything presses W to go. Two taps of W
   * should be two steps of the lever, one tap of S one step back, and
   * holding W should get her moving.
   */
  {
    v = await freshShout(sim);
    tap(sim, 'KeyW');
    tap(sim, 'KeyW');
    const afterW = v.lever;
    tap(sim, 'KeyS');
    const afterS = v.lever;
    v = await freshShout(sim);
    const from = v.pos.clone();
    down('KeyW');
    seconds(sim, 10);
    up('KeyW');
    const wMoved = flat(v.pos, from);
    r.ok(
      'P33 W and S work the lever too: W faster, S slower',
      afterW === 3 && afterS === 2 && v.lever === 4 && wMoved > 60,
      `lever ${afterW} after two taps of W, ${afterS} after one of S; ten seconds of W: lever ${v.lever}, ${wMoved.toFixed(0)} m`
    );
  }

  /* ---- P34: Space stops her, and she stays stopped ---- */
  /*
   * The key line says "Space stop". One tap at Full, hands off: she must
   * take the way off, come to rest and STAY at rest — not stop and then run
   * astern into whatever was behind her.
   */
  {
    v = await freshShout(sim);
    tapTo(sim, v, 4);
    seconds(sim, 12);
    const fromKts = v.speed * KTS;
    const at = v.pos.clone();
    tap(sim, 'Space');
    let stoppedAt = null;
    let stopRun = 0;
    let astern = 0;
    for (let i = 0; i < 30 * 60; i++) {
      frames(sim, 1);
      if (!stoppedAt && Math.abs(v.speed) < 0.3) {
        stoppedAt = v.pos.clone();
        stopRun = flat(at, v.pos);
      }
      if (stoppedAt) astern = Math.max(astern, flat(stoppedAt, v.pos));
    }
    r.ok(
      'P34 one tap of Space stops her, and she stays stopped',
      !!stoppedAt && stopRun < 70 && astern < 3 && Math.abs(v.speed) < 0.2 && v.lever === 1,
      stoppedAt
        ? `from ${fromKts.toFixed(0)} kt: stopped in ${stopRun.toFixed(0)} m, then moved ${astern.toFixed(1)} m in the next 30 s; lever ${v.lever}, ${(v.speed * KTS).toFixed(1)} kt`
        : `never stopped: ${(v.speed * KTS).toFixed(1)} kt after 30 s, lever ${v.lever}`
    );
  }

  /* ---- P35: hold W and follow the arrow, all the way out ---- */
  /*
   * What a kid actually does: holds go the whole time and steers at the
   * arrow. From the berth to the casualty in First Shout, that must not put
   * her on anything — the arrow goes round the shallows.
   */
  {
    v = await freshShout(sim);
    down('KeyW');
    let held = null;
    let t = 0;
    let bumpsOut = 0;
    let was = false;
    let arrived = false;
    // And what the sounder said on the way: it has to read the sea floor
    // falling away outside the harbour, not just wobble on the swell.
    let dMin = 99;
    let dMax = -99;
    while (t < 240) {
      const dText = parseFloat(hudDepthText(sim));
      if (Number.isFinite(dText)) {
        dMin = Math.min(dMin, dText);
        dMax = Math.max(dMax, dText);
      }
      const a = screenArrow(sim);
      const rr = a && a.rel !== null ? a.rel : 0;
      const want = rr > 6 ? 'KeyD' : rr < -6 ? 'KeyA' : null;
      if (want !== held) {
        if (held) up(held);
        if (want) down(want);
        held = want;
      }
      frames(sim, 6);
      t += 0.1;
      if (v.aground && !was) bumpsOut++;
      was = v.aground;
      if (sim.runner.step && sim.runner.step.id === 'alongside') {
        arrived = true;
        break;
      }
    }
    letGo();
    r.ok(
      'P35 holding W and steering at the arrow gets her out to the dinghy without a bump, the sounder reading the bottom',
      arrived && bumpsOut === 0 && t < 150 && dMax - dMin > 2,
      `${arrived ? 'reached the dinghy' : 'did not reach the dinghy'} in ${t.toFixed(0)} s, ${bumpsOut} bump(s), lever ${v.lever}; ` +
        `the sounder read ${dMin.toFixed(1)} to ${dMax.toFixed(1)} m on the way`
    );
  }

  /* ---- P36: a tug built from the van is not a lifeboat ---- */
  /*
   * The airport team adds drivable vehicles as copies of the van's spec and
   * starts them with startDrive(kind). None of them may start the lifeboat
   * patrol or wear the boat's HUD.
   */
  {
    const Surface = await import('../../src/vehicles/surface.js');
    Surface.VEHICLES.tugTest = { ...Surface.VEHICLES.car, id: 'tugTest', name: 'Test tug' };
    let threw = '';
    try {
      sim.startDrive('tugTest');
      frames(sim, 30);
    } catch (err) {
      threw = String(err && err.message ? err.message : err);
    }
    const tv = sim.vehicle;
    const patrol = sim.runner.status === 'running' && sim.runner.def && sim.runner.def.id === 'boat-patrol';
    const boatHud = sim.hud.wrap.classList.contains('is-boat');
    delete Surface.VEHICLES.tugTest;
    sim.quitToMenu('main');
    r.ok(
      'P36 a tug copied from the van drives as a van: no lifeboat patrol, no boat HUD',
      !threw && !!tv && !tv.isBoat && !patrol && !boatHud,
      threw ? `threw: ${threw}` : `isBoat ${tv && tv.isBoat}, lifeboat patrol running ${patrol}, boat HUD ${boatHud}`
    );
  }

  /* ---- P17: the kid's first turn at Full, both ways ---- */
  const bumps = [];
  for (const key of ['KeyD', 'KeyA']) {
    v = await freshShout(sim);
    down('ShiftLeft');
    seconds(sim, 20);
    down(key);
    let ever = false;
    let ended = false;
    let msg = '';
    let groundedAt = -1;
    let freedAt = -1;
    let told = '';
    for (let i = 0; i < 12 * 60; i++) {
      frames(sim, 1);
      if (v.crashed) ended = true;
      if (v.aground && !ever) {
        ever = true;
        groundedAt = i / 60;
        msg = v.agroundMessage || '';
      }
      if (ever && !v.aground && freedAt < 0) freedAt = i / 60;
      // What the screen says in the second after she comes off.
      if (freedAt >= 0 && i / 60 - freedAt < 1 && !told) {
        const cap = wrap.querySelector('.hud-aground');
        if (cap && visible(cap)) told = cap.textContent;
      }
    }
    up(key);
    up('ShiftLeft');
    bumps.push({ key, ended, ever, msg, told, freed: freedAt >= 0 ? freedAt - groundedAt : null, crash: v.crashReason });
  }
  r.ok(
    'P17 holding Full into the first turn is a bump and a back-off, not the end',
    bumps.every((b) => !b.ended && (!b.ever || (b.freed !== null && b.freed < 8 && /back|Bump/i.test(b.msg)))),
    bumps
      .map((b) =>
        b.ended
          ? `${b.key}: ENDED — "${b.crash}"`
          : b.ever
            ? `${b.key}: bump, "${b.msg}", afloat again ${b.freed === null ? 'NEVER (still stuck after 12 s)' : `after ${b.freed.toFixed(1)} s`}`
            : `${b.key}: never touched`
      )
      .join('; ')
  );

  const offBumps = bumps.filter((b) => b.ever && b.freed !== null);
  r.ok(
    'P26 when she comes off, the screen says what to press',
    offBumps.length > 0 && offBumps.every((b) => /Shift/.test(b.told)),
    offBumps.length
      ? offBumps.map((b) => `${b.key}: "${(b.told || 'nothing').slice(0, 80)}"`).join('; ')
      : 'she never came off anything, so this proves nothing'
  );

  /* ---- P18: channel buoys and harbour-mouth marks in the water ---- */
  v = await freshShout(sim);
  let buoys = 0;
  sim.scene.traverse((o) => {
    if (o.isInstancedMesh && /buoy/i.test(o.name || '')) buoys = Math.max(buoys, o.count);
  });
  const marks = Terrain.channelMarks ? Terrain.channelMarks().length : 0;
  r.ok(
    'P18 the channel buoys the step text talks about are in the water',
    buoys >= marks && marks > 0,
    `${buoys} buoys drawn for ${marks} marks on the chart`
  );

  /* ---- P19: no white streaks across the sea ---- */
  /*
   * A streak is a quad of a coast ring whose two rays found different bits
   * of coast: its along-the-shore edge is several times the ring's normal
   * spacing, so the foam texture is dragged hundreds of metres across it.
   * Rings are recognised by their strip layout (a, a+1, a+2, a+1, a+3, a+2).
   */
  let slivers = 0;
  let worst = 0;
  if (sim.ocean) {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    sim.ocean.group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry.index) return;
      const pos = o.geometry.attributes.position;
      const col = o.geometry.attributes.color;
      const idx = o.geometry.index.array;
      if (pos.count % 2 || idx.length > (pos.count / 2 - 1) * 6 || idx.length < 12) return;
      if (idx[1] !== idx[0] + 1 || idx[2] !== idx[0] + 2) return;
      const lens = [];
      for (let i = 0; i < idx.length; i += 6) {
        a.fromBufferAttribute(pos, idx[i]);
        b.fromBufferAttribute(pos, idx[i] + 2);
        lens.push(a.distanceTo(b));
      }
      const sorted = lens.slice().sort((x, y) => x - y);
      const median = sorted[sorted.length >> 1];
      lens.forEach((L, k) => {
        const i0 = idx[k * 6];
        const alpha = col && col.itemSize === 4 ? Math.max(col.getW(i0), col.getW(i0 + 1), col.getW(i0 + 2), col.getW(i0 + 3)) : 1;
        if (L > median * 2.5 && L > 60 && alpha > 0.05) {
          slivers++;
          worst = Math.max(worst, L);
        }
      });
    });
  }
  r.ok(
    'P19 no long white streaks drawn across the sea',
    slivers === 0,
    `${slivers} coast-band quads stretched across a gap in the coast (worst ${worst.toFixed(0)} m along the shore)`
  );

  /* ---- P20: the sea looks like the sea from the boat ---- */
  /*
   * Measured a hundred-odd metres down the channel at Half, where the only
   * thing either side of her in the bottom of the frame is water: at the
   * berth the lifeboat jetty is in the bottom left of the picture. Two
   * numbers: how blue it is, and how much it varies from one pixel to the
   * next — a flat colour, however blue, is paint, not sea.
   */
  if (realRender) {
    v = await freshShout(sim);
    tapTo(sim, v, 3);
    seconds(sim, 11);
    realRender(sim.scene, sim.camera);
    const src = sim.renderer.domElement;
    const W = 320;
    const Hh = Math.round((W * src.height) / src.width);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = Hh;
    const g = cv.getContext('2d');
    g.drawImage(src, 0, 0, W, Hh);
    const px = g.getImageData(0, 0, W, Hh).data;
    let sat = 0;
    let blue = 0;
    let n = 0;
    let lum = 0;
    let dl = 0;
    const L = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    // The bottom quarter, left and right thirds: sea, not boat.
    for (let y = Math.round(Hh * 0.75); y < Hh - 3; y++) {
      for (let x = 0; x < W; x++) {
        if (x > W * 0.31 && x < W * 0.69) continue;
        const i = (y * W + x) * 4;
        const R = px[i];
        const G = px[i + 1];
        const B = px[i + 2];
        const mx = Math.max(R, G, B);
        const mn = Math.min(R, G, B);
        sat += mx ? (mx - mn) / mx : 0;
        blue += B >= R && B >= G * 0.9 ? 1 : 0;
        lum += L(i);
        dl += Math.abs(L(i) - L(i + W * 4 * 3));
        n++;
      }
    }
    sat /= n;
    const texture = dl / Math.max(1, lum);
    r.ok(
      'P20 from the boat the sea is blue and has waves on it, not flat grey',
      sat > 0.33 && blue / n > 0.8 && texture > 0.02,
      `mean saturation ${sat.toFixed(2)} (grey is under 0.25), ${Math.round((100 * blue) / n)}% blue pixels, ` +
        `pixel-to-pixel variation ${(texture * 100).toFixed(1)}% (a flat colour is under 1%)`
    );
  } else {
    r.ok('P20 from the boat the sea is blue and has waves on it, not flat grey', false, 'no real renderer: set window.__realRender before stubbing');
  }

  /* ---- P22: every wall she can hit is a wall you can see ---- */
  /*
   * On a 5 m grid round the harbour: where heightAt says there is solid
   * ground ABOVE the water — a wall, a quay, a beach — is anything drawn
   * above the water there, the terrain mesh or the harbour works? A cell of
   * solid ground drawn under the sea is an invisible wall. (Shallows, where
   * the ground is under the water but within her metre of draught, are
   * meant to be under the water: they are counted in the detail, and told
   * apart by the sounder and the "shallow water ahead" warning.)
   */
  {
    const drawn = drawnHeightSampler(sim);
    let walls = 0;
    let solid = 0;
    let shoals = 0;
    const eg = [];
    const x0 = Math.min(berth.x, mouth.x) - 260;
    const x1 = Math.max(berth.x, mouth.x) + 260;
    const z0 = Math.min(berth.z, mouth.z) - 260;
    const z1 = Math.max(berth.z, mouth.z) + 260;
    for (let x = x0; x <= x1; x += 5) {
      for (let z = z0; z <= z1; z += 5) {
        const h = Terrain.heightAt(x, z);
        if (h <= -1 || h > 6) continue;
        const d = drawn(x, z);
        if (h <= 0.3) {
          if (d < h - 1) shoals++;
          continue;
        }
        solid++;
        if (d < -0.3) {
          walls++;
          if (eg.length < 4) eg.push(`${x.toFixed(0)},${z.toFixed(0)} ground +${h.toFixed(1)} m drawn ${d.toFixed(1)} m`);
        }
      }
    }
    r.ok(
      'P22 every harbour wall she can bump into is drawn above the water',
      walls === 0 && solid > 100,
      `${walls} of ${solid} five-metre cells of solid ground are drawn under the sea` +
        (eg.length ? ` (${eg.join('; ')})` : '') +
        `; ${shoals} shallow cells drawn more than a metre deeper than they are`
    );
  }

  /* ---- P27: something to come alongside at the end ---- */
  {
    let jetty = null;
    sim.scene.traverse((o) => {
      if (o.name === 'lifeboatBerth') jetty = o;
    });
    const jp = jetty ? jetty.getWorldPosition(new THREE.Vector3()) : null;
    const off = jp ? flat(jp, berth) : Infinity;
    r.ok(
      'P27 the lifeboat berth has a jetty to come alongside',
      !!jetty && off > 3 && off < 15,
      jetty ? `jetty ${off.toFixed(1)} m from the berth` : 'nothing at the berth but open water'
    );
  }

  /* ---- P32: the jetty is solid ---- */
  /*
   * Coming home, the arrow points at the berth and the words say "stop
   * alongside the yellow jetty". A kid who aims at the jetty itself must
   * bump it, not sail through it. Put her thirty metres off its seaward end,
   * pointing at it (the one place this test moves her by hand), and let her
   * run in at Slow.
   */
  {
    v = await freshShout(sim);
    let jetty = null;
    sim.scene.traverse((o) => {
      if (o.name === 'lifeboatBerth') jetty = o;
    });
    if (!jetty) {
      r.ok('P32 the jetty is solid: she bumps it, she does not sail through it', false, 'no jetty to test');
    } else {
      jetty.updateMatrixWorld(true);
      const jp = jetty.getWorldPosition(new THREE.Vector3());
      const ax = new THREE.Vector3(0, 0, 1).applyQuaternion(jetty.getWorldQuaternion(new THREE.Quaternion()));
      const toMouth = mouth && (mouth.x - jp.x) * ax.x + (mouth.z - jp.z) * ax.z < 0 ? -1 : 1;
      const start = new THREE.Vector3(jp.x + ax.x * 30 * toMouth, 0, jp.z + ax.z * 30 * toMouth);
      v.reset({ pos: start, headingDeg: bearing(start, jp) });
      tap(sim, 'ShiftLeft');
      let inside = 0;
      let hitMsg = '';
      let nearest = 99;
      for (let i = 0; i < 20 * 60; i++) {
        frames(sim, 1);
        const dx = v.pos.x - jp.x;
        const dz = v.pos.z - jp.z;
        const along = Math.abs(dx * ax.x + dz * ax.z) - 7;
        const across = Math.abs(-dx * ax.z + dz * ax.x) - 1.2;
        nearest = Math.min(nearest, Math.max(along, across));
        if (along < 0 && across < 0) inside++;
        if (v.aground && !hitMsg) hitMsg = v.agroundMessage || '(no message)';
      }
      letGo();
      r.ok(
        'P32 the jetty is solid: she bumps it, she does not sail through it',
        inside === 0 && /jetty/i.test(hitMsg),
        `her middle inside the jetty's footprint for ${(inside / 60).toFixed(1)} s, closest ${nearest.toFixed(1)} m; ` +
          `on the way in: "${hitMsg || 'no bump'}"`
      );
    }
  }

  /* ---- P28: the boat's readouts do not allocate every frame ---- */
  {
    const same = v.readouts() === v.readouts();
    r.ok(
      'P28 the readouts asked for three times a frame are one object, not three new ones',
      same,
      same ? 'the same object on every call' : 'a new thirty-field object on every call'
    );
  }

  /* ---- P29: in a gale she rides the sea, she does not sink into it ---- */
  /*
   * In the Gale, three taps to Full and forty seconds out past the harbour,
   * then ten seconds watched: the deck edge must stay above the (flat) sea
   * and the keel in it, with the pitch and roll of a big sea still there.
   */
  {
    v = await freshShout(sim, 'in-the-gale');
    const gm = sim.vehicleModel;
    const parts = boatMeshes(gm);
    tapTo(sim, v, 4);
    seconds(sim, 40);
    let dLow = 99;
    let kLow = 99;
    let kHigh = -99;
    let under = 0;
    let rMin = 9;
    let rMax = -9;
    const bx = new THREE.Box3();
    const eu = new THREE.Euler();
    const pt = new THREE.Vector3();
    for (let i = 0; i < 600; i++) {
      frames(sim, 1);
      gm.updateMatrixWorld(true);
      const dy = deckLowY(gm, parts, bx, pt);
      dLow = Math.min(dLow, dy);
      if (dy < 0) under++;
      bx.setFromObject(parts.hull);
      kLow = Math.min(kLow, bx.min.y);
      kHigh = Math.max(kHigh, bx.min.y);
      eu.setFromQuaternion(gm.quaternion, 'YXZ');
      rMin = Math.min(rMin, eu.z);
      rMax = Math.max(rMax, eu.z);
    }
    const rollPP = (rMax - rMin) * 57.3;
    r.ok(
      'P29 in the Gale she rides the sea: deck never under, and she still rolls',
      under === 0 && dLow > 0 && kLow > -1.2 && kHigh < 0 && rollPP > 4,
      `sea ${v.seaWord}, ${(v.speed * KTS).toFixed(0)} kt: lowest deck edge ${dLow.toFixed(2)} m, deck under the sea in ${Math.round(under / 6)}% of frames, ` +
        `keel ${kLow.toFixed(2)}..${kHigh.toFixed(2)} m, roll ${rollPP.toFixed(0)} deg peak to peak`
    );
  }

  /* ---- P37: at night the sea round her is still a sea ---- */
  /*
   * Night Shout, forty-five seconds out holding W and steering at the
   * arrow. It must actually be night, and the bottom half of the picture —
   * the water round her — must not be black: bright enough to see, and with
   * waves in it (brightness varying from one pixel to the next).
   */
  if (realRender) {
    v = await freshShout(sim, 'night-shout');
    down('KeyW');
    let held = null;
    for (let i = 0; i < 450; i++) {
      const a = screenArrow(sim);
      const rr = a && a.rel !== null ? a.rel : 0;
      const want = rr > 6 ? 'KeyD' : rr < -6 ? 'KeyA' : null;
      if (want !== held) {
        if (held) up(held);
        if (want) down(want);
        held = want;
      }
      frames(sim, 6);
    }
    letGo();
    realRender(sim.scene, sim.camera);
    const src = sim.renderer.domElement;
    const W = 320;
    const Hh = Math.round((W * src.height) / src.width);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = Hh;
    const g = cv.getContext('2d');
    g.drawImage(src, 0, 0, W, Hh);
    const px = g.getImageData(0, 0, W, Hh).data;
    const L = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    let lum = 0;
    let dl = 0;
    let n = 0;
    for (let y = Math.round(Hh * 0.5); y < Hh - 4; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        lum += L(i);
        dl += Math.abs(L(i) - L(i + W * 4 * 3));
        n++;
      }
    }
    const meanPct = (lum / n / 255) * 100;
    const varPct = (dl / n / 255) * 100;
    const night = !!sim.weather.isNight;
    r.ok(
      'P37 at night the water round her can be seen, waves and all',
      night && meanPct > 3.5 && varPct > 0.6,
      `night ${night}; bottom half of the picture ${meanPct.toFixed(1)}% bright, ` +
        `${varPct.toFixed(2)}% from one pixel to the next (black water is under 2% and 0.5%)`
    );
  } else {
    r.ok('P37 at night the water round her can be seen, waves and all', false, 'no real renderer: set window.__realRender before stubbing');
  }

  /* ---- P21: First Shout, start to finish, like a kid ---- */
  const res = await playShout(sim, 'first-shout', say);
  r.ok(
    'P21 First Shout can be finished by following the arrow and the words',
    res.status === 'complete' && res.noArrowS < 3,
    res.detail
  );

  /* ---- P23: out of the boat, everything is put back ---- */
  /*
   * Night Shout borrows the night: quit it to the menu and start a flight,
   * and the flight has daylight, the aeroplane's panel and none of the
   * boat's.
   */
  await freshShout(sim, 'night-shout');
  seconds(sim, 2);
  const inBoat = sim.weather.isNight;
  sim.quitToMenu('main');
  const started = sim.startMode('free');
  if (started && typeof started.then === 'function') await started;
  frames(sim, 30);
  const hw = sim.hud.wrap;
  const planeBack = [...hw.querySelectorAll('.hud-bottom, .hud-left:not(.hud-boatpanel)')].some(visible);
  const boatGone =
    !hw.classList.contains('is-boat') &&
    !visible(hw.querySelector('.hud-boatpanel')) &&
    !visible(hw.querySelector('.hud-boatarrow')) &&
    !sim.vehicleModel;
  const after = sim.weather.serialize();
  r.ok(
    'P23 leaving the boat puts the aeroplane HUD and the weather back',
    inBoat && planeBack && boatGone && !sim.weather.isNight,
    `night in the boat ${inBoat}; then in a free flight: aeroplane panel ${planeBack}, boat panel gone ${boatGone}, ` +
      `sky ${after.time} ${after.condition}`
  );
}

/**
 * The height of whatever is DRAWN at (x, z): the terrain mesh, interpolated
 * across its grid, and the harbour works if there are any. Built once.
 */
function drawnHeightSampler(sim) {
  const grids = [];
  const terrain = sim.scene.children.find((c) => c.name === 'terrain');
  if (terrain) {
    terrain.updateMatrixWorld(true);
    terrain.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.parameters || !o.geometry.parameters.widthSegments) return;
      const P = o.geometry.attributes.position;
      const N = o.geometry.parameters.widthSegments + 1;
      const e = o.matrixWorld.elements;
      grids.push({
        P,
        N,
        ox: P.getX(0) + e[12],
        oz: P.getZ(0) + e[14],
        oy: e[13],
        dx: P.getX(1) - P.getX(0),
        dz: P.getZ(N) - P.getZ(0),
      });
    });
  }
  // The harbour works: a 3 m mesh, so whatever is drawn at a point is
  // spanned by the vertices within 2.5 m of it. Binned by 5 m cell.
  const bins = new Map();
  let works = null;
  sim.scene.traverse((o) => {
    if (o.name === 'harbourWorks') works = o;
  });
  if (works) {
    const P = works.geometry.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const k = `${Math.round(P.getX(i) / 5)},${Math.round(P.getZ(i) / 5)}`;
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(P.getX(i), P.getY(i), P.getZ(i));
    }
  }
  return (x, z) => {
    let best = -99;
    for (const g of grids) {
      const fx = (x - g.ox) / g.dx;
      const fz = (z - g.oz) / g.dz;
      const i = Math.floor(fx);
      const j = Math.floor(fz);
      if (i < 0 || j < 0 || i >= g.N - 1 || j >= g.N - 1) continue;
      const u = fx - i;
      const w = fz - j;
      const y = (a, b) => g.P.getY(b * g.N + a);
      const h = y(i, j) * (1 - u) * (1 - w) + y(i + 1, j) * u * (1 - w) + y(i, j + 1) * (1 - u) * w + y(i + 1, j + 1) * u * w;
      best = Math.max(best, h + g.oy);
    }
    const bx = Math.round(x / 5);
    const bz = Math.round(z / 5);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const list = bins.get(`${bx + a},${bz + b}`);
        if (!list) continue;
        for (let i = 0; i < list.length; i += 3) {
          if (Math.hypot(list[i] - x, list[i + 2] - z) <= 2.5) best = Math.max(best, list[i + 1]);
        }
      }
    }
    return best;
  };
}

/** Tap the lever to a detent with keys, like a child counting clicks. */
function tapTo(sim, v, want) {
  let guard = 0;
  while (v.lever !== want && guard++ < 10) tap(sim, v.lever < want ? 'ShiftLeft' : 'ControlLeft');
}

/**
 * Play one boat mission to the end, the way the words tell you to.
 *
 * Steering: the on-screen arrow if there is one; if the build has no arrow
 * (the base had none) it falls back to the mission's real target, and says
 * so in the detail, because a child would have had nothing to steer by.
 * Lever: what the step text asks for — Half out, Slow and then Stop to come
 * alongside and hold there, Half at most on a tow, and a sweep back and forth
 * when told to search.
 */
export async function playShout(sim, id, say = () => {}, maxSeconds = 1200) {
  const v = await freshShout(sim, id);
  const runner = sim.runner;
  let t = 0;
  let held = null;
  let noArrow = 0;
  let bumps = 0;
  let wasAground = false;
  let sweep = 0;
  let lastLeverTap = 0;
  const stepsSeen = [];
  const steer = (want) => {
    if (want !== held) {
      if (held) up(held);
      if (want) down(want);
      held = want;
    }
  };
  while (runner.status === 'running' && t < maxSeconds) {
    const step = runner.step;
    if (step && stepsSeen[stepsSeen.length - 1] !== step.id) stepsSeen.push(step.id);
    const text = (step && `${step.text} ${step.hint || ''}`) || '';
    const tg = runner.activeTarget();
    const d = tg ? flat(v.pos, tg.pos) : 0;

    /* where to point */
    let r0 = null;
    const arrow = screenArrow(sim);
    if (arrow && arrow.rel !== null) r0 = arrow.rel;
    else if (tg) {
      noArrow++;
      r0 = rel(v.heading, bearing(v.pos, tg.pos));
    }
    const searching = step && /^Search/.test(step.text || '') && !runner.data.narrowed && !runner.data.found;
    if (searching && runner.data.searchCentre) {
      // "Run lines across the area": legs 280 m long, 90 m apart.
      const c = runner.data.searchCentre;
      const legs = [[-140, -120], [140, -120], [140, -30], [-140, -30], [-140, 60], [140, 60], [140, 140], [-140, 140]];
      const w = legs[sweep % legs.length];
      const wp = { x: c.x + w[0], z: c.z + w[1] };
      if (flat(v.pos, wp) < 30) sweep++;
      r0 = rel(v.heading, bearing(v.pos, wp));
    }
    steer(r0 === null ? null : r0 > 6 ? 'KeyD' : r0 < -6 ? 'KeyA' : null);

    /* how fast */
    const alongside = /alongside|pass her|take them off|Get alongside|and stop|stop at the quay|quay and stop/i.test(step ? step.text : '');
    const towing = /line|tow|Gently/i.test(step ? step.text : '') && !alongside;
    let want = 3;
    if (alongside) {
      // Slow, then Stop, and let her run up to it; a touch of astern if she is
      // still going too fast close in.
      const kts = Math.abs(v.speed) * KTS;
      if (d > 220) want = 3;
      else if (d > 60) want = 2;
      else if (d > 10) want = kts > 3 ? 1 : kts < 1.2 ? 2 : 1;
      else want = kts > 1.5 ? 0 : 1;
      if (Math.abs(r0 || 0) > 70 && d < 60) want = Math.min(want, 2);
    } else if (towing) {
      want = 3;
    } else if (searching) {
      want = 2;
    }
    if (v.aground) want = v.lever;
    // One click at a time, a fifth of a second apart, like fingers.
    if (v.lever !== want && t - lastLeverTap > 0.2) {
      lastLeverTap = t;
      const k = v.lever < want ? 'ShiftLeft' : 'ControlLeft';
      down(k);
      frames(sim, 1);
      up(k);
      frames(sim, 1);
      t += 2 / 60;
    }
    if (v.aground && !wasAground) bumps++;
    wasAground = v.aground;
    frames(sim, 6);
    t += 6 / 60;
  }
  steer(null);
  letGo();
  const status = runner.status === 'running' ? `unfinished at ${t.toFixed(0)} s` : runner.status;
  const data = runner.data || {};
  const detail =
    `${id}: ${status} in ${t.toFixed(0)} s sim time; steps ${stepsSeen.join(' > ')}; ` +
    `${bumps} bump(s), touches ${data.touches || 0}, lines parted ${data.towsParted || 0}, score ${data.score ?? '-'}` +
    (noArrow > 10 ? `; NO ARROW on screen for ${Math.round(noArrow * 0.1)} s — steered by the hidden target` : '');
  say(detail);
  return { status: runner.status, t, bumps, detail, data, noArrowS: noArrow * 0.1 };
}

/** Every boat shout, start to finish, by the same kid. */
export async function playAllBoatMissions(sim, r, say = () => {}) {
  const { BOAT_MISSIONS } = await import('../../src/game/missions-boat.js');
  const out = [];
  for (const m of BOAT_MISSIONS) {
    const res = await playShout(sim, m.id, say);
    r.ok(`M ${m.name} can be finished by following its own instructions`, res.status === 'complete' && res.noArrowS < 3, res.detail);
    out.push(res);
  }
  return out;
}
