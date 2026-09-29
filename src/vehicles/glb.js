/**
 * A GLB reader for the vehicles we build in Blender (tools/blender/).
 *
 * Not a GLTFLoader. The game has no loaders on purpose — no build step, no
 * npm, nothing fetched from a CDN — and GLTFLoader is 4,700 lines for a
 * format we only ever write one way. Our exports are all the same shape:
 * one JSON chunk, one BIN chunk, a node tree with TRS, triangle primitives
 * with POSITION + NORMAL + indices, and PBR *factor* materials (no images).
 * This reads that, plus the few things the exporter could plausibly add
 * without anyone noticing (TEXCOORD_0, COLOR_0, any accessor component type,
 * interleaved buffer views, a node matrix), and says so out loud about
 * anything it does not read rather than drawing it wrong.
 *
 *   const { scene, stats } = parseGLB(arrayBuffer);
 *   scene                   THREE.Group; node names are kept exactly
 *   stats.triangles         what the GPU will draw, per the index counts
 *
 * Vertex data is a view into the file's own buffer, not a copy, whenever the
 * layout allows it: parsing the 890 KB helicopter is a few milliseconds, and
 * that matters on a Chromebook at load time more than anywhere else.
 *
 * Geometry and materials are shared by every clone of the result
 * (Object3D.clone shares both), so a second helicopter costs draw calls, not
 * memory. Anything that animates a material per instance must clone that
 * material itself — see blender-models.js.
 *
 * No DOM, no fetch: it runs the same in the browser and in node (the tests).
 */

import * as THREE from '../vendor/three.module.js';

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const ARRAYS = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const ITEM_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** glTF attribute name -> three.js attribute name, for the ones we read. */
const ATTRIBUTES = {
  POSITION: 'position',
  NORMAL: 'normal',
  TEXCOORD_0: 'uv',
  COLOR_0: 'color',
};

/** Extensions we either read or can safely ignore, so nothing else passes silently. */
const KNOWN_EXTENSIONS = new Set(['KHR_materials_emissive_strength', 'KHR_materials_specular']);

/**
 * Parse a .glb.
 *
 * @param {ArrayBuffer|ArrayBufferView} data  the whole file
 * @param {{ name?: string, warn?: (msg: string) => void }} [opts]
 * @returns {{ scene: THREE.Group, json: object, stats: object }}
 */
export function parseGLB(data, opts = {}) {
  const warn = opts.warn || ((m) => console.warn(`[glb] ${opts.name || 'model'}: ${m}`));
  const buffer = toAlignedBuffer(data);
  const dv = new DataView(buffer);
  if (buffer.byteLength < 20 || dv.getUint32(0, true) !== MAGIC) throw new Error('not a GLB file (bad magic)');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`GLB version ${version}; only 2 is supported`);
  const length = Math.min(dv.getUint32(8, true), buffer.byteLength);

  let json = null;
  let binOffset = -1;
  let binLength = 0;
  for (let off = 12; off + 8 <= length; ) {
    const chunkLength = dv.getUint32(off, true);
    const chunkType = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (start + chunkLength > length) throw new Error('truncated GLB chunk');
    if (chunkType === CHUNK_JSON && !json) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, chunkLength)));
    } else if (chunkType === CHUNK_BIN && binOffset < 0) {
      binOffset = start;
      binLength = chunkLength;
    }
    off = start + chunkLength;
  }
  if (!json) throw new Error('GLB has no JSON chunk');

  for (const ext of json.extensionsRequired || []) {
    if (!KNOWN_EXTENSIONS.has(ext)) throw new Error(`GLB requires ${ext}, which this reader does not support`);
  }
  for (const ext of json.extensionsUsed || []) {
    if (!KNOWN_EXTENSIONS.has(ext)) warn(`ignoring extension ${ext}`);
  }

  const ctx = { json, buffer, binOffset, binLength, warn, accessors: [], materials: [], vcMaterials: [], meshes: [] };
  const stats = { triangles: 0, meshes: 0, primitives: 0, materials: (json.materials || []).length, nodes: 0 };

  const nodes = (json.nodes || []).map((def, i) => buildNode(ctx, def, i, stats));
  (json.nodes || []).forEach((def, i) => {
    for (const c of def.children || []) nodes[i].add(nodes[c]);
  });

  const sceneDef = (json.scenes || [])[json.scene ?? 0] || { nodes: nodes.map((_, i) => i).filter((i) => !nodes[i].parent) };
  const scene = new THREE.Group();
  scene.name = sceneDef.name || 'Scene';
  for (const i of sceneDef.nodes || []) scene.add(nodes[i]);
  stats.nodes = nodes.length;
  return { scene, json, stats };
}

/* ---------------------------------------------------------------- data -- */

/**
 * The file as an ArrayBuffer whose byte 0 is the file's byte 0.
 *
 * A node Buffer is usually a view into a shared pool at some odd offset, and
 * a Float32Array cannot start on an odd byte, so a view that does not start
 * on a 4-byte boundary is copied once here rather than failing later.
 */
function toAlignedBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) return data.buffer;
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  throw new Error('parseGLB wants an ArrayBuffer or a typed array');
}

/** An accessor as { array, itemSize, normalized }, cached. */
function accessor(ctx, index) {
  if (ctx.accessors[index]) return ctx.accessors[index];
  const def = ctx.json.accessors[index];
  if (!def) throw new Error(`accessor ${index} does not exist`);
  if (def.sparse) throw new Error(`accessor ${index} is sparse, which this reader does not support`);
  const Array_ = ARRAYS[def.componentType];
  const itemSize = ITEM_SIZE[def.type];
  if (!Array_ || !itemSize) throw new Error(`accessor ${index} has type ${def.componentType}/${def.type}`);
  const count = def.count;
  let array;
  if (def.bufferView === undefined) {
    // Allowed by the spec: an accessor with no data is all zeros.
    array = new Array_(count * itemSize);
  } else {
    const view = ctx.json.bufferViews[def.bufferView];
    if ((view.buffer ?? 0) !== 0 || ctx.binOffset < 0) throw new Error('only the GLB BIN chunk is supported as a buffer');
    const elementBytes = Array_.BYTES_PER_ELEMENT;
    const packed = itemSize * elementBytes;
    const stride = view.byteStride || packed;
    const start = ctx.binOffset + (view.byteOffset || 0) + (def.byteOffset || 0);
    const span = stride * (count - 1) + packed;
    if ((view.byteOffset || 0) + (def.byteOffset || 0) + span > ctx.binLength) {
      throw new Error(`accessor ${index} runs past the end of the BIN chunk`);
    }
    if (stride === packed && start % elementBytes === 0) {
      // The common case, and the only one our exporter writes: a view, no copy.
      array = new Array_(ctx.buffer, start, count * itemSize);
    } else {
      // Interleaved or misaligned: copy the elements out one by one.
      array = new Array_(count * itemSize);
      const dv = new DataView(ctx.buffer);
      const read = reader(dv, def.componentType);
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < itemSize; k++) array[i * itemSize + k] = read(start + i * stride + k * elementBytes);
      }
    }
  }
  const out = { array, itemSize, normalized: !!def.normalized, min: def.min, max: def.max };
  ctx.accessors[index] = out;
  return out;
}

function reader(dv, type) {
  switch (type) {
    case 5120: return (o) => dv.getInt8(o);
    case 5121: return (o) => dv.getUint8(o);
    case 5122: return (o) => dv.getInt16(o, true);
    case 5123: return (o) => dv.getUint16(o, true);
    case 5125: return (o) => dv.getUint32(o, true);
    default: return (o) => dv.getFloat32(o, true);
  }
}

/* ----------------------------------------------------------- materials -- */

/**
 * A glTF PBR material as a MeshStandardMaterial.
 *
 * Factors only. Colours in glTF are already linear, which is three.js's
 * working space, so they go in as they are — converting them from sRGB is
 * the classic mistake that makes every model look washed out.
 */
function material(ctx, index) {
  if (index === undefined) {
    // The spec's default material: white, fully metallic, fully rough.
    if (!ctx.defaultMaterial) ctx.defaultMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 1 });
    return ctx.defaultMaterial;
  }
  if (ctx.materials[index]) return ctx.materials[index];
  const def = ctx.json.materials[index];
  const pbr = def.pbrMetallicRoughness || {};
  const base = pbr.baseColorFactor || [1, 1, 1, 1];
  const m = new THREE.MeshStandardMaterial({
    name: def.name || `material_${index}`,
    metalness: pbr.metallicFactor ?? 1,
    roughness: pbr.roughnessFactor ?? 1,
  });
  m.color.setRGB(base[0], base[1], base[2], THREE.LinearSRGBColorSpace);
  m.opacity = base[3] ?? 1;
  if (def.emissiveFactor) m.emissive.setRGB(def.emissiveFactor[0], def.emissiveFactor[1], def.emissiveFactor[2], THREE.LinearSRGBColorSpace);
  const ext = def.extensions || {};
  if (ext.KHR_materials_emissive_strength) m.emissiveIntensity = ext.KHR_materials_emissive_strength.emissiveStrength ?? 1;
  if (def.alphaMode === 'BLEND') {
    m.transparent = true;
    m.depthWrite = false;
  } else if (def.alphaMode === 'MASK') {
    m.alphaTest = def.alphaCutoff ?? 0.5;
  } else {
    m.opacity = 1;
  }
  if (def.doubleSided) m.side = THREE.DoubleSide;
  if (pbr.baseColorTexture || pbr.metallicRoughnessTexture || def.normalTexture || def.emissiveTexture || def.occlusionTexture) {
    ctx.warn(`material ${m.name} has textures; this reader draws its factors only`);
  }
  // What the file said, for anyone animating it later (the base glow of a lamp).
  m.userData.gltf = { emissiveIntensity: m.emissiveIntensity, opacity: m.opacity };
  ctx.materials[index] = m;
  return m;
}

/** The same material with vertex colours switched on, for primitives that carry COLOR_0. */
function vertexColourMaterial(ctx, index) {
  const key = index ?? -1;
  if (!ctx.vcMaterials[key]) {
    const m = material(ctx, index).clone();
    m.vertexColors = true;
    ctx.vcMaterials[key] = m;
  }
  return ctx.vcMaterials[key];
}

/* ---------------------------------------------------------- geometry -- */

function geometry(ctx, prim) {
  const g = new THREE.BufferGeometry();
  for (const [name, target] of Object.entries(ATTRIBUTES)) {
    if (prim.attributes[name] === undefined) continue;
    const a = accessor(ctx, prim.attributes[name]);
    g.setAttribute(target, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
    if (name === 'POSITION' && a.min && a.max) {
      // The exporter wrote the bounds; use them instead of walking every vertex.
      g.boundingBox = new THREE.Box3(new THREE.Vector3().fromArray(a.min), new THREE.Vector3().fromArray(a.max));
      g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    }
  }
  for (const name of Object.keys(prim.attributes)) {
    if (!ATTRIBUTES[name] && !ctx.warnedAttr?.has(name)) {
      (ctx.warnedAttr ||= new Set()).add(name);
      ctx.warn(`ignoring vertex attribute ${name}`);
    }
  }
  if (prim.indices !== undefined) {
    const a = accessor(ctx, prim.indices);
    g.setIndex(new THREE.BufferAttribute(a.array, 1));
  }
  if (!g.attributes.position) throw new Error('a primitive has no POSITION');
  // No computeVertexNormals: the exports carry custom normals (the van's
  // lamp cut-outs depend on them) and recomputing would undo them.
  return g;
}

function triangleCount(g, mode) {
  const n = g.index ? g.index.count : g.attributes.position.count;
  if (mode === 4) return Math.floor(n / 3);
  if (mode === 5 || mode === 6) return Math.max(0, n - 2);
  return 0;
}

/* -------------------------------------------------------------- nodes -- */

function buildMesh(ctx, meshIndex, stats) {
  if (ctx.meshes[meshIndex]) return ctx.meshes[meshIndex];
  const def = ctx.json.meshes[meshIndex];
  const prims = def.primitives.map((p) => {
    const mode = p.mode ?? 4;
    const g = geometry(ctx, p);
    const mat = p.attributes.COLOR_0 !== undefined ? vertexColourMaterial(ctx, p.material) : material(ctx, p.material);
    stats.triangles += triangleCount(g, mode);
    stats.primitives++;
    return { g, mat, mode };
  });
  stats.meshes++;
  ctx.meshes[meshIndex] = prims;
  return prims;
}

function drawable(g, mat, mode, warn) {
  switch (mode) {
    case 4: return new THREE.Mesh(g, mat);
    case 0: return new THREE.Points(g, new THREE.PointsMaterial({ color: mat.color }));
    case 1: return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: mat.color }));
    case 2: return new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: mat.color }));
    case 3: return new THREE.Line(g, new THREE.LineBasicMaterial({ color: mat.color }));
    default:
      warn(`skipping a primitive in draw mode ${mode} (strips and fans are not read)`);
      return null;
  }
}

/**
 * One glTF node as one Group, named as in Blender, carrying its TRS.
 *
 * The primitives hang under it as Meshes rather than the node BEING the mesh,
 * so a part is always the same kind of object whatever it is made of, and
 * turning it (a rotor, a wheel) turns every material on it.
 */
function buildNode(ctx, def, index, stats) {
  const o = new THREE.Group();
  o.name = def.name || `node_${index}`;
  if (def.matrix) {
    new THREE.Matrix4().fromArray(def.matrix).decompose(o.position, o.quaternion, o.scale);
  } else {
    if (def.translation) o.position.fromArray(def.translation);
    if (def.rotation) o.quaternion.fromArray(def.rotation);
    if (def.scale) o.scale.fromArray(def.scale);
  }
  if (def.extras && typeof def.extras === 'object') o.userData.extras = def.extras;
  if (def.mesh !== undefined) {
    const prims = buildMesh(ctx, def.mesh, stats);
    prims.forEach((p) => {
      const m = drawable(p.g, p.mat, p.mode, ctx.warn);
      if (!m) return;
      m.name = prims.length > 1 ? `${o.name}:${p.mat.name}` : o.name;
      o.add(m);
    });
  }
  if (def.skin !== undefined || def.weights) ctx.warn(`node ${o.name} is skinned or morphed; drawn in its rest pose`);
  return o;
}

/**
 * Count what a model will cost to draw: triangles and draw calls.
 * Used by the model viewer and the tests, so both report the same numbers.
 */
export function drawStats(root) {
  let triangles = 0;
  let drawCalls = 0;
  root.traverseVisible((o) => {
    if (!o.isMesh) return;
    drawCalls++;
    const g = o.geometry;
    triangles += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
  });
  return { triangles, drawCalls };
}
