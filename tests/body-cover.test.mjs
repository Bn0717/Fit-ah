import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('../app/fit-lab/bodyCover.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const { coveredByShoes, keepTriangles } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('skin inside either shoe is covered, skin outside is not', () => {
  // two shoes: boxes around x = -0.1 and x = +0.1, 0..0.2 m high
  const shoes = new Float32Array([-0.15, 0, -0.05, -0.05, 0.2, 0.15, 0.05, 0, -0.05, 0.15, 0.2, 0.15]);
  const body = new Float32Array([-0.1, 0.05, 0.05, 0.1, 0.1, 0.0, 0.0, 0.05, 0.0, 0.1, 0.5, 0.0]);   // L foot, R foot, between feet, knee
  assert.deepEqual([...coveredByShoes(body, shoes)], [1, 1, 0, 0]);
});
test('a triangle is dropped only when all three corners are covered', () => {
  const hidden = new Uint8Array([1, 1, 1, 0]);
  assert.deepEqual(keepTriangles([0, 1, 2, 1, 2, 3], hidden), [1, 2, 3]);
});
