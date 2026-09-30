/**
 * The admin playtest (multiplayer part 3b): the crown and admins, in five
 * real tabs of ONE headless Chrome, over tools/lan-server.py --local.
 *
 *   node tests/features/multiplayer.admin.playtest.mjs
 *     --url=http://127.0.0.1:9181/   a LAN server already serving the game (else one is started on a free port)
 *     --json=<file>                  write the numbers there too
 *
 * The admin code is in no file: every tab accepts the TEST key
 * (.claude/devtools/admin-keys/test-admin.json, added with admin.js
 * addAdminKey, as the owner's key is in every copy), and one tab types the
 * test code into the hangar's own code box. Measured, not looked at:
 *
 *   - the code box: a wrong code is told what any wrong code is told; the
 *     test code makes that device an admin, keeping a flag and the derived
 *     key, never the code;
 *   - Lobby 2: its owner wears the crown in every list and on their tag; the
 *     admin wears the ADMIN badge; only the admin has the admin menu;
 *   - a TAMPERED client says it is an admin with a key nobody can check, and
 *     asks for kick, mute, freeze and close every way it can: nothing;
 *   - the admin, through the real player list with its "are you sure":
 *     mute and unmute (the chat reaches nobody), freeze and unfreeze (the
 *     aeroplane holds still in the air, and everybody sees it still), kick
 *     (out, told kindly, not straight back in);
 *   - the owner leaves: the crown moves to the next in line, who checks the
 *     admin again;
 *   - close: everybody back on the lobby list, told kindly;
 *   - a private match, locked: anybody else is refused through the admins'
 *     directory and by the lock; the admin's lobby screen lists it (no code)
 *     and gets in without the code, wearing the badge;
 *   - a MADE-UP flag: a sixth tab, on the other name for this computer
 *     (localhost / 127.0.0.1, so its own localStorage), has the owner's
 *     public x and y (read out of admin.js, as anybody could) with a random d
 *     pasted in before the game starts. It is not an admin and the flag is
 *     forgotten; it reaches an empty lobby first and hosts it, and the two
 *     classmates who join see the crown on it but no ADMIN badge, it has no
 *     admin menu, and its powers do nothing to them.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { findTestKey } from './multiplayer.admin.mjs';
import { adminKeys, b64url } from '../../src/features/multiplayer/admin.js';

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
    // This checkout's devtools, or the main checkout's when this is a builder's worktree inside it.
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
  const dir = mkdtempSync(join(tmpdir(), 'ifs-admin-chrome-'));
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
  // Run before any of the page's own scripts, on every document this tab loads (the made-up flag, pasted in before the game starts).
  if (preload) await send('Page.addScriptToEvaluateOnNewDocument', { source: preload });
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
    // Where this tab draws everybody else, while the lag is being measured.
    if (pt.recDrawn) for (const p of pt.mp.remotes.players.values()) if (p.drawn && p.visible) pt.drawn.push([now(), p.name, p.drawn.x, p.drawn.y, p.drawn.z]);
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

/* ---- part 3b ------------------------------------------------------------------ */
const NAMES = ['Kind Koala', 'Swift Falcon', 'Brave Otter', 'Sunny Puffin', 'Jolly Penguin'];
const COLOURS = ['#ff5a4f', '#ff9f1c', '#ffd23f', '#4fd684', '#2ec4b6'];
const FAKER = 'Keen Kestrel';
const NAMES_RE = `/${[...NAMES, FAKER, '"prove"', '"chal"', '"adm"'].join('|')}/`;
const TK = findTestKey();
if (!TK) {
  console.error('the admin playtest needs .claude/devtools/admin-keys/test-admin.json (the test key) — not found');
  process.exit(2);
}

const STATE = `
  const s = mp.session;
  return {
    role: mp.role, n: mp.lobby && mp.lobby.n, ready: mp.ready, reconnecting: mp.reconnecting, name: mp.profile.name, state: sim.state,
    id: mp.meId, me: mp.me, count: s ? (mp.role === 'host' ? s.count : s.players.size + 1) : 0,
    remotes: [...mp.remotes.players.values()].map((p) => ({ id: p.id, name: p.name, host: !!p.host, admin: !!p.admin, tag: p.tag ? p.tag.key : null })),
  };`;

const url = await serve();
log(`serving ${url}`);
const pages = [];
let exitCode = 1;
try {
  for (let i = 0; i < NAMES.length; i++) {
    const p = await openPage(`${url}?dev=1`, `tab${i + 1}`);
    const r = await p.eval(PAGE(NAMES[i], COLOURS[i]).replace('NAMES_RE', NAMES_RE), 120);
    // The test key, as an admin key this copy accepts — as the owner's is in every copy. Never the code.
    const keys = await p.eval(`const A = await import('/src/features/multiplayer/admin.js'); pt.A = A; A.addAdminKey(${JSON.stringify({ x: TK.x, y: TK.y })}); return A.adminKeys().length;`, 30);
    pages.push(p);
    log(`tab${i + 1} up as ${r.name} (${r.state}); ${keys} admin keys`);
  }
  const [T1, T2, T3, T4, T5] = pages;
  const st = (p) => p.eval(STATE, 30);

  /* The hangar's code box: a wrong code, and the admin code (the test one). */
  const codeBox = (p, typed) => p.eval(`
    sim.menus.show('hangar');
    const scr = document.querySelector('[data-screen="hangar"]');
    const box = scr.querySelector('[data-code]');
    const msg = scr.querySelector('[data-code-msg]');
    const before = msg.textContent;
    box.value = ${JSON.stringify(typed)};
    scr.querySelector('[data-redeem]').click();
    const r = await pt.until(() => msg.textContent !== before && msg.textContent, 8000);
    const kept = localStorage.getItem('islandsim.admin.v1');
    const out = { msg: r.v, ms: r.ms, admin: mp.isAdmin, kept: kept ? Object.keys(JSON.parse(kept)).sort().join(',') : null, hasCode: !!(kept && kept.includes(${JSON.stringify(typed)})), cleared: box.value === '', maxlength: box.maxLength };
    sim.menus.show('main');
    return out;`, 30);
  const wrong = await codeBox(T3, `${TK.code.slice(0, -3)}xyz`);
  ok('the hangar’s code box: a wrong code is not admin, and is told what any wrong code is told', !wrong.admin && wrong.msg === 'That code does not work' && !wrong.kept, wrong);
  const right = await codeBox(T2, TK.code);
  ok('the admin code (the test one) in the same box makes this device an admin, and says so', right.admin && /^Admin is on for this device/.test(right.msg) && right.cleared, `${right.ms} ms: ${right.msg}`);
  ok('what the device keeps is a flag and the derived key — never the code', right.kept === 'd,on,x,y' && !right.hasCode && right.maxlength >= 64, right.kept);

  /* Into Lobby 2: the owner first, then a tampered client, the admin, and a player. */
  const opened = await Promise.all(pages.map((p) => p.eval(`
    pt.mpMod.openMultiplayer(sim);
    const r = await pt.until(() => document.querySelectorAll('.mp-lobby.is-empty, .mp-lobby.is-open, .mp-lobby.is-full').length >= 5, 30000);
    return { ms: r.ms, adminBox: !document.querySelector('[data-mp-adminbox]').hidden };`, 60)));
  ok('the lobby screen: only the admin’s has the admin box (private matches, admin off)', opened.map((o) => o.adminBox).join(',') === 'false,true,false,false,false', opened.map((o) => o.adminBox).join(','));
  // The tampered client: says it is an admin, with a key the host cannot check — a signature of junk.
  await T4.eval(`mp.adminKey = { valid: true, x: 'forged', y: 'forged', sign: async () => 'A'.repeat(86) }; return mp.isAdmin;`);
  const join = (p, n) => p.eval(`
    const t0 = performance.now();
    pt.click('[data-mp-lobby-join="${n}"]');
    const r = await pt.until(() => (mp.ready && mp.lobby && sim.state === 'flying') || (!mp.busy && !mp.lobby && document.querySelector('[data-mp-status]').textContent), 60000);
    return { ms: Math.round(performance.now() - t0), role: mp.role, status: pt.text('[data-mp-status]') };`, 90);
  const joins = [];
  for (const p of [T1, T4, T2, T3]) joins.push(await join(p, 2));
  ok('four into Lobby 2: its owner hosts, three join', joins[0].role === 'host' && joins.slice(1).every((j) => j.role === 'client'), joins.map((j) => `${j.role} ${j.ms} ms`).join(', '));
  await Promise.all([T1, T2, T3, T4].map((p) => p.eval('const r = await pt.until(() => mp.remotes.players.size === 3 && [...mp.remotes.players.values()].every((q) => q.tag && q.tag.key), 20000); mp.syncRoster(); return !!r.v;', 40)));
  let s1 = await st(T1);
  const ids = Object.fromEntries(s1.remotes.map((r) => [r.name, r.id]));
  ids['Kind Koala'] = 0;
  const [s2, s3, s4] = await Promise.all([T2, T3, T4].map(st));

  /* The crown and the badge. */
  const listOf = (p) => p.eval(`
    mp.syncRoster();
    const rows = [...document.querySelectorAll('[data-mp-list] .mp-prow')].map((r) => ({ text: r.textContent.replace(/\\s+/g, ' ').trim(), crown: !!r.querySelector('.mp-crown'), admin: !!r.querySelector('.mp-admintag'), menu: !!r.querySelector('[data-mp-adm-open]') }));
    return { rows, close: !!document.querySelector('[data-mp-list] [data-mp-adm="close:-1"]'), badge: pt.text('.mp-badge') };`, 20);
  const lists = await Promise.all([T1, T2, T3, T4].map(listOf));
  const ownerCrowned = lists.every((l) => l.rows.filter((r) => r.crown).length === 1 && l.rows.find((r) => r.crown).text.includes('Kind Koala'));
  const tagsCrowned = [s2, s3, s4].every((s) => s.remotes.find((r) => r.id === 0).host && /\|h/.test(s.remotes.find((r) => r.id === 0).tag) && s.remotes.filter((r) => r.host).length === 1);
  ok('the crown: the lobby’s owner wears it in every list and on their tag over the aeroplane — only them', ownerCrowned && tagsCrowned,
    lists.map((l) => (l.rows.find((r) => r.crown) || {}).text).join(' | '));
  const adminSeen = [s1, s3, s4].every((s) => { const r = s.remotes.find((q) => q.id === ids['Swift Falcon']); return r && r.admin && /a$/.test(r.tag); })
    && lists.every((l) => l.rows.filter((r) => r.admin).length === 1 && l.rows.find((r) => r.admin).text.includes('Swift Falcon'));
  ok('the ADMIN badge: everybody sees the admin as one — on their tag and in the list — and nobody else', adminSeen, lists[2].rows.map((r) => r.text).join(' | '));
  ok('the admin’s list has the admin menu for the other three and “Close server for everybody”; nobody else’s has any of it',
    lists[1].rows.filter((r) => r.menu).length === 3 && lists[1].close && lists.filter((l, i) => i !== 1).every((l) => !l.close && !l.rows.some((r) => r.menu)) && /ADMIN/.test(lists[1].badge),
    lists[1].badge);
  ok('the tampered client that said it was an admin is not one — the host checked, and said no', !s4.me.admin && s2.me.admin && !lists[3].close, JSON.stringify(s4.me));

  /* The tampered client asks for admin things anyway, every way it can. */
  const t3 = ids['Brave Otter'];
  await T4.eval(`
    const c = mp.client;
    for (const op of ['kick', 'mute', 'freeze', 'close']) c.link.send({ t: 'adm', op, id: ${t3} });
    c.link.send({ t: 'prove', s: 'A'.repeat(86) });
    mp.me = { ...mp.me, admin: true };
    mp.adminAct('kick', ${t3});
    mp.adminAct('close', -1);
    return true;`);
  await sleep(1500);
  const after4 = await T1.eval(`const p = mp.host.players.get(${t3}); return { in: !!p, muted: !!(p && p.muted), frozen: !!(p && p.frozenUntil), closed: mp.host.closed, count: mp.host.count, t4admin: mp.host.players.get(${ids['Sunny Puffin']}).admin };`);
  ok('…and gets nothing: nobody kicked, muted or frozen, the lobby not closed', after4.in && !after4.muted && !after4.frozen && !after4.closed && after4.count === 4 && !after4.t4admin, after4);
  await T4.eval('mp.syncSelf(); return true;');

  /* The admin's menu, clicked as a child would, each with its "are you sure". */
  const adminDo = (op, id, secs = 30) => T2.eval(`
    mp.hud.hold(true);
    mp.syncRoster();
    const L = '[data-mp-list] ';
    if (${JSON.stringify(op)} !== 'close') pt.click(L + '[data-mp-adm-open="${id}"]');
    const offered = [...document.querySelectorAll(L + '[data-mp-adm]')].map((b) => b.textContent);
    pt.click(L + '[data-mp-adm="${op}:${id}"]');
    const sure = pt.text(L + '.mp-sure');
    pt.click(L + '[data-mp-adm-yes]');
    mp.hud.hold(false);
    return { offered, sure };`, secs);
  const mute = await adminDo('mute', t3);
  const muted = await T3.eval(`
    const r = await pt.until(() => mp.me.muted, 10000);
    const before = pt.toasts.length;
    mp.chat(0);
    return { ms: r.ms, muted: mp.me.muted, told: pt.toasts.slice(-3).map((t) => t.text), badge: pt.text('.mp-badge') };`, 20);
  await sleep(800);
  const heard = await T1.eval(`mp.syncRoster(); return { chat: pt.toasts.some((t) => /Brave Otter: /.test(t.text)), row: [...document.querySelectorAll('[data-mp-list] .mp-prow')].map((r) => r.textContent).find((t) => /Brave Otter/.test(t)) };`);
  ok('mute: Admin → Mute chat → “Mute Brave Otter’s chat for everybody?” → Yes; they are told, and their chat reaches nobody',
    /Mute Brave Otter’s chat for everybody\?/.test(mute.sure) && muted.muted && muted.told.some((t) => /An admin has muted your chat/.test(t)) && !heard.chat && /chat muted by an admin/.test(heard.row),
    `${mute.offered.join('/')}; ${muted.ms} ms; ${heard.row}`);
  await adminDo('unmute', t3);
  const unmuted = await T3.eval('const r = await pt.until(() => !mp.me.muted, 10000); mp.client._chatAt = -Infinity; mp.chat(1); return !!r.v;', 20);
  const heard2 = await T1.eval('const r = await pt.until(() => pt.toasts.some((t) => /Brave Otter: /.test(t.text)), 8000); return !!r.v;', 20);
  ok('unmute: reversible — their chat is heard again', unmuted && heard2);

  // Freeze: Brave Otter flying at 55 m/s, then frozen.
  await T3.eval('pt.airborne(300, 300, 90); return true;');
  await sleep(600);
  const freeze = await adminDo('freeze', t3);
  const frozen = await T3.eval(`
    const r = await pt.until(() => mp.me.frozen, 10000);
    await new Promise((res) => setTimeout(res, 300));
    const a = sim.aircraft.pos.clone();
    await new Promise((res) => setTimeout(res, 2000));
    const b = sim.aircraft.pos;
    return { ms: r.ms, moved: a.distanceTo(b), told: pt.toasts.slice(-3).map((t) => t.text), badge: pt.text('.mp-badge'), state: sim.state };`, 30);
  const watched = await T1.eval(`
    const q = mp.remotes.players.get(${t3});
    const a = q && q.drawn ? { x: q.drawn.x, y: q.drawn.y, z: q.drawn.z } : null;
    await new Promise((res) => setTimeout(res, 1500));
    const b = q && q.drawn;
    return { moved: a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : null, row: [...document.querySelectorAll('[data-mp-list] .mp-prow')].map((r) => r.textContent).find((t) => /Brave Otter/.test(t)) };`, 20);
  ok('freeze: “Freeze Brave Otter for 30 seconds?” → Yes; their aeroplane holds still in the air (not crashed, not paused), and everybody sees it still',
    /Freeze Brave Otter for 30 seconds\?/.test(freeze.sure) && frozen.moved < 0.5 && frozen.state === 'flying' && frozen.told.some((t) => /An admin has frozen you/.test(t)) && /Frozen by an admin/.test(frozen.badge)
    && watched.moved != null && watched.moved < 3 && /frozen/.test(watched.row),
    `${frozen.ms} ms; moved ${frozen.moved.toFixed(2)} m in 2 s; seen moving ${watched.moved && watched.moved.toFixed(2)} m in 1.5 s`);
  await adminDo('unfreeze', t3);
  const thawed = await T3.eval(`
    const r = await pt.until(() => !mp.me.frozen, 10000);
    const a = sim.aircraft.pos.clone();
    await new Promise((res) => setTimeout(res, 1000));
    return { ms: r.ms, moved: a.distanceTo(sim.aircraft.pos), told: pt.toasts.slice(-2).map((t) => t.text) };`, 20);
  ok('unfreeze: reversible — they fly on at the speed they had', thawed.moved > 20 && thawed.told.some((t) => /You can move again/.test(t)), `${thawed.moved.toFixed(1)} m in 1 s`);

  // Kick.
  const kick = await adminDo('kick', t3);
  const kicked = await T3.eval(`
    const r = await pt.until(() => !mp.lobby && !mp.role, 10000);
    await new Promise((res) => setTimeout(res, 300));
    return { ms: r.ms, state: sim.state, told: pt.toasts.slice(-3).map((t) => t.text) };`, 20);
  s1 = await st(T1);
  ok('kick: “Take Brave Otter out of this game?” → Yes; they are out, told kindly it was an admin, and fly on alone',
    /Take Brave Otter out of this game\?/.test(kick.sure) && kicked.state === 'flying' && kicked.told.some((t) => /An admin took you out of Lobby 2/.test(t)) && s1.count === 3,
    `${kicked.ms} ms; ${kicked.told.join(' | ')}`);
  const barred = await T3.eval(`pt.mpMod.openMultiplayer(sim); await new Promise((res) => setTimeout(res, 300)); pt.click('[data-mp-lobby-join="2"]'); await new Promise((res) => setTimeout(res, 300)); return { status: pt.text('[data-mp-status]'), lobby: !!mp.lobby };`, 20);
  ok('…and not straight back in', !barred.lobby && /An admin took you out of Lobby 2 a moment ago/.test(barred.status), barred.status);

  /* The crown moves: the owner leaves, the next in line owns the lobby, and checks the admin again. */
  const tLeave = Date.now();
  await T1.eval(`mp.leave('left'); return true;`);
  const moved = await T2.eval(`
    const r = await pt.until(() => mp.lobby && mp.session && !mp.reconnecting && mp.remotes.players.get(0) && mp.remotes.players.get(0).name === 'Sunny Puffin' && mp.me.admin, 30000);
    await new Promise((res) => setTimeout(res, 700));
    mp.syncRoster();
    const q = mp.remotes.players.get(0);
    return { ok: !!r.v, ms: r.ms, host: q && q.host, tag: q && q.tag && q.tag.key, admin: mp.me.admin, crownRow: ([...document.querySelectorAll('[data-mp-list] .mp-prow')].find((x) => x.querySelector('.mp-crown')) || {}).textContent };`, 40);
  const newOwner = await st(T4);
  ok('the crown follows the lobby: its owner leaves, the next in line owns it — the crown is theirs in the list and on their tag',
    moved.ok && moved.host && /\|h/.test(moved.tag) && /Sunny Puffin/.test(moved.crownRow || '') && newOwner.role === 'host', `${Date.now() - tLeave} ms; ${moved.crownRow}`);
  ok('and the new owner checked the admin for itself — still an admin, in a lobby it now hosts', moved.admin && newOwner.remotes.find((r) => r.name === 'Swift Falcon').admin);

  /* Close, from the admin's list. */
  const close = await adminDo('close', -1);
  const shut = await Promise.all([T4, T2].map((p) => p.eval(`
    const r = await pt.until(() => !mp.lobby && !mp.role && sim.state === 'menu' && !document.querySelector('[data-screen="lobbies"]').hidden, 15000);
    return { ms: r.ms, status: pt.text('[data-mp-status]'), told: pt.toasts.slice(-2).map((t) => t.text) };`, 30)));
  ok('close: “Close this game for everybody?” → Yes, close it; everybody is back on the lobby list, told kindly',
    /Close this game for everybody\?/.test(close.sure) && shut.every((x) => /An admin closed Lobby 2 for now — everybody is back here\. Pick a lobby to fly again\./.test(x.status)),
    shut.map((x) => `${x.ms} ms: ${x.status}`).join(' | '));

  /* A private match: locked, with a code — and the admin gets in without the code. */
  const priv = await T5.eval(`
    pt.click('[data-mp-private]');
    const r = await pt.until(() => mp.role === 'host' && mp.ready && sim.state === 'flying', 60000);
    mp.lock(true);
    return { ok: !!r.v, ms: r.ms, code: mp.server && mp.server.code, dir: (mp.hostSockets.find((s) => s.what === 'pdir') || {}).id };`, 90);
  ok('a private match is made, and locked; its host also holds a place in the admins’ directory', priv.ok && /^ifs-pdir-\d+$/.test(priv.dir || ''), `${priv.code}; ${priv.dir}`);
  const snoop = await T3.eval(`
    pt.mpMod.openMultiplayer(sim);
    await mp.join(${JSON.stringify(priv.dir)});
    const a = { status: pt.text('[data-mp-status]'), role: mp.role };
    const box = document.querySelector('[data-mp-code]');
    box.value = ${JSON.stringify(priv.code)};
    box.dispatchEvent(new Event('input', { bubbles: true }));
    pt.click('[data-mp-join-code]');
    const r = await pt.until(() => !mp.busy && pt.text('[data-mp-status]') !== a.status && pt.text('[data-mp-status]'), 30000);
    return { dir: a, code: { status: pt.text('[data-mp-status]'), role: mp.role }, box: document.querySelector('[data-mp-adminbox]').hidden };`, 60);
  ok('anybody else: through the directory, “private — you need its code”; with the code, “locked”; and no admin box',
    snoop.dir.role === null && /That match is private — you need its code to join\./.test(snoop.dir.status) && snoop.code.role === null && /locked/.test(snoop.code.status) && snoop.box,
    `${snoop.dir.status} / ${snoop.code.status}`);
  const boss = await T2.eval(`
    const r = await pt.until(() => document.querySelector('[data-mp-pdir-join]:not([disabled])'), 20000);
    const card = r.v ? r.v.closest('.mp-lobby').textContent.replace(/\\s+/g, ' ').trim() : null;
    const t0 = performance.now();
    if (r.v) r.v.click();
    const j = await pt.until(() => mp.role === 'client' && mp.ready && sim.state === 'flying', 60000);
    return { found: r.ms, card, joined: !!j.v, ms: Math.round(performance.now() - t0), priv: !!(mp.server && mp.server.priv), admin: mp.me.admin };`, 90);
  const hostSees = await T5.eval(`const r = await pt.until(() => [...mp.host.players.values()].some((p) => p.admin), 10000); mp.syncRoster(); return { admin: !!r.v, badge: !![...document.querySelectorAll('[data-mp-list] .mp-prow')].find((x) => /Swift Falcon/.test(x.textContent) && x.querySelector('.mp-admintag')), locked: mp.host.locked, count: mp.host.count };`, 20);
  ok('the admin’s lobby screen lists it (numbers only, no code) — “Join without the code” gets in, past the lock, and they wear the ADMIN badge there',
    boss.joined && boss.priv && boss.admin && hostSees.admin && hostSees.badge && hostSees.locked && hostSees.count === 2 && !boss.card.includes(priv.code),
    `found in ${boss.found} ms: “${boss.card}”; joined in ${boss.ms} ms`);
  M.admin = { codeBoxMs: right.ms, joinsMs: joins.map((j) => j.ms), muteMs: muted.ms, freezeMs: frozen.ms, kickMs: kicked.ms, crownMovedMs: moved.ms, closeMs: shut.map((x) => x.ms), privateFoundMs: boss.found, privateJoinMs: boss.ms };

  /*
   * A made-up flag. The owner's x and y are public — they are in admin.js —
   * and a host takes its own word for being an admin. So: those x and y and
   * a random d, pasted into localStorage before the game starts, on the
   * other name for this computer (its own localStorage: the admin's real
   * key is kept on this one). It must not be an admin anywhere, least of all
   * in the lobby it hosts.
   */
  const owner = adminKeys()[0];
  const fakeFlag = JSON.stringify({ on: 1, x: owner.x, y: owner.y, d: b64url(randomBytes(32)) });
  const other = new URL(url);
  other.hostname = other.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  const T6 = await openPage(`${other.href}?dev=1`, 'tab6', 240,
    `try { localStorage.setItem('islandsim.admin.v1', ${JSON.stringify(fakeFlag)}); window.__planted = localStorage.getItem('islandsim.admin.v1'); } catch (e) { window.__planted = null; }`);
  await T6.eval(PAGE(FAKER, '#9b5de5').replace('NAMES_RE', NAMES_RE), 120);
  pages.push(T6);
  const f0 = await T6.eval(`return { planted: window.__planted, origin: location.origin, admin: mp.isAdmin, key: !!mp.adminKey, kept: localStorage.getItem('islandsim.admin.v1') };`, 20);
  ok('a made-up flag — the owner’s public x and y with a random d, pasted in before the game starts — is not an admin, and is forgotten',
    f0.planted === fakeFlag && f0.origin !== new URL(url).origin && !f0.admin && !f0.key && f0.kept === null, `${f0.origin}; kept ${f0.kept}`);
  // It reaches an empty lobby first, so it hosts: two classmates follow it in.
  const lobbyUp = (p) => p.eval(`
    if (mp.lobby || mp.role) mp.leave('left');
    pt.mpMod.openMultiplayer(sim);
    const r = await pt.until(() => document.querySelectorAll('.mp-lobby.is-empty, .mp-lobby.is-open, .mp-lobby.is-full').length >= 5 && !mp.busy, 30000);
    return { ok: !!r.v, adminBox: !document.querySelector('[data-mp-adminbox]').hidden, empty4: !!document.querySelector('[data-mp-lobby-join="4"]') && !!document.querySelector('[data-mp-lobby-join="4"]').closest('.mp-lobby.is-empty') };`, 60);
  const up6 = await lobbyUp(T6);
  const fjoins = [await join(T6, 4)];
  for (const p of [T3, T4]) {
    await lobbyUp(p);
    fjoins.push(await join(p, 4));
  }
  ok('…its lobby screen has no admin box; it reaches empty Lobby 4 first and hosts it, and two classmates join',
    up6.ok && !up6.adminBox && up6.empty4 && fjoins[0].role === 'host' && fjoins.slice(1).every((j) => j.role === 'client'), fjoins.map((j) => `${j.role} ${j.ms} ms`).join(', '));
  await Promise.all([T6, T3, T4].map((p) => p.eval('const r = await pt.until(() => mp.remotes.players.size === 2 && [...mp.remotes.players.values()].every((q) => q.tag && q.tag.key), 20000); mp.syncRoster(); return !!r.v;', 40)));
  const [f6, f3, f4] = await Promise.all([T6, T3, T4].map(st));
  const flists = await Promise.all([T6, T3, T4].map(listOf));
  const fhost = [f3, f4].map((s) => s.remotes.find((r) => r.id === 0));
  ok('…the classmates see the crown on it, and no ADMIN badge — on its tag or in any list; it has no admin menu and no “Close server”',
    fhost.every((r) => r && r.name === FAKER && r.host && !r.admin && /\|h$/.test(r.tag)) && !f6.me.admin && flists.every((l) => !l.close && !l.rows.some((r) => r.admin || r.menu)) && !/ADMIN/.test(flists[0].badge || ''),
    `${fhost.map((r) => r && r.tag).join(' | ')}; badge ${flists[0].badge}`);
  const ftries = await T6.eval(`
    const ids = [...mp.host.players.keys()];
    const out = { hostAdmin: mp.host.me.admin, freeze: mp.adminAct('freeze', ids[0]), mute: mp.adminAct('mute', ids[1]), kick: mp.adminAct('kick', ids[1]), close: mp.adminAct('close', -1) };
    out.direct = [mp.host.adminAct('freeze', ids[0]), mp.host.adminAct('kick', ids[1]), mp.host.adminClose()];
    return out;`, 20);
  await sleep(1500);
  const [g3, g4] = await Promise.all([T3, T4].map(st));
  const fcount = await T6.eval('return { count: mp.host.count, closed: mp.host.closed };', 20);
  ok('…and its powers do nothing: freeze, mute, kick and close refused, both classmates still in, not frozen, not muted',
    !ftries.hostAdmin && [ftries.freeze, ftries.mute, ftries.kick, ftries.close, ...ftries.direct].every((v) => v === false)
    && [g3, g4].every((g) => g.role === 'client' && g.n === 4 && !g.me.frozen && !g.me.muted) && fcount.count === 3 && !fcount.closed,
    JSON.stringify(ftries));
  M.admin.fakeFlagJoinsMs = fjoins.map((j) => j.ms);

  const named = await Promise.all(pages.map((p) => p.eval('return { sent: pt.sig.length, named: pt.sig.filter((m) => m.named).length };')));
  ok('no username, admin proof or admin request ever went through the signaling server', named.every((x) => x.named === 0), `${named.reduce((a, x) => a + x.sent, 0)} messages`);
  const errs = await Promise.all(pages.map((p) => p.eval('return pt.err;')));
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
