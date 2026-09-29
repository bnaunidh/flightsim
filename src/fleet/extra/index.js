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

export const EXTRA_DEFINITIONS = [...FIGHTERS, ...AIRLINERS];
export const EXTRA_DRAWS = [...FIGHTERS_DRAW, ...AIRLINERS_DRAW];
