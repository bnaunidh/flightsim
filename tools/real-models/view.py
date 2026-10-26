"""Orthographic preview sheet of a model (side / top / front), painter's algorithm,
coloured by material (or by 'role' when given a processed file). For checking
orientation and part roles by eye; nothing here ships.
  python3 view.py model.glb out.png [axisperm]"""
import sys, colorsys, hashlib
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, sys.argv[0].rsplit('/', 1)[0])
from gltfio import flatten


def colour(name):
    h = int(hashlib.md5(name.encode()).hexdigest()[:6], 16)
    r, g, b = colorsys.hsv_to_rgb((h % 360) / 360, 0.55, 0.95)
    return np.array([r, g, b])


def sheet(prims, out, W=900, label=None, colours=None):
    P = np.concatenate([p['pos'] for p in prims])
    lo, hi = P.min(0), P.max(0)
    views = [('side x', 2, 1, 0), ('top y', 2, 0, 1), ('front z', 0, 1, 2)]
    ext = hi - lo
    s = (W / 2 - 20) / max(ext[2], ext[0])
    hs = [ext[1] * s, ext[0] * s, ext[1] * s]
    H = int(hs[0] + hs[1] + 60)
    img = Image.new('RGB', (W, H), (235, 238, 242))
    d = ImageDraw.Draw(img)
    L = np.array([0.4, 0.8, 0.45]); L /= np.linalg.norm(L)
    oy = 10
    for vi, (nm, ax, ay, az) in enumerate(views):
        ox = 10 if vi < 2 else W // 2 + 10
        if vi == 2:
            oy2 = 10
        tri = []
        for p in prims:
            v = p['pos'][p['idx']]
            n = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
            n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
            sh = 0.35 + 0.65 * np.abs(n @ L)
            c = (colours or {}).get(p['mat'])
            c = np.array(c) if c is not None else colour(p['mat'])
            depth = v[:, :, az].mean(1) * (1 if vi != 1 else 1)
            for k in range(len(v)):
                tri.append((depth[k], v[k], c * sh[k]))
        tri.sort(key=lambda t: t[0])
        base_y = oy if vi < 2 else 10
        if vi == 1:
            base_y = int(10 + hs[0] + 30)
        for _, v, c in tri:
            xs = (v[:, ax] - lo[ax]) * s + ox
            if vi == 1:
                ys = (v[:, ay] - lo[ay]) * s + base_y
            else:
                ys = (hi[ay] - v[:, ay]) * s + base_y
            d.polygon(list(zip(xs, ys)), fill=tuple((np.clip(c, 0, 1) * 255).astype(int)))
        d.text((ox, base_y - 10 if vi else 0), nm, fill=(0, 0, 0))
    if label:
        d.text((W // 2 + 10, H - 40), label, fill=(0, 0, 0))
    # legend
    y = int(10 + hs[2] + 20)
    seen = []
    for p in prims:
        if p['mat'] not in seen:
            seen.append(p['mat'])
    for m in seen[:24]:
        c = (colours or {}).get(m)
        c = np.array(c) if c is not None else colour(m)
        d.rectangle([W // 2 + 10, y, W // 2 + 22, y + 10], fill=tuple((c * 255).astype(int)))
        d.text((W // 2 + 28, y), m[:30], fill=(0, 0, 0))
        y += 13
        if y > H - 50:
            break
    img.save(out)


if __name__ == '__main__':
    prims, j, _ = flatten(sys.argv[1])
    perm = sys.argv[3] if len(sys.argv) > 3 else None
    if perm:  # e.g. "x,y,-z" -> new axes from old
        for p in prims:
            cols = []
            for t in perm.split(','):
                sgn = -1 if t.startswith('-') else 1
                cols.append(sgn * p['pos'][:, 'xyz'.index(t[-1])])
            p['pos'] = np.stack(cols, 1)
    sheet(prims, sys.argv[2])
