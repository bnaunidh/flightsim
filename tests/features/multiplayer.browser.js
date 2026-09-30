/**
 * Multiplayer checks that fit in one tab — run by tests/selftest.js through
 * tests/features/index.js, or by hand:
 *
 *   const { check } = await import('/tests/features/multiplayer.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p, d }); return p; } };
 *   await check(window.__sim, r, console.log);
 *
 * Nothing here touches the internet. The signaling server is the fake from
 * multiplayer.fakes.js (it behaves the way the public one was measured to);
 * the WebRTC connections are REAL, tab to itself, so the browser's own data
 * channels carry the snapshots and the chat.
 *
 * Two tabs, five players and the public server are the playtest's job, not
 * this file's.
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000, step = 25) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await wait(step);
  }
  return fn();
}

/** ROT13, so the codes the fourth review got through are not spelt out in this file. */
const r13 = (s) => s.replace(/[a-z]/gi, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); });

export async function check(sim, r, say = () => {}) {
  const ext = await import('../../src/game/extensions.js');
  const mpMod = await import('../../src/features/multiplayer.js');
  const P = await import('../../src/features/multiplayer/protocol.js');
  const S = await import('../../src/features/multiplayer/session.js');
  const { Net, candidateAllowed } = await import('../../src/features/multiplayer/link.js');
  const { Signaling } = await import('../../src/features/multiplayer/signaling.js');
  const { FakeSignalServer } = await import('./multiplayer.fakes.js');
  const mp = mpMod.multiplayer;

  const status = ext.extStatus().find((e) => e.id === 'multiplayer');
  r.ok('multiplayer: registered with the plug-in layer and live', status && status.live, JSON.stringify(status));
  r.ok('multiplayer: Dev mode offers the lobbies and the older server list', ['Multiplayer lobbies', 'Multiplayer servers'].every((label) => ext.extDevActions().some((a) => a.ext === 'multiplayer' && a.label === label)));
  r.ok('multiplayer: openMultiplayer is exported for the main menu', typeof mpMod.openMultiplayer === 'function' && typeof mpMod.openServerList === 'function' && typeof mpMod.openLobbies === 'function');
  // Part 3b: the hangar's code box offers a code to multiplayer first (the admin code); any other code is the hangar's, as before.
  {
    const A = await import('../../src/features/multiplayer/admin.js');
    const box = sim.menus && sim.menus.screens && sim.menus.screens.hangar;
    const input = box && box.querySelector('[data-code]');
    const msg = box && box.querySelector('[data-code-msg]');
    let said = null;
    if (input && msg) {
      const was = msg.textContent;
      input.value = 'not-an-admin-code-or-any-code';
      box.querySelector('[data-redeem]').click();
      for (let i = 0; i < 100 && msg.textContent === was; i++) await new Promise((res) => setTimeout(res, 20));
      said = msg.textContent;
      msg.textContent = was;
      input.value = '';
    }
    r.ok('multiplayer: a wrong code in the hangar’s box is not admin, and is answered as any wrong code is',
      said === 'That code does not work' && !mp.isAdmin && A.adminKeys().length === 1 && A.adminCrypto() && Number(input && input.maxLength) >= 64, said);
    // A made-up flag: the owner's public x and y (in admin.js) with a random d. Not an admin when the game starts, and forgotten.
    // Whatever this browser kept before is put back, so a real admin running the self-test stays one.
    const KEEP = 'islandsim.admin.v1';
    let before = null;
    let seen = null;
    try {
      before = localStorage.getItem(KEEP);
      const d = new Uint8Array(32);
      crypto.getRandomValues(d);
      const owner = A.adminKeys()[0];
      localStorage.setItem(KEEP, JSON.stringify({ on: 1, x: owner.x, y: owner.y, d: A.b64url(d) }));
      const t0 = performance.now();
      const k = A.AdminKey.load();
      seen = { refused: k === null, forgotten: localStorage.getItem(KEEP) === null, ms: performance.now() - t0 };
    } catch (e) {
      seen = null; // no localStorage here: nothing can be kept, so nothing to fake
    } finally {
      try {
        if (before === null) localStorage.removeItem(KEEP);
        else localStorage.setItem(KEEP, before);
      } catch (e) { /* no localStorage */ }
    }
    r.ok('multiplayer: a made-up admin flag in localStorage (the owner’s public key, any d) is not an admin, and is forgotten',
      !seen || (seen.refused && seen.forgotten), seen ? `${seen.ms.toFixed(1)} ms to check it` : 'no localStorage');
  }

  if (typeof RTCPeerConnection !== 'function') {
    r.ok('multiplayer: this browser has WebRTC', false, 'no RTCPeerConnection');
    return;
  }

  // Keep whatever profile this browser had.
  let savedProfile = null;
  try {
    savedProfile = localStorage.getItem('islandsim.multiplayer.v1');
  } catch (e) {
    savedProfile = null;
  }
  const wasScreen = sim.menus && sim.menus.current;
  const server = new FakeSignalServer();
  const backend = { id: 'fake', url: 'wss://fake.invalid/peerjs', key: 'peerjs', label: 'the test server' };
  const hash = 'c0ffee123456';
  // Every candidate this browser's real WebRTC stack hands to signaling, with who sent it and to whom.
  const candidates = [];
  const BaseWS = server.WebSocket;
  class SpyWS extends BaseWS {
    send(d) {
      try {
        const m = JSON.parse(d);
        if (m.type === 'CANDIDATE') candidates.push({ from: this.id, dst: m.dst, c: m.payload && m.payload.candidate && m.payload.candidate.candidate });
      } catch (e) {
        /* not ours to read */
      }
      return super.send(d);
    }
  }
  const makeSig = () => new Signaling(backend, { WebSocketImpl: SpyWS });
  const cleanups = [];
  let profileBefore = null;

  /*
   * Keep the tab's timers running while this is checked.
   *
   * The fake server passes every note on a zero-delay timer, and a tab that
   * has been hidden for five minutes gets one timer a MINUTE — the first run
   * of this file in a hidden pane took 28 s and timed out three connections
   * because of it. Chrome does not throttle a page with a live WebRTC
   * connection, so one is held open, tab to itself, until the checks finish.
   * (That exemption is also why a host's tab in the background keeps relaying.)
   */
  const awake = [new RTCPeerConnection(), new RTCPeerConnection()];
  cleanups.push(() => awake.forEach((pc) => pc.close()));
  {
    const [a, b] = awake;
    a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
    b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});
    a.createDataChannel('awake', { negotiated: true, id: 0 });
    b.createDataChannel('awake', { negotiated: true, id: 0 });
    const o = await a.createOffer();
    await a.setLocalDescription(o);
    await b.setRemoteDescription(o);
    const an = await b.createAnswer();
    await b.setLocalDescription(an);
    await a.setRemoteDescription(an);
    await until(() => a.connectionState === 'connected', 5000);
  }

  try {
    mp.configure({ backend, hash, WebSocketImpl: SpyWS });

    /* ---- the screen ---- */
    mpMod.openServerList(sim);
    profileBefore = { ...mp.profile };
    const el = document.querySelector('[data-screen="multiplayer"]');
    r.ok('multiplayer: the screen opens as a menu screen', el && !el.hidden && (!sim.menus || sim.menus.current === 'multiplayer'));
    r.ok('multiplayer: it shows exactly five server slots', el && el.querySelectorAll('[data-mp-slot]').length === 5);
    {
      /*
       * No free text: the only box to type in is the join code. What is typed
       * there is shown to nobody else, and is read only as two list words and
       * a list number; the code that IS shown to everybody in a server (badge,
       * player list, pause list) is only ever exactly that — see "a modified
       * host's code" below and in the node test.
       */
      const typed = [...el.querySelectorAll('input, textarea, [contenteditable]')].map((x) => x.dataset.mpCode !== undefined ? 'code' : x.outerHTML.slice(0, 60));
      const pickers = ['adj', 'noun', 'num'].map((k) => el.querySelector(`[data-mp-${k}]`));
      r.ok('multiplayer: no name box — a call sign, a dice, pickers for its two words and a number, and eight colours',
        typed.length === 1 && typed[0] === 'code' && el.querySelector('[data-mp-callsign]').textContent === mp.profile.name && !!P.parseCallSign(mp.profile.name)
        && !!el.querySelector('[data-mp-roll]') && pickers[0].options.length === P.CALLSIGN_ADJECTIVES.length && pickers[1].options.length === P.CALLSIGN_NOUNS.length
        && pickers[2].options.length === P.CALLSIGN_NUMBERS.length + 1 && el.querySelectorAll('[data-mp-colour]').length === 8,
        `"${mp.profile.name}"; text boxes: ${typed.join(', ')}`);
    }
    {
      // The code box: words and a number in any case; anything not from the lists is refused, with the example, and nothing is joined.
      const box = el.querySelector('[data-mp-code]');
      const type = (v) => {
        box.value = v;
        box.dispatchEvent(new Event('input', { bubbles: true }));
        return box.value;
      };
      const cleaned = type('Maple Kite 42!');
      const lookalike = type('m\u0430ple kite 42');
      type(r13('CUPXE'));
      el.querySelector('[data-mp-join-code]').click();
      const said = (el.querySelector('[data-mp-status]') || {}).textContent || '';
      type('');
      r.ok('multiplayer: the code box takes words and a number in any case, drops a look-alike letter, and refuses a code not from the lists',
        cleaned === 'maple kite 42' && lookalike === 'mple kite 42' && box.placeholder === P.CODE_EXAMPLE && /two words and a number, like maple-kite-42/.test(said) && mp.role === null && !mp.busy && !mp.client,
        `"${cleaned}", "${lookalike}"; ${said}`);
      mp.screen.status('');
    }
    await until(() => mp.prober && mp.prober.slots.every((s) => s.state === 'empty'));
    r.ok('multiplayer: an empty network lists five empty slots', el.querySelectorAll('.mp-slot.is-empty').length === 5 && /Empty — host here/.test(el.textContent),
      mp.prober ? mp.prober.slots.map((s) => s.state).join(',') : 'no prober');
    {
      const shownName = () => el.querySelector('[data-mp-callsign]').textContent;
      const stored = () => {
        try {
          return JSON.parse(localStorage.getItem('islandsim.multiplayer.v1') || '{}');
        } catch (e) {
          return {};
        }
      };
      // The dice.
      const before = mp.profile.name;
      el.querySelector('[data-mp-roll]').click();
      const rolled = mp.profile.name;
      r.ok('multiplayer: New name rolls a different call sign, shows it and remembers it', rolled !== before && !!P.parseCallSign(rolled) && shownName() === rolled && stored().name === rolled,
        `"${before}" → "${rolled}"`);
      // The pickers.
      const set = (k, v) => {
        const sel = el.querySelector(`[data-mp-${k}]`);
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('adj', 'Brave');
      set('noun', 'Otter');
      set('num', '7');
      r.ok('multiplayer: the pickers build the call sign word by word', mp.profile.name === 'Brave Otter 7' && shownName() === 'Brave Otter 7' && stored().name === 'Brave Otter 7', mp.profile.name);
      set('num', '0');
      r.ok('multiplayer: and the number is optional', mp.profile.name === 'Brave Otter', mp.profile.name);
      // Anything that is not from the lists is not taken, whoever calls setProfile.
      const tries = ['fuuuck', 'f*ck', 'fυck', 'Brave Οtter', 'Brave Otter 69', 'Hana'].map((name) => mp.setProfile({ name }));
      r.ok('multiplayer: a name not built from the lists is refused and not saved', tries.every((t) => !t.ok && t.why === 'list') && mp.profile.name === 'Brave Otter' && stored().name === 'Brave Otter',
        tries.map((t) => t.why).join(','));
      // The server name: seen by the whole school's connection, so from the lists and never the child's name.
      const sv = () => el.querySelector('[data-mp-server]').textContent;
      const sBefore = sv();
      el.querySelector('[data-mp-server-roll]').click();
      const sAfter = sv();
      r.ok('multiplayer: the server name is a place and a base from the lists, with its own dice',
        !!P.parseServerName(sBefore) && !!P.parseServerName(sAfter) && sAfter !== sBefore && mp.serverName() === sAfter && stored().server === sAfter,
        `"${sBefore}" → "${sAfter}"`);
      r.ok('multiplayer: and a server name not from the lists is not taken', !mp.setProfile({ server: 'Hana’s server' }).ok && mp.serverName() === sAfter);
    }
    r.ok('multiplayer: the ten-a-second timer runs while the screen is open', !!mp._timer);

    /* ---- a host and a player, real WebRTC, tab to itself ---- */
    const claim = await S.claimSlot({ hash, makeSig, prefer: 2 });
    const code = await S.claimCode({ makeSig });
    cleanups.push(() => claim && claim.sig.close(), () => code && code.sig.close());
    const hostEvents = [];
    const host = new S.HostSession({
      profile: { name: 'Brave Otter', colour: P.COLOURS[0], key: 'hana' },
      server: { name: 'Cloud Base', map: 'kestrel', mapName: 'Kestrel Island', game: 'flight', code: code.code, slot: claim.n },
      spawnInfo: () => ({ x: 0, y: 300, z: 0, heading: 90, speed: 50, agl: 300, onGround: false }),
      weather: () => ({ time: 'day', condition: 'clear' }),
      onEvent: (...e) => hostEvents.push(e),
    });
    host.attach(new Net(claim.sig));
    host.attach(new Net(code.sig));
    cleanups.push(() => host.close());
    r.ok('multiplayer: hosting takes the preferred free slot and a code of two list words and a number', claim.n === 2 && !!P.parseCode(code.code) && P.shownCode(code.code) === code.code, `slot ${claim.n}, code ${code.code}`);

    await until(() => mp.prober && mp.prober.slots[1].state === 'open', 12000);
    const card = el.querySelector('[data-mp-slot="2"]');
    r.ok('multiplayer: the list finds it over a real data channel', mp.prober.slots[1].state === 'open' && /Cloud Base/.test(card.textContent) && /Kestrel Island/.test(card.textContent) && /1\/5/.test(card.textContent),
      card ? card.textContent.replace(/\s+/g, ' ').trim() : 'no card');
    r.ok('multiplayer: and shows its ping', mp.prober.slots[1].ping > 0, `${mp.prober.slots[1].ping} ms`);
    // The list reads the details and hangs up, rather than holding one of the host's twelve places.
    await until(() => host.info.size === 0 && !mp.prober.slots[1].link, 3000);
    r.ok('multiplayer: the list hangs up once it has the details', host.info.size === 0 && mp.prober.slots[1].state === 'open', `${host.info.size} held`);
    // Real candidates from this browser: nothing public on the way to or from a slot.
    const slotId = P.slotId(hash, claim.n);
    const onWifi = candidates.filter((x) => x.from === slotId || x.dst === slotId);
    r.ok('multiplayer: finding a server on the Wi-Fi sends the signaling server no public address',
      onWifi.length > 0 && onWifi.every((x) => candidateAllowed(x.c, 'lan')),
      `${onWifi.length} candidates: ${[...new Set(onWifi.map((x) => (/ typ (\w+)/.exec(x.c) || [])[1] + ':' + (String(x.c).split(' ')[4] || '').replace(/^[^.]*\./, '*.')))].join(', ')}`);

    /* ---- the slot cards Join from ---- */
    const fake = (state, extra = {}) => ({ n: 0, state, info: null, count: { players: 2, max: 5, full: state === 'full', locked: state === 'locked', v: P.PROTO }, ping: null, ...extra });
    mp.screen.slots([fake('busy'), fake('unreachable'), fake('locked'), fake('full'), fake('empty', { count: null })]);
    const btn = (n) => el.querySelector(`[data-mp-join="${n}"]`);
    const shown = (b) => !!(b && !b.hidden && b.offsetParent);
    r.ok('multiplayer: a busy or unreachable server still offers Join; a locked or full one does not',
      shown(btn(1)) && !btn(1).disabled && shown(btn(2)) && !btn(2).disabled && shown(btn(3)) && btn(3).disabled && shown(btn(4)) && btn(4).disabled && !shown(btn(5)),
      [1, 2, 3, 4, 5].map((n) => (shown(btn(n)) ? `${n}:${btn(n).disabled ? 'off' : 'on'}` : `${n}:none`)).join(' '));
    /*
     * Review: every 3 s ping repainted the list with innerHTML, and the Join
     * button under the pointer was a new one afterwards (the old one
     * detached) — a click that lands across a paint is eaten.
     */
    mp.screen.slots(mp.prober.slots);
    const join2 = btn(2);
    // 473 ms, shown in round steps as 500 ms: a host that holds its answer back cannot pick the number either.
    const pinged = mp.prober.slots.map((s, i) => (i === 1 ? { ...s, ping: 473 } : s));
    mp.screen.slots(pinged);
    const card2 = el.querySelector('[data-mp-slot="2"]');
    r.ok('multiplayer: a new ping in the server list is written in place, in round steps — the Join button under the pointer is the same button',
      btn(2) === join2 && join2.isConnected && shown(join2) && card2.textContent.includes('500 ms') && !card2.textContent.includes('473'),
      `same ${btn(2) === join2}, connected ${join2.isConnected}, ${card2.textContent.replace(/\s+/g, ' ').trim()}`);
    mp.screen.slots(mp.prober.slots);

    const csig = makeSig();
    await csig.open(P.playerPeerId());
    cleanups.push(() => csig.close());
    const clientEvents = [];
    const client = new S.ClientSession({ net: new Net(csig), target: P.codeId(code.code), profile: { name: 'Swift Falcon', colour: P.COLOURS[3], key: 'sam' }, onEvent: (...e) => clientEvents.push(e) });
    let welcome = null;
    try {
      welcome = await client.start();
    } catch (err) {
      r.ok('multiplayer: a player joins by code', false, err.message);
    }
    if (welcome) {
      r.ok('multiplayer: a player joins by code, under their call sign, and is told the same code', welcome.you === 1 && welcome.server.name === 'Cloud Base' && welcome.name === 'Swift Falcon'
        && welcome.players.some((p) => p.id === 0 && p.name === 'Brave Otter') && welcome.server.code === code.code, `${welcome.server.code} / ${code.code}`);
      const at = { x: 120.5, y: 333.25, z: -45.75 };
      client.tick(performance.now(), P.encodeState({ t: 5000, pos: at, quat: { w: 1 }, vel: { x: 40 }, game: 'flight', type: 'courier' }));
      const got = await until(() => hostEvents.find((e) => e[0] === 'state'));
      r.ok('multiplayer: a snapshot crosses the unreliable channel intact', got && got[1].id === 1 && Math.abs(got[1].pos.x - at.x) < 0.01 && got[1].type === 'courier');
      host.chat(1);
      const chat = await until(() => clientEvents.find((e) => e[0] === 'chat'));
      r.ok('multiplayer: quick chat arrives', chat && chat[1].id === 0 && chat[2] === 1);
      host.kick(1);
      const ended = await until(() => clientEvents.find((e) => e[0] === 'ended'));
      r.ok('multiplayer: a kick ends the player’s session', ended && ended[1] === 'kicked');
    }

    /* ---- Back while joining stops the join ---- */
    {
      const stateBefore = sim.state;
      const joining = mp.join(P.codeId(code.code));
      await until(() => mp.client && mp.client.link, 5000);
      mp.back();
      await joining;
      await wait(300);
      r.ok('multiplayer: Back while "Joining…" stops the join — no game, the world where it was',
        mp.role === null && !mp.client && !mp.busy && sim.state === stateBefore && host.players.size === 0,
        `role ${mp.role}, state ${sim.state}, host has ${host.players.size}`);
      mpMod.openServerList(sim);
    }

    /* ---- the player list: pings in place, Kick in the pause menu, the mouse let go ---- */
    {
      const players = [{ id: 0, name: 'Brave Otter', colour: P.COLOURS[0], host: true, ping: 0 }, { id: 1, name: 'Swift Falcon', colour: P.COLOURS[3], host: false, ping: 40 }];
      const opts = { meId: 0, isHost: true, code: 'maple-kite-42', server: 'Cloud Base', locked: false };
      mp.hud.roster(players, opts);
      const list = mp.hud.el.querySelector('[data-mp-list]');
      const kickBefore = list.querySelector('[data-mp-kick="1"]');
      // 88 ms is shown as 90 ms: the host sends everybody's ping, so it is shown in round steps.
      mp.hud.roster([players[0], { ...players[1], ping: 88 }], opts);
      const kickAfter = list.querySelector('[data-mp-kick="1"]');
      const pingText = list.querySelector('[data-mp-ping="1"]') && list.querySelector('[data-mp-ping="1"]').textContent;
      r.ok('multiplayer: a new ping is written in place, in round steps — the Kick button under the pointer is the same button',
        kickBefore && kickBefore === kickAfter && pingText === '90 ms' && !/88/.test(list.textContent) && /Code maple-kite-42/.test(list.textContent), pingText);
      // A code that is not exactly two list words and a number never reaches the list, even handed to it directly: the fourth review's first.
      const junk = [...['CUPXE', 'EQFXA'].map(r13), 'HELLO', 'KDPTM', 'MAPLE-KITE-42', 'maple kite 42', 'maple-kite-42 ', 'maple-kite-88', 'm\u0430ple-kite-42'];
      const leaked = junk.filter((code) => {
        mp.hud.roster(players, { ...opts, code });
        return /Code/.test(list.textContent) || list.textContent.includes(code.trim());
      });
      mp.hud.roster(players, opts);
      r.ok('multiplayer: the player list shows only a code the game could make', leaked.length === 0, leaked.length ? `shown: ${leaked.join(', ')}` : `${junk.length} not shown`);
      {
        // The badge a joiner flies with: a code a modified host slipped past the session is still not shown on it.
        const was = { role: mp.role, client: mp.client, server: mp.server, meId: mp.meId };
        // The whole badge: since list 2 the code has a line of its own under the name and head-count.
        const badgeText = () => [...mp.hud.el.querySelectorAll('[data-mp-badge-text], [data-mp-badge-code]')].filter((x) => !x.hidden).map((x) => x.textContent).join(' · ');
        const seen = [];
        try {
          mp.role = 'client';
          mp.meId = 1;
          mp.client = { name: 'Swift Falcon', ping: 12, players: new Map([[0, { id: 0, name: 'Brave Otter', colour: P.COLOURS[0], host: true, ping: null }]]) };
          for (const code of [...['CUPXE', 'EQFXA'].map(r13), 'maple-kite-42']) {
            mp.server = { name: 'Cloud Base', code };
            mp.syncRoster();
            seen.push(badgeText());
          }
        } finally {
          Object.assign(mp, was);
        }
        r.ok('multiplayer: a joiner’s badge shows a code only if it is two list words and a number', !/code/i.test(seen[0]) && !/code/i.test(seen[1]) && /Code maple-kite-42/.test(seen[2]), seen.join(' | '));
      }
      mp.hud.pauseList(sim, true, players, opts);
      const fold = document.querySelector('.mp-pausefold');
      const inPause = fold && sim.menus && sim.menus.screens.pause && sim.menus.screens.pause.contains(fold);
      r.ok('multiplayer: paused, the list with Kick and Lock is a fold in the pause menu', !!(inPause && !fold.hidden && fold.querySelector('[data-mp-kick="1"]') && fold.querySelector('[data-mp-lock]')),
        fold ? fold.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : 'no fold');
      mp.hud.pauseList(sim, false);
      r.ok('multiplayer: and goes when the game does', fold && fold.hidden);

      // Mouse flying: a locked pointer is let go while Tab is held, and steering paused; letting go puts both back.
      const input = sim.input;
      if (input) {
        const was = { enabled: input.mouseEnabled };
        let relocked = 0;
        let exited = 0;
        const fakeEl = { requestPointerLock: () => { relocked++; return Promise.resolve(); } };
        const exitWas = document.exitPointerLock;
        const ownExit = Object.prototype.hasOwnProperty.call(document, 'exitPointerLock');
        Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => (exited ? null : fakeEl) });
        document.exitPointerLock = () => { exited++; };
        try {
          input.mouseEnabled = true;
          mp.freeMouse(true);
          const freed = exited === 1 && input.mouseEnabled === false;
          mp.freeMouse(false);
          const back = input.mouseEnabled === true && relocked === (sim.state === 'flying' ? 1 : 0);
          r.ok('multiplayer: holding Tab lets a locked pointer go and pauses mouse steering; letting go puts both back', freed && back,
            `exit ${exited}, steering ${input.mouseEnabled}, relock ${relocked} (${sim.state})`);
        } finally {
          // The own property goes; the browser's own getter on Document.prototype was never touched.
          delete document.pointerLockElement;
          if (ownExit) document.exitPointerLock = exitWas;
          else delete document.exitPointerLock;
          input.mouseEnabled = was.enabled;
        }
      }
    }

    /* ---- a remote plane, drawn ---- */
    const ac = sim.aircraft;
    const base = { x: ac.pos.x + 60, y: ac.pos.y + 30, z: ac.pos.z };
    mp.remotes.add(4, { name: 'Sparkly Yeti 42', colour: P.COLOURS[5] });
    const t0 = performance.now();
    // Parked in the air sixty metres off: every snapshot the same, so where it is drawn is not a matter of timing.
    for (let i = 0; i < 6; i++) {
      mp.remotes.push(P.decodeState(P.encodeState({ id: 4, t: 1000 + i * 66, pos: base, quat: { w: 1 }, vel: {}, game: 'flight', type: 'skylark' })), t0 - 400 + i * 66);
    }
    const dots = mp.remotes.update(1 / 60, t0, sim);
    const p = mp.remotes.players.get(4);
    let inScene = false;
    for (let o = p && p.model; o; o = o.parent) if (o === sim.scene) inScene = true;
    r.ok('multiplayer: a remote player is built with the game’s own aircraft model', !!(p && p.model && inScene && p.model.visible), p && p.model ? p.model.name : 'no model');
    const err = p && p.model ? Math.hypot(p.model.position.x - base.x, p.model.position.z - base.z) : Infinity;
    r.ok('multiplayer: drawn where its snapshots say', err < 0.1, `${err.toFixed(3)} m`);
    r.ok('multiplayer: with a name tag and a minimap dot', !!(p && p.tag && p.tag.sprite.parent) && dots.length === 1 && dots[0].colour === P.COLOURS[5]);
    // The tag: a fixed five metres floated it a wingspan clear of a Skylark ten metres away (playtest screenshot).
    const tagLift = p && p.tag ? p.tag.sprite.position.y - base.y : NaN;
    r.ok('multiplayer: the name tag sits just over the aeroplane, not metres above it', tagLift > 1 && tagLift < 5, `${tagLift.toFixed(2)} m above its middle at ${Math.round(p.dist)} m`);
    mp.remotes.remove(4);
    r.ok('multiplayer: and removed cleanly', !mp.remotes.players.has(4) && !(p.model && p.model.parent));

    /* ---- a remote boat, painted where it can be seen ---- */
    mp.remotes.add(3, { name: 'Plucky Seal', colour: P.COLOURS[0] });
    const t1 = performance.now();
    for (let i = 0; i < 6; i++) {
      mp.remotes.push(P.decodeState(P.encodeState({ id: 3, t: 9000 + i * 66, pos: { x: base.x + 40, y: 0, z: base.z }, quat: { w: 1 }, vel: {}, game: 'boat', type: 'boat' })), t1 - 400 + i * 66);
    }
    mp.remotes.update(1 / 60, t1, sim);
    const boat = mp.remotes.players.get(3);
    const painted = new Set();
    const tinted = (boat && boat.model && boat.model.userData.mpTinted) || [];
    if (boat && boat.model) boat.model.traverse((o) => o.isMesh && tinted.includes(o.material) && painted.add(o.name));
    // The pack's hull is nearly all under the water; painting it alone left Hana's red boat grey in the playtest.
    r.ok('multiplayer: a remote boat is the game’s own boat, painted on the deck and not only below the waterline',
      !!(boat && boat.model && boat.model.userData.mpKind === 'boat') && (!boat.model.userData.fromPack || [...painted].some((n) => /deck/i.test(n))),
      [...painted].join(', ') || 'nothing painted');
    mp.remotes.remove(3);

    /* ---- the lobbies: choosing a username, five lobbies, one tap in ---- */
    {
      const L = await import('../../src/features/multiplayer/lobby.js');
      mp.stopLooking();
      mp.back();
      mp.profile.chosen = false;
      mp.profile.name = 'Brave Otter';
      mpMod.openMultiplayer(sim);
      const le = document.querySelector('[data-screen="lobbies"]');
      r.ok('lobbies: the main menu’s Multiplayer opens the five lobbies', mpMod.LOBBIES_ON_MAIN_MENU === true && !!le && !le.hidden && (!sim.menus || sim.menus.current === 'lobbies'));
      // The Wi-Fi row's five (list 3 added a World row below it, with cards of its own).
      const cardsReady = await until(() => le.querySelectorAll('[data-mp-lobby].is-empty').length === 5, 6000);
      const cards = [...le.querySelectorAll('[data-mp-lobby]')];
      const pick = le.querySelector('[data-mp-userpick]');
      r.ok('lobbies: five lobbies listed with their own names and 0/8; the first visit asks for a username, and Join waits for it',
        !!cardsReady && cards.length === 5 && cards.every((c, i) => c.textContent.includes(P.LOBBY_NAMES[i]) && c.textContent.includes('0/8'))
        && !pick.hidden && /Pick your username/.test(le.textContent) && cards.every((c) => c.querySelector('button').disabled),
        cards.map((c) => c.querySelector('.mp-count').textContent).join(' '));
      // No box that makes a name: the only text boxes are the two word searches and the join code.
      const boxes = [...le.querySelectorAll('input, textarea, [contenteditable]')].map((b) => b.dataset.mpFind || (b.hasAttribute('data-mp-code') ? 'code' : 'other'));
      r.ok('lobbies: no free-text name anywhere — the only boxes are the two word searches and the join code', boxes.sort().join(',') === 'adj,code,noun', boxes.join(','));
      const find = le.querySelector('[data-mp-find="noun"]');
      const nounList = le.querySelector('[data-mp-words="noun"]');
      const shownWords = () => [...nounList.querySelectorAll('[data-mp-word]')].filter((b) => !b.hidden).map((b) => b.dataset.mpWord);
      find.value = 'ott';
      find.dispatchEvent(new Event('input'));
      const found = shownWords();
      find.value = 'qqq';
      find.dispatchEvent(new Event('input'));
      const none = shownWords().length === 0 && !nounList.querySelector('.mp-none').hidden;
      find.value = '';
      find.dispatchEvent(new Event('input'));
      r.ok('lobbies: the word lists have search, and every word is there to scroll to', found.join(',') === 'Otter' && none && shownWords().length === P.CALLSIGN_NOUNS.length
        && le.querySelectorAll('[data-mp-words="adj"] [data-mp-word]').length === P.CALLSIGN_ADJECTIVES.length, found.join(','));
      le.querySelector('[data-mp-words="adj"] [data-mp-word="Stellar"]').click();
      le.querySelector('[data-mp-words="noun"] [data-mp-word="Axolotl"]').click();
      const num = le.querySelector('[data-mp-num]');
      num.value = '7';
      num.dispatchEvent(new Event('change'));
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem('islandsim.multiplayer.v1'));
      } catch (e) {
        saved = null;
      }
      r.ok('lobbies: picking words shows the username as it is built, and saves it on this device', le.querySelector('[data-mp-user]').textContent === 'Stellar Axolotl 7'
        && mp.profile.name === 'Stellar Axolotl 7' && saved && saved.name === 'Stellar Axolotl 7', le.querySelector('[data-mp-user]').textContent);
      le.querySelector('[data-mp-surprise]').click();
      const rolled = mp.profile.name;
      r.ok('lobbies: Surprise me rolls a new username from the lists', rolled !== 'Stellar Axolotl 7' && !!P.parseCallSign(rolled) && le.querySelector('[data-mp-user]').textContent === rolled, rolled);
      le.querySelector('[data-mp-words="adj"] [data-mp-word="Swift"]').click();
      le.querySelector('[data-mp-words="noun"] [data-mp-word="Falcon"]').click();
      num.value = '0';
      num.dispatchEvent(new Event('change'));
      le.querySelector('[data-mp-user-done]').click();
      const enabled = await until(() => [...le.querySelectorAll('[data-mp-lobby-join]')].every((b) => !b.disabled), 4000);
      r.ok('lobbies: "That’s me" keeps it, folds the pickers away, and the lobbies can be joined', mp.profile.chosen && pick.hidden && !le.querySelector('[data-mp-user-change]').hidden && !!enabled
        && /You’ll join as Swift Falcon[.,]/.test(le.textContent));

      // Somebody else hosts lobby 4 as Swift Falcon: a tab of our own, through the same fake server.
      const lsig = makeSig();
      await lsig.open(P.lobbyId(hash, 4));
      const lnet = new Net(lsig);
      const other = new S.HostSession({
        mode: 'lobby', profile: { name: 'Swift Falcon', colour: P.COLOURS[0], key: 'other-host' },
        server: { name: 'x', map: 'meadow', game: 'flight', lobby: 4 }, spawnInfo: () => null, weather: () => null,
      });
      other.attach(lnet);
      cleanups.push(() => { other.close(); lsig.close(); });
      const busy4 = await until(() => /1\/8/.test(cards[3].textContent) && /Harrier Flats/.test(cards[3].textContent), 5000);
      r.ok('lobbies: a lobby with somebody in shows the count and its island', !!busy4, cards[3].textContent.replace(/\s+/g, ' '));
      await mp.joinLobby(4);
      const statusText = le.querySelector('[data-mp-status]').textContent;
      const offerBtn = le.querySelector('[data-mp-offer-go]');
      r.ok('lobbies: a taken username is refused in words a ten-year-old gets, with a free one to take in one tap',
        /Someone in Lobby 4 is already called Swift Falcon — change your number or pick another name\./.test(statusText) && !le.querySelector('[data-mp-offer]').hidden
        && offerBtn.textContent === 'Use Swift Falcon 2 and join' && mp.role === null, `${statusText} / ${offerBtn.textContent}`);
      offerBtn.click();
      const inFour = await until(() => mp.lobby && mp.role === 'client' && mp.ready && sim.state === 'flying', 20000);
      r.ok('lobbies: the one tap takes the free username and joins, on the lobby’s island', !!inFour && mp.profile.name === 'Swift Falcon 2' && sim.settings.map === 'meadow' && other.count === 2,
        `${mp.profile.name}, ${sim.settings.map}, ${other.count} in`);
      mp.syncRoster();
      mp.hud.hold(true);
      const list = mp.hud.el.querySelector('[data-mp-list]');
      const badge = mp.hud.el.querySelector('[data-mp-badge-text]').textContent;
      r.ok('lobbies: in a lobby nobody has Kick or Lock and nobody is called the host — each other player has Mute',
        !list.querySelector('[data-mp-kick]') && !list.querySelector('[data-mp-lock]') && !!list.querySelector('[data-mp-mute="Swift Falcon"]') && !/host/.test(list.textContent)
        && /Lobby 4 · Maple Runway · 2\/8/.test(badge) && other.kick(1) === false && other.setLocked(true) === false, badge);
      // Part 3b: the lobby's owner — whoever hosts it — wears the crown, in the list and over their aeroplane; nobody here is an admin.
      const ownerRow = [...list.querySelectorAll('.mp-prow')].find((row) => /Swift Falcon(?! 2)/.test(row.textContent));
      const ownerTag = mp.remotes.players.get(0);
      r.ok('lobbies: the lobby’s owner (its host) has the crown, in the list and on their tag — and only them',
        !!(ownerRow && ownerRow.querySelector('.mp-crown')) && list.querySelectorAll('.mp-crown').length === 1 && !!(ownerTag && ownerTag.host)
        && !list.querySelector('.mp-admintag') && !list.querySelector('[data-mp-adm-open]'), `${list.querySelectorAll('.mp-crown').length} crown(s)`);
      const toasts = [];
      const notify = sim.hud && sim.hud.notify;
      if (sim.hud) sim.hud.notify = (html, kind, secs) => { toasts.push(String(html)); return notify && notify.call(sim.hud, html, kind, secs); };
      other.chat(0);
      await until(() => toasts.some((t) => /Swift Falcon: Nice landing/.test(t)), 3000);
      list.querySelector('[data-mp-mute="Swift Falcon"]').click();
      const mutedRow = /muted/.test(list.textContent) && list.querySelector('[data-mp-mute="Swift Falcon"]').textContent === 'Unmute';
      toasts.length = 0;
      await wait(1300);
      other.chat(1);
      await wait(600);
      r.ok('lobbies: Mute hides that player’s quick chat — for this player only', mutedRow && !toasts.some((t) => /Swift Falcon/.test(t)) && mp.muted.has('Swift Falcon'), toasts.join(' | '));
      if (sim.hud) sim.hud.notify = notify;
      mp.hud.hold(false);
      mp.toggleMute('Swift Falcon');

      // The host leaves: this tab is next in line, claims the lobby and hosts it, without leaving the island.
      const flightBefore = sim.aircraft && sim.aircraft.pos.clone();
      other.close();
      lsig.close();
      const took = await until(() => mp.lobby && mp.role === 'host' && mp.host && !mp.reconnecting, 12000);
      r.ok('lobbies: the host leaves and the lobby re-forms round this tab, on the same island, still flying',
        !!took && sim.state === 'flying' && sim.settings.map === 'meadow' && mp.lobby.history.some((h) => h.role === 'host') && !!flightBefore,
        JSON.stringify(mp.lobby && mp.lobby.history));
      mp.leave('left');
      r.ok('lobbies: Leave lobby leaves', !mp.lobby && mp.role === null);

      // A full lobby: said kindly, with another one offered.
      const fsig = makeSig();
      await fsig.open(P.lobbyId(hash, 5));
      const full = new S.HostSession({ mode: 'lobby', max: 1, profile: { name: 'Kind Koala', colour: P.COLOURS[1], key: 'full-host' }, server: { map: 'kestrel', game: 'flight', lobby: 5 } });
      full.attach(new Net(fsig));
      cleanups.push(() => { full.close(); fsig.close(); });
      mpMod.openMultiplayer(sim);
      const fullCard = await until(() => /Full — join Lobby/.test(cards[4].textContent), 6000);
      await mp.joinLobby(5);
      const fullSaid = le.querySelector('[data-mp-status]').textContent;
      r.ok('lobbies: a full lobby says so kindly and offers the emptiest other one', !!fullCard && /Lobby 5 is full — eight players is the most\. Lobby \d has room\./.test(fullSaid)
        && /Join Lobby \d instead/.test(le.querySelector('[data-mp-offer-go]').textContent), `${cards[4].textContent.replace(/\s+/g, ' ')} / ${fullSaid}`);
      le.querySelector('[data-mp-offer]').hidden = true;
      full.close();
      fsig.close();
      void L;
      mp.back();
    }

    /* ---- no signaling server at all: kind words, and single-player carries on ---- */
    mp.stopLooking();
    mp.back();
    // Port 9 on this machine: nothing listens, so the socket is refused at once — a school network that blocks it looks the same.
    mp.configure({ backend: { id: 'dead', url: 'ws://127.0.0.1:9/peerjs', key: 'peerjs', label: 'nowhere' }, hash });
    const stateBefore = sim.state;
    mpMod.openServerList(sim);
    const said = await until(() => /Can’t reach the matchmaking server/.test(el.textContent) && /fly on your own/.test(el.textContent), 12000);
    r.ok('multiplayer: with no signaling server the screen says so kindly', !!said,
      el.querySelector('[data-mp-status]').textContent || el.querySelector('[data-mp-net]').textContent);
    await mp.hostServer({ serverName: 'Windy Point', map: 'kestrel', game: 'flight' });
    r.ok('multiplayer: and Host fails soft — no server, no role, the game where it was',
      mp.role === null && !mp.busy && sim.state === stateBefore && /fly on your own/.test(el.querySelector('[data-mp-status]').textContent),
      el.querySelector('[data-mp-status]').textContent);
    // Review: the timer ran ten times a second from boot, for children who never open Multiplayer.
    mp.back();
    const slept = await until(() => !mp._timer, 3000);
    r.ok('multiplayer: and the timer stops once there is nothing left for it to do', !!slept && !mp.role && !mp.prober, `timer ${mp._timer ? 'running' : 'stopped'}`);
  } catch (err) {
    r.ok('multiplayer: the in-tab checks ran to the end', false, String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
  } finally {
    for (const fn of cleanups.reverse()) {
      try {
        fn();
      } catch (e) {
        /* already gone */
      }
    }
    mp.stopLooking();
    mp.configure(null);
    if (profileBefore) mp.profile = profileBefore;
    try {
      if (savedProfile === null) localStorage.removeItem('islandsim.multiplayer.v1');
      else localStorage.setItem('islandsim.multiplayer.v1', savedProfile);
    } catch (e) {
      /* storage is not ours to fix */
    }
    if (sim.menus) {
      if (wasScreen && wasScreen !== 'multiplayer') sim.menus.show(wasScreen);
      else if (!wasScreen) sim.menus.hide();
      else sim.menus.show('main');
    }
    await wait(400);
  }
}

export default check;
