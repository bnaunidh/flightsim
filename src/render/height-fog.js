/**
 * Height fog: murk that lies low.
 *
 * The scene's fog (THREE.FogExp2) is the same at every height, which is
 * right for a hazy day and wrong for a morning mist: that fills the valleys
 * and lies on the water, and you climb out of the top of it into sun. This
 * adds an exponential layer on top of three's own fog, in three's own fog
 * chunks, so every material that already fogs — the ground, the sea, the
 * aeroplanes, the buildings, three's built-in materials and the custom
 * shaders that include the chunks — gets it with no change of its own:
 *
 *   density(h) = a · e^(−h / H)          (h metres above the sea)
 *
 * integrated exactly along the line from the eye to the fragment, so a hill
 * top pokes out of a valley fog and the sea goes white from above. The
 * weather sets a and H (world/wx.js fogFor: `hfA`, `hfH`) and the eye's
 * height each frame (main.js); a = 0 switches it off, which costs one
 * uniform branch per fragment.
 *
 * The uniform is one plain object shared BY REFERENCE: three's cloneUniforms
 * copies a Vector4 per material but keeps a plain object as it is, so the
 * one HEIGHT_FOG below is every material's. It is added to UniformsLib.fog
 * and to every ShaderLib entry that fogs before the first material is made
 * (installHeightFog, called from main.js at import). A custom shader that
 * includes the fog chunks without UniformsLib.fog reads it as zero — off —
 * exactly as it was.
 */
import * as THREE from '../vendor/three.module.js';

/**
 * x: a (1/m at sea level) · y: 1/H · z: the eye's height (m) · w: 1 while
 * the shaders draw the layer, 0 when the world is built at Low (setHeightFog
 * `inShaders`). x is still set then: the sky and the clouds veil themselves
 * by it on the CPU, and main.js turns it into an even fog.
 */
export const HEIGHT_FOG = { x: 0, y: 1 / 150, z: 0, w: 1 };

let installed = false;

/** Is the layer in the shaders (Medium and up; main.js leaves Low without it)? */
export function heightFogInstalled() {
  return installed;
}

export function installHeightFog() {
  if (installed) return true;
  installed = true;
  const U = { value: HEIGHT_FOG };
  THREE.UniformsLib.fog.heightFog = U;
  for (const k of Object.keys(THREE.ShaderLib)) {
    const sh = THREE.ShaderLib[k];
    if (sh && sh.uniforms && 'fogDensity' in sh.uniforms) sh.uniforms.heightFog = U;
  }
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying float vFogRelY;
#endif
`;
  // The fragment's height over the eye, in world metres: mv = R·(p − eye), so
  // (p − eye).y = (Rᵀ·mv).y = Σj R[j][1]·mv[j] — column 1 of R, which GLSL
  // indexes as viewMatrix[1].
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogRelY = dot( viewMatrix[ 1 ].xyz, mvPosition.xyz );
#endif
`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying float vFogRelY;
	uniform vec4 heightFog;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
		if ( heightFog.x * heightFog.w > 0.0 ) {
			// The layer's optical depth from the eye (h0) to the fragment (h1), exactly.
			float hfB = heightFog.y;
			float hfH0 = max( heightFog.z, - 50.0 );
			float hfH1 = max( heightFog.z + vFogRelY, - 50.0 );
			float hfE0 = exp( - hfB * hfH0 );
			float hfE1 = exp( - hfB * hfH1 );
			float hfDh = hfH1 - hfH0;
			float hfAvg = abs( hfDh ) > 0.5 ? ( hfE0 - hfE1 ) / ( hfB * hfDh ) : hfE0;
			float hfOD = heightFog.x * vFogDepth * hfAvg;
			fogFactor = 1.0 - ( 1.0 - fogFactor ) * exp( - min( hfOD, 40.0 ) );
		}
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
  return true;
}

/**
 * The layer's optical depth looking `dirY` (the sine of the angle above the
 * horizon) from height `h0`, out to `dist` metres — what the sky dome and
 * the clouds use to veil themselves (they do not fog per fragment).
 */
export function heightFogDepth(a, invH, h0, dirY, dist = 30000) {
  if (!(a > 0)) return 0;
  const e0 = Math.exp(-invH * Math.max(-50, h0));
  const dh = dirY * dist;
  const h1 = Math.max(-50, h0 + dh);
  if (Math.abs(h1 - h0) < 0.5) return a * dist * e0;
  return (a * dist * (e0 - Math.exp(-invH * h1))) / (invH * (h1 - h0));
}

/**
 * Set the layer: extinction at sea level (1/m), its depth (m), the eye's
 * height, and whether the shaders draw it (false at Low: a Chromebook that
 * booted at High and was moved to Low by the Auto probe has the chunks
 * installed, and must not pay for them).
 */
export function setHeightFog(a, depthM, eyeY, inShaders = true) {
  HEIGHT_FOG.x = a > 1e-7 ? a : 0;
  HEIGHT_FOG.y = 1 / Math.max(20, depthM || 150);
  HEIGHT_FOG.z = eyeY || 0;
  HEIGHT_FOG.w = inShaders && installed ? 1 : 0;
  return HEIGHT_FOG;
}

/** Is the layer drawn by the shaders right now (installed, and not switched off for Low)? */
export function heightFogInShaders() {
  return installed && HEIGHT_FOG.w > 0;
}
