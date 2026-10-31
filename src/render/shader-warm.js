/**
 * Shader warm-up without a stall.
 *
 * Every material's program is compiled by the GPU driver the first time it
 * is drawn, and the main thread waits for it. Measured in the Tomm1z pass
 * (.claude/devtools/briefs/tomm1z-video.md, the sampling profile with the
 * CPU governor's gaps taken out): the hangar's first podium 638 ms, the
 * A321's first frame 236 ms, the first flight's 90 ms, the take-off's 101 ms
 * and the Low tier's first flight 659 ms — all of it inside three.js's
 * getProgramInfoLog, the sync point after linkProgram. On Windows (ANGLE
 * over D3D11, the YouTuber's machine) each program costs several times what
 * it does on Metal, which is the "a lot of lag" of a first visit.
 *
 * three r169 has renderer.compileAsync(): with KHR_parallel_shader_compile
 * (every current Chrome, Edge and Firefox) the programs are created now and
 * the driver compiles them in the background while the game carries on, and
 * the promise resolves when every one is ready. So the world is warmed
 * behind the loading bar, the aeroplane and its cockpit the moment they are
 * built (the cockpit made visible for the compile and hidden again), the
 * hangar's podium before it is shown and a real skin before its first
 * frame. Without the extension compileAsync is a plain compile: the same
 * stall, moved earlier, which is still better than mid-taxi.
 *
 * Never throws; a renderer that cannot precompile compiles on first use.
 */

const STATS = { warms: 0, pending: 0, failed: 0, programsAfter: 0, chunkedWarms: 0, chunks: 0, maxChunkMs: 0 };

/** How many warm-ups ran, are running, failed (tests/features/tomm1z.mjs). */
export function shaderWarmStats() {
  return { ...STATS };
}

/**
 * three's renderer.compileAsync, minus its one way to throw. Its poll reads
 * properties.get(material).currentProgram.isReady() every 10 ms, and a
 * material DISPOSED while it waits (the world rebuilt by the Auto probe or a
 * detail change, a hangar podium swapped, a skin thrown away) has no program
 * any more: the poll threw "Cannot read properties of undefined (reading
 * 'isReady')" from a timer, uncaught, and never resolved -- a console error
 * on the hangar, and a real skin held hidden for good. Same compile, same
 * wait; a material with no program left is simply not waited for.
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
 * The same warm-up, a few meshes per step within `budgetMs`, steps on the
 * timer between frames. On some drivers (ANGLE over Metal, measured here) the
 * "non-blocking" part of compileAsync — translating every shader — is itself
 * synchronous: 26 programs were 1.1 s in the one frame that started the
 * warm. Spread over steps, no frame pays for more than one or two programs;
 * once every program exists, compileAsync finds them in the cache and
 * resolves when the driver has linked them. Works under a frozen loop (a
 * check's): the steps are setTimeout's, not animation frames.
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
