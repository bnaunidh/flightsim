/**
 * Part 3b, the crown and admins — for tests/features/multiplayer.mjs (which
 * runs this with its own signaling server and `ok`), or alone, against the
 * fakes:
 *
 *   node tests/features/multiplayer.admin.mjs
 *
 * The admin code is in no file of the game or of these tests. They use the
 * TEST key made for them (.claude/devtools/admin-keys/test-admin.json: a
 * test code and its public key), which the game does not accept until a test
 * adds it (admin.js addAdminKey) — exactly as it would the owner's key, which
 * is the one shipped. Without that file the crypto half is skipped, and says so.
 *
 * What it proves, with the shipped admin.js, session.js and lobby.js:
 *   - the scheme: a code makes the same key node's own crypto makes from it;
 *     a wrong code, or the test code before its key is added, is not an admin;
 *     admin.js holds a public key and nothing else;
 *   - what a device keeps is checked when the game starts, not trusted: a
 *     flag made up by hand (the owner's public x and y, copied out of
 *     admin.js, with any d) is not an admin and is forgotten, and a device
 *     holding one hosts a lobby with no badge and no powers; a real kept key
 *     still loads;
 *   - a proof is good for one nonce, one host, one socket: not replayed on
 *     another line, not relayed from another host;
 *   - in a lobby: the host checks an admin and marks them; a tampered client
 *     that says it is one — garbage, a copied signature, a request without
 *     asking — gets nothing, and its "admin" requests do nothing;
 *   - each power, host-enforced: mute (the chat goes to nobody), freeze (the
 *     host relays them where they were frozen, then lets go), kick (out, not
 *     re-forming, kept out), close (everybody out, not re-forming); none of it
 *     to an admin;
 *   - the crown: whoever hosts is `host` in everybody's list, and after the
 *     host leaves it is the new host — and the admin is checked again by them;
 *   - a private match: an admin past its lock, and in through the directory
 *     without the code; anybody else through the directory is refused, and
 *     the directory's pong carries numbers only.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash, createECDH, randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The test key, from .claude/devtools — in this checkout, or the main one a worktree is inside. */
export function findTestKey() {
  let dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (let i = 0; i < 8; i++) {
    const f = join(dir, '.claude', 'devtools', 'admin-keys', 'test-admin.json');
    if (existsSync(f)) {
      try {
        const k = JSON.parse(readFileSync(f, 'utf8'));
        if (k && typeof k.code === 'string' && k.x && k.y) return k;
      } catch (err) {
        return null;
      }
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function adminTests(ctx) {
  const { P, S, L, Signaling, Net, backend, WS, RTC, ok, sleep, until, REAL } = ctx;
  const A = await import('../../src/features/multiplayer/admin.js');
  const untilT = (fn, ms = 3000) => until(fn, REAL ? ms * 4 : ms);
  const mkSig = (token) => new Signaling(backend, { WebSocketImpl: WS, heartbeatMs: REAL ? 5000 : 50, ...(token ? { token } : {}) });
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const TK = findTestKey();

  /* ---- what ships ------------------------------------------------------ */
  {
    const src = readFileSync(join(ROOT, 'src', 'features', 'multiplayer', 'admin.js'), 'utf8');
    const keys = A.adminKeys();
    const b64s = src.match(/'[A-Za-z0-9_-]{43}'/g) || [];
    ok('admin.js ships one public key — an x and a y, and no private number or code anywhere in it',
      keys.length === 1 && b64s.length === 2 && b64s.every((v) => v === `'${keys[0].x}'` || v === `'${keys[0].y}'`) && !/\bd\s*:\s*'/.test(src),
      `${keys.length} key(s), ${b64s.length} key values`);
    if (TK) {
      const leaks = [];
      for (const f of ['multiplayer.js', 'multiplayer/admin.js', 'multiplayer/session.js', 'multiplayer/lobby.js', 'multiplayer/ui.js', 'multiplayer/lobbyui.js']) {
        const text = readFileSync(join(ROOT, 'src', 'features', f), 'utf8');
        if (text.includes(TK.code) || text.includes(TK.x)) leaks.push(f);
      }
      ok('the test code and the test key are in no file of the game', leaks.length === 0, leaks.join(', '));
    }
  }

  if (!TK) {
    ok('the admin crypto checks need .claude/devtools/admin-keys/test-admin.json — not found, skipped', true);
    return;
  }

  /* ---- the scheme -------------------------------------------------------- */
  {
    ok('the test code is not an admin code until its key is added (as any code but the owner’s)', (await A.AdminKey.fromCode(TK.code)) === null);
    ok('addAdminKey takes an x and a y only', A.addAdminKey({ x: TK.x, y: TK.y }) && !A.addAdminKey({ x: 'short', y: TK.y }) && A.adminKeys().length === 2);
    // node's own crypto, from the scheme as written: SHA-256 of the prefix and the trimmed, lower-cased code.
    const d = createHash('sha256').update(`island-flight-sim admin v1\n${TK.code.trim().toLowerCase()}`).digest();
    const pub = createECDH('prime256v1');
    pub.setPrivateKey(d);
    const point = pub.getPublicKey();
    ok('the scheme: the code makes the private number whose public key is the test key (checked with node’s own crypto)',
      b64u(point.subarray(1, 33)) === TK.x && b64u(point.subarray(33, 65)) === TK.y);
    const key = await A.AdminKey.fromCode(TK.code);
    const loud = await A.AdminKey.fromCode(`  ${TK.code.toUpperCase()}  `);
    ok('the hangar’s code box: the test code now makes an admin key, spaces and capitals as typed', !!key && key.x === TK.x && !!loud);
    const wrongs = [TK.code.slice(0, -1), `${TK.code}x`, TK.code.replace(/a/, 'b'), '', '   ', 'x'.repeat(300)];
    const made = await Promise.all(wrongs.map((w) => A.AdminKey.fromCode(w)));
    ok('a wrong code is simply not an admin code — the same null whatever is wrong with it', made.every((m) => m === null));

    const n = A.nonce();
    const text = A.proofText(n, 'ifs-host-a', 'ifs-p-admin');
    const sig = await key.sign(text);
    const checks = await Promise.all([
      A.verifyProof(text, sig),
      A.verifyProof(A.proofText(A.nonce(), 'ifs-host-a', 'ifs-p-admin'), sig),
      A.verifyProof(A.proofText(n, 'ifs-host-b', 'ifs-p-admin'), sig),
      A.verifyProof(A.proofText(n, 'ifs-host-a', 'ifs-p-other'), sig),
      A.verifyProof(text, sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA')),
      A.verifyProof(text, ''),
      A.verifyProof(text, 'not base64 at all!'),
      A.verifyProof(text, 'A'.repeat(500)),
    ]);
    ok('a proof holds for its own nonce, host and socket only: not another nonce, another host, another player, or junk',
      checks[0] === true && checks.slice(1).every((c) => c === false), checks.join(','));
    const nonces = new Set(Array.from({ length: 200 }, () => A.nonce()));
    ok('every host question is fresh: 200 nonces, 200 different, 24 characters of 18 random bytes', nonces.size === 200 && [...nonces].every((x) => /^[A-Za-z0-9_-]{24}$/.test(x)));

    /*
     * No WebCrypto: a school's LAN server is plain http on 192.168.x.x, where
     * crypto.subtle does not exist. The same key from the same code, and
     * signatures each side checks from the other (p256.js).
     */
    const real = globalThis.crypto;
    const bare = { getRandomValues: (u) => real.getRandomValues(u) };
    const setCrypto = (c) => Object.defineProperty(globalThis, 'crypto', { value: c, configurable: true, writable: true });
    let lan = null;
    setCrypto(bare);
    try {
      const t0 = performance.now();
      const k2 = await A.AdminKey.fromCode(TK.code);
      const ms = performance.now() - t0;
      const w2 = await A.AdminKey.fromCode(`${TK.code}!`);
      const t2 = A.proofText(A.nonce(), 'ifs-host-lan', 'ifs-p-admin');
      const s2 = k2 ? await k2.sign(t2) : '';
      const t1 = performance.now();
      lan = {
        crypto: A.adminCrypto(), made: !!k2 && k2.x === TK.x && k2.y === TK.y, wrong: w2 === null, ms,
        webMadeOk: await A.verifyProof(text, sig), tamperedNo: !(await A.verifyProof(A.proofText(n, 'ifs-host-b', 'ifs-p-admin'), sig)), t2, s2,
      };
      lan.verifyMs = performance.now() - t1;
    } finally {
      setCrypto(real);
    }
    const lanMadeOk = await A.verifyProof(lan.t2, lan.s2);
    ok('without WebCrypto (plain http on a LAN): the same code makes the same admin key, a wrong one does not',
      lan.crypto && lan.made && lan.wrong, `${lan.ms.toFixed(0)} ms to make it`);
    ok('…and its signatures and WebCrypto’s check each other, both ways; a signature for another host still fails',
      lan.webMadeOk && lan.tamperedNo && lanMadeOk, `${lan.verifyMs.toFixed(0)} ms to check two`);
  }

  /* ---- a lobby with an admin in it ------------------------------------- */
  const adminKey = await A.AdminKey.fromCode(TK.code);
  const lh = REAL ? P.sha256Hex(`admin-${Math.random()}-${Date.now()}`).slice(0, 12) : P.netHashFor('192.0.2.77');
  const everyone = [];
  const ticker = setInterval(() => {
    const t = performance.now();
    for (const m of everyone) m.tick(t);
  }, 40);
  async function member(n, name, extra = {}) {
    const sig = mkSig();
    await sig.open(P.playerPeerId());
    const net = new Net(sig, { RTC });
    const events = [];
    const m = new L.LobbyMember({
      n, hash: lh, net, makeSig: mkSig, profile: { name, colour: P.COLOURS[everyone.length % 8], key: `ak-${everyone.length}-${Math.random().toString(36).slice(2, 8)}` },
      place: () => ({ map: 'kestrel', game: 'flight' }), onEvent: (...e) => events.push(e), netOpts: { RTC }, stepMs: REAL ? 1500 : 300, ...extra,
    });
    m.events = events;
    m.lookSig = sig;
    m.net = net;
    everyone.push(m);
    await m.start();
    return m;
  }
  const host = await member(2, 'Kind Koala');
  const adm = await member(2, 'Swift Falcon', { admin: adminKey });
  const bee = await member(2, 'Brave Otter');
  const cat = await member(2, 'Sunny Puffin');
  const H = host.session;
  await untilT(() => bee.session.players.size === 3 && cat.session.players.size === 3 && adm.session.self.admin);
  const hp = [...H.players.values()];
  const admId = adm.session.id;
  ok('a lobby’s host checks the admin’s signature and marks them — and nobody else',
    hp.find((p) => p.id === admId).admin === true && hp.filter((p) => p.admin).length === 1 && !H.me.admin, hp.map((p) => `${p.name}:${p.admin}`).join(' '));
  ok('everybody’s list says so (the ADMIN badge), and the admin’s own game knows the host checked it',
    bee.session.players.get(admId).admin === true && cat.session.players.get(admId).admin === true && adm.session.self.admin === true && !bee.session.self.admin);
  ok('the crown: everybody’s list has the lobby’s host as its host, and only them',
    [adm, bee, cat].every((m) => m.session.players.get(0) && m.session.players.get(0).host === true && [...m.session.players.values()].filter((p) => p.host).length === 1));

  /* ---- tampered clients -------------------------------------------------- */
  // Sniff the admin's own answer on its line, to replay it.
  let copied = null;
  {
    const probe = await member(3, 'Jolly Penguin');
    const sniff = { sign: async (text) => { copied = await adminKey.sign(text); return copied; } };
    const again = await member(3, 'Clever Koala', { admin: sniff });
    await untilT(() => again.session && again.session.self.admin);
    ok('(an admin joining lobby 3, whose answer is copied off the line)', !!copied && again.session.self.admin);
    probe.leave();
    again.leave();
  }
  const liar = async (name, sign) => member(2, name, { admin: { sign } });
  const garbage = await liar('Mighty Moose', async () => 'A'.repeat(86));
  const replay = await liar('Gentle Lark', async () => copied);
  const blank = await liar('Happy Hedgehog', async () => '');
  await untilT(() => [garbage, replay, blank].every((m) => m.session && m.session.welcomed));
  const liars = [garbage, replay, blank];
  ok('a tampered client saying it is an admin — junk, a copied signature, or nothing — is let in as anybody, not as an admin',
    liars.every((m) => m.session && !m.session.self.admin && !H.players.get(m.session.id).admin), liars.map((m) => (m.session ? `${m.session.id}:${H.players.get(m.session.id).admin}` : 'out')).join(' '));
  // A client that never said it was one sends a proof anyway, and then asks for admin things.
  const sneaky = liars[0].session;
  sneaky.link.send({ t: 'prove', s: copied });
  for (const op of ['kick', 'mute', 'freeze', 'close']) sneaky.link.send({ t: 'adm', op, id: bee.session.id });
  sneaky.adminAct('kick', cat.session.id);
  await sleep(300);
  ok('and what a non-admin asks for — kick, mute, freeze, close — the host does none of',
    !H.closed && H.players.has(bee.session.id) && H.players.has(cat.session.id) && ![...H.players.values()].some((p) => p.muted || p.frozenUntil) && !H.players.get(sneaky.id).admin);
  for (const m of liars) m.leave();
  await untilT(() => H.players.size === 3);

  /* ---- the powers --------------------------------------------------------- */
  const aS = adm.session;
  const bId = bee.session.id;
  const cHeard = [];
  cat.session.emit = ((orig) => (type, ...args) => {
    if (type === 'chat') cHeard.push(args[0].id);
    return orig(type, ...args);
  })(cat.session.emit);
  // Mute.
  ok('mute: an admin asks, the host mutes', aS.adminAct('mute', bId));
  await untilT(() => bee.session.self.muted && cat.session.players.get(bId).muted);
  bee.session._chatAt = -Infinity;
  bee.session.chat(0);
  await sleep(250);
  ok('mute: the muted player’s quick chat goes to nobody, and everybody’s list says they are muted',
    !cHeard.includes(bId) && bee.session.self.muted && cat.session.players.get(bId).muted && H.players.get(bId).muted);
  aS.adminAct('unmute', bId);
  await untilT(() => !bee.session.self.muted);
  bee.session._chatAt = -Infinity;
  bee.session.chat(1);
  await untilT(() => cHeard.includes(bId));
  ok('unmute: their chat is heard again', cHeard.includes(bId) && !cat.session.players.get(bId).muted);

  // Freeze: the host relays them where they were, whatever their own game sends.
  const seen = [];
  const wasEmit = cat.session.emit;
  cat.session.emit = (type, ...args) => {
    if (type === 'state' && args[0].id === bId) seen.push(args[0].pos.x);
    return wasEmit(type, ...args);
  };
  const snap = (x) => P.encodeState({ id: 0, seq: Math.floor(x), t: performance.now(), pos: { x, y: 300, z: 0 }, quat: { w: 1 }, vel: { x: 50, y: 0, z: 0 }, game: 'flight', type: 'skylark' });
  bee.session.tick(performance.now(), snap(100));
  await untilT(() => seen.includes(100));
  H.freezeMs = REAL ? 2500 : 900;
  ok('freeze: an admin asks, the host freezes', aS.adminAct('freeze', bId));
  await untilT(() => bee.session.self.frozen && cat.session.players.get(bId).frozen);
  seen.length = 0;
  for (const x of [200, 300, 400]) {
    bee.session.tick(performance.now(), snap(x));
    await sleep(70);
  }
  await untilT(() => seen.length >= 2);
  ok('freeze: the frozen player’s own game is told (it holds them still), and everybody else sees them where they were frozen',
    bee.session.self.frozen && seen.length >= 2 && seen.every((x) => x === 100), seen.join(','));
  await untilT(() => !bee.session.self.frozen, REAL ? 8000 : 3000);
  seen.length = 0;
  bee.session.tick(performance.now(), snap(500));
  await untilT(() => seen.includes(500));
  ok('freeze: it lets go by itself after a while, and they move again for everybody', !bee.session.self.frozen && seen.includes(500) && !cat.session.players.get(bId).frozen);
  H.freezeMs = S.FREEZE_MS;
  aS.adminAct('freeze', bId);
  await untilT(() => bee.session.self.frozen);
  aS.adminAct('unfreeze', bId);
  await untilT(() => !bee.session.self.frozen);
  ok('unfreeze: an admin can let go sooner', !bee.session.self.frozen && !H.players.get(bId).frozenUntil);

  // Nothing to an admin, from anybody — the host itself included.
  ok('nobody mutes, freezes or kicks an admin: not another admin’s request, not the host',
    !H.adminAct('mute', admId, { admin: true, name: 'x' }) && !H.kick(admId, true) && !H.adminAct('kick', admId) && !H.players.get(admId).muted);

  // Kick: out, not re-forming, and kept out.
  const beeKey = bee.profile.key;
  ok('kick: in a lobby, where nobody else can, an admin can', aS.adminAct('kick', bId));
  await untilT(() => bee.left && bee.events.some((e) => e[0] === 'out'));
  const out = bee.events.find((e) => e[0] === 'out');
  ok('kick: the kicked player is out — told it was an admin, not re-forming the lobby round themselves', out && out[1] === 'kicked' && !bee.session && H.count === 3,
    out && out[1]);
  // (The same browser coming back: its key.)
  const again = new L.LobbyMember({
    n: 2, hash: lh, net: bee.net, makeSig: mkSig, profile: { name: 'Brave Otter', colour: P.COLOURS[1], key: beeKey }, place: () => ({ map: 'kestrel', game: 'flight' }),
    onEvent: () => {}, netOpts: { RTC }, stepMs: 300, enterGiveUpMs: REAL ? 8000 : 2500,
  });
  let againErr = null;
  try {
    await again.start();
  } catch (err) {
    againErr = err.code;
  }
  ok('kick: and kept out of this host’s lobby — the same browser is refused', againErr === 'kicked', againErr);
  again.leave();
  await untilT(() => H.count === 3);

  /* ---- the crown moves, and the admin is checked again ------------------- */
  // The admin goes and comes back, so it is behind Sunny Puffin in the line: she hosts next, and must check the admin herself.
  adm.leave();
  await untilT(() => H.count === 2);
  const adm2 = await member(2, 'Swift Falcon', { admin: adminKey });
  await untilT(() => adm2.session.self.admin);
  const catWas = cat.session;
  host.leave();
  await untilT(() => [adm2, cat].every((m) => m.session && !m.reforming) && [adm2, cat].some((m) => m.isHost), REAL ? 20000 : 6000);
  const newHost = [adm2, cat].find((m) => m.isHost);
  const other = [adm2, cat].find((m) => m !== newHost);
  await untilT(() => other.session && other.session.players.get(0) && (newHost === adm2 ? true : newHost.session.players.get(other.session.id)));
  ok('the crown follows the lobby: the host leaves, the next in line hosts, and everybody’s list has THEM as host now',
    !!newHost && other.session !== catWas && other.session.players.get(0).host === true && other.session.players.get(0).name === (newHost.isHost ? newHost.session.me.name : ''),
    `${newHost && newHost.profile.name} hosts`);
  if (newHost === cat) {
    await untilT(() => adm2.session.self.admin);
    ok('and the new host checks the admin for itself', adm2.session.self.admin === true && cat.session.players.get(adm2.session.id).admin === true);
  } else {
    ok('and an admin who is the new host is its own admin', adm2.session.me.admin === true);
  }

  /* ---- close ---------------------------------------------------------------- */
  const late = await member(2, 'Plucky Puffin');
  await untilT(() => late.session && late.session.welcomed);
  const removed = [];
  const hostM = [adm2, cat].find((m) => m.isHost);
  const wasHostEmit = hostM.emit;
  hostM.emit = (type, ...args) => {
    if (type === 'removed') removed.push(args[0]);
    return wasHostEmit(type, ...args);
  };
  const closer = adm2.isHost ? adm2.session.adminClose() : adm2.session.adminAct('close', -1);
  await untilT(() => late.left && removed.length);
  const lateOut = late.events.find((e) => e[0] === 'out');
  ok('close: an admin closes the lobby — everybody else is out, told it was closed, not re-forming it',
    closer && lateOut && lateOut[1] === 'shut' && removed.includes('shut'), `${lateOut && lateOut[1]}; host ${removed.join(',')}`);

  /* ---- a private match: past the lock, and through the directory ---------- */
  {
    const code = await S.claimCode({ makeSig: mkSig });
    const dir = await S.claimPdir({ makeSig: mkSig });
    const ph = new S.HostSession({ mode: 'code', profile: { name: 'Lucky Llama', colour: P.COLOURS[3], key: 'pkeypkeypkeypkeypkey' }, server: { name: 'x', map: 'kestrel', game: 'flight', code: code.code, slot: 0 } });
    ph.attach(new Net(code.sig, { RTC }));
    const dnet = new Net(dir.sig, { RTC });
    dnet.dirOnly = true;
    ph.attach(dnet);
    const pt = setInterval(() => ph.tick(performance.now()), 40);
    const join = async (target, name, adminK = null) => {
      const sig = mkSig();
      await sig.open(P.playerPeerId());
      const c = new S.ClientSession({ net: new Net(sig, { RTC }), target, profile: { name, colour: P.COLOURS[4], key: `${name.replace(/\W/g, '').toLowerCase()}keykeykey` }, admin: adminK });
      try {
        return { c, w: await c.start(), sig };
      } catch (err) {
        return { c, err, sig };
      }
    };
    ph.setLocked(true);
    const kid = await join(P.codeId(code.code), 'Trusty Toucan');
    const boss = await join(P.codeId(code.code), 'Radiant Robin', adminKey);
    ok('a locked private match: a friend with the code is told it is locked; an admin comes in anyway',
      kid.err && kid.err.code === 'locked' && boss.w && ph.players.get(boss.c.id).admin === true, `${kid.err && kid.err.code}; admin ${boss.w ? 'in' : boss.err.code}`);
    ph.setLocked(false);
    const snoop = await join(P.pdirId(dir.n), 'Zippy Zebra');
    const fake = await join(P.pdirId(dir.n), 'Groovy Gecko', { sign: async () => copied });
    const boss2 = await join(P.pdirId(dir.n), 'Snazzy Seal', adminKey);
    ok('the admins’ directory: an admin gets in without the code; anybody else, or a copied signature, is told it is private',
      snoop.err && snoop.err.code === 'private' && fake.err && fake.err.code === 'private' && boss2.w && ph.players.get(boss2.c.id).admin === true
      && boss2.w.server.priv === true && boss2.w.server.map === 'kestrel',
      `${snoop.err && snoop.err.code}, ${fake.err && fake.err.code}, admin ${boss2.w ? 'in' : boss2.err && boss2.err.code}`);
    const looker = mkSig();
    await looker.open(P.playerPeerId());
    const lnet = new Net(looker, { RTC });
    const { r, meta } = await lnet.pingInfo(P.pdirId(dir.n), 2500);
    const pw = new L.PrivateWatch({ net: lnet, everyMs: REAL ? 1500 : 80 });
    pw.start();
    await untilT(() => pw.places.every((x) => x.state !== 'looking'));
    ok('the directory answers with numbers only — how many, the most, which island — never the code, and the admin’s list finds it',
      r === 'here' && !JSON.stringify(meta).includes(code.code) && pw.found.length >= 1 && pw.found.some((x) => x.n === dir.n && x.players === 3 && x.mapName === 'Kestrel Island'),
      `${JSON.stringify(meta)}; found ${pw.found.map((x) => `${x.n}:${x.players}`).join(' ')}`);
    pw.stop();
    const info = lnet.connect(P.pdirId(dir.n), 'info');
    const infoWhy = await new Promise((res) => {
      info.onclose = (why) => res(why);
      setTimeout(() => res('open'), 3000);
    });
    ok('and nothing but a join is taken through it (no server-list details)', infoWhy === 'refused', infoWhy);
    clearInterval(pt);
    ph.close();
    await sleep(300);
    for (const x of [kid, boss, snoop, fake, boss2]) x.sig.close();
    looker.close();
    code.sig.close();
    dir.sig.close();
  }

  /* ---- an admin who hosts: its own powers, on its own game ---------------- */
  {
    const code = await S.claimCode({ makeSig: mkSig });
    const ah = new S.HostSession({ mode: 'code', admin: true, profile: { name: 'Keen Kestrel', colour: P.COLOURS[5], key: 'hkeyhkeyhkeyhkeyhkey' }, server: { name: 'x', map: 'kestrel', game: 'flight', code: code.code, slot: 0 } });
    ah.attach(new Net(code.sig, { RTC }));
    const tick = setInterval(() => ah.tick(performance.now()), 40);
    const sig = mkSig();
    await sig.open(P.playerPeerId());
    const ended = [];
    const kid = new S.ClientSession({ net: new Net(sig, { RTC }), target: P.codeId(code.code), profile: { name: 'Happy Hippo', colour: P.COLOURS[6], key: 'kkeykkeykkeykkeykkey' }, onEvent: (t, ...a) => { if (t === 'ended') ended.push(a); } });
    await kid.start();
    const plain = new S.HostSession({ mode: 'lobby', profile: { name: 'Lucky Lark', colour: P.COLOURS[1], key: 'lkeylkeylkeylkeylkey' }, server: { map: 'kestrel', game: 'flight', lobby: 1 } });
    ok('a host that is not an admin has no admin powers over its own lobby', plain.adminAct('mute', 1) === false && plain.adminClose() === false);
    ok('an admin who hosts mutes and freezes on its own game', ah.adminAct('mute', kid.id) && ah.adminAct('freeze', kid.id));
    await untilT(() => kid.self.muted && kid.self.frozen);
    ok('…and the player is told, like anybody’s', kid.self.muted && kid.self.frozen);
    ok('…and closes it: the player goes back to the lobby list (“shut”), not merely “closed”', ah.adminClose());
    await untilT(() => ended.length);
    ok('(closed)', ended[0] && ended[0][0] === 'shut', JSON.stringify(ended));
    clearInterval(tick);
    await sleep(300);
    sig.close();
    code.sig.close();
  }

  /*
   * ---- what the device keeps: checked when the game starts, not trusted ----
   * The owner's x and y are public (they are in admin.js). A host takes its
   * own word for being an admin, so a flag made up by hand — those x and y
   * with any d, pasted into localStorage — must not make a device an admin
   * in the games it hosts. The kept d has to work out to the kept x and y.
   */
  {
    const KEEP = 'islandsim.admin.v1';
    const store = new Map();
    const shim = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
    const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true, writable: true });
    const plant = (v) => store.set(KEEP, JSON.stringify(v));
    const owner = A.adminKeys()[0]; // the shipped key: its x and y are for anyone to read
    const madeUp = b64u(randomBytes(32));
    const testD = b64u(createHash('sha256').update(`island-flight-sim admin v1\n${TK.code.trim().toLowerCase()}`).digest());
    try {
      const fakes = [
        ['the owner’s x and y with a made-up d', { on: 1, x: owner.x, y: owner.y, d: madeUp }],
        ['the owner’s x and y with a real private number that is another key’s (the test key’s)', { on: 1, x: owner.x, y: owner.y, d: testD }],
        ['the owner’s x and y with d all zeros', { on: 1, x: owner.x, y: owner.y, d: 'A'.repeat(43) }],
        ['the owner’s x and y with d past the curve’s order', { on: 1, x: owner.x, y: owner.y, d: '_'.repeat(43) }],
        ['the test key’s x and y with a made-up d', { on: 1, x: TK.x, y: TK.y, d: madeUp }],
      ];
      const t0 = performance.now();
      const seen = fakes.map(([what, v]) => {
        plant(v);
        const k = A.AdminKey.load();
        return { what, refused: k === null, forgotten: !store.has(KEEP) };
      });
      const ms = (performance.now() - t0) / fakes.length;
      ok('a flag made up by hand — the owner’s public x and y copied out of admin.js, with any d — is not an admin when the game starts, and is forgotten',
        seen.every((r) => r.refused && r.forgotten), seen.filter((r) => !(r.refused && r.forgotten)).map((r) => r.what).join('; ') || `${fakes.length} kinds, ${ms.toFixed(1)} ms each`);
      ok('…nor is any admin key whose d is not its private half, however it was made',
        !new A.AdminKey(owner, madeUp).valid && !new A.AdminKey(owner, testD).valid && !new A.AdminKey({ x: TK.x, y: TK.y }, madeUp).valid && new A.AdminKey({ x: TK.x, y: TK.y }, testD).valid);

      // The real thing still keeps: the test key, saved as the code box saves it, loads again — and signs a proof a host accepts.
      store.clear();
      const real = await A.AdminKey.fromCode(TK.code);
      real.save();
      const t1 = performance.now();
      const kept = A.AdminKey.load();
      const loadMs = performance.now() - t1;
      const pt = A.proofText(A.nonce(), 'ifs-host-keep', 'ifs-p-keep');
      ok('a real admin key, kept by the code box, loads again with its d checked, and still answers a host',
        !!kept && kept.valid && store.has(KEEP) && (await A.verifyProof(pt, await kept.sign(pt))), `${loadMs.toFixed(1)} ms to check it`);

      // A device with a made-up flag hosts a lobby, as the game would run it: load() at install, adminNow() at every join.
      plant({ on: 1, x: owner.x, y: owner.y, d: madeUp });
      const loaded = A.AdminKey.load();
      const unchecked = new A.AdminKey(owner, madeUp); // even one built past load(): adminNow() asks .valid
      const adminNow = () => [loaded, unchecked].find((k) => k && k.valid) || null;
      const fh = await member(4, 'Keen Kestrel', { admin: adminNow });
      const kid = await member(4, 'Happy Hippo');
      await untilT(() => fh.session && fh.session.me && fh.session.players.size === 1 && kid.session && kid.session.welcomed && kid.session.players.get(0));
      const FH = fh.session;
      const kidId = kid.session.id;
      ok('a device with a made-up flag hosts a lobby: it wears the crown but no ADMIN badge, in its own list or the other player’s',
        FH.me && FH.me.host && !FH.me.admin && kid.session.players.get(0).host === true && !kid.session.players.get(0).admin && !kid.session.self.admin);
      const tries = { mute: FH.adminAct('mute', kidId), freeze: FH.adminAct('freeze', kidId), kick: FH.adminAct('kick', kidId), close: FH.adminClose() };
      await sleep(REAL ? 1200 : 300);
      ok('…and has no powers there: mute, freeze, kick and close all refused, and the other player is none of them',
        Object.values(tries).every((v) => v === false) && !kid.session.self.muted && !kid.session.self.frozen && !FH.closed && FH.players.size === 1, JSON.stringify(tries));
      fh.leave(true);
      kid.leave(true);
    } finally {
      store.clear();
      if (had) Object.defineProperty(globalThis, 'localStorage', had);
      else delete globalThis.localStorage;
    }
  }

  clearInterval(ticker);
  for (const m of everyone) {
    m.leave(true);
    if (m.lookSig) m.lookSig.close();
  }
  A.resetAdminKeys();
  ok('afterwards, only the shipped key again: the test key is not an admin key', A.adminKeys().length === 1 && !adminKey.valid);
}

/* Alone: against the fakes. */
if (import.meta.url === `file://${process.argv[1]}`) {
  global.document = { createElement: () => ({ getContext: () => null, style: {} }), body: { appendChild() {} } };
  const results = [];
  const ok = (name, pass, detail = '') => {
    results.push(!!pass);
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    return !!pass;
  };
  process.on('unhandledRejection', (err) => ok('no unhandled rejections', false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err));
  const P = await import('../../src/features/multiplayer/protocol.js');
  const S = await import('../../src/features/multiplayer/session.js');
  const L = await import('../../src/features/multiplayer/lobby.js');
  const { Signaling } = await import('../../src/features/multiplayer/signaling.js');
  const { Net } = await import('../../src/features/multiplayer/link.js');
  const { FakeSignalServer, makeFakeRTC, sleep, until } = await import('./multiplayer.fakes.js');
  const server = new FakeSignalServer();
  await adminTests({ P, S, L, Signaling, Net, backend: { url: 'wss://fake.test/peerjs', key: 'peerjs' }, WS: server.WebSocket, RTC: makeFakeRTC(), ok, sleep, until, REAL: false, server });
  const bad = results.filter((x) => !x).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
}
