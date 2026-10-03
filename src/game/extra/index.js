/**
 * Missions added after the four games' own lists. One file per group; each
 * exports `MISSIONS` in the shape of the entries in ../missions.js, and
 * missions.js appends them. A mission may carry `category` — the picker
 * groups by it — and `game` ('flight' | 'boat' | 'car' | 'heli').
 */
import { MISSIONS as GOOFY } from './goofy.js';
import { MISSIONS as EVENTS } from './events.js';
import { MISSIONS as METEOR } from './meteor.js';
import { MISSIONS as FIRE } from './fire.js';
import { MISSIONS as AFO } from './afo.js';

export const EXTRA_MISSIONS = [...GOOFY, ...EVENTS, ...METEOR, ...FIRE, ...AFO];
