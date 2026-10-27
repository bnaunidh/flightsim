/**
 * Every action's touch control, in one table.
 *
 * The one key registry (flight/input.js ACTIONS) says what the keyboard can
 * do. This says what a thumb can do about each of those actions on a phone or
 * a tablet — which pad, which sheet, which feature's own button — or, for the
 * few that have none, WHY not. tests/features/touch-coverage.mjs fails the
 * build when an action is registered and is in neither list: the owner's
 * "update mobile controls so u can do pushback etc" (2026-10-24) was that
 * gap, found by hand, and this is how it stays closed when the next feature
 * adds a key.
 *
 *   { via, where, file, needle }
 *     via     how a finger reaches it:
 *               stick · throttle · rudder    the flight layer's axes (ui/touch.js)
 *               pad                          one of the pads beside them (ui/touch.js)
 *               sheet                        the GROUND or SYSTEMS sheet (ui/touch.js buildSheets)
 *               dock · tray                  the HUD's button dock / its tray (ui/hud.js)
 *               card                         a tappable row on a HUD card (ui/hud.js)
 *               pill                         a state pill that undoes itself (ui/pills.js)
 *               drag                         a finger on the picture (flight/input.js)
 *               feature                      the feature's own on-screen button
 *     where   a line for a reader
 *     file    the source that builds the control (checked to exist)
 *     needle  text the test looks for in that file (the action id if left out)
 *   { desktopOnly: 'why' }
 *     an action with no touch control, and the reason in a sentence
 */

const T = 'src/ui/touch.js';
const H = 'src/ui/hud.js';
const stick = (where) => ({ via: 'stick', where, file: T, needle: 'buildStick' });
const rudder = (where) => ({ via: 'rudder', where, file: T, needle: 'buildRudder' });
const throttle = (where) => ({ via: 'throttle', where, file: T, needle: 'buildThrottle' });
const pad = (where, needle) => ({ via: 'pad', where, file: T, needle });
const sheet = (where) => ({ via: 'sheet', where, file: T });
const dock = (where) => ({ via: 'dock', where, file: H });
const tray = (where) => ({ via: 'tray', where, file: H });
const card = (where, needle, file = H) => ({ via: 'card', where, file, needle });
const feature = (file, where, needle) => ({ via: 'feature', where, file, needle });

export const TOUCH_COVERAGE = Object.freeze({
  /* ---- the aeroplane ---- */
  pitchDown: stick('the stick, pushed up (nose down)'),
  pitchUp: stick('the stick, pulled down (nose up)'),
  rollLeft: stick('the stick, left'),
  rollRight: stick('the stick, right'),
  yawLeft: rudder('the RUDDER bar, left of centre'),
  yawRight: rudder('the RUDDER bar, right of centre'),
  throttleUp: throttle('the power slider, up'),
  throttleDown: throttle('the power slider, down'),
  starter: pad('the START / STOP pad', "'starter'"),
  brakes: pad('the BRAKES pad, held', 'state.brakes'),
  dragChute: feature('src/features/eject.js', 'the CHUTE button on the landing roll (Air Massimo, T-Pose Harrison)', "'chute'"),
  gear: pad('the GEAR pad', "'gear'"),
  flapsDown: pad('the FLAPS pad: each tap one notch further down, then back to up', "'flaps'"),
  flapsUp: pad('the FLAPS pad wraps round to flaps up after the last notch', "'flaps'"),
  camera: pad('the camera pad (and the dock\'s camera button)', "'camera'"),
  lookBehind: sheet('SYSTEMS → LOOK BEHIND, held'),
  brace: sheet('SYSTEMS → MAYDAY, when an emergency is on offer'),
  emergencyLand: card('the mayday card: tap "Attempt to land"', 'data-choice'),
  emergencyCircle: card('the mayday card: tap "Circle the airport"', 'data-choice'),
  drop: pad('the DROP pad, shown while something is aboard', "'drop'"),
  pause: dock('the pause button, top right'),
  help: sheet('SYSTEMS → CONTROLS (the H card)'),
  hudMode: dock('the HUD-mode button in the dock'),
  hideUi: tray('the dock\'s tray → Hide interface'),
  guide: tray('the dock\'s tray → Guidance'),
  autopilot: sheet('SYSTEMS → AUTOPILOT (and the dock\'s tray)'),
  lookUp: { via: 'drag', where: 'a finger dragged on the picture in the cockpit view turns the head', file: 'src/flight/input.js', needle: '_onLookMove' },
  lookDown: { via: 'drag', where: 'a finger dragged on the picture in the cockpit view turns the head', file: 'src/flight/input.js', needle: '_onLookMove' },
  lookLeft: { via: 'drag', where: 'a finger dragged on the picture in the cockpit view turns the head', file: 'src/flight/input.js', needle: '_onLookMove' },
  lookRight: { via: 'drag', where: 'a finger dragged on the picture in the cockpit view turns the head', file: 'src/flight/input.js', needle: '_onLookMove' },
  mute: tray('the dock\'s tray → Sound'),
  minimap: sheet('SYSTEMS → MAP'),
  minimapRange: sheet('SYSTEMS → MAP RANGE'),
  trimDown: sheet('SYSTEMS → Trim ▼ NOSE DOWN, held'),
  trimUp: sheet('SYSTEMS → Trim NOSE UP ▲, held'),
  trimReset: sheet('SYSTEMS → Trim NEUTRAL'),
  apHdgLeft: card('the autopilot card\'s heading −', "'apHdgLeft'"),
  apHdgRight: card('the autopilot card\'s heading +', "'apHdgRight'"),
  apSpdDown: card('the autopilot card\'s speed −', "'apSpdDown'"),
  apSpdUp: card('the autopilot card\'s speed +', "'apSpdUp'"),
  apVsDown: card('the autopilot card\'s climb rate −', "'apVsDown'"),
  apVsUp: card('the autopilot card\'s climb rate +', "'apVsUp'"),

  // The pilot's switches (features/pilot-systems.js): the sheets press their keys; the pills undo them.
  lights: sheet('SYSTEMS → LIGHTS (every lamp\'s preset; the LIGHTS card sets each lamp)'),
  spoilers: sheet('SYSTEMS → SPEEDBRAKE in the air; GROUND → SPOILERS: ARMED on the ground'),
  reversers: sheet('GROUND → REVERSERS: idle / MAX / stow'),
  atcRequest: sheet('SYSTEMS → RADIO (ATC): the menu\'s four requests are buttons'),

  /* ---- the helicopter ---- */
  heliForward: stick('the stick, pushed up (cyclic forward)'),
  heliBack: stick('the stick, pulled down (cyclic back)'),
  heliLeft: stick('the stick, left'),
  heliRight: stick('the stick, right'),
  heliTurnLeft: rudder('the RUDDER bar (tail rotor), left'),
  heliTurnRight: rudder('the RUDDER bar (tail rotor), right'),
  heliUp: throttle('the lever (collective), up'),
  heliDown: throttle('the lever (collective), down'),
  heliAssist: sheet('SYSTEMS → STABILITY ASSIST (helicopter only)'),

  /* ---- the boat ---- */
  boatFaster: pad('the engine lever\'s detents: FULL · HALF · SLOW', 'touch-detent'),
  boatSlower: pad('the engine lever\'s detents: STOP · ASTERN', 'touch-detent'),
  boatLeft: stick('the wheel (the stick, one axis), left', 'is-wheel'),
  boatRight: stick('the wheel (the stick, one axis), right', 'is-wheel'),
  boatStop: pad('the CRASH STOP pad', 'CRASH STOP'),

  /* ---- the van ---- */
  carGo: feature('src/vehicles/driving.js', 'the GO pedal', 'driveGo'),
  carBrake: feature('src/vehicles/driving.js', 'the STOP pedal (held when stopped: reverse)', 'driveStop'),
  carLeft: feature('src/vehicles/driving.js', 'the STEER strip, left', 'driveSteer'),
  carRight: feature('src/vehicles/driving.js', 'the STEER strip, right', 'driveSteer'),
  carHandbrake: pad('the HAND pad (the brake pad, renamed in the van)', "'HAND'"),

  /* ---- the features\' own keys ---- */
  stovlHover: feature('src/features/stovl.js', 'the F-35B\'s HOVER button', 'ui.btn'),
  wingsBack: feature('src/features/swing-wing.js', 'the Lancer\'s wing-sweep panel: tap back', 'ui.kb'),
  wingsForward: feature('src/features/swing-wing.js', 'the Lancer\'s wing-sweep panel: tap forward', 'ui.kf'),
  cargoRamp: feature('src/features/cargo-ramp.js', 'the OPEN RAMP pad the airlifters add to the pads', 'ramp-pad'),
  worldMap: feature('src/features/world-preview.js', 'the MAP button the World Map preview puts in the HUD column (and World map on the pause screen)', 'wp-mapchip'),
  ackWarnings: feature('src/features/warnings.js', 'tap either master light to silence it', 'tap to silence'),
  zap: feature('src/features/meteor.js', 'the ZAP button in Meteor mode', 'mt-zap'),
  getOut: feature('src/features/onfoot.js', 'the prompt is the button: tap it to get out or back in', 'enterFromPrompt'),
  walkForward: feature('src/features/staff/ui.js', 'the walker\'s thumb-stick (push it right out to run)', 'UI.touch.x'),
  walkBack: feature('src/features/staff/ui.js', 'the walker\'s thumb-stick', 'UI.touch.y'),
  walkLeft: feature('src/features/staff/ui.js', 'the walker\'s thumb-stick', 'UI.touch.x'),
  walkRight: feature('src/features/staff/ui.js', 'the walker\'s thumb-stick', 'UI.touch.x'),
  run: feature('src/features/onfoot.js', 'the RUN button beside the stick (or push the stick right out)', "'run'"),
  jump: feature('src/features/onfoot.js', 'the JUMP button', "'jump'"),
  wave: feature('src/features/onfoot.js', 'the WAVE button', "'wave'"),
  footView: feature('src/features/onfoot.js', 'the VIEW button', "'view'"),
  footLookLeft: feature('src/features/staff/ui.js', 'the walker\'s look pad', 'lookX'),
  footLookRight: feature('src/features/staff/ui.js', 'the walker\'s look pad', 'lookX'),
  footLookUp: feature('src/features/staff/ui.js', 'the walker\'s look pad', 'lookY'),
  footLookDown: feature('src/features/staff/ui.js', 'the walker\'s look pad', 'lookY'),
  eject: feature('src/features/eject.js', 'the EJECT button', 'Tap EJECT'),
  selfDestruct: feature('src/features/eject.js', 'the special planes\' self-destruct button, with CANCEL', 'CANCEL'),
  chuteLeft: feature('src/features/eject.js', 'the parachute\'s ◀ steer button, held', 'setSteer'),
  chuteRight: feature('src/features/eject.js', 'the parachute\'s ▶ steer button, held', 'setSteer'),
  chuteSink: feature('src/features/eject.js', 'the parachute\'s SINK button', 'SINK'),
  chuteLookLeft: {
    desktopOnly: 'Under the parachute the thumb band is the two steer buttons and SINK, which is everything the descent needs; a quarter-turn of the head either way is a desk nicety (Q / E) and two more buttons there would crowd the ones that land you.',
  },
  chuteLookRight: {
    desktopOnly: 'Under the parachute the thumb band is the two steer buttons and SINK, which is everything the descent needs; a quarter-turn of the head either way is a desk nicety (Q / E) and two more buttons there would crowd the ones that land you.',
  },
  flyAgain: feature('src/features/runaway.js', 'the "tap here to fly again" prompt', 'Tap here to fly again'),
  harrisonSpin: feature('src/features/tpose.js', 'T-Pose Harrison\'s SPIN button', 'spinOn'),
  harrisonBoost: feature('src/features/tpose.js', 'T-Pose Harrison\'s BOOST button', 'boostOn'),
  smoke: feature('src/features/fun.js', 'the smoke chip (💨) in Fun Stuff', 'onSmoke'),
  services: sheet('GROUND → the crew button: CALL THE GROUND CREW / PUSH BACK / STOP THE PUSH (the stand prompt is tappable too)'),
  marshalCome: feature('src/features/staff.js', 'the wands\' COME ON button, held', "id: 'come'"),
  marshalLeft: feature('src/features/staff.js', 'the wands\' ◀ LEFT button, held', "id: 'left'"),
  marshalRight: feature('src/features/staff.js', 'the wands\' RIGHT ▶ button, held', "id: 'right'"),
  marshalStop: feature('src/features/staff.js', 'the wands\' STOP button', "id: 'stop'"),
  mpPlayers: feature('src/features/multiplayer/ui.js', 'the multiplayer badge\'s PLAYERS button (touch only)', 'data-mp-players'),
  mpChat1: feature('src/features/multiplayer/ui.js', 'the multiplayer badge\'s CHAT menu', 'data-mp-chat'),
  mpChat2: feature('src/features/multiplayer/ui.js', 'the multiplayer badge\'s CHAT menu', 'data-mp-chat'),
  mpChat3: feature('src/features/multiplayer/ui.js', 'the multiplayer badge\'s CHAT menu', 'data-mp-chat'),
  mpChat4: feature('src/features/multiplayer/ui.js', 'the multiplayer badge\'s CHAT menu', 'data-mp-chat'),
  eventSquawk: feature('src/features/events/hijack.js', 'the squawk button on the hijack card', 'tap the button'),
  eventChoice1: feature('src/features/events/ui.js', 'the question card\'s answers are buttons', 'fx-choice'),
  eventChoice2: feature('src/features/events/ui.js', 'the question card\'s answers are buttons', 'fx-choice'),
  eventChoice3: feature('src/features/events/ui.js', 'the question card\'s answers are buttons', 'fx-choice'),
  eventSkip: {
    desktopOnly: 'The hijack\'s police-boarding cut-scene lasts a few seconds and shares the camera key by design; on a touch screen it plays out, because the camera pad reaches the view through hudAction rather than the key, and rerouting the pad through the key in freeze week risks the camera for a skip nobody has asked for.',
  },
  afoFire: feature('src/features/events/afo.js', 'Air Force One\'s FIRE button (escort seat)', 'afo-action'),
  afoFlare: feature('src/features/events/afo.js', 'Air Force One\'s FLARES button (captain seat)', 'afo-action'),
  rocketAction: feature('src/features/rocket/hud.js', 'the rocket\'s big LAUNCH / DROP / RELEASE button', 'onAction'),
  rocketBurn: feature('src/features/rocket/hud.js', 'the rocket\'s BURN button, held', 'onBurn'),
  rocketLeanLeft: feature('src/features/rocket/hud.js', 'the rocket\'s lean buttons', 'onLean'),
  rocketLeanRight: feature('src/features/rocket/hud.js', 'the rocket\'s lean buttons', 'onLean'),
  rocketView: feature('src/features/rocket/hud.js', 'the rocket HUD\'s camera button', 'viewBtn'),
  rocketWarp: feature('src/features/rocket/hud.js', 'the rocket HUD\'s ×1 / faster button', 'warpBtn'),
  storyPhoto: feature('src/story/ch01-the-glint.js', 'the story\'s "tap to take the photo" button', 'sz-tapphoto'),
  pvpFire: feature('src/features/pvp.js', 'the red FIRE button', 'pvp-fire'),
  hook: feature('src/features/carrier-ops.js', 'the carrier\'s HOOK button', 'HOOK'),
  salute: feature('src/features/carrier-ops.js', 'the carrier\'s LAUNCH button (the salute)', 'LAUNCH'),
  fireMissile: feature('src/features/heatseek/hud.js', 'the FIRE button (military aeroplanes)', 'is-fire'),
  flares: feature('src/features/heatseek/hud.js', 'the FLARES button', 'is-flare'),
  lockOn: feature('src/features/gunsight/hud.js', 'the LOCK button', 'is-lock'),
  crashReplay: feature('src/features/breakup.js', 'the debrief\'s "Watch the replay" button', 'Watch the replay'),
  replayPause: feature('src/features/breakup.js', 'the replay bar\'s ❚❚ button', "button('pause'"),
  replayBack: feature('src/features/breakup.js', 'the replay bar\'s « button', "button('back'"),
  replayForward: feature('src/features/breakup.js', 'the replay bar\'s » button', "button('fwd'"),
  replayClose: feature('src/features/breakup.js', 'the replay bar\'s close button', 'S.ui.close'),
});

/** The ways listed above, for the test. */
export const TOUCH_VIAS = Object.freeze(['stick', 'throttle', 'rudder', 'pad', 'sheet', 'dock', 'tray', 'card', 'pill', 'drag', 'feature']);

/**
 * Every action in `actions` (the registry) that has no row here, and every
 * row here that has no action any more. Pure, so the node test and the
 * browser check share it.
 */
export function coverageGaps(actions) {
  const ids = Object.keys(actions || {});
  const missing = ids.filter((id) => !TOUCH_COVERAGE[id]);
  const stale = Object.keys(TOUCH_COVERAGE).filter((id) => !actions[id]);
  const bad = ids.filter((id) => {
    const c = TOUCH_COVERAGE[id];
    if (!c) return false;
    if (c.desktopOnly) return typeof c.desktopOnly !== 'string' || c.desktopOnly.length < 40;
    return !TOUCH_VIAS.includes(c.via) || !c.where || !c.file;
  });
  return { missing, stale, bad };
}
