// Minimal .npz reader (numpy savez / savez_compressed): float32 / float64 / int arrays, little-endian, C order.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
const TYPES = { '<f4': Float32Array, '<f8': Float64Array, '<i4': Int32Array, '<i8': BigInt64Array, '|u1': Uint8Array, '|b1': Uint8Array };
export function npzArrays(path) {
  const b = readFileSync(path), out = {};
  // central directory: sizes are reliable there (savez writes data descriptors)
  let e = b.length - 22; while (b.readUInt32LE(e) !== 0x06054b50) e--;
  let p = b.readUInt32LE(e + 16);
  for (let n = b.readUInt16LE(e + 10); n > 0; n--) {
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32);
    const name = b.subarray(p + 46, p + 46 + nl).toString(), lo = b.readUInt32LE(p + 42);
    p += 46 + nl + xl + cl;
    const data0 = lo + 30 + b.readUInt16LE(lo + 26) + b.readUInt16LE(lo + 28), raw = b.subarray(data0, data0 + csize);
    const npy = method === 8 ? inflateRawSync(raw) : raw;
    const hl = npy.readUInt16LE(8), header = npy.subarray(10, 10 + hl).toString();
    const descr = header.match(/'descr':\s*'([^']+)'/)[1], T = TYPES[descr];
    if (!T || /'fortran_order':\s*True/.test(header)) throw new Error(`npz: unsupported ${descr} in ${name}`);
    const body = npy.subarray(10 + hl), copy = new Uint8Array(body.length); copy.set(body);
    out[name.replace(/\.npy$/, '')] = new T(copy.buffer);
  }
  for (const k of Object.keys(out)) if (out[k] instanceof Float64Array) out[k] = Float32Array.from(out[k]);
  return out;
}
