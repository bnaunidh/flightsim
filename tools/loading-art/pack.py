#!/usr/bin/env python3
"""Pack the loading-screen renders into assets/loading/<map>.jpg.

capture.mjs saves one big render per map (1920x1080, near lossless). This
shrinks each to 1600x900, gives it a light grade (the same for every map, so
they read as a set: a soft bloom round the bright sky, a gentle S-curve, a
little colour, a vignette), and writes a progressive, optimised JPEG at the
best quality that still fits the size budget (250 KB is the limit the owner's
brief set; 215 KB is aimed for so a re-render does not tip over it).

    python3 tools/loading-art/pack.py <renders-dir> [--out assets/loading] [--width 1600] [--budget 215] [--no-grade]

Uses Pillow (already on the Mac). Reads <map>.png or <map>.jpg, writes
<map>.jpg, prints one line per map. Nothing is downloaded, nothing is sent.
"""
import argparse
import io
import os
import sys

import numpy as np
from PIL import Image, ImageFilter


def grade(img):
    """The look every picture shares. Input and output are RGB PIL images."""
    w, h = img.size
    x = np.asarray(img, dtype=np.float32) / 255.0
    # Bloom: the brightest parts (the sun, its glitter, lit cloud) glow a little into what is round them.
    lum = x @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    hi = np.clip((lum - 0.74) / 0.26, 0, 1)[..., None] * x
    glow = Image.fromarray((np.clip(hi, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(w * 0.012))
    g = np.asarray(glow, dtype=np.float32) / 255.0
    x = 1 - (1 - x) * (1 - 0.42 * g)
    # A gentle S-curve for contrast.
    t = x * x * (3 - 2 * x)
    x = x * 0.68 + t * 0.32
    # A little more colour.
    m = x.mean(axis=2, keepdims=True)
    x = np.clip(m + (x - m) * 1.08, 0, 1)
    # Vignette: the corners 20% darker.
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
    x = x * (1 - 0.20 * np.clip(r, 0, 1)[..., None] ** 2.2)
    out = Image.fromarray((np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8))
    return out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=35, threshold=2))


def encode(img, quality):
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=quality, optimize=True, progressive=True, subsampling='4:2:0')
    return buf.getvalue()


def pack(path, width, budget_kb, do_grade=True, lo=52, hi=90):
    img = Image.open(path).convert('RGB')
    w, h = img.size
    height = round(width * 9 / 16)
    if (w, h) != (width, height):
        img = img.resize((width, height), Image.LANCZOS)
    if do_grade:
        img = grade(img)
    best = None
    # Highest quality whose file fits the budget.
    while lo <= hi:
        mid = (lo + hi) // 2
        data = encode(img, mid)
        if len(data) <= budget_kb * 1024:
            best = (mid, data)
            lo = mid + 1
        else:
            hi = mid - 1
    if best is None:
        best = (52, encode(img, 52))
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--out', default='assets/loading')
    ap.add_argument('--width', type=int, default=1600)
    ap.add_argument('--budget', type=int, default=215)
    ap.add_argument('--only', default='')
    ap.add_argument('--no-grade', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    want = set(x for x in a.only.split(',') if x)
    names = sorted(f for f in os.listdir(a.src) if f.lower().endswith(('.png', '.jpg')))
    total = 0
    over = []
    for f in names:
        mid = os.path.splitext(f)[0]
        if want and mid not in want:
            continue
        q, data = pack(os.path.join(a.src, f), a.width, a.budget, not a.no_grade)
        out = os.path.join(a.out, mid + '.jpg')
        with open(out, 'wb') as fh:
            fh.write(data)
        total += len(data)
        if len(data) > 250 * 1024:
            over.append(mid)
        print(f'{mid:14s} q{q:<3d} {len(data) / 1024:6.1f} KB')
    print(f'{len(names)} files, {total / 1048576:.2f} MB')
    if over:
        print('OVER 250 KB:', ', '.join(over), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
