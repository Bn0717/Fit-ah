"""Run with Blender --background --factory-startup -P tests/seam-waist.test.py."""
import sys
from pathlib import Path
import numpy as np
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/fitlab'))
from seam_waist import local_waist_profile,share_sewn_pin_targets
front=lambda t:Vector((10*(1-t),43))
back=lambda t:Vector((10*(1-t),41+3*t))
fd,fr=local_waist_profile([front(0),Vector((10,42)),front(1)],front)
bd,br=local_waist_profile([back(0),Vector((10,40)),back(1)],back,1)
assert np.allclose(fd,[0,.01,0]);assert np.allclose(bd,[0,.01,0])
assert np.allclose(fr,0);assert np.allclose(br,[0,0,.01])
goals=np.array([[.2,0,1],[.201,0,.98],[0,0,1.01],[0,0,.5]],float)
fixed,pins=share_sewn_pin_targets(goals,[(0,1)],[0,1,2])
assert np.array_equal(fixed[0],fixed[1]);assert fixed[2,2]==1.01
assert np.array_equal(fixed[3],goals[3]);assert pins==[0,1,2]
fixed,pins=share_sewn_pin_targets(goals,[(0,1),(1,3)],[0,2])
assert np.array_equal(fixed[0],fixed[1]);assert np.array_equal(fixed[1],fixed[3]);assert pins==[0,1,2,3]
assert np.array_equal(fixed[0],goals[0]);assert np.array_equal(goals[1],[.201,0,.98])
print('PASS: local band depth, shared side targets, centre-back rise, pin expansion, transitive joins, unchanged inputs')
import os
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'blender'))
os.environ['FITAH_PANTS_SPEC']=str(root/'blender/products/tnt_co/ns_matrix_white/build/spec.json')
import garment,garment_pants as gp
for size in ['S','M','L','XL','2XL']:
    panels,seams,_=gp.build_pants_pattern(gp.size_spec(size));counts=garment.edge_counts(panels,seams,1.2)
    goals=[];indices={};pinned=[]
    for name,edges in panels.items():
        pv,pf,ids=garment.mesh_panel(edges,counts,name,1.2);off=len(goals)
        depth,rise=local_waist_profile(pv,next(f for en,f in edges if en=='waist'),1 if name.startswith('back') else 0)
        goals.extend((0,0,1.0+r-d) for d,r in zip(depth,rise))
        pinned.extend(off+i for i,d in enumerate(depth) if d<.04+1e-8)
        for en,ii in ids.items():indices[name,en]=np.array(ii)+off
    pairs=[(int(i),int(j)) for a,ea,b,eb,rev in seams for i,j in zip(indices[a,ea],indices[b,eb][::-1] if rev else indices[b,eb])]
    fixed,pins=share_sewn_pin_targets(goals,pairs,pinned)
    for leg in ['r','l']:
        a=indices['front_'+leg,'side'][-1];b=indices['back_'+leg,'side'][-1]
        assert np.array_equal(fixed[a],fixed[b]),size
        assert abs(fixed[a,2]-1)<1e-6,size
    print('PASS actual graded pattern',size)
from mathutils.bvhtree import BVHTree
from seam_waist import clear_pinned_goals
vertices=[(-.1,-.1,0),(.1,-.1,0),(.1,.1,0),(-.1,.1,0),(-.1,-.1,1),(.1,-.1,1),(.1,.1,1),(-.1,.1,1)]
faces=[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
tree=BVHTree.FromPolygons(vertices,faces)
goals=np.array([[.095,0,.5],[.095,0,.5],[.2,0,.6],[0,.095,.7]],float)
fixed,report=clear_pinned_goals(goals,[(0,1)],[0,1,2,3],tree,(0,0))
assert np.array_equal(fixed[0],fixed[1]);assert np.array_equal(fixed[:,2],goals[:,2])
assert np.array_equal(fixed[2],goals[2]);assert fixed[0,0]>.10349;assert fixed[3,1]>.10349
assert report['moved_components']==2 and report['moved_vertices']==3
assert np.array_equal(goals[0],[.095,0,.5])
print('PASS: real-surface pin clearance, joined goals, preserved heights, safe pins and input unchanged')
