"""
The World Map's CC0 scenery models (src/world/worldmap/props.js), made
small enough for a flight sim on a Chromebook.

SOURCES: Poly Haven (https://polyhaven.com, CC0 1.0), the 1k glTF of each,
fetched as plain data files with curl (the .gltf, its .bin and its _diff_
texture; nothing else, nothing run):
  rock_face_01              https://polyhaven.com/a/rock_face_01
  boulder_01                https://polyhaven.com/a/boulder_01
  quiver_tree_01            https://polyhaven.com/a/quiver_tree_01
  modular_wooden_pier       https://polyhaven.com/a/modular_wooden_pier
  modular_electricity_poles https://polyhaven.com/a/modular_electricity_poles
each into <downloads>/raw-<id>/ (curl the URLs from https://api.polyhaven.com/files/<id>).

WHAT THIS DOES (Blender, in the background, no add-ons):
  join the pieces wanted (a pier section; a pole, its crossarm, insulators
  and cap), weld the UV seams, decimate to 500-1,800 triangles, bake the
  diffuse photo into per-corner vertex colours (a 3x3 average at each
  corner's UV), drop the UVs and textures, one plain material, stand it on
  its base, and write assets/models/scenery/<name>.glb (glb.js reads it).

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python tools/scenery-models/process.py -- <downloads> <out>
"""
import bpy, bmesh, os, sys, json, math
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
D = ARGS[0] if len(ARGS) > 0 else os.path.expanduser('~/Downloads/polyhaven-scenery')
OUT = ARGS[1] if len(ARGS) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'scenery')
JOBS = [
    # (source, output, object names (None = all meshes), target faces, offsets {name: (dx,dy,dz)})
    ('rock_face_01', 'rock-face', None, 900, {}),
    ('boulder_01', 'boulder', None, 500, {}),
    ('quiver_tree_01', 'quiver-tree', None, 1800, {}),
    ('modular_wooden_pier', 'pier-section', ['modular_wooden_pier_section_02'], 1400, {}),
    ('modular_electricity_poles', 'utility-pole', ['pole', 'connection_large_01', 'insulators_large', 'cap'], 1500,
     {'connection_large_01': (2.5, 0, 0), 'insulators_large': (2.5, 0, 3.3), 'cap': (5.2, 0, 1.1)}),
]
report = {}

def image_of(mat):
    if not mat or not mat.use_nodes:
        return None
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            inp = n.inputs['Base Color']
            if inp.is_linked:
                src = inp.links[0].from_node
                if src.type == 'TEX_IMAGE' and src.image:
                    return src.image
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and 'diff' in n.image.name:
            return n.image
    return None

for src, name, names, target, offs in JOBS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(D, 'raw-' + src, src + '.gltf'))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and (names is None or o.name in names)]
    for o in list(bpy.data.objects):
        if o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in meshes:
        if o.name in offs:
            dx, dy, dz = offs[o.name]
            o.location.x += dx; o.location.y += dy; o.location.z += dz
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    me = ob.data
    # Pixels of every material's diffuse, once.
    pix = {}
    for i, m in enumerate(me.materials):
        img = image_of(m)
        if img:
            img.reload() if not img.has_data else None
            w, h = img.size
            px = list(img.pixels[:]) if w and h else None
            pix[i] = (w, h, px)
    # Bake: each face corner the texture's colour at its UV (a 3x3 average, so a pixel's noise does not show).
    uvl = me.uv_layers.active
    col = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for poly in me.polygons:
        p = pix.get(poly.material_index)
        for li in poly.loop_indices:
            r = g = b = 0.6
            if p and uvl:
                w, h, px = p
                u, v = uvl.data[li].uv
                acc = [0, 0, 0]; n = 0
                for du in (-2, 0, 2):
                    for dv in (-2, 0, 2):
                        x = int((u % 1.0) * w + du) % w
                        y = int((v % 1.0) * h + dv) % h
                        k = (y * w + x) * 4
                        acc[0] += px[k]; acc[1] += px[k + 1]; acc[2] += px[k + 2]; n += 1
                r, g, b = acc[0] / n, acc[1] / n, acc[2] / n
            col.data[li].color = (r, g, b, 1.0)
    me.color_attributes.active_color = col
    faces0 = len(me.polygons)
    # Weld the UV seams first (the import splits the mesh along them), so the collapse can work across them.
    if name != 'quiver-tree':
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0008)
        bm.to_mesh(me); bm.free()
    for _ in range(5):
        if len(me.polygons) <= target * 1.1:
            break
        mod = ob.modifiers.new('dec', 'DECIMATE')
        mod.ratio = max(0.02, target / len(me.polygons))
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='dec')
    # One plain material: the colour is in the vertices.
    me.materials.clear()
    plain = bpy.data.materials.new(name + '-plain')
    plain.use_nodes = True
    bsdf = plain.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = 0.9
    bsdf.inputs['Metallic'].default_value = 0.0
    me.materials.append(plain)
    # Standing on its base, centred.
    zs = [v.co.z for v in me.vertices]
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    cx = (min(xs) + max(xs)) / 2; cy = (min(ys) + max(ys)) / 2; z0 = min(zs)
    for v in me.vertices:
        v.co.x -= cx; v.co.y -= cy; v.co.z -= z0
    for uv in list(me.uv_layers):
        me.uv_layers.remove(uv)
    ob.name = name
    out = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_materials='EXPORT',
                              export_vertex_color='ACTIVE', export_normals=True, export_texcoords=False, export_apply=True)
    report[name] = {'faces_in': faces0, 'faces_out': len(me.polygons), 'size': [round(max(xs) - min(xs), 2), round(max(ys) - min(ys), 2), round(max(zs) - z0, 2)], 'bytes': os.path.getsize(out)}
print('REPORT ' + json.dumps(report))
