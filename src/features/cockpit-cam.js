/**
 * The cockpit camera's controls: snap views, zoom, and your last look per
 * aircraft. The head itself (into the turn, a little against the bank, eased
 * free look) is flight/camera.js's; this is what drives it.
 *
 * The owner, 2026-10-26: "new cockpit cam" — natural head, smooth free look,
 * zoom 35-90, snap views, per-aircraft eye point, remembers your last look,
 * works with the sidestick (the hat looks round: flight/controllers.js and
 * input.js) and on phones.
 *
 *   keys      numpad: 4 left, 6 right, 1 back, 3 up, 2 the panel, 5 straight
 *             ahead (and the zoom back to the aeroplane's own); * zoom in,
 *             / zoom out. The same snap again goes back to straight ahead.
 *             (Numpad 7-0 are the event cards' and 8 is taken, so the snaps
 *             sit round 5 where they can.)
 *   mouse     the wheel zooms (a trackpad pinch too); right-drag looks round
 *             with free look on, as before.
 *   touch     a finger on the picture looks round (input.js), two pinch to
 *             zoom.
 *   memory    the snap view (not "back") and the zoom are remembered per
 *             aircraft type, in this browser, and put back next time.
 *
 * Only in the cockpit view; the keys do nothing anywhere else. The eye point
 * is already per aircraft, at seat height (main.js: the model's eye, from
 * model-adapter.js eyeFor).
 */

import { registerExtension, registerActions } from '../game/extensions.js';
import { isKey } from '../flight/input.js';

const AIR = ['plane', 'heli'];
registerActions({
  camLookLeft: { label: 'Cockpit: look left (again: ahead)', group: 'View', ctx: AIR, default: ['Numpad4'] },
  camLookRight: { label: 'Cockpit: look right (again: ahead)', group: 'View', ctx: AIR, default: ['Numpad6'] },
  camLookBack: { label: 'Cockpit: look back over the shoulder (again: ahead)', group: 'View', ctx: AIR, default: ['Numpad1'] },
  camLookUp: { label: 'Cockpit: look up (again: ahead)', group: 'View', ctx: AIR, default: ['Numpad3'] },
  camLookPanel: { label: 'Cockpit: look down at the panel (again: ahead)', group: 'View', ctx: AIR, default: ['Numpad2'] },
  camLookFront: { label: 'Cockpit: straight ahead, zoom reset', group: 'View', ctx: AIR, default: ['Numpad5'] },
  camZoomIn: { label: 'Cockpit: zoom in', group: 'View', ctx: AIR, default: ['NumpadMultiply'] },
  camZoomOut: { label: 'Cockpit: zoom out', group: 'View', ctx: AIR, default: ['NumpadDivide'] },
});

const SNAP_KEYS = { camLookLeft: 'left', camLookRight: 'right', camLookBack: 'back', camLookUp: 'up', camLookPanel: 'panel' };
const STORE_KEY = 'islandsim.cockpitlook.v1';
const WORDS = { front: 'Ahead', left: 'Looking left', right: 'Looking right', back: 'Looking back', up: 'Looking up', panel: 'The panel' };

const C = { sim: null, typeId: null, saved: '', t: 0, pinch: null, touches: new Map() };

function readAll() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    return {};
  }
}

function writeAll(v) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch (e) {
    /* private window: it lasts the session */
  }
}

/** What is remembered: the snap (never "back": a new flight does not start looking behind you) and the zoom. */
export function rememberable(look) {
  return { snap: look && look.snap && look.snap !== 'back' ? look.snap : 'front', zoomFov: look && Number.isFinite(look.zoomFov) ? Math.round(look.zoomFov) : null };
}

function inCockpit(sim) {
  return !!(sim && sim.rig && sim.rig.mode === 'cockpit' && sim.state === 'flying' && sim.mode !== 'drive' && !(sim.liveMap && sim.liveMap.isOpen && sim.liveMap.isOpen()));
}

function restore(sim) {
  const t = sim.aircraftType && sim.aircraftType.id;
  if (!t || !sim.rig) return;
  C.typeId = t;
  const all = readAll();
  sim.rig.lookState = all[t] || null;
  C.saved = JSON.stringify(rememberable(sim.rig.lookState));
}

function save(sim) {
  const t = C.typeId;
  if (!t || !sim.rig) return;
  const now = JSON.stringify(rememberable(sim.rig.lookState));
  if (now === C.saved) return;
  C.saved = now;
  const all = readAll();
  all[t] = JSON.parse(now);
  writeAll(all);
}

function zoom(sim, k) {
  const f = sim.rig.zoomBy(k);
  return f;
}

function wire(sim) {
  const cv = sim.renderer && sim.renderer.domElement;
  if (!cv || cv._ccWired) return;
  cv._ccWired = true;
  cv.addEventListener('wheel', (e) => {
    if (!inCockpit(sim)) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    zoom(sim, Math.exp(-(e.deltaY * unit) * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });
  // Two fingers on the picture: pinch to zoom (one finger looks round: input.js).
  cv.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || e.__flyClaimed) return;
    C.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (C.touches.size === 2 && inCockpit(sim)) {
      const [a, b] = [...C.touches.values()];
      C.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      // The look finger stops looking while two pinch.
      if (sim.input) sim.input._lookFinger = null;
    }
  }, { passive: true });
  cv.addEventListener('pointermove', (e) => {
    if (!C.touches.has(e.pointerId)) return;
    C.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (C.pinch && C.touches.size >= 2 && inCockpit(sim)) {
      const [a, b] = [...C.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (C.pinch > 10 && d > 10) zoom(sim, d / C.pinch);
      C.pinch = d;
    }
  }, { passive: true });
  const up = (e) => {
    C.touches.delete(e.pointerId);
    if (C.touches.size < 2) C.pinch = null;
  };
  cv.addEventListener('pointerup', up, { passive: true });
  cv.addEventListener('pointercancel', up, { passive: true });
}

registerExtension({
  id: 'cockpit-cam',
  install(sim) {
    C.sim = sim;
    if (typeof document !== 'undefined') wire(sim);
    sim.cockpitCam = {
      snap: (name) => (sim.rig ? sim.rig.snapTo(name) : null),
      zoom: (k) => (sim.rig ? zoom(sim, k) : null),
      reset: () => sim.rig && sim.rig.resetLook(),
      state: () => (sim.rig ? sim.rig.lookState : null),
      remembered: () => readAll(),
    };
  },
  startMode(sim) {
    restore(sim);
  },
  update(sim, dt) {
    const t = sim.aircraftType && sim.aircraftType.id;
    if (t && t !== C.typeId) restore(sim);
    C.t += dt;
    if (C.t > 0.5) {
      C.t = 0;
      save(sim);
    }
  },
  key(sim, code, down, e) {
    if (!inCockpit(sim)) return false;
    for (const id in SNAP_KEYS) {
      if (!isKey(sim, id, code)) continue;
      if (down && !(e && e.repeat)) {
        const s = sim.rig.snapTo(SNAP_KEYS[id]);
        if (sim.hud) sim.hud.notify(`View: ${WORDS[s] || s}`, 'info', 1.2);
      }
      return true;
    }
    if (isKey(sim, 'camLookFront', code)) {
      if (down) {
        sim.rig.resetLook();
        if (sim.input) {
          sim.input.lookYaw = 0;
          sim.input.lookPitch = 0;
        }
      }
      return true;
    }
    if (isKey(sim, 'camZoomIn', code) || isKey(sim, 'camZoomOut', code)) {
      if (down) {
        const f = zoom(sim, isKey(sim, 'camZoomIn', code) ? 1.15 : 1 / 1.15);
        if (sim.hud && !(e && e.repeat)) sim.hud.notify(`Zoom ${Math.round(f)}°`, 'info', 1);
      }
      return true;
    }
    return false;
  },
});

export const __cockpitCam = { C, SNAP_KEYS, STORE_KEY };
