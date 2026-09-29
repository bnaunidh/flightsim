"""
ISLAND COURIER VAN -- the car for Island Flight Simulator.

Built headless from an empty factory scene, every time:

  "/Applications/Blender.app/Contents/MacOS/Blender" --background --factory-startup \
      --python build.py

The headlamp openings and the reverse-lamp openings are knifed into the shell (cut_skin)
and the rebuilt skin carries the uncut surface's normals as custom normals.

Writes courier_van.blend (live modifiers: Mirror + WeightedNormal on the halves) and
courier_van.glb (modifiers applied, one-off parts folded into 'body') next to this
file, then re-imports the GLB into a fresh scene and prints names, origins,
triangles and the bounding box.  render.py renders renders/r<round>/.

Axes (Blender): +Y is the nose, +Z is up, +X is the van's right (starboard) side.
The glTF export (+Y up) turns that into the game's -Z forward, +Y up.

FIT, derived from the game:
  src/vehicles/surface.js  VEHICLES.car: wheelbase 2.7, track 1.9, rideHeight 0.06
  updateCar(): groundY = mean ground height under the four wheel probes (placed at
               +-track/2, +-wheelbase/2); pos.y = groundY + rideHeight
  main.js updateDrive(): vehicleModel.position.copy(v.pos) -- no extra car offset
  => in model space the road is the plane z = -0.06.  Tyre radius 0.345, so the
     wheel centres are (+-0.95, +-1.35, 0.285) and the tyre bottoms touch z = -0.06.
  driving.js DriveCamera: chase 8 m back / 3.2 m up / look 6 m ahead at 1.1 m, fov 64;
  bonnet eye [0, 1.45, -1.15] = (0, 1.15, 1.45) here -- inside the cab, 0.2 m behind
  the windscreen, above the dash.

NAMES under the root empty 'courier_van':
  body, glass, wheel_fl/fr/rl/rr (origin on the wheel centre, spin about local X,
  front pair steer about local Z), steering_wheel (turns about its local Y = the
  column; glTF/three.js local Z; the object carries the 35 degree column rake),
  light_head, light_tail, light_brake, light_reverse, light_indicator_l,
  light_indicator_r, beacon (spins about local Z; three.js Y).

LAMP MATERIALS (for the loader: clone every light_* material per object, then drive
emission by material name):
  light_head      DRLs, projector lenses, fog-slot LED bars          (emissive 1.5)
  light_red       shared by light_tail (the C guides) and light_brake
                  (brake bars + high-level light)                      (emissive 2.0)
  light_indicator shared by light_indicator_l / _r                    (dark amber, 0.1)
  light_reverse   the reverse LED bars                                (white, 0.08)
  light_beacon    the beacon dome and bulb                            (amber, 2.0, alpha 0.75)
  lens / lens_red / chrome / rubber inside those objects are never driven.

No image textures, no procedural textures: every detail is geometry or a material zone.
"""
import bpy, bmesh, math, os, sys
import mathutils
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

HERE = os.path.dirname(os.path.abspath(__file__))
BLEND = os.path.join(HERE, "courier_van.blend")
GLB = os.path.join(HERE, "courier_van.glb")

# ---------------------------------------------------------------- fit numbers
WHEELBASE, TRACK, RIDE = 2.7, 1.9, 0.06
GROUND = -RIDE                    # the road, in model space
TYRE_R = 0.345                    # 215/65 R16-ish
TYRE_W = 0.205
WHEEL_Z = GROUND + TYRE_R         # 0.285
WHEEL_X = TRACK / 2               # 0.95
WHEEL_Y = WHEELBASE / 2           # 1.35

# ---------------------------------------------------------------- body plan
W = 1.02            # half width of the body side at the belt
Y_F = 2.16          # front face (at the bonnet leading edge, side, before bow)
Y_R = -2.22         # rear face (at the roof edge)
R_PF = 0.30         # plan radius of the front corners
R_PR = 0.14         # plan radius of the rear corners
R_LE = 0.10         # bonnet leading-edge rounding
R_RE = 0.10         # roof rear-edge rounding
ARCH_R = 0.405      # wheel-arch radius: 6 cm over the 0.345 m tyre, like a road van
ARCH_Z = WHEEL_Z    # concentric with the wheel
Z_SILL = 0.30
Z_BOT_FRONT = 0.52  # body bottom in front of the front arch (bumper covers below)
Z_BOT_REAR = 0.44   # body bottom behind the rear arch
FIL = 0.06          # shoulder fillet size
B0 = 0.07           # plan bow of the front (windscreen / bonnet / nose)


def srgb(h):
    """'#rrggbb' -> linear rgb tuple."""
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def clamp(x, a, b):
    return a if x < a else b if x > b else x


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


# ================================================================ materials
MATS = {}


def make_mat(name, color, rough=0.5, metal=0.0, emit=None, emit_strength=0.0,
             alpha=1.0, double=False, spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = spec
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
        try:
            m.blend_method = 'BLEND'
        except Exception:
            pass
    m.use_backface_culling = not double
    m.diffuse_color = (*color, alpha)
    m.roughness = rough
    m.metallic = metal
    MATS[name] = m
    return m


def build_materials():
    make_mat('paint_main', srgb('#f4f6f7'), rough=0.32, metal=0.0, double=True)
    make_mat('paint_blue', srgb('#0a7fc2'), rough=0.30)
    make_mat('paint_yellow', srgb('#ffc21a'), rough=0.30)
    make_mat('dark_trim', srgb('#23272b'), rough=0.72, double=True)
    make_mat('glass', srgb('#1d2f3c'), rough=0.05, metal=0.0, alpha=0.42)
    make_mat('rubber', srgb('#161719'), rough=0.9)
    make_mat('chrome', srgb('#d4d8dc'), rough=0.22, metal=0.85)
    # clear polycarbonate over the headlamps: almost no body colour, all highlight
    make_mat('lens', srgb('#8f9aa3'), rough=0.04, alpha=0.11, spec=0.35)
    make_mat('light_head', srgb('#eef3f7'), rough=0.12, metal=0.1,
             emit=srgb('#fff6e0'), emit_strength=1.5)
    # the rear lamps are dark glass with light inside: the unlit lens is a deep, glossy
    # smoked red, and only the light guides (the C, the brake bar, the high-level brake
    # light) glow.  light_red is shared by the light_tail and light_brake objects (the
    # loader clones it per object, as it does light_indicator for the two sides); its
    # strength > 1 exports as KHR_materials_emissive_strength
    make_mat('lens_red', (0.09, 0.004, 0.006), rough=0.08)
    make_mat('light_red', (0.30, 0.004, 0.004), rough=0.25, emit=(1.0, 0.012, 0.006), emit_strength=2.0)
    # a faint white emissive so the exported emissive colour is already white: the game
    # only has to raise the intensity when reversing
    make_mat('light_reverse', srgb('#e6e9ec'), rough=0.15, emit=srgb('#ffffff'), emit_strength=0.08)
    # unlit amber glass: dark, with a low glow the game raises when it blinks
    make_mat('light_indicator', (0.24, 0.052, 0.0), rough=0.08, emit=(1.0, 0.42, 0.0), emit_strength=0.10)
    make_mat('light_beacon', (1.0, 0.18, 0.0), rough=0.15, emit=(1.0, 0.25, 0.0),
             emit_strength=2.0, alpha=0.75)


# decal stack heights off the skin.  The game's camera (near 0.1, far 60000, 24-bit
# depth) resolves ~0.34 mm at 24 m, so every layer that overlaps another sits >= 3 mm
# above it: livery < lettering / badges < panel seams.
L_LIV, L_TXT, L_SEAM = 0.003, 0.006, 0.009


# ================================================================ mesh helpers
class MB:
    """Tiny mesh builder: verts + faces + per-face material names."""

    def __init__(self):
        self.v = []
        self.f = []
        self.m = []

    def add_v(self, p):
        self.v.append(tuple(p))
        return len(self.v) - 1

    def add_f(self, idx, mat):
        self.f.append(tuple(idx))
        self.m.append(mat)

    def extend(self, other, xf=None):
        off = len(self.v)
        for p in other.v:
            q = Vector(p)
            if xf is not None:
                q = xf @ q
            self.v.append(tuple(q))
        for f, m in zip(other.f, other.m):
            self.f.append(tuple(i + off for i in f))
            self.m.append(m)

    def grid(self, rows, mat, closed_u=False, closed_v=False, flip=False, matfn=None):
        """rows: list (u) of lists (v) of points -> quads."""
        ids = [[self.add_v(p) for p in row] for row in rows]
        nu, nv = len(ids), len(ids[0])
        for i in range(nu if closed_u else nu - 1):
            i2 = (i + 1) % nu
            for j in range(nv if closed_v else nv - 1):
                j2 = (j + 1) % nv
                q = [ids[i][j], ids[i2][j], ids[i2][j2], ids[i][j2]]
                if flip:
                    q.reverse()
                self.add_f(q, matfn(i, j) if matfn else mat)
        return ids


def clean_mb(mb, eps=1e-7):
    """Drop zero-area faces: repeated corners (a grid that collapses where a band tapers
    to nothing, a lathe row on the axis) and corners that sit on the line through their
    neighbours.  A quad that loses one corner becomes the triangle it really was."""
    V = [Vector(p) for p in mb.v]
    F, M = [], []
    for f, m in zip(mb.f, mb.m):
        q = []
        for i in f:
            if q and (V[i] - V[q[-1]]).length < eps:
                continue
            q.append(i)
        while len(q) > 1 and (V[q[0]] - V[q[-1]]).length < eps:
            q.pop()
        changed = True
        while changed and len(q) > 3:
            changed = False
            for k in range(len(q)):
                a, b, c = V[q[k - 1]], V[q[k]], V[q[(k + 1) % len(q)]]
                if (b - a).cross(c - b).length < 1e-10:
                    q.pop(k)
                    changed = True
                    break
        if len(q) < 3:
            continue
        if len(q) == 3 and (V[q[1]] - V[q[0]]).cross(V[q[2]] - V[q[0]]).length < 1e-10:
            continue
        F.append(tuple(q))
        M.append(m)
    dropped = len(mb.f) - len(F)
    mb.f, mb.m = F, M
    return dropped


def to_object(name, mb, smooth=True, collection=None):
    clean_mb(mb)
    me = bpy.data.meshes.new(name)
    me.from_pydata([Vector(p) for p in mb.v], [], list(mb.f))
    names = []
    for mn in mb.m:
        if mn not in names:
            names.append(mn)
    for mn in names:
        me.materials.append(MATS[mn])
    idx = {mn: i for i, mn in enumerate(names)}
    for poly, mn in zip(me.polygons, mb.m):
        poly.material_index = idx[mn]
        poly.use_smooth = smooth
    me.validate(clean_customdata=False)
    me.update()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def lathe(profile, segs, mat, axis='X', a0=0.0, a1=2 * math.pi, closed=True, matfn=None, flip=False):
    """profile: list of (r, h). Revolve around the axis. Returns MB."""
    mb = MB()
    n = segs if closed else segs + 1
    rows = []
    for k in range(n):
        a = a0 + (a1 - a0) * k / segs
        ca, sa = math.cos(a), math.sin(a)
        row = []
        for r, h in profile:
            if axis == 'X':      # wheel: h along X, circle in YZ
                row.append((h, r * ca, r * sa))
            else:                # Z: h along Z, circle in XY
                row.append((r * ca, r * sa, h))
        rows.append(row)
    mb.grid(rows, mat, closed_u=closed, flip=flip, matfn=matfn)
    return mb


def sweep(frames, profile, mat, closed_path=False, closed_prof=False, matfn=None, flip=False):
    """frames: list of (origin, out, up) Vectors; profile: list of (o, u)."""
    rows = []
    for (o, n, u) in frames:
        rows.append([o + n * a + u * b for a, b in profile])
    mb = MB()
    mb.grid(rows, mat, closed_u=closed_path, closed_v=closed_prof, matfn=matfn, flip=flip)
    return mb


def cap_fan(mb, ring_ids, mat, flip=False):
    c = Vector((0, 0, 0))
    for i in ring_ids:
        c += Vector(mb.v[i])
    c /= len(ring_ids)
    ci = mb.add_v(c)
    n = len(ring_ids)
    for k in range(n):
        f = [ring_ids[k], ring_ids[(k + 1) % n], ci]
        if flip:
            f.reverse()
        mb.add_f(f, mat)


def box_mb(size, center=(0, 0, 0), mat='dark_trim', skip=()):
    sx, sy, sz = (s / 2 for s in size)
    cx, cy, cz = center
    mb = MB()
    P = [mb.add_v((cx + x * sx, cy + y * sy, cz + z * sz))
         for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    # index = xi*4 + yi*2 + zi
    faces = {
        '-x': [0, 1, 3, 2], '+x': [4, 6, 7, 5],
        '-y': [0, 4, 5, 1], '+y': [2, 3, 7, 6],
        '-z': [0, 2, 6, 4], '+z': [1, 5, 7, 3],
    }
    for k, f in faces.items():
        if k not in skip:
            mb.add_f([P[i] for i in f], mat)
    return mb


def add_mod_bevel(ob, width, segs=2, limit='ANGLE', angle=30):
    m = ob.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segs
    m.limit_method = limit
    if limit == 'ANGLE':
        m.angle_limit = math.radians(angle)
    m.harden_normals = True
    m.miter_outer = 'MITER_ARC'
    return m


def add_mod_wn(ob):
    m = ob.modifiers.new('weighted_normals', 'WEIGHTED_NORMAL')
    m.mode = 'FACE_AREA'
    m.weight = 50
    m.keep_sharp = True
    return m


def add_mod_mirror(ob):
    m = ob.modifiers.new('mirror', 'MIRROR')
    m.use_axis = (True, False, False)
    m.use_clip = True
    m.use_mirror_merge = True
    m.merge_threshold = 0.0005
    return m


# ================================================================ the body shell
def fillet_polyline(pts, radii, n=14):
    out = [Vector(pts[0])]
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[i + 1])
        r = radii[i]
        d1 = (p0 - p1).normalized()
        d2 = (p2 - p1).normalized()
        ang = d1.angle(d2)
        t = r / math.tan(ang / 2)
        a, b = p1 + d1 * t, p1 + d2 * t
        for k in range(n + 1):
            s = k / n
            out.append((1 - s) ** 2 * a + 2 * s * (1 - s) * p1 + s * s * b)
    out.append(Vector(pts[-1]))
    return out


# side-view line of the shoulder corner (the top edge of the side panel)
_SIL = fillet_polyline([(-3.0, 1.81), (0.766, 1.81), (1.80, 1.08), (2.60, 0.84)],
                       [0, 0.30, 0.26, 0], n=24)


def sil(y):
    pts = _SIL
    for a, b in zip(pts, pts[1:]):
        if a.x <= y <= b.x:
            t = (y - a.x) / max(1e-9, b.x - a.x)
            return lerp(a.y, b.y, t)
    return pts[0].y if y < pts[0].x else pts[-1].y


def le_drop(y):
    s = y - (Y_F - R_LE)
    if s <= 0:
        return 0.0
    s = min(s, R_LE)
    return R_LE - math.sqrt(max(0.0, R_LE * R_LE - s * s))


def re_drop(y):
    s = (Y_R + R_RE) - y
    if s <= 0:
        return 0.0
    s = min(s, R_RE)
    return R_RE - math.sqrt(max(0.0, R_RE * R_RE - s * s))


def arch_bottom(y):
    """Body bottom height at y: sill, overhang or wheel arch."""
    for yc in (WHEEL_Y, -WHEEL_Y):
        dy = y - yc
        if abs(dy) <= ARCH_R + 1e-6:
            z = ARCH_Z + math.sqrt(max(0.0, ARCH_R ** 2 - dy * dy))
            # the arch ends meet the overhangs, not the sill, at the bumper ends
            if yc > 0 and dy > 0:
                z = max(z, Z_BOT_FRONT)
            if yc < 0 and dy < 0:
                z = max(z, Z_BOT_REAR)
            return max(z, Z_SILL)
    if y > WHEEL_Y + ARCH_R:
        return Z_BOT_FRONT
    if y < -WHEEL_Y - ARCH_R:
        return Z_BOT_REAR
    return Z_SILL


# top-part columns as fractions of the span 0..T1
COLS = [0.0, 0.085, 0.33, 0.58, 0.80, 0.975, 1.0]    # the last column: a 22 mm support
                                                     # loop / the windscreen's side frit
# upper side rows: (name, fraction of z_split..T2, inward offset)
UPPER = [('rail', 0.925, 0.049), ('mid', 0.62, 0.032), ('belt_top', 0.335, 0.014),
         ('crease', 0.30, 0.003), ('below', 0.265, 0.0), ('ref', 0.0, 0.0)]
# lower side rows: (name, fraction of z_bot..z_split, inward offset, z_extra)
LOWER = [('swage_top', 0.74, -0.004, 0.0), ('swage', 0.60, -0.003, 0.0),
         ('rub', 0.36, 0.0, 0.0), ('low', 0.15, 0.005, 0.0),
         ('sill_start', 0.06, 0.014, 0.0), ('sill_corner', 0.012, 0.036, 0.0),
         ('turn', 0.0, 0.11, 0.004)]
O_T2, O_C = 0.053, 0.056
ROWNAMES = ['T2'] + [r[0] for r in UPPER] + [r[0] for r in LOWER]
J_T1 = len(COLS) - 1          # 6
J_T2 = J_T1 + 4               # 10 (T1, m1, m2, m3, T2)
J = J_T2 + 1 + len(UPPER) + len(LOWER)   # 24


def jrow(name):
    return J_T2 + ROWNAMES.index(name)


def crown_at(y, kind):
    if kind == 'front':
        return 0.03
    if kind == 'rear':
        return 0.045
    roof = 0.045 * (1 - smoothstep(0.62, 0.90, y))
    bonnet = 0.03 * smoothstep(1.74, 1.92, y)
    return roof + bonnet


def bow_ramp(y, kind):
    if kind == 'front':
        return 1.0
    if kind == 'rear':
        return 0.0
    return smoothstep(0.40, 0.84, y)


# pressed roof channels (y of each channel floor).  Each is ONE extra shell station
# sunk 10 mm across the roof between two neighbours 27 mm away (the two over the rear arch
# reuse the arch's own stations as the channel edges), so the roof really is recessed.
_MID30 = ARCH_R * (1 + math.cos(math.radians(30))) / 2      # halfway between two arch stations
ROOF_CHANNELS = (-WHEEL_Y - _MID30, -WHEEL_Y + _MID30, -0.30)
CHAN_DEPTH, CHAN_HALF = 0.010, 0.027


def station(kind, param, chan=0.0):
    """Return the section (J points, top-centre -> turn-under) and metadata.
    chan: depth of a roof channel pressed into this station's roof columns."""
    if kind == 'side':
        y = param
        P = Vector((W, y))
        n = Vector((1.0, 0.0))
        th = 0.0
        zc = sil(y)
        zb = arch_bottom(y)
    elif kind == 'front':
        th = math.radians(param)
        P = Vector((W - R_PF + R_PF * math.cos(th), Y_F - R_PF + R_PF * math.sin(th)))
        n = Vector((math.cos(th), math.sin(th)))
        zc = sil(P.y) - le_drop(P.y)
        zb = Z_BOT_FRONT
    else:  # rear
        th = math.radians(param)
        P = Vector((W - R_PR + R_PR * math.cos(th), Y_R + R_PR - R_PR * math.sin(th)))
        n = Vector((math.cos(th), -math.sin(th)))
        zc = sil(P.y) - re_drop(P.y)
        zb = Z_BOT_REAR
    s2 = math.sin(th) ** 2
    # upper-row inward offsets are gentler on the front face than on the sides
    kup = (1 - s2) + s2 * (0.45 if kind == 'front' else 0.8)

    ybase = P.y
    ramp = bow_ramp(ybase, kind)
    crown = crown_at(ybase, kind)

    def bow(x):
        return B0 * ramp * (1 - (x / W) ** 2)

    def lean(z):
        if kind == 'front':
            return 0.07 * clamp((0.86 - z) / (0.86 - Z_BOT_FRONT), 0, 1) * s2
        if kind == 'rear':
            return 0.03 * clamp((1.70 - z) / (1.70 - Z_BOT_REAR), 0, 1) * s2
        return 0.0

    def side_pt(o, z):
        o2 = o * kup if o > 0 else o
        q = P - n * o2 + n * lean(z)
        return Vector((q.x, q.y + bow(q.x), z))

    C2 = P - n * (O_C * kup)
    xc = C2.x
    t2z = zc - FIL
    zsplit = 0.86
    zsplit = min(zsplit, t2z - 0.3 * (t2z - zb))
    zsplit = max(zsplit, zb + 0.10)

    sec = []
    span = xc - FIL
    for f in COLS:
        x = f * span
        sink = chan * (1 - smoothstep(0.55, 0.85, x))      # the channel dies out before the edge
        sec.append(Vector((x, C2.y + bow(x), zc + crown * (1 - (x / xc) ** 2) - sink)))
    T1 = sec[-1]
    Cc = Vector((xc, C2.y + bow(xc), zc))
    T2 = side_pt(O_T2, t2z)
    # A pillar: between the windscreen and the side glass the round shoulder becomes a
    # flat, body-coloured face with ~10 mm edge radii (the support rows sit 11 % in from
    # each glass edge), flush with both glass surfaces
    kch = 0.0
    if kind == 'side':
        kch = smoothstep(0.80, 0.90, ybase) * (1 - smoothstep(1.72, 1.84, ybase))

    def bez(t):
        return (1 - t) ** 2 * T1 + 2 * t * (1 - t) * Cc + t * t * T2
    for t, tc in ((0.25, 0.11), (0.5, 0.5), (0.75, 0.89)):
        cham = T1.lerp(T2, tc).lerp(bez(tc), 0.2)
        sec.append(bez(t).lerp(cham, kch))
    sec.append(T2)
    for name, fr, o in UPPER:
        if name == 'rail':
            fr = 0.955 if kind == 'front' else 0.925 if kind == 'rear' else \
                lerp(0.925, 0.955, smoothstep(0.20, 0.50, ybase))
        if kind == 'front':
            # the belt crease dies out round the nose corner: on the front face the top
            # simply leans back in one smooth curve, so the lamps and grille sit on a
            # clean surface instead of straddling a ridge
            o = lerp(o, O_T2 * fr * fr, smoothstep(0.0, 0.15, s2))
        sec.append(side_pt(o, zsplit + fr * (t2z - zsplit)))
    for name, g, o, ze in LOWER:
        if kind == 'front' and o < 0:
            o = lerp(o, 0.0, smoothstep(0.0, 0.15, s2))   # the swage line ends at the corner too
        sec.append(side_pt(o, zb + g * (zsplit - zb) + ze))
    assert len(sec) == J, (len(sec), J)
    return sec, dict(kind=kind, y=ybase, zc=zc, zb=zb, th=th)


def station_list():
    st = []
    for a in (90, 80, 68, 52, 34, 16, 0):
        st.append(('rear', a))
    ys = [-2.00, -1.90]
    ys += [-WHEEL_Y + ARCH_R * math.cos(math.radians(a)) for a in range(180, -1, -30)]
    ys += [-0.84, -0.30 - CHAN_HALF, -0.30 + CHAN_HALF, 0.20, 0.44, 0.56, 0.64, 0.70, 0.76,
           0.82, 0.86, 0.88]
    ys += [WHEEL_Y + ARCH_R * math.cos(math.radians(a)) for a in range(180, -1, -30)]
    ys += [1.84]
    side = [(y, 0.0) for y in ys] + [(y, CHAN_DEPTH) for y in ROOF_CHANNELS]
    for y, ch in sorted(side):
        st.append(('side', y, ch))
    for a in (0, 16, 34, 52, 66, 78, 86, 90):
        st.append(('front', a))
    # sort side stations; corners stay at the ends
    return st


def coons(A, B, C, D, us, vs):
    """A: top (i), B: outer side (k), C: bottom (i), D: centre (k). Returns grid[i][k]."""
    NA, NB = len(A), len(B)
    G = []
    for i in range(NA):
        u = us[i]
        col = []
        for k in range(NB):
            v = vs[k]
            p = ((1 - v) * A[i] + v * C[i] + (1 - u) * D[k] + u * B[k]
                 - ((1 - u) * (1 - v) * A[0] + u * (1 - v) * A[-1]
                    + (1 - u) * v * C[0] + u * v * C[-1]))
            col.append(p)
        G.append(col)
    return G


def build_body_shell():
    """Right half of the body shell (mirrored later). Returns (MB for paint/dark, MB for glass)."""
    stations = station_list()
    secs, metas = [], []
    for kind, p, *ch in stations:
        s, m = station(kind, p, *ch)
        secs.append(s)
        metas.append(m)
    S = len(secs)

    body = MB()
    glass = MB()
    ids = [[body.add_v(p) for p in sec] for sec in secs]

    def sidx(y):
        best, bi = 9, None
        for i, m in enumerate(metas):
            if m['kind'] == 'side' and abs(m['y'] - y) < best:
                best, bi = abs(m['y'] - y), i
        return bi

    s_B0 = sidx(0.44)
    s_W0 = sidx(0.56)
    s_FR = sidx(0.86)
    s_WS0 = sidx(0.88)
    s_cowl = sidx(1.76)
    s_bon = sidx(1.84)

    def tag(s, j):
        # s: quad between station s and s+1; j: between section j and j+1
        # The pillars and the header are body colour; only a ~22 mm ceramic frit strip
        # (dark_trim) runs along each glass edge, as on a flush-glazed van.
        if s_WS0 <= s < s_cowl and j < J_T1:
            return 'dark_trim' if j == J_T1 - 1 else 'glass'   # windscreen + its side frit
        if s_W0 <= s < s_cowl and j in (jrow('rail'), jrow('mid')):
            return 'glass'
        if s_B0 <= s < s_W0 and j in (jrow('rail'), jrow('mid')):
            return 'dark_trim'          # B pillar
        if s_B0 <= s < s_cowl and j == jrow('T2'):
            return 'dark_trim'          # frit along the top / front edge of the side glass
        if s_FR <= s < s_WS0 and j < J_T1:
            return 'dark_trim'          # frit along the top of the windscreen
        if s_cowl <= s < s_bon and j < J_T1:
            return 'dark_trim'          # scuttle panel under the wipers
        if j >= jrow('sill_corner'):
            return 'dark_trim'          # the turn-under: sill underside / arch flange
        return 'paint_main'

    for s in range(S - 1):
        for j in range(J - 1):
            q = [ids[s][j], ids[s][j + 1], ids[s + 1][j + 1], ids[s + 1][j]]
            t = tag(s, j)
            if t == 'glass':
                gq = [glass.add_v(body.v[i]) for i in q]
                glass.add_f(gq, 'glass')
            else:
                body.add_f(q, t)

    # ---- caps (front face / rear doors) as Coons patches
    def make_cap(sec_ids, front):
        sec = [Vector(body.v[i]) for i in sec_ids]
        A = sec[:J_T1 + 3]           # X0..T1, m1, m2
        B = sec[J_T1 + 2:]           # m2, m3, T2, rows...
        NA, NB = len(A), len(B)
        xmax = A[-1].x
        Bt, Bb = B[0].z, B[-1].z
        vs = [(Bt - b.z) / (Bt - Bb) for b in B]
        us = [a.x / xmax for a in A]
        ramp_bow = (lambda x: B0 * (1 - (x / W) ** 2)) if front else (lambda x: 0.0)
        # centre line D: same rows, x = 0
        D = []
        for k, b in enumerate(B):
            z = A[0].z + vs[k] * (B[-1].z - A[0].z)
            D.append(Vector((0.0, b.y + ramp_bow(0.0) - ramp_bow(b.x), z)))
        D[0] = A[0].copy()
        # bottom C: the turn-under row, x distribution like A
        bl = B[-1]
        C = []
        for i, a in enumerate(A):
            x = us[i] * bl.x
            C.append(Vector((x, bl.y + ramp_bow(x) - ramp_bow(bl.x), bl.z)))
        C[-1] = bl.copy()
        D[-1] = C[0].copy()
        G = coons(A, B, C, D, us, vs)
        gid = [[None] * NB for _ in range(NA)]
        for i in range(NA):
            for k in range(NB):
                if k == 0:
                    gid[i][k] = sec_ids[i]
                elif i == NA - 1:
                    gid[i][k] = sec_ids[J_T1 + 2 + k]
                else:
                    gid[i][k] = body.add_v(G[i][k])
        rearwin_cols = range(1, 4)
        rearwin_rows = (jrow('rail') - (J_T1 + 2), jrow('mid') - (J_T1 + 2))
        for i in range(NA - 1):
            for k in range(NB - 1):
                q = [gid[i][k], gid[i + 1][k], gid[i + 1][k + 1], gid[i][k + 1]]
                if not front:
                    q.reverse()
                t = 'paint_main'
                if k >= NB - 2:
                    t = 'dark_trim'
                if not front and i in rearwin_cols and k in rearwin_rows:
                    t = 'glass'
                if t == 'glass':
                    glass.add_f([glass.add_v(body.v[x]) for x in q], 'glass')
                else:
                    body.add_f(q, t)
        return gid

    make_cap(ids[0], front=False)
    make_cap(ids[-1], front=True)
    return body, glass, secs, metas



# ================================================================ projection onto the body
class Proj:
    """Ray-casts onto the (mirrored) body shell so trim, livery and lights sit ON it.

    A hit is moved out onto the SMOOTH surface the shell stands for (Phong tessellation of
    the hit triangle from its vertex normals, outward only) and lifted along the
    interpolated normal, so an overlay never sinks between the shell's own facets on a
    tight corner.  raw=True keeps the point on the facet (for the headlamp cut, where the
    skin itself is rebuilt through the point)."""

    def __init__(self, ob):
        dg = bpy.context.evaluated_depsgraph_get()
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        M = ob.matrix_world
        R = M.to_3x3()
        self.V = [M @ v.co for v in me.vertices]
        self.VN = [(R @ v.normal).normalized() for v in me.vertices]
        self.T = [tuple(t.vertices) for t in me.loop_triangles]
        ev.to_mesh_clear()
        self.bvh = BVHTree.FromPolygons(self.V, self.T, all_triangles=True)

    def smooth(self, idx, loc, fn):
        """(point on the smooth surface, smooth normal) for a hit at loc on triangle idx."""
        tri = self.T[idx]
        a, b, c = tri
        w = barycentric_transform(loc, self.V[a], self.V[b], self.V[c],
                                  Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
        n = self.VN[a] * w.x + self.VN[b] * w.y + self.VN[c] * w.z
        if n.length < 1e-9:
            return loc, fn
        n.normalize()
        if n.dot(fn) < 0:
            n = -n
        if n.dot(fn) < 0.5:
            return loc, fn               # across a real crease: keep the facet
        # Phong tessellation (alpha 0.75): blend the projections of the hit onto the three
        # vertex tangent planes; a vertex across a crease (> 35 deg) contributes the hit
        ph = Vector((0, 0, 0))
        for vi, wi in zip(tri, w):
            ni = self.VN[vi]
            if abs(ni.dot(fn)) < 0.82:
                ph += loc * wi
            else:
                ph += (loc - ni * (loc - self.V[vi]).dot(ni)) * wi
        # only ever lift: next to a short steep facet (the belt step) a vertex normal can
        # tilt enough to pull a long flat panel's Phong surface several mm INTO the skin
        return loc + n * max(0.0, 0.75 * (ph - loc).dot(n)), n

    def cast(self, o, d, lift=0.0, inside=False, raw=False):
        """raw: stay on the flat facet (for points the skin itself is rebuilt through)."""
        d = Vector(d).normalized()
        loc, nrm, idx, dist = self.bvh.ray_cast(Vector(o), d)
        if loc is None:
            return None
        if raw:
            _, nrm = self.smooth(idx, loc, nrm)
        else:
            loc, nrm = self.smooth(idx, loc, nrm)
        # lift away from the body: toward the ray origin when casting from outside,
        # along the ray when casting outward from inside the shell
        if (nrm.dot(d) > 0) != inside:
            nrm = -nrm
        return (loc + nrm * lift, nrm)

    def side(self, y, z, lift=0.0, s=1):
        return self.cast((3.0 * s, y, z), (-s, 0, 0), lift)

    def rear(self, x, z, lift=0.0):
        return self.cast((x, -4.0, z), (0, 1, 0), lift)

    def front(self, x, z, lift=0.0):
        return self.cast((x, 4.0, z), (0, -1, 0), lift)

    def top(self, x, y, lift=0.0):
        return self.cast((x, y, 4.0), (0, 0, -1), lift)

    def nearest(self, p, lift=0.0, centre=(0.0, 0.8, 0.8)):
        """Closest point on the shell, normal turned away from `centre`."""
        loc, nrm, idx, dist = self.bvh.find_nearest(Vector(p))
        if loc is None:
            return None
        loc, nrm = self.smooth(idx, loc, nrm)
        if nrm.dot(loc - Vector(centre)) < 0:
            nrm = -nrm
        return (loc + nrm * lift, nrm)


def surface_frame(n):
    """Horizontal + up tangents for a surface normal n."""
    u = n.cross(Vector((0, 0, 1)))
    if u.length < 1e-6:
        u = Vector((1, 0, 0))
    u.normalize()
    return u, u.cross(n).normalized()


def round_stack(P, mb, c, n, rings, segs, fan_mat, fan_lift):
    """Concentric rings laid on the shell around c (outward normal n); every vertex is
    snapped back onto the shell along -n and lifted.  rings: [(radius, lift, band_mat)]
    outer -> inner; band_mat colours the band from that ring to the next one, the last
    ring fans to the centre in fan_mat.  Faces point away from the (r, lift) profile."""
    u, v = surface_frame(n)
    ring_ids = []
    for (r, lift, _) in rings:
        ids = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            q = c + (u * math.cos(a) + v * math.sin(a)) * r
            h = P.cast(q + n * 0.3, -n, lift)
            ids.append(mb.add_v(h[0] if h else q + n * lift))
        ring_ids.append(ids)
    for i in range(len(rings) - 1):
        (r0, l0, mat), (r1, l1, _) = rings[i], rings[i + 1]
        nr, nl = (l1 - l0), -(r1 - r0)          # profile normal in (radial, lift)
        a, b = ring_ids[i], ring_ids[i + 1]
        for k in range(segs):
            k2 = (k + 1) % segs
            am = 2 * math.pi * (k + 0.5) / segs
            radial = u * math.cos(am) + v * math.sin(am)
            add_face_oriented(mb, [a[k], a[k2], b[k2], b[k]], mat, radial * nr + n * nl)
    h = P.cast(c + n * 0.3, -n, fan_lift)
    ci = mb.add_v(h[0] if h else c + n * fan_lift)
    last = ring_ids[-1]
    for k in range(segs):
        add_face_oriented(mb, [last[k], last[(k + 1) % segs], ci], fan_mat, n)


def surface_ribbon(P, mb, pts, width, lift, mat, centre=(0.0, 0.8, 0.8), crown=0.0):
    """A strip following 3D points on the shell (snapped to the nearest surface point),
    `width` across, `lift` off the skin; crown > 0 raises the middle into a rounded bead."""
    hits = [P.nearest(p, 0.0, centre) for p in pts]
    cols = []
    for i, (loc, nrm) in enumerate(hits):
        a = hits[max(i - 1, 0)][0]
        b = hits[min(i + 1, len(hits) - 1)][0]
        side = (b - a).normalized().cross(nrm).normalized()
        col = [loc + nrm * lift + side * width / 2]
        if crown:
            col.append(loc + nrm * (lift + crown))
        col.append(loc + nrm * lift - side * width / 2)
        cols.append([mb.add_v(p) for p in col])
    for i in range(len(cols) - 1):
        for j in range(len(cols[i]) - 1):
            add_face_oriented(mb, [cols[i][j], cols[i + 1][j], cols[i + 1][j + 1], cols[i][j + 1]], mat,
                              hits[i][1] + hits[i + 1][1])


def add_face_oriented(mb, ids, mat, outward):
    pts = [Vector(mb.v[i]) for i in ids]
    n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
    if len(pts) == 4:
        n += (pts[2] - pts[0]).cross(pts[3] - pts[0])
    if n.dot(Vector(outward)) < 0:
        ids = list(reversed(ids))
    mb.add_f(ids, mat)


def proj_grid(mb, rows, fn, mat, matfn=None):
    """rows: [[(a, b, lift), ...], ...]; fn(a, b, lift) -> (pos, nrm) | None."""
    hits = [[fn(*p) for p in row] for row in rows]
    ids = [[mb.add_v(h[0]) if h else None for h in row] for row in hits]
    for i in range(len(ids) - 1):
        for j in range(len(ids[i]) - 1):
            q = [ids[i][j], ids[i + 1][j], ids[i + 1][j + 1], ids[i][j + 1]]
            if None in q:
                continue
            m = matfn(i, j) if matfn else mat
            if m is None:
                continue
            nrm = hits[i][j][1] + hits[i + 1][j + 1][1]
            add_face_oriented(mb, q, m, nrm)
    return ids, hits


def grid_rim(mb, rows, fn, ids, hits, mat, base_lift=-0.003):
    """Side wall from a projected patch's boundary down into the body."""
    nu, nv = len(rows), len(rows[0])
    loop = ([(0, j) for j in range(nv)] + [(i, nv - 1) for i in range(1, nu)] +
            [(nu - 1, j) for j in range(nv - 2, -1, -1)] + [(i, 0) for i in range(nu - 2, 0, -1)])
    cen = Vector((0, 0, 0))
    cnt = 0
    for row in hits:
        for h in row:
            if h:
                cen += h[0]
                cnt += 1
    cen /= max(cnt, 1)
    base = []
    for (i, j) in loop:
        a, b, _ = rows[i][j]
        h = fn(a, b, base_lift)
        base.append(mb.add_v(h[0]) if h else None)
    top = [ids[i][j] for (i, j) in loop]
    n = len(loop)
    for k in range(n):
        k2 = (k + 1) % n
        q = [top[k], top[k2], base[k2], base[k]]
        if None in q:
            continue
        mid = sum((Vector(mb.v[x]) for x in q), Vector()) / 4
        add_face_oriented(mb, q, mat, mid - cen)


def ribbon_rows(path, width, lift):
    rows = []
    for i, p in enumerate(path):
        a = Vector(path[max(i - 1, 0)])
        b = Vector(path[min(i + 1, len(path) - 1)])
        t = (b - a).normalized()
        n = Vector((-t.y, t.x))
        P = Vector(p)
        rows.append([(*(P + n * width / 2), lift), (*(P - n * width / 2), lift)])
    return rows


def mirror_mb(mb):
    out = MB()
    out.v = [(-x, y, z) for (x, y, z) in mb.v]
    out.f = [tuple(reversed(f)) for f in mb.f]
    out.m = list(mb.m)
    return out


def xform_mb(mb, M):
    out = MB()
    out.v = [tuple(M @ Vector(p)) for p in mb.v]
    flip = M.to_3x3().determinant() < 0
    out.f = [tuple(reversed(f)) if flip else f for f in mb.f]
    out.m = list(mb.m)
    return out


def orient_convex(mb, start):
    """Point every face added after index `start` away from its part's centroid."""
    idx = set(i for f in mb.f[start:] for i in f)
    c = sum((Vector(mb.v[i]) for i in idx), Vector()) / max(1, len(idx))
    for k in range(start, len(mb.f)):
        f = mb.f[k]
        pts = [Vector(mb.v[i]) for i in f]
        fc = sum(pts, Vector()) / len(pts)
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if len(pts) == 4:
            n += (pts[2] - pts[0]).cross(pts[3] - pts[0])
        if n.dot(fc - c) < 0:
            mb.f[k] = tuple(reversed(f))


def orient_axis_x(mb, sign):
    """Point every face's normal to the sign of X (a flat-ish disc facing out)."""
    for k in range(len(mb.f)):
        f = mb.f[k]
        pts = [Vector(mb.v[i]) for i in f]
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if len(pts) == 4:
            n += (pts[2] - pts[0]).cross(pts[3] - pts[0])
        if n.x * sign < 0:
            mb.f[k] = tuple(reversed(f))


def prism_mb(poly, h0, h1, mat, axis='X', caps=(True, True)):
    """Extrude a 2D polygon (in the plane normal to axis) from h0 to h1."""
    mb = MB()

    def P(a, b, h):
        if axis == 'X':
            return (h, a, b)
        if axis == 'Y':
            return (a, h, b)
        return (a, b, h)
    n = len(poly)
    lo = [mb.add_v(P(a, b, h0)) for a, b in poly]
    hi = [mb.add_v(P(a, b, h1)) for a, b in poly]
    for k in range(n):
        k2 = (k + 1) % n
        mb.add_f([lo[k], lo[k2], hi[k2], hi[k]], mat)
    if caps[0]:
        mb.add_f(list(reversed(lo)), mat)
    if caps[1]:
        mb.add_f(hi, mat)
    orient_convex(mb, 0)
    return mb


def cyl_mb(p0, p1, r, segs, mat, caps=True):
    p0, p1 = Vector(p0), Vector(p1)
    ax = (p1 - p0).normalized()
    t = ax.orthogonal().normalized()
    u = ax.cross(t)
    mb = MB()
    r0, r1 = [], []
    for k in range(segs):
        a = 2 * math.pi * k / segs
        d = t * math.cos(a) + u * math.sin(a)
        r0.append(mb.add_v(p0 + d * r))
        r1.append(mb.add_v(p1 + d * r))
    for k in range(segs):
        k2 = (k + 1) % segs
        mb.add_f([r0[k], r0[k2], r1[k2], r1[k]], mat)
    if caps:
        mb.add_f(list(reversed(r0)), mat)
        mb.add_f(r1, mat)
    orient_convex(mb, 0)
    return mb


def bevel_box_object(name, size, loc, mat, width, segs=2, rot=None):
    mb = box_mb(size, (0, 0, 0), mat)
    ob = to_object(name, mb, smooth=True)
    ob.location = loc
    if rot is not None:
        ob.rotation_euler = rot
    m = ob.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segs
    m.limit_method = 'NONE'
    m.harden_normals = False
    m.profile = 0.5
    return ob


def bake_object(ob, apply_transform=False):
    """Apply modifiers (and optionally the transform) into the mesh data, in place."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if apply_transform:
        me.transform(ob.matrix_basis)
        ob.matrix_basis = Matrix()
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def object_to_mb(ob):
    """Bake an object and read it back as an MB (keeps material names)."""
    bake_object(ob, apply_transform=True)
    me = ob.data
    mb = MB()
    mb.v = [tuple(v.co) for v in me.vertices]
    for p in me.polygons:
        mb.f.append(tuple(p.vertices))
        mb.m.append(me.materials[p.material_index].name)
    bpy.data.objects.remove(ob)
    return mb


# ================================================================ wheels
def build_wheel_mb():
    """Right-hand wheel, centred on the origin, axle along X, outboard face +X."""
    mb = MB()
    # --- tyre: a 215/65 R16 road-van tyre.  The carcass is lathed at 28 segments with a
    #     rounded shoulder, so the silhouette is a clean circle.  The tread is two
    #     circumferential V grooves (8 mm wide, 4 mm deep) between three ribs; ribs and
    #     grooves are separate strips (no shared vertices), so each groove wall shades
    #     flat and the grooves read as crisp dark lines.  (A third groove and a shoulder
    #     sipe row were cut: they vanished past 3 m and cost ~450 triangles a wheel.)
    SEG = 28
    R, GD = TYRE_R, 0.004
    EDGE = 0.064
    grooves = (-0.026, 0.026)
    # inboard sidewall, ending at the tread edge (one row: it faces the chassis and is
    # never seen straight on)
    mb.extend(lathe([(0.203, -0.1035), (R, -EDGE)], SEG, 'rubber', axis='X'))   # as wide as the outboard bulge
    # outboard sidewall with its bulge and a rounded shoulder into the tread edge
    shp = [(R, EDGE), (0.3425, 0.077), (0.331, 0.0915), (0.292, 0.1035), (0.203, 0.089)]
    mb.extend(lathe(shp, SEG, 'rubber', axis='X'))
    # ribs: full radius, flat across
    edges = [-EDGE] + [g + s * 0.004 for g in grooves for s in (-1, 1)] + [EDGE]
    for x0, x1 in zip(edges[0::2], edges[1::2]):
        mb.extend(lathe([(R, x0), (R, x1)], SEG, 'rubber', axis='X'))
    # grooves: 45 degree walls to a 4 mm deep floor line
    for g in grooves:
        mb.extend(lathe([(R, g - 0.004), (R - GD, g), (R, g + 0.004)], SEG, 'rubber', axis='X'))
    # --- rim lip + barrel (bright), inner barrel dark so the spokes stand out
    rim = [(0.203, 0.086), (0.2065, 0.0945), (0.197, 0.099), (0.187, 0.093),
           (0.180, -0.060)]
    mb.extend(lathe(rim, 28, 'chrome', axis='X',
                    matfn=lambda i, j: 'chrome' if j < 3 else 'rubber'))
    # --- dark back plate behind the spokes (the brake/hub shadow)
    back = MB()
    ring = [back.add_v((-0.02, 0.181 * math.cos(2 * math.pi * k / 20),
                        0.181 * math.sin(2 * math.pi * k / 20))) for k in range(20)]
    cap_fan(back, ring, 'rubber')
    s0 = len(back.f)
    for k in range(len(back.f)):
        f = back.f[k]
        pts = [Vector(back.v[i]) for i in f]
        if (pts[1] - pts[0]).cross(pts[2] - pts[0]).x < 0:
            back.f[k] = tuple(reversed(f))
    mb.extend(back)
    # --- the brake: a 300 mm disc 30 mm behind the spokes (dark hat, bright friction
    #     band), and a caliper at 10 o'clock
    #     straddling it.  It gives the rim depth: the spokes now stand in front of a lit
    #     surface instead of a black hole.  (Part of the wheel, so it turns with it.)
    DSEG, XD = 24, 0.025
    # (a dark hat to r 124 mm, then the bright 26 mm friction band; a thin ring alone
    # and an all-bright face were both tried: the first barely read, the second filled
    # the wheel and flattened the spokes)
    prof_d = [(0.076, XD), (0.124, XD), (0.150, XD - 0.001)]
    disc = lathe(prof_d, DSEG, 'dark_trim', axis='X',
                 matfn=lambda i, j: 'dark_trim' if j == 0 else 'chrome')
    orient_axis_x(disc, +1)
    mb.extend(disc)
    # caliper: an arc block over the disc's outer edge, trailing the axle (10 o'clock on
    # the right-hand wheels, 2 o'clock on the mirrored left ones), chamfered outer edges
    cal = MB()
    a_mid = math.radians(150.0)                  # from +Y (front) round over the top
    sec = [(0.116, -0.012), (0.116, 0.036), (0.124, 0.044), (0.160, 0.044), (0.168, 0.036),
           (0.168, -0.012)]
    rows = []
    for k in range(3):
        a = a_mid + math.radians(-19.0 + 19.0 * k)
        rows.append([(x, r * math.cos(a), r * math.sin(a)) for r, x in sec])
    ids = cal.grid(rows, 'paint_blue', closed_v=True)
    for end in (ids[0], ids[-1]):
        cap_fan(cal, end, 'paint_blue')
    orient_convex(cal, 0)
    mb.extend(cal)
    # --- hub face and a centre cap in the courier blue
    hub = [(0.076, XD), (0.073, 0.075), (0.063, 0.081), (0.041, 0.084)]
    mb.extend(lathe(hub, 10, 'chrome', axis='X'))
    cap = [(0.041, 0.084), (0.030, 0.093), (0.012, 0.0975)]
    cm = lathe(cap, 10, 'paint_blue', axis='X')
    s0 = len(cm.f)
    cap_fan(cm, [k * len(cap) + len(cap) - 1 for k in range(10)], 'paint_blue')
    cm.v[-1] = (0.0985, 0.0, 0.0)                # closed, slightly domed centre
    for k in range(s0, len(cm.f)):
        f = cm.f[k]
        pts = [Vector(cm.v[i]) for i in f]
        if (pts[1] - pts[0]).cross(pts[2] - pts[0]).x < 0:
            cm.f[k] = tuple(reversed(f))
    mb.extend(cm)
    # --- five wheel nuts
    for k in range(5):
        a = 2 * math.pi * k / 5 + math.pi / 10
        c = Vector((0.0, 0.058 * math.cos(a), 0.058 * math.sin(a)))
        start = len(mb.f)
        hexa = [(c.y + 0.0105 * math.cos(2 * math.pi * i / 5), c.z + 0.0105 * math.sin(2 * math.pi * i / 5))
                for i in range(5)]      # (a pentagon at 10 mm reads the same as a hexagon)
        pm = prism_mb(hexa, 0.076, 0.093, 'chrome', axis='X', caps=(False, True))
        mb.extend(pm)
    # --- ten spokes in five pairs, chamfered faces that catch the light
    for k in range(5):
        for side in (-1, 1):
            a = 2 * math.pi * k / 5 + side * math.radians(8.5)
            R = Vector((0, math.cos(a), math.sin(a)))
            T = Vector((0, -math.sin(a), math.cos(a)))
            X = Vector((1, 0, 0))
            frames = []
            prof_rows = []
            # dished: the spoke falls 18 mm from the rim lip down to the hub
            for r, xf, w in ((0.066, 0.068, 0.026), (0.186, 0.086, 0.036)):
                o = R * r + X * xf
                prof_rows.append([o + X * dx + T * dt for dx, dt in
                                  ((-0.024, -w / 2), (-0.004, -w / 2), (0.0, -w / 2 + 0.006),
                                   (0.0, w / 2 - 0.006), (-0.004, w / 2), (-0.024, w / 2))])
            start = len(mb.f)
            ids = mb.grid(prof_rows, 'chrome')
            # orient away from the spoke's core line
            for fk in range(start, len(mb.f)):
                f = mb.f[fk]
                pts = [Vector(mb.v[i]) for i in f]
                fc = sum(pts, Vector()) / 4
                rr = fc.dot(R)
                core = R * rr + X * (0.056 + 0.15 * (rr - 0.066))
                n = (pts[1] - pts[0]).cross(pts[2] - pts[0]) + (pts[2] - pts[0]).cross(pts[3] - pts[0])
                if n.dot(fc - core) < 0:
                    mb.f[fk] = tuple(reversed(f))
    return mb


# ================================================================ steering wheel
def build_steering_mb():
    """Rim in local XZ, column along local Y (the game turns it about local Y /
    glTF local Z)."""
    mb = MB()
    R, rt = 0.185, 0.019
    prof = [(R + rt * math.cos(2 * math.pi * k / 5), rt * math.sin(2 * math.pi * k / 5)) for k in range(5)]
    tor = MB()
    rows = []
    for i in range(14):
        a = 2 * math.pi * i / 14
        rows.append([(r * math.cos(a), h, r * math.sin(a)) for r, h in prof])
    tor.grid(rows, 'dark_trim', closed_u=True, closed_v=True)
    # orient outward from the tube centre line
    for fk in range(len(tor.f)):
        f = tor.f[fk]
        pts = [Vector(tor.v[i]) for i in f]
        fc = sum(pts, Vector()) / 4
        ring = Vector((fc.x, 0, fc.z)).normalized() * R
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0]) + (pts[2] - pts[0]).cross(pts[3] - pts[0])
        if n.dot(fc - ring) < 0:
            tor.f[fk] = tuple(reversed(f))
    mb.extend(tor)
    mb.extend(cyl_mb((0, 0.035, 0), (0, -0.03, 0), 0.055, 12, 'dark_trim'))
    mb.extend(cyl_mb((0, -0.031, 0), (0, -0.036, 0), 0.03, 12, 'paint_blue'))
    for a in (math.radians(0), math.radians(180), math.radians(270)):
        d = Vector((math.cos(a), 0, math.sin(a)))
        c = d * (0.055 + (R - 0.055) / 2)
        start = len(mb.f)
        b = box_mb((0.035 if abs(d.z) > 0.5 else R - 0.05, 0.018, R - 0.05 if abs(d.z) > 0.5 else 0.035),
                   tuple(c), 'dark_trim')
        mb.extend(b)
    return mb


# ================================================================ body parts
def row_z(secs, metas, name, y):
    """Height of a named side row at y (interpolated between side stations)."""
    j = jrow(name)
    pts = sorted((m['y'], s[j].z) for s, m in zip(secs, metas) if m['kind'] == 'side')
    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
        if y0 <= y <= y1:
            return lerp(z0, z1, (y - y0) / max(1e-9, y1 - y0))
    return pts[0][1] if y < pts[0][0] else pts[-1][1]


def wave_top(y):
    base = 0.47 + 0.56 * smoothstep(1.05, -1.95, y)
    return base + 0.05 * math.sin(2 * math.pi * (y + 0.2) / 1.25) * smoothstep(0.95, 0.1, y)


def livery_bottom(y):
    z = 0.39 if y > -WHEEL_Y - ARCH_R else 0.505     # above the rear bumper step
    for yc in (WHEEL_Y, -WHEEL_Y):
        dy = y - yc
        rr = ARCH_R + 0.086
        if abs(dy) < rr:
            z = max(z, ARCH_Z + math.sqrt(rr * rr - dy * dy))
    return z


def build_livery(P, sym, secs, metas):
    """Sea-blue wave with a sunny-yellow swash along both sides and across the back."""
    L = L_LIV
    fn = lambda y, z, l: P.side(y, z, l)
    ys = [1.30 - k * 0.093 for k in range(int(round((1.30 + 1.955) / 0.093)) + 1)]
    blue, yel = [], []
    for y in ys:
        zb = livery_bottom(y)
        zt = max(wave_top(y), zb)
        # the blue's rows run exactly along the swage ridge (its two convex folds), so
        # no chord of the decal cuts under the ridge and lets the white show through;
        # where the ridge is outside the band the rows collapse and are dropped
        zr = [clamp(row_z(secs, metas, nm, y), zb, zt) for nm in ('swage', 'swage_top')]
        blue.append([(y, z, L) for z in [zb] + zr + [zt]])
        y0 = max(wave_top(y) + 0.030, zb)
        y1 = max(wave_top(y) + 0.092, zb)
        yel.append([(y, y0, L), (y, y1, L)])
    proj_grid(sym, blue, fn, 'paint_blue')
    proj_grid(sym, yel, fn, 'paint_yellow')
    # the back doors: the same wave, flatter, under the lettering
    fr = lambda x, z, l: P.rear(x, z, l)
    xs = [k * 0.79 / 8 for k in range(9)]
    rb, ry = [], []
    for x in xs:
        zt = 0.90 + 0.035 * math.cos(math.pi * x / 0.79 * 1.4)
        rb.append([(x, lerp(0.505, zt, t), L) for t in (0, 0.5, 1.0)])
        ry.append([(x, zt + 0.028, L), (x, zt + 0.086, L)])
    proj_grid(sym, rb, fr, 'paint_blue')
    proj_grid(sym, ry, fr, 'paint_yellow')


def build_windscreen_corners(P, sym, secs, metas):
    """Round the windscreen's top corners (95 mm radius, following the roof / A-pillar
    blend).  The shell's glass and its ~22 mm ceramic frit meet the pillar and the header
    in a square corner; a thin overlay 2 mm off the skin redraws that corner: body paint
    outside the outer arc, the frit band between the arcs, and the clear glass left
    showing inside the inner arc.  Worked in (x, y - bow) where the frit edges are
    straight lines: the header at y 0.86 / 0.88 and the pillar at columns 5 / 6."""
    side = [(s, m) for s, m in zip(secs, metas) if m['kind'] == 'side']
    s86 = min(side, key=lambda sm: abs(sm[1]['y'] - 0.86))[0]
    a_out = s86[J_T1].x                     # frit / body edge on the pillar side
    a_in = s86[J_T1 - 1].x                  # frit / glass edge
    b_out, b_in = 0.86, 0.88                # header frit: body edge / glass edge
    KB = 1.224                              # surface metres per metre of y on the screen
    RO = 0.095
    RI = RO - (a_out - a_in)
    ac, bc = a_out - RO, b_out + RO / KB
    bow = lambda x: B0 * (1 - (x / W) ** 2)
    fn = lambda a, b, l: P.top(a, b + bow(a), l)
    rows = []
    for k in range(9):
        th = math.radians(90 * k / 8)
        c, sn = math.cos(th), math.sin(th)
        rsq = RO / max(c, sn)
        rows.append([(ac + r * c, bc - r * sn / KB, 0.002) for r in (RI, RO, rsq)])
    proj_grid(sym, rows, fn, None, matfn=lambda i, j: 'dark_trim' if j == 0 else 'paint_main')
    print(f"WINDSCREEN CORNER frit a {a_in:.4f}..{a_out:.4f}  R {RO} / {RI:.4f}")


def build_seams(P, sym, secs, metas):
    L, Wd = L_SEAM, 0.011
    fs = lambda y, z, l: P.side(y, z, l)

    def vseam(y, z0, z1, n=None):
        # the side panels are flat between the swage and the belt, and the seams sit 9 mm
        # off the skin, so a sample every ~15 cm keeps every chord clear of the surface
        n = n or max(2, int(round((z1 - z0) / 0.15)))
        path = [(y, lerp(z0, z1, t / n)) for t in range(n + 1)]
        proj_grid(sym, ribbon_rows(path, Wd, L), fs, 'dark_trim')

    bt = lambda y: row_z(secs, metas, 'belt_top', y)
    rl = lambda y: row_z(secs, metas, 'rail', y)
    dy = 1.662 - WHEEL_Y
    vseam(1.662, ARCH_Z + math.sqrt((ARCH_R + 0.07) ** 2 - dy * dy),
          bt(1.662) - 0.006)                          # front door, hinge side (down to the flare)
    vseam(0.530, 0.385, bt(0.530) - 0.004)            # front door, shut side
    # the sliding door's top edge: ONE straight line, level like the roof edge above it,
    # that ends square on the B pillar (the rail row itself rises into the pillar, so it
    # is not used here); both vertical door edges stop on it
    z_top = rl(-0.80) - 0.018
    vseam(0.445, 0.385, z_top + Wd / 2)               # sliding door, front
    vseam(-0.800, 0.385, z_top + Wd / 2)              # sliding door, rear
    path = [(lerp(-0.80 - Wd / 2, 0.445 + Wd / 2, t / 3), z_top) for t in range(4)]
    proj_grid(sym, ribbon_rows(path, Wd, L), fs, 'dark_trim')
    print("DOOR TOP z", round(z_top, 4))
    # the sliding door's track along the rear quarter
    path = [(lerp(-0.80, -1.96, t / 4), bt(lerp(-0.80, -1.96, t / 4)) - 0.03) for t in range(5)]
    proj_grid(sym, ribbon_rows(path, 0.026, L + 0.002), fs, 'dark_trim')
    # (the bonnet shut lines are build_bonnet_lines)
    # the back doors: centre seam (half strip, mirrored), outer edges, top
    fr = lambda x, z, l: P.rear(x, z, l)
    # (rows on both sides of the belt step at 1.10-1.16, so no chord cuts its corner)
    zs = [0.50, 0.80, 1.09, 1.165, 1.40, 1.625]
    proj_grid(sym, [[(0.0, z, L), (0.0055, z, L)] for z in zs], fr, 'dark_trim')
    path = [(0.80, z) for z in zs]
    proj_grid(sym, ribbon_rows(path, Wd, L), fr, 'dark_trim')
    path = [(lerp(0.0, 0.80, t / 4), 1.625) for t in range(5)]
    proj_grid(sym, ribbon_rows(path, Wd, L), fr, 'dark_trim')


def build_roof_ribs(P, sym):
    ft = lambda x, y, l: P.top(x, y, l)
    for yc in (-1.78, -1.43, -0.42, -0.06):
        rows = []
        for k in range(5):
            x = 0.78 * k / 4
            rows.append([(x, yc - 0.032, 0.0), (x, yc - 0.018, 0.008), (x, yc + 0.018, 0.008),
                         (x, yc + 0.032, 0.0)])
        ids, hits = proj_grid(sym, rows, ft, 'paint_main')
        end = [ids[-1][j] for j in range(4)]
        if None not in end:
            add_face_oriented(sym, end, 'paint_main', (1, 0, 0))


# where the flares end: flat and square on the line they meet -- the sill moulding's
# bottom edge between the arches, the bumpers' bottom lines at the ends
Z_SILL_LINE, Z_FB_LINE, Z_RB_LINE = 0.290, 0.205, 0.215


def build_arch_trims(sym):
    """Black arch flares.  Full section all the way round (no taper), 26 segments, each
    ending in a flat square face cut exactly on the line it butts into.  Every rail of
    the section runs round the arch at its own radius and stops where IT reaches the
    cut height, so the end is one horizontal cut."""
    prof = [(0.080, 0.002), (0.058, 0.038), (0.018, 0.050), (-0.014, 0.030), (-0.024, -0.05)]
    n = 26
    for yc, z_front, z_rear in ((WHEEL_Y, Z_FB_LINE, Z_SILL_LINE), (-WHEEL_Y, Z_SILL_LINE, Z_RB_LINE)):
        rows = []
        for k in range(n + 1):
            t = k / n
            row = []
            for a_, b_ in prof:
                r = ARCH_R + a_
                a0 = math.asin((z_front - ARCH_Z) / r)
                a1 = math.pi - math.asin((z_rear - ARCH_Z) / r)
                a = lerp(a0, a1, t)
                row.append(Vector((W + b_, yc + r * math.cos(a), ARCH_Z + r * math.sin(a))))
            rows.append(row)
        sm = MB()
        ids = sm.grid(rows, 'dark_trim')
        for end in (ids[0], ids[-1]):
            for k in (1, 2, 3):
                add_face_oriented(sm, [end[0], end[k], end[k + 1]], 'dark_trim', (0, 0, -1))
        nq = n * (len(prof) - 1)
        # outward = away from the arch axis and +X; the inner lip faces the axis
        for fk in range(nq):
            f = sm.f[fk]
            pts = [Vector(sm.v[i]) for i in f]
            fc = sum(pts, Vector()) / 4
            rad = Vector((0, fc.y - yc, fc.z - ARCH_Z))
            want = Vector((0.6, 0, 0)) + rad.normalized() * 0.2
            if fc.x < W + 0.02 and rad.length < ARCH_R:
                want = -rad.normalized()
            n_ = (pts[1] - pts[0]).cross(pts[2] - pts[0]) + (pts[2] - pts[0]).cross(pts[3] - pts[0])
            if n_.dot(want) < 0:
                sm.f[fk] = tuple(reversed(f))
        sym.extend(sm)
        # wheel-well liner: the inside of the arch, so nothing shows through
        liner = lathe([(ARCH_R + 0.002, W - 0.105), (ARCH_R + 0.002, 0.56)], 12, 'rubber', axis='X',
                      a0=math.radians(-12), a1=math.radians(192), closed=False)
        wall = MB()
        ringv = [wall.add_v((0.56, (ARCH_R + 0.002) * math.cos(a), (ARCH_R + 0.002) * math.sin(a)))
                 for a in (math.radians(-12 + 204 * k / 12) for k in range(13))]
        ci = wall.add_v((0.56, 0.0, -0.09))
        for k in range(12):
            add_face_oriented(wall, [ringv[k], ringv[k + 1], ci], 'rubber', (1, 0, 0))
        M = Matrix.Translation((0, yc, ARCH_Z))
        sym.extend(liner, M)
        sym.extend(wall, M)
    # black sill moulding linking the two arch flares
    frames = []
    for k in range(9):
        y = lerp(-WHEEL_Y + ARCH_R + 0.06, WHEEL_Y - ARCH_R - 0.06, k / 8)
        frames.append((Vector((W - 0.012, y, 0.0)), Vector((1, 0, 0)), Vector((0, 0, 1))))
    prof = [(-0.05, 0.296), (0.0, 0.29), (0.014, 0.298), (0.02, 0.33), (0.016, 0.372), (0.0, 0.382)]
    sm = sweep(frames, prof, 'dark_trim')
    for fk in range(len(sm.f)):
        f = sm.f[fk]
        pts = [Vector(sm.v[i]) for i in f]
        fc = sum(pts, Vector()) / 4
        n_ = (pts[1] - pts[0]).cross(pts[2] - pts[0]) + (pts[2] - pts[0]).cross(pts[3] - pts[0])
        if n_.dot(Vector((fc.x - (W - 0.05), 0, fc.z - 0.33))) < 0:
            sm.f[fk] = tuple(reversed(f))
    sym.extend(sm)


INTAKE_X = 0.445      # the lower intake runs across the front to here (half width)


def bumper_y(x):
    """Plan position of the front bumper's reference line at x (flat part)."""
    return Y_F + 0.07 + B0 * (1 - (x / W) ** 2)


def plan_front(n=8):
    """Plan outline of the nose at bumper height, centre -> side end."""
    pts = []
    x1 = W - R_PF
    for x in (0.0, 0.15, 0.30, INTAKE_X - 0.005, INTAKE_X + 0.025, 0.50, x1):
        pts.append(Vector((x, bumper_y(x))))
    for k in range(1, n + 1):
        th = math.radians(90 - 90 * k / n)
        P = Vector((W - R_PF + R_PF * math.cos(th), Y_F - R_PF + R_PF * math.sin(th)))
        nn = Vector((math.cos(th), math.sin(th)))
        q = P + nn * 0.07 * math.sin(th) ** 2
        q.y += B0 * (1 - (q.x / W) ** 2)
        pts.append(q)
    pts.append(Vector((W, WHEEL_Y + ARCH_R + 0.03)))
    return pts


def plan_rear(n=7):
    pts = []
    x1 = W - R_PR
    for k in range(3):
        pts.append(Vector((x1 * k / 2, Y_R - 0.03)))
    for k in range(1, n + 1):
        th = math.radians(90 - 90 * k / n)
        P = Vector((W - R_PR + R_PR * math.cos(th), Y_R + R_PR - R_PR * math.sin(th)))
        nn = Vector((math.cos(th), -math.sin(th)))
        pts.append(P + nn * 0.03 * math.sin(th) ** 2)
    pts.append(Vector((W, -WHEEL_Y - ARCH_R - 0.03)))
    return pts


def plan_frames(pts):
    frames = []
    for i, p in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        t = (b - a).normalized()
        if i == 0 and abs(p.x) < 1e-6:
            t = Vector((1.0, 0.0))       # square to the mirror plane: no seam at x = 0
        n = Vector((t.y, -t.x))          # right-hand normal of a path running centre -> side
        if n.dot(p - Vector((0.0, 0.0))) < 0 and abs(p.y) < 0.1:
            n = -n
        frames.append((Vector((p.x, p.y, 0.0)), Vector((n.x, n.y, 0.0)), Vector((0, 0, 1))))
    return frames


def sweep_oriented(frames, prof, matfn, inside_fn):
    sm = sweep(frames, prof, 'dark_trim', matfn=matfn)
    for fk in range(len(sm.f)):
        f = sm.f[fk]
        pts = [Vector(sm.v[i]) for i in f]
        fc = sum(pts, Vector()) / 4
        n_ = (pts[1] - pts[0]).cross(pts[2] - pts[0]) + (pts[2] - pts[0]).cross(pts[3] - pts[0])
        if n_.dot(fc - inside_fn(fc)) < 0:
            sm.f[fk] = tuple(reversed(f))
    return sm


# front bumper section (o = out from the plan line, which is the nose skin at z 0.52; z).
# The white upper is no pillow: it leaves the nose at a crisp horizontal crease (z 0.566)
# and stands at most 8 mm proud of the extended nose line -- under 5 cm ahead of the lamp
# faces.  'in' is the intake's back wall (pushed in by the intake depth on the frames
# that cross it); 'slot' rows bound the fog slots on the corner frames.
# Offsets are measured from the nose skin at the crease height on each frame (cast, not
# assumed), so the tuck crosses the skin steeply and the crease is one clean line.
FB_ZC = 0.571
FB = [(-0.040, 0.574), (-0.004, 0.5725),              # tucked in under the nose skin
      (0.0015, 0.5705),                                 # the crease, 1.5 mm proud of the skin
      (0.009, 0.524), (0.013, 0.470),                   # the white face: the nose line, carried on
      (0.006, 0.466), (0.009, 0.452),                   # shadow step
      (0.012, 0.432),                                   # the dark lower bumper
      ('in', 0.420), ('slot', 0.389), ('slot', 0.353), ('in', 0.318),
      (0.013, 0.308), (0.009, 0.250), (-0.005, 0.205), (-0.065, 0.180)]
FB_CREASE = 2         # rows 0..2 and 2.. are separate grids: a hard edge on the crease
FB_WHITE = 4          # quads 0..3 are paint_main
FB_FACE = 0.012       # the dark lower face (from the skin line)
INTAKE_D = 0.035
SLOT_FRAMES = (5, 6)  # the fog slots: frame 5 (x 0.50) to frame 6 (x 0.72), on the flat face
SLOT_D = 0.018        # how deep they are sunk


def build_bumpers(P, sym):
    """Returns the fog-slot lamp parts (for the light_head object) and the front face
    offset at the centre (for the plate)."""
    # ---- front: a slim body-colour upper, a dark lower half with a full-width intake
    pts = plan_front()
    frames = plan_frames(pts)
    if frames[0][1].y < 0:
        frames = [(o, -n, u) for (o, n, u) in frames]
    depth = [INTAKE_D if o.x <= INTAKE_X else 0.0 for (o, n, u) in frames]
    s0, s1 = SLOT_FRAMES
    # where the nose skin is on each frame at the crease height
    sk = []
    for (o, n, u) in frames:
        h = P.cast(o + n * 0.3 + u * FB_ZC, -n)
        sk.append((h[0] - (o + u * FB_ZC)).dot(n))
    print("BUMPER skin offsets", [round(v, 4) for v in sk])
    frames = [(o + n * k, n, u) for (o, n, u), k in zip(frames, sk)]

    def off(a, i):
        if a == 'in' or a == 'slot':
            return FB_FACE - depth[i]
        return a
    rows = []
    for i, ((o, n, u), d) in enumerate(zip(frames, depth)):
        rows.append([o + n * off(a, i) + u * b for a, b in FB])

    def matfn(i, j, base=0):
        j += base
        if j < FB_WHITE:
            return 'paint_main'
        if 8 <= j <= 10 and depth[i] > 0 and depth[i + 1] > 0:
            return 'rubber'
        if j == 9 and s0 <= i < s1:
            return None                     # the fog slot opening
        return 'dark_trim'
    sm = MB()
    sm.grid([r[:FB_CREASE + 1] for r in rows], None, matfn=matfn)
    sm.grid([r[FB_CREASE:] for r in rows], None, matfn=lambda i, j: matfn(i, j, FB_CREASE))
    sm.f, sm.m = [f for f, m in zip(sm.f, sm.m) if m], [m for m in sm.m if m]
    # one consistent winding: flip everything if the white face at the centre looks inward
    f = sm.f[FB_CREASE + 1]
    pp = [Vector(sm.v[i]) for i in f]
    if ((pp[1] - pp[0]).cross(pp[2] - pp[0])).y < 0:
        sm.f = [tuple(reversed(f)) for f in sm.f]
    e = len(frames) - 1
    ring = [sm.add_v(p) for p in rows[e]]
    ci = sm.add_v(sum((Vector(p) for p in rows[e]), Vector()) / len(rows[e]))
    for j in range(len(FB) - 1):
        add_face_oriented(sm, [ring[j], ring[j + 1], ci], 'dark_trim', (0, -1, 0))
    sym.extend(sm)
    # two slim bright bars across the intake (they end in its side walls)
    for zc in (0.352, 0.386):
        bars = MB()
        brow = []
        for (o, n, u), d in zip(frames, depth):
            if d == 0:
                break
            brow.append([o + n * a + u * (zc + b) for a, b in
                         ((FB_FACE - 0.031, -0.006), (FB_FACE - 0.006, -0.006), (FB_FACE - 0.006, 0.006),
                          (FB_FACE - 0.031, 0.006))])
        bars.grid(brow, 'chrome')
        for fk in range(len(bars.f)):
            f = bars.f[fk]
            pp = [Vector(bars.v[i]) for i in f]
            fc = sum(pp, Vector()) / 4
            i0 = min(range(len(frames)), key=lambda i: (frames[i][0].xy - fc.xy).length)
            axis_pt = frames[i0][0] + frames[i0][1] * (FB_FACE - 0.018) + Vector((0, 0, zc))
            nn = (pp[1] - pp[0]).cross(pp[2] - pp[0]) + (pp[2] - pp[0]).cross(pp[3] - pp[0])
            if nn.dot(fc - axis_pt) < 0:
                bars.f[fk] = tuple(reversed(f))
        sym.extend(bars)
    # ---- fog lamps: slots sunk 18 mm into the flat face of the dark lower bumper, with
    #      dark walls, a black back and a narrow white LED bar (light_head) along the top
    fog = MB()
    zt, zb = FB[9][1], FB[10][1]
    T = [frames[i][0] + frames[i][1] * FB_FACE + frames[i][2] * zt for i in range(s0, s1 + 1)]
    B = [frames[i][0] + frames[i][1] * FB_FACE + frames[i][2] * zb for i in range(s0, s1 + 1)]
    N = [frames[i][1] for i in range(s0, s1 + 1)]
    Td = [p - n * SLOT_D for p, n in zip(T, N)]
    Bd = [p - n * SLOT_D for p, n in zip(B, N)]
    for k in range(len(T) - 1):
        q = [sym.add_v(p) for p in (T[k], T[k + 1], Td[k + 1], Td[k])]
        add_face_oriented(sym, q, 'dark_trim', (0, 0, -1))
        q = [sym.add_v(p) for p in (B[k], B[k + 1], Bd[k + 1], Bd[k])]
        add_face_oriented(sym, q, 'dark_trim', (0, 0, 1))
        q = [sym.add_v(p) for p in (Bd[k], Bd[k + 1], Td[k + 1], Td[k])]
        add_face_oriented(sym, q, 'rubber', N[k] + N[k + 1])
        up = Vector((0, 0, 1))
        led = [Td[k] + N[k] * 0.0015 - up * 0.004, Td[k + 1] + N[k + 1] * 0.0015 - up * 0.004,
               Td[k + 1] + N[k + 1] * 0.0015 - up * 0.011, Td[k] + N[k] * 0.0015 - up * 0.011]
        add_face_oriented(fog, [fog.add_v(p) for p in led], 'light_head', N[k] + N[k + 1])
    for k, sgn in ((0, -1), (len(T) - 1, 1)):
        tang = (T[min(k + 1, len(T) - 1)] - T[max(k - 1, 0)]).normalized()
        q = [sym.add_v(p) for p in (T[k], B[k], Bd[k], Td[k])]
        add_face_oriented(sym, q, 'dark_trim', tang * -sgn)
    print(f"FOG SLOTS x {T[0].x:.3f}..{T[-1].x:.3f} z {zb:.3f}..{zt:.3f}, {SLOT_D * 1000:.0f} mm deep")
    # ---- rear: dark step bumper
    pts = plan_rear()
    frames = plan_frames(pts)
    if frames[0][1].y > 0:
        frames = [(o, -n, u) for (o, n, u) in frames]
    # the face steps out 12 mm into a lower lip below the plate: the step is a narrow
    # ledge facing up and back (both its edges > 48 degrees, so crisp) that catches the
    # sky, so the chase camera sees a bright line across the black bumper
    prof = [(-0.06, 0.487), (0.0, 0.493), (0.088, 0.490), (0.104, 0.468),
            (0.104, 0.318), (0.116, 0.308), (0.113, 0.262), (0.086, 0.215), (-0.06, 0.20)]
    inside = lambda fc: Vector((0.0, -1.2, 0.35))
    ledge = os.environ.get('LEDGE', 'chrome')
    sm = sweep_oriented(frames, prof, lambda i, j: ledge if j == 4 else 'dark_trim', inside)
    e = len(frames) - 1
    ring = [e * len(prof) + j for j in range(len(prof))]
    ci = sm.add_v(sum((Vector(sm.v[i]) for i in ring), Vector()) / len(ring))
    for j in range(len(prof) - 1):
        add_face_oriented(sm, [ring[j], ring[j + 1], ci], 'dark_trim', (0, 1, 0))
    sym.extend(sm)
    # step plates on the rear bumper top: bright aluminium tread plates, so the step
    # reads from the chase camera instead of black on black
    for k in range(3):
        x0 = 0.12 + k * 0.20
        sym.extend(box_mb((0.12, 0.07, 0.006), (x0, Y_R - 0.03 - 0.05, 0.496), 'chrome', skip=('-z',)))
    return fog, sk[0]


def grille_halfwidth(z):
    zb, zt, r = 0.60, 0.835, 0.045
    t = clamp((z - zb) / (zt - zb), 0, 1)
    hw = lerp(0.29, 0.37, t)
    d = min(z - zb, zt - z)
    if d < r:
        hw -= r - math.sqrt(max(0.0, r * r - (r - d) ** 2))
    return hw


def build_grille(P, sym):
    ff = lambda x, z, l: P.front(x, z, l)
    zs = [lerp(0.60, 0.835, k / 8) for k in range(9)]
    rows = []
    for k in range(4):          # the grille face is flat across: 3 spans follow its bow
        u = k / 3
        rows.append([(grille_halfwidth(z) * u, z, 0.005) for z in zs])
    ids, hits = proj_grid(sym, rows, ff, 'dark_trim')
    grid_rim(sym, rows, ff, ids, hits, 'dark_trim')
    # two chrome bars across the grille.  Each is a rigid extrusion: its section is
    # squared to world Z and to the grille's plan normal at every station, so the bar is
    # exactly 24 mm tall and 12 mm deep along its whole length (projecting the edges
    # separately let the surface normals wobble the thickness)
    for zc in (0.672, 0.762):
        hw = grille_halfwidth(zc) - 0.012
        frames = []
        for k in range(7):
            x = hw * k / 6
            p, n = ff(x, zc, 0.0)
            nh = Vector((0.0 if k == 0 else n.x, n.y, 0.0)).normalized()
            frames.append((p, nh, Vector((0, 0, 1))))
        prof = [(0.004, -0.012), (0.016, -0.012), (0.016, 0.012), (0.004, 0.012)]
        bar = sweep(frames, prof, 'chrome')
        for fk in range(len(bar.f)):
            f = bar.f[fk]
            pp = [Vector(bar.v[i]) for i in f]
            fc = sum(pp, Vector()) / 4
            i0 = min(range(len(frames)), key=lambda i: (frames[i][0] - fc).length)
            core = frames[i0][0] + frames[i0][1] * 0.010 + Vector((0, 0, zc - frames[i0][0].z))
            nn = (pp[1] - pp[0]).cross(pp[2] - pp[0]) + (pp[2] - pp[0]).cross(pp[3] - pp[0])
            if nn.dot(fc - core) < 0:
                bar.f[fk] = tuple(reversed(f))
        o, nh, up = frames[-1]
        e = [bar.add_v(o + nh * a + up * b) for a, b in prof]
        add_face_oriented(bar, e, 'chrome', (1, 0, 0))
        sym.extend(bar)


def sun_emblem(rad, wave_amp=0.25):
    """2D sun-over-the-sea badge: list of (points2d, faces, material, lift_extra)."""
    parts = []
    # disc
    ring = [(rad * math.cos(2 * math.pi * k / 24), rad * math.sin(2 * math.pi * k / 24)) for k in range(24)]
    pts = ring + [(0.0, 0.0)]
    faces = [(k, (k + 1) % 24, 24) for k in range(24)]
    parts.append((pts, faces, 'paint_yellow', 0.0))
    # rays
    pts, faces = [], []
    for k in range(10):
        a = 2 * math.pi * k / 10 + math.pi / 10
        c, s = math.cos(a), math.sin(a)
        r0, r1, hw = rad * 1.16, rad * 1.48, rad * 0.13
        base = len(pts)
        pts += [(c * r0 - s * hw, s * r0 + c * hw), (c * r0 + s * hw, s * r0 - c * hw), (c * r1, s * r1)]
        faces.append((base, base + 1, base + 2))
    parts.append((pts, faces, 'paint_yellow', 0.0))
    # the sea across the lower part of the sun
    pts, faces = [], []
    n = 14
    for k in range(n + 1):
        u = -rad + 2 * rad * k / n
        lo = -math.sqrt(max(0.0, rad * rad - u * u))
        hi = rad * (-0.12 + wave_amp * math.sin(2 * math.pi * u / (rad * 1.05)))
        hi = min(hi, math.sqrt(max(0.0, rad * rad - u * u)))
        hi = max(hi, lo)
        pts += [(u * 1.0005, lo * 1.0005), (u, hi)]
    for k in range(n):
        a = 2 * k
        faces.append((a, a + 2, a + 3, a + 1))
    parts.append((pts, faces, 'paint_blue', 0.003))       # 3 mm over the disc: no z-fight
    return parts


def place_2d(mb, parts, mapfn, projfn, lift):
    """Map 2D (u,v) parts to the surface. mapfn(u,v)->(a,b); projfn(a,b,l)->hit."""
    for pts, faces, mat, dl in parts:
        hits = [projfn(*mapfn(u, v), lift + dl) for (u, v) in pts]
        ids = [mb.add_v(h[0]) if h else None for h in hits]
        for f in faces:
            q = [ids[i] for i in f]
            if None in q:
                continue
            nrm = sum((hits[i][1] for i in f), Vector())
            add_face_oriented(mb, q, mat, nrm)


_FONT = None


def font():
    global _FONT
    if _FONT is None:
        for path in ('/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf',
                     '/System/Library/Fonts/Supplemental/Arial Bold.ttf'):
            if os.path.exists(path):
                _FONT = bpy.data.fonts.load(path)
                break
        else:
            _FONT = bpy.data.fonts.load('<builtin>')
    return _FONT


def text_2d(body, spacing=1.0, res=2):
    """Text as flat triangles in 2D, bbox bottom-left at the origin, cap height 1."""
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = body
    cu.font = font()
    cu.size = 1.0
    cu.space_character = spacing
    cu.resolution_u = res
    ob = bpy.data.objects.new('txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    vs = [(v.co.x, v.co.y) for v in me.vertices]
    fs = [tuple(p.vertices) for p in me.polygons]
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    x0 = min(v[0] for v in vs)
    y0 = min(v[1] for v in vs)
    h = max(v[1] for v in vs) - y0
    vs = [((x - x0) / h, (y - y0) / h) for x, y in vs]
    w = max(v[0] for v in vs)
    return vs, fs, w


def simplify_glyph(vs, faces):
    """Re-fill one glyph from its outline with the collinear points dropped (a curve
    resolution applies to a glyph's straight segments too, which only wastes points),
    by a constrained Delaunay triangulation of its outline loops, holes kept open."""
    from mathutils.geometry import delaunay_2d_cdt
    cnt = {}
    for f in faces:
        for k in range(len(f)):
            e = tuple(sorted((f[k], f[(k + 1) % len(f)])))
            cnt[e] = cnt.get(e, 0) + 1
    nb = {}
    for (a, b), c in cnt.items():
        if c == 1:
            nb.setdefault(a, []).append(b)
            nb.setdefault(b, []).append(a)
    loops, seen = [], set()
    for s in nb:
        if s in seen:
            continue
        loop, prev, cur = [s], None, s
        seen.add(s)
        while True:
            nxt = [x for x in nb[cur] if x != prev and (x not in seen or (x == s and len(loop) > 2))]
            if not nxt or nxt[0] == s:
                break
            prev, cur = cur, nxt[0]
            loop.append(cur)
            seen.add(cur)
        loops.append(loop)
    V = [Vector(v) for v in vs]
    out_loops = []
    for loop in loops:
        keep = []
        n = len(loop)
        for k in range(n):
            a, b, c = V[loop[k - 1]], V[loop[k]], V[loop[(k + 1) % n]]
            d1, d2 = (b - a), (c - b)
            if d1.length < 1e-9 or d2.length < 1e-9:
                continue
            if abs(d1.normalized().cross(d2.normalized())) > math.sin(math.radians(1.0)):
                keep.append(loop[k])
        out_loops.append(keep)
    coords, cfaces = [], []
    for loop in out_loops:
        base = len(coords)
        coords += [V[i] for i in loop]
        cfaces.append(list(range(base, base + len(loop))))
    res = delaunay_2d_cdt(coords, [], cfaces, 3, 1e-9, False)
    ov, of = res[0], res[2]
    area0 = sum(abs(mathutils.geometry.area_tri(*[V[i].to_3d() for i in f[:3]])) for f in faces if len(f) == 3)
    area1 = sum(abs(mathutils.geometry.area_tri(*[ov[i].to_3d() for i in f])) for f in of)
    assert abs(area1 - area0) < 0.02 * area0 + 1e-6, (area0, area1)
    return [tuple(v) for v in ov], [tuple(f) for f in of]


def text_2d_mixed(body, hi, spacing=1.0):
    """text_2d at curve resolution 1, except the letters in `hi` (the round bowls: D, O,
    C, R), which come from a resolution-2 build of the same string.  Each capital is one
    connected piece, so pieces sorted left to right are the letters in order."""
    def raw(res):
        cu = bpy.data.curves.new('txt', 'FONT')
        cu.body = body
        cu.font = font()
        cu.size = 1.0
        cu.space_character = spacing
        cu.resolution_u = res
        ob = bpy.data.objects.new('txt', cu)
        bpy.context.scene.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        vs = [(v.co.x, v.co.y) for v in me.vertices]
        fs = [tuple(p.vertices) for p in me.polygons]
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)
        bpy.data.meshes.remove(me)
        # connected pieces
        parent = list(range(len(vs)))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a
        for f in fs:
            for a in f[1:]:
                ra, rb = find(f[0]), find(a)
                if ra != rb:
                    parent[ra] = rb
        groups = {}
        for f in fs:
            groups.setdefault(find(f[0]), []).append(f)
        pieces = sorted(groups.values(), key=lambda g: min(vs[i][0] for f in g for i in f))
        return vs, pieces
    lo_v, lo_p = raw(1)
    hi_v, hi_p = raw(2)
    letters = [c for c in body if not c.isspace()]
    assert len(lo_p) == len(hi_p) == len(letters), (body, len(lo_p), len(hi_p))
    x0 = min(v[0] for v in lo_v)
    y0 = min(v[1] for v in lo_v)
    h = max(v[1] for v in lo_v) - y0
    vs, fs = [], []
    for ch, pl, ph in zip(letters, lo_p, hi_p):
        src_v, faces = (hi_v, ph) if ch in hi else (lo_v, pl)
        if ch in hi:
            src_v, faces = simplify_glyph(hi_v, ph)
        remap = {}
        for f in faces:
            q = []
            for i in f:
                if i not in remap:
                    remap[i] = len(vs)
                    vs.append(((src_v[i][0] - x0) / h, (src_v[i][1] - y0) / h))
                q.append(remap[i])
            fs.append(tuple(q))
    w = max(v[0] for v in vs)
    return vs, fs, w


def lockup_parts(cap_top, width, gap, colour, sun_r=None, sun_gap=0.10, res=2):
    """ 'ISLAND' over 'COURIER', both the same width. Returns parts in 2D, and total width.
    Origin: left end, bottom of the lower line."""
    parts = []
    x = 0.0
    if res == 'bowls':
        v1, f1, w1 = text_2d_mixed('ISLAND', 'DOCR')
        v2, f2, w2 = text_2d_mixed('COURIER', 'DOCR')
    else:
        v1, f1, w1 = text_2d('ISLAND', res=res)
        v2, f2, w2 = text_2d('COURIER', res=res)
    s1 = width / w1
    s2 = width / w2
    h2 = s2
    if sun_r:
        vc = (h2 + gap + s1) / 2
        for p in sun_emblem(sun_r):
            pts = [(u + sun_r * 1.5, v + vc) for u, v in p[0]]
            parts.append((pts, p[1], p[2], p[3], 'sun'))
        x = sun_r * 3.0 + sun_gap
    top = [(x + u * s1, h2 + gap + v * s1) for u, v in v1]
    bot = [(x + u * s2, v * s2) for u, v in v2]
    parts.append((top, f1, colour, 0.0, 'txt'))
    parts.append((bot, f2, colour, 0.0, 'txt'))
    total_h = h2 + gap + s1
    return parts, x + width, total_h


def build_lettering(P, asym):
    L = L_TXT
    # ---- sides: sun badge + ISLAND / COURIER, reading nose-ward on the right,
    #      tail-ward on the left, centred on the load box
    parts, tw, th = lockup_parts(None, 1.20, 0.042, 'paint_blue', sun_r=0.15, res='bowls')
    zc = 1.41             # >= 3 cm clear of the sliding-door rail below and the door seam above
    ymid = -0.80
    print(f"LOCKUP side: z {zc - th / 2:.3f}..{zc + th / 2:.3f}, y {ymid - tw / 2:.3f}..{ymid + tw / 2:.3f}")
    for s in (1, -1):
        y0 = ymid - s * tw / 2
        z0 = zc - th / 2
        for pts, faces, mat, dl, kind in parts:
            place_2d(asym, [(pts, faces, mat, dl)],
                     lambda u, v, s=s, y0=y0, z0=z0: (y0 + s * u, z0 + v),
                     lambda y, z, l, s=s: P.side(y, z, l, s), L)
    # ---- back doors: white on the blue wave
    parts, tw, th = lockup_parts(None, 0.62, 0.028, 'paint_main', res=1)
    x0 = -tw / 2
    z0 = 0.655
    for pts, faces, mat, dl, kind in parts:
        place_2d(asym, [(pts, faces, mat, dl)], lambda u, v: (x0 + u, z0 + v),
                 lambda x, z, l: P.rear(x, z, l), L)
    # ---- the roof marking: a big sun badge, for the pilots overhead
    ft = lambda x, y, l: P.top(x, y, l)
    place_2d(asym, [(p[0], p[1], p[2], p[3]) for p in sun_emblem(0.19, 0.22)],
             lambda u, v: (u, -0.636 + v), ft, 0.0045)      # between two roof channels
    # ---- the badge on the grille
    ff = lambda x, z, l: P.front(x, z, l)
    # (stacked 3 mm apart, all in front of the grille bars' 16 mm faces)
    place_2d(asym, [(p[0], p[1], p[2], p[3]) for p in sun_emblem(0.048, 0.22)],
             lambda u, v: (-u, 0.717 + v), ff, 0.027)
    # badge backing disc (chrome ring)
    NB = 16
    ring_o = [(0.067 * math.cos(2 * math.pi * k / NB), 0.067 * math.sin(2 * math.pi * k / NB)) for k in range(NB)]
    ring_i = [(0.052 * math.cos(2 * math.pi * k / NB), 0.052 * math.sin(2 * math.pi * k / NB)) for k in range(NB)]
    faces = [(k, (k + 1) % NB, NB + (k + 1) % NB, NB + k) for k in range(NB)]
    place_2d(asym, [(ring_o + ring_i, faces, 'chrome', 0.0)], lambda u, v: (u, 0.717 + v), ff, 0.024)
    disc = ring_o + [(0.0, 0.0)]
    place_2d(asym, [(disc, [(k, (k + 1) % NB, NB) for k in range(NB)], 'paint_blue', 0.0)],
             lambda u, v: (u, 0.717 + v), ff, 0.021)


def head_chart(P):
    return RayChart(P, (0.36, 1.76, 0.0),
                    lambda ph: Vector((math.sin(math.radians(ph)), math.cos(math.radians(ph)), 0.0)),
                    0.80, -10.0, 100.0)


class HeadOutline:
    """The headlamp outline in (u, z) chart metres.  A slanted inner end with 12 mm
    corners beside the grille, a near-level top edge that is the bonnet's front shut
    line, and an outer end that sweeps back ~0.15 m along the wing and up towards the
    belt crease, tapering to a 10 mm-radius tip.  Every ring (hole edge, gap floor,
    housing floor) is the same column list inset by d, so they nest exactly."""
    RC = 0.012

    def __init__(self, P, C):
        self.P, self.C = P, C
        U = C.u_of

        def u_front(x, z):
            h = P.front(x, z)[0]
            return U(math.degrees(math.atan2(h.x - C.O.x, h.y - C.O.y)))
        self.zt_in, self.zb_in = 0.866, 0.726
        self.u_it, self.u_ib = u_front(0.405, self.zt_in), u_front(0.382, self.zb_in)
        rc = self.RC
        self.top = [(self.u_it + rc, 0.866), (U(45), 0.864), (U(66), 0.867), (U(78), 0.873), (U(86), 0.880),
                    (U(92), 0.884)]
        self.bot = [(self.u_ib + rc, 0.726), (U(28), 0.730), (U(46), 0.742), (U(58), 0.765), (U(68), 0.795),
                    (U(78), 0.832), (U(86), 0.856), (U(92), 0.866)]
        self.uc = U(89.5)
        zt, zb = self.z_top(self.uc), self.z_bot(self.uc)
        self.zc, self.rt = (zt + zb) / 2, (zt - zb) / 2
        u_lo = max(self.u_it, self.u_ib) + rc + 0.022
        self.main = [U(p) for p in (6, 11, 17, 23, 29, 35, 41, 46, 51, 56, 61, 66, 71, 76, 81, 85.5)]
        self.main = [u for u in self.main if u_lo < u < self.uc - 0.006]
        # columns: (kind, parameter)
        self.cols = ([('in', a) for a in (0.0, 45.0, 90.0)] + [('m', u) for u in self.main] +
                     [('tip', a) for a in (60.0, 30.0, 0.0)])

    @staticmethod
    def _f(pts, u):
        return RayChart._interp([p[0] for p in pts], [p[1] for p in pts], u)

    def z_top(self, u):
        return self._f(self.top, u)

    def z_bot(self, u):
        return self._f(self.bot, u)

    def col(self, c, d=0.0):
        """(u_top, z_top, u_bot, z_bot) of column c, inset by d."""
        kind, p = self.cols[c]
        if kind == 'm':
            zt, zb = self.z_top(p) - d, self.z_bot(p) + d
            if zt - zb < 0.002:
                zt = zb = (zt + zb) / 2
                zt, zb = zt + 0.001, zb - 0.001
            return p, zt, p, zb
        a = math.radians(p)
        if kind == 'in':
            r = max(0.001, self.RC - d)
            ct = (self.u_it + self.RC, self.zt_in - self.RC)
            cb = (self.u_ib + self.RC, self.zb_in + self.RC)
            return (ct[0] - r * math.cos(a), ct[1] + r * math.sin(a),
                    cb[0] - r * math.cos(a), cb[1] - r * math.sin(a))
        r = max(0.001, self.rt - d)
        return (self.uc + r * math.cos(a), self.zc + r * math.sin(a),
                self.uc + r * math.cos(a), self.zc - r * math.sin(a))

    def loop(self, d=0.0):
        """Closed loop (u, z): the top edge inner -> tip, then the bottom edge back."""
        n = len(self.cols)
        top = [self.col(c, d)[:2] for c in range(n)]
        bot = [self.col(c, d)[2:] for c in range(n - 1)]
        return top + list(reversed(bot))

    def at(self, u, z, lift=0.0, raw=False):
        return self.C.at(u, z, lift, raw)


def build_headlights(P):
    """The headlamps, set INTO the nose.  The skin is cut along the outline (see
    cut_skin), a 4.5 mm dark shut gap runs round it, and the clear lens lies flush with
    the surrounding surface.  Behind it a dark housing drops 38 mm to its floor, where
    the only bright parts are a 90 mm chrome projector bowl and the light_head DRL
    that sweeps along the bottom edge and up the tail; the amber indicator fills the
    swept tip.  Returns (light_head parts, indicator part, dark housing, outline)."""
    C = head_chart(P)
    L = HeadOutline(P, C)
    # every point sits on the shell's own facets (+ lift along the smooth normal), so the
    # lens is flush with the skin round the opening, whose edge is on the facets too
    at = lambda u, z, lift=0.0: L.at(u, z, lift, raw=True)
    head, ind, house = MB(), MB(), MB()
    G, DG = 0.0045, -0.006          # shut gap: width, depth of its floor
    DF, FL = 0.010, -0.038          # housing floor: inset, depth
    n = len(L.cols)
    rings = []
    # (the hole's edge lies on the shell's own facets, so the rebuilt skin round it stays
    # exactly where the skin was; everything inside is placed off the smooth surface)
    for d, lift in ((0.0, 0.0), (G, DG), (DF, FL)):
        pts = [at(u, z, lift) for u, z in L.loop(d)]
        rings.append(([house.add_v(h[0]) for h in pts], pts))
    mid = [at(*((Vector(L.col(c, DF)[:2]) + Vector(L.col(c, DF)[2:])) / 2), FL)[0] for c in range(n)]
    nl = len(rings[0][0])

    def col_of(i):
        return i if i < n else 2 * n - 2 - i
    for k in range(2):
        (ia, ha), (ib, hb) = rings[k], rings[k + 1]
        for i in range(nl):
            i2 = (i + 1) % nl
            q = [ia[i], ia[i2], ib[i2], ib[i]]
            nrm = ha[i][1] + ha[i2][1]
            if k == 0:
                want = nrm
            else:
                fc = sum((Vector(house.v[x]) for x in q), Vector()) / 4
                want = (mid[col_of(i)] - fc) + nrm.normalized() * 0.01
            # the shut-gap band is dark, except along the top edge (inner corner to the
            # start of the tip), where it is a chrome bezel lip that catches the sky
            mat = 'rubber' if k else ('chrome' if 1 <= i < n - 3 else 'dark_trim')
            add_face_oriented(house, q, mat, want)
    # housing floor + flush lens: column grids, 3 rows each (the housing is the black
    # 'rubber' plastic, so behind the lens the lamp reads black + bright LED)
    for d, lift, mb, mat in ((DF, FL, house, 'rubber'), (G, 0.0, head, 'lens')):
        grid = []
        for c in range(n):
            ut, zt, ub, zb = L.col(c, d)
            grid.append([at(lerp(ub, ut, t), lerp(zb, zt, t), lift) for t in (0.0, 0.5, 1.0)])
        gid = [[mb.add_v(h[0]) for h in col] for col in grid]
        for c in range(n - 1):
            for j in range(2):
                add_face_oriented(mb, [gid[c][j], gid[c + 1][j], gid[c + 1][j + 1], gid[c][j + 1]], mat,
                                  grid[c][j][1])
    # the projector: a 90 mm chrome bowl standing 17 mm off the floor, its lens lit
    up = L.u_it + L.RC + 0.074
    zb_d = L.z_bot(up) + DF
    zp = zb_d + 0.019 + 0.045
    pc, pn = L.at(up, zp, 0.0)
    round_stack(P, head, pc, pn,
                [(0.045, FL, 'chrome'), (0.045, -0.021, 'chrome'), (0.037, -0.019, 'chrome'),
                 (0.024, -0.026, None)], 24, 'light_head', -0.023)
    # the DRL: a 12 mm light bar standing 6 mm off the floor along the bottom edge, from
    # the inner end sweeping up the tail
    #      (its own smooth centreline: a Catmull-Rom through the lamp's bottom-edge
    #      control points, sampled at twice the lens columns and placed off the SMOOTH
    #      surface, so it sweeps without the facets' kinks; a front face and a top wall)
    u0, u1 = L.u_ib + L.RC + 0.006, L.C.u_of(76.0)
    us = [u0] + [u for u in L.main if u0 < u < u1] + [u1]
    us = [lerp(a, b, t) for a, b in zip(us, us[1:]) for t in (0.0, 0.5)] + [us[-1]]
    cu = [p[0] for p in L.bot]
    cz = [p[1] for p in L.bot]

    def z_smooth(u):
        k = max(0, min(len(cu) - 2, max(i for i in range(len(cu)) if cu[i] <= u) if u >= cu[0] else 0))
        t = clamp((u - cu[k]) / (cu[k + 1] - cu[k]), 0.0, 1.0)
        p0 = cz[max(k - 1, 0)]
        p1, p2 = cz[k], cz[k + 1]
        p3 = cz[min(k + 2, len(cz) - 1)]
        return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
                      (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
    sm_at = lambda u, z, lift: L.at(u, z, lift, raw=False)
    grid = [[sm_at(u, z_smooth(u) + DF + dz, lf) for dz, lf in
             ((0.003, FL + 0.006), (0.015, FL + 0.006), (0.015, FL))] for u in us]
    # fair each rail (Laplacian, ends fixed): the nose's plan corner starts at x 0.72
    # and bends the offset surface there; this takes out the ~1 mm kink it leaves
    for j in range(3):
        rail = [grid[i][j][0].copy() for i in range(len(us))]
        for _ in range(6):
            rail = [rail[0]] + [p + ((a_ + b_) * 0.5 - p) * 0.5 for a_, p, b_ in
                                zip(rail, rail[1:], rail[2:])] + [rail[-1]]
        for i in range(len(us)):
            grid[i][j] = (rail[i], grid[i][j][1])
    gid = [[head.add_v(h[0]) for h in col] for col in grid]
    if os.environ.get('DRL_DEBUG'):
        for u, col in zip(us, grid):
            p = col[0][0]
            print(f"DRL u {u:.4f} zs {z_smooth(u):.4f} zb {L.z_bot(u):.4f} p {p.x:.4f} {p.y:.4f} {p.z:.4f}")
    for i in range(len(us) - 1):
        for j in range(2):
            q = [gid[i][j], gid[i + 1][j], gid[i + 1][j + 1], gid[i][j + 1]]
            want = grid[i][j][1] if j == 0 else grid[i][j][1] * 0.3 + Vector((0, 0, 1))
            add_face_oriented(head, q, 'light_head', want)
    # the indicator: the swept tip, 3 mm off the floor
    ui = L.C.u_of(77.5)
    cs = [c for c in range(n) if L.col(c, DF)[0] >= ui]
    grid = [[at(ui, lerp(L.z_bot(ui) + DF, L.z_top(ui) - DF, t), FL + 0.003) for t in (0.0, 1.0)]]
    for c in cs:
        ut, zt, ub, zb = L.col(c, DF)
        grid.append([at(ub, zb, FL + 0.003), at(ut, zt, FL + 0.003)])
    gid = [[ind.add_v(h[0]) for h in col] for col in grid]
    for i in range(len(grid) - 1):
        add_face_oriented(ind, [gid[i][0], gid[i + 1][0], gid[i + 1][1], gid[i][1]], 'light_indicator',
                          grid[i][0][1])
    outline3 = [h[0] for h in rings[0][1]]
    print(f"HEADLAMP {n} columns, loop {nl} points; u {L.u_ib:.3f}/{L.u_it:.3f} .. tip {L.uc + L.rt:.3f}; "
          f"projector at u {up:.3f} z {zp:.3f}")
    return head, ind, house, L, outline3


class NormalSource:
    """Smooth normals of the UNCUT shell (mirrored, 48 degree auto-sharp, weighted
    normals -- exactly what the body gets), for the skin that cut_skin retriangulates."""

    def __init__(self, mb):
        ob = to_object('nsrc_tmp', copy_mb(mb))
        add_mod_mirror(ob)
        ob.data.set_sharp_from_angle(angle=math.radians(48))
        add_mod_wn(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        cn = me.corner_normals
        self.V = [v.co.copy() for v in me.vertices]
        me.calc_loop_triangles()
        self.T = [tuple(t.vertices) for t in me.loop_triangles]
        # per-corner normals, so a vertex on a sharp crease has one normal per side
        self.TN = [tuple(cn[li].vector.copy() for li in t.loops) for t in me.loop_triangles]
        self.FN = [t.normal.copy() for t in me.loop_triangles]
        ev.to_mesh_clear()
        bpy.data.objects.remove(ob)
        self.bvh = BVHTree.FromPolygons(self.V, self.T, all_triangles=True)

    def at(self, p, hint=None):
        """The uncut surface's normal at p, on the side of any crease that faces `hint`."""
        p = Vector(p)
        loc, nrm, idx, dist = self.bvh.find_nearest(p)
        if hint is not None:
            near = self.bvh.find_nearest_range(p, dist + 2e-4)
            if near:
                idx = max(near, key=lambda h: abs(self.FN[h[2]].dot(hint)))[2]
                loc = p
        a, b, c = self.T[idx]
        w = barycentric_transform(loc, self.V[a], self.V[b], self.V[c],
                                  Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
        na, nb, nc = self.TN[idx]
        n = na * w.x + nb * w.y + nc * w.z
        n = n.normalized()
        if hint is not None and n.dot(hint) < 0:
            n = -n
        return n


def copy_mb(mb):
    out = MB()
    out.v, out.f, out.m = list(mb.v), list(mb.f), list(mb.m)
    return out


def _pt_in_poly(p, poly):
    x, y = p
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y):
            xi = x0 + (y - y0) * (x1 - x0) / (y1 - y0)
            if x < xi:
                inside = not inside
    return inside


def _segs_cross(a, b, c, d):
    from mathutils.geometry import intersect_line_line_2d
    return intersect_line_line_2d(Vector(a), Vector(b), Vector(c), Vector(d)) is not None


def cut_skin(mb, outline3, chart, facing, prior=()):
    """Knife the closed loop outline3 (points on the shell's facets) into the shell MB and
    drop everything inside it, so the hole's edge IS the loop.

    The faces the loop crosses or covers are split into triangles (quads along their 0-2
    diagonal, as Blender does); those triangles' edges and the loop are the constraints of
    a 2D constrained Delaunay triangulation in the chart, so the new triangles only
    SUBDIVIDE the old ones: the skin's shape, and every crease through the region, is
    unchanged.  Where the loop crosses an old edge the new vertex is placed on that edge.
    Returns the set of vertex ids of the rebuilt skin (their normals are carried over
    from the uncut surface, see obj_from), plus `prior` (an earlier cut's set) renumbered."""
    from mathutils.geometry import delaunay_2d_cdt
    V = [Vector(p) for p in mb.v]
    loop2 = [tuple(chart(p)) for p in outline3]
    # a loop point that IS a shell vertex (the loop running along one of the shell's own
    # rows) takes that vertex's exact chart position, so the triangulation merges them
    # instead of leaving a sliver between two almost-equal points
    snap = BVHTree.FromPolygons(V, [f for f in mb.f], all_triangles=False)
    n_snap = 0
    for k, p in enumerate(outline3):
        _, _, idx, _ = snap.find_nearest(Vector(p))
        if idx is None:
            continue
        best = min(mb.f[idx], key=lambda i: (V[i] - Vector(p)).length)
        if (V[best] - Vector(p)).length < 2e-6:
            loop2[k] = tuple(chart(V[best]))
            n_snap += 1
    lx = [p[0] for p in loop2]
    lz = [p[1] for p in loop2]
    box = (min(lx) - 0.15, max(lx) + 0.15, min(lz) - 0.15, max(lz) + 0.15)
    lo3 = Vector(map(min, *outline3)) - Vector((0.2, 0.2, 0.2))
    hi3 = Vector(map(max, *outline3)) + Vector((0.2, 0.2, 0.2))

    def fnormal(f):
        pts = [V[i] for i in f]
        n = Vector()
        for k in range(len(pts)):
            n += pts[k].cross(pts[(k + 1) % len(pts)])
        return n.normalized() if n.length > 1e-12 else n
    cand = {}
    for fi, f in enumerate(mb.f):
        pts = [V[i] for i in f]
        cen = sum(pts, Vector()) / len(pts)
        if not all(lo3[k] <= cen[k] <= hi3[k] for k in range(3)):
            continue
        if not facing(fnormal(f), cen):
            continue
        poly = [tuple(chart(p)) for p in pts]
        if max(p[0] for p in poly) < box[0] or min(p[0] for p in poly) > box[1] or \
                max(p[1] for p in poly) < box[2] or min(p[1] for p in poly) > box[3]:
            continue
        cand[fi] = poly
    region = set()
    L = len(loop2)
    for fi, poly in cand.items():
        m = len(poly)
        if any(_pt_in_poly(p, loop2) for p in poly) or any(_pt_in_poly(p, poly) for p in loop2) or \
                any(_segs_cross(poly[a], poly[(a + 1) % m], loop2[b], loop2[(b + 1) % L])
                    for a in range(m) for b in range(L)):
            region.add(fi)
    # the region as triangles, as they are drawn
    tris = []                     # (vertex ids, owner face)
    for fi in region:
        f = mb.f[fi]
        if len(f) == 3:
            tris.append((f, fi))
        else:
            for k in range(1, len(f) - 1):
                tris.append(((f[0], f[k], f[k + 1]), fi))
    rverts = sorted(set(i for t, _ in tris for i in t))
    rindex = {v: k for k, v in enumerate(rverts)}
    shell_edges = sorted(set(tuple(sorted((rindex[t[k]], rindex[t[(k + 1) % 3]])))
                             for t, _ in tris for k in range(3)))
    nr = len(rverts)
    coords = [Vector(tuple(chart(V[i]))) for i in rverts] + [Vector(p) for p in loop2]
    edges = shell_edges + [(nr + k, nr + (k + 1) % L) for k in range(L)]
    out = delaunay_2d_cdt(coords, edges, [], 0, 1e-7, True)
    vco, faces, orig = out[0], out[2], out[3]
    tri2 = [([coords[rindex[i]] for i in t], fi) for t, fi in tris]
    new_ids = {}

    def vid(i):
        if i in new_ids:
            return new_ids[i]
        src = orig[i]
        if src and src[0] < nr:
            new_ids[i] = rverts[src[0]]
        elif src:
            new_ids[i] = len(mb.v)
            mb.v.append(tuple(outline3[src[0] - nr]))
        else:
            # the loop crossing an old edge: put the point on that edge
            q = vco[i]
            best = None
            for a, b in shell_edges:
                pa, pb = coords[a], coords[b]
                ab = pb - pa
                t = clamp((q - pa).dot(ab) / max(1e-18, ab.dot(ab)), 0.0, 1.0)
                dd = (pa + ab * t - q).length
                if best is None or dd < best[0]:
                    best = (dd, a, b, t)
            _, a, b, t = best
            new_ids[i] = len(mb.v)
            mb.v.append(tuple(V[rverts[a]].lerp(V[rverts[b]], t)))
        return new_ids[i]
    new_f, new_m = [], []
    for tri in faces:
        c2 = sum((vco[i] for i in tri), Vector((0.0, 0.0))) / 3
        if _pt_in_poly(tuple(c2), loop2):
            continue
        owner = None
        for pts2, fi in tri2:
            if mathutils.geometry.intersect_point_tri_2d(c2, *pts2):
                owner = fi
                break
        if owner is None:
            continue
        ids = [vid(i) for i in tri]
        pts = [Vector(mb.v[i]) for i in ids]
        tn = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if tn.length < 1e-12:
            continue
        if tn.dot(fnormal(mb.f[owner])) < 0:
            ids.reverse()
        new_f.append(tuple(ids))
        new_m.append(mb.m[owner])
    keep = set(i for f in new_f for i in f)
    kept = [(f, m) for fi, (f, m) in enumerate(zip(mb.f, mb.m)) if fi not in region]
    mb.f = [f for f, _ in kept] + new_f
    mb.m = [m for _, m in kept] + new_m
    # drop the vertices left inside the hole, renumbering the rest
    used = sorted(set(i for f in mb.f for i in f))
    remap = {v: k for k, v in enumerate(used)}
    mb.v = [mb.v[i] for i in used]
    mb.f = [tuple(remap[i] for i in f) for f in mb.f]
    keep = set(remap[i] for i in keep) | set(remap[i] for i in prior if i in remap)
    n_loop = len(set(s for i in range(len(vco)) for s in (orig[i] or []) if s >= nr))
    n_x = sum(1 for i in new_ids if not orig[i])
    print(f"CUT SKIN: knifed {len(region)} faces into {len(new_f)} triangles; {n_loop}/{L} loop points "
          f"({n_snap} on shell vertices), {n_x} edge crossings")
    assert n_loop == L, "every loop point must be on the new skin"
    return keep


def build_fuel_flap(P, asym):
    """Round-cornered fuel flap over the left rear arch, in the blue of the livery it
    sits in (3 mm over the livery), with a dark shut line round it."""
    yc, zc, hw, hh = -1.36, 0.838, 0.060, 0.040
    fl = lambda a, b, l: P.side(a, b, l, -1)
    rows = [[(yc - hw + 2 * hw * k / 4, zc + hh * t, L_TXT) for t in (-1, 0, 1)] for k in range(5)]
    ids, hits = proj_grid(asym, rows, fl, 'paint_blue')
    grid_rim(asym, rows, fl, ids, hits, 'dark_trim', base_lift=0.0)


def build_rear_window_rubber(P, sym, glass_mb):
    """A 12 mm rubber surround round each rear-door window (it also rounds the glass's
    corners), so the glazing reads at chase distance."""
    V = [Vector(p) for p in glass_mb.v]
    xs, zs = [], []
    for f in glass_mb.f:
        pts = [V[i] for i in f]
        nn = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if nn.length > 0 and abs(nn.normalized().y) > 0.8 and pts[0].y < -1.5:
            xs += [p.x for p in pts]
            zs += [p.z for p in pts]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    print(f"REAR WINDOW x {x0:.3f}..{x1:.3f} z {z0:.3f}..{z1:.3f}")
    cxw, czw = (x0 + x1) / 2, (z0 + z1) / 2
    outer = rrect(cxw, czw, (x1 - x0) + 0.008, (z1 - z0) + 0.008, 0.034)
    inner = rrect(cxw, czw, (x1 - x0) - 0.016, (z1 - z0) - 0.016, 0.022)
    rows = [[(x, z, 0.003) for x, z in outer + outer[:1]], [(x, z, 0.003) for x, z in inner + inner[:1]]]
    proj_grid(sym, rows, lambda a, b, l: P.rear(a, b, l), 'rubber')


class RayChart:
    """A cylindrical chart on the shell: rays leave a vertical axis through O at angle phi
    in the horizontal plane (dirfn(phi) -> unit direction) and hit the skin from inside.
    u is the arc length along the skin at height zref, so (u, z) are metres on the
    surface; at(u, z, lift) is the skin point there (lift > 0 is outward)."""

    def __init__(self, P, O, dirfn, zref, ph0, ph1, step=0.5):
        self.P, self.O, self.dirfn = P, Vector(O), dirfn
        n = int(round((ph1 - ph0) / step))
        self.ph = [ph0 + step * k for k in range(n + 1)]
        pts = [self.fn(p, zref, 0.0)[0] for p in self.ph]
        self.us = [0.0]
        for a, b in zip(pts, pts[1:]):
            self.us.append(self.us[-1] + (b - a).length)

    def fn(self, phi, z, lift=0.0, raw=False):
        return self.P.cast((self.O.x, self.O.y, z), self.dirfn(phi), lift, inside=True, raw=raw)

    @staticmethod
    def _interp(xs, ys, x):
        if x <= xs[0]:
            return ys[0] + (x - xs[0]) * (ys[1] - ys[0]) / (xs[1] - xs[0])
        for (x0, y0), (x1, y1) in zip(zip(xs, ys), zip(xs[1:], ys[1:])):
            if x0 <= x <= x1:
                return lerp(y0, y1, (x - x0) / max(1e-12, x1 - x0))
        return ys[-1] + (x - xs[-1]) * (ys[-1] - ys[-2]) / (xs[-1] - xs[-2])

    def u_of(self, phi):
        return self._interp(self.ph, self.us, phi)

    def phi_of(self, u):
        return self._interp(self.us, self.ph, u)

    def at(self, u, z, lift=0.0, raw=False):
        return self.fn(self.phi_of(u), z, lift, raw)


def tail_chart(P):
    return RayChart(P, (0.70, -2.00, 0.0),
                    lambda ph: Vector((math.sin(math.radians(ph)), -math.cos(math.radians(ph)), 0.0)),
                    0.85, 20.0, 100.0)


# the rear clusters: one flush lens from z 0.615 to 1.085, split into four zones by 3 mm
# chrome divider strips (the Nightjar's bright-lip trick).  (zone, z0, z1), bottom to top.
TL_DIV = 0.0015                       # half width of a divider strip
TL_DIVZ = (0.7508, 0.86, 0.957)       # divider centre lines (the first two are the shell's own
                                      # rows round the corner, so the beads sit on its folds)
TAIL_ZONES = (('light_brake', 0.615, TL_DIVZ[0] - TL_DIV),
              ('light_reverse', TL_DIVZ[0] + TL_DIV, TL_DIVZ[1] - TL_DIV),
              ('light_indicator', TL_DIVZ[1] + TL_DIV, TL_DIVZ[2] - TL_DIV),
              ('light_tail', TL_DIVZ[2] + TL_DIV, 1.085))
# unlit, every zone is glass: smoked red, clear (over the reverse reflector), dark amber
TL_ZONE_MAT = {'light_brake': 'lens_red', 'light_reverse': 'lens', 'light_indicator': 'light_indicator',
               'light_tail': 'lens_red'}
TL_LENS, TL_CROWN, TL_GAP = 0.0025, 0.0033, 0.0003
TL_BAR_Z = 0.721                      # the brake bar: between the swage ridge and the divider


def tail_fold_phis(C, secs, metas, z, ph0, ph1):
    """Where the shell's own fold lines (its station lines round the rear corner) cross
    height z, as chart angles between ph0 and ph1."""
    out = []
    for sec, m in zip(secs, metas):
        if not (m['kind'] == 'rear' or (m['kind'] == 'side' and m['y'] < -1.95)):
            continue
        side = sec[J_T2:]
        for a, b in zip(side, side[1:]):
            if min(a.z, b.z) <= z <= max(a.z, b.z) and abs(a.z - b.z) > 1e-9:
                q = a.lerp(b, (z - a.z) / (b.z - a.z))
                ph = math.degrees(math.atan2(q.x - C.O.x, -(q.y - C.O.y)))
                if ph0 + 1.0 < ph < ph1 - 1.0:
                    out.append(ph)
                break
    return sorted(out)


def light_guide(C, path, mat, half=0.005, h=0.005, caps=True):
    """A light bar standing on the lens: a 3-sided section `half`*2 wide and `h` tall
    swept along a (u, z) path, every point placed off the shell's facets (so it rides
    the lens at a constant height), with end caps.  Each face is oriented explicitly:
    the two side walls away from the bar's centre line, the face along the surface
    normal (orienting the walls by the surface normal, which they are square to, let
    a few of them flip and showed as jogs)."""
    # drop path points closer than 3 mm to their neighbour (a lens column that falls
    # right beside an end point made a sub-millimetre span)
    pts = [path[0]]
    for p in path[1:]:
        if math.hypot(p[0] - pts[-1][0], p[1] - pts[-1][1]) > 0.003:
            pts.append(p)
    if math.hypot(path[-1][0] - pts[-1][0], path[-1][1] - pts[-1][1]) > 1e-9:
        pts[-1] = path[-1]
    path = pts
    mb = MB()
    hits = []
    for k, (u, z) in enumerate(path):
        pa = path[max(k - 1, 0)]
        pb = path[min(k + 1, len(path) - 1)]
        t = Vector((pb[0] - pa[0], pb[1] - pa[1])).normalized()
        nn = Vector((-t.y, t.x))
        hits.append([C.at(u + nn.x * o, z + nn.y * o, TL_LENS + hh, raw=True)
                     for o, hh in ((half, 0.0003), (half, h), (-half, h), (-half, 0.0003))])
    ids = [[mb.add_v(hh[0]) for hh in row] for row in hits]
    for i in range(len(path) - 1):
        a0, a3 = hits[i][0][0], hits[i][3][0]
        for j in range(3):
            q = [ids[i][j], ids[i + 1][j], ids[i + 1][j + 1], ids[i][j + 1]]
            want = (a0 - a3) if j == 0 else (a3 - a0) if j == 2 else hits[i][1][1] + hits[i + 1][2][1]
            add_face_oriented(mb, q, mat, want)
    if caps:
        for k, sgn in ((0, -1), (len(path) - 1, 1)):
            a = hits[max(k - 1, 0)][1][0]
            b = hits[min(k + 1, len(path) - 1)][1][0]
            add_face_oriented(mb, list(ids[k]), mat, (b - a) * sgn)
    return mb


def build_taillights(P, secs, metas):
    """Vertical rear clusters wrapping the D pillars.  Each is ONE continuous lens surface
    2.5 mm off the skin (flush within 3 mm), ringed by a 5 mm dark shut gap, its zones
    split by 3 mm chrome divider beads.  Every column runs exactly along one of the
    shell's own fold lines round the corner and every point sits on the shell's flat
    facets, so the lens is a true 2.5 mm offset of the skin.

    Unlit it is dark glass: deep smoked red, dark amber, and a clear window over the
    reverse lamp.  The only bright shapes are light guides standing on the lens: the C
    on the top (tail) zone and a slim brake bar on the bottom one.  The reverse lamp is
    real depth: the skin is cut out behind its clear lens (see cut_skin) and a chrome
    reflector folded into four facets (alternately facing the sky and the road) sits
    8-20 mm down in a black housing, with a white LED bar on its middle ridge.
    Returns ({zone: MB}, body MB, hole outline, chart)."""
    C = tail_chart(P)
    gap = 0.005
    PH0, PH1 = 27.5, 93.5
    u0, u1 = C.u_of(PH0), C.u_of(PH1)
    nf = len(tail_fold_phis(C, secs, metas, 0.85, PH0, PH1))

    def colphis(z):
        """The column angles at height z: gap, edge, the shell's folds, edge, gap."""
        f = tail_fold_phis(C, secs, metas, z, PH0, PH1)
        assert len(f) == nf, (z, f)
        return [C.phi_of(u0 - gap), PH0] + f + [PH1, C.phi_of(u1 + gap)]
    at = lambda phi, z, lift: C.fn(phi, z, lift, raw=True)
    # rows: the gap, the zones and the divider beads (edge, crown, edge); 0.692 is the
    # swage ridge, so the lens follows the body's own line through it
    rows = [(0.615 - gap, 'g'), (0.615, 'l'), (0.692, 'l')]
    for (_, _, z1), (_, z0n, _) in zip(TAIL_ZONES, TAIL_ZONES[1:]):
        rows += [(z1, 'l'), ((z1 + z0n) / 2, 'f'), (z0n, 'l')]
    rows += [(1.085, 'l'), (1.085 + gap, 'g')]
    zs = [z for z, _ in rows]

    def zone_of(zm):
        for name, z0, z1 in TAIL_ZONES:
            if z0 <= zm <= z1:
                return name
        return None
    PHI = [colphis(z) for z in zs]                     # [row][column]
    cols = PHI[0]
    ncol = len(cols)
    lift = lambda i, j: TL_GAP if (i in (0, ncol - 1) or rows[j][1] == 'g') else \
        TL_CROWN if rows[j][1] == 'f' else TL_LENS
    H = [[at(PHI[j][i], z, lift(i, j)) for j, z in enumerate(zs)] for i in range(ncol)]
    parts = {name: MB() for name, _, _ in TAIL_ZONES}
    house = MB()
    vid = {}

    def vert(mb, i, j):
        key = (id(mb), i, j)
        if key not in vid:
            vid[key] = mb.add_v(H[i][j][0])
        return vid[key]
    for i in range(ncol - 1):
        for j in range(len(zs) - 1):
            zone = zone_of((zs[j] + zs[j + 1]) / 2)
            if i in (0, ncol - 2) or 'g' in (rows[j][1], rows[j + 1][1]):
                mat, mb = 'dark_trim', house          # the shut gap round the lens
            elif zone is None:
                mat, mb = 'chrome', house             # a divider bead
            else:
                mat, mb = TL_ZONE_MAT[zone], parts[zone]
            q = [vert(mb, i, j), vert(mb, i + 1, j), vert(mb, i + 1, j + 1), vert(mb, i, j + 1)]
            add_face_oriented(mb, q, mat, H[i][j][1] + H[i + 1][j + 1][1])

    # ---- the reverse lamp's housing, behind its clear lens.  The hole in the skin runs
    #      along the two divider centre lines and the lens's side edges; its walls drop
    #      8 mm, and the reflector between them is folded into four facets.
    fold_at = lambda i, z: colphis(z)[i]
    lens_cols = list(range(1, ncol - 1))

    def shell_row(zn):
        zz = [p.z for s, m in zip(secs, metas) if m['kind'] == 'rear' for p in s[J_T2:]]
        return min(zz, key=lambda z: abs(z - zn))
    zd0, zd1 = shell_row(TL_DIVZ[0]), shell_row(TL_DIVZ[1])
    assert abs(zd0 - TL_DIVZ[0]) < 2e-4 and abs(zd1 - TL_DIVZ[1]) < 2e-4, (zd0, zd1)
    zr = [zd0 + 0.001 + (zd1 - zd0 - 0.002) * k / 4 for k in range(5)]
    dr = [-0.008, -0.020, -0.008, -0.020, -0.008]
    prof = [(zd0, 0.0)] + list(zip(zr, dr)) + [(zd1, 0.0)]
    rev = parts['light_reverse']
    G = [[at(fold_at(i, z), z, d) for z, d in prof] for i in lens_cols]
    gid_h = [[house.add_v(p) for p, _ in col] for col in G]
    gid_r = [[rev.add_v(p) for p, _ in col] for col in G]
    last = len(prof) - 2
    for c in range(len(G) - 1):
        for k in range(len(prof) - 1):
            nrm = G[c][k][1] + G[c + 1][k + 1][1]
            if k == 0 or k == last:
                gi, mb, mat = gid_h, house, 'rubber'
                nrm = Vector((0, 0, 1 if k == 0 else -1))
            else:
                gi, mb, mat = gid_r, rev, 'chrome'
            add_face_oriented(mb, [gi[c][k], gi[c + 1][k], gi[c + 1][k + 1], gi[c][k + 1]], mat, nrm)
    zmid = (zd0 + zd1) / 2
    for c, inward in ((0, 1), (len(G) - 1, -1)):
        tang = G[c + inward][3][0] - G[c][3][0]
        ci = house.add_v(at(fold_at(lens_cols[c], zmid), zmid, 0.0)[0])
        for k in range(len(prof) - 1):
            add_face_oriented(house, [gid_h[c][k], gid_h[c][k + 1], ci], 'rubber', tang)
    # the white LED bar on the middle ridge, 2 mm above it
    led = [[at(fold_at(i, z), z, dr[2] + 0.002) for z in (zr[2] - 0.004, zr[2] + 0.004)]
           for i in lens_cols]
    lid = [[rev.add_v(p) for p, _ in col] for col in led]
    for c in range(len(led) - 1):
        add_face_oriented(rev, [lid[c][0], lid[c + 1][0], lid[c + 1][1], lid[c][1]], 'light_reverse',
                          led[c][0][1] + led[c + 1][1][1])
    hole = ([at(fold_at(i, zd0), zd0, 0.0)[0] for i in lens_cols] +
            [at(fold_at(i, zd1), zd1, 0.0)[0] for i in reversed(lens_cols)])

    # ---- the C guide on the tail zone: a light bar 10 mm wide standing 5 mm off the
    #      lens, sampled at every lens column along its arms (and every 22.5 degrees round
    #      its bend), so it rides the lens at a constant height instead of dipping under it
    _, bz0, bz1 = TAIL_ZONES[3]
    zt, zb = bz1 - 0.028, bz0 + 0.028
    zmid_c, rb = (zt + zb) / 2, (zt - zb) / 2
    ua, ub = C.u_of(36.0), u1 - 0.016 - rb - 0.005
    arm_t = [ua] + [C.u_of(p) for p in colphis(zt) if ua < C.u_of(p) < ub] + [ub]
    arm_b = [ua] + [C.u_of(p) for p in colphis(zb) if ua < C.u_of(p) < ub] + [ub]
    path = [(u, zt) for u in arm_t]
    path += [(ub + rb * math.cos(math.radians(a)), zmid_c + rb * math.sin(math.radians(a)))
             for a in (67.5, 45, 22.5, 0, -22.5, -45, -67.5)]
    path += [(u, zb) for u in reversed(arm_b)]
    parts['light_tail'].extend(light_guide(C, path, 'light_red'))
    # ---- the brake bar: one slim bar (8 mm) across the bottom zone, as long as the C
    bar = [(u, TL_BAR_Z) for u in [ua] + [C.u_of(p) for p in colphis(TL_BAR_Z)
                                          if ua < C.u_of(p) < ub + rb] + [ub + rb]]
    parts['light_brake'].extend(light_guide(C, bar, 'light_red', half=0.004))
    print(f"TAIL LAMP u {u0:.3f}..{u1:.3f} ({u1 - u0:.3f} m round the corner), {nf} fold columns "
          f"{[round(p, 1) for p in colphis(0.85)]}, C path {len(path)} samples, bar {len(bar)}")
    return parts, house, hole, C


def rrect(cx, cz, w, h, r, per=4):
    """Rounded rectangle in the (x, z) plane, counter-clockwise, `per` points a corner."""
    pts = []
    for (sx, sz, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oz = cx + sx * (w / 2 - r), cz + sz * (h / 2 - r)
        for k in range(per):
            a = math.radians(a0 + 90 * k / (per - 1))
            pts.append((ox + r * math.cos(a), oz + r * math.sin(a)))
    return pts


def round_rect_ring(hw, hh, r, per=7):
    """Rounded rectangle, counter-clockwise from the +x edge's top end: only the four
    corners are rounded (`per` points each, so per-1 segments), the edges are straight."""
    pts = []
    for (sx, sz, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oz = sx * (hw - r), sz * (hh - r)
        for k in range(per):
            a = math.radians(a0 + 90 * k / (per - 1))
            pts.append((ox + r * math.cos(a), oz + r * math.sin(a)))
    return pts


# the mirror housing is a D in section: a flat glass face and a back shell that rolls
# forward round a superellipse (exponent 2.6) to a flat-ish nose 0.09 m ahead of the
# glass.  (theta on the profile, sampled where its curvature needs it)
MIRROR_D = 0.090
MIRROR_TH = (0.0, 20.0, 40.0, 55.0, 70.0)


def mirror_prof(th):
    """(depth forward of the glass, size scale) at profile angle th (degrees)."""
    e = 2.0 / 2.6
    t = math.radians(th)
    return MIRROR_D * math.sin(t) ** e, math.cos(t) ** e


def build_mirror(P, sym, ind_r, secs, metas):
    """Right door mirror, modern compact-van style: a dark window sail, a short thick
    aerofoil stalk growing out of it, and a D-section housing 0.20 m wide x 0.30 m tall
    x 0.09 m deep, only its four corners rounded (50 mm, 6 segments each).  2.42 m over
    the mirrors (0.19 m past the 2.04 m body a side).  The glass sits 10 mm deep inside
    a 12 mm rim; the repeater is a 12 mm amber strip wrapping the housing's
    forward-outboard edge."""
    side = lambda y, z, l: P.side(y, z, l)
    # ---- sail: the black triangle that fills the front lower corner of the side window,
    #      full height at the A-pillar, running back along the belt to a point, with a
    #      concave top edge; 5 mm proud, its edge wall sunk into the skin
    y0, y1 = 1.525, 1.757
    belt = lambda y: row_z(secs, metas, 'belt_top', y)
    h1 = row_z(secs, metas, 'rail', y1) - belt(y1) + 0.004
    rows = []
    for k in range(6):
        u = k / 5
        y = lerp(y0, y1, u)
        zb_, zt_ = belt(y) - 0.008, belt(y) + h1 * u ** 1.5
        rows.append([(y, lerp(zb_, zt_, t), 0.005) for t in (0.0, 0.5, 1.0)])
    ids, hits = proj_grid(sym, rows, side, 'dark_trim')
    grid_rim(sym, rows, side, ids, hits, 'dark_trim', base_lift=-0.002)
    # ---- housing
    cx, cz, HW, HH, RC = 1.110, 1.195, 0.100, 0.150, 0.050
    yb = 1.552                                  # the glass face
    base = round_rect_ring(HW, HH, RC)
    NS = len(base)
    hb = MB()
    centre_in = Vector((cx - 0.02, yb + 0.03, cz))
    dx_of = lambda d: -0.010 * (d / MIRROR_D) ** 2      # the nose leans a touch inboard
    rings = []
    for th in MIRROR_TH:
        d, s = mirror_prof(th)
        rings.append([Vector((cx + dx_of(d) + x * s, yb + d, cz + z * s)) for x, z in base])
    ring_ids = [[hb.add_v(p) for p in r] for r in rings]
    for k in range(len(rings) - 1):
        for i in range(NS):
            i2 = (i + 1) % NS
            q = [ring_ids[k][i], ring_ids[k][i2], ring_ids[k + 1][i2], ring_ids[k + 1][i]]
            fc = sum((Vector(hb.v[x]) for x in q), Vector()) / 4
            add_face_oriented(hb, q, 'dark_trim', fc - centre_in)
    tip = hb.add_v((cx + dx_of(MIRROR_D), yb + MIRROR_D, cz))
    for i in range(NS):
        add_face_oriented(hb, [ring_ids[-1][i], ring_ids[-1][(i + 1) % NS], tip], 'dark_trim', (0, 1, 0))
    # the back: a 12 mm rim facing the driver, a 10 mm deep recess wall, the glass
    inner = round_rect_ring(HW - 0.012, HH - 0.012, RC - 0.012)
    rim_in = [hb.add_v((cx + x, yb, cz + z)) for x, z in inner]
    deep = [hb.add_v((cx + x, yb + 0.010, cz + z)) for x, z in inner]
    for i in range(NS):
        i2 = (i + 1) % NS
        add_face_oriented(hb, [ring_ids[0][i], ring_ids[0][i2], rim_in[i2], rim_in[i]], 'dark_trim', (0, -1, 0))
        q = [rim_in[i], rim_in[i2], deep[i2], deep[i]]
        fc = sum((Vector(hb.v[x]) for x in q), Vector()) / 4
        add_face_oriented(hb, q, 'dark_trim', Vector((cx, fc.y, cz)) - fc)
    gc = hb.add_v((cx, yb + 0.010, cz))
    for i in range(NS):
        add_face_oriented(hb, [deep[i], deep[(i + 1) % NS], gc], 'chrome', (0, -1, 0))
    sym.extend(hb)
    # ---- repeater: a 12 mm amber strip wrapping the forward-outboard edge (the ring at
    #      theta 55), 6 mm onto the side and 6 mm onto the nose, along the outboard
    #      straight edge; its columns lie on the housing's own facets, 1.2 mm off them
    k0, k1, k2 = 2, 3, 4                              # rings at 40, 55, 70 degrees
    top_i, bot_i = 0, NS - 1                          # the outboard edge's two ends

    def on_edge(k, f):
        """Point on ring k's outboard straight edge, f = 0 (bottom) .. 1 (top)."""
        return rings[k][bot_i].lerp(rings[k][top_i], f)
    ta = 0.006 / (on_edge(k1, 0.5) - on_edge(k0, 0.5)).length
    tb = 0.006 / (on_edge(k2, 0.5) - on_edge(k1, 0.5)).length
    n_a = (on_edge(k1, 1) - on_edge(k1, 0)).cross(on_edge(k0, 0.5) - on_edge(k1, 0.5)).normalized()
    n_b = (on_edge(k1, 1) - on_edge(k1, 0)).cross(on_edge(k1, 0.5) - on_edge(k2, 0.5)).normalized()
    if n_a.x < 0:
        n_a = -n_a
    if n_b.x < 0:
        n_b = -n_b
    rep = MB()
    cols = []
    for f in (0.20, 0.62):
        pa = on_edge(k1, f).lerp(on_edge(k0, f), ta) + n_a * 0.0012
        pm = on_edge(k1, f) + (n_a + n_b).normalized() * 0.0012
        pb = on_edge(k1, f).lerp(on_edge(k2, f), tb) + n_b * 0.0012
        cols.append([rep.add_v(p) for p in (pa, pm, pb)])
    for j, nn in ((0, n_a), (1, n_b)):
        add_face_oriented(rep, [cols[0][j], cols[0][j + 1], cols[1][j + 1], cols[1][j]], 'light_indicator', nn)
    ind_r.extend(rep)
    # ---- stalk: a short, thick aerofoil section from the sail into the housing's inboard
    #      lower corner (its root sunk 4 mm into the sail)
    hit = P.side(1.668, 1.000, 0.0)
    root = hit[0] - hit[1] * 0.004
    end = Vector((cx - HW + 0.030, yb + 0.050, cz - HH + 0.070))
    mid = root.lerp(end, 0.5) + Vector((0.0, 0.0, 0.012))
    ax = (end - root).normalized()
    sec2 = [(0.044 * math.cos(2 * math.pi * k / 8), 0.030 * math.sin(2 * math.pi * k / 8)) for k in range(8)]
    st = MB()
    rows = []
    for c, w in ((root, 1.12), (mid, 1.0), (end, 0.92)):
        e1 = Vector((0, 1, 0))
        e2 = ax.cross(e1).normalized()
        e1 = e2.cross(ax).normalized()
        rows.append([c + e1 * (a_ * w) + e2 * (b_ * w) for a_, b_ in sec2])
    ids = st.grid(rows, 'dark_trim', closed_v=True)
    for fk in range(len(st.f)):
        f = st.f[fk]
        pp = [Vector(st.v[i]) for i in f]
        fc = sum(pp, Vector()) / 4
        core = root + ax * (fc - root).dot(ax)
        nn = (pp[1] - pp[0]).cross(pp[2] - pp[0]) + (pp[2] - pp[0]).cross(pp[3] - pp[0])
        if nn.dot(fc - core) < 0:
            st.f[fk] = tuple(reversed(f))
    sym.extend(st)
    print(f"MIRROR housing x {cx - HW:.3f}..{cx + HW:.3f} z {cz - HH:.3f}..{cz + HH:.3f} y {yb:.3f}..{yb + MIRROR_D:.3f}"
          f"  stalk root {tuple(round(c, 3) for c in root)}")


def build_handles(P, sym, asym):
    for y in (0.70, 0.345):
        h = P.side(y, 1.03, 0.0)
        c = h[0] + h[1] * 0.012
        ob = bevel_box_object('handle', (0.03, 0.18, 0.042), tuple(c), 'dark_trim', 0.011, 1)
        sym.extend(object_to_mb(ob))
        # pocket behind the handle
        rows = [[(y + dy, z, 0.002) for z in (1.005, 1.055)] for dy in (-0.075, -0.025, 0.025, 0.075)]
        proj_grid(sym, rows, lambda a, b, l: P.side(a, b, l), 'rubber')
    h = P.rear(0.11, 1.02, 0.0)
    c = h[0] + h[1] * 0.012
    ob = bevel_box_object('handle_r', (0.16, 0.03, 0.042), tuple(c), 'dark_trim', 0.011, 1)
    asym.extend(object_to_mb(ob))
    # rear door hinges
    for z in (0.66, 1.42):
        h = P.rear(0.790, z, 0.0)         # straddling the door's outer shut line, clear of the lamp
        c = h[0] + h[1] * 0.012
        sym.extend(box_mb((0.04, 0.026, 0.11), tuple(c), 'dark_trim'))


def build_interior(sym, asym):
    I = 'dark_trim'          # the cab's plastics and trim
    # cab floor, door cards, bulkhead (both faces), cargo liner
    sym.extend(box_mb((0.93, 1.20, 0.02), (0.465, 1.05, 0.615), I, skip=('-x',)))
    for (sz, c, keep) in (((0.012, 1.14, 0.50), (0.94, 1.07, 0.87), '-x'),):
        sym.extend(box_mb(sz, c, I))
    sym.extend(box_mb((0.93, 0.03, 1.36), (0.465, 0.44, 1.04), I, skip=('-x',)))
    # cargo box (inward-facing): floor, ceiling, wall
    cargo = MB()
    xs, y0, y1, z0, z1 = 0.93, -2.12, 0.42, 0.42, 1.735
    for quad in (((0, y0, z0), (xs, y0, z0), (xs, y1, z0), (0, y1, z0)),
                 ((0, y0, z1), (0, y1, z1), (xs, y1, z1), (xs, y0, z1)),
                 ((xs, y0, z0), (xs, y0, z1), (xs, y1, z1), (xs, y1, z0))):
        cargo.add_f([cargo.add_v(p) for p in quad], I)
    # make them face into the box
    for fk in range(len(cargo.f)):
        f = cargo.f[fk]
        pts = [Vector(cargo.v[i]) for i in f]
        fc = sum(pts, Vector()) / 4
        n_ = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if n_.dot(Vector((0.0, (y0 + y1) / 2, (z0 + z1) / 2)) - fc) < 0:
            cargo.f[fk] = tuple(reversed(f))
    sym.extend(cargo)
    # dashboard: an extruded section across the cab
    sec = [(1.28, 0.64), (1.74, 0.64), (1.74, 1.075), (1.62, 1.115), (1.45, 1.175),
           (1.33, 1.172), (1.285, 1.12), (1.265, 0.96)]
    sym.extend(prism_mb(sec, 0.0, 0.935, I, axis='X', caps=(False, True)))
    # seats (passenger; the mirror makes the driver's).  The backs recline 12 degrees
    # (top toward the bulkhead, 20 mm clear of it) and carry 20 mm side bolsters; back
    # and cushion each have a sea-blue fabric insert, inset ~30 mm and 4 mm proud.
    RB = Matrix.Translation(Vector((0.46, 0.600, 1.300))) @ Matrix.Rotation(math.radians(12), 4, 'X')
    RC_ = Matrix.Translation(Vector((0.46, 0.860, 0.955))) @ Matrix.Rotation(math.radians(4), 4, 'X')
    for (name, size, M, c) in (('cushion', (0.50, 0.50, 0.12), RC_, (0, 0, 0)),
                               ('back', (0.49, 0.12, 0.64), RB, (0, 0, 0)),
                               ('headrest', (0.27, 0.10, 0.19), RB, (0, -0.012, 0.425))):
        ob = bevel_box_object('seat_' + name, size, (0, 0, 0), I, 0.035, 1)
        sym.extend(xform_mb(object_to_mb(ob), M @ Matrix.Translation(Vector(c))))
    sym.extend(box_mb((0.40, 0.40, 0.33), (0.46, 0.84, 0.76), I, skip=('+z',)))       # pedestal
    for sx in (-1, 1):                                                                  # bolsters
        trap = [(sx * 0.188, 0.050), (sx * 0.243, 0.050), (sx * 0.235, 0.080), (sx * 0.200, 0.080)]
        sym.extend(xform_mb(prism_mb(trap, -0.285, 0.265, I, axis='Z'), RB))
    sym.extend(xform_mb(box_mb((0.31, 0.010, 0.52), (0.0, 0.059, -0.01), 'paint_blue', skip=('-y',)), RB))
    sym.extend(xform_mb(box_mb((0.43, 0.36, 0.010), (0.0, 0.05, 0.059), 'paint_blue', skip=('-z',)), RC_))
    # interior mirror, dead centre at the top of the windscreen, on a short stem
    rr = [(x, z) for x, z in rrect(0.0, 0.0, 0.24, 0.066, 0.024, per=3)]
    im = MB()
    back_ = [im.add_v((x, 1.105, 1.570 + z)) for x, z in rr]
    face_ = [im.add_v((x, 1.075, 1.570 + z)) for x, z in rr]
    for k in range(len(rr)):
        k2 = (k + 1) % len(rr)
        add_face_oriented(im, [back_[k], back_[k2], face_[k2], face_[k]], I, (rr[k][0] + rr[k2][0], 0, rr[k][1] + rr[k2][1]))
    cap_fan(im, back_, I)
    cap_fan(im, face_, 'chrome')
    for k in range(len(im.f) - 2 * len(rr), len(im.f)):
        f = im.f[k]
        pp = [Vector(im.v[i]) for i in f]
        want = 1 if k < len(im.f) - len(rr) else -1
        if (pp[1] - pp[0]).cross(pp[2] - pp[0]).y * want < 0:
            im.f[k] = tuple(reversed(f))
    asym.extend(im)
    asym.extend(cyl_mb((0.0, 1.096, 1.598), (0.0, 1.072, 1.640), 0.010, 6, I))   # into the glass
    # driver's instrument hood, column, centre console
    ob = bevel_box_object('binnacle', (0.38, 0.16, 0.08), (-0.45, 1.37, 1.195), I, 0.03, 1)
    asym.extend(object_to_mb(ob))
    asym.extend(cyl_mb((-0.45, 1.42, 1.02), (-0.45, 1.20, 1.16), 0.035, 10, 'dark_trim'))
    asym.extend(box_mb((0.30, 0.42, 0.30), (0.0, 1.30, 0.78), I, skip=('-z',)))      # console
    # dash-mounted gear lever: a black boot on the centre stack's rear face, a short
    # lever raked back and up, and a dark knob
    axb = Vector((0.0, -0.95, 0.31)).normalized()        # the boot: out of the stack's face
    axl = Vector((0.0, -0.60, 0.80)).normalized()        # the lever: raked up and back
    b0 = Vector((0.0, 1.290, 1.040))                     # base ring sunk into the face
    boot = lathe([(0.050, 0.0), (0.046, 0.018), (0.032, 0.036), (0.016, 0.050)], 10, 'rubber', axis='Z')
    boot = xform_mb(boot, Matrix.Translation(b0) @ axb.to_track_quat('Z', 'Y').to_matrix().to_4x4())
    orient_convex(boot, 0)
    asym.extend(boot)
    b1 = b0 + axb * 0.046
    asym.extend(cyl_mb(b1, b1 + axl * 0.070, 0.008, 6, I))
    knob = lathe([(0.001, -0.022), (0.018, -0.016), (0.024, 0.0), (0.018, 0.016), (0.001, 0.022)], 8, I, axis='Z')
    knob = xform_mb(knob, Matrix.Translation(b1 + axl * 0.090) @ axl.to_track_quat('Z', 'Y').to_matrix().to_4x4())
    orient_convex(knob, 0)
    asym.extend(knob)
    # parcels in the back
    for (sz, c, m) in (((0.44, 0.40, 0.36), (0.28, -1.84, 0.60), 'paint_yellow'),
                       ((0.36, 0.34, 0.30), (0.28, -1.82, 0.93), 'paint_main'),
                       ((0.46, 0.44, 0.44), (-0.26, -1.78, 0.64), 'paint_yellow'),
                       ((0.30, 0.30, 0.24), (-0.28, -1.74, 0.98), 'paint_blue'),
                       ((0.40, 0.50, 0.50), (0.02, -1.22, 0.67), 'paint_yellow')):
        asym.extend(box_mb(sz, c, m))


def build_underbody(sym):
    R = 'rubber'
    sym.extend(box_mb((0.56, 4.36, 0.02), (0.28, 0.0, 0.26), R, skip=('-x',)))
    sym.extend(box_mb((0.35, 1.82, 0.02), (0.735, 0.0, 0.305), R))
    sym.extend(box_mb((0.36, 0.30, 0.02), (0.60, 1.95, 0.50), R))     # clear of the bumper corner
    sym.extend(box_mb((0.40, 0.30, 0.02), (0.75, -2.00, 0.42), R))
    # axles and a tank so the gap under the van is not empty
    sym.extend(box_mb((0.80, 0.08, 0.08), (0.40, -WHEEL_Y, WHEEL_Z), R, skip=('-x',)))
    sym.extend(box_mb((0.80, 0.10, 0.07), (0.40, WHEEL_Y, WHEEL_Z + 0.02), R, skip=('-x',)))


def build_wipers(asym):
    """Parked along the foot of the windscreen."""
    def ws(x, y):
        z = sil(y)
        yy = y + B0 * bow_ramp(y, 'side') * (1 - (x / W) ** 2)
        return Vector((x, yy, z))
    nrm = Vector((0, 0.576, 0.817))
    for (piv, x0, x1) in ((-0.60, -0.84, -0.12), (0.04, -0.06, 0.62)):
        yb = 1.738                     # parked at the foot of the glass, down in the cowl
        pts = [ws(lerp(x0, x1, k / 4), yb) + nrm * 0.010 for k in range(5)]
        frames = []
        for k, p in enumerate(pts):
            frames.append((p, nrm, Vector((0, -0.817, 0.576))))
        blade = sweep(frames, [(-0.006, -0.009), (0.008, -0.004), (0.008, 0.004), (-0.006, 0.009)],
                      'dark_trim', closed_prof=True)
        orient_convex(blade, 0)
        asym.extend(blade)
        # arm from the pivot at the scuttle to the blade middle
        p0 = ws(piv, 1.790) + nrm * 0.008
        p1 = ws((x0 + x1) / 2, yb) + nrm * 0.018
        asym.extend(cyl_mb(p0, p1, 0.008, 6, 'dark_trim'))
        asym.extend(cyl_mb(p0 - nrm * 0.02, p0 + nrm * 0.006, 0.020, 8, 'dark_trim'))


def build_plates(asym, front_face):
    # the front plate sits on the lower intake, just proud of the bumper face
    y_f = Y_F + 0.07 + B0 + front_face + FB_FACE + 0.002
    zf = 0.369
    asym.extend(box_mb((0.52, 0.012, 0.110), (0.0, y_f + 0.006, zf), 'paint_main', skip=('-y',)))
    y_r = Y_R - 0.03 - 0.104 + 0.002
    zr = 0.392                      # above the bumper's lower lip
    asym.extend(box_mb((0.52, 0.012, 0.115), (0.0, y_r - 0.006, zr), 'paint_main', skip=('+y',)))
    for (yface, zc, sgn) in ((y_f + 0.0125, zf, 1), (y_r - 0.0125, zr, -1)):
        vs, fs, w = text_2d('ISL 247', res=1)
        s = 0.072
        pts = [(u * s - w * s / 2, v * s - s / 2) for u, v in vs]
        for f in fs:
            q = []
            for i in f:
                u, v = pts[i]
                x = -u if sgn > 0 else u
                q.append(asym.add_v((x, yface + sgn * 0.001, zc + v)))
            add_face_oriented(asym, q, 'dark_trim', (0, sgn, 0))
        # plate border
        for (sx, sz, cx, cz) in ((0.50, 0.006, 0, 0.049), (0.50, 0.006, 0, -0.049),
                                 (0.006, 0.104, 0.25, 0), (0.006, 0.104, -0.25, 0)):
            q = [asym.add_v((cx + a * sx / 2, yface + sgn * 0.001, zc + cz + b * sz / 2))
                 for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            add_face_oriented(asym, q, 'dark_trim', (0, sgn, 0))


def build_beacon(P, asym):
    h = P.top(0.0, 0.30, 0.0)
    z0 = h[0].z
    base = lathe([(0.105, -0.01), (0.105, 0.012), (0.098, 0.03), (0.076, 0.036)],
                 16, 'dark_trim', axis='Z')          # (its top is under the dome)
    asym.extend(base, Matrix.Translation((0, 0.30, z0)))
    top = z0 + 0.036
    b = MB()
    b.extend(lathe([(0.078, 0.0), (0.080, 0.012), (0.078, 0.07), (0.064, 0.108), (0.036, 0.128),
                    (0.004, 0.132)], 16, 'light_beacon', axis='Z'))
    b.extend(lathe([(0.082, -0.001), (0.080, 0.012)], 16, 'chrome', axis='Z'))
    # the rotating reflector inside the dome: a half-round dish behind a bright bulb,
    # chrome inside and dark outside, so one side of the dome reads darker than the
    # other and the spin shows
    for r, mat, sgn in ((0.054, 'chrome', -1), (0.057, 'dark_trim', 1)):
        dish = lathe([(r, 0.010), (r, 0.088)], 8, mat, axis='Z', a0=math.pi, a1=2 * math.pi, closed=False)
        for k in range(len(dish.f)):
            f = dish.f[k]
            pp = [Vector(dish.v[i]) for i in f]
            fc = sum(pp, Vector()) / 4
            nn = (pp[1] - pp[0]).cross(pp[2] - pp[0]) + (pp[2] - pp[0]).cross(pp[3] - pp[0])
            if nn.dot(Vector((fc.x, fc.y, 0.0))) * sgn < 0:
                dish.f[k] = tuple(reversed(f))
        b.extend(dish)
    b.extend(cyl_mb((0, 0.010, 0.016), (0, 0.010, 0.078), 0.013, 6, 'light_beacon'))
    return b, Vector((0.0, 0.30, top))


def build_exhaust(asym):
    """Silencer under the floor, a dark tailpipe and a dark tip."""
    ob = bevel_box_object('silencer', (0.24, 0.44, 0.11), (-0.44, -1.02, 0.235), 'rubber', 0.035, 1)
    asym.extend(object_to_mb(ob))
    # (tucked up under the rear bumper and 40 mm short of the old tip, which showed as a
    # pale stick in profile; the tip is dark metal-look trim, not chrome)
    asym.extend(cyl_mb((-0.49, -1.22, 0.228), (-0.55, -2.175, 0.178), 0.024, 8, 'rubber', caps=False))
    asym.extend(cyl_mb((-0.55, -2.16, 0.178), (-0.55, -2.27, 0.176), 0.030, 12, 'dark_trim', caps=False))
    asym.extend(cyl_mb((-0.55, -2.16, 0.178), (-0.55, -2.265, 0.176), 0.024, 12, 'rubber'))


def build_bonnet_lines(P, sym, L):
    """The bonnet shut lines.  The lamp's own top edge is the bonnet's front edge, so the
    line across the nose runs into the lamp's inner top corner and carries on as its shut
    gap; the bonnet's side edge leaves the lamp's top edge where it turns the corner and
    runs up over the leading edge and back along the top to the scuttle."""
    Lf, Wd = 0.0065, 0.009
    ut, zt = L.col(2, 0.0)[:2]                       # where the lamp's top edge starts
    end = L.at(ut, zt + Wd / 2)[0]
    pts = [P.front(lerp(0.0, end.x, k / 6), zt + Wd / 2 - 0.0014)[0] for k in range(7)]
    n0 = len(sym.v)
    surface_ribbon(P, sym, pts, Wd, Lf, 'dark_trim')
    lowz = min(sym.v[i][2] for i in range(n0, len(sym.v)) if sym.v[i][0] > end.x - 0.06)
    top_pts = [L.at(u, L.z_top(u))[0] for u in L.main[:3]]
    print(f"NOSE LINE end {tuple(round(c, 4) for c in end)} low edge z {lowz:.4f}; lamp top "
          f"{[(round(p.x, 3), round(p.z, 4)) for p in top_pts]} corner col2 {L.col(2)}")
    ua = min(L.main, key=lambda u: abs(L.at(u, L.z_top(u))[0].x - 0.85))
    a = L.at(ua, L.z_top(ua) + Wd / 2)[0]
    top = [P.top(a.x, lerp(2.05, 1.83, k / 4))[0] for k in range(5)]
    corner = [P.nearest(a.lerp(top[0], k / 4) + Vector((0, 0.03, 0.03)) * math.sin(math.pi * k / 4))[0]
              for k in range(4)]
    surface_ribbon(P, sym, corner + top, Wd, Lf, 'dark_trim')


def build_grille_surround(P, sym):
    """A thin, rounded chrome bead framing the grille -- the bright edge that the eye reads
    as 'finished', like the metal lips on the Nightjar's intakes."""
    zb, zt, r = 0.60, 0.835, 0.045
    hw_lin = lambda z: lerp(0.29, 0.37, (z - zb) / (zt - zb))
    path = [(0.0, zt), (0.16, zt)]
    for k in range(5):                         # top corner, quarter circle
        a = math.pi / 2 * k / 4
        path.append((hw_lin(zt - r) - r + r * math.sin(a), zt - r + r * math.cos(a)))
    for z in (0.76, 0.70):
        path.append((hw_lin(z), z))
    for k in range(5):                         # bottom corner
        a = math.pi / 2 * k / 4
        path.append((hw_lin(zb + r) - r + r * math.cos(a), zb + r - r * math.sin(a)))
    path += [(0.14, zb), (0.0, zb)]
    rows = []
    for i, p in enumerate(path):
        a = Vector(path[max(i - 1, 0)])
        b = Vector(path[min(i + 1, len(path) - 1)])
        t = (b - a).normalized()
        n = Vector((-t.y, t.x))
        P2 = Vector(p)
        rows.append([(*(P2 + n * 0.009), 0.0085), (*P2, 0.0135), (*(P2 - n * 0.009), 0.0085)])
    proj_grid(sym, rows, lambda x, z, l: P.front(x, z, l), 'chrome')


# ================================================================ scene assembly
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)


def obj_from(name, mb, origin=(0, 0, 0), mirror=False, wn=True, parent=None, keep_normals=None):
    o = Vector(origin)
    local = MB()
    local.v = [tuple(Vector(p) - o) for p in mb.v]
    local.f, local.m = list(mb.f), list(mb.m)
    ob = to_object(name, local)
    ob.location = o
    if mirror:
        m = add_mod_mirror(ob)
        m.mirror_object = None
        if abs(o.x) > 1e-9:
            raise ValueError('mirrored parts need x = 0 origins')
    ob.data.set_sharp_from_angle(angle=math.radians(48))
    if keep_normals:
        # the knifed skin round the headlamps keeps the uncut surface's normals, corner by
        # corner (so a crease through it stays split): set them as custom normals and keep
        # the weighted-normal pass off those vertices
        kset, nsrc = keep_normals
        me = ob.data
        nrm = [(0.0, 0.0, 0.0)] * len(me.loops)
        for poly in me.polygons:
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                if vi in kset:
                    nrm[li] = tuple(nsrc.at(me.vertices[vi].co, poly.normal))
        me.normals_split_custom_set(nrm)
        vg = ob.vertex_groups.new(name='keep_normals')
        vg.add(list(kset), 1.0, 'REPLACE')
    if wn:
        m = add_mod_wn(ob)
        if keep_normals:
            m.vertex_group = 'keep_normals'
            m.invert_vertex_group = True
    if parent:
        ob.parent = parent
    return ob


def mark_sharp_where(ob, pred, angle_deg):
    """Mark edges sharp where both ends satisfy pred(position) and the faces meet at more
    than angle_deg (on top of the 48 degree auto-sharp)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    n = 0
    lim = math.radians(angle_deg)
    for e in bm.edges:
        if len(e.link_faces) == 2 and all(pred(v.co) for v in e.verts):
            f1, f2 = e.link_faces
            if f1.normal.angle(f2.normal, 0.0) > lim:
                e.smooth = False
                n += 1
    bm.to_mesh(ob.data)
    bm.free()
    return n


def tri_count(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    ob.evaluated_get(dg).to_mesh_clear()
    return n


def main():
    reset_scene()
    build_materials()
    root = bpy.data.objects.new('courier_van', None)
    bpy.context.scene.collection.objects.link(root)
    root.empty_display_size = 0.5

    # ---- shell first: everything else is projected onto it
    body_mb, glass_mb, secs, metas = build_body_shell()
    tmp = MB()                      # shell + glazing, so parts can sit on the glass too
    tmp.extend(body_mb)
    tmp.extend(glass_mb)
    shell = to_object('body_shell_tmp', tmp)
    add_mod_mirror(shell)
    P = Proj(shell)

    sym = MB()          # right half, mirrored with the shell
    asym = MB()         # one-off parts (lettering, driver's side, plates ...)
    _last = {'s': 0, 'a': 0}

    def stamp(label):
        ts = sum(len(f) - 2 for f in sym.f)
        ta = sum(len(f) - 2 for f in asym.f)
        print(f"PART {label:14s} sym+{(ts - _last['s']) * 2:5d} (mirrored)  asym+{ta - _last['a']:5d}")
        _last['s'], _last['a'] = ts, ta
    print(f"PART shell          {sum(len(f) - 2 for f in body_mb.f) * 2} (mirrored)")
    build_livery(P, sym, secs, metas)
    stamp('livery')
    build_seams(P, sym, secs, metas)
    stamp('seams')
    build_windscreen_corners(P, sym, secs, metas)
    stamp('ws corners')
    stamp('roof_ribs')
    build_arch_trims(sym)
    stamp('arch_trims')
    fog, front_face = build_bumpers(P, sym)
    stamp('bumpers')
    build_grille(P, sym)
    build_grille_surround(P, sym)
    stamp('grille')
    build_lettering(P, asym)
    stamp('lettering')
    head_r, ind_front_r, house_f, lamp, outline3 = build_headlights(P)
    head_r.extend(fog)
    sym.extend(house_f)
    build_bonnet_lines(P, sym, lamp)
    # cut the headlamp openings into the skin (the uncut surface's normals come along)
    nsrc = NormalSource(body_mb)
    O = lamp.C.O
    chart = lambda p: Vector((lamp.C.u_of(math.degrees(math.atan2(p[0] - O.x, p[1] - O.y))), p[2]))
    facing = lambda n, c: abs(n.dot(Vector((c.x - O.x, c.y - O.y, 0.0)).normalized())) > 0.3
    kept = cut_skin(body_mb, outline3, chart, facing)
    # ... and the reverse lamps' openings behind their clear lenses
    tail_segs, house_r, tail_hole, TC = build_taillights(P, secs, metas)
    chart_t = lambda p: Vector((TC.u_of(math.degrees(math.atan2(p[0] - TC.O.x, -(p[1] - TC.O.y)))), p[2]))
    facing_t = lambda n, c: n.dot(Vector((c.x - TC.O.x, c.y - TC.O.y, 0.0)).normalized()) > 0.3
    keep = (cut_skin(body_mb, tail_hole, chart_t, facing_t, prior=kept), nsrc)
    sym.extend(house_r)
    stamp('lamp housings')
    build_rear_window_rubber(P, sym, glass_mb)
    stamp('window rubber')
    ind_r = MB()
    ind_r.extend(ind_front_r)
    ind_r.extend(tail_segs.pop('light_indicator'))
    build_mirror(P, sym, ind_r, secs, metas)
    stamp('mirror')
    build_handles(P, sym, asym)
    stamp('handles')
    build_interior(sym, asym)
    stamp('interior')
    build_underbody(sym)
    stamp('underbody')
    build_wipers(asym)
    stamp('wipers')
    build_plates(asym, front_face)
    stamp('plates')
    beacon_mb, beacon_at = build_beacon(P, asym)
    stamp('beacon base')
    build_exhaust(asym)
    build_fuel_flap(P, asym)
    stamp('exhaust')
    # high-level brake light on the rear roof edge
    chmsl = MB()
    rows = [[(x, z, 0.007) for z in (1.642, 1.668)] for x in (0.0, 0.07, 0.14, 0.20)]
    proj_grid(chmsl, rows, lambda a, b, l: P.rear(a, b, l), 'light_red')

    # ---- the body: shell + symmetric parts share one mirror
    full = MB()
    full.extend(body_mb)
    full.extend(sym)
    bpy.data.objects.remove(shell)
    body = obj_from('body', full, mirror=True, parent=root, keep_normals=keep)
    # crisp shut-line-like edges on the pressed roof channels (flat walls catch the sun
    # on one side and fall into shade on the other, so the channels read from the air)
    n_sharp = mark_sharp_where(body, lambda p: p.z > 1.80 and abs(p.x) < 0.88 and -1.95 < p.y < 0.0, 9.0)
    print("ROOF CHANNEL sharp edges", n_sharp)
    body_asym = obj_from('body_asym', asym, parent=root)
    glass = obj_from('glass', glass_mb, mirror=True, wn=False, parent=root)

    # ---- lights
    obj_from('light_head', head_r, origin=(0, 2.20, 0.78), mirror=True, parent=root)
    brake = MB()
    brake.extend(tail_segs['light_brake'])
    brake.extend(chmsl)
    obj_from('light_brake', brake, origin=(0, -2.20, 1.10), mirror=True, parent=root)
    obj_from('light_tail', tail_segs['light_tail'], origin=(0, -2.20, 0.70), mirror=True, parent=root)
    obj_from('light_reverse', tail_segs['light_reverse'], origin=(0, -2.20, 0.84), mirror=True, parent=root)
    obj_from('light_indicator_r', ind_r, origin=(0.95, 0.0, 0.95), parent=root)
    obj_from('light_indicator_l', mirror_mb(ind_r), origin=(-0.95, 0.0, 0.95), parent=root)
    obj_from('beacon', beacon_mb, origin=(0, 0, 0), parent=root).location = beacon_at

    # ---- wheels: origin exactly on the wheel centre, axle along X
    wr = build_wheel_mb()
    wl = mirror_mb(wr)
    for name, x, y in (('wheel_fl', -WHEEL_X, WHEEL_Y), ('wheel_fr', WHEEL_X, WHEEL_Y),
                       ('wheel_rl', -WHEEL_X, -WHEEL_Y), ('wheel_rr', WHEEL_X, -WHEEL_Y)):
        ob = obj_from(name, wl if x < 0 else wr, parent=root)
        ob.location = (x, y, WHEEL_Z)

    # ---- steering wheel: origin at the hub, column raked 35 degrees
    sw = obj_from('steering_wheel', build_steering_mb(), parent=root)
    sw.location = (-0.45, 1.16, 1.19)
    sw.rotation_euler = (math.radians(-35), 0, 0)

    bpy.context.view_layer.update()
    total = 0
    report = []
    for ob in sorted(root.children, key=lambda o: o.name):
        n = tri_count(ob)
        total += n
        report.append((ob.name, n))
    for name, n in report:
        print(f"TRIS {name:20s} {n}")
    print("TRIS TOTAL", total)
    print("MATERIALS", len([m for m in bpy.data.materials if m.users]), sorted(m.name for m in bpy.data.materials if m.users))

    bpy.context.preferences.filepaths.save_version = 0     # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    export_and_verify(root)
    print("BUILD OK")


def export_and_verify(root):
    # bake every modifier, then fold the one-off body parts into 'body'
    for ob in list(root.children):
        bake_object(ob)
    body = bpy.data.objects['body']
    asym = bpy.data.objects['body_asym']
    with bpy.context.temp_override(active_object=body, object=body,
                                   selected_objects=[body, asym], selected_editable_objects=[body, asym]):
        bpy.ops.object.join()
    m = add_mod_wn(body)
    if 'keep_normals' in body.vertex_groups:
        m.vertex_group = 'keep_normals'
        m.invert_vertex_group = True
    bake_object(body)
    for ob in bpy.data.objects:
        ob.select_set(False)
    root.select_set(True)
    for ob in root.children_recursive:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_cameras=False,
                              export_lights=False, export_animations=False, export_extras=False)
    # ---- round trip
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB)
    total = 0
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for ob in sorted(bpy.data.objects, key=lambda o: o.name):
        if ob.type == 'MESH':
            n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
            total += n
            for v in ob.data.vertices:
                w = ob.matrix_world @ v.co
                lo = Vector(map(min, lo, w))
                hi = Vector(map(max, hi, w))
            print(f"GLB {ob.name:20s} parent={ob.parent.name if ob.parent else '-':12s} "
                  f"loc=({ob.matrix_world.translation.x:+.4f},{ob.matrix_world.translation.y:+.4f},"
                  f"{ob.matrix_world.translation.z:+.4f}) tris={n} mats={[m.name for m in ob.data.materials]}")
        else:
            print(f"GLB {ob.name:20s} type={ob.type}")
    print("GLB TRIS", total)
    # no zero-area triangles anywhere (a collapsed decal grid used to leave ~110 of them)
    zero = 0
    for ob in bpy.data.objects:
        if ob.type == 'MESH':
            me = ob.data
            me.calc_loop_triangles()
            bad = [t for t in me.loop_triangles if t.area < 1e-9]
            for t in bad[:6]:
                c = sum((me.vertices[i].co for i in t.vertices), Vector()) / 3
                print(f"ZERO-AREA in {ob.name} at {tuple(round(x, 4) for x in c)} area {t.area:.2e}")
            zero += len(bad)
    print("GLB ZERO-AREA TRIS", zero)
    assert zero == 0, zero
    print("GLB BBOX", tuple(round(c, 4) for c in lo), tuple(round(c, 4) for c in hi),
          "size", tuple(round(c, 4) for c in (hi - lo)))
    # ---- the fit, re-proved from the imported file: every wheel's geometry is centred
    #      on its origin, the axle is its local X, and the tyre touches the road plane
    for name, x, y in (('wheel_fl', -WHEEL_X, WHEEL_Y), ('wheel_fr', WHEEL_X, WHEEL_Y),
                       ('wheel_rl', -WHEEL_X, -WHEEL_Y), ('wheel_rr', WHEEL_X, -WHEEL_Y)):
        ob = bpy.data.objects[name]
        co = [v.co for v in ob.data.vertices]
        wlo = Vector(map(min, *co))
        whi = Vector(map(max, *co))
        cen = (wlo + whi) / 2
        t = ob.matrix_world.translation
        bottom = (ob.matrix_world @ Vector((0, 0, wlo.z))).z
        ok = ((t - Vector((x, y, WHEEL_Z))).length < 1e-4 and cen.length < 2e-3
              and abs(bottom - GROUND) < 2e-3 and abs((whi.y - wlo.y) - 2 * TYRE_R) < 4e-3
              and (whi.x - wlo.x) < 0.25)
        print(f"FIT {name}: origin {tuple(round(c, 4) for c in t)} geom-centre-offset {cen.length:.4f} "
              f"tyre-bottom z={bottom:+.4f} dia={whi.y - wlo.y:.3f} width(X)={whi.x - wlo.x:.3f} "
              f"{'OK' if ok else 'FAIL'}")
        assert ok, name
    need = {'courier_van', 'body', 'glass', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'steering_wheel',
            'light_head', 'light_tail', 'light_brake', 'light_reverse', 'light_indicator_l',
            'light_indicator_r', 'beacon'}
    have = {o.name for o in bpy.data.objects}
    assert need <= have, need - have
    assert all(bpy.data.objects[n].parent and bpy.data.objects[n].parent.name == 'courier_van'
               for n in need - {'courier_van'})
    assert len([m for m in bpy.data.materials if m.users]) <= 14
    assert total <= 22000, total
    print("FIT names/parents/materials/budget OK")


if __name__ == '__main__':
    main()
