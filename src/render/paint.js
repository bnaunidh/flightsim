/**
 * The aeroplanes' paint.
 *
 * Painted aluminium is a dielectric: a coat of paint over metal reads as
 * paint, not as metal. The old materials were 35–40% "metal", which is what
 * made a white airliner look pewter-grey in the shade and never quite white
 * in the sun. Here the paint is paint (a little metalness for the bare-metal
 * liveries' sheen), and on High and Ultra it wears a clearcoat: the thin
 * glossy layer over the colour that gives real aircraft their sharp sky
 * reflection and a soft one from the paint underneath. Low and Medium keep a
 * MeshStandardMaterial — the clearcoat is a second specular lobe in every
 * pixel of the aeroplane, and a school laptop does not need it.
 *
 * main.js sets the tier before the first aeroplane is built and again when
 * the quality changes; a model built before that keeps what it had, and is
 * rebuilt with the next aircraft change.
 */

import * as THREE from '../vendor/three.module.js';

let tier = 'high';

export function setPaintTier(q) {
  tier = q === 'low' || q === 'medium' || q === 'high' || q === 'ultra' ? q : 'high';
}

export function paintTier() {
  return tier;
}

/** True when this tier's paint carries a clearcoat. */
export function paintHasClearcoat() {
  return tier === 'high' || tier === 'ultra';
}

/**
 * A painted-skin material. `map` is the livery, `normalMap` the panel lines
 * and rivets. The old roughness/metalness pairs are still accepted and are
 * reshaped: the metalness is cut by half (paint over metal), the roughness
 * kept, so a matte section stays matte beside a glossy one.
 */
export function paintMaterial(map, { roughness = 0.42, metalness = 0.35, color = 0xffffff, normalMap = null, normalScale = 0.5 } = {}) {
  const base = {
    map,
    normalMap,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughness: Math.min(1, roughness + 0.04),
    metalness: metalness * 0.5,
    color,
  };
  if (!paintHasClearcoat()) return new THREE.MeshStandardMaterial(base);
  const mat = new THREE.MeshPhysicalMaterial({
    ...base,
    clearcoat: roughness < 0.5 ? 0.55 : 0.2,
    clearcoatRoughness: roughness < 0.5 ? 0.12 : 0.3,
  });
  return mat;
}
