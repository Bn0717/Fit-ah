// Launch gate: ONE page per pants product that says whether it is ready to be shown to a retailer's shoppers.
// Seven numbers, grouped by who at the retailer asks (agreed in the 15 Nov 2026 expert debate, output/qa/debate):
//   Creative   1 model-photo match            (hand input until the photo-match tool exists)
//   Web        2 weight of the first picture  (computed: the packed 3D file a shopper downloads for one size)
//   Merch      3 shopper coverage             (computed: share of height x chest x size x belt combinations shown)
//              4 agreement with real people   (hand input: ruler round, docs/plans/ruler-round-pants.md)
//   Legal      5 privacy + patent note        (hand input)
//   Operations 6 no hand repair               (computed: share of simulations that dressed without failing)
//   Everyone   7 looks clean                  (computed: texture not split into triangles, hem zig-zags)
// A number that cannot be computed and was not given is printed as MISSING and counts as red: the gate never passes
// on silence. Hand inputs: docs/plans/launch_gate_inputs.json, { "<product id>": { photo_match_cm, ruler_agreement_pct,
// ruler_people, privacy_ok, patent_note, hand_repaired } }.
//   node scripts/fitlab/launch_gate.mjs <public product dir with belt/ (drop/)> [--out output/qa/launch_gate]
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const R = new URL('../../', import.meta.url).pathname;
const args = process.argv.slice(2); const oi = args.indexOf('--out'); const outDir = oi >= 0 ? args.splice(oi, 2)[1] : 'output/qa/launch_gate';
// --id xin  names the product when the folder has no product.json; --glb <dir>  reads the 3D files from another folder
// (Xin: the fit data is in xin_jeans/grid, the files the site loads are in xin_jeans/smooth/grid)
const gi = args.indexOf('--id'); const idArg = gi >= 0 ? args.splice(gi, 2)[1] : null;
const mi = args.indexOf('--glb'); const glbArg = mi >= 0 ? args.splice(mi, 2)[1] : null;
if (!args[0]) { console.error('usage: node scripts/fitlab/launch_gate.mjs <public product dir>'); process.exit(2); }
const D = args[0].startsWith('/') ? args[0] : R + args[0]; const rel = D.replace(R, '').replace(/\/$/, '');
const G = glbArg ? (glbArg.startsWith('/') ? glbArg : R + glbArg) : D;
const id = idArg ?? (() => { try { return JSON.parse(readFileSync(`${D}/product.json`)).id; } catch { return rel.split('/').pop(); } })();
const tx = f => ts.transpileModule(readFileSync(`${R}app/fit-lab/${f}`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const eng = `data:text/javascript;base64,${Buffer.from(tx('engine.ts')).toString('base64')}`;
const F = await import(`data:text/javascript;base64,${Buffer.from(tx('jeansFit.ts').replace(/from '\.\/engine'/, `from '${eng}'`)).toString('base64')}`);
const { readGlb } = await import(R + 'tests/helpers/glb.mjs');
const meta = JSON.parse(readFileSync(`${R}public/models/fitlab/bodies/grid/meta.json`));
const modes = ['belt', 'drop'].filter(m => existsSync(`${D}/${m}`));
if (!modes.length) { console.error(`STOP: no belt/ or drop/ folder in ${D}`); process.exit(2); }
const sizes = readdirSync(`${D}/${modes[0]}`).map(f => f.match(/^jeans_(.+)\.json$/)?.[1]).filter(Boolean);
const ld = v => Object.fromEntries(sizes.map(s => [s, JSON.parse(readFileSync(`${D}/${v}/jeans_${s}.json`))]));
const belt = ld(modes[0]), drop = modes.includes('drop') ? ld('drop') : belt;
const inputsFile = `${R}docs/plans/launch_gate_inputs.json`;
const hand = existsSync(inputsFile) ? (JSON.parse(readFileSync(inputsFile))[id] ?? {}) : {};
const rows = [];
const row = (who, name, value, ok, target, note = '') => rows.push({ who, name, value, ok, target, note });
const MISSING = 'MISSING';

// 1 creative: hem position in the 3D picture vs the brand's own model photo
row('Creative', '1 Model-photo match', hand.photo_match_cm != null ? `${hand.photo_match_cm} cm` : MISSING, hand.photo_match_cm != null && hand.photo_match_cm <= 3,
  'hem within 3 cm of the brand model photo', hand.photo_match_cm == null ? 'needs: hem height measured on the brand model photo vs our picture for the model\'s stated height + size' : '');

// 2 web: what one shopper downloads to see one size
const mb = f => existsSync(f) ? statSync(f).size / 1e6 : null;
const per = modes.flatMap(m => sizes.map(s => mb(`${G}/${m}/jeans_${s}.glb.gz`))).filter(x => x != null);
// when the product has light widget files (scripts/fitlab/split_bodies.mjs -> public/models/fitlab/widget/<id>), the
// first picture is the body (base + textures + one body) plus one size (base + textures + one body)
const WID = `${R}public/models/fitlab/widget`, wdir = [id, id.replace(/_.*/, '')].map(n => `${WID}/${n}`).find(existsSync);
const firstOf = dir => { if (!existsSync(`${dir}/base.bin.gz`)) return null; const fs = readdirSync(dir);
  const bodyFiles = fs.filter(f => /^(h\d+_c\d+|_base)\.bin\.gz$/.test(f)).map(f => statSync(`${dir}/${f}`).size);
  return (statSync(`${dir}/base.bin.gz`).size + fs.filter(f => /^tex_/.test(f)).reduce((a, f) => a + statSync(`${dir}/${f}`).size, 0) + Math.max(...bodyFiles)) / 1e6; };
const wBody = firstOf(`${WID}/body`), wSizes = wdir ? modes.flatMap(m => sizes.map(s => firstOf(`${wdir}/${m}/${s}`))).filter(x => x != null) : [];
const widgetMb = wBody != null && wSizes.length ? wBody + Math.max(...wSizes) : null;
const worst = widgetMb ?? (per.length ? Math.max(...per) : null);
row('Web', '2 Weight of the first picture', worst == null ? MISSING : widgetMb != null ? `${worst.toFixed(2)} MB (widget files: body + the heaviest size)` : `${worst.toFixed(1)} MB (largest size file; all ${per.length} files ${per.reduce((a, b) => a + b, 0).toFixed(0)} MB)`,
  worst != null && worst <= 1.5, 'one size under 1.5 MB', worst != null && worst > 1.5 ? 'each file carries the pants on all 40 bodies; a widget needs one body per download' : '');

// 3 merch: shopper coverage (unweighted over the slider range; weight by the brand's sales-by-size mix when known)
let shown = 0, tot = 0, unavailable = 0;
const pants = { name: id, sizes: belt, drop, belt };
for (const wb of modes.map(m => m === 'belt')) for (const s of sizes) for (let h = 160; h <= 190; h += 2) for (let c = 80; c <= 132; c += 4) {
  const st = F.jeansState(meta, pants, s, wb, h, c, null, null, 0); tot++;
  if (st && !st.hide) shown++; else if (st && /unavailable|Not available|Not simulated/i.test(st.reason ?? '')) unavailable++;
}
// a body is ANSWERED when the widget can tell that shopper something true: a size is drawn, or every size is honestly
// "too small / too tight" (the brand's size range ends there). It is NOT answered when the only thing we can say is
// "unavailable / not simulated" (our gap, not the brand's).
let bodies = 0, wearable = 0, answered = 0;
for (let h = 160; h <= 190; h += 2) for (let c = 80; c <= 132; c += 4) {
  bodies++; let any = false, honest = false;
  for (const s of sizes) for (const m of modes) {
    const st = F.jeansState(meta, pants, s, m === 'belt', h, c, null, null, 0); if (!st) continue;
    if (!st.hide) any = true; else if (/^Too (small|tight)/.test(st.reason ?? '')) honest = true;
  }
  if (any) wearable++; if (any || honest) answered++;
}
row('Merchandising', '3 Shopper coverage', `${(100 * answered / bodies).toFixed(0)} % of bodies get an answer (${(100 * wearable / bodies).toFixed(0)} % see a size they can wear, the rest are told "too small / too tight"); ${shown} of ${tot} body x size x belt combinations drawn`,
  answered / bodies >= 0.9, '90 % of bodies get an answer', 'unweighted: every height x chest counts the same; weight by the brand\'s sales-by-size mix when known');

// 4 merch: agreement with real people
row('Merchandising', '4 Agreement with real people', hand.ruler_agreement_pct != null ? `${hand.ruler_agreement_pct} % right size picked (${hand.ruler_people ?? '?'} people)` : MISSING,
  hand.ruler_agreement_pct != null && hand.ruler_agreement_pct >= 80 && (hand.ruler_people ?? 0) >= 8, '80 % on at least 8 people', hand.ruler_agreement_pct == null ? 'needs: the ruler round (docs/plans/ruler-round-pants.md)' : '');

// 5 legal
const legalOk = hand.privacy_ok === true && !!hand.patent_note;
row('Legal', '5 Privacy + patent note', hand.privacy_ok == null && !hand.patent_note ? MISSING : `privacy ${hand.privacy_ok ? 'ok' : 'NOT ok'}, patent note ${hand.patent_note ? 'on file' : 'missing'}`, legalOk,
  'nothing personal leaves the phone; patent note on file', legalOk ? '' : 'needs: the widget keeping body numbers in the browser, and the university IP office note');

// 6 operations: simulations that dressed without failing (and no hand repair)
let sims = 0, failed = 0;
for (const J of [belt, ...(modes.includes('drop') ? [drop] : [])]) for (const s of sizes) for (const b of Object.values(J[s].bodies ?? {})) { sims++; if (b.put_on_failed) failed++; }
const okShare = sims ? 1 - failed / sims : null;
row('Operations', '6 No hand repair', okShare == null ? MISSING : `${(100 * okShare).toFixed(0)} % of ${sims} simulations dressed first time${hand.hand_repaired ? `; hand repaired: ${hand.hand_repaired}` : ''}`,
  okShare != null && okShare >= 0.95 && !hand.hand_repaired, '95 % dress first time, no hand repair', failed ? `${failed} failed to dress (hidden on the site as "unavailable")` : '');

// 7 looks clean: split texture (the "shattered" look) + hem zig-zags across heights
// split texture = vertices that sit on the same point of the same panel but carry different texture coordinates
// (the exporter then cuts the cloth at every vertex and the print looks shattered, Stallion 13 Nov 2026)
const { gunzipSync } = await import('node:zlib');
const splitShare = f => {
  let b = readFileSync(f); if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
  const jl = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + jl).toString()), bin = b.subarray(20 + jl + 8), dv = new DataView(bin.buffer, bin.byteOffset);
  const K = { SCALAR: 1, VEC2: 2, VEC3: 3 }, BY = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, GET = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' };
  const raw = i => { const a = j.accessors[i], v = j.bufferViews[a.bufferView], k = K[a.type], st = v.byteStride || BY[a.componentType] * k, s0 = (v.byteOffset || 0) + (a.byteOffset || 0);
    const o = new Float64Array(a.count * k); for (let e = 0; e < a.count; e++) for (let c = 0; c < k; c++) o[e * k + c] = dv[GET[a.componentType]](s0 + e * st + c * BY[a.componentType], true);
    return { o, norm: a.normalized ? { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 }[a.componentType] : 1 }; };
  let verts = 0, split = 0;
  for (const m of j.meshes) for (const p of m.primitives) {
    if (p.attributes.TEXCOORD_0 === undefined) continue;
    const P = raw(p.attributes.POSITION).o, U = raw(p.attributes.TEXCOORD_0), n = P.length / 3, first = new Map();
    for (let v = 0; v < n; v++) {
      const k = `${P[v * 3]},${P[v * 3 + 1]},${P[v * 3 + 2]}`, f0 = first.get(k); verts++;
      if (f0 === undefined) first.set(k, v);
      else if (Math.abs(U.o[v * 2] - U.o[f0 * 2]) / U.norm > 0.002 || Math.abs(U.o[v * 2 + 1] - U.o[f0 * 2 + 1]) / U.norm > 0.002) split++;
    }
  }
  return verts ? split / verts : 0;
};
let splitWorst = -1, splitFile = '';
for (const m of modes) for (const s of sizes) {
  const f = `${G}/${m}/jeans_${s}.glb.gz`; if (!existsSync(f)) continue;
  const r = splitShare(f); if (r > splitWorst) { splitWorst = r; splitFile = `${m} ${s}`; }
}
let zig = null, tighter = null;
for (const m of modes) {
  const r = spawnSync('node', [`${R}scripts/fitlab/hem_check.mjs`, D, m], { encoding: 'utf8', cwd: R });
  const mm = (r.stdout || '').match(/(\d+) hem zig-zags > \d+ cm, (\d+) bigger-size-tighter/);
  if (mm) { zig = (zig ?? 0) + +mm[1]; tighter = (tighter ?? 0) + +mm[2]; }
}
const cleanOk = splitWorst >= 0 && splitWorst < 0.05 && zig === 0;
row('Everyone', '7 Looks clean', splitWorst < 0 || zig == null ? MISSING : `texture ${splitWorst < 0.05 ? 'whole' : `SPLIT (${(100 * splitWorst).toFixed(0)} % of vertices, ${splitFile})`}; ${zig} hem jumps over 3 cm as height changes; ${tighter} places where a bigger size is tighter`,
  cleanOk, 'texture whole, 0 hem jumps', zig ? 'hem jumps are the simulation\'s own fold chance: the "hem by rule" fix targets this' : '');

const green = rows.filter(r => r.ok).length, missing = rows.filter(r => r.value === MISSING).length;
const verdict = green === rows.length ? 'PASS' : 'NOT READY';
const md = [`# Launch gate: ${id}`, '', `**${verdict}**: ${green} of ${rows.length} green, ${missing} missing. Printed ${new Date().toISOString().slice(0, 10)} from \`${rel}\`.`, '',
  '| Who asks | Number | Value | Target | Status | Note |', '|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.who} | ${r.name} | ${r.value} | ${r.target} | ${r.value === MISSING ? 'MISSING' : r.ok ? 'green' : 'RED'} | ${r.note} |`), ''].join('\n');
mkdirSync(R + outDir, { recursive: true }); writeFileSync(`${R}${outDir}/${id}.md`, md);
console.log(md); console.log(`written ${outDir}/${id}.md`);
process.exit(verdict === 'PASS' ? 0 : 1);
