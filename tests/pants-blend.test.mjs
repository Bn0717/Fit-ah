import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { readGlb } from './helpers/glb.mjs';
const tsx = f => ts.transpileModule(readFileSync(new URL(`../app/fit-lab/${f}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const engineUrl = `data:text/javascript;base64,${Buffer.from(tsx('engine.ts')).toString('base64')}`;
const B = await import(`data:text/javascript;base64,${Buffer.from(tsx('pantsBlend.ts')).toString('base64')}`);
const E = await import(engineUrl);

// a "leg": closed cylinder of radius r round the y axis, 0..1 m high, as one indexed mesh
const cylinder = (r, A = 24, Hn = 10) => {
  const p = [], idx = [];
  for (let h = 0; h <= Hn; h++) for (let a = 0; a < A; a++) p.push(r * Math.cos(2 * Math.PI * a / A), h / Hn, r * Math.sin(2 * Math.PI * a / A));
  for (let h = 0; h < Hn; h++) for (let a = 0; a < A; a++) {
    const i = h * A + a, j = h * A + (a + 1) % A;
    idx.push(i, i + A, j, j, i + A, j + A);      // outward-facing
  }
  return { p: new Float32Array(p), idx };
};
// fabric ring at height y, radius R, its points rotated by `turn` (a fold sitting elsewhere)
const ring = (R, y, turn, n = 36) => new Float32Array(Array.from({ length: n }, (_, i) => { const t = 2 * Math.PI * i / n + turn; return [R * Math.cos(t), y, R * Math.sin(t)]; }).flat());

test('on a simulated body the result is exactly that simulation; between two the fabric keeps its distance', () => {
  const thin = cylinder(0.05), thick = cylinder(0.06);
  const delta = new Float32Array(thin.p.length).map((_, i) => thick.p[i] - thin.p[i]);
  const mesh = { geometry: { attributes: { position: { array: thin.p, count: thin.p.length / 3 } }, index: { array: thin.idx }, morphAttributes: { position: [{ array: delta }] } }, morphTargetDictionary: { thick: 0 } };
  const S = B.makeBodySurface([mesh], 2);
  // the same fabric ring 1 cm off the leg on both bodies, but its points turned by 15 degrees on the thick one (skin
  // spots ~1.4 cm apart; spots more than 2-5 cm apart fade to the plain mix on purpose, see placeOnBody)
  const a = ring(0.06, 0.5, 0), b = ring(0.07, 0.5, 15 * Math.PI / 180);
  const A = B.anchorPants(S, B.surfaceAt(S, {}), a), Bk = B.anchorPants(S, B.surfaceAt(S, { thick: 1 }), b);
  for (const [w, want] of [[0, a], [1, b]]) {
    const out = new Float32Array(a.length);
    B.placeOnBody(S, B.surfaceAt(S, { thick: w }), [{ a: A, w: 1 - w }, { a: Bk, w }], a, out);
    for (let i = 0; i < out.length; i++) assert.ok(Math.abs(out[i] - want[i]) < 1e-5);
  }
  // halfway: leg radius 5.5 cm; every fabric point stays ~1 cm off it, never closer than the plain mix puts it
  const out = new Float32Array(a.length), P = B.surfaceAt(S, { thick: 0.5 });
  B.placeOnBody(S, P, [{ a: A, w: 0.5 }, { a: Bk, w: 0.5 }], a, out);
  for (let i = 0; i < out.length; i += 3) {
    const r = Math.hypot(out[i], out[i + 2]);
    assert.ok(r > 0.0635 && r < 0.0665, `radius ${r}`);   // 24-sided leg: a few mm either way
    const plain = Math.hypot((a[i] + b[i]) / 2, (a[i + 2] + b[i + 2]) / 2);
    assert.ok(r >= plain - 1e-4, `kept ${r} vs plain ${plain}`);
  }
});

test('fabric inside the body is pushed out to just over the skin', () => {
  const c = cylinder(0.05);
  const S = B.makeBodySurface([{ geometry: { attributes: { position: { array: c.p, count: c.p.length / 3 } }, index: { array: c.idx } } }], 2);
  const P = B.surfaceAt(S, {}), pos = ring(0.04, 0.5, 0.1);
  assert.equal(B.pushOutOfBody(S, P, pos, Array.from({ length: pos.length / 3 }, (_, i) => i)), pos.length / 3);
  for (let i = 0; i < pos.length; i += 3) assert.ok(Math.hypot(pos[i], pos[i + 2]) > 0.049);
});

// the real body + Xin jeans M (public files): exact on every simulated body, and between bodies no denim point
// more than 3 mm inside the skin (the plain point-by-point mix had up to ~1,200 at chest 110)
test('Xin jeans M: exact on simulated bodies, no skin through the denim between them', () => {
  const R = new URL('../public/models/fitlab/', import.meta.url).pathname;
  const meta = JSON.parse(readFileSync(R + 'bodies/grid/meta.json'));
  const S = B.makeBodySurface(readGlb(R + 'bodies/grid/body.glb').filter(m => /^Human\.body/i.test(m.material) || /shoe/i.test(m.material)));
  const [J] = readGlb(R + 'brands/tnt_co/xin_jeans/grid/drop/jeans_M.glb.gz'), dict = J.morphTargetDictionary, base = J.geometry.attributes.position.array;
  const sim = k => { const o = base.slice(); if (k in dict) { const d = J.geometry.morphAttributes.position[dict[k]].array; for (let i = 0; i < o.length; i++) o[i] += d[i]; } return o; };
  const anchors = {}, anc = k => anchors[k] ??= B.anchorPants(S, B.surfaceAt(S, { [k]: 1 }), sim(k));
  const place = (w, push) => {
    const P = B.surfaceAt(S, w), out = new Float32Array(base.length);
    const risky = B.placeOnBody(S, P, Object.entries(w).map(([k, x]) => ({ a: anc(k in dict ? k : meta.centre), w: x })), base, out);
    if (push) B.pushOutOfBody(S, P, out, risky);
    return out;
  };
  for (const k of ['h165_c101', meta.centre, 'h185_c110']) {
    const a = place({ [k]: 1 }, false), b = sim(k);
    for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-5);
  }
  let worst = 0;
  for (const [h, c] of [[170, 110], [180, 110], [187.5, 110], [180, 99]]) {
    const { w } = E.solveBody(meta, h, c, null, null, 0);
    const out = place(w, true), a = B.anchorPants(S, B.surfaceAt(S, w), out);
    let inside = 0;
    for (let i = 0; i < a.dist.length; i++) if (a.dir[i * 3 + 2] < 0 && a.dist[i] > 0.003) inside++;
    worst = Math.max(worst, inside);
  }
  assert.ok(worst <= 3, `denim points inside the skin: ${worst}`);
});
