// Light files for the shop widget: a 3D file that carries a garment (or the body) on all 40 grid bodies is split
// into what never changes (triangles, texture layout, textures: downloaded once) and one small file per body (the
// positions on that body only). A shopper then downloads the base once and the one body he is nearest to, instead of
// every body (4-7 MB per pants size on 16 Nov 2026; the launch gate asks for under 1.5 MB).
//   node scripts/fitlab/split_bodies.mjs <file.glb | file.glb.gz> <out dir>
// Out: base.json (parts, body keys, textures), base.bin.gz (per part: indices, then texture coordinates as 16-bit),
// tex_<n>.jpg|png, and <body key>.bin.gz = 24 bytes (min xyz, scale xyz as float32) + positions of all parts as
// unsigned 16-bit (x, y, z per vertex; value * scale + min = metres). Prints the sizes.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
// options: --skip hair,eyebrow  leaves those parts out (matched in the mesh or material name; a pants widget is framed
//          from the chest down); --tex 1024  shrinks textures to that many pixels on the long side (macOS sips)
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const SKIP = (opt('--skip') ?? '').split(',').filter(Boolean), TEXMAX = +(opt('--tex') ?? 0);
const [src, out] = argv;
if (!src || !out) { console.error('usage: node scripts/fitlab/split_bodies.mjs <glb> <out dir>'); process.exit(2); }
let b = readFileSync(src); if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
const jl = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + jl).toString()), bin = b.subarray(20 + jl + 8), fq = j.asset?.extras?.fq ?? {};
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }, BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const GET = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }, NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
const dv = new DataView(bin.buffer, bin.byteOffset);
const acc = (i, scale = 1) => {
  const a = j.accessors[i], v = j.bufferViews[a.bufferView], k = SIZE[a.type], stride = v.byteStride || BYTES[a.componentType] * k;
  const start = (v.byteOffset || 0) + (a.byteOffset || 0), o = new Float32Array(a.count * k);
  for (let e = 0; e < a.count; e++) for (let c = 0; c < k; c++) {
    let x = dv[GET[a.componentType]](start + e * stride + c * BYTES[a.componentType], true);
    if (a.normalized) x = Math.max(x / NORM[a.componentType], -1);
    o[e * k + c] = x * scale;
  }
  return o;
};
mkdirSync(out, { recursive: true });
// textures
const texOf = m => { const t = j.materials[m]?.pbrMetallicRoughness?.baseColorTexture?.index; return t === undefined ? null : j.textures[t].source; };
const texFiles = (j.images ?? []).map((im, n) => {
  const v = j.bufferViews[im.bufferView], f = `tex_${n}.${im.mimeType === 'image/png' ? 'png' : 'jpg'}`;
  writeFileSync(`${out}/${f}`, bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength)); return f;
});
// parts: every primitive of every mesh, in order
const parts = [], baseChunks = [], keys = new Set(), posOf = [];   // posOf[part] = { base, targets: {key: Float32Array delta} }
for (const m of j.meshes) {
  const names = m.extras?.targetNames ?? [];
  for (const p of m.primitives) {
    const mname = `${m.name} ${p.material === undefined ? '' : j.materials[p.material].name}`.toLowerCase();
    if (SKIP.some(k => mname.includes(k.toLowerCase()))) continue;
    const base = acc(p.attributes.POSITION), n = base.length / 3;
    const idx = p.indices !== undefined ? acc(p.indices) : Float32Array.from({ length: n }, (_, i) => i);
    const uv = p.attributes.TEXCOORD_0 !== undefined ? acc(p.attributes.TEXCOORD_0) : new Float32Array(n * 2);
    const big = n > 65535, I = big ? Uint32Array.from(idx) : Uint16Array.from(idx);
    const U = new Uint16Array(n * 2); for (let i = 0; i < U.length; i++) U[i] = Math.round(Math.min(1, Math.max(0, uv[i])) * 65535);
    baseChunks.push(Buffer.from(I.buffer, I.byteOffset, I.byteLength), Buffer.from(U.buffer, U.byteOffset, U.byteLength));
    const mi = p.material, ti = mi === undefined ? null : texOf(mi);
    parts.push({ mesh: m.name, material: mi === undefined ? '' : j.materials[mi].name, verts: n, indices: I.length, index32: big, texture: ti === null ? null : texFiles[ti],
      color: mi === undefined ? null : j.materials[mi].pbrMetallicRoughness?.baseColorFactor ?? null });
    const targets = {}; (p.targets ?? []).forEach((t, k) => { if (names[k]) { targets[names[k]] = acc(t.POSITION, fq.pos || 1); keys.add(names[k]); } });
    posOf.push({ base, targets });
  }
}
// the file's own shape (no morph) is the centre body: the one grid key that is not a morph target, if the caller's
// meta says so; here it is written as "_base"
const total = parts.reduce((a, p) => a + p.verts, 0);
const writeBody = (name, get) => {
  const P = new Float32Array(total * 3); let o = 0;
  for (const q of posOf) { const d = get(q); for (let i = 0; i < q.base.length; i++) P[o + i] = q.base[i] + (d ? d[i] : 0); o += q.base.length; }
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i++) { const c = i % 3; if (P[i] < mn[c]) mn[c] = P[i]; if (P[i] > mx[c]) mx[c] = P[i]; }
  const sc = mn.map((v, c) => Math.max(mx[c] - v, 1e-6) / 65535), Q = new Uint16Array(P.length);
  for (let i = 0; i < P.length; i++) { const c = i % 3; Q[i] = Math.round((P[i] - mn[c]) / sc[c]); }
  const head = Buffer.from(new Float32Array([...mn, ...sc]).buffer);
  const z = gzipSync(Buffer.concat([head, Buffer.from(Q.buffer)]), { level: 9 }); writeFileSync(`${out}/${name}.bin.gz`, z); return z.length;
};
const sizes = { _base: writeBody('_base', () => null) };
// shape versions (h175_c101_w86 ...) are skipped: the widget shows grid bodies only
const bodyKeys = [...keys].filter(k => /^h\d+_c\d+$/.test(k));
for (const k of bodyKeys) sizes[k] = writeBody(k, q => q.targets[k] ?? null);
const baseZ = gzipSync(Buffer.concat(baseChunks), { level: 9 }); writeFileSync(`${out}/base.bin.gz`, baseZ);
// only the textures a kept part uses stay; shrink them when asked
const used = new Set(parts.map(p => p.texture).filter(Boolean));
for (const f of texFiles) {
  if (!used.has(f)) { spawnSync('rm', ['-f', `${out}/${f}`]); continue; }
  if (TEXMAX) spawnSync('sips', ['-Z', String(TEXMAX), `${out}/${f}`]);
}
texFiles.splice(0, texFiles.length, ...texFiles.filter(f => used.has(f)));
writeFileSync(`${out}/base.json`, JSON.stringify({ parts, keys: bodyKeys, textures: texFiles, layout: 'per part: indices (uint16 or uint32), then uv (uint16 x 2 per vertex, /65535); bodies: 6 float32 (min xyz, scale xyz) + uint16 xyz per vertex, parts in order' }));
const kb = x => (x / 1024).toFixed(0), bs = Object.values(sizes), tex = texFiles.map(f => statSync(`${out}/${f}`).size);
console.log(`SPLIT ${src} -> ${out}: ${parts.length} parts, ${total} verts, ${bodyKeys.length} bodies`);
console.log(`  base ${kb(baseZ.length)} KB, textures ${tex.map(kb).join(' + ')} KB, one body ${kb(Math.min(...bs))}-${kb(Math.max(...bs))} KB`);
console.log(`  FIRST PICTURE = base + textures + one body = ${((baseZ.length + tex.reduce((a, c) => a + c, 0) + Math.max(...bs)) / 1e6).toFixed(2)} MB (was ${(statSync(src).size / 1e6).toFixed(1)} MB)`);
