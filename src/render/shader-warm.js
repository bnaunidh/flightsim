/**
 * Shader warm-up without a stall. A program is linked on its first draw and
 * the main thread waits (the Tomm1z pass: 90-659 ms a first frame, several
 * times that on ANGLE/D3D11). compileAsync (KHR_parallel_shader_compile)
 * links them in the background instead; without it, the same stall, earlier.
 * Never throws; a renderer that cannot precompile compiles on first use.
 */

const STATS = { warms: 0, pending: 0, failed: 0, programsAfter: 0, chunkedWarms: 0, chunks: 0, maxChunkMs: 0 };

/** How many warm-ups ran, are running, failed (tests/features/tomm1z.mjs). */
export function shaderWarmStats() {
  return { ...STATS };
}

/**
 * three's compileAsync, minus its one throw: a material disposed while its
 * poll waits has no program (an uncaught timer error, never resolved). One
 * with no program left is not waited for.
 */
export function compileAsyncSafe(renderer, object, camera, scene) {
  const materials = renderer.compile(object, camera, scene);
  const props = renderer.properties;
  if (!materials || typeof materials.forEach !== 'function' || !props) return Promise.resolve(object);
  return new Promise((resolve) => {
    const check = () => {
      for (const m of [...materials]) {
        let prog = null;
        try {
          prog = props.get(m).currentProgram;
        } catch (e) {
          prog = null;
        }
        let ready = true;
        try {
          ready = !prog || typeof prog.isReady !== 'function' || prog.isReady();
        } catch (e) {
          ready = true; // a program the driver lost: its first draw compiles it
        }
        if (ready) materials.delete(m);
      }
      if (materials.size === 0) resolve(object);
      else setTimeout(check, 10);
    };
    check();
  });
}

/**
 * Compile the programs of `object` (and everything under it, visible or
 * made visible for the duration) in the background. Resolves true when
 * they are ready, false if the renderer could not.
 */
export function warmShadersAsync(renderer, object, camera, scene, { show = [] } = {}) {
  if (!renderer || !object || !camera) return Promise.resolve(false);
  const fn = typeof renderer.compileAsync === 'function' ? 'compileAsync' : typeof renderer.compile === 'function' ? 'compile' : null;
  if (!fn) return Promise.resolve(false);
  const was = show.map((o) => [o, o.visible]);
  for (const o of show) o.visible = true;
  STATS.warms++;
  STATS.pending++;
  let p;
  try {
    p = Promise.resolve(fn === 'compileAsync' && renderer.properties ? compileAsyncSafe(renderer, object, camera, scene || undefined) : renderer[fn](object, camera, scene || undefined));
  } catch (e) {
    p = Promise.reject(e);
  }
  // Hidden again on the very next line: compile() reads visibility
  // synchronously (compileAsync's own compile does too), so the frame never
  // sees the cockpit from outside.
  for (const [o, v] of was) o.visible = v;
  return p.then(
    () => {
      STATS.pending--;
      try {
        STATS.programsAfter = renderer.info && renderer.info.programs ? renderer.info.programs.length : 0;
      } catch (e) {
        /* fine */
      }
      return true;
    },
    () => {
      STATS.pending--;
      STATS.failed++;
      return false;
    }
  );
}

/**
 * The same, a few meshes a timer step within `budgetMs` (on ANGLE over Metal
 * compileAsync's translate is synchronous: 26 programs were 1.1 s in one
 * frame), then compileAsync finds them cached and waits for the link.
 */
export function warmShadersChunked(renderer, object, camera, scene, { budgetMs = 8, show = [] } = {}) {
  if (!renderer || !object || !camera || typeof renderer.compile !== 'function') {
    return warmShadersAsync(renderer, object, camera, scene, { show });
  }
  const meshes = [];
  object.traverse((o) => {
    if (o.isMesh || o.isSprite || o.isPoints || o.isLine) meshes.push(o);
  });
  STATS.chunkedWarms++;
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      const t0 = performance.now();
      const was = show.map((o) => [o, o.visible]);
      for (const o of show) o.visible = true;
      try {
        while (i < meshes.length && performance.now() - t0 < budgetMs) {
          const m = meshes[i++];
          const d = performance.now();
          try {
            renderer.compile(m, camera, scene || undefined);
          } catch (e) {
            /* its first draw compiles it instead */
          }
          STATS.maxChunkMs = Math.max(STATS.maxChunkMs, Math.round(performance.now() - d));
        }
      } finally {
        for (const [o, v] of was) o.visible = v;
      }
      STATS.chunks++;
      if (i < meshes.length) {
        setTimeout(step, 0);
        return;
      }
      warmShadersAsync(renderer, object, camera, scene, { show }).then(resolve);
    };
    step();
  });
}

/** Only what is on show (traverseVisible), chunked the same: a world just built, not all its hidden parts. */
export function warmVisibleChunked(renderer, object, camera, scene, { budgetMs = 8 } = {}) {
  if (!renderer || !object || !camera || typeof renderer.compile !== 'function') return Promise.resolve(false);
  const meshes = [];
  object.traverseVisible((o) => {
    if (o.isMesh || o.isSprite || o.isPoints || o.isLine) meshes.push(o);
  });
  const mats = new Set();
  const props = renderer.properties;
  STATS.chunkedWarms++;
  return new Promise((resolve) => {
    let i = 0;
    const ready = () => {
      for (const m of [...mats]) {
        let ok = true;
        try {
          const p = props.get(m).currentProgram;
          ok = !p || typeof p.isReady !== 'function' || p.isReady();
        } catch (e) {
          ok = true;
        }
        if (ok) mats.delete(m);
      }
      if (mats.size === 0) resolve(true);
      else setTimeout(ready, 10);
    };
    const step = () => {
      const t0 = performance.now();
      while (i < meshes.length && performance.now() - t0 < budgetMs) {
        const m = meshes[i++];
        try {
          const got = renderer.compile(m, camera, scene || undefined);
          if (got && typeof got.forEach === 'function') got.forEach((x) => mats.add(x));
        } catch (e) {
          /* its first draw compiles it instead */
        }
      }
      STATS.chunks++;
      if (i < meshes.length) setTimeout(step, 0);
      else ready();
    };
    step();
  });
}
