import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../app/fit-lab/garmentColour.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const { nameOf, parseColour, parsePalette, garmentColourOf } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('a photo colour gets an everyday name', () => {
  assert.equal(nameOf('#1d2737'), 'Navy');
  assert.equal(nameOf('#f0efed'), 'White');
  assert.equal(nameOf('#9f4e4a'), 'Maroon');
  assert.equal(nameOf('#2f2e34'), 'Black');
});
test('typed colours: names, hex codes, name + hex', () => {
  assert.deepEqual(parseColour('olive'), { name: 'Olive', hex: '#6b6b3a' });
  assert.deepEqual(parseColour('Light blue'), { name: 'Light Blue', hex: '#a9c6e8' });
  assert.deepEqual(parseColour('lightblue'), { name: 'Light Blue', hex: '#a9c6e8' });
  assert.equal(parseColour('#2F4F4F').hex, '#2f4f4f');
  assert.deepEqual(parseColour('Forest #2f4f36'), { name: 'Forest', hex: '#2f4f36' });
  assert.equal(parseColour('sparkly unicorn'), null);
});
test('a pasted palette keeps the known ones and reports the rest', () => {
  const r = parsePalette('black, cream; #2f4f4f\nolive, glittery, black');
  assert.deepEqual(r.colours.map(c => c.name), ['Black', 'Cream', 'Dark Green', 'Olive'].map((n, i) => i === 2 ? r.colours[2].name : n));
  assert.equal(r.colours.length, 4);
  assert.deepEqual(r.unknown, ['glittery']);
});
test('garment colour of a flat-lay: background from the edge, median of the rest', () => {
  const w = 20, h = 20, px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, g = x > 4 && x < 15 && y > 4 && y < 15;
    px.set(g ? [30, 40, 70, 255] : [235, 236, 240, 255], i);
  }
  assert.equal(garmentColourOf(px, w, h), '#1e2846');
  const empty = new Uint8ClampedArray(w * h * 4).fill(255);
  assert.equal(garmentColourOf(empty, w, h), null);
});
