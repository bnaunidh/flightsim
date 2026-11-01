"""
Batch 6: the SCP Foundation models for the Site and "Last Flight Out", baked
small for the game (settings and credits in scp_models.py).

  python3 tools/real-models/scp.py [id ...]          -> assets/models/real/scp/<id>.glb
  python3 tools/real-models/scp.py <id> --view /tmp/x_%.png   (also a preview sheet)

What it does to each download:
  1. reads it (gltfio.py / skin.py: model, image and animation DATA only);
  2. a 'static' model: flattened as drawn (a rig with no clips first posed:
     the guard, stood at ease from its T-pose);
  3. turned to the game's axes (-Z forward, +Y up), stood on y = 0, centred,
     scaled uniformly to its real size;
  4. painted per VERTEX from its own texture, read at 64 px and snapped to a
     small palette (k-means): no image ships, and nothing as fine as a
     letter or a logo survives a 64 px read at a vertex a few centimetres
     from the next; a material with no picture is painted its part's colour;
  5. a 'rig' model keeps its skin: positions in the source's bind space, four
     joints and weights a vertex (joints that move nothing are left out), and
     per clip the joints' matrices (game frame x joint x inverse bind) at a
     fixed rate, 16-bit, so the game plays the source's own animation with
     three.js's SkinnedMesh and no glTF loader. Clips are in place; the
     game moves the model, at the clip's own walking speed (measured here
     from the foot on the ground: no sliding feet);
  6. one node per part under a root node named after the id, the credit in
     its extras.
"""
import json, os, struct, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gltfio import flatten, load  # noqa: E402
from models import INBOX  # noqa: E402
from scenery import srgb_to_linear, sample, palette, axes_matrix, match, open_image, material_factor  # noqa: E402
from skin import Rig, axis_quat  # noqa: E402
from scp_models import SCP_MODELS  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'models', 'real', 'scp')
READ_PX = 64


def picture(j, bufs, path, mi, cache):
    """A material's picture, read small (64 px, box-filtered), linear RGB; None for a material without one."""
    if mi is None:
        return None
    if mi in cache:
        return cache[mi]
    m = j['materials'][mi]
    t = (m.get('pbrMetallicRoughness') or {}).get('baseColorTexture')
    img = None
    if t:
        im = open_image(j, bufs, path, j['textures'][t['index']]['source']).convert('RGB')
        im = im.resize((READ_PX, READ_PX), Image.BOX)
        img = srgb_to_linear(np.asarray(im, dtype=np.float64) / 255.0)
    cache[mi] = img
    return img


def part_of(cfg, p):
    for part, rule in (cfg.get('parts') or {}).items():
        if match(p['mat'], rule.get('mats')) or match(p['node'], rule.get('nodes')):
            return part
    return 'body'


def vertex_colours(cfg, j, bufs, path, p, cache):
    rule = (cfg.get('parts') or {}).get(part_of(cfg, p), {})
    n = len(p['pos'])
    if rule.get('colour') is not None:
        return np.tile(srgb_to_linear(np.array(rule['colour'])), (n, 1))
    img = picture(j, bufs, path, p['matIndex'], cache) if p['uv'] is not None else None
    f = srgb_to_linear(material_factor(j, p['matIndex']))
    if img is None:
        return np.tile(f, (n, 1))
    return sample(img, p['uv']) * f[None]


def size_scale(cfg, ext):
    if 'height' in cfg:
        return cfg['height'] / ext[1]
    if 'length' in cfg:
        return cfg['length'] / ext[2]
    if 'width' in cfg:
        return cfg['width'] / ext[0]
    return cfg.get('scale', 1.0)


def over_quats(pose):
    return {k: axis_quat({'x': [1, 0, 0], 'y': [0, 1, 0], 'z': [0, 0, 1]}[a], d) for k, (a, d) in (pose.get('over') or {}).items()}


def static_prims(cfg, path):
    """[{pos, nrm, uv, idx, mat, matIndex, node}] as drawn (or as posed, a rig with no clips)."""
    if cfg.get('rigged'):
        rig = Rig(path)
        pose = cfg.get('pose') or {}
        out = []
        for p, pos, nrm in rig.posed(pose.get('clip'), pose.get('t', 0), over_quats(pose)):
            q = dict(p)
            q['pos'], q['nrm'] = pos, nrm
            out.append(q)
        return out, rig.j, rig.bufs
    prims, j, bufs = flatten(path)
    return [p for p in prims if not p['skinned']], j, bufs


def smooth_normals(pos, idx):
    n = np.zeros_like(pos)
    t = pos[idx]
    f = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    for k in range(3):
        np.add.at(n, idx[:, k], f)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def bake_static(mid, cfg):
    path = os.path.join(INBOX, cfg['src'])
    prims, j, bufs = static_prims(cfg, path)
    R = axes_matrix(cfg.get('axes', 'x,y,z'))
    cache = {}
    parts = {}
    for p in prims:
        part = part_of(cfg, p)
        pos = p['pos'] @ R.T
        nrm = (p['nrm'] if p['nrm'] is not None else smooth_normals(p['pos'], p['idx'])) @ R.T
        idx = p['idx'] if np.linalg.det(R) > 0 else p['idx'][:, [0, 2, 1]]
        col = vertex_colours(cfg, j, bufs, path, p, cache)
        d = parts.setdefault(part, dict(P=[], N=[], C=[], I=[], n=0))
        d['P'].append(pos)
        d['N'].append(nrm)
        d['C'].append(col)
        d['I'].append(idx + d['n'])
        d['n'] += len(pos)
    for d in parts.values():
        for k in 'PNCI':
            d[k] = np.concatenate(d[k])
    # Only what the triangles use (a rig's mesh can carry loose vertices).
    allP = np.concatenate([d['P'][np.unique(d['I'])] for d in parts.values()])
    lo, hi = allP.min(0), allP.max(0)
    s = size_scale(cfg, hi - lo)
    centre = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    for d in parts.values():
        d['P'] = (d['P'] - centre) * s
    paint(cfg, parts)
    return parts, s


def paint(cfg, parts):
    for part, d in parts.items():
        rule = (cfg.get('parts') or {}).get(part, {})
        if rule.get('colour') is not None:
            continue
        k = rule.get('colours', cfg.get('colours', 8))
        used = np.unique(d['I'])
        C = d['C'].copy()
        C[used] = palette(d['C'][used], k)
        if cfg.get('calm'):
            C[used] = calm(C[used], cfg['calm'])
        d['C'] = C


def calm(C, amount):
    """
    The teen rule (no gore): a palette colour that reads as blood (red well
    over green and blue, linear) is turned most of the way to a neutral of the
    same brightness: grime and shadow, not stains. `amount` 0..1.
    """
    C = C.copy()
    r, g, b = C[:, 0], C[:, 1], C[:, 2]
    red = (r > 1.6 * np.maximum(g, 1e-4)) & (r > 1.6 * np.maximum(b, 1e-4))
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    grey = np.stack([lum * 1.06, lum, lum * 0.96], 1)
    C[red] = C[red] * (1 - amount) + grey[red] * amount
    return C


def pivots(parts):
    out = {}
    for part in ('rotor', 'tailrotor'):
        if part not in parts:
            continue
        P = parts[part]['P'][np.unique(parts[part]['I'])]
        c = (P.min(0) + P.max(0)) / 2
        q = P - c
        w, v = np.linalg.eigh(q.T @ q)
        axis = v[:, 0]
        if axis[np.argmax(np.abs(axis))] < 0:
            axis = -axis
        out[part] = dict(hub=[round(float(x), 4) for x in c], axis=[round(float(x), 4) for x in axis],
                         radius=round(float(np.max(np.linalg.norm(q - np.outer(q @ axis, axis), axis=1))), 3))
    return out


# ------------------------------------------------------------------ rigs --

def rig_game_frame(cfg, rig, prims):
    """G: source world -> game (axes, uniform scale, feet on y = 0 in the ground clip, centred)."""
    R = axes_matrix(cfg.get('axes', 'x,y,z'))
    s = cfg.get('scale', 1.0)
    clip = cfg['clips'][cfg['ground']]
    dur = rig.clips[clip]
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
    for t in np.linspace(0, dur, 9):
        M = rig.joint_mats(clip, t)
        for p in prims:
            pos, _ = Rig.skin(p, M)
            P = pos[np.unique(p['idx'])] @ R.T
            lo, hi = np.minimum(lo, P.min(0)), np.maximum(hi, P.max(0))
    centre = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    G = np.eye(4)
    G[:3, :3] = R * s
    G[:3, 3] = -centre * s
    return G


def walk_speed(rig, clip, G, prims, fps=30):
    """Metres a second the clip walks at: how fast the foot on the ground slides back under an in-place cycle."""
    dur = rig.clips[clip]
    n = max(8, int(round(dur * fps)))
    frames = []
    for f in range(n + 1):
        M = np.einsum('ab,jbc->jac', G, rig.joint_mats(clip, dur * f / n))
        frames.append(np.concatenate([Rig.skin(p, M)[0] for p in prims]))
    v = []
    for a, b in zip(frames[:-1], frames[1:]):
        floor = a[:, 1].min()
        on = (a[:, 1] < floor + 0.04) & (b[:, 1] < floor + 0.04)
        if on.sum() > 3:
            v.append(np.median(b[on, 2] - a[on, 2]) * n / dur)  # +z is backwards
    v = np.array(v)
    v = v[v > 0.05]
    return round(float(np.median(v)), 3) if len(v) else 0.0


def bake_rig(mid, cfg):
    path = os.path.join(INBOX, cfg['src'])
    rig = Rig(path)
    prims = rig.skinned_prims()
    G = rig_game_frame(cfg, rig, prims)
    cache = {}
    # The joints that move a vertex, remapped 0..n-1.
    used = sorted({int(x) for p in prims for x in np.unique(p['joints'][p['weights'] > 0.004])})
    remap = {o: i for i, o in enumerate(used)}
    P, N, C, J, W, I = [], [], [], [], [], []
    base = 0
    for p in prims:
        P.append(p['pos'])
        N.append(p['nrm'] if p['nrm'] is not None else smooth_normals(p['pos'], p['idx']))
        C.append(vertex_colours(cfg, rig.j, rig.bufs, path, p, cache))
        w = np.where(p['weights'] > 0.004, p['weights'], 0)
        w = w / np.maximum(w.sum(1, keepdims=True), 1e-9)
        J.append(np.vectorize(lambda x: remap.get(int(x), 0))(p['joints']))
        W.append(w)
        I.append(p['idx'] + base)
        base += len(p['pos'])
    d = dict(P=np.concatenate(P), N=np.concatenate(N), C=np.concatenate(C), J=np.concatenate(J), W=np.concatenate(W), I=np.concatenate(I))
    parts = {'body': d}
    paint(cfg, parts)
    ibm = rig.ibm[[rig.joints.index(rig.joints[o]) for o in used]]
    clips = {}
    for game, src in cfg['clips'].items():
        dur = rig.clips[src]
        loop = game != 'rise'
        n = max(2, int(round(dur * cfg.get('fps', 10))))
        nf = n if loop else n + 1
        mats = []
        for f in range(nf):
            M = rig.world(src, dur * f / n)
            K = np.stack([G @ M[rig.joints[o]] for o in used])  # (J,4,4) joint -> game
            mats.append(K[:, :3, :].reshape(len(used), 12))
        A = np.stack(mats)  # (F,J,12)
        clips[game] = dict(src=src, seconds=round(dur, 4), frames=nf, loop=loop, data=A)
        if game == 'walk':
            clips[game]['speed'] = walk_speed(rig, src, G, prims)
    # Size in the ground clip, and a sphere that holds every frame of every clip.
    rad, lo, hi = 0.0, np.full(3, np.inf), np.full(3, -np.inf)
    for game, c in clips.items():
        for f in range(0, c['frames'], max(1, c['frames'] // 6)):
            K = np.concatenate([c['data'][f].reshape(-1, 3, 4), np.tile([0, 0, 0, 1.0], (len(used), 1, 1))], 1)
            M = np.einsum('jab,jbc->jac', K, ibm)
            pos = Rig.skin(dict(joints=d['J'], weights=d['W'], pos=d['P'], nrm=None), M)[0][np.unique(d['I'])]
            rad = max(rad, float(np.linalg.norm(pos - [0, pos[:, 1].mean(), 0], axis=1).max()))
            if game == cfg['ground']:
                lo, hi = np.minimum(lo, pos.min(0)), np.maximum(hi, pos.max(0))
    return parts, dict(ibm=ibm, clips=clips, joints=len(used), radius=round(rad, 3), size=[round(float(x), 3) for x in hi - lo])


# ----------------------------------------------------------------- write --

class Glb:
    def __init__(self):
        self.bin = bytearray()
        self.views, self.accs = [], []

    def add(self, arr, comp, typ, normalized=False, minmax=False, target=None, stride=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        arr = np.ascontiguousarray(arr)
        self.bin.extend(arr.tobytes())
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes}
        if target:
            v['target'] = target
        if stride:
            v['byteStride'] = stride
        self.views.append(v)
        a = {'bufferView': len(self.views) - 1, 'componentType': comp, 'count': int(arr.shape[0]), 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = [float(x) for x in arr.min(0)]
            a['max'] = [float(x) for x in arr.max(0)]
        self.accs.append(a)
        return len(self.accs) - 1


def write(mid, parts, extras, skin=None):
    g = Glb()
    meshes, nodes, mats, kids = [], [], [], []
    for part, d in parts.items():
        used = np.unique(d['I'])
        if not len(used):
            continue
        keep = np.zeros(len(d['P']), np.int64) - 1
        keep[used] = np.arange(len(used))
        P = d['P'][used].astype(np.float32)
        n = d['N'][used]
        n = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        n8 = np.clip(np.round(n * 127), -127, 127).astype(np.int8)
        c8 = np.clip(np.round(d['C'][used] * 255), 0, 255).astype(np.uint8)
        idx = keep[d['I']].reshape(-1)
        idx = idx.astype(np.uint16 if len(used) < 65536 else np.uint32)
        attrs = {'POSITION': g.add(P, 5126, 'VEC3', minmax=True, target=34962),
                 'NORMAL': g.add(np.concatenate([n8, np.zeros((len(n8), 1), np.int8)], 1), 5120, 'VEC3', normalized=True, target=34962, stride=4),
                 'COLOR_0': g.add(np.concatenate([c8, np.full((len(c8), 1), 255, np.uint8)], 1), 5121, 'VEC3', normalized=True, target=34962, stride=4)}
        if skin is not None:
            attrs['JOINTS_0'] = g.add(d['J'][used].astype(np.uint8), 5121, 'VEC4', target=34962)
            w8 = np.round(d['W'][used] * 255)
            # the four weights sum to exactly 255 (the biggest takes the rounding)
            w8[np.arange(len(w8)), w8.argmax(1)] += 255 - w8.sum(1)
            attrs['WEIGHTS_0'] = g.add(w8.astype(np.uint8), 5121, 'VEC4', normalized=True, target=34962)
        ia = g.add(idx.reshape(-1, 1), 5123 if idx.dtype == np.uint16 else 5125, 'SCALAR', target=34963)
        mats.append({'name': f'scp_{part}', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0.0, 'roughnessFactor': 0.8}})
        meshes.append({'name': part, 'primitives': [{'attributes': attrs, 'indices': ia, 'material': len(mats) - 1}]})
        nodes.append({'name': part, 'mesh': len(meshes) - 1})
        kids.append(len(nodes) - 1)
    if skin is not None:
        sx = {'joints': skin['joints'], 'ibm': g.add(skin['ibm'].transpose(0, 2, 1).reshape(-1, 16).astype(np.float32), 5126, 'MAT4'),
              'radius': skin['radius'], 'clips': {}}
        for name, c in skin['clips'].items():
            A = c['data'].reshape(-1, 12)
            lo, hi = A.min(0), A.max(0)
            span = np.maximum(hi - lo, 1e-9)
            q = np.round((A - lo) / span * 65535).astype(np.uint16)
            cl = {'src': c['src'], 'seconds': c['seconds'], 'frames': c['frames'], 'loop': c['loop'],
                  'lo': [float(x) for x in lo], 'span': [float(x) for x in span], 'data': g.add(q.reshape(-1), 5123, 'SCALAR')}
            if 'speed' in c:
                cl['speed'] = c['speed']
            sx['clips'][name] = cl
        extras['skin'] = sx
    nodes.append({'name': mid, 'children': kids, 'extras': extras})
    jj = {'asset': {'version': '2.0', 'generator': 'island-flight-sim tools/real-models/scp.py'}, 'scene': 0,
          'scenes': [{'nodes': [len(nodes) - 1]}], 'nodes': nodes, 'meshes': meshes, 'materials': mats, 'accessors': g.accs,
          'bufferViews': g.views, 'buffers': [{'byteLength': len(g.bin)}]}
    js = json.dumps(jj, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    while len(g.bin) % 4:
        g.bin.append(0)
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f'{mid}.glb')
    with open(out, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(g.bin)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(g.bin), 0x004E4942))
        f.write(g.bin)
    return os.path.getsize(out)


def run(mid, view=None):
    cfg = SCP_MODELS[mid]
    extras = {'realModel': 1, 'id': mid, 'credit': cfg['credit'], 'license': 'CC BY 4.0 (model); CC BY-SA 3.0 (SCP Foundation content)',
              'changes': cfg.get('changes', 'textures replaced by colours read per vertex at 64 px (no image ships), scaled and turned to the game\'s axes'
                         + (', the skin and its clips resampled' if cfg['kind'] == 'rig' else '') + (', posed at ease from its T-pose' if cfg.get('rigged') else ''))}
    skin = None
    if cfg['kind'] == 'rig':
        parts, skin = bake_rig(mid, cfg)
        extras['size'] = skin['size']
    else:
        parts, s = bake_static(mid, cfg)
        allP = np.concatenate([d['P'][np.unique(d['I'])] for d in parts.values()])
        extras['size'] = [round(float(x), 3) for x in allP.max(0) - allP.min(0)]
        pv = pivots(parts)
        if pv:
            extras['pivots'] = pv
    tris = {p: int(len(d['I'])) for p, d in parts.items()}
    extras['triangles'] = int(sum(tris.values()))
    size = write(mid, parts, extras, skin)
    extra = ''
    if skin:
        extra = f", {skin['joints']} joints, clips " + ', '.join(f"{k} {c['frames']}f" + (f" {c['speed']} m/s" if 'speed' in c else '') for k, c in skin['clips'].items())
    print(f"{mid}: {extras['triangles']} tris {tris}, {size / 1024:.0f} KB, size {extras['size']}{extra}" + (f", pivots {extras.get('pivots')}" if extras.get('pivots') else ''))
    if view:
        from view import sheet
        prims = []
        cols = {}
        for p, d in parts.items():
            if skin is not None:
                c = skin['clips'][cfg['ground']]
                K = np.concatenate([c['data'][0].reshape(-1, 3, 4), np.tile([0, 0, 0, 1.0], (skin['joints'], 1, 1))], 1)
                pos = Rig.skin(dict(joints=d['J'], weights=d['W'], pos=d['P'], nrm=None), np.einsum('jab,jbc->jac', K, skin['ibm']))[0]
            else:
                pos = d['P']
            tc = d['C'][d['I']].mean(1)
            uc, inv = np.unique(np.round(tc, 2), axis=0, return_inverse=True)
            for i, c in enumerate(uc):
                m = inv.reshape(-1) == i
                name = f'{p}:{i}'
                prims.append(dict(pos=pos, idx=d['I'][m], mat=name))
                srgb = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055)
                cols[name] = tuple(np.clip(srgb, 0, 1))
        sheet(prims, view, label=mid, colours=cols)


if __name__ == '__main__':
    args = sys.argv[1:]
    view = None
    if '--view' in args:
        k = args.index('--view')
        view = args[k + 1]
        args = args[:k] + args[k + 2:]
    for mid in (args or list(SCP_MODELS)):
        run(mid, view.replace('%', mid) if view else None)
