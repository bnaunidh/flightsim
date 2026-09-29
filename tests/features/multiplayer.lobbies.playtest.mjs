/**
 * The lobby playtest: eight players in one lobby, in eight real tabs of ONE
 * headless Chrome, over tools/lan-server.py --local — plus a ninth tab that
 * looks at the list and is turned away.
 *
 *   node tests/features/multiplayer.lobbies.playtest.mjs
 *     --url=http://127.0.0.1:9084/   a LAN server already serving the game (else one is started on a free port)
 *     --json=<file>                  write the numbers there too
 *
 * Every tab runs the game in real time — main.js's own update(dt), thirty
 * times a second, the draw call stubbed except where the frame cost is
 * measured — and uses the real lobby screen, the real WebRTC stack and the
 * real signaling server. Measured, not looked at:
 *
 *   - all eight in one lobby, each seeing the other seven (their aeroplanes
 *     drawn, their usernames on the tags);
 *   - a username already in the lobby refused, with the one-tap fix;
 *   - two joining at once with the same username: one in, one refused;
 *   - a ninth told the lobby is full and offered another;
 *   - all five lobbies listed with the right counts, twice;
 *   - the host's TAB CLOSED: how long until the lobby has re-formed round
 *     the next in line, and that nobody's flight stopped meanwhile (the
 *     game's own update ran on, the aeroplane kept moving, no map reload);
 *   - the cost of a frame with seven remote aircraft, drawn for real.
 *
 * Holds one of the shared headless-Chrome slots (the same lock as
 * .claude/devtools/cdp.mjs) for the one Chrome all nine tabs live in, with
 * background throttling off: nine players are nine computers, each with its
 * game in front.
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
const PAGE = (name, colour) => `
if (!window.__pt) {
  window.requestAnimationFrame = () => 0;
  const s = sim;
  const THREE = await import('/src/vendor/three.module.js');
  const mpMod = await import('/src/features/multiplayer.js');
  const pt = (window.__pt = { THREE, mpMod, mp: mpMod.multiplayer, realRender: s.renderer.render.bind(s.renderer), ticks: 0, gaps: [], own: [], toasts: [], lobbyEv: [], starts: 0 });
  s.renderer.render = () => {};
  const origin = performance.timeOrigin;
  const now = () => origin + performance.now();
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
    if (type === 'reconnecting' || type === 'role' || type === 'out') pt.lobbyEv.push({ e: now(), type, a0: typeof args[0] === 'string' ? args[0] : null, ms: args[2] && args[2].ms });
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
  pt.sig = [];
  const wsSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try { const m = JSON.parse(d); if (m.type !== 'HEARTBEAT') pt.sig.push({ type: m.type, named: NAMES_RE.test(String(d)) }); } catch (e) { /* not ours */ }
    return wsSend.call(this, d);
  };
}
window.__pt.mp.setProfile({ name: ${JSON.stringify(name)}, colour: ${JSON.stringify(colour)}, chosen: true });
return { state: sim.state, map: sim.settings.map, name: window.__pt.mp.profile.name, card: !!document.querySelector('[data-act="multiplayer"]') };`;

const NAMES = ['Swift Falcon', 'Brave Otter', 'Sunny Puffin', 'Jolly Penguin', 'Clever Koala', 'Mighty Moose', 'Gentle Lark', 'Happy Hedgehog', 'Plucky Puffin'];
const COLOURS = ['#ff5a4f', '#ff9f1c', '#ffd23f', '#4fd684', '#2ec4b6', '#58c6ff', '#a78bfa', '#ff7eb6', '#ff5a4f'];

/** What a tab knows about its lobby. */
const STATE = `
  const s = mp.session;
  const remotes = [...mp.remotes.players.values()];
  return {
    role: mp.role, n: mp.lobby && mp.lobby.n, ready: mp.ready, reconnecting: mp.reconnecting, name: mp.profile.name, state: sim.state, map: sim.settings.map,
    count: s ? (mp.role === 'host' ? s.count : s.players.size + 1) : 0,
    remotes: remotes.length, drawn: remotes.filter((p) => p.visible && p.model && p.model.visible).length,
    tags: remotes.map((p) => p.name).sort(), ticks: pt.ticks, starts: pt.starts, err: pt.err || null,
  };`;

/* ---- the run --------------------------------------------------------------- */
const url = await serve();
log(`serving ${url}`);
const pages = [];
let exitCode = 1;
try {
  // Nine tabs, one after another: a game loading is the heaviest thing a tab does.
  for (let i = 0; i < 9; i++) {
    const p = await openPage(`${url}?dev=1`, `tab${i + 1}`);
    const r = await p.eval(PAGE(NAMES[i], COLOURS[i]).replace('NAMES_RE', `/${NAMES.join('|')}/`), 120);
    pages.push(p);
    log(`tab${i + 1} up as ${r.name} (${r.state}, ${r.map})`);
  }
  const [A, B, C, D, E, F, G, H, I] = pages;
  const eight = pages.slice(0, 8);
  const all = (fn) => Promise.all(eight.map(fn));
  const st = (p) => p.eval(STATE, 30);

  // The lobby screen, through the main menu's card, as a child would.
  const opened = await Promise.all(pages.map((p) => p.eval(`
    const viaMenu = sim.state === 'menu' && pt.click('[data-act="multiplayer"]');
    if (!viaMenu) pt.mpMod.openMultiplayer(sim);
    const r = await pt.until(() => document.querySelectorAll('.mp-lobby.is-empty, .mp-lobby.is-open, .mp-lobby.is-full').length === 5, 30000);
    return { viaMenu, screen: !!document.querySelector('[data-screen="lobbies"]:not([hidden])'), ms: r.ms, list: [...document.querySelectorAll('.mp-lobby')].map((c) => c.className.replace('mp-lobby is-', '')) };`, 60)));
  ok('the main menu’s Multiplayer card opens the lobby screen in every tab, with five lobbies listed', opened.every((o) => o.viaMenu && o.screen && o.list.length === 5),
    opened.map((o) => `${o.viaMenu ? 'menu' : 'dev'}:${o.list.join('/')}`)[0]);

  // A starts lobby 3 on its own island.
  const join = (p, n) => p.eval(`
    const t0 = performance.now();
    pt.click('[data-mp-lobby-join="${n}"]');
    const r = await pt.until(() => (mp.ready && mp.lobby && sim.state === 'flying') || (!mp.busy && !mp.lobby && document.querySelector('[data-mp-status]').textContent), 60000);
    return { ms: Math.round(performance.now() - t0), role: mp.role, status: pt.text('[data-mp-status]'), offer: pt.text('[data-mp-offer-go]'), offerShown: !document.querySelector('[data-mp-offer]').hidden, map: sim.settings.map };`, 90);
  const ja = await join(A, 3);
  ok('the first player into empty Lobby 3 starts it — hosting without being asked', ja.role === 'host', `${ja.ms} ms, ${ja.role}, ${ja.map}`);
  M.joinMs = [ja.ms];
  M.lobbyMap = ja.map;

  // B to F join one after another.
  for (const p of [B, C, D, E, F]) {
    const r = await join(p, 3);
    M.joinMs.push(r.ms);
    if (r.role !== 'client') log(`${p.name} did not join: ${r.status}`);
  }

  // A username already in the lobby: I tries as Swift Falcon.
  await I.eval(`mp.setProfile({ name: 'Swift Falcon', chosen: true }); pt.mpMod.multiplayer.lobbyScreen.refresh(); return true;`);
  const dup = await join(I, 3);
  ok('a username already in the lobby is refused, in words a child gets, with a free one offered',
    dup.role === null && /Someone in Lobby 3 is already called Swift Falcon — change your number or pick another name\./.test(dup.status) && dup.offerShown && /^Use Swift Falcon \d+ and join$/.test(dup.offer),
    `${dup.status} [${dup.offer}]`);
  await I.eval(`mp.setProfile({ name: ${JSON.stringify(NAMES[8])}, chosen: true }); document.querySelector('[data-mp-offer]').hidden = true; mp.lobbyScreen.status(''); return true;`);

  // G and H, both as Radiant Robin, at the same moment.
  await Promise.all([G, H].map((p) => p.eval(`mp.setProfile({ name: 'Radiant Robin', chosen: true }); mp.lobbyScreen.refresh(); return true;`)));
  const twins = await Promise.all([join(G, 3), join(H, 3)]);
  const inTwin = twins.filter((t) => t.role === 'client').length;
  const outTwin = twins.findIndex((t) => t.role !== 'client');
  ok('two joining at once with the same username: one is in, the other is refused and offered another',
    inTwin === 1 && outTwin >= 0 && /already called Radiant Robin/.test(twins[outTwin].status) && twins[outTwin].offerShown, twins.map((t) => `${t.role}: ${t.status || ''}`).join(' | '));
  // The one refused takes the offer — one tap.
  const loser = [G, H][outTwin];
  const tap = await loser.eval(`
    const t0 = performance.now();
    pt.click('[data-mp-offer-go]');
    const r = await pt.until(() => mp.ready && mp.lobby && sim.state === 'flying', 60000);
    return { ok: !!r.v, ms: Math.round(performance.now() - t0), name: mp.profile.name, role: mp.role };`, 90);
  ok('and the one tap on the offer takes the free username and joins', tap.ok && /^Radiant Robin \d+$/.test(tap.name) && tap.role === 'client', `${tap.name}, ${tap.ms} ms`);
  M.joinMs.push(...twins.filter((t) => t.role === 'client').map((t) => t.ms), tap.ms);

  // Eight: everybody sees everybody.
  await sleep(3000);
  let states = await Promise.all(eight.map(st));
  for (let k = 0; k < 20 && !states.every((s) => s.count === 8 && s.remotes === 7 && s.drawn === 7); k++) {
    await sleep(1000);
    states = await Promise.all(eight.map(st));
  }
  const allNames = states.map((s) => s.name);
  ok('all eight in Lobby 3, every one seeing the other seven drawn, with their usernames on the tags',
    states.every((s) => s.n === 3 && s.count === 8 && s.remotes === 7 && s.drawn === 7 && s.tags.join('|') === allNames.filter((x) => x !== s.name).sort().join('|')),
    states.map((s) => `${s.name}:${s.count}/${s.drawn}`).join(' '));
  ok('one host, seven players, all on the lobby’s island', states.filter((s) => s.role === 'host').length === 1 && states.every((s) => s.map === M.lobbyMap), states.map((s) => s.role[0]).join(''));
  ok('eight different usernames', new Set(allNames).size === 8, allNames.join(', '));

  // Everybody airborne, spread out, flying straight.
  await Promise.all(eight.map((p, i) => p.eval(`pt.airborne(${-600 + i * 150}, ${i % 2 ? 200 : -200}, 90); return true;`)));
  await sleep(4000);

  // A ninth: the list says full, joining says full, and another lobby is offered.
  const nine = await I.eval(`
    await pt.until(() => mp.lobbyWatch && mp.lobbyWatch.lobbies[2].state === 'full', 15000);
    const list = mp.lobbyWatch.lobbies.map((l) => l.n + ':' + l.players + (l.state === 'full' ? ' full' : ''));
    const card = pt.text('[data-mp-lobby="3"]');
    pt.click('[data-mp-lobby-join="3"]');
    return { list, card };`, 60);
  ok('the list: all five lobbies with the right counts — Lobby 3 8/8 and full, the rest empty', nine.list.join(',') === '1:0,2:0,3:8 full,4:0,5:0', `${nine.list.join(', ')} / ${nine.card}`);
  const ninth = await I.eval(`
    // The full card's button already points at the lobby with room; ask for Lobby 3 itself, as a child tapping fast would.
    await mp.joinLobby(3);
    return { role: mp.role, status: pt.text('[data-mp-status]'), offer: pt.text('[data-mp-offer-go]'), shown: !document.querySelector('[data-mp-offer]').hidden };`, 90);
  ok('a ninth is told kindly that Lobby 3 is full, and offered the emptiest other one',
    ninth.role === null && /Lobby 3 is full — eight players is the most\. Lobby \d has room\./.test(ninth.status) && ninth.shown && /Join Lobby \d instead/.test(ninth.offer) && /Full — join Lobby \d/.test(nine.card),
    `${ninth.status} [${ninth.offer}]`);
  ok('and the full card itself offers the other lobby', /Full — join Lobby \d/.test(nine.card), nine.card);

  // Frame cost with seven remote aircraft, drawn for real, in B.
  const cost = await B.eval(`
    const s = sim;
    const info = s.renderer.info;
    const drawOnce = () => { const t = performance.now(); pt.realRender(s.scene, s.camera); return { ms: performance.now() - t, calls: info.render.calls, tris: info.render.triangles }; };
    const hide = () => { for (const p of mp.remotes.players.values()) { if (p.model) p.model.visible = false; if (p.tag) p.tag.sprite.visible = false; } };
    for (let i = 0; i < 10; i++) { mp.frame(1 / 30); drawOnce(); }
    const visible = [...mp.remotes.players.values()].filter((p) => p.visible).length;
    /*
     * Frames with the seven drawn and frames with them hidden, taken turn
     * about so both see the same machine: this Mac's CPU is shared and the
     * renderer here is software, so only the difference means anything —
     * and the draw calls and triangles, which do not depend on either.
     */
    const mpf = [], withD = [], without = [];
    for (let i = 0; i < 120; i++) {
      const t = performance.now();
      mp.frame(1 / 30);
      mpf.push(performance.now() - t);
      if (i % 2) { hide(); without.push(drawOnce()); } else withD.push(drawOnce());
      await new Promise((r) => setTimeout(r, 25));
    }
    const med = (a) => { const b = a.slice().sort((x, y) => x - y); return +b[Math.floor(b.length / 2)].toFixed(2); };
    const p95 = (a) => +a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.95)].toFixed(2);
    return {
      visible, mpMedian: med(mpf), mpP95: p95(mpf),
      drawWith: med(withD.map((d) => d.ms)), drawWithout: med(without.map((d) => d.ms)),
      callsWith: withD[0].calls, callsWithout: without[0].calls, trisWith: withD[0].tris, trisWithout: without[0].tris,
    };`, 180);
  M.frameCost = cost;
  ok('frame cost with seven remote aircraft: the multiplayer update, and a real draw with and without them', cost.visible === 7 && cost.mpMedian < 8,
    `${cost.visible} visible; multiplayer update median ${cost.mpMedian} ms (p95 ${cost.mpP95}); draw median ${cost.drawWith} ms with them vs ${cost.drawWithout} without (software renderer); `
    + `${cost.callsWith - cost.callsWithout} more draw calls (${cost.callsWith} vs ${cost.callsWithout}), ${cost.trisWith - cost.trisWithout} more triangles`);

  // The host's tab closes.
  states = await Promise.all(eight.map(st));
  const hostTab = eight[states.findIndex((s) => s.role === 'host')];
  const rest = eight.filter((p) => p !== hostTab);
  const before = await Promise.all(rest.map((p) => p.eval('return { ticks: pt.ticks, starts: pt.starts, n: pt.own.length };')));
  log(`closing the host's tab (${hostTab.name})`);
  const tClose = Date.now();
  await hostTab.close();
  let after = [];
  for (let k = 0; k < 60; k++) {
    await sleep(500);
    after = await Promise.all(rest.map(st));
    if (after.every((s) => s.n === 3 && !s.reconnecting && s.count === 7 && s.remotes === 6)) break;
  }
  const reformed = after.every((s) => s.n === 3 && !s.reconnecting && s.count === 7);
  // The flight is judged over the same four seconds from the close in every tab, however quick the re-forming was.
  const FLIGHT_MS = 4000;
  await sleep(Math.max(0, tClose + FLIGHT_MS + 500 - Date.now()));
  const evs = await Promise.all(rest.map((p) => p.eval(`return { ev: pt.lobbyEv, gaps: pt.gaps, own: pt.own.filter((o) => o.e > ${tClose - 1000}).map((o) => [o.e, o.x, o.y, o.z, o.st]), ticks: pt.ticks, starts: pt.starts };`)));
  const heard = evs.map((x) => (x.ev.find((e) => e.type === 'reconnecting' && e.e >= tClose - 50) || {}).e);
  const back = evs.map((x) => (x.ev.find((e) => e.type === 'role' && e.e >= tClose - 50) || {}).e);
  const lastBack = Math.max(...back.filter(Boolean));
  M.reform = {
    heardMs: heard.map((e) => (e ? Math.round(e - tClose) : null)),
    backMs: back.map((e) => (e ? Math.round(e - tClose) : null)),
    allBackMs: Number.isFinite(lastBack) ? Math.round(lastBack - tClose) : null,
  };
  ok('the host’s tab closed: Lobby 3 re-formed by itself, one host, seven players, the same island',
    reformed && after.filter((s) => s.role === 'host').length === 1 && after.every((s) => s.map === M.lobbyMap),
    `every player back ${M.reform.allBackMs} ms after the close; heard ${M.reform.heardMs.join('/')} ms; back ${M.reform.backMs.join('/')} ms`);
  await sleep(4000);
  after = await Promise.all(rest.map(st));
  ok('and every one of them sees the other six again', after.every((s) => s.remotes === 6 && s.drawn === 6), after.map((s) => `${s.name}:${s.drawn}`).join(' '));
  // Nobody's flight stopped: the game's own update ran all through, the aeroplane kept moving, and no map was reloaded.
  const flights = evs.map((x, i) => {
    const own = x.own.filter((o) => o[0] >= tClose && o[0] <= tClose + FLIGHT_MS);
    let maxGap = 0;
    let moved = 0;
    for (let k = 1; k < own.length; k++) {
      maxGap = Math.max(maxGap, own[k][0] - own[k - 1][0]);
      moved += Math.hypot(own[k][1] - own[k - 1][1], own[k][3] - own[k - 1][3]);
    }
    return { samples: own.length, maxGap: Math.round(maxGap), moved: Math.round(moved), flying: own.every((o) => o[4] === 'flying'), reloads: x.starts - before[i].starts };
  });
  M.flights = flights;
  // At about 55 m/s, four seconds is some 200 m; half of that and no pause over 0.6 s is a flight that did not stop.
  ok('nobody’s flight stopped: the game ran on in every tab, every aeroplane kept moving, no island was reloaded',
    flights.every((f) => f.samples >= 40 && f.maxGap < 600 && f.moved > 100 && f.flying && f.reloads === 0),
    `over the ${FLIGHT_MS / 1000} s after the close: ${flights.map((f) => `${f.moved} m, ${f.samples} frames, gap ≤${f.maxGap} ms, ${f.reloads} reloads`).join(' | ')}`);

  // H (or whoever is last in the list) leaves Lobby 3 and starts Lobby 5; the list shows both.
  const mover = rest[rest.length - 1];
  const moved = await mover.eval(`
    mp.leave('left');
    await new Promise((r) => setTimeout(r, 500));
    await mp.joinLobby(5);
    return { role: mp.role, n: mp.lobby && mp.lobby.n, map: sim.settings.map };`, 90);
  const list2 = await I.eval(`
    await pt.until(() => mp.lobbyWatch && mp.lobbyWatch.lobbies[4].players === 1 && mp.lobbyWatch.lobbies[2].players === 6, 20000);
    return mp.lobbyWatch.lobbies.map((l) => l.n + ':' + l.players);`, 60);
  ok('one leaves Lobby 3 and starts Lobby 5: the list shows 3:6 and 5:1', moved.role === 'host' && moved.n === 5 && list2.join(',') === '1:0,2:0,3:6,4:0,5:1', `${list2.join(', ')}`);

  // The new host's tab vanishes without a goodbye: its connections cut, its lobby socket gone, its game stopped — no 'close' sent.
  const in3 = rest.filter((p) => p !== mover);
  const st3 = await Promise.all(in3.map(st));
  const host2 = in3[st3.findIndex((s) => s.role === 'host')];
  const rest2 = in3.filter((p) => p !== host2);
  const tVanish = Date.now();
  await host2.eval(`
    clearInterval(pt.timer);
    const m = mp.lobby;
    m.left = true;
    const h = m.session;
    h.closed = true;
    for (const p of h.players.values()) p.link.pc.close();
    if (m.sig && m.sig.ws) m.sig.ws.close();
    return true;`);
  let after2 = [];
  for (let k = 0; k < 60; k++) {
    await sleep(250);
    after2 = await Promise.all(rest2.map(st));
    if (after2.every((s) => s.n === 3 && !s.reconnecting && s.count === rest2.length && s.remotes === rest2.length - 1)) break;
  }
  const ev2 = await Promise.all(rest2.map((p) => p.eval(`return pt.lobbyEv.filter((e) => e.e >= ${tVanish - 50});`)));
  const back2 = ev2.map((list) => (list.find((e) => e.type === 'role') || {}).e);
  const heard2 = ev2.map((list) => (list.find((e) => e.type === 'reconnecting') || {}).e);
  M.vanish = {
    heardMs: heard2.map((e) => (e ? Math.round(e - tVanish) : null)),
    backMs: back2.map((e) => (e ? Math.round(e - tVanish) : null)),
    why: ev2.map((list) => (list.find((e) => e.type === 'reconnecting') || {}).a0),
  };
  ok('the next host’s tab vanishes without a goodbye: the lobby re-forms again, round the next in line',
    after2.every((s) => s.n === 3 && !s.reconnecting && s.count === rest2.length) && after2.filter((s) => s.role === 'host').length === 1,
    `${rest2.length} players back ${Math.max(...M.vanish.backMs.filter((x) => x != null))} ms after; heard ${M.vanish.heardMs.join('/')} ms (${M.vanish.why.join('/')})`);

  // Names on the matchmaking server: none, from any tab.
  const named = await Promise.all(pages.filter((p) => p !== hostTab).map((p) => p.eval('return { sent: pt.sig.length, named: pt.sig.filter((m) => m.named).length };')));
  ok('no username ever went through the signaling server', named.every((x) => x.named === 0), `${named.reduce((a, x) => a + x.sent, 0)} messages, ${named.reduce((a, x) => a + x.named, 0)} with a name`);
  const errs = await Promise.all(pages.filter((p) => p !== hostTab).map((p) => p.eval('return pt.err;')));
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
