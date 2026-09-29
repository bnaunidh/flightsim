"""
KESTREL LAUNCH - fast rescue boat for Island Flight Simulator.

Built from an empty factory scene every run, headless:

    "/Applications/Blender.app/Contents/MacOS/Blender" -t 2 --background --factory-startup \
        --python build.py -- [--no-export]

Writes kestrel_launch.blend, kestrel_launch.glb and kestrel_launch.js (the
loader-free ES module baked from the GLB by bake_module.py) next to this file.
Fails the build if any closed part is inside out or if the fit gate (the sea
states the game actually makes) does not pass.

Axes (Blender): +Y = bow, +Z = up, +X = starboard. Design waterline = Z 0.
The glTF export (+Y up) turns that into the game's -Z forward, +Y up.

The hull is a lines-plan loft: keel, chine and sheer are analytic curves that
all terminate on one raked stem curve; spray rails, the chine flat and the
flared topsides are derived per station, so every surface is fair and every
hard edge is a real crease. Material zones on the hull (antifouling, boot
stripe, topsides) are real edge loops of the loft, not painted.
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DO_EXPORT = '--no-export' not in ARGS
FONT_PATH = '/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf'
# roof non-skid base colour (linear); ROOF_LINEAR="r,g,b" overrides it for tuning
# (tuned in the game's own renderer, ACES 1.12 at midday: the roof now samples
# #CE563C from the chase camera against the reviewer's transom #C85834)
ROOF_LINEAR = tuple(float(c) for c in os.environ.get('ROOF_LINEAR', '0.40,0.038,0.005').split(','))

# ----------------------------------------------------------------- scene ---
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
COL = SC.collection


def ss(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def srgb(c):
    """sRGB 0-255 triple -> linear floats."""
    out = []
    for v in c:
        v = v / 255.0
        out.append(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# ------------------------------------------------------------- materials ---
MATS = {}


def make_mat(name, rgb, rough=0.5, metal=0.0, emit=0.0, alpha=1.0, cull=True, emit_rgb=None):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get('Principled BSDF')
    col = (*rgb, 1.0)
    b.inputs['Base Color'].default_value = col
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit > 0:
        b.inputs['Emission Color'].default_value = (*(emit_rgb or rgb), 1.0)
        b.inputs['Emission Strength'].default_value = emit
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
        try:
            m.blend_method = 'BLEND'
        except Exception:
            pass
        m.use_transparency_overlap = False
    m.use_backface_culling = cull
    m.diffuse_color = col
    MATS[name] = m
    return m


make_mat('paint_orange', srgb((236, 88, 26)), rough=0.36)
# The T-top's top face: matte orange non-skid, darker than the topside paint.
# An up-facing satin orange under a midday sun tone-maps to salmon in the game
# (ACES 1.12); this one is tuned in the real renderer to sit with the transom.
make_mat('roof_nonskid', ROOF_LINEAR, rough=0.90)
make_mat('paint_white', srgb((238, 240, 237)), rough=0.34)
make_mat('paint_navy', srgb((26, 42, 80)), rough=0.42)
make_mat('antifouling', srgb((44, 34, 36)), rough=0.86)
# dark grey non-slip (linear ~0.14-0.18), so the white mouldings read as parts
make_mat('deck_nonskid', srgb((104, 112, 118)), rough=0.93)
make_mat('metal', srgb((212, 216, 220)), rough=0.26, metal=0.92)
# one satin-matte graphite for everything dark: the D-fender and other rubber,
# lower cowls and legs, bezels, bases and brackets (rubber merged in, which
# freed the slot for roof_nonskid under the 14-material cap)
make_mat('dark_trim', srgb((36, 40, 46)), rough=0.55, metal=0.10)
# chart-plotter screens: dark teal glass with a live blue-green glow
make_mat('screen', srgb((10, 40, 48)), rough=0.12, emit=0.45, emit_rgb=srgb((40, 200, 190)))
make_mat('glass', srgb((40, 64, 80)), rough=0.05, alpha=0.55, cull=False)     # smoked
make_mat('light_red', srgb((255, 40, 30)), rough=0.3, emit=6.0)
make_mat('light_green', srgb((30, 255, 90)), rough=0.3, emit=6.0)
make_mat('light_white', srgb((255, 246, 228)), rough=0.3, emit=6.0)
make_mat('light_blue', srgb((40, 110, 255)), rough=0.3, emit=8.0)


# --------------------------------------------------------- mesh builder ---
class Geo:
    """Accumulates bmesh geometry with per-face material names."""

    def __init__(self):
        self.bm = bmesh.new()
        self.names = []

    def mi(self, name):
        if name not in self.names:
            self.names.append(name)
        return self.names.index(name)

    def v(self, co):
        return self.bm.verts.new(co)

    def face(self, vs, mat, smooth=True):
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = self.mi(mat)
        f.smooth = smooth
        return f

    def poly(self, pts, mat, smooth=False):
        return self.face([self.v(p) for p in pts], mat, smooth)

    def grid(self, rows, mat, smooth=True, closed=False, flip=False):
        """rows[i][j] -> quads between consecutive rows (i) and columns (j).
        Face normal = d(row) x d(col); pass flip to reverse."""
        vg = [[self.v(p) for p in r] for r in rows]
        n = len(rows[0])
        jr = range(n if closed else n - 1)
        for i in range(len(rows) - 1):
            for j in jr:
                j2 = (j + 1) % n
                q = [vg[i][j], vg[i + 1][j], vg[i + 1][j2], vg[i][j2]]
                if flip:
                    q.reverse()
                m = mat(i, j) if callable(mat) else mat
                self.face(q, m, smooth)
        return vg

    def fan_cap(self, ring_verts, center, mat, flip=False, smooth=False):
        c = self.v(center)
        n = len(ring_verts)
        for j in range(n):
            q = [ring_verts[j], ring_verts[(j + 1) % n], c]
            if flip:
                q.reverse()
            self.face(q, mat, smooth)

    def merge(self, dist=1e-5):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=dist)

    def sharpen(self, angle_deg):
        lim = math.radians(angle_deg)
        for e in self.bm.edges:
            if len(e.link_faces) == 2:
                if e.calc_face_angle(0) > lim:
                    e.smooth = False
            else:
                e.smooth = False

    def to_object(self, name, parent=None, location=(0, 0, 0)):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for n in self.names:
            me.materials.append(MATS[n])
        ob = bpy.data.objects.new(name, me)
        COL.objects.link(ob)
        ob.location = location
        if parent:
            ob.parent = parent
        return ob


def face_out(g, vs, mat, out_dir, smooth=False):
    """Make a face from BMVerts or points and wind it so its normal agrees
    with out_dir (every opaque material exports single-sided)."""
    vs = [v if isinstance(v, bmesh.types.BMVert) else g.v(v) for v in vs]
    f = g.face(vs, mat, smooth)
    if f is not None:
        f.normal_update()
        if f.normal.dot(Vector(out_dir)) < 0:
            f.normal_flip()
    return f


def triangulate_unfolded(bm, faces):
    """Split quads along whichever diagonal keeps both halves facing the same
    way as the quad (twisted thin quads fold otherwise, and a folded half is a
    back face on a single-sided material)."""
    for f in list(faces):
        if len(f.verts) != 4 or not f.is_valid:
            continue
        a, b_, c, d = [v.co for v in f.verts]
        n = (c - a).cross(d - b_)
        if n.length < 1e-12:
            continue
        n.normalize()
        def score(t1, t2):
            m = 1.0
            for p0, p1, p2 in (t1, t2):
                nn = (p1 - p0).cross(p2 - p0)
                m = min(m, nn.normalized().dot(n) if nn.length > 1e-14 else 1.0)
            return m
        s02 = score((a, b_, c), (a, c, d))
        s13 = score((a, b_, d), (b_, c, d))
        v = list(f.verts)
        pair = [v[0], v[2]] if s02 >= s13 else [v[1], v[3]]
        bmesh.ops.connect_verts(bm, verts=pair)


def link_new(name, data=None, parent=None, location=(0, 0, 0)):
    ob = bpy.data.objects.new(name, data)
    COL.objects.link(ob)
    ob.location = location
    if parent:
        ob.parent = parent
    return ob


# ============================================================= HULL LINES ===
ZK = -0.52          # keel depth at rest (hull draught 0.52 m)
YT = -3.85          # transom at the keel
RAKE = math.radians(6.0)   # transom top leans forward (modern reverse rake)
YF, ZF = 3.35, -0.08       # forefoot: keel turns up into the stem
YH, ZH = 4.62, 1.36        # stem head
YA = 0.40                  # start of the bow region of the loft
B_MAX = 1.40               # half-beam at the sheer
Z_SHEER_AFT = 0.92
Z_CHINE_END = 0.50         # the chine climbs the stem to here
Z_WELL = 0.50              # motor board: transom notch for the outboards (raised 0.10
                           # in art2 so the well lip and the skegs fit the game's seas)
SHAFT = 0.78               # outboard pivot (motor board) to anti-ventilation plate


def y_tr(z):
    return YT + (z - ZK) * math.tan(RAKE)


def z_keel(y):
    if y <= 0.0:
        return ZK
    return ZK + (ZF - ZK) * min(1.0, y / YF) ** 2


_d0 = Vector((1.0, 2 * (ZF - ZK) / YF)).normalized()
_d3 = Vector((0.62, 1.0)).normalized()
STEM = [Vector((YF, ZF)), Vector((YF, ZF)) + 0.72 * _d0,
        Vector((YH, ZH)) - 0.58 * _d3, Vector((YH, ZH))]


def stem(t):
    a, b, c, d = STEM
    u = 1 - t
    return a * u ** 3 + b * 3 * u * u * t + c * 3 * u * t * t + d * t ** 3


def stem_t_for_z(z):
    lo, hi = 0.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if stem(mid).y < z:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def stem3(t):
    p = stem(t)
    return Vector((0.0, p.x, p.y))


T_CHINE = stem_t_for_z(Z_CHINE_END)
Y_CE = stem(T_CHINE).x


def b_sheer(y):
    y0 = -0.30
    if y <= y0:
        return B_MAX - 0.06 * ((y0 - y) / (y0 - YT)) ** 2
    t = min(1.0, (y - y0) / (YH - y0))
    return B_MAX * (1 - t ** 2.2)


def z_sheer(y):
    t = max(0.0, (y - YT) / (YH - YT))
    return Z_SHEER_AFT + (ZH - Z_SHEER_AFT) * t ** 2.2


def b_chine(y):
    if y <= YA:
        return 1.22 - 0.03 * ((YA - y) / (YA - YT)) ** 2
    t = min(1.0, (y - YA) / (Y_CE - YA))
    return 1.22 * (1 - t ** 1.6)


def z_chine(y):
    if y <= YA:
        return -0.06 + 0.12 * ss((y - YT) / (YA - YT))
    t = min(1.0, (y - YA) / (Y_CE - YA))
    return 0.06 + (Z_CHINE_END - 0.06) * t ** 1.55


def sheer_pt(y):
    return Vector((b_sheer(y), y, z_sheer(y)))


def sheer_slope(y, h=1e-3):
    return (b_sheer(y + h) - b_sheer(y - h)) / (2 * h)


# Loft sampling: rows along u. Aft region shares y; bow region runs every line
# to its own point on the stem (denser toward the stem).
N_AFT, N_BOW = 12, 24
UA = N_AFT / (N_AFT + N_BOW)


def line_y(u, y_start, y_end):
    if u <= UA:
        return lerp(y_start, YA, u / UA)
    s = (u - UA) / (1 - UA)
    return lerp(YA, y_end, math.sin(s * math.pi / 2))


def u_values():
    return [i / (N_AFT + N_BOW) for i in range(N_AFT + N_BOW + 1)]


RAIL_F = (0.34, 0.66)
TOP_V = (0.16, 0.36, 0.56, 0.76)
# The spray rails run full size, then end with a hard cut: a one-row wedge,
# flat-shaded, well short of the stem. (A long fade onto the bottom smeared the
# smooth shading into a dark diagonal streak across the bow.)
U_RCUT = 30 / 36


def fade_rail(u):
    return max(0.0, min(1.0, (U_RCUT - u) * 36.0))


def chine_w(u):
    """Width factor of the level chine flat: full aft, narrowing to a 6 mm
    ledge at the stem. It stays level and sharp-edged all the way (it used to
    relax onto the topside, which smeared a streak across the bow)."""
    return 1.0 - 0.93 * ss((u - 0.40) / 0.60)


def section_raw(u):
    """Returns the list of section points (starboard half, keel -> sheer)
    plus a tag list, before the stem correction.

    Rails and the chine flat never collapse to coincident points: as they
    fade toward the stem their columns keep their spacing and relax onto the
    smooth surface, so there are no zero-area faces to shade badly."""
    yk = line_y(u, y_tr(ZK), YF)
    yc = line_y(u, y_tr(z_chine(YT)), Y_CE)
    ys = line_y(u, y_tr(Z_SHEER_AFT), YH)
    K = Vector((0.0, yk, z_keel(yk)))
    Ca = Vector((b_chine(yc), yc, z_chine(yc)))
    S = Vector((b_sheer(ys), ys, z_sheer(ys)))
    fade_r = fade_rail(u)
    bulge_b = lerp(0.010, 0.030, ss((yk - 0.0) / 3.0)) * (1 - ss((u - 0.9) / 0.1))
    ch = Ca - K
    nb = Vector((ch.z, 0.0, -ch.x))
    nb = nb.normalized() if nb.length > 1e-9 else Vector((0, 0, 0))

    def bottom(f):
        return K.lerp(Ca, f) + nb * (bulge_b * math.sin(math.pi * f))

    pts, tags = [K.copy()], ['keel']
    df = min(0.055 / max(ch.length, 1e-6), 0.07)   # rail width as a fraction of the bottom
    prev = 0.0
    for k, f in enumerate(RAIL_F):
        pts.append(bottom((prev + f) / 2)); tags.append('b')
        A = bottom(f)
        C = bottom(f + df)
        B_rail = Vector((C.x, A.y, A.z))    # level ledge out to C's breadth, then a step up to C
        B = bottom(f + df / 2).lerp(B_rail, fade_r)
        pts += [A, B, C]; tags += ['railA', 'railB', 'railC']
        prev = f + df
    pts.append(bottom((prev + 1) / 2)); tags.append('b')
    pts.append(Ca.copy()); tags.append('chineA')
    Cb = Ca + Vector((0.085 * chine_w(u), 0.0, 0.0))    # level chine flat, narrowing to the stem
    pts.append(Cb); tags.append('chineB')
    d = S - Cb
    nt = Vector((d.z, 0.0, -d.x))
    nt = nt.normalized() if nt.length > 1e-9 else Vector((0, 0, 0))
    bt = (0.012 - 0.036 * ss(ys / 3.9)) * (1 - ss((u - 0.80) / 0.20))
    top_gap = 0.07
    vtop = 1 - top_gap / max(d.length, 1e-6)
    for v in list(TOP_V) + [max(vtop, 0.85)]:
        pts.append(Cb.lerp(S, v) + nt * (bt * math.sin(math.pi * v))); tags.append('top')
    pts.append(S.copy()); tags.append('sheer')
    return pts, tags


def stem_targets(pts1):
    """Where each column must land on the stem at u = 1."""
    # Distribute by arc length along the u=1 raw polyline between the keel
    # (t=0), the chine (T_CHINE) and the sheer (t=1).
    n = len(pts1)
    ic = None
    for j in range(n):
        if (pts1[j] - stem3(T_CHINE)).length < 1e-4 and ic is None and j > 0:
            ic = j
    ic = ic if ic is not None else 11
    ts = [0.0] * n

    def dist(a, b):
        cum = [0.0]
        for j in range(a + 1, b + 1):
            cum.append(cum[-1] + (pts1[j] - pts1[j - 1]).length)
        return cum

    c1 = dist(0, ic)
    for k, j in enumerate(range(0, ic + 1)):
        ts[j] = T_CHINE * (c1[k] / c1[-1] if c1[-1] > 0 else 0)
    c2 = dist(ic, n - 1)
    for k, j in enumerate(range(ic, n)):
        ts[j] = T_CHINE + (1 - T_CHINE) * (c2[k] / c2[-1] if c2[-1] > 0 else 0)
    return ts


_raw1, TAGS = section_raw(1.0)
IDX_CHINE_A = TAGS.index('chineA')
_ts = stem_targets(_raw1)
_ts[IDX_CHINE_A] = T_CHINE
DELTA = [stem3(_ts[j]) - _raw1[j] for j in range(len(_raw1))]


def section(u):
    pts, _ = section_raw(u)
    if u > UA:
        w = ss((u - UA) / (1 - UA)) ** 1.5
        pts = [p + DELTA[j] * w for j, p in enumerate(pts)]
    return pts


NCOL = len(TAGS)

# ================================================================== HULL ====
Z_AF = 0.03                     # top of antifouling (flat)


def z_boot(y):
    """Top of the navy boot stripe: rising gently along the length and sweeping
    up at the bow, so it runs above the climbing chine there and the orange
    never wraps onto the downward-facing forward bottom."""
    t = min(1.0, max(0.0, (y - YT) / (YH - YT)))
    return 0.15 + 0.10 * t + 0.22 * t ** 4


def zone_F(k, p):
    """Signed height of p above paint line k (0 = antifouling top, 1 = boot top)."""
    return p.z - (Z_AF if k == 0 else z_boot(p.y))


def _row_set():
    """The loft's rows: the regular u samples, plus a row wherever a paint
    line crosses a feature column (rail, chine, topside line). With those rows
    in place every paint boundary runs through real vertices, so the zones
    are clean edge loops - no bisect, no slivers. A crossing that lands close
    to a regular row moves that row instead of adding one."""
    base = u_values()
    n = len(base)
    secs = [section(u) for u in base]
    events = []
    for k in (0, 1):
        for j in range(NCOL):
            for i in range(n - 1):
                f0 = zone_F(k, secs[i][j])
                if (f0 < 0) == (zone_F(k, secs[i + 1][j]) < 0):
                    continue
                lo, hi = base[i], base[i + 1]
                for _ in range(64):
                    mid = (lo + hi) / 2
                    if (zone_F(k, section(mid)[j]) < 0) == (f0 < 0):
                        lo = mid
                    else:
                        hi = mid
                events.append((lo + hi) / 2)
    events.sort()
    # a paint line crossing a (nearly) level ledge crosses both of its
    # columns within a hair of u: one row takes the whole cluster
    clusters = []
    for e in events:
        if clusters and e - clusters[-1][-1] < 1.5e-3:
            clusters[-1].append(e)
        else:
            clusters.append([e])
    uniq = [sum(c) / len(c) for c in clusters]
    us = list(base)
    is_base = [True] * n
    moved = set()
    extra = []
    for e in uniq:
        i = max(0, min(n - 2, int(e * (n - 1))))
        step = base[i + 1] - base[i]
        cand = min((i, i + 1), key=lambda m: abs(base[m] - e))
        if 0 < cand < n - 1 and cand not in moved and abs(base[cand] - e) < 0.3 * step:
            us[cand] = e
            moved.add(cand)
        else:
            extra.append(e)
    rows = sorted([(u, True) for u in us] + [(u, False) for u in extra])
    return [u for u, _ in rows], [b for _, b in rows]


ROW_U, ROW_IS_BASE = _row_set()
SECTIONS = [section(u) for u in ROW_U]
SNAP_Z = 3e-3
for _row in SECTIONS:            # vertices within 3 mm of a paint line sit exactly on it
    for _p in _row:
        for _k in (0, 1):
            _f = zone_F(_k, _p)
            if abs(_f) < SNAP_Z:
                _p.z -= _f
BASE_SECTIONS = [s for s, b in zip(SECTIONS, ROW_IS_BASE) if b]
EPS_Z = 1e-5          # mathutils stores float32: snapped points sit within ~1e-8


def zone_hits(row, k):
    """Where paint line k crosses a section: ('v', j0, j1) when it passes
    through vertices j0..j1 (a level ledge gives a range), else ('e', j, t)
    inside segment j..j+1."""
    F = [zone_F(k, p) for p in row]
    zeros = [j for j, f in enumerate(F) if abs(f) < EPS_Z]
    changes = [j for j in range(len(F) - 1) if (F[j] < -EPS_Z) and (F[j + 1] > EPS_Z)]
    if zeros:
        assert zeros == list(range(zeros[0], zeros[-1] + 1)), ('non-contiguous zone vertices', zeros)
        assert not changes, ('zone crosses twice', zeros, changes)
        return ('v', zeros[0], zeros[-1])
    assert len(changes) == 1, ('zone must cross each section once', k, changes)
    j = changes[0]
    return ('e', j, -F[j] / (F[j + 1] - F[j]))


def build_hull():
    g = Geo()
    bm = g.bm
    lay_c = bm.verts.layers.int.new('col')
    lay_r = bm.verts.layers.int.new('row')
    lay_t = bm.faces.layers.int.new('transom')
    rows = SECTIONS
    nr = len(rows)
    FV = []
    for i, r in enumerate(rows):
        vs = []
        for j, p in enumerate(r):
            v = g.v(p); v[lay_c] = j; v[lay_r] = i
            vs.append(v)
        FV.append(vs)
    HITS = [[zone_hits(r, k) for k in (0, 1)] for r in rows]
    ZV = {}

    def raw_s(i, k):
        h = HITS[i][k]
        return (h[1] + h[2]) / 2 if h[0] == 'v' else h[1] + h[2]

    def zpos(i, k, other):
        h = HITS[i][k]
        if h[0] == 'v':
            j = int(round(min(max(other, h[1]), h[2])))
            return float(j), FV[i][j]
        _, j, t = h
        if (i, k) not in ZV:
            v = g.v(rows[i][j].lerp(rows[i][j + 1], t)); v[lay_c] = -1; v[lay_r] = i
            ZV[(i, k)] = v
        return j + t, ZV[(i, k)]

    # skin: each band between two rows is zipped from the feature columns
    # plus the two paint-line points, in section order
    for i in range(nr - 1):
        items = [(float(j), FV[i][j], FV[i + 1][j]) for j in range(NCOL)]
        for k in (0, 1):
            sa, va = zpos(i, k, raw_s(i + 1, k))
            sb, vb = zpos(i + 1, k, raw_s(i, k))
            lo_, hi_ = min(sa, sb), max(sa, sb)
            assert not any(lo_ + 1e-9 < j < hi_ - 1e-9 for j in range(NCOL)), ('zone skips a column', i, k, sa, sb)
            items.append(((sa + sb) / 2 + 1e-7 * (k + 1), va, vb))
        items.sort(key=lambda it: it[0])
        for (s0, a0, b0), (s1, a1, b1) in zip(items, items[1:]):
            q = []
            for v in (a0, b0, b1, a1):
                if not any(v is w for w in q):
                    q.append(v)
            if len(q) >= 3:
                g.face(q, 'paint_orange', True)
    # transom (starboard half), planar on y = y_tr(z), cut into the same zones
    seq = [(float(j), FV[0][j]) for j in range(NCOL)] + [zpos(0, k, raw_s(1, k)) for k in (0, 1)]
    seq.sort(key=lambda it: it[0])
    tr = []
    for _, v in seq:
        if not any(v is w for w in tr):
            tr.append(v)
    zaf = zpos(0, 0, raw_s(1, 0))[1]
    zbt = zpos(0, 1, raw_s(1, 1))[1]
    i_af = next(n for n, v in enumerate(tr) if v is zaf)
    i_bt = next(n for n, v in enumerate(tr) if v is zbt)
    zb0 = 0.15
    for _ in range(30):
        zb0 = z_boot(y_tr(zb0))
    s0 = rows[0][-1]

    def cv(p):
        v = g.v(p); v[lay_c] = -2; v[lay_r] = -2
        return v
    c_af = cv(Vector((0.0, y_tr(Z_AF), Z_AF)))
    c_bt = cv(Vector((0.0, y_tr(zb0), zb0)))
    top = [cv(Vector((0.78, y_tr(s0.z), s0.z))), cv(Vector((0.76, y_tr(s0.z - 0.02), s0.z - 0.02))),
           cv(Vector((0.76, y_tr(Z_WELL), Z_WELL))), cv(Vector((0.0, y_tr(Z_WELL), Z_WELL)))]
    for poly in (tr[:i_af + 1] + [c_af], tr[i_af:i_bt + 1] + [c_bt, c_af], tr[i_bt:] + top + [c_bt]):
        f = face_out(g, poly, 'paint_orange', (0, -1, 0))
        f[lay_t] = 1
    # mirror to port
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    dup = bmesh.ops.duplicate(bm, geom=geom)
    dv = [e for e in dup['geom'] if isinstance(e, bmesh.types.BMVert)]
    dfc = [e for e in dup['geom'] if isinstance(e, bmesh.types.BMFace)]
    for v in dv:
        v.co.x = -v.co.x
    bmesh.ops.reverse_faces(bm, faces=dfc)
    g.merge(1e-6)
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        c = f.calc_center_median()
        if zone_F(0, c) < 0:
            f.material_index = g.mi('antifouling')
        elif zone_F(1, c) < 0:
            f.material_index = g.mi('paint_navy')
        else:
            f.material_index = g.mi('paint_orange')
        f.smooth = not f[lay_t]
    # the spray rails' end wedges (the one band where a rail ramps down to the
    # bottom) are flat-shaded, so nothing smears onto the smooth bottom
    rail_groups = [set(range(j, j + 3)) for j, t in enumerate(TAGS) if t == 'railA']
    ramp_rows = {i for i in range(nr - 1) if abs(fade_rail(ROW_U[i]) - fade_rail(ROW_U[i + 1])) > 1e-6}
    n_wedge = 0
    for f in bm.faces:
        rows_ = {v[lay_r] for v in f.verts}
        cols_ = {v[lay_c] for v in f.verts if v[lay_c] >= 0}
        r0 = min(rows_)
        if r0 in ramp_rows and rows_ <= {r0, r0 + 1} and cols_ and any(cols_ <= grp for grp in rail_groups):
            f.smooth = False
            n_wedge += 1
    # creases by construction, not by angle: keel, stem, chine and the chine
    # flat all the way; the rails while they are rails (their end wedge too)
    rail_cols = {j for j, t in enumerate(TAGS) if t.startswith('rail')}
    for e in bm.edges:
        a, b = e.verts
        ca, cb, ra, rb = a[lay_c], b[lay_c], a[lay_r], b[lay_r]
        lf = e.link_faces
        sharp = len(lf) < 2 or (len({f[lay_t] for f in lf}) > 1)
        if not sharp and ca == cb and ca >= 0 and abs(ra - rb) == 1:
            ua, ub = ROW_U[ra], ROW_U[rb]
            if ca in (0, IDX_CHINE_A):
                sharp = True
            elif ca in rail_cols:
                sharp = max(fade_rail(ua), fade_rail(ub)) > 0.02
            elif ca == IDX_CHINE_A + 1:
                sharp = True
        if not sharp and ra == rb == nr - 1 and ca >= -1 and cb >= -1:
            sharp = True                                    # the stem
        e.smooth = not sharp
    print('HULL rows', nr, 'base', sum(ROW_IS_BASE), 'faces', len(bm.faces), 'rail wedge faces', n_wedge)
    return g.to_object('hull')


HULL = build_hull()
_dg = bpy.context.evaluated_depsgraph_get()
HULL_BVH = BVHTree.FromObject(HULL, _dg)


def hull_x(y, z, default=None):
    """Half-breadth of the hull skin at (y, z), by ray from the centreplane."""
    hit = HULL_BVH.ray_cast(Vector((0.0, y, z)), Vector((1, 0, 0)), 5.0)
    if hit[0] is None:
        return default
    return hit[0].x


def hull_hit(p, d):
    return HULL_BVH.ray_cast(Vector(p), Vector(d).normalized(), 5.0)




# ================================================================== DECK ====
W_CAP = 0.14         # gunwale cap width (normal to the sheer)
Z_SOLE = 0.35        # cockpit sole, self-draining above the waterline (art2: +0.05)
DZ = Z_SOLE - 0.30   # everything standing on the sole rose with it
Z_COAM = 0.80        # splash-well coaming
X_WELL = 0.76        # half-width of the motor well
Y_WF = -3.52         # motor-well front wall
Y_AB = -3.42         # aft cockpit bulkhead
Y_STEP = 1.75        # step up to the foredeck well


def z_fd(y):
    return z_sheer(y) - 0.36


def sec_at(y):
    return math.sqrt(1 + sheer_slope(y) ** 2)


def _solve_ybw():
    lo, hi = 3.0, 4.5
    for _ in range(50):
        mid = (lo + hi) / 2
        if b_sheer(mid) - W_CAP * sec_at(mid) > 0.30:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


Y_BW = _solve_ybw()
Y_CORNER = SECTIONS[0][-1].y      # sheer at the transom corner
HULL_SHEER_YS = [r[-1].y for r in BASE_SECTIONS]   # deck and strake follow the regular rows


def stations(y0, y1, extra=()):
    ys = [y for y in HULL_SHEER_YS if y0 < y < y1] + [y0, y1] + list(extra)
    ys = sorted(set(round(y, 5) for y in ys))
    out = []
    for y in ys:
        if not out or y - out[-1] > 0.02:
            out.append(y)
    out[-1] = y1
    return out


def cap_profile(y, floor_z, inner_x=None, x_floor=None):
    xs, zs, sc_ = b_sheer(y), z_sheer(y), sec_at(y)
    W = W_CAP if inner_x is None else (xs - inner_x) / sc_
    pts = [Vector((xs, y, zs)),
           Vector((xs - 0.010 * sc_, y, zs + 0.016)),
           Vector((xs - 0.032 * sc_, y, zs + 0.025)),
           Vector((xs - (W - 0.032) * sc_, y, zs + 0.025)),
           Vector((xs - (W - 0.010) * sc_, y, zs + 0.016)),
           Vector((xs - W * sc_, y, zs - 0.004))]
    if x_floor is None:
        hx = hull_x(y, floor_z, pts[5].x + 0.05)
        x_floor = min(pts[5].x, hx - 0.05 * sc_)
    pts.append(Vector((x_floor, y, floor_z)))
    return pts


def mirror_pts(pts):
    return [Vector((-p.x, p.y, p.z)) for p in pts]


SOLE_EDGE = {}


def sole_x(y, key):
    """Half-breadth of a sole (B: the cockpit, C: the foredeck well) at y."""
    pts = SOLE_EDGE[key]
    if y <= pts[0][0]:
        return pts[0][1]
    for (y0, x0), (y1, x1) in zip(pts, pts[1:]):
        if y0 <= y <= y1:
            return lerp(x0, x1, (y - y0) / max(y1 - y0, 1e-9))
    return pts[-1][1]


def build_deck():
    g = Geo()
    cap_mat = lambda i, j: 'paint_white'

    def sweep(ys, floor_fn, inner_x=None, first_on_transom=False, xfloor0=None):
        rows = []
        for k, y in enumerate(ys):
            xf = xfloor0 if (k == 0 and xfloor0 is not None) else None
            pr = cap_profile(y, floor_fn(y), inner_x, xf)
            if first_on_transom and k == 0:
                pr = [Vector((p.x, y_tr(p.z), p.z)) for p in pr]
            rows.append(pr)
        g.grid(rows, cap_mat, smooth=True)
        g.grid([mirror_pts(r) for r in rows], cap_mat, smooth=True, flip=True)
        return rows

    # A1: quarters over the motor well (cap runs inboard to the well side)
    ysA1 = stations(Y_CORNER, Y_WF)
    A1 = sweep(ysA1, lambda y: Z_WELL, inner_x=X_WELL, first_on_transom=True)
    ysA2 = stations(Y_WF, Y_AB)
    A2 = sweep(ysA2, lambda y: Z_COAM, inner_x=X_WELL)
    ysB = stations(Y_AB, Y_STEP)
    B = sweep(ysB, lambda y: Z_SOLE)
    # aft wall line of B at Y_STEP, evaluated at the foredeck floor height
    p5, p6 = B[-1][5], B[-1][6]
    t = (z_fd(Y_STEP) - p6.z) / (p5.z - p6.z)
    x_mid = lerp(p6.x, p5.x, t)
    ysC = stations(Y_STEP, Y_BW)
    C = sweep(ysC, z_fd, xfloor0=x_mid)

    # end sliver of the cap at the transom corners
    e = A1[0][:6]
    g.poly(e, 'paint_white')                                  # faces aft
    g.poly(list(reversed(mirror_pts(e))), 'paint_white')

    # cockpit sole with a smooth white margin, and the foredeck well floor
    def floor(rows, zf_fn, margin=0.06):
        fr = []
        for r in rows:
            xw = r[6].x
            y = r[6].y
            z = r[6].z
            fr.append([Vector((-xw, y, z)), Vector((-xw + margin, y, z)),
                       Vector((xw - margin, y, z)), Vector((xw, y, z))])
        g.grid(fr, 'paint_white', smooth=False, flip=True)

    # art3: the soles are smooth white gelcoat; the non-skid is inset panels
    # (build_nonskid) with smooth gutters round the bulwarks, plinths and hatch
    floor(B, None)
    floor(C, None)
    SOLE_EDGE['B'] = [(r[6].y, r[6].x) for r in B]
    SOLE_EDGE['C'] = [(r[6].y, r[6].x) for r in C]
    # step riser (faces aft)
    lowx = B[-1][6].x
    hix = C[0][6].x
    g.poly([Vector((lowx, Y_STEP, Z_SOLE)), Vector((hix, Y_STEP, z_fd(Y_STEP))),
            Vector((-hix, Y_STEP, z_fd(Y_STEP))), Vector((-lowx, Y_STEP, Z_SOLE))], 'paint_white')

    # aft bulkhead at Y_AB (faces forward into the cockpit)
    pb = B[0]
    pa = A2[-1]
    outline = ([Vector((-p.x, p.y, p.z)) for p in (pb[6], pb[5], pb[4], pb[3])] +
               [Vector((-p.x, p.y, p.z)) for p in (pa[3], pa[4], pa[5], pa[6])] +
               [pa[6], pa[5], pa[4], pa[3], pb[3], pb[4], pb[5], pb[6]])
    g.poly(outline, 'paint_white')
    # coaming top (0.80) and the motor well
    g.poly([Vector((-X_WELL, Y_WF, Z_COAM)), Vector((X_WELL, Y_WF, Z_COAM)),
            Vector((X_WELL, Y_AB, Z_COAM)), Vector((-X_WELL, Y_AB, Z_COAM))], 'paint_white')
    g.poly([Vector((-X_WELL, Y_WF, Z_WELL)), Vector((X_WELL, Y_WF, Z_WELL)),
            Vector((X_WELL, Y_WF, Z_COAM)), Vector((-X_WELL, Y_WF, Z_COAM))], 'paint_white')
    g.poly([Vector((-X_WELL, y_tr(Z_WELL), Z_WELL)), Vector((X_WELL, y_tr(Z_WELL), Z_WELL)),
            Vector((X_WELL, Y_WF, Z_WELL)), Vector((-X_WELL, Y_WF, Z_WELL))], 'deck_nonskid')

    # bow: well front wall and the cambered bow cap
    pc = C[-1]
    mid_top = Vector((0.0, Y_BW, z_sheer(Y_BW) + 0.025))
    fw = ([pc[6], pc[5], pc[4], pc[3], mid_top] +
          [Vector((-p.x, p.y, p.z)) for p in (pc[3], pc[4], pc[5], pc[6])])
    g.poly(fw, 'paint_white')                                  # faces aft, into the well
    ysD = stations(Y_BW, YH)
    rows = []
    for y in ysD:
        xs, zs, sc_ = b_sheer(y), z_sheer(y), sec_at(y)
        k = min(1.0, xs / ((W_CAP - 0.032) * sc_ + 0.035))
        offs = [0.0, 0.010 * k, 0.032 * k, (W_CAP - 0.032) * k]
        hz = [0.0, 0.016, 0.025, 0.025]
        half = [Vector((xs - o * sc_, y, zs + h)) for o, h in zip(offs, hz)]
        camber = 0.012 * min(1.0, xs / 0.45)
        mid = Vector((0.0, y, zs + 0.025 + camber))
        rows.append(mirror_pts(half) + [mid] + list(reversed(half)))
    rows[0] = [mirror_pts([p])[0] for p in C[-1][:4]] + [mid_top] + list(reversed(C[-1][:4]))
    g.grid(rows, 'paint_white', smooth=True, flip=True)
    g.merge(1e-5)
    g.sharpen(40)
    return g.to_object('deck')


DECK = build_deck()


# ================================================================ STRAKE ====
def build_strake():
    """A 125 mm rubber D-fender round the sheer, wrapped round the stem head:
    the strong dark outline round the white deck from the chase and helicopter
    cameras (and what a rescue boat needs to come alongside). Swept along the
    real sheer of the hull; every other station aft, where the sheer is
    nearly straight."""
    g = Geo()
    ys = stations(Y_CORNER, YH)[:-1]
    ys = [y for i, y in enumerate(ys) if y > 0.8 or i % 2 == 0 or i == len(ys) - 1]
    hc, ro, rz = -0.046, 0.080, 0.062           # D centre below the sheer, depth, half-height
    prof = [(0.024, 0.014)] + [(ro * math.cos(math.radians(a)), hc + rz * math.sin(math.radians(a)))
                               for a in (62, 30, 0, -30, -62)] + [(0.024, -0.106)]

    def frame_pts(S, n, y):
        zs = S.z
        hx = hull_x(y, zs - 0.10, abs(S.x) - 0.01)
        # same scalar on both sides: hull_x always measures the starboard skin
        inner_bot = (hx - abs(S.x)) * abs(n.x) - 0.012
        out = [S + n * (-0.014) + Vector((0, 0, 0.013))]
        for o, h in prof:
            out.append(S + n * o + Vector((0, 0, h)))
        out.append(S + n * inner_bot + Vector((0, 0, -0.108)))
        return out

    stb = []
    for y in ys:
        S = sheer_pt(y)
        m = sheer_slope(y)
        n = Vector((1.0, -m, 0.0)).normalized()
        stb.append((S, n, y))
    tip = sheer_pt(YH)
    m_tip = (stb[-1][0] - tip)
    n_stb = Vector((1.0, -sheer_slope(YH - 0.02), 0)).normalized()
    path = []
    for S, n, y in stb:
        path.append((Vector((-S.x, S.y, S.z)), Vector((-n.x, n.y, 0)), y))
    fan = 7
    a0 = math.atan2(n_stb.y, -n_stb.x)
    a1 = math.atan2(n_stb.y, n_stb.x)
    for k in range(fan):
        a = lerp(a0, a1, k / (fan - 1))
        path.append((tip.copy(), Vector((math.cos(a), math.sin(a), 0)), YH - 0.002))
    for S, n, y in reversed(stb):
        path.append((S, n, y))
    rows = [frame_pts(S, n, y) for S, n, y in path]
    g.grid(rows, 'dark_trim', smooth=True)
    g.poly(rows[0], 'dark_trim')                                  # end caps face aft
    g.poly(list(reversed(rows[-1])), 'dark_trim')
    g.merge(1e-5)
    g.sharpen(50)
    return g.to_object('strake')


STRAKE = build_strake()


# ======================================================== SWIM PLATFORMS ====
def rounded_rect(x0, x1, y0, y1, r_back_out, r_back_in, n=5):
    """Plan outline, front edge straight (against the transom)."""
    pts = [Vector((x0, y1, 0)), Vector((x1, y1, 0))]
    # back-outer corner (x1, y0)
    for k in range(n + 1):
        a = -math.pi / 2 * k / n
        pts.append(Vector((x1 - r_back_out + r_back_out * math.cos(a),
                           y0 + r_back_out + r_back_out * math.sin(a), 0)))
    for k in range(n + 1):
        a = -math.pi / 2 - math.pi / 2 * k / n
        pts.append(Vector((x0 + r_back_in + r_back_in * math.cos(a),
                           y0 + r_back_in + r_back_in * math.sin(a), 0)))
    return pts


Z_PLAT = 0.29          # swim platform top (art2: +0.05 with the sole)


def build_platform():
    g = Geo()
    z0, z1 = Z_PLAT - 0.14, Z_PLAT
    x_out = hull_x(y_tr(Z_PLAT - 0.06) + 0.03, Z_PLAT - 0.06, 1.28) - 0.004
    outline = rounded_rect(0.88, x_out, -4.30, y_tr(z1) + 0.02, 0.12, 0.05)[::-1]   # ccw from above
    bot = [g.v(Vector((p.x, p.y, z0))) for p in outline]
    top = [g.v(Vector((p.x, p.y, z1))) for p in outline]
    n = len(outline)
    g.face(list(reversed(bot)), 'paint_white', False)
    g.face(top, 'deck_nonskid', False)
    for j in range(n):
        j2 = (j + 1) % n
        g.face([bot[j], bot[j2], top[j2], top[j]], 'paint_white', True)
    g.sharpen(35)
    ob = g.to_object('swim_platform')
    mir = ob.modifiers.new('Mirror', 'MIRROR')
    mir.use_axis[0] = True
    bev = ob.modifiers.new('Bevel', 'BEVEL')
    bev.width = 0.018; bev.segments = 2; bev.limit_method = 'ANGLE'
    bev.angle_limit = math.radians(40); bev.harden_normals = True
    return ob


PLATFORM = build_platform()



# ======================================================= SHAPE HELPERS ====
def fillet(pts, r, n=5):
    """Round every interior corner of a polyline with radius ~r; n is the
    segment count, or a list with one count per interior corner."""
    pts = [Vector(p) for p in pts]
    out = [pts[0]]
    ns = n if isinstance(n, (list, tuple)) else [n] * len(pts)
    for i in range(1, len(pts) - 1):
        n = ns[i - 1]
        a, p, b = pts[i - 1], pts[i], pts[i + 1]
        d1 = (p - a); l1 = d1.length; d1.normalize()
        d2 = (b - p); l2 = d2.length; d2.normalize()
        cosang = max(-1.0, min(1.0, d1.dot(d2)))
        th = math.acos(cosang)
        if th < 1e-3:
            out.append(p)
            continue
        t = min(r * math.tan(th / 2), l1 * 0.49, l2 * 0.49)
        s0, s1 = p - d1 * t, p + d2 * t
        for k in range(n + 1):
            u = k / n
            out.append(s0 * (1 - u) ** 2 + p * 2 * u * (1 - u) + s1 * u * u)
    out.append(pts[-1])
    return out


def catmull(pts, per=6):
    pts = [Vector(p) for p in pts]
    out = []
    for i in range(len(pts) - 1):
        p0 = pts[max(i - 1, 0)]; p1 = pts[i]; p2 = pts[i + 1]; p3 = pts[min(i + 2, len(pts) - 1)]
        for k in range(per):
            t = k / per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return out


def tube(g, pts, r, mat, sides=8, caps=True, smooth=True, r_end=None):
    """Sweep a circle along a polyline with rotation-minimising frames."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    tans = []
    for i in range(n):
        a = pts[max(i - 1, 0)]; b = pts[min(i + 1, n - 1)]
        tans.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = (ref - tans[0] * ref.dot(tans[0])).normalized()
    rows = []
    for i in range(n):
        if i > 0:
            nrm = (nrm - tans[i] * nrm.dot(tans[i])).normalized()
        bin_ = tans[i].cross(nrm)
        rr = r if r_end is None else lerp(r, r_end, i / (n - 1))
        # widen at bends so the tube does not pinch
        if 0 < i < n - 1:
            d1 = (pts[i] - pts[i - 1]).normalized(); d2 = (pts[i + 1] - pts[i]).normalized()
            c = max(0.5, math.sqrt((1 + max(-1, min(1, d1.dot(d2)))) / 2))
        else:
            c = 1.0
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            ring.append(pts[i] + (nrm * math.cos(a) + bin_ * math.sin(a)) * rr / c)
        rows.append(ring)
    vg = g.grid(rows, mat, smooth=smooth, closed=True, flip=True)
    if caps:
        g.face(list(reversed(vg[0])), mat, False)
        g.face(vg[-1], mat, False)
    return vg


def revolve(g, prof, mat, sides=16, origin=(0, 0, 0), axis='Z', smooth=True, mat_fn=None, phase=0.0, basis=None):
    """prof: list of (radius, height) from bottom to top. Poles where r == 0.
    basis: optional 3x3 rotation applied to the local ring before placing."""
    o = Vector(origin)
    rows = []
    for r, h in prof:
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides + phase
            c, s_ = math.cos(a) * r, math.sin(a) * r
            if basis is not None:
                ring.append(o + basis @ Vector((c, s_, h)))
            elif axis == 'Z':
                ring.append(o + Vector((c, s_, h)))
            elif axis == 'Y':
                ring.append(o + Vector((c, h, s_)))
            else:
                ring.append(o + Vector((h, c, s_)))
        rows.append(ring)
    # Winding: the grid's raw normal is left-of-travel in the (r, h) plane for
    # the Z/X/basis mappings and right-of-travel for Y. The outward side of a
    # solid of revolution is right-of-travel when the profile (closed along the
    # axis) runs counter-clockwise in (r, h), left-of-travel when clockwise.
    area = 0.0
    loop = list(prof) + [(0.0, prof[-1][1]), (0.0, prof[0][1])]
    for (r0, h0), (r1, h1) in zip(loop, loop[1:] + loop[:1]):
        area += r0 * h1 - r1 * h0
    ccw = area >= 0
    flip = (axis != 'Y' or basis is not None) == ccw
    vg = g.grid(rows, mat_fn if mat_fn else mat, smooth=smooth, closed=True, flip=flip)
    return vg


def lathe_obj_merge(g):
    g.merge(1e-6)


def box_geo(g, c, size, mat, smooth=False):
    cx, cy, cz = c; sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    v = [g.v(Vector((cx + x * sx, cy + y * sy, cz + z * sz)))
         for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    # index = xi*4 + yi*2 + zi
    F = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    for f in F:
        g.face([v[i] for i in f], mat, smooth)
    return v


def rounded_box_obj(name, c, size, mat, width=0.03, segments=3, mats=None, parent=None, rot=None):
    g = Geo()
    box_geo(g, (0, 0, 0), size, mat, smooth=True)
    if mats:
        g.bm.faces.ensure_lookup_table()
        for fi, m in mats.items():
            g.bm.faces[fi].material_index = g.mi(m)
    ob = g.to_object(name, parent, c)
    if rot:
        ob.rotation_euler = rot
    b = ob.modifiers.new('Bevel', 'BEVEL')
    b.width = width; b.segments = segments; b.limit_method = 'ANGLE'
    b.angle_limit = math.radians(30); b.harden_normals = True
    return ob


def superellipse_ring(cx, cz, a, h_top, h_bot, n_top, n_bot, y, m=20, a_bot=None):
    ring = []
    for k in range(m):
        t = 2 * math.pi * k / m
        c, s_ = math.cos(t), math.sin(t)
        top = s_ >= 0
        n = n_top if top else n_bot
        aa = a if (top or a_bot is None) else a_bot
        x = aa * math.copysign(abs(c) ** (2 / n), c)
        z = (h_top if top else h_bot) * math.copysign(abs(s_) ** (2 / n), s_)
        ring.append(Vector((cx + x, y, cz + z)))
    return ring


# --------------------------------------------------------------- text -----
_FONT = None


def text_polys(body, size, spacing=1.0, subdiv=True, res=3):
    """Return (verts2d, faces) of flat, centred lettering. subdiv splits long
    edges so the letters can hug a curved surface; flat panels skip it."""
    global _FONT
    if _FONT is None:
        try:
            _FONT = bpy.data.fonts.load(FONT_PATH)
        except Exception:
            _FONT = bpy.data.fonts.get('Bfont Regular') or None
    cu = bpy.data.curves.new('tmp_text', 'FONT')
    cu.body = body
    if _FONT:
        cu.font = _FONT
    cu.size = size
    cu.space_character = spacing
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    cu.resolution_u = res
    cu.fill_mode = 'FRONT' if hasattr(cu, 'fill_mode') else cu.fill_mode
    ob = bpy.data.objects.new('tmp_text', cu)
    COL.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    for _ in range(2 if subdiv else 0):
        long_edges = [e for e in bm.edges if e.calc_length() > size * 0.35]
        if long_edges:
            bmesh.ops.subdivide_edges(bm, edges=long_edges, cuts=1, use_grid_fill=False)
            bmesh.ops.triangulate(bm, faces=bm.faces[:])
    verts = [v.co.copy() for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    bpy.data.objects.remove(ob); bpy.data.curves.remove(cu); bpy.data.meshes.remove(me)
    return verts, faces


def fitted_text(body, width, size, subdiv=False, res=2):
    """Lettering of cap size `size`, letter-spaced to fill `width` (or scaled
    down to it when it is too wide even set tight)."""
    def w_of(sp):
        vs, fs = text_polys(body, size, sp, subdiv=subdiv, res=res)
        xs = [v.x for v in vs]
        return max(xs) - min(xs), vs, fs
    lo, hi = 0.9, 4.0
    w_lo, vs, fs = w_of(lo)
    if w_lo >= width:
        k = width / w_lo
        return [Vector((v.x * k, v.y * k, 0)) for v in vs], fs
    for _ in range(14):
        mid = (lo + hi) / 2
        w, vs_, fs_ = w_of(mid)
        if w < width:
            lo, vs, fs = mid, vs_, fs_
        else:
            hi = mid
    xs = [v.x for v in vs]
    c = (max(xs) + min(xs)) / 2
    return [Vector((v.x - c, v.y, 0)) for v in vs], fs


def decal(g, verts2d, faces, mapfn, mat, bvh=None, ray_dir=None, offset=0.006):
    """Map 2D (u, v) to 3D with mapfn; optionally snap onto a surface by
    raycasting along ray_dir, then lift by offset along the surface normal."""
    vs = []
    for p in verts2d:
        q = mapfn(p.x, p.y)
        if bvh is not None:
            d = Vector(ray_dir).normalized()
            hit = bvh.ray_cast(q - d * 0.4, d, 4.0)
            if hit[0] is not None:
                nn = hit[1]
                if nn.dot(d) > 0:
                    nn = -nn
                q = hit[0] + nn * offset
        vs.append(g.v(q))
    for f in faces:
        g.face([vs[i] for i in f], mat, smooth=False)


def grid2d(w, h, nu, nv):
    vs = [Vector((lerp(-w / 2, w / 2, i / nu), lerp(-h / 2, h / 2, j / nv), 0))
          for j in range(nv + 1) for i in range(nu + 1)]
    fs = []
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i
            fs.append([a, a + 1, a + 1 + nu + 1, a + nu + 1])
    return vs, fs


# ================================================= HULL GRAPHICS (decals) ===
PIN_LO, PIN_HI = 0.142, 0.122   # pinstripe band, measured down from the sheer


def build_hull_graphics():
    g = Geo()
    # "RESCUE" amidships, white, reading bow-ward on each side
    tv, tf = text_polys('RESCUE', 0.40, 1.08)
    zc, yc = 0.52, -1.25
    decal(g, tv, tf, lambda u, v: Vector((1.6, yc + u, zc + v)), 'paint_white', HULL_BVH, (-1, 0, 0))
    decal(g, tv, tf, lambda u, v: Vector((-1.6, yc - u, zc + v)), 'paint_white', HULL_BVH, (1, 0, 0))
    # "KESTREL" on the bow, navy
    kv, kf = text_polys('KESTREL', 0.27, 1.08)
    yk, zk = 2.92, 0.84
    decal(g, kv, kf, lambda u, v: Vector((1.6, yk + u, zk + v + u * 0.05)), 'paint_navy', HULL_BVH, (-1, 0, 0))
    decal(g, kv, kf, lambda u, v: Vector((-1.6, yk - u, zk + v - u * 0.05)), 'paint_navy', HULL_BVH, (1, 0, 0))

    # the rescue slash: a white band and a thin navy band leaning forward
    def slash(y_bot, width, lean, mat):
        vs, fs = grid2d(1.0, 1.0, 1, 12)

        def mp(u, v, side):
            s = v + 0.5                       # 0 bottom .. 1 top
            w = (u + 0.5) * width
            y = y_bot + w + s * lean
            zb = z_boot(y) + 0.012
            zt = z_sheer(y) - PIN_LO - 0.004  # stops just under the pinstripe
            return Vector((1.6 * side, y, lerp(zb, zt, s)))
        decal(g, vs, fs, lambda u, v: mp(u, v, 1), mat, HULL_BVH, (-1, 0, 0), 0.0065)
        decal(g, vs, [list(reversed(f)) for f in fs], lambda u, v: mp(u, v, -1), mat, HULL_BVH, (1, 0, 0), 0.0065)

    slash(1.02, 0.30, 0.42, 'paint_white')
    slash(0.80, 0.09, 0.42, 'paint_navy')

    # white pinstripe just under the rubbing strake, transom corner to the bow
    y0, y1 = Y_CORNER + 0.03, 4.22
    n = 40
    vs, fs = grid2d(1.0, 1.0, n, 1)

    def pin(u, v, side):
        t = u + 0.5
        y = lerp(y0, y1, t)
        z = z_sheer(y) - lerp(PIN_LO, PIN_HI, v + 0.5)
        return Vector((1.6 * side, y, z))
    decal(g, vs, fs, lambda u, v: pin(u, v, 1), 'paint_white', HULL_BVH, (-1, 0, 0), 0.006)
    decal(g, vs, [list(reversed(f)) for f in fs], lambda u, v: pin(u, v, -1), 'paint_white', HULL_BVH, (1, 0, 0), 0.006)

    # transom corners, the face the chase camera lives on: scupper, two strips of
    # white retro-reflective tape bracketing a small RESCUE
    # art3: a big K1 between the tapes (the small RESCUE did not read at chase range)
    tv, tf = text_polys('K1', 0.27, 1.12, subdiv=False, res=2)
    for sx in (-1, 1):
        xc = sx * 1.03
        for zc, w_, h_, mat in ((Z_SOLE + 0.04, 0.16, 0.06, 'dark_trim'), (0.835, 0.36, 0.05, 'paint_white'),
                                (0.535, 0.36, 0.05, 'paint_white')):
            vs, fs = grid2d(w_, h_, 1, 1)
            decal(g, vs, fs, lambda u, v, xc=xc, zc=zc: Vector((xc + u, -4.4, zc + v)), mat,
                  HULL_BVH, (0, 1, 0), 0.006)
        decal(g, tv, tf, lambda u, v, xc=xc: Vector((xc + u, -4.4, 0.685 + v)), 'paint_white',
              HULL_BVH, (0, 1, 0), 0.006)
    return g.to_object('hull_graphics')


HULL_GFX = build_hull_graphics()


# ============================================================ TRIM TABS ====
def build_trim_tabs():
    g = Geo()
    for sx in (-1, 1):
        xc = sx * 0.88
        zb = z_keel(YT) + abs(xc) * math.tan(math.atan2(z_chine(YT) - ZK, b_chine(YT))) + 0.005
        y0 = y_tr(zb)
        box_geo(g, (xc, y0 - 0.12, zb - 0.012), (0.34, 0.24, 0.018), 'metal', False)
        tube(g, [(xc, y0 - 0.01, zb + 0.16), (xc, y0 - 0.16, zb - 0.0)], 0.022, 'dark_trim', 8)
    return g.to_object('trim_tabs')


TRIM_TABS = build_trim_tabs()

# ============================================================== CONSOLE ====
# art3: a real centre-console section instead of a box. In side view the front
# face rakes 20 degrees aft from the plinth, the dash leans 30 degrees back
# toward the helm, and the top carries a wraparound windscreen raked 30 degrees
# with side wings swept back 35 degrees under a curved top frame line. In plan
# every vertical corner is a 70 mm radius (4 segments), the top edge is a
# 35 mm fillet, and support loops keep the smooth corners' shading off the
# big flat faces.
CON_X = 0.56                      # half-width
CON_R = 0.07                      # vertical corner radius
Z_CB = Z_SOLE + 0.055             # console foot (top of the plinth)
CON_TOP = 1.43
CON_DASH_LO = 1.03
Y_CA, Y_CF = 0.04, 1.12           # aft face, front foot
TAN_FR = math.tan(math.radians(20.0))
TAN_DA = math.tan(math.radians(30.0))
TOP_R = 0.035
_DB = 0.03                        # half-length of the dash-kink blend


def con_y_fwd(z):
    return Y_CF - (z - Z_CB) * TAN_FR


def con_y_aft(z):
    d = z - CON_DASH_LO
    if d <= -_DB:
        return Y_CA
    if d >= _DB:
        return Y_CA + d * TAN_DA
    return Y_CA + TAN_DA * (d + _DB) ** 2 / (4 * _DB)


_DZ0, _DZ1 = CON_DASH_LO + _DB + 0.01, CON_TOP - TOP_R - 0.01     # the flat dash face
DASH_V = Vector((0.0, math.sin(math.radians(30)), math.cos(math.radians(30))))   # up the dash
DASH_N = Vector((0.0, -math.cos(math.radians(30)), math.sin(math.radians(30))))  # facing the helm
DASH_O = Vector((0.0, con_y_aft((_DZ0 + _DZ1) / 2), (_DZ0 + _DZ1) / 2))
DASH_HALF = (_DZ1 - _DZ0) / 2 / math.cos(math.radians(30))


def dash_pt(x, v, off=0.0):
    return DASH_O + Vector((x, 0, 0)) + DASH_V * v + DASH_N * off


def rrect_ring(xh, ya, yf, r, z, n=4, sup=0.010):
    """Plan ring: a rounded rectangle, counter-clockwise from above. Each
    corner arc (n segments) is bracketed by support points `sup` along the
    straight sides, so a smooth corner's shading stays off the flat faces."""
    out = []
    for cx, cy, a0 in ((xh - r, yf - r, 0), (-xh + r, yf - r, 90), (-xh + r, ya + r, 180), (xh - r, ya + r, 270)):
        arc = [Vector((cx + r * math.cos(math.radians(a0 + 90 * k / n)),
                       cy + r * math.sin(math.radians(a0 + 90 * k / n)), z)) for k in range(n + 1)]
        t0 = Vector((-math.sin(math.radians(a0)), math.cos(math.radians(a0)), 0))
        t1 = Vector((-math.sin(math.radians(a0 + 90)), math.cos(math.radians(a0 + 90)), 0))
        out += [arc[0] - t0 * sup] + arc + [arc[-1] + t1 * sup]
    return out


def build_console():
    g = Geo()
    zs = [(Z_CB, 0.0), (CON_DASH_LO - _DB - 0.01, 0.0), (CON_DASH_LO - _DB, 0.0), (CON_DASH_LO, 0.0),
          (CON_DASH_LO + _DB, 0.0), (_DZ0, 0.0), (_DZ1, 0.0)]
    for a in (0.0, 30.0, 60.0, 90.0):
        r = math.radians(a)
        zs.append((CON_TOP - TOP_R * (1 - math.sin(r)), TOP_R * (1 - math.cos(r))))
    zs.append((CON_TOP, TOP_R + 0.012))                    # support ring on the flat top
    rings = []
    for z, ins in zs:
        rings.append(rrect_ring(CON_X - ins, con_y_aft(min(z, CON_TOP - TOP_R)) + ins,
                                con_y_fwd(min(z, CON_TOP - TOP_R)) - ins, CON_R - ins, z))
    vg = g.grid(rings, 'paint_white', smooth=True, closed=True, flip=True)
    top = vg[-1]
    face_out(g, top, 'paint_white', (0, 0, 1))
    face_out(g, vg[0], 'paint_white', (0, 0, -1))
    for f in g.bm.faces:
        if len(f.verts) > 4:
            f.smooth = False
    tset, bset = set(top), set(vg[0])
    for e in g.bm.edges:
        a_, b_ = e.verts
        e.smooth = not ((a_ in tset and b_ in tset) or (a_ in bset and b_ in bset))
    return g.to_object('console')


CONSOLE = build_console()
CONSOLE_PLINTH = rounded_box_obj('console_plinth', (0, (Y_CA + Y_CF) / 2, Z_SOLE + 0.03),
                                 (2 * CON_X - 0.05, Y_CF - Y_CA - 0.06, 0.06), 'deck_nonskid', width=0.02, segments=2)


def build_helm():
    g = Geo()
    # the dark dash panel: a 12 mm slab with chamfered edges on the white dash
    U, V, N = Vector((1, 0, 0)), DASH_V, DASH_N
    hx, hv = 0.47, DASH_HALF - 0.012
    back = [DASH_O + U * (sx * hx) + V * (sy * hv) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    front = [DASH_O + U * (sx * (hx - 0.008)) + V * (sy * (hv - 0.008)) + N * 0.012 for sx, sy in
             ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    face_out(g, front, 'dark_trim', N)
    for k in range(4):
        k2 = (k + 1) % 4
        mid = (back[k] + back[k2]) / 2 - DASH_O
        face_out(g, [back[k], back[k2], front[k2], front[k]], 'dark_trim', mid.normalized() + N)
    # wheel: a 20-segment rim on a hub with three round spokes, tilted with the dash
    wc = dash_pt(0.10, -0.035, 0.16)
    ax = DASH_N
    u = Vector((1, 0, 0)); v = ax.cross(u).normalized()
    NR = 20
    rim = [wc + (u * math.cos(2 * math.pi * k / NR) + v * math.sin(2 * math.pi * k / NR)) * 0.17 for k in range(NR)]
    tube(g, rim + rim[:2], 0.016, 'metal', 6, caps=False)
    R = ax.to_track_quat('Z', 'Y').to_matrix()
    revolve(g, [(0.0, -0.06), (0.035, -0.06), (0.035, 0.0), (0.028, 0.02), (0.0, 0.025)], 'dark_trim',
            sides=10, origin=wc, basis=R)
    for k in range(3):
        a = math.pi / 2 + 2 * math.pi * k / 3
        d = u * math.cos(a) + v * math.sin(a)
        tube(g, [wc + d * 0.03 - ax * 0.012, wc + d * 0.10 - ax * 0.004, wc + d * 0.163], 0.010, 'metal', 6)
    # steering column boss
    tube(g, [dash_pt(0.10, -0.035, 0.012), wc - ax * 0.02], 0.03, 'dark_trim', 8)
    # two chart-plotter MFDs: raised 15 mm bezels with a live screen set into each
    for x, w_, h_, split in ((-0.245, 0.36, 0.22, 0.62), (0.355, 0.16, 0.12, None)):
        mfd(g, dash_pt(x, 0.03, 0.012), w_, h_, split)
    # twin throttle binnacle (starboard of the wheel), square to the dash
    tb = dash_pt(0.355, -0.125, 0.012)
    bx = [tb + U * (sx * 0.07) + V * (sy * 0.045) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bf = [p + N * 0.07 for p in bx]
    face_out(g, bf, 'dark_trim', N)
    for k in range(4):
        k2 = (k + 1) % 4
        face_out(g, [bx[k], bx[k2], bf[k2], bf[k]], 'dark_trim', ((bx[k] + bx[k2]) / 2 - tb).normalized())
    for dx in (-0.03, 0.03):
        p0 = tb + U * dx + N * 0.07
        p1 = p0 + N * 0.10 + V * 0.05
        tube(g, [p0, p1], 0.008, 'metal', 5)
        revolve(g, [(0.0, -0.02), (0.022, -0.012), (0.022, 0.012), (0.0, 0.02)], 'dark_trim',
                sides=8, origin=p1, axis='X')
    # compass on the console top, inside the windscreen
    revolve(g, [(0.0, 0.0), (0.075, 0.0), (0.075, 0.02), (0.05, 0.06), (0.0, 0.075)],
            'dark_trim', sides=10, origin=(0.0, 0.52, CON_TOP))
    # stainless grab rail wrapped round the console: down both sides and across
    # the raked front, on standoffs to the front face
    zr = 1.25
    xo, yf = CON_X + 0.065, con_y_fwd(1.25) + 0.065
    ys = con_y_aft(zr) + CON_R + 0.03
    wrap = [(-CON_X, ys, zr), (-xo, ys + 0.06, zr), (-xo, yf, zr), (xo, yf, zr), (xo, ys + 0.06, zr), (CON_X, ys, zr)]
    tube(g, fillet(wrap, 0.07, 2), 0.016, 'metal', 6)
    for sx in (-1, 1):
        tube(g, [(sx * (xo - 0.06), yf, zr), (sx * (CON_X - 0.16), con_y_fwd(zr - 0.03) - 0.01, zr - 0.03)],
             0.012, 'metal', 5, caps=False)
    # foot rail under the dash
    zf = 0.46 + DZ
    tube(g, fillet([(-0.42, Y_CA + 0.01, zf), (-0.42, Y_CA - 0.12, zf), (0.42, Y_CA - 0.12, zf), (0.42, Y_CA + 0.01, zf)],
                   0.05, 2), 0.017, 'metal', 5)
    g.merge(1e-6)
    return g.to_object('helm')


def mfd(g, c, w, h, split=None, t=0.015, border=0.022, recess=0.004):
    """A multifunction display on the dash plane at c: a raised bezel frame
    (t proud) with the emissive screen set a few mm into it."""
    U, V, N = Vector((1, 0, 0)), DASH_V, DASH_N

    def P(x, y, z):
        return c + U * x + V * y + N * z
    ow, oh, iw, ih = w / 2 + border, h / 2 + border, w / 2, h / 2
    corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))
    ob = [P(sx * ow, sy * oh, 0.0) for sx, sy in corners]
    ot = [P(sx * ow, sy * oh, t) for sx, sy in corners]
    it = [P(sx * iw, sy * ih, t) for sx, sy in corners]
    ib = [P(sx * iw, sy * ih, t - recess) for sx, sy in corners]
    for k in range(4):
        k2 = (k + 1) % 4
        mid = (ob[k] + ob[k2]) / 2 - c
        out = mid - N * mid.dot(N)
        face_out(g, [ob[k], ob[k2], ot[k2], ot[k]], 'dark_trim', out)      # outer wall
        face_out(g, [ot[k], ot[k2], it[k2], it[k]], 'dark_trim', N)        # frame
        face_out(g, [it[k], it[k2], ib[k2], ib[k]], 'dark_trim', -out)     # inner wall
    face_out(g, ib, 'screen', N)
    if split:                          # split-screen divider and a status bar, 1.5 mm proud
        xs = -iw + split * w
        face_out(g, [P(xs - 0.003, -ih, t - recess + 0.0015), P(xs + 0.003, -ih, t - recess + 0.0015),
                     P(xs + 0.003, ih, t - recess + 0.0015), P(xs - 0.003, ih, t - recess + 0.0015)], 'dark_trim', N)
        face_out(g, [P(-iw, ih - 0.024, t - recess + 0.0015), P(iw, ih - 0.024, t - recess + 0.0015),
                     P(iw, ih - 0.018, t - recess + 0.0015), P(-iw, ih - 0.018, t - recess + 0.0015)], 'dark_trim', N)
    # the chart: a pale island with an irregular 11-point coastline on the
    # glowing teal sea, and an orange own-ship chevron with its heading line,
    # 1 mm proud of the glass
    cw = (split * w if split else w) - 0.012          # chart pane
    cx0 = -iw + 0.006
    ch = 2 * ih - (0.03 if split else 0.012)
    cy0 = -ih + 0.006
    zc = t - recess + 0.001
    isl = [(0.60, 0.12), (0.71, 0.16), (0.83, 0.13), (0.93, 0.33), (0.88, 0.47), (0.94, 0.66), (0.80, 0.86),
           (0.66, 0.80), (0.55, 0.88), (0.45, 0.60), (0.52, 0.36)]
    ctr = P(cx0 + 0.70 * cw, cy0 + 0.50 * ch, zc)
    ring = [P(cx0 + a * cw, cy0 + b * ch, zc) for a, b in isl]
    for k in range(len(ring)):
        face_out(g, [ctr, ring[k], ring[(k + 1) % len(ring)]], 'paint_white', N)
    sx0, sy0 = cx0 + 0.22 * cw, cy0 + 0.28 * ch
    s_ = 0.07 * ch
    face_out(g, [P(sx0 - s_ * 0.6, sy0 - s_, zc), P(sx0 + s_ * 0.6, sy0 - s_, zc), P(sx0, sy0 + s_, zc)], 'paint_orange', N)
    face_out(g, [P(sx0 - 0.0015, sy0 + s_, zc), P(sx0 + 0.0015, sy0 + s_, zc),
                 P(cx0 + 0.46 * cw, cy0 + 0.62 * ch, zc), P(cx0 + 0.46 * cw - 0.003, cy0 + 0.62 * ch, zc)], 'paint_orange', N)


HELM = build_helm()


def build_cooler_seat():
    """Cooler box with a seat cushion in front of the console, and a back
    cushion reclined 20 degrees on the console's raked front face."""
    y0, y1 = 1.13, 1.63
    zt = 0.74 + DZ
    box = rounded_box_obj('cooler', (0.0, (y0 + y1) / 2, (Z_SOLE + 0.02 + zt) / 2), (0.86, y1 - y0, zt - Z_SOLE - 0.02),
                          'paint_white', width=0.03, segments=2)
    cush = rounded_box_obj('cooler_cushion', (0.0, (y0 + y1) / 2 - 0.01, zt + 0.04), (0.84, 0.50, 0.08),
                           'paint_navy', width=0.03, segments=2)
    fz0, fz1 = 0.84 + DZ, 1.14 + DZ
    zc = (fz0 + fz1) / 2
    tilt = math.radians(20.0)
    back = rounded_box_obj('cooler_back', (0.0, con_y_fwd(zc) + 0.036 / math.cos(tilt), zc), (0.78, 0.07, fz1 - fz0),
                           'paint_navy', width=0.025, segments=2, rot=(tilt, 0.0, 0.0))
    g = Geo()
    for sx in (-1, 1):                  # latches and end handles
        box_geo(g, (sx * 0.24, y1 + 0.004, zt - 0.06), (0.07, 0.012, 0.035), 'dark_trim')
        tube(g, fillet([(sx * 0.432, y0 + 0.12, zt - 0.10), (sx * 0.47, y0 + 0.16, zt - 0.10),
                        (sx * 0.47, y1 - 0.16, zt - 0.10), (sx * 0.432, y1 - 0.12, zt - 0.10)], 0.03, 3),
             0.011, 'metal', 5)
    return [box, cush, back, g.to_object('cooler_hw')]


COOLER = build_cooler_seat()

# ---- the wraparound windscreen
# Stations (starboard half, centre -> aft end of the wing) on the console top:
# base plan point, the height of the glass there, and the inward plan normal.
WS_Z = CON_TOP + 0.010
_WS_RC, _WS_CX, _WS_CY, _WS_X = 0.16, 0.33, 0.54, 0.49


def _ws_stations():
    st = []
    for x in (0.0, 0.17):
        st.append((Vector((x, 0.70)), Vector((0.0, -1.0)), 1.0))
    for k in range(5):                                   # the corner arc, 90 -> 0 degrees
        a = math.radians(90 - 22.5 * k)
        n = -Vector((math.cos(a), math.sin(a)))
        st.append((Vector((_WS_CX + _WS_RC * math.cos(a), _WS_CY + _WS_RC * math.sin(a))), n, math.sin(a)))
    for y in (0.43, 0.33):
        st.append((Vector((_WS_X, y)), Vector((-1.0, 0.0)), 0.0))
    return st


_WS_H = [0.47, 0.465, 0.452, 0.442, 0.428, 0.410, 0.388, 0.345, 0.295]   # glass height: the curved top line


def ws_stations():
    """[(base, top)] across the whole screen, port aft end -> starboard aft end.
    The front is raked 30 degrees; the wings tumble in 10 degrees and sweep
    back 35 degrees, blended round the corner."""
    half = []
    for (b, n, f), h in zip(_ws_stations(), _WS_H):
        rho = math.radians(lerp(10.0, 30.0, f))
        sig = math.radians(lerp(35.0, 0.0, f))
        d = n * (h * math.tan(rho)) + Vector((0.0, -h * math.tan(sig)))
        base = Vector((b.x, b.y, WS_Z))
        top = Vector((b.x + d.x, b.y + d.y, WS_Z + h))
        half.append((base, top))
    port = [(Vector((-b.x, b.y, b.z)), Vector((-t.x, t.y, t.z))) for b, t in reversed(half[1:])]
    return port + half


WS = ws_stations()
WS_TOP_Z = max(t.z for _, t in WS)


def build_glass():
    g = Geo()
    rows = [[b.lerp(t, 0.01) for b, t in WS], [b.lerp(t, 0.965) for b, t in WS]]
    g.grid(rows, 'glass', smooth=True, flip=True)
    for f in g.bm.faces:                       # faces out of the console
        f.normal_update()
        c = f.calc_center_median()
        if f.normal.dot(Vector((c.x, c.y - 0.45, 0.0))) < 0:
            f.normal_flip()
    return g.to_object('glass')


def build_screen_frame():
    g = Geo()
    tops = [t for _, t in WS]
    bases = [b for b, _ in WS]
    n = len(WS)
    # the top frame along the curved top line, a gasket along the base, the
    # corner mullions where the curved corner glass meets the flat panes, and
    # the swept aft edges of the wings
    # (a black frame, so it outlines the glass against the stainless grab rail)
    tube(g, tops, 0.017, 'dark_trim', 6, caps=True)
    tube(g, bases, 0.009, 'dark_trim', 4, caps=True)
    ic = [2, 6]                                            # corner start / end stations on each half
    for i in [n // 2 - k for k in ic] + [n // 2 + k for k in ic] + [0, n - 1]:
        b, t = WS[i]
        tube(g, [b, t], 0.013 if i in (0, n - 1) else 0.011, 'dark_trim', 4, caps=False)
    # stainless grab rail above the frame, following the curved top line,
    # its ends turning down onto the console top behind the wings
    rail = []
    for b, t in WS:
        rail.append(t + Vector((0.0, -0.035, 0.085)))
    # the legs run down parallel to the wings' swept aft edges to the console top
    b0, t0 = WS[0]
    foot0 = Vector((b0.x + 0.02, b0.y - 0.035, CON_TOP))
    foot1 = Vector((-foot0.x, foot0.y, CON_TOP))
    path = (fillet([foot0, rail[0], rail[1]], 0.06, 3)[:-1] + rail[1:-1] +
            fillet([rail[-2], rail[-1], foot1], 0.06, 3)[1:])
    tube(g, path, 0.016, 'metal', 6, caps=False)
    for i in (n // 2 - 2, n // 2 + 2):                     # standoffs to the frame at the corners
        tube(g, [WS[i][1] + Vector((0, -0.01, 0.012)), rail[i] - Vector((0, 0, 0.012))], 0.010, 'metal', 4, caps=False)
    return g.to_object('screen_frame')


GLASS = build_glass()
SCREEN_FRAME = build_screen_frame()

# ================================================================ SEATS ====
SEAT_ROWS = (-0.42, -1.30)
POD_TOP = 0.93 + DZ


def section_ring(w, h, rt, rb, nt=3, nb=1, crown=0.0):
    """A cushion section in its own (u, v) plane: flat base v = 0 from -w to w,
    top corners of radius rt (nt segments), base corners rb, and an optional
    crown point on top. Counter-clockwise in (u, v)."""
    pts = []
    for cu, cv, r, a0, n in ((w - rb, rb, rb, 270, nb), (w - rt, h - rt, rt, 0, nt),
                             (-w + rt, h - rt, rt, 90, nt), (-w + rb, rb, rb, 180, nb)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cu + r * math.cos(a), cv + r * math.sin(a)))
        if a0 == 0 and crown:
            pts.append((0.0, h + crown))
    return pts


def cushion(g, stations, mat, place, rb=None, nb=1):
    """Loft cushion sections along a path. stations: (s, w, h, rt, crown);
    place(s, u, v) -> 3D point. Flat end caps; smooth everywhere else, with
    the base and cap outlines sharp - no subdivision, so no stray creases."""
    rows = []
    for s_, w, h, rt, cr in stations:
        rows.append([place(s_, u, v) for u, v in section_ring(w, h, rt, rt if rb is None else rb, nb=nb, crown=cr)])
    vg = g.grid(rows, mat, smooth=True, closed=True)
    c0 = sum((v.co for v in vg[0]), Vector()) / len(vg[0])
    c1 = sum((v.co for v in vg[-1]), Vector()) / len(vg[-1])
    face_out(g, vg[0], mat, c0 - c1)
    face_out(g, vg[-1], mat, c1 - c0)
    # outward winding for the side rows (the loft direction is arbitrary)
    mid = (c0 + c1) / 2
    fl = [f for f in g.bm.faces if len(f.verts) == 4 and f.is_valid]
    for f in fl:
        f.normal_update()
    out = sum(f.normal.dot(f.calc_center_median() - mid) for f in fl)
    if out < 0:
        for f in fl:
            f.normal_flip()
    ends = set(vg[0]) | set(vg[-1])
    first = set(vg[0])
    for e in g.bm.edges:
        a_, b_ = e.verts
        same_end = a_ in ends and b_ in ends and ((a_ in first) == (b_ in first))
        e.smooth = not (same_end or (a_.co.z < 1e-4 and b_.co.z < 1e-4))


def build_seats():
    """Two rows of jockey seats: white pods on grey toe-kick plinths, each seat a
    straddle saddle (knee roll, dished seat, rear bolster) and a reclined
    backrest. art3: the cushions are lofted sections with rounded corners
    instead of subdivided boxes (no diagonal smoothing creases)."""
    obs = []
    for r, yc in enumerate(SEAT_ROWS):
        zb = Z_SOLE + 0.055
        pod = rounded_box_obj('seat_pod_%d' % r, (0, yc, (zb + POD_TOP) / 2), (1.0, 0.52, POD_TOP - zb),
                              'paint_white', width=0.05, segments=3)
        obs.append(pod)
        obs.append(rounded_box_obj('seat_plinth_%d' % r, (0, yc, Z_SOLE + 0.03), (0.92, 0.44, 0.06), 'deck_nonskid',
                                   width=0.02, segments=2))
        for sx in (-1, 1):
            side = 'l' if sx < 0 else 'r'
            g = Geo()
            st = [(-0.255, 0.168, 0.170, 0.05, 0.0), (-0.246, 0.191, 0.193, 0.06, 0.0),
                  (-0.228, 0.200, 0.200, 0.06, 0.006), (-0.15, 0.200, 0.180, 0.06, 0.008),
                  (-0.07, 0.195, 0.140, 0.055, 0.008), (0.02, 0.186, 0.117, 0.05, 0.008),
                  (0.13, 0.160, 0.113, 0.05, 0.008), (0.212, 0.133, 0.132, 0.05, 0.006),
                  (0.238, 0.124, 0.129, 0.045, 0.0), (0.252, 0.100, 0.108, 0.04, 0.0)]
            cushion(g, st, 'paint_navy', lambda s_, u, v: Vector((u, s_, v)), rb=0.012, nb=1)
            obs.append(g.to_object('seat_saddle_%d%s' % (r, side), None, (sx * 0.25, yc + 0.02, POD_TOP)))
            # backrest pad, reclined, narrower at the top
            g = Geo()
            bst = [(0.190, 0.182, 0.080, 0.03, 0.0), (0.200, 0.196, 0.104, 0.04, 0.0), (0.216, 0.200, 0.110, 0.045, 0.0),
                   (0.400, 0.178, 0.110, 0.045, 0.0), (0.418, 0.172, 0.100, 0.04, 0.0), (0.430, 0.156, 0.076, 0.03, 0.0)]
            # section (u across, v through the pad from its back face forward), stacked up z
            cushion(g, bst, 'paint_navy',
                    lambda z, u, v: Vector((u, -0.055 + v - 0.035 * (z - 0.19) / 0.24, z)), nb=3)
            obs.append(g.to_object('seat_back_%d%s' % (r, side), None, (sx * 0.25, yc - 0.21, POD_TOP)))
    g = Geo()
    for yc in SEAT_ROWS:
        # one grab bar across the back of each row, just over the backrests,
        # rising out of the pod behind the outer edge of each seat
        yb = yc - 0.30
        zt = POD_TOP + 0.47
        tube(g, fillet([(-0.465, yc - 0.23, POD_TOP - 0.02), (-0.465, yb, zt), (0.465, yb, zt),
                        (0.465, yc - 0.23, POD_TOP - 0.02)], 0.07, [2, 2]), 0.016, 'metal', 5, caps=False)
        # footrest bar across the back of each pod
        zf = 0.41 + DZ
        tube(g, fillet([(-0.44, yc - 0.25, zf), (-0.44, yc - 0.36, zf), (0.44, yc - 0.36, zf),
                        (0.44, yc - 0.25, zf)], 0.05, [1, 1]), 0.016, 'metal', 4, caps=False)
    obs.append(g.to_object('seat_rails'))
    return obs


SEATS = build_seats()

# ================================================================ T-TOP ====
# A four-post T-top over the helm. The roof shades the helmsman and the front
# seat row, its front edge just aft of the windscreen's top rail. Four straight
# posts raked 5 degrees aft stand on the sole just inside the gunwales, joined
# only by a frame under the roof: no diagonals, so the aft deck is a clear
# casualty-recovery deck. It carries the boat's identity from the chase camera
# and from the game's helicopter: the orange roof, the roof ID, the RESCUE
# fascia on the aft crossbar, the blue lights and the radome.
HT_Y0, HT_Y1 = -1.36, 0.50           # aft and forward edges of the roof
HT_W = 1.18                          # half-width
HT_RF, HT_RA = 0.32, 0.20            # plan corner radii, forward and aft
HT_Z0 = 2.50                         # flat underside (2.15 m headroom over the sole)
HT_T = 0.130                         # art3: moulded perimeter 130 mm deep (it read as an 88 mm plank)
HT_CROWN = 0.030                     # camber of the orange top, both ways
HT_CH = 0.016                        # 45 degree chamfer round the top edge
HT_LIP = 0.050                       # quarter-round lip (3 segments) on the underside edge

POST_X = 1.10                        # posts stand just inside the gunwales
POST_R = 0.042
POST_TAN = math.tan(math.radians(5.0))   # rake: tops lean aft
POST_AFT_YB, POST_FWD_YB = -1.08, 0.16   # where the posts meet the sole
FRAME_Z = HT_Z0 - 0.036              # centreline of the frame tubes under the roof
FRAME_R = 0.034

RADAR_Y = 0.02                       # radome ahead of the roof's centre
MAST_Y = -1.22                       # all-round white light, centreline, aft edge
BLUE_X, BLUE_Y = 0.86, -0.72         # twin blue beacons flanking the roof ID
LB_Y = 0.40                          # blue LED light bar along the front edge
ID_Y = -0.72                         # roof ID mark centre
SEARCH = (0.80, 0.20)


def cap_top(y, inset=0.07):
    """A point on top of the starboard gunwale cap, `inset` in from the sheer."""
    return Vector((b_sheer(y) - inset * sec_at(y), y, z_sheer(y) + 0.025))


def post_at(yb, sx, z):
    """A point on a post (sole foot at y = yb) at height z."""
    return Vector((sx * POST_X, yb - (z - Z_SOLE) * POST_TAN, z))


Y_AFT_TOP = post_at(POST_AFT_YB, 1, FRAME_Z).y
Y_FWD_TOP = post_at(POST_FWD_YB, 1, FRAME_Z).y


def ht_half_w(y, inset=0.0):
    """Half-width of the roof's plan outline (a rounded rectangle), optionally
    offset inward by `inset` (the offset curve shares the corner centres)."""
    W = HT_W - inset
    if y > HT_Y1 - HT_RF:
        d = y - (HT_Y1 - HT_RF)
        return W - HT_RF + math.sqrt(max((HT_RF - inset) ** 2 - d * d, 0.0))
    if y < HT_Y0 + HT_RA:
        d = (HT_Y0 + HT_RA) - y
        return W - HT_RA + math.sqrt(max((HT_RA - inset) ** 2 - d * d, 0.0))
    return W


def ht_z(x, y):
    """Height of the roof's top surface."""
    yc, hl = (HT_Y0 + HT_Y1) / 2, (HT_Y1 - HT_Y0) / 2
    return HT_Z0 + HT_T + HT_CROWN * max(0.0, 1 - (x / HT_W) ** 2) * max(0.0, 1 - ((y - yc) / hl) ** 2)


def build_hardtop():
    """The moulded T-top: a crowned non-skid top, a 45 degree chamfer, a 130 mm
    white perimeter band, and a quarter-round lip (3 segments) turning under
    onto the flat ceiling. Support loops just above the lip and just inside it
    keep the smooth lip's shading off the flat band and the flat ceiling."""
    g = Geo()
    NR, NC = 11, 9
    ya, yb = HT_Y0 + HT_CH, HT_Y1 - HT_CH
    ys = [lerp(ya, yb, 0.5 - 0.5 * math.cos(math.pi * k / (NR - 1))) for k in range(NR)]
    T = []
    for y in ys:
        w = ht_half_w(y, HT_CH)
        T.append([g.v(Vector((w * s, y, ht_z(w * s, y)))) for s in [lerp(-1, 1, j / (NC - 1)) for j in range(NC)]])
    for k in range(NR - 1):
        for j in range(NC - 1):
            face_out(g, [T[k][j], T[k][j + 1], T[k + 1][j + 1], T[k + 1][j]], 'roof_nonskid', (0, 0, 1), smooth=True)
    # boundary loop, counter-clockwise from above
    loop = ([T[k][-1] for k in range(NR)] + [T[-1][j] for j in range(NC - 2, -1, -1)] +
            [T[k][0] for k in range(NR - 2, -1, -1)] + [T[0][j] for j in range(1, NC - 1)])

    def normal(p):
        sx = 1.0 if p.x >= 0 else -1.0
        if p.y > HT_Y1 - HT_RF:
            n = Vector((p.x - sx * (HT_W - HT_RF), p.y - (HT_Y1 - HT_RF), 0.0))
        elif p.y < HT_Y0 + HT_RA:
            n = Vector((p.x - sx * (HT_W - HT_RA), p.y - (HT_Y0 + HT_RA), 0.0))
        else:
            n = Vector((sx, 0.0, 0.0))
        if n.length < 1e-9:
            n = Vector((sx, 0.0, 0.0))
        return n.normalized()
    # rings below the top loop: chamfer foot, band, support loop, lip x3, ceiling support loop
    rings = [list(loop)]
    ring_defs = [(0.0, HT_Z0 + HT_T - HT_CH),                     # chamfer foot (outer face)
                 (0.0, HT_Z0 + HT_LIP + 0.010),                   # support loop on the band
                 (0.0, HT_Z0 + HT_LIP)]                           # lip start
    for a in (30.0, 60.0, 90.0):
        r = math.radians(a)
        ring_defs.append((HT_LIP * (1 - math.cos(r)), HT_Z0 + HT_LIP * (1 - math.sin(r))))
    ring_defs.append((HT_LIP + 0.012, HT_Z0))                      # support loop on the ceiling
    for inset, z in ring_defs:
        rr = []
        for v in loop:
            n = normal(v.co)
            q = v.co + n * (HT_CH - inset)
            rr.append(g.v(Vector((q.x, q.y, z))))
        rings.append(rr)
    n = len(loop)
    yc = (HT_Y0 + HT_Y1) / 2
    for r_i in range(len(rings) - 1):
        A, B = rings[r_i], rings[r_i + 1]
        for i in range(n):
            i2 = (i + 1) % n
            mid = (A[i].co + A[i2].co + B[i].co + B[i2].co) / 4
            out = Vector((mid.x, mid.y - yc, 0.0))
            if r_i == 0:
                d = out.normalized() + Vector((0, 0, 1))                  # chamfer faces up and out
            elif r_i >= 4:
                d = out.normalized() * 0.3 + Vector((0, 0, -1))           # lip and ceiling band face down
            else:
                d = out
            face_out(g, [A[i], B[i], B[i2], A[i2]], 'paint_white', d, smooth=r_i >= 1)
    face_out(g, list(rings[-1]), 'paint_white', (0, 0, -1))
    g.merge(1e-7)
    # creases: the top/chamfer and chamfer/band edges; the ceiling n-gon is flat
    top_set = set(loop)
    ch_set = set(rings[1])
    ceil_set = set(rings[-1])
    for e in g.bm.edges:
        a_, b_ = e.verts
        if (a_ in top_set and b_ in top_set) or (a_ in ch_set and b_ in ch_set):
            e.smooth = False
        elif a_ in ceil_set and b_ in ceil_set:
            e.smooth = False
        else:
            e.smooth = True
    return g.to_object('hardtop')


def build_visor():
    """The electronics visor that real T-tops carry under the front edge:
    white, 0.9 x 0.25 x 0.18 m, with a smoked dark face forward (it gives the
    bow view a face and carries a forward-facing RESCUE) and a dark radio
    panel angled down at the helm."""
    y_f, y_a = HT_Y1 - HT_LIP, HT_Y1 - HT_LIP - 0.25
    z_t, z_b = HT_Z0 + 0.002, HT_Z0 - 0.18
    prof = [(y_a, z_t), (y_f, z_t), (y_f - 0.05, z_b), (y_a + 0.10, z_b)]      # top, front, bottom, aft
    mats = ['paint_white', 'dark_trim', 'paint_white', 'dark_trim']
    g = Geo()
    X = 0.45
    L = [g.v(Vector((-X, y, z))) for y, z in prof]
    R = [g.v(Vector((X, y, z))) for y, z in prof]
    face_out(g, R, 'paint_white', (1, 0, 0), smooth=True)
    face_out(g, list(reversed(L)), 'paint_white', (-1, 0, 0), smooth=True)
    cen = Vector((0, sum(p[0] for p in prof) / 4, sum(p[1] for p in prof) / 4))
    for i in range(4):
        j = (i + 1) % 4
        q = [L[i], L[j], R[j], R[i]]
        c = sum((v.co for v in q), Vector()) / 4
        face_out(g, q, mats[i], Vector((0.0, c.y - cen.y, c.z - cen.z)), smooth=True)
    ob = g.to_object('visor')
    b = ob.modifiers.new('Bevel', 'BEVEL')
    b.width = 0.022; b.segments = 2; b.limit_method = 'ANGLE'
    b.angle_limit = math.radians(30); b.harden_normals = True
    # two VHF radio faces on the helm-facing panel
    g = Geo()
    ya, za = y_a + 0.10, z_b
    d = Vector((0.0, -(z_t - za), -(ya - y_a))).normalized()      # aft panel's outward normal
    u = Vector((0.0, y_a - ya, z_t - za)).normalized()           # up the panel
    for xc in (-0.20, 0.20):
        c = Vector((xc, (ya + y_a) / 2, (za + z_t) / 2)) + d * 0.004
        pts = [c + Vector((sx * 0.13, 0, 0)) + u * (sy * 0.045) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        face_out(g, pts, 'screen', d)
    rad = g.to_object('visor_radios')
    # forward-facing RESCUE on the smoked face, filling it
    tv, tf = fitted_text('RESCUE', 0.74, 0.135)
    fz0, fz1 = z_t, z_b
    fy = lambda z: y_f - 0.05 * (z_t - z) / (z_t - z_b)
    nf = Vector((0.0, z_t - z_b, -0.05)).normalized()         # forward-facing normal of the raked face
    zc = (z_t + z_b) / 2 - 0.004
    g = Geo()
    decal(g, tv, tf, lambda u_, v_: Vector((-u_, fy(zc + v_), zc + v_)) + nf * 0.005, 'paint_white')
    for f in g.bm.faces:
        f.normal_update()
        if f.normal.dot(nf) < 0:
            f.normal_flip()
    let = g.to_object('visor_lettering')
    return [ob, rad, let]


def build_ttop():
    g = Geo()
    for yb in (POST_AFT_YB, POST_FWD_YB):
        for sx in (-1, 1):
            foot = post_at(yb, sx, Z_SOLE)
            tube(g, [foot, post_at(yb, sx, FRAME_Z)], POST_R, 'metal', 8, caps=False)
            # foot plate (its underside sits on the sole and is never seen)
            revolve(g, [(0.075, 0.0), (0.066, 0.016), (0.0, 0.022)], 'metal', 8, origin=foot + Vector((0, 0, 0.002)))
    # the frame under the roof: side rails from the aft posts to a front
    # crossbar under the overhang, and an aft crossbar between the aft posts
    xa, yf = POST_X, HT_Y1 - 0.13
    tube(g, fillet([(-xa, Y_AFT_TOP, FRAME_Z), (-xa, yf, FRAME_Z), (xa, yf, FRAME_Z), (xa, Y_AFT_TOP, FRAME_Z)],
                   0.14, [3, 3]), FRAME_R, 'metal', 8, caps=False)
    tube(g, [(-xa - FRAME_R, Y_AFT_TOP, FRAME_Z), (xa + FRAME_R, Y_AFT_TOP, FRAME_Z)], FRAME_R, 'metal', 8, caps=False)
    # white retro-reflective tape round the aft posts, where the chase camera looks
    for sx in (-1, 1):
        for z in (1.02, 1.98):
            tube(g, [post_at(POST_AFT_YB, sx, z - 0.045), post_at(POST_AFT_YB, sx, z + 0.045)], POST_R + 0.004,
                 'paint_white', 8, caps=False)
    # --- on the roof
    zr = ht_z(0.0, RADAR_Y)
    revolve(g, [(0.15, 0.0), (0.15, 0.03), (0.12, 0.05), (0.0, 0.05)], 'dark_trim', 14,
            origin=(0, RADAR_Y, zr - 0.004))
    zm = ht_z(0.0, MAST_Y)
    revolve(g, [(0.045, 0.0), (0.045, 0.012), (0.0, 0.012)], 'dark_trim', 10, origin=(0.0, MAST_Y, zm - 0.004))
    tube(g, [(0.0, MAST_Y, zm), (0.0, MAST_Y, 3.13)], 0.022, 'metal', 6, caps=False)
    revolve(g, [(0.0, 0.0), (0.042, 0.0), (0.042, 0.018), (0.0, 0.018)], 'dark_trim', 10, origin=(0.0, MAST_Y, 3.12))
    revolve(g, [(0.0, 0.0), (0.042, 0.0), (0.042, 0.012), (0.02, 0.022), (0.0, 0.022)], 'dark_trim', 10,
            origin=(0.0, MAST_Y, 3.205))
    zb = ht_z(BLUE_X, BLUE_Y)
    for sx in (-1, 1):       # blue beacon bases (art3: brushed aluminium, not black)
        revolve(g, [(0.09, 0.0), (0.09, 0.05), (0.085, 0.064), (0.0, 0.064)], 'metal', 12,
                origin=(sx * BLUE_X, BLUE_Y, zb - 0.004))
    for sx in (-1, 1):       # antennas: mounts and white whips, raked aft
        base = Vector((sx * 1.02, -1.20, ht_z(1.02, -1.20) - 0.004))
        revolve(g, [(0.03, 0.0), (0.03, 0.06), (0.02, 0.10), (0.0, 0.10)], 'dark_trim', 8, origin=base)
        tip = base + Vector((0, -0.34, 2.30))
        tube(g, [base + Vector((0, 0, 0.09)), tip], 0.013, 'paint_white', 6, r_end=0.004)
    # searchlight on a yoke, front starboard corner
    sl = Vector((SEARCH[0], SEARCH[1], ht_z(*SEARCH) - 0.004))
    revolve(g, [(0.05, 0.0), (0.05, 0.05), (0.0, 0.05)], 'dark_trim', 10, origin=sl)
    revolve(g, [(0.0, -0.10), (0.05, -0.10), (0.075, 0.02), (0.08, 0.06), (0.07, 0.065), (0.0, 0.07)],
            'dark_trim', 12, origin=sl + Vector((0, 0.0, 0.14)), axis='Y')
    revolve(g, [(0.0, 0.0), (0.066, 0.0), (0.0, 0.004)], 'metal', 12, origin=sl + Vector((0, 0.072, 0.14)), axis='Y')
    # light bar base
    zl = ht_z(0.0, LB_Y)
    box_geo(g, (0.0, LB_Y, zl + 0.008), (0.94, 0.12, 0.024), 'metal')
    # nav light housings on the fore posts (outboard, facing forward)
    for sx in (-1, 1):
        p = post_at(POST_FWD_YB, sx, NAV_Z)
        box_geo(g, (p.x + sx * 0.075, p.y + 0.01, p.z), (0.06, 0.13, 0.08), 'dark_trim', False)
        box_geo(g, (p.x + sx * 0.03, p.y, p.z), (0.05, 0.05, 0.05), 'dark_trim', False)
    # lifebuoy hook: off the aft face of the starboard aft post; the ring hangs on it
    lb = post_at(POST_AFT_YB, 1, LB_HOOK_Z)
    hook = [lb, Vector((LB_C.x, LB_C.y - 0.07, LB_HOOK_Z)), Vector((LB_C.x, LB_C.y - 0.10, LB_HOOK_Z + 0.05))]
    tube(g, fillet(hook, 0.03, 2), 0.012, 'metal', 5)
    # (art3: the fender rack is gone - the fenders hung as navy 'ears' under the
    # roof edge, in the helmsman's headroom; the 125 mm D-fender does the job)
    g.merge(1e-6)
    return g.to_object('ttop')


NAV_Z = 1.95
LB_C = Vector((1.06, -1.32, 1.55))       # lifebuoy centre (ring faces aft)
LB_HOOK_Z = LB_C.z + 0.197 - 0.022       # just under the ring's inner top

HARDTOP = build_hardtop()
TTOP = build_ttop()
FASCIA_ZC, FASCIA_H = FRAME_Z - FRAME_R - 0.125, 0.25
TTOP_FASCIA = rounded_box_obj('ttop_fascia', (0, Y_AFT_TOP, FASCIA_ZC), (1.36, 0.035, FASCIA_H),
                              'paint_orange', width=0.012, segments=2, mats={3: 'paint_white'})   # white back
VISOR = build_visor()
LIGHT_BAR = rounded_box_obj('light_bar', (0.0, LB_Y, ht_z(0.0, LB_Y) + 0.020 + 0.034), (0.90, 0.09, 0.068),
                            'light_blue', width=0.028, segments=2)


def build_roof_id():
    """White helicopter roof-ID mark, 0.5 m characters, reading from astern."""
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(HARDTOP, dg)
    g = Geo()
    tv, tf = text_polys('K1', 0.70, 1.18)
    decal(g, tv, tf, lambda u, v: Vector((u, ID_Y + v, 3.0)), 'paint_white', bvh, (0, 0, -1), 0.006)
    return g.to_object('roof_id')


ROOF_ID = build_roof_id()


def build_fascia_lettering():
    """RESCUE on the aft face of the fascia, letter-spaced to fill the 1.36 m
    panel so it reads from the chase camera (art3: the forward-facing copy
    moved to the new visor under the roof's front edge)."""
    g = Geo()
    tv, tf = fitted_text('RESCUE', 1.20, 0.20)
    ya = Y_AFT_TOP - 0.0175 - 0.006          # 6 mm proud of the aft face
    decal(g, tv, tf, lambda u, v: Vector((u, ya, FASCIA_ZC - 0.004 + v)), 'paint_white')
    return g.to_object('ttop_lettering')


TTOP_LETTERS = build_fascia_lettering()


# ------------------------------------------------------ radar and lights --
def build_radar():
    g = Geo()
    prof = [(0.0, 0.0), (0.27, 0.0), (0.285, 0.01), (0.285, 0.07), (0.28, 0.085), (0.26, 0.13),
            (0.22, 0.175), (0.15, 0.21), (0.07, 0.227), (0.0, 0.23)]
    mat_fn = lambda i, j: 'dark_trim' if i < 1 else 'paint_white'
    revolve(g, prof, None, 22, mat_fn=mat_fn)
    g.merge(1e-6)
    g.sharpen(40)
    return g.to_object('radar')


def light_lens(name, prof, mat, origin, sides=12, axis='Z'):
    g = Geo()
    revolve(g, prof, mat, sides, origin=(0, 0, 0), axis=axis)
    g.merge(1e-6)
    return g.to_object(name, None, origin)


RADAR = build_radar()
RADAR.location = (0, RADAR_Y, ht_z(0.0, RADAR_Y) + 0.046)
LIGHT_MAST = light_lens('light_mast', [(0.0, 0.0), (0.034, 0.0), (0.036, 0.035), (0.034, 0.067), (0.0, 0.067)],
                        'light_white', (0.0, MAST_Y, 3.138))


def build_stern_light():
    """A white stern light on the centreline, on the aft face of the motor-well
    coaming between the cowls (joined into light_mast at export: one white
    light node)."""
    g = Geo()
    y = Y_WF - 0.002
    box_geo(g, (0.0, y - 0.018, Z_COAM - 0.07), (0.10, 0.036, 0.06), 'dark_trim')
    box_geo(g, (0.0, y - 0.041, Z_COAM - 0.07), (0.07, 0.012, 0.035), 'light_white')
    return g.to_object('light_stern')


LIGHT_STERN = build_stern_light()


def build_blue():
    """Both blue beacons in ONE node (one flasher drives them); the LED light
    bar on the roof's front edge is joined into this node at export."""
    g = Geo()
    for sx in (-1, 1):
        revolve(g, [(0.0, 0.0), (0.078, 0.0), (0.078, 0.09), (0.066, 0.14), (0.036, 0.168), (0.0, 0.174)],
                'light_blue', 12, origin=(sx * BLUE_X, 0, 0))
    g.merge(1e-6)
    return g.to_object('light_blue', None, (0.0, BLUE_Y, ht_z(BLUE_X, BLUE_Y) + 0.056))


LIGHT_BLUE = build_blue()


def nav_lens(name, sx, mat):
    p = post_at(POST_FWD_YB, sx, NAV_Z)
    c = Vector((p.x + sx * 0.108, p.y + 0.02, p.z))
    g = Geo()
    box_geo(g, (0, 0, 0), (0.012, 0.10, 0.06), mat, False)
    box_geo(g, (0, 0.056, 0), (0.05, 0.012, 0.06), mat, False)
    return g.to_object(name, None, c)


LIGHT_RED = nav_lens('light_nav_red', -1, 'light_red')
LIGHT_GREEN = nav_lens('light_nav_green', 1, 'light_green')

# ================================================================ RAILS ====
def build_rails():
    g = Geo()
    y_aft = 0.95
    # art3: stations every 0.30 m where the rail is nearly straight, 0.15 m into the bow curve
    ys = [y_aft + k * 0.30 for k in range(9)] + [3.50, 3.65, 3.80, 3.95]
    H0, H1 = 0.52, 0.58

    def h_at(y):
        return lerp(H0, H1, (y - y_aft) / (4.35 - y_aft))
    stb = [cap_top(y) + Vector((0, 0, h_at(y))) for y in ys]
    apex_y = 4.34
    apex = Vector((0.0, apex_y, z_sheer(apex_y) + 0.03 + h_at(apex_y)))
    mid1 = Vector((0.15, 4.26, lerp(stb[-1].z, apex.z, 0.6)))
    port = [Vector((-p.x, p.y, p.z)) for p in stb]
    top_path = catmull(port + [Vector((-mid1.x, mid1.y, mid1.z)), apex, mid1] + list(reversed(stb)), per=1)
    a0 = cap_top(y_aft)
    pa = Vector((-a0.x, a0.y, a0.z))
    head = fillet([pa, top_path[0], top_path[2]], 0.10, 4)[:-1]
    tail = fillet([top_path[-3], top_path[-1], a0], 0.10, 4)[1:]
    top_path = head + top_path[1:-1] + tail
    tube(g, top_path, 0.017, 'metal', 6)
    # mid rail
    ys2 = [1.60 + k * 0.30 for k in range(7)] + [3.65, 3.80, 3.95]
    stb2 = [cap_top(y) + Vector((0, 0, h_at(y) * 0.5)) for y in ys2]
    apex2 = Vector((0.0, apex_y - 0.02, z_sheer(apex_y) + 0.03 + h_at(apex_y) * 0.5))
    mid2 = Vector((0.15, 4.25, lerp(stb2[-1].z, apex2.z, 0.6)))
    path2 = catmull([Vector((-p.x, p.y, p.z)) for p in stb2] + [Vector((-mid2.x, mid2.y, mid2.z)), apex2, mid2] +
                    list(reversed(stb2)), per=1)
    tube(g, path2, 0.013, 'metal', 5)
    # stanchions with base plates
    for y in (1.60, 2.35, 3.10, 3.80):
        for sx in (-1, 1):
            b = cap_top(y); b.x *= sx
            tube(g, [b, b + Vector((0, 0, h_at(y)))], 0.014, 'metal', 5, caps=False)
            revolve(g, [(0.0, 0.0), (0.035, 0.0), (0.03, 0.012), (0.0, 0.012)], 'metal', 6, origin=b)
    fb = Vector((0.0, apex_y - 0.06, z_sheer(apex_y - 0.06) + 0.03))
    tube(g, [fb, Vector((0, apex_y, apex.z))], 0.015, 'metal', 8)
    # quarter boarding handles at the stern corners
    for sx in (-1, 1):
        x = sx * 1.05
        z0 = Z_SHEER_AFT + 0.025
        tube(g, fillet([(x, -3.60, z0), (x, -3.60, z0 + 0.30), (x, -3.20, z0 + 0.30), (x, -3.20, z0 + 0.01)], 0.08, 2),
             0.016, 'metal', 6, caps=False)
    g.merge(1e-6)
    return g.to_object('rails')


RAILS = build_rails()

# ============================================================ OUTBOARDS ====
OB_X = 0.40
OB_PIVOT_Y = -3.98
OB_PIVOT_Z = Z_WELL


def cowl_loft(yf, yr, width, z_bot, z_top_fn, n_top, n_bot, end_exp=4.0, m=24, nrows=18, taper=0.035, rear_exp=None):
    """Superellipse-section loft with rounded (domed) ends; rear_exp makes the tail boxier."""
    L = yf - yr
    ym = (yf + yr) / 2
    ys = [yr + L * (0.5 - 0.5 * math.cos(math.pi * k / (nrows - 1))) for k in range(nrows)]
    rows = []
    for y in ys:
        s_ = (y - ym) / (L / 2)
        ex = end_exp if (s_ >= 0 or rear_exp is None) else rear_exp
        e = max(0.0, 1 - abs(s_) ** ex) ** (1 / ex)
        a = e * (width - taper * max(0.0, -s_))
        z_top = z_top_fn(y)
        h = (z_top - z_bot) / 2
        zc = (z_top + z_bot) / 2
        rows.append(superellipse_ring(0.0, zc, max(a, 0.0005), max(h * e, 0.0005), max(h * e, 0.0005),
                                      n_top, n_bot, y, m))
    return rows


def upper_cowl_top(y):
    # nose 0.72, crown 0.88 just aft of the pivot, sloping to 0.74 at the tail
    if y > -0.05:
        return 0.88 - 0.16 * ((y + 0.05) / 0.32) ** 2
    return 0.88 - 0.14 * ((-0.05 - y) / 0.62) ** 1.6


def foil_ring(y_le, chord, t, z, m=12):
    xs = [0.0, 0.03, 0.12, 0.30, 0.55, 0.80, 1.0]
    top, bot = [], []
    for x in xs:
        ht = t / 2 * (math.sqrt(x) * (1 - x) ** 0.55) / 0.55 if 0 < x < 1 else 0.0
        top.append(Vector((ht, y_le - x * chord, z)))
        bot.append(Vector((-ht, y_le - x * chord, z)))
    ring = top + list(reversed(bot[1:-1]))
    return ring


COWL_BAND = (0.395, 0.470)
# midsection, anti-ventilation plate, gearcase and skeg: gunmetal grey (the
# deck_nonskid grey, linear ~0.15) instead of near-black - from the chase camera
# the legs no longer read as black blocks under the white cowls
LEG = 'deck_nonskid'


def build_outboard(side):
    sx = 1 if side == 'r' else -1
    g = Geo()
    # upper cowl: flat-topped superellipse loft, white pinstripe cut in above the parting line
    rows = cowl_loft(0.27, -0.68, 0.282, 0.30, upper_cowl_top, 3.8, 6.0, end_exp=3.0, m=24, nrows=20,
                     rear_exp=5.5)
    cg = Geo()
    cg.grid(rows, 'dark_trim', smooth=True, closed=True, flip=False)
    cg.merge(1e-6)
    cbvh = BVHTree.FromBMesh(cg.bm)
    cg.bm.free()
    g.grid(rows, 'dark_trim', smooth=True, closed=True, flip=False)   # outward: +y rows x ccw ring
    g.merge(1e-6)
    bm = g.bm
    # white upper cowl with a 75 mm orange band at the parting line (its lowest
    # few mm tuck under the lower cowl's lip, so no white sliver shows)
    for zc in (COWL_BAND[0], COWL_BAND[1]):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6,
                               plane_co=(0, 0, zc), plane_no=(0, 0, 1))
    for f in bm.faces:
        c = f.calc_center_median()
        f.material_index = g.mi('paint_orange' if COWL_BAND[0] < c.z < COWL_BAND[1] else 'paint_white')
    # lower cowl (chaps): horizontal rings that follow the upper cowl's outline at the
    # parting line, 2 cm proud, so the joint is a clean step rather than an intersection
    yc = -0.20
    outline = []
    NA = 24
    for k in range(NA):
        a = 2 * math.pi * k / NA
        d = Vector((math.cos(a), math.sin(a), 0))
        hit = cbvh.ray_cast(Vector((0, yc, 0.40)), d, 2.0)
        outline.append((hit[0] - Vector((0, yc, 0.40))).length if hit[0] else 0.2)
    def ring(z, off, shrink=1.0):
        return [Vector((0, yc, z)) + Vector((math.cos(2 * math.pi * k / NA), math.sin(2 * math.pi * k / NA), 0)) *
                (outline[k] * shrink + off) for k in range(NA)]
    # art3: the lower cowl is white too (it read as a black block from the chase
    # camera); only its lip, the parting-line gasket just under the orange band,
    # stays dark
    lrows = [ring(0.10, -0.03, 0.97), ring(0.125, 0.0), ring(0.17, 0.018), ring(0.30, 0.022), ring(0.375, 0.022),
             ring(0.398, 0.016), ring(0.404, -0.006)]
    lv = g.grid(lrows, lambda i, j: 'dark_trim' if i == 4 else 'paint_white', smooth=True, closed=True, flip=True)
    g.fan_cap(list(reversed(lv[0])), Vector((0, yc, 0.10)), 'paint_white')
    # midsection (driveshaft housing)
    mids = []
    for k in range(7):
        t = k / 6
        z = lerp(0.14, -SHAFT, t)
        mids.append(foil_ring(lerp(0.07, -0.01, t), lerp(0.50, 0.38, t), lerp(0.13, 0.085, t), z))
    g.grid(mids, LEG, smooth=True, closed=True, flip=True)
    # anti-ventilation plate
    outline = []
    for k in range(17):
        a = math.pi * k / 16
        outline.append(Vector((0.19 * math.sin(a) ** 0.7 * (1 if k <= 16 else 1), 0.0, 0)))
    plan = []
    for k in range(12):
        t = k / 11
        y = lerp(0.02, -0.64, t)
        w = 0.19 * math.sin(math.pi * lerp(0.12, 0.98, t)) ** 0.45
        plan.append((w, y))
    ring_top = [Vector((w, y, -SHAFT + 0.012)) for w, y in plan] + [Vector((-w, y, -SHAFT + 0.012)) for w, y in reversed(plan)]
    ring_bot = [Vector((p.x, p.y, -SHAFT - 0.013)) for p in ring_top]
    vt = [g.v(p) for p in ring_top]
    vb = [g.v(p) for p in ring_bot]
    g.face(list(reversed(vt)), LEG, False)
    g.face(vb, LEG, False)
    n = len(vt)
    for j in range(n):
        j2 = (j + 1) % n
        g.face([vt[j], vt[j2], vb[j2], vb[j]], LEG, True)
    # lower strut into the gearcase
    struts = [foil_ring(lerp(0.0, -0.02, t), lerp(0.36, 0.34, t), 0.07, lerp(-SHAFT, -SHAFT - 0.16, t)) for t in (0, 1)]
    g.grid(struts, LEG, smooth=True, closed=True, flip=True)
    # gearcase torpedo (revolved along Y)
    prof = [(0.0, 0.035), (0.045, 0.02), (0.068, -0.01), (0.082, -0.06), (0.086, -0.14),
            (0.080, -0.28), (0.070, -0.40), (0.063, -0.47)]
    rg = revolve(g, prof, LEG, 12, origin=(0, 0, -SHAFT - 0.19), axis='Y')
    face_out(g, rg[-1], LEG, (0, -1, 0))                  # tail cone cap faces aft
    # skeg
    skeg = [foil_ring(lerp(-0.06, -0.20, t), lerp(0.26, 0.10, t), lerp(0.030, 0.014, t), lerp(-SHAFT - 0.24, -SHAFT - 0.42, t), 10)
            for t in (0, 0.5, 1)]
    g.grid(skeg, LEG, smooth=True, closed=True, flip=True)
    # swivel/steering tube and steering arm
    revolve(g, [(0.0, -0.36), (0.055, -0.36), (0.055, 0.10), (0.0, 0.10)], LEG, 12, origin=(0, 0.02, 0))
    tube(g, [(0.0, 0.06, 0.07), (0.0, 0.19, 0.07)], 0.02, LEG, 8)
    # vent grille and side graphics on the cowl
    g.merge(1e-6)
    g.sharpen(50)
    ob = g.to_object('outboard_' + side)
    ob.location = (sx * OB_X, OB_PIVOT_Y, OB_PIVOT_Z)
    return ob


def rrect2d(w, h, r, n=4):
    """Rounded rectangle as a centre fan: (verts2d, faces)."""
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180),
                       (w / 2 - r, -h / 2 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append(Vector((cx + r * math.cos(a), cy + r * math.sin(a), 0)))
    vs = [Vector((0, 0, 0))] + pts
    fs = [[0, i + 1, (i + 1) % len(pts) + 1] for i in range(len(pts))]
    return vs, fs


def rrect_grid(w, h, r, nu, nv):
    """A w x h grid whose four outer corners are pulled onto radius-r arcs."""
    vs, fs = grid2d(w, h, nu, nv)
    for p in vs:
        cx = math.copysign(w / 2 - r, p.x); cy = math.copysign(h / 2 - r, p.y)
        if abs(p.x) > w / 2 - r and abs(p.y) > h / 2 - r:
            d = Vector((p.x - cx, p.y - cy, 0))
            if d.length > r:
                d = d.normalized() * r
                p.x, p.y = cx + d.x, cy + d.y
    return vs, fs


def build_cowl_graphics(ob, side):
    """Dark air-intake panel on the aft slope and an orange accent on each flank,
    snapped onto the cowl surface."""
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(ob, dg)
    g = Geo()
    nrm = Vector((0, -0.62, 0.78)).normalized()
    up = nrm.cross(Vector((1, 0, 0))).normalized()
    if up.z < 0:
        up = -up
    c0 = Vector((0.0, -0.44, 0.80))
    vs, fs = rrect_grid(0.34, 0.15, 0.04, 8, 3)       # tessellated so it hugs the curved cowl
    decal(g, vs, fs, lambda u, v: c0 + Vector((u, 0, 0)) + up * v + nrm * 0.3, LEG, bvh, -nrm, 0.006)
    for k in range(3):   # slats
        vs2, fs2 = grid2d(0.28, 0.016, 8, 1)
        decal(g, vs2, fs2, lambda u, v, k=k: c0 + Vector((u, 0, 0)) + up * (v + (k - 1) * 0.042) + nrm * 0.3,
              'metal', bvh, -nrm, 0.009)
    # the boat's ID in navy on the aft face, reading from astern (the chase camera)
    tv, tf = text_polys('K1', 0.15, 1.15, subdiv=False, res=2)
    decal(g, tv, tf, lambda u, v: Vector((u, -1.0, 0.585 + v)), 'paint_navy', bvh, (0, 1, 0), 0.006)
    gob = g.to_object('outboard_graphics_' + side)
    gob.parent = ob
    return gob


def build_prop(side, parent):
    sx = 1 if side == 'r' else -1
    hand = 1 if side == 'r' else -1       # starboard right-hand, port left-hand (counter-rotating)
    g = Geo()
    # hub with a proper tail cone
    # (lightened in art2 to 132 triangles: it lives under the sea at chase range)
    revolve(g, [(0.0, 0.035), (0.058, 0.02), (0.056, -0.09), (0.030, -0.17), (0.0, -0.205)],
            'metal', 8, origin=(0, 0, 0), axis='Y')
    P = 0.46
    radii = [0.045, 0.110, 0.165, 0.192]
    chords = [0.10, 0.145, 0.115, 0.035]
    thick = [0.014, 0.009, 0.005, 0.003]
    skew = [0.0, 0.10, 0.27, 0.37]
    XS = (0.40,)                          # one mid-chord station each side (a lens section)
    TH = (1.00,)
    for b in range(3):
        rows = []
        for r, c, t, sk in zip(radii, chords, thick, skew):
            psi = 2 * math.pi * b / 3 + sk * hand
            radial = Vector((math.cos(psi), 0, math.sin(psi)))
            e_t = Vector((-math.sin(psi), 0, math.cos(psi))) * hand
            e_a = Vector((0, -1, 0))
            phi = math.atan(P / (2 * math.pi * r))
            cd = (e_t * math.cos(phi) + e_a * math.sin(phi)).normalized()
            nn = radial.cross(cd).normalized()
            back = -nn if nn.y < 0 else nn                    # the forward-facing (suction) side
            ctr = radial * r + Vector((0, -0.03 - 0.10 * (r - 0.045), 0))
            le, te = ctr - cd * (c / 2), ctr + cd * (c / 2)   # the leading edge leads in rotation
            pt = lambda x: le + cd * (x * c) + back * (0.12 * c * x * (1 - x))
            up = [pt(x) + nn * (t / 2 * th) for x, th in zip(XS, TH)]
            dn = [pt(x) - nn * (t / 2 * th) for x, th in zip(XS, TH)]
            rows.append([te] + up[::-1] + [le] + dn)
        vg = g.grid(rows, 'metal', smooth=True, closed=True, flip=True)
        # the leading and trailing edges are creases: each face of the blade
        # shades as its own smooth surface (a 4-point section otherwise puffs up)
        for k in range(len(vg) - 1):
            for j in (0, 2):
                e = g.bm.edges.get((vg[k][j], vg[k + 1][j]))
                if e:
                    e.smooth = False
        for ring, sgn in ((vg[-1], 1), (vg[0], -1)):             # cap tip and root
            rc = sum((v.co for v in ring), Vector()) / len(ring)
            face_out(g, ring, 'metal', (rc - Vector((0, rc.y, 0))) * sgn)
    g.merge(1e-6)
    triangulate_unfolded(g.bm, [f for f in g.bm.faces if len(f.verts) == 4])
    ob = g.to_object('prop_' + side)
    ob.parent = parent
    ob.location = (0.0, -0.50, -SHAFT - 0.19)   # hub, relative to the steering pivot
    return ob


OUTBOARDS = {}
for _side in ('l', 'r'):
    _ob = build_outboard(_side)
    OUTBOARDS[_side] = (_ob, build_cowl_graphics(_ob, _side), build_prop(_side, _ob))


def build_brackets():
    """Transom clamp brackets (fixed) and the tilt tube, in the motor well."""
    g = Geo()
    for sx in (-1, 1):
        x0 = sx * OB_X
        for dx in (-0.12, 0.12):
            xx = x0 + dx
            prof_pts = [Vector((xx, y_tr(Z_WELL) + 0.10, Z_WELL + 0.03)), Vector((xx, OB_PIVOT_Y + 0.07, Z_WELL + 0.075)),
                        Vector((xx, OB_PIVOT_Y + 0.07, Z_WELL - 0.30)), Vector((xx, y_tr(Z_WELL - 0.34) - 0.005, Z_WELL - 0.34))]
            # extrude the side plate
            a = [g.v(p + Vector((-0.015, 0, 0))) for p in prof_pts]
            b = [g.v(p + Vector((0.015, 0, 0))) for p in prof_pts]
            g.face(list(reversed(a)), LEG, False)
            g.face(b, LEG, False)
            n = len(a)
            for j in range(n):
                j2 = (j + 1) % n
                g.face([a[j], a[j2], b[j2], b[j]], LEG, False)
        tube(g, [(x0 - 0.16, OB_PIVOT_Y + 0.09, Z_WELL + 0.045), (x0 + 0.16, OB_PIVOT_Y + 0.09, Z_WELL + 0.045)],
             0.025, 'metal', 10)
        # hydraulic trim ram
        tube(g, [(x0, y_tr(Z_WELL - 0.30) - 0.01, Z_WELL - 0.30), (x0, OB_PIVOT_Y + 0.10, Z_WELL - 0.10)], 0.03, 'metal', 10)
    return g.to_object('outboard_brackets')


BRACKETS = build_brackets()


def flat_bar(g, path, w, d, mat):
    """Sweep a w (across, along X) by d (in the path's plane) rectangle along a
    path in the YZ plane: a flat steel bar such as an anchor shank."""
    path = [Vector(p) for p in path]
    n = len(path)
    rows = []
    for i in range(n):
        t = (path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized()
        dn = Vector((0.0, -t.z, t.y))
        p = path[i]
        rows.append([p + Vector((-w / 2, 0, 0)) - dn * (d / 2), p + Vector((w / 2, 0, 0)) - dn * (d / 2),
                     p + Vector((w / 2, 0, 0)) + dn * (d / 2), p + Vector((-w / 2, 0, 0)) + dn * (d / 2)])
    vg = g.grid(rows, mat, smooth=False, closed=True)
    c0 = sum((v.co for v in vg[0]), Vector()) / 4
    c1 = sum((v.co for v in vg[-1]), Vector()) / 4
    face_out(g, vg[0], mat, c0 - path[1])
    face_out(g, vg[-1], mat, c1 - path[-2])
    return vg


# art3: galvanised steel, dark (a pale fluke read as a beak ahead of the stem)
ANCHOR_MAT = 'dark_trim'


def build_anchor(yb, zb):
    """A stowed Delta (plough) anchor, under 120 triangles. The flat-bar shank
    rests on the roller bracket, runs forward over the roller and turns down
    round it to the crown; the V-section fluke (two faces meeting on a ridge,
    0.30 x 0.22 m, pointed tip) hangs in front of the stem head with its tip
    tucked back toward the stem, clear of the D-fender."""
    g = Geo()
    R0 = Vector((0.0, yb + 0.60, zb + 0.06))          # roller centre (radius 0.035)
    z_top = zb + 0.055                                  # bracket top
    rs = 0.035 + 0.027                                  # shank centreline round the roller
    C = Vector((0.0, R0.y + rs + 0.001, R0.z - 0.050))  # crown
    shank = [Vector((0.0, yb + 0.24, z_top + 0.025)), Vector((0.0, yb + 0.48, z_top + 0.034)),
             R0 + Vector((0, 0.0, rs)), R0 + Vector((0, rs * 0.72, rs * 0.72)), R0 + Vector((0, rs, 0.0)), C]
    flat_bar(g, shank, 0.018, 0.052, ANCHOR_MAT)
    # the fluke: from the crown down and aft, its tip 45 mm off the stem
    zt = C.z - 0.215
    T = Vector((0.0, stem(stem_t_for_z(zt)).x + 0.045, zt))
    u = (T - C).normalized()
    L = (T - C).length
    xw = Vector((1.0, 0.0, 0.0))
    nf = u.cross(xw).normalized()                       # fluke normal
    if nf.y < 0:
        nf = -nf                                        # ... pointing forward, away from the stem
    ridge = C + nf * 0.05                               # the V's ridge stands forward of the wings
    CL, CR = C - xw * 0.11, C + xw * 0.11
    back = -nf * 0.012
    front = [(CL, ridge, T), (ridge, CR, T)]
    rear = [(CR + back, ridge + back, T + back), (ridge + back, CL + back, T + back)]
    cen = (CL + CR + T + ridge) / 4 + back * 0.5
    for tri in front + rear:
        f = g.poly(list(tri), ANCHOR_MAT, False)
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - cen) < 0:
            f.normal_flip()
    for a_, b_ in ((CL, T), (T, CR), (CR, ridge), (ridge, CL)):
        f = g.poly([a_, b_, b_ + back, a_ + back], ANCHOR_MAT, False)
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - cen) < 0:
            f.normal_flip()
    # chain from the shank's tail back into the chain pipe
    tube(g, [shank[0] + Vector((0, -0.01, -0.01)), Vector((0, yb - 0.05, z_top + 0.010)),
             Vector((0, yb - 0.12, zb + 0.02))], 0.009, 'dark_trim', 4, caps=False)
    revolve(g, [(0.05, 0.0), (0.05, 0.03), (0.0, 0.03)], 'metal', 8, origin=(0, yb - 0.12, zb - 0.01))
    # how far the fluke stands off the stem, sampled down its back face
    worst = 0.0
    for k in range(11):
        p = C.lerp(T, k / 10) + back
        if p.z < ZH:
            worst = max(worst, p.y - stem(stem_t_for_z(p.z)).x)
    print('ANCHOR fluke %.2f m, tip %.3f m off the stem, max stand-off from the stem line %.3f m, crown %.3f m '
          'ahead of the D-fender' % (L, T.y - stem(stem_t_for_z(T.z)).x, worst, (C + back).y - (YH + 0.078)))
    g.merge(1e-6)
    return g.to_object('anchor')


# ================================================================== KIT ====
HATCH = (0.0, -2.62, 0.70, 0.56)          # aft cockpit sole hatch: centre x, y and size


def build_kit():
    parts = []
    g = Geo()
    # --- liferaft canister in its cradle (starboard aft deck)
    lr_c = Vector((0.66, -2.95, Z_SOLE + 0.34))
    prof = [(0.0, -0.36), (0.15, -0.35), (0.205, -0.31), (0.22, -0.22), (0.22, 0.22), (0.205, 0.31),
            (0.15, 0.35), (0.0, 0.36)]
    revolve(g, prof, 'paint_white', 16, origin=lr_c, axis='Y')
    for yy in (-0.17, 0.17):     # straps
        ring = [lr_c + Vector((math.cos(a) * 0.228, yy, math.sin(a) * 0.228)) for a in [2 * math.pi * k / 10 for k in range(11)]]
        tube(g, ring, 0.012, 'paint_navy', 4, caps=False)
    for yy in (-0.24, 0.24):     # cradle saddles
        tube(g, fillet([lr_c + Vector((-0.25, yy, -0.34)), lr_c + Vector((-0.25, yy, -0.05)),
                        lr_c + Vector((-0.20, yy, -0.20)), lr_c + Vector((0.0, yy, -0.245)),
                        lr_c + Vector((0.20, yy, -0.20)), lr_c + Vector((0.25, yy, -0.05)),
                        lr_c + Vector((0.25, yy, -0.34))], 0.05, 1), 0.015, 'metal', 4, caps=False)
    # --- coiled line on the port aft deck
    cl = Vector((-0.62, -2.98, Z_SOLE + 0.014))
    spiral = []
    turns, per = 2.6, 8
    for k in range(int(turns * per) + 1):
        a = 2 * math.pi * k / per
        r = 0.085 + 0.12 * k / (turns * per)
        spiral.append(cl + Vector((math.cos(a) * r, math.sin(a) * r, 0.012 * math.sin(a * 0.5) ** 2)))
    end = spiral[-1]
    spiral += [end + Vector((0.05, -0.12, 0.0)), Vector((-0.86, -3.36, Z_SOLE + 0.02))]
    tube(g, spiral, 0.015, 'paint_navy', 4)
    # --- cleats: stern (quarters), midship, bow
    def cleat(p, d):
        d = Vector(d).normalized()
        up = Vector((0, 0, 1))
        for s in (-0.045, 0.045):
            revolve(g, [(0.02, 0.0), (0.016, 0.035), (0.0, 0.035)], 'metal', 4, origin=p + d * s)
        tube(g, [p + d * -0.11 + up * 0.038, p + d * -0.06 + up * 0.048, p + d * 0.06 + up * 0.048,
                 p + d * 0.11 + up * 0.038], 0.014, 'metal', 4, r_end=0.009)
    for sx in (-1, 1):
        q = Vector((sx * 1.05, -3.52, Z_SHEER_AFT + 0.025))
        cleat(q, (0, 1, 0))
        for y in (0.20, 3.40):
            p = cap_top(y); p.x *= sx
            cleat(p, (sx * sheer_slope(y) * 0, 1, 0))
    # --- fairleads: closed chocks standing on the cap's outer edge
    def fairlead(y, sx, along=None):
        p = cap_top(y, inset=0.035); p.x *= sx
        m = sheer_slope(y) * sx
        t = Vector((m, 1.0, 0.0)).normalized() if along is None else Vector(along).normalized()
        pts = []
        for k in range(7):
            a = 2 * math.pi * k / 6 + math.pi / 6
            pts.append(p + t * (math.cos(a) * 0.065) + Vector((0, 0, 0.040 + math.sin(a) * 0.036)))
        tube(g, pts, 0.012, 'metal', 4, caps=False)
    for sx in (-1, 1):
        fairlead(3.72, sx)
        fairlead(-3.35, sx)
    # --- bow roller, anchor and chain pipe (art3: the roller sits 4 cm further
    # aft in its stem-head fitting, so the anchor's crown is under 30 mm proud
    # of the D-fender)
    yb = 4.06
    zb = z_sheer(yb) + 0.03
    box_geo(g, (0, yb + 0.30, zb + 0.03), (0.11, 0.66, 0.05), 'metal', False)
    revolve(g, [(0.0, -0.05), (0.035, -0.05), (0.035, 0.05), (0.0, 0.05)], 'dark_trim', 10,
            origin=(0, yb + 0.60, zb + 0.06), axis='X')
    # the anchor is its own part (build_anchor), joined into the deck at export
    parts.append(build_anchor(yb, zb))
    # --- sole hatch seams (aft cockpit) and drains
    def seam_rect(cx, cy, w, h, z, t=0.018):
        for (x0, y0, x1, y1) in ((cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2 + t),
                                 (cx - w / 2, cy + h / 2 - t, cx + w / 2, cy + h / 2),
                                 (cx - w / 2, cy - h / 2 + t, cx - w / 2 + t, cy + h / 2 - t),
                                 (cx + w / 2 - t, cy - h / 2 + t, cx + w / 2, cy + h / 2 - t)):
            g.poly([Vector((x0, y0, z)), Vector((x1, y0, z)), Vector((x1, y1, z)), Vector((x0, y1, z))], 'dark_trim')
    seam_rect(HATCH[0], HATCH[1], HATCH[2], HATCH[3], Z_SOLE + 0.006)
    # scupper grates in the aft corners of the cockpit, in the wide aft gutter:
    # a dark drain with three stainless bars across it
    for sx in (-1, 1):
        xc, yc_ = sx * 0.88, Y_AB + 0.05
        g.poly([Vector((xc - 0.10, yc_ - 0.03, Z_SOLE + 0.004)), Vector((xc + 0.10, yc_ - 0.03, Z_SOLE + 0.004)),
                Vector((xc + 0.10, yc_ + 0.03, Z_SOLE + 0.004)), Vector((xc - 0.10, yc_ + 0.03, Z_SOLE + 0.004))], 'dark_trim')
        for dy in (-0.017, 0.0, 0.017):
            box_geo(g, (xc, yc_ + dy, Z_SOLE + 0.007), (0.19, 0.007, 0.005), 'metal')
    # drain slot along the forward edge of the motor-well board
    zw = Z_WELL + 0.004
    g.poly([Vector((-0.26, Y_WF - 0.075, zw)), Vector((0.26, Y_WF - 0.075, zw)),
            Vector((0.26, Y_WF - 0.04, zw)), Vector((-0.26, Y_WF - 0.04, zw))], 'dark_trim')
    # --- boarding ladder folded on the starboard platform
    for dx in (-0.11, 0.11):
        tube(g, fillet([(1.08 + dx, -3.84, 0.295), (1.08 + dx, -4.22, 0.295), (1.08 + dx, -4.26, 0.35)], 0.03, 2),
             0.013, 'metal', 5)
    for yy in (-3.96, -4.08, -4.20):
        tube(g, [(0.97, yy, 0.31), (1.19, yy, 0.31)], 0.012, 'metal', 4, caps=False)
    g.merge(1e-6)
    parts.append(g.to_object('kit'))

    # --- lifebuoy (orange with four white bands) on the starboard aft post
    g = Geo()
    c = LB_C.copy()
    R_, r_ = 0.255, 0.058
    rows = []
    NU, NV = 16, 6
    for i in range(NU + 1):
        a = 2 * math.pi * i / NU
        ring = []
        for j in range(NV):
            b = 2 * math.pi * j / NV
            rr = R_ + r_ * math.cos(b)
            ring.append(c + Vector((math.cos(a) * rr, r_ * math.sin(b), math.sin(a) * rr)))
        rows.append(ring)
    band = lambda i, j: 'paint_white' if i % 4 == 0 else 'paint_orange'
    g.grid(rows, band, smooth=True, closed=True, flip=True)
    # grab line: four loops
    for k in range(4):
        a0 = 2 * math.pi * k / 4 + 0.35
        pts = []
        for s in range(4):
            a = a0 + 0.5 * s / 3
            rr = R_ + r_ + 0.012 + 0.03 * math.sin(math.pi * s / 3)
            pts.append(c + Vector((math.cos(a) * rr, 0.0, math.sin(a) * rr)))
        tube(g, pts, 0.007, 'paint_white', 3, caps=False)
    g.merge(1e-6)
    parts.append(g.to_object('lifebuoy'))

    # --- stretcher (basket) strapped on the foredeck well floor
    g = Geo()
    y0, y1 = 1.95, 3.72
    secs = []
    N = 12
    for k in range(N + 1):
        t = k / N
        y = lerp(y0, y1, t)
        w = lerp(0.58, 0.40, ss(t)) * (0.94 + 0.06 * math.sin(math.pi * min(1, t * 1.3)))
        d = 0.17 - 0.02 * t
        zb = z_fd(y) + 0.012
        secs.append([Vector((-w / 2, y, zb + d)), Vector((-w / 2 + 0.015, y, zb + 0.05)), Vector((-w / 2 + 0.07, y, zb)),
                     Vector((w / 2 - 0.07, y, zb)), Vector((w / 2 - 0.015, y, zb + 0.05)), Vector((w / 2, y, zb + d))])
    g.grid(secs, 'paint_orange', smooth=True, flip=False)       # outside of the basket
    inner = [[p + Vector((0.012 if p.x < 0 else -0.012, 0, 0.012)) for p in s] for s in secs]
    g.grid(inner, 'paint_orange', smooth=True, flip=True)        # inside of the basket
    for s, d in ((0, -1), (N, 1)):
        face_out(g, secs[s] + list(reversed(inner[s])), 'paint_orange', (0, d, 0))
    for j in (0, -1):                                   # lips closing the shells along the rims
        for k in range(N):
            face_out(g, [secs[k][j], secs[k + 1][j], inner[k + 1][j], inner[k][j]], 'paint_orange', (0, 0, 1))
    rim_l = [s[0] for s in secs]; rim_r = [s[-1] for s in secs]
    tube(g, [rim_l[0] + Vector((0.0, -0.01, 0))] + rim_l + list(reversed(rim_r)) + [rim_r[0] + Vector((0, -0.01, 0))],
         0.014, 'metal', 4, caps=False)
    tube(g, [rim_l[0], rim_r[0]], 0.014, 'metal', 5)
    tube(g, [rim_l[-1], rim_r[-1]], 0.014, 'metal', 5)
    for t in (0.22, 0.52, 0.80):   # securing straps
        k = int(round(t * N))
        s = secs[k]
        yy = s[0].y
        strap = [Vector((-0.40 * (1 - 0.3 * t), yy, z_fd(yy) + 0.005)), s[0] + Vector((0, 0, 0.018)),
                 s[-1] + Vector((0, 0, 0.018)), Vector((0.40 * (1 - 0.3 * t), yy, z_fd(yy) + 0.005))]
        tube(g, strap, 0.012, 'paint_navy', 4, caps=False)
    g.merge(1e-6)
    parts.append(g.to_object('stretcher'))
    return parts


KIT = build_kit()


def closed_fillet(pts, r, n=2):
    """Round every corner of a closed polygon."""
    m = len(pts)
    ext = [pts[-1]] + list(pts) + [pts[0]]
    out = fillet(ext, r, n)
    return out[1:-1]


def rrect_loop(cx, cy, w, h, r, n=3):
    return closed_fillet([Vector((cx + w / 2, cy - h / 2, 0)), Vector((cx + w / 2, cy + h / 2, 0)),
                          Vector((cx - w / 2, cy + h / 2, 0)), Vector((cx - w / 2, cy - h / 2, 0))], r, n)


def build_nonskid():
    """Inset non-skid panels on the white soles, with 70 mm smooth gutters
    round the bulwarks, the plinths and the hatch (100 mm across the aft end,
    where the scuppers are): the boat's panel seams, B-2 style."""
    g = Geo()
    G = 0.07
    z = Z_SOLE + 0.005

    def side_edge(y0, y1, key, step=0.25):
        n = max(2, int(math.ceil((y1 - y0) / step)) + 1)
        return [(lerp(y0, y1, k / (n - 1)), sole_x(lerp(y0, y1, k / (n - 1)), key) - G) for k in range(n)]

    def fill(loops):
        bm = g.bm
        vs_all = []
        edges = []
        for loop in loops:
            vs = [g.v(Vector((p.x, p.y, z))) for p in loop]
            vs_all += vs
            for i in range(len(vs)):
                edges.append(bm.edges.new((vs[i], vs[(i + 1) % len(vs)])))
        res = bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges, normal=(0, 0, 1))
        for f in res['geom']:
            if isinstance(f, bmesh.types.BMFace):
                f.material_index = g.mi('deck_nonskid')
                f.smooth = False
                f.normal_update()
                if f.normal.z < 0:
                    f.normal_flip()

    def panel(y0, y1, key, x_in=None):
        e = side_edge(y0, y1, key)
        stb = [Vector((x, y, 0)) for y, x in e]
        if x_in is None:
            poly = stb + [Vector((-p.x, p.y, 0)) for p in reversed(stb)]
        else:
            poly = stb + [Vector((x_in, y1, 0)), Vector((x_in, y0, 0))]
        return closed_fillet(poly, 0.05, 2)

    # aft cockpit, with the hatch cut out of it
    hx, hy, hw, hh = HATCH
    y_a1 = SEAT_ROWS[1] - 0.22 - G
    fill([panel(Y_AB + 0.10, y_a1, 'B'), rrect_loop(hx, hy, hw + 0.10, hh + 0.10, 0.05)[::-1]])
    fill([rrect_loop(hx, hy, hw - 0.08, hh - 0.08, 0.03)])                       # the hatch lid
    # side decks along the seats and console
    for sx in (-1, 1):
        loop = panel(y_a1 + G, Y_STEP - G, 'B', x_in=CON_X - 0.025 + G)
        if sx < 0:
            loop = [Vector((-p.x, p.y, 0)) for p in reversed(loop)]
        fill([loop])
    # between the seat rows, and the helm footwell
    for y0, y1 in ((SEAT_ROWS[1] + 0.22 + G, SEAT_ROWS[0] - 0.22 - G), (SEAT_ROWS[0] + 0.22 + G, Y_CA + 0.03 - G)):
        fill([rrect_loop(0.0, (y0 + y1) / 2, 2 * (CON_X - 0.025), y1 - y0, 0.04)])
    # foredeck well: its floor climbs with the sheer, so this panel is a strip of
    # quads between stations that follows it (a triangle fan would float off it)
    y0, y1 = Y_STEP + G, Y_BW - G
    n = max(3, int(math.ceil((y1 - y0) / 0.15)) + 1)
    rows = []
    for k in range(n):
        y = lerp(y0, y1, k / (n - 1))
        x = sole_x(y, 'C') - G - (0.04 if k in (0, n - 1) else 0.0)     # chamfered corners
        rows.append([Vector((-x, y, z_fd(y) + 0.005)), Vector((x, y, z_fd(y) + 0.005))])
    g.grid(rows, 'deck_nonskid', smooth=False, flip=True)
    return g.to_object('nonskid')


NONSKID = build_nonskid()


def build_tow_post():
    """A stainless tow post (bitt) on the aft centreline, forward of the
    liferaft: rescue boats tow all day."""
    g = Geo()
    y = -2.10
    revolve(g, [(0.0, 0.0), (0.105, 0.0), (0.10, 0.012), (0.075, 0.028), (0.058, 0.04), (0.0, 0.04)], 'metal', 10,
            origin=(0.0, y, Z_SOLE + 0.004))
    revolve(g, [(0.055, 0.04), (0.055, 0.58), (0.064, 0.60), (0.064, 0.625), (0.045, 0.65), (0.0, 0.66)], 'metal', 10,
            origin=(0.0, y, Z_SOLE + 0.004))
    tube(g, [(-0.19, y, Z_SOLE + 0.48), (0.19, y, Z_SOLE + 0.48)], 0.022, 'metal', 8)
    g.merge(1e-6)
    return g.to_object('tow_post')


TOW_POST = build_tow_post()


# ============================================================ HYDROSTATICS ==
def hydrostatics(dz=0.01, dy=0.02):
    """Waterplane centroid (LCF), displaced volume and LCB at the design WL."""
    def stem_y(z):
        return stem(stem_t_for_z(z)).x if z > ZF else YF
    vol = 0.0; mom = 0.0
    a_wp = 0.0; m_wp = 0.0
    z = ZK + dz / 2
    while z < 0.0:
        y = y_tr(z) + dy / 2
        ymax = stem_y(z)
        while y < ymax:
            if z > z_keel(y):
                x = hull_x(y, z)
                if x:
                    vol += 2 * x * dy * dz; mom += 2 * x * dy * dz * y
            y += dy
        z += dz
    y = y_tr(0.0) + dy / 2
    while y < stem_y(0.0):
        x = hull_x(y, -0.001)
        if x:
            a_wp += 2 * x * dy; m_wp += 2 * x * dy * y
        y += dy
    return dict(volume=vol, lcb=mom / vol, lcf=m_wp / a_wp, awp=a_wp)


HYD = hydrostatics()
# The origin is on the design waterline at the centre of flotation, so the
# game's v.pos (the chase camera's target and the depth probe) is mid-boat.
#
# The game's sea is a flat plane at y = 0 with a translucent swell layer at
# +0.08 (water.js), and the boat heaves and pitches against it: heave down to
# -1.45 x (0.1 + 0.75 sea), sea pitch +/-(0.02 + 0.12 sea), sea roll
# +/-(0.01 + 0.2 sea), with sea never below 0.066 and 0.137 by default
# (surface.js seaStateFrom, seaMotion). A hull that follows all of that into a
# flat plane looks as if she is sinking, and the sea shows inside the cockpit.
# So the model rides a fraction of the sea's motion (the camera still rides
# the whole of it), and a planing lift carries her up onto the plane:
#   y      = SEA_SCALE * v.pos.y + PLANING_LIFT * f,          f = clamp(|speed| / 14, 0, 1)
#   pitch  = trim + SEA_SCALE * (game pitch - trim),          trim = 0.14 f (lerped as the game does)
#   bank   = lean + SEA_SCALE * (game bank - lean),           lean = -steer 0.42 clamp(|speed| / 8, 0, 1)
# kestrel_launch.js does exactly this in userData.update.
ORIGIN_Y = HYD['lcf']
SHIFT_Y = -round(ORIGIN_Y, 3)
SEA_SCALE = 0.4
PLANING_LIFT = 0.45            # m at full speed
TOP_SPEED = 14.0               # m/s, VEHICLES.boat.topSpeed (27 kt)
SWELL_Y = 0.08                 # water.js: the translucent swell plane
MARGIN = 0.02                  # cockpit must clear the swell plane by this much
KEEP_DRY_Y = SWELL_Y + MARGIN  # the module's keep-dry clamp holds the cockpit above this
LEAN_SCALE = 0.55              # art3: she heels 0.55 of the game's 0.42 rad turn lean (~13 deg, a deep-V's heel)
TRIM_SCALE = 0.75              # art3: and trims 0.75 of the game's 0.14 rad (6 deg bow-up on the plane)
LIFT_FROM, LIFT_FULL_AT = 0.20, 0.70   # she climbs onto the plane between 20% and 70% of top speed
                                       # (2.8 - 9.8 m/s): at Half ahead (4 m/s) she still sits in the water
print('HYDRO', {k: round(v, 3) for k, v in HYD.items()}, 'shift', SHIFT_Y)


def lift_at(f):
    """Planing lift (m) at speed fraction f: a smoothstep from LIFT_FROM to LIFT_FULL_AT."""
    return PLANING_LIFT * ss((abs(f) - LIFT_FROM) / (LIFT_FULL_AT - LIFT_FROM))

# ============================================================== ASSEMBLY ===
ROOT = link_new('kestrel_launch', None)
ROOT.empty_display_type = 'PLAIN_AXES'
ROOT.empty_display_size = 1.0
for ob in list(COL.objects):
    if ob is ROOT or ob.parent is not None:
        continue
    ob.parent = ROOT
    if ob.type == 'MESH' and ob.location.length < 1e-9:
        ob.data.transform(Matrix.Translation((0, SHIFT_Y, 0)))   # static part: bake it in
    else:
        ob.location.y += SHIFT_Y                                  # part with a meaningful origin

Y_BOW_TIP = YH + 0.08 + SHIFT_Y            # stem head plus the D-fender
Y_TRANSOM_WL = y_tr(0.0) + SHIFT_Y
ROOT['design_waterline_z'] = 0.0
ROOT['origin'] = ('on the design waterline at the centre of flotation (%.2f m forward of the transom at the '
                  'waterline, %.2f m aft of the stem head)' % (-Y_TRANSOM_WL, Y_BOW_TIP))
ROOT['fit'] = {
    'recipe': ('After main.js has copied v.pos and v.quat onto the model: y = sea_motion_scale * v.pos.y + '
               'lift(f), f = clamp(|speed| / top_speed_mps, 0, 1), lift(f) = planing_lift_m * smoothstep((f - '
               'lift_from) / (lift_full_at - lift_from)); pitch = trim_scale * trim + sea_motion_scale * (pitch - trim), trim = 0.14 f; bank = lean_scale '
               '* lean + sea_motion_scale * (bank - lean), lean = -steer * 0.42 * clamp(|speed| / 8, 0, 1); trim '
               'and lean lerped at dt*5 and dt*3 as surface.js does. Then the keep-dry clamp: transform '
               'keep_dry_points to world space and raise y by max(0, keep_dry_y + sea level - lowest). '
               'kestrel_launch.js createKestrelLaunch() does all of it in userData.update, adds back main.js\'s '
               '0.42 m pack lowering itself, and draws the bow wave, the wash astern and the turn spray.'),
    'sea_motion_scale': SEA_SCALE,
    'heave_visual_scale': SEA_SCALE,
    'lean_scale': LEAN_SCALE,
    'trim_scale': TRIM_SCALE,
    'planing_lift_m': PLANING_LIFT,
    'lift_from': LIFT_FROM,
    'lift_full_at': LIFT_FULL_AT,
    'top_speed_mps': TOP_SPEED,
    'swell_plane_y': SWELL_Y,
    'keep_dry_y': KEEP_DRY_Y,
    'bow_game_z': round(-Y_BOW_TIP, 3),
    'transom_waterline_game_z': round(-Y_TRANSOM_WL, 3),
}
ROOT['planing_lift_m'] = PLANING_LIFT
ROOT['spin_axes'] = ('Blender: outboard_l/r steer about local +Z (vertical, through the transom-bracket pivot); '
                     'prop_l/r spin about local +Y (the propshaft, fore-aft, origin at the hub); radar spins about '
                     'local +Z. glTF/three.js: outboard rotation.y, prop rotation.z (Blender +Y exports as -Z), '
                     'radar rotation.y')
ROOT['steer_limit_rad'] = 0.42
ROOT['steer_sign'] = ('three.js: outboard_l/r.rotation.y = +steer * 0.42 (finishBoat\'s sign). Positive steer raises '
                      'the heading (a turn to starboard, surface.js); the props sit 0.5 m aft of the pivot (local '
                      '+Z), and +rotation.y swings them to starboard, which throws the stern to port - the same as '
                      'putting a tiller to port.')
ROOT['prop_hand'] = ('prop_r right-hand, prop_l left-hand (counter-rotating). Ahead: prop_r.rotation.z decreases '
                     '(clockwise seen from astern), prop_l.rotation.z increases; reverse both astern.')
ROOT['light_blue'] = ('twin beacons plus the 0.9 m LED light bar on the roof\'s front edge, one mesh, one '
                      'material: flash it by visibility or emissive intensity')
ROOT['lights_white'] = ('light_mast holds the all-round white at 3.2 m (legal on its own for a power boat under '
                        '12 m) and a separate white stern light on the transom centreline, on the motor-well '
                        'coaming between the cowls')
ROOT['decals'] = ('Every decal (KESTREL, RESCUE, the slash, the pinstripe, the transom tape, the K1 roof ID) sits '
                  '6 mm proud of paint_orange or roof_nonskid. The game has no logarithmic depth buffer (near 0.1, '
                  'far 60000), so give those two base materials polygonOffset (factor 2, units 2): the base steps '
                  'back and every decal stays in front out to helicopter range. kestrel_launch.js sets it.')


def heave_extremes():
    """min and max of sin(p) + 0.45 sin(1.7 p + 1.1) (surface.js seaMotion) over
    its full period of 20 pi."""
    lo, hi = 0.0, 0.0
    N = 40000
    for k in range(N):
        p = 20 * math.pi * k / N
        h = math.sin(p) + 0.45 * math.sin(1.7 * p + 1.1)
        lo, hi = min(lo, h), max(hi, h)
    return lo, hi


def world_y(pts, pitch, bank, dz):
    """Lowest world height of local points (x, y, z) (Blender axes, final
    frame) under the game's Euler(pitch, yaw, bank, 'YXZ'), heaved dz. The bank
    is taken toward whichever side is lowest (the probes are symmetric)."""
    cp, sp, sb, cb = math.cos(pitch), math.sin(pitch), abs(math.sin(bank)), math.cos(bank)
    return min(dz + (-abs(x) * sb + z * cb) * cp + y * sp for x, y, z in pts)


def fit_checks():
    """Pose the finished model the way the game + kestrel_launch.js will, at the
    sea states the game actually produces, and measure what matters: the sea
    (and the swell layer 0.08 above it) must stay out of the cockpit and the
    motor well, and nothing may reach below the game's 1 m grounding draught.

    The module poses her: y = 0.4 v.pos.y + lift(f); pitch = 0.75 trim + 0.4
    (pitch - trim); bank = 0.55 lean + 0.4 (bank - lean); then the keep-dry
    clamp lifts her by max(0, 0.10 - lowest cockpit probe). The gate reports
    the pose before the clamp (pre), what the clamp had to add (clamp) and the
    result (post).

    BOUND: the sea's worst heave, pitch and roll all at once (the independent
    worst case the gate asserts on); for turns the worst speed from 4 to
    14 m/s. GAME: the same equations stepped through time with the game's own
    lerps, so heave, pitch and roll keep their real phase."""
    dg = bpy.context.evaluated_depsgraph_get()
    pts, hull_pts = [], []
    for ob in COL.objects:
        if ob.type != 'MESH':
            continue
        me = ob.evaluated_get(dg).to_mesh()
        mw = ob.matrix_world
        ws = [mw @ v.co for v in me.vertices]
        pts += ws
        if ob.name == 'hull':
            hull_pts = [(abs(p.x), p.y, p.z) for p in ws if p.z < -0.25]
        ob.evaluated_get(dg).to_mesh_clear()
    cand = [(abs(p.x), p.y, p.z) for p in pts if p.z < -0.30]     # the only points that can be deepest
    sole = []
    for y in (Y_AB, -SHIFT_Y, Y_STEP):
        x = hull_x(y, Z_SOLE + 0.01, 1.30) - 0.05
        sole += [(sx * x, y + SHIFT_Y, Z_SOLE) for sx in (-1, 1)]
    lip = [(sx * X_WELL, y_tr(Z_WELL) + SHIFT_Y, Z_WELL) for sx in (-1, 0, 1)]
    # ... and the reviewer's own probes (game axes (x, y, z) -> Blender (x, -z, y)): the aft
    # corners 0.16 m aft of the real sole corners, the mid-length sole edge and the well lip
    rev = [(-1.15, -2.7, 0.35), (1.15, -2.7, 0.35), (-1.2, 0.0, 0.35), (1.2, 0.0, 0.35), (0.0, -2.8, 0.50)]
    probes = {'sole': sole, 'well_lip': lip, 'reviewer': rev,
              'platform': [(sx * 1.2, -4.30 + SHIFT_Y, Z_PLAT) for sx in (-1, 1)]}
    dry = sole + lip + rev
    h_lo, h_hi = heave_extremes()

    def pose_row(pitch, bank, dz):
        pre = world_y(dry, pitch, bank, dz)
        clamp = max(0.0, KEEP_DRY_Y - pre)
        d = dz + clamp
        row = {'pre': round(pre, 3), 'clamp': round(clamp, 3)}
        for k, pp in probes.items():
            row[k] = round(world_y(pp, pitch, bank, d), 3)
        row['deepest'] = round(world_y(cand, pitch, bank, d), 3)
        row['hull_deepest'] = round(world_y(hull_pts, pitch, bank, d), 3)
        return row

    def bound(sea, f, steer):
        A, P, R = 0.1 + 0.75 * sea, 0.02 + 0.12 * sea, 0.01 + 0.2 * sea
        lean = 0.42 * abs(steer) * min(1.0, f * TOP_SPEED / 8.0)
        worst = None
        for s_ in (-1, 1):
            pitch = TRIM_SCALE * 0.14 * f + s_ * SEA_SCALE * P
            bank = LEAN_SCALE * lean + SEA_SCALE * R
            r = pose_row(pitch, bank, lift_at(f) + SEA_SCALE * A * h_lo)
            r['_pose'] = (pitch, bank, lift_at(f) + SEA_SCALE * A * h_lo + r['clamp'])
            if worst is None or r['pre'] < worst['pre']:
                worst = r
        return worst

    def game(sea, f, steer, secs=120.0):
        A, P, R = 0.1 + 0.75 * sea, 0.02 + 0.12 * sea, 0.01 + 0.2 * sea
        w = 2 * math.pi / (3 + sea * 2.5)
        lean_g = -steer * 0.42 * min(1.0, f * TOP_SPEED / 8.0)
        y_, pitch_, bank_ = 0.0, 0.14 * f, lean_g
        dt = 1 / 60
        lo_pre, clamp_max, deep, hdeep = 9.0, 0.0, 9.0, 9.0
        for i in range(int(secs / dt)):
            ph = i * dt * w
            h = math.sin(ph) * A + math.sin(ph * 1.7 + 1.1) * A * 0.45
            y_ += (h - y_) * min(1.0, dt * 12)
            pitch_ += (0.14 * f - math.cos(ph) * P - pitch_) * min(1.0, dt * 5)
            bank_ += (lean_g + math.sin(ph * 0.8 + 2.1) * R - bank_) * min(1.0, dt * 3)
            if i < 600:
                continue                                   # let the lerps settle
            th = TRIM_SCALE * 0.14 * f + SEA_SCALE * (pitch_ - 0.14 * f)
            bk = LEAN_SCALE * lean_g + SEA_SCALE * (bank_ - lean_g)
            dz = lift_at(f) + SEA_SCALE * y_
            pre = world_y(dry, th, bk, dz)
            c = max(0.0, KEEP_DRY_Y - pre)
            lo_pre, clamp_max = min(lo_pre, pre), max(clamp_max, c)
            if i % 20 == 0:
                deep = min(deep, world_y(cand, th, bk, dz + c))
                hdeep = max(hdeep if hdeep < 9 else -9.0, world_y(hull_pts, th, bk, dz + c))
        return {'game_pre': round(lo_pre, 3), 'game_clamp': round(clamp_max, 3), 'game_deepest': round(deep, 3),
                'game_hull_deepest_max': round(hdeep, 3)}

    report, ok, poses = {}, True, {}
    speeds = [k / 40 for k in range(10, 41)]               # f = 0.25 .. 1.00 for the turns
    cases = []
    for sea in (0.066, 0.137, 0.22):
        cases += [(sea, 'rest', 0.0, 0.0, 'straight'), (sea, 'full speed', 1.0, 0.0, 'straight')]
    for sea in (0.137, 0.39):
        cases += [(sea, 'full-lock turn', None, 1.0, 'turn')]
    for sea in (0.39, 0.56, 1.01):
        cases += [(sea, 'rest', 0.0, 0.0, 'info'), (sea, 'full speed', 1.0, 0.0, 'info')]
    for sea in (0.56, 1.01):
        cases += [(sea, 'full-lock turn', None, 1.0, 'info')]
    for sea, what, f, steer, kind in cases:
        if f is None:
            rows = [(ff, bound(sea, ff, steer)) for ff in speeds]
            f, row = min(rows, key=lambda r: r[1]['pre'])
            what = '%s (worst at %.1f m/s)' % (what, f * TOP_SPEED)
        else:
            row = bound(sea, f, steer)
        row.update(game(sea, f, steer))
        pose = row.pop('_pose')
        name = 'sea %.3f, %s' % (sea, what)
        if kind == 'straight':
            ok_row = row['clamp'] == 0.0 and row['deepest'] > -1.0 and row['game_clamp'] == 0.0
        elif kind == 'turn':
            ok_row = (min(row['sole'], row['well_lip'], row['reviewer']) >= KEEP_DRY_Y - 1e-6 and
                      row['clamp'] <= 0.30 and row['hull_deepest'] < -0.15 and row['deepest'] > -1.0)
        else:
            ok_row = True
        if kind != 'info':
            ok &= ok_row
        tag = 'info' if kind == 'info' else ('ok  ' if ok_row else 'FAIL')
        report[name] = row
        poses[name] = [round(v, 4) for v in pose]
        print('FIT %-44s %s %s' % (name, tag, row))
    ROOT['fit_checks'] = str(report)
    ROOT['fit_gate'] = ('asserted by build.py on the BOUND rows (worst heave, pitch and roll at once): straight '
                        'running at sea 0.066 / 0.137 / 0.22, rest and full speed, keeps the cockpit sole corners '
                        'and the motor-well lip above the swell plane (y = %.2f) by %.2f m with no help from the '
                        'keep-dry clamp, and the deepest point above -1.0 m (the 1 m draught). A full-lock turn at '
                        'the worst speed from 4 to 14 m/s at sea 0.137 and 0.39 keeps them above it with a clamp '
                        'lift of at most 0.30 m, the hull still in the water and above -1.0 m. Sea 0.39 straight, '
                        '0.56 and 1.01 are reported, not gated. game_* columns step the same cases through time.'
                        % (SWELL_Y, MARGIN))
    ROOT['fit_poses'] = str(poses)
    assert ok, 'FIT CHECK FAILED'
    return report, poses, dry


def tri_count(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    total = 0
    per = {}
    for ob in objs:
        if ob.type != 'MESH':
            continue
        me = ob.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        per[ob.name] = len(me.loop_triangles)
        total += per[ob.name]
        ob.evaluated_get(dg).to_mesh_clear()
    return total, per


def check_winding(objs):
    """Every opaque material exports single-sided, so an inside-out part is
    invisible in the game. Closed islands must enclose positive volume."""
    dg = bpy.context.evaluated_depsgraph_get()
    bad, n_closed = [], 0
    for ob in objs:
        if ob.type != 'MESH':
            continue
        me = ob.evaluated_get(dg).to_mesh()
        bm = bmesh.new(); bm.from_mesh(me)
        seen = set()
        for f0 in bm.faces:
            if f0.index in seen:
                continue
            isl, stack = [], [f0]
            seen.add(f0.index)
            while stack:
                f = stack.pop(); isl.append(f)
                for e in f.edges:
                    for h in e.link_faces:
                        if h.index not in seen:
                            seen.add(h.index); stack.append(h)
            if any(len(e.link_faces) < 2 for f in isl for e in f.edges):
                continue
            n_closed += 1
            c = sum((f.calc_center_median() for f in isl), Vector()) / len(isl)
            vol = 0.0
            for f in isl:
                vs = [v.co for v in f.verts]
                for i in range(1, len(vs) - 1):
                    vol += (vs[0] - c).dot((vs[i] - c).cross(vs[i + 1] - c)) / 6
            if vol < 0:
                bad.append((ob.name, len(isl), round(vol, 6)))
        bm.free()
        ob.evaluated_get(dg).to_mesh_clear()
    print('WINDING closed islands', n_closed, 'inside-out', len(bad), bad[:12])
    return bad


assert not check_winding(list(COL.objects)), 'WINDING: inside-out parts'
FIT, FIT_POSES, DRY_PTS = fit_checks()
_fit = dict(ROOT['fit'])
# the keep-dry probes in glTF / three.js axes (x, y up, z aft) for the module
_fit['keep_dry_points'] = [round(c, 3) for x, y, z in DRY_PTS for c in (x, z, -y)]
_fit['render_pose_turn'] = FIT_POSES[next(k for k in FIT_POSES if k.startswith('sea 0.390, full-lock'))]
# starboard hull sections (keel -> sheer, 9 points each, stern -> stem) in glTF axes: the module finds
# where the sea cuts the hull each frame, so the bow wave sits at the real entry as she climbs onto the plane
_cols = [0] + [j for j, t in enumerate(TAGS) if t == 'b'] + [IDX_CHINE_A, IDX_CHINE_A + 1]
_tops = [j for j, t in enumerate(TAGS) if t == 'top']
_cols += [_tops[1], _tops[3], len(TAGS) - 1]
_secs = BASE_SECTIONS[::2] + ([BASE_SECTIONS[-1]] if (len(BASE_SECTIONS) - 1) % 2 else [])
_fit['hull_section_points'] = len(_cols)
_fit['hull_sections'] = [round(c, 3) for row in _secs for j in _cols
                         for c in (row[j].x, row[j].z, -(row[j].y + SHIFT_Y))]
ROOT['fit'] = _fit
TOTAL, PER = tri_count(list(COL.objects))
print('TRIS_TOTAL', TOTAL)
for k, v in sorted(PER.items(), key=lambda kv: -kv[1]):
    print('  TRIS %-26s %6d' % (k, v))

BLEND = os.path.join(HERE, 'kestrel_launch.blend')
bpy.context.preferences.filepaths.save_version = 0     # no .blend1 backups
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
print('SAVED', BLEND)

# ================================================================ EXPORT ===
GROUPS = {
    'hull': ['strake', 'hull_graphics', 'swim_platform', 'trim_tabs'],
    'deck': ['console', 'console_plinth', 'seat_plinth_0', 'seat_plinth_1', 'helm', 'screen_frame', 'seat_pod_0', 'seat_pod_1', 'seat_rails', 'rails',
             'outboard_brackets', 'kit', 'anchor', 'stretcher', 'nonskid', 'tow_post'] + [o.name for o in COL.objects if o.name.startswith(('seat_', 'cooler'))],
    'ttop': ['hardtop', 'roof_id', 'ttop_fascia', 'ttop_lettering', 'lifebuoy', 'visor', 'visor_lettering', 'visor_radios'],
    'light_blue': ['light_bar'],
    'light_mast': ['light_stern'],
    'outboard_l': ['outboard_graphics_l'],
    'outboard_r': ['outboard_graphics_r'],
}


def export_glb(path):
    vl = bpy.context.view_layer
    # apply every modifier (bevels, mirrors, subdivision) on the export copy
    for ob in list(COL.objects):
        if ob.type == 'MESH' and ob.modifiers:
            bpy.ops.object.select_all(action='DESELECT')
            ob.select_set(True); vl.objects.active = ob
            bpy.ops.object.convert(target='MESH')
    # merge static parts by function: fewer draw calls on a Chromebook
    for target, names in GROUPS.items():
        tgt = bpy.data.objects[target]
        others = [bpy.data.objects[n] for n in dict.fromkeys(names) if n in bpy.data.objects and n != target]
        if not others:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in others:
            o.select_set(True)
        tgt.select_set(True); vl.objects.active = tgt
        bpy.ops.object.join()
    bpy.ops.object.select_all(action='DESELECT')
    ROOT.select_set(True)
    for o in ROOT.children_recursive:
        o.select_set(True)
    vl.objects.active = ROOT
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_cameras=False, export_lights=False,
                              export_animations=False, export_materials='EXPORT', export_extras=True,
                              export_normals=True, export_tangents=False)
    print('EXPORTED', path)


def verify_glb(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    dg = bpy.context.evaluated_depsgraph_get()
    tot = 0
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    mats = set()
    for ob in bpy.data.objects:
        par = ob.parent.name if ob.parent else '-'
        w = ob.matrix_world.translation
        line = 'NODE %-22s parent=%-16s world=(%.3f, %.3f, %.3f)' % (ob.name, par, w.x, w.y, w.z)
        if ob.type == 'MESH':
            me = ob.data
            me.calc_loop_triangles()
            tot += len(me.loop_triangles)
            line += ' tris=%d' % len(me.loop_triangles)
            for m in me.materials:
                mats.add(m.name)
            for v in me.vertices:
                p = ob.matrix_world @ v.co
                lo = Vector(map(min, lo, p)); hi = Vector(map(max, hi, p))
        print(line)
    print('GLB_TRIS', tot)
    print('GLB_BBOX', tuple(round(v, 3) for v in lo), tuple(round(v, 3) for v in hi))
    print('GLB_MATERIALS', len(mats), sorted(mats))


if DO_EXPORT:
    GLB = os.path.join(HERE, 'kestrel_launch.glb')
    export_glb(GLB)
    verify_glb(GLB)
    # ... and the loader-free ES module the game can actually import
    import runpy
    runpy.run_path(os.path.join(HERE, 'bake_module.py'))['bake'](GLB, os.path.join(HERE, 'kestrel_launch.js'))
