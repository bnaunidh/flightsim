/**
 * Fewer draw calls for the traffic's aeroplanes.
 *
 * The traffic uses the game's own models, and they are built for the one
 * aeroplane you fly: 33 to 63 meshes each, every rivet-row and aerial its own
 * draw. Measured over the apron with three of them in view, they took the
 * frame from 817 draw calls to 994 — on a school Chromebook that is the
 * difference, not the aeroplanes' own arithmetic, which is a tenth of a
 * millisecond.
 *
 * About half of those meshes never move. Which half is not written down
 * anywhere — the model factories animate whatever they animate — so it is
 * measured: the model's own update() is run through the states the traffic
 * puts it in (parked, taxiing, full power, gear and flaps both ways, every
 * control deflected, day and night, a few seconds of each so the strobes
 * blink), and every part whose place, visibility or material changed stays a
 * part of its own. Everything else is baked into one mesh per material under
 * the nearest thing that does move.
 *
 * Then, at a distance, the small parts — wheels, aerials, lamps, the pitot —
 * are hidden. Only parts the model never shows or hides by itself, so the two
 * never fight over the same switch.
 *
 * Pure THREE, no scene: the browser check and the node test can both run it.
 */

/** An object and every ancestor up to (not including) `root` are visible. */
function shown(o, root) {
  for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Controls, gear and the rest, in the shape the model factories read. */
function probeStates() {
  const base = { alt: 100, crashed: false };
  return [
    { ...base, rpm: 0, flaps: 0, gearPos: 1, gearDown: true, onGround: true, groundSpeed: 0, agl: 0, engineOn: false, controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 } },
    { ...base, rpm: 0.35, flaps: 0.3, gearPos: 1, gearDown: true, onGround: true, groundSpeed: 7, agl: 0, engineOn: true, controls: { pitch: 0, roll: 0, yaw: 0.8, throttle: 0.3, brakes: 0 } },
    { ...base, rpm: 1, flaps: 1, gearPos: 0.5, gearDown: true, onGround: false, groundSpeed: 40, agl: 60, engineOn: true, controls: { pitch: 1, roll: 1, yaw: -1, throttle: 1, brakes: 0 } },
    { ...base, rpm: 0.7, flaps: 0, gearPos: 0, gearDown: false, onGround: false, groundSpeed: 60, agl: 400, engineOn: true, controls: { pitch: -1, roll: -1, yaw: 1, throttle: 0.7, brakes: 0 } },
  ];
}

/** What a material looks like right now, in the properties a model animates. */
function lookOf(m) {
  const c = (v) => (v && v.getHexString ? v.getHexString() : '');
  return `${c(m.color)}|${c(m.emissive)}|${m.emissiveIntensity}|${m.opacity}|${m.visible}|${m.map ? m.map.uuid : ''}`;
}

/**
 * What the model's own animation touches, measured by running it.
 *
 *   selfChanged    every object whose OWN local transform, visibility or
 *                  material changed — a propeller's pivot, an aileron, a
 *                  wheel, a lamp that comes on at night
 *   shownBySelf    every mesh that was shown or hidden, by itself or by an
 *                  ancestor
 *   liveMaterials  every material whose colour, glow or opacity changed
 */
export function probeMotion(model, THREE) {
  const selfChanged = new Set();
  const shownBySelf = new Set();
  const liveMaterials = new Set();
  const looks = new Map();
  model.traverse((o) => {
    if (o.isMesh && o.material && !Array.isArray(o.material)) looks.set(o.material, lookOf(o.material));
  });
  const checkLooks = () => {
    for (const [m, look] of looks) if (lookOf(m) !== look) liveMaterials.add(m);
  };
  const update = model.userData && model.userData.update;
  const snap = () => {
    model.updateMatrixWorld(true);
    const out = new Map();
    model.traverse((o) => {
      if (o === model) return;
      out.set(o, { e: o.matrix.elements.slice(), v: o.visible, s: o.isMesh ? shown(o, model) : true, m: o.material });
    });
    return out;
  };
  const base = snap();
  const everything = () => {
    model.traverse((o) => {
      if (o !== model) selfChanged.add(o);
      if (o.isMesh) shownBySelf.add(o);
    });
    return { selfChanged, shownBySelf, liveMaterials };
  };
  if (typeof update !== 'function') return { selfChanged, shownBySelf, liveMaterials };
  const vel = new THREE.Vector3(0, 0, -30);
  for (const st of probeStates()) {
    for (let k = 0; k < 8; k++) {
      const ac = { ...st, pos: model.position, quat: model.quaternion, vel };
      try {
        update(0.37, ac, { isNight: k % 2 === 0, cond: { cloud: 0 } });
      } catch (e) {
        // A model whose update cannot be driven like this is left whole.
        return everything();
      }
      checkLooks();
      for (const [o, now] of snap()) {
        const was = base.get(o);
        if (!was) {
          // Built by its own update: leave it and everything round it alone.
          return everything();
        }
        if (was.s !== now.s) shownBySelf.add(o);
        if (was.v !== now.v || was.m !== now.m) {
          selfChanged.add(o);
          continue;
        }
        for (let i = 0; i < 16; i++) {
          if (Math.abs(was.e[i] - now.e[i]) > 1e-6) {
            selfChanged.add(o);
            break;
          }
        }
      }
    }
  }
  // Put it back as it was built: parked, gear down, lights as by day.
  try {
    update(0.016, { ...probeStates()[0], pos: model.position, quat: model.quaternion, vel: vel.set(0, 0, 0) }, { isNight: false, cond: { cloud: 0 } });
  } catch (e) {
    /* the probe above already worked; this is tidying */
  }
  return { selfChanged, shownBySelf, liveMaterials };
}

/**
 * Two materials that would draw the same thing get the same key.
 *
 * The livery code gives most parts a material of their own — the Meridian's
 * forty-odd meshes had forty-odd materials, most of them the same white — so
 * merging by the material OBJECT saved only 40 of 140 meshes. Anything this
 * does not know how to compare, or that a model's shader hooks customise,
 * keeps its own identity.
 */
function materialKey(m, live, THREE) {
  if (live.has(m)) return `id:${m.uuid}`;
  const P = THREE.Material.prototype;
  if (m.onBeforeCompile !== P.onBeforeCompile || m.customProgramCacheKey !== P.customProgramCacheKey) return `id:${m.uuid}`;
  if (!/^Mesh(Standard|Physical|Basic|Lambert|Phong)Material$/.test(m.type)) return `id:${m.uuid}`;
  const hex = (v) => (v && v.getHexString ? v.getHexString() : '-');
  const tex = (t) => (t ? t.uuid : '-');
  return [
    m.type, hex(m.color), hex(m.emissive), m.emissiveIntensity, m.roughness, m.metalness, m.opacity, m.transparent,
    m.side, m.flatShading, m.vertexColors, m.alphaTest, m.depthWrite, m.depthTest, m.fog, m.toneMapped, m.wireframe,
    m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, m.envMapIntensity, m.clearcoat, m.clearcoatRoughness,
    m.transmission, m.ior, m.sheen, m.reflectivity, m.shininess, hex(m.specular),
    tex(m.map), tex(m.normalMap), tex(m.roughnessMap), tex(m.metalnessMap), tex(m.emissiveMap), tex(m.alphaMap),
    tex(m.aoMap), tex(m.bumpMap), tex(m.envMap), tex(m.lightMap),
    m.normalScale ? `${m.normalScale.x},${m.normalScale.y}` : '-',
    // Every standard material has { STANDARD: '' }; anything else is compared too.
    m.defines ? JSON.stringify(m.defines) : '-',
  ].join('|');
}

/**
 * Attribute layout of a geometry as a string, or null if it cannot be merged.
 * Groups are ignored: a mesh with one material is drawn whole whatever groups
 * its geometry carries (every BoxGeometry has six), and only meshes with one
 * material are merged.
 */
function layoutOf(g) {
  if (!g || !g.attributes || !g.attributes.position) return null;
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return null;
  const parts = [];
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.attributes[name];
    if (a.isInterleavedBufferAttribute || !a.array) return null;
    parts.push(`${name}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.array.constructor.name}`);
  }
  return parts.join('|');
}

/**
 * Bake parts together. Every mesh that does not move by itself is baked into
 * its nearest ancestor that does — the model itself for the fuselage, the
 * wings and the tail; the propeller's pivot for the hub and the blades; a gear
 * leg's pivot for the leg, the wheel fork and the brake — one mesh per
 * material (and per shadow flags and attribute layout) under each. So the
 * propeller still turns and the gear still folds, in fewer draws. Returns how
 * many meshes went in and how many came out. The originals are detached, not
 * disposed: a model factory may share a geometry between aeroplanes, and it
 * was never uploaded.
 */
export function mergeStatic(model, THREE, probe) {
  const selfChanged = (probe && probe.selfChanged) || new Set();
  const liveMaterials = (probe && probe.liveMaterials) || new Set();
  model.updateMatrixWorld(true);
  const buckets = new Map();
  model.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || selfChanged.has(o)) return;
    if (o.children.length || !o.visible) return;
    const mat = o.material;
    /*
     * Glass merges too (the Skylark's eight panes are one material): what is
     * lost is the sort between panes, so the far window is not seen through
     * the near one — on an aeroplane that is somebody else's, at a distance.
     */
    if (!mat || Array.isArray(mat)) return;
    if (o.onBeforeRender && o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
    const lay = layoutOf(o.geometry);
    if (!lay) return;
    const dr = o.geometry.drawRange;
    if (dr && (dr.start !== 0 || dr.count !== Infinity)) return;
    // Up to the first ancestor that moves or shows and hides by itself; every
    // object on the way must be still, and shown.
    let anchor = o.parent;
    while (anchor && anchor !== model && !selfChanged.has(anchor)) {
      if (!anchor.visible) return;
      anchor = anchor.parent;
    }
    if (!anchor) return;
    const key = `${anchor.uuid}|${materialKey(mat, liveMaterials, THREE)}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.renderOrder}|${lay}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { anchor, list: [] }));
    b.list.push(o);
  });
  let before = 0;
  let after = 0;
  const m4 = new THREE.Matrix4();
  const inv = new THREE.Matrix4();
  for (const { anchor, list } of buckets.values()) {
    if (list.length < 2) continue;
    inv.copy(anchor.matrixWorld).invert();
    const first = list[0].geometry;
    const names = Object.keys(first.attributes);
    let vCount = 0;
    let iCount = 0;
    for (const o of list) {
      const g = o.geometry;
      vCount += g.attributes.position.count;
      iCount += g.index ? g.index.count : g.attributes.position.count;
    }
    const arrays = {};
    for (const name of names) {
      const a = first.attributes[name];
      arrays[name] = new a.array.constructor(vCount * a.itemSize);
    }
    const index = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
    let vOff = 0;
    let iOff = 0;
    for (const o of list) {
      m4.multiplyMatrices(inv, o.matrixWorld);
      const g = o.geometry.clone();
      g.applyMatrix4(m4);
      for (const name of names) {
        const a = g.attributes[name];
        arrays[name].set(a.array.subarray(0, a.count * a.itemSize), vOff * a.itemSize);
      }
      // A part mirrored with a negative scale is drawn inside out once the
      // mirror is baked in, unless its triangles are turned round too.
      const flip = m4.determinant() < 0;
      const n = g.index ? g.index.count : g.attributes.position.count;
      for (let i = 0; i < n; i += 3) {
        const a = g.index ? g.index.getX(i) : i;
        const b = g.index ? g.index.getX(i + 1) : i + 1;
        const c = g.index ? g.index.getX(i + 2) : i + 2;
        index[iOff + i] = vOff + a;
        index[iOff + i + 1] = vOff + (flip ? c : b);
        index[iOff + i + 2] = vOff + (flip ? b : c);
      }
      vOff += g.attributes.position.count;
      iOff += n;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    for (const name of names) {
      const a = first.attributes[name];
      merged.setAttribute(name, new THREE.BufferAttribute(arrays[name], a.itemSize, a.normalized));
    }
    merged.setIndex(new THREE.BufferAttribute(index, 1));
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.name = 'traffic-merged';
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    mesh.renderOrder = list[0].renderOrder;
    mesh.userData.merged = list.length;
    anchor.add(mesh);
    for (const o of list) if (o.parent) o.parent.remove(o);
    before += list.length;
    after += 1;
  }
  return { before, after };
}

/**
 * The parts small enough to leave out at a distance, with their size: every
 * mesh under `size` metres that the model never shows or hides by itself —
 * those are the traffic's to switch off. Sorted smallest first.
 */
export function smallParts(model, THREE, shownBySelf, size = 3) {
  model.updateMatrixWorld(true);
  const out = [];
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isMesh || shownBySelf.has(o) || !o.visible) return;
    box.setFromObject(o).getSize(v);
    const s = Math.max(v.x, v.y, v.z);
    if (s < size) out.push({ o, size: s });
  });
  return out.sort((a, b) => a.size - b.size);
}

/**
 * Show only the parts at least `minSize` metres across. `parts` is from
 * smallParts(); returns nothing, allocates nothing.
 */
export function showParts(parts, minSize) {
  for (let i = 0; i < parts.length; i++) parts[i].o.visible = parts[i].size >= minSize;
}
