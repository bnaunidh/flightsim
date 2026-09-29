"""
Render the Skyhook H-3 turntable set with EEVEE.

  "/Applications/Blender.app/Contents/MacOS/Blender" --background --factory-startup \
      --python render.py -- r2 [view ...]

Opens skyhook.blend (written by build.py, next to this file) and writes
renders/<round>/<view>.png at 1600x1000.
Views: hero rear34 side top front detail chase (+ chase_game, blur, cockpit on request).
"""
import bpy, os, sys, math
from math import radians, sin, cos, tan
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROUND = argv[0] if argv else 'r0'
VIEWS = argv[1:] or ['hero', 'rear34', 'side', 'top', 'front', 'detail', 'chase']
OUT = os.path.join(HERE, 'renders', ROUND)
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, 'skyhook.blend'))
sc = bpy.context.scene
GROUND_Z = -1.6875   # skid contact height (game main gear contact, scaled)

# ---------------------------------------------------------------- render setup
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = 1600
sc.render.resolution_y = 1000
sc.render.resolution_percentage = 100
sc.render.film_transparent = False
ee = sc.eevee
ee.taa_render_samples = 64
for attr, val in (('use_raytracing', True), ('use_shadows', True), ('shadow_ray_count', 2),
                  ('shadow_step_count', 8), ('fast_gi_ray_count', 4)):
    try:
        setattr(ee, attr, val)
    except Exception:
        pass
try:
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
except Exception:
    try:
        sc.view_settings.view_transform = 'Standard'
    except Exception:
        pass
sc.view_settings.exposure = 0.0

# ---------------------------------------------------------------- world: soft sky
world = bpy.data.worlds.new('sky')
sc.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()
tc = nt.nodes.new('ShaderNodeTexCoord')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')
ramp = nt.nodes.new('ShaderNodeValToRGB')
bg = nt.nodes.new('ShaderNodeBackground')
out = nt.nodes.new('ShaderNodeOutputWorld')
# fac = 0.5 + 0.5 * z: below the horizon stays the old dark ground bounce, the sky itself
# starts pale at the horizon (no dark band showing above the ground plane's far edge)
mad = nt.nodes.new('ShaderNodeMath')
mad.operation = 'MULTIPLY_ADD'
mad.inputs[1].default_value = 0.5
mad.inputs[2].default_value = 0.5
nt.links.new(tc.outputs['Generated'], sep.inputs[0])
nt.links.new(sep.outputs['Z'], mad.inputs[0])
nt.links.new(mad.outputs[0], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
cr = ramp.color_ramp
cr.elements[0].position = 0.0
cr.elements[0].color = (0.30, 0.31, 0.32, 1)
cr.elements[1].position = 1.0
cr.elements[1].color = (0.36, 0.52, 0.78, 1)
for pos, col in ((0.495, (0.34, 0.35, 0.36)), (0.5, (0.74, 0.77, 0.80)), (0.75, (0.66, 0.72, 0.80)),
                 (0.81, (0.60, 0.68, 0.78))):
    e = cr.elements.new(pos)
    e.color = (*col, 1)
bg.inputs['Strength'].default_value = 1.0

# key sun
sun_d = bpy.data.lights.new('key', 'SUN')
sun_d.energy = 3.2
sun_d.angle = radians(4.0)
sun_d.color = (1.0, 0.97, 0.92)
sun = bpy.data.objects.new('key', sun_d)
sc.collection.objects.link(sun)
sun.rotation_euler = (radians(42), radians(0), radians(142))

# ground plane with a neutral material
bpy.ops.mesh.primitive_plane_add(size=6000, location=(0, 0, GROUND_Z))
ground = bpy.context.active_object
ground.name = 'ground'
gm = bpy.data.materials.new('ground')
gm.use_nodes = True
b = gm.node_tree.nodes.get('Principled BSDF')
b.inputs['Base Color'].default_value = (0.36, 0.37, 0.37, 1)
b.inputs['Roughness'].default_value = 0.9
ground.data.materials.append(gm)

root = bpy.data.objects.get('skyhook')
blur = bpy.data.objects.get('rotor_main_blur')

# ---------------------------------------------------------------- cameras
cam_d = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_d)
sc.collection.objects.link(cam)
sc.camera = cam
cam_d.clip_start = 0.05
cam_d.clip_end = 6000

def look(loc, target, lens=50, ortho=None):
    cam.location = Vector(loc)
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        cam_d.type = 'ORTHO'
        cam_d.ortho_scale = ortho
    else:
        cam_d.type = 'PERSP'
        cam_d.lens = lens

C = Vector((0, -1.3, 0.3))   # visual centre of the machine

def top_view():
    cam.location = Vector((0, -1.35, 40))
    cam.rotation_euler = (0, 0, radians(90))    # nose to the right of the frame
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = 11.6

def sph(az, el, dist, target=C):
    az, el = radians(az), radians(el)
    # az 0 = in front of the nose (+Y), 90 = right side (+X)
    return target + Vector((sin(az) * cos(el), cos(az) * cos(el), sin(el))) * dist

SHOTS = {
    'hero': lambda: look(sph(38, 14, 17.5), C + Vector((0, 0.3, -0.1)), 50),
    'rear34': lambda: look(sph(-140, 17, 17.5), C + Vector((0, 0.0, -0.1)), 50),
    'side': lambda: look((30, -1.1, 0.25), (0, -1.1, 0.25), ortho=11.4),
    'top': lambda: top_view(),
    'front': lambda: look((0, 40, 0.35), (0, 0, 0.35), ortho=9.6),
    'detail': lambda: look((3.1, 3.4, 1.45), (0.35, 0.9, 0.5), 50),
    'chase': lambda: look((0, -1.1 - 11.0, 3.0 + 0.3), (0, -1.1 + 4.0, 0.2), 50),
    # the game's own follow camera (camera.js): 17 m back, 5.2 m up, aimed at the origin, vfov 62
    'chase_game': lambda: look((0, -17.0, 5.2), (0, 0, 0), 18.7),
    'rotorhead': lambda: look((1.6, -1.9, 2.75), (0, -0.2, 1.75), 60),
    'hub34': lambda: look((2.3, 1.9, 2.9), (0, -0.2, 1.85), 50),
    'tailL': lambda: look((-2.6, -7.2, 1.3), (0, -5.0, 0.55), 50),
    'notch': lambda: look((1.9, 1.9, 1.5), (0.74, 1.22, 0.86), 135),
    'crease': lambda: look((2.4, -7.4, 1.4), (0.1, -4.62, 0.72), 160),
    'belly': lambda: look((3.2, 3.6, -1.35), (0, 0.4, -0.9), 40),
    'tail': lambda: look((2.4, -7.4, 1.4), (0, -5.0, 0.55), 50),
    'cockpit': lambda: look((-0.275, 1.125, 0.5), (-0.275, 6.0, 0.1), 28),
    'winch': lambda: look((3.2, 1.0, 1.0), (1.1, -0.25, 0.8), 45),
    'blur': lambda: look(sph(38, 20, 19), C, 50),
    'nose': lambda: look((0.9, 5.2, 0.4), (0, 2.8, -0.1), 50),
    'cowlfront': lambda: look((1.3, 1.9, 2.0), (0.2, 0.4, 1.2), 50),
}

for v in VIEWS:
    if v not in SHOTS:
        print('unknown view', v)
        continue
    SHOTS[v]()
    if blur:
        blur.hide_render = (v != 'blur')
    rotor = bpy.data.objects.get('rotor_main')
    sc.render.filepath = os.path.join(OUT, v + '.png')
    bpy.ops.render.render(write_still=True)
    print('wrote', sc.render.filepath)
