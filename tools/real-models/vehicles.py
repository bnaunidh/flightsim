"""
The ground vehicles: the apron's tug, baggage tractor and baggage cart, and
the road traffic's cars, from three CC BY 4.0 downloads, as ONE file of
vertex-coloured shapes in the frame the game's own vehicles are built in
(src/world/airport-vehicles.js: -Z forward, +X right, y = 0 on the ground,
origin in the middle), each sized to the game's own figure for that kind.

  python3 tools/real-models/vehicles.py      -> assets/models/real/vehicles.glb

No images: a textured source (the tug, the cart) is sampled to one colour
per triangle, which keeps its paint and loses its lettering. A kind the game
tints per instance (the cars, the carts) has its paint baked WHITE, so the
tint is the paint, as with the game's own shapes.
"""
import io, json, os, struct, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gltfio import flatten, load  # noqa: E402
from models import INBOX  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'models', 'real', 'vehicles.glb')

PACK = 'vehicles/scene.gltf'
# kind -> (source, length in metres, paint white?, pack vehicle)
KINDS = {
    # src/world/apron.js
    # The towbar's tip pins to the nose leg TUG_BAR_TIP (7.4 m) ahead of the tug's middle (airport-vehicles.js).
    'tug': dict(src='pushback/pushback.glb', L=4.6, tex=True, beacon=(-0.55, 2.45, 1.0), towbar=7.4),
    'tractor': dict(src='pushback/pushback.glb', L=3.0, tex=True),
    'cart': dict(src='baggagecart/scene.gltf', L=3.5, tex=True, white=True),
    # src/features/ambient/cars.js (car: tinted per car; the others: tinted with their kind's colour)
    'car': dict(src=PACK, veh='Sedan', L=4.4, white=True),
    'taxi': dict(src=PACK, veh='Taxi', L=4.5, white=True),
    'bus': dict(src=PACK, veh='Bus', L=11.0, white=True),
    'van': dict(src=PACK, veh='Van', L=5.4, white=True),
    'truck': dict(src=PACK, veh='Truck', H=3.3, white=True),  # sized by height: the source is a short box truck
    'jeep': dict(src=PACK, veh='SUV', L=4.0, white=True),
    'fourx4': dict(src=PACK, veh='Pickup', L=4.8, white=True),
}

CREDITS = {
    'pushback/pushback.glb': '"Aircraft tractor lowpoly model" by propmaker1 (@menX1151), CC BY 4.0, https://sketchfab.com/3d-models/2e9a078c365243c888f4c70f85be7b85',
    'baggagecart/scene.gltf': '"Airport baggage equipment (cart) lowpoly" by propmaker1 (@menX1151), CC BY 4.0, https://sketchfab.com/3d-models/7ae8444bb5044376a04ee7bb0664ff39',
    PACK: '"Free Low Poly Vehicles Pack" by RgsDev (@rgsdev), CC BY 4.0, https://sketchfab.com/3d-models/cb7640039e7a40679a53be705ebff50e',
}


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def base_texture(j, bufs, path, mat_index):
    """The base colour image of a material, as a float array (sRGB 0..1), or None."""
    m = j['materials'][mat_index]
    t = (m.get('pbrMetallicRoughness') or {}).get('baseColorTexture')
    if not t:
        return None
    img = j['images'][j['textures'][t['index']]['source']]
    if 'bufferView' in img:
        bv = j['bufferViews'][img['bufferView']]
        raw = bufs[bv.get('buffer', 0)][bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        im = Image.open(io.BytesIO(raw))
    else:
        uri = img['uri']
        if '..' in uri or uri.startswith('/') or ':' in uri:
            raise ValueError('refusing image uri ' + uri)
        im = Image.open(os.path.join(os.path.dirname(path), uri))
    im = im.convert('RGB').resize((256, 256), Image.BILINEAR)
    return np.asarray(im, dtype=np.float64) / 255.0


def sample(img, uv):
    h, w, _ = img.shape
    u = np.mod(uv[..., 0], 1.0)
    v = np.mod(uv[..., 1], 1.0)
    x = np.clip((u * (w - 1)).round().astype(int), 0, w - 1)
    y = np.clip((v * (h - 1)).round().astype(int), 0, h - 1)  # glTF uv: v down the image
    return img[y, x]


def build(kind, cfg):
    path = os.path.join(INBOX, cfg['src'])
    prims, j, bufs = flatten(path)
    if cfg.get('veh'):
        def owner(p):
            ch = p['chain'].split('/')
            return ch[ch.index('RootNode') + 1].split(' wheel')[0] if 'RootNode' in ch else ''
        prims = [p for p in prims if owner(p) == cfg['veh']]
    mats = j.get('materials', [])
    # Which body colour is the paint: the body_* material with the most area.
    paint = None
    if cfg.get('white') and cfg.get('veh'):
        area = {}
        for p in prims:
            if not p['mat'].startswith('body_'):
                continue
            v = p['pos'][p['idx']]
            a = np.linalg.norm(np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0]), axis=1).sum()
            area[p['mat']] = area.get(p['mat'], 0) + a
        paint = max(area, key=area.get) if area else None
    Ps, Ns, Cs = [], [], []
    for p in prims:
        mi = p['matIndex']
        tri = p['pos'][p['idx']]  # (n, 3, 3), un-indexed: one colour per triangle
        if p['nrm'] is not None:
            nrm = p['nrm'][p['idx']]
        else:
            n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
            n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
            nrm = np.repeat(n[:, None, :], 3, axis=1)
        img = base_texture(j, bufs, path, mi) if (cfg.get('tex') or cfg['src'].endswith('cart/scene.gltf')) and mi is not None else None
        if img is not None and p['uv'] is not None:
            uv = p['uv'][p['idx']]
            pts = np.concatenate([uv, uv.mean(1, keepdims=True)], 1)  # the corners and the middle
            col = srgb_to_linear(sample(img, pts).mean(1))
            if cfg.get('white'):
                # the cart's light panels take the tint: lift the pale colours to white
                lum = col @ np.array([0.2126, 0.7152, 0.0722])
                col = np.where((lum > 0.35)[:, None], np.minimum(1.0, col / np.maximum(lum[:, None], 1e-6) * 0.92), col)
        else:
            f = (mats[mi].get('pbrMetallicRoughness') or {}).get('baseColorFactor', [1, 1, 1, 1]) if mi is not None else [1, 1, 1, 1]
            col = np.tile(np.array(f[:3]), (len(tri), 1))
            if paint and p['mat'] == paint:
                col[:] = 0.92
        Ps.append(tri.reshape(-1, 3))
        Ns.append(nrm.reshape(-1, 3))
        Cs.append(np.repeat(col, 3, axis=0))
    P, N, C = np.concatenate(Ps), np.concatenate(Ns), np.concatenate(Cs)
    if cfg.get('tex'):
        # A sampled texture gives every triangle its own shade, and a quad's two
        # triangles disagree: snapped to a few colours, a panel is one colour again.
        C = palette(C, cfg.get('colours', 8))
    # -Z forward: the pack's vehicles face +Z; the tug faces -Z already.
    if cfg.get('veh'):
        P[:, 0] *= -1
        P[:, 2] *= -1
        N[:, 0] *= -1
        N[:, 2] *= -1
    lo, hi = P.min(0), P.max(0)
    s = cfg['L'] / (hi[2] - lo[2]) if 'L' in cfg else cfg['H'] / (hi[1] - lo[1])
    P = (P - np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])) * s
    if cfg.get('beacon'):
        P, N, C = add_beacon(P, N, C, cfg['beacon'])
    if cfg.get('towbar'):
        P, N, C = add_towbar(P, N, C, cfg['towbar'])
    return P, N, C, cfg['src']


def palette(C, k, iters=12):
    """k-means in linear RGB: every colour snapped to the nearest of k."""
    rng = np.random.default_rng(1)
    uniq = np.unique(np.round(C, 3), axis=0)
    cent = uniq[rng.choice(len(uniq), size=min(k, len(uniq)), replace=False)]
    for _ in range(iters):
        d = ((C[:, None, :] - cent[None]) ** 2).sum(2)
        lab = d.argmin(1)
        for i in range(len(cent)):
            if (lab == i).any():
                cent[i] = C[lab == i].mean(0)
    d = ((C[:, None, :] - cent[None]) ** 2).sum(2)
    return cent[d.argmin(1)]


def tube(a, b, r, col, sides=6):
    """A prism from point a to point b: (triangles, normals, colours)."""
    a, b = np.array(a, float), np.array(b, float)
    d = b - a
    d /= np.linalg.norm(d)
    u = np.cross(d, [0, 1, 0]) if abs(d[1]) < 0.9 else np.cross(d, [1, 0, 0])
    u /= np.linalg.norm(u)
    w = np.cross(d, u)
    ang = np.linspace(0, 2 * np.pi, sides + 1)[:-1]
    ring = [np.cos(t) * u + np.sin(t) * w for t in ang]
    tris, nrms = [], []
    for i in range(sides):
        r0, r1 = ring[i] * r, ring[(i + 1) % sides] * r
        q = [a + r0, a + r1, b + r1, b + r0]
        n = (ring[i] + ring[(i + 1) % sides]) / 2
        for t in ((q[0], q[1], q[2]), (q[0], q[2], q[3])):
            tris.append(np.array(t))
            nrms.append(np.tile(n / np.linalg.norm(n), (3, 1)))
    return np.concatenate(tris), np.concatenate(nrms), np.tile(col, (len(tris) * 3, 1))


def add_towbar(P, N, C, tip):
    """The game's towbar: an A-frame from the tug's front to the hitch that pins to the nose leg."""
    front = P[:, 2].min()
    steel = srgb_to_linear([0.65, 0.68, 0.71])
    dark = srgb_to_linear([0.15, 0.17, 0.19])
    parts = [
        tube((-0.5, 0.5, front + 0.05), (0, 0.45, -tip + 0.25), 0.06, steel),
        tube((0.5, 0.5, front + 0.05), (0, 0.45, -tip + 0.25), 0.06, steel),
        tube((0, 0.45, -tip + 0.3), (0, 0.42, -tip + 0.02), 0.11, dark),
        tube((-0.32, 0.18, -tip + 1.0), (-0.2, 0.18, -tip + 1.0), 0.18, dark, 8),
        tube((0.2, 0.18, -tip + 1.0), (0.32, 0.18, -tip + 1.0), 0.18, dark, 8),
        tube((-0.25, 0.18, -tip + 1.0), (0, 0.44, -tip + 0.9), 0.03, steel),
        tube((0.25, 0.18, -tip + 1.0), (0, 0.44, -tip + 0.9), 0.03, steel),
    ]
    for t, n, c in parts:
        P, N, C = np.concatenate([P, t]), np.concatenate([N, n]), np.concatenate([C, c])
    return P, N, C


def add_beacon(P, N, C, at):
    """A thin mast and an amber beacon at the game's beacon point (the glow is drawn there)."""
    x, y, z = at
    base = P[(np.abs(P[:, 0] - x) < 0.4) & (np.abs(P[:, 2] - z) < 0.4)]
    y0 = base[:, 1].max() if len(base) else 1.2
    parts = []
    def prism(cx, cz, r, ya, yb, col, sides=6):
        a = np.linspace(0, 2 * np.pi, sides + 1)[:-1]
        ring = np.stack([cx + r * np.cos(a), np.zeros(sides), cz + r * np.sin(a)], 1)
        for i in range(sides):
            p0, p1 = ring[i], ring[(i + 1) % sides]
            q = [p0 + [0, ya, 0], p1 + [0, ya, 0], p1 + [0, yb, 0], p0 + [0, yb, 0]]
            n = np.array([np.cos(a[i] + np.pi / sides), 0, np.sin(a[i] + np.pi / sides)])
            for t in ((q[0], q[2], q[1]), (q[0], q[3], q[2])):
                parts.append((np.array(t), n, col))
        top = [np.array([cx, yb, cz])] + [r_ + [0, yb, 0] for r_ in ring]
        for i in range(sides):
            parts.append((np.array([top[0], top[1 + (i + 1) % sides], top[1 + i]]), np.array([0, 1.0, 0]), col))
    prism(x, z, 0.035, y0, y - 0.07, srgb_to_linear([0.55, 0.57, 0.6]))
    prism(x, z, 0.1, y - 0.08, y + 0.08, srgb_to_linear([0.94, 0.42, 0.11]), 8)
    for tri, n, col in parts:
        P = np.concatenate([P, tri])
        N = np.concatenate([N, np.tile(n, (3, 1))])
        C = np.concatenate([C, np.tile(col, (3, 1))])
    return P, N, C


def write(meshes, credits):
    bin_ = bytearray()
    views, accs, gm, nodes, mats = [], [], [], [], []

    def add(arr, comp, typ, stride=None, normalized=False, minmax=False):
        while len(bin_) % 4:
            bin_.append(0)
        off = len(bin_)
        bin_.extend(arr.tobytes())
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes, 'target': 34962}
        if stride:
            v['byteStride'] = stride
        views.append(v)
        a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': int(arr.shape[0]), 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = [float(x) for x in arr.min(0)]
            a['max'] = [float(x) for x in arr.max(0)]
        accs.append(a)
        return len(accs) - 1

    mats.append({'name': 'rm_vehicle', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0.2, 'roughnessFactor': 0.6}})
    kids = []
    for kind, (P, N, C, _) in meshes.items():
        P32 = P.astype(np.float32)
        n8 = np.clip(np.round(N * 127), -127, 127).astype(np.int8)
        c8 = np.clip(np.round(C * 255), 0, 255).astype(np.uint8)
        # one vertex per distinct position + normal + colour
        key = np.concatenate([P32.view(np.uint32).reshape(-1, 3).astype(np.int64), n8.astype(np.int64), c8.astype(np.int64)], 1)
        uniq, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
        P32, n8, c8 = P32[first], n8[first], c8[first]
        idx = inv.reshape(-1).astype(np.uint16 if len(first) < 65536 else np.uint32)
        pa = add(P32, 5126, 'VEC3', minmax=True)
        na = add(np.concatenate([n8, np.zeros((len(n8), 1), np.int8)], 1), 5120, 'VEC3', stride=4, normalized=True)
        ca = add(np.concatenate([c8, np.full((len(c8), 1), 255, np.uint8)], 1), 5121, 'VEC3', stride=4, normalized=True)
        ia = add(idx.reshape(-1, 1), 5123 if idx.dtype == np.uint16 else 5125, 'SCALAR')
        views[accs[ia]['bufferView']]['target'] = 34963
        gm.append({'name': kind, 'primitives': [{'attributes': {'POSITION': pa, 'NORMAL': na, 'COLOR_0': ca}, 'indices': ia, 'material': 0}]})
        nodes.append({'name': kind, 'mesh': len(gm) - 1})
        kids.append(len(nodes) - 1)
    nodes.append({'name': 'vehicles', 'children': kids, 'extras': {'realModel': 1, 'license': 'CC BY 4.0', 'credit': credits,
                  'changes': 'all textures removed (one colour per triangle), scaled to the game\'s vehicle sizes, turned to the game\'s axes'}})
    j = {'asset': {'version': '2.0', 'generator': 'island-flight-sim tools/real-models/vehicles.py'}, 'scene': 0,
         'scenes': [{'nodes': [len(nodes) - 1]}], 'nodes': nodes, 'meshes': gm, 'materials': mats, 'accessors': accs,
         'bufferViews': views, 'buffers': [{'byteLength': len(bin_)}]}
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    while len(bin_) % 4:
        bin_.append(0)
    with open(OUT, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(bin_), 0x004E4942))
        f.write(bin_)
    return os.path.getsize(OUT)


if __name__ == '__main__':
    meshes = {k: build(k, c) for k, c in KINDS.items()}
    credits = sorted({CREDITS[m[3]] for m in meshes.values()})
    size = write(meshes, credits)
    for k, (P, N, C, _) in meshes.items():
        lo, hi = P.min(0), P.max(0)
        print(f'{k:8s} {len(P) // 3:5d} tris  {np.round(hi - lo, 2)}')
    print(f'vehicles.glb {size / 1024:.0f} KB')
