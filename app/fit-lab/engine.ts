// app/fit-lab/engine.ts
// Shared Fit Lab engine (used by /fit-lab and /fit-lab-profile): the simulated size grid and how the
// sliders blend it (gridWeights / solveBody), colourway textures on loaded shirts, and catwalk playback.
// Colourway swap: put the uploaded (aligned) front/back photos on every loaded shirt, or the original back.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyColourway(S: any) {
  const roots = [...Object.values(S.shirts || {}), ...Object.values(S.walk?.shirts || {}).map((x: unknown) => (x as { root: unknown }).root)];
  for (const r of roots) {
    if (!r || typeof r === 'string') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r as any).traverse((o: any) => {
      const m = o.userData?.fabric;
      if (!m) return;
      if (m.userData.origMap === undefined) { m.userData.origMap = m.map; m.userData.origSheen = m.sheenColor?.clone(); }
      const side = /front/.test(m.name) ? 'front' : /back/.test(m.name) ? 'back' : null;
      const tex = side && S.colourway?.[side];
      m.map = tex || m.userData.origMap;
      // the cloth sheen was tinted with the original shirt's green; follow the new fabric colour instead
      if (m.sheenColor) {
        if (tex && S.colourway.sheen) m.sheenColor.copy(S.colourway.sheen); else if (m.userData.origSheen) m.sheenColor.copy(m.userData.origSheen);
      }
      m.needsUpdate = true;
    });
  }
}
// Pants photo swap (pantsSwap.ts): the jeans' front/back textures, on the static jeans of every size and the catwalk
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyPantsSkin(S: any) {
  const roots = [...Object.values(S.jeans || {}), ...Object.values(S.walk?.jeans || {}).map((x: unknown) => (x as { root: unknown }).root)];
  for (const r of roots) {
    if (!r || typeof r === 'string') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r as any).traverse((o: any) => {
      const m = o.userData?.fabric;
      if (!m) return;
      if (m.userData.origMap === undefined) m.userData.origMap = m.map;
      const side = /front/.test(m.name) ? 'front' : /back/.test(m.name) ? 'back' : null;
      m.map = (side && S.pantsSkin?.[side]) || m.userData.origMap;
      m.needsUpdate = true;
    });
  }
}
export const SIZES = ['S', 'M', 'L', 'XL'] as const;
export type Size = typeof SIZES[number];
export type ViewMode = 'fabric' | 'fit';

// Product walks use their own directory and cache keys so size M cannot reuse Xin's M mesh.
export interface ProductWalk {
  dir: string;
  sizes: string[];
  layered: Partial<Record<Size, string>>;
}

// dirs: where the built-in shirt's walks and the legacy (Xin) jeans walks live (app/fit-lab/paths.ts); both default
// to meta.walk.dir (the old single walk folder)
export function selectWalk(meta: GridMeta, shirt: Size, pants: string | null | undefined,
  legacy: boolean, product?: ProductWalk, dirs?: { shirt: string; pants: string }) {
  const base = dirs?.shirt ?? meta.walk?.dir ?? '';
  const own = !!pants && !!product?.sizes.includes(pants);
  const pantsFile = own ? pants! : legacy && pants && meta.walk?.jeans?.[pants] ? pants : null;
  const pantsDir = own ? product!.dir : dirs?.pants ?? base;
  const layered = !!pantsFile && (own ? product!.layered[shirt] : meta.walk?.layered?.[shirt]) === pantsFile;
  const shirtFile = layered ? `${shirt}_j${pantsFile}` : shirt;
  const shirtDir = own && layered ? pantsDir : base;
  return {
    js: pantsFile && own ? `${pantsDir}/${pantsFile}` : pantsFile,
    sk: own && layered ? `${shirtDir}/${shirtFile}` : shirtFile,
    pantsFile, pantsDir, shirtFile, shirtDir,
    packedPants: own, packedShirt: own && layered,
  };
}

export interface GridMeta {
  heights: number[];                      // e.g. [165, 175, 185]
  chests: number[];                       // e.g. [92, 101, 110]
  centre: string;                         // e.g. "h175_c101"
  body: Record<string, { height: number; chest: number; waist: number; hip: number; shoulder?: number; belly?: number }>;
  chart: Record<Size, { chest: number; shoulder: number; length: number; sleeve: number }>;
  shirt: Record<Size, Record<string, { chest_cm: number; length_cm: number; shoulder_cm: number; hem_cm: number; stretch_p95: number }>>;
  videos?: { beauty?: string; fit?: string };
  shape?: Record<string, Record<Variant, Tape>>;          // cm change when a variant is fully applied
  shirt_var?: Record<Size, Partial<Record<Variant, ShirtNums>>>;
  shirt_var_grid?: Record<Size, Record<string, Partial<Record<Variant, ShirtNums>>>>;   // variants draped on every grid body
  walk?: { dir: string; body: string; sizes: Partial<Record<Size, { stretch_p95_mean: number; stretch_p95_max: number }>>;
    jeans?: Record<string, { stretch_p50_mean: number; stretch_p95_mean: number }>;
    layered?: Partial<Record<Size, string>> };   // shirt size -> jeans size it was walked over (real collision)
  // sizes = waistband held where buttoned; drop = nothing holds it (gravity + friction); belt = held by a belt
  jeans?: { name: string; sizes: Record<string, JeansSim>; drop?: Record<string, JeansSim>; belt?: Record<string, JeansSim> };
}
export type JeansBody = { waistband_height_cm: number; natural_waist_height_cm: number; body_girth_at_waistband_cm?: number; hem_lowest_cm: number; crotch_drop_cm: number;
    stretch_p50: number; floor_cm?: number; hem_on_floor_frac?: number; drop_cm?: number; seam_gap_mean_cm?: number;
    put_on_failed?: boolean };   // the simulation could not get them on (a leg stuck at the thigh)
// variants = the same jeans simulated on the centre body's slim / full waist and flat / round belly versions
// chart.elastic_waist: relaxed elastic (flat cm) of an elastic-waist product; chart.waist is then the fabric width
export type JeansSim = { chart: { waist: number; hip: number; length: number; opening: number; rise: number; inseam: number; elastic_waist?: number };
  bodies: Record<string, JeansBody>; variants?: Record<string, JeansBody> };
// Jeans on the waist / belly versions of the centre body: bilinear between the centre, the waist version, the belly
// version and the combined body ("w86bp", simulated too: two versions' slid or gathered denim does not simply add
// up, and adding them pushed the skin through the jeans). Returns morph / data weights by version name.
export function jeansVarWeights(vw: Record<Variant, number>, has: (name: string) => boolean): Record<string, number> {
  const wv = vw.w70 > 0 ? 'w70' : vw.w86 > 0 ? 'w86' : null, bv = vw.bm > 0 ? 'bm' : vw.bp > 0 ? 'bp' : null;
  const a = wv ? Math.min(1, vw[wv]) : 0, b = bv ? Math.min(1, vw[bv]) : 0, out: Record<string, number> = {};
  if (wv && bv && has(wv + bv)) { out[wv] = a * (1 - b); out[bv] = (1 - a) * b; out[wv + bv] = a * b; }
  else { if (wv && has(wv)) out[wv] = a; if (bv && has(bv)) out[bv] = b; }
  return out;
}
export type Tape = { chest: number; waist: number; hip: number; shoulder: number; belly?: number };
export type ShirtNums = { chest_cm: number; length_cm: number; shoulder_cm: number; hem_cm: number; stretch_p95: number };
export const VARIANTS = ['sh44', 'sh48', 'w70', 'w86', 'bm', 'bp'] as const;
export type Variant = typeof VARIANTS[number];

export const key = (h: number, c: number) => `h${h}_c${c}`;

// bilinear weights of the 4 grid points around (h, c)
export function gridWeights(meta: GridMeta, h: number, c: number): Record<string, number> {
  const seg = (axis: number[], v: number) => {
    const x = Math.min(Math.max(v, axis[0]), axis[axis.length - 1]);
    let i = 0;
    while (i < axis.length - 2 && x > axis[i + 1]) i++;
    return { i, t: (x - axis[i]) / (axis[i + 1] - axis[i]) };
  };
  const a = seg(meta.heights, h), b = seg(meta.chests, c);
  const w: Record<string, number> = {};
  const add = (hi: number, ci: number, v: number) => {
    const k = key(meta.heights[hi], meta.chests[ci]); w[k] = (w[k] || 0) + v;
  };
  add(a.i, b.i, (1 - a.t) * (1 - b.t)); add(a.i + 1, b.i, a.t * (1 - b.t));
  add(a.i, b.i + 1, (1 - a.t) * b.t);   add(a.i + 1, b.i + 1, a.t * b.t);
  return w;
}

export const blend = (w: Record<string, number>, f: (k: string) => number) =>
  Object.entries(w).reduce((s, [k, v]) => s + v * f(k), 0);
export const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

// ─── Catwalk playback ───────────────────────────────────────────────────────────
export interface WalkPackingInfo {
  packed?: { version: number; regions: { offset: number; dtype: 'int16' | 'int8' | 'uint8'; frames: number; width: number }[] };
}

// Decode into the original byte layout. makeTrack/applyFrame remain unchanged.
export function unpackWalk(buf: ArrayBuffer, info: WalkPackingInfo): ArrayBuffer {
  if (info.packed?.version !== 1) throw new Error('Unsupported or missing catwalk packing metadata');
  const input = new Uint8Array(buf), out = new ArrayBuffer(buf.byteLength), bytes = new Uint8Array(out);
  const view = new DataView(out);
  let end = 0;
  for (const region of info.packed.regions) {
    const { offset, dtype, frames, width } = region;
    if (!['int16', 'int8', 'uint8'].includes(dtype) || !Number.isSafeInteger(offset) || offset !== end ||
        !Number.isSafeInteger(frames) || frames < 1 || !Number.isSafeInteger(width) || width < 1) {
      throw new Error('Invalid catwalk packing region');
    }
    const count = frames * width, itemSize = dtype === 'int16' ? 2 : 1;
    end = offset + count * itemSize;
    if (!Number.isSafeInteger(end) || end > buf.byteLength) throw new Error('Truncated catwalk packing region');
    for (let i = 0; i < count; i++) {
      if (itemSize === 2) {
        const delta = input[offset + i] | (input[offset + count + i] << 8);
        const previous = i < width ? 0 : view.getUint16(offset + (i - width) * 2, true);
        view.setUint16(offset + i * 2, delta + previous, true); // wraps to the original int16 bits
      } else {
        bytes[offset + i] = input[offset + i] + (i < width ? 0 : bytes[offset + i - width]);
      }
    }
  }
  if (end !== buf.byteLength) throw new Error('Incomplete catwalk packing regions');
  return out;
}

export async function fetchBin(url: string, metadata: WalkPackingInfo | Promise<WalkPackingInfo>): Promise<ArrayBuffer> {
  let response = await fetch(url + '.gz');
  const packed = response.status !== 404;
  if (!packed) response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  let buf = await response.arrayBuffer();
  if (!packed) return buf; // Original file fallback: never delta-decode it.
  const head = new Uint8Array(buf);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return unpackWalk(buf, await metadata);
}

// One track per three.js mesh: Int16 positions per frame per (compacted) Blender vertex, Blender Z-up.
export interface ElasticBandInfo { indices: number[]; relaxed_cm: number; max_stretch: number; body_girth_cm: number }
export interface QInfo { n: number; min: number[]; scale: number[]; frames: number; fit_collision_cm?: number; elastic_band?: ElasticBandInfo }
export interface WalkTrack {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mesh: any; vid: Int32Array; q: Int16Array; info: QInfo; strain?: Int8Array; gap?: Uint8Array; elasticBand?: Uint8Array; acc: Float32Array;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeTrack(mesh: any, buf: ArrayBuffer, offset: number, info: QInfo, strainOffset?: number, gapOffset?: number): WalkTrack {
  const g = mesh.geometry;
  const va = g.attributes._VID || g.attributes._vid;
  const vid = Int32Array.from(va.array as ArrayLike<number>, x => Math.round(x));
  g.attributes.position.setUsage(35048);            // DYNAMIC_DRAW
  mesh.frustumCulled = false;
  const elasticBand = info.elastic_band ? new Uint8Array(info.n) : undefined;
  for (const i of info.elastic_band?.indices ?? []) if (i >= 0 && i < info.n) elasticBand![i] = 1;
  return {
    mesh, vid, info, elasticBand, q: new Int16Array(buf, offset, info.n * 3 * info.frames), acc: new Float32Array(info.n * 3),
    strain: strainOffset !== undefined ? new Int8Array(buf, strainOffset, info.n * info.frames) : undefined,
    gap: gapOffset !== undefined ? new Uint8Array(buf, gapOffset, info.n * info.frames) : undefined,
  };
}

export function applyFrame(t: WalkTrack, f: number, fit: boolean, fabric: keyof typeof FABRIC = 'jersey',
                           adjust?: (pos: Float32Array) => void) {
  const g = t.mesh.geometry, pos = g.attributes.position, a = pos.array as Float32Array, vid = t.vid, q = t.q;
  const [m0, m1, m2] = t.info.min, [s0, s1, s2] = t.info.scale, base = f * t.info.n * 3;
  for (let i = 0; i < pos.count; i++) {        // Blender (x, y, z) -> three (x, z, -y)
    const j = base + vid[i] * 3;
    a[i * 3] = m0 + (q[j] + 32768) * s0; a[i * 3 + 1] = m2 + (q[j + 2] + 32768) * s2; a[i * 3 + 2] = -(m1 + (q[j + 1] + 32768) * s1);
  }
  if (adjust) adjust(a);                      // e.g. layering: the shirt pushed out over the jeans
  pos.needsUpdate = true;
  refreshWalkNormals(t);
  if (fit && g.attributes.color) {
    const col = g.attributes.color, sb = f * t.info.n;
    for (let i = 0; i < pos.count; i++) {
      const gap = t.gap ? t.gap[sb + vid[i]] * 0.1 : NaN, band = t.info.elastic_band;
      const c = band && t.elasticBand?.[vid[i]]
        ? elasticBandColor(band.body_girth_cm / band.relaxed_cm - 1, gap, band.max_stretch - 1, t.info.fit_collision_cm ?? 0.35)
        : fitColor(t.strain ? t.strain[sb + vid[i]] * 0.001 : NaN, gap, fabric, t.info.fit_collision_cm ?? 0.35);
      col.setXYZ(i, c[0], c[1], c[2]);
    }
    col.needsUpdate = true;
  }
}

// Recompute after display-only layering, keeping UV-split vertices smooth like the baked frames.
export function refreshWalkNormals(t: WalkTrack) {
  const g = t.mesh.geometry, pos = g.attributes.position, a = pos.array as Float32Array, vid = t.vid;
  g.attributes.position.needsUpdate = true;
  // normals accumulated per Blender vertex, so UV seams (split vertices) stay smooth
  const acc = t.acc; acc.fill(0);
  const idx = g.index.array, nrm = g.attributes.normal;
  for (let k = 0; k < idx.length; k += 3) {
    const A = idx[k] * 3, B = idx[k + 1] * 3, Cc = idx[k + 2] * 3;
    const ux = a[B] - a[A], uy = a[B + 1] - a[A + 1], uz = a[B + 2] - a[A + 2];
    const vx = a[Cc] - a[A], vy = a[Cc + 1] - a[A + 1], vz = a[Cc + 2] - a[A + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [vid[idx[k]], vid[idx[k + 1]], vid[idx[k + 2]]]) { acc[v * 3] += nx; acc[v * 3 + 1] += ny; acc[v * 3 + 2] += nz; }
  }
  for (let i = 0; i < pos.count; i++) {
    const v = vid[i] * 3, l = Math.hypot(acc[v], acc[v + 1], acc[v + 2]) || 1;
    nrm.setXYZ(i, acc[v] / l, acc[v + 1] / l, acc[v + 2] / l);
  }
  nrm.needsUpdate = true;
}

// Static CPU layering changes positions, but must not split lighting at texture seams.
// Groups are derived once from the untouched mesh: same position, authored normal and
// every morph position. The morph check keeps coincident but independently moving panels apart.
// No vertices, UVs, indices, measurements or animation data are welded or modified.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prepareStaticSurface(parts: any[]) {
  const groups = new Map<string, { part: any; vertex: number; group: number }[]>();
  let count = 0;
  for (const part of parts) {
    const g = part.mesh.geometry;
    part.basePos ||= (g.attributes.position.array as Float32Array).slice();
    part.baseNormal ||= (g.attributes.normal.array as Float32Array).slice();
    part.morphOrder = JSON.stringify(Object.entries(part.mesh.morphTargetDictionary ?? {}).sort((a, b) => Number(a[1]) - Number(b[1])));
    part.smoothGroups = new Uint32Array(g.attributes.position.count);
    for (let i = 0; i < part.smoothGroups.length; i++) {
      const o = i * 3;
      const key = `${part.basePos[o]},${part.basePos[o + 1]},${part.basePos[o + 2]}|${part.baseNormal[o]},${part.baseNormal[o + 1]},${part.baseNormal[o + 2]}`;
      const candidates = groups.get(key) ?? [];
      const morphs = g.morphAttributes.position ?? [];
      const same = candidates.find(c => {
        const other = c.part.mesh.geometry.morphAttributes.position ?? [];
        const normals = g.morphAttributes.normal ?? [], otherNormals = c.part.mesh.geometry.morphAttributes.normal ?? [];
        const equalTargets = (left: { array: ArrayLike<number> }[], right: { array: ArrayLike<number> }[]) =>
          left.length === right.length && left.every((a, k) => [0, 1, 2].every(axis => a.array[o + axis] === right[k].array[c.vertex * 3 + axis]));
        return part.morphOrder === c.part.morphOrder && g.morphTargetsRelative === c.part.mesh.geometry.morphTargetsRelative
          && equalTargets(morphs, other) && equalTargets(normals, otherNormals);
      });
      const group = same?.group ?? count++;
      part.smoothGroups[i] = group;
      if (!same) { candidates.push({ part, vertex: i, group }); groups.set(key, candidates); }
    }
  }
  const surface = { parts, acc: new Float32Array(count * 3) };
  for (const part of parts) part.staticSurface = surface;
  return surface;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function refreshStaticNormals(parts: any[]) {
  if (!parts.length) return;
  const surface = parts[0].staticSurface ?? prepareStaticSurface(parts);
  const acc = surface.acc as Float32Array; acc.fill(0);
  for (const part of parts) {
    const g = part.mesh.geometry, a = g.attributes.position.array, idx = g.index?.array;
    const vertexCount = g.attributes.position.count;
    for (let k = 0, end = idx?.length ?? vertexCount; k < end; k += 3) {
      const ia = idx ? idx[k] : k, ib = idx ? idx[k + 1] : k + 1, ic = idx ? idx[k + 2] : k + 2;
      const A = ia * 3, B = ib * 3, C = ic * 3;
      const ux = a[B] - a[A], uy = a[B + 1] - a[A + 1], uz = a[B + 2] - a[A + 2];
      const vx = a[C] - a[A], vy = a[C + 1] - a[A + 1], vz = a[C + 2] - a[A + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const i of [ia, ib, ic]) {
        const v = part.smoothGroups[i] * 3; acc[v] += nx; acc[v + 1] += ny; acc[v + 2] += nz;
      }
    }
  }
  for (const part of parts) {
    const normal = part.mesh.geometry.attributes.normal;
    for (let i = 0; i < normal.count; i++) {
      const v = part.smoothGroups[i] * 3, len = Math.hypot(acc[v], acc[v + 1], acc[v + 2]);
      if (len > 1e-12) normal.setXYZ(i, acc[v] / len, acc[v + 1] / len, acc[v + 2] / len);
      else normal.setXYZ(i, part.baseNormal[i * 3], part.baseNormal[i * 3 + 1], part.baseNormal[i * 3 + 2]);
    }
    normal.needsUpdate = true;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyStaticLayers(shirts: any[], pants: any[], shirtVisible: boolean) {
  for (const parts of [shirts, pants]) if (parts.length && !parts[0].staticSurface) prepareStaticSurface(parts);
  if (!shirtVisible || !shirts.length || !pants.length) {
    for (const p of [...shirts, ...pants]) if (p.layered) {
      const g = p.mesh.geometry;
      g.attributes.position.array.set(p.basePos); g.attributes.position.needsUpdate = true;
      g.attributes.normal.array.set(p.baseNormal); g.attributes.normal.needsUpdate = true;
      p.layered = false;
    }
    return;
  }
  const all = [...shirts, ...pants], positions = all.map(p => cpuMorphed(p.mesh, p.basePos));
  layerShirtOverPants(positions.slice(0, shirts.length), positions.slice(shirts.length));
  all.forEach((p, i) => {
    const pos = p.mesh.geometry.attributes.position; pos.array.set(positions[i]); pos.needsUpdate = true;
    p.mesh.morphTargetInfluences?.fill(0); p.layered = true;
  });
  refreshStaticNormals(shirts); refreshStaticNormals(pants);
}

// Smoothed walking path of the body and heading: the curved recorded walk plays on the spot.
export function rootPath(t: WalkTrack): { path: [number, number][]; heading: number[] } {
  const { n, frames, min, scale } = t.info, raw: [number, number][] = [];
  for (let f = 0; f < frames; f++) {
    let sx = 0, sy = 0, c = 0;
    for (let v = 0; v < n; v += 25) { const j = (f * n + v) * 3; sx += min[0] + (t.q[j] + 32768) * scale[0]; sy += min[1] + (t.q[j + 1] + 32768) * scale[1]; c++; }
    raw.push([sx / c, sy / c]);
  }
  const win = 12, path = raw.map((_, i) => {
    let x = 0, y = 0, c = 0;
    for (let k = Math.max(0, i - win); k <= Math.min(frames - 1, i + win); k++) { x += raw[k][0]; y += raw[k][1]; c++; }
    return [x / c, y / c] as [number, number];
  });
  const k = 8, heading: (number | null)[] = path.map((_, i) => {
    const a = path[Math.max(0, i - k)], b = path[Math.min(frames - 1, i + k)];
    const dx = b[0] - a[0], dz = -(b[1] - a[1]);                       // three x / z
    return Math.hypot(dx, dz) < 0.05 ? null : Math.atan2(-dx, dz);     // standing still: no direction yet
  });
  const firstMoving = heading.find(h => h !== null) ?? 0;
  let prev = firstMoving;
  const out = heading.map(h => {                                        // unwrap so the turn stays smooth
    let v = h ?? prev; while (v - prev > Math.PI) v -= 2 * Math.PI; while (v - prev < -Math.PI) v += 2 * Math.PI;
    prev = v; return v;
  });
  return { path, heading: out };
}

// Grid weights + shoulder/waist variant weights for a body. shoulder/waist = target cm, or null for the
// body's natural value. The variants slightly change the measured chest, so the chest blend point is
// shifted to keep the chest at what the slider says.
// The shirt's shoulder / waist / belly versions were draped on some grid bodies only (meta.shirt_var_grid). Between
// bodies without them a changed shoulder / waist / belly would borrow the centre body's change, a guess that lets the
// skin poke through a loose shirt, so pages show the shirt on the natural shape there (same rule as the pants).
export function shirtShapeOk(meta: GridMeta, h: number, c: number) {
  const g = meta.shirt_var_grid;
  if (!g) return false;
  const ks = Object.entries(gridWeights(meta, h, c)).filter(([, v]) => v > 1e-6).map(([k]) => k);
  return SIZES.every(s => ks.every(k => VARIANTS.every(v => g[s]?.[k]?.[v])));
}

export function solveBody(meta: GridMeta, h: number, c: number, shoulder: number | null, waist: number | null, belly = 0) {
  const vw: Record<Variant, number> = { sh44: 0, sh48: 0, w70: 0, w86: 0, bm: 0, bp: 0 };
  let w = gridWeights(meta, h, c);
  const sh = meta.shape;
  const ok = !!sh && Object.keys(w).every(k => sh[k] && meta.body[k].shoulder !== undefined);
  const range = { shoulder: [0, 0], waist: [0, 0] };
  const natural = { shoulder: 0, waist: 0 };
  if (!ok) return { w, vw, range, natural, ok };
  const d = (v: Variant, m: keyof Tape) => blend(w, k => sh![k][v]?.[m] ?? 0);
  // belly: -1 flat .. 0 natural .. +1 round (same waist: the variants were built with the waist held)
  const hasBelly = Object.keys(w).every(k => sh![k].bm && sh![k].bp);
  if (hasBelly) { vw.bm = Math.max(0, -belly); vw.bp = Math.max(0, belly); }
  const pick = (target: number | null, nat: number, lo: Variant, hi: Variant, m: keyof Tape) => {
    const dlo = d(lo, m), dhi = d(hi, m);
    const t = target === null ? nat : clamp(target, nat + dlo, nat + dhi);
    vw[lo] = t < nat ? (t - nat) / dlo : 0; vw[hi] = t > nat ? (t - nat) / dhi : 0;
    return [nat + dlo, nat + dhi];
  };
  for (let it = 0; it < 4; it++) {
    natural.shoulder = blend(w, k => meta.body[k].shoulder!); natural.waist = blend(w, k => meta.body[k].waist);
    range.shoulder = pick(shoulder, natural.shoulder, 'sh44', 'sh48', 'shoulder');
    range.waist = pick(waist, natural.waist, 'w70', 'w86', 'waist');
    const dChest = VARIANTS.reduce((s, v) => s + vw[v] * d(v, 'chest'), 0);
    w = gridWeights(meta, h, c - dChest);
  }
  return { w, vw, range, natural, ok };
}


// Tape measures of the body on screen and the simulated shirt's numbers for one size, both blended from
// the grid exactly as the 3D shapes are (grid weights + shoulder/waist variant offsets).
export function fitNumbers(meta: GridMeta, sb: ReturnType<typeof solveBody>, size: Size) {
  const w = sb.w;
  const tape = (m: keyof Tape) => blend(w, k => meta.body[k][m] ?? 0)
    + (sb.ok ? VARIANTS.reduce((s, v) => s + sb.vw[v] * blend(w, k => (meta.shape![k][v]?.[m] ?? 0)), 0) : 0);
  const body = { height: blend(w, k => meta.body[k].height), chest: tape('chest'), waist: tape('waist'), hip: tape('hip'), shoulder: sb.ok ? tape('shoulder') : null };
  const sh = meta.shirt[size];
  if (!sh || !Object.keys(w).every(k => sh[k])) return { body, shirt: null };
  const varDelta = (v: Variant, m: keyof ShirtNums) => {
    const g = meta.shirt_var_grid?.[size];
    return g && Object.keys(w).every(k => g[k]?.[v]) ? blend(w, k => g[k][v]![m]) : (meta.shirt_var?.[size]?.[v]?.[m] ?? 0);
  };
  const M = (m: keyof ShirtNums) => blend(w, k => sh[k][m]) + VARIANTS.reduce((s, v) => s + sb.vw[v] * varDelta(v, m), 0);
  return { body, shirt: { chest: M('chest_cm'), length: M('length_cm'), shoulder: M('shoulder_cm'), hem: M('hem_cm'), stretch: M('stretch_p95') } };
}

// ─── Fit labels and fit-map colours (reports/Garment fit and ease categories.md) ──────────────
// Style tier from chest ease as a percentage of the body chest (pattern-company / brand anchors; no industry
// standard exists). Near a boundary (within 1.5 cm, about factory tolerance + simulation error) say "between".
export const TIERS = [
  { name: 'Compression', upto: 0, color: '#b91c1c' },
  { name: 'Slim', upto: 0.08, color: '#f59e0b' },
  { name: 'Regular', upto: 0.16, color: '#10b981' },
  { name: 'Relaxed', upto: 0.25, color: '#0ea5e9' },
  { name: 'Oversized', upto: Infinity, color: '#3b5bdb' },
];
export function fitTier(easeCm: number, bodyCm: number, droppedShoulder = true) {
  const pct = easeCm / bodyCm;
  let i = TIERS.findIndex(t => pct < t.upto);
  if (!droppedShoulder && i === 4) i = 3;                         // oversized needs a dropped shoulder
  const t = TIERS[i];
  const lo = i > 0 ? TIERS[i - 1].upto * bodyCm : -Infinity, hi = t.upto * bodyCm;
  let label = t.name;
  if (easeCm - lo < 1.5 && i > 0) label = `Between ${TIERS[i - 1].name} and ${t.name}`;
  else if (hi - easeCm < 1.5 && i < TIERS.length - 1) label = `Between ${t.name} and ${TIERS[i + 1].name}`;
  if (!droppedShoulder && pct >= 0.25) label = 'Regular, sized up (loose)';
  return { tier: t.name, label, color: t.color, pct };
}

// Estimated fit, not contact pressure. These legacy strain bands are display heuristics,
// not measured comfort limits. Warm colours require BOTH stretch and proximity to the body.
// G is unsigned surface distance in cm. Subtract the baked collider envelope before
// classifying clearance; 1.5 mm contact tolerance accommodates mm-quantized walk gaps.
// This remains a proxy: unsigned distances cannot detect penetration or prove pressure.
export const FIT_CONTACT_CM = 0.15;
export const FIT_COLLISION_CM = { jersey: 0.7, denim: 0.35 } as const;
export const FABRIC = {
  jersey: { snug: 0.02, tight: 0.04, tooTight: 0.08 },
  denim: { snug: 0.03, tight: 0.045, tooTight: 0.06 },
};
export function fitColor(strain: number, gap: number, fabric: keyof typeof FABRIC = 'jersey',
  collisionCm: number = FIT_COLLISION_CM[fabric]): [number, number, number] {
  // Missing/invalid clearance must never manufacture either tightness or room.
  if (!Number.isFinite(gap) || gap < 0 || !Number.isFinite(collisionCm) || collisionCm < 0) return [1, 1, 1];
  const clearance = Math.max(0, gap - collisionCm);
  if (clearance <= FIT_CONTACT_CM + 1e-6) {
    const f = FABRIC[fabric];
    if (Number.isFinite(strain)) {
      if (strain > f.tooTight) return [0.93, 0.18, 0.18];
      if (strain > f.tight) return [1.0, 0.55, 0.15];
      if (strain > f.snug) return [1.0, 0.86, 0.3];
    }
    return [1, 1, 1];
  }
  // Clearance wins outside the contact band, even if a hanging fold/seam is stretched.
  if (clearance < 1.5) return [0.86, 0.92, 1.0];
  if (clearance < 2.5) return [0.62, 0.78, 1.0];
  return [0.3, 0.52, 0.98];
}

// Elastic is a separate material region: its gathered cloth is not an elastic strain gauge.
// Provisional bands relative to the product's configured extension range, not measured pressure.
export function elasticFit(extension: number, limit: number): 'comfortable' | 'snug' | 'tight' | 'too tight' | 'unknown' {
  if (!Number.isFinite(extension) || !Number.isFinite(limit) || limit <= 0) return 'unknown';
  if (extension >= limit * 0.95 - 1e-6) return 'too tight';
  if (extension >= limit * 0.8 - 1e-6) return 'tight';
  if (extension >= limit * 0.5 - 1e-6) return 'snug';
  return 'comfortable';
}
export function elasticBandColor(extension: number, gap: number, limit: number, collisionCm = 0.35): [number, number, number] {
  // Retain the contact requirement; never paint a hanging waistband tight from body size alone.
  if (!Number.isFinite(gap) || gap < 0 || Math.max(0, gap - collisionCm) > FIT_CONTACT_CM + 1e-6) return fitColor(0, gap, 'denim', collisionCm);
  const grade = elasticFit(extension, limit);
  return grade === 'too tight' ? [0.93, 0.18, 0.18] : grade === 'tight' ? [1, 0.55, 0.15]
    : grade === 'snug' ? [1, 0.86, 0.3] : [1, 1, 1];
}

// Blend cached measurements with the same body/shape weights as the static geometry.
// A missing contributor invalidates the reading instead of silently contributing zero.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function blendFitAttribute(attributes: Record<string, any>, pre: 'S' | 'D' | 'G', n: number,
  w: Record<string, number>, vw: Record<Variant, number>, centre: string, pants: boolean, morphTargets?: Record<string, number>): Float32Array {
  const out = new Float32Array(n);
  const attr = (name: string) => attributes[`_${pre}_${name}`] || attributes[`_${pre.toLowerCase()}_${name}`];
  const hasShape = (name: string) => morphTargets ? name in morphTargets : !!attr(name);
  const valid = (at: { array: ArrayLike<number> } | undefined) => at && at.array.length === n;
  const unknown = () => { out.fill(NaN); return out; };
  const weights = Object.entries(w).filter(([, weight]) => weight !== 0);
  if (!weights.length) return unknown();
  for (const [key, weight] of weights) {
    const at = attr(key);
    if (!valid(at)) return unknown();
    for (let i = 0; i < n; i++) out[i] += weight * at.array[i];
  }
  const variants: [string, number][] = pants
    ? Object.entries(jeansVarWeights(vw, hasShape))
    : VARIANTS.map(v => [v, vw[v]]);
  for (const [variant, weight] of variants) {
    if (!weight) continue;
    const perGrid = weights.every(([key]) => hasShape(`${key}_${variant}`));
    const pairs: [string, string, number][] = perGrid
      ? weights.map(([key, x]) => [`${key}_${variant}`, key, x * weight])
      : [[variant, centre, weight]];
    for (const [name, baseName, x] of pairs) {
      const at = attr(name), base = attr(baseName);
      if (!valid(at) || !valid(base)) return unknown();
      for (let i = 0; i < n; i++) out[i] += x * (at.array[i] - base.array[i]);
    }
  }
  return out;
}
export const FIT_LEGEND: [string, string][] = [
  ['#ee2e2e', 'too tight'], ['#ff8c26', 'tight'], ['#ffdb4d', 'snug'], ['#ffffff', 'touching'],
  ['#dbebff', 'regular room'], ['#9ec7ff', 'loose'], ['#4d85fa', 'very loose'],
];

// ─── Layering: an untucked shirt hangs over the jeans ─────────────────────────────
// Morphed positions on the CPU (three.js applies morphs on the GPU, so we cannot read them back).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cpuMorphed(mesh: any, base: Float32Array): Float32Array {
  const out = base.slice();
  const mt = mesh.geometry.morphAttributes?.position || [], inf = mesh.morphTargetInfluences || [];
  const rel = mesh.geometry.morphTargetsRelative;
  for (let t = 0; t < mt.length; t++) {
    const w = inf[t]; if (!w) continue;
    const a = mt[t].array as Float32Array;
    if (rel) for (let i = 0; i < out.length; i++) out[i] += w * a[i];
    else for (let i = 0; i < out.length; i++) out[i] += w * (a[i] - base[i]);
  }
  return out;
}

// Outer surface of the jeans as a table: per 1 cm of height (y, three.js is Y-up) and 64 directions round the
// body, the largest distance of the jeans from that height's centre. Shirt points inside it are moved out to
// just over the jeans (5 mm), like the shirt hem resting on the denim.
export function pushOutside(shirt: Float32Array, jeans: Float32Array, gapM = 0.008) {
  // only the hip part of the jeans (waistband down 24 cm, above the crotch) is one ring round the body; one
  // centre for all heights, so neighbouring heights are pushed consistently (no steps)
  let y1 = -Infinity;
  for (let i = 1; i < jeans.length; i += 3) y1 = Math.max(y1, jeans[i]);
  const y0 = y1 - 0.24, H = 25, A = 72;
  let cx = 0, cz = 0, cn = 0;
  for (let i = 0; i < jeans.length; i += 3) if (jeans[i + 1] >= y0) { cx += jeans[i]; cz += jeans[i + 2]; cn++; }
  if (!cn) return 0;
  cx /= cn; cz /= cn;
  const R = new Float32Array(H * A);
  for (let i = 0; i < jeans.length; i += 3) {
    if (jeans[i + 1] < y0) continue;
    const h = Math.min(H - 1, Math.floor((jeans[i + 1] - y0) / 0.01)), dx = jeans[i] - cx, dz = jeans[i + 2] - cz;
    const a = Math.floor(((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI)) * A) % A, r = Math.hypot(dx, dz);
    if (r > R[h * A + a]) R[h * A + a] = r;
  }
  // fill empty cells from their neighbours, then smooth lightly (height +-1 cm, angle +-10 deg). A max-envelope
  // here would round the hip section out and blow the shirt up around the jeans (~20 % too wide at the sides).
  let cur = R;
  for (let pass = 0; pass < 6; pass++) {
    const nx = new Float32Array(H * A);
    for (let h = 0; h < H; h++) for (let a = 0; a < A; a++) {
      const own = cur[h * A + a];
      let t = 0, c = 0;
      for (let dh = -1; dh <= 1; dh++) for (let da = -2; da <= 2; da++) {
        const hh = h + dh; if (hh < 0 || hh >= H) continue; const v = cur[hh * A + (a + da + A) % A];
        if (v > 0) { t += v; c++; }
      }
      // first fill gaps, then average but never below the jeans' own radius there (no denim poking through)
      nx[h * A + a] = pass < 3 ? (own > 0 ? own : c ? t / c : 0) : Math.max(R[h * A + a], c ? t / c : 0);
    }
    cur = nx;
  }
  // jeans radius at any height / angle (interpolated in both, so no 1 cm steps)
  const ringAt = (y: number, af: number) => {
    const hf = Math.max(0, Math.min(H - 1, (y - y0) / 0.01)), h0 = Math.floor(hf), h1 = Math.min(H - 1, h0 + 1), v = hf - h0;
    const a0 = Math.floor(af) % A, a1 = (a0 + 1) % A, u = af - Math.floor(af);
    const at = (h: number) => cur[h * A + a0] * (1 - u) + cur[h * A + a1] * u;
    return at(h0) * (1 - v) + at(h1) * v;
  };
  // 1) how far each shirt point must move out, collected on a (height, angle) grid covering the shirt
  const yTop = y1 + 0.06;
  let sy0 = y0;
  for (let i = 1; i < shirt.length; i += 3) if (shirt[i] < sy0) sy0 = shirt[i];
  const SH = Math.ceil((yTop - sy0) / 0.01) + 1, P = new Float32Array(SH * A);
  const angOf = (i: number) => ((Math.atan2(shirt[i + 2] - cz, shirt[i] - cx) + Math.PI) / (2 * Math.PI)) * A;
  for (let i = 0; i < shirt.length; i += 3) {
    const y = shirt[i + 1]; if (y > yTop) continue;
    const r = Math.hypot(shirt[i] - cx, shirt[i + 2] - cz), af = angOf(i), rj = ringAt(y, af);
    if (rj <= 0) continue;
    const need = rj + gapM - r;
    if (need > 0) { const k = Math.min(SH - 1, Math.floor((y - sy0) / 0.01)) * A + Math.floor(af) % A; if (need > P[k]) P[k] = need; }
  }
  // 2) the shirt moves as one sheet: the push is smoothed over the neighbours (+-2 cm, +-10 deg) so they move
  //    together (no steps or ridges), and carried a little way down the hanging fabric (fading 15 % per cm). It is
  //    capped at 3 cm: a point further inside than that is a stray (fold / inner layer), which step 3 handles alone,
  //    and must not drag the whole sheet out (that ballooned the shirt at the back)
  for (let k = 0; k < P.length; k++) P[k] = Math.min(P[k], 0.03);
  for (let a = 0; a < A; a++) for (let h = SH - 2; h >= 0; h--) P[h * A + a] = Math.max(P[h * A + a], 0.85 * P[(h + 1) * A + a]);
  for (let pass = 0; pass < 2; pass++) {
    const nx = new Float32Array(SH * A);
    for (let h = 0; h < SH; h++) for (let a = 0; a < A; a++) {
      let t = 0, c = 0;
      for (let dh = -2; dh <= 2; dh++) for (let da = -2; da <= 2; da++) {
        const hh = h + dh; if (hh < 0 || hh >= SH) continue; t += P[hh * A + (a + da + A) % A]; c++;
      }
      nx[h * A + a] = t / c;
    }
    P.set(nx);
  }
  // 3) apply (fading out over 6 cm above the waistband, so the shirt bends smoothly onto the jeans), then make sure
  //    no point is left inside the denim
  let moved = 0;
  for (let i = 0; i < shirt.length; i += 3) {
    const y = shirt[i + 1]; if (y > yTop) continue;
    const dx = shirt[i] - cx, dz = shirt[i + 2] - cz, r = Math.hypot(dx, dz);
    if (r < 1e-6) continue;
    const af = angOf(i), hf = Math.max(0, Math.min(SH - 1, (y - sy0) / 0.01)), h0 = Math.floor(hf), h1 = Math.min(SH - 1, h0 + 1), v = hf - h0;
    const a0 = Math.floor(af) % A, a1 = (a0 + 1) % A, u = af - Math.floor(af);
    const pAt = (h: number) => P[h * A + a0] * (1 - u) + P[h * A + a1] * u;
    const push = pAt(h0) * (1 - v) + pAt(h1) * v;
    const fade = y <= y1 ? 1 : Math.max(0, 1 - (y - y1) / 0.06), f = fade * fade * (3 - 2 * fade);
    let rn = r + push * f;
    // the last bit inside the denim: out to just over it, but at most 1 cm past the smooth push (a denim spike, e.g.
    // a loose waistband flap, is pressed in under the shirt by pressUnder instead of tenting the shirt out)
    const rj = ringAt(y, af);
    if (rj > 0 && y <= y1 && rn < rj + gapM) rn = Math.min(rj + gapM, r + push * f + 0.01);
    if (rn > r + 1e-5) { const k = rn / r; shirt[i] = cx + dx * k; shirt[i + 2] = cz + dz * k; moved++; }
  }
  return moved;
}

// Denim still outside the shirt where the shirt covers it (a loose waistband flap standing out, or what pushOutside
// left) is pressed in under the shirt, as the shirt's own weight would: the shirt is always the outer layer.
// shirts: every shirt part (positions, already pushed out); jeans: changed in place.
export function pressUnder(shirts: Float32Array[], jeans: Float32Array, gapM = 0.006, fadeM = 0.04) {
  let y1 = -Infinity;
  for (let i = 1; i < jeans.length; i += 3) y1 = Math.max(y1, jeans[i]);
  const yc = y1 - 0.24, A = 72;                       // the hip part (one ring round the body) gives the centre
  let cx = 0, cz = 0, cn = 0;
  for (let i = 0; i < jeans.length; i += 3) if (jeans[i + 1] >= yc) { cx += jeans[i]; cz += jeans[i + 2]; cn++; }
  if (!cn) return 0;
  cx /= cn; cz /= cn;
  const ang = (x: number, z: number) => Math.floor(((Math.atan2(z - cz, x - cx) + Math.PI) / (2 * Math.PI)) * A) % A;
  // the shirt's lowest point per angle (where it stops covering)
  const hem = new Float32Array(A).fill(Infinity);
  let minHem = Infinity;
  for (const sh of shirts) for (let i = 0; i < sh.length; i += 3) {
    const a = ang(sh[i], sh[i + 2]);
    if (sh[i + 1] < hem[a]) hem[a] = sh[i + 1];
    if (sh[i + 1] < minHem) minHem = sh[i + 1];
  }
  // pressed band: the hip part, and on down to the shirt hem when the shirt hangs lower than that (a short body
  // in long shorts: the hem ~29 cm below the waistband, so the last 5 cm above the hem were never pressed)
  const y0 = Math.min(yc, isFinite(minHem) ? minHem - fadeM : yc);
  const yTop = y1 + 0.02, H = Math.ceil((yTop - y0) / 0.01) + 1;
  // the shirt's inner radius per (height, angle)
  const S = new Float32Array(H * A).fill(Infinity);
  for (const sh of shirts) for (let i = 0; i < sh.length; i += 3) {
    const y = sh[i + 1];
    if (y < y0 || y > yTop) continue;
    const k = Math.floor((y - y0) / 0.01) * A + ang(sh[i], sh[i + 2]), r = Math.hypot(sh[i] - cx, sh[i + 2] - cz);
    if (r < S[k]) S[k] = r;
  }
  // cells the shirt mesh skipped (its points are a few cm apart, a cell is 1 cm x 5 deg): from their neighbours,
  // until every cell is filled (3 passes left holes near the side seams, and loose shorts poked through there)
  for (let pass = 0, holes = 1; holes && pass < 40; pass++) {
    holes = 0;
    const prev = S.slice();
    for (let h = 0; h < H; h++) for (let a = 0; a < A; a++) {
      if (prev[h * A + a] !== Infinity) continue;
      let m = Infinity;
      for (let dh = -1; dh <= 1; dh++) for (let da = -1; da <= 1; da++) {
        const hh = h + dh; if (hh >= 0 && hh < H) m = Math.min(m, prev[hh * A + (a + da + A) % A]);
      }
      S[h * A + a] = m; if (m === Infinity) holes++;
    }
  }
  let moved = 0;
  for (let i = 0; i < jeans.length; i += 3) {
    const y = jeans[i + 1]; if (y < y0 || y > yTop) continue;
    const a = ang(jeans[i], jeans[i + 2]);
    // under the shirt: pressed in fully; just below its hem: less and less over fadeM (no step at the hem line,
    // whose faces would otherwise cross the shirt and show above the hem)
    const below = hem[a] - y;
    if (below > fadeM) continue;
    const t = below > 0 ? 1 - below / fadeM : 1;
    const s = S[Math.min(H - 1, Math.floor((Math.max(y, hem[a]) - y0) / 0.01)) * A + a];
    if (!isFinite(s)) continue;
    const dx = jeans[i] - cx, dz = jeans[i + 2] - cz, r = Math.hypot(dx, dz), lim = s - gapM;
    if (r > lim && lim > 0) { const k = (r + (lim - r) * t) / r; jeans[i] = cx + dx * k; jeans[i + 2] = cz + dz * k; moved++; }
  }
  return moved;
}

// Shirt over pants for one frame / slider position: the shirt moves out over the pants as one sheet (pushOutside),
// then any denim still outside it is pressed in under it (pressUnder). Arrays are changed in place.
// The pants come in parts (front and back panels, one mesh per material): they are measured as ONE garment, as the
// waist ring's centre and top from one panel alone sit ~10 cm off (loose shorts then poked through the shirt).
export function layerShirtOverPants(shirts: Float32Array[], pants: Float32Array[]) {
  const all = joinParts(pants);
  for (const sp of shirts) pushOutside(sp, all);
  pressUnder(shirts, all);
  splitParts(all, pants);
}
export function joinParts(parts: Float32Array[]) {
  if (parts.length === 1) return parts[0];
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}
function splitParts(all: Float32Array, parts: Float32Array[]) {
  if (parts.length === 1) return;
  let o = 0; for (const p of parts) { p.set(all.subarray(o, o + p.length)); o += p.length; }
}

// ─── Packed 3D files (blender/pack_glb.py) ──────────────────────────────────────────
// A .glb.gz is a gzipped glb whose shape data and fit data are 16-bit whole numbers (asset.extras.fq has the
// scales). loadPacked downloads it (with progress), un-gzips it in the browser and turns the numbers back into
// float arrays, so the rest of the code (CPU morphs, layering, fit map) works exactly as with the plain .glb.
// A plain .glb (or a host that already un-gzipped it) works too.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function unpackGltf(THREE: any, gltf: any) {
  const fq = gltf?.asset?.extras?.fq as Record<string, number> | undefined;
  if (!fq) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toFloat = (a: any, s: number) => {
    const n = a.count, k = a.itemSize, out = new Float32Array(n * k);
    const get = [a.getX, a.getY, a.getZ, a.getW];
    for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) out[i * k + c] = get[c].call(a, i) * s;
    return new THREE.BufferAttribute(out, k);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gltf.scene.traverse((o: any) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (g.userData.unpacked) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const [m, s] of [['position', fq.pos], ['normal', fq.nrm]] as [string, number][]) if (g.morphAttributes[m] && s) g.morphAttributes[m] = g.morphAttributes[m].map((a: any) => toFloat(a, s));
    for (const name of Object.keys(g.attributes)) {
      const s = fq[name.slice(0, 3).toLowerCase()];
      if (name.startsWith('_') && s) g.setAttribute(name, toFloat(g.attributes[name], s));
    }
    g.computeBoundingBox(); g.computeBoundingSphere(); g.userData.unpacked = true;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadPacked(THREE: any, loader: any, url: string, onLoad: (g: any) => void,
  onProgress?: (e: { loaded: number; total: number }) => void, onError?: (e: unknown) => void) {
  (async () => {
    let r = await fetch(url);
    // not packed yet (e.g. a product still being simulated): the plain .glb
    if (r.status === 404 && url.endsWith('.gz')) { url = url.slice(0, -3); r = await fetch(url); }
    if (!r.ok || !r.body) throw new Error(`${url}: ${r.status}`);
    const total = Number(r.headers.get('content-length')) || 0;
    const reader = r.body.getReader(), chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.length; onProgress?.({ loaded, total });
    }
    let buf: ArrayBuffer = await new Blob(chunks as BlobPart[]).arrayBuffer();
    const head = new Uint8Array(buf, 0, 2);
    if (head[0] === 0x1f && head[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader.parse(buf, url.replace(/[^/]*$/, ''), (gltf: any) => { unpackGltf(THREE, gltf); onLoad(gltf); }, (e: unknown) => onError?.(e));
  })().catch(e => onError?.(e));
}
