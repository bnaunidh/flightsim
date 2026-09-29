"""
SKYHOOK H-3 — light utility / search-and-rescue helicopter for Island Flight Simulator.

Built headless from an empty factory scene, every time:

  "/Applications/Blender.app/Contents/MacOS/Blender" --background --factory-startup \
      --python build.py

Writes skyhook.blend and skyhook.glb next to this file.

Axes (Blender): +Y = nose, +Z = up, +X = right (starboard). Real metres, full size.
The glTF export (+Y up) turns that into the game's -Z forward / +Y up / +X right.
Root empty "skyhook" sits at the game's aircraft origin (the physics body origin).

How the main surfaces are made
------------------------------
The pod (cabin + tail boom) and the engine cowling are lofted parametric surfaces:
cross-sections (super-ellipses whose size / exponent / height are driven by
monotone-cubic splines along the length) sampled into a Constrained Delaunay
triangulation of the unrolled (length, arc-length) domain.  Window outlines,
the frit band round each window, the door seams, the livery stripes and the
SKYHOOK lettering are constraint polygons in that domain, so every colour and
glass edge is a real mesh edge (crisp at any distance, nothing floats on the
skin, nothing z-fights) and every vertex gets the analytic surface normal
(no pinching, no faceting in the highlights).
Hard-surface parts use bmesh + Bevel (harden normals) / Subdivision / Screw.
"""
import bpy, bmesh, math, os, sys, bisect, time
from math import sin, cos, pi, sqrt, atan2, radians, copysign
from mathutils import Vector, Matrix, Euler, Quaternion, geometry
from functools import lru_cache

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_BLEND = os.path.join(HERE, 'skyhook.blend')
OUT_GLB = os.path.join(HERE, 'skyhook.glb')
T0 = time.time()

def log(*a):
    print('[skyhook %6.1fs]' % (time.time() - T0), *a, flush=True)

# ----------------------------------------------------------------------------
# Game fit numbers (derived from src/aircraft/types.js + physics.js + model.js)
# game (x, y, z) -> Blender (x, -z, y);  shape.scale = 1.25 applies to all of these
# ----------------------------------------------------------------------------
# types.js pointsFor() multiplies shape.main / shape.nose by shape.scale, model.js scales the
# whole drawn root by it, main.js scales shape.eye by it; physics rotorRadius is the raw
# propRadius (4.2, NOT scaled).  The skid underside is a 30 m rocker that passes through the
# main AND nose contact heights exactly, lowest at the main contact.
# In game the linear gear springs (k = 34000 / 26000 x gearStiffness 1.1 x mass/1100) settle
# about 9 cm (mains) / 13 cm (nose) into the ground at rest, i.e. ~3 deg nose-down: that is
# the physics' equilibrium, not a modelling offset.
S = 1.25
MAIN_CONTACT = Vector((1.15 * S, -0.55 * S, -1.35 * S))   # (1.4375, -0.6875, -1.6875)
NOSE_CONTACT = Vector((0.0, 1.0 * S, -1.3 * S))            # (0, 1.25, -1.625)
HUB = Vector((0.0, -0.1 * S, 1.6 * S))                     # (0, -0.125, 2.0)
ROTOR_R = 4.2                                               # physics rotorRadius (m, unscaled)
EYE = Vector((-0.22 * S, 0.9 * S, 0.4 * S))                # (-0.275, 1.125, 0.5)
TAIL_HARD = Vector((0.0, -3.95 * 1.15 * S, -0.12 * S))      # (0, -5.678, -0.15)
BELLY_HARD = Vector((0.0, -0.3 * S, -0.82 * S))            # (0, -0.375, -1.025)

# ----------------------------------------------------------------------------
# Scene / materials
# ----------------------------------------------------------------------------
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for x in list(c):
            c.remove(x)

def srgb2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def hexcol(h):
    h = h.lstrip('#')
    return tuple(srgb2lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))

MAT = {}

def make_mat(name, hx, rough, metal=0.0, emit=None, strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    col = hexcol(hx)
    b.inputs['Base Color'].default_value = (*col, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*hexcol(emit), 1.0)
        b.inputs['Emission Strength'].default_value = strength
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
        m.use_backface_culling = False
    m.diffuse_color = (*col, alpha)
    m.roughness = rough
    m.metallic = metal
    MAT[name] = m
    return m

def build_materials():
    make_mat('paint_main', '#2f4a63', 0.34, 0.0)        # deep blue composite, glossy
    make_mat('paint_accent', '#f0a020', 0.38, 0.0)      # amber
    make_mat('paint_white', '#e8ebee', 0.36, 0.0)       # lettering, hoist, tip bands
    make_mat('dark_trim', '#24282d', 0.55, 0.0)         # seams, frit, grilles, frames
    make_mat('glass', '#7f9db2', 0.05, 0.0, alpha=0.24)
    make_mat('metal', '#b8bdc4', 0.28, 0.9)             # bare metal: mast, lips, skids
    make_mat('rubber', '#131415', 0.9, 0.0)
    make_mat('blade', '#3a3f46', 0.45, 0.0)             # composite rotor blades
    make_mat('interior', '#4a525b', 0.85, 0.0)
    make_mat('screen', '#0c1620', 0.25, 0.0, emit='#3f8fc8', strength=0.9)
    make_mat('light_red', '#ff2a1c', 0.3, 0.0, emit='#ff2a1c', strength=4.0)
    make_mat('light_green', '#22ff55', 0.3, 0.0, emit='#22ff55', strength=4.0)
    make_mat('light_white', '#fff4dc', 0.2, 0.0, emit='#fff4dc', strength=5.0)
    make_mat('rotor_blur', '#1e2329', 0.6, 0.0, alpha=0.10)

# ----------------------------------------------------------------------------
# Small maths helpers
# ----------------------------------------------------------------------------
def pchip(xs, ys):
    """Monotone cubic (Fritsch-Carlson) interpolant. xs ascending."""
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0] = d[0]
    m[-1] = d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1 = 2 * h[i] + h[i - 1]
            w2 = h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        if x <= xs[0]:
            return ys[0] + m[0] * (x - xs[0])
        if x >= xs[-1]:
            return ys[-1] + m[-1] * (x - xs[-1])
        i = bisect.bisect_right(xs, x) - 1
        i = min(max(i, 0), n - 2)
        t = (x - xs[i]) / h[i]
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
                + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1])
    return f

def spow(v, e):
    return copysign(abs(v) ** e, v)

def lerp(a, b, t):
    return a + (b - a) * t

def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)

def catmull(points, per_seg=6, closed=False):
    """Centripetal-ish Catmull-Rom through Vector points (uniform param)."""
    P = [Vector(p) for p in points]
    out = []
    n = len(P)
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        p0 = P[(i - 1) % n] if (closed or i > 0) else P[i] * 2 - P[i + 1]
        p1 = P[i]
        p2 = P[(i + 1) % n]
        p3 = P[(i + 2) % n] if (closed or i + 2 < n) else P[(i + 1) % n] * 2 - P[i]
        for k in range(per_seg):
            t = k / per_seg
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(P[-1].copy())
    return out

# ----------------------------------------------------------------------------
# Parametric loft surface  S(Y, phi) = (x(Y,phi), Y, z(Y,phi))
# ----------------------------------------------------------------------------
class Surf:
    def __init__(self, sec, phi0, phi1, tips=(), N=240, poles=None):
        self.sec = sec          # sec(Y, phi) -> (x, z)
        self.phi0, self.phi1 = phi0, phi1
        self.tips = tips        # Y values where the section collapses (point or line)
        self.poles = tips if poles is None else poles   # tips that are single points
        self.N = N
        self._cache = {}

    def table(self, Y):
        # sections vary slowly except near a tip: share tables on a 2 mm grid elsewhere
        if any(abs(Y - tp) < 0.004 for tp in self.tips):
            key = ('e', round(Y, 6))
        elif any(abs(Y - tp) < 0.2 for tp in self.tips):
            key = ('f', round(Y / 0.00025))
            Y = key[1] * 0.00025
        else:
            key = ('q', round(Y / 0.002))
            Y = key[1] * 0.002
        t = self._cache.get(key)
        if t is None:
            N = self.N
            phis = [self.phi0 + (self.phi1 - self.phi0) * i / N for i in range(N + 1)]
            pts = [self.sec(Y, p) for p in phis]
            cum = [0.0]
            for i in range(N):
                dx = pts[i + 1][0] - pts[i][0]
                dz = pts[i + 1][1] - pts[i][1]
                cum.append(cum[-1] + sqrt(dx * dx + dz * dz))
            t = (phis, cum, pts)
            if len(self._cache) > 20000:
                self._cache.clear()
            self._cache[key] = t
        return t

    def length(self, Y):
        return self.table(Y)[1][-1]

    def phi_of_q(self, Y, q):
        phis, cum, _ = self.table(Y)
        L = cum[-1]
        if L < 1e-9:
            return phis[0]
        q = min(max(q, 0.0), L)
        i = bisect.bisect_right(cum, q) - 1
        i = min(max(i, 0), len(cum) - 2)
        seg = cum[i + 1] - cum[i]
        t = 0.0 if seg < 1e-12 else (q - cum[i]) / seg
        return phis[i] + (phis[i + 1] - phis[i]) * t

    def q_of_phi(self, Y, phi):
        phis, cum, _ = self.table(Y)
        f = (phi - self.phi0) / (self.phi1 - self.phi0) * self.N
        i = int(min(max(math.floor(f), 0), self.N - 1))
        t = f - i
        return cum[i] + (cum[i + 1] - cum[i]) * t

    def point(self, Y, phi):
        x, z = self.sec(Y, phi)
        return Vector((x, Y, z))

    def normal(self, Y, phi):
        for tip in self.tips:
            if tip not in self.poles and abs(Y - tip) < 2e-4:
                # a line tip (e.g. the cowl's prow): take the normal just inside it
                return self._normal(Y - 0.002 if tip > 0 else Y + 0.002, phi)
        for tip in self.poles:
            if abs(Y - tip) < 2e-4:
                # pole: average the ring just inside the tip
                inward = -0.004 if tip > 0 else 0.004
                acc = Vector()
                for k in range(24):
                    p = self.phi0 + (self.phi1 - self.phi0) * (k + 0.5) / 24
                    acc += self._normal(Y + (inward if Y >= tip else -inward) * 1.0, p)
                return acc.normalized()
        return self._normal(Y, phi)

    def _normal(self, Y, phi):
        dp = 1e-4
        dY = 1e-3
        a = self.point(Y, phi + dp) - self.point(Y, phi - dp)
        b = self.point(Y + dY, phi) - self.point(Y - dY, phi)
        n = b.cross(a)
        if n.length < 1e-12:
            return Vector((0, 1 if Y > 0 else -1, 0))
        return n.normalized()

    def pq(self, Y, q):
        return self.point(Y, self.phi_of_q(Y, q))

    def nq(self, Y, q):
        return self.normal(Y, self.phi_of_q(Y, q))

    def solve_phi(self, Y, fn, target, lo, hi):
        """phi in [lo, hi] with fn(sec(Y,phi)) == target, fn monotone on the interval."""
        flo = fn(self.sec(Y, lo)) - target
        fhi = fn(self.sec(Y, hi)) - target
        if flo * fhi > 0:
            return lo if abs(flo) < abs(fhi) else hi
        for _ in range(48):
            mid = 0.5 * (lo + hi)
            fm = fn(self.sec(Y, mid)) - target
            if (fm > 0) == (flo > 0):
                lo, flo = mid, fm
            else:
                hi = mid
        return 0.5 * (lo + hi)


def adaptive_qs(surf, Y, spacing, turn):
    """Arc-length positions round one section: denser where the section turns hardest,
    so shoulders and chines get the facets (silhouette, terminator) and flat sides don't."""
    phis, cum, pts = surf.table(Y)
    N = len(pts) - 1
    dirs = []
    for i in range(N):
        dx = pts[i + 1][0] - pts[i][0]; dz = pts[i + 1][1] - pts[i][1]
        dirs.append(atan2(dz, dx))
    cost = [0.0]
    for i in range(N):
        ds = cum[i + 1] - cum[i]
        if 0 < i:
            da = abs((dirs[i] - dirs[i - 1] + pi) % (2 * pi) - pi)
        else:
            da = 0.0
        cost.append(cost[-1] + ds / spacing + da / turn)
    C = cost[-1]
    n = max(4, int(round(C)))
    if n % 2:
        n += 1
    out = []
    for j in range(n + 1):
        c = C * j / n
        i = bisect.bisect_right(cost, c) - 1
        i = min(max(i, 0), N - 1)
        seg = cost[i + 1] - cost[i]
        t = 0.0 if seg < 1e-12 else (c - cost[i]) / seg
        out.append(cum[i] + (cum[i + 1] - cum[i]) * t)
    out[0] = 0.0
    out[-1] = cum[-1]
    return out

def triangulate_surface(surf, stations, spacing, zones, weld=True, LREF=6.0, turn=radians(11)):
    """
    Constrained Delaunay triangulation of the unrolled surface.
    Zones are given in the metric domain (Y, q) with q = arc length round the section.
    The CDT itself runs in the normalised domain (Y, q / L(Y) * LREF), which is a plain
    rectangle, so no constraint chord can ever leave the domain.
    zones: list of {kind, polys:[[(Y,q),...], ...], prio}; even-odd inside test per zone.
    Returns verts, normals, tris, tri_kind.
    """
    stations = sorted(stations)
    # Conformal ("Mercator") unrolling: u grows by LREF/L(Y) times the true surface distance
    # between sections, so domain cells keep their 3D aspect ratio and Delaunay does not
    # string slivers across closely spaced stations near a tip.
    Y0, Y1 = stations[0], stations[-1]
    NT = 1400
    ytab = [Y0 + (Y1 - Y0) * i / NT for i in range(NT + 1)]
    def mrate(Y):
        h = 1e-3
        Ya, Yb = max(Y - h, Y0), min(Y + h, Y1)
        acc = 0.0
        for k in range(8):
            ph = surf.phi0 + (surf.phi1 - surf.phi0) * (k + 0.5) / 8
            acc += (surf.point(Yb, ph) - surf.point(Ya, ph)).length / (Yb - Ya)
        return acc / 8
    integ = [LREF / max(surf.length(Y), 0.03) * mrate(Y) for Y in ytab]
    us = [0.0]
    for i in range(NT):
        us.append(us[-1] + 0.5 * (integ[i] + integ[i + 1]) * (ytab[i + 1] - ytab[i]))
    def U(Y):
        f = (Y - Y0) / (Y1 - Y0) * NT
        i = int(min(max(math.floor(f), 0), NT - 1))
        return us[i] + (us[i + 1] - us[i]) * (f - i)
    def Yof(u):
        i = bisect.bisect_right(us, u) - 1
        i = min(max(i, 0), NT - 1)
        seg = us[i + 1] - us[i]
        t = 0.0 if seg < 1e-12 else (u - us[i]) / seg
        return ytab[i] + (ytab[i + 1] - ytab[i]) * t
    def norm(Y, q):
        L = surf.length(Y)
        return (U(Y), 0.0 if L < 1e-9 else q / L * LREF)
    V2, VM = [], []          # normalised coords, metric coords
    rows = []
    for Y in stations:
        L = surf.length(Y)
        if L < 1e-6:
            rows.append([len(V2)])
            V2.append((U(Y), 0.0)); VM.append((Y, 0.0))
            continue
        qs = adaptive_qs(surf, Y, spacing(Y), turn)
        row = []
        for q in qs:
            row.append(len(V2))
            V2.append((U(Y), q / L * LREF)); VM.append((Y, q))
        rows.append(row)
    bnd = [r[0] for r in rows]
    for i in reversed([r[-1] for r in rows]):
        if i not in bnd:
            bnd.append(i)
    tail = rows[0]
    if len(tail) > 2:
        bnd += list(reversed(tail[1:-1]))
    bset = set(bnd)
    interior = [i for r in rows for i in r if i not in bset]

    zone_polys, segs = [], []
    for zi, z in enumerate(zones):
        for poly in z['polys']:
            pn = [norm(Y, q) for (Y, q) in poly]
            if signed_area(pn) < 0:
                pn = list(reversed(pn)); poly = list(reversed(poly))
            idx = []
            for p, pm in zip(pn, poly):
                idx.append(len(V2))
                V2.append(p); VM.append(pm)
            zone_polys.append((zi, idx))
            for i in range(len(poly)):
                segs.append((poly[i], poly[(i + 1) % len(poly)]))

    drop = set()
    if segs:
        cell = 0.25
        buckets = {}
        for (a, b) in segs:
            x0, x1 = sorted((a[0], b[0])); y0, y1 = sorted((a[1], b[1]))
            for gx in range(int(math.floor(x0 / cell)), int(math.floor(x1 / cell)) + 1):
                for gy in range(int(math.floor(y0 / cell)), int(math.floor(y1 / cell)) + 1):
                    buckets.setdefault((gx, gy), []).append((a, b))
        for i in interior:
            Y, q = VM[i]
            lim2 = (0.45 * spacing(Y)) ** 2
            gx, gy = int(math.floor(Y / cell)), int(math.floor(q / cell))
            hit = False
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for (a, b) in buckets.get((gx + dx, gy + dy), ()):
                        vx, vy = b[0] - a[0], b[1] - a[1]
                        L2 = vx * vx + vy * vy
                        t = 0.0 if L2 < 1e-14 else max(0.0, min(1.0, ((Y - a[0]) * vx + (q - a[1]) * vy) / L2))
                        px, py = a[0] + vx * t - Y, a[1] + vy * t - q
                        if px * px + py * py < lim2:
                            hit = True; break
                    if hit: break
                if hit: break
            if hit:
                drop.add(i)

    remap, V2c = {}, []
    for i, p in enumerate(V2):
        if i in drop:
            continue
        remap[i] = len(V2c)
        V2c.append(Vector(p))
    faces_in = [[remap[i] for i in bnd]] + [[remap[i] for i in idx] for (zi, idx) in zone_polys]
    vo, eo, fo, ov, oe, of = geometry.delaunay_2d_cdt(V2c, [], faces_in, 0, 1e-7)

    # Region classification: flood-fill triangles between constraint edges, then test one
    # point per region against every zone polygon (even-odd). Robust to overlapping zones.
    cons = set()
    for ei, e in enumerate(eo):
        if oe[ei]:
            cons.add((min(e), max(e)))
    tri_list = []
    for fi, f in enumerate(fo):
        for k in range(1, len(f) - 1):
            tri_list.append((f[0], f[k], f[k + 1]))
    edge_tris = {}
    for ti, t in enumerate(tri_list):
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            edge_tris.setdefault((min(a, b), max(a, b)), []).append(ti)
    region = [-1] * len(tri_list)
    nreg = 0
    for s in range(len(tri_list)):
        if region[s] >= 0:
            continue
        stack = [s]
        region[s] = nreg
        while stack:
            ti = stack.pop()
            t = tri_list[ti]
            for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                key = (min(a, b), max(a, b))
                if key in cons:
                    continue
                for tj in edge_tris[key]:
                    if region[tj] < 0:
                        region[tj] = nreg
                        stack.append(tj)
        nreg += 1
    zpolys = []   # (zone index, normalised polygon, bbox)
    for (zi, idx) in zone_polys:
        pts = [V2[i] for i in idx]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        zpolys.append((zi, pts, (min(xs), max(xs), min(ys), max(ys))))
    bpoly = [V2[i] for i in bnd]
    def inside(pt, poly):
        x, y = pt
        c = False
        n = len(poly)
        j = n - 1
        for i in range(n):
            xi, yi = poly[i]; xj, yj = poly[j]
            if (yi > y) != (yj > y):
                if x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                    c = not c
            j = i
        return c
    reg_kind = {}
    reg_in = {}
    for ti, t in enumerate(tri_list):
        r = region[ti]
        if r in reg_kind:
            continue
        # pick this triangle's centroid as the region probe
        P = [vo[i] for i in t]
        cx = (P[0][0] + P[1][0] + P[2][0]) / 3.0
        cy = (P[0][1] + P[1][1] + P[2][1]) / 3.0
        reg_in[r] = inside((cx, cy), bpoly)
        counts = {}
        for (zi, pts, bb) in zpolys:
            if bb[0] <= cx <= bb[1] and bb[2] <= cy <= bb[3] and inside((cx, cy), pts):
                counts[zi] = counts.get(zi, 0) + 1
        kind, best = None, 1e9
        for zi, c in counts.items():
            if c % 2 == 1 and zones[zi].get('prio', 50) < best:
                best = zones[zi].get('prio', 50); kind = zones[zi]['kind']
        reg_kind[r] = kind
    tris, tri_kind = [], []
    for ti, t in enumerate(tri_list):
        r = region[ti]
        if not reg_in[r]:
            continue
        tris.append(t); tri_kind.append(reg_kind[r])

    verts, norms, vmap, index = [], [], {}, []
    for p in vo:
        Y = Yof(p[0])
        L = surf.length(Y)
        phi = surf.phi_of_q(Y, min(max(p[1], 0.0), LREF) / LREF * L)
        P = surf.point(Y, phi)
        key = (round(P.x, 5), round(P.y, 5), round(P.z, 5)) if weld else len(verts)
        j = vmap.get(key)
        if j is None:
            j = len(verts); vmap[key] = j
            verts.append(P); norms.append(surf.normal(Y, phi))
        index.append(j)
    out_t, out_k = [], []
    for t, k in zip(tris, tri_kind):
        a, b, c = index[t[0]], index[t[1]], index[t[2]]
        if a == b or b == c or a == c:
            continue
        n = (verts[b] - verts[a]).cross(verts[c] - verts[a])
        if n.dot(norms[a] + norms[b] + norms[c]) < 0:
            b, c = c, b
        out_t.append((a, b, c)); out_k.append(k)
    return verts, norms, out_t, out_k


# ----------------------------------------------------------------------------
# Mesh object helpers
# ----------------------------------------------------------------------------
ROOT = None
PARTS = []          # objects to be joined into "body"

def link(ob, parent=None):
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob

def mesh_object(name, verts, faces, mats, face_mat=None, normals=None, smooth=True, loop_normals=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate(clean_customdata=False)
    for m in mats:
        me.materials.append(MAT[m])
    if face_mat is not None and len(me.polygons) == len(face_mat):
        me.polygons.foreach_set('material_index', face_mat)
    me.polygons.foreach_set('use_smooth', [smooth] * len(me.polygons))
    if normals is not None:
        me.normals_split_custom_set_from_vertices([tuple(n) for n in normals])
    if loop_normals is not None:
        me.normals_split_custom_set([tuple(n) for n in loop_normals])
    me.update()
    ob = bpy.data.objects.new(name, me)
    link(ob)
    return ob

def part(ob):
    PARTS.append(ob)
    return ob

def apply_mods(ob):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob

def set_mat_all(ob, name):
    ob.data.materials.clear()
    ob.data.materials.append(MAT[name])

def bevel(ob, width, segments=2, angle=30, harden=True, profile=0.5, clamp=True):
    m = ob.modifiers.new('Bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = radians(angle)
    m.harden_normals = harden
    m.profile = profile
    m.use_clamp_overlap = clamp
    return m

def subsurf(ob, levels=1):
    m = ob.modifiers.new('Subsurf', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    return m

def weighted(ob):
    m = ob.modifiers.new('WeightedNormal', 'WEIGHTED_NORMAL')
    m.keep_sharp = True
    m.weight = 50
    return m

def box_mesh(name, size, center=(0, 0, 0), mat='dark_trim', rot=None):
    sx, sy, sz = [s / 2 for s in size]
    v = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
         (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = mesh_object(name, v, f, [mat], smooth=False)
    if rot is not None:
        ob.rotation_euler = rot
    ob.location = center
    return ob

def rbox(name, size, center, mat, r=0.01, seg=2, rot=None):
    ob = box_mesh(name, size, center, mat, rot)
    bevel(ob, r, seg, 30)
    apply_mods(ob)
    return ob

def bake_transform(ob):
    """Apply object transform into the mesh (keeps custom normals rotated)."""
    mw = ob.matrix_basis.copy()
    ob.data.transform(mw)
    ob.matrix_basis = Matrix.Identity(4)
    return ob

def sweep(name, pts, radius, sides=8, mat='metal', closed=False, caps=True, radius_fn=None,
          up_hint=None, smooth=True):
    """Tube swept along a polyline with parallel-transport frames. radius_fn(t)->r."""
    P = [Vector(p) for p in pts]
    n = len(P)
    T = []
    for i in range(n):
        if closed:
            t = P[(i + 1) % n] - P[(i - 1) % n]
        elif i == 0:
            t = P[1] - P[0]
        elif i == n - 1:
            t = P[-1] - P[-2]
        else:
            t = (P[i + 1] - P[i]).normalized() + (P[i] - P[i - 1]).normalized()
        T.append(t.normalized())
    hint = Vector(up_hint) if up_hint else (Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0)))
    N0 = (hint - T[0] * hint.dot(T[0])).normalized()
    frames = [N0]
    for i in range(1, n):
        prev = frames[-1]
        axis = T[i - 1].cross(T[i])
        if axis.length > 1e-9:
            ang = T[i - 1].angle(T[i])
            prev = Matrix.Rotation(ang, 3, axis.normalized()) @ prev
        prev = (prev - T[i] * prev.dot(T[i])).normalized()
        frames.append(prev)
    verts, norms, faces = [], [], []
    for i in range(n):
        r = radius_fn(i / (n - 1)) if radius_fn else radius
        B = T[i].cross(frames[i])
        for k in range(sides):
            a = 2 * pi * k / sides
            d = frames[i] * cos(a) + B * sin(a)
            verts.append(P[i] + d * r)
            norms.append(d)
    rng = n if closed else n - 1
    for i in range(rng):
        i2 = (i + 1) % n
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((i * sides + k, i * sides + k2, i2 * sides + k2, i2 * sides + k))
    loopn = None
    if caps and not closed:
        c0 = len(verts)
        verts.append(P[0].copy()); norms.append(-T[0])
        c1 = len(verts)
        verts.append(P[-1].copy()); norms.append(T[-1])
        # caps as fans (flat normals via loop normals)
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((c0, k2, k))
            faces.append((c1, (n - 1) * sides + k, (n - 1) * sides + k2))
        loopn = []
        for f in faces:
            if f[0] == c0:
                loopn += [tuple(-T[0])] * 3
            elif f[0] == c1:
                loopn += [tuple(T[-1])] * 3
            else:
                loopn += [tuple(norms[i]) for i in f]
        ob = mesh_object(name, verts, faces, [mat], smooth=smooth, loop_normals=loopn if smooth else None)
    else:
        ob = mesh_object(name, verts, faces, [mat], smooth=smooth, normals=norms if smooth else None)
    return ob

def lathe(name, profile, segs, mat, axis='Z', center=(0, 0, 0), smooth=True, close_ends=False,
          mats=None, prof_mat=None):
    """profile: list of (r, h). Revolved about axis through center. Normals from profile."""
    verts, norms, faces, fm = [], [], [], []
    m = len(profile)
    # profile tangents for normals
    pn = []
    for i in range(m):
        a = profile[max(i - 1, 0)]
        b = profile[min(i + 1, m - 1)]
        dr, dh = b[0] - a[0], b[1] - a[1]
        nrm = Vector((dh, -dr)).normalized() if (dr or dh) else Vector((1, 0))
        pn.append(nrm)
    for i, (r, h) in enumerate(profile):
        for k in range(segs):
            a = 2 * pi * k / segs
            c, s = cos(a), sin(a)
            nr, nh = pn[i]
            if axis == 'Z':
                verts.append(Vector((r * c, r * s, h)))
                norms.append(Vector((nr * c, nr * s, nh)))
            elif axis == 'X':
                verts.append(Vector((h, r * c, r * s)))
                norms.append(Vector((nh, nr * c, nr * s)))
            else:  # 'Y'
                verts.append(Vector((r * s, h, r * c)))
                norms.append(Vector((nr * s, nh, nr * c)))
    for i in range(m - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            a, b, c, d = i * segs + k, i * segs + k2, (i + 1) * segs + k2, (i + 1) * segs + k
            faces.append((a, b, c, d))
            fm.append(prof_mat[i] if prof_mat else 0)
    for v in verts:
        v += Vector(center)
    # drop degenerate (r=0) duplicates by welding
    ob = mesh_object(name, verts, faces, mats or [mat], face_mat=fm, normals=norms if smooth else None,
                     smooth=smooth)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.to_mesh(ob.data)
    bm.free()
    if smooth:
        # restore normals after weld
        me = ob.data
        vn = []
        cen = Vector(center)
        for v in me.vertices:
            p = v.co - cen
            best = None
            # nearest profile row by height/radius
            if axis == 'Z':
                r, h = Vector((p.x, p.y)).length, p.z
            elif axis == 'X':
                r, h = Vector((p.y, p.z)).length, p.x
            else:
                r, h = Vector((p.x, p.z)).length, p.y
            bi = min(range(m), key=lambda i: (profile[i][0] - r) ** 2 + (profile[i][1] - h) ** 2)
            nr, nh = pn[bi]
            if r > 1e-6:
                if axis == 'Z':
                    d = Vector((p.x / r, p.y / r, 0)); vn.append((d.x * nr, d.y * nr, nh))
                elif axis == 'X':
                    d = Vector((0, p.y / r, p.z / r)); vn.append((nh, d.y * nr, d.z * nr))
                else:
                    d = Vector((p.x / r, 0, p.z / r)); vn.append((d.x * nr, nh, d.z * nr))
            else:
                vn.append((0, 0, 1 if nh >= 0 else -1) if axis == 'Z' else ((1 if nh >= 0 else -1, 0, 0) if axis == 'X' else (0, 1 if nh >= 0 else -1, 0)))
        me.normals_split_custom_set_from_vertices(vn)
    return ob

def loft_rings(name, rings, mats, face_mat=None, closed=True, cap0=False, cap1=False, smooth=True,
               normals=None, fm_fn=None):
    """rings: list of lists of Vector (same length). fm_fn(i, k) -> material index."""
    m = len(rings[0])
    verts = [v for r in rings for v in r]
    faces, fmat = [], []
    for i in range(len(rings) - 1):
        for k in range(m if closed else m - 1):
            k2 = (k + 1) % m
            faces.append((i * m + k, i * m + k2, (i + 1) * m + k2, (i + 1) * m + k))
            fmat.append(fm_fn(i, k) if fm_fn else (face_mat[i] if face_mat else 0))
    if cap0:
        faces.append(tuple(reversed(range(m))))
        fmat.append(face_mat[0] if face_mat else 0)
    if cap1:
        base = (len(rings) - 1) * m
        faces.append(tuple(base + k for k in range(m)))
        fmat.append(face_mat[-1] if face_mat else 0)
    return mesh_object(name, verts, faces, mats, face_mat=fmat, smooth=smooth, normals=normals)

def naca(t, npts=9, cam=0.0):
    """Closed NACA 00xx-style section, unit chord, LE at x=0; returns list (x, y) CCW-ish."""
    xs = [0.5 * (1 - cos(pi * i / (npts - 1))) for i in range(npts)]
    def yt(x):
        return 5 * t * (0.2969 * sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
    def yc(x):
        return cam * 4 * x * (1 - x)
    up = [(x, yc(x) + yt(x)) for x in xs]
    lo = [(x, yc(x) - yt(x)) for x in xs]
    # TE -> upper -> LE -> lower -> (TE excluded to avoid dup)
    ring = list(reversed(up)) + lo[1:-1]
    return ring

def airfoil_surface(name, stations, mats, face_mat=None, npts=9, cap_tip=True, cap_root=False, fm_fn=None):
    """
    stations: list of dict(le=Vector, chord_dir=Vector, thick_dir=Vector, chord, t, cam)
    Builds a lofted airfoil. Returns object.
    """
    rings = []
    for st in stations:
        sec = naca(st['t'], npts, st.get('cam', 0.0))
        ring = []
        for (x, y) in sec:
            ring.append(st['le'] + st['chord_dir'] * (x * st['chord']) + st['thick_dir'] * (y * st['chord']))
        rings.append(ring)
    ob = loft_rings(name, rings, mats, face_mat=face_mat, closed=True, cap0=cap_root, cap1=cap_tip,
                    fm_fn=fm_fn)
    return ob


# ============================================================================
# THE POD (cabin + rear fuselage + tail boom) — one lofted surface
# ============================================================================
YN = 3.02      # nose tip
YT = -4.66     # boom end (buried inside the fenestron shroud)

# Y, top, bottom, equator height, half width, top exponent, bottom exponent
POD_KEYS = [
    (3.020, -0.300, -0.300, -0.300, 0.000, 2.10, 2.10),
    (2.960, -0.070, -0.520, -0.305, 0.290, 2.15, 2.20),
    (2.820, 0.120, -0.680, -0.300, 0.465, 2.25, 2.40),
    (2.570, 0.345, -0.815, -0.275, 0.605, 2.35, 2.65),
    (2.220, 0.600, -0.915, -0.225, 0.705, 2.50, 2.90),
    (1.820, 0.825, -0.975, -0.165, 0.765, 2.65, 3.05),
    (1.380, 0.965, -1.000, -0.115, 0.795, 2.75, 3.15),
    (0.850, 1.015, -1.010, -0.090, 0.805, 2.80, 3.20),
    (-0.450, 1.015, -1.010, -0.080, 0.805, 2.80, 3.20),
    (-1.000, 1.000, -0.975, -0.060, 0.790, 2.80, 3.10),
    (-1.450, 0.960, -0.800, 0.010, 0.715, 2.70, 2.90),
    (-1.900, 0.900, -0.480, 0.170, 0.555, 2.50, 2.60),
    (-2.350, 0.830, -0.080, 0.370, 0.390, 2.25, 2.30),
    (-2.800, 0.760, 0.160, 0.460, 0.290, 2.05, 2.05),
    (-3.300, 0.715, 0.235, 0.475, 0.245, 2.00, 2.00),
    (-4.100, 0.660, 0.300, 0.480, 0.185, 2.00, 2.00),
    (-4.660, 0.625, 0.335, 0.480, 0.148, 2.00, 2.00),
]

def _pod_splines():
    ts = [sqrt(max(YN - k[0], 0.0)) for k in POD_KEYS]
    return [pchip(ts, [k[j] for k in POD_KEYS]) for j in range(1, 7)]

POD_SPL = _pod_splines()

@lru_cache(maxsize=200000)
def pod_prof(Y):
    t = sqrt(max(YN - Y, 0.0))
    zt, zb, zw, w, nt, nb = [f(t) for f in POD_SPL]
    return zt, zb, zw, max(w, 0.0), nt, nb

def pod_sec(Y, phi):
    zt, zb, zw, w, nt, nb = pod_prof(round(Y, 7))
    c, s = cos(phi), sin(phi)
    if s >= 0:
        n, h = nt, zt - zw
    else:
        n, h = nb, zw - zb
    return w * spow(c, 2.0 / n), zw + h * spow(s, 2.0 / n)

POD = Surf(pod_sec, -pi / 2, 3 * pi / 2, tips=(YN,), N=256)

def pod_z_top(Y, x):
    """z of the pod's upper surface at lateral x (right side, top quarter)."""
    phi = POD.solve_phi(Y, lambda p: p[0], abs(x), 0.0, pi / 2)
    return pod_sec(Y, phi)[1]

def pod_z_bot(Y, x):
    phi = POD.solve_phi(Y, lambda p: p[0], abs(x), -pi / 2, 0.0)
    return pod_sec(Y, phi)[1]

def pod_x_at_z(Y, z):
    phi = POD.solve_phi(Y, lambda p: p[1], z, -pi / 2, pi / 2)
    return pod_sec(Y, phi)[0]

def pod_q_side(Y, z, side=1):
    """arc-length coordinate of the point at height z on the given side."""
    phi = POD.solve_phi(Y, lambda p: p[1], z, -pi / 2, pi / 2)
    q = POD.q_of_phi(Y, phi)
    return q if side > 0 else POD.length(Y) - q

def pod_q_top(Y, x, side=1):
    phi = POD.solve_phi(Y, lambda p: p[0], abs(x), 0.0, pi / 2)
    q = POD.q_of_phi(Y, phi)
    return q if side > 0 else POD.length(Y) - q

def pod_q_bot(Y, x, side=1):
    phi = POD.solve_phi(Y, lambda p: p[0], abs(x), -pi / 2, 0.0)
    q = POD.q_of_phi(Y, phi)
    return q if side > 0 else POD.length(Y) - q

def pod_stations():
    st = []
    t1 = sqrt(YN - 1.25)
    n = 22
    for i in range(n + 1):
        t = t1 * i / n
        st.append(YN - t * t)
    Y = 1.25 - 0.25
    while Y > -1.2:
        st.append(Y); Y -= 0.25
    Y = -1.25
    while Y > -2.95:
        st.append(Y); Y -= 0.17
    Y = -2.95
    while Y > YT + 0.05:
        st.append(Y); Y -= 0.3
    st.append(YT)
    return st

def pod_spacing(Y):
    if Y > 2.4:
        return 0.16
    if Y > -1.3:
        return 0.22
    if Y > -2.9:
        return 0.18
    return 0.16


# ============================================================================
# ENGINE COWLING — second lofted surface sitting on the roof
# ============================================================================
CY0, CY1 = 0.92, -3.10
COWL_KEYS = [  # Y, half width, top z
    (0.92, 0.36, 1.150),
    (0.70, 0.415, 1.270),
    (0.40, 0.455, 1.390),
    (0.05, 0.475, 1.455),
    (-0.40, 0.480, 1.462),
    (-1.00, 0.480, 1.450),
    (-1.60, 0.465, 1.425),
    (-2.10, 0.410, 1.345),
    (-2.55, 0.300, 1.170),
    (-2.90, 0.190, 0.960),
    (-3.10, 0.140, 0.860),
]
_cys = [-k[0] for k in COWL_KEYS]
COWL_W = pchip(_cys, [k[1] for k in COWL_KEYS])
COWL_T = pchip(_cys, [k[2] for k in COWL_KEYS])

COWL_N = 4.0

@lru_cache(maxsize=200000)
def cowl_prof(Y):
    # bluff, rounded prow at the front (width -> 0, height kept); tapered tail at the rear
    ef = sqrt(min(1.0, max(CY0 - Y, 0.0) / 0.26))
    er = sqrt(min(1.0, max(Y - CY1, 0.0) / 0.30))
    wc = COWL_W(-Y) * ef * er
    top = COWL_T(-Y)
    base = pod_z_top(Y, min(max(wc, 0.25), pod_prof(round(Y, 7))[3] * 0.98)) - 0.035
    h = max(top - base, 0.0) * er
    return wc, base, h

def cowl_sec(Y, phi):
    wc, base, h = cowl_prof(round(Y, 7))
    c, s = cos(phi), sin(phi)
    return wc * spow(c, 2 / COWL_N), base + h * spow(max(s, 0.0), 2 / COWL_N)

COWL = Surf(cowl_sec, 0.0, pi, tips=(CY0, CY1), N=200, poles=(CY1,))

def cowl_stations():
    st = []
    for i in range(13):
        t = i / 12.0
        st.append(CY0 - 0.34 * t * t)
    Y = CY0 - 0.34 - 0.14
    while Y > CY1 + 0.30:
        st.append(Y); Y -= 0.19
    for i in range(7):
        t = i / 6.0
        st.append(CY1 + 0.30 * t * t)
    return sorted(set(round(y, 6) for y in st))

def cowl_spacing(Y):
    return 0.15



# ============================================================================
# Outline tools in the unrolled (Y, q) domain
# ============================================================================
def QP(kind, Y, val):
    """A control point given in a designer-friendly view, returned in side-local
    coordinates (Y, s): s = arc length from the bottom centreline up the side.
    Both sides use the same local polygon, so port and starboard are exact mirrors."""
    if kind == 'z':      # side view: height z
        return (Y, pod_q_side(Y, val, 1))
    if kind == 'xt':     # plan view: |x| on the upper surface
        return (Y, pod_q_top(Y, val, 1))
    if kind == 'xb':     # plan view from below
        return (Y, pod_q_bot(Y, val, 1))
    if kind == 's':
        return (Y, val)
    raise ValueError(kind)

def to_side(poly, side):
    if side > 0:
        return list(poly)
    return [(Y, POD.length(Y) - s) for (Y, s) in reversed(poly)]

def fillet(poly, r, k=5, radii=None):
    out = []
    n = len(poly)
    for i in range(n):
        if radii is not None and radii[i] is not None:
            rr = radii[i]
        else:
            rr = r
        if rr <= 0:
            out.append(Vector(poly[i]))
            continue
        a, p, b = Vector(poly[i - 1]), Vector(poly[i]), Vector(poly[(i + 1) % n])
        la, lb = (p - a).length, (b - p).length
        if la < 1e-9 or lb < 1e-9:
            continue
        din, dout = (p - a) / la, (b - p) / lb
        if din.dot(dout) > 0.995:
            out.append(p)
            continue
        d = min(rr, 0.45 * la, 0.45 * lb)
        p1, p2 = p - din * d, p + dout * d
        for j in range(k + 1):
            t = j / k
            out.append((1 - t) ** 2 * p1 + 2 * (1 - t) * t * p + t * t * p2)
    return [(v.x, v.y) for v in out]

def densify(poly, step=0.03, closed=True):
    out = []
    n = len(poly)
    rng = n if closed else n - 1
    for i in range(rng):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % n])
        m = max(1, int(math.ceil((b - a).length / step)))
        for j in range(m):
            p = a.lerp(b, j / m)
            out.append((p.x, p.y))
    if not closed:
        out.append(tuple(poly[-1]))
    # drop near-duplicates
    clean = []
    for p in out:
        if not clean or (Vector(p) - Vector(clean[-1])).length > 1e-5:
            clean.append(p)
    if len(clean) > 2 and (Vector(clean[0]) - Vector(clean[-1])).length < 1e-5:
        clean.pop()
    return clean

def signed_area(poly):
    a = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % len(poly)]
        a += x0 * y1 - x1 * y0
    return a * 0.5

def offset_poly(poly, d):
    """Positive d = outward (for a CCW or CW polygon alike)."""
    ccw = signed_area(poly) > 0
    n = len(poly)
    out = []
    for i in range(n):
        a, p, b = Vector(poly[i - 1]), Vector(poly[i]), Vector(poly[(i + 1) % n])
        e1 = (p - a).normalized()
        e2 = (b - p).normalized()
        # right-hand normals point outward for CCW polygons
        n1 = Vector((e1.y, -e1.x))
        n2 = Vector((e2.y, -e2.x))
        nn = (n1 + n2)
        if nn.length < 1e-9:
            nn = n1
        nn.normalize()
        c = max(nn.dot(n1), 0.35)
        s = d / c if ccw else -d / c
        out.append((p.x + nn.x * s, p.y + nn.y * s))
    return out

def _pod_local_pt(Y, s):
    Y = min(Y, YN - 1e-5)
    return POD.pq(Y, max(0.0, min(s, POD.length(Y) / 2)))

def densify_metric(poly, step3d=0.045):
    """Subdivide a closed side-local polygon so no edge is longer than step3d on the skin."""
    out = []
    n = len(poly)
    P = [_pod_local_pt(Y, s) for (Y, s) in poly]
    for i in range(n):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % n])
        m = max(1, int(math.ceil((P[(i + 1) % n] - P[i]).length / step3d)))
        for j in range(m):
            p = a.lerp(b, j / m)
            out.append((p.x, p.y))
    return out

def _closest_on_pod(X, Y0, s0, iters=6):
    """Side-local (Y, s) of the pod point nearest to the 3D point X (Gauss-Newton,
    started from (Y0, s0))."""
    Y, sv = Y0, s0
    h = 1e-3
    for _ in range(iters):
        Yc = min(Y, YN - 2 * h)
        P0 = _pod_local_pt(Yc, sv)
        f = P0 - X
        jY = (_pod_local_pt(Yc + h, sv) - _pod_local_pt(Yc - h, sv)) / (2 * h)
        js = (_pod_local_pt(Yc, sv + h) - _pod_local_pt(Yc, sv - h)) / (2 * h)
        a11, a12, a22 = jY.dot(jY), jY.dot(js), js.dot(js)
        b1, b2 = -jY.dot(f), -js.dot(f)
        det = a11 * a22 - a12 * a12
        if abs(det) < 1e-14:
            break
        dY = (a22 * b1 - a12 * b2) / det
        ds = (a11 * b2 - a12 * b1) / det
        Y = min(Yc + dY, YN - 2e-4)
        sv = max(0.0, sv + ds)
        if abs(dY) < 1e-6 and abs(ds) < 1e-6:
            break
    return (Y, sv)

def offset_poly_metric(poly, d):
    """Offset a closed side-local polygon by d metres measured ON the skin
    (d < 0 = inward). Done in 3D: step along (surface normal x outline tangent),
    then pull the point back onto the skin with a Gauss-Newton closest-point
    solve. (The old first-order Jacobian step let the frit width wander between
    0 and 5 cm near the nose, where the sections shrink to the tip.)"""
    n = len(poly)
    P = [_pod_local_pt(Y, s) for (Y, s) in poly]
    Nn = [POD.nq(min(Y, YN - 1e-4), max(0.0, min(s, POD.length(min(Y, YN - 1e-4)) / 2))) for (Y, s) in poly]
    W = []
    for i in range(n):
        T = P[(i + 1) % n] - P[i - 1]
        if T.length < 1e-9:
            T = P[(i + 1) % n] - P[i]
        W.append(Nn[i].cross(T.normalized()).normalized())
    # which way is "inward"? try both at the vertex where the outline is roomiest
    ccw_test = max(range(n), key=lambda i: (P[i] - P[i - 1]).length + (P[(i + 1) % n] - P[i]).length)
    probe = 0.004
    def inside(pt):
        x, y = pt
        c = False
        j = n - 1
        for k in range(n):
            xi, yi = poly[k]; xj, yj = poly[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                c = not c
            j = k
        return c
    i0 = ccw_test
    inward = 1.0 if inside(_closest_on_pod(P[i0] + W[i0] * probe, *poly[i0])) else -1.0
    sgn = inward if d < 0 else -inward
    out = []
    for i in range(n):
        X = P[i] + W[i] * (abs(d) * sgn)
        out.append(_closest_on_pod(X, *poly[i]))
    return out

def _edge_points(a, b, dstep=0.02):
    """Points from control point a (inclusive) towards b (exclusive), following the
    design curve: a straight line in side view for 'z'-'z', in plan view for 'xt'-'xt'
    or 'xb'-'xb'; a straight line in the unrolled domain otherwise."""
    ka, Ya, va = a[0], a[1], a[2]
    kb, Yb, vb = b[0], b[1], b[2]
    pa, pb = QP(ka, Ya, va), QP(kb, Yb, vb)
    if ka == kb and ka in ('z', 'xt', 'xb'):
        m = max(1, int(math.ceil(max(abs(Yb - Ya), abs(vb - va)) / dstep)))
        return [QP(ka, lerp(Ya, Yb, j / m), lerp(va, vb, j / m)) for j in range(m)]
    m = max(1, int(math.ceil((Vector(pb) - Vector(pa)).length / dstep)))
    return [tuple(Vector(pa).lerp(Vector(pb), j / m)) for j in range(m)]

def _round_corners(path, corners, radii):
    """Replace each corner of a dense closed path by a quadratic Bezier between the two
    points `r` away from it along the path (r clipped to 45% of the neighbouring spans)."""
    n = len(path)
    P = [Vector(p) for p in path]
    cum = [0.0]
    for i in range(n):
        cum.append(cum[-1] + (P[(i + 1) % n] - P[i]).length)
    total = cum[-1]
    def at(dist):
        dist %= total
        i = bisect.bisect_right(cum, dist) - 1
        i = min(max(i, 0), n - 1)
        seg = cum[i + 1] - cum[i]
        t = 0.0 if seg < 1e-12 else (dist - cum[i]) / seg
        return P[i].lerp(P[(i + 1) % n], t), i
    cuts = []
    m = len(corners)
    for j, c in enumerate(corners):
        prev_c = corners[j - 1]; next_c = corners[(j + 1) % m]
        span_prev = (cum[c] - cum[prev_c]) % total
        span_next = (cum[next_c] - cum[c]) % total
        r = min(radii[j], 0.45 * span_prev, 0.45 * span_next)
        cuts.append((cum[c] - r, cum[c] + r, c, r))
    out = []
    for j, (d0, d1, c, r) in enumerate(cuts):
        # straight run from the previous corner's exit to this corner's entry
        pe = cuts[j - 1][1]
        run = (d0 - pe) % total
        steps = max(1, int(math.ceil(run / 0.02)))
        for k in range(steps):
            p, _ = at(pe + run * k / steps)
            out.append((p.x, p.y))
        if r <= 1e-6:
            continue
        A, _ = at(d0); B, _ = at(d1); Cc = P[c]
        for k in range(6):
            t = k / 6
            q = (1 - t) ** 2 * A + 2 * (1 - t) * t * Cc + t * t * B
            out.append((q.x, q.y))
    # drop near duplicates
    clean = []
    for p in out:
        if not clean or (Vector(p) - Vector(clean[-1])).length > 1e-5:
            clean.append(p)
    return clean

def outline(ctrl, r=0.06, step=0.075):
    """Side-local closed outline: edges follow their design curves, corners are filleted
    (optional 4th item = corner radius), then sampled every `step` metres on the skin."""
    path, corners, radii = [], [], []
    n = len(ctrl)
    for i in range(n):
        a, b = ctrl[i], ctrl[(i + 1) % n]
        corners.append(len(path))
        radii.append(a[3] if len(a) > 3 else r)
        path += _edge_points(a, b)
    # only real direction changes are corners; collinear design points stay sharp-free
    rr = []
    for j, c in enumerate(corners):
        p = Vector(path[c]); a = Vector(path[c - 1]); b = Vector(path[(c + 1) % len(path)])
        if (p - a).length > 1e-9 and (b - p).length > 1e-9 and (p - a).normalized().dot((b - p).normalized()) > 0.985:
            rr.append(0.0)
        else:
            rr.append(radii[j])
    rounded = _round_corners(path, corners, rr)
    return thin_metric(rounded, step)

def thin_metric(poly, step3d):
    """Keep points so consecutive kept points are ~step3d apart on the skin (and always
    keep points where the outline turns)."""
    P = [_pod_local_pt(Y, s) for (Y, s) in poly]
    n = len(poly)
    keep = [0]
    acc = 0.0
    for i in range(1, n):
        acc += (P[i] - P[i - 1]).length
        a = Vector(poly[i]) - Vector(poly[i - 1]); b = Vector(poly[(i + 1) % n]) - Vector(poly[i])
        turn = a.length > 1e-9 and b.length > 1e-9 and a.normalized().dot(b.normalized()) < 0.9995
        if acc >= step3d or (turn and acc >= 0.25 * step3d):
            keep.append(i); acc = 0.0
    return [poly[i] for i in keep]

def mirror_poly(poly):
    return [(Y, POD.length(Y) - q) for (Y, q) in poly]

def window_zones(poly, side, frit=0.035, prio=10):
    """A window (side-local outline): glass inside the inset, a dark frit band between."""
    inner = offset_poly_metric(poly, -frit)
    return [
        {'kind': 'glass', 'polys': [to_side(inner, side)], 'prio': prio},
        {'kind': 'frame', 'polys': [to_side(poly, side)], 'prio': prio + 1},
    ]

def seam_zone(poly, side, w=0.012, prio=20):
    return {'kind': 'seam', 'polys': [to_side(offset_poly_metric(poly, w / 2), side),
                                       to_side(offset_poly_metric(poly, -w / 2), side)],
            'prio': prio}

def band_poly(path, side=1):
    """path: list of (Y, z_low, z_high) along the side -> closed (Y, q) polygon."""
    lo = [(Y, pod_q_side(Y, zl, side)) for (Y, zl, zh) in path]
    hi = [(Y, pod_q_side(Y, zh, side)) for (Y, zl, zh) in path]
    return lo + list(reversed(hi))


# ============================================================================
# Lettering: Blender text -> mesh -> outline loops (as constraint polygons)
# ============================================================================
def text_loops(body, size, extrude=0.0):
    cu = bpy.data.curves.new('txt_' + body, 'FONT')
    cu.body = body
    cu.size = size
    cu.resolution_u = 3
    cu.align_x = 'LEFT'
    cu.space_character = 1.08
    ob = bpy.data.objects.new('txt_' + body, cu)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=dg)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bnd = [e for e in bm.edges if len(e.link_faces) == 1]
    # chain boundary edges into loops
    adj = {}
    for e in bnd:
        a, b = e.verts
        adj.setdefault(a.index, []).append(b.index)
        adj.setdefault(b.index, []).append(a.index)
    co = {v.index: (v.co.x, v.co.y) for v in bm.verts}
    seen = set()
    loops = []
    for start in adj:
        if start in seen:
            continue
        loop = [start]
        seen.add(start)
        prev, cur = None, start
        while True:
            nxt = [v for v in adj[cur] if v != prev and v not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            seen.add(cur)
            loop.append(cur)
        if len(loop) >= 3:
            loops.append([co[i] for i in loop])
    xs = [p[0] for l in loops for p in l]
    ys = [p[1] for l in loops for p in l]
    bbox = (min(xs), max(xs), min(ys), max(ys))
    bm.free()
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return loops, bbox


def lettering_zone(text, Yc, zc, height, side, prio=30, kind='white'):
    loops, (x0, x1, y0, y1) = text_loops(text, 1.0)
    sc = height / (y1 - y0)
    width = (x1 - x0) * sc
    polys = []
    for l in loops:
        pts = []
        for (x, y) in l:
            u = (x - x0) * sc - width / 2          # along the reading direction
            v = (y - y0) * sc - height / 2
            Y = Yc + u if side > 0 else Yc - u     # right side reads tail -> nose
            pts.append((Y, pod_q_side(Y, zc + v, 1)))
        polys.append(to_side(densify(pts, 0.045), side))
    return {'kind': kind, 'polys': polys, 'prio': prio}, width


# ============================================================================
# Pod zones: glazing, frit, door seams, livery, lettering
# ============================================================================
AMBER_PATH = [  # Y, z_low, z_high (right side; mirrored for the left)
    (1.00, -0.625, -0.485), (0.20, -0.625, -0.485), (-0.60, -0.625, -0.485),
    (-1.05, -0.600, -0.465), (-1.45, -0.470, -0.340), (-1.85, -0.240, -0.115),
    (-2.25, 0.040, 0.150), (-2.65, 0.215, 0.305), (-3.10, 0.285, 0.360),
    (-3.70, 0.315, 0.380), (-4.30, 0.335, 0.392),
]

def amber_band(side, pin=False, y_front=1.84, y_front_hi=1.98):
    if pin:   # a thin white pin-stripe riding 2 cm above the amber
        path = [(Y, zh + 0.020, zh + 0.036) for (Y, zl, zh) in AMBER_PATH]
    else:
        path = list(AMBER_PATH)
    dy = 0.02 if pin else 0.0
    lo = [(y_front + dy * 7, path[0][1])] + [(Y, zl) for (Y, zl, zh) in path]
    hi = [(y_front_hi + dy * 7.5, path[0][2])] + [(Y, zh) for (Y, zl, zh) in path]
    lo = [(Y, pod_q_side(Y, z, 1)) for (Y, z) in lo]
    hi = [(Y, pod_q_side(Y, z, 1)) for (Y, z) in hi]
    # smooth the long edges (Catmull-Rom in the domain), keep the ends square
    lo = [(p.x, p.y) for p in catmull([Vector(p) for p in lo], 3)]
    hi = [(p.x, p.y) for p in catmull([Vector(p) for p in hi], 3)]
    poly = lo + list(reversed(hi))
    return to_side(densify(poly, 0.14), side)

def nose_Y(z, x, lo=2.6, hi=3.0195):
    """Station where the nose's horizontal cut at height z has half-width x."""
    for _ in range(50):
        mid = 0.5 * (lo + hi)
        if pod_x_at_z(mid, z) > x:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)

WS_Z = -0.10     # windscreen lower edge across the nose
CHIN_Z = -0.335  # chin-window upper edge
_yw = nose_Y(WS_Z, 0.036)
_yc = nose_Y(CHIN_Z, 0.075)
def _lin(a, b, n):
    return [a + (b - a) * i / (n - 1) for i in range(n)]

WINDSCREEN = ([('xt', Y, 0.036) for Y in _lin(1.43, _yw - 0.012, 16)] +
              [('z', _yw, WS_Z, 0.045)] +
              [('z', Y, WS_Z - 0.03 * smooth((2.97 - Y) / 0.35)) for Y in _lin(_yw - 0.05, 2.62, 6)] +
              [('z', 2.49, -0.15), ('z', 2.36, -0.18), ('z', 2.11, -0.26), ('z', 1.30, 0.80),
               ('xt', 1.35, 0.52), ('xt', 1.39, 0.30), ('xt', 1.415, 0.14)])
CHIN = ([('z', _yc, CHIN_Z, 0.045)] +
        [('z', Y, CHIN_Z - 0.06 * smooth((2.72 - Y) / 0.3)) for Y in _lin(_yc - 0.06, 2.45, 6)] +
        [('z', 2.28, -0.45), ('z', 2.15, -0.60), ('xb', 2.20, 0.30)] +
        [('xb', Y, lerp(0.21, 0.076, smooth((Y - 2.30) / 0.6))) for Y in _lin(2.30, 2.97, 8)])
FDOOR_WIN = [('z', 1.975, -0.31), ('z', 1.20, 0.79), ('z', 0.675, 0.79), ('z', 0.675, -0.31)]
FDOOR = [('z', 2.045, -0.225), ('z', 1.205, 0.87), ('z', 0.60, 0.87), ('z', 0.60, -0.745),
         ('z', 1.955, -0.745), ('z', 2.02, -0.52)]
SDOOR = [('z', 0.515, 0.87), ('z', -0.985, 0.87), ('z', -0.985, -0.765), ('z', 0.515, -0.765)]
SDOOR_WIN = [('z', 0.425, 0.80), ('z', -0.885, 0.80), ('z', -0.885, -0.13), ('z', 0.425, -0.13)]
EYEBROW = [('xt', 1.305, 0.095), ('xt', 1.035, 0.095), ('xt', 1.035, 0.39), ('xt', 1.255, 0.40)]
BAGGAGE = [('z', -1.16, 0.62), ('z', -1.86, 0.62), ('z', -1.86, -0.20), ('z', -1.16, -0.36)]

def pod_zones():
    zones = []
    for side in (1, -1):
        zones += window_zones(outline(WINDSCREEN, 0.075), side)
        zones += window_zones(outline(CHIN, 0.07), side)
        zones += window_zones(outline(FDOOR_WIN, 0.075), side)
        zones += window_zones(outline(SDOOR_WIN, 0.10), side)
        zones += window_zones(outline(EYEBROW, 0.05), side, frit=0.03)
        zones.append(seam_zone(outline(FDOOR, 0.05, 0.14), side))
        zones.append(seam_zone(outline(SDOOR, 0.06, 0.14), side))
        zones.append(seam_zone(outline(BAGGAGE, 0.06, 0.14), side))
        zones.append({'kind': 'accent', 'polys': [amber_band(side)], 'prio': 40})
        # white pin-stripe riding just above the amber
        zones.append({'kind': 'white', 'polys': [amber_band(side, pin=True)], 'prio': 38})
        lz, _ = lettering_zone('SKYHOOK', -3.16, 0.515, 0.165, side)
        zones.append(lz)
    # amber band right round the boom, behind the stabiliser
    Y0, Y1 = -4.22, -4.40
    def half(a, b):
        pts = []
        for i in range(9):
            Y = Y0 + (Y1 - Y0) * i / 8
            pts.append((Y, POD.length(Y) * a))
        for i in range(9):
            Y = Y1 + (Y0 - Y1) * i / 8
            pts.append((Y, POD.length(Y) * b))
        return pts
    zones.append({'kind': 'accent', 'polys': [densify(half(0.0, 0.5), 0.04)], 'prio': 41})
    zones.append({'kind': 'accent', 'polys': [densify(half(0.5, 1.0), 0.04)], 'prio': 41})
    return zones

KIND_MAT = {None: 'paint_main', 'accent': 'paint_accent', 'white': 'paint_white',
            'frame': 'dark_trim', 'seam': 'dark_trim', 'dark': 'dark_trim'}
POD_MATS = ['paint_main', 'paint_accent', 'paint_white', 'dark_trim', 'interior']

def build_pod():
    zones = pod_zones()
    verts, norms, tris, kinds = triangulate_surface(POD, pod_stations(), pod_spacing, zones)
    log('pod CDT', len(verts), 'verts', len(tris), 'tris')
    glass_t = [t for t, k in zip(tris, kinds) if k == 'glass']
    body = [(t, k) for t, k in zip(tris, kinds) if k != 'glass']
    V = list(verts)
    faces, fmat, loopn = [], [], []
    for t, k in body:
        faces.append(t)
        fmat.append(POD_MATS.index(KIND_MAT[k]))
        loopn += [tuple(norms[i]) for i in t]
    # rims: from each glass-hole edge, a dark lip turning into the cabin
    glass_edges = {}
    for t in glass_t:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            glass_edges[(a, b)] = True
    RIM = 0.028
    inner = {}
    def vin(i):
        j = inner.get(i)
        if j is None:
            j = len(V)
            V.append(verts[i] - norms[i] * RIM)
            inner[i] = j
        return j
    for t, k in body:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            if (b, a) in glass_edges:
                q = (b, a, vin(a), vin(b))
                faces.append(q)
                fmat.append(POD_MATS.index('dark_trim'))
                n = (V[q[1]] - V[q[0]]).cross(V[q[2]] - V[q[1]]).normalized()
                loopn += [tuple(n)] * 4
    ob = mesh_object('pod', V, faces, POD_MATS, face_mat=fmat, loop_normals=loopn)
    # glass: same triangles, sunk 6 mm into the opening
    gv, gn, gmap, gf = [], [], {}, []
    for t in glass_t:
        f = []
        for i in t:
            j = gmap.get(i)
            if j is None:
                j = len(gv)
                gmap[i] = j
                gv.append(verts[i] - norms[i] * 0.006)
                gn.append(norms[i])
            f.append(j)
        gf.append(tuple(f))
    glass = mesh_object('glass', gv, gf, ['glass'], normals=gn)
    return ob, glass

def build_inner_shell():
    """Cabin lining: a coarse copy of the skin 4.5 cm inboard, with the window openings cut
    on the same outlines as the glass, so it darkens the cabin from outside without ever
    blocking the view out from the pilot's eye."""
    zones = []
    for side in (1, -1):
        for (ctrl, r) in ((WINDSCREEN, 0.075), (CHIN, 0.07), (FDOOR_WIN, 0.075), (SDOOR_WIN, 0.10),
                          (EYEBROW, 0.05)):
            poly = outline(ctrl, r, 0.12)
            zones.append({'kind': 'glass', 'polys': [to_side(offset_poly_metric(poly, 0.012), side)], 'prio': 1})
    st = [y for y in pod_stations() if y >= -1.25]
    st = [st[0]] + [y for y in st[1:] if y > 2.2 or abs(y - round(y / 0.3) * 0.3) < 0.13] + [YN]
    v, n, t, k = triangulate_surface(POD, sorted(set(st)), lambda Y: 0.32, zones, turn=radians(24))
    faces, verts, vid = [], [], {}
    for tri, kind in zip(t, k):
        if kind == 'glass':
            continue
        f = []
        for i in tri:
            j = vid.get(i)
            if j is None:
                j = len(verts); vid[i] = j
                verts.append(v[i] - n[i] * 0.045)
            f.append(j)
        faces.append((f[0], f[2], f[1]))
    # rear bulkhead closing the cabin
    Yb = min(st)
    L = POD.length(Yb)
    ring = [POD.pq(Yb, L * k2 / 32) - POD.nq(Yb, L * k2 / 32) * 0.045 for k2 in range(32)]
    c = len(verts)
    verts.append(sum(ring, Vector()) / 32)
    base = len(verts)
    verts += ring
    for k2 in range(32):
        faces.append((c, base + (k2 + 1) % 32, base + k2))
    ob = mesh_object('cabin_lining', verts, faces, ['interior'], smooth=False)
    return ob

def _old_inner_shell():
    rings = []
    ys = [2.93, 2.8, 2.6, 2.35, 2.05, 1.7, 1.25, 0.6, -0.1, -0.7, -1.22]
    NA = 28
    for Y in ys:
        L = POD.length(Y)
        ring = []
        for k in range(NA):
            q = L * k / NA
            p = POD.pq(Y, q)
            n = POD.nq(Y, q)
            ring.append(p - n * 0.05)
        rings.append(ring)
    m = NA
    verts = [v for r in rings for v in r]
    faces = []
    for i in range(len(rings) - 1):
        for k in range(m):
            k2 = (k + 1) % m
            # reversed winding -> faces point inward
            faces.append((i * m + k, (i + 1) * m + k, (i + 1) * m + k2, i * m + k2))
    # rear bulkhead (faces forward, into the cabin)
    last = (len(rings) - 1) * m
    c = len(verts)
    verts.append(sum(rings[-1], Vector()) / m)
    for k in range(m):
        faces.append((c, last + (k + 1) % m, last + k))
    # nose cap
    c2 = len(verts)
    verts.append(sum(rings[0], Vector()) / m)
    for k in range(m):
        faces.append((c2, k, (k + 1) % m))
    ob = mesh_object('cabin_lining', verts, faces, ['interior'], smooth=False)
    return ob



# ============================================================================
# Generic helpers for the hard-surface parts
# ============================================================================
def sharpen(ob, angle=48):
    """Smooth-shade, but split normals across edges sharper than `angle` (auto-smooth)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    thr = radians(angle)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            a, b = e.link_faces
            e.smooth = a.normal.angle(b.normal, 0.0) < thr
        else:
            e.smooth = False
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(me)
    bm.free()
    me.update()
    return ob

def fix_normals(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob

def flat_ob(ob):
    ob.data.polygons.foreach_set('use_smooth', [False] * len(ob.data.polygons))
    return ob

def on_pod(Y, z, side=1, off=0.0):
    """Point on the pod surface at side-view height z (plus offset along the normal)."""
    s = pod_q_side(Y, z, 1)
    p = POD.pq(Y, s)
    n = POD.nq(Y, s)
    if side < 0:
        p = Vector((-p.x, p.y, p.z)); n = Vector((-n.x, n.y, n.z))
    return p + n * off, n

def surface_path(ctrl, off, side=1, step=0.03):
    """Polyline along the pod skin through side-local control points, lifted by `off`."""
    pts = [QP(c[0], c[1], c[2]) for c in ctrl]
    dense = densify(pts, step, closed=False)
    out = []
    for (Y, s) in dense:
        p = POD.pq(Y, s); n = POD.nq(Y, s)
        if side < 0:
            p = Vector((-p.x, p.y, p.z)); n = Vector((-n.x, n.y, n.z))
        out.append(p + n * off)
    return out

def orient_box(name, size, center, x_axis, z_axis, mat, r=0.004, seg=2):
    """Rounded box with its local X/Z mapped to the given world directions."""
    ob = box_mesh(name, size, (0, 0, 0), mat)
    if r > 0:
        bevel(ob, r, seg, 30)
        apply_mods(ob)
    X = Vector(x_axis).normalized()
    Z = (Vector(z_axis) - X * Vector(z_axis).dot(X)).normalized()
    Yv = Z.cross(X)
    M = Matrix((X, Yv, Z)).transposed().to_4x4()
    M.translation = Vector(center)
    ob.data.transform(M)
    return ob

def disc_fan(name, center, normal, radius, segs, mat):
    n = Vector(normal).normalized()
    a = n.orthogonal().normalized()
    b = n.cross(a)
    verts = [Vector(center)]
    for k in range(segs):
        t = 2 * pi * k / segs
        verts.append(Vector(center) + (a * cos(t) + b * sin(t)) * radius)
    faces = [(0, 1 + k, 1 + (k + 1) % segs) for k in range(segs)]
    ob = mesh_object(name, verts, faces, [mat], smooth=False)
    # make it face along +normal
    me = ob.data
    if me.polygons[0].normal.dot(n) < 0:
        me.flip_normals()
    return ob

def dome(name, center, axis, radius, height, segs, rings, mat):
    """Half-ellipsoid dome standing on `center` along `axis`."""
    prof = []
    for i in range(rings + 1):
        a = (pi / 2) * i / rings
        prof.append((radius * cos(a), height * sin(a)))
    ob = lathe(name, prof, segs, mat, axis='Z')
    ax = Vector(axis).normalized()
    q = Vector((0, 0, 1)).rotation_difference(ax)
    M = q.to_matrix().to_4x4()
    M.translation = Vector(center)
    ob.data.transform(M)
    return ob

def xform(ob, M):
    ob.data.transform(M)
    return ob

def frame_from(z_axis, x_hint=(1, 0, 0), origin=(0, 0, 0)):
    Z = Vector(z_axis).normalized()
    X = Vector(x_hint)
    X = (X - Z * X.dot(Z))
    if X.length < 1e-6:
        X = Z.orthogonal()
    X.normalize()
    Yv = Z.cross(X)
    M = Matrix((X, Yv, Z)).transposed().to_4x4()
    M.translation = Vector(origin)
    return M


# ============================================================================
# ENGINE COWLING (zones, intakes, exhausts, mast collar)
# ============================================================================
def cowl_q_side(Y, z):
    phi = COWL.solve_phi(Y, lambda p: p[1], z, 0.0, pi / 2)
    return COWL.q_of_phi(Y, phi)

def cowl_q_top(Y, x):
    phi = COWL.solve_phi(Y, lambda p: p[0], x, 0.0, pi / 2)
    return COWL.q_of_phi(Y, phi)

def cowl_side(poly, side):
    if side > 0:
        return list(poly)
    return [(Y, COWL.length(Y) - s) for (Y, s) in reversed(poly)]

def cowl_outline(ctrl, r=0.05, step=0.05):
    pts = []
    for (k, Y, v) in ctrl:
        pts.append((Y, cowl_q_side(Y, v) if k == 'z' else cowl_q_top(Y, v)))
    return densify(fillet(pts, r), step)

def cowl_on(Y, s, side=1, off=0.0):
    p = COWL.pq(Y, s); n = COWL.nq(Y, s)
    if side < 0:
        p = Vector((-p.x, p.y, p.z)); n = Vector((-n.x, n.y, n.z))
    return p + n * off, n

INTAKE = [('z', -0.50, 1.11), ('z', -1.20, 1.11), ('z', -1.20, 1.335), ('z', -0.50, 1.335)]
COWL_DOOR = [('z', -0.33, 1.00), ('z', -1.92, 1.00), ('z', -1.92, 1.395), ('z', -0.33, 1.395)]

def build_cowl():
    zones = []
    for side in (1, -1):
        gr = cowl_outline(INTAKE, 0.06)
        zones.append({'kind': 'dark', 'polys': [cowl_side(gr, side)], 'prio': 10})
        dr = cowl_outline(COWL_DOOR, 0.07)
        zones.append({'kind': 'seam', 'polys': [cowl_side(densify(offset_poly(dr, 0.006), 0.1), side),
                                                cowl_side(densify(offset_poly(dr, -0.006), 0.1), side)],
                      'prio': 20})
    # oil-cooler grille on the aft deck (what the chase camera looks down on)
    gy0, gy1, gx = -1.36, -1.84, 0.17
    right = [(Y, cowl_q_top(Y, gx)) for Y in _lin(gy0, gy1, 5)]
    left = [(Y, COWL.length(Y) - cowl_q_top(Y, gx)) for Y in _lin(gy1, gy0, 5)]
    zones.append({'kind': 'dark', 'polys': [densify(fillet(right + left, 0.04), 0.05)], 'prio': 10})
    # transverse split lines across the deck
    for Yc in (0.30, -2.05):
        a = [(Yc + 0.006, 0.0), (Yc + 0.006, COWL.length(Yc + 0.006))]
        b = [(Yc - 0.006, COWL.length(Yc - 0.006)), (Yc - 0.006, 0.0)]
        poly = densify(a + b, 0.08)
        zones.append({'kind': 'seam', 'polys': [poly], 'prio': 20})
    v, n, t, k = triangulate_surface(COWL, cowl_stations(), cowl_spacing, zones, turn=radians(8))
    faces, fmat = [], []
    for tri, kind in zip(t, k):
        faces.append(tri)
        fmat.append(POD_MATS.index(KIND_MAT[kind]))
    ob = mesh_object('cowl', v, faces, POD_MATS, face_mat=fmat, normals=n)
    parts = [ob]
    # intake: bright lip + louvres
    for side in (1, -1):
        gr = cowl_outline(INTAKE, 0.06, 0.11)
        lip = []
        for (Y, s) in gr:
            p, nn = cowl_on(Y, s, side, 0.004)
            lip.append(p)
        parts.append(sweep('intake_lip', lip, 0.009, 4, 'metal', closed=True))
        for zb in (1.155, 1.2025, 1.25, 1.2975):
            pts = []
            for i in range(3):
                Y = -0.56 + (-1.14 + 0.56) * i / 2
                p, nn = cowl_on(Y, cowl_q_side(Y, zb), side, 0.004)
                pts.append(p)
            parts.append(sweep('louvre', pts, 0.0085, 4, 'metal', caps=True, smooth=False))
    # cooler louvres
    for Yb in _lin(-1.42, -1.78, 6):
        pts = []
        for x in _lin(-0.145, 0.145, 5):
            p, nn = cowl_on(Yb, cowl_q_top(Yb, abs(x)), 1 if x >= 0 else -1, 0.004)
            pts.append(p)
        parts.append(sweep('cooler_louvre', pts, 0.0085, 4, 'metal', caps=True, smooth=False))
    # twin exhausts, angled aft and outboard
    for side in (1, -1):
        Y = -2.00
        p, nn = cowl_on(Y, cowl_q_top(Y, 0.31), side, 0.0)
        d = Vector((0.72 * side, -0.30, 0.63)).normalized()
        prof = [(0.100, -0.24), (0.100, 0.075), (0.105, 0.090), (0.099, 0.104), (0.086, 0.100),
                (0.082, 0.085), (0.082, -0.06)]
        mats = ['dark_trim', 'metal', 'rubber']
        pm = [0, 1, 1, 1, 1, 2]
        ex = lathe('exhaust', prof, 14, 'dark_trim', axis='Z', mats=mats, prof_mat=pm)
        xform(ex, frame_from(d, (0, 0, 1), p + d * 0.02))
        parts.append(ex)
        # soot-dark heat shield plate under each pipe
    # mast collar where the drive shaft leaves the deck
    ztop = COWL_T(-HUB.y)
    col = lathe('mast_collar', [(0.255, ztop - 0.07), (0.25, ztop + 0.0), (0.215, ztop + 0.07),
                                (0.16, ztop + 0.115), (0.105, ztop + 0.13), (0.0, ztop + 0.13)],
                24, 'paint_main', axis='Z', center=(0, HUB.y, 0))
    parts.append(col)
    return parts


# ============================================================================
# FENESTRON: shroud, duct, fan (rotor_tail), stators, fin, stabiliser
# ============================================================================
FEN_C = Vector((0.0, -5.17, 0.44))   # duct centre (Blender)
FEN_RD = 0.40                        # duct radius
FEN_LIP = 0.055
FEN_RH = FEN_RD + FEN_LIP
# The front of the shroud is a blunt, near-vertical face taller than the boom, so the boom
# enters through the full-thickness part of the rim in one clean ring instead of sliding
# along a pointed nose (which left a lumpy intersection).
FEN_OUT = [(-4.425, 0.48), (-4.445, 0.64), (-4.53, 0.775), (-4.72, 0.885), (-4.93, 0.985),
           (-5.12, 1.05), (-5.38, 1.09), (-5.64, 1.035), (-5.81, 0.85), (-5.865, 0.52),
           (-5.78, 0.20), (-5.56, -0.07), (-5.25, -0.19), (-4.95, -0.15), (-4.71, 0.04),
           (-4.53, 0.19), (-4.445, 0.32)]

def fen_t(Y):
    return 0.140 + 0.038 * smooth((Y + 5.75) / 1.3)

def build_shroud():
    O = [Vector(p) for p in catmull([Vector(p) for p in FEN_OUT], 4, closed=True)]
    O2 = [(p.x, p.y) for p in O]
    if signed_area(O2) < 0:
        O2 = list(reversed(O2))
    RR = 0.10
    I2 = offset_poly(O2, -RR)
    # the flat side face must keep a band of skin between the rim and the duct lip,
    # or the CDT folds over itself there (it left a crease on the shoulder before)
    clear = min((Vector(p) - Vector((FEN_C.y, FEN_C.z))).length for p in I2) - FEN_RH
    worst = min(I2, key=lambda p: (Vector(p) - Vector((FEN_C.y, FEN_C.z))).length)
    log('fenestron side-face clearance %.3f m at Y=%.3f z=%.3f' % (clear, worst[0], worst[1]))
    assert clear > 0.02, clear
    NH = 36
    H2 = [(FEN_C.y + FEN_RH * cos(2 * pi * k / NH), FEN_C.z + FEN_RH * sin(2 * pi * k / NH)) for k in range(NH)]
    # side faces: CDT of the inset outline minus the duct hole, with a few interior points
    pts = [Vector(p) for p in I2] + [Vector(p) for p in H2]
    fI = list(range(len(I2)))
    fH = list(range(len(I2), len(I2) + NH))
    res = geometry.delaunay_2d_cdt(pts, [], [fI, fH], 0, 1e-7)
    vo, eo, fo, ov, oe, of = res
    side_tris = [f for f, o in zip(fo, of) if 0 in o and 1 not in o]
    verts, faces, loopn = [], [], []
    vid = {}
    def V(p, n):
        key = (round(p.x, 5), round(p.y, 5), round(p.z, 5))
        j = vid.get(key)
        if j is None:
            j = len(verts); vid[key] = j; verts.append(p)
        return j
    for sgn in (1, -1):
        for f in side_tris:
            idx = []
            for i in f:
                Y, Z = vo[i][0], vo[i][1]
                idx.append(V(Vector((sgn * fen_t(Y), Y, Z)), None))
            a, b, c = idx
            nrm = (verts[b] - verts[a]).cross(verts[c] - verts[a])
            if nrm.x * sgn < 0:
                b, c = c, b
            faces.append((a, b, c)); loopn += [(sgn, 0, 0)] * 3
    # rounded rim round the outside
    NA = 8
    n = len(O2)
    ring = []
    for i in range(n):
        o = Vector(O2[i]); ii = Vector(I2[i])
        rad = (o - ii)
        L = rad.length
        rdir = rad / L
        t = fen_t(ii.x)
        col = []
        for k in range(NA + 1):
            a = pi * k / NA
            yz = ii + rad * sin(a)
            x = t * cos(a)
            nr = Vector((cos(a) / t, rdir.x * sin(a) / L, rdir.y * sin(a) / L)).normalized()
            col.append((Vector((x, yz.x, yz.y)), nr))
        ring.append(col)
    for i in range(n):
        j = (i + 1) % n
        for k in range(NA):
            q = [(i, k), (j, k), (j, k + 1), (i, k + 1)]
            idx = [V(ring[a][b][0], None) for a, b in q]
            nn = [tuple(ring[a][b][1]) for a, b in q]
            nrm = (verts[idx[1]] - verts[idx[0]]).cross(verts[idx[2]] - verts[idx[0]])
            if nrm.dot(Vector(nn[0]) + Vector(nn[2])) < 0:
                idx = list(reversed(idx)); nn = list(reversed(nn))
            faces.append(tuple(idx)); loopn += nn
    # duct: lips + barrel
    NL = 4
    t0 = fen_t(FEN_C.y)
    lip = []
    for k in range(NL + 1):
        b = (pi / 2) * k / NL
        r = FEN_RH - FEN_LIP * sin(b)
        x = (t0 - FEN_LIP) + FEN_LIP * cos(b)
        lip.append((r, x, Vector((-sin(b), cos(b)))))   # normal in (radial, x)
    rows = lip + [(r, -x, Vector((nv.x, -nv.y))) for (r, x, nv) in reversed(lip)]
    duct = []
    for (r, x, nv) in rows:
        col = []
        for k in range(NH):
            th = 2 * pi * k / NH
            cy, cz = cos(th), sin(th)
            Y = FEN_C.y + r * cy
            Z = FEN_C.z + r * cz
            xx = x
            if abs(abs(x) - t0) < 1e-6:          # lip edge: meet the side face exactly
                xx = copysign(fen_t(Y), x)
            p = Vector((xx, Y, Z))
            nrm = Vector((nv.y, nv.x * cy, nv.x * cz)).normalized()
            col.append((p, nrm))
        duct.append(col)
    for i in range(len(duct) - 1):
        for k in range(NH):
            k2 = (k + 1) % NH
            q = [(i, k), (i, k2), (i + 1, k2), (i + 1, k)]
            idx = [V(duct[a][b][0], None) for a, b in q]
            nn = [tuple(duct[a][b][1]) for a, b in q]
            nrm = (verts[idx[1]] - verts[idx[0]]).cross(verts[idx[2]] - verts[idx[0]])
            if nrm.dot(Vector(nn[0]) + Vector(nn[2])) < 0:
                idx = list(reversed(idx)); nn = list(reversed(nn))
            faces.append(tuple(idx)); loopn += nn
    ob = mesh_object('shroud', verts, faces, ['paint_main'], loop_normals=loopn)
    return ob

def build_fin():
    st = []
    # root section tilted to follow the shroud's top edge; the rest level
    rows = [(-5.02, 0.93, 0.725, -0.10), (-5.17, 1.20, 0.64, 0.0), (-5.33, 1.50, 0.55, 0.0),
            (-5.38, 1.585, 0.525, 0.0), (-5.455, 1.72, 0.49, 0.0), (-5.53, 1.85, 0.45, 0.0)]
    for (le_y, z, chord, tilt) in rows:
        f = (z - 0.93) / (1.85 - 0.93)
        cd = Vector((0, -1, tilt)).normalized()
        st.append({'le': Vector((0, le_y, z)), 'chord_dir': cd,
                   'thick_dir': Vector((1, 0, 0)), 'chord': chord, 't': lerp(0.13, 0.10, f)})
    fm = [0, 0, 0, 1, 1]
    ob = airfoil_surface('fin', st, ['paint_main', 'paint_accent'], face_mat=fm + [1], npts=11,
                         cap_tip=True)
    fix_normals(ob)
    sharpen(ob, 40)
    # beacon plinth on the fin tip
    tip_mid = Vector((0, -5.53 - 0.45 * 0.40, 1.85))
    plinth = lathe('beacon_base', [(0.038, 1.83), (0.040, 1.87), (0.034, 1.885), (0.0, 1.885)],
                   16, 'dark_trim', center=(0, tip_mid.y, 0))
    return [ob, plinth], tip_mid

def build_stabiliser():
    parts = []
    st = []
    for x in (-1.03, -0.7, -0.3, 0.0, 0.3, 0.7, 1.03):
        f = abs(x) / 1.03
        st.append({'le': Vector((x, lerp(-3.80, -3.845, f), 0.47)), 'chord_dir': Vector((0, -1, 0)),
                   'thick_dir': Vector((0, 0, 1)), 'chord': lerp(0.47, 0.41, f), 't': 0.13, 'cam': -0.025})
    ob = airfoil_surface('stab', st, ['paint_main'], npts=11, cap_tip=True, cap_root=True)
    fix_normals(ob); sharpen(ob, 40)
    parts.append(ob)
    lights = {}
    for sgn in (1, -1):
        est = []
        for z in (0.27, 0.47, 0.71):
            f = (z - 0.27) / 0.44
            est.append({'le': Vector((sgn * 1.045, lerp(-3.76, -3.86, f), z)), 'chord_dir': Vector((0, -1, 0)),
                        'thick_dir': Vector((1, 0, 0)), 'chord': lerp(0.40, 0.32, f), 't': 0.09})
        ep = airfoil_surface('endplate', est, ['paint_accent'], npts=11, cap_tip=True, cap_root=True)
        fix_normals(ep); sharpen(ep, 40)
        parts.append(ep)
        # nav light pod on the outboard face
        c = Vector((sgn * (1.045 + 0.016), -3.965, 0.50))
        lights[sgn] = c
    return parts, lights

def build_fan():
    """rotor_tail geometry in LOCAL coords (origin = fan hub, spins about local X)."""
    parts = []
    NB = 10
    x_fan = 0.0
    for k in range(NB):
        th = 2 * pi * k / NB + radians(9)
        er = Vector((0, cos(th), sin(th)))
        et = Vector((0, -sin(th), cos(th)))      # direction of +X rotation
        st = []
        for r in (0.085, 0.19, 0.30, 0.392):
            f = (r - 0.085) / (0.392 - 0.085)
            pitch = radians(lerp(32, 18, f))
            chord = lerp(0.080, 0.066, f)
            cd = (-et * cos(pitch) + Vector((1, 0, 0)) * sin(pitch)).normalized()
            td = (Vector((1, 0, 0)) * cos(pitch) + et * sin(pitch)).normalized()
            le = er * r + et * chord * 0.45 + Vector((x_fan, 0, 0)) - cd * 0.0
            st.append({'le': le, 'chord_dir': cd, 'thick_dir': td, 'chord': chord, 't': 0.10})
        b = airfoil_surface('fan_blade', st, ['blade'], npts=5, cap_tip=True, cap_root=True)
        fix_normals(b); sharpen(b, 50)
        parts.append(b)
    hub = lathe('fan_hub', [(0.0, -0.105), (0.045, -0.098), (0.078, -0.075), (0.095, -0.04),
                            (0.098, 0.0), (0.098, 0.035), (0.0, 0.035)], 24, 'metal', axis='X')
    parts.append(hub)
    return parts

def build_stators():
    parts = []
    c = FEN_C
    # gearbox fairing on the exhaust (right) side
    gb = lathe('tail_gearbox', [(0.0, 0.030), (0.100, 0.030), (0.100, 0.09), (0.086, 0.13),
                                (0.050, 0.155), (0.0, 0.162)], 24, 'dark_trim', axis='X',
               center=(0, c.y, c.z))
    parts.append(gb)
    for k in range(9):
        th = 2 * pi * k / 9 + radians(20)
        er = Vector((0, cos(th), sin(th)))
        thick = 0.012
        mid_r = (0.095 + FEN_RD) / 2
        ctr = c + er * mid_r + Vector((0.085, 0, 0))
        et = Vector((0, -sin(th), cos(th)))
        xa = (Vector((1, 0, 0)) * cos(radians(18)) + et * sin(radians(18))).normalized()
        parts.append(orient_box('stator', (0.085, thick, FEN_RD - 0.09), ctr, xa, er, 'dark_trim', r=0.004, seg=1))
    # drive-shaft fairing: the one thick vane pointing up the boom
    er = Vector((0, 1, 0))
    ctr = c + er * ((0.09 + FEN_RD) / 2) + Vector((0.06, 0, 0))
    parts.append(orient_box('shaft_fairing', (0.10, 0.05, FEN_RD - 0.08), ctr, (1, 0, 0), er, 'dark_trim', r=0.012))
    return parts

def build_tail_guard():
    """Small ventral fin / tail bumper; its lowest aft point is the game's tail-strike point."""
    st = []
    for (le_y, z, chord) in ((-5.36, 0.02, 0.36), (-5.50, -0.10, 0.24), (-5.585, -0.155, 0.13)):
        st.append({'le': Vector((0, le_y, z)), 'chord_dir': Vector((0, -1, -0.12)).normalized(),
                   'thick_dir': Vector((1, 0, 0)), 'chord': chord, 't': 0.16})
    ob = airfoil_surface('ventral', st, ['dark_trim'], npts=9, cap_tip=True, cap_root=True)
    fix_normals(ob); sharpen(ob, 40)
    return ob


# ============================================================================
# Blocks that sit on the curved skin (bottom/top follows the pod surface)
# ============================================================================
def conform_block(name, cx, cy, sx, sy, z_free, mat, attach='top', r=0.025, embed=0.025, side=1):
    """A rounded-rectangle prism. attach='top': its upper cap is sunk into the pod's upper
    surface and it hangs down to z_free... 'bottom': its lower cap sits in the upper skin
    and it rises to z_free. 'belly': upper cap in the lower skin, hangs to z_free."""
    fp = []
    for (px, py, a0) in ((sx / 2 - r, sy / 2 - r, 0), (-sx / 2 + r, sy / 2 - r, 90),
                         (-sx / 2 + r, -sy / 2 + r, 180), (sx / 2 - r, -sy / 2 + r, 270)):
        for k in range(4):
            a = radians(a0 + 90 * k / 3)
            fp.append((cx + px + r * cos(a), cy + py + r * sin(a)))
    n = len(fp)
    skin, free = [], []
    for (x, y) in fp:
        if attach == 'belly':
            zs = pod_z_bot(y, x) + embed
        else:
            zs = pod_z_top(y, x) - embed
        skin.append(Vector((x, y, zs)))
        free.append(Vector((x, y, z_free)))
    verts = skin + free
    faces = [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    faces.append(tuple(range(n)))
    faces.append(tuple(n + k for k in reversed(range(n))))
    ob = mesh_object(name, verts, faces, [mat])
    fix_normals(ob)
    sharpen(ob, 40)
    return ob


# ============================================================================
# SKIDS
# ============================================================================
SKID_X = MAIN_CONTACT.x
SKID_R = 0.045
SK_K = (NOSE_CONTACT.z - MAIN_CONTACT.z) / (NOSE_CONTACT.y - MAIN_CONTACT.y) ** 2
CROSS_Y = (0.88, -0.86)

def skid_bottom(Y):
    """Skid underside: touches the game's main contact (y=-0.6875) and nose contact
    (y=+1.25) exactly, on a 30 m-radius rocker (reads as straight)."""
    return MAIN_CONTACT.z + SK_K * (Y - MAIN_CONTACT.y) ** 2

def build_skids():
    parts = []
    for sgn in (1, -1):
        pts = []
        for i in range(7):
            Y = -1.62 + (1.56 + 1.62) * i / 6
            pts.append(Vector((sgn * SKID_X, Y, skid_bottom(Y) + SKID_R)))
        Y0 = 1.56
        z0 = skid_bottom(Y0) + SKID_R
        a0 = math.atan(2 * SK_K * (Y0 - MAIN_CONTACT.y))
        Rb = 0.30
        C = Vector((Y0 - Rb * sin(a0), z0 + Rb * cos(a0)))
        a1 = a0 + radians(64)
        for k in range(1, 7):
            a = a0 + (a1 - a0) * k / 6
            p = C + Rb * Vector((sin(a), -cos(a)))
            pts.append(Vector((sgn * SKID_X, p.x, p.y)))
        tip = pts[-1] + Vector((0, cos(a1), sin(a1))) * 0.07
        pts.append(tip)
        parts.append(sweep('skid', pts, SKID_R, 10, 'metal'))
        # wear shoes under the skid, flush with the contact line
        for Yc in (-0.6875, 1.0):
            pass
    for Yc in CROSS_Y:
        zc = skid_bottom(Yc) + SKID_R
        right = [(SKID_X, zc - 0.005), (SKID_X - 0.012, zc + 0.13), (SKID_X - 0.065, zc + 0.30),
                 (1.245, -1.19), (1.05, -1.09), (0.80, -1.053), (0.45, -1.043), (0.0, -1.040)]
        left = [(-x, z) for (x, z) in reversed(right[:-1])]
        path = [Vector((x, Yc, z)) for (x, z) in right + left[::-1][::-1]]
        path = [Vector((x, Yc, z)) for (x, z) in right] + [Vector((-x, Yc, z)) for (x, z) in reversed(right[:-1])]
        path = [Vector((0, 0, 0))] * 0 + path
        path = catmull(path, 2)
        path.reverse()
        parts.append(sweep('cross_tube', path, 0.048, 9, 'metal'))
        for sgn in (1, -1):
            # belly mounting fairing
            parts.append(conform_block('xt_mount', sgn * 0.47, Yc, 0.17, 0.24, -1.062, 'dark_trim',
                                       attach='belly', r=0.05, embed=0.03))
            # saddle clamp round the skid
            parts.append(rbox('saddle', (0.105, 0.13, 0.06), (sgn * SKID_X, Yc, zc + 0.03), 'dark_trim', 0.018, 1))
            # boarding step on the leg
            parts.append(rbox('step', (0.135, 0.36, 0.022), (sgn * 1.452, Yc, -1.300), 'metal', 0.006, 1))
            parts.append(rbox('tread', (0.115, 0.32, 0.008), (sgn * 1.452, Yc, -1.286), 'rubber', 0.002, 1))
            parts.append(rbox('step_arm', (0.10, 0.035, 0.03), (sgn * 1.40, Yc, -1.318), 'metal', 0.006, 1))
    return parts


# ============================================================================
# MAIN ROTOR (local coordinates about the hub; rotor_main spins about local +Z)
# ============================================================================
BLADE_AZ = [radians(45 + 90 * k) for k in range(4)]

def blade_frame(al):
    er = Vector((cos(al), sin(al), 0))
    et = Vector((-sin(al), cos(al), 0))      # direction of travel for +Z rotation
    return er, et

def build_blade(al):
    er, et = blade_frame(al)
    Zv = Vector((0, 0, 1))
    radii = [0.80, 1.00, 2.2, 3.70, 3.82, 3.93, 4.03, 4.11, 4.165, ROTOR_R]
    st, fm = [], []
    droop = math.tan(radians(1.0))
    for r in radii:
        if r < 1.0:
            chord = lerp(0.20, 0.235, (r - 0.80) / 0.20)
        elif r <= 3.93:
            chord = lerp(0.235, 0.205, (r - 0.96) / (3.93 - 0.96))
        else:
            u = (r - 3.93) / (ROTOR_R - 3.93)
            chord = 0.205 - 0.115 * u ** 1.7
        sweepb = 0.0 if r <= 3.93 else 0.11 * ((r - 3.93) / (ROTOR_R - 3.93)) ** 2
        p = radians(lerp(8.0, 0.0, (r - 0.74) / (ROTOR_R - 0.74)))
        cd = (-et * cos(p) - Zv * sin(p))
        td = (Zv * cos(p) - et * sin(p))
        le = er * r + et * (0.25 * 0.27 - sweepb) - Zv * (r * droop)
        # keep the quarter-chord line straight: LE sits 0.25*chord ahead of the pitch axis
        le = er * r + et * (0.25 * chord - sweepb) - Zv * (r * droop) + td * 0.0
        st.append({'le': le, 'chord_dir': cd, 'thick_dir': td, 'chord': chord,
                   't': lerp(0.12, 0.09, (r - 0.74) / (ROTOR_R - 0.74))})
    for i in range(len(radii) - 1):
        rm = 0.5 * (radii[i] + radii[i + 1])
        fm.append(0 if rm < 3.70 else (1 if rm < 3.82 else 2))
    LE = (npts_b := 9) - 1
    def fmf(i, k):
        if fm[i] > 0:
            return fm[i]
        return 3 if k in (LE - 1, LE) and i > 0 else 0
    ob = airfoil_surface('blade', st, ['blade', 'paint_white', 'paint_accent', 'metal'],
                         face_mat=fm + [2], npts=npts_b, cap_tip=True, cap_root=True, fm_fn=fmf)
    fix_normals(ob)
    sharpen(ob, 42)
    return ob

def build_rotor_main():
    parts = []
    parts.append(lathe('mast', [(0.0, -0.64), (0.063, -0.64), (0.063, -0.10), (0.072, -0.085),
                                (0.072, -0.06), (0.0, -0.06)], 20, 'metal'))
    # rotating swashplate
    parts.append(lathe('swash_rot', [(0.07, -0.368), (0.172, -0.368), (0.178, -0.358), (0.178, -0.340),
                                     (0.17, -0.332), (0.07, -0.332)], 22, 'metal'))
    # hub body and cap
    parts.append(lathe('hub', [(0.0, -0.095), (0.150, -0.095), (0.185, -0.065), (0.190, 0.040),
                               (0.165, 0.075), (0.0, 0.075)], 24, 'dark_trim'))
    parts.append(lathe('hub_cap', [(0.150, 0.070), (0.148, 0.105), (0.126, 0.145), (0.086, 0.172),
                                   (0.040, 0.184), (0.0, 0.186)], 24, 'metal'))
    # scissor link (drives the rotating swashplate)
    parts.append(orient_box('scissor_a', (0.035, 0.02, 0.17), (0.0, 0.10, -0.25), (1, 0, 0),
                            (0, 0.45, 1), 'dark_trim', r=0.005, seg=1))
    parts.append(orient_box('scissor_b', (0.035, 0.02, 0.15), (0.0, 0.115, -0.13), (1, 0, 0),
                            (0, -0.35, 1), 'dark_trim', r=0.005, seg=1))
    droop = math.tan(radians(1.0))
    for al in BLADE_AZ:
        er, et = blade_frame(al)
        Zv = Vector((0, 0, 1))
        # flex-beam arm (flat, dark) + streamlined control cuff
        rings = []
        # chord / thickness keyed at five stations, sampled on nine rings with a monotone
        # spline so the cuff's long taper shades as one smooth surface (five rings banded)
        KR = (0.13, 0.28, 0.48, 0.68, 0.84)
        f_ch = pchip(KR, (0.15, 0.20, 0.235, 0.225, 0.205))
        f_th = pchip(KR, (0.120, 0.110, 0.085, 0.058, 0.036))
        for r in (0.13, 0.20, 0.28, 0.38, 0.48, 0.58, 0.68, 0.76, 0.84):
            ch, th = f_ch(r), f_th(r)
            ring = []
            p = radians(7.5)
            cd = (-et * cos(p) - Zv * sin(p)); td = (Zv * cos(p) - et * sin(p))
            c = er * r - Zv * (r * droop)
            for k in range(14):
                a = 2 * pi * k / 14
                ca, sa = cos(a), sin(a)
                # rounded super-ellipse section (n=2.6), centred on the pitch axis
                x = copysign(abs(ca) ** (2 / 2.6), ca)
                y = copysign(abs(sa) ** (2 / 2.6), sa)
                ring.append(c + cd * (0.5 * ch * x - 0.0 * ch) + td * (0.5 * th * y))
            rings.append(ring)
        cuff = loft_rings('cuff', rings, ['dark_trim'], closed=True, cap0=True, cap1=True)
        fix_normals(cuff); sharpen(cuff, 70)
        parts.append(cuff)
        # pitch horn and pitch link down to the swashplate
        horn_end = er * 0.21 + et * 0.13 - Zv * 0.035
        parts.append(orient_box('horn', (0.13, 0.03, 0.025), er * 0.21 + et * 0.07 - Zv * 0.03,
                                et, Zv, 'dark_trim', r=0.006, seg=1))
        al2 = al + radians(34)
        base = Vector((cos(al2), sin(al2), 0)) * 0.155 + Vector((0, 0, -0.332))
        top = horn_end
        parts.append(sweep('pitch_link', [base, top], 0.0105, 6, 'metal'))
        parts.append(build_blade(al))
    return parts

def build_swash_fixed():
    """Non-rotating half of the swashplate with its three servo rods (world coords, on body)."""
    parts = []
    z0 = HUB.z
    parts.append(lathe('swash_fixed', [(0.075, z0 - 0.415), (0.188, z0 - 0.415), (0.196, z0 - 0.405),
                                       (0.196, z0 - 0.382), (0.186, z0 - 0.372), (0.075, z0 - 0.372)],
                       22, 'dark_trim', center=(0, HUB.y, 0)))
    ztop = COWL_T(-HUB.y) + 0.10
    for k in range(3):
        a = radians(90 + 120 * k)
        base = Vector((HUB.x + 0.15 * cos(a), HUB.y + 0.15 * sin(a), ztop - 0.02))
        top = Vector((base.x, base.y, z0 - 0.41))
        parts.append(sweep('servo', [base, top], 0.016, 8, 'metal'))
        parts.append(lathe('servo_body', [(0.0, ztop - 0.05), (0.03, ztop - 0.05), (0.03, ztop + 0.02),
                                          (0.0, ztop + 0.02)], 10, 'dark_trim', center=(base.x, base.y, 0)))
    return parts

def build_blur():
    segs = 48
    verts, faces = [], []
    for k in range(segs):
        a = 2 * pi * k / segs
        verts.append(Vector((0.40 * cos(a), 0.40 * sin(a), -0.03)))
        verts.append(Vector((ROTOR_R * cos(a), ROTOR_R * sin(a), -0.03 - ROTOR_R * math.tan(radians(0.5)))))
    for k in range(segs):
        k2 = (k + 1) % segs
        faces.append((2 * k, 2 * k + 1, 2 * k2 + 1, 2 * k2))
    ob = mesh_object('rotor_main_blur', verts, faces, ['rotor_blur'], smooth=False)
    return ob


# ============================================================================
# RESCUE HOIST
# ============================================================================
HOIST = Vector((1.20, -0.25, 1.17))

def build_hoist():
    parts = []
    parts.append(conform_block('hoist_post', 0.61, HOIST.y, 0.12, 0.14, 1.02, 'paint_white',
                               attach='bottom', r=0.03, embed=0.03))
    A = Vector((0.61, HOIST.y, 0.985))
    B = Vector((HOIST.x - 0.03, HOIST.y, HOIST.z + 0.035))
    mid = (A + B) / 2
    parts.append(orient_box('hoist_arm', ((B - A).length + 0.05, 0.07, 0.062), mid, B - A, (0, 0, 1),
                            'paint_white', r=0.014, seg=3))
    # diagonal brace from the post foot to the arm
    b0, _ = on_pod(HOIST.y, 0.70, 1, -0.01)
    parts.append(sweep('hoist_brace', [b0, Vector((1.0, HOIST.y, 1.10))], 0.016, 8, 'dark_trim'))
    parts.append(lathe('hoist_drum', [(0.0, -0.26), (0.062, -0.26), (0.090, -0.252), (0.105, -0.228),
                                      (0.105, 0.228), (0.090, 0.252), (0.062, 0.26), (0.0, 0.26)],
                       18, 'paint_white', axis='Y', center=tuple(HOIST)))
    for h in (-0.16, 0.12):
        parts.append(lathe('hoist_band', [(0.104, h - 0.018), (0.109, h - 0.014), (0.109, h + 0.014),
                                          (0.104, h + 0.018)], 14, 'dark_trim', axis='Y', center=tuple(HOIST)))
    parts.append(rbox('cable_guide', (0.07, 0.09, 0.05), (HOIST.x, HOIST.y, HOIST.z - 0.115), 'dark_trim', 0.012))
    return parts

CABLE_TOP = Vector((HOIST.x, HOIST.y, HOIST.z - 0.14))
CABLE_LEN = 0.50

def build_cable():
    return lathe('winch_cable', [(0.0065, 0.0), (0.0065, -CABLE_LEN)], 6, 'metal', smooth=True)

def build_hook():
    parts = []
    parts.append(lathe('hook_swivel', [(0.0, 0.0), (0.016, 0.0), (0.020, -0.012), (0.020, -0.045),
                                       (0.0, -0.045)], 12, 'metal'))
    parts.append(lathe('hook_weight', [(0.0, -0.045), (0.036, -0.047), (0.050, -0.065), (0.052, -0.15),
                                       (0.040, -0.172), (0.0, -0.178)], 18, 'paint_accent'))
    pts = [Vector((0, 0, -0.17)), Vector((0, 0, -0.235))]
    cz = -0.265; R = 0.035
    for k in range(9):
        a = radians(180 + 200 * k / 8)
        pts.append(Vector((0.035 + R * cos(a), 0, cz + R * sin(a))))
    parts.append(sweep('hook', pts, 0.011, 8, 'metal'))
    parts.append(sweep('hook_latch', [Vector((0.004, 0, -0.215)), Vector((0.058, 0, -0.245))], 0.004, 4, 'metal'))
    return parts


# ============================================================================
# SEARCHLIGHT (under the nose)
# ============================================================================
SL_Y = 2.20

def searchlight_pivot():
    zb = pod_z_bot(SL_Y, 0.0)
    return Vector((0.0, SL_Y, zb - 0.055))

def build_searchlight_mount():
    zb = pod_z_bot(SL_Y, 0.0)
    return [lathe('sl_turret', [(0.0, zb + 0.03), (0.078, zb + 0.03), (0.078, zb - 0.035),
                                (0.066, zb - 0.052), (0.0, zb - 0.052)], 20, 'dark_trim',
                  center=(0, SL_Y, 0))]

def build_searchlight():
    """Local coords, origin at the pivot under the turret."""
    parts = []
    parts.append(rbox('sl_yoke_top', (0.25, 0.05, 0.02), (0, 0, -0.008), 'dark_trim', 0.005))
    for sgn in (1, -1):
        parts.append(rbox('sl_yoke_arm', (0.018, 0.05, 0.14), (sgn * 0.115, 0, -0.072), 'dark_trim', 0.005))
        parts.append(lathe('sl_pin', [(0.0, -0.02), (0.018, -0.02), (0.018, 0.02), (0.0, 0.02)], 10, 'metal',
                           axis='X', center=(sgn * 0.113, 0, -0.12)))
    lamp = lathe('sl_lamp', [(0.0, -0.13), (0.05, -0.128), (0.076, -0.10), (0.087, -0.05),
                             (0.090, 0.075), (0.097, 0.088), (0.097, 0.104), (0.083, 0.108)],
                 18, 'dark_trim', axis='Y', mats=['dark_trim', 'metal'], prof_mat=[0, 0, 0, 0, 1, 1, 1])
    lens = lathe('sl_lens', [(0.0, 0.112), (0.045, 0.110), (0.083, 0.104)], 18, 'light_white', axis='Y')
    M = Matrix.Translation((0, 0, -0.12)) @ Matrix.Rotation(radians(-12), 4, 'X')
    xform(lamp, M); xform(lens, M)
    parts += [lamp, lens]
    return parts


# ============================================================================
# COCKPIT AND CABIN INTERIOR (seen through the glass; no crew)
# ============================================================================
def build_interior():
    parts = []
    # floor
    zf = -0.74
    ys = [2.40, 2.2, 1.9, 1.5, 1.0, 0.0, -1.0, -1.18]
    L, R = [], []
    for Y in ys:
        x = pod_x_at_z(Y, zf) - 0.075
        L.append(Vector((-x, Y, zf))); R.append(Vector((x, Y, zf)))
    verts = R + L
    n = len(ys)
    faces = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
    fl = mesh_object('floor', verts, faces, ['interior'], smooth=False)
    fix_normals(fl)
    if fl.data.polygons[0].normal.z < 0:
        fl.data.flip_normals()
    parts.append(fl)
    # instrument panel, glare shield, displays
    tilt = radians(14)
    parts.append(orient_box('panel', (1.22, 0.42, 0.13), (0, 2.08, -0.01), (1, 0, 0),
                            (0, -cos(tilt), sin(tilt)), 'dark_trim', r=0.02, seg=2))
    parts.append(orient_box('glareshield', (1.30, 0.26, 0.04), (0, 2.02, 0.215), (1, 0, 0),
                            (0, 0.12, 1), 'dark_trim', r=0.015, seg=2))
    for x in (-0.44, -0.18, 0.18, 0.44):
        c = Vector((x, 2.08, -0.01)) + Vector((0, -cos(tilt), sin(tilt))) * 0.067
        parts.append(orient_box('display', (0.20, 0.155, 0.006), c, (1, 0, 0),
                                (0, -cos(tilt), sin(tilt)), 'screen', r=0.0, seg=1))
    # centre console
    parts.append(orient_box('console', (0.24, 0.62, 0.30), (0, 1.80, -0.50), (1, 0, 0),
                            (0, -0.35, 1), 'dark_trim', r=0.02, seg=2))
    parts.append(orient_box('console_screen', (0.15, 0.20, 0.006), (0, 1.74, -0.335), (1, 0, 0),
                            (0, -0.35, 1), 'screen', r=0.0, seg=1))
    # crew seats
    for x in (EYE.x, -EYE.x):
        parts.append(rbox('seat_base', (0.40, 0.42, 0.26), (x, 1.24, -0.605), 'dark_trim', 0.02))
        parts.append(rbox('seat_pan', (0.46, 0.48, 0.10), (x, 1.24, -0.425), 'interior', 0.035, 2))
        back = rbox('seat_back', (0.46, 0.10, 0.72), (0, 0, 0), 'interior', 0.035, 2)
        xform(back, Matrix.Translation((x, 0.975, 0.02)) @ Matrix.Rotation(radians(12), 4, 'X'))
        parts.append(back)
        head = rbox('headrest', (0.27, 0.09, 0.17), (0, 0, 0), 'interior', 0.03, 2)
        xform(head, Matrix.Translation((x, 0.905, 0.50)) @ Matrix.Rotation(radians(12), 4, 'X'))
        parts.append(head)
        # cyclic
        stick = [Vector((x, 1.60, zf)), Vector((x, 1.585, -0.30)), Vector((x, 1.555, -0.13))]
        parts.append(sweep('cyclic', catmull(stick, 3), 0.014, 8, 'dark_trim'))
        parts.append(sweep('cyclic_grip', [Vector((x, 1.555, -0.13)), Vector((x, 1.54, -0.02))], 0.022, 8, 'rubber'))
        # collective on the left of each seat
        cx = x - 0.27
        parts.append(sweep('collective', [Vector((cx, 1.02, -0.64)), Vector((cx, 1.46, -0.40))], 0.014, 8, 'dark_trim'))
        parts.append(sweep('collective_grip', [Vector((cx, 1.40, -0.43)), Vector((cx, 1.52, -0.365))], 0.024, 8, 'rubber'))
        # pedals
        for dx in (-0.1, 0.1):
            p = orient_box('pedal', (0.07, 0.13, 0.02), (x + dx, 2.17, -0.58), (1, 0, 0), (0, -1, 0.9), 'dark_trim', r=0.0, seg=1)
            parts.append(p)
    # rear bench, three places, facing forward
    parts.append(rbox('bench_base', (1.30, 0.42, 0.28), (0, -0.78, -0.60), 'dark_trim', 0.02))
    parts.append(rbox('bench_pan', (1.36, 0.48, 0.10), (0, -0.76, -0.41), 'interior', 0.035, 2))
    back = rbox('bench_back', (1.36, 0.10, 0.70), (0, 0, 0), 'interior', 0.035, 2)
    xform(back, Matrix.Translation((0, -1.03, 0.02)) @ Matrix.Rotation(radians(8), 4, 'X'))
    parts.append(back)
    for x in (-0.45, 0.0, 0.45):
        h = rbox('bench_head', (0.25, 0.08, 0.16), (0, 0, 0), 'interior', 0.03, 1)
        xform(h, Matrix.Translation((x, -1.075, 0.47)) @ Matrix.Rotation(radians(8), 4, 'X'))
        parts.append(h)
    return parts


# ============================================================================
# SMALL DETAILS: pitots, wipers, handles, rail, antennas, lights
# ============================================================================
def build_details():
    parts = []
    for side in (1, -1):
        # pitot tube on the nose cheek
        p, n = on_pod(2.70, -0.29, side, 0.0)
        a = p + n * 0.05
        b = a + Vector((0, 0.11, 0))
        parts.append(sweep('pitot', [p - n * 0.01, a, b], 0.0065, 6, 'metal'))
        parts.append(lathe('pitot_base', [(0.0, 0.0), (0.022, 0.0), (0.016, 0.02), (0.0, 0.02)], 10,
                           'dark_trim'))
        xform(parts[-1], frame_from(n, (0, 1, 0), p - n * 0.005))
        # windscreen wiper (parked along the lower frame)
        path = surface_path([('z', 2.53, -0.075), ('z', 2.18, -0.21)], 0.014, side, 0.04)
        parts.append(sweep('wiper', path, 0.0075, 4, 'dark_trim', smooth=False))
        pv, pn = on_pod(2.53, -0.075, side, 0.0)
        parts.append(lathe('wiper_hub', [(0.0, 0.0), (0.018, 0.0), (0.016, 0.018), (0.0, 0.02)], 10, 'dark_trim'))
        xform(parts[-1], frame_from(pn, (0, 1, 0), pv))
        # door handles
        for (Y, z, L) in ((0.78, -0.42, 0.12), (0.36, -0.33, 0.15)):
            c, n2 = on_pod(Y, z, side, 0.014)
            parts.append(orient_box('handle', (L, 0.022, 0.018), c, (0, 1, 0), n2, 'metal', r=0.006, seg=1))
        # sliding-door sill rail
        path = surface_path([('z', 0.50, -0.705), ('z', -1.80, -0.705)], 0.012, side, 0.25)
        parts.append(sweep('door_rail', path, 0.011, 5, 'dark_trim'))
    # blade antennas: boom top, belly, cabin roof
    def blade_ant(name, base, up, fwd, h, c0, c1, back):
        st = []
        for (f, ch) in ((0.0, c0), (1.0, c1)):
            le = base + up * (h * f) - fwd * (back * f) + fwd * (0.35 * ch)
            st.append({'le': le, 'chord_dir': -fwd, 'thick_dir': up.cross(fwd).normalized(), 'chord': ch, 't': 0.14})
        ob = airfoil_surface(name, st, ['dark_trim'], npts=7, cap_tip=True, cap_root=True)
        fix_normals(ob); sharpen(ob, 40)
        return ob
    zt = pod_prof(-3.40)[0]
    parts.append(blade_ant('ant_boom', Vector((0, -3.40, zt - 0.02)), Vector((0, 0, 1)), Vector((0, 1, 0)),
                           0.20, 0.17, 0.07, 0.10))
    zb = pod_z_bot(-0.50, 0.0)
    parts.append(blade_ant('ant_belly', Vector((0, -0.50, zb + 0.02)), Vector((0, 0, -1)), Vector((0, 1, 0)),
                           0.16, 0.16, 0.07, 0.08))
    zr = pod_z_top(1.16, 0.0)
    parts.append(blade_ant('ant_roof', Vector((0, 1.16, zr - 0.02)), Vector((0, 0, 1)), Vector((0, 1, 0)),
                           0.12, 0.12, 0.05, 0.06))
    # GPS puck on the aft deck
    zc = COWL_T(0.72)
    parts.append(dome('gps', (0, -0.72, zc - 0.004), (0, 0, 1), 0.055, 0.022, 16, 3, 'paint_white'))
    return parts

def light_dome(name, center, axis, r, h, mat):
    ob = dome(name, (0, 0, 0), axis, r, h, 12, 3, mat)
    ob.location = Vector(center)
    return ob


# ============================================================================
# ASSEMBLY, EXPORT, VERIFICATION
# ============================================================================
def ensure_custom_normals(ob):
    me = ob.data
    if not me.has_custom_normals:
        cn = [tuple(c.vector) for c in me.corner_normals]
        me.normals_split_custom_set(cn)

def join(name, obs, location=None):
    """Join meshes into one object; geometry stays where it is in world space,
    then the object origin is moved to `location` (geometry compensated)."""
    obs = [o for o in obs if o is not None]
    for o in obs:
        if o.name not in bpy.context.scene.collection.objects:
            pass
        o.parent = None
        bake_transform(o)
        ensure_custom_normals(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    if location is not None:
        ob.data.transform(Matrix.Translation(-Vector(location)))
        ob.location = Vector(location)
    return ob

def tri_count(ob):
    me = ob.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)

def build_all():
    reset()
    build_materials()
    root = bpy.data.objects.new('skyhook', None)
    root.empty_display_type = 'ARROWS'
    root.empty_display_size = 1.0
    link(root)

    body_parts = []
    pod, glass = build_pod()
    body_parts.append(pod)
    interior_parts = [build_inner_shell()]
    body_parts += build_cowl()
    body_parts.append(build_shroud())
    fin_parts, fin_tip = build_fin()
    body_parts += fin_parts
    stab_parts, nav = build_stabiliser()
    body_parts += stab_parts
    body_parts += build_stators()
    body_parts.append(build_tail_guard())
    body_parts += build_skids()
    body_parts += build_swash_fixed()
    body_parts += build_hoist()
    body_parts += build_searchlight_mount()
    interior_parts += build_interior()
    body_parts += build_details()
    rotor_parts = build_rotor_main()

    def report(label, parts, top=30):
        agg = {}
        for o in parts:
            key = o.name.split('.')[0]
            agg[key] = agg.get(key, 0) + tri_count(o)
        log('%s: %d parts, %d tris' % (label, len(parts), sum(agg.values())))
        for k, v in sorted(agg.items(), key=lambda kv: -kv[1])[:top]:
            log('      part %-16s %6d' % (k, v))
    report('body', body_parts)
    report('interior', interior_parts, 12)
    report('rotor_main', rotor_parts, 12)

    body = join('body', body_parts)
    interior = join('interior', interior_parts)
    glass = join('glass', [glass])
    rotor = join('rotor_main', rotor_parts, None)
    rotor.location = HUB
    blur = build_blur()
    blur.location = HUB
    fan = join('rotor_tail', build_fan(), None)
    FAN_POS = FEN_C + Vector((-0.03, 0, 0))
    fan.location = FAN_POS
    sl = join('searchlight', build_searchlight(), None)
    sl.location = searchlight_pivot()
    cable = build_cable()
    cable.location = CABLE_TOP
    hook = join('winch_hook', build_hook(), None)
    hook.location = CABLE_TOP - Vector((0, 0, CABLE_LEN))
    lr = light_dome('light_nav_red', nav[-1], (-1, 0, 0), 0.030, 0.024, 'light_red')
    lg = light_dome('light_nav_green', nav[1], (1, 0, 0), 0.030, 0.024, 'light_green')
    tail_c = Vector((0.0, -5.862, 0.52))
    lw = light_dome('light_nav_white', tail_c, (0, -1, 0), 0.028, 0.022, 'light_white')
    lb = light_dome('light_beacon', fin_tip + Vector((0, 0, 0.035)), (0, 0, 1), 0.034, 0.050, 'light_red')
    for ob in (body, interior, glass, rotor, blur, fan, sl, cable, hook, lr, lg, lw, lb):
        ob.parent = root
    return root

def verify_scene():
    info = {}
    total = 0
    for ob in bpy.data.objects:
        if ob.type == 'MESH':
            n = tri_count(ob)
            total += n
            info[ob.name] = n
    return total, info

def export_glb(root):
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for c in root.children_recursive:
        c.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_cameras=False,
                              export_lights=False, export_animations=False, export_extras=False,
                              export_normals=True, export_tangents=False, export_materials='EXPORT')

def reimport_check():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=OUT_GLB)
    bpy.context.view_layer.update()
    rep = {}
    total = 0
    mins = Vector((1e9, 1e9, 1e9)); maxs = Vector((-1e9, -1e9, -1e9))
    for ob in bpy.data.objects:
        e = {'type': ob.type, 'parent': ob.parent.name if ob.parent else None,
             'loc': tuple(round(v, 4) for v in ob.matrix_world.translation)}
        if ob.type == 'MESH':
            n = tri_count(ob)
            total += n
            e['tris'] = n
            for v in ob.data.vertices:
                w = ob.matrix_world @ v.co
                mins = Vector((min(mins.x, w.x), min(mins.y, w.y), min(mins.z, w.z)))
                maxs = Vector((max(maxs.x, w.x), max(maxs.y, w.y), max(maxs.z, w.z)))
            e['mats'] = [m.name for m in ob.data.materials]
        rep[ob.name] = e
    return total, rep, mins, maxs


if __name__ == '__main__':
    root = build_all()
    total, info = verify_scene()
    log('TRIANGLES total', total)
    for k, v in sorted(info.items(), key=lambda kv: -kv[1]):
        log('   %-18s %6d' % (k, v))
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    log('saved', OUT_BLEND)
    export_glb(root)
    log('exported', OUT_GLB)
    total2, rep, mins, maxs = reimport_check()
    log('REIMPORT tris', total2)
    for k, e in sorted(rep.items()):
        log('   ', k, e)
    log('bbox min', tuple(round(v, 3) for v in mins), 'max', tuple(round(v, 3) for v in maxs))
