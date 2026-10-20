// app/fit-lab/colourway.ts
// Colourway swap: a new front/back flat-lay photo of the SAME cut is lined up with the photo the 3D
// pattern's UVs were built from, so it can replace the shirt texture directly (sizes are unchanged: they
// come from the pattern and the simulation, not from the photo). Runs fully in the browser.
//   1. cut the shirt out: transparent PNG alpha, or everything not connected to the photo border's colour
//   2. line its outline up with the reference outline (scale, rotation, shift) by maximising the overlap
//   3. draw the photo into the reference frame, fill the background with nearby fabric colour, colour grade

export interface Ref { mask: Uint8Array; w: number; h: number; full: number; pxPerCm: number }
export interface Placement { s: number; th: number; tx: number; ty: number }   // ref px -> photo px
export interface Result { canvas: HTMLCanvasElement; iou: number; place: Placement; refCentre: [number, number]; photoPxPerCm: number; fabric: [number, number, number] }

const G = 400;   // alignment grid (reference 1600 px -> 400)

export function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im); im.onerror = () => rej(new Error('Could not read the image'));
    im.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  });
}

function pixels(im: HTMLImageElement | HTMLCanvasElement, w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(im, 0, 0, w, h);
  return x.getImageData(0, 0, w, h).data;
}

export async function loadRef(maskUrl: string, pxPerCm: number): Promise<Ref> {
  const im = await loadImage(maskUrl);
  const d = pixels(im, G, G), mask = new Uint8Array(G * G);
  for (let i = 0; i < G * G; i++) mask[i] = d[i * 4] > 127 ? 1 : 0;
  return { mask, w: G, h: G, full: im.width, pxPerCm };
}

// Shirt mask of a photo at a working resolution: alpha if the photo has any transparency, otherwise
// "not background", where background = pixels of the border colour that are connected to the border.
export function segment(im: HTMLImageElement, maxSide = 900) {
  const k = maxSide / Math.max(im.width, im.height);
  const w = Math.round(im.width * k), h = Math.round(im.height * k);
  const d = pixels(im, w, h), n = w * h, mask = new Uint8Array(n);
  let transparent = 0;
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] < 128) transparent++;
  if (transparent > n * 0.05) {
    for (let i = 0; i < n; i++) mask[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
  } else {
    const border: number[][] = [];
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) border.push([d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]]);
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) border.push([d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]]);
    const med = [0, 1, 2].map(c => border.map(p => p[c]).sort((a, b) => a - b)[border.length >> 1]);
    // tolerance from how much the border itself varies (shadows, gradients), at least 18 levels
    const dev = border.map(p => Math.hypot(p[0] - med[0], p[1] - med[1], p[2] - med[2])).sort((a, b) => a - b);
    const tol = Math.max(18, dev[Math.floor(dev.length * 0.95)] * 1.5);
    const isBg = (i: number) => Math.hypot(d[i * 4] - med[0], d[i * 4 + 1] - med[1], d[i * 4 + 2] - med[2]) < tol;
    const bg = new Uint8Array(n), stack: number[] = [];
    for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop()!;
      if (bg[i] || !isBg(i)) continue;
      bg[i] = 1;
      const x = i % w, y = (i - x) / w;
      if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - w); if (y < h - 1) stack.push(i + w);
    }
    for (let i = 0; i < n; i++) mask[i] = bg[i] ? 0 : 1;   // a print inside the shirt stays shirt
  }
  // keep the largest blob (drops labels, dust, a hanger tag lying next to the shirt)
  const lab = new Int32Array(n); let best = 0, bestN = 0, cur = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i] || lab[i]) continue;
    cur++; let cnt = 0; const st = [i]; lab[i] = cur;
    while (st.length) {
      const j = st.pop()!; cnt++;
      const x = j % w, y = (j - x) / w;
      for (const q of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1])
        if (q >= 0 && mask[q] && !lab[q]) { lab[q] = cur; st.push(q); }
    }
    if (cnt > bestN) { bestN = cnt; best = cur; }
  }
  for (let i = 0; i < n; i++) mask[i] = lab[i] === best ? 1 : 0;
  return { mask, w, h, k, area: bestN };
}

const box = (m: Uint8Array, w: number, h: number) => {
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
};

// Overlap (intersection over union) of the reference outline and the photo outline under a placement.
function iouOf(ref: Ref, seg: ReturnType<typeof segment>, p: Placement, refArea: number) {
  const r = ref.full / G, co = Math.cos(p.th), si = Math.sin(p.th);
  let inter = 0;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    if (!ref.mask[y * G + x]) continue;
    const X = (x + 0.5) * r, Y = (y + 0.5) * r;                  // ref full-res px
    const u = (p.s * (co * X - si * Y) + p.tx) * seg.k, v = (p.s * (si * X + co * Y) + p.ty) * seg.k;
    const ui = Math.floor(u), vi = Math.floor(v);
    if (ui >= 0 && vi >= 0 && ui < seg.w && vi < seg.h && seg.mask[vi * seg.w + ui]) inter++;
  }
  const photoArea = seg.area / (p.s * seg.k / (1 / r)) ** 2;      // photo blob area in ref grid cells
  return inter / (refArea + photoArea - inter);
}

export function align(ref: Ref, seg: ReturnType<typeof segment>): { place: Placement; iou: number } {
  const rb = box(ref.mask, G, G), sb = box(seg.mask, seg.w, seg.h), r = ref.full / G;
  let refArea = 0; for (const v of ref.mask) refArea += v;
  // start: match outline heights and centres
  const s0 = ((sb.y1 - sb.y0 + 1) / seg.k) / ((rb.y1 - rb.y0 + 1) * r);
  const c = [(rb.cx + 0.5) * r, (rb.cy + 0.5) * r];
  let p: Placement = { s: s0, th: 0, tx: (sb.cx + 0.5) / seg.k - s0 * c[0], ty: (sb.cy + 0.5) / seg.k - s0 * c[1] };
  let best = iouOf(ref, seg, p, refArea);
  // coordinate search, halving the steps when nothing improves; rotation/scale about the outline centre
  let st = { s: 0.06, th: 0.05, t: 12 / seg.k };          // t in photo px (12 working-resolution px)
  const around = (q: Placement, ds: number, dth: number): Placement => {
    // keep the reference centre fixed in the photo while changing scale / rotation
    const X = c[0], Y = c[1], co = Math.cos(q.th), si = Math.sin(q.th);
    const px = q.s * (co * X - si * Y) + q.tx, py = q.s * (si * X + co * Y) + q.ty;
    const s = q.s * (1 + ds), th = q.th + dth, c2 = Math.cos(th), s2 = Math.sin(th);
    return { s, th, tx: px - s * (c2 * X - s2 * Y), ty: py - s * (s2 * X + c2 * Y) };
  };
  for (let it = 0; it < 200 && st.t > 0.3 / seg.k; it++) {
    const cands = [
      around(p, st.s, 0), around(p, -st.s, 0), around(p, 0, st.th), around(p, 0, -st.th),
      { ...p, tx: p.tx + st.t }, { ...p, tx: p.tx - st.t }, { ...p, ty: p.ty + st.t }, { ...p, ty: p.ty - st.t },
    ];
    let improved = false;
    for (const q of cands) { const v = iouOf(ref, seg, q, refArea); if (v > best + 1e-5) { best = v; p = q; improved = true; } }
    if (!improved) st = { s: st.s / 2, th: st.th / 2, t: st.t / 2 };
  }
  return { place: p, iou: best };
}

// Shrink a mask by r pixels: photo edge pixels are part background (JPEG ringing, soft edges).
function erode(m: Uint8Array, w: number, h: number, r: number) {
  let cur = m;
  for (let k = 0; k < r; k++) {
    const nx = new Uint8Array(cur.length);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      nx[i] = cur[i] & cur[i - 1] & cur[i + 1] & cur[i - w] & cur[i + w];
    }
    cur = nx;
  }
  return cur;
}

// Fill transparent pixels with the average of nearby opaque ones (push-pull pyramid): UVs that land
// just outside the outline still read fabric, never background.
export function pushPull(rgba: Float32Array, w: number, h: number) {
  if (w <= 1 && h <= 1) return;
  const W = Math.ceil(w / 2), H = Math.ceil(h / 2), low = new Float32Array(W * H * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, a = rgba[i + 3], j = ((y >> 1) * W + (x >> 1)) * 4;
    low[j] += rgba[i] * a; low[j + 1] += rgba[i + 1] * a; low[j + 2] += rgba[i + 2] * a; low[j + 3] += a;
  }
  for (let j = 0; j < W * H; j++) { const a = low[j * 4 + 3]; if (a > 0) { low[j * 4] /= a; low[j * 4 + 1] /= a; low[j * 4 + 2] /= a; low[j * 4 + 3] = Math.min(1, a); } }
  pushPull(low, W, H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, a = rgba[i + 3];
    if (a >= 1) continue;
    // bilinear read of the coarser level, so the filled background is smooth (no blocks)
    const fx = Math.min(Math.max((x + 0.5) / 2 - 0.5, 0), W - 1), fy = Math.min(Math.max((y + 0.5) / 2 - 0.5, 0), H - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1), u = fx - x0, v = fy - y0;
    for (let c = 0; c < 3; c++) {
      const L = (xx: number, yy: number) => low[(yy * W + xx) * 4 + c];
      const val = (L(x0, y0) * (1 - u) + L(x1, y0) * u) * (1 - v) + (L(x0, y1) * (1 - u) + L(x1, y1) * u) * v;
      rgba[i + c] = rgba[i + c] * a + val * (1 - a);
    }
    rgba[i + 3] = 1;
  }
}

export function render(im: HTMLImageElement, seg: ReturnType<typeof segment>, place: Placement, size: number,
  grade = { val: 0.88, sat: 1.12 }): { canvas: HTMLCanvasElement; fabric: [number, number, number] } {
  // photo -> reference frame: the inverse of the placement
  const { s, th, tx, ty } = place, co = Math.cos(th), si = Math.sin(th);
  const inv = (cvs: CanvasRenderingContext2D) => cvs.setTransform(co / s, -si / s, si / s, co / s,
    -(co * tx + si * ty) / s, -(-si * tx + co * ty) / s);
  const out = document.createElement('canvas'); out.width = out.height = size;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  inv(ctx); ctx.drawImage(im, 0, 0);
  // shirt mask in the same frame (soft edge from the working resolution), then keep only the shirt
  const mc = document.createElement('canvas'); mc.width = seg.w; mc.height = seg.h;
  const mx = mc.getContext('2d')!, md = mx.createImageData(seg.w, seg.h);
  const shrunk = erode(seg.mask, seg.w, seg.h, 2);
  for (let i = 0; i < shrunk.length; i++) { md.data[i * 4 + 3] = shrunk[i] ? 255 : 0; }
  mx.putImageData(md, 0, 0);
  const mo = document.createElement('canvas'); mo.width = mo.height = size;
  const mox = mo.getContext('2d', { willReadFrequently: true })!;
  inv(mox); mox.drawImage(mc, 0, 0, im.width, im.height);
  const img = ctx.getImageData(0, 0, size, size), m = mox.getImageData(0, 0, size, size).data;
  const f = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    // erode the edge a little: photo edge pixels are part background
    const a = m[i * 4 + 3] > 230 ? 1 : 0;
    f[i * 4] = img.data[i * 4] / 255; f[i * 4 + 1] = img.data[i * 4 + 1] / 255; f[i * 4 + 2] = img.data[i * 4 + 2] / 255; f[i * 4 + 3] = a;
  }
  // typical fabric colour (median of the shirt pixels), for the cloth sheen tint
  const samp: number[][] = [];
  for (let i = 0; i < size * size; i += 97) if (f[i * 4 + 3]) samp.push([f[i * 4], f[i * 4 + 1], f[i * 4 + 2]]);
  const fabric = [0, 1, 2].map(c => samp.map(p => p[c]).sort((a, b) => a - b)[samp.length >> 1] ?? 0.5) as [number, number, number];
  pushPull(f, size, size);
  for (let i = 0; i < size * size; i++) {
    const r = f[i * 4], g = f[i * 4 + 1], b = f[i * 4 + 2], grey = (r + g + b) / 3;
    // same grade as blender/pad_texture.py: fabric darker / more saturated, dark print keeps its contrast
    const wf = Math.min(1, Math.max(0, (grey - 0.12) / 0.15));
    for (const [c, v] of [[0, r], [1, g], [2, b]] as [number, number][]) {
      const gr = Math.min(1, Math.max(0, (grey + (v - grey) * grade.sat) * grade.val));
      img.data[i * 4 + c] = Math.round((gr * wf + v * (1 - wf)) * 255);
    }
    img.data[i * 4 + 3] = 255;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(img, 0, 0);
  return { canvas: out, fabric };
}

export async function makeTexture(file: Blob | string, ref: Ref): Promise<Result> {
  const im = await loadImage(file);
  const seg = segment(im);
  const { place, iou } = align(ref, seg);
  const { canvas, fabric } = render(im, seg, place, ref.full);
  const r = ref.full / G, rb = box(ref.mask, G, G);
  return { canvas, iou, place, refCentre: [(rb.cx + 0.5) * r, (rb.cy + 0.5) * r], photoPxPerCm: ref.pxPerCm * place.s, fabric };
}
