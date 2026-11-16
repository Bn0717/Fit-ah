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
if (!args[0]) { console.error('usage: node scripts/fitlab/launch_gate.mjs <public product dir>'); process.exit(2); }
const D = args[0].startsWith('/') ? args[0] : R + args[0]; const rel = D.replace(R, '').replace(/\/$/, '');
const id = (() => { try { return JSON.parse(readFileSync(`${D}/product.json`)).id; } catch { return rel.split('/').pop(); } })();
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
const per = modes.flatMap(m => sizes.map(s => mb(`${D}/${m}/jeans_${s}.glb.gz`))).filter(x => x != null);
const worst = per.length ? Math.max(...per) : null;
row('Web', '2 Weight of the first picture', worst == null ? MISSING : `${worst.toFixed(1)} MB (largest size file; all ${per.length} files ${per.reduce((a, b) => a + b, 0).toFixed(0)} MB)`,
  worst != null && worst <= 1.5, 'one size under 1.5 MB', worst != null && worst > 1.5 ? 'each file carries the pants on all 40 bodies; a widget needs one body per download' : '');

// 3 merch: shopper coverage (unweighted over the slider range; weight by the brand's sales-by-size mix when known)
let shown = 0, tot = 0, unavailable = 0;
const pants = { name: id, sizes: belt, drop, belt };
for (const wb of modes.map(m => m === 'belt')) for (const s of sizes) for (let h = 160; h <= 190; h += 2) for (let c = 80; c <= 132; c += 4) {
  const st = F.jeansState(meta, pants, s, wb, h, c, null, null, 0); tot++;
  if (st && !st.hide) shown++; else if (st && /unavailable|Not available|Not simulated/i.test(st.reason ?? '')) unavailable++;
}
// a body counts as covered when at least one size is shown for it
let bodies = 0, covered = 0;
for (let h = 160; h <= 190; h += 2) for (let c = 80; c <= 132; c += 4) { bodies++; if (sizes.some(s => modes.some(m => { const st = F.jeansState(meta, pants, s, m === 'belt', h, c, null, null, 0); return st && !st.hide; }))) covered++; }
row('Merchandising', '3 Shopper coverage', `${(100 * covered / bodies).toFixed(0)} % of bodies get at least one size (${shown} of ${tot} body x size x belt combinations shown; ${unavailable} hidden as "unavailable")`,
  covered / bodies >= 0.8, '80 % of bodies see at least one size', 'unweighted: every height x chest counts the same; weight by the brand\'s sales-by-size mix when known');

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
let splitWorst = 0, splitFile = '';
for (const m of modes) for (const s of sizes) {
  const f = `${D}/${m}/jeans_${s}.glb.gz`; if (!existsSync(f)) continue;
  let verts = 0; const uniq = new Set();
  for (const part of readGlb(f, true)) { const p = part.geometry.attributes.position.array; verts += p.length / 3; for (let i = 0; i < p.length; i += 3) uniq.add(`${p[i].toFixed(4)},${p[i + 1].toFixed(4)},${p[i + 2].toFixed(4)}`); }
  const ratio = verts / Math.max(uniq.size, 1); if (ratio > splitWorst) { splitWorst = ratio; splitFile = `${m} ${s}`; }
}
let zig = null, tighter = null;
for (const m of modes) {
  const r = spawnSync('node', [`${R}scripts/fitlab/hem_check.mjs`, D, m], { encoding: 'utf8', cwd: R });
  const mm = (r.stdout || '').match(/(\d+) hem zig-zags > \d+ cm, (\d+) bigger-size-tighter/);
  if (mm) { zig = (zig ?? 0) + +mm[1]; tighter = (tighter ?? 0) + +mm[2]; }
}
const cleanOk = splitWorst > 0 && splitWorst < 1.5 && zig === 0;
row('Everyone', '7 Looks clean', splitWorst === 0 || zig == null ? MISSING : `texture ${splitWorst < 1.5 ? 'whole' : `SPLIT (${splitWorst.toFixed(1)}x vertices, ${splitFile})`}; ${zig} hem jumps over 3 cm as height changes; ${tighter} places where a bigger size is tighter`,
  cleanOk, 'texture whole, 0 hem jumps', zig ? 'hem jumps are the simulation\'s own fold chance: the "hem by rule" fix targets this' : '');

const green = rows.filter(r => r.ok).length, missing = rows.filter(r => r.value === MISSING).length;
const verdict = green === rows.length ? 'PASS' : 'NOT READY';
const md = [`# Launch gate: ${id}`, '', `**${verdict}**: ${green} of ${rows.length} green, ${missing} missing. Printed ${new Date().toISOString().slice(0, 10)} from \`${rel}\`.`, '',
  '| Who asks | Number | Value | Target | Status | Note |', '|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.who} | ${r.name} | ${r.value} | ${r.target} | ${r.value === MISSING ? 'MISSING' : r.ok ? 'green' : 'RED'} | ${r.note} |`), ''].join('\n');
mkdirSync(R + outDir, { recursive: true }); writeFileSync(`${R}${outDir}/${id}.md`, md);
console.log(md); console.log(`written ${outDir}/${id}.md`);
process.exit(verdict === 'PASS' ? 0 : 1);
