/**
 * The graphics tier, for the aircraft models.
 *
 * The models are built by two factories (the fleet pack in src/fleet/ and the
 * civil builder in ./models/) that neither read the settings nor should: a
 * model is built the same whoever asks for it. What they need is one answer
 * to "is this High or better?", for the details that are only worth their
 * cost on a good card — the heat shimmer behind a jet nozzle, chiefly.
 *
 * main.js tells this module the tier at boot and whenever the setting
 * changes; the models read it when they build and, for anything that can be
 * switched live, every frame.
 */

const RANK = { low: 0, medium: 1, high: 2, ultra: 3 };

let tier = 'high';

/** Set the tier ('low' | 'medium' | 'high' | 'ultra'). Anything else is ignored. */
export function setModelQuality(q) {
  if (q in RANK) tier = q;
}

export function modelQuality() {
  return tier;
}

/** High or Ultra: the effects that cost a draw call per engine are wanted. */
export function highQuality() {
  return RANK[tier] >= RANK.high;
}

export function qualityRank(q = tier) {
  return RANK[q] ?? RANK.high;
}
