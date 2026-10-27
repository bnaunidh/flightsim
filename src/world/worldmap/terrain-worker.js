/**
 * World Map preview: the tile worker (a module worker).
 *
 * Its own instance of terrain.js — a worker is its own realm, so the MAP,
 * FLATS and PLATFORMS here never touch the game's physics — loaded with the
 * same map definition the game applied (plain data, sent in the message).
 * Each request is one tile: sampled and assembled by worldmap/tiles.js, the
 * same code the main thread runs when there is no worker, and handed back
 * as transferable arrays, so a tile costs the frame loop one upload and no
 * height sampling at all.
 *
 *   { op: 'init', gen, def }                       load the map
 *   { op: 'tile', gen, key, cx, cz, size, seg }    → { key, gen, data | null }
 *   { op: 'chart', box, w, h }                     → { heights } for the world map's picture
 *   { op: 'flora', gen, key, ix, iz, perCell }     → { trees } a cell's trees (worldmap/flora.js)
 *
 * `gen` is the world build the request belongs to; the stream throws away an
 * answer for a world that has been rebuilt since.
 */
import { buildTileData } from './tiles.js';
import { placeCell } from './flora.js';

let FLORA_CTX = null;

let T = null;
const ready = import('../terrain.js').then((m) => {
  T = m;
});

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    await ready;
    if (msg.op === 'init') {
      T.applyMap(msg.def);
      FLORA_CTX = msg.flora || null;
      if (T.clearPlatforms) T.clearPlatforms();
      self.postMessage({ op: 'init', gen: msg.gen, ok: true });
      return;
    }
    if (msg.op === 'chart') {
      const { box, w, h } = msg;
      const heights = new Float32Array(w * h);
      for (let j = 0; j < h; j++) {
        const z = box.z0 + ((j + 0.5) * (box.z1 - box.z0)) / h;
        for (let i = 0; i < w; i++) heights[j * w + i] = T.heightAt(box.x0 + ((i + 0.5) * (box.x1 - box.x0)) / w, z);
      }
      self.postMessage({ op: 'chart', gen: msg.gen, w, h, heights }, [heights.buffer]);
      return;
    }
    if (msg.op === 'flora') {
      const trees = FLORA_CTX ? placeCell(T, FLORA_CTX, msg.ix, msg.iz, msg.perCell) : null;
      self.postMessage({ op: 'flora', gen: msg.gen, key: msg.key, ix: msg.ix, iz: msg.iz, trees }, trees ? [trees.buffer] : []);
      return;
    }
    if (msg.op === 'tile') {
      const t0 = performance.now();
      const data = buildTileData(T, msg.cx, msg.cz, msg.size, msg.seg);
      const ms = performance.now() - t0;
      const transfer = data ? [data.pos.buffer, data.nrm.buffer, data.blend.buffer, data.uv.buffer] : [];
      self.postMessage({ op: 'tile', gen: msg.gen, key: msg.key, data, ms }, transfer);
    }
  } catch (err) {
    self.postMessage({ op: msg.op, gen: msg.gen, key: msg.key, error: String((err && err.message) || err) });
  }
};
