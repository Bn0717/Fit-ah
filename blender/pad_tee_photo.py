"""Shop flat-lay photo -> padded square texture for the 3D tee (any shirt colour, incl. white).
blender -b --factory-startup -P blender/pad_tee_photo.py -- <in.png> <out.jpg> [size]
Keeps pixels with alpha, drops the small print/label under the shirt (bottom 20 %), then grows the
shirt colours outward so UVs just outside the outline still land on fabric."""
import bpy, sys, numpy as np
a = sys.argv[sys.argv.index("--") + 1:]
src, dst, size = a[0], a[1], int(a[2]) if len(a) > 2 else 1024
img = bpy.data.images.load(src)
if img.size[0] != 1600:
    img.scale(1600, 1600)
w, h = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
rgb = px[..., :3].copy()
fg = px[..., 3] > 0.5
fg[: int(h * 0.2), :] = False            # rows are bottom-up: drop the label under the shirt
rgb[~fg] = 0
for _ in range(60):
    acc = np.zeros_like(rgb); cnt = np.zeros((h, w), np.float32)
    for dy, dx in ((2, 0), (-2, 0), (0, 2), (0, -2), (2, 2), (-2, -2), (2, -2), (-2, 2)):
        m = np.roll(fg, (dy, dx), axis=(0, 1)); c = np.roll(rgb, (dy, dx), axis=(0, 1))
        acc += c * m[..., None]; cnt += m
    grow = (~fg) & (cnt > 0)
    rgb[grow] = acc[grow] / cnt[grow][:, None]
    fg = fg | grow
out = bpy.data.images.new("out", w, h)
out.pixels[:] = np.dstack([rgb, np.ones((h, w, 1), np.float32)]).ravel()
out.scale(size, size)
out.filepath_raw = dst; out.file_format = 'JPEG'
bpy.context.scene.render.image_settings.quality = 85
out.save_render(dst)
print("PADDED", dst)
