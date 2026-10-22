"""Restore NS Matrix photo UVs by stable pattern vertex identity. No physics changes.
Run with Blender -b --factory-startup -P scripts/fitlab/repair_shorts_uv.py.
Backups/reports are outside the repository; re-running is safe.
"""
import ast, gzip, json, os, struct, sys, shutil
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree
ROOT = Path(__file__).resolve().parents[2]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT / 'blender'))
sys.path.insert(0, str(ROOT / 'scripts/fitlab'))
import garment, garment_pants as gp
from mesh_correspondence import resolve_triangle_mapping
BACKUP = Path('/private/tmp/fitah-shorts-surface-backup')
BACKUP.mkdir(exist_ok=True)

def definitions(path, names, scope):
    tree = ast.parse(path.read_text())
    module = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])
    exec(compile(module, str(path), 'exec'), scope)

def read(path):
    b = path.read_bytes()
    if b[:2] == b'\x1f\x8b': b = gzip.decompress(b)
    n = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20+n]), bytearray(b[28+n:])

def values(j, data, index):
    a = j['accessors'][index]; v = j['bufferViews'][a['bufferView']]
    dt = np.dtype({5126:'<f4',5125:'<u4',5123:'<u2',5122:'<i2',5121:'u1'}[a['componentType']])
    width = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    return np.ndarray((a['count'],width), dtype=dt, buffer=data,
        offset=v.get('byteOffset',0)+a.get('byteOffset',0), strides=(v.get('byteStride',width*dt.itemsize),dt.itemsize)).copy()

def write(path, j, data):
    js = json.dumps(j,separators=(',',':')).encode(); js += b' '*(-len(js)%4)
    binary = struct.pack('<III',0x46546c67,2,28+len(js)+len(data))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(data),0x004e4942)+data
    path.write_bytes(gzip.compress(binary,compresslevel=9,mtime=0) if path.suffix=='.gz' else binary)

reports=[]
for size in ['S','M','L','XL','2XL']:
    product=ROOT/'blender/products/ns_matrix_white'
    cfg=json.loads((product/f'grid/cfg_{size}.json').read_text())
    os.environ['FITAH_PANTS_SPEC']=str(product/'build/spec.json')
    panels,seams,info=gp.build_pants_pattern(gp.size_spec(size))
    outline=json.loads((product/'build/pants_outline.json').read_text())
    scope={'np':np,'cfg':cfg,'info':info,'L':gp.size_spec(size)['length'],'outline':outline}
    definitions(ROOT/'blender/drape_pants.py', {'photo_uv','row_span'}, scope)
    counts=garment.edge_counts(panels,seams,cfg.get('spacing',1.2))
    uv=[]; faces=[]
    for name,edges in panels.items():
        pv,pf,ids=garment.mesh_panel(edges,counts,name,cfg.get('spacing',1.2)); offset=len(uv)
        boundary=pv[:sum(counts[(name,en)] for en,_ in edges)]
        sign=1 if name.endswith('_r') else -1
        for v in pv:
            lo,hi=scope['row_span'](boundary,v.y)
            inner,outer=(lo,hi) if sign>0 else (-hi,-lo)
            u,vv=scope['photo_uv'](name,v.x*sign,v.y,inner,outer)
            uv.append([u,1-vv])
        faces.extend(tuple(offset+i for i in f) for f in pf)
    uv=np.asarray(uv,dtype=np.float32); faces=np.asarray(faces)
    base=np.load(product/f'settle/belt/jeans_{size}_h175_c101.npz')['Jeans']
    assert len(uv)==len(base)
    tree=KDTree(len(base))
    for i,p in enumerate(base): tree.insert(Vector((float(p[0]),float(p[2]),float(-p[1]))),i)
    tree.balance()
    hem={'np':np}; definitions(ROOT/'blender/fix_pants_hem_uv.py', {'leg_maps','remap'},hem)
    for walking in [False,True]:
        folder=ROOT/('public/models/fitlab/walk/ns_matrix_white' if walking else 'public/models/fitlab/products/ns_matrix_white/belt')
        stem=f'walk_jeans_{size}.glb' if walking else f'jeans_{size}.glb'
        for path in [folder/stem,folder/(stem+'.gz')]:
            if not path.exists(): continue
            j,data=read(path); old=bytes(data); allowed=[]; mappings=[]
            mats=[m.get('name','') for m in j['materials']]
            for mesh in j['meshes']:
                for primitive in mesh['primitives']:
                    attrs=primitive['attributes']; olduv=values(j,data,attrs['TEXCOORD_0'])
                    if walking:
                        ai=attrs['_VID']; ids=values(j,data,ai).ravel().astype(float)
                        if j['accessors'][ai].get('normalized'): ids=ids/32767*j['asset']['extras']['fq']['_vi']
                        mapping=np.rint(ids).astype(int)
                    else:
                        vertices=values(j,data,attrs['POSITION']); candidates=[]
                        for p in vertices:
                            nearby=tree.find_range(Vector(p),1e-7)
                            if not nearby: raise RuntimeError('Unmapped source vertex')
                            candidates.append([candidate[1] for candidate in nearby])
                        indices=values(j,data,primitive['indices']).ravel().reshape(-1,3)
                        mapping=resolve_triangle_mapping(candidates,indices,faces)
                    new=uv[np.asarray(mapping)]
                    # Keep the existing intentional slanted-photo hem correction, consistently per vertex.
                    side='back' if 'back' in mats[primitive['material']] else 'front'
                    if j['asset'].get('extras',{}).get('hem_uv_fixed'):
                        new,_=hem['remap'](new,outline[side],hem['leg_maps'](outline[side]))
                    a=j['accessors'][attrs['TEXCOORD_0']]; view=j['bufferViews'][a['bufferView']]
                    assert a['componentType']==5126 and view.get('byteStride',8)==8
                    offset=view.get('byteOffset',0)+a.get('byteOffset',0); length=len(new)*8
                    data[offset:offset+length]=new.astype('<f4').tobytes(); allowed.append((offset,length)); mappings.append((np.asarray(mapping),new))
            # Confirm all geometry, normals, morphs, fit fields, indices and image bytes stayed identical.
            restored=bytearray(data)
            for offset,length in allowed: restored[offset:offset+length]=old[offset:offset+length]
            assert bytes(restored)==old
            destination=BACKUP/path.relative_to(ROOT);destination.parent.mkdir(parents=True,exist_ok=True)
            if not destination.exists():shutil.copy2(path,destination)
            j['asset'].setdefault('extras',{})['uv_vertex_identity_fixed']=True
            write(path,j,data)
            # Every duplicate source vertex within each primitive must have one UV.
            for mapping,new in mappings:
                seen={}
                for i,source_id in enumerate(mapping):
                    if int(source_id) in seen: assert np.allclose(new[i],seen[int(source_id)],atol=1e-7)
                    seen[int(source_id)]=new[i]
            reports.append({'file':str(path.relative_to(ROOT)),'only_uv_bytes_changed':True})
            print('UV FIX',path.relative_to(ROOT),flush=True)
Path('/private/tmp/fitah-shorts-uv-repair.json').write_text(json.dumps(reports,indent=2))
