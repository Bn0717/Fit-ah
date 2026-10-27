import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const root=new URL('../public/models/fitlab/',import.meta.url);
function model(path){
 let data=readFileSync(new URL(path,root));if(data[0]===31&&data[1]===139)data=gunzipSync(data);
 const length=data.readUInt32LE(12),j=JSON.parse(data.subarray(20,20+length)),b=data.subarray(28+length);
 function bytes(i){
  const a=j.accessors[i],v=j.bufferViews[a.bufferView];
  const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type]*{5121:1,5122:2,5123:2,5125:4,5126:4}[a.componentType];
  assert.ok(width,'supported accessor');const out=Buffer.alloc(a.count*width),start=(v.byteOffset??0)+(a.byteOffset??0),stride=v.byteStride??width;
  for(let row=0;row<a.count;row++)b.copy(out,row*width,start+row*stride,start+row*stride+width);
  return out;
 }
 const primitives=j.meshes.flatMap(m=>m.primitives);
 return {j,b,bytes,primitives};
}
for(const size of ['M','L','XL','2XL'])for(const variant of ['','drop/','belt/']){
 test(`Xin ${size} ${variant||'held'} surface preserves source fabric and strain`,()=>{
  const original=model(`brands/tnt_co/xin_jeans/grid/${variant}jeans_${size}.glb.gz`),fixed=model(`brands/tnt_co/xin_jeans/smooth/grid/${variant}jeans_${size}.glb.gz`);
  assert.equal(fixed.j.asset.extras.xin_surface_repair.waist_finish_cm,variant ? 8 : 0);
  assert.equal(fixed.primitives.length,original.primitives.length);
  for(let n=0;n<original.primitives.length;n++){
   const a=original.primitives[n],b=fixed.primitives[n];assert.equal(b.targets.length,a.targets.length);
   for(const [name,i]of Object.entries(a.attributes))if(!['POSITION','NORMAL','TEXCOORD_0'].includes(name)&&!name.startsWith('_G_'))assert.deepEqual(fixed.bytes(b.attributes[name]),original.bytes(i),name);
   assert.equal(fixed.j.accessors[b.attributes.NORMAL].componentType,5126);
  }
  original.j.images.forEach((image,i)=>{
   if(image.bufferView==null)return;
   const old=original.j.bufferViews[image.bufferView],next=fixed.j.bufferViews[fixed.j.images[i].bufferView];
   assert.deepEqual(fixed.b.subarray(next.byteOffset,next.byteOffset+next.byteLength),original.b.subarray(old.byteOffset,old.byteOffset+old.byteLength));
  });
 });
}
for(const size of ['M','L','XL','2XL','2XLbelt']){
 test(`Xin ${size} catwalk keeps frame timing and stable source texture identity`,()=>{
  const fixed=model(`brands/tnt_co/xin_jeans/smooth/walk/walk_jeans_${size}.glb.gz`),seen=new Map();
  const info=JSON.parse(readFileSync(new URL(`brands/tnt_co/xin_jeans/smooth/walk/walk_jeans_${size}.json`,root)));
  const original=JSON.parse(readFileSync(new URL(`brands/tnt_co/xin_jeans/walk/walk_jeans_${size}.json`,root)));
  for(const k of ['fps','first','frames','n','min','scale','strain_offset','gap_offset','packed'])assert.deepEqual(info[k],original[k]);
  for(const p of fixed.primitives){
   const ids=new Float32Array(Uint8Array.from(fixed.bytes(p.attributes._VID)).buffer),uv=new Float32Array(Uint8Array.from(fixed.bytes(p.attributes.TEXCOORD_0)).buffer);
   for(let i=0;i<ids.length;i++){
    const value=[uv[i*2],uv[i*2+1]];assert.ok(value.every(Number.isFinite));
    if(seen.has(ids[i]))assert.deepEqual(value,seen.get(ids[i]));else seen.set(ids[i],value);
   }
  }
 });
}
