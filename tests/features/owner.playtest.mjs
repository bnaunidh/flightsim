/**
 * The owner playtest: the fan on the main page, the code box, the hour, and
 * the owner in a lobby — in real tabs of ONE headless Chrome, over
 * tools/lan-server.py --local.
 *
 *   node tests/features/owner.playtest.mjs
 *     --url=http://127.0.0.1:9221/   a LAN server already serving the game (else one is started on a free port)
 *     --json=<file>                  write the numbers there too
 *
 * The owner's code is in no file: every tab accepts the TEST owner key
 * (.claude/devtools/admin-keys/test-owner.json, read when this runs, added
 * with owner.js addOwnerKey), and one tab types the TEST code into the box.
 * Measured, not looked at:
 *
 *   - the fan, with real input (CDP Input events, not synthetic DOM events):
 *     nine clicks open nothing, ten open the box; the same by touch; and by
 *     Enter on the focused fan. Nothing in the page before that;
 *   - the box: a wrong code is "Not that one", three a minute; the test code
 *     makes this device the owner — the chip, Dev mode, and what is kept is
 *     the pass, never the code;
 *   - Lobby 2: the owner's lobby screen has the owner box; in the lobby the
 *     host checks the pass, everybody sees the gold OWNER badge (tag and
 *     list), the owner has the admin menu; a TAMPERED client (an edited pass,
 *     a forged signature, "I am the owner" on its own screen) gets nothing;
 *   - the owner's powers through the real player list: mute, freeze, kick;
 *   - the hour runs out on the owner's device mid-lobby: the chip goes, the
 *     pass is wiped, Dev mode goes back, and the host takes the powers and
 *     the badge away for everybody at once;
 *   - an hour the host's clock says is over (the owner's device says not):
 *     the host takes the powers and the badge away by itself;
 *   - a COPIED or EDITED flag, on a tab on the other name for this computer
 *     (its own localStorage), pasted in before the game starts: not the
 *     owner, wiped; it hosts a lobby with no badge and no powers.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { findOwnerTestKey } from './multiplayer.owner.mjs';
import { ownerKeys } from '../../src/features/multiplayer/owner.js';

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
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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
  const dir = mkdtempSync(join(tmpdir(), 'ifs-owner-chrome-'));
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

async function openPage(url, name, timeoutS = 240, preload = null) {
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
  if (preload) await send('Page.addScriptToEvaluateOnNewDocument', { source: preload });
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
    eval: (body, secs = timeoutS) => raw(`(async () => { const sim = window.__sim; const pt = window.__pt; const mp = pt && pt.mp; const own = pt && pt.own; ${body}\n})()`, secs * 1000),
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
  const pt = (window.__pt = { THREE, mpMod, O, Prog, mp: mpMod.multiplayer, own: O.owner, ticks: 0, toasts: [], taps: [] });
  s.renderer.render = () => {};
  if (s.hud && s.hud.notify) {
    const n = s.hud.notify.bind(s.hud);
    s.hud.notify = (html, kind, secs) => { pt.toasts.push(String(html).replace(/<[^>]+>/g, '')); return n(html, kind, secs); };
  }
  let last = performance.now();
  pt.timer = setInterval(() => {
    const t = performance.now();
    const dt = Math.min(0.25, (t - last) / 1000);
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
  // What really reached the fan: one entry per pointerdown / keydown, with its kind — to tell real taps from synthetic ones.
  const fan = document.querySelector('[data-fan]');
  if (fan) {
    fan.addEventListener('pointerdown', (e) => pt.taps.push(e.pointerType + (e.isTrusted ? '' : ':synthetic')), true);
    fan.addEventListener('keydown', (e) => pt.taps.push('key:' + e.key + (e.isTrusted ? '' : ':synthetic')), true);
  }
  pt.sig = [];
  const wsSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try { const m = JSON.parse(d); if (m.type !== 'HEARTBEAT') pt.sig.push({ type: m.type, named: /"prove"|"unown"|"chal"|"adm"/.test(String(d)) }); } catch (e) { /* not ours */ }
    return wsSend.call(this, d);
  };
}
window.__pt.mp.setProfile({ name: ${JSON.stringify(name)}, colour: ${JSON.stringify(colour)}, chosen: true });
// Each tab its own browser key, as on its own device (tabs of one origin share the saved profile, and a kick bans by key).
window.__pt.mp.profile.key = ('k' + Math.random().toString(36).slice(2) + '0000000000000000000').slice(0, 20);
return { state: sim.state, name: window.__pt.mp.profile.name, fan: !!document.querySelector('[data-fan]') };`;

const NAMES = ['Kind Koala', 'Swift Falcon', 'Brave Otter', 'Sunny Puffin'];
const COLOURS = ['#ff5a4f', '#ff9f1c', '#ffd23f', '#4fd684'];
const FAKER = 'Keen Kestrel';
const TK = findOwnerTestKey();
if (!TK) {
  console.error('the owner playtest needs .claude/devtools/admin-keys/test-owner.json (the test owner key) — not found');
  process.exit(2);
}
const TESTKEY = JSON.stringify({ x: TK.x, y: TK.y });

const STATE = `
  const s = mp.session;
  return {
    role: mp.role, n: mp.lobby && mp.lobby.n, ready: mp.ready, name: mp.profile.name, state: sim.state,
    id: mp.meId, me: mp.me, owner: own.active, chip: pt.text('[data-owner-chip]'), dev: pt.Prog.isDev(sim.menus.prog),
    count: s ? (mp.role === 'host' ? s.count : s.players.size + 1) : 0,
    remotes: [...mp.remotes.players.values()].map((p) => ({ id: p.id, name: p.name, host: !!p.host, admin: !!p.admin, owner: !!p.owner, tag: p.tag ? p.tag.key : null })),
  };`;

const url = await serve();
log(`serving ${url}`);
const pages = [];
let exitCode = 1;
try {
  // --gesture-only: the owner's tab alone, the fan and the box, and stop there (a quick run while working on them).
  const only = arg('gesture-only');
  for (let i = 0; i < NAMES.length; i++) {
    if (only && i !== 1) { pages.push(null); continue; }
    const p = await openPage(`${url}?dev=1`, `tab${i + 1}`);
    const r = await p.eval(PAGE(NAMES[i], COLOURS[i]), 120);
    // The test owner key, as an owner key this copy accepts — as the owner's is in every copy. Never the owner's code.
    const keys = await p.eval(`pt.O.addOwnerKey(${TESTKEY}); return pt.O.ownerKeys().length;`, 30);
    pages.push(p);
    log(`tab${i + 1} up as ${r.name} (${r.state}); fan ${r.fan}; ${keys} owner keys`);
  }
  const [T1, T2, T3, T4] = pages;
  const st = (p) => p.eval(STATE, 30);

  /* ---- the fan, with real input --------------------------------------------- */
  // The owner's tab in front, as a child's is: a tab behind others draws no frames, and a touch waits for one.
  await T2.send('Page.bringToFront');
  await T2.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  // Dev mode off to start with, so the hour can be seen to open it and to put it back.
  await T2.eval(`sim.menus.show('main'); const p = sim.menus.prog; p.devUnlocked = false; pt.Prog.save(p); sim.menus.syncProgression(p); pt.O.clearTries(); return true;`);
  const fanAt = await T2.eval(`
    const r = document.querySelector('[data-fan]').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), tab: document.querySelector('[data-fan]').tabIndex,
      boxBefore: !!document.querySelector('[data-owner-box]'), chipBefore: !!document.querySelector('[data-owner-chip]'), hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === document.querySelector('[data-fan]') || document.querySelector('[data-fan]').contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };`);
  ok('the main page: the fan is there and can be focused, and nothing else is — no box, no chip, no counter', fanAt.w > 20 && fanAt.tab === 0 && !fanAt.boxBefore && !fanAt.chipBefore && fanAt.hit, fanAt);
  const box = () => T2.eval(`return { box: !!document.querySelector('[data-owner-box]'), focused: document.activeElement && document.activeElement.matches('[data-owner-code]'), taps: pt.taps.slice() };`);
  const closeBox = () => T2.eval(`window.__owner.closeBox(); pt.taps.length = 0; return !document.querySelector('[data-owner-box]');`);
  const click = async (n) => {
    for (let i = 0; i < n; i++) {
      await T2.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fanAt.x, y: fanAt.y, button: 'left', clickCount: 1 });
      await T2.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fanAt.x, y: fanAt.y, button: 'left', clickCount: 1 });
      await sleep(60);
    }
  };
  const within = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(`${what}: no answer in ${ms} ms`); })]);
  const touch = async (n, at = fanAt) => {
    for (let i = 0; i < n; i++) {
      await within(T2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] }), 8000, 'touchStart');
      await within(T2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }), 8000, 'touchEnd');
      await sleep(60);
    }
  };
  const quiet = () => sleep(5300); // longer than the fan's window: the next presses start from nothing
  await click(9);
  const m9 = await box();
  await quiet();
  await click(10);
  const m10 = await box();
  ok('mouse: nine clicks on the fan open nothing; ten open the code box, with the cursor in it',
    !m9.box && m9.taps.length === 9 && m9.taps.every((t) => t === 'mouse') && m10.box && m10.focused, `${m9.taps.length} then ${m10.taps.length} real mouse presses`);
  await closeBox();
  await quiet();
  // A touch screen, as a phone or a tablet is, for the taps: without it headless Chrome holds a touch event and never answers (and with it, ignores the mouse).
  await T2.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  /*
   * A touch screen is a coarse pointer too, and the menus lay themselves out
   * for one (styles/main.css, `(pointer: coarse)`: bigger targets, other
   * padding) — so the fan is not where the mouse found it. Measured again,
   * where it is now; the taps before this went to empty page (v50).
   */
  const fanTouch = await T2.eval(`
    await new Promise((r) => setTimeout(r, 200));
    const r = document.querySelector('[data-fan]').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };`);
  await touch(9, fanTouch);
  const t9 = await box();
  await quiet();
  await touch(10, fanTouch);
  const t10 = await box();
  await T2.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  ok('touch: nine taps open nothing; ten open the box', !t9.box && t9.taps.length === 9 && t9.taps.every((t) => t === 'touch') && t10.box,
    `${t9.taps.length} then ${t10.taps.length} real taps; the fan moved ${fanTouch.x - fanAt.x},${fanTouch.y - fanAt.y}px for the coarse pointer`);
  await closeBox();
  await quiet();
  await T2.eval(`document.querySelector('[data-fan]').focus(); return document.activeElement === document.querySelector('[data-fan]');`);
  const key = async (n) => {
    for (let i = 0; i < n; i++) {
      await T2.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await T2.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await sleep(40);
    }
  };
  await key(9);
  const k9 = await box();
  await quiet();
  await key(10);
  const k10 = await box();
  ok('keyboard: Enter on the focused fan — nine do nothing, ten open the box', !k9.box && k9.taps.length === 9 && k10.box && k10.focused, `${k9.taps.length} then ${k10.taps.length} Enter presses`);
  // Slow taps never open it: ten, a second apart, each window holding fewer than ten.
  await closeBox();
  await quiet();
  const slow = await T2.eval(`
    let opened = false;
    for (let i = 0; i < 12; i++) { opened = window.__owner.tap(performance.now() + i * 1000) || opened; }
    return { opened, box: !!document.querySelector('[data-owner-box]') };`);
  ok('ten taps spread over more than a few seconds open nothing', !slow.opened && !slow.box);
  await T2.eval(`window.__owner.taps = []; return true;`);

  /* ---- the box: wrong codes, then the test code ----------------------------- */
  await click(10);
  const typeIn = async (text) => {
    await T2.eval(`document.querySelector('[data-owner-code]').focus(); return true;`);
    await T2.send('Input.insertText', { text });
    await T2.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await T2.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(150);
    return T2.eval(`return { box: !!document.querySelector('[data-owner-box]'), msg: pt.text('[data-owner-msg]'), value: (document.querySelector('[data-owner-code]') || {}).value || '', type: (document.querySelector('[data-owner-code]') || {}).type, owner: pt.own.active };`);
  };
  const w1 = await typeIn(`${TK.code.slice(0, -2)}zz`);
  const w2 = await typeIn('hello');
  ok('a wrong code: “Not that one”, the box stays (a password box, emptied), nobody is the owner',
    w1.box && w1.msg === 'Not that one' && w2.msg === 'Not that one' && w1.value === '' && w1.type === 'password' && !w1.owner, `${w1.msg} / ${w2.msg}`);
  const w3 = await typeIn('nope');
  const w4 = await typeIn(TK.code);
  ok('a few tries a minute: after three wrong ones even the right code is told to wait', w3.msg === 'Not that one' && !w4.owner && /wait a minute/.test(w4.msg), w4.msg);
  // A minute later (the tries are kept as times; this moves them back rather than waiting).
  await T2.eval(`const k = 'islandsim.owner.tries.v1'; const old = JSON.parse(localStorage.getItem(k) || '[]').map((t) => t - 61000); localStorage.setItem(k, JSON.stringify(old)); pt.O.clearTries(); localStorage.setItem(k, JSON.stringify(old)); return true;`);
  const tCode = Date.now();
  const right = await typeIn(TK.code);
  const after = await T2.eval(`
    const kept = localStorage.getItem('islandsim.owner.v1') || '';
    sim.menus.show('hangar');
    const devPanel = !document.querySelector('[data-screen="hangar"] [data-dev-panel]').hidden;
    sim.menus.show('main');
    return { kept: Object.keys(JSON.parse(kept || '{}')).sort().join(','), hasCode: kept.toLowerCase().includes(${JSON.stringify(TK.code.toLowerCase())}), chip: pt.text('[data-owner-chip]'),
      dev: pt.Prog.isDev(sim.menus.prog), devPanel, until: pt.own.until, tries: localStorage.getItem('islandsim.owner.tries.v1') };`);
  ok('the test code: the box shuts, this device is the owner until an hour from now, with the chip “OWNER · 60 min”',
    right.owner && !right.box && after.chip === 'OWNER · 60 min' && Math.abs(after.until - (tCode + 3600e3)) < 5000, `${after.chip}; until +${((after.until - tCode) / 60000).toFixed(1)} min`);
  ok('Dev mode is open for the hour (the Hangar’s workbench shows)', after.dev && after.devPanel);
  ok('what the device keeps is the pass and its own key — never the code; the wrong tries are forgotten',
    after.kept === 'c,dev,exp,iat,on,ox,oy,sd,sx,sy' && !after.hasCode && after.tries === null, after.kept);
  M.codeMs = Date.now() - tCode;
  if (only) throw Object.assign(new Error('gesture-only: stopping here'), { stop: true });

  /* ---- Lobby 2 -------------------------------------------------------------------- */
  const opened = await Promise.all(pages.map((p) => p.eval(`
    pt.mpMod.openMultiplayer(sim);
    const r = await pt.until(() => document.querySelectorAll('.mp-lobby.is-empty, .mp-lobby.is-open, .mp-lobby.is-full').length >= 5, 30000);
    const box = document.querySelector('[data-mp-adminbox]');
    return { ms: r.ms, box: !box.hidden, head: pt.text('[data-mp-adminhead]'), end: !document.querySelector('[data-mp-owner-end]').hidden, off: !document.querySelector('[data-mp-admin-off]').hidden };`, 60)));
  ok('the lobby screen: only the owner’s has the owner box — “Owner”, the private matches, and End owner now',
    opened.map((o) => o.box).join(',') === 'false,true,false,false' && /^Owner OWNER$/.test(opened[1].head) && opened[1].end && !opened[1].off, JSON.stringify(opened[1]));
  // The tampered client: says it is the owner with the real pass's public parts, an edited hour, and its own signature.
  await T4.eval(`
    const real = JSON.parse(localStorage.getItem('islandsim.owner.v1'));
    const mine = pt.O.OwnerPass.fromCode('not the code at all') || null;
    const { sign } = await import('/src/features/multiplayer/p256.js');
    const A = await import('/src/features/multiplayer/admin.js');
    const d = new Uint8Array(32); crypto.getRandomValues(d); d[0] = 0x11;
    pt.forged = { exp: real.exp + 3600e3, answer: async (text) => ({ o: A.b64url(sign(d, new TextEncoder().encode(text))), c: { ox: real.ox, oy: real.oy, sx: real.sx, sy: real.sy, iat: real.iat, exp: real.exp + 3600e3, c: real.c } }) };
    mp.ownerNow = () => pt.forged;
    return !!mine;`);
  const join = (p, n) => p.eval(`
    const t0 = performance.now();
    // Whatever the screen said before (“You left Lobby 2”) is not the answer to this join.
    const said = document.querySelector('[data-mp-status]');
    if (said) said.textContent = '';
    pt.click('[data-mp-lobby-join="${n}"]');
    const r = await pt.until(() => (mp.ready && mp.lobby && sim.state === 'flying') || (!mp.busy && !mp.lobby && document.querySelector('[data-mp-status]').textContent), 60000);
    return { ms: Math.round(performance.now() - t0), role: mp.role, status: pt.text('[data-mp-status]') };`, 90);
  const joins = [];
  for (const p of [T1, T4, T2, T3]) joins.push(await join(p, 2));
  ok('four into Lobby 2: its first player hosts, three join (the owner, a tampered client, a classmate)', joins[0].role === 'host' && joins.slice(1).every((j) => j.role === 'client'), joins.map((j) => `${j.role} ${j.ms} ms`).join(', '));
  await Promise.all([T1, T2, T3, T4].map((p) => p.eval('const r = await pt.until(() => mp.remotes.players.size === 3 && [...mp.remotes.players.values()].every((q) => q.tag && q.tag.key), 20000); mp.syncRoster(); return !!r.v;', 40)));
  let s1 = await st(T1);
  const ids = Object.fromEntries(s1.remotes.map((r) => [r.name, r.id]));
  const listOf = (p) => p.eval(`
    mp.syncRoster();
    const rows = [...document.querySelectorAll('[data-mp-list] .mp-prow')].map((r) => ({ text: r.textContent.replace(/\\s+/g, ' ').trim(), owner: !!r.querySelector('.mp-ownertag'), admin: !!r.querySelector('.mp-admintag:not(.mp-ownertag)'), menu: !!r.querySelector('[data-mp-adm-open]') }));
    return { rows, close: pt.text('[data-mp-list] [data-mp-admrow="close"]'), badge: pt.text('.mp-badge') };`, 20);
  const [s2, s3, s4] = await Promise.all([T2, T3, T4].map(st));
  const lists = await Promise.all([T1, T2, T3, T4].map(listOf));
  const oid = ids['Swift Falcon'];
  const seenOwner = [s1, s3, s4].every((s) => { const r = s.remotes.find((q) => q.id === oid); return r && r.owner && /o$/.test(r.tag); })
    && lists.every((l) => l.rows.filter((r) => r.owner).length === 1 && l.rows.find((r) => r.owner).text.includes('Swift Falcon') && !l.rows.some((r) => r.admin));
  ok('the host checked the pass: everybody sees the gold OWNER badge on the owner — on their tag and in every list — and on nobody else',
    seenOwner && s2.me.owner && s2.me.admin, lists[2].rows.map((r) => r.text).join(' | '));
  ok('the owner’s list has the admin menu for the other three and “OWNER · Close server for everybody”; nobody else’s has any of it',
    lists[1].rows.filter((r) => r.menu).length === 3 && /^OWNER\s*Close server for everybody$/.test(lists[1].close || '') && lists.filter((l, i) => i !== 1).every((l) => !l.close && !l.rows.some((r) => r.menu)) && /OWNER/.test(lists[1].badge),
    `${lists[1].close}; ${lists[1].badge}`);
  ok('the tampered client (the real pass with its hour pushed on, signed by a key of its own) is not the owner — the host checked, and said no',
    !s4.me.owner && !s4.me.admin && !lists[3].close, JSON.stringify(s4.me));
  // It asks for owner things anyway, every way it can.
  const t3 = ids['Brave Otter'];
  await T4.eval(`
    const c = mp.client;
    for (const op of ['kick', 'mute', 'freeze', 'close']) c.link.send({ t: 'adm', op, id: ${t3} });
    const a = await pt.forged.answer('x');
    c.link.send({ t: 'prove', s: '', o: a.o, c: a.c });
    mp.me = { ...mp.me, admin: true, owner: true };
    mp.adminAct('kick', ${t3});
    mp.adminAct('close', -1);
    return true;`);
  await sleep(1500);
  const after4 = await T1.eval(`const p = mp.host.players.get(${t3}); return { in: !!p, muted: !!(p && p.muted), frozen: !!(p && p.frozenUntil), closed: mp.host.closed, count: mp.host.count, t4: mp.host.hasPowers(mp.host.players.get(${ids['Sunny Puffin']})) };`);
  ok('…and gets nothing: nobody kicked, muted or frozen, the lobby not closed', after4.in && !after4.muted && !after4.frozen && !after4.closed && after4.count === 4 && !after4.t4, after4);
  await T4.eval('mp.syncSelf(); return true;');

  /* The owner's menu, clicked as a child would, each with its "are you sure". */
  const ownerDo = (op, id, secs = 30) => T2.eval(`
    mp.hud.hold(true);
    mp.syncRoster();
    const L = '[data-mp-list] ';
    if (${JSON.stringify(op)} !== 'close') pt.click(L + '[data-mp-adm-open="${id}"]');
    pt.click(L + '[data-mp-adm="${op}:${id}"]');
    const sure = pt.text(L + '.mp-sure');
    pt.click(L + '[data-mp-adm-yes]');
    mp.hud.hold(false);
    return { sure };`, secs);
  const mute = await ownerDo('mute', t3);
  const muted = await T3.eval(`const r = await pt.until(() => mp.me.muted, 10000); return { ms: r.ms, muted: mp.me.muted };`, 20);
  await ownerDo('unmute', t3);
  const unmuted = await T3.eval(`const r = await pt.until(() => !mp.me.muted, 10000); return !!r.v;`, 20);
  ok('the owner’s powers — mute: “Mute Brave Otter’s chat for everybody?” → Yes; muted, and unmuted again', /Mute Brave Otter’s chat for everybody\?/.test(mute.sure) && muted.muted && unmuted, `${muted.ms} ms`);
  await ownerDo('freeze', t3);
  const frozen = await T3.eval(`const r = await pt.until(() => mp.me.frozen, 10000); return { ms: r.ms, frozen: mp.me.frozen };`, 20);
  await ownerDo('unfreeze', t3);
  const thawed = await T3.eval(`const r = await pt.until(() => !mp.me.frozen, 10000); return !!r.v;`, 20);
  ok('…freeze, and unfreeze', frozen.frozen && thawed, `${frozen.ms} ms`);
  const kick = await ownerDo('kick', ids['Sunny Puffin']);
  const kicked = await T4.eval(`const r = await pt.until(() => !mp.lobby && !mp.role, 10000); return { ms: r.ms, told: pt.toasts.slice(-3) };`, 20);
  s1 = await st(T1);
  ok('…kick: the tampered client is taken out, told kindly', /Take Sunny Puffin out of this game\?/.test(kick.sure) && kicked.ms < 10000 && s1.count === 3, `${kicked.ms} ms`);

  /* The hour runs out on the owner's device, mid-lobby. */
  const tEnd = Date.now();
  await T2.eval(`pt.own.now = () => Date.now() + 3600e3; return true;`);
  const ended = await T2.eval(`
    const r = await pt.until(() => !pt.own.active && !document.querySelector('[data-owner-chip]') && !mp.me.owner, 10000);
    mp.syncRoster();
    return { ms: r.ms, kept: localStorage.getItem('islandsim.owner.v1'), dev: pt.Prog.isDev(sim.menus.prog), me: mp.me, close: pt.text('[data-mp-list] [data-mp-admrow="close"]'), menus: document.querySelectorAll('[data-mp-list] [data-mp-adm-open]').length, told: pt.toasts.slice(-2) };`, 20);
  await T2.eval(`pt.own.now = () => Date.now(); return true;`);
  const seen3 = await T3.eval(`const r = await pt.until(() => { const q = mp.remotes.players.get(${oid}); return q && !q.owner && !q.admin && q.tag && !/o$/.test(q.tag.key); }, 10000); mp.syncRoster(); return { ms: r.ms, row: [...document.querySelectorAll('[data-mp-list] .mp-prow')].map((x) => x.textContent).find((t) => /Swift Falcon/.test(t)), tag: mp.remotes.players.get(${oid}).tag.key };`, 20);
  const hostSees = await T1.eval(`return { owner: mp.host.isOwner(mp.host.players.get(${oid})), powers: mp.host.hasPowers(mp.host.players.get(${oid})) };`);
  ok('the hour runs out on the owner’s device mid-lobby: the chip goes, the pass is wiped, Dev mode goes back to off — and the menu with it',
    ended.kept === null && !ended.dev && !ended.me.owner && !ended.me.admin && !ended.close && ended.menus === 0 && ended.told.some((t) => /owner hour is over/.test(t)), `${ended.ms} ms`);
  ok('…and the host is told: no powers, and the OWNER badge is gone for everybody, on the tag and in the list',
    !hostSees.owner && !hostSees.powers && !/OWNER/.test(seen3.row || 'OWNER') && !/o$/.test(seen3.tag), `${seen3.ms} ms after; “${seen3.row}”; ${JSON.stringify(hostSees)}; tag ${seen3.tag}`);
  await T2.eval(`mp.client.link.send({ t: 'adm', op: 'mute', id: ${t3} }); return true;`);
  await sleep(600);
  const notMuted = await T1.eval(`return !mp.host.players.get(${t3}).muted;`);
  ok('…and what it asks for now, the host does none of', notMuted);
  M.expiryMs = { device: ended.ms, everybody: seen3.ms, total: Date.now() - tEnd };

  /* An hour the HOST's clock says is over, while the owner's device says not. */
  const code2 = await T2.eval(`mp.leave('left'); await new Promise((r) => setTimeout(r, 300)); const r = pt.own.tryCode(${JSON.stringify(TK.code)}, pt.Prog.isDev(sim.menus.prog)); return { ok: r.ok, why: r.why || null, active: pt.own.active, role: mp.role, lobby: !!mp.lobby, state: sim.state };`);
  await T2.eval(`pt.mpMod.openMultiplayer(sim); await pt.until(() => document.querySelectorAll('.mp-lobby.is-open').length >= 1, 20000); return true;`);
  const rejoin = await join(T2, 2);
  const again = await T3.eval(`const r = await pt.until(() => [...mp.remotes.players.values()].some((q) => q.name === 'Swift Falcon' && q.owner), 15000); return { ms: r.ms, ok: !!r.v };`, 30);
  ok('the code again, and back into Lobby 2: the owner again — checked again by the host', rejoin.role === 'client' && again.ok, `${JSON.stringify(rejoin)}; seen ${JSON.stringify(again)}; ${JSON.stringify(code2)}`);
  const oid2 = await T2.eval('return mp.meId;');
  await T1.eval(`mp.host.wall = () => Date.now() + 3600e3 + 5000; return true;`);
  const hostClock = await T3.eval(`const r = await pt.until(() => { const q = mp.remotes.players.get(${oid2}); return q && !q.owner && !q.admin; }, 10000); return { ms: r.ms, ok: !!r.v };`, 20);
  const device = await T2.eval(`const r = await pt.until(() => !mp.me.owner && !mp.me.admin, 10000); return { ms: r.ms, stillOwnerHere: pt.own.active };`, 20);
  ok('an hour the host’s clock says is over (the owner’s device says not): the host takes the badge and the powers away by itself',
    hostClock.ok && device.stillOwnerHere && device.ms < 10000, `${hostClock.ms} ms`);
  await T1.eval(`mp.host.wall = () => Date.now(); return true;`);
  await T2.eval(`pt.own.end('ended'); return true;`);

  /*
   * A COPIED or EDITED flag, on the other name for this computer (its own
   * localStorage), pasted in before the game starts: the owner's real pass
   * from this browser with its hour pushed on, and the shipped owner's
   * public x and y with a made-up key.
   */
  const realPass = await T3.eval(`return localStorage.getItem('islandsim.owner.v1');`); // ended above: gone
  const shipped = ownerKeys()[0];
  const madeUp = { on: 1, ox: shipped.x, oy: shipped.y, sx: shipped.x, sy: shipped.y, iat: Date.now(), exp: Date.now() + 1800e3, c: 'A'.repeat(86), sd: b64u(randomBytes(32)), dev: 1 };
  const other = new URL(url);
  other.hostname = other.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  const T5 = await openPage(`${other.href}?dev=1`, 'tab5', 240,
    `try { localStorage.setItem('islandsim.owner.v1', ${JSON.stringify(JSON.stringify(madeUp))}); window.__planted = localStorage.getItem('islandsim.owner.v1'); } catch (e) { window.__planted = null; }`);
  await T5.eval(PAGE(FAKER, '#9b5de5'), 120);
  pages.push(T5);
  const f0 = await T5.eval(`return { planted: !!window.__planted, origin: location.origin, owner: pt.own.active, kept: localStorage.getItem('islandsim.owner.v1'), chip: !!document.querySelector('[data-owner-chip]'), dev: pt.Prog.isDev(sim.menus.prog) };`, 20);
  ok('a made-up flag — the shipped owner’s public x and y with a made-up key — pasted in before the game starts: not the owner, wiped, no chip, no Dev mode',
    realPass === null && f0.planted && f0.origin !== new URL(url).origin && !f0.owner && f0.kept === null && !f0.chip && !f0.dev, f0.origin);
  // An edited real pass (made here with the test code, its hour pushed on), and a run-out one: wiped at load.
  const edited = await T5.eval(`
    pt.O.addOwnerKey(${TESTKEY});
    const p = pt.O.OwnerPass.fromCode(${JSON.stringify(TK.code)});
    p.save();
    const good = JSON.parse(localStorage.getItem('islandsim.owner.v1'));
    p.wipe();
    const out = {};
    localStorage.setItem('islandsim.owner.v1', JSON.stringify({ ...good, exp: good.exp + 3600e3 }));
    out.edited = pt.own.load();
    out.editedKept = localStorage.getItem('islandsim.owner.v1');
    const old = pt.O.OwnerPass.fromCode(${JSON.stringify(TK.code)}, { now: Date.now() - 3600e3 - 60e3 });
    old.save();
    out.expired = pt.own.load();
    out.expiredKept = localStorage.getItem('islandsim.owner.v1');
    return { edited: { pass: !!out.edited.pass, dropped: !!out.edited.dropped, kept: out.editedKept }, expired: { pass: !!out.expired.pass, ended: !!out.expired.ended, kept: out.expiredKept }, owner: pt.own.active };`, 30);
  ok('…and a real pass with its hour pushed on, or one whose hour is over: not the owner either, and wiped when the game reads them',
    !edited.edited.pass && edited.edited.dropped && edited.edited.kept === null && !edited.expired.pass && edited.expired.ended && edited.expired.kept === null && !edited.owner, edited);
  // It reaches an empty lobby first and hosts it, with a classmate: no badge and no powers.
  const lobbyUp = (p) => p.eval(`
    if (mp.lobby || mp.role) mp.leave('left');
    pt.mpMod.openMultiplayer(sim);
    const r = await pt.until(() => document.querySelectorAll('.mp-lobby.is-empty, .mp-lobby.is-open, .mp-lobby.is-full').length >= 5 && !mp.busy, 30000);
    return { ok: !!r.v, box: !document.querySelector('[data-mp-adminbox]').hidden };`, 60);
  const up5 = await lobbyUp(T5);
  const fj = [await join(T5, 4)];
  await lobbyUp(T3);
  fj.push(await join(T3, 4));
  await Promise.all([T5, T3].map((p) => p.eval('const r = await pt.until(() => mp.remotes.players.size === 1 && [...mp.remotes.players.values()].every((q) => q.tag && q.tag.key), 20000); mp.syncRoster(); return !!r.v;', 40)));
  const [f5, f3] = await Promise.all([T5, T3].map(st));
  const tries5 = await T5.eval(`
    const ids = [...mp.host.players.keys()];
    return { hostOwner: mp.host.isOwner(mp.host.me), mute: mp.adminAct('mute', ids[0]), kick: mp.host.adminAct('kick', ids[0]), close: mp.host.adminClose() };`, 20);
  await sleep(800);
  const g3 = await st(T3);
  ok('…it hosts Lobby 4 with a classmate: the crown, but no OWNER badge anywhere, no owner box, and no powers',
    up5.ok && !up5.box && fj[0].role === 'host' && fj[1].role === 'client' && !f5.me.owner && f3.remotes.every((r) => !r.owner && !r.admin) && !tries5.hostOwner
    && [tries5.mute, tries5.kick, tries5.close].every((v) => v === false) && g3.role === 'client' && !g3.me.muted, JSON.stringify(tries5));

  const named = await Promise.all(pages.map((p) => p.eval('return { sent: pt.sig.length, named: pt.sig.filter((m) => m.named).length };')));
  ok('no owner pass, proof or request ever went through the signaling server', named.every((x) => x.named === 0), `${named.reduce((a, x) => a + x.sent, 0)} messages`);
  const errs = await Promise.all(pages.map((p) => p.eval('return pt.err;')));
  const exceptions = pages.flatMap((p) => p.logs.filter((l) => /exception/.test(l)));
  ok('no exceptions in any tab', errs.every((e) => !e) && exceptions.length === 0, [...errs.filter(Boolean), ...exceptions].slice(0, 3).join(' | '));
  exitCode = R.every((r) => r.pass) ? 0 : 1;
} catch (err) {
  if (err && err.stop) exitCode = R.every((r) => r.pass) ? 0 : 1;
  else ok('the playtest ran to the end', false, String(err && err.stack || err).slice(0, 600));
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
