/**
 * Meteor mode's missions (category 'meteor').
 *
 * The meteors themselves live in src/features/meteor.js, which hangs a handle
 * on the game as `sim.meteors`. These missions talk to it ONLY through that
 * handle, read at call time, and never import it: if the feature were ever
 * switched off for throwing, the missions list must still load, because it is
 * the same list every other mission in the game is in.
 *
 * Every mission here starts in the air, over Kestrel, at sunset or at night —
 * a meteor is a light in a darkening sky, and a trail you cannot see against
 * a midday blue is not a meteor. Each one sets `meteor: { mode }`, and its
 * onStart begins that mode (onStart also runs when "back to the runway"
 * restarts a mission, which the startMode hook alone would miss).
 *
 * Every spoken line is in `atc`, which goes through sim.speak() — the radio,
 * honouring the voice setting — and appears as a subtitle. Nothing here needs
 * a voice to be understood.
 */

import * as THREE from '../../vendor/three.module.js';
import * as Terrain from '../../world/terrain.js';

const TOWN_LIMIT = 5;

const M = (ctx) => (ctx && ctx.sim && ctx.sim.meteors) || null;
const S = (ctx) => {
  const m = M(ctx);
  return (m && m.stats) || null;
};

function begin(ctx) {
  const m = M(ctx);
  const def = ctx.runner && ctx.runner.def;
  if (m && def && def.meteor) m.begin(def.meteor, def.id);
}

function groundAt(x, z) {
  try {
    const h = Terrain.heightAt(x, z);
    return Number.isFinite(h) ? h : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * An airborne start at a height above the SEA, not above the ground.
 *
 * The game's spawn height is `altAGL`, measured from heightAt() — which over
 * water is the sea bed, 34 m down on Kestrel. A getter, so the answer is read
 * after the mission's map is loaded, not when this file is.
 */
function airborneAt(x, z, mslMetres, headingDeg, speed = 62) {
  return {
    pos: new THREE.Vector3(x, 0, z),
    headingDeg,
    speed,
    get altAGL() {
      return Math.max(150, mslMetres - groundAt(x, z));
    },
  };
}

/** Over the south-west edge of the town, facing north-east — where the rocks come from. */
const TOWN_SPAWN = {
  get pos() {
    const t = Terrain.MAP && Terrain.MAP.scenery && Terrain.MAP.scenery.town;
    const cx = t ? t.cx : 700;
    const cz = t ? t.cz : 620;
    return new THREE.Vector3(cx - 420, 0, cz + 420);
  },
  headingDeg: 45,
  speed: 62,
  get altAGL() {
    const p = this.pos;
    return Math.max(250, 820 - Math.max(0, groundAt(p.x, p.z)));
  },
};

const SUNSET = { time: 'sunset', condition: 'clear', windSpeedKts: 6, windDirDeg: 250 };

export const MISSIONS = [
  {
    id: 'meteor-shower',
    name: 'Meteor Shower',
    short: 'Fly among the falling stars',
    difficulty: 'Easy',
    icon: '☄',
    category: 'meteor',
    game: 'flight',
    map: 'kestrel',
    aircraft: 'courier',
    blurb:
      'Meteors are streaking across the evening sky over Kestrel. Most burn up in a pop of sparks and leave a '
      + 'cloud of gold stardust behind; some come all the way down with a bang. No clock and no way to lose — just fly.',
    reward:
      'Fly through stardust to collect it. Press Z (or tap ZAP) to pop a meteor your nose is pointing at. '
      + 'Big ones get a warning and a light where they will land.',
    weather: SUNSET,
    spawn: airborneAt(-3000, 900, 650, 60),
    failOnCrash: false,
    meteor: { mode: 'shower' },
    onStart: begin,
    steps: [
      {
        id: 'watch',
        text: 'Watch the sky ahead! Fly through the stardust a meteor leaves behind to collect it. Point your nose at a meteor and zap it.',
        hint: 'Stardust is left where a meteor burns up near you — the arrow points to the nearest cloud.',
        hintEvery: 45,
        atc: {
          text: 'All aircraft, Kestrel. Meteor shower overhead tonight. Enjoy the show — and keep clear of the big ones.',
          voice: 'tower',
        },
        targetLabel: 'Stardust',
        target: (ctx) => {
          const m = M(ctx);
          return m ? m.nearestStardust() || m.nextWarning() : null;
        },
        // No end: this is the one you just fly in.
        check: () => false,
      },
    ],
    score: (ctx) => {
      const s = S(ctx);
      return s ? Math.min(100, 40 + s.stardust * 4 + s.zapped * 2) : 40;
    },
  },

  {
    id: 'meteor-dodge',
    name: 'Rock Dodger',
    short: 'Three minutes, three shields',
    difficulty: 'Medium',
    // Not a star glyph: the gold stars on the minimap are the Star Hunt's,
    // and "the meteor icon" was being read into them.
    icon: '◉',
    category: 'meteor',
    game: 'flight',
    map: 'kestrel',
    aircraft: 'courier',
    blurb:
      'Space rocks are being aimed at where you are GOING to be. Keep flying straight and sooner or later one '
      + 'will bonk you. Turn, climb and dive, and watch them whoosh past. Last three minutes with a shield left.',
    reward: 'Teaches you to fly with your head up — watching what is coming, not only the instruments.',
    weather: SUNSET,
    spawn: airborneAt(-600, 4200, 700, 90),
    meteor: { mode: 'dodge' },
    onStart: begin,
    failIf: (ctx) => {
      const s = S(ctx);
      return s && s.shields <= 0
        ? 'Three bonks — out of shields! The rocks were aimed at where you were heading. Keep changing direction and try again.'
        : null;
    },
    steps: [
      {
        id: 'ready',
        text: 'Rocks incoming! An orange circle means one is coming for you.',
        hint: 'A rock goes where you WERE going. When you see a circle, turn or climb.',
        atc: { text: 'Courier, Kestrel. Rocks inbound from all round. Keep moving and you will be fine.', voice: 'tower' },
        check: (ctx) => ctx.elapsed > 4,
      },
      {
        id: 'dodge',
        text: 'Keep turning, climbing and diving. Last three minutes!',
        hint: 'Flying straight and level is exactly what they are aiming at. Bank one way, then the other.',
        hintEvery: 30,
        check: (ctx) => {
          const s = S(ctx);
          return !!(s && s.survived);
        },
      },
    ],
    onComplete: (ctx) => {
      ctx.sim.speak('Courier, Kestrel. Three minutes and still flying. Brilliant dodging.', 'tower');
    },
    score: (ctx) => {
      const s = S(ctx);
      if (!s) return 50;
      return Math.round(Math.min(100, 40 + s.shields * 15 + Math.min(15, s.nearMisses * 3)));
    },
  },

  {
    id: 'meteor-town',
    name: 'Guard the Town',
    short: 'Zap them before they land',
    difficulty: 'Medium',
    icon: '⌂',
    category: 'meteor',
    game: 'flight',
    map: 'kestrel',
    aircraft: 'courier',
    blurb:
      'Sixteen space rocks are heading for Kestrel town, four at a time, all from the north-east. Fly out to '
      + 'meet them, point your nose at each one and zap it. If five get through, the town has had enough bonks for one evening.',
    reward: 'Teaches pointing the aeroplane exactly where you want it — the nose is your aim.',
    weather: { time: 'sunset', condition: 'clear', windSpeedKts: 8, windDirDeg: 40 },
    spawn: TOWN_SPAWN,
    meteor: { mode: 'town' },
    onStart: begin,
    failIf: (ctx) => {
      const s = S(ctx);
      return s && s.landedTown >= TOWN_LIMIT
        ? 'Five rocks bonked the town. Nobody was hurt — gardens and the park took the hits — but meet them further out next time.'
        : null;
    },
    steps: [
      {
        id: 'meet',
        text: 'They come from the north-east. Fly towards a rock and zap it when the blue box is on it.',
        hint: 'Point your nose straight at the glowing rock. The blue box means it is in range.',
        atc: {
          text: 'Courier, Kestrel. Rocks inbound from the north-east, heading for town. Go and meet them.',
          voice: 'tower',
        },
        targetLabel: 'Incoming rock',
        target: (ctx) => {
          const m = M(ctx);
          return m ? m.nearestTownRock() : null;
        },
        check: (ctx) => {
          const s = S(ctx);
          return !!(s && s.townResolved >= 1);
        },
      },
      {
        id: 'waves',
        text: 'Four waves of four. Keep zapping — the orange circles show where each one will land.',
        hint: 'Turn back towards the north-east after each one. They all come from the same side.',
        hintEvery: 30,
        targetLabel: 'Incoming rock',
        target: (ctx) => {
          const m = M(ctx);
          return m ? m.nearestTownRock() : null;
        },
        check: (ctx) => {
          const s = S(ctx);
          return !!(s && s.townResolved >= s.townTotal);
        },
      },
    ],
    onComplete: (ctx) => {
      const s = S(ctx);
      ctx.sim.speak(
        s && s.landedTown === 0 ? 'Courier, Kestrel. Not one got through. The town owes you a cake.' : 'Courier, Kestrel. Town is safe. Nicely done.',
        'tower'
      );
    },
    score: (ctx) => {
      const s = S(ctx);
      if (!s) return 50;
      const saved = (s.townZapped || 0) / Math.max(1, s.townTotal);
      return Math.round(Math.min(100, 30 + saved * 60 + (s.landedTown === 0 ? 10 : 0)));
    },
  },

  {
    id: 'meteor-photo',
    name: 'Photograph the Big One',
    short: 'Get the picture before splashdown',
    difficulty: 'Easy',
    icon: '🔭',
    category: 'meteor',
    game: 'flight',
    map: 'kestrel',
    aircraft: 'tempest',
    blurb:
      'The observatory has spotted an enormous green meteor that will cross the night sky and splash down in '
      + 'the sea. They need a photograph. Fly close, keep it in the middle of your view, and the camera does the rest.',
    reward: 'Teaches intercepting something that moves — fly to where it will be, not to where it is.',
    weather: { time: 'night', condition: 'clear', windSpeedKts: 5, windDirDeg: 90 },
    spawn: airborneAt(-3800, 1500, 750, 330),
    meteor: { mode: 'photo' },
    onStart: begin,
    failIf: (ctx) => {
      const s = S(ctx);
      return s && s.giantLanded && !s.photoTaken
        ? 'It splashed down before you got the picture. Turn towards it sooner — it is slow, but the sea is close!'
        : null;
    },
    steps: [
      {
        id: 'brief',
        text: 'Watch the sky. The observatory says it is coming any moment…',
        atc: {
          text: 'Tempest research one, observatory. A very big meteor is due over the western sea in a few seconds. We need that picture!',
          voice: 'tower',
        },
        check: (ctx) => {
          const s = S(ctx);
          return !!(s && s.giantSpawned);
        },
      },
      {
        id: 'chase',
        text: 'Fly towards the giant meteor. Get within 2 km and keep it in the middle of your view.',
        hint: 'It drifts from right to left and down towards the sea. Aim ahead of it.',
        targetLabel: 'The big one',
        target: (ctx) => {
          const m = M(ctx);
          return m ? m.giantPos() : null;
        },
        check: (ctx) => {
          const s = S(ctx);
          return !!(s && s.photoTaken);
        },
      },
      {
        id: 'splash',
        text: 'Got it! Now watch it splash down.',
        targetLabel: 'The big one',
        target: (ctx) => {
          const m = M(ctx);
          return m ? m.giantPos() : null;
        },
        check: (ctx) => {
          const s = S(ctx);
          return !!(s && s.giantLanded);
        },
      },
    ],
    onComplete: (ctx) => {
      ctx.sim.speak('Observatory. What a picture — and what a splash! Thank you, Tempest.', 'tower');
    },
    score: (ctx) => {
      const s = S(ctx);
      return s ? s.photoQuality : 50;
    },
  },
];
