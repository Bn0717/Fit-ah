// Automatic hem (裤脚) check: does the bottom of each leg change smoothly as the height slider moves?
// For every size of a pants product, for each simulated chest, the website's pants (app/fit-lab/pantsBlend.ts, body-
// relative placement) are built at heights 160 -> 190 cm in 2.5 cm steps, and the visible hem width of each leg is
// measured (round the lowest 6 cm of the leg, cm). Real pants on a growing person change one way, smoothly: a
// width that goes up then down then up again (a "zig-zag" of more than TOL cm) is flagged, and so is a size that is
// tighter at the knee than the size below it on the same body.
//   node scripts/fitlab/hem_check.mjs <pants dir with drop/ belt/ (or grid/drop ...)> [drop|belt] [--json out.json]
// Exit code 1 when anything is flagged (so it can run after every new pants product).
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
const R = new URL('../../', import.meta.url).pathname;
const tsx = f => ts.transpileModule(readFileSync(R + f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const B = await import(`data:text/javascript;base64,${Buffer.from(tsx('app/fit-lab/pantsBlend.ts')).toString('base64')}`);
const E = await import(`data:text/javascript;base64,${Buffer.from(tsx('app/fit-lab/engine.ts')).toString('base64')}`);
const { readGlb } = await import(R + 'tests/helpers/glb.mjs');
const engineUrl = `data:text/javascript;base64,${Buffer.from(tsx('app/fit-lab/engine.ts')).toString('base64')}`;
const { jeansState } = await import(`data:text/javascript;base64,${Buffer.from(tsx('app/fit-lab/jeansFit.ts').replaceAll("'./engine'", JSON.stringify(engineUrl))).toString('base64')}`);
const { legGirths } = await import(R + 'scripts/fitlab/pants_measure.mjs');

const args = process.argv.slice(2), jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const dir = (args[0].startsWith('/') ? '' : R) + args[0], variant = args[1] && !args[1].startsWith('--') ? args[1] : 'drop';
const TOL = 3;          // cm: a hem may wobble this much between neighbouring heights without being flagged
const KNEE_TOL = 1.5;     // cm: a bigger size may be this much narrower at the knee (measuring noise)
const KNEE = 0.285;     // knee height / stature (adult anthropometry, ~0.28-0.29): the body's knee, same for every size
const meta = JSON.parse(readFileSync(R + 'public/models/fitlab/bodies/grid/meta.json'));
const S = B.makeBodySurface(readGlb(R + 'public/models/fitlab/bodies/grid/body.glb').filter(m => /^Human\.body/i.test(m.material) || /shoe/i.test(m.material)));
const vdir = `${dir}/${variant}`;
const sizes = readdirSync(vdir).filter(f => /^jeans_.+\.glb\.gz$/.test(f)).map(f => f.slice(6, -7));
// the website's own verdict (jeansFit.ts): only pants a shopper is shown are judged
const sims = v => existsSync(`${dir}/${v}`) ? Object.fromEntries(readdirSync(`${dir}/${v}`).filter(f => /^jeans_.+\.json$/.test(f)).map(f => [f.slice(6, -5), JSON.parse(readFileSync(`${dir}/${v}/${f}`))])) : undefined;
const product = existsSync(`${dir}/product.json`) ? JSON.parse(readFileSync(`${dir}/product.json`)) : {};
const PD = { name: 'pants', sizes: sims('belt') ?? sims(variant), belt: sims('belt'), drop: sims('drop'), elasticStretch: product.elastic_stretch ?? null };
const shown = (size, h, c) => { const st = jeansState(meta, PD, size, variant === 'belt', h, c, null, null, 0); return !!st && !st.hide; };

// the website's pants at one body (all parts joined), or null where any needed neighbour was not simulated / failed
function sitePants(parts, data, w) {
  for (const k of Object.keys(w)) if (w[k] > 1e-6 && (!data.bodies[k] || data.bodies[k].put_on_failed)) return null;
  const P = B.surfaceAt(S, w), out = [], hem = [];
  for (const J of parts) {
    const dict = J.morphTargetDictionary, base = J.geometry.attributes.position.array, mt = J.geometry.morphAttributes.position;
    const sim = k => { const o = base.slice(); if (k in dict) { const d = mt[dict[k]].array; for (let i = 0; i < o.length; i++) o[i] += d[i]; } return o; };
    const raw = base.slice(); for (const [k, x] of Object.entries(w)) if (k in dict) { const d = mt[dict[k]].array; for (let i = 0; i < raw.length; i++) raw[i] += x * d[i]; }
    J.anchors ??= {}; const anc = k => J.anchors[k] ??= B.anchorPants(S, B.surfaceAt(S, { [k]: 1 }), sim(k));
    const pos = new Float32Array(base.length);
    const risky = B.placeOnBody(S, P, Object.entries(w).map(([k, x]) => ({ a: anc(k in dict ? k : meta.centre), w: x })), raw, pos);
    B.pushOutOfBody(S, P, pos, risky); out.push(pos); hem.push({ pos, base, sim });
  }
  // as the website does (bodyRelativePantsAll); HEM_RAW=1 in the environment = without, for comparing
  if (!process.env.HEM_RAW) B.restoreHem(hem, P, Object.entries(w).map(([k, x]) => ({ key: k, w: x, body: () => B.surfaceAt(S, { [k]: 1 }) })), parts.hemCache ??= {});
  const all = new Float32Array(out.reduce((a, x) => a + x.length, 0)); let n = 0; for (const x of out) { all.set(x, n); n += x.length; }
  return all;
}
// zig-zag: the biggest swing against the overall direction (an up-down-up of more than TOL)
function zigzag(seq) {
  let worst = 0, at = null;
  for (let i = 1; i < seq.length - 1; i++) {
    const [a, b, c] = [seq[i - 1], seq[i], seq[i + 1]];
    if (a.v == null || b.v == null || c.v == null) continue;
    const sw = (b.v - a.v) * (c.v - b.v) < 0 ? Math.min(Math.abs(b.v - a.v), Math.abs(c.v - b.v)) : 0;
    if (sw > worst) { worst = sw; at = b.h; }
  }
  return { worst: +worst.toFixed(1), at };
}

const H = []; for (let h = 160; h <= 190; h += 2.5) H.push(h);
const report = { dir: args[0], variant, tol: TOL, flags: [], sweeps: {} };
const knees = {};   // size -> "h/c" -> [kneeL, kneeR]
for (const size of sizes) {
  const parts = readGlb(`${vdir}/jeans_${size}.glb.gz`, true), data = JSON.parse(readFileSync(`${vdir}/jeans_${size}.json`));
  const chests = [...new Set(Object.keys(data.bodies).map(k => +k.split('_c')[1]))].sort((a, b) => a - b);
  for (const c of chests) {
    const seq = H.map(h => {
      if (!shown(size, h, c)) return { h, v: null };
      const { w } = E.solveBody(meta, h, c, null, null, 0), pos = sitePants(parts, data, w);
      if (!pos) return { h, v: null };
      const g = legGirths(pos, KNEE * h / 100); (knees[size] ??= {})[`${h}/${c}`] = [g[2], g[3]];
      return { h, v: null, L: g[0], R: g[1] };
    });
    const zl = zigzag(seq.map(s => ({ h: s.h, v: s.L ?? null }))), zr = zigzag(seq.map(s => ({ h: s.h, v: s.R ?? null })));
    report.sweeps[`${size} c${c}`] = seq.map(s => s.L == null ? null : [s.h, s.L, s.R]);
    const z = zl.worst >= zr.worst ? { ...zl, leg: 'left' } : { ...zr, leg: 'right' };
    if (z.worst > TOL) report.flags.push({ kind: 'hem zig-zag', size, chest: c, height: z.at, leg: z.leg, swing_cm: z.worst });
  }
}
// a bigger size never tighter at the knee on the same body (sizes in the order of the size chart's waist)
const order = sizes.map(s => [s, JSON.parse(readFileSync(`${vdir}/jeans_${s}.json`)).chart.waist]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
for (let i = 1; i < order.length; i++) for (const [hc, kb] of Object.entries(knees[order[i]] ?? {})) {
  const ks = knees[order[i - 1]]?.[hc]; if (!ks) continue;
  const d = Math.min(kb[0] - ks[0], kb[1] - ks[1]);
  if (d < -KNEE_TOL) report.flags.push({ kind: 'bigger size tighter at the knee', size: order[i], smaller: order[i - 1], body: hc, diff_cm: +d.toFixed(1) });
}
const zz = report.flags.filter(f => f.kind === 'hem zig-zag'), kn = report.flags.filter(f => f.kind !== 'hem zig-zag');
console.log(`HEM CHECK ${args[0]} (${variant}): ${Object.keys(report.sweeps).length} height sweeps, ${zz.length} hem zig-zags > ${TOL} cm, ${kn.length} bigger-size-tighter spots`);
for (const f of zz.sort((a, b) => b.swing_cm - a.swing_cm).slice(0, 25)) console.log(`  zig-zag ${f.size.padEnd(7)} chest ${f.chest} around ${f.height} cm, ${f.leg} leg: ${f.swing_cm} cm`);
for (const f of kn.slice(0, 15)) console.log(`  knee    ${f.size} vs ${f.smaller} at ${f.body}: ${f.diff_cm} cm`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 1));
process.exitCode = report.flags.length ? 1 : 0;
