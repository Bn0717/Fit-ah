import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const src = ts.transpileModule(readFileSync(new URL('../app/brand-upload/chartChecks.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const { checkChart, parseChart } = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
const stallion = { S: { waist: 36, hip: 51, length: 96, opening: 24 }, M: { waist: 39, hip: 54, length: 98.5, opening: 25.5 }, L: { waist: 42, hip: 57, length: 101, opening: 27 }, XL: { waist: 45, hip: 60, length: 103.5, opening: 28.5 } };
const levels = r => r.map(f => f.level);
test('a clean pants chart passes', () => {
  const r = checkChart(stallion, 'pants'); assert.deepEqual(levels(r), ['OK']); assert.match(r[0].message, /4 sizes/);
});
test('widths entered all the way round are caught', () => {
  const round = Object.fromEntries(Object.entries(stallion).map(([s, c]) => [s, { ...c, waist: c.waist * 2 }]));
  const r = checkChart(round, 'pants'); assert.ok(r.some(f => f.level === 'ERROR' && /all the way round/.test(f.message))); assert.ok(!levels(r).includes('OK'));
});
test('a body chart is refused', () => {
  const r = checkChart({ M: { waist: 40, hip: 50 }, L: { waist: 43, hip: 53 } }, 'pants'); assert.ok(r.some(f => /BODY size chart/.test(f.message)));
});
test('sizes out of order and impossible shapes', () => {
  const r = checkChart({ S: { waist: 39, hip: 51, length: 96 }, M: { waist: 36, hip: 54, length: 98 }, L: { waist: 42, hip: 40, length: 100 } }, 'pants');
  assert.ok(r.some(f => f.level === 'ERROR' && /waist shrinks from S/.test(f.message))); assert.ok(r.some(f => /L: hip 40 smaller than the waist 42/.test(f.message)));
});
test('a tee chart with brand column names', () => {
  const r = checkChart({ M: { body_width: 53, body_length_back: 71.5, shoulder_width: 46.5 }, L: { body_width: 56, body_length_back: 74, shoulder_width: 48 } }, 'top'); assert.deepEqual(levels(r), ['OK']);
});
test('pasted chart: inches and all-the-way-round become flat cm', () => {
  const { chart, unknown } = parseChart('Size\tWaist\tHip\tOutseam\tLeg opening\tColour\nS\t28\t40\t38\t19\tbrown\nM\t30\t42.5\t39\t20\tbrown', 'in', true);
  assert.equal(chart.S.waist, +(28 * 2.54 / 2).toFixed(2)); assert.equal(chart.M.length, +(39 * 2.54).toFixed(2)); assert.equal(chart.S.opening, +(19 * 2.54 / 2).toFixed(2));
  assert.deepEqual(unknown, ['colour']); assert.deepEqual(levels(checkChart(chart, 'pants')).filter(l => l === 'ERROR'), []);
});
