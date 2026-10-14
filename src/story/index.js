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
 *   key        SPACE for the photo; the skip key; nothing else is touched
 *
 * The one key it declares shares Space with the wheel brakes by design (the
 * same way the PvP trigger does): in the air the brakes do nothing, and on
 * the ground the story never claims it.
 */

import { registerExtension } from '../game/extensions.js';
import { installStoryUi } from './ui.js';
import { installDirector, onStartMode, onStop, onUpdate, onCamera, onKey, directorState, D } from './director.js';
import { cinemaState } from './cinema.js';

registerExtension({
  id: 'story',

  actions: {
    storyPhoto: { label: 'Story: take the photo', group: 'Missions & events', ctx: ['plane'], default: ['Space'] },
  },

  install(sim) {
    // A stand-in game with no menus or runner (the node tests' stubs) gets no story.
    if (!sim || !sim.menus || !sim.menus.screens || !sim.runner) return;
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
  ],
});
