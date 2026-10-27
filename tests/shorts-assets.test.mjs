import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
function model(path) {
  const b=gunzipSync(readFileSync(new URL('../public/models/fitlab/'+path,import.meta.url)));
  const n=b.readUInt32LE(12), j=JSON.parse(b.subarray(20,20+n)), bin=b.subarray(28+n);
  function array(i) {
    const a=j.accessors[i], v=j.bufferViews[a.bufferView], components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
    const bytes={5126:4,5122:2}[a.componentType], read=a.componentType===5126?'readFloatLE':'readInt16LE';
    assert.ok(bytes,'supported accessor encoding');
    return Array.from({length:a.count},(_,k)=>Array.from({length:components},(_,axis)=>bin[read]((v.byteOffset??0)+(a.byteOffset??0)+k*(v.byteStride??bytes*components)+axis*bytes)));
  }
  return {j,array};
}
for(const size of ['S','M','L','XL','2XL']) {
  test(`shorts ${size} static photo stays continuous across texture-split vertices`,()=>{
    const {j,array}=model(`brands/tnt_co/ns_matrix_white/belt/jeans_${size}.glb.gz`);
    assert.equal(j.asset.extras.uv_vertex_identity_fixed,true);
    assert.equal(j.asset.extras.hem_uv_fixed,true,'preserve the approved slanted-photo hem correction');
    for(const primitive of j.meshes.flatMap(m=>m.primitives)) {
      const positions=array(primitive.attributes.POSITION),uv=array(primitive.attributes.TEXCOORD_0),seen=new Map();
      assert.equal(uv.length,positions.length);
      for(let i=0;i<positions.length;i++) {
        const key=positions[i].join(',');
        if(seen.has(key)) assert.deepEqual(uv[i],seen.get(key),'one geometric point cannot jump to another photo patch');
        else seen.set(key,uv[i]);
        assert.ok(uv[i].every(Number.isFinite));
      }
    }
  });
  test(`shorts ${size} walking photo follows stable source vertex IDs`,()=>{
    const {j,array}=model(`brands/tnt_co/ns_matrix_white/walk/walk_jeans_${size}.glb.gz`), seen=new Map();
    assert.equal(j.asset.extras.uv_vertex_identity_fixed,true);
    assert.equal(j.asset.extras.hem_uv_fixed,true,'preserve the approved slanted-photo hem correction');
    for(const primitive of j.meshes.flatMap(m=>m.primitives)) {
      const ids=array(primitive.attributes._VID),uv=array(primitive.attributes.TEXCOORD_0);
      const accessor=j.accessors[primitive.attributes._VID];
      for(let i=0;i<ids.length;i++) {
        const id=Math.round(accessor.normalized?ids[i][0]/32767*j.asset.extras.fq._vi:ids[i][0]);
        if(seen.has(id)) assert.deepEqual(uv[i],seen.get(id));else seen.set(id,uv[i]);
      }
    }
  });
  test(`shorts ${size} walking fit uses the baked collision envelope`,()=>{
    const info=JSON.parse(readFileSync(new URL(`../public/models/fitlab/brands/tnt_co/ns_matrix_white/walk/walk_jeans_${size}.json`,import.meta.url)));
    assert.ok(Math.abs(info.fit_collision_cm-.55)<1e-9,'3mm cloth plus 2.5mm body clearance');
    assert.equal(info.frames,131);
  });
}


test('all static and walking sizes use the same clean front/back albedo with resolvable paths', () => {
  for(const size of ['S','M','L','XL','2XL']) for(const path of [
    `brands/tnt_co/ns_matrix_white/belt/jeans_${size}.glb.gz`,
    `brands/tnt_co/ns_matrix_white/walk/walk_jeans_${size}.glb.gz`,
  ]) {
    const {j}=model(path);
    assert.equal(j.asset.extras.albedo_version,1);
    for(const side of ['front','back']) {
      const image=j.images.find(i=>i.name.includes(side));
      assert.ok(image && !('bufferView' in image));
      const resolved=new URL(image.uri,new URL('../public/models/fitlab/'+path,import.meta.url));
      assert.ok(existsSync(resolved),`texture path resolves: ${path} ${image.uri}`);
      assert.ok(resolved.pathname.endsWith(`/brands/tnt_co/ns_matrix_white/albedo_${side}_v1.png`));
    }
  }
});

test('the shorts catalog contains the regenerated measurements for all100 bodies',()=>{
  const root=new URL('../public/models/fitlab/brands/tnt_co/ns_matrix_white/',import.meta.url);
  const product=JSON.parse(readFileSync(new URL('product.json',root)));
  for(const size of ['S','M','L','XL','2XL']) {
    const sim=JSON.parse(readFileSync(new URL(`belt/jeans_${size}.json`,root)));
    assert.deepEqual(product.belt[size],sim,'catalog must not retain stale failed simulations');
    assert.equal(Object.keys(sim.bodies).length,20);
    for(const body of Object.values(sim.bodies)) {
      assert.ok(body.seam_gap_mean_cm<=.25,'a repaired body must not remain unavailable from old seam data');
      assert.ok(!body.put_on_failed);
    }
  }
});
