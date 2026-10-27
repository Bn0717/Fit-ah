import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { BufferGeometry, BufferAttribute, Mesh } from 'three';
const source = readFileSync(new URL('../app/fit-lab/engine.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const engineUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
const { fitColor, blendFitAttribute, applyFrame, makeTrack, elasticFit, elasticBandColor, VARIANTS } = await import(engineUrl);
const red = [0.93, 0.18, 0.18], white = [1, 1, 1], pale = [0.86, 0.92, 1], blue = [0.3, 0.52, 0.98];
const shape = Object.fromEntries(VARIANTS.map(v => [v, 0]));
const attr = (...values) => ({ array: Float32Array.from(values) });

test('oversized hanging denim is roomy despite local stretch; contact can still be tight', () => {
  assert.deepEqual(fitColor(.1, 3, 'denim'), blue);
  assert.deepEqual(fitColor(.1, .49, 'denim'), red);
  assert.deepEqual(fitColor(.1, .51, 'denim'), pale);
});
test('static shirts account for their larger baked collider envelope', () => {
  assert.deepEqual(fitColor(.1, .84, 'jersey'), red);
  assert.deepEqual(fitColor(.1, .86, 'jersey'), pale);
  assert.deepEqual(fitColor(0, .7, 'jersey'), white);
});
test('walking shirts use the approved walking envelope, not static shirt spacing', () => {
  assert.deepEqual(fitColor(.1, .49, 'jersey', .35), red);
  assert.deepEqual(fitColor(.1, .51, 'jersey', .35), pale);
});
test('invalid gaps do not manufacture a tight or loose reading', () => {
  for (const gap of [NaN, Infinity, -Infinity, -1]) assert.deepEqual(fitColor(.12, gap, 'denim'), white);
  assert.deepEqual(fitColor(.12, 0, 'denim', NaN), white);
});
test('missing strain preserves known room and cannot manufacture tightness', () => {
  assert.deepEqual(fitColor(NaN, .3, 'denim'), white);
  assert.deepEqual(fitColor(NaN, 3, 'denim'), blue);
  assert.deepEqual(fitColor(-.1, .3, 'denim'), white);
});
test('material strain bands retain yellow, orange, red within contact', () => {
  assert.deepEqual(fitColor(.035, .35, 'denim'), [1, .86, .3]);
  assert.deepEqual(fitColor(.05, .35, 'denim'), [1, .55, .15]);
  assert.deepEqual(fitColor(.07, .35, 'denim'), red);
  assert.deepEqual(fitColor(.05, .7, 'jersey'), [1, .55, .15]);
});
test('clearance produces increasing blue bands independent of tensile strain', () => {
  for (const strain of [0, .03, .1, .5]) {
    assert.deepEqual(fitColor(strain, 1, 'denim'), pale);
    assert.deepEqual(fitColor(strain, 2, 'denim'), [.62, .78, 1]);
    assert.deepEqual(fitColor(strain, 3, 'denim'), blue);
  }
});
test('body interpolation and per-body shape deltas agree with geometry weights', () => {
  const attrs = { _G_a: attr(1, 2), _g_b: attr(3, 4), _G_a_w70: attr(2, 3), _G_b_w70: attr(5, 6) };
  assert.deepEqual(Array.from(blendFitAttribute(attrs, 'G', 2, {a:.25, b:.75}, {...shape,w70:.5}, 'a', false)), [3.375,4.375]);
});
test('missing body/active shape measurements invalidate the sample rather than assuming zero', () => {
  const attrs = { _G_a: attr(1, 2) };
  for (const values of [blendFitAttribute(attrs,'G',2,{a:.5,b:.5},shape,'a',false), blendFitAttribute(attrs,'G',2,{a:1},{...shape,w70:1},'a',false), blendFitAttribute(attrs,'G',3,{a:1},shape,'a',false)]) assert.ok(Array.from(values).every(Number.isNaN));
  assert.deepEqual(Array.from(blendFitAttribute(attrs,'G',2,{a:1,b:0},shape,'a',false)),[1,2]);
});
function track(strain, gap) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(9),3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(9),3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(9).fill(.93),3));
  g.setIndex([0,1,2]);
  return { mesh:new Mesh(g), vid:Int32Array.of(0,1,2), q:new Int16Array(9), info:{n:3,min:[0,0,0],scale:[.001,.001,.001],frames:1},acc:new Float32Array(9),strain,gap };
}
test('catwalk missing measurements clear stale colours instead of claiming room', () => {
  for (const t of [track(undefined,undefined),track(Int8Array.of(100,100,100),undefined)]) {
    applyFrame(t,0,true,'denim');
    assert.ok(Array.from(t.mesh.geometry.attributes.color.array).every(x=>x===1));
  }
});
test('catwalk uses the same contact rule and converts packed mm/strain units correctly', () => {
  const t=track(Int8Array.of(100,100,100),Uint8Array.of(4,6,30));
  applyFrame(t,0,true,'jersey');
  const colours=t.mesh.geometry.attributes.color.array;
  for (let i=0;i<3;i++) {
    const want=fitColor(.1,[.4,.6,3][i],'jersey',.35);
    for(let j=0;j<3;j++) assert.ok(Math.abs(colours[i*3+j]-want[j])<1e-6);
  }
});

test('active pants geometry with absent shape measurements cannot silently keep base colours', () => {
  const values=blendFitAttribute({_G_a:attr(1,2)},'G',2,{a:1},{...shape,w70:1},'a',true,{w70:0});
  assert.ok(Array.from(values).every(Number.isNaN));
});

const sizingSource = readFileSync(new URL('../app/fit-lab/jeansFit.ts', import.meta.url), 'utf8');
const sizingCompiled = ts.transpileModule(sizingSource, {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2020}}).outputText.replaceAll("'./engine'", JSON.stringify(engineUrl)).replaceAll('"./engine"',JSON.stringify(engineUrl));
const {jeansState}=await import(`data:text/javascript;base64,${Buffer.from(sizingCompiled).toString('base64')}`);
const meta=JSON.parse(readFileSync(new URL('../public/models/fitlab/bodies/grid/meta.json',import.meta.url),'utf8'));
test('a clean synthetic simulation is not hidden by an arbitrary 2cm waistband deficit',()=>{
  const clean=structuredClone(meta.jeans);
  for(const sample of Object.values(clean.belt.M.bodies)){sample.put_on_failed=false;sample.seam_gap_mean_cm=0;sample.crotch_drop_cm=Math.max(-2,sample.crotch_drop_cm);sample.hem_lowest_cm=Math.min(15,sample.hem_lowest_cm);}
  for(const chest of [101,102,103,104]){
    const state=jeansState(meta,clean,'M',true,183,chest,48,null,0);
    assert.equal(state.hide,false,`unexpected hidden jeans at chest ${chest}`);
    assert.equal(state.tooSmall,false);
    if(state.now.waistEase<0){assert.match(state.now.label,/Tight at the waist/);assert.equal(state.now.tone,'red');}
  }
});
test('solver failures remain unavailable and are not presented as proof of real-world closure failure',()=>{
  const failed=structuredClone(meta.jeans);
  for(const body of Object.values(failed.belt.M.bodies))body.put_on_failed=true;
  const state=jeansState(meta,failed,'M',true,183,103,48,null,0);
  assert.equal(state.hide,true);assert.match(state.reason,/Simulation unavailable/);assert.doesNotMatch(state.reason,/cannot close|cannot be worn/);
});
test('directional fields blend independently of legacy area strain',()=>{
  const result=blendFitAttribute({_D_a:attr(.1),_D_b:attr(.2),_S_a:attr(0),_S_b:attr(0)},'D',1,{a:.5,b:.5},shape,'a',true);
  assert.ok(Math.abs(result[0]-.15)<1e-6);
});

const shortsProduct=JSON.parse(readFileSync(new URL('../public/models/fitlab/brands/tnt_co/ns_matrix_white/product.json',import.meta.url),'utf8'));
const shorts={name:shortsProduct.name,sizes:shortsProduct.belt,belt:shortsProduct.belt,drop:shortsProduct.drop,elasticStretch:shortsProduct.elastic_stretch};
test('actual 183/102 interpolation cannot dilute its known failed corner',()=>{
 const state=jeansState(meta,meta.jeans,'M',true,183,102,48,null,0);
 assert.equal(state.hide,true);assert.ok(state.qualityIssues.some(r=>r.startsWith('h185_c110:')));
 assert.match(state.reason,/Simulation unavailable/);
});
test('undersized Xin M falling through body is unavailable instead of labelled too big',()=>{
 const state=jeansState(meta,meta.jeans,'M',false,184,116,53,null,0);
 assert.equal(state.hide,true);assert.match(state.now.label,/unavailable/);assert.doesNotMatch(state.now.label,/Too big|falls down/);
 assert.ok(state.qualityIssues.some(r=>/passed through body|valid torso/.test(r)));
});
test('Xin L on the same body retains a tight-waist preview when its source simulations are sound',()=>{
 const state=jeansState(meta,meta.jeans,'L',false,184,116,53,null,0);
 assert.equal(state.hide,false);assert.match(state.now.label,/Tight at the waist/);
});
test('shorts S 190/116 uses elastic extension for both label and contact colour',()=>{
 const state=jeansState(meta,shorts,'S',false,190,116,49.5,null,0);
 assert.equal(state.hide,false);assert.ok(state.now.elasticExtension>.24&&state.now.elasticExtension<.28);
 assert.match(state.now.label,/Tight at the elastic waist/);
 assert.deepEqual(elasticBandColor(state.now.elasticExtension,.35,state.now.elasticLimit),[1,.55,.15]);
 assert.equal(state.now.relaxedWaist,2*shorts.sizes.S.chart.elastic_waist);
});
test('elastic bands grade toward the configured limit without using rigid-denim thresholds',()=>{
 assert.equal(elasticFit(.1,.3),'comfortable');assert.equal(elasticFit(.18,.3),'snug');assert.equal(elasticFit(.26,.3),'tight');assert.equal(elasticFit(.29,.3),'too tight');
 assert.deepEqual(elasticBandColor(.29,.35,.3),red);assert.deepEqual(elasticBandColor(.26,3,.3),blue);
 assert.equal(elasticFit(.2,NaN),'unknown');assert.deepEqual(elasticBandColor(.2,.35,NaN),white);
});
test('failed corner cannot become valid at a small interpolation weight',()=>{
 assert.equal(jeansState(meta,shorts,'S',false,176,101,null,null,0).hide,false,'the repaired real simulation is available');
 const damaged=structuredClone(shorts);
 damaged.sizes.S.bodies.h185_c101.seam_gap_mean_cm=1;
 const state=jeansState(meta,damaged,'S',false,176,101,null,null,0);
 assert.equal(state.hide,true);assert.ok(state.qualityIssues.some(r=>r.startsWith('h185_c101:')));
});
test('catwalk elastic colours apply only to original waistband vertex IDs',()=>{
 const t=track(Int8Array.of(0,100,0),Uint8Array.of(4,4,4));
 t.info.elastic_band={indices:[0],relaxed_cm:69,max_stretch:1.3,body_girth_cm:87};t.elasticBand=Uint8Array.of(1,0,0);
 applyFrame(t,0,true,'denim');
 const c=t.mesh.geometry.attributes.color.array;
 assert.ok(Math.abs(c[1]-.55)<1e-6); // waistband orange despite gathered cloth strain being zero
 assert.ok(Math.abs(c[4]-.18)<1e-6); // leg retains its own denim/cloth strain rather than elastic policy
 assert.equal(c[6],1);assert.equal(c[7],1);assert.equal(c[8],1);
});

test('track loading preserves elastic material membership and baked collider metadata',()=>{
 const t=track(undefined,undefined),g=t.mesh.geometry;
 g.setAttribute('_VID',new BufferAttribute(Float32Array.of(0,1,2),1));
 const info={...t.info,fit_collision_cm:.55,elastic_band:{indices:[1],relaxed_cm:69,max_stretch:1.3,body_girth_cm:87}};
 const loaded=makeTrack(t.mesh,new ArrayBuffer(18),0,info);
 assert.deepEqual(Array.from(loaded.elasticBand),[0,1,0]);
 assert.equal(loaded.info.elastic_band.body_girth_cm,87);
 assert.equal(loaded.info.fit_collision_cm,.55);
});

test('catwalk cloth and elastic contact use their own baked collider envelope',()=>{
 const t=track(Int8Array.of(0,100,0),Uint8Array.of(6,6,6));
 t.info.fit_collision_cm=.55;
 t.info.elastic_band={indices:[0],relaxed_cm:69,max_stretch:1.3,body_girth_cm:87};
 t.elasticBand=Uint8Array.of(1,0,0);
 applyFrame(t,0,true,'denim');
 const c=t.mesh.geometry.attributes.color.array;
 assert.ok(Math.abs(c[1]-.55)<1e-6); // elastic waist remains in contact after its own collision margin
 assert.ok(Math.abs(c[4]-.18)<1e-6); // strained leg also remains in contact
 assert.deepEqual(Array.from(c.slice(6)),white);
 assert.deepEqual(fitColor(.1,.6,'denim',.35),pale); // legacy margin would falsely add room
});

test('an elastic band larger than the body cannot use an artificially pinned held preview',()=>{
 const state=jeansState(meta,shorts,'2XL',false,160,92,null,null,0);
 assert.equal(state.hide,true);assert.equal(state.noSim,true);assert.match(state.reason,/slipping preview/);assert.doesNotMatch(state.now.label,/Comfortable|holds them up/);
});
