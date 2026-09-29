/**
 * The two-computer multiplayer playtest, in two headless Chrome pages.
 *
 *   node tests/features/multiplayer.playtest.mjs              # signaling by tools/lan-server.py --local: no internet needed, repeatable
 *   node tests/features/multiplayer.playtest.mjs --public     # signaling by the public PeerJS server (needs the internet)
 *     --url=http://127.0.0.1:8931/   a copy of the game already being served (a LAN server's address, or any other)
 *     --shots=<dir>                  save the multiplayer screen and a remote aeroplane in flight as PNGs
 *     --opener=<module.mjs>          open pages with that module's openPage(url) instead of the Chrome launcher below
 *
 * Page A hosts through the Multiplayer screen and page B finds it in the LAN
 * list and joins through the same screen, as two children at two Chromebooks
 * would. Both run the game in real time — main.js's own update(dt) once a
 * frame, the draw call stubbed because a headless page has nobody to show it
 * to — and the things a child would notice are MEASURED rather than looked
 * at: where B draws A against where A really was, how long a join takes, how
 * soon a player hears that the host has gone, and what each is told.
 *
 * What the node test (multiplayer.mjs) cannot see and this can: the real
 * WebRTC stack between two pages, the real screen and HUD, the game's own
 * models and map changes, and closing a tab.
 *
 * Needs Google Chrome (CHROME=/path/to/chrome to point elsewhere) and python3.
 * Installs nothing. Works on a checkout whose main menu has no Multiplayer
 * button yet: it then opens the screen the way the Dev mode button does.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { candidateAllowed } from '../../src/features/multiplayer/link.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d = null) => {
  const a = process.argv.find((x) => x === `--${k}` || x.startsWith(`--${k}=`));
  if (!a) return d;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};
const PUBLIC = !!arg('public');
const SHOTS = arg('shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** ROT13, so the join codes the fourth review got through are not spelt out in this file. */
const r13 = (s) => s.replace(/[a-z]/gi, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); });
/** What the modified host below says its code is: the first two codes the fourth review got onto a joiner's screen. */
const REVIEW_CODES = ['CUPXE', 'EQFXA'].map(r13);
/** What B reads off its own screen: its session's code, its badge, and its player list. */
const seenByB = `
  await pt.until(() => (document.querySelector('[data-mp-badge-text]') || {}).textContent, 5000);
  await new Promise((r) => setTimeout(r, 700));
  pt.key('Tab', true);
  await new Promise((r) => setTimeout(r, 400));
  const l = document.querySelector('[data-mp-list]');
  const out = { code: mp.server && mp.server.code, list: l.textContent.replace(/\\s+/g, ' ').trim(), badge: (document.querySelector('[data-mp-badge-text]') || {}).textContent || '' };
  pt.key('Tab', false);
  return out;
`;
const t0 = Date.now();
const log = (s) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const R = [];
const M = {};
const ok = (name, pass, detail = '') => {
  R.push({ name, pass: !!pass, detail });
  log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return pass;
};

/* ------------------------------------------------------------------ */
/* Serving the game, and a browser                                     */
/* ------------------------------------------------------------------ */

const children = [];
process.on('exit', () => children.forEach((c) => { try { c.kill(); } catch (e) { /* gone */ } }));

async function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
    s.on('error', rej);
  });
}

async function serve() {
  if (arg('url')) return arg('url');
  const port = await freePort();
  // The LAN server answers /lan/info, so the game uses it for matchmaking; a plain server does not, so it uses the public one.
  const cmd = PUBLIC
    ? ['python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', ROOT]]
    : ['python3', [join(ROOT, 'tools', 'lan-server.py'), String(port), '--local']];
  const child = spawn(cmd[0], cmd[1], { stdio: 'ignore' });
  children.push(child);
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return url;
    } catch (e) {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error(`could not serve the game on ${url}`);
}

/**
 * A minimal page opener over the Chrome DevTools protocol, with Node's own
 * WebSocket. Two players are two computers, each with its game in front, so
 * background-tab throttling is switched off: without that the second page's
 * timers ran once a second and its game at a ninth of real time.
 */
function builtInOpener() {
  const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  let chrome = null;
  let open = 0;
  async function launch() {
    if (chrome) return chrome;
    if (!existsSync(CHROME)) throw new Error(`no Chrome at ${CHROME} (set CHROME=)`);
    const dir = mkdtempSync(join(tmpdir(), 'ifs-mp-chrome-'));
    const proc = spawn(CHROME, [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run',
      '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--mute-audio',
      '--enable-unsafe-swiftshader', '--window-size=1280,800', '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      'about:blank',
    ], { stdio: 'ignore' });
    children.push(proc);
    const portFile = join(dir, 'DevToolsActivePort');
    for (let i = 0; i < 200 && !existsSync(portFile); i++) await sleep(100);
    if (!existsSync(portFile)) throw new Error('Chrome did not start');
    chrome = { proc, dir, port: readFileSync(portFile, 'utf8').split('\n')[0].trim() };
    process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* in use */ } });
    return chrome;
  }
  return async function openPage(url, { timeoutS = 180 } = {}) {
    const c = await launch();
    const target = await (await fetch(`http://127.0.0.1:${c.port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    open++;
    let id = 0;
    const waiting = new Map();
    const logs = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && waiting.has(m.id)) {
        const { res, rej } = waiting.get(m.id);
        waiting.delete(m.id);
        if (m.error) rej(new Error(m.error.message));
        else res(m.result);
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
        sleep(ms).then(() => { throw new Error(`timed out after ${ms / 1000} s`); }),
      ]);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url });
    // Settled: the game is up, the service worker (if any) controls the page and has reloaded it, and 2 s have passed like that.
    let origin = null;
    let since = 0;
    for (const tEnd = Date.now() + timeoutS * 1000; ;) {
      const st = await raw(`JSON.stringify([!!window.__sim, performance.timeOrigin, document.readyState,
        !('serviceWorker' in navigator) || !!navigator.serviceWorker.controller])`, 5000).catch(() => null);
      const [has, o, rs, controlled] = st ? JSON.parse(st) : [false, null, '', false];
      if (has && rs === 'complete' && controlled && o === origin) {
        if (Date.now() - since > 2000) break;
      } else {
        origin = has ? o : null;
        since = Date.now();
      }
      if (Date.now() > tEnd) throw new Error(`the game never settled at ${url}\n${logs.join('\n')}`);
      await sleep(300);
    }
    return {
      logs,
      eval: (body, secs = timeoutS) => raw(`(async () => { const sim = window.__sim; ${body}\n})()`, secs * 1000),
      async shot(file) {
        const { data } = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(file, Buffer.from(data, 'base64'));
      },
      async close() {
        await fetch(`http://127.0.0.1:${c.port}/json/close/${target.id}`).catch(() => {});
        try { ws.close(); } catch (e) { /* closed */ }
        if (--open <= 0 && chrome) { chrome.proc.kill(); chrome = null; }
      },
    };
  };
}

/* ------------------------------------------------------------------ */
/* What runs inside each page                                          */
/* ------------------------------------------------------------------ */

/*
 * The game's own frame loop is replaced by one that does what main.js loop()
 * does — update(dt) once a frame with the elapsed time, clamped at 0.25 s —
 * without drawing. An earlier version of this harness stepped in 1/60 s
 * pieces, and a snapshot sent from the first piece of a late frame was
 * stamped with the frame's time but carried the position from before the
 * rest of it: up to five metres of error that was the harness's, not the
 * game's.
 */
const PAGE = `
if (!window.__pt) {
  window.requestAnimationFrame = () => 0;
  const s = sim;
  const THREE = await import('/src/vendor/three.module.js');
  const mpMod = await import('/src/features/multiplayer.js');
  const pt = (window.__pt = { THREE, mpMod, mp: mpMod.multiplayer, render: s.renderer.render.bind(s.renderer), own: [], drawn: [], ticks: 0, slow: 0, paused: false, toasts: [] });
  s.renderer.render = () => {};
  const origin = performance.timeOrigin;
  if (s.hud && s.hud.notify) {
    const n = s.hud.notify.bind(s.hud);
    s.hud.notify = (html, kind, secs) => {
      pt.toasts.push({ e: origin + performance.now(), text: String(html).replace(/<[^>]+>/g, ''), kind });
      return n(html, kind, secs);
    };
  }
  let last = performance.now();
  pt.timer = setInterval(() => {
    const t0 = performance.now();
    const dt = Math.min(0.25, (t0 - last) / 1000);
    last = t0;
    if (pt.paused) return;
    try { s.update(dt); } catch (err) { pt.err = String(err && err.stack || err).slice(0, 400); }
    const e = origin + performance.now();
    const me = s.mode === 'drive' && s.vehicle ? s.vehicle.pos : s.aircraft && s.aircraft.pos;
    if (me && s.state === 'flying') pt.own.push({ e, x: me.x, y: me.y, z: me.z });
    for (const p of pt.mp.remotes.players.values()) {
      if (!p.visible || !p.sample || !p.model) continue;
      const at = p.drawn || p.sample.pos;
      pt.drawn.push({ e, id: p.id, x: at.x, y: at.y, z: at.z, rx: p.sample.pos.x, rz: p.sample.pos.z, dt, n: p.track.snaps.length, delay: p.track.delayMs, ex: !!p.sample.extrapolated });
    }
    while (pt.own.length && pt.own[0].e < e - 60000) pt.own.shift();
    while (pt.drawn.length && pt.drawn[0].e < e - 60000) pt.drawn.shift();
    pt.ticks++;
    if (performance.now() - t0 > 50) pt.slow++;
  }, 16);
  pt.key = (code, down = true) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true, cancelable: true }));
  pt.click = (sel, root = document) => {
    const el = root.querySelector(sel);
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  };
  pt.text = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
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
  /** The Multiplayer screen: the main menu's button when there is one, else the door the Dev mode button uses. */
  pt.openScreen = () => {
    // The main menu's card opens the lobbies now (multiplayer.lobbies.playtest.mjs); this is the older server list's door.
    if (pt.mpMod.LOBBIES_ON_MAIN_MENU && pt.mpMod.openServerList) {
      pt.mpMod.openServerList(sim);
      return false;
    }
    const viaMenu = sim.state === 'menu' && pt.click('[data-act="multiplayer"]');
    if (!viaMenu) pt.mpMod.openMultiplayer(sim);
    return viaMenu;
  };
  pt.airborne = ({ x, z, heading = 90, speed = 55, agl = 300 } = {}) => {
    const ac = s.aircraft;
    ac.reset({ pos: new THREE.Vector3(x ?? ac.pos.x, 0, z ?? ac.pos.z), headingDeg: heading, speed, altAGL: agl, engineOn: true, gearDown: false });
    ac.controls.throttle = 0.7;
    if (s.input) {
      s.input.throttleTarget = 0.7;
      if (s.input.out) s.input.out.throttle = 0.7;
    }
  };
  pt.shot = () => pt.render(s.scene, s.camera);
  pt.leaveViaList = async () => {
    pt.key('Tab', true);
    await new Promise((r) => setTimeout(r, 200));
    const clicked = pt.click('[data-mp-leave]');
    pt.key('Tab', false);
    return clicked;
  };
  pt.mp.install(sim);
  /*
   * Every message this page sends to the signaling server: which socket, to
   * whom, and for a candidate its type and address. Review recorded the
   * public IPv4 and IPv6 in 8 of 20 candidates; this is how the playtest
   * sees what goes there now. Names are looked for in the whole message.
   */
  pt.sig = [];
  const wsSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try {
      const m = JSON.parse(d);
      if (m.type !== 'HEARTBEAT') {
        const c = m.type === 'CANDIDATE' && m.payload && m.payload.candidate ? String(m.payload.candidate.candidate) : '';
        const f = c.replace(/^candidate:/, '').split(' ');
        pt.sig.push({ type: m.type, from: new URL(this.url).searchParams.get('id'), dst: m.dst, typ: c ? f[7] : '', addr: c ? f[4] : '', named: /Brave Otter|Swift Falcon|Harbour Hangar|Cloud Base/.test(String(d)) });
      }
    } catch (e) { /* not JSON: not ours */ }
    return wsSend.call(this, d);
  };
}
return true;`;

const PRE = 'const pt = window.__pt; const mp = pt && pt.mp; const THREE = pt && pt.THREE;\n';
const ev = (page, body, secs = 120) => page.eval(PRE + body, secs);

async function setup(page, name, colour, key) {
  await page.eval(PAGE, 120);
  return ev(page, `
    mp.profile.name = ${JSON.stringify(name)};
    mp.profile.colour = ${JSON.stringify(colour)};
    mp.profile.key = ${JSON.stringify(key)};
    return { state: sim.state, map: sim.settings.map, button: !!document.querySelector('[data-act="multiplayer"]') };
  `);
}

/**
 * Host through the screen. The server's name is from the lists; there is no
 * box to type one into, so it is set the way the dice would set it.
 */
function hostVia(page, { server = 'Harbour Hangar', game = 'flight', map = null, avoidMap = null } = {}) {
  return ev(page, `
    const set = mp.setProfile({ server: ${JSON.stringify(server)} });
    if (!set.ok) throw new Error('not a server name from the lists: ' + ${JSON.stringify(server)});
    pt.openScreen();
    await pt.until(() => mp.screenOpen, 5000);
    const el = document.querySelector('[data-screen="multiplayer"]');
    const shownServer = el.querySelector('[data-mp-server]').textContent;
    pt.click('[data-mp-game="${game}"]', el);
    const sel = el.querySelector('[data-mp-map]');
    const maps = [...sel.options].map((o) => o.value);
    const want = ${JSON.stringify(map)} || maps.find((m) => m !== ${JSON.stringify(avoidMap)}) || maps[0];
    sel.value = want;
    const t0 = performance.now();
    pt.click('[data-mp-host]', el);
    const r = await pt.until(() => mp.role === 'host' && mp.ready && sim.state === 'flying', 60000);
    return { ok: !!r.v && shownServer === ${JSON.stringify(server)} && mp.server.name === ${JSON.stringify(server)}, ms: Math.round(performance.now() - t0), map: sim.settings.map, mode: sim.mode, want, server: mp.server, shownServer,
      status: pt.text('[data-mp-status]'), badge: pt.text('[data-mp-badge-text]'), toasts: pt.toasts.map((t) => t.text).slice(-3) };
  `);
}

/** Join the server in `slot` from the LAN list, once it shows up there. */
function joinSlot(page, slot) {
  return ev(page, `
    pt.openScreen();
    const t0 = performance.now();
    const seen = await pt.until(() => mp.prober && mp.prober.slots[${slot - 1}].state === 'open', 30000);
    pt.click('[data-mp-join="${slot}"]');
    const r = await pt.until(() => (mp.role === 'client' && mp.ready && sim.state === 'flying') || /taken you out|full|Couldn|Nobody|Lost/.test(pt.text('[data-mp-status]') || ''), 60000);
    return { ok: mp.role === 'client' && mp.ready, seenMs: seen.ms, ms: Math.round(performance.now() - t0), status: pt.text('[data-mp-status]'), map: sim.settings.map, mode: sim.mode, me: mp.meId };
  `);
}

/** Interpolation, measured: what B drew of A against where A really was, on the same machine's clock. */
async function measureTrack(A, B, fromE, toE) {
  const own = await ev(A, `return pt.own.filter((o) => o.e >= ${fromE - 2000} && o.e <= ${toE + 500});`);
  const drawn = await ev(B, `return pt.drawn.filter((d) => d.id === 0 && d.e >= ${fromE} && d.e <= ${toE});`);
  const at = (e) => {
    let lo = 0;
    let hi = own.length - 1;
    if (!own.length || e < own[0].e || e > own[hi].e) return null;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (own[m].e <= e) lo = m;
      else hi = m;
    }
    const a = own[lo];
    const b = own[hi];
    const k = b.e > a.e ? (e - a.e) / (b.e - a.e) : 0;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
  };
  const d3 = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  const interp = [];
  const lag = [];
  let ex = 0;
  for (const d of drawn) {
    const past = at(d.e - d.delay);
    const nowA = at(d.e);
    if (!past || !nowA) continue;
    interp.push(d3(d, past));
    lag.push(d3(d, nowA));
    if (d.ex) ex++;
  }
  let speed = 0;
  for (let i = 1; i < own.length; i++) speed += d3(own[i], own[i - 1]);
  speed /= own.length > 1 ? (own[own.length - 1].e - own[0].e) / 1000 : 1;
  let worst = 0;
  const steps = [];
  for (let i = 1; i < drawn.length; i++) {
    const dt = (drawn[i].e - drawn[i - 1].e) / 1000;
    if (dt <= 0.004) continue;
    const v = d3(drawn[i], drawn[i - 1]) / dt;
    worst = Math.max(worst, v);
    const q = drawn[i];
    const pq = drawn[i - 1];
    steps.push({ v: Math.round(v), gapMs: Math.round(dt * 1000), frameDt: +q.dt.toFixed(3), step: +d3(q, pq).toFixed(1),
      rawStep: +Math.hypot(q.rx - pq.rx, q.rz - pq.rz).toFixed(1), ex: [pq.ex, q.ex], snaps: q.n });
  }
  steps.sort((p, q) => q.v - p.v);
  // And A's own track: if A itself jumped (a respawn, a stall), B drawing a jump is right.
  let aWorst = 0;
  for (let i = 1; i < own.length; i++) {
    const dt = (own[i].e - own[i - 1].e) / 1000;
    if (dt > 0.004) aWorst = Math.max(aWorst, d3(own[i], own[i - 1]) / dt);
  }
  const stats = (xs) => {
    const s = [...xs].sort((p, q) => p - q);
    const q = (f) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : NaN);
    return { median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +(s[s.length - 1] ?? NaN).toFixed(2) };
  };
  const delays = drawn.map((d) => d.delay);
  return {
    samples: interp.length,
    errorVsWhereAWas: stats(interp),
    behindWhereAIsNow: stats(lag),
    extrapolatedShare: interp.length ? +(ex / interp.length).toFixed(3) : null,
    delayMs: delays.length ? [Math.round(Math.min(...delays)), Math.round(Math.max(...delays))] : null,
    aSpeed: +speed.toFixed(1),
    fastestDrawnStep: +worst.toFixed(1),
    worstSteps: steps.slice(0, 3),
    aOwnFastestStep: +aWorst.toFixed(1),
  };
}

/* ------------------------------------------------------------------ */
/* The playtest                                                        */
/* ------------------------------------------------------------------ */

const URL = await serve();
const openPage = arg('opener') ? (await import(resolve(arg('opener')))).openPage : builtInOpener();
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let A;
let B;
try {
  log(`two pages on ${URL} (${PUBLIC ? 'public signaling' : 'signaling as served'})`);
  A = await openPage(URL, { timeoutS: 300 });
  B = await openPage(URL, { timeoutS: 300 });
  // Two pages in one browser share its storage; the second player gets its own key, as another computer would have.
  // Two call signs from the lists; the screen's own pickers and dice are the in-tab check's to test.
  const a0 = await setup(A, 'Brave Otter', '#ff5a4f', 'hanakeyhanakeyhana01');
  const b0 = await setup(B, 'Swift Falcon', '#58c6ff', 'samkeysamkeysamkey01');
  M.menuButton = a0.button;

  /* ---- the screen ---- */
  const scr = await ev(B, `
    const viaMenu = pt.openScreen();
    const r = await pt.until(() => mp.prober && mp.prober.slots.every((s) => s.state !== 'looking'), 30000);
    const el = document.querySelector('[data-screen="multiplayer"]');
    return { viaMenu, open: mp.screenOpen, current: sim.menus.current, slots: el.querySelectorAll('[data-mp-slot]').length,
      states: mp.prober ? mp.prober.slots.map((s) => s.state) : null, ms: r.ms, net: pt.text('[data-mp-net]'), backend: mp.backend.id };
  `);
  ok(`the Multiplayer screen opens${scr.viaMenu ? ' from the main menu\'s button' : ' (no main-menu button in this checkout: opened as Dev mode does)'}`, scr.open && scr.current === 'multiplayer', scr.net);
  ok('five server slots, each looked at', scr.slots === 5 && scr.states && scr.states.length === 5, `${scr.states} in ${scr.ms} ms`);
  M.backend = scr.backend;
  if (PUBLIC) ok('the public signaling server is the one in use', scr.backend === 'public', scr.backend);

  /* ---- A hosts ---- */
  const h1 = await hostVia(A, { avoidMap: b0.map });
  ok('A hosts through the screen and is flying on the chosen map', h1.ok && h1.map === h1.want, `${h1.ms} ms, ${JSON.stringify(h1.server)}`);
  ok('A is told its slot and code; the badge says 1/5', /slot \d, code [a-z]+-[a-z]+-\d{1,2}\b/.test(h1.toasts.join('|')) && /1\/5/.test(h1.badge || ''), `${h1.toasts.slice(-1)} | ${h1.badge}`);
  M.hostMs = h1.ms;
  const slot = h1.server.slot;

  /* ---- B's list ---- */
  const list = await ev(B, `
    const r = await pt.until(() => mp.prober && mp.prober.slots[${slot - 1}].state === 'open' && mp.prober.slots[${slot - 1}].ping, 30000);
    await new Promise((res) => setTimeout(res, 300));
    const card = document.querySelector('[data-mp-slot="${slot}"]');
    return { ms: r.ms, text: card ? card.textContent.replace(/\\s+/g, ' ').trim() : null, join: !!(card && card.querySelector('[data-mp-join]:not([disabled]):not([hidden])')),
      empties: [...document.querySelectorAll('.mp-slot.is-empty')].map((c) => c.textContent.includes('Empty — host here')) };
  `);
  ok('B\'s list shows the server: name, map, game, 1/5, ping, Join',
    list.text && /Harbour Hangar/.test(list.text) && /Flight/.test(list.text) && /1\/5/.test(list.text) && /\d+ ms/.test(list.text) && list.join, `${list.ms} ms: "${list.text}"`);
  ok('and every empty slot says "Empty — host here"', list.empties.every(Boolean), `${list.empties.length} empty`);
  M.listShowsHostMs = list.ms;
  if (SHOTS) {
    await ev(B, 'pt.shot(); return true;');
    await B.shot(join(SHOTS, 'mp-server-list.png'));
  }

  /* ---- B joins while A is on the runway ---- */
  const j1 = await joinSlot(B, slot);
  ok('B joins from the list and is moved to the host\'s map', j1.ok && j1.map === h1.map && b0.map !== j1.map, `${j1.ms} ms, ${b0.map} -> ${j1.map}, player ${j1.me}`);
  M.joinMs = j1.ms;
  const aSees = await ev(A, `
    const r = await pt.until(() => pt.toasts.some((t) => /Swift Falcon joined/.test(t.text)) && mp.remotes.players.get(1) && mp.remotes.players.get(1).visible, 20000);
    return { ms: r.ms, pos: sim.aircraft.pos.toArray() };
  `);
  const bPos = await ev(B, 'return sim.aircraft.pos.toArray();');
  ok('A: "Swift Falcon joined", and Swift Falcon is drawn', aSees.ms < 20000, `${aSees.ms} ms`);
  {
    // The tag over each aeroplane is drawn from the call sign the host checked, and nothing else.
    const tagOf = (page, id) => ev(page, `
      const r = await pt.until(() => { const p = mp.remotes.players.get(${id}); return p && p.tag && p.tag.key; }, 10000);
      const p = mp.remotes.players.get(${id});
      return { name: p && p.name, tag: p && p.tag ? p.tag.key.split('|')[0] : null, onSprite: !!(p && p.tag && p.tag.sprite.parent), ms: r.ms };
    `);
    const ta = await tagOf(A, 1);
    const tb = await tagOf(B, 0);
    ok('the tag over each aeroplane shows the other player\'s call sign: A sees "Swift Falcon", B sees "Brave Otter"',
      ta.tag === 'Swift Falcon' && ta.onSprite && tb.tag === 'Brave Otter' && tb.onSprite, { A: ta, B: tb });
  }
  const sep = Math.hypot(aSees.pos[0] - bPos[0], aSees.pos[2] - bPos[2]);
  ok('on the runway the joiner lines up beside the host, not inside it', j1.ok && sep > 7 && sep < 40, `${sep.toFixed(1)} m apart`);
  {
    // What the signaling server was told on the way in from the list, by both sides.
    const slotId = await ev(A, "return (mp.hostSockets.find((s) => s.what === 'slot') || {}).id;");
    const sent = [...await ev(A, 'return pt.sig;'), ...await ev(B, 'return pt.sig;')];
    const wifi = sent.filter((x) => x.type === 'CANDIDATE' && (x.from === slotId || x.dst === slotId));
    const kinds = [...new Set(wifi.map((x) => `${x.typ}:${String(x.addr).replace(/^[^.]*\./, '*.')}`))];
    M.candidatesFromList = kinds;
    ok('finding and joining from the list: every candidate the signaling server saw was local — no public address',
      wifi.length > 0 && wifi.every((x) => candidateAllowed(`candidate:0 1 udp 1 ${x.addr} 9 typ ${x.typ}`, 'lan')), `${wifi.length}: ${kinds.join(', ')}`);
  }

  /* ---- the player list ---- */
  const la = await ev(A, `
    pt.key('Tab', true);
    await new Promise((r) => setTimeout(r, 2500));
    const l = document.querySelector('[data-mp-list]');
    const out = { open: !l.hidden, text: l.textContent.replace(/\\s+/g, ' ').trim(), kick: !!l.querySelector('[data-mp-kick="1"]') };
    pt.key('Tab', false);
    await new Promise((r) => setTimeout(r, 50));
    out.closed = l.hidden;
    return out;
  `);
  ok('A holds Tab: both call signs in the roster, 2/5, a Kick button for Swift Falcon; let go and it closes', la.open && /Brave Otter/.test(la.text) && /Swift Falcon/.test(la.text) && /2\/5/.test(la.text) && la.kick && la.closed, la.text);
  const lb = await ev(B, `
    pt.key('Tab', true);
    await new Promise((r) => setTimeout(r, 2500));
    const l = document.querySelector('[data-mp-list]');
    const out = { open: !l.hidden, text: l.textContent.replace(/\\s+/g, ' ').trim(), kick: !!l.querySelector('[data-mp-kick]') };
    out.badge = (document.querySelector('[data-mp-badge-text]') || {}).textContent || '';
    pt.key('Tab', false);
    return out;
  `);
  ok('B holds Tab: the same call signs with a ping, and no Kick buttons', lb.open && /Brave Otter/.test(lb.text) && /Swift Falcon/.test(lb.text) && /\d+ ms/.test(lb.text) && !lb.kick, lb.text);
  {
    // The join code is on the joiner's list and badge all game: the host's own code, two list words and a number.
    const aCode = await ev(A, "const P = await import('/src/features/multiplayer/protocol.js'); return { code: mp.server && mp.server.code, parsed: P.parseCode(mp.server && mp.server.code) };");
    ok('B\'s list and badge show the host\'s join code, which is two list words and a number', !!aCode.parsed && lb.text.includes(`Code ${aCode.code}`) && lb.badge.includes(`code ${aCode.code}`),
      `${aCode.code}; badge "${lb.badge}"`);
  }

  /* ---- B leaves; A takes off; B joins again, beside A in the air ---- */
  await ev(B, 'return pt.leaveViaList();');
  const left = await ev(A, 'const r = await pt.until(() => pt.toasts.some((t) => /Swift Falcon left/.test(t.text)) && !mp.remotes.players.has(1), 10000); return { ms: r.ms, n: mp.host.players.size };');
  ok('B leaves from the list; A is told "Swift Falcon left"', left.n === 0 && left.ms < 10000, `${left.ms} ms`);
  await ev(A, 'pt.airborne({ heading: 90, speed: 55, agl: 300 }); return true;');
  await sleep(3000);
  /*
   * A modified host: A's own session now says its code is the first code the
   * fourth review got onto a joiner's screen. It goes out in the welcome as
   * a real host's would; nothing on the wire is forged.
   */
  await ev(A, `mp.host.server.code = ${JSON.stringify(REVIEW_CODES[0])}; return true;`);
  const j2 = await joinSlot(B, slot);
  {
    const seen = j2.ok ? await ev(B, seenByB) : null;
    await ev(A, 'mp.host.server.code = mp.server.code; return true;');
    ok('a modified host whose code is the fourth review\'s first: B joins, and its badge and list show no code at all',
      j2.ok && seen.code === null && !seen.badge.includes(REVIEW_CODES[0]) && !seen.list.includes(REVIEW_CODES[0]) && !/code/i.test(seen.badge) && !/Code/.test(seen.list) && /Swift Falcon/.test(seen.list) && /Brave Otter/.test(seen.list), seen || j2.status);
  }
  const air = await ev(B, `
    const cam = sim.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const off = sim.aircraft.pos.clone().sub(cam.position).angleTo(fwd) * 180 / Math.PI;
    return { pos: sim.aircraft.pos.toArray(), hdg: Math.round(sim.aircraft.readouts().heading), onGround: sim.aircraft.onGround,
      cam: Math.round(cam.position.distanceTo(sim.aircraft.pos)), camOffDeg: Math.round(off) };
  `);
  const aAir = await ev(A, 'return { pos: sim.aircraft.pos.toArray(), hdg: Math.round(sim.aircraft.readouts().heading) };');
  {
    const d = Math.hypot(aAir.pos[0] - air.pos[0], aAir.pos[1] - air.pos[1], aAir.pos[2] - air.pos[2]);
    ok('B joins again and is put in the air near A, on A\'s heading', j2.ok && !air.onGround && d > 50 && d < 600 && Math.abs(((aAir.hdg - air.hdg + 540) % 360) - 180) < 15, `${Math.round(d)} m away, heading ${air.hdg} vs ${aAir.hdg}`);
    M.airJoinDistanceM = Math.round(d);
    ok('and the chase camera is behind B and looking at it, not still on the runway it started from', air.cam < 80 && air.camOffDeg < 20, `${air.cam} m from B, ${air.camOffDeg}° off`);
  }

  /* ---- fly: A turns, B watches ---- */
  const fromE = await ev(A, 'return performance.timeOrigin + performance.now();');
  const ticks0 = await ev(A, 'return pt.ticks;');
  await sleep(4000);
  await ev(A, `pt.key('KeyA', true); await new Promise((r) => setTimeout(r, 1500)); pt.key('KeyA', false); return true;`);
  await sleep(8000);
  const toE = await ev(A, 'return performance.timeOrigin + performance.now();');
  const tr = await measureTrack(A, B, fromE + 1000, toE - 500);
  // How well A's page itself kept up: frames a second, against the 60 the harness asks for.
  tr.aFramesPerSecond = Math.round(((await ev(A, 'return pt.ticks;')) - ticks0) / ((toE - fromE) / 1000));
  M.track = tr;
  ok('B draws A where A was at the moment being drawn: median under 1.5 m, 95 % under 5 m', tr.samples > 100 && tr.errorVsWhereAWas.median < 1.5 && tr.errorVsWhereAWas.p95 < 5, tr);
  ok('and smoothly: no frame-to-frame step faster than twice A\'s speed (no teleporting)', tr.fastestDrawnStep < Math.max(2 * tr.aSpeed, 30), `${tr.fastestDrawnStep} m/s drawn, ${tr.aSpeed} m/s flown`);
  if (SHOTS) {
    /*
     * B tucked in 35 m behind A and a little to one side, both flying, so B's
     * chase camera has A ahead of it. Placed, run for a few frames and drawn
     * in one go: an earlier version placed B, waited a second and a half with
     * A paused, and B had flown straight past.
     */
    const a = await ev(A, 'return { p: sim.aircraft.pos.toArray(), h: sim.aircraft.readouts().heading, v: sim.aircraft.vel.toArray() };');
    const shotInfo = await ev(B, `
      pt.paused = true;
      const h = ${a.h} * Math.PI / 180;
      const [x, y, z] = ${JSON.stringify(a.p)};
      const [vx, vy, vz] = ${JSON.stringify(a.v)};
      pt.airborne({ x: x - Math.sin(h) * 35 + Math.cos(h) * 8, z: z + Math.cos(h) * 35 + Math.sin(h) * 8, heading: ${a.h}, speed: Math.hypot(vx, vz) || 55, agl: 0 });
      sim.aircraft.pos.y = y - 3;
      // The chase camera is a spring, and eases its aim too; start both afresh at B's new position.
      pt.mp.snapCamera(sim);
      for (let i = 0; i < 8; i++) sim.update(1 / 60);
      pt.shot();
      const p = mp.remotes.players.get(0);
      const me = sim.aircraft.pos;
      return p && p.drawn ? Math.round(Math.hypot(p.drawn.x - me.x, p.drawn.z - me.z)) : null;
    `);
    await B.shot(join(SHOTS, 'mp-remote-plane.png'));
    await ev(B, 'pt.paused = false; return true;');
    M.shotDistanceM = shotInfo;
  }
  const hud = await ev(B, `
    await new Promise((r) => setTimeout(r, 700));
    const badge = document.querySelector('.mp-badge').getBoundingClientRect();
    const hits = [];
    for (const n of document.querySelectorAll('[class*="hud-"]')) {
      if (n.closest('.mp-hud')) continue;
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(n).visibility === 'hidden') continue;
      if (r.width > innerWidth * 0.6 || r.height > innerHeight * 0.6) continue;
      if (r.left < badge.right && r.right > badge.left && r.top < badge.bottom && r.bottom > badge.top) hits.push(n.className);
    }
    return { hits, top: Math.round(badge.top), shown: !mp.hud.el.hidden && badge.width > 0 };
  `);
  ok('the multiplayer badge is up and covers none of the game\'s own HUD', hud.shown && hud.hits.length === 0, hud.hits.length ? hud.hits.slice(0, 4).join(' | ') : `badge at top ${hud.top}px`);

  /* ---- quick chat ---- */
  await ev(B, `pt.key('Digit3', true); pt.key('Digit3', false); return true;`);
  const c1 = await ev(A, `const r = await pt.until(() => pt.toasts.find((t) => /Swift Falcon: Nice landing!/.test(t.text)), 5000); const p = mp.remotes.players.get(1); return { ms: r.ms, ok: !!r.v, bubble: p && p.chat };`);
  ok('quick chat: B presses 3, A reads "Swift Falcon: Nice landing!" with a bubble over Swift Falcon', c1.ok && c1.bubble === 'Nice landing!', `${c1.ms} ms`);
  await ev(A, `pt.click('[data-mp-chat]'); pt.click('[data-mp-say="3"]'); return true;`);
  const c2 = await ev(B, `const r = await pt.until(() => pt.toasts.find((t) => /Brave Otter: .*Wave/.test(t.text)), 5000); return { ms: r.ms, ok: !!r.v };`);
  ok('quick chat: A picks Wave from the chat menu and B sees it', c2.ok, `${c2.ms} ms`);
  const typed = await ev(B, 'return document.querySelectorAll(".mp-hud input, .mp-hud textarea, .mp-hud [contenteditable]").length;');
  ok('there is nowhere to type a message', typed === 0);

  /* ---- five is the most ---- */
  const cap = await ev(B, `
    const P = await import('/src/features/multiplayer/protocol.js');
    const S = await import('/src/features/multiplayer/session.js');
    const { Net } = await import('/src/features/multiplayer/link.js');
    const { Signaling } = await import('/src/features/multiplayer/signaling.js');
    const target = P.slotId(mp.hash, ${slot});
    const out = [];
    window.__extra = [];
    for (const name of ['Daring Dolphin', 'Bright Badger', 'Calm Condor', 'Dapper Dragon']) {
      const sig = new Signaling(mp.backend);
      await sig.open(P.playerPeerId());
      const c = new S.ClientSession({ net: new Net(sig), target, profile: { name, colour: P.COLOURS[2], key: name.toLowerCase().replace(/ /g, '') + 'key0' }, onEvent: () => {} });
      window.__extra.push({ sig, c });
      try {
        const w = await c.start();
        out.push({ name, you: w.you });
        c._iv = setInterval(() => c.tick(performance.now(), P.encodeState({ t: Math.round(performance.now()), pos: { x: 200 * w.you, y: 400, z: 0 }, quat: { w: 1 }, vel: {}, game: 'flight', type: 'skylark' })), 200);
      } catch (e) {
        out.push({ name, refused: e.message, code: e.code });
      }
    }
    return out;
  `);
  ok('three more players get in (five in all); a sixth is told "That server is full"', cap.filter((c) => c.you).length === 3 && cap[3] && cap[3].code === 'full', cap.map((c) => c.you || c.refused).join(' / '));
  const five = await ev(A, 'await pt.until(() => mp.host.players.size === 4, 10000); await new Promise((r) => setTimeout(r, 1200)); return { n: mp.host.count, badge: pt.text(\'[data-mp-badge-text]\') };');
  ok('A\'s badge says 5/5', five.n === 5 && /5\/5/.test(five.badge || ''), five.badge);
  const full = await ev(B, `
    const P = await import('/src/features/multiplayer/protocol.js');
    const S = await import('/src/features/multiplayer/session.js');
    const { Net } = await import('/src/features/multiplayer/link.js');
    const { Signaling } = await import('/src/features/multiplayer/signaling.js');
    const sig = new Signaling(mp.backend);
    await sig.open(P.playerPeerId());
    const pr = new S.Prober({ net: new Net(sig), hash: mp.hash, onChange: () => {} });
    pr.start();
    // "Full" comes first from the ping's head-count; the name follows over a data channel.
    const first = await pt.until(() => pr.slots[${slot - 1}].state === 'full', 20000);
    const fromPing = pr.slots[${slot - 1}].count && pr.slots[${slot - 1}].count.players;
    const r = await pt.until(() => pr.slots[${slot - 1}].state === 'full' && pr.slots[${slot - 1}].info, 20000);
    const s = pr.slots[${slot - 1}];
    pr.stop();
    sig.close();
    return { state: s.state, players: s.info && s.info.players, fromPing, name: s.info && s.info.name, fullMs: first.ms, namedMs: r.ms };
  `);
  ok('another LAN list shows that slot as 5/5, full — from the ping at once, then with its name', full.state === 'full' && full.players === 5 && full.fromPing === 5 && !!full.name, full);
  await ev(B, 'for (const x of window.__extra) { clearInterval(x.c._iv); x.c.leave(); setTimeout(() => x.sig.close(), 500); } return true;');
  const back = await ev(A, 'const r = await pt.until(() => mp.host.players.size === 1, 10000); return mp.host.count;');
  ok('they leave, and it is two again', back === 2, back);

  /* ---- kick ---- */
  const k = await ev(A, `
    pt.key('Tab', true);
    await new Promise((r) => setTimeout(r, 300));
    const clicked = pt.click('[data-mp-kick="1"]');
    pt.key('Tab', false);
    await pt.until(() => !mp.host.players.has(1), 5000);
    return { clicked, gone: !mp.host.players.has(1), banned: [...mp.host.banned], names: 'bannedNames' in mp.host,
      toast: (pt.toasts.map((t) => t.text).filter((t) => /Swift Falcon/.test(t)).slice(-1)[0]) || null };
  `);
  const kb = await ev(B, `
    const r = await pt.until(() => mp.role === null, 8000);
    await new Promise((res) => setTimeout(res, 300));
    return { ms: r.ms, role: mp.role, state: sim.state, remotes: mp.remotes.players.size, hud: mp.hud.el.hidden,
      told: (pt.toasts.map((t) => t.text).filter((t) => /took you out of this game/.test(t)).slice(-1)[0]) || null };
  `);
  ok('kick: A kicks Swift Falcon from the list; Swift Falcon is told gently, and flies on alone', k.clicked && k.gone && kb.role === null && kb.state === 'flying' && kb.remotes === 0 && kb.hud && !!kb.told, kb);
  ok('the host keeps out Swift Falcon\'s key, and no name', k.banned.length === 1 && k.banned[0] === 'samkeysamkeysamkey01' && !k.names && /Swift Falcon was removed/.test(k.toast || ''), k);
  const again = await joinSlot(B, slot);
  ok('a kicked player cannot get back into that server, and is told so kindly', !again.ok && /taken you out of that server for now/.test(again.status || ''), again.status);

  /* ---- the host quits to the menu ---- */
  const h2 = await ev(A, `
    await pt.leaveViaList();
    await pt.until(() => mp.role === null, 5000);
    return true;
  `);
  const h2b = await hostVia(A, { server: 'Cloud Base', map: h1.map });
  ok('A closes the server from the list and hosts another', h2 && h2b.ok, h2b.server);
  const byCode = await ev(B, `
    mp.back();
    pt.openScreen();
    const el = document.querySelector('[data-screen="multiplayer"]');
    const box = el.querySelector('[data-mp-code]');
    // Typed the way a child reading it off a friend's screen might: capitals, and spaces for the hyphens.
    box.value = ${JSON.stringify(h2b.server.code)}.toUpperCase().replace(/-/g, ' ');
    box.dispatchEvent(new Event('input', { bubbles: true }));
    const t0 = performance.now();
    pt.click('[data-mp-join-code]', el);
    const r = await pt.until(() => (mp.role === 'client' && mp.ready) || /Couldn|Nobody|Lost|taken you out/.test(pt.text('[data-mp-status]') || ''), 60000);
    const out = { ok: mp.role === 'client' && mp.ready, ms: Math.round(performance.now() - t0), typed: box.value, status: pt.text('[data-mp-status]'), log: mp.log.slice(-4) };
    await pt.until(() => /code/.test((document.querySelector('[data-mp-badge-text]') || {}).textContent || ''), 5000);
    out.code = mp.server && mp.server.code;
    out.badge = (document.querySelector('[data-mp-badge-text]') || {}).textContent || '';
    return out;
  `);
  ok('B joins it by its code, typed in capitals with spaces, the moment the screen opens; its badge shows the code as the game writes it',
    byCode.ok && byCode.code === h2b.server.code && byCode.badge.includes(`code ${h2b.server.code}`), byCode);
  {
    const codeId = `ifs-code-${h2b.server.code}`;
    const sent = [...await ev(A, 'return pt.sig;'), ...await ev(B, 'return pt.sig;')];
    const byCodeC = sent.filter((x) => x.type === 'CANDIDATE' && (x.from === codeId || x.dst === codeId));
    M.candidatesByCode = [...new Set(byCodeC.map((x) => `${x.typ}:${/^\d+\.\d+\.\d+\.\d+$/.test(x.addr) && x.typ === 'srflx' ? 'public IPv4' : String(x.addr).replace(/^[^.]*\./, '*.')}`))];
    ok('joining by code: the public IPv4 may go (a path between networks needs it), a per-device IPv6 or public host address never',
      byCodeC.length > 0 && byCodeC.every((x) => candidateAllowed(`candidate:0 1 udp 1 ${x.addr} 9 typ ${x.typ}`, 'v4')), M.candidatesByCode.join(', '));
  }
  const quitAt = await ev(A, "const t = performance.timeOrigin + performance.now(); sim.quitToMenu('main'); return t;");
  const told = await ev(B, `
    const r = await pt.until(() => mp.role === null, 20000);
    const t = performance.timeOrigin + performance.now();
    return { t, state: sim.state, told: pt.toasts.some((x) => /The host closed the server/.test(x.text)) };
  `);
  ok('A quits to the menu: B is told "The host closed the server" and flies on', told.told && told.state === 'flying', `${Math.round(told.t - quitAt)} ms`);
  M.hostQuitHeardMs = Math.round(told.t - quitAt);
  const bm = await ev(B, "sim.quitToMenu('main'); await new Promise((r) => setTimeout(r, 300)); return sim.settings.map;");
  ok('back at the menu, B is on its own map again', bm === b0.map, `${bm} (own ${b0.map})`);

  /* ---- the helicopter, the boat and the car ---- */
  for (const game of ['heli', 'boat', 'car']) {
    const hv = await hostVia(A, { server: { heli: 'Windy Point', boat: 'Coral Marina', car: 'Canyon Runway' }[game], game });
    if (!ok(`${game}: A hosts a ${game} server`, hv.ok, `${hv.ms} ms on ${hv.map}, mode ${hv.mode}`)) continue;
    const jv = await joinSlot(B, hv.server.slot);
    const wv = await ev(B, `
      const r = await pt.until(() => { const p = mp.remotes.players.get(0); return p && p.visible && p.model; }, 15000);
      const p = mp.remotes.players.get(0);
      const me = sim.mode === 'drive' ? sim.vehicle.pos : sim.aircraft.pos;
      return { mode: sim.mode, type: sim.mode === 'drive' ? (sim.vehicle.spec && sim.vehicle.spec.kind === 'car' ? 'car' : 'boat') : sim.aircraftType && sim.aircraftType.id,
        kind: p && p.model && p.model.userData.mpKind, dist: p && p.sample ? Math.round(Math.hypot(p.sample.pos.x - me.x, p.sample.pos.z - me.z)) : null, ms: r.ms };
    `);
    const want = game === 'heli' ? { mode: 'free', type: 'harrier', kind: 'air' } : { mode: 'drive', type: game, kind: game };
    ok(`${game}: B joins in the same kind of thing, sees A's ${game} drawn as one, close by`,
      jv.ok && wv.mode === want.mode && wv.type === want.type && wv.kind === want.kind && wv.dist != null && wv.dist < 150, { join: jv.ms, ...wv });
    await ev(B, "await pt.leaveViaList(); await pt.until(() => mp.role === null, 5000); sim.quitToMenu('main'); return true;");
    await ev(A, "await pt.leaveViaList(); await pt.until(() => mp.role === null, 5000); sim.quitToMenu('main'); return true;");
  }

  /* ---- a host that goes silent (its tab frozen for 14 s) ---- */
  const h3 = await hostVia(A, { server: 'Snowy Lookout', map: h1.map });
  // The modified host again, with the fourth review's second code.
  await ev(A, `mp.host.server.code = ${JSON.stringify(REVIEW_CODES[1])}; return true;`);
  const j3 = await joinSlot(B, h3.server.slot);
  ok('B joins a third server', h3.ok && j3.ok, j3.status);
  {
    const seen = j3.ok ? await ev(B, seenByB) : null;
    await ev(A, 'mp.host.server.code = mp.server.code; return true;');
    ok('a modified host whose code is the fourth review\'s second: B\'s badge and list show no code at all',
      j3.ok && seen.code === null && !seen.badge.includes(REVIEW_CODES[1]) && !seen.list.includes(REVIEW_CODES[1]) && !/code/i.test(seen.badge) && !/Code/.test(seen.list) && /Swift Falcon/.test(seen.list) && /Brave Otter/.test(seen.list), seen || j3.status);
  }
  await sleep(2000);
  const frozenAt = Date.now();
  const frozen = A.eval('const t = performance.now(); while (performance.now() - t < 14000) {} return true;', 60).catch((e) => String(e));
  const dr = await ev(B, 'const r = await pt.until(() => mp.role === null, 25000); return { told: pt.toasts.some((x) => /Lost the connection/.test(x.text)), state: sim.state, log: mp.log.slice(-1) };');
  const heardAfter = Math.round((Date.now() - frozenAt) / 1000);
  await frozen;
  ok('a host that goes silent: B gives up after about 12 s, says "Lost the connection", flies on', dr.told && dr.state === 'flying' && heardAfter >= 11 && heardAfter <= 16, `${heardAfter} s; ${dr.log}`);
  const wake = await ev(A, 'await new Promise((r) => setTimeout(r, 13000)); return { role: mp.role, n: mp.host ? mp.host.players.size : null };');
  ok('the host wakes still hosting, without the player it lost', wake.role === 'host' && wake.n === 0, wake);

  {
    const sent = await ev(A, 'return pt.sig;');
    M.signalingMessagesA = sent.length;
    ok('no name ever went through the signaling server (A, three servers hosted)', sent.length > 0 && !sent.some((x) => x.named), `${sent.length} messages, ${sent.filter((x) => x.named).length} with a name`);
  }

  /* ---- the host closes the tab ---- */
  const j4 = await joinSlot(B, h3.server.slot);
  await sleep(1500);
  const closeAt = Date.now();
  await A.close();
  A = null;
  const tc = await ev(B, 'const r = await pt.until(() => mp.role === null, 25000); return { toast: pt.toasts.map((x) => x.text).slice(-1)[0], state: sim.state, log: mp.log.slice(-1) };');
  M.tabClosedHeardMs = Date.now() - closeAt;
  ok('the host closes the tab: B is told "The host closed the server" within 5 s and flies on',
    j4.ok && /The host closed the server/.test(tc.toast || '') && tc.state === 'flying' && M.tabClosedHeardMs < 5000, `${M.tabClosedHeardMs} ms; ${tc.log}`);
  {
    const sent = await ev(B, 'return pt.sig;');
    M.signalingMessagesB = sent.length;
    ok('no name ever went through the signaling server (B, the whole playtest)', sent.length > 0 && !sent.some((x) => x.named), `${sent.length} messages, ${sent.filter((x) => x.named).length} with a name`);
  }
  const errs = await ev(B, 'return { err: pt.err || null, ticks: pt.ticks, slow: pt.slow };');
  ok('no exception from the game on B the whole way through', !errs.err, errs);
  M.pageErrorsB = B.logs.filter((l) => /exception|error/.test(l)).slice(-5);
} catch (err) {
  ok('the playtest ran to the end', false, String((err && err.stack) || err).slice(0, 800));
} finally {
  if (A) await A.close().catch(() => {});
  if (B) await B.close().catch(() => {});
}
const failed = R.filter((r) => !r.pass);
console.log(JSON.stringify({ url: URL, passed: R.length - failed.length, total: R.length, secs: Math.round((Date.now() - t0) / 1000), measured: M, failed }, null, 1));
process.exit(failed.length ? 1 : 0);
