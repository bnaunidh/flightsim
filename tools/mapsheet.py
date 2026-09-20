"""
A contact sheet of every map, so the set can be looked at in one go.

Same argument as tools/blender_terrain.py and the same input: the grids from
tools/heightfield.mjs. Blender gives you an orbit; this gives you all
thirty-two on one page in about a second, which is what you want when the
question is "which of these is wrong" rather than "what exactly is wrong with
this one".

Shaded relief, because a hillshade is the thing that makes a paper map legible:
you can see which way the ground falls. Over it, everything the map claims is
there — the runway, the roads, the pads, the harbour and its buoyage, the
drying shoals, the named places, the lighthouse, the town.

    python3 tools/mapsheet.py <dir-of-json> <out.png> [--one <mapId>]
"""

import json
import math
import os
import sys
from PIL import Image, ImageDraw, ImageFont

TILE = 340          # pixels per map on the sheet
PAD = 10
LABEL = 20

# Deep water through snow. The bands are the ones the game's own palette uses.
def shade(y, lo, hi):
    if y < -12:
        return (14, 34, 66)
    if y < -1.5:
        return (26, 78, 120)
    if y < 1.5:
        return (176, 164, 116)
    if y < 60:
        return (58, 108, 52)
    if y < 180:
        return (84, 104, 62)
    if y < 320:
        return (110, 98, 88)
    return (222, 228, 236)


def render(d, size=TILE):
    n = d['n']
    hs = d['heights']
    b = d['bounds']
    img = Image.new('RGB', (n, n))
    px = img.load()
    for j in range(n):
        for i in range(n):
            y = hs[j * n + i]
            r, g, bl = shade(y, d['min'], d['max'])
            # Hillshade: the slope towards a light in the north-west. This is
            # the whole reason the picture reads as landform and not as a blob.
            if y > 0:
                e = hs[j * n + min(n - 1, i + 1)] - hs[j * n + max(0, i - 1)]
                s = hs[min(n - 1, j + 1) * n + i] - hs[max(0, j - 1) * n + i]
                k = 1.0 + max(-0.55, min(0.55, (e + s) / 90.0))
                r, g, bl = int(r * k), int(g * k), int(bl * k)
            px[i, j] = (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, bl)))
    img = img.resize((size, size), Image.LANCZOS)

    dr = ImageDraw.Draw(img)
    sx = size / (b['x1'] - b['x0'])
    sz = size / (b['z1'] - b['z0'])
    def P(x, z):
        return ((x - b['x0']) * sx, (z - b['z0']) * sz)

    for r in d.get('roads', []):
        pts = [P(p[0], p[1]) for p in r['path']]
        if len(pts) > 1:
            dr.line(pts, fill=(28, 28, 30), width=3)
            dr.line(pts, fill=(210, 205, 195), width=1)

    rw = d.get('runway')
    if rw:
        a = math.radians(rw.get('headingDeg', 90))
        half = rw['length'] / 2
        dr.line([P(rw['cx'] - math.sin(a) * half, rw['cz'] + math.cos(a) * half),
                 P(rw['cx'] + math.sin(a) * half, rw['cz'] - math.cos(a) * half)],
                fill=(255, 255, 255), width=3)

    for s in d.get('shoals', []):
        x, z = P(s['x'], s['z'])
        rr = max(2, s['r'] * sx)
        dr.ellipse([x - rr, z - rr, x + rr, z + rr], outline=(240, 150, 40), width=1)

    for m in d.get('marks', []):
        x, z = P(m[0], m[1])
        c = (220, 60, 45) if m[2] == 'port' else (50, 190, 90)
        dr.ellipse([x - 2, z - 2, x + 2, z + 2], fill=c)

    h = d.get('harbour')
    if h:
        x, z = P(h['berth'][0], h['berth'][1])
        dr.ellipse([x - 4, z - 4, x + 4, z + 4], fill=(60, 235, 165))
        x, z = P(h['mouth'][0], h['mouth'][1])
        dr.ellipse([x - 3, z - 3, x + 3, z + 3], fill=(70, 170, 235))

    for p in d.get('pads', []):
        x, z = P(p['x'], p['z'])
        c = (255, 80, 60) if p.get('role') == 'hospital' else (250, 215, 60)
        dr.rectangle([x - 3, z - 3, x + 3, z + 3], fill=c)

    for p in d.get('places', []):
        x, z = P(p['x'], p['z'])
        dr.ellipse([x - 3, z - 3, x + 3, z + 3], fill=(225, 130, 245))

    sc = d.get('scenery') or {}
    if sc.get('lighthouse'):
        x, z = P(sc['lighthouse'][0], sc['lighthouse'][1])
        dr.line([x - 5, z, x + 5, z], fill=(255, 245, 120), width=2)
        dr.line([x, z - 5, x, z + 5], fill=(255, 245, 120), width=2)
    if sc.get('town'):
        x, z = P(sc['town']['cx'], sc['town']['cz'])
        rr = max(3, sc['town']['radius'] * sx)
        dr.ellipse([x - rr, z - rr, x + rr, z + rr], outline=(150, 195, 255), width=2)

    return img


def main():
    src = sys.argv[1]
    out = sys.argv[2]
    only = None
    if '--one' in sys.argv:
        only = sys.argv[sys.argv.index('--one') + 1]

    files = sorted(f for f in os.listdir(src) if f.endswith('.json'))
    if only:
        files = [f for f in files if f[:-5] == only]
    maps = []
    for f in files:
        with open(os.path.join(src, f)) as fh:
            maps.append(json.load(fh))

    cols = 1 if only else min(6, len(maps))
    rows = (len(maps) + cols - 1) // cols
    size = 900 if only else TILE
    W = cols * (size + PAD) + PAD
    H = rows * (size + PAD + LABEL) + PAD
    sheet = Image.new('RGB', (W, H), (16, 18, 22))
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 13)
    except Exception:
        font = ImageFont.load_default()

    for k, d in enumerate(maps):
        c, r = k % cols, k // cols
        x = PAD + c * (size + PAD)
        y = PAD + r * (size + PAD + LABEL)
        sheet.paste(render(d, size), (x, y))
        dr.text((x + 2, y + size + 3),
                '%s  %s  %s..%s m' % (d['id'], d.get('game', ''), d['min'], d['max']),
                fill=(200, 210, 225), font=font)

    sheet.save(out)
    print('%s — %d maps, %dx%d' % (out, len(maps), W, H))


if __name__ == '__main__':
    main()
