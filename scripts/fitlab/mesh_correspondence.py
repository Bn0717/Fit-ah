"""Resolve coincident source vertices using triangle connectivity, not position alone."""
from itertools import product


def resolve_triangle_mapping(candidates, triangles, source_triangles):
    choices = [set(values) for values in candidates]
    expected = {tuple(sorted(t)) for t in source_triangles}
    pending = [tuple(map(int, t)) for t in triangles if any(len(choices[int(i)]) > 1 for i in t)]
    while pending:
        changed = False
        for triangle in pending:
            possibilities = [p for p in product(*(choices[i] for i in triangle)) if tuple(sorted(p)) in expected]
            if not possibilities:
                raise ValueError(f'Exported triangle cannot match source topology: {triangle}')
            for corner, i in enumerate(triangle):
                narrowed = choices[i] & {p[corner] for p in possibilities}
                changed |= narrowed != choices[i]
                choices[i] = narrowed
        if not changed:
            break
        pending = [t for t in pending if any(len(choices[i]) > 1 for i in t)]
    if any(len(c) != 1 for c in choices):
        raise ValueError('Ambiguous source vertex IDs remain; do not invent fit attributes')
    mapping = [next(iter(c)) for c in choices]
    actual = sorted(tuple(sorted(mapping[int(i)] for i in t)) for t in triangles)
    # A primitive may be a subset of the source, but every triangle must correspond.
    if any(t not in expected for t in actual):
        raise ValueError('Topology mismatch after vertex correspondence')
    return mapping
