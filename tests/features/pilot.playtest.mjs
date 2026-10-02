/**
 * The walking pilot in multiplayer, played for real: TWO players in two tabs
 * of ONE headless Chrome, over tools/lan-server.py --local, through the real
 * lobby screen, the real WebRTC stack and the real signaling server.
 *
 *   node tests/features/pilot.playtest.mjs
 *     --url=http://127.0.0.1:9111/   a LAN server already serving the game (else one is started on a free port)
 *     --shots=<dir>                  save the screenshots there
 *     --json=<file>                  write the numbers there too
 *
 * The owner: "people on other computers should see you, the human" and "if
 * someone hits you with anything, a plane etc, you get pushed to the ground,
 * WASTED showing on your screen (ragdoll physics)". Proved:
 *
 *   1 A gets out and walks — B sees A's pilot walking (in A's uniform, legs
 *     going), where A really is, with A's name tag over the pilot (and the
 *     crown: A hosts) rather than over A's parked aeroplane;
 *   2 B rolls their aeroplane into A — A's own game sees B's plane reach A's
 *     pilot: A goes down as a ragdoll and WASTED is on A's screen ("Hit by
 *     <B>'s plane."), not on B's;
 *   3 B sees A fall: the same ragdoll, started by A's 'pilot:down', lying on
 *     the ground where A's game has A lying;
 *   4 A gets up — on both screens.
 *
 * Every tab runs the game in real time (main.js's own update, thirty times a
 * second, as the other playtests do). Holds one of the shared headless-Chrome
 * slots (the same lock as .claude/devtools/cdp.mjs).
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
const R = [];
const M = { shots: [] };
const ok = (name, pass, detail = '') => {
  R.push({ name, pass: !!pass, detail });
  log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return pass;
};

/* ---- the shared browser slot (as cdp.mjs) ---------------------------- */
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

/* ---- one Chrome, two tabs ------------------------------------------------ */
let chrome = null;
async function launch() {
  if (chrome) return chrome;
  const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  slot = await acquireSlot();
  const dir = mkdtempSync(join(tmpdir(), 'ifs-pilot-chrome-'));
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

async function openPage(url, name, timeoutS = 300) {
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
      sleep(ms).then(() => { throw new Error(`${name}: timed out after ${ms / 1000} s`); }),
    ]);
    if (r.exceptionDetails) throw new Error(`${name}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  let origin = null;
  let since = 0;
  for (const tEnd = Date.now() + timeoutS * 1000; ;) {
    const st = await raw(`JSON.stringify([!!window.__sim, performance.timeOrigin, document.readyState])`, 5000).catch(() => null);
    const [has, o, rs] = st ? JSON.parse(st) : [false, null, ''];
    if (has && rs === 'complete' && o === origin) {
      if (Date.now() - since > 2000) break;
    } else { origin = has ? o : null; since = Date.now(); }
    if (Date.now() > tEnd) throw new Error(`${name}: the game never settled\n${logs.join('\n')}`);
    await sleep(300);
  }
  return {
    name,
    logs,
    eval: (body, secs = timeoutS) => raw(`(async () => { const sim = window.__sim; const pt = window.__pt; const mp = pt && pt.mp; ${body}\n})()`, secs * 1000),
    /** A frame drawn and the screen saved, at 0.5 of the pixels (software WebGL is slow; the 3D is a little soft, the interface is not). */
    async snap(file) {
      await raw(`(() => { const s = window.__sim; const pt = window.__pt; pt.hold = true; if (pt.prWas == null) pt.prWas = s.renderer.getPixelRatio(); s.renderer.setPixelRatio(0.5); s.onResize(); if (pt.cam) pt.cam(); pt.realRender(s.scene, s.camera); return true; })()`, 60000);
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(data, 'base64'));
      await raw(`(() => { const s = window.__sim; const pt = window.__pt; s.renderer.setPixelRatio(pt.prWas); pt.prWas = null; s.onResize(); pt.hold = false; return true; })()`, 60000);
      return file;
    },
    async close() {
      await fetch(`http://127.0.0.1:${c.port}/json/close/${target.id}`).catch(() => {});
      try { ws.close(); } catch (e) { /* closed */ }
    },
  };
}

/* ---- inside each tab ---------------------------------------------------- */
const PAGE = (name, colour) => `
if (!window.__pt) {
  window.requestAnimationFrame = () => 0;
  const s = sim;
  const THREE = await import('/src/vendor/three.module.js');
  const mpMod = await import('/src/features/multiplayer.js');
  const KD = await import('/src/features/knockdown.js');
  const WS = await import('/src/features/wasted.js');
  const OF = await import('/src/features/onfoot.js');
  const PM = await import('/src/features/pilot-mp.js');
  const pt = (window.__pt = { THREE, mpMod, mp: mpMod.multiplayer, KD: KD.knockdown, WS: WS.wasted, OF: OF.onFoot, PM, realRender: s.renderer.render.bind(s.renderer), ticks: 0, hold: false, cam: null });
  s.renderer.render = () => {};
  s.autoPauseOnHide = false;
  let last = performance.now();
  pt.timer = setInterval(() => {
    const t = performance.now();
    const dt = Math.min(0.25, (t - last) / 1000);
    last = t;
    if (pt.hold) return;
    try { if (pt.before) pt.before(dt); } catch (err) { pt.err = 'before: ' + String(err && err.stack || err).slice(0, 300); }
    try { s.update(dt); } catch (err) { pt.err = String(err && err.stack || err).slice(0, 400); }
    try { if (pt.after) pt.after(dt); } catch (err) { pt.err = 'after: ' + String(err && err.stack || err).slice(0, 300); }
    pt.ticks++;
  }, 33);
  pt.mp.install(s);
  pt.until = async (fn, ms = 20000, step = 50) => {
    const t0 = performance.now();
    for (;;) {
      let v = null;
      try { v = fn(); } catch (err) { v = null; }
      if (v) return { v, ms: Math.round(performance.now() - t0) };
      if (performance.now() - t0 > ms) return { v: null, ms: Math.round(performance.now() - t0) };
      await new Promise((r) => setTimeout(r, step));
    }
  };
  pt.click = (sel) => { const el = document.querySelector(sel); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; };
  pt.text = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null; };
  pt.remote = (n) => [...pt.mp.remotes.players.values()].find((p) => p.name === n) || null;
  /** Parked on the ground at (x, z), engine off. */
  pt.park = (x, z, heading) => {
    const ac = s.aircraft;
    ac.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: heading, speed: 0, altAGL: null, engineOn: false });
    if (s.input) s.input.throttleTarget = 0;
  };
  /** Rolled along the ground from (x, z) at a heading and speed, on the clock: a plane taxiing fast at somebody. */
  pt.roll = (x, z, heading, speed, secs = 12) => {
    const t0 = performance.now();
    const hr = heading * Math.PI / 180;
    pt.before = () => {
      const t = (performance.now() - t0) / 1000;
      if (t > secs) { pt.before = null; return; }
      const ac = s.aircraft;
      ac.reset({ pos: new THREE.Vector3(x + Math.sin(hr) * speed * t, 0, z - Math.cos(hr) * speed * t), headingDeg: heading, speed, altAGL: null, engineOn: true });
      ac.controls.throttle = 0.6;
      if (s.input) s.input.throttleTarget = 0.6;
    };
  };
  /** A camera somewhere else, for a picture of somebody else. */
  pt.lookAt = (from, at) => {
    pt.cam = () => { s.camera.position.set(from.x, from.y, from.z); s.camera.lookAt(at.x, at.y, at.z); s.camera.updateMatrixWorld(); };
  };
}
window.__pt.mp.setProfile({ name: ${JSON.stringify(name)}, colour: ${JSON.stringify(colour)}, chosen: true });
window.__pt.mp.setPvp(false);
return { state: sim.state, name: window.__pt.mp.profile.name };`;

const NAMES = ['Swift Falcon', 'Brave Otter'];
const COLOURS = ['#ff5a4f', '#58c6ff'];
const SHOTS = arg('shots') || null;
const snap = async (p, name) => {
  if (!SHOTS) return null;
  mkdirSync(SHOTS, { recursive: true });
  try {
    const f = await p.snap(join(SHOTS, name));
    log(`screenshot ${f}`);
    M.shots.push(name);
    return f;
  } catch (err) {
    log(`screenshot ${name} failed: ${err.message}`);
    return null;
  }
};

/* ---- the run --------------------------------------------------------------- */
const url = await serve();
log(`serving ${url}`);
let exitCode = 1;
try {
  const A = await openPage(`${url}?dev=1`, 'A');
  log(`A up: ${JSON.stringify(await A.eval(PAGE(NAMES[0], COLOURS[0]), 120))}`);
  const B = await openPage(`${url}?dev=1`, 'B');
  log(`B up: ${JSON.stringify(await B.eval(PAGE(NAMES[1], COLOURS[1]), 120))}`);
  const both = (fn) => Promise.all([A, B].map(fn));
  await both((p) => p.eval(`
    pt.mpMod.openMultiplayer(sim);
    await pt.until(() => document.querySelectorAll('[data-mp-lobby].is-empty, [data-mp-lobby].is-open, [data-mp-lobby].is-full').length === 5, 30000);
    const b = [...document.querySelectorAll('[data-mp-ride]')].find((x) => x.dataset.mpRide.startsWith('flight:skylark'));
    if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;`, 90));
  const join = (p) => p.eval(`
    pt.click('[data-mp-lobby-join="1"]');
    await pt.until(() => (mp.ready && mp.lobby && sim.state === 'flying') || (!mp.busy && !mp.lobby && document.querySelector('[data-mp-status]').textContent), 60000);
    return { role: mp.role, id: mp.meId, map: sim.settings.map, type: sim.aircraftType && sim.aircraftType.id };`, 90);
  const ja = await join(A);
  await sleep(1000);
  const jb = await join(B);
  ok('two players in Lobby 1 (Kestrel): A hosts, B joins', ja.role === 'host' && jb.role === 'client' && ja.map === 'kestrel' && jb.map === 'kestrel', `${JSON.stringify(ja)} ${JSON.stringify(jb)}`);
  const seen = await both((p, i) => p.eval(`const r = await pt.until(() => mp.remotes.players.size === 1 && [...mp.remotes.players.values()][0].visible, 30000); return !!r.v;`, 60));
  ok('each draws the other', seen.every(Boolean));

  /* 1. A gets out and walks; B sees A walking. */
  await A.eval(`pt.park(-300, 0, 90); await new Promise((r) => setTimeout(r, 1500)); sim.tap('KeyO'); await pt.until(() => pt.OF.active, 5000);
    pt.OF.place(-300, -32, 0); pt.OF.setCamera(180, -10); return pt.OF.active;`, 30);
  await B.eval(`pt.park(-420, 60, 90); return true;`);
  // A walks: W held for three seconds (the camera behind: north).
  await A.eval(`sim.key('KeyW', true); await new Promise((r) => setTimeout(r, 3000)); return true;`, 30);
  const walk = await B.eval(`
    const r = pt.remote(${JSON.stringify(NAMES[0])});
    const w = r && r.walker;
    return w ? { on: w.on, x: w.x, z: w.z, speed: w.speed, legs: w.model && w.model.userData.anim ? w.model.userData.anim.walk : 0, outfit: w.model && w.model.userData.outfit,
      visible: !!(w.model && w.model.visible), tag: r.tag ? { x: r.tag.sprite.position.x, y: r.tag.sprite.position.y, z: r.tag.sprite.position.z } : null, host: r.host,
      plane: r.drawn ? { x: r.drawn.x, z: r.drawn.z } : null } : null;`, 20);
  const aw = await A.eval(`const w = pt.OF.walker; return { x: w.x, y: w.y, z: w.z, speed: w.speed, outfit: pt.OF.model.userData.outfit };`, 20);
  await A.eval(`sim.key('KeyW', false); return true;`, 10);
  M.walk = { b: walk, a: aw };
  const gap = walk ? Math.hypot(walk.x - aw.x, walk.z - aw.z) : Infinity;
  ok('1: A walks — B sees A’s pilot walking (legs going), where A is', !!walk && walk.on && walk.visible && walk.legs > 0.4 && gap < 1.5, `${gap.toFixed(2)} m from where A’s game has A, legs ${walk && walk.legs.toFixed(2)}, ${aw.speed.toFixed(1)} m/s`);
  ok('1: ...in the uniform A’s aeroplane gives A', !!walk && walk.outfit === aw.outfit, `${walk && walk.outfit} / ${aw.outfit}`);
  ok('1: ...with A’s name tag (and crown: A hosts) over the pilot, not over A’s parked plane', !!walk && walk.host && walk.tag && Math.hypot(walk.tag.x - walk.x, walk.tag.z - walk.z) < 0.5 && walk.tag.y > aw.y + 2 && walk.tag.y < aw.y + 3.5,
    walk && walk.tag ? `tag ${walk.tag.y.toFixed(1)} m (feet ${aw.y.toFixed(1)}), plane ${walk.plane ? Math.round(Math.hypot(walk.plane.x - walk.x, walk.plane.z - walk.z)) : '?'} m away` : 'no tag');
  if (SHOTS) {
    await B.eval(`const r = pt.remote(${JSON.stringify(NAMES[0])}); const w = r.walker; pt.lookAt({ x: w.x + 5, y: w.y + 2.2, z: w.z + 6 }, { x: w.x, y: w.y + 1.1, z: w.z }); return true;`);
    await snap(B, 'mp-1-b-sees-a-walk.png');
    await B.eval(`pt.cam = null; return true;`);
  }

  /* 2. B rolls into A: A down, WASTED on A only. */
  const a0 = await A.eval(`const w = pt.OF.walker; return { x: w.x, z: w.z, k: pt.KD.count, ws: pt.WS.count };`);
  const b0 = await B.eval(`return { ws: pt.WS.count };`);
  await B.eval(`pt.roll(${a0.x - 80}, ${a0.z}, 90, 16, 12); return true;`);
  const hit = await A.eval(`const r = await pt.until(() => pt.KD.down, 15000, 20); return { down: pt.KD.down, by: pt.KD.by, words: pt.KD.words, cause: pt.KD.cause, ws: pt.WS.active, wsWords: pt.WS.words, last: pt.KD.last, ms: r.ms };`, 30);
  await B.eval(`pt.before = null; return true;`);
  M.hit = hit;
  ok('2: B’s plane rolls into A — A’s game knocks A down', hit.down && hit.cause === 'player' && hit.by === jb.id, `${hit.words} (${hit.last && hit.last.speedKt} kt)`);
  ok('2: ...WASTED on A’s screen, saying who', hit.ws && hit.wsWords === `Hit by ${NAMES[1]}’s plane.`, hit.wsWords);
  if (SHOTS) {
    await sleep(900);
    await snap(A, 'mp-2-a-wasted.png');
  }
  /* 3. B sees A fall; B has no WASTED. */
  const fall = [];
  for (let i = 0; i < 6; i++) {
    const f = await B.eval(`
      const r = pt.remote(${JSON.stringify(NAMES[0])}); const w = r && r.walker;
      return w ? { down: w.down, rd: !!w.rd, h: w.rd ? +w.rd.height().toFixed(2) : null, fromEvent: w.fromEvent, falls: w.falls, x: w.x, z: w.z, ws: pt.WS.active, wsCount: pt.WS.count } : null;`, 20);
    fall.push(f);
    if (SHOTS && i < 4) {
      await B.eval(`const r = pt.remote(${JSON.stringify(NAMES[0])}); const w = r.walker; const c = window.__fc || (window.__fc = { x: w.x, y: w.y, z: w.z }); pt.lookAt({ x: c.x - 1, y: c.y + 2.4, z: c.z + 7 }, { x: c.x + 1.5, y: c.y + 0.4, z: c.z }); return true;`);
      await snap(B, `mp-3-b-sees-a-fall-${i}.png`);
    } else await sleep(500);
  }
  await B.eval(`pt.cam = null; window.__fc = null; return true;`);
  M.fall = fall;
  const aLie = await A.eval(`const p = pt.KD.ragdoll.pelvis; return { x: p.x, z: p.z, h: pt.KD.ragdoll.height(), down: pt.KD.down };`);
  const lyingB = fall.filter((f) => f && f.rd && f.h !== null);
  const lowB = lyingB.length ? Math.min(...lyingB.map((f) => f.h)) : 9;
  const lastB = lyingB[lyingB.length - 1];
  ok('3: B sees A fall — the same ragdoll, from A’s own knock-down event', lyingB.length > 0 && lyingB[0].fromEvent === 1 && lowB < 0.6, `lowest ${lowB.toFixed(2)} m, from the event: ${lyingB.length ? lyingB[0].fromEvent : 0}`);
  ok('3: ...lying where A’s game has A lying (within 2.5 m)', !!lastB && Math.hypot(lastB.x - aLie.x, lastB.z - aLie.z) < 2.5, lastB ? `${Math.hypot(lastB.x - aLie.x, lastB.z - aLie.z).toFixed(2)} m apart` : 'never');
  ok('3: ...and no WASTED on B’s screen (it was not B who was hit)', fall.every((f) => f && !f.ws) && fall[fall.length - 1].wsCount === b0.ws);

  /* 4. A gets up, on both screens. */
  const up = await A.eval(`const r = await pt.until(() => !pt.KD.down && !pt.WS.active, 15000); return { up: !pt.KD.down, gotUp: pt.KD.gotUp, ms: r.ms };`, 30);
  const upB = await B.eval(`const r = await pt.until(() => { const q = pt.remote(${JSON.stringify(NAMES[0])}); return q && q.walker && !q.walker.down && !q.walker.rd; }, 8000); return !!r.v;`, 20);
  ok('4: A gets up, and B sees A up again', up.up && up.gotUp && upB, `${up.ms} ms after the knock was settled`);
  if (SHOTS) {
    await A.eval(`sim.key('KeyW', true); await new Promise((r) => setTimeout(r, 1200)); sim.key('KeyW', false); return true;`, 20);
    await B.eval(`const r = pt.remote(${JSON.stringify(NAMES[0])}); const w = r.walker; pt.lookAt({ x: w.x + 5, y: w.y + 2.2, z: w.z + 6 }, { x: w.x, y: w.y + 1.1, z: w.z }); return true;`);
    await snap(B, 'mp-4-b-sees-a-up.png');
    await B.eval(`pt.cam = null; return true;`);
  }
  const errs = await both((p) => p.eval(`return pt.err || null;`));
  ok('no errors in either tab', errs.every((e) => !e) && A.logs.concat(B.logs).filter((l) => /exception/.test(l)).length === 0, [...errs.filter(Boolean), ...A.logs, ...B.logs].slice(0, 4).join(' | '));
  exitCode = R.every((r) => r.pass) ? 0 : 1;
  await both((p) => p.eval(`if (mp.role || mp.lobby) mp.leave('left'); return true;`, 20).catch(() => null));
} catch (err) {
  ok('the playtest ran to the end', false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err));
}
const passed = R.filter((r) => r.pass).length;
log(`${passed} of ${R.length} passed`);
if (arg('json')) writeFileSync(arg('json'), JSON.stringify({ results: R, M }, null, 1));
cleanup();
process.exit(exitCode);
