"""Remove the small copyright line printed under a shop flat-lay photo (transparent PNG), in place.
blender -b --factory-startup -P blender/strip_photo_label.py -- <a.png> [b.png ...]
Keeps the tallest run of rows that contain the garment; clears anything separated from it by empty rows."""
import bpy, sys, numpy as np
for f in sys.argv[sys.argv.index("--") + 1:]:
    img = bpy.data.images.load(f)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    rows = (px[..., 3] > 0.05).any(axis=1)
    runs, start = [], None
    for y, r in enumerate(list(rows) + [False]):
        if r and start is None: start = y
        if not r and start is not None: runs.append((start, y)); start = None
    keep = max(runs, key=lambda r: r[1] - r[0])
    cleared = [r for r in runs if r != keep]
    for a, b in cleared:
        px[a:b, :, 3] = 0
    img.pixels[:] = px.ravel()
    img.filepath_raw = f; img.file_format = 'PNG'; img.save()
    print("STRIPPED", f.split('/')[-1], "removed", len(cleared), "bands")
