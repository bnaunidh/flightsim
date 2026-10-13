/**
 * The owner's toys, played in real tabs of ONE headless Chrome, over
 * tools/lan-server.py --local — three players in Lobby 2: a host, the OWNER
 * (the test owner key, as tests/features/owner.playtest.mjs uses it) and a
 * classmate. What the brief asks a two-page check to prove, measured:
 *
 *   trolls      from the owner's REAL player list (clicks on the 🃏 Troll
 *               button and the gold row), every one of the thirteen arrives
 *               on its target (the target's own copy says so: the "🃏 trolled
 *               by the owner — …" tag and the effect), shows, and wears off
 *               by itself — the long ones on the classmate, the short ones on
 *               the host, six seconds apart (the cooldown); a frame strip of
 *               the barrel roll; what the other players see on the target
 *   disasters   from the row's Disasters tab: a tornado "until I stop it"
 *               after the classmate starts on all three screens, is the host's
 *               (the host says where its funnel is), chases its target, and
 *               STOP NOW ends it everywhere; a lightning storm after the
 *               classmate strikes the host standing 25 m from them too (the
 *               bystander is hit); a 10 s fog bank ends on time on all three
 *   teleport    "Teleport them" armed from the row, a REAL click on the
 *               owner's minimap (CDP mouse input), the picker, 12,000 ft:
 *               the classmate's copy puts them there and the host sees them
 *               there; the owner to 50,000 ft on their own map, seen there by
 *               the host
 *   take over   the host's AI aeroplane (the traffic the host runs), taken
 *               over from the owner's ✈ Take over list: the owner is in it,
 *               the host's traffic has lost it, and the host sees the owner
 *               flying that type
 *
 *   node tests/features/owner.trolls.playtest.mjs
 *     --url=http://127.0.0.1:9221/   a LAN server already serving the game (else one is started)
 *     --shots=<dir>                  screenshots (1366x768, and an iPad's 1024x768 touch screen) there
 *     --json=<file>                  the numbers there too
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { findOwnerTestKey } from './multiplayer.owner.mjs';

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

const NAMES = ['Kind Koala', 'Swift Falcon', 'Brave Otter'];
const COLOURS = ['#ff5a4f', '#ff9f1c', '#4fd684'];
const TK = findOwnerTestKey();
if (!TK) {
  console.error('the owner trolls playtest needs .claude/devtools/admin-keys/test-owner.json (the test owner key) — not found');
  process.exit(2);
}
const TESTKEY = JSON.stringify({ x: TK.x, y: TK.y });

const url = await serve();
log(`serving ${url}`);
const pages = [];
let exitCode = 1;
try {
  for (let i = 0; i < NAMES.length; i++) {
    const p = await openPage(`${url}?dev=1`, `tab${i + 1}`);
    const r = await p.eval(PAGE(NAMES[i], COLOURS[i]), 120);
    await p.eval(`pt.O.addOwnerKey(${TESTKEY}); return pt.O.ownerKeys().length;`, 30);
    pages.push(p);
    log(`tab${i + 1} up as ${r.name} (${r.state})`);
  }
  const [T1, T2, T3] = pages;
  const owner = await T2.eval(`sim.menus.show('main'); pt.O.clearTries(); const r = pt.own.tryCode(${JSON.stringify(TK.code)}, pt.Prog.isDev(sim.menus.prog)); return { ok: r.ok, chip: pt.text('[data-owner-chip]') };`);
  ok('the test code makes the second tab the owner for an hour', owner.ok && /OWNER · 60 min/.test(owner.chip || ''), owner);

  /* ---- Lobby 2: host, owner, classmate --------------------------------------------- */
  await Promise.all(pages.map((p) => p.eval(`pt.mpMod.openMultiplayer(sim); const r = await pt.until(() => document.querySelectorAll('.mp-lobby.is-empty, .mp-lobby.is-open, .mp-lobby.is-full').length >= 5, 30000); return r.ms;`, 60)));
  const join = (p, n) => p.eval(`
    const t0 = performance.now();
    const said = document.querySelector('[data-mp-status]'); if (said) said.textContent = '';
    pt.click('[data-mp-lobby-join="${n}"]');
    const r = await pt.until(() => (mp.ready && mp.lobby && sim.state === 'flying') || (!mp.busy && !mp.lobby && document.querySelector('[data-mp-status]').textContent), 60000);
    return { ms: Math.round(performance.now() - t0), role: mp.role, id: mp.meId, status: pt.text('[data-mp-status]') };`, 90);
  const joins = [];
  for (const p of [T1, T2, T3]) joins.push(await join(p, 2));
  ok('three into Lobby 2: the first hosts, the owner and a classmate join', joins[0].role === 'host' && joins[1].role === 'client' && joins[2].role === 'client', joins.map((j) => `${j.role}#${j.id} ${j.ms} ms`).join(', '));
  const ids = { host: joins[0].id, owner: joins[1].id, mate: joins[2].id };
  await Promise.all(pages.map((p) => p.eval('const r = await pt.until(() => mp.remotes.players.size === 2 && [...mp.remotes.players.values()].every((q) => q.tag && q.tag.key), 20000); mp.syncRoster(); return !!r.v;', 40)));
  const checked = await T2.eval('const r = await pt.until(() => mp.me.owner, 15000); return { ms: r.ms, me: mp.me };', 30);
  ok('the host checked the owner’s pass: the owner’s copy knows it is the owner here', checked.me.owner, checked);
  // Everybody in the air, apart, where the trolls can be seen to work.
  await T1.eval('pt.airborne(0, 0, 90, 400); return true;');
  await T2.eval('pt.airborne(300, 0, 90, 400); return true;');
  await T3.eval('pt.airborne(600, 0, 90, 400); return true;');
  await sleep(1200);

  /* ---- the owner's list ------------------------------------------------------------- */
  const list = await T2.eval(`
    mp.hud.hold(true); mp.syncRoster();
    const rows = [...document.querySelectorAll('[data-mp-list] .mp-prow')].map((r) => ({ text: r.textContent.replace(/\\s+/g, ' ').trim(), troll: !!r.querySelector('[data-mp-own-open]'), admin: !!r.querySelector('[data-mp-adm-open]') }));
    return rows;`);
  const others = await Promise.all([T1, T3].map((p) => p.eval('mp.hud.hold(true); mp.syncRoster(); const n = document.querySelectorAll(\'[data-mp-list] [data-mp-own-open]\').length; mp.hud.hold(false); return n;')));
  ok('the owner’s player list has 🃏 Troll beside Admin on the two others’ rows and not on their own; nobody else’s list has it',
    list.length === 3 && list.filter((r) => r.troll).length === 2 && !list.find((r) => /Swift Falcon/.test(r.text)).troll && list.filter((r) => r.admin).length === 2 && others.every((n) => n === 0),
    list.map((r) => `${r.text}${r.troll ? ' [🃏]' : ''}`).join(' | '));
  const openRow = (id) => T2.eval(`
    mp.hud.hold(true); mp.syncRoster();
    if (TD.menu.open !== ${id}) pt.click('[data-mp-list] [data-mp-own-open="${id}"]');
    if (TD.menu.tab !== 'trolls') pt.click('[data-mp-list] [data-mp-own="tab:trolls:${id}"]');
    const row = document.querySelector('[data-mp-list] [data-mp-ownrow="${id}"]');
    return { open: !!row, buttons: row ? row.querySelectorAll('[data-mp-own^="troll:"]').length : 0 };`);
  const rowOpen = await openRow(ids.mate);
  ok('the Troll button opens the gold row with the thirteen trolls', rowOpen.open && rowOpen.buttons === 13, rowOpen);
  await T2.shot('01-owner-list-troll-row-1366.png');

  /* ---- the trolls: the long ones on the classmate, the short ones on the host, six seconds apart ---- */
  const trollK = await T2.eval('return Object.fromEntries(TD.TROLLS.map((t, k) => [t.id, k]));');
  const sendTroll = async (id, target) => {
    await openRow(target);
    const t = Date.now();
    const sent = await T2.eval(`return pt.click('[data-mp-list] [data-mp-own="troll:${trollK[id]}:${target}"]');`);
    return { sent, at: t };
  };
  const arrival = (p, id, ms = 4000) => p.eval(`
    const r = await pt.until(() => TD.mine().includes(${JSON.stringify(id)}) || (${JSON.stringify(id)} === 'go'), ${ms});
    return { ms: r.ms, ok: !!r.v, ...pt.state() };`, 20);
  const gone = (p, id, ms) => p.eval(`const r = await pt.until(() => !TD.mine().includes(${JSON.stringify(id)}), ${ms}); return { ms: r.ms, ok: !!r.v, ...pt.state() };`, Math.ceil(ms / 1000) + 10);
  const lat = {};
  const tStart = Date.now();
  const at = async (secs) => { const w = tStart + secs * 1000 - Date.now(); if (w > 0) await sleep(w); };

  // t = 0: pink → mate (60 s); roll → host (1.6 s), with a frame strip of the roll.
  await sendTroll('pink', ids.mate);
  await sendTroll('roll', ids.host);
  const pinkIn = await arrival(T3, 'pink');
  lat.pink = pinkIn.ms;
  let minUp = 1;
  const strip = [];
  const rollIn = await arrival(T1, 'roll', 3000);
  for (let i = 0; i < 4; i++) {
    const s = await T1.eval('return { upY: pt.upY(), mine: TD.mine() };');
    minUp = Math.min(minUp, s.upY);
    strip.push(s.upY.toFixed(2));
    await T1.shot(`02-barrel-roll-strip-${i}.png`);
    await sleep(250);
  }
  const rollGone = await gone(T1, 'roll', 4000);
  ok('Barrel roll on the host: arrives (the tag says so), the aeroplane goes over on its back and comes round; over in two seconds',
    rollIn.ok && /trolled by the owner — Barrel roll/.test(rollIn.tag) && (minUp < 0 || rollGone.upY > 0.5) && rollGone.ok && !rollGone.crashed, { ms: rollIn.ms, strip, after: rollGone.upY.toFixed(2) });
  ok('Pink paint on the classmate: arrives, every mesh pink, the tag says so', pinkIn.ok && pinkIn.pink > 0 && /Pink paint/.test(pinkIn.tag), { ms: pinkIn.ms, pink: pinkIn.pink });
  const seenPink = await T2.eval(`const q = mp.remotes.players.get(${ids.mate}); return { theirs: TD.theirs(), pink: q && q.model ? pt.FX.pinkCount(q.model) : -1 };`);
  ok('…and the owner sees the classmate’s aeroplane pink on their own screen', seenPink.theirs[ids.mate] && seenPink.theirs[ids.mate].includes('pink') && seenPink.pink > 0, seenPink);

  // t = 6: moon → mate (20 s); yeet → host.
  await at(6.5);
  await sendTroll('moon', ids.mate);
  const vyBefore = await T1.eval('return sim.aircraft.vel.y;');
  await sendTroll('yeet', ids.host);
  const moonIn = await arrival(T3, 'moon');
  lat.moon = moonIn.ms;
  const yeetIn = await arrival(T1, 'yeet', 3000);
  const yeetGone = await gone(T1, 'yeet', 4000);
  ok('Yeet on the host: a jump of 70 m/s straight up, YEET! on the screen, over in two seconds, nobody crashed', yeetIn.ok && yeetIn.vy - vyBefore > 40 && /YEET/.test(yeetIn.card) && yeetGone.ok && !yeetGone.crashed, { ms: yeetIn.ms, dvy: (yeetIn.vy - vyBefore).toFixed(0) });
  ok('Moon gravity on the classmate: arrives, and the tag says so', moonIn.ok && /Moon gravity/.test(moonIn.tag), { ms: moonIn.ms });

  // t = 13: tiny → mate (30 s); upside-down → host (5 s).
  await at(13);
  await sendTroll('tiny', ids.mate);
  await sendTroll('flip', ids.host);
  const tinyIn = await arrival(T3, 'tiny');
  lat.tiny = tinyIn.ms;
  const flipIn = await arrival(T1, 'flip', 3000);
  await T3.shot('03-mate-pink-tiny-1366.png');
  const flipGone = await gone(T1, 'flip', 8000);
  ok('Upside-down camera on the host: the picture is turned 180° for five seconds and turned back', flipIn.ok && /rotate\(180deg\)/.test(flipIn.flip) && flipGone.ok && flipGone.flip === '' && flipGone.ms > 3000, { ms: flipIn.ms, offAfter: flipGone.ms });
  const tinyBase = pinkIn.scale;
  ok('Tiny on the classmate: their aeroplane drawn at 0.4x', tinyIn.ok && Math.abs(tinyIn.scale - tinyBase * 0.4) < 1e-6, { scale: tinyIn.scale, base: tinyBase });
  const seenTiny = await T2.eval(`const q = mp.remotes.players.get(${ids.mate}); return { theirs: TD.theirs(), scale: q && q.model ? q.model.scale.x : null };`);
  ok('…and the owner sees them tiny', seenTiny.theirs[ids.mate] && seenTiny.theirs[ids.mate].includes('tiny'), seenTiny);

  // t = 20: Harrison → mate (30 s); fake WASTED → host (4 s).
  await at(20);
  await sendTroll('harrison', ids.mate);
  await sendTroll('wasted', ids.host);
  const harrIn = await arrival(T3, 'harrison');
  lat.harrison = harrIn.ms;
  const wastedIn = await arrival(T1, 'wasted', 3000);
  const wastedShown = await T1.eval(`const r = await pt.until(() => { const root = document.querySelector('.ws-root'); return root && root.classList.contains('is-word') ? root.querySelector('.ws-word span').textContent : null; }, 3000); return r;`);
  const wastedGone = await gone(T1, 'wasted', 6000);
  ok('Fake WASTED on the host: the WASTED screen with “jk 😂” under it, gone four seconds later, nobody crashed', wastedIn.ok && wastedShown.v && /jk 😂/.test(wastedShown.v) && wastedGone.ok && !wastedGone.wasted && !wastedGone.crashed, { ms: wastedIn.ms, line: wastedShown.v });
  ok('Harrison-ify on the classmate: their own aeroplane hidden, T-Pose Harrison in its place', harrIn.ok && harrIn.visible === false, { ms: harrIn.ms });
  await T3.shot('04-mate-harrison-1366.png');

  // t = 27: duck rain → host (8 s).
  await at(27);
  await sendTroll('ducks', ids.host);
  const ducksIn = await arrival(T1, 'ducks', 3000);
  await sleep(1500);
  const ducksMid = await T1.eval('return pt.state().showers;');
  await T1.shot('05-host-duck-rain-1366.png');
  const seenDucks = await T2.eval('return TD.showers();');
  const ducksGone = await gone(T1, 'ducks', 10000);
  ok('Duck rain on the host: ducks fall round them (on their screen and on the owner’s), and stop after eight seconds', ducksIn.ok && ducksMid.some((s) => s.on && s.dropped > 3) && seenDucks.some((s) => s.dropped > 0) && ducksGone.ok && ducksGone.showers.every((s) => !s.on), { ms: ducksIn.ms, mid: ducksMid, seen: seenDucks });

  // t = 36: giant → host (30 s); t = 42: freeze → host; t = 48: bring → host; t = 54: go → mate.
  await at(36.5);
  await sendTroll('giant', ids.host);
  const giantIn = await arrival(T1, 'giant', 3000);
  const hostBase = rollIn.scale;
  ok('Giant on the host: drawn at 2.5x', giantIn.ok && Math.abs(giantIn.scale - hostBase * 2.5) < 1e-6, { scale: giantIn.scale, base: hostBase });
  // Moon off by now on the classmate (20 s from t = 6.5).
  const moonGone = await gone(T3, 'moon', 8000);
  ok('Moon gravity wore off on the classmate by itself after 20 s', moonGone.ok && !moonGone.mine.includes('moon'), moonGone.mine);
  await at(43);
  await T1.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', bubbles: true })); return true;`);
  await sleep(500);
  const freePitch = await T1.eval('return sim.aircraft.controls.pitch;');
  const frozeAt = await sendTroll('freeze', ids.host);
  const freezeIn = await arrival(T1, 'freeze', 3000);
  await sleep(300);
  const frozenPitch = await T1.eval('return { pitch: sim.aircraft.controls.pitch, frozen: TD.frozen() };');
  const freezeGone = await gone(T1, 'freeze', 6000);
  await sleep(300);
  const thawed = await T1.eval(`const p = sim.aircraft.controls.pitch; window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', key: 's', bubbles: true })); return p;`);
  ok('Freeze controls on the host: a held pitch key does nothing for three seconds, then works again', freezeIn.ok && Math.abs(freePitch) > 0.1 && frozenPitch.pitch === 0 && frozenPitch.frozen && freezeGone.ok && Math.abs(thawed) > 0.1, { freePitch, frozenPitch, thawed });
  // Tiny off by now (30 s from t = 13).
  const tinyGone = await gone(T3, 'tiny', 8000);
  ok('Tiny wore off on the classmate by itself after 30 s: the scale is back', tinyGone.ok && Math.abs(tinyGone.scale - tinyBase) < 1e-6, { scale: tinyGone.scale });
  await at(49.5);
  // The host's last troll (the freeze) must be a full cooldown behind, or the host says "give them a moment" and this one is dropped: wait it out from when the freeze was really sent.
  { const w = frozeAt.at + 6000 + 400 - Date.now(); if (w > 0) await sleep(w); }
  const ownerAt = await T2.eval('return { x: sim.aircraft.pos.x, z: sim.aircraft.pos.z, y: sim.aircraft.pos.y };');
  await sendTroll('bring', ids.host);
  const bringIn = await arrival(T1, 'bring', 3000);
  const dBring = Math.hypot(bringIn.x - ownerAt.x, bringIn.z - ownerAt.z);
  ok('Bring here on the host: the host is put beside the owner, in the air', bringIn.ok && dBring < 160 && !bringIn.onGround && !bringIn.crashed && Math.abs(bringIn.y - Math.max(ownerAt.y, 120)) < 30, { ms: bringIn.ms, dBring: dBring.toFixed(0) });
  // Harrison off by now (30 s from t = 20).
  const harrGone = await gone(T3, 'harrison', 8000);
  ok('Harrison-ify wore off on the classmate by itself after 30 s: their aeroplane is drawn again', harrGone.ok && harrGone.visible === true, harrGone.mine);
  await at(56);
  const mateAt = await T3.eval('return { x: sim.aircraft.pos.x, z: sim.aircraft.pos.z, y: sim.aircraft.pos.y };');
  await sendTroll('go', ids.mate);
  const went = await T2.eval(`const r = await pt.until(() => Math.hypot(sim.aircraft.pos.x - ${mateAt.x}, sim.aircraft.pos.z - ${mateAt.z}) < 200, 4000); return { ms: r.ms, ok: !!r.v, d: Math.hypot(sim.aircraft.pos.x - ${mateAt.x}, sim.aircraft.pos.z - ${mateAt.z}) };`);
  const goTag = await T3.eval(`const r = await pt.until(() => /the owner came to you/.test(pt.SH.bigCardText()) || /Go there/.test(pt.text('[data-owner-trolltag]') || ''), 3000); return { ok: !!r.v, tag: pt.text('[data-owner-trolltag]'), card: pt.SH.bigCardText() };`);
  ok('Go there: the owner is put beside the classmate, and the classmate is told', went.ok && goTag.ok, { went, goTag });
  M.trollArrivalMs = lat;
  // t ≈ 62: pink (60 s from 0) and giant (30 s from 36.5) wear off.
  await at(63);
  const pinkGone = await gone(T3, 'pink', 8000);
  const giantGone = await gone(T1, 'giant', 8000);
  const mateClean = await T3.eval('return pt.state();');
  const hostClean = await T1.eval('return pt.state();');
  ok('Pink paint wore off on the classmate by itself after 60 s; Giant on the host after 30 s — every troll over, the tags gone, the aeroplanes back as they were',
    pinkGone.ok && pinkGone.pink === 0 && giantGone.ok && Math.abs(giantGone.scale - hostBase) < 1e-6 && !mateClean.mine.length && !hostClean.mine.length && mateClean.tag === '' && hostClean.tag === '' && mateClean.visible,
    { mate: { mine: mateClean.mine, pink: mateClean.pink, scale: mateClean.scale, tag: mateClean.tag }, host: { mine: hostClean.mine, scale: hostClean.scale, tag: hostClean.tag } });
  const seenClean = await T2.eval('return TD.theirs();');
  ok('…and the owner’s screen draws nothing on them any more', Object.keys(seenClean).length === 0, seenClean);
  const cool = await T2.eval(`return { waits: TD.stats.waits, feed: pt.SH.feedLines() };`);

  /* ---- disasters ---------------------------------------------------------------------- */
  const disRow = (id) => T2.eval(`
    mp.hud.hold(true); mp.syncRoster();
    if (TD.menu.open !== ${id}) pt.click('[data-mp-list] [data-mp-own-open="${id}"]');
    if (TD.menu.tab !== 'dis') pt.click('[data-mp-list] [data-mp-own="tab:dis:${id}"]');
    const row = document.querySelector('[data-mp-list] [data-mp-owndis="${id}"]');
    return { open: !!row, picks: row ? [...row.querySelectorAll('[data-mp-own^="pick:"]')].map((b) => b.dataset.mpOwn.split(':')[1]) : [] };`);
  const dr = await disRow(ids.mate);
  ok('the row’s Disasters tab lists the game’s disasters: tornado, lightning, meteors, wildfire among them', dr.open && ['tornado', 'lightning', 'meteors', 'wildfire', 'fogBank'].every((d) => dr.picks.includes(d)), dr.picks.join(' '));
  await T2.shot('06-owner-disaster-tab-1366.png');
  // Everybody near each other again, apart from the owner.
  await T1.eval('pt.airborne(0, 0, 90, 500); return true;');
  await T3.eval('pt.airborne(0, 40, 90, 500); return true;');
  await T2.eval('pt.airborne(1500, 0, 90, 500); return true;');
  await sleep(800);
  const tDis = Date.now();
  await T2.eval(`pt.click('[data-mp-list] [data-mp-own="pick:tornado:${ids.mate}"]'); pt.click('[data-mp-list] [data-mp-own="secs:0:${ids.mate}"]'); return pt.click('[data-mp-list] [data-mp-own="dis:${ids.mate}"]');`);
  const torAll = await Promise.all([T1, T2, T3].map((p) => p.eval(`const r = await pt.until(() => DD.active().some((i) => i.id === 'tornado' && i.applied) && sim.tornado.active, 8000); return { ms: r.ms, ok: !!r.v, ...pt.state() };`, 20)));
  M.disasterStartMs = Math.max(...torAll.map((x) => x.ms));
  ok('GO — a tornado after the classmate, “until I stop it”: it starts on all three screens within a moment, and everybody is told who sent it after whom',
    torAll.every((x) => x.ok && x.tornado && x.dis[0].s === 0 && x.dis[0].t === ids.mate && x.dis[0].by === ids.owner) && torAll.every((x) => x.feed.some((l) => /Swift Falcon sent .*Tornado after/.test(l))),
    torAll.map((x) => `${x.ok} ${x.ms} ms`).join(', '));
  await sleep(2500);
  const chase = await Promise.all([T1, T3].map((p) => p.eval(`
    const tor = sim.tornado;
    const inst = DD.D.active.values().next().value;
    return { pos: [Math.round(tor.pos.x), Math.round(tor.pos.z)], drift: [tor.drift.x.toFixed(1), tor.drift.z.toFixed(1)], toTarget: ((${0} - tor.pos.x) * tor.drift.x + (${40} - tor.pos.z) * tor.drift.z) > 0, torAt: inst && inst.torAt, atSent: DD.stats.atSent, at: DD.stats.at };`)));
  ok('the tornado CHASES the classmate (its drift points at them on the host’s screen and on theirs); the host says where its funnel is, and the classmate’s copy has heard it',
    chase[0].toTarget && chase[1].toTarget && chase[0].atSent >= 2 && chase[1].at >= 1 && !!chase[1].torAt && Math.hypot(chase[0].pos[0] - chase[1].pos[0], chase[0].pos[1] - chase[1].pos[1]) < 400, chase);
  await T3.shot('07-mate-tornado-1366.png');
  const stopRow = await T2.eval(`mp.syncRoster(); const b = document.querySelector('[data-mp-list] [data-mp-own^="stop:"]'); const foot = pt.text('[data-mp-list] [data-mp-ownrow="stopall"]'); const t = performance.now(); if (b) b.click(); return { had: !!b, text: b && b.textContent, foot };`);
  const stopped = await Promise.all([T1, T2, T3].map((p) => p.eval(`const r = await pt.until(() => !DD.active().length && !sim.tornado.active, 6000); return { ms: r.ms, ok: !!r.v };`, 20)));
  M.stopNowMs = Math.max(...stopped.map((x) => x.ms));
  ok('STOP NOW on the row (and STOP ALL at the foot): the tornado is gone on all three screens at once', stopRow.had && /STOP NOW/.test(stopRow.text) && /STOP ALL/.test(stopRow.foot || '') && stopped.every((x) => x.ok), { stopRow, stopped: stopped.map((x) => x.ms) });
  // Lightning after the classmate, the host 40 m away: the bystander is struck too.
  await sleep(600);
  await T2.eval(`pt.click('[data-mp-list] [data-mp-own="pick:lightning:${ids.mate}"]'); pt.click('[data-mp-list] [data-mp-own="secs:30:${ids.mate}"]'); return pt.click('[data-mp-list] [data-mp-own="dis:${ids.mate}"]');`);
  const lightIn = await T1.eval(`const r = await pt.until(() => DD.active().find((i) => i.id === 'lightning'), 6000); if (r.v) { const inst = DD.D.active.get(r.v.n); inst.nextStrike = 0.3; } return { ok: !!r.v, cond: sim.weather.effectiveCondition };`);
  const struckHost = await T1.eval(`const r = await pt.until(() => sim.instrumentBlackout > 0, 8000); return { ms: r.ms, ok: !!r.v, blackout: sim.instrumentBlackout, bolts: DD.bolts(), hits: DD.stats.hits };`, 20);
  const struckMate = await T3.eval(`const r = await pt.until(() => sim.instrumentBlackout > 0 || DD.stats.strikes >= 2, 8000); return { ms: r.ms, blackout: sim.instrumentBlackout, bolts: DD.bolts(), strikes: DD.stats.strikes, cond: sim.weather.effectiveCondition };`, 20);
  const sawBolt = await T2.eval('return { bolts: DD.bolts(), cond: sim.weather.effectiveCondition };');
  ok('a lightning storm after the classmate: stormy for everybody; a strike lands beside them (the bolt on every screen, the owner’s far away too) and the host, 40 m from them, is struck — instruments out: a bystander can be hit',
    lightIn.ok && lightIn.cond === 'stormy' && struckHost.ok && struckHost.hits >= 1 && struckMate.strikes >= 1 && struckMate.bolts.struck >= 1 && sawBolt.bolts.struck >= 1 && sawBolt.cond === 'stormy',
    { host: struckHost, mate: struckMate, owner: sawBolt });
  await T2.eval(`mp.syncRoster(); return pt.click('[data-mp-list] [data-mp-own="stopall"]');`);
  await Promise.all([T1, T2, T3].map((p) => p.eval(`await pt.until(() => !DD.active().length, 6000); return true;`, 20)));
  // Ends on time: a 10 s fog bank.
  await sleep(600);
  const tFog = Date.now();
  await T2.eval(`pt.click('[data-mp-list] [data-mp-own="pick:fogBank:${ids.mate}"]'); pt.click('[data-mp-list] [data-mp-own="secs:10:${ids.mate}"]'); return pt.click('[data-mp-list] [data-mp-own="dis:${ids.mate}"]');`);
  const fogOn = await Promise.all([T1, T2, T3].map((p) => p.eval(`const r = await pt.until(() => DD.active().some((i) => i.id === 'fogBank') && sim.weather.effectiveCondition === 'rainy', 6000); return { ok: !!r.v, events: Object.keys(sim.activeEvents || {}) };`, 20)));
  const fogOff = await Promise.all([T1, T2, T3].map((p) => p.eval(`const r = await pt.until(() => !DD.active().length && sim.weather.effectiveCondition !== 'rainy', 16000); return { ms: r.ms, ok: !!r.v, cond: sim.weather.effectiveCondition, events: Object.keys(sim.activeEvents || {}) };`, 30)));
  M.fogEndMs = Date.now() - tFog;
  ok('a fog bank for 10 s after the classmate: fog for everybody, the pause menu’s Disasters knows; it ends ON TIME on all three screens (the host’s clock), about ten seconds later',
    fogOn.every((x) => x.ok && x.events.includes('fogBank')) && fogOff.every((x) => x.ok && !x.events.includes('fogBank')) && M.fogEndMs > 9000 && M.fogEndMs < 16000, { on: fogOn.map((x) => x.ok), offMs: fogOff.map((x) => x.ms), total: M.fogEndMs });
  await T2.eval('mp.hud.hold(false); return true;');

  /* ---- teleport them, and the owner to 50,000 ft ---------------------------------------- */
  await T2.eval('pt.airborne(0, 0, 90, 500); if (sim.minimap) sim.minimap.toggle(true); return true;');
  await sleep(700);
  const armed = await T2.eval(`
    mp.hud.hold(true); mp.syncRoster();
    if (TD.menu.open !== ${ids.mate}) pt.click('[data-mp-list] [data-mp-own-open="${ids.mate}"]');
    if (TD.menu.tab !== 'trolls') pt.click('[data-mp-list] [data-mp-own="tab:trolls:${ids.mate}"]');
    pt.click('[data-mp-list] [data-mp-own="tp:${ids.mate}"]');
    mp.hud.hold(false);
    const r = sim.minimap.canvas.getBoundingClientRect();
    return { armed: TP.armed(), x: Math.round(r.left + r.width * 0.72), y: Math.round(r.top + r.height * 0.5), w: r.width, span: sim.minimap.span, craft: { x: sim.minimap._g.craft.x, z: sim.minimap._g.craft.z } };`);
  ok('“🗺 Teleport them” on the classmate’s row arms the next tap of the map for them', armed.armed && armed.armed.id === ids.mate && armed.w > 50, armed);
  await T2.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: armed.x, y: armed.y, button: 'left', clickCount: 1 });
  await T2.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: armed.x, y: armed.y, button: 'left', clickCount: 1 });
  await sleep(200);
  const picker = await T2.eval(`const el = document.querySelector('[data-owner-tp]'); const tap = TP.T.tap; return { open: !!el && !el.hidden, who: pt.text('[data-owner-tp] [data-tp-who]'), at: pt.text('[data-owner-tp] [data-tp-at]'), tap: tap && { x: Math.round(tap.x), z: Math.round(tap.z) }, taps: TP.stats.taps };`);
  const wantX = armed.craft.x + armed.span * 0.22;
  ok('a REAL click on the owner’s minimap opens the teleport picker for the classmate, at the place the map shows there', picker.open && picker.who === 'Brave Otter' && picker.tap && Math.abs(picker.tap.x - wantX) < armed.span * 0.02 && Math.abs(picker.tap.z - armed.craft.z) < armed.span * 0.02, { picker, wantX: Math.round(wantX) });
  await T2.shot('08-owner-teleport-picker-1366.png');
  const tTp = Date.now();
  await T2.eval(`const r = document.querySelector('[data-owner-tp] [data-tp-range]'); r.value = '12000'; r.dispatchEvent(new Event('input', { bubbles: true })); return pt.click('[data-owner-tp] [data-tp-go]');`);
  const mateTp = await T3.eval(`const r = await pt.until(() => Math.hypot(sim.aircraft.pos.x - ${picker.tap.x}, sim.aircraft.pos.z - ${picker.tap.z}) < 250 && Math.abs(sim.aircraft.pos.y / 0.3048 - 12000) < 600, 6000); return { ms: r.ms, ok: !!r.v, ft: Math.round(sim.aircraft.pos.y / 0.3048), speed: Math.round(sim.aircraft.airspeed), card: pt.SH.bigCardText(), crashed: sim.aircraft.crashed };`, 20);
  const hostSees = await T1.eval(`const r = await pt.until(() => { const q = mp.remotes.players.get(${ids.mate}); return q && q.drawn && Math.hypot(q.drawn.x - ${picker.tap.x}, q.drawn.z - ${picker.tap.z}) < 400 && q.drawn.y > 3000; }, 8000); const q = mp.remotes.players.get(${ids.mate}); return { ms: r.ms, ok: !!r.v, y: q && q.drawn ? Math.round(q.drawn.y) : null };`, 20);
  M.teleportThemMs = mateTp.ms;
  ok('Teleport (12,000 ft): the classmate’s copy puts them there, flying at a sane speed, and the host sees them there — synced', mateTp.ok && mateTp.speed > 50 && !mateTp.crashed && hostSees.ok, { mate: mateTp, host: hostSees });
  // The owner, 50,000 ft, on their own map.
  const own50 = await T2.eval(`
    const r = sim.minimap.canvas.getBoundingClientRect();
    TP.tapped({ x: sim.aircraft.pos.x + 2000, z: sim.aircraft.pos.z, craft: null, rect: r });
    TP.setFt(50000);
    const rr = document.querySelector('[data-owner-tp] [data-tp-range]');
    const out = pt.text('[data-owner-tp] [data-tp-out]');
    TP.go();
    await new Promise((f) => setTimeout(f, 2500));
    return { max: Number(rr.max), out, ft: Math.round(sim.aircraft.pos.y / 0.3048), speed: Math.round(sim.aircraft.airspeed), crashed: sim.aircraft.crashed, stalled: sim.aircraft.stalled, upY: pt.upY() };`, 20);
  await T2.shot('09-owner-50000ft-1366.png');
  const hostSees50 = await T1.eval(`const r = await pt.until(() => { const q = mp.remotes.players.get(${ids.owner}); return q && q.drawn && q.drawn.y > 14500; }, 8000); const q = mp.remotes.players.get(${ids.owner}); return { ms: r.ms, ok: !!r.v, ft: q && q.drawn ? Math.round(q.drawn.y / 0.3048) : null };`, 20);
  ok('the owner at 50,000 ft: the picker’s top is 50,000 ft; they arrive there at 150 m/s and are still flying 2.5 s later; the host sees them up there',
    own50.max === 50000 && /50,000 ft/.test(own50.out) && Math.abs(own50.ft - 50000) < 700 && own50.speed > 90 && !own50.crashed && !own50.stalled && own50.upY > 0.8 && hostSees50.ok, { own50, hostSees50 });

  /* ---- take over the host's aeroplane --------------------------------------------------- */
  await T2.eval('pt.airborne(0, 0, 90, 500); return true;');
  const spawned = await T1.eval(`pt.airborne(-200, 200, 90, 500); const r1 = pt.TR.spawnTraffic(sim, 'arrive'); const r2 = pt.TR.spawnTraffic(sim, 'depart'); await new Promise((f) => setTimeout(f, 800)); return { r1, r2, n: (sim.traffic || []).length, ids: (sim.traffic || []).map((e) => e.id + ':' + e.typeId) };`, 20);
  const mirrored = await T2.eval(`const r = await pt.until(() => pt.MW.mirrorTraffic().size >= 1, 12000); TP.sync(); return { ms: r.ms, n: pt.MW.mirrorTraffic().size, tools: !!(TP.tools() && !TP.tools().hidden), text: pt.text('[data-owner-tools]') };`, 30);
  ok('the host runs two AI aeroplanes; the owner’s copy mirrors them and the ✈ Take over button by the chip counts them', spawned.n >= 1 && mirrored.n >= 1 && mirrored.tools && /\(\d+\)/.test(mirrored.text || ''), { spawned: spawned.ids, mirrored });
  const listed = await T2.eval(`pt.click('[data-owner-take-list]'); const rows = [...document.querySelectorAll('[data-owner-take] [data-take]')].map((b) => ({ take: b.dataset.take, text: b.textContent.replace(/\\s+/g, ' ').trim() })); return rows;`);
  await T2.shot('10-owner-take-over-list-1366.png');
  const pick = listed.find((r) => r.take.startsWith('mirror:'));
  const typeOf = pick ? spawned.ids.find((s) => s.startsWith(`traffic-${pick.take.split(':')[1]}:`)) : null;
  const wantType = typeOf ? typeOf.split(':')[1] : null;
  const tTake = Date.now();
  const took = await T2.eval(`const b = document.querySelector('[data-owner-take] [data-take="${pick ? pick.take : ''}"]'); if (b) b.click(); const r = await pt.until(() => sim.aircraftType.id === ${JSON.stringify(wantType)}, 6000); return { ms: r.ms, ok: !!r.v, type: sim.aircraftType.id, taken: TP.stats.taken, card: pt.SH.bigCardText() };`, 20);
  const hostLost = await T1.eval(`const r = await pt.until(() => !(sim.traffic || []).some((e) => e.id === 'traffic-${pick ? pick.take.split(':')[1] : -1}'), 6000); const q = mp.remotes.players.get(${ids.owner}); const r2 = await pt.until(() => { const q = mp.remotes.players.get(${ids.owner}); return q && q.sample && q.sample.snap && q.sample.snap.type === ${JSON.stringify(wantType)}; }, 8000); return { goneMs: r.ms, gone: !!r.v, seesMs: r2.ms, sees: !!r2.v, type: q && q.sample && q.sample.snap ? q.sample.snap.type : null, n: (sim.traffic || []).length };`, 30);
  const mateSees = await T3.eval(`const r = await pt.until(() => { const q = mp.remotes.players.get(${ids.owner}); return q && q.sample && q.sample.snap && q.sample.snap.type === ${JSON.stringify(wantType)}; }, 8000); return { ms: r.ms, ok: !!r.v };`, 20);
  M.takeOverMs = { owner: took.ms, hostLost: hostLost.goneMs, seen: hostLost.seesMs };
  ok('Take over: the owner picks the host’s aeroplane from the list and is in its seat (its type); the host’s traffic has lost it (brain off, route forgotten), and the host and the classmate see the owner flying that type',
    !!pick && took.ok && took.taken >= 1 && hostLost.gone && hostLost.sees && mateSees.ok && hostLost.n === spawned.n - 1, { pick, wantType, took, hostLost, mateSees });

  /* ---- an iPad: the troll row and the picker on a touch screen ------------------------------ */
  await T2.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 2, mobile: true });
  await T2.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await T2.eval(`document.documentElement.classList.add('is-touch-device'); window.dispatchEvent(new Event('resize')); pt.click('[data-owner-take] [data-take-x]'); mp.hud.hold(true); mp.syncRoster(); if (TD.menu.open !== ${ids.mate}) pt.click('[data-mp-list] [data-mp-own-open="${ids.mate}"]'); return true;`);
  await sleep(700);
  const ipadRow = await T2.eval(`
    const row = document.querySelector('[data-mp-list] [data-mp-ownrow="${ids.mate}"]');
    const list = document.querySelector('[data-mp-list]');
    const lr = list.getBoundingClientRect();
    const btns = row ? [...row.querySelectorAll('button')].map((b) => b.getBoundingClientRect()) : [];
    return { row: !!row, inside: lr.right <= window.innerWidth + 1 && lr.left >= -1, buttons: btns.length, minH: btns.length ? Math.min(...btns.map((b) => b.height)) : 0, listW: Math.round(lr.width), scroll: list.scrollHeight > list.clientHeight };`);
  await T2.shot('11-ipad-owner-troll-row-1024.png');
  await T2.eval(`mp.hud.hold(false); const r = sim.minimap.canvas.getBoundingClientRect(); TP.tapped({ x: sim.aircraft.pos.x + 1000, z: sim.aircraft.pos.z, craft: null, rect: r }); return true;`);
  await sleep(300);
  const ipadPicker = await T2.eval(`const el = document.querySelector('[data-owner-tp]'); const r = el.getBoundingClientRect(); const btns = [...el.querySelectorAll('button')].filter((b) => !b.hidden).map((b) => b.getBoundingClientRect().height); return { open: !el.hidden, inside: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight, minH: Math.min(...btns) };`);
  await T2.shot('12-ipad-owner-teleport-picker-1024.png');
  await T2.eval('TP.closePicker(); return true;');
  await T2.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await T2.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  ok('on an iPad (1024x768, a touch screen) the troll row fits inside the list on the screen with finger-sized buttons, and the picker sits inside the screen', ipadRow.row && ipadRow.inside && ipadRow.buttons >= 15 && ipadRow.minH >= 26 && ipadPicker.open && ipadPicker.inside && ipadPicker.minH >= 26, { ipadRow, ipadPicker });

  const errs = await Promise.all(pages.map((p) => p.eval('return pt.err;')));
  const exceptions = pages.flatMap((p) => p.logs.filter((l) => /exception/.test(l)));
  ok('no exceptions in any tab', errs.every((e) => !e) && exceptions.length === 0, [...errs.filter(Boolean), ...exceptions].slice(0, 3).join(' | '));
  M.cooldownWaits = cool.waits;
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
