/**
 * The owner's hour — for tests/features/multiplayer.mjs (which runs this with
 * its own signaling server and `ok`), or alone, against the fakes:
 *
 *   node tests/features/multiplayer.owner.mjs
 *
 * The owner's code is in no file of the game or of these tests. They use the
 * TEST owner key made for them (.claude/devtools/admin-keys/test-owner.json:
 * a test code and its public key), read when they run, which the game does
 * not accept until a test adds it (owner.js addOwnerKey). Without that file
 * the crypto half is skipped, and says so.
 *
 * What it proves, with the shipped owner.js, session.js and lobby.js:
 *   - what ships: one public key, the owner's (as in owner-public-key.json),
 *     and no private number or code; the test code and key are in no file of
 *     the game;
 *   - the scheme: the code makes the private number whose public key is the
 *     test key, by node's own crypto; the owner's label is not the admin's;
 *   - a pass: an hour long, signed by the owner key, for a fresh key made on
 *     the device; what is kept is the pass and that key — never the code,
 *     never the owner's private number;
 *   - wrong codes: "wrong", the same for every kind, and only three a minute
 *     (then even the right code waits);
 *   - the hour ends by itself: at exp the pass is wiped from memory and
 *     storage, signs nothing more, and Dev mode is told to go back to how it
 *     was; "End owner now" the same; a kept pass that ran out while the game
 *     was shut is wiped when it starts;
 *   - a copied or edited flag never makes an owner: its hour pushed on, the
 *     public x and y with any key, a pass "from" the owner's key signed by
 *     another, a genuine pass with another key's private half, a run-out
 *     pass — refused when the game starts, and refused at a host;
 *   - at a host, in a lobby: the host checks the pass and marks the owner;
 *     everybody sees the OWNER badge; the owner's powers work; a tampered
 *     client (a sniffed pass with its own signature, a replayed answer, an
 *     edited pass) gets nothing; the hour running out mid-lobby (by the
 *     HOST's clock) takes the powers and the badge away; "End owner now"
 *     mid-lobby does too, at once;
 *   - an owner who hosts: owner at once, and not after the hour; past the lock
 *     of a private match and in through the directory without the code.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash, createECDH, randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A key file from .claude/devtools/admin-keys — in this checkout, or the main one a worktree is inside. */
export function findKeyFile(name) {
  let dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (let i = 0; i < 8; i++) {
    const f = join(dir, '.claude', 'devtools', 'admin-keys', name);
    if (existsSync(f)) {
      try {
        return JSON.parse(readFileSync(f, 'utf8'));
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

export function findOwnerTestKey() {
  const k = findKeyFile('test-owner.json');
  return k && typeof k.code === 'string' && k.x && k.y ? k : null;
}

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}

export async function ownerTests(ctx) {
  const { P, S, L, Signaling, Net, backend, WS, RTC, ok, sleep, until, REAL } = ctx;
  const O = await import('../../src/features/multiplayer/owner.js');
  const A = await import('../../src/features/multiplayer/admin.js');
  const untilT = (fn, ms = 3000) => until(fn, REAL ? ms * 4 : ms);
  const mkSig = (token) => new Signaling(backend, { WebSocketImpl: WS, heartbeatMs: REAL ? 5000 : 50, ...(token ? { token } : {}) });
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const TK = findOwnerTestKey();
  const PUB = findKeyFile('owner-public-key.json');

  /* A localStorage for node, as the browser's. */
  const store = new Map();
  const shim = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true, writable: true });
  const KEEP = 'islandsim.owner.v1';
  const kept = () => (store.has(KEEP) ? JSON.parse(store.get(KEEP)) : null);

  try {
    /* ---- what ships ------------------------------------------------------ */
    {
      const src = readFileSync(join(ROOT, 'src', 'features', 'multiplayer', 'owner.js'), 'utf8');
      const keys = O.ownerKeys();
      const b64s = src.match(/'[A-Za-z0-9_-]{43}'/g) || [];
      ok('owner.js ships one public key — an x and a y, and no private number or code anywhere in it',
        keys.length === 1 && b64s.length === 2 && b64s.every((v) => v === `'${keys[0].x}'` || v === `'${keys[0].y}'`) && !/\bd\s*:\s*'/.test(src),
        `${keys.length} key(s), ${b64s.length} key values`);
      if (PUB) ok('…and it is the owner key made for it (owner-public-key.json), with the same label', keys[0].x === PUB.x && keys[0].y === PUB.y && PUB.scheme.includes('island-flight-sim owner v1'));
      if (TK) {
        const files = walk(join(ROOT, 'src')).concat([join(ROOT, 'index.html'), join(ROOT, 'sw.js')]).filter((f) => existsSync(f) && /\.(js|html|css|json)$/.test(f));
        const leaks = files.filter((f) => {
          const text = readFileSync(f, 'utf8');
          return text.includes(TK.code) || text.includes(TK.x) || text.includes(TK.y);
        });
        ok('the test owner code and the test owner key are in no file of the game', leaks.length === 0, leaks.length ? leaks.join(', ') : `${files.length} files`);
      }
    }

    if (!TK) {
      ok('the owner crypto checks need .claude/devtools/admin-keys/test-owner.json — not found, skipped', true);
      return;
    }

    /* ---- the scheme -------------------------------------------------------- */
    const ownerD = createHash('sha256').update(`island-flight-sim owner v1\n${TK.code.trim().toLowerCase()}`).digest();
    {
      ok('the test code is not the owner’s until its key is added', O.OwnerPass.fromCode(TK.code) === null);
      ok('addOwnerKey takes an x and a y only', O.addOwnerKey({ x: TK.x, y: TK.y }) && !O.addOwnerKey({ x: 'short', y: TK.y }) && O.ownerKeys().length === 2);
      const ec = createECDH('prime256v1');
      ec.setPrivateKey(ownerD);
      const point = ec.getPublicKey();
      ok('the scheme: the code makes the private number whose public key is the test owner key (checked with node’s own crypto)',
        b64u(point.subarray(1, 33)) === TK.x && b64u(point.subarray(33, 65)) === TK.y);
      const asAdmin = createHash('sha256').update(`island-flight-sim admin v1\n${TK.code.trim().toLowerCase()}`).digest();
      ok('the owner’s label is its own: the same code under the admin’s label is another key, and is no admin', O.OWNER_SCHEME !== A.ADMIN_SCHEME && !asAdmin.equals(ownerD) && (await A.AdminKey.fromCode(TK.code)) === null);
      ok('deriveOwnerD is that number', b64u(O.deriveOwnerD(`  ${TK.code.toUpperCase()} `)) === b64u(ownerD));
    }

    /* ---- a pass ------------------------------------------------------------- */
    {
      const t = Date.now();
      const pass = O.OwnerPass.fromCode(TK.code, { now: t });
      const loud = O.OwnerPass.fromCode(`  ${TK.code.toUpperCase()}  `, { now: t });
      ok('the code makes a pass: an hour long from now, for the owner key, spaces and capitals as typed',
        !!pass && !!loud && pass.ox === TK.x && pass.oy === TK.y && pass.iat === t && pass.exp - pass.iat === O.OWNER_MS && pass.live(t) && !pass.live(t + O.OWNER_MS));
      ok('…for a fresh key each time it is made — never the owner key itself', pass.sx !== loud.sx && pass.sx !== TK.x && pass._sd !== b64u(ownerD));
      const wrongs = [TK.code.slice(0, -1), `${TK.code}x`, TK.code.replace(/[a-z]/, (c) => (c === 'a' ? 'b' : 'a')), '', '   ', 'x'.repeat(300), null];
      ok('a wrong code makes nothing — the same null whatever is wrong with it', wrongs.every((w) => O.OwnerPass.fromCode(w) === null));
      pass.save();
      const k = kept();
      const raw = store.get(KEEP);
      ok('what the device keeps is the pass and its own key — never the code, never the owner’s private number',
        Object.keys(k).sort().join(',') === 'c,dev,exp,iat,on,ox,oy,sd,sx,sy' && !raw.includes(TK.code) && !raw.includes(b64u(ownerD)) && !raw.toLowerCase().includes(TK.code.toLowerCase()),
        Object.keys(k).sort().join(','));
      const n = A.nonce();
      const text = O.ownerProofText(n, 'ifs-host-a', 'ifs-p-own');
      const ans = await pass.answer(text);
      const checks = [
        O.verifyOwnerProof(text, ans.o, ans.c),
        O.verifyOwnerProof(O.ownerProofText(A.nonce(), 'ifs-host-a', 'ifs-p-own'), ans.o, ans.c),
        O.verifyOwnerProof(O.ownerProofText(n, 'ifs-host-b', 'ifs-p-own'), ans.o, ans.c),
        O.verifyOwnerProof(O.ownerProofText(n, 'ifs-host-a', 'ifs-p-other'), ans.o, ans.c),
        O.verifyOwnerProof(A.proofText(n, 'ifs-host-a', 'ifs-p-own'), ans.o, ans.c),
        O.verifyOwnerProof(text, ans.o, { ...ans.c, exp: ans.c.exp + 1 }),
        O.verifyOwnerProof(text, 'A'.repeat(86), ans.c),
        O.verifyOwnerProof(text, ans.o, null),
        O.verifyOwnerProof(text, ans.o, ans.c, ans.c.exp),
      ];
      ok('a host’s check: good for its own nonce, host and player only — not another nonce, host or player, not as an admin’s words, not with the hour edited, junk, or no pass, and not once the hour is up',
        checks[0] === pass.exp && checks.slice(1).every((c) => c === 0), checks.map((c) => (c ? 'yes' : 'no')).join(','));
      ok('…and an owner’s answer is no admin’s: verifyProof says no to it', !(await A.verifyProof(text, ans.o)));
      store.clear();
    }

    /* ---- this device: wrong codes, the hour, the end ------------------------ */
    {
      const own = O.owner;
      let clock = 1_800_000_000_000;
      own.now = () => clock;
      const heard = [];
      const off = own.on((e) => heard.push({ on: e.on, why: e.why, devBefore: e.devBefore }));
      own.end('ended');
      O.clearTries();
      heard.length = 0;
      const w = [own.tryCode('nope'), own.tryCode(`${TK.code}!`), own.tryCode('')];
      const fourth = own.tryCode(TK.code);
      ok('wrong codes: “wrong”, the same for each; three a minute — then even the right code waits',
        w.every((r) => !r.ok && r.why === 'wrong') && !fourth.ok && fourth.why === 'wait' && fourth.waitMs > 50_000 && !own.active, JSON.stringify(fourth));
      clock += 30_000;
      const still = own.tryCode(TK.code);
      clock += 31_000;
      const right = own.tryCode(TK.code, false);
      ok('…a minute after the first, the right code works, and the tries are forgotten',
        !still.ok && still.why === 'wait' && right.ok && right.until === clock + O.OWNER_MS && own.active && heard.length === 1 && heard[0].on && !store.has('islandsim.owner.tries.v1'));
      const pass = own.current();
      clock += O.OWNER_MS - 1000;
      own.check();
      ok('an hour less a second later: still the owner', own.active && own.current() === pass && !!kept());
      // A second code typed during the hour: a new hour, and Dev mode still goes back to how it was before the FIRST.
      const again = own.tryCode(TK.code, true);
      ok('the code again during the hour: a new hour from now, and what Dev mode goes back to is still what it was before the first', again.ok && own.current().devBefore === false && own.until === clock + O.OWNER_MS);
      const p2 = own.current();
      clock += O.OWNER_MS;
      ok('the hour is up: no longer the owner at once, even before the timer runs', !own.active && own.current() === null);
      own.check();
      ok('…and it is wiped: nothing kept, nothing in memory signs, and Dev mode is told to go back to how it was',
        own.pass === null && !kept() && p2._sd === null && (await p2.answer('x')) === null && heard.at(-1).on === false && heard.at(-1).why === 'expired' && heard.at(-1).devBefore === false,
        JSON.stringify(heard.at(-1)));
      // End owner now.
      own.tryCode(TK.code, true);
      const p3 = own.current();
      const ended = own.end('ended');
      ok('End owner now: wiped the same way, and Dev mode goes back to on, as it was', ended && !own.active && !kept() && p3._sd === null && heard.at(-1).why === 'ended' && heard.at(-1).devBefore === true);
      // An hour that ran out while the game was shut.
      own.tryCode(TK.code, false);
      own.pass.wipe();
      own.pass = null;
      clock += O.OWNER_MS + 5;
      const r = own.load();
      ok('a kept hour that ran out while the game was shut is wiped when it starts, and says what Dev mode was', r.ended && r.devBefore === false && !r.pass && !kept() && !own.active);
      // A kept hour still running loads again.
      own.tryCode(TK.code, false);
      own.pass = null;
      clock += 60_000;
      const r2 = own.load();
      ok('a kept hour still running loads again — checked, the pass and its key — and is the owner', !!r2.pass && own.active && own.current().left(clock) === O.OWNER_MS - 60_000);
      own.end('ended');
      off();
      own.now = () => Date.now();
    }

    /* ---- copied or edited flags ---------------------------------------------- */
    {
      const now = Date.now();
      const real = O.OwnerPass.fromCode(TK.code, { now });
      real.save();
      const good = kept();
      const shipped = O.ownerKeys()[0];
      const madeUp = b64u(randomBytes(32));
      const other = O.OwnerPass.fromCode(TK.code, { now }); // a real pass, another key
      const fakes = [
        ['its hour pushed on (exp edited)', { ...good, exp: good.exp + O.OWNER_MS }],
        ['its start pulled back (iat edited)', { ...good, iat: good.iat - 1000 }],
        ['the shipped owner’s public x and y, a made-up key and signature', { on: 1, ox: shipped.x, oy: shipped.y, sx: good.sx, sy: good.sy, iat: now, exp: now + 1000, c: 'A'.repeat(86), sd: madeUp, dev: 0 }],
        ['a pass that says it is the shipped owner key’s, signed by another', { ...good, ox: shipped.x, oy: shipped.y }],
        ['a genuine pass with a made-up private key', { ...good, sd: madeUp }],
        ['a genuine pass with another pass’s private key', { ...good, sd: other._sd }],
        ['a genuine pass with the owner’s private number as its key', { ...good, sd: b64u(ownerD) }],
        ['junk', 'not json'],
      ];
      const seen = fakes.map(([what, v]) => {
        store.set(KEEP, typeof v === 'string' ? v : JSON.stringify(v));
        const r = O.OwnerPass.load(now + 1000);
        return { what, refused: !r.pass, wiped: !store.has(KEEP) };
      });
      ok('a copied or edited flag is not the owner when the game starts, and is wiped',
        seen.every((r) => r.refused && r.wiped), seen.filter((r) => !(r.refused && r.wiped)).map((r) => r.what).join('; ') || `${fakes.length} kinds`);
      store.set(KEEP, JSON.stringify(good));
      const back = O.OwnerPass.load(now + 1000);
      ok('…the genuine one, as kept, still loads', !!back.pass && back.pass.live(now + 1000));
      // At a host: the edited passes, with a signature their own key really makes (as a tampered client could).
      const text = O.ownerProofText(A.nonce(), 'ifs-host-x', 'ifs-p-x');
      const ans = await real.answer(text);
      const hostSays = [
        O.verifyOwnerProof(text, ans.o, { ...ans.c, exp: ans.c.exp + O.OWNER_MS }),
        O.verifyOwnerProof(text, ans.o, { ...ans.c, ox: shipped.x, oy: shipped.y }),
        O.verifyOwnerProof(text, ans.o, ans.c, ans.c.exp + 1),
        O.verifyOwnerProof(text, ans.o, ans.c, ans.c.iat - O.CLOCK_SLACK_MS - 1000),
      ];
      ok('at a host: an edited hour, another owner key’s name, a run-out pass, a pass from the future — all refused',
        hostSays.every((x) => x === 0) && O.verifyOwnerProof(text, ans.o, ans.c) === real.exp, hostSays.join(','));
      // A pass longer than an hour, properly signed by the owner key (only the code could make it): still refused.
      const { sign } = await import('../../src/features/multiplayer/p256.js');
      const long = { ...ans.c, exp: ans.c.iat + O.OWNER_MS + 60_000 };
      long.c = A.b64url(sign(ownerD, new TextEncoder().encode(O.passText(long))));
      ok('…and even a pass the owner key really signed is refused if it is longer than an hour', O.verifyOwnerProof(text, ans.o, long) === 0 && O.verifyOwnerProof(text, ans.o, ans.c) > 0);
      store.clear();
    }

    /* ---- in a lobby ------------------------------------------------------------ */
    const pass = O.OwnerPass.fromCode(TK.code);
    const lh = REAL ? P.sha256Hex(`owner-${Math.random()}-${Date.now()}`).slice(0, 12) : P.netHashFor('192.0.2.78');
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
        n, hash: lh, net, makeSig: mkSig, profile: { name, colour: P.COLOURS[everyone.length % 8], key: `ok-${everyone.length}-${Math.random().toString(36).slice(2, 8)}` },
        place: () => ({ map: 'kestrel', game: 'flight' }), onEvent: (...e) => events.push(e), netOpts: { RTC }, stepMs: REAL ? 1500 : 300, ...extra,
      });
      m.events = events;
      m.lookSig = sig;
      everyone.push(m);
      await m.start();
      return m;
    }
    try {
      const host = await member(2, 'Kind Koala');
      const boss = await member(2, 'Swift Falcon', { owner: () => (pass.live() ? pass : null) });
      const kid = await member(2, 'Brave Otter');
      const H = host.session;
      await untilT(() => kid.session.players.size === 2 && boss.session.self.owner);
      const bId = boss.session.id;
      const kId = kid.session.id;
      ok('a lobby’s host checks the owner’s pass and marks them — the owner, with an admin’s powers, until the pass’s hour is up',
        H.players.get(bId).ownerUntil === pass.exp && H.isOwner(H.players.get(bId)) && H.hasPowers(H.players.get(bId)) && !H.players.get(kId).ownerUntil && !H.players.get(bId).admin);
      ok('everybody sees the OWNER badge on them (the host’s list says so), and the owner’s own game knows the host checked',
        kid.session.players.get(bId).owner === true && kid.session.players.get(bId).admin === true && boss.session.self.owner && boss.session.self.admin && !kid.session.self.owner);

      // Tampered clients.
      let sniffed = null;
      const sniff = { answer: async (text) => { sniffed = await pass.answer(text); return sniffed; } };
      const probe = await member(3, 'Jolly Penguin');
      const copy = await member(3, 'Clever Koala', { owner: sniff });
      await untilT(() => copy.session && copy.session.self.owner);
      probe.leave();
      copy.leave();
      const liar = async (name, answer) => member(2, name, { owner: { answer } });
      const ownSig = O.OwnerPass.fromCode(TK.code); // a key the liar holds, but no pass of its own for it
      const liars = [
        await liar('Mighty Moose', async () => ({ o: 'A'.repeat(86), c: pass.cred() })),
        await liar('Gentle Lark', async () => sniffed),
        await liar('Happy Hedgehog', async (text) => ({ o: (await ownSig.answer(text)).o, c: pass.cred() })),
        await liar('Sunny Puffin', async (text) => { const a = await pass.answer(text); return { o: a.o, c: { ...a.c, exp: a.c.exp + O.OWNER_MS } }; }),
      ];
      await untilT(() => liars.every((m) => m.session && m.session.welcomed));
      ok('a tampered client — junk, a replayed answer, a sniffed pass with its own signature, the real pass with its hour edited — is let in as anybody, not as the owner',
        liars.every((m) => !m.session.self.owner && !m.session.self.admin && !H.hasPowers(H.players.get(m.session.id))), liars.map((m) => `${m.profile.name}:${H.players.get(m.session.id).ownerUntil}`).join(' '));
      const sneaky = liars[0].session;
      sneaky.link.send({ t: 'prove', s: '', o: sniffed.o, c: sniffed.c });
      for (const op of ['kick', 'mute', 'freeze', 'close']) sneaky.link.send({ t: 'adm', op, id: kId });
      await sleep(300);
      ok('…and what it asks for, the host does none of', !H.closed && H.players.has(kId) && !H.players.get(kId).muted && !H.players.get(kId).frozenUntil && !H.hasPowers(H.players.get(sneaky.id)));
      for (const m of liars) m.leave();
      await untilT(() => H.players.size === 2);

      // The powers.
      ok('the owner’s powers: mute', boss.session.adminAct('mute', kId));
      await untilT(() => kid.session.self.muted);
      boss.session.adminAct('unmute', kId);
      await untilT(() => !kid.session.self.muted);
      ok('…and nobody mutes, freezes or kicks the owner — not the host, not an admin', !H.adminAct('mute', bId, { admin: true, name: 'x' }) && !H.kick(bId, true) && !H.players.get(bId).muted);

      // The hour runs out mid-lobby, by the host's clock (whatever the owner's device says).
      const realWall = H.wall;
      H.wall = () => pass.exp + 1000;
      await untilT(() => !kid.session.players.get(bId).owner && !boss.session.self.owner);
      const after = { kidSees: kid.session.players.get(bId), self: boss.session.self, host: H.players.get(bId) };
      ok('the hour runs out mid-lobby by the host’s clock: the OWNER badge goes, for everybody and for the owner',
        !after.kidSees.owner && !after.kidSees.admin && !after.self.owner && !after.self.admin && after.host.ownerUntil === 0, JSON.stringify(after.self));
      boss.session.link.send({ t: 'adm', op: 'mute', id: kId });
      await sleep(250);
      ok('…and the powers: the host does nothing it asks', !H.players.get(kId).muted && !H.hasPowers(H.players.get(bId)));
      H.wall = realWall;
      boss.leave();
      await untilT(() => H.players.size === 1);

      // "End owner now" mid-lobby: the host is told, and it all goes at once.
      const boss2 = await member(2, 'Swift Falcon', { owner: () => (pass.live() ? pass : null) });
      await untilT(() => boss2.session.self.owner && kid.session.players.get(boss2.session.id) && kid.session.players.get(boss2.session.id).owner);
      const t0 = performance.now();
      boss2.session.ownerOff();
      await untilT(() => !kid.session.players.get(boss2.session.id).owner && !boss2.session.self.owner);
      ok('End owner now mid-lobby: the host is told, and the badge and the powers go for everybody at once',
        !H.hasPowers(H.players.get(boss2.session.id)) && !kid.session.players.get(boss2.session.id).owner, `${Math.round(performance.now() - t0)} ms`);
      boss2.leave();
      host.leave();
      kid.leave();

      /* ---- an owner who hosts, and private matches ---------------------------- */
      {
        const now = Date.now();
        const hs = new S.HostSession({ mode: 'lobby', ownerUntil: pass.exp, profile: { name: 'Keen Kestrel', colour: P.COLOURS[5], key: 'hkeyhkeyhkeyhkeyhkey' }, server: { map: 'kestrel', game: 'flight', lobby: 3 } });
        const stale = new S.HostSession({ mode: 'lobby', ownerUntil: now - 1, profile: { name: 'Lucky Lark', colour: P.COLOURS[1], key: 'lkeylkeylkeylkeylkey' }, server: { map: 'kestrel', game: 'flight', lobby: 4 } });
        ok('an owner who hosts is the owner there at once (the badge in its roster); one whose hour is over is not, and has no powers',
          hs.isOwner(hs.me) && hs.roster()[0].own === 1 && hs.roster()[0].adm === 1 && !stale.isOwner(stale.me) && !stale.roster()[0].own && stale.adminClose() === false);
        hs.setOwner(0);
        ok('…and when its hour ends (End owner now) it is not, at once', !hs.isOwner(hs.me) && !hs.roster()[0].own && hs.adminClose() === false);
        hs.close();
        stale.close();
      }
      {
        const code = await S.claimCode({ makeSig: mkSig });
        const dir = await S.claimPdir({ makeSig: mkSig });
        const ph = new S.HostSession({ mode: 'code', profile: { name: 'Lucky Llama', colour: P.COLOURS[3], key: 'pkeypkeypkeypkeypkey' }, server: { name: 'x', map: 'kestrel', game: 'flight', code: code.code, slot: 0 } });
        ph.attach(new Net(code.sig, { RTC }));
        const dnet = new Net(dir.sig, { RTC });
        dnet.dirOnly = true;
        ph.attach(dnet);
        const pt = setInterval(() => ph.tick(performance.now()), 40);
        const sigs = [];
        const join = async (target, name, ownerP = null) => {
          const sig = mkSig();
          sigs.push(sig);
          await sig.open(P.playerPeerId());
          const c = new S.ClientSession({ net: new Net(sig, { RTC }), target, profile: { name, colour: P.COLOURS[4], key: `${name.replace(/\W/g, '').toLowerCase()}keykeykey` }, owner: ownerP });
          try {
            return { c, w: await c.start() };
          } catch (err) {
            return { c, err };
          }
        };
        ph.setLocked(true);
        const friend = await join(P.codeId(code.code), 'Trusty Toucan');
        const me = await join(P.codeId(code.code), 'Radiant Robin', pass);
        ok('a locked private match: a friend with the code is told it is locked; the owner comes in anyway',
          friend.err && friend.err.code === 'locked' && me.w && ph.isOwner(ph.players.get(me.c.id)), `${friend.err && friend.err.code}; owner ${me.w ? 'in' : me.err.code}`);
        ph.setLocked(false);
        const snoop = await join(P.pdirId(dir.n), 'Zippy Zebra');
        const me2 = await join(P.pdirId(dir.n), 'Snazzy Seal', pass);
        const expired = O.OwnerPass.fromCode(TK.code, { now: Date.now() - O.OWNER_MS - 1000 });
        const late = await join(P.pdirId(dir.n), 'Groovy Gecko', { answer: async (text) => ({ o: A.b64url((await import('../../src/features/multiplayer/p256.js')).sign(A.unb64url(expired._sd), new TextEncoder().encode(text))), c: expired.cred() }) });
        ok('the admins’ directory: the owner gets in without the code; anybody else — and a run-out pass — is told it is private',
          snoop.err && snoop.err.code === 'private' && me2.w && ph.isOwner(ph.players.get(me2.c.id)) && late.err && late.err.code === 'private',
          `${snoop.err && snoop.err.code}, owner ${me2.w ? 'in' : me2.err && me2.err.code}, run-out ${late.err ? late.err.code : 'in'}`);
        clearInterval(pt);
        ph.close();
        await sleep(300);
        for (const s of sigs) s.close();
        code.sig.close();
        dir.sig.close();
      }
    } finally {
      clearInterval(ticker);
      for (const m of everyone) {
        m.leave(true);
        if (m.lookSig) m.lookSig.close();
      }
    }
    O.resetOwnerKeys();
    ok('afterwards, only the shipped owner key again: the test pass is no owner’s', O.ownerKeys().length === 1 && !pass.live() && O.verifyOwnerProof('x', 'A'.repeat(86), pass.cred()) === 0);
  } finally {
    O.owner.end('ended');
    O.clearTries();
    store.clear();
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
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
  await ownerTests({ P, S, L, Signaling, Net, backend: { url: 'wss://fake.test/peerjs', key: 'peerjs' }, WS: server.WebSocket, RTC: makeFakeRTC(), ok, sleep, until, REAL: false, server });
  const bad = results.filter((x) => !x).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
}
