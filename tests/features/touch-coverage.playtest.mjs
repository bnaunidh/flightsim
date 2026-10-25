/**
 * THE TOUCH SHEETS ON A PHONE AND AN IPAD — the game loaded the way a touch
 * device loads it, on three screens, with real fingers.
 *
 *   node tests/features/touch-coverage.playtest.mjs [--url=http://127.0.0.1:8931/] [--shots=dir]
 *
 * tests/features/touch-coverage.browser.js runs at whatever size the window
 * is; the game decides it is on a touch device in its constructor
 * (ui/touch.js isTouchDevice), so the real pads, the GROUND and SYSTEMS
 * sheets and the phone stylesheet are only seen on a touch load. This starts
 * headless Chrome as a phone upright (390 x 844), a phone on its side
 * (844 x 390), a small phone on its side (667 x 375) and an iPad (1024 x 768), each emulated BEFORE the page loads,
 * and on each:
 *   - the game built its own touch layer (the check does not have to);
 *   - a real finger (CDP touch events at the pad's centre) on GROUND opens
 *     the ground sheet, and on its close button closes it;
 *   - the whole browser check: the crew called from the sheet, PUSH BACK
 *     with the nose to the left, STOP THE PUSH, the parking brake, trim held,
 *     the map, and no sheet or pad on the stick, throttle, rudder, pads, dock
 *     or map at THAT screen size, every target 44 px or more.
 *
 * Needs Google Chrome (CHROME=/path/to/chrome to point elsewhere) and
 * python3. Shares the Mac's headless-Chrome slots with the other playtests.
 * Never plays a sound: Chrome runs --mute-audio.
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
  const dir = mkdtempSync(join(tmpdir(), 'ifs-touch-sheets-chrome-'));
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
  await send('Emulation.setDeviceMetricsOverride', { width: device.w, height: device.h, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
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
const START = `
  window.requestAnimationFrame = () => 0;
  sim.__realRender = sim.renderer.render.bind(sim.renderer);
  sim.renderer.render = () => {};
  sim.autoPauseOnHide = false;
  if (sim.audio && !sim.audio.started) sim._unlocking = true;
  if (typeof sim.applyDifficulty === 'function') sim.applyDifficulty('normal');
  await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
  for (let i = 0; i < 30; i++) sim.step(1 / 30);
  const EXT = await import('/src/game/extensions.js');
  const park = EXT.extDevActions().find((a) => a.ext === 'airport' && /free stand/i.test(a.label));
  if (park) { park.run(sim); for (let i = 0; i < 15; i++) sim.step(0.1); }
  const SVC = await import('/src/features/airport-services.js');
  const tc = sim.touch;
  return { touch: !!tc, isTouch: !!(sim.hud && sim.hud.wrap.classList.contains('is-touch')), crew: SVC.__airportServices.S.state,
    groundShown: !!(tc && tc.sheetPads && !tc.sheetPads.ground.hidden), sheets: tc && tc.sheets ? Object.keys(tc.sheets) : [] };
`;
const PAD_BOX = `
  const tc = sim.touch;
  const b = tc.sheetPads.ground.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height };
`;
const SHEET_STATE = `
  const tc = sim.touch;
  const s = tc.sheets.ground;
  const c = s.querySelector('.touch-sheet-close').getBoundingClientRect();
  return { open: tc.openSheet, shown: !s.hidden && s.getClientRects().length > 0, close: { x: c.left + c.width / 2, y: c.top + c.height / 2 } };
`;
const CHECK = `
  const m = await import('/tests/features/touch-coverage.browser.js');
  const got = [];
  const r = { ok: (name, pass, detail) => got.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) }) };
  try { await m.check(sim, r, () => {}); } catch (e) { got.push({ name: 'the check ran', pass: false, detail: String(e && e.message || e) }); }
  return got;
`;

/* ---- the run ---------------------------------------------------------------- */
const DEVICES = [
  { name: 'a phone upright', w: 390, h: 844 },
  { name: 'a phone on its side', w: 844, h: 390 },
  // A small phone on its side (iPhone 8 / SE): the gap beside the stick is under 300 px, and the
  // sheet used to go above the pads — 43 px off the top of the screen, close button and all.
  { name: 'a small phone on its side', w: 667, h: 375 },
  { name: 'an iPad', w: 1024, h: 768 },
];
const shots = arg('shots');
if (shots) mkdirSync(shots, { recursive: true });
const url = await serve();
for (const device of DEVICES) {
  log(`${device.name} (${device.w} x ${device.h})`);
  const page = await openDevice(url, device);
  try {
    const started = await page.eval(START, 150);
    ok(`${device.name}: the game loads as a touch device, builds its own layer with the two sheets, and parks on a stand`, started.touch && started.isTouch && started.sheets.length === 2 && started.crew === 'onStand', JSON.stringify(started));
    ok(`${device.name}: on the stand the GROUND pad is on screen`, started.groundShown, `shown ${started.groundShown}`);
    const p = await page.eval(PAD_BOX, 30);
    ok(`${device.name}: the GROUND pad is a thumb-sized target (44 px or more)`, p.w >= 44 && p.h >= 44, `${Math.round(p.w)}x${Math.round(p.h)}`);
    await page.tap(p.x, p.y);
    const s1 = await page.eval(SHEET_STATE, 30);
    ok(`${device.name}: a real finger on GROUND opens the ground sheet`, s1.open === 'ground' && s1.shown, JSON.stringify(s1));
    if (shots) {
      await page.eval(`sim.__realRender(sim.scene, sim.camera); return 1;`, 60);
      await page.snap(join(shots, `touch-sheet-${device.w}x${device.h}.png`));
    }
    await page.tap(s1.close.x, s1.close.y);
    const s2 = await page.eval(SHEET_STATE, 30);
    ok(`${device.name}: a finger on its close button closes it`, s2.open === null && !s2.shown, JSON.stringify({ open: s2.open, shown: s2.shown }));

    const got = await page.eval(CHECK, 200);
    for (const g of got) ok(`${device.name}: ${g.name}`, g.pass, g.detail);
    const errs = page.logs.filter((l) => /\[(error|exception)\]/.test(l));
    ok(`${device.name}: no errors in the console`, errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  } catch (e) {
    ok(`${device.name}: the run finished`, false, String(e && e.message || e).slice(0, 300));
  } finally {
    await page.close();
  }
}
console.log(`\n${passed}/${passed + failed} passed`);
cleanup();
process.exit(failed ? 1 : 0);
