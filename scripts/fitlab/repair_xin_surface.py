"""Build isolated Xin rendering assets with a pattern-defined waistband finish.

Blender -b --factory-startup -P scripts/fitlab/repair_xin_surface.py -- L drop
Run xin_visibility.mjs first; omit arguments to build all sizes and five walks.
Original bakes, directional strain and images stay intact. Derived render
positions/normals/UVs and body-clearance samples are updated locally.
"""
import ast, gzip, hashlib, json, os, struct, sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]
os.chdir(ROOT)
os.environ.pop('FITAH_PANTS_SPEC', None)
sys.path.insert(0, str(ROOT/'blender'))
sys.path.insert(0, str(ROOT/'scripts/fitlab'))
from xin_waist_surface import prepare_waist, finish_waist, protect_waist
import garment, garment_pants as gp
from coherent_surface import orient_panels_outward
from mesh_correspondence import resolve_triangle_mapping
from pack_walk import pack, unpack

PUBLIC = ROOT/'public/models/fitlab'
XIN_PUBLIC = PUBLIC/'brands/tnt_co/xin_jeans'   # raw Xin grid/ and walk/
DEST = Path('/private/tmp/xin-surface/stage')
REPORT = Path('/private/tmp/xin-surface/repair-report.json')
TYPES = {5126:'<f4',5125:'<u4',5123:'<u2',5122:'<i2',5121:'u1'}
WIDTH = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
BODY_WALK=None

def load(path):
    b=path.read_bytes()
    if b[:2]==b'\x1f\x8b': b=gzip.decompress(b)
    length=struct.unpack_from('<I',b,12)[0]
    j=json.loads(b[20:20+length]); size=struct.unpack_from('<I',b,20+length)[0]
    return j,bytearray(b[28+length:28+length+size])

def raw(j,b,ai):
    a=j['accessors'][ai];v=j['bufferViews'][a['bufferView']]
    dtype=np.dtype(TYPES[a['componentType']]);width=WIDTH[a['type']]
    return np.ndarray((a['count'],width),dtype=dtype,buffer=b,
        offset=v.get('byteOffset',0)+a.get('byteOffset',0),
        strides=(v.get('byteStride',width*dtype.itemsize),dtype.itemsize))

def decoded(j,b,ai,scale=1):
    a=j['accessors'][ai];value=raw(j,b,ai).astype(float)
    if a.get('normalized'):
        value/=32767 if a['componentType']==5122 else 255
    return value*scale

def append_float(j,b,value):
    value=np.asarray(value,dtype='<f4')
    b.extend(b'\0'*(-len(b)%4));offset=len(b);b.extend(value.tobytes())
    vi=len(j['bufferViews']);j['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':value.nbytes})
    ai=len(j['accessors']);j['accessors'].append({'bufferView':vi,'componentType':5126,
        'count':len(value),'type':'VEC3','min':value.min(axis=0).tolist(),'max':value.max(axis=0).tolist()})
    return ai

def compact(j,b):
    """Drop replaced accessor payloads; keep every live value and image byte lossless."""
    assert not j.get('animations') and not j.get('skins')
    primitives=[p for mesh in j['meshes'] for p in mesh['primitives']]
    used=set()
    for p in primitives:
        used.update(p['attributes'].values());used.add(p['indices'])
        for t in p.get('targets',[]):used.update(t.values())
    ids=sorted(used);remap={old:new for new,old in enumerate(ids)}
    accessors=[j['accessors'][i] for i in ids]
    assert not any('sparse' in a for a in accessors)
    views=sorted({a['bufferView'] for a in accessors}|{i['bufferView'] for i in j.get('images',[]) if 'bufferView' in i})
    view_map={old:new for new,old in enumerate(views)};output=bytearray();new_views=[]
    for i in views:
        view=dict(j['bufferViews'][i]);start=view.get('byteOffset',0)
        output.extend(b'\0'*(-len(output)%4));view['byteOffset']=len(output)
        output.extend(b[start:start+view['byteLength']]);new_views.append(view)
    for p in primitives:
        p['attributes']={k:remap[v] for k,v in p['attributes'].items()};p['indices']=remap[p['indices']]
        for t in p.get('targets',[]):
            for k,v in list(t.items()):t[k]=remap[v]
    for a in accessors:a['bufferView']=view_map[a['bufferView']]
    for i in j.get('images',[]):
        if 'bufferView' in i:i['bufferView']=view_map[i['bufferView']]
    j['accessors']=accessors;j['bufferViews']=new_views
    return j,output

def write(path,j,b):
    j,b=compact(j,b)
    b.extend(b'\0'*(-len(b)%4));j['buffers'][0]['byteLength']=len(b)
    header=json.dumps(j,separators=(',',':')).encode();header+=b' '*(-len(header)%4)
    data=struct.pack('<III',0x46546c67,2,28+len(header)+len(b))+struct.pack('<II',len(header),0x4e4f534a)+header+struct.pack('<II',len(b),0x004e4942)+b
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.tmp')
    temporary.write_bytes(gzip.compress(data,compresslevel=9,mtime=0));temporary.replace(path)

def pattern(size):
    tree=ast.parse((ROOT/'blender/drape_pants.py').read_text())
    config=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CFG' for t in n.targets))
    cfg=eval(compile(ast.Expression(config.value),'config','eval'),{'dict':dict})
    cfg.update(json.loads((ROOT/f'blender/products/tnt_co/xin_jeans/work/grid/jeans_{size}_h175_c101.json').read_text()))
    panels,seams,info=gp.build_pants_pattern(gp.size_spec(size))
    counts=garment.edge_counts(panels,seams,cfg['spacing'])
    scope={'np':np,'cfg':cfg,'info':info,'L':gp.size_spec(size)['length'],'outline':json.loads(Path(cfg['outline']).read_text())}
    funcs=ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ['photo_uv','row_span']],type_ignores=[])
    exec(compile(funcs,'photo_mapping','exec'),scope)
    uv=[];faces=[];flat=[];edge_ids={}
    for name,edges in panels.items():
        points,triangles,ids=garment.mesh_panel(edges,counts,name,cfg['spacing']);offset=len(uv)
        flat.extend((p.x,p.y) for p in points)
        edge_ids[name,'all']=list(range(offset,offset+len(points)))
        for en,ii in ids.items():edge_ids[name,en]=[offset+i for i in ii]
        boundary=points[:sum(counts[name,en] for en,_ in edges)];sign=1 if name.endswith('_r') else -1
        for point in points:
            lo,hi=scope['row_span'](boundary,point.y);inner,outer=(lo,hi) if sign>0 else (-hi,-lo)
            u,v=scope['photo_uv'](name,point.x*sign,point.y,inner,outer);uv.append((u,1-v))
        faces.extend(tuple(offset+i for i in face) for face in triangles)
    pairs=[]
    for a,ea,b,eb,rev in seams:
        right=edge_ids[b,eb][::-1] if rev else edge_ids[b,eb]
        pairs.extend(zip(edge_ids[a,ea],right))
    return np.asarray(uv,dtype=np.float32),np.asarray(faces,dtype=int),prepare_waist(flat,edge_ids,pairs,faces)

def normal_field(points,faces,fallback=None,seams=()):
    face=np.cross(points[faces[:,1]]-points[faces[:,0]],points[faces[:,2]]-points[faces[:,0]])
    result=np.zeros_like(points,dtype=float)
    for corner in range(3):np.add.at(result,faces[:,corner],face)
    for group in seams:result[group]=result[group].sum(axis=0)
    lengths=np.linalg.norm(result,axis=1);bad=lengths<1e-15
    if bad.any():result[bad]=fallback[bad] if fallback is not None else np.array([0,1,0])
    result/=np.maximum(np.linalg.norm(result,axis=1)[:,None],1e-15)
    assert np.isfinite(result).all()
    return result


def triangle_quality(before,after,faces,spec):
    faces=faces[np.any(spec['affected'][faces],axis=1)]
    def vectors(p):return np.cross(p[faces[:,1]]-p[faces[:,0]],p[faces[:,2]]-p[faces[:,0]])
    old,new=vectors(before),vectors(after);a=np.linalg.norm(old,axis=1);b=np.linalg.norm(new,axis=1)
    degenerate=int(np.count_nonzero((a>1e-8)&(b<1e-10)))
    assert degenerate==0,'Finish creates a degenerate triangle'
    return dict(new_degenerate=degenerate,area_ratio_p95=float(np.percentile(b/np.maximum(a,1e-12),95)),
        normal_turns_over90=int(np.count_nonzero(np.sum(old*new,axis=1)<0)))

def walk_body():
    global BODY_WALK
    if BODY_WALK is not None:return BODY_WALK
    info=json.loads((PUBLIC/'bodies/walk/walk_body.json').read_text());track=info['objects']['WalkBody']
    data=unpack(gzip.decompress((PUBLIC/'bodies/walk/walk_body.bin.gz').read_bytes()),info['packed']['regions'])
    q=np.frombuffer(data,dtype='<i2',count=info['frames']*track['n']*3,offset=track['offset']).reshape(info['frames'],track['n'],3)
    points=np.array(track['min'])+(q.astype(float)+32768)*np.array(track['scale'])
    j,b=load(PUBLIC/'bodies/walk/walk_body.glb');triangles=[]
    for node in j['nodes']:
        if node.get('name')!='WalkBody':continue
        mesh=j['meshes'][node['mesh']]
        for p in mesh['primitives']:
            ids=np.rint(decoded(j,b,p['attributes']['_VID']).ravel()).astype(int)
            triangles.extend(ids[raw(j,b,p['indices']).reshape(-1,3)].tolist())
    assert triangles
    BODY_WALK=points,np.array(triangles);return BODY_WALK

def finish_walk(size,spec):
    info=json.loads((XIN_PUBLIC/f'walk/walk_jeans_{size}.json').read_text())
    data=bytearray(unpack(gzip.decompress((XIN_PUBLIC/f'walk/walk_jeans_{size}.bin.gz').read_bytes()),info['packed']['regions']))
    q=np.frombuffer(data,dtype='<i2',count=info['frames']*info['n']*3).reshape(info['frames'],info['n'],3)
    old=np.array(info['min'])+(q.astype(float)+32768)*np.array(info['scale'])
    body,body_faces=walk_body();results=[];changes=[];first_finished=None;garment_faces=pattern(size.removesuffix('belt'))[1]
    gaps=np.frombuffer(data,dtype='u1',count=info['frames']*info['n'],offset=info['gap_offset']).reshape(info['frames'],info['n'])
    for frame,points in enumerate(old):
        converted=np.stack([points[:,0],points[:,2],-points[:,1]],axis=1)
        finished=finish_waist(converted,spec);new=np.stack([finished[:,0],-finished[:,2],finished[:,1]],axis=1)
        changed=np.flatnonzero(np.linalg.norm(new-points,axis=1)>1e-10)
        tree=BVHTree.FromPolygons([Vector(v) for v in body[frame]],body_faces.tolist())
        # Body collision constraints are evaluated in Blender's coordinate frame.
        original_blender=points.copy();candidate_blender=new.copy()
        rotated_spec={**spec}
        new=protect_waist(original_blender,candidate_blender,rotated_spec,garment_faces,tree)
        ring_groups=[np.flatnonzero(spec['roots']==r) for r in spec['ring']]
        def perimeter(p):
            ring=np.array([p[g].mean(axis=0) for g in ring_groups])[:,:2]
            return float(np.linalg.norm(np.roll(ring,-1,axis=0)-ring,axis=1).sum())
        perimeter_delta=abs(perimeter(new)-perimeter(candidate_blender))
        assert perimeter_delta<.01,'Walk clearance projection changed waist loop over1cm'
        changed=np.flatnonzero(np.linalg.norm(new-points,axis=1)>1e-10)
        distances=[]
        for i in changed:
            loc,normal,_,distance=tree.find_nearest(Vector(new[i]));gaps[frame,i]=min(255,round(distance*100/info['gap_unit_cm']))
            oldloc,oldnormal,_,_=tree.find_nearest(Vector(points[i]))
            before=float((Vector(points[i])-oldloc).dot(oldnormal));after=float((Vector(new[i])-loc).dot(normal))
            distances.append(max(0,-after)-max(0,-before))
        quantized=np.rint((new-np.array(info['min']))/np.array(info['scale'])-32768)
        assert quantized.min()>=-32768 and quantized.max()<=32767,'Finish outside original walk bounds'
        q[frame,changed]=quantized[changed].astype('<i2')
        if frame==0:first_finished=np.stack([new[:,0],new[:,2],-new[:,1]],axis=1)
        quality=triangle_quality(points,new,garment_faces,spec)
        results.append(dict(quality=quality,frame=frame,max_shift_cm=float(np.linalg.norm(new-points,axis=1).max()*100),new_penetration_cm=max(distances,default=0)*100,clearance_deficit_cm=rotated_spec.get('_clearance_deficit_cm'),perimeter_delta_cm=perimeter_delta*100))
        changes.append(new-points)
    changes=np.array(changes)
    # The unchanged tail contains all original directional strain samples.
    original=unpack(gzip.decompress((XIN_PUBLIC/f'walk/walk_jeans_{size}.bin.gz').read_bytes()),info['packed']['regions'])
    assert data[info['strain_offset']:info['gap_offset']]==original[info['strain_offset']:info['gap_offset']]
    packed=pack(data,info['packed']['regions']);assert unpack(packed,info['packed']['regions'])==bytes(data)
    dest=DEST/'walk';dest.mkdir(parents=True,exist_ok=True)
    (dest/f'walk_jeans_{size}.bin.gz').write_bytes(gzip.compress(packed,compresslevel=9,mtime=0))
    info['render_finish']='Xin waistband only; source strain retained; body gaps refreshed'
    (dest/f'walk_jeans_{size}.json').write_text(json.dumps(info,separators=(',',':')))
    return dict(clearance_protected=True,frames=results,max_velocity_change_cm=float(np.linalg.norm(np.diff(changes,axis=0),axis=2).max()*100),
        max_acceleration_change_cm=float(np.linalg.norm(np.diff(changes,n=2,axis=0),axis=2).max()*100)),first_finished

def repair(size,mode):
    walking=mode=='walk';stem=f'walk_jeans_{size}' if walking else f'jeans_{size}'
    chart_size=size.removesuffix('belt')
    src=(XIN_PUBLIC/'walk'/f'{stem}.glb') if walking else (XIN_PUBLIC/'grid'/('' if mode=='held' else mode)/f'{stem}.glb.gz')
    dst=DEST/('walk' if walking else 'grid')/('' if mode in ['walk','held'] else mode)/f'{stem}.glb.gz'
    uv,original_faces,waist_spec=pattern(chart_size)
    source_dir=ROOT/('blender/products/tnt_co/xin_jeans/work/grid' if mode=='held' else 'blender/products/tnt_co/xin_jeans/work/settle/'+('belt' if walking else mode))
    sample=source_dir/f'jeans_{chart_size}_h175_c101.npz'
    if not sample.exists():raise FileNotFoundError(sample)
    positions=np.load(sample)['Jeans'];body_positions=np.load(sample)['Body']
    assert len(positions)==len(uv)
    # One consistent orientation per source panel, never per-face radial flipping.
    with bpy.data.libraries.load(str(sample.with_suffix('.blend'))) as (s,d):
        d.objects=['Body']
    body_source=d.objects[0];body_mesh=body_source.data
    assert len(body_mesh.vertices)==len(body_positions),'Source collider topology mismatch'
    body=bpy.data.meshes.new('XinAuditBody');body.from_pydata(body_positions.tolist(),[],[tuple(p.vertices) for p in body_mesh.polygons])
    mesh=bpy.data.meshes.new('XinCoherent');mesh.from_pydata(positions.tolist(),[],original_faces.tolist())
    orientation=orient_panels_outward(mesh,body)
    faces=np.array([tuple(p.vertices) for p in mesh.polygons]);orientation_by_face={tuple(sorted(f)):tuple(f) for f in faces}
    j,b=load(src);old_j=json.loads(json.dumps(j));old_b=bytes(b)
    primitives=[p for m in j['meshes'] for p in m['primitives']]
    fq=j['asset'].get('extras',{}).get('fq',{})
    mappings={};records=[]
    for primitive in primitives:
        attrs=primitive['attributes'];key=attrs['POSITION']
        if key in mappings:continue
        if walking:
            ids=decoded(j,b,attrs['_VID'],fq.get('_vi',1)).ravel();mapping=np.rint(ids).astype(int)
            assert np.max(np.abs(ids-mapping))<.01
        else:
            points=decoded(j,b,key);tree=KDTree(len(positions))
            for i,(x,y,z) in enumerate(positions):tree.insert(Vector((float(x),float(z),float(-y))),i)
            tree.balance();candidates=[]
            for point in points:
                near=tree.find_range(Vector(point),2e-6)
                if not near:raise ValueError('Missing source vertex identity')
                candidates.append([p[1] for p in near])
            triangles=np.concatenate([raw(j,b,p['indices']).reshape(-1,3) for p in primitives if p['attributes']['POSITION']==key])
            mapping=np.asarray(resolve_triangle_mapping(candidates,triangles,original_faces))
        assert mapping.min()>=0 and mapping.max()<len(uv)
        mappings[key]=mapping
    changed_indices=0
    for primitive in primitives:
        attrs=primitive['attributes'];mapping=mappings[attrs['POSITION']]
        triangles=raw(j,b,primitive['indices']).reshape(-1,3)
        for face in triangles:
            ids=tuple(mapping[face]);expected=orientation_by_face[tuple(sorted(ids))]
            if ids not in [expected,expected[1:]+expected[:1],expected[2:]+expected[:2]]:
                face[1],face[2]=int(face[2]),int(face[1]);changed_indices+=1
        old_uv=raw(j,b,attrs['TEXCOORD_0']);expected_uv=uv[mapping]
        assert j['accessors'][attrs['TEXCOORD_0']]['componentType']==5126
        records.append({'vertices':len(mapping),'changed_uvs':int(np.count_nonzero(np.max(np.abs(old_uv-expected_uv),axis=1)>1e-6))})
        old_uv[:]=expected_uv
    def gather(target=None):
        result=np.empty((len(uv),3));seen=np.zeros(len(uv),bool)
        for p in primitives:
            mapping=mappings[p['attributes']['POSITION']];values=decoded(j,b,p['attributes']['POSITION'])
            if target is not None:values+=decoded(j,b,p['targets'][target]['POSITION'],fq.get('pos',1))
            for i,value in zip(mapping,values):
                if seen[i] and np.max(np.abs(result[i]-value))>2e-6:raise ValueError('Split source vertices disagree')
                result[i]=value;seen[i]=True
        assert seen.all();return result
    # Finish the pattern-defined upper8cm plus sewn counterparts.
    # Keep source directional strain; resample body-clearance fields after finishing.
    originals=[gather()]+[gather(i) for i in range(len(primitives[0].get('targets',[])))]
    walk_finish,walk_base=finish_walk(size,waist_spec) if walking else (None,None)
    finished=originals if mode=='held' else [finish_waist(p,waist_spec) for p in originals]
    if walking:finished[0]=walk_base
    names=['h175_c101']+j['meshes'][0].get('extras',{}).get('targetNames',[])
    finish_report=[]
    availability=json.loads((ROOT/'output/xin-surface/availability.json').read_text())
    body_faces=[tuple(p.vertices) for p in body_mesh.polygons]
    for name,old,new in ([] if walking or mode=='held' else zip(names,originals,finished)):
        if not name.startswith('h') or availability.get(f'{size}-{mode}',{}).get(name,{}).get('hide',False):
            new[:]=old
            finish_report.append(dict(pose=name,skipped_hidden=True))
            continue
        key=name if name.startswith('h') else 'h175_c101_'+name
        body_file=source_dir/f'jeans_{chart_size}_{key}.npz'
        bp=np.load(body_file)['Body'];bp=np.stack([bp[:,0],bp[:,2],-bp[:,1]],axis=1)
        tree=BVHTree.FromPolygons([Vector(v) for v in bp],body_faces)
        def clearance(p):
            loc,normal,_,distance=tree.find_nearest(Vector(p))
            return float((Vector(p)-loc).dot(normal))
        try:new[:]=protect_waist(old,new,waist_spec,faces,tree)
        except AssertionError as error:raise ValueError(f'{size} {mode} {name}: {error}') from error
        moved=np.flatnonzero(np.linalg.norm(new-old,axis=1)>1e-10)
        before=np.array([clearance(old[i]) for i in moved]);after=np.array([clearance(new[i]) for i in moved])
        # Refresh only changed clearance samples. Directional strain remains source-simulation data.
        attr_name='_G_'+name.upper()
        gaps=np.zeros(len(uv))
        for source_id in np.flatnonzero(waist_spec['affected']):gaps[source_id]=tree.find_nearest(Vector(new[source_id]))[3]*100
        for primitive in primitives:
            attrs=primitive['attributes'];mapping=mappings[attrs['POSITION']]
            if attr_name not in attrs:continue
            out=raw(j,b,attrs[attr_name]);accessor=j['accessors'][attrs[attr_name]]
            selected=waist_spec['affected'][mapping];values=gaps[mapping[selected]]
            out[selected,0]=np.rint(values/fq['_g_']*32767) if accessor.get('normalized') else values
        # Fail rather than silently introducing a visible skin intersection.
        worst_new=float(np.min(after-before)) if len(moved) else 0
        quality=triangle_quality(old,new,faces,waist_spec)
        finish_report.append(dict(quality=quality,pose=name,max_shift_cm=float(np.linalg.norm(new-old,axis=1).max()*100),
            moved=len(moved),minimum_clearance_cm=float(after.min()*100) if len(after) else 0,
            new_penetration_cm=float(np.max(np.maximum(0,-after)-np.maximum(0,-before))*100) if len(after) else 0))
    base=finished[0];sewn_normals=waist_spec['seams'] if mode!='held' else []
    base_normal=normal_field(base,faces,seams=sewn_normals)
    target_normals=[normal_field(p,faces,base_normal,seams=sewn_normals)-base_normal for p in finished[1:]]
    for primitive in primitives:
        attrs=primitive['attributes'];mapping=mappings[attrs['POSITION']]
        attrs['POSITION']=append_float(j,b,base[mapping])
        attrs['NORMAL']=append_float(j,b,base_normal[mapping])
        for target,points,normal in zip(primitive.get('targets',[]),finished[1:],target_normals):
            target['POSITION']=append_float(j,b,(points-base)[mapping])
            target['NORMAL']=append_float(j,b,normal[mapping])
    target_count=len(target_normals)
    fq.pop('pos',None)
    # New normals are floats; retain the original packing scales for untouched data.
    fq.pop('nrm',None)
    j['asset'].setdefault('extras',{})['xin_surface_repair']={'version':2,'vertex_uv_identity':True,'coherent_panels':True,'waist_finish_cm':0 if mode=='held' else 8,'walk_clearance_protected':walking}
    # Preserve source strain and image pixels; only waistband positions and their gaps change.
    for old,new in zip([p for m in old_j['meshes'] for p in m['primitives']],primitives):
        protected={name:ai for name,ai in old['attributes'].items() if name not in ['POSITION','NORMAL','TEXCOORD_0'] and not name.startswith('_G_')}
        for ai in protected.values():assert np.array_equal(raw(old_j,old_b,ai),raw(j,b,ai))

    for image in old_j.get('images',[]):
        if 'bufferView' in image:
            v=old_j['bufferViews'][image['bufferView']];start=v.get('byteOffset',0);end=start+v['byteLength'];assert old_b[start:end]==b[start:end]
    write(dst,j,b)
    bpy.data.meshes.remove(mesh);bpy.data.meshes.remove(body);bpy.data.objects.remove(body_source)
    return {'size':size,'mode':mode,'source':str(src.relative_to(ROOT)),'output':str(dst),'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),
        'reoriented_triangles':changed_indices,'uv':records,'morphs':target_count,'orientation':orientation,'strain_images_unchanged':True,'waist_finish':finish_report,'walk_finish':walk_finish}

if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    jobs=[(s,'held') for s in ['M','L','XL','2XL']] if args==['held'] else [(s,'walk') for s in ['M','L','XL','2XL','2XLbelt']] if args==['walk'] else [tuple(args)] if args else [(s,m) for s in ['M','L','XL','2XL'] for m in ['held','drop','belt']]+[(s,'walk') for s in ['M','L','XL','2XL','2XLbelt']]
    results=[]
    for size,mode in jobs:
        result=repair(size,mode);results.append(result)
        job_report=REPORT.parent/'jobs'/f'{size}-{mode}.json';job_report.parent.mkdir(parents=True,exist_ok=True);job_report.write_text(json.dumps(result,indent=2))
        print('XIN_REPAIRED',size,mode,result['reoriented_triangles'],flush=True)
    REPORT.parent.mkdir(parents=True,exist_ok=True);REPORT.write_text(json.dumps(results,indent=2))
    print('XIN_REPAIR_COMPLETE',len(results),flush=True)
