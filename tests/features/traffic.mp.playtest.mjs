/**
 * The AI traffic in a multiplayer game, played for real: two players in two
 * tabs of ONE headless Chrome, over tools/lan-server.py --local.
 *
 *   node tests/features/traffic.mp.playtest.mjs
 *     --url=http://127.0.0.1:9171/   a LAN server (--local) already serving the game (else one is started on a free port)
 *     --json=<file>                  write the numbers there too
 *     --shots=<dir>                  save a picture from each tab
 *
 * Neither tab has the Dev passcode: the traffic is on in Free Flight for
 * everybody now. Proved:
 *
 *   - the host runs the traffic and the guest runs none of its own;
 *   - the SAME aeroplanes in both tabs — the same ids and types, each drawn
 *     in the guest's tab near where the host has it (the error, median and
 *     95th percentile, over every sample);
 *   - the runway is the guest's too: the guest lines up on 09 and the host's
 *     traffic sees their claim (traffic/priority.js via mpworld.js
 *     setOtherPilots) — an arrival on final goes round, a departure holds
 *     short; and when the guest has gone, the claim is gone.
 *
 * Every tab runs the game in real time (main.js's own update, thirty times a
 * second, the draw stubbed except for the pictures). Holds one of the shared
 * headless-Chrome slots (the same lock as .claude/devtools/cdp.mjs).
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

/* ---- one Chrome, two tabs ---------------------------------------------- */
let chrome = null;
async function launch() {
  if (chrome) return chrome;
  const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  slot = await acquireSlot();
  const dir = mkdtempSync(join(tmpdir(), 'ifs-traffic-mp-'));
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
    send,
    eval: (body, secs = timeoutS) => raw(`(async () => { const sim = window.__sim; const pt = window.__pt; const mp = pt && pt.mp; ${body}\n})()`, secs * 1000),
    async snap(file) {
      await raw('(() => { const s = window.__sim; s.renderer.setPixelRatio(0.6); s.onResize(); window.__pt.realRender(s.scene, s.camera); return true; })()', 60000);
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
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
  const traffic = await import('/src/features/traffic.js');
  const world = await import('/src/features/mpworld.js');
  const TR = await import('/src/world/terrain.js');
  const pt = (window.__pt = { THREE, mpMod, mp: mpMod.multiplayer, traffic, world, TR, realRender: s.renderer.render.bind(s.renderer), tlog: [] });
  s.renderer.render = () => {};
  const origin = performance.timeOrigin;
  pt.now = () => origin + performance.now();
  let last = performance.now();
  pt.timer = setInterval(() => {
    const t = performance.now();
    const dt = Math.min(0.25, (t - last) / 1000);
    last = t;
    try { if (pt.before) pt.before(dt); } catch (err) { pt.err = 'before: ' + String(err && err.stack || err).slice(0, 300); }
    try { s.update(dt); } catch (err) { pt.err = String(err && err.stack || err).slice(0, 400); }
    try { if (pt.after) pt.after(dt); } catch (err) { pt.err = 'after: ' + String(err && err.stack || err).slice(0, 300); }
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
  // Held where it is put, every frame: on the ground, lined up, brakes on; or in the air, far away.
  pt.hold = (x, z, heading, agl = 0) => {
    const ac = s.aircraft;
    pt.before = () => {
      ac.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: heading, speed: agl > 0 ? 55 : 0, altAGL: agl, engineOn: true, gearDown: true });
      ac.controls.throttle = agl > 0 ? 0.6 : 0;
      if (agl <= 0) ac.controls.brakes = 1;
    };
    pt.before();
  };
}
window.__pt.mp.setProfile({ name: ${JSON.stringify(name)}, colour: ${JSON.stringify(colour)}, chosen: true });
window.__pt.mp.setPvp(false);
return { state: sim.state, map: sim.settings.map, name: window.__pt.mp.profile.name, dev: !!(sim.menus.prog && sim.menus.prog.devUnlocked), trafficSetting: sim.settings.traffic === undefined ? 'default' : sim.settings.traffic };`;

const SHOTS = arg('shots') || null;

/* ---- the run --------------------------------------------------------------- */
const url = await serve();
log(`serving ${url}`);
let exitCode = 1;
const pages = [];
try {
  for (const [i, [name, colour]] of [['Swift Falcon', '#ff5a4f'], ['Brave Otter', '#58c6ff']].entries()) {
    const p = await openPage(`${url}?dev=1`, `tab${i + 1}`);
    const r = await p.eval(PAGE(name, colour), 120);
    pages.push(p);
    log(`tab${i + 1} up as ${r.name} (${r.state}, ${r.map}, dev ${r.dev}, traffic switch ${r.trafficSetting})`);
    M[`tab${i + 1}`] = r;
  }
  const [A, B] = pages;
  ok('neither player has the Dev passcode, and both have the traffic switch at its default (on)', !M.tab1.dev && !M.tab2.dev && M.tab1.trafficSetting === 'default' && M.tab2.trafficSetting === 'default',
    `dev ${M.tab1.dev}/${M.tab2.dev}, switch ${M.tab1.trafficSetting}/${M.tab2.trafficSetting}`);
  const openList = (p) => p.eval(`
    const viaMenu = sim.state === 'menu' && pt.click('[data-act="multiplayer"]');
    if (!viaMenu) pt.mpMod.openMultiplayer(sim);
    await pt.until(() => document.querySelectorAll('[data-mp-lobby].is-empty, [data-mp-lobby].is-open, [data-mp-lobby].is-full').length === 5, 30000);
    return true;`, 60);
  const join = (p, n) => p.eval(`
    const t0 = performance.now();
    pt.click('[data-mp-lobby-join="${n}"]');
    const r = await pt.until(() => (mp.ready && mp.lobby && sim.state === 'flying') || (!mp.busy && !mp.lobby && document.querySelector('[data-mp-status]').textContent), 60000);
    return { ms: Math.round(performance.now() - t0), role: mp.role, id: mp.meId, status: pt.text('[data-mp-status]'), map: sim.settings.map };`, 90);
  await openList(A);
  const ja = await join(A, 1);
  ok('the first player into Lobby 1 hosts it', ja.role === 'host', `${ja.role}, ${ja.ms} ms, ${ja.map}`);
  await openList(B);
  const jb = await join(B, 1);
  ok('the second joins it as a guest', jb.role === 'client', `${jb.role}, ${jb.ms} ms: ${jb.status}`);
  let seen = [];
  for (let k = 0; k < 25; k++) {
    seen = await Promise.all(pages.map((p) => p.eval(`return { n: mp.remotes.players.size, drawn: [...mp.remotes.players.values()].filter((q) => q.visible).length };`, 20)));
    if (seen.every((s) => s.n === 1 && s.drawn === 1)) break;
    await sleep(1000);
  }
  ok('each draws the other', seen.every((s) => s.n === 1 && s.drawn === 1), seen.map((s) => `${s.n}/${s.drawn}`).join(' '));

  /* ---- the host runs it, the guest draws the host's ---- */
  // Both out of the way in the air, apart, so the traffic gets on with its day.
  await A.eval(`pt.hold(-2500, -2500, 90, 600); return true;`);
  await B.eval(`pt.hold(2500, -2500, 270, 600); return true;`);
  const tr0 = await A.eval(`
    const r = await pt.until(() => pt.traffic.trafficState().on && sim.traffic.length >= 2, 15000);
    // One coming in to land as well, so something is moving in the air.
    const a = pt.traffic.spawnTraffic(sim, 'arrive');
    return { on: pt.traffic.trafficState().on, n: sim.traffic.length, types: sim.traffic.map((c) => c.typeId), arrive: a.ok ? a.callsign : a.why };`, 30);
  const own = await B.eval(`return { n: pt.traffic.trafficState().craft.length, on: pt.traffic.trafficState().on, why: pt.traffic.trafficState().why };`);
  ok('the host runs the AI traffic without Dev mode; the guest runs none of its own', tr0.on && tr0.n >= 2 && !own.on && own.n === 0,
    `host ${tr0.n} (${tr0.types.join(',')}; + ${tr0.arrive}); guest ${own.n} of its own (${own.why})`);
  await sleep(3000);
  await Promise.all(pages.map((p) => p.eval(`
    pt.tlog = [];
    pt.after = () => {
      if (mp.role === 'host') { for (const c of (sim.traffic || [])) pt.tlog.push([pt.now(), Number(String(c.id).replace(/\\D/g, '')) % 1000, c.pos.x, c.pos.y, c.pos.z, c.typeId]); }
      else for (const m of pt.world.worldDebug().W.mirror.values()) pt.tlog.push([pt.now(), m.id, m.dx, m.dy, m.dz, m.type, m.model ? 1 : 0]);
    };
    return true;`)));
  await sleep(10000);
  const [hostLog, guestLog] = await Promise.all(pages.map((p) => p.eval(`pt.after = null; return pt.tlog;`, 60)));
  const errs = [];
  const hostIds = new Map();
  const guestIds = new Map();
  let modelled = 0;
  for (const h of hostLog) hostIds.set(h[1], h[5]);
  for (const [e, idn, x, y, z, type, m] of guestLog) {
    guestIds.set(idn, type);
    if (m) modelled++;
    const hs = hostLog.filter((h) => h[1] === idn);
    const i = hs.findIndex((h) => h[0] >= e);
    if (i <= 0) continue;
    const a = hs[i - 1];
    const b = hs[i];
    const k = (e - a[0]) / (b[0] - a[0] || 1);
    errs.push(Math.hypot(x - (a[2] + (b[2] - a[2]) * k), y - (a[3] + (b[3] - a[3]) * k), z - (a[4] + (b[4] - a[4]) * k)));
  }
  errs.sort((a, b) => a - b);
  const q = (arr, f) => +(arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] || 0).toFixed(1);
  M.mirror = { host: [...hostIds.entries()], guest: [...guestIds.entries()], samples: errs.length, p50: q(errs, 0.5), p95: q(errs, 0.95), max: q(errs, 1) };
  const sameSet = hostIds.size > 0 && [...hostIds.entries()].every(([idn, type]) => guestIds.get(idn) === type) && [...guestIds.keys()].every((idn) => hostIds.has(idn));
  ok('the SAME AI aeroplanes in both tabs — the same ids and types, drawn near where the host has them',
    sameSet && errs.length > 100 && modelled > 0 && M.mirror.p50 < 25 && M.mirror.p95 < 80,
    `host ${[...hostIds.entries()].map(([i, t]) => `${i}:${t}`).join(',')} → guest ${[...guestIds.entries()].map(([i, t]) => `${i}:${t}`).join(',')}; error median ${M.mirror.p50} m, p95 ${M.mirror.p95} m, max ${M.mirror.max} m over ${errs.length} samples`);

  /* ---- the runway is the guest's too ---- */
  /*
   * The host's own three aeroplanes have Kestrel's usable stands (at the
   * default 'high' graphics the apron parks six of its own), so another
   * arrival and departure were refused — "nowhere free to park — clear the
   * traffic first", the brief's own failure. So: the host's traffic is
   * cleared (the guest's sky empties with it), and an arrival is put on final
   * and a departure on a stand while the runway is free; then the guest
   * lines up on 09.
   */
  const cleared = await A.eval(`
    pt.traffic.clearTraffic(sim);
    return { n: pt.traffic.trafficState().craft.length, pub: sim.traffic.length };`, 30);
  const guestEmpty = await B.eval(`
    const r = await pt.until(() => pt.world.worldDebug().W.mirror.size === 0, 10000);
    return { ok: !!r.v, ms: r.ms, left: pt.world.worldDebug().W.mirror.size };`, 30);
  ok('the host clears its traffic: the guest\'s sky empties with it', cleared.n === 0 && cleared.pub === 0 && guestEmpty.ok, `host ${cleared.n}/${cleared.pub}; guest ${guestEmpty.left} left after ${guestEmpty.ms} ms`);
  const before = await A.eval(`
    const a = pt.traffic.spawnTraffic(sim, 'arrive');
    const d = pt.traffic.spawnTraffic(sim, 'depart');
    const st = pt.traffic.trafficState();
    return { arrive: a.ok ? a.id : null, arriveWhy: a.why || a.callsign, depart: d.ok ? d.id : null, departWhy: d.why || d.callsign, ga: st.priority.stats.priorityGoArounds };`, 30);
  ok('the host adds an arrival on final and a departure on a stand', !!before.arrive && !!before.depart, `${before.arriveWhy}; ${before.departWhy}`);
  await sleep(2000);
  await B.eval(`const R = pt.TR.AIRPORT.runway; pt.hold(R.cx - R.length / 2 + 80, R.cz, 90, 0); return true;`);
  const claim = await A.eval(`
    const r = await pt.until(() => { const p = pt.traffic.priorityState(); return p.others.some((o) => o.kind === 'runway') ? p : null; }, 10000);
    return r.v ? { others: r.v.others, blocks: r.v.blocks, me: r.v.me.kind, pilots: pt.world.worldDebug().remotePilots().map((p) => ({ x: Math.round(p.x), z: Math.round(p.z), onGround: p.onGround, hdg: Math.round(p.hdgDeg) })) } : { none: true, p: pt.traffic.priorityState(), pilots: pt.world.worldDebug().remotePilots() };`, 30);
  ok('the guest lines up on 09: on the host, their claim on the runway holds the traffic (yours stays empty)',
    !claim.none && claim.blocks && claim.me === null && claim.others.some((o) => o.kind === 'runway'), JSON.stringify(claim).slice(0, 300));
  /*
   * Watch the arrival and the departure, on the host, with the guest sat
   * there: until the departure is holding short and the arrival has gone
   * round, and twenty seconds more — at most four minutes. A fixed 75 s was
   * not enough for a departure from a nose-in stand (pushed back 86 m at
   * 2 m/s, then 530 m of taxiing), the same allowance the browser check
   * gives it.
   */
  const watch = await A.eval(`
    const ids = { a: ${JSON.stringify(before.arrive)}, d: ${JSON.stringify(before.depart)} };
    const ga0 = ${JSON.stringify(before.ga)};
    const seenA = [], seenD = [];
    let landed = false, rolled = false, held = false, bothAt = null;
    const t0 = performance.now();
    while (performance.now() - t0 < 240000) {
      for (const c of pt.traffic.trafficState().craft) {
        if (c.id === ids.a) { if (seenA[seenA.length - 1] !== c.phase) seenA.push(c.phase); if (c.phase === 'rollout') landed = true; }
        if (c.id === ids.d) { if (seenD[seenD.length - 1] !== c.phase) seenD.push(c.phase); if (c.state === 'waiting') held = true; if (c.phase === 'takeoff' && c.v > 1) rolled = true; }
        if (c.phase === 'takeoff' && c.v > 1 && c.id !== ids.d) rolled = true;
      }
      const ga = pt.traffic.trafficState().priority.stats.priorityGoArounds;
      if (held && ga > ga0 && bothAt == null) bothAt = performance.now();
      if (bothAt != null && performance.now() - bothAt > 20000) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const st = pt.traffic.trafficState();
    return { seenA, seenD, landed, rolled, held, secs: Math.round((performance.now() - t0) / 1000), ga: st.priority.stats.priorityGoArounds, err: pt.err || null };`, 300);
  M.guestRunway = { before, claim, watch };
  ok('... the arrival on final goes round for the guest, and nobody lands on them', before.arrive && watch.ga > before.ga && !watch.landed,
    `${before.arriveWhy}: ${watch.seenA.join(' > ')}; ${watch.ga - before.ga} priority go-around(s) in ${watch.secs} s`);
  ok('... and nobody takes off at them — the departure holds short', before.depart && !watch.rolled && (watch.held || watch.seenD.some((p) => p === 'holding')),
    `${before.departWhy}: ${watch.seenD.join(' > ')} (${watch.secs} s)`);
  // The guest flies off: the claim goes with them.
  await B.eval(`pt.hold(6000, -6000, 90, 900); return true;`);
  const gone = await A.eval(`
    const r = await pt.until(() => { const p = pt.traffic.priorityState(); return !p.blocks && p.others.every((o) => !o.kind) ? p : null; }, 15000);
    return { ok: !!r.v, ms: r.ms, p: pt.traffic.priorityState().others };`, 30);
  ok('the guest flies away: their claim is gone, the runway is the traffic\'s again', gone.ok, `${gone.ms} ms: ${JSON.stringify(gone.p)}`);

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    // Both on the ground beside the runway at the apron end, looking along it: the same aeroplanes in both.
    await A.eval(`const R = pt.TR.AIRPORT.runway; pt.hold(R.cx - R.length / 2 + 60, R.cz, 90, 0); return true;`);
    await B.eval(`const R = pt.TR.AIRPORT.runway; pt.hold(R.cx - R.length / 2 + 120, R.cz - 40, 70, 0); return true;`);
    await sleep(3000);
    for (const [p, n] of [[A, 'mp-host.png'], [B, 'mp-guest.png']]) {
      try {
        log(`screenshot ${await p.snap(join(SHOTS, n))}`);
      } catch (e) {
        log(`screenshot ${n} failed: ${e.message}`);
      }
    }
  }
  const errsIn = await Promise.all(pages.map((p) => p.eval(`return pt.err || null;`)));
  ok('no tab hit an error in its game loop', errsIn.every((e) => !e), errsIn.filter(Boolean).join(' | '));
  exitCode = R.every((r) => r.pass) ? 0 : 1;
} catch (err) {
  ok('the playtest ran to the end', false, String(err && err.stack || err).slice(0, 800));
  for (const p of pages) if (p.logs.length) log(`${p.name} console: ${p.logs.slice(-6).join(' | ')}`);
}
const passed = R.filter((r) => r.pass).length;
console.log(`traffic multiplayer playtest: ${passed}/${R.length} passed`);
if (arg('json')) writeFileSync(arg('json'), JSON.stringify({ results: R, numbers: M }, null, 1));
cleanup();
process.exit(exitCode);
