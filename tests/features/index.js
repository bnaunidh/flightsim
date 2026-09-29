/**
 * Browser checks for the plug-in features, one file per feature.
 *
 * Each file exports `async function check(sim, r, say)` in the same style as
 * tests/selftest-three-games.js: `r.ok(name, pass, detail)` per assertion.
 * tests/selftest.js calls every one of them at the end of the run, each
 * fenced off so a feature whose check throws reports one failure and does
 * not stop the others.
 */
import { check as airport } from './airport.browser.js';
import { check as boatPlaytest } from './boat-playtest.browser.js';
import { check as carPlaytest } from './car-playtest.browser.js';
import { check as civil } from './civil.browser.js';
import { check as events } from './events.browser.js';
import { check as airliners } from './airliners.browser.js';
import { check as fighters } from './fighters.browser.js';
import { check as fire } from './fire.browser.js';
import { check as instruments } from './instruments.browser.js';
import { check as maps } from './maps.browser.js';
import { check as menus } from './menus.browser.js';
import { check as multiplayer } from './multiplayer.browser.js';
import { check as onfoot } from './onfoot.browser.js';
import { check as traffic } from './traffic.browser.js';
import { check as weapons } from './weapons.browser.js';

export const CHECKS = [
  { id: 'airport', check: airport },
  { id: 'boat-playtest', check: boatPlaytest },
  { id: 'car-playtest', check: carPlaytest },
  { id: 'civil', check: civil },
  { id: 'airliners', check: airliners },
  { id: 'fighters', check: fighters },
  { id: 'events', check: events },
  { id: 'fire', check: fire },
  { id: 'instruments', check: instruments },
  { id: 'maps', check: maps },
  { id: 'menus', check: menus },
  { id: 'onfoot', check: onfoot },
  { id: 'traffic', check: traffic },
  { id: 'weapons', check: weapons },
  { id: 'multiplayer', check: multiplayer },
];
