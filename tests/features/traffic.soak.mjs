/**
 * The traffic left running, on every map, with no page.
 *
 *   node tests/features/traffic.soak.mjs                 30 min on every map
 *   node tests/features/traffic.soak.mjs 10 sfo lax      10 min on two maps
 *
 * The real extension hooks, driven by traffic.harness.mjs with a stand-in for
 * the game, for half an hour of game time per map in three ways the player
 * can be: out of the way in the air, sat at the start of runway 09 for the
 * first ten minutes, and parked on the parallel taxiway for the first ten.
 * Checked every tenth of a second, the things a child would see go wrong:
 *
 *   - two traffic aeroplanes inside each other on the ground, or a nose,
 *     tail or wing of one within a metre of another's (harness crossGap)
 *   - one driving through the player's aeroplane, or touching it
 *   - a wing tip through a hangar, the fire station, the terminal
 *   - one below the ground in the air, or at a position that is not a number
 *   - a deadlock that had to be broken (counted by the extension itself)
 *   - one stuck on the ground in the middle of moving for five minutes
 *   - the extension switched off because a hook threw
 *
 * And that the day goes round: aeroplanes take off, and come back and park.
 * A map the traffic does not run on is listed with its reason.
 */

const H = await import('./traffic.harness.mjs');
const { MAPS } = await import(new URL('../../src/world/maps.js', import.meta.url).href);

const args = process.argv.slice(2);
const minutes = Number.isFinite(+args[0]) && args.length ? +args.shift() : 30;
/*
 * The apron at 'low' (every stand free, so the most traffic) and at 'high'
 * (the game's default: the airport parks six of its own on the stands, and
 * the traffic has fewer). `--quality=high` for one of them.
 */
const qArg = args.find((a) => a.startsWith('--quality='));
const QUALITIES = qArg ? [qArg.slice(10)] : ['low', 'high'];
const only = args.filter((a) => !a.startsWith('--')).length ? new Set(args.filter((a) => !a.startsWith('--'))) : null;

let failed = 0;
let checks = 0;
function ok(name, pass, detail = '') {
  checks++;
  if (!pass) {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return pass;
}

const WAYS = [
  ['open sky', (sim, f) => H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 60 }), null],
  ['on the runway', (sim, f) => H.placePlayer(sim, f.west + 80, f.cz, { headingDeg: 90 }), 10],
  ['on the taxiway', (sim, f) => H.placePlayer(sim, f.twX0 + 50, f.twZ, { headingDeg: 270 }), 10],
  /*
   * A busy field: the Dev buttons pressed until they say no (six, where
   * there are slots for six), every other one arriving, with you on the
   * runway for the first eight minutes. The first three ways never had more
   * than four about, and never caught a Tempest stepping aside for an
   * arrival a few seconds after lift-off and flying under the runway, or an
   * arrival on final flying through one holding beside it.
   */
  ['busy, on the runway', (sim, f) => H.placePlayer(sim, f.west + 80, f.cz, { headingDeg: 90 }), 8, true],
  /*
   * A child chasing them, from behind, at a quarter as fast again as the one
   * chased: the way the review caught a go-around jumping up to 1.3 km in a
   * frame (40 times in 10 runs of 20 min). The chase itself still ends in
   * reach of the one chased (see the header of traffic.js); what is checked
   * here is that nothing jumps and nothing else goes wrong while it happens.
   */
  ['chased', (sim, f) => H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 60 }), null, false, (sim) => H.chaser(sim, 1.25)],
];

const t0 = Date.now();
for (const quality of QUALITIES) for (const map of MAPS) {
  if (only && !only.has(map.id)) continue;
  // Every map with a runway, not only the ones offered for flying: the
  // traffic runs wherever a Free Flight can start.
  H.loadMap(map.id, quality);
  const f = H.F.buildField();
  if (!f.ok) {
    if (quality === QUALITIES[0]) console.log(`${map.id}: no traffic — ${f.why}`);
    continue;
  }
  for (const [way, place, leaveAfter, busy, drive] of WAYS) {
    const sim = H.makeSim({ typeId: 'skylark', quality });
    place(sim, f);
    // A different mix each way round, the same one every run.
    const seed = 1 + map.id.length * 7 + WAYS.findIndex((w) => w[0] === way) * 13;
    const r = H.startFlight(sim, { trafficSeed: seed });
    const tag = `${map.id} ${quality} ${way}`;
    if (!ok(`${tag}: the flight starts`, r.ok, r.ok ? '' : String(r.err && r.err.stack))) continue;
    const st0 = H.TF.trafficState();
    if (!st0.on) {
      console.log(`${tag}: traffic off — ${st0.why}`);
      continue;
    }
    if (busy) for (let i = 0; i < 8; i++) H.TF.spawnTraffic(sim, i % 2 ? 'arrive' : 'depart');
    const W = H.makeWatch(sim);
    const ga0 = { ...H.TF.trafficState().stats };
    const each = drive ? drive(sim) : null;
    // The player leaves after `leaveAfter` minutes: up and away, out of it.
    H.run(sim, W, minutes * 60, 0.1, (t, dt) => {
      if (leaveAfter != null && t >= leaveAfter * 60 && t < leaveAfter * 60 + 0.1) {
        H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 60 });
      }
      if (each) each(t, dt);
    });
    const s = H.summary(W);
    const st = H.TF.trafficState();
    const gaN = st.stats.goArounds - ga0.goArounds;
    const gaU = st.stats.unstable - ga0.unstable;
    const types = [...new Set(W.types)].join(',');
    console.log(`${tag}: ${s.departures} departures, ${s.parked} parked, types ${types}, stillest ${s.stillest} s, closest pair ${s.minPairOnGround} m (gap ${s.minGapOnGround} m), closest to you ${s.minToPlayerOnGround} m (gap ${s.minGapToPlayer} m), closest pair in the air ${s.minAirPair} m, jumps ${s.jumps}, go-arounds ${gaN} (${gaU} not back on the centreline)`);
    ok(`${tag}: no hook threw`, !s.threw, s.threw || '');
    ok(`${tag}: no two aeroplanes inside each other`, s.merged === 0, s.mergedFirst || '');
    ok(`${tag}: nobody through the player`, s.throughPlayer === 0, s.playerFirst || '');
    ok(`${tag}: no nose, tail or wing within a metre of another's`, s.touching === 0, s.touchFirst || '');
    ok(`${tag}: no nose, tail or wing within a metre of yours`, s.touchingPlayer === 0, s.touchPlayerFirst || '');
    ok(`${tag}: nobody flies through anybody`, s.airHit === 0, s.airHitFirst || '');
    // Stepping aside for each other: 350 m wanted, and never under 100.
    ok(`${tag}: two in the air never within 100 m`, s.minAirPair == null || s.minAirPair >= 100, `${s.minAirPair} m: ${s.minAirWhat}`);
    ok(`${tag}: no wing through a building`, s.tips === 0, s.tipsFirst || '');
    ok(`${tag}: no deadlock had to be broken`, s.deadlocks === 0, `${s.deadlocks}`);
    ok(`${tag}: nothing below the ground or lost`, s.under === 0 && s.nan === 0, `${s.under} under, ${s.nan} NaN`);
    ok(`${tag}: nobody jumps further in a frame than it can fly`, s.jumps === 0, `${s.jumps}: ${s.jumpFirst}`);
    ok(`${tag}: nobody stuck mid-taxi for five minutes`, s.stillest < 300, `${s.stillest} s: ${s.stillWhy}`);
    // Waiting for a clear way, once you are out of it: never long. (With you
    // parked on the taxiway for ten minutes some wait that long, and should.)
    if (way === 'open sky') ok(`${tag}: nobody waits three minutes to taxi`, s.longestWait < 180, `${s.longestWait} s: ${s.waitWhy}`);
    // (Chased, arrivals go round for the chaser again and again; not counted.)
    if (minutes >= 20 && !drive) ok(`${tag}: the day goes round`, s.departures >= 2 && s.parked >= 1, `${s.departures} departures, ${s.parked} parked`);
    H.call('stop', sim, 'menu');
  }
}
console.log(`\ntraffic soak: ${checks - failed}/${checks} checks passed, ${minutes} min a run, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exitCode = failed ? 1 : 0;
