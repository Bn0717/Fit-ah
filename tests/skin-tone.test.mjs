import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const tr = f => ts.transpileModule(readFileSync(new URL(f, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const dcUrl = `data:text/javascript;base64,${Buffer.from(tr('../app/fit-lab/displayColour.ts')).toString('base64')}`;
const code = tr('../app/fit-lab/skinTone.ts').replaceAll("'./displayColour'", JSON.stringify(dcUrl));
const { SKIN_TONES, isSkinTone, toneHex, hexToLinear, toneFactor, applySkinTone, TEXTURE_AVG } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const { shown, SKIN } = await import(dcUrl);

test('the Monk Skin Tone Scale has 10 distinct tones, lightest to darkest', () => {
  assert.equal(SKIN_TONES.length, 10);
  assert.equal(new Set(SKIN_TONES.map(t => t.id)).size, 10);
  const lum = SKIN_TONES.map(t => hexToLinear(t.hex).reduce((a, b) => a + b));
  assert.ok(lum[0] > lum[9] * 10, 'tone 1 is far lighter than tone 10');
  assert.ok(isSkinTone('mst05') && !isSkinTone('mst11') && !isSkinTone(null));
  assert.equal(toneHex(null), null);
});

test('every tone SHOWS as its Monk swatch in the lit fitting room (skin calibration), darkest included', () => {
  for (const tone of SKIN_TONES) {
    const f = toneFactor(tone.hex), seen = shown(TEXTURE_AVG.map((a, i) => a * f[i]), SKIN), want = hexToLinear(tone.hex);
    // tone 10 is darker than the remaining shine allows: it lands at the darkest the scene can show
    want.forEach((v, i) => assert.ok(Math.abs(seen[i] - v) < 0.012 || v > 0.83 || seen[i] <= shown([0, 0, 0], SKIN)[i] + 0.002, `${tone.id} ch${i}: shows ${seen[i]} for ${v}`));
  }
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
