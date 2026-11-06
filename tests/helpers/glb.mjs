// Minimal glb reader for tests: positions, indices and morph targets (incl. the packed 16-bit copies, pack_glb.py).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
// allPrimitives: one entry per primitive (a mesh with several materials, e.g. pants front + back); default: the first
export function readGlb(path, allPrimitives = false) {
  let b = readFileSync(path); if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
  const jl = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + jl).toString());
  const bin = b.subarray(20 + jl + 8), fq = j.asset?.extras?.fq ?? {};
  const acc = (i, scale = 1) => {
    const a = j.accessors[i], v = j.bufferViews[a.bufferView], T = COMP[a.componentType], k = SIZE[a.type];
    const stride = v.byteStride || T.BYTES_PER_ELEMENT * k, start = (v.byteOffset || 0) + (a.byteOffset || 0);
    const out = new Float32Array(a.count * k), dv = new DataView(bin.buffer, bin.byteOffset);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    for (let e = 0; e < a.count; e++) for (let c = 0; c < k; c++) {
      let x = dv[get](start + e * stride + c * T.BYTES_PER_ELEMENT, true);
      if (a.normalized) x = Math.max(x / NORM[a.componentType], -1);
      out[e * k + c] = x * scale;
    }
    return out;
  };
  return j.meshes.flatMap(m => (allPrimitives ? m.primitives : m.primitives.slice(0, 1)).map(p => {
    const names = m.extras?.targetNames ?? [];
    const mat = p.material !== undefined ? j.materials[p.material].name : '';
    const position = acc(p.attributes.POSITION), count = position.length / 3;
    const index = p.indices !== undefined ? Uint32Array.from(acc(p.indices)) : null;
    const targets = (p.targets ?? []).map(t => ({ array: acc(t.POSITION, fq.pos || 1) }));
    return { name: m.name, material: mat, morphTargetDictionary: Object.fromEntries(names.map((n, i) => [n, i])),
      geometry: { attributes: { position: { array: position, count } }, index: index && { array: index }, morphAttributes: { position: targets } } };
  }));
}
