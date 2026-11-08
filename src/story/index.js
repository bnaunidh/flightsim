/**
 * STORY MODE — "SIGNAL ZERO" — the plug-in.
 *
 * The owner, verbatim: "there should be a whole storlyline gamemode, in the
 * main menu, it goes through a detailed and awesome story line you can
 * continue and leave whenever." The design is story-bible.md; this is Track
 * A (the framework) and chapter 1.
 *
 * It plugs in through game/extensions.js with no main.js edits:
 *   install    the save, the Story card and screens (ui.js), the director
 *   startMode  a restart of a story beat ("Fly again")
 *   stop       the flight ended: tear the chapter down, keep the save
 *   update     the cinema clocks, the autosave, the chapter's own tick
 *   camera     a cutscene's camera rail
 *   key        SPACE for the photo (the aeroplane in chapter 1, the helicopter
 *              in chapter 2); the skip key; nothing else is touched
 *
 * The one key it declares shares Space with the wheel brakes by design (the
 * same way the PvP trigger does): in the air the brakes do nothing, and on
 * the ground the story never claims it.
 */

import { registerExtension } from '../game/extensions.js';
import { installStoryUi } from './ui.js';
import { installDirector, onStartMode, onStop, onUpdate, onCamera, onKey, directorState, D } from './director.js';
import { cinemaState } from './cinema.js';
import { setDevCheck } from './chapters.js';
import { isDev } from '../game/progression.js';

registerExtension({
  id: 'story',

  actions: {
    // The aeroplane in chapter 1 and the helicopter in chapter 2 (Space is the wheel brakes in both, by design).
    storyPhoto: { label: 'Story: take the photo', group: 'Missions & events', ctx: ['plane', 'heli'], default: ['Space'] },
  },

  install(sim) {
    // A stand-in game with no menus or runner (the node tests' stubs) gets no story.
    if (!sim || !sim.menus || !sim.menus.screens || !sim.runner) return;
    // Dev-only chapters (chapters.js `dev`) are offered while the workbench is open (the owner's door).
    setDevCheck(() => isDev(sim.prog || (sim.menus && sim.menus.prog) || null));
    const ui = installStoryUi(sim);
    installDirector(sim, ui);
    ui.refreshCard();
    /*
     * For the console and the tests: the story's live state. Reading it
     * changes nothing; the directorState() snapshot is what the browser check
     * asserts on.
     */
    sim.story = {
      get state() {
        return directorState();
      },
      get cinema() {
        return cinemaState();
      },
      get director() {
        return D;
      },
    };
  },

  startMode(sim, mode, opts) {
    onStartMode(sim, mode, opts);
  },

  stop(sim, why) {
    onStop(sim, why);
  },

  update(sim, dt) {
    onUpdate(sim, dt);
  },

  camera(sim, dt, camera) {
    return onCamera(sim, dt, camera);
  },

  key(sim, code, down, e) {
    return onKey(sim, code, down, e);
  },

  devActions: [
    {
      label: 'Story: play chapter 1',
      hint: 'Starts Signal Zero chapter 1 in replay mode (your place in the story is kept).',
      run(sim) {
        import('./director.js').then((m) => m.replayChapter('ch01-the-glint')).catch((e) => console.error('[story] could not start', e));
      },
    },
    {
      label: 'Story: play chapter 4',
      hint: 'Starts Signal Zero chapter 4, Low Water (the boat), in replay mode (your place in the story is kept).',
      run(sim) {
        import('./director.js').then((m) => m.replayChapter('ch04-low-water')).catch((e) => console.error('[story] could not start', e));
      },
    },
    {
      label: 'Story: play chapter 3',
      hint: 'Starts Signal Zero chapter 3, Range Control, in replay mode (your place in the story is kept).',
      run(sim) {
        import('./director.js').then((m) => m.replayChapter('ch03-range-control')).catch((e) => console.error('[story] could not start', e));
      },
    },
    {
      label: 'Story: play chapter 2',
      hint: 'Starts Signal Zero chapter 2, Fire Line, in replay mode (your place in the story is kept).',
      run(sim) {
        import('./director.js').then((m) => m.replayChapter('ch02-fire-line')).catch((e) => console.error('[story] could not start', e));
      },
    },
  ],
});
