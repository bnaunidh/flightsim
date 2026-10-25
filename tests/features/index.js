/**
 * Browser checks for the plug-in features, one file per feature.
 *
 * Each file exports `async function check(sim, r, say)` in the same style as
 * tests/selftest-three-games.js: `r.ok(name, pass, detail)` per assertion.
 * tests/selftest.js calls every one of them at the end of the run, each
 * fenced off so a feature whose check throws reports one failure and does
 * not stop the others.
 */
import { check as aircrew } from './aircrew.browser.js';
import { check as airFuel } from './air-fuel.browser.js';
import { check as airport } from './airport.browser.js';
import { check as boatPlaytest } from './boat-playtest.browser.js';
import { check as brace } from './brace.browser.js';
import { check as carPlaytest } from './car-playtest.browser.js';
import { check as civil } from './civil.browser.js';
import { check as crashes } from './crashes.browser.js';
import { check as breakup } from './breakup.browser.js';
import { check as events } from './events.browser.js';
import { check as airliners } from './airliners.browser.js';
import { check as newAircraft } from './new-aircraft.browser.js';
import { check as lancer } from './lancer.browser.js';
import { check as c17 } from './c17.browser.js';
import { check as afo } from './afo.browser.js';
import { check as afoPresident } from './afo-president.browser.js';
import { check as heatSeekers } from './heat-seekers.browser.js';
import { check as gunsight } from './gunsight.browser.js';
import { check as fighters } from './fighters.browser.js';
import { check as cockpits } from './cockpits.browser.js';
import { check as fire } from './fire.browser.js';
import { check as scpSnow } from './scp-snow.browser.js';
import { check as fun } from './fun.browser.js';
import { check as smokeClouds } from './smoke-clouds.browser.js';
import { check as instruments } from './instruments.browser.js';
import { check as keybinds } from './keybinds.browser.js';
import { check as maps } from './maps.browser.js';
import { check as menus } from './menus.browser.js';
import { check as hangar } from './hangar.browser.js';
import { check as uiPolish } from './ui-polish.browser.js';
import { check as multiplayer } from './multiplayer.browser.js';
import { check as multiplayerList2 } from './multiplayer-list2.browser.js';
import { check as multiplayerList3 } from './multiplayer-list3.browser.js';
import { check as multiplayerJoin } from './multiplayer-join.browser.js';
import { check as multiplayerPart2 } from './multiplayer-part2.browser.js';
import { check as multiplayerPlane } from './multiplayer-plane.browser.js';
import { check as owner } from './owner.browser.js';
import { check as ownerTrolls } from './owner-trolls.browser.js';
import { check as adminTrolls } from './admin-trolls.browser.js';
import { check as onfoot } from './onfoot.browser.js';
import { check as pilot } from './pilot.browser.js';
import { check as quality } from './quality.browser.js';
import { check as rocket } from './rocket.browser.js';
import { check as sound } from './sound.browser.js';
import { check as races } from './race-all.browser.js';
import { check as traffic } from './traffic.browser.js';
import { check as weapons } from './weapons.browser.js';
import { check as minimapGhosts } from './minimap-ghosts.browser.js';
import { check as sky } from './sky.browser.js';
import { check as missionMaps } from './mission-maps.browser.js';
import { check as flicker } from './flicker.browser.js';
import { check as achievements } from './achievements.browser.js';
import { check as worldScale } from './world-scale.browser.js';
import { check as mapsKitB } from './maps-kit-b.browser.js';
import { check as comic } from './comic.browser.js';
import { check as story } from './story.browser.js';
import { check as loadingScreens } from './loading-screens.browser.js';
import { check as skins } from './skins.browser.js';
import { check as crashSweep } from './crash-sweep.browser.js';
import { check as crashFreeze } from './crash-freeze.browser.js';
import { check as birdStrike } from './bird-strike.browser.js';
import { check as walkAway } from './walk-away.browser.js';
import { check as landingZone } from './landing-zone.browser.js';
import { check as hudStack } from './hud-stack.browser.js';
import { check as hudWins } from './hud-wins.browser.js';
import { check as touchCoverage } from './touch-coverage.browser.js';

export const CHECKS = [
  { id: 'airport', check: airport },
  { id: 'boat-playtest', check: boatPlaytest },
  { id: 'brace', check: brace },
  { id: 'car-playtest', check: carPlaytest },
  { id: 'civil', check: civil },
  { id: 'crashes', check: crashes },
  // After crashes: the break points, the pieces, the replay and the slow sinking at sea.
  { id: 'breakup', check: breakup },
  // After breakup: the crash sweep's findings on the real game — every crash under the flicker probe, sea debris, a wreck on land, the replay after a teleport.
  { id: 'crash-sweep', check: crashSweep },
  // After the sweep: the crash FRAME itself — no shader recompiles, the zone survey built ahead, under 50 ms.
  { id: 'crash-freeze', check: crashFreeze },
  // The bird strike's flock: in first, the hit under half a second later, once.
  { id: 'bird-strike', check: birdStrike },
  // Out on foot, the empty aeroplane's crash is news, not a reset.
  { id: 'walk-away', check: walkAway },
  { id: 'airliners', check: airliners },
  // After airliners: the ten added by new-aircraft, each flown round a circuit on its own map.
  { id: 'new-aircraft', check: newAircraft },
  // The B-1B Lancer: its swing wing, its keys and panel, a circuit on Kestrel, Mach 1 at 40,000 ft.
  { id: 'lancer', check: lancer },
  // The C-17 Globemaster III: its cargo ramp (key, panel, the speed rule) and a circuit on Kestrel.
  { id: 'c17', check: c17 },
  { id: 'fighters', check: fighters },
  // After fighters: every family's cockpit on the model the game draws — screens live, shadows in, a finger to look round.
  { id: 'cockpits', check: cockpits },
  { id: 'events', check: events },
  // After events: Air Force One is the same mission-roles/afo-combat shape, driven the same way.
  { id: 'afo', check: afo },
  // After afo: the third seat (the President), walking its own small cabin.
  { id: 'afo-president', check: afoPresident },
  // After afo: three heat-seekers on the military jets (the escort seat's drones are targets), and the Heat-Seeker disaster.
  { id: 'heat-seekers', check: heatSeekers },
  // After heat-seekers: the gunsight and the lock key (the same box, the same targets), and the meteor zapper that needs a plane with guns.
  { id: 'gunsight', check: gunsight },
  { id: 'fire', check: fire },
  { id: 'fun', check: fun },
  // After fun: the smoke turned into a cloud that wears off, and the tank that makes it "every so often".
  { id: 'smoke-clouds', check: smokeClouds },
  { id: 'instruments', check: instruments },
  { id: 'maps', check: maps },
  // After maps: the missions spread over them — each moved one starts on its island, three flown to the end.
  { id: 'mission-maps', check: missionMaps },
  { id: 'menus', check: menus },
  // After menus: the organised hangar — shelves, search, sort, filters, favourites, recently flown, New.
  { id: 'hangar', check: hangar },
  // After menus: the deck — the start screen's and the HUD's glass, radius, motion and touch sizes, and html.fx-low on Low.
  { id: 'ui-polish', check: uiPolish },
  // After menus: every way of turning sound off, and that it stays off (nothing played out loud).
  { id: 'sound', check: sound },
  { id: 'onfoot', check: onfoot },
  { id: 'quality', check: quality },
  // After quality: how big things are — a house beside the aeroplane and the altitude line's height over the ground (the owner's "200 ft houses").
  { id: 'world-scale', check: worldScale },
  // After quality (it builds every aeroplane in every paint): the skins sweep's findings — the pack's tails and numbers, the civil models' lettering, who is handed which paint.
  { id: 'skins', check: skins },
  { id: 'traffic', check: traffic },
  // After traffic: every aircraft in one list — collisions with all of them, and all of them on the minimap.
  { id: 'sky', check: sky },
  { id: 'weapons', check: weapons },
  // After weapons (it drives the meteor missions too): nothing of meteor mode on, or left on, the minimap.
  { id: 'minimap-ghosts', check: minimapGhosts },
  { id: 'multiplayer', check: multiplayer },
  { id: 'multiplayer-list2', check: multiplayerList2 },
  { id: 'multiplayer-list3', check: multiplayerList3 },
  { id: 'multiplayer-join', check: multiplayerJoin },
  // After list3: the plane picked in the Hangar is the one flown in a lobby, over a ride saved on the lobby screen (v56).
  { id: 'multiplayer-plane', check: multiplayerPlane },
  { id: 'aircrew', check: aircrew },
  // After aircrew: the walking pilot knocked down by anything that moves (the pilot brief).
  { id: 'pilot', check: pilot },
  { id: 'rocket', check: rocket },
  { id: 'multiplayer-part2', check: multiplayerPart2 },
  { id: 'owner', check: owner },
  // After owner: the owner's toys — the troll menu, the disaster trolls, teleport and take over (a private match in this tab).
  { id: 'owner-trolls', check: ownerTrolls },
  // "troll thing for admin": the same toys for an admin, never on the owner or another admin.
  { id: 'admin-trolls', check: adminTrolls },
  { id: 'races', check: races },
  { id: 'air-fuel', check: airFuel },
  // The owner's "graphic errors that can cause seziure": the screen measured at the worst places, and Reduce flashing.
  { id: 'flicker', check: flicker },
  // The owner's "remove the comic stuff, put it in settings and default off": the default settings, and the switch.
  { id: 'comic', check: comic },
  // Replaces the sticker book fun.js used to carry.
  { id: 'achievements', check: achievements },
  // After achievements (it notes the story's medals): STORY MODE — the Story card, chapter 1
  // played to the end by a scripted pilot, and leave-then-Continue at a checkpoint.
  { id: 'story', check: story },
  // After story (it plays chapter 1's landing from its own clean save, which this puts back): the secret
  // runway box — three seconds down in it is a landing, in the story, a mission and a delivery; the grass is not.
  { id: 'landing-zone', check: landingZone },
  // After story: the HUD's right-hand stack, its centre lane, the Clean HUD and chapter 1's ring
  // (the owner's 2026-10-16 screenshot of four cards on top of each other).
  { id: 'hud-stack', check: hudStack },
  // After hud-stack: the HUD quick wins — the touchdown card, the state pills, the
  // destination ribbon and beacon, the conditions chip and Full / Clean / Photo.
  { id: 'hud-wins', check: hudWins },
  { id: 'touch-coverage', check: touchCoverage },
  // After everything that flies: KIT-B — where a Free Flight starts (the picker), the ambient
  // population and the emergency scene, on Gateway and The Big Burn.
  { id: 'maps-kit-b', check: mapsKitB },
  // After maps-kit-b (it borrows a map too, and puts it back): the snow lane — Nunatak Reach, the
  // ice under the wheels, the Site and the Class-D transfer, flown start to finish.
  { id: 'scp-snow', check: scpSnow },
  // The map loading screen, about three seconds, in front of every way into a map. It switches
  // itself on for its own checks (the suite runs with it off) and puts the map back.
  { id: 'loading-screens', check: loadingScreens },
  // Last: it rebinds keys through Settings (and puts the player's back after).
  { id: 'keybinds', check: keybinds },
];
