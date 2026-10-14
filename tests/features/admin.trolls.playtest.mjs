/**
 * "troll thing for admin", played in real tabs of ONE headless Chrome, over
 * tools/lan-server.py --local — four players in Lobby 2: a plain HOST, an
 * ADMIN (the test admin key, typed in the real way: mp.tryCode), the OWNER (the
 * test owner key, as tests/features/owner.playtest.mjs uses it) and a
 * CLASSMATE. The codes are in no file of the game or of this test; they are
 * read from .claude/devtools/admin-keys/ when it runs and only ever typed into
 * the one tab that holds each. What it proves, measured:
 *
 *   lists       the admin's player list has 🃏 Troll on the host's and the
 *               classmate's rows and not on the owner's; the owner's has it
 *               on the admin's too; the classmate's has none
 *   trolls      real clicks on the admin's row: Barrel roll and Freeze land on
 *               the classmate ("trolled by an admin") and wear off in real
 *               time; the cooldown tells a second troll to wait; Upside-down
 *               lands on the plain host; the OWNER trolls the admin and the tag
 *               says the owner
 *   blockers    an admin cannot troll, send a disaster after, or teleport the
 *               OWNER — asked by hand, the host refuses all three; a plain
 *               classmate whose own copy CLAIMS to be an admin is refused
 *               too (the host checked no key for them)
 *   disasters   the admin's tornado "until I stop it" after the classmate is
 *               on all four screens, the owner's lightning on the same player
 *               replaces it and the admin cannot put it back; STOP NOW on the
 *               admin's own ends it everywhere
 *   teleport    "Teleport them" + a REAL click on the admin's minimap sends the
 *               classmate to 12,000 ft (the host sees them there); the admin's
 *               own teleport; no Take over for the admin, and the admin's ask
 *               to take an aircraft over reaches nothing
 *
 *   node tests/features/admin.trolls.playtest.mjs
 *     --url=http://127.0.0.1:9221/   a LAN server already serving the game (else one is started)
 *     --json=<file>                  the numbers there too
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { findOwnerTestKey } from './multiplayer.owner.mjs';
import { findTestKey } from './multiplayer.admin.mjs';

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
const SHOTS = arg('shots');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/* ---- the shared browser slot (as cdp.mjs) ---------------------------- */
const SLOT_DIR = '/tmp/ifs-chrome-slots';
const SLOT_POLL_MS = 60;
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
    // A freed slot is re-taken within milliseconds by a builder running check after check, so a poll every second and a half never wins it: look often (a mkdir, nothing more).
    await sleep(SLOT_POLL_MS);
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
  const dir = mkdtempSync(join(tmpdir(), 'ifs-owner-trolls-chrome-'));
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
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
    eval: (body, secs = timeoutS) => raw(`(async () => { const sim = window.__sim; const pt = window.__pt; const mp = pt && pt.mp; const own = pt && pt.own; const TD = window.__ownerTrolls; const DD = window.__ownerDisasters; const TP = window.__ownerTeleport; ${body}\n})()`, secs * 1000),
    async shot(file) {
      if (!SHOTS) return false;
      await this.eval('try { window.__realRender(sim.scene, sim.camera); } catch (e) {} return true;', 20).catch(() => {});
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SHOTS, file), Buffer.from(r.data, 'base64'));
      return true;
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
  const O = await import('/src/features/multiplayer/owner.js');
  const Prog = await import('/src/game/progression.js');
  const FX = await import('/src/features/owner/fx.js');
  const MW = await import('/src/features/mpworld.js');
  const TR = await import('/src/features/traffic.js');
  const WF = await import('/src/features/wildfire.js');
  const WS = await import('/src/features/wasted.js');
  const SH = await import('/src/features/mpplay/shared.js');
  const pt = (window.__pt = { THREE, mpMod, O, Prog, FX, MW, TR, WF, WS, SH, mp: mpMod.multiplayer, own: O.owner, ticks: 0, toasts: [] });
  window.__realRender = s.renderer.render.bind(s.renderer);
  s.renderer.render = () => {};
  if (s.hud && s.hud.notify) {
    const n = s.hud.notify.bind(s.hud);
    s.hud.notify = (html, kind, secs) => { pt.toasts.push(String(html).replace(/<[^>]+>/g, '')); return n(html, kind, secs); };
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
  pt.click = (sel) => { const el = document.querySelector(sel); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; };
  pt.text = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null; };
  pt.airborne = (x, z, hdg = 90, agl = 400) => {
    s.aircraft.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: hdg, speed: 60, altAGL: agl, engineOn: true, gearDown: false });
    s.aircraft.controls.throttle = 0.7;
    if (s.input) { s.input.throttleTarget = 0.7; if (s.input.out) s.input.out.throttle = 0.7; }
    if (s.rig) s.rig.initialised = false;
  };
  pt.upY = () => new THREE.Vector3(0, 1, 0).applyQuaternion(s.aircraft.quat).y;
  pt.state = () => ({
    mine: window.__ownerTrolls.mine(), tag: pt.text('[data-owner-trolltag]') || '', pink: FX.pinkCount(s.model), scale: s.model.scale.x, visible: s.model.visible,
    flip: s.renderer.domElement.style.transform, wasted: WS.wasted.active, frozen: window.__ownerTrolls.frozen(), vy: s.aircraft.vel.y, y: s.aircraft.pos.y, x: s.aircraft.pos.x, z: s.aircraft.pos.z,
    showers: window.__ownerTrolls.showers(), upY: pt.upY(), speed: s.aircraft.airspeed, crashed: s.aircraft.crashed, onGround: s.aircraft.onGround, type: s.aircraftType && s.aircraftType.id,
    dis: window.__ownerDisasters.active(), tornado: !!(s.tornado && s.tornado.active), torPos: s.tornado && s.tornado.active ? [Math.round(s.tornado.pos.x), Math.round(s.tornado.pos.z)] : null,
    blackout: s.instrumentBlackout || 0, cond: s.weather.effectiveCondition, events: Object.keys(s.activeEvents || {}), feed: SH.feedLines(), card: SH.bigCardText(), bolts: window.__ownerDisasters.bolts(),
  });
}
window.__pt.mp.setProfile({ name: ${JSON.stringify(name)}, colour: ${JSON.stringify(colour)}, chosen: true });
window.__pt.mp.profile.key = ('k' + Math.random().toString(36).slice(2) + '0000000000000000000').slice(0, 20);
return { state: sim.state, name: window.__pt.mp.profile.name };`;


const NAMES = ['Kind Koala', 'Swift Falcon', 'Brave Otter', 'Sunny Puffin'];
const COLOURS = ['#ff5a4f', '#ff9f1c', '#4fd684', '#58c6ff'];
const OK_ = findOwnerTestKey();
const AK_ = findTestKey();
if (!OK_ || !AK_) {
  console.error('the admin trolls playtest needs .claude/devtools/admin-keys/test-owner.json and test-admin.json (the test keys) — not found');
  process.exit(2);
}
const OWNERKEY = JSON.stringify({ x: OK_.x, y: OK_.y });
const ADMINKEY = JSON.stringify({ x: AK_.x, y: AK_.y });

const url = await serve();
log(`serving ${url}`);
const pages = [];
let exitCode = 1;
try {
  for (let i = 0; i < NAMES.length; i++) {
    const p = await openPage(`${url}?dev=1`, `tab${i + 1}`);
    const r = await p.eval(PAGE(NAMES[i], COLOURS[i]), 120);
    // The test keys, as keys this copy accepts (never shipped); the codes themselves only go to the one tab that types each.
    await p.eval(`pt.O.addOwnerKey(${OWNERKEY}); pt.A = await import('/src/features/multiplayer/admin.js'); pt.A.addAdminKey(${ADMINKEY}); return pt.O.ownerKeys().length;`, 30);
    pages.push(p);
    log(`tab${i + 1} up as ${r.name} (${r.state})`);
  }
  const [T1, T2, T3, T4] = pages; // T1 the host (a plain player), T2 the ADMIN, T3 the OWNER, T4 a classmate
  const adminOn = await T2.eval(`const r = await pt.mp.tryCode(${JSON.stringify(AK_.code)}); return { ok: !!(r && r.ok), admin: pt.mp.isAdmin, owner: pt.mp.isOwner };`, 60);
  ok('the test admin code makes the second tab an admin (and not the owner)', adminOn.ok && adminOn.admin && !adminOn.owner, adminOn);
  const ownerOn_ = await T3.eval(`sim.menus.show('main'); pt.O.clearTries(); const r = pt.own.tryCode(${JSON.stringify(OK_.code)}, pt.Prog.isDev(sim.menus.prog)); return { ok: r.ok, chip: pt.text('[data-owner-chip]') };`);
  ok('the test owner code makes the third tab the owner for an hour', ownerOn_.ok && /OWNER · 60 min/.test(ownerOn_.chip || ''), ownerOn_);

  /* ---- Lobby 2: host, admin, owner, classmate ------------------------------------------------ */
  await Promise.all(pages.map((p) => p.eval(`pt.mpMod.openMultiplayer(sim); const r = await pt.until(() => document.querySelectorAll('.mp-lobby.is-empty, .mp-lobby.is-open, .mp-lobby.is-full').length >= 5, 30000); return r.ms;`, 60)));
  const join = (p, n) => p.eval(`
    const t0 = performance.now();
    const said = document.querySelector('[data-mp-status]'); if (said) said.textContent = '';
    pt.click('[data-mp-lobby-join="${n}"]');
    const r = await pt.until(() => (mp.ready && mp.lobby && sim.state === 'flying') || (!mp.busy && !mp.lobby && document.querySelector('[data-mp-status]').textContent), 60000);
    return { ms: Math.round(performance.now() - t0), role: mp.role, id: mp.meId, status: pt.text('[data-mp-status]') };`, 90);
  const joins = [];
  for (const p of [T1, T2, T3, T4]) joins.push(await join(p, 2));
  ok('four into Lobby 2: the first hosts, the admin, the owner and a classmate join', joins[0].role === 'host' && joins.slice(1).every((j) => j.role === 'client'), joins.map((j) => `${j.role}#${j.id} ${j.ms} ms`).join(', '));
  const ids = { host: joins[0].id, admin: joins[1].id, owner: joins[2].id, mate: joins[3].id };
  await Promise.all(pages.map((p) => p.eval('const r = await pt.until(() => mp.remotes.players.size === 3 && [...mp.remotes.players.values()].every((q) => q.tag && q.tag.key), 25000); mp.syncRoster(); return !!r.v;', 40)));
  const roles = await Promise.all([T2, T3, T4].map((p) => p.eval('const r = await pt.until(() => mp.me.admin !== undefined, 5000); return { admin: !!mp.me.admin, owner: !!mp.me.owner };', 15)));
  await T2.eval('const r = await pt.until(() => mp.me.admin, 15000); return !!r.v;', 30);
  const roles2 = await T2.eval('return { admin: !!mp.me.admin, owner: !!mp.me.owner };');
  ok('the host checked the keys: the admin’s copy is an admin and not the owner, the owner’s the owner, the classmate’s neither', roles2.admin && !roles2.owner && roles[1].owner && !roles[2].admin && !roles[2].owner, { admin: roles2, owner: roles[1], mate: roles[2] });
  await T1.eval('pt.airborne(0, 0, 90, 400); return true;');
  await T2.eval('pt.airborne(300, 0, 90, 400); return true;');
  await T3.eval('pt.airborne(600, 0, 90, 400); return true;');
  await T4.eval('pt.airborne(900, 0, 90, 400); return true;');
  await sleep(1500);

  /* ---- the admin's list ----------------------------------------------------------------------- */
  const list = await T2.eval(`
    mp.hud.hold(true); mp.syncRoster();
    return [...document.querySelectorAll('[data-mp-list] .mp-prow')].map((r) => ({ id: Number((r.querySelector('[data-mp-ping]') || { dataset: {} }).dataset.mpPing), text: r.textContent.replace(/\\s+/g, ' ').trim(), troll: !!r.querySelector('[data-mp-own-open]'), admin: !!r.querySelector('[data-mp-adm-open]') }));`);
  const rowOf = (id) => list.find((r) => r.id === id) || {};
  ok('the admin’s player list has 🃏 Troll on the host’s and the classmate’s rows and NOT on the owner’s or on its own',
    list.length === 4 && rowOf(ids.host).troll === true && rowOf(ids.mate).troll === true && rowOf(ids.owner).troll === false && rowOf(ids.admin).troll === false, list.map((r) => `${r.text}${r.troll ? ' [🃏]' : ''}`).join(' | '));
  const owners = await T3.eval(`
    mp.hud.hold(true); mp.syncRoster();
    const rows = [...document.querySelectorAll('[data-mp-list] .mp-prow')].map((r) => ({ id: Number((r.querySelector('[data-mp-ping]') || { dataset: {} }).dataset.mpPing), troll: !!r.querySelector('[data-mp-own-open]') }));
    mp.hud.hold(false); return rows;`);
  const mates = await T4.eval('mp.hud.hold(true); mp.syncRoster(); const n = document.querySelectorAll(\'[data-mp-list] [data-mp-own-open]\').length; mp.hud.hold(false); return n;');
  ok('the owner’s list has 🃏 Troll on the admin’s row too (only the owner trolls admins) and not on its own; the classmate’s list has none',
    owners.length === 4 && owners.find((r) => r.id === ids.admin).troll === true && owners.find((r) => r.id === ids.owner).troll === false && owners.find((r) => r.id === ids.mate).troll === true && mates === 0, { owners, mates });

  /* ---- an admin trolls the classmate: real clicks, real waits ---------------------------------- */
  const open = (id) => T2.eval(`
    mp.hud.hold(true); mp.syncRoster();
    if (TD.menu.open !== ${id}) pt.click('[data-mp-list] [data-mp-own-open="${id}"]');
    if (TD.menu.tab !== 'trolls') pt.click('[data-mp-list] [data-mp-own="tab:trolls:${id}"]');
    return !!document.querySelector('[data-mp-list] [data-mp-ownrow="${id}"]');`);
  const fire = (id, trollId) => T2.eval(`mp.syncRoster(); return pt.click('[data-mp-list] [data-mp-own="troll:${trollIndexOf(trollId)}:${id}"]');`);
  const TROLL_IDS = ['roll', 'yeet', 'tiny', 'giant', 'harrison', 'flip', 'wasted', 'pink', 'ducks', 'moon', 'bring', 'go', 'freeze'];
  function trollIndexOf(name) { return TROLL_IDS.indexOf(name); }
  ok('the gold row opens on the classmate', await open(ids.mate));
  await fire(ids.mate, 'roll');
  const rolled = await T4.eval(`const r = await pt.until(() => TD.mine().includes('roll'), 6000); const tag = pt.text('[data-owner-trolltag]') || ''; await new Promise((f) => setTimeout(f, 800)); return { ms: r.ms, ok: !!r.v, tag, upY: pt.upY() };`, 20);
  const rolledOff = await T4.eval(`const r = await pt.until(() => !TD.mine().includes('roll'), 6000); await new Promise((f) => setTimeout(f, 300)); return { ms: r.ms, gone: !!r.v, upY: pt.upY(), tag: pt.text('[data-owner-trolltag]') || '' };`, 20);
  ok('Barrel roll from the admin: it lands on the classmate, the tag says “trolled by an admin — Barrel roll”, the aeroplane is mid-roll, and it wears off by itself (real time) with the aeroplane the player’s again',
    rolled.ok && /trolled by an admin — Barrel roll/.test(rolled.tag) && rolledOff.gone && rolledOff.upY > 0.3 && !/Barrel/.test(rolledOff.tag), { rolled, rolledOff });
  // The cooldown, whoever trolls: a second one straight away is told to wait; six seconds on, it goes through.
  await fire(ids.mate, 'freeze');
  await sleep(250);
  const wait1 = await T2.eval(`return { feed: pt.SH.feedLines().join(' | ') };`);
  const notYet = await T4.eval('return { mine: TD.mine(), frozen: TD.frozen() };');
  ok('a second troll straight after is told to wait (“Give them a moment”) and does not arrive; the first one’s wear-off is over', /Give them a moment/.test(wait1.feed) && !notYet.mine.includes('freeze'), { feed: wait1.feed.slice(-160), notYet });
  await sleep(6200);
  await fire(ids.mate, 'freeze');
  const frozen = await T4.eval(`const r = await pt.until(() => TD.frozen(), 5000); const tag = pt.text('[data-owner-trolltag]') || ''; const off = await pt.until(() => !TD.frozen(), 6000); return { on: !!r.v, tag, offMs: off.ms, off: !!off.v };`, 20);
  ok('six seconds later it goes through: Freeze controls lands (tag “by an admin”) and wears off by itself in about 3 s', frozen.on && /trolled by an admin — Freeze controls/.test(frozen.tag) && frozen.off && frozen.offMs > 1500 && frozen.offMs < 5000, frozen);

  // An admin trolls the host (a plain player): the host's picture goes upside down for 5 s, then back.
  await open(ids.host);
  await sleep(6200);
  await fire(ids.host, 'flip');
  const flip = await T1.eval(`const r = await pt.until(() => sim.renderer.domElement.style.transform === 'rotate(180deg)', 5000); const tag = pt.text('[data-owner-trolltag]') || ''; const off = await pt.until(() => sim.renderer.domElement.style.transform === '', 9000); return { on: !!r.v, tag, off: !!off.v, offMs: off.ms };`, 25);
  ok('an admin trolls the host (a plain player too): Upside-down camera lands, then turns back by itself after about 5 s', flip.on && /by an admin — Upside-down/.test(flip.tag) && flip.off && flip.offMs > 3000, flip);

  /* ---- the owner trolls the admin; the admin cannot troll the owner ------------------------------ */
  await T3.eval(`mp.hud.hold(true); mp.syncRoster(); pt.click('[data-mp-list] [data-mp-own-open="${ids.admin}"]'); if (TD.menu.tab !== 'trolls') pt.click('[data-mp-list] [data-mp-own="tab:trolls:${ids.admin}"]'); return pt.click('[data-mp-list] [data-mp-own="troll:${trollIndexOf('flip')}:${ids.admin}"]');`);
  const adminHit = await T2.eval(`const r = await pt.until(() => TD.mine().includes('flip'), 6000); const tag = pt.text('[data-owner-trolltag]') || ''; const off = await pt.until(() => !TD.mine().includes('flip'), 9000); return { on: !!r.v, tag, off: !!off.v };`, 25);
  ok('the OWNER trolls the admin (real click on the owner’s list): it lands on the admin, the tag says the owner, and it wears off', adminHit.on && /trolled by the owner — Upside-down/.test(adminHit.tag) && adminHit.off, adminHit);
  const refusedBefore = await T1.eval('return { refused: TD.stats.refused, sent: TD.stats.sent };');
  await sleep(6200);
  const menuSent = await T2.eval(`return TD.send(${trollIndexOf('pink')}, ${ids.owner});`); // the menu itself will not send
  await T2.eval(`return pt.mp.events.toHost('owner:troll', { k: ${trollIndexOf('pink')}, t: ${ids.owner} });`); // …and by hand, the host refuses
  await T2.eval(`return pt.mp.events.toHost('owner:dis', { id: 'tornado', t: ${ids.owner}, s: 30 });`);
  await T2.eval(`return pt.mp.events.toHost('owner:tp', { t: ${ids.owner}, x: 5000, y: 3000, z: 5000 });`);
  await sleep(1500);
  const ownerSafe = await T3.eval(`return { mine: TD.mine(), pink: pt.FX.pinkCount(sim.model), dis: DD.active().length, tornado: !!(sim.tornado && sim.tornado.active), y: Math.round(sim.aircraft.pos.y), crashed: sim.aircraft.crashed };`);
  const refusedAfter = await T1.eval('return { refused: TD.stats.refused, sent: TD.stats.sent, dis: DD.stats.refused };');
  ok('BLOCKER: the admin cannot troll the OWNER — a troll, a disaster and a teleport asked for by hand are all refused by the host, and nothing happens to the owner',
    ownerSafe.mine.length === 0 && ownerSafe.pink === 0 && ownerSafe.dis === 0 && !ownerSafe.tornado && ownerSafe.y < 1500 && menuSent === false && refusedAfter.sent === refusedBefore.sent && refusedAfter.refused > refusedBefore.refused, { ownerSafe, refusedBefore, refusedAfter });

  /* ---- a plain classmate cannot troll at all, even dressed up as an admin --------------------------- */
  const spoof = await T4.eval(`
    const real = mp.me;
    mp.me = { ...real, admin: true };
    const sent = [TD.send(${trollIndexOf('pink')}, ${ids.host}), window.__ownerDisasters.send('tornado', ${ids.host}, 30)];
    mp.me = real;
    mp.events.toHost('owner:tp', { t: ${ids.host}, x: 4000, y: 3000, z: 4000 });
    return sent;`);
  await sleep(1500);
  const hostSafe = await T1.eval('return { mine: TD.mine(), dis: DD.active().length, y: Math.round(sim.aircraft.pos.y), refused: TD.stats.refused, dRefused: DD.stats.refused };');
  ok('BLOCKER: a plain classmate whose own copy CLAIMS to be an admin sends a troll, a disaster and a teleport at the host: the host (which checked no key for them) refuses every one — nothing happens',
    spoof.every((v) => v === true) && hostSafe.mine.length === 0 && hostSafe.dis === 0 && hostSafe.y < 1500 && hostSafe.refused > refusedAfter.refused && hostSafe.dRefused > refusedAfter.dis, { spoof, hostSafe });

  /* ---- an admin's disaster ------------------------------------------------------------------------ */
  await T2.eval(`
    mp.hud.hold(true); mp.syncRoster();
    if (TD.menu.open !== ${ids.mate}) pt.click('[data-mp-list] [data-mp-own-open="${ids.mate}"]');
    pt.click('[data-mp-list] [data-mp-own="tab:dis:${ids.mate}"]');
    pt.click('[data-mp-list] [data-mp-own="pick:tornado:${ids.mate}"]');
    pt.click('[data-mp-list] [data-mp-own="secs:0:${ids.mate}"]');
    return pt.click('[data-mp-list] [data-mp-own="dis:${ids.mate}"]');`);
  const everywhere = await Promise.all(pages.map((p) => p.eval(`const r = await pt.until(() => DD.active().some((i) => i.id === 'tornado' && i.t === ${ids.mate} && i.applied) && sim.tornado && sim.tornado.active, 12000); return { ms: r.ms, ok: !!r.v, by: (DD.active()[0] || {}).by };`, 30)));
  ok('the admin’s tornado “until I stop it” after the classmate starts on all four screens, and says the admin sent it', everywhere.every((e) => e.ok && e.by === ids.admin), everywhere);
  const ownersOnMate = await T3.eval(`pt.mp.events.toHost('owner:dis', { id: 'lightning', t: ${ids.mate}, s: 60 }); await new Promise((f) => setTimeout(f, 1200)); return DD.active().map((i) => i.id + ':' + i.by);`);
  const stillAdmins = await T2.eval(`pt.mp.events.toHost('owner:dis', { id: 'lightning', t: ${ids.mate}, s: 30 }); await new Promise((f) => setTimeout(f, 1200)); return DD.active().map((i) => i.id + ':' + i.by + (i.by === mp.meId ? ' (me)' : ''));`);
  ok('the owner’s lightning on the same classmate replaces the admin’s tornado; the admin cannot put its own back over it (the owner’s stays)', ownersOnMate.join() === `lightning:${ids.owner}` && stillAdmins.join() === `lightning:${ids.owner}`, { ownersOnMate, stillAdmins });
  await T3.eval(`pt.mp.events.toHost('owner:disstop', { n: 0 }); return true;`);
  await sleep(1000);
  await T2.eval(`mp.hud.hold(true); mp.syncRoster(); if (TD.menu.open !== ${ids.mate}) pt.click('[data-mp-list] [data-mp-own-open="${ids.mate}"]'); pt.click('[data-mp-list] [data-mp-own="tab:dis:${ids.mate}"]'); pt.click('[data-mp-list] [data-mp-own="secs:0:${ids.mate}"]'); return pt.click('[data-mp-list] [data-mp-own="dis:${ids.mate}"]');`);
  await T2.eval(`const r = await pt.until(() => DD.active().some((i) => i.by === mp.meId), 8000); return !!r.v;`, 20);
  const stopBtn = await T2.eval(`mp.syncRoster(); const b = document.querySelector('[data-mp-list] [data-mp-own^="stop:"]'); const text = b ? b.textContent : null; return { has: !!b, text, clicked: b ? pt.click('[data-mp-list] [data-mp-own^="stop:"]') : false };`);
  const gone = await Promise.all(pages.map((p) => p.eval(`const r = await pt.until(() => DD.active().length === 0 && !(sim.tornado && sim.tornado.active), 8000); return { ms: r.ms, ok: !!r.v };`, 20)));
  ok('STOP NOW on the admin’s own disaster (the button on its row) ends it on all four screens', stopBtn.has && stopBtn.clicked && gone.every((g) => g.ok), { stopBtn, gone });

  /* ---- teleport ------------------------------------------------------------------------------------- */
  await T2.eval('pt.airborne(300, 0, 90, 500); if (sim.minimap) sim.minimap.toggle(true); return true;');
  await sleep(700);
  const armed = await T2.eval(`
    mp.hud.hold(true); mp.syncRoster();
    if (TD.menu.open !== ${ids.mate}) pt.click('[data-mp-list] [data-mp-own-open="${ids.mate}"]');
    if (TD.menu.tab !== 'trolls') pt.click('[data-mp-list] [data-mp-own="tab:trolls:${ids.mate}"]');
    pt.click('[data-mp-list] [data-mp-own="tp:${ids.mate}"]');
    mp.hud.hold(false);
    TP.sync();
    const r = sim.minimap.canvas.getBoundingClientRect();
    const tools = TP.tools();
    const takeBtn = tools && tools.querySelector('[data-owner-take-list]');
    return { armed: TP.armed(), x: Math.round(r.left + r.width * 0.72), y: Math.round(r.top + r.height * 0.5), w: r.width, span: sim.minimap.span, craft: { x: sim.minimap._g.craft.x, z: sim.minimap._g.craft.z },
      tools: !!tools && !tools.hidden, takeHidden: !!takeBtn && takeBtn.hidden, hint: tools ? tools.textContent.replace(/\\s+/g, ' ').trim() : '' };`);
  ok('“🗺 Teleport them” on the classmate’s row arms the map for them, and the admin’s tools bar says “tap the map to teleport” with no Take over button', armed.armed && armed.armed.id === ids.mate && armed.w > 50 && armed.tools && armed.takeHidden && /tap the map/.test(armed.hint), armed);
  await T2.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: armed.x, y: armed.y, button: 'left', clickCount: 1 });
  await T2.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: armed.x, y: armed.y, button: 'left', clickCount: 1 });
  await sleep(250);
  const picker = await T2.eval(`const el = document.querySelector('[data-owner-tp]'); const tap = TP.T.tap; const take = el && el.querySelector('[data-tp-take]'); return { open: !!el && !el.hidden, who: pt.text('[data-owner-tp] [data-tp-who]'), tap: tap && { x: Math.round(tap.x), z: Math.round(tap.z) }, takeHidden: !take || take.hidden, max: el ? Number(el.querySelector('[data-tp-range]').max) : 0 };`);
  const wantX = armed.craft.x + armed.span * 0.22;
  ok('a REAL click on the admin’s minimap opens the teleport picker for the classmate at the place the map shows (height up to 50,000 ft)', picker.open && !!picker.who && picker.tap && Math.abs(picker.tap.x - wantX) < armed.span * 0.02 && picker.max === 50000 && picker.takeHidden, { picker, wantX });
  await T2.eval(`const r = document.querySelector('[data-owner-tp] [data-tp-range]'); r.value = '12000'; r.dispatchEvent(new Event('input', { bubbles: true })); return pt.click('[data-owner-tp] [data-tp-go]');`);
  const mateTp = await T4.eval(`const r = await pt.until(() => Math.hypot(sim.aircraft.pos.x - ${picker.tap.x}, sim.aircraft.pos.z - ${picker.tap.z}) < 250 && Math.abs(sim.aircraft.pos.y / 0.3048 - 12000) < 600, 6000); return { ms: r.ms, ok: !!r.v, ft: Math.round(sim.aircraft.pos.y / 0.3048), speed: Math.round(sim.aircraft.airspeed), crashed: sim.aircraft.crashed, tag: pt.text('[data-owner-trolltag]') || '' };`, 20);
  const hostSees = await T1.eval(`const r = await pt.until(() => { const q = mp.remotes.players.get(${ids.mate}); return q && q.drawn && Math.hypot(q.drawn.x - ${picker.tap.x}, q.drawn.z - ${picker.tap.z}) < 400 && q.drawn.y > 3000; }, 8000); return { ms: r.ms, ok: !!r.v };`, 20);
  ok('Teleport (12,000 ft) by the admin: the classmate’s copy puts them there, flying at a sane speed, the tag says an admin, and the host sees them there', mateTp.ok && mateTp.speed > 50 && !mateTp.crashed && /trolled by an admin — .*teleported by/.test(mateTp.tag) && hostSees.ok, { mateTp, hostSees });
  // The admin's own teleport, on its own map (a tap with nobody armed).
  const self = await T2.eval(`
    TP.arm(null);
    const r = sim.minimap.canvas.getBoundingClientRect();
    TP.tapped({ x: sim.aircraft.pos.x + 800, z: sim.aircraft.pos.z, craft: null, rect: r });
    TP.setFt(5000);
    const take = TP.picker().querySelector('[data-tp-take]');
    TP.go();
    const ok = await pt.until(() => Math.abs(sim.aircraft.pos.y / 0.3048 - 5000) < 400, 4000);
    return { ok: !!ok.v, ft: Math.round(sim.aircraft.pos.y / 0.3048), takeHidden: take.hidden, crashed: sim.aircraft.crashed };`, 20);
  ok('the admin teleports itself on its own map: 5,000 ft, not crashed', self.ok && !self.crashed && self.takeHidden, self);

  /* ---- taking over stays the owner's ----------------------------------------------------------------- */
  const takeBefore = await T1.eval('return TP.stats.takeAsked;');
  await T2.eval(`return pt.mp.events.toHost('owner:take', { id: 1 });`);
  await sleep(600);
  const takeAfter = await T1.eval('return TP.stats.takeAsked;');
  const ownerTools = await T3.eval(`TP.sync(); const t = TP.tools(); const b = t && t.querySelector('[data-owner-take-list]'); return { tools: !!t && !t.hidden, take: !!b && !b.hidden };`);
  ok('taking an aircraft over stays the owner’s: the admin’s ask never reaches the host’s traffic, while the owner’s own tools bar still has Take over', takeAfter === takeBefore && ownerTools.tools && ownerTools.take, { takeBefore, takeAfter, ownerTools });

  const errs = await Promise.all(pages.map((p) => p.eval('return pt.err;')));
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
  console.log(JSON.stringify({ passed, total: R.length, numbers: M, failed: R.filter((r) => !r.pass) }, null, 1));
  if (arg('json')) writeFileSync(arg('json'), JSON.stringify({ passed, total: R.length, numbers: M, results: R }, null, 1));
  cleanup();
  process.exit(exitCode);
}
