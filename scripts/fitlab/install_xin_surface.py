"""Install validated Xin candidates into their isolated local runtime namespace.

Does not touch shared legacy grid/walk assets, commit or publish anything.
"""
import gzip,hashlib,json,shutil,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
STAGE=Path('/private/tmp/xin-surface/stage')
DEST=ROOT/'public/models/fitlab/xin-smooth'
expected={f'grid/{prefix}jeans_{size}.glb.gz' for size in ['M','L','XL','2XL'] for prefix in ['','drop/','belt/']}
expected|={f'walk/walk_jeans_{size}.{suffix}' for size in ['M','L','XL','2XL','2XLbelt'] for suffix in ['glb.gz','bin.gz','json']}
actual={str(p.relative_to(STAGE)) for p in STAGE.rglob('*') if p.is_file()}
assert actual==expected,f'Unexpected/missing candidates: {actual^expected}'
for name in expected:
 if not name.endswith('.glb.gz'):continue
 data=gzip.decompress((STAGE/name).read_bytes());length=struct.unpack_from('<I',data,12)[0]
 meta=json.loads(data[20:20+length]);repair=meta['asset']['extras']['xin_surface_repair']
 assert repair['version']==2
 if name.startswith('walk/'):assert repair['walk_clearance_protected']
manifest=[]
for name in sorted(expected):
 source=STAGE/name;target=DEST/name;target.parent.mkdir(parents=True,exist_ok=True)
 temporary=target.with_name(target.name+'.tmp');shutil.copyfile(source,temporary);temporary.replace(target)
 digest=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
 assert digest(source)==digest(target)
 manifest.append(dict(file=str(target.relative_to(ROOT)),bytes=target.stat().st_size,sha256=digest(target)))
output=ROOT/'output/xin-surface';output.mkdir(parents=True,exist_ok=True)
(output/'installed-assets.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Installed',len(manifest),'isolated Xin runtime files;',sum(x['bytes'] for x in manifest),'bytes')
