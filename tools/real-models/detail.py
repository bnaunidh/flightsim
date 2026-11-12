"""
Surface detail for the real models: what of a source's maps the game may keep,
and an ambient-occlusion map baked from the model's own shape where the source
has none.

A real model's paint is the game's own parody livery (fleet/extra/real-paint.js
maps it at run time). What made the planes look like plastic was everything
ELSE the source's textures carried -- panel seams, rivets, the grime in the
gaps, the shade where the wing meets the body -- going with them. This puts
the part that carries no livery back:

  kept     normalTexture, metallicRoughnessTexture, occlusionTexture, each on
           its own UVs (TEXCOORD_1 in the output), when check_map() finds no
           lettering or emblem embossed in it.
  dropped  baseColorTexture (the real airline's and maker's paint: never
           shipped), emissiveTexture (lit-up names and logos), anything in a
           KHR_materials_pbrSpecularGlossiness or other extension, and any
           map check_map() flags.
  baked    `detail: {'bakeAO': ...}` in models.py: occlusion baked in Blender
           from the processed airframe (bake_ao_blender.py), on a fresh atlas
           of its own (TEXCOORD_2). Shape only -- it cannot carry a livery.
  drawn    `detail: {'surface': ...}`: the game's OWN major splices, two
           straight lap joints, spar and hinge lines and the faintest gloss
           variation and seam grime, drawn by surface_maps() from where each
           texel of the atlas is on the airframe -- a normal map and a
           roughness map on the same atlas. Ours, generic to the type, no
           lettering anywhere. Hairline and shallow on purpose (v81.2, the
           owner: wide soft grooves, wobbling lap joints, frame-rivet ripple
           and a panel-by-panel gloss read as "swollen, wrinkly wet hands").

Every decision is written to tools/real-models/detail-log/<id>.json, and a
contact sheet of every kept or baked map to detail-log/<id>-maps.png, so a
person can look at what ships.

Compression (pack()): KTX2 -- UASTC for normal maps, ETC1S for the rest --
and meshopt, by gltf-transform and KTX-Software's toktx (paths from
GLTF_TRANSFORM / KTX_BIN, defaults under .claude/devtools/gltf).
"""
import hashlib, io, json, os, subprocess, sys, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
LOGDIR = os.path.join(HERE, 'detail-log')
BLENDER = os.environ.get('BLENDER', '/Applications/Blender.app/Contents/MacOS/Blender')
# The tools live outside the repo (.claude/ is ignored); the main checkout's copy serves every worktree.
_DEV = os.path.join(ROOT.split('/.claude/worktrees/')[0], '.claude', 'devtools', 'gltf')
GLTF_TRANSFORM = os.environ.get('GLTF_TRANSFORM', os.path.join(_DEV, 'node_modules', '.bin', 'gltf-transform'))
KTX_BIN = os.environ.get('KTX_BIN', os.path.join(_DEV, 'ktx', 'bin'))
KTX_LIB = os.environ.get('KTX_LIB', os.path.join(_DEV, 'ktx', 'lib'))

KEEP = {'normal': 'normalTexture', 'mr': 'metallicRoughnessTexture', 'occlusion': 'occlusionTexture'}


def _image_bytes(j, bufs, img_index):
    im = j['images'][img_index]
    if 'bufferView' not in im:
        raise ValueError('image with a uri: only embedded images are read')
    bv = j['bufferViews'][im['bufferView']]
    b = bufs[bv.get('buffer', 0)]
    o = bv.get('byteOffset', 0)
    return bytes(b[o:o + bv['byteLength']]), im.get('mimeType', 'image/png')


def source_maps(j, bufs, mi, approved=(), review=None):
    """The maps of source material `mi` the game may keep, and what was dropped and why.
    -> (kept {kind: {data, mime, texCoord, scale|strength, sampler}}, dropped [(slot, why)])"""
    kept, dropped = {}, []
    if mi is None:
        return kept, dropped
    m = j['materials'][mi]
    pbr = m.get('pbrMetallicRoughness', {})
    if 'baseColorTexture' in pbr:
        dropped.append(('baseColorTexture', 'the paint itself: real airline/maker livery, never shipped'))
    if 'emissiveTexture' in m:
        dropped.append(('emissiveTexture', 'lit lettering and logos'))
    for e in (m.get('extensions') or {}):
        dropped.append((e, 'material extension: its textures are not read'))
    slots = {'normal': m.get('normalTexture'), 'mr': pbr.get('metallicRoughnessTexture'), 'occlusion': m.get('occlusionTexture')}
    for kind, ref in slots.items():
        if not ref:
            continue
        tex = j['textures'][ref['index']]
        src = tex.get('source')
        if src is None:
            dropped.append((KEEP[kind], 'texture with no plain image source'))
            continue
        if (ref.get('extensions') or {}).get('KHR_texture_transform'):
            dropped.append((KEEP[kind], 'uses KHR_texture_transform, which the game does not read'))
            continue
        data, mime = _image_bytes(j, bufs, src)
        ok, why = check_map(kind, data)
        if not ok:
            dropped.append((KEEP[kind], why))
            continue
        # The check is a first filter, not the judge (it passed the F-35B's map with "WJ32" and a logo
        # in its corner): a source map ships only once a person has looked at it and listed it.
        if digest(data) not in set(approved):
            dropped.append((KEEP[kind], f'{digest(data)}: not yet approved by a person (detail-log contact sheet; models.py approvedMaps)'))
            if review is not None:
                review.append((f'NOT SHIPPED, needs OK: {kind} {digest(data)}', data))
            continue
        samp = j.get('samplers', [{}])[tex['sampler']] if 'sampler' in tex else {}
        kept[kind] = dict(data=data, mime=mime, texCoord=ref.get('texCoord', 0), sampler=samp,
                          scale=ref.get('scale', 1.0), strength=ref.get('strength', 1.0), image=src)
    return kept, dropped


def check_map(kind, data):
    """Is there lettering or an emblem in this map? (ok, why)

    A normal map of a liveried airliner can carry the airline's name in
    relief, a roughness map the logo's gloss. Lettering is many small blobs of
    strong detail, of one height, standing in rows; panel seams and rivets are
    long thin lines and regular dots. This flags a map with a run of 6+ blobs
    of matching height, their tops level, side by side -- a word -- and leaves
    the final word to whoever looks at the contact sheet (detail-log)."""
    from PIL import Image
    im = Image.open(io.BytesIO(data))
    im.thumbnail((1024, 1024))
    a = np.asarray(im.convert('RGB'), dtype=np.float32) / 255.0
    if kind == 'normal':
        d = np.hypot(a[..., 0] - 0.5, a[..., 1] - 0.5)  # tilt from flat
    else:
        g = a[..., 1] if kind == 'mr' else a[..., 0]
        k = 7
        pad = np.pad(g, k, mode='edge')
        c = np.cumsum(np.cumsum(pad, 0), 1)
        box = (c[2 * k:, 2 * k:] - c[:-2 * k, 2 * k:] - c[2 * k:, :-2 * k] + c[:-2 * k, :-2 * k]) / (2 * k) ** 2
        d = np.abs(g - box[:g.shape[0], :g.shape[1]])  # local contrast
    thr = max(0.08, float(np.percentile(d, 99)) * 0.6)
    mask = d > thr
    lab = _label(mask)
    if lab.max() == 0:
        return True, 'flat'
    ys, xs = np.nonzero(lab)
    ids = lab[ys, xs]
    n = lab.max()
    y0 = np.full(n + 1, 1e9); y1 = np.zeros(n + 1); x0 = np.full(n + 1, 1e9); x1 = np.zeros(n + 1)
    np.minimum.at(y0, ids, ys); np.maximum.at(y1, ids, ys); np.minimum.at(x0, ids, xs); np.maximum.at(x1, ids, xs)
    h = (y1 - y0 + 1)[1:]; w = (x1 - x0 + 1)[1:]; top = y0[1:]; left = x0[1:]
    glyph = (h >= 6) & (h <= 80) & (w >= 2) & (w <= h * 1.4)
    gi = np.nonzero(glyph)[0]
    order = gi[np.argsort(left[gi])]
    best = 0
    for i in order:
        same = order[(np.abs(top[order] - top[i]) <= 0.15 * h[i]) & (np.abs(h[order] - h[i]) <= 0.2 * h[i])
                     & (left[order] >= left[i]) & (left[order] <= left[i] + h[i] * 8)]
        best = max(best, len(same))
    if best >= 6:
        return False, f'looks like lettering: {best} glyph-sized marks in a row'
    return True, f'no lettering found ({best} in a row at most)'


def _label(mask):
    """4-connected components, numpy only (no scipy here)."""
    H, W = mask.shape
    lab = np.zeros((H, W), np.int32)
    parent = [0]
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    nxt = 1
    for y in range(H):
        row = mask[y]
        if not row.any():
            continue
        for x in np.nonzero(row)[0]:
            up = lab[y - 1, x] if y else 0
            lf = lab[y, x - 1] if x else 0
            if up and lf:
                a, b = find(up), find(lf)
                lab[y, x] = min(a, b)
                if a != b:
                    parent[max(a, b)] = min(a, b)
            elif up or lf:
                lab[y, x] = find(up or lf)
            else:
                parent.append(nxt)
                lab[y, x] = nxt
                nxt += 1
    if nxt == 1:
        return lab
    roots = np.array([find(i) for i in range(nxt)])
    _, dense = np.unique(roots, return_inverse=True)
    return dense[lab]


ROLE_ID = {'skin_l': 1, 'skin_r': 1, 'wing': 2, 'fin': 3, 'cowl': 4}


def bake_ao(prims, mid, opts, geo=False):
    """Bake ambient occlusion over every primitive at once, in Blender, on one fresh atlas.

    prims: [{P, N, I, ...}] in the game's axes. Adds UV2 (per vertex; vertices split on the atlas's
    seams, every other array carried along) and returns the AO image as PNG bytes."""
    size = int(opts.get('size', 2048))
    # Degenerate triangles (a corner repeated: the 747 has some) draw nothing, and they stalled
    # Blender's unwrap for 10+ minutes: out before the bake.
    prims = [dict(p, I=p['I'][(p['I'][:, 0] != p['I'][:, 1]) & (p['I'][:, 1] != p['I'][:, 2]) & (p['I'][:, 0] != p['I'][:, 2])]) for p in prims]
    prims = [p for p in prims if len(p['I'])]
    tmp = tempfile.mkdtemp(prefix=f'bake-{mid}-')
    src = os.path.join(tmp, 'in.npz')
    arrs = {'n': np.array(len(prims))}
    for k, p in enumerate(prims):
        arrs[f'p{k}_P'] = p['P'].astype(np.float64)
        arrs[f'p{k}_N'] = p['N'].astype(np.float64)
        arrs[f'p{k}_I'] = p['I'].astype(np.int64)
    np.savez(src, **arrs)
    png = os.path.join(tmp, 'ao.png')
    uvs = os.path.join(tmp, 'uv.npz')
    cmd = [BLENDER, '-b', '--factory-startup', '--python', os.path.join(HERE, 'bake_ao_blender.py'), '--',
           src, png, uvs, str(size), str(opts.get('samples', 256)), str(opts.get('distance', 3.0)),
           str(opts.get('margin', 0.004))]
    geo_path = os.path.join(tmp, 'geo.npz') if geo else ''
    if geo:
        cmd += [geo_path, ','.join(str(ROLE_ID.get(p['role'], 9)) for p in prims)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(png):
        sys.stderr.write(r.stdout[-4000:] + r.stderr[-4000:])
        raise RuntimeError('the AO bake failed')
    d = np.load(uvs)
    out = []
    for k, p in enumerate(prims):
        cu = d[f'p{k}_UV'].reshape(-1, 3, 2)  # per corner
        I = p['I']
        key = np.concatenate([I.reshape(-1, 1), np.round(cu.reshape(-1, 2) * 65536).astype(np.int64)], 1)
        _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
        src_v = I.reshape(-1)[first]
        q = dict(p)
        for a in ('P', 'N', 'UV1'):
            if q.get(a) is not None:
                q[a] = p[a][src_v]
        q['UV2'] = cu.reshape(-1, 2)[first]
        q['I'] = inv.reshape(-1, 3)
        out.append(q)
    data = open(png, 'rb').read()
    g = dict(np.load(geo_path)) if geo else None
    return out, data, finish_ao(data, opts), g


def finish_ao(data, opts):
    """The baked AO, lifted so open skin is white and only the deep corners go dark
    (`floor`: the darkest it may go), and its edges grown into the empty atlas
    so a mip level never mixes a seam with black."""
    from PIL import Image, ImageFilter
    im = Image.open(io.BytesIO(data)).convert('L')
    a = np.asarray(im, dtype=np.float32) / 255.0
    floor = float(opts.get('floor', 0.25))
    a = floor + (1 - floor) * np.clip(a, 0, 1) ** float(opts.get('gamma', 1.0))
    out = Image.fromarray(np.round(a * 255).astype(np.uint8), 'L')
    if opts.get('blur'):
        out = out.filter(ImageFilter.GaussianBlur(float(opts['blur'])))
    b = io.BytesIO()
    out.save(b, 'PNG', optimize=True)
    return b.getvalue()


def _dilate(a, valid, n):
    """Grow `a` from the valid texels into the rest, n steps (the atlas's margins and gaps)."""
    a = a.copy(); v = valid.copy()
    for _ in range(n):
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sh = np.roll(np.roll(a, dy, 0), dx, 1); sv = np.roll(np.roll(v, dy, 0), dx, 1)
            take = sv & ~v
            a[take] = sh[take]
            v = v | take
    return a


def _hash(*ks):
    h = np.zeros_like(ks[0], dtype=np.int64)
    for k in ks:
        h = (h * 1000003) ^ (k.astype(np.int64) * 2654435761)
    return ((h >> 7) & 0xFFFF) / 65535.0


def _bands(x, lo, hi, step):
    """Distance to the nearest of the lines lo, lo+step, ... (<= hi), and which band x is in."""
    k = np.clip(np.round((x - lo) / step), 0, max(0, np.floor((hi - lo) / step)))
    return np.abs(x - (lo + k * step)), np.floor((x - lo) / step)


def _chord(x, z, sel, bin_m=0.1):
    """Fraction along the chord (0 at the leading edge, 1 at the trailing) of each selected texel,
    from the leading and trailing edges measured per span bin."""
    f = np.full(x.shape, np.nan)
    if not sel.any():
        return f
    b = np.floor(np.abs(x[sel]) / bin_m).astype(np.int64)
    zs = z[sel]
    n = b.max() + 1
    le = np.full(n, np.inf); te = np.full(n, -np.inf)
    np.minimum.at(le, b, zs); np.maximum.at(te, b, zs)
    ch = np.maximum(te[b] - le[b], 1e-3)
    f[sel] = (zs - le[b]) / ch
    return f


def surface_maps(geo, opts):
    """The game's own surface detail for a processed airliner, drawn per texel of the bake atlas:
    -> (normal PNG bytes, roughness/metal PNG bytes). Generic stations, not the type's real drawing."""
    from PIL import Image
    P, N, role, mask = geo['pos'].astype(np.float64), geo['nrm'].astype(np.float64), geo['role'].astype(np.int64), geo['mask']
    H_, W_ = role.shape
    role = _dilate(np.where(mask, role, 0), mask, 6)
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    skin = role == 1
    # texel size on the airframe (m). A seam is a hairline: about a texel wide, no more (v81.2, the
    # owner: wide soft grooves read as "swollen, wrinkly wet hands", not as metal skin with joints).
    dx = np.linalg.norm(P[:, 1:] - P[:, :-1], axis=-1)[mask[:, 1:] & mask[:, :-1]]
    texel = float(np.median(dx)) if dx.size else 0.02
    sig = max(float(opts.get('seam', 0.006)), texel * 0.55)
    g = lambda d, s=sig: np.exp(-(d / s) ** 2)
    height = np.zeros((H_, W_))
    grime = np.zeros((H_, W_))
    panel = np.zeros((H_, W_))
    # -- fuselage: circumferential splices, faint frame rivet rows, longitudinal lap joints --
    if skin.any():
        zn, zt = z[skin].min(), z[skin].max()
        zb = np.floor((z - zn) / 0.25).astype(np.int64).clip(0, None)
        nb = zb[skin].max() + 1
        top = np.full(nb, -np.inf); bot = np.full(nb, np.inf)
        np.maximum.at(top, zb[skin], y[skin]); np.minimum.at(bot, zb[skin], y[skin])
        # the fuselage's centre line: ONE straight line fitted through the cabin's slices (a centre
        # followed slice by slice, even smoothed, wobbled -- and every lap joint wobbled with it).
        mid = (top + bot) / 2
        ok = np.isfinite(mid)
        zc = (np.arange(nb) + 0.5) * 0.25 + zn
        z0, z1 = zn + float(opts.get('radome', 2.4)), zt - float(opts.get('tailCone', 3.0))
        cab = ok & (zc > z0 + 0.15 * (z1 - z0)) & (zc < z1 - 0.15 * (z1 - z0))
        if cab.sum() < 2:
            cab = ok
        a1, a0 = np.polyfit(zc[cab], mid[cab], 1) if cab.sum() >= 2 else (0.0, float(np.nanmean(mid[ok])))
        yc = a0 + a1 * z
        th = np.degrees(np.arctan2(x, y - yc))
        r = np.hypot(x, y - yc)
        body = skin & (z > z0 - 0.05) & (z < z1)
        # the major circumferential splices only (no frame rivet rows: they rippled the whole skin)
        d, band = _bands(z, z0, z1, float(opts.get('splice', 5.08)))
        height -= np.where(skin & (z > z0 - 0.3) & (z < z1 + 0.3), 0.5 * g(d), 0)
        # and a couple of long lap joints, straight down the cabin
        laps = np.array(opts.get('laps', [36, 108]), float)
        dth = np.min(np.abs(np.abs(th)[..., None] - laps), -1)
        dl = np.radians(dth) * r
        height -= np.where(body, 0.4 * g(dl), 0)
        lapband = np.searchsorted(laps, np.abs(th)) * np.sign(th)
        panel = np.where(skin, _hash(band, lapband), panel)
        grime += np.where(body, g(d, sig * 2.5) + 0.6 * g(dl, sig * 2.5), 0)
    # -- wings and tailplanes: spar and hinge lines along the span, chordwise panel joints --
    wing = role == 2
    if wing.any():
        zmax = z[wing].max(); zmin = z[wing].min()
        split = zmax - 0.32 * (zmax - zmin)
        for sel, spars, step, root in ((wing & (z < split), opts.get('wingSpars', [0.12, 0.73]), 3.3, 2.2),
                                       (wing & (z >= split), opts.get('tailSpars', [0.66]), 2.4, 0.6)):
            if not sel.any():
                continue
            f = _chord(x, z, sel)
            ch = np.zeros_like(x)
            b = np.floor(np.abs(x) / 0.1).astype(np.int64)
            for sp in spars:
                dsp = np.abs(f - sp)
                # chord length per texel, for a distance in metres
                cl = np.zeros_like(x)
                zs = z[sel]; bb = b[sel]; n = bb.max() + 1
                le = np.full(n, np.inf); te = np.full(n, -np.inf)
                np.minimum.at(le, bb, zs); np.maximum.at(te, bb, zs)
                cl[sel] = (te - le)[bb]
                dm = np.nan_to_num(dsp * cl, nan=9)
                w = 0.5 if sp >= 0.6 else 0.35
                height -= np.where(sel, w * g(dm), 0)
                grime += np.where(sel, g(dm, sig * 2.5), 0)
                ch = np.maximum(ch, np.where(sel, (f > sp).astype(float), 0))
            ds, sb = _bands(np.abs(x), root, np.abs(x[sel]).max(), step)
            height -= np.where(sel & (np.abs(x) > root - 0.2), 0.3 * g(ds), 0)
            panel = np.where(sel, _hash(sb, np.round(ch * 3)), panel)
    # -- the fin: spar lines up its height, joints across it --
    fin = role == 3
    if fin.any():
        f = np.full(x.shape, np.nan)
        b = np.floor((y - y[fin].min()) / 0.1).astype(np.int64)
        zs = z[fin]; bb = b[fin]; n = bb.max() + 1
        le = np.full(n, np.inf); te = np.full(n, -np.inf)
        np.minimum.at(le, bb, zs); np.maximum.at(te, bb, zs)
        cl = np.maximum((te - le)[bb], 1e-3)
        f[fin] = (zs - le[bb]) / cl
        # the rudder's hinge line and a joint every couple of metres up (a 0.9 m grid read as a quilt)
        for sp in opts.get('finSpars', [0.66]):
            dm = np.zeros_like(x); dm[fin] = np.abs(f[fin] - sp) * cl
            height -= np.where(fin, 0.5 * g(dm), 0)
        ds, sb = _bands(y, y[fin].min() + 0.6, y[fin].max(), float(opts.get('finStep', 2.4)))
        height -= np.where(fin, 0.3 * g(ds), 0)
        panel = np.where(fin, _hash(sb, (f > 0.66).astype(np.int64)), panel)
    # -- engine cowls: the inlet joint and the fan cowl / reverser split --
    cowl = role == 4
    if cowl.any():
        for side in (-1, 1):
            sel = cowl & (np.sign(x) == side)
            if not sel.any():
                continue
            zf, za = z[sel].min(), z[sel].max()
            for fr in opts.get('cowlJoints', [0.2, 0.52]):
                dm = np.abs(z - (zf + fr * (za - zf)))
                height -= np.where(sel, 0.5 * g(dm), 0)
                grime += np.where(sel, g(dm, sig * 2.5), 0)
            panel = np.where(sel, _hash(np.floor((z - zf) / max(za - zf, 1e-3) * 2.0).astype(np.int64) + side), panel)
    # normal map: the height's slope across the atlas (rows run down = +v; glTF's +Y is up the image)
    k = float(opts.get('strength', 0.7))
    hx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) / 2
    hy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) / 2
    n = np.stack([-k * hx, k * hy, np.ones_like(height)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    nimg = np.round((n * 0.5 + 0.5) * 255).astype(np.uint8)
    # roughness (G): ~0.85 of the material's own (real-detail.js divides it back out), each panel a
    # shade apart, the seams a little rougher; metal (B) left to the material
    # (one even gloss: a panel-by-panel checkerboard of it made patches look puffy)
    rough = float(opts.get('roughBase', 0.85)) + (panel - 0.5) * float(opts.get('panelVar', 0.02)) + np.clip(grime, 0, 1) * float(opts.get('grime', 0.03))
    rough = np.where(role > 0, np.clip(rough, 0.5, 1.0), float(opts.get('roughBase', 0.85)))
    mr = np.stack([np.full_like(rough, 1.0), rough, np.full_like(rough, 1.0)], -1)
    mimg = np.round(mr * 255).astype(np.uint8)
    out = []
    for arr in (nimg, mimg):
        b_ = io.BytesIO()
        Image.fromarray(arr, 'RGB').save(b_, 'PNG', optimize=True)
        out.append(b_.getvalue())
    return out[0], out[1], {'texel m': round(texel, 4), 'seam sigma m': round(sig, 4)}


def contact_sheet(mid, maps, path):
    """Every kept or baked map side by side, for a person to look at."""
    from PIL import Image, ImageDraw
    tiles = []
    for name, data in maps:
        im = Image.open(io.BytesIO(data)).convert('RGB')
        im.thumbnail((768, 768))
        t = Image.new('RGB', (780, 800), (255, 255, 255))
        t.paste(im, (6, 26))
        ImageDraw.Draw(t).text((8, 6), name, fill=(0, 0, 0))
        tiles.append(t)
    if not tiles:
        return None
    sheet = Image.new('RGB', (780 * len(tiles), 800), (255, 255, 255))
    for i, t in enumerate(tiles):
        sheet.paste(t, (780 * i, 0))
    sheet.save(path)
    return path


def digest(data):
    return hashlib.sha1(data).hexdigest()[:12]


def pack(raw, out, has):
    """raw .glb -> out .glb: KTX2 (UASTC normal maps, ETC1S the rest) + meshopt."""
    env = dict(os.environ)
    env['PATH'] = KTX_BIN + ':' + '/opt/homebrew/bin:' + env.get('PATH', '')
    env['DYLD_LIBRARY_PATH'] = KTX_LIB
    tmp = tempfile.mkdtemp(prefix='pack-')
    cur = raw
    def step(args, name):
        nonlocal cur
        nxt = os.path.join(tmp, name)
        r = subprocess.run([GLTF_TRANSFORM] + args[:1] + [cur, nxt] + args[1:], capture_output=True, text=True, env=env)
        if r.returncode != 0:
            sys.stderr.write(r.stdout[-3000:] + r.stderr[-3000:])
            raise RuntimeError(f'gltf-transform {args[0]} failed')
        cur = nxt
    if 'normal' in has:
        step(['uastc', '--slots', 'normalTexture', '--level', '2', '--rdo', '--zstd', '18'], 'a.glb')
    if has - {'normal'}:
        step(['etc1s', '--slots', '{occlusionTexture,metallicRoughnessTexture}', '--quality', '160'], 'b.glb')
    step(['meshopt', '--level', 'medium'], 'c.glb')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(cur, 'rb') as f, open(out, 'wb') as g:
        g.write(f.read())
    return os.path.getsize(out)


def write_log(mid, entry):
    os.makedirs(LOGDIR, exist_ok=True)
    with open(os.path.join(LOGDIR, f'{mid}.json'), 'w') as f:
        json.dump(entry, f, indent=1, sort_keys=True)
