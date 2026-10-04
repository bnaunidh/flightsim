/**
 * The flicker probe: how much of the screen flashes, measured on the real
 * renderer.
 *
 * The owner: "graphic errors that can cause seziure". Their screenshot (v56,
 * a Skylark diving at 27,700 ft over Kestrel, chase view looking down) shows
 * the coastlines outlined in strobing green and white and the low cays as
 * sparkling discs. This module puts the game in a scenario (map, weather,
 * altitude, view, attitude), flies it for a couple of seconds at a fixed
 * frame rate with the game's own clock (sim.step), reads every frame back off
 * the canvas and counts, for every pixel, how often its brightness goes up
 * and comes back down again.
 *
 * THE METRIC. WCAG 2.3.1 calls a "flash" a pair of opposing changes in
 * relative luminance of 10% or more where the darker state is under 0.80,
 * and fails content with more than three flashes in any one second over more
 * than a quarter of any 10-degree field of view (341 x 256 px of a 1024 x 768
 * screen at a normal viewing distance, a third of the screen each way). So:
 *
 *   - A TRANSITION is a move of at least T away from the last extreme in the
 *     other direction (hysteresis, so slow drifts and one-way changes, like
 *     an edge sliding past as the camera moves, count once and not at all
 *     for flashing).
 *   - A pixel FLICKERS when it makes more than six transitions (more than
 *     three there-and-back flashes) inside any one second of game time.
 *   - Two thresholds are tracked side by side:
 *       wcag  T = 0.10 in linear relative luminance, darker state < 0.80 —
 *             the standard's own definition;
 *       perc  T = 0.05 in display (gamma) luma, about 13 of 255 — a visible
 *             shimmer that is too dim for the standard to count. Z-fighting
 *             of a translucent band over sand is mostly this: the standard
 *             does not call it a flash but it is what made the coast strobe.
 *   - area    = fraction of the screen that flickers;
 *     window  = the worst third-by-third window's flickering fraction (the
 *               WCAG 10-degree-field test; 0.25 or more there is a fail);
 *     worst   = the worst cell of an 8 x 6 grid, with what a ray through
 *               its flickering pixels hits, nearest first.
 *
 * With `zfight: <rays>`, the flickering pixels are also sorted into z-fights
 * (two surfaces within a few depth-buffer steps of each other, polygon
 * offsets counted: decided by rounding, which strobes as the camera moves)
 * and everything else (something moving), with the fighting pairs named.
 *
 * The HUD is HTML on top of the canvas and is not in these numbers.
 *
 * Used by tests/features/flicker.browser.js (the regression check) and by the
 * stand-alone sweep (the scratchpad probe.mjs, driven through
 * .claude/devtools/cdp.mjs).
 */

const FT = 3.28084;

/** sRGB byte -> linear, once. */
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * One threshold's worth of per-pixel state.
 * `wcag` adds the standard's "darker state under 0.80" rule.
 */
class Tracker {
  constructor(n, T, wcag) {
    this.n = n;
    this.T = T;
    this.wcag = wcag;
    this.pk = new Float32Array(n); // running extreme in the current direction (hi while undecided)
    this.lo = new Float32Array(n); // running low while undecided
    this.dir = new Int8Array(n);
    this.ring = new Uint8Array(n * 6); // frames of the last six transitions
    this.cnt = new Uint16Array(n);
    this.flag = new Uint8Array(n);
  }

  first(v) {
    this.pk.set(v);
    this.lo.set(v);
  }

  step(v, f, fps) {
    const { pk, lo, dir, ring, cnt, flag, T, wcag, n } = this;
    for (let i = 0; i < n; i++) {
      const x = v[i];
      const d = dir[i];
      let t = 0;
      if (d === 0) {
        if (x > pk[i]) pk[i] = x;
        if (x < lo[i]) lo[i] = x;
        if (x - lo[i] >= T && (!wcag || lo[i] < 0.8)) t = 1;
        else if (pk[i] - x >= T && (!wcag || x < 0.8)) t = -1;
      } else if (d > 0) {
        if (x > pk[i]) pk[i] = x;
        else if (pk[i] - x >= T && (!wcag || x < 0.8)) t = -1;
      } else {
        if (x < pk[i]) pk[i] = x;
        else if (x - pk[i] >= T && (!wcag || pk[i] < 0.8)) t = 1;
      }
      if (t === 0) continue;
      dir[i] = t;
      pk[i] = x;
      const c = cnt[i];
      const s = i * 6 + (c % 6);
      // This transition and the six before it inside one second: more than
      // three flashes a second.
      if (c >= 6 && f - ring[s] < fps) flag[i] = 1;
      ring[s] = f;
      cnt[i] = c + 1;
    }
  }

  /** Flagged fraction overall, and the worst W/3 x H/3 window's. */
  area(W, H) {
    const { flag } = this;
    let total = 0;
    // Integral image, rows top-down in whatever order the pixels came in;
    // the window test does not care about orientation.
    const I = new Uint32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        const v = flag[y * W + x];
        row += v;
        total += v;
        I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
      }
    }
    const ww = Math.round(W / 3);
    const wh = Math.round(H / 3);
    const sx = Math.max(1, Math.round(W / 48));
    const sy = Math.max(1, Math.round(H / 48));
    let worst = 0;
    for (let y = 0; y + wh <= H; y += sy) {
      for (let x = 0; x + ww <= W; x += sx) {
        const s = I[(y + wh) * (W + 1) + x + ww] - I[y * (W + 1) + x + ww] - I[(y + wh) * (W + 1) + x] + I[y * (W + 1) + x];
        if (s > worst) worst = s;
      }
    }
    return { area: total / (W * H), window: worst / (ww * wh), pixels: total };
  }
}

const sleep = (ms) => new Promise((f) => setTimeout(f, ms));

const mat = (o) => (Array.isArray(o.material) ? o.material[0] : o.material) || {};

/** Drawn at all: the object and every parent visible, and its material too. */
function drawn(o) {
  for (let p = o; p; p = p.parent) if (p.visible === false) return false;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  if (!m || m.visible === false) return false;
  if (m.transparent && m.opacity <= 0.01) return false;
  return true;
}

/** A short name for a hit: its own name, else the nearest named parent's, and its material. */
function hitName(o) {
  let n = o.name;
  for (let p = o.parent; !n && p; p = p.parent) n = p.name && `${p.name}/${o.type}`;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  const f = m ? `${m.transparent ? 't' : ''}${m.depthWrite === false ? 'w' : ''}${m.depthTest === false ? 'd' : ''}${m.polygonOffset ? `o${m.polygonOffsetUnits}` : ''}` : '';
  return `${n || o.type}${f ? `(${f})` : ''}`;
}

/**
 * Z-FIGHT ATTRIBUTION. Of the flickering pixels, which are two surfaces
 * fighting in the depth buffer? A ray through a sample of them; where the
 * first two depth-tested surfaces it meets are within a few steps of the
 * depth buffer of each other (24 bits, the camera's own near plane: a step is
 * z^2 / (near * 2^24)), that pixel is decided by rounding and not by what is
 * in front, so it is counted as a z-fight, under the pair's names.
 * Everything else that flickers is something moving (a texture sliding past,
 * a thin line, an effect).
 */
function attributeZfight(THREE, sim, flag, W, H, samples = 160, steps = 4) {
  const idx = [];
  for (let i = 0; i < flag.length; i++) if (flag[i]) idx.push(i);
  const out = { flagged: idx.length, samples: 0, zfight: 0, pairs: [] };
  if (!idx.length) return out;
  const rc = new THREE.Raycaster();
  rc.camera = sim.camera;
  const near = sim.camera.near;
  const pairs = new Map();
  const n = Math.min(samples, idx.length);
  const v = new THREE.Vector2();
  for (let k = 0; k < n; k++) {
    const i = idx[Math.floor(((k + 0.5) / n) * idx.length)];
    const gx = i % W;
    const gy = Math.floor(i / W);
    v.set(((gx + 0.5) / W) * 2 - 1, ((gy + 0.5) / H) * 2 - 1);
    rc.setFromCamera(v, sim.camera);
    const above = sim.camera.position.y > 0;
    const hits = rc
      .intersectObjects(sim.scene.children, true)
      .filter(
        (h) =>
          h.object.isMesh &&
          drawn(h.object) &&
          mat(h.object).depthTest !== false &&
          // The terrain under the sea is not drawn (terrain.js SEA_CUT).
          !(above && h.point.y < 0 && h.object.onBeforeRender && h.object.onBeforeRender.name === 'seaCut')
      )
      .slice(0, 2);
    out.samples++;
    if (hits.length < 2) continue;
    const [a, b] = hits;
    // Same mesh (its own folds), or two layers neither of which writes depth
    // (they blend, and never test against each other).
    if (a.object === b.object || (mat(a.object).depthWrite === false && mat(b.object).depthWrite === false)) continue;
    const step = (a.distance * a.distance) / (near * 16777216);
    // How far apart the depth test sees them, in steps: the distance, and
    // the polygon offsets each one is drawn with.
    const off = (o) => (mat(o).polygonOffset ? mat(o).polygonOffsetUnits : 0);
    const apart = (b.distance - a.distance) / step + off(b.object) - off(a.object);
    if (Math.abs(apart) >= steps) continue;
    out.zfight++;
    const key = `${hitName(a.object)} | ${hitName(b.object)}`;
    const p = pairs.get(key) || { n: 0, at: a.distance, gap: b.distance - a.distance, step };
    p.n++;
    pairs.set(key, p);
  }
  out.pairs = [...pairs.entries()]
    .sort((x, y) => y[1].n - x[1].n)
    .slice(0, 6)
    .map(([k, p]) => `${p.n}x ${k} @${p.at.toFixed(0)}m gap ${p.gap.toFixed(2)}m step ${p.step.toFixed(2)}m`);
  return out;
}

/** Where the coast is: the first sea point walking out from an island's middle. */
function coastPoint(T, isl, ang) {
  const dx = Math.cos(ang);
  const dz = Math.sin(ang);
  let lo = isl.radius * 0.2;
  let hi = isl.radius * 2.2;
  if (T.heightAt(isl.cx + dx * hi, isl.cz + dz * hi) > 0) return null;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (T.heightAt(isl.cx + dx * mid, isl.cz + dz * mid) > 0) lo = mid;
    else hi = mid;
  }
  const r = (lo + hi) / 2;
  return { x: isl.cx + dx * r, z: isl.cz + dz * r };
}

/** The coast of the biggest island that has one (the main island, usually). */
function mainCoast(T) {
  const isls = [...T.ISLANDS].sort((a, b) => b.radius - a.radius);
  for (const isl of isls) {
    for (let k = 0; k < 16; k++) {
      const p = coastPoint(T, isl, 0.6 + (k / 16) * Math.PI * 2);
      if (p) return p;
    }
  }
  return { x: 0, z: 0 };
}

/**
 * Put the game into a scenario.
 *
 *   s = { map, time, condition, view: 'chase'|'cockpit'|'tower', look: 'down'|'level',
 *         altFt (0 = rolling on the runway), aircraft, speed (m/s), dive (deg),
 *         at: {x, z} (default: the main island's coast), heading (deg),
 *         lightning: seconds to the next strike (storm), settings: {k: v} }
 */
export async function setupScenario(sim, s) {
  const THREE = await import('../src/vendor/three.module.js');
  const T = await import('../src/world/terrain.js');
  sim.autoPauseOnHide = false;
  if (s.map && (sim.settings.map !== s.map || T.MAP.id !== s.map)) {
    // setMap() rebuilds behind a paint: wait for the new scenery to exist.
    const before = sim.scenery;
    sim.setMap(s.map);
    for (let i = 0; i < 600 && (sim.scenery === before || T.MAP.id !== s.map); i++) await sleep(10);
    await sleep(100);
  }
  if (s.settings) for (const [k, v] of Object.entries(s.settings)) sim.applySetting ? sim.applySetting(k, v) : (sim.settings[k] = v);
  const altFt = s.altFt || 0;
  await sim.startMode('free', {
    time: s.time || 'day',
    condition: s.condition || 'clear',
    windSpeedKts: s.windKts ?? 6,
    windDirDeg: 90,
    airborne: altFt > 0,
    aircraft: s.aircraft || 'skylark',
  });
  sim.autoPauseOnHide = false;
  const ac = sim.aircraft;
  const alt = altFt / FT;
  const look = s.look || 'level';
  const target = s.at || (s.view === 'tower' ? { x: 0, z: 0 } : mainCoast(T));
  if (altFt > 0) {
    const dive = look === 'down' ? (s.dive ?? 50) : 0;
    // Heading from the plane to the target; place the plane so that it (and
    // the chase camera behind it) looks at the target.
    const hdg = s.heading ?? 13;
    const hr = (hdg * Math.PI) / 180;
    const fwd = { x: Math.sin(hr), z: -Math.cos(hr) };
    const back =
      s.view === 'tower' ? 2500 : look === 'down' ? alt / Math.tan((dive * Math.PI) / 180) : Math.max(2500, alt * 1.6);
    const px = target.x - fwd.x * back;
    const pz = target.z - fwd.z * back;
    ac.reset({ pos: new THREE.Vector3(px, 0, pz), headingDeg: hdg, speed: s.speed ?? 70, altAGL: 1000, engineOn: true, gearDown: false });
    ac.pos.y = Math.max(alt, T.heightAt(px, pz) + 60);
    if (dive) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (-dive * Math.PI) / 180);
      ac.quat.multiply(q);
      ac.vel.set(0, 0, -1).applyQuaternion(ac.quat).multiplyScalar(s.speed ?? 70);
    }
    ac.controls.throttle = 0.7;
    sim.input.throttleTarget = 0.7;
  } else {
    // On the runway, rolling: full power, held straight.
    ac.controls.throttle = 1;
    sim.input.throttleTarget = 1;
  }
  sim.rig.setMode(s.view || 'chase');
  sim.override = { pitch: 0, roll: 0, yaw: 0 };
  /*
   * Steady flight, exactly: the aeroplane holds its attitude and its
   * velocity (the flight model is set aside until restore()). Otherwise the
   * simplified model levels a dive in a second and the whole picture swings,
   * and a picture sliding across the screen changes every pixel it passes
   * over, which is motion and not flicker. Straight and steady, all that
   * moves is the world going by at the aeroplane's speed: under a third of a
   * pixel a frame at 27,000 ft, which is what the owner was looking at.
   */
  if (s.kinematic !== false) {
    if (altFt <= 0) {
      ac.vel.set(0, 0, -1).applyQuaternion(ac.quat).multiplyScalar(s.speed ?? 5);
    }
    const own = Object.prototype.hasOwnProperty.call(ac, 'update') ? ac.update : null;
    ac.update = function steady(dt) {
      this.pos.addScaledVector(this.vel, dt);
    };
    sim._flickerRestore = () => {
      if (own) ac.update = own;
      else delete ac.update;
      sim._flickerRestore = null;
    };
  }
  if (s.lightning != null && sim.weather) sim.weather._nextLightning = s.lightning;
  // Diagnosis: try other Reduce-flashing caps (restored by runScenario).
  if (s.caps) {
    const FS = await import('../src/render/flash-safety.js');
    sim._flickerCaps = { ...FS.CAPS };
    Object.assign(FS.CAPS, s.caps);
  }
  return { target, alt };
}

/**
 * Fly `frames` frames at `fps` and measure. The scenario must already be set
 * up. Returns the numbers and, with heatmap: true, a PNG data URL.
 */
export async function measure(sim, opts = {}) {
  const THREE = await import('../src/vendor/three.module.js');
  const frames = opts.frames || 60;
  const fps = opts.fps || 30;
  const warm = opts.warm ?? 1;
  const hidden = [];
  if (opts.hide && opts.hide.length) {
    // Names, or 'js:<expression of sim giving an object or a list>' (diagnosis).
    const byName = opts.hide.filter((h) => !h.startsWith('js:'));
    sim.scene.traverse((o) => {
      if (byName.includes(o.name) && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    });
    for (const h of opts.hide.filter((x) => x.startsWith('js:'))) {
      let got = null;
      try {
        got = new Function('sim', `return (${h.slice(3)});`)(sim);
      } catch (e) {
        got = null;
      }
      for (const o of [].concat(got || [])) {
        if (o && o.visible) {
          o.visible = false;
          hidden.push(o);
        }
      }
    }
  }
  if (warm > 0) sim.step(warm);
  if (opts.lightning != null && sim.weather) sim.weather._nextLightning = opts.lightning;
  const gl = sim.renderer.getContext();
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;
  const N = W * H;
  const px = new Uint8Array(N * 4);
  const vl = new Float32Array(N);
  const vp = new Float32Array(N);
  const wcag = new Tracker(N, 0.1, true);
  const perc = new Tracker(N, 0.05, false);
  // The brightest and darkest each pixel has been: a single flash (a strike,
  // a bang) is one there-and-back, never "more than three a second", so it is
  // measured as the area it swings by WCAG's 0.10 at all.
  const lo = new Float32Array(N).fill(1);
  const hi = new Float32Array(N);
  // Things that flash on purpose, fired on cue: [{ at: s, kind: 'explosion' | 'lightning' | 'kick', dist, size, n, every, amount }].
  const events = (opts.events || []).map((e) => ({ ...e, frame: Math.round((e.at || 0) * fps), left: e.n || 1 }));
  const Ex = events.some((e) => e.kind === 'explosion') ? await import('../src/features/explosions.js') : null;
  let stepMs = 0;
  const flashLog = [];
  for (let f = 0; f < frames; f++) {
    for (const e of events) {
      if (e.left > 0 && f >= e.frame) {
        e.left--;
        e.frame = f + Math.max(1, Math.round((e.every || 0.1) * fps));
        if (e.kind === 'explosion' && Ex) {
          const cam = sim.camera;
          const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
          dir.y = 0;
          dir.normalize();
          const p = cam.position.clone().addScaledVector(dir, e.dist || 120);
          p.x += ((e.left * 37) % 30) - 15;
          Ex.explode(sim, { x: p.x, y: NaN, z: p.z }, { kind: e.type || 'bomb', size: e.size || 2 });
        } else if (e.kind === 'lightning' && sim.weather) {
          sim.weather.lightningFlash = 1;
        } else if (e.kind === 'kick' && sim.rig) {
          sim.rig.kick(e.amount || 1);
        }
      }
    }
    const t0 = performance.now();
    sim.step(1 / fps, 1 / (fps * 2));
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px.subarray(0, 4));
    stepMs += performance.now() - t0;
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let mean = 0;
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      const r = px[j];
      const g = px[j + 1];
      const b = px[j + 2];
      const l = 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
      vl[i] = l;
      vp[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      mean += l;
      if (l < lo[i]) lo[i] = l;
      if (l > hi[i]) hi[i] = l;
    }
    flashLog.push(+(mean / N).toFixed(4));
    if (f === 0) {
      wcag.first(vl);
      perc.first(vp);
    } else {
      wcag.step(vl, f, fps);
      perc.step(vp, f, fps);
    }
  }
  const secs = frames / fps;
  const aw = wcag.area(W, H);
  const ap = perc.area(W, H);
  let transSum = 0;
  let swing = 0;
  for (let i = 0; i < N; i++) {
    transSum += perc.cnt[i];
    if (hi[i] - lo[i] >= 0.1 && lo[i] < 0.8) swing++;
  }

  // The worst cell of an 8 x 6 grid (perceptual flags). Rows are bottom-up.
  const GX = 8;
  const GY = 6;
  const cells = new Uint32Array(GX * GY);
  for (let y = 0; y < H; y++) {
    const cy = Math.min(GY - 1, Math.floor(((H - 1 - y) / H) * GY));
    for (let x = 0; x < W; x++) {
      if (perc.flag[y * W + x]) cells[cy * GX + Math.min(GX - 1, Math.floor((x / W) * GX))]++;
    }
  }
  let wc = 0;
  for (let i = 1; i < cells.length; i++) if (cells[i] > cells[wc]) wc = i;
  const cw = W / GX;
  const ch = H / GY;
  const worst = {
    cell: [wc % GX, Math.floor(wc / GX)],
    box: [Math.round((wc % GX) * cw), Math.round(Math.floor(wc / GX) * ch), Math.round(cw), Math.round(ch)],
    frac: +(cells[wc] / (cw * ch)).toFixed(4),
    hits: [],
  };
  // What is under the worst cell's flickering pixels: a ray through a few.
  if (cells[wc] > 0 && opts.raycast !== false) {
    const rc = new THREE.Raycaster();
    rc.camera = sim.camera;
    const counts = new Map();
    let shots = 0;
    const x0 = worst.box[0];
    const y0 = worst.box[1];
    outer: for (let yy = y0; yy < y0 + ch; yy += 3) {
      for (let xx = x0; xx < x0 + cw; xx += 3) {
        const gy = H - 1 - Math.round(yy);
        const i = gy * W + Math.round(xx);
        if (!perc.flag[i]) continue;
        if ((xx * 7 + yy * 13) % 5) continue; // thin the sample out
        rc.setFromCamera(new THREE.Vector2((xx / W) * 2 - 1, -((yy / H) * 2 - 1)), sim.camera);
        const hits = rc.intersectObjects(sim.scene.children, true).filter((h) => h.object.visible !== false).slice(0, 4);
        const key = hits
          .map((h) => `${h.object.name || h.object.type}${h.object.material && h.object.material.transparent ? '(t)' : ''}@${h.distance.toFixed(1)}`)
          .join(' > ');
        const label = hits.map((h) => h.object.name || h.object.type).join(' > ');
        if (!counts.has(label)) counts.set(label, { n: 0, eg: key });
        counts.get(label).n++;
        if (++shots >= 12) break outer;
      }
    }
    worst.hits = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${v.n}x ${v.eg}`);
  }
  // Which of the flicker is a z-fight (opts.zfight: the number of rays).
  let zfight = null;
  if (opts.zfight) {
    zfight = attributeZfight(THREE, sim, perc.flag, W, H, opts.zfight === true ? 160 : opts.zfight);
    zfight.area = zfight.samples ? +((ap.area * zfight.zfight) / zfight.samples).toFixed(5) : 0;
  }

  let heatmap = null;
  let frame = null;
  if (opts.heatmap) {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const cx = cv.getContext('2d');
    const img = cx.createImageData(W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const o = ((H - 1 - y) * W + x) * 4;
        const base = vp[i] * 255 * 0.35;
        const rate = perc.cnt[i] / secs; // transitions a second
        if (perc.flag[i]) {
          // Flickering: red (just over) to yellow (every frame).
          const k = Math.min(1, (rate - 6) / 18);
          d[o] = 255;
          d[o + 1] = 40 + 215 * k;
          d[o + 2] = wcag.flag[i] ? 255 * (1 - k) * 0.6 : 0;
        } else if (rate > 0) {
          // Some change, not flicker: blue, brighter with more.
          const k = Math.min(1, rate / 6);
          d[o] = base * (1 - k);
          d[o + 1] = base * (1 - k) + 60 * k;
          d[o + 2] = base + (200 - base) * k;
        } else {
          d[o] = d[o + 1] = d[o + 2] = base;
        }
        d[o + 3] = 255;
      }
    }
    cx.putImageData(img, 0, 0);
    heatmap = cv.toDataURL('image/png');
    // And the last frame itself, to see what flickered.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const s = (y * W + x) * 4;
        const o = ((H - 1 - y) * W + x) * 4;
        d[o] = px[s];
        d[o + 1] = px[s + 1];
        d[o + 2] = px[s + 2];
        d[o + 3] = 255;
      }
    }
    cx.putImageData(img, 0, 0);
    frame = cv.toDataURL('image/png');
  }
  for (const o of hidden) o.visible = true;

  // The whole frame's mean luminance swinging (lightning, a flash): the
  // full-screen general flash, which per-pixel area also catches, logged so
  // a strike is visible in the numbers.
  let swings = 0;
  for (let i = 1; i < flashLog.length; i++) if (Math.abs(flashLog[i] - flashLog[i - 1]) >= 0.1) swings++;

  return {
    W,
    H,
    frames,
    fps,
    wcagArea: +aw.area.toFixed(5),
    wcagWindow: +aw.window.toFixed(4),
    percArea: +ap.area.toFixed(5),
    percWindow: +ap.window.toFixed(4),
    transPerPxSec: +(transSum / N / secs).toFixed(4),
    swingArea: +(swing / N).toFixed(4),
    worst,
    zfight,
    meanLum: { min: Math.min(...flashLog), max: Math.max(...flashLog), swings, log: opts.meanLog ? flashLog : undefined },
    stepMs: +(stepMs / frames).toFixed(2),
    heatmap,
    frame,
    state: { alt: Math.round(sim.aircraft.pos.y * FT), agl: Math.round(sim.aircraft.agl * FT), crashed: sim.aircraft.crashed, view: sim.rig.mode },
  };
}

/** Set up and measure in one go. */
export async function runScenario(sim, s, opts = {}) {
  await setupScenario(sim, s);
  try {
    return await measure(sim, { ...opts, hide: s.hide || opts.hide, lightning: s.lightningAt ?? opts.lightning, events: s.events || opts.events, meanLog: s.meanLog || opts.meanLog });
  } finally {
    sim.override = null;
    if (sim._flickerRestore) sim._flickerRestore();
    if (sim._flickerCaps) {
      const FS = await import('../src/render/flash-safety.js');
      Object.assign(FS.CAPS, sim._flickerCaps);
      sim._flickerCaps = null;
    }
  }
}
