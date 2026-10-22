"""Keep fabric panel winding coherent; folds may legitimately face the body."""
import bmesh
from mathutils.bvhtree import BVHTree

def orient_panels_outward(mesh, body_mesh, body_matrix=None):
    bm=bmesh.new(); bm.from_mesh(mesh)
    tree=BVHTree.FromPolygons([body_matrix @ v.co if body_matrix is not None else v.co for v in body_mesh.vertices], [tuple(p.vertices) for p in body_mesh.polygons])
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    unseen=set(bm.faces); components=0; flipped=0
    while unseen:
        seed=unseen.pop(); component=[seed]; stack=[seed]
        while stack:
            face=stack.pop()
            for edge in face.edges:
                for other in edge.link_faces:
                    if other in unseen:
                        unseen.remove(other);component.append(other);stack.append(other)
        score=0.0
        for face in component:
            centre=face.calc_center_median();loc,normal,_,_=tree.find_nearest(centre)
            if loc is not None:
                score+=face.calc_area()*(1 if face.normal.dot(centre-loc)>=0 else -1)
        if score<0:
            for face in component:face.normal_flip()
            flipped+=len(component)
        components+=1
    bm.to_mesh(mesh);bm.free();mesh.update()
    return {'panels':components,'flipped_faces':flipped}
