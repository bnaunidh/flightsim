/**
 * Depth layering for things drawn on top of one another at the same height.
 *
 * The camera's near plane is 0.4 m and its far plane 60 km, so the depth
 * buffer's step grows with the square of the distance: about a millimetre at
 * 50 m, 15 cm at 1 km, 15 m at 10 km. Two surfaces closer together than that
 * are drawn in whichever order the rounding happens to favour, which changes
 * from frame to frame as the camera moves: z-fighting, and from the air it is
 * a strobe (the owner: "graphic errors that can cause seziure").
 *
 * polygonOffset units are steps of the depth buffer itself, so a push of a
 * few units is the same handful of steps at any range — invisible up close,
 * exactly as large as the error it has to beat far away. The error itself is
 * a step or two (float32 vertex maths near a depth of 1.0 is about one step),
 * so layers are kept at least three steps apart (tests/features/flicker.mjs).
 */

/**
 * The sea's layers. Everything at sea level is drawn a few depth steps
 * BEHIND where it really is, the deep layer furthest, so that:
 *
 *   - anything of the land above the sea always beats the sea (the terrain
 *     under the sea is not drawn at all — see SEA_CUT in terrain.js — so
 *     nothing there needs to);
 *   - the translucent layers (swell, shallows, surf, reef) always sit on the
 *     deep layer, and never on the land behind a beach.
 *
 * Measured with tests/flicker-probe.js from 27,700 ft over Kestrel (the
 * owner's screenshot): 2.95% of the screen flickering more than three times
 * a second before, 0.10% after.
 */
export const SEA_DEPTH = {
  deep: { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 },
  band: { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 },
};
