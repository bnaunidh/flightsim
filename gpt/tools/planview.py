"""
Three-view drawings of the fleet, from tools/silhouette.mjs's triangles.

A general-arrangement drawing is what an aeroplane is judged by: plan, side
and front, all to one scale. The point is the OUTLINE — whether the planform
reads as the aircraft it is meant to be — so each view is a depth-sorted
painter's fill with a dark edge, not a render.

    python3 tools/planview.py <dir-of-json> <out.png> [--one <id>]
"""

import json, math, os, sys
from PIL import Image, ImageDraw, ImageFont

W = 620          # pixels per view
PAD = 8
LABEL = 18

VIEWS = [
    ("plan",  lambda p: (p[0], p[2]),  lambda p: -p[1]),   # from above, +y nearest
    ("side",  lambda p: (p[2], -p[1]), lambda p: -p[0]),
    ("front", lambda p: (p[0], -p[1]), lambda p: p[2]),
]

def draw_view(d, tris, ox, oy, w, h, proj, depth, name):
    xs, ys = [], []
    for t in tris:
        for p in t:
            u, v = proj(p); xs.append(u); ys.append(v)
    if not xs: return
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    sx = (w - 2 * PAD) / max(1e-6, x1 - x0)
    sy = (h - 2 * PAD) / max(1e-6, y1 - y0)
    s = min(sx, sy)
    cx = ox + w / 2 - (x0 + x1) / 2 * s
    cy = oy + h / 2 - (y0 + y1) / 2 * s

    order = sorted(range(len(tris)), key=lambda i: depth(tris[i][0]) + depth(tris[i][1]) + depth(tris[i][2]))
    for i in order:
        t = tris[i]
        pts = [(cx + proj(p)[0] * s, cy + proj(p)[1] * s) for p in t]
        # Flat shade off the triangle's own normal, so edges and curvature read.
        ax, ay, az = t[0]; bx, by, bz = t[1]; ccx, ccy, cz = t[2]
        ux, uy, uz = bx-ax, by-ay, bz-az
        vx, vy, vz = ccx-ax, ccy-ay, cz-az
        nx, ny, nz = uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
        L = math.sqrt(nx*nx+ny*ny+nz*nz) or 1
        lit = abs(nx*0.35 + ny*0.86 + nz*0.37) / L
        g = int(46 + 165 * lit)
        d.polygon(pts, fill=(g, g, min(255, g + 12)), outline=(24, 26, 32))
    d.text((ox + 6, oy + h - 15), name, fill=(150, 156, 168))
    # A scale bar, so "huge span" is a number and not a feeling.
    m = 5.0
    d.line([(ox + w - PAD - m * s, oy + h - 10), (ox + w - PAD, oy + h - 10)], fill=(190, 195, 205), width=2)
    d.text((ox + w - PAD - m * s, oy + h - 26), "5 m", fill=(150, 156, 168))

def sheet(models, out):
    rows = len(models)
    H = int(W * 0.62)
    img = Image.new("RGB", (W * 3, (H + LABEL) * rows), (16, 18, 24))
    d = ImageDraw.Draw(img)
    for r, m in enumerate(models):
        oy = r * (H + LABEL)
        d.rectangle([0, oy + H, W * 3, oy + H + LABEL], fill=(10, 11, 15))
        span = max(p[0] for t in m["tris"] for p in t) - min(p[0] for t in m["tris"] for p in t)
        length = max(p[2] for t in m["tris"] for p in t) - min(p[2] for t in m["tris"] for p in t)
        d.text((6, oy + H + 4), f'{m["id"]}  {m["name"]}   span {span:.1f} m · length {length:.1f} m · {len(m["tris"])} tris',
               fill=(205, 210, 220))
        for c, (name, proj, depth) in enumerate(VIEWS):
            draw_view(d, m["tris"], c * W, oy, W, H, proj, depth, name)
    img.save(out)
    print(f"{out} — {len(models)} aircraft")

if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    only = sys.argv[sys.argv.index("--one") + 1] if "--one" in sys.argv else None
    files = sorted(f for f in os.listdir(src) if f.endswith(".json"))
    models = []
    for f in files:
        m = json.load(open(os.path.join(src, f)))
        if only and m["id"] != only: continue
        models.append(m)
    sheet(models, out)
