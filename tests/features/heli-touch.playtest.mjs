/**
 * THE SKYHOOK ON A PHONE AND AN IPAD — the helicopter's HUD loaded the way
 * a touch device loads it, measured for fit.
 *
 *   node tests/features/heli-touch.playtest.mjs [--url=http://127.0.0.1:8931/] [--shots=dir] [--aircraft=vh3d]
 *
 * The in-page heli playtest (heli-playtest.browser.js) runs at whatever size
 * the window is and can only put the `is-touch` class on; the game decides it
 * is on a touch device in its constructor (ui/touch.js isTouchDevice, from
 * navigator.maxTouchPoints), so the touch layer, the lever, the touch words
 * and the phone stylesheet are only ever seen on a real touch load. This
 * starts headless Chrome with a phone (390 x 844) and an iPad (1024 x 768)
 * emulated BEFORE the page loads, starts the helicopter in Free Flight, and
 * measures, on the ground and in a hover:
 *   - the game built its touch layer, and the card and the objective talk
 *     about the lever, not Shift;
 *   - nothing on screen says "kid";
 *   - no text of the hover strip, the card or the objective runs off the
 *     screen or is cut by its own box (measured before the fix on a 390 px
 *     phone: the strip's RAD ALT and WIND were cut by the screen's edge and
 *     its drift words and POWER sat at x401-557, off the screen altogether);
 *   - the strip, the card, the objective, the map, the Races and smoke
 *     buttons, the lever, the stick, the pads and the button tray do not
 *     overlap each other (the smoke button sat on the Races button on an
 *     iPad, 2,400 px²), and all of them are inside the screen;
 *   - the engine pad under a real finger (CDP touch events at its centre):
 *     on the ground STOP stops the engine, the card says "Tap START" (not
 *     "Press I" to a phone) and START starts it; in the hover the pad is
 *     greyed out and two taps leave the engine running with a word about
 *     landing first (measured before the fix on the phone: one tap at
 *     30 ft, -18.7 m/s at the ground, "You came down far too fast").
 *
 * Needs Google Chrome (CHROME=/path/to/chrome to point elsewhere) and
 * python3. Shares the Mac's headless-Chrome slots with the other playtests.
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
  const dir = mkdtempSync(join(tmpdir(), 'ifs-heli-touch-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--mute-audio', '--enable-unsafe-swiftshader', '--window-size=1280,800',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
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
  // The device, before the game can ask what it is running on.
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
  // The real render is an instance closure in three.js: kept for the shots.
  sim.__realRender = sim.renderer.render.bind(sim.renderer);
  sim.renderer.render = () => {};
  sim.autoPauseOnHide = false;
  if (sim.audio && !sim.audio.started) sim._unlocking = true;
  if (typeof sim.applyDifficulty === 'function') sim.applyDifficulty('normal');
  if (sim.settings) sim.settings.heliAssist = true;
  if (typeof sim.switchGame === 'function') sim.switchGame('heli');
  await sim.startMode('free', { aircraft: ${JSON.stringify(String(arg('aircraft', 'harrier')))}, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 250 });
  for (let i = 0; i < 30; i++) sim.step(1 / 30);
  return { touch: !!sim.touch, isTouch: !!(sim.hud && sim.hud.wrap.classList.contains('is-touch')), rotor: !!(sim.hud && sim.hud.wrap.classList.contains('is-rotor')) };
`;
// A thumb on the lever for three seconds, then off it: the hover, with the hold lights up.
const LIFT = `
  const ts = sim.input.touch;
  const R = sim.aircraft.rotor || {};
  const hover = Number.isFinite(R.hoverPoint) ? (R.hoverPoint - 0.18) / 0.82 : 0.5;
  ts.dragging = true; ts.throttle = Math.min(1, hover + 0.25);
  for (let i = 0; i < 45; i++) sim.step(1 / 15);
  ts.dragging = false; ts.throttle = null;
  for (let i = 0; i < 90; i++) sim.step(1 / 15);
  const ac = sim.aircraft;
  return { up: +(ac.rotor && ac.rotor.heightAbove || 0).toFixed(1), vs: +ac.vs.toFixed(2), crashed: !!ac.crashed, state: sim.hud.wrap.classList.contains('is-rotorhover') };
`;
const MEASURE = `
  const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2) return null; return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const q = (s) => vis(document.querySelector(s));
  const rects = {};
  for (const [k, s] of Object.entries({ strip: '.hud-rotor', card: '.hud-heli', objective: '.hud-top', map: '.minimap', races: '.race-solobar', smoke: '.fun-chip', lever: '.touch-throttle', stick: '.touch-stick', pads: '.touch-pads', tray: '.hud-buttons', cruise: '.hud-left' })) rects[k] = q(s);
  // Text that runs off the screen or is cut by its own box.
  const past = [];
  const clipped = [];
  for (const el of document.querySelectorAll('.hud-rotor *, .hud-heli *, .hud-top *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const t = el.textContent.trim();
    if (!el.children.length && t && (r.right > innerWidth + 0.5 || r.left < -0.5)) past.push(el.className + ' "' + t.slice(0, 24) + '" ' + Math.round(r.left) + '-' + Math.round(r.right));
    if (t && cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis' && cs.whiteSpace !== 'nowrap' && el.scrollWidth > el.clientWidth + 1) clipped.push(el.className + ' "' + t.slice(0, 24) + '" ' + el.scrollWidth + '>' + el.clientWidth);
  }
  const overlap = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h ? Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) : 0;
  const pairs = [];
  const ks = Object.keys(rects).filter((k) => rects[k]);
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) { const o = overlap(rects[ks[i]], rects[ks[j]]); if (o > 4) pairs.push(ks[i] + '/' + ks[j] + ' ' + o + 'px²'); }
  const offscreen = ks.filter((k) => rects[k].x < -1 || rects[k].y < -1 || rects[k].x + rects[k].w > innerWidth + 1 || rects[k].y + rects[k].h > innerHeight + 1);
  const objective = ((document.querySelector('.hud-top') || {}).textContent || '').replace(/\\s+/g, ' ').trim();
  const card = ((sim.hud && sim.hud.heliSay && sim.hud.heliSay.textContent) || '').trim();
  return { vw: innerWidth, vh: innerHeight, rects, past, clipped, pairs, offscreen, objective, card, kid: /\\bkid\\b/i.test(document.body.innerText), shown: ks };
`;

/*
 * The engine pad, under a real finger. Measured on an earlier build on the
 * phone, in a hover at about 30 ft: one tap on the pad labelled STOP, which
 * sits beside the camera pad, was "ENGINE OFF — Press I to start the engine"
 * (no I on a phone) and -18.7 m/s at the ground, "You came down far too
 * fast". Now the pad is greyed out in the air and a tap gets a word; on the
 * ground one tap stops the engine, the card names the pad, and one tap
 * starts it again.
 */
const PAD_FIND = `
  const pad = [...document.querySelectorAll('.touch-pad')].find((b) => /^(STOP|START)$/.test(b.textContent.trim()));
  if (!pad) return null;
  const r = pad.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: pad.textContent.trim(), off: pad.classList.contains('is-off'), aria: pad.getAttribute('aria-disabled'), opacity: +parseFloat(getComputedStyle(pad).opacity).toFixed(2), engine: !!sim.aircraft.engineOn };
`;
const PAD_AFTER = `
  for (let i = 0; i < 8; i++) sim.step(1 / 15);
  const pad = [...document.querySelectorAll('.touch-pad')].find((b) => /^(STOP|START)$/.test(b.textContent.trim()));
  const ac = sim.aircraft;
  return { label: pad ? pad.textContent.trim() : null, engine: !!ac.engineOn, crashed: !!ac.crashed, up: +((ac.rotor && ac.rotor.heightAbove) || 0).toFixed(1), card: ((sim.hud && sim.hud.heliSay && sim.hud.heliSay.textContent) || '').trim(), toasts: [...document.querySelectorAll('.hud-toast')].map((t) => t.textContent.trim()) };
`;
// Two and a half seconds: an engine start takes 1.8.
const SETTLE = `
  for (let i = 0; i < 38; i++) sim.step(1 / 15);
  return { engine: !!sim.aircraft.engineOn, crashed: !!sim.aircraft.crashed };
`;
async function padChecks(page, device, when) {
  const tag = `${device.name} ${when}`;
  const p0 = await page.eval(PAD_FIND, 30);
  if (!p0) {
    ok(`${tag}: the engine pad is on the screen`, false, 'no STOP or START pad');
    return;
  }
  if (when === 'in the hover') {
    ok(`${tag}: the STOP pad is greyed out`, p0.label === 'STOP' && p0.off && p0.aria === 'true' && p0.opacity < 0.7, JSON.stringify(p0));
    await page.tap(p0.x, p0.y);
    const a1 = await page.eval(PAD_AFTER, 30);
    await page.tap(p0.x, p0.y);
    const a2 = await page.eval(PAD_AFTER, 30);
    const word = a1.toasts.find((t) => /land/i.test(t)) || '';
    ok(`${tag}: a finger on STOP, twice, leaves the engine running and says to land first`, a1.engine && a2.engine && !a2.crashed && a2.up > 3 && /land/i.test(word), `engine ${a1.engine && a2.engine ? 'on' : 'OFF'}, ${a2.up} m up, toast "${word}"${a2.crashed ? ', CRASHED' : ''}`);
    return;
  }
  ok(`${tag}: the pad reads STOP and is not greyed out`, p0.label === 'STOP' && !p0.off && p0.engine, JSON.stringify(p0));
  await page.tap(p0.x, p0.y);
  const a1 = await page.eval(PAD_AFTER, 30);
  ok(`${tag}: a finger on STOP stops the engine, the pad reads START, and the card says to tap it (no I on a phone)`, !a1.engine && a1.label === 'START' && /START/.test(a1.card) && !/\bI\b/.test(a1.card), `engine ${a1.engine ? 'STILL ON' : 'off'}, pad "${a1.label}", card "${a1.card.slice(0, 60)}"`);
  await page.tap(p0.x, p0.y);
  const a2 = await page.eval(SETTLE, 30);
  ok(`${tag}: a finger on START starts it again`, a2.engine && !a2.crashed, `engine ${a2.engine ? 'on' : 'OFF'} 2.5 s later`);
}

/* ---- the run ---------------------------------------------------------------- */
const DEVICES = [
  { name: 'a phone', w: 390, h: 844 },
  { name: 'an iPad', w: 1024, h: 768 },
];
const shots = arg('shots');
if (shots) mkdirSync(shots, { recursive: true });
const url = await serve();
for (const device of DEVICES) {
  log(`${device.name} (${device.w} x ${device.h})`);
  const page = await openDevice(url, device);
  try {
    const started = await page.eval(START, 120);
    ok(`${device.name}: the game loads as a touch device and starts the helicopter`, started.touch && started.isTouch && started.rotor, JSON.stringify(started));
    for (const [when, before] of [['on the ground', null], ['in the hover', LIFT]]) {
      if (before) {
        const lift = await page.eval(before, 60);
        ok(`${device.name}: a thumb on the lever lifts her, and off it she hovers with the strip up`, lift.up > 3 && Math.abs(lift.vs) < 0.5 && !lift.crashed && lift.state, JSON.stringify(lift));
      }
      const m = await page.eval(MEASURE, 60);
      const tag = `${device.name} ${when}`;
      // On the ground both tell a thumb about the lever; in the hover the card
      // says what the assist is doing ("Holding this height..."), and neither
      // may ever name a key a tablet has not got.
      const wantLever = !before;
      ok(`${tag}: the card and the objective talk about the lever, never about Shift or Ctrl`, (!wantLever || (/lever/i.test(m.card) && /lever/i.test(m.objective))) && !/\b(Shift|Ctrl)\b/.test(m.card + ' ' + m.objective), `card "${m.card.slice(0, 60)}", objective "${m.objective.slice(0, 80)}"`);
      ok(`${tag}: nothing on screen says "kid"`, !m.kid, m.kid ? 'the word is on the page' : 'clean');
      ok(`${tag}: no text of the strip, the card or the objective runs off the screen or is cut by its box`, m.past.length === 0 && m.clipped.length === 0, [...m.past.map((s) => `off: ${s}`), ...m.clipped.map((s) => `cut: ${s}`)].join('; ') || `clean (strip ${JSON.stringify(m.rects.strip)})`);
      ok(`${tag}: the strip, the card, the objective, the map, the buttons and the touch controls do not overlap, and all are on the screen`, m.pairs.length === 0 && m.offscreen.length === 0, [...m.pairs.map((s) => `overlap ${s}`), ...m.offscreen.map((k) => `${k} off the screen`)].join('; ') || `clear: ${m.shown.join(', ')}`);
      if (shots) {
        await page.eval(`sim.__realRender(sim.scene, sim.camera); return 1;`, 60);
        await page.snap(join(shots, `heli-${device.w}x${device.h}-${when.replace(/\s+/g, '-')}.png`));
      }
      // The engine pad under a real finger: on the ground it works, in the
      // air it is greyed out and says so. (On the ground this leaves the
      // engine running again, so the lift that follows is a normal one.)
      await padChecks(page, device, when);
    }
    const errs = page.logs.filter((l) => /\[(error|exception)\]/.test(l));
    ok(`${device.name}: no errors in the console`, errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  } catch (e) {
    ok(`${device.name}: the run finished`, false, String(e && e.message || e).slice(0, 300));
  } finally {
    await page.close();
  }
}
console.log(`\nheli-touch: ${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
