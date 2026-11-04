/**
 * The live map's chart tiles, off the main thread (a module worker).
 *
 * Its own terrain.js, loaded with the same map definition the game applied
 * (plain data in the message, as the World Map preview's tile worker does),
 * so sampling a quarter of a million heights for a sharp chart costs the
 * frame loop nothing: a finished tile comes back as one transferable RGBA
 * buffer, and the main thread only puts it on a canvas.
 *
 *   { op: 'init', seq, def, style }          load the map, the chart's colours
 *   { op: 'tile', seq, key, x0, z0, step, n } → { op: 'tile', seq, key, rgba }
 *   { op: 'height', key, x, z }              → { op: 'height', key, h } (the pin's map: land or sea)
 */
import { shadeTile } from './shade.js';
import { iceShapes } from '../../ui/chart-palette.js';

let T = null;
let STYLE = null;
let ICE = [];
let SEQ = -1;
let OUTER = null;
let ready = import('../../world/terrain.js').then((m) => {
  T = m;
});

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    // The World Map's ring (worldmap/farlands.js): here before anything after this message is answered.
    if (msg.op === 'init' && msg.def.farlands && !OUTER) {
      ready = ready.then(() => import('../../world/worldmap/farlands.js')).then((m) => {
        OUTER = m.FARLANDS;
      });
    }
    await ready;
    if (msg.op === 'init') {
      if (msg.def.farlands) msg.def._outer = OUTER;
      T.applyMap(msg.def);
      if (T.clearPlatforms) T.clearPlatforms();
      STYLE = msg.style;
      ICE = iceShapes(T.FLATS);
      SEQ = msg.seq;
      self.postMessage({ op: 'init', seq: msg.seq, ok: true });
      return;
    }
    if (msg.op === 'height') {
      self.postMessage({ op: 'height', key: msg.key, h: T.heightAt(msg.x, msg.z) });
      return;
    }
    if (msg.op === 'tile') {
      // A tile for a map that has been replaced since it was asked for: skip it.
      if (msg.seq !== SEQ || !STYLE) {
        self.postMessage({ op: 'tile', seq: msg.seq, key: msg.key, stale: true });
        return;
      }
      const rgba = shadeTile(T.heightAt, msg.x0, msg.z0, msg.step, msg.n, STYLE, { ice: ICE });
      self.postMessage({ op: 'tile', seq: msg.seq, key: msg.key, rgba }, [rgba.buffer]);
    }
  } catch (err) {
    self.postMessage({ op: msg.op, seq: msg.seq, key: msg.key, error: String((err && err.message) || err) });
  }
};
