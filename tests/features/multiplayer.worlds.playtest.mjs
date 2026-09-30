/**
 * The world playtest (list 3, part 3a): lobbies on their own islands, and
 * the WORLD lobbies — "palo alto to berkeley" — in four real tabs of ONE
 * headless Chrome, over tools/lan-server.py --local, which stands in for the
 * public matchmaking server as well as being the LAN one.
 *
 *   node tests/features/multiplayer.worlds.playtest.mjs
 *     --url=http://127.0.0.1:9171/   a LAN server (--local) already serving the game (else one is started on a free port)
 *     --json=<file>                  write the numbers there too
 *
 * Two towns: tabs A and B are "Palo Alto", C and D "Berkeley" — the same
 * server, two different Wi-Fi hashes, which is what two networks are to the
 * game. Every tab runs the game in real time (main.js's own update, thirty
 * times a second, the draw stubbed) with the real lobby screen, the real
 * WebRTC stack and the real signaling server. Measured, not looked at:
 *
 *   - the screen: "Wi-Fi lobbies — people on your network" and "World
 *     lobbies — anyone, anywhere", five each, every card naming its island;
 *   - each town's Lobby 3 is its own: A and C both start one — both on
 *     Aurora Fjords, whatever island their menu was on — and each town's
 *     list shows only its own;
 *   - the world lobbies are everybody's: D (Berkeley) starts World 3, B
 *     (Palo Alto) sees it on Gateway International and joins; each sees the
 *     other's aeroplane and username, over a cross-network ('v4') link;
 *   - the world lobby's host closes the tab: it re-forms round B, on the
 *     same island, B's flight never stopping;
 *   - gentle on the public server: what a tab with the lobby screen open
 *     asks it, a minute's worth, and nothing at all for the world row when
 *     the screen is opened again straight away;
 *   - no username ever goes through the signaling server.
 *
 * Holds one of the shared headless-Chrome slots (the same lock as
 * .claude/devtools/cdp.mjs) for the one Chrome all four tabs live in, with
 * background throttling off: four players are four computers.
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

/* ---- one Chrome, many tabs --------------------------------------------- */
let chrome = null;
async function launch() {
  if (chrome) return chrome;
  const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  slot = await acquireSlot();
  const dir = mkdtempSync(join(tmpdir(), 'ifs-lobby-chrome-'));
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
    else if (m.method === 'Runtime.consoleAPICalled' && /error|warning/.test(m.params.type)) logs.push(`[${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 400));
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
    // ?dev=1 keeps the service worker out of it (main.js): nine tabs, no precache and no reload dance.
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
const PAGE = (name, colour, town) => `
if (!window.__pt) {
  window.requestAnimationFrame = () => 0;
  // Four players are four computers, each with its game in front: a background tab of this one Chrome says "hidden",
  // and a hidden tab's World row rightly asks the matchmaking server nothing (lobby.js).
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  const s = sim;
  const THREE = await import('/src/vendor/three.module.js');
  const mpMod = await import('/src/features/multiplayer.js');
  const P = await import('/src/features/multiplayer/protocol.js');
  const pt = (window.__pt = { THREE, mpMod, P, mp: mpMod.multiplayer, ticks: 0, gaps: [], own: [], toasts: [], lobbyEv: [], starts: 0, sig: [] });
  s.renderer.render = () => {};
  const origin = performance.timeOrigin;
  const now = () => origin + performance.now();
  pt.now = now;
  if (s.hud && s.hud.notify) {
    const n = s.hud.notify.bind(s.hud);
    s.hud.notify = (html, kind, secs) => { pt.toasts.push({ e: now(), text: String(html).replace(/<[^>]+>/g, '') }); return n(html, kind, secs); };
  }
  const sm = s.startMode.bind(s);
  s.startMode = (...a) => { pt.starts++; return sm(...a); };
  let last = performance.now();
  pt.timer = setInterval(() => {
    const t = performance.now();
    const dt = Math.min(0.25, (t - last) / 1000);
    if (t - last > 250) pt.gaps.push({ e: now(), ms: Math.round(t - last) });
    last = t;
    try { s.update(dt); } catch (err) { pt.err = String(err && err.stack || err).slice(0, 400); }
    const me = s.mode === 'drive' && s.vehicle ? s.vehicle.pos : s.aircraft && s.aircraft.pos;
    if (me && s.state === 'flying') pt.own.push({ e: now(), x: me.x, y: me.y, z: me.z, st: s.state });
    while (pt.own.length > 3000) pt.own.shift();
    pt.ticks++;
  }, 33);
  const mp = pt.mp;
  mp.install(s);
  const ole = mp.onLobbyEvent.bind(mp);
  mp.onLobbyEvent = (m, type, ...args) => {
    if (type === 'reconnecting' || type === 'role' || type === 'out') pt.lobbyEv.push({ e: now(), type, a0: typeof args[0] === 'string' ? args[0] : null });
    return ole(m, type, ...args);
  };
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
  pt.airborne = (x, z, heading) => {
    const ac = s.aircraft;
    ac.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: heading, speed: 55, altAGL: 350, engineOn: true, gearDown: false });
    ac.controls.throttle = 0.7;
    if (s.input) { s.input.throttleTarget = 0.7; if (s.input.out) s.input.out.throttle = 0.7; }
  };
  // Every connection this tab opens to the signaling server, and under which id.
  pt.opens = [];
  const WS0 = window.WebSocket;
  window.WebSocket = class extends WS0 {
    constructor(u, p) {
      super(u, p);
      if (String(u).includes('/peerjs?')) pt.opens.push({ e: now(), id: (/[?&]id=([^&]+)/.exec(String(u)) || [])[1] || '' });
    }
  };
  // Everything this tab sends the signaling server: what, to whom, and whether a username rode along.
  const wsSend = WS0.prototype.send;
  WS0.prototype.send = function (d) {
    try {
      const m = JSON.parse(d);
      if (m.type !== 'HEARTBEAT') pt.sig.push({ e: now(), type: m.type, dst: String(m.dst || ''), k: m.payload && m.payload.metadata ? m.payload.metadata.k : null, named: NAMES_RE.test(String(d)) });
    } catch (e) { /* not ours */ }
    return wsSend.call(this, d);
  };
  pt.town = ${JSON.stringify(town)};
  // A different town is a different Wi-Fi: the same server, another network hash.
  if (pt.town === 'Berkeley') {
    await mp.ensureNetwork();
    mp.hash = 'beefcafe0042';
    mp.hashVia = 'town';
  } else await mp.ensureNetwork();
}
window.__pt.mp.setProfile({ name: ${JSON.stringify(name)}, colour: ${JSON.stringify(colour)}, chosen: true });
return { state: sim.state, map: sim.settings.map, name: window.__pt.mp.profile.name, hash: window.__pt.mp.hash, world: window.__pt.mp.worldBackend().id, card: !!document.querySelector('[data-act="multiplayer"]') };`;

const NAMES = ['Swift Falcon', 'Brave Otter', 'Sunny Puffin', 'Jolly Penguin'];
const COLOURS = ['#ff5a4f', '#58c6ff', '#ffd23f', '#4fd684'];
const TOWNS = ['Palo Alto', 'Palo Alto', 'Berkeley', 'Berkeley'];

/** What a tab knows about its lobby. */
const STATE = `
  const s = mp.session;
  const remotes = [...mp.remotes.players.values()];
  return {
    role: mp.role, n: mp.lobby && mp.lobby.n, world: !!(mp.lobby && mp.lobby.world), ready: mp.ready, reconnecting: mp.reconnecting, name: mp.profile.name, state: sim.state, map: sim.settings.map,
    count: s ? (mp.role === 'host' ? s.count : s.players.size + 1) : 0,
    remotes: remotes.length, drawn: remotes.filter((p) => p.visible && p.model && p.model.visible).length,
    tags: remotes.map((p) => p.name).sort(), ticks: pt.ticks, starts: pt.starts, err: pt.err || null, badge: pt.text('.mp-badge'),
  };`;

/** The lobby screen's two rows as the child sees them. */
const ROWS = `
  const card = (c) => ({ cls: c.className.replace('mp-lobby ', ''), isle: (c.querySelector('[data-mp-isle]') || {}).textContent, count: (c.querySelector('.mp-count') || {}).textContent,
    label: (c.querySelector('button') || {}).textContent, pic: !!c.querySelector('.mp-thumb canvas') });
  return {
    heads: [pt.text('[data-mp-wifihead]'), pt.text('[data-mp-worldhead]')],
    wifi: [...document.querySelectorAll('[data-mp-lobby]')].map(card),
    world: [...document.querySelectorAll('[data-mp-world]')].map(card),
  };`;

/* ---- the run --------------------------------------------------------------- */
const url = await serve();
log(`serving ${url}`);
const pages = [];
let exitCode = 1;
try {
  for (let i = 0; i < 4; i++) {
    const p = await openPage(`${url}?dev=1`, `tab${'ABCD'[i]}`);
    const r = await p.eval(PAGE(NAMES[i], COLOURS[i], TOWNS[i]).replace('NAMES_RE', `/${NAMES.join('|')}/`), 120);
    pages.push(p);
    log(`tab ${'ABCD'[i]} up as ${r.name} in ${TOWNS[i]} (Wi-Fi ${r.hash}, world lobbies via ${r.world}; ${r.state}, ${r.map})`);
  }
  const [A, B, C, D] = pages;
  const st = (p) => p.eval(STATE, 30);
  const rows = (p) => p.eval(ROWS, 30);

  // The lobby screen, through the main menu's card, as a child would.
  const opened = await Promise.all(pages.map((p) => p.eval(`
    const viaMenu = sim.state === 'menu' && pt.click('[data-act="multiplayer"]');
    if (!viaMenu) pt.mpMod.openMultiplayer(sim);
    const done = (sel) => [...document.querySelectorAll(sel)].filter((c) => /is-(empty|open|full)/.test(c.className)).length === 5;
    const r = await pt.until(() => done('[data-mp-lobby]') && done('[data-mp-world]'), 40000);
    return { viaMenu, ms: r.ms, ok: !!r.v };`, 60)));
  const r0 = await rows(A);
  ok('the lobby screen, in every tab: “Wi-Fi lobbies — people on your network” and “World lobbies — anyone, anywhere”, five each',
    opened.every((o) => o.ok) && /^Wi-Fi lobbies — people on your network/.test(r0.heads[0]) && /^World lobbies — anyone, anywhere/.test(r0.heads[1]) && r0.wifi.length === 5 && r0.world.length === 5,
    `${r0.heads.join(' | ')}; ready in ${opened.map((o) => o.ms).join('/')} ms`);
  ok('every card names its island, with its picture, before anybody is in it',
    r0.wifi.every((c) => c.isle && c.pic && c.count === '0/8') && r0.world.every((c) => c.isle && c.pic && c.count === '0/8'),
    `Wi-Fi: ${r0.wifi.map((c) => c.isle).join(', ')}; World: ${r0.world.map((c) => c.isle).join(', ')}`);
  M.islands = { wifi: r0.wifi.map((c) => c.isle), world: r0.world.map((c) => c.isle) };

  // Gentle: a minute's worth of what a tab with the screen open asks the matchmaking server (B, measured over 16 s).
  const g0 = await B.eval('return pt.now();');
  await sleep(16000);
  const asked = await B.eval(`const t = ${g0}; const s = pt.sig.filter((m) => m.e >= t); return { all: s.length, world: s.filter((m) => /^ifs-world-/.test(m.dst)).length, wifi: s.filter((m) => /-lobby-/.test(m.dst)).length, opens: 0 };`);
  const perMin = (n) => Math.round((n * 60) / 16);
  M.gentle = { worldPerMinute: perMin(asked.world), wifiPerMinute: perMin(asked.wifi), allPerMinute: perMin(asked.all) };
  // World: five lobbies, one question each every eight seconds — 37.5 a minute; the Wi-Fi row's five every 2.5 s is 120.
  ok('gentle on the public server: the world row asks each lobby once every eight seconds — under 45 questions a minute, a third of the Wi-Fi row’s',
    perMin(asked.world) <= 45 && perMin(asked.world) >= 20 && perMin(asked.world) * 2 < perMin(asked.wifi),
    `world ${perMin(asked.world)}/min, Wi-Fi ${perMin(asked.wifi)}/min, everything ${perMin(asked.all)}/min from one tab with the screen open`);
  // Back and Multiplayer, five times in three seconds, as a child does: no new connection, and no more questions than if it had stayed open.
  const reopen = await B.eval(`
    const t = pt.now();
    let shown = 5;
    for (let i = 0; i < 5; i++) {
      mp.back();
      await new Promise((r) => setTimeout(r, 200));
      pt.mpMod.openMultiplayer(sim);
      await new Promise((r) => setTimeout(r, 400));
      shown = Math.min(shown, [...document.querySelectorAll('[data-mp-world]')].filter((c) => /is-(empty|open|full)/.test(c.className)).length);
    }
    return { world: pt.sig.filter((m) => m.e >= t && /^ifs-world-/.test(m.dst)).length, wifi: pt.sig.filter((m) => m.e >= t && /-lobby-/.test(m.dst)).length, opens: pt.opens.filter((o) => o.e >= t).length, shown, secs: +((pt.now() - t) / 1000).toFixed(1) };`, 30);
  M.reopen = reopen;
  ok('Back and Multiplayer five times in a row: the World row is shown at once each time from what it saw, no new connection is opened, and no more is asked than if the screen had stayed open',
    reopen.shown === 5 && reopen.opens === 0 && reopen.world <= Math.ceil((reopen.secs * 1000) / 1600) + 1 && reopen.wifi <= 5 * Math.ceil(reopen.secs / 2.5) + 5,
    `${reopen.world} world and ${reopen.wifi} Wi-Fi questions, ${reopen.opens} new connections in ${reopen.secs} s (five opens of the screen); ${reopen.shown} of 5 world cards shown straight away every time`);

  // Each town's Lobby 3 is its own: A (Palo Alto) and C (Berkeley) both start one — on Aurora Fjords.
  const join = (p, sel) => p.eval(`
    const t0 = performance.now();
    pt.click('${sel}');
    const r = await pt.until(() => (mp.ready && mp.lobby && sim.state === 'flying') || (!mp.busy && !mp.lobby && document.querySelector('[data-mp-status]').textContent), 60000);
    return { ms: Math.round(performance.now() - t0), role: mp.role, world: !!(mp.lobby && mp.lobby.world), status: pt.text('[data-mp-status]'), map: sim.settings.map, badge: pt.text('.mp-badge') };`, 90);
  const menuMaps = await Promise.all([A, C].map((p) => p.eval('return mp.defaultMap("flight");')));
  const [ja, jc] = await Promise.all([join(A, '[data-mp-lobby-join="3"]'), join(C, '[data-mp-lobby-join="3"]')]);
  ok('Palo Alto and Berkeley each start their own Lobby 3 — both hosts, both on its island, Aurora Fjords, whatever their menus had',
    ja.role === 'host' && jc.role === 'host' && ja.map === 'fjord' && jc.map === 'fjord' && /Lobby 3 · Cloud Base/.test(ja.badge) && /On Aurora Fjords/.test(jc.badge),
    `A ${ja.role} on ${ja.map} in ${ja.ms} ms, C ${jc.role} on ${jc.map} in ${jc.ms} ms (menus: ${menuMaps.join(', ')})`);
  const [rb, rd] = await Promise.all([B, D].map((p) => p.eval(`
    await pt.until(() => mp.lobbyWatch && mp.lobbyWatch.lobbies[2].players === 1, 20000);
    return mp.lobbyWatch.lobbies.map((l) => l.n + ':' + l.players);`, 40)));
  ok('each town’s list shows its own Lobby 3 — one player each, not two', rb.join() === '1:0,2:0,3:1,4:0,5:0' && rd.join() === '1:0,2:0,3:1,4:0,5:0', `Palo Alto ${rb.join(' ')}; Berkeley ${rd.join(' ')}`);

  // The world is everybody's: D (Berkeley) starts World 3, B (Palo Alto) sees it and joins.
  const jd = await join(D, '[data-mp-world-join="3"]');
  ok('D in Berkeley starts World 3 — on its island, Gateway International', jd.role === 'host' && jd.world && jd.map === 'gateway' && /World 3 · Skyline Airport/.test(jd.badge),
    `${jd.role} on ${jd.map} in ${jd.ms} ms; ${jd.badge}`);
  const seenB = await B.eval(`
    const r = await pt.until(() => mp.worldWatch && mp.worldWatch.lobbies[2].state === 'open', 30000);
    const c = document.querySelector('[data-mp-world="3"]');
    return { ok: !!r.v, ms: r.ms, card: c ? c.textContent.replace(/\\s+/g, ' ').trim() : '' };`, 45);
  ok('B in Palo Alto sees it in the World row: 1/8, on Gateway International', seenB.ok && /1\/8/.test(seenB.card) && /Gateway International/.test(seenB.card), `${seenB.card} (${seenB.ms} ms)`);
  const jb = await join(B, '[data-mp-world-join="3"]');
  ok('B joins it: Palo Alto and Berkeley in one lobby, on Gateway International', jb.role === 'client' && jb.world && jb.map === 'gateway' && /World 3 · Skyline Airport · 2\/8/.test(jb.badge),
    `${jb.ms} ms; ${jb.badge}`);
  await Promise.all([B, D].map((p, i) => p.eval(`pt.airborne(${i ? 200 : -200}, 0, 90); return true;`)));
  let sw = [];
  for (let k = 0; k < 20; k++) {
    await sleep(1000);
    sw = await Promise.all([B, D].map(st));
    if (sw.every((s) => s.count === 2 && s.remotes === 1 && s.drawn === 1)) break;
  }
  const links = await Promise.all([B, D].map((p) => p.eval(`
    const s = mp.session;
    const l = mp.role === 'host' ? [...s.players.values()][0].link : s.link;
    return { share: l.share, ice: l.pc && l.pc.getConfiguration ? l.pc.getConfiguration().iceServers.length : -1, sent: l.candidates.sent, kept: l.candidates.kept };`)));
  ok('each sees the other’s aeroplane with their username on it, over a cross-network link (STUN asked, public IPv4 only)',
    sw.every((s) => s.remotes === 1 && s.drawn === 1) && sw[0].tags[0] === NAMES[3] && sw[1].tags[0] === NAMES[1] && links.every((l) => l.share === 'v4' && l.ice > 0),
    `${sw.map((s) => `${s.name} sees ${s.tags.join(',')}`).join('; ')}; links ${links.map((l) => `${l.share} ice ${l.ice} sent ${l.sent} kept ${l.kept}`).join(' / ')}`);
  const wifiNow = await Promise.all([A, C].map(st));
  ok('meanwhile each town’s Lobby 3 is untouched: one host in each, nobody from the other town', wifiNow.every((s) => s.role === 'host' && s.n === 3 && !s.world && s.count === 1),
    wifiNow.map((s) => `${s.name}: ${s.count}`).join(', '));

  // The world lobby's host closes the tab: it re-forms round B, on the same island, B still flying.
  const before = await B.eval('return { starts: pt.starts };');
  log(`closing the world lobby host's tab (${D.name})`);
  const tClose = Date.now();
  await D.close();
  let bAfter = null;
  for (let k = 0; k < 80; k++) {
    await sleep(500);
    bAfter = await st(B);
    if (bAfter.role === 'host' && !bAfter.reconnecting && bAfter.n === 3 && bAfter.world) break;
  }
  await sleep(Math.max(0, tClose + 4500 - Date.now()));
  const evB = await B.eval(`return { ev: pt.lobbyEv.filter((e) => e.e >= ${tClose - 50}), own: pt.own.filter((o) => o.e > ${tClose} && o.e < ${tClose + 4000}).map((o) => [o.e, o.x, o.z, o.st]), starts: pt.starts };`);
  const backAt = (evB.ev.find((e) => e.type === 'role') || {}).e;
  let moved = 0;
  let maxGap = 0;
  for (let k = 1; k < evB.own.length; k++) {
    moved += Math.hypot(evB.own[k][1] - evB.own[k - 1][1], evB.own[k][2] - evB.own[k - 1][2]);
    maxGap = Math.max(maxGap, evB.own[k][0] - evB.own[k - 1][0]);
  }
  M.worldReformMs = backAt ? Math.round(backAt - tClose) : null;
  ok('the world lobby’s host closes the tab: it re-forms round B, still World 3, on the same island',
    bAfter && bAfter.role === 'host' && bAfter.world && bAfter.n === 3 && bAfter.map === 'gateway' && /World 3 · Skyline Airport/.test(bAfter.badge),
    `B hosts it ${M.worldReformMs} ms after the close; ${bAfter && bAfter.badge}`);
  ok('and B’s flight never stopped: the game ran on, the aeroplane kept moving, no island was reloaded',
    evB.own.length >= 40 && maxGap < 600 && moved > 100 && evB.starts === before.starts, `${Math.round(moved)} m in 4 s, ${evB.own.length} frames, gap ≤${Math.round(maxGap)} ms, ${evB.starts - before.starts} reloads`);
  const cSees = await C.eval(`
    mp.leave('left');
    await new Promise((r) => setTimeout(r, 500));
    pt.mpMod.openMultiplayer(sim);
    const r = await pt.until(() => mp.worldWatch && mp.worldWatch.lobbies[2].state === 'open' && mp.worldWatch.lobbies[2].players === 1, 30000);
    return { ok: !!r.v, card: pt.text('[data-mp-world="3"]') };`, 60);
  ok('and Berkeley, looking again, finds World 3 still there with B in it', cSees.ok && /1\/8/.test(cSees.card), cSees.card);

  // Names on the matchmaking server: none, from any tab.
  const live = [A, B, C];
  const named = await Promise.all(live.map((p) => p.eval('return { sent: pt.sig.length, named: pt.sig.filter((m) => m.named).length };')));
  ok('no username ever went through the signaling server', named.every((x) => x.named === 0), `${named.reduce((a, x) => a + x.sent, 0)} messages, ${named.reduce((a, x) => a + x.named, 0)} with a name`);
  const errs = await Promise.all(live.map((p) => p.eval('return pt.err;')));
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
