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
import { check as events } from './events.browser.js';
import { check as airliners } from './airliners.browser.js';
import { check as afo } from './afo.browser.js';
import { check as afoPresident } from './afo-president.browser.js';
import { check as fighters } from './fighters.browser.js';
import { check as fire } from './fire.browser.js';
import { check as fun } from './fun.browser.js';
import { check as instruments } from './instruments.browser.js';
import { check as keybinds } from './keybinds.browser.js';
import { check as maps } from './maps.browser.js';
import { check as menus } from './menus.browser.js';
import { check as multiplayer } from './multiplayer.browser.js';
import { check as multiplayerList2 } from './multiplayer-list2.browser.js';
import { check as multiplayerList3 } from './multiplayer-list3.browser.js';
import { check as multiplayerPart2 } from './multiplayer-part2.browser.js';
import { check as multiplayerPlane } from './multiplayer-plane.browser.js';
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

export const CHECKS = [
  { id: 'airport', check: airport },
  { id: 'boat-playtest', check: boatPlaytest },
  { id: 'brace', check: brace },
  { id: 'car-playtest', check: carPlaytest },
  { id: 'civil', check: civil },
  { id: 'crashes', check: crashes },
  { id: 'airliners', check: airliners },
  { id: 'fighters', check: fighters },
  { id: 'events', check: events },
  // After events: Air Force One is the same mission-roles/afo-combat shape, driven the same way.
  { id: 'afo', check: afo },
  // After afo: the third seat (the President), walking its own small cabin.
  { id: 'afo-president', check: afoPresident },
  { id: 'fire', check: fire },
  { id: 'fun', check: fun },
  { id: 'instruments', check: instruments },
  { id: 'maps', check: maps },
  // After maps: the missions spread over them — each moved one starts on its island, three flown to the end.
  { id: 'mission-maps', check: missionMaps },
  { id: 'menus', check: menus },
  // After menus: every way of turning sound off, and that it stays off (nothing played out loud).
  { id: 'sound', check: sound },
  { id: 'onfoot', check: onfoot },
  { id: 'quality', check: quality },
  { id: 'traffic', check: traffic },
  // After traffic: every aircraft in one list — collisions with all of them, and all of them on the minimap.
  { id: 'sky', check: sky },
  { id: 'weapons', check: weapons },
  // After weapons (it drives the meteor missions too): nothing of meteor mode on, or left on, the minimap.
  { id: 'minimap-ghosts', check: minimapGhosts },
  { id: 'multiplayer', check: multiplayer },
  { id: 'multiplayer-list2', check: multiplayerList2 },
  { id: 'multiplayer-list3', check: multiplayerList3 },
  // After list3: the plane picked in the Hangar is the one flown in a lobby, over a ride saved on the lobby screen (v56).
  { id: 'multiplayer-plane', check: multiplayerPlane },
  { id: 'aircrew', check: aircrew },
  // After aircrew: the walking pilot knocked down by anything that moves (the pilot brief).
  { id: 'pilot', check: pilot },
  { id: 'rocket', check: rocket },
  { id: 'multiplayer-part2', check: multiplayerPart2 },
  { id: 'races', check: races },
  { id: 'air-fuel', check: airFuel },
  // The owner's "graphic errors that can cause seziure": the screen measured at the worst places, and Reduce flashing.
  { id: 'flicker', check: flicker },
  // Replaces the sticker book fun.js used to carry.
  { id: 'achievements', check: achievements },
  // Last: it rebinds keys through Settings (and puts the player's back after).
  { id: 'keybinds', check: keybinds },
];
