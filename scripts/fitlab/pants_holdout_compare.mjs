// Pants hold-out comparison (blender/pants_holdout.sh): a real simulation on an in-between body vs what the website
// draws there (body-relative blend, app/fit-lab/pantsBlend.ts) and vs the old point-by-point mix.
//   node scripts/fitlab/pants_holdout_compare.mjs [output/qa/pants_holdout]
// Per result: same-point distance (each fabric point vs the same point of the real sim: mean / 95th pct, cm),
// shape distance (nearest surface point either way, cm: folds sliding sideways do not count), hem and knee girth of
// each leg vs the real sim, and denim points > 3 mm inside the skin. Writes summary.json next to the results.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import ts from 'typescript';
const R = new URL('../../', import.meta.url).pathname;
const tsx = f => ts.transpileModule(readFileSync(R + f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const B = await import(`data:text/javascript;base64,${Buffer.from(tsx('app/fit-lab/pantsBlend.ts')).toString('base64')}`);
const E = await import(`data:text/javascript;base64,${Buffer.from(tsx('app/fit-lab/engine.ts')).toString('base64')}`);
const { readGlb } = await import(R + 'tests/helpers/glb.mjs');
const { npzArrays } = await import(R + 'tests/helpers/npz.mjs');
const { legGirths } = await import(R + 'scripts/fitlab/pants_measure.mjs');
const arg = process.argv[2] || 'output/qa/pants_holdout', O = (arg.startsWith('/') ? '' : R) + arg + '/';
const PROD = {
  xin: { glb: 'public/models/fitlab/brands/tnt_co/xin_jeans/grid/drop', settle: 'blender/products/tnt_co/xin_jeans/work/settle/drop' },
  uniqlo: { glb: 'public/models/fitlab/brands/uniqlo/barrel_leg_jeans/drop', settle: 'blender/products/uniqlo/barrel_leg_jeans/settle/drop' },
};
const meta = JSON.parse(readFileSync(R + 'public/models/fitlab/bodies/grid/meta.json'));
const S = B.makeBodySurface(readGlb(R + 'public/models/fitlab/bodies/grid/body.glb').filter(m => /^Human\.body/i.test(m.material) || /shoe/i.test(m.material)));

// Blender (z up) -> glTF (y up)
const toGl = a => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i += 3) { o[i] = a[i]; o[i + 1] = a[i + 2]; o[i + 2] = -a[i + 1]; } return o; };
// nearest point index, on a 2 cm hash grid
const nearestIndex = (pts, cell = 0.02) => {
  const g = new Map(), key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < pts.length; i += 3) { const k = key(pts[i], pts[i + 1], pts[i + 2]); (g.get(k) || g.set(k, []).get(k)).push(i / 3); }
  return (x, y, z) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 8 && best < 0 || r <= 1; r++) {
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
        for (const j of g.get(`${cx + a},${cy + b},${cz + c}`) || []) { const d = (pts[j * 3] - x) ** 2 + (pts[j * 3 + 1] - y) ** 2 + (pts[j * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = j; } }
      }
      if (best >= 0) break;
    }
    return [best, Math.sqrt(bd)];
  };
};
// glb vertex -> npz vertex: the exporter splits vertices at UV seams and per material, but keeps positions exactly
// (checked: the glb base shape IS the centre body's result, 0.0 mm apart), so each glb vertex is matched to the
// npz vertex at the same spot on the centre body
const mapCache = {};
function vertexMap(prod, key, base, size) {
  const k = prod + key; if (mapCache[k]) return mapCache[k];
  const c = toGl(npzArrays(R + `${PROD[prod].settle}/jeans_${size}_${meta.centre}.npz`).Jeans), nn = nearestIndex(c);
  const map = new Int32Array(base.length / 3); let worst = 0;
  for (let i = 0; i < map.length; i++) { const [j, e] = nn(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]); map[i] = j; worst = Math.max(worst, e); }
  return (mapCache[k] = { map, off: [0, 0, 0], worst });
}
const girths = legGirths;
const inside = (pos, w) => { const a = B.anchorPants(S, B.surfaceAt(S, w), pos); let n = 0; for (let i = 0; i < a.dist.length; i++) if (a.dir[i * 3 + 2] < 0 && a.dist[i] > 0.003) n++; return n; };
const pct = (v, p) => { const s = Float64Array.from(v).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function shapeDist(a, b) { // symmetric nearest-point distance, cm
  const na = nearestIndex(a), nb = nearestIndex(b), d = [];
  for (let i = 0; i < a.length; i += 3) d.push(nb(a[i], a[i + 1], a[i + 2])[1]);
  for (let i = 0; i < b.length; i += 3) d.push(na(b[i], b[i + 1], b[i + 2])[1]);
  return d.map(x => x * 100);
}

const glbs = {}, rows = [];
for (const f of readdirSync(O).filter(f => /_drop_m\.npz$/.test(f)).sort()) {
  const [, prod, size, h, c] = f.match(/^([a-z]+)_(.+)_h(\d+)_c(\d+)_drop_m\.npz$/);
  // the pants are several parts (front, back): each is placed on its own, as on the website
  const parts = glbs[prod + size] ??= readGlb(R + `${PROD[prod].glb}/jeans_${size}.glb.gz`, true);
  const { w } = E.solveBody(meta, +h, +c, null, null, 0);
  if (!Object.keys(w).every(k => k in parts[0].morphTargetDictionary || k === meta.centre)) { console.log('SKIP', f, 'neighbour not simulated'); continue; }
  const rn = toGl(npzArrays(O + f).Jeans), S3 = [], R3 = [], RL = []; let worst = 0;
  parts.forEach((J, pi) => {
    const dict = J.morphTargetDictionary, base = J.geometry.attributes.position.array, mt = J.geometry.morphAttributes.position;
    const sim = k => { const o = base.slice(); if (k in dict) { const d = mt[dict[k]].array; for (let i = 0; i < o.length; i++) o[i] += d[i]; } return o; };
    const raw = base.slice(); for (const [k, x] of Object.entries(w)) if (k in dict) { const d = mt[dict[k]].array; for (let i = 0; i < raw.length; i++) raw[i] += x * d[i]; }
    J.anchors ??= {}; const anc = k => J.anchors[k] ??= B.anchorPants(S, B.surfaceAt(S, { [k]: 1 }), sim(k));
    const P = B.surfaceAt(S, w), site = new Float32Array(base.length);
    const risky = B.placeOnBody(S, P, Object.entries(w).map(([k, x]) => ({ a: anc(k in dict ? k : meta.centre), w: x })), raw, site);
    B.pushOutOfBody(S, P, site, risky);
    // the real simulation in the website's frame, in glb vertex order
    const vm = vertexMap(prod, size + pi, base, size); worst = Math.max(worst, vm.worst);
    const real = new Float32Array(base.length);
    for (let i = 0; i < vm.map.length; i++) for (let q = 0; q < 3; q++) real[i * 3 + q] = rn[vm.map[i] * 3 + q] + vm.off[q];
    S3.push(site); R3.push(raw); RL.push(real);
  });
  const cat = L => { const o = new Float32Array(L.reduce((a, x) => a + x.length, 0)); let n = 0; for (const x of L) { o.set(x, n); n += x.length; } return o; };
  const site = cat(S3), raw = cat(R3), real = cat(RL);
  const same = a => { const d = []; for (let i = 0; i < a.length; i += 3) d.push(Math.hypot(a[i] - real[i], a[i + 1] - real[i + 1], a[i + 2] - real[i + 2]) * 100); return d; };
  const sn = same(site), so = same(raw), shn = shapeDist(site, real), sho = shapeDist(raw, real);
  const gr = girths(real), gs = girths(site), go = girths(raw);
  const row = { prod, size, h: +h, c: +c, matchErrMm: +(worst * 1000).toFixed(2),
    site: { sameMean: +(sn.reduce((a, b) => a + b) / sn.length).toFixed(2), sameP95: +pct(sn, 0.95).toFixed(2), shapeMean: +(shn.reduce((a, b) => a + b) / shn.length).toFixed(2), shapeP95: +pct(shn, 0.95).toFixed(2), inside: inside(site, w) },
    old: { sameMean: +(so.reduce((a, b) => a + b) / so.length).toFixed(2), sameP95: +pct(so, 0.95).toFixed(2), shapeMean: +(sho.reduce((a, b) => a + b) / sho.length).toFixed(2), shapeP95: +pct(sho, 0.95).toFixed(2), inside: inside(raw, w) },
    girth: { real: gr, site: gs, old: go } };
  rows.push(row);
  console.log(`ROW ${prod.padEnd(6)} ${size.padEnd(6)} h${h} c${c}  site: same ${row.site.sameMean}/${row.site.sameP95}  shape ${row.site.shapeMean}/${row.site.shapeP95}  inside ${row.site.inside}  | old: same ${row.old.sameMean}/${row.old.sameP95} shape ${row.old.shapeMean}/${row.old.shapeP95} inside ${row.old.inside}  | hemL/R knee L/R real ${gr} site ${gs}  (match ${row.matchErrMm} mm)`);
}
if (rows.length) {
  const avg = (f) => +(rows.reduce((a, r) => a + f(r), 0) / rows.length).toFixed(2), max = f => +Math.max(...rows.map(f)).toFixed(2);
  const hemErr = r => Math.max(Math.abs(r.girth.site[0] - r.girth.real[0]), Math.abs(r.girth.site[1] - r.girth.real[1]));
  const kneeErr = r => Math.max(Math.abs(r.girth.site[2] - r.girth.real[2]), Math.abs(r.girth.site[3] - r.girth.real[3]));
  const sum = { results: rows.length,
    site: { shapeMean: avg(r => r.site.shapeMean), shapeMeanWorst: max(r => r.site.shapeMean), shapeP95Worst: max(r => r.site.shapeP95), sameMean: avg(r => r.site.sameMean), insideWorst: max(r => r.site.inside), hemErrMean: avg(hemErr), hemErrWorst: max(hemErr), kneeErrMean: avg(kneeErr), kneeErrWorst: max(kneeErr) },
    old: { shapeMean: avg(r => r.old.shapeMean), shapeMeanWorst: max(r => r.old.shapeMean), sameMean: avg(r => r.old.sameMean), insideWorst: max(r => r.old.inside) } };
  console.log('SUMMARY', JSON.stringify(sum));
  writeFileSync(O + 'summary.json', JSON.stringify({ summary: sum, rows }, null, 1));
}
