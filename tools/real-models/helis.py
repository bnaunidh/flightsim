"""
The real helicopters: the UH-60, CH-47, AH-64 and (as Marine One) the AW101,
from CC BY 4.0 downloads, as files the game wears over its own helicopters
(src/aircraft/real-models.js wearRealHeli). Credits: in-game Credits screen
and assets/models/LICENSES.md.

  python3 tools/real-models/helis.py [id ...]           -> assets/models/real/<id>.glb
  python3 tools/real-models/helis.py <id> --view /tmp/x.png

What it does to each download (gltfio.py reads model and image data only):
  1. leaves out the source's own rotors -- the game keeps spinning its own
     (civil-build.js addRotor: blades, blur disc, spool-up), moved onto the
     real model's mast and tail-rotor hub; the hubs' places go in the file;
  2. turns it to the game's axes and scales it uniformly to the type's real
     length (extra/helis.js HELI_GEOMETRY), the main hub on the game's hub
     (fore and aft) and the wheels on the flight model's contact points;
  3. paints it one colour per triangle from its own texture, then REPAINTS
     that in the game's colour for the type (its shading kept as the ratio to
     the airframe's own main colour, the blacks kept black): no image ships,
     so no national insignia, serial or unit marking survives; the glazing
     (by its material, or by its blue in the texture) is its own part;
  4. Marine One: dark green with the white top, as the game's own VH-3D;
  5. surface detail, as the airliners have (detail.py): ambient occlusion
     baked in Blender from the shape alone, and the game's OWN panel seams,
     frame rivet rows and lap joints drawn over the airframe -- a normal and a
     roughness map on one fresh atlas (TEXCOORD_2), packed KTX2 + meshopt.
     Geometry only goes into the bake; no source image is read for it, so no
     insignia can come back that way. `--plain` writes the old flat file.
"""
import os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gltfio import flatten  # noqa: E402
from models import INBOX  # noqa: E402
from scenery import axes_matrix, match, material_texture, material_factor, sample, srgb_to_linear, palette, write  # noqa: E402
import scenery  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'models', 'real')
SF = 'https://sketchfab.com/3d-models/'


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


# Game numbers (src/aircraft/extra/helis.js HELI_GEOMETRY and heliShape's contacts), shape units = metres.
HELIS = {
    'uh60': dict(
        src='uh60/uh60.glb', axes='-x,y,-z',
        credit='"US Army UH-60M Black Hawk low poly model" by Yi Tsung Lee (@WTigerTw), CC BY 4.0, ' + SF + '854bf0feee5b42dc92ac5329976f7942',
        rotorNodes=['Object_10'], tailNodes=['Object_4'],
        length=15.8, hubZ=-1.3, ground=-1.8, paint='#3e4a3a', glassHue=False,
    ),
    'ch47': dict(
        src='ch47/ch47.glb', axes='x,y,z',
        credit='"Helicopter Low Poly - Chinook CH-47" by Machine Meza (@maurib98), CC BY 4.0, ' + SF + '72b5123bda964e9aa5343384734977e2',
        rotorNodes=['Plane.003_0'], aftRotorNodes=['Plane.002_0'],
        length=15.9, hubZ=-3.4, ground=-1.9, paint='#4a5a42', glassHue=True,
    ),
    'ah64': dict(
        src='ah64/ah64.glb', axes='-x,y,-z',
        credit='"AH-64 Apache Attack Helicopter Low Poly" by A Certain Duck (@TheOminousDuck), CC BY 4.0, ' + SF + '34986214decd4b3db90e91f12e624d78',
        rotorNodes=['Object_10', 'Object_11'], tailNodes=['Object_35', 'Object_37', 'Object_39'],
        glassMats=['Material.001'],
        length=15.5, hubZ=-0.65, ground=-1.9, paint='#4b5248', glassHue=True,
    ),
    # Marine One: the game's VH-3D (a Sea King) worn as this AW101 Merlin, the stand-in the owner
    # picked (BATCH-3.md). Its rotor blades share materials with the airframe: they go by shape
    # (thin, flat, up at the disc and off the mast), the tail rotor by its box beside the fin.
    'vh3d': dict(
        src='aw101/aw101.glb', axes='x,y,z',
        credit='"Agusta Westland Merlin AW101" by CloudHubOmniTeam (@cloudhub), CC BY 4.0, ' + SF + '10ce28cff53d40d5b7feb9a017a02806',
        # everything up at the disc forward of the tail (z < -16,000) is rotor; over the tail, the
        # blade lying aft is the flat part of it short of the fin (z < -9,600); the tail rotor is the
        # thin disc of blades in the plane x 25,560-25,770, left of the pylon
        rotorRule=dict(y=(11000, 15600), finZ=-16000, aftBladeZ=-9600, flat=0.6, hub=(27800, -39300), hubR=2600, hubAbove=9200),
        tailBox=((25560, 9000, -16000), (25770, 20000, -5000)),
        # 'ROYAL AIR FORCE' and the serial, modelled as letters on the boom and the fin: left out
        dropPieces=[((25300, 7700, -24000), (29300, 8600, -14000), 2200), ((25600, 7900, -9300), (27900, 10900, -8200), 2200)],
        glassMats=['merlin_glass__sp1'], dropMats=['merlin_instrumen1'],
        # the roundels and markings modelled as geometry: painted as the airframe round them
        plainMats=['Color_I11', 'Color_A21', 'Color_E01', 'Color_F16', 'White'],
        cluster=0.055,
        length=16.7, hubZ=-1.1, ground=-1.75, paint='#22352a', top='#f1f1ec', glassHue=False,
    ),
}


def bake(mid):
    cfg = HELIS[mid]
    path = os.path.join(INBOX, cfg['src'])
    prims, j, bufs = flatten(path)
    R = axes_matrix(cfg['axes'])
    T, N, C, part, hubs = [], [], [], [], {'main': [], 'aft': [], 'tail': [], 'head': [], 'blade': []}
    for p in prims:
        if match(p['mat'], cfg.get('dropMats')):
            continue
        pos = p['pos'] @ R.T
        idx = p['idx'] if np.linalg.det(R) > 0 else p['idx'][:, [0, 2, 1]]
        tri = pos[idx]
        if match(p['node'], cfg.get('rotorNodes')):
            hubs['main'].append(tri.reshape(-1, 3))
            continue
        if match(p['node'], cfg.get('aftRotorNodes')):
            hubs['aft'].append(tri.reshape(-1, 3))
            continue
        if match(p['node'], cfg.get('tailNodes')):
            hubs['tail'].append(tri.reshape(-1, 3))
            continue
        nrm = (p['nrm'] @ R.T)[idx] if p['nrm'] is not None else None
        fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
        if nrm is None:
            nrm = np.repeat(fn[:, None, :], 3, axis=1)
        keep = np.ones(len(tri), bool)
        c = tri.mean(1)
        if cfg.get('dropPieces'):
            from process import components
            lab = components(p['pos'], idx)
            sv = p['pos'][idx]
            ul, inv = np.unique(lab, return_inverse=True)
            plo = np.full((len(ul), 3), 1e18)
            phi = np.full((len(ul), 3), -1e18)
            np.minimum.at(plo, inv, sv.min(1))
            np.maximum.at(phi, inv, sv.max(1))
            for lo_, hi_, mx in cfg['dropPieces']:
                inside = np.all(plo >= np.array(lo_), 1) & np.all(phi <= np.array(hi_), 1) & ((phi - plo).max(1) < mx)
                keep &= ~inside[inv]
        rr = cfg.get('rotorRule')
        if rr:
            # (source units, after the turn)
            src_c = p['pos'][idx].mean(1)
            sfn = np.cross(p['pos'][idx][:, 1] - p['pos'][idx][:, 0], p['pos'][idx][:, 2] - p['pos'][idx][:, 0])
            sfn /= np.maximum(np.linalg.norm(sfn, axis=1, keepdims=True), 1e-12)
            up = (src_c[:, 1] > rr['y'][0]) & (src_c[:, 1] < rr['y'][1])
            flat = np.abs(sfn[:, 1]) > rr['flat']
            blade = up & ((src_c[:, 2] < rr['finZ']) | (flat & (src_c[:, 2] < rr['aftBladeZ'])))
            d = np.hypot(src_c[:, 0] - rr['hub'][0], src_c[:, 2] - rr['hub'][1])
            head = (d < rr['hubR']) & (src_c[:, 1] > rr['hubAbove'])
            tb = np.zeros(len(tri), bool)
            if cfg.get('tailBox'):
                lo_, hi_ = np.array(cfg['tailBox'][0]), np.array(cfg['tailBox'][1])
                tb = np.all((src_c >= lo_) & (src_c <= hi_), axis=1)
                if tb.any():
                    hubs['tail'].append(tri[tb].reshape(-1, 3))
            blade &= ~tb
            if head.any():
                hubs['head'].append(tri[head].reshape(-1, 3))
            if blade.any():
                hubs['blade'].append(tri[blade].reshape(-1, 3))
            keep &= ~(blade | head | tb)
        tri, nrm = tri[keep], nrm[keep]
        img = material_texture(j, bufs, path, p['matIndex']) if p['uv'] is not None else None
        if img is not None:
            uv = p['uv'][idx][keep]
            pts = np.concatenate([uv, uv.mean(1, keepdims=True)], 1)
            col = sample(img, pts).mean(1) * material_factor(j, p['matIndex'])[None]
        else:
            col = np.tile(material_factor(j, p['matIndex']), (len(tri), 1))
        if match(p['mat'], cfg.get('plainMats')):
            col[:] = np.nan  # painted as the airframe round it (below)
        pr = np.array(['glass' if match(p['mat'], cfg.get('glassMats')) else 'body'] * len(tri), dtype=object)
        T.append(tri), N.append(nrm), C.append(col), part.append(pr)
    T, N, C, part = np.concatenate(T), np.concatenate(N), np.concatenate(C), np.concatenate(part)
    # glazing by its colour: a clear blue among the greys
    if cfg.get('glassHue'):
        mx, mn = C.max(1), C.min(1)
        sat = (mx - mn) / np.maximum(mx, 1e-6)
        part[(C[:, 2] > C[:, 0] + 0.08) & (sat > 0.25)] = 'glass'
    # fit: uniform to the real length (the fuselage, rotors out), hub over the game's hub, wheels on the ground
    P = T.reshape(-1, 3)
    lo, hi = P.min(0), P.max(0)
    s = cfg['length'] / (hi[2] - lo[2])
    hub = (lo + hi) / 2
    if hubs['main']:
        # the rotor's own node: in the middle of its blades, at the height they sweep (their median)
        hm = np.concatenate(hubs['main'])
        hub = np.array([(hm[:, 0].min() + hm[:, 0].max()) / 2, np.median(hm[:, 1]), (hm[:, 2].min() + hm[:, 2].max()) / 2])
    elif hubs['blade']:
        hb = np.concatenate(hubs['blade'])
        hh = np.concatenate(hubs['head']) if hubs['head'] else hb
        hub = np.array([np.median(hh[:, 0]), np.median(hb[:, 1]), np.median(hh[:, 2])])
        hubs['main'] = [hub[None]]
    xc = (lo[0] + hi[0]) / 2
    off = np.array([-xc * s, cfg['ground'] - lo[1] * s, cfg['hubZ'] - hub[2] * s])
    T = T * s + off
    fit = lambda v: (np.asarray(v) * s + off)
    out_hubs = {}
    if hubs['main']:
        out_hubs['main'] = fit(hub)
    if hubs['aft']:
        ha = np.concatenate(hubs['aft'])
        out_hubs['aft'] = fit([(ha[:, 0].min() + ha[:, 0].max()) / 2, ha[:, 1].min(), (ha[:, 2].min() + ha[:, 2].max()) / 2])
    if hubs['tail']:
        ht = np.concatenate(hubs['tail'])
        out_hubs['tail'] = fit(np.median(ht, 0) if cfg.get('rotorRule') else (ht.min(0) + ht.max(0)) / 2)
    # weld small detail (vertex clustering), as scenery.py: every corner to its cell's mean
    if cfg.get('cluster'):
        P = T.reshape(-1, 3)
        key = np.floor(P / cfg['cluster']).astype(np.int64)
        _, inv = np.unique(key, axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        cnt = np.bincount(inv)
        Pc = np.stack([np.bincount(inv, P[:, k]) / cnt for k in range(3)], 1)
        J = inv.reshape(-1, 3)
        ok = (J[:, 0] != J[:, 1]) & (J[:, 1] != J[:, 2]) & (J[:, 0] != J[:, 2])
        _, first = np.unique(np.sort(J[ok], 1), axis=0, return_index=True)
        sel = np.flatnonzero(ok)[np.sort(first)]
        T, N, C, part = Pc[J[sel]], N[sel], C[sel], part[sel]
    # paint: one colour per triangle, the game's colour with the texture's shading
    plain = np.isnan(C).any(1)
    C = np.where(plain[:, None], 0.5, C)
    L = C @ np.array([0.2126, 0.7152, 0.0722])
    body = part == 'body'
    lin = srgb_to_linear(C)
    Ll = lin @ np.array([0.2126, 0.7152, 0.0722])
    tri_area = np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1)
    # the airframe's main colour: the area-weighted median luminance of the body
    order = np.argsort(Ll[body])
    cum = np.cumsum(tri_area[body][order])
    ref = Ll[body][order][np.searchsorted(cum, cum[-1] / 2)] if body.any() else 0.2
    k = np.clip(Ll / max(ref, 1e-4), 0.0, 1.8)
    k[plain] = 1.0
    target = srgb_to_linear(hexrgb(cfg['paint']))
    col = np.where((k < 0.4)[:, None], srgb_to_linear(np.array([0.09, 0.095, 0.1])) * np.clip(k / 0.4, 0.5, 1.0)[:, None], target[None] * np.clip(k, 0.55, 1.5)[:, None])
    if cfg.get('top'):
        # Marine One: white above the cabin's waist, as the game's VH-3D (and the real one) wear it
        cy = T.mean(1)[:, 1]
        waist = cfg['ground'] + (T[:, :, 1].max() - cfg['ground']) * 0.43
        col = np.where(((cy > waist) & (k >= 0.4))[:, None], srgb_to_linear(hexrgb(cfg['top']))[None] * np.clip(k, 0.8, 1.1)[:, None], col)
    glass = part == 'glass'
    col[glass] = srgb_to_linear(np.array([0.11, 0.16, 0.2]))
    col[body] = palette(col[body], 8)
    parts = {}
    for name in ('body', 'glass'):
        m = part == name
        if m.any():
            parts[name] = dict(T=T[m], N=N[m], C=col[m], UV=None)
    return parts, out_hubs, s


# Detail (owner, 2026-11-11: "the same baked AO + panel detail as the airliners"): a 1024 atlas
# for a 16 m machine is the airliners' texel density; seams at helicopter spacing (frames ~1 m,
# rivet rows half that), from 1.2 m behind the nose to 0.6 m short of the tail, lap joints level
# at a third and seven-tenths of the body's height. The drawn maps
# go out at 512 (the AO stays 1024): a 1024 UASTC normal map alone tripled the file.
HELI_DETAIL = dict(mapSize=512, bakeAO=dict(size=1024, samples=192, distance=1.2, floor=0.26),
                   surface=dict(radome=1.2, tailCone=0.6, splice=1.02, lapHeights=[0.32, 0.7], strength=1.2, panelVar=0.1))


def shrink(png, size, normal=False):
    """A drawn map at `size` px (the download: a 1024 UASTC normal map alone was 700 KB)."""
    import io
    from PIL import Image
    im = Image.open(io.BytesIO(png)).convert('RGB').resize((size, size), Image.LANCZOS)
    a = np.asarray(im, dtype=np.float64) / 255.0
    if normal:
        n = a * 2 - 1
        n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
        a = n * 0.5 + 0.5
    b = io.BytesIO()
    Image.fromarray(np.round(a * 255).astype(np.uint8), 'RGB').save(b, 'PNG', optimize=True)
    return b.getvalue()


def weld(d):
    """A part's triangles (T, per-corner N, per-triangle C) as indexed vertices: P, N, C, I."""
    P = d['T'].reshape(-1, 3)
    N = d['N'].reshape(-1, 3)
    C = np.repeat(d['C'], 3, axis=0) if d['C'].ndim == 2 else d['C'].reshape(-1, 3)
    key = np.concatenate([np.round(P / 1e-4).astype(np.int64), np.clip(np.round(N * 127), -127, 127).astype(np.int64),
                          np.round(C * 255).astype(np.int64)], 1)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return P[first], N[first], C[first], inv.reshape(-1, 3)


def run_detail(mid, parts, extras, rules):
    """The file with baked AO and the game's panel detail (detail.py), packed."""
    import detail as D
    from process import write_glb_detail
    opts = HELIS[mid].get('detail', HELI_DETAIL)
    prims = []
    for role, d in parts.items():
        P, N, C, I = weld(d)
        prims.append(dict(role=role, P=P, N=N, C=C, I=I, UV1=None, maps={}))
    bo = opts['bakeAO']
    print(f'    baking AO ({bo["size"]} px, {bo["samples"]} samples) in Blender...')
    prims, raw_png, ao_png, geo = D.bake_ao(prims, mid, bo, geo=True)
    nrm_png, mr_png, info = D.surface_maps(geo, opts.get('surface', {}))
    if opts.get('mapSize'):
        nrm_png, mr_png = shrink(nrm_png, opts['mapSize'], True), shrink(mr_png, opts['mapSize'])
    images = [(f'{mid}_ao_baked', ao_png, 'image/png'), (f'{mid}_surface_normal', nrm_png, 'image/png'), (f'{mid}_surface_rough', mr_png, 'image/png')]
    clamp = {'wrapS': 33071, 'wrapT': 33071}
    for p in prims:
        p['maps'] = {'occlusion': dict(img=0, texCoord=2, strength=1.0, sampler=clamp)}
        if p['role'] == 'body':
            p['maps']['normal'] = dict(img=1, texCoord=2, scale=1.0, sampler=clamp)
            p['maps']['mr'] = dict(img=2, texCoord=2, sampler=clamp)
    extras = dict(extras, detail=sorted({k for p in prims for k in p['maps']}),
                  changes=extras['changes'] + '; ambient occlusion baked from the shape and the game\'s own panel seams drawn (detail.py)')
    raw = os.path.join(D.LOGDIR, f'{mid}-raw.glb')
    os.makedirs(D.LOGDIR, exist_ok=True)
    raw_size = write_glb_detail(raw, mid, prims, images, extras, prefix='rs_', rules=rules)
    path = os.path.join(OUT, f'{mid}.glb')
    size = D.pack(raw, path, set(extras['detail']))
    D.write_log(mid, {'id': mid, 'source': HELIS[mid]['src'], 'kept': [], 'dropped': ['every source texture (helis.py paints per triangle)'],
                      'baked': {'occlusion': f'{bo["size"]} px, from the airframe\'s shape only (Blender Cycles AO, {bo["samples"]} samples, {bo["distance"]} m)'},
                      'drawn': {'normal + roughness': 'the game\'s own panel seams, frame rivet rows and lap joints (detail.py surface_maps)', **info},
                      'bytes': {'raw (PNG, float)': raw_size, 'packed (KTX2 + meshopt)': size}, 'triangles': extras['triangles']})
    D.contact_sheet(mid, [(f'{mid} baked AO', ao_png), (f'{mid} drawn normal', nrm_png), (f'{mid} drawn roughness', mr_png)],
                    os.path.join(D.LOGDIR, f'{mid}-maps.png'))
    return size


def run(mid, view=None, plain=False):
    cfg = HELIS[mid]
    parts, hubs, s = bake(mid)
    allP = np.concatenate([d['T'].reshape(-1, 3) for d in parts.values()])
    lo, hi = allP.min(0), allP.max(0)
    tris = {p: int(len(d['T'])) for p, d in parts.items()}
    extras = {'realModel': 1, 'id': mid, 'credit': cfg['credit'], 'license': 'CC BY 4.0',
              'changes': 'repainted in the game\'s colours (every texture removed: one colour per triangle, so no insignia, serial or unit marking), the rotors removed (the game spins its own), scaled to the real length and fitted to the game\'s helicopter',
              'length': round(float(hi[2] - lo[2]), 3), 'triangles': int(sum(tris.values())),
              'hubs': {k: [round(float(x), 3) for x in v] for k, v in hubs.items()}}
    scenery.OUT = OUT
    rules = {'body': dict(rough=0.62, metal=0.15), 'glass': dict(rough=0.08, metal=0.4)}
    size = write(mid, parts, {'parts': rules}, None, extras) if plain else run_detail(mid, parts, extras, rules)
    print(f'{mid}: {sum(tris.values())} tris {tris}, {size / 1024:.0f} KB, length {hi[2] - lo[2]:.2f} (real {cfg["length"]}), '
          f'x {lo[0]:.2f}..{hi[0]:.2f} y {lo[1]:.2f}..{hi[1]:.2f} z {lo[2]:.2f}..{hi[2]:.2f}, hubs {extras["hubs"]} (scale {s:.4g})')
    if view:
        from view import sheet
        prims, cols = [], {}
        for p, d in parts.items():
            uc, inv = np.unique(np.round(d['C'], 3), axis=0, return_inverse=True)
            for i, c in enumerate(uc):
                m = inv.reshape(-1) == i
                prims.append(dict(pos=d['T'][m].reshape(-1, 3), idx=np.arange(m.sum() * 3).reshape(-1, 3), mat=f'{p}:{i}'))
                cols[f'{p}:{i}'] = tuple(np.clip(np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055), 0, 1))
        sheet(prims, view, label=mid, colours=cols)


if __name__ == '__main__':
    args = sys.argv[1:]
    view = None
    plain = '--plain' in args
    args = [a for a in args if a != '--plain']
    if '--view' in args:
        k = args.index('--view')
        view = args[k + 1]
        args = args[:k] + args[k + 2:]
    for mid in (args or list(HELIS)):
        run(mid, view.replace('%', mid) if view else None, plain)
