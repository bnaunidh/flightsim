/**
 * A PACKED real-model file (tools/real-models/detail.py): meshopt-compressed,
 * positions quantized, detail maps in KTX2. Loaded by real-models.js only for
 * such a file, so none of it is in the first load.
 *
 *   parsePacked(buf, name, renderer, tier) -> parseGLB's result, positions
 *     back to plain floats, and `.detail` true when maps were decoded
 *   withDetail(material, geometry) -> the material with that geometry's maps
 *     laid under it, or the material itself
 */
import * as THREE from '../vendor/three.module.js';
import { parseGLB } from '../vehicles/glb.js';

let meshopt = null;
let detailApi = null;

export async function parsePacked(buf, name, renderer, tier) {
  if (!meshopt) {
    meshopt = import('../vendor/addons/meshopt_decoder.module.js').then(async (m) => {
      await m.MeshoptDecoder.ready;
      return m.MeshoptDecoder;
    });
  }
  const glb = unpack(buf, await meshopt);
  const parsed = parseGLB(glb.buffer, { name, warn: () => {} });
  flattenQuantized(parsed.scene);
  // What maps each material points at, and each image's bytes, for real-detail.js.
  const J = parsed.json;
  const byName = new Map((J.materials || []).map((m, i) => [m.name || `material_${i}`, m]));
  const ref = (t, extra) => {
    if (!t) return null;
    const tx = J.textures[t.index] || {};
    const src = ((tx.extensions || {}).KHR_texture_basisu || tx).source;
    return { image: src, texCoord: t.texCoord || 0, sampler: (J.samplers || [])[tx.sampler] || {}, ...extra };
  };
  parsed.scene.traverse((o) => {
    const def = o.isMesh && byName.get(o.material.name);
    if (!def || o.material.userData.gltfMaps) return;
    const maps = {};
    const pbr = def.pbrMetallicRoughness || {};
    if (def.normalTexture) maps.normal = ref(def.normalTexture, { scale: def.normalTexture.scale ?? 1 });
    if (def.occlusionTexture) maps.occlusion = ref(def.occlusionTexture, { strength: def.occlusionTexture.strength ?? 1 });
    if (pbr.metallicRoughnessTexture) maps.mr = ref(pbr.metallicRoughnessTexture);
    if (Object.keys(maps).length) o.material.userData.gltfMaps = maps;
  });
  parsed.image = (i) => {
    const im = (J.images || [])[i];
    if (!im || im.bufferView === undefined) return null;
    const v = J.bufferViews[im.bufferView];
    return { bytes: new Uint8Array(glb.buffer, glb.bin + (v.byteOffset || 0), v.byteLength), mime: im.mimeType || '' };
  };
  parsed.detail = false;
  let any = false;
  parsed.scene.traverse((o) => {
    if (o.isMesh && o.material.userData.gltfMaps) any = true;
  });
  // Not on Low (it looks as it always did there), not without workers (the tests, in node), not with ?realdetail=off.
  const off = typeof location !== 'undefined' && /[?&]realdetail=off\b/.test(location.search);
  if (any && tier !== 'low' && renderer && typeof Worker !== 'undefined' && !off) {
    try {
      detailApi = detailApi || (await import('./real-detail.js'));
      detailApi.setDetailRenderer(renderer);
      const done = await Promise.race([detailApi.decodeDetail(parsed.scene, parsed).then(() => true), new Promise((r) => setTimeout(() => r(false), 10000))]);
      parsed.detail = done;
      // A helicopter's file (tools/real-models/helis.py) is worn in its own vertex-painted
      // materials (real-models.js dressHeli), not repainted: its maps go under them here, once.
      if (done) {
        parsed.scene.traverse((o) => {
          if (o.isMesh && o.material && o.material.vertexColors) o.material = withDetail(o.material, o.geometry);
        });
      }
    } catch (e) {
      console.warn(`${name}: detail maps off`, e);
    }
  }
  return parsed;
}

/**
 * The file with every meshopt-compressed buffer view decoded, as a plain GLB
 * the game's reader takes (vehicles/glb.js knows nothing of meshopt).
 * -> { buffer, bin }: the new file and where its BIN data starts.
 */
function unpack(buf, decoder) {
  const u8 = new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let json = null;
  let bin = null;
  for (let off = 12; off + 8 <= u8.byteLength; ) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(u8.subarray(off + 8, off + 8 + len)));
    else if (type === 0x004e4942) bin = u8.subarray(off + 8, off + 8 + len);
    off += 8 + len;
  }
  const parts = [];
  let size = 0;
  for (const v of json.bufferViews) {
    const x = (v.extensions || {}).EXT_meshopt_compression;
    let bytes;
    if (x) {
      bytes = new Uint8Array(x.count * x.byteStride);
      decoder.decodeGltfBuffer(bytes, x.count, x.byteStride, bin.subarray(x.byteOffset || 0, (x.byteOffset || 0) + x.byteLength), x.mode, x.filter || 'NONE');
      if (x.byteStride && x.mode === 'ATTRIBUTES') v.byteStride = x.byteStride;
      else delete v.byteStride;
      delete v.extensions;
    } else {
      bytes = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    }
    size = (size + 3) & ~3;
    v.buffer = 0;
    v.byteOffset = size;
    v.byteLength = bytes.byteLength;
    parts.push([size, bytes]);
    size += bytes.byteLength;
  }
  size = (size + 3) & ~3;
  json.buffers = [{ byteLength: size }];
  const drop = (l) => (l || []).filter((e) => e !== 'EXT_meshopt_compression');
  json.extensionsUsed = drop(json.extensionsUsed);
  json.extensionsRequired = drop(json.extensionsRequired);
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jsLen = (js.byteLength + 3) & ~3;
  const out = new Uint8Array(12 + 8 + jsLen + 8 + size);
  const o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true);
  o.setUint32(4, 2, true);
  o.setUint32(8, out.byteLength, true);
  o.setUint32(12, jsLen, true);
  o.setUint32(16, 0x4e4f534a, true);
  out.set(js, 20);
  out.fill(0x20, 20 + js.byteLength, 20 + jsLen);
  const b0 = 20 + jsLen;
  o.setUint32(b0, size, true);
  o.setUint32(b0 + 4, 0x004e4942, true);
  for (const [at, bytes] of parts) out.set(bytes, b0 + 8 + at);
  return { buffer: out.buffer, bin: b0 + 8 };
}

export function withDetail(mat, geometry) {
  const d = detailApi && (detailApi.detailFor(geometry) || (geometry.detailFrom && detailApi.detailFor(geometry.detailFrom)));
  return d ? detailApi.withDetail(mat, d) : mat;
}

/**
 * KHR_mesh_quantization stores positions as integers, with the scale and
 * offset that undo it on the nodes. The paint (fleet/extra/real-paint.js),
 * the fit and the tests read positions straight off the geometry, so they are
 * put back: plain floats, every node at identity -- the same numbers a file
 * without the packing would give.
 */
export function flattenQuantized(scene) {
  scene.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const ident = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const meshes = [];
  scene.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });
  for (const o of meshes) {
    rel.multiplyMatrices(inv, o.matrixWorld);
    const g = o.geometry;
    const pos = g.attributes.position;
    if (rel.equals(ident) && pos.array instanceof Float32Array) continue;
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(rel);
      out[i * 3] = v.x;
      out[i * 3 + 1] = v.y;
      out[i * 3 + 2] = v.z;
    }
    g.setAttribute('position', new THREE.BufferAttribute(out, 3));
    const e = rel.elements;
    const sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    const sz = Math.hypot(e[8], e[9], e[10]);
    const nrm = g.attributes.normal;
    if (nrm && (Math.abs(sx - sy) > 1e-6 * sx || Math.abs(sx - sz) > 1e-6 * sx)) {
      const nm = new THREE.Matrix3().getNormalMatrix(rel);
      const n = new Float32Array(nrm.count * 3);
      for (let i = 0; i < nrm.count; i++) {
        v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
        n.set([v.x, v.y, v.z], i * 3);
      }
      g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  // Every node back to identity: the positions now carry what the nodes did (process.py writes none of its own).
  scene.traverse((o) => {
    if (o === scene) return;
    o.position.set(0, 0, 0);
    o.quaternion.identity();
    o.scale.set(1, 1, 1);
  });
  scene.updateMatrixWorld(true);
}
