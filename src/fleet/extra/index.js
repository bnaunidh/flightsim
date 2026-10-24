/**
 * Hand-built models for the added aeroplanes, in the shape of the entries in
 * ../aircraft-combat.js (id, body stations, wing, tail, fin, canopy, gear,
 * engines, decorate(ctx)). `DRAWS` lists the ids the pack should draw in
 * preference to model.js — the same idea as PACK_DRAWS_BETTER in
 * ../../aircraft/model-adapter.js, owned here so adding an aeroplane never
 * means editing that file.
 */
import { DEFINITIONS as FIGHTERS, DRAWS as FIGHTERS_DRAW } from './fighters.js';
import { DEFINITIONS as AIRLINERS, DRAWS as AIRLINERS_DRAW } from './airliners.js';
import { DEFINITIONS as C17, DRAWS as C17_DRAW } from './c17.js';
// ...and the A-10 Thunderbolt II, built with the fighters' helpers.
import { DEFINITIONS as ATTACK, DRAWS as ATTACK_DRAW } from './attack.js';
// new-aircraft (2026-10-16): the popular airliners.
import { DEFINITIONS as JETS, DRAWS as JETS_DRAW } from './jets.js';
// ...and the giants.
import { DEFINITIONS as GIANTS, DRAWS as GIANTS_DRAW } from './giants.js';
// ...and the B-1B Lancer, whose wings move.
import { DEFINITIONS as LANCER, DRAWS as LANCER_DRAW } from './lancer.js';

export const EXTRA_DEFINITIONS = [...FIGHTERS, ...AIRLINERS, ...JETS, ...GIANTS, ...LANCER, ...C17, ...ATTACK];
export const EXTRA_DRAWS = [...FIGHTERS_DRAW, ...AIRLINERS_DRAW, ...JETS_DRAW, ...GIANTS_DRAW, ...LANCER_DRAW, ...C17_DRAW, ...ATTACK_DRAW];
