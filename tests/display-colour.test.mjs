import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('../app/fit-lab/displayColour.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const { shown, fabricFor } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const s2l = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const lin = h => [1, 3, 5].map(i => s2l(parseInt(h.slice(i, i + 2), 16) / 255));
test('the model reproduces the measured fitting-room colours', () => {
  // swatch -> what the fitting room showed (sRGB, measured on the shirt chest, 27 Oct 2026)
  for (const [sw, seen] of [['#2f2e34', [65, 64, 72]], ['#40506c', [94, 116, 153]], ['#9f4e4a', [212, 118, 110]]]) {
    const p = shown(lin(sw)), m = seen.map(v => s2l(v / 255));
    p.forEach((v, i) => assert.ok(Math.abs(v - m[i]) < 0.02, `${sw} ch${i}: ${v} vs ${m[i]}`));
  }
});
test('the fabric colour found for a swatch shows as that swatch', () => {
  for (const sw of ['#2f2e34', '#40506c', '#9f4e4a', '#a9b3ab', '#61493f', '#f5ecdb']) {
    const back = shown(fabricFor(lin(sw))), top = shown([1, 1, 1]);
    // swatches brighter than the scene can show (top) or darker than the sheen floor land at that limit
    lin(sw).forEach((v, i) => assert.ok(Math.abs(back[i] - v) < 0.01 || v < 0.035 || v > top[i] - 0.01, `${sw} ch${i}: ${back[i]} vs ${v}`));
  }
});
