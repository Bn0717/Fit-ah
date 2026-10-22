import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { BufferGeometry, BufferAttribute, Mesh } from 'three';
const source = readFileSync(new URL('../app/fit-lab/engine.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const { prepareStaticSurface, refreshStaticNormals, applyStaticLayers } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
function part(points, normal = [0, 0, 1]) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(Float32Array.from(points.flat()), 3));
  g.setAttribute('normal', new BufferAttribute(Float32Array.from(points.flatMap(() => normal)), 3));
  g.setIndex([0, 1, 2]);
  return { mesh: new Mesh(g) };
}
const normalAt = (p, i) => Array.from(p.mesh.geometry.attributes.normal.array.slice(i * 3, i * 3 + 3));

test('texture-split vertices across material primitives share smooth lighting without welding geometry', () => {
  const a = part([[0,0,0],[1,0,0],[0,1,0]]), b = part([[0,0,0],[0,1,0],[0,0,1]]);
  const original = [a,b].map(p => Array.from(p.mesh.geometry.attributes.position.array));
  refreshStaticNormals([a,b]);
  assert.deepEqual(normalAt(a,0), normalAt(b,0));
  assert.ok(normalAt(a,0)[0] > .6 && normalAt(a,0)[2] > .6);
  assert.deepEqual([a,b].map(p => Array.from(p.mesh.geometry.attributes.position.array)), original);
  assert.equal(a.mesh.geometry.attributes.position.count, 3);
});

test('authored hard edges are retained at coincident positions', () => {
  const a = part([[0,0,0],[1,0,0],[0,1,0]]), b = part([[0,0,0],[0,1,0],[0,0,1]], [1,0,0]);
  prepareStaticSurface([a,b]);
  assert.notEqual(a.smoothGroups[0], b.smoothGroups[0]);
});

test('coincident panels with different morph motion cannot share smoothing groups', () => {
  const a = part([[0,0,0],[1,0,0],[0,1,0]]), b = part([[0,0,0],[0,1,0],[0,0,1]]);
  a.mesh.geometry.morphAttributes.position = [new BufferAttribute(new Float32Array(9),3)];
  b.mesh.geometry.morphAttributes.position = [new BufferAttribute(Float32Array.from([1,0,0,0,0,0,0,0,0]),3)];
  prepareStaticSurface([a,b]);
  assert.notEqual(a.smoothGroups[0], b.smoothGroups[0]);
});

test('a hidden shirt never changes pants geometry or authored normals', () => {
  const shirt = part([[0,1,0],[1,1,0],[0,2,0]]), pants = part([[0,0,0],[1,0,0],[0,1,0]]);
  const pos = pants.mesh.geometry.attributes.position.array.slice(), normal = pants.mesh.geometry.attributes.normal.array.slice();
  applyStaticLayers([shirt], [pants], false);
  assert.deepEqual(pants.mesh.geometry.attributes.position.array, pos);
  assert.deepEqual(pants.mesh.geometry.attributes.normal.array, normal);
  assert.ok(!pants.layered);
});

test('unlayering restores positions and authored normals exactly, repeatedly', () => {
  const shirt = part([[0,1,0],[1,1,0],[0,2,0]]), pants = part([[0,0,0],[1,0,0],[0,1,0]]);
  prepareStaticSurface([shirt]); prepareStaticSurface([pants]);
  for (let cycle=0; cycle<5; cycle++) {
    for(const p of [shirt,pants]) { p.layered=true; p.mesh.geometry.attributes.position.array.fill(7); p.mesh.geometry.attributes.normal.array.fill(.3); }
    applyStaticLayers([shirt], [pants], false);
    for(const p of [shirt,pants]) { assert.deepEqual(p.mesh.geometry.attributes.position.array,p.basePos); assert.deepEqual(p.mesh.geometry.attributes.normal.array,p.baseNormal); assert.equal(p.layered,false); }
  }
});

test('removing pants restores shirt shading and keeps normals finite on degenerate faces', () => {
  const shirt = part([[0,0,0],[0,0,0],[0,0,0]]);
  refreshStaticNormals([shirt]);
  assert.ok(Array.from(shirt.mesh.geometry.attributes.normal.array).every(Number.isFinite));
  shirt.layered = true; shirt.mesh.geometry.attributes.normal.array.fill(0);
  applyStaticLayers([shirt], [], true);
  assert.deepEqual(shirt.mesh.geometry.attributes.normal.array,shirt.baseNormal);
});


test('target order and animated hard-edge normals keep coincident surfaces separate', () => {
  const a = part([[0,0,0],[1,0,0],[0,1,0]]), b = part([[0,0,0],[0,1,0],[0,0,1]]);
  a.mesh.morphTargetDictionary = { small: 0 }; b.mesh.morphTargetDictionary = { large: 0 };
  prepareStaticSurface([a,b]); assert.notEqual(a.smoothGroups[0], b.smoothGroups[0]);
  b.mesh.morphTargetDictionary = { small: 0 };
  a.mesh.geometry.morphAttributes.normal = [new BufferAttribute(new Float32Array(9),3)];
  b.mesh.geometry.morphAttributes.normal = [new BufferAttribute(Float32Array.from([1,0,0,0,0,0,0,0,0]),3)];
  prepareStaticSurface([a,b]); assert.notEqual(a.smoothGroups[0], b.smoothGroups[0]);
});
