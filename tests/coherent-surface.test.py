"""Regression: a folded panel keeps shared-edge orientation and UV identity."""
import sys,bpy,bmesh,numpy as np
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/fitlab'))
from coherent_surface import orient_panels_outward
m=bpy.data.meshes.new('folded');m.from_pydata([(0,0,1),(1,0,1),(0,1,1),(1,1,.7)],[],[(0,1,2),(1,2,3)])
u=m.uv_layers.new();
for loop in m.loops:u.data[loop.index].uv=(loop.vertex_index/10,loop.vertex_index/20)
b=bpy.data.meshes.new('body');b.from_pydata([(-5,-5,0),(5,-5,0),(5,5,0),(-5,5,0)],[],[(0,1,2,3)])
before=np.array([v.co[:] for v in m.vertices]);r=orient_panels_outward(m,b)
bm=bmesh.new();bm.from_mesh(m)
assert all(e.is_contiguous for e in bm.edges if len(e.link_faces)==2);bm.free()
assert np.array_equal(before,np.array([v.co[:] for v in m.vertices]));assert r['panels']==1
u=m.uv_layers.active
for loop in m.loops:assert np.allclose(u.data[loop.index].uv,(loop.vertex_index/10,loop.vertex_index/20))
print('PASS: coherent shared edges, unchanged positions and vertex UVs')
