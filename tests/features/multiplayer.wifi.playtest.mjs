/**
 * The Wi-Fi playtest: multiplayer from a PLAYER's chair.
 *
 *   node tests/features/multiplayer.wifi.playtest.mjs
 *     --tabs=3            players, each its own tab of one headless Chrome (2-4)
 *     --net=wifi          wifi: 60-150 ms a leg, ±40 ms jitter, 2 % of snapshots lost
 *                         lan:  2-10 ms a leg, ±8 ms, 0.5 % lost;  none: loopback as it is
 *     --secs=20           how long each measured stretch is
 *     --range             also put a friend 1 to 40 km away and see what is drawn
 *     --url=...           a LAN server already serving the game (else one is started)
 *     --ab=<url>          a second lobby at the same time from another server (the live
 *                         version): before and after side by side, in the same seconds
 *     --small             800x500 windows (six games at once)
 *     --raw               every recorded row in the --json file
 *     --healthy           smoothness only while no game in the lobby had stopped (see stopsOf)
 *     --json=<file>       the numbers, for the record
 *
 * The older playtests stub the draw call and drive update() from a timer at
 * 30 Hz over loopback. This one does what a player's computer does: the
 * game's own requestAnimationFrame loop, the real renderer on the GPU, and a
 * pretend Wi-Fi on every data channel (link.js, Link.netsim) — loopback has
 * no latency and loses nothing, which hides exactly what players feel.
 *
 * The players join Lobby 1 through the lobby screen, go up together and fly
 * on the autopilot — S-turns, climbs, descents — for `secs`, and every tab
 * records, on the one clock all tabs share (performance.timeOrigin + now):
 *
 *   - its own aeroplane every frame (where it REALLY is);
 *   - where it draws every friend every frame, and whether the model, the
 *     tag and the dot are shown;
 *   - every snapshot that reaches it: when, and when it was sent;
 *   - its frame: the whole callback, the multiplayer features' share of it
 *     (multiplayer, bump, pvp, mp-world, race), draw calls and triangles;
 *   - what it sends: packets and bytes a second, and the host's relay time.
 *
 * Then everybody leaves and flies the same way alone for `secs`: the frame
 * cost without multiplayer, on the same island and the same flight.
 *
 * Per friend, as seen by each player: how far from where they really are
 * (mean, 95th percentile), how far behind in ms, how old a snapshot is when
 * it lands (end to end, through the host), the longest wait between two, and
 * how smooth the drawn path is — per minute: TELEPORTS (a frame's step more
 * than 5 m off the real one), BACKWARDS frames (rubber-banding), SURGES and
 * STALLS (a frame drawn at under half or over one and a half times the real
 * speed), and the 95th percentile of the attitude error.
 *
 * Holds one of the shared headless-Chrome slots (the same lock as
 * .claude/devtools/cdp.mjs) with background throttling off: every tab is a
 * player's computer with the game in front.
 *
 * MEASURED 2026-10-09 (v62, three players, --net=wifi --healthy, software GL
 * on a busy Mac, 36-42 fps): friends drawn within 1-2 m of where they are
 * (95th percentile 0.7-2 m; the mean is bigger only for the frames right
 * after a friend's own game froze for 0.9 s), 15-45 ms AHEAD rather than the
 * 100-250 ms behind of v55-v61 (the lead is the jitter floor the clock
 * offset finds that the pings' median does not: smaller on a steadier
 * Wi-Fi); no teleports, nothing drawn backwards and no stalls while nobody's
 * game had stopped; the multiplayer features cost 0.2-0.3 ms a frame, the
 * frame's median 1.0 ms more than alone (two more aeroplanes to draw);
 * --range: the real model to 1 km, a one-draw-call stand-in to about 3 km,
 * then the dot under the name out to 40 km, while v61 lost the name past
 * 8 km. --ab against v61 is NOT a lag comparison: v61 has no Link.netsim, so
 * its lobby runs on loopback.
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
const ok = (name, pass, detail = '') => {
  R.push({ name, pass: !!pass, detail });
  log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return pass;
};

const TABS = Math.max(2, Math.min(4, Number(arg('tabs', 3)) || 3));
const SECS = Math.max(5, Number(arg('secs', 20)) || 20);
const NETS = {
  none: null,
  lan: { latency: [2, 10], jitter: 8, loss: 0.005 },
  wifi: { latency: [60, 150], jitter: 40, loss: 0.02 },
};
const NET_NAME = String(arg('net', 'wifi'));
if (!(NET_NAME in NETS)) throw new Error(`--net must be one of ${Object.keys(NETS).join(', ')}`);
const NET = NETS[NET_NAME];

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

/* ---- one Chrome, a tab per player --------------------------------------- */
let chrome = null;
async function launch() {
  if (chrome) return chrome;
  const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  slot = await acquireSlot();
  const dir = mkdtempSync(join(tmpdir(), 'ifs-wifi-chrome-'));
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

/*
 * The browser itself, for opening windows. A tab opened the usual way
 * (/json/new) is a background tab of one window: hidden, so its
 * requestAnimationFrame never fires and the game in it does not run — the
 * first try at this test measured one player out of three. So every player
 * gets a WINDOW of their own, in a browser context of their own: in front,
 * its own renderer, and its own storage, like a computer of their own.
 */
let browserWs = null;
async function browserSend(method, params = {}) {
  const c = await launch();
  if (!browserWs) {
    const v = await (await fetch(`http://127.0.0.1:${c.port}/json/version`)).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const waiting = new Map();
    let n = 0;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && waiting.has(m.id)) {
        const { res, rej } = waiting.get(m.id);
        waiting.delete(m.id);
        if (m.error) rej(new Error(m.error.message)); else res(m.result);
      }
    };
    browserWs = { ws, send: (mth, p) => new Promise((res, rej) => { const k = ++n; waiting.set(k, { res, rej }); ws.send(JSON.stringify({ id: k, method: mth, params: p })); }) };
  }
  return browserWs.send(method, params);
}

async function openPage(url, name, timeoutS = 240) {
  const c = await launch();
  const { browserContextId } = await browserSend('Target.createBrowserContext', {});
  // --small: 800x500 windows, so six games at once leave the Mac some room.
  const size = arg('small') ? { width: 800, height: 500 } : {};
  const { targetId } = await browserSend('Target.createTarget', { url: 'about:blank', browserContextId, newWindow: true, ...size });
  const target = { id: targetId, browserContextId };
  const ws = new WebSocket(`ws://127.0.0.1:${c.port}/devtools/page/${targetId}`);
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
    eval: (body, secs = timeoutS) => raw(`(async () => { const sim = window.__sim; const wt = window.__wt; const mp = wt && wt.mp; ${body}\n})()`, secs * 1000),
    async close() {
      try { ws.close(); } catch (e) { /* closed */ }
      await browserSend('Target.closeTarget', { targetId: target.id }).catch(() => {});
      await browserSend('Target.disposeBrowserContext', { browserContextId: target.browserContextId }).catch(() => {});
    },
  };
}

/* ---- inside each tab ---------------------------------------------------- */
/*
 * The instruments. Nothing here changes what the game does: the frame loop,
 * the renderer and the network are the game's own; the wrappers only read
 * the clock around them.
 */
const PAGE = (name, colour, net) => `
if (!window.__wt) {
  const s = sim;
  const THREE = await import('/src/vendor/three.module.js');
  const mpMod = await import('/src/features/multiplayer.js');
  const linkMod = await import('/src/features/multiplayer/link.js');
  const sessMod = await import('/src/features/multiplayer/session.js');
  const extMod = await import('/src/game/extensions.js');
  const T0 = performance.timeOrigin;
  const wt = (window.__wt = { THREE, mpMod, linkMod, mp: mpMod.multiplayer, T0, rec: false, frames: [], own: [], drawn: [], arr: [], out: { n: 0, bytes: 0 }, relay: { ms: 0, n: 0 }, ext: {}, mpF: 0, extF: 0, pilot: null });
  linkMod.Link.netsim = ${JSON.stringify(net)};
  // Every extension's update, timed; the multiplayer family's added up per frame.
  const MPX = new Set(['multiplayer', 'bump', 'pvp', 'mp-world', 'race', 'pilot-mp']);
  for (const e of extMod.extensions()) {
    if (typeof e.update !== 'function') continue;
    const f = e.update;
    const id = e.id;
    e.update = function (...a) {
      const t = performance.now();
      try { return f.apply(this, a); } finally {
        const d = performance.now() - t;
        wt.extF += d;
        if (MPX.has(id)) wt.mpF += d;
        if (wt.rec) wt.ext[id] = (wt.ext[id] || 0) + d;
      }
    };
  }
  // The frame: the game's own loop asks for the next one at the top of each, so from the next frame on it comes through here.
  const raf = window.requestAnimationFrame.bind(window);
  // Held while the other players' games load: a game loading beside three running ones took minutes.
  wt.release = () => { wt.hold = false; const cb = wt.held; wt.held = null; if (cb) window.requestAnimationFrame(cb); };
  /*
   * Only the game's own loop (main.js, loop(): \`const tick = () => { requestAnimationFrame(tick); ... this.update(dt) ...}\`)
   * is a frame. Other code asks for a frame now and then (afterPaint, the UI); counting those as frames made
   * the first version of this test read three games at 7.5 frames a second as fifteen.
   */
  const isGame = (cb) => cb === wt.gameTick || (cb.name === 'tick' && /this\\.update\\(dt\\)/.test(String(cb)) && (wt.gameTick = cb));
  wt.pt = { tick: 0, rem: 0, mini: 0, upd: 0, draw: 0 };
  // The game's update and the draw, apart: a slow frame is one or the other.
  {
    const up = s.update.bind(s);
    s.update = (dt) => { const t1 = performance.now(); try { return up(dt); } finally { wt.pt.upd += performance.now() - t1; } };
    const rr = s.renderer.render.bind(s.renderer);
    s.renderer.render = (...x) => { const t1 = performance.now(); try { return rr(...x); } finally { wt.pt.draw += performance.now() - t1; } };
  }
  window.requestAnimationFrame = (cb) => {
    if (!isGame(cb)) return raf(cb);
    if (wt.hold) { wt.held = cb; return 0; }
    return raf((ts) => {
      const a = performance.now();
      if (wt.pilot) { try { wt.pilot(a); } catch (err) { wt.pilotErr = String(err).slice(0, 200); } }
      const hud = wt.mp.hud;
      if (hud && !hud.__timed) {
        hud.__timed = true;
        const mm = hud.minimap.bind(hud);
        hud.minimap = (...x) => { const t1 = performance.now(); try { return mm(...x); } finally { wt.pt.mini += performance.now() - t1; } };
      }
      wt.mpF = 0;
      wt.extF = 0;
      wt.pt.tick = wt.pt.rem = wt.pt.mini = wt.pt.upd = wt.pt.draw = 0;
      cb(ts);
      const b = performance.now();
      if (wt.rec) {
        const info = s.renderer.info.render;
        wt.frames.push([T0 + a, b - a, wt.mpF, wt.extF, info.calls, info.triangles, wt.pt.tick, wt.pt.rem, wt.pt.mini, wt.pt.upd, wt.pt.draw]);
        const ac = s.aircraft;
        if (s.state === 'flying') wt.own.push([T0 + a, ac.pos.x, ac.pos.y, ac.pos.z, ac.quat.x, ac.quat.y, ac.quat.z, ac.quat.w, ac.vel.x, ac.vel.y, ac.vel.z]);
      }
    });
  };
  // Where each friend is drawn, at the very moment the game worked it out.
  const Rm = wt.mp.remotes;
  const ru = Rm.update.bind(Rm);
  Rm.update = (dt, now, sim2, tags) => {
    const t1 = performance.now();
    const out = ru(dt, now, sim2, tags);
    wt.pt.rem += performance.now() - t1;
    if (wt.rec) {
      for (const p of Rm.players.values()) {
        if (!p.visible || !p.drawn) continue;
        const q = p.quat || { x: 0, y: 0, z: 0, w: 1 };
        wt.drawn.push([T0 + now, p.name, p.drawn.x, p.drawn.y, p.drawn.z, q.x, q.y, q.z, q.w,
          p.model && p.model.visible ? 1 : 0, p.tag && p.tag.sprite.visible ? 1 : 0, p.tag && p.tag.pip.visible ? 1 : 0, Math.round(p.dist)]);
      }
    }
    return out;
  };
  // Every snapshot that lands: when, from whom, sent when (their clock).
  const rp = Rm.push.bind(Rm);
  Rm.push = (snap, now) => {
    if (wt.rec) { const p = Rm.players.get(snap.id); wt.arr.push([T0 + now, p ? p.name : '#' + snap.id, snap.t]); }
    return rp(snap, now);
  };
  // What this tab sends on the state channel.
  const LP = linkMod.Link.prototype;
  const ss = LP.sendState;
  LP.sendState = function (buf) {
    const r = ss.call(this, buf);
    if (wt.rec && r) { wt.out.n++; wt.out.bytes += buf.byteLength + 28; }
    return r;
  };
  // The sessions' own once-a-frame work.
  for (const C of [sessMod.HostSession, sessMod.ClientSession]) {
    const tk = C.prototype.tick;
    C.prototype.tick = function (...x) { const t1 = performance.now(); try { return tk.apply(this, x); } finally { wt.pt.tick += performance.now() - t1; } };
  }
  // The host's relay: decode, stamp, queue and maybe send, per snapshot that arrives.
  const HP = sessMod.HostSession.prototype;
  const hs = HP._state;
  HP._state = function (p, buf) {
    const t = performance.now();
    try { return hs.call(this, p, buf); } finally { if (wt.rec) { wt.relay.ms += performance.now() - t; wt.relay.n++; } }
  };
  wt.until = async (fn, ms = 20000, step = 50) => {
    const t1 = performance.now();
    for (;;) {
      let v = null;
      try { v = fn(); } catch (err) { v = null; }
      if (v) return { v, ms: Math.round(performance.now() - t1) };
      if (performance.now() - t1 > ms) return { v: null, ms: Math.round(performance.now() - t1) };
      await new Promise((r) => setTimeout(r, step));
    }
  };
  wt.click = (sel) => { const el = document.querySelector(sel); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; };
  wt.text = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null; };
  wt.airborne = (x, z, heading, agl = 350) => {
    const ac = s.aircraft;
    ac.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: heading, speed: 55, altAGL: agl, engineOn: true, gearDown: false });
    ac.controls.throttle = 0.7;
    if (s.input) { s.input.throttleTarget = 0.7; if (s.input.out) s.input.out.throttle = 0.7; }
  };
  /*
   * The flight: the autopilot, given a new heading and height every few
   * seconds — the turns, climbs and descents of an ordinary flight together.
   */
  wt.fly = (plan) => {
    const ap = s.autopilot;
    ap.setMode('level');
    ap.setSelectedVs(1200);
    if (!ap.engaged) s.toggleAutopilot(true);
    let k = -1;
    const start = performance.now();
    wt.pilot = (now) => {
      const i = Math.floor((now - start) / plan.every);
      if (i === k) return;
      k = i;
      const leg = plan.legs[i % plan.legs.length];
      ap.setSelectedHeading(leg[0]);
      ap.setSelectedAlt(leg[1]);
      if (!ap.engaged && !s.aircraft.onGround) s.toggleAutopilot(true);
    };
  };
  /*
   * A take-off: on the runway, full power, rotate at 32 m/s, climb away, and
   * the autopilot from 120 m — a friend on the ground accelerating, lifting
   * off and climbing, the hard part for any guess.
   */
  const { RUNWAY_START } = await import('/src/game/missions.js');
  wt.takeoff = (plan) => {
    const ac = s.aircraft;
    if (s.autopilot.engaged) s.toggleAutopilot(false);
    ac.reset({ ...RUNWAY_START, engineOn: true });
    s.override = { throttle: 1, brakes: 0, pitch: 0, roll: 0, yaw: 0 };
    let phase = 0;
    wt.pilot = () => {
      const spd = Math.hypot(ac.vel.x, ac.vel.y, ac.vel.z);
      const agl = Number.isFinite(ac.agl) ? ac.agl : 0;
      if (phase === 0 && spd > 32) { s.override.pitch = 0.45; phase = 1; }
      else if (phase === 1 && !ac.onGround && agl > 25) { s.override.pitch = 0.15; phase = 2; }
      else if (phase === 2 && agl > 120) { s.override = null; wt.tookOff = performance.now(); wt.fly(plan); }
    };
  };
  wt.take = () => {
    const out = { frames: wt.frames, own: wt.own, drawn: wt.drawn, arr: wt.arr, out: wt.out, relay: wt.relay, ext: wt.ext, T0, role: wt.mp.role, me: wt.mp.profile.name };
    wt.frames = []; wt.own = []; wt.drawn = []; wt.arr = []; wt.out = { n: 0, bytes: 0 }; wt.relay = { ms: 0, n: 0 }; wt.ext = {};
    return out;
  };
}
window.__wt.hold = true;
window.__wt.mp.install(sim);
window.__wt.mp.setProfile({ name: ${JSON.stringify(name)}, colour: ${JSON.stringify(colour)}, chosen: true });
return { state: sim.state, map: sim.settings.map, name: window.__wt.mp.profile.name };`;

const NAMES = ['Swift Falcon', 'Brave Otter', 'Sunny Puffin', 'Jolly Penguin'];
const COLOURS = ['#ff5a4f', '#4fd684', '#58c6ff', '#ffd23f'];
/*
 * Each player's flight: [heading, feet] legs, a new one every `every` ms.
 * Close enough together that everybody is in sight of everybody, and the
 * turns are the autopilot's own — about 25° of bank, as a player flies.
 */
const PLANS = [
  { every: 6000, legs: [[90, 1500], [150, 1600], [60, 1400], [120, 1500]] },
  { every: 5000, legs: [[90, 1700], [40, 2000], [110, 1800], [80, 1500]] },
  { every: 7000, legs: [[90, 1300], [130, 1200], [70, 1500], [100, 1400]] },
  { every: 5500, legs: [[90, 1900], [60, 1700], [140, 2100], [95, 1800]] },
];

/* ---- the numbers ----------------------------------------------------------- */
const pct = (a, p) => {
  if (!a.length) return 0;
  const b = Float64Array.from(a).sort();
  return b[Math.min(b.length - 1, Math.floor(b.length * p))];
};
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const qAngle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * 180 / Math.PI;

/** Where `own` (a tab's own frames) really was at shared-clock time e: between its two frames either side. */
function truthAt(own, e, hint) {
  let i = hint.i || 0;
  while (i < own.length - 1 && own[i + 1][0] < e) i++;
  while (i > 0 && own[i][0] > e) i--;
  hint.i = i;
  const a = own[i];
  const b = own[i + 1];
  if (!b || a[0] > e || b[0] - a[0] > 250) return null;
  const k = (e - a[0]) / (b[0] - a[0] || 1);
  return {
    x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k, z: a[3] + (b[3] - a[3]) * k,
    q: k < 0.5 ? [a[4], a[5], a[6], a[7]] : [b[4], b[5], b[6], b[7]],
    vx: a[8] + (b[8] - a[8]) * k, vy: a[9] + (b[9] - a[9]) * k, vz: a[10] + (b[10] - a[10]) * k,
  };
}

function frameStats(frames) {
  const ms = frames.map((f) => f[1]);
  const mpms = frames.map((f) => f[2]);
  const part = (k) => r2(mean(frames.map((f) => f[k] || 0)));
  const gaps = [];
  for (let i = 1; i < frames.length; i++) gaps.push(frames[i][0] - frames[i - 1][0]);
  const span = frames.length > 1 ? (frames[frames.length - 1][0] - frames[0][0]) / 1000 : 1;
  return {
    fps: r1((frames.length - 1) / span), frameMs: r2(mean(ms)), frameMed: r2(pct(ms, 0.5)), frameP95: r2(pct(ms, 0.95)),
    mpMs: r2(mean(mpms)), mpMed: r2(pct(mpms, 0.5)), mpP95: r2(pct(mpms, 0.95)), calls: Math.round(mean(frames.map((f) => f[4]))),
    tickMs: part(6), remotesMs: part(7), minimapMs: part(8), updMed: r2(pct(frames.map((f) => f[9] || 0), 0.5)), drawMed: r2(pct(frames.map((f) => f[10] || 0), 0.5)),
    tris: Math.round(mean(frames.map((f) => f[5]))), longFrames: gaps.filter((g) => g > 50).length,
  };
}

/** Everything one tab saw of one friend. */
/*
 * When any game in the lobby stopped: a frame that took over 150 ms, in any
 * tab. Two things stop them that are not the network or the drawing: a heavy
 * frame of the game's own, and — on the Mac this was written on — the CPU
 * governor that stops and continues the builders' processes to keep the
 * machine cool and on battery. A stopped host relays nothing; a stopped
 * sender sends nothing and stands still; a stopped observer draws nothing and
 * then a burst. `--healthy` leaves those moments out of the smoothness
 * numbers (from 0.2 s before to 0.8 s after each stop) and says how much of
 * the stretch was left: what is left is the network and the drawing.
 */
function stopsOf(group) {
  const out = [];
  for (const d of group) {
    // A stop is a frame three times as long as this tab's usual one, and never under 150 ms: a slow game is not a stopped one.
    const gaps = [];
    for (let i = 1; i < d.frames.length; i++) gaps.push(d.frames[i][0] - d.frames[i - 1][0]);
    const limit = Math.max(150, 3 * pct(gaps, 0.5));
    for (let i = 1; i < d.frames.length; i++) {
      if (d.frames[i][0] - d.frames[i - 1][0] > limit) out.push([d.frames[i - 1][0] - 200, d.frames[i][0] + 800]);
    }
  }
  return out;
}
const inStop = (stops, e) => stops.some(([a, b]) => e >= a && e <= b);

function pairStats(obs, friend, timeOrigins, stops = []) {
  const own = friend.own;
  const all = obs.drawn.filter((d) => d[1] === friend.me);
  const rows = all.filter((d) => !inStop(stops, d[0]));
  const hint = { i: 0 };
  const trail = [];
  const behind = [];
  const rot = [];
  let teleports = 0;
  let back = 0;
  let surge = 0;
  let stall = 0;
  let frames = 0;
  let prev = null;
  let model = 0;
  let tag = 0;
  for (const d of rows) {
    const e = d[0];
    const tr = truthAt(own, e, hint);
    if (!tr) { prev = null; continue; }
    frames++;
    model += d[9];
    tag += d[10] || d[11] ? 1 : 0;
    const ex = d[2] - tr.x;
    const ey = d[3] - tr.y;
    const ez = d[4] - tr.z;
    trail.push(Math.hypot(ex, ey, ez));
    const sp = Math.hypot(tr.vx, tr.vy, tr.vz);
    if (sp > 3) behind.push((-(ex * tr.vx + ey * tr.vy + ez * tr.vz) / sp / sp) * 1000);
    rot.push(qAngle([d[5], d[6], d[7], d[8]], tr.q));
    if (prev && e - prev.e > 1 && e - prev.e < 200) {
      const dt = (e - prev.e) / 1000;
      // The step drawn this frame, against the step they really made.
      const dx = d[2] - prev.x, dy = d[3] - prev.y, dz = d[4] - prev.z;
      const tx = tr.x - prev.tr.x, ty = tr.y - prev.tr.y, tz = tr.z - prev.tr.z;
      const off = Math.hypot(dx - tx, dy - ty, dz - tz);
      if (off > Math.max(5, Math.hypot(tx, ty, tz) * 2)) teleports++;
      const tl = Math.hypot(tx, ty, tz);
      if (tl / dt > 3) {
        const along = (dx * tx + dy * ty + dz * tz) / tl;
        if (along < -0.02) back++;
        else if (along < 0.5 * tl) stall++;
        else if (along > 1.5 * tl) surge++;
      }
    }
    prev = { e, x: d[2], y: d[3], z: d[4], tr };
  }
  // Snapshots from this friend: how old each was on landing, and the longest waits.
  const arr = obs.arr.filter((a) => a[1] === friend.me);
  const ages = arr.map((a) => a[0] - (timeOrigins[friend.me] + a[2]));
  const waits = [];
  for (let i = 1; i < arr.length; i++) waits.push(arr[i][0] - arr[i - 1][0]);
  const span = rows.length > 1 ? (rows[rows.length - 1][0] - rows[0][0]) / 60000 : 1;
  const pm = (x) => r1(x / (span || 1));
  return {
    // drawnFrames: every frame they were drawn, stops and all (frames: those measured, which --healthy thins out).
    frames, drawnFrames: all.length, trailMean: r2(mean(trail)), trailP95: r2(pct(trail, 0.95)), trailMax: r1(pct(trail, 1)),
    behindMs: Math.round(mean(behind)), rotP95: r1(pct(rot, 0.95)),
    teleportsPerMin: pm(teleports), backPerMin: pm(back), stallPerMin: pm(stall), surgePerMin: pm(surge),
    snapHz: r1(arr.length / ((span || 1) * 60)), ageMean: Math.round(mean(ages)), ageP95: Math.round(pct(ages, 0.95)), waitP95: Math.round(pct(waits, 0.95)), waitMax: Math.round(pct(waits, 1)),
    modelPct: Math.round((100 * model) / (frames || 1)), tagPct: Math.round((100 * tag) / (frames || 1)),
    healthyPct: Math.round((100 * rows.length) / (all.length || 1)),
  };
}

/* ---- the run --------------------------------------------------------------- */
/*
 * --ab=<url> runs a second lobby at the same time, from another server — the
 * live version, say — so before and after are measured side by side on the
 * same machine in the same seconds. This Mac's own load (and the CPU governor
 * that stops and starts the builders' processes) swings by the minute, and two
 * runs a few minutes apart were not comparable.
 */
const url = await serve();
const GROUPS = [...(arg('ab') ? [{ name: 'before', url: arg('ab') }] : []), { name: arg('ab') ? 'after' : 'this', url }];
// --after-first: open the "after" lobby's windows first (whether the windows opened last fare worse on a loaded Mac).
if (arg('after-first')) GROUPS.reverse();
log(`${GROUPS.map((g) => `${g.name}: ${g.url}`).join('; ')}; ${TABS} players each; network: ${NET_NAME} ${NET ? JSON.stringify(NET) : '(loopback)'}`);
const pages = [];
const M = { net: NET_NAME, tabs: TABS, secs: SECS, groups: {} };
let exitCode = 1;
const cols = ['trailMean', 'trailP95', 'behindMs', 'ageMean', 'ageP95', 'waitP95', 'teleportsPerMin', 'backPerMin', 'stallPerMin', 'surgePerMin', 'rotP95', 'snapHz', 'modelPct', 'tagPct', 'healthyPct'];
const fc = ['fps', 'frameMs', 'frameMed', 'frameP95', 'updMed', 'drawMed', 'mpMs', 'mpMed', 'mpP95', 'tickMs', 'remotesMs', 'minimapMs', 'calls', 'tris'];
try {
  for (const g of GROUPS) {
    g.pages = [];
    for (let i = 0; i < TABS; i++) {
      const p = await openPage(`${g.url}?dev=1`, `${g.name}${i + 1}`, 420);
      const r = await p.eval(PAGE(NAMES[i], COLOURS[i], NET), 120);
      g.pages.push(p);
      pages.push(p);
      log(`${g.name}${i + 1} up as ${r.name} (${r.state}, ${r.map})`);
    }
  }
  const vis = await Promise.all(pages.map((p) => p.eval('wt.release(); await new Promise((r) => setTimeout(r, 1500)); return { vis: document.visibilityState, fps: sim.fps };')));
  ok('every player\'s game is in front and running', vis.every((v) => v.vis === 'visible'), vis.map((v) => `${v.vis}`).join(','));
  // Lobby 1 on each server, through the lobby screen.
  await Promise.all(pages.map((p) => p.eval(`
    mp.openLobbies();
    const r = await wt.until(() => document.querySelectorAll('[data-mp-lobby].is-empty, [data-mp-lobby].is-open, [data-mp-lobby].is-full').length >= 5, 30000);
    return r.ms;`, 60)));
  const join = (p) => p.eval(`
    const t1 = performance.now();
    wt.click('[data-mp-lobby-join="1"]');
    const r = await wt.until(() => (mp.ready && mp.lobby && sim.state === 'flying') || (!mp.busy && !mp.lobby && document.querySelector('[data-mp-status]').textContent), 60000);
    return { ms: Math.round(performance.now() - t1), role: mp.role, status: wt.text('[data-mp-status]'), map: sim.settings.map };`, 90);
  await Promise.all(GROUPS.map(async (g) => {
    g.joins = [];
    for (const p of g.pages) {
      g.joins.push(await join(p));
      await sleep(500);
    }
    ok(`${g.name}: ${TABS} players in Lobby 1, one host`, g.joins.filter((j) => j.role === 'host').length === 1 && g.joins.every((j) => j.role), g.joins.map((j) => `${j.role}:${j.ms}ms`).join(' '));
  }));

  // The third player takes off from the runway while the others circle over it; everybody else is up already.
  const flyOne = (p, i) => p.eval(i === 2 && !arg('no-takeoff') ? `
    wt.takeoff(${JSON.stringify(PLANS[i])});
    return true;` : `
    wt.airborne(${-900 + i * 40}, ${(i - (TABS - 1) / 2) * 260}, 90, ${300 + i * 30});
    wt.fly(${JSON.stringify(PLANS[i])});
    return true;`);
  const fly = () => Promise.all(GROUPS.flatMap((g) => g.pages.map((p, i) => flyOne(p, i))));
  // Everybody sees everybody before anything is measured.
  await Promise.all(GROUPS.flatMap((g) => g.pages.map((p, i) => p.eval(`wt.airborne(${-900 + i * 40}, ${(i - (TABS - 1) / 2) * 260}, 90, ${300 + i * 30}); return true;`))));
  for (let k = 0; k < 30; k++) {
    const seen = await Promise.all(pages.map((p) => p.eval('return [...mp.remotes.players.values()].filter((q) => q.visible).length;')));
    if (seen.every((n) => n === TABS - 1)) break;
    await sleep(1000);
  }
  // A few seconds for the latency to be learnt from the pings (multiplayer.js, syncLatency), then the flight.
  await sleep(6000);
  await fly();
  await sleep(500);

  // Every tab of every group at once.
  const record = async (secs) => {
    await Promise.all(pages.map((p) => p.eval('wt.take(); wt.rec = true; return true;')));
    await sleep(secs * 1000);
    const all = await Promise.all(pages.map((p) => p.eval('wt.rec = false; return wt.take();', 120)));
    let k = 0;
    return GROUPS.map((g) => all.slice(k, (k += g.pages.length)));
  };

  log(`measuring ${SECS} s together`);
  const mpAll = await record(SECS);
  GROUPS.forEach((g, gi) => {
    const mpData = mpAll[gi];
    const timeOrigins = Object.fromEntries(mpData.map((d) => [d.me, d.T0]));
    const stops = arg('healthy') ? stopsOf(mpData) : [];
    const G = (M.groups[g.name] = { mp: {}, solo: {} });
    // --raw: every row, for a closer look afterwards.
    if (arg('raw')) G.raw = mpData.map((d) => ({ me: d.me, T0: d.T0, frames: d.frames, own: d.own, drawn: d.drawn, arr: d.arr }));
    for (const d of mpData) {
      G.mp[d.me] = {
        role: d.role, ...frameStats(d.frames),
        sentPerSec: r1(d.out.n / SECS), sentKBps: r2(d.out.bytes / SECS / 1024),
        relayMsPerSec: r2(d.relay.ms / SECS), relayed: d.relay.n,
        ext: Object.fromEntries(Object.entries(d.ext).map(([k, v]) => [k, r2(v / Math.max(1, d.frames.length))]).filter(([, v]) => v >= 0.01)),
        friends: Object.fromEntries(mpData.filter((f) => f.me !== d.me).map((f) => [f.me, pairStats(d, f, timeOrigins, stops)])),
      };
    }
  });

  // Alone: everybody leaves (the players first, the host last) and flies on the same way.
  await Promise.all(GROUPS.map(async (g) => { for (const p of [...g.pages].reverse()) await p.eval(`mp.leave('left'); return true;`); }));
  await sleep(1500);
  await fly();
  await sleep(3000);
  log(`measuring ${SECS} s alone`);
  const soloAll = await record(SECS);
  GROUPS.forEach((g, gi) => { M.groups[g.name].solo = Object.fromEntries(soloAll[gi].map((d) => [d.me, frameStats(d.frames)])); });

  for (const g of GROUPS) {
    const G = M.groups[g.name];
    console.log(`\n== ${g.name} (${g.url}) — network ${NET_NAME}, ${TABS} players, ${SECS} s each\n`);
    console.log(`${'seen by → friend'.padEnd(32)}${cols.map((c) => c.padStart(10)).join('')}`);
    for (const [me, v] of Object.entries(G.mp)) for (const [f, st] of Object.entries(v.friends)) console.log(`${`${me} → ${f}`.padEnd(32)}${cols.map((c) => String(st[c]).padStart(10)).join('')}`);
    console.log(`\n${'frame'.padEnd(32)}${fc.map((c) => c.padStart(10)).join('')}`);
    for (const me of Object.keys(G.mp)) {
      console.log(`${`${me} (${G.mp[me].role}) MP`.padEnd(32)}${fc.map((c) => String(G.mp[me][c]).padStart(10)).join('')}`);
      console.log(`${`${me} alone`.padEnd(32)}${fc.map((c) => String(G.solo[me][c]).padStart(10)).join('')}`);
    }
    console.log('');
    for (const [me, v] of Object.entries(G.mp)) console.log(`${me} (${v.role}): sends ${v.sentPerSec}/s, ${v.sentKBps} KB/s; relay ${v.relayMsPerSec} ms/s over ${v.relayed}; ext ms/frame ${JSON.stringify(v.ext)}`);
    const pairs = Object.values(G.mp).flatMap((v) => Object.values(v.friends));
    G.summary = {
      trailMean: r2(mean(pairs.map((p) => p.trailMean))),
      trailP95: r2(mean(pairs.map((p) => p.trailP95))),
      behindMs: Math.round(mean(pairs.map((p) => p.behindMs))),
      teleportsPerMin: r1(mean(pairs.map((p) => p.teleportsPerMin))),
      backPerMin: r1(mean(pairs.map((p) => p.backPerMin))),
      stallPerMin: r1(mean(pairs.map((p) => p.stallPerMin))),
      surgePerMin: r1(mean(pairs.map((p) => p.surgePerMin))),
      rotP95: r1(mean(pairs.map((p) => p.rotP95))),
      ageMean: Math.round(mean(pairs.map((p) => p.ageMean))),
      snapHz: r1(mean(pairs.map((p) => p.snapHz))),
      healthyPct: Math.round(mean(pairs.map((p) => p.healthyPct))),
      mpMsPerFrame: r2(mean(Object.values(G.mp).map((v) => v.mpMs))),
      mpMedPerFrame: r2(mean(Object.values(G.mp).map((v) => v.mpMed))),
      frameMedMP: r2(mean(Object.values(G.mp).map((v) => v.frameMed))),
      frameMedSolo: r2(mean(Object.values(G.solo).map((v) => v.frameMed))),
      frameMsMP: r2(mean(Object.values(G.mp).map((v) => v.frameMs))),
      frameMsSolo: r2(mean(Object.values(G.solo).map((v) => v.frameMs))),
      fpsMP: r1(mean(Object.values(G.mp).map((v) => v.fps))),
      fpsSolo: r1(mean(Object.values(G.solo).map((v) => v.fps))),
    };
    console.log(`\n${g.name} summary ${JSON.stringify(G.summary)}`);
    ok(`${g.name}: every player sees every friend drawn through the whole stretch`, pairs.every((p) => p.drawnFrames > SECS * 5), pairs.map((p) => p.drawnFrames).join(','));
  }

  // Range: one friend put far away, step by step; is the model, the tag, the dot drawn?
  if (arg('range')) {
    for (const g of GROUPS) {
      const [A, B] = g.pages;
      for (const p of g.pages.slice(0, 2)) await p.eval(`mp.openLobbies(); return true;`);
      for (const p of g.pages.slice(0, 2)) { await p.eval(`wt.click('[data-mp-lobby-join="1"]'); await wt.until(() => mp.ready && mp.lobby && sim.state === 'flying', 60000); return mp.role;`, 90); await sleep(500); }
      await A.eval(`wt.pilot = null; wt.airborne(0, 0, 90, 600); return true;`);
      const range = (M.groups[g.name].range = []);
      for (const km of [1, 3, 6, 10, 15, 20, 30, 40]) {
        await B.eval(`wt.pilot = null; wt.airborne(${km * 1000}, 0, 270, 600); return true;`);
        await sleep(2500);
        const v = await A.eval(`
          wt.take(); wt.rec = true;
          await new Promise((r) => setTimeout(r, 1500));
          wt.rec = false;
          const d = wt.take();
          const fr = d.frames;
          const p = [...mp.remotes.players.values()][0];
          const dot = mp._dots && mp._dots.find ? mp._dots.find((x) => x.name === p.name) : null;
          return { dist: p ? Math.round(p.dist) : null, model: !!(p && p.model && p.model.visible), tag: !!(p && p.tag && p.tag.sprite.visible), pip: !!(p && p.tag && p.tag.pip.visible), dot: !!dot,
            standin: !!(p && p.lod && p.lod.visible), calls: fr.length ? Math.round(fr.reduce((s, f) => s + f[4], 0) / fr.length) : null };`, 60);
        range.push({ km, ...v });
        log(`${g.name} range ${km} km: ${JSON.stringify(v)}`);
      }
    }
  }
  if (GROUPS.length === 2) {
    const [b, a] = ['before', 'after'].map((n) => M.groups[n].summary);
    console.log('\nside by side (before → after):');
    for (const k of Object.keys(a)) console.log(`  ${k.padEnd(18)} ${String(b[k]).padStart(9)} → ${a[k]}`);
  }
  exitCode = R.every((r) => r.pass) ? 0 : 1;
} catch (err) {
  log(`ERROR ${err && err.stack || err}`);
  for (const p of pages) if (p.logs.length) log(`${p.name} console:\n${p.logs.slice(-15).join('\n')}`);
} finally {
  if (arg('json')) writeFileSync(arg('json'), JSON.stringify({ M, R, logs: pages.map((p) => ({ name: p.name, logs: p.logs.slice(-40) })) }, null, 1));
  for (const p of pages) await Promise.race([p.close().catch(() => {}), sleep(3000)]);
  cleanup();
}
process.exit(exitCode);
