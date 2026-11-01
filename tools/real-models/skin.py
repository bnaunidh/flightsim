"""
Rigged downloads (a glTF skin and its animation clips), read as data only:
the joints' matrices at any time of any clip, and the skinned mesh posed by
them (linear blend skinning, as the GPU does it). Nothing here runs code
from the file; gltfio.py reads the arrays.

  rig = Rig(path)
  rig.clips                     {name: duration seconds}
  rig.joint_mats(clip, t, over) (J,4,4) joint world matrices x inverse bind
  rig.posed(clip, t, over)      [(prim, pos (N,3), nrm (N,3))] for the skinned prims

`over` overrides a joint's local rotation by name (a quaternion multiplied
after the clip's own): how a rig drawn in a T-pose with no clips is stood
with its arms down (the guard).
"""
import numpy as np
from gltfio import load, accessor, quat_mat, flatten


def quat_mul(a, b):
    x1, y1, z1, w1 = a
    x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                     w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                     w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
                     w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])


def axis_quat(axis, deg):
    a = np.asarray(axis, dtype=np.float64)
    a = a / np.linalg.norm(a)
    h = np.radians(deg) / 2
    return np.array([*(a * np.sin(h)), np.cos(h)])


def slerp(a, b, u):
    d = float(np.dot(a, b))
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        q = a + (b - a) * u
        return q / np.linalg.norm(q)
    th = np.arccos(d)
    return (np.sin((1 - u) * th) * a + np.sin(u * th) * b) / np.sin(th)


class Rig:
    def __init__(self, path):
        self.path = path
        self.j, self.bufs = load(path)
        j = self.j
        self.nodes = j['nodes']
        self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get('children', []):
                self.parent[c] = i
        sk = j['skins'][0]
        self.joints = sk['joints']
        self.ibm = accessor(j, self.bufs, sk['inverseBindMatrices']).astype(np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)
        self.clips = {}
        self._chan = {}
        for a in j.get('animations', []):
            name = a.get('name', 'clip')
            ch = {}
            dur = 0
            for c in a['channels']:
                s = a['samplers'][c['sampler']]
                t = accessor(j, self.bufs, s['input']).astype(np.float64).reshape(-1)
                v = accessor(j, self.bufs, s['output']).astype(np.float64)
                v = v.reshape(len(t), -1)
                ch[(c['target']['node'], c['target']['path'])] = (t, v)
                dur = max(dur, float(t.max()))
            self.clips[name] = dur
            self._chan[name] = ch
        self.byname = {n.get('name', ''): i for i, n in enumerate(self.nodes)}

    def _sample(self, ch, t, path):
        tt, v = ch
        if len(tt) == 1 or t <= tt[0]:
            return v[0]
        if t >= tt[-1]:
            return v[-1]
        k = int(np.searchsorted(tt, t) - 1)
        u = (t - tt[k]) / max(tt[k + 1] - tt[k], 1e-9)
        if path == 'rotation':
            return slerp(v[k] / np.linalg.norm(v[k]), v[k + 1] / np.linalg.norm(v[k + 1]), u)
        return v[k] + (v[k + 1] - v[k]) * u

    def local(self, i, clip, t, over):
        n = self.nodes[i]
        if 'matrix' in n:
            return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
        T = np.array(n.get('translation', [0, 0, 0]), dtype=np.float64)
        Rq = np.array(n.get('rotation', [0, 0, 0, 1]), dtype=np.float64)
        S = np.array(n.get('scale', [1, 1, 1]), dtype=np.float64)
        ch = self._chan.get(clip) or {}
        if (i, 'translation') in ch:
            T = self._sample(ch[(i, 'translation')], t, 'translation')
        if (i, 'rotation') in ch:
            Rq = self._sample(ch[(i, 'rotation')], t, 'rotation')
        if (i, 'scale') in ch:
            S = self._sample(ch[(i, 'scale')], t, 'scale')
        name = n.get('name', '')
        for k, q in (over or {}).items():
            # by name, or by a prefix ending in '*' (the downloads number their bones: 'mixamorig:LeftArm_00')
            if name == k or (k.endswith('*') and name.startswith(k[:-1])):
                Rq = quat_mul(Rq, q)
        m = np.eye(4)
        m[:3, :3] = quat_mat(Rq / np.linalg.norm(Rq)) * S
        m[:3, 3] = T
        return m

    def world(self, clip=None, t=0.0, over=None):
        W = {}

        def w(i):
            if i in W:
                return W[i]
            L = self.local(i, clip, t, over)
            p = self.parent.get(i)
            W[i] = (w(p) @ L) if p is not None else L
            return W[i]
        for i in range(len(self.nodes)):
            w(i)
        return W

    def joint_mats(self, clip=None, t=0.0, over=None):
        W = self.world(clip, t, over)
        return np.stack([W[jn] @ self.ibm[k] for k, jn in enumerate(self.joints)])

    def skinned_prims(self):
        """The skinned primitives with their joints and weights (bind-space positions)."""
        j, bufs = self.j, self.bufs
        out = []
        for ni, n in enumerate(self.nodes):
            if 'skin' not in n or 'mesh' not in n:
                continue
            mesh = j['meshes'][n['mesh']]
            for pi, p in enumerate(mesh['primitives']):
                A = p['attributes']
                pos = accessor(j, bufs, A['POSITION']).astype(np.float64)
                nrm = accessor(j, bufs, A['NORMAL']).astype(np.float64) if 'NORMAL' in A else None
                uv = accessor(j, bufs, A['TEXCOORD_0']).astype(np.float64) if 'TEXCOORD_0' in A else None
                J = accessor(j, bufs, A['JOINTS_0']).astype(np.int64)
                Wt = accessor(j, bufs, A['WEIGHTS_0']).astype(np.float64)
                Wt = Wt / np.maximum(Wt.sum(1, keepdims=True), 1e-9)
                idx = accessor(j, bufs, p['indices']).astype(np.int64).reshape(-1, 3) if 'indices' in p else np.arange(len(pos)).reshape(-1, 3)
                mi = p.get('material')
                mname = j['materials'][mi].get('name', f'mat{mi}') if mi is not None else 'default'
                out.append(dict(pos=pos, nrm=nrm, uv=uv, joints=J, weights=Wt, idx=idx, mat=mname, matIndex=mi, node=n.get('name', ''), prim=pi))
        return out

    @staticmethod
    def skin(prim, M):
        """Positions and normals of one skinned prim under joint matrices M (J,4,4)."""
        J, Wt = prim['joints'], prim['weights']
        P = np.concatenate([prim['pos'], np.ones((len(prim['pos']), 1))], 1)
        S = np.einsum('vk,vkab->vab', Wt, M[J])  # (V,4,4)
        pos = np.einsum('vab,vb->va', S, P)[:, :3]
        nrm = None
        if prim['nrm'] is not None:
            nrm = np.einsum('vab,vb->va', S[:, :3, :3], prim['nrm'])
            nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
        return pos, nrm

    def posed(self, clip=None, t=0.0, over=None):
        M = self.joint_mats(clip, t, over)
        return [(p, *self.skin(p, M)) for p in self.skinned_prims()]
