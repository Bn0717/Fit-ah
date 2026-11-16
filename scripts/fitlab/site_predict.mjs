// Ruler round, picture A: what the WEBSITE tells a shopper of a given height and chest for one pants product, in the
// same terms as blender/tester_pants.sh prints for the tester's own body (picture B) and as the ruler form asks.
//   node scripts/fitlab/site_predict.mjs <public product dir with belt/ drop/> <height> <chest> [size ...] [--tape waist,hip,inseam]
//   e.g. node scripts/fitlab/site_predict.mjs public/models/fitlab/brands/uniqlo/barrel_leg_jeans 172 94 30inch 32inch
// Uses the site's own code (app/fit-lab/jeansFit.ts + engine.ts), so it is exactly what the fitting room shows.
import { readFileSync, readdirSync, existsSync } from 'node:fs'; import ts from 'typescript';
const R = new URL('../../', import.meta.url).pathname;
const tx = f => ts.transpileModule(readFileSync(`${R}app/fit-lab/${f}`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const eng = `data:text/javascript;base64,${Buffer.from(tx('engine.ts')).toString('base64')}`;
const F = await import(`data:text/javascript;base64,${Buffer.from(tx('jeansFit.ts').replace(/from '\.\/engine'/, `from '${eng}'`)).toString('base64')}`);
const meta = JSON.parse(readFileSync(`${R}public/models/fitlab/bodies/grid/meta.json`));
const args = process.argv.slice(2); const ti = args.indexOf('--tape');
const tapeArg = ti >= 0 ? args.splice(ti, 2)[1].split(',').map(Number) : null;
const [dir, h, c, ...want] = args; const D = dir.startsWith('/') ? dir : R + dir;
const sizes = readdirSync(`${D}/belt`).map(f => f.match(/^jeans_(.+)\.json$/)?.[1]).filter(Boolean);
const ld = v => Object.fromEntries(sizes.map(s => [s, JSON.parse(readFileSync(`${D}/${v}/jeans_${s}.json`))]));
const belt = ld('belt'), drop = existsSync(`${D}/drop/jeans_${sizes[0]}.json`) ? ld('drop') : belt;
const pants = { name: 'p', sizes: belt, drop, belt };
const tape = tapeArg ? { waist: tapeArg[0] || undefined, hip: tapeArg[1] || undefined, inseam: tapeArg[2] || undefined } : undefined;
const out = {};
for (const s of (want.length ? want : sizes)) for (const withBelt of [true, false]) {
  const st = F.jeansState(meta, pants, s, withBelt, +h, +c, null, null, 0, tape); const n = st?.now;
  const row = st ? { shown: !st.hide, message: st.hide ? st.reason : n?.label, hem_above_floor_cm: n ? +(+n.hem).toFixed(1) : null,
    waistband_minus_body_waist_cm: n ? +(+n.waistEase).toFixed(1) : null, slipped_down_cm: n ? +(+n.drop).toFixed(1) : null,
    body_waist_cm: n ? +(+n.bodyWaist).toFixed(1) : null, body_hip_cm: n ? +(+n.bodyHip).toFixed(1) : null, length: n?.lengthFit } : null;
  out[`${withBelt ? 'belt' : 'drop'} ${s}`] = row;
  console.log('SITE', withBelt ? 'belt' : 'drop', s, JSON.stringify(row));
}
