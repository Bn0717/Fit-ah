import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../app/fit-lab/sizePreferences.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const { initialSize, recommendedTop, recommendedBottom } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const sizes = ['S', 'M', 'L', 'XL', '2XL'];

test('the user’s record takes priority when opening an item', () => {
  assert.equal(initialSize('2XL', 'M', sizes), '2XL');
  assert.equal(initialSize(null, 'M', sizes), 'M');
  assert.equal(initialSize('XXS', 'L', sizes), 'L');
  assert.equal(initialSize('L', 'M', []), '');
});
test('measurement changes can change a recommendation without changing the saved record', () => {
  const saved = 'XL';
  const before = recommendedTop(sizes, s => ({ tier: s === 'S' ? 'Slim' : 'Regular' }));
  const after = recommendedTop(sizes, s => ({ tier: ['S', 'M'].includes(s) ? 'Compression' : 'Regular' }));
  assert.equal(before, 'M');
  assert.equal(after, 'L');
  assert.equal(initialSize(saved, after, sizes), 'XL');
});
test('unsupported or too-small shirts never receive a recommendation', () => {
  assert.equal(recommendedTop(sizes, () => null), null);
  assert.equal(recommendedTop(sizes, () => ({ tier: 'Compression' })), null);
  assert.equal(recommendedTop(sizes, () => ({ tier: 'Regular' }), () => false), null);
  assert.equal(recommendedTop(sizes, () => ({ tier: 'Regular' }), s => s === 'L'), 'L');
});
test('bottoms prefer a supported comfortable size over loose or hidden sizes', () => {
  const fit = s => s === 'S' ? { hide: true, now: { tone: 'green' } } : s === 'M' ? { hide: false, now: { tone: 'blue' } } : { hide: false, now: { tone: 'green' } };
  assert.equal(recommendedBottom(sizes, fit), 'L');
  assert.equal(recommendedBottom(sizes, fit, s => s !== 'L'), 'XL');
  assert.equal(recommendedBottom(sizes, () => ({ hide: false, now: { tone: 'red' } })), null);
  assert.equal(recommendedBottom(sizes, () => ({ hide: false, now: null })), null);
});
test('clearing a record restores the recommendation as the opening size', () => {
  assert.equal(initialSize(null, 'L', sizes), 'L');
  assert.equal(initialSize(undefined, null, sizes), 'S');
});
