// Pants blended relative to the body surface.
//
// Each pants size is simulated on ~20 bodies. Between those bodies the old way mixed the simulations point by
// point in space. Two simulations fold differently, so a mixed point often lands between two folds: the leg looks
// squeezed, the hem gets smaller and bigger again, and the mixed pants can sit inside the mixed body (skin poking
// through). Here every pants point of every simulation is stored as "this spot on that body's skin (or shoe) +
// this far away in this direction". On screen each simulation is put back on the body that is shown, and only
// then mixed: the skin spot is mixed on the skin, the distance and the direction are mixed separately (so the
// fabric keeps its distance from the body instead of cutting the corner between two folds). On a simulated body
// (one weight = 1) the result is exactly that simulation.

export type BodySurface = {
  base: Float32Array;                       // all body-surface points (skin + shoes), centre body, joined
  deltas: Record<string, Float32Array>;     // per body name: change from the centre body (glTF relative morphs)
  tris: Uint32Array;                        // triangles below the chest (indices into base)
};

export type PantsAnchors = {
  tri: Int32Array;                          // per pants point: triangle of the nearest skin / shoe spot
  bary: Float32Array;                       // where on that triangle (3 weights)
  dir: Float32Array;                        // unit direction from that spot to the pants point, in the triangle's frame
  dist: Float32Array;                       // distance from that spot to the pants point (m)
};

type MeshLike = {
  geometry: {
    attributes: { position: { array: ArrayLike<number>; count: number } };
    index?: { array: ArrayLike<number> } | null;
    morphAttributes?: { position?: { array: ArrayLike<number> }[] };
  };
  morphTargetDictionary?: Record<string, number>;
};

// Skin + shoes as one surface. Only triangles below `yTop` (m) are used: the pants never come near the head or
// the raised arms, and fewer triangles = faster anchoring.
export function makeBodySurface(meshes: MeshLike[], yTop = 1.35): BodySurface | null {
  const used = meshes.filter(m => m.geometry.index);
  if (!used.length) return null;
  const total = used.reduce((s, m) => s + m.geometry.attributes.position.count, 0);
  const base = new Float32Array(total * 3);
  const names = new Set<string>();
  for (const m of used) for (const n of Object.keys(m.morphTargetDictionary ?? {})) names.add(n);
  const deltas: Record<string, Float32Array> = {};
  for (const n of names) deltas[n] = new Float32Array(total * 3);
  const tris: number[] = [];
  let off = 0;
  for (const m of used) {
    const p = m.geometry.attributes.position.array, cnt = m.geometry.attributes.position.count;
    for (let i = 0; i < cnt * 3; i++) base[off * 3 + i] = p[i];
    const mt = m.geometry.morphAttributes?.position ?? [];
    for (const [n, t] of Object.entries(m.morphTargetDictionary ?? {})) {
      const a = mt[t]?.array; if (!a) continue;
      const d = deltas[n];
      for (let i = 0; i < cnt * 3; i++) d[off * 3 + i] = a[i];
    }
    const idx = m.geometry.index!.array;
    for (let k = 0; k + 2 < idx.length; k += 3) {
      const a = idx[k], b = idx[k + 1], c = idx[k + 2];
      if (Math.min(p[a * 3 + 1], p[b * 3 + 1], p[c * 3 + 1]) < yTop) tris.push(a + off, b + off, c + off);
    }
    off += cnt;
  }
  return { base, deltas, tris: Uint32Array.from(tris) };
}

// Body surface points for a set of body weights (names -> weight; the centre body has no delta).
export function surfaceAt(S: BodySurface, w: Record<string, number>, out = new Float32Array(S.base.length)) {
  out.set(S.base);
  for (const [k, x] of Object.entries(w)) {
    const d = S.deltas[k]; if (!d || !x) continue;
    for (let i = 0; i < out.length; i++) out[i] += x * d[i];
  }
  return out;
}

// closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5): returns barycentric weights
function closestBary(px: number, py: number, pz: number, P: ArrayLike<number>, ia: number, ib: number, ic: number, out: number[]) {
  const ax = P[ia], ay = P[ia + 1], az = P[ia + 2];
  const abx = P[ib] - ax, aby = P[ib + 1] - ay, abz = P[ib + 2] - az;
  const acx = P[ic] - ax, acy = P[ic + 1] - ay, acz = P[ic + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = 1; out[1] = 0; out[2] = 0; return; }
  const bpx = px - P[ib], bpy = py - P[ib + 1], bpz = pz - P[ib + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = 0; out[1] = 1; out[2] = 0; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = 1 - v; out[1] = v; out[2] = 0; return; }
  const cpx = px - P[ic], cpy = py - P[ic + 1], cpz = pz - P[ic + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = 0; out[1] = 0; out[2] = 1; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); out[0] = 1 - w; out[1] = 0; out[2] = w; return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); out[0] = 0; out[1] = 1 - w; out[2] = w; return; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  out[0] = 1 - v - w; out[1] = v; out[2] = w;
}

// triangle frame on surface P: e1 along edge ab, n = face normal, e2 = n x e1 (written into f[0..8])
function frame(P: ArrayLike<number>, ia: number, ib: number, ic: number, f: number[]) {
  let ux = P[ib] - P[ia], uy = P[ib + 1] - P[ia + 1], uz = P[ib + 2] - P[ia + 2];
  const vx = P[ic] - P[ia], vy = P[ic + 1] - P[ia + 1], vz = P[ic + 2] - P[ia + 2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const lu = Math.hypot(ux, uy, uz) || 1, ln = Math.hypot(nx, ny, nz) || 1;
  ux /= lu; uy /= lu; uz /= lu; nx /= ln; ny /= ln; nz /= ln;
  f[0] = ux; f[1] = uy; f[2] = uz;
  f[3] = ny * uz - nz * uy; f[4] = nz * ux - nx * uz; f[5] = nx * uy - ny * ux;
  f[6] = nx; f[7] = ny; f[8] = nz;
}

type Grid = { P: ArrayLike<number>; T: Uint32Array; x0: number; y0: number; z0: number; NX: number; NY: number; NZ: number; cell: number; cells: Map<number, number[]>; seen: Uint32Array; stamp: number };

// uniform grid of the triangles' bounding boxes on surface P (for nearest-spot searches)
export function surfaceGrid(S: BodySurface, P: ArrayLike<number>, cell = 0.04): Grid {
  const T = S.tris, nt = T.length / 3;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let k = 0; k < T.length; k++) {
    const o = T[k] * 3;
    x0 = Math.min(x0, P[o]); y0 = Math.min(y0, P[o + 1]); z0 = Math.min(z0, P[o + 2]);
    x1 = Math.max(x1, P[o]); y1 = Math.max(y1, P[o + 1]); z1 = Math.max(z1, P[o + 2]);
  }
  const NX = Math.max(1, Math.ceil((x1 - x0) / cell) + 1), NY = Math.max(1, Math.ceil((y1 - y0) / cell) + 1), NZ = Math.max(1, Math.ceil((z1 - z0) / cell) + 1);
  const cells = new Map<number, number[]>();
  const cl = (v: number, lo: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor((v - lo) / cell)));
  for (let t = 0; t < nt; t++) {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const ix0 = cl(Math.min(P[a], P[b], P[c]), x0, NX), ix1 = cl(Math.max(P[a], P[b], P[c]), x0, NX);
    const iy0 = cl(Math.min(P[a + 1], P[b + 1], P[c + 1]), y0, NY), iy1 = cl(Math.max(P[a + 1], P[b + 1], P[c + 1]), y0, NY);
    const iz0 = cl(Math.min(P[a + 2], P[b + 2], P[c + 2]), z0, NZ), iz1 = cl(Math.max(P[a + 2], P[b + 2], P[c + 2]), z0, NZ);
    for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) for (let iz = iz0; iz <= iz1; iz++) {
      const key = (ix * NY + iy) * NZ + iz; let l = cells.get(key); if (!l) cells.set(key, l = []); l.push(t);
    }
  }
  return { P, T, x0, y0, z0, NX, NY, NZ, cell, cells, seen: new Uint32Array(nt), stamp: 0 };
}

// nearest spot on the surface to (px, py, pz): triangle (-1 = none), its barycentric weights in bary, squared distance
function nearest(G: Grid, px: number, py: number, pz: number, bary: number[]): [number, number] {
  const { P, T, cell, NX, NY, NZ } = G, bc = [0, 0, 0];
  const cx = Math.floor((px - G.x0) / cell), cy = Math.floor((py - G.y0) / cell), cz = Math.floor((pz - G.z0) / cell);
  let bd = Infinity, bt = -1; const stamp = ++G.stamp;
  const maxR = Math.max(NX, NY, NZ) + Math.max(Math.abs(cx), Math.abs(cy), Math.abs(cz));
  for (let r = 0; r <= maxR; r++) {
    // every cell in shell r is at least (r - 1) cells away: stop once the best found is closer than that
    if (bt >= 0 && Math.sqrt(bd) < (r - 1) * cell) break;
    for (let ix = Math.max(0, cx - r); ix <= Math.min(NX - 1, cx + r); ix++) for (let iy = Math.max(0, cy - r); iy <= Math.min(NY - 1, cy + r); iy++) for (let iz = Math.max(0, cz - r); iz <= Math.min(NZ - 1, cz + r); iz++) {
      if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy), Math.abs(iz - cz)) !== r) continue;
      const l = G.cells.get((ix * NY + iy) * NZ + iz); if (!l) continue;
      for (const t of l) {
        if (G.seen[t] === stamp) continue; G.seen[t] = stamp;
        const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
        closestBary(px, py, pz, P, a, b, c, bc);
        const qx = bc[0] * P[a] + bc[1] * P[b] + bc[2] * P[c], qy = bc[0] * P[a + 1] + bc[1] * P[b + 1] + bc[2] * P[c + 1], qz = bc[0] * P[a + 2] + bc[1] * P[b + 2] + bc[2] * P[c + 2];
        const d = (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
        if (d < bd) { bd = d; bt = t; bary[0] = bc[0]; bary[1] = bc[1]; bary[2] = bc[2]; }
      }
    }
  }
  return [bt, bd];
}

// For each pants point: nearest spot on the body surface P (positions of one simulated body) + direction + distance.
// (Tried: every simulation anchored to the centre body's spots instead. Between a fallen and a worn simulation that
// tore the pants apart, so each simulation keeps its own nearest spots.)
export function anchorPants(S: BodySurface, P: Float32Array, pants: ArrayLike<number>): PantsAnchors {
  const G = surfaceGrid(S, P), T = S.tris;
  const n = Math.floor(pants.length / 3);
  const A: PantsAnchors = { tri: new Int32Array(n), bary: new Float32Array(n * 3), dir: new Float32Array(n * 3), dist: new Float32Array(n) };
  const best = [0, 0, 0], f = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const px = pants[i * 3], py = pants[i * 3 + 1], pz = pants[i * 3 + 2];
    const [bt] = nearest(G, px, py, pz, best);
    A.tri[i] = bt;
    if (bt < 0) continue;
    const a = T[bt * 3] * 3, b = T[bt * 3 + 1] * 3, c = T[bt * 3 + 2] * 3;
    A.bary.set(best, i * 3);
    const qx = best[0] * P[a] + best[1] * P[b] + best[2] * P[c], qy = best[0] * P[a + 1] + best[1] * P[b + 1] + best[2] * P[c + 1], qz = best[0] * P[a + 2] + best[1] * P[b + 2] + best[2] * P[c + 2];
    const dx = px - qx, dy = py - qy, dz = pz - qz, d = Math.hypot(dx, dy, dz);
    A.dist[i] = d;
    frame(P, a, b, c, f);
    if (d > 1e-9) {     // direction in the triangle frame
      A.dir[i * 3] = (dx * f[0] + dy * f[1] + dz * f[2]) / d;
      A.dir[i * 3 + 1] = (dx * f[3] + dy * f[4] + dz * f[5]) / d;
      A.dir[i * 3 + 2] = (dx * f[6] + dy * f[7] + dz * f[8]) / d;
    } else A.dir[i * 3 + 2] = 1;
  }
  return A;
}

// Points (by index) that are inside the body surface P, or closer than gap to it, are moved out to gap along the
// nearest triangle's outward side. Returns how many moved.
export function pushOutOfBody(S: BodySurface, P: ArrayLike<number>, pos: Float32Array, which: ArrayLike<number>, gap = 0.003) {
  const T = S.tris, bc = [0, 0, 0], f = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const G = surfaceGrid(S, P);
  let moved = 0;
  for (let k = 0; k < which.length; k++) {
    const i = which[k], px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    const [t] = nearest(G, px, py, pz, bc); if (t < 0) continue;
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const qx = bc[0] * P[a] + bc[1] * P[b] + bc[2] * P[c], qy = bc[0] * P[a + 1] + bc[1] * P[b + 1] + bc[2] * P[c + 1], qz = bc[0] * P[a + 2] + bc[1] * P[b + 2] + bc[2] * P[c + 2];
    frame(P, a, b, c, f);
    const side = (px - qx) * f[6] + (py - qy) * f[7] + (pz - qz) * f[8];
    if (side >= gap) continue;
    pos[i * 3] = qx + gap * f[6]; pos[i * 3 + 1] = qy + gap * f[7]; pos[i * 3 + 2] = qz + gap * f[8]; moved++;
  }
  return moved;
}

// Put every simulation back on the shown body surface P and mix them (sims: anchors + weight; weights sum to 1).
// Points of a simulation that found no body spot keep `fallback` (the plain point-by-point mix).
// Returns the points that may still touch the body (sims anchored far apart, or tight fabric): pushOutOfBody checks them.
export function placeOnBody(S: BodySurface, P: Float32Array, sims: { a: PantsAnchors; w: number }[], fallback: ArrayLike<number>, out: Float32Array) {
  const T = S.tris, n = out.length / 3, f = [0, 0, 0, 0, 0, 0, 0, 0, 0], risky: number[] = [];
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, sz = 0, dx = 0, dy = 0, dz = 0, dist = 0, wsum = 0, wTop = -1;
    let tx = 0, ty = 0, tz = 0, nx = 0, ny = 0, nz = 0, lo = Infinity, mx = Infinity, my = Infinity, mz = Infinity, spread = 0;
    let lx = 0, ly = 0, lz = 0;     // plain average of the simulations, each first moved onto the shown body
    for (const { a, w } of sims) {
      const t = a.tri[i]; if (t < 0 || !w) continue;
      const ia = T[t * 3] * 3, ib = T[t * 3 + 1] * 3, ic = T[t * 3 + 2] * 3, u = a.bary[i * 3], v = a.bary[i * 3 + 1], s = a.bary[i * 3 + 2];
      const qx = u * P[ia] + v * P[ib] + s * P[ic], qy = u * P[ia + 1] + v * P[ib + 1] + s * P[ic + 1], qz = u * P[ia + 2] + v * P[ib + 2] + s * P[ic + 2];
      frame(P, ia, ib, ic, f);
      const l0 = a.dir[i * 3], l1 = a.dir[i * 3 + 1], l2 = a.dir[i * 3 + 2];
      sx += w * qx; sy += w * qy; sz += w * qz;
      const ex = l0 * f[0] + l1 * f[3] + l2 * f[6], ey = l0 * f[1] + l1 * f[4] + l2 * f[7], ez = l0 * f[2] + l1 * f[5] + l2 * f[8];
      dx += w * ex; dy += w * ey; dz += w * ez;
      lx += w * (qx + a.dist[i] * ex); ly += w * (qy + a.dist[i] * ey); lz += w * (qz + a.dist[i] * ez);
      dist += w * a.dist[i]; wsum += w; lo = Math.min(lo, a.dist[i] * a.dir[i * 3 + 2]);   // signed: < 0 = this simulation had the point inside the body
      if (mx === Infinity) { mx = qx; my = qy; mz = qz; } else spread = Math.max(spread, Math.hypot(qx - mx, qy - my, qz - mz));
      if (w > wTop) { wTop = w; tx = qx; ty = qy; tz = qz; nx = f[6]; ny = f[7]; nz = f[8]; }
    }
    if (wsum < 0.999) { out[i * 3] = fallback[i * 3]; out[i * 3 + 1] = fallback[i * 3 + 1]; out[i * 3 + 2] = fallback[i * 3 + 2]; continue; }
    // the mixed skin spot cuts slightly under curved skin: lift it back onto the main simulation's triangle plane
    const under = (sx - tx) * nx + (sy - ty) * ny + (sz - tz) * nz;
    if (under < 0) { sx -= under * nx; sy -= under * ny; sz -= under * nz; }
    const ld = Math.hypot(dx, dy, dz) || 1;
    // simulations anchored to spots far apart (e.g. hem over the shoe in one, at the ankle in the other): a distance
    // measured from one spot means nothing at the other, and keeping it flared the hem out. There the plain average
    // is used, faded in between 2 and 5 cm apart so no seam shows.
    const k = Math.min(1, Math.max(0, (spread - 0.02) / 0.03)), m = k * k * (3 - 2 * k);
    out[i * 3] = (1 - m) * (sx + dist * dx / ld) + m * lx; out[i * 3 + 1] = (1 - m) * (sy + dist * dy / ld) + m * ly; out[i * 3 + 2] = (1 - m) * (sz + dist * dz / ld) + m * lz;
    if (spread > 0.01 || lo < 0.005) risky.push(i);
  }
  return risky;
}

// ── keeping the hem's volume ──
// Two simulations pile the hem up in folds at different places; mixing them half and half flattens both piles. Xin
// XL at chest 101: 165 cm and 175 cm each gave a 56-57 cm hem, their mix at 170 cm only 43 cm, so the hem went
// wide - narrow - wide as the height slider moved. Fix: below the knee, every 2 cm band of each leg is widened back
// (never narrowed) to the width the simulations had on their own, mixed by the same weights. Width = mean sideways
// distance of the band's points from the middle of the body's leg (or shoe) at that height, so the front and back
// pants parts can be handled one at a time.
const HEM_TOP = 0.5, HEM_FADE = 0.12, HEM_BIN = 0.02, HEM_MAX_GAIN = 1.5;
const HEM_NB = Math.ceil(HEM_TOP / HEM_BIN);
export type HemBands = Int16Array;   // per pants point: band (height bin * 2 + leg), or -1 above the knee

// bands from the pants' own shape (the centre simulation), so a point stays in its band whatever the body
export function hemBands(base: ArrayLike<number>): HemBands {
  const n = base.length / 3, id = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const y = base[i * 3 + 1];
    if (y < HEM_TOP) id[i] = Math.max(0, Math.floor(y / HEM_BIN)) * 2 + (base[i * 3] > 0 ? 1 : 0);
  }
  return id;
}

// middle of each leg (skin + shoe) per 2 cm of height, from the body surface points P: [x, z] per (bin * 2 + leg)
export function legAxis(P: ArrayLike<number>): Float32Array {
  const ax = new Float32Array(HEM_NB * 4), cnt = new Float32Array(HEM_NB * 2);
  for (let i = 0; i < P.length; i += 3) {
    const y = P[i + 1]; if (y >= HEM_TOP || y < 0) continue;
    const b = Math.floor(y / HEM_BIN) * 2 + (P[i] > 0 ? 1 : 0);
    ax[b * 2] += P[i]; ax[b * 2 + 1] += P[i + 2]; cnt[b]++;
  }
  for (let b = 0; b < HEM_NB * 2; b++) if (cnt[b]) { ax[b * 2] /= cnt[b]; ax[b * 2 + 1] /= cnt[b]; }
  // empty bins (no body there): copy the nearest filled bin below, else above, of the same leg
  for (let leg = 0; leg < 2; leg++) {
    let last = -1;
    for (let k = 0; k < HEM_NB; k++) { const b = k * 2 + leg; if (cnt[b]) last = b; else if (last >= 0) { ax[b * 2] = ax[last * 2]; ax[b * 2 + 1] = ax[last * 2 + 1]; cnt[b] = -1; } }
    last = -1;
    for (let k = HEM_NB - 1; k >= 0; k--) { const b = k * 2 + leg; if (cnt[b] > 0) last = b; else if (!cnt[b] && last >= 0) { ax[b * 2] = ax[last * 2]; ax[b * 2 + 1] = ax[last * 2 + 1]; } }
  }
  return ax;
}

function axisAt(ax: Float32Array, y: number, leg: number): [number, number] {
  const b = Math.min(HEM_NB - 1, Math.max(0, Math.floor(y / HEM_BIN))) * 2 + leg;
  return [ax[b * 2], ax[b * 2 + 1]];
}

// how far each band reaches out from the leg's middle (pants points on the body of axis ax): its outline, like a
// tape round the hem touches the outer folds only. Round the leg in 16 directions, the farthest point in each,
// averaged over the directions the pants cover. All pants parts (front, back) together: one width per band, so
// the parts are widened alike and the side seams stay closed.
const SECT = 16;
export function hemWidths(parts: { pos: ArrayLike<number>; bands: HemBands }[], ax: Float32Array): Float32Array {
  const far = new Float32Array(HEM_NB * 2 * SECT);
  for (const { pos, bands } of parts) for (let i = 0; i < bands.length; i++) {
    const b = bands[i]; if (b < 0) continue;
    const [mx, mz] = axisAt(ax, pos[i * 3 + 1], b & 1), dx = pos[i * 3] - mx, dz = pos[i * 3 + 2] - mz;
    const s = Math.min(SECT - 1, Math.floor((Math.atan2(dz, dx) / (2 * Math.PI) + 0.5) * SECT)), k = b * SECT + s;
    far[k] = Math.max(far[k], Math.hypot(dx, dz));
  }
  const r = new Float32Array(HEM_NB * 2);
  for (let b = 0; b < r.length; b++) {
    let s = 0, n = 0;
    for (let j = 0; j < SECT; j++) if (far[b * SECT + j] > 0) { s += far[b * SECT + j]; n++; }
    r[b] = n >= 3 ? s / n : 0;
  }
  return r;
}

// widen each band of the pants parts (on the body of axis ax) back to target (the simulations' own widths, mixed)
export function keepHemVolume(parts: { pos: Float32Array; bands: HemBands }[], ax: Float32Array, target: Float32Array) {
  const now = hemWidths(parts, ax), g = new Float32Array(HEM_NB * 2).fill(1);
  for (let b = 0; b < g.length; b++) if (now[b] > 1e-4 && target[b] > 0) g[b] = Math.min(HEM_MAX_GAIN, Math.max(1, target[b] / now[b]));
  // smooth along the leg (no ridge between bands) and fade out towards the knee
  const gs = new Float32Array(g.length);
  for (let k = 0; k < HEM_NB; k++) for (let leg = 0; leg < 2; leg++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, k - 1); j <= Math.min(HEM_NB - 1, k + 1); j++) { s += g[j * 2 + leg]; n++; }
    const top = (k + 0.5) * HEM_BIN, fade = Math.min(1, Math.max(0, (HEM_TOP - top) / HEM_FADE));
    gs[k * 2 + leg] = 1 + (s / n - 1) * fade;
  }
  for (const { pos, bands } of parts) for (let i = 0; i < bands.length; i++) {
    const b = bands[i]; if (b < 0 || gs[b] === 1) continue;
    const [mx, mz] = axisAt(ax, pos[i * 3 + 1], b & 1);
    pos[i * 3] = mx + (pos[i * 3] - mx) * gs[b]; pos[i * 3 + 2] = mz + (pos[i * 3 + 2] - mz) * gs[b];
  }
}

// One call for the viewers and the checks, after placeOnBody: widen the lower legs back. parts: each pants part's
// placed points (changed in place), its centre-simulation points, and its points in simulation `key`; sims: the
// mixed simulations (weight + their body surface points); P: the shown body. cache: kept by the caller per pants.
export type HemPart = { pos: Float32Array; base: ArrayLike<number>; sim: (key: string) => ArrayLike<number> };
export function restoreHem(parts: HemPart[], P: ArrayLike<number>, sims: { key: string; w: number; body: () => ArrayLike<number> }[],
  cache: { bands?: HemBands[]; widths?: Record<string, Float32Array> }) {
  const live = sims.filter(s => s.w > 1e-6);
  if (live.length < 2 || !parts.length) return;      // one simulation: shown exactly as simulated
  const bands = cache.bands ??= parts.map(p => hemBands(p.base)), W = cache.widths ??= {};
  const target = new Float32Array(HEM_NB * 2);
  for (const s of live) {
    const r = W[s.key] ??= hemWidths(parts.map((p, j) => ({ pos: p.sim(s.key), bands: bands[j] })), legAxis(s.body()));
    for (let b = 0; b < target.length; b++) target[b] += s.w * r[b];
  }
  keepHemVolume(parts.map((p, j) => ({ pos: p.pos, bands: bands[j] })), legAxis(P), target);
}

// ── website glue (fitting room + profile viewer): three.js objects, typed loosely like the viewers do ──
/* eslint-disable @typescript-eslint/no-explicit-any */
const GRID_KEY = /^h\d+_c\d+$/;

function influences(mesh: any): Record<string, number> {
  const out: Record<string, number> = {}, inf = mesh.morphTargetInfluences || [];
  for (const [n, t] of Object.entries(mesh.morphTargetDictionary || {})) if (inf[t as number]) out[n] = inf[t as number];
  return out;
}

// Pants positions placed relative to the body (see the top of this file), read from the morph weights the viewer has
// just set on the body and the pants (so any re-weighting the viewer did is kept). null = not possible (no body
// yet, or ?pantsBlend=raw in the address for comparing with the old point-by-point mix): the viewer then keeps the
// plain mix. S: the viewer's scene state (bodyMeshes); part: one pants part ({ mesh, basePos }); centre: meta.centre.
export function bodyRelativePants(S: any, part: any, centre: string): Float32Array | null {
  if (typeof location !== 'undefined' && /[?&]pantsBlend=raw\b/.test(location.search)) return null;
    // skin + shoes, found by material name like hideCoveredFeet (bodyCover.ts); both are needed (skin alone: denim
  // through the shoes, shoes alone: the pants are pulled onto the feet)
  const mat = (m: any) => (Array.isArray(m.material) ? m.material[0] : m.material)?.name || '';
  const bodies = (S.bodyMeshes || []).filter((m: any) => /^Human\.body/i.test(mat(m)) || /shoe/i.test(mat(m)));
  if (!bodies.some((m: any) => /^Human\.body/i.test(mat(m)))) return null;
  if (S.bodySurfaceFrom !== bodies[0]) { S.bodySurface = makeBodySurface(bodies); S.bodySurfaceFrom = bodies[0]; }
  const surf: BodySurface | null = S.bodySurface;
  const mesh = part.mesh, g = mesh.geometry, dict = mesh.morphTargetDictionary || {};
  if (!surf || !g.morphTargetsRelative) return null;
  const mt = g.morphAttributes?.position || [];
  const base: Float32Array = part.basePos ||= (g.attributes.position.array as Float32Array).slice();
  // pants weights: grid bodies (the centre body is the base shape: whatever share is left) + waist / belly versions
  const pw: Record<string, number> = {}, vw: Record<string, number> = {};
  let gs = 0;
  for (const [n, x] of Object.entries(influences(mesh))) if (GRID_KEY.test(n)) { pw[n] = x; gs += x; } else vw[n] = x;
  if (1 - gs > 1e-6) pw[centre] = (pw[centre] || 0) + 1 - gs;
  const bw = influences(bodies[0]), bgrid: Record<string, number> = {};
  for (const [n, x] of Object.entries(bw)) if (GRID_KEY.test(n)) bgrid[n] = x;
  if (part.anchorsFor !== surf) { part.anchors = {}; part.anchorsFor = surf; }
  const delta = (k: string) => (k in dict ? mt[dict[k]]?.array : null) as Float32Array | null;
  const sims = Object.entries(pw).map(([k, x]) => {
    let a: PantsAnchors = part.anchors[k];
    if (!a) {
      const pos = base.slice(), d = delta(k);
      if (d) for (let i = 0; i < pos.length; i++) pos[i] += d[i];
      a = part.anchors[k] = anchorPants(surf, surfaceAt(surf, { [k]: 1 }), pos);
    }
    return { a, w: x };
  });
  const fallback = base.slice();
  for (const [k, x] of Object.entries(pw)) { const d = delta(k); if (d) for (let i = 0; i < fallback.length; i++) fallback[i] += x * d[i]; }
  const P = surfaceAt(surf, bgrid), out = new Float32Array(base.length);
  const risky = placeOnBody(surf, P, sims, fallback, out);
  // waist / belly versions: added on top as before (they were simulated on the centre body's versions)
  let hasVar = false;
  for (const [k, x] of Object.entries(vw)) { const d = delta(k); if (d) { hasVar = true; for (let i = 0; i < out.length; i++) out[i] += x * d[i]; } }
  // a waist / belly version of the body moves the skin under the pants: then every point is checked against the
  // body as shown (shoulder versions do not reach the pants, only the few risky points are checked then)
  const bodyVar = Object.keys(bw).some(n => !GRID_KEY.test(n) && !/^sh/.test(n));
  const all = hasVar || bodyVar;
  pushOutOfBody(surf, all ? surfaceAt(surf, bw) : P, out, all ? Array.from({ length: out.length / 3 }, (_, i) => i) : risky);
  // for restoreHem across all parts (bodyRelativePantsAll)
  part.hemNow = { surf, P, pw, sim: (k: string) => { const p = base.slice(), d = delta(k); if (d) for (let i = 0; i < p.length; i++) p[i] += d[i]; return p; } };
  return out;
}

// All parts of one pants (front, back...) placed with bodyRelativePants, then the lower legs widened back together
// (restoreHem: a mix of simulations flattens the folds piled at the hem). What the viewers call.
export function bodyRelativePantsAll(S: any, parts: any[], centre: string): (Float32Array | null)[] {
  const outs = parts.map(p => bodyRelativePants(S, p, centre));
  if (!parts.length || outs.some(o => !o)) return outs;
  const h0 = parts[0].hemNow, J = parts[0].jeansHem ??= {};
  if (J.surf !== h0.surf) { J.surf = h0.surf; J.cache = {}; }
  restoreHem(parts.map((p, j) => ({ pos: outs[j]!, base: p.basePos, sim: p.hemNow.sim })), h0.P,
    Object.entries(h0.pw as Record<string, number>).map(([k, w]) => ({ key: k, w, body: () => surfaceAt(h0.surf, { [k]: 1 }) })), J.cache);
  return outs;
}
