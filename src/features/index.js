/**
 * Every feature that plugs in through ../game/extensions.js, imported for its
 * side effect of registering itself. One line per feature, so adding one is
 * a one-line change and removing a broken one is a one-line revert.
 */

import './airport-services.js';
import './airliners.js';
import './stovl.js';
import './warnings.js';
import './explosions.js';
import './crashes.js';
import './meteor.js';
import './wildfire.js';
import './wildfire-disaster.js';
import './onfoot.js';
// After onfoot: the walker hears keys first, and ejecting hands over to it on landing.
import './eject.js';
import './tpose.js';
// After onfoot and eject: wasted is the GTA moment, runaway the plane that goes without you.
import './wasted.js';
// After wasted: anything that moves can knock you down now (a ragdoll), and WASTED shows it.
import './knockdown.js';
import './runaway.js';
import './staff.js';
import './maps-retired.js';
import './flight-events.js';
import './multiplayer.js';
// Before the traffic and every other owner of an aircraft: the one list they all register in,
// which is what the minimap draws and what the player can collide with.
import './sky.js';
import './traffic.js';
import './fun.js';
import './rocket.js';
// List 2, multiplayer part 2: PvP, bumping, the Ring Rally and a world everybody shares.
import './pvp.js';
import './bump.js';
import './race.js';
import './mpworld.js';
// The walking pilot in multiplayer: seen by everybody, knocked down by anybody, and everybody sees the fall.
import './pilot-mp.js';
// Carrier ops: the hook, the wires, the meatball, the catapults, and military flights starting on the ship.
import './carrier-ops.js';
// Air Force One: the escort and the drones/missiles/flares (the captain's side; the lead fighter's own
// side, src/game/roles/afo-lead.js, loads from the mission list, src/game/extra/afo.js, like every seat does).
import './events/afo.js';
// Air Force One, the third seat: the President, walking a small VIP interior (src/game/roles/afo-lead.js
// already imports this for the roles list; imported again here, explicitly, like every other feature).
import '../game/roles/afo-president.js';
// Air Force One's own cinematic tone, every seat, both missions — a letterboxed title card and a few
// short beats, laid on top of the missions above without touching any of their steps.
import './events/afo-movie.js';
// Seats: fly some missions from another aircraft in the story (the lead fighter in the hijacks).
import './roles.js';
