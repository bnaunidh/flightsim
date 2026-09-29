"""
Bake kestrel_launch.glb into kestrel_launch.js: an ES module the game can
import with no loader (MODEL-BRIEF: no downloaded assets, no loaders).

    python3 bake_module.py [kestrel_launch.glb] [kestrel_launch.js]

build.py runs it after every export. The module holds the geometry as one
base64 blob (positions quantised to 16 bits per primitive, 16-bit indices,
normals to 8 bits - or none at all where three.js's computeVertexNormals
gives the same answer, with a short list of per-vertex overrides where it
does not) and exports createKestrelLaunch(opts), which returns a THREE.Group
whose userData.update(dt, state) drives the outboards, props, radar and
lights, poses the hull on the game's flat sea with a keep-dry clamp, and
draws her bow wave, the wash astern and the turn spray (ported from
maritime.js createWaterEffects, which the old boat had and this one must too).

Drop-in: copy kestrel_launch.js to src/fleet/ and, in src/vehicles/models.js,
import { createKestrelLaunch } from '../fleet/kestrel_launch.js' and use it as
packBoat. createBoat() sets userData.fromPack, so main.js calls update() every
frame; update() takes back main.js's 0.42 m pack lowering itself.
"""
import base64, json, math, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
NORMAL_TOL = math.cos(math.radians(3.0))     # computed normal within 3 degrees: do not ship it


def _vertex_normals(P, I):
    """three.js BufferGeometry.computeVertexNormals on an indexed primitive."""
    acc = [[0.0, 0.0, 0.0] for _ in P]
    for t in range(0, len(I), 3):
        a, b, c = I[t], I[t + 1], I[t + 2]
        pa, pb, pc = P[a], P[b], P[c]
        cb = (pc[0] - pb[0], pc[1] - pb[1], pc[2] - pb[2])
        ab = (pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])
        n = (cb[1] * ab[2] - cb[2] * ab[1], cb[2] * ab[0] - cb[0] * ab[2], cb[0] * ab[1] - cb[1] * ab[0])
        for v in (a, b, c):
            acc[v][0] += n[0]; acc[v][1] += n[1]; acc[v][2] += n[2]
    out = []
    for q in acc:
        l = math.sqrt(q[0] ** 2 + q[1] ** 2 + q[2] ** 2) or 1.0
        out.append((q[0] / l, q[1] / l, q[2] / l))
    return out


def bake(glb_path, js_path):
    raw = open(glb_path, 'rb').read()
    magic, ver, total = struct.unpack_from('<III', raw, 0)
    assert magic == 0x46546C67, 'not a GLB'
    jlen, jtype = struct.unpack_from('<II', raw, 12)
    js = json.loads(raw[20:20 + jlen])
    boff = 20 + jlen
    blen, btype = struct.unpack_from('<II', raw, boff)
    bin_ = raw[boff + 8:boff + 8 + blen]

    CT = {5126: ('f', 4), 5125: ('I', 4), 5123: ('H', 2), 5121: ('B', 1)}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

    def accessor(i):
        a = js['accessors'][i]
        bv = js['bufferViews'][a['bufferView']]
        fmt, size = CT[a['componentType']]
        n = NC[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', size * n)
        out = []
        for k in range(a['count']):
            out.append(struct.unpack_from('<%d%s' % (n, fmt), bin_, off + k * stride))
        return out

    blob = bytearray()

    def align(k):
        while len(blob) % k:
            blob.append(0)

    def q8(q):
        l = math.sqrt(q[0] ** 2 + q[1] ** 2 + q[2] ** 2) or 1.0
        return [max(-127, min(127, int(round(c / l * 127)))) for c in q]

    nodes = []
    total_tris = 0
    stats = {'full': 0, 'computed': 0, 'overrides': 0, 'verts': 0}
    for ni, n in enumerate(js['nodes']):
        node = {'name': n.get('name', ''), 't': n.get('translation', [0, 0, 0]),
                'r': n.get('rotation', [0, 0, 0, 1]), 'children': n.get('children', []), 'prims': []}
        if 'scale' in n:
            node['s'] = n['scale']
        if 'mesh' in n:
            for pr in js['meshes'][n['mesh']]['primitives']:
                P = accessor(pr['attributes']['POSITION'])
                N = accessor(pr['attributes']['NORMAL'])
                I = [i[0] for i in accessor(pr['indices'])]
                lo = [min(p[k] for p in P) for k in range(3)]
                hi = [max(p[k] for p in P) for k in range(3)]
                sc = [max(hi[k] - lo[k], 1e-6) / 65535.0 for k in range(3)]
                align(4)
                p_off = len(blob)
                PQ = []
                for p in P:
                    qv = [int(round((p[k] - lo[k]) / sc[k])) for k in range(3)]
                    blob += struct.pack('<3H', *qv)
                    PQ.append([qv[k] * sc[k] + lo[k] for k in range(3)])
                # normals: which ones would three.js get right on its own?
                CN = _vertex_normals(PQ, I)
                bad = []
                for vi, (a, b) in enumerate(zip(N, CN)):
                    la = math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2) or 1.0
                    if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / la < NORMAL_TOL:
                        bad.append(vi)
                prim = {'m': pr.get('material', 0), 'vc': len(P), 'p': p_off}
                stats['verts'] += len(P)
                if len(bad) > 0.45 * len(P):
                    align(4)
                    prim['n'] = len(blob)
                    for q in N:
                        blob += struct.pack('<3b', *q8(q))
                    stats['full'] += len(P)
                else:
                    stats['computed'] += len(P)
                    if bad:
                        big_o = len(P) > 65535
                        align(4)
                        prim['oi'] = len(blob)
                        blob += struct.pack('<%d%s' % (len(bad), 'I' if big_o else 'H'), *bad)
                        align(4)
                        prim['on'] = len(blob)
                        for vi in bad:
                            blob += struct.pack('<3b', *q8(N[vi]))
                        prim['oc'] = len(bad)
                        prim['ob'] = big_o
                        stats['overrides'] += len(bad)
                align(4)
                big = len(P) > 65535
                prim['i'] = len(blob)
                blob += struct.pack('<%d%s' % (len(I), 'I' if big else 'H'), *I)
                prim.update({'ic': len(I), 'big': big, 'q': [round(v, 7) for v in sc] + [round(v, 6) for v in lo]})
                node['prims'].append(prim)
                total_tris += len(I) // 3
        nodes.append(node)
    mats = []
    for m in js['materials']:
        p = m.get('pbrMetallicRoughness', {})
        b = p.get('baseColorFactor', [1, 1, 1, 1])
        o = {'name': m.get('name', ''), 'color': [round(c, 5) for c in b[:3]],
             'roughness': round(p.get('roughnessFactor', 1.0), 3), 'metalness': round(p.get('metallicFactor', 1.0), 3)}
        if 'emissiveFactor' in m:
            o['emissive'] = [round(c, 5) for c in m['emissiveFactor']]
            o['emissiveIntensity'] = round(m.get('extensions', {}).get('KHR_materials_emissive_strength', {})
                                           .get('emissiveStrength', 1.0), 3)
        if m.get('alphaMode') == 'BLEND':
            o['opacity'] = round(b[3], 3)
        if m.get('doubleSided'):
            o['doubleSided'] = True
        mats.append(o)
    roots = js['scenes'][js.get('scene', 0)]['nodes']
    root_extras = {}
    for r in roots:
        if js['nodes'][r].get('extras'):
            root_extras = js['nodes'][r]['extras']
    fit = root_extras.get('fit', {})
    if isinstance(fit, str):
        fit = {}
    keep = ('sea_motion_scale', 'planing_lift_m', 'top_speed_mps', 'lean_scale', 'trim_scale', 'lift_full_at',
            'keep_dry_y', 'keep_dry_points', 'hull_sections', 'lift_from', 'hull_section_points', 'transom_waterline_game_z',
            'bow_game_z', 'swell_plane_y')
    FIT = {k: fit[k] for k in keep if k in fit}
    for k in ('keep_dry_points', 'hull_sections'):
        assert k in FIT, 'root extras.fit.%s missing' % k
    meta = {'nodes': nodes, 'materials': mats, 'roots': roots, 'tris': total_tris}
    b64 = base64.b64encode(bytes(blob)).decode('ascii')
    src = TEMPLATE.replace('__META__', json.dumps(meta, separators=(',', ':')))
    src = src.replace('__FIT__', json.dumps(FIT, separators=(',', ':')))
    src = src.replace('__DATA__', b64)
    src = src.replace('__TRIS__', str(total_tris))
    open(js_path, 'w').write(src)
    print('BAKED', js_path, '%d bytes, %d triangles, %d nodes, %d materials, blob %d bytes' %
          (len(src), total_tris, len(nodes), len(mats), len(blob)))
    print('NORMALS shipped for %d of %d vertices, computed at load for %d (%d per-vertex overrides)' %
          (stats['full'], stats['verts'], stats['computed'], stats['overrides']))


TEMPLATE = r"""/**
 * The Kestrel Launch: a fast rescue boat, 8.5 m, twin outboards.
 *
 * GENERATED by bake_module.py from kestrel_launch.glb (built by build.py in
 * Blender from an empty scene). Do not edit by hand: rebuild instead.
 * __TRIS__ triangles, no textures, no loader, no network.
 *
 * Axes: -Z forward, +Y up, +X starboard. Origin on the design waterline at
 * the centre of flotation. Hull draws 0.52 m; the skegs 0.70 m at rest.
 *
 *   import { createKestrelLaunch } from '../fleet/kestrel_launch.js';
 *   const boat = createKestrelLaunch();          // THREE.Group 'kestrel_launch'
 *   boat.userData.update(dt, { speed, steer, lights, waterLevel });
 *
 * Moving parts (boat.userData.parts): outboard_l/r steer about Y
 * (+steer * 0.42, finishBoat's sign), prop_l/r spin about Z (prop_r right-
 * hand, prop_l left-hand), radar spins about Y, light_blue flashes.
 *
 * update() also poses the hull on the game's flat sea, after main.js has
 * copied v.pos and v.quat onto it: she rides 0.4 of the sea's heave, pitch
 * and roll (the camera still rides all of it), trims 0.75 of the game's
 * 0.14 rad bow-up at speed, heels 0.55 of its 0.42 rad turn lean (about 13
 * degrees, what a deep-V really heels), and climbs 0.45 m onto the plane
 * between 2.8 and 9.8 m/s. A keep-dry clamp then lifts her by whatever keeps
 * every cockpit sole corner and the motor-well lip 0.10 m above the sea (the
 * swell layer is at +0.08): build.py's fit gate asserts that a full-lock turn
 * at any speed at sea 0.137 and 0.39 needs at most 0.30 m of it, with the hull
 * still in the water, and that straight running at sea up to 0.22 needs none.
 *
 * And she makes water: a bow wave at the entry that follows the real contact
 * point as she climbs onto the plane, a 52-sprite wash astern of the props
 * pinned to the sea (it does not ride the hull's heave) and spray off the
 * outside chine in a hard turn - ported from maritime.js createWaterEffects.
 */
import * as THREE from '../vendor/three.module.js';

const META = __META__;
const FIT = __FIT__;
const DATA = '__DATA__';
const PACK_LOWERING = 0.42;
const LENGTH = 8.47, BEAM = 2.8;
const MAX_FX = 52;

let bytes = null;
function blob() {
  if (!bytes) {
    const s = atob(DATA);
    bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  }
  return bytes.buffer;
}

function geometry(p) {
  const buf = blob();
  const q = new Uint16Array(buf, p.p, p.vc * 3);
  const pos = new Float32Array(p.vc * 3);
  for (let i = 0; i < p.vc; i++) {
    for (let k = 0; k < 3; k++) pos[i * 3 + k] = q[i * 3 + k] * p.q[k] + p.q[3 + k];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const idx = p.big ? new Uint32Array(buf.slice(p.i, p.i + p.ic * 4)) : new Uint16Array(buf.slice(p.i, p.i + p.ic * 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  if (p.n !== undefined) {
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf.slice(p.n, p.n + p.vc * 3)), 3, true));
  } else {
    // smooth parts: three.js computes the same normals; ship only the exceptions
    g.computeVertexNormals();
    if (p.oc) {
      const at = g.attributes.normal;
      const ix = p.ob ? new Uint32Array(buf, p.oi, p.oc) : new Uint16Array(buf, p.oi, p.oc);
      const nn = new Int8Array(buf, p.on, p.oc * 3);
      const v = new THREE.Vector3();
      for (let k = 0; k < p.oc; k++) {
        v.set(nn[k * 3], nn[k * 3 + 1], nn[k * 3 + 2]).normalize();
        at.setXYZ(ix[k], v.x, v.y, v.z);
      }
    }
  }
  g.computeBoundingSphere();
  return g;
}

function material(m) {
  const o = {
    name: m.name,
    color: new THREE.Color().setRGB(m.color[0], m.color[1], m.color[2]),
    roughness: m.roughness,
    metalness: m.metalness,
  };
  if (m.emissive) {
    o.emissive = new THREE.Color().setRGB(m.emissive[0], m.emissive[1], m.emissive[2]);
    o.emissiveIntensity = m.emissiveIntensity;
  }
  if (m.opacity !== undefined) Object.assign(o, { transparent: true, opacity: m.opacity, depthWrite: false });
  if (m.doubleSided) o.side = THREE.DoubleSide;
  // Every decal and non-skid panel sits 5-6 mm proud of these three: step the
  // bases back so nothing z-fights, even from the helicopter (no log depth).
  if (m.name === 'paint_orange' || m.name === 'roof_nonskid' || m.name === 'paint_white') {
    Object.assign(o, { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  }
  return new THREE.MeshStandardMaterial(o);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------ water ---- */

/** The 64 x 64 radial foam sprite (maritime.js paints the same on a canvas). */
function foamTexture(dense = 1) {
  const S = 64, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const t = clamp((Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) - 2) / 28, 0, 1);
    const a = t < 0.65 ? 0.55 - 0.21 * (t / 0.65) : 0.34 * (1 - (t - 0.65) / 0.35);
    const i = (y * S + x) * 4;
    d[i] = 230; d[i + 1] = 239; d[i + 2] = 234; d[i + 3] = Math.round(Math.min(1, a * dense) * 255);
  }
  let seed = 740;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 100; k++) {
    const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
    for (let dx = 0; dx < 2; dx++) {
      const i = (y * S + Math.min(S - 1, x + dx)) * 4;
      d[i] = Math.round(d[i] * 0.6 + 250 * 0.4); d[i + 1] = Math.round(d[i + 1] * 0.6 + 252 * 0.4);
      d[i + 2] = Math.round(d[i + 2] * 0.6 + 245 * 0.4); d[i + 3] = Math.round(d[i + 3] * 0.6 + 255 * 0.4);
    }
  }
  const tex = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function createWater(g) {
  const tex = foamTexture();
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const opac = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FX), 1);
  geo.setAttribute('particleOpacity', opac);
  const mat = new THREE.MeshStandardMaterial({ name: 'fx_foam', map: tex, color: 0xe0eee7, transparent: true, opacity: 0.7,
    depthWrite: false, side: THREE.DoubleSide, roughness: 1 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float particleOpacity; varying float vParticleOpacity;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvParticleOpacity = particleOpacity;');
    sh.fragmentShader = 'varying float vParticleOpacity;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vParticleOpacity;');
  };
  mat.customProgramCacheKey = () => 'kestrel-particle-opacity-v1';
  const wash = new THREE.InstancedMesh(geo, mat, MAX_FX);
  wash.name = 'fx_wash';
  wash.count = 0; wash.frustumCulled = false; wash.renderOrder = 1;
  g.add(wash);
  // the bow wave is a denser white than the wash: it has to read against a bright, streaky sea
  const bowMat = new THREE.MeshStandardMaterial({ name: 'fx_bow_wave', map: foamTexture(1.8), color: 0xffffff, transparent: true,
    opacity: 0, depthWrite: false, side: THREE.DoubleSide, roughness: 1 });
  const bowGeo = new THREE.PlaneGeometry(1, 1); bowGeo.rotateX(-Math.PI / 2);
  const bows = [-1, 1].map((s) => {
    const m = new THREE.Mesh(bowGeo, bowMat);
    m.name = s < 0 ? 'fx_bow_wave_port' : 'fx_bow_wave_starboard';
    m.matrixAutoUpdate = false; m.frustumCulled = false; m.visible = false; m.renderOrder = 1;
    g.add(m);
    return m;
  });

  // starboard hull sections, stern -> stem, keel -> sheer (glTF axes)
  const NP = FIT.hull_section_points, HS = FIT.hull_sections, NS = HS.length / (NP * 3);
  const secs = [];
  for (let k = 0; k < NS; k++) {
    const pts = [];
    for (let j = 0; j < NP; j++) { const o = (k * NP + j) * 3; pts.push(new THREE.Vector3(HS[o], HS[o + 1], HS[o + 2])); }
    secs.push(pts);
  }
  const Z_WAKE = FIT.transom_waterline_game_z + 0.3;

  const parts = [], inv = new THREE.Matrix4(), W = new THREE.Matrix4(), qW = new THREE.Quaternion();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  const ZAX = new THREE.Vector3(0, 0, 1), pv = new THREE.Vector3(), out_ = new THREE.Vector3();
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const sc = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  let acc = 0, side = 1, seed = 8412;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  function emit(local, size, life, type, vel = null, yaw = 0) {
    if (parts.length >= MAX_FX) parts.shift();
    parts.push({ p: local.clone().applyMatrix4(g.matrixWorld), size, life, max: life, type, vel, yaw });
  }

  /** Where the sea cuts station k on one side: the world point, or null when
   *  the station is dry. out.keel gets the keel's height above the sea. */
  function cut(k, s, sea, out) {
    const pts = secs[k];
    let prevY = 0;
    for (let j = 0; j < pts.length; j++) {
      c.set(s * pts[j].x, pts[j].y, pts[j].z).applyMatrix4(g.matrixWorld);
      const y = c.y - sea;
      if (j === 0) { out.keel = y; if (y >= 0) return null; }
      else if (prevY < 0 && y >= 0) {
        out.p.copy(pv).lerp(c, -prevY / (y - prevY));
        // the outer skin at the sea: where the sea cuts the V below the chine,
        // the water leaves the hull at the chine (planing spray comes out there)
        if (j <= CHINE) out.skin.set(s * pts[CHINE].x, pts[CHINE].y, pts[CHINE].z).applyMatrix4(g.matrixWorld);
        else out.skin.copy(out.p);
        out.skin.y = sea;
        return out.p;
      }
      pv.copy(c); prevY = y;
    }
    out.skin.copy(c); out.skin.y = sea;
    return out.p.copy(c);               // under water to the sheer: take the sheer
  }
  const cutA = { p: new THREE.Vector3(), skin: new THREE.Vector3(), keel: 0 };
  const cutB = { p: new THREE.Vector3(), skin: new THREE.Vector3(), keel: 0 };
  const CHINE = 5;                      // section point: the outer edge of the chine flat

  function update(dt, speed, steer, sea) {
    g.updateWorldMatrix(true, false);
    inv.copy(g.matrixWorld).invert();
    g.getWorldQuaternion(qW);
    fwd.set(0, 0, -1).applyQuaternion(qW); fwd.y = 0;
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1);
    fwd.normalize();
    right.set(-fwd.z, 0, fwd.x);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    const v_ = Math.abs(speed), plane = clamp((v_ - 3) / 10, 0, 1);

    // ---- bow wave: at the real entry, flaring aft along the waterline
    for (const [i, s] of [[0, -1], [1, 1]]) {
      const m = bows[i];
      let k = NS - 1, lastDryKeel = null, lastDry = -1;
      for (; k >= 0; k--) {
        if (cut(k, s, sea, cutA)) break;
        lastDryKeel = cutA.keel; lastDry = k;
      }
      if (k < 0 || v_ <= 0.4) { m.visible = false; continue; }
      a.copy(cutA.p);
      if (lastDry >= 0) {                // slide the entry forward to where the keel meets the sea
        const t = lastDryKeel / (lastDryKeel - cutA.keel);
        c.set(0, secs[lastDry][0].y, secs[lastDry][0].z).applyMatrix4(g.matrixWorld);
        a.lerp(c, clamp(1 - t, 0, 1));
      }
      a.y = sea;
      // B: the outer skin two to three metres aft; the wave runs from the entry
      // out past it, flared, and its inner edge rises against the hull as she planes
      const k2 = Math.max(0, k - 3);
      if (!cut(k2, s, sea, cutB)) cutB.skin.copy(a).addScaledVector(fwd, -1.5).addScaledVector(right, s * 0.8);
      b.copy(cutB.skin).sub(a); b.y = 0;
      if (b.lengthSq() < 1e-6) b.copy(fwd).multiplyScalar(-1);
      const lab = b.length();
      b.normalize();
      const L = Math.max(lab * 1.15, 1.1 * (1 + plane * 1.25)), Wd = BEAM * (0.3 + plane * 0.3);
      const yawB = Math.atan2(b.x, b.z) + s * 0.10;            // along A->B (aft and out), a touch more flare
      out_.set(Math.cos(yawB), 0, -Math.sin(yawB));           // the quad's local +x ...
      const sx = out_.dot(right) * s < 0 ? -1 : 1;            // ... or -x, whichever points outboard
      out_.multiplyScalar(sx);
      c.copy(a).addScaledVector(b, L * 0.5).addScaledVector(out_, Wd * 0.42);
      c.y = sea + 0.05 + 0.04 * plane;
      qa.setFromAxisAngle(UP, yawB);
      qb.setFromAxisAngle(ZAX, -sx * 0.36 * plane);            // lift the inboard edge
      qa.multiply(qb);
      W.compose(c, qa, sc.set(Wd, 1, L));
      m.matrix.copy(inv).multiply(W);
      m.matrixWorldNeedsUpdate = true;
      m.visible = true;
    }
    bowMat.opacity = v_ > 0.4 ? clamp(0.25 + v_ / 8, 0, 0.95) : 0;

    // ---- the wash astern of the props, and spray off the outside chine
    acc += dt;
    if (v_ > 0.6) {
      while (acc >= 0.12) {
        acc -= 0.12;
        side = -side;
        emit(v.set(side * 0.40 + (rnd() - 0.5) * 0.2, 0, Z_WAKE), 1 + v_ * 0.045, 5.8, 'wake',
             right.clone().multiplyScalar(side * (0.12 + 0.03 * v_)), yaw);     // the twin washes spread
        if (Math.abs(steer) > 0.12 && v_ > 3) {
          const o = -Math.sign(steer);                                  // the outside of the turn
          const vel = new THREE.Vector3(o * (1 + v_ * 0.14), 1.6, 1.2).applyQuaternion(qW);
          emit(v.set(o * BEAM * 0.47, 0.2, -LENGTH * 0.06), 0.3, 1.1, 'spray', vel, yaw);
        }
      }
    } else acc = 0;
    let n = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      if (p.type === 'wake') {
        if (p.vel) p.p.addScaledVector(p.vel, dt);
        p.p.y = sea + 0.019;                               // pinned to the sea, not to the hull's heave
      } else {
        p.vel.y -= 9.81 * dt;
        p.p.addScaledVector(p.vel, dt);
        if (p.p.y <= sea) { p.type = 'wake'; p.p.y = sea + 0.019; p.life = Math.min(p.life, 0.5); p.vel = null; }
      }
      const fade = Math.min(1, p.life / 0.8), age = 1 - p.life / p.max, k = Math.sqrt(fade);
      // the wash: long along her track (so one prop's sprites, 0.24 s apart, join up), four
      // times wider by the end of its life; spray: small round puffs
      if (p.type === 'wake') sc.set(p.size * (1 + 3 * age) * k, 1, p.size * 2.2 * (1 + 1.5 * age) * k);
      else sc.set(p.size * (1 + age) * k, 1, p.size * (1 + age) * k);
      qa.setFromAxisAngle(UP, p.yaw);
      W.compose(p.p, qa, sc);
      opac.setX(n, fade * (1 - age * 0.65));
      wash.setMatrixAt(n++, W.premultiply(inv));
    }
    wash.count = n;
    wash.instanceMatrix.needsUpdate = true;
    opac.needsUpdate = true;
  }
  function reset() {
    parts.length = 0; wash.count = 0; acc = 0; bowMat.opacity = 0;
    bows.forEach((m) => (m.visible = false));
  }
  return { update, reset, wash, bows };
}

/* ------------------------------------------------------------ the boat -- */

export function createKestrelLaunch(opts = {}) {
  const mats = META.materials.map(material);
  const objs = META.nodes.map((n) => {
    const o = new THREE.Group();
    o.name = n.name;
    o.position.fromArray(n.t);
    o.quaternion.fromArray(n.r);
    if (n.s) o.scale.fromArray(n.s);
    for (const p of n.prims) {
      const mesh = new THREE.Mesh(geometry(p), mats[p.m]);
      mesh.name = n.name + (n.prims.length > 1 ? ':' + mats[p.m].name : '');
      mesh.castShadow = opts.shadows !== false;
      mesh.receiveShadow = opts.shadows !== false;
      o.add(mesh);
    }
    return o;
  });
  META.nodes.forEach((n, i) => n.children.forEach((c) => objs[i].add(objs[c])));
  const g = new THREE.Group();
  g.name = 'kestrel_launch';          // the same name as the GLB's root
  for (const r of META.roots) {
    for (const c of [...objs[r].children]) g.add(c);
  }
  const parts = {};
  g.traverse((o) => { if (o.name && !(o.name in parts) && !o.isMesh) parts[o.name] = o; });
  const byName = (n) => mats.find((m) => m.name === n);
  const blue = byName('light_blue');
  const blueBase = blue ? blue.emissiveIntensity : 0;
  const navs = ['light_red', 'light_green', 'light_white'].map(byName).filter(Boolean);
  const navBase = navs.map((m) => m.emissiveIntensity);
  const water = opts.water === false ? null : createWater(g);

  const SEA = FIT.sea_motion_scale, LIFT = FIT.planing_lift_m, TOP = FIT.top_speed_mps;
  const LEAN = FIT.lean_scale, TRIM = FIT.trim_scale, DRY_Y = FIT.keep_dry_y;
  const LIFT_FROM = FIT.lift_from ?? 0, LIFT_AT = FIT.lift_full_at;
  const DRY = [];
  for (let i = 0; i < FIT.keep_dry_points.length; i += 3) {
    DRY.push(new THREE.Vector3(FIT.keep_dry_points[i], FIT.keep_dry_points[i + 1], FIT.keep_dry_points[i + 2]));
  }
  const e = new THREE.Euler(0, 0, 0, 'YXZ'), tmp = new THREE.Vector3();
  let t = 0, trimLP = 0, leanLP = 0, first = true;
  const packLowering = opts.packLowering ?? PACK_LOWERING;

  g.userData.parts = parts;
  g.userData.materials = mats;
  g.userData.dimensions = { length: LENGTH, beam: BEAM, massKg: 3400 };
  g.userData.water = water;
  g.userData.keepDryLift = 0;
  g.userData.update = (dt, state = {}) => {
    dt = Math.min(dt || 0, 0.1);
    t += dt;
    const speed = state.speed ?? state.speedMps ?? 0;
    const f = Math.min(1, Math.abs(speed) / TOP);
    const steer = clamp(state.steer ?? state.steering ?? 0, -1, 1);
    const sea = Number.isFinite(state.waterLevel) ? state.waterLevel : 0;

    // steering and the counter-rotating props
    if (parts.outboard_l) parts.outboard_l.rotation.y = steer * 0.42;
    if (parts.outboard_r) parts.outboard_r.rotation.y = steer * 0.42;
    const spin = Math.sign(speed) * f * 14 * dt;          // rad per frame, kept below strobing
    if (parts.prop_r) parts.prop_r.rotation.z -= spin;
    if (parts.prop_l) parts.prop_l.rotation.z += spin;
    if (parts.radar) parts.radar.rotation.y += dt * 2.5;  // 24 rpm

    // lights: the blue double-flash, nav and white lights follow state.lights
    const on = state.lights !== false;
    if (blue) {
      const ph = (t * 1.25) % 1;
      blue.emissiveIntensity = on && (ph < 0.08 || (ph > 0.16 && ph < 0.24)) ? blueBase * 1.6 : blueBase * 0.12;
    }
    navs.forEach((m, i) => { m.emissiveIntensity = on ? navBase[i] : 0; });

    // the pose on the flat sea (only when main.js has just set it: fromPack)
    if (g.userData.fromPack || opts.pose) {
      const trimT = f * 0.14;
      const leanT = -steer * 0.42 * Math.min(1, Math.abs(speed) / 8);
      if (first) { trimLP = trimT; leanLP = leanT; first = false; }
      trimLP += (trimT - trimLP) * Math.min(1, dt * 5);
      leanLP += (leanT - leanLP) * Math.min(1, dt * 3);
      e.setFromQuaternion(g.quaternion, 'YXZ');
      e.x = TRIM * trimLP + SEA * (e.x - trimLP);
      e.z = LEAN * leanLP + SEA * (e.z - leanLP);
      g.quaternion.setFromEuler(e);
      const y = g.position.y + (g.userData.fromPack ? packLowering : 0);   // = v.pos.y, the sea's heave
      g.position.y = SEA * y + LIFT * smooth((f - LIFT_FROM) / (LIFT_AT - LIFT_FROM));
      // keep-dry: no cockpit sole corner or motor-well lip below sea + 0.10
      g.updateWorldMatrix(true, false);
      let low = Infinity;
      for (const p of DRY) { tmp.copy(p).applyMatrix4(g.matrixWorld); if (tmp.y < low) low = tmp.y; }
      const lift = Math.max(0, DRY_Y + sea - low);
      g.userData.keepDryLift = lift;
      if (lift > 0) { g.position.y += lift; g.updateWorldMatrix(true, false); }
    }
    if (water && g.visible !== false) water.update(dt, speed, steer, sea);
  };
  g.userData.reset = () => { t = 0; first = true; if (water) water.reset(); };
  return g;
}
"""

if __name__ == '__main__':
    a = sys.argv[1:]
    bake(a[0] if a else os.path.join(HERE, 'kestrel_launch.glb'), a[1] if len(a) > 1 else os.path.join(HERE, 'kestrel_launch.js'))
