/**
 * Every feature that plugs in through ../game/extensions.js, imported for its
 * side effect of registering itself. One line per feature, so adding one is
 * a one-line change and removing a broken one is a one-line revert.
 */

import './airport-services.js';
import './airliners.js';
// After airliners: the giants (aircraft/extra/giants.js) say where the long runways are.
import './giants.js';
import './stovl.js';
// The B-1B Lancer's swing wing and afterburners (aircraft/swing-wing.js): before carrier-ops, whose
// hook and catapult keys ([ and ]) it shares — a Lancer has neither.
import './swing-wing.js';
// The fast jets' sense of speed: faint air streaks past the camera above ~450 kt, High and Ultra only.
import './speed-feel.js';
// The C-17's cargo ramp (fleet/extra/c17.js userData.cargo): the key, the panel, the speed rule.
import './cargo-ramp.js';
// The pilot's switches: lights, speedbrake/spoilers, reversers, the ATC request menu.
import './pilot-systems.js';
// Sim gear on the HUD: the connect notice, the "move each lever" check, the thrust detents (flight/controllers.js).
import './controllers-hud.js';
// The cockpit view's snap views (numpad), zoom (wheel, pinch, * and /) and the last look per aircraft.
import './cockpit-cam.js';
import './warnings.js';
import './bird-strike.js';
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
// Nunatak Reach's Site and ice (SCP Foundation content, CC BY-SA 3.0 — see LICENSE): the compound, the
// ice sheets, the de-icing truck, and the Class-D transfer's people (staff/person.js figures).
import './scp-site.js';
import './maps-retired.js';
import './flight-events.js';
import './multiplayer.js';
// Before the traffic and every other owner of an aircraft: the one list they all register in,
// which is what the minimap draws and what the player can collide with.
import './sky.js';
import './traffic.js';
// After traffic and sky: the ambient population of every map — cars on the streets, boats on the
// water, helicopters and light aeroplanes in the sky (solid sky bodies, so the minimap draws them),
// and airport traffic asked of traffic.js under its own runway rules.
import './ambient.js';
// After ambient: life on the airfield — ramp crews, passengers at the stairs, the terminal kerb, base guards,
// and service vehicles on an apron loop (life/plan.js), in free flight and missions.
import './world-life.js';
// After ambient: the emergency scene (a cordon, crews and helicopters round an incident), raised by
// a mission's `scenes` or by any feature; it thins the ambient population round itself.
import './emergency-scene.js';
import './fun.js';
import './rocket.js';
// Replaces the sticker book fun.js used to carry: achievements, named and
// iconned like a console game's. After fun and rocket: it reads a liftoff,
// a touchdown and a rocket launch, never changes them.
import './achievements/index.js';
// After achievements and meteor (it adapts the photo run and notes its medals):
// STORY MODE — "Signal Zero", the Story card on every front page, save/continue,
// the chapter runner on the mission runner, cutscenes, and chapter 1.
import '../story/index.js';
// List 2, multiplayer part 2: PvP, bumping, the Ring Rally and a world everybody shares.
import './pvp.js';
import './bump.js';
import './race.js';
import './mpworld.js';
// The walking pilot in multiplayer: seen by everybody, knocked down by anybody, and everybody sees the fall.
import './pilot-mp.js';
// What friends see of you that the snapshot does not carry: your smoke, your livery, and "away" while you are paused (scuffs #8-#10).
import './mplook.js';
// Your hangar paint on everybody else's screen: one small versioned event (the skins sweep, finding 4).
import './mpskin.js';
// Carrier ops: the hook, the wires, the meatball, the catapults, and military flights starting on the ship.
import './carrier-ops.js';
// After carrier-ops: where a Free Flight starts by aircraft class — a gate, the GA apron, the flight
// line, a pad, the harbour — with the "Start at" picker that folds the carrier choice in. Its
// startFree wrapper has to be the outermost one, so it is installed after the carrier's.
import './spawns.js';
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
// Heat-seeking missiles on the military jets (three, lock-on, flares, pylons you can see) and the
// Heat-Seeker disaster. After pvp (the host judges a missile that hits a player), sky (the drones are
// bodies in its list), eject (the seat that fires for you after a big hit) and the Air Force One drones.
import './heatseek.js';
import './heatseek-disaster.js';
// The gunsight and the lock key: a ring and dot, range ticks, a lead pipper and a target box for the guns (and the same box for the missiles). After heatseek, whose lock it steers.
import './gunsight.js';
// The owner's hour: the fan on the main page, the code box and the chip (./owner.js; the pass itself is ./multiplayer/owner.js).
import './owner.js';
// The owner's toys, in the hour: the troll menu, the disaster trolls, teleport on the map and taking aircraft over (./owner/*.js).
import './owner/trolls.js';
import './owner/teleport.js';
// The secret runway boxes every "land on the runway" step counts three seconds in (game/landing-zone.js),
// drawn only for a developer: ?lzdebug, or the Dev panel's "Landing hitboxes".
import './landing-zones.js';
// Crash physics: every model breaks at its own break points, nearest the hit first, the pieces as
// rigid bodies; the slow-motion beat and the instant replay. Last, so every other feature's crash
// handling (./crashes.js's choreography, ./sky.js's knock) has run before it breaks anything.
import './breakup.js';
// World Map — Preview: its own card in the map picker (one sea, five airports, ground streamed round
// the camera, a world map and a destination). Not on the roster; nothing runs until it is picked.
import './world-preview.js';
// The full-screen live map on every map (5, or tap the minimap): never pauses, a chart by zoom level.
import './livemap/livemap.js';
// DIRECT TO and a flight plan on the live map, flown by the autopilot in NAV. After the preview, so
// its guidance wraps the preview's trip (a DIRECT TO flies over a destination).
import './livemap/nav.js';
// "NOW ENTERING" an island, "WELCOME TO" a field after a flight: a title under the heading tape.
import './livemap/where.js';
// Each field's control zone: ENTERING AIRSPACE · the frequency, the approach controller's hand-off.
import './livemap/airspace.js';
// The World Map's regional weather on the live map: a sun, cloud, rain, storm or fog icon per region.
import './wx-map.js';
// The map loading screen, about three seconds, in front of every way into a map (Free Flight, a
// mission, a Story chapter, a multiplayer join, a boat or a van). Last, so its wrapper on the
// game's startMode is the outermost one, over everything above that waits to be started.
import './loading-screens.js';
