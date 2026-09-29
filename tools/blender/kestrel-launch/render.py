"""
Render the Kestrel Launch for review. Opens kestrel_launch.blend (built by
build.py), adds a soft sky, a key sun, a neutral ground with contact shadow
and cameras, and writes PNGs to renders/<round>/. Never saves the .blend.

    "/Applications/Blender.app/Contents/MacOS/Blender" --background \
        kestrel_launch.blend --python render.py -- r0 [view ...]

Views: hero rear34 side top front detail detail2 chase chase_sea chase_full fit_rest
       fit_full fit_turn water waterside bow bowtop bottom props roof ttop beam_helm
       bow_low console

The boat is posed the way the game + kestrel_launch.js pose her: pitch about
the origin (the centre of flotation), a fraction of the sea's heave, and the
planing lift at speed. MASK=1 renders the boat alone on a transparent film and
prints the share of orange / white / dark / navy pixels (the chase-view mix).
"""
import bpy, math, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROUND = ARGS[0] if ARGS else 'r0'
VIEWS = ARGS[1:] or ['hero', 'rear34', 'side', 'top', 'front', 'detail', 'detail2', 'chase', 'chase_full',
                     'fit_rest', 'fit_full', 'fit_turn', 'water', 'waterside', 'bow', 'bowtop', 'bottom', 'roof',
                     'props', 'ttop', 'beam_helm', 'bow_low', 'console']
OUT = os.environ.get('RENDER_OUT') or os.path.join(HERE, 'renders', ROUND)
os.makedirs(OUT, exist_ok=True)

sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
sc.render.resolution_percentage = 100
sc.render.film_transparent = False
try:
    sc.eevee.taa_render_samples = 64
    sc.eevee.use_raytracing = True
    sc.eevee.use_shadows = True
    sc.eevee.shadow_ray_count = 2
    sc.eevee.shadow_step_count = 8
    sc.eevee.use_fast_gi = True
except Exception as e:
    print('eevee opt', e)
for vt in ('Filmic', 'AgX', 'Standard'):
    try:
        sc.view_settings.view_transform = vt
        break
    except Exception:
        pass
try:
    sc.view_settings.look = 'None'
except Exception:
    pass
sc.view_settings.exposure = 0.0
if os.environ.get('QUICK'):
    sc.render.resolution_percentage = 50
    sc.eevee.taa_render_samples = 16

root = bpy.data.objects.get('kestrel_launch')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
dg = bpy.context.evaluated_depsgraph_get()
lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    oe = o.evaluated_get(dg)
    for c in oe.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
center = (lo + hi) / 2
size = hi - lo
print('BBOX', tuple(round(v, 3) for v in lo), tuple(round(v, 3) for v in hi))

# ---- world: soft sky gradient (horizon pale, zenith blue)
w = bpy.data.worlds.new('sky'); sc.world = w
try:
    w.use_nodes = True
except Exception:
    pass
nt = w.node_tree
bg = nt.nodes['Background']
tc = nt.nodes.new('ShaderNodeTexCoord')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')
ramp = nt.nodes.new('ShaderNodeValToRGB')
nt.links.new(tc.outputs['Generated'], sep.inputs[0])
nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
ramp.color_ramp.elements[0].position = 0.45
ramp.color_ramp.elements[0].color = (0.78, 0.80, 0.80, 1)
ramp.color_ramp.elements[1].position = 0.85
ramp.color_ramp.elements[1].color = (0.42, 0.56, 0.74, 1)
nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 1.0

# ---- key sun + fill
def sun(name, energy, rot, angle=3.0, color=(1, 1, 1)):
    L = bpy.data.lights.new(name, 'SUN'); L.energy = energy; L.angle = math.radians(angle)
    L.color = color
    o = bpy.data.objects.new(name, L); sc.collection.objects.link(o)
    o.rotation_euler = rot
    return o

sun('key', 3.6, (math.radians(48), 0, math.radians(142)), 2.5, (1.0, 0.97, 0.92))
fill = sun('fill', 0.5, (math.radians(70), 0, math.radians(-40)), 10, (0.85, 0.9, 1.0))
fill.data.use_shadow = False

# ---- ground (neutral, receives shadow) at the lowest point
gz = lo.z - 0.002
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, gz))
ground = bpy.context.active_object; ground.name = '_ground'
gm = bpy.data.materials.new('_ground'); gm.use_nodes = True
gb = gm.node_tree.nodes['Principled BSDF']
gb.inputs['Base Color'].default_value = (0.36, 0.37, 0.37, 1)
gb.inputs['Roughness'].default_value = 0.9
ground.data.materials.append(gm)

# ---- shadowless seabed for the waterline views (emission only, so no
#      misleading drop shadow far below the hull)
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, -3.0))
bed = bpy.context.active_object; bed.name = '_seabed'
bm_ = bpy.data.materials.new('_seabed'); bm_.use_nodes = True
bb = bm_.node_tree.nodes['Principled BSDF']
bb.inputs['Base Color'].default_value = (0, 0, 0, 1)
bb.inputs['Emission Color'].default_value = (0.03, 0.09, 0.11, 1)
bb.inputs['Emission Strength'].default_value = 1.0
bed.data.materials.append(bm_)
bed.hide_render = True

# ---- translucent sea at Z = 0 (only for the water view)
bpy.ops.mesh.primitive_plane_add(size=600, location=(0, 0, 0))
water = bpy.context.active_object; water.name = '_water'
wm = bpy.data.materials.new('_water'); wm.use_nodes = True
wb = wm.node_tree.nodes['Principled BSDF']
wb.inputs['Base Color'].default_value = (0.03, 0.22, 0.30, 1)
wb.inputs['Roughness'].default_value = 0.22
wb.inputs['Alpha'].default_value = 0.62
wm.surface_render_method = 'BLENDED'
water.data.materials.append(wm)
water.hide_render = True

# ---- opaque-ish sea for the game-view render
bpy.ops.mesh.primitive_plane_add(size=600, location=(0, 0, 0))
sea = bpy.context.active_object; sea.name = '_sea'
sm = bpy.data.materials.new('_sea'); sm.use_nodes = True
sb = sm.node_tree.nodes['Principled BSDF']
sb.inputs['Base Color'].default_value = (0.015, 0.10, 0.15, 1)
sb.inputs['Roughness'].default_value = 0.30
sb.inputs['Alpha'].default_value = 0.88
sm.surface_render_method = 'BLENDED'
sea.data.materials.append(sm)
sea.hide_render = True

cam_data = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_data); sc.collection.objects.link(cam); sc.camera = cam
cam_data.clip_start = 0.05; cam_data.clip_end = 500


def look(loc, target):
    cam.location = Vector(loc)
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def persp(lens=50):
    cam_data.type = 'PERSP'; cam_data.lens = lens; cam_data.sensor_fit = 'AUTO'


def ortho(scale):
    cam_data.type = 'ORTHO'; cam_data.ortho_scale = scale


def orbit(az, el, dist, target):
    a, e = math.radians(az), math.radians(el)
    t = Vector(target)
    return (t.x + math.sin(a) * math.cos(e) * dist,
            t.y + math.cos(a) * math.cos(e) * dist,
            t.z + math.sin(e) * dist)


def shares(name):
    """Share of the boat's pixels (alpha > 0.5) by colour family."""
    import numpy as np
    img = bpy.data.images.load(os.path.join(OUT, name + '.png'))
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    bpy.data.images.remove(img)
    px = px[px[:, 3] > 0.5][:, :3]
    mx, mn = px.max(1), px.min(1)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    orange = (sat > 0.45) & (r >= g) & (g >= b) & (mx > 0.25)
    navy = (sat > 0.25) & (b > r) & (b >= g) & ~orange
    white = (sat < 0.22) & (mx > 0.62) & ~orange
    dark = (mx < 0.30) & ~orange & ~navy
    n = len(px)
    out = {k: round(100.0 * int(m.sum()) / n, 1) for k, m in
           (('orange', orange), ('white', white), ('dark', dark), ('navy_blue', navy))}
    out['other'] = round(100.0 - sum(out.values()), 1)
    out['boat_px'] = n
    print('SHARES', name, out)


def render(name):
    sc.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('WROTE', sc.render.filepath)


tgt = (center.x, center.y, 0.55)
_h = bpy.data.objects.get('helm')
helm_c = center.copy()
if _h:
    _bb = [_h.matrix_world @ Vector(c) for c in _h.bound_box]
    helm_c = sum(_bb, Vector()) / 8
PLANING_LIFT = float(root.get('planing_lift_m', 0.45)) if root else 0.45
_fit = root.get('fit') if root else None
SEA_SCALE = float(_fit['sea_motion_scale']) if _fit and 'sea_motion_scale' in _fit else 0.4
TRIM = 0.14 * (float(_fit['trim_scale']) if _fit and 'trim_scale' in _fit else 1.0)
H_LO = -1.4478                      # min of sin p + 0.45 sin(1.7 p + 1.1) (surface.js seaMotion)


def sea_trough(sea, full):
    """(pitch, dz) of the gate's worst case at a sea state: the deepest trough
    with the sea's pitch putting the stern down, scaled as the module does."""
    A, P = 0.1 + 0.75 * sea, 0.02 + 0.12 * sea
    trim = TRIM if full else 0.0
    return trim + SEA_SCALE * P, (PLANING_LIFT if full else 0.0) + SEA_SCALE * A * H_LO


def pose(pitch=0.0, dz=0.0, bank=0.0):
    """Pose the boat the way the game does: three.js Euler(pitch, yaw, bank,
    'YXZ') about the model origin - bank first (starboard up positive, about
    the fore-aft axis), then pitch (bow up positive) - plus heave / planing
    lift on the origin."""
    if root:
        root.rotation_mode = 'YXZ'
        root.rotation_euler = (pitch, -bank, 0.0)
        root.location = (0.0, 0.0, dz)


def game_cam(back, up, lead):
    cam_data.type = 'PERSP'; cam_data.sensor_fit = 'VERTICAL'
    cam_data.sensor_height = 24.0
    cam_data.lens = 12.0 / math.tan(math.radians(68) / 2)
    look((0, -back, up), (0, lead, 1.2))


for v in VIEWS:
    ground.hide_render = False; water.hide_render = True; sea.hide_render = True; ground.location.z = gz
    water.location.z = 0.0
    bed.hide_render = True
    pose()
    if v == 'hero':          # 3/4 front, starboard bow, slightly above
        persp(55); look(orbit(38, 17, 17.5, tgt), tgt)
    elif v == 'rear34':      # 3/4 rear, port quarter
        persp(55); look(orbit(-140, 20, 17.5, tgt), tgt)
    elif v == 'side':        # orthographic starboard profile
        ortho(size.y * 1.08); look((30, center.y, center.z), (0, center.y, center.z))
    elif v == 'top':
        ortho(size.y * 1.08); cam.location = (0, center.y, 40); cam.rotation_euler = (0, 0, 0)
        cam.rotation_euler = (0, 0, math.radians(90))
    elif v == 'front':
        ortho(size.x * 1.9); look((0, 40, center.z), (0, 0, center.z))
    elif v == 'detail':      # stern: outboards, platform, arch feet
        persp(60); t = (0.25, lo.y + 1.4, 0.7); look(orbit(-148, 26, 5.4, t), t)
    elif v == 'detail2':     # helm: from the aft cockpit, under the roof, over the seats
        persp(30); t = (0.0, helm_c.y, 1.2); look((0.32, helm_c.y - 2.3, 1.95), t)
    elif v in ('chase', 'chase_sea'):   # the game's own chase camera, at rest (main.js)
        if v == 'chase_sea':
            ground.hide_render = False; ground.location.z = -6.0
            sea.hide_render = False
        game_cam(11.0, 5.0, 8.0)
    elif v == 'chase_full':  # full speed, 14 m/s: 0.14 rad bow-up trim, planing lift, the far camera
        ground.hide_render = False; ground.location.z = -6.0
        sea.hide_render = False
        pose(TRIM, PLANING_LIFT)
        game_cam(11.0 + 14 * 0.5, 5.0 + 14 * 0.12, 8.0 + 14 * 0.6)
    elif v in ('fit_rest', 'fit_full'):   # top of 'calm' (sea 0.22), deepest trough, stern down;
        # the translucent plane is the game's swell layer at y = +0.08: is the cockpit dry?
        ground.hide_render = True; bed.hide_render = False; water.hide_render = False
        water.location.z = 0.08
        pose(*sea_trough(0.22, v == 'fit_full'))
        persp(40); t = (0.0, lo.y + 2.4, 0.35); look(orbit(122, 11, 10.0, t), t)
    elif v == 'fit_turn':    # sea 0.39 ('Breezy Afternoon'), full-lock turn at the gate's worst speed and
        # trough, after the module's keep-dry clamp: the swell layer (y = +0.08) must stay out of the cockpit
        ground.hide_render = True; bed.hide_render = False; water.hide_render = False
        water.location.z = 0.08
        p_, b_, dz_ = list(_fit['render_pose_turn'])
        pose(p_, dz_, -b_)            # a starboard turn heels her to starboard (the low side is +X)
        persp(38); t = (0.4, lo.y + 3.2, 0.45); look(orbit(128, 16, 9.5, t), t)
    elif v == 'beam_helm':   # starboard beam at the helm, eye height on a pontoon (the reviewer's view)
        persp(40); look((helm_c.x + 6.5, helm_c.y - 0.3, 2.1), (helm_c.x, helm_c.y - 0.3, 1.55))
    elif v == 'bow_low':     # low bow 3/4 from port, near the waterline
        persp(35); look((-7.5, 10.5, 1.2), (0, 1.0, 1.0))
    elif v == 'console':     # the console and windscreen from the port quarter, close
        persp(45); t = (0.0, helm_c.y + 0.15, 1.45); look(orbit(-135, 18, 3.6, t), t)
    elif v == 'roof':        # from above and astern, as the game's helicopter sees her
        persp(45); t = (0.0, center.y, 1.6); look(orbit(-150, 52, 15.0, t), t)
    elif v == 'bottom':      # underside: spray rails, chines, forefoot
        ground.hide_render = True
        persp(45); t = (0.0, center.y + 1.0, -0.2); look(orbit(35, -14, 13.0, t), t)
    elif v == 'bowtop':      # foredeck: anchor on its roller, bow rail, cleats, stretcher
        persp(50); t = (0.0, hi.y - 0.9, 1.35); look(orbit(28, 32, 4.2, t), t)
    elif v == 'ttop':        # the T-top from the port quarter: posts, frame, rack, fascia, lifebuoy
        persp(40); t = (0.0, -0.45, 1.9); look(orbit(-128, 20, 7.5, t), t)
    elif v == 'props':       # lower units: gearcases, skegs, counter-rotating props
        ground.hide_render = True
        persp(50); t = (0.0, lo.y + 0.45, -0.55); look(orbit(-128, 8, 3.6, t), t)
    elif v == 'bow':         # close-up of the bow and forefoot
        persp(50); t = (0.0, hi.y - 1.2, 0.3); look(orbit(40, 4, 5.5, t), t)
    elif v == 'water':       # waterline proof: translucent sea at Z 0
        ground.hide_render = True; bed.hide_render = False; water.hide_render = False
        persp(50); look(orbit(62, 9, 16.0, (0, center.y, 0.2)), (0, center.y, 0.2))
    elif v == 'waterside':   # low, abeam: the waterline where the hull enters the sea
        ground.hide_render = True; bed.hide_render = False; water.hide_render = False
        persp(40); t = (0.0, center.y, 0.3); look(orbit(90, 3.5, 20.0, t), t)
    else:
        continue
    if os.environ.get('MASK'):   # boat only, on a transparent film (for pixel statistics)
        sc.render.film_transparent = True
        for o in (ground, sea, water, bed):
            o.hide_render = True
    render(v)
    if os.environ.get('MASK'):
        shares(v)
    cam_data.sensor_fit = 'AUTO'
