import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
const source = readFileSync(new URL('../app/fit-lab/SavedSizeControl.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText
  .replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')))
  .replaceAll("'react'", JSON.stringify(import.meta.resolve('react')));
const { SavedSizeControl } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const base = { itemId: 'shorts', name: 'My shorts', sizes: ['S', 'M', 'L', 'XL', '2XL'], onSave: async () => {} };

test('saved and recommended sizes remain separate from the preview in the UI', () => {
  const html = renderToStaticMarkup(createElement(SavedSizeControl, { ...base, recommended: 'M', savedSize: 'L', previewSize: '2XL' }));
  assert.match(html, /Recommended: <strong>M<\/strong>/);
  assert.match(html, /Your size: <strong>L<\/strong>/);
  assert.match(html, /value="M">M \(recommended\)/);
  assert.match(html, /value="L" selected="">L<\/option>/);
  assert.match(html, /Save 2XL as my size/);
});
test('unavailable recommendations still allow a personal size record', () => {
  const html = renderToStaticMarkup(createElement(SavedSizeControl, { ...base, recommended: null, savedSize: null }));
  assert.match(html, /No supported size recommendation/);
  assert.match(html, /Your size: <strong>Not set<\/strong>/);
  assert.match(html, /value="2XL"/);
});
test('a previous record remains visible when an updated chart drops that label', () => {
  const html = renderToStaticMarkup(createElement(SavedSizeControl, { ...base, sizes: ['S', 'M'], recommended: 'M', savedSize: 'XL', previewSize: 'S' }));
  assert.match(html, /value="XL" selected="">XL<\/option>/);
  assert.match(html, /value="">Not set/);
});
