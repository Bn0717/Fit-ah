import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('../app/fit-lab/engine.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const { gridRange } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('the slider range follows the simulated grid, with the old range as fallback', () => {
  assert.deepEqual(gridRange({ heights: [160, 175, 190], chests: [84, 92, 101, 110, 116, 124] }), { height: [160, 190], chest: [84, 124] });
  assert.deepEqual(gridRange(null), { height: [160, 190], chest: [92, 116] });
  const meta = JSON.parse(readFileSync(new URL('../public/models/fitlab/bodies/grid/meta.json', import.meta.url), 'utf8'));
  const r = gridRange(meta);
  assert.equal(r.chest[0], Math.min(...meta.chests)); assert.equal(r.chest[1], Math.max(...meta.chests));
});

const eng = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('a shirt product replaces the TNT tee in the fit data, and its own sizes drive the shape check', () => {
  const meta = JSON.parse(readFileSync(new URL('../public/models/fitlab/bodies/grid/meta.json', import.meta.url), 'utf8'));
  const k = meta.centre, nums = { chest_cm: 120, length_cm: 70, shoulder_cm: 50, hem_cm: 60, stretch_p95: 1 };
  const top = { id: 't', name: 'T', brand: 'B', kind: 'top', dir: '/x', sizes: ['XS', 'XXL'], chart: { XS: { chest: 50, shoulder: 45, length: 70, sleeve: 20 }, XXL: { chest: 60, shoulder: 50, length: 75, sleeve: 22 } },
    shirt: { XS: Object.fromEntries(Object.keys(meta.body).map(b => [b, nums])), XXL: { [k]: nums } } };
  const m = eng.withShirt(meta, top);
  assert.deepEqual(Object.keys(m.shirt), ['XS', 'XXL']); assert.equal(m.body, meta.body); assert.equal(eng.withShirt(meta, null), meta);
  assert.equal(eng.shirtShapeOk(m, 175, 101), false, 'no shape versions simulated for this shirt: natural shape only');
  const n = eng.fitNumbers(m, eng.solveBody(m, 175, 101, null, null, 0), 'XS');
  assert.equal(Math.round(n.shirt.chest), 120);
});
