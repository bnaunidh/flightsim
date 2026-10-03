/**
 * Every mission that moved to a new island (tests/features/mission-maps.browser.js
 * MOVED), flown to the end by a scripted pilot on the real game — the proof
 * the owner asked for ("every moved mission completed by a scripted pilot").
 * Not part of the self-test: an hour of game time with the renderer off.
 *
 *   const { playMoved } = await import('./tests/features/mission-maps.playthrough.js');
 *   const out = await playMoved(window.__sim, console.log);
 *   console.table(out.map((o) => ({ id: o.id, ok: o.ok, how: o.how, detail: o.detail })));
 *
 * Who flies what:
 *   - the flight missions: tests/features/mission-pilot.js (with `assist`
 *     on, so a step the pilot cannot fly is placed and the rest still
 *     proved; the result says which steps needed it);
 *   - the hijacks: tests/features/events.playthrough.js, the pilot bot that
 *     reads the cards and follows the fighters;
 *   - Air Force One, both missions, the captain's seat: tests/features/afo.playthrough.js;
 *   - the helicopter missions: tests/features/heli-missions.browser.js's
 *     keyboard pilot, which lifts, flies to the arrow, hovers and lands;
 *   - the boat shouts: tests/features/boat-playtest.browser.js's playShout.
 *
 * @param {object} sim window.__sim
 * @param {function} say logger
 * @param {{ only?: string[], skip?: string[] }} [opts]
 * @returns {Promise<Array<{ id, map, ok, how, status, seconds, detail }>>}
 */
export async function playMoved(sim, say = () => {}, opts = {}) {
  const { MOVED } = await import('./mission-maps.browser.js');
  const Pilot = await import('./mission-pilot.js');
  const out = [];
  const want = (id) => (!opts.only || opts.only.includes(id)) && !(opts.skip && opts.skip.includes(id));
  const quit = () => {
    if (sim.state !== 'menu' && typeof sim.quitToMenu === 'function') sim.quitToMenu();
  };
  const rep = () => {
    const checks = [];
    return { checks, ok(name, pass, detail = '') { checks.push({ name, pass: !!pass, detail: String(detail) }); return !!pass; }, get failed() { return checks.filter((c) => !c.pass); } };
  };
  const flight = ['carrierqual', 'tail', 'deadstick', 'chaser', 'meteor-shower', 'meteor-dodge', 'meteor-photo', 'goofy-gulls', 'goofy-cow', 'goofy-icecream'];

  for (const id of flight) {
    if (!want(id)) continue;
    say(`moved missions: ${id}`);
    try {
      const o = await Pilot.flyMission(sim, id, { assist: true, say });
      out.push({ id, map: MOVED[id], ok: o.ok, how: o.assisted.length ? `pilot, assisted on ${o.assisted.join(',')}` : 'pilot', status: o.status, seconds: Math.round(o.seconds), detail: `${o.steps.join('>')}${o.crashed ? ' CRASHED: ' + o.crashReason : ''} | ${o.log.slice(-2).join(' | ')}` });
    } catch (e) {
      out.push({ id, map: MOVED[id], ok: false, how: 'pilot', status: 'threw', seconds: 0, detail: String(e && e.message).slice(0, 300) });
    }
    quit();
  }

  // The fires: the node robot (tests/features/fire.mjs, section 6) flies every fire mission's scenario,
  // and the browser check below starts them on their islands. Nothing more to fly here.

  for (const id of ['event-hijack', 'event-hijack-real']) {
    if (!want(id)) continue;
    say(`moved missions: ${id} (the hijack bot)`);
    try {
      const { playthrough } = await import('./events.playthrough.js');
      const o = await playthrough(sim, id, { maxSeconds: 1200 });
      out.push({ id, map: MOVED[id], ok: o.ok, how: 'events.playthrough', status: o.status, seconds: Math.round(o.seconds || 0), detail: `${o.phase || ''} score ${o.score}${o.crashed ? ' CRASHED' : ''} | ${(o.log || []).slice(-2).join(' | ')}` });
    } catch (e) {
      out.push({ id, map: MOVED[id], ok: false, how: 'events.playthrough', status: 'threw', seconds: 0, detail: String(e && e.message).slice(0, 300) });
    }
    quit();
  }

  for (const [id, role] of [['afo-normal', 'captain'], ['afo-attack', 'captain'], ['afo-attack', 'escort']]) {
    if (!want(id)) continue;
    say(`moved missions: ${id}/${role} (the AFO bot)`);
    try {
      const { playthrough } = await import('./afo.playthrough.js');
      const o = await playthrough(sim, id, role);
      out.push({ id: `${id}/${role}`, map: MOVED[id], ok: o.ok, how: 'afo.playthrough', status: o.status, seconds: Math.round(o.seconds || 0), detail: `score ${o.score}${o.crashed ? ' CRASHED: ' + o.crashReason : ''} | ${(o.log || []).slice(-2).join(' | ')}` });
    } catch (e) {
      out.push({ id: `${id}/${role}`, map: MOVED[id], ok: false, how: 'afo.playthrough', status: 'threw', seconds: 0, detail: String(e && e.message).slice(0, 300) });
    }
    quit();
  }

  const heli = ['lastlight', 'oncall', 'overboard'].filter(want);
  if (heli.length) {
    say('moved missions: the helicopter pilot');
    try {
      const H = await import('./heli-missions.browser.js');
      const r = rep();
      await H.check(sim, r, say, { ids: heli });
      for (const id of heli) {
        const mine = r.checks.filter((c) => c.name.includes(id));
        const done = mine.find((c) => /complete|finish|saved|landed/i.test(c.name)) || mine[mine.length - 1];
        out.push({ id, map: MOVED[id], ok: mine.length > 0 && mine.every((c) => c.pass), how: 'heli-missions pilot', status: done ? (done.pass ? 'complete' : 'failed') : 'no checks', seconds: 0, detail: mine.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join(' ; ').slice(0, 400) || `${mine.length} checks passed` });
      }
    } catch (e) {
      for (const id of heli) out.push({ id, map: MOVED[id], ok: false, how: 'heli-missions pilot', status: 'threw', seconds: 0, detail: String(e && e.message).slice(0, 300) });
    }
    quit();
  }

  for (const id of ['in-the-gale', 'night-shout', 'man-overboard']) {
    if (!want(id)) continue;
    say(`moved missions: ${id} (the boat kid)`);
    try {
      const B = await import('./boat-playtest.browser.js');
      const o = await B.playShout(sim, id, say);
      out.push({ id, map: MOVED[id], ok: o.status === 'complete', how: 'boat playShout', status: o.status, seconds: Math.round(o.seconds || o.t || 0), detail: String(o.detail || '').slice(0, 300) });
    } catch (e) {
      out.push({ id, map: MOVED[id], ok: false, how: 'boat playShout', status: 'threw', seconds: 0, detail: String(e && e.message).slice(0, 300) });
    }
    quit();
  }
  return out;
}

export default playMoved;
