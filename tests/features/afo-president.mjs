/**
 * Node checks for Air Force One's third seat: the President. Model:
 * tests/features/roles.mjs's own NPC-airliner section — this drives the
 * two stories (src/game/roles/afo-president.js's createPresidentNormal/
 * createPresidentAttack, reached through cast.js's public castStart/
 * castStory/castUpdate, exactly as the real game does) against a bare
 * THREE.Scene and a made-up sim, with no page and no renderer at all, on
 * the maps the two missions really fly from (src/game/extra/afo.js).
 *
 *   node tests/features/afo-president.mjs
 *
 * Proves what a browser placement-check cannot:
 *   - the cabin can be WALKED from the start to every place the schedule
 *     asks for (the v55 cabin's secure room spanned the whole width, so the
 *     office, the briefing and the cockpit were behind a wall);
 *   - the jet holds over the sea until it is sent home, then lands and stops,
 *     with the seatbelt sign on before the wheels touch;
 *   - Under Attack: the warning, the drones, the fail path (with its reason)
 *     and the pass path.
 *
 * Exits non-zero if anything fails.
 */

if (typeof globalThis.window === 'undefined') {
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  });
}
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
  getElementById: () => null,
};

const root = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  return !!pass;
};

const THREE = await imp('src/vendor/three.module.js');
const T = await imp('src/world/terrain.js');
const AP = await imp('src/world/airport.js');
const CAST = await imp('src/game/roles/cast.js');
const Pres = await imp('src/game/roles/afo-president.js');
const { WALK } = await imp('src/features/staff/walk.js');
const { findMission } = await imp('src/game/missions.js');

const scene = new THREE.Scene();
const weather = { isNight: false, cond: { cloud: 0 }, windSpeedKts: 7, windDirDeg: 90 };
function fakeSim() {
  return { scene, weather, hud: null, audio: null, speak() {} };
}
function useMap(id) {
  T.applyMap(id);
  AP.refreshRunways();
}

/* ------------------------------------------------------------------ *
 * The cabin: every place the schedule names is clear floor, and you can
 * walk to all of them from where you start. A flood fill over a 5 cm grid
 * of where the walker's centre may stand (its radius off every wall and
 * piece of furniture), the same AABB rule the walker itself uses.
 * ------------------------------------------------------------------ */
{
  const C = Pres.CABIN;
  const obs = Pres.cabinObstacles();
  const r = WALK.radius;
  const step = 0.05;
  const x0 = -C.halfW + r;
  const x1 = C.halfW - r;
  const z0 = C.z0 + r;
  const z1 = C.z1 - r;
  const nx = Math.floor((x1 - x0) / step) + 1;
  const nz = Math.floor((z1 - z0) / step) + 1;
  const free = (x, z) => !obs.some((o) => x > o.x0 - r && x < o.x1 + r && z > o.z0 - r && z < o.z1 + r);
  const cellOf = (p) => [Math.round((p.x - x0) / step), Math.round((p.z - z0) / step)];
  const seen = new Uint8Array(nx * nz);
  const [sx, sz] = cellOf(Pres.SPOTS.start);
  const queue = [[sx, sz]];
  seen[sz * nx + sx] = 1;
  while (queue.length) {
    const [i, k] = queue.pop();
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const b = k + dk;
      if (a < 0 || b < 0 || a >= nx || b >= nz || seen[b * nx + a]) continue;
      if (!free(x0 + a * step, z0 + b * step)) continue;
      seen[b * nx + a] = 1;
      queue.push([a, b]);
    }
  }
  ok('cabin: the start is clear floor', free(Pres.SPOTS.start.x, Pres.SPOTS.start.z), JSON.stringify(Pres.SPOTS.start));
  for (const [name, p] of Object.entries(Pres.SPOTS)) {
    if (name === 'cockpitDoor') continue;
    const [i, k] = cellOf(p);
    ok(`cabin: "${name}" is clear floor and can be walked to from the start`, free(p.x, p.z) && seen[k * nx + i] === 1, JSON.stringify(p));
  }
  ok('cabin: the secure room is a real room, and its inside spot is in it', Pres.inSecureRoom(Pres.SPOTS.secureInside.x, Pres.SPOTS.secureInside.z) && !Pres.inSecureRoom(Pres.SPOTS.secureDoor.x - 0.6, Pres.SPOTS.secureDoor.z));
  ok('cabin: the conference room is not inside the secure room (v55 had them overlapping)', !Pres.inSecureRoom(Pres.SPOTS.conference.x, Pres.SPOTS.conference.z));
  ok('cabin: the wave window is on the RIGHT, where the escort flies', Pres.SPOTS.window.x > 1.5 && Pres.CABIN.windows.some((z) => Math.abs(z - Pres.SPOTS.window.z) < 0.4));
  ok('cabin: the secure room has a window to watch the fight through', Pres.CABIN.windows.some((z) => Pres.inSecureRoom(2.0, z)));
}

/* ------------------------------------------------------------------ *
 * The normal flight (Gateway): holds over the sea until sent home, then
 * lands and stops, the seatbelt sign on before touchdown.
 * ------------------------------------------------------------------ */
function info(story) {
  const out = {};
  story.info(out);
  return out;
}

{
  const mission = findMission('afo-normal');
  useMap(mission.map);
  const sim = fakeSim();
  CAST.castStart(sim, 'mission', { roleId: 'president', cast: { story: Pres.STORY_NORMAL } });
  const story = CAST.castStory(Pres.STORY_NORMAL);
  ok('normal: the story exposes its jet as the "airliner" actor (castActor)', CAST.castActor('airliner') === story.air && story.air.pos.y > 200, story.air && story.air.pos.y.toFixed(0));
  ok('normal: the real exterior model is hidden (you are inside it)', story.air.model.visible === false);
  const dt = 1 / 30;
  let t = 0;
  let minAgl = Infinity;
  let maxBank = 0;
  let autoAt = null;
  let stopAt = null;
  const eul = new THREE.Euler();
  for (; t < 400; t += dt) {
    CAST.castUpdate(sim, dt);
    const i = info(story);
    if (!i.landing) minAgl = Math.min(minAgl, story.air.agl);
    eul.setFromQuaternion(story.air.quat, 'YXZ');
    maxBank = Math.max(maxBank, Math.abs(eul.z) * 57.3);
    if (i.autoHome && autoAt == null) autoAt = { t, along: i.along };
    if (i.stopped) {
      stopAt = t;
      break;
    }
  }
  ok('normal: never sent home, the Captain starts the approach himself, ~5.5 km out — no circling', autoAt != null && autoAt.along > -5600 && autoAt.along < -5000, JSON.stringify(autoAt));
  ok('normal: ...and lands and stops, inside 4 min', stopAt != null && stopAt < 240, `stopped at ${stopAt && stopAt.toFixed(0)}s`);
  ok('normal: the run in is gentle and never low (bank under 10°, 250 m+ until the approach)', maxBank < 10 && minAgl > 240, `max bank ${maxBank.toFixed(1)}°, min AGL ${minAgl.toFixed(0)} m`);
  CAST.castStop(sim);

  // Sent home the moment a walking player would get to the flight deck.
  CAST.castStart(sim, 'mission', { roleId: 'president', cast: { story: Pres.STORY_NORMAL } });
  const s2 = CAST.castStory(Pres.STORY_NORMAL);
  let seatbeltAt = null;
  let touchAt = null;
  stopAt = null;
  for (t = 0; t < 600; t += dt) {
    if (t > 60 && s2.homeAt == null) s2.goHome(sim);
    CAST.castUpdate(sim, dt);
    const i = info(s2);
    if (i.seatbelt && seatbeltAt == null) seatbeltAt = t;
    if (i.onGround && touchAt == null) touchAt = t;
    if (i.stopped) {
      stopAt = t;
      break;
    }
  }
  ok('normal: sent home, it lands and stops on the field', stopAt != null && T.heightAt(s2.air.pos.x, s2.air.pos.z) > -1, `stopped at ${stopAt && stopAt.toFixed(0)}s, ${s2.air.pos.x.toFixed(0)},${s2.air.pos.z.toFixed(0)}`);
  ok('normal: the whole ride is short — down and stopped within 4 min', stopAt != null && stopAt < 240, `${stopAt && stopAt.toFixed(0)}s`);
  ok('normal: the seatbelt sign comes on 30-80 s before touchdown (time to walk back and sit)', seatbeltAt != null && touchAt != null && touchAt - seatbeltAt > 30 && touchAt - seatbeltAt < 80, `seatbelt ${seatbeltAt && seatbeltAt.toFixed(0)}s, touchdown ${touchAt && touchAt.toFixed(0)}s`);
  ok('normal: the escort followed him down', !s2.escort || s2.escort.onGround || s2.escort.mode === 'land', s2.escort ? `escort mode ${s2.escort.mode} onGround ${s2.escort.onGround}` : 'no escort');
  const score = Pres.PRESIDENT_NORMAL.score({ elapsed: stopAt || 600 });
  ok('normal: even with no extras, an on-time ride scores 80+', score >= 80, `score ${score} at ${stopAt && stopAt.toFixed(0)}s (par ${Pres.PRESIDENT_NORMAL.parTime})`);
  let threw = null;
  try {
    CAST.castStop(sim);
  } catch (e) {
    threw = e;
  }
  ok('normal: tearing the story down does not throw', !threw, threw);
}

/* ------------------------------------------------------------------ *
 * Under Attack (Ironhead Air Base): the warning, the drones over the sea,
 * the escort's gun, then home.
 * ------------------------------------------------------------------ */
{
  const mission = findMission('afo-attack');
  useMap(mission.map);
  const sim = fakeSim();
  Pres.placeWalker(Pres.SPOTS.secureInside.x, Pres.SPOTS.secureInside.z); // the pass path: in the secure room
  CAST.castStart(sim, 'mission', { roleId: 'president', cast: { story: Pres.STORY_ATTACK } });
  const story = CAST.castStory(Pres.STORY_ATTACK);
  const dt = 1 / 30;
  let t = 0;
  let warnedAt = null;
  let sawDrones = false;
  let clearAt = null;
  let overSea = true;
  let stopAt = null;
  let failed = null;
  for (; t < 600; t += dt) {
    if (clearAt != null && t > clearAt + 20 && story.homeAt == null) story.goHome(sim);
    CAST.castUpdate(sim, dt);
    const i = info(story);
    if (i.warned && warnedAt == null) warnedAt = t;
    if (i.dronesAlive > 0) {
      sawDrones = true;
      for (const d of story.attack.drones) if (T.heightAt(d.pos.x, d.pos.z) > 0) overSea = false;
    }
    if (i.clear && clearAt == null) clearAt = t;
    if (i.failWhy) failed = i.failWhy;
    if (i.stopped) {
      stopAt = t;
      break;
    }
  }
  ok('attack: the warning fires on its own clock (t ≈ 8 s)', warnedAt != null && warnedAt < 9, `t ${warnedAt}`);
  ok('attack: the drone wave came (unmanned), over the sea', sawDrones && overSea);
  ok('attack: the escort cleared them (its gun really hits)', clearAt != null && story.attack.stats.shotDrones >= 2, `clear at ${clearAt && clearAt.toFixed(0)}s, ${JSON.stringify(story.attack.stats)}`);
  ok('attack: in the secure room, nothing fails', !failed, failed);
  ok('attack: sent home, it lands and stops on dry land', stopAt != null && T.heightAt(story.air.pos.x, story.air.pos.z) > 0, `stopped ${stopAt && stopAt.toFixed(0)}s at ${story.air.pos.x.toFixed(0)},${story.air.pos.z.toFixed(0)}`);
  ok('attack: the whole thing is short — down and stopped within 4 min', stopAt != null && stopAt < 240, `${stopAt && stopAt.toFixed(0)}s`);
  CAST.castStop(sim);
}

/* ------------------------------------------------------------------ *
 * The fail path: never reaching the secure room. The Secret Service's
 * patience (SECURE_LIMIT from the warning) runs out, and it says why.
 * ------------------------------------------------------------------ */
{
  const sim = fakeSim();
  Pres.placeWalker(Pres.SPOTS.seat.x, Pres.SPOTS.seat.z); // nowhere near the secure room
  CAST.castStart(sim, 'mission', { roleId: 'president', cast: { story: Pres.STORY_ATTACK } });
  const story = CAST.castStory(Pres.STORY_ATTACK);
  const dt = 1 / 30;
  let t = 0;
  let failedAt = null;
  let leftAt30 = null;
  for (; t < 80; t += dt) {
    CAST.castUpdate(sim, dt);
    const i = info(story);
    if (leftAt30 == null && t > 30) leftAt30 = i.secureLeft;
    if (i.failWhy) {
      failedAt = t;
      break;
    }
  }
  ok('attack fail: the countdown is there to show (seconds left, counting down)', leftAt30 != null && leftAt30 > 10 && leftAt30 < Pres.SECURE_LIMIT, `${leftAt30}`);
  ok('attack fail: never walking to the secure room fails it, at warning + limit', failedAt != null && Math.abs(failedAt - (8 + Pres.SECURE_LIMIT)) < 1, `failed at ${failedAt}`);
  const iF = info(story);
  ok('attack fail: the reason is plain and kind (no wreck)', /Secret Service/.test(iF.failWhy || '') && /secure room/.test(iF.failWhy || ''), iF.failWhy);
  CAST.castStop(sim);
}

/* ------------------------------------------------------------------ *
 * Item 7: 80+ on "Under Attack" in any seat unlocks the Air Force One
 * aircraft. The President cannot stop a missile, so a run where the escort
 * lets a few through must still clear 80 if he did what was asked.
 * ------------------------------------------------------------------ */
{
  const sim = fakeSim();
  Pres.placeWalker(Pres.SPOTS.secureInside.x, Pres.SPOTS.secureInside.z);
  CAST.castStart(sim, 'mission', { roleId: 'president', cast: { story: Pres.STORY_ATTACK } });
  const s = CAST.castStory(Pres.STORY_ATTACK);
  for (let t = 0; t < 12; t += 1 / 30) CAST.castUpdate(sim, 1 / 30);
  const saved = s.attack.stats.hits;
  const scores = [0, 1, 2, 3].map((h) => {
    s.attack.stats.hits = h;
    return Pres.PRESIDENT_ATTACK.score({ elapsed: 220 });
  });
  s.attack.stats.hits = saved;
  ok('attack score: reaching the secure room quickly clears 80 with 0-3 missiles through', scores.every((v) => v >= 80), JSON.stringify(scores));
  ok('attack score: more missiles through still scores a little lower', scores[0] > scores[3], JSON.stringify(scores));
  CAST.castStop(sim);
}

/* ------------------------------------------------------------------ */

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}${r.detail && !r.pass ? `  — ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
