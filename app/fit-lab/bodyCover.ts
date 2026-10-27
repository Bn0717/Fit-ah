// app/fit-lab/bodyCover.ts
// The 3D body keeps its whole foot inside the shoes (MakeHuman body + separate shoe model). Standing still the
// shoe hides it, but on the catwalk feet and shoes are animated separately and the toes poke out through the
// shoe front (most visible with darker skin tones). Skin inside the shoes (and the socks, part of the shoe model)
// is never meant to be seen, so those triangles are simply not drawn. Vertices stay (the morphs and the catwalk
// replay address them by number); only the triangle list changes. The standing body and the walking body share
// the same mesh layout, so the mask found on the standing body (shoes at rest) is reused for the walking body.
// No imports here: tests load this file on its own.

const MARGIN = 0.004;   // m: a little inside the shoe wall still counts as covered
let cachedHidden: { n: number; hidden: Uint8Array } | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const worldPositions = (mesh: any): Float32Array => {
  const p = mesh.geometry.attributes.position.array as ArrayLike<number>, e = mesh.matrixWorld?.elements;
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (!e) { out[i] = x; out[i + 1] = y; out[i + 2] = z; continue; }
    out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
};

// which body vertices sit inside a shoe: one box per shoe (left / right split at the shoes' centre)
export function coveredByShoes(body: Float32Array, shoes: Float32Array): Uint8Array {
  let cx = 0; const n = shoes.length / 3;
  for (let i = 0; i < shoes.length; i += 3) cx += shoes[i] / n;
  const boxes = [[Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]];
  for (let i = 0; i < shoes.length; i += 3) {
    const b = boxes[shoes[i] < cx ? 0 : 1];
    for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], shoes[i + k]); b[k + 3] = Math.max(b[k + 3], shoes[i + k]); }
  }
  const hidden = new Uint8Array(body.length / 3);
  for (let v = 0; v < hidden.length; v++) {
    const x = body[3 * v], y = body[3 * v + 1], z = body[3 * v + 2];
    hidden[v] = boxes.some(b => x > b[0] + MARGIN && x < b[3] - MARGIN && y > b[1] - MARGIN && y < b[4] - MARGIN && z > b[2] + MARGIN && z < b[5] - MARGIN) ? 1 : 0;
  }
  return hidden;
}

// triangles to keep: drop a triangle only when all three corners are covered (no holes at the sock / shoe edge)
export function keepTriangles(index: ArrayLike<number>, hidden: Uint8Array): number[] {
  const keep: number[] = [];
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    if (!(hidden[a] && hidden[b] && hidden[c])) keep.push(a, b, c);
  }
  return keep;
}

// Hide the skin inside the shoes of a loaded body (three.js Object3D of body.glb or walk_body.glb).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function hideCoveredFeet(root: any) {
  if (!root?.traverse) return;
  root.updateMatrixWorld?.(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = null; const shoes: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root.traverse((o: any) => {
    if (!o.isMesh) return;
    const name = (Array.isArray(o.material) ? o.material[0] : o.material)?.name || '';
    if (/^Human\.body/i.test(name)) body = o;
    else if (/shoe/i.test(name)) shoes.push(o);
  });
  if (!body?.geometry?.index || (!shoes.length && !cachedHidden)) return;
  const n = body.geometry.attributes.position.count;
  const cached = cachedHidden;
  let hidden = cached && cached.n === n ? cached.hidden : null;
  if (!hidden) {
    const sp = shoes.map(worldPositions), all = new Float32Array(sp.reduce((s, a) => s + a.length, 0));
    let o = 0; for (const a of sp) { all.set(a, o); o += a.length; }
    hidden = coveredByShoes(worldPositions(body), all);
    cachedHidden = { n, hidden };
  }
  if (body.userData.feetHidden) return;
  body.geometry.setIndex(keepTriangles(body.geometry.index.array, hidden));
  body.userData.feetHidden = true;
}
