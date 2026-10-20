// app/fit-lab/pantsSwap.ts
// Pants photo swap: front/back flat-lay photos of pants with the SAME cut as the simulated Xin jeans are
// re-drawn into the frame of the Xin photos the 3D pattern's UVs were built from (blender/prep_pants_textures.py),
// so they can replace the jeans textures directly. Sizes and physics are unchanged (they come from the pattern
// and the simulation, not from the photo). Runs fully in the browser.
//   1. cut the pants out (colourway.ts segment) and read their outline row by row: outer edges, and below the
//      crotch the inner edge of each leg (the same table the Blender prep makes for the reference photo)
//   2. warp row by row: waistband->crotch and crotch->hem are matched separately, and inside a row each leg's
//      span maps onto the reference leg's span, so a wider stance or a slightly different photo crop still lands
//      every leg on its own panel
//   3. compare the two outlines (proportions only, scale-free) to catch a different cut

import { loadImage, segment, pushPull } from './colourway';

type Row = [number, number, number, number];           // left, inner left, inner right, right
export interface PantsOutline { w: number; h: number; top: number; bottom: number; split: number; centre: number; rows: Row[] }
export interface PantsResult { canvas: HTMLCanvasElement; outline: PantsOutline; mismatch: number; detail: Record<string, number> }

// Outline table of a pants mask (same rules as blender/prep_pants_textures.py, but in fractions of the garment
// width so it works at any photo resolution).
export function outlineOf(mask: Uint8Array, w: number, h: number): PantsOutline | null {
  const runsOf = (y: number) => {
    const runs: [number, number][] = [];
    let s = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && mask[y * w + x];
      if (on && s < 0) s = x;
      if (!on && s >= 0) { runs.push([s, x - 1]); s = -1; }
    }
    return runs;
  };
  const raw: ([number, number][] | null)[] = [];
  let wmax = 0;
  for (let y = 0; y < h; y++) {
    const r = runsOf(y); raw.push(r.length ? r : null);
    if (r.length) wmax = Math.max(wmax, r[r.length - 1][1] - r[0][0]);
  }
  if (wmax < 20) return null;
  // the legs of wide pants nearly touch at the hem: only tiny holes (stitching, light splices) are merged
  // same as the Blender prep for the Xin photo (12 px runs, 25 px holes for 890 px tall pants), relative to the
  // pants height so the photo crop does not matter
  const ys = raw.map((r, y) => r ? y : -1).filter(y => y >= 0), H0 = ys[ys.length - 1] - ys[0];
  const minRun = H0 * 0.0135, gap = H0 * 0.028;
  const rows: (Row | null)[] = raw.map(r => {
    if (!r) return null;
    const merged: [number, number][] = [];
    for (const q of r.filter(q => q[1] - q[0] >= minRun)) {
      if (merged.length && q[0] - merged[merged.length - 1][1] < gap) merged[merged.length - 1][1] = q[1];
      else merged.push([q[0], q[1]]);
    }
    if (!merged.length) return null;
    const two = [...merged].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 2).sort((a, b) => a[0] - b[0]);
    return two.length === 2 ? [two[0][0], two[0][1], two[1][0], two[1][1]] : [two[0][0], -1, -1, two[0][1]];
  });
  const ext = (r: Row | null) => r ? r[3] - r[0] : 0;
  // waistband (not belt loops or a label above it): the first row nearly as wide as the band just below it
  const first = rows.findIndex(r => ext(r) > wmax * 0.3);
  let bottom = h - 1; while (bottom > 0 && ext(rows[bottom]) < wmax * 0.3) bottom--;
  if (first < 0) return null;
  const band = [...Array(Math.max(3, Math.round((bottom - first) * 0.04))).keys()].map(i => ext(rows[first + i + Math.round((bottom - first) * 0.02)])).sort((a, b) => a - b);
  const top = rows.findIndex((r, y) => y >= first && ext(r) > band[band.length >> 1] * 0.85);
  if (top < 0 || bottom - top < h * 0.2) return null;
  // crotch: the first row (below the top 10 %) from which the legs stay apart for the next 3 % of the height
  const two = (y: number) => !!rows[y] && rows[y]![1] >= 0;
  const run = Math.max(3, Math.round((bottom - top) * 0.03));
  let split = -1;
  for (let y = top + Math.round((bottom - top) * 0.1); y < bottom - run && split < 0; y++) {
    let ok = true; for (let k = 0; k < run && ok; k++) ok = two(y + k);
    if (ok) split = y;
  }
  if (split < 0) return null;
  const firsts = [];
  for (let y = split; y < Math.min(bottom, split + 30); y++) if (two(y)) firsts.push((rows[y]![1] + rows[y]![2]) / 2);
  const centre = firsts.reduce((a, b) => a + b, 0) / firsts.length;
  const table: Row[] = [];
  let last: Row = rows[top]!;
  for (let y = top; y <= bottom; y++) {
    const r = rows[y] ?? last; last = r;
    // above the crotch the legs meet at the centre line; below it each leg has its own inner edge
    table.push(y >= split && r[1] >= 0 ? [r[0], r[1], r[2], r[3]] : [r[0], Math.round(centre), Math.round(centre), r[3]]);
  }
  return { w, h, top, bottom, split, centre, rows: table };
}

// Scale-free shape comparison: widths at 12 heights and the crotch height, all relative to the pants height.
function compare(a: PantsOutline, b: PantsOutline) {
  const H = (o: PantsOutline) => o.bottom - o.top;
  const at = (o: PantsOutline, f: number) => o.rows[Math.min(o.rows.length - 1, Math.round(f * H(o)))];
  const d: Record<string, number> = { crotch: Math.abs((a.split - a.top) / H(a) - (b.split - b.top) / H(b)) / ((a.split - a.top) / H(a)) };
  const errs: number[] = [d.crotch];
  for (const f of [0.02, 0.1, 0.2, 0.3, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95]) {
    const ra = at(a, f), rb = at(b, f);
    const ya = a.top + f * H(a), yb = b.top + f * H(b);
    const legs = ya >= a.split && yb >= b.split;
    const wa = legs ? ((ra[1] - ra[0]) + (ra[3] - ra[2])) / 2 : ra[3] - ra[0];
    const wb = legs ? ((rb[1] - rb[0]) + (rb[3] - rb[2])) / 2 : rb[3] - rb[0];
    const e = Math.abs(wa / H(a) - wb / H(b)) / (wa / H(a));
    d[`w${Math.round(f * 100)}`] = e; errs.push(e);
  }
  return { mismatch: errs.reduce((s, e) => s + e, 0) / errs.length, detail: d };
}

// Draw the new photo into the reference frame (ref.w x ref.h, the size of the 3D pattern's texture).
export async function makePantsTexture(file: Blob | string, ref: PantsOutline): Promise<PantsResult> {
  const im = await loadImage(file);
  const seg = segment(im, 900);
  const o = outlineOf(seg.mask, seg.w, seg.h);
  if (!o) throw new Error('Could not find the pants outline in this photo (whole pants, legs apart, plain background).');
  // full-resolution photo pixels
  const pc = document.createElement('canvas'); pc.width = im.width; pc.height = im.height;
  const px = pc.getContext('2d', { willReadFrequently: true })!; px.drawImage(im, 0, 0);
  const src = px.getImageData(0, 0, im.width, im.height).data;
  const k = seg.k, W = ref.w, Hh = ref.h;
  const f = new Float32Array(W * Hh * 4);
  const rowAt = (y: number) => o.rows[Math.max(0, Math.min(o.rows.length - 1, Math.round(y * k) - o.top))];
  for (let yr = ref.top; yr <= ref.bottom; yr++) {
    const R = ref.rows[yr - ref.top];
    // waistband -> crotch and crotch -> hem matched separately (photo y in full-res px)
    const yn = yr < ref.split
      ? (o.top + (yr - ref.top) / (ref.split - ref.top) * (o.split - o.top)) / k
      : (o.split + (yr - ref.split) / (ref.bottom - ref.split) * (o.bottom - o.split)) / k;
    const N = rowAt(yn).map(v => v / k);
    const yi = Math.min(im.height - 1, Math.max(0, Math.round(yn)));
    const spans: [number, number, number, number][] = [[R[0], R[1], N[0], N[1]], [R[2], R[3], N[2], N[3]]];
    for (const [a0, a1, b0, b1] of spans) {
      if (a1 <= a0) continue;
      // keep 2 photo px off the outer edges: edge pixels are part background
      for (let x = a0 + 2; x <= a1 - 2; x++) {
        const t = (x - a0) / (a1 - a0), xn = b0 + t * (b1 - b0);
        const xi = Math.min(im.width - 1, Math.max(0, Math.round(xn)));
        const s = (yi * im.width + xi) * 4, d = (yr * W + x) * 4;
        if (src[s + 3] < 128) continue;
        f[d] = src[s] / 255; f[d + 1] = src[s + 1] / 255; f[d + 2] = src[s + 2] / 255; f[d + 3] = 1;
      }
    }
  }
  pushPull(f, W, Hh);                                    // UVs just outside the outline still read fabric
  const out = document.createElement('canvas'); out.width = W; out.height = Hh;
  const ctx = out.getContext('2d')!, img = ctx.createImageData(W, Hh);
  for (let i = 0; i < W * Hh * 4; i++) img.data[i] = (i & 3) === 3 ? 255 : Math.round(f[i] * 255);
  ctx.putImageData(img, 0, 0);
  const { mismatch, detail } = compare(ref, o);
  return { canvas: out, outline: o, mismatch, detail };
}

export async function loadPantsRef(url: string): Promise<{ front: PantsOutline; back: PantsOutline }> {
  return fetch(url).then(r => r.json());
}
