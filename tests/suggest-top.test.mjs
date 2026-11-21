import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../app/fit-lab/engine.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const { suggestTop } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

// shirt chest girth on the body (cm) per size, stretch 3 % unless given
const rows = (...chests) => chests.map(c => (c === null ? null : typeof c === 'number' ? { chest_cm: c, stretch_p95: 3 } : c));

test('suggests the smallest size that reaches the intended regular fit, not "between slim and regular"', () => {
  // body chest 100: 109 = 9 % room ("between slim and regular"), 112 = 12 % ("regular")
  const r = suggestTop(rows(104, 109, 112, 120), 100, 'Regular');
  assert.equal(r.index, 2);
  assert.match(r.rows[1].label, /^Between Slim and Regular/);
  assert.equal(r.rows[2].tier, 'Regular');
});

test('a stretched or too-small size is never suggested and is labelled tight', () => {
  const r = suggestTop(rows(95, { chest_cm: 115, stretch_p95: 18 }, 118), 100);
  assert.equal(r.rows[0].tight, true);                      // smaller than the body
  assert.equal(r.rows[1].tight, true);                      // 18 % of the fabric stretched: tight, still wearable
  assert.equal(r.rows[1].label, 'Tight: the fabric is stretched');
  assert.equal(r.index, 2);
});

test('sizes not simulated for the body are skipped', () => {
  const r = suggestTop(rows(null, 113, 120), 100);
  assert.equal(r.rows[0], null);
  assert.equal(r.index, 1);
});

test('when no size reaches the intended fit, the largest size that is not tight is suggested', () => {
  const r = suggestTop(rows(101, 104, 106), 100);
  assert.equal(r.index, 2);
});

test('nothing wearable: no suggestion', () => {
  assert.equal(suggestTop(rows(90, 95), 100).index, -1);
});

test('a relaxed-fit brand asks for more room', () => {
  // 12 % room is regular, 20 % relaxed
  assert.equal(suggestTop(rows(112, 120), 100, 'Relaxed').index, 1);
});

test('a size stretched past what knit can give is too small to put on, never suggested', async () => {
  const { KNIT_STRETCH_MAX } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const r = suggestTop(rows({ chest_cm: 100, stretch_p95: 200 }, { chest_cm: 106, stretch_p95: 28 }, 118), 106);
  assert.equal(KNIT_STRETCH_MAX, 25);
  assert.equal(r.rows[0].tooSmall, true);
  assert.match(r.rows[0].label, /^Too small to put on/);
  assert.equal(r.rows[1].tooSmall, true);
  assert.equal(r.index, 2);
});

test('an oversized brand: the oversized tier is reachable, so a small body is not sent to the biggest size', () => {
  // body 80: 104 = 30 % room (oversized), then much bigger sizes
  const r = suggestTop(rows(96, 104, 120, 152), 80, 'Oversized');
  assert.equal(r.rows[1].tier, 'Oversized');
  assert.equal(r.index, 1);
});

