"""Compact explicit sewing components for simulation; retain a lossless render map."""
import numpy as np

def compact_sewn_mesh(positions, triangles, sewing_pairs, pin_weights):
    positions = np.asarray(positions, dtype=float)
    triangles = np.asarray(triangles, dtype=int)
    weights = np.asarray(pin_weights, dtype=float)
    n = len(positions)
    if positions.shape != (n, 3) or weights.shape != (n,) or not np.isfinite(positions).all():
        raise ValueError('Invalid sewing inputs')
    parent = list(range(n))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for a, b in sewing_pairs:
        a, b = int(a), int(b)
        if not (0 <= a < n and 0 <= b < n):
            raise ValueError('Sewing index outside source mesh')
        parent[find(b)] = find(a)
    roots = [find(i) for i in range(n)]
    index = {root: i for i, root in enumerate(dict.fromkeys(roots))}
    mapping = np.array([index[r] for r in roots], dtype=np.int32)
    count = len(index)
    totals = np.bincount(mapping, minlength=count)
    points = np.stack([np.bincount(mapping, weights=positions[:, j], minlength=count) / totals for j in range(3)], axis=1)
    pins = np.zeros(count)
    np.maximum.at(pins, mapping, weights)
    faces = mapping[triangles]
    if any(len(set(f)) != 3 for f in faces):
        raise ValueError('Sewing collapsed a source triangle')
    if len({tuple(sorted(f)) for f in faces}) != len(faces):
        raise ValueError('Sewing created duplicate faces')
    edges = {}
    for face in faces:
        for a, b in zip(face, np.roll(face, -1)):
            edges.setdefault(tuple(sorted((int(a), int(b)))), []).append((int(a), int(b)))
    if any(len(v) > 2 for v in edges.values()):
        raise ValueError('Sewing created nonmanifold edge')
    if any(len(v) == 2 and v[0] == v[1] for v in edges.values()):
        raise ValueError('Sewing created inconsistent winding')
    return points, faces, mapping, pins
