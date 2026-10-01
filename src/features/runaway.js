/**
 * The runaway plane.
 *
 * "in smaller planes, if you get out with power on, the plane will fly itself
 * lmao and might even hit u" — the owner.
 *
 * In a light aeroplane (the Skylark, the Courier, anything else a person bails
 * out of rather than ejects from — see eject/profiles.js `runaway`), get out
 * with the engine running and the power up and she goes without you: rolls
 * off, and with enough power takes off, climbs, wanders round in a big lazy
 * circle back over where you left her, runs out of puff after a while and
 * comes down — landing or crashing, the flight model decides. On the ground
 * she can run you over: WASTED (wasted.js), and you get back up.
 *
 * FAIR:
 *   - Engine off, or the power at idle: she is parked, exactly as before.
 *   - Power on, the first O only warns — "Power's still on — she'll go
 *     without you!" — and the get-out prompt says the same while you sit
 *     there on the brakes. The second O within three seconds hops you out.
 *   - Only in Free Flight with no mission running. A mission that asks you
 *     to get out parks the aeroplane whatever the lever says, as it always did.
 *   - Findable: she is at the middle of the minimap all along (the map
 *     follows the aeroplane) and a "YOU" pin shows where you are; when she
 *     stops or crashes the game says so, and Enter flies again.
 *   - Catch her before she gets away and O puts you back in the seat.
 *   - Her crash does not end the flight with a "Crashed" screen: nobody was
 *     in it.
 *
 * HOW, without main.js: onfoot.js asks this file whether to park the
 * aeroplane (onFoot.setExitRule); if not, the empty aeroplane is flown through
 * `sim.override` — the input main.js lays over the keyboard every frame — by
 * a ghost pilot below. `sim.walking` says the pilot is out, which quietens
 * the cockpit warnings (warnings.js) and lets go of the F-35B's hover.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { EVENTS } from '../aircraft/physics.js';
import { performanceFor } from '../aircraft/types.js';
import { onFoot } from './onfoot.js';
import { local } from './staff/jobs.js';
import { WALK } from './staff/walk.js';
import { profileFor } from './eject/profiles.js';
import { showWasted, wasted } from './wasted.js';
import { saveSettings } from '../core/storage.js';

const KT = 1.94384;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const RUNAWAY = {
  idle: 0.15, // throttle above this is "power on" (onfoot.js's own idle line)
  hopSpeed: 8, // m/s: with the power on you may hop out while she rolls
  armSeconds: 3, // the second O must come within this
  grace: 1.2, // seconds after you hop out before she can hit you
  hitSpeed: 1.5, // m/s: slower than this she only nudges
  puffAfter: 45, // seconds of running before the engine runs out of puff
  airPuffAfter: 28, // seconds in the air before it does
  climbTo: 70, // metres over the ground she climbs to
  crashKnock: 18, // metres: her crash this close knocks you over too
};

const R = {
  sim: null,
  active: false,
  armedT: 0,
  ac: null,
  ghost: { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 0 },
  throttle: 0,
  t: 0,
  airT: 0,
  phase: 'off', // 'roll' | 'air' | 'puffed' | 'stopped' | 'crashed' | 'off'
  puffed: false,
  said: {},
  exitAt: new THREE.Vector3(),
  /** Her heading when you got out: on the ground she holds it, down the runway. */
  exitHdg: 0,
  agl0: 0,
  wasInside: false,
  grace: 0,
  hitCool: 0,
  hits: 0,
  boundAc: null,
  control: null,
  pins: [],
  youPin: { x: 0, z: 0, label: 'YOU', colour: '#58c6ff' },
  maxDist: 0,
  lastWasted: null,
};

function notify(sim, text, kind = 'info', secs = 4) {
  try {
    if (sim.hud && sim.hud.notify) sim.hud.notify(text, kind, secs);
  } catch (e) {
    /* a HUD that is not there is not worth a thrown frame */
  }
}

function banner(sim, title, sub, kind = 'good', secs = 4.5) {
  try {
    if (sim.hud && sim.hud.showBanner) sim.hud.showBanner(title, sub, kind, secs);
  } catch (e) {
    /* same */
  }
}

function isTouch(sim) {
  return !!(sim && sim.touch);
}

function missionRunning(sim) {
  return !!(sim.runner && sim.runner.status === 'running');
}

/** A light aeroplane, in Free Flight, sitting on its wheels with the engine going. */
function eligible(sim) {
  if (!sim || sim.state !== 'flying' || sim.mode !== 'free' || missionRunning(sim)) return false;
  const ac = sim.aircraft;
  const type = sim.aircraftType;
  if (!ac || !type || ac.crashed || !ac.onGround) return false;
  if (!profileFor(type).runaway) return false;
  return !!(ac.engineOn || ac.starting > 0);
}

function powerOn(sim) {
  const ac = sim.aircraft;
  return !!(ac && ac.controls && ac.controls.throttle > RUNAWAY.idle);
}

/**
 * The owner's switch (pause menu → Getting out): "Runaway plane & WASTED".
 * On unless the kid turned it off; off, getting out parks her as ever.
 */
export function runawayOn(sim) {
  return !(sim && sim.settings && sim.settings.runawayPlane === false);
}

/** What onfoot.js asks before it parks the aeroplane (onFoot.setExitRule). */
const RULE = {
  maxSpeed(sim) {
    return runawayOn(sim) && eligible(sim) && powerOn(sim) ? RUNAWAY.hopSpeed : 0;
  },
  decide(sim) {
    if (!runawayOn(sim) || !eligible(sim) || !powerOn(sim)) return null;
    if (R.armedT <= 0) {
      R.armedT = RUNAWAY.armSeconds;
      return {
        why: isTouch(sim)
          ? 'Power’s still on — she’ll go without you! Tap again to hop out anyway, or pull the power back first.'
          : 'Power’s still on — she’ll go without you! Press <kbd>O</kbd> again to hop out anyway, or pull the power back first.',
      };
    }
    R.armedT = 0;
    start(sim);
    return { leave: true };
  },
  prompt(sim) {
    if (!eligible(sim) || !powerOn(sim)) return '';
    return isTouch(sim)
      ? '<b>Power’s still on</b> — she’ll go without you! Tap to hop out'
      : '<b>Power’s still on</b> — she’ll go without you! <kbd>O</kbd> to hop out';
  },
};

/* ------------------------------------------------------------------ */
/* She's off                                                            */
/* ------------------------------------------------------------------ */

function start(sim) {
  const ac = sim.aircraft;
  R.sim = sim;
  R.active = true;
  R.ac = ac;
  R.t = 0;
  R.airT = 0;
  R.phase = 'roll';
  R.puffed = false;
  R.said = {};
  R.throttle = clamp(ac.controls.throttle, 0.2, 1);
  R.exitAt.copy(ac.pos);
  R.exitHdg = ac.heading;
  R.agl0 = ac.agl;
  R.wasInside = true; // standing beside her as you hop out is not being hit
  R.grace = RUNAWAY.grace;
  R.hitCool = 0;
  R.maxDist = 0;
  const g = R.ghost;
  g.throttle = R.throttle;
  g.pitch = 0;
  g.roll = 0;
  g.yaw = 0;
  g.brakes = 0;
  ac.parkingBrake = false;
  sim.override = g;
  // warnings.js and stovl.js read this: nobody is in the aeroplane.
  sim.walking = { active: true, ejected: true, runaway: true };
  sim.mapPins = R.pins;
  R.pins.length = 0;
  R.pins.push(R.youPin);
  R.control = walkControl(sim);
  bindAircraft(sim);
  banner(sim, 'Runaway plane!', isTouch(sim)
    ? 'She’s going without you! Catch her and tap to hop back in — or keep out of her way.'
    : 'She’s going without you! Catch her and press <kbd>O</kbd> to hop back in — or keep out of her way.', 'warn', 5);
}

/** Put everything back: you got back in, flew again, or went to the menu. */
function end(sim, why) {
  if (!R.active) return;
  R.active = false;
  R.phase = 'off';
  if (sim) {
    if (sim.override === R.ghost) sim.override = null;
    if (sim.walking && sim.walking.runaway) sim.walking = null;
    if (sim.mapPins === R.pins) sim.mapPins = null;
    if (R.control && onFoot.control === R.control) onFoot.setControl(null);
    if (why === 'caught') notify(sim, 'Got her! You caught your runaway plane.', 'good', 4);
  }
  R.control = null;
  R.pins.length = 0;
}

/* ------------------------------------------------------------------ */
/* The ghost pilot                                                      */
/* ------------------------------------------------------------------ */

function fly(sim, dt) {
  const ac = sim.aircraft;
  const g = R.ghost;
  if (sim.override !== g && !ac.crashed) sim.override = g;
  g.yaw = 0;
  if (ac.crashed) {
    g.throttle = 0;
    g.pitch = 0;
    g.roll = 0;
    R.phase = 'crashed';
    return;
  }
  const pitchNow = ac.pitchAngleDeg();
  const bank = ac.bankAngleDeg();
  const pitchTo = (deg) => clamp((deg - pitchNow) * 0.08 - ac.omega.x * 1.2, -1, 1);
  const bankTo = (deg) => clamp((deg - bank) / 16, -0.7, 0.7);
  const puff = () => {
    if (R.puffed) return;
    R.puffed = true;
    notify(sim, 'Your runaway plane ran out of puff — she’s coming down.', 'info', 4);
  };
  if (!R.puffed && (R.t > RUNAWAY.puffAfter || R.airT > RUNAWAY.airPuffAfter)) puff();

  if (ac.onGround) {
    // Rolling: straight on, and off the ground if she gets fast enough.
    const vr = (performanceFor(sim.aircraftType.id).stallClean / KT) * 0.95;
    g.throttle = R.puffed ? 0 : R.throttle;
    g.brakes = R.puffed ? 1 : 0;
    // Nine degrees was not enough to lift the Skylark off in still air through
    // the game's own frame loop (66 kt, nose at 6, rolling on); twelve is.
    g.pitch = !R.puffed && ac.ias > vr ? pitchTo(12) : 0;
    g.roll = bankTo(0);
    // Straight on down the runway: without a foot on the rudder she wandered
    // off it onto the grass at take-off speed and never left the ground.
    const off = ((R.exitHdg - ac.heading + 540) % 360) - 180;
    g.yaw = clamp(off * 0.06 + (ac.omega.y || 0) * 0.8, -1, 1);
    if (R.airT > 0.5) R.phase = 'landed';
    else if (R.phase !== 'stopped') R.phase = 'roll';
    if (ac.groundSpeed < 0.3 && (R.puffed || R.t > 3) && R.phase !== 'stopped') {
      R.phase = 'stopped';
      if (!R.said.stopped) {
        R.said.stopped = true;
        const d = Math.round(Math.hypot(ac.pos.x - onFoot.walker.x, ac.pos.z - onFoot.walker.z));
        notify(sim, `Your plane stopped ${d} m away — she’s in the middle of the map. Walk over and press O.`, 'good', 5);
      }
    }
    return;
  }
  // Flying herself: climb, then circle lazily back over where you left her.
  R.phase = 'air';
  R.airT += dt;
  if (!R.said.air) {
    R.said.air = true;
    notify(sim, 'She took off without you!', 'warn', 3.5);
  }
  const dx = R.exitAt.x - ac.pos.x;
  const dz = R.exitAt.z - ac.pos.z;
  const brg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const err = ((brg - ac.heading + 540) % 360) - 180;
  const far = Math.hypot(dx, dz);
  if (R.puffed) {
    g.throttle = 0;
    // A gentle glide, and a flare near the ground: she may even land.
    g.pitch = pitchTo(ac.agl < 8 ? 2 : -3);
    g.roll = bankTo(far > 700 ? clamp(err * 0.4, -12, 12) : 0);
  } else {
    g.throttle = R.throttle;
    const high = ac.agl > RUNAWAY.climbTo;
    g.pitch = pitchTo(high ? 1.5 : 7);
    g.roll = bankTo(R.airT < 6 ? 0 : clamp(err * 0.6, -26, 26));
  }
}

/* ------------------------------------------------------------------ */
/* Getting run over                                                     */
/* ------------------------------------------------------------------ */

/** Is (x, z) inside her, where a walker would be hit? Low enough, too. */
function inside(ac, prof, x, z, lift) {
  const l = local(ac.pos.x, ac.pos.z, ac.heading, x, z, {});
  const inBody = l.along < prof.nose + 0.3 && l.along > prof.tail - 0.2 && Math.abs(l.side) < prof.halfWidth + 0.35 && lift < 1.6;
  const inWing = prof.wingH + lift < WALK.height + 0.2
    && l.along < prof.wingFront + 0.2 && l.along > prof.wingBack - 0.2 && Math.abs(l.side) < (prof.wingSpan || prof.halfSpan) + 0.2;
  return inBody || inWing;
}

function hitCheck(sim, dt) {
  R.grace -= dt;
  R.hitCool -= dt;
  const ac = sim.aircraft;
  const from = onFoot.from;
  if (!onFoot.active || !from || !from.prof || ac.crashed) {
    R.wasInside = false;
    return;
  }
  const w = onFoot.walker;
  const lift = Math.max(0, ac.agl - R.agl0);
  const inn = inside(ac, from.prof, w.x, w.z, lift) && !w.air;
  const speed = Math.hypot(ac.vel.x, ac.vel.z);
  if (inn && !R.wasInside && R.grace <= 0 && R.hitCool <= 0 && speed > RUNAWAY.hitSpeed && !wasted.active) {
    R.hits++;
    R.hitCool = 6;
    R.lastWasted = { t: R.t, speedKt: Math.round(speed * KT) };
    const prof = from.prof;
    showWasted(sim, 'plane', {
      own: true,
      push: { x: ac.vel.x, z: ac.vel.z },
      words: 'Run over by your own plane. Up you get!',
      avoid: (x, z) => inside(ac, prof, x, z, 0),
    });
  }
  R.wasInside = inn;
}

/* ------------------------------------------------------------------ */
/* Her crash                                                            */
/* ------------------------------------------------------------------ */

function bindAircraft(sim) {
  const ac = sim.aircraft;
  if (!ac || R.boundAc === ac || typeof ac.on !== 'function') return;
  R.boundAc = ac;
  ac.on(EVENTS.CRASH, () => {
    try {
      if (!R.active) return;
      R.phase = 'crashed';
      banner(sim, 'Your runaway plane crashed!', isTouch(sim)
        ? 'Nobody was in it. She’s in the middle of the map — or tap Fly again.'
        : 'Nobody was in it. She’s in the middle of the map — or press <kbd>Enter</kbd> to fly again.', 'good', 5);
      const w = onFoot.walker;
      if (onFoot.active && Math.hypot(ac.pos.x - w.x, ac.pos.z - w.z) < RUNAWAY.crashKnock && !wasted.active) {
        R.lastWasted = { t: R.t, crash: true };
        showWasted(sim, 'crash', {
          own: true,
          push: { x: w.x - ac.pos.x, z: w.z - ac.pos.z },
          words: 'Your plane crashed right on top of you. Up you get!',
        });
      }
    } catch (e) {
      console.warn('[runaway] crash handler failed', e);
    }
  });
}

/* ------------------------------------------------------------------ */
/* On foot while she's away                                             */
/* ------------------------------------------------------------------ */

const WALK_BUTTONS = [
  { id: 'run', label: 'Run' },
  { id: 'jump', label: 'Jump' },
  { id: 'view', label: 'View' },
  { id: 'again', label: 'Fly again' },
];

function flyAgain(sim) {
  try {
    if (typeof sim.restart === 'function') sim.restart();
  } catch (e) {
    console.warn('[runaway] could not restart', e);
  }
}

/** Enter (or the button) flies again; everything else is the walker's. */
function walkControl(sim) {
  const again = () => flyAgain(sim);
  return {
    runaway: true,
    get prompt() {
      const touch = isTouch(sim);
      if (R.phase === 'crashed') {
        return touch ? 'Your plane crashed without you! Tap here to fly again' : 'Your plane crashed without you! <kbd>Enter</kbd> fly again';
      }
      if (R.phase === 'stopped') {
        return touch ? 'She stopped! Walk to her (middle of the map) · tap here to start again' : 'She stopped! Walk to her (middle of the map) · <kbd>Enter</kbd> start again';
      }
      return touch ? 'Runaway! Chase her — or tap here to start again' : 'Runaway! Chase her and press <kbd>O</kbd> · <kbd>Enter</kbd> start again';
    },
    promptAction: again,
    buttons: WALK_BUTTONS,
    onButton: (id) => {
      if (id === 'again') again();
    },
    key: (s, code, down) => {
      if (code !== 'Enter' && code !== 'NumpadEnter') return false;
      if (down) again();
      return true;
    },
  };
}

function updatePins(sim) {
  const w = onFoot.walker;
  R.youPin.x = w.x;
  R.youPin.z = w.z;
  if (sim.mapPins !== R.pins) sim.mapPins = R.pins;
  const ac = sim.aircraft;
  R.maxDist = Math.max(R.maxDist, Math.hypot(ac.pos.x - R.exitAt.x, ac.pos.z - R.exitAt.z));
}

/* ------------------------------------------------------------------ */
/* The pause-menu switch                                                */
/* ------------------------------------------------------------------ */

function toggleLabel(sim) {
  return `Runaway plane & WASTED: ${runawayOn(sim) ? 'on' : 'off'}`;
}

/** A "Getting out" fold in the pause menu with one switch, put there by this feature (menus.js need not know). */
export function paintPauseSwitch(sim) {
  const pause = sim && sim.menus && sim.menus.screens && sim.menus.screens.pause;
  if (!pause || typeof pause.querySelector !== 'function') return false;
  let btn = pause.querySelector('[data-runaway-toggle]');
  if (!btn) {
    const fold = document.createElement('details');
    fold.className = 'pause-fold';
    fold.dataset.runawayFold = '';
    fold.innerHTML = '<summary>🛫 Getting out</summary>'
      + '<div class="pause-actions"><button data-runaway-toggle></button></div>'
      + '<p class="hint tiny">On: get out of a small plane with the power on and she takes off without you — '
      + 'stand in her way and you get WASTED. Off: she stays parked, like before.</p>';
    const view = pause.querySelector('[data-freelook]');
    const after = view && view.closest('.pause-fold');
    if (after && after.parentNode) after.parentNode.insertBefore(fold, after.nextSibling);
    else (pause.querySelector('.pause-card') || pause).appendChild(fold);
    btn = fold.querySelector('[data-runaway-toggle]');
    btn.addEventListener('click', () => {
      sim.settings = sim.settings || {};
      sim.settings.runawayPlane = !runawayOn(sim);
      try { saveSettings(sim.settings); } catch (e) { /* private window: this flight only */ }
      paintPauseSwitch(sim);
    });
  }
  const on = runawayOn(sim);
  btn.textContent = toggleLabel(sim);
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  return true;
}

registerExtension({
  id: 'runaway',

  install(sim) {
    R.sim = sim;
    onFoot.setExitRule(RULE);
    paintPauseSwitch(sim);
    bindAircraft(sim);
    // Her crash is not the end of your flight: you were not in it.
    if (typeof sim.showCrashDebrief === 'function' && !sim._runawayDebrief) {
      const inner = sim.showCrashDebrief;
      sim._runawayDebrief = true;
      sim.showCrashDebrief = function crashDebriefUnlessRunaway(...args) {
        if (R.active) return undefined;
        return inner.apply(this, args);
      };
    }
    // Nor are the map's terrain warnings for her yours to hear.
    const mm = sim.minimap;
    if (mm && typeof mm.warningFor === 'function' && !mm._runawayWarn) {
      const inner = mm.warningFor;
      mm._runawayWarn = true;
      mm.warningFor = function warningUnlessRunaway(...args) {
        if (R.active) return null;
        return inner.apply(this, args);
      };
    }
  },

  startMode(sim) {
    paintPauseSwitch(sim);
    end(sim, 'start');
    R.armedT = 0;
    bindAircraft(sim);
  },

  stop(sim) {
    end(sim, 'stop');
    R.armedT = 0;
  },

  update(sim, dt) {
    if (R.armedT > 0) R.armedT = Math.max(0, R.armedT - dt);
    if (!R.active) return;
    const f = onFoot.from;
    // Back in the seat (you caught her), or walking has ended some other way.
    if (!onFoot.active || !f || !f.runaway) {
      end(sim, sim.aircraft && !sim.aircraft.crashed && onFoot.from === null && !onFoot.active ? 'caught' : 'gone');
      return;
    }
    R.t += dt;
    fly(sim, dt);
    hitCheck(sim, dt);
    updatePins(sim);
    // Our prompt and the fly-again key, unless somebody else has the walker.
    if (!wasted.active && onFoot.control !== R.control && (!onFoot.control || onFoot.control.runaway)) onFoot.setControl(R.control);
  },

  devActions: [
    {
      label: 'Runaway: Skylark at full power',
      hint: 'On the runway, power up, brakes on — press O twice',
      async run(sim) {
        await sim.startMode('free', { aircraft: 'skylark', taxi: false });
        if (sim.input) sim.input.throttleTarget = 1;
      },
    },
  ],
});

/** For the tests and the console. */
export const runaway = {
  get active() {
    return R.active;
  },
  get phase() {
    return R.phase;
  },
  get hits() {
    return R.hits;
  },
  get armed() {
    return R.armedT > 0;
  },
  get maxDist() {
    return R.maxDist;
  },
  get airT() {
    return R.airT;
  },
  get t() {
    return R.t;
  },
  get exitAt() {
    return R.exitAt;
  },
  get lastWasted() {
    return R.lastWasted;
  },
  get ghost() {
    return R.ghost;
  },
  rule: RULE,
};
