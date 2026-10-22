"""Panel-axis tensile strain, evaluated from an undeformed 2D sewing pattern.

Run using Blender's Python (numpy is bundled). The columns of the deformation
map are the deformed pattern X/Y material directions. Their lengths detect
extension even when compression in the other direction preserves triangle area.
This is strain, not body pressure; directions follow the pattern grain assumption.
"""
import numpy as np


def directional_strain(flat, triangles, positions):
    flat = np.asarray(flat, dtype=np.float64)[:, :2]
    tri = np.asarray(triangles, dtype=np.int64)
    positions = np.asarray(positions, dtype=np.float64)
    rest = np.stack((flat[tri[:, 1]] - flat[tri[:, 0]], flat[tri[:, 2]] - flat[tri[:, 0]]), axis=2)
    determinant = np.linalg.det(rest)
    valid = np.isfinite(rest).all(axis=(1, 2)) & (np.abs(determinant) > 1e-12)
    inverse = np.zeros_like(rest)
    inverse[valid] = np.linalg.inv(rest[valid])
    edges = np.stack((positions[tri[:, 1]] - positions[tri[:, 0]], positions[tri[:, 2]] - positions[tri[:, 0]]), axis=2)
    deformation = edges @ inverse
    strain = np.maximum(np.linalg.norm(deformation, axis=1).max(axis=1) - 1, 0)
    valid &= np.isfinite(strain)
    weights = np.where(valid, np.abs(determinant) * .5, 0)
    strain = np.where(valid, strain, 0)
    acc = np.zeros(len(positions)); total = np.zeros(len(positions))
    for corner in range(3):
        acc += np.bincount(tri[:, corner], weights=strain * weights, minlength=len(positions))
        total += np.bincount(tri[:, corner], weights=weights, minlength=len(positions))
    out = np.full(len(positions), np.nan, dtype=np.float32)
    np.divide(acc, total, out=out, where=total > 0)
    return out
