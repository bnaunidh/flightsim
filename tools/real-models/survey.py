import sys, numpy as np
sys.path.insert(0, sys.argv[0].rsplit('/', 1)[0])
from gltfio import flatten
prims, j, _ = flatten(sys.argv[1])
allp = np.concatenate([p['pos'] for p in prims])
print('bbox min', allp.min(0).round(2), 'max', allp.max(0).round(2), 'ext', (allp.max(0) - allp.min(0)).round(2))
by = {}
for p in prims:
    k = p['mat']
    d = by.setdefault(k, [0, [], set()])
    d[0] += len(p['idx']); d[1].append(p['pos']); d[2].add(p['node'][:24])
for k, (t, ps, nodes) in by.items():
    a = np.concatenate(ps)
    print(f'{k[:28]:28s} tris={t:6d} min={a.min(0).round(1)} max={a.max(0).round(1)} nodes={len(nodes)} {sorted(nodes)[:4]}')
print('skinned', sum(p['skinned'] for p in prims))
