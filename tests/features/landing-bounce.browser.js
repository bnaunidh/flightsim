/**
 * The touchdown bounce in the real game (the flight model's numbers are in landing-bounce.mjs): a 737
 * put down hard comes back off its wheels a little, settles, and is ONE landing -- one touchdown card
 * with the hard grade, no "Airborne!" banner, no second landing in the logbook -- while a light single
 * put down the same way stays down.
 *
 *   node .claude/devtools/briefs/one-check.mjs '<url>?mute=1' ./tests/features/landing-bounce.browser.js check "" 1
 */
export const id = 'landing-bounce';

/** How far above its standing height the aeroplane is let go, metres. */
const DROP = 0.6;
const wait = (ms) => new Promise((f) => setTimeout(f, ms));

async function hardLanding(sim, type, sink) {
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  await sim.startMode('free', { aircraft: type, taxi: false, loadingScreen: false, time: 'day', condition: 'clear', windSpeedKts: 0, traffic: false });
  for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
  sim.step(0.5, 1 / 60);
  const ac = sim.aircraft;
  const seen = { cards: 0, banners: [], bounce: 0, touch: [] };
  const hud = sim.hud;
  const card = hud.showTouchdown;
  const banner = hud.showBanner;
  hud.showTouchdown = function (g, ...a) {
    seen.cards++;
    seen.card = { ...g };
    return card.call(this, g, ...a);
  };
  hud.showBanner = function (t, ...a) {
    seen.banners.push(String(t));
    return banner.call(this, t, ...a);
  };
  ac.on('bounce', () => seen.bounce++);
  ac.on('touchdown', (g) => seen.touch.push({ ...g }));
  const landings = sim.progress.landings;
  const takeoffs = sim.progress.takeoffs;
  try {
    // Over the runway at approach speed in its standing attitude, sinking, the wheels just off the ground.
    const fwd = ac.forward(ac.pos.clone().set(0, 0, 0));
    const P = await import('../../src/aircraft/physics.js');
    const { stallKnots } = await import('../../src/features/stall-speed.js');
    const v = (stallKnots(P.SPEC, { flaps: 1 }) * 1.25) / P.UNITS.KTS;
    ac.pos.y += DROP;
    ac.vel.set(fwd.x * v, -sink, fwd.z * v);
    ac.omega.set(0, 0, 0);
    ac.flaps = 1;
    ac.controls.flaps = 1;
    ac.onGround = false;
    ac.airborneTime = 5;
    let top = 0;
    let offT = 0;
    let touched = false;
    const y0 = ac.pos.y - DROP;
    for (let i = 0; i < 8 * 60 && !ac.crashed; i++) {
      sim.override = { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 0 };
      sim.step(1 / 60, 1 / 60);
      if (ac.onGround) touched = true;
      else if (touched) {
        offT += 1 / 60;
        top = Math.max(top, ac.pos.y - y0);
      }
    }
    return { ac, seen, top, offT, landings: sim.progress.landings - landings, takeoffs: sim.progress.takeoffs - takeoffs, y: ac.pos.y - y0 };
  } finally {
    hud.showTouchdown = card;
    hud.showBanner = banner;
    sim.override = null;
  }
}

export async function check(sim, r) {
  const realRender = sim.renderer.render;
  sim.renderer.render = () => {};
  const auto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  try {
    const b = await hardLanding(sim, 'b737', 3.2);
    const t0 = b.seen.touch[0];
    r.ok('bounce: a 737 put down hard is a rough landing, not a crash', !b.ac.crashed && !!t0 && t0.quality === 'rough', t0 ? `${t0.vsFpm} fpm, ${t0.quality}${b.ac.crashed ? ', ' + b.ac.crashReason : ''}` : 'no touchdown');
    r.ok('bounce: it comes back off the wheels, a little, and settles', b.seen.bounce >= 1 && b.top > 0.1 && b.top < 2.5 && b.offT < 5 && b.ac.onGround && Math.abs(b.y) < 0.3, `${b.seen.bounce} bounce, top ${b.top.toFixed(2)} m over standing height, off the wheels ${b.offT.toFixed(2)} s`);
    r.ok('bounce: one touchdown card, and it is the hard one', b.seen.cards === 1 && b.seen.card.quality === 'rough' && !b.seen.card.bounce, `${b.seen.cards} card(s), ${b.seen.card && b.seen.card.quality}; touches ${b.seen.touch.map((g) => `${g.vsFpm}${g.bounce ? 'b' : ''}`).join(', ')}`);
    r.ok('bounce: no "Airborne!" banner, one landing and no take-off in the logbook', !b.seen.banners.some((t) => /airborne/i.test(t)) && b.landings === 1 && b.takeoffs === 0, `banners [${b.seen.banners.join(', ')}], ${b.landings} landing(s), ${b.takeoffs} take-off(s)`);
    r.ok('bounce: the aeroplane remembers the hard touch', !!b.ac.lastTouchdown && b.ac.lastTouchdown.quality === 'rough', b.ac.lastTouchdown ? `${b.ac.lastTouchdown.vsFpm} fpm` : 'none');
    const s = await hardLanding(sim, 'skylark', 3.2);
    r.ok('bounce: a light single put down the same way stays down', !s.ac.crashed && s.seen.cards === 1 && s.top < 0.15 && s.ac.onGround, `top ${s.top.toFixed(2)} m, ${s.seen.bounce} bounce, ${s.seen.cards} card(s)${s.ac.crashed ? ', ' + s.ac.crashReason : ''}`);
  } finally {
    sim.renderer.render = realRender;
    sim.autoPauseOnHide = auto;
    sim.override = null;
    if (sim.state !== 'menu') sim.quitToMenu();
  }
}
