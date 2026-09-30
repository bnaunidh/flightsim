/**
 * Races for every ride, played together for real: FOUR players in four tabs
 * of ONE headless Chrome, over tools/lan-server.py --local.
 *
 *   node tests/features/race-all.playtest.mjs
 *     --url=http://127.0.0.1:9191/   a LAN server already serving the game (else one is started on a free port)
 *     --json=<file>                  write the numbers there too
 *     --only=car,boat                just those races
 *
 * Every tab runs the game in real time — main.js's own update(dt), thirty
 * times a second — with the real Multiplayer screen, the real WebRTC stack
 * and the real signaling server. For each race in turn:
 *
 *   - Swift Falcon, on the Multiplayer screen's Races card, taps "Pick
 *     <island> for a private match" (which picks the race's vehicle as the
 *     ride too) and makes it; the other three pick that vehicle and type the
 *     code;
 *   - everybody is on the island in the race's vehicle; "🏁 Race" is on
 *     every badge; Swift Falcon taps it: four on the grid, each in its own
 *     place, 3-2-1-GO in every tab;
 *   - four scripted racers at four speeds (the car's follows the streets)
 *     through every gate of every lap; ghosts to each other while they race;
 *     the gates on the badge's minimap;
 *   - the SAME places and the SAME times in every tab, the finishing order
 *     the order of the speeds, and the results card — medals, names, times,
 *     "Race again" — in every tab.
 *
 * And on Harrier Flats, after the helicopters' race: one player comes back in
 * an aeroplane. No 🏁 chip for them (it could not start anything), and the
 * corner says "it’s a helicopter race — switch to the Skyhook"; when a
 * helicopter starts one, the grid is the three helicopters, and the
 * aeroplane's big card says "This is a helicopter race — switch to the
 * Skyhook".
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
const M = {};
const ok = (name, pass, detail = '') => {
  R.push({ name, pass: !!pass, detail });
  log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return pass;
};

/* ---- the shared browser slot (as .claude/devtools/cdp.mjs) ------------------ */
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

/* ---- one Chrome, four tabs ------------------------------------------------ */
let chrome = null;
async function launch() {
  if (chrome) return chrome;
  const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  slot = await acquireSlot();
  const dir = mkdtempSync(join(tmpdir(), 'ifs-race-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--mute-audio', '--enable-unsafe-swiftshader', '--window-size=1280,800',
    '--autoplay-policy=no-user-gesture-required',
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

async function openPage(url, name, timeoutS = 240) {
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
  ws.onclose = () => { for (const { rej } of waiting.values()) rej(new Error('the page went away')); waiting.clear(); };
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
    const st = await raw(`JSON.stringify([!!window.__sim, performance.timeOrigin, document.readyState,
      !('serviceWorker' in navigator) || /[?&]dev=1/.test(location.search) || !!navigator.serviceWorker.controller])`, 5000).catch(() => null);
    const [has, o, rs, controlled] = st ? JSON.parse(st) : [false, null, '', false];
    if (has && rs === 'complete' && controlled && o === origin) {
      if (Date.now() - since > 2000) break;
    } else { origin = has ? o : null; since = Date.now(); }
    if (Date.now() > tEnd) throw new Error(`${name}: the game never settled\n${logs.join('\n')}`);
    await sleep(300);
  }
  return {
    name,
    logs,
    eval: (body, secs = timeoutS) => raw(`(async () => { const sim = window.__sim; const pt = window.__pt; const mp = pt && pt.mp; ${body}\n})()`, secs * 1000),
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
  const pt = (window.__pt = {
    THREE, mpMod, mp: mpMod.multiplayer,
    race: await import('/src/features/race.js'), RR: await import('/src/features/race/rules.js'), shared: await import('/src/features/mpplay/shared.js'),
    T: await import('/src/world/terrain.js'), roads: await import('/src/world/roads.js'),
    ticks: 0, gaps: [], cards: [], lastCard: '', sawGhost: 0,
  });
  s.renderer.render = () => {};
  let last = performance.now();
  pt.timer = setInterval(() => {
    const t = performance.now();
    const dt = Math.min(0.25, (t - last) / 1000);
    if (t - last > 250) pt.gaps.push(Math.round(t - last));
    last = t;
    try { if (pt.before) pt.before(dt); } catch (err) { pt.err = 'before: ' + String(err && err.stack || err).slice(0, 300); }
    try { s.update(dt); } catch (err) { pt.err = String(err && err.stack || err).slice(0, 400); }
    const c = pt.shared.bigCardText();
    if (c && c !== pt.lastCard) pt.cards.push(c);
    pt.lastCard = c || '';
    const st = pt.race.raceState();
    if (st && st.s === pt.RR.S.go && pt.shared.ghostReasons().includes('race')) pt.sawGhost++;
    pt.ticks++;
  }, 33);
  const mp = pt.mp;
  mp.install(s);
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
  pt.text = (sel) => { const el = document.querySelector(sel); return el && !el.hidden ? el.textContent.replace(/\\s+/g, ' ').trim() : null; };
  pt.game = () => { if (s.mode === 'drive' && s.vehicle) return s.vehicle.isBoat ? 'boat' : 'car'; return s.aircraftType && s.aircraftType.id === 'harrier' ? 'heli' : 'flight'; };
  /** The scripted racer's hand: this player's ride at a place, facing a way. */
  pt.put = (p, hd, speed) => {
    if (s.mode === 'drive' && s.vehicle) {
      const v = s.vehicle;
      const y = v.isBoat ? 0 : Math.max(0, pt.T.heightAt(p.x, p.z)) + 0.4;
      v.reset({ pos: new THREE.Vector3(p.x, y, p.z), headingDeg: hd });
      v.pos.y = y;
      return;
    }
    const ac = s.aircraft;
    ac.reset({ pos: new THREE.Vector3(p.x, 0, p.z), headingDeg: hd, speed: Math.min(speed, 60), altAGL: 5, engineOn: true, gearDown: false });
    ac.pos.y = p.y;
    ac.controls.throttle = 0.7;
  };
  /** Through every gate of every lap (the car by the streets), and on over the line. */
  pt.path = (course, fr, slot) => {
    const RR = pt.RR;
    const g = RR.gridSlot(slot, course);
    const air = course.vehicle === 'plane' || course.vehicle === 'heli';
    const pts = [{ x: g.x, y: air ? fr[0].y : 0, z: g.z }];
    if (course.vehicle === 'car') {
      let prev = { x: g.x, z: g.z };
      for (let k = 0; k < RR.totalRings(course); k++) {
        const f = fr[k % fr.length];
        const r = pt.roads.routeOnRoads(s.roads && s.roads.list, prev, { x: f.x, z: f.z }) || [prev, { x: f.x, z: f.z }];
        for (const q of r.slice(1)) pts.push({ x: q.x, y: 0, z: q.z });
        prev = { x: f.x, z: f.z };
      }
      const f = fr[fr.length - 1];
      pts.push({ x: f.x + f.nx * (30 + slot * 12), y: 0, z: f.z + f.nz * (30 + slot * 12) });
      return pts;
    }
    const lead = course.vehicle === 'plane' ? 60 : course.vehicle === 'heli' ? 25 : 30;
    for (let k = 0; k < RR.totalRings(course); k++) {
      const f = fr[k % fr.length];
      pts.push({ x: f.x - f.nx * lead, y: f.y, z: f.z - f.nz * lead });
      pts.push({ x: f.x + f.nx * lead, y: f.y, z: f.z + f.nz * lead });
    }
    const f = fr[fr.length - 1];
    pts.push({ x: f.x + f.nx * (200 + slot * 60), y: f.y + (air ? 30 + slot * 15 : 0), z: f.z + f.nz * (200 + slot * 60) + (slot - 1.5) * 30 });
    return pts;
  };
  pt.pilot = (speed) => {
    pt.P = null;
    pt.before = () => {
      const RR = pt.RR;
      const st = pt.race.raceState();
      const L = pt.race.raceDebug().L;
      if (!st || st.s !== RR.S.go || !L || L.slot < 0) { pt.P = null; return; }
      if (!pt.P) {
        const course = RR.courseById(st.c);
        pt.P = { path: pt.path(course, pt.race.raceDebug().frames, L.slot), i: 0, u: 0, t0: performance.now(), done: 0 };
      }
      const P = pt.P;
      if (P.i >= P.path.length - 1) return;
      // On the clock, not by frames: a tab that hitches catches up, 40 m a frame at most.
      const due = (speed * (performance.now() - P.t0)) / 1000;
      let move = Math.min(40, Math.max(0, due - P.done));
      P.done += move;
      while (move > 0 && P.i < P.path.length - 1) {
        const a = P.path[P.i]; const b = P.path[P.i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1e-6;
        const left = len * (1 - P.u);
        if (move < left) { P.u += move / len; move = 0; } else { move -= left; P.i++; P.u = 0; }
      }
      const a = P.path[Math.min(P.i, P.path.length - 1)]; const b = P.path[Math.min(P.i + 1, P.path.length - 1)];
      const p = { x: a.x + (b.x - a.x) * P.u, y: a.y + (b.y - a.y) * P.u, z: a.z + (b.z - a.z) * P.u };
      const hd = (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI + 360) % 360;
      pt.put(p, hd, speed);
    };
  };
}
window.__pt.mp.setProfile({ name: ${JSON.stringify(name)}, colour: ${JSON.stringify(colour)}, chosen: true });
window.__pt.mp.setPvp(false);
return { state: sim.state, map: sim.settings.map, name: window.__pt.mp.profile.name };`;

const NAMES = ['Swift Falcon', 'Brave Otter', 'Sunny Puffin', 'Jolly Penguin'];
const COLOURS = ['#ff5a4f', '#ffd23f', '#4fd684', '#58c6ff'];
const RIDE = { plane: 'flight:skylark', car: 'car:car', boat: 'boat:boat', heli: 'heli:harrier' };
/** Four speeds for each race, in m/s: the fastest well under the course's own ceiling, the gaps a few seconds at the line. */
const SPEEDS = { car: [56, 51, 46, 41], boat: [32, 29, 26, 23], heli: [100, 90, 80, 70], 'ring-rally': [340, 310, 280, 250] };

/* ---- the run --------------------------------------------------------------- */
const url = await serve();
log(`serving ${url}`);
const pages = [];
let exitCode = 1;
try {
  for (let i = 0; i < 4; i++) {
    const p = await openPage(`${url}?dev=1`, `tab${i + 1}`);
    const r = await p.eval(PAGE(NAMES[i], COLOURS[i]), 120);
    pages.push(p);
    log(`tab${i + 1} up as ${r.name} (${r.state}, ${r.map})`);
  }
  const [A, B, C, D] = pages;
  const all = (fn) => Promise.all(pages.map(fn));
  const toScreen = (p) => p.eval(`
    if (mp.role) { mp.leave('left'); await new Promise((r) => setTimeout(r, 500)); }
    pt.before = null;
    pt.mpMod.openMultiplayer(sim);
    await pt.until(() => document.querySelector('.mp-racecard [data-race-row]'), 20000);
    return !!document.querySelector('.mp-racecard [data-race-row]');`, 60);
  const joinCode = (p, code, rideKey) => p.eval(`
    pt.click('[data-mp-ride="${rideKey}"]');
    const box = document.querySelector('[data-mp-code]');
    box.value = ${JSON.stringify(String(code || '').replace(/-/g, ' '))};
    box.dispatchEvent(new Event('input', { bubbles: true }));
    pt.click('[data-mp-join-code]');
    const r = await pt.until(() => mp.role === 'client' && mp.ready && sim.state === 'flying', 60000);
    await pt.until(() => pt.race.raceDebug().frames, 10000);
    return { ok: !!r.v, map: sim.settings.map, id: mp.meId, game: pt.game(), status: pt.text('[data-mp-status]') };`, 90);

  const only = arg('only') ? String(arg('only')).split(',') : null;
  const order = ['car', 'boat', 'heli', 'ring-rally'].filter((id) => !only || only.includes(id));
  M.races = {};
  for (const id of order) {
    log(`==== ${id} ====`);
    await all(toScreen);
    // Swift Falcon: the Races card's own "Pick <island> for a private match", then Make it.
    const made = await A.eval(`
      const RR = pt.RR;
      const c = RR.courseById('${id}');
      const btn = document.querySelector(c.id === 'ring-rally' ? '.mp-racecard [data-mp-race-pick]' : '.mp-racecard [data-race-pick="${id}"]');
      if (c.id === 'ring-rally') pt.click('[data-mp-ride="flight:skylark"]');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 200));
      const picked = mp.lobbyScreen.privatePick;
      const ride = mp.ride();
      const status = pt.text('[data-mp-status]');
      pt.click('[data-mp-private]');
      const r = await pt.until(() => mp.role === 'host' && mp.ready && sim.state === 'flying', 60000);
      await pt.until(() => pt.race.raceDebug().frames, 10000);
      return { ok: !!r.v, picked, ride, status, map: sim.settings.map, code: mp.server && mp.server.code, game: pt.game(), island: c.island, vehicle: c.vehicle, map0: c.map };`, 90);
    ok(`${id}: "Pick ${made.island} for a private match" on the Races card picks the island AND the ${made.vehicle} as the ride; Make it: a private match there, with a code`,
      made.ok && made.picked === made.map0 && made.map === made.map0 && !!made.code && (made.vehicle === 'plane' ? made.game === 'flight' : made.game === made.vehicle),
      `${made.picked} · ${made.ride && made.ride.game} · ${made.status} · ${made.code}`);
    const rideKey = RIDE[made.vehicle];
    const joins = [];
    for (const p of [B, C, D]) joins.push(await joinCode(p, made.code, rideKey));
    ok(`${id}: the other three pick ${made.vehicle === 'plane' ? 'an aeroplane' : `the ${made.vehicle}`} and type the code: all four on ${made.island}, in it`,
      joins.every((j) => j.ok && j.map === made.map0 && j.game === made.game), joins.map((j) => `${j.id}:${j.game}@${j.map}`).join(' '));
    const ids = [0, ...joins.map((j) => j.id)];
    let seen = [];
    for (let k = 0; k < 20; k++) {
      seen = await all((p) => p.eval(`return { n: mp.remotes.players.size, chip: (() => { const b = document.querySelector('[data-mpp-chip="race"]'); return b && !b.hidden ? b.textContent : null; })() };`, 20));
      if (seen.every((s) => s.n === 3 && s.chip)) break;
      await sleep(1000);
    }
    ok(`${id}: every tab draws the other three, and "🏁 Race" is on every badge`, seen.every((s) => s.n === 3 && s.chip && /Race/.test(s.chip)), seen.map((s) => `${s.n}/${s.chip}`).join(' '));
    const speeds = SPEEDS[id];
    await all((p) => p.eval(`pt.pilot(${speeds[pages.indexOf(p)]}); pt.cards = []; pt.sawGhost = 0; return true;`));
    const mm0 = await all((p) => p.eval(`return pt.race.raceDebug().stats.minimapDrawn || 0;`));
    await A.eval(`pt.click('[data-mpp-chip="race"]'); return true;`);
    const grid = await all((p) => p.eval(`
      const r = await pt.until(() => { const s = pt.race.raceState(); return s && s.s === pt.RR.S.grid && s.c === '${id}' ? s : null; }, 8000, 30);
      await new Promise((res) => setTimeout(res, 700));
      const L = pt.race.raceDebug().L;
      const course = pt.RR.courseById('${id}');
      const g = L && L.slot >= 0 ? pt.RR.gridSlot(L.slot, course) : null;
      const me = sim.mode === 'drive' ? sim.vehicle : sim.aircraft;
      return { ok: !!r.v, ent: r.v ? r.v.ent : null, slot: L ? L.slot : -1, off: g ? Math.round(Math.hypot(me.pos.x - g.x, me.pos.z - g.z) * 10) / 10 : null, hud: pt.text('.race-hud') };`, 20));
    ok(`${id}: 🏁 Race on one badge: all four on the grid, each in its own place, "on the grid" at the top of every screen`,
      grid.every((g) => g.ok && g.slot >= 0 && g.off !== null && g.off < 4 && g.hud && /on the grid/.test(g.hud)) && new Set(grid.map((g) => g.slot)).size === 4 && grid[0].ent.length === 4,
      grid.map((g) => `${g.slot}:${g.off}m`).join(' '));
    const gone = await all((p) => p.eval(`
      const r = await pt.until(() => { const s = pt.race.raceState(); return s && s.s === pt.RR.S.go; }, 10000, 30);
      await pt.until(() => pt.race.raceDebug().stats.countdown.includes('GO'), 3000, 30);
      return { ok: !!r.v, cd: pt.race.raceDebug().stats.countdown.join('') };`, 20));
    ok(`${id}: the lights count 3, 2, 1 in every tab — and GO`, gone.every((g) => g.ok && g.cd === '321GO'), gone.map((g) => g.cd).join(' | '));
    const tRace = Date.now();
    const fin = await all((p) => p.eval(`
      const r = await pt.until(() => { const s = pt.race.raceState(); return s && s.s === pt.RR.S.done; }, 200000, 100);
      const s = pt.race.raceState();
      await new Promise((res) => setTimeout(res, 600));
      const card = document.querySelector('.race-results');
      const L = pt.race.raceDebug().L;
      return { ok: !!r.v, fin: s ? s.fin : null, out: s ? s.out : null, k: L ? L.k : null, rings: pt.race.raceDebug().stats.rings, ghost: pt.sawGhost, mm: pt.race.raceDebug().stats.minimapDrawn || 0,
        card: card && !card.hidden ? card.textContent.replace(/\\s+/g, ' ') : null, refused: pt.race.raceDebug().refused, gaps: pt.gaps.length };`, 240));
    const raceS = Math.round((Date.now() - tRace) / 1000);
    const total = await A.eval(`return pt.RR.totalRings(pt.RR.courseById('${id}'));`);
    const ref = JSON.stringify(fin[0].fin);
    const byId = fin[0].fin ? fin[0].fin.map((f) => f[0]) : [];
    const expected = ids.map((pid, i) => ({ pid, sp: speeds[i] })).sort((a, b) => b.sp - a.sp).map((x) => x.pid);
    ok(`${id}: four scripted racers at four speeds through all ${total} gates: the SAME places and the SAME times in every tab, in the order of their speeds`,
      fin.every((f) => f.ok && f.fin && f.fin.length === 4 && JSON.stringify(f.fin) === ref && f.k === total) && byId.join() === expected.join(),
      `order ${byId.join(',')} (by speed ${expected.join(',')}); times ${fin[0].fin ? fin[0].fin.map((x) => (x[1] / 1000).toFixed(1)).join(', ') : '-'} s; gates ${fin.map((f) => f.k).join('/')}; refused ${fin.flatMap((f) => f.refused).slice(0, 3).join(' / ')}`);
    const nm = await A.eval(`return pt.RR.courseById('${id}').name;`);
    ok(`${id}: the results card in every tab: "${nm} — results", medals, every name and time, "Race again"`,
      fin.every((f) => f.card && f.card.includes(`${nm} — results`) && /🥇/.test(f.card) && /🥈/.test(f.card) && /🥉/.test(f.card) && NAMES.every((n) => f.card.includes(n)) && /Race again/.test(f.card)),
      fin[1].card ? fin[1].card.slice(0, 220) : 'no card');
    ok(`${id}: racers were ghosts while they raced, and the gates were on the badge’s minimap, in every tab`,
      fin.every((f, i) => f.ghost > 30 && f.mm - mm0[i] > 30), fin.map((f, i) => `${f.ghost}/${f.mm - mm0[i]}`).join(' '));
    M.races[id] = { order: byId, times: fin[0].fin ? fin[0].fin.map((x) => x[1]) : null, raceS, stalls: fin.map((f) => f.gaps) };

    // ---- the wrong vehicle, on the helicopters' island ----
    if (id === 'heli') {
      await D.eval(`pt.before = null; mp.leave('left'); await new Promise((r) => setTimeout(r, 500)); pt.mpMod.openMultiplayer(sim); await pt.until(() => document.querySelector('[data-mp-code]'), 10000); return true;`, 30);
      const dj = await joinCode(D, made.code, 'flight:skylark');
      await sleep(2500);
      const told = await D.eval(`
        const chipEl = document.querySelector('[data-mpp-chip="race"]');
        const st = pt.race.raceState();
        return { chip: !!(chipEl && !chipEl.hidden), told: pt.race.raceDebug().stats.told.slice(-1)[0] || null, feed: pt.shared.feedLines().filter((l) => /Skyhook/.test(l)), noRace: !st || st.s === pt.RR.S.done };`, 20);
      ok('heli: somebody comes back in an aeroplane on Harrier Flats: no 🏁 chip that cannot start anything, and told in the corner — "it’s a helicopter race — switch to the Skyhook to race it"',
        dj.ok && dj.game === 'flight' && !told.chip && told.told === 'This is a helicopter race — switch to the Skyhook' && told.feed.length > 0 && told.noRace,
        `${dj.game} · chip ${told.chip} · ${told.feed.join(' | ')}`);
      await all((p) => p.eval(`pt.before = null; pt.cards = []; return true;`));
      await A.eval(`pt.click('[data-race-close]'); pt.click('[data-mpp-chip="race"]'); return true;`);
      const g2 = await all((p) => p.eval(`
        const r = await pt.until(() => { const s = pt.race.raceState(); return s && s.s === pt.RR.S.grid ? s : null; }, 8000, 30);
        await new Promise((res) => setTimeout(res, 500));
        return { ent: r.v ? r.v.ent : null, me: mp.meId, hud: pt.text('.race-hud'), cards: pt.cards.slice() };`, 20));
      ok('heli: a helicopter taps 🏁 Race: the grid is the three helicopters — the aeroplane is not on it, and is told on the big card "This is a helicopter race — switch to the Skyhook"',
        g2.every((g) => g.ent && g.ent.length === 3 && !g.ent.includes(dj.id)) && !(g2[3].hud && /on the grid/.test(g2[3].hud)) && g2[3].cards.some((c) => /This is a helicopter race — switch to the Skyhook/.test(c)),
        `${g2.map((g) => `${g.me}: ${g.ent && g.ent.join(',')}`).join(' | ')}; ${g2[3].cards.join(' / ')}`);
      await Promise.all([A, B, C].map((p) => p.eval(`pt.click('[data-mpp-chip="race"]'); return true;`)));
      await sleep(1500);
    }
  }

  const errs = await all((p) => p.eval('return pt.err || null;'));
  const exceptions = pages.flatMap((p) => p.logs.filter((l) => /exception/.test(l)));
  ok('no exceptions in any tab', errs.every((e) => !e) && exceptions.length === 0, [...errs.filter(Boolean), ...exceptions].slice(0, 3).join(' | '));
  exitCode = R.every((r) => r.pass) ? 0 : 1;
} catch (err) {
  ok('the playtest ran to the end', false, String(err && err.stack || err).slice(0, 600));
  for (const p of pages) if (p.logs.length) log(`${p.name} console: ${p.logs.slice(-5).join(' | ')}`);
} finally {
  for (const p of pages) await p.close().catch(() => {});
  if (chrome) chrome.proc.kill();
  const passed = R.filter((r) => r.pass).length;
  console.log(JSON.stringify({ passed, total: R.length, numbers: M, failed: R.filter((r) => !r.pass) }, null, 1));
  if (arg('json')) writeFileSync(arg('json'), JSON.stringify({ passed, total: R.length, numbers: M, results: R }, null, 1));
  cleanup();
  process.exit(exitCode);
}

