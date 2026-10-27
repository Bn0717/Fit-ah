import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('../app/fit-lab/skinTone.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const { SKIN_TONES, isSkinTone, toneHex, hexToLinear, toneFactor, applySkinTone } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('the Monk Skin Tone Scale has 10 distinct tones, lightest to darkest', () => {
  assert.equal(SKIN_TONES.length, 10);
  assert.equal(new Set(SKIN_TONES.map(t => t.id)).size, 10);
  const lum = SKIN_TONES.map(t => hexToLinear(t.hex).reduce((a, b) => a + b));
  assert.ok(lum[0] > lum[9] * 10, 'tone 1 is far lighter than tone 10');
  assert.ok(isSkinTone('mst05') && !isSkinTone('mst11') && !isSkinTone(null));
  assert.equal(toneHex(null), null);
});

test('tone 5 is the model\'s own skin; other tones scale it lighter or darker', () => {
  assert.deepEqual(toneFactor('#d7bd96').map(v => Math.round(v * 1e9) / 1e9), [1, 1, 1]);
  const lum = f => f[0] * 0.2126 + f[1] * 0.7152 + f[2] * 0.0722;
  const lums = SKIN_TONES.map(t => lum(toneFactor(t.hex)));
  for (let i = 5; i < 10; i++) assert.ok(lums[i] < lums[i - 1], `tone ${i + 1} darker than tone ${i}`);
  assert.ok(lums[0] > 1 && lums[9] < 0.05);
});

function mesh(name, avg) {
  const color = { v: [1, 1, 1], setRGB(r, g, b) { this.v = [r, g, b]; } };
  return { isMesh: true, material: { name, map: { userData: { skinAvg: avg } }, color } };
}
const root = list => ({ traverse: fn => list.forEach(fn) });

test('only the skin material is recoloured, and null restores the original skin', () => {
  const skin = mesh('Human.body.002', [0.5, 0.3, 0.2]), hair = mesh('Human.culturalibre_hair_02', [0.1, 0.1, 0.1]);
  applySkinTone(root([skin, hair]), 'mst08');
  assert.notDeepEqual(skin.material.color.v, [1, 1, 1]);
  assert.deepEqual(hair.material.color.v, [1, 1, 1]);
  applySkinTone(root([skin, hair]), null);
  assert.deepEqual(skin.material.color.v, [1, 1, 1]);
  applySkinTone(undefined, 'mst01');   // a body that has not loaded yet: nothing to do
});
