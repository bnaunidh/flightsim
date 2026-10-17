/**
 * The tips on the map loading screen (ui/loading-screen.js).
 *
 * Every tip is a real control or a real habit of this game, and every key in
 * one is a NAME OF AN ACTION in flight/input.js's registry, written {gear},
 * {throttleUp}. The screen swaps in the key the player has bound right now
 * (keyName), so a tip never tells somebody who moved the landing gear to L
 * to press G. tests/features/loading-screens.mjs checks that each {name} is
 * a real action, and that the action is one the tip's game has.
 *
 * Pure: no DOM, no game. It reads the registry only through what it is given.
 */

/** Tips for any game: the keys that exist everywhere. */
const ANY = [
  'Press {pause} to pause the game and open the menu.',
  'Press {help} at any time to see every control.',
  'Press {camera} to change the camera view.',
  'Press {minimap} to open the map, and {minimapRange} to change its range.',
  'Press {hideUi} to hide the whole interface for a clean view.',
  'Press {mute} to mute the sound.',
  'Every key can be changed in Settings, under Controls.',
];

const FLIGHT = [
  'Hold {throttleUp} for more power, {throttleDown} to take it away.',
  'A slow, gentle pull on {pitchUp} lifts you off the runway. Never yank it.',
  'Two white and two red PAPI lights means you are on the perfect glide path.',
  'Runway 09 means you land heading 090 degrees: east.',
  'Landing gear is {gear}. Put it down before you land.',
  'Flaps help you fly slowly: {flapsDown} lowers them, {flapsUp} raises them.',
  'If the stall warning sounds, lower the nose with {pitchDown} and add power.',
  'In a crosswind, point the nose slightly into the wind to stay lined up.',
  'Hold {brakes} after touchdown to stop on the runway.',
  'Press {starter} to start or stop the engine.',
  'Press {autopilot} for the autopilot. Touch the controls and it hands them back.',
  'Hold {lookBehind} to look behind you.',
  'Trim holds the nose where you leave it: {trimUp} and {trimDown} wind it.',
  'Press {guide} to show or hide the guidance lines to your target.',
  'Press {brace} twice to declare an emergency.',
];

const HELI = [
  'Hold {heliUp} to raise the collective until she lifts. Let go to hover.',
  'Collective down with {heliDown} brings her gently onto any H.',
  '{heliTurnLeft} and {heliTurnRight} turn her on the spot with the tail rotor.',
  'Press {heliAssist} to switch the stability assist on or off.',
  'Cyclic forward with {heliForward} tips the nose down and sends her ahead.',
  'Set her down softly on an H. A firm landing is safe, but a gentle one scores more.',
  'Press {starter} to start or stop the engine.',
  'Press {autopilot} for the autopilot. Touch the controls and it hands them back.',
];

const BOAT = [
  'The lever has five steps, Astern to Full. {boatFaster} moves it up, {boatSlower} back.',
  'She keeps going when you slow down, so ease off early.',
  '{boatLeft} and {boatRight} steer her.',
  '{boatStop} is the crash stop. Use it when something is suddenly in your way.',
  'Follow the arrow on the screen to your next objective.',
  'Pale water is shallow water. Keep to the dark water.',
];

const CAR = [
  '{carGo} to go, {carBrake} to brake. Keep holding the brake when you have stopped and you reverse.',
  '{carLeft} and {carRight} steer. Ease off the throttle before a corner.',
  '{carHandbrake} is the handbrake.',
  'Follow the big arrow at the bottom of the screen: it is your next turn.',
  'The bonnet view ({camera}) helps you line up with a loading bay.',
  'Stay on the tarmac: the grass is slower.',
];

/** The games the screen knows. */
export const TIP_GAMES = ['flight', 'heli', 'boat', 'car'];

/** The lists, by game, for the tests and for anything that wants to show them. */
export const TIP_LISTS = { any: ANY, flight: FLIGHT, heli: HELI, boat: BOAT, car: CAR };

/** The input context a game's keys live in (flight/input.js CONTEXTS). */
export const TIP_CONTEXT = { flight: 'plane', heli: 'heli', boat: 'boat', car: 'car' };

/** This game's tips, in the order they are shown: its own first, the general ones after. */
export function tipsFor(game) {
  const own = TIP_LISTS[game] || FLIGHT;
  return own.concat(ANY);
}

/** The action names a tip uses. */
export function tipActions(text) {
  const out = [];
  String(text).replace(/\{(\w+)\}/g, (m, a) => {
    out.push(a);
    return m;
  });
  return out;
}

/**
 * The tip as the player reads it. `keyName(action)` gives the key bound now
 * ('—' when the player has unbound it, and then the key is left out, with its
 * words, rather than telling them to press a dash).
 */
export function renderTip(text, keyName) {
  let unbound = false;
  const out = String(text).replace(/\{(\w+)\}/g, (m, action) => {
    const k = keyName(action);
    if (!k || k === '—') {
      unbound = true;
      return 'its key';
    }
    return k;
  });
  return unbound ? out.replace(/Press its key/, 'Use its key') : out;
}

/**
 * The next tip for a game, never the one shown last for it: `memory` is a plain
 * object the caller keeps ({ flight: 3 }), so tips go round in order across
 * loads instead of repeating by chance. Starts somewhere in the list so two
 * players do not read the same tip first.
 */
export function nextTip(game, memory, random = Math.random) {
  const list = tipsFor(game);
  const last = memory && Number.isInteger(memory[game]) ? memory[game] : Math.floor(random() * list.length) - 1;
  const i = (((last + 1) % list.length) + list.length) % list.length;
  if (memory) memory[game] = i;
  return { index: i, text: list[i], of: list.length };
}
