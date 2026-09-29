"""
Render an aeroplane the way a person sees it: lit, painted, from outside.

Takes the JSON that tools/aircraft-colour.mjs writes and renders it headless
in Blender — no window, no scene of anybody else's touched. Three views by
default: a three-quarter from the front, a side, and one from above.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/blender_aircraft.py -- <in.json> <outDir> [tag]

Writes <outDir>/<tag>_three_quarter.png, _side.png and _above.png.

The game's axes are -Z forward, +Y up; Blender's are +Y forward, +Z up. The
swap is below and it is the only thing in this file that is easy to get wrong.
"""
import bpy, json, math, os, sys

argv = sys.argv[sys.argv.index('--') + 1:]
src, outdir = argv[0], argv[1]
tag = argv[2] if len(argv) > 2 else os.path.splitext(os.path.basename(src))[0]
os.makedirs(outdir, exist_ok=True)
d = json.load(open(src))

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)

for k, g in enumerate(d['groups']):
    verts, faces = [], []
    for t in g['tris']:
        n = len(verts)
        verts.extend([(p[0], p[2], p[1]) for p in t])
        faces.append((n, n + 1, n + 2))
    me = bpy.data.meshes.new('g%d' % k)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new('g%d' % k, me)
    bpy.context.collection.objects.link(ob)
    m = bpy.data.materials.new('m%d' % k)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    r, gg, bb = g['color']
    b.inputs['Base Color'].default_value = (r, gg, bb, 1)
    if 'Roughness' in b.inputs:
        b.inputs['Roughness'].default_value = max(0.06, g.get('roughness', 0.6))
    if 'Metallic' in b.inputs:
        b.inputs['Metallic'].default_value = g.get('metalness', 0)
    if g.get('opacity', 1) < 0.99:
        if 'Alpha' in b.inputs:
            b.inputs['Alpha'].default_value = g['opacity']
        m.blend_method = 'BLEND'
    ob.data.materials.append(m)

key = bpy.data.lights.new('key', type='SUN'); key.energy = 4.5
ko = bpy.data.objects.new('key', key); bpy.context.collection.objects.link(ko)
ko.rotation_euler = (math.radians(55), 0, math.radians(40))
fill = bpy.data.lights.new('fill', type='SUN'); fill.energy = 1.4
fo = bpy.data.objects.new('fill', fill); bpy.context.collection.objects.link(fo)
fo.rotation_euler = (math.radians(70), 0, math.radians(-130))
w = bpy.data.worlds.new('w'); bpy.context.scene.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.62, 0.72, 0.85, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 0.9

allp = [p for g in d['groups'] for t in g['tris'] for p in t]
xs = [p[0] for p in allp]; ys = [p[2] for p in allp]; zs = [p[1] for p in allp]
bpy.ops.mesh.primitive_plane_add(size=600, location=(0, 0, min(zs) - 0.02))
gm = bpy.data.materials.new('ground'); gm.use_nodes = True
gm.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.42, 0.47, 0.42, 1)
bpy.context.active_object.data.materials.append(gm)

sc = bpy.context.scene
engines = [i.identifier for i in sc.render.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else (
    'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_WORKBENCH')
sc.render.resolution_x, sc.render.resolution_y = 1000, 620
cam_data = bpy.data.cameras.new('cam'); cam_data.lens = 70
cam = bpy.data.objects.new('cam', cam_data); bpy.context.collection.objects.link(cam); sc.camera = cam
tgt = bpy.data.objects.new('t', None); bpy.context.collection.objects.link(tgt)
tgt.location = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2 + 0.4)
span = max(max(xs) - min(xs), max(ys) - min(ys))
c = cam.constraints.new('TRACK_TO'); c.target = tgt; c.track_axis = 'TRACK_NEGATIVE_Z'; c.up_axis = 'UP_Y'

def shot(name, az, el, mul):
    a, e = math.radians(az), math.radians(el)
    r = span * mul
    cam.location = (tgt.location[0] + math.cos(a) * math.cos(e) * r,
                    tgt.location[1] + math.sin(a) * math.cos(e) * r,
                    tgt.location[2] + math.sin(e) * r)
    bpy.context.view_layer.update()
    sc.render.filepath = os.path.join(outdir, '%s_%s.png' % (tag, name))
    bpy.ops.render.render(write_still=True)

shot('three_quarter', -125, 12, 1.95)
shot('side', -90, 4, 2.0)
shot('above', -118, 42, 2.0)
