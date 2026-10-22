"""Run: Blender -b --factory-startup -P tests/directional-strain.test.py"""
from pathlib import Path
import sys, numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/fitlab'))
from directional_strain import directional_strain
flat = np.array([[0., 0.], [1., 0.], [0., 1.]])
tri = np.array([[0, 1, 2]])
def check(name, positions, expected):
    actual = directional_strain(flat, tri, positions)
    assert np.allclose(actual, expected, atol=1e-6), (name, actual, expected)
    print('PASS', name, flush=True)
P = np.column_stack((flat, np.zeros(3)))
check('identity', P, 0)
check('area-preserving extension cannot disappear', P * [1.2, 1/1.2, 1], .2)
check('compression is not tension', P * [.8, .8, 1], 0)
check('rigid rotation is not tension', P @ np.array([[0,0,1],[0,1,0],[-1,0,0]]), 0)
shear = P.copy(); shear[:,0] += .1 * shear[:,1]
check('simple shear measures axis lengths rather than principal singular strain', shear, np.sqrt(1.01)-1)
assert np.isnan(directional_strain(np.zeros((3,2)), tri, P)).all()
print('PASS degenerate rest triangles remain unknown', flush=True)
from mesh_correspondence import resolve_triangle_mapping
assert resolve_triangle_mapping([[0,3],[1],[2],[0,3],[4],[5]], [[0,1,2],[3,4,5]], [[0,1,2],[3,4,5]]) == [0,1,2,3,4,5]
print('PASS coincident vertices resolved using topology', flush=True)
try:
    resolve_triangle_mapping([[0],[1],[2]], [[0,1,2]], [[0,1,3]])
except ValueError:
    print('PASS mismatched topology rejected', flush=True)
else:
    raise AssertionError('Topology mismatch was accepted')
