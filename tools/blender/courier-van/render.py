"""
Render the courier van from the saved courier_van.blend (never saves it back).

  Blender --background --factory-startup --python render.py -- r0 [views,comma] [scale%]

Views: hero rear34 side top front detail chase
"""
import bpy, math, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROUND = argv[0] if argv else 'r0'
VIEWS = argv[1].split(',') if len(argv) > 1 and argv[1] else \
    ['hero', 'rear34', 'side', 'top', 'front', 'detail', 'chase']
SCALE = int(argv[2]) if len(argv) > 2 else 100
SAMPLES = int(argv[3]) if len(argv) > 3 else 64      # debug renders use fewer
OUT = ROUND if os.path.isabs(ROUND) else os.path.join(HERE, 'renders', ROUND)
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, 'courier_van.blend'))
sc = bpy.context.scene
GROUND = -0.06

# ---------------------------------------------------------------- engine
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
sc.render.resolution_percentage = SCALE
sc.render.film_transparent = False
ee = sc.eevee
for attr, val in (('taa_render_samples', SAMPLES), ('use_shadows', True), ('use_raytracing', True),
                  ('shadow_ray_count', 2), ('shadow_step_count', 8), ('use_gtao', True),
                  ('fast_gi_distance', 2.0)):
    try:
        setattr(ee, attr, val)
    except Exception:
        pass
# the game tone-maps with three.js ACES Filmic, so render through ACES too.  (The enum's
# item list is empty in background mode, so just try the names; rounds r0-art2 fell back
# to AgX without noticing.)  VIEW=agx in the environment reproduces the old look.
VIEW = os.environ.get('VIEW', 'aces')
for want in (('AgX',) if VIEW == 'agx' else ('ACES 1.3', 'AgX')):
    try:
        sc.view_settings.view_transform = want
        break
    except Exception:
        pass
print('VIEW TRANSFORM', sc.view_settings.view_transform)
sc.view_settings.exposure = float(os.environ.get('EXPOSURE', '0.15'))

# ---------------------------------------------------------------- world: soft sky
w = bpy.data.worlds.new('sky')
sc.world = w
w.use_nodes = True
nt = w.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
tc = nt.nodes.new('ShaderNodeTexCoord')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')
ramp = nt.nodes.new('ShaderNodeValToRGB')
bg = nt.nodes.new('ShaderNodeBackground')
out = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(tc.outputs['Generated'], sep.inputs[0])
nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
cr = ramp.color_ramp
cr.elements[0].position = 0.0
cr.elements[0].color = (0.42, 0.43, 0.42, 1)
cr.elements[1].position = 1.0
cr.elements[1].color = (0.30, 0.50, 0.85, 1)
e = cr.elements.new(0.5)
e.color = (0.78, 0.84, 0.90, 1)
e = cr.elements.new(0.62)
e.color = (0.55, 0.68, 0.88, 1)
bg.inputs['Strength'].default_value = 0.9

# ---------------------------------------------------------------- sun + fill
sun_d = bpy.data.lights.new('key', 'SUN')
sun_d.energy = 3.6
sun_d.angle = math.radians(4)
sun = bpy.data.objects.new('key', sun_d)
sc.collection.objects.link(sun)
d = Vector((0.55, 0.45, 0.85)).normalized()          # direction TO the sun
sun.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()

# ---------------------------------------------------------------- ground
me = bpy.data.meshes.new('ground')
S = 60
me.from_pydata([(-S, -S, GROUND), (S, -S, GROUND), (S, S, GROUND), (-S, S, GROUND)], [], [(0, 1, 2, 3)])
g = bpy.data.objects.new('ground', me)
sc.collection.objects.link(g)
gm = bpy.data.materials.new('ground')
gm.use_nodes = True
b = next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
b.inputs['Base Color'].default_value = (0.36, 0.37, 0.37, 1)
b.inputs['Roughness'].default_value = 0.9
me.materials.append(gm)


# ---------------------------------------------------------------- cameras
def cam(name, loc, look, lens=50, ortho=None, up_hint=None, fov_v=None):
    cd = bpy.data.cameras.new(name)
    co = bpy.data.objects.new(name, cd)
    sc.collection.objects.link(co)
    co.location = loc
    dvec = Vector(look) - Vector(loc)
    co.rotation_euler = dvec.to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        cd.type = 'ORTHO'
        cd.ortho_scale = ortho
    elif fov_v:
        cd.sensor_fit = 'VERTICAL'
        cd.angle = math.radians(fov_v)
    else:
        cd.lens = lens
    cd.clip_start = 0.05
    cd.clip_end = 300
    return co


CAMS = {
    'hero': lambda: cam('hero', (5.6, 7.2, 2.5), (0.0, 0.25, 0.72), lens=55),
    'rear34': lambda: cam('rear34', (-5.4, -7.2, 2.7), (0.0, -0.2, 0.75), lens=55),
    'side': lambda: cam('side', (12, 0.0, 0.93), (0, 0.0, 0.93), ortho=5.3),
    'top': lambda: cam('top', (0, 0.0, 12), (0, 0.0, 0), ortho=5.3),
    'front': lambda: cam('front', (0, 12, 0.93), (0, 0, 0.93), ortho=3.4),
    'detail': lambda: cam('detail', (2.55, 3.55, 1.25), (0.85, 1.55, 0.72), lens=45),
    'chase': lambda: cam('chase', (0, -8.0, 3.2), (0, 6.0, 1.1), fov_v=64),
    # debugging close-ups (not part of a round)
    'hl': lambda: cam('hl', (1.05, 3.3, 0.95), (0.62, 2.1, 0.78), lens=70),
    'tl': lambda: cam('tl', (1.9, -3.2, 1.2), (0.9, -2.2, 0.9), lens=60),
    'arch': lambda: cam('arch', (2.6, -2.6, 0.55), (1.0, -1.35, 0.55), lens=50),
    # the game's bonnet camera: eye [0, 1.45, -1.15] (three.js) = (0, 1.15, 1.45) here
    'eye': lambda: cam('eye', (0, 1.15, 1.45), (0, 61.15, -0.55), fov_v=72),
    'pillar': lambda: cam('pillar', (2.3, 3.1, 2.1), (0.93, 1.30, 1.40), lens=60),
    'mirror': lambda: cam('mirror', (2.0, 0.35, 1.35), (1.22, 1.55, 1.10), lens=55),
    'bumper': lambda: cam('bumper', (1.5, 3.9, 0.75), (0.30, 2.30, 0.40), lens=50),
    'clay_rear': lambda: cam('clay_rear', (-2.6, -7.6, 2.4), (0.0, -1.8, 0.95), lens=55),
    'clay_hero': lambda: cam('clay_hero', (5.6, 7.2, 2.5), (0.0, 0.25, 0.72), lens=55),
    'clay_side': lambda: cam('clay_side', (12, 0.0, 0.93), (0, 0.0, 0.93), ortho=5.3),
    'clay_front34low': lambda: cam('clay_front34low', (3.2, 6.4, 0.9), (0.3, 1.6, 0.75), lens=50),
    'clay_hl': lambda: cam('clay_hl', (1.35, 3.6, 1.05), (0.62, 2.0, 0.80), lens=60),
    'wheel': lambda: cam('wheel', (2.9, 2.2, 0.55), (0.95, 1.35, 0.30), lens=55),
    'doortop': lambda: cam('doortop', (4.5, 0.1, 1.55), (1.0, 0.1, 1.55), lens=70),
    'wscorner': lambda: cam('wscorner', (2.2, 3.4, 2.5), (0.80, 0.95, 1.65), lens=70),
    'slot': lambda: cam('slot', (1.6, 3.8, 0.55), (0.60, 2.25, 0.36), lens=60),
    'clay_hl_l': lambda: cam('clay_hl_l', (-1.9, 3.3, 1.25), (-0.75, 2.02, 0.82), lens=55),
    'clay_hl_r': lambda: cam('clay_hl_r', (1.9, 3.3, 1.25), (0.75, 2.02, 0.82), lens=55),
    'clay_tip': lambda: cam('clay_tip', (2.3, 2.75, 1.05), (1.0, 1.80, 0.88), lens=70),
    'tip': lambda: cam('tip', (2.3, 2.75, 1.05), (1.0, 1.80, 0.88), lens=70),
    'mirror_f': lambda: cam('mirror_f', (2.1, 2.7, 1.45), (1.18, 1.62, 1.14), lens=60),
    'mirror_top': lambda: cam('mirror_top', (1.25, 1.62, 3.2), (1.18, 1.62, 1.14), lens=70),
    'eyerear': lambda: cam('eyerear', (-2.2, -6.5, 1.3), (0.2, -1.8, 0.95), lens=50),
    # art3 close-ups
    'cab': lambda: cam('cab', (2.6, 1.0, 1.55), (0.3, 0.85, 1.20), lens=45),
    'seats': lambda: cam('seats', (0.0, 3.4, 1.75), (0.0, 0.8, 1.30), lens=50),
    'arch_rear': lambda: cam('arch_rear', (2.9, -0.2, 0.55), (0.95, -1.35, 0.35), lens=50),
    'fog': lambda: cam('fog', (1.5, 3.7, 0.60), (0.55, 2.30, 0.38), lens=60),
    'rev': lambda: cam('rev', (1.2, -3.0, 0.95), (0.85, -2.20, 0.80), lens=80),
    'bumper_r': lambda: cam('bumper_r', (0.9, -4.2, 0.9), (0.2, -2.3, 0.35), lens=50),
    'rooftop': lambda: cam('rooftop', (0.0, 5.0, 2.3), (0.0, 1.0, 1.9), lens=70),
    'beacon_c': lambda: cam('beacon_c', (0.9, 1.2, 2.25), (0.0, 0.30, 1.95), lens=80),
}

clay = bpy.data.materials.new('clay')
clay.use_nodes = True
cb = next(n for n in clay.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
cb.inputs['Base Color'].default_value = (0.62, 0.62, 0.60, 1)
cb.inputs['Roughness'].default_value = 0.55

for v in VIEWS:
    c = CAMS[v]()
    if v == 'top':
        c.rotation_euler = (0, 0, math.radians(90))
    sc.camera = c
    bpy.context.view_layer.material_override = clay if v.startswith('clay') else None
    sc.render.filepath = os.path.join(OUT, f'{v}.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', sc.render.filepath)
