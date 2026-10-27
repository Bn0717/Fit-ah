"""Use shared, de-lit garment albedo in static and walking NS Matrix models.
The original source photos and all GLB binary data remain untouched.
Run: python3 scripts/fitlab/apply_shorts_albedo.py
"""
import gzip, json, os, shutil, struct
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
BACKUP = Path('/private/tmp/fitah-shorts-albedo-backup')
PRODUCT = 'public/models/fitlab/brands/tnt_co/ns_matrix_white'
def apply_albedo(path, *, source_uv_fixed=False):
    path = Path(path).resolve()
    if 'ns_matrix_white' not in path.parts:
        raise ValueError('This albedo is only for the NS Matrix product')
    for side in ['front', 'back']:
        assert (ROOT/PRODUCT/f'albedo_{side}_v1.png').is_file()
    raw=path.read_bytes()
    raw=gzip.decompress(raw) if raw[:2]==b'\x1f\x8b' else raw
    length=struct.unpack_from('<I',raw,12)[0]
    model=json.loads(raw[20:20+length]); binary=raw[28+length:]
    for image in model.get('images',[]):
        name=image.get('name','')
        side='front' if 'front' in name else 'back' if 'back' in name else None
        if not side: raise ValueError(f'Unexpected texture: {name}')
        image.pop('bufferView',None)
        image['uri']=f'../albedo_{side}_v1.png'   # belt/ and walk/ both sit directly inside the product folder
        image['mimeType']='image/png'
    model['asset'].setdefault('extras',{})['albedo_version']=1
    if source_uv_fixed:
        model['asset']['extras']['uv_vertex_identity_fixed']=True
    encoded=json.dumps(model,separators=(',',':')).encode()
    encoded+=b' '*(-len(encoded)%4)
    result=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
    assert result[28+len(encoded):]==binary
    relative=path.relative_to(ROOT) if path.is_relative_to(ROOT) else Path('staged')/('walk' if path.parent.name == 'walk' else 'static')/path.name
    backup=BACKUP/relative
    backup.parent.mkdir(parents=True,exist_ok=True)
    if not backup.exists(): shutil.copy2(path,backup)
    path.write_bytes(gzip.compress(result,compresslevel=9,mtime=0) if path.suffix=='.gz' else result)
    print('ALBEDO',relative)
    return {'file':str(relative),'binary_unchanged':True}

if __name__ == '__main__':
    paths = list((ROOT/PRODUCT/'belt').glob('jeans_*.glb*'))
    paths += list((ROOT/'public/models/fitlab/brands/tnt_co/ns_matrix_white/walk').glob('walk_jeans_*.glb*'))
    report = [apply_albedo(path) for path in sorted(paths)]
    Path('/private/tmp/shorts-albedo-report.json').write_text(json.dumps(report,indent=2))
