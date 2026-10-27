/**
 * TOUCH FLYING ON A PHONE (wave 18, owner: "on mobile maybe u can control
 * plane with ur fingers") — the game loaded the way a phone loads it (touch
 * emulated before the page loads, an Android Chrome user agent), on its side
 * (812 x 375) and upright (375 x 812), with real fingers (CDP touch events):
 *
 *   node tests/features/touch-modes.playtest.mjs [--url=http://127.0.0.1:8924/]
 *
 *   - a phone starts in Drag anywhere: no fixed stick, and a finger anywhere
 *     on the left of the picture puts a floating stick under it;
 *   - dragging down pulls back (the aeroplane's pitch output goes up), right
 *     rolls right, lifting the finger centres it and the ring goes;
 *   - two fingers at once: steering on the left while the throttle slider
 *     moves under the other;
 *   - a finger on a pad (GEAR), the dock, or the minimap is NOT a stick: the
 *     pad still works and nothing is steered;
 *   - the helicopter flies by it; the boat gets roll only;
 *   - Stick mode puts the fixed stick back and Drag no longer claims fingers;
 *   - Tilt: the phone's tilt (deviceorientation) rolls and pitches it, the
 *     first reading is level, LEVEL re-levels; with no sensor readings it falls
 *     back to Drag anywhere and says so.
 * The axis maths is tests/features/touch-modes.mjs.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d = null) => {
  const a = process.argv.find((x) => x === `--${k}` || x.startsWith(`--${k}=`));
  if (!a) return d;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (s) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
  return !!pass;
};

/* ---- one headless Chrome, in one of the Mac's shared slots ---------------- */
const SLOT_DIR = '/tmp/ifs-chrome-slots';
function slotCount() {
  try {
    const b = JSON.parse(readFileSync(join(ROOT, '.claude', 'devtools', 'chrome-boost.json'), 'utf8'));
    if (Date.now() < b.until) return Number(b.slots) || 2;
  } catch (e) { /* no boost */ }
  return Number(process.env.IFS_CHROME_SLOTS || 2);
}
let slot = null;
async function acquireSlot() {
  mkdirSync(SLOT_DIR, { recursive: true });
  let said = false;
  for (;;) {
    for (let i = 0; i < slotCount(); i++) {
      const d = `${SLOT_DIR}/slot${i}`;
      try { mkdirSync(d); writeFileSync(`${d}/pid`, String(process.pid)); return d; } catch (e) { /* held */ }
      try {
        process.kill(Number(readFileSync(`${d}/pid`, 'utf8')), 0);
      } catch (e) {
        try { if (Date.now() - statSync(d).mtimeMs > 5000) rmSync(d, { recursive: true, force: true }); } catch (e2) { /* raced */ }
      }
    }
    if (!said) { log('all browser slots busy; waiting'); said = true; }
    await sleep(1500);
  }
}
const children = [];
const cleanup = () => {
  for (const c of children) { try { c.kill(); } catch (e) { /* gone */ } }
  if (slot) { try { rmSync(slot, { recursive: true, force: true }); } catch (e) { /* gone */ } slot = null; }
};
process.on('exit', cleanup);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { cleanup(); process.exit(1); });

async function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    s.on('error', rej);
  });
}
async function serve() {
  if (arg('url')) return arg('url');
  const port = await freePort();
  const child = spawn('python3', [join(ROOT, 'tools', 'lan-server.py'), String(port), '--local'], { stdio: 'ignore' });
  children.push(child);
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return url; } catch (e) { /* not yet */ }
    await sleep(100);
  }
  throw new Error(`could not serve the game on ${url}`);
}

let chrome = null;
async function launch() {
  if (chrome) return chrome;
  const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  slot = await acquireSlot();
  const dir = mkdtempSync(join(tmpdir(), 'ifs-touch-modes-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--mute-audio', '--enable-unsafe-swiftshader', '--window-size=1280,800',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ], { stdio: 'ignore' });
  children.push(proc);
  process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* busy */ } });
  const portFile = join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error('Chrome did not start');
  chrome = { proc, dir, port: readFileSync(portFile, 'utf8').split('\n')[0].trim() };
  return chrome;
}

/** A tab that is a `device` (width, height, touch) from before the page loads. */
async function openDevice(url, device, timeoutS = 240) {
  const c = await launch();
  const target = await (await fetch(`http://127.0.0.1:${c.port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map();
  const logs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      const { res, rej } = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error) rej(new Error(m.error.message)); else res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`.slice(0, 500));
    else if (m.method === 'Runtime.consoleAPICalled' && /error/.test(m.params.type)) logs.push(`[${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 400));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    waiting.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const raw = async (expression, ms = timeoutS * 1000) => {
    const r = await Promise.race([
      send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      sleep(ms).then(() => { throw new Error(`${device.name}: timed out after ${ms / 1000} s`); }),
    ]);
    if (r.exceptionDetails) throw new Error(`${device.name}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: device.w, height: device.h, deviceScaleFactor: 2, mobile: true,
    // On its side the screen is turned too (screen.orientation.angle 90), so the tilt is read in the turned screen's axes.
    screenOrientation: device.w > device.h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // A phone's browser: an Android Chrome user agent, as the owner's class will have.
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
  // ?dev=1: no service worker, so the page does not reload itself under the test.
  await send('Page.navigate', { url: `${url.replace(/\/?$/, '/')}index.html?dev=1` });
  let origin = null;
  let since = 0;
  for (const tEnd = Date.now() + timeoutS * 1000; ;) {
    const st = await raw(`JSON.stringify([!!window.__sim, performance.timeOrigin, document.readyState])`, 5000).catch(() => null);
    const [has, o, rs] = st ? JSON.parse(st) : [false, null, ''];
    if (has && rs === 'complete' && o === origin) {
      if (Date.now() - since > 2000) break;
    } else { origin = has ? o : null; since = Date.now(); }
    if (Date.now() > tEnd) throw new Error(`${device.name}: the game never settled\n${logs.join('\n')}`);
    await sleep(300);
  }
  return {
    logs,
    send,
    eval: (body, secs = timeoutS) => raw(`(async () => { const sim = window.__sim; ${body}\n})()`, secs * 1000),
    /** A real finger: touchStart and touchEnd at CSS pixel (x, y), which Chrome turns into the pad's click. */
    async tap(x, y) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1 }] });
      await sleep(40);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(40);
    },
    /** Fingers down / moved / up: `points` [{ x, y, id }] (CSS px), Chrome turns them into pointer events. */
    async touch(type, points) {
      await send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id ?? 0, radiusX: 8, radiusY: 8, force: 1 })) });
      await sleep(30);
    },
    async snap(file) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    },
    async close() {
      await fetch(`http://127.0.0.1:${c.port}/json/close/${target.id}`).catch(() => {});
      try { ws.close(); } catch (e) { /* closed */ }
    },
  };
}


/* ---- inside the page ------------------------------------------------------ */
const START = (aircraft) => `
  window.requestAnimationFrame = () => 0;
  sim.renderer.render = () => {};
  sim.autoPauseOnHide = false;
  if (sim.audio && !sim.audio.started) sim._unlocking = true;
  // Each screen starts from the default (the last one's choice is in the shared save).
  sim.settings.touchFlying = 'auto';
  sim.applyTouchFlying();
  await sim.startMode('free', { aircraft: '${aircraft}', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
  for (let i = 0; i < 20; i++) sim.step(1 / 30);
  const tc = sim.touch;
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
  return { touch: !!tc, mode: tc && tc.flyMode, stick: vis(tc && tc.stick), id: sim.aircraftType.id, ctx: sim.input.context };
`;
const READ = `
  for (let i = 0; i < 6; i++) sim.step(1 / 30);
  const t = sim.input.touch;
  const f = sim.touch.floatEl;
  const fb = f.getBoundingClientRect();
  return { held: t.stickHeld, roll: +t.roll.toFixed(3), pitch: +t.pitch.toFixed(3), outPitch: +sim.input.out.pitch.toFixed(3), outRoll: +sim.input.out.roll.toFixed(3),
    float: !f.hidden, fx: Math.round(fb.left + fb.width / 2), fy: Math.round(fb.top + fb.height / 2), thr: t.throttle, mode: sim.touch.flyMode };
`;
/** A spot on the left of the picture with nothing pressable over it (the canvas itself under the finger). */
const SPOT = `
  const cv = sim.renderer.domElement;
  const keep = [...document.querySelectorAll('.minimap, .hud-buttons')].filter((n) => n.getClientRects().length).map((n) => n.getBoundingClientRect());
  for (let fy = 0.8; fy >= 0.3; fy -= 0.05) for (let fx = 0.12; fx <= 0.45; fx += 0.04) {
    const x = Math.round(innerWidth * fx), y = Math.round(innerHeight * fy);
    if (keep.some((b) => x >= b.left - 70 && x <= b.right + 70 && y >= b.top - 70 && y <= b.bottom + 70)) continue;
    let clear = true;
    for (const [dx, dy] of [[0, 0], [62, 0], [0, 62], [45, -45], [62, 10]]) if (document.elementFromPoint(x + dx > innerWidth * 0.55 ? x : x, y) !== cv) clear = false;
    if (document.elementFromPoint(x, y) === cv && clear) return { x, y };
  }
  return null;
`;
const BOX = (sel) => `
  const n = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none' && !e.hidden);
  if (!n) return null;
  const b = n.getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) };
`;

const DEVICES = [
  { name: 'a phone on its side', w: 812, h: 375 },
  { name: 'a phone upright', w: 375, h: 812 },
];
const url = await serve();
for (const device of DEVICES) {
  log(`${device.name} (${device.w} x ${device.h})`);
  const page = await openDevice(url, device);
  const N = device.name;
  try {
    const st = await page.eval(START('skylark'), 150);
    ok(`${N}: a phone starts in Drag anywhere, with the fixed stick put away`, st.touch && st.mode === 'drag' && !st.stick, JSON.stringify(st));
    let spot = await page.eval(SPOT, 20);
    ok(`${N}: there is open picture on the left to put a finger on`, !!spot, JSON.stringify(spot));
    if (!spot) spot = { x: Math.round(device.w * 0.25), y: Math.round(device.h * 0.72) };
    let x0 = spot.x;
    let y0 = spot.y;
    const R = 62;
    const under = await page.eval(`const n = document.elementFromPoint(${x0}, ${y0}); return n ? (n.id || n.className || n.tagName) : 'none';`, 10);
    await page.touch('touchStart', [{ x: x0, y: y0 }]);
    let r = await page.eval(READ, 30);
    r.under = String(under).slice(0, 60);
    ok(`${N}: a finger on the picture, left side, puts a floating stick under it`, r.held && r.float && Math.abs(r.fx - x0) <= 2 && Math.abs(r.fy - y0) <= 2, JSON.stringify(r));
    await page.touch('touchMove', [{ x: x0, y: y0 + R }]);
    r = await page.eval(READ, 30);
    ok(`${N}: dragging down pulls back — the aeroplane's pitch goes up`, r.pitch > 0.95 && r.outPitch > 0.3 && Math.abs(r.roll) < 0.05, JSON.stringify(r));
    await page.touch('touchMove', [{ x: x0 + R, y: y0 }]);
    r = await page.eval(READ, 30);
    ok(`${N}: dragging right rolls right`, r.roll > 0.95 && r.outRoll > 0.3 && Math.abs(r.pitch) < 0.05, JSON.stringify(r));
    // A second finger on the throttle while the first steers.
    const thr = await page.eval(BOX('.touch-throttle'), 20);
    if (thr) {
      await page.touch('touchMove', [{ x: x0 + R, y: y0, id: 0 }, { x: thr.x, y: thr.y - Math.round(thr.h * 0.3), id: 1 }]);
      await page.touch('touchMove', [{ x: x0 + R, y: y0 + 10, id: 0 }, { x: thr.x, y: thr.y - Math.round(thr.h * 0.35), id: 1 }]);
      r = await page.eval(READ, 30);
      ok(`${N}: two fingers at once — steering on the left, the throttle under the other`, r.held && r.roll > 0.9 && r.thr != null && r.thr > 0.6, JSON.stringify(r));
    } else ok(`${N}: the throttle slider is on screen`, false, 'not found');
    await page.touch('touchEnd', []);
    r = await page.eval(READ, 30);
    ok(`${N}: lifting the finger centres it and the ring goes`, !r.held && r.roll === 0 && r.pitch === 0 && !r.float, JSON.stringify(r));

    // Taps that are not a stick.
    for (const [what, sel] of [['a pad', '.touch-pads button:not([hidden])'], ['the minimap', '#ui > .minimap'], ['the dock', '.hud-buttons button']]) {
      const b = what === 'a pad'
        ? await page.eval(`const n = sim.touch.flapPad || sim.touch.gearPad; const q = n.getBoundingClientRect(); return { x: Math.round(q.left + q.width / 2), y: Math.round(q.top + q.height / 2), w: Math.round(q.width), h: Math.round(q.height) };`, 10)
        : await page.eval(BOX(sel), 20);
      if (!b) { ok(`${N}: ${what} is on screen`, false, 'not found'); continue; }
      await page.eval(`window.__acts = []; const o = sim.touch.onAction; sim.touch.__o = o; sim.touch.onAction = (a) => { window.__acts.push(a); o(a); }; return 1;`, 10);
      await page.touch('touchStart', [{ x: b.x, y: b.y }]);
      r = await page.eval(READ, 30);
      await page.touch('touchEnd', []);
      const acts = await page.eval(`for (let i = 0; i < 3; i++) sim.step(1 / 30); sim.touch.onAction = sim.touch.__o; return window.__acts;`, 10);
      ok(`${N}: a finger on ${what} is not a stick`, !r.held && !r.float, JSON.stringify({ at: b, held: r.held, float: r.float }));
      if (what === 'a pad') ok(`${N}: …and the pad still does its job`, acts.length >= 1, JSON.stringify(acts));
      // Leave the game as it was (a sheet, the map, a pause opened by a tap).
      await page.eval(`sim.touch.closeSheets && sim.touch.closeSheets(); if (sim.state === 'paused' && sim.resume) sim.resume(); return 1;`, 10);
    }

    // The boat: roll only.
    await page.eval(`sim.touch.setBoatMode(true); return 1;`, 10);
    await page.touch('touchStart', [{ x: x0, y: y0 }]);
    await page.touch('touchMove', [{ x: x0 + 40, y: y0 + 50 }]);
    r = await page.eval(`const t = sim.input.touch; return { roll: t.roll, pitch: t.pitch };`, 10);
    await page.touch('touchEnd', []);
    await page.eval(`sim.touch.setBoatMode(false); return 1;`, 10);
    ok(`${N}: in the boat the floating stick is a wheel (roll, no pitch)`, r.roll > 0.4 && r.pitch === 0, JSON.stringify(r));

    // The helicopter.
    await page.eval(`sim.quitToMenu && sim.quitToMenu(); return 1;`, 20);
    const h = await page.eval(START('h145'), 150);
    spot = (await page.eval(SPOT, 20)) || spot;
    x0 = spot.x;
    y0 = spot.y;
    await page.touch('touchStart', [{ x: x0, y: y0 }]);
    await page.touch('touchMove', [{ x: x0 + 45, y: y0 - 45 }]);
    r = await page.eval(READ, 30);
    await page.touch('touchEnd', []);
    ok(`${N}: the helicopter flies by it too`, h.ctx === 'heli' && r.held && r.roll > 0.5 && r.pitch < -0.5, JSON.stringify({ ctx: h.ctx, ...r }));

    // Stick mode.
    let m = await page.eval(`sim.applySetting('touchFlying', 'stick'); const tc = sim.touch; return { mode: tc.flyMode, stick: tc.stick.getClientRects().length > 0 && getComputedStyle(tc.stick).display !== 'none' };`, 10);
    await page.touch('touchStart', [{ x: Math.round(device.w * 0.45), y: Math.round(device.h * 0.3) }]);
    r = await page.eval(READ, 30);
    await page.touch('touchEnd', []);
    ok(`${N}: Stick puts the fixed stick back, and a finger on the picture no longer steers`, m.mode === 'stick' && m.stick && !r.float && !r.held, JSON.stringify({ ...m, held: r.held }));

    // Tilt.
    // Where the browser wants a tap for the motion sensor (iOS, and Chrome's phone emulation), LEVEL asks for it.
    const ask = await page.eval(`sim.applySetting('touchFlying', 'tilt'); const b = sim.touch.levelBtn; const q = b.getBoundingClientRect();
      return { ask: !!sim.touch._tiltNeedsAsk, text: b.textContent, x: Math.round(q.left + q.width / 2), y: Math.round(q.top + q.height / 2), w: Math.round(q.width), h: Math.round(q.height) };`, 10);
    if (ask.ask) {
      ok(`${N}: Tilt: the motion permission is asked from a tap (TAP TO TILT), a 44 px target`, /TAP TO TILT/.test(ask.text) && ask.w >= 44 && ask.h >= 44, JSON.stringify(ask));
      await page.tap(ask.x, ask.y);
      await page.eval(`await new Promise((r) => setTimeout(r, 300)); return 1;`, 10);
    }
    m = await page.eval(`sim.settings.tiltLevel = null; sim.touch.flyOpts.level = null;
      const fire = (b, g) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: b, gamma: g }));
      const lv = () => { const t = sim.input.touch; return { roll: +t.roll.toFixed(2), pitch: +t.pitch.toFixed(2), held: t.stickHeld }; };
      const angle = (screen.orientation && screen.orientation.angle) || 0;
      const dbg = { mode0: sim.touch.flyMode, on: !!sim.touch._tiltOn, ask: !!sim.touch._tiltNeedsAsk, DOE: typeof DeviceOrientationEvent };
      fire(40, 0); const a = lv(); dbg.level = sim.touch.flyOpts.level; dbg.seen = sim.touch._tiltSeen;
      if (!sim.touch.flyOpts.level) return { dbg };
      // Right side of the screen down: in portrait the phone's right; on its side, by its own axes.
      const M = await import('/src/ui/touch-modes.js');
      let best = null;
      for (let b = -90; b <= 120; b += 1) for (let g = -90; g <= 90; g += 1) {
        const hh = M.holdAngles(b, g, angle); const lvl = sim.touch.flyOpts.level;
        const e = Math.abs(hh.roll - (lvl.roll + 18)) + Math.abs(hh.pitch - lvl.pitch);
        if (!best || e < best.e) best = { b, g, e };
      }
      fire(best.b, best.g); const right = lv();
      const btn = sim.touch.levelBtn; const shown = btn.getClientRects().length > 0 && !btn.hidden;
      btn.click(); const lv2 = sim.touch.flyOpts.level; fire(best.b, best.g); const after = lv();
      return { dbg, mode: sim.touch.flyMode, a, right, shown, saved: sim.settings.tiltLevel, after, angle, stick: sim.touch.stick.getClientRects().length > 0 && getComputedStyle(sim.touch.stick).display !== 'none' };`, 20);
    if (!m.a) { ok(`${N}: Tilt reads the sensor`, false, JSON.stringify(m)); throw new Error('no tilt'); }
    ok(`${N}: Tilt: the first reading is level (nothing steered), the fixed stick is away, LEVEL is on screen`, m.mode === 'tilt' && !m.a.held && m.shown && !m.stick, JSON.stringify(m));
    ok(`${N}: Tilt: the right side of the screen down rolls right (screen turned ${m.angle}°)`, m.right.roll > 0.4 && Math.abs(m.right.pitch) < 0.25, JSON.stringify(m.right));
    ok(`${N}: Tilt: LEVEL takes the way it is held now as level, and saves it`, Math.abs(m.after.roll) < 0.05 && !!m.saved, JSON.stringify({ after: m.after, saved: m.saved }));
    m = await page.eval(`sim.applySetting('touchFlying', 'stick'); sim.applySetting('touchFlying', 'tilt'); sim.touch._tiltSeen = false;
      const said = []; const n0 = sim.touch.onNotice; sim.touch.onNotice = (t) => { said.push(t); n0(t); };
      await new Promise((r) => setTimeout(r, 2400)); sim.touch.onNotice = n0;
      return { mode: sim.touch.flyMode, said };`, 20);
    ok(`${N}: Tilt with no sensor readings falls back to Drag anywhere, and says so`, m.mode === 'drag' && m.said.some((t) => /Drag anywhere/.test(t)), JSON.stringify(m));
    await page.eval(`sim.applySetting('touchFlying', 'auto'); return 1;`, 10);
    const errs = page.logs.filter((l) => /\[(error|exception)\]/.test(l));
    ok(`${N}: no errors in the console`, errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  } catch (e) {
    ok(`${N}: the run finished`, false, String(e && e.message || e).slice(0, 300));
  } finally {
    await page.close();
  }
}
console.log(`\n${passed}/${passed + failed} passed`);
cleanup();
process.exit(failed ? 1 : 0);
