/**
 * Speeds in mission words, for the aeroplane actually being flown.
 *
 * "Lift off at 55 knots" was written into the missions for the Skylark and
 * read out in everything: Tomm1z's A321 was told to lift off at 55 (7:00,
 * "that's like nothing"). The mission files now say {Vr}, {Vapp}, {Vglide},
 * {Vdrop} and {Vthr}, and the line is resolved where it is shown — the
 * objective, a hint, a radio call, the briefing — from the type's own
 * numbers (ui/speed-bands.js, the same table the HUD's coach uses, so the
 * two never disagree). A Skylark gets exactly the numbers it had.
 *
 * Pure: no DOM, no game object. tests/features/tomm1z-text.mjs runs it and
 * scans the mission files for a literal speed left behind.
 */

import { speedBands } from '../ui/speed-bands.js';
import { performanceFor } from '../aircraft/types.js';

const r5 = (v) => Math.round(v / 5) * 5;

/** The tokens a mission line may use, and what each means. */
export const SPEED_TOKENS = Object.freeze({
  Vr: 'rotate / lift-off',
  Vapp: 'final approach',
  Vglide: 'best glide (engine out)',
  Vdrop: 'slow and steady for a drop',
  Vthr: 'over the threshold',
});

const cache = new Map();

/** { Vr, Vapp, Vglide, Vdrop, Vthr } in knots for a type id (the Skylark's: 55, 70, 65, 70, 60). */
export function speedWordsFor(typeId) {
  const id = typeId || 'skylark';
  if (cache.has(id)) return cache.get(id);
  let perf = null;
  try {
    perf = performanceFor(id);
  } catch (e) {
    perf = null;
  }
  const B = speedBands(perf);
  const big = B.scale > 1.05;
  const sc = perf && perf.stallClean > 0 ? perf.stallClean : 49;
  const out = Object.freeze({
    Vr: B.liftOff,
    Vapp: B.approach,
    // Best glide sits about a third over the clean stall (the Skylark's 65 over 49).
    Vglide: big ? r5(sc * 1.33) : 65,
    Vdrop: big ? r5(B.cruise) : 70,
    Vthr: big ? B.approach - 5 : 60,
  });
  cache.set(id, out);
  return out;
}

const TOKEN_RE = /\{(Vr|Vapp|Vglide|Vdrop|Vthr)([+-]\d+)?\}/g;

/** The line with its tokens filled in for the type; anything else is returned as it was. */
export function resolveSpeedText(text, typeId) {
  if (typeof text !== 'string' || text.indexOf('{V') < 0) return text;
  const W = speedWordsFor(typeId);
  return text.replace(TOKEN_RE, (m, k, off) => String(W[k] + (off ? Number(off) : 0)));
}

/** Does a line still carry a token? (A test's question, and the briefing's.) */
export function hasSpeedToken(text) {
  return typeof text === 'string' && /\{V(r|app|glide|drop|thr)([+-]\d+)?\}/.test(text);
}
