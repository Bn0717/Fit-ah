"""Waistband target geometry derived from local pattern edges, with sewn pin constraints."""
import numpy as np

def local_waist_profile(points, waist_edge, back_raise_cm=0.0):
    side, centre = waist_edge(0.0), waist_edge(1.0)
    x = np.array([p.x for p in points]); y = np.array([p.y for p in points])
    delta = centre.x - side.x
    if abs(delta) < 1e-9: raise ValueError('Vertical waist edge cannot define band depth')
    t = np.clip((x - side.x) / delta, 0.0, 1.0)
    local_top = side.y + t * (centre.y - side.y)
    return (local_top-y)*0.01, t*back_raise_cm*0.01

def share_sewn_pin_targets(goals, pairs, pinned):
    """One goal per sewing component; extend pin membership to sewn counterparts.
    Keeps intentional centre-back rise; unrelated vertices/garment geometry stay untouched.
    """
    result = np.asarray(goals).copy(); parent = np.arange(len(result))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return int(i)
    for a,b in pairs:
        ra,rb=find(int(a)),find(int(b))
        if ra!=rb:parent[rb]=ra
    components={}
    for i in set(np.asarray(pairs).ravel().tolist()):components.setdefault(find(i),[]).append(i)
    pinned=set(map(int,pinned)); expanded=set(pinned)
    for members in components.values():
        active=[i for i in members if i in pinned]
        if active:
            result[members]=result[active].mean(axis=0); expanded.update(members)
    return result,sorted(expanded)

def _pin_components(count, pairs, pinned):
    parent = list(range(count))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for a, b in pairs:
        a, b = find(int(a)), find(int(b))
        if a != b: parent[b] = a
    roots = {find(int(i)) for i in pinned}; groups = {}
    for i in range(count):
        root = find(i)
        if root in roots: groups.setdefault(root, []).append(i)
    return list(groups.values())

def clear_pinned_goals(goals, pairs, pinned, tree, centre, minimum=0.001, clearance=0.0035):
    """Project only unsafe sewing-connected goals outwards, at exactly the same height.

    Sparse angular body samples can miss the true skin. Find the exact radial skin
    intersection, then bracket/bisect until nearest oriented clearance is sufficient.
    Already-safe goals, intentional back rise and non-pinned geometry are unchanged.
    """
    from mathutils import Vector
    result = np.asarray(goals).copy(); moved = 0; moved_vertices = 0; max_shift = 0.0
    before = []; after = []
    def signed(point):
        loc, normal, _, _ = tree.find_nearest(Vector(point))
        if loc is None: raise ValueError('No body surface for waistband goal')
        distance = float((Vector(point)-loc).dot(normal))
        if not np.isfinite(distance): raise ValueError('Nonfinite waistband body clearance')
        return distance
    for members in _pin_components(len(result), pairs, pinned):
        point = result[members[0]].copy()
        if not np.allclose(result[members], point, rtol=0, atol=1e-8):
            raise ValueError('Sewn pin goals must be shared before clearance projection')
        distance = signed(point); before.append(distance)
        if distance >= minimum:
            after.append(distance); continue
        origin = np.array([centre[0], centre[1], point[2]], dtype=float)
        if signed(origin) >= 0: raise ValueError('Waistband radial origin must be inside the torso')
        direction = point-origin; direction[2] = 0
        radius = float(np.linalg.norm(direction))
        if radius < 1e-8: raise ValueError('Waistband goal lies on radial origin')
        direction /= radius
        hit, _, _, hit_distance = tree.ray_cast(Vector(origin), Vector(direction), 1.0)
        if hit is None: raise ValueError('No same-height body intersection for waistband goal')
        low = max(radius, float(hit_distance)); high = low + clearance + .01
        while signed(origin+direction*high) < clearance:
            high += .01
            if high > 1.0: raise ValueError('Could not clear body at waistband goal height')
        for _ in range(28):
            mid = (low+high)*.5
            if signed(origin+direction*mid) < clearance: low = mid
            else: high = mid
        fixed = origin+direction*(high+2e-6); fixed[2] = point[2]
        actual = signed(fixed)
        if actual < clearance-1e-6: raise ValueError('Waistband clearance projection failed')
        result[members] = fixed; after.append(actual); moved += 1; moved_vertices += len(members)
        max_shift = max(max_shift, float(np.linalg.norm(fixed-point)))
    return result, dict(moved_components=moved, moved_vertices=moved_vertices,
        max_shift_cm=max_shift*100, minimum_before_cm=min(before)*100,
        minimum_after_cm=min(after)*100)
