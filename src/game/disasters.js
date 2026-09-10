/**
 * Natural disasters.
 *
 * The failures list is about the aeroplane breaking. This is about the sky
 * turning on you, which is a different kind of problem and asks for different
 * flying: a broken engine is a decision about where to land, a microburst is a
 * decision you have about four seconds to make.
 *
 * Every one of these can be armed before departure with a timer, triggered on
 * the spot from the pause menu, or left to the randomiser — which fires them
 * more often on the harder maps and in worse weather, because that is what
 * "expert" ought to mean.
 *
 * Nothing here ever happens on its own. An ordinary flight stays ordinary.
 */

/** How much rougher each map is than Kestrel. Drives the random rate. */
export function severityForMap(map) {
  const d = (map && map.difficulty) || 1;
  return 0.6 + d * 0.34; // 0.94 on the gentlest, 2.3 on Ember
}

export const NATURAL_EVENTS = [
  {
    id: 'microburst',
    name: 'Microburst',
    hint: 'A column of sinking air, and the wind reverses through it',
    warn: 'MICROBURST — full power, nose up, fly out of it',
    kind: 'warn',
    duration: 75,
    apply(sim) {
      // A real one is a downdraught with an outflow: a headwind that becomes a
      // tailwind as you fly through the middle. Both matter — the headwind
      // loss is what actually brings aeroplanes down.
      sim.weather.startShear({ down: 11, headwind: 13, seconds: 75 });
    },
  },
  {
    id: 'tornado',
    name: 'Tornado',
    hint: 'One touches down nearby — you can see it, and you can feel it',
    warn: 'TORNADO — you can see it. Do not fly into it.',
    kind: 'bad',
    duration: 260,
    apply(sim) {
      // `sim.tornadoEF` is what the player picked in the disasters panel;
      // null means "surprise me", and the weak ratings come up far more often.
      const at = sim.tornado.spawn(sim.aircraft.pos, 260, sim.tornadoEF);
      sim.weather.vortex = sim.tornado;
      // Say which way it is, because a warning you cannot act on is decoration.
      const dx = at.x - sim.aircraft.pos.x;
      const dz = at.z - sim.aircraft.pos.z;
      let bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
      if (bearing < 0) bearing += 360;
      sim.hud.notify(
        `${sim.tornado.label} tornado on the ground, bearing ` +
          `${String(Math.round(bearing)).padStart(3, '0')}, ` +
          `${(Math.hypot(dx, dz) / 1000).toFixed(1)} km`,
        'warn',
        6
      );
    },
  },
  {
    id: 'typhoon',
    name: 'Typhoon',
    hint: 'Sustained storm-force wind for several minutes',
    warn: 'TYPHOON — storm force wind, get on the ground or get above it',
    kind: 'bad',
    duration: 330,
    apply(sim) {
      // Not a gust: a sustained blow that changes what flying is like for
      // minutes, which is the difference between a squall and a typhoon.
      sim.weather.temporaryCondition('stormy', 330);
      sim.weather.gustFront({ speedMultiplier: 3.4, turnDeg: 40, seconds: 330 });
    },
  },
  {
    id: 'stormCell',
    name: 'Storm cell',
    hint: 'A thunderstorm rolls over the field',
    warn: 'Storm cell overhead — it is going to get rough',
    kind: 'warn',
    duration: 270,
    apply(sim) {
      sim.weather.temporaryCondition('stormy', 270);
    },
  },
  {
    id: 'fogBank',
    name: 'Fog bank',
    hint: 'Visibility collapses — you will be landing on instruments',
    warn: 'Fog rolling in — visibility dropping fast',
    kind: 'warn',
    duration: 280,
    apply(sim) {
      sim.weather.temporaryCondition('rainy', 280, { fog: 0.0012, cloudBase: 240 });
    },
  },
  {
    id: 'birdStrike',
    name: 'Bird strike',
    hint: 'Something goes through the engine',
    warn: 'BIRD STRIKE — engine damaged',
    kind: 'bad',
    apply(sim) {
      sim.audio.available && sim.audio.alerts.thud && sim.audio.alerts.thud();
      if (!sim.aircraft.failures.roughEngine) sim.toggleFailure('roughEngine');
    },
  },
  {
    id: 'lightning',
    name: 'Lightning storm',
    hint: 'Repeated strikes — the panel keeps going dark',
    warn: 'LIGHTNING STORM — expect the instruments to keep dropping out',
    kind: 'bad',
    duration: 240,
    apply(sim) {
      // A single flash was over before you could react to it. A storm is a
      // condition you have to fly *in*: four minutes of it, striking every
      // twenty to forty seconds, each strike taking the panel out for a while.
      // That turns it from a jump-scare into a situation.
      sim.weather.temporaryCondition('stormy', 240);
      sim.lightningStorm = { left: 240, next: 3 };
    },
  },
  {
    id: 'ashCloud',
    name: 'Volcanic ash',
    hint: 'Ash chokes the engine and scours the windscreen',
    warn: 'VOLCANIC ASH — get out of it, engine is choking',
    kind: 'bad',
    duration: 190,
    apply(sim) {
      sim.weather.temporaryCondition('cloudy', 190, { fog: 0.0009 });
      if (!sim.aircraft.failures.roughEngine) sim.toggleFailure('roughEngine');
    },
  },
  {
    id: 'eruption',
    name: 'Eruption',
    hint: 'The mountain lets go',
    warn: 'ERUPTION — the mountain is going up, get away from it',
    kind: 'bad',
    duration: 240,
    /*
     * Not in the list you can arm, on purpose.
     *
     * Everything else in this panel is something you choose to practise. An
     * eruption is the one thing the mountain decides, and it only happens on a
     * map that has a mountain to decide it. Knowing it is coming would take
     * away the only surprise the game has left.
     */
    hidden: true,
    apply(sim) {
      sim.weather.temporaryCondition('stormy', 240, { fog: 0.0016 });
      // Ash first, then the engine suffers, then the air over the cone becomes
      // genuinely dangerous — see the thermal column in main.js.
      if (!sim.aircraft.failures.roughEngine) sim.toggleFailure('roughEngine');
      sim.erupting = 240;
      sim.hud.notify('The volcano has erupted — turn away from the mountain', 'warn', 7);
    },
  },
];

export function findEvent(id) {
  return NATURAL_EVENTS.find((e) => e.id === id) || null;
}

/**
 * Which events the randomiser may pick on this map. Volcanic ash only makes
 * sense where there is a volcano — firing it over a grass plain would be
 * nonsense, and nonsense is what stops people trusting the rest of it.
 */
export function poolForMap(map) {
  const hasVolcano = !!(map && map.features && map.features.volcano);
  return NATURAL_EVENTS.filter((e) => {
    if (e.id === 'ashCloud' || e.id === 'eruption') return hasVolcano;
    return true;
  });
}

/** The events a player may arm before a flight. Eruptions are not among them. */
export const SELECTABLE_EVENTS = NATURAL_EVENTS.filter((e) => !e.hidden);
