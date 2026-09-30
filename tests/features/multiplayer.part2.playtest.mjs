/**
 * Multiplayer, part 2 of list 2, played for real: EIGHT players in eight
 * tabs of ONE headless Chrome, over tools/lan-server.py --local.
 *
 *   node tests/features/multiplayer.part2.playtest.mjs
 *     --url=http://127.0.0.1:9111/   a LAN server already serving the game (else one is started on a free port)
 *     --json=<file>                  write the numbers there too
 *     --shots=<dir>                  save the screenshots there
 *
 * Every tab runs the game in real time — main.js's own update(dt), thirty
 * times a second — and uses the real lobby screen, the real WebRTC stack and
 * the real signaling server. Proved, one item of the owner's list at a time:
 *
 *   6 PVP ON/OFF + SHOOTING — four players switch PvP on at the lobby screen,
 *     four leave it off. One chases another and holds Space: hearts, the tag,
 *     every tab's scoreboard and feed, the tagged player back higher in a
 *     shield. The same pellets through a player with PvP OFF: nothing. Two
 *     with PvP on flying into each other: both tagged out by the host.
 *   7 BUMPING — the lobby card says the rule before anybody joins; two with
 *     PvP off bump gently and fly on; two parked on the runway side by side
 *     never bump.
 *   8 THE RING RALLY — everybody leaves; one makes a private match on Coral
 *     Atoll, seven join by the code; "🏁 Race": eight on the grid, 3-2-1-GO,
 *     eight scripted pilots at eight speeds through every ring of both laps,
 *     the same results in every tab.
 *   9 A WORLD EVERYBODY SHARES — the host's storm in every tab; the host's
 *     AI aeroplanes (Dev mode, as in single player) drawn in every tab, and
 *     how far from where the host has them; a tornado summoned from the
 *     badge, a second one too soon turned down, a WILDFIRE and a meteor
 *     shower for everybody, a fog bank from the pause menu's own button; a
 *     crash marked on everybody else's minimap.
 *   THE REPAIRS (the independent check's three findings) — one tab becomes an
 *     iPad (touch, 1024x768); a lobby of the aeroplane, the iPad, the van and
 *     the boat: Space with REAL key events (pressed on the runway and let go
 *     in the air; tagged while holding it, auto-repeat and all) never leaves
 *     the brakes or the handbrake on; FIRE on the iPad covers no touch control
 *     and not the minimap, lying down and upright, and a real touch fires; a
 *     tornado summoned from the van, the wildfire and a meteor shower all
 *     happen in the van and the boat too.
 *     --repairs-only skips straight to this part.
 *
 * Holds one of the shared headless-Chrome slots (the same lock as
 * .claude/devtools/cdp.mjs), background throttling off: eight players are
 * eight computers, each with its game in front.
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
  const settle = async () => {
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
  };
  await settle();
  return {
    name,
    logs,
    send,
    /** This tab becomes an iPad: a screen this size with a touch screen, and the game loaded again so it lays itself out for fingers. */
    async touchReload(w, h) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Page.reload', {});
      await sleep(500);
      await settle();
    },
    /** A picture of the screen as it is (no resizing — an iPad stays an iPad), drawn at 0.4 of the pixels as size() explains. */
    async snapAsIs(file) {
      await raw(`(() => { const s = window.__sim; window.__pt.prWas = s.renderer.getPixelRatio(); s.renderer.setPixelRatio(0.4); s.onResize(); return true; })()`, 40000);
      await this.snap(file);
      await raw(`(() => { const s = window.__sim; s.renderer.setPixelRatio(window.__pt.prWas); window.__pt.prWas = null; s.onResize(); return true; })()`, 40000);
      return file;
    },
    eval: (body, secs = timeoutS) => raw(`(async () => { const sim = window.__sim; const pt = window.__pt; const mp = pt && pt.mp; ${body}\n})()`, secs * 1000),
    /** A real frame of the game drawn, and the screen saved — at a size, for this one picture. */
    async shot(file, w = 1366, h = 768) {
      await this.size(w, h);
      await this.snap(file);
      await this.unsize();
      return file;
    },
    /** This tab's screen set to a size ahead of a picture, so the picture itself is quick. */
    /*
     * Sized ahead, and drawn at 0.4 of the pixels: on this Mac's software WebGL, eight games in one
     * Chrome, a full-size frame took 15-20 s — longer than the 12 s after which the host drops a
     * silent player, and a tab taking its picture mid-race was dropped from the race. The 3D is a
     * little soft in the pictures; the interface over it is drawn at full size as ever.
     */
    async size(w, h) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await raw(`(async () => {
        const s = window.__sim;
        for (let i = 0; i < 200 && window.innerWidth !== ${w}; i++) await new Promise((r) => setTimeout(r, 40));
        if (window.__pt.prWas == null) window.__pt.prWas = s.renderer.getPixelRatio();
        s.renderer.setPixelRatio(0.4);
        s.onResize();
        return true; })()`, 40000);
    },
    async snap(file) {
      await raw('(() => { const s = window.__sim; window.__pt.realRender(s.scene, s.camera); return true; })()', 40000);
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    },
    async unsize() {
      await send('Emulation.clearDeviceMetricsOverride');
      await raw(`(async () => {
        const s = window.__sim;
        await new Promise((r) => setTimeout(r, 200));
        if (window.__pt.prWas != null) s.renderer.setPixelRatio(window.__pt.prWas);
        window.__pt.prWas = null;
        s.onResize();
        return true; })()`, 40000);
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
  const mods = {};
  for (const [k, u] of [['pvp', 'pvp.js'], ['PR', 'pvp/rules.js'], ['bump', 'bump.js'], ['race', 'race.js'], ['RR', 'race/rules.js'], ['world', 'mpworld.js'], ['shared', 'mpplay/shared.js'], ['traffic', 'traffic.js'], ['wild', 'wildfire.js']]) mods[k] = await import('/src/features/' + u);
  const pt = (window.__pt = { THREE, mpMod, mp: mpMod.multiplayer, ...mods, realRender: s.renderer.render.bind(s.renderer), ticks: 0, gaps: [], cards: [], tlog: [], lastCard: '', feedLog: new Set(), sawShield: false });
  s.renderer.render = () => {};
  const origin = performance.timeOrigin;
  pt.now = () => origin + performance.now();
  let last = performance.now();
  pt.timer = setInterval(() => {
    const t = performance.now();
    const dt = Math.min(0.25, (t - last) / 1000);
    if (t - last > 250) pt.gaps.push(Math.round(t - last));
    last = t;
    try { if (pt.before) pt.before(dt); } catch (err) { pt.err = 'before: ' + String(err && err.stack || err).slice(0, 300); }
    try { s.update(dt); } catch (err) { pt.err = String(err && err.stack || err).slice(0, 400); }
    try { if (pt.after) pt.after(dt); } catch (err) { pt.err = 'after: ' + String(err && err.stack || err).slice(0, 300); }
    const c = pt.shared.bigCardText();
    if (c && c !== pt.lastCard) pt.cards.push(c);
    pt.lastCard = c || '';
    for (const l of pt.shared.feedLines()) pt.feedLog.add(l);
    if (pt.shared.ghostReasons().includes('pvp-shield')) pt.sawShield = true;
    const ret = document.querySelector('.pvp-reticle');
    const fb = document.querySelector('.pvp-fire');
    if (ret && !ret.hidden) pt.sawReticle = true;
    if (fb && !fb.hidden) pt.sawFire = true;
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
  pt.text = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null; };
  pt.place = (x, y, z, heading, speed = 55) => {
    const ac = s.aircraft;
    ac.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: heading, speed, altAGL: 5, engineOn: true, gearDown: false });
    ac.pos.y = y;
    ac.controls.throttle = 0.7;
    if (s.input) { s.input.throttleTarget = 0.7; if (s.input.out) s.input.out.throttle = 0.7; }
  };
  pt.airborne = (x, z, heading, agl = 350) => {
    const ac = s.aircraft;
    ac.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: heading, speed: 55, altAGL: agl, engineOn: true, gearDown: false });
    ac.controls.throttle = 0.7;
    if (s.input) { s.input.throttleTarget = 0.7; if (s.input.out) s.input.out.throttle = 0.7; }
  };
  pt.remote = (name) => [...mp.remotes.players.values()].find((p) => p.name === name) || null;
  pt.heading = (q) => { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q); let h = Math.atan2(f.x, -f.z) * 180 / Math.PI; return h < 0 ? h + 360 : h; };
  pt.key = (down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'Space', key: ' ', bubbles: true }));
  /*
   * Flown dead straight and level, on the clock, from (x, z) along a heading at a height above the sea —
   * two of these at each other are on a collision course however each plane's own physics would have
   * pitched. Stops the moment this game feels a bump (or after 12 s), so what the bump does is seen.
   */
  /* What this game saw of one other player while flying at them: the nearest it drew them, and why it might not have bumped. */
  pt.watch = (name) => {
    pt.seen = { min: Infinity, visible: 0, ghost: 0, mine: new Set(), frames: 0 };
    pt.after = () => {
      const r = pt.remote(name);
      const me = s.aircraft.pos;
      pt.seen.frames++;
      for (const g of pt.shared.ghostReasons()) pt.seen.mine.add(g);
      if (!r || !r.drawn) return;
      if (r.visible) pt.seen.visible++;
      if (r.sample && r.sample.snap && r.sample.snap.ghost) pt.seen.ghost++;
      pt.seen.min = Math.min(pt.seen.min, Math.hypot(r.drawn.x - me.x, r.drawn.y - me.y, r.drawn.z - me.z));
    };
  };
  pt.fly = (x, z, heading, y, speed) => {
    const t0 = performance.now();
    const p0 = pt.bump.bumpDebug().stats.pushes;
    const hr = heading * Math.PI / 180;
    pt.before = () => {
      const t = (performance.now() - t0) / 1000;
      if (t > 30 || pt.bump.bumpDebug().stats.pushes > p0 || pt.pvp.pvpDebug().P.down) { pt.before = null; return; }
      pt.place(x + Math.sin(hr) * speed * t, y, z - Math.cos(hr) * speed * t, heading, speed);
    };
  };
}
window.__pt.mp.setProfile({ name: ${JSON.stringify(name)}, colour: ${JSON.stringify(colour)}, chosen: true });
window.__pt.mp.setPvp(false);
return { state: sim.state, map: sim.settings.map, name: window.__pt.mp.profile.name };`;

const NAMES = ['Swift Falcon', 'Brave Otter', 'Sunny Puffin', 'Jolly Penguin', 'Clever Koala', 'Mighty Moose', 'Gentle Lark', 'Happy Hedgehog'];
const COLOURS = ['#ff5a4f', '#ff9f1c', '#ffd23f', '#4fd684', '#2ec4b6', '#58c6ff', '#a78bfa', '#ff7eb6'];
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
const shot = async (p, name, w, h) => {
  if (!SHOTS) return null;
  mkdirSync(SHOTS, { recursive: true });
  try {
    const f = await p.shot(join(SHOTS, name), w, h);
    log(`screenshot ${f}`);
    M.shots.push(name);
    return f;
  } catch (err) {
    log(`screenshot ${name} failed: ${err.message}`);
    return null;
  }
};

/* ---- the repairs: the independent check's three findings, played for real ------------------------------ */
/*
 * After the race everybody leaves. Happy Hedgehog's game becomes an iPad (1024x768 with a touch screen,
 * loaded again so it lays itself out for fingers). Four make Lobby 1: Swift Falcon in the aeroplane
 * (hosting), Happy Hedgehog on the iPad, Gentle Lark in the van, Mighty Moose in the boat — PvP on for all
 * but the boat.
 *
 *   SPACE      REAL key events (CDP Input.dispatchKeyEvent, auto-repeat and all), not synthetic ones:
 *              Space pressed on the runway and let go in the air; tagged while holding Space, in the
 *              aeroplane and in the van. The brakes and the handbrake come off every time.
 *   FIRE       on the iPad: clear of the minimap and of every touch control, on the right above the
 *              right thumb, the thing a finger at its middle touches — lying down and upright — and a
 *              real touch on it fires.
 *   DISASTERS  summoned from the van (a tornado), the aeroplane (the wildfire) and the boat (meteors):
 *              each happens in the van and the boat too, not only in the sky.
 */
const repairKey = (p, type, repeat = false) => p.send('Input.dispatchKeyEvent', { type, code: 'Space', key: ' ', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, autoRepeat: repeat });
const FIRE_GEOM = `
  const fb = document.querySelector('.pvp-fire');
  const r0 = await pt.until(() => fb && !fb.hidden && pt.pvp.pvpDebug().P.fireSpot, 8000, 50);
  await new Promise((r) => setTimeout(r, 700));
  const R = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; };
  const vis = (el) => el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 4;
  const f = R(fb);
  const others = [];
  for (const c of document.querySelectorAll('.hud.is-touch .touch-layer > *')) if (vis(c)) others.push(['touch:' + String(c.className).split(' ')[0], R(c), true]);
  for (const sel of ['.minimap', '.mp-badge', '.hud-buttons', '.hud-left']) for (const el of document.querySelectorAll(sel)) if (vis(el)) others.push([sel, R(el), false]);
  const over = others.filter(([, o]) => f.l < o.r && f.r > o.l && f.t < o.b && f.b > o.t).map(([n]) => n);
  const rightTop = Math.min(...others.filter(([, o, t]) => t && (o.l + o.r) / 2 > innerWidth / 2).map(([, o]) => o.t));
  const cx = (f.l + f.r) / 2;
  const cy = (f.t + f.b) / 2;
  const topEl = document.elementFromPoint(cx, cy);
  return { shown: !!r0.v, W: innerWidth, H: innerHeight, fire: f, over, controls: others.filter((o) => o[2]).length, rightHalf: cx > innerWidth / 2, aboveThumb: f.b <= rightTop,
    onTop: !!(topEl && (topEl === fb || fb.contains(topEl))), touch: document.documentElement.classList.contains('is-touch-device'), cx, cy };`;

async function repairs(pages) {
  const [A, , , , , F, G, H] = pages;
  const four = [A, H, G, F];
  const each = (fn) => Promise.all(four.map(fn));
  const picture = async (p, name) => {
    if (!SHOTS) return null;
    mkdirSync(SHOTS, { recursive: true });
    try {
      const f = await p.snapAsIs(join(SHOTS, name));
      log(`screenshot ${f}`);
      M.shots.push(name);
      return f;
    } catch (err) {
      log(`screenshot ${name} failed: ${err.message}`);
      return null;
    }
  };
  const summonFrom = (p, id) => p.eval(`
    const chipB = document.querySelector('[data-mpp-chip="summon"]');
    const shown = !!(chipB && !chipB.hidden);
    pt.click('[data-mpp-chip="summon"]');
    await new Promise((r) => setTimeout(r, 150));
    const menu = document.querySelector('.mpp-menu');
    const small = menu && menu.querySelector('[data-summon="wildfire"] small');
    const b = menu && menu.querySelector('[data-summon="${id}"]');
    if (b) b.click();
    return { shown, clicked: !!b, fireHint: small ? small.textContent : '' };`, 20);
  const R3 = {};
  M.repairs = R3;

  // Everybody out, back to the Multiplayer screen; Happy Hedgehog's game becomes an iPad.
  await Promise.all(pages.map((p) => p.eval(`pt.before = null; pt.after = null; if (mp.role || mp.lobby) mp.leave('left'); await new Promise((r) => setTimeout(r, 400)); pt.mpMod.openMultiplayer(sim); return true;`, 30)));
  await H.touchReload(1024, 768);
  await H.eval(PAGE(NAMES[7], COLOURS[7]), 120);
  await H.eval(`pt.mpMod.openMultiplayer(sim); return true;`);
  await each((p) => p.eval(`await pt.until(() => document.querySelectorAll('[data-mp-lobby].is-empty, [data-mp-lobby].is-open, [data-mp-lobby].is-full').length === 5, 30000); return true;`, 60));
  // List 3: Lobby 1 is always on Kestrel, which has roads for the van and a harbour for the boat, whatever the menu's island.
  R3.maps = await each((p) => p.eval(`return sim.settings.map;`));
  const pick = (p, game) => p.eval(`const b = [...document.querySelectorAll('[data-mp-ride]')].find((x) => x.dataset.mpRide.startsWith('${game}:')); if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true })); return b ? b.dataset.mpRide : null;`);
  R3.rides = [await pick(A, 'flight'), await pick(H, 'flight'), await pick(G, 'car'), await pick(F, 'boat')];
  await Promise.all([A, H, G].map((p) => p.eval(`pt.click('[data-mp-pvp="on"]'); return mp.profile.pvp;`)));
  await F.eval(`pt.click('[data-mp-pvp="off"]'); return mp.profile.pvp;`);
  const joinLobby = (p) => p.eval(`
    pt.click('[data-mp-lobby-join="1"]');
    await pt.until(() => (mp.ready && mp.lobby && sim.state === 'flying') || (!mp.busy && !mp.lobby && document.querySelector('[data-mp-status]').textContent), 60000);
    return { role: mp.role, id: mp.meId, mode: sim.mode, kind: sim.mode === 'drive' && sim.vehicle && sim.vehicle.spec ? sim.vehicle.spec.kind : 'air', map: sim.settings.map, status: pt.text('[data-mp-status]') };`, 90);
  const js = [];
  for (const p of four) {
    js.push(await joinLobby(p));
    await sleep(800);
  }
  const id = { A: js[0].id, H: js[1].id, G: js[2].id, F: js[3].id };
  let seen = [];
  for (let k = 0; k < 20; k++) {
    seen = await each((p) => p.eval(`return [...mp.remotes.players.values()].filter((q) => q.visible).length;`, 20));
    if (seen.every((n) => n === 3)) break;
    await sleep(1000);
  }
  const touchH = await H.eval(`return { touch: document.documentElement.classList.contains('is-touch-device'), layer: !!document.querySelector('.hud.is-touch .touch-layer'), w: innerWidth, h: innerHeight };`);
  ok('R: Lobby 1 (Kestrel) — Swift Falcon hosting in the aeroplane, Happy Hedgehog on an iPad (touch, 1024x768), Gentle Lark in the van, Mighty Moose in the boat; each draws the other three',
    js[0].role === 'host' && js.slice(1).every((j) => j.role === 'client') && js[2].kind === 'car' && js[3].kind === 'boat' && touchH.touch && touchH.layer && touchH.w === 1024 && seen.every((n) => n === 3),
    `${js.map((j) => `${j.id}:${j.kind}@${j.map}`).join(' ')}; iPad ${JSON.stringify(touchH)}; drawn ${seen.join(',')}; maps before ${R3.maps.join(',')}`);
  const stale = await Promise.all(pages.map((p) => p.eval(`const r = document.querySelector('.race-results'); return !!(r && !r.hidden);`)));
  ok('R: the Ring Rally’s results went with the race — not on anybody’s screen in the next game, nor on the Multiplayer screen', stale.every((x) => !x), stale.map((x) => (x ? 'CARD' : '-')).join(''));
  await sleep(4500); // PvP arms in three seconds
  await A.eval(`pt.airborne(-1500, 1200, 90, 600); return true;`);
  await H.eval(`pt.airborne(-600, 2400, 90, 600); return true;`);
  await sleep(600);

  /* ---- disasters in the van and the boat: a tornado, summoned from the van ---- */
  const tsum = await summonFrom(G, 'tornado');
  const tAt = Date.now();
  const tor = await each((p) => p.eval(`
    const r = await pt.until(() => sim.activeEvents && 'tornado' in sim.activeEvents, 6000, 30);
    const me = pt.shared.ride(sim);
    const t = sim.tornado;
    const out = { ok: !!r.v, ms: r.ms, mode: sim.mode, near: t && t.active && me ? Math.round(Math.hypot(t.pos.x - me.pos.x, t.pos.z - me.pos.z)) : null };
    const said = () => [...pt.feedLog].some((l) => /(Gentle Lark|You) summoned: Tornado/.test(l));
    await pt.until(said, 2000, 30);
    out.feed = said();
    if (sim.mode === 'drive') {
      const x0 = t.pos.x;
      const z0 = t.pos.z;
      // Its line comes up once the "TORNADO!" message has gone (six seconds), in the same place.
      const hzOn = () => { const hz = document.querySelector('.hud-hazard'); return hz && hz.style.display !== 'none' ? hz.textContent : null; };
      await pt.until(hzOn, 9000, 50);
      out.moved = Math.round(Math.hypot(t.pos.x - x0, t.pos.z - z0) * 10) / 10;
      out.hazard = hzOn();
      out.spaceLines = pt.pvp.pvpDebug().stats.spaceLines;
    }
    return out;`, 20));
  R3.tornado = tor;
  ok('R: Gentle Lark summons a TORNADO from the van’s own ⚡ Summon chip — it touches down in all four games: near the van and near the boat too, turning, with where it is on their screens',
    tsum.shown && tsum.clicked && tor.every((t) => t.ok && t.feed) && tor.slice(2).every((t) => t.mode === 'drive' && t.near > 500 && t.near < 2000 && t.moved > 0 && /TORNADO/.test(t.hazard || '')),
    tor.map((t) => `${t.mode}${t.near != null ? ` ${t.near} m` : ''}${t.hazard ? ` "${t.hazard}"` : ''}`).join(' | '));
  ok('R: in the van, a line says what Space does with PvP on (it was the handbrake)', tor[2].spaceLines >= 1, `${tor[2].spaceLines} line(s)`);
  await G.eval(`const v = sim.vehicle; const t = sim.tornado; const h = (Math.atan2(t.pos.x - v.pos.x, -(t.pos.z - v.pos.z)) * 180 / Math.PI + 360) % 360; v.reset({ pos: v.pos.clone(), headingDeg: h }); await new Promise((r) => setTimeout(r, 1500)); return h;`, 20);
  await shot(G, 'r-van-tornado1366.png', 1366, 768);

  /* ---- Space, with real key events: pressed on the runway, let go in the air ---- */
  const onRunway = `const ac = sim.aircraft; ac.reset({ pos: new pt.THREE.Vector3(-285, 0, 0), headingDeg: 90, speed: 0, altAGL: null, engineOn: true, gearDown: true });`;
  const roll = `${onRunway}
    ac.controls.throttle = 1; sim.input.throttleTarget = 1; if (sim.input.out) sim.input.out.throttle = 1;
    // Four seconds of the GAME's time, not the wall clock's: a tab the CPU governor pauses loses all but 0.25 s of each gap.
    let gameS = 0;
    const prev = pt.before;
    pt.before = (dt) => { gameS += dt; if (prev) prev(dt); };
    await pt.until(() => gameS >= 4, 20000, 20);
    pt.before = prev;
    return { held: sim.input.keys.has('Space'), brakes: +sim.input.out.brakes.toFixed(2), kt: Math.round(Math.hypot(ac.vel.x, ac.vel.z) * 1.94), gameS: +gameS.toFixed(1) };`;
  const K = {};
  await A.eval(`${onRunway} return true;`);
  await sleep(600);
  await repairKey(A, 'keyDown');
  await sleep(300);
  K.ground = await A.eval(`return { held: sim.input.keys.has('Space'), brakes: +sim.input.out.brakes.toFixed(2), firing: pt.pvp.pvpDebug().P.sentFire, live: pt.pvp.pvpDebug().me && pt.pvp.pvpDebug().me.on };`);
  await A.eval(`pt.airborne(-1500, 1200, 90, 400); return true;`);
  await sleep(800);
  await repairKey(A, 'keyUp');
  await sleep(300);
  K.letGoInAir = await A.eval(`return { held: sim.input.keys.has('Space'), brakes: +sim.input.out.brakes.toFixed(2), air: !sim.aircraft.onGround };`);
  await repairKey(A, 'keyDown');
  await sleep(600);
  K.pressInAir = await A.eval(`return { held: sim.input.keys.has('Space'), firing: pt.pvp.pvpDebug().P.sentFire, shots: pt.pvp.pvpDebug().stats.shots };`);
  await repairKey(A, 'keyUp');
  await sleep(300);
  K.upInAir = await A.eval(`return { held: sim.input.keys.has('Space'), firing: pt.pvp.pvpDebug().P.sentFire };`);
  K.roll = await A.eval(roll, 20);
  R3.keys = K;
  ok('R: real keys, PvP on — Space pressed on the runway (the brakes), let go in the air: the brakes come off; on the runway again at full power the aeroplane rolls',
    K.ground.live && K.ground.held && K.ground.brakes > 0.5 && !K.ground.firing && K.letGoInAir.air && !K.letGoInAir.held && K.letGoInAir.brakes < 0.05 && !K.roll.held && K.roll.brakes === 0 && K.roll.kt >= 20,
    JSON.stringify(K));
  ok('R: real keys — a press in the air shoots, and the game’s own input never sees it as the brakes', K.pressInAir.firing && !K.pressInAir.held && !K.upInAir.firing && !K.upInAir.held, JSON.stringify([K.pressInAir, K.upInAir]));
  await A.eval(`pt.airborne(-1500, 1200, 90, 600); return true;`);

  /* ---- FIRE on the iPad ---- */
  await H.eval(`pt.airborne(-600, 2400, 90, 500); return true;`);
  const geoL = await H.eval(FIRE_GEOM, 20);
  await picture(H, 'r-ipad-fire1024.png');
  const s0 = await H.eval(`return pt.pvp.pvpDebug().stats.shots;`);
  await H.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: geoL.cx, y: geoL.cy }] });
  await sleep(700);
  const tap = await H.eval(`return { btn: pt.pvp.pvpDebug().P.fireBtn, firing: pt.pvp.pvpDebug().P.sentFire, shots: pt.pvp.pvpDebug().stats.shots - ${s0} };`);
  await H.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  tap.after = await H.eval(`return { btn: pt.pvp.pvpDebug().P.fireBtn, firing: pt.pvp.pvpDebug().P.sentFire };`);
  await H.send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true });
  await H.eval(`await pt.until(() => innerWidth === 768, 5000, 40); sim.onResize(); return true;`);
  const geoP = await H.eval(FIRE_GEOM, 20);
  await picture(H, 'r-ipad-fire768.png');
  await H.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true });
  await H.eval(`await pt.until(() => innerWidth === 1024, 5000, 40); sim.onResize(); return true;`);
  R3.fire = { landscape: geoL, portrait: geoP, tap };
  const fineFire = (g) => g.shown && g.touch && g.over.length === 0 && g.controls >= 3 && g.rightHalf && g.aboveThumb && g.onTop;
  ok('R: FIRE on the iPad covers nothing — not the minimap, not a touch control — and sits on the right, above the right thumb; lying down and upright',
    fineFire(geoL) && fineFire(geoP), `1024x768: [${Object.values(geoL.fire).join(',')}] over ${geoL.over.join('+') || 'nothing'}; 768x1024: [${Object.values(geoP.fire).join(',')}] over ${geoP.over.join('+') || 'nothing'}`);
  ok('R: a real touch on FIRE shoots; lifting the finger stops', tap.btn && tap.firing && tap.shots > 0 && !tap.after.btn && !tap.after.firing, JSON.stringify(tap));

  /* ---- the WILDFIRE, summoned from the aeroplane: the van and the boat see its smoke ---- */
  await sleep(Math.max(0, 15600 - (Date.now() - tAt)));
  await A.eval(`pt.airborne(500, -700, 90, 250); return true;`);
  await sleep(400);
  const wsum = await summonFrom(A, 'wildfire');
  const wAt = Date.now();
  const wf = await each((p) => p.eval(`
    if (sim.mode === 'drive') {
      const r = await pt.until(() => pt.world.worldDebug().sights.smoke, 6000, 30);
      await new Promise((res) => setTimeout(res, 800));
      let puffs = 0;
      sim.scene.traverse((o) => { if (o.name === 'mp-sight-smoke' && o.visible) puffs++; });
      const said = () => [...pt.feedLog].some((l) => /Swift Falcon summoned: Wildfire/.test(l));
      await pt.until(said, 2000, 30);
      return { ok: !!r.v, mode: sim.mode, at: pt.world.worldDebug().sights.smoke, puffs, feed: said() };
    }
    const r = await pt.until(() => { const w = pt.wild.wildfireDebug(); return w && w.live && w.grid && w.grid.burning > 0; }, 8000, 50);
    return { ok: !!r.v, mode: sim.mode };`, 20));
  R3.wildfire = wf;
  ok('R: Swift Falcon summons the WILDFIRE: it burns in both aeroplanes, and the van and the boat see its smoke where it is (and a flame on their minimaps)',
    wsum.clicked && wf.every((w) => w.ok) && wf.slice(2).every((w) => w.at && Math.hypot(w.at.x - 500, w.at.z + 700) < 400 && w.puffs >= 8 && w.feed),
    wf.map((w) => (w.mode === 'drive' ? `smoke @${w.at ? `${w.at.x},${w.at.z}` : '-'} ${w.puffs} puffs` : `${w.mode} ${w.ok ? 'burning' : '-'}`)).join(' | '));
  ok('R: in the van, the Summon menu says what the wildfire looks like from the road', /smoke/.test(tsum.fireHint), tsum.fireHint);

  /* ---- tagged while holding Space (the keyboard repeating it), in the van and in the aeroplane ---- */
  const tagOut = (target, shooter) => A.eval(`
    const j = pt.pvp.pvpDebug().judge; const ch = pt.mp.events; const t = performance.now();
    j.fire(${shooter}, true, t);
    let r = null; for (let i = 0; i < 6 && !(r && r.down); i++) r = j.hit(${shooter}, ${target}, 10, t);
    if (r && r.down) ch.send('pvp:down', { t: ${target}, by: ${shooter}, how: 0 }, { self: true });
    j.fire(${shooter}, false, t);
    return r ? { ok: r.ok, down: !!r.down } : null;`);
  for (const [name, P, target] of [['van', G, id.G], ['plane', A, id.A]]) {
    const T = {};
    if (name === 'plane') await A.eval(`pt.airborne(-1500, 1200, 90, 400); return true;`);
    await sleep(700);
    T.before = await P.eval(`return { held: sim.input.keys.has('Space'), live: pt.pvp.pvpDebug().me && pt.pvp.pvpDebug().me.on };`);
    await repairKey(P, 'keyDown');
    await sleep(300);
    T.tag = await tagOut(target, id.H);
    for (let i = 0; i < 12; i++) {
      await sleep(250);
      await repairKey(P, 'keyDown', true);
    }
    await sleep(1500);
    T.backIn = await P.eval(`return { down: !!pt.pvp.pvpDebug().P.down, respawns: pt.pvp.pvpDebug().stats.respawns, held: sim.input.keys.has('Space') };`);
    await repairKey(P, 'keyUp');
    await sleep(300);
    T.afterRelease = await P.eval(`return { held: sim.input.keys.has('Space'), firing: pt.pvp.pvpDebug().P.sentFire };`);
    await repairKey(P, 'keyDown');
    await sleep(200);
    await repairKey(P, 'keyUp');
    await sleep(300);
    if (name === 'van') {
      T.drive = await P.eval(`
        const v = sim.vehicle; v.speed = 0; sim.input.keys.add('KeyW');
        await new Promise((r) => setTimeout(r, 3000));
        const out = { held: sim.input.keys.has('Space'), brakes: +(v.brakes || 0).toFixed(2), speed: +Math.abs(v.speed || 0).toFixed(1) };
        sim.input.keys.delete('KeyW');
        return out;`, 20);
    } else T.roll = await A.eval(roll, 20);
    R3[`tagged_${name}`] = T;
    const moved = name === 'van' ? T.drive.brakes === 0 && T.drive.speed > 2 && !T.drive.held : T.roll.brakes === 0 && T.roll.kt >= 20 && !T.roll.held;
    ok(`R: real keys — the ${name === 'van' ? 'van' : 'aeroplane'} tagged while holding Space (the keyboard repeating it): back in three seconds, and once Space is let go the ${name === 'van' ? 'handbrake is off and it drives' : 'brakes are off and it rolls down the runway'}`,
      T.before.live && T.tag && T.tag.down && !T.backIn.down && T.backIn.respawns >= 1 && !T.backIn.held && !T.afterRelease.held && !T.afterRelease.firing && moved, JSON.stringify(T));
  }
  await A.eval(`pt.airborne(-1500, 1200, 90, 600); return true;`);

  /* ---- METEORS, summoned from the boat ---- */
  await sleep(Math.max(0, 15600 - (Date.now() - wAt)));
  await F.eval(`const v = sim.vehicle; const s = pt.world.worldDebug().sights.smoke; if (s) { const h = (Math.atan2(s.x - v.pos.x, -(s.z - v.pos.z)) * 180 / Math.PI + 360) % 360; v.reset({ pos: v.pos.clone(), headingDeg: h }); } return true;`);
  const mSumAt = Date.now();
  const msum = await summonFrom(F, 'meteors');
  const met = await each((p) => p.eval(`
    if (sim.mode === 'drive') {
      const r = await pt.until(() => { const s = pt.world.worldDebug().sights.meteors; return s && s.lit > 0; }, 6000, 30);
      const said = () => [...pt.feedLog].some((l) => /(Mighty Moose|You) summoned: Meteor shower/.test(l));
      await pt.until(said, 2000, 30);
      await new Promise((res) => setTimeout(res, 2500));
      const s = pt.world.worldDebug().sights;
      return { ok: !!r.v, mode: sim.mode, lit: s.meteors ? s.meteors.lit : 0, streaks: s.stats.streaks, feed: said() };
    }
    const r = await pt.until(() => sim.meteors && sim.meteors.active, 6000, 30);
    return { ok: !!r.v, mode: sim.mode };`, 20));
  R3.meteors = met;
  await sleep(1200);
  await shot(F, 'r-boat-sky1366.png', 1366, 768);
  ok('R: Mighty Moose summons a METEOR SHOWER from the boat: rocks in both skies, and shooting stars over the van and the boat',
    msum.shown && msum.clicked && met.every((m) => m.ok) && met.slice(2).every((m) => m.lit >= 1 && m.feed), met.map((m) => (m.mode === 'drive' ? `${m.lit} lit / ${m.streaks} so far` : m.mode)).join(' | '));
  await each((p) => p.eval(`if (sim.meteors && sim.meteors.active) sim.meteors.end(); pt.before = null; return true;`));

  /*
   * ---- a WILDFIRE summoned from the BOAT, a kilometre out at sea (the independent check's blocker) ----
   * It used to show nothing to anybody in the van or the boat: the smoke was asked for at the boat, on
   * the water. The fire burns on the nearest land; the van's and the boat's smoke, their line and their
   * minimap flame are where the pilots' fire is.
   */
  await F.eval(`const v = sim.vehicle; v.reset({ pos: new pt.THREE.Vector3(0, 0, 3300), headingDeg: 0 }); await new Promise((r) => setTimeout(r, 600)); return true;`, 20);
  await Promise.all([G, F].map((p) => p.eval(`
    pt.notes = [];
    if (!pt.noteHook) { const n = sim.hud.notify.bind(sim.hud); sim.hud.notify = (t, ...a) => { pt.notes.push(String(t)); return n(t, ...a); }; pt.noteHook = true; }
    return true;`)));
  await A.eval(`pt.airborne(-1500, 1200, 90, 600); return true;`);
  // The boat's own cooldown (thirty seconds after its meteors), and the game's.
  await sleep(Math.max(0, 31000 - (Date.now() - mSumAt)));
  const boatAt = await F.eval(`const T = await import('/src/world/terrain.js'); const v = sim.vehicle; return { x: Math.round(v.pos.x), z: Math.round(v.pos.z), ground: +T.heightAt(v.pos.x, v.pos.z).toFixed(1), mode: sim.mode };`, 20);
  const bsum = await summonFrom(F, 'wildfire');
  const bf = await each((p) => p.eval(`
    if (sim.mode === 'drive') {
      const r = await pt.until(() => pt.world.worldDebug().sights.smoke, 6000, 30);
      // Long enough for the host's own fire ('world:fire') to arrive and the smoke to go to it.
      await new Promise((res) => setTimeout(res, 3000));
      const sm = pt.world.worldDebug().sights.smoke;
      let puffs = 0;
      sim.scene.traverse((o) => { if (o.name === 'mp-sight-smoke' && o.visible) puffs++; });
      const said = () => [...pt.feedLog].some((l) => /(Mighty Moose|You) summoned: Wildfire/.test(l));
      await pt.until(said, 2000, 30);
      const line = pt.notes.find((t) => /WILDFIRE!/.test(t)) || '';
      const km = /See the smoke ([0-9.]+) km/.exec(line);
      const v = sim.vehicle;
      const dist = sm ? Math.hypot(sm.x - v.pos.x, sm.z - v.pos.z) / 1000 : null;
      // The minimap's flame, drawn into a stand-in canvas: where does it go?
      const drawn = [];
      const g = new Proxy({}, { get: (o, k) => (k === 'moveTo' ? (x, y) => drawn.push([x, y]) : k in o ? o[k] : () => {}), set: (o, k, val) => ((o[k] = val), true) });
      for (const fn of pt.mp.minimapExtras) { try { fn(g, (x, z) => [x, z, false], sim); } catch (e) { /* not this one */ } }
      const flame = sm ? drawn.some(([x, y]) => x === sm.x && y === sm.z - 10) : false;
      return { ok: !!r.v, mode: sim.mode, at: sm, puffs, feed: said(), line, km: km ? Number(km[1]) : null, dist, flame, fireAt: pt.world.worldDebug().fireAt };
    }
    const r = await pt.until(() => { const w = pt.wild.wildfireDebug(); return w && w.live && w.grid && w.grid.burning > 0; }, 8000, 50);
    await new Promise((res) => setTimeout(res, 3000));
    const w = pt.wild.wildfireDebug();
    const c = w && w.grid && w.grid.burning > 0 ? w.grid.centroid({ x: 0, z: 0 }) : null;
    return { ok: !!r.v, mode: sim.mode, fire: c ? { x: Math.round(c.x), z: Math.round(c.z) } : null };`, 30));
  R3.wildfireBoat = { boat: boatAt, summon: bsum, tabs: bf };
  const fires = bf.slice(0, 2).map((w) => w.fire).filter(Boolean);
  const nearFire = (at) => at && fires.length === 2 && fires.every((f) => Math.hypot(f.x - at.x, f.z - at.z) < 600);
  ok('R: Mighty Moose summons a WILDFIRE from the BOAT, out at sea: it burns on the nearest land in both aeroplanes, in the same place',
    boatAt.ground < 1 && bsum.clicked && bf.slice(0, 2).every((w) => w.ok) && fires.length === 2 && Math.hypot(fires[0].x - fires[1].x, fires[0].z - fires[1].z) < 300,
    `boat at ${boatAt.x},${boatAt.z} (ground ${boatAt.ground} m); fires ${fires.map((f) => `${f.x},${f.z}`).join(' / ')}`);
  ok('R: … and the van and the boat see its smoke by the fire (not at the boat, on the water), a flame on their minimaps there, and a line that says how far',
    bf.slice(2).every((w) => w.ok && nearFire(w.at) && w.puffs >= 8 && w.feed && w.flame && w.km != null && Math.abs(w.km - w.dist) < 0.6),
    bf.slice(2).map((w) => `${w.mode}: smoke @${w.at ? `${w.at.x},${w.at.z}` : '-'} ${w.puffs} puffs, flame ${w.flame}, "${w.line}" (${w.dist == null ? '-' : w.dist.toFixed(2)} km now)`).join(' | '));
}

/* ---- the run --------------------------------------------------------------- */
M.shots = [];
const url = await serve();
log(`serving ${url}`);
const pages = [];
let exitCode = 1;
try {
  for (let i = 0; i < 8; i++) {
    const p = await openPage(`${url}?dev=1`, `tab${i + 1}`);
    const r = await p.eval(PAGE(NAMES[i], COLOURS[i]), 120);
    pages.push(p);
    log(`tab${i + 1} up as ${r.name} (${r.state}, ${r.map})`);
  }
  const [A, B, C, D, E, F, G, H] = pages;
  const all = (fn) => Promise.all(pages.map(fn));
  const ev = (p, body, secs) => p.eval(body, secs);
  const idOf = {};

  // --repairs-only: straight to the last part (the reviewer's three findings), for working on it.
  phases: {
  if (arg('repairs-only')) break phases;
  /* ======== 7 (first half) and 6: the lobby screen, the PvP switch, the lobby card's rule ======== */
  await all((p) => p.eval(`
    const viaMenu = sim.state === 'menu' && pt.click('[data-act="multiplayer"]');
    if (!viaMenu) pt.mpMod.openMultiplayer(sim);
    await pt.until(() => document.querySelectorAll('[data-mp-lobby].is-empty, [data-mp-lobby].is-open, [data-mp-lobby].is-full').length === 5, 30000);
    return true;`, 60));
  // Four with PvP on, four with it off; the host in Dev mode (the AI traffic's gate, as in single player).
  await Promise.all([A, B, C, D].map((p) => p.eval(`pt.click('[data-mp-pvp="on"]'); return mp.profile.pvp;`)));
  await A.eval(`const pr = sim.menus && sim.menus.prog; if (pr) pr.devUnlocked = true; return !!(pr && pr.devUnlocked);`);
  const join = (p, n) => p.eval(`
    const t0 = performance.now();
    pt.click('[data-mp-lobby-join="${n}"]');
    const r = await pt.until(() => (mp.ready && mp.lobby && sim.state === 'flying') || (!mp.busy && !mp.lobby && document.querySelector('[data-mp-status]').textContent), 60000);
    return { ms: Math.round(performance.now() - t0), role: mp.role, id: mp.meId, status: pt.text('[data-mp-status]'), map: sim.settings.map };`, 90);
  // List 3: every lobby has its own island — Lobby 1 is always Kestrel, where this playtest's places are.
  const ja = await join(A, 1);
  ok('the first player into Lobby 1 hosts it, on its own island (Kestrel)', ja.role === 'host' && ja.map === 'kestrel', `${ja.ms} ms, ${ja.map}`);
  idOf[NAMES[0]] = 0;
  const card = await B.eval(`
    const r = await pt.until(() => { const c = document.querySelector('[data-mp-lobby="1"]'); return c && /is-open/.test(c.className) ? c : null; }, 15000);
    const c = document.querySelector('[data-mp-lobby="1"]');
    return { open: !!r.v, rule: c.querySelector('[data-mp-rule]').textContent.trim(), where: c.querySelector('[data-mp-isle]').textContent, pvp: pt.text('[data-mp-pvphint]') };`, 30);
  ok('7: before joining, the lobby card says its bumping rule — "Bumps · PvP crash" — and its island', card.open && /Bumps · PvP crash/.test(card.rule) && /Kestrel/.test(card.where), `${card.rule} · ${card.where}`);
  await shot(B, 'p2-lobby1366.png', 1366, 768);
  for (const p of [B, C, D, E, F, G, H]) {
    const r = await join(p, 1);
    idOf[NAMES[pages.indexOf(p)]] = r.id;
    if (r.role !== 'client') log(`${p.name} did not join: ${r.status}`);
  }
  let seen = [];
  for (let k = 0; k < 25; k++) {
    seen = await all((p) => p.eval(`return { n: mp.remotes.players.size, drawn: [...mp.remotes.players.values()].filter((q) => q.visible).length, role: mp.role };`, 20));
    if (seen.every((s) => s.n === 7 && s.drawn === 7)) break;
    await sleep(1000);
  }
  ok('all eight in Lobby 1, every one drawing the other seven', seen.every((s) => s.n === 7 && s.drawn === 7), seen.map((s) => `${s.n}/${s.drawn}`).join(' '));
  M.ids = idOf;
  // Spread out in the air, flying east.
  await all((p) => p.eval(`pt.airborne(${-1500 + pages.indexOf(p) * 420}, ${900 + (pages.indexOf(p) % 2) * 500}, 90); return true;`));
  await sleep(7000);

  /* ======== 9: the host's weather ======== */
  const wt0 = Date.now();
  await A.eval(`sim.weather.applyPreset('storm'); return true;`);
  const wx = await Promise.all(pages.slice(1).map((p) => p.eval(`
    const r = await pt.until(() => sim.weather.condition === 'stormy' && sim.weather.time === 'sunset' && Math.round(sim.weather.windSpeedKts) === 26, 8000, 30);
    return { ok: !!r.v, ms: r.ms, w: sim.weather.condition + ' ' + sim.weather.time + ' ' + Math.round(sim.weather.windSpeedKts) + 'kt/' + Math.round(sim.weather.windDirDeg) };`, 30)));
  M.weatherMs = wx.map((w) => w.ms);
  ok('9: the host turns the weather to a sunset storm front — every other tab has it, wind and all', wx.every((w) => w.ok), `${wx.map((w) => w.ms).join(',')} ms (${wx[0].w}); ${Date.now() - wt0} ms in all`);
  await A.eval(`sim.weather.applyPreset('breezy'); return true;`);

  /* ======== 9: the host's AI aeroplanes ======== */
  const tr0 = await A.eval(`
    // One coming in to land as well as whatever is parked: something moving to follow.
    pt.traffic.spawnTraffic(sim, 'arrive');
    await new Promise((r) => setTimeout(r, 1500));
    return { n: sim.traffic.length, dev: !!(sim.menus.prog && sim.menus.prog.devUnlocked), types: sim.traffic.map((c) => c.typeId) };`, 30);
  const own = await Promise.all(pages.slice(1).map((p) => p.eval(`return { n: Array.isArray(sim.traffic) ? sim.traffic.length : 0, on: pt.traffic.trafficState().on };`)));
  ok('9: the host, in Dev mode, runs the AI traffic; nobody else runs any of their own', tr0.n >= 1 && tr0.dev && own.every((o) => o.n === 0 && !o.on), `host ${tr0.n} (${tr0.types.join(',')}); others ${own.map((o) => o.n).join(',')}`);
  await sleep(2500);
  await all((p) => p.eval(`
    pt.tlog = [];
    pt.after = () => {
      if (mp.role === 'host') { for (const c of (sim.traffic || [])) pt.tlog.push([pt.now(), Number(String(c.id).replace(/\\D/g, '')) % 1000, c.pos.x, c.pos.y, c.pos.z]); }
      else for (const m of pt.world.worldDebug().W.mirror.values()) pt.tlog.push([pt.now(), m.id, m.dx, m.dy, m.dz, m.model ? 1 : 0]);
    };
    return true;`));
  await sleep(4000);
  const tl = await all((p) => p.eval(`pt.after = null; return pt.tlog;`, 60));
  const hostLog = tl[0];
  const errsT = [];
  let modelled = 0;
  let mirrorIds = new Set();
  for (const log2 of tl.slice(1)) {
    for (const [e, id, x, y, z, m] of log2) {
      mirrorIds.add(id);
      if (m) modelled++;
      const hs = hostLog.filter((h) => h[1] === id);
      const i = hs.findIndex((h) => h[0] >= e);
      if (i <= 0) continue;
      const a = hs[i - 1];
      const b = hs[i];
      const k = (e - a[0]) / (b[0] - a[0] || 1);
      errsT.push(Math.hypot(x - (a[2] + (b[2] - a[2]) * k), y - (a[3] + (b[3] - a[3]) * k), z - (a[4] + (b[4] - a[4]) * k)));
    }
  }
  errsT.sort((a, b) => a - b);
  const q = (arr, f) => +(arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] || 0).toFixed(1);
  M.traffic = { hostCount: tr0.n, samples: errsT.length, p50: q(errsT, 0.5), p95: q(errsT, 0.95), max: q(errsT, 1) };
  const hostIds = new Set(hostLog.map((h) => h[1]));
  ok('9: the host’s AI aeroplanes are the SAME in every tab — the same ones, drawn near where the host has them',
    errsT.length > 100 && [...hostIds].every((id) => mirrorIds.has(id)) && modelled > 0 && M.traffic.p50 < 25 && M.traffic.p95 < 80,
    `${[...hostIds].join(',')} → ${[...mirrorIds].join(',')}; error median ${M.traffic.p50} m, p95 ${M.traffic.p95} m, max ${M.traffic.max} m over ${errsT.length} samples`);

  /* ======== 6: PvP ======== */
  const pvpRows = await A.eval(`return pt.pvp.pvpDebug().state;`);
  const onIds = [0, idOf[NAMES[1]], idOf[NAMES[2]], idOf[NAMES[3]]];
  const rowsOk = pvpRows && pvpRows.p && onIds.every((id) => { const r = pvpRows.p.find((x) => x[0] === id); return r && (r[1] & 1); })
    && [4, 5, 6, 7].map((i) => idOf[NAMES[i]]).every((id) => { const r = pvpRows.p.find((x) => x[0] === id); return !r || !(r[1] & 1); });
  ok('6: the four who switched PvP on at the lobby screen are on; the four who did not are off', rowsOk, JSON.stringify(pvpRows));
  // B flies straight and level; A sits 140 m behind where A draws B and holds Space.
  // Both screens sized for their pictures first, so each is taken the moment it matters.
  if (SHOTS) await Promise.all([A.size(1366, 768), B.size(1366, 768)]);
  await B.eval(`pt.airborne(0, -1200, 90, 380); pt.before = null; return true;`);
  await sleep(600);
  const firing = A.eval(`
    const target = 'Brave Otter';
    pt.before = () => {
      const r = pt.remote(target);
      if (!r || !r.drawn || !r.quat) return;
      const q = new pt.THREE.Quaternion(r.quat.x, r.quat.y, r.quat.z, r.quat.w);
      const f = new pt.THREE.Vector3(0, 0, -1).applyQuaternion(q);
      pt.place(r.drawn.x - f.x * 140, r.drawn.y - f.y * 140, r.drawn.z - f.z * 140, pt.heading(q), 55);
    };
    await new Promise((res) => setTimeout(res, 800));
    const s0 = pt.pvp.pvpDebug().stats;
    pt.sawReticle = false;
    pt.sawFire = false;
    pt.key(true);
    const r = await pt.until(() => pt.pvp.pvpDebug().stats.tagsByMe > s0.tagsByMe, 12000, 30);
    // Still holding Space for a few seconds more (into the shield, which takes nothing): pellets in the air for the picture.
    await pt.until(() => pt.snapped, 35000, 50);
    pt.key(false);
    const s1 = pt.pvp.pvpDebug().stats;
    return { tagged: !!r.v, ms: r.ms, shots: s1.shots - s0.shots, claims: s1.claims - s0.claims, reticle: pt.sawReticle, fire: pt.sawFire };`, 70);
  // The tagged player's screen while the puff is up, then the shooter's with the pellets still flying.
  const downNow = await B.eval(`const r = await pt.until(() => pt.pvp.pvpDebug().P.down && performance.now() - pt.pvp.pvpDebug().P.down.t0 > 400, 15000, 20); return !!r.v;`, 20);
  if (downNow) await snap(B, 'p2-tagged1366.png');
  await snap(A, 'p2-pvp1366.png');
  await A.eval(`pt.snapped = true; return true;`);
  const fireRes = await firing;
  if (SHOTS) await Promise.all([A.unsize(), B.unsize()]);
  await A.eval(`pt.before = null; return true;`);
  const bDown = await B.eval(`
    const r = await pt.until(() => pt.cards.some((c) => /TAGGED/.test(c)), 5000, 30);
    return { cards: pt.cards.slice(-4), down: !!pt.pvp.pvpDebug().P.down || pt.pvp.pvpDebug().stats.respawns > 0 };`, 20);
  ok('6: Brave Otter flies level; Swift Falcon chases 140 m behind and holds Space: pellets, the reticle and FIRE on screen, and a TAG — Brave Otter sees "TAGGED!"',
    fireRes.tagged && fireRes.shots > 5 && fireRes.claims >= 5 && fireRes.reticle && fireRes.fire && bDown.down && bDown.cards.some((c) => /TAGGED/.test(c)),
    `${fireRes.ms} ms, ${fireRes.shots} shots, ${fireRes.claims} claimed; B's cards: ${bDown.cards.join(' / ')}`);
  M.pvp = { tagMs: fireRes.ms, shots: fireRes.shots, claims: fireRes.claims };
  const boards = await all((p) => p.eval(`
    const saw = () => [...pt.feedLog].some((l) => /Swift Falcon tagged Brave Otter/.test(l));
    await pt.until(saw, 4000);
    const st = pt.pvp.pvpDebug().state;
    const a = pt.PR.rowOf(st, 0); const b = pt.PR.rowOf(st, ${idOf[NAMES[1]]});
    return { a: a && a.tags, b: b && b.outs, feed: saw(), board: pt.text('.mpp-board') };`, 20));
  ok('6: every one of the eight tabs has it: a tag to Swift Falcon on the scoreboard, "Swift Falcon tagged Brave Otter" in the feed',
    boards.every((b) => b.a >= 1 && b.b === b.a && b.a === boards[0].a && b.feed), boards.map((b) => `${b.a}/${b.b}/${b.feed ? 'feed' : '-'}`).join(' '));
  const back = await B.eval(`
    const r = await pt.until(() => pt.pvp.pvpDebug().stats.respawns > 0 && !pt.pvp.pvpDebug().P.down, 6000, 30);
    const ac = sim.aircraft;
    return { back: !!r.v, aglReal: Math.round(ac.agl || 0), shield: pt.sawShield, card: pt.cards.some((c) => /BACK IN!Shield on/.test(c)), visible: sim.model.visible };`, 20);
  ok('6: three seconds later Brave Otter is back in the air — higher up, drawn again, inside a shield', back.back && back.visible && back.shield && back.card && back.aglReal >= 200, JSON.stringify(back));
  // The same pellets through Clever Koala, whose PvP is OFF.
  await E.eval(`pt.airborne(0, 2600, 90, 380); return true;`);
  await sleep(600);
  const offRes = await A.eval(`
    pt.before = () => {
      const r = pt.remote('Clever Koala');
      if (!r || !r.drawn || !r.quat) return;
      const q = new pt.THREE.Quaternion(r.quat.x, r.quat.y, r.quat.z, r.quat.w);
      const f = new pt.THREE.Vector3(0, 0, -1).applyQuaternion(q);
      pt.place(r.drawn.x - f.x * 140, r.drawn.y - f.y * 140, r.drawn.z - f.z * 140, pt.heading(q), 55);
    };
    await new Promise((res) => setTimeout(res, 600));
    const s0 = pt.pvp.pvpDebug().stats;
    pt.key(true);
    await new Promise((res) => setTimeout(res, 3000));
    pt.key(false);
    pt.before = null;
    const s1 = pt.pvp.pvpDebug().stats;
    return { shots: s1.shots - s0.shots, claims: s1.claims - s0.claims };`, 30);
  const eHit = await E.eval(`const st = pt.pvp.pvpDebug().state; const r = pt.PR.rowOf(st, mp.meId); return { row: r, down: pt.pvp.pvpDebug().stats.respawns };`);
  ok('6: the same pellets through Clever Koala, whose PvP is OFF: not one claim, not one heart', offRes.shots > 10 && offRes.claims === 0 && (!eHit.row || (!eHit.row.on && eHit.row.outs === 0)) && eHit.down === 0,
    `${offRes.shots} shots, ${offRes.claims} claims`);
  // Two with PvP on flying head-on into each other: C from the west, D from the east.
  const cId = idOf[NAMES[2]];
  const dId = idOf[NAMES[3]];
  // A kilometre and a half apart, so every game's picture of the other has long settled before they meet.
  await Promise.all([C.eval(`pt.watch('Jolly Penguin'); pt.fly(400, -2600, 90, 650, 55); return true;`), D.eval(`pt.watch('Sunny Puffin'); pt.fly(1900, -2600, 270, 650, 55); return true;`)]);
  const ram = await A.eval(`
    const r = await pt.until(() => { const st = pt.pvp.pvpDebug().state; const c = pt.PR.rowOf(st, ${cId}); const d = pt.PR.rowOf(st, ${dId}); return c && d && c.outs >= 1 && d.outs >= 1; }, 30000, 50);
    await new Promise((res) => setTimeout(res, 300));
    return { ok: !!r.v, ms: r.ms, feed: [...new Set([...pt.feedLog, ...pt.shared.feedLines()])].filter((l) => /crashed out/.test(l)) };`, 45);
  const ramSides = await Promise.all([C, D].map((p) => p.eval(`const b = pt.bump.bumpDebug().stats; const w = pt.seen; pt.after = null;
    return { rams: b.rams, bumps: b.bumps, pushes: b.pushes, swept: b.swept, knocked: b.knocked, ghost: pt.shared.ghostReasons().join('+'),
      nearest: Math.round(w.min * 10) / 10, visibleFrames: w.visible, theirGhostFrames: w.ghost, myGhosts: [...w.mine].join('+'), frames: w.frames };`)));
  ok('6+7: Sunny Puffin and Jolly Penguin, both in PvP, fly head-on into each other: a crash — the host tags both out, and every tab says so',
    ram.ok && ram.feed.length >= 2 && ramSides.some((s) => s.rams >= 1), `${ram.ms} ms; ${ram.feed.join(' / ')}; rams claimed ${ramSides.map((s) => s.rams).join('+')} (${JSON.stringify(ramSides)})`);

  /* ======== 7: gentle bumps, and none on the runway ======== */
  // Level with each other (the same height above the sea, not above two different bits of ground), 200 m apart, nose to nose.
  const b0 = await Promise.all([F, G].map((p) => p.eval(`return pt.bump.bumpDebug().stats;`)));
  await Promise.all([F.eval(`pt.watch('Gentle Lark'); pt.fly(-2700, 3200, 90, 650, 45); return true;`), G.eval(`pt.watch('Mighty Moose'); pt.fly(-1200, 3200, 270, 650, 45); return true;`)]);
  // A kilometre and a half apart at 90 m/s between them: until both have felt it (or thirty seconds).
  await Promise.all([F, G].map((p, i) => p.eval(`await pt.until(() => pt.bump.bumpDebug().stats.pushes > ${b0[i].pushes}, 30000, 50); await new Promise((r) => setTimeout(r, 1500)); pt.before = null; return true;`, 45)));
  const b1 = await Promise.all([F, G].map((p) => p.eval(`const w = pt.seen; pt.after = null; return { s: pt.bump.bumpDebug().stats, crashed: sim.aircraft.crashed, down: !!pt.pvp.pvpDebug().P.down, agl: Math.round(sim.aircraft.agl || 0), nearest: Math.round(w.min * 10) / 10, their: w.ghost, mine: [...w.mine].join('+') };`)));
  ok('7: Mighty Moose and Gentle Lark (PvP off) fly into each other: a gentle BONK each — pushed apart, both fly on, nobody tagged',
    b1.every((x, i) => x.s.pushes > b0[i].pushes && !x.crashed && !x.down), b1.map((x, i) => `${x.s.pushes - b0[i].pushes} pushes, ${x.s.bumps - b0[i].bumps} bumps (nearest drawn ${x.nearest} m${x.their ? `, them a ghost ${x.their} frames` : ''}${x.mine ? `, me: ${x.mine}` : ''})`).join(' | '));
  await Promise.all([G.eval(`pt.before = null; sim.aircraft.reset({ pos: new pt.THREE.Vector3(-300, 0, 0), headingDeg: 90, speed: 0, altAGL: null, engineOn: true }); return true;`),
    H.eval(`sim.aircraft.reset({ pos: new pt.THREE.Vector3(-300, 0, 3), headingDeg: 90, speed: 0, altAGL: null, engineOn: true }); return true;`)]);
  const r0 = await Promise.all([G, H].map((p) => p.eval(`return pt.bump.bumpDebug().stats.pushes;`)));
  await sleep(4000);
  const r1 = await Promise.all([G, H].map((p) => p.eval(`return { pushes: pt.bump.bumpDebug().stats.pushes, ghost: pt.shared.ghostReasons(), x: Math.round(sim.aircraft.pos.x), z: Math.round(sim.aircraft.pos.z) };`)));
  ok('7: two aeroplanes parked on the runway three metres apart never bump — the runway is never a pile-up',
    r1.every((x, i) => x.pushes === r0[i] && x.ghost.includes('bump-ground')), r1.map((x) => `${x.x},${x.z} ${x.ghost.join('+')}`).join(' | '));
  await Promise.all([G, H].map((p, i) => p.eval(`pt.airborne(${-600 + i * 400}, 3800, 90, 380); return true;`)));

  /* ======== 9: disasters for everybody ======== */
  // Everybody well up and apart first: a tornado near a slow aeroplane at 400 m can bring it down.
  await all((p) => p.eval(`pt.airborne(${-2400 + pages.indexOf(p) * 650}, ${-600 + (pages.indexOf(p) % 3) * 900}, 90, 650); return true;`));
  await sleep(1500);
  const summonVia = (p, id) => p.eval(`
    pt.click('[data-mpp-chip="summon"]');
    await new Promise((r) => setTimeout(r, 150));
    const menu = document.querySelector('.mpp-menu');
    const offered = menu ? [...menu.querySelectorAll('[data-summon]')].map((b) => b.dataset.summon) : [];
    const b = menu && menu.querySelector('[data-summon="${id}"]');
    if (b) b.click();
    return { offered };`, 20);
  const tsum = await summonVia(B, 'tornado');
  const tor = await all((p) => p.eval(`
    const r = await pt.until(() => sim.activeEvents && 'tornado' in sim.activeEvents, 6000, 30);
    const said = () => [...pt.feedLog].some((l) => /(Brave Otter|You) summoned: Tornado/.test(l));
    await pt.until(said, 2000, 30);
    return { ok: !!r.v, ms: r.ms, feed: said() };`, 20));
  ok('9: ⚡ Summon on Brave Otter’s badge offers eight disasters; the tornado picked happens in all eight tabs, and each says who summoned it',
    tsum.offered.length === 8 && tor.every((t) => t.ok && t.feed), `${tsum.offered.join(',')}; ${tor.map((t) => t.ms).join(',')} ms`);
  M.summonMs = tor.map((t) => t.ms);
  await summonVia(C, 'stormCell');
  await sleep(800);
  const tooSoon = await all((p) => p.eval(`return { storm: !!(sim.activeEvents && 'stormCell' in sim.activeEvents && sim.activeEvents.stormCell > 0), wait: [...pt.feedLog].some((l) => /One disaster at a time/.test(l)) };`));
  ok('9: Sunny Puffin summons a storm cell straight after: “one disaster at a time”, said only to Sunny Puffin, and nobody gets it',
    tooSoon[2].wait && tooSoon.filter((t, i) => i !== 2).every((t) => !t.wait) && tooSoon.every((t) => !t.storm), tooSoon.map((t) => (t.wait ? 'W' : '-')).join(''));
  // The crash while we wait out the fifteen seconds: Happy Hedgehog comes down; everybody else's minimap marks it.
  const crashAt = await H.eval(`const ac = sim.aircraft; const at = { x: Math.round(ac.pos.x), z: Math.round(ac.pos.z) }; ac.crash('Test crash for the playtest'); return at;`);
  const marks = await Promise.all(pages.slice(0, 7).map((p) => p.eval(`
    const r = await pt.until(() => pt.world.worldDebug().marks.find((m) => m.name === 'Happy Hedgehog') || (pt.world.worldDebug().crashes && pt.world.worldDebug().stats.hapIn > 0), 5000, 30);
    const m = pt.world.worldDebug().marks.find((x) => x.name === 'Happy Hedgehog');
    return { ok: !!r.v, ms: r.ms, x: m ? m.x : null, z: m ? m.z : null, colour: m ? m.colour : null, crashes: pt.world.worldDebug().crashes };`, 20)));
  ok('9: Happy Hedgehog crashes: the crash is marked on the other seven minimaps, in Happy Hedgehog’s colour, where it happened',
    marks.every((m) => m.ok && (m.crashes || (m.colour === COLOURS[7] && Math.hypot(m.x - crashAt.x, m.z - crashAt.z) < 40))), marks.map((m) => `${m.ms}ms`).join(','));
  M.crashMarkMs = marks.map((m) => m.ms);
  // Sunny Puffin flies over to where it happened, to show the mark on the minimap.
  await C.eval(`pt.airborne(${crashAt.x - 900}, ${crashAt.z + 300}, 90, 400); return true;`);
  await sleep(1500);
  await shot(C, 'p2-crashmark1366.png', 1366, 768);
  await sleep(12000);
  // Clever Koala, over the grass north of the runway, summons the WILDFIRE — the new disaster — for everybody.
  await E.eval(`pt.airborne(500, -700, 90, 250); return true;`);
  await sleep(400);
  const wsum = await summonVia(E, 'wildfire');
  const fires = await Promise.all(pages.slice(0, 7).map((p) => p.eval(`
    if (sim.state !== 'flying' && sim.state !== 'paused') return { ok: true, skipped: sim.state, burning: 0, cx: null };
    const r = await pt.until(() => { const w = pt.wild.wildfireDebug(); return w && w.live && w.grid && w.grid.burning > 0; }, 8000, 50);
    const w = pt.wild.wildfireDebug();
    return { ok: !!r.v, ms: r.ms, burning: w && w.grid ? w.grid.burning : 0, cx: w && w.grid ? Math.round(w.grid.cx) : null };`, 30)));
  ok('9: Clever Koala summons a WILDFIRE: a fire is burning in every tab that is flying, lit where Clever Koala’s is',
    wsum.offered.includes('wildfire') && fires.every((f) => f.ok) && fires.filter((f) => !f.skipped).length >= 6, fires.map((f) => (f.skipped ? `(${f.skipped})` : `${f.burning}@${f.cx}`)).join(' '));
  M.wildfireMs = fires.map((f) => f.ms);
  // On a laptop the wildfire's panel grows down the right side towards the badge: the badge steps aside (a second to be placed).
  await E.size(1366, 768);
  await sleep(1300);
  const wfBadge = await E.eval(`
    const R = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; };
    const panel = document.querySelector('.wf-panel');
    const badge = document.querySelector('.mp-badge');
    if (!panel || !badge || !panel.getBoundingClientRect().width) return { panel: false };
    const a = R(panel);
    const b = R(badge);
    return { panel: a, badge: b, over: a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t };`);
  if (SHOTS) await snap(E, 'p2-wildfire1366.png');
  await E.unsize();
  ok('9: at 1366x768 the badge does not cover the wildfire’s panel (it steps to its left)', wfBadge.panel && !wfBadge.over, JSON.stringify(wfBadge));
  await sleep(15500);
  await summonVia(F, 'meteors');
  const met = await Promise.all(pages.slice(0, 7).map((p) => p.eval(`if (sim.state !== 'flying' && sim.state !== 'paused') return { ok: true, skipped: sim.state }; const r = await pt.until(() => sim.meteors && sim.meteors.active, 6000, 30); return { ok: !!r.v, ms: r.ms };`, 20)));
  ok('9: Mighty Moose summons a meteor shower: rocks in every sky', met.every((m) => m.ok) && met.filter((m) => !m.skipped).length >= 6, met.map((m) => (m.skipped ? `(${m.skipped})` : m.ms)).join(','));
  await all((p) => p.eval(`if (sim.meteors && sim.meteors.active) sim.meteors.end(); return true;`));
  await sleep(15500);
  // The pause menu's own Disasters button, in multiplayer: the same, for everybody.
  const fog = await G.eval(`
    sim.pause();
    await new Promise((r) => setTimeout(r, 200));
    const btn = document.querySelector('[data-natural="fogBank"]');
    if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    sim.resume();
    return { btn: !!btn };`, 20);
  const fogAll = await Promise.all(pages.slice(0, 7).map((p) => p.eval(`if (sim.state !== 'flying' && sim.state !== 'paused') return { ok: true, skipped: sim.state }; const r = await pt.until(() => sim.activeEvents && 'fogBank' in sim.activeEvents, 6000, 30); return { ok: !!r.v, ms: r.ms };`, 20)));
  ok('9: Gentle Lark presses the pause menu’s own "Fog bank" button: it rolls in for everybody, not just Gentle Lark', fog.btn && fogAll.every((f) => f.ok) && fogAll.filter((f) => !f.skipped).length >= 6, fogAll.map((f) => (f.skipped ? `(${f.skipped})` : f.ms)).join(','));

  /* ======== 8: the Ring Rally, in a private match on Coral Atoll ======== */
  await all((p) => p.eval(`mp.leave('left'); await new Promise((r) => setTimeout(r, 400)); pt.mpMod.openMultiplayer(sim); return true;`, 30));
  await sleep(1500);
  const made = await E.eval(`
    pt.click('[data-mp-race-pick]');
    await new Promise((r) => setTimeout(r, 200));
    const t0 = performance.now();
    pt.click('[data-mp-private]');
    const r = await pt.until(() => mp.role === 'host' && mp.ready && sim.state === 'flying', 60000);
    return { ok: !!r.v, ms: Math.round(performance.now() - t0), map: sim.settings.map, code: mp.server && mp.server.code };`, 90);
  ok('8: "Pick Coral Atoll for a private match" and Make it: a private match on the race course, with a code', made.ok && made.map === 'atoll' && !!made.code, `${made.ms} ms, ${made.code}`);
  const joinCode = (p) => p.eval(`
    const box = document.querySelector('[data-mp-code]');
    box.value = ${JSON.stringify(String(made.code || '').replace(/-/g, ' '))};
    box.dispatchEvent(new Event('input', { bubbles: true }));
    pt.click('[data-mp-join-code]');
    const r = await pt.until(() => mp.role === 'client' && mp.ready && sim.state === 'flying', 60000);
    return { ok: !!r.v, map: sim.settings.map, id: mp.meId };`, 90);
  const racers = [A, B, C, D, F, G, H];
  const joins = [];
  for (const p of racers) joins.push(await joinCode(p));
  ok('8: the other seven type the code and are all on Coral Atoll', joins.every((j) => j.ok && j.map === 'atoll'), joins.map((j) => `${j.id}`).join(','));
  await sleep(3000);
  const chipsR = await all((p) => p.eval(`const b = document.querySelector('[data-mpp-chip="race"]'); return b && !b.hidden ? b.textContent : null;`));
  ok('8: every badge has 🏁 Race on the race course', chipsR.every((c) => c && /Race/.test(c)), chipsR.join(' | '));
  // Everybody's scripted pilot: waits for GO, then flies the course, each at its own speed.
  // Twenty metres a second between one and the next: a whole second or two apart at the line, whatever the Mac is doing.
  const speeds = [360, 340, 320, 300, 280, 260, 240, 220];
  await all((p) => p.eval(`
    const RR = pt.RR;
    const speed = ${speeds[pages.indexOf(p)]};
    pt.pilot = null;
    pt.before = (dt) => {
      const st = pt.race.raceState();
      const L = pt.race.raceDebug().L;
      if (!st || st.s !== RR.S.go || !L || L.slot < 0) { pt.pilot = null; return; }
      if (!pt.pilot) {
        const fr = pt.race.raceDebug().frames;
        const g = RR.gridSlot(L.slot);
        const path = [{ x: g.x, y: sim.aircraft.pos.y + 6, z: g.z }];
        for (let k = 0; k < RR.totalRings(); k++) { const f = fr[k % fr.length]; path.push({ x: f.x - f.nx * 60, y: f.y, z: f.z - f.nz * 60 }); path.push({ x: f.x + f.nx * 60, y: f.y, z: f.z + f.nz * 60 }); }
        // Past the line, each to a place of its own, so nobody finishes inside anybody else.
        const fin = fr[fr.length - 1];
        path.push({ x: fin.x + fin.nx * 900, y: fin.y + 80 + L.slot * 25, z: fin.z + fin.nz * 900 + (L.slot - 3.5) * 120 });
        pt.pilot = { path, i: 0, u: 0, t0: performance.now(), done: 0 };
      }
      const P = pt.pilot;
      // Flown on the clock, not by frames: a tab that hitches catches up — 40 m a frame at most, so a catch-up never
      // cuts a corner past a ring (run 6: at 250 m a frame, a tab back from a long picture skipped ring 14).
      const due = (speed * (performance.now() - P.t0)) / 1000;
      let move = Math.min(40, Math.max(0, due - P.done));
      P.done += move;
      while (move > 0 && P.i < P.path.length - 1) {
        const a = P.path[P.i]; const b = P.path[P.i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
        const left = len * (1 - P.u);
        if (move < left) { P.u += move / len; move = 0; } else { move -= left; P.i++; P.u = 0; }
      }
      const a = P.path[Math.min(P.i, P.path.length - 1)]; const b = P.path[Math.min(P.i + 1, P.path.length - 1)];
      const x = a.x + (b.x - a.x) * P.u; const y = a.y + (b.y - a.y) * P.u; const z = a.z + (b.z - a.z) * P.u;
      const hd = (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI + 360) % 360;
      pt.place(x, y, z, hd, 50);
    };
    return true;`));
  if (SHOTS) await Promise.all([C.size(1024, 768), D.size(1366, 768)]);
  const asked = await A.eval(`pt.click('[data-mpp-chip="race"]'); return true;`);
  const grid = await all((p) => p.eval(`
    const r = await pt.until(() => { const s = pt.race.raceState(); return s && s.s === pt.RR.S.grid; }, 8000, 30);
    await new Promise((res) => setTimeout(res, 600));
    const L = pt.race.raceDebug().L;
    const g = L ? pt.RR.gridSlot(L.slot) : null;
    return { ok: !!r.v, slot: L ? L.slot : -1, off: g ? Math.round(Math.hypot(sim.aircraft.pos.x - g.x, sim.aircraft.pos.z - g.z)) : null, hud: pt.text('.race-hud') };`, 20));
  await C.eval(`await pt.until(() => pt.race.raceDebug().stats.countdown.includes('2'), 6000, 20); return true;`, 20);
  await snap(C, 'p2-grid1024.png');
  if (SHOTS) await C.unsize();
  ok('8: 🏁 Race on one badge: all eight on the grid, each in its own place, "on the grid" at the top of every screen',
    asked && grid.every((g) => g.ok && g.slot >= 0 && g.off !== null && g.off < 4) && new Set(grid.map((g) => g.slot)).size === 8,
    grid.map((g) => `${g.slot}:${g.off}m`).join(' '));
  const gone = await all((p) => p.eval(`
    const r = await pt.until(() => { const s = pt.race.raceState(); return s && s.s === pt.RR.S.go; }, 10000, 30);
    await pt.until(() => pt.race.raceDebug().stats.countdown.includes('GO'), 3000, 30);
    return { ok: !!r.v, cards: pt.race.raceDebug().stats.countdown.slice() };`, 20));
  ok('8: the lights count 3, 2, 1 in every tab — and GO', gone.every((g, i) => g.ok && (g.cards.join() === '3,2,1,GO' || (i === 2 && g.cards.at(-1) === 'GO'))), `${gone.map((g) => `${g.ok ? '' : '(no GO state) '}${g.cards.join('')}`).join(' | ')} (tab 3 had its picture taken during the count)`);
  await sleep(14000);
  await snap(D, 'p2-race1366.png');
  if (SHOTS) await D.unsize();
  const fin = await all((p) => p.eval(`
    const r = await pt.until(() => { const s = pt.race.raceState(); return s && s.s === pt.RR.S.done; }, 90000, 100);
    const s = pt.race.raceState();
    await new Promise((res) => setTimeout(res, 500));
    const card = document.querySelector('.race-results');
    const L = pt.race.raceDebug().L;
    return { ok: !!r.v, fin: s ? s.fin : null, rings: pt.race.raceDebug().stats.rings, card: card && !card.hidden ? card.textContent.replace(/\\s+/g, ' ') : null, refused: pt.race.raceDebug().refused,
      why: { state: sim.state, role: mp.role, crash: sim.aircraft ? sim.aircraft.crashReason || '' : '', k: L ? L.k : null, fin: L ? L.fin : null, out: L ? L.out : null, pauses: pt.gaps.length } };`, 120));
  const order = fin[4].fin ? fin[4].fin.map((f) => f[0]) : [];
  const expected = pages.map((p, i) => ({ i, id: i === 4 ? 0 : joins[racers.indexOf(p)] ? joins[racers.indexOf(p)].id : null, speed: speeds[i] })).sort((a, b) => b.speed - a.speed).map((x) => x.id);
  // Tabs 3 and 4 stop for a picture during the race (the countdown, and mid-course), and their pilots lose that
  // time: the other six must finish in the order of their speeds; all eight must finish, in every tab alike.
  const pictured = new Set([joins[racers.indexOf(C)].id, joins[racers.indexOf(D)].id]);
  const orderRest = order.filter((id) => !pictured.has(id));
  const expectedRest = expected.filter((id) => !pictured.has(id));
  ok('8: eight scripted pilots, eight speeds, through all sixteen rings: every finish taken, the same results in every tab, and the six not stopped for a picture in the order of their speeds',
    fin.every((f) => f.ok && f.fin && f.fin.length === 8 && f.fin.map((x) => x[0]).join() === order.join()) && orderRest.join() === expectedRest.join() && fin.every((f) => f.rings === 16),
    `order ${order.join(',')} (by speed ${expected.join(',')}; ${[...pictured].join(' and ')} stopped for pictures); times ${fin[4].fin ? fin[4].fin.map((x) => (x[1] / 1000).toFixed(1)).join(', ') : '-'} s; refused ${fin.flatMap((f) => f.refused).slice(0, 3).join(' / ')}; ${fin.filter((f) => f.rings !== 16).map((f) => JSON.stringify(f.why)).join(' ')}`);
  M.race = { order, times: fin[4].fin ? fin[4].fin.map((x) => x[1]) : null };
  ok('8: the results card in every tab: medals, names and times, and "Race again"', fin.every((f) => f.card && /🥇/.test(f.card) && /🥈/.test(f.card) && /🥉/.test(f.card) && /Race again/.test(f.card) && /Swift Falcon/.test(f.card)),
    fin[0].card ? fin[0].card.slice(0, 200) : 'no card');
  await shot(A, 'p2-results1366.png', 1366, 768);
  await all((p) => p.eval(`pt.before = null; return true;`));
  } // phases

  /* ======== THE REPAIRS: the van, the boat and an iPad in one lobby ======== */
  await repairs(pages, url);

  const errs = await all((p) => p.eval('return pt.err || null;'));
  const exceptions = pages.flatMap((p) => p.logs.filter((l) => /exception/.test(l)));
  const gaps = await all((p) => p.eval('return pt.gaps.length;'));
  M.pauses = gaps;
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
