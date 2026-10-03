/**
 * Which crash was that? — the six custom crashes, and how the game tells
 * them apart from the moment of impact.
 *
 * Pure numbers, no page and no three.js, so tests/features/crashes.mjs can
 * throw made-up impacts at it in node.
 *
 * The inputs are what the flight model hands its CRASH event (the reason,
 * the part that touched, the velocity just before the wreck was damped) and
 * the aeroplane's attitude at that instant. The order of the tests is the
 * order a spectator would name it in: in the sea is a splash whatever else
 * happened; into a building is a bonk; straight down is a lawn dart; a wing
 * first is a spin, or a cartwheel if it was going fast; everything else
 * flat enough is a belly flop, and anything faster still cartwheels.
 *
 * Every caption is a joke at the aeroplane's expense, never the pilot's, and
 * never about anybody being hurt: the class is ten, and "no harm done — this
 * is a simulator" is what the debrief has always said.
 */

export const KINDS = {
  cartwheel: {
    title: 'Cartwheel crash!',
    word: 'KA-TUMBLE!',
    heliTitle: 'Tumble crash!',
    colour: '#ffb020',
    captions: [
      'Ten out of ten for gymnastics. Zero for the landing.',
      'Round and round and round it goes!',
      'A triple somersault. The judges are speechless.',
      'Nobody told the plane this was not a gymnastics class.',
    ],
  },
  bellyflop: {
    title: 'Belly-flop skid!',
    word: 'FWUMP!',
    heliTitle: 'Belly-flop skid!',
    colour: '#ffb020',
    captions: [
      'The loudest belly flop at the pool.',
      'Wheels? Who needs wheels?',
      'The longest slip-and-slide on the island.',
      'Smooth… ish.',
    ],
  },
  splash: {
    title: 'Splash-down!',
    word: 'SPLOOSH!',
    heliTitle: 'Splash-down!',
    colour: '#5ec8ff',
    captions: [
      'The fish did not see that coming.',
      'Planes are not boats. Now we know.',
      'CANNONBALL!',
      'A ten for the splash. The lifeguard is not impressed.',
    ],
  },
  wingclip: {
    title: 'Wing-clip spin!',
    word: 'WHIRRR!',
    heliTitle: 'Rotor-clip spin!',
    colour: '#ffb020',
    captions: [
      'Spun like a fidget spinner!',
      'Wing met ground. Ground won.',
      'Round and round like a spinning top.',
      'Dizzy yet?',
    ],
  },
  noseplant: {
    title: 'Nose-in plant!',
    word: 'THUNK!',
    heliTitle: 'Nose-in plant!',
    colour: '#ffb020',
    captions: [
      'Planted it like a lawn dart!',
      'Stuck the landing. Literally.',
      'The ground was closer than it looked.',
      'It is a tree now. A very shiny tree.',
    ],
  },
  bonk: {
    title: 'Bonk!',
    word: 'BONK!',
    heliTitle: 'Bonk!',
    colour: '#ffb020',
    captions: [
      'Who put that there?',
      'That building was on the map. Just saying.',
      'Seeing stars…',
      'Knock knock. Who is there? A plane.',
    ],
  },
  /*
   * MID-AIR BUMP — into another aircraft (src/features/sky.js). It tumbles
   * all the way down like a cartwheel from height, and the other crew come
   * down under parachutes: the captions say so, because "everybody got out"
   * is the first thing a ten-year-old wants to know.
   */
  midair: {
    title: 'Mid-air bump!',
    word: 'KA-BONK!',
    heliTitle: 'Mid-air bump!',
    colour: '#ffb020',
    captions: [
      'Two aeroplanes, one bit of sky.',
      'The sky is very big. You found the one busy bit.',
      'Everybody got out — look for the parachutes.',
      'That is what the radio is for!',
    ],
  },
};

export const KIND_IDS = Object.keys(KINDS);

const DEG = 180 / Math.PI;

/**
 * Name the crash.
 *
 * @param info {
 *   reason     string   the flight model's own words
 *   part       'nose' | 'leftWing' | 'rightWing' | 'tail' | 'fuselage' | undefined
 *   surface    'water' | 'concrete' | undefined
 *   vel        {x, y, z} m/s, just before impact
 *   forward    {x, y, z} unit, the nose's direction
 *   right      {x, y, z} unit, the right wing's direction
 *   agl        metres above whatever is under it
 *   size       half the span, metres (optional)
 *   overWater  the sea is under it
 * }
 * @returns { kind, side, pitch, bank, gamma, speed }
 *   side is +1 when the right wing is the low one / the one that hit.
 */
export function classifyCrash(info = {}) {
  const v = info.vel || { x: 0, y: 0, z: 0 };
  const f = info.forward || { x: 0, y: 0, z: -1 };
  const rt = info.right || { x: 1, y: 0, z: 0 };
  const reason = String(info.reason || '');
  const part = info.part;
  const h = Math.hypot(v.x, v.z);
  const speed = Math.hypot(h, v.y);
  const pitch = Math.asin(Math.max(-1, Math.min(1, f.y))) * DEG;
  // Right wing down is a positive bank, the way the instruments show it.
  const bank = Math.asin(Math.max(-1, Math.min(1, -rt.y))) * DEG;
  const gamma = Math.atan2(-v.y, Math.max(0.01, h)) * DEG;
  let side = part === 'rightWing' ? 1 : part === 'leftWing' ? -1 : bank >= 0 ? 1 : -1;
  const out = (kind) => ({ kind, side, pitch, bank, gamma, speed });

  // Another aircraft (sky.js): a mid-air bump up in the air, a bonk on the apron.
  if (info.surface === 'aircraft') return out((info.agl ?? 0) > 12 + (info.size || 0) ? 'midair' : 'bonk');
  const water = info.surface === 'water' || /\b(sea|water|ditch)/i.test(reason) || (info.overWater && (info.agl ?? 0) < 6);
  if (water) return out('splash');
  if (info.surface === 'concrete') return out('bonk');
  // Came apart in the air (too fast, a tornado): it tumbles all the way down.
  // Measured from the middle, so a jumbo on one wing tip is not "in the air".
  if ((info.agl ?? 0) > 12 + (info.size || 0)) return out('cartwheel');
  if (pitch < -35 || gamma > 50 || (part === 'nose' && (pitch < -18 || gamma > 28))) return out('noseplant');
  const wingFirst = part === 'leftWing' || part === 'rightWing' || Math.abs(bank) > 45;
  if (wingFirst) return out(speed > 55 ? 'cartwheel' : 'wingclip');
  if (speed > 75 && gamma > 12) return out('cartwheel');
  return out('bellyflop');
}

/** A caption for it, different from the last one when there is a choice. */
export function pickCaption(kind, last = null, rnd = Math.random) {
  const k = KINDS[kind] || KINDS.bellyflop;
  const list = k.captions;
  let i = Math.floor(rnd() * list.length) % list.length;
  if (list[i] === last && list.length > 1) i = (i + 1) % list.length;
  return list[i];
}

export function titleFor(kind, vehicle = 'plane') {
  const k = KINDS[kind] || KINDS.bellyflop;
  return vehicle === 'heli' ? k.heliTitle : k.title;
}
