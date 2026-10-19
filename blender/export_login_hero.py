"""Light 3D model for the login page: the layered walk (shirt M over jeans M) frozen in a relaxed pose,
plus the arms-out poses as shape keys so the page can lift the arms while scrolling.

blender -b blender/runs/walk_MJ.blend -P blender/export_login_hero.py -- <out_dir> [base_frame arms_frames...]
Writes <out_dir>/hero.glb (body, hair, shoes, jeans, shirt; shape keys "arms1", "arms2", ...)
and <out_dir>/tee.glb (the shirt alone in the arms-out pose, to float on its own).
"""
import bpy, sys, os
import numpy as np

a = sys.argv[sys.argv.index("--") + 1:]
out_dir = a[0]
frames = [int(x) for x in a[1:]] or [70, 61, 56]   # 52 has a bulge in the back hem
os.makedirs(out_dir, exist_ok=True)
s = bpy.context.scene
NAMES = ["Body", "Eyebrow", "Hair", "Shoe_L", "Shoe_R", "Jeans", "Shirt"]


def world_positions(o):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    m = ev.to_mesh()
    P = np.empty(len(m.vertices) * 3, dtype=np.float32)
    m.vertices.foreach_get("co", P)
    ev.to_mesh_clear()
    W = np.array(o.matrix_world)
    return (P.reshape(-1, 3) @ W[:3, :3].T + W[:3, 3]).astype(np.float32)


# step through the frames in order so the cloth cache plays forward
want = sorted(set(frames))
pos = {}
for f in range(1, max(want) + 1):
    s.frame_set(f)
    if f in want:
        pos[f] = {n: world_positions(bpy.data.objects[n]) for n in NAMES}

# static copies at the base frame (evaluated mesh: modifiers applied, world space)
s.frame_set(frames[0])
dg = bpy.context.evaluated_depsgraph_get()
new = {}
for n in NAMES:
    o = bpy.data.objects[n]
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=False, depsgraph=dg)
    me.transform(o.matrix_world)
    for attr in [x.name for x in me.attributes if x.name.startswith("_") or x.name in ("FitMap",)]:
        me.attributes.remove(me.attributes[attr])
    c = bpy.data.objects.new(n + "_static", me)
    s.collection.objects.link(c)
    new[n] = c
    base = pos[frames[0]][n]
    assert len(me.vertices) == len(base), (n, len(me.vertices), len(base))

# keep only the static copies
for o in list(bpy.data.objects):
    if o not in new.values():
        bpy.data.objects.remove(o)
for n, c in new.items():
    c.name = n


def add_keys(c, n):
    c.shape_key_add(name="Basis")
    for i, f in enumerate(frames[1:], 1):
        k = c.shape_key_add(name=f"arms{i}")
        k.data.foreach_set("co", pos[f][n].ravel())


for img in bpy.data.images:
    cap = 512 if any(k in img.name.lower() for k in ("hair", "shoes", "black")) else 1024   # small on screen
    if img.size[0] > cap:
        img.scale(cap, int(img.size[1] * cap / img.size[0]))
for m in new["Shirt"].data.materials:
    m.use_backface_culling = False

# glTF cannot express the jeans' photo x tiled-denim mix, and the exporter then picked the small tiled
# detail texture as the colour (a checker pattern on the leg). Use the photo straight as the colour.
for m in set(new["Jeans"].data.materials):
    nt = m.node_tree
    keep = next(n.name for n in nt.nodes if n.type == 'TEX_IMAGE' and 'pants' in n.image.name)
    for name in [n.name for n in nt.nodes if n.type in ('MIX', 'MAP_RANGE', 'BUMP', 'NEW_GEOMETRY', 'MAPPING', 'UVMAP')
                 or (n.type == 'TEX_IMAGE' and n.name != keep)]:
        nt.nodes.remove(nt.nodes[name])          # removing nodes invalidates other node references: look up by name
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    nt.links.new(nt.nodes[keep].outputs['Color'], bsdf.inputs['Base Color'])


def export(path, objs, keys):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False,
        export_morph=keys, export_morph_normal=False, export_yup=True,
        export_image_format='JPEG', export_jpeg_quality=85,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
    print("EXPORTED", path, round(os.path.getsize(path) / 1e6, 2), "MB")


# the floating tee: the shirt alone in the most arms-out pose
tee = new["Shirt"].copy()
tee.data = new["Shirt"].data.copy()
tee.data.vertices.foreach_set("co", pos[frames[-1]]["Shirt"].ravel())
s.collection.objects.link(tee)
export(os.path.join(out_dir, "tee.glb"), [tee], False)
bpy.data.objects.remove(tee)

for n, c in new.items():
    add_keys(c, n)
export(os.path.join(out_dir, "hero.glb"), list(new.values()), True)
