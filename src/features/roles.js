/**
 * Seats: "in some missions you can play as another plane — like hijacking,
 * you can be the lead fighter jet".
 *
 * The plug-in half of it. The seat data lives on the missions
 * (src/game/roles/hijack-lead.js, through `roles:` on each mission) and
 * main.js picks the seat with one line (withRole, src/game/roles/roles.js).
 * This feature does the rest:
 *   - the chooser on each mission card that has seats (src/ui/roles-ui.js);
 *   - the cast: when a seat's mission starts, the aircraft that are not you
 *     are built and flown, every frame, until the flight ends
 *     (src/game/roles/cast.js);
 *   - "hold B to look at him", through the camera hook;
 *   - a record per seat, written into the same live progress object main.js
 *     is about to save, so its save writes both.
 *
 * Taking this file's line out of src/features/index.js switches all of it
 * off: no chooser (every mission plays its default seat, as before), and a
 * seat started some other way (a test, the console) gives up politely
 * step by step, the way the event missions do without their feature.
 */

import { registerExtension } from '../game/extensions.js';
import { castStart, castStop, castUpdate, castCamera, castInfo, castStory } from '../game/roles/cast.js';
import { recordRole, defaultRoleId, setRole } from '../game/roles/roles.js';
import { registerVoices } from './events/common.js';
import { installRolesUi } from '../ui/roles-ui.js';

function wrapRecords(sim) {
  const r = sim.runner;
  if (!r || r._rolesRecords) return;
  r._rolesRecords = true;
  const inner = r.onComplete;
  r.onComplete = (result) => {
    try {
      const def = r.def;
      const base = def && def.baseId ? null : def;
      const seat = def && def.roleId ? def.roleId : base ? defaultRoleId(base) : null;
      if (seat && result && result.id && result.id !== 'free' && result.id !== 'tutorial' && sim.progress) {
        recordRole(sim.progress, result.id, seat, { score: result.score, time: result.time });
      }
    } catch (e) {
      console.warn('[roles] could not record the seat', e);
    }
    return typeof inner === 'function' ? inner(result) : undefined;
  };
}

registerExtension({
  id: 'roles',

  install(sim) {
    registerVoices();
    wrapRecords(sim);
    installRolesUi(sim);
    // For the console and the tests.
    sim.roles = {
      info: castInfo,
      story: castStory,
      /** Fly a mission from a seat: sim.roles.fly('event-hijack-real', 'lead'). */
      fly: (id, role) => {
        setRole(id, role);
        return sim.startMode('mission', { id, role });
      },
    };
  },

  startMode(sim, mode) {
    castStart(sim, mode, sim.runner && sim.runner.def);
  },

  stop(sim) {
    castStop(sim);
  },

  update(sim, dt) {
    castUpdate(sim, dt);
  },

  camera(sim, dt, camera) {
    return castCamera(sim, dt, camera);
  },

  devActions: [
    {
      label: 'Fly the lead fighter (hijack)',
      hint: 'Hijacked!, flown from the lead fighter: stay hidden under his tail.',
      run(sim) {
        sim.roles.fly('event-hijack', 'shadow');
      },
    },
    {
      label: 'Fly the lead fighter (by the book)',
      hint: 'Hijack: By the Book, flown from the lead fighter: the scramble, the intercept signals and the remote runway.',
      run(sim) {
        sim.roles.fly('event-hijack-real', 'lead');
      },
    },
  ],
});
