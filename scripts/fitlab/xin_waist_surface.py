"""Pattern-defined render finish for Xin's sewn waistband (not a cloth solver).

Only the upper 8cm can move. Original sewing membership closes the top seams;
a fixed circular filter removes alternating top-edge teeth without flattening
intentional front/back rise. Body clearance is checked by the asset builder.
"""
import numpy as np

def prepare_waist(points, edges, sewing_pairs, triangles):
    n=len(points);parent=np.arange(n)
    def find(i):
        while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
        return int(i)
    for a,b in sewing_pairs:
        a,b=find(a),find(b);parent[b]=a
    roots=np.array([find(i) for i in range(n)])
    groups=[np.flatnonzero(roots==r) for r in np.unique(roots)]
    waist_edges=[ids for (panel,name),ids in edges.items() if name=='waist']
    ring_graph={}
    for ids in waist_edges:
        for a,b in zip(ids,ids[1:]):
            a,b=roots[a],roots[b]
            if a!=b:ring_graph.setdefault(a,set()).add(b);ring_graph.setdefault(b,set()).add(a)
    assert all(len(v)==2 for v in ring_graph.values()),'Waist must be one sewn loop'
    start=next(iter(ring_graph));ring=[start];previous=None;current=start
    while True:
        nxt=next(v for v in sorted(ring_graph[current]) if v!=previous)
        if nxt==start:break
        assert nxt not in ring
        ring.append(nxt);previous,current=current,nxt
    assert len(ring)==len(ring_graph)
    ring_index={r:i for i,r in enumerate(ring)}
    # Pattern space, not deformed height, determines membership and stable weights.
    band=np.zeros(n);nearest=np.zeros(n,dtype=int)
    for (panel,name),ids in edges.items():
        if name!='waist':continue
        members=edges[panel,'all'];top=np.asarray(points)[ids]
        for i in members:
            distances=np.linalg.norm(top-np.asarray(points)[i],axis=1);q=int(np.argmin(distances));d=distances[q]*.01
            t=np.clip((.08-d)/.04,0,1);band[i]=t*t*(3-2*t);nearest[i]=ring_index[roots[ids[q]]]
    # A sewing counterpart is part of the same band even at the taper boundary.
    for group in groups:
        if len(group)>1:band[group]=band[group].max()
    affected=band>0
    seam_groups=[g for g in groups if len(g)>1 and affected[g].any()]
    adjacency=[set() for _ in range(n)]
    for face in triangles:
        for a,b in zip(face,np.roll(face,-1)):
            a,b=int(roots[a]),int(roots[b]);adjacency[a].add(b);adjacency[b].add(a)
    active_roots=[int(r) for r in np.unique(roots[affected])]
    root_members={r:np.flatnonzero(roots==r) for r in active_roots}
    return dict(adjacency=adjacency,active_roots=active_roots,root_members=root_members,ring=ring,groups=groups,seams=seam_groups,roots=roots,band=band,nearest=nearest,affected=affected)

def finish_waist(points,spec):
    result=np.asarray(points,dtype=float).copy();original=result.copy()
    for g in spec['seams']:
        # All vertices in a top sewing component share the same render point.
        result[g]=result[g].mean(axis=0)
    ring=np.array([result[np.flatnonzero(spec['roots']==r)].mean(axis=0) for r in spec['ring']])
    before=ring.copy();smooth=ring.copy()
    # Circular low pass removes teeth; restore the closed projected circumference below.
    for _ in range(5):smooth=.5*smooth+.25*(np.roll(smooth,1,axis=0)+np.roll(smooth,-1,axis=0))
    # Restore the closed horizontal loop length after removing high-frequency jitter.
    axes=[0,2];centre=smooth[:,axes].mean(axis=0)
    perimeter=lambda p:np.linalg.norm(np.roll(p[:,axes],-1,axis=0)-p[:,axes],axis=1).sum()
    smooth[:,axes]=centre+(smooth[:,axes]-centre)*(perimeter(before)/perimeter(smooth))
    correction=smooth-before
    result+=correction[spec['nearest']]*spec['band'][:,None]
    for g in spec['seams']:result[g]=result[g].mean(axis=0)
    # Fair adjacent side-band rows as one sewn surface. Taubin's alternating steps
    # suppress triangle-scale corrugation without repeated shrinking of the waist.
    fixed_ring={int(r):result[np.flatnonzero(spec['roots']==r)].mean(axis=0) for r in spec['ring']}
    for _ in range(8):
        for step in (.5,-.53):
            previous=result.copy()
            for r in spec['active_roots']:
                members=spec['root_members'][r]
                if r in fixed_ring:result[members]=fixed_ring[r];continue
                neighbors=list(spec['adjacency'][r])
                if not neighbors:continue
                delta=previous[neighbors].mean(axis=0)-previous[members].mean(axis=0)
                result[members]=previous[members]+delta*step*float(spec['band'][members].min())
    assert np.array_equal(result[~spec['affected']],original[~spec['affected']]),'Outside waistband changed'
    assert np.isfinite(result).all()
    return result

def protect_waist(original,finished,spec,faces,tree):
    """Keep the render finish from adding skin intersections, including face centres.

    Existing source penetration is not hidden or represented as a solver repair.
    Corrections use original sewing components and stay inside the rest-pattern band.
    """
    from mathutils import Vector
    result=finished.copy();affected=spec['affected']
    triangles=np.asarray(faces)[np.any(affected[np.asarray(faces)],axis=1)]
    groups=spec['seams']
    def signed(point):
        loc,normal,_,_=tree.find_nearest(Vector(point))
        return float((Vector(point)-loc).dot(normal)),np.array(normal)
    ids=np.flatnonzero(affected)
    vertex_targets={int(i):min(signed(original[i])[0],.001) for i in ids}
    face_targets=[min(signed(original[f].mean(axis=0))[0],.001) for f in triangles]
    # Fixed iteration budget avoids a frame-dependent branch in the finishing operator.
    for _ in range(12):
        for i in ids:
            distance,normal=signed(result[i]);delta=vertex_targets[int(i)]-distance
            if delta>0:result[i]+=normal*(delta+1e-6)
        for face,target in zip(triangles,face_targets):
            distance,normal=signed(result[face].mean(axis=0));delta=target-distance
            if delta>0:
                moving=face[affected[face]];result[moving]+=normal*(delta+1e-6)*3/len(moving)
        for group in groups:result[group]=result[group].mean(axis=0)
    deficits=[vertex_targets[int(i)]-signed(result[i])[0] for i in ids]
    deficits.extend(target-signed(result[f].mean(axis=0))[0] for f,target in zip(triangles,face_targets))
    spec['_clearance_deficit_cm']=max(deficits,default=0)*100
    assert max(deficits,default=0)<.001,'Waist clearance correction failed (over1mm)'
    assert np.array_equal(result[~affected],original[~affected])
    assert np.linalg.norm(result-original,axis=1).max()<.025,'Waist finish exceeds2.5cm bound'
    return result
