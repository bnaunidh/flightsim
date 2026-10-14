/**
 * FUN STUFF — smoke trails.
 *
 *   💨 SMOKE   T (or the 💨 button) leaves a coloured trail behind any
 *              aircraft, picked on the Fun Stuff screen (the gold button on
 *              the start screen). Saved on this device.
 *
 *              The trail turns into a cloud: each puff opens out, drifts with
 *              the wind and thins away over a minute or so, so a loop you
 *              flew hangs in the sky for a while (fun/fx.js). It comes from
 *              a smoke tank — about 20 seconds from full, about 30 seconds
 *              to fill again, shown by the small bar beside the 💨 button —
 *              so it is something you do every so often, not all the time.
 *              The tank empties, the smoke stops by itself; T and the
 *              button still just toggle.
 *
 * Nothing in main.js knows any of this is here: it plugs in through
 * game/extensions.js like every other feature, and a fault in it switches
 * off this feature alone.
 *
 * This used to also carry a Star Hunt, Stunts (pop-up scoring) and a sticker
 * book that paid for smoke colours — see git history. Smoke trails are what
 * is left; every colour is available from the start now that nothing gates
 * them.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { registerActions, isKey } from '../flight/input.js';

/*
 * T, in the one registry: Settings → Controls → Fun Stuff. The F-35B's hover
 * (stovl.js) has T too, by design: it takes T first in that one aeroplane.
 */
registerActions({
  smoke: { label: 'Smoke trail on / off', group: 'Fun Stuff', ctx: ['plane', 'heli'], default: ['KeyT'] },
});
import { loadFun, saveFun } from './fun/save.js';
import { activeColour, SmokeTank, smokeLight } from './fun/smoke.js';
import { SmokeTrail, SMOKE, rainbowAt, linearRGB } from './fun/fx.js';
import { FunHud, addMenuButton, buildFunScreen } from './fun/ui.js';

const F = {
  sim: null,
  data: null,
  hud: null,
  screen: null,
  menuBtn: null,
  smoke: null,
  time: 0,
  smokeOn: false,
  rgb: [1, 1, 1],
  pixelScale: 400,
  /** What is left to smoke with. */
  tank: new SmokeTank(),
  /** The sky's light on the smoke, and the wind that carries it (written in place each frame). */
  light: { sun: [1, 1, 1], amb: [1, 1, 1] },
  wind: new THREE.Vector3(),
  maxPx: 0,
};

const _tail = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/* ------------------------------------------------------------------ *
 * Who is playing what
 * ------------------------------------------------------------------ */

function craftOf(sim) {
  if (sim.mode === 'drive') return sim.game === 'car' ? 'car' : 'boat';
  const t = sim.aircraftType;
  return t && t.shape && t.shape.power && t.shape.power.rotor ? 'heli' : 'plane';
}

function crashedNow(sim, craft) {
  if (craft === 'boat' || craft === 'car') return !!(sim.vehicle && sim.vehicle.crashed);
  return !!(sim.aircraft && sim.aircraft.crashed);
}

function pixelScale(sim) {
  const cam = sim.camera;
  const r = sim.renderer;
  const pr = r && r.getPixelRatio ? r.getPixelRatio() : 1;
  const hgt = (typeof window !== 'undefined' ? window.innerHeight : 800) * pr;
  return hgt / (2 * Math.tan((((cam && cam.fov) || 68) * Math.PI) / 360));
}

/** The biggest point this graphics card will draw, asked once (big old puffs are capped to it). */
function maxPointPx(sim) {
  try {
    const gl = sim.renderer.getContext();
    const r = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    return r && r[1] > 0 ? r[1] : 64;
  } catch (e) {
    return 64;
  }
}

/* ------------------------------------------------------------------ *
 * Smoke
 * ------------------------------------------------------------------ */

function toggleSmoke(sim) {
  const craft = craftOf(sim);
  if (craft !== 'plane' && craft !== 'heli') return false;
  if (!F.smokeOn && !F.tank.canStart()) {
    // Dry, or nearly: say so, calmly, and let it fill.
    if (F.hud) F.hud.note('The smoke tank is filling up. Give it a few seconds.', 2.5);
    return true;
  }
  F.smokeOn = !F.smokeOn;
  if (F.smokeOn) {
    const c = activeColour(F.data);
    if (F.hud) F.hud.note(`Smoke on: ${c.name}. ${F.hud.chip.classList.contains('is-touch-fun') ? 'Tap 💨' : 'T'} turns it off.`, 2.5);
  } else if (F.smoke) {
    F.smoke.cut();
  }
  return true;
}

function tailPoint(sim, out) {
  const ac = sim.aircraft;
  const t = sim.aircraftType;
  const back = (t && t.plan && t.plan.tail) || 5;
  ac.forward(_fwd);
  return out.copy(ac.pos).addScaledVector(_fwd, -back * 0.95);
}

/* ------------------------------------------------------------------ *
 * The Fun Stuff screen
 * ------------------------------------------------------------------ */

function model() {
  return { colour: activeColour(F.data).id };
}

function openFun(sim) {
  if (!F.screen) return;
  try {
    F.screen.render();
  } catch (e) {
    console.warn('[fun] the Fun Stuff screen could not draw:', e);
  }
  sim.menus.show('fun');
  if (sim.audio && sim.audio.available && sim.audio.alerts && sim.audio.alerts.uiClick) sim.audio.alerts.uiClick();
}

/* ------------------------------------------------------------------ *
 * The frame
 * ------------------------------------------------------------------ */

function update(sim, dt) {
  F.sim = sim;
  if (!F.data) return;
  F.time += dt;
  const craft = craftOf(sim);
  const crashed = crashedNow(sim, craft);
  F.pixelScale = pixelScale(sim);

  // Smoke.
  const smokeOk = craft === 'plane' || craft === 'heli';
  if (F.smoke) {
    // Not while parked: a smoking aeroplane standing on the apron is a fire.
    const parked = sim.aircraft && sim.aircraft.onGround && sim.aircraft.vel.lengthSq() < 25;
    const puffing = !!(F.smokeOn && smokeOk && !crashed && sim.aircraft && !parked);
    if (puffing) {
      const c = activeColour(F.data);
      const rgb = c.rgb ? linearRGB(c.rgb, F.rgb) : rainbowAt(F.time, F.rgb);
      F.smoke.emit(dt, F.time, tailPoint(sim, _tail), rgb);
    } else {
      F.smoke.cut();
    }
    // The tank empties while smoke comes out and fills while it does not.
    if (F.tank.update(dt, puffing) === 'empty') {
      F.smokeOn = false;
      F.smoke.cut();
      if (F.hud) F.hud.note('Smoke tank empty. It fills up again in about half a minute.', 3.5);
    }
    if (!F.maxPx) {
      F.maxPx = maxPointPx(sim);
      F.smoke.setMaxPointPx(F.maxPx);
    }
    const w = sim.weather;
    if (w) {
      smokeLight(w.time, w.cond ? w.cond.cloud : 0, F.light);
      if (w.windVector) w.windVector(F.wind);
    }
    F.smoke.update(F.time, F.pixelScale, F.light, w ? F.wind : null);
  }

  // The chip.
  if (F.hud) {
    // Not for a passenger (sim.riding, Air Force One's President seat): the
    // trail belongs to whoever is flying, and nobody is flying from there.
    const show = sim.state === 'flying' && !(sim.hud && sim.hud.hidden) && !sim.riding;
    F.hud.setVisible(show);
    if (show) {
      F.hud.set({ smokeOk, smokeOn: F.smokeOn && smokeOk, tank: F.tank.level, dry: !F.tank.canStart() });
      F.hud.place(dt, typeof document !== 'undefined' ? document.body : null);
    }
  }
}

/* ------------------------------------------------------------------ *
 * The plug-in
 * ------------------------------------------------------------------ */

registerExtension({
  id: 'fun',

  install(sim) {
    F.sim = sim;
    F.data = loadFun();
    F.hud = new FunHud({ onSmoke: () => toggleSmoke(sim), touch: !!sim.touch });
    F.menuBtn = addMenuButton(sim.menus, () => openFun(sim));
    F.screen = buildFunScreen(sim.menus, {
      model,
      onColour: (id) => {
        F.data.smoke.color = id;
        saveFun(F.data);
      },
    });
    // The chip sits above the menus (the plug-in layer is), so it goes the
    // moment the game stops flying: update() is not called to do it while
    // the pause menu is up.
    if (typeof setInterval === 'function') {
      setInterval(() => {
        if (F.hud && sim.state !== 'flying') F.hud.setVisible(false);
      }, 250);
    }
  },

  buildWorld(sim, group) {
    // A new trail for every world: the old one went with the old world.
    F.smoke = new SmokeTrail(SMOKE.pool);
    F.maxPx = 0;
    group.add(F.smoke.points);
  },

  startMode(sim, mode) {
    F.smokeOn = false;
    F.tank.reset();
    if (F.smoke) F.smoke.clear();
  },

  stop(sim) {
    if (F.smoke) F.smoke.clear();
    F.smokeOn = false;
    F.tank.reset();
    if (F.hud) {
      F.hud.setVisible(false);
      F.hud.clearPops();
    }
  },

  update,

  key(sim, code, down, e) {
    if (!isKey(sim, 'smoke', code)) return false;
    const craft = craftOf(sim);
    if (craft !== 'plane' && craft !== 'heli') return false;
    if (down && !(e && e.repeat)) toggleSmoke(sim);
    return true;
  },
});

/* For the tests. */
export const __test = { F, toggleSmoke, model, openFun, craftOf };
