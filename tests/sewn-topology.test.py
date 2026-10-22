"""Run using Blender Python, or Python with NumPy installed."""
import sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/fitlab'))
from sewn_topology import compact_sewn_mesh

# Two oriented panels share only explicit stitching. Nearby unstitched points
# stay separate, render order stays stable, and pin membership crosses the seam.
p = np.array([[0,0,0],[1,0,0],[0,1,0], [1,0,.002],[1,1,0],[0,1,.002], [0,0,.0001]])
t = [[0,1,2],[3,4,5]]
points, faces, mapping, pins = compact_sewn_mesh(p,t,[[1,3],[2,5]],[0,1,0,0,0,0,0])
assert len(points) == 5 and mapping[1] == mapping[3] and mapping[2] == mapping[5]
assert mapping[0] != mapping[6]
assert pins[mapping[3]] == 1
assert np.array_equal(faces, mapping[np.array(t)])
expanded = points[mapping]
assert np.array_equal(expanded[1], expanded[3])
assert np.array_equal(expanded[2], expanded[5])
assert np.array_equal(p[0], expanded[0]) and np.array_equal(p[6], expanded[6])
for triangles, pairs in [([[0,1,2]], [[0,1]]), ([[0,1,2],[3,4,5]], [[0,3],[1,4],[2,5]])]:
    try: compact_sewn_mesh(p,triangles,pairs,np.zeros(7))
    except ValueError: pass
    else: raise AssertionError('Invalid compaction accepted')
print('Sewn topology tests passed')
