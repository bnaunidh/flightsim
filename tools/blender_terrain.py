"""
Look at a map.

Reads a grid written by tools/heightfield.mjs and builds it in Blender: the
land as a mesh, the sea as a plane at zero, and on top of them every thing the
map claims is there — the runway, the roads, the helipads, the harbour and its
buoyage, the drying shoals, the named places, and a marker on each island's
declared centre and peak.

The point is not a pretty render. The point is that a map's faults are obvious
in a picture and invisible in a table of numbers. Everything that goes wrong
with these maps goes wrong in the same way: something is somewhere it cannot
be. A lighthouse under the sea, a runway up a mountain, a town on a cliff, a
road through a hill. One orbit answers all of it.

Usage, from the MCP bridge or Blender's own console:

    import sys; sys.path.append('/Users/bgaurav/Desktop/island-flight-sim/tools')
    import blender_terrain as bt
    bt.load('/path/to/kestrel.json')          # one map
    bt.load_all('/path/to/dir', columns=6)    # the lot, laid out in a grid

Heights are exaggerated by `vscale` (default 2.5) because an island 2 km across
and 300 m high is nearly flat at true scale and you cannot see anything.
"""

import bpy
import json
import math
import os

SEA = 0.0


def _clear(prefix):
    """Remove everything from a previous load, by name prefix."""
    for ob in [o for o in bpy.data.objects if o.name.startswith(prefix)]:
        bpy.data.objects.remove(ob, do_unlink=True)


def _mat(name, rgba, emit=0.0):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = rgba
        if 'Roughness' in bsdf.inputs:
            bsdf.inputs['Roughness'].default_value = 0.85
        if emit and 'Emission Strength' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = rgba
            bsdf.inputs['Emission Strength'].default_value = emit
    return m


def _mesh_from_grid(name, data, scale, vscale, origin):
    """The land itself, one quad per grid cell, with a vertex colour by height."""
    n = data['n']
    b = data['bounds']
    hs = data['heights']
    ox, oz = origin
    verts = []
    for j in range(n):
        z = b['z0'] + (b['z1'] - b['z0']) * j / (n - 1)
        for i in range(n):
            x = b['x0'] + (b['x1'] - b['x0']) * i / (n - 1)
            y = hs[j * n + i]
            # Blender is Z-up; the game is Y-up with +Z pointing "south".
            verts.append(((x + ox) * scale, (z + oz) * scale, y * scale * vscale))
    faces = []
    for j in range(n - 1):
        for i in range(n - 1):
            a = j * n + i
            faces.append((a, a + 1, a + n + 1, a + n))

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()

    # Colour by height, so the shape reads without any lighting at all: deep
    # water through shallows, beach, grass, rock, snow.
    col = me.color_attributes.new(name='height', type='BYTE_COLOR', domain='POINT')
    for k, v in enumerate(verts):
        y = hs[k]
        if y < -12:
            c = (0.04, 0.12, 0.26, 1)
        elif y < -1.5:
            c = (0.09, 0.30, 0.48, 1)
        elif y < 1.5:
            c = (0.68, 0.64, 0.45, 1)
        elif y < 60:
            c = (0.22, 0.42, 0.20, 1)
        elif y < 180:
            c = (0.32, 0.40, 0.24, 1)
        elif y < 320:
            c = (0.42, 0.38, 0.34, 1)
        else:
            c = (0.86, 0.88, 0.92, 1)
        col.data[k].color = c

    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    m = _mat('ifs_land', (1, 1, 1, 1))
    if m.node_tree and not m.node_tree.nodes.get('ifs_vcol'):
        vc = m.node_tree.nodes.new('ShaderNodeVertexColor')
        vc.name = 'ifs_vcol'
        vc.layer_name = 'height'
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        m.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    ob.data.materials.append(m)
    return ob


def _sea(name, data, scale, origin):
    b = data['bounds']
    ox, oz = origin
    w = (b['x1'] - b['x0']) * scale
    d = (b['z1'] - b['z0']) * scale
    cx = ((b['x0'] + b['x1']) / 2 + ox) * scale
    cz = ((b['z0'] + b['z1']) / 2 + oz) * scale
    bpy.ops.mesh.primitive_plane_add(size=1, location=(cx, cz, SEA))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (w, d, 1)
    ob.data.materials.append(_mat('ifs_sea', (0.05, 0.22, 0.38, 1)))
    return ob


def _pin(name, x, z, y, scale, vscale, origin, colour, h=120.0, r=18.0):
    """A stick with a head, so a thing's position is readable from any angle."""
    ox, oz = origin
    bpy.ops.mesh.primitive_cylinder_add(
        radius=r * scale, depth=h * scale,
        location=((x + ox) * scale, (z + oz) * scale, y * scale * vscale + h * scale / 2))
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(_mat('ifs_' + colour[0], colour[1], emit=2.0))
    return ob


def _ribbon(name, pts, scale, vscale, origin, colour, width=26.0):
    """A road or a channel, drawn as a flat strip that follows its own heights."""
    ox, oz = origin
    if len(pts) < 2:
        return None
    verts, faces = [], []
    for k, p in enumerate(pts):
        x, z = p[0], p[1]
        y = p[2] if len(p) > 2 else 0.0
        a = pts[max(0, k - 1)]
        c = pts[min(len(pts) - 1, k + 1)]
        dx, dz = c[0] - a[0], c[1] - a[1]
        l = math.hypot(dx, dz) or 1.0
        nx, nz = -dz / l * width, dx / l * width
        verts.append(((x - nx + ox) * scale, (z - nz + oz) * scale, y * scale * vscale + 1.5 * scale))
        verts.append(((x + nx + ox) * scale, (z + nz + oz) * scale, y * scale * vscale + 1.5 * scale))
        if k:
            i = (k - 1) * 2
            faces.append((i, i + 1, i + 3, i + 2))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(_mat('ifs_' + colour[0], colour[1], emit=1.2))
    return ob


def load(path, scale=0.002, vscale=2.5, origin=(0, 0), prefix=None):
    """Build one map. `scale` metres→Blender units; 0.002 puts a 14 km map at 28 u."""
    with open(path) as fh:
        d = json.load(fh)
    pre = prefix or ('ifs_' + d['id'] + '_')
    _clear(pre)

    _mesh_from_grid(pre + 'land', d, scale, vscale, origin)
    _sea(pre + 'sea', d, scale, origin)

    rw = d.get('runway')
    if rw:
        a = math.radians(rw.get('headingDeg', 90))
        half = rw['length'] / 2
        pts = [
            [rw['cx'] - math.sin(a) * half, rw['cz'] + math.cos(a) * half, rw['elev']],
            [rw['cx'] + math.sin(a) * half, rw['cz'] - math.cos(a) * half, rw['elev']],
        ]
        _ribbon(pre + 'runway', pts, scale, vscale, origin, ('runway', (0.95, 0.95, 0.98, 1)),
                width=rw.get('halfWidth', 14))

    for k, r in enumerate(d.get('roads', [])):
        _ribbon(pre + 'road%d' % k, r['path'], scale, vscale, origin,
                ('road', (0.18, 0.18, 0.20, 1)), width=r.get('halfWidth', 13) * 0.7)

    for p in d.get('pads', []):
        _pin(pre + 'pad_' + p['id'], p['x'], p['z'], p['y'], scale, vscale, origin,
             ('pad', (1.0, 0.35, 0.25, 1)) if p.get('role') == 'hospital' else ('pad2', (0.95, 0.85, 0.2, 1)),
             h=90, r=14)

    h = d.get('harbour')
    if h:
        _pin(pre + 'berth', h['berth'][0], h['berth'][1], 0, scale, vscale, origin, ('berth', (0.2, 0.9, 0.6, 1)))
        _pin(pre + 'mouth', h['mouth'][0], h['mouth'][1], 0, scale, vscale, origin, ('mouth', (0.2, 0.6, 0.9, 1)))
    for k, m in enumerate(d.get('marks', [])):
        _pin(pre + 'buoy%d' % k, m[0], m[1], 0, scale, vscale, origin,
             ('port', (0.85, 0.2, 0.15, 1)) if m[2] == 'port' else ('stbd', (0.2, 0.7, 0.3, 1)), h=45, r=8)
    for k, s in enumerate(d.get('shoals', [])):
        _pin(pre + 'shoal%d' % k, s['x'], s['z'], s['top'], scale, vscale, origin,
             ('shoal', (0.95, 0.55, 0.1, 1)), h=35, r=10)
    for p in d.get('places', []):
        _pin(pre + 'place_' + p['id'], p['x'], p['z'], 0, scale, vscale, origin,
             ('place', (0.9, 0.5, 0.95, 1)), h=110, r=12)

    sc = d.get('scenery') or {}
    if sc.get('lighthouse'):
        _pin(pre + 'lighthouse', sc['lighthouse'][0], sc['lighthouse'][1], 0, scale, vscale, origin,
             ('lh', (1.0, 1.0, 0.4, 1)), h=150, r=10)
    if sc.get('town'):
        _pin(pre + 'town', sc['town']['cx'], sc['town']['cz'], 0, scale, vscale, origin,
             ('town', (0.6, 0.75, 1.0, 1)), h=130, r=16)

    print('[terrain] %-18s %s  %s..%s m  %d pads  %d roads  %d buoys'
          % (d['id'], d['name'], d['min'], d['max'], len(d.get('pads', [])),
             len(d.get('roads', [])), len(d.get('marks', []))))
    return d


def load_all(directory, columns=6, gap=1.25, scale=0.002, vscale=2.5):
    """Every map in a directory, laid out in a grid so the set can be compared."""
    files = sorted(f for f in os.listdir(directory) if f.endswith('.json'))
    for k, f in enumerate(files):
        with open(os.path.join(directory, f)) as fh:
            d = json.load(fh)
        b = d['bounds']
        w = (b['x1'] - b['x0']) * gap
        col, row = k % columns, k // columns
        cx = -(b['x0'] + b['x1']) / 2 + col * w
        cz = -(b['z0'] + b['z1']) / 2 + row * w
        load(os.path.join(directory, f), scale=scale, vscale=vscale, origin=(cx, cz))
    print('[terrain] laid out %d maps in %d columns' % (len(files), columns))
