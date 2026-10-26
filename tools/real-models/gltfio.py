"""Read a .glb/.gltf (models only: no scripts, no network) and flatten every
triangle primitive into world space as numpy arrays.

  prims = flatten(path)   -> list of dicts:
      pos (N,3) float64 world, nrm (N,3) or None, idx (M,3) int, mat (str),
      node (str), mesh (str), uv (N,2) or None, skinned (bool)
"""
import json, struct, os
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load(path):
    if path.endswith('.glb'):
        b = open(path, 'rb').read()
        if b[:4] != b'glTF':
            raise ValueError('not a glb')
        off, j, binc = 12, None, None
        while off < len(b):
            l, t = struct.unpack_from('<II', b, off)
            c = b[off + 8:off + 8 + l]
            if t == 0x4E4F534A:
                j = json.loads(c)
            elif t == 0x004E4942:
                binc = c
            off += 8 + l
        bufs = [binc]
    else:
        j = json.load(open(path))
        d = os.path.dirname(path)
        bufs = []
        for bf in j.get('buffers', []):
            uri = bf['uri']
            if uri.startswith('data:') or '/' in uri.replace('\\', '/') and '..' in uri:
                raise ValueError('refusing buffer uri ' + uri[:40])
            bufs.append(open(os.path.join(d, uri), 'rb').read())
    return j, bufs


def accessor(j, bufs, i):
    a = j['accessors'][i]
    n = NC[a['type']]
    dt = np.dtype(CT[a['componentType']])
    cnt = a['count']
    if 'bufferView' not in a:
        return np.zeros((cnt, n), dtype=dt)
    bv = j['bufferViews'][a['bufferView']]
    buf = bufs[bv.get('buffer', 0)]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0) or n * dt.itemsize
    if stride == n * dt.itemsize:
        arr = np.frombuffer(buf, dtype=dt, count=cnt * n, offset=start).reshape(cnt, n)
    else:
        raw = np.frombuffer(buf, dtype=np.uint8, count=stride * (cnt - 1) + n * dt.itemsize, offset=start)
        arr = np.lib.stride_tricks.as_strided(raw, shape=(cnt, n * dt.itemsize), strides=(stride, 1)).copy().view(dt).reshape(cnt, n)
    if a.get('normalized'):
        info = np.iinfo(dt)
        arr = np.maximum(arr.astype(np.float64) / info.max, -1.0)
    if 'sparse' in a:
        raise ValueError('sparse accessor')
    return arr


def quat_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def local(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    s = np.array(n.get('scale', [1, 1, 1]))
    r = quat_mat(n.get('rotation', [0, 0, 0, 1]))
    m[:3, :3] = r * s
    m[:3, 3] = n.get('translation', [0, 0, 0])
    return m


def flatten(path):
    j, bufs = load(path)
    nodes = j.get('nodes', [])
    mats = j.get('materials', [])
    out = []
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    scene = j.get('scenes', [{}])[j.get('scene', 0)] if j.get('scenes') else {'nodes': [i for i in range(len(nodes)) if i not in parent]}

    def visit(i, M, chain):
        n = nodes[i]
        W = M @ local(n)
        name = n.get('name', f'node{i}')
        if 'mesh' in n:
            mesh = j['meshes'][n['mesh']]
            for pi, p in enumerate(mesh['primitives']):
                if p.get('mode', 4) != 4:
                    continue
                pos = accessor(j, bufs, p['attributes']['POSITION']).astype(np.float64)
                nrm = accessor(j, bufs, p['attributes']['NORMAL']).astype(np.float64) if 'NORMAL' in p['attributes'] else None
                uv = accessor(j, bufs, p['attributes']['TEXCOORD_0']).astype(np.float64) if 'TEXCOORD_0' in p['attributes'] else None
                if 'indices' in p:
                    idx = accessor(j, bufs, p['indices']).astype(np.int64).reshape(-1, 3)
                else:
                    idx = np.arange(len(pos)).reshape(-1, 3)
                skinned = 'skin' in n
                Wm = np.eye(4) if skinned else W
                P = pos @ Wm[:3, :3].T + Wm[:3, 3]
                N = None
                if nrm is not None:
                    nm = np.linalg.inv(Wm[:3, :3]).T
                    N = nrm @ nm.T
                    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
                if np.linalg.det(Wm[:3, :3]) < 0:
                    idx = idx[:, [0, 2, 1]]
                mi = p.get('material')
                mname = mats[mi].get('name', f'mat{mi}') if mi is not None else 'default'
                out.append(dict(pos=P, nrm=N, idx=idx, uv=uv, mat=mname, matIndex=mi, node=name, chain='/'.join(chain + [name]),
                                mesh=mesh.get('name', ''), skinned=skinned, prim=pi))
        for c in n.get('children', []):
            visit(c, W, chain + [name])

    for r in scene.get('nodes', []):
        visit(r, np.eye(4), [])
    return out, j, bufs
