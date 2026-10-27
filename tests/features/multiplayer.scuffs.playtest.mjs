/**
 * The multiplayer scuffs (.claude/devtools/briefs/mp-scuffs.md, the audit of
 * live v64), each checked again after its fix — in real tabs of ONE headless
 * Chrome, over tools/lan-server.py --local, with the game's own update
 * running in each and the real lobby screen, WebRTC stack and signalling.
 *
 *   A  host, 1366x768            B  player, 1366x768
 *   C  a late joiner, 1366x768   D  a phone on its side, 844x390, touch
 *
 *   #1   the Summon and Chat menus: every button on the screen, and the
 *        button under its own middle (real hit test), laptop and phone
 *   #2   Restart and Return to the airfield: two players 20 m apart, not 0
 *   #3   two vans in one lobby: apart, not one inside the other
 *   #4   the phone: the badge covers none of the HUD (smoke chip, EJECT,
 *        joystick, instruments) and is the one-row (or column) form
 *   #5   the race results card: for racers; a racer who left still named;
 *        a late joiner gets no card
 *   #6   a refused join: the message and its one-tap fix on screen
 *   #7   the host's tab closed: "X left — you're hosting now" / "Y is
 *        hosting now", and no "joined" for friends already there
 *   #8   a friend's smoke trail is drawn
 *   #9   a friend's hangar livery is on their model; the boat keeps its paint
 *   #10  a paused friend: "⏸ away" on the tag, and a ghost
 *   #11  the lobby line at the top, no boat patrol, the tower uses the name
 *   #12  in a boat lobby with PvP on, the badge covers none of the HUD
 *   #13  a friend's crash: the wreck stays, with smoke, and a 💥 toast
 *   #14  joining mid-race: "you can race the next one", no Leave race
 *   #15  no friends' arrows drawn where the minimap was, after a crash
 *
 *   node tests/features/multiplayer.scuffs.playtest.mjs
 *     --url=http://127.0.0.1:9271/   a LAN server already serving the game (else one is started)
 *     --json=<file>                  the results there too
 *
 * Holds one of the shared headless-Chrome slots (the same lock as
 * .claude/devtools/cdp.mjs), muted. Plays no sound.
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

/* ---- the shared browser slot (as cdp.mjs) ---------------------------- */
const SLOT_DIR = '/tmp/ifs-chrome-slots';
function slotCount() {
  try {
    const at = [ROOT, resolve(ROOT, '..'), resolve(ROOT, '..', '..'), resolve(ROOT, '..', '..', '..')]
      .map((d) => join(d, '.claude', 'devtools', 'chrome-boost.json')).find((f) => existsSync(f));
    const b = JSON.parse(readFileSync(at, 'utf8'));
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
    await sleep(60);
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
  const dir = mkdtempSync(join(tmpdir(), 'ifs-mp-scuffs-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--mute-audio', '--enable-unsafe-swiftshader', '--window-size=1366,768',
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

async function openPage(url, name, { w = 1366, h = 768, mobile = false } = {}, timeoutS = 240) {
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
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(`[error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 400));
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
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  if (mobile) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' });
  }
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
    target,
    eval: (body, secs = 60) => raw(`(async () => { const sim = window.__sim; const pt = window.__pt; const mp = pt && pt.mp; ${body}\n})()`, secs * 1000),
    async click(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
    async tap(x, y) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await sleep(60);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
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
  const race = await import('/src/features/race.js');
  const RR = await import('/src/features/race/rules.js');
  const SH = await import('/src/features/mpplay/shared.js');
  const LK = await import('/src/features/mplook.js');
  const FUN = await import('/src/features/fun.js');
  const OF = await import('/src/features/onfoot.js');
  const pt = (window.__pt = { THREE, mpMod, race, RR, SH, LK, FUN, OF, mp: mpMod.multiplayer, ticks: 0, toasts: [] });
  window.__realRender = s.renderer.render.bind(s.renderer);
  s.renderer.render = () => {};
  if (s.hud && s.hud.notify) {
    const n = s.hud.notify.bind(s.hud);
    s.hud.notify = (html, kind, secs) => { pt.toasts.push(String(html).replace(/<[^>]+>/g, '')); if (pt.toasts.length > 100) pt.toasts.shift(); return n(html, kind, secs); };
  }
  let last = performance.now();
  pt.timer = setInterval(() => {
    const t = performance.now();
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    try { s.update(dt); } catch (err) { pt.err = String(err && err.stack || err).slice(0, 400); }
    pt.ticks++;
  }, 33);
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
  pt.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  pt.click = (sel) => { const el = document.querySelector(sel); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; };
  pt.text = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null; };
  pt.airborne = (x, z, hdg = 90, agl = 300, speed = 55) => {
    s.aircraft.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: hdg, speed, altAGL: agl, engineOn: true, gearDown: false });
    s.aircraft.controls.throttle = 0.7;
    if (s.input) { s.input.throttleTarget = 0.7; if (s.input.out) s.input.out.throttle = 0.7; }
  };
  /* Every button of a menu on the screen, and the one under its own middle — the way a real click finds it. */
  pt.reach = (m, sel) => {
    if (!m || m.hidden) return { open: false };
    let on = 0, hit = 0;
    const btns = [...m.querySelectorAll(sel)];
    for (const b of btns) {
      b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect();
      if (r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth) on++;
      const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (h && (h === b || b.contains(h))) hit++;
    }
    m.scrollTop = 0;
    const r = m.getBoundingClientRect();
    return { open: true, n: btns.length, on, hit, top: Math.round(r.top), bottom: Math.round(r.bottom) };
  };
  /*
   * What the badge covers, of the HUD it must keep clear of, measured independently of the badge's own list.
   * The repair round added what the first list missed: the buttons deeper in the touch layer (the boat's
   * lever detents), the lit get-out prompt (the only way out on a touch screen) and the minimap itself.
   */
  pt.covers = () => {
    const b = document.querySelector('.mp-badge').getBoundingClientRect();
    const hits = [];
    const vis = (n) => { const r = n.getBoundingClientRect(); const cs = getComputedStyle(n); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
    for (const n of document.querySelectorAll('#ui [class*="hud-"], .touch-layer > *, .touch-layer button, .fun-chip, .ej-col > *, .wf-panel, .of-prompt.on, .minimap-canvas')) {
      if (n.closest('.mp-hud, .hud-toasts, .hud-subtitle, .hud-banner, .hud-controls-card') || /hud-(toast|subtitle|coach|banner|controls-card|papi)/.test(n.className)) continue;
      if (!vis(n)) continue;
      const r = n.getBoundingClientRect();
      if (r.width > innerWidth * 0.6 || r.height > innerHeight * 0.6) continue;
      if (r.left < b.right - 1 && r.right > b.left + 1 && r.top < b.bottom - 1 && r.bottom > b.top + 1) hits.push(String(n.className).split(' ')[0]);
    }
    return { size: innerWidth + 'x' + innerHeight, badge: [b.left, b.top, b.width, b.height].map(Math.round), hits, placed: pt.mp.hud.placed };
  };
  /* The get-out prompt: lit, and what a finger at its middle (and its two ends) lands on. */
  pt.door = () => {
    const p = document.querySelector('.of-prompt');
    if (!p) return { lit: false };
    const r = p.getBoundingClientRect();
    const y = (r.top + r.bottom) / 2;
    const ours = [r.left + 8, (r.left + r.right) / 2, r.right - 8].every((x) => { const h = document.elementFromPoint(x, y); return !!h && (h === p || p.contains(h)); });
    return { lit: p.classList.contains('on') && p.classList.contains('act'), text: p.textContent, r: [r.left, r.top, r.right, r.bottom].map(Math.round), ours, x: Math.round((r.left + r.right) / 2), y: Math.round(y) };
  };
  /* The boat's engine lever: every detent's middle and corners are the detent's own. */
  pt.lever = () => {
    const out = [];
    for (const d of document.querySelectorAll('.touch-detent')) {
      const r = d.getBoundingClientRect();
      if (r.width < 2) continue;
      const pts = [[(r.left + r.right) / 2, (r.top + r.bottom) / 2], [r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]];
      const bad = pts.filter(([x, y]) => { const h = document.elementFromPoint(x, y); return !(h && (h === d || d.contains(h))); }).length;
      out.push(d.textContent.trim() + (bad ? ' ✗' + bad : ''));
    }
    return out;
  };
  pt.mp.install(s);
}
window.__pt.mp.setProfile({ name: ${JSON.stringify(name)}, colour: ${JSON.stringify(colour)}, chosen: true });
return { state: sim.state, name: window.__pt.mp.profile.name };`;

const JOIN = (n, ride) => `
  if (mp.role || mp.lobby) mp.leave('left');
  await pt.sleep(300);
  if (sim.state !== 'menu') { sim.quitToMenu('main'); await pt.sleep(300); }
  ${ride ? `mp.setRide(${JSON.stringify(ride)});` : ''}
  pt.mpMod.openMultiplayer(sim);
  await pt.until(() => document.querySelectorAll('.mp-lobby.is-empty, .mp-lobby.is-open, .mp-lobby.is-full').length >= 5, 30000);
  const said = document.querySelector('[data-mp-status]'); if (said) said.textContent = '';
  pt.click('[data-mp-lobby-join="${n}"]');
  const r = await pt.until(() => (mp.ready && mp.lobby && sim.state === 'flying') || (!mp.busy && !mp.lobby && document.querySelector('[data-mp-status]').textContent), 60000);
  await pt.sleep(500);
  return { ok: !!(mp.ready && mp.lobby), role: mp.role, id: mp.meId, mode: sim.mode, map: sim.settings.map, status: pt.text('[data-mp-status]') };`;

const MY_POS = `const v = sim.mode === 'drive' && sim.vehicle ? sim.vehicle.pos : sim.aircraft.pos; return { x: v.x, z: v.z };`;
const dist = (a, b) => Math.round(Math.hypot(a.x - b.x, a.z - b.z) * 10) / 10;

const url = await serve();
log(`serving ${url}`);
const pages = [];
let exitCode = 1;
try {
  const specs = [['A', 'Brave Otter', '#ff5a4f', {}], ['B', 'Swift Falcon', '#4fd684', {}], ['C', 'Kind Koala', '#ffd23f', {}], ['D', 'Sunny Puffin', '#ff9f1c', { w: 844, h: 390, mobile: true }]];
  for (const [n, nm, col, size] of specs) {
    const p = await openPage(`${url}?dev=1`, n, size);
    await p.eval(PAGE(nm, col), 120);
    pages.push(p);
    log(`${n} up as ${nm}`);
  }
  const [A, B, C, D] = pages;
  const plane = { game: 'flight', type: 'skylark' };

  /* ---- Lobby 2 (Coral Atoll): A hosts, B and the phone join ----------------------------------------- */
  const ja = await A.eval(JOIN(2, plane), 90);
  const jb = await B.eval(JOIN(2, plane), 90);
  const jd = await D.eval(JOIN(2, plane), 90);
  ok('A hosts Lobby 2, B and the phone D join it', ja.role === 'host' && jb.role === 'client' && jd.role === 'client', [ja, jb, jd].map((j) => `${j.role}#${j.id}`).join(' '));
  await sleep(1500);

  /* #1 — the menus on a laptop */
  const menusA = await A.eval(`
    mp.hud.place(sim);
    document.querySelector('[data-mp-chat]').click();
    const chat = pt.reach(document.querySelector('[data-mp-chatmenu]'), '[data-mp-say]');
    document.querySelector('[data-mp-chat]').click();
    document.querySelector('[data-mpp-chip="summon"]').click();
    const summon = pt.reach(document.querySelector('.mpp-menu'), '[data-summon]');
    document.querySelector('[data-mpp-chip="summon"]').click();
    return { chat, summon };`);
  ok('#1 at 1366x768: all 8 Summon disasters and all 10 quick chats are on the screen and clickable (Summon was 4 off the top)',
    menusA.summon.n === 8 && menusA.summon.on === 8 && menusA.summon.hit === 8 && menusA.chat.n === 10 && menusA.chat.on === 10 && menusA.chat.hit === 10, menusA);
  /* #1 and #4 — the phone */
  const phone = await D.eval(`
    await pt.sleep(1200);
    mp.hud.place(sim);
    const cov = pt.covers();
    document.querySelector('[data-mp-chat]').click();
    const chat = pt.reach(document.querySelector('[data-mp-chatmenu]'), '[data-mp-say]');
    document.querySelector('[data-mp-chat]').click();
    document.querySelector('[data-mpp-chip="summon"]').click();
    const summon = pt.reach(document.querySelector('.mpp-menu'), '[data-summon]');
    document.querySelector('[data-mpp-chip="summon"]').click();
    return { cov, chat, summon, touch: document.documentElement.classList.contains('is-touch-device') };`);
  ok('#4 phone 844x390: the badge covers none of the HUD (smoke chip, EJECT, joystick, instruments), in its compact form',
    phone.touch && phone.cov.hits.length === 0 && phone.cov.placed && phone.cov.placed.compact && phone.cov.placed.covers === 0, phone.cov);
  ok('#1 phone: all 10 quick chats and all 8 disasters reachable (6 chats were below the screen)',
    phone.chat.on === 10 && phone.chat.hit === 10 && phone.summon.on === 8 && phone.summon.hit === 8, { chat: phone.chat, summon: phone.summon });
  /* #1, the repair round: a Summon menu cut down to scroll on the phone opens under the badge, not over its own chips (it was clamped with its full height, to y = 8) */
  const sumD = await D.eval(`
    document.querySelector('[data-mpp-chip="summon"]').click();
    await pt.sleep(150);
    const m = document.querySelector('.mpp-menu').getBoundingClientRect();
    const b = document.querySelector('.mp-badge').getBoundingClientRect();
    const over = Math.max(0, Math.min(m.right, b.right) - Math.max(m.left, b.left)) * Math.max(0, Math.min(m.bottom, b.bottom) - Math.max(m.top, b.top));
    document.querySelector('[data-mpp-chip="summon"]').click();
    return { menu: [m.left, m.top, m.right, m.bottom].map(Math.round), badge: [b.left, b.top, b.right, b.bottom].map(Math.round), over: Math.round(over) };`);
  ok('#1r phone: the Summon menu does not open over the badge (its Players, Chat and PvP chips)', sumD.over === 0, sumD);
  /*
   * #4, the repair round (a checker on phones): standing still on the runway the
   * "Tap here to get out" door is a touch screen's only way out, and the one-row
   * badge sat on it (a tap on it turned PvP on). And on smaller phones the badge
   * slid over the minimap, which its own list did not have. Every size the
   * checker tried, the phone held upright too: the door lit and all of it the
   * door's own, and the badge over none of the HUD, the door or the map.
   */
  const sizes = [[844, 390], [667, 375], [740, 360], [568, 320], [812, 375], [932, 430], [390, 844]];
  const sweep = [];
  for (const [w, h] of sizes) {
    await D.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    sweep.push(await D.eval(`await pt.sleep(1300); mp.hud.place(sim); return { door: pt.door(), cov: pt.covers() };`));
  }
  await D.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  for (const [i, [w, h]] of sizes.entries()) {
    const m = sweep[i];
    ok(`#4r phone ${w}x${h}, still on the runway: the get-out door is lit and all of it is the door's; the badge covers none of the HUD, the door or the minimap`,
      m.door.lit && m.door.ours && m.cov.hits.length === 0, { door: m.door.r, under: m.door.ours, hits: m.cov.hits, badge: m.cov.badge, form: m.cov.placed && m.cov.placed.form, covers: m.cov.placed && m.cov.placed.covers });
  }
  const door = await D.eval(`await pt.sleep(1300); mp.hud.place(sim); return { door: pt.door(), pvp: mp.pvp };`);
  await D.tap(door.door.x, door.door.y);
  const got = await D.eval(`const r = await pt.until(() => pt.OF.onFoot.active, 5000); return { out: !!r.v, pvp: mp.pvp };`, 20);
  ok('#4r phone: a real tap on the middle of the door gets the player out, and PvP is left as it was (the tap used to turn it on)', got.out && got.pvp === door.pvp, { door: door.door, got });
  await D.eval('sim.restart(); await pt.sleep(900); return 1;');
  // EJECT shows once airborne on a phone: still clear.
  const phoneAir = await D.eval(`pt.airborne(300, 400, 90, 300); await pt.sleep(1600); mp.hud.place(sim); return pt.covers();`);
  ok('#4 phone, airborne (EJECT up): the badge still covers nothing', phoneAir.hits.length === 0, phoneAir);
  const laptopCov = await A.eval('await pt.sleep(1100); mp.hud.place(sim); return pt.covers();');
  ok('#12 laptop: the badge covers none of the HUD', laptopCov.hits.length === 0 && laptopCov.placed.covers === 0, laptopCov);

  /* #11 — the lobby line, the tower */
  const solo = await B.eval(`return { obj: pt.text('#ui .hud-objective'), cs: sim.atc.callsign, runner: sim.runner.status };`);
  ok('#11 the line at the top is the lobby\'s, not Free Flight\'s; the tower calls B "Swift Falcon"',
    /Lobby 2/.test(solo.obj || '') && /with friends/.test(solo.obj || '') && !/runway 09/.test(solo.obj || '') && solo.cs === 'Swift Falcon', solo);

  /* #2 — restarts */
  await A.eval('sim.restart(); return 1;');
  await B.eval('sim.restart(); return 1;');
  await sleep(700);
  const pA = await A.eval(MY_POS);
  const pB = await B.eval(MY_POS);
  const dRestart = dist(pA, pB);
  await A.eval('sim.returnToAirport(); return 1;');
  await B.eval('sim.returnToAirport(); return 1;');
  await sleep(700);
  const dHome = dist(await A.eval(MY_POS), await B.eval(MY_POS));
  ok('#2 "Reset on the runway" and "Return to the airfield": A and B at least 9 m apart (were 0 m)', dRestart >= 9 && dHome >= 9, { dRestart, dHome });

  /* #8, #9 — smoke and livery */
  await A.eval(`pt.airborne(0, 0, 90, 300); sim.settings.liveries = { ...(sim.settings.liveries || {}), [sim.aircraftType.id]: 'abyssinia' }; await pt.sleep(400); pt.FUN.__test.toggleSmoke(sim); return pt.FUN.smokeNow();`);
  await B.eval('pt.airborne(-160, 30, 90, 300); return 1;');
  await sleep(3500);
  const seesA = await B.eval(`const p = mp.remotes.players.get(0); const d = pt.LK.lookDebug(); const t = d.trails.find((x) => x.id === 0); return { key: p && p.modelKey, puffs: t ? t.live : 0, look: d.looks && d.looks['0'] };`);
  ok('#8 B sees A\'s smoke trail (was none)', seesA.puffs > 20 && seesA.look && seesA.look.s === true, seesA);
  ok('#9 B draws A in A\'s hangar livery (Abyssinia), A\'s colour kept', /abyssinia$/.test(seesA.key || '') && /#ff5a4f/.test(seesA.key || ''), seesA.key);

  /* #10 — paused */
  await A.eval(`pt.FUN.__test.toggleSmoke(sim); sim.pause(); return sim.state;`);
  const away = await B.eval(`const r = await pt.until(() => { const p = mp.remotes.players.get(0); return p && p.away && p.sample && p.sample.snap.ghost; }, 6000); await pt.sleep(700); const p = mp.remotes.players.get(0); return { ok: !!r.v, ms: r.ms, note: p.tagNote, ghost: p.sample.snap.ghost };`, 20);
  await A.eval('sim.resume(); return 1;');
  const back = await B.eval(`const r = await pt.until(() => { const p = mp.remotes.players.get(0); return p && !p.away && !p.sample.snap.ghost; }, 6000); return !!r.v;`, 20);
  ok('#10 A pauses: B\'s tag for A says "⏸ away" and A is a ghost; back to normal on resume', away.ok && /away/.test(away.note || '') && back, { away, back });

  /* #13 and #15 — a crash */
  await A.eval('pt.airborne(-200, 0, 90, 80, 50); return 1;');
  await B.eval('pt.airborne(-320, 40, 90, 80, 50); pt.toasts.length = 0; return 1;');
  await sleep(800);
  await A.eval(`setTimeout(() => sim.aircraft.crash('You flew into the ground', { part: 'fuselage', worldPoint: sim.aircraft.pos.clone() }), 100); return 1;`);
  const crashA = await A.eval(`
    const r = await pt.until(() => sim.state === 'debrief', 15000);
    await pt.sleep(300);
    const mini = document.querySelector('[data-mp-mini]');
    const shown = !!mini && mini.style.display !== 'none' && !mp.hud.el.hidden && mp.hud.el.style.visibility !== 'hidden';
    return { debrief: !!r.v, miniOverEmptyMap: shown && sim.minimap.el.style.display === 'none' };`, 30);
  const wreck = await B.eval(`
    const r = await pt.until(() => { const p = mp.remotes.players.get(0); return p && p.wrecked; }, 12000);
    const p = mp.remotes.players.get(0);
    return { kept: !!r.v, model: !!(p && p.model && p.model.visible), puffs: pt.LK.lookDebug().stats.wreckPuffs || 0, toast: pt.toasts.find((t) => /💥/.test(t)) || null };`, 30);
  ok('#13 A crashes: B still sees A\'s wreck after A\'s debrief is up, smoke over it, and a 💥 toast (A used to vanish)', crashA.debrief && wreck.kept && wreck.model && wreck.puffs > 10 && !!wreck.toast, { crashA, wreck });
  ok('#15 after the crash no friends\' arrows are drawn over a minimap that is not there', !crashA.miniOverEmptyMap, crashA);
  await A.eval('sim.restart(); return 1;');
  await sleep(1500);

  /* #5 and #14 — a race, a late joiner, a racer who leaves */
  await A.eval(`await pt.sleep(500); document.querySelector('[data-mpp-chip="race"]').click(); return 1;`);
  const grid = await Promise.all([A, B, D].map((p) => p.eval(`const r = await pt.until(() => { const s = pt.race.raceState(); return s && s.s === pt.RR.S.go; }, 12000); const L = pt.race.raceDebug().L; return { go: !!r.v, slot: L && L.slot };`, 30)));
  ok('the race: A, B and the phone on the grid, then GO', grid.every((g) => g.go && g.slot >= 0), grid);
  const jc = await C.eval(JOIN(2, plane), 90);
  const late = await C.eval(`await pt.sleep(1500); const L = pt.race.raceDebug().L; const bar = document.querySelector('.race-hud'); const chip = document.querySelector('[data-mpp-chip="race"]');
    return { late: L && L.late, slot: L && L.slot, bar: bar && !bar.hidden ? bar.textContent.replace(/\\s+/g, ' ').trim() : null, chip: chip ? chip.textContent : null };`, 20);
  ok('#14 C joins mid-race: told "you can race the next one", the chip says "Race on…" (not Leave race), not a racer even if given a racer\'s number',
    jc.ok && late.late === true && late.slot === -1 && /race the next one/.test(late.bar || '') && /Race on/.test(late.chip || '') && !/Leave/.test(late.chip || ''), { jc, late });
  await B.eval(`mp.leave('left'); return 1;`);
  await sleep(1200);
  await Promise.all([A, D].map((p) => p.eval(`const c = document.querySelector('[data-mpp-chip="race"]'); if (/Leave/.test(c.textContent)) c.click(); return 1;`)));
  const done = await Promise.all([A, C].map((p) => p.eval(`const r = await pt.until(() => { const s = pt.race.raceState(); return s && s.s === pt.RR.S.done; }, 12000); await pt.sleep(600); const res = document.querySelector('.race-results');
    return { done: !!r.v, card: res && !res.hidden ? res.textContent.replace(/\\s+/g, ' ') : null, feed: pt.SH.feedLines().join(' | ') };`, 30)));
  ok('#5 the results card is the racers\': A\'s names Swift Falcon (who left) — not "Somebody"', done[0].done && /Swift Falcon/.test(done[0].card || '') && !/Somebody/.test(done[0].card || ''), done[0].card);
  ok('#5 C, who arrived mid-race, gets no results card over the cockpit (a line in the corner instead)', done[1].done && !done[1].card, done[1]);

  /* #6 — a refused join on the phone: the message and the fix on screen */
  const dupe = await D.eval(`
    if (mp.role || mp.lobby) mp.leave('left');
    await pt.sleep(400);
    sim.quitToMenu('main');
    await pt.sleep(300);
    mp.setProfile({ name: 'Kind Koala', chosen: true });
    pt.mpMod.openMultiplayer(sim);
    await pt.until(() => document.querySelectorAll('.mp-lobby.is-empty, .mp-lobby.is-open, .mp-lobby.is-full').length >= 5, 30000);
    const scr = document.querySelector('[data-screen="lobbies"]');
    const btn = scr.querySelector('[data-mp-lobby-join="2"]');
    btn.scrollIntoView({ block: 'center' });
    await pt.sleep(200);
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), folded: scr.classList.contains('is-folded') };`, 60);
  await D.tap(dupe.x, dupe.y);
  const refused = await D.eval(`
    await pt.until(() => !mp.busy && document.querySelector('[data-mp-status]').textContent, 15000);
    await pt.sleep(300);
    const st = document.querySelector('[data-mp-status]');
    const off = document.querySelector('[data-mp-offer-go]');
    const seen = (el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && !!h && (h === el || el.contains(h)); };
    const r = off.getBoundingClientRect();
    return { status: st.textContent, statusSeen: seen(st), offer: off.textContent, offerSeen: seen(off), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };`, 30);
  ok('#6 phone: a refused join says why, and its one-tap fix, on the screen where the Join was tapped (was 393 px below it)', /already called Kind Koala/.test(refused.status) && refused.statusSeen && refused.offerSeen, refused);
  ok('#6 the username, ride and PvP cards fold to one line once the name is picked', dupe.folded, dupe);
  await D.tap(refused.x, refused.y);
  const fixed = await D.eval(`const r = await pt.until(() => mp.ready && mp.lobby && sim.state === 'flying', 20000); return { ok: !!r.v, name: mp.profile.name };`, 30);
  ok('#6 one tap on the fix joins as "Kind Koala 2"', fixed.ok && /Kind Koala \d/.test(fixed.name), fixed);

  /* #3 — vans; #9 the boat keeps its paint */
  const car = { game: 'car', type: 'car' };
  const jvb = await B.eval(JOIN(1, car), 90);
  const jvc = await C.eval(JOIN(1, car), 90);
  await sleep(800);
  const dVan = dist(await B.eval(MY_POS), await C.eval(MY_POS));
  await C.eval('sim.restart(); return 1;');
  await sleep(700);
  const dVan2 = dist(await B.eval(MY_POS), await C.eval(MY_POS));
  ok('#3 two vans in Lobby 1 start apart, and after a restart too (were inside each other)', jvb.mode === 'drive' && jvc.mode === 'drive' && dVan >= 6 && dVan2 >= 6, { dVan, dVan2, jvb, jvc });
  const paint = await B.eval(`const out = {}; for (const k of ['boat', 'car']) { const m = mp.remotes._build(k, k, '#4fd684'); const t = m.userData.mpTinted || []; let white = 0; m.traverse((o) => { if (o.isMesh && /paint_(white|main)/.test(o.material && o.material.name)) white++; }); out[k] = { tinted: t.length, white }; } return out;`);
  ok('#9 a friend\'s boat and van keep their own paint (white kept), their colour on the stripe', paint.boat.tinted > 0 && paint.boat.white > 0 && paint.car.tinted > 0 && paint.car.white > 0, paint);

  /* #12 and #11 — a boat lobby with PvP on: the badge clear of the Wind panel; no patrol */
  const boat = { game: 'boat', type: 'boat' };
  await A.eval(`mp.setPvp(true); return 1;`);
  const jba = await A.eval(JOIN(3, boat), 90);
  await D.eval(`mp.setPvp(true); return 1;`);
  const jbd = await D.eval(JOIN(3, boat), 90);
  await sleep(4500);
  const boatA = await A.eval(`mp.hud.place(sim); await pt.sleep(1200); mp.hud.place(sim); return { cov: pt.covers(), runner: sim.runner.def ? sim.runner.def.id : sim.runner.status, obj: pt.text('#ui .hud-objective') };`);
  const boatD = await D.eval(`await pt.sleep(1200); mp.hud.place(sim); return { cov: pt.covers(), lever: pt.lever(), runner: sim.runner.def ? sim.runner.def.id : sim.runner.status };`);
  ok('#12 a boat lobby with PvP on: the badge covers none of the HUD — laptop and phone', jba.mode === 'drive' && jbd.mode === 'drive' && boatA.cov.hits.length === 0 && boatD.cov.hits.length === 0, { A: boatA.cov, D: boatD.cov });
  // The repair round: the lever's detents are deeper than the touch layer's own children, and the badge sat on SLOW and STOP.
  ok('#12r the phone\'s boat: every detent of the engine lever is under a finger, none under the badge', boatD.lever.length === 5 && boatD.lever.every((d) => !/✗/.test(d)), { lever: boatD.lever, badge: boatD.cov.badge, placed: boatD.cov.placed });
  ok('#11 no lifeboat patrol in a boat lobby; the lobby line instead', boatA.runner !== 'boat-patrol' && boatD.runner !== 'boat-patrol' && /Lobby 3/.test(boatA.obj || '') && !/PATROL/i.test(boatA.obj || ''), { A: boatA.runner, D: boatD.runner, obj: boatA.obj });
  await A.eval(`mp.setPvp(false); return 1;`);
  await D.eval(`mp.setPvp(false); return 1;`);

  /* #7 — the host's tab closes */
  const jh = await A.eval(JOIN(4, plane), 90);
  const jh2 = await B.eval(JOIN(4, plane), 90);
  const jh3 = await C.eval(JOIN(4, plane), 90);
  await sleep(2500);
  await B.eval('pt.toasts.length = 0; return 1;');
  await C.eval('pt.toasts.length = 0; return 1;');
  await A.close();
  pages.splice(pages.indexOf(A), 1);
  await sleep(9500);
  const tb = await B.eval('return { role: mp.role, toasts: pt.toasts.slice() };');
  const tc = await C.eval('return { role: mp.role, toasts: pt.toasts.slice() };');
  const host = tb.role === 'host' ? tb : tc;
  const other = tb.role === 'host' ? tc : tb;
  const hostName = tb.role === 'host' ? 'Swift Falcon' : 'Kind Koala';
  ok('#7 the host\'s tab closes: the new host is told "Brave Otter left — you\'re hosting now", the other "… is hosting now"; no "joined" for a friend already there',
    jh.role === 'host' && jh2.ok && jh3.ok && host.toasts.some((t) => /Brave Otter left — you’re hosting now/.test(t)) && other.toasts.some((t) => new RegExp(`Brave Otter left — ${hostName} is hosting now`).test(t))
      && !host.toasts.some((t) => /joined/.test(t)), { B: tb, C: tc });

  const errs = await Promise.all(pages.map((p) => p.eval('return pt.err || null;')));
  const exceptions = pages.flatMap((p) => p.logs.filter((l) => /exception/.test(l)));
  ok('no exceptions in any tab', errs.every((e) => !e) && exceptions.length === 0, [...errs.filter(Boolean), ...exceptions].slice(0, 3).join(' | '));
  exitCode = R.every((r) => r.pass) ? 0 : 1;
} catch (err) {
  ok('the playtest ran to the end', false, String(err && err.stack || err).slice(0, 600));
  for (const p of pages) if (p && p.logs.length) log(`${p.name} console: ${p.logs.slice(-5).join(' | ')}`);
} finally {
  for (const p of pages) if (p) await p.close().catch(() => {});
  if (chrome) chrome.proc.kill();
  const passed = R.filter((r) => r.pass).length;
  console.log(JSON.stringify({ passed, total: R.length, failed: R.filter((r) => !r.pass) }, null, 1));
  if (arg('json')) writeFileSync(arg('json'), JSON.stringify({ passed, total: R.length, results: R }, null, 1));
  cleanup();
  process.exit(exitCode);
}
