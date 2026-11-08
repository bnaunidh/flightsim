/**
 * SPIRELINE: Nullspire's own airline, the secret one. The owner, 2026-11-08:
 * "add a secret airline if u find it". Reaching the city (the discovery
 * notice, features/farlands-run.js) puts it in the livery picker for good.
 *
 * Like the Javelin (./javelin.js) it is NOWHERE until found: nothing in the
 * first load imports this file, and registerSpireline() pushes the scheme
 * into aircraft/liveries.js LIVERIES only when the city has been seen
 * (features/secrets.js at load; farlands-run.js the moment it happens). It
 * is never in AIRLINE_LIVERIES, which is frozen at load, so no stand and no
 * ambient airliner ever wears it by chance: the only Spireline aeroplanes
 * are the ones you paint, and the city's own craft (worldmap/void-city-craft.js
 * wears its colours).
 *
 * Original: a fictional airline with its own name, colours, wordmark
 * (fleet/extra/wordmarks.js, registered here) and fin mark (fleet/extra/
 * emblems.js `spire`: a spire of light over a void disc). No real airline,
 * logo or typeface.
 */
import { LIVERIES } from '../liveries.js';

export const SPIRELINE_ID = 'spireline';

/** The scheme, in LIVERIES' shape (see aircraft/liveries.js for every field). */
export const SPIRELINE = Object.freeze({
  id: SPIRELINE_ID,
  name: 'Spireline',
  callsign: 'Spireline',
  blurb: 'Void black under a lantern-amber crown — Nullspire\'s own airline, a secret found in the void',
  base: '#10131a',
  accent: '#ffb04a',
  cheatline: 'rgba(255,176,74,0.95)',
  tail: 0x10131a,
  reg: 'NS-01',
  titling: 'SPIRELINE',
  emblem: 'spire',
  fleet: ['a320', 'a321', 'b737', 'b787', 'a350', 'b777', 'b747', 'a380', 'q400', 'meridian'],
  style: Object.freeze({
    layout: 'crown',
    belly: '#10131a',
    upper: '#ffb04a',
    pinstripe: '#3fd1e0',
    cowl: '#10131a',
    cowlBand: '#ffb04a',
    emblemInks: ['#ffb04a', '#3fd1e0', '#10131a'],
    titleFont: { family: 'Exo 2', weight: 800, style: 'normal' },
    titleInk: '#ffb04a',
  }),
  // Yours once found; never handed out at random (AIRLINE_LIVERIES is sealed before this exists).
  special: true,
  secret: true,
});

/** The wordmark: wide capitals, the I a spire of light with a halo over it, the line in teal under it. */
export const SPIRELINE_WORDMARK = Object.freeze({
  reads: 'SPIRELINE',
  idea: 'wide capitals in lantern amber, the I drawn as a spire with a halo, a teal rule beneath',
  inks: ['#ffb04a', '#3fd1e0', '#10131a'],
  rows: [{ runs: [{ t: 'SP' }, { t: 'I', ink: 1, gap: 0.02 }, { t: 'RELINE', gap: 0.02 }], track: 0.05 }],
  kern: { LI: -0.01, IN: -0.005 },
  bold: 0.004,
  deco(d) {
    const { g, W, cap } = d;
    g.fillStyle = d.ink(1);
    g.fillRect(0, cap * 0.18, W, cap * 0.05);
  },
});

/** Put the airline in the picker, once. Returns the scheme. Also teaches the wordmarks (lazily: the fleet pack). */
export function registerSpireline() {
  if (!LIVERIES.some((l) => l.id === SPIRELINE_ID)) LIVERIES.push(SPIRELINE);
  import('../../fleet/extra/wordmarks.js').then((m) => {
    if (m.WORDMARKS && !m.WORDMARKS[SPIRELINE_ID]) m.WORDMARKS[SPIRELINE_ID] = SPIRELINE_WORDMARK;
  }).catch(() => {});
  return SPIRELINE;
}

export function spirelineRegistered() {
  return LIVERIES.some((l) => l.id === SPIRELINE_ID);
}
