import os,sys,json
from pathlib import Path
import bpy,numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2];os.chdir(ROOT)
sys.path.insert(0,str(ROOT/'blender'));sys.path.insert(0,str(ROOT/'scripts/fitlab'))
import garment,garment_pants as gp
from directional_strain import directional_strain
from seam_waist import local_waist_profile
product=ROOT/'blender/products/tnt_co/ns_matrix_white'
os.environ['FITAH_PANTS_SPEC']=str(product/'build/spec.json')
cfg=json.load(open(product/'grid/cfg_2XL.json')); spec=gp.size_spec('2XL');panels,seams,info=gp.build_pants_pattern(spec);counts=garment.edge_counts(panels,seams,cfg.get('spacing',1.2))
flat=[];faces=[];edge={};depth=[]
for k,(name,edges) in enumerate(panels.items()):
 pv,pf,ids=garment.mesh_panel(edges,counts,name,cfg.get('spacing',1.2));off=len(flat)
 flat.extend((v.x*.01+k*.8,v.y*.01,0) for v in pv)
 faces.extend(tuple(off+i for i in f) for f in pf)
 for en,ii in ids.items():edge[name,en]=np.array(ii)+off
 dep,_=local_waist_profile(pv,next(f for en,f in edges if en=='waist'),1 if name.startswith('back') else 0);depth.extend(dep)
pairs=np.array(sorted({tuple(sorted((int(i),int(j)))) for a,ea,b,eb,rev in seams for i,j in zip(edge[a,ea],edge[b,eb][::-1] if rev else edge[b,eb]) if i!=j}));flat=np.array(flat);tri=np.array(faces);band=np.array(depth)<=.04+1e-8
blend=product/'grid/jeans_2XL_h175_c101.blend'
with bpy.data.libraries.load(str(blend),link=False) as (src,dst):dst.objects=['Body']
body=dst.objects[0];bodyfaces=[tuple(p.vertices) for p in body.data.polygons]
def stats(v):
 v=np.asarray(v);return {'min':float(v.min()),'mean':float(v.mean()),'p01':float(np.percentile(v,1)),'p50':float(np.median(v)),'p95':float(np.percentile(v,95)),'p99':float(np.percentile(v,99)),'max':float(v.max())}
def clearance(P,B):
 tree=BVHTree.FromPolygons([Vector(p) for p in B],bodyfaces,all_triangles=False)
 def measure(Q):
  result=[]
  for p in Q:
   loc,norm,idx,dist=tree.find_nearest(Vector(p));result.append(float((Vector(p)-loc).dot(norm))*100)
  s=np.array(result);return {'signed_cm':stats(s),'below_minus_0.1cm':int((s<-.1).sum()),'below_minus_0.2cm':int((s<-.2).sum()),'below_minus_0.5cm':int((s<-.5).sum()),'samples':len(s)}
 return {'vertices':measure(P),'band_vertices':measure(P[band]),'triangle_centres':measure(P[tri].mean(axis=1))}


import hashlib,time,re

def mesh_qc(blend_path, positions, body_points, expected_triangles):
    global bodyfaces
    if not blend_path.exists(): raise RuntimeError('Missing matching blend: '+str(blend_path))
    with bpy.data.libraries.load(str(blend_path),link=False) as (src,dst): dst.objects=['Body','Jeans']
    bo,jo=dst.objects
    bodyfaces=[tuple(p.vertices) for p in bo.data.polygons]
    actual=[tuple(p.vertices) for p in jo.data.polygons]
    meshpos=np.array([jo.matrix_world@v.co for v in jo.data.vertices])
    if len(body_points)!=len(bo.data.vertices):raise RuntimeError('Body topology vertex-count mismatch')
    bodymeshpos=np.array([bo.matrix_world@v.co for v in bo.data.vertices])
    body_delta=float(np.max(np.abs(bodymeshpos-body_points)))
    if bodymeshpos.shape!=body_points.shape or not np.allclose(bodymeshpos,body_points,rtol=0,atol=1e-7):raise RuntimeError('NPZ Body coordinates differ from matching blend collider: '+str(body_delta))
    if max(max(f) for f in bodyfaces)>=len(body_points):raise RuntimeError('Invalid body face index')
    if meshpos.shape!=positions.shape or not np.allclose(meshpos,positions,rtol=0,atol=1e-7):raise RuntimeError('NPZ vertex order/coordinates differ from matching blend')
    canonical=lambda fs:sorted(tuple(sorted(map(int,f))) for f in fs)
    if canonical(actual)!=canonical(expected_triangles):raise RuntimeError('Pattern triangles differ from matching blend')
    edges={}
    for face in actual:
        for a,b in zip(face,face[1:]+face[:1]):edges.setdefault(tuple(sorted([a,b])),[]).append(a<b)
    qc={'matching_body_vertex_count':len(body_points),'npz_matches_blend_body':True,'body_coordinate_max_delta_m':body_delta,'matching_pattern_triangles':True,'npz_matches_blend_vertices':True,'shared_edge_winding_violations':sum(len(x)==2 and x[0]==x[1] for x in edges.values()),'nonmanifold_face_edges':sum(len(x)>2 for x in edges.values()),'boundary_edges':sum(len(x)==1 for x in edges.values())}
    for ob in dst.objects:bpy.data.objects.remove(ob,do_unlink=True)
    return qc
report={'generated_unix':time.time(),'rollout_approved':False,'notes':['Nearest-oriented-body-surface signed distance is a diagnostic, not proof of collision-free geometry.','Use same pattern-derived local4cm band for each original/candidate comparison.','automated_checks_clear means no new regression detected; it does not validate pre-existing failed or unsupported samples.'],'results':{}}
for path in sorted(Path(sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else '/private/tmp/shorts-seam-pilot/held').glob('jeans_*_h*_c*.npz')):
 if not re.fullmatch(r'jeans_(S|M|L|XL|2XL)_h[0-9]+_c[0-9]+',path.stem):continue
 if os.environ.get('FITAH_AUDIT_CASES') and path.stem not in os.environ['FITAH_AUDIT_CASES'].split(','):continue
 try:
  stem=path.stem;size=stem.split('_')[1];cfg=json.load(open(product/f'grid/cfg_{size}.json'));spec=gp.size_spec(size);panels,seams,info=gp.build_pants_pattern(spec);counts=garment.edge_counts(panels,seams,cfg.get('spacing',1.2));flat=[];faces=[];edge={};depth=[]
  for k,(name,edges) in enumerate(panels.items()):
   pv,pf,ids=garment.mesh_panel(edges,counts,name,cfg.get('spacing',1.2));off=len(flat)
   flat.extend((v.x*.01+k*.8,v.y*.01,0) for v in pv);faces.extend(tuple(off+i for i in f) for f in pf)
   for en,ii in ids.items():edge[name,en]=np.array(ii)+off
   dep,_=local_waist_profile(pv,next(f for en,f in edges if en=='waist'),1 if name.startswith('back') else 0);depth.extend(dep)
  pairs=np.array(sorted({tuple(sorted((int(i),int(j)))) for a,ea,b,eb,rev in seams for i,j in zip(edge[a,ea],edge[b,eb][::-1] if rev else edge[b,eb]) if i!=j}));flat=np.array(flat);tri=np.array(faces);band=np.array(depth)<=.04+1e-8
  entries={}
  for label,file in [('original',product/'settle/belt'/path.name),('candidate',path)]:
   z=np.load(file);P=z['Jeans'];B=z['Body'];assert len(P)==len(flat);assert np.isfinite(P).all() and np.isfinite(B).all(), 'Nonfinite geometry';qc=mesh_qc(file.with_suffix('.blend'),P,B,tri)
   gap=np.linalg.norm(P[pairs[:,0]]-P[pairs[:,1]],axis=1)*100;D=directional_strain(flat,tri,P)*100
   centre_x=float(np.median(B[:,0]))
   leg_hems=[float(P[P[:,0]<centre_x,2].min()*100),float(P[P[:,0]>centre_x,2].min()*100)]
   r={'file':str(file),'mtime':file.stat().st_mtime,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'mesh_qc':qc,'seam_gap_cm':stats(gap),'directional_strain_pct':stats(D[np.isfinite(D)]),'unknown_strain_vertices':int((~np.isfinite(D)).sum()),'leg_hems_cm':leg_hems,'leg_hem_asymmetry_cm':abs(leg_hems[0]-leg_hems[1]),'band_directional_strain_pct':stats(D[band&np.isfinite(D)]),'penetration':clearance(P,B),'side_waists':{}}
   for leg in ['r','l']:
    f=int(edge['front_'+leg,'side'][-1]);b=int(edge['back_'+leg,'side'][-1]);cb=int(edge['back_'+leg,'waist'][-1]);r['side_waists'][leg]={'gap_cm':float(np.linalg.norm(P[f]-P[b])*100),'height_delta_cm':float((P[f,2]-P[b,2])*100),'centre_back_raise_cm':float((P[cb,2]-.5*(P[f,2]+P[b,2]))*100)}
   entries[label]=r
  findings=[]
  if entries['candidate']['unknown_strain_vertices']:findings.append('Unknown directional strain samples require review')
  if entries['candidate']['leg_hem_asymmetry_cm']>15:findings.append('Leg hem asymmetry exceeds existing dressing-check 15cm heuristic')
  if entries['candidate']['seam_gap_cm']['mean']>0.25:findings.append('Mean sewing separation exceeds existing 0.25cm quality heuristic')
  for leg,side in entries['candidate']['side_waists'].items():
   if side['gap_cm']>0.1 or abs(side['height_delta_cm'])>0.1:findings.append('Side-waist '+leg+' misses numerical 1mm seam-continuity tolerance')
   if abs(side['centre_back_raise_cm']-spec.get('back_top_raise',1.0))>0.2:findings.append('Centre-back '+leg+' rise differs from intended target by more than2mm')
  if entries['candidate']['mesh_qc']['shared_edge_winding_violations']:findings.append('Inconsistent face winding; repair required before collision/export')
  if entries['candidate']['penetration']['vertices']['below_minus_0.1cm']>entries['original']['penetration']['vertices']['below_minus_0.1cm']:findings.append('More vertices deeper than1mm inside oriented body surface')
  if entries['candidate']['penetration']['triangle_centres']['below_minus_0.1cm']>entries['original']['penetration']['triangle_centres']['below_minus_0.1cm']:findings.append('More triangle centres deeper than1mm inside oriented body surface')
  for sample_type in ['vertices','triangle_centres']:
   old_min=entries['original']['penetration'][sample_type]['signed_cm']['min'];new_min=entries['candidate']['penetration'][sample_type]['signed_cm']['min']
   if new_min<min(-0.1,old_min-0.1):findings.append(sample_type+' worst penetration grows by more than numerical 1mm regression tolerance')
  if entries['candidate']['directional_strain_pct']['p95']>max(entries['original']['directional_strain_pct']['p95']*1.5,entries['original']['directional_strain_pct']['p95']+3):findings.append('Large relative P95 tensile-strain increase; review simulation')
  entries['review_findings']=findings
  entries['automated_checks_clear']=not findings
  report['results'][stem]=entries
  print(stem,'SEAM',entries['original']['seam_gap_cm']['max'],'->',entries['candidate']['seam_gap_cm']['max'],'STRAIN95',entries['original']['directional_strain_pct']['p95'],'->',entries['candidate']['directional_strain_pct']['p95'],'BANDMAX',entries['candidate']['band_directional_strain_pct']['max'],'PENETRATING_VERTICES',entries['candidate']['penetration']['vertices']['below_minus_0.1cm'],'PENETRATING_FACE_CENTRES',entries['candidate']['penetration']['triangle_centres']['below_minus_0.1cm'],flush=True)
 except Exception as error:
  report['results'][path.stem]={'automated_checks_clear':False,'error':str(error),'file':str(path)}
  print('AUDIT ERROR',path,error,flush=True)
out=Path(sys.argv[sys.argv.index('--')+2] if '--' in sys.argv and len(sys.argv)>sys.argv.index('--')+2 else '/private/tmp/fitreview-shorts-reusable-audit.json');out.write_text(json.dumps(report,indent=2));print('REPORT',out,flush=True)
