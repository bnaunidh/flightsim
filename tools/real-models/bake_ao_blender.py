"""
Run by detail.py inside Blender, headless (blender -b --factory-startup --python this -- ...):
bake ambient occlusion over a processed real model on one fresh UV atlas.

  args: in.npz out.png uv.npz size samples distance margin
  in.npz   n, p{k}_P (V,3) p{k}_N (V,3) p{k}_I (T,3)  -- the game's axes, +Y up
  out.png  the AO, size x size, 8-bit grey (white = open sky)
  uv.npz   p{k}_UV (T*3, 2): the atlas UV of every triangle corner, in input order

Only geometry goes in -- no textures, no materials of the source -- so what
comes out is shade from shape alone. Nothing below the aeroplane (no ground):
it is for a model that flies.
"""
import sys, math
import bpy
import numpy as np

a = sys.argv[sys.argv.index('--') + 1:]
src, out_png, out_uv = a[0], a[1], a[2]
size, samples, dist, margin = int(a[3]), int(a[4]), float(a[5]), float(a[6])
d = np.load(src)
n = int(d['n'])

scene = bpy.context.scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)

img = bpy.data.images.new('ao', size, size, alpha=False, float_buffer=True)
img.generated_color = (1, 1, 1, 1)

objs = []
for k in range(n):
    P, N, I = d[f'p{k}_P'], d[f'p{k}_N'], d[f'p{k}_I']
    me = bpy.data.meshes.new(f'p{k}')
    # game (x, y up, z aft) -> Blender (x, -z, y): a proper rotation, windings kept
    Pb = np.stack([P[:, 0], -P[:, 2], P[:, 1]], 1)
    Nb = np.stack([N[:, 0], -N[:, 2], N[:, 1]], 1)
    me.vertices.add(len(Pb))
    me.vertices.foreach_set('co', Pb.astype(np.float32).ravel())
    me.loops.add(I.size)
    me.loops.foreach_set('vertex_index', I.astype(np.int32).ravel())
    me.polygons.add(len(I))
    me.polygons.foreach_set('loop_start', np.arange(0, I.size, 3, dtype=np.int32))
    me.update(calc_edges=True)
    me.polygons.foreach_set('use_smooth', np.ones(len(I), bool))
    nl = np.linalg.norm(Nb, axis=1, keepdims=True)
    # Blender 5.2 crashes setting custom normals on a mesh with degenerate triangles (the 747's)
    # or bad normals: those keep Blender's own smooth normals, enough for AO.
    degen = (I[:, 0] == I[:, 1]) | (I[:, 1] == I[:, 2]) | (I[:, 0] == I[:, 2])
    if not degen.any() and np.isfinite(Nb).all() and (nl > 1e-6).all():
        me.normals_split_custom_set_from_vertices((Nb / np.maximum(nl, 1e-9)).tolist())
    assert len(me.polygons) == len(I) and len(me.loops) == I.size, 'Blender changed the mesh'
    ob = bpy.data.objects.new(f'p{k}', me)
    scene.collection.objects.link(ob)
    mat = bpy.data.materials.new(f'm{k}')
    mat.use_nodes = True
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = img
    mat.node_tree.nodes.active = node
    me.materials.append(mat)
    me.uv_layers.new(name='bake')
    objs.append(ob)

# one atlas over every part: area-proportional islands, packed together
bpy.ops.object.select_all(action='DESELECT')
for ob in objs:
    ob.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.uv.pack_islands(rotate=True, margin=margin)
bpy.ops.object.mode_set(mode='OBJECT')

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = samples
try:
    scene.cycles.use_denoising = False
except Exception:
    pass
if scene.world is None:
    scene.world = bpy.data.worlds.new('w')
scene.world.light_settings.distance = dist
bake = scene.render.bake
bake.margin = 16
bake.margin_type = 'EXTEND'
bpy.ops.object.bake(type='AO', margin=16, use_clear=False)

img.filepath_raw = out_png
img.file_format = 'PNG'
s = bpy.data.images.new('ao8', size, size, alpha=False)
s.pixels.foreach_set(np.asarray(img.pixels[:], dtype=np.float32))
s.filepath_raw = out_png
s.file_format = 'PNG'
s.save()

# The surface detail (detail.py surface_maps): every texel's 3D position, normal and part, baked
# into the same atlas as plain emission (no lighting), so detail can be drawn by where it is.
geo_out = a[7] if len(a) > 7 else ''
if geo_out:
    scene.cycles.samples = 1
    roles = [int(r) for r in a[8].split(',')] if len(a) > 8 else [0] * len(objs)
    def emit_bake(kind, margin_px):
        im = bpy.data.images.new(kind, size, size, alpha=True, float_buffer=True)
        im.generated_color = (0, 0, 0, 0)
        for k, ob in enumerate(objs):
            nt = ob.data.materials[0].node_tree
            for n in [n for n in nt.nodes if n.bl_idname != 'ShaderNodeTexImage']:
                nt.nodes.remove(n)
            tex = [n for n in nt.nodes if n.bl_idname == 'ShaderNodeTexImage'][0]
            tex.image = im
            nt.nodes.active = tex
            out = nt.nodes.new('ShaderNodeOutputMaterial')
            em = nt.nodes.new('ShaderNodeEmission')
            nt.links.new(em.outputs[0], out.inputs[0])
            if kind == 'role':
                em.inputs[0].default_value = (roles[k] / 255.0, 1.0, 0.0, 1.0)
            else:
                # emission cannot go negative: (v + off) * mul, undone below
                off, mul = (100.0, 0.005) if kind == 'pos' else (1.0, 0.5)
                g = nt.nodes.new('ShaderNodeNewGeometry')
                add = nt.nodes.new('ShaderNodeVectorMath'); add.operation = 'ADD'
                add.inputs[1].default_value = (off, off, off)
                sc = nt.nodes.new('ShaderNodeVectorMath'); sc.operation = 'SCALE'
                sc.inputs['Scale'].default_value = mul
                nt.links.new(g.outputs['Position' if kind == 'pos' else 'Normal'], add.inputs[0])
                nt.links.new(add.outputs[0], sc.inputs[0])
                nt.links.new(sc.outputs[0], em.inputs[0])
        bake.margin = margin_px
        bpy.ops.object.bake(type='EMIT', margin=margin_px, use_clear=True)
        arr = np.asarray(im.pixels[:], dtype=np.float32).reshape(size, size, 4)[::-1]  # rows top-down, as the PNG
        return arr
    pos = emit_bake('pos', 16)[..., :3] / 0.005 - 100.0
    nrm = emit_bake('nrm', 16)[..., :3] / 0.5 - 1.0
    role = emit_bake('role', 0)
    # back to the game's axes: Blender (x, y, z) = game (x, -z, y)
    P = np.stack([pos[..., 0], pos[..., 2], -pos[..., 1]], -1)
    N = np.stack([nrm[..., 0], nrm[..., 2], -nrm[..., 1]], -1)
    np.savez_compressed(geo_out, pos=P.astype(np.float32), nrm=N.astype(np.float16),
                        role=np.round(role[..., 0] * 255).astype(np.uint8), mask=(role[..., 1] > 0.5))

uv = {}
for k, ob in enumerate(objs):
    me = ob.data
    lv = np.zeros(len(me.loops), np.int32)
    me.loops.foreach_get('vertex_index', lv)
    assert (lv == d[f'p{k}_I'].astype(np.int32).ravel()).all(), 'loop order changed'
    arr = np.zeros(len(me.loops) * 2, np.float32)
    me.uv_layers['bake'].data.foreach_get('uv', arr)
    a2 = arr.reshape(-1, 2)
    a2[:, 1] = 1.0 - a2[:, 1]  # Blender's v runs up the image; glTF's runs down
    uv[f'p{k}_UV'] = a2
np.savez(out_uv, **uv)
print('BAKED', out_png, sum(len(o.data.polygons) for o in objs), 'faces')
