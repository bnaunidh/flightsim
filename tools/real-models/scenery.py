"""
The real scenery: trees, airport buildings, houses, boats and windmills from
CC BY 4.0 downloads (credits in tools/real-models/scenery_models.py, the
in-game Credits and assets/models/LICENSES.md), baked small for the game.

  python3 tools/real-models/scenery.py [id ...]     -> assets/models/real/scenery/<id>.glb
  python3 tools/real-models/scenery.py <id> --view /tmp/x.png   (also a preview sheet)

What it does to each download, in order:
  1. flattens it (gltfio.py: model and image data only, nothing run);
  2. leaves out what the game must not ship or draws itself (interiors, ground
     planes, the source's own rotor when the game spins its own, lettering);
  3. turns it to the game's axes (-Z forward, +Y up, +X right), stands it on
     y = 0, centres it, and scales it uniformly to the size the game wants;
  4. sorts its triangles into PARTS (body, glass, leaves, rotor, ...), by the
     source's node or material names;
  5. paints every part but the leaves with ONE COLOUR PER TRIANGLE sampled
     from the source's own texture and snapped to a small palette (k-means):
     no images ship, so no lettering, logo or insignia survives a texture;
  6. the leaves keep their alpha cut-out: their picture is re-encoded small
     (WebP, 512 px at most) beside the file, and their normals are bent out
     from the crown so a tree is lit as a tree, not as a stack of cards;
  7. writes one node per part under a root node named after the id, with the
     credit in its extras.
"""
import io, json, os, struct, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gltfio import flatten  # noqa: E402
from models import INBOX  # noqa: E402
from scenery_models import SCENERY  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'models', 'real', 'scenery')


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def material_texture(j, bufs, path, mi, mode='RGB', size=256):
    """A material's base-colour picture (sRGB 0..1 float array), or None. Reads the spec-gloss extension's diffuse too."""
    if mi is None:
        return None
    m = j['materials'][mi]
    t = (m.get('pbrMetallicRoughness') or {}).get('baseColorTexture')
    if not t:
        t = ((m.get('extensions') or {}).get('KHR_materials_pbrSpecularGlossiness') or {}).get('diffuseTexture')
    if not t:
        return None
    im = open_image(j, bufs, path, j['textures'][t['index']]['source'])
    im = im.convert(mode)
    if size:
        im = im.resize((size, size), Image.BILINEAR)
    return np.asarray(im, dtype=np.float64) / 255.0


def open_image(j, bufs, path, ii):
    img = j['images'][ii]
    if 'bufferView' in img:
        bv = j['bufferViews'][img['bufferView']]
        raw = bufs[bv.get('buffer', 0)][bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        return Image.open(io.BytesIO(raw))
    uri = img['uri']
    if '..' in uri or uri.startswith('/') or ':' in uri:
        raise ValueError('refusing image uri ' + uri)
    return Image.open(os.path.join(os.path.dirname(path), uri))


def material_factor(j, mi):
    if mi is None:
        return np.array([0.8, 0.8, 0.8])
    m = j['materials'][mi]
    f = (m.get('pbrMetallicRoughness') or {}).get('baseColorFactor')
    if f is None:
        f = ((m.get('extensions') or {}).get('KHR_materials_pbrSpecularGlossiness') or {}).get('diffuseFactor', [1, 1, 1, 1])
    return np.array(f[:3], dtype=np.float64)


def sample(img, uv):
    h, w = img.shape[:2]
    u = np.mod(uv[..., 0], 1.0)
    v = np.mod(uv[..., 1], 1.0)
    x = np.clip((u * (w - 1)).round().astype(int), 0, w - 1)
    y = np.clip((v * (h - 1)).round().astype(int), 0, h - 1)  # glTF uv: v runs down the image
    return img[y, x]


def palette(C, k, iters=14, seed=1):
    """k-means in linear RGB: every colour snapped to the nearest of k."""
    if len(C) == 0:
        return C
    rng = np.random.default_rng(seed)
    uniq = np.unique(np.round(C, 3), axis=0)
    cent = uniq[rng.choice(len(uniq), size=min(k, len(uniq)), replace=False)].copy()
    for _ in range(iters):
        d = ((C[:, None, :] - cent[None]) ** 2).sum(2)
        lab = d.argmin(1)
        for i in range(len(cent)):
            if (lab == i).any():
                cent[i] = C[lab == i].mean(0)
    d = ((C[:, None, :] - cent[None]) ** 2).sum(2)
    return cent[d.argmin(1)]


def axes_matrix(spec):
    """'x,y,z' style: each new axis from an old one, e.g. '-z,y,x'."""
    M = np.zeros((3, 3))
    for i, t in enumerate(spec.split(',')):
        t = t.strip()
        M[i, 'xyz'.index(t[-1])] = -1.0 if t.startswith('-') else 1.0
    return M


def match(name, pats):
    for p in pats or []:
        if '*' in p[1:-1]:
            import fnmatch
            if fnmatch.fnmatchcase(name, p):
                return True
            continue
        if p.endswith('*') and name.startswith(p[:-1]):
            return True
        if p.startswith('*') and p[1:] in name:
            return True
        if name == p:
            return True
    return False


def part_of(cfg, p):
    for part, rule in (cfg.get('parts') or {}).items():
        if match(p['mat'], rule.get('mats')) or match(p['node'], rule.get('nodes')):
            return part
    return 'body'


def components(I, n):
    """Connected pieces of a triangle list (union-find over shared vertex indices)."""
    par = np.arange(n)

    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x
    for a, b, c in I:
        ra, rb, rc = find(a), find(b), find(c)
        par[rb] = ra
        par[find(rc)] = ra
    roots = np.array([find(i) for i in range(n)])
    return roots


def bake(mid):
    cfg = SCENERY[mid]
    path = os.path.join(INBOX, cfg['src'])
    prims, j, bufs = flatten(path)
    R = axes_matrix(cfg.get('axes', 'x,y,z'))
    parts = {}
    leaf_img = None
    for p in prims:
        if p['skinned']:
            continue
        if match(p['mat'], cfg.get('dropMats')) or match(p['node'], cfg.get('dropNodes')):
            continue
        if cfg.get('keepNodes') and not match(p['node'], cfg['keepNodes']):
            continue
        part = part_of(cfg, p)
        if part == 'drop':
            continue
        pos = p['pos'] @ R.T
        nrm = p['nrm'] @ R.T if p['nrm'] is not None else None
        idx = p['idx']
        if np.linalg.det(R) < 0:
            idx = idx[:, [0, 2, 1]]
        tri = pos[idx]
        if nrm is not None:
            tn = nrm[idx]
        else:
            n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
            n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
            tn = np.repeat(n[:, None, :], 3, axis=1)
        rule = (cfg.get('parts') or {}).get(part, {})
        uv = p['uv'][idx] if p['uv'] is not None else None
        if rule.get('textured'):
            # the leaves: the picture itself ships (alpha cut-out), white vertex colour
            if leaf_img is None:
                m = j['materials'][p['matIndex']]
                t = (m.get('pbrMetallicRoughness') or {}).get('baseColorTexture') or ((m.get('extensions') or {}).get('KHR_materials_pbrSpecularGlossiness') or {}).get('diffuseTexture')
                leaf_img = open_image(j, bufs, path, j['textures'][t['index']]['source']).convert('RGBA')
            col = np.ones((len(tri), 3))
            uvs = uv if uv is not None else np.zeros((len(tri), 3, 2))
        else:
            img = material_texture(j, bufs, path, p['matIndex']) if uv is not None else None
            if img is not None:
                pts = np.concatenate([uv, uv.mean(1, keepdims=True)], 1)
                col = srgb_to_linear(sample(img, pts).mean(1)) * srgb_to_linear(material_factor(j, p['matIndex']))[None]
            else:
                col = np.tile(srgb_to_linear(material_factor(j, p['matIndex'])), (len(tri), 1))
            if rule.get('colour') is not None:
                col = np.tile(srgb_to_linear(np.array(rule['colour'])), (len(tri), 1))
            uvs = None
        d = parts.setdefault(part, dict(T=[], N=[], C=[], UV=[]))
        d['T'].append(tri)
        d['N'].append(tn)
        d['C'].append(col)
        if uvs is not None:
            d['UV'].append(uvs)
    for part, d in parts.items():
        d['T'] = np.concatenate(d['T'])
        d['N'] = np.concatenate(d['N'])
        d['C'] = np.concatenate(d['C'])
        d['UV'] = np.concatenate(d['UV']) if d['UV'] else None
    # clip: an optional box (source axes after the turn) outside which nothing ships
    if cfg.get('clip'):
        lo_, hi_ = np.array(cfg['clip'][0]), np.array(cfg['clip'][1])
        for part, d in parts.items():
            c = d['T'].mean(1)
            keep = np.all((c >= lo_) & (c <= hi_), axis=1)
            for k in ('T', 'N', 'C'):
                d[k] = d[k][keep]
            if d['UV'] is not None:
                d['UV'] = d['UV'][keep]
    # fit: stand it on y = 0, centre x/z, uniform scale
    allP = np.concatenate([d['T'].reshape(-1, 3) for d in parts.values()])
    lo, hi = allP.min(0), allP.max(0)
    ext = hi - lo
    if 'height' in cfg:
        s = cfg['height'] / ext[1]
    elif 'length' in cfg:
        s = cfg['length'] / ext[2]
    elif 'width' in cfg:
        s = cfg['width'] / ext[0]
    else:
        s = cfg.get('scale', 1.0)
    centre = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    if cfg.get('centre'):
        centre = np.array([cfg['centre'][0], lo[1], cfg['centre'][1]])
    if cfg.get('baseCentre'):
        # a tree stands on its trunk: the middle of what is within the bottom 3% of its height
        low = allP[allP[:, 1] < lo[1] + ext[1] * 0.03]
        centre = np.array([(low[:, 0].min() + low[:, 0].max()) / 2, lo[1], (low[:, 2].min() + low[:, 2].max()) / 2])
    for d in parts.values():
        d['T'] = (d['T'] - centre) * s
    # weld small detail (vertex clustering): every corner snapped to its cell's mean, what collapses dropped
    for part, d in parts.items():
        cell = ((cfg.get('parts') or {}).get(part, {})).get('cluster')
        if not cell or not len(d['T']):
            continue
        P = d['T'].reshape(-1, 3)
        key = np.floor(P / cell).astype(np.int64)
        _, inv = np.unique(key, axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        cnt = np.bincount(inv)
        Pc = np.stack([np.bincount(inv, P[:, k]) / cnt for k in range(3)], 1)
        J = inv.reshape(-1, 3)
        ok = (J[:, 0] != J[:, 1]) & (J[:, 1] != J[:, 2]) & (J[:, 0] != J[:, 2])
        _, first = np.unique(np.sort(J[ok], 1), axis=0, return_index=True)
        sel = np.flatnonzero(ok)[np.sort(first)]
        d['T'] = Pc[J[sel]]
        d['N'] = d['N'][sel]
        d['C'] = d['C'][sel]
        if d['UV'] is not None:
            d['UV'] = d['UV'][sel]
    # thin the leaves (whole cards, at random) where the budget asks
    for part, d in parts.items():
        rule = (cfg.get('parts') or {}).get(part, {})
        keep = rule.get('thin')
        if keep and keep < 1 and len(d['T']):
            # pairs of triangles (a card is two) kept or dropped together
            rng = np.random.default_rng(7)
            pairs = (np.arange(len(d['T'])) // 2)
            alive = rng.random(pairs.max() + 1) < keep
            m = alive[pairs]
            for k in ('T', 'N', 'C'):
                d[k] = d[k][m]
            if d['UV'] is not None:
                d['UV'] = d['UV'][m]
    # leaves: normals bent out from the crown's centre; a darker heart
    for part, d in parts.items():
        rule = (cfg.get('parts') or {}).get(part, {})
        if not rule.get('textured') or not len(d['T']):
            continue
        P = d['T'].reshape(-1, 3)
        clo, chi = P.min(0), P.max(0)
        cc = (clo + chi) / 2
        rad = np.maximum((chi - clo) / 2, 1e-3)
        out = (P - cc) / rad
        out /= np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-6)
        n0 = d['N'].reshape(-1, 3)
        bend = rule.get('bend', 0.75)
        n = n0 * (1 - bend) + out * bend
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-6)
        d['N'] = n.reshape(-1, 3, 3)
        r = np.linalg.norm((P - cc) / rad, axis=1)
        up = (P[:, 1] - clo[1]) / max(chi[1] - clo[1], 1e-3)
        ao = np.clip(0.55 + 0.3 * np.minimum(r, 1.0) + 0.2 * up, 0.5, 1.0)
        d['C'] = np.repeat(ao.reshape(-1, 3).mean(1)[:, None], 3, axis=1)
        d['C'] = np.repeat(d['C'][:, :1], 3, axis=1)  # one grey per triangle
    # palettes (per part, so glass stays glass)
    for part, d in parts.items():
        rule = (cfg.get('parts') or {}).get(part, {})
        if rule.get('textured'):
            continue
        k = rule.get('colours', cfg.get('colours', 10))
        if len(d['C']) and k:
            d['C'] = palette(d['C'], k)
        if rule.get('lighten'):
            d['C'] = np.minimum(1.0, d['C'] * rule['lighten'])
        if rule.get('tint'):
            d['C'] = np.minimum(1.0, d['C'] * srgb_to_linear(np.array(rule['tint'])))
    # the leaf picture, small
    leaf_file = None
    if leaf_img is not None:
        S = cfg.get('leafPx', 512)
        im = leaf_img
        if max(im.size) > S:
            im = im.resize((S, S) if im.size[0] == im.size[1] else (S, int(S * im.size[1] / im.size[0])), Image.LANCZOS)
        # bleed the colour under the cut-out so mipmaps do not fringe dark
        a = np.asarray(im).astype(np.float64)
        rgb, al = a[..., :3], a[..., 3:] / 255.0
        lrule = next((r for r in (cfg.get('parts') or {}).values() if r.get('textured')), {})
        if lrule.get('gain'):
            # a picture drawn dark (the oak's leaves average 42/47/33 of 255): lifted to a leaf green
            rgb = np.clip(rgb * np.array(lrule['gain']), 0, 255)
        if (al > 0.5).any():
            mean = (rgb * (al > 0.5)).sum((0, 1)) / max((al > 0.5).sum(), 1)
            rgb = np.where(al > 0.02, rgb, mean)
        im = Image.fromarray(np.concatenate([rgb, al * 255], 2).clip(0, 255).astype(np.uint8))
        leaf_file = f'{mid}-leaf.webp'
        os.makedirs(OUT, exist_ok=True)
        im.save(os.path.join(OUT, leaf_file), 'WEBP', quality=82, method=6)
    return parts, s, cfg, leaf_file


def pivots(parts, cfg):
    """Rotating parts (a windmill's wheel): the hub and the axis, from the part's own shape."""
    out = {}
    for part, rule in (cfg.get('parts') or {}).items():
        if not rule.get('spin') or part not in parts:
            continue
        P = parts[part]['T'].reshape(-1, 3)
        c = (P.min(0) + P.max(0)) / 2
        q = P - c
        w, v = np.linalg.eigh(q.T @ q)
        axis = v[:, 0]  # the thinnest direction of the wheel
        if axis[2] > 0:
            axis = -axis
        out[part] = dict(hub=[round(float(x), 4) for x in c], axis=[round(float(x), 4) for x in axis])
    return out


def write(mid, parts, cfg, leaf_file, extras):
    bin_ = bytearray()
    views, accs, gm, nodes, mats = [], [], [], [], []

    def add(arr, comp, typ, stride=None, normalized=False, minmax=False, target=34962):
        while len(bin_) % 4:
            bin_.append(0)
        off = len(bin_)
        bin_.extend(arr.tobytes())
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes, 'target': target}
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

    kids = []
    for part, d in parts.items():
        if not len(d['T']):
            continue
        rule = (cfg.get('parts') or {}).get(part, {})
        P32 = d['T'].reshape(-1, 3).astype(np.float32)
        n8 = np.clip(np.round(d['N'].reshape(-1, 3) * 127), -127, 127).astype(np.int8)
        c8 = np.clip(np.round(np.repeat(d['C'], 3, axis=0) * 255), 0, 255).astype(np.uint8) if d['C'].ndim == 2 else np.clip(np.round(d['C'].reshape(-1, 3) * 255), 0, 255).astype(np.uint8)
        cols = [P32.view(np.uint32).reshape(-1, 3).astype(np.int64), n8.astype(np.int64), c8.astype(np.int64)]
        uv16 = None
        if d['UV'] is not None:
            uv = d['UV'].reshape(-1, 2)
            uv16 = np.clip(np.round(np.mod(uv, 1.0000001) * 65535), 0, 65535).astype(np.uint16)
            cols.append(uv16.astype(np.int64))
        key = np.concatenate(cols, 1)
        uniq, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
        P32, n8, c8 = P32[first], n8[first], c8[first]
        idx = inv.reshape(-1).astype(np.uint16 if len(first) < 65536 else np.uint32)
        attrs = {'POSITION': add(P32, 5126, 'VEC3', minmax=True),
                 'NORMAL': add(np.concatenate([n8, np.zeros((len(n8), 1), np.int8)], 1), 5120, 'VEC3', stride=4, normalized=True),
                 'COLOR_0': add(np.concatenate([c8, np.full((len(c8), 1), 255, np.uint8)], 1), 5121, 'VEC3', stride=4, normalized=True)}
        if uv16 is not None:
            attrs['TEXCOORD_0'] = add(uv16[first], 5123, 'VEC2', normalized=True)
        ia = add(idx.reshape(-1, 1), 5123 if idx.dtype == np.uint16 else 5125, 'SCALAR', target=34963)
        mat = {'name': f'rs_{part}', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': rule.get('metal', 0.0), 'roughnessFactor': rule.get('rough', 0.85)}}
        if rule.get('textured'):
            mat['alphaMode'] = 'MASK'
            mat['alphaCutoff'] = rule.get('cutoff', 0.42)
            mat['doubleSided'] = True
            mat['extras'] = {'leafTexture': leaf_file}
        if rule.get('doubleSided'):
            mat['doubleSided'] = True
        mats.append(mat)
        gm.append({'name': part, 'primitives': [{'attributes': attrs, 'indices': ia, 'material': len(mats) - 1}]})
        nodes.append({'name': part, 'mesh': len(gm) - 1})
        kids.append(len(nodes) - 1)
    nodes.append({'name': mid, 'children': kids, 'extras': extras})
    jj = {'asset': {'version': '2.0', 'generator': 'island-flight-sim tools/real-models/scenery.py'}, 'scene': 0,
          'scenes': [{'nodes': [len(nodes) - 1]}], 'nodes': nodes, 'meshes': gm, 'materials': mats, 'accessors': accs,
          'bufferViews': views, 'buffers': [{'byteLength': len(bin_)}]}
    js = json.dumps(jj, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    while len(bin_) % 4:
        bin_.append(0)
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f'{mid}.glb')
    with open(out, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(bin_), 0x004E4942))
        f.write(bin_)
    return os.path.getsize(out)


def run(mid, view=None):
    parts, s, cfg, leaf_file = bake(mid)
    allP = np.concatenate([d['T'].reshape(-1, 3) for d in parts.values() if len(d['T'])])
    lo, hi = allP.min(0), allP.max(0)
    tris = {p: int(len(d['T'])) for p, d in parts.items()}
    extras = {'realModel': 1, 'id': mid, 'credit': cfg['credit'], 'license': 'CC BY 4.0',
              'changes': cfg.get('changes', 'textures replaced by one colour per triangle (no lettering or logos survive), interior and ground removed, scaled and turned to the game\'s axes'),
              'size': [round(float(x), 3) for x in hi - lo], 'triangles': int(sum(tris.values()))}
    pv = pivots(parts, cfg)
    if pv:
        extras['pivots'] = pv
    if cfg.get('notes'):
        extras['notes'] = cfg['notes']
    size = write(mid, parts, cfg, leaf_file, extras)
    lsz = os.path.getsize(os.path.join(OUT, leaf_file)) if leaf_file else 0
    print(f'{mid}: {sum(tris.values())} tris {tris}, {size / 1024:.0f} KB' + (f' + {leaf_file} {lsz / 1024:.0f} KB' if leaf_file else '') +
          f', size {np.round(hi - lo, 2)} (scale {s:.4g})' + (f', pivots {pv}' if pv else ''))
    if view:
        from view import sheet
        prims = []
        for p, d in parts.items():
            if not len(d['T']):
                continue
            # one prim per palette colour so the sheet shows the paint
            C = d['C'] if d['C'].ndim == 2 else d['C'][:, 0]
            uc, inv = np.unique(np.round(C, 3), axis=0, return_inverse=True)
            for i, c in enumerate(uc):
                m = inv.reshape(-1) == i
                T = d['T'][m]
                prims.append(dict(pos=T.reshape(-1, 3), idx=np.arange(len(T) * 3).reshape(-1, 3), mat=f'{p}:{i}'))
        cols = {}
        for p, d in parts.items():
            if not len(d['T']):
                continue
            C = d['C'] if d['C'].ndim == 2 else d['C'][:, 0]
            uc = np.unique(np.round(C, 3), axis=0)
            for i, c in enumerate(uc):
                srgb = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055)
                cols[f'{p}:{i}'] = tuple(np.clip(srgb * (np.array([0.45, 0.75, 0.35]) if (cfg.get('parts') or {}).get(p, {}).get('textured') else 1), 0, 1))
        sheet(prims, view, label=mid, colours=cols)


if __name__ == '__main__':
    args = sys.argv[1:]
    view = None
    if '--view' in args:
        k = args.index('--view')
        view = args[k + 1]
        args = args[:k] + args[k + 2:]
    for mid in (args or [k for k, v in SCENERY.items() if v.get('ship', True)]):
        run(mid, view.replace('%', mid) if view else None)
