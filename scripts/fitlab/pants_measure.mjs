// Measuring pants point clouds (website frame, y up, metres; left leg at x < 0). Shared by the hold-out comparison
// and the hem check.
// convex hull perimeter of 2D points
export function hull(pts) {
  if (pts.length < 3) return 0;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of pts) { while (lo.length > 1 && cr(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.slice().reverse()) { while (up.length > 1 && cr(up.at(-2), up.at(-1), p) <= 0) up.pop(); up.push(p); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1)); let s = 0;
  for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; s += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return s;
}
// [hem L, hem R, knee L, knee R] in cm: round the lowest 6 cm of each leg (the visible hem, incl. fabric piled on the
// shoe) / a 2 cm slice at the knee: kneeY (height above the floor, m: the body's knee, the same for every size on
// one body) or else 40 cm above that leg's lowest point. Each hem from its own leg's bottom (one can sit higher).
export function legGirths(pos, kneeY = null) {
  const y0 = [Infinity, Infinity], s = [[], [], [], []];
  for (let i = 0; i < pos.length; i += 3) { const L = pos[i] < 0 ? 0 : 1; y0[L] = Math.min(y0[L], pos[i + 1]); }
  for (let i = 0; i < pos.length; i += 3) {
    const L = pos[i] < 0 ? 0 : 1, y = pos[i + 1] - y0[L];
    if (y < 0.06) s[L].push([pos[i], pos[i + 2]]);
    if (Math.abs((kneeY == null ? y : pos[i + 1]) - (kneeY ?? 0.40)) < 0.01) s[2 + L].push([pos[i], pos[i + 2]]);
  }
  return s.map(p => +(hull(p) * 100).toFixed(1));
}
