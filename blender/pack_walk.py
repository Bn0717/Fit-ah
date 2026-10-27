"""Losslessly pack and verify catwalk integer tracks; run with Blender's Python.

blender -b --python blender/pack_walk.py -- public/models/fitlab/brands/tnt_co/gon_tee/walk
Original .bin files stay untouched. Re-running is deterministic.
"""
import gzip
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

DTYPES = {"int16": np.dtype("<i2"), "int8": np.dtype("i1"), "uint8": np.dtype("u1")}


def regions_for(info, byte_length):
    regions = []
    tracks = info["objects"].values() if "objects" in info else [info]
    for track in tracks:
        frames = track.get("frames", info["frames"])
        regions.append(dict(offset=track.get("offset", 0), dtype="int16", frames=frames, width=track["n"] * 3))
        for key, dtype in [("strain_offset", "int8"), ("gap_offset", "uint8")]:
            if key in track:
                regions.append(dict(offset=track[key], dtype=dtype, frames=frames, width=track["n"]))
    regions.sort(key=lambda r: r["offset"])
    end = 0
    for r in regions:
        if r["offset"] != end:
            raise ValueError(f"Regions do not cover the original buffer exactly at {end}: {r}")
        end += r["frames"] * r["width"] * DTYPES[r["dtype"]].itemsize
    if end != byte_length:
        raise ValueError(f"Region bytes {end} != file bytes {byte_length}")
    return regions


def pack(raw, regions):
    chunks = []
    for r in regions:
        dtype = DTYPES[r["dtype"]]
        q = np.frombuffer(raw, dtype=dtype, count=r["frames"] * r["width"], offset=r["offset"]).reshape(r["frames"], r["width"])
        delta = np.empty_like(q)
        delta[0] = q[0]
        np.subtract(q[1:], q[:-1], out=delta[1:])  # own integer dtype: intentional wrap-around
        chunks.append(delta.view(np.uint8).reshape(-1, dtype.itemsize).T.copy().tobytes())
    return b"".join(chunks)


def unpack(packed, regions):
    out = bytearray(len(packed))
    for r in regions:
        dtype = DTYPES[r["dtype"]]
        count = r["frames"] * r["width"]
        start, length = r["offset"], count * dtype.itemsize
        planes = np.frombuffer(packed, dtype=np.uint8, count=length, offset=start)
        interleaved = planes.reshape(dtype.itemsize, count).T.copy()
        delta = interleaved.reshape(-1).view(dtype).reshape(r["frames"], r["width"])
        decoded = np.cumsum(delta, axis=0, dtype=dtype)
        out[start:start + length] = decoded.tobytes()
    return bytes(out)


def main():
    args = sys.argv[sys.argv.index("--") + 1:]
    root = Path(args[0])
    files = sorted(root.glob("*.bin"))
    if not files:
        raise ValueError(f"No .bin files in {root}")
    report = []
    print(f"{'File':32} {'Original':>12} {'Packed':>12} {'Saved':>8} {'Bytes equal':>12}", flush=True)
    for path in files:
        meta_path = path.with_name(path.stem.replace("walk_shirt_", "walk_", 1) + ".json")
        info = json.loads(meta_path.read_text())
        raw = path.read_bytes()
        regions = regions_for(info, len(raw))
        compressed = gzip.compress(pack(raw, regions), compresslevel=9, mtime=0)
        packed_path = path.with_suffix(".bin.gz")
        packed_path.write_bytes(compressed)
        # Verify the actual disk output, not just an in-memory pre-write buffer.
        equal = unpack(gzip.decompress(packed_path.read_bytes()), regions) == raw
        if not equal:
            raise ValueError(f"Lossless verification FAILED: {path}")
        info["packed"] = {"version": 1, "regions": regions}
        meta_path.write_text(json.dumps(info, separators=(",", ":")) + "\n")
        saved = 100 * (1 - len(compressed) / len(raw))
        print(f"{path.name:32} {len(raw):12,d} {len(compressed):12,d} {saved:7.1f}% {str(equal):>12}", flush=True)
        report.append(dict(file=path.name, original=len(raw), packed=len(compressed), bytes_equal=equal,
                           original_sha256=hashlib.sha256(raw).hexdigest(), packed_sha256=hashlib.sha256(compressed).hexdigest()))
    original, packed = sum(r["original"] for r in report), sum(r["packed"] for r in report)
    print(f"TOTAL {len(files)} files: {original:,} -> {packed:,} bytes; saved {100 * (1 - packed / original):.1f}%", flush=True)
    Path('/private/tmp/fitah-walk-packing-verification.json').write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
